import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { JiraIssue } from '../types';

const STATUS_COLORS: Record<string, string> = {
  'To Do': 'bg-gray-100 text-gray-600',
  'Folyamatban': 'bg-blue-100 text-blue-700',
  'Done': 'bg-green-100 text-green-700',
  'In Review': 'bg-yellow-100 text-yellow-700',
};

const TYPE_ORDER = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'];

const TYPE_ICONS: Record<string, string> = {
  Epic: '⚡', Eposz: '⚡',
  Story: '📖',
  Task: '✅',
  Bug: '🐛',
  'Sub-task': '↳', Alfeladat: '↳',
};

function typeRowStyle(typeName: string): React.CSSProperties {
  const t = typeName.toLowerCase();
  if (t.includes('epic') || t === 'eposz') return { backgroundColor: '#f3e8ff', borderTop: '2px solid #d8b4fe' };
  if (t.includes('story')) return { backgroundColor: '#f0fdf4', borderTop: '1px solid #86efac' };
  if (t.includes('sub') || t === 'alfeladat') return { borderTop: '1px dashed #e5e7eb' };
  return { borderTop: '1px solid #f3f4f6' };
}

function statusColor(s: string) {
  return STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-600';
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

  function sortIssues(list: JiraIssue[]) {
    return [...list].sort((a, b) => {
      const ua = a.fields.updated ? new Date(a.fields.updated).getTime() : 0;
      const ub = b.fields.updated ? new Date(b.fields.updated).getTime() : 0;
      return ub - ua;
    });
  }

  function toNode(issue: JiraIssue): TreeNode {
    const kids = sortIssues(childrenOf.get(issue.key) ?? []);
    return { issue, children: kids.map(toNode) };
  }

  // Roots: issues whose parent is not in our map
  const roots = issues.filter(i => {
    const pk = i.fields.parent?.key;
    return !pk || !byKey.has(pk);
  });

  return sortIssues(roots).map(toNode);
}

export default function JiraTasksPage() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

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
      console.log('[JiraTasks] issue types:', [...new Set(data.map((i: JiraIssue) => i.fields.issuetype.name))]);
    }
    if (settingsRes.ok) {
      const s = await settingsRes.json();
      setJiraBaseUrl((s.jira_base_url ?? '').replace(/\/$/, ''));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const statuses = [...new Set(issues.map(i => i.fields.status.name))];

  function issueUrl(key: string) {
    return jiraBaseUrl ? `${jiraBaseUrl}/browse/${key}` : undefined;
  }

  function matchesFilter(issue: JiraIssue) {
    const text = `${issue.key} ${issue.fields.summary}`.toLowerCase();
    const matchText = !filter || text.includes(filter.toLowerCase());
    const matchStatus = statusFilter === 'all' || issue.fields.status.name === statusFilter;
    return matchText && matchStatus;
  }

  // A node is visible if it or any descendant matches the filter
  function nodeVisible(node: TreeNode): boolean {
    return matchesFilter(node.issue) || node.children.some(nodeVisible);
  }

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const tree = buildTree(issues);
  const visibleRoots = tree.filter(nodeVisible);
  const mineCount = issues.filter(i => i.mine).length;

  function IssueRow({ node, depth }: { node: TreeNode; depth: number }) {
    const { issue, children } = node;
    const isOpen = !collapsed.has(issue.key);
    const hasChildren = children.length > 0;
    const visibleChildren = children.filter(nodeVisible);

    const typeName = issue.fields.issuetype.name;
    const typeStyle = typeRowStyle(typeName);

    return (
      <div>
        <div
          className={`flex items-start gap-2 px-4 py-2.5 group hover:brightness-95 transition-all ${!issue.mine ? 'opacity-60' : ''}`}
          style={{ paddingLeft: `${16 + depth * 20}px`, ...typeStyle }}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => hasChildren && toggleCollapse(issue.key)}
            className={`flex-shrink-0 w-4 text-center text-xs text-gray-400 mt-0.5 ${hasChildren ? 'hover:text-gray-600 cursor-pointer' : 'cursor-default'}`}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : ''}
          </button>

          <span className="flex-shrink-0 text-sm mt-0.5">{TYPE_ICONS[issue.fields.issuetype.name] ?? '📌'}</span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {issueUrl(issue.key) ? (
                <a
                  href={issueUrl(issue.key)}
                  target="_blank"
                  rel="noreferrer"
                  className={`font-mono text-sm font-semibold hover:underline ${issue.mine ? 'text-blue-700' : 'text-gray-500'}`}
                  onClick={e => e.stopPropagation()}
                >
                  {issue.key}
                </a>
              ) : (
                <span className={`font-mono text-sm font-semibold ${issue.mine ? 'text-blue-700' : 'text-gray-500'}`}>
                  {issue.key}
                </span>
              )}
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColor(issue.fields.status.name)}`}>
                {issue.fields.status.name}
              </span>
              {!issue.mine && (
                <span className="text-xs text-gray-400 italic">not assigned to you</span>
              )}
            </div>
            <p className="text-sm text-gray-700 mt-0.5 truncate">{issue.fields.summary}</p>
            {(() => {
              const spent = issue.fields.aggregatetimespent ?? issue.fields.timespent ?? 0;
              const estimate = issue.fields.aggregatetimeoriginalestimate ?? issue.fields.timeoriginalestimate ?? 0;
              if (!spent && !estimate) return null;
              const pct = estimate > 0 ? Math.min(spent / estimate, 1) : 1;
              const over = estimate > 0 && spent > estimate;
              return (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-xs">
                    <div
                      className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {fmtSeconds(spent)}
                    {estimate > 0 && ` / ${fmtSeconds(estimate)}`}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {hasChildren && isOpen && (
          <div>
            {visibleChildren.map(child => (
              <IssueRow key={child.issue.key} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">My Jira Tasks</h1>
          {!loading && issues.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {mineCount} assigned to you · {issues.length - mineCount} ancestor context
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold">Failed to load Jira issues</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs">Make sure Jira is configured in Settings.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-3 mb-5 flex-wrap">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search by key or title…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-16 text-sm">Loading Jira issues…</div>
          ) : visibleRoots.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm">No issues found.</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {visibleRoots.map(node => (
                <IssueRow key={node.issue.key} node={node} depth={0} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Tip: Click a ticket key to open it in Jira. Use it in the timer as <code>AG8-1231 | doing something</code>.
      </p>
    </div>
  );
}
