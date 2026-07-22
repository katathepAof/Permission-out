-- UIH spatial catalog for Permission Out.
-- KMZ remains the immutable exchange/source format in Storage; queryable geometry lives in PostGIS.

create extension if not exists postgis with schema extensions;

create table if not exists public.uih_datasets (
  id text primary key,
  name text not null,
  group_code text not null,
  version text not null default 'v1',
  source_path text not null,
  source_name text not null,
  source_sha256 text not null,
  source_bytes bigint not null default 0,
  compressed_bytes bigint not null default 0,
  feature_count integer not null default 0,
  crs text not null default 'EPSG:4326',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uih_features (
  id bigint generated always as identity primary key,
  dataset_id text not null references public.uih_datasets(id) on delete cascade,
  source_index integer not null,
  name text,
  geometry_type text not null,
  properties jsonb not null default '{}'::jsonb,
  geom extensions.geometry(Geometry, 4326) not null,
  created_at timestamptz not null default now(),
  unique (dataset_id, source_index)
);

create index if not exists uih_features_dataset_id_idx on public.uih_features(dataset_id, id);
create index if not exists uih_features_geom_gix on public.uih_features using gist(geom);
create index if not exists uih_datasets_active_group_idx on public.uih_datasets(is_active, group_code, name);

alter table public.uih_datasets enable row level security;
alter table public.uih_features enable row level security;

drop policy if exists "uih_datasets_public_read" on public.uih_datasets;
create policy "uih_datasets_public_read" on public.uih_datasets for select
using (is_active);

drop policy if exists "uih_features_public_read" on public.uih_features;
create policy "uih_features_public_read" on public.uih_features for select
using (exists (
  select 1 from public.uih_datasets d where d.id = dataset_id and d.is_active
));

revoke all on public.uih_datasets, public.uih_features from anon, authenticated;
grant select on public.uih_datasets, public.uih_features to anon, authenticated;

create or replace function public.import_uih_features(p_dataset_id text, p_features jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  affected integer;
begin
  if not exists (select 1 from public.uih_datasets where id = p_dataset_id) then
    raise exception 'Unknown UIH dataset: %', p_dataset_id;
  end if;

  insert into public.uih_features (dataset_id, source_index, name, geometry_type, properties, geom)
  select
    p_dataset_id,
    (feature ->> 'source_index')::integer,
    nullif(feature ->> 'name', ''),
    feature -> 'geometry' ->> 'type',
    coalesce(feature -> 'properties', '{}'::jsonb),
    st_force2d(st_setsrid(st_geomfromgeojson(feature -> 'geometry'), 4326))
  from jsonb_array_elements(p_features) feature
  where feature ? 'geometry' and feature -> 'geometry' is not null
  on conflict (dataset_id, source_index) do update set
    name = excluded.name,
    geometry_type = excluded.geometry_type,
    properties = excluded.properties,
    geom = excluded.geom;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.import_uih_features(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_uih_features(text, jsonb) to service_role;

create or replace function public.get_uih_feature_page(
  p_dataset_ids text[],
  p_after_id bigint default 0,
  p_limit integer default 1000,
  p_bbox double precision[] default null,
  p_tolerance double precision default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with selected as (
    select
      f.id,
      f.dataset_id,
      f.source_index,
      f.name,
      f.properties,
      case
        when greatest(p_tolerance, 0) > 0 then st_simplifypreservetopology(f.geom, p_tolerance)
        else f.geom
      end as display_geom
    from public.uih_features f
    join public.uih_datasets d on d.id = f.dataset_id and d.is_active
    where f.dataset_id = any(p_dataset_ids)
      and f.id > greatest(p_after_id, 0)
      and (
        p_bbox is null
        or array_length(p_bbox, 1) <> 4
        or f.geom && st_makeenvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326)
      )
    order by f.id
    limit least(greatest(p_limit, 1), 2000)
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id', id,
      'geometry', st_asgeojson(display_geom, 6)::jsonb,
      'properties', properties || jsonb_build_object(
        'dataset_id', dataset_id,
        'source_index', source_index,
        'name', name
      )
    ) order by id), '[]'::jsonb),
    'nextAfter', max(id),
    'count', count(*)
  )
  from selected;
$$;

grant execute on function public.get_uih_feature_page(text[], bigint, integer, double precision[], double precision) to anon, authenticated;

create or replace function public.refresh_uih_dataset_counts()
returns void
language sql
security definer
set search_path = public
as $$
  update public.uih_datasets d
  set feature_count = counts.feature_count,
      imported_at = now(),
      updated_at = now()
  from (
    select dataset_id, count(*)::integer as feature_count
    from public.uih_features
    group by dataset_id
  ) counts
  where counts.dataset_id = d.id;
$$;

revoke all on function public.refresh_uih_dataset_counts() from public, anon, authenticated;
grant execute on function public.refresh_uih_dataset_counts() to service_role;
