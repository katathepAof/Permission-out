import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../Permission_Out.html', import.meta.url), 'utf8');
function extract(name) {
 const start=html.indexOf(`function ${name}(`); let pos=html.indexOf('{',start), depth=1, end=pos+1;
 while(depth) {if(html[end]==='{')depth++;if(html[end]==='}')depth--;end++;}
 return html.slice(start,end);
}
const context = vm.createContext({setTimeout, setExportStatus(){}, mod1ComparisonFileName:l=>l.sourceFile, isMaxiSourceLine:l=>l.sourceFile.includes('maxi')});

vm.runInContext(extract('rd03MaxiMatchRows'), context);
const r1={sourceFile:'rd03'}, r2={sourceFile:'rd03'}, m1={sourceFile:'maxi'}, m2={sourceFile:'maxi'}, m3={sourceFile:'maxi'};
const rows=context.rd03MaxiMatchRows([r1,r2,m1,m2,m3],new Map(),new Map([[r1,[m1,m2]]]));
assert.equal(rows.length,4);
assert.equal(rows.filter(row=>row.rd03Line===r1).length,2);
assert.ok(rows.some(row=>row.rd03Line===r2 && row.maxiLine===null));
assert.ok(rows.some(row=>row.rd03Line===null && row.maxiLine===m3));
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);
console.log('Original CSV export: all matches and unmatched routes retained');
// Maxi-only filters must agree for map/report segments and source export rows.
Object.assign(context, {
  normalizeImportCategory: value => value || 'network',
  getSegProvinces: line => line.provinces || ['Bangkok'],
  selectedPeaOfficeId: () => '',
  OVERLAP_META: { none: {}, partial: {}, full: {} }
});
vm.runInContext(['getSegCableStatus', 'matchesMaxiFileFilters', 'segmentMatchesReportFilters', 'sourceLineMatchesExportFilters'].map(extract).join('\n'), context);
const category = { network: false, 'ready-access': true, customer: false };
const status = ['In Service'];
const rd03 = { sourceFile: 'RD03.kml', importCategory: 'network', cableStatus: '', overlapType: 'none' };
const allowed = { sourceFile: 'maxi.kml', importCategory: 'ready-access', cableStatus: 'In Service', overlapType: 'none' };
const blockedStatus = { ...allowed, cableStatus: 'Planned' };
const blockedCategory = { ...allowed, importCategory: 'network' };
// Production helper normalizes filenames before checking Maxi.
context.mod1ComparisonFileName = line => String(line.sourceFile || '').toLowerCase();
for (const [line, expected] of [[rd03, true], [allowed, true], [blockedStatus, false], [blockedCategory, false]]) {
  assert.equal(context.segmentMatchesReportFilters(line, ['Bangkok'], { none: true }, status, category), expected);
  assert.equal(context.sourceLineMatchesExportFilters(line, ['Bangkok'], status, category), expected);
}
assert.equal(context.matchesMaxiFileFilters(rd03, status, {}), true);
assert.equal(context.matchesMaxiFileFilters(allowed, status, {}), false);
assert.equal(context.segmentMatchesReportFilters(rd03, ['Other'], { none: true }, status, category), false);
assert.equal(context.segmentMatchesReportFilters(rd03, ['Bangkok'], { none: false }, status, category), false);
assert.equal(context.sourceLineMatchesExportFilters(rd03, ['Other'], status, category), false);
console.log('Maxi-only status/category filters: RD03 retained; Maxi filtered; province and overlap respected');
