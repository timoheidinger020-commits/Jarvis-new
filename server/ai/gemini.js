// Anbieter: Google Gemini (REST API, Streaming).
import { AIError } from './errors.js';
import { abortOrNetwork, fetchStream, readSSE } from './sse.js';

export function createGeminiProvider(cfg, { timeoutMs }) {
  return {
    id: 'gemini',
    label: 'Google Gemini',
    model: cfg.model,
    configured: Boolean(cfg.apiKey),

    async stream({ system, messages, maxTokens = 16000, signal, onText, effort }) {
      if (!cfg.apiKey) throw new AIError('not_configured', 'Für Gemini ist kein API-Schlüssel eingetragen.', { provider: 'gemini' });

      const url = `${cfg.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
      const res = await fetchStream('gemini', url, {
        headers: { 'x-goog-api-key': cfg.apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: maxTokens,
            // Hintergrundaufgaben (Gedächtnis, Zusammenfassung) brauchen
            // wenig Denkzeit – das macht sie deutlich schneller.
            ...(effort === 'low' && /^gemini-3/.test(cfg.model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        },
        signal,
        timeoutMs,
      });

      let text = '';
      let stopReason = 'end_turn';
      try {
        for await (const data of readSSE(res.body)) {
          const json = JSON.parse(data);
          if (json.error) throw new AIError('server', `Gemini-Fehler: ${json.error.message}`, { provider: 'gemini' });
          const candidate = json.candidates?.[0];
          for (const part of candidate?.content?.parts || []) {
            if (part.text && !part.thought) {
              text += part.text;
              onText?.(part.text);
            }
          }
          if (candidate?.finishReason === 'MAX_TOKENS') stopReason = 'max_tokens';
          else if (candidate?.finishReason === 'SAFETY') stopReason = 'refusal';
        }
      } catch (err) {
        const mapped = abortOrNetwork('gemini', err, signal);
        if (text) mapped.retryable = false;
        mapped.partialText = text;
        throw mapped;
      }
      return { text, stopReason, model: cfg.model };
    },
  };
}
