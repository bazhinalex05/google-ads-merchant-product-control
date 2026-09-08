const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const ctx = { Logger: { log() {} }, SpreadsheetApp: { BorderStyle: { SOLID_MEDIUM: 'medium' } } };
vm.createContext(ctx);
vm.runInContext(code, ctx);
ctx.getAccountCurrencyCode_ = () => 'USD';
ctx.formatDate_ = () => '2026-09-08';
ctx.getDateOnly_ = value => value;
const settings = { maxLevels: 5, funnelDaysAgo: 14, defaultBenchmarkGroup: 'other',
  enableQuarantine: true, enableNoSalesRule: true, enableSpendRule: true,
  enableExpensiveClickRule: true, enableTargetCpaRule: true, clicksThreshold: 100, spendToPriceThreshold: 0.3,
  targetCpaLookbackDays: 30, noSalesLookbackDays: 30, spendLookbackDays: 30, excludeLastDays: 2 };
const idx = ctx.getOutputRowIndexes_(5);
function product(id, group, stage, cost = 20, conversions = 0) {
  const row = Array(77).fill('');
  row[0] = id; row[idx.benchmarkGroup] = group; row[idx.funnelStage] = stage;
  row[idx.cost] = cost; row[idx.conversions] = conversions;
  row[idx.impressions] = 100; row[idx.clicks] = 10; row[idx.conversionValue] = 100;
  row[idx.price] = 100; return row;
}
const a = product('a', 'Alpha', '1 продажі', 40, 2);
const b = product('b', 'Beta', '2 вк+вп', 20);
b[idx.impressions + 16] = 'YES';
b[idx.impressions + 18] = 'NO_SALES, SPEND_OVER_MARGIN, EXPENSIVE_CLICK, TARGET_CPA';
b[idx.impressions + 20] = 120;
b[idx.impressions + 22] = 80;
b[idx.impressions + 27] = 10;
b[idx.impressions + 29] = 150;
const state = { registryMap: { b: { lastAdded: '2026-09-08' } }, noSalesStats: { b: { clicks: 120, cost: 120 } } };
const model = ctx.buildReferenceDashboardModel_([a, b], settings, state);
assert.equal(model.total.products, 2);
assert.equal(model.total.cost, 60);
assert.equal(model.total.cpa, 30);
assert.equal(model.quarantine.active, 1);
assert.equal(model.quarantine.targetCpa, 1);
assert.equal(model.quarantine.activeCost, 20);
assert.equal(model.priorities[1].quarantine.targetCpa.cost, 20);
assert.ok(model.quarantine.activeCost <= model.total.cost);
assert.equal(model.priorities[1].quarantine.targetCpa.products, 1);
assert.equal(model.priorities[1].quarantine.noSales.products, 0);
assert.equal(model.quarantine.newToday, 1);
assert.equal(ctx.referenceQuarantineCost_('noSales', b, idx, settings, state), 100);
assert.equal(ctx.referenceQuarantineCost_('spend', b, idx, settings, state), 30);
const noCpa = ctx.buildReferenceDashboardModel_([a, b], { ...settings, enableTargetCpaRule: false }, state);
assert.equal(noCpa.quarantine.activeCost, 20, 'dashboard funnel spend, not rule-window spend');
assert.equal(noCpa.priorities[1].quarantine.cost, 20, 'one active product counted once across reasons');
ctx.getAdsStatsMap_ = () => { throw new Error('No extra cost query for dashboard quarantine totals'); };
ctx.applyQuarantineDateWindows_ = () => { throw new Error('No exit cutoff for dashboard funnel spend'); };
const exited = b.slice(); exited[idx.attrStageStart + 12] = '01.09.2026';
assert.equal(ctx.referenceActiveQuarantineCosts_([a, exited], { ...settings, enableTargetCpaRule: false, noSalesLookbackDays: 7, spendLookbackDays: 7 }, {}).b, 20);
assert.equal(ctx.referenceActiveQuarantineCosts_([a, exited], settings).a, undefined);
const otherPeriod = exited.slice(); otherPeriod[idx.cost] = 33;
assert.equal(ctx.referenceActiveQuarantineCosts_([otherPeriod], { ...settings, funnelDaysAgo: 7 }).b, 33);
assert.equal(ctx.referenceActiveQuarantineCosts_([otherPeriod], { ...settings, enableQuarantine: false }).b, undefined);
const disabled = ctx.buildReferenceDashboardModel_([b], { ...settings, enableQuarantine: false }, state);
assert.equal(disabled.quarantine.active, 0);
assert.equal(disabled.quarantine.targetCpaEnabled, false);

class Sheet {
  constructor() { this.rows = 2; this.cols = 2; this.cells = []; this.charts = []; this.widths = {}; this.heights = {}; this.hidden = []; }
  cell(r, c) { this.cells[r] ||= []; return this.cells[r][c] ||= { value: '', style: {} }; }
  getMaxRows() { return this.rows; }
  getMaxColumns() { return this.cols; }
  getLastRow() { let n = 0; this.cells.forEach((row, r) => { if (row.some(cell => cell && cell.value !== '')) n = r; }); return n; }
  getLastColumn() { let n = 0; this.cells.forEach(row => row.forEach((cell, c) => { if (cell && cell.value !== '') n = Math.max(n, c); })); return n; }
  getRange(r, c, nr = 1, nc = 1) {
    assert.ok(r > 0 && c > 0 && r + nr - 1 <= this.rows && c + nc - 1 <= this.cols, 'range within allocated grid');
    const sheet = this;
    const each = fn => { for (let y = 0; y < nr; y++) for (let x = 0; x < nc; x++) fn(sheet.cell(r + y, c + x), y, x); };
    const range = { r, c, nr, nc,
      getValue: () => sheet.cell(r, c).value,
      getValues: () => Array.from({ length: nr }, (_, y) => Array.from({ length: nc }, (_, x) => sheet.cell(r + y, c + x).value)),
      setValue(value) { each(cell => cell.value = value); return this; },
      setValues(values) { assert.equal(values.length, nr); values.forEach(row => assert.equal(row.length, nc)); each((cell, y, x) => cell.value = values[y][x]); return this; },
      clearContent() { each(cell => cell.value = ''); return this; },
      clearFormat() { each(cell => cell.style = {}); return this; },
      clearDataValidations() { return this; }, insertCheckboxes() { return this; }, breakApart() { return this; },
      copyTo(target) { each((cell, y, x) => sheet.cell(target.r + y, target.c + x).style = { ...cell.style }); return this; }
    };
    for (const name of ['setWrap', 'setVerticalAlignment', 'setHorizontalAlignment', 'setBackground', 'setFontColor', 'setFontWeight', 'setBorder', 'setNumberFormat', 'setFontSize']) {
      range[name] = function(...args) { each(cell => cell.style[name] = args[0]); return this; };
    }
    return range;
  }
  insertRowsAfter(_, count) { this.rows += count; }
  insertColumnsAfter(_, count) { this.cols += count; }
  insertRowsBefore(row, count) { this.cells.splice(row, 0, ...Array.from({ length: count }, () => [])); this.rows += count; }
  moveRows(range, destination) { const row = this.cells.splice(range.r, 1)[0]; this.cells.splice(destination, 0, row); }
  clear() { this.cells = []; }
  setFrozenRows(n) { this.frozen = n; }
  hideRows(n) { this.hidden.push(n); }
  setColumnWidth(c, width) { this.widths[c] = width; }
  setColumnWidths(c, count, width) { for (let i = 0; i < count; i++) this.widths[c + i] = width; }
  setRowHeights(r, count, h) { for (let i = 0; i < count; i++) this.heights[r + i] = h; }
  getCharts() { return this.charts.slice(); }
  removeChart(chart) { this.charts.splice(this.charts.indexOf(chart), 1); }
  insertChart(chart) { this.charts.push(chart); }
  newChart() {
    const chart = { options: {}, ranges: [], getContainerInfo: () => ({ getAnchorRow: () => 14 }) };
    const builder = { asBarChart() { chart.type = 'bar'; return this; }, asPieChart() { chart.type = 'pie'; return this; },
      addRange(range) { chart.ranges.push([range.r, range.c, range.nr, range.nc]); return this; },
      setOption(k, v) { chart.options[k] = v; return this; },
      setPosition(...position) { chart.position = position; return this; }, build() { return chart; } };
    return builder;
  }
}
const dashboard = new Sheet();
ctx.writeReferenceDashboard_(dashboard, model);
assert.equal(dashboard.charts.length, 4);
assert.equal(dashboard.cell(2, 1).style.setHorizontalAlignment, 'left', 'title starts inside the sheet');
assert.deepEqual(dashboard.charts.map(c => c.position[2]), [0, 287, 574, 861]);
assert.equal(dashboard.cell(29, 3).value, 'Продажі з дорогим CPA');
assert.equal(dashboard.cell(30, 3).value, 'Нові сьогодні');
assert.equal(dashboard.cell(31, 3).value, 'Витрати карантину');
assert.equal(dashboard.cell(31, 1).style.setBackground, '#eef4ff');
assert.equal(dashboard.cell(31, 7).style.setBackground, '#eef4ff');
assert.equal(dashboard.cell(24, 1).style.setBackground, '#4a86e8');
assert.match(dashboard.cell(31, 5).style.setNumberFormat, /USD/);
assert.equal(dashboard.cell(30, 5).style.setNumberFormat, '0');
dashboard.cell(1, 2).value = false;
dashboard.cell(5, 1).style.setBackground = 'custom';
ctx.writeReferenceDashboard_(dashboard, ctx.buildReferenceDashboardModel_([a], settings, state));
assert.equal(dashboard.charts.length, 4);
assert.equal(dashboard.cell(5, 1).style.setBackground, 'custom');
assert.equal(dashboard.cell(25, 2).value, 1);
dashboard.cell(1, 2).value = true;
ctx.writeReferenceDashboard_(dashboard, model);
assert.equal(dashboard.charts.length, 4, 'rebuild replaces rather than duplicates charts');

const data = new Sheet();
ctx.writeReferenceDashboardData_(data, model);
assert.equal(data.cols, 10);
assert.equal(data.cell(2, 1).value, 'Зведення benchmark-груп');
assert.equal(data.cell(4, 1).value, 'Alpha');
assert.equal(data.cell(4, 10).value, 0.5);
assert.equal(data.cell(8, 1).value, 'Alpha');
assert.equal(data.cell(8, 6).value, 'Beta');
assert.equal(data.cell(22, 1).value, 'Продажі з дорогим CPA');
assert.equal(data.cell(22, 6).value, 'Продажі з дорогим CPA');
assert.equal(data.cell(22, 4).style.setNumberFormat, '0.0%');
data.cell(1, 2).value = false;
data.cell(4, 1).style.setBackground = 'custom';
data.widths[1] = 210;
const many = Array.from({ length: 51 }, (_, i) => product('p' + i, 'Group ' + i, '6 без стат'));
const expanded = ctx.buildReferenceDashboardModel_([a, b, ...many], settings, state);
ctx.writeReferenceDashboardData_(data, expanded);
assert.ok(data.rows > 300, 'expands beyond original grid');
assert.equal(data.cell(4, 1).style.setBackground, 'custom');
assert.equal(data.widths[1], 210);
const rows = ctx.referenceDashboardDataRows_(expanded);
assert.equal(JSON.stringify(data.getRange(2, 1, rows.length, 10).getValues()), JSON.stringify(rows));
assert.equal(data.cell(rows.length, 4).style.setNumberFormat, '0.0%');
ctx.writeReferenceDashboardData_(data, model);
assert.equal(JSON.stringify(data.getRange(2, 1, 22, 10).getValues()), JSON.stringify(ctx.referenceDashboardDataRows_(model)));
assert.equal(data.cell(4, 1).style.setBackground, 'custom');
ctx.writeReferenceDashboardData_(data, ctx.buildReferenceDashboardModel_([], settings, {}));
ctx.writeReferenceDashboardData_(data, model);
assert.equal(data.cell(8, 1).style.setBackground, '#2f5597', 'new blocks after empty catalog are formatted');
const dashboardStart = code.indexOf('  if (settings.enableDashboardData || settings.enableDashboard) {');
const dashboardEnd = code.indexOf('  ensureCoreSheetOrder_', dashboardStart);
const dashboardPass = code.slice(dashboardStart, dashboardEnd);
for (const enableDashboard of [false, true]) {
  for (const enableDashboardData of [false, true]) {
    ctx.settings = { ...settings, enableDashboard, enableDashboardData };
    ctx.outputRows = [a, b]; ctx.merchantProducts = []; ctx.quarantineState = state;
    ctx.sheets = { dashboard: new Sheet(), dashboardData: new Sheet() };
    ctx.getDashboardPeriodStatsMap_ = () => { throw new Error('No obsolete period queries'); };
    vm.runInContext(dashboardPass, ctx);
    assert.equal(ctx.sheets.dashboard.charts.length, enableDashboard ? 4 : 0);
    if (enableDashboard) assert.equal(ctx.sheets.dashboard.cell(29, 5).value, 1);
    if (enableDashboardData) assert.equal(ctx.sheets.dashboardData.cell(22, 8).value, 1);
  }
}
console.log('PASS: Extended dashboard layout, four quarantines, charts, live values, currency, dynamic growth/shrink and preserved formatting');
