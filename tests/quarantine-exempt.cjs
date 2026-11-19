const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','script.js'),'utf8');
const ctx={Logger:{log(){}},SpreadsheetApp:{ProtectionType:{SHEET:'sheet'},newDataValidation:()=>({requireCheckbox(){return this},setAllowInvalid(){return this},build(){return {checkbox:true}}})},Utilities:{formatDate:()=> '19.11.2026'},AdsApp:{currentAccount:()=>({getTimeZone:()=> 'Europe/Kiev'})}};
vm.createContext(ctx);vm.runInContext(source,ctx);
class Sheet{
 constructor(data=[]){this.data=structuredClone(data);this.notes={};this.validations={};this.maxCols=100;this.maxRows=1000;this.id=19}
 getLastRow(){let n=this.data.length;while(n&&!(this.data[n-1]||[]).some(v=>v!==''&&v!=null))n--;return n}
 getLastColumn(){return Math.max(0,...this.data.map(r=>{let n=r.length;while(n&&(r[n-1]===''||r[n-1]==null))n--;return n}))}
 getMaxColumns(){return this.maxCols} getMaxRows(){return this.maxRows}
 insertColumnsAfter(c,n){this.maxCols+=n} insertRowsAfter(r,n){this.maxRows+=n}
 getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()))}
 getRange(r,c,h=1,w=1){const s=this;return {
 getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>s.data[r+i-1]?.[c+j-1]??'')),
 getDisplayValues(){return this.getValues().map(row=>row.map(String))},
 setValues(values){values.forEach((row,i)=>{s.data[r+i-1]??=[];row.forEach((v,j)=>s.data[r+i-1][c+j-1]=v)});return this},
 setValue(v){return this.setValues([[v]])},clearContent(){return this.setValues(Array.from({length:h},()=>Array(w).fill('')))},
 setNote(v){s.notes[r+','+c]=v;return this},setDataValidation(v){s.validations[r+','+c]=v;return this},
 setBackground(){return this},setNumberFormat(){return this},getA1Notation:()=>`${r}:${c}:${h}:${w}`
 }}
}
let today=new Date('2026-11-19T00:00:00Z');
ctx.getDateOnly_=()=>today;ctx.formatDate_=d=>d.toISOString().slice(0,10);ctx.parseDateFlexible_=v=>v?new Date(v):null;
ctx.addDays_=(d,n)=>new Date(d.getTime()+n*86400000);
ctx.formatApiDate_=ctx.formatDate_;
const p={offerId:'SKU-A',normId:'sku-a',price:100,productTypes:['Root'],benchmarkGroup:'other'};
const base={maxLevels:5,enableNoSalesRule:false,enableSpendRule:false,enableExpensiveClickRule:false,enableTargetCpaRule:false,
 noSalesLookbackDays:30,spendLookbackDays:30,targetCpaLookbackDays:30,excludeLastDays:2,clicksThreshold:10,
 spendToPriceThreshold:.3,expensiveClickThreshold:2,defaultTargetCpa:10,targetCpaExcessThreshold:.2,
 noSalesQuarantineDays:7,spendQuarantineDays:7,expensiveClickQuarantineDays:7,targetCpaQuarantineDays:7,
 problemThreshold:3,quarantineLogMaxRows:1000,enableFunnelBuilder:true,enableQuarantine:true,
 enableProductTypeFilter:false,enableSeasonalityFilter:false,defaultBenchmarkGroup:'other',
 priorityLabelField:'none',priorityOutputAttribute:'none',funnelStageOutputAttribute:'custom_label_3',
 shoppingExcludedValue:'Shopping_Ads',displayExcludedValue:'Display_Ads',writeChunkSize:100,productDiagnosticsStartRow:1};
let metrics={offerIdOut:p.offerId,clicks:100,impressions:200,cost:500,conversions:0,conversionValue:0,benchmarkGroup:'other'};
ctx.getAdsStatsMap_=()=>({'sku-a':{...metrics}});
ctx.getDateRange_=()=>({start:'2026-10-01',end:'2026-11-17'});
ctx.getQuarantineBatchStats_=()=>({'sku-a':{...metrics}});
const run=(registry,history,settings,lifecycle={})=>ctx.updateQuarantine_(registry,history,{'sku-a':p},[],settings,lifecycle);
for(const rule of ['enableNoSalesRule','enableSpendRule','enableExpensiveClickRule','enableTargetCpaRule']){
 metrics.conversions=rule==='enableTargetCpaRule'?2:0;
 const registry=new Sheet(),history=new Sheet(),settings={...base,[rule]:true,quarantineExemptById:{'sku-a':true}};
 const lifecycle={'sku-a':{wasActive:false,exitDate:''}};
 let state=run(registry,history,settings,lifecycle);
 assert.equal(Object.keys(state.activeById).length,0);assert.equal(history.getLastRow(),1);
 assert.equal(lifecycle['sku-a'].exitDate,'');assert.equal(lifecycle['sku-a'].wasActive,false);
 settings.quarantineExemptById={};state=run(registry,history,settings,lifecycle);
 assert.ok(state.activeById['sku-a'],rule+' must work again');assert.equal(state.registryMap['sku-a'].count,1);
 assert.equal(lifecycle['sku-a'].exitDate,''); // merely unchecking is not an exit
}
metrics.conversions=0;
const registry=new Sheet(),history=new Sheet(),settings={...base,enableNoSalesRule:true};
let state=run(registry,history,settings);assert.equal(state.registryMap['sku-a'].count,1);
// Real active product: release once, retain count and last_added, restore ordinary stage.
const before=JSON.stringify(history.data);const lifecycle={'sku-a':{wasActive:true,exitDate:''}};
settings.quarantineExemptById={'sku-a':true};state=run(registry,history,settings,lifecycle);
assert.equal(Object.keys(state.activeById).length,0);assert.equal(lifecycle['sku-a'].exitDate,'2026-11-19');assert.equal(JSON.stringify(history.data),before);
state=run(registry,history,settings,lifecycle);assert.equal(lifecycle['sku-a'].exitDate,'2026-11-19');assert.equal(JSON.stringify(history.data),before);
settings.quarantineExemptById={};state=run(registry,history,settings,lifecycle);
assert.equal(Object.keys(state.activeById).length,0); // existing release window excludes pre-release data
today=new Date('2026-11-25T00:00:00Z');ctx.getDateRange_=()=>({start:'2026-10-25',end:'2026-11-23'});
state=run(registry,history,settings,lifecycle);assert.equal(state.registryMap['sku-a'].count,2);
// An inactive product's real earlier exit stays exactly unchanged while toggling.
const staleLife={'sku-a':{wasActive:false,exitDate:'2026-09-01'}};
run(new Sheet(registry.data.map(row=>row.slice())),new Sheet(history.data.map(row=>row.slice())),{...settings,quarantineExemptById:{'sku-a':true}},staleLife);
assert.equal(staleLife['sku-a'].exitDate,'2026-11-25'); // active registry overrides stale inactive diagnostics
const past={'sku-a':{wasActive:false,exitDate:'2026-09-01'}};
run(new Sheet(),new Sheet(),{...base,quarantineExemptById:{'sku-a':true}},past);assert.equal(past['sku-a'].exitDate,'2026-09-01');

// Feed/attribution/category/seasonality: exemption is confined to quarantine.
settings.quarantineExemptById={'sku-a':true};
const idx=ctx.getOutputRowIndexes_(5);
const build=(opts=settings,seasons={})=>ctx.buildProductsOutputRows_([p],{'sku-a':p},{},{allowedPrefixes:[]},{'sku-a':metrics},
 {'sku-a':{reasons:'NO_SALES',activeUntil:'2026-12-01'}},{lifecycle},seasons,[],[],[],[],{},opts);
const rows=build();assert.equal(rows[0][idx.quarantineActive],'');assert.equal(rows[0][idx.shopping],'');assert.equal(rows[0][idx.id],'SKU-A');
const expectedStage=ctx.calculateFunnelRows_({'sku-a':metrics},settings,{'sku-a':p})['sku-a'].funnelStage;
assert.equal(rows[0][idx.funnelStage],expectedStage);
const feed=new Sheet();ctx.writeProductsSheet_(feed,rows,settings);assert.equal(feed.data[1][3],expectedStage);
assert.equal(build({...settings,enableProductTypeFilter:true})[0][idx.shopping],'Shopping_Ads');
assert.equal(build({...settings,enableSeasonalityFilter:true},{'sku-a':{manualWinter:true}})[0][idx.shopping],'Shopping_Ads');

// New checkbox is appended; legacy indexes/attribution shape remain unchanged. State follows normalized ID.
const diag=new Sheet();ctx.writeProductDiagnosticsSheet_(diag,rows,settings);
assert.equal(diag.data[0].at(-1),'quarantine_exempt');assert.equal(diag.data[1].at(-1),true);
assert.equal(rows[0].length,ctx.getDiagnosticsSourceHeader_(5).length);
assert.equal(ctx.readDashboardSourceFromDiagnostics_(diag,settings).outputRows[0].length,rows[0].length);
const normalized=new Sheet([['id','quarantine_exempt'],[' SKU-A ',true],['sku-b',false]]);
assert.equal(ctx.readQuarantineExemptions_(normalized)['sku-a'],true);
const rowB=Array.from(rows[0]);rowB[0]='sku-b';
const snapshot=ctx.readQuarantineExemptions_(diag);
// Add an unrelated formula column; full and partial writes must not overwrite it.
diag.data[0].push('user_formula');diag.data[1].push('=1+2');const customCol=diag.data[0].indexOf('user_formula');
ctx.writeProductDiagnosticsSheet_(diag,[rowB,rows[0]],{...settings,quarantineExemptById:snapshot});
assert.equal(diag.data[1][customCol],'=1+2');assert.equal(diag.data[1][diag.data[0].indexOf('quarantine_exempt')],false);
assert.equal(diag.data[2][diag.data[0].indexOf('quarantine_exempt')],true);
diag.data.splice(1,2,diag.data[2],diag.data[1]); // manual row reorder
assert.equal(ctx.readQuarantineExemptions_(diag)['sku-a'],true);
const readFlagLine=source.slice(source.indexOf('  settings.quarantineExemptById ='),source.indexOf('  if (settings.enableDashboardFromDiagnostics)'));
const live={settings:{enablePreviousStateRead:false,enableProductDiagnostics:false},sheets:{productDiagnostics:diag},readQuarantineExemptions_:ctx.readQuarantineExemptions_};
vm.runInNewContext(readFlagLine,live);assert.equal(live.settings.quarantineExemptById['sku-a'],true);
ctx.writeQuarantineLifecycle_(diag,[rowB,rows[0]],5,live.settings.quarantineExemptById);
assert.equal(ctx.readQuarantineExemptions_(diag)['sku-a'],true);
ctx.writeProductDiagnosticsSheet_(diag,[rowB,rows[0]],{...settings,productDiagnosticsStartRow:2,quarantineExemptById:snapshot});
assert.equal(ctx.readQuarantineExemptions_(diag)['sku-a'],true);assert.equal(diag.data[2][customCol],'=1+2');
// Dashboard-only ignores flagged stale quarantine but keeps normal analytics and never writes the checkbox.
const physical=diag.data[0];diag.data[2][physical.indexOf('quarantine_active')]='YES';diag.data[2][physical.indexOf('quarantine_reasons')]='NO_SALES';
const beforeDashboard=JSON.stringify(diag.data);const dashboard=ctx.readDashboardSourceFromDiagnostics_(diag,settings);
assert.equal(dashboard.outputRows.find(r=>r[0]==='SKU-A')[idx.quarantineActive],'');assert.equal(JSON.stringify(diag.data),beforeDashboard);
// Full catalog removal drops the flag with the removed ID, no independent storage.
ctx.writeProductDiagnosticsSheet_(diag,[rowB],{...settings,quarantineExemptById:snapshot});assert.equal(ctx.readQuarantineExemptions_(diag)['sku-a'],undefined);
// Bounded history must not erase the exempt product's only remaining counter.
const capped=new Sheet([['id','quarantine_count','last_added','problematic']]);
ctx.writeQuarantineLogHistory_(capped,{'top':{offerId:'top',count:10,lastAdded:'2026-01-01'},'sku-a':{offerId:'SKU-A',count:2,lastAdded:'2026-11-19'}},1,3,{'sku-a':true});
assert.equal(ctx.readQuarantineHistoryMap_(capped,{})['sku-a'].count,2);assert.equal(capped.getLastRow(),3);
// Own sheet protection opens only checkbox range and preserves already-open ranges.
const other={getA1Notation:()=> 'A2:A5'},manual={getA1Notation:()=> 'BZ2:BZ1000'};let ranges=[other];
const protection={getDescription:()=> 'Unified Product Control: службовий лист',canEdit:()=>true,setWarningOnly(){},getEditors:()=>[],canDomainEdit:()=>false,getUnprotectedRanges:()=>ranges,setUnprotectedRanges(v){ranges=v}};
ctx.ensureUnifiedSheetProtection_({getProtections:()=>[protection]},'',manual);assert.equal(ranges.length,2);assert.equal(ranges[0],other);
ctx.ensureUnifiedSheetProtection_({getProtections:()=>[protection]},'',manual);assert.equal(ranges.length,2);
console.log('PASS: exemption for all rules, real/no synthetic exits, history/counts/resume, feed identity/stage, other exclusions, reorder/full/partial/minimal diagnostics, dashboard, custom formulas and checkbox access');
