begin;

alter table public.mod2_sites
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column geom drop not null;

alter table public.mod2_sites
  add column if not exists contract_expired date,
  add column if not exists sdh_topology text,
  add column if not exists lsw_topology text,
  add column if not exists dslam_topology text,
  add column if not exists site_type text,
  add column if not exists raw_data jsonb not null default '{}'::jsonb;

create or replace function public.import_mod2_total_sites(
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
    select 1 from public.mod2_site_versions
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
      (site ->> 'source_index')::integer source_index,
      left(trim(site ->> 'site_code'), 100) site_code,
      nullif(left(trim(coalesce(site ->> 'site_name', '')), 500), '') site_name,
      nullif(left(trim(coalesce(site ->> 'type_of_digit', '')), 100), '') type_of_digit,
      nullif(left(trim(coalesce(site ->> 'site_grade', '')), 150), '') site_grade,
      nullif(left(trim(coalesce(site ->> 'regional', '')), 100), '') regional,
      nullif(left(trim(coalesce(site ->> 'uih_area', '')), 100), '') uih_area,
      nullif(left(trim(coalesce(site ->> 'district', '')), 200), '') district,
      nullif(left(trim(coalesce(site ->> 'province', '')), 200), '') province,
      case when (site ->> 'latitude') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (site ->> 'latitude')::double precision end latitude,
      case when (site ->> 'longitude') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (site ->> 'longitude')::double precision end longitude,
      greatest(coalesce((site ->> 'customers')::integer, 0), 0) customers,
      nullif(left(trim(coalesce(site ->> 'node_equipment', '')), 500), '') node_equipment,
      nullif(left(trim(coalesce(site ->> 'owner', '')), 200), '') owner,
      greatest(coalesce((site ->> 'opex')::numeric(14,2), 0), 0) opex,
      nullif(site ->> 'contract_expired', '')::date contract_expired,
      nullif(left(trim(coalesce(site ->> 'sdh_topology', '')), 100), '') sdh_topology,
      nullif(left(trim(coalesce(site ->> 'lsw_topology', '')), 100), '') lsw_topology,
      nullif(left(trim(coalesce(site ->> 'dslam_topology', '')), 100), '') dslam_topology,
      nullif(left(trim(coalesce(site ->> 'site_type', '')), 150), '') site_type,
      coalesce(site -> 'raw_data', '{}'::jsonb) raw_data
    from jsonb_array_elements(p_sites) site
    where nullif(trim(site ->> 'site_code'), '') is not null
      and (site ->> 'source_index') ~ '^[0-9]+$'
  ), prepared as (
    select incoming.*,
      case when latitude between -90 and 90 and longitude between -180 and 180
        then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)
        else null end geom,
      encode(digest(convert_to(jsonb_strip_nulls(jsonb_build_object(
        'site_code', site_code, 'site_name', site_name, 'type_of_digit', type_of_digit,
        'site_grade', site_grade, 'regional', regional, 'uih_area', uih_area,
        'district', district, 'province', province,
        'latitude', case when latitude between -90 and 90 then latitude end,
        'longitude', case when longitude between -180 and 180 then longitude end,
        'customers', customers, 'node_equipment', node_equipment, 'owner', owner,
        'opex', opex, 'contract_expired', contract_expired,
        'sdh_topology', sdh_topology, 'lsw_topology', lsw_topology,
        'dslam_topology', dslam_topology, 'site_type', site_type,
        'raw_data', raw_data
      ))::text, 'UTF8'), 'sha256'), 'hex') content_hash
    from incoming
  )
  insert into public.mod2_sites (
    version_id, source_index, site_code, site_name, type_of_digit, site_grade,
    regional, uih_area, district, province, latitude, longitude, geom,
    customers, node_equipment, owner, opex, contract_expired, sdh_topology,
    lsw_topology, dslam_topology, site_type, raw_data, content_hash
  )
  select p_version_id, source_index, site_code, site_name, type_of_digit, site_grade,
    regional, uih_area, district, province,
    case when geom is null then null else latitude end,
    case when geom is null then null else longitude end,
    geom, customers, node_equipment, owner, opex, contract_expired, sdh_topology,
    lsw_topology, dslam_topology, site_type, raw_data, content_hash
  from prepared
  on conflict (version_id, site_code) do update set
    source_index=excluded.source_index, site_name=excluded.site_name,
    type_of_digit=excluded.type_of_digit, site_grade=excluded.site_grade,
    regional=excluded.regional, uih_area=excluded.uih_area,
    district=excluded.district, province=excluded.province,
    latitude=excluded.latitude, longitude=excluded.longitude, geom=excluded.geom,
    customers=excluded.customers, node_equipment=excluded.node_equipment,
    owner=excluded.owner, opex=excluded.opex,
    contract_expired=excluded.contract_expired, sdh_topology=excluded.sdh_topology,
    lsw_topology=excluded.lsw_topology, dslam_topology=excluded.dslam_topology,
    site_type=excluded.site_type, raw_data=excluded.raw_data,
    content_hash=excluded.content_hash;
  get diagnostics imported_count = row_count;
  return imported_count;
end;
$$;

revoke all on function public.import_mod2_total_sites(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_mod2_total_sites(uuid, jsonb) to service_role;

comment on column public.mod2_sites.raw_data is
  'All columns from the Total Site worksheet, keyed by the original Excel headers.';

create or replace function public.get_mod2_site_page(
  p_after_id bigint default 0, p_limit integer default 500,
  p_bbox double precision[] default null, p_query text default null,
  p_regionals text[] default null, p_uih_areas text[] default null,
  p_provinces text[] default null, p_site_grades text[] default null,
  p_types_of_digit text[] default null, p_owners text[] default null
)
returns jsonb language sql stable security invoker
set search_path = public, extensions as $$
  with selected as (
    select site.* from public.mod2_sites site
    join public.mod2_site_datasets dataset on dataset.active_version_id = site.version_id
    where site.id > greatest(p_after_id, 0)
      and (p_bbox is null or array_length(p_bbox, 1) <> 4 or
        (site.geom is not null and site.geom && extensions.st_makeenvelope(
          p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326)))
      and (nullif(trim(p_query), '') is null or concat_ws(' ', site.site_code,
        site.site_name, site.province, site.district, site.uih_area, site.regional,
        site.node_equipment, site.owner, site.site_grade) ilike '%' || trim(p_query) || '%')
      and (p_regionals is null or site.regional = any(p_regionals))
      and (p_uih_areas is null or site.uih_area = any(p_uih_areas))
      and (p_provinces is null or site.province = any(p_provinces))
      and (p_site_grades is null or site.site_grade = any(p_site_grades))
      and (p_types_of_digit is null or site.type_of_digit = any(p_types_of_digit))
      and (p_owners is null or site.owner = any(p_owners))
    order by site.id limit least(greatest(p_limit, 1), 1000)
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature', 'id', id,
      'geometry', case when geom is null then null else extensions.st_asgeojson(geom, 7)::jsonb end,
      'properties', jsonb_strip_nulls(jsonb_build_object(
        'site_code', site_code, 'site_name', site_name, 'type_of_digit', type_of_digit,
        'site_grade', site_grade, 'regional', regional, 'uih_area', uih_area,
        'district', district, 'province', province, 'latitude', latitude,
        'longitude', longitude, 'customers', customers, 'node_equipment', node_equipment,
        'owner', owner, 'opex', opex, 'contract_expired', contract_expired,
        'sdh_topology', sdh_topology, 'lsw_topology', lsw_topology,
        'dslam_topology', dslam_topology, 'site_type', site_type,
        'extra_properties', raw_data, 'remark', remark
      ))) order by id), '[]'::jsonb),
    'nextAfter', max(id), 'count', count(*)
  ) from selected;
$$;

commit;
