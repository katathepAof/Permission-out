-- Permission Out authentication roles and administrator-managed user lifecycle.
-- Apply this migration before enabling the Worker admin API.

alter table public.profiles
  add column if not exists role text not null default 'user',
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('admin', 'user'));
  end if;
end
$$;

-- Backfill users that existed before the profile trigger was installed.
insert into public.profiles (id, display_name, organization, role, is_active)
select
  user_record.id,
  coalesce(
    nullif(user_record.raw_user_meta_data ->> 'display_name', ''),
    split_part(user_record.email, '@', 1)
  ),
  nullif(user_record.raw_user_meta_data ->> 'organization', ''),
  'user',
  true
from auth.users as user_record
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, organization, role, is_active)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'organization', ''),
    'user',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Users may read their own profile, but role and active state are managed only
-- by the server-side service role through the Cloudflare Worker.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

comment on column public.profiles.role is
  'Application authorization role. Mutated only by the server-side administrator API.';
comment on column public.profiles.is_active is
  'Application access state. False users are denied by the application and banned in Supabase Auth.';

