const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = {Logger:{log(){}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..','script.js'),'utf8'),ctx);
const activeHeader=['id','quarantine_count','reason_no_sales','reason_spend_over_margin','reason_expensive_click','problematic','active_until','no_sales_until','spend_until','expensive_click_until','last_added','reason_target_cpa','target_cpa_until'];
const historyHeader=['id','quarantine_count','last_added','problematic'];
function workbook(names) {
  const book={sheets:[],renames:0,creates:0,getSheets(){return this.sheets},getSheetByName(n){return this.sheets.find(s=>s.name===n)||null},insertSheet(n){this.creates++;return add(n,[])}};
  function add(name,data){const sheet={name,data,id:book.sheets.length+1,getName(){return this.name},getSheetId(){return this.id},setName(n){book.renames++;this.name=n},getLastRow(){return this.data.length},getLastColumn(){return this.data[0]?.length||0},getRange(){return {getValues:()=>[this.data[0]]}}};book.sheets.push(sheet);return sheet}
  names.forEach(([n,h])=>add(n,[h,['sku','retained data']]));return book;
}
const settings=()=>({quarantineRegistrySheetName:'Quarantine Active Now',quarantineLogSheetName:'Quarantine History'});
const book=workbook([['QuarantineRegistry',activeHeader],['QuarantineLog',historyHeader]]);
const original=book.sheets.map(s=>JSON.stringify(s.data));
let result=ctx.prepareQuarantineSheets_(book,settings());
assert.equal(result.active.getSheetId(),1);assert.equal(result.history.getSheetId(),2);
assert.equal(result.active.getName(),'Quarantine Active Now');assert.equal(result.history.getName(),'Quarantine History');
assert.deepEqual(book.sheets.map(s=>JSON.stringify(s.data)),original);
ctx.prepareQuarantineSheets_(book,settings());assert.equal(book.renames,2);assert.equal(book.creates,0);
const conflict=workbook([['QuarantineRegistry',activeHeader],['QuarantineLog',historyHeader],['Quarantine History',historyHeader]]);
assert.throws(()=>ctx.prepareQuarantineSheets_(conflict,settings()),/NAME_CONFLICT/);assert.equal(conflict.renames,0);assert.equal(conflict.creates,0);
const custom=workbook([['Client active',activeHeader],['Client history',historyHeader]]);
const config=settings();result=ctx.prepareQuarantineSheets_(custom,config);
assert.equal(config.quarantineRegistrySheetName,'Client active');assert.equal(custom.renames,0);assert.equal(custom.creates,0);
const duplicate=workbook([['Copy 1',activeHeader],['Copy 2',activeHeader]]);
assert.throws(()=>ctx.prepareQuarantineSheets_(duplicate,settings()),/NAME_CONFLICT/);assert.equal(duplicate.creates,0);
const explicit=workbook([['Mine',activeHeader],['History',historyHeader]]);
ctx.prepareQuarantineSheets_(explicit,{quarantineRegistrySheetName:'Mine',quarantineLogSheetName:'History'});assert.equal(explicit.renames,0);
const fresh=workbook([]);ctx.prepareQuarantineSheets_(fresh,settings());assert.equal(fresh.creates,2);
// Retry after only the first rename succeeds keeps both identities and values.
const partial=workbook([['QuarantineRegistry',activeHeader],['QuarantineLog',historyHeader]]);
const rename=partial.sheets[1].setName;partial.sheets[1].setName=()=>{throw Error('injected rename failure')};
assert.throws(()=>ctx.prepareQuarantineSheets_(partial,settings()),/injected/);
partial.sheets[1].setName=rename;result=ctx.prepareQuarantineSheets_(partial,settings());
assert.equal(result.active.getSheetId(),1);assert.equal(result.history.getSheetId(),2);assert.equal(partial.creates,0);
// Confirm current registry semantics and preservation of expired counts in history before writing.
ctx.isDateActive_=(value,today)=>value>=today;
const map={active:{...ctx.makeEmptyQuarantineEntry_('active'),count:2,activeUntil:'2026-11-20'},expired:{...ctx.makeEmptyQuarantineEntry_('expired'),count:7,activeUntil:'2026-11-18'}};
const history=ctx.readQuarantineHistoryMap_({getLastRow:()=>0,getLastColumn:()=>0},map);
assert.equal(history.expired.count,7);
let written=[];ctx.writeQuarantineRegistry_({getLastRow:()=>1,getRange(){return {setValues(v){written=v;return this},setNumberFormat(){return this}}}},map,'2026-11-19');
assert.equal(written.length,1);assert.equal(written[0][0],'active');assert.equal(map.expired.count,7);
console.log('PASS: quarantine names preserve IDs/data, repeat/retry, conflicts, custom names, active-only registry and historical counters');
