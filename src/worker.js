import { createClient } from '@supabase/supabase-js';

const APP_VERSION = '2.0.0';
const ADMIN_PAGE_SIZE = 100;
const DATA_BUCKET = 'permission-out-admin-data';
const DATA_FEATURE_BATCH_SIZE = 100;
const DATA_FILE_MAX_BYTES = 100 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class HttpError extends Error {
  constructor(status, message, code = 'request_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function appConfig(env) {
  return {
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
    appName: 'Permission Out',
    autosave: false,
    requireSupabase: true
  };
}

function configAssignment(env) {
  return `window.APP_CONFIG = ${JSON.stringify(appConfig(env))};`;
}

function noStoreHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  };
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      ...noStoreHeaders('application/json; charset=utf-8'),
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY'
    }
  });
}

function serviceRoleKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
}

function adminClient(env) {
  const key = serviceRoleKey(env);
  if (!env.SUPABASE_URL || !key) {
    throw new HttpError(503, 'ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY ใน Cloudflare Worker', 'admin_not_configured');
  }
  return createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่', 'unauthorized');
  return match[1];
}

async function requireAdmin(request, env) {
  const supabase = adminClient(env);
  const token = bearerToken(request);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'invalid_session');

  const profile = await getProfile(supabase, authData.user.id);
  const access = userAccess(authData.user, profile);
  if (!access.isActive) throw new HttpError(403, 'บัญชีนี้ถูกระงับการใช้งาน', 'account_inactive');
  if (access.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น', 'admin_required');
  return { supabase, user: authData.user, profile };
}

async function requireUser(request, env) {
  const supabase = adminClient(env);
  const token = bearerToken(request);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'invalid_session');
  const profile = await getProfile(supabase, authData.user.id);
  const access = userAccess(authData.user, profile);
  if (!access.isActive) throw new HttpError(403, 'บัญชีนี้ถูกระงับการใช้งาน', 'account_inactive');
  return { supabase, user: authData.user, profile, access };
}

async function requestJson(request, maxBytes = 20_000) {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'คำขอต้องเป็น application/json', 'unsupported_media_type');
  }
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxBytes) throw new HttpError(413, 'ข้อมูลคำขอมีขนาดใหญ่เกินไป', 'payload_too_large');
  try {
    const payload = await request.json();
    if (JSON.stringify(payload).length > maxBytes) {
      throw new HttpError(413, 'ข้อมูลคำขอมีขนาดใหญ่เกินไป', 'payload_too_large');
    }
    return payload;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'รูปแบบ JSON ไม่ถูกต้อง', 'invalid_json');
  }
}

function cleanText(value, label, maxLength, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new HttpError(400, `กรุณากรอก${label}`, 'validation_error');
  if (result.length > maxLength) throw new HttpError(400, `${label}ต้องไม่เกิน ${maxLength} ตัวอักษร`, 'validation_error');
  return result;
}

function cleanEmail(value) {
  const email = cleanText(value, 'อีเมล', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง', 'validation_error');
  }
  return email;
}

function cleanRole(value) {
  const role = String(value || 'user');
  if (!['admin', 'user'].includes(role)) throw new HttpError(400, 'สิทธิ์ผู้ใช้ไม่ถูกต้อง', 'validation_error');
  return role;
}

function cleanUserId(value) {
  const id = String(value || '');
  if (!UUID_PATTERN.test(id)) throw new HttpError(400, 'รหัสผู้ใช้ไม่ถูกต้อง', 'validation_error');
  return id;
}

function userAccess(user, profile = {}) {
  const metadata = user?.app_metadata || {};
  const role = metadata.permission_out_role || profile.role || 'user';
  const metadataActive = metadata.permission_out_active;
  const isActive = metadataActive === undefined ? profile.is_active !== false : metadataActive !== false;
  return { role: role === 'admin' ? 'admin' : 'user', isActive };
}

function missingAccessColumns(error) {
  return error?.code === '42703' || /role|is_active/i.test(String(error?.message || ''));
}

async function getProfile(supabase, id) {
  let result = await supabase
    .from('profiles')
    .select('id,display_name,organization,role,is_active,created_at')
    .eq('id', id)
    .maybeSingle();
  if (result.error && missingAccessColumns(result.error)) {
    result = await supabase
      .from('profiles')
      .select('id,display_name,organization,created_at')
      .eq('id', id)
      .maybeSingle();
  }
  if (result.error) throw result.error;
  return result.data || {};
}

async function getProfiles(supabase, ids) {
  if (!ids.length) return [];
  let result = await supabase
    .from('profiles')
    .select('id,display_name,organization,role,is_active,created_at')
    .in('id', ids);
  if (result.error && missingAccessColumns(result.error)) {
    result = await supabase
      .from('profiles')
      .select('id,display_name,organization,created_at')
      .in('id', ids);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function saveProfile(supabase, profile, { updateOnly = false } = {}) {
  const write = data => updateOnly
    ? supabase.from('profiles').update(data).eq('id', profile.id)
    : supabase.from('profiles').upsert(data, { onConflict: 'id' });
  let result = await write(profile);
  if (result.error && missingAccessColumns(result.error)) {
    const { role, is_active: isActive, ...compatibleProfile } = profile;
    result = await write(compatibleProfile);
  }
  if (result.error) throw result.error;
}

async function ensureAnotherAdmin(supabase, targetId) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const candidates = (data?.users || []).filter(user => user.id !== targetId);
  const profiles = await getProfiles(supabase, candidates.map(user => user.id));
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const hasAnotherAdmin = candidates.some(user => {
    const access = userAccess(user, byId.get(user.id));
    return access.role === 'admin' && access.isActive;
  });
  if (!hasAnotherAdmin) throw new HttpError(409, 'ระบบต้องมีผู้ดูแลที่ใช้งานได้อย่างน้อย 1 คน', 'last_admin');
}

function publicUser(user, profile = {}) {
  const access = userAccess(user, profile);
  return {
    id: user.id,
    email: user.email || '',
    displayName: profile.display_name || user.user_metadata?.display_name || '',
    organization: profile.organization || user.user_metadata?.organization || '',
    role: access.role,
    isActive: access.isActive,
    emailConfirmedAt: user.email_confirmed_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    createdAt: user.created_at || profile.created_at || null
  };
}

async function listAdminUsers(request, env) {
  const { supabase } = await requireAdmin(request, env);
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(100_000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const perPage = Math.max(1, Math.min(ADMIN_PAGE_SIZE, Number.parseInt(url.searchParams.get('perPage') || '50', 10) || 50));
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase().slice(0, 120);
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
  if (error) throw error;
  const users = data?.users || [];
  const ids = users.map(user => user.id);
  const profiles = await getProfiles(supabase, ids);
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const result = users
    .map(user => publicUser(user, byId.get(user.id)))
    .filter(user => !search || `${user.email} ${user.displayName} ${user.organization}`.toLowerCase().includes(search));
  return jsonResponse({
    users: result,
    pagination: {
      page,
      perPage,
      total: data?.total ?? null,
      nextPage: data?.nextPage ?? null,
      lastPage: data?.lastPage ?? null
    }
  });
}

async function createAdminUser(request, env) {
  const { supabase } = await requireAdmin(request, env);
  const payload = await requestJson(request);
  const email = cleanEmail(payload.email);
  const password = String(payload.password || '');
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'รหัสผ่านต้องมี 12–128 ตัวอักษร', 'validation_error');
  }
  const displayName = cleanText(payload.displayName, 'ชื่อผู้ใช้', 120, true);
  const organization = cleanText(payload.organization, 'หน่วยงาน', 160);
  const role = cleanRole(payload.role);
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, organization },
    app_metadata: { permission_out_role: role, permission_out_active: true }
  });
  if (error || !data.user) throw error || new Error('สร้างผู้ใช้ไม่สำเร็จ');
  const profile = {
    id: data.user.id,
    display_name: displayName,
    organization: organization || null,
    role,
    is_active: true
  };
  try {
    await saveProfile(supabase, profile);
  } catch (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw profileError;
  }
  return jsonResponse({ user: publicUser(data.user, profile) }, 201);
}

async function updateAdminUser(request, env, targetId) {
  const { supabase, user: requester } = await requireAdmin(request, env);
  const id = cleanUserId(targetId);
  const payload = await requestJson(request);
  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(id);
  if (authUserError || !authUserData.user) throw new HttpError(404, 'ไม่พบผู้ใช้', 'user_not_found');
  const existing = await getProfile(supabase, id);
  const existingAccess = userAccess(authUserData.user, existing);

  const role = cleanRole(payload.role ?? existingAccess.role);
  const isActive = payload.isActive === undefined ? existingAccess.isActive : Boolean(payload.isActive);
  if (id === requester.id && (role !== 'admin' || !isActive)) {
    throw new HttpError(409, 'ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้', 'self_protection');
  }
  if (existingAccess.role === 'admin' && existingAccess.isActive && (role !== 'admin' || !isActive)) {
    await ensureAnotherAdmin(supabase, id);
  }

  const displayName = cleanText(payload.displayName ?? existing.display_name, 'ชื่อผู้ใช้', 120, true);
  const organization = cleanText(payload.organization ?? existing.organization, 'หน่วยงาน', 160);
  const authChanges = {
    user_metadata: { display_name: displayName, organization },
    app_metadata: {
      ...(authUserData.user.app_metadata || {}),
      permission_out_role: role,
      permission_out_active: isActive
    },
    ban_duration: isActive ? 'none' : '876000h'
  };
  if (payload.email !== undefined) {
    authChanges.email = cleanEmail(payload.email);
    authChanges.email_confirm = true;
  }
  if (payload.password) {
    const password = String(payload.password);
    if (password.length < 12 || password.length > 128) {
      throw new HttpError(400, 'รหัสผ่านต้องมี 12–128 ตัวอักษร', 'validation_error');
    }
    authChanges.password = password;
  }
  const { data, error } = await supabase.auth.admin.updateUserById(id, authChanges);
  if (error || !data.user) throw error || new Error('แก้ไขผู้ใช้ไม่สำเร็จ');
  const profile = { id, display_name: displayName, organization: organization || null, role, is_active: isActive };
  await saveProfile(supabase, profile, { updateOnly: true });
  return jsonResponse({ user: publicUser(data.user, profile) });
}

async function deleteAdminUser(request, env, targetId) {
  const { supabase, user: requester } = await requireAdmin(request, env);
  const id = cleanUserId(targetId);
  if (id === requester.id) throw new HttpError(409, 'ไม่สามารถลบบัญชีของตนเองได้', 'self_protection');
  const { data, error: userError } = await supabase.auth.admin.getUserById(id);
  if (userError || !data.user) throw new HttpError(404, 'ไม่พบผู้ใช้', 'user_not_found');
  const profile = await getProfile(supabase, id);
  const access = userAccess(data.user, profile);
  if (access.role === 'admin' && access.isActive) await ensureAnotherAdmin(supabase, id);
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw error;
  return jsonResponse({ ok: true });
}

function cleanDataSource(value) {
  const source = String(value || '').toLowerCase();
  if (!['pea', 'ufm'].includes(source)) throw new HttpError(400, 'ประเภทชุดข้อมูลต้องเป็น PEA หรือ UFM', 'validation_error');
  return source;
}

function cleanDatasetFileName(value) {
  const fileName = cleanText(value, 'ชื่อไฟล์', 240, true).normalize('NFKC');
  if (/[\/\\\u0000-\u001f]/.test(fileName) || !/\.(kml|kmz)$/i.test(fileName)) {
    throw new HttpError(400, 'รองรับเฉพาะชื่อไฟล์ .kml หรือ .kmz ที่ไม่มี path', 'validation_error');
  }
  return {
    displayName: fileName,
    canonicalName: fileName.toLocaleLowerCase('en-US')
  };
}

function cleanSha256(value) {
  const hash = String(value || '').toLowerCase();
  if (!SHA256_PATTERN.test(hash)) throw new HttpError(400, 'SHA-256 ของไฟล์ไม่ถูกต้อง', 'validation_error');
  return hash;
}

function cleanFileSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > DATA_FILE_MAX_BYTES) {
    throw new HttpError(400, 'ไฟล์ต้องมีขนาดไม่เกิน 100 MB', 'validation_error');
  }
  return size;
}

function publicDatasetVersion(version) {
  return {
    id: version.id,
    datasetId: version.dataset_id,
    versionNo: version.version_no,
    status: version.status,
    rawSha256: version.raw_sha256,
    rawSize: Number(version.raw_size || 0),
    featureCount: version.feature_count || 0,
    newCount: version.new_count || 0,
    updatedCount: version.updated_count || 0,
    removedCount: version.removed_count || 0,
    unchangedCount: version.unchanged_count || 0,
    errorMessage: version.error_message || '',
    uploadedBy: version.uploaded_by,
    createdAt: version.created_at,
    validatedAt: version.validated_at,
    publishedAt: version.published_at
  };
}

async function listManagedDatasets(request, env) {
  const { supabase } = await requireAdmin(request, env);
  const { data: datasets, error: datasetError } = await supabase
    .from('managed_datasets')
    .select('id,source,canonical_name,display_name,active_version_id,created_at,updated_at')
    .order('source')
    .order('display_name');
  if (datasetError) throw datasetError;
  const ids = (datasets || []).map(dataset => dataset.id);
  const { data: versions, error: versionError } = ids.length
    ? await supabase
      .from('managed_dataset_versions')
      .select('id,dataset_id,version_no,status,raw_sha256,raw_size,feature_count,new_count,updated_count,removed_count,unchanged_count,error_message,uploaded_by,created_at,validated_at,published_at')
      .in('dataset_id', ids)
      .order('version_no', { ascending: false })
    : { data: [], error: null };
  if (versionError) throw versionError;
  const versionsByDataset = new Map();
  for (const version of versions || []) {
    if (!versionsByDataset.has(version.dataset_id)) versionsByDataset.set(version.dataset_id, []);
    versionsByDataset.get(version.dataset_id).push(publicDatasetVersion(version));
  }
  return jsonResponse({
    datasets: (datasets || []).map(dataset => ({
      id: dataset.id,
      source: dataset.source,
      canonicalName: dataset.canonical_name,
      displayName: dataset.display_name,
      activeVersionId: dataset.active_version_id,
      createdAt: dataset.created_at,
      updatedAt: dataset.updated_at,
      versions: versionsByDataset.get(dataset.id) || []
    }))
  });
}

async function createDatasetUpload(request, env) {
  const { supabase, user } = await requireAdmin(request, env);
  const payload = await requestJson(request, 30_000);
  const source = cleanDataSource(payload.source);
  const { displayName, canonicalName } = cleanDatasetFileName(payload.fileName);
  const rawSha256 = cleanSha256(payload.sha256);
  const rawSize = cleanFileSize(payload.size);

  let { data: dataset, error: datasetError } = await supabase
    .from('managed_datasets')
    .select('id,source,canonical_name,display_name,active_version_id')
    .eq('source', source)
    .eq('canonical_name', canonicalName)
    .maybeSingle();
  if (datasetError) throw datasetError;
  if (!dataset) {
    const created = await supabase
      .from('managed_datasets')
      .insert({ source, canonical_name: canonicalName, display_name: displayName })
      .select('id,source,canonical_name,display_name,active_version_id')
      .single();
    if (created.error) throw created.error;
    dataset = created.data;
  }

  const duplicate = await supabase
    .from('managed_dataset_versions')
    .select('id,status,version_no')
    .eq('dataset_id', dataset.id)
    .eq('raw_sha256', rawSha256)
    .in('status', ['staging', 'ready', 'active'])
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) {
    throw new HttpError(409, `ไฟล์นี้ตรงกับเวอร์ชัน ${duplicate.data.version_no} ที่มีอยู่แล้ว`, 'duplicate_file');
  }

  const latest = await supabase
    .from('managed_dataset_versions')
    .select('version_no')
    .eq('dataset_id', dataset.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  const versionNo = (latest.data?.version_no || 0) + 1;
  const rawPath = `${source}/${dataset.id}/v${versionNo}/${displayName}`;
  const inserted = await supabase
    .from('managed_dataset_versions')
    .insert({
      dataset_id: dataset.id,
      version_no: versionNo,
      raw_path: rawPath,
      raw_sha256: rawSha256,
      raw_size: rawSize,
      uploaded_by: user.id
    })
    .select('id,dataset_id,version_no,status,raw_sha256,raw_size,feature_count,new_count,updated_count,removed_count,unchanged_count,error_message,uploaded_by,created_at,validated_at,published_at')
    .single();
  if (inserted.error) throw inserted.error;

  const signed = await supabase.storage.from(DATA_BUCKET).createSignedUploadUrl(rawPath);
  if (signed.error || !signed.data?.token) {
    await supabase.from('managed_dataset_versions').delete().eq('id', inserted.data.id);
    throw signed.error || new Error('สร้าง URL สำหรับอัปโหลดไม่สำเร็จ');
  }
  await supabase.from('managed_dataset_audit').insert({
    dataset_id: dataset.id,
    version_id: inserted.data.id,
    action: 'upload',
    actor_id: user.id,
    detail: { file_name: displayName, raw_size: rawSize, raw_sha256: rawSha256 }
  });
  return jsonResponse({
    dataset: {
      id: dataset.id,
      source,
      displayName,
      canonicalName,
      activeVersionId: dataset.active_version_id
    },
    version: publicDatasetVersion(inserted.data),
    upload: { bucket: DATA_BUCKET, path: signed.data.path || rawPath, token: signed.data.token }
  }, 201);
}

function validateCoordinatePair(pair) {
  return Array.isArray(pair)
    && pair.length >= 2
    && Number.isFinite(pair[0])
    && Number.isFinite(pair[1])
    && pair[0] >= -180
    && pair[0] <= 180
    && pair[1] >= -90
    && pair[1] <= 90;
}

function validateManagedFeature(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `Feature ลำดับ ${index + 1} ไม่ถูกต้อง`, 'validation_error');
  }
  const logicalId = cleanText(value.logical_id, 'รหัส Feature', 500, true);
  const sourceIndex = Number(value.source_index);
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
    throw new HttpError(400, `source_index ลำดับ ${index + 1} ไม่ถูกต้อง`, 'validation_error');
  }
  const name = cleanText(value.name, 'ชื่อ Feature', 500) || 'ไม่ระบุชื่อ';
  const properties = value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
    ? value.properties
    : {};
  if (JSON.stringify(properties).length > 32_000) {
    throw new HttpError(400, `Metadata ของ ${name} มีขนาดใหญ่เกินไป`, 'validation_error');
  }
  const geometry = value.geometry;
  if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) {
    throw new HttpError(400, `${name} ต้องเป็น LineString หรือ MultiLineString`, 'validation_error');
  }
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, `${name} ไม่มีพิกัด`, 'validation_error');
  let coordinateCount = 0;
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2 || !line.every(validateCoordinatePair)) {
      throw new HttpError(400, `พิกัดของ ${name} ไม่ถูกต้อง`, 'validation_error');
    }
    coordinateCount += line.length;
  }
  if (coordinateCount > 50_000) throw new HttpError(400, `${name} มีพิกัดมากเกิน 50,000 จุด`, 'validation_error');
  return { logical_id: logicalId, source_index: sourceIndex, name, properties, geometry };
}

async function importDatasetFeatureBatch(request, env, versionId) {
  const { supabase } = await requireAdmin(request, env);
  const id = cleanUserId(versionId);
  const payload = await requestJson(request, 5_000_000);
  if (!Array.isArray(payload.features) || !payload.features.length || payload.features.length > DATA_FEATURE_BATCH_SIZE) {
    throw new HttpError(400, `หนึ่งชุดต้องมี Feature 1-${DATA_FEATURE_BATCH_SIZE} รายการ`, 'validation_error');
  }
  const features = payload.features.map(validateManagedFeature);
  const { data, error } = await supabase.rpc('import_managed_dataset_features', {
    p_version_id: id,
    p_features: features
  });
  if (error) throw error;
  return jsonResponse({ imported: Number(data || 0) });
}

async function completeDatasetVersion(request, env, versionId) {
  const { supabase, user } = await requireAdmin(request, env);
  const id = cleanUserId(versionId);
  const versionResult = await supabase
    .from('managed_dataset_versions')
    .select('id,dataset_id,raw_path,raw_size,status')
    .eq('id', id)
    .single();
  if (versionResult.error || !versionResult.data) throw new HttpError(404, 'ไม่พบเวอร์ชันข้อมูล', 'version_not_found');
  if (versionResult.data.status !== 'staging') throw new HttpError(409, 'เวอร์ชันนี้ไม่ได้อยู่ใน Staging', 'invalid_version_state');
  const pathParts = versionResult.data.raw_path.split('/');
  const objectName = pathParts.pop();
  const directory = pathParts.join('/');
  const stored = await supabase.storage.from(DATA_BUCKET).list(directory, { search: objectName, limit: 10 });
  if (stored.error) throw stored.error;
  const object = (stored.data || []).find(item => item.name === objectName);
  if (!object) throw new HttpError(409, 'ยังไม่พบไฟล์ต้นฉบับใน Storage', 'raw_file_missing');
  const storedSize = Number(object.metadata?.size || 0);
  if (storedSize && storedSize !== Number(versionResult.data.raw_size)) {
    throw new HttpError(409, 'ขนาดไฟล์ใน Storage ไม่ตรงกับไฟล์ที่ตรวจสอบ', 'raw_file_size_mismatch');
  }
  const { data, error } = await supabase.rpc('finalize_managed_dataset_version', {
    p_version_id: id,
    p_actor_id: user.id
  });
  if (error) throw error;
  return jsonResponse({ version: publicDatasetVersion(data) });
}

async function publishDatasetVersion(request, env, versionId) {
  const { supabase, user } = await requireAdmin(request, env);
  const id = cleanUserId(versionId);
  const { data, error } = await supabase.rpc('publish_managed_dataset_version', {
    p_version_id: id,
    p_actor_id: user.id
  });
  if (error) throw error;
  return jsonResponse({ version: publicDatasetVersion(data) });
}

async function failDatasetVersion(request, env, versionId) {
  const { supabase, user } = await requireAdmin(request, env);
  const id = cleanUserId(versionId);
  const payload = await requestJson(request, 20_000);
  const message = cleanText(payload.message, 'รายละเอียดข้อผิดพลาด', 1000) || 'การนำเข้าไม่สำเร็จ';
  const current = await supabase
    .from('managed_dataset_versions')
    .select('id,dataset_id,status')
    .eq('id', id)
    .single();
  if (current.error || !current.data) throw new HttpError(404, 'ไม่พบเวอร์ชันข้อมูล', 'version_not_found');
  if (!['staging', 'ready'].includes(current.data.status)) {
    throw new HttpError(409, 'ไม่สามารถเปลี่ยนสถานะเวอร์ชันนี้ได้', 'invalid_version_state');
  }
  const updated = await supabase
    .from('managed_dataset_versions')
    .update({ status: 'failed', error_message: message })
    .eq('id', id);
  if (updated.error) throw updated.error;
  await supabase.from('managed_dataset_audit').insert({
    dataset_id: current.data.dataset_id,
    version_id: id,
    action: 'fail',
    actor_id: user.id,
    detail: { message }
  });
  return jsonResponse({ ok: true });
}

async function activeDatasetCatalog(request, env) {
  const { supabase } = await requireUser(request, env);
  const url = new URL(request.url);
  const source = cleanDataSource(url.searchParams.get('source'));
  const datasets = await supabase
    .from('managed_datasets')
    .select('id,source,canonical_name,display_name,active_version_id,updated_at')
    .eq('source', source)
    .not('active_version_id', 'is', null)
    .order('display_name');
  if (datasets.error) throw datasets.error;
  const activeIds = (datasets.data || []).map(dataset => dataset.active_version_id);
  const versions = activeIds.length
    ? await supabase
      .from('managed_dataset_versions')
      .select('id,version_no,feature_count,published_at')
      .in('id', activeIds)
    : { data: [], error: null };
  if (versions.error) throw versions.error;
  const byId = new Map((versions.data || []).map(version => [version.id, version]));
  return jsonResponse({
    source,
    items: (datasets.data || []).map(dataset => {
      const version = byId.get(dataset.active_version_id) || {};
      return {
        id: dataset.id,
        name: dataset.display_name,
        canonicalName: dataset.canonical_name,
        managed: true,
        lineCount: version.feature_count || 0,
        featureCount: version.feature_count || 0,
        versionNo: version.version_no || 0,
        publishedAt: version.published_at || dataset.updated_at
      };
    })
  });
}

async function activeDatasetFeatures(request, env, datasetId) {
  const { supabase } = await requireUser(request, env);
  const id = cleanUserId(datasetId);
  const url = new URL(request.url);
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('limit') || '500', 10) || 500));
  const dataset = await supabase
    .from('managed_datasets')
    .select('id,display_name,active_version_id')
    .eq('id', id)
    .single();
  if (dataset.error || !dataset.data?.active_version_id) throw new HttpError(404, 'ไม่พบชุดข้อมูลที่เผยแพร่แล้ว', 'dataset_not_found');
  const features = await supabase
    .from('managed_dataset_features')
    .select('source_index,name,properties,geometry')
    .eq('version_id', dataset.data.active_version_id)
    .order('source_index')
    .range(offset, offset + limit - 1);
  if (features.error) throw features.error;
  const rows = features.data || [];
  const lines = [];
  for (const feature of rows) {
    const geometryLines = feature.geometry?.type === 'MultiLineString'
      ? feature.geometry.coordinates
      : [feature.geometry?.coordinates];
    for (const coordinates of geometryLines) {
      if (Array.isArray(coordinates) && coordinates.length >= 2) {
        lines.push({ c: coordinates, n: feature.name, p: feature.properties || {} });
      }
    }
  }
  return jsonResponse({
    datasetId: id,
    versionId: dataset.data.active_version_id,
    offset,
    limit,
    nextOffset: rows.length === limit ? offset + limit : null,
    lines
  });
}

function mod2ListParam(searchParams, name) {
  const raw = String(searchParams.get(name) || '').trim();
  if (!raw) return null;
  const values = [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))];
  if (values.length > 50 || values.some(value => value.length > 200)) {
    throw new HttpError(400, `ตัวกรอง ${name} ไม่ถูกต้อง`, 'validation_error');
  }
  return values;
}

function mod2BboxParam(searchParams) {
  const raw = String(searchParams.get('bbox') || '').trim();
  if (!raw) return null;
  const bbox = raw.split(',').map(Number);
  if (
    bbox.length !== 4
    || !bbox.every(Number.isFinite)
    || bbox[0] < -180 || bbox[2] > 180
    || bbox[1] < -90 || bbox[3] > 90
    || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]
  ) {
    throw new HttpError(400, 'ขอบเขตแผนที่ไม่ถูกต้อง', 'validation_error');
  }
  return bbox;
}

async function activeMod2Sites(request, env) {
  const { supabase } = await requireUser(request, env);
  const url = new URL(request.url);
  const afterId = Math.max(0, Number.parseInt(url.searchParams.get('after') || '0', 10) || 0);
  const limit = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get('limit') || '500', 10) || 500));
  const query = cleanText(url.searchParams.get('query'), 'คำค้นหา', 200);
  const result = await supabase.rpc('get_mod2_site_page', {
    p_after_id: afterId,
    p_limit: limit,
    p_bbox: mod2BboxParam(url.searchParams),
    p_query: query || null,
    p_regionals: mod2ListParam(url.searchParams, 'regional'),
    p_uih_areas: mod2ListParam(url.searchParams, 'area'),
    p_provinces: mod2ListParam(url.searchParams, 'province'),
    p_site_grades: mod2ListParam(url.searchParams, 'grade'),
    p_types_of_digit: mod2ListParam(url.searchParams, 'type'),
    p_owners: mod2ListParam(url.searchParams, 'owner')
  });
  if (result.error) throw result.error;
  return jsonResponse(result.data || {
    type: 'FeatureCollection',
    features: [],
    nextAfter: null,
    count: 0
  });
}

function cleanMod2SiteId(value) {
  const id = Number.parseInt(String(value || ''), 10);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'รหัสไซต์ไม่ถูกต้อง', 'validation_error');
  }
  return id;
}

async function activeMod2Site(supabase, id) {
  const siteResult = await supabase.from('mod2_sites').select('*').eq('id', id).maybeSingle();
  if (siteResult.error) throw siteResult.error;
  if (!siteResult.data) throw new HttpError(404, 'ไม่พบไซต์นี้', 'not_found');
  const datasetResult = await supabase
    .from('mod2_site_datasets')
    .select('id,active_version_id')
    .eq('active_version_id', siteResult.data.version_id)
    .maybeSingle();
  if (datasetResult.error) throw datasetResult.error;
  if (!datasetResult.data) throw new HttpError(404, 'ไซต์นี้ไม่ได้อยู่ในชุดข้อมูลที่เผยแพร่', 'not_found');
  return { site: siteResult.data, dataset: datasetResult.data };
}

function mod2SiteFeature(site) {
  return {
    type: 'Feature',
    id: site.id,
    geometry: {
      type: 'Point',
      coordinates: [Number(site.longitude), Number(site.latitude)]
    },
    properties: {
      site_code: site.site_code,
      site_name: site.site_name,
      type_of_digit: site.type_of_digit,
      site_grade: site.site_grade,
      regional: site.regional,
      uih_area: site.uih_area,
      district: site.district,
      province: site.province,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      customers: Number(site.customers || 0),
      node_equipment: site.node_equipment,
      owner: site.owner,
      opex: Number(site.opex || 0),
      remark: site.remark
    }
  };
}

async function listMod2Comments(request, env, siteId) {
  const { supabase } = await requireUser(request, env);
  const id = cleanMod2SiteId(siteId);
  await activeMod2Site(supabase, id);
  const result = await supabase
    .from('mod2_site_comments')
    .select('id,author_id,body,created_at,updated_at')
    .eq('site_id', id)
    .order('created_at', { ascending: true })
    .limit(100);
  if (result.error) throw result.error;
  const authorIds = [...new Set((result.data || []).map(comment => comment.author_id))];
  const profiles = await getProfiles(supabase, authorIds);
  const names = new Map(profiles.map(profile => [
    profile.id,
    profile.display_name || 'ผู้ใช้งาน'
  ]));
  return jsonResponse({
    comments: (result.data || []).map(comment => ({
      id: comment.id,
      body: comment.body,
      authorName: names.get(comment.author_id) || 'ผู้ใช้งาน',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at
    }))
  });
}

async function createMod2Comment(request, env, siteId) {
  const { supabase, user } = await requireUser(request, env);
  const id = cleanMod2SiteId(siteId);
  await activeMod2Site(supabase, id);
  const payload = await requestJson(request, 5_000);
  const body = cleanText(payload.body, 'ความคิดเห็น', 1000, true);
  const result = await supabase
    .from('mod2_site_comments')
    .insert({ site_id: id, author_id: user.id, body })
    .select('id,body,created_at,updated_at')
    .single();
  if (result.error) throw result.error;
  return jsonResponse({ comment: result.data }, 201);
}

async function updateMod2Site(request, env, siteId) {
  const { supabase, user } = await requireAdmin(request, env);
  const id = cleanMod2SiteId(siteId);
  const { site, dataset } = await activeMod2Site(supabase, id);
  const payload = await requestJson(request, 20_000);
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new HttpError(400, 'Latitude ไม่ถูกต้อง', 'validation_error');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(400, 'Longitude ไม่ถูกต้อง', 'validation_error');
  }
  const changes = {
    site_code: cleanText(payload.siteCode, ' Site Code', 100, true),
    site_name: cleanText(payload.siteName, 'ชื่อไซต์', 200) || null,
    province: cleanText(payload.province, 'จังหวัด', 200) || null,
    district: cleanText(payload.district, 'อำเภอ', 200) || null,
    regional: cleanText(payload.regional, ' Regional', 200) || null,
    uih_area: cleanText(payload.area, ' UIH Area', 200) || null,
    site_grade: cleanText(payload.grade, ' Site Grade', 200) || null,
    type_of_digit: cleanText(payload.type, ' Type of Digit', 200) || null,
    owner: cleanText(payload.owner, ' Owner', 200) || null,
    node_equipment: cleanText(payload.nodeEquipment, ' Node Equipment', 500) || null,
    remark: cleanText(payload.remark, ' Remark', 2000) || null,
    latitude,
    longitude,
    geom: { type: 'Point', coordinates: [longitude, latitude] }
  };
  const result = await supabase.from('mod2_sites').update(changes).eq('id', id).select('*').single();
  if (result.error) throw result.error;
  const audit = await supabase.from('mod2_site_audit').insert({
    dataset_id: dataset.id,
    version_id: site.version_id,
    site_code: result.data.site_code,
    action: 'update',
    old_data: site,
    new_data: result.data,
    actor_id: user.id
  });
  if (audit.error) throw audit.error;
  return jsonResponse({ site: mod2SiteFeature(result.data) });
}

async function deleteMod2Site(request, env, siteId) {
  const { supabase, user } = await requireAdmin(request, env);
  const id = cleanMod2SiteId(siteId);
  const { site, dataset } = await activeMod2Site(supabase, id);
  const removal = await supabase.from('mod2_sites').delete().eq('id', id);
  if (removal.error) throw removal.error;
  const audit = await supabase.from('mod2_site_audit').insert({
    dataset_id: dataset.id,
    version_id: site.version_id,
    site_code: site.site_code,
    action: 'delete',
    old_data: site,
    actor_id: user.id
  });
  if (audit.error) throw audit.error;
  return jsonResponse({ deleted: true, id });
}

async function handleAdminApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/admin/users') return listAdminUsers(request, env);
  if (request.method === 'POST' && url.pathname === '/api/admin/users') return createAdminUser(request, env);
  if (request.method === 'GET' && url.pathname === '/api/admin/data/datasets') return listManagedDatasets(request, env);
  if (request.method === 'POST' && url.pathname === '/api/admin/data/uploads') return createDatasetUpload(request, env);
  const dataVersionMatch = url.pathname.match(/^\/api\/admin\/data\/versions\/([^/]+)\/(features|complete|publish|fail)$/);
  if (dataVersionMatch && request.method === 'POST') {
    if (dataVersionMatch[2] === 'features') return importDatasetFeatureBatch(request, env, dataVersionMatch[1]);
    if (dataVersionMatch[2] === 'complete') return completeDatasetVersion(request, env, dataVersionMatch[1]);
    if (dataVersionMatch[2] === 'publish') return publishDatasetVersion(request, env, dataVersionMatch[1]);
    if (dataVersionMatch[2] === 'fail') return failDatasetVersion(request, env, dataVersionMatch[1]);
  }
  const match = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (match && request.method === 'PATCH') return updateAdminUser(request, env, match[1]);
  if (match && request.method === 'DELETE') return deleteAdminUser(request, env, match[1]);
  throw new HttpError(405, 'ไม่รองรับคำขอนี้', 'method_not_allowed');
}

async function handleDataApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/data/catalog') return activeDatasetCatalog(request, env);
  const featureMatch = url.pathname.match(/^\/api\/data\/datasets\/([^/]+)\/features$/);
  if (featureMatch && request.method === 'GET') return activeDatasetFeatures(request, env, featureMatch[1]);
  throw new HttpError(405, 'ไม่รองรับคำขอนี้', 'method_not_allowed');
}

async function handleMod2Api(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/mod2/sites') return activeMod2Sites(request, env);
  const commentMatch = url.pathname.match(/^\/api\/mod2\/sites\/(\d+)\/comments$/);
  if (commentMatch && request.method === 'GET') return listMod2Comments(request, env, commentMatch[1]);
  if (commentMatch && request.method === 'POST') return createMod2Comment(request, env, commentMatch[1]);
  const siteMatch = url.pathname.match(/^\/api\/mod2\/sites\/(\d+)$/);
  if (siteMatch && request.method === 'PATCH') return updateMod2Site(request, env, siteMatch[1]);
  if (siteMatch && request.method === 'DELETE') return deleteMod2Site(request, env, siteMatch[1]);
  throw new HttpError(405, 'ไม่รองรับคำขอนี้', 'method_not_allowed');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/bootstrap.js') {
      return new Response(`${configAssignment(env)}\n`, {
        headers: noStoreHeaders('text/javascript; charset=utf-8')
      });
    }

    if (url.pathname === '/api/health') {
      const configured = Boolean(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY));
      return Response.json({
        ok: configured,
        service: 'permission-out',
        version: APP_VERSION,
        supabaseConfigured: configured,
        adminApiConfigured: Boolean(configured && serviceRoleKey(env)),
        timestamp: new Date().toISOString()
      }, {
        status: configured ? 200 : 503,
        headers: noStoreHeaders('application/json; charset=utf-8')
      });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      try {
        return await handleAdminApi(request, env, url);
      } catch (error) {
        const migrationMissing = ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
        const status = migrationMissing ? 503 : error instanceof HttpError ? error.status : 500;
        const code = migrationMissing ? 'dataset_migration_required' : error instanceof HttpError ? error.code : 'server_error';
        const message = migrationMissing
          ? 'ยังไม่ได้ติดตั้ง Dataset Versioning migration ใน Supabase'
          : status === 500 ? 'ระบบจัดการข้อมูลขัดข้อง กรุณาลองใหม่' : error.message;
        return jsonResponse({ error: { code, message } }, status);
      }
    }

    if (url.pathname.startsWith('/api/data/')) {
      try {
        return await handleDataApi(request, env, url);
      } catch (error) {
        const migrationMissing = ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
        const status = migrationMissing ? 503 : error instanceof HttpError ? error.status : 500;
        const code = migrationMissing ? 'dataset_migration_required' : error instanceof HttpError ? error.code : 'server_error';
        const message = migrationMissing
          ? 'ยังไม่ได้ติดตั้ง Dataset Versioning migration ใน Supabase'
          : status === 500 ? 'โหลดข้อมูลกลางไม่สำเร็จ กรุณาลองใหม่' : error.message;
        return jsonResponse({ error: { code, message } }, status);
      }
    }

    if (url.pathname.startsWith('/api/mod2/')) {
      try {
        return await handleMod2Api(request, env, url);
      } catch (error) {
        const migrationMissing = ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
        const status = migrationMissing ? 503 : error instanceof HttpError ? error.status : 500;
        const code = migrationMissing ? 'mod2_migration_required' : error instanceof HttpError ? error.code : 'server_error';
        const message = migrationMissing
          ? 'ยังไม่ได้ติดตั้ง MOD 2 migration ใน Supabase'
          : status === 500 ? 'โหลดข้อมูล MOD 2 ไม่สำเร็จ กรุณาลองใหม่' : error.message;
        return jsonResponse({ error: { code, message } }, status);
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (
      ['/', '/index.html', '/mod2', '/mod2/', '/mod2/index.html'].includes(url.pathname)
      && assetResponse.headers.get('Content-Type')?.includes('text/html')
    ) {
      const html = await assetResponse.text();
      const injected = html.replace(/<script src="\/?bootstrap\.js"><\/script>/, `<script>${configAssignment(env)}</script>`);
      const headers = new Headers(assetResponse.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return new Response(injected, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }
    return assetResponse;
  }
};
