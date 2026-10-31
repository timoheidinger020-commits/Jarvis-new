// Einstellungen, die in der Oberfläche geändert werden können (zentral gespeichert).
export function createSettings(db, defaults) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  return {
    get(key) {
      const row = getStmt.get(key);
      if (!row) return defaults[key];
      try {
        return JSON.parse(row.value);
      } catch {
        return defaults[key];
      }
    },
    set(key, value) {
      setStmt.run(key, JSON.stringify(value));
    },
    all() {
      return Object.fromEntries(Object.keys(defaults).map((k) => [k, this.get(k)]));
    },
  };
}
