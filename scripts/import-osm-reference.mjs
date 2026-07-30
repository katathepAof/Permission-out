import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL || '';
const sourcePath = resolve(process.env.OSM_GPKG || process.argv[2] || '');
const sourceUrl = process.env.OSM_SOURCE_URL || 'https://download.geofabrik.de/asia/thailand-latest-free.gpkg.zip';
const sourceTimestamp = process.env.OSM_SOURCE_TIMESTAMP || '';

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!sourcePath || sourcePath === resolve('')) throw new Error('Pass the extracted Thailand .gpkg path or set OSM_GPKG');
await access(sourcePath);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

await run('ogr2ogr', [
  '-f', 'PostgreSQL', `PG:${databaseUrl}`, sourcePath, 'gis_osm_roads_free_1',
  '-nln', 'public.osm_roads_stage', '-overwrite', '-nlt', 'PROMOTE_TO_MULTI',
  '-lco', 'GEOMETRY_NAME=geometry', '-t_srs', 'EPSG:4326'
]);
await run('ogr2ogr', [
  '-f', 'PostgreSQL', `PG:${databaseUrl}`, sourcePath, 'gis_osm_buildings_a_free_1',
  '-nln', 'public.osm_buildings_stage', '-overwrite', '-nlt', 'PROMOTE_TO_MULTI',
  '-lco', 'GEOMETRY_NAME=geometry', '-t_srs', 'EPSG:4326'
]);

const timestampSql = sourceTimestamp ? `'${sourceTimestamp.replaceAll("'", "''")}'::timestamptz` : 'null';
const importSql = `
begin;
truncate public.osm_roads, public.osm_buildings;
insert into public.osm_roads (osm_type, osm_id, name, highway, surface, geometry)
select 'way', osm_id::bigint, nullif(name, ''), coalesce(nullif(fclass, ''), 'road'), null, ST_Multi(ST_Force2D(geometry))
from public.osm_roads_stage
where geometry is not null;
insert into public.osm_buildings (osm_type, osm_id, name, building, geometry)
select 'way', osm_id::bigint, nullif(name, ''), coalesce(nullif(type, ''), 'yes'), ST_Multi(ST_Force2D(geometry))
from public.osm_buildings_stage
where geometry is not null;
insert into public.osm_reference_imports (source_url, source_timestamp, road_count, building_count)
select '${sourceUrl.replaceAll("'", "''")}', ${timestampSql},
  (select count(*) from public.osm_roads),
  (select count(*) from public.osm_buildings);
drop table public.osm_roads_stage;
drop table public.osm_buildings_stage;
commit;`;
await run('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', importSql]);
console.log('Imported OpenStreetMap road centerlines and building polygons.');

