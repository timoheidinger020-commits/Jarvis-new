// Baut die Web-Anwendung (API + Oberfläche) zusammen.
import path from 'node:path';
import express from 'express';
import { createAI } from './ai/index.js';
import { createAuth } from './auth.js';
import { createChatService, errorPayload } from './chat/service.js';
import { createConversationStore } from './chat/conversations.js';
import { ROOT_DIR } from './config.js';
import { openDatabase } from './db.js';
import { createExtractor } from './memory/extractor.js';
import { CATEGORIES, createMemoryStore } from './memory/store.js';
import { createSettings } from './settings.js';
import { createTTS, GEMINI_VOICES } from './voice/tts.js';

const VERSION = '0.2.0';

export function createApp(config, { ai: aiOverride, db: dbOverride, tts: ttsOverride, log = console } = {}) {
  const db = dbOverride || openDatabase(config.dbPath);
  const ai = aiOverride || createAI(config.ai);
  const tts =
    ttsOverride ||
    createTTS(config.ai.providers.gemini || {}, { model: config.voice?.ttsModel || 'gemini-3.8-flash-tts' });
  const auth = createAuth(db, { password: config.password });
  const settings = createSettings(db, {
    'ai.provider': config.ai.defaultProvider,
    'memory.autoExtract': true,
    // 'gemini' = natürliche Google-Stimme, 'browser' = Stimme des Geräts
    'voice.engine': tts.configured ? 'gemini' : 'browser',
    'voice.name': 'Charon',
  });
  const conversations = createConversationStore(db);
  const memory = createMemoryStore(db);
  const extractMemories = createExtractor({
    ai,
    store: memory,
    getProviderId: () => settings.get('ai.provider'),
    maxInPrompt: config.memory.maxInPrompt,
  });
  const chat = createChatService({ ai, conversations, memory, extractMemories, settings, config, log });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  // Schutz gegen Anfragen von fremden Webseiten: schreibende API-Aufrufe
  // müssen JSON sein (das können fremde Seiten ohne Erlaubnis nicht senden).
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Anfragen müssen als JSON gesendet werden.' });
    }
    next();
  });

  // ---------- Öffentlich ----------
  app.get('/api/status', (req, res) => {
    res.json({ name: 'JARVIS', version: VERSION, authenticated: auth.isAuthenticated(req) });
  });
  app.post('/api/auth/login', (req, res) => auth.login(req, res));
  app.post('/api/auth/logout', (req, res) => auth.logout(req, res));

  // ---------- Ab hier nur angemeldet ----------
  const api = express.Router();
  api.use((req, res, next) => auth.require(req, res, next));

  const asId = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Ungültige ID.'), { status: 400 });
    return n;
  };

  // Überblick für die Oberfläche
  api.get('/overview', (req, res) => {
    const active = settings.get('ai.provider');
    res.json({
      version: VERSION,
      device: req.session.device_name,
      providers: ai.list(),
      activeProvider: active,
      settings: settings.all(),
      memoryCategories: CATEGORIES,
      voice: {
        geminiAvailable: tts.configured,
        voices: Object.entries(GEMINI_VOICES).map(([id, description]) => ({ id, description })),
      },
      features: {
        textChat: true,
        memory: true,
        voice: true,
        deviceActions: false, // Phase 5/6
      },
    });
  });

  // Einstellungen
  api.patch('/settings', (req, res) => {
    const { aiProvider, memoryAutoExtract, voiceEngine, voiceName } = req.body || {};
    if (voiceEngine !== undefined) {
      if (!['gemini', 'browser'].includes(voiceEngine)) return res.status(400).json({ error: 'Unbekannte Stimme.' });
      if (voiceEngine === 'gemini' && !tts.configured) {
        return res.status(400).json({ error: 'Für die Gemini-Stimme ist kein GEMINI_API_KEY eingetragen.' });
      }
      settings.set('voice.engine', voiceEngine);
    }
    if (voiceName !== undefined) {
      if (!GEMINI_VOICES[voiceName]) return res.status(400).json({ error: 'Unbekannte Stimme.' });
      settings.set('voice.name', voiceName);
    }
    if (aiProvider !== undefined) {
      const provider = ai.list().find((p) => p.id === aiProvider);
      if (!provider) return res.status(400).json({ error: 'Unbekannter Anbieter.' });
      if (!provider.configured) return res.status(400).json({ error: `Für ${provider.label} ist kein API-Schlüssel eingetragen.` });
      settings.set('ai.provider', aiProvider);
    }
    if (memoryAutoExtract !== undefined) settings.set('memory.autoExtract', Boolean(memoryAutoExtract));
    res.json({ settings: settings.all() });
  });

  // Gespräche
  api.get('/conversations', (req, res) => res.json({ conversations: conversations.list() }));
  api.post('/conversations', (req, res) => res.status(201).json({ conversation: conversations.create() }));
  api.get('/conversations/:id', (req, res) => {
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Gespräch nicht gefunden.' });
    res.json({ conversation, messages: conversations.messages(conversation.id) });
  });
  api.patch('/conversations/:id', (req, res) => {
    if (!conversations.get(req.params.id)) return res.status(404).json({ error: 'Gespräch nicht gefunden.' });
    res.json({ conversation: conversations.rename(req.params.id, req.body?.title) });
  });
  api.delete('/conversations/:id', (req, res) => {
    if (!conversations.remove(req.params.id)) return res.status(404).json({ error: 'Gespräch nicht gefunden.' });
    res.json({ ok: true });
  });

  // Chat (Antwort wird als Server-Sent Events gestreamt)
  api.post('/chat', async (req, res) => {
    const controller = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) controller.abort();
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const emit = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await chat.sendMessage({
        conversationId: req.body?.conversationId || null,
        text: req.body?.text,
        viaVoice: Boolean(req.body?.viaVoice),
        signal: controller.signal,
        emit,
      });
    } catch (err) {
      if (!(err?.code === 'aborted')) log.error?.(`[Chat] ${err.code || ''} ${err.message}`);
      emit('error', errorPayload(err));
    } finally {
      finished = true;
      emit('end', {});
      res.end();
    }
  });

  // Sprachausgabe: Text → WAV-Audio
  api.post('/tts', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const audio = await tts.synthesize(req.body?.text, {
        voice: req.body?.voice || settings.get('voice.name'),
        signal: controller.signal,
      });
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      res.end(audio);
    } catch (err) {
      if (controller.signal.aborted) return;
      const payload = errorPayload(err);
      log.warn?.(`[Stimme] ${payload.message}`);
      res.status(err.status && err.status < 500 && !err.code ? err.status : 502).json({ error: payload.message, code: payload.code });
    }
  });

  // Gedächtnis
  api.get('/memories', (req, res) => res.json({ memories: memory.list({ query: req.query.q }) }));
  api.post('/memories', (req, res) => {
    const created = memory.add({ ...req.body, source: 'manual' });
    res.status(201).json({ memory: created });
  });
  api.patch('/memories/:id', (req, res) => {
    const updated = memory.update(asId(req.params.id), req.body || {});
    if (!updated) return res.status(404).json({ error: 'Erinnerung nicht gefunden.' });
    res.json({ memory: updated });
  });
  api.delete('/memories/:id', (req, res) => {
    if (!memory.remove(asId(req.params.id))) return res.status(404).json({ error: 'Erinnerung nicht gefunden.' });
    res.json({ ok: true });
  });

  // Geräte (angemeldete Sitzungen)
  api.get('/devices', (req, res) => res.json({ devices: auth.listDevices(req.session.token_hash) }));
  api.delete('/devices/:id', (req, res) => {
    if (!auth.revokeDevice(req.params.id)) return res.status(404).json({ error: 'Gerät nicht gefunden.' });
    res.json({ ok: true });
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannter API-Pfad.' }));

  // Oberfläche
  app.use(express.static(path.join(ROOT_DIR, 'public'), { index: 'index.html', maxAge: 0 }));

  // Fehlerbehandlung
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error?.('[Server]', err);
    res.status(status).json({ error: status >= 500 ? 'Interner Serverfehler.' : err.message });
  });

  return { app, db, ai, settings, chat, memory, conversations };
}
