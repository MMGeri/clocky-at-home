import path from 'path';
import dotenv from 'dotenv';

// Load .env from project root (two levels up from server/src/)
dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true } as Parameters<typeof dotenv.config>[0]);

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import entriesRouter from './routes/entries';
import settingsRouter from './routes/settings';
import jiraRouter from './routes/jira';
import clockifyRouter from './routes/clockify';
import authRouter, { isSetupMode } from './routes/auth';
import { getSession } from './sessions';

const app = express();
const PORT = process.env.PORT ?? 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/auth')) return next();
  if (isSetupMode()) return next();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = token ? getSession(token) : null;
  if (!session) {
    console.log(`[Auth] 401 ${req.method} ${req.path} — token:${token ? token.slice(0, 8) + '…' : 'none'}`);
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userEmail = session.email;
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/jira', jiraRouter);
app.use('/api/clockify', clockifyRouter);

// In production: serve the built React app and fall back to index.html for SPA routing
if (IS_PROD) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [${IS_PROD ? 'production' : 'development'}]`);
});
