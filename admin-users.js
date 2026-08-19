(() => {
  'use strict';

  const MODULES = [
    { key: 'mod1', label: 'MOD 1', description: 'วิเคราะห์ PEA / UFM และจัดการชุดข้อมูล' },
    { key: 'mod2', label: 'MOD 2', description: 'Site Facility, แผนที่ และรายงาน' }
  ];
  const state = { users: [], requests: [], search: '', activeTab: 'overview' };
  const context = () => window.permissionOutAdminContext;
  const currentRole = () => context()?.getCurrentProfile?.()?.role || 'user';
  const isAdmin = () => currentRole() === 'admin';
  const isManager = (role = currentRole()) => role === 'admin' || role === 'super_user';

  function roleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'super_user') return 'Super User';
    return 'User';
  }

  function roleDescription(role) {
    if (role === 'admin') return 'ควบคุมระบบและอนุมัติคำขอ';
    if (role === 'super_user') return 'ดูแลระบบ โดยการเพิ่มผู้ใช้ต้องผ่าน Admin';
    return 'ใช้งานตามสิทธิ์รายโมดูล';
  }

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function adminApi(path, options = {}) {
    const auth = context();
    const { data } = await auth.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return payload;
  }

  const makeRoleBadge = user => el('span', `admin-role-badge is-${user.role}`, roleLabel(user.role));
  const makeStatusBadge = user => el('span', `admin-status-badge ${user.isActive ? 'is-active' : 'is-inactive'}`, user.isActive ? 'ใช้งาน' : 'ระงับ');

  function normalizedPermissions(user) {
    const role = user?.role || 'user';
    const source = user?.permissions || {};
    const full = isManager(role);
    return Object.fromEntries(MODULES.map(module => {
      const permission = source[module.key] || {};
      return [module.key, { view: full || permission.view !== false, update: full || permission.update === true }];
    }));
  }

  const permissionInputName = (moduleKey, action) => `permission_${moduleKey}_${action}`;

  function makePermissionPanel(user, roleSelect) {
    const permissions = normalizedPermissions(user);
    const panel = el('section', 'admin-permission-panel');
    const heading = el('div', 'admin-permission-heading');
    heading.append(el('strong', '', 'สิทธิ์รายโมดูล'), el('span', '', 'Admin และ Super User ได้สิทธิ์เต็มโดยอัตโนมัติ'));
    const grid = el('div', 'admin-permission-grid');
    for (const module of MODULES) {
      const row = el('div', 'admin-permission-row');
      const label = el('div', 'admin-permission-label');
      label.append(el('strong', '', module.label), el('span', '', module.description));
      const view = el('label', 'admin-permission-toggle');
      const viewInput = document.createElement('input');
      viewInput.type = 'checkbox';
      viewInput.name = permissionInputName(module.key, 'view');
      viewInput.checked = permissions[module.key].view;
      view.append(viewInput, document.createTextNode('ดูข้อมูล'));
      const update = el('label', 'admin-permission-toggle');
      const updateInput = document.createElement('input');
      updateInput.type = 'checkbox';
      updateInput.name = permissionInputName(module.key, 'update');
      updateInput.checked = permissions[module.key].update;
      update.append(updateInput, document.createTextNode('แก้ไขข้อมูล'));
      viewInput.addEventListener('change', () => {
        if (!viewInput.checked) updateInput.checked = false;
        updateInput.disabled = !viewInput.checked || isManager(roleSelect.value);
      });
      row.append(label, view, update);
      grid.appendChild(row);
    }
    const syncRole = () => {
      const full = isManager(roleSelect.value);
      for (const module of MODULES) {
        const view = grid.querySelector(`[name="${permissionInputName(module.key, 'view')}"]`);
        const update = grid.querySelector(`[name="${permissionInputName(module.key, 'update')}"]`);
        if (full) {
          view.checked = true;
          update.checked = true;
        }
        view.disabled = full;
        update.disabled = full || !view.checked;
      }
    };
    roleSelect.addEventListener('change', syncRole);
    panel.append(heading, grid);
    syncRole();
    return panel;
  }

  function permissionsFromForm(form, role) {
    const full = isManager(role);
    return Object.fromEntries(MODULES.map(module => {
      const view = full || form.elements[permissionInputName(module.key, 'view')]?.checked === true;
      return [module.key, { view, update: full || (view && form.elements[permissionInputName(module.key, 'update')]?.checked === true) }];
    }));
  }

  function userMatchesSearch(user) {
    const query = state.search.trim().toLocaleLowerCase('th');
    return !query || `${user.email} ${user.displayName} ${user.organization} ${roleLabel(user.role)}`.toLocaleLowerCase('th').includes(query);
  }

  function statCard(label, value, tone = '') {
    const card = el('div', `admin-stat-card${tone ? ` is-${tone}` : ''}`);
    card.append(el('span', '', label), el('strong', '', String(value)));
    return card;
  }

  function renderOverview() {
    const root = el('div', 'admin-overview');
    const pending = state.requests.filter(item => item.status === 'pending').length;
    const stats = el('section', 'admin-overview-stats');
    stats.append(
      statCard('ผู้ใช้ทั้งหมด', state.users.length.toLocaleString('th-TH')),
      statCard('Admin', state.users.filter(user => user.role === 'admin').length.toLocaleString('th-TH'), 'admin'),
      statCard('Super User', state.users.filter(user => user.role === 'super_user').length.toLocaleString('th-TH'), 'super'),
      statCard('รออนุมัติ', pending.toLocaleString('th-TH'), pending ? 'pending' : '')
    );
    const grid = el('section', 'admin-overview-grid');
    const approval = el('article', 'admin-overview-card');
    approval.append(el('span', 'admin-card-kicker', 'USER GOVERNANCE'), el('h3', '', 'ผู้ใช้และการอนุมัติ'));
    approval.append(el('p', '', isAdmin()
      ? `มีคำขอรออนุมัติ ${pending.toLocaleString('th-TH')} รายการ ตรวจสอบสิทธิ์ก่อนส่งคำเชิญตั้งรหัสผ่าน`
      : 'คำขอสร้างผู้ใช้ของ Super User จะถูกส่งให้ Admin ตรวจสอบก่อนเปิดบัญชีเสมอ'));
    const approvalAction = el('button', 'admin-console-action', isAdmin() ? 'เปิดคิวอนุมัติ' : 'ดูสถานะคำขอ');
    approvalAction.type = 'button';
    approvalAction.addEventListener('click', () => switchTab('requests'));
    approval.appendChild(approvalAction);
    const modules = el('article', 'admin-overview-card');
    modules.append(el('span', 'admin-card-kicker', 'SYSTEM WORKSPACE'), el('h3', '', 'โมดูลและข้อมูลกลาง'));
    modules.append(el('p', '', 'เข้าถึง MOD 1, MOD 2 และเครื่องมือจัดการข้อมูลจากจุดเดียว'));
    const moduleAction = el('button', 'admin-console-action', 'เปิดศูนย์ระบบ');
    moduleAction.type = 'button';
    moduleAction.addEventListener('click', () => switchTab('system'));
    modules.appendChild(moduleAction);
    grid.append(approval, modules);
    root.append(stats, grid);
    return root;
  }

  function renderUserRows(container) {
    const visible = state.users.filter(userMatchesSearch);
    container.replaceChildren();
    if (!visible.length) {
      const empty = el('div', 'admin-users-empty');
      empty.append(el('strong', '', 'ไม่พบผู้ใช้'), el('span', '', 'ลองเปลี่ยนคำค้นหา หรือเพิ่มผู้ใช้ใหม่'));
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const user of visible) {
      const row = el('article', 'admin-user-row');
      const avatar = el('span', 'admin-user-avatar', (user.displayName || user.email || 'U').trim().charAt(0).toUpperCase());
      const identity = el('div', 'admin-user-identity');
      const nameLine = el('div', 'admin-user-name-line');
      nameLine.append(el('strong', '', user.displayName || user.email), makeRoleBadge(user), makeStatusBadge(user));
      identity.append(nameLine, el('span', 'admin-user-email', user.email), el('span', 'admin-user-organization', user.organization || 'ไม่ระบุหน่วยงาน'));
      const activity = el('div', 'admin-user-activity');
      activity.append(el('span', '', roleDescription(user.role)), el('strong', '', `เข้าใช้ล่าสุด ${formatDate(user.lastSignInAt)}`));
      const actions = el('div', 'admin-user-actions');
      const canChange = isAdmin() || user.role === 'user';
      const edit = el('button', 'admin-action-button', 'แก้ไข');
      edit.type = 'button';
      edit.disabled = !canChange;
      if (!canChange) edit.title = 'Super User แก้ไขบัญชีสิทธิ์สูงไม่ได้';
      edit.addEventListener('click', () => showUserEditor(user));
      const remove = el('button', 'admin-action-button is-danger', 'ลบ');
      remove.type = 'button';
      remove.disabled = user.id === context().getCurrentUser()?.id || !canChange;
      remove.addEventListener('click', () => deleteUser(user));
      actions.append(edit, remove);
      row.append(avatar, identity, activity, actions);
      fragment.appendChild(row);
    }
    container.appendChild(fragment);
  }

  function renderUsers() {
    const content = el('div', 'admin-users');
    const toolbar = el('div', 'admin-users-toolbar');
    const searchWrap = el('label', 'admin-users-search');
    searchWrap.append(el('span', 'sr-only', 'ค้นหาผู้ใช้'));
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'ค้นหาชื่อ อีเมล หน่วยงาน หรือบทบาท…';
    search.value = state.search;
    search.autocomplete = 'off';
    search.maxLength = 120;
    searchWrap.appendChild(search);
    const add = el('button', 'modal-primary admin-add-user', isAdmin() ? '+ สร้างผู้ใช้' : '+ ส่งคำขอเพิ่มผู้ใช้');
    add.type = 'button';
    add.addEventListener('click', () => showUserEditor());
    toolbar.append(searchWrap, add);
    const summary = el('div', 'admin-users-summary');
    summary.append(el('span', '', `ทั้งหมด ${state.users.length.toLocaleString('th-TH')} คน`), el('span', '', `ใช้งาน ${state.users.filter(user => user.isActive).length.toLocaleString('th-TH')} คน`));
    const list = el('div', 'admin-users-list');
    search.addEventListener('input', () => {
      state.search = search.value;
      renderUserRows(list);
    });
    content.append(toolbar, summary, list);
    renderUserRows(list);
    return content;
  }

  const REQUEST_STATUS = {
    pending: ['รออนุมัติ', 'pending'], processing: ['กำลังดำเนินการ', 'processing'],
    approved: ['อนุมัติแล้ว', 'approved'], rejected: ['ไม่อนุมัติ', 'rejected'], cancelled: ['ยกเลิก', 'cancelled']
  };

  function renderRequests() {
    const root = el('div', 'admin-requests');
    const intro = el('div', 'admin-section-intro');
    intro.append(el('div', '', isAdmin() ? 'คิวอนุมัติการสร้างผู้ใช้' : 'คำขอที่คุณส่ง'), el('span', '', isAdmin() ? 'เมื่ออนุมัติ ระบบจะส่งอีเมลเชิญให้ผู้ใช้ตั้งรหัสผ่านเอง' : 'Admin ต้องอนุมัติก่อนจึงจะส่งคำเชิญและเปิดบัญชี'));
    const list = el('div', 'admin-request-list');
    if (!state.requests.length) {
      const empty = el('div', 'admin-users-empty');
      empty.append(el('strong', '', 'ยังไม่มีคำขอ'), el('span', '', 'คำขอสร้างผู้ใช้จะแสดงที่นี่'));
      list.appendChild(empty);
    }
    for (const item of state.requests) {
      const row = el('article', 'admin-request-row');
      const status = REQUEST_STATUS[item.status] || [item.status, ''];
      const head = el('div', 'admin-request-head');
      const identity = el('div', 'admin-request-identity');
      identity.append(el('strong', '', item.displayName || item.email), el('span', '', item.email), el('small', '', `${item.organization || 'ไม่ระบุหน่วยงาน'} · ขอสิทธิ์ ${roleLabel(item.requestedRole)}`));
      head.append(identity, el('span', `admin-request-status is-${status[1]}`, status[0]));
      const meta = el('div', 'admin-request-meta');
      meta.append(el('span', '', `ส่งเมื่อ ${formatDate(item.createdAt)}`));
      if (item.reviewedAt) meta.append(el('span', '', `ตรวจเมื่อ ${formatDate(item.reviewedAt)}`));
      if (item.reviewNote) meta.append(el('span', 'admin-request-note', `หมายเหตุ: ${item.reviewNote}`));
      row.append(head, meta);
      if (isAdmin() && item.status === 'pending') {
        const actions = el('div', 'admin-request-actions');
        const reject = el('button', 'admin-action-button is-danger', 'ไม่อนุมัติ');
        reject.type = 'button';
        reject.addEventListener('click', () => reviewRequest(item, 'reject'));
        const approve = el('button', 'modal-primary', 'อนุมัติและส่งคำเชิญ');
        approve.type = 'button';
        approve.addEventListener('click', () => reviewRequest(item, 'approve'));
        actions.append(reject, approve);
        row.appendChild(actions);
      }
      list.appendChild(row);
    }
    root.append(intro, list);
    return root;
  }

  function renderSystem() {
    const root = el('div', 'admin-system-grid');
    for (const item of [
      { title: 'MOD 1 · วิเคราะห์ PEA / UFM', detail: 'งานวิเคราะห์เส้นทาง โครงการ และชุดข้อมูลกลาง', href: '/' },
      { title: 'MOD 2 · Site Facility', detail: 'แผนที่ไซต์ ความคิดเห็น OPEX และรายงาน', href: '/mod2/' }
    ]) {
      const card = el('article', 'admin-system-card');
      card.append(el('h3', '', item.title), el('p', '', item.detail));
      const link = el('a', 'admin-console-action', 'เปิดโมดูล');
      link.href = item.href;
      card.appendChild(link);
      root.appendChild(card);
    }
    const data = el('article', 'admin-system-card is-wide');
    data.append(el('h3', '', 'ข้อมูลกลาง PEA / UFM'), el('p', '', 'อัปโหลดเข้า Staging ตรวจความเปลี่ยนแปลง เผยแพร่ และย้อนกลับเวอร์ชัน'));
    if (context().canAccessModule?.('mod1', 'update')) {
      const button = el('button', 'admin-console-action', 'เปิดเครื่องมือจัดการข้อมูล');
      button.type = 'button';
      button.addEventListener('click', () => window.permissionOutOpenAdminData ? window.permissionOutOpenAdminData() : (location.href = '/'));
      data.appendChild(button);
    }
    root.appendChild(data);
    return root;
  }

  function tabButton(key, label, count = null) {
    const button = el('button', `admin-console-tab${state.activeTab === key ? ' is-active' : ''}`);
    button.type = 'button';
    button.append(document.createTextNode(label));
    if (count !== null) button.append(el('span', '', String(count)));
    button.addEventListener('click', () => switchTab(key));
    return button;
  }

  function renderManager() {
    const root = el('div', 'admin-console');
    const hero = el('header', 'admin-console-hero');
    const copy = el('div');
    copy.append(el('span', 'admin-card-kicker', 'PERMISSION OUT CONTROL CENTER'), el('h2', '', 'ศูนย์จัดการระบบ'), el('p', '', `${roleLabel(currentRole())} · ${roleDescription(currentRole())}`));
    hero.append(copy, el('span', `admin-console-role is-${currentRole()}`, roleLabel(currentRole())));
    const pending = state.requests.filter(item => item.status === 'pending').length;
    const nav = el('nav', 'admin-console-tabs');
    nav.setAttribute('aria-label', 'เมนูศูนย์จัดการระบบ');
    nav.append(tabButton('overview', 'ภาพรวม'), tabButton('users', 'ผู้ใช้', state.users.length), tabButton('requests', isAdmin() ? 'รออนุมัติ' : 'คำขอของฉัน', pending), tabButton('system', 'ระบบและข้อมูล'));
    const body = el('div', 'admin-console-body');
    body.appendChild(state.activeTab === 'users' ? renderUsers() : state.activeTab === 'requests' ? renderRequests() : state.activeTab === 'system' ? renderSystem() : renderOverview());
    root.append(hero, nav, body);
    context().openModal('ศูนย์จัดการระบบ', 'ผู้ใช้ สิทธิ์ การอนุมัติ โมดูล และข้อมูลกลางในพื้นที่เดียว', root, true);
    document.querySelector('.app-modal')?.classList.add('app-modal-admin-center');
  }

  function switchTab(tab) {
    state.activeTab = tab;
    renderManager();
  }

  async function loadManager() {
    context().openModal('ศูนย์จัดการระบบ', 'กำลังโหลดผู้ใช้และคำขออนุมัติ', el('div', 'admin-users-loading', 'กำลังเตรียมศูนย์จัดการระบบ…'), true);
    try {
      const [usersPayload, requestsPayload] = await Promise.all([adminApi('/api/admin/users?perPage=100'), adminApi('/api/admin/user-requests')]);
      state.users = usersPayload.users || [];
      state.requests = requestsPayload.requests || [];
      renderManager();
    } catch (error) {
      const failed = el('div', 'admin-users-error');
      failed.append(el('strong', '', 'เปิดศูนย์จัดการระบบไม่สำเร็จ'), el('span', '', error.message));
      const retry = el('button', 'modal-primary', 'ลองใหม่');
      retry.type = 'button';
      retry.addEventListener('click', loadManager);
      failed.appendChild(retry);
      context().openModal('ศูนย์จัดการระบบ', 'เกิดข้อผิดพลาด', failed, true);
    }
  }

  function field(labelText, input) {
    const wrap = el('div', 'modal-field');
    const label = el('label', '', labelText);
    label.htmlFor = input.id;
    wrap.append(label, input);
    return wrap;
  }

  function textInput(id, value, options = {}) {
    const input = document.createElement('input');
    input.id = id;
    input.type = options.type || 'text';
    input.value = value || '';
    input.required = Boolean(options.required);
    input.maxLength = options.maxLength || 160;
    if (options.minLength) input.minLength = options.minLength;
    input.autocomplete = options.autocomplete || 'off';
    input.placeholder = options.placeholder || '';
    return input;
  }

  function showUserEditor(user = null) {
    const editing = Boolean(user);
    if (editing && !isAdmin() && user.role !== 'user') {
      context().toast('Super User แก้ไขบัญชีสิทธิ์สูงไม่ได้', 'error');
      return;
    }
    const content = el('div', 'admin-user-editor');
    const back = el('button', 'admin-back-button', '← กลับศูนย์จัดการ');
    back.type = 'button';
    back.addEventListener('click', renderManager);
    const form = document.createElement('form');
    form.className = 'admin-user-form';
    form.noValidate = true;
    const email = textInput('adminUserEmail', user?.email, { type: 'email', required: true, maxLength: 254, placeholder: 'name@company.com' });
    const displayName = textInput('adminUserDisplayName', user?.displayName, { required: true, maxLength: 120, placeholder: 'ชื่อที่แสดงในระบบ' });
    const organization = textInput('adminUserOrganization', user?.organization, { maxLength: 160, placeholder: 'ชื่อหน่วยงาน' });
    const password = textInput('adminUserPassword', '', { type: 'password', required: isAdmin() && !editing, minLength: 12, maxLength: 128, autocomplete: 'new-password', placeholder: editing ? 'เว้นว่างหากไม่ต้องการเปลี่ยน' : 'อย่างน้อย 12 ตัวอักษร' });
    const role = document.createElement('select');
    role.id = 'adminUserRole';
    role.innerHTML = isAdmin()
      ? '<option value="user">User — ผู้ใช้งาน</option><option value="super_user">Super User — ผู้ดูแลขั้นสูง</option><option value="admin">Admin — ผู้ดูแลระบบ</option>'
      : editing
        ? '<option value="user">User — ผู้ใช้งาน</option>'
        : '<option value="user">User — ผู้ใช้งาน</option><option value="super_user">Super User — ต้องรอ Admin อนุมัติ</option>';
    role.value = user?.role || 'user';
    const active = document.createElement('select');
    active.id = 'adminUserActive';
    active.innerHTML = '<option value="true">ใช้งาน</option><option value="false">ระงับการใช้งาน</option>';
    active.value = String(user?.isActive !== false);
    const grid = el('div', 'admin-user-form-grid');
    grid.append(field('อีเมล', email), field('ชื่อผู้ใช้', displayName), field('หน่วยงาน', organization), field('บทบาท', role));
    if (isAdmin()) grid.append(field(editing ? 'รหัสผ่านใหม่ (ไม่บังคับ)' : 'รหัสผ่านเริ่มต้น', password), field('สถานะ', active));
    else if (!editing) {
      const notice = el('div', 'admin-approval-notice');
      notice.append(el('strong', '', 'ขั้นตอนอนุมัติโดย Admin'), el('p', '', 'ระบบจะไม่เก็บรหัสผ่านในคำขอ เมื่อ Admin อนุมัติ ผู้ใช้จะได้รับอีเมลเพื่อตั้งรหัสผ่านด้วยตนเอง'));
      grid.appendChild(notice);
    }
    const errorBox = el('div', 'auth-inline-error');
    errorBox.setAttribute('role', 'alert');
    const actions = el('div', 'admin-user-form-actions');
    const cancel = el('button', 'admin-action-button', 'ยกเลิก');
    cancel.type = 'button';
    cancel.addEventListener('click', renderManager);
    const submitLabel = editing ? 'บันทึกการแก้ไข' : isAdmin() ? 'สร้างผู้ใช้ทันที' : 'ส่งคำขอให้ Admin';
    const submit = el('button', 'modal-primary', submitLabel);
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(grid, makePermissionPanel(user, role), errorBox, actions);
    content.append(back, form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      errorBox.textContent = '';
      submit.disabled = true;
      submit.textContent = 'กำลังดำเนินการ…';
      const payload = { email: email.value.trim(), displayName: displayName.value.trim(), organization: organization.value.trim(), role: role.value, isActive: active.value === 'true', permissions: permissionsFromForm(form, role.value) };
      if (isAdmin() && password.value) payload.password = password.value;
      try {
        const result = await adminApi(editing ? `/api/admin/users/${encodeURIComponent(user.id)}` : '/api/admin/users', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        if (result.request) {
          state.requests.unshift(result.request);
          state.activeTab = 'requests';
          context().toast('ส่งคำขอให้ Admin อนุมัติแล้ว', 'success');
        } else if (editing) {
          const index = state.users.findIndex(item => item.id === user.id);
          if (index >= 0) state.users[index] = result.user;
          context().toast('แก้ไขผู้ใช้แล้ว', 'success');
        } else {
          state.users.unshift(result.user);
          context().toast('สร้างผู้ใช้แล้ว', 'success');
        }
        renderManager();
      } catch (error) {
        errorBox.textContent = error.message;
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });
    context().openModal(editing ? 'แก้ไขผู้ใช้และสิทธิ์' : isAdmin() ? 'สร้างผู้ใช้' : 'ส่งคำขอเพิ่มผู้ใช้', editing ? user.email : roleDescription(currentRole()), content, true);
  }

  async function reviewRequest(item, action) {
    const verb = action === 'approve' ? 'อนุมัติและส่งอีเมลเชิญ' : 'ไม่อนุมัติ';
    if (!confirm(`${verb}คำขอของ ${item.email}?`)) return;
    const reviewNote = action === 'reject' ? (prompt('ระบุเหตุผลที่ไม่อนุมัติ (ไม่บังคับ)', '') || '') : '';
    try {
      const result = await adminApi(`/api/admin/user-requests/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ action, reviewNote }) });
      const index = state.requests.findIndex(request => request.id === item.id);
      if (index >= 0) state.requests[index] = result.request;
      if (result.user) state.users.unshift(result.user);
      context().toast(action === 'approve' ? 'อนุมัติและส่งคำเชิญแล้ว' : 'บันทึกการไม่อนุมัติแล้ว', 'success');
      renderManager();
    } catch (error) {
      context().toast(error.message, 'error');
    }
  }

  async function deleteUser(user) {
    if (!confirm(`ยืนยันการลบบัญชี ${user.email}?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
      await adminApi(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      state.users = state.users.filter(item => item.id !== user.id);
      context().toast('ลบผู้ใช้แล้ว', 'success');
      renderManager();
    } catch (error) {
      context().toast(error.message, 'error');
    }
  }

  window.permissionOutOpenAdminUsers = function () {
    if (!isManager()) {
      context()?.toast('เฉพาะ Admin หรือ Super User เท่านั้น', 'error');
      return;
    }
    loadManager();
  };
})();
