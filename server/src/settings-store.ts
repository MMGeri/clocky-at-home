import db from './db';

export function getSetting(userEmail: string, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE user_email = ? AND key = ?').get(userEmail, key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSetting(userEmail: string, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (user_email, key, value) VALUES (?, ?, ?)').run(userEmail, key, value);
}

export function deleteSetting(userEmail: string, key: string): void {
  db.prepare('DELETE FROM settings WHERE user_email = ? AND key = ?').run(userEmail, key);
}

export function deleteSettings(userEmail: string, keys: string[]): void {
  const placeholders = keys.map(() => '?').join(', ');
  db.prepare(`DELETE FROM settings WHERE user_email = ? AND key IN (${placeholders})`).run(userEmail, ...keys);
}
