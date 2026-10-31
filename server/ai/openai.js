// Anbieter: OpenAI (Chat Completions API, Streaming).
import { AIError } from './errors.js';
import { abortOrNetwork, fetchStream, readSSE } from './sse.js';

export function createOpenAIProvider(cfg, { timeoutMs }) {
  return {
    id: 'openai',
    label: 'OpenAI',
    model: cfg.model,
    configured: Boolean(cfg.apiKey),

    async stream({ system, messages, maxTokens = 16000, signal, onText }) {
      if (!cfg.apiKey) throw new AIError('not_configured', 'Für OpenAI ist kein API-Schlüssel eingetragen.', { provider: 'openai' });

      const res = await fetchStream('openai', `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        headers: { authorization: `Bearer ${cfg.apiKey}` },
        body: {
          model: cfg.model,
          stream: true,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        },
        signal,
        timeoutMs,
      });

      let text = '';
      let stopReason = 'end_turn';
      let model = cfg.model;
      try {
        for await (const data of readSSE(res.body)) {
          if (data === '[DONE]') break;
          const json = JSON.parse(data);
          if (json.error) throw new AIError('server', `OpenAI-Fehler: ${json.error.message}`, { provider: 'openai' });
          if (json.model) model = json.model;
          const choice = json.choices?.[0];
          const delta = choice?.delta?.content;
          if (delta) {
            text += delta;
            onText?.(delta);
          }
          if (choice?.finish_reason) stopReason = choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason;
        }
      } catch (err) {
        const mapped = abortOrNetwork('openai', err, signal);
        if (text) mapped.retryable = false;
        mapped.partialText = text;
        throw mapped;
      }
      return { text, stopReason, model };
    },
  };
}
