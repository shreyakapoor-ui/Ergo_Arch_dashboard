-- =============================================================================
-- Migration: public.timeline_items
--
-- Stores tagged events on the Executive Timeline (milestones, risks,
-- decisions, dependencies, scope changes, external events, blockers).
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- =============================================================================

-- ─── 1. timeline_items table ─────────────────────────────────────────────────

create table if not exists public.timeline_items (
  id          uuid        primary key default gen_random_uuid(),
  program_id  text        not null default 'ergo-q1',
  phase_id    text,                       -- matches PhaseRow.id from localStorage board
  type        text        not null check (type in (
                'milestone','risk','decision','dependency',
                'scope_change','external','blocker'
              )),
  title       text        not null,
  detail      text,
  date        date,                       -- single-date anchor (NULL when using range)
  start_date  date,                       -- range start  (NULL when using single date)
  end_date    date,                       -- range end    (NULL when using single date)
  owner       text,
  status      text        not null default 'open'
                          check (status in ('open','resolved','info')),
  severity    text        not null default 'none'
                          check (severity in ('none','low','medium','high')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

create index if not exists timeline_items_program_idx  on public.timeline_items (program_id);
create index if not exists timeline_items_phase_idx    on public.timeline_items (phase_id);
create index if not exists timeline_items_type_idx     on public.timeline_items (type);
create index if not exists timeline_items_date_idx     on public.timeline_items (date);

-- ─── 3. Auto-update updated_at ───────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger timeline_items_updated_at
  before update on public.timeline_items
  for each row execute function public.set_updated_at();

-- ─── 4. Row Level Security ────────────────────────────────────────────────────

alter table public.timeline_items enable row level security;

-- Any authenticated user can read all timeline items for this program
create policy "Authenticated users can read timeline items"
  on public.timeline_items
  for select
  using (auth.role() = 'authenticated');

-- Any authenticated user can create timeline items
create policy "Authenticated users can insert timeline items"
  on public.timeline_items
  for insert
  with check (auth.role() = 'authenticated');

-- Any authenticated user can update any timeline item (collaborative PM board)
create policy "Authenticated users can update timeline items"
  on public.timeline_items
  for update
  using (auth.role() = 'authenticated');

-- Any authenticated user can delete timeline items
create policy "Authenticated users can delete timeline items"
  on public.timeline_items
  for delete
  using (auth.role() = 'authenticated');

-- ─── 5. Seed a few starter items for ergo-q1 ────────────────────────────────

insert into public.timeline_items (program_id, phase_id, type, title, detail, date, status, severity)
values
  ('ergo-q1', 'p1', 'milestone', 'Backend pipeline live',   'Analysis engine running end-to-end', '2026-03-01', 'resolved', 'none'),
  ('ergo-q1', 'p2', 'risk',      'RAudit quality gap',      'Balance checker output needs calibration before UI can consume it', '2026-03-05', 'open', 'medium'),
  ('ergo-q1', 'p3', 'milestone', 'Design Sprint 1 kick-off','User stories + wireframes begin today', '2026-03-05', 'open', 'none'),
  ('ergo-q1', 'p4', 'decision',  'UI framework locked',     'React + Tailwind confirmed, no further changes', '2026-03-10', 'resolved', 'none'),
  ('ergo-q1', 'p5', 'milestone', 'MVP Launch',              'Live with one client', '2026-04-01', 'open', 'none')
on conflict do nothing;
