import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'UFM');
const outputRoot = resolve(root, 'data-out', 'ufm', 'v1');
const analysisRoot = resolve(outputRoot, 'analysis');
const exchangeRoot = resolve(outputRoot, 'exchange');
const kmzRoot = resolve(outputRoot, 'kmz');

await rm(outputRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(analysisRoot, { recursive: true }),
  mkdir(exchangeRoot, { recursive: true }),
  mkdir(kmzRoot, { recursive: true })
]);

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
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) result[key] = value;
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

async function kmlDocuments(source, extension) {
  if (extension === '.kml') return [source.toString('utf8')];
  const archive = await JSZip.loadAsync(source);
  const entries = archive.file(/\.kml$/i);
  if (!entries.length) throw new Error('ไม่พบไฟล์ KML ภายใน KMZ');
  return Promise.all(entries.map(entry => entry.async('string')));
}

async function normalizedKmz(source, extension) {
  if (extension === '.kmz') return source;
  const archive = new JSZip();
  archive.file('doc.kml', source);
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}

const sourceNames = (await readdir(sourceRoot))
  .filter(name => /\.(kml|kmz)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, 'en'));
if (!sourceNames.length) throw new Error('ไม่พบไฟล์ KML/KMZ ในโฟลเดอร์ UFM');

const items = [];
for (const sourceName of sourceNames) {
  const sourcePath = resolve(sourceRoot, sourceName);
  const source = await readFile(sourcePath);
  const extension = extname(sourceName).toLowerCase();
  const id = createHash('sha256').update(sourceName).update(source).digest('hex').slice(0, 16);
  const datasetName = basename(sourceName, extension);
  const documents = await kmlDocuments(source, extension);
  const features = [];

  for (const documentText of documents) {
    const xml = new DOMParser().parseFromString(documentText, 'text/xml');
    for (const feature of collectFeatures(kmlWithFolders(xml, { skipNullGeometry: true }))) {
      features.push({
        type: 'Feature',
        id: `${id}-${features.length + 1}`,
        properties: cleanProperties(feature.properties),
        geometry: feature.geometry
      });
    }
  }

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

  const analysisFile = `${id}.json.gz`;
  const exchangeFile = `${id}.geojson.gz`;
  const kmzFile = `${id}.kmz`;
  const analysisBody = Buffer.from(JSON.stringify({ version: 1, datasetId: id, name: sourceName, lines }));
  const exchangeBody = Buffer.from(JSON.stringify({
    type: 'FeatureCollection',
    name: datasetName,
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features
  }));
  const analysisGzip = gzipSync(analysisBody, { level: 9 });
  const exchangeGzip = gzipSync(exchangeBody, { level: 9 });
  const kmz = await normalizedKmz(source, extension);
  await Promise.all([
    writeFile(resolve(analysisRoot, analysisFile), analysisGzip),
    writeFile(resolve(exchangeRoot, exchangeFile), exchangeGzip),
    writeFile(resolve(kmzRoot, kmzFile), kmz)
  ]);

  items.push({
    id,
    name: sourceName,
    group: 'UFM',
    sourceName,
    sourceFormat: extension.slice(1).toUpperCase(),
    path: `kmz/${kmzFile}`,
    analysisPath: `analysis/${analysisFile}`,
    exchangePath: `exchange/${exchangeFile}`,
    contentType: 'application/vnd.google-earth.kmz',
    originalBytes: source.byteLength,
    bytes: kmz.byteLength,
    analysisBytes: analysisGzip.byteLength,
    exchangeBytes: exchangeGzip.byteLength,
    featureCount: features.length,
    lineCount: lines.length,
    sha256: createHash('sha256').update(source).digest('hex')
  });
  console.log(`${sourceName}: ${lines.length.toLocaleString('en-US')} lines`);
}

const manifest = {
  id: 'ufm',
  title: 'ข้อมูลโครงข่าย UFM สำหรับเปรียบเทียบ',
  version: 'v1',
  generatedAt: new Date().toISOString(),
  queryFormat: 'compact-json-gzip-v1',
  exchangeFormat: 'GeoJSON RFC 7946 + gzip',
  sourceFormats: ['KML', 'KMZ'],
  crs: 'OGC:CRS84 / EPSG:4326',
  fileCount: items.length,
  totalLineCount: items.reduce((sum, item) => sum + item.lineCount, 0),
  totalFeatureCount: items.reduce((sum, item) => sum + item.featureCount, 0),
  totalAnalysisBytes: items.reduce((sum, item) => sum + item.analysisBytes, 0),
  totalExchangeBytes: items.reduce((sum, item) => sum + item.exchangeBytes, 0),
  items
};
await writeFile(resolve(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(resolve(outputRoot, 'data-dictionary.csv'), [
  'field,type,description',
  'dataset_id,string,รหัสคงที่ของชุดข้อมูล',
  'name,string,ชื่อไฟล์หรือชื่อเส้นทาง',
  'geometry,GeoJSON,Geometry มาตรฐาน RFC 7946',
  'properties,object,คุณลักษณะเดิมจาก KML ExtendedData',
  'crs,string,OGC:CRS84 หรือ EPSG:4326',
  'source_sha256,string,SHA-256 ของไฟล์ต้นฉบับ'
].join('\r\n'));

console.log(JSON.stringify({
  outputRoot,
  datasets: manifest.fileCount,
  lines: manifest.totalLineCount,
  features: manifest.totalFeatureCount,
  analysisBytes: manifest.totalAnalysisBytes,
  exchangeBytes: manifest.totalExchangeBytes
}, null, 2));
