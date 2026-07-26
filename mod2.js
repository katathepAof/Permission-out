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

  function applyFilters(autoFit = true) {
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
    renderMap();
    renderLegend();
    if (autoFit && state.filtered.length) fitAll();
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
    if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
    if (Array.isArray(value)) return value.map(item => popupValue(item)).join(', ');
    if (typeof value === 'object') return Object.entries(value)
      .map(([key, item]) => `${popupFieldLabel(key)}: ${popupValue(item)}`).join(' · ');
    return String(value);
  }

  function popupFieldLabel(key) {
    const labels = {
      site_code: 'Site Code', site_name: 'ชื่อไซต์', type_of_digit: 'ประเภทไซต์',
      site_grade: 'Site Grade', regional: 'Regional', uih_area: 'UIH Area',
      district: 'อำเภอ / เขต', province: 'จังหวัด', latitude: 'Latitude',
      longitude: 'Longitude', customers: 'จำนวนลูกค้า', node_equipment: 'Node Equipment',
      owner: 'ผู้รับผิดชอบ', opex: 'OPEX', remark: 'หมายเหตุ'
    };
    if (labels[key]) return labels[key];
    return String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function popupRows(rows) {
    const available = rows.filter(([, value]) => hasPopupValue(value));
    if (!available.length) return '<p class="facility-popup-empty">ไม่มีข้อมูลในหมวดนี้</p>';
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
      ['จังหวัด', site.province],
      ['อำเภอ / เขต', site.district],
      ['Regional', site.regional],
      ['UIH Area', site.area],
      ['พิกัด', `${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}`]
    ];
    const networkRows = [
      ['ประเภทไซต์', site.type],
      ['Site Grade', site.grade],
      ['Node Equipment', site.nodeEquipment],
      ['ผู้รับผิดชอบ', site.owner]
    ];
    const operationRows = [
      ['จำนวนลูกค้า', site.customers, { number: true }],
      ['OPEX', site.opex, { currency: true }],
      ['หมายเหตุ', site.remark]
    ];
    const extras = extraPopupProperties(site);
    const popup = document.createElement('div');
    popup.className = 'facility-popup';
    popup.innerHTML = `
      <header class="facility-popup-header">
        <div class="facility-popup-identity">
          <div class="facility-popup-kicker"><span>Site Facility</span>${site.grade ? `<b style="--grade-color:${escapeHtml(gradeColor(site.grade))}">${escapeHtml(site.grade)}</b>` : ''}</div>
          <div class="facility-popup-code">${escapeHtml(site.siteCode)}</div>
          <h3>${escapeHtml(site.siteName || 'ไม่ระบุชื่อไซต์')}</h3>
          <p>${escapeHtml([site.district, site.province].filter(Boolean).join(' · ') || 'ยังไม่มีข้อมูลพื้นที่')}</p>
        </div>
      </header>
      <div class="facility-popup-metrics" aria-label="ข้อมูลสำคัญ">
        <div><span>ลูกค้า</span><strong>${escapeHtml(popupValue(site.customers, { number: true }))}</strong></div>
        <div><span>Site Grade</span><strong>${escapeHtml(site.grade || '—')}</strong></div>
        <div><span>ประเภทไซต์</span><strong>${escapeHtml(site.type || '—')}</strong></div>
      </div>
      <section class="facility-popup-info">
        <h4><span aria-hidden="true">⌖</span> ตำแหน่งและพื้นที่</h4>
        ${popupRows(locationRows)}
      </section>
      <section class="facility-popup-info">
        <h4><span aria-hidden="true">◇</span> โครงข่ายและการดูแล</h4>
        ${popupRows(networkRows)}
      </section>
      <section class="facility-popup-info">
        <h4><span aria-hidden="true">▤</span> ข้อมูลการดำเนินงาน</h4>
        ${popupRows(operationRows)}
      </section>
      ${extras.length ? `<details class="facility-popup-extra">
        <summary>ข้อมูลเพิ่มเติม <span>${extras.length.toLocaleString('th-TH')} รายการ</span></summary>
        ${popupRows(extras.map(([key, value]) => [popupFieldLabel(key), value]))}
      </details>` : ''}
      <div class="facility-popup-section facility-popup-comments-section">
        <div class="facility-comment-heading">
          <strong>ความคิดเห็น</strong>
          <button type="button" aria-label="โหลดความคิดเห็นล่าสุด">รีเฟรช</button>
        </div>
        <div class="facility-comments"><span class="facility-comment-empty">กำลังโหลด…</span></div>
        <form class="facility-comment-form">
          <input name="comment" maxlength="1000" required aria-label="เพิ่มความคิดเห็น" placeholder="เขียนความคิดเห็น…">
          <button type="submit">ส่ง</button>
        </form>
      </div>`;
    const comments = popup.querySelector('.facility-comments');
    const renderComments = items => {
      if (!items.length) {
        comments.innerHTML = '<span class="facility-comment-empty">ยังไม่มีความคิดเห็น</span>';
        return;
      }
      comments.innerHTML = items.map(item => `<div class="facility-comment" data-comment-id="${Number(item.id)}">
        <b>${escapeHtml(item.authorName || 'ผู้ใช้งาน')}<time>${escapeHtml(new Date(item.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }))}${item.updatedAt !== item.createdAt ? ' · แก้ไขแล้ว' : ''}</time></b>
        <span>${escapeHtml(item.body)}</span>
        ${canManageMod2Comments() ? '<div class="facility-comment-actions"><button type="button" data-action="edit">แก้ไข</button><button type="button" data-action="delete">ลบ</button></div>' : ''}
      </div>`).join('');
      if (canManageMod2Comments()) {
        comments.querySelectorAll('.facility-comment').forEach(comment => {
          const item = items.find(entry => Number(entry.id) === Number(comment.dataset.commentId));
          comment.querySelector('[data-action="edit"]').addEventListener('click', async () => {
            const body = window.prompt('แก้ไขความคิดเห็น', item.body);
            if (body === null || !body.trim() || body.trim() === item.body) return;
            try {
              await authenticatedJson(`/api/mod2/comments/${item.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ body: body.trim() })
              });
              await loadComments();
              await loadCommentNotifications().catch(() => {});
              toast('แก้ไขความคิดเห็นแล้ว', 'success');
            } catch (error) {
              toast(error.message, 'error');
            }
          });
          comment.querySelector('[data-action="delete"]').addEventListener('click', async () => {
            if (!window.confirm('ยืนยันการลบความคิดเห็นนี้?')) return;
            try {
              await authenticatedJson(`/api/mod2/comments/${item.id}`, { method: 'DELETE' });
              await loadComments();
              await loadCommentNotifications().catch(() => {});
              toast('ลบความคิดเห็นแล้ว', 'success');
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
      actions.innerHTML = '<button type="button" data-action="edit">แก้ไขข้อมูล</button><button type="button" class="is-danger" data-action="delete">ลบไซต์</button>';
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
    const fields = [
      ['siteCode', 'Site Code', site.siteCode, true],
      ['siteName', 'ชื่อไซต์', site.siteName],
      ['province', 'จังหวัด', site.province],
      ['district', 'อำเภอ', site.district],
      ['regional', 'Regional', site.regional],
      ['area', 'UIH Area', site.area],
      ['grade', 'Site Grade', site.grade],
      ['type', 'Type of Digit', site.type],
      ['owner', 'Owner', site.owner],
      ['nodeEquipment', 'Node Equipment', site.nodeEquipment],
      ['latitude', 'Latitude', site.latitude, true, 'number'],
      ['longitude', 'Longitude', site.longitude, true, 'number']
    ];
    content.innerHTML = fields.map(([name, label, value, required, type = 'text']) => `
      <div class="modal-field"><label>${escapeHtml(label)}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'step="any"' : 'maxlength="200"'}></div>
    `).join('') + `
      <div class="modal-field is-wide"><label>Remark</label><textarea name="remark" maxlength="2000">${escapeHtml(site.remark)}</textarea></div>
      <button class="modal-primary is-wide" type="submit">บันทึกการแก้ไข</button>`;
    content.addEventListener('submit', async event => {
      event.preventDefault();
      if (!content.reportValidity()) return;
      const button = content.querySelector('button');
      button.disabled = true;
      const payload = Object.fromEntries(new FormData(content));
      payload.latitude = Number(payload.latitude);
      payload.longitude = Number(payload.longitude);
      try {
        const result = await authenticatedJson(`/api/mod2/sites/${site.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        Object.assign(site, featureToSite(result.site));
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
    return L.divIcon({
      className: '',
      html: `<span class="mod2-marker" style="width:18px;height:18px;background:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10]
    });
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

  function renderMap() {
    siteLayer.clearLayers();
    if (state.density) {
      const maxCustomers = Math.max(1, ...state.filtered.map(site => site.customers));
      for (const site of state.filtered) {
        const ratio = Math.max(.15, site.customers / maxCustomers);
        L.circleMarker([site.latitude, site.longitude], {
          radius: 4 + Math.sqrt(ratio) * 10,
          stroke: false,
          fillColor: gradeColor(site.grade),
          fillOpacity: .22 + ratio * .38
        }).bindPopup(popupContent(site), { minWidth: 300, maxWidth: 420 }).addTo(siteLayer);
      }
      return;
    }

    const groups = state.cluster && map.getZoom() < 13
      ? clusterGroups(state.filtered)
      : state.filtered.map(site => [site]);
    for (const group of groups) {
      if (group.length === 1) {
        const site = group[0];
        L.marker([site.latitude, site.longitude], { icon: markerIcon(site) })
          .bindPopup(popupContent(site), { minWidth: 300, maxWidth: 420 })
          .addTo(siteLayer);
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
        .on('click', () => map.setView([latitude, longitude], Math.min(map.getZoom() + 2, 14)))
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
    map.fitBounds(bounds, { padding: [45, 45], maxZoom: 13 });
  }

  function focusSite(site) {
    map.setView([site.latitude, site.longitude], 15);
    L.popup({ minWidth: 300, maxWidth: 420 })
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
    if (!state.filtered.length) {
      toast('ไม่มีข้อมูลสำหรับส่งออก', 'error');
      return;
    }
    const headers = [
      'Site Code', 'Site Name', 'Type of Digit', 'Site Grade', 'Regional', 'UIH Area',
      'District', 'Province', 'Latitude', 'Longitude', 'Customers', 'Node Equipment',
      'Owner', 'Opex', 'Remark'
    ];
    const rows = state.filtered.map(site => [
      site.siteCode, site.siteName, site.type, site.grade, site.regional, site.area,
      site.district, site.province, site.latitude, site.longitude, site.customers,
      site.nodeEquipment, site.owner, site.opex, site.remark
    ]);
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `MOD2_Site_Facility_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`ส่งออก ${state.filtered.length.toLocaleString('th-TH')} sites แล้ว`, 'success');
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
    select.addEventListener('change', () => applyFilters());
  }

  function syncSiteSearch(value) {
    elements.siteSearch.value = value;
    elements.mapSiteSearch.value = value;
  }

  function scheduleSiteSearch(source) {
    syncSiteSearch(source.value);
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applyFilters(false), 130);
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
    syncSiteSearch('');
    for (const select of Object.values(filterElements)) {
      select.value = '';
    }
    applyFilters();
  });
  elements.reloadBtn.addEventListener('click', () => loadSites(true).catch(() => {}));
  elements.clusterBtn.addEventListener('click', () => {
    state.cluster = !state.cluster;
    state.density = false;
    elements.clusterBtn.classList.toggle('is-active', state.cluster);
    elements.heatBtn.classList.remove('is-active');
    renderMap();
  });
  elements.heatBtn.addEventListener('click', () => {
    state.density = !state.density;
    if (state.density) state.cluster = false;
    elements.heatBtn.classList.toggle('is-active', state.density);
    elements.clusterBtn.classList.toggle('is-active', state.cluster);
    renderMap();
  });
  elements.fitBtn.addEventListener('click', fitAll);
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
