import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../Permission_Out.html', import.meta.url), 'utf8');
function extract(name) {
 const start=html.indexOf(`function ${name}(`); let pos=html.indexOf('{',start), depth=1, end=pos+1;
 while(depth) {if(html[end]==='{')depth++;if(html[end]==='}')depth--;end++;}
 return (html.slice(start-6,start)==='async ' ? 'async ' : '') + html.slice(start,end);
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
// Direct CSV overlap: original columns remain in place; only two are appended.
vm.runInContext(['exportRouteIndex', 'haversineMeters', 'lineLengthMeters', 'csvDirectOverlapMeters', 'csvDirectMatchRows'].map(extract).join('\n'), context);
const route = (sourceFile, points) => ({sourceFile, coords: points.map(([x,y])=>[100+x/111320,y/111320])});
const base=route('rd03',[[0,0],[100,0]]);
const full=route('maxi',[[0,0],[100,0]]);
const almost=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.2, `${actual} != ${expected}`);
almost(context.csvDirectOverlapMeters(base,full,1),100);
almost(context.csvDirectOverlapMeters(base,route('maxi',[[70,0],[20,0]]),1),50);
almost(context.csvDirectOverlapMeters(base,route('maxi',[[0,0],[100,0],[0,0]]),1),100);
almost(context.csvDirectOverlapMeters(base,route('maxi',[[50,-50],[50,50]]),1),0);
almost(context.csvDirectOverlapMeters(base,route('maxi',[[0,10],[100,10]]),1),0);
almost(context.csvDirectOverlapMeters(base,route('maxi',[[0,0],[20,0],[20,50],[80,50],[80,0],[100,0]]),1),40);
const two=await context.csvDirectMatchRows([base,full,{...full}],1);
assert.equal(two.length,2);
for(const row of two){almost(row.overlapMeters,100);almost(row.overlapPercent,100);}
const missing=await context.csvDirectMatchRows([base],1);
assert.equal(missing[0].maxiLine,null);assert.equal(missing[0].overlapMeters,0);
const unmatched=await context.csvDirectMatchRows([base,route('maxi',[[0,10],[100,10]])],1);
assert.equal(unmatched.length,2);
assert.ok(html.includes("'จังหวัด(Maxi)',\n  'ระยะทางทับซ้อนจริง (เมตร)', '% ทับซ้อนเทียบ RD03'"));
console.log('Direct CSV overlap: full, partial, reversed, repeated, disjoint, crossing, tolerance, multiple Maxi and unmatched passed');
vm.runInContext(['exportOverlapParts','exportTrimmedMaxi','trimExportSourceLines'].map(extract).join('\n'),context);
const long=route('maxi',[[-25,0],[125,0]]);
const snapshot=JSON.stringify([base,long]);
const trimmed=context.trimExportSourceLines([base,long],1);
assert.equal(trimmed[0],base);assert.equal(trimmed.length,2);
almost(trimmed[1].length,100);
assert.equal(JSON.stringify([base,long]),snapshot);
const split=route('rd03',[[0,0],[20,0],[20,50],[80,50],[80,0],[100,0]]);
const parts=context.exportTrimmedMaxi(full,[split],1);
assert.equal(parts.length,2);almost(parts.reduce((n,p)=>n+p.length,0),40);
assert.equal(context.exportTrimmedMaxi(full,[base,base],1).length,1);
assert.equal(context.trimExportSourceLines([base,route('maxi',[[0,50],[100,50]])],1).length,1);
assert.equal(context.trimExportSourceLines([long],1).length,0);
console.log('Export trimming: endpoints, disconnected parts, duplicate references, unmatched removal and immutable originals passed');
context.performance = performance;
vm.runInContext(extract('trimExportSourceLinesAsync'),context);
const distributed=[];
for(let i=0;i<200;i++) {
 const y=i*5000;
 distributed.push(route('rd03',[[0,y],[100,y]]),route('maxi',[[-25,y],[125,y]]));
}
let started=performance.now();
const oldTrim=context.trimExportSourceLines(distributed,1);
const oldMs=performance.now()-started;
started=performance.now();
const newTrim=await context.trimExportSourceLinesAsync(distributed,1);
const newMs=performance.now()-started;
assert.equal(JSON.stringify(newTrim),JSON.stringify(oldTrim));
const csvLive=html.slice(html.indexOf('async function exportCSV('),html.indexOf('/* Legacy detailed CSV'));
assert.ok(!csvLive.includes('await getCachedExportOverlapGroupsAsync(exportSegments'));
assert.ok(!csvLive.includes('buildSourceOverlapMatchIndex('));
console.log(`Spatial trim benchmark, 200 RD03 + 200 Maxi: ${oldMs.toFixed(1)} ms -> ${newMs.toFixed(1)} ms; identical output`);
