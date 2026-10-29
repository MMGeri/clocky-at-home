import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { TimeEntry } from '../types';
import { formatDuration } from '../hooks/useTimer';

interface Props {
  entry: TimeEntry;
  onDelete: (id: number) => void;
  onUnsync: (id: number) => Promise<void>;
  onMarkSynced: (id: number) => Promise<void>;
  onUpdate: (id: number, data: Partial<TimeEntry>) => Promise<void>;
  onStart: (description: string) => void;
  onDuplicate: (entry: TimeEntry) => void;
  mergeCount?: number;
  onMergeClick?: () => void;
  isMergeExpanded?: boolean;
}

type EditField = 'desc' | 'startTime' | 'endTime' | 'date' | null;

function toDateStr(iso: string) { return format(new Date(iso), 'yyyy-MM-dd'); }
function toTimeStr(iso: string) { return format(new Date(iso), 'HH:mm'); }

function parseTimeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let h: number, m: number;
  if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
  else if (digits.length === 3) { h = parseInt(digits[0], 10); m = parseInt(digits.slice(1), 10); }
  else { h = parseInt(digits.slice(0, 2), 10); m = parseInt(digits.slice(2, 4), 10); }
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TIME_W = 'w-[46px]';
const timeCellBase = `text-xs tabular-nums text-center px-1 py-[3px] border bg-white ${TIME_W}`;
const timeDisplay = `${timeCellBase} border-gray-200 text-gray-600 hover:border-gray-400 cursor-pointer select-none transition-colors`;
const timeEdit    = `${timeCellBase} border-blue-400 text-gray-800 outline-none`;

// Parse description into ticket + privateDesc + publicDesc.
// Supports: "TICKET", "TICKET private", "TICKET | public", "TICKET private | public"
function parseDesc(raw: string) {
  const m = raw.match(/^([A-Z][A-Z0-9]+-\d+)([\s\S]*)$/);
  if (!m) return { ticket: null, privateDesc: null, publicDesc: null };
  const ticket = m[1];
  const rest = m[2]; // everything after ticket key (may be empty)
  const pipeIdx = rest.indexOf('|');
  if (pipeIdx >= 0) {
    return {
      ticket,
      privateDesc: rest.slice(0, pipeIdx).trim() || null,
      publicDesc:  rest.slice(pipeIdx + 1).trim() || null,
    };
  }
  return { ticket, privateDesc: rest.trim() || null, publicDesc: null };
}

// Return caret position in the raw description string from a mouse click on the display div.
function caretPosFromClick(
  ev: React.MouseEvent<HTMLDivElement>,
  raw: string,
  ticket: string | null,
  privateDesc: string | null,
  publicDesc: string | null,
): number | null {
  try {
    let textNode: Node | null = null;
    let offset = 0;
    const doc = document as any;
    if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (r) { textNode = r.startContainer; offset = r.startOffset; }
    } else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(ev.clientX, ev.clientY);
      if (p) { textNode = p.offsetNode; offset = p.offset; }
    }
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
    if (!ticket) return Math.min(offset, raw.length);

    const spans = Array.from((ev.currentTarget as Element).querySelectorAll('span'));
    const si = spans.findIndex(s => s.contains(textNode));
    if (si < 0) return null;
    if (si === 0) return ticket.length; // ticket badge → after key

    // Build start positions for each span after the badge
    const positions: number[] = [];
    const rest = raw.slice(ticket.length);
    const pipeIdx = rest.indexOf('|');

    if (privateDesc) {
      const ps = raw.indexOf(privateDesc, ticket.length);
      positions.push(ps >= 0 ? ps : ticket.length + 1);
    }
    if (pipeIdx >= 0) {
      positions.push(ticket.length + pipeIdx); // | span
      const pubStart = ticket.length + pipeIdx + 1 + (rest[pipeIdx + 1] === ' ' ? 1 : 0);
      positions.push(pubStart);
    }

    const startPos = positions[si - 1] ?? raw.length;
    return Math.min(startPos + offset, raw.length);
  } catch {
    return null;
  }
}

export default function TimeEntryRow({ entry, onDelete, onUnsync, onMarkSynced, onUpdate, onStart, onDuplicate, mergeCount, onMergeClick, isMergeExpanded }: Props) {
  const [unsyncing, setUnsyncing] = useState(false);
  const [showError, setShowError] = useState(false);
  const [editField, setEditField] = useState<EditField>(null);
  const [editDesc, setEditDesc] = useState(entry.description);
  const [timeInput, setTimeInput] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const descInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const { ticket, privateDesc, publicDesc } = parseDesc(entry.description);
  const dur = entry.duration ?? 0;

  // Focus desc input and apply saved caret position when editing starts
  useEffect(() => {
    if (editField === 'desc' && descInputRef.current) {
      const el = descInputRef.current;
      el.focus();
      if (pendingCaret.current !== null) {
        const pos = pendingCaret.current;
        pendingCaret.current = null;
        el.setSelectionRange(pos, pos);
      }
    }
  }, [editField]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  async function handleUnsync() {
    setUnsyncing(true);
    await onUnsync(entry.id);
    setUnsyncing(false);
  }

  function openDesc(ev: React.MouseEvent<HTMLDivElement>) {
    pendingCaret.current = caretPosFromClick(ev, entry.description, ticket, privateDesc, publicDesc);
    setEditDesc(entry.description);
    setEditField('desc');
  }

  function openStartTime() { setTimeInput(toTimeStr(entry.start_time)); setEditField('startTime'); }
  function openEndTime()   { setTimeInput(entry.end_time ? toTimeStr(entry.end_time) : ''); setEditField('endTime'); }
  function openDate()      { setDateInput(toDateStr(entry.start_time)); setEditField('date'); }

  async function saveDesc() {
    setEditField(null);
    const trimmed = editDesc.trim();
    if (trimmed === entry.description) return;
    await onUpdate(entry.id, { description: trimmed });
  }

  async function saveStartTime() {
    setEditField(null);
    const parsed = parseTimeInput(timeInput);
    if (!parsed) return;
    const [h, m] = parsed.split(':').map(Number);
    const newStart = new Date(entry.start_time);
    newStart.setHours(h, m, 0, 0);
    const newEnd = entry.end_time ? new Date(entry.end_time) : null;
    const duration = newEnd ? Math.floor((newEnd.getTime() - newStart.getTime()) / 1000) : entry.duration;
    await onUpdate(entry.id, { start_time: newStart.toISOString(), end_time: newEnd?.toISOString(), duration: duration ?? undefined });
  }

  async function saveEndTime() {
    setEditField(null);
    const parsed = parseTimeInput(timeInput);
    if (!parsed) return;
    const [h, m] = parsed.split(':').map(Number);
    const newEnd = new Date(entry.end_time ?? entry.start_time);
    newEnd.setHours(h, m, 0, 0);
    const duration = Math.floor((newEnd.getTime() - new Date(entry.start_time).getTime()) / 1000);
    if (duration <= 0) return;
    await onUpdate(entry.id, { end_time: newEnd.toISOString(), duration });
  }

  async function saveDate() {
    setEditField(null);
    if (!dateInput) return;
    const [y, mo, d] = dateInput.split('-').map(Number);
    const oldStart = new Date(entry.start_time);
    const newStart = new Date(oldStart);
    newStart.setFullYear(y, mo - 1, d);
    let newEnd: Date | null = null;
    if (entry.end_time) {
      const diff = new Date(entry.end_time).getTime() - oldStart.getTime();
      newEnd = new Date(newStart.getTime() + diff);
    }
    await onUpdate(entry.id, {
      start_time: newStart.toISOString(),
      end_time: newEnd?.toISOString() ?? entry.end_time ?? undefined,
      duration: entry.duration ?? undefined,
    });
  }

  function openMenu() {
    if (menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setShowMenu(true);
  }

  function copyTicket() {
    if (!ticket) return;

    // Try modern clipboard API first
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ticket).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(err => {
        console.error('Clipboard API failed:', err);
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const textarea = document.createElement('textarea');
    textarea.value = ticket!;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Fallback copy failed:', err);
    }
    document.body.removeChild(textarea);
  }

  const startLabel = toTimeStr(entry.start_time);
  const endLabel   = entry.end_time ? toTimeStr(entry.end_time) : '…';
  const dateLabel  = format(new Date(entry.start_time), 'MMM d');

  return (
    <div className="entry-row flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-gray-100 last:border-0 group">

      {/* Sync status */}
      <div className="w-6 flex-shrink-0 flex items-center justify-center">
        {entry.synced === 1 ? (
          <button title="Synced to Jira — click to mark as unsynced" onClick={handleUnsync} disabled={unsyncing}
            className="text-green-500 hover:text-gray-400 transition-colors text-lg leading-none">✓</button>
        ) : entry.sync_error ? (
          <button title={entry.sync_error} onClick={() => setShowError(v => !v)}
            className="text-red-500 text-lg leading-none">✕</button>
        ) : (
          <button title="Mark as synced" onClick={() => onMarkSynced(entry.id)}
            className="w-5 h-5 rounded-full border-2 border-gray-200 hover:border-green-400 hover:bg-green-50 transition-colors" />
        )}
      </div>

      {/* Merge count */}
      {mergeCount && (
        <button
          onClick={onMergeClick}
          className={`text-xs font-semibold px-2 py-1 rounded whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer ${
            isMergeExpanded
              ? 'text-white bg-blue-600 hover:bg-blue-700'
              : 'text-blue-700 bg-blue-100 hover:bg-blue-200 hover:text-blue-800'
          }`}
          title="Click to expand/collapse merged entries"
        >
          ×{mergeCount}
        </button>
      )}

      {/* Description */}
      <div className="flex-1 min-w-0">
        {editField === 'desc' ? (
          <input
            ref={descInputRef}
            type="text"
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setEditField(null); setEditDesc(entry.description); }
            }}
            className="w-full text-sm bg-transparent outline-none border-b-2 border-blue-400 py-0.5 text-gray-800"
            placeholder="TICKET-123 private | description"
          />
        ) : (
          <div
            onClick={openDesc}
            className="flex items-center gap-1.5 flex-wrap cursor-text px-1.5 py-0.5 -mx-1.5 border border-transparent hover:border-gray-200 transition-colors"
          >
            {ticket ? (
              <>
                <span className="inline-block bg-blue-100 text-blue-700 text-xs font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0">
                  {ticket}
                </span>
                {privateDesc && (
                  <span className="text-sm text-gray-500 truncate">{privateDesc}</span>
                )}
                {publicDesc && (
                  <>
                    <span className="text-gray-300 text-sm">|</span>
                    <span className="text-sm text-gray-800 truncate">{publicDesc}</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-sm text-gray-800 truncate">
                {entry.description || <span className="text-gray-300 italic text-xs">click to add description</span>}
              </span>
            )}
          </div>
        )}
        {showError && entry.sync_error && (
          <p className="text-xs text-red-600 mt-1 bg-red-50 rounded px-2 py-1">{entry.sync_error}</p>
        )}
      </div>

      {/* Date + from/to times */}
      <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
        {editField === 'date' ? (
          <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)}
            onBlur={saveDate} onKeyDown={e => { if (e.key === 'Enter') saveDate(); if (e.key === 'Escape') setEditField(null); }}
            autoFocus className="text-xs px-1 py-[3px] border border-blue-400 bg-white outline-none text-gray-800 w-[112px]" />
        ) : (
          <button onClick={openDate} title="Change date"
            className="text-xs text-gray-400 px-1 py-[3px] border border-transparent hover:border-gray-200 transition-colors bg-white w-[52px] text-center">
            {dateLabel}
          </button>
        )}

        {editField === 'startTime' ? (
          <input type="text" value={timeInput} onChange={e => setTimeInput(e.target.value)}
            onFocus={e => e.target.select()} onBlur={saveStartTime}
            onKeyDown={e => { if (e.key === 'Enter') saveStartTime(); if (e.key === 'Escape') setEditField(null); }}
            autoFocus className={timeEdit} placeholder="09:00" />
        ) : (
          <span onClick={openStartTime} className={timeDisplay}>{startLabel}</span>
        )}

        <span className="text-gray-300 text-xs">–</span>

        {editField === 'endTime' ? (
          <input type="text" value={timeInput} onChange={e => setTimeInput(e.target.value)}
            onFocus={e => e.target.select()} onBlur={saveEndTime}
            onKeyDown={e => { if (e.key === 'Enter') saveEndTime(); if (e.key === 'Escape') setEditField(null); }}
            autoFocus className={timeEdit} placeholder="16:00" />
        ) : (
          <span onClick={openEndTime} className={timeDisplay}>{endLabel}</span>
        )}
      </div>

      {/* Duration */}
      <div className="text-sm font-mono font-medium text-gray-700 w-14 sm:w-16 text-right flex-shrink-0">
        {formatDuration(dur)}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Play button */}
        <button
          onClick={() => onStart(entry.description)}
          title="Start timer with this entry"
          className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-1.5 py-1 rounded transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </button>

        {/* Copy ticket button */}
        <button
          onClick={() => ticket && copyTicket()}
          disabled={!ticket}
          title={ticket ? `Copy ${ticket}` : 'No ticket key'}
          className={`px-1.5 py-1 rounded transition-colors ${ticket ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer' : 'text-gray-200 cursor-default'}`}
        >
          {copied
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          }
        </button>

        {/* Dropdown menu */}
        <div>
          <button
            ref={menuButtonRef}
            onClick={() => showMenu ? setShowMenu(false) : openMenu()}
            title="More options"
            className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 px-1.5 py-1 rounded transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
          </button>

          {showMenu && menuPos && createPortal(
            <div
              ref={menuRef}
              className="w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1"
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
            >
              <button
                onClick={() => {
                  onDuplicate(entry);
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <span>📋</span> Duplicate
              </button>
              <button
                onClick={() => {
                  onDelete(entry.id);
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <span>🗑</span> Delete
              </button>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}
