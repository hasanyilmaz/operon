import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ClassDeclaration } from 'typescript';
const ts = require('typescript') as typeof import('typescript');
import { DEFAULT_SETTINGS, CURRENT_SETTINGS_VERSION, KANBAN_CELL_HEIGHT_OPTIONS, normalizeKanbanCellHeightPx, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import { preflightOperonSettingsBackupRestoreV1 } from '../src/core/settings-backup-preflight';
import { preflightOperonSettingsResetDefaultsV1 } from '../src/core/settings-reset-default-profile';
import { resolveKanbanDropLaneAnchorScroll, resolveKanbanViewportAnchorScroll, resolveKanbanViewportScrollCompensation, resolveKanbanCellInitialRenderLimit, resolveKanbanCellScrollRestore } from '../src/systems/kanban-cell-materialization';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';

import { createDefaultDynamicFileTaskFilterSet, createDefaultDynamicSubtasksFilterSet } from '../src/core/dynamic-file-task-filter';
const settings = () => migrateSettings({...structuredClone(DEFAULT_SETTINGS), filterSets:[...structuredClone(DEFAULT_SETTINGS.filterSets),createDefaultDynamicFileTaskFilterSet(),createDefaultDynamicSubtasksFilterSet()]});
const source = { pluginVersion: '4.3.0', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 };
const createdAt = '2026-10-27T12:00:00.000Z';
const css = readFileSync('styles.css', 'utf8');
const view = readFileSync('src/ui/kanban/kanban-view.ts', 'utf8');
function rule(selector: string): string {
 const start = css.indexOf(`\n${selector} {`, css.indexOf(`\n${selector} {`) > 0 && css[css.indexOf(`\n${selector} {`) - 1] === ',' ? css.indexOf(`\n${selector} {`) + 1 : 0); assert.ok(start >= 0, selector);
 return css.slice(start, css.indexOf('}', start));
}
function productionClass(file: string, className: string, names: string[], deps: Record<string, unknown>) {
 const source = readFileSync(file, 'utf8'), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ClassDeclaration;
 assert.ok(declaration);
 const methods = names.map(name => { const method = declaration.members.find(node => node.name?.getText(tree) === name); assert.ok(method, name); return method.getText(tree); });
 const code = ts.transpileModule(`class Subject { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${code}; return Subject;`)(...Object.values(deps));
}
const targetSnapshot = () => ({ settings: settings(), settingsVersion: CURRENT_SETTINGS_VERSION, dataPackageSchemaVersion: 2, canonicalWritesSuspended: false, canonicalWriteSuspensionReason: null });

test('the global default and dropdown have exactly five pixel options', () => {
 assert.deepEqual(KANBAN_CELL_HEIGHT_OPTIONS, [350,400,450,500,550]);
 assert.equal(DEFAULT_SETTINGS.kanbanCellHeightPx,450);
 const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === 'kanbanCellHeightPx');
 assert.equal(entry?.control,'dropdown'); assert.ok(!OPERON_SETTINGS_SEARCH_REGISTRY.some(entry => entry.key === 'kanbanMaxVisibleTasksPerCell'));
});
for (const height of KANBAN_CELL_HEIGHT_OPTIONS) test(`height ${height} survives package and backup restore with legacy preferences intact`, () => {
 const s=settings();s.kanbanCellHeightPx=height;s.kanbanMaxVisibleTasksPerCell=13;
 const pkg=buildOperonDataPackageFromSettings(s), reopened=composeOperonSettingsFromDataPackage(pkg,DEFAULT_SETTINGS);
 assert.equal(reopened.kanbanCellHeightPx,height);assert.equal(reopened.kanbanMaxVisibleTasksPerCell,13);
 const exported=exportOperonSettingsBackupJsonV1({settings:s,source,createdAt});assert.ok(exported.ok,JSON.stringify(exported.diagnostics));
 const parsed=parseOperonSettingsBackupV1(exported.json);assert.ok(parsed.ok);
 const decoded=validateOperonSettingsBackupGroupsV1(parsed.value.body.groups);assert.ok(decoded.ok,JSON.stringify(decoded.diagnostics));
 assert.equal(decoded.payloads.general?.kanbanCellHeightPx,height);
 const result=preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,targetSnapshot:targetSnapshot(),selectedGroups:['general']});
 assert.ok(result.ok,JSON.stringify(result));assert.equal(result.restorePlan?.candidateSettings.kanbanCellHeightPx,height);
 assert.deepEqual(result.restorePlan?.candidateSettings.kanbanPresets,s.kanbanPresets);
});
for (const invalid of [undefined,null,'450',false,0,349,551,375,425,475,450.5,NaN,Infinity]) test(`invalid stored height ${String(invalid)} falls back without reading the old task limit`, () => {
 for(const legacy of [1,7,30]) {
  const s=migrateSettings({...settings(),kanbanCellHeightPx:invalid,kanbanMaxVisibleTasksPerCell:legacy});
  assert.equal(s.kanbanCellHeightPx,450);assert.equal(s.kanbanMaxVisibleTasksPerCell,legacy);
  assert.deepEqual(migrateSettings(s),s);
 }
});
test('reset-defaults previews 450 px through the existing backup path', () => {
 const target=targetSnapshot();target.settings.kanbanCellHeightPx=500;
 const result=preflightOperonSettingsResetDefaultsV1({source,createdAt,targetSnapshot:target});
 assert.ok(result.preflight?.ok);assert.equal(result.preflight.restorePlan?.candidateSettings.kanbanCellHeightPx,450);
});
for(const variant of ['legacy','new','both','invalid'] as const) test(`${variant} settings initialize and reopen without a height migration write`,async()=>{
 const pkg=buildOperonDataPackageFromSettings(settings());
 pkg.ui.presetFavorites={version:1,table:[],calendar:[],kanban:[],filter:[]};
 const rawSettings=pkg.settings as Record<string,unknown>;
 if(variant==='legacy')delete rawSettings.kanbanCellHeightPx;
 else rawSettings.kanbanCellHeightPx=variant==='invalid'?'bad':500;
 if(variant==='new')delete rawSettings.kanbanMaxVisibleTasksPerCell;
 else pkg.settings.kanbanMaxVisibleTasksPerCell=11;
 const fixture=new SettingsPreservationHarness({initialRaw:JSON.stringify(pkg,null,'\t'),table:false});
 try {
  const before=fixture.raw(),storage=fixture.createStorage();await storage.initialize();
  assert.equal(storage.getSettings().kanbanCellHeightPx,variant==='legacy'||variant==='invalid'?450:500);
  assert.ok(fixture.raw()===before,'startup must preserve canonical bytes');assert.equal(fixture.canonicalCommits,0);
  await fixture.createStorage().initialize();assert.ok(fixture.raw()===before,'startup must preserve canonical bytes');assert.equal(fixture.canonicalCommits,0);
  fixture.assertIsolation();
 } finally {await fixture.dispose();}
});
test('real serialized settings saves preserve unrelated fields, survive reopen and reject failed writes',async()=>{
 const fixture=new SettingsPreservationHarness({initialRaw:JSON.stringify(buildOperonDataPackageFromSettings(settings())),table:false});
 try {
  const storage=fixture.createStorage();await storage.initialize();
  const before=fixture.raw(),previous=structuredClone(storage.getSettings());fixture.writeFault='throw-before';
  await assert.rejects(storage.updateSettings({kanbanCellHeightPx:500}));
  assert.ok(fixture.raw()===before,'persisted package must remain unchanged');assert.equal(storage.getSettings().kanbanCellHeightPx,450);
  await storage.updateSettings({kanbanCellHeightPx:400});
  assert.equal(storage.getSettings().kanbanCellHeightPx,400);
  const after=structuredClone(storage.getSettings());after.kanbanCellHeightPx=previous.kanbanCellHeightPx;assert.deepEqual(after,previous);
  const reopened=fixture.createStorage();await reopened.initialize();assert.equal(reopened.getSettings().kanbanCellHeightPx,400);
  fixture.assertIsolation();
 } finally {await fixture.dispose();}
});
test('Settings API commits a numeric dropdown value and refreshes definitions after failure without changing state',async()=>{
 const Subject=productionClass('src/ui/settings-tab.ts','OperonSettingsTab',['setControlValue'],{normalizeKanbanCellHeightPx});
 const subject=new Subject(),s=settings();let fail=false,notifications=0,definitions=0;
 subject.settings=s;subject.storage={updateSettings:async(patch:object)=>{if(fail)throw new Error('injected');Object.assign(s,patch);}};
 subject.notifySettingsChanged=()=>{notifications++;};subject.updateNativeSettingsDefinitions=()=>{definitions++;};subject.applyPendingSettingsChange=()=>{};
 await subject.setControlValue('kanbanCellHeightPx','500');assert.equal(s.kanbanCellHeightPx,500);assert.equal(notifications,1);
 fail=true;await assert.rejects(subject.setControlValue('kanbanCellHeightPx','550'),/injected/);
 assert.equal(s.kanbanCellHeightPx,500);assert.equal(notifications,1);assert.equal(definitions,2);
});
test('fallback dropdown routes through the same setter and resets its selected value on failure',async()=>{
 let drop: { value:string; options:unknown; change:(value:string)=>Promise<void>; addOptions(options:unknown):unknown; setValue(value:string):unknown; onChange(cb:(value:string)=>Promise<void>):unknown };
 class Setting {
  constructor(_container: unknown) {} setName(){return this;}setDesc(){return this;}
  addDropdown(cb:(value:typeof drop)=>void){drop={value:'',options:{},change:async()=>{},addOptions(options){this.options=options;return this;},setValue(value){this.value=value;return this;},onChange(cb){this.change=cb;return this;}};cb(drop);return this;}
 }
 const Subject=productionClass('src/ui/settings-tab.ts','OperonSettingsTab',['renderKanbanSetting'],{Setting,t:()=>'',settingsAsyncHandler:(_label:string,fn:unknown)=>fn});
 const subject=new Subject();let current='450',reject=false;const calls:string[]=[];
 subject.getSettingsSearchDropdownOptions=()=>Object.fromEntries(KANBAN_CELL_HEIGHT_OPTIONS.map(v=>[String(v),`${v} px`]));
 subject.getControlValue=()=>current;subject.markSettingsSearchTarget=()=>{};
 subject.setControlValue=async(key:string,value:string)=>{calls.push(key);if(reject)throw new Error('injected');current=value;};
 subject.renderKanbanSetting({},'kanbanCellHeightPx');assert.equal(drop!.value,'450');
 await drop!.change('400');assert.equal(drop!.value,'400');reject=true;
 await assert.rejects(drop!.change('500'),/injected/);assert.equal(drop!.value,'400');assert.deepEqual(calls,['kanbanCellHeightPx','kanbanCellHeightPx']);
});
test('open rows own fixed geometry before any task materialization; content never measures row height',()=>{
 assert.match(rule('.operon-kanban-row'),/height: var\(--operon-kanban-cell-height, 450px\)/);
 assert.match(rule('.operon-kanban-row'),/grid-template-rows: minmax\(0, 1fr\)/);
 assert.match(rule('.operon-kanban-cell'),/box-sizing: border-box/);assert.match(rule('.operon-kanban-cell'),/overflow-y: auto/);
 assert.match(rule('.operon-kanban-cell > .operon-kanban-card'),/flex-shrink: 0/);
 assert.match(rule('.operon-kanban-row.is-collapsed'),/height: 54px/);
 assert.doesNotMatch(view,/measureCellHeightLimitPx|syncRowCellHeights|syncLaneHeights|kanbanMaxVisibleTasksPerCell|estimateKanbanCellPlaceholderHeightPx/);
 assert.ok(view.indexOf("boardEl.style.setProperty('--operon-kanban-cell-height'")<view.indexOf('this.activateDeferredCellMaterialization(gridViewport, deferredCells.splice(0))'));
});
test('classic boards fill the pane at both desktop and mobile sizes',()=>{
 assert.match(rule('.operon-kanban-board.is-no-swimlanes .operon-kanban-grid-content'),/height: 100%/);
 assert.match(rule('.operon-kanban-board.is-no-swimlanes .operon-kanban-row'),/flex: 1 1 0/);
 assert.match(rule('.operon-kanban-board.is-no-swimlanes .operon-kanban-row'),/height: auto/);
 assert.doesNotMatch(css,/\.operon-kanban-board\.is-no-swimlanes:not\(\.is-mobile-layout\)/);
});
for(const height of [350,450,500,900])test(`lazy card window covers ${height}px and pending deep scroll without changing geometry`,()=>{
 const options={taskCount:200,renderBatchSize:10,viewportHeightPx:height,savedScrollTopPx:2400,cardHeightPx:72,cardGapPx:8};
 assert.equal(resolveKanbanCellInitialRenderLimit(options),30+Math.ceil(height/80));
 assert.equal(resolveKanbanCellInitialRenderLimit({...options,taskCount:3}),3);
 assert.equal(resolveKanbanCellInitialRenderLimit({...options,taskCount:0}),0);
});
test('clamped restoration retries while lazy content can grow and settles when it cannot',()=>{
 const options={targetTop:2400,achievedTop:1400,now:1,expiresAt:2000,canGrow:true};
 assert.equal(resolveKanbanCellScrollRestore(options),'retry');
 assert.equal(resolveKanbanCellScrollRestore({...options,canGrow:false}),'satisfied');
 assert.match(view,/previousHeight !== settings\.kanbanCellHeightPx && this\.lastRenderedBoardScope === this\.buildDropScrollAnchorScope\(\)/);
});
test('image/layout refresh uses the cell owner window and never measures other rows',()=>{
 const Subject=productionClass('src/ui/kanban/kanban-view.ts','KanbanView',['scheduleBoardLayoutRefreshFromCell'],{getOwnerWindow:(cell:{owner:unknown})=>cell.owner});
 let scheduled:(()=>void)|undefined,restored=0,anchored=0;
 const owner={requestAnimationFrame:(fn:()=>void)=>{scheduled=fn;return 7;}};
 const viewport={},board={isConnected:true,querySelector:()=>viewport},cell={isConnected:true,owner,closest:()=>board};
 const subject=new Subject();subject.boardLayoutRefreshFrame=null;subject.restoreCellScrollIfPending=(value:unknown)=>{assert.equal(value,cell);restored++;};
 subject.scheduleBoardViewportAnchorRestore=(value:unknown)=>{assert.equal(value,viewport);anchored++;};
 subject.scheduleBoardLayoutRefreshFromCell(cell);assert.equal(subject.boardLayoutRefreshFrame,7);assert.ok(scheduled);scheduled();
 assert.equal(restored,1);assert.equal(anchored,1);assert.equal(subject.boardLayoutRefreshFrame,null);
});

test('lazy viewport batches read every cell height before adding any cards', () => {
 const Subject=productionClass('src/ui/kanban/kanban-view.ts','KanbanView',['materializeKanbanCellsIfPending'],{});
 const events:string[]=[], subject=new Subject();
 const cells=['a','b'].map(id=>({get clientHeight(){events.push(`read:${id}`);return 423;}}));
 subject.pendingCellMaterializers=new Map(cells.map((cell,i)=>[cell,(height:number)=>{assert.equal(height,423);events.push(`write:${i}`);return{commit:()=>events.push(`commit:${i}`)};}]));
 assert.equal(subject.materializeKanbanCellsIfPending(cells),true);
 assert.deepEqual(events,['read:a','read:b','write:0','write:1','commit:0','commit:1']);
 assert.equal(subject.pendingCellMaterializers.size,0);
});
for (const clampToNaturalBounds of [true,false]) test(`height-change clamp ${clampToNaturalBounds} preserves ordinary drop compensation`,()=>{
 const Subject=productionClass('src/ui/kanban/kanban-view.ts','KanbanView',['restoreBoardViewportAnchor'],{
  resolveKanbanDropLaneAnchorScroll,resolveKanbanViewportAnchorScroll,resolveKanbanViewportScrollCompensation,KANBAN_VIEWPORT_ANCHOR_STABLE_PASSES:3,
 });
 const subject=new Subject();let padding=0;
 const board={scrollTop:0,scrollLeft:0,scrollHeight:1000,clientHeight:800,scrollWidth:600,clientWidth:600,getBoundingClientRect:()=>({top:0,left:0}),querySelectorAll:()=>[]};
 subject.pendingViewportAnchor={clampToNaturalBounds,scope:'board',expiresAt:Date.now()+10000,settleAfter:Date.now()+10000,state:{top:400,left:0},laneAnchors:[],columnAnchors:[],drop:null,lastAppliedState:null,stablePasses:0};
 subject.buildDropScrollAnchorScope=()=>'board';subject.getAppliedBoardBottomScrollCompensation=()=>padding;
 subject.applyBoardBottomScrollCompensation=(_board:unknown,value:number)=>{padding=value;board.scrollHeight=1000+padding;};
 subject.suppressTaskNoteScrollCloseForFrame=()=>{};subject.markProgrammaticBoardScroll=()=>{};
 subject.restoreBoardViewportAnchor(board);
 assert.equal(board.scrollTop,clampToNaturalBounds?200:400);assert.equal(padding,clampToNaturalBounds?0:200);
});
