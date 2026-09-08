const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);
ctx.formatDate_ = ctx.formatApiDate_ = d => d.toISOString().slice(0, 10);
ctx.parseDateFlexible_ = value => value ? new Date(value) : null;
const today = new Date('2026-09-08');
const state = { a: { exitDate: '', wasActive: true }, b: { exitDate: '', wasActive: true } };
ctx.updateQuarantineExitDates_(state, { a: { activeUntil: new Date('2026-09-09') } }, today);
assert.equal(state.a.exitDate, '');
assert.equal(state.b.exitDate, '2026-09-08');
ctx.updateQuarantineExitDates_(state, {}, new Date('2026-09-10'));
assert.equal(state.a.exitDate, '2026-09-10');
assert.equal(state.b.exitDate, '2026-09-08');

ctx.getDateRange_ = () => ({ start: '2026-08-08', end: '2026-09-06' });
let calls = 0;
ctx.getQuarantineBatchStats_ = (start, end, ids) => {
  calls++;
  assert.equal(start, '2026-09-01');
  assert.equal(end, '2026-09-06');
  assert.equal(ids.length, 2);
  return { a: { clicks: 3 } };
};
const lifecycle = { a: { exitDate: '2026-09-01' }, b: { exitDate: '2026-09-01' }, c: { exitDate: '2026-09-08' }, d: { exitDate: '2026-08-01' } };
const merchant = Object.fromEntries(Object.keys(lifecycle).map(id => [id, { offerId: id }]));
const cache = {};
for (let i = 0; i < 2; i++) {
  const stats = Object.fromEntries(Object.keys(lifecycle).map(id => [id, { clicks: 150 }]));
  ctx.applyQuarantineDateWindows_(stats, merchant, lifecycle, 30, 2, cache);
  assert.equal(stats.a.clicks, 3);
  assert.equal(stats.b, undefined);
  assert.equal(stats.c, undefined);
  assert.equal(stats.d.clicks, 150);
}
assert.equal(calls, 1);
ctx.getDateRange_ = () => ({ start: '2026-09-02', end: '2026-10-01' });
const mature = { a: { clicks: 12 } };
ctx.applyQuarantineDateWindows_(mature, merchant, { a: lifecycle.a }, 30, 2, {});
assert.equal(mature.a.clicks, 12);
assert.equal(calls, 1);
console.log('PASS: shared exit, overlapping quarantine, stable date, old-data removal, exclusion lag, grouped cache, rolling-window recovery');
