import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import {
  format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  isWithinInterval, eachDayOfInterval, subWeeks, subMonths,
} from 'date-fns';
import { TimeEntry } from '../types';
import { formatDuration } from '../hooks/useTimer';

type Range = 'this_week' | 'prev_week' | 'this_month' | 'prev_month' | 'custom';

const CHART_H = 180;

interface DayBar {
  label: string;
  shortLabel: string;
  syncedSec: number;
  unsyncedSec: number;
}

function fmtBarLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

function BarChart({ data }: { data: DayBar[] }) {
  const [tooltip, setTooltip] = useState<{ idx: number; x: number; y: number } | null>(null);
  if (!data.length) return null;

  const maxSec = Math.max(...data.map(d => d.syncedSec + d.unsyncedSec), 1);
  const maxHours = maxSec / 3600;

  // Nice Y-axis steps
  const yMax = Math.ceil(maxHours);
  const yStep = yMax <= 2 ? 0.5 : yMax <= 4 ? 1 : yMax <= 8 ? 2 : yMax <= 16 ? 4 : 8;
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep);

  const showShort = data.length > 14;

  return (
    <div className="relative select-none">
      <div className="flex gap-2">
        {/* Y labels */}
        <div className="flex flex-col justify-between text-right flex-shrink-0 pb-6" style={{ height: CHART_H + 24, width: 36 }}>
          {[...yTicks].reverse().map(h => (
            <span key={h} className="text-xs text-gray-300 leading-none">
              {h % 1 === 0 ? `${h}h` : `${h * 60}m`}
            </span>
          ))}
        </div>

        {/* Chart area */}
        <div className="flex-1 relative">
          {/* Horizontal grid lines */}
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: CHART_H }}>
            {yTicks.map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-gray-100"
                style={{ top: (i / (yTicks.length - 1)) * CHART_H }}
              />
            ))}
          </div>

          {/* Bars */}
          <div className="flex items-end gap-0.5" style={{ height: CHART_H }}>
            {data.map((d, i) => {
              const total = d.syncedSec + d.unsyncedSec;
              const barH = Math.round((total / maxSec) * CHART_H);
              const syncedH = total > 0 ? Math.round((d.syncedSec / total) * barH) : 0;
              const unsyncedH = barH - syncedH;
              const hasUnsynced = unsyncedH > 0;
              const hasSynced = syncedH > 0;

              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col justify-end cursor-default relative"
                  style={{ height: CHART_H }}
                  onMouseEnter={e => setTooltip({ idx: i, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  onMouseMove={e => setTooltip({ idx: i, x: e.clientX, y: e.clientY })}
                >
                  {total > 0 && barH > 0 && (
                    <span
                      className="absolute left-0 right-0 text-center text-gray-400 leading-none pointer-events-none overflow-hidden"
                      style={{ bottom: barH + 3, fontSize: data.length > 20 ? 9 : 11 }}
                    >
                      {fmtBarLabel(total)}
                    </span>
                  )}
                  {hasUnsynced && (
                    <div
                      className={`w-full bg-blue-400 hover:bg-blue-500 transition-colors ${!hasSynced ? 'rounded-t-sm' : ''}`}
                      style={{ height: Math.max(unsyncedH, 2) }}
                    />
                  )}
                  {hasSynced && (
                    <div
                      className={`w-full bg-green-400 hover:bg-green-500 transition-colors ${!hasUnsynced ? 'rounded-t-sm' : ''}`}
                      style={{ height: Math.max(syncedH, 2) }}
                    />
                  )}
                  {!hasUnsynced && !hasSynced && (
                    <div className="w-full border-t border-gray-200" style={{ height: 1 }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* X labels */}
          <div className="flex items-start gap-0.5 mt-1.5" style={{ height: 22 }}>
            {data.map((d, i) => (
              <div
                key={i}
                className="flex-1 text-center overflow-hidden"
                style={{ fontSize: data.length > 20 ? 8 : 10, color: '#9ca3af' }}
              >
                {showShort ? d.shortLabel : d.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip !== null && (() => {
        const d = data[tooltip.idx];
        const total = d.syncedSec + d.unsyncedSec;
        return total > 0 ? (
          <div
            className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y - 48 }}
          >
            <div className="font-semibold mb-1">{d.label}</div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-green-400 flex-shrink-0" />
              Synced: {formatDuration(d.syncedSec)}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-blue-400 flex-shrink-0" />
              Unsynced: {formatDuration(d.unsyncedSec)}
            </div>
            <div className="border-t border-gray-700 mt-1 pt-1 font-medium">
              Total: {formatDuration(total)}
            </div>
          </div>
        ) : null;
      })()}
    </div>
  );
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function ReportsPage() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [range, setRange] = useState<Range>('this_week');
  const [from, setFrom] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    apiFetch('/api/entries').then(r => r.json()).then(setEntries);
  }, []);

  useEffect(() => {
    if (range === 'this_week') {
      setFrom(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      setTo(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    } else if (range === 'prev_week') {
      const lastWeek = subWeeks(new Date(), 1);
      setFrom(format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      setTo(format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    } else if (range === 'this_month') {
      setFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
      setTo(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    } else if (range === 'prev_month') {
      const lastMonth = subMonths(new Date(), 1);
      setFrom(format(startOfMonth(lastMonth), 'yyyy-MM-dd'));
      setTo(format(endOfMonth(lastMonth), 'yyyy-MM-dd'));
    }
  }, [range]);

  const filtered = entries.filter(e => {
    try {
      return isWithinInterval(parseISO(e.start_time), {
        start: new Date(from + 'T00:00:00'),
        end: new Date(to + 'T23:59:59'),
      });
    } catch { return false; }
  });

  const total = filtered.reduce((s, e) => s + (e.duration ?? 0), 0);
  const syncedTotal = filtered.filter(e => e.synced === 1).reduce((s, e) => s + (e.duration ?? 0), 0);

  // Build bar chart data – one entry per day in range
  const barData: DayBar[] = (() => {
    try {
      const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
      const numDays = days.length;
      return days.map(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        const dayEntries = filtered.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === dateStr);
        const syncedSec = dayEntries.filter(e => e.synced === 1).reduce((s, e) => s + (e.duration ?? 0), 0);
        const unsyncedSec = dayEntries.filter(e => e.synced !== 1).reduce((s, e) => s + (e.duration ?? 0), 0);
        const label = numDays <= 7
          ? format(d, 'EEE d')
          : numDays <= 31
          ? format(d, 'EEE d')
          : format(d, 'MMM d');
        const shortLabel = numDays <= 7 ? format(d, 'EEEEE') : format(d, 'd');
        return { label, shortLabel, syncedSec, unsyncedSec };
      });
    } catch { return []; }
  })();

  // By ticket
  const byTicket = new Map<string, { syncedSec: number; unsyncedSec: number }>();
  for (const e of filtered) {
    const m = e.description.match(/^([A-Z][A-Z0-9]+-\d+)/);
    const key = m ? m[1] : '(no ticket)';
    const cur = byTicket.get(key) ?? { syncedSec: 0, unsyncedSec: 0 };
    if (e.synced === 1) cur.syncedSec += e.duration ?? 0;
    else cur.unsyncedSec += e.duration ?? 0;
    byTicket.set(key, cur);
  }
  const ticketList = [...byTicket.entries()]
    .sort(([, a], [, b]) => (b.syncedSec + b.unsyncedSec) - (a.syncedSec + a.unsyncedSec));

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-y-auto flex-1">
        <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Reports</h1>

      {/* Range selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['this_week', 'prev_week', 'this_month', 'prev_month', 'custom'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r === 'this_week' ? 'This week'
                : r === 'prev_week' ? 'Prev week'
                : r === 'this_month' ? 'This month'
                : r === 'prev_month' ? 'Prev month'
                : 'Custom'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date" value={from}
            onChange={e => { setRange('custom'); setFrom(e.target.value); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
          <span className="text-gray-400">–</span>
          <input
            type="date" value={to}
            onChange={e => { setRange('custom'); setTo(e.target.value); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Total" value={formatDuration(total)} sub={`${filtered.length} entries`} color="gray" />
        <SummaryCard label="Synced" value={formatDuration(syncedTotal)} sub={`${filtered.filter(e => e.synced).length} entries`} color="green" />
        <SummaryCard label="Unsynced" value={formatDuration(total - syncedTotal)} sub={`${filtered.filter(e => !e.synced).length} entries`} color="blue" />
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-700 text-sm">Time by Day</h2>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-400" />Synced
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-400" />Unsynced
            </span>
          </div>
        </div>
        {barData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No data for this range.</p>
        ) : (
          <BarChart data={barData} />
        )}
      </div>

      {/* By ticket */}
      {ticketList.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">By Ticket</h2>
          <div className="space-y-2.5">
            {ticketList.map(([ticket, { syncedSec, unsyncedSec }]) => {
              const ticketTotal = syncedSec + unsyncedSec;
              const syncedPct = ticketTotal > 0 ? (syncedSec / total) * 100 : 0;
              const unsyncedPct = ticketTotal > 0 ? (unsyncedSec / total) * 100 : 0;
              return (
                <div key={ticket}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${ticket === '(no ticket)' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>
                      {ticket}
                    </span>
                    <span className="font-mono text-gray-600 text-xs">{formatDuration(ticketTotal)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                    <div className="bg-green-400 h-full" style={{ width: `${syncedPct}%` }} title={`Synced: ${formatDuration(syncedSec)}`} />
                    <div className="bg-blue-400 h-full" style={{ width: `${unsyncedPct}%` }} title={`Unsynced: ${formatDuration(unsyncedSec)}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entry list */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <h2 className="font-semibold text-gray-700 px-4 py-3 border-b border-gray-100 text-sm">All Entries</h2>
          <div className="divide-y divide-gray-100">
            {[...filtered].sort((a, b) => b.start_time.localeCompare(a.start_time)).map(e => {
              const m = e.description.match(/^([A-Z][A-Z0-9]+-\d+)/);
              const ticket = m?.[1];
              const rest = ticket ? e.description.slice(m![0].length).trim().replace(/^\|/, '').trim() : e.description;
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`text-base flex-shrink-0 ${e.synced ? 'text-green-500' : 'text-gray-200'}`}>✓</span>
                  <span className="text-xs text-gray-400 w-28 flex-shrink-0 tabular-nums">
                    {format(parseISO(e.start_time), 'EEE MMM d HH:mm')}
                  </span>
                  {ticket && (
                    <span className="bg-blue-100 text-blue-700 text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0">
                      {ticket}
                    </span>
                  )}
                  <span className="text-gray-700 flex-1 truncate">{rest}</span>
                  <span className="font-mono text-gray-500 text-xs flex-shrink-0 tabular-nums">{formatDuration(e.duration ?? 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const cls: Record<string, string> = {
    gray: 'border-gray-200 bg-gray-50 text-gray-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${cls[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-60">{label}</p>
      <p className="text-2xl font-mono font-bold mt-1 tabular-nums">{value}</p>
      <p className="text-xs opacity-50 mt-0.5">{sub}</p>
    </div>
  );
}
