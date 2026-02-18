-- =============================================================================
-- Migration: create public.attachments table + Storage bucket
--
-- Run via Supabase dashboard (SQL editor) or:
--   supabase db push
-- =============================================================================

-- ─── 1. attachments table ────────────────────────────────────────────────────

create table if not exists public.attachments (
  id                   uuid primary key default gen_random_uuid(),
  context_type         text        not null,           -- e.g. 'node'
  context_id           text        not null,           -- node id OR comment id
  field                text        not null,           -- 'weekly_update' | 'comment'
  file_name            text        not null,
  file_path            text        not null unique,    -- path inside the bucket
  mime_type            text        not null default 'application/octet-stream',
  size_bytes           bigint      not null default 0,
  uploaded_by_user_id  uuid        references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- Index so the client can quickly fetch all attachments for a given context
create index if not exists attachments_context_idx
  on public.attachments (context_type, context_id, field);

-- ─── 2. Row Level Security ────────────────────────────────────────────────────

alter table public.attachments enable row level security;

-- Any authenticated user can read attachments
create policy "Authenticated users can view attachments"
  on public.attachments
  for select
  using (auth.role() = 'authenticated');

-- Any authenticated user can insert their own attachments
create policy "Authenticated users can insert attachments"
  on public.attachments
  for insert
  with check (
    auth.role() = 'authenticated'
    and uploaded_by_user_id = auth.uid()
  );

-- Only the uploader can delete their own attachments
create policy "Uploaders can delete their own attachments"
  on public.attachments
  for delete
  using (uploaded_by_user_id = auth.uid());

-- ─── 3. Storage bucket ───────────────────────────────────────────────────────
-- NOTE: The SQL below uses the Supabase storage schema.
-- If you prefer to create the bucket in the dashboard UI instead:
--   Dashboard → Storage → New bucket → name: "attachments", Private ✓

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,                  -- private bucket — access only via signed URLs
  52428800,               -- 50 MB per-file limit
  null                    -- allow all mime types
)
on conflict (id) do nothing;

-- Storage RLS: authenticated users can upload to their own paths
create policy "Authenticated users can upload attachments"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'attachments');

-- Storage RLS: authenticated users can read any attachment
create policy "Authenticated users can read attachments"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'attachments');

-- Storage RLS: uploaders can delete their own objects
-- (path starts with <context_type>/<context_id>/...)
create policy "Authenticated users can delete attachments"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'attachments');
