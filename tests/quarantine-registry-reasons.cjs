const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);
ctx.parseDateFlexible_ = v => v ? new Date(v) : null;
const today = new Date('2026-09-08');
const definitions = [
  ['noSales', 'noSalesUntil', 2, 'NO_SALES'],
  ['spend', 'spendUntil', 3, 'SPEND_OVER_MARGIN'],
  ['expensiveClick', 'expensiveClickUntil', 4, 'EXPENSIVE_CLICK'],
  ['targetCpa', 'targetCpaUntil', 11, 'TARGET_CPA']
];
for (const [flag, date, index] of definitions) {
  for (const until of ['2026-09-07', '2026-09-08', '2026-09-09', '']) {
    const e = ctx.makeEmptyQuarantineEntry_('x');
    Object.assign(e, { count: 5, problematic: true, lastAdded: '2026-09-01', activeUntil: '2026-09-10' });
    for (const [f, d] of definitions) { e[f] = true; e[d] = '2026-09-10'; }
    e[date] = until;
    const map = { x: e, expired: { ...e, offerId: 'expired', activeUntil: '2026-09-08' } };
    const before = JSON.stringify(map);
    let rows, cleared = false;
    const sheet = {
      getLastRow: () => 3,
      getRange: () => ({ clearContent() { cleared = true; }, setValues(v) { rows = v; }, setNumberFormat() {} })
    };
    ctx.writeQuarantineRegistry_(sheet, map, today);
    assert.equal(cleared, true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][index], until === '2026-09-09' ? 'YES' : '');
    const expectedReasons = ctx.buildActiveQuarantineMap_(map, today).x.reasons;
    const writtenReasons = definitions.filter(([, , col]) => rows[0][col] === 'YES').map(([, , , reason]) => reason).join(', ');
    assert.equal(writtenReasons, expectedReasons);
    assert.equal(rows[0][1], 5);
    assert.equal(rows[0][5], 'YES');
    assert.equal(rows[0][6], e.activeUntil);
    assert.equal(rows[0][7], e.noSalesUntil);
    assert.equal(rows[0][8], e.spendUntil);
    assert.equal(rows[0][9], e.expensiveClickUntil);
    assert.equal(rows[0][12], e.targetCpaUntil);
    assert.equal(JSON.stringify(map), before);
  }
}
console.log('PASS: registry reasons match active diagnostics for all rules; dates, counts and input state unchanged');
