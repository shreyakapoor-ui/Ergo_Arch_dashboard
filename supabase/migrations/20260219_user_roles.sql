-- =============================================================================
-- Migration: public.user_roles table
--
-- Stores per-user access control: allowed domains, role (admin/member),
-- and active flag. The seeded admin row is created here so the first
-- login by shreya.kapoor@bluelabellabs.com automatically gets admin rights.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- =============================================================================

-- ─── 1. public.user_roles ────────────────────────────────────────────────────

create table if not exists public.user_roles (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  email       text        unique not null,
  role        text        not null check (role in ('admin', 'member')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Fast lookups on login (by email) and admin queries (by user_id)
create index if not exists user_roles_email_idx   on public.user_roles (email);
create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

-- ─── 2. Row Level Security ────────────────────────────────────────────────────

alter table public.user_roles enable row level security;

-- Any authenticated user can read their own row (needed by useAuth to fetch role)
create policy "Users can read own role"
  on public.user_roles
  for select
  using (
    auth.uid() = user_id
    or email = (select email from auth.users where id = auth.uid())
  );

-- Admins can read ALL rows (needed by UserManagementPanel)
create policy "Admins can read all roles"
  on public.user_roles
  for select
  using (
    exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid()
        and r.role    = 'admin'
        and r.active  = true
    )
  );

-- Any authenticated user can insert their OWN row as 'member' (self-provisioning on first login)
create policy "Users can self-provision their own role row"
  on public.user_roles
  for insert
  with check (
    email = (select email from auth.users where id = auth.uid())
    and role = 'member'
  );

-- Admins can insert any row (add members / admins via User Management Panel)
create policy "Admins can insert roles"
  on public.user_roles
  for insert
  with check (
    exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid()
        and r.role    = 'admin'
        and r.active  = true
    )
  );

-- Only admins can update (change role / toggle active)
create policy "Admins can update roles"
  on public.user_roles
  for update
  using (
    exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid()
        and r.role    = 'admin'
        and r.active  = true
    )
  );

-- ─── 3. Seed initial admin ───────────────────────────────────────────────────
-- user_id is null here; it will be back-filled on first login via useAuth.ts

insert into public.user_roles (email, role, active)
values ('shreya.kapoor@bluelabellabs.com', 'admin', true)
on conflict (email) do nothing;
