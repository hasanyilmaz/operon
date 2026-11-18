import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=mkdtempSync(path.join(tmpdir(),'operon-task-info-'));
after(()=>rmSync(temp,{recursive:true,force:true}));
await build({stdin:{contents:`export * from './src/types/settings'; export * from './src/storage/operon-data-package'; export * from './src/storage/task-ui-preference-store'; export * from './src/storage/write-queue'; export * from './src/ui/settings/settings-search-registry'; export * from './src/ui/compact-task-layout'; export * from './src/core/task-info-chips'; export * from './src/ui/task-info-chip-action'; export * from './src/ui/custom-key-mapping-modal'; export * from './src/core/settings-backup-export'; export * from './src/core/settings-backup-preflight'; export * from './src/ui/table/table-field-catalog'; export {TFile} from 'obsidian';`,resolveDir:root},outfile:path.join(temp,'subject.mjs'),bundle:true,format:'esm',platform:'node',target:'node18',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
const api=await import(pathToFileURL(path.join(temp,'subject.mjs')));
const profiles=['inlineTask','filterTask','taskWikilinkOverlay','kanbanTask','taskCard','taskFinder'].map(s=>s+'CompactChips');
const serialKey='taskInfo.projectSerial',sourceKey='taskInfo.source';
const custom=key=>({canonicalKey:key,visiblePropertyName:key,isSystem:false,enabled:true,type:'text',sync:'yes',showInChips:true});
const mappings=[...api.DEFAULT_SETTINGS.keyMappings,custom('source'),custom('projectSerial')];
for(const profile of profiles){
 test(`${profile}: defaults follow custom keys and preserve existing order and choices`,()=>{
  const normalized=api.migrateSettings({keyMappings:mappings,[profile]:[{key:'status',visible:false,iconOnly:true},{key:'source',visible:true,iconOnly:false}]});
  const items=normalized[profile];assert.equal(items[0].key,serialKey);assert.equal(items.at(-1).key,sourceKey);assert.equal(items[0].visible,true);assert.equal(items.at(-1).visible,false);
  assert.equal(items.filter(x=>x.key==='source').length,1);assert.equal(items.filter(x=>x.key==='projectSerial').length,1);
  const chosen=[{key:sourceKey,visible:true,iconOnly:true},...items.filter(x=>x.key!==sourceKey&&x.key!==serialKey),{key:serialKey,visible:false,iconOnly:true}];
  const saved=api.migrateSettings({...normalized,[profile]:chosen});const again=api.migrateSettings(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(again[profile],saved[profile]);assert.equal(again[profile][0].key,sourceKey);assert.equal(again[profile].at(-1).key,serialKey);assert.equal(again[profile].at(-1).visible,false);
  assert.equal(again[profile][0].iconOnly,profile!=='taskFinderCompactChips');
 });
 test(`${profile}: first install/reset and missing settings enable Serial only`,()=>{
  const settings=api.migrateSettings({keyMappings:mappings});
  assert.equal(settings[profile].at(-1).key,sourceKey);
  const reset=api.buildDefaultTaskChipSettings(settings)[profile];
  assert.equal(reset.find(x=>x.key===serialKey).visible,true);assert.equal(reset.find(x=>x.key===serialKey).iconOnly,false);assert.equal(reset.find(x=>x.key===sourceKey).visible,false);
 });
}
const task=(format='inline',filePath='Folder/Note.md',lineNumber=36)=>({operonId:'test-id',primary:{format,filePath,lineNumber},fieldValues:{},tags:[],checkbox:'open'});
const display={label:'PROJ-42',number:42,scopeId:'scope',scopePrefix:'PROJ',parentOperonId:'parent',operonId:'test-id'};
const items=[{key:serialKey,visible:true,iconOnly:false},{key:sourceKey,visible:true,iconOnly:false}];
function entries(t=task(),serial=display,chipItems=items,settings=api.DEFAULT_SETTINGS){return api.buildInlineTaskCompactChipEntries(t.fieldValues,t.tags,settings,[],chipItems,undefined,{task:t,projectSerialDisplay:serial});}
for(const format of ['inline','yaml'])for(const iconOnly of [false,true])test(`${format}/${iconOnly}: shared entries keep stored Serial and full source tooltip`,()=>{
 const t=task(format);const before=JSON.stringify(t);const result=entries(t,display,items.map(x=>({...x,iconOnly})));
 assert.equal(result.length,2);assert.equal(result[0].label,'PROJ-42');assert.equal(result[0].interactive,false);
 assert.equal(result[1].label,format==='inline'?'Note.md:37':'Note.md');assert.equal(result[1].icon,format==='inline'?'text-cursor-input':'file-text');assert.equal(result[1].tooltipContent,format==='inline'?'Folder/Note.md:37':'Folder/Note.md');
 assert.equal(result[1].iconOnly,iconOnly);assert.match(result[1].ariaLabel,/Folder\/Note.md/);assert.equal(JSON.stringify(t),before);
});
test('Serial empty, hidden, configured icon and fallback, and source missing context',()=>{
 assert.deepEqual(entries(task(),null).map(x=>x.key),[sourceKey]);
 assert.deepEqual(entries(task(),display,items.map(x=>({...x,visible:false}))),[]);
 const settings={...api.DEFAULT_SETTINGS,keyMappings:api.DEFAULT_SETTINGS.keyMappings.map(x=>x.canonicalKey==='operonId'?{...x,icon:'star'}:x)};
 assert.equal(entries(task(),display,items,settings)[0].icon,'star');assert.equal(entries(task(),display,items,{...settings,keyMappings:[]})[0].icon,'fingerprint');
 assert.equal(api.buildInlineTaskCompactChipEntries({},[],settings,[],items).length,0);
});
test('Custom source and projectSerial remain property entries, separate from info identity',()=>{
 const settings=api.migrateSettings({keyMappings:mappings});const t=task();t.fieldValues={source:'custom-source',projectSerial:'custom-serial'};
 const result=entries(t,display,[...items,...['source','projectSerial'].map(key=>({key,visible:true,iconOnly:false}))],settings);
 assert.deepEqual(result.map(x=>x.label),['PROJ-42','Note.md:37','custom-source','custom-serial']);
});
test('source label follows latest path, line and type without losing full long path',()=>{
 const long='Folder/'+ 'long-name-'.repeat(60)+'.md';assert.equal(entries(task('inline',long,99))[1].tooltipContent,long+':100');
 assert.equal(entries(task('yaml','Moved/New.md'))[1].label,'New.md');
 assert.equal(api.getTableTaskFieldLabel('source',api.DEFAULT_SETTINGS),api.TASK_INFO_CHIPS[sourceKey].label);
 assert.equal(api.getTableTaskFieldLabel('projectSerial',api.DEFAULT_SETTINGS),api.TASK_INFO_CHIPS[serialKey].label);
});
class El {
 constructor(){this.events={};this.children=[];this.attrs={};this.style={setProperty(){}};this.classList={add(){},toggle(){}};}
 addEventListener(k,v){this.events[k]=v;} fire(k){const e={preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};this.events[k]?.(e);return e;}
 appendChild(el){this.children.push(el);}setAttribute(k,v){this.attrs[k]=v;}
}
test('source click shields caret and resolves latest task; removed task/file is inert and never writes',()=>{
 const el=new El(),opened=[];let current=task(),exists=true;
 const app={vault:{getAbstractFileByPath:p=>exists?new api.TFile(p):null}};
 api.bindTaskInfoSourceAction(el,()=>opened.push({...current.primary}),app,()=>current);
 const down=el.fire('mousedown');assert.ok(down.prevented&&down.stopped);
 current=task('inline','Moved.md',81);el.fire('click');assert.deepEqual(opened,[current.primary]);
 exists=false;el.fire('click');current=null;el.fire('click');assert.equal(opened.length,1);
});
const read=f=>readFileSync(path.join(root,f),'utf8');
function fn(file,name,deps={}){const tree=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);const js=ts.transpileModule(node.getText(tree).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(deps),`${js};return ${name}`)(...Object.values(deps));}
for(const surface of ['live','reading','overlay','card'])for(const key of [sourceKey,serialKey])test(`${surface}: ${key} preserves legacy/mobile navigation behavior`,()=>{
 const chip=new El(),calls=[];let current=task();const callbacks={app:{vault:{getAbstractFileByPath:p=>new api.TFile(p)}},getAllTasks:()=>current?[current]:[],getTaskById:()=>current,onContextualAction:(...a)=>calls.push(a),onAction:(...a)=>calls.push(a)};
 const deps={bindDesktopChipOpening:()=>false,bindTaskInfoSourceAction:api.bindTaskInfoSourceAction,buildKanbanTaskActionContext:()=>({surface:'taskCard'})};
 const names={live:['live-preview-conceal','attachLivePreviewChipAction'],reading:['reading-task-row','attachReadingChipAction'],overlay:['task-wikilink-overlay-chips','attachOverlayChipAction'],card:['compact-card-chips','attachKanbanChipAction']};const [file,name]=names[surface];const bind=fn(`src/ui/${file}.ts`,name,deps),entry={key,iconOnly:true};let blocked=false;
 if(surface==='live')bind(chip,entry,{},current.fieldValues,null,callbacks,[],current);
 if(surface==='reading')bind(chip,entry,current,callbacks,undefined,null,()=>({task:current??task(),callbacks}));
 if(surface==='overlay')bind(chip,entry,callbacks,current);
 if(surface==='card')bind(chip,entry,current,callbacks,[],()=>blocked);
 chip.fire('click');assert.equal(calls.length,key===sourceKey?1:0);if(key===sourceKey)assert.deepEqual(calls[0].slice(0,2),['test-id','jumpToSource']);
 blocked=true;current=null;chip.fire('click');assert.equal(calls.length,key===sourceKey?1:0);
});
test('backup export and import keep all six chip preferences',()=>{
 const fixture=JSON.parse(read('scripts/settings-backup-fixtures/representative-body.json'));
 const settings=api.migrateSettings({...Object.assign({}, ...Object.values(fixture.groups).map(group=>group.data)),keyMappings:[...mappings,...fixture.groups['custom-keys'].data.customKeys]});for(const profile of profiles)settings[profile]=[...settings[profile]].reverse().map(x=>({...x,visible:x.key===sourceKey,iconOnly:false}));
 const exported=api.exportOperonSettingsBackupJsonV1({settings,createdAt:'2026-10-18T12:00:00Z',source:{pluginVersion:'4.0.1',obsidianVersion:'1.13.0',dataPackageSchemaVersion:2}});
 assert.equal(exported.ok,true,JSON.stringify(exported.diagnostics));
 const result=api.preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,selectedGroups:['general'],targetSnapshot:{settings:api.migrateSettings({...settings,...Object.fromEntries(profiles.map(profile=>[profile,api.DEFAULT_SETTINGS[profile]]))}),settingsVersion:settings.settingsVersion,dataPackageSchemaVersion:2,canonicalWritesSuspended:false,canonicalWriteSuspensionReason:null}});
 assert.equal(result.ok,true,JSON.stringify(result.diagnostics));assert.ok(result.restorePlan,JSON.stringify(result.preview));
 for(const profile of profiles)assert.deepEqual(result.restorePlan.candidateSettings[profile],settings[profile]);
});
function method(file,name,deps={}){
 const tree=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);let node;
 function visit(n){if(ts.isMethodDeclaration(n)&&n.name?.getText(tree)===name)node=n;else ts.forEachChild(n,visit);}visit(tree);assert.ok(node,name);
 const js=ts.transpileModule(`class Subject { ${node.getText(tree)} }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${js};return Subject.prototype.${name};`)(...Object.values(deps));
}
for(const key of [sourceKey,serialKey])for(const iconOnly of [false,true])test(`${key}/${iconOnly}: DOM controls preserve accessible names and native button keyboard`,()=>{
 const create=fn('src/ui/compact-task-layout.ts','createInlineTaskCompactChipElement',{compactPropertyIcons:new WeakMap(),isTaskInfoChipKey:api.isTaskInfoChipKey,createOwnerElement:(_owner,tag)=>Object.assign(new El(),{tag}),setIcon:(el,icon)=>el.icon=icon,setAccessibleLabelWithoutTooltip:(el,label)=>el.attrs['aria-label']=label});
 const entry=entries(task(),display,items.map(x=>({...x,iconOnly}))).find(x=>x.key===key),el=create(entry);
 assert.equal(el.tag,key===sourceKey?'button':'span');assert.equal(el.attrs['aria-label'],entry.ariaLabel);assert.match(el.className,/operon-task-info-chip/);
 if(key===serialKey)assert.match(el.className,/operon-project-serial-chip/);
 const finder=create({...entry,interactive:false},{},{forceFull:true});assert.equal(finder.tag,'span');assert.doesNotMatch(finder.className,/is-icon-only/);
});
for(const mode of ['normal','today','overdue'])for(const showSerial of [true,false])test(`Finder ${mode}/${showSerial}: preserves configured order with only explicit date exception`,()=>{
 const input=[{key:sourceKey,label:'N.md',icon:'file-text',iconOnly:true,interactive:true},{key:'priority',label:'A'},...(showSerial?[{key:serialKey,label:'P-1',interactive:false}]:[]),{key:'dateDue',label:'today'}];
 const rendered=[];const render=method('src/ui/task-finder-modal.ts','renderTaskChips',{shouldResolveLocationCompactChips:()=>false,buildInlineTaskCompactChipEntries:()=>input,createInlineTaskCompactChipElement:(entry)=>{rendered.push(entry);return new El();},bindAssigneeChipImage(){},bindOperonHoverTooltip(){}});
 const prioritize=es=>[...es.filter(e=>e.key==='dateDue'),...es.filter(e=>e.key!=='dateDue')];
 render.call({app:{},getSettings:()=>api.DEFAULT_SETTINGS,getTaskSnapshot:()=>({tasks:[]}),getCompactTaskLookup(){},options:{},showOverdueTasks:mode==='overdue',showHappensTodayTasks:mode==='today',prioritizeOverdueDateEntries:prioritize,prioritizeTodayDateEntries:prioritize,applyChipVisualStyles(){}},new El(),task());
 assert.deepEqual(rendered.map(e=>e.key),mode==='normal'?input.map(e=>e.key):[...(showSerial?[serialKey]:[]),'dateDue',sourceKey,'priority']);
 assert.ok(rendered.every(e=>e.interactive===false&&e.iconOnly===false));assert.deepEqual(input[0].interactive,true);
});
test('Settings Search and list labels recognize only catalog IDs, not Creator fields',()=>{
 const deps={...api,INLINE_TASK_COMPACT_CHIP_KEY_SET:new Set(api.INLINE_TASK_COMPACT_CHIP_ORDER),TASK_CREATOR_TOOLBAR_FIELD_KEY_SET:new Set(api.TASK_CREATOR_TOOLBAR_FIELD_ORDER??[]),TASK_EDITOR_WORKFLOW_PICKER_KEY_SET:new Set(),TASK_EDITOR_MOBILE_CORE_TOOL_KEY_SET:new Set(),getManagedCustomFieldOptionMapping:()=>null};
 const renderable=method('src/ui/settings-tab.ts','isRenderableSurfaceKey',deps),label=method('src/ui/settings-tab.ts','getInlineTaskCompactChipLabel',deps);
 for(const key of [sourceKey,serialKey]){assert.equal(renderable.call({settings:api.DEFAULT_SETTINGS},key,'chips'),true);assert.equal(renderable.call({settings:api.DEFAULT_SETTINGS},key,'creator'),false);assert.equal(label.call({},key),api.TASK_INFO_CHIPS[key].label);}
 const source=read('src/ui/settings-tab.ts');assert.match(source,/getRenderableSurfaceItems\(this.settings\[settingsKey\], surface\)/);assert.match(source,/getInlineTaskCompactChipLabel\(row.key\)/);
 const ui=read('src/ui/settings/interface-editor-ui.ts');assert.match(ui,/if \(options.getCanonicalLabel\?\.\(item.key\) === ''\) return;\s*createSettingsListCardChip/);
});
test('source keyboard activation stays native but cannot activate parent row',()=>{
 const chip=new El();api.bindTaskInfoSourceAction(chip,()=>{}, {vault:{}},()=>null);
 for(const key of ['Enter',' ']){let stopped=false,prevented=false;chip.events.keydown({key,stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});assert.equal(stopped,true);assert.equal(prevented,false);}
});

const chipPages = ['inlineTaskChips', 'filterTaskChips', 'taskWikilinkOverlayChips', 'kanbanTaskChips', 'taskCardChips', 'taskFinderChips'];
// Obsidian 1.14+ prefers explicit id; names remain the labels in global search.
function hostRowIdentity(row) {
 return row.id ? `id:${row.id}` : `name:${row.name}`;
}
for (const pageId of chipPages) {
 test(`${pageId}: same-name Custom Keys keep search, labels and rerender identity separate`, () => {
  const customMappings = [['source', 'Source'], ['projectSerial', 'Project Serial'], ['action-0', 'Source']].map(([canonicalKey, visiblePropertyName]) => {
   // Each is independently valid; the third tests field/action identity separation.
   const result = api.buildCustomKeyMappingFromDraft({canonicalKey, visiblePropertyName, type: 'text', showInChips: true}, api.DEFAULT_SETTINGS.keyMappings);
   assert.equal(result.ok, true); return result.mapping;
  });
  const settings = api.migrateSettings({keyMappings: [...api.DEFAULT_SETTINGS.keyMappings, ...customMappings.slice(0, 2)]});
  const before = JSON.stringify(settings);
  const label = method('src/ui/settings-tab.ts', 'getInlineTaskCompactChipLabel', {...api,
   getCustomFieldMapping: (mappings, key) => mappings.find(mapping => mapping.canonicalKey === key && mapping.isSystem === false),
   getCustomFieldLabel: mapping => mapping.visiblePropertyName,
  });
  const define = method('src/ui/settings-tab.ts', 'buildTaskChipCardDefinition', {});
  const rendered = [];
  const ctx = {settings, renderTaskChipsSettingsPageContent(page, element, {singleRow}) {
   assert.equal(page, pageId);
   element.textContent = label.call(this, singleRow.key);
   rendered.push(singleRow.key);
  }};
  const keys = [serialKey, 'projectSerial', sourceKey, 'source'];
  let previous = new Map();
  for (const order of [keys, [...keys].reverse(), [sourceKey, serialKey, 'source', 'projectSerial']]) {
   const snapshot = JSON.stringify(settings);
   const rows = order.map(key => define.call(ctx, pageId, label.call(ctx, key), {key}, [key]));
   assert.deepEqual(rows.map(row => row.name), order.map(key => label.call(ctx, key)));
   assert.deepEqual(rows.map(row => row.aliases), order.map(key => [key]));
   assert.equal(new Set(rows.map(row => hostRowIdentity(row))).size, keys.length);
   for (const query of ['source', 'project serial']) {
    const hits = rows.filter(row => [row.name, ...(row.aliases ?? [])].some(text => text.toLowerCase().includes(query)));
    assert.equal(hits.length, 2);
   }
   const next = new Map();
   rows.forEach((row, i) => {
    const identity = hostRowIdentity(row), key = order[i];
    if (previous.has(identity)) assert.equal(previous.get(identity), key);
    const element = {dataset: {}, textContent: '', empty() {this.textContent='';}, removeClass() {}, addClass() {}};
    row.render({settingEl:element});
    assert.equal(element.textContent, label.call(ctx, key));
    assert.equal(element.dataset.operonChipRow, `${pageId}:${key}`);
    assert.equal(rendered.at(-1), key);
    next.set(identity, key);
   });
   previous = next;
   assert.equal(JSON.stringify(settings), snapshot);
   // Visibility and icon-only changes must not change the row identity or target.
   for (const profile of profiles) settings[profile] = settings[profile].map(item => ({...item, visible: !item.visible, iconOnly: !item.iconOnly}));
  }
  const field = define.call(ctx, pageId, 'Source', {key:'action-0'}, ['action-0']);
  const action = define.call(ctx, pageId, 'Source', {action:0}, []);
  assert.notEqual(hostRowIdentity(field), hostRowIdentity(action));
  // Constructing definitions and rerendering perform no settings mutation.
  const finalState = JSON.stringify(settings);
  define.call(ctx, pageId, 'Source', {key:sourceKey}, [sourceKey]);
  assert.equal(JSON.stringify(settings), finalState);
  assert.notEqual(finalState, before); // Only the explicit test edits above changed preferences.
 });
}
test('Creator definitions retain their existing names and rendering metadata', () => {
 const define = method('src/ui/settings-tab.ts', 'buildTaskChipCardDefinition', {});
 const row = define.call({}, 'taskCreatorToolbar', 'Type', {key:'taskType'}, ['taskType']);
 assert.equal(row.name, 'Type');assert.equal(row.id, undefined);assert.deepEqual(row.aliases, ['taskType']);
});

const sourceActionProfiles=['inlineTask','filterTask','kanbanTask','taskWikilinkOverlay','taskCard'];
for(const profile of sourceActionProfiles)test(`${profile} Source action: default-on, explicit false, canonical roundtrip and Settings Search stay independent`,async()=>{
 const key=profile+'ShowSourceAction';
 for(const value of [undefined,null,'false',true,false]){
  const settings=api.migrateSettings({[key]:value});assert.equal(settings[key],typeof value==='boolean'?value:true);
  const pack=api.buildOperonDataPackageFromSettings(settings);assert.equal(pack.ui.taskUiPreferences[key]??true,settings[key]);if(settings[key])assert.equal(key in pack.ui.taskUiPreferences,false);assert.equal(key in pack.settings,false);
  const restored=api.composeOperonSettingsFromDataPackage(JSON.parse(JSON.stringify(pack)),api.DEFAULT_SETTINGS);assert.equal(restored[key],settings[key]);
  assert.equal(api.composeOperonSettingsFromDataPackage(pack,{...api.DEFAULT_SETTINGS,[key]:!settings[key]})[key],settings[key]);
  const store=new api.TaskUiPreferenceStore({},new api.WriteQueue(),settings);store.loadFromPackage(pack.ui.taskUiPreferences);assert.equal(store.getAll()[key],settings[key]);
  assert.deepEqual(restored[profile+'CompactChips'],settings[profile+'CompactChips']);
 }
 const setting=api.OPERON_SETTINGS_SEARCH_REGISTRY.find(entry=>entry.key===key);
 assert.equal(setting.id,'ui.'+key);assert.equal(setting.name.key,'taskSourceAction');assert.ok(setting.aliases.includes('lightbox'));
 const rendererName=profile==='inlineTask'?'renderInlineTaskCompactChipSettingsSection':profile==='filterTask'?'renderFilterTaskCardsSection':profile==='taskWikilinkOverlay'?'renderTaskWikilinkOverlayCompactChipSettingsSection':'renderKanbanTaskCompactChipSettingsSection';
 let options,saves=0;
 const render=method('src/ui/settings-tab.ts',rendererName,{t:(_namespace,key)=>key,renderCompactChipSettingsSection:input=>options=input,isTaskInfoChipKey:()=>false});
 const ctx={settings:api.migrateSettings({}),saveSettings:async()=>saves++,getRenderableSurfaceItems:items=>items,renderTaskChipsGroupedSection:el=>el};
 render.call(ctx,{},profile==='taskCard'?'taskCard':profile==='kanbanTask'?'kanbanTask':undefined);
 const before=JSON.stringify(ctx.settings),toggles=options.getActionToggles(),source=toggles.at(-1);assert.equal(source.searchTargetId,'ui.'+key);assert.equal(source.visible,true);
 await source.onToggle();assert.equal(ctx.settings[key],false);assert.equal(saves,1);assert.equal(options.getActionToggles().at(-1).visible,false);
 const expected=JSON.parse(before);expected[key]=false;assert.deepEqual(JSON.parse(JSON.stringify(ctx.settings)),expected);
});
test('Source action backup export and restore preserve all five flags including false',()=>{
 const fixture=JSON.parse(read('scripts/settings-backup-fixtures/representative-body.json'));
 const settings=api.migrateSettings({...Object.assign({},...Object.values(fixture.groups).map(group=>group.data)),keyMappings:[...api.DEFAULT_SETTINGS.keyMappings,...fixture.groups['custom-keys'].data.customKeys],...Object.fromEntries(sourceActionProfiles.map((p,i)=>[p+'ShowSourceAction',i%2===0]))});
 const exported=api.exportOperonSettingsBackupJsonV1({settings,createdAt:'2026-10-19T12:00:00Z',source:{pluginVersion:'4.0.1',obsidianVersion:'1.14.0',dataPackageSchemaVersion:2}});assert.equal(exported.ok,true,JSON.stringify(exported.diagnostics));
 const result=api.preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,selectedGroups:['general'],targetSnapshot:{settings:api.migrateSettings({...settings,...Object.fromEntries(sourceActionProfiles.map(p=>[p+'ShowSourceAction',!settings[p+'ShowSourceAction']]))}),settingsVersion:settings.settingsVersion,dataPackageSchemaVersion:2,canonicalWritesSuspended:false,canonicalWriteSuspensionReason:null}});
 assert.equal(result.ok,true,JSON.stringify(result.diagnostics));assert.ok(result.restorePlan);
 for(const p of sourceActionProfiles)assert.equal(result.restorePlan.candidateSettings[p+'ShowSourceAction'],settings[p+'ShowSourceAction']);
});
