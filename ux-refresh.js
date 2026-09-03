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
  q('.step', mapHeading).textContent = '2';
  q('.step', reportHeading).textContent = '2';
  q('.step', billingHeading).textContent = '3';
  replaceHeadingCopy(setupHeading, 'เลือกข้อมูลสำหรับวิเคราะห์');
  replaceHeadingCopy(mapHeading, 'ตรวจสอบเส้นทางบนแผนที่');
  replaceHeadingCopy(reportHeading, 'ตรวจสอบผลการเปรียบเทียบ');
  replaceHeadingCopy(billingHeading, 'ค่าบริการและส่งออกข้อมูล');

  const billingHeader = billingHeading?.parentElement;
  const billingExportButtons = ['exportCsvBtn', 'exportKmlBtn', 'exportKmzBtn']
    .map(id => q(`#${id}`))
    .filter(Boolean);
  const exportModeControl = q('#exportModeControl');
  const exportModeHint = q('#exportModeHint');
  const exportStatus = q('#exportStatus');
  const billingCostList = q('.costList', billingCard);
  const billingTotalBanner = q('.totalBanner', billingCard);
  if (billingHeader && billingCostList && billingTotalBanner && billingExportButtons.length) {
    billingHeader.classList.add('billing-card-header');
    const calculationDetails = document.createElement('details');
    calculationDetails.className = 'billing-calculation-details';
    calculationDetails.innerHTML = '<summary><span>รายละเอียดสูตรและอัตราค่าบริการ</span><small>ยอดเงินปรับอัตโนมัติเมื่อแก้ไขอัตรา</small></summary><div class="billing-calculation-body"></div>';
    q('.billing-calculation-body', calculationDetails).appendChild(billingCostList);
    billingTotalBanner.before(calculationDetails);

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

    const exportPanel = document.createElement('details');
    exportPanel.className = 'billing-export-panel billing-export-menu';
    exportPanel.setAttribute('aria-labelledby', 'billingExportTitle');
    exportPanel.innerHTML = `
      <summary><strong id="billingExportTitle">ส่งออกข้อมูล</strong><span>CSV, KML หรือ KMZ</span></summary>
      <div class="billing-export-menu-body"><div class="billing-export-copy"><span>ส่งออกเฉพาะรายการที่ผ่านตัวกรองในหน้ารายงาน</span></div><div class="billing-export-settings"></div><div class="billing-export-actions"></div></div>`;
    const exportSettings = q('.billing-export-settings', exportPanel);
    const exportActions = q('.billing-export-actions', exportPanel);
    if (exportModeControl) exportSettings.appendChild(exportModeControl);
    if (exportModeHint) exportSettings.appendChild(exportModeHint);
    if (exportStatus) exportSettings.appendChild(exportStatus);
    billingExportButtons.forEach(button => exportActions.appendChild(button));
    billingTotalBanner.after(exportPanel);
  }

  const summaryTitle = q('.execSummary-title');
  if (summaryTitle) summaryTitle.textContent = 'สรุปผลการวิเคราะห์';

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
    ['results', '2', 'แผนที่และรายงาน'],
    ['billing', '3', 'ค่าบริการและส่งออก']
  ].map(([key, index, label]) =>
    `<button type="button" class="workflow-step${key === 'datasets' ? ' is-current' : ''}" data-workflow="${key}"${key === 'results' || key === 'billing' ? ' disabled' : ''}><span class="workflow-step-index">${index}</span><span class="workflow-step-label">${label}</span></button>`
  ).join('');
  container.insertBefore(workflow, layout);

  const sourceSwitch = q('.source-role-switch', setupCard);
  const dataGrid = q('.grid2', setupCard);
  const quickLoader = q('.quick-area-loader', setupCard);
  const externalCalculator = q('.external-calc', setupCard);
  const selectionSummary = document.createElement('details');
  selectionSummary.className = 'dataset-selection-summary';
  selectionSummary.open = true;
  selectionSummary.innerHTML = `
    <summary class="dataset-selection-toggle"><span>เลือกหรือเปลี่ยนชุดข้อมูล</span></summary>
    <div class="dataset-selection-content">
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
        <span aria-hidden="true">＋</span> เปิดตัวเลือกชุดข้อมูล
      </button>
    </div>`;
  sourceSwitch.before(selectionSummary);

  const sourceModeTabs = document.createElement('div');
  sourceModeTabs.className = 'source-mode-tabs';
  sourceModeTabs.setAttribute('role', 'tablist');
  sourceModeTabs.setAttribute('aria-label', 'วิธีเลือกข้อมูล');
  sourceModeTabs.innerHTML = `
    <button type="button" role="tab" data-source-mode="database" aria-selected="true">จากฐานข้อมูล</button>
    <button type="button" role="tab" data-source-mode="catalog" aria-selected="false">เลือกจากคลัง / เปรียบเทียบ</button>
    <button type="button" role="tab" data-source-mode="file" aria-selected="false">จากไฟล์</button>`;
  setupHeading.after(sourceModeTabs);
  if (quickLoader) quickLoader.dataset.sourcePanel = 'database';
  selectionSummary.dataset.sourcePanel = 'catalog';
  if (sourceSwitch) sourceSwitch.dataset.sourcePanel = 'catalog';
  if (externalCalculator) externalCalculator.dataset.sourcePanel = 'file';
  function setSourceMode(mode) {
    qa('[data-source-mode]', sourceModeTabs).forEach(button => button.setAttribute('aria-selected', String(button.dataset.sourceMode === mode)));
    qa('[data-source-panel]', setupCard).forEach(panel => { panel.hidden = panel.dataset.sourcePanel !== mode; });
    if (actionRow) actionRow.hidden = mode !== 'catalog';
    if (readiness) readiness.hidden = mode !== 'catalog';
  }
  sourceModeTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-source-mode]');
    if (button) setSourceMode(button.dataset.sourceMode);
  });

  const drawerBackdrop = document.createElement('div');
  drawerBackdrop.className = 'dataset-drawer-backdrop';
  drawerBackdrop.id = 'datasetDrawerBackdrop';
  drawerBackdrop.innerHTML = `
    <section class="dataset-drawer" role="dialog" aria-modal="true" aria-labelledby="datasetDrawerTitle">
      <header class="dataset-drawer-header">
        <div>
          <h2 id="datasetDrawerTitle">เลือกชุดข้อมูล</h2>
          <p>กำหนด PEA และ UFM ให้เป็นชุดฐานหรือชุดเปรียบเทียบได้อย่างอิสระ</p>
        </div>
        <button type="button" class="dataset-drawer-close" aria-label="ปิดตัวเลือกชุดข้อมูล">×</button>
      </header>
      <div class="dataset-drawer-overview">
        <div class="dataset-picker-destinations">
          <article class="dataset-picker-destination is-base">
            <span>ชุดฐาน</span>
            <strong id="pickerBaseCount">0 รายการ</strong>
            <small id="pickerBasePreview">ยังไม่ได้เลือกข้อมูล</small>
          </article>
          <article class="dataset-picker-destination is-compare">
            <span>ชุดเปรียบเทียบ</span>
            <strong id="pickerCompareCount">0 รายการ</strong>
            <small id="pickerComparePreview">ยังไม่ได้เลือกข้อมูล</small>
          </article>
        </div>
        <div class="dataset-picker-actions" id="datasetPickerActions">
          <button type="button" id="drawerSwapDatasets">⇄ สลับรายการจากคลัง</button>
        </div>
      </div>
      <div class="dataset-drawer-body" id="datasetDrawerBody"></div>
      <footer class="dataset-drawer-footer">
        <span id="datasetDrawerStatus">ยังไม่ได้เลือกชุดข้อมูล</span>
        <button type="button" class="dataset-drawer-done">เสร็จสิ้น</button>
      </footer>
    </section>`;
  body.appendChild(drawerBackdrop);
  q('#datasetDrawerBody', drawerBackdrop).appendChild(dataGrid);
  const pickerGuide = document.createElement('div');
  pickerGuide.className = 'dataset-picker-guide';
  pickerGuide.innerHTML = '<span><i class="is-base"></i>ฐานสำหรับวิเคราะห์</span><span><i class="is-compare"></i>ชุดที่นำมาเปรียบเทียบ</span><small>เลือกบทบาทได้จากปุ่มด้านขวาของแต่ละรายการ</small>';
  q('#datasetDrawerBody', drawerBackdrop).prepend(pickerGuide);

  q('#baseCatalogSearch')?.setAttribute('placeholder', 'ค้นหาชุดข้อมูล PEA…');
  q('#compareCatalogSearch')?.setAttribute('placeholder', 'ค้นหาชุดข้อมูล UFM…');
  if (q('#baseCatalogSelectAll')) q('#baseCatalogSelectAll').textContent = 'เลือกเป็นฐาน';
  if (q('#compareCatalogSelectAll')) q('#compareCatalogSelectAll').textContent = 'เลือกเป็นเปรียบเทียบ';
  if (q('#baseCatalogClear')) q('#baseCatalogClear').textContent = 'ล้างทั้งหมด';
  if (q('#compareCatalogClear')) q('#compareCatalogClear').textContent = 'ล้างทั้งหมด';
  const pickerActions = q('#datasetPickerActions', drawerBackdrop);
  const baseImportButton = q('.local-file-trigger[data-file-input="fileBase"]');
  const compareImportButton = q('.local-file-trigger[data-file-input="fileCompare"]');
  if (baseImportButton) {
    baseImportButton.textContent = '＋ นำเข้าไฟล์เป็นฐาน';
    baseImportButton.title = 'นำเข้า KML/KMZ เข้าชุดฐาน';
    pickerActions?.prepend(baseImportButton);
  }
  if (compareImportButton) {
    compareImportButton.textContent = '＋ นำเข้าไฟล์เป็นเปรียบเทียบ';
    compareImportButton.title = 'นำเข้า KML/KMZ เข้าชุดเปรียบเทียบ';
    baseImportButton?.after(compareImportButton);
  }
  q('#drawerSwapDatasets', drawerBackdrop)?.addEventListener('click', () => q('#swapSourceRoles')?.click());

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
    window.requestAnimationFrame(() => q('#baseCatalogSearch')?.focus());
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
  for (const id of ['threshold', 'interval', 'polesPerKm']) {
    const field = q(`#${id}`)?.closest('.field');
    if (field) advancedGrid.appendChild(field);
  }
  const reportModeField = q('.report-overlap-field');
  if (reportModeField) advancedGrid.appendChild(reportModeField);
  actionRow?.before(advanced);
  actionRow?.classList.add('analysis-actions');

  const readiness = document.createElement('div');
  readiness.className = 'analysis-readiness';
  readiness.id = 'analysisReadiness';
  readiness.setAttribute('role', 'status');
  readiness.setAttribute('aria-live', 'polite');
  readiness.innerHTML = '<span class="analysis-readiness-dot"></span><span id="analysisReadinessText">เลือกชุดข้อมูลอย่างน้อยหนึ่งฝั่งเพื่อเริ่มวิเคราะห์</span>';
  advanced.before(readiness);
  setSourceMode('database');

  function updateSelectionSummary() {
    const baseDatasetCount = Array.isArray(window.permissionOutBaseDatasetIds)
      ? window.permissionOutBaseDatasetIds.length
      : 0;
    const compareDatasetCount = Array.isArray(window.permissionOutCompareDatasetIds)
      ? window.permissionOutCompareDatasetIds.length
      : 0;
    const baseFileCount = Array.isArray(window.permissionOutBaseFiles)
      ? window.permissionOutBaseFiles.length
      : (q('#fileBase')?.files?.length || 0);
    const compareFileCount = Array.isArray(window.permissionOutCompareFiles)
      ? window.permissionOutCompareFiles.length
      : (q('#fileCompare')?.files?.length || 0);
    const baseCount = baseDatasetCount + baseFileCount;
    const compareCount = compareDatasetCount + compareFileCount;
    const sourceSummary = (names, fileCount) => {
      const selectedNames = Array.isArray(names) ? names : [];
      const total = selectedNames.length + fileCount;
      if (!total) return 'ยังไม่ได้เลือกชุดข้อมูล';
      const preview = selectedNames.slice(0, 2).join(' · ');
      return `${total.toLocaleString('th-TH')} รายการ${preview ? ` · ${preview}${selectedNames.length > 2 ? '…' : ''}` : ' · ไฟล์นำเข้า'}`;
    };
    const baseStatus = sourceSummary(window.permissionOutBaseDatasetNames, baseFileCount);
    const compareStatus = sourceSummary(window.permissionOutCompareDatasetNames, compareFileCount);
    q('#uxBaseCount').textContent = baseCount.toLocaleString('th-TH');
    q('#uxCompareCount').textContent = compareCount.toLocaleString('th-TH');
    q('#uxBaseSummary').textContent = baseStatus;
    q('#uxCompareSummary').textContent = compareStatus;
    q('#uxBaseRole').textContent = 'ชุดฐาน';
    q('#uxCompareRole').textContent = 'ชุดเปรียบเทียบ';
    const isComparable = baseCount > 0 && compareCount > 0;
    q('#datasetDrawerStatus').textContent = isComparable
      ? `พร้อมเปรียบเทียบ · ฐาน ${baseCount} · เปรียบเทียบ ${compareCount}`
      : `เลือกแล้ว ${baseCount + compareCount} รายการ · แสดงข้อมูลฝั่งเดียวได้`;
    q('#pickerBaseCount').textContent = `${baseCount.toLocaleString('th-TH')} รายการ`;
    q('#pickerCompareCount').textContent = `${compareCount.toLocaleString('th-TH')} รายการ`;
    q('#pickerBasePreview').textContent = baseStatus;
    q('#pickerComparePreview').textContent = compareStatus;
    const isReady = baseCount + compareCount > 0;
    readiness.classList.toggle('is-ready', isReady);
    readiness.classList.toggle('is-comparable', isComparable);
    q('#analysisReadinessText').textContent = isReady
      ? isComparable
        ? `พร้อมเปรียบเทียบ — ชุดฐาน ${baseCount} รายการ · ชุดเปรียบเทียบ ${compareCount} รายการ`
        : `พร้อมแสดงข้อมูลฝั่งเดียว — เลือกอีกฝั่งเมื่อต้องการเปรียบเทียบ`
      : 'เลือกชุดข้อมูลอย่างน้อยหนึ่งฝั่งเพื่อเริ่มวิเคราะห์';
    q('[data-workflow="datasets"]')?.classList.toggle('is-complete', isReady);
    q('[data-workflow="datasets"]')?.classList.toggle('is-current', !body.classList.contains('has-analysis'));
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

  const mapTools = q('.map-title-tools', mapCard);
  const peaLayerControl = q('#peaLayerControl', mapCard);
  const osmReferenceControl = q('.osm-reference-control', mapCard);
  if (mapTools && peaLayerControl && osmReferenceControl) {
    const layerMenu = document.createElement('details');
    layerMenu.className = 'map-layer-menu';
    layerMenu.innerHTML = '<summary><span aria-hidden="true">▱</span><strong>ชั้นข้อมูล</strong><small>PEA · ถนน · อาคาร</small></summary><div class="map-layer-menu-panel"></div>';
    const layerPanel = q('.map-layer-menu-panel', layerMenu);
    layerPanel.append(peaLayerControl, osmReferenceControl);
    mapTools.prepend(layerMenu);
  }

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
  const resetFilters = document.createElement('button');
  resetFilters.type = 'button';
  resetFilters.className = 'report-reset-filters';
  resetFilters.textContent = 'ล้างตัวกรอง';
  resetFilters.addEventListener('click', () => {
    qa('input[type="checkbox"]', filterPanel).forEach(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    const province = q('#provinceFilter');
    if (province && !province.disabled) { province.value = ''; province.dispatchEvent(new Event('change', { bubbles: true })); }
    const office = q('#peaOfficeFilter');
    if (office && !office.disabled) { office.value = ''; office.dispatchEvent(new Event('change', { bubbles: true })); }
    updateFilterCount();
  });
  reportCommandbar.append(filterTools, columnTools, resetFilters);
  reportHeading.after(reportCommandbar);

  if (reportTable) {
    reportTable.classList.add('hide-col-5', 'hide-col-6', 'hide-col-7', 'hide-col-9', 'hide-col-10', 'hide-col-11');
    if (!q('caption', reportTable)) {
      const caption = document.createElement('caption');
      caption.className = 'sr-only';
      caption.textContent = 'รายละเอียดผลการเปรียบเทียบเส้นทางและค่าบริการ';
      reportTable.prepend(caption);
    }
  }
  q('.column-chooser-list', columnTools).innerHTML = `
    <label><input type="checkbox" data-column="5"> Type / Core</label>
    <label><input type="checkbox" data-column="6"> Status จากไฟล์</label>
    <label><input type="checkbox" data-column="7"> Diameter</label>
    <label><input type="checkbox" data-column="9"> จำนวนเสา</label>
    <label><input type="checkbox" data-column="10"> พิกัดต้นทาง</label>
    <label><input type="checkbox" data-column="11"> พิกัดปลายทาง</label>`;
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

  const compactSummary = document.createElement('section');
  compactSummary.className = 'compact-result-summary';
  compactSummary.setAttribute('aria-label', 'สรุปผลล่าสุด');
  compactSummary.innerHTML = `
    <div><small>ช่วงเส้นทาง</small><strong id="compactSegmentCount">—</strong></div>
    <div><small>ระยะฐาน</small><strong id="compactDistance">— กม.</strong></div>
    <div><small>จำนวนเสา</small><strong id="compactPoles">—</strong></div>
    <div class="is-total"><small>ค่าบริการรวม</small><strong id="compactCost">— บาท</strong></div>`;
  rightCol.insertBefore(compactSummary, mapCard);
  function updateCompactSummary() {
    const segmentCount = Number(compactSummary.dataset.segmentCount || q('#reportBody')?.children.length || 0);
    q('#compactSegmentCount').textContent = segmentCount.toLocaleString('th-TH');
    q('#compactDistance').textContent = `${q('#statTotalA')?.textContent || '—'} กม.`;
    q('#compactPoles').textContent = q('#statTotalPoles')?.textContent || '—';
    q('#compactCost').textContent = `${q('#costTotalBig')?.textContent || '—'} บาท`;
  }
  const compactObserver = new MutationObserver(updateCompactSummary);
  for (const node of [q('#statTotalA'), q('#statTotalPoles'), q('#costTotalBig'), reportBody]) {
    if (node) compactObserver.observe(node, { childList: true, subtree: true, characterData: true });
  }
  updateCompactSummary();

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

  function markAnalysisComplete(event) {
    setAnalyzing(false);
    body.classList.add('has-analysis');
    if (Number.isFinite(event?.detail?.segmentCount)) compactSummary.dataset.segmentCount = String(event.detail.segmentCount);
    updateCompactSummary();
    q('#reportViewTab').disabled = false;
    for (const key of ['results', 'billing']) {
      const button = q(`[data-workflow="${key}"]`);
      button.disabled = false;
      button.classList.add('is-complete');
    }
    q('[data-workflow="datasets"]')?.classList.add('is-complete');
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
    delete compactSummary.dataset.segmentCount;
    updateCompactSummary();
    q('#reportViewTab').disabled = true;
    for (const key of ['results', 'billing']) {
      const button = q(`[data-workflow="${key}"]`);
      button.disabled = true;
      button.classList.remove('is-complete', 'is-current');
    }
    q('[data-workflow="datasets"]')?.classList.remove('is-complete');
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
