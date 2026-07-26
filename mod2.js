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
    loaded: false,
    loading: false,
    cluster: true,
    density: false,
    notifications: [],
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
    siteSearch: document.getElementById('siteSearch'),
    clearSearch: document.getElementById('clearSearch'),
    mapSiteSearch: document.getElementById('mapSiteSearch'),
    clearMapSearch: document.getElementById('clearMapSearch'),
    mapSearchCount: document.getElementById('mapSearchCount'),
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
    mapSubtitle: document.getElementById('mapSubtitle'),
    mapLoading: document.getElementById('mapLoading'),
    loadingDetail: document.getElementById('loadingDetail'),
    mapLegend: document.getElementById('mapLegend'),
    clusterBtn: document.getElementById('clusterBtn'),
    heatBtn: document.getElementById('heatBtn'),
    fitBtn: document.getElementById('fitBtn'),
    mapFocusToggle: document.getElementById('mapFocusToggle'),
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
  elements.commentNotifications = document.getElementById('commentNotifications');
  elements.commentNotificationBtn = document.getElementById('commentNotificationBtn');
  elements.commentNotificationCount = document.getElementById('commentNotificationCount');
  elements.commentNotificationPanel = document.getElementById('commentNotificationPanel');
  elements.commentNotificationList = document.getElementById('commentNotificationList');
  elements.commentNotificationRefresh = document.getElementById('commentNotificationRefresh');

  const filterElements = {
    regional: document.getElementById('filterRegional'),
    area: document.getElementById('filterArea'),
    province: document.getElementById('filterProvince'),
    grade: document.getElementById('filterGrade'),
    type: document.getElementById('filterType'),
    owner: document.getElementById('filterOwner')
  };

  const map = L.map('mod2Map', { zoomControl: true, preferCanvas: true }).setView([13.2, 101.2], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const siteLayer = L.layerGroup().addTo(map);
  let searchTimer = 0;
  let notificationTimer = 0;
  let mapRenderFrame = 0;
  const markerIconCache = new Map();
  const mapCard = document.querySelector('.map-card');
  const mapRenderer = L.canvas({ padding: .35 });

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
      const copy = elements.sidebarToggle.querySelector('.sidebar-toggle-label');
      if (copy) copy.textContent = label;
    }
    if (persist) {
      try {
        window.sessionStorage.setItem('permission-out:mod2-sidebar-collapsed', String(isCollapsed));
      } catch { /* storage may be unavailable */ }
    }
    window.setTimeout(() => map.invalidateSize({ animate: false }), 240);
  }

  function restoreSidebarState() {
    let collapsed = false;
    try {
      collapsed = window.sessionStorage.getItem('permission-out:mod2-sidebar-collapsed') === 'true';
    } catch { /* use expanded state */ }
    setSidebarCollapsed(collapsed, { persist: false });
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

  async function authenticatedJson(path, options = {}) {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
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

  function uniqueValues(key) {
    return [...new Set(state.sites.map(site => site[key]).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'th'));
  }

  function selectedValues(select) {
    return new Set(select.value ? [select.value] : []);
  }

  function populateFilters() {
    for (const [key, select] of Object.entries(filterElements)) {
      const selected = selectedValues(select);
      const fragment = document.createDocumentFragment();
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'ทั้งหมด';
      fragment.appendChild(allOption);
      for (const value of uniqueValues(key)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = selected.has(value);
        fragment.appendChild(option);
      }
      select.replaceChildren(fragment);
    }
  }

  function applyFilters(autoFit = false) {
    const query = elements.siteSearch.value.trim().toLocaleLowerCase('th');
    const selections = Object.fromEntries(
      Object.entries(filterElements).map(([key, select]) => [key, selectedValues(select)])
    );
    state.filtered = state.sites.filter(site => {
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
      return Object.entries(selections).every(([key, values]) => !values.size || values.has(site[key]));
    });
    updateMetrics();
    updateActiveFilters(query, selections);
    renderMap();
    renderLegend();
    if (autoFit && state.filtered.length) fitAll();
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
    if (query) chips.push({ label: 'ค้นหา', value: elements.siteSearch.value.trim() });
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
    for (const select of Object.values(filterElements)) select.value = '';
    applyFilters(autoFit);
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
    elements.mapSubtitle.textContent = `แสดง ${sites.length.toLocaleString('th-TH')} จาก ${state.sites.length.toLocaleString('th-TH')} sites`;
    elements.mapSearchCount.textContent = sites.length.toLocaleString('th-TH');
    elements.mapSearchCount.setAttribute('aria-label', `พบ ${sites.length.toLocaleString('th-TH')} ไซต์`);
    elements.opexReportBtn.hidden = !isAdmin();
    elements.mapEmptyState.hidden = sites.length > 0 || !state.loaded;
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
      ['Province', site.province],
      ['District', site.district],
      ['Region', site.regional],
      ['UIH Area', site.area],
      ['Coordinates', `${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}`]
    ];
    const networkRows = [
      ['Site Type', site.type],
      ['Site Grade', site.grade],
      ['Node Equipment', site.nodeEquipment],
      ['Owner', site.owner]
    ];
    const operationRows = [
      ['Customer Count', site.customers, { number: true }],
      ...(isAdmin() ? [
        ['Monthly OPEX', site.opex, { currency: true }],
        ['Annual OPEX', (Number(site.opex) || 0) * 12, { currency: true }]
      ] : []),
      ['Remark', site.remark]
    ];
    const extras = extraPopupProperties(site);
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
          <details class="facility-popup-group" open>
            <summary>
              <span class="facility-popup-group-icon" aria-hidden="true">◇</span>
              <span><strong>Network & Ownership</strong><small>${networkRows.filter(([, value]) => hasPopupValue(value)).length} items</small></span>
            </summary>
            <div class="facility-popup-info">${popupRows(networkRows)}</div>
          </details>
          <details class="facility-popup-group is-wide" open>
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
            <button type="button" aria-label="Refresh comments">Refresh</button>
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
    popup.querySelector('.facility-comment-heading button').addEventListener('click', loadComments);
    const commentRefreshTimer = window.setInterval(() => {
      if (!popup.isConnected) {
        window.clearInterval(commentRefreshTimer);
        return;
      }
      loadComments();
    }, 5000);
    window.addEventListener('focus', loadComments, { once: true });
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
    loadComments();
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

  function markerIcon(site) {
    const color = gradeColor(site.grade);
    if (markerIconCache.has(color)) return markerIconCache.get(color);
    const icon = L.divIcon({
      className: '',
      html: `<span class="mod2-marker" style="width:18px;height:18px;background:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10]
    });
    markerIconCache.set(color, icon);
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

  function bindLazySitePopup(layer, site) {
    layer.bindTooltip(`${site.siteCode}${site.siteName ? ` · ${site.siteName}` : ''}`, {
      direction: 'top',
      offset: [0, -8],
      opacity: .92
    });
    layer.bindPopup(() => popupContent(site), { minWidth: 340, maxWidth: 520 });
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
    if (state.density) {
      const maxCustomers = Math.max(1, ...state.filtered.map(site => site.customers));
      for (const site of state.filtered) {
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
      ? clusterGroups(state.filtered)
      : state.filtered.map(site => [site]);
    for (const group of groups) {
      if (group.length === 1) {
        const site = group[0];
        const marker = L.marker([site.latitude, site.longitude], {
          icon: markerIcon(site),
          title: `${site.siteCode}${site.siteName ? ` · ${site.siteName}` : ''}`,
          riseOnHover: true
        });
        bindLazySitePopup(marker, site).addTo(siteLayer);
        continue;
      }
      const latitude = group.reduce((sum, site) => sum + site.latitude, 0) / group.length;
      const longitude = group.reduce((sum, site) => sum + site.longitude, 0) / group.length;
      const size = Math.min(42, 23 + Math.log2(group.length) * 3.5);
      const icon = L.divIcon({
        className: '',
        html: `<span class="mod2-cluster" style="width:${size}px;height:${size}px">${group.length > 999 ? '999+' : group.length}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
      L.marker([latitude, longitude], { icon })
        .on('click', () => map.flyTo([latitude, longitude], Math.min(map.getZoom() + 2, 14), { duration: .35 }))
        .addTo(siteLayer);
    }
  }

  function renderLegend() {
    const counts = new Map();
    for (const site of state.filtered) {
      if (site.grade) counts.set(site.grade, (counts.get(site.grade) || 0) + 1);
    }
    const fragment = document.createDocumentFragment();
    for (const [grade, count] of [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12)) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('i');
      dot.style.background = gradeColor(grade);
      const label = document.createElement('span');
      label.textContent = `${grade} ${count.toLocaleString('th-TH')}`;
      item.append(dot, label);
      fragment.appendChild(item);
    }
    elements.mapLegend.replaceChildren(fragment);
  }

  function fitAll() {
    if (!state.filtered.length) return;
    const bounds = L.latLngBounds(state.filtered.map(site => [site.latitude, site.longitude]));
    map.flyToBounds(bounds, { padding: [45, 45], maxZoom: 13, duration: .45 });
  }

  function focusSite(site) {
    map.flyTo([site.latitude, site.longitude], 15, { duration: .45 });
    L.popup({ minWidth: 340, maxWidth: 520 })
      .setLatLng([site.latitude, site.longitude])
      .setContent(popupContent(site))
      .openOn(map);
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
    select.addEventListener('change', () => applyFilters(false));
  }
  elements.opexReportBtn.addEventListener('click', openOpexReport);

  function syncSiteSearch(value) {
    elements.siteSearch.value = value;
    elements.mapSiteSearch.value = value;
  }

  function scheduleSiteSearch(source) {
    syncSiteSearch(source.value);
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applyFilters(false), 220);
  }

  function clearSiteSearch(focusTarget, autoFit = false) {
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
    if (state.filtered.length === 1) focusSite(state.filtered[0]);
    else if (state.filtered.length > 1) fitAll();
  }

  for (const input of [elements.siteSearch, elements.mapSiteSearch]) {
    input.addEventListener('input', () => scheduleSiteSearch(input));
    input.addEventListener('keydown', handleSiteSearchKeydown);
  }
  elements.clearSearch.addEventListener('click', () => {
    clearSiteSearch(elements.siteSearch);
  });
  elements.clearMapSearch.addEventListener('click', () => {
    clearSiteSearch(elements.mapSiteSearch);
  });
  elements.resetFilters.addEventListener('click', () => {
    resetAllFilters({ autoFit: true });
  });
  elements.clearMapFilters.addEventListener('click', () => resetAllFilters({ focusSearch: true, autoFit: true }));
  elements.emptyResetFilters.addEventListener('click', () => resetAllFilters({ focusSearch: true, autoFit: true }));
  elements.reloadBtn.addEventListener('click', () => loadSites(true).catch(() => {}));
  elements.clusterBtn.addEventListener('click', () => {
    state.cluster = !state.cluster;
    state.density = false;
    elements.clusterBtn.classList.toggle('is-active', state.cluster);
    elements.clusterBtn.setAttribute('aria-pressed', String(state.cluster));
    elements.heatBtn.classList.remove('is-active');
    elements.heatBtn.setAttribute('aria-pressed', 'false');
    renderMap();
  });
  elements.heatBtn.addEventListener('click', () => {
    state.density = !state.density;
    if (state.density) state.cluster = false;
    elements.heatBtn.classList.toggle('is-active', state.density);
    elements.heatBtn.setAttribute('aria-pressed', String(state.density));
    elements.clusterBtn.classList.toggle('is-active', state.cluster);
    elements.clusterBtn.setAttribute('aria-pressed', String(state.cluster));
    renderMap();
  });
  elements.fitBtn.addEventListener('click', fitAll);
  elements.sidebarToggle?.addEventListener('click', () => {
    setSidebarCollapsed(!elements.workspace?.classList.contains('is-sidebar-collapsed'));
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
  elements.exportBtn.addEventListener('click', exportCsv);
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
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('mod2-map-focus')) {
      setMapFocus(false);
    }
  });
  map.on('zoomend', () => {
    if (state.cluster && !state.density) renderMap();
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
