import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';

const EXPECTED_PROJECT_REF = 'hrosqdqrbiflczqzokfo';
const BUCKET = 'permission-out-data';
const PREFIX = 'pea-area/v1';
const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'data-out', 'pea-area', 'v1');
const sourcePath = resolve(root, 'PEA Area.kmz');

function parseSecrets(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const secrets = parseSecrets(await readFile(resolve(root, 'API_Key.txt'), 'utf8'));
const supabaseUrl = secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL;
const adminKey = secrets.SUPABASE_SECRET_KEY || secrets.service_role;
const tusAuthKey = secrets.service_role || adminKey;
if (!supabaseUrl || !adminKey) throw new Error('API_Key.txt must contain SUPABASE_URL and a server-side Supabase key');
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== EXPECTED_PROJECT_REF) {
  throw new Error(`Refusing upload: expected ${EXPECTED_PROJECT_REF}, received ${projectRef}`);
}

const client = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const { data: buckets, error: listError } = await client.storage.listBuckets();
if (listError) throw listError;
if (!(buckets || []).some(bucket => bucket.id === BUCKET)) {
  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 52428800,
    allowedMimeTypes: [
      'application/json', 'application/geo+json', 'application/gzip', 'text/csv',
      'application/vnd.google-earth.kmz', 'application/octet-stream'
    ]
  });
  if (error) throw error;
  console.log(`Created bucket ${BUCKET} in ${EXPECTED_PROJECT_REF}`);
}

function uploadSourceWithTus() {
  return new Promise(async (resolveUpload, rejectUpload) => {
    const sourceStats = await stat(sourcePath);
    let lastProgressStep = -1;
    const upload = new tus.Upload(createReadStream(sourcePath), {
      endpoint: `https://${EXPECTED_PROJECT_REF}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${tusAuthKey}`, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      uploadSize: sourceStats.size,
      metadata: {
        bucketName: BUCKET,
        objectName: `${PREFIX}/source/PEA-Area.kmz`,
        contentType: 'application/vnd.google-earth.kmz',
        cacheControl: '31536000'
      },
      onError() { rejectUpload(new Error('Resumable upload failed')); },
      onProgress(uploaded, total) {
        const step = Math.floor((uploaded / total) * 4);
        if (step !== lastProgressStep) {
          lastProgressStep = step;
          console.log(`PEA source upload ${Math.min(step * 25, 100)}%`);
        }
      },
      onSuccess: resolveUpload
    });
    upload.start();
  });
}

async function localFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await localFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function contentType(path) {
  if (path.endsWith('.geojson')) return 'application/geo+json';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.csv')) return 'text/csv';
  if (path.endsWith('.gz')) return 'application/gzip';
  return 'application/octet-stream';
}

const { data: sourceObjects, error: sourceListError } = await client.storage.from(BUCKET).list(`${PREFIX}/source`);
if (sourceListError) throw sourceListError;
if (!(sourceObjects || []).some(object => object.name === 'PEA-Area.kmz')) await uploadSourceWithTus();
else console.log('PEA source already uploaded; skipping');
const files = await localFiles(outputRoot);
let uploadedCount = 0;
for (const absolute of files) {
  const localRelative = relative(outputRoot, absolute).split(sep).join('/');
  const objectPath = `${PREFIX}/${localRelative}`;
  const { error } = await client.storage.from(BUCKET).upload(objectPath, await readFile(absolute), {
    upsert: true,
    contentType: contentType(absolute),
    cacheControl: localRelative === 'manifest.json' ? '300' : '31536000'
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  uploadedCount += 1;
}

const manifestUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${PREFIX}/manifest.json`;
const manifestResponse = await fetch(`${manifestUrl}?verify=${Date.now()}`);
if (!manifestResponse.ok) throw new Error(`Manifest verification failed: HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
if (manifest.featureCount !== 911) throw new Error(`Manifest verification failed: ${manifest.featureCount} features`);
console.log(JSON.stringify({ projectRef, bucket: BUCKET, uploadedFiles: uploadedCount + 1, featureCount: manifest.featureCount }, null, 2));
