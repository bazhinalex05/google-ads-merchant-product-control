const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const ctx = { Logger: { log() {} }, SpreadsheetApp: { flush() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);

const products = [
  { normId: 'a', price: 100, productTypes: ['Root > A'] },
  { normId: 'b', price: 200, productTypes: ['Root > B'] },
  { normId: 'c', price: 300, productTypes: ['Root'] }
];
const stats = ctx.buildProductTypeStatsMap_(products, {
  a: { cost: 10, conversions: 1, conversionValue: 100 },
  b: { cost: 90, conversions: 3, conversionValue: 200 },
  c: { cost: 20, conversions: 2, conversionValue: 60 }
}, 5);
const tree = ctx.buildProductTypeTreeRows_(products, {}, stats, 5);
assert.equal(tree[0].spend30d, 120);
assert.equal(tree[0].conversions30d, 6);
assert.equal(tree[0].conversionValue30d, 360);
assert.equal(tree[0].cpa30d, 20);
assert.equal(tree[0].actualRoas, 3);

const targets = [{ targetCpa: '', marginPercent: '', manualTargetRoas: '' },
  { targetCpa: 120, marginPercent: 40, manualTargetRoas: 5 }];
ctx.applyProductTypesTargets_(targets, { defaultTargetCpa: 200, defaultMarginPercent: 30 });
assert.equal(targets[0].targetRoas, 100 / 30);
assert.equal(targets[0].effectiveTargetCpa, 200);
assert.equal(targets[1].targetRoas, 5);
assert.equal(targets[1].effectiveTargetCpa, 120);

const manualHeader = ['enabled', 'product_type_l1', 'product_type_l2', 'product_type_l3', 'product_type_l4', 'product_type_l5', 'target_cpa', 'target_roas', 'margin_percent', 'comment'];
const manualData = [[true, 'Root', '', '', '', '', 200, 5, 30, 'keep'], [true, '', 'A', '', '', '', '', 100/30, '', 'child']];
const manualSheet = {
  getLastRow: () => 3, getLastColumn: () => manualHeader.length,
  getRange(row) { return { getValues: () => row === 1 ? [manualHeader] : manualData, getFormulas: () => [[''], ['=100/30']] }; }
};
const manual = ctx.readProductTypeManualStateMap_(manualSheet, 5, {});
assert.equal(manual.Root.manualTargetRoas, 5);
assert.equal(manual['Root|||A'].manualTargetRoas, '');
assert.equal(manual.Root.comment, 'keep');

let written;
const range = { setValues(value) { written = value; return this; }, setNumberFormat() { return this; }, setDataValidation() { return this; } };
const outputSheet = { clearContents() {}, getRange() { return range; }, getLastRow: () => 0, getLastColumn: () => 0 };
ctx.formatSeasonalitySheet_ = () => {};
const idx = ctx.getOutputRowIndexes_(5);
const row = Array(76).fill('');
row[0] = 'a'; row[1] = 'Product'; row[idx.productTypeFullPath] = 'Root > A';
row[idx.productTypeLevelStart] = 'Root'; row[idx.productTypeLevelStart + 1] = 'A';
row[idx.impressions] = 82;
ctx.writeSeasonalitySheet_(outputSheet, [row], { a: { manualWinter: true, comment: 'keep' } }, 5, { productTypesSheetName: 'ProductTypes' });
assert.equal(written[1][2], 'Root > A');
assert.equal(written[1][3], 'Root');
assert.equal(written[1][4], 'A');
assert.equal(written[1][8], true);
assert.equal(written[1].at(-1), 'keep');

ctx.clearManagedProductTypesSheet_ = () => {};
ctx.formatProductTypesSheet_ = () => {};
ctx.SpreadsheetApp.newDataValidation = () => ({ requireCheckbox() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } });
const outputRows = [{ ...tree[0], manualTargetRoas: 5, targetRoas: 5 }, { ...tree[1], manualTargetRoas: '', targetRoas: 100/30 }];
ctx.writeProductTypesSheet_(outputSheet, outputRows, 5, { settingsSheetName: 'Settings' });
assert.equal(written[0][12], 'target_cpa');
assert.equal(written[0][13], 'target_roas');
assert.equal(written[0].at(-1), 'comment');
assert.equal(written[1][13], 5);
assert.match(written[2][13], /^=IFERROR/);
assert.match(written[2][13], /default_margin_percent/);

const header = ['roas', 'conversions', 'cost', 'spend_to_price_threshold', 'attr_conversion_value_stage_1'];
const formats = {};
const formatRange = { setBackground() { return this; }, setFontWeight() { return this; }, getValues: () => [header] };
const formatSheet = { setFrozenRows() {}, getRange(row, col) { return { ...formatRange, setNumberFormat(value) { formats[header[col - 1]] = value; } }; } };
ctx.getAccountCurrencyCode_ = () => 'UAH';
ctx.formatProductDiagnosticsSheet_(formatSheet, 3, header.length);
assert.equal(formats.roas, '0.00%');
assert.equal(formats.conversions, '0.##');
assert.equal(formats.spend_to_price_threshold, '0.00%');
assert.equal(formats.cost, formats.attr_conversion_value_stage_1);
assert.notEqual(formats.cost, formats.conversions);
console.log('PASS: category totals, manual target persistence, formula fallback, Seasonality mapping, diagnostics formats');

const source = ['id', 'quarantine_reasons', 'category_allowed', 'attr_conversions_stage_1', 'last_quarantine_exit_date'];
const display = ['id', 'quarantine_reasons', 'last_quarantine_exit_date', 'category_allowed', 'attr_conversions_stage_1'];
const original = [['sku', 'TARGET_CPA', 'YES', 7, '08.09.2026']];
const moved = ctx.remapDiagnosticsRows_(original, source, display);
assert.equal(moved[0][2], '08.09.2026');
assert.equal(moved[0][4], 7);
assert.equal(JSON.stringify(ctx.remapDiagnosticsRows_(moved, display, source)), JSON.stringify(original));
assert.equal(original[0][4], '08.09.2026');
const colors = [];
ctx.formatDiagnosticsHeaderGroups_({ getRange(r, c) { return { setBackground(color) { colors[c - 1] = color; } }; } },
  ['id', 'title', 'product_type_full_path', 'product_type_l1', 'impressions', 'roas', 'sales_status', 'funnel_stage', 'benchmark_group', 'quarantine_active', 'quarantine_reasons', 'last_quarantine_exit_date', 'category_allowed']);
assert.equal(colors[0], colors[1]);
assert.notEqual(colors[1], colors[2]);
assert.equal(colors[0], colors[4]);
assert.equal(colors[9], colors[11]);
assert.notEqual(colors[11], colors[12]);
let diagnosticsWrites = [];
const diagnosticsSheet = {
  clearContents() {},
  getRange(r, c) { return { setValues(v) { diagnosticsWrites.push({ r, v }); }, setNumberFormat() {} }; }
};
const internalRow = Array.from({ length: 77 }, (_, i) => i);
internalRow[76] = '08.09.2026';
ctx.writeProductDiagnosticsSheet_(diagnosticsSheet, [internalRow], { maxLevels: 5, productDiagnosticsStartRow: 1, writeChunkSize: 100, enableManagedSheetFormatting: false });
const writtenHeader = diagnosticsWrites[0].v[0];
const writtenRow = diagnosticsWrites[1].v[0];
assert.equal(writtenHeader.indexOf('last_quarantine_exit_date'), writtenHeader.indexOf('quarantine_reasons') + 1);
assert.equal(writtenRow[writtenHeader.indexOf('last_quarantine_exit_date')], '08.09.2026');
assert.equal(writtenRow.length, writtenHeader.length);
const readBack = ctx.readDashboardSourceFromDiagnostics_({ getLastRow: () => 2, getLastColumn: () => writtenHeader.length,
  getRange(r) { return { getValues: () => r === 1 ? [writtenHeader] : [writtenRow] }; }
}, { maxLevels: 5 });
assert.equal(JSON.stringify(readBack.outputRows[0]), JSON.stringify(internalRow));
let removed = 0;
ctx.SpreadsheetApp.ProtectionType = { SHEET: 'SHEET', RANGE: 'RANGE' };
ctx.removeProtectionsForSheet_({ getProtections() { return [{ canEdit: () => true, remove() { removed++; } }]; } });
assert.equal(removed, 2);
console.log('PASS: diagnostics date placement, header grouping, dashboard roundtrip, protection removal');
