import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBuiltInKanbanPreset } from '../src/types/kanban';
import type { ClassDeclaration } from 'typescript';
const ts = require('typescript') as typeof import('typescript');
import { DEFAULT_SETTINGS, CURRENT_SETTINGS_VERSION, resolveKanbanPresetLayout, KANBAN_COLUMN_WIDTH_OPTIONS, normalizeKanbanExpandedColumnWidthPx, KANBAN_CELL_HEIGHT_OPTIONS, normalizeKanbanCellHeightPx, migrateSettings } from '../src/types/settings';
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

function heightControlsHarness() {
 const s = settings(), buttons: Array<{cls:string; dataset: Record<string,string>; disabled: boolean; ariaDisabled?:string; label?: string; icon?: string; click?: () => void; focus:()=>void}> = [];
 let focused: typeof buttons[number] | null = null;
 const notices: string[] = [];
 const Subject = productionClass('src/ui/kanban/kanban-view.ts', 'KanbanView',
  ['getPresetLayout', 'renderCellSizeControls', 'syncCellSizeControls', 'restoreCellSizeControlFocus', 'changeCellSize'], {
   resolveKanbanPresetLayout, KANBAN_COLUMN_WIDTH_OPTIONS, normalizeKanbanExpandedColumnWidthPx, KANBAN_CELL_HEIGHT_OPTIONS, normalizeKanbanCellHeightPx, t: (_group:string,key:string)=>key,
   setIcon: (button:{icon:string},icon:string)=>{button.icon=icon;},
   setAccessibleLabelWithoutTooltip: (button:{label:string},label:string)=>{button.label=label;},
   bindOperonHoverTooltip: ()=>{},
   Notice: class {constructor(message:string){notices.push(message);}},
   console: {error:()=>{}},
  });
 const subject = new Subject(), writes:number[]=[];
 subject.getSettings=()=>s;subject.ensureState=()=>({presetId:s.kanbanPresets[0].id});
 subject.contentEl={querySelectorAll:(selector:string)=>buttons.filter(b=>b.cls.split(' ').includes(selector.slice(1))),querySelector:(selector:string)=>focused?.cls.split(' ').includes(selector.slice(1).replace(':focus',''))?focused:null};
 subject.callbacks={onSetCellHeight:async(_preset:unknown,height:number)=>{writes.push(height);s.kanbanPresets[0].cellHeightPx=height;}};
 const board={createDiv:()=>({setAttribute:()=>{},createEl:(_tag:string,options:{cls:string;attr:Record<string,string>})=>{
  const button={cls:options.cls,dataset:{sizeDirection:options.attr['data-size-direction']},disabled:false,ariaDisabled:'false',
   focus:()=>{focused=button;},setAttribute:(_key:string,value:string)=>{button.ariaDisabled=value;},
   addEventListener:(_event:string,fn:()=>void)=>{button.click=fn;},click:undefined as (()=>void)|undefined};
  buttons.push(button);return button;
 }})};
 return {subject,s,buttons,board,writes,notices,getFocused:()=>focused};
}

test('floating height controls mount without writes, use minus/plus order and expose the current preset value',()=>{
 const h=heightControlsHarness();h.subject.renderCellSizeControls(h.board);
 assert.deepEqual(h.buttons.map(button=>button.icon),['minus','plus']);
 assert.ok(h.buttons.every(button=>!button.disabled && button.label?.includes('450 px')));
 assert.deepEqual(h.writes,[]);
 h.s.kanbanPresets[0].cellHeightPx=750;h.subject.syncCellSizeControls();assert.deepEqual(h.buttons.map(b=>b.disabled),[false,true]);
 h.s.kanbanPresets[0].cellHeightPx=250;h.subject.syncCellSizeControls();assert.deepEqual(h.buttons.map(b=>b.disabled),[true,false]);
});
test('floating controls step through existing choices, read the latest setting and never write beyond the boundaries',async()=>{
 const h=heightControlsHarness();h.subject.renderCellSizeControls(h.board);
 await h.subject.changeCellSize(1);assert.equal(h.s.kanbanPresets[0].cellHeightPx,500);
 for(let i=0;i<6;i++) await h.subject.changeCellSize(1);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,750);
 h.s.kanbanPresets[0].cellHeightPx=400;
 for(let i=0;i<6;i++) await h.subject.changeCellSize(-1);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,250);assert.deepEqual(h.writes,[500,550,600,650,700,750,350,300,250]);
});
test('a pending save rejects repeat activation and replacement controls become usable after settlement',async()=>{
 const h=heightControlsHarness();let finish!:()=>void,calls=0;
 h.subject.callbacks.onSetCellHeight=async(_preset:unknown,height:number)=>{calls++;await new Promise<void>(resolve=>{finish=resolve;});h.s.kanbanPresets[0].cellHeightPx=height;};
 h.subject.renderCellSizeControls(h.board);
 const pending=h.subject.changeCellSize(1);await h.subject.changeCellSize(1);assert.equal(calls,1);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,450);assert.ok(h.buttons.every(b=>b.ariaDisabled==='true'));
 h.buttons.length=0;h.subject.renderCellSizeControls(h.board);assert.ok(h.buttons.every(b=>b.ariaDisabled==='true'));
 finish();await pending;assert.equal(h.s.kanbanPresets[0].cellHeightPx,500);assert.ok(h.buttons.every(b=>!b.disabled&&b.ariaDisabled==='false'));
});
test('keyboard focus stays through saves and switches to the usable control only at a boundary',async()=>{
 const h=heightControlsHarness();h.subject.renderCellSizeControls(h.board);h.buttons[1].focus();
 await h.subject.changeCellSize(1);assert.equal(h.getFocused(),h.buttons[1]);
 await h.subject.changeCellSize(1);assert.equal(h.getFocused(),h.buttons[1]);
 await h.subject.changeCellSize(1);assert.equal(h.getFocused(),h.buttons[1]);
 await h.subject.changeCellSize(1);await h.subject.changeCellSize(1);await h.subject.changeCellSize(1);assert.equal(h.getFocused(),h.buttons[0]);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,750);
 assert.match(view,/if \(heightControlDirection\) this\.restoreCellSizeControlFocus\(heightControlDirection\)/);
});
test('failed height save keeps the actual value, reports failure and permits an explicit retry',async()=>{
 const h=heightControlsHarness();const commit=h.subject.callbacks.onSetCellHeight;
 h.subject.callbacks.onSetCellHeight=async()=>{throw new Error('injected save fault');};
 h.subject.renderCellSizeControls(h.board);await h.subject.changeCellSize(1);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,450);assert.deepEqual(h.writes,[]);assert.equal(h.notices.length,1);assert.ok(h.buttons.every(b=>!b.disabled));
 h.subject.callbacks.onSetCellHeight=commit;await h.subject.changeCellSize(1);assert.deepEqual(h.writes,[500]);
});
test('floating controls are swimlane-only, live outside the scrolling viewport, and use existing safe preset persistence',()=>{
 assert.match(view,/if \(hasSwimlanes\) this\.renderCellSizeControls\(boardEl\)/);
 assert.match(rule('.operon-kanban-cell-height-controls'),/position: absolute/);
 assert.match(view,/boardEl\.style\.setProperty\('--operon-kanban-header-height',/);
 const main=readFileSync('main.ts','utf8');
 assert.match(main,/onSetCellHeight: async \(preset, height\) => \{\s*await this\.storage\.saveKanbanPresetIfUnchanged\(preset, \{ \.\.\.preset, cellHeightPx: height \}\);/);
});

test('the global default and dropdown have eleven pixel options and no global control', () => {
 assert.deepEqual(KANBAN_CELL_HEIGHT_OPTIONS, [250,300,350,400,450,500,550,600,650,700,750]);
 assert.equal(DEFAULT_SETTINGS.kanbanCellHeightPx,450);
 const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === 'kanbanCellHeightPx');
 assert.equal(entry,undefined); assert.ok(!OPERON_SETTINGS_SEARCH_REGISTRY.some(entry => entry.key === 'kanbanMaxVisibleTasksPerCell'));
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
 assert.match(view,/previousLayout\.cellHeightPx !== layout\.cellHeightPx \|\| previousLayout\.columnWidthPx !== layout\.columnWidthPx/);
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

for(const width of KANBAN_COLUMN_WIDTH_OPTIONS.filter(value=>value<=500)) test(`legacy global width ${width} survives settings and backup roundtrip`,()=>{
 const s=settings();s.kanbanExpandedColumnWidthPx=width;
 const pkg=buildOperonDataPackageFromSettings(s);
 assert.equal(composeOperonSettingsFromDataPackage(pkg,DEFAULT_SETTINGS).kanbanExpandedColumnWidthPx,width);
 const exported=exportOperonSettingsBackupJsonV1({settings:s,source,createdAt});assert.ok(exported.ok);
 const restored=preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,targetSnapshot:targetSnapshot(),selectedGroups:['general']});
 assert.ok(restored.ok);assert.equal(restored.restorePlan?.candidateSettings.kanbanExpandedColumnWidthPx,width);
});
test('width options, default, legacy normalization and dropdown agree',()=>{
 assert.deepEqual(KANBAN_COLUMN_WIDTH_OPTIONS,[250,275,300,325,350,375,400,425,450,475,500,550,600,700,800]);
 assert.equal(DEFAULT_SETTINGS.kanbanExpandedColumnWidthPx,325);
 for(const [raw,expected] of [[320,325],[220,250],[520,500],[300,300],[undefined,325]]) {
  assert.equal(normalizeKanbanExpandedColumnWidthPx(raw),expected);
  const s=migrateSettings({...settings(),kanbanExpandedColumnWidthPx:raw});
  assert.equal(s.kanbanExpandedColumnWidthPx,expected);assert.deepEqual(migrateSettings(s),s);
 }
 assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.find(e=>e.key==='kanbanExpandedColumnWidthPx')?.control,undefined);
 assert.match(view,/columnWidthPx: this\.getPresetLayout\(\)\.columnWidthPx/);
});
test('width buttons step through all choices, stop at bounds and preserve height',async()=>{
 const h=heightControlsHarness();const writes:number[]=[];
 h.subject.callbacks.onSetColumnWidth=async(_preset:unknown,width:number)=>{writes.push(width);h.s.kanbanPresets[0].columnWidthPx=width;};
 h.subject.renderCellSizeControls(h.board,true);
 for(let i=0;i<20;i++)await h.subject.changeCellSize(1,true);
 assert.equal(h.s.kanbanPresets[0].columnWidthPx,800);assert.equal(h.buttons[1].disabled,true);
 for(let i=0;i<20;i++)await h.subject.changeCellSize(-1,true);
 assert.equal(h.s.kanbanPresets[0].columnWidthPx,250);assert.equal(h.buttons[0].disabled,true);
 assert.deepEqual(writes,[350,375,400,425,450,475,500,550,600,700,800,700,600,550,500,475,450,425,400,375,350,325,300,275,250]);
 assert.equal(h.s.kanbanPresets[0].cellHeightPx,450);
 h.subject.callbacks.onSetColumnWidth=async()=>{throw new Error('injected');};
 await h.subject.changeCellSize(1,true);assert.equal(h.s.kanbanPresets[0].columnWidthPx,250);assert.equal(h.notices.length,1);
});

for (const variant of ['missing','valid','invalid'] as const) test(`preset layout ${variant}: read-only startup twice, independent defaults and preserved fields`,async()=>{
 const pkg=buildOperonDataPackageFromSettings(settings());pkg.ui.presetFavorites={version:1,table:[],calendar:[],kanban:[],filter:[]};
 pkg.settings.kanbanExpandedColumnWidthPx=500;pkg.settings.kanbanCellHeightPx=250;
 const preset=pkg.views.kanbanPresets.kanbanPresets[0];
 if(variant==='missing'){delete preset.columnWidthPx;delete preset.cellHeightPx;}
 else {preset.columnWidthPx=variant==='valid'?800:333;preset.cellHeightPx=750;}
 const fixture=new SettingsPreservationHarness({initialRaw:JSON.stringify(pkg,null,'\t'),table:false});
 try {
  const before=fixture.raw();
  for(let i=0;i<2;i++){
   const storage=fixture.createStorage();await storage.initialize();
   assert.deepEqual(resolveKanbanPresetLayout(storage.getSettings().kanbanPresets[0]),{columnWidthPx:variant==='valid'?800:325,cellHeightPx:variant==='missing'?450:750});
   assert.equal(fixture.raw(),before);assert.equal(fixture.canonicalCommits,0);
  }
  fixture.assertIsolation();
 } finally{await fixture.dispose();}
});
for(const width of KANBAN_COLUMN_WIDTH_OPTIONS) test(`preset width ${width} and 750px height survive backup and store normalization`,()=>{
 const s=settings();s.kanbanPresets[0].columnWidthPx=width;s.kanbanPresets[0].cellHeightPx=750;
 const exported=exportOperonSettingsBackupJsonV1({settings:s,source,createdAt});assert.ok(exported.ok);
 const result=preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,targetSnapshot:targetSnapshot(),selectedGroups:['kanban']});
 assert.ok(result.ok,JSON.stringify(result));assert.deepEqual(result.restorePlan?.candidateSettings.kanbanPresets,s.kanbanPresets);
});
test('preset size saves isolate presets, reject stale drafts, preserve order and survive failed writes',async()=>{
 const fixture=new SettingsPreservationHarness({initialRaw:JSON.stringify(buildOperonDataPackageFromSettings(settings())),table:false});
 try{
  const storage=fixture.createStorage();await storage.initialize();const a=structuredClone(storage.getSettings().kanbanPresets[0]);
  await storage.createKanbanPreset({...a,id:'layout-copy',name:'Copy',columnWidthPx:800,cellHeightPx:750});
  const b=structuredClone(storage.getSettings().kanbanPresets.find(p=>p.id==='layout-copy')!),order=storage.kanbanOrder.toPackage();
  await storage.saveKanbanPresetIfUnchanged(a,{...a,columnWidthPx:600,cellHeightPx:700});
  assert.deepEqual(storage.getSettings().kanbanPresets.find(p=>p.id===b.id),b);
  await assert.rejects(storage.saveKanbanPresetIfUnchanged(a,{...a,name:'Stale modal'}));
  const latest=structuredClone(storage.getSettings().kanbanPresets.find(p=>p.id===a.id)!);
  const raw=fixture.raw();fixture.writeFault='throw-before';await assert.rejects(storage.saveKanbanPresetIfUnchanged(latest,{...latest,columnWidthPx:700}));
  assert.equal(fixture.raw(),raw);assert.deepEqual(storage.getSettings().kanbanPresets.find(p=>p.id===a.id),latest);assert.deepEqual(storage.kanbanOrder.toPackage(),order);
  const reopened=fixture.createStorage();await reopened.initialize();assert.deepEqual(reopened.getSettings().kanbanPresets,storage.getSettings().kanbanPresets);
  const {columnWidthPx:_w,cellHeightPx:_h,...rest}=latest,{columnWidthPx:_oldW,cellHeightPx:_oldH,...old}=a;assert.deepEqual(rest,old);
 }finally{await fixture.dispose();}
});
test('floating save remains bound to its original preset when the view changes during save',async()=>{
 const h=heightControlsHarness();const a=h.s.kanbanPresets[0],b={...a,id:'other',columnWidthPx:800,cellHeightPx:750};h.s.kanbanPresets.push(b);
 let active=a.id,finish!:()=>void;h.subject.ensureState=()=>({presetId:active});
 h.subject.callbacks.onSetColumnWidth=async(expected:typeof a,width:number)=>{await new Promise<void>(resolve=>{finish=resolve;});assert.equal(expected.id,a.id);a.columnWidthPx=width;};
 const pending=h.subject.changeCellSize(1,true);active=b.id;finish();await pending;
 assert.equal(a.columnWidthPx,350);assert.equal(b.columnWidthPx,800);
});
test('preset layout dropdowns edit only the draft and preserve disabled height',async()=>{
 const controls:Array<{value:string;disabled:boolean;options:string[];change:(value:string)=>void}>=[];
 class Setting{setName(){return this;}setDesc(){return this;}addDropdown(build:Function){const c={value:'',disabled:false,options:[] as string[],change:(_v:string)=>{}};controls.push(c);const d={addOption(k:string){c.options.push(k);return d;},setValue(v:string){c.value=v;return d;},setDisabled(v:boolean){c.disabled=v;return d;},onChange(fn:(v:string)=>void){c.change=fn;return d;}};build(d);return this;}}
 const Subject=productionClass('src/ui/kanban/kanban-preset-quick-settings-modal.ts','KanbanPresetQuickSettingsModal',['renderBoardLayout','updatePreset','getPreset'],{Setting,resolveKanbanPresetLayout,KANBAN_COLUMN_WIDTH_OPTIONS,KANBAN_CELL_HEIGHT_OPTIONS,resolveKanbanAxes:()=>({ok:true,axes:{swimlanes:null}}),t:()=>''});
 const original=settings().kanbanPresets[0],subject=new Subject();subject.draftPreset=structuredClone(original);subject.options={getSettings:settings};subject.createPresetSection=()=>({});
 subject.renderBoardLayout({},subject.draftPreset);assert.equal(controls[1].disabled,true);assert.equal(controls[1].value,'450');assert.deepEqual(controls[0].options,KANBAN_COLUMN_WIDTH_OPTIONS.map(String));
 controls[0].change('800');await Promise.resolve();assert.equal(subject.draftPreset.columnWidthPx,800);assert.equal(original.columnWidthPx,325);assert.equal(subject.draftPreset.cellHeightPx,450);
});

test('legacy built-in conversion retains already saved preset dimensions',()=>{
 const preset={...settings().kanbanPresets[0],name:'Default Kanban',pipelineId:null,filterSetId:null,swimlaneBy:'priority' as const,colorSource:'taskColor' as const,autoCollapseFinishedColumns:true,sortRules:[{field:'alphabetical',direction:'asc' as const,empty:'last' as const}],columnWidthPx:800,cellHeightPx:750};
 const next=normalizeBuiltInKanbanPreset(preset);assert.equal(next.columnWidthPx,800);assert.equal(next.cellHeightPx,750);
});
