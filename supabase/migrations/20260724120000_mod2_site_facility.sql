-- MOD 2: Site Facility & Design Report.
-- Raw source files remain private in Storage. Queryable site records live in
-- versioned relational tables with a PostGIS point for viewport queries.

create extension if not exists pgcrypto;
create extension if not exists postgis with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'permission-out-mod2-data',
  'permission-out-mod2-data',
  false,
  52428800,
  array[
    'application/json',
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.mod2_site_datasets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mod2_site_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.mod2_site_datasets(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'staging'
    check (status in ('staging', 'ready', 'active', 'archived', 'failed')),
  raw_path text not null check (char_length(raw_path) between 1 and 1000),
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  raw_size bigint not null check (raw_size between 1 and 52428800),
  row_count integer not null default 0 check (row_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  removed_count integer not null default 0 check (removed_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  error_message text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  published_at timestamptz,
  unique (dataset_id, version_no),
  unique (dataset_id, raw_sha256)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mod2_site_datasets_active_version_id_fkey'
  ) then
    alter table public.mod2_site_datasets
      add constraint mod2_site_datasets_active_version_id_fkey
      foreign key (active_version_id)
      references public.mod2_site_versions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.mod2_sites (
  id bigint generated always as identity primary key,
  version_id uuid not null references public.mod2_site_versions(id) on delete cascade,
  source_index integer not null check (source_index >= 0),
  site_code text not null check (char_length(site_code) between 1 and 100),
  site_name text,
  type_of_digit text,
  site_grade text,
  regional text,
  uih_area text,
  district text,
  province text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geom extensions.geometry(Point, 4326) not null,
  customers integer not null default 0 check (customers >= 0),
  node_equipment text,
  owner text,
  opex numeric(14,2) not null default 0 check (opex >= 0),
  remark text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (version_id, site_code)
);

create table if not exists public.mod2_site_audit (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.mod2_site_datasets(id) on delete cascade,
  version_id uuid references public.mod2_site_versions(id) on delete set null,
  site_code text,
  action text not null
    check (action in ('upload', 'validate', 'publish', 'rollback', 'fail', 'create', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists mod2_site_versions_dataset_idx
  on public.mod2_site_versions(dataset_id, version_no desc);
create unique index if not exists mod2_site_versions_one_active_idx
  on public.mod2_site_versions(dataset_id) where status = 'active';
create index if not exists mod2_sites_version_order_idx
  on public.mod2_sites(version_id, id);
create index if not exists mod2_sites_version_code_idx
  on public.mod2_sites(version_id, site_code);
create index if not exists mod2_sites_filter_idx
  on public.mod2_sites(version_id, regional, uih_area, province);
create index if not exists mod2_sites_grade_owner_idx
  on public.mod2_sites(version_id, site_grade, owner);
create index if not exists mod2_sites_geom_gix
  on public.mod2_sites using gist(geom);
create index if not exists mod2_site_audit_dataset_created_idx
  on public.mod2_site_audit(dataset_id, created_at desc);

alter table public.mod2_site_datasets enable row level security;
alter table public.mod2_site_versions enable row level security;
alter table public.mod2_sites enable row level security;
alter table public.mod2_site_audit enable row level security;

drop policy if exists "mod2_datasets_authenticated_read" on public.mod2_site_datasets;
create policy "mod2_datasets_authenticated_read"
on public.mod2_site_datasets for select to authenticated
using (active_version_id is not null);

drop policy if exists "mod2_versions_authenticated_read" on public.mod2_site_versions;
create policy "mod2_versions_authenticated_read"
on public.mod2_site_versions for select to authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.mod2_site_datasets dataset
    where dataset.id = dataset_id
      and dataset.active_version_id = mod2_site_versions.id
  )
);

drop policy if exists "mod2_sites_authenticated_read" on public.mod2_sites;
create policy "mod2_sites_authenticated_read"
on public.mod2_sites for select to authenticated
using (
  exists (
    select 1
    from public.mod2_site_datasets dataset
    where dataset.active_version_id = version_id
  )
);

revoke all on public.mod2_site_datasets from anon, authenticated;
revoke all on public.mod2_site_versions from anon, authenticated;
revoke all on public.mod2_sites from anon, authenticated;
revoke all on public.mod2_site_audit from anon, authenticated;
grant select on public.mod2_site_datasets to authenticated;
grant select on public.mod2_site_versions to authenticated;
grant select on public.mod2_sites to authenticated;

create or replace function public.import_mod2_sites(
  p_version_id uuid,
  p_sites jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  imported_count integer;
begin
  if not exists (
    select 1
    from public.mod2_site_versions
    where id = p_version_id and status = 'staging'
  ) then
    raise exception 'MOD 2 version is not in staging';
  end if;

  if jsonb_typeof(p_sites) <> 'array'
    or jsonb_array_length(p_sites) < 1
    or jsonb_array_length(p_sites) > 500 then
    raise exception 'site batch must contain 1-500 items';
  end if;

  with incoming as (
    select
      (site ->> 'source_index')::integer as source_index,
      left(trim(site ->> 'site_code'), 100) as site_code,
      nullif(left(trim(coalesce(site ->> 'site_name', '')), 500), '') as site_name,
      nullif(left(trim(coalesce(site ->> 'type_of_digit', '')), 100), '') as type_of_digit,
      nullif(left(trim(coalesce(site ->> 'site_grade', '')), 150), '') as site_grade,
      nullif(left(trim(coalesce(site ->> 'regional', '')), 100), '') as regional,
      nullif(left(trim(coalesce(site ->> 'uih_area', '')), 100), '') as uih_area,
      nullif(left(trim(coalesce(site ->> 'district', '')), 200), '') as district,
      nullif(left(trim(coalesce(site ->> 'province', '')), 200), '') as province,
      (site ->> 'latitude')::double precision as latitude,
      (site ->> 'longitude')::double precision as longitude,
      greatest(coalesce((site ->> 'customers')::integer, 0), 0) as customers,
      nullif(left(trim(coalesce(site ->> 'node_equipment', '')), 500), '') as node_equipment,
      nullif(left(trim(coalesce(site ->> 'owner', '')), 200), '') as owner,
      greatest(coalesce((site ->> 'opex')::numeric(14,2), 0), 0) as opex,
      nullif(left(trim(coalesce(site ->> 'remark', '')), 5000), '') as remark
    from jsonb_array_elements(p_sites) site
    where nullif(trim(site ->> 'site_code'), '') is not null
      and (site ->> 'source_index') ~ '^[0-9]+$'
      and (site ->> 'latitude') ~ '^-?[0-9]+([.][0-9]+)?$'
      and (site ->> 'longitude') ~ '^-?[0-9]+([.][0-9]+)?$'
  ),
  prepared as (
    select
      incoming.*,
      extensions.st_setsrid(
        extensions.st_makepoint(longitude, latitude),
        4326
      ) as geom,
      encode(
        digest(
          convert_to(
            jsonb_strip_nulls(jsonb_build_object(
              'site_code', site_code,
              'site_name', site_name,
              'type_of_digit', type_of_digit,
              'site_grade', site_grade,
              'regional', regional,
              'uih_area', uih_area,
              'district', district,
              'province', province,
              'latitude', latitude,
              'longitude', longitude,
              'customers', customers,
              'node_equipment', node_equipment,
              'owner', owner,
              'opex', opex,
              'remark', remark
            ))::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) as content_hash
    from incoming
    where latitude between -90 and 90
      and longitude between -180 and 180
  )
  insert into public.mod2_sites (
    version_id,
    source_index,
    site_code,
    site_name,
    type_of_digit,
    site_grade,
    regional,
    uih_area,
    district,
    province,
    latitude,
    longitude,
    geom,
    customers,
    node_equipment,
    owner,
    opex,
    remark,
    content_hash
  )
  select
    p_version_id,
    source_index,
    site_code,
    site_name,
    type_of_digit,
    site_grade,
    regional,
    uih_area,
    district,
    province,
    latitude,
    longitude,
    geom,
    customers,
    node_equipment,
    owner,
    opex,
    remark,
    content_hash
  from prepared
  on conflict (version_id, site_code) do update
  set source_index = excluded.source_index,
      site_name = excluded.site_name,
      type_of_digit = excluded.type_of_digit,
      site_grade = excluded.site_grade,
      regional = excluded.regional,
      uih_area = excluded.uih_area,
      district = excluded.district,
      province = excluded.province,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      geom = excluded.geom,
      customers = excluded.customers,
      node_equipment = excluded.node_equipment,
      owner = excluded.owner,
      opex = excluded.opex,
      remark = excluded.remark,
      content_hash = excluded.content_hash;

  get diagnostics imported_count = row_count;
  return imported_count;
end;
$$;

create or replace function public.finalize_mod2_site_version(
  p_version_id uuid,
  p_actor_id uuid
)
returns public.mod2_site_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.mod2_site_versions;
  previous_version_id uuid;
begin
  select * into target
  from public.mod2_site_versions
  where id = p_version_id and status = 'staging'
  for update;

  if not found then
    raise exception 'MOD 2 version is not in staging';
  end if;
  if target.uploaded_by <> p_actor_id then
    raise exception 'actor does not own this import';
  end if;

  select active_version_id into previous_version_id
  from public.mod2_site_datasets
  where id = target.dataset_id;

  update public.mod2_site_versions version
  set row_count = (
        select count(*)::integer from public.mod2_sites site
        where site.version_id = p_version_id
      ),
      new_count = (
        select count(*)::integer
        from public.mod2_sites site
        where site.version_id = p_version_id
          and not exists (
            select 1 from public.mod2_sites old
            where old.version_id = previous_version_id
              and old.site_code = site.site_code
          )
      ),
      updated_count = (
        select count(*)::integer
        from public.mod2_sites site
        join public.mod2_sites old
          on old.version_id = previous_version_id
         and old.site_code = site.site_code
        where site.version_id = p_version_id
          and site.content_hash <> old.content_hash
      ),
      removed_count = (
        select count(*)::integer
        from public.mod2_sites old
        where old.version_id = previous_version_id
          and not exists (
            select 1 from public.mod2_sites site
            where site.version_id = p_version_id
              and site.site_code = old.site_code
          )
      ),
      unchanged_count = (
        select count(*)::integer
        from public.mod2_sites site
        join public.mod2_sites old
          on old.version_id = previous_version_id
         and old.site_code = site.site_code
        where site.version_id = p_version_id
          and site.content_hash = old.content_hash
      ),
      status = 'ready',
      validated_at = now(),
      error_message = null
  where version.id = p_version_id
  returning * into target;

  if target.row_count = 0 then
    raise exception 'MOD 2 version contains no valid sites';
  end if;

  insert into public.mod2_site_audit (
    dataset_id, version_id, action, actor_id, detail
  )
  values (
    target.dataset_id,
    target.id,
    'validate',
    p_actor_id,
    jsonb_build_object(
      'row_count', target.row_count,
      'new_count', target.new_count,
      'updated_count', target.updated_count,
      'removed_count', target.removed_count,
      'unchanged_count', target.unchanged_count
    )
  );

  return target;
end;
$$;

create or replace function public.publish_mod2_site_version(
  p_version_id uuid,
  p_actor_id uuid
)
returns public.mod2_site_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.mod2_site_versions;
  previous_version_id uuid;
  audit_action text;
begin
  select * into target
  from public.mod2_site_versions
  where id = p_version_id and status in ('ready', 'archived')
  for update;

  if not found then
    raise exception 'MOD 2 version is not ready to publish';
  end if;

  select active_version_id into previous_version_id
  from public.mod2_site_datasets
  where id = target.dataset_id
  for update;

  audit_action := case when target.status = 'archived' then 'rollback' else 'publish' end;

  update public.mod2_site_versions
  set status = 'archived'
  where dataset_id = target.dataset_id and status = 'active';

  update public.mod2_site_versions
  set status = 'active',
      published_at = now()
  where id = p_version_id
  returning * into target;

  update public.mod2_site_datasets
  set active_version_id = p_version_id,
      updated_at = now()
  where id = target.dataset_id;

  insert into public.mod2_site_audit (
    dataset_id, version_id, action, actor_id, detail
  )
  values (
    target.dataset_id,
    target.id,
    audit_action,
    p_actor_id,
    jsonb_build_object('previous_version_id', previous_version_id)
  );

  return target;
end;
$$;

create or replace function public.get_mod2_site_page(
  p_after_id bigint default 0,
  p_limit integer default 500,
  p_bbox double precision[] default null,
  p_query text default null,
  p_regionals text[] default null,
  p_uih_areas text[] default null,
  p_provinces text[] default null,
  p_site_grades text[] default null,
  p_types_of_digit text[] default null,
  p_owners text[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with selected as (
    select site.*
    from public.mod2_sites site
    join public.mod2_site_datasets dataset
      on dataset.active_version_id = site.version_id
    where site.id > greatest(p_after_id, 0)
      and (
        p_bbox is null
        or array_length(p_bbox, 1) <> 4
        or site.geom && extensions.st_makeenvelope(
          p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326
        )
      )
      and (
        nullif(trim(p_query), '') is null
        or concat_ws(
          ' ',
          site.site_code,
          site.site_name,
          site.province,
          site.district,
          site.uih_area,
          site.regional,
          site.node_equipment,
          site.owner,
          site.site_grade
        ) ilike '%' || trim(p_query) || '%'
      )
      and (p_regionals is null or site.regional = any(p_regionals))
      and (p_uih_areas is null or site.uih_area = any(p_uih_areas))
      and (p_provinces is null or site.province = any(p_provinces))
      and (p_site_grades is null or site.site_grade = any(p_site_grades))
      and (p_types_of_digit is null or site.type_of_digit = any(p_types_of_digit))
      and (p_owners is null or site.owner = any(p_owners))
    order by site.id
    limit least(greatest(p_limit, 1), 1000)
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'id', id,
          'geometry', extensions.st_asgeojson(geom, 7)::jsonb,
          'properties', jsonb_strip_nulls(jsonb_build_object(
            'site_code', site_code,
            'site_name', site_name,
            'type_of_digit', type_of_digit,
            'site_grade', site_grade,
            'regional', regional,
            'uih_area', uih_area,
            'district', district,
            'province', province,
            'latitude', latitude,
            'longitude', longitude,
            'customers', customers,
            'node_equipment', node_equipment,
            'owner', owner,
            'opex', opex,
            'remark', remark
          ))
        )
        order by id
      ),
      '[]'::jsonb
    ),
    'nextAfter', max(id),
    'count', count(*)
  )
  from selected;
$$;

revoke all on function public.import_mod2_sites(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_mod2_site_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_mod2_site_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_mod2_sites(uuid, jsonb) to service_role;
grant execute on function public.finalize_mod2_site_version(uuid, uuid) to service_role;
grant execute on function public.publish_mod2_site_version(uuid, uuid) to service_role;
grant execute on function public.get_mod2_site_page(
  bigint,
  integer,
  double precision[],
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text[]
) to authenticated;

comment on table public.mod2_site_datasets is
  'Stable MOD 2 site catalog identities. active_version_id selects the published version.';
comment on table public.mod2_site_versions is
  'Immutable imports of the Site Facility dataset with validation and publish status.';
comment on table public.mod2_sites is
  'Normalized Site Facility records. One site per row and one PostGIS Point per coordinate.';
comment on table public.mod2_site_audit is
  'Append-only audit history for MOD 2 import, publish, rollback, and future CRUD actions.';
