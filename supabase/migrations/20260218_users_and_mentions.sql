-- =============================================================================
-- Migration: public.users + public.mentions tables
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- BEFORE the attachments migration if you haven't already, or alongside it.
-- =============================================================================

-- ─── 1. public.users ─────────────────────────────────────────────────────────
-- Mirrors auth.users with extra profile fields needed for @mention autocomplete.
-- Populated automatically via useAuth.ts → upsertUserRecord() on every login.

create table if not exists public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  name        text        not null default '',
  avatar_url  text,
  last_seen   timestamptz not null default now()
);

-- Allow any authenticated user to read the directory (needed for @mention dropdown)
alter table public.users enable row level security;

create policy "Authenticated users can read user directory"
  on public.users
  for select
  using (auth.role() = 'authenticated');

-- Users can only upsert their own record
create policy "Users can upsert own record"
  on public.users
  for insert
  with check (id = auth.uid());

create policy "Users can update own record"
  on public.users
  for update
  using (id = auth.uid());


-- ─── 2. public.mentions ──────────────────────────────────────────────────────
-- Stores which user was mentioned in which field of which node.
-- Used to: (a) pre-seed the mention set on edit, (b) diff net-new on re-save.

create table if not exists public.mentions (
  id                   uuid        primary key default gen_random_uuid(),
  context_type         text        not null,  -- 'node'
  context_id           text        not null,  -- node id
  field                text        not null,  -- 'comment' | 'weekly_update' | …
  mentioned_user_id    uuid        not null references auth.users(id) on delete cascade,
  mentioned_email      text        not null,
  mentioned_name       text        not null,
  created_by_user_id   uuid        references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),

  -- Prevent duplicate mention rows for the same user in the same field
  unique (context_type, context_id, field, mentioned_user_id)
);

create index if not exists mentions_context_idx
  on public.mentions (context_type, context_id, field);

alter table public.mentions enable row level security;

-- Any authenticated user can read mentions (needed for pre-seeding on edit)
create policy "Authenticated users can read mentions"
  on public.mentions
  for select
  using (auth.role() = 'authenticated');

-- Any authenticated user can insert mention records
create policy "Authenticated users can insert mentions"
  on public.mentions
  for insert
  with check (auth.role() = 'authenticated');

-- Mentions can be deleted by the person who created them
create policy "Creators can delete mentions"
  on public.mentions
  for delete
  using (created_by_user_id = auth.uid());
