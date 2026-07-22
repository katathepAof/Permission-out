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
        base: Array.from(document.getElementById('fileBase')?.files || []).map(f => f.name),
        compare: Array.from(document.getElementById('fileCompare')?.files || []).map(f => f.name)
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
    content.innerHTML = '<div class="auth-note" style="background:#fff4df;color:#744f08">Production workspace นี้กำหนดให้ใช้ Supabase แต่ยังไม่พบ Project URL หรือ Publishable Key กรุณาตั้งค่า Environment Variables ที่ Cloudflare Pages แล้ว deploy ใหม่</div><div class="modal-field"><label>Environment Variables ที่ต้องมี</label><input value="SUPABASE_URL" readonly><input value="SUPABASE_PUBLISHABLE_KEY" readonly></div>';
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
  }
  initialize().catch(error => { updateAccountUI(); toast(`เริ่มระบบ Cloud ไม่สำเร็จ: ${error.message}`, 'error'); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
