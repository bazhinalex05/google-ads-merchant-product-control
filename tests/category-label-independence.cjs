const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
// Execute the actual category preparation block with only its I/O replaced.
const start = source.indexOf('  var productTypeRules = { allowedPrefixes: [] };');
const end = source.indexOf('  Logger.log("Reading Seasonality manual state...");', start);
assert.ok(start >= 0 && end > start);
for (let mask = 0; mask < 8; mask++) {
  let reads = 0, queries = 0, writes = 0;
  const ctx = { Logger: { log() {} } };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.settings = {
    maxLevels: 5, defaultTargetCpa: 200, defaultBenchmarkGroup: 'other',
    enableProductTypeFilter: !!(mask & 1), enableSeasonalityFilter: !!(mask & 2),
    enableTargetCpaRule: !!(mask & 4)
  };
  ctx.sheets = { productTypes: {} };
  ctx.merchantProducts = [{ offerId: 'a', normId: 'a', price: 100, productTypes: ['Root > Child'], benchmarkGroup: 'merchant' }];
  ctx.merchantMap = { a: ctx.merchantProducts[0] };
  const manual = {};
  manual[ctx.buildPathKey_(['Root'], 5)] = { checked: true, benchmarkLabel: 'parent', priorityLabel: 'parent-priority' };
  manual[ctx.buildPathKey_(['Root', 'Child'], 5)] = { checked: true, benchmarkLabel: 'child', priorityLabel: 'child-priority' };
  ctx.readProductTypeManualStateMap_ = () => { reads++; return manual; };
  ctx.getAdsStatsMap_ = () => { queries++; return {}; };
  ctx.writeProductTypesSheet_ = () => { writes++; };
  vm.runInContext(source.slice(start, end), ctx);
  assert.equal(reads, 1);
  assert.equal(queries, mask ? 1 : 0);
  assert.equal(writes, mask ? 1 : 0);
  assert.equal(ctx.chooseProductTypeBenchmarkLabel_(['Root > Child'], ctx.productTypeBenchmarkRules, 5), 'child');
  assert.equal(ctx.chooseProductTypeBenchmarkLabel_(['Root > Other'], ctx.productTypeBenchmarkRules, 5), 'parent');
  const product = { offerId: 'a', normId: 'a', productTypes: ['Root > Child'], priorityLabel: 'merchant-priority' };
  assert.equal(ctx.choosePriorityLabel_(product, ctx.productTypePriorityRules, {}, ctx.settings), 'child-priority');
  assert.equal(ctx.choosePriorityLabel_(product, ctx.productTypePriorityRules, { a: 'id-priority' }, ctx.settings), 'id-priority');
}
console.log('PASS: category labels survive all filter/CPA switch combinations without extra stats queries or sheet rewrites');
