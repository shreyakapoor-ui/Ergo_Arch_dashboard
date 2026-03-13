import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Printer, Calendar, TrendingUp, TrendingDown, Minus,
  ChevronDown, Pencil, Plus, Trash2,
  Flag, AlertTriangle, GitBranch, Link2, Shuffle, Globe, Ban,
  ArrowRight, Loader2, Download, GripVertical,
} from 'lucide-react';
import { generateTimelinePptx } from '../utils/generateTimelinePptx';
import { Button } from './ui/button';
import { supabase } from '../supabaseClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TagType     = 'milestone' | 'risk' | 'decision' | 'dependency' | 'scope_change' | 'external' | 'blocker';
type TagStatus   = 'open' | 'resolved' | 'info';
type TagSeverity = 'none' | 'low' | 'medium' | 'high';

interface TimelineItem {
  id: string;
  program_id: string;
  phase_id: string | null;
  type: TagType;
  title: string;
  detail: string | null;
  date: string | null;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  status: TagStatus;
  severity: TagSeverity;
  created_at: string;
  updated_at: string;
}

interface FormDraft {
  type: TagType;
  title: string;
  isRange: boolean;
  date: string;
  start_date: string;
  end_date: string;
  phase_id: string;
  owner: string;
  detail: string;
  status: TagStatus;
  severity: TagSeverity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag config
// ─────────────────────────────────────────────────────────────────────────────

const TAG_CONFIG: Record<TagType, {
  label: string;
  Icon: typeof Flag;
  bg: string; text: string; border: string; dot: string;
}> = {
  milestone:    { label: 'Milestone',    Icon: Flag,          bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400'    },
  risk:         { label: 'Risk',         Icon: AlertTriangle, bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400'     },
  decision:     { label: 'Decision',     Icon: GitBranch,     bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-400'   },
  dependency:   { label: 'Dependency',   Icon: Link2,         bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-400'  },
  scope_change: { label: 'Scope Change', Icon: Shuffle,       bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-400'  },
  external:     { label: 'External',     Icon: Globe,         bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-400'    },
  blocker:      { label: 'Blocker',      Icon: Ban,           bg: 'bg-rose-50',   text: 'text-rose-800',   border: 'border-rose-200',   dot: 'bg-rose-500'    },
};

const ALL_TAG_TYPES = Object.keys(TAG_CONFIG) as TagType[];
const FILTER_PRESETS: TagType[] = ['milestone', 'risk', 'decision'];
const PROGRAM_ID = 'ergo-q1';

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─── Timeline geometry constants ─────────────────────────────────────────────
const TIMELINE_START = new Date('2026-01-01T12:00:00');
const TIMELINE_END   = new Date('2026-12-31T12:00:00');
const PX_PER_DAY     = 8;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
/** Parse a YYYY-MM-DD string as local noon to avoid UTC-offset day-shift bugs. */
function toDate(s: string): Date {
  return new Date(s.length === 10 ? s + 'T12:00:00' : s);
}
function fmtDate(s: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(toDate(s));
}

// ─── Runtime current-date utility (America/New_York) ─────────────────────────

/**
 * Returns today's date string (YYYY-MM-DD) in the America/New_York timezone.
 * Uses Intl.DateTimeFormat so it's correct regardless of the host machine's
 * local timezone.  Call once at startup and treat the result as immutable for
 * the session lifetime.
 */
function getCurrentDateET(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // → "YYYY-MM-DD"
}

/**
 * ISO date string (YYYY-MM-DD) for today in ET — resolved once at module load.
 * Single source of truth for all "today" logic in this module.
 */
const TODAY_ISO = getCurrentDateET();

/** Today as a Date object (ET), resolved once at module load. */
const TODAY = toDate(TODAY_ISO);

/** Returns today's date string (YYYY-MM-DD, ET). Used as the default date in forms. */
function todayISO() { return TODAY_ISO; }

/** Formatted display string for today in ET, e.g. "Mar 13". */
const TODAY_DISPLAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
}).format(new Date());

// Monthly tick marks across the full year
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_TICKS = Array.from({ length: 12 }, (_, m) => ({
  date: new Date(2026, m, 1, 12, 0, 0),
  label: MONTH_LABELS[m],
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tag lane assignment
// ─────────────────────────────────────────────────────────────────────────────

function assignLanes(items: TimelineItem[], xFn: (d: Date) => number) {
  const filtered = items.filter(t => t.date || t.start_date);
  const sorted = [...filtered].sort((a, b) =>
    toDate(a.date ?? a.start_date!).getTime() - toDate(b.date ?? b.start_date!).getTime()
  );
  const CHIP_W = 115;
  const laneRight = [-1000, -1000, -1000];
  return sorted.map(tag => {
    const x = xFn(toDate(tag.date ?? tag.start_date!));
    let lane = 0;
    for (let i = 0; i < 3; i++) {
      if (x > laneRight[i] + 6) { lane = i; break; }
    }
    laneRight[lane] = x + CHIP_W;
    return { tag, x, lane };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// New data model
// ─────────────────────────────────────────────────────────────────────────────

type Confidence = 'On track' | 'Watch' | 'At risk';

interface PhaseRow { id: string; phase: string; dates: string; focus: string; status: string; }

interface GridCol { id: string; label: string; }
interface GridRow { id: string; cells: Record<string, string>; }
interface GridData { columns: GridCol[]; rows: GridRow[]; }

interface SprintItem {
  id: string;
  label: string;
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;     // 'YYYY-MM-DD'
  color: string;       // hex color for the bar
  status: string;
  grid: GridData;
  notes: string;
}

interface QuarterItem {
  id: string;
  label: string;       // e.g. "Q1 2026"
  startDate: string;
  endDate: string;
  color: string;       // hex color for the quarter bar
  sprints: SprintItem[];
  grid: GridData;
  notes: string;
}

interface TimelineBoard {
  title: string;
  subtext: string;
  confidence: Confidence;
  quarters: QuarterItem[];
  footer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default data
// ─────────────────────────────────────────────────────────────────────────────

function emptyGrid(): GridData {
  return {
    columns: [
      { id: 'c1', label: 'Item' },
      { id: 'c2', label: 'Owner' },
      { id: 'c3', label: 'Status' },
    ],
    rows: [],
  };
}

const DEFAULT_QUARTERS: QuarterItem[] = [
  {
    id: 'q1', label: 'Q1 2026',
    startDate: '2026-01-01', endDate: '2026-03-31',
    color: '#3b82f6',
    sprints: [
      { id: 'p1', label: 'Backend Pipeline', startDate: '2026-01-01', endDate: '2026-03-05', color: '#93c5fd', status: 'Done', grid: emptyGrid(), notes: '' },
      { id: 'p2', label: 'Calibration + Testing', startDate: '2026-03-05', endDate: '2026-03-18', color: '#fcd34d', status: 'In progress', grid: emptyGrid(), notes: '' },
      { id: 'p3', label: 'Design Sprint 1', startDate: '2026-03-05', endDate: '2026-03-18', color: '#c4b5fd', status: 'Kicking off today', grid: emptyGrid(), notes: '' },
      { id: 'p4', label: 'Design Sprint 2 + Build', startDate: '2026-03-19', endDate: '2026-03-31', color: '#6ee7b7', status: 'Starting Mar 19', grid: emptyGrid(), notes: '' },
    ],
    grid: emptyGrid(), notes: '',
  },
  {
    id: 'q2', label: 'Q2 2026',
    startDate: '2026-04-01', endDate: '2026-06-30',
    color: '#10b981',
    sprints: [
      { id: 'p5', label: 'MVP Launch', startDate: '2026-04-01', endDate: '2026-04-01', color: '#f87171', status: 'Target', grid: emptyGrid(), notes: '' },
      { id: 'p6', label: 'Beta', startDate: '2026-04-02', endDate: '2026-05-31', color: '#a78bfa', status: 'Not started', grid: emptyGrid(), notes: '' },
    ],
    grid: emptyGrid(), notes: '',
  },
  {
    id: 'q3', label: 'Q3 2026',
    startDate: '2026-07-01', endDate: '2026-09-30',
    color: '#f59e0b',
    sprints: [],
    grid: emptyGrid(), notes: '',
  },
  {
    id: 'q4', label: 'Q4 2026',
    startDate: '2026-10-01', endDate: '2026-12-31',
    color: '#8b5cf6',
    sprints: [],
    grid: emptyGrid(), notes: '',
  },
];

const BOARD_KEY = 'exec-timeline-board-v4';

function loadBoard(): TimelineBoard {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<TimelineBoard>;
      return {
        title: p.title ?? 'Program Timeline 2026',
        subtext: p.subtext ?? 'MVP Launch: April 1, 2026',
        confidence: p.confidence ?? 'On track',
        footer: p.footer ?? '',
        quarters: p.quarters ?? DEFAULT_QUARTERS,
      };
    }
  } catch {}
  return {
    title: 'Program Timeline 2026',
    subtext: 'MVP Launch: April 1, 2026',
    confidence: 'On track',
    footer: 'Backend pipeline complete. Calibration and Design Sprint 1 running in parallel through March 18.',
    quarters: DEFAULT_QUARTERS,
  };
}

function autoSelectQuarterId(quarters: QuarterItem[]): string | null {
  const q = quarters.find(q => TODAY >= toDate(q.startDate) && TODAY <= toDate(q.endDate));
  return q?.id ?? quarters[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence config
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_CYCLE: Confidence[] = ['On track', 'Watch', 'At risk'];
const CONFIDENCE_STYLE: Record<Confidence, { pill: string; icon: typeof TrendingUp }> = {
  'On track': { pill: 'bg-emerald-50 border-emerald-100 text-emerald-700', icon: TrendingUp   },
  'Watch':    { pill: 'bg-amber-50  border-amber-100  text-amber-700',     icon: Minus        },
  'At risk':  { pill: 'bg-red-50    border-red-100    text-red-700',       icon: TrendingDown },
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase status presets
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_PRESETS = [
  { label: 'Not started',       style: 'text-gray-400  bg-gray-50'    },
  { label: 'Running',           style: 'text-green-700 bg-green-50'   },
  { label: 'In progress',       style: 'text-amber-700 bg-amber-50'   },
  { label: 'Kicking off today', style: 'text-blue-700  bg-blue-50'    },
  { label: 'Starting Mar 19',   style: 'text-gray-700  bg-gray-100'   },
  { label: 'Target',            style: 'text-purple-700 bg-purple-50' },
  { label: 'At risk',           style: 'text-red-700   bg-red-50'     },
  { label: 'Done',              style: 'text-slate-700 bg-slate-100'  },
  { label: 'Blocked',           style: 'text-rose-700  bg-rose-50'    },
  { label: 'Deferred',          style: 'text-zinc-500  bg-zinc-100'   },
];
function statusStyle(label: string) {
  return STATUS_PRESETS.find(p => p.label === label)?.style ?? 'text-gray-700 bg-gray-100';
}

// ─────────────────────────────────────────────────────────────────────────────
// EditableText
// ─────────────────────────────────────────────────────────────────────────────

function EditableText({
  value, onChange, className = '', multiline = false, placeholder,
}: { value: string; onChange: (v: string) => void; className?: string; multiline?: boolean; placeholder?: string; }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== value) onChange(t); else setDraft(value);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); }
  }
  const base = `${className} w-full bg-transparent outline-none`;
  if (editing) return multiline
    ? <textarea autoFocus value={draft} rows={2} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} className={`${base} resize-none border-b border-blue-300`} />
    : <input    autoFocus value={draft}           onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} className={`${base} border-b border-blue-300`} />;
  return (
    <span onClick={() => setEditing(true)} title="Click to edit"
      className={`${className} group cursor-text inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 hover:bg-gray-50 transition-colors`}>
      {value || <span className="text-gray-300 italic text-xs">{placeholder ?? 'Click to add…'}</span>}
      <Pencil className="h-2.5 w-2.5 text-gray-300 opacity-0 group-hover:opacity-100 flex-none transition-opacity" />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown renderer (bullets + bold only)
// ─────────────────────────────────────────────────────────────────────────────

function renderInline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p
  );
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function flushList() {
    if (listItems.length) {
      nodes.push(<ul key={`ul-${nodes.length}`} className="list-disc list-inside space-y-0.5">{listItems}</ul>);
      listItems = [];
    }
  }

  lines.forEach((line, i) => {
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      listItems.push(<li key={i}>{renderInline(bullet[1])}</li>);
    } else {
      flushList();
      if (line.trim()) nodes.push(<p key={i} className="leading-snug">{renderInline(line)}</p>);
    }
  });
  flushList();
  return <div className="space-y-1 text-sm text-gray-600">{nodes}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkdownFocusCell — inline editable Focus field with bullets + bold toolbar
// ─────────────────────────────────────────────────────────────────────────────

function MarkdownFocusCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(value);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(value); }, [value]);

  function commit() { setEditing(false); if (draft !== value) onChange(draft); }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); }
  }

  function insertAtCursor(prefix: string, suffix = '') {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd;
    const sel   = draft.slice(start, end);
    const next  = draft.slice(0, start) + prefix + sel + suffix + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + sel.length);
    });
  }

  function insertBullet() {
    const el = textareaRef.current;
    if (!el) { setDraft(d => (d ? d + '\n- ' : '- ')); return; }
    const pos    = el.selectionStart;
    const before = draft.slice(0, pos);
    const after  = draft.slice(pos);
    const pfx    = before.length === 0 || before.endsWith('\n') ? '- ' : '\n- ';
    const next   = before + pfx + after;
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + pfx.length, pos + pfx.length); });
  }

  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} className="cursor-text group rounded px-0.5 -mx-0.5 hover:bg-gray-50 transition-colors min-h-[1.5rem]">
        {value
          ? renderMarkdown(value)
          : <span className="text-gray-300 italic text-xs">Click to add focus…</span>
        }
        <Pencil className="inline h-2.5 w-2.5 text-gray-300 opacity-0 group-hover:opacity-100 ml-1 transition-opacity" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
      <div className="flex gap-1">
        <button type="button" onMouseDown={e => { e.preventDefault(); insertBullet(); }}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors">
          • Bullet
        </button>
        <button type="button" onMouseDown={e => { e.preventDefault(); insertAtCursor('**', '**'); }}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold transition-colors">
          B Bold
        </button>
      </div>
      <textarea
        ref={textareaRef} autoFocus value={draft} rows={4}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        className="w-full text-sm border border-blue-300 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
        placeholder="Use - for bullets, **text** for bold"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusDropdown (phase rows)
// ─────────────────────────────────────────────────────────────────────────────

function StatusDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${statusStyle(value)}`}>
        {value}<ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-[200] bg-white rounded-xl shadow-xl border border-gray-100 p-2 flex flex-col gap-1 min-w-[170px]">
          {STATUS_PRESETS.map(p => (
            <button key={p.label} onClick={() => { onChange(p.label); setOpen(false); }}
              className={`text-left text-xs font-medium px-2.5 py-1.5 rounded-full transition-opacity hover:opacity-80 ${p.style} ${p.label === value ? 'ring-1 ring-offset-1 ring-current' : ''}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PhaseTagCounts — compact badge summary for the phase table Tags column
// ─────────────────────────────────────────────────────────────────────────────

function PhaseTagCounts({
  phaseId, tags, onTagClick, onPhaseClick,
}: {
  phaseId: string;
  tags: TimelineItem[];
  onTagClick: (tag: TimelineItem) => void;
  onPhaseClick: () => void;
}) {
  const phaseTags = tags.filter(t => t.phase_id === phaseId);
  if (phaseTags.length === 0) return (
    <span className="text-gray-300 text-xs cursor-pointer hover:text-gray-400 transition-colors" onClick={onPhaseClick}>—</span>
  );
  const byType: Partial<Record<TagType, TimelineItem[]>> = {};
  for (const t of phaseTags) { if (!byType[t.type]) byType[t.type] = []; byType[t.type]!.push(t); }
  return (
    <div className="flex flex-wrap gap-1">
      {(Object.entries(byType) as [TagType, TimelineItem[]][]).map(([type, typeTags]) => {
        const cfg  = TAG_CONFIG[type];
        const Icon = cfg.Icon;
        return (
          <button key={type} type="button"
            onClick={e => { e.stopPropagation(); onTagClick(typeTags[0]); }}
            title={`${typeTags.length} ${cfg.label}${typeTags.length > 1 ? 's' : ''} – click to view`}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${cfg.bg} ${cfg.text}`}>
            <Icon className="h-2.5 w-2.5" />{typeTags.length}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FlexGrid — editable planning grid
// ─────────────────────────────────────────────────────────────────────────────

function FlexGrid({ data, onChange }: { data: GridData; onChange: (d: GridData) => void }) {
  const [editCell,      setEditCell]      = useState<{ r: string; c: string } | null>(null);
  const [editColId,     setEditColId]     = useState<string | null>(null);
  const [dragRowId,     setDragRowId]     = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);
  const [dragColId,     setDragColId]     = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // ── Row helpers ────────────────────────────────────────────────────────────
  function addRow() {
    const id = `r${Date.now()}`;
    const cells: Record<string, string> = {};
    data.columns.forEach(c => { cells[c.id] = ''; });
    onChange({ ...data, rows: [...data.rows, { id, cells }] });
  }
  function deleteRow(rid: string) { onChange({ ...data, rows: data.rows.filter(r => r.id !== rid) }); }
  function updateCell(rid: string, cid: string, val: string) {
    onChange({ ...data, rows: data.rows.map(r => r.id === rid ? { ...r, cells: { ...r.cells, [cid]: val } } : r) });
  }
  function reorderRow(fromId: string, toId: string) {
    if (fromId === toId) return;
    const rows = [...data.rows];
    const from = rows.findIndex(r => r.id === fromId);
    const to   = rows.findIndex(r => r.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    onChange({ ...data, rows });
  }

  // ── Column helpers ─────────────────────────────────────────────────────────
  function addColumn() {
    const id = `c${Date.now()}`;
    onChange({
      columns: [...data.columns, { id, label: 'Column' }],
      rows: data.rows.map(r => ({ ...r, cells: { ...r.cells, [id]: '' } })),
    });
  }
  function renameCol(cid: string, label: string) {
    onChange({ ...data, columns: data.columns.map(c => c.id === cid ? { ...c, label } : c) });
  }
  function deleteCol(cid: string) {
    if (data.columns.length <= 1) return;
    onChange({
      columns: data.columns.filter(c => c.id !== cid),
      rows: data.rows.map(r => { const cells = { ...r.cells }; delete cells[cid]; return { ...r, cells }; }),
    });
  }
  function reorderCol(fromId: string, toId: string) {
    if (fromId === toId) return;
    const cols = [...data.columns];
    const from = cols.findIndex(c => c.id === fromId);
    const to   = cols.findIndex(c => c.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = cols.splice(from, 1);
    cols.splice(to, 0, moved);
    onChange({ ...data, columns: cols });
  }

  return (
    <div className="rounded-lg border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="w-6" />{/* aligns with row grip handles */}
            {data.columns.map(col => (
              <th key={col.id}
                draggable
                onDragStart={e => { e.stopPropagation(); setDragColId(col.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e  => { e.preventDefault(); if (dragColId && dragColId !== col.id) setDragOverColId(col.id); }}
                onDragLeave={() => setDragOverColId(null)}
                onDrop={e      => { e.preventDefault(); if (dragColId) reorderCol(dragColId, col.id); setDragColId(null); setDragOverColId(null); }}
                onDragEnd={()  => { setDragColId(null); setDragOverColId(null); }}
                className={`px-3 py-2 text-left font-medium text-xs select-none transition-all
                  ${dragColId === col.id ? 'opacity-30 bg-blue-50' : 'text-gray-500'}
                  ${dragOverColId === col.id ? 'border-l-2 border-blue-400 bg-blue-50' : ''}`}
                style={{ cursor: 'grab' }}
              >
                <div className="group/col flex items-center gap-1 min-w-[60px]">
                  <GripVertical className="h-3 w-3 text-gray-300 flex-none" style={{ transform: 'rotate(90deg)' }} />
                  {editColId === col.id
                    ? <input autoFocus value={col.label}
                        onChange={e => renameCol(col.id, e.target.value)}
                        onBlur={() => setEditColId(null)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditColId(null); }}
                        className="flex-1 bg-transparent outline-none border-b border-blue-300 text-xs font-medium" />
                    : <span onClick={e => { e.stopPropagation(); setEditColId(col.id); }}
                        className="flex-1 cursor-text hover:text-gray-700 uppercase tracking-wide">{col.label}</span>
                  }
                  {data.columns.length > 1 && (
                    <button onClick={e => { e.stopPropagation(); deleteCol(col.id); }}
                      className="opacity-0 group-hover/col:opacity-100 p-0.5 rounded hover:bg-gray-200 text-gray-300 hover:text-red-400 flex-none transition-opacity">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </th>
            ))}
            <th className="w-8 px-2 py-2">
              <button onClick={addColumn} title="Add column" className="text-gray-300 hover:text-blue-500 transition-colors">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => (
            <tr key={row.id}
              draggable
              onDragStart={e => { setDragRowId(row.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e  => { e.preventDefault(); if (dragRowId && dragRowId !== row.id) setDragOverRowId(row.id); }}
              onDragLeave={() => setDragOverRowId(null)}
              onDrop={e      => { e.preventDefault(); if (dragRowId) reorderRow(dragRowId, row.id); setDragRowId(null); setDragOverRowId(null); }}
              onDragEnd={()  => { setDragRowId(null); setDragOverRowId(null); }}
              className={`group/row border-b border-gray-50 transition-all
                ${dragRowId === row.id ? 'opacity-30' : 'hover:bg-blue-50/30'}
                ${dragOverRowId === row.id && dragRowId !== row.id ? 'border-t-2 border-blue-400 bg-blue-50/30' : ''}`}
            >
              <td className="w-6 pl-2" style={{ cursor: 'grab' }}>
                <GripVertical className="h-3.5 w-3.5 text-gray-300 hover:text-gray-500 transition-colors" />
              </td>
              {data.columns.map(col => (
                <td key={col.id} className="px-3 py-2" onClick={() => setEditCell({ r: row.id, c: col.id })}>
                  {editCell?.r === row.id && editCell?.c === col.id
                    ? <input autoFocus value={row.cells[col.id] ?? ''}
                        onChange={e => updateCell(row.id, col.id, e.target.value)}
                        onBlur={() => setEditCell(null)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditCell(null); }}
                        className="w-full bg-transparent outline-none border-b border-blue-300 min-w-[80px]" />
                    : <span className="cursor-text text-gray-700">{row.cells[col.id] || <span className="text-gray-300">—</span>}</span>
                  }
                </td>
              ))}
              <td className="w-8" />
              <td className="pr-2 py-1 w-10">
                <button onClick={() => deleteRow(row.id)}
                  className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all">
                  <Trash2 className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={data.columns.length + 3} className="px-3 py-5 text-center text-xs text-gray-300">
                No rows yet — click + Add row to start
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <button onClick={addRow} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 px-3 py-2.5 transition-colors w-full hover:bg-gray-50">
        <Plus className="h-3 w-3" />Add row
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TagDetailPanel — right-side overlay inside the drawer
// ─────────────────────────────────────────────────────────────────────────────

function TagDetailPanel({
  tag, phases, onClose, onEdit, onDelete,
}: {
  tag: TimelineItem;
  phases: PhaseRow[];
  onClose: () => void;
  onEdit: (t: TimelineItem) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = TAG_CONFIG[tag.type];
  const Icon = cfg.Icon;
  const phase = phases.find(p => p.id === tag.phase_id);

  const dateLabel = tag.date
    ? fmtDate(tag.date)
    : tag.start_date && tag.end_date
    ? `${fmtDate(tag.start_date)} – ${fmtDate(tag.end_date)}`
    : tag.start_date ? fmtDate(tag.start_date) : '—';

  const statusColors: Record<TagStatus, string> = {
    open:     'bg-amber-50 text-amber-700',
    resolved: 'bg-green-50 text-green-700',
    info:     'bg-blue-50 text-blue-700',
  };
  const severityColors: Record<TagSeverity, string> = {
    none: 'text-gray-400', low: 'text-yellow-600', medium: 'text-orange-600', high: 'text-red-600',
  };

  return (
    <div className="absolute inset-y-0 right-0 w-72 bg-white border-l border-gray-100 shadow-xl z-30 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={`p-1.5 rounded-lg ${cfg.bg}`}><Icon className={`h-3.5 w-3.5 ${cfg.text}`} /></span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{cfg.label}</span>
        </div>
        <button onClick={onClose} className="text-gray-300 hover:text-gray-500 transition-colors"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <p className="text-base font-semibold text-gray-900 leading-snug">{tag.title}</p>
          {tag.detail && <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{tag.detail}</p>}
        </div>

        <div className="space-y-2.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-xs uppercase tracking-wide">Date</span>
            <span className="text-gray-700 font-medium">{dateLabel}</span>
          </div>
          {tag.owner && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-xs uppercase tracking-wide">Owner</span>
              <span className="text-gray-700">{tag.owner}</span>
            </div>
          )}
          {phase && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-xs uppercase tracking-wide">Phase</span>
              <span className="text-gray-700">{phase.phase}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-xs uppercase tracking-wide">Status</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[tag.status]}`}>{tag.status}</span>
          </div>
          {tag.severity !== 'none' && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-xs uppercase tracking-wide">Severity</span>
              <span className={`text-xs font-semibold capitalize ${severityColors[tag.severity]}`}>{tag.severity}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-none px-5 py-4 border-t border-gray-100 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => onEdit(tag)}>Edit</Button>
        <Button size="sm" variant="ghost"
          className="text-red-400 hover:text-red-600 hover:bg-red-50"
          onClick={() => {
            if (window.confirm('Delete this tag?')) onDelete(tag.id);
          }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddTagForm — centered modal
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_FORM: FormDraft = {
  type: 'milestone', title: '', isRange: false,
  date: todayISO(), start_date: todayISO(), end_date: '',
  phase_id: '', owner: '', detail: '', status: 'open', severity: 'none',
};

function AddTagForm({
  initial, phases, onSave, onClose,
}: {
  initial: FormDraft | null;
  phases: PhaseRow[];
  onSave: (draft: FormDraft, editId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm]   = useState<FormDraft>(initial ?? { ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const editId = (initial as FormDraft & { _editId?: string })?._editId;

  function f<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try { await onSave(form, editId); } finally { setSaving(false); }
  }

  const inputCls = "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/40" onClick={onClose}>
      <form
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{editId ? 'Edit tag' : 'Add timeline tag'}</h3>
          <button type="button" onClick={onClose} className="text-gray-300 hover:text-gray-500"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Type */}
          <div>
            <label className={labelCls}>Type</label>
            <div className="flex flex-wrap gap-2">
              {ALL_TAG_TYPES.map(t => {
                const cfg = TAG_CONFIG[t];
                const Icon = cfg.Icon;
                return (
                  <button type="button" key={t} onClick={() => f('type', t)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      form.type === t ? `${cfg.bg} ${cfg.text} ${cfg.border} ring-2 ring-offset-1 ring-current` : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}>
                    <Icon className="h-3 w-3" />{cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className={labelCls}>Title <span className="text-red-400">*</span></label>
            <input className={inputCls} value={form.title} onChange={e => f('title', e.target.value)} placeholder="Short, clear label" required />
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Date</label>
            <div className="flex items-center gap-3 mb-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="radio" checked={!form.isRange} onChange={() => f('isRange', false)} /> Single date
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="radio" checked={form.isRange}  onChange={() => f('isRange', true)}  /> Date range
              </label>
            </div>
            {!form.isRange
              ? <input type="date" className={inputCls} value={form.date} onChange={e => f('date', e.target.value)} />
              : <div className="flex items-center gap-2">
                  <input type="date" className={`${inputCls} flex-1`} value={form.start_date} onChange={e => f('start_date', e.target.value)} />
                  <ArrowRight className="h-3.5 w-3.5 text-gray-300 flex-none" />
                  <input type="date" className={`${inputCls} flex-1`} value={form.end_date}   onChange={e => f('end_date',   e.target.value)} />
                </div>
            }
          </div>

          {/* Phase */}
          <div>
            <label className={labelCls}>Phase (optional)</label>
            <select className={inputCls} value={form.phase_id} onChange={e => f('phase_id', e.target.value)}>
              <option value="">No phase</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.phase}</option>)}
            </select>
          </div>

          {/* Owner + status row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Owner</label>
              <input className={inputCls} value={form.owner} onChange={e => f('owner', e.target.value)} placeholder="Name" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => f('status', e.target.value as TagStatus)}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className={labelCls}>Severity</label>
            <select className={inputCls} value={form.severity} onChange={e => f('severity', e.target.value as TagSeverity)}>
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Description</label>
            <textarea className={`${inputCls} resize-none`} rows={3} value={form.detail} onChange={e => f('detail', e.target.value)} placeholder="Optional detail for the detail panel…" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={saving || !form.title.trim()}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {editId ? 'Save changes' : 'Add tag'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutiveTimelineProps { isOpen: boolean; onClose: () => void; }

const DRAWER_MIN     = 520;
const DRAWER_DEFAULT = 920;

export function ExecutiveTimeline({ isOpen, onClose }: ExecutiveTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);

  // ── Board (localStorage) ─────────────────────────────────────────────────
  const [board, setBoard] = useState<TimelineBoard>(loadBoard);
  useEffect(() => { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); }, [board]);

  // ── Timeline selection ───────────────────────────────────────────────────
  const [selectedQuarterId, setSelectedQuarterId] = useState<string | null>(() => autoSelectQuarterId(loadBoard().quarters));
  const [selectedSprintId, setSelectedSprintId]   = useState<string | null>(null);
  const [viewMode, setViewMode]                   = useState<'quarter' | 'sprint'>('sprint');

  // ── Zoom ─────────────────────────────────────────────────────────────────
  const [pxPerDay, setPxPerDay] = useState(PX_PER_DAY);
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const xFor = (date: Date) => daysBetween(TIMELINE_START, date) * pxPerDay;
  const totalWidth = daysBetween(TIMELINE_START, TIMELINE_END) * pxPerDay;

  // ── PPTX Export ───────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  async function handleExportPptx() {
    setExporting(true);
    try {
      const boardForExport = {
        title: board.title,
        subtext: board.subtext,
        confidence: board.confidence,
        phases: board.quarters.flatMap(q => q.sprints.map(s => ({
          id: s.id, phase: s.label,
          dates: `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}`,
          focus: s.notes, status: s.status,
        }))),
        notes: { accomplished: '', remaining: '', risks: '' },
        footer: board.footer,
        milestones: [],
      };
      await generateTimelinePptx(boardForExport, tags);
    } finally {
      setExporting(false);
    }
  }

  // ── Drawer resize ────────────────────────────────────────────────────────
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT);
  const [resizing, setResizing]       = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(DRAWER_DEFAULT);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = drawerWidth;
    setResizing(true);
  }, [drawerWidth]);

  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) => {
      const maxW = window.innerWidth * 0.97;
      setDrawerWidth(Math.min(maxW, Math.max(DRAWER_MIN, resizeStartW.current + (resizeStartX.current - e.clientX))));
    };
    const up = () => setResizing(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [resizing]);

  // ── Timeline tags (Supabase) ─────────────────────────────────────────────
  const [tags, setTags]         = useState<TimelineItem[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTagsLoading(true);
    supabase
      .from('timeline_items')
      .select('*')
      .eq('program_id', PROGRAM_ID)
      .order('date', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (!error && data) setTags(data as TimelineItem[]);
        setTagsLoading(false);
      });

    const channel = supabase
      .channel('timeline_tags_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timeline_items', filter: `program_id=eq.${PROGRAM_ID}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setTags(prev => [...prev, payload.new as TimelineItem]);
          else if (payload.eventType === 'UPDATE') setTags(prev => prev.map(t => t.id === payload.new.id ? payload.new as TimelineItem : t));
          else if (payload.eventType === 'DELETE') setTags(prev => prev.filter(t => t.id !== (payload.old as TimelineItem).id));
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen]);

  // ── Tag CRUD ─────────────────────────────────────────────────────────────
  async function saveTag(draft: FormDraft, editId?: string) {
    const payload = {
      program_id: PROGRAM_ID,
      phase_id:   draft.phase_id || null,
      type:       draft.type,
      title:      draft.title.trim(),
      detail:     draft.detail.trim() || null,
      date:       (!draft.isRange && draft.date)       ? draft.date       : null,
      start_date: (draft.isRange  && draft.start_date) ? draft.start_date : null,
      end_date:   (draft.isRange  && draft.end_date)   ? draft.end_date   : null,
      owner:      draft.owner.trim() || null,
      status:     draft.status,
      severity:   draft.severity,
    };

    if (editId) {
      const { data, error } = await supabase.from('timeline_items').update(payload).eq('id', editId).select().single();
      if (!error && data) setTags(prev => prev.map(t => t.id === editId ? data as TimelineItem : t));
    } else {
      const { data, error } = await supabase.from('timeline_items').insert(payload).select().single();
      if (!error && data) setTags(prev => [...prev, data as TimelineItem]);
    }
    setShowAddForm(false);
    setEditTag(null);
  }

  async function deleteTag(id: string) {
    await supabase.from('timeline_items').delete().eq('id', id);
    setTags(prev => prev.filter(t => t.id !== id));
    setSelectedTag(null);
  }

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState<TagType[]>(FILTER_PRESETS);
  const [selectedTag,   setSelectedTag]   = useState<TimelineItem | null>(null);
  const [showAddForm,   setShowAddForm]   = useState(false);
  const [editTag,       setEditTag]       = useState<FormDraft | null>(null);
  const [filterByPhase, setFilterByPhase] = useState<string | null>(null);

  function openEditForm(tag: TimelineItem) {
    const draft: FormDraft & { _editId: string } = {
      type:       tag.type,
      title:      tag.title,
      isRange:    !!(tag.start_date),
      date:       tag.date ?? todayISO(),
      start_date: tag.start_date ?? todayISO(),
      end_date:   tag.end_date ?? '',
      phase_id:   tag.phase_id ?? '',
      owner:      tag.owner ?? '',
      detail:     tag.detail ?? '',
      status:     tag.status,
      severity:   tag.severity,
      _editId:    tag.id,
    };
    setEditTag(draft);
    setShowAddForm(true);
  }

  function toggleFilter(t: TagType) {
    setActiveFilters(prev => prev.includes(t) ? prev.filter(f => f !== t) : [...prev, t]);
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const selectedQuarter = board.quarters.find(q => q.id === selectedQuarterId) ?? null;
  const selectedSprint  = selectedQuarter?.sprints.find(s => s.id === selectedSprintId) ?? null;
  const allPhases: PhaseRow[] = board.quarters.flatMap(q =>
    q.sprints.map(s => ({ id: s.id, phase: s.label, dates: `${s.startDate} – ${s.endDate}`, focus: '', status: s.status }))
  );

  // ── Board patch helpers ───────────────────────────────────────────────────
  function patchBoard<K extends keyof TimelineBoard>(key: K, value: TimelineBoard[K]) {
    setBoard(prev => ({ ...prev, [key]: value }));
  }
  function patchQuarter(qid: string, updates: Partial<QuarterItem>) {
    setBoard(prev => ({ ...prev, quarters: prev.quarters.map(q => q.id === qid ? { ...q, ...updates } : q) }));
  }
  function patchSprint(qid: string, sid: string, updates: Partial<SprintItem>) {
    setBoard(prev => ({
      ...prev,
      quarters: prev.quarters.map(q => q.id !== qid ? q : {
        ...q,
        sprints: q.sprints.map(s => s.id !== sid ? s : { ...s, ...updates }),
      }),
    }));
  }
  function addQuarter() {
    const last = board.quarters[board.quarters.length - 1];
    const start = last ? new Date(toDate(last.endDate).getTime() + 86400000) : new Date('2026-01-01T12:00:00');
    const end = new Date(start.getTime() + 89 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6'];
    const newQ: QuarterItem = {
      id: `q${Date.now()}`,
      label: `Q${board.quarters.length + 1} ${start.getFullYear()}`,
      startDate: fmt(start), endDate: fmt(end),
      color: colors[board.quarters.length % colors.length],
      sprints: [], grid: emptyGrid(), notes: '',
    };
    setBoard(prev => ({ ...prev, quarters: [...prev.quarters, newQ] }));
    setSelectedQuarterId(newQ.id);
    setSelectedSprintId(null);
  }
  function addSprint() {
    if (!selectedQuarterId) return;
    const q = board.quarters.find(q => q.id === selectedQuarterId);
    if (!q) return;
    const last = q.sprints[q.sprints.length - 1];
    const start = last ? new Date(toDate(last.endDate).getTime() + 86400000) : toDate(q.startDate);
    const end = new Date(Math.min(start.getTime() + 13 * 86400000, toDate(q.endDate).getTime()));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const sprintColors = ['#93c5fd','#fcd34d','#c4b5fd','#6ee7b7','#fca5a5','#a5f3fc'];
    const newS: SprintItem = {
      id: `s${Date.now()}`,
      label: `Sprint ${q.sprints.length + 1}`,
      startDate: fmt(start), endDate: fmt(end),
      color: sprintColors[q.sprints.length % sprintColors.length],
      status: 'Not started', grid: emptyGrid(), notes: '',
    };
    patchQuarter(selectedQuarterId, { sprints: [...q.sprints, newS] });
    setSelectedSprintId(newS.id);
  }
  function deleteQuarter(qid: string) {
    setBoard(prev => ({ ...prev, quarters: prev.quarters.filter(q => q.id !== qid) }));
    if (selectedQuarterId === qid) { setSelectedQuarterId(null); setSelectedSprintId(null); }
  }
  function deleteSprint(qid: string, sid: string) {
    const q = board.quarters.find(q => q.id === qid);
    if (q) patchQuarter(qid, { sprints: q.sprints.filter(s => s.id !== sid) });
    if (selectedSprintId === sid) setSelectedSprintId(null);
  }
  function cycleConfidence() {
    const next = CONFIDENCE_CYCLE[(CONFIDENCE_CYCLE.indexOf(board.confidence) + 1) % CONFIDENCE_CYCLE.length];
    patchBoard('confidence', next);
  }

  // ── Sprint row assignment helper ─────────────────────────────────────────
  function assignSprintRows(sprints: SprintItem[]) {
    const sorted = [...sprints].sort((a, b) => toDate(a.startDate).getTime() - toDate(b.startDate).getTime());
    const rowEnd: [number, number] = [-Infinity, -Infinity];
    return sorted.map(sprint => {
      const start = toDate(sprint.startDate).getTime();
      const end = toDate(sprint.endDate).getTime();
      const row: 0 | 1 = start >= rowEnd[0] ? 0 : 1;
      rowEnd[row] = end;
      return { ...sprint, row };
    });
  }

  // ── Timeline geometry variables ───────────────────────────────────────────
  const Q_BAR_TOP = 14;
  const Q_BAR_H = 52;
  const S_BAR_TOP = [80, 118] as const;
  const S_BAR_H = 32;
  const BASELINE_Y = 70;
  const S_BASELINE_Y = 160;
  const Q_BASELINE_Y = 74;
  const CHIP_ANCHOR_Y = viewMode === 'sprint' ? S_BASELINE_Y : Q_BASELINE_Y;
  const LANE_TOPS_SPRINT = [170, 196, 222] as const;
  const LANE_TOPS_QUARTER = [90, 116, 142] as const;
  const LANE_TOPS = viewMode === 'sprint' ? LANE_TOPS_SPRINT : LANE_TOPS_QUARTER;
  const CANVAS_H = viewMode === 'sprint' ? 248 : 170;

  // ── Scroll helpers ────────────────────────────────────────────────────────
  function scrollToToday() {
    const el = timelineRef.current;
    const clamped = TODAY < TIMELINE_START ? TIMELINE_START : TODAY > TIMELINE_END ? TIMELINE_END : TODAY;
    if (el) el.scrollTo({ left: xFor(clamped) - el.clientWidth / 2, behavior: 'smooth' });
  }

  function handleSelectQuarter(qid: string) {
    setSelectedQuarterId(qid);
    setSelectedSprintId(null);
    setFilterByPhase(qid);
    const q = board.quarters.find(q => q.id === qid);
    if (q) {
      const el = timelineRef.current;
      const midDate = new Date((toDate(q.startDate).getTime() + toDate(q.endDate).getTime()) / 2);
      if (el) el.scrollTo({ left: xFor(midDate) - el.clientWidth / 2, behavior: 'smooth' });
    }
  }
  function handleSelectSprint(sid: string, qid: string) {
    setSelectedSprintId(sid);
    setSelectedQuarterId(qid);
    setFilterByPhase(sid);
    const q = board.quarters.find(q => q.id === qid);
    const s = q?.sprints.find(s => s.id === sid);
    if (s) {
      const el = timelineRef.current;
      const mid = new Date((toDate(s.startDate).getTime() + toDate(s.endDate).getTime()) / 2);
      if (el) el.scrollTo({ left: xFor(mid) - el.clientWidth / 2, behavior: 'smooth' });
    }
  }

  // ── Scroll to TODAY on open ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      const clamped = TODAY < TIMELINE_START ? TIMELINE_START : TODAY > TIMELINE_END ? TIMELINE_END : TODAY;
      if (el) el.scrollLeft = xFor(clamped) - el.clientWidth / 2;
    });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ESC handler ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      if (showAddForm) { setShowAddForm(false); setEditTag(null); return; }
      if (selectedTag) { setSelectedTag(null); return; }
      onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose, showAddForm, selectedTag]);

  // ── Derived: visible tags ─────────────────────────────────────────────────
  const visibleTags = useMemo(() => {
    let filtered = tags.filter(t => activeFilters.includes(t.type));
    if (filterByPhase) filtered = filtered.filter(t => t.phase_id === filterByPhase);
    return filtered;
  }, [tags, activeFilters, filterByPhase]);

  const laned = useMemo(() => assignLanes(visibleTags, xFor), [visibleTags, pxPerDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextMilestone = useMemo(() =>
    tags.filter(t => t.type === 'milestone' && (t.date || t.start_date))
      .filter(t => toDate(t.date ?? t.start_date!) > TODAY)
      .sort((a, b) => toDate(a.date ?? a.start_date!).getTime() - toDate(b.date ?? b.start_date!).getTime())[0]
  , [tags]);

  if (!isOpen) return null;

  const conf     = CONFIDENCE_STYLE[board.confidence];
  const ConfIcon = conf.icon;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[110]" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div
        role="dialog" aria-modal="true" aria-label="Executive Timeline"
        className="fixed inset-y-0 right-0 z-[120] flex flex-col bg-white shadow-2xl border-l border-gray-200"
        style={{ width: drawerWidth, userSelect: resizing ? 'none' : undefined }}
      >
        {/* Resize handle */}
        <div onMouseDown={onResizeStart} title="Drag to resize"
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize group z-10">
          <div className="h-full w-full group-hover:bg-blue-400/30 transition-colors rounded-r" />
        </div>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex-none border-b border-gray-100 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            {/* Title + subtext + next milestone */}
            <div className="flex-1 min-w-0 space-y-0.5">
              <h2 className="text-xl font-semibold text-gray-900 tracking-tight leading-tight">
                <EditableText value={board.title} onChange={v => patchBoard('title', v)} className="text-xl font-semibold text-gray-900 tracking-tight" />
              </h2>
              <p className="text-sm text-gray-500 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 flex-none" />
                <EditableText value={board.subtext} onChange={v => patchBoard('subtext', v)} className="text-sm text-gray-500" />
              </p>
              {nextMilestone && (
                <p className="text-xs text-gray-400 flex items-center gap-1.5 pt-0.5">
                  <ArrowRight className="h-3 w-3 text-blue-400" />
                  Next:&nbsp;<span className="font-medium text-gray-600">{nextMilestone.title}</span>
                  &nbsp;·&nbsp;{fmtDate(nextMilestone.date ?? nextMilestone.start_date!)}
                </p>
              )}
            </div>

            {/* Right: confidence + actions */}
            <div className="flex items-center gap-2 flex-none">
              {/* Confidence pill */}
              <button onClick={cycleConfidence} title="Click to cycle confidence"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer hover:opacity-80 transition-opacity text-xs font-medium ${conf.pill}`}>
                <ConfIcon className="h-3.5 w-3.5" />
                <span>{board.confidence}</span>
              </button>
              {/* Export PPTX */}
              <Button variant="outline" size="sm" onClick={handleExportPptx} disabled={exporting}
                className="h-8 text-xs gap-1.5 print:hidden text-gray-600 border-gray-200 hover:bg-gray-50">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting ? 'Exporting…' : 'Export PPTX'}
              </Button>
              {/* Print */}
              <Button variant="ghost" size="sm" onClick={() => window.print()}
                className="text-gray-400 hover:text-gray-600 print:hidden" title="Print">
                <Printer className="h-4 w-4" />
              </Button>
              {/* Close */}
              <Button variant="ghost" size="icon" onClick={onClose}
                className="text-gray-400 hover:text-gray-600 print:hidden" aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Timeline Section ──────────────────────────────────────── */}
          <div className="px-6 pt-5 pb-3">

            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Program Timeline</h3>
                {/* View toggle */}
                <div className="flex rounded-md border border-gray-200 overflow-hidden text-[11px]">
                  <button
                    onClick={() => setViewMode('quarter')}
                    className={`px-2.5 py-1 transition-colors ${viewMode === 'quarter' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    Quarter
                  </button>
                  <button
                    onClick={() => setViewMode('sprint')}
                    className={`px-2.5 py-1 transition-colors border-l border-gray-200 ${viewMode === 'sprint' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    Quarter + Sprint
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Jump to Today */}
                <Button variant="outline" size="sm" onClick={scrollToToday} className="text-xs h-7 print:hidden">Jump to Today</Button>

                {/* Zoom */}
                <div className="flex items-center border border-gray-200 rounded-md overflow-hidden print:hidden">
                  <button onClick={() => setPxPerDay(p => Math.max(4, p - 2))} disabled={pxPerDay <= 4}
                    className="px-2 h-7 text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-sm leading-none">−</button>
                  <span className="text-[10px] text-gray-400 w-10 text-center select-none">{Math.round(pxPerDay / PX_PER_DAY * 100)}%</span>
                  <button onClick={() => setPxPerDay(p => Math.min(24, p + 2))} disabled={pxPerDay >= 24}
                    className="px-2 h-7 text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-sm leading-none">+</button>
                </div>

                {/* Add Quarter */}
                <Button variant="outline" size="sm" onClick={addQuarter} className="h-7 text-xs gap-1 print:hidden text-gray-600">
                  <Plus className="h-3 w-3" />Quarter
                </Button>

                {/* Add Sprint */}
                {selectedQuarterId && (
                  <Button variant="outline" size="sm" onClick={addSprint} className="h-7 text-xs gap-1 print:hidden text-gray-600">
                    <Plus className="h-3 w-3" />Sprint
                  </Button>
                )}

                {/* Add Tag */}
                <Button size="sm" onClick={() => { setShowAddForm(true); setEditTag(null); }}
                  className="h-7 text-xs bg-gray-900 hover:bg-gray-700 text-white print:hidden gap-1">
                  <Plus className="h-3 w-3" />Tag
                </Button>
              </div>
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button
                onClick={() => setActiveFilters(activeFilters.length === ALL_TAG_TYPES.length ? FILTER_PRESETS : ALL_TAG_TYPES)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                  activeFilters.length === ALL_TAG_TYPES.length
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}>All</button>
              {ALL_TAG_TYPES.map(t => {
                const cfg = TAG_CONFIG[t];
                const active = activeFilters.includes(t);
                return (
                  <button key={t} onClick={() => toggleFilter(t)}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                      active ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {cfg.label}
                  </button>
                );
              })}
              {filterByPhase && (
                <button onClick={() => setFilterByPhase(null)}
                  className="ml-1 px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                  {allPhases.find(p => p.id === filterByPhase)?.phase ?? filterByPhase}
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
              {tagsLoading && <Loader2 className="h-3 w-3 text-gray-300 animate-spin ml-1" />}
            </div>

            {/* Timeline canvas - scrollable */}
            <div className="relative">
              {/* Fade gradients */}
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-white to-transparent" />
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-white to-transparent" />

              <div ref={timelineRef} className="overflow-x-auto cursor-grab active:cursor-grabbing"
                style={{ scrollbarWidth: 'thin' }}
                onWheel={e => { if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) e.currentTarget.scrollLeft += e.deltaY; }}>

                <div className="relative" style={{ width: totalWidth + 80, height: CANVAS_H }}>

                  {/* Quarter background bands */}
                  {board.quarters.map(q => {
                    const left = xFor(toDate(q.startDate));
                    const width = xFor(toDate(q.endDate)) - left;
                    return (
                      <div key={q.id} className="absolute"
                        style={{ left, top: 0, width, height: CANVAS_H, background: `${q.color}14` }} />
                    );
                  })}

                  {/* Month tick lines */}
                  {MONTH_TICKS.map(mt => {
                    const x = xFor(mt.date);
                    return (
                      <div key={mt.label} className="absolute" style={{ left: x, top: 0 }}>
                        <div className="w-px bg-gray-200/50" style={{ height: CANVAS_H }} />
                        <div className="absolute top-1 left-1.5 text-[8px] text-gray-400/60 font-medium select-none">{mt.label}</div>
                      </div>
                    );
                  })}

                  {/* ── QUARTER BARS (Lane 1) ── */}
                  {board.quarters.map(q => {
                    const left = xFor(toDate(q.startDate));
                    const rawW = xFor(toDate(q.endDate)) - left;
                    const width = Math.max(rawW, 8);
                    const isSelected = selectedQuarterId === q.id;
                    return (
                      <div key={q.id}
                        className={`absolute rounded-lg cursor-pointer transition-all select-none group/qbar
                          ${isSelected ? 'shadow-md' : 'opacity-80 hover:opacity-100 hover:shadow-sm'}`}
                        style={{
                          left, top: Q_BAR_TOP, width, height: Q_BAR_H,
                          background: q.color,
                          ...(isSelected ? { boxShadow: `0 0 0 2px white, 0 0 0 4px ${q.color}` } : {}),
                        }}
                        onClick={() => handleSelectQuarter(q.id)}
                      >
                        <div className="absolute inset-0 flex items-center px-3 gap-2 overflow-hidden">
                          {width > 60 && (
                            <span className="text-white font-semibold text-sm leading-none truncate flex-1">
                              <EditableText
                                value={q.label}
                                onChange={v => patchQuarter(q.id, { label: v })}
                                className="font-semibold text-sm text-white"
                              />
                            </span>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); if (window.confirm('Delete this quarter?')) deleteQuarter(q.id); }}
                          className="absolute top-1 right-1 opacity-0 group-hover/qbar:opacity-100 text-white/60 hover:text-white/100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}

                  {/* ── SPRINT BARS (Lane 2, only in sprint mode) ── */}
                  {viewMode === 'sprint' && selectedQuarter && (() => {
                    const sprintsWithRows = assignSprintRows(selectedQuarter.sprints);
                    return sprintsWithRows.map(sprint => {
                      const left = xFor(toDate(sprint.startDate));
                      const rawW = Math.max(xFor(toDate(sprint.endDate)) - left, 6);
                      const top = S_BAR_TOP[sprint.row];
                      const isSelected = selectedSprintId === sprint.id;
                      return (
                        <div key={sprint.id}
                          className={`absolute rounded-md cursor-pointer transition-all select-none group/sbar
                            ${isSelected ? 'shadow-md' : 'opacity-75 hover:opacity-100'}`}
                          style={{
                            left, top, width: rawW, height: S_BAR_H,
                            background: sprint.color,
                            ...(isSelected ? { boxShadow: `0 0 0 2px white, 0 0 0 3px ${sprint.color}` } : {}),
                          }}
                          onClick={() => handleSelectSprint(sprint.id, selectedQuarter.id)}
                        >
                          <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                            {rawW > 40 && (
                              <span className="text-white/90 font-medium text-[11px] leading-none truncate">
                                <EditableText
                                  value={sprint.label}
                                  onChange={v => patchSprint(selectedQuarter.id, sprint.id, { label: v })}
                                  className="font-medium text-[11px] text-white/90"
                                />
                              </span>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); deleteSprint(selectedQuarter.id, sprint.id); }}
                            className="absolute top-0.5 right-0.5 opacity-0 group-hover/sbar:opacity-100 text-white/60 hover:text-white transition-opacity"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    });
                  })()}

                  {/* Baseline */}
                  <div className="absolute left-0 bg-gray-200" style={{ top: BASELINE_Y, height: 1, width: totalWidth + 80 }} />

                  {/* Range tag bars */}
                  {visibleTags.filter(t => t.start_date && t.end_date).map(t => {
                    const x1 = xFor(toDate(t.start_date!));
                    const x2 = xFor(toDate(t.end_date!));
                    const cfg = TAG_CONFIG[t.type];
                    return (
                      <div key={`range-${t.id}`}
                        className={`absolute ${cfg.bg} border ${cfg.border} opacity-80 cursor-pointer`}
                        style={{ left: x1, top: CHIP_ANCHOR_Y - 4, width: Math.max(x2 - x1, 4), height: 5, borderRadius: 3 }}
                        onClick={() => setSelectedTag(t)} title={t.title} />
                    );
                  })}

                  {/* TODAY vertical line */}
                  <div className="absolute" style={{ left: xFor(TODAY) - 1, top: 0, width: 2, height: CANVAS_H, background: 'rgba(59,130,246,0.15)' }} />

                  {/* TODAY badge */}
                  <div className="absolute flex flex-col items-center" style={{ left: xFor(TODAY), top: CHIP_ANCHOR_Y }}>
                    <div className="-translate-x-1/2 inline-flex flex-col items-center bg-blue-500 text-white rounded-full shadow px-2.5 py-1 gap-0">
                      <span className="text-[9px] font-bold leading-tight tracking-wide">TODAY</span>
                      <span className="text-[8px] leading-tight opacity-90">{TODAY_DISPLAY} ET</span>
                    </div>
                  </div>

                  {/* Tag chips */}
                  {laned.map(({ tag, x, lane }) => {
                    const cfg = TAG_CONFIG[tag.type];
                    const Icon = cfg.Icon;
                    const laneY = LANE_TOPS[lane];
                    const connH = laneY - CHIP_ANCHOR_Y;
                    const isTagSelected = selectedTag?.id === tag.id;
                    return (
                      <div key={tag.id} className="absolute" style={{ left: x, top: CHIP_ANCHOR_Y }}>
                        <div className={`absolute w-px ${isTagSelected ? cfg.dot : 'bg-gray-200'}`}
                          style={{ left: 0, top: 0, height: connH }} />
                        <div className={`absolute -translate-x-1/2 cursor-pointer transition-all hover:scale-105 ${isTagSelected ? 'scale-105' : ''}`}
                          style={{ top: connH }}
                          onClick={() => setSelectedTag(prev => prev?.id === tag.id ? null : tag)}>
                          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border whitespace-nowrap shadow-sm ${cfg.bg} ${cfg.text} ${cfg.border} ${isTagSelected ? 'ring-2 ring-offset-1 ring-current' : ''}`}>
                            <Icon className="h-2.5 w-2.5 flex-none" />
                            <span className="max-w-[80px] truncate">{tag.title}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom Panel ── */}
          <div className="px-6 pb-8">
            <div className="border-t border-gray-100 mb-5" />

            {selectedSprint ? (
              /* Sprint detail panel */
              <div className="space-y-4">
                {/* Summary card */}
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100"
                    style={{ borderLeft: `4px solid ${selectedSprint.color}` }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          <EditableText value={selectedSprint.label}
                            onChange={v => patchSprint(selectedQuarterId!, selectedSprint.id, { label: v })}
                            className="text-sm font-semibold text-gray-900" />
                        </p>
                        <span className="text-xs text-gray-400 flex-none">
                          {fmtDate(selectedSprint.startDate)} – {fmtDate(selectedSprint.endDate)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Sprint · {selectedQuarter?.label}
                      </p>
                    </div>
                    <StatusDropdown value={selectedSprint.status}
                      onChange={v => patchSprint(selectedQuarterId!, selectedSprint.id, { status: v })} />
                    {/* Sprint date editing */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input type="date" value={selectedSprint.startDate}
                        onChange={e => patchSprint(selectedQuarterId!, selectedSprint.id, { startDate: e.target.value })}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                      <span>→</span>
                      <input type="date" value={selectedSprint.endDate}
                        onChange={e => patchSprint(selectedQuarterId!, selectedSprint.id, { endDate: e.target.value })}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                    </div>
                  </div>
                  {/* Tags summary */}
                  {(() => {
                    const st = tags.filter(t => t.phase_id === selectedSprint.id);
                    const byType: Partial<Record<TagType, number>> = {};
                    for (const t of st) { byType[t.type] = (byType[t.type] ?? 0) + 1; }
                    return Object.entries(byType).length > 0 ? (
                      <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
                        {(Object.entries(byType) as [TagType, number][]).map(([type, count]) => {
                          const cfg = TAG_CONFIG[type];
                          const Icon = cfg.Icon;
                          return (
                            <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
                              <Icon className="h-2.5 w-2.5" />{count} {cfg.label}{count > 1 ? 's' : ''}
                            </span>
                          );
                        })}
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* Planning grid */}
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Planning Grid</h4>
                </div>
                <FlexGrid
                  data={selectedSprint.grid}
                  onChange={g => patchSprint(selectedQuarterId!, selectedSprint.id, { grid: g })}
                />

                {/* Notes */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Notes</h4>
                  <textarea
                    className="w-full text-sm text-gray-700 placeholder-gray-300 border border-gray-100 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-200 bg-gray-50/50 min-h-[80px]"
                    placeholder="Sprint notes, context, decisions…"
                    value={selectedSprint.notes}
                    onChange={e => patchSprint(selectedQuarterId!, selectedSprint.id, { notes: e.target.value })}
                    onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                  />
                </div>
              </div>

            ) : selectedQuarter ? (
              /* Quarter detail panel */
              <div className="space-y-4">
                {/* Summary card */}
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100"
                    style={{ borderLeft: `4px solid ${selectedQuarter.color}` }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        <EditableText value={selectedQuarter.label}
                          onChange={v => patchQuarter(selectedQuarter.id, { label: v })}
                          className="text-sm font-semibold text-gray-900" />
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fmtDate(selectedQuarter.startDate)} – {fmtDate(selectedQuarter.endDate)} · {selectedQuarter.sprints.length} sprint{selectedQuarter.sprints.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {/* Quarter date editing */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input type="date" value={selectedQuarter.startDate}
                        onChange={e => patchQuarter(selectedQuarter.id, { startDate: e.target.value })}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                      <span>→</span>
                      <input type="date" value={selectedQuarter.endDate}
                        onChange={e => patchQuarter(selectedQuarter.id, { endDate: e.target.value })}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                    </div>
                  </div>
                  {/* Sprint chips for this quarter */}
                  {selectedQuarter.sprints.length > 0 && (
                    <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
                      {selectedQuarter.sprints.map(s => (
                        <button key={s.id}
                          onClick={() => handleSelectSprint(s.id, selectedQuarter.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors hover:opacity-80"
                          style={{ background: `${s.color}33`, borderColor: s.color, color: '#1f2937' }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Planning grid */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Planning Grid</h4>
                  <FlexGrid
                    data={selectedQuarter.grid}
                    onChange={g => patchQuarter(selectedQuarter.id, { grid: g })}
                  />
                </div>

                {/* Notes */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Notes</h4>
                  <textarea
                    className="w-full text-sm text-gray-700 placeholder-gray-300 border border-gray-100 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-200 bg-gray-50/50 min-h-[80px]"
                    placeholder="Quarter overview, goals, key decisions…"
                    value={selectedQuarter.notes}
                    onChange={e => patchQuarter(selectedQuarter.id, { notes: e.target.value })}
                    onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                  />
                </div>
              </div>

            ) : (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-sm text-gray-400">Select a quarter or sprint from the timeline above</p>
                <p className="text-xs text-gray-300 mt-1">Click a bar to view and edit its details here</p>
              </div>
            )}

            {/* Footer */}
            {board.footer && (
              <>
                <div className="border-t border-gray-100 mt-6 mb-4" />
                <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
                  <EditableText value={board.footer} onChange={v => patchBoard('footer', v)}
                    className="text-sm text-gray-600 leading-relaxed" multiline />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tag detail sub-panel */}
        {selectedTag && (
          <TagDetailPanel
            tag={selectedTag}
            phases={allPhases}
            onClose={() => setSelectedTag(null)}
            onEdit={openEditForm}
            onDelete={deleteTag}
          />
        )}
      </div>

      {/* Add/Edit tag form modal */}
      {showAddForm && (
        <AddTagForm
          initial={editTag}
          phases={allPhases}
          onSave={saveTag}
          onClose={() => { setShowAddForm(false); setEditTag(null); }}
        />
      )}
    </>
  );
}
