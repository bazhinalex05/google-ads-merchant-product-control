const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'script.js'), 'utf8');
const logs = [];
const builder = () => ({requireCheckbox(){return this}, requireValueInList(v){this.options=v;return this}, setAllowInvalid(){return this}, build(){return {...this}}});
const ctx = {Logger:{log:s=>logs.push(s)}, SpreadsheetApp:{newDataValidation:builder, flush(){},
  newRichTextValue:()=>({setText(t){this.text=t;return this},setLinkUrl(u){this.url=u;return this},build(){return {text:this.text,url:this.url}}})},
  Utilities:{formatDate:()=> '19.11.2026'}, AdsApp:{currentAccount:()=>({getTimeZone:()=> 'Europe/Kiev'})}};
vm.createContext(ctx); vm.runInContext(source,ctx);
const plain = v => JSON.parse(JSON.stringify(v));
class Sheet {
  constructor(data=[]){this.data=structuredClone(data);this.hidden=new Set();this.validations={};this.links={};this.writes=0;this.failValidation=false;this.maxRows=1000;}
  getLastRow(){return this.data.length}
  getLastColumn(){return Math.max(0,...this.data.map(r=>r.length))}
  getMaxRows(){return this.maxRows}
  insertRowsAfter(r,n){this.maxRows+=n}
  getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()))}
  isColumnHiddenByUser(c){return this.hidden.has(c)}
  hideColumns(c){this.hidden.add(c)}
  showColumns(c){this.hidden.delete(c)}
  getRange(r,c,h=1,w=1){const s=this;return {
    getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>s.data[r-1+i]?.[c-1+j]??'')),
    getDisplayValues(){return this.getValues()},
    getFormulas(){return this.getValues().map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?v:''))},
    setValues(v){s.writes++;v.forEach((row,i)=>{s.data[r-1+i]??=[];row.forEach((value,j)=>s.data[r-1+i][c-1+j]=value)});return this},
    setValue(v){return this.setValues([[v]])},
    clearContent(){return this.setValues(Array.from({length:h},()=>Array(w).fill('')))},
    setDataValidation(v){if(s.failValidation){s.failValidation=false;throw Error('injected validation failure')}s.validations[r+','+c]=v;return this},
    getDataValidation:()=>s.validations[r+','+c]||null,
    setNumberFormat(){return this},
    setRichTextValue(v){s.links[r+','+c]=v;return this}
  }}
}

// Settings: false, zero, formulas, unknown keys and positions survive; retry after partial migration is idempotent.
const settingsSheet = new Sheet([['key','value','comment'],['priority_label_field','none','manual comment'],['merchant_id','=A99','keep'],['custom',0,'keep'],['enable_products_write',false,'keep']]);
settingsSheet.hidden.add(3);
const original = structuredClone(settingsSheet.data);
const template=[['key','value','comment'],['merchant_id','placeholder','new'],['priority_label_field','none','new'],['enable_products_output',true,'new'],['enable_products_write',true,'new']];
settingsSheet.failValidation=true;
assert.throws(()=>ctx.migrateSettingsInPlace_(settingsSheet,template),/injected/);
ctx.migrateSettingsInPlace_(settingsSheet,template);
ctx.migrateSettingsInPlace_(settingsSheet,template);
assert.deepEqual(settingsSheet.data.slice(0,original.length),original);
assert.equal(settingsSheet.data.length,6);
assert.ok(settingsSheet.hidden.has(3));
assert.ok(settingsSheet.validations['6,2']);
assert.ok(settingsSheet.validations['2,2'].options.includes('product_types_sheet'));

// Source precedence: none cannot touch any source, sheet mode never falls back to Priorities/Merchant.
const product={normId:'a',offerId:'a',productTypes:['Root > Child'],priorityGroup:'merchant'};
const rules=ctx.buildProductTypePriorityRulesFromRows_([{path:['Root'],priorityLabel:'parent'},{path:['Root','Child'],priorityLabel:'child'}],5);
const bomb=new Proxy({}, {get(){throw Error('priority source read')}});
assert.equal(ctx.choosePriorityLabel_(bomb,bomb,bomb,{priorityLabelField:'none'}),'');
assert.equal(ctx.getPriorityGroup_(bomb,{priorityLabelField:'none'}),'');
assert.equal(ctx.getPriorityGroup_(bomb,{priorityLabelField:'product_types_sheet'}),'');
assert.equal(ctx.choosePriorityLabel_(product,rules,bomb,{priorityLabelField:'product_types_sheet',maxLevels:5}),'child');
assert.equal(ctx.choosePriorityLabel_(product,[],bomb,{priorityLabelField:'product_types_sheet',maxLevels:5}),'');
assert.equal(ctx.choosePriorityLabel_(product,rules,{a:'manual'},{priorityLabelField:'custom_label_4',maxLevels:5}),'manual');

// CR uses the same category aggregation; fractional conversions are retained; no clicks is undefined.
const products=[{normId:'a',price:10,productTypes:['Root > Child']},{normId:'b',price:10,productTypes:['Root > Other']}];
const stats=ctx.buildProductTypeStatsMap_(products,{a:{clicks:10,conversions:1.5},b:{clicks:30,conversions:2.5}},5);
const tree=ctx.buildProductTypeTreeRows_(products,{},stats,5);
assert.equal(tree[0].clicks30d,40);assert.equal(tree[0].cr30d,.1);
assert.equal(tree[1].cr30d,.15);
assert.equal(ctx.buildProductTypeTreeRows_(products,{}, {},5)[0].cr30d,'');

// Visibility follows header identity, including a moved user-hidden column.
const view=new Sheet([['a','comment','b']]);view.hidden.add(2);
const visibility=ctx.readColumnVisibility_(view);
ctx.restoreColumnVisibility_(view,['a','b','new','comment'],visibility);
assert.equal(view.hidden.has(2),false);assert.equal(view.hidden.has(4),true);
const links=new Sheet();
ctx.writeCategoryLinks_(links,[{path:['Root'],categoryUrl:'https://example.com/catalog/root'},{path:['Root','Child'],categoryUrl:'javascript:alert(1)'},{path:['Other'],categoryUrl:''}],5);
assert.deepEqual(plain(links.links['2,2']),{text:'Root',url:'https://example.com/catalog/root'});
assert.equal(Object.keys(links.links).length,1);
assert.ok(logs.some(x=>x.includes('CATEGORY_URL_MISSING')));

// Actual build + feed projection: quarantine does not exclude destinations, independent category exclusion remains.
const settings={maxLevels:5,enableFunnelBuilder:false,enableSeasonalityFilter:false,enableProductTypeFilter:false,
  priorityLabelField:'none',priorityOutputAttribute:'none',funnelStageOutputAttribute:'custom_label_3',
  shoppingExcludedValue:'Shopping_Ads',displayExcludedValue:'Display_Ads',defaultBenchmarkGroup:'other',writeChunkSize:100};
const q={a:{reasons:'NO_SALES, TARGET_CPA',activeUntil:'25.11.2026'}};
const build=(active,opts=settings)=>ctx.buildProductsOutputRows_([product],{a:product},{},{allowedPrefixes:[]},{},active,{}, {},[],[],[],[],{},opts);
const idx=ctx.getOutputRowIndexes_(5);
const quarantined=build(q);
assert.equal(quarantined[0][idx.shopping],'');
const feed=new Sheet();assert.equal(ctx.writeProductsSheet_(feed,quarantined,settings),'WRITTEN');
assert.equal(feed.data[1][0],'a');assert.equal(feed.data[1][3],'Карантин — NO_SALES, TARGET_CPA');
assert.equal(feed.data[0].length,4);
ctx.writeProductsSheet_(feed,build({}),settings);assert.ok(!feed.data[1][3].startsWith('Карантин'));
const restricted=build(q,{...settings,enableProductTypeFilter:true});
assert.equal(restricted[0][idx.shopping],'Shopping_Ads');
const oldFeed=new Sheet([['id','excluded_destination','excluded_destination','custom_label_3','custom_label_4'],['old','','','stage','KEEP']]);
const before=structuredClone(oldFeed.data);
assert.equal(ctx.writeProductsSheet_(oldFeed,quarantined,settings),'PRIORITY_MIGRATION_REQUIRED');
assert.deepEqual(oldFeed.data,before);assert.equal(oldFeed.writes,0);
assert.equal(ctx.writeProductsSheet_(oldFeed,quarantined,{...settings,enableProductsOutput:false}),'DISABLED_EMPTY');
assert.ok(oldFeed.data.flat().every(v=>v===''));

// Global clear also precedes dashboard-only early return, regardless of the technical write switch.
const start=source.indexOf('  if (settings.enableProductsOutput === false) {');
const end=source.indexOf('  Logger.log("Sheets ready.");',start);
const dashboardFeed=new Sheet([['id'],['old']]);
vm.runInNewContext(source.slice(start,end),{settings:{enableProductsOutput:false,enableProductsWrite:false,enableDashboardFromDiagnostics:true},sheets:{products:dashboardFeed},Logger:{log(){}}});
assert.ok(dashboardFeed.data.flat().every(v=>v===''));

// Expected diagnostics/log mismatch: bounded history ranks by count, not recency or active state.
const historySheet=new Sheet([['id','quarantine_count','last_added','problematic']]);
ctx.writeQuarantineLogHistory_(historySheet,{old:{offerId:'old',count:10,lastAdded:'01.01.2026'},active:{offerId:'active',count:1,lastAdded:'19.11.2026'}},1,3);
assert.equal(historySheet.data[1][0],'old');assert.equal(historySheet.data.length,2);
// Formula unchanged: zeros influence A, not B; exact comparison boundary is retained.
const threshold=ctx.getDynamicThresholdStats_([0,0,0,70,80,90,100,110,120,130].map(clicks=>({clicks})),'clicks');
assert.deepEqual(plain(threshold),{avgAll:70,avgPositive:100,threshold:85,hasHighSegment:true});
assert.equal(ctx.isHighMetric_(85,threshold),true);assert.equal(ctx.isHighMetric_(84,threshold),false);
assert.equal(ctx.isHighMetric_(100,ctx.getDynamicThresholdStats_([{clicks:0},{clicks:100},{clicks:100}],'clicks')),false);
console.log('PASS: package 12 migration/retry, priority, CR, links, visibility, quarantine feed/exit, preserved exclusions, publication gate and bounded history');
