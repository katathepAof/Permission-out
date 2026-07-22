import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';
import simplify from '@turf/simplify';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'PEA Area.kmz');
const outputRoot = resolve(root, 'data-out', 'pea-area', 'v1');
const webRoot = resolve(outputRoot, 'web');
const chunkSize = 25;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(webRoot, { recursive: true });

const sourceBuffer = await readFile(sourcePath);
const archive = await JSZip.loadAsync(sourceBuffer);
const kmlEntries = Object.values(archive.files).filter(entry => !entry.dir && /\.kml$/i.test(entry.name));
if (!kmlEntries.length) throw new Error('No KML document found in PEA Area.kmz');

const features = [];
function walk(node) {
  if (node.type === 'Feature' && node.geometry) features.push(node);
  for (const child of node.children || []) walk(child);
}
for (const entry of kmlEntries) {
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'text/xml');
  walk(kmlWithFolders(xml, { skipNullGeometry: true }));
}

function officeType(name) {
  return String(name || '').match(/^[^\.]+\./)?.[0] || 'อื่น ๆ';
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) callback(value);
  else for (const child of value) visitCoordinates(child, callback);
}

function bboxOf(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const geometries = geometry?.type === 'GeometryCollection' ? geometry.geometries : [geometry];
  for (const item of geometries || []) visitCoordinates(item?.coordinates, ([x, y]) => {
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
  });
  return bbox.every(Number.isFinite) ? bbox : null;
}

const normalized = features.map((feature, index) => {
  const name = String(feature.properties?.name || `พื้นที่ ${index + 1}`).trim();
  const hash = createHash('sha256').update(name).update(JSON.stringify(feature.geometry)).digest('hex').slice(0, 16);
  return {
    type: 'Feature',
    id: hash,
    bbox: bboxOf(feature.geometry),
    properties: { ...feature.properties, pea_id: hash, office_type: officeType(name), name },
    geometry: feature.geometry
  };
}).sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'th'));

const canonical = JSON.stringify({ type: 'FeatureCollection', features: normalized });
await writeFile(resolve(outputRoot, 'pea-area.geojson.gz'), gzipSync(canonical, { level: 9 }));
await writeFile(resolve(outputRoot, 'data-dictionary.csv'), [
  'field,type,description',
  'pea_id,string,รหัสคงที่ของพื้นที่จาก SHA-256',
  'name,string,ชื่อหน่วยงานหรือพื้นที่จากไฟล์ต้นฉบับ',
  'office_type,string,ประเภทหน่วยงาน เช่น กฟจ. กฟอ. กฟส. กฟย.',
  'geometry,GeoJSON,Polygon MultiPolygon หรือ GeometryCollection ในระบบพิกัด WGS 84'
].join('\r\n'));

const chunks = [];
const items = [];
for (let offset = 0; offset < normalized.length; offset += chunkSize) {
  const chunkFeatures = normalized.slice(offset, offset + chunkSize).map(feature => {
    try { return simplify(feature, { tolerance: 0.00025, highQuality: true, mutate: false }); }
    catch { return feature; }
  });
  const chunkName = `chunk-${String(chunks.length + 1).padStart(3, '0')}.geojson`;
  const chunkBody = JSON.stringify({ type: 'FeatureCollection', features: chunkFeatures });
  await writeFile(resolve(webRoot, chunkName), chunkBody);
  chunks.push({ path: `web/${chunkName}`, featureCount: chunkFeatures.length, bytes: Buffer.byteLength(chunkBody) });
  for (const feature of chunkFeatures) items.push({
    id: feature.id,
    name: feature.properties.name,
    officeType: feature.properties.office_type,
    chunk: `web/${chunkName}`,
    bbox: feature.bbox || bboxOf(feature.geometry)
  });
}

const typeCounts = normalized.reduce((result, feature) => {
  const key = feature.properties.office_type;
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});
const manifest = {
  id: 'pea-area',
  title: 'เขตพื้นที่การไฟฟ้าส่วนภูมิภาค (PEA)',
  version: 'v1',
  generatedAt: new Date().toISOString(),
  crs: 'EPSG:4326',
  featureCount: normalized.length,
  source: { path: 'source/PEA-Area.kmz', bytes: sourceBuffer.byteLength },
  downloads: {
    originalKmz: 'source/PEA-Area.kmz',
    geojsonGzip: 'pea-area.geojson.gz',
    dataDictionary: 'data-dictionary.csv'
  },
  typeCounts,
  chunks,
  items
};
await writeFile(resolve(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(JSON.stringify({
  outputRoot,
  featureCount: normalized.length,
  chunkCount: chunks.length,
  largestChunkBytes: Math.max(...chunks.map(chunk => chunk.bytes)),
  canonicalBytes: Buffer.byteLength(canonical),
  canonicalGzipBytes: gzipSync(canonical, { level: 9 }).byteLength,
  typeCounts
}, null, 2));
