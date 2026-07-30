import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = ['Permission_Out.html', 'production.css', 'production.js', 'admin-users.css', 'admin-users.js', 'admin-data.css', 'admin-data.js', 'ux-refresh.css', 'ux-refresh.js', 'mod2.html', 'mod2.css', 'mod2.js', 'login.html', 'login.css', 'login.js', 'src/worker.js', 'supabase/schema.sql', 'supabase/migrations/20260722190000_uih_postgis.sql', 'supabase/migrations/20260723100000_billing_engine.sql', 'supabase/migrations/20260723110000_billing_existing_poles.sql', 'supabase/migrations/20260723130000_user_administration.sql', 'supabase/migrations/20260723150000_dataset_versioning.sql', 'supabase/migrations/20260724120000_mod2_site_facility.sql', 'supabase/migrations/20260726120000_private_mod1_access.sql', 'supabase/migrations/20260730160000_osm_reference_data.sql', 'supabase/migrations/20260730180000_managed_reference_datasets.sql', 'wrangler.toml', 'scripts/prepare-uih-data.mjs', 'scripts/prepare-uih-optimized.mjs', 'scripts/upload-uih-data.mjs', 'scripts/import-uih-postgis.mjs', 'scripts/import-osm-reference.mjs', 'scripts/import-mod2-sites.mjs', 'scripts/prepare-ufm-data.mjs', 'scripts/upload-ufm-data.mjs'];
await Promise.all(required.map(file => access(resolve(root, file))));
const html = await readFile(resolve(root, 'Permission_Out.html'), 'utf8');
const production = await readFile(resolve(root, 'production.js'), 'utf8');
const adminUsers = await readFile(resolve(root, 'admin-users.js'), 'utf8');
const adminData = await readFile(resolve(root, 'admin-data.js'), 'utf8');
const uxRefresh = await readFile(resolve(root, 'ux-refresh.js'), 'utf8');
const uxRefreshCss = await readFile(resolve(root, 'ux-refresh.css'), 'utf8');
const mod2Html = await readFile(resolve(root, 'mod2.html'), 'utf8');
const mod2Js = await readFile(resolve(root, 'mod2.js'), 'utf8');
const loginHtml = await readFile(resolve(root, 'login.html'), 'utf8');
const loginJs = await readFile(resolve(root, 'login.js'), 'utf8');
const workerSource = await readFile(resolve(root, 'src/worker.js'), 'utf8');
const privateAccessMigration = await readFile(resolve(root, 'supabase/migrations/20260726120000_private_mod1_access.sql'), 'utf8');
const osmReferenceMigration = await readFile(resolve(root, 'supabase/migrations/20260730160000_osm_reference_data.sql'), 'utf8');
const managedReferenceMigration = await readFile(resolve(root, 'supabase/migrations/20260730180000_managed_reference_datasets.sql'), 'utf8');
const uploadScripts = await Promise.all([
  'scripts/upload-pea-data.mjs',
  'scripts/upload-uih-data.mjs',
  'scripts/upload-ufm-data.mjs'
].map(file => readFile(resolve(root, file), 'utf8')));
for (const id of ['peaDatasetStatus', 'ufmDatasetStatus', 'accountBtn', 'analyzeBtn', 'swapSourceRoles', 'reportBody', 'map', 'peaLayerTrigger', 'peaLayerList', 'baseCatalogSearch', 'baseCatalogList', 'compareCatalogSearch', 'compareCatalogList', 'dedupeToggle']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required element: ${id}`);
}
if (!html.includes("permissionout:analysis-complete")) throw new Error('Analysis lifecycle event is missing');
if (!html.includes('function segmentDiameterValue(seg)') || !html.includes('billingForSegment(seg, rateB, polesPerKm)')) {
  throw new Error('Shared UI/export billing logic is missing');
}
if (!html.includes('function existingPoleCountForSegment(seg)')) throw new Error('Provided-pole billing fallback is missing');
for (const marker of ['class="categoryFilter" value="network"', 'class="categoryFilter" value="ready-access"', 'class="categoryFilter" value="customer"', 'type="checkbox" name="reportOverlapMode"', 'value="limit-two"', 'function getReportOverlapModes(', 'function limitSelfOverlapCopies(', 'function normalizeImportCategory(', 'function detectImportCategory(', 'function parseKML(text, sourceName', "line.importCategory || 'network'", 'function getActiveCategories()', 'window.permissionOutCompareFiles', 'renderer: aggregateRenderer']) {
  if (!html.includes(marker)) throw new Error(`MOD 1 import/report filter marker is missing: ${marker}`);
}
if (!production.includes('importCategory') || !production.includes('reportCategories: Array.from') || !production.includes('item?.category') || !production.includes('Array.isArray(line.c) ? line.c : line.coords')) {
  throw new Error('Optimized MOD 1 data or saved projects do not preserve report category filters');
}
if (!uxRefresh.includes('window.permissionOutBaseFiles') || !uxRefresh.includes('window.permissionOutCompareFiles')) {
  throw new Error('MOD 1 workflow readiness must include locally imported files');
}
for (const marker of ['dataset-drawer-overview', 'pickerBaseCount', 'pickerCompareCount', 'drawerSwapDatasets', 'นำเข้าไฟล์เป็นฐาน']) {
  if (!uxRefresh.includes(marker)) throw new Error(`Complete MOD 1 dataset picker UX marker is missing: ${marker}`);
}
for (const marker of ['CATALOG_RENDER_PAGE_SIZE', 'baseCatalogIndex', 'compareCatalogIndex', 'catalog-load-more']) {
  if (!`${production}\n${uxRefresh}`.includes(marker)) throw new Error(`Smooth MOD 1 dataset catalog marker is missing: ${marker}`);
}
for (const marker of ['id="osmRoadToggle"', 'id="osmBuildingToggle"', 'id="osmReferenceStatus"']) {
  if (!html.includes(marker)) throw new Error(`OSM reference control is missing: ${marker}`);
}
for (const marker of ['id="trimPreviewBtn"', 'id="trimApplyBtn"', 'id="trimUndoBtn"', 'id="trimRoadBuffer"', 'id="trimMinLength"']) {
  if (html.includes(marker)) throw new Error(`Removed MOD 1 Trim control is still visible: ${marker}`);
}
for (const marker of ['/api/data/reference', 'managedReferenceFeatures(', "supabase.rpc('managed_reference_features'"]) {
  if (!`${production}\n${workerSource}`.includes(marker)) throw new Error(`OSM reference runtime marker is missing: ${marker}`);
}
for (const marker of ["value=\"road\"", "value=\"building\"", 'buildingFeaturesFromKml(', "source === 'building'"]) {
  if (!adminData.includes(marker)) throw new Error(`Managed Road/Building upload marker is missing: ${marker}`);
}
for (const marker of ["source in ('pea', 'ufm', 'road', 'building')", 'create or replace function public.managed_reference_features']) {
  if (!managedReferenceMigration.includes(marker)) throw new Error(`Managed reference migration marker is missing: ${marker}`);
}
for (const marker of ['create table if not exists public.osm_roads', 'create table if not exists public.osm_buildings', 'create or replace function public.osm_reference_features', '© OpenStreetMap contributors']) {
  if (!osmReferenceMigration.includes(marker)) throw new Error(`OSM reference migration marker is missing: ${marker}`);
}
for (const marker of ['value="overlap-only"', 'function overlapOnlyReportModeEnabled()', "seg.status === 'same').map(seg => ({ ...seg, overlapType: 'full' }))", 'reportOverlapModeLabel()', "reportOverlapModes.has('overlap-only')"]) {
  if (!html.includes(marker)) throw new Error(`MOD 1 overlap-only report/export marker is missing: ${marker}`);
}
if (html.includes('if (overlapOnlyReportModeEnabled()) return selectedSegmentsForExport();')) {
  throw new Error('KML/KMZ export must include all selected source data, not only overlap-only result segments');
}
if (!uxRefreshCss.includes('flex:1 1 100%') || !uxRefreshCss.includes('flex-direction:column') || !uxRefreshCss.includes('padding:6px 9px') || !uxRefreshCss.includes('.report-overlap-options small{display:none}') || !html.includes('ux-refresh.css?v=20260730-multi-report-filter')) {
  throw new Error('MOD 1 overlap-only report option must be visible in the report layout');
}
for (const marker of ['DATASET_LINE_COLORS', 'MAXI_CATEGORY_META', "network: Object.freeze({ label: 'Network', color: '#1E5BA8' })", "'ready-access': Object.freeze({ label: 'Ready Access', color: '#0E9F6E' })", "customer: Object.freeze({ label: 'Customer', color: '#B7791F' })", 'applyDatasetLineColors(', 'maxiCategoryColor(line, colorByKey.get(key))', 'datasetColorLegend', 'sourceColor: line.sourceColor', "dashArray: isRemove ? '2,7'"]) {
  if (!html.includes(marker)) throw new Error(`Distinct MOD 1 dataset line color marker is missing: ${marker}`);
}
for (const marker of ['mapSourceLines', 'function renderSourceColorOverlay(', 'uniqueSources.size <= 1', 'interactive: false']) {
  if (!html.includes(marker)) throw new Error(`MOD 1 multi-source map color overlay marker is missing: ${marker}`);
}
if (!html.includes('const matchingSourceLines = (state.mapSourceLines || []).filter(') || !html.includes('renderSourceColorOverlay(matchingSourceLines);')) {
  throw new Error('MOD 1 result filters must update source lines displayed on the map');
}
for (const marker of ['lineInfoPopup(sourceFileColumnValue(line), line, lengthMeters)', 'const lengthMeters = Number(line.length) || lineLengthMeters(line.coords);']) {
  if (!html.includes(marker)) throw new Error(`MOD 1 source-color map overlay popup marker is missing: ${marker}`);
}
if (!html.includes('costFiltered') || !html.includes('เส้นที่ตรงกับตัวกรองในการ์ด 4')) {
  throw new Error('Card-4-filtered billing is missing');
}
const csvSection = html.slice(html.indexOf('function exportCSV()'), html.indexOf('function selectedSegmentsForExport()'));
if (csvSection.includes('document.querySelector(`.diamInput')) {
  throw new Error('CSV export must not depend on rendered report rows');
}
if (!csvSection.includes('ผลต่างระหว่างหน้าเว็บกับ Export')) throw new Error('CSV reconciliation row is missing');
if (!csvSection.includes('PEA Area IDs') || !csvSection.includes('ensurePeaAreasForExportMode(exportSegments)') || !html.includes('function exportIncludesPeaDetails()') || !html.includes('id="exportDetailMode"')) throw new Error('CSV PEA area export mode is missing');
if (!csvSection.includes('Imported source lines included in this export') || !csvSection.includes('selectedSourceLinesForKmlExport()') || !csvSection.includes('sourceOverlapGroups.get(line)') || !csvSection.includes("'ทับกัน' : 'ไม่ทับกัน'") || !csvSection.includes('Source dataset ID') || !csvSection.includes('Included in billing') || !csvSection.includes('Matched with') || !csvSection.includes('Overlap count') || !csvSection.includes('Overlap marker')) {
  throw new Error('CSV export must include the complete imported source-line audit section');
}
if (!html.includes('function sourceLineMatchedWith(') || !html.includes('function sourceLineBillingNote(') || !html.includes('function sourceLineOverlapMatches(') || !csvSection.includes('=== Export Summary ===')) {
  throw new Error('CSV export must include summary, matched routes, and billing inclusion audit fields');
}
if (!html.includes('function rd03MaxiMatchRows(') || !csvSection.includes('rd03 to Maxi match detail') || !csvSection.includes('Maxi count for rd03') || !csvSection.includes('Maxi source file')) {
  throw new Error('CSV export must include complete rd03-to-Maxi match detail rows');
}
if (!html.includes('function sourceFileColumnValue(line)') || !html.includes('`${groupLabel} | ${fileName}`') || !csvSection.includes('sourceFileColumnValue(seg)')) {
  throw new Error('CSV export must show each route source file clearly in one column');
}
if (!csvSection.includes("'รหัส Placemark', 'ชื่อ Placemark'") || !csvSection.includes('placemarkCode(seg)') || !csvSection.includes('placemarkName(seg)')) {
  throw new Error('CSV export must separate Placemark code and name columns');
}
if (csvSection.includes("placemarkCode(seg) || '-'")) {
  throw new Error('CSV export must leave missing Placemark codes blank');
}
for (const marker of ['function buildExportOverlapGroups(', "'กลุ่มเส้นทับกัน'", '`ทับกัน ${groupIndex + 1}`', 'exportOverlapGroups.get(seg)']) {
  if (!html.includes(marker)) throw new Error(`MOD 1 same-road-side export grouping marker is missing: ${marker}`);
}
if (!html.includes('function getCachedExportOverlapGroups(') || !html.includes('exportOverlapGroupCache.clear()') || !html.includes('getCachedExportOverlapGroups(state.mapSourceLines, threshold, interval)')) {
  throw new Error('MOD 1 export overlap grouping must be cached after analysis');
}
if (!html.includes('name="overlap_group"') || !html.includes('same_road_side_group_count')) {
  throw new Error('KML/KMZ same-road-side export grouping is missing');
}
if (!html.includes('function selectedSourceLinesForKmlExport()') || !html.includes('const segments = selectedSourceLinesForKmlExport();') || !html.includes('const activeOverlaps = getActiveOverlaps();') || !html.includes('sourceOverlapGroups.has(line) ? includeOverlapping : activeOverlaps.none')) {
  throw new Error('KML/KMZ export must include all selected MOD 1 source datasets');
}
if (!html.includes('function kmlColorFromCss(') || !html.includes('function kmlSourceStyleId(') || !html.includes('<Data name="source_layer">') || !html.includes('<Folder><name>${xmlEscape(source.name)}</name><open>1</open><visibility>1</visibility>')) {
  throw new Error('KML/KMZ export must separate selected source datasets into selectable colored folders');
}
if (!html.includes('function kmlExportLayerKey(') || !html.includes("name.includes('maxi')") || !html.includes('function kmlMaxiStatusColor(') || !html.includes('<Data name="kml_layer">')) {
  throw new Error('KML/KMZ export must split Maxi layers and colors by source status');
}
if (!html.includes('function kmlTopFolderName(') || !html.includes('function kmlExportStyleId(') || !html.includes('<visibility>1</visibility>') || !html.includes('source.categories.values()') || !html.includes('return maxiCategoryColor(reference, fallbackColor)')) {
  throw new Error('KML/KMZ export must use selectable parent source folders and KML-safe hex colors');
}
if (!html.includes('function kmlCategoryFolderKey(') || !html.includes('function kmlCategoryFolderName(') || !html.includes("network: 'Network'") || !html.includes("'ready-access': 'Ready Access'") || !html.includes("customer: 'Customer'")) {
  throw new Error('KML/KMZ export must let Maxi data be selected by Network, Ready Access, and Customer folders');
}
if (!html.includes('function kmlMaxiReference(') || !html.includes('kmlMaxiReferenceCache.has(cacheKey)') || !html.includes('function kmlFolderReference(') || !html.includes('kmlSegmentNearLineRatio(segment, line, threshold, interval, samples)') || !html.includes('kmlMaxiSpatialEntries()') || !html.includes('kmlBoundsCanOverlap(segmentBounds, entry.bounds, threshold)') || !html.includes('maxi_reference_category') || !html.includes('normalizeImportCategory(reference.importCategory)')) {
  throw new Error('KML/KMZ export must derive overlap-only category folders from overlapping Maxi data');
}
if (!html.includes('function kmlExportMeta(segment)') || !html.includes('const exportMetaRows = segments.map(kmlExportMeta)') || !html.includes("compression: 'STORE'") || !html.includes('compressionOptions: { level: 3 }')) {
  throw new Error('KML/KMZ export must precompute per-line metadata and use fast KMZ compression mode');
}
if (!html.includes('geoJsonPolygonToKml') || !html.includes('<Folder><name>PEA Areas</name>')) throw new Error('KML/KMZ PEA polygon export is missing');
if (!html.includes('name="kmlPopupField"') || !html.includes('function kmlPopupDescription(') || !html.includes('selectedKmlPopupFields()')) {
  throw new Error('KML/KMZ selectable Popup fields are missing');
}
if (!html.includes('id="kmlProvinceFolders"') || !html.includes('function renderKmlLayerPlacemarks(') || !html.includes('function kmlProvinceFolderName(') || !html.includes('function renderKmlSourceContent(') || !html.includes('function renderKmlSourceFolder(')) {
  throw new Error('KML/KMZ province Folder option is missing');
}
if (!html.includes('id="kmlExportDialog"') || !html.includes('function requestKmlExportOptions(') || !html.includes('dialog.showModal()')) {
  throw new Error('KML/KMZ pre-export options dialog is missing');
}
for (const marker of ['id="exportStatus"', 'function confirmExport(', 'function runExport(', 'exportInProgress', 'result.itemCount', 'formatExportBytes(result.size)']) {
  if (!html.includes(marker)) throw new Error(`MOD 1 export progress or confirmation UX marker is missing: ${marker}`);
}
if (!html.includes("window.permissionOutLoadGroupLines('BASE')") || !html.includes("window.permissionOutLoadGroupLines('COMPARE')") || !html.includes('applyProvinceFilter(true)')) {
  throw new Error('Logical PEA/UFM dataset grouping or province map focus is missing');
}
if (!html.includes('function getSegProvinces(seg)') || !html.includes('function provinceFilterSourceSegments()') || !html.includes('provinceSources.flatMap(getSegProvinces)') || !html.includes('segmentProvinces.some(province => selectedProvinces.includes(province))')) {
  throw new Error('MOD 1 province filtering must include provinces from result segments and selected rd03/Maxi source data');
}
if (!html.includes("[...state.segmentsB, ...(state.mapSourceLines || [])].map(getSegCableStatus)")) {
  throw new Error('MOD 1 cable status filter must include source-line statuses');
}
if (!html.includes('function filterMod1ComparisonPair(lines, groupKey)') || !html.includes("name.includes('rd03')") || !html.includes("name.includes('maxi')") || !html.includes('const selectedComparisonLines = [...linesA, ...linesB]') || !html.includes("linesB = filterMod1ComparisonPair(selectedComparisonLines, 'COMPARE')")) {
  throw new Error('MOD 1 comparison must be limited to rd03 base routes and Maxi compare routes');
}
for (const marker of ['peaCompareCatalogSelected', 'ufmBaseCatalogSelected', 'baseCatalogSelectCompare', 'compareCatalogSelectBase']) {
  if (!`${html}\n${production}`.includes(marker)) throw new Error(`Dual-source MOD 1 role selection is missing: ${marker}`);
}
if (!production.includes('payload: await fetchBaseAnalysis(item)') || !production.includes('payload: await fetchCompareAnalysis(item)')) {
  throw new Error('MOD 1 multi-dataset export must keep each loaded payload paired with its selected dataset');
}
if (!html.includes('<th>Status จากไฟล์</th>') || !html.includes('source_measured') || !production.includes('propertiesWithDescriptionFields') || !production.includes('function routeIdentifier(properties)')) throw new Error('UFM source metadata or Placemark identifier resolution is missing');
if (!production.includes('permissionOutResolvePeaAreas') || !production.includes('/api/data/billing-formula')) throw new Error('PEA spatial resolver or protected billing formula loader is missing');
if (production.includes('/storage/v1/object/public/permission-out-data') || !production.includes('/api/data/assets/')) {
  throw new Error('MOD 1 business assets must be loaded through the authenticated Worker API');
}
for (const marker of ["'permission-out-data'", 'set public = false', 'permission_out_can', "public.permission_out_can('mod1', 'view')"]) {
  if (!privateAccessMigration.includes(marker)) throw new Error(`Private MOD 1 migration marker is missing: ${marker}`);
}
if (uploadScripts.some(source => source.includes('public: true') || source.includes('/object/public/'))) {
  throw new Error('MOD 1 upload scripts must preserve private Storage');
}
if (!html.includes('<script src="bootstrap.js"></script>')) throw new Error('Runtime bootstrap script is missing');
if (!html.includes('ux-refresh.css') || !html.includes('ux-refresh.js')) throw new Error('UX refresh assets are missing');
if (!html.includes('admin-users.css') || !html.includes('admin-users.js')) throw new Error('Admin user assets are missing');
if (!html.includes('admin-data.css') || !html.includes('admin-data.js')) throw new Error('Admin data assets are missing');
if (!html.includes('href="/mod2/"') || !mod2Html.includes('href="/"')) throw new Error('Module navigation is missing');
for (const marker of ['id="mod2Map"', 'id="mapSiteSearch"', 'id="clearMapSearch"', 'id="filterProvince"', 'id="mapFocusToggle"', 'id="mapFilterBar"', 'id="mapEmptyState"', 'id="exportBtn"', '/api/mod2/sites']) {
  if (!mod2Html.includes(marker) && !mod2Js.includes(marker)) throw new Error(`MOD 2 marker is missing: ${marker}`);
}
for (const marker of ['sidebar-overview', 'sidebar-metric-primary', 'sidebar-metric-grid', 'Network Overview', 'id="metricSites"', 'id="metricCustomers"', 'id="metricNodes"', 'id="metricOwners"']) {
  if (!mod2Html.includes(marker)) throw new Error(`MOD 2 sidebar overview marker is missing: ${marker}`);
}
for (const marker of ['id="sidebarToggle"', 'id="mod2Sidebar"', 'function setSidebarCollapsed(', 'function restoreSidebarState()', 'permission-out:mod2-sidebar-collapsed', 'map.invalidateSize']) {
  if (!`${mod2Html}\n${mod2Js}`.includes(marker)) throw new Error(`Collapsible MOD 2 sidebar marker is missing: ${marker}`);
}
for (const marker of ['id="mapLegendToggle"', 'id="mapLegendPanel"', 'id="mapLegendItems"', 'function setLegendExpanded(', 'function restoreLegendState()', 'permission-out:mod2-legend-expanded']) {
  if (!`${mod2Html}\n${mod2Js}`.includes(marker)) throw new Error(`Collapsible MOD 2 legend marker is missing: ${marker}`);
}
for (const marker of ['id="mapOutputToggle"', 'id="mapOutputPanel"', 'function setOutputMenuExpanded(', 'class="map-mode-switch"', 'class="map-navigation-actions"']) {
  if (!`${mod2Html}\n${mod2Js}`.includes(marker)) throw new Error(`Streamlined MOD 2 toolbar marker is missing: ${marker}`);
}
if (mod2Html.includes('id="siteSearch"') || mod2Html.includes('class="map-toolbar-copy"')) {
  throw new Error('MOD 2 toolbar still contains duplicate search or heading UI');
}
if (mod2Html.includes('class="metric-grid"')) throw new Error('Legacy MOD 2 metric card row must not remain in the map workspace');
for (const marker of ['function bindLazySitePopup(', 'window.requestAnimationFrame(() =>', 'map.flyToBounds(', 'function updateActiveFilters(', 'resetAllFilters({']) {
  if (!mod2Js.includes(marker)) throw new Error(`Smooth MOD 2 map UX marker is missing: ${marker}`);
}
for (const marker of ['let mapAutoFocusFrame = 0', 'function scheduleFilteredMapFocus()', 'state.filtered.length === 1']) {
  if (!mod2Js.includes(marker)) throw new Error(`MOD 2 automatic filter focus marker is missing: ${marker}`);
}
for (const marker of ['FILTER_CASCADE_ORDER', 'const upstreamSelections = {}', 'const candidateSites = state.sites.filter', 'const availableValues = uniqueValues(key, candidateSites)', 'applyFilters(true);']) {
  if (!mod2Js.includes(marker)) throw new Error(`MOD 2 cascading filter marker is missing: ${marker}`);
}
for (const marker of ['id="opexReportBtn"', 'function openOpexReport()', 'function renderOpexReport(', 'data-opex-monthly', 'data-opex-yearly', "const exportSites = isAdmin() ? state.sites : state.filtered"]) {
  if (!`${mod2Html}\n${mod2Js}`.includes(marker)) throw new Error(`MOD 2 OPEX or permission-aware export marker is missing: ${marker}`);
}
for (const marker of ["name: 'customers'", "name: 'opex'", 'site-edit-section', 'payload.customers = Number(payload.customers)']) {
  if (!mod2Js.includes(marker)) throw new Error(`Complete MOD 2 site editor marker is missing: ${marker}`);
}
if (!workerSource.includes("if (access.role !== 'admin')") || !workerSource.includes("if (key.toLocaleLowerCase('en-US') === 'opex')")) {
  throw new Error('MOD 2 API must redact OPEX for non-admin users');
}
if (!workerSource.includes('customers,') || !workerSource.includes("...(access.role === 'admin' ? { opex } : {})")) {
  throw new Error('MOD 2 site editor API must persist customers and admin-only OPEX');
}
if (!mod2Js.includes('function syncSiteSearch(') || !mod2Js.includes('handleSiteSearchKeydown')) {
  throw new Error('MOD 2 map/sidebar search synchronization is missing');
}
if (!mod2Js.includes("cache: 'no-store'") || !mod2Js.includes('commentRefreshTimer')) {
  throw new Error('MOD 2 comments must refresh across active users without cache');
}
if (!workerSource.includes(".order('created_at', { ascending: false })") || !workerSource.includes("comments: [...(result.data || [])].reverse()")) {
  throw new Error('MOD 2 comments API must return the newest comments in chronological order');
}
if (!workerSource.includes('async function adminMod2Comment') || !workerSource.includes("commentItemMatch && request.method === 'PATCH'") || !workerSource.includes("commentItemMatch && request.method === 'DELETE'")) {
  throw new Error('MOD 2 admin comment update/delete API is missing');
}
if (!mod2Js.includes('function canManageMod2Comments()') || !mod2Js.includes("data-action=\"edit\"") || !mod2Js.includes("`/api/mod2/comments/${item.id}`")) {
  throw new Error('MOD 2 admin comment controls are missing');
}
for (const marker of ['sourceProperties', 'extraPopupProperties', 'facility-popup-metrics', 'facility-popup-extra', 'facility-popup-grid', 'facility-popup-group', 'data-copy-value', 'Location & Area', 'Network & Ownership', 'Operations', 'Additional Information']) {
  if (!mod2Js.includes(marker)) throw new Error(`MOD 2 extensible popup marker is missing: ${marker}`);
}
if (!workerSource.includes("requireModuleAccess(request, env, 'mod2', 'update')")) {
  throw new Error('MOD 2 comment management must use MOD 2 update permission');
}
if (!loginJs.includes('storage: window.sessionStorage')) {
  throw new Error('Authentication must use browser-session storage');
}
if (!production.includes("new URL('/login/'") || !mod2Js.includes("new URL('/login/'")) {
  throw new Error('All modules must use the central login route');
}
if (production.includes('authErrorMessage(') || mod2Js.includes('authErrorMessage(')) {
  throw new Error('Module-specific authentication UI helpers must not remain after centralization');
}
if (!loginHtml.includes('id="loginForm"') || !loginHtml.includes('id="recoveryForm"') || !loginJs.includes('signInWithPassword') || !loginJs.includes('resetPasswordForEmail') || !loginJs.includes('safeReturnTo')) {
  throw new Error('Central login or password recovery flow is incomplete');
}
if (loginJs.includes('client.auth.signUp(') || !production.includes('loadCurrentProfile') || !mod2Js.includes('loadSites')) {
  throw new Error('Managed login flow is missing or public signup is enabled');
}
for (const marker of ['permissionOutOpenAdminUsers', '/api/admin/users', 'admin-user-form', 'isActive']) {
  if (!adminUsers.includes(marker)) throw new Error(`Admin user marker is missing: ${marker}`);
}
for (const marker of ['permissionOutOpenAdminData', '/api/admin/data/uploads', 'uploadToSignedUrl', 'logical_id']) {
  if (!adminData.includes(marker)) throw new Error(`Admin data marker is missing: ${marker}`);
}
for (const marker of ['workflow-nav', 'dataset-drawer', 'workspace-view-tabs', 'advanced-settings', 'has-analysis']) {
  if (!uxRefresh.includes(marker)) throw new Error(`UX refresh marker is missing: ${marker}`);
}
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
for (const source of [...inlineScripts, production, adminUsers, adminData, uxRefresh, mod2Js, loginJs]) new Function(source);
console.log('Validation passed');
