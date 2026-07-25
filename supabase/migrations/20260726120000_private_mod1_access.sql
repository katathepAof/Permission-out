-- Require an authenticated, active MOD 1 session for business data.
-- Static application assets remain public; route, area, project and billing
-- data are protected by the Worker and by Supabase RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'permission-out-data',
  'permission-out-data',
  false,
  104857600,
  array[
    'application/json',
    'application/geo+json',
    'application/gzip',
    'text/csv',
    'application/vnd.google-earth.kmz',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.profiles
  add column if not exists permissions jsonb;

update public.profiles profile
set permissions = auth_user.raw_app_meta_data -> 'permission_out_permissions'
from auth.users auth_user
where auth_user.id = profile.id
  and profile.permissions is null
  and auth_user.raw_app_meta_data ? 'permission_out_permissions';

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
        profile.role = 'admin'
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

comment on column public.profiles.permissions is
  'Server-managed module permissions used for immediate per-request authorization.';

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects for select to authenticated
using (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert to authenticated
with check (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update to authenticated
using (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'))
with check (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete to authenticated
using (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "runs_select_own" on public.analysis_runs;
create policy "runs_select_own" on public.analysis_runs for select to authenticated
using (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "runs_insert_own" on public.analysis_runs;
create policy "runs_insert_own" on public.analysis_runs for insert to authenticated
with check (
  auth.uid() = owner_id
  and public.permission_out_can('mod1', 'view')
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = auth.uid()
  )
);

drop policy if exists "runs_delete_own" on public.analysis_runs;
create policy "runs_delete_own" on public.analysis_runs for delete to authenticated
using (auth.uid() = owner_id and public.permission_out_can('mod1', 'view'));

drop policy if exists "uih_datasets_public_read" on public.uih_datasets;
drop policy if exists "uih_datasets_mod1_read" on public.uih_datasets;
create policy "uih_datasets_mod1_read" on public.uih_datasets for select to authenticated
using (is_active and public.permission_out_can('mod1', 'view'));

drop policy if exists "uih_features_public_read" on public.uih_features;
drop policy if exists "uih_features_mod1_read" on public.uih_features;
create policy "uih_features_mod1_read" on public.uih_features for select to authenticated
using (
  public.permission_out_can('mod1', 'view')
  and exists (
    select 1 from public.uih_datasets d
    where d.id = dataset_id and d.is_active
  )
);

revoke all on public.uih_datasets, public.uih_features from anon;
grant select on public.uih_datasets, public.uih_features to authenticated, service_role;

drop policy if exists "Billing formulas are readable" on public.billing_formula_versions;
drop policy if exists "Billing formulas require MOD 1" on public.billing_formula_versions;
create policy "Billing formulas require MOD 1"
on public.billing_formula_versions for select to authenticated
using (public.permission_out_can('mod1', 'view'));

revoke execute on function public.get_active_billing_formula(text) from anon, authenticated;
grant execute on function public.get_active_billing_formula(text) to service_role;

revoke execute on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric, integer) from anon;
revoke execute on function public.calculate_permission_fee_batch_v1(jsonb, numeric, numeric, numeric) from anon;
grant execute on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric, integer) to authenticated, service_role;
grant execute on function public.calculate_permission_fee_batch_v1(jsonb, numeric, numeric, numeric) to authenticated, service_role;
