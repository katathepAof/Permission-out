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
  let currentUser = null;
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
    saveState.textContent = text;
    saveState.className = `save-state ${kind ? `is-${kind}` : ''}`.trim();
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

  function compactLineToApp(line, item) {
    const properties = line.p || {};
    const name = String(line.n || properties.name || 'ไม่ระบุชื่อ');
    const cableType = propertyValue(properties, [/cable[_\s-]*type/i, /cabletype/i, /ชนิดสาย/i, /ประเภทสาย/i]);
    const rawType = propertyValue(properties, [/^type$/i, /line[_\s-]*type/i, /ชนิด/i, /ประเภท/i]);
    const cableStatus = propertyValue(properties, [/^status$/i, /cable[_\s-]*status/i, /line[_\s-]*status/i, /สถานะ/i]);
    const combined = `${cableType} ${rawType} ${name}`.toUpperCase();
    const type = /FIG\.?\s*8/.test(combined) ? 'FIG8'
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
      extKeys: Object.keys(properties).join(', '),
      sourceFile: item.name
    };
  }

  function fetchBaseAnalysis(item) {
    if (baseAnalysisCache.has(item.analysisPath)) return baseAnalysisCache.get(item.analysisPath);
    const request = fetch(uihAssetUrl(item.analysisPath)).then(async response => {
      if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
      if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์ไม่รองรับการอ่านข้อมูล gzip แบบสตรีม');
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).json();
    }).catch(error => {
      baseAnalysisCache.delete(item.analysisPath);
      throw error;
    });
    baseAnalysisCache.set(item.analysisPath, request);
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
      return;
    }
    try {
      const response = await fetch(`${uihAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      baseCatalogManifest = manifest;
      renderBaseCatalog();
      updateBaseCatalogSummary();
    } catch (error) {
      baseCatalogList.innerHTML = '<div class="base-catalog-empty">โหลดรายการไฟล์ไม่สำเร็จ</div>';
      updateBaseCatalogSummary('เชื่อมต่อคลังไฟล์ไม่ได้');
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
    if (compareAnalysisCache.has(item.analysisPath)) return compareAnalysisCache.get(item.analysisPath);
    const request = fetch(ufmAssetUrl(item.analysisPath)).then(async response => {
      if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
      if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์ไม่รองรับการอ่านข้อมูล gzip แบบสตรีม');
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).json();
    }).catch(error => {
      compareAnalysisCache.delete(item.analysisPath);
      throw error;
    });
    compareAnalysisCache.set(item.analysisPath, request);
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
      return;
    }
    try {
      const response = await fetch(`${ufmAssetUrl('manifest.json')}?v=1`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest.items)) throw new Error('รูปแบบ manifest ไม่ถูกต้อง');
      compareCatalogManifest = manifest;
      renderCompareCatalog();
      updateCompareCatalogSummary();
    } catch (error) {
      compareCatalogList.innerHTML = '<div class="base-catalog-empty">โหลดรายการไฟล์ไม่สำเร็จ</div>';
      updateCompareCatalogSummary('เชื่อมต่อคลังไฟล์ไม่ได้');
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

  function openModal(title, subtitle, content, wide = false) {
    document.getElementById('appModalTitle').textContent = title;
    document.getElementById('appModalSubtitle').textContent = subtitle || '';
    const body = document.getElementById('appModalBody');
    body.innerHTML = '';
    if (typeof content === 'string') body.innerHTML = content;
    else if (content) body.appendChild(content);
    modalRoot.querySelector('.app-modal').classList.toggle('app-modal-wide', wide);
    modalRoot.classList.add('is-open');
    setTimeout(() => body.querySelector('input,button')?.focus(), 20);
  }

  function closeModal() { modalRoot.classList.remove('is-open'); }
  modalRoot.querySelector('.modal-close').addEventListener('click', closeModal);
  modalRoot.addEventListener('mousedown', e => { if (e.target === modalRoot) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function markDirty() {
    dirty = true;
    setSaveState('ยังไม่บันทึก', 'dirty');
    if (cfg.autosave && (currentProjectId || currentUser)) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => saveProject(true), 1800);
    }
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
        surchargePct: numeric('surchargePct', 5), dedupe: Boolean(document.getElementById('dedupeToggle')?.checked)
      },
      sourceFiles: {
        base: (baseCatalogManifest?.items || []).filter(item => baseCatalogSelected.has(item.id)).map(item => item.name),
        compare: (compareCatalogManifest?.items || []).filter(item => compareCatalogSelected.has(item.id)).map(item => item.name)
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
    const name = titleInput.value.trim() || 'โครงการไม่มีชื่อ';
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
      titleInput.value = project.name;
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

  function showAuth(initialMode = 'signin') {
    let mode = initialMode;
    const content = document.createElement('div');
    content.innerHTML = '<div class="auth-note">ลงชื่อเข้าใช้เพื่อซิงก์โครงการกับ Supabase อย่างปลอดภัย หากยังไม่เชื่อมต่อ Supabase แอปจะทำงานแบบ Local บนอุปกรณ์นี้</div><div class="auth-tabs"><button class="auth-tab" data-mode="signin">เข้าสู่ระบบ</button><button class="auth-tab" data-mode="signup">สร้างบัญชี</button></div><form id="authForm"><div class="modal-field"><label for="authEmail">อีเมล</label><input id="authEmail" type="email" autocomplete="email" required placeholder="name@company.com"></div><div class="modal-field"><label for="authPassword">รหัสผ่าน</label><input id="authPassword" type="password" autocomplete="current-password" required minlength="8" placeholder="อย่างน้อย 8 ตัวอักษร"></div><button class="modal-primary" id="authSubmit" type="submit"></button><button class="modal-link" id="resetPassword" type="button">ลืมรหัสผ่าน</button></form>';
    const renderMode = () => {
      content.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.mode === mode));
      content.querySelector('#authSubmit').textContent = mode === 'signup' ? 'สร้างบัญชี' : 'เข้าสู่ระบบ';
      content.querySelector('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    };
    content.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => { mode = tab.dataset.mode; renderMode(); }));
    content.querySelector('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!client) { toast('กรุณากำหนด Supabase URL และ Key ใน app-config.js ก่อน', 'error'); return; }
      const email = content.querySelector('#authEmail').value.trim();
      const password = content.querySelector('#authPassword').value;
      const button = content.querySelector('#authSubmit'); button.disabled = true; button.textContent = 'กำลังดำเนินการ…';
      const response = mode === 'signup' ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
      button.disabled = false; renderMode();
      if (response.error) toast(response.error.message, 'error');
      else { toast(mode === 'signup' ? 'สร้างบัญชีแล้ว กรุณาตรวจสอบอีเมลยืนยัน' : 'เข้าสู่ระบบสำเร็จ', 'success'); closeModal(); }
    });
    content.querySelector('#resetPassword').addEventListener('click', async () => {
      if (!client) { toast('ยังไม่ได้เชื่อมต่อ Supabase', 'error'); return; }
      const email = content.querySelector('#authEmail').value.trim();
      if (!email) { toast('กรุณากรอกอีเมลก่อน', 'error'); return; }
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      toast(error ? error.message : 'ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว', error ? 'error' : 'success');
    });
    renderMode(); openModal('บัญชีผู้ใช้', 'Permission Out Cloud Workspace', content);
  }

  function updateAccountUI() {
    const label = document.getElementById('accountLabel');
    const initial = document.getElementById('userInitial');
    if (currentUser) {
      label.textContent = currentUser.email?.split('@')[0] || 'Account';
      initial.textContent = (currentUser.email?.[0] || 'U').toUpperCase();
    } else {
      label.textContent = cloudEnabled ? 'เข้าสู่ระบบ' : 'Local';
      initial.textContent = cloudEnabled ? 'G' : 'L';
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
    const info = document.createElement('p'); info.innerHTML = '<span class="connection-pill">เชื่อมต่อ Supabase แล้ว</span>';
    const signout = document.createElement('button'); signout.className = 'danger-btn'; signout.textContent = 'ออกจากระบบ';
    signout.addEventListener('click', async () => { await client.auth.signOut(); closeModal(); toast('ออกจากระบบแล้ว'); });
    content.append(avatar, name, info, signout); openModal('บัญชีผู้ใช้', 'จัดการเซสชันและการซิงก์ข้อมูล', content);
  }

  function newProject() {
    if (dirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการเริ่มงานใหม่หรือไม่?')) return;
    clearAll(); currentProjectId = null; dirty = false;
    titleInput.value = `โครงการ ${new Date().toLocaleDateString('th-TH')}`;
    setSaveState('พร้อมใช้งาน'); toast('สร้างพื้นที่งานใหม่แล้ว');
  }

  titleInput.addEventListener('input', markDirty);
  ['threshold','interval','polesPerKm','rateB','surchargePct','dedupeToggle'].forEach(id => document.getElementById(id)?.addEventListener('change', markDirty));
  document.getElementById('saveProjectBtn').addEventListener('click', () => saveProject(false));
  document.getElementById('projectsBtn').addEventListener('click', showProjects);
  document.getElementById('newProjectBtn').addEventListener('click', newProject);
  document.getElementById('accountBtn').addEventListener('click', showAccount);
  baseCatalogSearch?.addEventListener('input', renderBaseCatalog);
  compareCatalogSearch?.addEventListener('input', renderCompareCatalog);
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
  peaLayerSearch?.addEventListener('input', renderPeaOptions);
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
  window.addEventListener('permissionout:analysis-complete', () => { markDirty(); toast('วิเคราะห์เสร็จแล้ว พร้อมบันทึกโครงการ', 'success'); });
  window.addEventListener('online', () => toast('กลับมาออนไลน์แล้ว', 'success'));
  window.addEventListener('offline', () => toast('ออฟไลน์ — แอปยังวิเคราะห์และบันทึกในเครื่องได้'));
  window.addEventListener('beforeunload', e => { if (dirty && !cfg.autosave) { e.preventDefault(); e.returnValue = ''; } });

  async function initialize() {
    if (client) {
      const { data } = await client.auth.getSession();
      currentUser = data.session?.user || null; updateAccountUI();
      client.auth.onAuthStateChange((_event, session) => { currentUser = session?.user || null; currentProjectId = null; updateAccountUI(); });
      setSaveState(currentUser ? 'Cloud พร้อมใช้งาน' : 'พร้อมใช้งาน');
    } else {
      updateAccountUI(); setSaveState('Local mode');
      if (cloudRequired && location.protocol !== 'file:') {
        setSaveState('ต้องตั้งค่า Supabase', 'dirty');
        document.getElementById('saveProjectBtn').disabled = true;
        document.getElementById('projectsBtn').disabled = true;
        showConfigurationRequired();
      }
    }
    await Promise.all([initializePeaLayers(), initializeBaseCatalog(), initializeCompareCatalog(), initializeBillingFormula()]);
  }
  initialize().catch(error => { updateAccountUI(); toast(`เริ่มระบบ Cloud ไม่สำเร็จ: ${error.message}`, 'error'); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
