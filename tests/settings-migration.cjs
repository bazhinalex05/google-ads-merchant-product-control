const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'..','script.js'),'utf8');
const validation=()=>({requireCheckbox(){this.kind='checkbox';return this},requireValueInList(values){this.kind='list';this.values=Array.from(values);return this},setAllowInvalid(v){this.allowInvalid=v;return this},build(){return {...this}}});
const ctx={Logger:{log(){}},SpreadsheetApp:{newDataValidation:validation}};
vm.createContext(ctx);vm.runInContext(source,ctx);
let defaults,template;
const writeTemplate=ctx.writeSettingsTemplate_,migrate=ctx.migrateSettingsInPlace_;
ctx.writeSettingsTemplate_=(sheet,settings)=>{defaults=settings};
ctx.readSettings_({getSheetByName:()=>null,insertSheet:()=>({})});
ctx.writeSettingsTemplate_=writeTemplate;
ctx.migrateSettingsInPlace_=(sheet,rows)=>{template=Array.from(rows,row=>Array.from(row))};
ctx.writeSettingsTemplate_({getLastRow:()=>1},defaults);
ctx.migrateSettingsInPlace_=migrate;
let serial=0;
const record=values=>({id:++serial,values:[...values],notes:{},validation:{},style:{},height:31,hidden:false});
class Sheet {
  constructor(data){this.rows=data.map(record);this.id=711;this.maxRows=1000;this.operations=[];this.fail=null;this.widths=[265,160,1295];}
  checkpoint(name){if(this.fail===name){this.fail=null;throw Error('injected '+name)}}
  getSheetId(){return this.id}
  getMaxColumns(){return 6}
  getMaxRows(){return this.maxRows}
  getLastRow(){return this.rows.length}
  getLastColumn(){return Math.max(3,...this.rows.map(r=>r.values.length))}
  getDataRange(){return this.getRange(1,1,this.rows.length,this.getLastColumn())}
  insertRowsBefore(at,n){this.rows.splice(at-1,0,...Array.from({length:n},()=>record([])));this.maxRows+=n;this.operations.push(['insert',at,n]);this.checkpoint('after-insert')}
  insertRowsAfter(at,n){this.insertRowsBefore(at+1,n)}
  moveRows(range,dest){const start=range.r-1;const moved=this.rows.splice(start,range.h);let index=dest-1;if(start<index)index-=range.h;this.rows.splice(index,0,...moved);this.operations.push(['move',range.r,dest,range.w]);this.checkpoint('after-move')}
  getRange(r,c,h=1,w=1){const sheet=this;return {r,c,h,w,
    getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>sheet.rows[r+i-1]?.values[c+j-1]??'')),
    getNotes:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>sheet.rows[r+i-1]?.notes[c+j]??'')),
    isBlank(){return this.getValues().flat().every(v=>v==='')},
    setNote(v){sheet.rows[r-1].notes[c]=v;sheet.checkpoint('after-note');return this},
    clearNote(){delete sheet.rows[r-1].notes[c];return this},
    setValues(values){sheet.checkpoint('before-values');values.forEach((row,i)=>row.forEach((v,j)=>{sheet.rows[r+i-1].values[c+j-1]=v}));sheet.checkpoint('after-values');return this},
    setDataValidation(v){sheet.checkpoint('validation');sheet.rows[r-1].validation[c]=v;return this},
    getDataValidation:()=>sheet.rows[r-1]?.validation[c]||null,
    clearDataValidations(){for(let j=c;j<c+w;j++)delete sheet.rows[r-1].validation[j];return this},
    setNumberFormat(v){sheet.rows[r-1].style['format'+c]=v;return this},
    setBackground(v){sheet.rows[r-1].style['background'+c]=v;return this},
    setFontWeight(v){sheet.rows[r-1].style['weight'+c]=v;return this},
    setFontColor(v){sheet.rows[r-1].style['color'+c]=v;return this}
  }}
}
const position=(sheet,key)=>sheet.rows.findIndex(r=>r.values[0]===key);
const row=(sheet,key)=>sheet.rows[position(sheet,key)];
const canonical=template.slice(1).map(r=>r[0]);
function verify(sheet){
  const present=sheet.rows.map(r=>r.values[0]).filter(k=>canonical.includes(k));
  assert.deepEqual(present,canonical);
  assert.equal(new Set(present).size,canonical.length);
  assert.equal(sheet.getSheetId(),711);
  assert.deepEqual(sheet.widths,[265,160,1295]);
  assert.ok(!sheet.rows.some(r=>Object.values(r.notes).some(n=>n.startsWith('UMPC_SETTINGS_PENDING:'))));
}
function fixture(){
  const data=template.filter(r=>r[0]!=='enable_products_output').map(r=>[...r]);
  const sheet=new Sheet(data);
  row(sheet,'default_target_cpa').values[1]=0;
  row(sheet,'enable_products_write').values[1]=false;
  row(sheet,'merchant_id').values[1]='=12345+1';
  row(sheet,'priority_label_field').values[1]='none';
  row(sheet,'merchant_id').style={manualColor:'purple'};
  row(sheet,'merchant_id').notes[2]='user note';
  sheet.rows.splice(position(sheet,'enable_product_type_filter'),0,record(['User note','KEEP','','extra column']));
  return sheet;
}
const sheet=fixture();const oldRows=[...sheet.rows];
const oldValues=new Map(oldRows.map(r=>[r.id,JSON.stringify(r.values)]));
const formulaTarget=row(sheet,'merchant_id');const externalReference={target:formulaTarget};const namedRange={target:formulaTarget};
ctx.migrateSettingsInPlace_(sheet,template);verify(sheet);
for(const old of oldRows){assert.ok(sheet.rows.includes(old));assert.equal(JSON.stringify(old.values),oldValues.get(old.id))}
assert.deepEqual(formulaTarget.style,{manualColor:'purple'});assert.equal(formulaTarget.notes[2],'user note');
assert.equal(externalReference.target,namedRange.target);assert.ok(sheet.rows.includes(externalReference.target));
assert.equal(row(sheet,'enable_products_output').validation[2].kind,'checkbox');
assert.equal(row(sheet,'enable_products_output').values[2],template.find(r=>r[0]==='enable_products_output')[2]);
assert.ok(position(sheet,'enable_products_output')>position(sheet,'-- 3. Увімкнення функцій --'));
assert.ok(position(sheet,'enable_products_output')<position(sheet,'enable_product_type_filter'));
const operationCount=sheet.operations.length;ctx.migrateSettingsInPlace_(sheet,template);verify(sheet);assert.equal(sheet.operations.length,operationCount);

// Previously appended setting: same row identity, formula, style, note, validation, hidden flag, extra cells.
const tail=fixture();const moved=record(['enable_products_output','=1=0','custom comment','extra']);
moved.style={color:'purple'};moved.notes[2]='keep';moved.validation[2]={kind:'custom'};moved.hidden=true;tail.rows.push(moved);
ctx.migrateSettingsInPlace_(tail,template);verify(tail);
assert.equal(row(tail,'enable_products_output'),moved);assert.equal(moved.values[1],'=1=0');assert.equal(moved.values[3],'extra');
assert.deepEqual(moved.style,{color:'purple'});assert.equal(moved.notes[2],'keep');assert.equal(moved.validation[2].kind,'custom');assert.equal(moved.hidden,true);
assert.ok(tail.operations.some(o=>o[0]==='move'&&o[3]===6));

// Missing sections/fields get canonical comments, formats and dropdowns without removing unknown rows.
const incomplete=new Sheet([template[0],['merchant_id','123','own'],['custom_setting','KEEP','own']]);
ctx.migrateSettingsInPlace_(incomplete,template);verify(incomplete);
assert.equal(row(incomplete,'custom_setting').values[1],'KEEP');
assert.equal(row(incomplete,'priority_output_attribute').validation[2].kind,'list');
assert.ok(row(incomplete,'priority_output_attribute').validation[2].values.includes('none'));
assert.ok(row(incomplete,'priority_label_field').validation[2].values.includes('product_types_sheet'));
assert.equal(row(incomplete,'-- 3. Увімкнення функцій --').style.background1,ctx.SECTION_BACKGROUND);

// Restart at every write boundary. No duplicate parameter or lost old data; pending formatted row is reused.
for(const point of ['after-insert','after-note','validation','before-values','after-values']){
  const broken=fixture();const existing=[...broken.rows];broken.fail=point;
  assert.throws(()=>ctx.migrateSettingsInPlace_(broken,template),/injected/);
  ctx.migrateSettingsInPlace_(broken,template);verify(broken);
  for(const r of existing)assert.ok(broken.rows.includes(r));
  const count=broken.rows.length;ctx.migrateSettingsInPlace_(broken,template);assert.equal(broken.rows.length,count);
  if(point!=='after-insert')assert.equal(count,existing.length+1);
}
const brokenMove=fixture();brokenMove.rows.push(record(['enable_products_output',false,'keep']));brokenMove.fail='after-move';
assert.throws(()=>ctx.migrateSettingsInPlace_(brokenMove,template),/injected/);ctx.migrateSettingsInPlace_(brokenMove,template);verify(brokenMove);assert.equal(row(brokenMove,'enable_products_output').values[1],false);
const dup=fixture();dup.rows.push(record(['merchant_id','second','']));assert.throws(()=>ctx.migrateSettingsInPlace_(dup,template),/SETTINGS_DUPLICATE_KEY/);assert.equal(dup.operations.length,0);
const reversed=new Sheet([template[0],...template.slice(1).reverse()]);ctx.migrateSettingsInPlace_(reversed,template);verify(reversed);
const editedPending=fixture();editedPending.fail='after-note';assert.throws(()=>ctx.migrateSettingsInPlace_(editedPending,template),/injected/);
const pending=editedPending.rows.find(r=>r.notes[1]?.startsWith('UMPC_SETTINGS_PENDING:'));pending.values[3]='User content after interruption';
assert.throws(()=>ctx.migrateSettingsInPlace_(editedPending,template),/SETTINGS_PENDING_CONFLICT/);assert.equal(pending.values[3],'User content after interruption');
// Actual template/settings reader + native formula generation refer to keys, not fixed row addresses.
const parsed=ctx.readSettings_({getSheetByName:()=>sheet});assert.equal(parsed.enableProductsWrite,false);assert.equal(parsed.defaultTargetCpa,0);assert.equal(parsed.priorityLabelField,'none');
assert.match(ctx.dashboardSettingsBoolFormula_('Settings','enable_funnel_builder'),/VLOOKUP\("enable_funnel_builder"/);
assert.ok(source.includes('MATCH("default_margin_percent",'));
console.log('PASS: Settings canonical blocks, tail relocation, formulas/values/custom rows/styles, dropdowns, ID, duplicates, retries and key-based dependencies (mock; no live Sheets)');
