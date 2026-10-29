import { Router, Request, Response } from 'express';
import db from '../db';
import { getSetting, setSetting, deleteSettings } from '../settings-store';

const router = Router();

interface Entry {
  id: number;
  description: string;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  synced: number;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
}

function parseId(param: string): number | null {
  const id = parseInt(param, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

function jiraHeaders(email: string, token: string) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

router.get('/', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const entries = db.prepare('SELECT * FROM time_entries WHERE user_email = ? ORDER BY start_time DESC').all(userEmail);
  res.json(entries);
});

router.post('/', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const { description, start_time, end_time, duration } = req.body as {
    description: string;
    start_time: string;
    end_time?: string;
    duration?: number;
  };
  if (!start_time) return res.status(400).json({ error: 'start_time is required' });

  const result = db
    .prepare('INSERT INTO time_entries (user_email, description, start_time, end_time, duration) VALUES (?, ?, ?, ?, ?)')
    .run(userEmail, description ?? '', start_time, end_time ?? null, duration ?? null);

  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(entry);
});

// Running timer persistence — stored in the settings table under timer_* keys
// Must be before /:id routes or Express will match "running-timer" as an id.

router.get('/running-timer', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const start = getSetting(userEmail, 'timer_start') || null;
  const desc  = getSetting(userEmail, 'timer_description');
  res.json(start ? { running: true, start_time: start, description: desc } : { running: false });
});

router.post('/running-timer', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const { description, start_time } = req.body as { description: string; start_time: string };
  if (!start_time) return res.status(400).json({ error: 'start_time is required' });
  setSetting(userEmail, 'timer_start', start_time);
  setSetting(userEmail, 'timer_description', description ?? '');
  res.json({ ok: true });
});

router.delete('/running-timer', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  deleteSettings(userEmail, ['timer_start', 'timer_description']);
  res.json({ ok: true });
});

router.put('/:id', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const { description, start_time, end_time, duration } = req.body as {
    description?: string;
    start_time?: string;
    end_time?: string;
    duration?: number;
  };
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  const existing = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_email = ?').get(id, userEmail) as Entry | undefined;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE time_entries SET description = ?, start_time = ?, end_time = ?, duration = ? WHERE id = ? AND user_email = ?'
  ).run(
    description ?? existing.description,
    start_time ?? existing.start_time,
    end_time ?? existing.end_time,
    duration ?? existing.duration,
    id,
    userEmail
  );

  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id));
});

router.delete('/:id', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_email = ?').get(id, userEmail);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM time_entries WHERE id = ? AND user_email = ?').run(id, userEmail);
  res.json({ ok: true });
});

router.post('/:id/sync', async (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_email = ?').get(id, userEmail) as Entry | undefined;
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const baseUrl = getSetting(userEmail, 'jira_base_url').replace(/\/$/, '');
  const email = userEmail;
  const token = getSetting(userEmail, 'jira_token');

  console.log(`[Sync] entry #${id} — baseUrl: ${baseUrl}, email: ${email}, token set: ${!!token}`);

  if (!baseUrl || !email || !token) {
    return res.status(400).json({ error: 'Jira is not configured. Go to Settings.' });
  }

  // Formats: "TICKET", "TICKET private", "TICKET | public", "TICKET private | public"
  const match = entry.description.match(/^([A-Z][A-Z0-9]+-\d+)([\s\S]*)$/);
  if (!match) {
    return res.status(400).json({
      error: 'Description must start with a Jira ticket key (e.g. AG8-1231 or AG8-1231 | doing something)',
    });
  }
  const ticketKey = match[1];
  const rest = match[2];
  const pipeIdx = rest.indexOf('|');
  const logComment = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : '';

  const headers = jiraHeaders(email, token);

  // Fetch the issue
  let issueData: any;
  try {
    const issueUrl = `${baseUrl}/rest/api/3/issue/${ticketKey}?fields=summary,status,assignee`;
    console.log(`[Sync] GET ${issueUrl}`);
    const issueRes = await fetch(issueUrl, { headers });
    console.log(`[Sync] issue response: ${issueRes.status} ${issueRes.statusText}`);
    if (issueRes.status === 404) {
      db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(
        `Issue ${ticketKey} does not exist in Jira`,
        id
      );
      return res.json({ ok: false, error: `Issue ${ticketKey} does not exist in Jira` });
    }
    if (!issueRes.ok) {
      const text = await issueRes.text();
      console.log(`[Sync] issue error body:`, text);
      db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(
        `Jira API error: ${issueRes.status} ${text.slice(0, 200)}`,
        id
      );
      return res.json({ ok: false, error: `Jira API error: ${issueRes.status} ${text.slice(0, 200)}` });
    }
    issueData = await issueRes.json();
    console.log(`[Sync] issue status: ${issueData?.fields?.status?.name}, assignee: ${issueData?.fields?.assignee?.emailAddress}`);
  } catch (err: any) {
    console.log(`[Sync] network error fetching issue:`, err.message);
    db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(
      `Network error: ${err.message}`,
      id
    );
    return res.json({ ok: false, error: `Network error: ${err.message}` });
  }

  // Validate assignee
  const assigneeEmail: string | undefined = issueData?.fields?.assignee?.emailAddress;
  if (!assigneeEmail || assigneeEmail.toLowerCase() !== email.toLowerCase()) {
    const msg = `Issue ${ticketKey} is not assigned to you (assigned to: ${assigneeEmail ?? 'nobody'})`;
    db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(msg, id);
    return res.json({ ok: false, error: msg });
  }

  // Validate status
  const statusName: string = issueData?.fields?.status?.name ?? '';
  const statusToBe = [
    'folyamatban',
    'review',
    'in progress',
    'done',
    'kész'
  ]
  if (statusToBe.indexOf(statusName.toLowerCase()) === -1) {
    const msg = `Issue ${ticketKey} is not the right status (current status: ${statusName})`;
    db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(msg, id);
    return res.json({ ok: false, error: msg });
  }

  // Log work — Jira minimum is 60 seconds.
  // Jira truncates sub-minute seconds on each worklog, so we round UP to the
  // nearest minute to avoid accumulating drift across many entries.
  const rawSeconds = entry.duration ?? 60;
  const durationSeconds = Math.max(60, Math.ceil(rawSeconds / 60) * 60);
  const startedRaw = entry.start_time;
  // Jira requires format: 2024-01-15T10:00:00.000+0000
  const started = new Date(startedRaw).toISOString().replace('Z', '+0000');

  const worklogBody: any = {
    timeSpentSeconds: durationSeconds,
    started,
  };

  if (logComment) {
    worklogBody.comment = {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: logComment }] }],
    };
  }

  const worklogUrl = `${baseUrl}/rest/api/3/issue/${ticketKey}/worklog`;
  console.log(`[Sync] POST ${worklogUrl}`);
  console.log(`[Sync] worklog body:`, JSON.stringify(worklogBody));

  try {
    const logRes = await fetch(worklogUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(worklogBody),
    });

    console.log(`[Sync] worklog response: ${logRes.status} ${logRes.statusText}`);

    if (!logRes.ok) {
      const text = await logRes.text();
      console.log(`[Sync] worklog error body:`, text);
      let errMsg: string;
      try {
        const json = JSON.parse(text);
        errMsg = json.errorMessages?.join(', ') || json.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
      } catch {
        errMsg = text.slice(0, 300);
      }
      db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(errMsg, id);
      return res.json({ ok: false, error: errMsg });
    }

    console.log(`[Sync] worklog OK for entry #${id}`);
    db.prepare(
      "UPDATE time_entries SET synced = 1, sync_error = NULL, synced_at = datetime('now') WHERE id = ?"
    ).run(id);
    return res.json({ ok: true });
  } catch (err: any) {
    console.log(`[Sync] network error posting worklog:`, err.message);
    const msg = `Network error while logging work: ${err.message}`;
    db.prepare("UPDATE time_entries SET synced = 0, sync_error = ? WHERE id = ?").run(msg, id);
    return res.json({ ok: false, error: msg });
  }
});

router.post('/:id/unsync', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_email = ?').get(id, userEmail);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE time_entries SET synced = 0, sync_error = NULL, synced_at = NULL WHERE id = ? AND user_email = ?').run(id, userEmail);
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id));
});

router.post('/:id/mark-synced', (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND user_email = ?').get(id, userEmail);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE time_entries SET synced = 1, sync_error = NULL, synced_at = datetime('now') WHERE id = ? AND user_email = ?").run(id, userEmail);
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id));
});

export default router;
