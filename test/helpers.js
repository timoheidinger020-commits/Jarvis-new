// Test-Hilfen: ein lokaler Server, der die Streaming-Formate der KI-Anbieter nachbildet.
import http from 'node:http';

export function startMockProviderServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const entry = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(entry);
    await handler(entry, res, requests.length);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

export function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [event, data] of events) {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
}

export function anthropicEvents(chunks, { model = 'claude-opus-5-5', stopReason = 'end_turn' } = {}) {
  return [
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map((text) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
}

export function jsonError(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'error', message } }));
}

/** Ein KI-Ersatz für API-Tests: antwortet nach einem Drehbuch. */
export function fakeAI({ reply = 'Sehr gern.', extraction = '{"add":[],"update":[],"deactivate":[]}' } = {}) {
  const calls = [];
  const ai = {
    calls,
    list: () => [
      { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-opus-5-5', configured: true },
      { id: 'openai', label: 'OpenAI', model: 'gpt-5', configured: false },
      { id: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash', configured: true },
    ],
    async generate(providerId, opts) {
      calls.push({ type: 'generate', providerId, opts });
      const text = typeof reply === 'function' ? reply(opts) : reply;
      for (const part of text.match(/.{1,5}/gs) || []) opts.onText?.(part);
      return { text, stopReason: 'end_turn', model: 'fake-model', provider: providerId };
    },
    async complete(providerId, opts) {
      calls.push({ type: 'complete', providerId, opts });
      if (opts.system.includes('Du bist das Gedächtnis-Modul')) return typeof extraction === 'function' ? extraction(opts) : extraction;
      return 'Zusammenfassung des Gesprächs.';
    },
  };
  return ai;
}
