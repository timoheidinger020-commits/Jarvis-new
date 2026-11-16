import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';
import { toModelMessages } from '../server/chat/context.js';
import { openDatabase } from '../server/db.js';
import { createTTS, toWav } from '../server/voice/tts.js';
import { AIError } from '../server/ai/errors.js';
import { fakeAI, jsonError, startMockProviderServer } from './helpers.js';

test('rohes PCM bekommt einen WAV-Kopf, WAV bleibt unverändert', () => {
  const pcm = Buffer.alloc(480);
  const wav = toWav(pcm, 'audio/L16;codec=pcm;rate=24000');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.length, 44 + 480);
  assert.equal(toWav(wav, 'audio/wav'), wav);
});

test('gesprochene Nachrichten werden für die KI markiert', () => {
  const out = toModelMessages([{ id: 1, role: 'user', content: 'Hallo', via_voice: 1, created_at: '2026-11-16T18:00:00Z' }]);
  assert.match(out[0].content, /· gesprochen\] Hallo$/);
});

test('Gemini-TTS: Anfrage und Fehlerbehandlung', async () => {
  let mode = 'ok';
  const mock = await startMockProviderServer((req, res) => {
    if (mode === 'fail') return jsonError(res, 429, 'quota');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: Buffer.alloc(100).toString('base64') } }] } }] }));
  });
  try {
    const tts = createTTS({ apiKey: 'k', baseUrl: mock.url }, { model: 'gemini-3.8-flash-tts' });
    const wav = await tts.synthesize('Guten Tag.', { voice: 'Algenib' });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    const req = mock.requests[0];
    assert.equal(req.url, '/models/gemini-3.8-flash-tts:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'k');
    assert.deepEqual(req.body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(req.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Algenib');
    assert.equal(req.body.contents[0].parts[0].text, 'Guten Tag.'); // ohne Regieanweisung
    mode = 'fail';
    await assert.rejects(tts.synthesize('x'), (err) => err.code === 'rate_limit');
    await assert.rejects(createTTS({ apiKey: '' , baseUrl: mock.url }, { model: 'm' }).synthesize('x'), (err) => err.code === 'not_configured');
  } finally {
    await mock.close();
  }
});

// --- API ---
let server, base, cookie;
before(async () => {
  const fakeTTS = {
    configured: true,
    async synthesize(text, { voice }) {
      if (text === 'kaputt') throw new AIError('rate_limit', 'Kontingent erschöpft.', { retryable: true });
      return toWav(Buffer.from(`${voice}:${text}`), 'audio/L16;rate=24000');
    },
  };
  const ctx = createApp(
    { password: 'passwort123', ai: { defaultProvider: 'anthropic', providers: {} }, memory: { autoExtract: false, maxInPrompt: 60 }, context: { maxChars: 5000 } },
    { ai: fakeAI(), tts: fakeTTS, db: openDatabase(':memory:'), log: { warn() {}, error() {} } },
  );
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'passwort123' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(() => new Promise((r) => server.close(r)));

const post = (path, body, method = 'POST') =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

test('API: Sprachausgabe liefert WAV mit gewählter Stimme', async () => {
  await post('/api/settings', { voiceName: 'Orus' }, 'PATCH');
  const res = await post('/api/tts', { text: 'Hallo Timo' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  assert.match(buf.subarray(44).toString(), /^Orus:Hallo Timo$/);
});

test('API: Fehler der Stimme wird verständlich gemeldet', async () => {
  const res = await post('/api/tts', { text: 'kaputt' });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'Kontingent erschöpft.');
});

test('API: Stimm-Einstellungen werden geprüft', async () => {
  assert.equal((await post('/api/settings', { voiceName: 'Gibtsnicht' }, 'PATCH')).status, 400);
  assert.equal((await post('/api/settings', { voiceEngine: 'quatsch' }, 'PATCH')).status, 400);
  const ok = await post('/api/settings', { voiceEngine: 'browser' }, 'PATCH');
  assert.equal((await ok.json()).settings['voice.engine'], 'browser');
  const overview = await (await fetch(`${base}/api/overview`, { headers: { cookie } })).json();
  assert.equal(overview.voice.geminiAvailable, true);
  assert.ok(overview.voice.voices.some((v) => v.id === 'Charon'));
  assert.equal(overview.features.voice, true);
});

test('API: Sprachnachricht wird als gesprochen gespeichert', async () => {
  const res = await post('/api/chat', { text: 'Wie spät ist es?', viaVoice: true });
  const text = await res.text();
  const id = JSON.parse(text.match(/^event: start\ndata: (.*)$/m)[1]).conversation.id;
  const conv = await (await fetch(`${base}/api/conversations/${id}`, { headers: { cookie } })).json();
  assert.equal(conv.messages[0].via_voice, 1);
});
