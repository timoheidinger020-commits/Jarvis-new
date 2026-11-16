// Ablauf einer Nachricht: Kontext bauen → KI streamen → speichern →
// Gedächtnis aktualisieren → ältere Teile zusammenfassen.
import { AIError } from '../ai/errors.js';
import { splitByBudget, toModelMessages } from './context.js';
import { buildSystemPrompt, SUMMARY_SYSTEM } from './prompts.js';

const DEFAULT_TITLE = 'Neues Gespräch';
const MAX_USER_CHARS = 20000;

export function createChatService({ ai, conversations, memory, extractMemories, settings, config, log = console }) {
  const providerId = () => settings.get('ai.provider');

  async function sendMessage({ conversationId, text, viaVoice = false, signal, emit }) {
    const userText = String(text ?? '').trim();
    if (!userText) throw Object.assign(new Error('Die Nachricht ist leer.'), { status: 400 });
    if (userText.length > MAX_USER_CHARS) {
      throw Object.assign(new Error(`Die Nachricht ist zu lang (max. ${MAX_USER_CHARS} Zeichen).`), { status: 400 });
    }

    let conversation = conversationId ? conversations.get(conversationId) : null;
    if (conversationId && !conversation) throw Object.assign(new Error('Gespräch nicht gefunden.'), { status: 404 });
    if (!conversation) conversation = conversations.create();

    const userMessage = conversations.addMessage(conversation.id, { role: 'user', content: userText, viaVoice });
    if (conversation.title === DEFAULT_TITLE) {
      conversation = conversations.rename(conversation.id, makeTitle(userText));
    }

    const rows = conversations.messages(conversation.id, { afterId: conversation.summarized_until });
    const { recent } = splitByBudget(rows, config.context.maxChars);
    const memories = memory.relevant(userText, config.memory.maxInPrompt);
    const system = buildSystemPrompt({ memories, summary: conversation.summary });

    const pid = providerId();
    emit('start', { conversation, userMessage, provider: pid });

    let result;
    try {
      result = await ai.generate(pid, {
        system,
        messages: toModelMessages(recent),
        maxTokens: 16000,
        signal,
        onText: (t) => emit('token', { text: t }),
        onRetry: (attempt, err) => emit('retry', { attempt, message: err.userMessage }),
      });
    } catch (err) {
      const partial = err.partialText;
      if (partial) {
        const suffix = err.code === 'aborted' ? '\n\n_(abgebrochen)_' : '\n\n_(Antwort unvollständig wegen eines Fehlers)_';
        conversations.addMessage(conversation.id, { role: 'assistant', content: partial + suffix, provider: pid });
      }
      throw err;
    }

    let answer = result.text.trim() || '_(Keine Antwort erhalten.)_';
    if (result.stopReason === 'max_tokens') answer += '\n\n_(Die Antwort wurde wegen der Längenbegrenzung abgeschnitten.)_';
    const assistantMessage = conversations.addMessage(conversation.id, {
      role: 'assistant',
      content: answer,
      provider: result.provider,
      model: result.model,
    });
    emit('done', { assistantMessage });

    // Gedächtnis aktualisieren (Ergebnis wird sofort angezeigt).
    if (config.memory.autoExtract && settings.get('memory.autoExtract')) {
      try {
        const changes = await extractMemories({
          conversationId: conversation.id,
          userText,
          assistantText: answer,
          signal,
        });
        if (changes.length) emit('memory', { changes });
      } catch (err) {
        log.warn?.(`[Gedächtnis] Konnte Erinnerungen nicht aktualisieren: ${err.message}`);
        emit('memory_error', { message: 'Das Gedächtnis konnte diesmal nicht aktualisiert werden.' });
      }
    }

    // Lange Gespräche im Hintergrund verdichten.
    const background = summarizeIfNeeded(conversation.id).catch((err) => {
      log.warn?.(`[Kontext] Zusammenfassung fehlgeschlagen: ${err.message}`);
    });

    return { conversation, userMessage, assistantMessage, background };
  }

  async function summarizeIfNeeded(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation) return false;
    const rows = conversations.messages(conversationId, { afterId: conversation.summarized_until });
    const { overflow } = splitByBudget(rows, config.context.maxChars * 0.6);
    // Erst verdichten, wenn sich genug angesammelt hat.
    const total = rows.reduce((n, r) => n + r.content.length, 0);
    if (!overflow.length || total < config.context.maxChars) return false;

    const transcript = overflow.map((r) => `${r.role === 'user' ? 'BENUTZER' : 'JARVIS'}: ${r.content}`).join('\n\n');
    const prompt = conversation.summary
      ? `Bisherige Zusammenfassung:\n${conversation.summary}\n\nNeuer Gesprächsteil, der ergänzt werden soll:\n${transcript}\n\nErstelle eine aktualisierte Gesamtzusammenfassung.`
      : `Gesprächsverlauf:\n${transcript}\n\nFasse ihn zusammen.`;
    const summary = (await ai.complete(providerId(), { system: SUMMARY_SYSTEM, prompt, maxTokens: 4000, effort: 'low' })).trim();
    if (!summary) return false;
    conversations.setSummary(conversationId, summary, overflow[overflow.length - 1].id);
    return true;
  }

  return { sendMessage, summarizeIfNeeded };
}

function makeTitle(text) {
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
}

export function errorPayload(err) {
  if (err instanceof AIError) return { code: err.code, message: err.userMessage };
  if (err?.status && err.status < 500) return { code: 'invalid', message: err.message };
  return { code: 'internal', message: 'Ein interner Fehler ist aufgetreten. Details stehen im Server-Fenster.' };
}
