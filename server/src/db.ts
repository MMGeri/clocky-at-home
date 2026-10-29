import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'clockify.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration INTEGER,
    synced INTEGER NOT NULL DEFAULT 0,
    sync_error TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    clockify_id TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_email TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_email, key)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// 1. settings migration FIRST — populates the users table from old credentials
const settingsCols = (db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]).map(c => c.name);
if (!settingsCols.includes('user_email')) {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const owner: string = byKey['user_email'] ?? '';
  const pw: string = byKey['user_password'] ?? '';

  db.exec('ALTER TABLE settings RENAME TO settings_v1');
  db.exec(`
    CREATE TABLE settings (
      user_email TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_email, key)
    )
  `);

  if (owner) {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (user_email, key, value) VALUES (?, ?, ?)');
    for (const { key, value } of rows) {
      if (key !== 'user_email' && key !== 'user_password') insert.run(owner, key, value);
    }
    if (pw) {
      db.prepare('INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)').run(owner, pw);
    }
  }

  db.exec('DROP TABLE settings_v1');
  console.log('[DB] migrated settings to per-user schema');
}

// 2. time_entries column migrations — run after settings so users table is populated
const entryCols = (db.prepare('PRAGMA table_info(time_entries)').all() as { name: string }[]).map(c => c.name);
if (!entryCols.includes('clockify_id')) {
  db.exec('ALTER TABLE time_entries ADD COLUMN clockify_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_clockify_id ON time_entries(clockify_id) WHERE clockify_id IS NOT NULL');
}
if (!entryCols.includes('user_email')) {
  db.exec("ALTER TABLE time_entries ADD COLUMN user_email TEXT NOT NULL DEFAULT ''");
}

// 3. Heal orphaned entries (user_email = '') — covers both fresh migrations and the
//    bad-order case where the column was added before users was populated.
const orphaned = (db.prepare("SELECT COUNT(*) as cnt FROM time_entries WHERE user_email = ''").get() as { cnt: number }).cnt;
if (orphaned > 0) {
  const firstUser = db.prepare('SELECT email FROM users LIMIT 1').get() as { email: string } | undefined;
  if (firstUser) {
    db.prepare("UPDATE time_entries SET user_email = ? WHERE user_email = ''").run(firstUser.email);
    console.log(`[DB] assigned ${orphaned} orphaned entries to ${firstUser.email}`);
  }
}

export default db;
