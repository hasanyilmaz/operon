import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
 stdin: { contents: "export * from './src/ui/modal-backdrop';export * from './src/core/lightbox-size';export {preflightOperonSettingsResetDefaultsV1} from './src/core/settings-reset-default-profile';export * from './src/core/background-dimming';export {Platform} from 'obsidian';export {migrateSettings,DEFAULT_SETTINGS} from './src/types/settings';export {buildOperonDataPackageFromSettings,composeOperonSettingsFromDataPackage} from './src/storage/operon-data-package';export {OPERON_SETTINGS_SEARCH_REGISTRY} from './src/ui/settings/settings-search-registry';export {exportOperonSettingsBackupJsonV1} from './src/core/settings-backup-export';export {validateOperonSettingsBackupGroupsV1} from './src/core/settings-backup-group-validation';export {buildOperonSettingsBackupSelectedPatchV1} from './src/core/settings-backup-apply';export {getSettingsBackupCompatibilityForKey} from './src/core/settings-backup-compatibility';", resolveDir: root },
 bundle: true, write: false, format: 'esm', platform: 'node',
 plugins: [{ name: 'platform', setup(b) {
  b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'platform', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const Platform={isDesktopApp:true};export function normalizePath(p){return p;}export class TFile{}' }));
 } }],
});
const { preflightOperonSettingsResetDefaultsV1, LIGHTBOX_SIZE_PROFILES, normalizeLightboxSizes, bindLightboxSizePreference, getLightboxControlSide, getLightboxProfileSize, saveLightboxProfileSize, bindDesktopBackdropDimmingPreference, subscribeDesktopBackdropDimming, stepDesktopBackdropDimming, saveDesktopBackdropDimming, canSaveDesktopBackdropDimming, getDesktopBackdropDimming, disposeDesktopBackdrops, normalizeBackgroundDimming, BACKGROUND_DIMMING_OPTIONS, applyDesktopModalBackdrop, Platform, migrateSettings, DEFAULT_SETTINGS, buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage, OPERON_SETTINGS_SEARCH_REGISTRY, getSettingsBackupCompatibilityForKey, exportOperonSettingsBackupJsonV1, validateOperonSettingsBackupGroupsV1, buildOperonSettingsBackupSelectedPatchV1 } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function container() {
 const classes = new Set(['modal-container']);
 return { ownerDocument: {}, classes, addClass: c => classes.add(c), removeClass: c => classes.delete(c) };
}

test('desktop owns only the supplied container; detached cleanup and repeated cleanup are safe', () => {
 const a = container(), b = container();
 const closeA = applyDesktopModalBackdrop(a), closeB = applyDesktopModalBackdrop(b);
 assert.ok(a.classes.has('operon-focus-modal'));
 closeA(); assert.equal(a.classes.has('operon-focus-modal'), false); assert.ok(b.classes.has('operon-focus-modal'));
 const reopened = applyDesktopModalBackdrop(a);
 closeA(); assert.ok(a.classes.has('operon-focus-modal'), 'late old cleanup cannot affect reopened owner');
 reopened(); closeB(); assert.deepEqual([...a.classes], ['modal-container']); assert.deepEqual([...b.classes], ['modal-container']);
});
test('mobile is a no-op including close, with no DOM operations', () => {
 Platform.isDesktopApp = false;
 try { const close = applyDesktopModalBackdrop({}); close(); close(); } finally { Platform.isDesktopApp = true; }
});
function methodSource(source, name) {
 const tree=ts.createSourceFile('modal.ts',source,ts.ScriptTarget.Latest,true),methods=[];
 function visit(node){if(ts.isMethodDeclaration(node)&&node.name?.getText(tree)===name)methods.push(node.getText(tree));ts.forEachChild(node,visit);}
 visit(tree);assert.equal(methods.length,1,`Expected one ${name} lifecycle method`);return methods[0];
}

for (const name of ['creator', 'finder', 'editor']) test(`${name} modal installs and releases the effect at native open/close and owner-window migration`, () => {
 const source = readFileSync(path.join(root, `src/ui/task-${name}-modal.ts`), 'utf8');
 assert.equal(source.match(/applyDesktopModalBackdrop\(this.containerEl\)/g)?.length, 2);
 const open = methodSource(source,'onOpen'), migrated = methodSource(source,'bindViewportWindow');
 assert.equal(open.match(/applyDesktopModalBackdrop\(this.containerEl\)/g)?.length,1);
 assert.equal(migrated.match(/applyDesktopModalBackdrop\(this.containerEl\)/g)?.length,1);
 assert.match(migrated,/if \(old\) \{\s*this.backdropCleanup\?\.\(\);\s*this.backdropCleanup = applyDesktopModalBackdrop\(this.containerEl\)/);
 assert.match(open, /this.backdropCleanup\?\.\(\);\s*this.backdropCleanup = applyDesktopModalBackdrop\(this.containerEl\)/);
 assert.match(source, /onClose\(\): void \{\s*this.backdropCleanup\?\.\(\);\s*this.backdropCleanup = null;/);
});
test('non-modal Editor content never opts in', () => {
 const source = readFileSync(path.join(root, 'src/ui/task-editor-content.ts'), 'utf8');
 assert.doesNotMatch(source, /applyDesktopModalBackdrop|operon-focus-modal/);
});

for (const value of [10,20,30,35,40,45,50,55,60,65,70,80,90]) test(`dimming ${value} survives real normalization and canonical package round-trip`, () => {
 const settings=migrateSettings({...DEFAULT_SETTINGS,workspaceTweaksBackgroundDimming:value});
 const pack=buildOperonDataPackageFromSettings(settings);
 assert.equal(pack.ui.workspaceTweaks.workspaceTweaksBackgroundDimming,value);
 assert.equal(composeOperonSettingsFromDataPackage(JSON.parse(JSON.stringify(pack)),DEFAULT_SETTINGS).workspaceTweaksBackgroundDimming,value);
 assert.equal(getSettingsBackupCompatibilityForKey('workspaceTweaksBackgroundDimming').support,'portable');
});
test('new and invalid preferences use 50; saved preferences remain unchanged without mutating their input',()=>{
 for(const value of [undefined,null,'80',57,100,NaN]) {
  const raw={...DEFAULT_SETTINGS,workspaceTweaksBackgroundDimming:value};
  assert.equal(migrateSettings(raw).workspaceTweaksBackgroundDimming,50);
  assert.ok(Object.is(raw.workspaceTweaksBackgroundDimming,value));
 }
 const raw={...DEFAULT_SETTINGS}; delete raw.workspaceTweaksBackgroundDimming;
 assert.equal(migrateSettings(raw).workspaceTweaksBackgroundDimming,50);
});
test('dimming is searchable in Tweaks with one dropdown definition',()=>{
 const entries=OPERON_SETTINGS_SEARCH_REGISTRY.filter(e=>e.key==='workspaceTweaksBackgroundDimming');
 assert.equal(entries.length,1);assert.equal(entries[0].control,'dropdown');
 assert.ok(JSON.stringify(entries[0]).includes('interfaceTweaks'));
 for(const word of ['lightbox','opacity','backdrop','modal'])assert.ok(JSON.stringify(entries[0]).includes(word));
});

test('real portable export decode and selected restore patch preserve dimming',()=>{
 const settings=migrateSettings({...DEFAULT_SETTINGS,workspaceTweaksBackgroundDimming:80});
 const exported=exportOperonSettingsBackupJsonV1({settings,source:{pluginVersion:'4.0.1',obsidianVersion:'1.14.4',dataPackageSchemaVersion:3},createdAt:'2026-10-19T12:00:00.000Z'});
 assert.ok(exported.ok,JSON.stringify(exported));
 const decoded=validateOperonSettingsBackupGroupsV1(exported.backup.body.groups);
 assert.ok(decoded.ok,JSON.stringify(decoded));
 assert.equal(decoded.payloads.general.workspaceTweaksBackgroundDimming,80);
 const patch=buildOperonSettingsBackupSelectedPatchV1({selectedGroups:['general'],candidateSettings:{...DEFAULT_SETTINGS,...decoded.payloads.general}});
 assert.equal(patch.workspaceTweaksBackgroundDimming,80);
 assert.equal(migrateSettings({...settings,workspaceTweaksBackgroundDimming:DEFAULT_SETTINGS.workspaceTweaksBackgroundDimming}).workspaceTweaksBackgroundDimming,50);
});

// Compile the actual Settings methods, without constructing the whole Obsidian settings window.
function settingsProbe(save=async()=>false) {
 const source=readFileSync(path.join(root,'src/ui/settings-tab.ts'),'utf8');
 const ast=ts.createSourceFile('settings-tab.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const methods=[];
 function visit(node){
  if(ts.isMethodDeclaration(node)&&['setControlValue','getSettingsSearchDropdownOptions'].includes(node.name.getText(ast)))methods.push(node.getText(ast));
  ts.forEachChild(node,visit);
 }
 visit(ast);assert.equal(methods.length,2);
 const js=ts.transpileModule(`class Probe {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const Probe=new Function('normalizeBackgroundDimming','BACKGROUND_DIMMING_OPTIONS','isTaskCardSetting','saveDesktopBackdropDimming','t',`${js};return Probe;`)(normalizeBackgroundDimming,BACKGROUND_DIMMING_OPTIONS,()=>false,save,(_category,key)=>key==='workspaceTweaksBackgroundDimmingDefault'?'50% — Default':key);
 const probe=new Probe();
 probe.settings={workspaceTweaksBackgroundDimming:70};
 probe.findSettingsSearchEntryByKey=key=>OPERON_SETTINGS_SEARCH_REGISTRY.find(e=>e.key===key);
 probe.normalizeSettingsSearchControlValue=(_entry,value)=>value;
 probe.refreshBackgroundDimmingState=()=>{probe.redraws++;};probe.updateNativeSettingsDefinitions=()=>{probe.redraws++;};probe.redraws=0;
 probe.applySettingsSearchAfterSaveEffects=()=>{probe.published++;};probe.published=0;
 return probe;
}
test('actual Settings dropdown and setter save numeric choice then publish; failures restore prior choice',async()=>{
 const probe=settingsProbe();
 assert.deepEqual(Object.entries(probe.getSettingsSearchDropdownOptions('workspaceTweaksBackgroundDimming')),BACKGROUND_DIMMING_OPTIONS.map(value=>[String(value),value===50?'50% — Default':`${value}%`]));
 let writes=0;probe.saveSettings=async()=>{writes++;assert.equal(probe.published,0);};
 await probe.setControlValue('workspaceTweaksBackgroundDimming','80');
 assert.equal(writes,1);assert.equal(probe.settings.workspaceTweaksBackgroundDimming,80);assert.equal(probe.published,1);
 probe.saveSettings=async()=>{throw Error('storage rejected');};
 await assert.rejects(probe.setControlValue('workspaceTweaksBackgroundDimming','90'),/storage rejected/);
 assert.equal(probe.settings.workspaceTweaksBackgroundDimming,80);assert.equal(probe.published,1);assert.equal(probe.redraws,1);
});

test('only the standalone Subtasks modal joins dimming, not the file filter or Editor popover', () => {
 const source = readFileSync(path.join(root, 'src/ui/subtasks-filter-modal.ts'), 'utf8');
 assert.equal(source.match(/applyDesktopModalBackdrop\(this.containerEl\)/g)?.length, 2);
 for(const lifecycle of ['onOpen','bindViewportWindow']) {
  const method=methodSource(source,lifecycle);
  assert.equal(method.match(/applyDesktopModalBackdrop\(this.containerEl\)/g)?.length,1);
  assert.match(method,/this.options.fileTaskPath \? null : applyDesktopModalBackdrop\(this.containerEl\)/);
 }
 assert.match(source, /onClose\(\): void \{\s*this.backdropCleanup\?\.\(\);\s*this.backdropCleanup = null;/);
 assert.doesNotMatch(source.slice(source.indexOf('export function showSubtasksFilterPopover')), /applyDesktopModalBackdrop|registerDesktopBackdrop/);
 assert.doesNotMatch(readFileSync(path.join(root,'src/ui/dynamic-file-task-filter.ts'),'utf8'), /applyDesktopModalBackdrop|registerDesktopBackdrop/);
});

function preferenceFixture(initial=50) {
 disposeDesktopBackdrops();
 let value=initial;const writes=[];const observed=[];
 const binding={get:()=>value,save:async next=>{writes.push(next);value=next;}};
 const release=bindDesktopBackdropDimmingPreference(binding);
 const unsubscribe=subscribeDesktopBackdropDimming(()=>observed.push(getDesktopBackdropDimming()));
 return {binding,writes,observed,release,unsubscribe,get value(){return value;},set value(next){value=next;},done(){unsubscribe();release();disposeDesktopBackdrops();}};
}
test('rapid steps use every next defined option and share order with explicit Settings choices',async()=>{
 const f=preferenceFixture();try{
  await Promise.all([stepDesktopBackdropDimming(1),stepDesktopBackdropDimming(1),stepDesktopBackdropDimming(1)]);
  assert.deepEqual(f.writes,[55,60,65]);assert.equal(f.value,65);
  await Promise.all([saveDesktopBackdropDimming(30),stepDesktopBackdropDimming(1),stepDesktopBackdropDimming(-1)]);
  assert.deepEqual(f.writes,[55,60,65,30,35,30]);assert.equal(getDesktopBackdropDimming(),30);
 }finally{f.done();}
});
test('endpoint steps are zero-write no-ops and saved 70 stays 70 on bind',async()=>{
 const f=preferenceFixture(70);try{
  assert.equal(getDesktopBackdropDimming(),70);
  await saveDesktopBackdropDimming(10);await stepDesktopBackdropDimming(-1);
  await saveDesktopBackdropDimming(90);await stepDesktopBackdropDimming(1);
  assert.deepEqual(f.writes,[10,90]);
 }finally{f.done();}
});
test('pending save keeps the committed indicator and failed save does not poison later requests',async()=>{
 const f=preferenceFixture();try{
  let release;f.binding.save=async()=>{await new Promise(resolve=>{release=resolve;});throw Error('save failed');};
  const pending=stepDesktopBackdropDimming(1);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(getDesktopBackdropDimming(),50);assert.equal(f.value,50);
  release();await assert.rejects(pending,/save failed/);assert.equal(getDesktopBackdropDimming(),50);
  f.binding.save=async next=>{f.value=next;};await stepDesktopBackdropDimming(1);assert.equal(f.value,55);
 }finally{f.done();}
});
test('unload cancels queued changes and closes subscriptions without writing from open or render',async()=>{
 const f=preferenceFixture();assert.deepEqual(f.writes,[]);
 const pending=stepDesktopBackdropDimming(1);f.release();await pending;assert.deepEqual(f.writes,[]);
 assert.equal(canSaveDesktopBackdropDimming(),false);f.done();
});

const realBundle=await build({stdin:{contents:"export * from './src/ui/modal-backdrop';export * from './src/core/lightbox-size';export {preflightOperonSettingsResetDefaultsV1} from './src/core/settings-reset-default-profile';export {SettingsPreservationHarness} from './scripts/test-support/settings-preservation-harness';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
const real=await import('data:text/javascript;base64,'+Buffer.from(realBundle.outputFiles[0].text).toString('base64'));
test('real settings writes save every expanded choice and reopen preserves an existing 70 preference',async()=>{
 const fixture=new real.SettingsPreservationHarness();let release;
 try{
  const storage=fixture.createStorage();await storage.initialize();
  const initial=fixture.canonicalAttempts;
  release=real.bindDesktopBackdropDimmingPreference({get:()=>storage.getSettings().workspaceTweaksBackgroundDimming,save:value=>storage.updateSettings({workspaceTweaksBackgroundDimming:value})});
  assert.equal(fixture.canonicalAttempts,initial,'binding/opening does not save');
  for(const value of BACKGROUND_DIMMING_OPTIONS){
   await real.saveDesktopBackdropDimming(value);
   assert.equal(JSON.parse(fixture.raw()).ui.workspaceTweaks.workspaceTweaksBackgroundDimming,value);
  }
  await real.saveDesktopBackdropDimming(70);release();
  const reopened=fixture.createStorage();await reopened.initialize();assert.equal(reopened.getSettings().workspaceTweaksBackgroundDimming,70);
 }finally{release?.();real.disposeDesktopBackdrops();await fixture.dispose();}
});
test('real failed canonical save preserves the preference, indicator and exact preimage',async()=>{
 const fixture=new real.SettingsPreservationHarness();let release;
 try{
  const storage=fixture.createStorage();await storage.initialize();
  release=real.bindDesktopBackdropDimmingPreference({get:()=>storage.getSettings().workspaceTweaksBackgroundDimming,save:value=>storage.updateSettings({workspaceTweaksBackgroundDimming:value})});
  const before=fixture.raw();const saved=storage.getSettings().workspaceTweaksBackgroundDimming;
  fixture.writeFault='silent-before';
  await assert.rejects(real.stepDesktopBackdropDimming(1));
  assert.equal(fixture.raw(),before);assert.equal(storage.getSettings().workspaceTweaksBackgroundDimming,saved);assert.equal(real.getDesktopBackdropDimming(),saved);
 }finally{release?.();real.disposeDesktopBackdrops();await fixture.dispose();}
});

test('actual Settings setter joins the control queue without a duplicate settings write',async()=>{
 const f=preferenceFixture(70);const probe=settingsProbe(saveDesktopBackdropDimming);
 try{
  probe.saveSettings=async()=>{throw Error('duplicate write');};
  f.binding.save=async next=>{f.writes.push(next);f.value=next;probe.settings.workspaceTweaksBackgroundDimming=next;};
  await Promise.all([probe.setControlValue('workspaceTweaksBackgroundDimming','35'),stepDesktopBackdropDimming(1)]);
  assert.deepEqual(f.writes,[35,40]);assert.equal(probe.settings.workspaceTweaksBackgroundDimming,40);assert.equal(getDesktopBackdropDimming(),40);
 }finally{f.done();}
});

for (const profile of LIGHTBOX_SIZE_PROFILES) test(`${profile} size survives canonical settings and backup round-trip independently`, () => {
 const original = {...DEFAULT_SETTINGS, workspaceTweaksLightboxSizes: {[profile]: {width:75, height:85}}};
 const settings = migrateSettings(original);
 const pack = buildOperonDataPackageFromSettings(settings);
 assert.deepEqual(pack.ui.workspaceTweaks.workspaceTweaksLightboxSizes, original.workspaceTweaksLightboxSizes);
 assert.deepEqual(composeOperonSettingsFromDataPackage(JSON.parse(JSON.stringify(pack)), DEFAULT_SETTINGS).workspaceTweaksLightboxSizes, original.workspaceTweaksLightboxSizes);
 const backup = exportOperonSettingsBackupJsonV1({settings,source:{pluginVersion:'4.0.1',obsidianVersion:'1.14.4',dataPackageSchemaVersion:3},createdAt:'2026-10-20T12:00:00.000Z'});
 assert.equal(backup.ok,true);
 if (backup.ok) {
  const body = JSON.parse(backup.json).body;
  const decoded=validateOperonSettingsBackupGroupsV1(body.groups);
  assert.equal(decoded.ok,true);
  const patch=buildOperonSettingsBackupSelectedPatchV1({selectedGroups:['general'],candidateSettings:{...DEFAULT_SETTINGS,...decoded.payloads.general}});
  assert.deepEqual(patch.workspaceTweaksLightboxSizes,original.workspaceTweaksLightboxSizes);
 }
 assert.equal(getSettingsBackupCompatibilityForKey('workspaceTweaksLightboxSizes').support,'portable');
 assert.equal(DEFAULT_SETTINGS.workspaceTweaksLightboxSizes[profile], undefined);
 assert.equal(Object.hasOwn(buildOperonDataPackageFromSettings(DEFAULT_SETTINGS).ui.workspaceTweaks,'workspaceTweaksLightboxSizes'),false);
});
test('size normalization is sparse, immutable, and rejects invalid profiles and dimensions',()=>{
 const raw={table:{width:75,height:67},base:{height:85},web:{width:'70'},youtube:{height:NaN},image:{width:90,height:40},pdf:[],other:{width:65}};
 assert.deepEqual(normalizeLightboxSizes(raw),{base:{height:85},table:{width:75},image:{width:90,height:40}});
 assert.equal(raw.table.height,67);
 for(const value of [null,undefined,[],false,70])assert.deepEqual(normalizeLightboxSizes(value),{});
 assert.deepEqual(migrateSettings({}).workspaceTweaksLightboxSizes,{});
});
function sizeStore() {
 const file=ts.createSourceFile('storage.ts',readFileSync(path.join(root,'src/storage/operon-storage.ts'),'utf8'),ts.ScriptTarget.Latest,true);
 const cls=file.statements.find(ts.isClassDeclaration);
 const method=name=>cls.members.find(node=>node.name?.getText(file)===name).getText(file);
 const js=ts.transpileModule(`class Store {
 settings={workspaceTweaksLightboxSizes:{}};settingsSaveQueue=Promise.resolve();writes=[];fail=false;release=null;
 notifyPropertyPoolChange(){}
 async persistSettings(_options,_extra,_mappings,_reload,patch){this.writes.push(structuredClone(patch));if(this.release)await this.release;if(this.fail)throw Error('rejected');Object.assign(this.settings,patch);}
 ${method('enqueueSettingsTransaction')}
 ${method('saveLightboxSize')}
 }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new (new Function('normalizeLightboxSizes',`${js};return Store;`)(normalizeLightboxSizes))();
}
test('actual size persistence serializes independent axes/profiles and does not write on read, invalid input or no-op',async()=>{
 const store=sizeStore();const dispose=bindLightboxSizePreference({get:()=>store.settings.workspaceTweaksLightboxSizes,save:(...args)=>store.saveLightboxSize(...args)});
 try {
  assert.equal(getLightboxProfileSize('table'),undefined);assert.equal(store.writes.length,0);
  await Promise.all([saveLightboxProfileSize('table','width',75),saveLightboxProfileSize('table','height',85),saveLightboxProfileSize('base','width',65)]);
  assert.deepEqual(store.settings.workspaceTweaksLightboxSizes,{table:{width:75,height:85},base:{width:65}});
  await store.saveLightboxSize('table','width',75);await store.saveLightboxSize('table','width',67);
  assert.equal(store.writes.length,3);
  assert.deepEqual(getLightboxProfileSize('table'),{width:75,height:85});
 } finally {dispose();}
 assert.equal(getLightboxProfileSize('table'),undefined);
});
test('failed size save preserves committed sizes, does not retry and leaves the queue usable',async()=>{
 const store=sizeStore();await store.saveLightboxSize('table','width',75);store.fail=true;
 await assert.rejects(store.saveLightboxSize('table','height',85),/rejected/);
 assert.deepEqual(store.settings.workspaceTweaksLightboxSizes,{table:{width:75}});
 store.fail=false;await store.saveLightboxSize('base','height',80);
 assert.deepEqual(store.settings.workspaceTweaksLightboxSizes,{table:{width:75},base:{height:80}});
 assert.equal(store.writes.length,3);
});
test('queued size changes rebase on latest settings and stale binding cleanup cannot remove a new owner',async()=>{
 const store=sizeStore();let release;const block=new Promise(r=>release=r);
 // Model an earlier reset/import transaction in the same real settings queue.
 const previous=store.enqueueSettingsTransaction(async()=>{await block;store.settings.workspaceTweaksLightboxSizes={base:{width:65}};});
 const pending=store.saveLightboxSize('table','width',75);
 const next=store.saveLightboxSize('table','height',85);
 release();await previous;await pending;await next;
 assert.deepEqual(store.settings.workspaceTweaksLightboxSizes,{base:{width:65},table:{width:75,height:85}});
 const old=bindLightboxSizePreference({get:()=>({table:{width:75}}),save:async()=>{}});
 const current=bindLightboxSizePreference({get:()=>({base:{height:85}}),save:async()=>{}});old();
 assert.deepEqual(getLightboxProfileSize('base'),{height:85});current();
});

test('explicit defaults reset clears all size overrides without mutating the current profile',()=>{
 const sizes={table:{width:75,height:85},markdown:{height:80}};
 const result=preflightOperonSettingsResetDefaultsV1({source:{pluginVersion:'4.0.1',obsidianVersion:'1.14.4',dataPackageSchemaVersion:3},createdAt:'2026-10-20T12:00:00.000Z',targetSnapshot:{settings:migrateSettings({...DEFAULT_SETTINGS,workspaceTweaksLightboxSizes:sizes}),dataPackageSchemaVersion:3,settingsVersion:DEFAULT_SETTINGS.settingsVersion,canonicalWritesSuspended:false,canonicalWriteSuspensionReason:null}});
 assert.equal(result.preflight?.ok,true,JSON.stringify(result.preflight?.diagnostics));
 assert.deepEqual(result.preflight.restorePlan.candidateSettings.workspaceTweaksLightboxSizes,{});
 assert.deepEqual(sizes,{table:{width:75,height:85},markdown:{height:80}});
 assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.some(entry=>entry.key==='workspaceTweaksLightboxSizes'),false);
});


test('lightbox control side reads the existing preference without saving and cleans up safely',()=>{
 assert.equal(getLightboxControlSide(),'right');
 let side='left',writes=0;
 const old=bindLightboxSizePreference({get:()=>({}),controlsSide:()=>side,save:async()=>{writes++;}});
 assert.equal(getLightboxControlSide(),'left');side='right';assert.equal(getLightboxControlSide(),'right');
 const current=bindLightboxSizePreference({get:()=>({}),controlsSide:()=> 'left',save:async()=>{writes++;}});
 old();assert.equal(getLightboxControlSide(),'left');current();assert.equal(getLightboxControlSide(),'right');
 assert.equal(writes,0);
});
