import { Router, Request, Response } from 'express';
import db from '../db';
import { getSetting } from '../settings-store';

const router = Router();

let syncing = false;

function parseIsoDuration(dur: string): number {
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return 0;
  return (
    parseInt(m[1] || '0') * 3600 +
    parseInt(m[2] || '0') * 60 +
    Math.round(parseFloat(m[3] || '0'))
  );
}

router.post('/sync', async (req: Request, res: Response) => {
  if (syncing) {
    return res.status(409).json({ error: 'Sync already in progress.' });
  }

  const apiKey = getSetting(req.userEmail ?? '', 'clockify_api_key');
  if (!apiKey) {
    return res.status(400).json({ error: 'Clockify API key not configured.' });
  }

  syncing = true;
  console.log('[Clockify] sync started');

  try {
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };

    // Get current user + default workspace
    const userRes = await fetch('https://api.clockify.me/api/v1/user', { headers });
    if (!userRes.ok) {
      throw new Error(`Invalid API key (${userRes.status})`);
    }
    const user = await userRes.json() as { id: string; defaultWorkspace: string };
    const { id: userId, defaultWorkspace: workspaceId } = user;

    // Fetch workspace tags to find the "Synchronized" tag ID
    const tagsRes = await fetch(
      `https://api.clockify.me/api/v1/workspaces/${workspaceId}/tags`,
      { headers }
    );
    const tags = tagsRes.ok ? await tagsRes.json() as { id: string; name: string }[] : [];
    const synchronizedTagId = tags.find(t => t.name === 'Synchronized')?.id ?? null;
    if (synchronizedTagId) {
      console.log(`[Clockify] found "Synchronized" tag id: ${synchronizedTagId}`);
    }

    // Fetch entries from last 1 month
    const since = new Date();
    since.setMonth(since.getMonth() - 1);
    const params = new URLSearchParams({
      start: since.toISOString(),
      'page-size': '500',
      'in-progress': 'false',
    });

    const entriesRes = await fetch(
      `https://api.clockify.me/api/v1/workspaces/${workspaceId}/user/${userId}/time-entries?${params}`,
      { headers }
    );
    if (!entriesRes.ok) {
      throw new Error(`Failed to fetch entries (${entriesRes.status})`);
    }
    const entries = await entriesRes.json() as any[];
    console.log(`[Clockify] fetched ${entries.length} entries from Clockify`);

    const userEmail = req.userEmail ?? '';
    const insert = db.prepare(`
      INSERT INTO time_entries (user_email, description, start_time, end_time, duration, clockify_id, synced, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const update = db.prepare(`
      UPDATE time_entries
      SET description = ?, start_time = ?, end_time = ?, duration = ?, synced = ?
      WHERE clockify_id = ? AND user_email = ?
    `);
    const getExisting = db.prepare('SELECT id FROM time_entries WHERE clockify_id = ?');

    let added = 0;
    let updated = 0;

    const doImport = db.transaction(() => {
      for (const entry of entries) {
        if (!entry.timeInterval?.end) continue; // still running

        const duration = parseIsoDuration(entry.timeInterval.duration ?? '');
        // Billable or has "Synchronized" tag → mark as synced
        const hasSynchronizedTag = synchronizedTagId && (entry.tagIds ?? []).includes(synchronizedTagId);
        const synced = (entry.billable || hasSynchronizedTag) ? 1 : 0;

        if (getExisting.get(entry.id)) {
          // Update existing entry
          update.run(
            entry.description ?? '',
            entry.timeInterval.start,
            entry.timeInterval.end,
            duration,
            synced,
            entry.id,
            userEmail,
          );
          updated++;
        } else {
          // Insert new entry
          insert.run(
            userEmail,
            entry.description ?? '',
            entry.timeInterval.start,
            entry.timeInterval.end,
            duration,
            entry.id,
            synced,
          );
          added++;
        }
      }
    });

    doImport();

    console.log(`[Clockify] sync done — added: ${added}, updated: ${updated}`);
    res.json({ ok: true, added, updated, total: entries.length });
  } catch (err: any) {
    console.error('[Clockify] sync error:', err.message);
    res.status(500).json({ error: err.message ?? 'Sync failed' });
  } finally {
    syncing = false;
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ syncing });
});

export default router;
