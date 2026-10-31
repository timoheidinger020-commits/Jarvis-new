// Erkennt nach jeder Antwort, ob etwas langfristig Wichtiges gesagt wurde,
// und aktualisiert das Gedächtnis. Kurzlebige Aussagen werden ignoriert.
import { CATEGORIES } from './store.js';

const SYSTEM = `Du bist das Gedächtnis-Modul des persönlichen Assistenten JARVIS.
Deine einzige Aufgabe: entscheiden, welche Informationen aus dem letzten Gesprächsaustausch langfristig über den Benutzer gespeichert werden sollen.

Speichere NUR, was auch in Wochen oder Monaten noch nützlich ist, z. B.:
- persönliche Fakten (Name, Wohnort, Beruf, Familie, Geburtstag)
- Vorlieben und Abneigungen, bevorzugte Arbeitsweisen und Einstellungen
- laufende, langfristige Projekte und Ziele
- wiederkehrende Aufgaben, wichtige Entscheidungen
- alles, worum der Benutzer ausdrücklich bittet ("merk dir ...")

Speichere NICHT:
- Smalltalk, einmalige Fragen, allgemeines Wissen, Antworten von JARVIS
- kurzfristige Zustände ("ich bin gerade müde"), außer der Benutzer bittet darum
- Passwörter, PINs, Kontonummern oder andere Zugangsdaten – niemals
- Dinge, die bereits gespeichert sind (dann höchstens aktualisieren)

Formuliere jede Erinnerung als kurzen, eigenständigen Satz in der dritten Person auf Deutsch, z. B. "Der Benutzer heißt Timo." oder "Der Benutzer bevorzugt kurze Antworten."

Wenn eine neue Aussage einer gespeicherten Erinnerung widerspricht oder sie präzisiert, aktualisiere diese (update) statt eine neue anzulegen.
Wenn der Benutzer ausdrücklich möchte, dass etwas vergessen wird, deaktiviere die passende Erinnerung (deactivate).

Kategorien: ${CATEGORIES.join(', ')}
Wichtigkeit: 1 = nebensächlich, 2 = normal, 3 = sehr wichtig

Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format, ohne weiteren Text:
{"add":[{"content":"...","category":"...","importance":2}],"update":[{"id":123,"content":"..."}],"deactivate":[123]}
Wenn nichts zu tun ist: {"add":[],"update":[],"deactivate":[]}`;

export function buildExtractionPrompt({ userText, assistantText, memories }) {
  const known = memories.length
    ? memories.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join('\n')
    : '(noch keine)';
  return `Bereits gespeicherte Erinnerungen:
${known}

Letzter Austausch:
BENUTZER: ${userText}

JARVIS: ${assistantText.slice(0, 4000)}`;
}

/** Holt das JSON-Objekt aus der Modellantwort, auch wenn Text drumherum steht. */
export function parseExtraction(raw) {
  const text = String(raw || '').replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1));
    return {
      add: Array.isArray(json.add) ? json.add : [],
      update: Array.isArray(json.update) ? json.update : [],
      deactivate: Array.isArray(json.deactivate) ? json.deactivate : [],
    };
  } catch {
    return null;
  }
}

const normalizeText = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Wendet das Ergebnis auf den Speicher an und gibt die Änderungen zurück. */
export function applyExtraction(store, result, { conversationId, knownIds }) {
  const changes = [];
  if (!result) return changes;

  const existing = new Set(store.list().map((m) => normalizeText(m.content)));

  for (const item of result.add.slice(0, 5)) {
    if (!item || typeof item.content !== 'string' || !item.content.trim()) continue;
    if (looksSecret(item.content)) continue;
    const key = normalizeText(item.content);
    if (existing.has(key)) continue;
    existing.add(key);
    const memory = store.add({ ...item, source: 'auto', conversationId });
    changes.push({ type: 'added', memory });
  }

  for (const item of result.update.slice(0, 5)) {
    const id = Number(item?.id);
    if (!knownIds.has(id) || typeof item.content !== 'string' || !item.content.trim()) continue;
    if (looksSecret(item.content)) continue;
    const memory = store.update(id, { content: item.content });
    if (memory) changes.push({ type: 'updated', memory });
  }

  for (const rawId of result.deactivate.slice(0, 5)) {
    const id = Number(rawId);
    if (!knownIds.has(id)) continue;
    const memory = store.update(id, { enabled: false });
    if (memory) changes.push({ type: 'deactivated', memory });
  }

  return changes;
}

// Zugangsdaten werden grundsätzlich nie automatisch gespeichert – lieber
// einmal zu vorsichtig als ein Passwort in der Datenbank.
function looksSecret(text) {
  return /(passw|kennwort|\bpin\b|\bpuk\b|\btan\b|iban|kreditkart|cvv|api[- ]?key|api-schlüssel|zugangsdaten|access[- ]?token|secret)/i.test(text);
}

export function createExtractor({ ai, store, getProviderId, maxInPrompt }) {
  return async function extract({ conversationId, userText, assistantText, signal }) {
    const memories = store.relevant(`${userText}\n${assistantText}`, maxInPrompt);
    const raw = await ai.complete(getProviderId(), {
      system: SYSTEM,
      prompt: buildExtractionPrompt({ userText, assistantText, memories }),
      maxTokens: 4000,
      effort: 'low',
      signal,
    });
    const result = parseExtraction(raw);
    return applyExtraction(store, result, {
      conversationId,
      knownIds: new Set(memories.map((m) => m.id)),
    });
  };
}
