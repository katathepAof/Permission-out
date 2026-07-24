(function () {
  'use strict';

  const context = window.permissionOutAdminContext;
  if (!context) return;

  const state = { users: [], search: '' };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function adminApi(path, options = {}) {
    const { data } = await context.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'ดำเนินการไม่สำเร็จ');
      error.code = payload.error?.code || 'request_failed';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function formatDate(value) {
    if (!value) return 'ยังไม่เคยเข้าสู่ระบบ';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function userMatchesSearch(user) {
    const query = state.search.trim().toLocaleLowerCase('th');
    return !query || `${user.email} ${user.displayName} ${user.organization}`.toLocaleLowerCase('th').includes(query);
  }

  function makeRoleBadge(user) {
    const badge = el('span', `admin-role-badge is-${user.role}`, user.role === 'admin' ? 'Admin' : 'User');
    return badge;
  }

  function makeStatusBadge(user) {
    return el('span', `admin-status-badge ${user.isActive ? 'is-active' : 'is-inactive'}`, user.isActive ? 'ใช้งาน' : 'ระงับ');
  }

  function renderUserRows(container) {
    const visible = state.users.filter(userMatchesSearch);
    container.replaceChildren();
    if (!visible.length) {
      const empty = el('div', 'admin-users-empty');
      empty.innerHTML = '<strong>ไม่พบผู้ใช้</strong><span>ลองเปลี่ยนคำค้นหา หรือเพิ่มผู้ใช้ใหม่</span>';
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const user of visible) {
      const row = el('article', 'admin-user-row');
      row.dataset.userId = user.id;

      const avatar = el('span', 'admin-user-avatar', (user.displayName || user.email || 'U').trim().charAt(0).toUpperCase());
      const identity = el('div', 'admin-user-identity');
      const nameLine = el('div', 'admin-user-name-line');
      nameLine.append(el('strong', '', user.displayName || user.email), makeRoleBadge(user), makeStatusBadge(user));
      const email = el('span', 'admin-user-email', user.email);
      const organization = el('span', 'admin-user-organization', user.organization || 'ไม่ระบุหน่วยงาน');
      identity.append(nameLine, email, organization);

      const activity = el('div', 'admin-user-activity');
      activity.append(el('span', '', 'เข้าใช้ล่าสุด'), el('strong', '', formatDate(user.lastSignInAt)));

      const actions = el('div', 'admin-user-actions');
      const edit = el('button', 'admin-action-button', 'แก้ไข');
      edit.type = 'button';
      edit.addEventListener('click', () => showUserEditor(user));
      const remove = el('button', 'admin-action-button is-danger', 'ลบ');
      remove.type = 'button';
      remove.disabled = user.id === context.getCurrentUser()?.id;
      if (remove.disabled) remove.title = 'ไม่สามารถลบบัญชีที่กำลังใช้งาน';
      remove.addEventListener('click', () => deleteUser(user));
      actions.append(edit, remove);
      row.append(avatar, identity, activity, actions);
      fragment.appendChild(row);
    }
    container.appendChild(fragment);
  }

  function renderManager() {
    const content = el('div', 'admin-users');
    const toolbar = el('div', 'admin-users-toolbar');
    const searchWrap = el('label', 'admin-users-search');
    searchWrap.append(el('span', 'sr-only', 'ค้นหาผู้ใช้'));
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'ค้นหาชื่อ อีเมล หรือหน่วยงาน…';
    search.value = state.search;
    search.autocomplete = 'off';
    search.maxLength = 120;
    searchWrap.appendChild(search);
    const add = el('button', 'modal-primary admin-add-user', '+ เพิ่มผู้ใช้');
    add.type = 'button';
    add.addEventListener('click', () => showUserEditor());
    toolbar.append(searchWrap, add);

    const summary = el('div', 'admin-users-summary');
    summary.append(
      el('span', '', `ผู้ใช้ทั้งหมด ${state.users.length.toLocaleString('th-TH')} คน`),
      el('span', '', `Admin ${state.users.filter(user => user.role === 'admin').length.toLocaleString('th-TH')} คน`)
    );
    const list = el('div', 'admin-users-list');
    search.addEventListener('input', () => {
      state.search = search.value;
      renderUserRows(list);
    });
    content.append(toolbar, summary, list);
    renderUserRows(list);
    context.openModal('จัดการผู้ใช้', 'เพิ่ม แก้ไข ระงับ หรือลบบัญชี Permission Out', content, true);
  }

  async function loadUsers() {
    const content = el('div', 'admin-users-loading', 'กำลังโหลดรายชื่อผู้ใช้…');
    context.openModal('จัดการผู้ใช้', 'เฉพาะผู้ดูแลระบบ', content, true);
    try {
      const payload = await adminApi('/api/admin/users?perPage=100');
      state.users = payload.users || [];
      renderManager();
    } catch (error) {
      const failed = el('div', 'admin-users-error');
      failed.append(el('strong', '', 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ'), el('span', '', error.message));
      const retry = el('button', 'modal-primary', 'ลองใหม่');
      retry.type = 'button';
      retry.addEventListener('click', loadUsers);
      failed.appendChild(retry);
      document.getElementById('appModalBody').replaceChildren(failed);
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
    const content = el('div', 'admin-user-editor');
    const back = el('button', 'admin-back-button', '← กลับไปรายชื่อผู้ใช้');
    back.type = 'button';
    back.addEventListener('click', renderManager);

    const form = document.createElement('form');
    form.className = 'admin-user-form';
    form.noValidate = true;
    const email = textInput('adminUserEmail', user?.email, {
      type: 'email', required: true, maxLength: 254, autocomplete: 'off', placeholder: 'name@company.com'
    });
    const displayName = textInput('adminUserDisplayName', user?.displayName, {
      required: true, maxLength: 120, placeholder: 'ชื่อที่แสดงในระบบ'
    });
    const organization = textInput('adminUserOrganization', user?.organization, {
      maxLength: 160, placeholder: 'ชื่อหน่วยงาน'
    });
    const password = textInput('adminUserPassword', '', {
      type: 'password',
      required: !editing,
      minLength: 12,
      maxLength: 128,
      autocomplete: 'new-password',
      placeholder: editing ? 'เว้นว่างหากไม่ต้องการเปลี่ยน' : 'อย่างน้อย 12 ตัวอักษร'
    });
    const role = document.createElement('select');
    role.id = 'adminUserRole';
    role.innerHTML = '<option value="user">User — ผู้ใช้งาน</option><option value="admin">Admin — ผู้ดูแลระบบ</option>';
    role.value = user?.role || 'user';
    const active = document.createElement('select');
    active.id = 'adminUserActive';
    active.innerHTML = '<option value="true">ใช้งาน</option><option value="false">ระงับการใช้งาน</option>';
    active.value = String(user?.isActive !== false);

    const grid = el('div', 'admin-user-form-grid');
    grid.append(
      field('อีเมล', email),
      field('ชื่อผู้ใช้', displayName),
      field('หน่วยงาน', organization),
      field(editing ? 'รหัสผ่านใหม่ (ไม่บังคับ)' : 'รหัสผ่านเริ่มต้น', password),
      field('สิทธิ์', role),
      field('สถานะ', active)
    );
    const errorBox = el('div', 'auth-inline-error');
    errorBox.id = 'adminUserFormError';
    errorBox.setAttribute('role', 'alert');
    const actions = el('div', 'admin-user-form-actions');
    const cancel = el('button', 'admin-action-button', 'ยกเลิก');
    cancel.type = 'button';
    cancel.addEventListener('click', renderManager);
    const submit = el('button', 'modal-primary', editing ? 'บันทึกการแก้ไข' : 'สร้างผู้ใช้');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(grid, errorBox, actions);
    content.append(back, form);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      errorBox.textContent = '';
      submit.disabled = true;
      submit.textContent = editing ? 'กำลังบันทึก…' : 'กำลังสร้างผู้ใช้…';
      const payload = {
        email: email.value.trim(),
        displayName: displayName.value.trim(),
        organization: organization.value.trim(),
        role: role.value,
        isActive: active.value === 'true'
      };
      if (password.value) payload.password = password.value;
      try {
        const result = await adminApi(editing ? `/api/admin/users/${encodeURIComponent(user.id)}` : '/api/admin/users', {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        if (editing) {
          const index = state.users.findIndex(item => item.id === user.id);
          if (index >= 0) state.users[index] = result.user;
        } else {
          state.users.unshift(result.user);
        }
        context.toast(editing ? 'แก้ไขผู้ใช้แล้ว' : 'สร้างผู้ใช้แล้ว', 'success');
        renderManager();
      } catch (error) {
        errorBox.textContent = error.message;
        submit.disabled = false;
        submit.textContent = editing ? 'บันทึกการแก้ไข' : 'สร้างผู้ใช้';
      }
    });

    context.openModal(editing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้', editing ? user.email : 'สร้างบัญชีใหม่ใน Supabase Auth', content, true);
  }

  async function deleteUser(user) {
    if (!confirm(`ยืนยันการลบบัญชี ${user.email}?\n\nโครงการและประวัติที่เป็นของบัญชีนี้จะถูกลบตามนโยบายฐานข้อมูล`)) return;
    try {
      await adminApi(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      state.users = state.users.filter(item => item.id !== user.id);
      context.toast('ลบผู้ใช้แล้ว', 'success');
      renderManager();
    } catch (error) {
      context.toast(error.message, 'error');
    }
  }

  window.permissionOutOpenAdminUsers = function () {
    if (context.getCurrentProfile()?.role !== 'admin') {
      context.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error');
      return;
    }
    loadUsers();
  };
})();
