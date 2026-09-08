const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);
ctx.formatDate_ = d => d.toISOString().slice(0, 10);
const rules = [{ path: ['Root'], depth: 1, targetCpa: 300 }];
assert.equal(ctx.chooseProductTypeTargetCpa_([], rules, 5, 200), 200);
assert.equal(ctx.chooseProductTypeTargetCpa_(null, [], 5, 200), 200);
assert.equal(ctx.chooseProductTypeTargetCpa_(['Other'], rules, 5, 200), 200);
assert.equal(ctx.chooseProductTypeTargetCpa_(['Root > Child'], rules, 5, 200), 300);
assert.equal(ctx.chooseProductTypeTargetCpa_([], [], 5, 0), 0);
assert.equal(ctx.chooseProductTypeTargetCpa_([], [], 5, -5), 0);
assert.equal(ctx.chooseProductTypeTargetCpa_([], [], 5), 0);

function candidate(cost, conversions, productTypes, defaultTargetCpa = 200) {
  const out = {};
  ctx.collectTargetCpaCandidates_(out, { a: { cost, conversions } }, {
    a: { offerId: 'a', productTypes }
  }, rules, { maxLevels: 5, defaultTargetCpa, targetCpaExcessThreshold: 0.2,
    targetCpaQuarantineDays: 7 }, new Date('2026-09-08'));
  return out.a;
}
assert.ok(candidate(1000, 1, []));
assert.ok(candidate(241, 1, ['Other']));
assert.equal(candidate(240, 1, []), undefined);
assert.equal(candidate(1000, 0, []), undefined);
assert.equal(candidate(1000, 1, [], 0), undefined);
assert.equal(candidate(300, 1, ['Root']), undefined);
assert.equal(candidate(360, 1, ['Root']), undefined);
assert.ok(candidate(361, 1, ['Root']));
console.log('PASS: global CPA fallback, category precedence, exact excess boundary, no sales and no positive target');
