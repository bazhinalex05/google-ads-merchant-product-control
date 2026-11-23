const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'script.js'), 'utf8');
const data = new Map();
let generation = 0;
let failWrite = false;
const props = {
  getProperty: k => data.has(k) ? data.get(k) : null,
  setProperty(k, v) { data.set(k, v); },
  deleteProperty(k) { data.delete(k); },
  setProperties(values) { if (failWrite) throw Error('storage unavailable'); for (const [k,v] of Object.entries(values)) data.set(k,v); }
};
const ctx = { PropertiesService: {getScriptProperties: () => props}, Utilities: {getUuid: () => String(++generation)},
  SpreadsheetApp: {ProtectionType: {SHEET:'SHEET', RANGE:'RANGE'}}, Logger:{log(){}},
  Session: {getEffectiveUser: () => ({getEmail: () => 'owner@example.test'})} };
vm.createContext(ctx); vm.runInContext(source, ctx);
const user = email => ({getEmail:()=>email});
class Protection {
  constructor(sheet, type, range='') { Object.assign(this,{sheet,type,range,description:'',warning:false,editors:['owner@example.test','extra@example.test'],domain:false,audiences:[],unprotected:[],editable:true,rangeName:''}); }
  getDescription(){return this.description} setDescription(v){this.description=v;return this}
  canEdit(){return this.editable} remove(){this.sheet.protections.splice(this.sheet.protections.indexOf(this),1)}
  isWarningOnly(){return this.warning} setWarningOnly(v){this.warning=v;return this}
  getEditors(){return this.editors.map(user)}
  addEditor(v){this.editors=[...new Set([...this.editors,v])];return this}
  addEditors(v){v.forEach(x=>this.addEditor(x));return this}
  removeEditors(v){const emails=v.map(x=>typeof x==='string'?x:x.getEmail());this.editors=this.editors.filter(e=>!emails.includes(e));return this}
  canDomainEdit(){return this.domain} setDomainEdit(v){this.domain=v;return this}
  getTargetAudiences(){return this.audiences.map(id=>({getAudienceId:()=>id}))}
  addTargetAudience(id){this.audiences=[...new Set([...this.audiences,id])];return this}
  removeTargetAudience(id){this.audiences=this.audiences.filter(x=>x!==id);return this}
  getRange(){return this.sheet.getRange(this.range)}
  getRangeName(){return this.rangeName} setRangeName(v){this.rangeName=v;return this}
  getUnprotectedRanges(){return this.unprotected.map(a1=>this.sheet.getRange(a1))}
  setUnprotectedRanges(v){this.unprotected=v.map(x=>x.getA1Notation());return this}
}
class Sheet {
  constructor(id,name){Object.assign(this,{id,name,protections:[],rows:[['enable_sheet_protection',false,'new mode']]})}
  getSheetId(){return this.id} getName(){return this.name}
  getDataRange(){return {getValues:()=>this.rows}}
  getProtections(type){return this.protections.filter(p=>p.type===type)}
  protect(){const p=new Protection(this,'SHEET');this.protections.push(p);return p}
  getRange(a1,col){return {getA1Notation:()=>a1, setValue:v=>{this.rows[a1-1][col-1]=v}, protect:()=>{const p=new Protection(this,'RANGE',a1);this.protections.push(p);return p}}}
}
const settingsSheet=new Sheet(1,'Settings');
const sheet=new Sheet(2,'Products');
const ss={getId:()=> 'test-sheet',getSheets:()=>[settingsSheet,sheet],getSheetByName:()=>settingsSheet};
const enabled={enableSheetProtection:true};
// Brand-new tables create no protections, even when remembering is enabled without manual locks.
ctx.prepareManualProtectionMode_(ss,{enableSheetProtection:false});
ctx.protectManagedSheets_(ss,enabled);assert.equal(sheet.protections.length,0);
// Capture custom editors, domain/audience permissions and editable exceptions without modifying the original.
const lock=sheet.protect().setDescription('Manual financial data');
Object.assign(lock,{editors:['owner@example.test','colleague@example.test'],domain:true,audiences:['team'],unprotected:['B2:B100']});
const range=sheet.getRange('D2:F12').protect().setDescription('Warning');range.warning=true;range.rangeName='Input';
ctx.protectManagedSheets_(ss,enabled);assert.equal(sheet.protections[0],lock);
lock.remove();range.remove();ctx.protectManagedSheets_(ss,enabled);
assert.equal(sheet.protections.length,2);
const restored=sheet.protections.find(p=>p.type==='SHEET');
assert.deepEqual([...restored.editors].sort(),['colleague@example.test','owner@example.test']);
assert.equal(restored.domain,true);assert.deepEqual([...restored.audiences],['team']);
assert.deepEqual([...restored.unprotected],['B2:B100']);
assert.equal(sheet.protections.find(p=>p.type==='RANGE').warning,true);
assert.equal(sheet.protections.find(p=>p.type==='RANGE').rangeName,'Input');
ctx.protectManagedSheets_(ss,enabled);assert.equal(sheet.protections.length,2);
// Manual edits and sheet renames become the new baseline, not the old one.
restored.editors=['owner@example.test'];restored.unprotected=['C2:C20'];sheet.name='Renamed';
ctx.protectManagedSheets_(ss,enabled);restored.remove();ctx.protectManagedSheets_(ss,enabled);
assert.deepEqual([...sheet.protections.find(p=>p.type==='SHEET').unprotected],['C2:C20']);
// Turning the option off forgets the baseline; existing manual locks remain until manually removed.
ctx.prepareManualProtectionMode_(ss,{enableSheetProtection:false});
assert.equal(sheet.protections.length,2);sheet.protections=[];
ctx.protectManagedSheets_(ss,enabled);assert.equal(sheet.protections.length,0);
// Old automatic locks are removed and old true is reset. Unrelated manual locks survive migration.
data.clear();settingsSheet.rows=[['enable_sheet_protection',true,'false = не оновлювати захист службових листів.']];
sheet.protect().setDescription('Unified Product Control: службовий лист');
sheet.getRange('A1:A10').protect().setDescription('Seasonality final formulas');
sheet.protect().setDescription('User lock');
const migrated={enableSheetProtection:true};ctx.prepareManualProtectionMode_(ss,migrated);
assert.equal(migrated.enableSheetProtection,false);assert.equal(settingsSheet.rows[0][1],false);
assert.deepEqual(sheet.protections.map(p=>p.description),['User lock']);
// No permission means explicit failure, no claim that migration completed.
data.clear();const denied=sheet.protect().setDescription('Unified Product Control: службовий лист');denied.editable=false;
assert.throws(()=>ctx.prepareManualProtectionMode_(ss,enabled),/Немає прав/);assert.equal(props.getProperty(ctx.manualProtectionPrefix_(ss)+':migrated'),null);
sheet.protections=[];
// Large snapshots are chunked; a failed save keeps the previous complete baseline.
const large=[{description:'Ж'.repeat(15000)}];ctx.writeManualProtectionState_(ss,large);
assert.equal(ctx.readManualProtectionState_(ss)[0].description,large[0].description);
for(const [key,value] of data) if(!key.endsWith(':migrated')) assert.ok(Buffer.byteLength(value,'utf8')<9000);
failWrite=true;assert.throws(()=>ctx.writeManualProtectionState_(ss,[]),/storage unavailable/);failWrite=false;
assert.equal(ctx.readManualProtectionState_(ss)[0].description,large[0].description);
assert.match(source,/enableSheetProtection: false/);
assert.doesNotMatch(source,/if \(settings(?: && settings)?\.enableSheetProtection\) removeProtectionsForSheet_/);
console.log('PASS: manual protection baseline, restoration, permissions, migration, opt-out and persistent storage');
