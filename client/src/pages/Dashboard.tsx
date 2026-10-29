import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../api';
import { format, isToday, parseISO, startOfISOWeek } from 'date-fns';
import { useTimer, formatDuration } from '../hooks/useTimer';
import TimeEntryRow from '../components/TimeEntryRow';
import JiraTasksList from '../components/JiraTasksList';
import { TimeEntry } from '../types';

type Mode = 'timer' | 'manual';
type MobileTab = 'entries' | 'jira';

interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

export default function Dashboard() {
  const { running, elapsed, start, stop } = useTimer();
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [mode, setMode] = useState<Mode>('timer');
  const [manualDate, setManualDate] = useState(todayLocal());
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('10:00');
  const [syncingAll, setSyncingAll] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('entries');
  const [expandedMergeGroups, setExpandedMergeGroups] = useState<Set<string>>(new Set());
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);

  const fetchEntries = useCallback(async () => {
    const res = await apiFetch('/api/entries');
    const data = await res.json();
    setEntries(data);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Restore running timer on page load
  useEffect(() => {
    apiFetch('/api/entries/running-timer').then(r => r.json()).then(data => {
      if (data.running) {
        setDescription(data.description ?? '');
        start(new Date(data.start_time));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update browser tab title with timer
  useEffect(() => {
    if (running) {
      document.title = `${formatDuration(elapsed)} — Clockify`;
    } else {
      document.title = 'Clockify';
    }
  }, [running, elapsed]);

  async function handleStart() {
    const startTime = new Date();
    start(startTime);
    await apiFetch('/api/entries/running-timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, start_time: startTime.toISOString() }),
    });
  }

  async function handleStop() {
    const result = stop();
    if (!result) return;
    await apiFetch('/api/entries/running-timer', { method: 'DELETE' });
    await apiFetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        start_time: result.startTime.toISOString(),
        end_time: result.endTime.toISOString(),
        duration: result.duration,
      }),
    });
    setDescription('');
    fetchEntries();
  }

  async function handleManualAdd() {
    const startDt = new Date(`${manualDate}T${manualStart}`);
    const endDt = new Date(`${manualDate}T${manualEnd}`);
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) return;
    const duration = Math.floor((endDt.getTime() - startDt.getTime()) / 1000);
    if (duration <= 0) return;
    await apiFetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        duration,
      }),
    });
    setDescription('');
    fetchEntries();
  }

  function persistDescription(val: string) {
    setDescription(val);
    if (running) {
      apiFetch('/api/entries/running-timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: val, start_time: new Date(Date.now() - elapsed * 1000).toISOString() }),
      });
    }
  }

  async function handleSyncAll() {
    const unsynced = entries.filter(e => e.synced !== 1);
    if (unsynced.length === 0) return;
    setSyncingAll(true);
    setSyncResult(null);
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;
    for (let i = 0; i < unsynced.length; i++) {
      setSyncProgress({ current: i + 1, total: unsynced.length });
      const res = await apiFetch(`/api/entries/${unsynced[i].id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) synced++;
      else { failed++; errors.push(data.error ?? 'Unknown error'); }
    }
    setSyncingAll(false);
    setSyncProgress(null);
    setSyncResult({ synced, failed, errors });
    fetchEntries();
  }

  async function handleDelete(id: number) {
    await apiFetch(`/api/entries/${id}`, { method: 'DELETE' });
    fetchEntries();
  }

  async function handleUnsync(id: number) {
    await apiFetch(`/api/entries/${id}/unsync`, { method: 'POST' });
    fetchEntries();
  }

  async function handleMarkSynced(id: number) {
    await apiFetch(`/api/entries/${id}/mark-synced`, { method: 'POST' });
    fetchEntries();
  }

  async function handleUpdate(id: number, data: Partial<TimeEntry>) {
    await apiFetch(`/api/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    fetchEntries();
  }

  function handleStartFromEntry(desc: string) {
    setDescription(desc);
    if (!running) {
      const startTime = new Date();
      start(startTime);
      apiFetch('/api/entries/running-timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, start_time: startTime.toISOString() }),
      });
    }
  }

  async function handleDuplicate(entry: TimeEntry) {
    await apiFetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: entry.description,
        start_time: entry.start_time,
        end_time: entry.end_time ?? null,
        duration: entry.duration,
      }),
    });
    fetchEntries();
  }

  const pastDescriptions = [...new Map(
    [...entries].reverse().filter(e => e.description.trim()).map(e => [e.description, e.description])
  ).values()];

  const suggestions = description.trim()
    ? pastDescriptions.filter(d => d.toLowerCase().includes(description.toLowerCase()) && d !== description)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggleMergeGroup(key: string) {
    setExpandedMergeGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const weekGroups = groupByWeek(entries);
  const unsyncedCount = entries.filter(e => e.synced !== 1).length;

  const activeJiraKey = description.match(/^([A-Z][A-Z0-9]+-\d+)\s*\|/)?.[1];

  const handleStartFromJira = useCallback(async (key: string, summary?: string) => {
    const desc = summary ? `${key} | ${summary}` : `${key} | `;

    if (running) {
      const currentDesc = description;
      const result = stop();
      if (result) {
        await apiFetch('/api/entries/running-timer', { method: 'DELETE' });
        await apiFetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: currentDesc,
            start_time: result.startTime.toISOString(),
            end_time: result.endTime.toISOString(),
            duration: result.duration,
          }),
        });
      }
    }

    setDescription(desc);
    const startTime = new Date();
    start(startTime);
    await apiFetch('/api/entries/running-timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, start_time: startTime.toISOString() }),
    });
    setMobileTab('entries');
    inputRef.current?.focus();
    fetchEntries();
  }, [running, description, stop, start, fetchEntries]);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mobile tab switcher */}
      <div className="md:hidden flex flex-shrink-0 bg-white border-b border-gray-200">
        <button
          onClick={() => setMobileTab('entries')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'entries' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
          }`}
        >
          Entries
        </button>
        <button
          onClick={() => setMobileTab('jira')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'jira' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
          }`}
        >
          Jira Tasks
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: timer + entries ── */}
        <div className={`overflow-y-auto p-3 sm:p-6 min-w-0 flex-1 ${mobileTab === 'jira' ? 'hidden md:block' : 'block'}`} style={{ fontFamily: 'Roboto, sans-serif' }}>

          {/* Timer card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4">
            {/* Input + controls — stacks on mobile, single row on sm+ */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 px-4 py-3 gap-2">
              <input
                ref={inputRef}
                type="text"
                value={description}
                onChange={(e) => {
                  persistDescription(e.target.value);
                  setShowSuggestions(true);
                  setSelectedIndex(-1);
                }}
                onFocus={() => setShowSuggestions(true)}
                autoComplete="off"
                placeholder="What are you working on? (e.g. AG8-1231 | fixing login bug)"
                className="flex-1 text-sm border-0 outline-none bg-transparent placeholder-gray-400 w-full"
                onKeyDown={(e) => {
                  const list = suggestions.slice(0, 8);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(i => Math.min(i + 1, list.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(i => Math.max(i - 1, -1));
                  } else if (e.key === 'Enter') {
                    if (selectedIndex >= 0 && list[selectedIndex]) {
                      persistDescription(list[selectedIndex]);
                      setShowSuggestions(false);
                      setSelectedIndex(-1);
                    } else if (mode === 'timer' && !running) {
                      handleStart();
                    }
                  } else if (e.key === 'Escape') {
                    setShowSuggestions(false);
                    setSelectedIndex(-1);
                  }
                }}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                {mode === 'timer' && (
                  <div className="font-mono text-lg text-gray-600 tabular-nums w-20 sm:w-24 text-center">
                    {formatDuration(elapsed)}
                  </div>
                )}
                <button
                  onClick={() => setMode(mode === 'timer' ? 'manual' : 'timer')}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 whitespace-nowrap"
                  title="Toggle mode"
                >
                  {mode === 'timer' ? '✏️' : '⏱'}
                  <span className="hidden sm:inline"> {mode === 'timer' ? 'Manual' : 'Timer'}</span>
                </button>
                {mode === 'timer' ? (
                  <button
                    onClick={running ? handleStop : handleStart}
                    className={`px-4 sm:px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      running ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {running ? 'Stop' : 'Start'}
                  </button>
                ) : (
                  <button
                    onClick={handleManualAdd}
                    className="px-4 sm:px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>

            {mode === 'manual' && (
              <div className="flex items-center gap-2 px-4 pb-3 text-sm flex-wrap border-t border-gray-100 pt-3">
                <input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400">from</span>
                <input
                  type="time"
                  value={manualStart}
                  onChange={(e) => setManualStart(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="time"
                  value={manualEnd}
                  onChange={(e) => setManualEnd(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            )}

            {showSuggestions && suggestions.length > 0 && (
              <div ref={suggestionsRef} className="border-t border-gray-100 overflow-hidden rounded-b-xl">
                {suggestions.slice(0, 8).map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); persistDescription(s); setShowSuggestions(false); setSelectedIndex(-1); }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full text-left px-4 py-2 text-sm truncate border-b border-gray-50 last:border-0 transition-colors ${
                      i === selectedIndex ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sync All */}
          <div className="mb-4 sm:mb-6">
            <button
              onClick={() => unsyncedCount > 0 && setShowSyncConfirm(true)}
              disabled={syncingAll || unsyncedCount === 0}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                unsyncedCount === 0
                  ? 'bg-gray-100 text-gray-400 cursor-default'
                  : syncingAll
                  ? 'bg-violet-500 text-white cursor-wait'
                  : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm hover:shadow-md'
              }`}
            >
              {syncingAll ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  {syncProgress ? `${syncProgress.current} / ${syncProgress.total}` : '…'}
                </>
              ) : unsyncedCount === 0 ? (
                '✓ All synced to Jira'
              ) : (
                <>Sync {unsyncedCount} {unsyncedCount === 1 ? 'entry' : 'entries'} to Jira</>
              )}
            </button>

            {syncResult && (
              <div className={`mt-2 px-3 py-2 rounded-lg text-sm ${
                syncResult.failed === 0
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}>
                {syncResult.synced > 0 && <span>✓ {syncResult.synced} synced. </span>}
                {syncResult.failed > 0 && (
                  <span>✕ {syncResult.failed} failed: <span className="font-medium">{syncResult.errors.slice(0, 2).join('; ')}{syncResult.errors.length > 2 ? ' …' : ''}</span></span>
                )}
                <button onClick={() => setSyncResult(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
              </div>
            )}
          </div>

          {/* Entries grouped by week */}
          {weekGroups.map(({ weekStart, days }, wi) => {
            let weekTotal = days.flatMap(([, es]) => es).reduce((s, e) => s + (e.duration ?? 0), 0);
            if (running) {
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              const dayHasToday = days.some(([dk]) => dk === todayStr);
              if (dayHasToday) weekTotal += elapsed;
            }
            return (
              <div key={weekStart.toISOString()} className="mb-6">
                {/* Horizontal divider between weeks */}
                {wi > 0 && <hr className="border-gray-200 mb-6 -mt-2" />}
                {/* Week total — above this week's entries */}
                <div className="flex justify-end items-center gap-3 mb-5 text-lg">
                  <span className="text-gray-500">Week total</span>
                  <span className="font-mono font-bold text-black">{formatDuration(weekTotal)}</span>
                </div>
                {days.map(([dk, dayEntries]) => {
                  const date = new Date(dk + 'T00:00:00');
                  const today = isToday(date);
                  let dayTotal = dayEntries.reduce((s, e) => s + (e.duration ?? 0), 0);
                  if (today && running) dayTotal += elapsed;
                  return (
                    <div key={dk} className="mb-4">
                      <div className="bg-gray-100 px-3 sm:px-4 py-2.5 rounded-t-xl flex items-center justify-between mb-0">
                        <h2 className="text-sm sm:text-base font-semibold uppercase tracking-wide text-gray-700">
                          {today ? 'Today' : format(date, 'EEEE, MMMM d').toUpperCase()}
                        </h2>
                        <span className="font-mono font-bold text-base sm:text-lg text-black">
                          {formatDuration(dayTotal)}
                        </span>
                      </div>
                      <div className="bg-white rounded-b-xl shadow-sm border border-gray-200 overflow-hidden">
                        {mergeDuplicateEntries(dayEntries).map((group) => {
                          const mergeKey = `${dk}-${group.firstEntry.description}`;
                          const isExpanded = expandedMergeGroups.has(mergeKey);
                          return (
                            <div key={mergeKey}>
                              <div className="border-b border-gray-100">
                                <TimeEntryRow
                                  entry={{ ...group.firstEntry, duration: group.totalDuration }}
                                  onDelete={handleDelete}
                                  onUnsync={handleUnsync}
                                  onMarkSynced={handleMarkSynced}
                                  onUpdate={group.count > 1
                                    ? async (id, data) => {
                                        await handleUpdate(id, data);
                                        if (data.description !== undefined) {
                                          for (const e of group.entries) {
                                            if (e.id !== id) await handleUpdate(e.id, { description: data.description });
                                          }
                                        }
                                      }
                                    : handleUpdate}
                                  onStart={handleStartFromEntry}
                                  onDuplicate={handleDuplicate}
                                  mergeCount={group.count > 1 ? group.count : undefined}
                                  onMergeClick={group.count > 1 ? () => toggleMergeGroup(mergeKey) : undefined}
                                  isMergeExpanded={isExpanded}
                                />
                              </div>
                              {isExpanded && group.entries.map((e) => (
                                <div key={e.id} className="border-b border-gray-100 last:border-0 bg-blue-50 hover:bg-blue-100/70 transition-colors pl-5 border-l-[3px] border-l-blue-300">
                                  <TimeEntryRow
                                    entry={e}
                                    onDelete={handleDelete}
                                    onUnsync={handleUnsync}
                                    onMarkSynced={handleMarkSynced}
                                    onUpdate={handleUpdate}
                                    onStart={handleStartFromEntry}
                                    onDuplicate={handleDuplicate}
                                  />
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Sync confirmation modal ── */}
        {showSyncConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSyncConfirm(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-80 mx-4" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-semibold text-gray-800 mb-1">Sync to Jira</h2>
              <p className="text-sm text-gray-500 mb-5">
                Log <span className="font-semibold text-gray-700">{unsyncedCount} {unsyncedCount === 1 ? 'entry' : 'entries'}</span> to Jira? This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowSyncConfirm(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowSyncConfirm(false); handleSyncAll(); }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors"
                >
                  Sync {unsyncedCount} {unsyncedCount === 1 ? 'entry' : 'entries'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Right: Jira sidebar ── */}
        <div className={`border-gray-200 bg-white flex-col overflow-hidden
          ${mobileTab === 'entries' ? 'hidden md:flex md:w-80 md:border-l md:flex-shrink-0' : 'flex flex-1'}
        `}>
          <JiraTasksList onStartTimer={handleStartFromJira} activeKey={activeJiraKey} />
        </div>

      </div>
    </div>
  );
}

function groupByWeek(entries: TimeEntry[]): { weekStart: Date; days: [string, TimeEntry[]][] }[] {
  // entries arrive newest-first; Map insertion order preserves that
  const weeks = new Map<string, { weekStart: Date; days: Map<string, TimeEntry[]> }>();
  for (const e of entries) {
    const d = parseISO(e.start_time);
    const ws = startOfISOWeek(d);
    const wk = ws.toISOString();
    if (!weeks.has(wk)) weeks.set(wk, { weekStart: ws, days: new Map() });
    const dk = format(d, 'yyyy-MM-dd');
    const { days } = weeks.get(wk)!;
    if (!days.has(dk)) days.set(dk, []);
    days.get(dk)!.push(e);
  }
  return [...weeks.values()].map(({ weekStart, days }) => ({
    weekStart,
    days: [...days.entries()],
  }));
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mergeDuplicateEntries(entries: TimeEntry[]): { firstEntry: TimeEntry; entries: TimeEntry[]; count: number; totalDuration: number }[] {
  const groups = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const key = e.description;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.values()].map(group => ({
    firstEntry: group[0],
    entries: group,
    count: group.length,
    totalDuration: group.reduce((sum, e) => sum + (e.duration ?? 0), 0),
  }));
}
