import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../Permission_Out.html', import.meta.url), 'utf8');
const ux = readFileSync(new URL('../ux-refresh.js', import.meta.url), 'utf8');
const start = html.indexOf('function recomputeAll()');
const end = html.indexOf("['rateB', 'polesPerKm', 'surchargePct'].forEach", start);
assert.ok(start >= 0 && end > start);

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', style: {} });
  return elements.get(id);
}
element('rateB').value = '10';
element('polesPerKm').value = '29';
element('surchargePct').value = '0';
const events = [];
const active = { new: true, same: true, remove: true };
const context = vm.createContext({
  document: { getElementById: element },
  window: { dispatchEvent: event => events.push(event) },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  state: { segmentsB: [
    { status: 'new', length: 1000, poles: 10, cost: 100, allowed: true },
    { status: 'same', length: 2000, poles: 20, cost: 200, allowed: true },
    { status: 'remove', length: 3000, poles: 30, cost: 300, allowed: false }
  ] },
  STATUS_META: { new: {}, same: {}, remove: {} },
  getActiveStatuses: () => active,
  getSelectedProvinces: () => ['selected'],
  getActiveOverlaps: () => ({}),
  getSelectedCableStatuses: () => [],
  getActiveCategories: () => ({}),
  segmentMatchesReportFilters: segment => segment.allowed,
  billingForSegment: segment => ({ km: segment.length / 1000, poles: segment.poles, cost: segment.cost }),
  fmtNum: number => number.toFixed(2),
  fmtKm: meters => (meters / 1000).toFixed(3)
});
vm.runInContext(html.slice(start, end), context);

function assertSummary(count, km, poles, cost) {
  context.recomputeAll();
  const event = events.at(-1);
  assert.equal(event.type, 'permissionout:filtered-summary');
  assert.equal(event.detail.segmentCount, count);
  assert.equal(event.detail.distanceKm, km);
  assert.equal(element('statTotalPoles').textContent, String(poles));
  assert.equal(element('costTotalBig').textContent, cost.toFixed(2));
}

assertSummary(2, 3, 30, 300);
active.same = false;
assertSummary(1, 1, 10, 100);
context.state.segmentsB[0].allowed = false;
assertSummary(0, 0, 0, 0);
context.state.segmentsB = Array.from({ length: 301 }, () => ({
  status: 'new', length: 1000, poles: 1, cost: 2, allowed: true
}));
active.same = true;
assertSummary(301, 301, 301, 602);
assert.ok(ux.includes("window.addEventListener('permissionout:filtered-summary'"));
assert.ok(ux.includes('filteredSummary.segmentCount.toLocaleString'));
assert.ok(ux.includes('filteredSummary.distanceKm.toLocaleString'));
assert.ok(!ux.includes('compactSummary.dataset.segmentCount'));
assert.ok(!ux.includes("q('#statTotalA')?.textContent"));
console.log('MOD1 compact summary follows all filtered segments, distance, poles and cost, including zero and over 300 matches');
