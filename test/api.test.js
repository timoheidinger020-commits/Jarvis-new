import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { fakeAI } from './helpers.js';

const PASSWORD = 'richtig-geheim';
let server;
let base;
let ai;
let ctx;
let cookie = '';

const silentLog = { warn() {}, error() {} };

function testConfig() {
  return {
    password: PASSWORD,
    dbPath: ':memory:',
    ai: { defaultProvider: 'anthropic', providers: {} },
    memory: { autoExtract: true, maxInPrompt: 60 },
    context: { maxChars: 600 },
  };
}

before(async () => {
  ai = fakeAI({
    reply: (opts) => `Antwort auf: ${opts.messages.at(-1).content.replace(/^\[[^\]]+\] /, '')}`,
    extraction: (opts) =>
      opts.prompt.includes('Ich heiße Timo')
        ? '{"add":[{"content":"Der Benutzer heißt Timo.","category":"person","importance":3}],"update":[],"deactivate":[]}'
        : '{"add":[],"update":[],"deactivate":[]}',
  });
  ctx = createApp(testConfig(), { ai, db: openDatabase(':memory:'), log: silentLog });
  await new Promise((resolve) => {
    server = ctx.app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

async function call(path, { method = 'GET', body, withCookie = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(withCookie && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function parseSSE(text) {
  return text.trim().split('\n\n').map((block) => {
    const event = block.match(/^event: (.*)$/m)[1];
    const data = JSON.parse(block.match(/^data: (.*)$/m)[1]);
    return { event, data };
  });
}

test('ohne Anmeldung ist die API gesperrt', async () => {
  assert.equal((await call('/api/conversations', { withCookie: false })).status, 401);
  assert.equal((await call('/api/memories', { withCookie: false })).status, 401);
  const status = await call('/api/status', { withCookie: false });
  assert.equal(status.data.authenticated, false);
});

test('falsches Passwort wird abgelehnt', async () => {
  const res = await call('/api/auth/login', { method: 'POST', body: { password: 'falsch' }, withCookie: false });
  assert.equal(res.status, 401);
});

test('Anmeldung setzt ein sicheres Sitzungs-Cookie', async () => {
  const res = await call('/api/auth/login', { method: 'POST', body: { password: PASSWORD, deviceName: 'Test-PC' }, withCookie: false });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];
  assert.equal((await call('/api/status')).data.authenticated, true);
});

test('Sicherheits-Header und JSON-Pflicht', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  const form = await fetch(`${base}/api/memories`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(form.status, 415);
});

test('Chat: Antwort wird gestreamt, gespeichert und Gedächtnis aktualisiert', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: 'Hallo, Ich heiße Timo.' }),
  });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = parseSSE(await res.text());
  const names = events.map((e) => e.event);
  assert.equal(names[0], 'start');
  assert.ok(names.includes('token'));
  assert.ok(names.includes('done'));
  assert.ok(names.includes('memory'));
  assert.equal(names.at(-1), 'end');

  const tokens = events.filter((e) => e.event === 'token').map((e) => e.data.text).join('');
  assert.equal(tokens, 'Antwort auf: Hallo, Ich heiße Timo.');

  const conversationId = events[0].data.conversation.id;
  const conv = await call(`/api/conversations/${conversationId}`);
  assert.equal(conv.data.conversation.title, 'Hallo, Ich heiße Timo.');
  assert.deepEqual(conv.data.messages.map((m) => m.role), ['user', 'assistant']);

  const memories = await call('/api/memories');
  assert.equal(memories.data.memories.length, 1);
  assert.equal(memories.data.memories[0].content, 'Der Benutzer heißt Timo.');
  assert.equal(memories.data.memories[0].source, 'auto');
});

test('Chat: Erinnerungen und Gesprächsverlauf gehen an die KI', async () => {
  ai.calls.length = 0;
  const list = await call('/api/conversations');
  const conversationId = list.data.conversations[0].id;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, text: 'Wie heiße ich?' }),
  });
  await res.text();
  const gen = ai.calls.find((c) => c.type === 'generate');
  assert.match(gen.opts.system, /Der Benutzer heißt Timo\./);
  assert.match(gen.opts.system, /Du bist JARVIS/);
  assert.equal(gen.opts.messages.length, 3);
  assert.match(gen.opts.messages[2].content, /Wie heiße ich\?$/);
});

test('Lange Gespräche werden zusammengefasst', async () => {
  const list = await call('/api/conversations');
  const conversationId = list.data.conversations[0].id;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ conversationId, text: `Langer Beitrag ${i}: ${'bla '.repeat(40)}` }),
    });
    await res.text();
  }
  await ctx.chat.summarizeIfNeeded(conversationId);
  const conv = ctx.conversations.get(conversationId);
  assert.equal(conv.summary, 'Zusammenfassung des Gesprächs.');
  assert.ok(conv.summarized_until > 0);

  ai.calls.length = 0;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ conversationId, text: 'Und jetzt?' }),
  });
  await res.text();
  const gen = ai.calls.find((c) => c.type === 'generate');
  assert.match(gen.opts.system, /Zusammenfassung des bisherigen/);
  const sentChars = gen.opts.messages.reduce((n, m) => n + m.content.length, 0);
  assert.ok(sentChars < 1200, `zu viel Kontext gesendet: ${sentChars}`);
});

test('Chat: leere Nachricht und unbekanntes Gespräch ergeben verständliche Fehler', async () => {
  const empty = await call('/api/chat', { method: 'POST', body: { text: '   ' } });
  const ev = parseSSE(empty.data);
  assert.equal(ev.find((e) => e.event === 'error').data.message, 'Die Nachricht ist leer.');
  const missing = await call('/api/chat', { method: 'POST', body: { conversationId: 'gibt-es-nicht', text: 'Hi' } });
  assert.equal(parseSSE(missing.data).find((e) => e.event === 'error').data.message, 'Gespräch nicht gefunden.');
});

test('Chat: KI-Fehler wird verständlich gemeldet', async () => {
  const original = ai.generate;
  const { AIError } = await import('../server/ai/errors.js');
  ai.generate = async () => { throw new AIError('auth', 'Der API-Schlüssel ist ungültig.'); };
  const res = await call('/api/chat', { method: 'POST', body: { text: 'Hallo' } });
  ai.generate = original;
  const error = parseSSE(res.data).find((e) => e.event === 'error');
  assert.deepEqual(error.data, { code: 'auth', message: 'Der API-Schlüssel ist ungültig.' });
});

test('Gedächtnis: anlegen, suchen, bearbeiten, löschen', async () => {
  const created = await call('/api/memories', { method: 'POST', body: { content: 'Ich arbeite an Projekt JARVIS.', category: 'projekt' } });
  assert.equal(created.status, 201);
  const id = created.data.memory.id;
  assert.equal(created.data.memory.source, 'manual');
  assert.equal((await call('/api/memories?q=jarvis')).data.memories.length, 1);
  const patched = await call(`/api/memories/${id}`, { method: 'PATCH', body: { enabled: false, importance: 3 } });
  assert.equal(patched.data.memory.enabled, false);
  assert.equal(patched.data.memory.importance, 3);
  assert.equal((await call(`/api/memories/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/memories/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/memories/abc', { method: 'PATCH', body: {} })).status, 400);
});

test('Einstellungen: Anbieter ohne Schlüssel kann nicht gewählt werden', async () => {
  assert.equal((await call('/api/settings', { method: 'PATCH', body: { aiProvider: 'openai' } })).status, 400);
  const ok = await call('/api/settings', { method: 'PATCH', body: { aiProvider: 'gemini' } });
  assert.equal(ok.data.settings['ai.provider'], 'gemini');
  await call('/api/settings', { method: 'PATCH', body: { aiProvider: 'anthropic' } });
});

test('Geräte: Liste und Abmelden anderer Geräte', async () => {
  const second = await call('/api/auth/login', { method: 'POST', body: { password: PASSWORD, deviceName: 'Handy' }, withCookie: false });
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  const { data } = await call('/api/devices');
  assert.equal(data.devices.length, 2);
  const phone = data.devices.find((d) => d.name === 'Handy');
  assert.equal(phone.current, false);
  await call(`/api/devices/${phone.id}`, { method: 'DELETE' });
  const res = await fetch(`${base}/api/conversations`, { headers: { cookie: secondCookie } });
  assert.equal(res.status, 401);
});

test('Gespräch löschen', async () => {
  const { data } = await call('/api/conversations');
  const id = data.conversations[0].id;
  assert.equal((await call(`/api/conversations/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/conversations/${id}`)).status, 404);
  // Erinnerungen bleiben erhalten
  assert.ok((await call('/api/memories')).data.memories.length >= 1);
});

test('Abmelden beendet die Sitzung', async () => {
  await call('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await call('/api/conversations')).status, 401);
});
