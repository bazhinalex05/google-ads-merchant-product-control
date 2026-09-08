const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);

const settings = { defaultBenchmarkGroup: 'other' };
const stat = (clicks, group = 'other', conversions = 0) => ({
  clicks, impressions: clicks * 10, cost: clicks, conversions,
  conversionValue: conversions * 100, benchmarkGroup: group
});
const merchantMap = { a: {}, b: {}, sale: {}, named: {}, noStats: {} };
const selected = {
  a: stat(10), b: stat(20), sale: stat(5, 'other', 1), named: stat(30, 'named')
};
const baseline = ctx.calculateFunnelRows_(selected, settings, merchantMap);
assert.equal(baseline.b.benchmarkClickThreshold, 15);
assert.equal(baseline.b.benchmarkImpressionThreshold, 150);
assert.equal(baseline.b.funnelStage, '2 вк+вп');
assert.equal(baseline.sale.funnelStage, '1 продажі');

const widerStats = {
  ...selected, outside: stat(1000), outsideNamed: stat(500, 'named'),
  outsideSale: stat(2000, 'other', 1)
};
const before = JSON.stringify(widerStats);
const actual = ctx.calculateFunnelRows_(widerStats, settings, merchantMap);
assert.equal(JSON.stringify(actual), JSON.stringify(baseline));
assert.equal(JSON.stringify(widerStats), before);
assert.equal(actual.outside, undefined);
assert.equal(actual.outsideNamed, undefined);
assert.equal(actual.outsideSale, undefined);
assert.equal(actual.noStats, undefined);
assert.equal(Object.keys(ctx.calculateFunnelRows_(widerStats, settings, {})).length, 0);

const expanded = ctx.calculateFunnelRows_(widerStats, settings, { ...merchantMap, outside: {} });
assert.equal(expanded.b.benchmarkClickThreshold, 344);
assert.equal(expanded.b.funnelStage, '5 нк+нп');
assert.ok(expanded.outside);
console.log('PASS: only selected Merchant IDs affect funnel thresholds; input statistics remain unchanged');
