import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = ['Permission_Out.html', 'production.css', 'production.js', 'src/worker.js', 'supabase/schema.sql', 'supabase/migrations/20260722190000_uih_postgis.sql', 'supabase/migrations/20260723100000_billing_engine.sql', 'supabase/migrations/20260723110000_billing_existing_poles.sql', 'wrangler.toml', 'scripts/prepare-uih-data.mjs', 'scripts/prepare-uih-optimized.mjs', 'scripts/upload-uih-data.mjs', 'scripts/import-uih-postgis.mjs', 'scripts/prepare-ufm-data.mjs', 'scripts/upload-ufm-data.mjs'];
await Promise.all(required.map(file => access(resolve(root, file))));
const html = await readFile(resolve(root, 'Permission_Out.html'), 'utf8');
const production = await readFile(resolve(root, 'production.js'), 'utf8');
for (const id of ['projectTitle', 'saveProjectBtn', 'analyzeBtn', 'swapSourceRoles', 'reportBody', 'map', 'peaLayerTrigger', 'peaLayerList', 'baseCatalogSearch', 'baseCatalogList', 'compareCatalogSearch', 'compareCatalogList']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required element: ${id}`);
}
if (!html.includes("permissionout:analysis-complete")) throw new Error('Analysis lifecycle event is missing');
if (!html.includes('function segmentDiameterValue(seg)') || !html.includes('billingForSegment(seg, rateB, polesPerKm)')) {
  throw new Error('Shared UI/export billing logic is missing');
}
if (!html.includes('function existingPoleCountForSegment(seg)')) throw new Error('Provided-pole billing fallback is missing');
const csvSection = html.slice(html.indexOf('function exportCSV()'), html.indexOf('function selectedSegmentsForExport()'));
if (csvSection.includes('document.querySelector(`.diamInput')) {
  throw new Error('CSV export must not depend on rendered report rows');
}
if (!csvSection.includes('ผลต่างระหว่างหน้าเว็บกับ Export')) throw new Error('CSV reconciliation row is missing');
if (!csvSection.includes('PEA Area IDs') || !csvSection.includes('ensurePeaAreasForExport(exportSegments)')) throw new Error('CSV PEA area export is missing');
if (!html.includes('geoJsonPolygonToKml') || !html.includes('<Folder><name>PEA Areas</name>')) throw new Error('KML/KMZ PEA polygon export is missing');
if (!html.includes('sourceRolesAreSwapped() ? ufmLines : peaLines') || !html.includes('applyProvinceFilter(true)')) throw new Error('Source-role swap or province map focus is missing');
if (!html.includes('<th>Status จากไฟล์</th>') || !html.includes('source_measured') || !production.includes('propertiesWithDescriptionFields') || !production.includes('function routeIdentifier(properties)')) throw new Error('UFM source metadata or Placemark identifier resolution is missing');
if (!production.includes('permissionOutResolvePeaAreas') || !production.includes("client.rpc('get_active_billing_formula'")) throw new Error('PEA spatial resolver or central billing formula loader is missing');
if (!html.includes('<script src="bootstrap.js"></script>')) throw new Error('Runtime bootstrap script is missing');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
for (const source of inlineScripts) new Function(source);
console.log('Validation passed');
