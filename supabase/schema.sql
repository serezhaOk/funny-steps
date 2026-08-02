-- FUNNY STEPS — database schema and row level security.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste ->
-- Run. It is idempotent, so re-running it is safe.
--
-- The client only ever holds the publishable (anon) key. Every policy below is
-- enforced by Postgres, so that key cannot read or write anyone else's rows.

-- ---------------------------------------------------------------- profiles --
-- One row per account, created automatically on sign-up.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Fill profiles automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- projects --
-- A saved session: tempo, key and the note grids of every track. The pattern
-- itself is JSON so the shape can evolve without a migration.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'untitled',
  bpm         integer not null default 120,
  root_pc     integer not null default 9,
  scale       text not null default 'minor',
  tracks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx
  on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- Owners only — all four verbs, both directions.
drop policy if exists "projects: read own" on public.projects;
create policy "projects: read own"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "projects: insert own" on public.projects;
create policy "projects: insert own"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "projects: update own" on public.projects;
create policy "projects: update own"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects: delete own" on public.projects;
create policy "projects: delete own"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();
