(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const cloudEnabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
  const cloudRequired = cfg.requireSupabase !== false;
  const client = cloudEnabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      storage: window.sessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
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
  const MODULE_KEYS = ['mod1', 'mod2'];
  const peaLayerTrigger = document.getElementById('peaLayerTrigger');
  const peaLayerPanel = document.getElementById('peaLayerPanel');
  const peaLayerStatus = document.getElementById('peaLayerStatus');
  const peaLayerCount = document.getElementById('peaLayerCount');
  const peaLayerSearch = document.getElementById('peaLayerSearch');
  const peaLayerList = document.getElementById('peaLayerList');
  const peaLayerTypes = document.getElementById('peaLayerTypes');
  const peaSelected = new Set();
  let peaScopeOfficeId = '';
  function activePeaSelection() {
    const ids = new Set(Array.from(peaSelected, String));
    if (peaScopeOfficeId) ids.add(peaScopeOfficeId);
    return ids;
  }
  const peaChunkCache = new Map();
  let peaManifest = null;
  let peaLookupGrid = null;
  const PEA_LOOKUP_CELL_DEG = 0.25;
  let peaOverlayLayer = null;
  let peaRenderTimer = null;
  let peaRenderVersion = 0;
  let peaShouldFocus = false;
  const osmRoadToggle = document.getElementById('osmRoadToggle');
  const osmBuildingToggle = document.getElementById('osmBuildingToggle');
  const osmReferenceStatus = document.getElementById('osmReferenceStatus');
  let osmReferenceLayer = null;
  let osmReferenceTimer = null;
  window.permissionOutReferenceFeatures = [];
  const baseFileInput = document.getElementById('fileBase');
  const baseCatalogList = document.getElementById('baseCatalogList');
  const baseCatalogSearch = document.getElementById('baseCatalogSearch');
  const baseCatalogStatus = document.getElementById('baseCatalogStatus');
  const baseCatalogCount = document.getElementById('baseCatalogCount');
  const baseCatalogSelected = new Set();
  const peaCompareCatalogSelected = new Set();
  const baseAnalysisCache = new Map();
  let baseCatalogManifest = null;
  let baseCatalogIndex = new Map();
  let baseCatalogRenderLimit = 120;
  const compareCatalogList = document.getElementById('compareCatalogList');
  const compareCatalogSearch = document.getElementById('compareCatalogSearch');
  const compareCatalogStatus = document.getElementById('compareCatalogStatus');
  const compareCatalogCount = document.getElementById('compareCatalogCount');
  const compareCatalogSelected = new Set();
  const ufmBaseCatalogSelected = new Set();
  const compareAnalysisCache = new Map();
  let compareCatalogManifest = null;
  let compareCatalogIndex = new Map();
  let compareCatalogRenderLimit = 120;
  const CATALOG_RENDER_PAGE_SIZE = 120;
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
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `/api/data/assets/pea-area/v1/${encoded}`;
  }

  function uihAssetUrl(path) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `/api/data/assets/uih-20072026/v1/${encoded}`;
  }

  function ufmAssetUrl(path) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    return `/api/data/assets/ufm/v1/${encoded}`;
  }

  async function authenticatedFetch(path, options = {}) {
    if (!client) throw new Error('ต้องเชื่อมต่อ Supabase');
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...options, headers });
  }

  async function authenticatedJson(path, options = {}) {
    const response = await authenticatedFetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return payload;
  }

  async function updateOsmReferenceLayer() {
    if (!window.L || typeof map === 'undefined' || !map) return;
    const types = [osmRoadToggle?.checked ? 'road' : '', osmBuildingToggle?.checked ? 'building' : ''].filter(Boolean);
    if (osmReferenceLayer) {
      map.removeLayer(osmReferenceLayer);
      osmReferenceLayer = null;
    }
    if (!types.length) {
      window.permissionOutReferenceFeatures = [];
      window.dispatchEvent(new CustomEvent('permissionout:reference-data', { detail: { features: [] } }));
      if (osmReferenceStatus) osmReferenceStatus.textContent = 'ข้อมูลจากคลังภายใน';
      return;
    }
    const bounds = map.getBounds();
    const west = bounds.getWest(), south = bounds.getSouth(), east = bounds.getEast(), north = bounds.getNorth();
    if (east - west > 0.5 || north - south > 0.5) {
      if (osmReferenceStatus) osmReferenceStatus.textContent = 'ซูมเข้าเพื่อโหลดข้อมูลอ้างอิง';
      return;
    }
    if (osmReferenceStatus) osmReferenceStatus.textContent = 'กำลังโหลดข้อมูลอ้างอิง…';
    try {
      const data = await authenticatedJson(`/api/data/reference?bbox=${[west, south, east, north].map(value => value.toFixed(6)).join(',')}&types=${types.join(',')}&limit=25000`);
      osmReferenceLayer = L.geoJSON(data, {
        style: feature => feature.properties?.reference_type === 'building'
          ? { color: '#8B5E3C', weight: 1, fillColor: '#D9B38C', fillOpacity: 0.22 }
          : { color: '#64748B', weight: 2.5, opacity: 0.75 },
        interactive: false
      }).addTo(map);
      const count = Array.isArray(data.features) ? data.features.length : 0;
      window.permissionOutReferenceFeatures = Array.isArray(data.features) ? data.features : [];
      window.dispatchEvent(new CustomEvent('permissionout:reference-data', { detail: { features: window.permissionOutReferenceFeatures } }));
      if (osmReferenceStatus) osmReferenceStatus.textContent = `${count.toLocaleString('th-TH')} รายการ · คลังภายใน`;
    } catch (error) {
      if (osmReferenceStatus) osmReferenceStatus.textContent = `โหลดข้อมูลอ้างอิงไม่สำเร็จ: ${error.message}`;
    }
  }

  function scheduleOsmReferenceUpdate() {
    clearTimeout(osmReferenceTimer);
    osmReferenceTimer = setTimeout(updateOsmReferenceLayer, 180);
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

  function selectedCatalogItems(manifest, selected) {
    const index = manifest === baseCatalogManifest ? baseCatalogIndex : compareCatalogIndex;
    if (index.size) return [...selected].map(id => index.get(id)).filter(Boolean);
    return (manifest?.items || []).filter(item => selected.has(item.id));
  }

  function syncLogicalDatasetSelections() {
    const peaBase = selectedCatalogItems(baseCatalogManifest, baseCatalogSelected);
    const peaCompare = selectedCatalogItems(baseCatalogManifest, peaCompareCatalogSelected);
    const ufmBase = selectedCatalogItems(compareCatalogManifest, ufmBaseCatalogSelected);
    const ufmCompare = selectedCatalogItems(compareCatalogManifest, compareCatalogSelected);
    window.permissionOutBaseDatasetIds = [
      ...peaBase.map(item => `pea:${item.id}`),
      ...ufmBase.map(item => `ufm:${item.id}`)
    ];
    window.permissionOutCompareDatasetIds = [
      ...peaCompare.map(item => `pea:${item.id}`),
      ...ufmCompare.map(item => `ufm:${item.id}`)
    ];
    window.permissionOutBaseDatasetNames = [
      ...peaBase.map(item => `PEA · ${item.name}`),
      ...ufmBase.map(item => `UFM · ${item.name}`)
    ];
    window.permissionOutCompareDatasetNames = [
      ...peaCompare.map(item => `PEA · ${item.name}`),
      ...ufmCompare.map(item => `UFM · ${item.name}`)
    ];
    if (typeof updateSourceRoleUI === 'function') updateSourceRoleUI();
  }

  function updateBaseCatalogSummary(message = '') {
    const selectedCount = baseCatalogSelected.size + peaCompareCatalogSelected.size;
    if (baseCatalogCount) baseCatalogCount.textContent = selectedCount.toLocaleString('th-TH');
    if (!baseCatalogStatus) return;
    const selectedLines = baseCatalogManifest?.items
      .filter(item => baseCatalogSelected.has(item.id) || peaCompareCatalogSelected.has(item.id))
      .reduce((sum, item) => sum + (item.lineCount || item.placemarkCount || 0), 0) || 0;
    baseCatalogStatus.textContent = message || (baseCatalogManifest
      ? `ฐาน ${baseCatalogSelected.size.toLocaleString('th-TH')} · เปรียบเทียบ ${peaCompareCatalogSelected.size.toLocaleString('th-TH')}${selectedLines ? ` · ${selectedLines.toLocaleString('th-TH')} เส้น` : ''}`
      : 'ยังไม่พบรายการไฟล์');
  }

  function roleChoice(item, role, selected, onChange) {
    const label = document.createElement('label');
    label.className = `catalog-role-choice is-${role.toLowerCase()}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = selected.has(item.id);
    input.setAttribute('aria-label', `${role === 'BASE' ? 'ชุดฐาน' : 'ชุดเปรียบเทียบ'} ${item.name}`);
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = role === 'BASE' ? 'ฐาน' : 'เปรียบเทียบ';
    label.append(input, text);
    return label;
  }

  function renderBaseCatalog() {
    if (!baseCatalogList) return;
    const items = filteredBaseCatalogItems();
    const renderedItems = items.slice(0, baseCatalogRenderLimit);
    baseCatalogList.innerHTML = '';
    if (!items.length) {
      baseCatalogList.innerHTML = '<div class="base-catalog-empty">ไม่พบไฟล์ที่ตรงกับคำค้นหา</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    let currentGroup = '';
    for (const item of renderedItems) {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        const heading = document.createElement('div');
        heading.className = 'base-catalog-group';
        heading.textContent = currentGroup;
        fragment.appendChild(heading);
      }
      const label = document.createElement('div');
      label.className = 'base-catalog-option has-role-choices';
      const name = document.createElement('span'); name.textContent = item.name;
      const size = document.createElement('em'); size.textContent = `${(item.lineCount || item.placemarkCount || 0).toLocaleString('th-TH')} เส้น`;
      const roles = document.createElement('span');
      roles.className = 'catalog-role-choices';
      roles.append(
        roleChoice(item, 'BASE', baseCatalogSelected, checked => {
          if (checked) baseCatalogSelected.add(item.id); else baseCatalogSelected.delete(item.id);
          syncLogicalDatasetSelections();
          updateBaseCatalogSummary();
        }),
        roleChoice(item, 'COMPARE', peaCompareCatalogSelected, checked => {
          if (checked) peaCompareCatalogSelected.add(item.id); else peaCompareCatalogSelected.delete(item.id);
          syncLogicalDatasetSelections();
          updateBaseCatalogSummary();
        })
      );
      label.append(name, size, roles);
      fragment.appendChild(label);
    }
    if (renderedItems.length < items.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'catalog-load-more';
      more.textContent = `แสดงเพิ่ม ${Math.min(CATALOG_RENDER_PAGE_SIZE, items.length - renderedItems.length).toLocaleString('th-TH')} รายการ · เหลือ ${(items.length - renderedItems.length).toLocaleString('th-TH')}`;
      more.addEventListener('click', () => {
        baseCatalogRenderLimit += CATALOG_RENDER_PAGE_SIZE;
        renderBaseCatalog();
      });
      fragment.appendChild(more);
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
    const properties = propertiesWithDescriptionFields(line.p || line.properties || {});
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
    const maxiFiber = String(item?.name || item?.sourceName || item?.canonicalName || '').toLowerCase().includes('maxi');
    const specDiameter = maxiFiber && core === 2
      ? 6.5
      : maxiFiber && type && typeof lookupDiameterByTypeCore === 'function'
        ? lookupDiameterByTypeCore(type, core, true)
        : null;
    if (specDiameter !== null) {
      diameter = specDiameter;
      diameterSource = 'spec-fiber';
    }
    if (diameter === null && type && typeof lookupDiameterByTypeCore === 'function') {
      diameter = lookupDiameterByTypeCore(type, core);
      if (diameter !== null) diameterSource = 'table';
    }
    const sourceCode = propertyValue(properties, [/^code$/i, /route[_\s-]*code/i, /รหัส/i]) || identifier;
    const measured = propertyValue(properties, [/^measured$/i, /ระยะ.*วัด/i]);
    const calculated = propertyValue(properties, [/^calculated$/i, /ระยะ.*คำนวณ/i]);
    const province = propertyValue(properties, [/^province$/i, /^prov(?:ince)?[_\s-]*name$/i, /^changwat$/i, /จังหวัด/i]);
    const categoryText = [
      line.importCategory,
      line.import_category,
      line.category,
      properties.import_category,
      properties.importCategory,
      properties.category,
      Object.keys(properties).join(' '),
      Object.values(properties).join(' '),
      originalName,
      item?.category,
      item?.group,
      item?.name,
      item?.sourceName,
      item?.canonicalName
    ].filter(Boolean).join(' ');
    const importCategory = typeof normalizeImportCategory === 'function'
      ? normalizeImportCategory(categoryText)
      : /ready[\s_-]*access|พร้อม\s*(?:เชื่อมต่อ|ให้บริการ|ใช้งาน)/i.test(categoryText)
        ? 'ready-access'
        : /customer|subscriber|ลูกค้า|ผู้ใช้บริการ/i.test(categoryText) ? 'customer' : 'network';
    return {
      coords: Array.isArray(line.c) ? line.c : line.coords,
      name,
      diameter,
      unit: diameter !== null ? 'mm' : null,
      type,
      core,
      diameterSource,
      cableType,
      rawType,
      cableStatus,
      importCategory,
      sourceMetadata: { code: sourceCode, originalName, province, measured, calculated },
      extKeys: Object.keys(properties).join(', '),
      sourceFile: item?.name || line.sourceFile || '',
      sourceDatasetId: item?.id || line.sourceDatasetId || '',
      sourceIndex: Number.isSafeInteger(line.i) ? line.i : (Number.isSafeInteger(line.sourceIndex) ? line.sourceIndex : 0)
    };
  }

  function fetchBaseAnalysis(item) {
    const cacheKey = item.managed ? `managed:${item.id}:v${item.versionNo || 0}` : item.analysisPath;
    if (baseAnalysisCache.has(cacheKey)) return baseAnalysisCache.get(cacheKey);
    const request = item.managed ? fetchManagedAnalysis(item) : authenticatedFetch(uihAssetUrl(item.analysisPath)).then(async response => {
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

  async function loadSelectedPeaLines(selected, roleLabel) {
    const selectedItems = selectedCatalogItems(baseCatalogManifest, selected);
    const box = document.getElementById('boxBase');
    box?.classList.toggle('is-loading', selectedItems.length > 0);
    baseCatalogList?.setAttribute('aria-busy', String(selectedItems.length > 0));
    try {
      if (!selectedItems.length) return [];
      updateBaseCatalogSummary(`กำลังอ่าน PEA ฝั่ง${roleLabel} ${selectedItems.length.toLocaleString('th-TH')} ชุด…`);
      const results = [];
      for (let offset = 0; offset < selectedItems.length; offset += 3) {
        results.push(...await Promise.all(selectedItems.slice(offset, offset + 3).map(async item => ({
          item,
          payload: await fetchBaseAnalysis(item)
        }))));
      }
      const lines = results.flatMap(({ item, payload }) => (payload.lines || []).map(line => compactLineToApp(line, item)));
      updateBaseCatalogSummary(`PEA ฝั่ง${roleLabel}พร้อมวิเคราะห์ ${lines.length.toLocaleString('th-TH')} เส้น`);
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
  window.permissionOutLoadBaseLines = () => loadSelectedPeaLines(baseCatalogSelected, 'ฐาน');

  async function initializeBaseCatalog() {
    if (!baseCatalogList || !baseFileInput || !cloudEnabled) {
      updateBaseCatalogSummary(cloudEnabled ? 'ไม่พบส่วนแสดงรายการไฟล์' : 'ต้องเชื่อมต่อ Supabase');
      setDatasetHealth(peaDatasetStatus, cloudEnabled ? 'ไม่พร้อม' : 'ออฟไลน์', 'error');
      return;
    }
    try {
      setDatasetHealth(peaDatasetStatus, 'กำลังโหลด');
      const response = await authenticatedFetch(`${uihAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      manifest = mergeManagedCatalog(manifest, await managedCatalog('pea'));
      baseCatalogManifest = manifest;
      baseCatalogIndex = new Map(manifest.items.map(item => [item.id, item]));
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
    const selectedCount = ufmBaseCatalogSelected.size + compareCatalogSelected.size;
    if (compareCatalogCount) compareCatalogCount.textContent = selectedCount.toLocaleString('th-TH');
    if (!compareCatalogStatus) return;
    const selectedLines = compareCatalogManifest?.items
      .filter(item => ufmBaseCatalogSelected.has(item.id) || compareCatalogSelected.has(item.id))
      .reduce((sum, item) => sum + (item.lineCount || item.featureCount || 0), 0) || 0;
    compareCatalogStatus.textContent = message || (compareCatalogManifest
      ? `ฐาน ${ufmBaseCatalogSelected.size.toLocaleString('th-TH')} · เปรียบเทียบ ${compareCatalogSelected.size.toLocaleString('th-TH')}${selectedLines ? ` · ${selectedLines.toLocaleString('th-TH')} เส้น` : ''}`
      : 'ยังไม่พบรายการไฟล์');
  }

  function syncCompareSelection() {
    syncLogicalDatasetSelections();
  }

  function renderCompareCatalog() {
    if (!compareCatalogList) return;
    const items = filteredCompareCatalogItems();
    const renderedItems = items.slice(0, compareCatalogRenderLimit);
    compareCatalogList.innerHTML = '';
    if (!items.length) {
      compareCatalogList.innerHTML = '<div class="base-catalog-empty">ไม่พบไฟล์ที่ตรงกับคำค้นหา</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of renderedItems) {
      const label = document.createElement('div');
      label.className = 'base-catalog-option has-role-choices';
      const name = document.createElement('span'); name.textContent = item.name;
      const size = document.createElement('em'); size.textContent = `${(item.lineCount || item.featureCount || 0).toLocaleString('th-TH')} เส้น`;
      const roles = document.createElement('span');
      roles.className = 'catalog-role-choices';
      roles.append(
        roleChoice(item, 'BASE', ufmBaseCatalogSelected, checked => {
          if (checked) ufmBaseCatalogSelected.add(item.id); else ufmBaseCatalogSelected.delete(item.id);
          syncCompareSelection();
          updateCompareCatalogSummary();
        }),
        roleChoice(item, 'COMPARE', compareCatalogSelected, checked => {
          if (checked) compareCatalogSelected.add(item.id); else compareCatalogSelected.delete(item.id);
          syncCompareSelection();
          updateCompareCatalogSummary();
        })
      );
      label.append(name, size, roles);
      fragment.appendChild(label);
    }
    if (renderedItems.length < items.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'catalog-load-more';
      more.textContent = `แสดงเพิ่ม ${Math.min(CATALOG_RENDER_PAGE_SIZE, items.length - renderedItems.length).toLocaleString('th-TH')} รายการ · เหลือ ${(items.length - renderedItems.length).toLocaleString('th-TH')}`;
      more.addEventListener('click', () => {
        compareCatalogRenderLimit += CATALOG_RENDER_PAGE_SIZE;
        renderCompareCatalog();
      });
      fragment.appendChild(more);
    }
    compareCatalogList.appendChild(fragment);
  }

  function fetchCompareAnalysis(item) {
    const cacheKey = item.managed ? `managed:${item.id}:v${item.versionNo || 0}` : item.analysisPath;
    if (compareAnalysisCache.has(cacheKey)) return compareAnalysisCache.get(cacheKey);
    const request = item.managed ? fetchManagedAnalysis(item) : authenticatedFetch(ufmAssetUrl(item.analysisPath)).then(async response => {
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

  async function loadSelectedUfmLines(selected, roleLabel) {
    const selectedItems = selectedCatalogItems(compareCatalogManifest, selected);
    const box = document.getElementById('boxCompare');
    box?.classList.toggle('is-loading', selectedItems.length > 0);
    compareCatalogList?.setAttribute('aria-busy', String(selectedItems.length > 0));
    try {
      if (!selectedItems.length) return [];
      updateCompareCatalogSummary(`กำลังอ่าน UFM ฝั่ง${roleLabel} ${selectedItems.length.toLocaleString('th-TH')} ชุด…`);
      const results = [];
      for (let offset = 0; offset < selectedItems.length; offset += 3) {
        results.push(...await Promise.all(selectedItems.slice(offset, offset + 3).map(async item => ({
          item,
          payload: await fetchCompareAnalysis(item)
        }))));
      }
      const lines = results.flatMap(({ item, payload }) => (payload.lines || []).map(line => compactLineToApp(line, item)));
      updateCompareCatalogSummary(`UFM ฝั่ง${roleLabel}พร้อมวิเคราะห์ ${lines.length.toLocaleString('th-TH')} เส้น`);
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
  window.permissionOutLoadCompareLines = () => loadSelectedUfmLines(compareCatalogSelected, 'เปรียบเทียบ');
  window.permissionOutLoadGroupLines = async groupKey => {
    const isBase = groupKey === 'BASE';
    const [peaLines, ufmLines] = await Promise.all([
      loadSelectedPeaLines(isBase ? baseCatalogSelected : peaCompareCatalogSelected, isBase ? 'ฐาน' : 'เปรียบเทียบ'),
      loadSelectedUfmLines(isBase ? ufmBaseCatalogSelected : compareCatalogSelected, isBase ? 'ฐาน' : 'เปรียบเทียบ')
    ]);
    return peaLines.concat(ufmLines);
  };
  window.permissionOutSwapLogicalSelections = () => {
    const swapSets = (left, right) => {
      const leftValues = [...left];
      left.clear();
      for (const value of right) left.add(value);
      right.clear();
      for (const value of leftValues) right.add(value);
    };
    swapSets(baseCatalogSelected, peaCompareCatalogSelected);
    swapSets(ufmBaseCatalogSelected, compareCatalogSelected);
    syncLogicalDatasetSelections();
    renderBaseCatalog();
    renderCompareCatalog();
    updateBaseCatalogSummary();
    updateCompareCatalogSummary();
  };

  function catalogItemSearchText(item) {
    return [
      item?.name, item?.group, item?.sourceName, item?.sourceRelative,
      item?.canonicalName, item?.displayName, item?.metadata?.province,
      ...(Array.isArray(item?.metadata?.provinces) ? item.metadata.provinces : [])
    ].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('th');
  }

  function catalogItemMatchesProvinces(item, provinces) {
    const text = catalogItemSearchText(item);
    return provinces.some(province => text.includes(String(province).normalize('NFKC').toLocaleLowerCase('th')));
  }

  function catalogItemRdType(item) {
    const text = catalogItemSearchText(item).replace(/[\s_-]+/g, '');
    if (text.includes('rd05')) return 'rd05';
    if (text.includes('rd03')) return 'rd03';
    return 'other';
  }

  window.permissionOutSelectRegionDatasets = ({ provinces = [], useRd03 = true, useRd05 = false, useMaxi = true } = {}) => {
    if (((useRd03 || useRd05) && !baseCatalogManifest) || (useMaxi && !compareCatalogManifest)) {
      return { ready: false, rd03Count: 0, rd05Count: 0, maxiCount: 0 };
    }
    baseCatalogSelected.clear();
    peaCompareCatalogSelected.clear();
    ufmBaseCatalogSelected.clear();
    compareCatalogSelected.clear();

    let regionalPeaItems = (baseCatalogManifest?.items || []).filter(item => catalogItemMatchesProvinces(item, provinces));
    // A managed nationwide dataset may not carry province metadata yet. Loading it
    // remains correct because quick mode filters every line to the selected region.
    if (!regionalPeaItems.length) regionalPeaItems = baseCatalogManifest?.items || [];
    const rd03Items = useRd03
      ? regionalPeaItems.filter(item => ['rd03', 'other'].includes(catalogItemRdType(item)))
      : [];
    const rd05Items = useRd05
      ? regionalPeaItems.filter(item => catalogItemRdType(item) === 'rd05')
      : [];
    [...rd03Items, ...rd05Items].forEach(item => baseCatalogSelected.add(item.id));
    const maxiItems = useMaxi ? (compareCatalogManifest?.items || []) : [];
    // Quick mode is for combined display and billing, not comparison. Put Maxi on
    // the same logical BASE side as RD03/RD05 so existing direct-analysis billing applies.
    maxiItems.forEach(item => ufmBaseCatalogSelected.add(item.id));

    syncLogicalDatasetSelections();
    renderBaseCatalog();
    renderCompareCatalog();
    updateBaseCatalogSummary();
    updateCompareCatalogSummary();
    return { ready: true, rd03Count: rd03Items.length, rd05Count: rd05Items.length, maxiCount: maxiItems.length };
  };

  async function initializeCompareCatalog() {
    if (!compareCatalogList || !cloudEnabled) {
      updateCompareCatalogSummary(cloudEnabled ? 'ไม่พบส่วนแสดงรายการไฟล์' : 'ต้องเชื่อมต่อ Supabase');
      setDatasetHealth(ufmDatasetStatus, cloudEnabled ? 'ไม่พร้อม' : 'ออฟไลน์', 'error');
      return;
    }
    try {
      setDatasetHealth(ufmDatasetStatus, 'กำลังโหลด');
      const response = await authenticatedFetch(`${ufmAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      manifest = mergeManagedCatalog(manifest, await managedCatalog('ufm'));
      compareCatalogManifest = manifest;
      compareCatalogIndex = new Map(manifest.items.map(item => [item.id, item]));
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
    const selectedCount = activePeaSelection().size;
    if (peaLayerCount) peaLayerCount.textContent = selectedCount.toLocaleString('th-TH');
    if (!peaLayerStatus) return;
    peaLayerStatus.textContent = message || (peaManifest
      ? `เลือก ${selectedCount.toLocaleString('th-TH')} จาก ${peaManifest.featureCount.toLocaleString('th-TH')} พื้นที่`
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
      input.checked = activePeaSelection().has(String(item.id));
      input.disabled = String(item.id) === peaScopeOfficeId;
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
    const promise = authenticatedFetch(peaAssetUrl(path)).then(response => {
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
    const maximumSamples = 96;
    if (samples.length <= maximumSamples) return samples;
    const reduced = [];
    for (let index = 0; index < maximumSamples; index += 1) {
      reduced.push(samples[Math.round(index * (samples.length - 1) / (maximumSamples - 1))]);
    }
    return reduced;
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async function resolvePeaAreasForSegments(segments, onProgress = null) {
    if (!peaManifest) await initializePeaLayers();
    if (!peaManifest) throw new Error('PEA area manifest is unavailable');
    // An empty array may have been created by an older fast-export fallback.
    // Only trust results that this resolver has explicitly completed.
    const unresolved = segments.filter(segment => segment._peaAreasResolved !== true);
    const batchSize = 300;
    for (let offset = 0; offset < unresolved.length; offset += batchSize) {
      const batch = unresolved.slice(offset, offset + batchSize);
      const jobs = batch.map(segment => ({
        segment,
        samples: segmentSamplePoints(segment).map(point => ({ point, candidates: peaCandidatesForPoint(point) }))
      }));
      const chunkPaths = [...new Set(jobs.flatMap(job => job.samples.flatMap(sample => sample.candidates.map(item => item.chunk))))];
      const chunks = await mapWithConcurrency(chunkPaths, 4, fetchPeaChunk);
      const featureById = new Map(chunks.flatMap(chunk => chunk.features || []).map(feature => [
        String(feature.id || feature.properties?.pea_id), feature
      ]));
      for (const job of jobs) {
        const matches = new Map();
        for (const sample of job.samples) {
          for (const item of sample.candidates) {
            const feature = featureById.get(String(item.id));
            if (feature && pointInPeaGeometry(sample.point, feature.geometry)) {
              const key = String(item.id);
              const match = matches.get(key) || {
                id: key,
                name: item.name || feature.properties?.name || '',
                officeType: item.officeType || feature.properties?.office_type || '',
                assignmentMethod: 'densified_point_in_polygon_0.02deg',
                sampleCount: 0
              };
              match.sampleCount += 1;
              matches.set(key, match);
            }
          }
        }
        job.segment._peaAreas = [...matches.values()]
          .map(area => ({ ...area, coverageRatio: job.samples.length ? area.sampleCount / job.samples.length : 0 }))
          .sort((left, right) => right.sampleCount - left.sampleCount || left.name.localeCompare(right.name, 'th'));
        job.segment._peaAreasResolved = true;
      }
      const completed = Math.min(offset + batch.length, unresolved.length);
      onProgress?.({ completed, total: unresolved.length });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { resolvedSegments: unresolved.length, cachedChunks: peaChunkCache.size };
  }

  window.permissionOutResolvePeaAreas = resolvePeaAreasForSegments;
  window.permissionOutPeaFeaturesForSegments = async segments => {
    await resolvePeaAreasForSegments(segments);
    const ids = new Set(segments.flatMap(segment => (segment._peaAreas || []).map(area => String(area.id))));
    const paths = [...new Set((peaManifest?.items || []).filter(item => ids.has(String(item.id))).map(item => item.chunk))];
    const chunks = await Promise.all(paths.map(fetchPeaChunk));
    return chunks.flatMap(chunk => chunk.features || []).filter(feature => ids.has(String(feature.id || feature.properties?.pea_id)));
  };
  window.permissionOutSelectedPeaFeatures = async () => {
    const selectedIds = activePeaSelection();
    if (!selectedIds.size || !peaManifest) return [];
    const paths = [...new Set(
      peaManifest.items
        .filter(item => selectedIds.has(String(item.id)))
        .map(item => item.chunk)
    )];
    const chunks = await Promise.all(paths.map(fetchPeaChunk));
    return chunks
      .flatMap(chunk => chunk.features || [])
      .filter(feature => selectedIds.has(String(feature.id || feature.properties?.pea_id)));
  };

  async function updatePeaMap() {
    const version = ++peaRenderVersion;
    const selectedIds = activePeaSelection();
    if (!selectedIds.size || !peaManifest) {
      clearPeaOverlay();
      peaShouldFocus = false;
      updatePeaSummary();
      return;
    }
    if (!map) initMap();
    let peaPane = map.getPane('peaAreaPane');
    if (!peaPane) peaPane = map.createPane('peaAreaPane');
    // Keep PEA polygons below route vectors so selecting an area never blocks
    // clicks and tooltips on the routes currently shown on the map.
    peaPane.style.zIndex = '390';
    const selectedItems = peaManifest.items.filter(item => selectedIds.has(String(item.id)));
    const chunkPaths = [...new Set(selectedItems.map(item => item.chunk))];
    updatePeaSummary(`กำลังโหลด ${selectedIds.size.toLocaleString('th-TH')} พื้นที่…`);
    try {
      const chunks = await Promise.all(chunkPaths.map(fetchPeaChunk));
      if (version !== peaRenderVersion) return;
      const features = chunks.flatMap(chunk => chunk.features || []).filter(feature => selectedIds.has(String(feature.id || feature.properties?.pea_id)));
      clearPeaOverlay();
      peaOverlayLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
        pane: 'peaAreaPane',
        style: { color: '#6d4bb4', fillColor: '#8b5cf6', fillOpacity: 0.13, opacity: 0.9, weight: 1.7 },
        onEachFeature(feature, layer) {
          const name = escapeHtml(feature.properties?.name || 'พื้นที่ PEA');
          const type = escapeHtml(feature.properties?.office_type || '');
          layer.bindPopup(`<strong>${name}</strong>${type ? `<br><span>${type}</span>` : ''}`);
          layer.bindTooltip(name, { sticky: true, direction: 'top' });
        }
      }).addTo(map);
      if (peaShouldFocus) {
        const scopeFeatures = features.filter(feature => String(feature.id || feature.properties?.pea_id) === peaScopeOfficeId);
        const bounds = scopeFeatures.length
          ? L.geoJSON({ type: 'FeatureCollection', features: scopeFeatures }).getBounds()
          : peaOverlayLayer.getBounds();
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
    ++peaRenderVersion;
    if (focus) peaShouldFocus = true;
    clearTimeout(peaRenderTimer);
    peaRenderTimer = setTimeout(updatePeaMap, 120);
  }

  // Keep the dropdown-selected boundary separate from manually selected layers.
  window.permissionOutShowPeaOffice = officeId => {
    const nextId = String(officeId || '');
    if (nextId === peaScopeOfficeId) return;
    peaScopeOfficeId = nextId;
    peaShouldFocus = Boolean(nextId);
    clearPeaOverlay();
    renderPeaOptions();
    updatePeaSummary();
    schedulePeaMapUpdate(Boolean(nextId));
  };
  window.addEventListener('permissionout:cleared', () => window.permissionOutShowPeaOffice(''));

  async function initializePeaLayers() {
    if (!peaLayerTrigger || !cfg.supabaseUrl) return;
    peaLayerTrigger.disabled = true;
    updatePeaSummary('กำลังโหลดรายการจาก Supabase…');
    try {
      const response = await authenticatedFetch(peaAssetUrl('manifest.json'));
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
      if (activePeaSelection().size) schedulePeaMapUpdate();
    } catch (error) {
      updatePeaSummary(`โหลดรายการไม่สำเร็จ: ${error.message}`);
    } finally { peaLayerTrigger.disabled = false; }
  }

  async function initializeBillingFormula() {
    if (!client) return;
    try {
      const payload = await authenticatedJson('/api/data/billing-formula?code=permission_fee');
      const formula = payload.formula;
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
        reportCategories: Array.from(document.querySelectorAll('.categoryFilter:checked')).map(input => input.value),
        sourceRolesSwapped: false
      },
      sourceFiles: {
        base: [...(window.permissionOutBaseDatasetNames || []), ...(window.permissionOutBaseFiles || []).map(file => file.name)],
        compare: [...(window.permissionOutCompareDatasetNames || []), ...(window.permissionOutCompareFiles || []).map(file => file.name)]
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
    window.permissionOutSyncOverlapMode?.();
    const savedReportCategories = Array.isArray(s.reportCategories) ? s.reportCategories : s.importCategories;
    if (Array.isArray(savedReportCategories)) {
      const selectedCategories = new Set(savedReportCategories);
      document.querySelectorAll('.categoryFilter').forEach(input => {
        input.checked = selectedCategories.has(input.value);
      });
    }
    window.permissionOutRolesSwapped = false;
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
    if (window.permissionOutTransientAnalysis) {
      if (!silent) toast('ผลคำนวณจากไฟล์ภายนอกเป็นข้อมูลชั่วคราวและไม่สามารถบันทึกเข้าระบบได้', 'error');
      return;
    }
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
    const latestUser = await client.auth.getUser().then(({ data }) => data.user).catch(() => null);
    const authUser = latestUser?.id === user.id ? latestUser : user;
    currentUser = authUser;
    let result = await client
      .from('profiles')
      .select('id,display_name,organization,role,is_active,permissions')
      .eq('id', authUser.id)
      .maybeSingle();
    if (result.error && (result.error.code === '42703' || /role|is_active/i.test(result.error.message || ''))) {
      result = await client
        .from('profiles')
        .select('id,display_name,organization')
        .eq('id', authUser.id)
        .maybeSingle();
    }
    if (result.error) throw result.error;
    const data = result.data || {};
    const metadata = authUser.app_metadata || {};
    const role = metadata.permission_out_role || data.role || 'user';
    const normalizedRole = role === 'admin' ? 'admin' : 'user';
    const isActive = metadata.permission_out_active === undefined
      ? data.is_active !== false
      : metadata.permission_out_active !== false;
    if (!isActive) throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    const permissions = modulePermissions(data.permissions || metadata.permission_out_permissions, normalizedRole);
    currentProfile = {
      id: authUser.id,
      display_name: data.display_name || authUser.user_metadata?.display_name || '',
      organization: data.organization || authUser.user_metadata?.organization || '',
      role: normalizedRole,
      is_active: true,
      permissions
    };
    return currentProfile;
  }

  function modulePermissions(value, role = 'user') {
    const isAdmin = role === 'admin';
    return Object.fromEntries(MODULE_KEYS.map(key => {
      const permission = value && typeof value === 'object' ? value[key] || {} : {};
      return [key, {
        view: isAdmin || permission.view !== false,
        update: isAdmin || permission.update === true
      }];
    }));
  }

  function canAccessModule(moduleKey, action = 'view') {
    if (currentProfile?.role === 'admin') return true;
    const permission = currentProfile?.permissions?.[moduleKey];
    return action === 'update' ? permission?.view && permission?.update : permission?.view;
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

  function showAuth(initialError = '') {
    const target = new URL('/login/', location.origin);
    target.searchParams.set('returnTo', `${location.pathname}${location.search}`);
    if (initialError) target.searchParams.set('reason', 'session_expired');
    location.replace(target);
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
    if (canAccessModule('mod1', 'update')) {
      const manageData = document.createElement('button');
      manageData.className = 'modal-primary';
      manageData.type = 'button';
      manageData.textContent = 'จัดการข้อมูล PEA / UFM';
      manageData.addEventListener('click', () => window.permissionOutOpenAdminData?.());
      actions.appendChild(manageData);
    }
    if (currentProfile?.role === 'admin') {
      const manageUsers = document.createElement('button');
      manageUsers.className = 'modal-primary';
      manageUsers.type = 'button';
      manageUsers.textContent = 'จัดการผู้ใช้และสิทธิ์';
      manageUsers.addEventListener('click', () => window.permissionOutOpenAdminUsers?.());
      actions.appendChild(manageUsers);
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
    canAccessModule,
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
  document.querySelectorAll('.categoryFilter,input[name="reportOverlapMode"]').forEach(input => input.addEventListener('change', markDirty));
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
  baseCatalogSearch?.addEventListener('input', debounceUi(() => {
    baseCatalogRenderLimit = CATALOG_RENDER_PAGE_SIZE;
    renderBaseCatalog();
  }, 180));
  compareCatalogSearch?.addEventListener('input', debounceUi(() => {
    compareCatalogRenderLimit = CATALOG_RENDER_PAGE_SIZE;
    renderCompareCatalog();
  }, 180));
  document.getElementById('baseCatalogSelectAll')?.addEventListener('click', () => {
    for (const item of filteredBaseCatalogItems()) baseCatalogSelected.add(item.id);
    syncLogicalDatasetSelections();
    renderBaseCatalog(); updateBaseCatalogSummary();
  });
  document.getElementById('baseCatalogSelectCompare')?.addEventListener('click', () => {
    for (const item of filteredBaseCatalogItems()) peaCompareCatalogSelected.add(item.id);
    syncLogicalDatasetSelections();
    renderBaseCatalog(); updateBaseCatalogSummary();
  });
  document.getElementById('baseCatalogClear')?.addEventListener('click', () => {
    baseCatalogSelected.clear(); peaCompareCatalogSelected.clear(); syncLogicalDatasetSelections();
    renderBaseCatalog(); updateBaseCatalogSummary();
  });
  document.getElementById('compareCatalogSelectAll')?.addEventListener('click', () => {
    for (const item of filteredCompareCatalogItems()) compareCatalogSelected.add(item.id);
    syncCompareSelection(); renderCompareCatalog(); updateCompareCatalogSummary();
  });
  document.getElementById('compareCatalogSelectBase')?.addEventListener('click', () => {
    for (const item of filteredCompareCatalogItems()) ufmBaseCatalogSelected.add(item.id);
    syncCompareSelection(); renderCompareCatalog(); updateCompareCatalogSummary();
  });
  document.getElementById('compareCatalogClear')?.addEventListener('click', () => {
    compareCatalogSelected.clear(); ufmBaseCatalogSelected.clear(); syncCompareSelection(); renderCompareCatalog(); updateCompareCatalogSummary();
  });
  window.addEventListener('permissionout:cleared', () => {
    baseCatalogSelected.clear(); peaCompareCatalogSelected.clear();
    if (baseCatalogSearch) baseCatalogSearch.value = '';
    renderBaseCatalog(); updateBaseCatalogSummary();
    compareCatalogSelected.clear(); ufmBaseCatalogSelected.clear(); syncCompareSelection();
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
    if (activePeaSelection().size) schedulePeaMapUpdate();
    map.on('moveend', scheduleOsmReferenceUpdate);
    scheduleOsmReferenceUpdate();
  });
  osmRoadToggle?.addEventListener('change', scheduleOsmReferenceUpdate);
  osmBuildingToggle?.addEventListener('change', scheduleOsmReferenceUpdate);
  window.addEventListener('permissionout:analysis-complete', event => {
    if (event.detail?.transient) {
      toast('คำนวณไฟล์ภายนอกเสร็จแล้ว · ผลลัพธ์จะไม่ถูกบันทึก', 'success');
      return;
    }
    markDirty();
    toast('วิเคราะห์เสร็จแล้ว พร้อมตรวจสอบและส่งออกข้อมูล', 'success');
  });
  window.addEventListener('online', () => toast('กลับมาออนไลน์แล้ว', 'success'));
  window.addEventListener('offline', () => toast('ออฟไลน์ — ต้องเชื่อมต่ออีกครั้งเพื่ออ่านชุดข้อมูลจาก Supabase'));

  async function initialize() {
    if (client) {
      const { data } = await client.auth.getSession();
      await applySession(data.session, { showGate: false });
      client.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => applySession(session, { showGate: true }).catch(error => {
          toast(error.message || 'ตรวจสอบเซสชันไม่สำเร็จ', 'error');
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
    if (client && !currentUser && cloudRequired) {
      showAuth();
      return;
    }
    await Promise.all([initializePeaLayers(), initializeBaseCatalog(), initializeCompareCatalog(), initializeBillingFormula()]);
  }
  initialize().catch(error => { updateAccountUI(); toast(`เริ่มระบบ Cloud ไม่สำเร็จ: ${error.message}`, 'error'); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
