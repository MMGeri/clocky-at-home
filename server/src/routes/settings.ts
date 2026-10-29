import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { getSetting, setSetting } from '../settings-store';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const email = req.userEmail;
  if (!email) return res.status(401).json({ error: 'Not authenticated' });

  const rows = db.prepare('SELECT key, value FROM settings WHERE user_email = ?').all(email) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  // Expose the login email so the settings page can display it
  out['user_email'] = email;
  res.json(out);
});

router.get('/has-password', (_req: Request, res: Response) => {
  // Used before login — check if any user exists
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  res.json({ hasPassword: row.cnt > 0 });
});

router.put('/', async (req: Request, res: Response) => {
  const email = req.userEmail;
  if (!email) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body as Record<string, string | undefined>;

  if (body.jira_base_url !== undefined) {
    try {
      const url = new URL(body.jira_base_url);
      if (url.protocol !== 'https:') {
        return res.status(400).json({ error: 'Jira Base URL must use HTTPS.' });
      }
      const host = url.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host === '0.0.0.0' ||
        host.includes('169.254')
      ) {
        return res.status(400).json({ error: 'Jira Base URL must be a public HTTPS address.' });
      }
    } catch {
      return res.status(400).json({ error: 'Jira Base URL is not a valid URL.' });
    }
  }

  const settingKeys = ['jira_base_url', 'jira_token', 'clockify_api_key'];
  for (const key of settingKeys) {
    if (body[key] !== undefined && body[key] !== '') setSetting(email, key, body[key] as string);
  }

  if (body.user_password && body.user_password.trim()) {
    const hashed = await bcrypt.hash(body.user_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashed, email);
  }

  res.json({ ok: true });
});

export default router;
