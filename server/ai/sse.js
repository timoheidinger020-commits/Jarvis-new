// Liest einen Server-Sent-Events-Stream (fetch-Response) und liefert die
// "data:"-Inhalte einzeln zurück. Genutzt für OpenAI und Gemini.
import { AIError, errorFromStatus, networkError } from './errors.js';

export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}

/** fetch mit Zeitlimit, Abbruch und einheitlicher Fehlerbehandlung. */
export async function fetchStream(provider, url, { headers, body, signal, timeoutMs }) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    throw abortOrNetwork(provider, err, signal);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const json = await res.json();
      detail = json?.error?.message || JSON.stringify(json);
    } catch {
      /* Antwort war kein JSON */
    }
    throw errorFromStatus(provider, res.status, detail);
  }
  return res;
}

export function abortOrNetwork(provider, err, userSignal) {
  if (err instanceof AIError) return err;
  if (userSignal?.aborted) {
    return new AIError('aborted', 'Die Antwort wurde abgebrochen.', { provider, cause: err });
  }
  if (err instanceof SyntaxError) {
    return new AIError('bad_response', 'Die Antwort des KI-Anbieters war fehlerhaft formatiert.', { provider, cause: err, retryable: true });
  }
  return networkError(provider, err);
}
