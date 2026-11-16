import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAI } from '../server/ai/index.js';
import { anthropicEvents, jsonError, sse, startMockProviderServer } from './helpers.js';

let mock;
let behaviour = () => {};

before(async () => {
  mock = await startMockProviderServer((req, res, n) => behaviour(req, res, n));
});
after(() => mock.close());

function makeAI(overrides = {}) {
  return createAI(
    {
      timeoutMs: 5000,
      maxRetries: 2,
      providers: {
        anthropic: { apiKey: 'test-key', model: 'claude-opus-5-5', effort: 'medium', baseUrl: mock.url },
        openai: { apiKey: 'test-key', model: 'gpt-5', baseUrl: `${mock.url}/v1` },
        gemini: { apiKey: 'test-key', model: 'gemini-2.5-flash', baseUrl: `${mock.url}/v1beta` },
        ...overrides,
      },
    },
    { sleep: async () => {} },
  );
}

describe('Anthropic', () => {
  test('streamt Text und sendet die richtigen Parameter', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) => sse(res, anthropicEvents(['Guten ', 'Abend', '.']));
    const ai = makeAI();
    const parts = [];
    const result = await ai.generate('anthropic', {
      system: 'Du bist JARVIS.',
      messages: [{ role: 'user', content: 'Hallo' }],
      onText: (t) => parts.push(t),
    });
    assert.equal(result.text, 'Guten Abend.');
    assert.deepEqual(parts, ['Guten ', 'Abend', '.']);
    assert.equal(result.provider, 'anthropic');

    const req = mock.requests[0];
    assert.equal(req.url.split('?')[0], '/v1/messages');
    assert.ok(req.headers['x-api-key'] === 'test-key' || req.headers.authorization === 'Bearer test-key');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.stream, true);
    assert.deepEqual(req.body.thinking, { type: 'adaptive' });
    assert.deepEqual(req.body.output_config, { effort: 'medium' });
    assert.equal(req.body.fallbacks, 'default');
    assert.equal(req.body.system, 'Du bist JARVIS.');
    assert.equal(req.body.temperature, undefined);
  });

  test('ungültiger Schlüssel ergibt verständlichen Fehler ohne Wiederholung', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) => jsonError(res, 401, 'invalid x-api-key');
    const ai = makeAI();
    await assert.rejects(
      ai.generate('anthropic', { system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (err) => err.code === 'auth' && /API-Schlüssel/.test(err.userMessage),
    );
    assert.equal(mock.requests.length, 1);
  });

  test('Serverfehler wird automatisch wiederholt', async () => {
    mock.requests.length = 0;
    behaviour = (req, res, n) => (n === 1 ? jsonError(res, 529, 'overloaded') : sse(res, anthropicEvents(['Ok'])));
    const ai = makeAI();
    const retries = [];
    const result = await ai.generate('anthropic', {
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      onRetry: (a) => retries.push(a),
    });
    assert.equal(result.text, 'Ok');
    assert.deepEqual(retries, [1]);
    assert.equal(mock.requests.length, 2);
  });

  test('Ablehnung (refusal) wird kenntlich gemacht', async () => {
    behaviour = (req, res) => sse(res, anthropicEvents([], { stopReason: 'refusal' }));
    const result = await makeAI().generate('anthropic', { system: 's', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(result.stopReason, 'refusal');
    assert.match(result.text, /Sicherheitsgründen/);
  });

  test('älteres Modell bekommt keine neuen Parameter', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) => sse(res, anthropicEvents(['Hi'], { model: 'claude-haiku-4-5' }));
    const ai = makeAI({ anthropic: { apiKey: 'k', model: 'claude-haiku-4-5', baseUrl: mock.url } });
    await ai.generate('anthropic', { system: 's', messages: [{ role: 'user', content: 'x' }] });
    const body = mock.requests[0].body;
    assert.equal(body.thinking, undefined);
    assert.equal(body.fallbacks, undefined);
    assert.equal(body.output_config, undefined);
  });
});

describe('OpenAI', () => {
  test('streamt Text', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) =>
      sse(res, [
        [null, { model: 'gpt-5', choices: [{ delta: { content: 'Hallo ' } }] }],
        [null, { choices: [{ delta: { content: 'Welt' }, finish_reason: 'stop' }] }],
        [null, '[DONE]'],
      ]);
    const result = await makeAI().generate('openai', { system: 'Sys', messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(result.text, 'Hallo Welt');
    const req = mock.requests[0];
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.deepEqual(req.body.messages[0], { role: 'system', content: 'Sys' });
  });

  test('Ratenlimit wird wiederholt und dann gemeldet', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) => jsonError(res, 429, 'quota');
    await assert.rejects(
      makeAI().generate('openai', { system: 's', messages: [{ role: 'user', content: 'x' }] }),
      (err) => err.code === 'rate_limit',
    );
    assert.equal(mock.requests.length, 3); // 1 Versuch + 2 Wiederholungen
  });
});

describe('Gemini', () => {
  test('streamt Text und wandelt Rollen um', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) =>
      sse(res, [
        [null, { candidates: [{ content: { parts: [{ text: 'Servus ' }] } }] }],
        [null, { candidates: [{ content: { parts: [{ text: 'Timo' }] }, finishReason: 'STOP' }] }],
      ]);
    const result = await makeAI().generate('gemini', {
      system: 'Sys',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    assert.equal(result.text, 'Servus Timo');
    const req = mock.requests[0];
    assert.equal(req.url, '/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    assert.deepEqual(req.body.contents.map((c) => c.role), ['user', 'model', 'user']);
    assert.equal(req.body.systemInstruction.parts[0].text, 'Sys');
  });

  test('Hintergrundaufgaben nutzen geringe Denktiefe (nur Gemini 3)', async () => {
    mock.requests.length = 0;
    behaviour = (req, res) => sse(res, [[null, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]]);
    const ai = makeAI({ gemini: { apiKey: 'k', model: 'gemini-3.5-flash', baseUrl: mock.url } });
    await ai.complete('gemini', { system: 's', prompt: 'p', effort: 'low' });
    await ai.generate('gemini', { system: 's', messages: [{ role: 'user', content: 'x' }] });
    assert.deepEqual(mock.requests[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
    assert.equal(mock.requests[1].body.generationConfig.thinkingConfig, undefined);
  });
});

test('nicht eingerichteter Anbieter meldet fehlenden Schlüssel', async () => {
  const ai = makeAI({ openai: { apiKey: '', model: 'gpt-5', baseUrl: mock.url } });
  await assert.rejects(ai.generate('openai', { system: 's', messages: [] }), (err) => err.code === 'not_configured');
});

test('Abbruch durch den Benutzer', async () => {
  behaviour = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: message_start\ndata: ${JSON.stringify(anthropicEvents([])[0][1])}\n\n`);
    // Server antwortet absichtlich nicht weiter
  };
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    makeAI().generate('anthropic', { system: 's', messages: [{ role: 'user', content: 'x' }], signal: controller.signal }),
    (err) => err.code === 'aborted',
  );
});
