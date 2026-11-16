// Gespräche und Nachrichten (Kurzzeitgedächtnis / Gesprächsverlauf).
import { randomUUID } from 'node:crypto';
import { now } from '../db.js';

export function createConversationStore(db) {
  return {
    create(title = 'Neues Gespräch') {
      const id = randomUUID();
      const ts = now();
      db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, ts, ts);
      return this.get(id);
    },

    get(id) {
      return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) || null;
    },

    list() {
      return db.prepare(`SELECT c.id, c.title, c.created_at, c.updated_at,
                           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                         FROM conversations c ORDER BY c.updated_at DESC`).all();
    },

    rename(id, title) {
      const clean = String(title || '').trim().slice(0, 120);
      if (!clean) return this.get(id);
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(clean, now(), id);
      return this.get(id);
    },

    remove(id) {
      return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
    },

    touch(id) {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id);
    },

    addMessage(conversationId, { role, content, provider = null, model = null, viaVoice = false }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO messages (conversation_id, role, content, provider, model, via_voice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(conversationId, role, content, provider, model, viaVoice ? 1 : 0, now());
      this.touch(conversationId);
      return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(lastInsertRowid));
    },

    messages(conversationId, { afterId = 0 } = {}) {
      return db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id').all(conversationId, afterId);
    },

    setSummary(id, summary, summarizedUntil) {
      db.prepare('UPDATE conversations SET summary = ?, summarized_until = ? WHERE id = ?').run(summary, summarizedUntil, id);
    },
  };
}
