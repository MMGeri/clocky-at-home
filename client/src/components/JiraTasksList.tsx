import React, { useState, useEffect, memo } from 'react';
import { apiFetch } from '../api';
import { JiraIssue } from '../types';

const STATUS_COLORS: Record<string, string> = {
  'To Do': 'bg-gray-100 text-gray-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Done': 'bg-green-100 text-green-700',
  'In Review': 'bg-yellow-100 text-yellow-700',
};

const TYPE_ICONS: Record<string, string> = {
  Epic: '⚡', Eposz: '⚡',
  Story: '📖',
  Task: '✅',
  Bug: '🐛',
  'Sub-task': '↳', Alfeladat: '↳',
};

function statusColor(s: string) {
  return STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-600';
}

function typeRowStyle(typeName: string): React.CSSProperties {
  const t = typeName.toLowerCase();
  if (t.includes('epic') || t === 'eposz') return { backgroundColor: '#f3e8ff', borderTop: '2px solid #d8b4fe' };
  if (t.includes('story')) return { backgroundColor: '#f0fdf4', borderTop: '1px solid #86efac' };
  if (t.includes('sub') || t === 'alfeladat') return { borderTop: '1px dashed #e5e7eb' };
  return { borderTop: '1px solid #f3f4f6' };
}

function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface TreeNode {
  issue: JiraIssue;
  children: TreeNode[];
}

function buildTree(issues: JiraIssue[]): TreeNode[] {
  const byKey = new Map<string, JiraIssue>(issues.map(i => [i.key, i]));
  const childrenOf = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const pk = issue.fields.parent?.key;
    if (pk && byKey.has(pk)) {
      if (!childrenOf.has(pk)) childrenOf.set(pk, []);
      childrenOf.get(pk)!.push(issue);
    }
  }

  function sortByUpdated(list: JiraIssue[]) {
    return [...list].sort((a, b) => {
      const ua = a.fields.updated ? new Date(a.fields.updated).getTime() : 0;
      const ub = b.fields.updated ? new Date(b.fields.updated).getTime() : 0;
      return ub - ua;
    });
  }

  function toNode(issue: JiraIssue): TreeNode {
    return { issue, children: sortByUpdated(childrenOf.get(issue.key) ?? []).map(toNode) };
  }

  const roots = issues.filter(i => {
    const pk = i.fields.parent?.key;
    return !pk || !byKey.has(pk);
  });

  return sortByUpdated(roots).map(toNode);
}

interface Props {
  onStartTimer: (key: string, summary?: string) => void;
  activeKey?: string;
}

interface CreateState {
  parentKey: string;
  projectKey: string;
  summary: string;
  saving: boolean;
  error: string | null;
}

export default memo(function JiraTasksList({ onStartTimer, activeKey }: Props) {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [issuesRes, settingsRes] = await Promise.all([
      apiFetch('/api/jira/issues'),
      apiFetch('/api/settings'),
    ]);
    if (!issuesRes.ok) {
      const d = await issuesRes.json();
      setError(d.error ?? 'Failed to load Jira issues');
    } else {
      const data = await issuesRes.json();
      setIssues(data);
      setCollapsed(new Set(data.map((i: JiraIssue) => i.key)));
    }
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      setJiraBaseUrl((s.jira_base_url ?? '').replace(/\/$/, ''));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (filter) {
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(issues.map(i => i.key)));
    }
  }, [filter, issues]);

  function copyKey(key: string) {
    const done = () => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(key).then(done).catch(() => fallbackCopy(key, done));
    } else {
      fallbackCopy(key, done);
    }
  }

  function fallbackCopy(text: string, done: () => void) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    document.body.removeChild(ta);
  }

  function issueUrl(key: string) {
    return jiraBaseUrl ? `${jiraBaseUrl}/browse/${key}` : undefined;
  }

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function matchesFilter(issue: JiraIssue) {
    if (!filter) return true;
    return `${issue.key} ${issue.fields.summary}`.toLowerCase().includes(filter.toLowerCase());
  }

  async function submitCreate() {
    if (!creating || !creating.summary.trim() || creating.saving) return;
    const parentKey = creating.parentKey;
    const projectKey = creating.projectKey;
    const summary = creating.summary.trim();
    setCreating(c => c ? { ...c, saving: true, error: null } : c);
    const res = await apiFetch('/api/jira/create-subtask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentKey, projectKey, summary }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setCreating(c => c ? { ...c, saving: false, error: data.error ?? 'Failed to create' } : c);
    } else {
      const newKey: string = data.key;
      setCreating(null);
      await load();
      // If Jira indexing hasn't caught up yet, manually insert the returned issue
      if (data.issue) {
        setIssues(prev => prev.some(i => i.key === newKey) ? prev : [...prev, { ...data.issue, mine: true }]);
      }
      setFilter(newKey);
      onStartTimer(newKey, summary);
    }
  }

  function nodeVisible(node: TreeNode): boolean {
    return matchesFilter(node.issue) || node.children.some(nodeVisible);
  }

  const tree = buildTree(issues);
  const visibleRoots = tree.filter(nodeVisible);

  function IssueRow({ node, depth }: { node: TreeNode; depth: number }) {
    const { issue, children } = node;
    const isOpen = !collapsed.has(issue.key);
    const hasChildren = children.length > 0;
    const visibleChildren = children.filter(nodeVisible);
    const typeName = issue.fields.issuetype.name;
    const rowStyle = typeRowStyle(typeName);
    const isActive = issue.key === activeKey;
    const spent = issue.fields.aggregatetimespent ?? issue.fields.timespent ?? 0;
    const estimate = issue.fields.aggregatetimeoriginalestimate ?? issue.fields.timeoriginalestimate ?? 0;

    return (
      <div>
        <div
          className={`flex items-center gap-1.5 pr-2 py-2 group transition-all ${isActive ? 'ring-1 ring-inset ring-blue-400' : ''} ${!issue.mine ? 'opacity-60' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px`, ...rowStyle }}
        >
          <button
            onClick={() => hasChildren && toggleCollapse(issue.key)}
            className={`flex-shrink-0 w-3.5 text-center text-xs text-gray-400 ${hasChildren ? 'hover:text-gray-600 cursor-pointer' : 'cursor-default'}`}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : ''}
          </button>

          <span className="flex-shrink-0 text-xs">{TYPE_ICONS[typeName] ?? '📌'}</span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {issueUrl(issue.key) ? (
                <a
                  href={issueUrl(issue.key)}
                  target="_blank"
                  rel="noreferrer"
                  className={`font-mono text-xs font-semibold hover:underline ${issue.mine ? 'text-blue-700' : 'text-gray-500'}`}
                  onClick={e => e.stopPropagation()}
                >
                  {issue.key}
                </a>
              ) : (
                <span className={`font-mono text-xs font-semibold ${issue.mine ? 'text-blue-700' : 'text-gray-500'}`}>{issue.key}</span>
              )}
              <span className={`text-xs px-1 py-0.5 rounded font-medium ${statusColor(issue.fields.status.name)}`} style={{ fontSize: '10px' }}>
                {issue.fields.status.name}
              </span>
            </div>
            <p className="text-xs text-gray-700 truncate leading-tight mt-0.5">{issue.fields.summary}</p>
            {(spent > 0 || estimate > 0) && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden max-w-[80px]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: estimate > 0 ? `${Math.min(spent / estimate, 1) * 100}%` : '100%',
                      backgroundColor: estimate > 0 && spent > estimate ? '#ef4444' : '#3b82f6',
                    }}
                  />
                </div>
                <span className="text-gray-400" style={{ fontSize: '10px' }}>
                  {fmtSeconds(spent)}{estimate > 0 && ` / ${fmtSeconds(estimate)}`}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Copy key */}
            <button
              onClick={e => { e.stopPropagation(); copyKey(issue.key); }}
              title={`Copy ${issue.key}`}
              className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
            >
              {copiedKey === issue.key ? '✓' : '⎘'}
            </button>
            {/* Create Alfeladat — only on non-sub-task issues */}
            {!typeName.toLowerCase().includes('sub') && typeName.toLowerCase() !== 'alfeladat' && (
              <button
                onClick={() => setCreating({
                  parentKey: issue.key,
                  projectKey: issue.fields.project.key,
                  summary: '',
                  saving: false,
                  error: null,
                })}
                title={`Create Alfeladat under ${issue.key}`}
                className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700 hover:bg-purple-200"
              >
                +
              </button>
            )}
            {issue.mine && (
              <button
                onClick={() => onStartTimer(issue.key, issue.fields.summary)}
                title={`Start timer for ${issue.key}`}
                className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white !opacity-100' : 'bg-gray-100 text-gray-600 hover:bg-blue-600 hover:text-white'
                }`}
              >
                ▶
              </button>
            )}
          </div>
        </div>

        {/* Inline create form */}
        {creating?.parentKey === issue.key && (
          <div
            className="px-3 py-2 border-t border-purple-100"
            style={{ paddingLeft: `${8 + (depth + 1) * 16}px`, backgroundColor: '#faf5ff' }}
          >
            <div className="text-xs text-purple-600 font-medium mb-1">New Alfeladat under {issue.key}</div>
            <div className="flex gap-1.5">
              <input
                autoFocus
                type="text"
                value={creating.summary}
                onChange={e => setCreating(c => c ? { ...c, summary: e.target.value } : c)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitCreate();
                  if (e.key === 'Escape') setCreating(null);
                }}
                placeholder="Sub-task summary…"
                className="flex-1 text-xs border border-purple-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
              <button
                onClick={submitCreate}
                disabled={creating.saving || !creating.summary.trim()}
                className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {creating.saving ? '…' : 'Create'}
              </button>
              <button onClick={() => setCreating(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">✕</button>
            </div>
            {creating.error && <p className="text-xs text-red-600 mt-1">{creating.error}</p>}
          </div>
        )}

        {hasChildren && isOpen && visibleChildren.map(child => (
          <IssueRow key={child.issue.key} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600">Jira Tasks</span>
        <button onClick={load} disabled={loading} className="text-xs text-blue-500 hover:underline disabled:opacity-40">
          {loading ? '…' : '↻'}
        </button>
      </div>

      <div className="px-2 py-2 border-b border-gray-100">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          autoComplete="off"
          placeholder="Filter…"
          className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-3 text-xs text-red-600">{error}</div>
        ) : loading ? (
          <div className="p-3 text-xs text-gray-400 text-center">Loading…</div>
        ) : visibleRoots.length === 0 ? (
          <div className="p-3 text-xs text-gray-400 text-center">No issues found.</div>
        ) : (
          <div className="bg-white">
            {visibleRoots.map(node => <IssueRow key={node.issue.key} node={node} depth={0} />)}
          </div>
        )}
      </div>
    </div>
  );
});
