alter table public.managed_datasets
  drop constraint if exists managed_datasets_source_check;

alter table public.managed_datasets
  add constraint managed_datasets_source_check
  check (source in ('pea', 'ufm', 'road', 'building'));

create or replace function public.managed_reference_features(
  p_source text,
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_limit integer default 25000
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with bounds as (
    select ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326) as geom
  ),
  active_features as (
    select f.feature_key, f.name, f.properties, f.geometry
    from public.managed_datasets d
    join public.managed_dataset_features f on f.version_id = d.active_version_id
    cross join bounds b
    where d.source = p_source
      and d.active_version_id is not null
      and f.geom && b.geom
      and ST_Intersects(f.geom, b.geom)
    order by f.source_index
    limit greatest(1, least(p_limit, 25000))
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'source', p_source,
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id', feature_key,
      'properties', properties || jsonb_build_object('name', name, 'reference_type', p_source),
      'geometry', geometry
    )), '[]'::jsonb)
  )
  from active_features;
$$;

revoke all on function public.managed_reference_features(text, double precision, double precision, double precision, double precision, integer) from public;
grant execute on function public.managed_reference_features(text, double precision, double precision, double precision, double precision, integer) to service_role;

comment on function public.managed_reference_features is
  'Returns active privately managed Road centerline or Building polygon features intersecting a bounded MOD 1 viewport.';
