// Kontextverwaltung: Welche Teile eines Gesprächs bekommt die KI zu sehen?
//
// Strategie:
//  1. Die neuesten Nachrichten werden wörtlich mitgeschickt, bis das
//     Zeichenbudget (CONTEXT_MAX_CHARS) erreicht ist.
//  2. Ältere Nachrichten werden in einer laufenden Zusammenfassung verdichtet
//     (siehe service.js), die im System-Prompt steht.
//  3. Dazu kommen die relevanten Erinnerungen aus dem Langzeitgedächtnis.

const TIME_ZONE = process.env.TZ_DISPLAY || 'Europe/Berlin';
const stampFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function timestamp(iso) {
  return stampFormat.format(new Date(iso));
}

/** Formatiert gespeicherte Nachrichten für die KI (mit Zeitstempel beim Benutzer). */
export function toModelMessages(rows) {
  const out = [];
  for (const row of rows) {
    const content =
      row.role === 'user' ? `[${timestamp(row.created_at)}${row.via_voice ? ' · gesprochen' : ''}] ${row.content}` : row.content;
    const last = out[out.length - 1];
    // Aufeinanderfolgende Nachrichten derselben Rolle zusammenführen
    // (z. B. wenn eine Antwort wegen eines Fehlers fehlt).
    if (last && last.role === row.role) {
      last.content += `\n\n${content}`;
    } else {
      out.push({ role: row.role, content });
    }
  }
  // Die KI erwartet, dass das Gespräch mit dem Benutzer beginnt.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * Teilt die noch nicht zusammengefassten Nachrichten in
 *  - recent: passen ins Budget und werden wörtlich gesendet
 *  - overflow: zu alt, sollten zusammengefasst werden
 */
export function splitByBudget(rows, maxChars) {
  let used = 0;
  let cut = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    used += rows[i].content.length + 40;
    if (used > maxChars && i < rows.length - 1) break;
    cut = i;
  }
  // Nicht mitten in einem Austausch schneiden: recent beginnt mit dem Benutzer.
  while (cut < rows.length - 1 && rows[cut].role !== 'user') cut++;
  return { overflow: rows.slice(0, cut), recent: rows.slice(cut) };
}
