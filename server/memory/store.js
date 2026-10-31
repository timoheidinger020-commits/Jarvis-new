// Langzeitgedächtnis: Speichern, Bearbeiten, Suchen, Deaktivieren, Löschen.
import { now } from '../db.js';

export const CATEGORIES = ['person', 'vorliebe', 'projekt', 'aufgabe', 'entscheidung', 'wissen', 'sonstiges'];

function normalize(row) {
  if (!row) return null;
  return { ...row, enabled: Boolean(row.enabled) };
}

function cleanCategory(category) {
  const c = String(category || '').toLowerCase().trim();
  return CATEGORIES.includes(c) ? c : 'sonstiges';
}

function cleanImportance(importance) {
  const n = Number(importance);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 2;
}

function cleanContent(content) {
  const text = String(content ?? '').trim();
  if (!text) throw Object.assign(new Error('Eine Erinnerung darf nicht leer sein.'), { status: 400 });
  if (text.length > 2000) throw Object.assign(new Error('Eine Erinnerung darf höchstens 2000 Zeichen lang sein.'), { status: 400 });
  return text;
}

/** Baut aus freiem Text eine sichere FTS5-Suchanfrage (Wörter mit ODER). */
function ftsQuery(text) {
  const words = String(text)
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu);
  if (!words) return null;
  const unique = [...new Set(words)].slice(0, 24);
  return unique.map((w) => `"${w}"*`).join(' OR ');
}

export function createMemoryStore(db) {
  const stmts = {
    insert: db.prepare(`INSERT INTO memories (content, category, importance, enabled, source, conversation_id, created_at, updated_at)
                        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`),
    get: db.prepare('SELECT * FROM memories WHERE id = ?'),
    all: db.prepare('SELECT * FROM memories ORDER BY updated_at DESC, id DESC'),
    enabled: db.prepare('SELECT * FROM memories WHERE enabled = 1 ORDER BY importance DESC, updated_at DESC'),
    countEnabled: db.prepare('SELECT COUNT(*) AS n FROM memories WHERE enabled = 1'),
    remove: db.prepare('DELETE FROM memories WHERE id = ?'),
    search: db.prepare(`SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
                        WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`),
    searchEnabled: db.prepare(`SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
                        WHERE memories_fts MATCH ? AND m.enabled = 1 ORDER BY bm25(memories_fts) LIMIT ?`),
  };

  return {
    add({ content, category, importance, source = 'manual', conversationId = null }) {
      const ts = now();
      const { lastInsertRowid } = stmts.insert.run(
        cleanContent(content),
        cleanCategory(category),
        cleanImportance(importance),
        source === 'auto' ? 'auto' : 'manual',
        conversationId,
        ts,
        ts,
      );
      return this.get(Number(lastInsertRowid));
    },

    get(id) {
      return normalize(stmts.get.get(id));
    },

    update(id, changes) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = {
        content: changes.content !== undefined ? cleanContent(changes.content) : existing.content,
        category: changes.category !== undefined ? cleanCategory(changes.category) : existing.category,
        importance: changes.importance !== undefined ? cleanImportance(changes.importance) : existing.importance,
        enabled: changes.enabled !== undefined ? (changes.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      };
      db.prepare('UPDATE memories SET content = ?, category = ?, importance = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(next.content, next.category, next.importance, next.enabled, now(), id);
      return this.get(id);
    },

    remove(id) {
      return stmts.remove.run(id).changes > 0;
    },

    list({ query } = {}) {
      if (query && query.trim()) {
        const q = ftsQuery(query);
        if (!q) return [];
        return stmts.search.all(q, 200).map(normalize);
      }
      return stmts.all.all().map(normalize);
    },

    /**
     * Wählt die Erinnerungen aus, die JARVIS für eine Nachricht kennen soll.
     * Bei wenigen Erinnerungen: alle aktiven. Bei vielen: die wichtigsten
     * plus die zur aktuellen Nachricht passenden.
     */
    relevant(text, limit) {
      const { n } = stmts.countEnabled.get();
      if (n <= limit) return stmts.enabled.all().map(normalize);

      const chosen = new Map();
      const q = ftsQuery(text);
      if (q) {
        for (const row of stmts.searchEnabled.all(q, Math.ceil(limit / 2))) chosen.set(row.id, row);
      }
      for (const row of stmts.enabled.all()) {
        if (chosen.size >= limit) break;
        chosen.set(row.id, row);
      }
      return [...chosen.values()].map(normalize);
    },
  };
}
