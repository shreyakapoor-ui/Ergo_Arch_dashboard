/**
 * generateTimelinePptx.ts
 * Generates a professional executive timeline PowerPoint from live board + Supabase tag data.
 * Called from the "Export PPTX" button in ExecutiveTimeline.tsx.
 */
import PptxGenJS from 'pptxgenjs';

// ── Types (mirrored from ExecutiveTimeline.tsx) ───────────────────────────────
export type Confidence = 'On track' | 'Watch' | 'At risk';
export type TagType    = 'milestone' | 'risk' | 'decision' | 'dependency' | 'scope_change' | 'external' | 'blocker';
export type TagStatus  = 'open' | 'resolved' | 'info';

export interface PhaseRow {
  id: string; phase: string; dates: string; focus: string; status: string;
}
export interface BoardData {
  title: string; subtext: string; confidence: Confidence;
  milestones: Array<{ label: string; sub: string }>;
  phases: PhaseRow[];
  notes: { accomplished: string; remaining: string; risks: string };
  footer: string;
}
export interface TimelineItem {
  id: string; type: TagType; title: string; detail: string | null;
  date: string | null; start_date: string | null; end_date: string | null;
  owner: string | null; status: TagStatus; severity: string;
}

// ── Design tokens ────────────────────────────────────────────────────────────
const NAVY  = '1E2761';
const ICE   = 'C5D8F8';
const WHITE = 'FFFFFF';
const DARK  = '0F172A';
const MID   = '64748B';
const PALE  = 'F1F5F9';
const LINE  = 'E2E8F0';

const CONF_COLOR: Record<Confidence, string> = {
  'On track': '059669',
  'Watch':    'D97706',
  'At risk':  'DC2626',
};

// Per-phase: [barFill, barText] (index matches board.phases order)
const PHASE_COLORS: Array<[string, string]> = [
  ['BFDBFE', '1E3A8A'],  // 0 – Backend Pipeline     (blue)
  ['FDE68A', '78350F'],  // 1 – Calibration+Testing  (amber)
  ['E9D5FF', '581C87'],  // 2 – Design Sprint 1      (purple)
  ['BBF7D0', '14532D'],  // 3 – Design Sprint 2+Build(green)
  ['93C5FD', '1E3A8A'],  // 4 – MVP Launch           (blue-mid)
  ['DDD6FE', '4C1D95'],  // 5 – Beta                 (violet)
];

// Per-phase static date ranges (days-from-Jan-1-2026)
const PHASE_RANGES: Array<{ startDay: number; endDay: number }> = [
  { startDay: 0,  endDay: 63  },  // p1 Backend:          Jan 1  – Mar 5
  { startDay: 63, endDay: 76  },  // p2 Calibration:      Mar 5  – Mar 18
  { startDay: 63, endDay: 76  },  // p3 Design Sprint 1:  Mar 5  – Mar 18
  { startDay: 77, endDay: 89  },  // p4 Design Sprint 2:  Mar 19 – Mar 31
  { startDay: 90, endDay: 90  },  // p5 MVP Launch:       Apr 1  (point)
  { startDay: 91, endDay: 150 },  // p6 Beta:             Apr 2  – May 31
];

// ── Gantt geometry ────────────────────────────────────────────────────────────
// Slide: 10" × 5.625"  (LAYOUT_16x9)
const TL_X0  = 2.60;   // left edge of bar area (inches)
const TL_X1  = 9.65;   // right edge
const TL_W   = TL_X1 - TL_X0;   // 7.05"
const DAYS   = 150;               // Jan 1 – May 31
const SCALE  = TL_W / DAYS;      // ~0.047"/day

const MONTH_TICKS: Array<{ days: number; label: string }> = [
  { days: 0,   label: 'JAN' },
  { days: 31,  label: 'FEB' },
  { days: 59,  label: 'MAR' },
  { days: 90,  label: 'APR' },
  { days: 120, label: 'MAY' },
];

const BAR_Y0   = 1.62;  // top of first bar row
const BAR_H    = 0.26;
const BAR_GAP  = 0.07;
const ROW_STEP = BAR_H + BAR_GAP;

function rowY(i: number) { return BAR_Y0 + i * ROW_STEP; }
function bx(days: number) { return TL_X0 + days * SCALE; }
function bw(start: number, end: number) { return Math.max(0.06, (end - start) * SCALE); }

/** Today as days from Jan 1 2026 (clamped to [0, 150]) */
function todayDays(): number {
  const ms   = Date.now() - new Date('2026-01-01T12:00:00').getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, Math.min(DAYS, days));
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function statusFill(s: string): [string, string] {
  switch (s) {
    case 'Running':           return ['D1FAE5', '065F46'];
    case 'In progress':       return ['FEF3C7', '78350F'];
    case 'Kicking off today': return ['DBEAFE', '1E40AF'];
    case 'Starting Mar 19':   return ['F1F5F9', '374151'];
    case 'Target':            return ['EDE9FE', '4C1D95'];
    case 'At risk':           return ['FEE2E2', '991B1B'];
    case 'Done':              return ['F1F5F9', '334155'];
    case 'Blocked':           return ['FFE4E6', '9F1239'];
    case 'Deferred':          return ['F3F4F6', '6B7280'];
    default:                  return [PALE, MID];
  }
}

const TAG_META: Record<TagType, { label: string; fill: string; text: string }> = {
  milestone:    { label: 'Milestone',    fill: 'DBEAFE', text: '1E3A8A' },
  risk:         { label: 'Risk',         fill: 'FEE2E2', text: '7F1D1D' },
  decision:     { label: 'Decision',     fill: 'FEF3C7', text: '78350F' },
  dependency:   { label: 'Dependency',   fill: 'EDE9FE', text: '4C1D95' },
  scope_change: { label: 'Scope Change', fill: 'FED7AA', text: '7C2D12' },
  external:     { label: 'External',     fill: 'CCFBF1', text: '134E4A' },
  blocker:      { label: 'Blocker',      fill: 'FFE4E6', text: '9F1239' },
};

const SEV_COLOR: Record<string, string> = {
  high:   'DC2626',
  medium: 'D97706',
  low:    '6B7280',
  none:   'D1D5DB',
};

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Cover
// ═══════════════════════════════════════════════════════════════════════════════
function addCoverSlide(pres: PptxGenJS, board: BoardData) {
  const slide = pres.addSlide();
  slide.background = { color: NAVY };

  // Left accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.1, h: 5.625,
    fill: { color: ICE }, line: { color: ICE, width: 0 },
  });

  // Decorative circles (top-right, partially off-slide)
  slide.addShape(pres.shapes.OVAL, {
    x: 7.6, y: -1.2, w: 3.8, h: 3.8,
    fill: { color: '253888' }, line: { color: ICE, width: 1.5 },
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 8.8, y: 3.6, w: 2.0, h: 2.0,
    fill: { color: '253888' }, line: { color: ICE, width: 1 },
  });

  // Program title
  slide.addText(board.title, {
    x: 0.45, y: 1.2, w: 7.2, h: 1.15,
    fontSize: 42, fontFace: 'Calibri', bold: true,
    color: WHITE, align: 'left', valign: 'middle', margin: 0,
  });

  // Subtitle
  slide.addText(board.subtext, {
    x: 0.45, y: 2.5, w: 6.5, h: 0.48,
    fontSize: 19, fontFace: 'Calibri',
    color: ICE, align: 'left', valign: 'middle', margin: 0,
  });

  // Confidence badge (pill shape + text)
  const cc = CONF_COLOR[board.confidence];
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.45, y: 3.25, w: 2.5, h: 0.42,
    fill: { color: cc }, line: { color: cc, width: 0 }, rectRadius: 0.21,
  });
  slide.addText(`${board.confidence}  ·  Q1 Confidence`, {
    x: 0.45, y: 3.25, w: 2.5, h: 0.42,
    fontSize: 11.5, fontFace: 'Calibri', bold: true,
    color: WHITE, align: 'center', valign: 'middle', margin: 0,
  });

  // Footer: date generated
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  slide.addText(`Generated ${today}`, {
    x: 0.45, y: 5.1, w: 5, h: 0.28,
    fontSize: 10, fontFace: 'Calibri', color: '7B9DC8', margin: 0,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — Gantt Timeline
// ═══════════════════════════════════════════════════════════════════════════════
function addTimelineSlide(pres: PptxGenJS, board: BoardData) {
  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  // ── Header band ────────────────────────────────────────────────────────────
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.22,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });

  // Title
  slide.addText('Program Timeline', {
    x: 0.35, y: 0.1, w: 5.5, h: 0.6,
    fontSize: 22, fontFace: 'Calibri', bold: true,
    color: WHITE, align: 'left', valign: 'middle', margin: 0,
  });

  // Confidence badge in header
  const cc = CONF_COLOR[board.confidence];
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.35, y: 0.76, w: 1.9, h: 0.34,
    fill: { color: cc }, line: { color: cc, width: 0 }, rectRadius: 0.17,
  });
  slide.addText(`${board.confidence}  ·  Q1`, {
    x: 0.35, y: 0.76, w: 1.9, h: 0.34,
    fontSize: 10, fontFace: 'Calibri', bold: true,
    color: WHITE, align: 'center', valign: 'middle', margin: 0,
  });

  // MVP date in header
  slide.addText(board.subtext, {
    x: 2.35, y: 0.79, w: 4, h: 0.28,
    fontSize: 10, fontFace: 'Calibri', color: ICE, margin: 0,
  });

  // Date generated (top-right)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  slide.addText(today, {
    x: 6.5, y: 0.10, w: 3.2, h: 0.28,
    fontSize: 9, fontFace: 'Calibri', color: ICE, align: 'right', margin: 0,
  });

  // ── Column header labels ───────────────────────────────────────────────────
  slide.addText('PHASE', {
    x: 0.20, y: 1.28, w: 2.25, h: 0.22,
    fontSize: 7.5, fontFace: 'Calibri', bold: true,
    color: MID, charSpacing: 2, margin: 0,
  });

  // Month labels (above bars)
  for (const m of MONTH_TICKS) {
    const x = bx(m.days);
    slide.addText(m.label, {
      x: x - 0.25, y: 1.27, w: 0.5, h: 0.22,
      fontSize: 7.5, fontFace: 'Calibri', bold: true,
      color: MID, align: 'center', charSpacing: 1, margin: 0,
    });
    // tick mark
    slide.addShape(pres.shapes.LINE, {
      x, y: 1.50, w: 0, h: 0.1,
      line: { color: LINE, width: 0.75 },
    });
  }

  // Month divider lines (vertical, running through bar rows)
  const barBottom = rowY(5) + BAR_H;
  for (const m of MONTH_TICKS.slice(1)) {  // skip Jan (start edge)
    const x = bx(m.days);
    slide.addShape(pres.shapes.LINE, {
      x, y: 1.60, w: 0, h: barBottom - 1.60,
      line: { color: LINE, width: 0.5, dashType: 'dot' },
    });
  }

  // ── Alternating row backgrounds ────────────────────────────────────────────
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) continue;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: rowY(i) - 0.02, w: 10, h: BAR_H + 0.04,
      fill: { color: 'F8FAFC' }, line: { color: 'F8FAFC', width: 0 },
    });
  }

  // ── TODAY line ─────────────────────────────────────────────────────────────
  const td = todayDays();
  const todayX = bx(td);
  if (td >= 0 && td <= DAYS) {
    slide.addShape(pres.shapes.LINE, {
      x: todayX, y: 1.48, w: 0, h: barBottom - 1.48 + 0.15,
      line: { color: 'DC2626', width: 1.25 },
    });
    // TODAY triangle marker at top
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: todayX - 0.28, y: 1.38, w: 0.56, h: 0.18,
      fill: { color: 'DC2626' }, line: { color: 'DC2626', width: 0 }, rectRadius: 0.04,
    });
    slide.addText('TODAY', {
      x: todayX - 0.28, y: 1.38, w: 0.56, h: 0.18,
      fontSize: 6.5, fontFace: 'Calibri', bold: true,
      color: WHITE, align: 'center', valign: 'middle', margin: 0,
    });
  }

  // ── Phase rows ─────────────────────────────────────────────────────────────
  const phases = board.phases;
  for (let i = 0; i < 6; i++) {
    const ph    = phases[i];
    const range = PHASE_RANGES[i];
    const [fill, textClr] = PHASE_COLORS[i] ?? ['E2E8F0', DARK];
    const y = rowY(i);

    // Left label column: phase name
    const labelText = ph?.phase ?? `Phase ${i + 1}`;
    slide.addText(labelText, {
      x: 0.20, y: y, w: 2.28, h: BAR_H,
      fontSize: 8.5, fontFace: 'Calibri', bold: true,
      color: DARK, valign: 'middle', margin: 0,
    });

    // Status badge (small pill next to bar)
    if (ph?.status) {
      const [sFill, sTxt] = statusFill(ph.status);
      const badgeW = 1.05;
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 0.20, y: y + BAR_H / 2 + 0.005, w: badgeW, h: 0.13,
        fill: { color: sFill }, line: { color: sFill, width: 0 }, rectRadius: 0.065,
      });
      slide.addText(ph.status, {
        x: 0.20, y: y + BAR_H / 2 + 0.005, w: badgeW, h: 0.13,
        fontSize: 6.5, fontFace: 'Calibri',
        color: sTxt, align: 'center', valign: 'middle', margin: 0,
      });
    }

    // Dates string (right-aligned in left column, very small)
    if (ph?.dates) {
      slide.addText(ph.dates, {
        x: 0.20, y: y + BAR_H / 2 + 0.005, w: 2.28, h: 0.13,
        fontSize: 6.5, fontFace: 'Calibri', color: MID,
        align: 'right', valign: 'middle', margin: 0,
      });
    }

    // Bar (skip MVP Launch — it's a point marker)
    if (range.startDay === range.endDay) {
      // MVP Launch: draw a diamond marker
      const mx = bx(range.startDay);
      const my = y + BAR_H / 2;
      const sz = 0.18;
      slide.addShape(pres.shapes.OVAL, {
        x: mx - sz / 2, y: my - sz / 2, w: sz, h: sz,
        fill: { color: '1D4ED8' }, line: { color: WHITE, width: 1.5 },
        shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.25 },
      });
      // LAUNCH label
      slide.addText('LAUNCH', {
        x: mx - 0.3, y: my - sz / 2 - 0.15, w: 0.6, h: 0.14,
        fontSize: 6.5, fontFace: 'Calibri', bold: true,
        color: '1D4ED8', align: 'center', margin: 0,
      });
    } else {
      const barX   = bx(range.startDay);
      const barWid = bw(range.startDay, range.endDay);

      slide.addShape(pres.shapes.RECTANGLE, {
        x: barX, y, w: barWid, h: BAR_H,
        fill: { color: fill }, line: { color: fill, width: 0 },
      });

      // Phase label inside bar (only if wide enough > 0.5")
      if (barWid >= 0.5) {
        const label = ph?.phase ?? '';
        const truncated = label.length > 22 ? label.slice(0, 21) + '…' : label;
        slide.addText(truncated, {
          x: barX + 0.06, y, w: barWid - 0.08, h: BAR_H,
          fontSize: 7.5, fontFace: 'Calibri', bold: true,
          color: textClr, valign: 'middle', margin: 0,
        });
      }
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  if (board.footer) {
    const truncFooter = board.footer.length > 110 ? board.footer.slice(0, 109) + '…' : board.footer;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 5.20, w: 10, h: 0.42,
      fill: { color: PALE }, line: { color: LINE, width: 0 },
    });
    slide.addText(truncFooter, {
      x: 0.35, y: 5.21, w: 9.3, h: 0.40,
      fontSize: 9, fontFace: 'Calibri', italic: true,
      color: MID, valign: 'middle', margin: 0,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Phase Status Table
// ═══════════════════════════════════════════════════════════════════════════════
function addPhaseTableSlide(pres: PptxGenJS, board: BoardData) {
  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  // Header band
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.05,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  slide.addText('Phase Breakdown', {
    x: 0.35, y: 0.08, w: 7, h: 0.55,
    fontSize: 22, fontFace: 'Calibri', bold: true,
    color: WHITE, valign: 'middle', margin: 0,
  });
  slide.addText(board.subtext, {
    x: 0.35, y: 0.65, w: 5, h: 0.28,
    fontSize: 10, fontFace: 'Calibri', color: ICE, margin: 0,
  });

  // Table header
  const COL_X = [0.2, 3.6, 5.4, 6.95];
  const COLS  = ['Phase & Focus', 'Dates', 'Status', 'Tags / Notes'];
  const COL_W = [3.35, 1.75, 1.5, 3.0];

  // Header row background
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.20, y: 1.12, w: 9.6, h: 0.30,
    fill: { color: PALE }, line: { color: LINE, width: 0 },
  });
  for (let c = 0; c < COLS.length; c++) {
    slide.addText(COLS[c].toUpperCase(), {
      x: COL_X[c], y: 1.12, w: COL_W[c], h: 0.30,
      fontSize: 7.5, fontFace: 'Calibri', bold: true,
      color: MID, valign: 'middle', charSpacing: 1, margin: 0,
    });
  }

  // Data rows
  const ROW_Y0_TBL = 1.45;
  const ROW_H_TBL  = 0.52;

  board.phases.forEach((ph, i) => {
    const ry = ROW_Y0_TBL + i * ROW_H_TBL;
    const [phFill] = PHASE_COLORS[i] ?? [PALE, DARK];

    // Alternating bg
    if (i % 2 === 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: 0.20, y: ry - 0.02, w: 9.6, h: ROW_H_TBL,
        fill: { color: 'FAFBFC' }, line: { color: 'FAFBFC', width: 0 },
      });
    }

    // Color swatch on far left
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.20, y: ry, w: 0.08, h: ROW_H_TBL - 0.04,
      fill: { color: phFill }, line: { color: phFill, width: 0 },
    });

    // Phase name + focus
    slide.addText(ph.phase, {
      x: COL_X[0] + 0.14, y: ry + 0.02, w: COL_W[0] - 0.16, h: 0.22,
      fontSize: 9.5, fontFace: 'Calibri', bold: true, color: DARK, margin: 0,
    });
    if (ph.focus) {
      // Strip markdown for plain text display
      const plainFocus = ph.focus
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/^[-*]\s+/gm, '• ')
        .replace(/\n/g, '  ');
      const truncFocus = plainFocus.length > 65 ? plainFocus.slice(0, 64) + '…' : plainFocus;
      slide.addText(truncFocus, {
        x: COL_X[0] + 0.14, y: ry + 0.26, w: COL_W[0] - 0.16, h: 0.22,
        fontSize: 8, fontFace: 'Calibri', color: MID, margin: 0,
      });
    }

    // Dates
    slide.addText(ph.dates, {
      x: COL_X[1], y: ry + 0.12, w: COL_W[1], h: 0.26,
      fontSize: 8.5, fontFace: 'Calibri', color: DARK, valign: 'middle', margin: 0,
    });

    // Status pill
    const [sFill, sTxt] = statusFill(ph.status);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: COL_X[2], y: ry + 0.12, w: 1.35, h: 0.26,
      fill: { color: sFill }, line: { color: sFill, width: 0 }, rectRadius: 0.13,
    });
    slide.addText(ph.status, {
      x: COL_X[2], y: ry + 0.12, w: 1.35, h: 0.26,
      fontSize: 8.5, fontFace: 'Calibri', bold: true,
      color: sTxt, align: 'center', valign: 'middle', margin: 0,
    });

    // Row separator
    if (i < board.phases.length - 1) {
      slide.addShape(pres.shapes.LINE, {
        x: 0.20, y: ry + ROW_H_TBL - 0.02, w: 9.6, h: 0,
        line: { color: LINE, width: 0.5 },
      });
    }
  });

  // Footer
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.25, w: 10, h: 0.375,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  slide.addText(board.title, {
    x: 0.35, y: 5.26, w: 9.3, h: 0.35,
    fontSize: 9, fontFace: 'Calibri', color: ICE, valign: 'middle', margin: 0,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Risks & Action Items (only if open tags exist)
// ═══════════════════════════════════════════════════════════════════════════════
function addRisksSlide(pres: PptxGenJS, board: BoardData, tags: TimelineItem[]) {
  const priorityTypes: TagType[] = ['risk', 'blocker', 'decision', 'dependency'];
  const openTags = tags
    .filter(t => t.status === 'open' && (priorityTypes.includes(t.type) || t.type === 'milestone'))
    .sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2, none: 3 };
      return (sevOrder[a.severity as keyof typeof sevOrder] ?? 3) - (sevOrder[b.severity as keyof typeof sevOrder] ?? 3);
    })
    .slice(0, 8);

  if (openTags.length === 0) return;  // skip slide if nothing to show

  const slide = pres.addSlide();
  slide.background = { color: NAVY };

  // Top accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.08,
    fill: { color: ICE }, line: { color: ICE, width: 0 },
  });

  // Title
  slide.addText('Risks & Actions', {
    x: 0.40, y: 0.18, w: 6, h: 0.65,
    fontSize: 26, fontFace: 'Calibri', bold: true, color: WHITE, margin: 0,
  });
  slide.addText(`${openTags.length} open item${openTags.length > 1 ? 's' : ''}  ·  as of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, {
    x: 0.40, y: 0.85, w: 7, h: 0.26,
    fontSize: 10, fontFace: 'Calibri', color: ICE, margin: 0,
  });

  // Items
  const ITEM_Y0 = 1.22;
  const ITEM_H  = 0.48;
  const ITEM_G  = 0.06;
  const COLS_HALF = openTags.length > 4;  // 2-column layout if >4 items
  const COL_W_ITEM = COLS_HALF ? 4.55 : 9.2;
  const COL2_X     = COLS_HALF ? 5.25 : 0;

  openTags.forEach((tag, i) => {
    const col  = COLS_HALF ? Math.floor(i / 4) : 0;
    const row  = COLS_HALF ? i % 4 : i;
    const ix   = 0.40 + col * COL2_X;
    const iy   = ITEM_Y0 + row * (ITEM_H + ITEM_G);
    const meta = TAG_META[tag.type];
    const sevClr = SEV_COLOR[tag.severity] ?? SEV_COLOR.none;

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: ix, y: iy, w: COL_W_ITEM, h: ITEM_H,
      fill: { color: '253480' }, line: { color: '2D3E90', width: 0.5 },
    });

    // Severity accent bar (left edge)
    slide.addShape(pres.shapes.RECTANGLE, {
      x: ix, y: iy, w: 0.06, h: ITEM_H,
      fill: { color: sevClr }, line: { color: sevClr, width: 0 },
    });

    // Type badge
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: ix + 0.13, y: iy + 0.10, w: 0.90, h: 0.18,
      fill: { color: meta.fill }, line: { color: meta.fill, width: 0 }, rectRadius: 0.09,
    });
    slide.addText(meta.label.toUpperCase(), {
      x: ix + 0.13, y: iy + 0.10, w: 0.90, h: 0.18,
      fontSize: 6.5, fontFace: 'Calibri', bold: true,
      color: meta.text, align: 'center', valign: 'middle', charSpacing: 0.5, margin: 0,
    });

    // Severity dot
    slide.addShape(pres.shapes.OVAL, {
      x: ix + 1.07, y: iy + 0.135, w: 0.10, h: 0.10,
      fill: { color: sevClr }, line: { color: sevClr, width: 0 },
    });

    // Title
    const title = tag.title.length > 55 ? tag.title.slice(0, 54) + '…' : tag.title;
    slide.addText(title, {
      x: ix + 0.13, y: iy + 0.28, w: COL_W_ITEM - 0.20, h: 0.18,
      fontSize: 9, fontFace: 'Calibri', bold: true, color: WHITE, margin: 0,
    });

    // Owner + date (right side of badge row)
    const dateLabel = tag.date ? fmtDate(tag.date)
      : tag.start_date ? `${fmtDate(tag.start_date)}` : '';
    const ownerDate = [tag.owner, dateLabel].filter(Boolean).join('  ·  ');
    if (ownerDate) {
      slide.addText(ownerDate, {
        x: ix + 1.25, y: iy + 0.09, w: COL_W_ITEM - 1.40, h: 0.20,
        fontSize: 8, fontFace: 'Calibri', color: '8BAFD4',
        align: 'right', valign: 'middle', margin: 0,
      });
    }
  });

  // Footer
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.25, w: 10, h: 0.375,
    fill: { color: '13194A' }, line: { color: '13194A', width: 0 },
  });
  slide.addText(board.title, {
    x: 0.35, y: 5.26, w: 9.3, h: 0.35,
    fontSize: 9, fontFace: 'Calibri', color: ICE, valign: 'middle', margin: 0,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Program Notes (only if notes have content)
// ═══════════════════════════════════════════════════════════════════════════════
function addNotesSlide(pres: PptxGenJS, board: BoardData) {
  const { accomplished, remaining, risks } = board.notes;
  if (!accomplished && !remaining && !risks) return;

  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  // Header band
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.0,
    fill: { color: NAVY }, line: { color: NAVY, width: 0 },
  });
  slide.addText('Program Notes', {
    x: 0.35, y: 0.08, w: 7, h: 0.56,
    fontSize: 22, fontFace: 'Calibri', bold: true, color: WHITE, valign: 'middle', margin: 0,
  });

  const SECTIONS: Array<{ title: string; value: string; accent: string }> = [
    { title: 'Accomplished',   value: accomplished, accent: '059669' },
    { title: 'Remaining Work', value: remaining,    accent: 'D97706' },
    { title: 'Key Risks',      value: risks,        accent: 'DC2626' },
  ].filter(s => s.value);

  const colW = SECTIONS.length === 1 ? 9.2 : SECTIONS.length === 2 ? 4.45 : 2.95;
  const colXs = SECTIONS.length === 1 ? [0.4] : SECTIONS.length === 2 ? [0.4, 5.15] : [0.4, 3.55, 6.7];

  SECTIONS.forEach((sec, i) => {
    const cx = colXs[i];
    const cy = 1.12;

    // Accent top border
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: colW, h: 0.05,
      fill: { color: sec.accent }, line: { color: sec.accent, width: 0 },
    });

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy + 0.05, w: colW, h: 3.8,
      fill: { color: PALE }, line: { color: LINE, width: 0.5 },
    });

    // Section title
    slide.addText(sec.title.toUpperCase(), {
      x: cx + 0.15, y: cy + 0.15, w: colW - 0.3, h: 0.30,
      fontSize: 8, fontFace: 'Calibri', bold: true,
      color: sec.accent, charSpacing: 1.5, margin: 0,
    });

    // Content (plain text, strip markdown)
    const plain = sec.value
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^[-*]\s+/gm, '• ');
    slide.addText(plain, {
      x: cx + 0.15, y: cy + 0.5, w: colW - 0.3, h: 3.25,
      fontSize: 9.5, fontFace: 'Calibri', color: DARK,
      valign: 'top', margin: 0,
    });
  });

  // Footer
  if (board.footer) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 5.20, w: 10, h: 0.425,
      fill: { color: PALE }, line: { color: LINE, width: 0 },
    });
    const truncFooter = board.footer.length > 120 ? board.footer.slice(0, 119) + '…' : board.footer;
    slide.addText(truncFooter, {
      x: 0.35, y: 5.21, w: 9.3, h: 0.40,
      fontSize: 9, fontFace: 'Calibri', italic: true,
      color: MID, valign: 'middle', margin: 0,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main export
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateTimelinePptx(board: BoardData, tags: TimelineItem[]): Promise<void> {
  const pres = new PptxGenJS();
  pres.layout  = 'LAYOUT_16x9';
  pres.title   = board.title;
  pres.author  = 'Executive Timeline';
  pres.subject = 'Q1 Program Timeline';

  addCoverSlide(pres, board);
  addTimelineSlide(pres, board);
  addPhaseTableSlide(pres, board);
  addRisksSlide(pres, board, tags);
  addNotesSlide(pres, board);

  const dateStr  = new Date().toISOString().slice(0, 10);
  const fileName = `${board.title.replace(/\s+/g, '-')}-${dateStr}.pptx`;
  await pres.writeFile({ fileName });
}
