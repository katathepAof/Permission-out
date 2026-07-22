import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { DOMParser } from '@xmldom/xmldom';
import { kmlWithFolders } from '@tmcw/togeojson';

const EXPECTED_PROJECT_REF = 'hrosqdqrbiflczqzokfo';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'data-out', 'uih-20072026', 'v1', 'manifest.json'), 'utf8'));

function parseSecrets(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.+)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const secrets = parseSecrets(await readFile(resolve(root, 'API_Key.txt'), 'utf8'));
const supabaseUrl = secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL;
const adminKey = secrets.SUPABASE_SECRET_KEY || secrets.service_role;
if (!supabaseUrl || !adminKey) throw new Error('Missing Supabase server credentials');
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== EXPECTED_PROJECT_REF) throw new Error(`Refusing import: expected ${EXPECTED_PROJECT_REF}, received ${projectRef}`);

const client = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

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

for (let datasetNumber = 0; datasetNumber < manifest.items.length; datasetNumber += 1) {
  const item = manifest.items[datasetNumber];
  const dataset = {
    id: item.id,
    name: item.name,
    group_code: item.group,
    version: manifest.version,
    source_path: `uih-20072026/v1/${item.path}`,
    source_name: item.sourceName,
    source_sha256: item.sha256,
    source_bytes: item.originalBytes,
    compressed_bytes: item.bytes,
    feature_count: item.placemarkCount,
    crs: 'EPSG:4326',
    metadata: { sourceRelative: item.sourceRelative, catalog: manifest.id },
    is_active: true
  };
  const { error: datasetError } = await client.from('uih_datasets').upsert(dataset, { onConflict: 'id' });
  if (datasetError) throw new Error(`Dataset ${item.name}: ${datasetError.message}`);

  const sourcePath = resolve(root, 'uih-20072026', ...item.sourceRelative.split('/'));
  const source = await readFile(sourcePath, 'utf8');
  const xml = new DOMParser().parseFromString(source, 'text/xml');
  const parsed = collectFeatures(kmlWithFolders(xml, { skipNullGeometry: true }));
  let imported = 0;
  let batch = [];
  let batchBytes = 0;

  async function flush() {
    if (!batch.length) return;
    const { data, error } = await client.rpc('import_uih_features', { p_dataset_id: item.id, p_features: batch });
    if (error) throw new Error(`${item.name} at ${imported}: ${error.message}`);
    imported += Number(data || batch.length);
    batch = [];
    batchBytes = 0;
  }

  for (let index = 0; index < parsed.length; index += 1) {
    const feature = parsed[index];
    const row = {
      source_index: index,
      name: String(feature.properties?.name || `${basename(item.sourceName)} #${index + 1}`),
      properties: cleanProperties(feature.properties),
      geometry: feature.geometry
    };
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (batch.length >= 200 || batchBytes + bytes > 750_000) await flush();
    batch.push(row);
    batchBytes += bytes;
  }
  await flush();
  console.log(`[${datasetNumber + 1}/${manifest.items.length}] ${item.name}: ${imported}/${parsed.length}`);
}

const { error: refreshError } = await client.rpc('refresh_uih_dataset_counts');
if (refreshError) throw refreshError;
const { data: counts, error: countError } = await client.from('uih_datasets').select('id,name,feature_count').order('name');
if (countError) throw countError;
console.log(JSON.stringify({ projectRef, datasets: counts.length, features: counts.reduce((sum, row) => sum + row.feature_count, 0) }, null, 2));
