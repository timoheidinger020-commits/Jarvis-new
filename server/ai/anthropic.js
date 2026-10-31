// Anbieter: Anthropic Claude (offizielles SDK).
import Anthropic from '@anthropic-ai/sdk';
import { AIError, errorFromStatus, networkError } from './errors.js';

// Modelle, die adaptives Denken und die Effort-Einstellung unterstützen.
const ADAPTIVE_MODELS = /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-5)/;
// Modelle, bei denen die serverseitige Ausweichlösung ("fallbacks") verfügbar ist:
// Lehnt das Modell eine Anfrage aus Sicherheitsgründen ab, beantwortet sie
// automatisch ein passendes anderes Claude-Modell.
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5$|sonnet-5-5)/;

export function createAnthropicProvider(cfg, { timeoutMs }) {
  const client = cfg.apiKey
    ? new Anthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl || 'https://api.anthropic.com',
        timeout: timeoutMs,
        maxRetries: 0, // Wiederholungen steuert JARVIS selbst (siehe ai/index.js)
      })
    : null;

  return {
    id: 'anthropic',
    label: 'Anthropic Claude',
    model: cfg.model,
    configured: Boolean(cfg.apiKey),

    /**
     * Streamt eine Antwort.
     * @returns {Promise<{text: string, stopReason: string, model: string}>}
     */
    async stream({ system, messages, maxTokens = 16000, signal, onText, effort }) {
      if (!client) throw new AIError('not_configured', 'Für Anthropic ist kein API-Schlüssel eingetragen.', { provider: 'anthropic' });

      const params = {
        model: cfg.model,
        max_tokens: maxTokens,
        system,
        messages,
        cache_control: { type: 'ephemeral' }, // spart Kosten bei langen Gesprächen
      };
      if (ADAPTIVE_MODELS.test(cfg.model)) {
        params.thinking = { type: 'adaptive' };
        params.output_config = { effort: effort || cfg.effort || 'medium' };
      }
      if (FALLBACK_MODELS.test(cfg.model)) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }

      let text = '';
      try {
        const stream = client.beta.messages.stream(params, { signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text;
            onText?.(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') {
          const notice = '\n\n_(Diese Anfrage wurde vom KI-Modell aus Sicherheitsgründen nicht beantwortet.)_';
          text += notice;
          onText?.(notice);
        }
        return { text, stopReason: final.stop_reason, model: final.model };
      } catch (err) {
        throw mapError(err, text);
      }
    },
  };
}

function mapError(err, partialText) {
  if (err instanceof AIError) return err;
  let mapped;
  if (err instanceof Anthropic.APIUserAbortError) {
    mapped = new AIError('aborted', 'Die Antwort wurde abgebrochen.', { provider: 'anthropic', cause: err });
  } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
    mapped = networkError('anthropic', Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
  } else if (err instanceof Anthropic.APIConnectionError) {
    mapped = networkError('anthropic', err);
  } else if (err instanceof Anthropic.APIError && err.status) {
    mapped = errorFromStatus('anthropic', err.status, err.error?.error?.message || err.message);
  } else {
    mapped = new AIError('unknown', `Unerwarteter Fehler bei Anthropic: ${err.message}`, { provider: 'anthropic', cause: err });
  }
  // Wurde schon Text gesendet, darf nicht automatisch wiederholt werden.
  if (partialText) mapped.retryable = false;
  mapped.partialText = partialText;
  return mapped;
}
