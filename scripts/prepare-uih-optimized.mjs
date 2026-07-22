import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';

const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'data-out', 'uih-20072026', 'v1');
const analysisRoot = resolve(outputRoot, 'analysis');
const exchangeRoot = resolve(outputRoot, 'exchange');
const manifestPath = resolve(outputRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

await mkdir(analysisRoot, { recursive: true });
await mkdir(exchangeRoot, { recursive: true });

function collectFeatures(rootFeature) {
  const result = [];
  function walk(node) {
    if (node?.type === 'Feature' && node.geometry) result.push(node);
    for (const child of node?.children || []) walk(child);
  }
  walk(rootFeature);
  return result;
}

function cleanProperties(properties) {
  const result = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value;
  }
  return result;
}

function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(lineParts);
  return [];
}

for (const item of manifest.items) {
  const analysisFile = `${item.id}.json.gz`;
  const exchangeFile = `${item.id}.geojson.gz`;
  const analysisPath = resolve(analysisRoot, analysisFile);
  const exchangePath = resolve(exchangeRoot, exchangeFile);
  try {
    const [analysisStats, exchangeStats] = await Promise.all([stat(analysisPath), stat(exchangePath)]);
    const cached = JSON.parse(gunzipSync(await readFile(analysisPath)).toString('utf8'));
    item.analysisPath = `analysis/${analysisFile}`;
    item.analysisBytes = analysisStats.size;
    item.exchangePath = `exchange/${exchangeFile}`;
    item.exchangeBytes = exchangeStats.size;
    item.lineCount = cached.lines.length;
    console.log(`${item.name}: reused ${item.lineCount} optimized lines`);
    continue;
  } catch { /* generate missing output */ }

  const sourcePath = resolve(root, 'uih-20072026', ...item.sourceRelative.split('/'));
  const xml = new DOMParser().parseFromString(await readFile(sourcePath, 'utf8'), 'text/xml');
  const features = collectFeatures(kmlWithFolders(xml, { skipNullGeometry: true })).map((feature, index) => ({
    type: 'Feature',
    id: `${item.id}-${index + 1}`,
    properties: cleanProperties(feature.properties),
    geometry: feature.geometry
  }));

  const lines = [];
  for (const feature of features) {
    const properties = feature.properties || {};
    const name = String(properties.name || 'ไม่ระบุชื่อ');
    for (const coordinates of lineParts(feature.geometry)) {
      const compact = coordinates
        .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(point => [point[0], point[1]]);
      if (compact.length >= 2) lines.push({ c: compact, n: name, p: properties });
    }
  }

  const analysisBody = JSON.stringify({ version: 1, datasetId: item.id, name: item.name, lines });
  const exchangeBody = JSON.stringify({ type: 'FeatureCollection', name: item.name, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features });
  const analysisGzip = gzipSync(analysisBody, { level: 9 });
  const exchangeGzip = gzipSync(exchangeBody, { level: 9 });
  await writeFile(analysisPath, analysisGzip);
  await writeFile(exchangePath, exchangeGzip);
  item.analysisPath = `analysis/${analysisFile}`;
  item.analysisBytes = analysisGzip.byteLength;
  item.exchangePath = `exchange/${exchangeFile}`;
  item.exchangeBytes = exchangeGzip.byteLength;
  item.lineCount = lines.length;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${item.name}: ${lines.length} lines, ${analysisGzip.byteLength} analysis bytes`);
}

manifest.generatedAt = new Date().toISOString();
manifest.queryFormat = 'compact-json-gzip-v1';
manifest.exchangeFormat = 'GeoJSON RFC 7946 + gzip';
manifest.crs = 'OGC:CRS84 / EPSG:4326';
manifest.totalLineCount = manifest.items.reduce((sum, item) => sum + item.lineCount, 0);
manifest.totalAnalysisBytes = manifest.items.reduce((sum, item) => sum + item.analysisBytes, 0);
manifest.totalExchangeBytes = manifest.items.reduce((sum, item) => sum + item.exchangeBytes, 0);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await writeFile(resolve(outputRoot, 'data-dictionary.csv'), [
  'field,type,description',
  'dataset_id,string,รหัสคงที่ของชุดข้อมูล',
  'name,string,ชื่อไฟล์หรือชื่อเส้นทาง',
  'geometry,GeoJSON,Geometry ตามมาตรฐาน RFC 7946',
  'properties,object,คุณลักษณะเดิมจาก KML ExtendedData',
  'crs,string,OGC:CRS84 หรือ EPSG:4326',
  'source_sha256,string,SHA-256 ของไฟล์ KML ต้นฉบับ'
].join('\r\n'));

console.log(JSON.stringify({
  datasets: manifest.fileCount,
  lines: manifest.totalLineCount,
  analysisBytes: manifest.totalAnalysisBytes,
  exchangeBytes: manifest.totalExchangeBytes
}, null, 2));
