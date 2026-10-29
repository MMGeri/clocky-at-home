import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  isSameDay, parseISO, isToday,
} from 'date-fns';
import { TimeEntry } from '../types';
import { formatDuration } from '../hooks/useTimer';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const LABEL_W = 52;
const MIN_H = 32;
const MAX_H = 480;
const ZOOM_STEP = 40;

interface Drag {
  type: 'move' | 'resize';
  entryId: number;
  offsetFromTop: number;
  originalStartMs: number;
  originalDuration: number;
}

interface EditState {
  entry: TimeEntry;
  desc: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

interface Creating {
  day: Date;
  startPx: number;
  currentPx: number;
}

interface PendingCreate {
  startMs: number;
  endMs: number;
}

function splitDt(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

function fmtMin(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [local, setLocal] = useState<TimeEntry[]>([]);
  const [week, setWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [hh, setHh] = useState(64);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [now, setNow] = useState(new Date());
  const moved = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Drag-to-create state
  const [creating, setCreating] = useState<Creating | null>(null);
  const creatingRef = useRef<Creating | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [createDesc, setCreateDesc] = useState('');

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  async function load() {
    const res = await apiFetch('/api/entries');
    const data: TimeEntry[] = await res.json();
    setEntries(data);
    setLocal(data);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * 64 - 60;
  }, []);

  const prevHh = useRef(hh);
  useEffect(() => {
    if (scrollRef.current && prevHh.current !== hh) {
      const ratio = hh / prevHh.current;
      scrollRef.current.scrollTop = scrollRef.current.scrollTop * ratio;
      prevHh.current = hh;
    }
  }, [hh]);

  function dayEntries(d: Date) {
    return local.filter(e => { try { return isSameDay(parseISO(e.start_time), d); } catch { return false; } });
  }

  function entryTop(e: TimeEntry) {
    const d = parseISO(e.start_time);
    return (d.getHours() + d.getMinutes() / 60) * hh;
  }
  function entryHeight(e: TimeEntry) {
    return Math.max((e.duration ?? 3600) / 3600 * hh, 18);
  }

  function layout(es: TimeEntry[]) {
    if (!es.length) return [] as { e: TimeEntry; col: number; cols: number }[];
    const sorted = [...es].sort((a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
    const slots: number[] = new Array(sorted.length).fill(0);
    for (let i = 0; i < sorted.length; i++) {
      const aS = parseISO(sorted[i].start_time).getTime();
      const aE = aS + (sorted[i].duration ?? 3600) * 1000;
      const taken = new Set<number>();
      for (let j = 0; j < i; j++) {
        const bS = parseISO(sorted[j].start_time).getTime();
        const bE = bS + (sorted[j].duration ?? 3600) * 1000;
        if (aS < bE && aE > bS) taken.add(slots[j]);
      }
      let c = 0; while (taken.has(c)) c++;
      slots[i] = c;
    }
    const maxCols = Math.max(...slots) + 1;
    return sorted.map((e, i) => ({ e, col: slots[i], cols: maxCols }));
  }

  // ── Existing entry drag ──────────────────────────────────────────────────────

  function onMouseDown(ev: React.MouseEvent, entry: TimeEntry, type: 'move' | 'resize') {
    ev.preventDefault();
    ev.stopPropagation();
    moved.current = false;
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const offsetFromTop = ev.clientY - (rect.top + entryTop(entry));
    setDrag({ type, entryId: entry.id, offsetFromTop, originalStartMs: parseISO(entry.start_time).getTime(), originalDuration: entry.duration ?? 3600 });
  }

  const onMouseMove = useCallback((ev: MouseEvent) => {
    if (!drag || !gridRef.current) return;
    if (Math.abs(ev.movementX) > 1 || Math.abs(ev.movementY) > 1) moved.current = true;
    const rect = gridRef.current.getBoundingClientRect();

    if (drag.type === 'resize') {
      const origStartHour = new Date(drag.originalStartMs).getHours() + new Date(drag.originalStartMs).getMinutes() / 60;
      const topInViewport = rect.top + origStartHour * hh;
      const rawH = Math.max(hh / 4, ev.clientY - topInViewport);
      const newDuration = Math.max(900, Math.round((rawH / hh) * 3600 / 60) * 60);
      const newEnd = new Date(drag.originalStartMs + newDuration * 1000);
      setLocal(prev => prev.map(e => e.id !== drag.entryId ? e : { ...e, duration: newDuration, end_time: newEnd.toISOString() }));
    } else {
      const topInGrid = Math.max(0, ev.clientY - rect.top - drag.offsetFromTop);
      const rawHour = topInGrid / hh;
      const snapped = Math.round(rawHour * 4) / 4;
      const h = Math.max(0, Math.min(23 + 45 / 60, snapped));
      const colW = (rect.width - LABEL_W) / 7;
      const xInCols = ev.clientX - rect.left - LABEL_W;
      const dayIdx = Math.max(0, Math.min(6, Math.floor(xInCols / colW)));
      const target = days[dayIdx];
      const newStart = new Date(target);
      newStart.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
      const dur = drag.originalDuration;
      const newEnd = new Date(newStart.getTime() + dur * 1000);
      setLocal(prev => prev.map(e => e.id !== drag.entryId ? e : {
        ...e, start_time: newStart.toISOString(), end_time: e.end_time ? newEnd.toISOString() : e.end_time,
      }));
    }
  }, [drag, hh, days]);

  const onMouseUp = useCallback(async () => {
    if (!drag) return;
    const updated = local.find(e => e.id === drag.entryId);

    if (!moved.current) {
      if (updated) {
        const s = splitDt(updated.start_time);
        const en = updated.end_time ? splitDt(updated.end_time) : { date: s.date, time: '' };
        setEdit({ entry: updated, desc: updated.description, startDate: s.date, startTime: s.time, endDate: en.date, endTime: en.time });
      }
      setDrag(null);
      return;
    }

    if (updated) {
      await apiFetch(`/api/entries/${drag.entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: updated.description, start_time: updated.start_time, end_time: updated.end_time, duration: updated.duration }),
      });
    }
    setDrag(null);
    load();
  }, [drag, local]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [drag, onMouseMove, onMouseUp]);

  // ── Drag-to-create ───────────────────────────────────────────────────────────

  function onColMouseDown(ev: React.MouseEvent, day: Date) {
    if (ev.button !== 0 || drag) return;
    ev.preventDefault();
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const relY = Math.max(0, ev.clientY - rect.top);
    const c: Creating = { day, startPx: relY, currentPx: relY };
    creatingRef.current = c;
    setCreating(c);
  }

  const onCreatingMouseMove = useCallback((ev: MouseEvent) => {
    if (!creatingRef.current || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const relY = Math.max(0, ev.clientY - rect.top);
    const updated: Creating = { ...creatingRef.current, currentPx: relY };
    creatingRef.current = updated;
    setCreating({ ...updated });
  }, []);

  const onCreatingMouseUp = useCallback(() => {
    const c = creatingRef.current;
    if (!c) return;
    creatingRef.current = null;
    setCreating(null);

    const startMin = Math.round((Math.min(c.startPx, c.currentPx) / hh) * 60 / 15) * 15;
    const endMin   = Math.round((Math.max(c.startPx, c.currentPx) / hh) * 60 / 15) * 15;

    if (endMin - startMin < 15) return; // too small — treat as click, ignore

    const startDt = new Date(c.day);
    startDt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const endDt = new Date(c.day);
    endDt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

    setPendingCreate({ startMs: startDt.getTime(), endMs: endDt.getTime() });
    setCreateDesc('');
  }, [hh]);

  useEffect(() => {
    if (!creating) return;
    window.addEventListener('mousemove', onCreatingMouseMove);
    window.addEventListener('mouseup', onCreatingMouseUp);
    return () => { window.removeEventListener('mousemove', onCreatingMouseMove); window.removeEventListener('mouseup', onCreatingMouseUp); };
  }, [creating, onCreatingMouseMove, onCreatingMouseUp]);

  async function handleConfirmCreate() {
    if (!pendingCreate) return;
    await apiFetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: createDesc.trim(),
        start_time: new Date(pendingCreate.startMs).toISOString(),
        end_time: new Date(pendingCreate.endMs).toISOString(),
        duration: Math.floor((pendingCreate.endMs - pendingCreate.startMs) / 1000),
      }),
    });
    setPendingCreate(null);
    setCreateDesc('');
    load();
  }

  // ── Edit modal save/delete ───────────────────────────────────────────────────

  async function saveEdit() {
    if (!edit) return;
    const s = new Date(`${edit.startDate}T${edit.startTime}`);
    const end = edit.endTime ? new Date(`${edit.endDate}T${edit.endTime}`) : null;
    const duration = end ? Math.floor((end.getTime() - s.getTime()) / 1000) : edit.entry.duration;
    await apiFetch(`/api/entries/${edit.entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: edit.desc, start_time: s.toISOString(), end_time: end?.toISOString() ?? null, duration }),
    });
    setEdit(null);
    load();
  }

  async function deleteEdit() {
    if (!edit) return;
    await apiFetch(`/api/entries/${edit.entry.id}`, { method: 'DELETE' });
    setEdit(null);
    load();
  }

  const nowTop = (now.getHours() + now.getMinutes() / 60) * hh;
  const totalH = 24 * hh;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0 bg-white z-20">
        <div className="flex items-center gap-1">
          <button onClick={() => setWeek(subWeeks(week, 1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-600 text-lg leading-none">‹</button>
          <span className="text-xs sm:text-sm font-medium text-gray-700 px-1 sm:px-2 select-none">
            {format(week, 'MMM d')} – {format(addDays(week, 6), 'MMM d')}
          </span>
          <button onClick={() => setWeek(addWeeks(week, 1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-600 text-lg leading-none">›</button>
          <button onClick={() => setWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="ml-2 text-xs text-blue-600 hover:underline px-2 py-1 rounded hover:bg-blue-50">Today</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 mr-1 hidden sm:inline">Zoom</span>
          <button onClick={() => setHh(h => Math.max(MIN_H, h - ZOOM_STEP))} disabled={hh <= MIN_H} className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 font-bold">−</button>
          <button onClick={() => setHh(h => Math.min(MAX_H, h + ZOOM_STEP))} disabled={hh >= MAX_H} className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 font-bold">+</button>
        </div>
      </div>

      {/* Day headers + grid — horizontally scrollable on mobile */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex flex-shrink-0 border-b border-gray-200 bg-white z-20 overflow-x-auto" style={{ paddingLeft: LABEL_W }}>
          <div className="flex min-w-[360px] flex-1">
            {days.map((d, i) => (
              <div key={i} className="flex-1 text-center py-1.5 border-l border-gray-100 first:border-l-0 min-w-[44px]">
                <div className="text-xs text-gray-400 uppercase tracking-wide">{format(d, 'EEE')}</div>
                <div className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center mx-auto rounded-full text-xs sm:text-sm font-medium mt-0.5 ${isToday(d) ? 'bg-blue-600 text-white' : 'text-gray-700'}`}>
                  {format(d, 'd')}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto relative">
          <div ref={gridRef} className="flex min-w-[360px]" style={{ height: totalH }}>
            {/* Hour labels */}
            <div className="flex-shrink-0 relative" style={{ width: LABEL_W }}>
              {HOURS.map(h => (
                <div key={h} style={{ height: hh }} className="relative border-b border-gray-100">
                  {h > 0 && (
                    <span className="absolute -top-2.5 right-2 text-xs text-gray-300 select-none tabular-nums">
                      {String(h).padStart(2, '0')}:00
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Day columns */}
            <div className="flex-1 flex">
              {days.map((day, di) => {
                const cols = layout(dayEntries(day));
                const todayCol = isToday(day);
                const ghostVisible = creating && isSameDay(creating.day, day) && Math.abs(creating.currentPx - creating.startPx) >= hh / 4;
                const ghostTop = ghostVisible ? Math.min(creating!.startPx, creating!.currentPx) : 0;
                const ghostH   = ghostVisible ? Math.max(Math.abs(creating!.currentPx - creating!.startPx), hh / 4) : 0;
                const ghostStartMin = Math.round((ghostTop / hh) * 60 / 15) * 15;
                const ghostEndMin   = Math.round(((ghostTop + ghostH) / hh) * 60 / 15) * 15;

                return (
                  <div
                    key={di}
                    className={`flex-1 relative border-l border-gray-100 first:border-l-0 ${todayCol ? 'bg-blue-50/30' : ''}`}
                    onMouseDown={ev => onColMouseDown(ev, day)}
                    style={{ cursor: creating ? 'crosshair' : 'default' }}
                  >
                    {/* Hour lines */}
                    {HOURS.map(h => (
                      <div key={h} style={{ height: hh }} className="border-b border-gray-100">
                        <div className="border-b border-gray-50 h-1/2" />
                      </div>
                    ))}

                    {/* Current time indicator */}
                    {todayCol && (
                      <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                        <div className="flex items-center">
                          <div className="w-2 h-2 bg-red-500 rounded-full -ml-1 flex-shrink-0" />
                          <div className="flex-1 h-px bg-red-400" />
                        </div>
                      </div>
                    )}

                    {/* Drag-to-create ghost block */}
                    {ghostVisible && (
                      <div
                        className="absolute left-0.5 right-0.5 bg-blue-100 border border-blue-400 border-dashed rounded pointer-events-none z-20"
                        style={{ top: ghostTop, height: ghostH }}
                      >
                        <div className="px-1 pt-0.5 text-xs text-blue-600 font-medium select-none">
                          {fmtMin(ghostStartMin)} – {fmtMin(ghostEndMin)}
                        </div>
                      </div>
                    )}

                    {/* Entry blocks */}
                    {cols.map(({ e, col, cols: totalCols }) => {
                      const top = entryTop(e);
                      const height = entryHeight(e);
                      const isDrag = drag?.entryId === e.id;
                      const m = e.description.match(/^([A-Z][A-Z0-9]+-\d+)([\s\S]*)$/);
                      const ticket = m?.[1] ?? null;
                      const afterTicket = m?.[2] ?? '';
                      const pipeIdx = afterTicket.indexOf('|');
                      const privateDesc = (pipeIdx >= 0 ? afterTicket.slice(0, pipeIdx) : afterTicket).trim() || null;
                      const rest = pipeIdx >= 0 ? afterTicket.slice(pipeIdx + 1).trim() : null;
                      const fontSize = Math.max(9, Math.min(11, hh / 6));
                      const isShort = height < 30;
                      // Primary label: always shown. Ticket entries show ticket+note, plain entries show full description.
                      const primaryLabel = ticket
                        ? `${ticket}${privateDesc ? ` ${privateDesc}` : ''}`
                        : e.description;

                      return (
                        <div
                          key={e.id}
                          className={`absolute rounded overflow-hidden select-none transition-shadow ${
                            e.synced
                              ? 'bg-green-50 border border-green-300 hover:border-green-400'
                              : 'bg-blue-50 border border-blue-300 hover:border-blue-400'
                          } ${isDrag ? 'shadow-xl ring-2 ring-blue-400 z-30 opacity-90' : 'shadow-sm hover:shadow-md z-10'}`}
                          style={{
                            top, height,
                            left: `${(col / totalCols) * 100 + 0.5}%`,
                            width: `calc(${100 / totalCols}% - 3px)`,
                            cursor: isDrag ? 'grabbing' : 'grab',
                          }}
                          title={e.description}
                          onMouseDown={ev => onMouseDown(ev, e, 'move')}
                        >
                          <div className={`${isShort ? 'px-1 py-0' : 'px-1.5 py-1'} h-full overflow-hidden pointer-events-none relative`}>
                            {!isShort && e.synced === 1 && <span className="absolute top-0.5 right-1 text-green-500 text-xs font-bold">✓</span>}
                            <div
                              className={`${ticket ? 'font-mono font-bold text-blue-700' : 'text-gray-700'} leading-none truncate`}
                              style={{ fontSize }}
                            >
                              {primaryLabel}
                            </div>
                            {!isShort && rest && (
                              <div className="text-gray-600 leading-tight truncate mt-0.5" style={{ fontSize }}>
                                {rest}
                              </div>
                            )}
                            {height > 50 && (
                              <div className="text-gray-400 leading-tight mt-0.5" style={{ fontSize: 9 }}>
                                {formatDuration(e.duration ?? 0)}
                              </div>
                            )}
                          </div>
                          <div
                            className="absolute bottom-0 left-0 right-0 h-3 cursor-s-resize z-20 hover:bg-blue-300 hover:opacity-40"
                            onMouseDown={ev => { ev.stopPropagation(); onMouseDown(ev, e, 'resize'); }}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Drag-to-create name modal */}
      {pendingCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setPendingCreate(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full mx-4" onClick={ev => ev.stopPropagation()}>
            <h2 className="font-semibold text-gray-800 mb-1 text-base">New Entry</h2>
            <p className="text-xs text-gray-400 mb-4">
              {format(new Date(pendingCreate.startMs), 'EEE, MMM d')} · {format(new Date(pendingCreate.startMs), 'HH:mm')} – {format(new Date(pendingCreate.endMs), 'HH:mm')}
            </p>
            <input
              autoFocus
              type="text"
              value={createDesc}
              onChange={e => setCreateDesc(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleConfirmCreate();
                if (e.key === 'Escape') setPendingCreate(null);
              }}
              placeholder="TICKET-123 | description"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPendingCreate(null)} className="px-4 py-2 text-sm text-gray-500 rounded-lg hover:bg-gray-100">Cancel</button>
              <button onClick={handleConfirmCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full mx-4" onClick={ev => ev.stopPropagation()}>
            <h2 className="font-semibold text-gray-800 mb-4 text-base">Edit Entry</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Description</label>
                <input
                  type="text"
                  value={edit.desc}
                  onChange={ev => setEdit(s => s && { ...s, desc: ev.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="TICKET-123 | description"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Start</label>
                  <input type="date" value={edit.startDate} onChange={ev => setEdit(s => s && { ...s, startDate: ev.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1" />
                  <input type="text" value={edit.startTime} onChange={ev => setEdit(s => s && { ...s, startTime: ev.target.value })}
                    placeholder="HH:MM"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">End</label>
                  <input type="date" value={edit.endDate} onChange={ev => setEdit(s => s && { ...s, endDate: ev.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1" />
                  <input type="text" value={edit.endTime} onChange={ev => setEdit(s => s && { ...s, endTime: ev.target.value })}
                    placeholder="HH:MM"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={saveEdit} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">Save</button>
              <button onClick={() => setEdit(null)} className="px-4 py-2 text-gray-500 text-sm rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
              <button onClick={deleteEdit} className="px-4 py-2 text-red-500 text-sm rounded-lg hover:bg-red-50 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
