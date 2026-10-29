import { randomUUID } from 'crypto';
import db from './db';

export function createSession(email: string): string {
  const token = randomUUID();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, email);
  return token;
}

export function getSession(token: string) {
  return db.prepare('SELECT email FROM sessions WHERE token = ?').get(token) as { email: string } | null;
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
