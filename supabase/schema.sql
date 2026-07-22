-- Permission Out production schema
-- Run once in Supabase SQL Editor. All application tables are protected by RLS.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  organization text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  snapshot jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists summary jsonb not null default '{}'::jsonb;

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  summary jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
create index if not exists analysis_runs_project_created_idx on public.analysis_runs(project_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.analysis_runs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select using (auth.uid() = owner_id);
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = owner_id);
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = owner_id);

drop policy if exists "runs_select_own" on public.analysis_runs;
create policy "runs_select_own" on public.analysis_runs for select using (auth.uid() = owner_id);
drop policy if exists "runs_insert_own" on public.analysis_runs;
create policy "runs_insert_own" on public.analysis_runs for insert with check (
  auth.uid() = owner_id and exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  )
);
drop policy if exists "runs_delete_own" on public.analysis_runs;
create policy "runs_delete_own" on public.analysis_runs for delete using (auth.uid() = owner_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on public.profiles, public.projects, public.analysis_runs from anon;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.analysis_runs to authenticated;
grant select, update on public.profiles to authenticated;
