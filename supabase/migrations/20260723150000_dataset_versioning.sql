create extension if not exists pgcrypto;
create extension if not exists postgis;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'permission-out-admin-data',
  'permission-out-admin-data',
  false,
  104857600,
  array[
    'application/vnd.google-earth.kml+xml',
    'application/vnd.google-earth.kmz',
    'application/zip',
    'application/octet-stream',
    'text/xml',
    'application/xml'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.managed_datasets (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('pea', 'ufm')),
  canonical_name text not null,
  display_name text not null,
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, canonical_name)
);

create table if not exists public.managed_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.managed_datasets(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'staging'
    check (status in ('staging', 'ready', 'active', 'archived', 'failed')),
  raw_path text not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  raw_size bigint not null check (raw_size between 1 and 104857600),
  feature_count integer not null default 0,
  new_count integer not null default 0,
  updated_count integer not null default 0,
  removed_count integer not null default 0,
  unchanged_count integer not null default 0,
  error_message text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  published_at timestamptz,
  unique (dataset_id, version_no)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'managed_datasets_active_version_id_fkey'
  ) then
    alter table public.managed_datasets
      add constraint managed_datasets_active_version_id_fkey
      foreign key (active_version_id)
      references public.managed_dataset_versions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.managed_dataset_features (
  version_id uuid not null references public.managed_dataset_versions(id) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-f0-9]{64}$'),
  logical_id text not null,
  source_index integer not null check (source_index >= 0),
  name text not null,
  properties jsonb not null default '{}'::jsonb,
  geometry jsonb not null,
  geom geometry(Geometry, 4326) not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  primary key (version_id, feature_key)
);

create index if not exists managed_dataset_versions_dataset_idx
  on public.managed_dataset_versions(dataset_id, version_no desc);
create index if not exists managed_dataset_versions_status_idx
  on public.managed_dataset_versions(status, created_at desc);
create index if not exists managed_dataset_features_version_order_idx
  on public.managed_dataset_features(version_id, source_index);
create index if not exists managed_dataset_features_geom_gix
  on public.managed_dataset_features using gist(geom);

create table if not exists public.managed_dataset_audit (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.managed_datasets(id) on delete cascade,
  version_id uuid not null references public.managed_dataset_versions(id) on delete cascade,
  action text not null check (action in ('upload', 'validate', 'publish', 'rollback', 'fail')),
  actor_id uuid not null references auth.users(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.managed_datasets enable row level security;
alter table public.managed_dataset_versions enable row level security;
alter table public.managed_dataset_features enable row level security;
alter table public.managed_dataset_audit enable row level security;

revoke all on public.managed_datasets from anon, authenticated;
revoke all on public.managed_dataset_versions from anon, authenticated;
revoke all on public.managed_dataset_features from anon, authenticated;
revoke all on public.managed_dataset_audit from anon, authenticated;

create or replace function public.import_managed_dataset_features(
  p_version_id uuid,
  p_features jsonb
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
    select 1 from public.managed_dataset_versions
    where id = p_version_id and status = 'staging'
  ) then
    raise exception 'dataset version is not in staging';
  end if;

  if jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) > 100 then
    raise exception 'feature batch must contain 1-100 items';
  end if;

  insert into public.managed_dataset_features (
    version_id,
    feature_key,
    logical_id,
    source_index,
    name,
    properties,
    geometry,
    geom,
    content_hash
  )
  select
    p_version_id,
    encode(digest(convert_to(feature ->> 'logical_id', 'UTF8'), 'sha256'), 'hex'),
    feature ->> 'logical_id',
    (feature ->> 'source_index')::integer,
    left(coalesce(nullif(feature ->> 'name', ''), 'ไม่ระบุชื่อ'), 500),
    coalesce(feature -> 'properties', '{}'::jsonb),
    feature -> 'geometry',
    st_force2d(st_setsrid(st_geomfromgeojson(feature -> 'geometry'), 4326)),
    encode(digest(
      convert_to(
        coalesce(feature -> 'properties', '{}'::jsonb)::text ||
        coalesce(feature -> 'geometry', '{}'::jsonb)::text,
        'UTF8'
      ),
      'sha256'
    ), 'hex')
  from jsonb_array_elements(p_features) feature
  where nullif(feature ->> 'logical_id', '') is not null
    and (feature ->> 'source_index') ~ '^[0-9]+$'
    and feature ? 'geometry'
    and feature -> 'geometry' is not null
  on conflict (version_id, feature_key) do update
  set source_index = excluded.source_index,
      name = excluded.name,
      properties = excluded.properties,
      geometry = excluded.geometry,
      geom = excluded.geom,
      content_hash = excluded.content_hash;

  get diagnostics imported_count = row_count;
  return imported_count;
end;
$$;

create or replace function public.finalize_managed_dataset_version(
  p_version_id uuid,
  p_actor_id uuid
)
returns public.managed_dataset_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.managed_dataset_versions;
  previous_version_id uuid;
begin
  select * into target
  from public.managed_dataset_versions
  where id = p_version_id and status = 'staging'
  for update;
  if not found then raise exception 'dataset version is not in staging'; end if;

  select active_version_id into previous_version_id
  from public.managed_datasets
  where id = target.dataset_id;

  update public.managed_dataset_versions v
  set feature_count = (select count(*) from public.managed_dataset_features n where n.version_id = p_version_id),
      new_count = (
        select count(*) from public.managed_dataset_features n
        where n.version_id = p_version_id
          and not exists (
            select 1 from public.managed_dataset_features o
            where o.version_id = previous_version_id and o.feature_key = n.feature_key
          )
      ),
      updated_count = (
        select count(*) from public.managed_dataset_features n
        join public.managed_dataset_features o on o.feature_key = n.feature_key
        where n.version_id = p_version_id
          and o.version_id = previous_version_id
          and o.content_hash <> n.content_hash
      ),
      removed_count = (
        select count(*) from public.managed_dataset_features o
        where o.version_id = previous_version_id
          and not exists (
            select 1 from public.managed_dataset_features n
            where n.version_id = p_version_id and n.feature_key = o.feature_key
          )
      ),
      unchanged_count = (
        select count(*) from public.managed_dataset_features n
        join public.managed_dataset_features o on o.feature_key = n.feature_key
        where n.version_id = p_version_id
          and o.version_id = previous_version_id
          and o.content_hash = n.content_hash
      ),
      status = 'ready',
      validated_at = now(),
      error_message = null
  where v.id = p_version_id
  returning * into target;

  insert into public.managed_dataset_audit(dataset_id, version_id, action, actor_id, detail)
  values (
    target.dataset_id,
    target.id,
    'validate',
    p_actor_id,
    jsonb_build_object(
      'feature_count', target.feature_count,
      'new_count', target.new_count,
      'updated_count', target.updated_count,
      'removed_count', target.removed_count,
      'unchanged_count', target.unchanged_count
    )
  );
  return target;
end;
$$;

create or replace function public.publish_managed_dataset_version(
  p_version_id uuid,
  p_actor_id uuid
)
returns public.managed_dataset_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.managed_dataset_versions;
  previous_version_id uuid;
  audit_action text;
begin
  select * into target
  from public.managed_dataset_versions
  where id = p_version_id and status in ('ready', 'archived')
  for update;
  if not found then raise exception 'dataset version is not ready for publish'; end if;

  select active_version_id into previous_version_id
  from public.managed_datasets
  where id = target.dataset_id
  for update;

  audit_action := case when target.status = 'archived' then 'rollback' else 'publish' end;

  update public.managed_dataset_versions
  set status = 'archived'
  where dataset_id = target.dataset_id and status = 'active';

  update public.managed_dataset_versions
  set status = 'active', published_at = now()
  where id = p_version_id
  returning * into target;

  update public.managed_datasets
  set active_version_id = p_version_id, updated_at = now()
  where id = target.dataset_id;

  insert into public.managed_dataset_audit(dataset_id, version_id, action, actor_id, detail)
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

revoke all on function public.import_managed_dataset_features(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_managed_dataset_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_managed_dataset_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_managed_dataset_features(uuid, jsonb) to service_role;
grant execute on function public.finalize_managed_dataset_version(uuid, uuid) to service_role;
grant execute on function public.publish_managed_dataset_version(uuid, uuid) to service_role;

comment on table public.managed_datasets is
  'Stable PEA/UFM file identities. A repeated canonical filename creates a new immutable version.';
comment on table public.managed_dataset_versions is
  'Staging, validated, active and archived snapshots used for atomic publish and rollback.';
comment on table public.managed_dataset_features is
  'Normalized versioned KML/KMZ features. feature_key identifies a logical feature; content_hash detects updates.';
