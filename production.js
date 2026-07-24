(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const cloudEnabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
  const cloudRequired = cfg.requireSupabase !== false;
  const client = cloudEnabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  const LOCAL_KEY = 'permission-out.projects.v2';
  const titleInput = document.getElementById('projectTitle');
  const saveState = document.getElementById('saveState');
  const peaDatasetStatus = document.getElementById('peaDatasetStatus');
  const ufmDatasetStatus = document.getElementById('ufmDatasetStatus');
  let currentUser = null;
  let currentProfile = null;
  let currentProjectId = null;
  let dirty = false;
  let autoSaveTimer = null;
  const peaLayerTrigger = document.getElementById('peaLayerTrigger');
  const peaLayerPanel = document.getElementById('peaLayerPanel');
  const peaLayerStatus = document.getElementById('peaLayerStatus');
  const peaLayerCount = document.getElementById('peaLayerCount');
  const peaLayerSearch = document.getElementById('peaLayerSearch');
  const peaLayerList = document.getElementById('peaLayerList');
  const peaLayerTypes = document.getElementById('peaLayerTypes');
  const peaSelected = new Set();
  const peaChunkCache = new Map();
  let peaManifest = null;
  let peaLookupGrid = null;
  const PEA_LOOKUP_CELL_DEG = 0.25;
  let peaOverlayLayer = null;
  let peaRenderTimer = null;
  let peaRenderVersion = 0;
  let peaShouldFocus = false;
  const baseFileInput = document.getElementById('fileBase');
  const baseCatalogList = document.getElementById('baseCatalogList');
  const baseCatalogSearch = document.getElementById('baseCatalogSearch');
  const baseCatalogStatus = document.getElementById('baseCatalogStatus');
  const baseCatalogCount = document.getElementById('baseCatalogCount');
  const baseCatalogSelected = new Set();
  const baseAnalysisCache = new Map();
  let baseCatalogManifest = null;
  const compareCatalogList = document.getElementById('compareCatalogList');
  const compareCatalogSearch = document.getElementById('compareCatalogSearch');
  const compareCatalogStatus = document.getElementById('compareCatalogStatus');
  const compareCatalogCount = document.getElementById('compareCatalogCount');
  const compareCatalogSelected = new Set();
  const compareAnalysisCache = new Map();
  let compareCatalogManifest = null;
  const DEFAULT_BILLING_FORMULA = Object.freeze({
    formula_id: null,
    code: 'permission_fee',
    version: 1,
    name: 'Permission fee formula v1',
    parameters: {
      poles_per_km: 29,
      rate_baht_per_line_mm_pole: 2.8,
      surcharge_percent: 5,
      currency: 'THB'
    },
    source: 'local-fallback'
  });
  window.permissionOutBillingFormula = DEFAULT_BILLING_FORMULA;

  const modalRoot = document.createElement('div');
  modalRoot.className = 'app-backdrop';
  modalRoot.innerHTML = '<div class="app-modal" role="dialog" aria-modal="true" aria-labelledby="appModalTitle"><div class="modal-head"><div><h2 id="appModalTitle"></h2><p id="appModalSubtitle"></p></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div class="modal-body" id="appModalBody"></div></div>';
  document.body.appendChild(modalRoot);
  let modalLocked = false;
  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  document.body.appendChild(toastStack);

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `app-toast ${type}`.trim();
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function setSaveState(text, kind = '') {
    if (!saveState) return;
    saveState.textContent = text;
    saveState.className = `save-state ${kind ? `is-${kind}` : ''}`.trim();
  }

  function setDatasetHealth(element, text, state = '') {
    if (!element) return;
    element.textContent = text;
    const chip = element.closest('.dataset-health-chip');
    chip?.classList.toggle('is-ready', state === 'ready');
    chip?.classList.toggle('is-error', state === 'error');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function peaAssetUrl(path) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/permission-out-data/pea-area/v1/${encoded}`;
  }

  function uihAssetUrl(path) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/permission-out-data/uih-20072026/v1/${encoded}`;
  }

  function ufmAssetUrl(path) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/permission-out-data/ufm/v1/${encoded}`;
  }

  async function authenticatedJson(path) {
    if (!client) throw new Error('ต้องเชื่อมต่อ Supabase');
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return payload;
  }

  async function managedCatalog(source) {
    try {
      const payload = await authenticatedJson(`/api/data/catalog?source=${encodeURIComponent(source)}`);
      return Array.isArray(payload.items) ? payload.items : [];
    } catch (_) {
      // Existing immutable Storage manifests remain the safe fallback until the
      // dataset-versioning migration is applied and an Admin publishes a version.
      return [];
    }
  }

  function mergeManagedCatalog(manifest, managedItems) {
    if (!managedItems.length) return manifest;
    const canonical = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const replacementNames = new Set(managedItems.map(item => canonical(item.canonicalName || item.name)));
    const legacyItems = (manifest.items || []).filter(item => {
      const candidates = [item.sourceName, item.name, item.sourceRelative].map(canonical);
      return !candidates.some(name => replacementNames.has(name));
    });
    const items = [...legacyItems, ...managedItems];
    return {
      ...manifest,
      items,
      fileCount: items.length,
      totalLineCount: items.reduce((sum, item) => sum + Number(item.lineCount || item.featureCount || 0), 0)
    };
  }

  async function fetchManagedAnalysis(item) {
    const lines = [];
    let offset = 0;
    do {
      const payload = await authenticatedJson(`/api/data/datasets/${encodeURIComponent(item.id)}/features?offset=${offset}&limit=500`);
      lines.push(...(payload.lines || []));
      offset = payload.nextOffset;
    } while (offset !== null && offset !== undefined);
    return { lines };
  }

  function filteredBaseCatalogItems() {
    if (!baseCatalogManifest) return [];
    const query = baseCatalogSearch?.value.trim().toLocaleLowerCase('th') || '';
    return baseCatalogManifest.items.filter(item => !query || `${item.name} ${item.group}`.toLocaleLowerCase('th').includes(query));
  }

  function updateBaseCatalogSummary(message = '') {
    if (baseCatalogCount) baseCatalogCount.textContent = baseCatalogSelected.size.toLocaleString('th-TH');
    if (!baseCatalogStatus) return;
    const selectedLines = baseCatalogManifest?.items
      .filter(item => baseCatalogSelected.has(item.id))
      .reduce((sum, item) => sum + (item.lineCount || item.placemarkCount || 0), 0) || 0;
    baseCatalogStatus.textContent = message || (baseCatalogManifest
      ? `เลือก ${baseCatalogSelected.size.toLocaleString('th-TH')} จาก ${baseCatalogManifest.fileCount.toLocaleString('th-TH')} ชุดข้อมูล${selectedLines ? ` · ${selectedLines.toLocaleString('th-TH')} เส้น` : ''}`
      : 'ยังไม่พบรายการไฟล์');
  }

  function renderBaseCatalog() {
    if (!baseCatalogList) return;
    const items = filteredBaseCatalogItems();
    baseCatalogList.innerHTML = '';
    if (!items.length) {
      baseCatalogList.innerHTML = '<div class="base-catalog-empty">ไม่พบไฟล์ที่ตรงกับคำค้นหา</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    let currentGroup = '';
    for (const item of items) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        const heading = document.createElement('div');
        heading.className = 'base-catalog-group';
        heading.textContent = currentGroup;
        fragment.appendChild(heading);
      }
      const label = document.createElement('label');
      label.className = 'base-catalog-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = baseCatalogSelected.has(item.id);
      input.addEventListener('change', () => {
        if (input.checked) baseCatalogSelected.add(item.id); else baseCatalogSelected.delete(item.id);
        window.permissionOutBaseDatasetIds = Array.from(baseCatalogSelected);
        window.permissionOutBaseDatasetNames = (baseCatalogManifest?.items || []).filter(entry => baseCatalogSelected.has(entry.id)).map(entry => entry.name);
        updateBaseCatalogSummary();
      });
      const name = document.createElement('span'); name.textContent = item.name;
      const size = document.createElement('em'); size.textContent = `${(item.lineCount || item.placemarkCount || 0).toLocaleString('th-TH')} เส้น`;
      label.append(input, name, size);
      fragment.appendChild(label);
    }
    baseCatalogList.appendChild(fragment);
  }

  function propertyValue(properties, patterns) {
    for (const [key, value] of Object.entries(properties || {})) {
      if (value == null || value === '') continue;
      if (patterns.some(pattern => pattern.test(key))) return String(value);
    }
    return '';
  }

  function propertiesWithDescriptionFields(properties) {
    const merged = { ...(properties || {}) };
    const put = (key, value) => {
      const cleanKey = String(key || '').trim();
      const cleanValue = String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (cleanKey && cleanValue && !(cleanKey in merged)) merged[cleanKey] = cleanValue;
    };
    const description = String(merged.description || '');
    description.split(/\r?\n|<br\s*\/?>/i).forEach(row => {
      const match = row.replace(/<[^>]*>/g, ' ').match(/^\s*([\wก-๙ .\-/]+?)\s*[:=]\s*(.+?)\s*$/);
      if (match) put(match[1], match[2]);
    });
    if (description.includes('<') && typeof DOMParser !== 'undefined') {
      try {
        const document = new DOMParser().parseFromString(description, 'text/html');
        for (const row of document.querySelectorAll('tr')) {
          const cells = row.querySelectorAll('td,th');
          if (cells.length >= 2) put(cells[0].textContent, cells[1].textContent);
        }
      } catch (_) { /* malformed HTML descriptions still use the line parser above */ }
    }
    return merged;
  }

  function routeIdentifier(properties) {
    // Prefer identifier-shaped values even when the ordinary `name` field holds
    // a human-readable description such as a cable type or route description.
    for (const value of Object.values(properties || {})) {
      const tokens = String(value).match(/\b\d{2}[A-Z]{2,}[A-Z0-9-]{4,}\b/gi) || [];
      const identifier = tokens[0];
      if (identifier) return identifier;
    }
    return propertyValue(properties, [/^\s*(?:placemark[_\s-]*name|route[_\s-]*(?:name|id|code)|line[_\s-]*(?:id|code)|name|code|id)\s*$/i, /ชื่อ.*(?:เส้น|สาย|สถานที่)/i]);
  }

  function compactLineToApp(line, item) {
    const properties = propertiesWithDescriptionFields(line.p || {});
    const originalName = String(line.n || properties.name || '');
    const identifier = routeIdentifier(properties);
    const name = String(identifier || originalName || 'ไม่ระบุชื่อ');
    const cableType = propertyValue(properties, [/cable[_\s-]*type/i, /cabletype/i, /ชนิดสาย/i, /ประเภทสาย/i]);
    const rawType = propertyValue(properties, [/^type$/i, /line[_\s-]*type/i, /ชนิด/i, /ประเภท/i]);
    const cableStatus = propertyValue(properties, [/^status$/i, /cable[_\s-]*status/i, /line[_\s-]*status/i, /สถานะ/i]);
    const combined = `${cableType} ${rawType} ${name}`.toUpperCase();
    const type = /FIG\.?\s*8|F\s*\(\s*8\s*\)/.test(combined) ? 'FIG8'
      : /DROP\s*WIRE/.test(combined) ? 'DROPWIRE'
      : /ADSS/.test(combined) ? 'ADSS'
      : /ARSS/.test(combined) ? 'ARSS'
      : /FRP/.test(combined) ? 'FRP' : null;
    const coreRaw = propertyValue(properties, [/core/i, /แกน/i, /count/i, /size/i]);
    const coreMatch = coreRaw.match(/\d+/);
    const core = coreMatch ? Number(coreMatch[0]) : null;
    const diameterRaw = propertyValue(properties, [/diam/i, /ขนาด/i, /เส้นผ่านศูนย์กลาง/i]);
    const diameterMatch = diameterRaw.match(/[\d.]+/);
    let diameter = diameterMatch ? Number(diameterMatch[0]) : null;
    let diameterSource = diameter !== null ? 'file' : null;
    if (diameter === null && type && typeof lookupDiameterByTypeCore === 'function') {
      diameter = lookupDiameterByTypeCore(type, core);
      if (diameter !== null) diameterSource = 'table';
    }
    const sourceCode = propertyValue(properties, [/^code$/i, /route[_\s-]*code/i, /รหัส/i]) || identifier;
    const measured = propertyValue(properties, [/^measured$/i, /ระยะ.*วัด/i]);
    const calculated = propertyValue(properties, [/^calculated$/i, /ระยะ.*คำนวณ/i]);
    return {
      coords: line.c,
      name,
      diameter,
      unit: diameter !== null ? 'mm' : null,
      type,
      core,
      diameterSource,
      cableType,
      rawType,
      cableStatus,
      sourceMetadata: { code: sourceCode, originalName, measured, calculated },
      extKeys: Object.keys(properties).join(', '),
      sourceFile: item.name
    };
  }

  function fetchBaseAnalysis(item) {
    const cacheKey = item.managed ? `managed:${item.id}:v${item.versionNo || 0}` : item.analysisPath;
    if (baseAnalysisCache.has(cacheKey)) return baseAnalysisCache.get(cacheKey);
    const request = item.managed ? fetchManagedAnalysis(item) : fetch(uihAssetUrl(item.analysisPath)).then(async response => {
      if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
      if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์ไม่รองรับการอ่านข้อมูล gzip แบบสตรีม');
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).json();
    }).catch(error => {
      baseAnalysisCache.delete(cacheKey);
      throw error;
    });
    baseAnalysisCache.set(cacheKey, request);
    return request;
  }

  async function loadSelectedBaseLines() {
    const selectedItems = (baseCatalogManifest?.items || []).filter(item => baseCatalogSelected.has(item.id));
    const box = document.getElementById('boxBase');
    box?.classList.toggle('is-loading', selectedItems.length > 0);
    baseCatalogList?.setAttribute('aria-busy', String(selectedItems.length > 0));
    try {
      if (!selectedItems.length) return [];
      updateBaseCatalogSummary(`กำลังอ่าน ${selectedItems.length.toLocaleString('th-TH')} ชุดข้อมูลแบบ optimized…`);
      const payloads = [];
      for (let offset = 0; offset < selectedItems.length; offset += 3) {
        payloads.push(...await Promise.all(selectedItems.slice(offset, offset + 3).map(fetchBaseAnalysis)));
      }
      const lines = payloads.flatMap((payload, index) => (payload.lines || []).map(line => compactLineToApp(line, selectedItems[index])));
      updateBaseCatalogSummary(`${selectedItems.length.toLocaleString('th-TH')} ชุดข้อมูล · พร้อมวิเคราะห์ ${lines.length.toLocaleString('th-TH')} เส้น`);
      return lines;
    } catch (error) {
      updateBaseCatalogSummary('อ่านข้อมูล optimized ไม่สำเร็จ');
      toast(`อ่านข้อมูลฐานไม่สำเร็จ: ${error.message}`, 'error');
      throw error;
    } finally {
      box?.classList.remove('is-loading');
      baseCatalogList?.setAttribute('aria-busy', 'false');
    }
  }

  window.permissionOutBaseDatasetIds = [];
  window.permissionOutBaseDatasetNames = [];
  window.permissionOutLoadBaseLines = loadSelectedBaseLines;

  async function initializeBaseCatalog() {
    if (!baseCatalogList || !baseFileInput || !cloudEnabled) {
      updateBaseCatalogSummary(cloudEnabled ? 'ไม่พบส่วนแสดงรายการไฟล์' : 'ต้องเชื่อมต่อ Supabase');
      setDatasetHealth(peaDatasetStatus, cloudEnabled ? 'ไม่พร้อม' : 'ออฟไลน์', 'error');
      return;
    }
    try {
      setDatasetHealth(peaDatasetStatus, 'กำลังโหลด');
      const response = await fetch(`${uihAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      manifest = mergeManagedCatalog(manifest, await managedCatalog('pea'));
      baseCatalogManifest = manifest;
      renderBaseCatalog();
      updateBaseCatalogSummary();
      setDatasetHealth(peaDatasetStatus, `${manifest.fileCount.toLocaleString('th-TH')} ชุด`, 'ready');
    } catch (error) {
      baseCatalogList.innerHTML = '<div class="base-catalog-empty">โหลดรายการไฟล์ไม่สำเร็จ</div>';
      updateBaseCatalogSummary('เชื่อมต่อคลังไฟล์ไม่ได้');
      setDatasetHealth(peaDatasetStatus, 'เชื่อมต่อไม่ได้', 'error');
      toast(`โหลดรายการไฟล์ฐานไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  function filteredCompareCatalogItems() {
    if (!compareCatalogManifest) return [];
    const query = compareCatalogSearch?.value.trim().toLocaleLowerCase('th') || '';
    return compareCatalogManifest.items.filter(item => !query || `${item.name} ${item.group || ''}`.toLocaleLowerCase('th').includes(query));
  }

  function updateCompareCatalogSummary(message = '') {
    if (compareCatalogCount) compareCatalogCount.textContent = compareCatalogSelected.size.toLocaleString('th-TH');
    if (!compareCatalogStatus) return;
    const selectedLines = compareCatalogManifest?.items
      .filter(item => compareCatalogSelected.has(item.id))
      .reduce((sum, item) => sum + (item.lineCount || item.featureCount || 0), 0) || 0;
    compareCatalogStatus.textContent = message || (compareCatalogManifest
      ? `เลือก ${compareCatalogSelected.size.toLocaleString('th-TH')} จาก ${compareCatalogManifest.fileCount.toLocaleString('th-TH')} ชุดข้อมูล${selectedLines ? ` · ${selectedLines.toLocaleString('th-TH')} เส้น` : ''}`
      : 'ยังไม่พบรายการไฟล์');
  }

  function syncCompareSelection() {
    window.permissionOutCompareDatasetIds = Array.from(compareCatalogSelected);
    window.permissionOutCompareDatasetNames = (compareCatalogManifest?.items || [])
      .filter(item => compareCatalogSelected.has(item.id)).map(item => item.name);
  }

  function renderCompareCatalog() {
    if (!compareCatalogList) return;
    const items = filteredCompareCatalogItems();
    compareCatalogList.innerHTML = '';
    if (!items.length) {
      compareCatalogList.innerHTML = '<div class="base-catalog-empty">ไม่พบไฟล์ที่ตรงกับคำค้นหา</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'base-catalog-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = compareCatalogSelected.has(item.id);
      input.addEventListener('change', () => {
        if (input.checked) compareCatalogSelected.add(item.id); else compareCatalogSelected.delete(item.id);
        syncCompareSelection();
        updateCompareCatalogSummary();
      });
      const name = document.createElement('span'); name.textContent = item.name;
      const size = document.createElement('em'); size.textContent = `${(item.lineCount || item.featureCount || 0).toLocaleString('th-TH')} เส้น`;
      label.append(input, name, size);
      fragment.appendChild(label);
    }
    compareCatalogList.appendChild(fragment);
  }

  function fetchCompareAnalysis(item) {
    const cacheKey = item.managed ? `managed:${item.id}:v${item.versionNo || 0}` : item.analysisPath;
    if (compareAnalysisCache.has(cacheKey)) return compareAnalysisCache.get(cacheKey);
    const request = item.managed ? fetchManagedAnalysis(item) : fetch(ufmAssetUrl(item.analysisPath)).then(async response => {
      if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
      if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์ไม่รองรับการอ่านข้อมูล gzip แบบสตรีม');
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).json();
    }).catch(error => {
      compareAnalysisCache.delete(cacheKey);
      throw error;
    });
    compareAnalysisCache.set(cacheKey, request);
    return request;
  }

  async function loadSelectedCompareLines() {
    const selectedItems = (compareCatalogManifest?.items || []).filter(item => compareCatalogSelected.has(item.id));
    const box = document.getElementById('boxCompare');
    box?.classList.toggle('is-loading', selectedItems.length > 0);
    compareCatalogList?.setAttribute('aria-busy', String(selectedItems.length > 0));
    try {
      if (!selectedItems.length) return [];
      updateCompareCatalogSummary(`กำลังอ่าน ${selectedItems.length.toLocaleString('th-TH')} ชุดข้อมูลแบบ optimized…`);
      const payloads = [];
      for (let offset = 0; offset < selectedItems.length; offset += 3) {
        payloads.push(...await Promise.all(selectedItems.slice(offset, offset + 3).map(fetchCompareAnalysis)));
      }
      const lines = payloads.flatMap((payload, index) => (payload.lines || []).map(line => compactLineToApp(line, selectedItems[index])));
      updateCompareCatalogSummary(`${selectedItems.length.toLocaleString('th-TH')} ชุดข้อมูล · พร้อมวิเคราะห์ ${lines.length.toLocaleString('th-TH')} เส้น`);
      return lines;
    } catch (error) {
      updateCompareCatalogSummary('อ่านข้อมูล optimized ไม่สำเร็จ');
      toast(`อ่านข้อมูลเปรียบเทียบไม่สำเร็จ: ${error.message}`, 'error');
      throw error;
    } finally {
      box?.classList.remove('is-loading');
      compareCatalogList?.setAttribute('aria-busy', 'false');
    }
  }

  window.permissionOutCompareDatasetIds = [];
  window.permissionOutCompareDatasetNames = [];
  window.permissionOutLoadCompareLines = loadSelectedCompareLines;

  async function initializeCompareCatalog() {
    if (!compareCatalogList || !cloudEnabled) {
      updateCompareCatalogSummary(cloudEnabled ? 'ไม่พบส่วนแสดงรายการไฟล์' : 'ต้องเชื่อมต่อ Supabase');
      setDatasetHealth(ufmDatasetStatus, cloudEnabled ? 'ไม่พร้อม' : 'ออฟไลน์', 'error');
      return;
    }
    try {
      setDatasetHealth(ufmDatasetStatus, 'กำลังโหลด');
      const response = await fetch(`${ufmAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      manifest = mergeManagedCatalog(manifest, await managedCatalog('ufm'));
      compareCatalogManifest = manifest;
      renderCompareCatalog();
      updateCompareCatalogSummary();
      setDatasetHealth(ufmDatasetStatus, `${manifest.fileCount.toLocaleString('th-TH')} ชุด`, 'ready');
    } catch (error) {
      compareCatalogList.innerHTML = '<div class="base-catalog-empty">โหลดรายการไฟล์ไม่สำเร็จ</div>';
      updateCompareCatalogSummary('เชื่อมต่อคลังไฟล์ไม่ได้');
      setDatasetHealth(ufmDatasetStatus, 'เชื่อมต่อไม่ได้', 'error');
      toast(`โหลดรายการ UFM ไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  function activePeaTypes() {
    return new Set(Array.from(peaLayerTypes?.querySelectorAll('input:checked') || []).map(input => input.value));
  }

  function filteredPeaItems() {
    if (!peaManifest) return [];
    const query = peaLayerSearch?.value.trim().toLocaleLowerCase('th') || '';
    const types = activePeaTypes();
    return peaManifest.items.filter(item => {
      const typeMatch = !types.size || types.has(item.officeType);
      const textMatch = !query || `${item.name} ${item.officeType}`.toLocaleLowerCase('th').includes(query);
      return typeMatch && textMatch;
    });
  }

  function updatePeaSummary(message = '') {
    if (peaLayerCount) peaLayerCount.textContent = peaSelected.size.toLocaleString('th-TH');
    if (!peaLayerStatus) return;
    peaLayerStatus.textContent = message || (peaManifest
      ? `เลือก ${peaSelected.size.toLocaleString('th-TH')} จาก ${peaManifest.featureCount.toLocaleString('th-TH')} พื้นที่`
      : 'ยังไม่พบรายการข้อมูล');
  }

  function renderPeaOptions() {
    if (!peaLayerList) return;
    const items = filteredPeaItems();
    peaLayerList.innerHTML = '';
    if (!items.length) {
      peaLayerList.innerHTML = '<div class="pea-layer-empty">ไม่พบพื้นที่ที่ตรงกับตัวกรอง</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'pea-layer-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.id;
      input.checked = peaSelected.has(item.id);
      input.addEventListener('change', () => {
        if (input.checked) peaSelected.add(item.id); else peaSelected.delete(item.id);
        updatePeaSummary();
        schedulePeaMapUpdate(true);
      });
      const name = document.createElement('span'); name.textContent = item.name;
      const type = document.createElement('em'); type.textContent = item.officeType;
      label.append(input, name, type);
      fragment.appendChild(label);
    }
    peaLayerList.appendChild(fragment);
  }

  function clearPeaOverlay() {
    if (peaOverlayLayer && map) {
      try { map.removeLayer(peaOverlayLayer); } catch (_) { /* map may have been recreated */ }
    }
    peaOverlayLayer = null;
  }

  async function fetchPeaChunk(path) {
    if (peaChunkCache.has(path)) return peaChunkCache.get(path);
    const promise = fetch(peaAssetUrl(path)).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    peaChunkCache.set(path, promise);
    try { return await promise; }
    catch (error) { peaChunkCache.delete(path); throw error; }
  }

  function peaGridKey(lon, lat) {
    return `${Math.floor(lon / PEA_LOOKUP_CELL_DEG)}:${Math.floor(lat / PEA_LOOKUP_CELL_DEG)}`;
  }

  function buildPeaLookupGrid() {
    const grid = new Map();
    for (const item of peaManifest?.items || []) {
      const [minLon, minLat, maxLon, maxLat] = item.bbox || [];
      if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) continue;
      const minX = Math.floor(minLon / PEA_LOOKUP_CELL_DEG);
      const maxX = Math.floor(maxLon / PEA_LOOKUP_CELL_DEG);
      const minY = Math.floor(minLat / PEA_LOOKUP_CELL_DEG);
      const maxY = Math.floor(maxLat / PEA_LOOKUP_CELL_DEG);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(item);
        }
      }
    }
    peaLookupGrid = grid;
  }

  function peaCandidatesForPoint(point) {
    if (!peaLookupGrid) buildPeaLookupGrid();
    const [lon, lat] = point;
    return (peaLookupGrid?.get(peaGridKey(lon, lat)) || []).filter(item => {
      const [minLon, minLat, maxLon, maxLat] = item.bbox || [];
      return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
    });
  }

  function pointInRing(point, ring) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON)) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInPeaGeometry(point, geometry) {
    const inPolygon = polygon => polygon?.length > 0 &&
      pointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(point, ring));
    if (geometry?.type === 'Polygon') return inPolygon(geometry.coordinates);
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(inPolygon);
    return false;
  }

  function segmentSamplePoints(segment) {
    const coords = segment?.coords || [];
    if (!coords.length) return [];
    if (coords.length === 1) return [coords[0]];
    const samples = [coords[0]];
    const maxStepDegrees = 0.02;
    for (let i = 1; i < coords.length; i += 1) {
      const dx = coords[i][0] - coords[i - 1][0];
      const dy = coords[i][1] - coords[i - 1][1];
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStepDegrees));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        samples.push([
          coords[i - 1][0] + (dx * ratio),
          coords[i - 1][1] + (dy * ratio)
        ]);
      }
    }
    return samples;
  }

  async function resolvePeaAreasForSegments(segments) {
    if (!peaManifest) await initializePeaLayers();
    if (!peaManifest) throw new Error('PEA area manifest is unavailable');
    const unresolved = segments.filter(segment => !Array.isArray(segment._peaAreas));
    const jobs = unresolved.map(segment => ({
      segment,
      samples: segmentSamplePoints(segment).map(point => ({ point, candidates: peaCandidatesForPoint(point) }))
    }));
    const chunkPaths = [...new Set(jobs.flatMap(job => job.samples.flatMap(sample => sample.candidates.map(item => item.chunk))))];
    const chunks = await Promise.all(chunkPaths.map(fetchPeaChunk));
    const featureById = new Map(chunks.flatMap(chunk => chunk.features || []).map(feature => [
      String(feature.id || feature.properties?.pea_id), feature
    ]));
    for (const job of jobs) {
      const matches = new Map();
      for (const sample of job.samples) {
        for (const item of sample.candidates) {
          const feature = featureById.get(String(item.id));
          if (feature && pointInPeaGeometry(sample.point, feature.geometry)) {
            matches.set(String(item.id), {
              id: String(item.id),
              name: item.name || feature.properties?.name || '',
              officeType: item.officeType || feature.properties?.office_type || '',
              assignmentMethod: 'densified_point_in_polygon_0.02deg'
            });
          }
        }
      }
      job.segment._peaAreas = [...matches.values()];
    }
    return { resolvedSegments: unresolved.length, loadedChunks: chunkPaths.length };
  }

  window.permissionOutResolvePeaAreas = resolvePeaAreasForSegments;
  window.permissionOutPeaFeaturesForSegments = async segments => {
    await resolvePeaAreasForSegments(segments);
    const ids = new Set(segments.flatMap(segment => (segment._peaAreas || []).map(area => String(area.id))));
    const paths = [...new Set((peaManifest?.items || []).filter(item => ids.has(String(item.id))).map(item => item.chunk))];
    const chunks = await Promise.all(paths.map(fetchPeaChunk));
    return chunks.flatMap(chunk => chunk.features || []).filter(feature => ids.has(String(feature.id || feature.properties?.pea_id)));
  };

  async function updatePeaMap() {
    const version = ++peaRenderVersion;
    if (!peaSelected.size || !peaManifest) {
      clearPeaOverlay();
      peaShouldFocus = false;
      updatePeaSummary();
      return;
    }
    if (!map) initMap();
    const selectedItems = peaManifest.items.filter(item => peaSelected.has(item.id));
    const chunkPaths = [...new Set(selectedItems.map(item => item.chunk))];
    updatePeaSummary(`กำลังโหลด ${peaSelected.size.toLocaleString('th-TH')} พื้นที่…`);
    try {
      const chunks = await Promise.all(chunkPaths.map(fetchPeaChunk));
      if (version !== peaRenderVersion) return;
      const features = chunks.flatMap(chunk => chunk.features || []).filter(feature => peaSelected.has(feature.id || feature.properties?.pea_id));
      clearPeaOverlay();
      peaOverlayLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
        style: { color: '#6d4bb4', fillColor: '#8b5cf6', fillOpacity: 0.13, opacity: 0.9, weight: 1.7 },
        onEachFeature(feature, layer) {
          const name = escapeHtml(feature.properties?.name || 'พื้นที่ PEA');
          const type = escapeHtml(feature.properties?.office_type || '');
          layer.bindPopup(`<strong>${name}</strong>${type ? `<br><span>${type}</span>` : ''}`);
          layer.bindTooltip(name, { sticky: true, direction: 'top' });
        }
      }).addTo(map);
      if (peaShouldFocus) {
        const bounds = peaOverlayLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 });
      }
      peaShouldFocus = false;
      updatePeaSummary(`แสดง ${features.length.toLocaleString('th-TH')} พื้นที่ · โหลด ${chunkPaths.length} ชุดข้อมูล`);
    } catch (error) {
      if (version !== peaRenderVersion) return;
      peaShouldFocus = false;
      updatePeaSummary(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
      toast(`โหลดพื้นที่ PEA ไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  function schedulePeaMapUpdate(focus = false) {
    if (focus) peaShouldFocus = true;
    clearTimeout(peaRenderTimer);
    peaRenderTimer = setTimeout(updatePeaMap, 120);
  }

  async function initializePeaLayers() {
    if (!peaLayerTrigger || !cfg.supabaseUrl) return;
    peaLayerTrigger.disabled = true;
    updatePeaSummary('กำลังโหลดรายการจาก Supabase…');
    try {
      const response = await fetch(peaAssetUrl('manifest.json'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      peaManifest = await response.json();
      buildPeaLookupGrid();
      peaLayerTypes.innerHTML = '';
      for (const [type, count] of Object.entries(peaManifest.typeCounts || {})) {
        const label = document.createElement('label'); label.className = 'pea-type-filter';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = type; input.checked = true;
        input.addEventListener('change', renderPeaOptions);
        const text = document.createElement('span'); text.textContent = `${type} ${Number(count).toLocaleString('th-TH')}`;
        label.append(input, text); peaLayerTypes.appendChild(label);
      }
      renderPeaOptions(); updatePeaSummary();
    } catch (error) {
      updatePeaSummary(`โหลดรายการไม่สำเร็จ: ${error.message}`);
    } finally { peaLayerTrigger.disabled = false; }
  }

  async function initializeBillingFormula() {
    if (!client) return;
    try {
      const { data, error } = await client.rpc('get_active_billing_formula', { p_code: 'permission_fee' });
      if (error) throw error;
      const formula = Array.isArray(data) ? data[0] : data;
      if (formula) window.permissionOutBillingFormula = { ...formula, source: 'supabase' };
    } catch (error) {
      console.warn('Using local billing formula fallback:', error.message);
    }
  }

  function openModal(title, subtitle, content, wide = false, locked = false) {
    modalLocked = Boolean(locked);
    document.getElementById('appModalTitle').textContent = title;
    document.getElementById('appModalSubtitle').textContent = subtitle || '';
    const body = document.getElementById('appModalBody');
    body.innerHTML = '';
    if (typeof content === 'string') body.innerHTML = content;
    else if (content) body.appendChild(content);
    modalRoot.querySelector('.app-modal').classList.toggle('app-modal-wide', wide);
    modalRoot.classList.toggle('is-locked', modalLocked);
    modalRoot.classList.add('is-open');
    setTimeout(() => body.querySelector('input,button')?.focus(), 20);
  }

  function closeModal(force = false) {
    if (modalLocked && !force) return;
    modalLocked = false;
    modalRoot.classList.remove('is-open', 'is-locked');
  }
  modalRoot.querySelector('.modal-close').addEventListener('click', () => closeModal());
  modalRoot.addEventListener('mousedown', e => { if (e.target === modalRoot) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function markDirty() {
    dirty = true;
  }

  function numeric(id, fallback = 0) {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function snapshot() {
    const cleanSegments = (state?.segmentsB || []).map(seg => {
      const copy = { ...seg };
      delete copy._mapLayer;
      delete copy._mapBounds;
      return copy;
    });
    const totalCostText = document.getElementById('costTotalBig')?.textContent || '0';
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      settings: {
        threshold: numeric('threshold', 20), interval: numeric('interval', 5),
        polesPerKm: numeric('polesPerKm', 29), rateB: numeric('rateB', 2.8),
        surchargePct: numeric('surchargePct', 5), dedupe: Boolean(document.getElementById('dedupeToggle')?.checked),
        sourceRolesSwapped: window.permissionOutRolesSwapped === true
      },
      sourceFiles: {
        base: window.permissionOutRolesSwapped === true
          ? (compareCatalogManifest?.items || []).filter(item => compareCatalogSelected.has(item.id)).map(item => item.name)
          : (baseCatalogManifest?.items || []).filter(item => baseCatalogSelected.has(item.id)).map(item => item.name),
        compare: window.permissionOutRolesSwapped === true
          ? (baseCatalogManifest?.items || []).filter(item => baseCatalogSelected.has(item.id)).map(item => item.name)
          : (compareCatalogManifest?.items || []).filter(item => compareCatalogSelected.has(item.id)).map(item => item.name)
      },
      result: {
        totalA: state?.totalA || 0, totalB: state?.totalB || 0,
        nonOverlapB: state?.nonOverlapB || 0, newLen: state?.newLen || 0,
        removeLen: state?.removeLen || 0, removedA: state?.removedA || 0,
        removedB: state?.removedB || 0, segmentsB: cleanSegments,
        totalCost: Number(totalCostText.replace(/,/g, '')) || 0,
        meta: document.getElementById('execMeta')?.textContent || ''
      }
    };
  }

  function projectSummary(data) {
    const segments = data?.result?.segmentsB || [];
    return {
      segmentCount: segments.length,
      totalA: data?.result?.totalA || 0,
      totalB: data?.result?.totalB || 0,
      newLen: data?.result?.newLen || 0,
      removeLen: data?.result?.removeLen || 0,
      totalCost: data?.result?.totalCost || 0,
      sourceFiles: data?.sourceFiles || { base: [], compare: [] }
    };
  }

  function applyValue(id, value) { const el = document.getElementById(id); if (el && value !== undefined) el.value = value; }

  function restoreSnapshot(data) {
    if (!data?.result) throw new Error('รูปแบบข้อมูลโครงการไม่ถูกต้อง');
    clearAll();
    const s = data.settings || {};
    applyValue('threshold', s.threshold); applyValue('interval', s.interval);
    applyValue('polesPerKm', s.polesPerKm); applyValue('rateB', s.rateB);
    applyValue('surchargePct', s.surchargePct);
    if (document.getElementById('dedupeToggle')) document.getElementById('dedupeToggle').checked = Boolean(s.dedupe);
    window.permissionOutRolesSwapped = Boolean(s.sourceRolesSwapped);
    if (typeof updateSourceRoleUI === 'function') updateSourceRoleUI();
    state = {
      totalA: data.result.totalA || 0, totalB: data.result.totalB || 0,
      nonOverlapB: data.result.nonOverlapB || 0, newLen: data.result.newLen || 0,
      removeLen: data.result.removeLen || 0, removedA: data.result.removedA || 0,
      removedB: data.result.removedB || 0, segmentsB: data.result.segmentsB || []
    };
    document.getElementById('statTotalA').textContent = fmtKm(state.totalA);
    document.getElementById('statTotalB').textContent = fmtKm(state.totalB);
    document.getElementById('statOverlap').textContent = fmtKm(state.removeLen);
    document.getElementById('statNonB').textContent = fmtKm(state.newLen);
    document.getElementById('execMeta').textContent = data.result.meta || `เปิดข้อมูลที่บันทึกเมื่อ ${new Date(data.savedAt).toLocaleString('th-TH')}`;
    drawResults({ segments: state.segmentsB });
    buildReportTable(); recomputeAll(); populateProvinceFilter(); populateCableStatusFilter(); applyProvinceFilter();
    document.getElementById('results').style.display = 'block';
    document.getElementById('reportCard').style.display = 'block';
    document.getElementById('mapStatus').textContent = 'ข้อมูลจากโครงการที่บันทึกไว้ — คลิกเส้นเพื่อดูรายละเอียด';
    document.getElementById('costStatus').textContent = `เปิดผลวิเคราะห์ที่บันทึกไว้ ${state.segmentsB.length.toLocaleString('th-TH')} ช่วง`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function localProjects() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch { return []; }
  }

  function writeLocalProjects(items) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); }
    catch (error) { throw new Error(error.name === 'QuotaExceededError' ? 'ข้อมูลมีขนาดใหญ่เกินพื้นที่เก็บข้อมูลในเบราว์เซอร์ กรุณาเชื่อมต่อ Supabase' : error.message); }
  }

  async function fetchProjects() {
    if (client && currentUser) {
      const { data, error } = await client.from('projects').select('id,name,updated_at,summary').order('updated_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    }
    return localProjects().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  async function saveProject(silent = false) {
    if (!state?.segmentsB?.length) {
      if (!silent) toast('กรุณาวิเคราะห์เส้นทางก่อนบันทึก', 'error');
      return;
    }
    const name = titleInput?.value.trim() || 'MOD 1';
    setSaveState('กำลังบันทึก…', 'saving');
    try {
      const data = snapshot();
      if (client && currentUser) {
        const summary = projectSummary(data);
        const payload = { name, snapshot: data, summary, owner_id: currentUser.id, updated_at: new Date().toISOString() };
        let response;
        if (currentProjectId) response = await client.from('projects').update(payload).eq('id', currentProjectId).select('id').single();
        else response = await client.from('projects').insert(payload).select('id').single();
        if (response.error) throw response.error;
        currentProjectId = response.data.id;
        const historyResponse = await client.from('analysis_runs').insert({ project_id: currentProjectId, owner_id: currentUser.id, summary, settings: data.settings });
        if (historyResponse.error) console.warn('Analysis history was not recorded:', historyResponse.error.message);
      } else {
        const items = localProjects();
        const id = currentProjectId || (crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}`);
        const record = { id, name, updated_at: new Date().toISOString(), snapshot: data };
        const index = items.findIndex(item => item.id === id);
        if (index >= 0) items[index] = record; else items.unshift(record);
        writeLocalProjects(items.slice(0, 20));
        currentProjectId = id;
      }
      dirty = false;
      setSaveState('บันทึกแล้ว', 'saved');
      if (!silent) toast(cloudEnabled && currentUser ? 'บันทึกขึ้น Cloud แล้ว' : 'บันทึกในอุปกรณ์แล้ว', 'success');
    } catch (error) {
      setSaveState('บันทึกไม่สำเร็จ', 'dirty');
      if (!silent) toast(`บันทึกไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  async function deleteProject(id) {
    if (!confirm('ต้องการลบโครงการนี้หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) return;
    try {
      if (client && currentUser) {
        const { error } = await client.from('projects').delete().eq('id', id);
        if (error) throw error;
      } else writeLocalProjects(localProjects().filter(item => item.id !== id));
      if (currentProjectId === id) currentProjectId = null;
      toast('ลบโครงการแล้ว', 'success');
      showProjects();
    } catch (error) { toast(`ลบไม่สำเร็จ: ${error.message}`, 'error'); }
  }

  async function openProject(id) {
    try {
      let project;
      if (client && currentUser) {
        const response = await client.from('projects').select('id,name,updated_at,snapshot').eq('id', id).single();
        if (response.error) throw response.error;
        project = response.data;
      } else project = localProjects().find(item => item.id === id);
      if (!project) throw new Error('ไม่พบโครงการ');
      restoreSnapshot(project.snapshot);
      if (titleInput) titleInput.value = project.name;
      currentProjectId = project.id;
      dirty = false; setSaveState('บันทึกแล้ว', 'saved'); closeModal();
      toast('เปิดโครงการแล้ว', 'success');
    } catch (error) { toast(`เปิดโครงการไม่สำเร็จ: ${error.message}`, 'error'); }
  }

  function makeProjectList(projects) {
    const wrap = document.createElement('div');
    wrap.className = 'project-list';
    if (!projects.length) {
      wrap.innerHTML = '<div class="project-empty">ยังไม่มีโครงการที่บันทึก<br><small>วิเคราะห์เส้นทางแล้วกด “บันทึก” เพื่อเริ่มต้น</small></div>';
      return wrap;
    }
    projects.forEach(project => {
      const item = document.createElement('article'); item.className = 'project-item';
      const info = document.createElement('div');
      const heading = document.createElement('h3'); heading.textContent = project.name;
      const meta = document.createElement('p');
      const count = project.summary?.segmentCount ?? project.snapshot?.result?.segmentsB?.length ?? 0;
      meta.textContent = `อัปเดต ${new Date(project.updated_at).toLocaleString('th-TH')} · ${count.toLocaleString('th-TH')} ช่วง`;
      info.append(heading, meta);
      const actions = document.createElement('div'); actions.className = 'project-item-actions';
      const open = document.createElement('button'); open.className = 'project-open'; open.textContent = 'เปิด'; open.addEventListener('click', () => openProject(project.id));
      const del = document.createElement('button'); del.className = 'project-delete'; del.textContent = 'ลบ'; del.addEventListener('click', () => deleteProject(project.id));
      actions.append(open, del); item.append(info, actions); wrap.appendChild(item);
    });
    return wrap;
  }

  async function showProjects() {
    openModal('โครงการของฉัน', cloudEnabled && currentUser ? 'ซิงก์กับ Supabase และเข้าถึงได้จากทุกอุปกรณ์' : 'จัดเก็บในเบราว์เซอร์เครื่องนี้', '<div class="project-empty">กำลังโหลด…</div>', true);
    try { document.getElementById('appModalBody').replaceChildren(makeProjectList(await fetchProjects())); }
    catch (error) { document.getElementById('appModalBody').innerHTML = `<div class="project-empty">โหลดข้อมูลไม่สำเร็จ<br><small>${error.message}</small></div>`; }
  }

  async function loadCurrentProfile(user = currentUser) {
    if (!client || !user) {
      currentProfile = null;
      return null;
    }
    let result = await client
      .from('profiles')
      .select('id,display_name,organization,role,is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (result.error && (result.error.code === '42703' || /role|is_active/i.test(result.error.message || ''))) {
      result = await client
        .from('profiles')
        .select('id,display_name,organization')
        .eq('id', user.id)
        .maybeSingle();
    }
    if (result.error) throw result.error;
    const data = result.data || {};
    const metadata = user.app_metadata || {};
    const role = metadata.permission_out_role || data.role || 'user';
    const isActive = metadata.permission_out_active === undefined
      ? data.is_active !== false
      : metadata.permission_out_active !== false;
    if (!isActive) throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    currentProfile = {
      id: user.id,
      display_name: data.display_name || user.user_metadata?.display_name || '',
      organization: data.organization || user.user_metadata?.organization || '',
      role: role === 'admin' ? 'admin' : 'user',
      is_active: true
    };
    return currentProfile;
  }

  async function applySession(session, { showGate = true } = {}) {
    currentUser = session?.user || null;
    currentProfile = null;
    currentProjectId = null;
    if (currentUser) {
      try {
        await loadCurrentProfile(currentUser);
      } catch (error) {
        await client.auth.signOut({ scope: 'local' });
        currentUser = null;
        currentProfile = null;
        updateAccountUI();
        setSaveState('ไม่สามารถเข้าสู่ระบบได้', 'dirty');
        if (showGate) showAuth(error.message);
        return false;
      }
    }
    updateAccountUI();
    setSaveState(currentUser ? 'Cloud พร้อมใช้งาน' : 'กรุณาเข้าสู่ระบบ', currentUser ? 'saved' : 'dirty');
    if (!currentUser && showGate && cloudRequired) showAuth();
    return Boolean(currentUser);
  }

  function authErrorMessage(error) {
    const message = String(error?.message || '');
    if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (/email not confirmed/i.test(message)) return 'อีเมลยังไม่ได้รับการยืนยัน';
    if (/user is banned/i.test(message)) return 'บัญชีนี้ถูกระงับการใช้งาน';
    if (/rate limit/i.test(message)) return 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่';
    return message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';
  }

  function showAuth(initialError = '') {
    const content = document.createElement('div');
    content.className = 'login-panel';
    content.innerHTML = `
      <div class="login-brand" aria-hidden="true">PO</div>
      <div class="auth-note">เข้าสู่ระบบด้วยบัญชีที่ผู้ดูแลสร้างให้ เพื่อใช้งานและบันทึกโครงการบน Supabase อย่างปลอดภัย</div>
      <form id="authForm" novalidate>
        <div class="modal-field">
          <label for="authEmail">อีเมล</label>
          <input id="authEmail" type="email" autocomplete="username" required maxlength="254" placeholder="name@company.com">
        </div>
        <div class="modal-field">
          <label for="authPassword">รหัสผ่าน</label>
          <div class="password-field">
            <input id="authPassword" type="password" autocomplete="current-password" required minlength="8" maxlength="128" placeholder="กรอกรหัสผ่าน">
            <button type="button" id="toggleAuthPassword" aria-label="แสดงรหัสผ่าน">แสดง</button>
          </div>
        </div>
        <div class="auth-inline-error" id="authError" role="alert">${escapeHtml(initialError)}</div>
        <button class="modal-primary" id="authSubmit" type="submit">เข้าสู่ระบบ</button>
        <button class="modal-link" id="resetPassword" type="button">ลืมรหัสผ่าน</button>
      </form>
      <p class="login-help">ยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบของหน่วยงาน</p>`;
    const errorBox = content.querySelector('#authError');
    content.querySelector('#toggleAuthPassword').addEventListener('click', event => {
      const password = content.querySelector('#authPassword');
      const visible = password.type === 'text';
      password.type = visible ? 'password' : 'text';
      event.currentTarget.textContent = visible ? 'แสดง' : 'ซ่อน';
      event.currentTarget.setAttribute('aria-label', visible ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน');
    });
    content.querySelector('#authForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!client) return;
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const email = content.querySelector('#authEmail').value.trim();
      const password = content.querySelector('#authPassword').value;
      const button = content.querySelector('#authSubmit');
      button.disabled = true;
      button.textContent = 'กำลังเข้าสู่ระบบ…';
      errorBox.textContent = '';
      const response = await client.auth.signInWithPassword({ email, password });
      if (response.error) {
        errorBox.textContent = authErrorMessage(response.error);
        button.disabled = false;
        button.textContent = 'เข้าสู่ระบบ';
        return;
      }
      const accepted = await applySession(response.data.session, { showGate: false });
      button.disabled = false;
      button.textContent = 'เข้าสู่ระบบ';
      if (!accepted) {
        errorBox.textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
        return;
      }
      closeModal(true);
      toast('เข้าสู่ระบบสำเร็จ', 'success');
    });
    content.querySelector('#resetPassword').addEventListener('click', async () => {
      const email = content.querySelector('#authEmail').value.trim();
      if (!email) {
        errorBox.textContent = 'กรุณากรอกอีเมลก่อนขอลิงก์ตั้งรหัสผ่านใหม่';
        content.querySelector('#authEmail').focus();
        return;
      }
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (error) errorBox.textContent = authErrorMessage(error);
      else toast('ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาตรวจสอบอีเมล', 'success');
    });
    openModal('เข้าสู่ระบบ Permission Out', 'ระบบวิเคราะห์เส้นทางสำหรับผู้ได้รับอนุญาต', content, false, cloudRequired);
  }

  function updateAccountUI() {
    const label = document.getElementById('accountLabel');
    const meta = document.getElementById('accountMeta');
    const initial = document.getElementById('userInitial');
    const accountButton = document.getElementById('accountBtn');
    if (currentUser) {
      label.textContent = currentProfile?.display_name || currentUser.email?.split('@')[0] || 'Account';
      if (meta) meta.textContent = currentProfile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
      initial.textContent = (currentUser.email?.[0] || 'U').toUpperCase();
      accountButton?.setAttribute('aria-label', `เปิดบัญชีผู้ใช้ ${label.textContent}`);
    } else {
      label.textContent = cloudEnabled ? 'เข้าสู่ระบบ' : 'Local';
      if (meta) meta.textContent = cloudEnabled ? 'ยังไม่เข้าสู่ระบบ' : 'โหมด Local';
      initial.textContent = cloudEnabled ? 'G' : 'L';
      accountButton?.setAttribute('aria-label', cloudEnabled ? 'เข้าสู่ระบบ' : 'เปิดข้อมูลโหมด Local');
    }
  }

  function showConfigurationRequired() {
    const content = document.createElement('div');
    content.innerHTML = '<div class="auth-note" style="background:#fff4df;color:#744f08">Production workspace นี้กำหนดให้ใช้ Supabase แต่ยังไม่พบ Project URL หรือ Publishable Key กรุณาตั้งค่า Variables and Secrets ที่ Cloudflare Worker แล้ว deploy ใหม่</div><div class="modal-field"><label>Environment Variables ที่ต้องมี</label><input value="SUPABASE_URL" readonly><input value="SUPABASE_PUBLISHABLE_KEY" readonly></div>';
    openModal('ต้องตั้งค่า Supabase', 'ระบบ Cloud ยังไม่พร้อมใช้งาน', content);
  }

  function showAccount() {
    if (cloudRequired && !cloudEnabled) { showConfigurationRequired(); return; }
    if (!currentUser) { showAuth(); return; }
    const content = document.createElement('div'); content.className = 'account-card';
    const avatar = document.createElement('div'); avatar.className = 'account-avatar'; avatar.textContent = (currentUser.email?.[0] || 'U').toUpperCase();
    const name = document.createElement('h3'); name.textContent = currentUser.email;
    const info = document.createElement('p');
    const roleLabel = currentProfile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
    info.innerHTML = `<span class="connection-pill">เชื่อมต่อ Supabase แล้ว</span><br><span class="account-role">${roleLabel}${currentProfile?.organization ? ` · ${escapeHtml(currentProfile.organization)}` : ''}</span>`;
    const actions = document.createElement('div'); actions.className = 'account-actions';
    if (currentProfile?.role === 'admin') {
      const manageData = document.createElement('button');
      manageData.className = 'modal-primary';
      manageData.type = 'button';
      manageData.textContent = 'จัดการข้อมูล PEA / UFM';
      manageData.addEventListener('click', () => window.permissionOutOpenAdminData?.());
      const manageUsers = document.createElement('button');
      manageUsers.className = 'modal-primary';
      manageUsers.type = 'button';
      manageUsers.textContent = 'จัดการผู้ใช้';
      manageUsers.addEventListener('click', () => window.permissionOutOpenAdminUsers?.());
      actions.append(manageData, manageUsers);
    }
    const signout = document.createElement('button'); signout.className = 'danger-btn'; signout.textContent = 'ออกจากระบบ';
    signout.addEventListener('click', async () => {
      await client.auth.signOut();
      closeModal(true);
      toast('ออกจากระบบแล้ว');
      showAuth();
    });
    actions.appendChild(signout);
    content.append(avatar, name, info, actions);
    openModal('บัญชีผู้ใช้', 'จัดการเซสชันและสิทธิ์การใช้งาน', content);
  }

  window.permissionOutAdminContext = {
    client,
    getCurrentUser: () => currentUser,
    getCurrentProfile: () => currentProfile,
    openModal,
    closeModal,
    toast,
    escapeHtml
  };

  function newProject() {
    if (dirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการเริ่มงานใหม่หรือไม่?')) return;
    clearAll(); currentProjectId = null; dirty = false;
    if (titleInput) titleInput.value = `MOD 1 ${new Date().toLocaleDateString('th-TH')}`;
    setSaveState('พร้อมใช้งาน'); toast('สร้างพื้นที่งานใหม่แล้ว');
  }

  titleInput?.addEventListener('input', markDirty);
  ['threshold','interval','polesPerKm','rateB','surchargePct','dedupeToggle'].forEach(id => document.getElementById(id)?.addEventListener('change', markDirty));
  const debounceUi = (callback, delay = 140) => {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  };
  document.getElementById('saveProjectBtn')?.addEventListener('click', () => saveProject(false));
  document.getElementById('projectsBtn')?.addEventListener('click', showProjects);
  document.getElementById('newProjectBtn')?.addEventListener('click', newProject);
  document.getElementById('accountBtn').addEventListener('click', showAccount);
  baseCatalogSearch?.addEventListener('input', debounceUi(renderBaseCatalog));
  compareCatalogSearch?.addEventListener('input', debounceUi(renderCompareCatalog));
  document.getElementById('baseCatalogSelectAll')?.addEventListener('click', () => {
    for (const item of filteredBaseCatalogItems()) baseCatalogSelected.add(item.id);
    window.permissionOutBaseDatasetIds = Array.from(baseCatalogSelected);
    window.permissionOutBaseDatasetNames = (baseCatalogManifest?.items || []).filter(item => baseCatalogSelected.has(item.id)).map(item => item.name);
    renderBaseCatalog(); updateBaseCatalogSummary();
  });
  document.getElementById('baseCatalogClear')?.addEventListener('click', () => {
    baseCatalogSelected.clear(); window.permissionOutBaseDatasetIds = []; window.permissionOutBaseDatasetNames = [];
    renderBaseCatalog(); updateBaseCatalogSummary();
  });
  document.getElementById('compareCatalogSelectAll')?.addEventListener('click', () => {
    for (const item of filteredCompareCatalogItems()) compareCatalogSelected.add(item.id);
    syncCompareSelection(); renderCompareCatalog(); updateCompareCatalogSummary();
  });
  document.getElementById('compareCatalogClear')?.addEventListener('click', () => {
    compareCatalogSelected.clear(); syncCompareSelection(); renderCompareCatalog(); updateCompareCatalogSummary();
  });
  window.addEventListener('permissionout:cleared', () => {
    baseCatalogSelected.clear(); window.permissionOutBaseDatasetIds = []; window.permissionOutBaseDatasetNames = [];
    if (baseCatalogSearch) baseCatalogSearch.value = '';
    renderBaseCatalog(); updateBaseCatalogSummary();
    compareCatalogSelected.clear(); syncCompareSelection();
    if (compareCatalogSearch) compareCatalogSearch.value = '';
    renderCompareCatalog(); updateCompareCatalogSummary();
  });
  peaLayerTrigger?.addEventListener('click', () => {
    const open = peaLayerPanel.hidden;
    peaLayerPanel.hidden = !open;
    peaLayerTrigger.setAttribute('aria-expanded', String(open));
    if (open) peaLayerSearch?.focus();
  });
  peaLayerSearch?.addEventListener('input', debounceUi(renderPeaOptions));
  document.getElementById('peaLayerClear')?.addEventListener('click', () => {
    peaLayerSearch.value = ''; renderPeaOptions(); peaLayerSearch.focus();
  });
  document.getElementById('peaLayerSelectVisible')?.addEventListener('click', () => {
    for (const item of filteredPeaItems()) peaSelected.add(item.id);
    renderPeaOptions(); updatePeaSummary(); schedulePeaMapUpdate(true);
  });
  document.getElementById('peaLayerClearAll')?.addEventListener('click', () => {
    peaSelected.clear(); renderPeaOptions(); updatePeaSummary(); schedulePeaMapUpdate();
  });
  document.addEventListener('click', event => {
    const control = document.getElementById('peaLayerControl');
    if (control && !control.contains(event.target) && !peaLayerPanel.hidden) {
      peaLayerPanel.hidden = true; peaLayerTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  window.addEventListener('permissionout:map-ready', () => {
    peaOverlayLayer = null;
    if (peaSelected.size) schedulePeaMapUpdate();
  });
  window.addEventListener('permissionout:analysis-complete', () => { markDirty(); toast('วิเคราะห์เสร็จแล้ว พร้อมตรวจสอบและส่งออกข้อมูล', 'success'); });
  window.addEventListener('online', () => toast('กลับมาออนไลน์แล้ว', 'success'));
  window.addEventListener('offline', () => toast('ออฟไลน์ — ต้องเชื่อมต่ออีกครั้งเพื่ออ่านชุดข้อมูลจาก Supabase'));

  async function initialize() {
    if (client) {
      const { data } = await client.auth.getSession();
      await applySession(data.session, { showGate: false });
      client.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => applySession(session, { showGate: true }).catch(error => {
          toast(authErrorMessage(error), 'error');
        }), 0);
      });
    } else {
      updateAccountUI(); setSaveState('Local mode');
      if (cloudRequired && location.protocol !== 'file:') {
        setSaveState('ต้องตั้งค่า Supabase', 'dirty');
        if (document.getElementById('saveProjectBtn')) document.getElementById('saveProjectBtn').disabled = true;
        if (document.getElementById('projectsBtn')) document.getElementById('projectsBtn').disabled = true;
        showConfigurationRequired();
      }
    }
    await Promise.all([initializePeaLayers(), initializeBaseCatalog(), initializeCompareCatalog(), initializeBillingFormula()]);
    if (client && !currentUser && cloudRequired) showAuth();
  }
  initialize().catch(error => { updateAccountUI(); toast(`เริ่มระบบ Cloud ไม่สำเร็จ: ${error.message}`, 'error'); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
