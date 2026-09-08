const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(source, ctx);
function sheet(rows) {
  return {
    rows,
    getLastRow() { return rows.length; },
    getLastColumn() { return rows[0]?.length || 0; },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() { return Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')); },
        getDisplayValues() { return this.getValues().map(row => row.map(String)); },
        clearContent() { for(let i = 0; i < nr; i++) for(let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = ''; },
        setValue(value) { rows[r - 1][c - 1] = value; }
      };
    }
  };
}
const header = ['id', 'cost', 'last_quarantine_exit_date', 'quarantine_active', 'quarantine_release', 'quarantine_reasons', 'target_cpa_rule_cost', 'exclusion_reasons', 'excluded_destination_shopping', 'excluded_destination_display', 'comment', 'attr_conversions_stage_1'];
ctx.sheets = {
  quarantineRegistry: sheet([['id', 'quarantine_count'], ['a', 3]]),
  quarantineLog: sheet([['id', 'quarantine_count'], ['a', 5], ['gone', 2]]),
  productDiagnostics: sheet([header.slice(),
    ['a', 100, '2026-09-01', 'YES', '2026-09-20', 'TARGET_CPA', 900, 'TARGET_CPA', 'Shopping_ads', 'Display_ads', 'keep', 4],
    ['b', 200, '', 'YES', '', 'NO_SALES', 50, 'SEASONALITY, NO_SALES', 'Shopping_ads', 'Display_ads', 'keep2', 2],
    ['gone', 300, '2026-09-02', 'NO', '', '', 70, 'PRODUCT_TYPE_NOT_ALLOWED', 'Shopping_ads', 'Display_ads', 'keep3', 0]])
};
const start = source.indexOf('  if (settings.resetQuarantine) {');
const end = source.indexOf('  if (settings.enableDashboardFromDiagnostics) {', start);
assert.ok(start > 0 && end > start);
assert.ok(end < source.indexOf('  var quarantineLifecycle = readQuarantineLifecycle_'));
ctx.settings = {resetQuarantine: false, enableQuarantine: true, enableTargetCpaRule: true};
vm.runInContext(source.slice(start, end), ctx);
assert.equal(ctx.sheets.quarantineRegistry.rows[1][1], 3);
assert.equal(ctx.settings.enableQuarantine, true);
ctx.settings.resetQuarantine = true;
for (let run = 0; run < 2; run++) {
  ctx.settings.enableQuarantine = true;
  vm.runInContext(source.slice(start, end), ctx);
  assert.equal(ctx.settings.enableQuarantine, false);
  assert.equal(ctx.settings.enableTargetCpaRule, true);
  assert.equal(ctx.settings.resetQuarantine, true);
  for (const key of ['quarantineRegistry', 'quarantineLog']) {
    assert.equal(ctx.sheets[key].rows[0][0], 'id');
    assert.ok(ctx.sheets[key].rows.slice(1).flat().every(v => v === ''));
  }
  const rows = ctx.sheets.productDiagnostics.rows;
  assert.deepEqual(rows[0], header);
  assert.deepEqual(rows[1], ['a', 100, '', '', '', '', '', '', '', '', 'keep', 4]);
  assert.equal(rows[2][7], 'SEASONALITY');
  assert.equal(rows[2][8], 'Shopping_ads');
  assert.equal(rows[3][2], '');
  assert.equal(rows[3][7], 'PRODUCT_TYPE_NOT_ALLOWED');
  const lifecycle = ctx.readQuarantineLifecycle_(ctx.sheets.productDiagnostics);
  for (const item of Object.values(lifecycle)) {
    assert.equal(item.wasActive, false);
    assert.equal(item.exitDate, '');
  }
  ctx.updateQuarantineExitDates_(lifecycle, {}, new Date());
  assert.ok(Object.values(lifecycle).every(item => item.exitDate === ''));
}
ctx.settings = {resetQuarantine: false, enableQuarantine: true};
vm.runInContext(source.slice(start, end), ctx);
assert.equal(ctx.settings.enableQuarantine, true);
assert.match(source, /resetQuarantine: false/);
assert.match(source, /readSettingBool_\(map, "reset_quarantine"/);
assert.ok(source.indexOf('["reset_quarantine", settings.resetQuarantine') > source.indexOf('["merchant_api_retry_sleep_seconds", settings.merchantApiRetrySleepSeconds'));
ctx.resetQuarantineState_({quarantineRegistry: sheet([]), quarantineLog: sheet([['id']]), productDiagnostics: sheet([['id']])});
console.log('PASS: reset default/read/template, repeated reset, headers and non-quarantine data, no synthetic exit, resume after unchecking');
