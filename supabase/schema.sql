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

-- Public reference layers are stored as KMZ/KML objects in Supabase Storage.
-- PostgreSQL keeps only searchable metadata; large binary files do not belong
-- in a database row.
create table if not exists public.reference_layers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  storage_bucket text not null default 'reference-layers',
  storage_path text not null unique,
  file_type text not null default 'kmz' check (file_type in ('kml', 'kmz')),
  style jsonb not null default '{"color":"#7c3aed","fillColor":"#8b5cf6","fillOpacity":0.12,"weight":2}'::jsonb,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
create index if not exists analysis_runs_project_created_idx on public.analysis_runs(project_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.reference_layers enable row level security;

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

drop policy if exists "reference_layers_read_active" on public.reference_layers;
create policy "reference_layers_read_active" on public.reference_layers
for select using (is_active = true);

-- Create a public, read-only bucket for reference layers. Uploads are made by
-- an administrator through the Supabase Dashboard or a service-role process.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-layers',
  'reference-layers',
  true,
  52428800,
  array['application/vnd.google-earth.kmz', 'application/vnd.google-earth.kml+xml', 'application/zip', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "reference_layers_storage_public_read" on storage.objects;
create policy "reference_layers_storage_public_read" on storage.objects
for select using (bucket_id = 'reference-layers');

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

drop trigger if exists reference_layers_set_updated_at on public.reference_layers;
create trigger reference_layers_set_updated_at before update on public.reference_layers
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
revoke all on public.reference_layers from anon, authenticated;
grant select on public.reference_layers to anon, authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.analysis_runs to authenticated;
grant select, update on public.profiles to authenticated;
