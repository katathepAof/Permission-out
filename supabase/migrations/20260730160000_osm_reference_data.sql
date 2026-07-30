create extension if not exists postgis;

create table if not exists public.osm_reference_imports (
  id bigint generated always as identity primary key,
  source_url text not null,
  source_timestamp timestamptz,
  imported_at timestamptz not null default now(),
  road_count bigint not null default 0,
  building_count bigint not null default 0,
  attribution text not null default '© OpenStreetMap contributors',
  license_url text not null default 'https://www.openstreetmap.org/copyright'
);

create table if not exists public.osm_roads (
  osm_type text not null,
  osm_id bigint not null,
  name text,
  highway text not null,
  surface text,
  geometry geometry(MultiLineString, 4326) not null,
  primary key (osm_type, osm_id)
);

create table if not exists public.osm_buildings (
  osm_type text not null,
  osm_id bigint not null,
  name text,
  building text not null,
  geometry geometry(MultiPolygon, 4326) not null,
  primary key (osm_type, osm_id)
);

create index if not exists osm_roads_geometry_gix on public.osm_roads using gist (geometry);
create index if not exists osm_buildings_geometry_gix on public.osm_buildings using gist (geometry);
create index if not exists osm_roads_highway_idx on public.osm_roads (highway);

alter table public.osm_reference_imports enable row level security;
alter table public.osm_roads enable row level security;
alter table public.osm_buildings enable row level security;
revoke all on public.osm_reference_imports, public.osm_roads, public.osm_buildings from anon, authenticated;

create or replace function public.osm_reference_features(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_include_roads boolean default true,
  p_include_buildings boolean default true,
  p_limit integer default 10000
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326) as geometry
  ),
  features as (
    select jsonb_build_object(
      'type', 'Feature',
      'id', 'road/' || road.osm_type || '/' || road.osm_id,
      'properties', jsonb_build_object(
        'reference_type', 'road',
        'name', road.name,
        'highway', road.highway,
        'surface', road.surface
      ),
      'geometry', ST_AsGeoJSON(ST_Intersection(road.geometry, bounds.geometry), 7)::jsonb
    ) as feature
    from public.osm_roads road cross join bounds
    where p_include_roads and road.geometry && bounds.geometry and ST_Intersects(road.geometry, bounds.geometry)
    union all
    select jsonb_build_object(
      'type', 'Feature',
      'id', 'building/' || building.osm_type || '/' || building.osm_id,
      'properties', jsonb_build_object(
        'reference_type', 'building',
        'name', building.name,
        'building', building.building
      ),
      'geometry', ST_AsGeoJSON(ST_Intersection(building.geometry, bounds.geometry), 7)::jsonb
    )
    from public.osm_buildings building cross join bounds
    where p_include_buildings and building.geometry && bounds.geometry and ST_Intersects(building.geometry, bounds.geometry)
    limit greatest(1, least(p_limit, 25000))
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(feature), '[]'::jsonb),
    'attribution', '© OpenStreetMap contributors',
    'license', 'https://www.openstreetmap.org/copyright'
  )
  from features;
$$;

revoke all on function public.osm_reference_features(double precision, double precision, double precision, double precision, boolean, boolean, integer) from public;
grant execute on function public.osm_reference_features(double precision, double precision, double precision, double precision, boolean, boolean, integer) to service_role;

