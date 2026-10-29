import { Router, Request, Response } from 'express';
import { getSetting } from '../settings-store';

const router = Router();

function jiraHeaders(email: string, token: string) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function log(label: string, ...args: any[]) {
  console.log(`[Jira] ${label}`, ...args);
}

const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'project', 'parent', 'updated', 'timespent', 'aggregatetimespent', 'timeoriginalestimate', 'aggregatetimeoriginalestimate'];

async function searchJql(url: string, headers: Record<string, string>, jql: string): Promise<any[]> {
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jql, fields: ISSUE_FIELDS, maxResults: 200 }),
  });
  if (!r.ok) return [];
  const data = await r.json() as any;
  return data.issues ?? [];
}

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

async function fetchByKeys(url: string, headers: Record<string, string>, keys: string[]): Promise<any[]> {
  if (keys.length === 0) return [];
  const safe = keys.filter(k => JIRA_KEY_RE.test(k));
  if (safe.length === 0) return [];
  const jql = `key in (${safe.map(k => `"${k}"`).join(',')})`;
  return searchJql(url, headers, jql);
}

router.get('/issues', async (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const baseUrl = getSetting(userEmail, 'jira_base_url').replace(/\/$/, '');
  const token = getSetting(userEmail, 'jira_token');

  if (!baseUrl || !userEmail || !token) {
    log('issues', 'Not configured — baseUrl:', baseUrl, 'email:', userEmail, 'token set:', !!token);
    return res.status(400).json({ error: 'Jira is not configured. Go to Settings.' });
  }

  const url = `${baseUrl}/rest/api/3/search/jql`;
  const headers = jiraHeaders(userEmail, token);

  log('issues →', 'POST', url);
  log('issues →', 'auth email:', userEmail);

  try {
    const assigned: any[] = await searchJql(url, headers, 'assignee = currentUser() ORDER BY updated DESC');
    log('issues ← assigned count:', assigned.length);

    const mineKeys = new Set(assigned.map((i: any) => i.key));
    const allIssues = new Map<string, any>(assigned.map(i => [i.key, { ...i, mine: true }]));

    for (let level = 0; level < 2; level++) {
      const missingParentKeys: string[] = [];
      for (const issue of allIssues.values()) {
        const pk = issue.fields?.parent?.key;
        if (pk && !allIssues.has(pk)) missingParentKeys.push(pk);
      }
      if (missingParentKeys.length === 0) break;

      log(`issues → fetching ${missingParentKeys.length} ancestor(s) at level ${level + 1}:`, missingParentKeys);
      const parents = await fetchByKeys(url, headers, [...new Set(missingParentKeys)]);
      for (const p of parents) {
        allIssues.set(p.key, { ...p, mine: mineKeys.has(p.key) });
      }
    }

    log('issues ← total (with ancestors):', allIssues.size);
    res.json([...allIssues.values()]);
  } catch (err: any) {
    log('issues ← NETWORK ERROR:', err.message);
    res.status(500).json({ error: `Network error: ${err.message}` });
  }
});

router.post('/create-subtask', async (req: Request, res: Response) => {
  const { parentKey, projectKey, summary } = req.body as { parentKey: string; projectKey: string; summary: string };
  if (!parentKey || !projectKey || !summary?.trim()) {
    return res.status(400).json({ error: 'parentKey, projectKey and summary are required' });
  }

  const userEmail = req.userEmail ?? '';
  const baseUrl = getSetting(userEmail, 'jira_base_url').replace(/\/$/, '');
  const token = getSetting(userEmail, 'jira_token');
  if (!baseUrl || !userEmail || !token) return res.status(400).json({ error: 'Jira is not configured.' });

  const headers = jiraHeaders(userEmail, token);

  try {
    const meRes = await fetch(`${baseUrl}/rest/api/3/myself`, { headers });
    if (!meRes.ok) return res.status(401).json({ error: 'Failed to get Jira user info' });
    const me = await meRes.json() as any;
    const accountId = me.accountId;

    log('create-subtask →', parentKey, projectKey, summary, 'accountId:', accountId);

    const createRes = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentKey },
          summary: summary.trim(),
          issuetype: { name: 'Alfeladat' },
          assignee: { id: accountId },
        },
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      log('create-subtask ← ERROR:', text);
      return res.status(createRes.status).json({ error: `Failed to create issue: ${text.slice(0, 300)}` });
    }

    const created = await createRes.json() as any;
    const newKey = created.key;
    log('create-subtask ← created:', newKey);

    const transRes = await fetch(`${baseUrl}/rest/api/3/issue/${newKey}/transitions`, { headers });
    if (transRes.ok) {
      const transData = await transRes.json() as any;
      const transition = (transData.transitions as any[]).find(
        (t: any) => t.name.toLowerCase().includes('folyamatban') || t.name.toLowerCase().includes('in progress')
      );
      if (transition) {
        await fetch(`${baseUrl}/rest/api/3/issue/${newKey}/transitions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ transition: { id: transition.id } }),
        });
        log('create-subtask ← transitioned to:', transition.name);
      } else {
        log('create-subtask ← no Folyamatban transition found, transitions:', transData.transitions.map((t: any) => t.name));
      }
    }

    // Fetch the created issue to return full data (for immediate client-side insertion)
    let createdIssueData = null;
    try {
      const fieldsParam = ISSUE_FIELDS.join(',');
      const issueDetailRes = await fetch(`${baseUrl}/rest/api/3/issue/${newKey}?fields=${fieldsParam}`, { headers });
      if (issueDetailRes.ok) createdIssueData = await issueDetailRes.json();
    } catch {}

    res.json({ ok: true, key: newKey, issue: createdIssueData });
  } catch (err: any) {
    log('create-subtask ← NETWORK ERROR:', err.message);
    res.status(500).json({ error: `Network error: ${err.message}` });
  }
});

router.post('/test', async (req: Request, res: Response) => {
  const userEmail = req.userEmail ?? '';
  const baseUrl = getSetting(userEmail, 'jira_base_url').replace(/\/$/, '');
  const token = getSetting(userEmail, 'jira_token');

  if (!baseUrl || !userEmail || !token) {
    log('test', 'Not configured — baseUrl:', baseUrl, 'email:', userEmail, 'token set:', !!token);
    return res.status(400).json({ error: 'Fill in your profile email, Jira URL and API token first.' });
  }

  const url = `${baseUrl}/rest/api/3/myself`;
  log('test →', 'GET', url);
  log('test →', 'auth email:', userEmail);

  try {
    const r = await fetch(url, { headers: jiraHeaders(userEmail, token) });
    log('test ←', r.status, r.statusText);

    if (!r.ok) {
      const text = await r.text();
      log('test ← ERROR body:', text);
      return res.json({ ok: false, error: `Authentication failed (${r.status}). Check your token and email.` });
    }

    const user = await r.json() as any;
    log('test ← OK, user:', user.displayName, user.emailAddress);
    res.json({ ok: true, displayName: user.displayName, email: user.emailAddress });
  } catch (err: any) {
    log('test ← NETWORK ERROR:', err.message);
    res.json({ ok: false, error: `Cannot reach Jira: ${err.message}` });
  }
});

export default router;
