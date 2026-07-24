(() => {
  'use strict';

  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const FEATURE_BATCH_SIZE = 75;
  const state = { datasets: [], busy: false };

  function context() {
    return window.permissionOutAdminContext;
  }

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('th-TH');
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('th-TH');
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  async function api(path, options = {}) {
    const auth = context();
    const { data } = await auth.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return payload;
  }

  async function sha256(file) {
    if (!globalThis.crypto?.subtle) throw new Error('เบราว์เซอร์นี้ไม่รองรับการตรวจสอบ SHA-256');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function cleanIdentity(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('th');
  }

  function lineProperties(line) {
    const source = line.sourceMetadata || {};
    return {
      name: line.name || '',
      code: source.code || '',
      original_name: source.originalName || '',
      measured: source.measured || '',
      calculated: source.calculated || '',
      pole_count: source.poleCount || '',
      cable_type: line.cableType || '',
      type: line.rawType || line.type || '',
      status: line.cableStatus || '',
      core: line.core ?? '',
      diameter_mm: line.diameter ?? '',
      diameter_source: line.diameterSource || '',
      source_file: line.sourceFile || ''
    };
  }

  function linesToFeatures(lines, fileName) {
    const occurrences = new Map();
    return lines.map((line, index) => {
      const properties = lineProperties(line);
      const baseIdentity = cleanIdentity(properties.code || line.name || properties.original_name || `feature-${index + 1}`);
      const occurrence = (occurrences.get(baseIdentity) || 0) + 1;
      occurrences.set(baseIdentity, occurrence);
      return {
        logical_id: `${cleanIdentity(fileName)}::${baseIdentity}::${occurrence}`,
        source_index: index,
        name: String(line.name || properties.original_name || `รายการ ${index + 1}`).slice(0, 500),
        properties,
        geometry: { type: 'LineString', coordinates: line.coords }
      };
    });
  }

  function statusLabel(status) {
    return {
      staging: 'กำลังนำเข้า',
      ready: 'รอตรวจสอบ/เผยแพร่',
      active: 'กำลังใช้งาน',
      archived: 'ประวัติเวอร์ชัน',
      failed: 'นำเข้าไม่สำเร็จ'
    }[status] || status;
  }

  function diffSummary(version) {
    const wrap = el('div', 'data-version-diff');
    const values = [
      ['เพิ่ม', version.newCount, 'is-new'],
      ['เปลี่ยน', version.updatedCount, 'is-updated'],
      ['ลบ', version.removedCount, 'is-removed'],
      ['เหมือนเดิม', version.unchangedCount, 'is-unchanged']
    ];
    for (const [label, value, className] of values) {
      const item = el('span', className);
      item.append(el('small', '', label), el('strong', '', formatNumber(value)));
      wrap.appendChild(item);
    }
    return wrap;
  }

  async function publishVersion(version, dataset) {
    const rollback = version.status === 'archived';
    const message = rollback
      ? `ต้องการย้อนกลับ ${dataset.displayName} ไปเวอร์ชัน ${version.versionNo} หรือไม่?`
      : `ต้องการเผยแพร่ ${dataset.displayName} เวอร์ชัน ${version.versionNo} หรือไม่?\n\nเพิ่ม ${formatNumber(version.newCount)} · เปลี่ยน ${formatNumber(version.updatedCount)} · ลบ ${formatNumber(version.removedCount)}`;
    if (!confirm(message)) return;
    await api(`/api/admin/data/versions/${encodeURIComponent(version.id)}/publish`, { method: 'POST' });
    context().toast(rollback ? 'ย้อนกลับเวอร์ชันเรียบร้อยแล้ว' : 'เผยแพร่ข้อมูลเรียบร้อยแล้ว', 'success');
    await loadDatasets();
  }

  function renderVersion(version, dataset) {
    const card = el('article', `data-version is-${version.status}`);
    const head = el('div', 'data-version-head');
    const title = el('div');
    title.append(
      el('strong', '', `เวอร์ชัน ${version.versionNo}`),
      el('span', `data-status is-${version.status}`, statusLabel(version.status))
    );
    const date = el('time', '', formatDate(version.publishedAt || version.validatedAt || version.createdAt));
    head.append(title, date);
    card.append(head);
    card.append(el('p', 'data-version-meta', `${formatNumber(version.featureCount)} รายการ · ${formatBytes(version.rawSize)}`));
    if (['ready', 'active', 'archived'].includes(version.status)) card.append(diffSummary(version));
    if (version.errorMessage) card.append(el('p', 'data-version-error', version.errorMessage));
    if (version.status === 'ready' || version.status === 'archived') {
      const action = el('button', version.status === 'ready' ? 'data-publish' : 'data-rollback');
      action.type = 'button';
      action.textContent = version.status === 'ready' ? 'เผยแพร่เวอร์ชันนี้' : 'ย้อนกลับเวอร์ชันนี้';
      action.addEventListener('click', () => publishVersion(version, dataset).catch(error => context().toast(error.message, 'error')));
      card.appendChild(action);
    }
    return card;
  }

  function renderDatasets() {
    const root = document.getElementById('adminDataList');
    if (!root) return;
    root.replaceChildren();
    if (!state.datasets.length) {
      const empty = el('div', 'admin-data-empty');
      empty.append(el('strong', '', 'ยังไม่มีประวัติการอัปเดต'), el('p', '', 'อัปโหลดไฟล์เดิมหรือไฟล์ใหม่เพื่อสร้างเวอร์ชันแรก'));
      root.appendChild(empty);
      return;
    }
    for (const dataset of state.datasets) {
      const card = el('section', 'admin-dataset-card');
      const head = el('header', 'admin-dataset-head');
      const copy = el('div');
      copy.append(
        el('span', `data-source is-${dataset.source}`, dataset.source.toUpperCase()),
        el('h3', '', dataset.displayName)
      );
      const active = dataset.versions.find(version => version.id === dataset.activeVersionId);
      head.append(copy, el('span', 'active-version', active ? `ใช้งาน v${active.versionNo}` : 'ยังไม่เผยแพร่'));
      card.append(head);
      const versions = el('div', 'data-version-list');
      for (const version of dataset.versions) versions.appendChild(renderVersion(version, dataset));
      card.appendChild(versions);
      root.appendChild(card);
    }
  }

  async function loadDatasets() {
    const root = document.getElementById('adminDataList');
    if (root) root.innerHTML = '<div class="admin-data-loading">กำลังโหลดประวัติข้อมูล…</div>';
    const payload = await api('/api/admin/data/datasets');
    state.datasets = payload.datasets || [];
    renderDatasets();
  }

  function progressRow(file) {
    const row = el('div', 'data-upload-row');
    const copy = el('div');
    copy.append(el('strong', '', file.name), el('small', '', formatBytes(file.size)));
    const status = el('span', 'data-upload-status', 'รอดำเนินการ');
    const bar = el('div', 'data-upload-bar');
    const fill = el('i');
    bar.appendChild(fill);
    row.append(copy, status, bar);
    return {
      row,
      update(text, percent, kind = '') {
        status.textContent = text;
        status.className = `data-upload-status ${kind ? `is-${kind}` : ''}`.trim();
        fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      }
    };
  }

  async function markFailed(versionId, message) {
    if (!versionId) return;
    await api(`/api/admin/data/versions/${encodeURIComponent(versionId)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ message: String(message || '').slice(0, 1000) })
    }).catch(() => {});
  }

  async function uploadFile(file, source, progress) {
    if (!/\.(kml|kmz)$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .kml และ .kmz');
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 100 MB');
    let versionId = null;
    try {
      progress.update('กำลังตรวจสอบไฟล์…', 8);
      const hash = await sha256(file);
      progress.update('กำลังสร้าง Staging version…', 18);
      const created = await api('/api/admin/data/uploads', {
        method: 'POST',
        body: JSON.stringify({ source, fileName: file.name, size: file.size, sha256: hash })
      });
      versionId = created.version.id;
      progress.update('กำลังเก็บไฟล์ต้นฉบับ…', 28);
      const uploaded = await context().client.storage
        .from(created.upload.bucket)
        .uploadToSignedUrl(created.upload.path, created.upload.token, file, {
          contentType: file.type || (/\.kmz$/i.test(file.name) ? 'application/vnd.google-earth.kmz' : 'application/vnd.google-earth.kml+xml')
        });
      if (uploaded.error) throw uploaded.error;

      progress.update('กำลังอ่าน KML/KMZ…', 40);
      if (typeof window.readKmlOrKmzText !== 'function' || typeof window.parseKML !== 'function') {
        throw new Error('ไม่พบตัวอ่าน KML/KMZ ของระบบ');
      }
      const text = await window.readKmlOrKmzText(file);
      const lines = window.parseKML(text).map(line => ({ ...line, sourceFile: file.name }));
      if (!lines.length) throw new Error('ไม่พบเส้นทางในไฟล์');
      const features = linesToFeatures(lines, file.name);
      for (let offset = 0; offset < features.length; offset += FEATURE_BATCH_SIZE) {
        const batch = features.slice(offset, offset + FEATURE_BATCH_SIZE);
        await api(`/api/admin/data/versions/${encodeURIComponent(versionId)}/features`, {
          method: 'POST',
          body: JSON.stringify({ features: batch })
        });
        const ratio = (offset + batch.length) / features.length;
        progress.update(`กำลังนำเข้า ${formatNumber(offset + batch.length)}/${formatNumber(features.length)} รายการ`, 45 + ratio * 40);
      }
      progress.update('กำลังเปรียบเทียบเวอร์ชัน…', 90);
      const completed = await api(`/api/admin/data/versions/${encodeURIComponent(versionId)}/complete`, { method: 'POST' });
      const version = completed.version;
      progress.update(`พร้อมตรวจสอบ — เพิ่ม ${formatNumber(version.newCount)} · เปลี่ยน ${formatNumber(version.updatedCount)} · ลบ ${formatNumber(version.removedCount)}`, 100, 'success');
      return version;
    } catch (error) {
      await markFailed(versionId, error.message);
      progress.update(error.message, 100, 'error');
      throw error;
    }
  }

  async function startUpload() {
    if (state.busy) return;
    const input = document.getElementById('adminDataFiles');
    const source = document.getElementById('adminDataSource')?.value || '';
    const files = Array.from(input?.files || []);
    if (!files.length) {
      context().toast('กรุณาเลือกไฟล์ KML/KMZ อย่างน้อย 1 ไฟล์', 'error');
      return;
    }
    const button = document.getElementById('adminDataUpload');
    const progressRoot = document.getElementById('adminDataProgress');
    state.busy = true;
    button.disabled = true;
    progressRoot.replaceChildren();
    let successCount = 0;
    for (const file of files) {
      const progress = progressRow(file);
      progressRoot.appendChild(progress.row);
      try {
        await uploadFile(file, source, progress);
        successCount += 1;
      } catch (_) {
        // Each row already presents a precise recoverable error.
      }
    }
    state.busy = false;
    button.disabled = false;
    input.value = '';
    if (successCount) {
      context().toast(`นำเข้า Staging สำเร็จ ${successCount.toLocaleString('th-TH')} ไฟล์`, 'success');
      await loadDatasets();
    }
  }

  function buildView() {
    const root = el('div', 'admin-data');
    const notice = el('div', 'admin-data-notice');
    notice.append(
      el('strong', '', 'อัปเดตแบบปลอดภัยด้วย Versioning'),
      el('p', '', 'ไฟล์ที่อัปโหลดจะเข้า Staging ก่อน ข้อมูลที่ใช้งานอยู่จะไม่เปลี่ยนจนกว่าจะกดเผยแพร่')
    );

    const form = el('section', 'admin-data-upload');
    const sourceField = el('label');
    sourceField.append(el('span', '', 'ชุดข้อมูล'));
    const source = document.createElement('select');
    source.id = 'adminDataSource';
    source.innerHTML = '<option value="pea">PEA</option><option value="ufm">UFM</option>';
    sourceField.appendChild(source);
    const fileField = el('label', 'admin-data-file');
    fileField.append(el('span', '', 'ไฟล์ KML/KMZ — เลือกได้หลายไฟล์'));
    const input = document.createElement('input');
    input.id = 'adminDataFiles';
    input.type = 'file';
    input.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
    input.multiple = true;
    fileField.appendChild(input);
    const upload = el('button', 'data-upload-button', 'นำเข้า Staging');
    upload.id = 'adminDataUpload';
    upload.type = 'button';
    upload.addEventListener('click', () => startUpload().catch(error => context().toast(error.message, 'error')));
    form.append(sourceField, fileField, upload);

    const progress = el('div', 'admin-data-progress');
    progress.id = 'adminDataProgress';
    const heading = el('div', 'admin-data-section-title');
    heading.append(el('div', '', 'ประวัติและเวอร์ชันข้อมูล'));
    const refresh = el('button', '', 'รีเฟรช');
    refresh.type = 'button';
    refresh.addEventListener('click', () => loadDatasets().catch(error => context().toast(error.message, 'error')));
    heading.appendChild(refresh);
    const list = el('div', 'admin-data-list');
    list.id = 'adminDataList';
    root.append(notice, form, progress, heading, list);
    return root;
  }

  async function openAdminData() {
    const auth = context();
    if (!auth?.client || auth.getCurrentProfile()?.role !== 'admin') {
      auth?.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error');
      return;
    }
    auth.openModal('จัดการข้อมูล PEA / UFM', 'อัปโหลด ตรวจสอบ เปรียบเทียบ เผยแพร่ และย้อนกลับเวอร์ชัน', buildView(), true);
    const modal = document.querySelector('.app-modal');
    modal?.classList.add('app-modal-data');
    await loadDatasets().catch(error => {
      const root = document.getElementById('adminDataList');
      if (root) root.innerHTML = `<div class="admin-data-empty"><strong>เปิดระบบจัดการข้อมูลไม่ได้</strong><p>${auth.escapeHtml(error.message)}</p></div>`;
    });
  }

  window.permissionOutOpenAdminData = openAdminData;
})();
