const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);
ctx.formatSeasonalitySheet_ = () => {};
const settings = { maxLevels: 5, enableSeasonalityFilter: true };
const indexes = ctx.getOutputRowIndexes_(5);
let written;
const sheet = {
  clearContents() { written = null; },
  getRange() { return { setValues(rows) { written = rows; }, setNumberFormat() {} }; }
};
function row(id, category) {
  const result = Array(80).fill('');
  result[0] = id;
  result[1] = 'Product';
  result[indexes.productTypeFullPath] = category;
  ctx.splitProductType_(category, 5).forEach((value, i) => { result[indexes.productTypeLevelStart + i] = value; });
  return result;
}
const rules = ctx.buildProductTypeSeasonalityRulesFromRows_([
  { path: ['Root'], winter: true },
  { path: ['Root', 'Child'], summer: true, autumn: true }
], 5);
const names = ['Winter', 'Spring', 'Summer', 'Autumn'];
for (const category of ['Root > Child > Leaf', 'Root > Other', 'Unknown', '']) {
  for (let mask = 0; mask < 16; mask++) {
    const manual = { comment: 'keep' };
    names.forEach((name, i) => { manual['manual' + name] = !!(mask & (1 << i)); });
    ctx.writeSeasonalitySheet_(sheet, [row('sku', category)], { sku: manual }, 5, settings, rules);
    const result = written[1];
    assert.equal(result[20], 'keep');
    assert.ok(result.slice(8, 20).every(value => typeof value === 'boolean'));
    const expectedCategory = category.startsWith('Root > Child') ? [false, false, true, true]
      : category.startsWith('Root') ? [true, false, false, false] : [false, false, false, false];
    assert.deepEqual(Array.from(result.slice(12, 16)), expectedCategory);
    for (let active = 0; active < 16; active++) {
      names.forEach((name, i) => { settings['activeSeason' + name] = !!(active & (1 << i)); });
      const decision = ctx.getSeasonalityDecision_({ normId: 'sku', productTypes: [category] }, { sku: manual }, rules, settings);
      const final = result.slice(16, 20);
      assert.equal(decision.allowed, !final.some(Boolean) || final.some((value, i) => value && !!(active & (1 << i))));
    }
  }
}
// Exercise the write payload at the reported catalog/category scale, without remote Sheets latency.
const largeRules = ctx.buildProductTypeSeasonalityRulesFromRows_(Array.from({ length: 78 }, (_, i) => ({ path: ['Category ' + i], summer: true })), 5);
const rows = Array.from({ length: 3000 }, (_, i) => row('sku' + i, 'Category ' + (i % 78)));
const start = performance.now();
ctx.writeSeasonalitySheet_(sheet, rows, { sku2: { manualWinter: true, comment: 'preserved' } }, 5, settings, largeRules);
assert.equal(written.length, 3001);
assert.ok(written.slice(1).every(values => values.slice(8, 20).every(value => typeof value === 'boolean')));
assert.equal(written.find(values => values[0] === 'sku2')[20], 'preserved');
ctx.writeSeasonalitySheet_(sheet, [], {}, 5, settings, []);
assert.equal(written.length, 1);
console.log('PASS: Seasonality values, deepest category, manual overrides, filter parity; 3000 rows/78 rules local run in ' + Math.round(performance.now() - start) + ' ms');
