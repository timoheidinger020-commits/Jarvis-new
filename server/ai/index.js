// Zentrale KI-Schnittstelle. Der Rest von JARVIS spricht nur mit diesem
// Modul – welcher Anbieter dahintersteckt, ist austauschbar.
import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';
import { AIError } from './errors.js';

const FACTORIES = {
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  gemini: createGeminiProvider,
};

export function createAI(aiConfig, { sleep = defaultSleep } = {}) {
  const providers = {};
  for (const [id, factory] of Object.entries(FACTORIES)) {
    providers[id] = factory(aiConfig.providers[id], { timeoutMs: aiConfig.timeoutMs });
  }

  function get(id) {
    const provider = providers[id];
    if (!provider) throw new AIError('unknown_provider', `Unbekannter KI-Anbieter "${id}".`);
    if (!provider.configured) {
      throw new AIError('not_configured', `Für ${provider.label} ist noch kein API-Schlüssel in der .env-Datei eingetragen.`, { provider: id });
    }
    return provider;
  }

  /**
   * Erzeugt eine Antwort mit automatischen Wiederholungsversuchen bei
   * vorübergehenden Fehlern (Netzwerk, Überlastung). Bereits gestreamter
   * Text wird nie doppelt gesendet.
   */
  async function generate(providerId, opts) {
    const provider = get(providerId);
    let attempt = 0;
    for (;;) {
      try {
        const result = await provider.stream(opts);
        return { ...result, provider: provider.id };
      } catch (err) {
        const retryable = err instanceof AIError && err.retryable;
        if (!retryable || attempt >= aiConfig.maxRetries || opts.signal?.aborted) throw err;
        attempt++;
        opts.onRetry?.(attempt, err);
        await sleep(1000 * 2 ** (attempt - 1), opts.signal);
      }
    }
  }

  /** Einfache Komplettantwort ohne Streaming an den Benutzer. */
  async function complete(providerId, { system, prompt, maxTokens = 4000, effort = 'low', signal }) {
    const result = await generate(providerId, {
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
      effort,
      signal,
    });
    return result.text;
  }

  function list() {
    return Object.values(providers).map((p) => ({ id: p.id, label: p.label, model: p.model, configured: p.configured }));
  }

  return { get, generate, complete, list };
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
