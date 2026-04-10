import { getDb } from './db';

export function ensureSettingsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function getSetting(key: string): string | undefined {
  const db = ensureSettingsTable();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || undefined;
}

export function getAllSettings(): Record<string, string> {
  const db = ensureSettingsTable();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setSetting(key: string, value: string) {
  const db = ensureSettingsTable();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function deleteSetting(key: string) {
  const db = ensureSettingsTable();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function deleteSettings(keys: string[]) {
  if (!keys.length) return;

  const db = ensureSettingsTable();
  const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
  const transaction = db.transaction((values: string[]) => {
    for (const key of values) {
      stmt.run(key);
    }
  });

  transaction(keys);
}
