import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Printer, Calendar, TrendingUp, TrendingDown, Minus,
  ChevronRight, ChevronUp, ChevronDown, Pencil, Plus, Trash2,
  Flag, AlertTriangle, GitBranch, Link2, Shuffle, Globe, Ban,
  ArrowRight, Loader2,
} from 'lucide-react';
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
// All fixed program dates use T12:00:00 (local noon) so they're consistent
// with date strings produced by toDate(), which also appends T12:00:00.
const TIMELINE_START = new Date('2026-01-01T12:00:00');
const TIMELINE_END   = new Date('2026-04-15T12:00:00');
const PX_PER_DAY     = 18;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
function xFor(date: Date) { return daysBetween(TIMELINE_START, date) * PX_PER_DAY; }
/** Parse a YYYY-MM-DD string as local noon to avoid UTC-offset day-shift bugs. */
function toDate(s: string): Date {
  return new Date(s.length === 10 ? s + 'T12:00:00' : s);
}
function fmtDate(s: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(toDate(s));
}

// ─── Runtime current-date utility (America/Los_Angeles) ──────────────────────

/**
 * Returns today's date string (YYYY-MM-DD) in the America/Los_Angeles timezone.
 * Uses Intl.DateTimeFormat so it's correct regardless of the host machine's
 * local timezone.  Call once at startup and treat the result as immutable for
 * the session lifetime.
 */
function getCurrentDatePT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // → "YYYY-MM-DD"
}

/**
 * ISO date string (YYYY-MM-DD) for today in PT — resolved once at module load.
 * Single source of truth for all "today" logic in this module.
 */
const TODAY_ISO = getCurrentDatePT();

/** Today as a Date object (PT), resolved once at module load. */
const TODAY = toDate(TODAY_ISO);

/** Returns today's date string (YYYY-MM-DD, PT). Used as the default date in forms. */
function todayISO() { return TODAY_ISO; }

/**
 * x-pixel position for "today", clamped to the visible timeline range.
 * Used for scroll centering so the view doesn't scroll past the timeline edges
 * when the current date is before the programme start or after its end.
 */
function todayX() {
  const clamped =
    TODAY < TIMELINE_START ? TIMELINE_START :
    TODAY > TIMELINE_END   ? TIMELINE_END   : TODAY;
  return xFor(clamped);
}

const TOTAL_WIDTH = daysBetween(TIMELINE_START, TIMELINE_END) * PX_PER_DAY;
const TRACK_HEIGHT = 230; // extended to fit tag chip rows

// ─────────────────────────────────────────────────────────────────────────────
// Static timeline geometry
// ─────────────────────────────────────────────────────────────────────────────

// isToday is computed from TODAY_ISO so it tracks the real current date.
const MILESTONE_DATES = [
  { date: toDate('2026-01-01'), isLaunch: false },
  { date: toDate('2026-02-01'), isLaunch: false },
  { date: toDate('2026-03-05'), isLaunch: false },
  { date: toDate('2026-03-18'), isLaunch: false },
  { date: toDate('2026-03-31'), isLaunch: false },
  { date: toDate('2026-04-01'), isLaunch: true  },
].map(m => ({ ...m, isToday: m.date.toDateString() === TODAY.toDateString() }));

const PHASE_BAR_DATES = [
  { start: toDate('2026-01-01'), end: toDate('2026-03-05'), color: 'bg-blue-200'   },
  { start: toDate('2026-03-05'), end: toDate('2026-03-18'), color: 'bg-amber-200'  },
  { start: toDate('2026-03-05'), end: toDate('2026-03-18'), color: 'bg-purple-200' },
  { start: toDate('2026-03-19'), end: toDate('2026-03-31'), color: 'bg-green-200'  },
];

// Dates to scroll to when clicking phase rows (indices match board.phases)
const PHASE_SCROLL_DATES = [
  toDate('2026-01-01'),
  toDate('2026-03-05'),
  toDate('2026-03-05'),
  toDate('2026-03-19'),
  toDate('2026-04-01'),
];

// Y positions for each tag chip lane (below milestone labels)
const LANE_TOPS = [148, 173, 198];

// ─────────────────────────────────────────────────────────────────────────────
// Tag lane assignment
// ─────────────────────────────────────────────────────────────────────────────

function assignLanes(items: TimelineItem[]) {
  const filtered = items.filter(t => t.date || t.start_date);
  const sorted = [...filtered].sort((a, b) =>
    toDate(a.date ?? a.start_date!).getTime() - toDate(b.date ?? b.start_date!).getTime()
  );
  const CHIP_W = 115;
  const laneRight = [-1000, -1000, -1000];
  return sorted.map(tag => {
    const x = xFor(toDate(tag.date ?? tag.start_date!));
    let lane = 0;
    for (let i = 0; i < 3; i++) {
      if (x > laneRight[i] + 6) { lane = i; break; }
    }
    laneRight[lane] = x + CHIP_W;
    return { tag, x, lane };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Board data (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

type Confidence = 'On track' | 'Watch' | 'At risk';

interface PhaseRow { id: string; phase: string; dates: string; focus: string; status: string; }
interface MilestoneLabel { label: string; sub: string; }

interface BoardData {
  title: string;
  subtext: string;
  confidence: Confidence;
  milestones: MilestoneLabel[];
  phases: PhaseRow[];
  notes: { accomplished: string; remaining: string; risks: string };
  footer: string;
}

const BOARD_KEY = 'exec-timeline-board-v2';

const DEFAULT_BOARD: BoardData = {
  title: 'Q1 Program Timeline',
  subtext: 'MVP Launch: April 1, 2026',
  confidence: 'On track',
  milestones: [
    { label: 'JAN',           sub: 'Pipeline start'        },
    { label: 'FEB',           sub: 'Backend running'       },
    { label: 'TODAY  Mar 5',  sub: 'Calibration kicks off' },
    { label: 'Mar 18',        sub: 'Sprint 6 ends'         },
    { label: 'Mar 31',        sub: 'MVP Dev complete'      },
    { label: 'LAUNCH  Apr 1', sub: 'Q1 Target'             },
  ],
  phases: [
    { id: 'p1', phase: 'Backend Pipeline',        dates: 'Jan – Mar 5',  focus: 'Analysis engine, FLOS agents, RAudit loop',           status: 'Running'           },
    { id: 'p2', phase: 'Calibration + Testing',   dates: 'Mar 5 – 18',   focus: 'RAudit quality fix, balance checker, test framework', status: 'In progress'       },
    { id: 'p3', phase: 'Design Sprint 1',         dates: 'Mar 5 – 18',   focus: 'User stories, wireframes, component library',         status: 'Kicking off today' },
    { id: 'p4', phase: 'Design Sprint 2 + Build', dates: 'Mar 19 – 31',  focus: 'Hi-fi design, UI build, backend integration, QA',    status: 'Starting Mar 19'   },
    { id: 'p5', phase: 'MVP Launch',              dates: 'Apr 1',        focus: 'Live with one client',                                status: 'Target'            },
  ],
  notes: { accomplished: '', remaining: '', risks: '' },
  footer: 'We are 27 days from launch. The backend analysis engine is running. UI work starts today.',
};

function loadBoard(): BoardData {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BoardData>;
      return {
        ...DEFAULT_BOARD, ...p,
        notes: { ...DEFAULT_BOARD.notes, ...(p.notes ?? {}) },
        milestones: p.milestones ?? DEFAULT_BOARD.milestones,
        phases: (p.phases ?? DEFAULT_BOARD.phases).map((row, i) => ({
          ...row, id: (row as PhaseRow).id ?? `p${i + 1}`,
        })),
      };
    }
  } catch {}
  return { ...DEFAULT_BOARD, notes: { ...DEFAULT_BOARD.notes } };
}

let _idSeq = 100;
function nextId() { return `ph${++_idSeq}`; }

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
  const [board, setBoard] = useState<BoardData>(loadBoard);
  useEffect(() => { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); }, [board]);

  function patch<K extends keyof BoardData>(key: K, value: BoardData[K]) { setBoard(prev => ({ ...prev, [key]: value })); }
  function patchMilestone(i: number, field: keyof MilestoneLabel, value: string) {
    setBoard(prev => ({ ...prev, milestones: prev.milestones.map((m, idx) => idx === i ? { ...m, [field]: value } : m) }));
  }
  function patchPhase(i: number, field: keyof PhaseRow, value: string) {
    setBoard(prev => ({ ...prev, phases: prev.phases.map((p, idx) => idx === i ? { ...p, [field]: value } : p) }));
  }
  function addPhase() {
    setBoard(prev => ({ ...prev, phases: [...prev.phases, { id: nextId(), phase: 'New phase', dates: '', focus: '', status: 'Not started' }] }));
  }
  function deletePhase(i: number) { setBoard(prev => ({ ...prev, phases: prev.phases.filter((_, idx) => idx !== i) })); }
  function movePhase(i: number, dir: -1 | 1) {
    const j = i + dir;
    setBoard(prev => {
      if (j < 0 || j >= prev.phases.length) return prev;
      const phases = [...prev.phases];
      [phases[i], phases[j]] = [phases[j], phases[i]];
      return { ...prev, phases };
    });
  }
  function cycleConfidence() {
    const next = CONFIDENCE_CYCLE[(CONFIDENCE_CYCLE.indexOf(board.confidence) + 1) % CONFIDENCE_CYCLE.length];
    patch('confidence', next);
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
  const [highlightedPhaseIdx, setHighlightedPhaseIdx] = useState<number | null>(null);
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

  // ESC priority: close form → close detail panel → close drawer
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

  // Scroll to TODAY on open (clamped so we never scroll past the timeline edges)
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (el) el.scrollLeft = todayX() - el.clientWidth / 2;
    });
  }, [isOpen]);

  function scrollToToday() {
    const el = timelineRef.current;
    if (el) el.scrollTo({ left: todayX() - el.clientWidth / 2, behavior: 'smooth' });
  }

  function handlePhaseClick(i: number) {
    const phaseId = board.phases[i]?.id ?? null;
    setHighlightedPhaseIdx(i === highlightedPhaseIdx ? null : i);
    setFilterByPhase(prev => prev === phaseId ? null : phaseId);
    const scrollDate = PHASE_SCROLL_DATES[i] ?? TODAY;
    const el = timelineRef.current;
    if (el) el.scrollTo({ left: xFor(scrollDate) - el.clientWidth / 2, behavior: 'smooth' });
  }

  // Derived: visible tags after filters
  const visibleTags = useMemo(() => {
    let filtered = tags.filter(t => activeFilters.includes(t.type));
    if (filterByPhase) filtered = filtered.filter(t => t.phase_id === filterByPhase);
    return filtered;
  }, [tags, activeFilters, filterByPhase]);

  const laned = useMemo(() => assignLanes(visibleTags), [visibleTags]);

  // Next milestone
  const nextMilestone = useMemo(() =>
    tags.filter(t => t.type === 'milestone' && (t.date || t.start_date))
      .filter(t => toDate(t.date ?? t.start_date!) > TODAY)
      .sort((a, b) => toDate(a.date ?? a.start_date!).getTime() - toDate(b.date ?? b.start_date!).getTime())[0]
  , [tags]);

  if (!isOpen) return null;

  const conf    = CONFIDENCE_STYLE[board.confidence];
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
        <div className="flex-none border-b border-gray-100 px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-0.5">
              <h2 className="text-xl font-semibold text-gray-900 tracking-tight leading-tight">
                <EditableText value={board.title} onChange={v => patch('title', v)} className="text-xl font-semibold text-gray-900 tracking-tight" />
              </h2>
              <p className="text-sm text-gray-500 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 flex-none" />
                <EditableText value={board.subtext} onChange={v => patch('subtext', v)} className="text-sm text-gray-500" />
              </p>
              {nextMilestone && (
                <p className="text-xs text-gray-400 flex items-center gap-1.5 pt-0.5">
                  <ArrowRight className="h-3 w-3 text-blue-400" />
                  Next:&nbsp;<span className="font-medium text-gray-600">{nextMilestone.title}</span>
                  &nbsp;·&nbsp;{fmtDate(nextMilestone.date ?? nextMilestone.start_date!)}
                </p>
              )}
            </div>

            {/* Confidence pill */}
            <button onClick={cycleConfidence} title="Click to cycle confidence"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border flex-none cursor-pointer hover:opacity-80 transition-opacity ${conf.pill}`}>
              <ConfIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Q1 Confidence</span>
              <span className="text-xs">{board.confidence}</span>
            </button>

            <div className="flex items-center gap-1 flex-none">
              <Button variant="ghost" size="sm" onClick={() => window.print()}
                className="text-gray-400 hover:text-gray-600 print:hidden" title="Print">
                <Printer className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}
                className="text-gray-400 hover:text-gray-600 print:hidden" aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Timeline section ──────────────────────────────────── */}
          <div className="px-8 pt-6 pb-2">

            {/* Section header row */}
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Program Timeline</h3>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={scrollToToday} className="text-xs h-7 print:hidden">
                  Jump to Today
                </Button>
                <Button size="sm" onClick={() => { setShowAddForm(true); setEditTag(null); }}
                  className="h-7 text-xs bg-gray-900 hover:bg-gray-700 text-white print:hidden gap-1">
                  <Plus className="h-3 w-3" />Add Tag
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
                <button onClick={() => { setFilterByPhase(null); setHighlightedPhaseIdx(null); }}
                  className="ml-1 px-2 py-0.5 rounded-full text-[11px] bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                  {board.phases.find(p => p.id === filterByPhase)?.phase}
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
              {tagsLoading && <Loader2 className="h-3 w-3 text-gray-300 animate-spin ml-1" />}
            </div>

            {/* Scrollable timeline track */}
            <div className="relative">
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-r from-white to-transparent" />
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-l from-white to-transparent" />

              <div ref={timelineRef} className="overflow-x-auto cursor-grab active:cursor-grabbing"
                style={{ scrollbarWidth: 'thin' }}
                onWheel={e => { if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) e.currentTarget.scrollLeft += e.deltaY; }}>

                <div className="relative" style={{ width: TOTAL_WIDTH + 80, height: TRACK_HEIGHT + 40 }}>

                  {/* Phase bars */}
                  {PHASE_BAR_DATES.map((bar, i) => {
                    const left  = xFor(bar.start);
                    const width = xFor(bar.end) - left;
                    const top   = 10 + (i % 2 === 0 ? 0 : 22);
                    const isHL  = highlightedPhaseIdx === i;
                    return (
                      <div key={i} className={`absolute rounded-sm ${bar.color} transition-all`}
                        style={{ left, top, width, height: isHL ? 22 : 16, opacity: isHL ? 1 : 0.6,
                          outline: isHL ? '2px solid rgba(59,130,246,0.5)' : undefined }}
                        title={board.phases[i]?.phase ?? ''} />
                    );
                  })}

                  {/* Baseline */}
                  <div className="absolute left-0 right-0 bg-gray-200 rounded" style={{ top: 68, height: 2 }} />

                  {/* Range bars for range tags */}
                  {visibleTags.filter(t => t.start_date && t.end_date).map(t => {
                    const x1  = xFor(toDate(t.start_date!));
                    const x2  = xFor(toDate(t.end_date!));
                    const cfg = TAG_CONFIG[t.type];
                    return (
                      <div key={`range-${t.id}`} className={`absolute ${cfg.bg} border ${cfg.border} opacity-80 cursor-pointer`}
                        style={{ left: x1, top: 63, width: Math.max(x2 - x1, 4), height: 8, borderRadius: 4 }}
                        onClick={() => setSelectedTag(t)} title={t.title} />
                    );
                  })}

                  {/* TODAY band */}
                  <div className="absolute" style={{ left: xFor(TODAY) - 1, top: 0, width: 3, height: TRACK_HEIGHT, background: 'rgba(59,130,246,0.10)' }} />

                  {/* Milestone ticks + labels */}
                  {MILESTONE_DATES.map((m, i) => {
                    const x  = xFor(m.date);
                    const ml = board.milestones[i];
                    return (
                      <div key={i} className="absolute" style={{ left: x, top: 54 }}>
                        <div className={`w-px mx-auto ${m.isToday ? 'bg-blue-500 h-8' : m.isLaunch ? 'bg-purple-500 h-6' : 'bg-gray-300 h-4'}`} />
                        <div className={`mt-2 whitespace-nowrap text-[11px] font-medium -translate-x-1/2 ${m.isToday ? 'text-blue-600' : m.isLaunch ? 'text-purple-700' : 'text-gray-500'}`}>
                          <EditableText value={ml?.label ?? ''} onChange={v => patchMilestone(i, 'label', v)}
                            className={`text-[11px] font-medium ${m.isToday ? 'text-blue-600' : m.isLaunch ? 'text-purple-700' : 'text-gray-500'}`} />
                        </div>
                        <div className="mt-0.5 whitespace-nowrap text-[10px] text-gray-400 -translate-x-1/2">
                          <EditableText value={ml?.sub ?? ''} onChange={v => patchMilestone(i, 'sub', v)} className="text-[10px] text-gray-400" />
                        </div>
                      </div>
                    );
                  })}

                  {/* TODAY badge */}
                  <div className="absolute" style={{ left: xFor(TODAY), top: 18 }}>
                    <div className="-translate-x-1/2 inline-flex items-center bg-blue-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">TODAY</div>
                  </div>

                  {/* Q1 Target badge */}
                  <div className="absolute" style={{ left: xFor(new Date('2026-04-01')), top: 18 }}>
                    <div className="-translate-x-1/2 inline-flex items-center bg-purple-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">Q1 Target</div>
                  </div>

                  {/* Tag chips */}
                  {laned.map(({ tag, x, lane }) => {
                    const cfg    = TAG_CONFIG[tag.type];
                    const Icon   = cfg.Icon;
                    const laneY  = LANE_TOPS[lane];
                    const connH  = laneY - 70;
                    const isSelected = selectedTag?.id === tag.id;
                    return (
                      <div key={tag.id} className="absolute" style={{ left: x, top: 70 }}>
                        {/* Connector line */}
                        <div className={`absolute w-px ${isSelected ? cfg.dot : 'bg-gray-200'}`}
                          style={{ left: 0, top: 0, height: connH }} />
                        {/* Chip */}
                        <div className={`absolute -translate-x-1/2 cursor-pointer transition-all hover:scale-105 ${isSelected ? 'scale-105' : ''}`}
                          style={{ top: connH }}
                          onClick={() => setSelectedTag(prev => prev?.id === tag.id ? null : tag)}>
                          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border whitespace-nowrap shadow-sm ${cfg.bg} ${cfg.text} ${cfg.border} ${isSelected ? 'ring-2 ring-offset-1 ring-current shadow-md' : ''}`}>
                            <Icon className="h-2.5 w-2.5 flex-none" />
                            <span className="max-w-[72px] truncate">{tag.title}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Phase Summary Table ──────────────────────────────── */}
          <div className="px-8 mt-1">
            <div className="border-t border-gray-100 mb-5" />
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Phase Summary
                <span className="ml-2 normal-case font-normal text-gray-300 text-[10px]">— click row to filter timeline · click cell to edit</span>
              </h3>

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Phase', 'Dates', 'Focus', 'Status', 'Tags'].map(col => (
                        <th key={col} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">{col}</th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {board.phases.map((row, i) => {
                      const isHL = highlightedPhaseIdx === i;
                      return (
                        <tr key={row.id}
                          className={`group border-b border-gray-50 transition-colors ${isHL ? 'bg-blue-50/50' : i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap cursor-pointer"
                            onClick={() => handlePhaseClick(i)}>
                            <EditableText value={row.phase} onChange={v => patchPhase(i, 'phase', v)}
                              className="font-medium text-gray-800 text-sm" />
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            <EditableText value={row.dates} onChange={v => patchPhase(i, 'dates', v)} className="text-gray-500 text-sm" />
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            <MarkdownFocusCell value={row.focus} onChange={v => patchPhase(i, 'focus', v)} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusDropdown value={row.status} onChange={v => patchPhase(i, 'status', v)} />
                          </td>
                          <td className="px-4 py-3">
                            <PhaseTagCounts
                            phaseId={row.id}
                            tags={tags}
                            onTagClick={tag => setSelectedTag(tag)}
                            onPhaseClick={() => handlePhaseClick(i)}
                          />
                          </td>
                          <td className="pr-3 py-3">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                              <button onClick={() => movePhase(i, -1)} disabled={i === 0}
                                title="Move up"
                                className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed">
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => movePhase(i, 1)} disabled={i === board.phases.length - 1}
                                title="Move down"
                                className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed">
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deletePhase(i)} title="Delete row"
                                className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button onClick={addPhase} className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors px-1 py-1">
                <Plus className="h-3.5 w-3.5" />Add phase
              </button>
            </div>

            {/* ── PM Notes ────────────────────────────────────────── */}
            <div className="border-t border-gray-100 mb-5" />
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">PM Walkthrough Notes</h3>
              <div className="space-y-3">
                {([
                  { key: 'accomplished' as const, placeholder: 'What we accomplished this phase…' },
                  { key: 'remaining'    as const, placeholder: 'What is left for Q1…'             },
                  { key: 'risks'        as const, placeholder: 'Risks / dependencies…'            },
                ]).map(({ key, placeholder }) => (
                  <div key={key} className="flex gap-3 items-start">
                    <ChevronRight className="h-4 w-4 text-gray-300 mt-2.5 flex-none" />
                    <textarea
                      className="flex-1 text-sm text-gray-700 placeholder-gray-300 border border-gray-100 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-300 bg-gray-50/50 min-h-[52px]"
                      placeholder={placeholder}
                      value={board.notes[key]}
                      onChange={e => setBoard(prev => ({ ...prev, notes: { ...prev.notes, [key]: e.target.value } }))}
                      onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
            <div className="border-t border-gray-100 mb-5" />
            <div className="mb-8 px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
              <EditableText value={board.footer} onChange={v => patch('footer', v)} className="text-sm text-gray-600 leading-relaxed" multiline />
            </div>
          </div>

        </div>

        {/* Tag detail sub-panel — absolute within the drawer, outside the scrollable body */}
        {selectedTag && (
          <TagDetailPanel
            tag={selectedTag}
            phases={board.phases}
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
          phases={board.phases}
          onSave={saveTag}
          onClose={() => { setShowAddForm(false); setEditTag(null); }}
        />
      )}
    </>
  );
}
