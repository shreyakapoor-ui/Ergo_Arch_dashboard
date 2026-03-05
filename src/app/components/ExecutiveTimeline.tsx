import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Printer, Calendar, TrendingUp, TrendingDown, Minus,
  ChevronRight, Pencil, Plus, Trash2, ChevronDown,
} from 'lucide-react';
import { Button } from './ui/button';

interface ExecutiveTimelineProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const TIMELINE_START = new Date('2026-01-01');
const TIMELINE_END   = new Date('2026-04-15');
const TODAY          = new Date('2026-03-05');
const PX_PER_DAY     = 18;

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
function xFor(date: Date) { return daysBetween(TIMELINE_START, date) * PX_PER_DAY; }
const TOTAL_WIDTH = daysBetween(TIMELINE_START, TIMELINE_END) * PX_PER_DAY;

// ─── Static geometry ──────────────────────────────────────────────────────────

const MILESTONE_DATES = [
  { date: new Date('2026-01-01'), isToday: false, isLaunch: false },
  { date: new Date('2026-02-01'), isToday: false, isLaunch: false },
  { date: new Date('2026-03-05'), isToday: true,  isLaunch: false },
  { date: new Date('2026-03-18'), isToday: false, isLaunch: false },
  { date: new Date('2026-03-31'), isToday: false, isLaunch: false },
  { date: new Date('2026-04-01'), isToday: false, isLaunch: true  },
];

const PHASE_BAR_DATES = [
  { start: new Date('2026-01-01'), end: new Date('2026-03-05'), color: 'bg-blue-200'   },
  { start: new Date('2026-03-05'), end: new Date('2026-03-18'), color: 'bg-amber-200'  },
  { start: new Date('2026-03-05'), end: new Date('2026-03-18'), color: 'bg-purple-200' },
  { start: new Date('2026-03-19'), end: new Date('2026-03-31'), color: 'bg-green-200'  },
];

// ─── Board data types ─────────────────────────────────────────────────────────

type Confidence = 'On track' | 'Watch' | 'At risk';

interface PhaseRow {
  id: string;           // stable key for React
  phase: string;
  dates: string;
  focus: string;
  status: string;
}

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
        ...DEFAULT_BOARD,
        ...p,
        notes: { ...DEFAULT_BOARD.notes, ...(p.notes ?? {}) },
        milestones: p.milestones ?? DEFAULT_BOARD.milestones,
        // Ensure every phase row has a stable id
        phases: (p.phases ?? DEFAULT_BOARD.phases).map((row, i) => ({
          ...row,
          id: (row as PhaseRow).id ?? `p${i + 1}`,
        })),
      };
    }
  } catch {}
  return { ...DEFAULT_BOARD, notes: { ...DEFAULT_BOARD.notes } };
}

let _idSeq = 100;
function nextId() { return `ph${++_idSeq}`; }

// ─── Confidence config ────────────────────────────────────────────────────────

const CONFIDENCE_CYCLE: Confidence[] = ['On track', 'Watch', 'At risk'];
const CONFIDENCE_STYLE: Record<Confidence, { pill: string; icon: typeof TrendingUp }> = {
  'On track': { pill: 'bg-emerald-50 border-emerald-100 text-emerald-700', icon: TrendingUp   },
  'Watch':    { pill: 'bg-amber-50  border-amber-100  text-amber-700',     icon: Minus        },
  'At risk':  { pill: 'bg-red-50    border-red-100    text-red-700',       icon: TrendingDown },
};

// ─── Status presets ───────────────────────────────────────────────────────────

const STATUS_PRESETS: { label: string; style: string }[] = [
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

// ─── EditableText ─────────────────────────────────────────────────────────────

function EditableText({
  value, onChange, className = '', multiline = false, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  className?: string; multiline?: boolean; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== value) onChange(t); else setDraft(value);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  }

  const base = `${className} w-full bg-transparent outline-none`;

  if (editing) {
    return multiline
      ? <textarea  ref={ref} autoFocus value={draft} rows={2}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
          className={`${base} resize-none border-b border-blue-300`} />
      : <input     ref={ref} autoFocus value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
          className={`${base} border-b border-blue-300`} />;
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`${className} group cursor-text inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 hover:bg-gray-50 transition-colors`}
    >
      {value || <span className="text-gray-300 italic text-xs">{placeholder ?? 'Click to add…'}</span>}
      <Pencil className="h-2.5 w-2.5 text-gray-300 opacity-0 group-hover:opacity-100 flex-none transition-opacity" />
    </span>
  );
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

function StatusDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      {/* Badge trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${statusStyle(value)}`}
      >
        {value}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-[200] bg-white rounded-xl shadow-xl border border-gray-100 p-2 flex flex-col gap-1 min-w-[170px]">
          {STATUS_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => { onChange(p.label); setOpen(false); }}
              className={`text-left text-xs font-medium px-2.5 py-1.5 rounded-full transition-opacity hover:opacity-80 ${p.style} ${p.label === value ? 'ring-1 ring-offset-1 ring-current' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DRAWER_MIN   = 520;
const DRAWER_DEFAULT = 920;

export function ExecutiveTimeline({ isOpen, onClose }: ExecutiveTimelineProps) {
  const timelineRef  = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<BoardData>(loadBoard);

  // ── Drawer resize ────────────────────────────────────────────────────────
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT);
  const [resizing, setResizing]       = useState(false);
  const resizeStartX   = useRef(0);
  const resizeStartW   = useRef(DRAWER_DEFAULT);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = drawerWidth;
    setResizing(true);
  }, [drawerWidth]);

  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) => {
      const delta = resizeStartX.current - e.clientX; // drag left = wider
      const maxW  = window.innerWidth * 0.97;
      setDrawerWidth(Math.min(maxW, Math.max(DRAWER_MIN, resizeStartW.current + delta)));
    };
    const up = () => setResizing(false);
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [resizing]);

  // ── Persist board ────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
  }, [board]);

  function patch<K extends keyof BoardData>(key: K, value: BoardData[K]) {
    setBoard(prev => ({ ...prev, [key]: value }));
  }
  function patchMilestone(i: number, field: keyof MilestoneLabel, value: string) {
    setBoard(prev => ({
      ...prev,
      milestones: prev.milestones.map((m, idx) => idx === i ? { ...m, [field]: value } : m),
    }));
  }
  function patchPhase(i: number, field: keyof PhaseRow, value: string) {
    setBoard(prev => ({
      ...prev,
      phases: prev.phases.map((p, idx) => idx === i ? { ...p, [field]: value } : p),
    }));
  }
  function addPhase() {
    setBoard(prev => ({
      ...prev,
      phases: [...prev.phases, { id: nextId(), phase: 'New phase', dates: '', focus: '', status: 'Not started' }],
    }));
  }
  function deletePhase(i: number) {
    setBoard(prev => ({ ...prev, phases: prev.phases.filter((_, idx) => idx !== i) }));
  }

  function cycleConfidence() {
    const next = CONFIDENCE_CYCLE[(CONFIDENCE_CYCLE.indexOf(board.confidence) + 1) % CONFIDENCE_CYCLE.length];
    patch('confidence', next);
  }

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  // Scroll to TODAY on open
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (!el) return;
      el.scrollLeft = xFor(TODAY) - el.clientWidth / 2;
    });
  }, [isOpen]);

  function scrollToToday() {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTo({ left: xFor(TODAY) - el.clientWidth / 2, behavior: 'smooth' });
  }

  if (!isOpen) return null;

  const TRACK_HEIGHT = 160;
  const conf    = CONFIDENCE_STYLE[board.confidence];
  const ConfIcon = conf.icon;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[110]" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Executive Timeline"
        className="fixed inset-y-0 right-0 z-[120] flex flex-col bg-white shadow-2xl border-l border-gray-200"
        style={{ width: drawerWidth, userSelect: resizing ? 'none' : undefined }}
      >
        {/* ── Resize handle (left edge) ──────────────────────────────── */}
        <div
          onMouseDown={onResizeStart}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize group z-10"
          title="Drag to resize"
        >
          <div className="h-full w-full group-hover:bg-blue-400/30 transition-colors rounded-r" />
        </div>

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex-none border-b border-gray-100 px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-0.5">
              <h2 className="text-xl font-semibold text-gray-900 tracking-tight leading-tight">
                <EditableText value={board.title} onChange={v => patch('title', v)}
                  className="text-xl font-semibold text-gray-900 tracking-tight" />
              </h2>
              <p className="text-sm text-gray-500 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 flex-none" />
                <EditableText value={board.subtext} onChange={v => patch('subtext', v)}
                  className="text-sm text-gray-500" />
              </p>
            </div>

            {/* Confidence — click to cycle */}
            <button
              onClick={cycleConfidence}
              title="Click to cycle: On track → Watch → At risk"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border flex-none cursor-pointer hover:opacity-80 transition-opacity ${conf.pill}`}
            >
              <ConfIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Q1 Confidence</span>
              <span className="text-xs">{board.confidence}</span>
            </button>

            <div className="flex items-center gap-1 flex-none">
              <Button variant="ghost" size="sm" onClick={() => window.print()}
                className="text-gray-400 hover:text-gray-600 print:hidden" title="Print / Export">
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

          {/* ── Horizontal Timeline ──────────────────────────────────── */}
          <div className="px-8 pt-6 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                Program Timeline
              </h3>
              <Button variant="outline" size="sm" onClick={scrollToToday} className="text-xs h-7 print:hidden">
                Jump to Today
              </Button>
            </div>

            <div className="relative">
              {/* Fade edges */}
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-r from-white to-transparent" />
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-l from-white to-transparent" />

              <div
                ref={timelineRef}
                className="overflow-x-auto cursor-grab active:cursor-grabbing"
                style={{ scrollbarWidth: 'thin' }}
                onWheel={e => { if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) e.currentTarget.scrollLeft += e.deltaY; }}
              >
                <div className="relative" style={{ width: TOTAL_WIDTH + 80, height: TRACK_HEIGHT + 40 }}>

                  {/* Phase bars */}
                  {PHASE_BAR_DATES.map((bar, i) => {
                    const left  = xFor(bar.start);
                    const width = xFor(bar.end) - left;
                    const top   = 10 + (i % 2 === 0 ? 0 : 22);
                    return (
                      <div key={i} className={`absolute rounded-sm ${bar.color} opacity-60`}
                        style={{ left, top, width, height: 16 }} title={board.phases[i]?.phase ?? ''} />
                    );
                  })}

                  {/* Baseline */}
                  <div className="absolute left-0 right-0 bg-gray-200 rounded" style={{ top: 68, height: 2 }} />

                  {/* TODAY band */}
                  <div className="absolute" style={{
                    left: xFor(TODAY) - 1, top: 0, width: 3,
                    height: TRACK_HEIGHT, background: 'rgba(59,130,246,0.12)',
                  }} />

                  {/* Milestones */}
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
                          <EditableText value={ml?.sub ?? ''} onChange={v => patchMilestone(i, 'sub', v)}
                            className="text-[10px] text-gray-400" />
                        </div>
                      </div>
                    );
                  })}

                  {/* TODAY badge */}
                  <div className="absolute" style={{ left: xFor(TODAY), top: 18 }}>
                    <div className="-translate-x-1/2 inline-flex items-center bg-blue-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">
                      TODAY
                    </div>
                  </div>

                  {/* Q1 Target badge */}
                  <div className="absolute" style={{ left: xFor(new Date('2026-04-01')), top: 18 }}>
                    <div className="-translate-x-1/2 inline-flex items-center bg-purple-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">
                      Q1 Target
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8">

            {/* ── Divider ────────────────────────────────────────────── */}
            <div className="border-t border-gray-100 mb-5" />

            {/* ── Phase Summary Table ──────────────────────────────── */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Phase Summary
                <span className="ml-2 normal-case font-normal text-gray-300 text-[10px]">— click any cell to edit</span>
              </h3>

              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Phase', 'Dates', 'Focus', 'Status'].map(col => (
                        <th key={col} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                      {/* Extra col for delete button */}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {board.phases.map((row, i) => (
                      <tr key={row.id} className={`group border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                          <EditableText value={row.phase} onChange={v => patchPhase(i, 'phase', v)}
                            className="font-medium text-gray-800 text-sm" />
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          <EditableText value={row.dates} onChange={v => patchPhase(i, 'dates', v)}
                            className="text-gray-500 text-sm" />
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <EditableText value={row.focus} onChange={v => patchPhase(i, 'focus', v)}
                            className="text-gray-600 text-sm" multiline />
                        </td>
                        <td className="px-4 py-3">
                          <StatusDropdown value={row.status} onChange={v => patchPhase(i, 'status', v)} />
                        </td>
                        <td className="pr-3 py-3">
                          <button
                            onClick={() => deletePhase(i)}
                            title="Delete row"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add row button */}
              <button
                onClick={addPhase}
                className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors px-1 py-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add phase
              </button>
            </div>

            {/* ── Divider ────────────────────────────────────────────── */}
            <div className="border-t border-gray-100 mb-5" />

            {/* ── PM Walkthrough Notes ─────────────────────────────── */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                PM Walkthrough Notes
              </h3>
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
                      onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Divider ────────────────────────────────────────────── */}
            <div className="border-t border-gray-100 mb-5" />

            {/* ── Footer ───────────────────────────────────────────── */}
            <div className="mb-8 px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
              <EditableText value={board.footer} onChange={v => patch('footer', v)}
                className="text-sm text-gray-600 leading-relaxed" multiline />
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
