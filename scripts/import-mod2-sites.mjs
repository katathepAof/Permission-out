import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_SITE_COUNT = 2009;
const DATASET_CODE = 'site-facility-2026';
const DATASET_NAME = 'UIH Site Facility & Design Report';
const BUCKET = 'permission-out-mod2-data';
const SOURCE_FILE = 'UIH sites 2026 sync 5 - Copy.html';
const MIGRATION_FILE = 'supabase/migrations/20260724120000_mod2_site_facility.sql';
const root = resolve(import.meta.dirname, '..');
const prepareOnly = process.argv.includes('--prepare-only');

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

function extractEmbeddedSites(html) {
  const declaration = 'let SITES =';
  const nextDeclaration = 'const GRADE_COLORS';
  const start = html.indexOf(declaration);
  const end = html.indexOf(nextDeclaration, start + declaration.length);
  if (start < 0 || end < 0) throw new Error('Cannot locate the embedded SITES array');
  const candidate = html.slice(start + declaration.length, end);
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayEnd < 0) throw new Error('Embedded SITES array is incomplete');
  return JSON.parse(candidate.slice(0, arrayEnd + 1).trim());
}

function optionalText(value, maxLength) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, maxLength) : null;
}

function finiteNumber(value, field, siteCode) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${siteCode}: ${field} is not a finite number`);
  return number;
}

function normalizeSites(rawSites) {
  const seenCodes = new Set();
  const normalized = rawSites.map((site, sourceIndex) => {
    const siteCode = optionalText(site.sc, 100);
    if (!siteCode) throw new Error(`Row ${sourceIndex + 1}: site code is required`);
    if (seenCodes.has(siteCode)) throw new Error(`Duplicate site code: ${siteCode}`);
    seenCodes.add(siteCode);

    const latitude = finiteNumber(site.lat, 'latitude', siteCode);
    const longitude = finiteNumber(site.lng, 'longitude', siteCode);
    if (latitude < -90 || latitude > 90) throw new Error(`${siteCode}: latitude is out of range`);
    if (longitude < -180 || longitude > 180) throw new Error(`${siteCode}: longitude is out of range`);

    const customers = Math.max(0, Math.trunc(finiteNumber(site.cust ?? 0, 'customers', siteCode)));
    const opex = Math.max(0, finiteNumber(site.opex ?? 0, 'opex', siteCode));
    return {
      source_index: sourceIndex,
      site_code: siteCode,
      site_name: optionalText(site.sn, 500),
      type_of_digit: optionalText(site.tod, 100),
      site_grade: optionalText(site.sg, 150),
      regional: optionalText(site.reg, 100),
      uih_area: optionalText(site.area, 100),
      district: optionalText(site.dist, 200),
      province: optionalText(site.prov, 200),
      latitude,
      longitude,
      customers,
      node_equipment: optionalText(site.ne, 500),
      owner: optionalText(site.owner, 200),
      opex: Number(opex.toFixed(2)),
      remark: optionalText(site.remark, 5000)
    };
  });

  if (normalized.length !== EXPECTED_SITE_COUNT) {
    throw new Error(`Expected ${EXPECTED_SITE_COUNT} sites, received ${normalized.length}`);
  }
  return normalized;
}

async function resolveActorId(client, configuredActorId) {
  let query = client
    .from('profiles')
    .select('id,role,is_active')
    .eq('role', 'admin')
    .eq('is_active', true);
  if (configuredActorId) query = query.eq('id', configuredActorId);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`Cannot resolve MOD 2 import actor: ${error.message}`);
  if (!data) {
    throw new Error(configuredActorId
      ? 'MOD2_IMPORT_ACTOR_ID is not an active admin profile'
      : 'No active admin profile exists; create an Admin or set MOD2_IMPORT_ACTOR_ID');
  }
  return data.id;
}

const sourcePath = resolve(root, SOURCE_FILE);
const html = await readFile(sourcePath, 'utf8');
const sites = normalizeSites(extractEmbeddedSites(html));
const payload = {
  schema_version: 1,
  dataset_code: DATASET_CODE,
  source_file: basename(sourcePath),
  row_count: sites.length,
  sites
};
const rawBuffer = Buffer.from(JSON.stringify(payload));
const rawSha256 = createHash('sha256').update(rawBuffer).digest('hex');
const outputDirectory = resolve(root, 'data-out', 'mod2-sites', 'v1');
const outputPath = resolve(outputDirectory, 'sites.json');
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, rawBuffer);

const summary = {
  source: SOURCE_FILE,
  output: 'data-out/mod2-sites/v1/sites.json',
  sites: sites.length,
  bytes: rawBuffer.byteLength,
  sha256: rawSha256,
  uniqueSiteCodes: new Set(sites.map(site => site.site_code)).size,
  invalidCoordinates: sites.filter(site => (
    site.latitude < -90 || site.latitude > 90 || site.longitude < -180 || site.longitude > 180
  )).length
};

if (prepareOnly) {
  console.log(JSON.stringify({ mode: 'prepare-only', ...summary }, null, 2));
  process.exit(0);
}

const secrets = parseSecrets(await readFile(resolve(root, 'API_Key.txt'), 'utf8'));
const supabaseUrl = secrets.SUPABASE_URL || secrets.NEXT_PUBLIC_SUPABASE_URL;
const adminKey = secrets.SUPABASE_SECRET_KEY || secrets.service_role;
const expectedProjectRef = process.env.MOD2_SUPABASE_PROJECT_REF || secrets.SUPABASE_PROJECT_REF;
if (!supabaseUrl || !adminKey) {
  throw new Error('API_Key.txt must contain SUPABASE_URL and a server-side Supabase key');
}
if (!expectedProjectRef) {
  throw new Error(
    'Set MOD2_SUPABASE_PROJECT_REF or add SUPABASE_PROJECT_REF to API_Key.txt before remote import'
  );
}
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== expectedProjectRef) {
  throw new Error(`Refusing import: expected project ${expectedProjectRef}, received ${projectRef}`);
}

const client = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const preflight = await client.from('mod2_site_datasets').select('id').limit(1);
if (preflight.error) {
  throw new Error(
    `MOD 2 schema is unavailable. Run ${MIGRATION_FILE} first. Supabase returned: ${preflight.error.message}`
  );
}

const actorId = await resolveActorId(client, process.env.MOD2_IMPORT_ACTOR_ID);
const { data: dataset, error: datasetError } = await client
  .from('mod2_site_datasets')
  .upsert({ code: DATASET_CODE, display_name: DATASET_NAME }, { onConflict: 'code' })
  .select('id,code,active_version_id')
  .single();
if (datasetError) throw new Error(`Cannot create MOD 2 dataset: ${datasetError.message}`);

const { data: existingVersion, error: existingError } = await client
  .from('mod2_site_versions')
  .select('id,version_no,status,row_count')
  .eq('dataset_id', dataset.id)
  .eq('raw_sha256', rawSha256)
  .maybeSingle();
if (existingError) throw new Error(`Cannot check existing MOD 2 versions: ${existingError.message}`);

if (existingVersion?.status === 'active' || existingVersion?.status === 'archived') {
  console.log(JSON.stringify({
    mode: 'remote-import',
    projectRef,
    datasetId: dataset.id,
    versionId: existingVersion.id,
    versionNo: existingVersion.version_no,
    status: existingVersion.status,
    idempotent: true,
    ...summary
  }, null, 2));
  process.exit(0);
}

let version = existingVersion;
if (!version) {
  const { data: latestVersion, error: latestError } = await client
    .from('mod2_site_versions')
    .select('version_no')
    .eq('dataset_id', dataset.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(`Cannot determine the next MOD 2 version: ${latestError.message}`);
  const versionNo = Number(latestVersion?.version_no || 0) + 1;
  const rawPath = `${DATASET_CODE}/v${versionNo}/sites.json`;
  const { data: createdVersion, error: createError } = await client
    .from('mod2_site_versions')
    .insert({
      dataset_id: dataset.id,
      version_no: versionNo,
      status: 'staging',
      raw_path: rawPath,
      raw_sha256: rawSha256,
      raw_size: rawBuffer.byteLength,
      uploaded_by: actorId
    })
    .select('id,version_no,status,raw_path')
    .single();
  if (createError) throw new Error(`Cannot create MOD 2 version: ${createError.message}`);
  version = createdVersion;

  const { error: auditError } = await client.from('mod2_site_audit').insert({
    dataset_id: dataset.id,
    version_id: version.id,
    action: 'upload',
    actor_id: actorId,
    detail: {
      source_file: SOURCE_FILE,
      raw_path: version.raw_path,
      raw_sha256: rawSha256,
      raw_size: rawBuffer.byteLength
    }
  });
  if (auditError) throw new Error(`Cannot write MOD 2 upload audit: ${auditError.message}`);
} else if (version.status === 'failed') {
  const { error: retryError } = await client
    .from('mod2_site_versions')
    .update({ status: 'staging', error_message: null })
    .eq('id', version.id);
  if (retryError) throw new Error(`Cannot retry failed MOD 2 version: ${retryError.message}`);
  version.status = 'staging';
}

const rawPath = version.raw_path || `${DATASET_CODE}/v${version.version_no}/sites.json`;
const { error: uploadError } = await client.storage
  .from(BUCKET)
  .upload(rawPath, rawBuffer, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '31536000'
  });
if (uploadError) throw new Error(`Cannot upload MOD 2 source file: ${uploadError.message}`);

try {
  if (version.status === 'staging') {
    let imported = 0;
    for (let offset = 0; offset < sites.length; offset += 250) {
      const batch = sites.slice(offset, offset + 250);
      const { data, error } = await client.rpc('import_mod2_sites', {
        p_version_id: version.id,
        p_sites: batch
      });
      if (error) throw new Error(`Import batch at row ${offset + 1}: ${error.message}`);
      imported += Number(data || 0);
      console.log(`Imported ${Math.min(offset + batch.length, sites.length)}/${sites.length}`);
    }
    if (imported !== sites.length) {
      throw new Error(`Expected ${sites.length} imported rows, RPC reported ${imported}`);
    }

    const { data: finalized, error: finalizeError } = await client.rpc('finalize_mod2_site_version', {
      p_version_id: version.id,
      p_actor_id: actorId
    });
    if (finalizeError) throw new Error(`Cannot finalize MOD 2 version: ${finalizeError.message}`);
    version = finalized;
  }

  const { data: published, error: publishError } = await client.rpc('publish_mod2_site_version', {
    p_version_id: version.id,
    p_actor_id: actorId
  });
  if (publishError) throw new Error(`Cannot publish MOD 2 version: ${publishError.message}`);
  version = published;
} catch (error) {
  await client
    .from('mod2_site_versions')
    .update({ status: 'failed', error_message: String(error.message).slice(0, 2000) })
    .eq('id', version.id)
    .eq('status', 'staging');
  await client.from('mod2_site_audit').insert({
    dataset_id: dataset.id,
    version_id: version.id,
    action: 'fail',
    actor_id: actorId,
    detail: { error: String(error.message).slice(0, 2000) }
  });
  throw error;
}

const { count: storedCount, error: countError } = await client
  .from('mod2_sites')
  .select('id', { count: 'exact', head: true })
  .eq('version_id', version.id);
if (countError) throw new Error(`Cannot verify MOD 2 row count: ${countError.message}`);
if (storedCount !== EXPECTED_SITE_COUNT) {
  throw new Error(`Remote verification failed: expected ${EXPECTED_SITE_COUNT}, received ${storedCount}`);
}

console.log(JSON.stringify({
  mode: 'remote-import',
  projectRef,
  datasetId: dataset.id,
  versionId: version.id,
  versionNo: version.version_no,
  status: version.status,
  remoteRows: storedCount,
  ...summary
}, null, 2));
