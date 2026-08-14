(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const cloudEnabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
  const client = cloudEnabled
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        storage: window.sessionStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
    : null;
  const COMMENT_NOTIFICATIONS_KEY = 'permission-out.mod2.comments.lastSeenAt';
  const MAP_FOCUS_KEY = 'permission-out.mod2.mapFocus';

  const state = {
    user: null,
    profile: null,
    sites: [],
    filtered: [],
    mapSites: [],
    searchActive: false,
    viewMode: 'overview',
    loaded: false,
    loading: false,
    cluster: true,
    density: false,
    notifications: [],
    routeArea: '',
    routeRequest: 0,
    commentLastSeenAt: localStorage.getItem(COMMENT_NOTIFICATIONS_KEY) || ''
  };

  const GRADE_COLORS = {
    DC: '#7c3aed',
    EMX: '#4f46e5',
    Cityring: '#136fa5',
    Access: '#16866f',
    'In Building': '#d07813',
    LongHual: '#db5e45',
    Provincial: '#2f8fbe',
    Customer: '#b64378',
    'ROW LL': '#64748b',
    'Trunk IP RAN': '#0e7490',
    'Trunk IP RAN+Access': '#0f766e',
    'Interconnect(Access)': '#9a5b13'
  };
  const MOD1_ROUTE_COLORS = {
    maxi: {
      network: '#20d6c7',
      'ready-access': '#4f8cff',
      customer: '#d95cff'
    },
    rd03: {
      network: '#ff9f43',
      'ready-access': '#f5d547',
      customer: '#ff5576'
    }
  };
  const MODULES = [
    { key: 'mod1', label: 'MOD 1', detail: 'PEA / UFM route intelligence' },
    { key: 'mod2', label: 'MOD 2', detail: 'Site Facility & Design' }
  ];

  const elements = {
    accountBtn: document.getElementById('accountBtn'),
    accountLabel: document.getElementById('accountLabel'),
    accountMeta: document.getElementById('accountMeta'),
    userInitial: document.getElementById('userInitial'),
    datasetStatus: document.getElementById('datasetStatus'),
    mapSiteSearch: document.getElementById('mapSiteSearch'),
    clearMapSearch: document.getElementById('clearMapSearch'),
    mapSearchCount: document.getElementById('mapSearchCount'),
    mapContextStatus: document.getElementById('mapContextStatus'),
    mapFilterBar: document.getElementById('mapFilterBar'),
    activeFilterChips: document.getElementById('activeFilterChips'),
    clearMapFilters: document.getElementById('clearMapFilters'),
    mapEmptyState: document.getElementById('mapEmptyState'),
    emptyResetFilters: document.getElementById('emptyResetFilters'),
    resetFilters: document.getElementById('resetFilters'),
    reloadBtn: document.getElementById('reloadBtn'),
    metricSites: document.getElementById('metricSites'),
    metricCustomers: document.getElementById('metricCustomers'),
    metricNodes: document.getElementById('metricNodes'),
    metricOwners: document.getElementById('metricOwners'),
    mapLoading: document.getElementById('mapLoading'),
    loadingDetail: document.getElementById('loadingDetail'),
    mapLegend: document.getElementById('mapLegend'),
    mapLegendToggle: document.getElementById('mapLegendToggle'),
    mapLegendPanel: document.getElementById('mapLegendPanel'),
    mapLegendItems: document.getElementById('mapLegendItems'),
    mapLegendPreview: document.getElementById('mapLegendPreview'),
    mapLegendCount: document.getElementById('mapLegendCount'),
    mapLegendSummary: document.getElementById('mapLegendSummary'),
    overviewBtn: document.getElementById('overviewBtn'),
    clusterBtn: document.getElementById('clusterBtn'),
    heatBtn: document.getElementById('heatBtn'),
    fitBtn: document.getElementById('fitBtn'),
    mapFocusToggle: document.getElementById('mapFocusToggle'),
    mapOutputMenu: document.getElementById('mapOutputMenu'),
    mapOutputToggle: document.getElementById('mapOutputToggle'),
    mapOutputPanel: document.getElementById('mapOutputPanel'),
    opexReportBtn: document.getElementById('opexReportBtn'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    workspace: document.querySelector('.mod2-workspace'),
    exportBtn: document.getElementById('exportBtn'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalSubtitle: document.getElementById('modalSubtitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    toastRegion: document.getElementById('toastRegion')
  };
  elements.thailandOverviewHud = document.getElementById('thailandOverviewHud');
  elements.overviewScopeLabel = document.getElementById('overviewScopeLabel');
  elements.overviewSiteCount = document.getElementById('overviewSiteCount');
  elements.overviewProvinceCount = document.getElementById('overviewProvinceCount');
  elements.overviewCustomerCount = document.getElementById('overviewCustomerCount');
  elements.commentNotifications = document.getElementById('commentNotifications');
  elements.commentNotificationBtn = document.getElementById('commentNotificationBtn');
  elements.commentNotificationCount = document.getElementById('commentNotificationCount');
  elements.commentNotificationPanel = document.getElementById('commentNotificationPanel');
  elements.commentNotificationList = document.getElementById('commentNotificationList');
  elements.commentNotificationRefresh = document.getElementById('commentNotificationRefresh');
  elements.mod1RouteFilters = document.getElementById('mod1RouteFilters');
  elements.showMaxiRoutes = document.getElementById('showMaxiRoutes');
  elements.showRd03Routes = document.getElementById('showRd03Routes');
  elements.mod1RouteStatus = document.getElementById('mod1RouteStatus');
  elements.filterAreaToggle = document.getElementById('filterAreaToggle');
  elements.filterAreaPanel = document.getElementById('filterAreaPanel');
  elements.filterAreaOptions = document.getElementById('filterAreaOptions');
  elements.clearAreaFilter = document.getElementById('clearAreaFilter');

  const filterElements = {
    regional: document.getElementById('filterRegional'),
    area: document.getElementById('filterArea'),
    province: document.getElementById('filterProvince'),
    grade: document.getElementById('filterGrade'),
    type: document.getElementById('filterType'),
    owner: document.getElementById('filterOwner')
  };
  const FILTER_CASCADE_ORDER = Object.keys(filterElements);
  const THAILAND_BOUNDS = L.latLngBounds([5.4, 97.2], [20.7, 105.7]);

  const map = L.map('mod2Map', { zoomControl: true, preferCanvas: true }).setView([13.2, 101.2], 6);
  map.createPane('mod1RoutePane');
  map.getPane('mod1RoutePane').style.zIndex = '450';
  const lightMapUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const darkMapUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const fallbackMapUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  let usingFallbackMap = false;
  let tileErrors = 0;
  let tileLoaded = false;
  const useFallbackMap = () => {
    if (usingFallbackMap) return;
    usingFallbackMap = true;
    baseMapLayer.setUrl(fallbackMapUrl);
  };
  const baseMapLayer = L.tileLayer(document.documentElement.dataset.theme === 'dark' ? darkMapUrl : lightMapUrl, {
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    crossOrigin: true
  })
    .on('tileload', () => { tileLoaded = true; tileErrors = 0; })
    .on('tileerror', () => { tileErrors += 1; if (tileErrors >= 3) useFallbackMap(); })
    .addTo(map);
  window.setTimeout(() => { if (!tileLoaded) useFallbackMap(); }, 2600);
  window.addEventListener('permission-theme-change', event => {
    if (!usingFallbackMap) baseMapLayer.setUrl(event.detail.theme === 'dark' ? darkMapUrl : lightMapUrl);
  });
  const siteLayer = L.layerGroup().addTo(map);
  const overviewHexLayer = L.layerGroup().addTo(map);
  const mod1RouteLayers = {
    maxi: L.layerGroup().addTo(map),
    rd03: L.layerGroup().addTo(map)
  };
  const mod1CatalogCache = new Map();
  const mod1DatasetCache = new Map();
  let searchTimer = 0;
  let notificationTimer = 0;
  let mapRenderFrame = 0;
  let mapAutoFocusFrame = 0;
  let mapFocusInProgress = false;
  const markerIconCache = new Map();
  const mapCard = document.querySelector('.map-card');
  const mapRenderer = L.canvas({ padding: .35 });
  const mod1RouteRenderer = L.canvas({ pane: 'mod1RoutePane', padding: .25, tolerance: 10 });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function toast(message, type = '') {
    const item = document.createElement('div');
    item.className = `mod2-toast${type ? ` is-${type}` : ''}`;
    item.textContent = message;
    elements.toastRegion.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function modulePermissions(profile = state.profile) {
    const role = profile?.role || 'user';
    const source = profile?.permissions || {};
    return Object.fromEntries(MODULES.map(module => {
      const permission = source[module.key] || {};
      return [module.key, {
        view: role === 'admin' || permission.view !== false,
        update: role === 'admin' || permission.update === true
      }];
    }));
  }

  function canUpdateMod2() {
    return modulePermissions().mod2?.update === true;
  }

  function isAdmin() {
    return state.profile?.role === 'admin';
  }

  function canManageMod2Comments() {
    return isAdmin() || canUpdateMod2();
  }

  function setHealth(text, type = '') {
    elements.datasetStatus.textContent = text;
    const health = elements.datasetStatus.closest('.mod2-health');
    health.classList.toggle('is-ready', type === 'ready');
    health.classList.toggle('is-error', type === 'error');
  }

  function setLoading(visible, detail = '') {
    elements.mapLoading.hidden = !visible;
    if (detail) elements.loadingDetail.textContent = detail;
  }

  function openModal(title, subtitle, content, closeable = true) {
    elements.modalTitle.textContent = title;
    elements.modalSubtitle.textContent = subtitle || '';
    elements.modalBody.replaceChildren(content);
    elements.modalClose.hidden = !closeable;
    elements.modalBackdrop.hidden = false;
  }

  function closeModal(force = false) {
    if (!force && elements.modalClose.hidden) return;
    elements.modalBackdrop.hidden = true;
    elements.modalBody.replaceChildren();
  }

  function setSidebarCollapsed(collapsed, { persist = true } = {}) {
    const isCollapsed = Boolean(collapsed);
    elements.workspace?.classList.toggle('is-sidebar-collapsed', isCollapsed);
    elements.sidebarToggle?.setAttribute('aria-expanded', String(!isCollapsed));
    if (elements.sidebarToggle) {
      const label = isCollapsed ? 'แสดง Sidebar' : 'ซ่อน Sidebar';
      elements.sidebarToggle.title = label;
      elements.sidebarToggle.setAttribute('aria-label', label);
    }
    if (persist) {
      try {
        window.sessionStorage.setItem('permission-out:mod2-sidebar-collapsed', String(isCollapsed));
      } catch { /* storage may be unavailable */ }
    }
    window.setTimeout(() => map.invalidateSize({ animate: false }), 240);
  }

  function restoreSidebarState() {
    let collapsed = window.matchMedia('(max-width: 820px)').matches;
    try {
      const stored = window.sessionStorage.getItem('permission-out:mod2-sidebar-collapsed');
      if (stored !== null) collapsed = stored === 'true';
    } catch { /* use expanded state */ }
    setSidebarCollapsed(collapsed, { persist: false });
  }

  function setLegendExpanded(expanded, { persist = true } = {}) {
    const isExpanded = Boolean(expanded);
    elements.mapLegendToggle?.setAttribute('aria-expanded', String(isExpanded));
    if (elements.mapLegendPanel) elements.mapLegendPanel.hidden = !isExpanded;
    if (persist) {
      try {
        window.sessionStorage.setItem('permission-out:mod2-legend-expanded', String(isExpanded));
      } catch { /* storage may be unavailable */ }
    }
  }

  function restoreLegendState() {
    let expanded = false;
    try {
      expanded = window.sessionStorage.getItem('permission-out:mod2-legend-expanded') === 'true';
    } catch { /* use collapsed state */ }
    setLegendExpanded(expanded, { persist: false });
  }

  async function loadProfile(user) {
    const latestUser = await client.auth.getUser().then(({ data }) => data.user).catch(() => null);
    const authUser = latestUser?.id === user.id ? latestUser : user;
    state.user = authUser;
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
    const profile = result.data || {};
    const metadata = authUser.app_metadata || {};
    const isActive = metadata.permission_out_active === undefined
      ? profile.is_active !== false
      : metadata.permission_out_active !== false;
    if (!isActive) throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    return {
      displayName: profile.display_name || authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'Account',
      organization: profile.organization || '',
      role: (metadata.permission_out_role || profile.role) === 'admin' ? 'admin' : 'user',
      permissions: profile.permissions || metadata.permission_out_permissions || null
    };
  }

  function updateAccountUi() {
    if (state.user) {
      elements.accountLabel.textContent = state.profile?.displayName || state.user.email?.split('@')[0] || 'Account';
      elements.accountMeta.textContent = state.profile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
      elements.userInitial.textContent = (state.user.email?.[0] || 'U').toUpperCase();
    } else {
      elements.accountLabel.textContent = cloudEnabled ? 'เข้าสู่ระบบ' : 'ไม่พร้อมใช้งาน';
      elements.accountMeta.textContent = cloudEnabled ? 'ยังไม่เข้าสู่ระบบ' : 'ยังไม่ได้ตั้งค่า Cloud';
      elements.userInitial.textContent = cloudEnabled ? 'G' : '!';
    }
  }

  function showAuth(initialError = '') {
    const target = new URL('/login/', location.origin);
    target.searchParams.set('returnTo', `${location.pathname}${location.search}`);
    if (initialError) target.searchParams.set('reason', 'session_expired');
    location.replace(target);
  }

  function showAccount() {
    if (!state.user) {
      if (client) showAuth();
      return;
    }
    const content = document.createElement('div');
    const summary = document.createElement('div');
    summary.className = 'account-summary';
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.textContent = (state.user.email?.[0] || 'U').toUpperCase();
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = state.profile?.displayName || state.user.email;
    const meta = document.createElement('span');
    meta.textContent = `${state.profile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน'}${state.profile?.organization ? ` · ${state.profile.organization}` : ''}`;
    copy.append(name, meta);
    summary.append(avatar, copy);
    const mod1 = document.createElement('a');
    mod1.className = 'modal-secondary';
    mod1.href = '/';
    mod1.textContent = 'ไป MOD 1 · วิเคราะห์ PEA / UFM';
    mod1.style.display = 'grid';
    mod1.style.placeItems = 'center';
    mod1.style.textDecoration = 'none';
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    if (state.profile?.role === 'admin') {
      const permissions = document.createElement('button');
      permissions.className = 'modal-primary';
      permissions.type = 'button';
      permissions.textContent = 'จัดการผู้ใช้และสิทธิ์';
      permissions.addEventListener('click', () => window.permissionOutOpenAdminUsers?.());
      actions.appendChild(permissions);
    }
    const signout = document.createElement('button');
    signout.className = 'modal-danger';
    signout.type = 'button';
    signout.textContent = 'ออกจากระบบ';
    signout.addEventListener('click', async () => {
      await client.auth.signOut();
      closeModal(true);
    });
    actions.appendChild(signout);
    content.append(summary, mod1, actions);
    openModal('บัญชีผู้ใช้', state.user.email || '', content, true);
  }

  async function authenticatedFetch(path, options = {}) {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      cache: 'no-store',
      ...options,
      headers
    });
  }

  async function authenticatedJson(path, options = {}) {
    const response = await authenticatedFetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function mod1AssetUrl(prefix, path) {
    const encodedPath = String(path || '').split('/').map(encodeURIComponent).join('/');
    return `/api/data/assets/${prefix}/v1/${encodedPath}`;
  }

  function normalizedDatasetName(item) {
    return String(item?.canonicalName || item?.name || '')
      .replace(/\.(?:kml|kmz)$/i, '')
      .normalize('NFKC')
      .toUpperCase();
  }

  function datasetMatchesArea(item, type, area) {
    const name = normalizedDatasetName(item);
    if (type === 'rd03') {
      const regionalCounts = new Map();
      state.sites.filter(site => site.area === area).forEach(site => {
        const regional = String(site.regional || '').trim().toUpperCase();
        if (regional) regionalCounts.set(regional, (regionalCounts.get(regional) || 0) + 1);
      });
      const regional = [...regionalCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
      const regionCode = /NORTH\s*EAST|NORTHEAST/.test(regional) ? 'NE'
        : /NORTH/.test(regional) ? 'N'
          : /SOUTH/.test(regional) ? 'S' : 'C';
      const isRd03 = /RD[\s_-]*0?3/.test(name) || String(item?.group || '').trim().toLowerCase() === 'rd03';
      return isRd03 && new RegExp(`RD[\\s_-]*0?3[\\s_-]*${regionCode}[1-3](?:[^A-Z0-9]|$)`).test(name);
    }
    const escapedArea = String(area).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedArea) return false;
    const hasAreaToken = new RegExp(`(?:^|[^A-Z0-9])${escapedArea}(?:[^A-Z0-9]|$)`).test(name);
    const hasDatasetType = /MAXI(?:FIBER)?/.test(name);
    return hasAreaToken && hasDatasetType;
  }

  function routeAreaBounds(area) {
    const sites = state.sites.filter(site => site.area === area);
    if (!sites.length) return null;
    const bounds = L.latLngBounds(sites.map(site => [site.latitude, site.longitude]));
    const latitudePadding = Math.max(.06, (bounds.getNorth() - bounds.getSouth()) * .12);
    const longitudePadding = Math.max(.06, (bounds.getEast() - bounds.getWest()) * .12);
    return {
      minLat: bounds.getSouth() - latitudePadding,
      maxLat: bounds.getNorth() + latitudePadding,
      minLng: bounds.getWest() - longitudePadding,
      maxLng: bounds.getEast() + longitudePadding
    };
  }

  function routeIntersectsArea(line, bounds) {
    if (!bounds || !Array.isArray(line?.c) || !line.c.length) return false;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const point of line.c) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
    return minLng <= bounds.maxLng && maxLng >= bounds.minLng
      && minLat <= bounds.maxLat && maxLat >= bounds.minLat;
  }

  async function mod1Catalog(source) {
    if (!mod1CatalogCache.has(source)) {
      const assetPrefix = source === 'ufm' ? 'ufm' : 'uih-20072026';
      mod1CatalogCache.set(source, Promise.all([
        authenticatedJson(`/api/data/catalog?source=${encodeURIComponent(source)}`).catch(() => ({ items: [] })),
        authenticatedJson(mod1AssetUrl(assetPrefix, 'manifest.json')).catch(() => ({ items: [] }))
      ])
        .then(([managed, legacy]) => {
          const managedItems = Array.isArray(managed.items) ? managed.items : [];
          const managedNames = new Set(managedItems.map(normalizedDatasetName));
          const legacyItems = (Array.isArray(legacy.items) ? legacy.items : [])
            .filter(item => !managedNames.has(normalizedDatasetName(item)))
            .map(item => ({ ...item, assetPrefix }));
          return [...managedItems, ...legacyItems];
        })
        .catch(error => {
          mod1CatalogCache.delete(source);
          throw error;
        }));
    }
    return mod1CatalogCache.get(source);
  }

  async function mod1DatasetLines(dataset) {
    const cacheKey = dataset.managed
      ? `${dataset.id}:v${dataset.versionNo || 0}`
      : `${dataset.assetPrefix}:${dataset.analysisPath}`;
    if (!mod1DatasetCache.has(cacheKey)) {
      mod1DatasetCache.set(cacheKey, (async () => {
        if (!dataset.managed) {
          if (!dataset.analysisPath) return [];
          const response = await authenticatedFetch(mod1AssetUrl(dataset.assetPrefix, dataset.analysisPath));
          if (!response.ok) throw new Error(`${dataset.name}: HTTP ${response.status}`);
          if (!response.body || typeof DecompressionStream === 'undefined') {
            throw new Error('Browser does not support optimized KML/KMZ data');
          }
          const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
          const payload = await new Response(stream).json();
          return Array.isArray(payload.lines) ? payload.lines : [];
        }
        const lines = [];
        let offset = 0;
        do {
          const payload = await authenticatedJson(`/api/data/datasets/${encodeURIComponent(dataset.id)}/features?offset=${offset}&limit=500`);
          lines.push(...(payload.lines || []));
          offset = payload.nextOffset;
        } while (offset !== null && offset !== undefined);
        return lines;
      })().catch(error => {
        mod1DatasetCache.delete(cacheKey);
        throw error;
      }));
    }
    return mod1DatasetCache.get(cacheKey);
  }

  function mod1RouteCategory(line, dataset) {
    const properties = line?.p && typeof line.p === 'object' ? line.p : {};
    const categoryText = [
      properties.import_category,
      properties.importCategory,
      properties.category,
      properties.Category,
      properties.status,
      properties.Status,
      ...Object.keys(properties),
      ...Object.values(properties),
      line?.n,
      dataset?.name,
      dataset?.canonicalName
    ].filter(value => value !== null && value !== undefined).join(' ').normalize('NFKC');
    if (/ready[\s_-]*access|พร้อม\s*(?:เชื่อมต่อ|ให้บริการ|ใช้งาน)/i.test(categoryText)) return 'ready-access';
    if (/customer|subscriber|ลูกค้า|ผู้ใช้บริการ/i.test(categoryText)) return 'customer';
    return 'network';
  }

  function mod1RouteCategoryLabel(category) {
    return ({ network: 'Network', 'ready-access': 'Ready Access', customer: 'Customer' })[category] || 'Network';
  }

  function routeProperty(properties, aliases) {
    const normalized = new Map(Object.entries(properties || {}).map(([key, value]) => [String(key).replace(/[\s_-]+/g, '').toLowerCase(), value]));
    for (const alias of aliases) {
      const value = normalized.get(String(alias).replace(/[\s_-]+/g, '').toLowerCase());
      if (hasPopupValue(value)) return value;
    }
    const description = String(properties?.description || properties?.Description || '');
    if (description) {
      const descriptionValues = new Map();
      description.split(/\r?\n|<br\s*\/?\s*>/i).forEach(row => {
        const match = row.match(/^\s*([^:：]+)\s*[:：]\s*(.*?)\s*$/);
        if (!match || !match[2]) return;
        descriptionValues.set(match[1].replace(/[\s_-]+/g, '').toLowerCase(), match[2].trim());
      });
      for (const alias of aliases) {
        const value = descriptionValues.get(String(alias).replace(/[\s_-]+/g, '').toLowerCase());
        if (hasPopupValue(value)) return value;
      }
    }
    return '';
  }

  function routeLengthLabel(value) {
    if (!hasPopupValue(value)) return '';
    const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return String(value);
    const meters = Number(match[0]);
    if (!Number.isFinite(meters)) return String(value);
    return meters >= 1000
      ? `${(meters / 1000).toLocaleString('th-TH', { maximumFractionDigits: 2 })} km`
      : `${meters.toLocaleString('th-TH', { maximumFractionDigits: 1 })} m`;
  }

  function mod1RoutePopup(type, dataset, line, category, color) {
    const properties = line.p && typeof line.p === 'object' ? line.p : {};
    const routeName = line.n || routeProperty(properties, ['name', 'original_name']) || dataset.name;
    const code = routeProperty(properties, ['code', 'tag', 'route_code', 'id']);
    const status = routeProperty(properties, ['status', 'cable_status', 'line_status']);
    const measured = routeProperty(properties, ['measured', 'length']);
    const calculated = routeProperty(properties, ['calculated']);
    const diameter = routeProperty(properties, ['diameter_mm', 'diameter']);
    const core = routeProperty(properties, ['core', 'core_count']);
    const cableType = routeProperty(properties, ['cable_type', 'type']);
    const cableDetail = routeProperty(properties, ['cable_detail', 'detail']);
    const distanceLabel = routeLengthLabel(measured || calculated);
    const sourceFile = routeProperty(properties, ['source_file']) || dataset.name;
    const cableRows = [
      ['รหัสสาย', code],
      ['Type', cableType],
      ['รายละเอียดสาย', cableDetail],
      ['Core', core],
      ['Diameter', diameter ? `${diameter} mm` : ''],
      ['Distance', routeLengthLabel(measured)],
      ['ระยะคำนวณ', routeLengthLabel(calculated)],
      ['Category', mod1RouteCategoryLabel(category)],
      ['Status', status],
      ['จำนวนเสา', routeProperty(properties, ['pole_count'])],
      ['วันที่ติดตั้ง', routeProperty(properties, ['date_install', 'install_date'])]
    ];
    const referenceRows = [
      ['เจ้าของ', routeProperty(properties, ['owner'])],
      ['การไฟฟ้า', routeProperty(properties, ['pea'])],
      ['จังหวัด', routeProperty(properties, ['province'])],
      ['UIH Area', [...selectedValues(filterElements.area)].join(', ')],
      ['ไฟล์ต้นทาง', sourceFile],
      ['Dataset', dataset.name]
    ];
    return `<article class="facility-popup mod1-route-detail" style="--route-color:${escapeHtml(color)}">
      <header class="facility-popup-header mod1-route-header">
        <div class="facility-popup-identity">
          <div class="facility-popup-kicker"><span>MOD 1 Fiber Route</span><b>${escapeHtml(type === 'maxi' ? 'Maxi' : 'RD03')}</b></div>
          <div class="facility-popup-code">${escapeHtml(code || mod1RouteCategoryLabel(category))}</div>
          <h3 title="${escapeHtml(routeName)}">${escapeHtml(routeName)}</h3>
          <p>${escapeHtml(sourceFile)}</p>
        </div>
      </header>
      <div class="facility-popup-metrics mod1-route-metrics" aria-label="ข้อมูล Type Core Diameter และ Distance จาก KML/KMZ">
        <div title="${escapeHtml(cableType || 'ไม่มีข้อมูลใน KML/KMZ')}"><span>Type</span><strong>${escapeHtml(cableType || '—')}</strong></div>
        <div title="${escapeHtml(core || 'ไม่มีข้อมูลใน KML/KMZ')}"><span>Core</span><strong>${escapeHtml(core || '—')}</strong></div>
        <div title="${escapeHtml(diameter ? `${diameter} mm` : 'ไม่มีข้อมูลใน KML/KMZ')}"><span>Diameter</span><strong>${escapeHtml(diameter ? `${diameter} mm` : '—')}</strong></div>
        <div title="${escapeHtml(distanceLabel || 'ไม่มีข้อมูลใน KML/KMZ')}"><span>Distance</span><strong>${escapeHtml(distanceLabel || '—')}</strong></div>
      </div>
      <div class="facility-popup-content"><div class="facility-popup-grid">
        <details class="facility-popup-group is-wide" open>
          <summary><span class="facility-popup-group-icon" aria-hidden="true">⌁</span><span><strong>ข้อมูลสาย</strong><small>ชนิด ขนาด และระยะทาง</small></span></summary>
          <div class="facility-popup-info">${popupRows(cableRows)}</div>
        </details>
        <details class="facility-popup-group is-wide">
          <summary><span class="facility-popup-group-icon" aria-hidden="true">▤</span><span><strong>ข้อมูลอ้างอิง</strong><small>พื้นที่ เจ้าของ และไฟล์ต้นทาง</small></span></summary>
          <div class="facility-popup-info">${popupRows(referenceRows)}</div>
        </details>
      </div></div>
    </article>`;
  }

  function renderMod1Route(type, dataset, line) {
    if (!Array.isArray(line.c) || line.c.length < 2) return;
    const category = mod1RouteCategory(line, dataset);
    const color = MOD1_ROUTE_COLORS[type]?.[category] || '#94a3b8';
    const route = L.polyline(line.c.map(point => [Number(point[1]), Number(point[0])]), {
      color,
      weight: type === 'maxi' ? 3.2 : 2.7,
      opacity: .86,
      interactive: true,
      bubblingMouseEvents: false,
      pane: 'mod1RoutePane',
      renderer: mod1RouteRenderer
    });
    route.on('click', event => {
      L.DomEvent.stopPropagation(event.originalEvent);
      L.popup({
          minWidth: 300, maxWidth: 430, autoPanPaddingTopLeft: [24, 88], autoPanPaddingBottomRight: [24, 24], keepInView: false
        })
        .setLatLng(event.latlng)
        .setContent(mod1RoutePopup(type, dataset, line, category, color))
        .openOn(map);
    });
    route.addTo(mod1RouteLayers[type]);
  }

  async function loadMod1RouteType(type, area, requestId) {
    const source = type === 'maxi' ? 'ufm' : 'pea';
    const catalog = await mod1Catalog(source);
    if (requestId !== state.routeRequest) return { datasets: 0, lines: 0 };
    const datasets = catalog.filter(item => datasetMatchesArea(item, type, area));
    const areaBounds = type === 'rd03' ? routeAreaBounds(area) : null;
    let lineCount = 0;
    let matchedDatasets = 0;
    for (const dataset of datasets) {
      const sourceLines = await mod1DatasetLines(dataset);
      if (requestId !== state.routeRequest) return { datasets: 0, lines: 0 };
      const lines = type === 'rd03'
        ? sourceLines.filter(line => routeIntersectsArea(line, areaBounds))
        : sourceLines;
      if (lines.length) matchedDatasets += 1;
      lines.forEach(line => renderMod1Route(type, dataset, line));
      lineCount += lines.length;
    }
    return { datasets: matchedDatasets, lines: lineCount };
  }

  async function syncMod1RouteLayers() {
    const areas = [...selectedValues(filterElements.area)];
    const areaLabel = areas.join(', ');
    const enabledTypes = [
      elements.showMaxiRoutes?.checked ? 'maxi' : '',
      elements.showRd03Routes?.checked ? 'rd03' : ''
    ].filter(Boolean);
    const requestId = ++state.routeRequest;
    Object.values(mod1RouteLayers).forEach(layer => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      layer.clearLayers();
    });
    elements.mod1RouteFilters.disabled = !areas.length;
    if (!areas.length) {
      elements.showMaxiRoutes.checked = false;
      elements.showRd03Routes.checked = false;
      elements.mod1RouteStatus.textContent = 'เลือก UIH Area ก่อนเพื่อแสดงเส้นทาง';
      state.routeArea = '';
      return;
    }
    state.routeArea = areaLabel;
    if (!enabledTypes.length) {
      elements.mod1RouteStatus.textContent = `เลือก Maxi หรือ RD03 สำหรับพื้นที่ ${areaLabel}`;
      return;
    }
    elements.mod1RouteFilters.disabled = true;
    elements.mod1RouteStatus.textContent = `กำลังโหลดเส้นทาง ${enabledTypes.map(type => type === 'maxi' ? 'Maxi' : 'RD03').join(' + ')} · ${areas.length} Area…`;
    try {
      const results = await Promise.all(areas.flatMap(area => enabledTypes.map(type => loadMod1RouteType(type, area, requestId))));
      if (requestId !== state.routeRequest) return;
      const datasetCount = results.reduce((sum, result) => sum + result.datasets, 0);
      const lineCount = results.reduce((sum, result) => sum + result.lines, 0);
      elements.mod1RouteStatus.textContent = datasetCount
        ? `แสดง ${lineCount.toLocaleString('th-TH')} เส้น จาก ${datasetCount.toLocaleString('th-TH')} ชุดข้อมูล · ${areas.length} Area`
        : `ไม่พบชุดข้อมูล Maxi/RD03 ที่ตรงกับ ${areaLabel}`;
    } catch (error) {
      if (requestId !== state.routeRequest) return;
      elements.mod1RouteStatus.textContent = `โหลดเส้นทางไม่สำเร็จ: ${error.message}`;
      toast(`โหลดข้อมูล MOD 1 ไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      if (requestId === state.routeRequest) {
        enabledTypes.forEach(type => mod1RouteLayers[type].addTo(map));
        elements.mod1RouteFilters.disabled = false;
      }
    }
  }

  function featureToSite(feature) {
    const properties = feature?.properties || {};
    const futureProperties = properties.extra_properties && typeof properties.extra_properties === 'object' && !Array.isArray(properties.extra_properties)
      ? properties.extra_properties
      : {};
    const sourceProperties = { ...properties, ...futureProperties };
    delete sourceProperties.extra_properties;
    const coordinates = feature?.geometry?.coordinates || [];
    return {
      id: feature.id,
      siteCode: String(properties.site_code || ''),
      siteName: String(properties.site_name || ''),
      type: String(properties.type_of_digit || ''),
      grade: String(properties.site_grade || ''),
      regional: String(properties.regional || ''),
      area: String(properties.uih_area || ''),
      district: String(properties.district || ''),
      province: String(properties.province || ''),
      latitude: Number(properties.latitude ?? coordinates[1]),
      longitude: Number(properties.longitude ?? coordinates[0]),
      customers: Number(properties.customers || 0),
      nodeEquipment: String(properties.node_equipment || ''),
      owner: String(properties.owner || ''),
      opex: Number(properties.opex || 0),
      contractExpired: String(properties.contract_expired || ''),
      sdhTopology: String(properties.sdh_topology || ''),
      lswTopology: String(properties.lsw_topology || ''),
      dslamTopology: String(properties.dslam_topology || ''),
      siteType: String(properties.site_type || ''),
      remark: String(properties.remark || ''),
      sourceProperties
    };
  }

  async function loadSites(force = false) {
    if (!state.user || state.loading || (state.loaded && !force)) return;
    state.loading = true;
    setLoading(true, 'กำลังอ่านข้อมูลจาก Supabase…');
    setHealth('กำลังโหลด');
    elements.reloadBtn.disabled = true;
    try {
      const sites = [];
      let after = 0;
      let page = 0;
      do {
        const payload = await authenticatedJson(`/api/mod2/sites?after=${after}&limit=500`);
        const pageSites = (payload.features || []).map(featureToSite).filter(site => (
          site.siteCode && Number.isFinite(site.latitude) && Number.isFinite(site.longitude)
        ));
        sites.push(...pageSites);
        after = Number(payload.nextAfter || 0);
        page += 1;
        elements.loadingDetail.textContent = `โหลดแล้ว ${sites.length.toLocaleString('th-TH')} sites`;
        if (!payload.count || Number(payload.count) < 500 || !payload.nextAfter) break;
        if (page > 20) throw new Error('ข้อมูลแบ่งหน้ามากกว่าที่ระบบรองรับ');
      } while (after > 0);

      state.sites = sites;
      state.loaded = true;
      populateFilters();
      applyFilters(false);
      fitAll();
      setHealth(`${sites.length.toLocaleString('th-TH')} sites`, 'ready');
      toast(`โหลดข้อมูล MOD 2 สำเร็จ ${sites.length.toLocaleString('th-TH')} sites`, 'success');
    } catch (error) {
      setHealth('โหลดไม่สำเร็จ', 'error');
      elements.loadingDetail.textContent = error.message;
      if (error.status === 401) {
        await client.auth.signOut({ scope: 'local' });
        showAuth('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      } else {
        toast(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`, 'error');
      }
      throw error;
    } finally {
      state.loading = false;
      setLoading(false);
      elements.reloadBtn.disabled = false;
    }
  }

  function uniqueValues(key, sites = state.sites) {
    return [...new Set(sites.map(site => site[key]).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'th'));
  }

  function selectedValues(select) {
    return new Set([...select.selectedOptions].map(option => option.value).filter(Boolean));
  }

  function renderAreaDropdown() {
    const selected = selectedValues(filterElements.area);
    const options = [...filterElements.area.options];
    elements.filterAreaToggle.textContent = selected.size === 0
      ? 'ทั้งหมด'
      : selected.size === 1 ? [...selected][0] : `เลือก ${selected.size.toLocaleString('th-TH')} Area`;
    elements.filterAreaToggle.title = selected.size ? [...selected].join(', ') : 'ทั้งหมด';
    const fragment = document.createDocumentFragment();
    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'filter-area-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.value;
      checkbox.checked = option.selected;
      checkbox.addEventListener('change', () => {
        option.selected = checkbox.checked;
        filterElements.area.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const text = document.createElement('span');
      text.textContent = option.textContent;
      label.append(checkbox, text);
      fragment.appendChild(label);
    }
    elements.filterAreaOptions.replaceChildren(fragment);
  }

  function populateFilters() {
    const upstreamSelections = {};
    for (const key of FILTER_CASCADE_ORDER) {
      const select = filterElements[key];
      const selected = selectedValues(select);
      const candidateSites = state.sites.filter(site =>
        Object.entries(upstreamSelections).every(([upstreamKey, values]) =>
          !values.size || values.has(site[upstreamKey])
        )
      );
      const availableValues = uniqueValues(key, candidateSites);
      const nextValues = new Set([...selected].filter(value => availableValues.includes(value)));
      const fragment = document.createDocumentFragment();
      if (!select.multiple) {
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'ทั้งหมด';
        fragment.appendChild(allOption);
      }
      for (const value of availableValues) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = nextValues.has(value);
        fragment.appendChild(option);
      }
      select.replaceChildren(fragment);
      upstreamSelections[key] = nextValues;
    }
    renderAreaDropdown();
  }

  function applyFilters(autoFit = false) {
    const query = elements.mapSiteSearch.value.trim().toLocaleLowerCase('th');
    const selections = Object.fromEntries(
      Object.entries(filterElements).map(([key, select]) => [key, selectedValues(select)])
    );
    const filterScope = state.sites.filter(site =>
      Object.entries(selections).every(([key, values]) => !values.size || values.has(site[key]))
    );
    state.filtered = filterScope.filter(site => {
      if (query) {
        const haystack = [
          site.siteCode,
          site.siteName,
          site.province,
          site.district,
          site.regional,
          site.area,
          site.grade,
          site.nodeEquipment,
          site.owner
        ].join(' ').toLocaleLowerCase('th');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    state.searchActive = Boolean(query);
    state.mapSites = state.searchActive ? buildSearchContext(filterScope, state.filtered) : state.filtered;
    updateMetrics();
    updateActiveFilters(query, selections);
    renderMap();
    renderLegend();
    if (autoFit && state.filtered.length) scheduleFilteredMapFocus();
  }

  function distanceKm(left, right) {
    const toRadians = value => value * Math.PI / 180;
    const latitudeDelta = toRadians(right.latitude - left.latitude);
    const longitudeDelta = toRadians(right.longitude - left.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(left.latitude)) * Math.cos(toRadians(right.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function buildSearchContext(scope, matches) {
    if (!matches.length || matches.length >= 25) return matches;
    const matchIds = new Set(matches.map(site => String(site.id)));
    const nearby = scope
      .filter(site => !matchIds.has(String(site.id)))
      .map(site => ({
        site,
        distance: Math.min(...matches.map(match => distanceKm(match, site)))
      }))
      .filter(item => item.distance <= 40)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 180)
      .map(item => item.site);
    return [...matches, ...nearby];
  }

  function updateActiveFilters(query, selections) {
    const labels = {
      regional: 'Regional',
      area: 'UIH Area',
      province: 'จังหวัด',
      grade: 'Site Grade',
      type: 'Type',
      owner: 'Owner'
    };
    const chips = [];
    if (query) chips.push({ label: 'ค้นหา', value: elements.mapSiteSearch.value.trim() });
    for (const [key, values] of Object.entries(selections)) {
      for (const value of values) chips.push({ label: labels[key] || key, value });
    }
    elements.mapFilterBar.hidden = chips.length === 0;
    elements.activeFilterChips.replaceChildren(...chips.map(chip => {
      const item = document.createElement('span');
      item.className = 'map-filter-chip';
      const label = document.createElement('b');
      label.textContent = chip.label;
      const value = document.createElement('span');
      value.textContent = chip.value;
      item.append(label, value);
      return item;
    }));
  }

  function resetAllFilters({ focusSearch = false, autoFit = true } = {}) {
    window.clearTimeout(searchTimer);
    syncSiteSearch('');
    for (const select of Object.values(filterElements)) {
      [...select.options].forEach(option => { option.selected = false; });
      if (!select.multiple) select.value = '';
    }
    populateFilters();
    applyFilters(autoFit);
    syncMod1RouteLayers();
    if (focusSearch) elements.mapSiteSearch.focus();
  }

  function gradeColor(grade) {
    return GRADE_COLORS[grade] || '#64748b';
  }

  function updateMetrics() {
    const sites = state.filtered;
    elements.metricSites.textContent = sites.length.toLocaleString('th-TH');
    elements.metricCustomers.textContent = sites.reduce((sum, site) => sum + site.customers, 0).toLocaleString('th-TH');
    elements.metricNodes.textContent = new Set(sites.map(site => site.nodeEquipment).filter(Boolean)).size.toLocaleString('th-TH');
    elements.metricOwners.textContent = new Set(sites.map(site => site.owner).filter(Boolean)).size.toLocaleString('th-TH');
    elements.mapSearchCount.textContent = sites.length.toLocaleString('th-TH');
    elements.mapSearchCount.setAttribute('aria-label', `พบ ${sites.length.toLocaleString('th-TH')} ไซต์`);
    const nearbyCount = state.searchActive ? Math.max(0, state.mapSites.length - sites.length) : 0;
    if (elements.mapContextStatus) {
      elements.mapContextStatus.hidden = !nearbyCount;
      elements.mapContextStatus.textContent = `+${nearbyCount.toLocaleString('th-TH')} รอบข้าง`;
    }
    elements.opexReportBtn.hidden = !isAdmin();
    elements.mapEmptyState.hidden = sites.length > 0 || !state.loaded;
    elements.overviewSiteCount.textContent = sites.length.toLocaleString('th-TH');
    elements.overviewProvinceCount.textContent = new Set(sites.map(site => site.province).filter(Boolean)).size.toLocaleString('th-TH');
    elements.overviewCustomerCount.textContent = sites.reduce((sum, site) => sum + site.customers, 0).toLocaleString('th-TH');
    const selectedAreas = [...selectedValues(filterElements.area)];
    const activeArea = filterElements.province.value || (selectedAreas.length ? selectedAreas.join(', ') : '') || filterElements.regional.value;
    elements.overviewScopeLabel.textContent = activeArea ? `ขอบเขต: ${activeArea}` : 'ภาพรวม Site ทั่วประเทศไทย';
  }

  function formatBaht(value) {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function opexReportContent() {
    const content = document.createElement('div');
    content.className = 'opex-report-popup';
    content.innerHTML = `
      <div class="opex-report-controls">
        <label>ช่วงรายงาน
          <select data-opex-period>
            <option value="month">รายเดือน</option>
            <option value="year">รายปี</option>
          </select>
        </label>
        <label>จัดกลุ่มตาม
          <select data-opex-group>
            <option value="province">จังหวัด</option>
            <option value="regional">Regional</option>
            <option value="area">UIH Area</option>
            <option value="owner">Owner</option>
          </select>
        </label>
      </div>
      <p class="opex-report-scope" data-opex-scope></p>
      <div class="opex-summary-grid">
        <article><span>OPEX รายเดือน</span><strong data-opex-monthly>—</strong><small>รวมตามตัวกรองปัจจุบัน</small></article>
        <article><span>OPEX รายปี</span><strong data-opex-yearly>—</strong><small>ประมาณการ 12 เดือน</small></article>
        <article><span>เฉลี่ยต่อไซต์ / เดือน</span><strong data-opex-average>—</strong><small data-opex-site-count>0 sites</small></article>
      </div>
      <div class="opex-table-wrap">
        <table>
          <thead><tr><th data-opex-group-heading>จังหวัด</th><th>จำนวนไซต์</th><th data-opex-amount-heading>OPEX รายเดือน</th><th>สัดส่วน</th></tr></thead>
          <tbody data-opex-body></tbody>
        </table>
      </div>`;
    const period = content.querySelector('[data-opex-period]');
    const groupBy = content.querySelector('[data-opex-group]');
    const render = () => renderOpexReport(content, period.value, groupBy.value);
    period.addEventListener('change', render);
    groupBy.addEventListener('change', render);
    render();
    return content;
  }

  function renderOpexReport(content, period, groupKey) {
    const sites = state.filtered;
    const monthly = sites.reduce((sum, site) => sum + (Number(site.opex) || 0), 0);
    const yearly = monthly * 12;
    const periodMultiplier = period === 'year' ? 12 : 1;
    const groupLabels = { province: 'จังหวัด', regional: 'Regional', area: 'UIH Area', owner: 'Owner' };
    const grouped = new Map();
    for (const site of sites) {
      const label = site[groupKey] || 'ไม่ระบุ';
      const current = grouped.get(label) || { count: 0, monthly: 0 };
      current.count += 1;
      current.monthly += Number(site.opex) || 0;
      grouped.set(label, current);
    }
    content.querySelector('[data-opex-monthly]').textContent = formatBaht(monthly);
    content.querySelector('[data-opex-yearly]').textContent = formatBaht(yearly);
    content.querySelector('[data-opex-average]').textContent = formatBaht(sites.length ? monthly / sites.length : 0);
    content.querySelector('[data-opex-site-count]').textContent = `${sites.length.toLocaleString('th-TH')} sites`;
    content.querySelector('[data-opex-scope]').textContent = `คำนวณจาก ${sites.length.toLocaleString('th-TH')} จาก ${state.sites.length.toLocaleString('th-TH')} sites ตามตัวกรองปัจจุบัน`;
    content.querySelector('[data-opex-group-heading]').textContent = groupLabels[groupKey] || groupKey;
    content.querySelector('[data-opex-amount-heading]').textContent = period === 'year' ? 'OPEX รายปี' : 'OPEX รายเดือน';
    const rows = [...grouped.entries()].sort((left, right) => right[1].monthly - left[1].monthly);
    content.querySelector('[data-opex-body]').innerHTML = rows.length
      ? rows.map(([label, values]) => {
        const amount = values.monthly * periodMultiplier;
        const share = monthly > 0 ? (values.monthly / monthly) * 100 : 0;
        return `<tr><td>${escapeHtml(label)}</td><td>${values.count.toLocaleString('th-TH')}</td><td>${escapeHtml(formatBaht(amount))}</td><td>${share.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%</td></tr>`;
      }).join('')
      : '<tr><td colspan="4" class="opex-empty">ไม่มีข้อมูลตามตัวกรองที่เลือก</td></tr>';
  }

  function openOpexReport() {
    if (!isAdmin()) return;
    openModal(
      'รายงาน OPEX',
      'ข้อมูลรายเดือนและรายปีตามตัวกรองบนแผนที่',
      opexReportContent(),
      true
    );
  }

  const STANDARD_SITE_PROPERTIES = new Set([
    'site_code', 'site_name', 'type_of_digit', 'site_grade', 'regional', 'uih_area',
    'district', 'province', 'latitude', 'longitude', 'customers', 'node_equipment',
    'owner', 'opex', 'remark'
  ]);

  function hasPopupValue(value) {
    return value !== '' && value !== null && value !== undefined &&
      (!Array.isArray(value) || value.length > 0) &&
      (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0);
  }

  function popupValue(value, options = {}) {
    if (!hasPopupValue(value)) return '—';
    if (options.currency) {
      const amount = Number(value);
      return Number.isFinite(amount)
        ? new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 }).format(amount)
        : String(value);
    }
    if (options.number) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString('th-TH') : String(value);
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map(item => popupValue(item)).join(', ');
    if (typeof value === 'object') return Object.entries(value)
      .map(([key, item]) => `${popupFieldLabel(key)}: ${popupValue(item)}`).join(' · ');
    return String(value);
  }

  function popupFieldLabel(key) {
    const labels = {
      site_code: 'Site Code', site_name: 'Site Name', type_of_digit: 'Site Type',
      site_grade: 'Site Grade', regional: 'Regional', uih_area: 'UIH Area',
      district: 'District', province: 'Province', latitude: 'Latitude',
      longitude: 'Longitude', customers: 'Customers', node_equipment: 'Node Equipment',
      owner: 'Owner', opex: 'OPEX', remark: 'Remark'
    };
    if (labels[key]) return labels[key];
    return String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function popupRows(rows) {
    const available = rows.filter(([, value]) => hasPopupValue(value));
    if (!available.length) return '<p class="facility-popup-empty">No information available</p>';
    return `<dl>${available.map(([label, value, options]) =>
      `<div class="facility-popup-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(popupValue(value, options))}</dd></div>`
    ).join('')}</dl>`;
  }

  function extraPopupProperties(site) {
    return Object.entries(site.sourceProperties || {})
      .filter(([key, value]) => !STANDARD_SITE_PROPERTIES.has(key) && hasPopupValue(value))
      .sort(([left], [right]) => left.localeCompare(right, 'th'));
  }

  function popupContent(site) {
    const locationRows = [
      ['Site grade (E)', site.grade],
      ['Contract Expired (K)', site.contractExpired],
      ['SDH : Topology (W)', site.sdhTopology],
      ['LSW : Topology (X)', site.lswTopology],
      ['DSLAM : Topology (Y)', site.dslamTopology],
      ['Site Type (AC)', site.siteType]
    ];
    const networkRows = [];
    const operationRows = isAdmin()
      ? [['Total OPEX / Year (V)', site.opex, { currency: true }]]
      : [];
    const extras = [];
    const popup = document.createElement('div');
    popup.className = 'facility-popup';
    popup.innerHTML = `
      <header class="facility-popup-header">
        <div class="facility-popup-identity">
          <div class="facility-popup-kicker"><span>Site Facility</span>${site.grade ? `<b style="--grade-color:${escapeHtml(gradeColor(site.grade))}">${escapeHtml(site.grade)}</b>` : ''}</div>
          <div class="facility-popup-code">${escapeHtml(site.siteCode)}</div>
          <h3>${escapeHtml(site.siteName || 'Unnamed site')}</h3>
          <p>${escapeHtml([site.district, site.province].filter(Boolean).join(' · ') || 'Location not available')}</p>
        </div>
        <div class="facility-popup-header-actions" aria-label="Quick actions">
          <button type="button" data-copy-value="${escapeHtml(site.siteCode)}" data-copy-label="Site Code">Copy Site Code</button>
          <button type="button" data-copy-value="${escapeHtml(`${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}`)}" data-copy-label="coordinates">Copy Coordinates</button>
        </div>
      </header>
      <div class="facility-popup-metrics" aria-label="Key information">
        <div><span>Customers</span><strong>${escapeHtml(popupValue(site.customers, { number: true }))}</strong></div>
        <div><span>Site Grade</span><strong>${escapeHtml(site.grade || '—')}</strong></div>
        <div><span>Site Type</span><strong>${escapeHtml(site.type || '—')}</strong></div>
      </div>
      <div class="facility-popup-content">
        <div class="facility-popup-grid">
          <details class="facility-popup-group" open>
            <summary>
              <span class="facility-popup-group-icon" aria-hidden="true">⌖</span>
              <span><strong>Location & Area</strong><small>${locationRows.filter(([, value]) => hasPopupValue(value)).length} items</small></span>
            </summary>
            <div class="facility-popup-info">${popupRows(locationRows)}</div>
          </details>
          <details class="facility-popup-group">
            <summary>
              <span class="facility-popup-group-icon" aria-hidden="true">◇</span>
              <span><strong>Network & Ownership</strong><small>${networkRows.filter(([, value]) => hasPopupValue(value)).length} items</small></span>
            </summary>
            <div class="facility-popup-info">${popupRows(networkRows)}</div>
          </details>
          <details class="facility-popup-group is-wide">
            <summary>
              <span class="facility-popup-group-icon" aria-hidden="true">▤</span>
              <span><strong>Operations</strong><small>${operationRows.filter(([, value]) => hasPopupValue(value)).length} items</small></span>
            </summary>
            <div class="facility-popup-info">${popupRows(operationRows)}</div>
          </details>
        </div>
        ${extras.length ? `<details class="facility-popup-extra">
          <summary><span><strong>Additional Information</strong><small>Automatically includes future data fields</small></span><b>${extras.length.toLocaleString('en-US')}</b></summary>
          <div class="facility-popup-extra-body">${popupRows(extras.map(([key, value]) => [popupFieldLabel(key), value]))}</div>
        </details>` : ''}
        <section class="facility-popup-section facility-popup-comments-section">
          <div class="facility-comment-heading">
            <span><strong>Comments</strong><small>Site coordination log</small></span>
            <button type="button" aria-expanded="false" aria-label="Show comments">Show</button>
          </div>
          <div class="facility-comments"><span class="facility-comment-empty">Loading comments…</span></div>
          <form class="facility-comment-form">
            <input name="comment" maxlength="1000" required aria-label="Add a comment" placeholder="Add a comment or coordination note…">
            <button type="submit">Send</button>
          </form>
        </section>
      </div>`;
    popup.querySelectorAll('[data-copy-value]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyValue);
          toast(`${button.dataset.copyLabel} copied`, 'success');
        } catch {
          toast(`Unable to copy ${button.dataset.copyLabel}`, 'error');
        }
      });
    });
    const comments = popup.querySelector('.facility-comments');
    const renderComments = items => {
      if (!items.length) {
        comments.innerHTML = '<span class="facility-comment-empty">No comments yet</span>';
        return;
      }
      comments.innerHTML = items.map(item => `<div class="facility-comment" data-comment-id="${Number(item.id)}">
        <b>${escapeHtml(item.authorName || 'User')}<time>${escapeHtml(new Date(item.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))}${item.updatedAt !== item.createdAt ? ' · Edited' : ''}</time></b>
        <span>${escapeHtml(item.body)}</span>
        ${canManageMod2Comments() ? '<div class="facility-comment-actions"><button type="button" data-action="edit">Edit</button><button type="button" data-action="delete">Delete</button></div>' : ''}
      </div>`).join('');
      if (canManageMod2Comments()) {
        comments.querySelectorAll('.facility-comment').forEach(comment => {
          const item = items.find(entry => Number(entry.id) === Number(comment.dataset.commentId));
          comment.querySelector('[data-action="edit"]').addEventListener('click', async () => {
            const body = window.prompt('Edit comment', item.body);
            if (body === null || !body.trim() || body.trim() === item.body) return;
            try {
              await authenticatedJson(`/api/mod2/comments/${item.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ body: body.trim() })
              });
              await loadComments();
              await loadCommentNotifications().catch(() => {});
              toast('Comment updated', 'success');
            } catch (error) {
              toast(error.message, 'error');
            }
          });
          comment.querySelector('[data-action="delete"]').addEventListener('click', async () => {
            if (!window.confirm('Delete this comment?')) return;
            try {
              await authenticatedJson(`/api/mod2/comments/${item.id}`, { method: 'DELETE' });
              await loadComments();
              await loadCommentNotifications().catch(() => {});
              toast('Comment deleted', 'success');
            } catch (error) {
              toast(error.message, 'error');
            }
          });
        });
      }
    };
    const loadComments = async () => {
      try {
        const payload = await authenticatedJson(`/api/mod2/sites/${site.id}/comments`);
        renderComments(payload.comments || []);
      } catch (error) {
        comments.innerHTML = `<span class="facility-comment-empty">${escapeHtml(error.message)}</span>`;
      }
    };
    const commentsSection = popup.querySelector('.facility-popup-comments-section');
    const commentsToggle = popup.querySelector('.facility-comment-heading button');
    commentsToggle.addEventListener('click', () => {
      const expanded = commentsSection.classList.toggle('is-open');
      commentsToggle.setAttribute('aria-expanded', String(expanded));
      commentsToggle.setAttribute('aria-label', expanded ? 'Hide comments' : 'Show comments');
      commentsToggle.textContent = expanded ? 'Hide' : 'Show';
      if (expanded) loadComments();
    });
    const commentRefreshTimer = window.setInterval(() => {
      if (!popup.isConnected) {
        window.clearInterval(commentRefreshTimer);
        return;
      }
      if (commentsSection.classList.contains('is-open')) loadComments();
    }, 5000);
    window.addEventListener('focus', () => {
      if (commentsSection.classList.contains('is-open')) loadComments();
    }, { once: true });
    popup.querySelector('.facility-comment-form').addEventListener('submit', async event => {
      event.preventDefault();
      const input = event.currentTarget.elements.comment;
      const body = input.value.trim();
      if (!body) return;
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      try {
        await authenticatedJson(`/api/mod2/sites/${site.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body })
        });
        input.value = '';
        await loadComments();
        if (isAdmin()) await loadCommentNotifications().catch(() => {});
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
    if (canUpdateMod2()) {
      const actions = document.createElement('div');
      actions.className = 'facility-admin-actions';
      actions.innerHTML = '<button type="button" data-action="edit"><span aria-hidden="true">✎</span> Edit Site</button><button type="button" class="is-danger" data-action="delete"><span aria-hidden="true">⌫</span> Delete Site</button>';
      actions.querySelector('[data-action="edit"]').addEventListener('click', () => showSiteEditor(site));
      actions.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSite(site));
      popup.appendChild(actions);
    }
    return popup;
  }

  function showSiteEditor(site) {
    map.closePopup();
    const content = document.createElement('form');
    content.className = 'site-edit-grid';
    const sections = [
      {
        title: 'ข้อมูลไซต์',
        fields: [
          { name: 'siteCode', label: 'Site Code', value: site.siteCode, required: true },
          { name: 'siteName', label: 'ชื่อไซต์', value: site.siteName },
          { name: 'type', label: 'Type of Digit', value: site.type },
          { name: 'grade', label: 'Site Grade', value: site.grade }
        ]
      },
      {
        title: 'พื้นที่และพิกัด',
        fields: [
          { name: 'regional', label: 'Regional', value: site.regional },
          { name: 'area', label: 'UIH Area', value: site.area },
          { name: 'province', label: 'จังหวัด', value: site.province },
          { name: 'district', label: 'อำเภอ / เขต', value: site.district },
          { name: 'latitude', label: 'Latitude', value: site.latitude, required: true, type: 'number', step: 'any', min: '-90', max: '90' },
          { name: 'longitude', label: 'Longitude', value: site.longitude, required: true, type: 'number', step: 'any', min: '-180', max: '180' }
        ]
      },
      {
        title: 'โครงข่ายและการดำเนินงาน',
        fields: [
          { name: 'nodeEquipment', label: 'Node Equipment', value: site.nodeEquipment, wide: true, maxlength: 500 },
          { name: 'owner', label: 'Owner', value: site.owner },
          { name: 'customers', label: 'จำนวนลูกค้า', value: site.customers, type: 'number', step: '1', min: '0', required: true },
          ...(isAdmin() ? [{
            name: 'opex',
            label: 'OPEX รายเดือน (บาท)',
            value: site.opex,
            type: 'number',
            step: '0.01',
            min: '0',
            required: true
          }] : [])
        ]
      }
    ];
    const fieldMarkup = field => `
      <div class="modal-field${field.wide ? ' is-wide' : ''}">
        <label>${escapeHtml(field.label)}</label>
        <input
          name="${escapeHtml(field.name)}"
          type="${field.type || 'text'}"
          value="${escapeHtml(field.value)}"
          ${field.required ? 'required' : ''}
          ${field.type === 'number'
            ? `step="${field.step || 'any'}"${field.min !== undefined ? ` min="${field.min}"` : ''}${field.max !== undefined ? ` max="${field.max}"` : ''}`
            : `maxlength="${field.maxlength || 200}"`}
        >
      </div>`;
    content.innerHTML = sections.map(section => `
      <fieldset class="site-edit-section">
        <legend>${escapeHtml(section.title)}</legend>
        <div class="site-edit-section-grid">${section.fields.map(fieldMarkup).join('')}</div>
      </fieldset>
    `).join('') + `
      <div class="modal-field is-wide"><label>Remark</label><textarea name="remark" maxlength="2000">${escapeHtml(site.remark)}</textarea></div>
      <button class="modal-primary is-wide" type="submit">บันทึกการแก้ไข</button>`;
    const extras = extraPopupProperties(site);
    if (extras.length) {
      const details = document.createElement('details');
      details.className = 'site-edit-extra is-wide';
      details.innerHTML = `
        <summary>ข้อมูลเพิ่มเติมจากชุดข้อมูลต้นทาง <span>${extras.length.toLocaleString('th-TH')} รายการ</span></summary>
        ${popupRows(extras.map(([key, value]) => [popupFieldLabel(key), value]))}`;
      content.querySelector('.modal-field.is-wide').before(details);
    }
    content.addEventListener('submit', async event => {
      event.preventDefault();
      if (!content.reportValidity()) return;
      const button = content.querySelector('button');
      button.disabled = true;
      const payload = Object.fromEntries(new FormData(content));
      payload.latitude = Number(payload.latitude);
      payload.longitude = Number(payload.longitude);
      payload.customers = Number(payload.customers);
      if (isAdmin()) payload.opex = Number(payload.opex);
      try {
        const result = await authenticatedJson(`/api/mod2/sites/${site.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        const updatedSite = featureToSite(result.site);
        updatedSite.sourceProperties = { ...site.sourceProperties, ...updatedSite.sourceProperties };
        Object.assign(site, updatedSite);
        closeModal(true);
        applyFilters(false);
        toast('บันทึกข้อมูลไซต์แล้ว', 'success');
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
    openModal(`แก้ไข ${site.siteCode}`, 'ผู้ใช้ที่มีสิทธิ์อัปเดต MOD 2', content, true);
  }

  async function deleteSite(site) {
    if (!window.confirm(`ยืนยันการลบไซต์ ${site.siteCode}? ความคิดเห็นของไซต์นี้จะถูกลบด้วย`)) return;
    try {
      await authenticatedJson(`/api/mod2/sites/${site.id}`, { method: 'DELETE' });
      state.sites = state.sites.filter(item => item.id !== site.id);
      map.closePopup();
      populateFilters();
      applyFilters(false);
      toast(`ลบไซต์ ${site.siteCode} แล้ว`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function markerIcon(site, highlighted = false) {
    const color = gradeColor(site.grade);
    const cacheKey = `${color}:${highlighted ? 'highlighted' : 'default'}`;
    if (markerIconCache.has(cacheKey)) return markerIconCache.get(cacheKey);
    const size = highlighted ? 24 : 18;
    const icon = L.divIcon({
      className: 'mod2-marker-host',
      html: `<span class="mod2-marker-motion"><span class="mod2-marker${highlighted ? ' is-search-match' : ''}" style="width:${size}px;height:${size}px;background:${color}"></span></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -(size / 2 + 2)]
    });
    markerIconCache.set(cacheKey, icon);
    return icon;
  }

  function clusterGroups(sites) {
    const zoom = map.getZoom();
    const cellSize = zoom < 7 ? 1.5 : zoom < 9 ? 0.55 : zoom < 11 ? 0.2 : 0.06;
    const groups = new Map();
    for (const site of sites) {
      const key = `${Math.floor(site.latitude / cellSize)}:${Math.floor(site.longitude / cellSize)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(site);
    }
    return [...groups.values()];
  }

  function roundHex(q, r) {
    const x = q;
    const z = r;
    const y = -x - z;
    let roundedX = Math.round(x);
    let roundedY = Math.round(y);
    let roundedZ = Math.round(z);
    const deltaX = Math.abs(roundedX - x);
    const deltaY = Math.abs(roundedY - y);
    const deltaZ = Math.abs(roundedZ - z);
    if (deltaX > deltaY && deltaX > deltaZ) roundedX = -roundedY - roundedZ;
    else if (deltaY > deltaZ) roundedY = -roundedX - roundedZ;
    else roundedZ = -roundedX - roundedY;
    return [roundedX, roundedZ];
  }

  function overviewHexBins(sites) {
    const projectionZoom = 7;
    const radius = 12;
    const bins = new Map();
    for (const site of sites) {
      const point = map.project([site.latitude, site.longitude], projectionZoom);
      const [q, r] = roundHex((Math.sqrt(3) / 3 * point.x - point.y / 3) / radius, (2 * point.y / 3) / radius);
      const key = `${q}:${r}`;
      if (!bins.has(key)) bins.set(key, { q, r, sites: [], customers: 0 });
      const bin = bins.get(key);
      bin.sites.push(site);
      bin.customers += site.customers;
    }
    return [...bins.values()].map(bin => {
      const center = L.point(radius * Math.sqrt(3) * (bin.q + bin.r / 2), radius * 1.5 * bin.r);
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = (60 * index - 30) * Math.PI / 180;
        return map.unproject([center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)], projectionZoom);
      });
      return { ...bin, points };
    });
  }

  function overviewHexColor(ratio) {
    if (ratio >= .75) return '#ff315d';
    if (ratio >= .45) return '#a23cff';
    if (ratio >= .2) return '#2d6cff';
    return '#222957';
  }

  function renderThailandOverview(sites) {
    const bins = overviewHexBins(sites);
    const maximum = Math.max(1, ...bins.map(bin => bin.sites.length));
    for (const bin of bins) {
      const ratio = bin.sites.length / maximum;
      const provinces = [...new Set(bin.sites.map(site => site.province).filter(Boolean))];
      L.polygon(bin.points, {
        renderer: mapRenderer,
        color: ratio >= .2 ? 'rgba(84,220,255,.72)' : 'rgba(90,101,175,.42)',
        weight: 1,
        fillColor: overviewHexColor(ratio),
        fillOpacity: .72 + ratio * .22,
        bubblingMouseEvents: false
      })
        .bindTooltip(`<strong>${bin.sites.length.toLocaleString('th-TH')} Sites</strong><br>${bin.customers.toLocaleString('th-TH')} Customers${provinces.length ? `<br>${escapeHtml(provinces.slice(0, 3).join(', '))}` : ''}`, { sticky: true, opacity: .96 })
        .on('click', () => {
          setViewMode('sites', false);
          const bounds = L.latLngBounds(bin.sites.map(site => [site.latitude, site.longitude]));
          map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 12, duration: .45 });
        })
        .addTo(overviewHexLayer);
    }
  }

  function bindLazySitePopup(layer, site) {
    layer.bindTooltip(`${site.siteCode}${site.siteName ? ` · ${site.siteName}` : ''}`, {
      direction: 'top',
      offset: [0, -8],
      opacity: .92
    });
    layer.bindPopup(() => popupContent(site), {
      minWidth: 300,
      maxWidth: 430,
      autoPan: true,
      autoPanPaddingTopLeft: [24, 88],
      autoPanPaddingBottomRight: [24, 24],
      keepInView: false,
      closeButton: true
    });
    return layer;
  }

  function renderMap() {
    window.cancelAnimationFrame(mapRenderFrame);
    mapCard?.classList.add('is-rendering');
    mapRenderFrame = window.requestAnimationFrame(() => {
      renderMapNow();
      window.requestAnimationFrame(() => mapCard?.classList.remove('is-rendering'));
    });
  }

  function renderMapNow() {
    map.closePopup();
    siteLayer.clearLayers();
    overviewHexLayer.clearLayers();
    if (state.viewMode === 'overview') {
      renderThailandOverview(state.filtered);
      return;
    }
    const renderSites = map.getZoom() >= 10 && !state.searchActive
      ? state.mapSites.filter(site => map.getBounds().pad(.35).contains([site.latitude, site.longitude]))
      : state.mapSites;
    if (state.density) {
      const maxCustomers = Math.max(1, ...renderSites.map(site => site.customers));
      for (const site of renderSites) {
        const ratio = Math.max(.15, site.customers / maxCustomers);
        const layer = L.circleMarker([site.latitude, site.longitude], {
          radius: 4 + Math.sqrt(ratio) * 10,
          stroke: false,
          fillColor: gradeColor(site.grade),
          fillOpacity: .22 + ratio * .38,
          renderer: mapRenderer
        });
        bindLazySitePopup(layer, site).addTo(siteLayer);
      }
      return;
    }

    const groups = state.cluster && map.getZoom() < 13
      ? clusterGroups(renderSites)
      : renderSites.map(site => [site]);
    const matchedIds = new Set(state.filtered.map(site => String(site.id)));
    for (const [groupIndex, group] of groups.entries()) {
      if (group.length === 1) {
        const site = group[0];
        const marker = L.marker([site.latitude, site.longitude], {
          icon: markerIcon(site, state.searchActive && matchedIds.has(String(site.id))),
          title: `${site.siteCode}${site.siteName ? ` · ${site.siteName}` : ''}`,
          riseOnHover: true
        });
        bindLazySitePopup(marker, site).addTo(siteLayer);
        marker.getElement()?.querySelector('.mod2-marker-motion')?.style.setProperty('--marker-delay', `${Math.min(groupIndex, 12) * 14}ms`);
        continue;
      }
      const latitude = group.reduce((sum, site) => sum + site.latitude, 0) / group.length;
      const longitude = group.reduce((sum, site) => sum + site.longitude, 0) / group.length;
      const size = Math.min(36, 21 + Math.log2(group.length) * 2.8);
      const icon = L.divIcon({
        className: 'mod2-cluster-host',
        html: `<span class="mod2-marker-motion"><span class="mod2-cluster" style="width:${size}px;height:${size}px">${group.length > 999 ? '999+' : group.length}</span></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
      const clusterMarker = L.marker([latitude, longitude], { icon })
        .on('click', () => map.flyTo([latitude, longitude], Math.min(map.getZoom() + 2, 14), { duration: .35 }))
        .addTo(siteLayer);
      clusterMarker.getElement()?.querySelector('.mod2-marker-motion')?.style.setProperty('--marker-delay', `${Math.min(groupIndex, 12) * 14}ms`);
    }
  }

  function renderLegend() {
    const counts = new Map();
    for (const site of state.mapSites) {
      if (site.grade) counts.set(site.grade, (counts.get(site.grade) || 0) + 1);
    }
    const sortedEntries = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    const fragment = document.createDocumentFragment();
    for (const [grade, count] of sortedEntries) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('i');
      dot.style.background = gradeColor(grade);
      const label = document.createElement('span');
      label.textContent = grade;
      label.title = grade;
      const value = document.createElement('b');
      value.textContent = count.toLocaleString('th-TH');
      item.append(dot, label, value);
      fragment.appendChild(item);
    }
    elements.mapLegendItems?.replaceChildren(fragment);
    if (elements.mapLegendCount) elements.mapLegendCount.textContent = counts.size.toLocaleString('th-TH');
    if (elements.mapLegendSummary) {
      const total = sortedEntries.reduce((sum, [, count]) => sum + count, 0);
      elements.mapLegendSummary.textContent = `${counts.size.toLocaleString('th-TH')} ประเภท · ${total.toLocaleString('th-TH')} Sites`;
    }
    if (elements.mapLegendPreview) {
      const preview = document.createDocumentFragment();
      sortedEntries.slice(0, 3).forEach(([grade]) => {
        const dot = document.createElement('i');
        dot.style.background = gradeColor(grade);
        preview.appendChild(dot);
      });
      elements.mapLegendPreview.replaceChildren(preview);
    }
    if (elements.mapLegend) elements.mapLegend.hidden = counts.size === 0;
  }

  function fitAll() {
    if (!state.filtered.length) return;
    const bounds = L.latLngBounds(state.filtered.map(site => [site.latitude, site.longitude]));
    map.flyToBounds(bounds, { padding: [45, 45], maxZoom: 13, duration: .45 });
  }

  function scheduleFilteredMapFocus() {
    if (mapAutoFocusFrame) window.cancelAnimationFrame(mapAutoFocusFrame);
    mapAutoFocusFrame = window.requestAnimationFrame(() => {
      mapAutoFocusFrame = 0;
      if (state.viewMode === 'overview') {
        const overviewBounds = state.filtered.length
          ? L.latLngBounds(state.filtered.map(site => [site.latitude, site.longitude]))
          : THAILAND_BOUNDS;
        map.flyToBounds(overviewBounds, { padding: [64, 64], maxZoom: 8, duration: .4 });
        return;
      }
      if (state.filtered.length === 1) {
        const [site] = state.filtered;
        map.flyTo([site.latitude, site.longitude], 13, { duration: .35 });
      } else if (state.filtered.length > 1) {
        fitAll();
      }
    });
  }

  function focusSite(site, zoom = 15) {
    let opened = false;
    mapFocusInProgress = true;
    const openSitePopup = () => {
      if (opened) return;
      opened = true;
      mapFocusInProgress = false;
      map.off('moveend', openSitePopup);
      L.popup({
        minWidth: 300,
        maxWidth: 430,
        autoPan: true,
        autoPanPaddingTopLeft: [24, 88],
        autoPanPaddingBottomRight: [24, 24],
        keepInView: false,
        closeButton: true
      })
        .setLatLng([site.latitude, site.longitude])
        .setContent(popupContent(site))
        .openOn(map);
    };
    map.once('moveend', openSitePopup);
    map.flyTo([site.latitude, site.longitude], zoom, { duration: .45 });
    window.setTimeout(openSitePopup, 700);
  }

  function siteFromNotification(notification) {
    const existing = state.sites.find(site => Number(site.id) === Number(notification.siteId));
    if (existing) return existing;
    return {
      id: notification.siteId,
      siteCode: notification.siteCode || '',
      siteName: notification.siteName || '',
      type: '',
      grade: '',
      regional: '',
      area: '',
      district: notification.district || '',
      province: notification.province || '',
      latitude: Number(notification.latitude),
      longitude: Number(notification.longitude),
      customers: 0,
      nodeEquipment: '',
      owner: '',
      opex: 0,
      remark: ''
    };
  }

  function closeCommentNotifications() {
    elements.commentNotificationPanel.hidden = true;
    elements.commentNotificationBtn.setAttribute('aria-expanded', 'false');
  }

  function markCommentNotificationsSeen() {
    const latest = state.notifications[0]?.createdAt;
    if (!latest) return;
    state.commentLastSeenAt = latest;
    localStorage.setItem(COMMENT_NOTIFICATIONS_KEY, latest);
    renderCommentNotifications();
  }

  function newCommentCount() {
    const seen = state.commentLastSeenAt ? Date.parse(state.commentLastSeenAt) : 0;
    return state.notifications.filter(item => Date.parse(item.createdAt) > seen).length;
  }

  function renderCommentNotifications() {
    if (!elements.commentNotifications) return;
    const enabled = Boolean(state.user && isAdmin());
    elements.commentNotifications.hidden = !enabled;
    if (!enabled) {
      closeCommentNotifications();
      return;
    }
    const count = newCommentCount();
    elements.commentNotificationCount.textContent = count > 99 ? '99+' : String(count);
    elements.commentNotificationBtn.classList.toggle('has-new', count > 0);
    if (!state.notifications.length) {
      elements.commentNotificationList.innerHTML = '<span class="comment-notification-empty">ยังไม่มีความคิดเห็นใหม่</span>';
      return;
    }
    const seen = state.commentLastSeenAt ? Date.parse(state.commentLastSeenAt) : 0;
    elements.commentNotificationList.replaceChildren(...state.notifications.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `comment-notification-item${Date.parse(item.createdAt) > seen ? ' is-new' : ''}`;
      button.innerHTML = `
        <strong>${escapeHtml(item.siteCode || `Site ${item.siteId}`)}${item.siteName ? ` · ${escapeHtml(item.siteName)}` : ''}</strong>
        <span>${escapeHtml(item.body)}</span>
        <small>${escapeHtml(item.authorName)} · ${escapeHtml(new Date(item.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }))}</small>`;
      button.addEventListener('click', () => {
        closeCommentNotifications();
        const site = siteFromNotification(item);
        if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
          toast('ไม่พบพิกัดของไซต์นี้', 'error');
          return;
        }
        if (!state.filtered.some(filtered => Number(filtered.id) === Number(site.id))) {
          syncSiteSearch('');
          for (const select of Object.values(filterElements)) select.value = '';
          populateFilters();
          applyFilters(false);
        }
        focusSite(site);
      });
      return button;
    }));
  }

  async function loadCommentNotifications({ silent = true } = {}) {
    if (!state.user || !isAdmin()) {
      state.notifications = [];
      renderCommentNotifications();
      return;
    }
    try {
      const payload = await authenticatedJson('/api/mod2/comments/notifications?limit=30');
      state.notifications = payload.notifications || [];
      renderCommentNotifications();
    } catch (error) {
      renderCommentNotifications();
      if (!silent) toast(`โหลดแจ้งเตือนไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  function scheduleCommentNotifications() {
    window.clearInterval(notificationTimer);
    if (!state.user || !isAdmin()) return;
    notificationTimer = window.setInterval(() => loadCommentNotifications().catch(() => {}), 45000);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const exportSites = isAdmin() ? state.sites : state.filtered;
    if (!exportSites.length) {
      toast('ไม่มีข้อมูลสำหรับส่งออก', 'error');
      return;
    }
    const headers = [
      'Site Code', 'Site Name', 'Type of Digit', 'Site Grade', 'Regional', 'UIH Area',
      'District', 'Province', 'Latitude', 'Longitude', 'Customers', 'Node Equipment',
      'Owner', ...(isAdmin() ? ['Opex'] : []), 'Remark'
    ];
    const rows = exportSites.map(site => [
      site.siteCode, site.siteName, site.type, site.grade, site.regional, site.area,
      site.district, site.province, site.latitude, site.longitude, site.customers,
      site.nodeEquipment, site.owner, ...(isAdmin() ? [site.opex] : []), site.remark
    ]);
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `MOD2_Site_Facility_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`ส่งออก ${exportSites.length.toLocaleString('th-TH')} sites ${isAdmin() ? '(ข้อมูลทั้งหมดสำหรับ Admin)' : '(เฉพาะข้อมูลที่มองเห็น)'} แล้ว`, 'success');
  }

  async function applySession(session, { showGate = true, reloadData = false } = {}) {
    state.user = session?.user || null;
    state.profile = null;
    if (state.user) {
      try {
        state.profile = await loadProfile(state.user);
      } catch (error) {
        await client.auth.signOut({ scope: 'local' });
        state.user = null;
        updateAccountUi();
        if (showGate) showAuth(error.message);
        return false;
      }
    }
    updateAccountUi();
    if (!state.user) {
      state.sites = [];
      state.filtered = [];
      state.loaded = false;
      state.notifications = [];
      window.clearInterval(notificationTimer);
      siteLayer.clearLayers();
      Object.values(mod1RouteLayers).forEach(layer => layer.clearLayers());
      renderCommentNotifications();
      updateMetrics();
      setHealth('รอเข้าสู่ระบบ');
      setLoading(false);
      if (showGate) showAuth();
      return false;
    }
    if (reloadData || !state.loaded) await loadSites(reloadData);
    await loadCommentNotifications().catch(() => {});
    scheduleCommentNotifications();
    return true;
  }

  for (const select of Object.values(filterElements)) {
    select.addEventListener('change', () => {
      populateFilters();
      applyFilters(true);
      if (select === filterElements.area && selectedValues(filterElements.area).size) setViewMode('sites', false);
      syncMod1RouteLayers();
    });
  }

  function setAreaDropdownExpanded(expanded) {
    elements.filterAreaPanel.hidden = !expanded;
    elements.filterAreaToggle.setAttribute('aria-expanded', String(expanded));
  }

  elements.filterAreaToggle.addEventListener('click', () => {
    setAreaDropdownExpanded(elements.filterAreaPanel.hidden);
  });
  elements.clearAreaFilter.addEventListener('click', () => {
    [...filterElements.area.options].forEach(option => { option.selected = false; });
    filterElements.area.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.filter-area-dropdown')) setAreaDropdownExpanded(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.filterAreaPanel.hidden) {
      setAreaDropdownExpanded(false);
      elements.filterAreaToggle.focus();
    }
  });

  elements.showMaxiRoutes?.addEventListener('change', syncMod1RouteLayers);
  elements.showRd03Routes?.addEventListener('change', syncMod1RouteLayers);

  function setOutputMenuExpanded(expanded) {
    const isExpanded = Boolean(expanded);
    elements.mapOutputToggle?.setAttribute('aria-expanded', String(isExpanded));
    if (elements.mapOutputPanel) elements.mapOutputPanel.hidden = !isExpanded;
  }

  function setViewMode(mode, persist = true) {
    const nextMode = ['overview', 'sites', 'density'].includes(mode) ? mode : 'overview';
    state.viewMode = nextMode;
    state.cluster = nextMode === 'sites';
    state.density = nextMode === 'density';
    mapCard?.classList.toggle('is-overview-mode', nextMode === 'overview');
    elements.thailandOverviewHud.hidden = nextMode !== 'overview';
    elements.overviewBtn.classList.toggle('is-active', nextMode === 'overview');
    elements.clusterBtn.classList.toggle('is-active', nextMode === 'sites');
    elements.heatBtn.classList.toggle('is-active', nextMode === 'density');
    elements.overviewBtn.setAttribute('aria-pressed', String(nextMode === 'overview'));
    elements.clusterBtn.setAttribute('aria-pressed', String(nextMode === 'sites'));
    elements.heatBtn.setAttribute('aria-pressed', String(nextMode === 'density'));
    renderMap();
    renderLegend();
    if (nextMode === 'overview') map.flyToBounds(THAILAND_BOUNDS, { padding: [42, 42], maxZoom: 6, duration: .45 });
  }

  elements.opexReportBtn.addEventListener('click', () => {
    setOutputMenuExpanded(false);
    openOpexReport();
  });

  function syncSiteSearch(value) {
    elements.mapSiteSearch.value = value;
  }

  function scheduleSiteSearch(source) {
    syncSiteSearch(source.value);
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applyFilters(false), 220);
  }

  function clearSiteSearch(focusTarget, autoFit = true) {
    window.clearTimeout(searchTimer);
    syncSiteSearch('');
    applyFilters(autoFit);
    focusTarget?.focus();
  }

  function handleSiteSearchKeydown(event) {
    if (event.key === 'Escape' && event.currentTarget.value) {
      event.preventDefault();
      event.stopPropagation();
      clearSiteSearch(event.currentTarget);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.clearTimeout(searchTimer);
    syncSiteSearch(event.currentTarget.value);
    applyFilters(false);
    if (state.filtered.length === 1) {
      setViewMode('sites', false);
      focusSite(state.filtered[0], 13);
    }
    else if (state.filtered.length > 1) fitAll();
  }

  elements.mapSiteSearch.addEventListener('input', () => scheduleSiteSearch(elements.mapSiteSearch));
  elements.mapSiteSearch.addEventListener('keydown', handleSiteSearchKeydown);
  elements.clearMapSearch.addEventListener('click', () => {
    clearSiteSearch(elements.mapSiteSearch);
  });
  elements.resetFilters.addEventListener('click', () => {
    resetAllFilters({ autoFit: true });
  });
  elements.clearMapFilters.addEventListener('click', () => resetAllFilters({ focusSearch: true, autoFit: true }));
  elements.emptyResetFilters.addEventListener('click', () => resetAllFilters({ focusSearch: true, autoFit: true }));
  elements.reloadBtn.addEventListener('click', () => loadSites(true).catch(() => {}));
  elements.overviewBtn.addEventListener('click', () => setViewMode('overview'));
  elements.clusterBtn.addEventListener('click', () => setViewMode('sites'));
  elements.heatBtn.addEventListener('click', () => setViewMode('density'));
  elements.fitBtn.addEventListener('click', fitAll);
  elements.sidebarToggle?.addEventListener('click', () => {
    setSidebarCollapsed(!elements.workspace?.classList.contains('is-sidebar-collapsed'));
  });
  elements.mapCard?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 820px)').matches && !elements.workspace?.classList.contains('is-sidebar-collapsed')) {
      setSidebarCollapsed(true);
    }
  });
  elements.mapLegendToggle?.addEventListener('click', () => {
    setLegendExpanded(elements.mapLegendToggle.getAttribute('aria-expanded') !== 'true');
  });
  function setMapFocus(focused, persist = true) {
    document.body.classList.toggle('mod2-map-focus', focused);
    elements.mapFocusToggle.setAttribute('aria-pressed', String(focused));
    elements.mapFocusToggle.title = focused ? 'ออกจากโหมดเต็มจอ' : 'เข้าสู่โหมดเต็มจอ';
    const text = elements.mapFocusToggle.querySelector('.map-focus-toggle-text');
    if (text) text.textContent = focused ? 'ออกจากเต็มจอ' : 'เต็มจอ';
    if (persist) localStorage.setItem(MAP_FOCUS_KEY, focused ? '1' : '0');
    window.setTimeout(() => map.invalidateSize(), 280);
  }
  elements.mapFocusToggle.addEventListener('click', () => {
    setMapFocus(!document.body.classList.contains('mod2-map-focus'));
  });
  elements.mapOutputToggle?.addEventListener('click', () => {
    setOutputMenuExpanded(elements.mapOutputToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.exportBtn.addEventListener('click', () => {
    setOutputMenuExpanded(false);
    exportCsv();
  });
  elements.accountBtn.addEventListener('click', showAccount);
  elements.commentNotificationBtn?.addEventListener('click', () => {
    const opening = elements.commentNotificationPanel.hidden;
    elements.commentNotificationPanel.hidden = !opening;
    elements.commentNotificationBtn.setAttribute('aria-expanded', String(opening));
    if (opening) {
      markCommentNotificationsSeen();
      loadCommentNotifications({ silent: false }).catch(() => {});
    }
  });
  elements.commentNotificationRefresh?.addEventListener('click', () => loadCommentNotifications({ silent: false }));
  elements.modalClose.addEventListener('click', () => closeModal());
  elements.modalBackdrop.addEventListener('click', event => {
    if (event.target === elements.modalBackdrop) closeModal();
  });
  document.addEventListener('click', event => {
    if (elements.commentNotifications && !elements.commentNotifications.contains(event.target)) {
      closeCommentNotifications();
    }
    if (elements.mapOutputMenu && !elements.mapOutputMenu.contains(event.target)) {
      setOutputMenuExpanded(false);
    }
  });
  document.addEventListener('keydown', event => {
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
    if ((event.key === '/' || (event.key.toLocaleLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) && !isEditing && elements.modalBackdrop.hidden) {
      event.preventDefault();
      elements.mapSiteSearch.focus();
      elements.mapSiteSearch.select();
      return;
    }
    if (event.key === 'Escape' && elements.mapOutputToggle?.getAttribute('aria-expanded') === 'true') {
      setOutputMenuExpanded(false);
      elements.mapOutputToggle.focus();
      return;
    }
    if (event.key === 'Escape' && elements.mapLegendToggle?.getAttribute('aria-expanded') === 'true') {
      setLegendExpanded(false);
      elements.mapLegendToggle.focus();
      return;
    }
    if (event.key === 'Escape' && window.matchMedia('(max-width: 820px)').matches && !elements.workspace?.classList.contains('is-sidebar-collapsed')) {
      setSidebarCollapsed(true);
      elements.sidebarToggle?.focus();
      return;
    }
    if (event.key === 'Escape' && document.body.classList.contains('mod2-map-focus')) {
      setMapFocus(false);
    }
  });
  map.on('zoomend', () => {
    if (mapFocusInProgress || map._popup?.isOpen?.()) return;
    if (state.cluster && !state.density) renderMap();
  });
  map.on('moveend', () => {
    if (mapFocusInProgress || map._popup?.isOpen?.()) return;
    if (map.getZoom() >= 10 && !state.searchActive) renderMap();
  });

  window.permissionOutAdminContext = {
    client,
    getCurrentUser: () => state.user,
    getCurrentProfile: () => state.profile,
    openModal,
    closeModal,
    toast,
    escapeHtml
  };

  async function initialize() {
    restoreSidebarState();
    restoreLegendState();
    setViewMode(state.viewMode, false);
    updateAccountUi();
    if (!client) {
      setHealth('ตั้งค่าไม่ครบ', 'error');
      setLoading(false);
      const content = document.createElement('p');
      content.className = 'auth-note';
      content.textContent = 'ยังไม่ได้ตั้งค่า SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ใน Cloudflare Worker';
      openModal('ระบบ Cloud ยังไม่พร้อม', 'กรุณาติดต่อผู้ดูแลระบบ', content, false);
      return;
    }
    const { data } = await client.auth.getSession();
    await applySession(data.session, { showGate: true });
    client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => applySession(session, { showGate: true }).catch(error => {
        toast(error.message || 'ตรวจสอบเซสชันไม่สำเร็จ', 'error');
      }), 0);
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  requestAnimationFrame(() => {
    setMapFocus(localStorage.getItem(MAP_FOCUS_KEY) === '1', false);
    map.invalidateSize();
    initialize().catch(error => {
      setLoading(false);
      setHealth('เริ่มระบบไม่สำเร็จ', 'error');
      toast(error.message, 'error');
    });
  });
})();
