import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db';
import { createSession, deleteSession, getSession } from '../sessions';

const router = Router();

function getUser(email: string): { email: string; password_hash: string } | null {
  return db.prepare('SELECT email, password_hash FROM users WHERE email = ?').get(email) as { email: string; password_hash: string } | null;
}

export function isSetupMode(): boolean {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  return row.cnt === 0;
}

function isHashed(value: string): boolean {
  return value.startsWith('$2b$') || value.startsWith('$2a$');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

router.get('/me', (req: Request, res: Response) => {
  if (isSetupMode()) return res.json({ email: null, setupMode: true });
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = token ? getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: session.email });
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = getUser(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  let passwordOk = false;
  if (isHashed(user.password_hash)) {
    passwordOk = await bcrypt.compare(password, user.password_hash);
  } else {
    passwordOk = safeEqual(password, user.password_hash);
    if (passwordOk) {
      const hashed = await bcrypt.hash(password, 12);
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashed, user.email);
      console.log('[Auth] migrated plain-text password to bcrypt hash');
    }
  }

  if (!passwordOk) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = createSession(user.email);
  res.json({ token, email: user.email });
});

router.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = getUser(email.trim());
  if (existing) {
    return res.status(403).json({ error: 'This email is already registered.' });
  }

  const hashed = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.trim(), hashed);

  const token = createSession(email.trim());
  res.json({ token, email: email.trim() });
});

router.post('/logout', (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) deleteSession(token);
  res.json({ ok: true });
});

export default router;
