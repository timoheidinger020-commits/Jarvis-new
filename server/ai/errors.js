// Einheitliche Fehler für alle KI-Anbieter, mit verständlicher deutscher Meldung.

export class AIError extends Error {
  /**
   * @param {string} code  maschinenlesbarer Code (z. B. 'auth', 'rate_limit')
   * @param {string} userMessage  Meldung für den Benutzer (Deutsch)
   * @param {object} [opts]
   */
  constructor(code, userMessage, { retryable = false, status, cause, provider } = {}) {
    super(userMessage, { cause });
    this.name = 'AIError';
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.status = status;
    this.provider = provider;
  }
}

const PROVIDER_NAMES = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini' };

/** Wandelt einen HTTP-Status in einen verständlichen AIError um. */
export function errorFromStatus(provider, status, detail = '') {
  const name = PROVIDER_NAMES[provider] || provider;
  const short = detail ? ` (Details: ${String(detail).slice(0, 300)})` : '';
  if (status === 400) {
    return new AIError('bad_request', `${name} hat die Anfrage abgelehnt. Eventuell ist der Modellname falsch eingestellt.${short}`, { status, provider });
  }
  if (status === 401 || status === 403) {
    return new AIError('auth', `Der API-Schlüssel für ${name} ist ungültig oder hat keine Berechtigung. Bitte prüfe ihn in der .env-Datei.${short}`, { status, provider });
  }
  if (status === 402) {
    return new AIError('billing', `Bei ${name} ist kein Guthaben mehr vorhanden bzw. die Zahlung fehlt.${short}`, { status, provider });
  }
  if (status === 404) {
    return new AIError('not_found', `${name} kennt das eingestellte Modell nicht. Bitte prüfe den Modellnamen in der .env-Datei.${short}`, { status, provider });
  }
  if (status === 408) {
    return new AIError('timeout', `${name} hat zu lange nicht geantwortet.`, { status, provider, retryable: true });
  }
  if (status === 429) {
    return new AIError('rate_limit', `${name} meldet zu viele Anfragen oder ein ausgeschöpftes Kontingent. Bitte kurz warten.${short}`, { status, provider, retryable: true });
  }
  if (status >= 500) {
    return new AIError('server', `${name} hat gerade technische Probleme (Fehler ${status}). Bitte gleich nochmal versuchen.`, { status, provider, retryable: true });
  }
  return new AIError('unknown', `Unerwartete Antwort von ${name} (Status ${status}).${short}`, { status, provider });
}

export function networkError(provider, cause) {
  const name = PROVIDER_NAMES[provider] || provider;
  if (cause?.name === 'TimeoutError') {
    return new AIError('timeout', `${name} hat zu lange nicht geantwortet (Zeitüberschreitung).`, { provider, retryable: true, cause });
  }
  return new AIError('network', `Keine Verbindung zu ${name}. Bitte prüfe deine Internetverbindung.`, { provider, retryable: true, cause });
}
