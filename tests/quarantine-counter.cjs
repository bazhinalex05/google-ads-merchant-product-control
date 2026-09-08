const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);

let today = new Date('2026-09-01');
let registry = {};
let history = {};
ctx.getDateOnly_ = () => today;
ctx.formatDate_ = d => d.toISOString().slice(0, 10);
ctx.parseDateFlexible_ = v => v ? new Date(v) : null;
ctx.ensureQuarantineRegistryHeader_ = ctx.ensureQuarantineLogHeader_ = () => {};
ctx.readQuarantineRegistry_ = () => registry;
ctx.readQuarantineHistoryMap_ = () => history;
ctx.getAdsStatsMap_ = () => ({});
ctx.applyQuarantineDateWindows_ = () => {};
ctx.collectNoSalesCandidates_ = out => ctx.addQuarantineCandidate_(out, 'x', 'x', 'NO_SALES', new Date('2026-09-30'));
ctx.collectSpendCandidates_ = out => ctx.addQuarantineCandidate_(out, 'x', 'x', 'SPEND_OVER_MARGIN', new Date('2026-10-01'));
ctx.writeQuarantineRegistry_ = (sheet, map) => {
  registry = Object.fromEntries(Object.entries(map).filter(([, e]) => ctx.isDateActive_(e.activeUntil, today)));
};
ctx.writeQuarantineLogHistory_ = (sheet, map) => { history = map; };
const settings = {
  enableNoSalesRule: true, enableSpendRule: true, enableExpensiveClickRule: false,
  enableTargetCpaRule: false, problemThreshold: 3, quarantineLogMaxRows: 1000
};
const run = () => ctx.updateQuarantine_({}, {}, { x: { offerId: 'x' } }, [], settings, {});

run();
assert.equal(registry.x.count, 1);
assert.equal(history.x.count, 1);
assert.equal(registry.x.noSales, true);
assert.equal(registry.x.spend, true);
const deadline = registry.x.activeUntil;
run();
assert.equal(registry.x.count, 1);
assert.equal(history.x.count, 1);
assert.equal(registry.x.activeUntil, deadline);

// Simulate the completed exit having removed the active row.
registry = {};
run();
assert.equal(registry.x.count, 2);
assert.equal(history.x.count, 2);
registry = {};
run();
assert.equal(registry.x.count, 3);
assert.equal(history.x.count, 3);
assert.equal(registry.x.problematic, true);

registry = {};
history = { x: { offerId: 'x', count: 5, lastAdded: '' } };
run();
assert.equal(registry.x.count, 6);
assert.equal(history.x.count, 6);
run();
assert.equal(history.x.count, 6);

for (const [registryCount, historyCount, expected] of [[8, 5, 9], [2, 7, 8]]) {
  const entry = ctx.makeEmptyQuarantineEntry_('x');
  entry.count = registryCount;
  registry = { x: entry };
  history = { x: { offerId: 'x', count: historyCount, lastAdded: '' } };
  run();
  assert.equal(registry.x.count, expected);
  assert.equal(history.x.count, expected);
}
console.log('PASS: first entry, repeat entry, imported history, larger saved count, active reruns, multiple reasons and problematic threshold');
