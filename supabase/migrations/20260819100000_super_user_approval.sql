-- Add the Super User role and an approval queue for accounts requested by Super Users.
-- Apply after 20260723130000_user_administration.sql. The permissions column is
-- added defensively so this migration is safe before or after the MOD 1 privacy migration.

alter table public.profiles
  add column if not exists permissions jsonb;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'super_user', 'user'));

-- Keep database-level module authorization aligned with the Worker. Super Users
-- have full module access, while account governance remains enforced by Worker APIs.
create or replace function public.permission_out_can(p_module text, p_action text default 'view')
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.is_active
      and (
        profile.role in ('admin', 'super_user')
        or (
          p_action = 'view'
          and coalesce(
            profile.permissions -> p_module ->> 'view',
            auth.jwt() -> 'app_metadata' -> 'permission_out_permissions' -> p_module ->> 'view',
            'true'
          ) = 'true'
        )
        or (
          p_action = 'update'
          and coalesce(
            profile.permissions -> p_module ->> 'view',
            auth.jwt() -> 'app_metadata' -> 'permission_out_permissions' -> p_module ->> 'view',
            'true'
          ) = 'true'
          and coalesce(
            profile.permissions -> p_module ->> 'update',
            auth.jwt() -> 'app_metadata' -> 'permission_out_permissions' -> p_module ->> 'update',
            'false'
          ) = 'true'
        )
      )
  );
$$;

revoke all on function public.permission_out_can(text, text) from public, anon;
grant execute on function public.permission_out_can(text, text) to authenticated, service_role;

create table if not exists public.user_creation_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  organization text,
  requested_role text not null default 'user'
    check (requested_role in ('super_user', 'user')),
  requested_permissions jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  approved_user_id uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_creation_requests_email_check
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create unique index if not exists user_creation_requests_pending_email_idx
  on public.user_creation_requests (lower(email))
  where status in ('pending', 'processing');

create index if not exists user_creation_requests_status_created_idx
  on public.user_creation_requests (status, created_at desc);

create index if not exists user_creation_requests_requested_by_idx
  on public.user_creation_requests (requested_by, created_at desc);

alter table public.user_creation_requests enable row level security;
revoke all on public.user_creation_requests from anon, authenticated;

comment on table public.user_creation_requests is
  'Approval queue for accounts proposed by Super Users. Access is restricted to the server-side service role.';
comment on column public.user_creation_requests.requested_permissions is
  'Permission snapshot reviewed by an Admin before the invitation is sent.';
comment on column public.user_creation_requests.status is
  'pending, processing, approved, rejected, or cancelled.';
