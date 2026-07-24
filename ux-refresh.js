(function () {
  'use strict';

  if (document.body.classList.contains('ux-enhanced')) return;

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const body = document.body;
  const shellbar = q('.app-shellbar');
  const container = q('.container');
  const layout = q('.layout');
  const leftCol = q('.leftCol');
  const rightCol = q('.rightCol');
  const setupCard = q('#threshold')?.closest('.card');
  const billingCard = q('#rateB')?.closest('.card');
  const mapCard = q('#map')?.closest('.card');
  const results = q('#results');
  const reportCard = q('#reportCard');
  const reportTable = q('table.report');
  const reportBody = q('#reportBody');
  const mobileMedia = window.matchMedia('(max-width: 767px)');

  if (!container || !layout || !leftCol || !rightCol || !setupCard || !billingCard || !mapCard || !reportCard) return;

  body.classList.add('ux-enhanced');
  body.dataset.mobileStage = 'setup';
  shellbar?.setAttribute('role', 'banner');
  container.id = 'mainContent';
  container.setAttribute('role', 'main');
  container.tabIndex = -1;
  leftCol.setAttribute('aria-label', 'ตั้งค่าการวิเคราะห์และค่าบริการ');
  rightCol.setAttribute('aria-label', 'พื้นที่ตรวจสอบผลลัพธ์');
  setupCard.id = 'setupCard';
  billingCard.id = 'billingCard';
  mapCard.id = 'mapCard';

  const skipLink = document.createElement('a');
  skipLink.className = 'skip-link';
  skipLink.href = '#mainContent';
  skipLink.textContent = 'ข้ามไปยังเนื้อหาหลัก';
  body.prepend(skipLink);

  const pageTitle = document.createElement('h1');
  pageTitle.className = 'sr-only';
  pageTitle.textContent = 'Permission Out — วิเคราะห์และประเมินค่าบริการเส้นทาง';
  container.prepend(pageTitle);

  function replaceHeadingCopy(heading, copy) {
    if (!heading) return;
    const textNode = Array.from(heading.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
    if (textNode) textNode.nodeValue = ` ${copy} `;
    heading.setAttribute('aria-label', copy);
  }

  const setupHeading = q('.card-title', setupCard);
  const billingHeading = q('.card-title', billingCard);
  const mapHeading = q('.card-title', mapCard);
  const reportHeading = q('.card-title', reportCard);
  q('.step', setupHeading).textContent = '1';
  q('.step', mapHeading).textContent = '3';
  q('.step', reportHeading).textContent = '3';
  q('.step', billingHeading).textContent = '4';
  replaceHeadingCopy(setupHeading, 'เลือกชุดข้อมูลและตั้งค่าการเปรียบเทียบ');
  replaceHeadingCopy(mapHeading, 'ตรวจสอบเส้นทางบนแผนที่');
  replaceHeadingCopy(reportHeading, 'ตรวจสอบผลการเปรียบเทียบ');
  replaceHeadingCopy(billingHeading, 'ค่าบริการและส่งออกข้อมูล');

  const billingHeader = billingHeading?.parentElement;
  const billingExportButtons = ['exportCsvBtn', 'exportKmlBtn', 'exportKmzBtn']
    .map(id => q(`#${id}`))
    .filter(Boolean);
  const billingCostList = q('.costList', billingCard);
  const billingTotalBanner = q('.totalBanner', billingCard);
  if (billingHeader && billingCostList && billingTotalBanner && billingExportButtons.length) {
    billingHeader.classList.add('billing-card-header');
    const billingIntro = document.createElement('p');
    billingIntro.className = 'billing-card-intro';
    billingIntro.textContent = 'ตรวจสอบอัตราและรายการคำนวณ ก่อนดาวน์โหลดผลลัพธ์ตามตัวกรองปัจจุบัน';
    billingHeading.after(billingIntro);

    const calculationLabel = document.createElement('div');
    calculationLabel.className = 'billing-section-label';
    calculationLabel.innerHTML = '<strong>รายละเอียดการคำนวณ</strong><span>ยอดเงินปรับอัตโนมัติเมื่อแก้ไขอัตรา</span>';
    billingCostList.before(calculationLabel);

    const costRows = qa('.costRow', billingCostList);
    costRows[0]?.classList.add('billing-rate-row');
    q('#rowCostNew')?.classList.add('billing-status-row', 'is-new');
    q('#rowCostSame')?.classList.add('billing-status-row', 'is-same');
    q('#rowCostRemove')?.classList.add('billing-status-row', 'is-remove');
    for (const row of [q('#rowCostNew'), q('#rowCostSame'), q('#rowCostRemove')]) {
      const label = q('.costRow-label', row);
      const leadingText = Array.from(label?.childNodes || []).find(node => node.nodeType === Node.TEXT_NODE);
      if (leadingText) leadingText.nodeValue = leadingText.nodeValue.replace(/^\s*•\s*/, '');
    }
    costRows[4]?.classList.add('billing-subtotal-row');
    costRows[5]?.classList.add('billing-surcharge-row');
    costRows[6]?.classList.add('billing-legacy-total');

    const exportPanel = document.createElement('section');
    exportPanel.className = 'billing-export-panel';
    exportPanel.setAttribute('aria-labelledby', 'billingExportTitle');
    exportPanel.innerHTML = `
      <div class="billing-export-copy">
        <strong id="billingExportTitle">ส่งออกข้อมูล</strong>
        <span>ส่งออกเฉพาะรายการที่ผ่านตัวกรองในหน้ารายงาน</span>
      </div>
      <div class="billing-export-actions"></div>`;
    const exportActions = q('.billing-export-actions', exportPanel);
    billingExportButtons.forEach(button => exportActions.appendChild(button));
    billingTotalBanner.after(exportPanel);
  }

  const summaryTitle = q('.execSummary-title');
  if (summaryTitle) summaryTitle.textContent = 'สรุปผลการวิเคราะห์';

  const setupIntro = document.createElement('p');
  setupIntro.className = 'setup-intro';
  setupIntro.textContent = 'กำหนดชุดฐานและชุดเปรียบเทียบ จากนั้นตรวจสอบการตั้งค่าก่อนเริ่มวิเคราะห์';
  setupHeading.after(setupIntro);

  const labelMap = [
    ['threshold', 'ระยะที่ถือว่าทับกัน (เมตร)'],
    ['interval', 'ความละเอียดในการวิเคราะห์ (เมตร)'],
    ['polesPerKm', 'จำนวนเสาโดยประมาณต่อกิโลเมตร']
  ];
  for (const [id, copy] of labelMap) {
    const input = document.getElementById(id);
    const field = input?.closest('.field');
    const label = q('label', field);
    if (input && label) {
      label.htmlFor = id;
      label.textContent = copy;
    }
  }
  q('#rateB')?.setAttribute('aria-label', 'อัตราค่าบริการบาทต่อเส้นต่อมิลลิเมตรต่อต้น');
  q('#surchargePct')?.setAttribute('aria-label', 'ส่วนเพิ่มค่าบริการร้อยละ');
  q('#map')?.setAttribute('role', 'region');
  q('#map')?.setAttribute('aria-label', 'แผนที่เส้นทางและพื้นที่ PEA');
  q('#loading')?.setAttribute('role', 'status');
  q('#loading')?.setAttribute('aria-live', 'polite');
  q('#errBox')?.setAttribute('role', 'alert');
  q('#costStatus')?.setAttribute('aria-live', 'polite');
  q('.toast-stack')?.setAttribute('aria-live', 'polite');

  const analyzeButton = q('#analyzeBtn');
  const clearButton = q('#clearBtn');
  if (analyzeButton) {
    analyzeButton.type = 'button';
    analyzeButton.textContent = '2  วิเคราะห์เส้นทาง';
  }
  if (clearButton) clearButton.textContent = 'เริ่มใหม่';

  const workflow = document.createElement('nav');
  workflow.className = 'workflow-nav';
  workflow.setAttribute('aria-label', 'ขั้นตอนการทำงาน');
  workflow.innerHTML = [
    ['datasets', '1', 'เลือกข้อมูล'],
    ['analyze', '2', 'วิเคราะห์'],
    ['results', '3', 'ตรวจสอบผล'],
    ['billing', '4', 'ค่าบริการ']
  ].map(([key, index, label]) =>
    `<button type="button" class="workflow-step${key === 'datasets' ? ' is-current' : ''}" data-workflow="${key}"${key === 'results' || key === 'billing' ? ' disabled' : ''}><span class="workflow-step-index">${index}</span><span class="workflow-step-label">${label}</span></button>`
  ).join('');
  container.insertBefore(workflow, layout);

  const sourceSwitch = q('.source-role-switch', setupCard);
  const dataGrid = q('.grid2', setupCard);
  const selectionSummary = document.createElement('div');
  selectionSummary.className = 'dataset-selection-summary';
  selectionSummary.innerHTML = `
    <div class="dataset-summary-row">
      <span class="dataset-summary-role" id="uxBaseRole">ชุดฐาน</span>
      <span class="dataset-summary-copy" id="uxBaseSummary">ยังไม่ได้เลือกชุดข้อมูล</span>
      <span class="dataset-summary-count" id="uxBaseCount">0</span>
    </div>
    <div class="dataset-summary-row">
      <span class="dataset-summary-role" id="uxCompareRole">ชุดเปรียบเทียบ</span>
      <span class="dataset-summary-copy" id="uxCompareSummary">ยังไม่ได้เลือกชุดข้อมูล</span>
      <span class="dataset-summary-count" id="uxCompareCount">0</span>
    </div>
    <button type="button" class="dataset-open-button" id="openDatasetPicker">
      <span aria-hidden="true">＋</span> เลือกหรือเปลี่ยนชุดข้อมูล
    </button>`;
  sourceSwitch.before(selectionSummary);

  const drawerBackdrop = document.createElement('div');
  drawerBackdrop.className = 'dataset-drawer-backdrop';
  drawerBackdrop.id = 'datasetDrawerBackdrop';
  drawerBackdrop.innerHTML = `
    <section class="dataset-drawer" role="dialog" aria-modal="true" aria-labelledby="datasetDrawerTitle">
      <header class="dataset-drawer-header">
        <div>
          <h2 id="datasetDrawerTitle">เลือกชุดข้อมูล</h2>
          <p>เลือกได้หลายรายการ ใช้ช่องค้นหาเพื่อจำกัดผลลัพธ์ก่อนเลือกทั้งหมด</p>
        </div>
        <button type="button" class="dataset-drawer-close" aria-label="ปิดตัวเลือกชุดข้อมูล">×</button>
      </header>
      <div class="dataset-drawer-body" id="datasetDrawerBody"></div>
      <footer class="dataset-drawer-footer">
        <span id="datasetDrawerStatus">ยังไม่ได้เลือกชุดข้อมูล</span>
        <button type="button" class="dataset-drawer-done">เสร็จสิ้น</button>
      </footer>
    </section>`;
  body.appendChild(drawerBackdrop);
  q('#datasetDrawerBody', drawerBackdrop).appendChild(dataGrid);

  q('#baseCatalogSearch')?.setAttribute('placeholder', 'ค้นหาชุดข้อมูล PEA…');
  q('#compareCatalogSearch')?.setAttribute('placeholder', 'ค้นหาชุดข้อมูล UFM…');
  if (q('#baseCatalogSelectAll')) q('#baseCatalogSelectAll').textContent = 'เลือกผลค้นหา';
  if (q('#compareCatalogSelectAll')) q('#compareCatalogSelectAll').textContent = 'เลือกผลค้นหา';
  if (q('#baseCatalogClear')) q('#baseCatalogClear').textContent = 'ล้างทั้งหมด';
  if (q('#compareCatalogClear')) q('#compareCatalogClear').textContent = 'ล้างทั้งหมด';

  let drawerReturnFocus = null;
  const drawer = q('.dataset-drawer', drawerBackdrop);
  function drawerFocusable() {
    return qa('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])', drawer)
      .filter(element => !element.hidden && element.getClientRects().length);
  }
  function openDatasetDrawer() {
    drawerReturnFocus = document.activeElement;
    drawerBackdrop.classList.add('is-open');
    body.classList.add('dataset-drawer-open');
    q('.dataset-drawer-close', drawerBackdrop).focus();
  }
  function closeDatasetDrawer() {
    drawerBackdrop.classList.remove('is-open');
    body.classList.remove('dataset-drawer-open');
    drawerReturnFocus?.focus?.();
  }
  q('#openDatasetPicker')?.addEventListener('click', openDatasetDrawer);
  q('.dataset-drawer-close', drawerBackdrop)?.addEventListener('click', closeDatasetDrawer);
  q('.dataset-drawer-done', drawerBackdrop)?.addEventListener('click', closeDatasetDrawer);
  drawerBackdrop.addEventListener('mousedown', event => {
    if (event.target === drawerBackdrop) closeDatasetDrawer();
  });
  drawerBackdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDatasetDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = drawerFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const actionRow = analyzeButton?.closest('.row');
  const advanced = document.createElement('details');
  advanced.className = 'advanced-settings';
  advanced.id = 'advancedSettings';
  advanced.innerHTML = `<summary><span>ตั้งค่าขั้นสูง</span><span class="advanced-settings-copy">ค่าเริ่มต้นเหมาะกับงานทั่วไป</span></summary><div class="advanced-settings-grid"></div>`;
  const advancedGrid = q('.advanced-settings-grid', advanced);
  for (const id of ['threshold', 'interval', 'polesPerKm', 'dedupeToggle']) {
    const field = q(`#${id}`)?.closest('.field');
    if (field) advancedGrid.appendChild(field);
  }
  actionRow?.before(advanced);
  actionRow?.classList.add('analysis-actions');

  const readiness = document.createElement('div');
  readiness.className = 'analysis-readiness';
  readiness.id = 'analysisReadiness';
  readiness.setAttribute('role', 'status');
  readiness.setAttribute('aria-live', 'polite');
  readiness.innerHTML = '<span class="analysis-readiness-dot"></span><span id="analysisReadinessText">เลือกชุดข้อมูลอย่างน้อยหนึ่งฝั่งเพื่อเริ่มวิเคราะห์</span>';
  advanced.before(readiness);

  function sourceRoleLabel(source) {
    return source?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }
  function updateSelectionSummary() {
    const baseCount = Number.parseInt(q('#baseCatalogCount')?.textContent || '0', 10) || 0;
    const compareCount = Number.parseInt(q('#compareCatalogCount')?.textContent || '0', 10) || 0;
    const baseStatus = q('#baseCatalogStatus')?.textContent?.trim() || 'ยังไม่ได้เลือกชุดข้อมูล';
    const compareStatus = q('#compareCatalogStatus')?.textContent?.trim() || 'ยังไม่ได้เลือกชุดข้อมูล';
    q('#uxBaseCount').textContent = baseCount.toLocaleString('th-TH');
    q('#uxCompareCount').textContent = compareCount.toLocaleString('th-TH');
    q('#uxBaseSummary').textContent = baseStatus;
    q('#uxCompareSummary').textContent = compareStatus;
    q('#uxBaseRole').textContent = sourceRoleLabel(q('#baseRoleSummary')) || 'ชุดฐาน';
    q('#uxCompareRole').textContent = sourceRoleLabel(q('#compareRoleSummary')) || 'ชุดเปรียบเทียบ';
    q('#datasetDrawerStatus').textContent = `เลือกแล้ว ${baseCount + compareCount} ชุดข้อมูล`;
    const isReady = baseCount + compareCount > 0;
    readiness.classList.toggle('is-ready', isReady);
    q('#analysisReadinessText').textContent = isReady
      ? `พร้อมวิเคราะห์ — ชุดฐาน ${baseCount} รายการ · ชุดเปรียบเทียบ ${compareCount} รายการ`
      : 'เลือกชุดข้อมูลอย่างน้อยหนึ่งฝั่งเพื่อเริ่มวิเคราะห์';
    q('[data-workflow="datasets"]')?.classList.toggle('is-complete', isReady);
    q('[data-workflow="analyze"]')?.classList.toggle('is-current', isReady && !body.classList.contains('has-analysis'));
  }
  const summaryObserver = new MutationObserver(updateSelectionSummary);
  for (const element of [q('#baseCatalogStatus'), q('#compareCatalogStatus'), q('#baseCatalogCount'), q('#compareCatalogCount'), q('#baseRoleSummary'), q('#compareRoleSummary')]) {
    if (element) summaryObserver.observe(element, { childList: true, subtree: true, characterData: true });
  }
  dataGrid.addEventListener('change', updateSelectionSummary);
  updateSelectionSummary();

  const tabs = document.createElement('div');
  tabs.className = 'workspace-view-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'มุมมองผลการวิเคราะห์');
  tabs.innerHTML = `
    <button type="button" class="workspace-view-tab" id="mapViewTab" role="tab" aria-controls="mapCard" aria-selected="true">แผนที่</button>
    <button type="button" class="workspace-view-tab" id="reportViewTab" role="tab" aria-controls="reportCard" aria-selected="false" disabled>ตารางผลลัพธ์</button>`;
  rightCol.prepend(tabs);
  rightCol.appendChild(reportCard);
  rightCol.dataset.workspaceView = 'map';

  function setCurrentWorkflow(key) {
    qa('.workflow-step').forEach(button => button.classList.toggle('is-current', button.dataset.workflow === key));
  }

  function setWorkspaceView(view, focus = false) {
    if (view === 'report' && !body.classList.contains('has-analysis')) return;
    rightCol.dataset.workspaceView = view;
    body.classList.toggle('report-focus', view === 'report' && !mobileMedia.matches);
    const mapTab = q('#mapViewTab');
    const reportTab = q('#reportViewTab');
    mapTab.setAttribute('aria-selected', String(view === 'map'));
    reportTab.setAttribute('aria-selected', String(view === 'report'));
    if (body.classList.contains('has-analysis')) setCurrentWorkflow('results');
    if (focus) (view === 'map' ? mapTab : reportTab).focus();
    if (view === 'map') {
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 20);
    }
  }
  q('#mapViewTab').addEventListener('click', () => setWorkspaceView('map'));
  q('#reportViewTab').addEventListener('click', () => setWorkspaceView('report'));

  const reportWrap = q('.reportWrap', reportCard);
  const reportCommandbar = document.createElement('div');
  reportCommandbar.className = 'report-commandbar';
  const filterTools = document.createElement('details');
  filterTools.className = 'report-tools report-filter-tools';
  filterTools.innerHTML = '<summary>ตัวกรอง <span id="activeFilterCount">ค่าเริ่มต้น</span></summary><div class="report-tools-panel" id="reportFilterPanel"></div>';
  const filterPanel = q('#reportFilterPanel', filterTools);
  for (const child of Array.from(reportCard.children)) {
    if (child !== reportHeading && child !== reportWrap) filterPanel.appendChild(child);
  }

  const columnTools = document.createElement('details');
  columnTools.className = 'report-tools column-tools';
  columnTools.innerHTML = `
    <summary>คอลัมน์</summary>
    <div class="report-tools-panel column-chooser-list">
      <label><input type="checkbox" data-column="10"> พิกัดต้นทาง</label>
      <label><input type="checkbox" data-column="11"> พิกัดปลายทาง</label>
    </div>`;
  reportCommandbar.append(filterTools, columnTools);
  reportHeading.after(reportCommandbar);

  if (reportTable) {
    reportTable.classList.add('hide-col-10', 'hide-col-11');
    if (!q('caption', reportTable)) {
      const caption = document.createElement('caption');
      caption.className = 'sr-only';
      caption.textContent = 'รายละเอียดผลการเปรียบเทียบเส้นทางและค่าบริการ';
      reportTable.prepend(caption);
    }
  }
  qa('[data-column]', columnTools).forEach(input => {
    input.addEventListener('change', () => {
      reportTable?.classList.toggle(`hide-col-${input.dataset.column}`, !input.checked);
    });
  });

  function updateFilterCount() {
    const filters = qa('input[type="checkbox"]', filterPanel);
    const changed = filters.filter(input => !input.checked).length;
    q('#activeFilterCount').textContent = changed ? `${changed} รายการ` : 'ค่าเริ่มต้น';
  }
  filterPanel.addEventListener('change', updateFilterCount);
  updateFilterCount();

  function enhanceReportRows() {
    const headers = qa('thead th', reportTable).map(header => header.textContent.replace(/\s+/g, ' ').trim());
    qa('tr.reportRow', reportBody).forEach(row => {
      row.tabIndex = 0;
      row.setAttribute('aria-label', `เปิดตำแหน่งบนแผนที่: ${q('td', row)?.textContent?.trim() || 'เส้นทาง'}`);
      qa('td', row).forEach((cell, index) => {
        cell.dataset.label = headers[index] || `ข้อมูล ${index + 1}`;
      });
    });
  }
  const rowObserver = new MutationObserver(enhanceReportRows);
  if (reportBody) {
    rowObserver.observe(reportBody, { childList: true });
    reportBody.addEventListener('keydown', event => {
      const row = event.target.closest('tr.reportRow');
      if (!row || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      row.click();
    });
    reportBody.addEventListener('click', event => {
      if (event.target.closest('input')) return;
      window.setTimeout(() => setWorkspaceView('map'), 0);
    });
  }
  enhanceReportRows();

  function setMobileStage(stage) {
    body.dataset.mobileStage = stage;
    setCurrentWorkflow(stage === 'setup' ? 'datasets' : stage);
    if (stage === 'results') setWorkspaceView('map');
  }

  qa('.workflow-step').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.workflow;
      if (key === 'datasets') {
        if (!mobileMedia.matches) setWorkspaceView('map');
        setCurrentWorkflow('datasets');
        setMobileStage('setup');
        openDatasetDrawer();
      } else if (key === 'analyze') {
        if (!mobileMedia.matches) setWorkspaceView('map');
        setMobileStage('setup');
        setCurrentWorkflow('analyze');
        analyzeButton?.focus();
        analyzeButton?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (key === 'results') {
        setMobileStage('results');
        rightCol.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (key === 'billing') {
        if (!mobileMedia.matches) setWorkspaceView('map');
        setCurrentWorkflow('billing');
        setMobileStage('billing');
        billingCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  });

  function setAnalyzing(active) {
    if (!analyzeButton) return;
    analyzeButton.setAttribute('aria-busy', String(active));
    analyzeButton.disabled = active;
    analyzeButton.textContent = active ? 'กำลังวิเคราะห์ข้อมูล…' : '2  วิเคราะห์เส้นทาง';
  }
  analyzeButton?.addEventListener('click', () => setAnalyzing(true));

  function markAnalysisComplete() {
    setAnalyzing(false);
    body.classList.add('has-analysis');
    q('#reportViewTab').disabled = false;
    for (const key of ['results', 'billing']) {
      const button = q(`[data-workflow="${key}"]`);
      button.disabled = false;
      button.classList.add('is-complete');
    }
    q('[data-workflow="analyze"]')?.classList.add('is-complete');
    if (mobileMedia.matches) setMobileStage('results');
    else {
      setCurrentWorkflow('results');
      setWorkspaceView('map');
    }
  }
  window.addEventListener('permissionout:analysis-complete', markAnalysisComplete);
  window.addEventListener('permissionout:cleared', () => {
    setAnalyzing(false);
    body.classList.remove('has-analysis');
    q('#reportViewTab').disabled = true;
    for (const key of ['results', 'billing']) {
      const button = q(`[data-workflow="${key}"]`);
      button.disabled = true;
      button.classList.remove('is-complete', 'is-current');
    }
    q('[data-workflow="analyze"]')?.classList.remove('is-complete');
    setWorkspaceView('map');
    setMobileStage('setup');
  });
  const errorObserver = new MutationObserver(() => {
    const errorBox = q('#errBox');
    if (errorBox && errorBox.textContent.trim()) setAnalyzing(false);
  });
  if (q('#errBox')) errorObserver.observe(q('#errBox'), { childList: true, subtree: true, characterData: true });

  let modalReturnFocus = null;
  const modalRoot = q('#appBackdrop') || q('.app-backdrop');
  if (modalRoot) {
    const modalObserver = new MutationObserver(() => {
      const isOpen = modalRoot.classList.contains('is-open');
      if (isOpen && !modalRoot.dataset.focusManaged) {
        modalReturnFocus = document.activeElement;
        modalRoot.dataset.focusManaged = 'true';
      } else if (!isOpen && modalRoot.dataset.focusManaged) {
        delete modalRoot.dataset.focusManaged;
        modalReturnFocus?.focus?.();
      }
    });
    modalObserver.observe(modalRoot, { attributes: true, attributeFilter: ['class'] });
    modalRoot.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !modalRoot.classList.contains('is-open')) return;
      const focusable = qa('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])', modalRoot)
        .filter(element => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  mobileMedia.addEventListener?.('change', event => {
    if (!event.matches) {
      body.dataset.mobileStage = 'setup';
      setWorkspaceView(rightCol.dataset.workspaceView || 'map');
    } else {
      setMobileStage(body.classList.contains('has-analysis') ? 'results' : 'setup');
    }
  });

  document.documentElement.classList.add('ux-ready');
})();
