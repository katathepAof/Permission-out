import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_PROJECT_REF = 'hrosqdqrbiflczqzokfo';
const BUCKET = 'permission-out-data';
const PREFIX = 'uih-20072026/v1';
const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'data-out', 'uih-20072026', 'v1');

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

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(absolute));
    else result.push(absolute);
  }
  return result;
}

const secrets = parseSecrets(await readFile(resolve(root, 'API_Key.txt'), 'utf8'));
const supabaseUrl = secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL;
const adminKey = secrets.SUPABASE_SECRET_KEY || secrets.service_role;
if (!supabaseUrl || !adminKey) throw new Error('API_Key.txt must contain SUPABASE_URL and a server-side Supabase key');
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== EXPECTED_PROJECT_REF) throw new Error(`Refusing upload: expected ${EXPECTED_PROJECT_REF}, received ${projectRef}`);

const client = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const { error: bucketError } = await client.storage.updateBucket(BUCKET, {
  public: false,
  fileSizeLimit: 104857600,
  allowedMimeTypes: [
    'application/json', 'application/geo+json', 'application/gzip', 'text/csv',
    'application/vnd.google-earth.kmz', 'application/octet-stream'
  ]
});
if (bucketError) throw bucketError;
const files = await filesUnder(outputRoot);
let uploadedFiles = 0;
for (const absolute of files) {
  const localRelative = relative(outputRoot, absolute).split(sep).join('/');
  const objectPath = `${PREFIX}/${localRelative}`;
  const { error } = await client.storage.from(BUCKET).upload(objectPath, await readFile(absolute), {
    upsert: true,
    contentType: absolute.endsWith('.json') ? 'application/json'
      : absolute.endsWith('.csv') ? 'text/csv'
      : absolute.endsWith('.gz') ? 'application/gzip'
      : 'application/vnd.google-earth.kmz',
    cacheControl: absolute.endsWith('manifest.json') ? '300' : '31536000'
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  uploadedFiles += 1;
  console.log(`Uploaded ${uploadedFiles}/${files.length}: ${localRelative}`);
}

const { data: manifestFile, error: manifestError } = await client.storage.from(BUCKET).download(`${PREFIX}/manifest.json`);
if (manifestError || !manifestFile) throw new Error(`Manifest verification failed: ${manifestError?.message || 'empty response'}`);
const manifest = JSON.parse(await manifestFile.text());
if (manifest.fileCount !== 24) throw new Error(`Manifest verification failed: expected 24 files, received ${manifest.fileCount}`);
console.log(JSON.stringify({ projectRef, bucket: BUCKET, prefix: PREFIX, uploadedFiles, fileCount: manifest.fileCount }, null, 2));
