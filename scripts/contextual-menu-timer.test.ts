import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { CONTEXTUAL_MENU_SURFACES, executeContextualMenuAction, resolveContextualMenu, type ContextualMenuContext } from '../src/core/contextual-menu-engine';
import { t, installI18nLocale, activateI18nLocale, resetI18nToEnglish, removeI18nLocale } from '../src/core/i18n';

const task = {checkbox:'open' as const, fieldValues:{}};
const context = (id:string, active:string|null, surface:ContextualMenuContext['surface']='readingRow'):ContextualMenuContext => ({surface,taskId:id,task,now:'2026-10-22T12:00:00',isTracking:id===active});
for (const surface of CONTEXTUAL_MENU_SURFACES.filter(s=>s!=='calendarExternalItem'&&s!=='calendarProjectedOccurrence')) {
 for (const active of [null,'A','B']) test(`${surface}: only active task ${active??'none'} has Stop Timer`,()=>{
  for (const id of ['A','B']) {
   const actions=resolveContextualMenu(context(id,active,surface),['openEditor','startTimer','jumpToSource']);
   const action=actions.find(a=>a.id==='startTimer'); assert.ok(action);
   assert.equal(action.label,active===id?t('tooltips','stopTimer'):t('settings','contextualMenuActionStartTimer'));
   assert.equal(action.icon,active===id?'square':'timer');
   assert.deepEqual(actions.map(a=>a.id),['openEditor','startTimer','jumpToSource']);
   if(active===id)assert.equal(action.description,t('tooltips','stopTimer'));
  }
 });
}
test('existing Start Timer wording is preserved in Turkish while active tasks use the translated Stop label',()=>{
 installI18nLocale('tr',JSON.parse(readFileSync('i18n/locales/tr.json','utf8')));activateI18nLocale('tr');
 try {assert.equal(resolveContextualMenu(context('A',null),['startTimer'])[0].label,'Zaman takibini başlat');assert.equal(resolveContextualMenu(context('A','A'),['startTimer'])[0].label,t('tooltips','stopTimer'));}
 finally {resetI18nToEnglish();removeI18nLocale('tr');}
});
test('existing menu allowlists and unsupported/non-open boundaries remain unchanged',()=>{
 assert.deepEqual(resolveContextualMenu(context('A','A'),[]),[]);
 for (const surface of ['calendarExternalItem','calendarProjectedOccurrence'] as const) assert.equal(resolveContextualMenu(context('A','A',surface),['startTimer']).some(a=>a.id==='startTimer'),false);
 for(const checkbox of ['done','cancelled'] as const)assert.equal(resolveContextualMenu({...context('A','A'),task:{...task,checkbox}},['startTimer']).length,0);
 assert.equal(resolveContextualMenu({...context('A',null),isTracking:undefined},['startTimer'])[0].label,t('tooltips','startTimer'));
});

function source(name:string){return ts.createSourceFile(name,readFileSync(name,'utf8'),ts.ScriptTarget.Latest,true);}
function expression(node:ts.Node, file:ts.SourceFile, globals:Record<string,unknown>, host:unknown={}) {
 const code=ts.transpileModule(`function value(){return (${node.getText(file)});}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(globals),`${code};return value.call(this);`).call(host,...Object.values(globals));
}
const main=source('main.ts');
const plugin=main.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonPlugin') as ts.ClassDeclaration;
const handlerNode=plugin.members.find(n=>n.name?.getText(main)==='handleContextualMenuAction') as ts.MethodDeclaration;
const handlerCode=ts.transpileModule(`class Host {${handlerNode.getText(main)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const handler=new Function('executeContextualMenuAction','Notice','t',`${handlerCode};return Host.prototype.handleContextualMenuAction;`)(executeContextualMenuAction,class {constructor(){throw Error('Unexpected new notice');}},t);
function trackerFixture(initial:{operonId:string;start:string}|null={operonId:'A',start:'session1'}) {
 let active=initial, failure=false;const starts:string[]=[], writes:string[]=[];const queue:Array<()=>void>=[];
 const host={timeTracker:{getActiveState:()=>active,isTimerRunning:(id:string)=>active?.operonId===id,
  stop:(reason:string,end:unknown,guard:()=>boolean)=>{assert.equal(reason,'manual');assert.equal(end,undefined);return new Promise<boolean>(resolve=>queue.push(()=>{if(!guard()||failure){resolve(false);return;}writes.push(active!.operonId+':'+active!.start);active=null;resolve(true);}));}},
  startTimerForTask:async(id:string,origin:string,_override:unknown,guard?:()=>boolean)=>{assert.equal(origin,'command');if(guard?.()===false)return false;starts.push(id);return true;}};
 return {host,starts,writes,queue,state:()=>active,set:(state:typeof active)=>active=state,fail:()=>failure=true};
}
test('active menu action calls the existing manual stop path and completes one session',async()=>{
 const f=trackerFixture(),pending=handler.call(f.host,'A','startTimer',context('A','A'));
 assert.equal(f.queue.length,1);f.queue.shift()!();await pending;
 assert.deepEqual(f.writes,['A:session1']);assert.deepEqual(f.starts,[]);assert.equal(f.state(),null);
});
for(const change of ['other-task','same-task-new-session','stopped','write-lease'] as const)test(`stale Stop Timer cannot finalize ${change}`,async()=>{
 const f=trackerFixture();let allowed=true;
 const pending=handler.call(f.host,'A','startTimer',context('A','A'),{canMutate:()=>allowed});
 if(change==='other-task')f.set({operonId:'B',start:'session1'});
 if(change==='same-task-new-session')f.set({operonId:'A',start:'session2'});
 if(change==='stopped')f.set(null);
 if(change==='write-lease')allowed=false;
 const before=f.state();f.queue.shift()!();await pending;
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.starts,[]);assert.deepEqual(f.state(),before);
});
test('a Stop menu opened before another task started leaves that task running',async()=>{
 const f=trackerFixture({operonId:'B',start:'session2'});
 await handler.call(f.host,'A','startTimer',context('A','A'));
 assert.equal(f.queue.length,0);assert.deepEqual(f.writes,[]);assert.deepEqual(f.starts,[]);assert.equal(f.state()?.operonId,'B');
});
test('Start on another task retains the existing start/switch path',async()=>{
 const f=trackerFixture();await handler.call(f.host,'B','startTimer',context('B','A'));
 assert.deepEqual(f.starts,['B']);assert.equal(f.queue.length,0);
});
test('stale Start remains an idempotent start intent instead of becoming Stop',async()=>{
 const f=trackerFixture();await handler.call(f.host,'A','startTimer',context('A',null));
 assert.deepEqual(f.starts,['A']);assert.equal(f.queue.length,0);
});
test('failed stop leaves the active session and Stop appearance intact',async()=>{
 const f=trackerFixture();f.fail();const pending=handler.call(f.host,'A','startTimer',context('A','A'));f.queue.shift()!();await pending;
 assert.deepEqual(f.writes,[]);assert.equal(f.state()?.operonId,'A');assert.equal(resolveContextualMenu(context('A',f.state()!.operonId),['startTimer'])[0].label,t('tooltips','stopTimer'));
});

// Evaluate the production bindings, including lazy callbacks, rather than matching source text.
const surfaces = [
 'reading-task-row','live-preview-conceal','reading-task-wikilink-overlay','live-preview-task-wikilink-overlay','task-card-controls',
 'pinned-tasks-dock','pinned-tasks-sidebar-view','time-session-history-view','flow-time-view','upcoming-tasks-sidebar-view','inline-task-bar',
 'table/table-task-icon-button','table/table-task-data-type-button','table/operon-table-view','embed-table-processor','calendar/calendar-view','kanban/kanban-view',
];
for(const name of surfaces)test(`${name}: menu state comes from the correct live task`,()=>{
 const ast=source(`src/ui/${name}.ts`),bindings:ts.Expression[]=[];
 const visit=(node:ts.Node):void=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='isTracking')bindings.push(node.initializer);ts.forEachChild(node,visit);};visit(ast);
 assert.ok(bindings.length>0);
 let active='A';const isTaskTracking=(id:string)=>id===active;
 for(const id of ['A','B']){
  const currentTask={operonId:id,taskId:id};
  const callbacks={isTaskTracking,getActiveTrackerState:()=>({operonId:active})};
  const tracker={isTimerRunning:isTaskTracking};
  const host={id,task:currentTask,callbacks,tracker,timeTracker:tracker,deps:{chips:callbacks}};
  const globals={task:currentTask,item:currentTask,resolved:{task:currentTask},callbacks,cbs:callbacks,options:{task:currentTask,isTracking:isTaskTracking},deps:callbacks};
  for(const binding of bindings){active='A';const value=expression(binding,ast,globals,host);assert.equal(typeof value==='function'?value(id):value,id==='A');
   if(typeof value==='function'){active='B';assert.equal(value(id),id==='B','binding must read current state on reopening');}}
 }
});
test('shared hover menu resolves state on every opening and forwards the matching intent',()=>{
 const ast=source('src/ui/contextual-hover-menu.ts');const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='showTaskContextualHoverMenu') as ts.FunctionDeclaration;
 const code=ts.transpileModule(`let sharedHoverMenuDelayMs=0;${fn.getText(ast).replace(/^export\s+/, '')}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const calls:any[]=[];let active='A';
 const show=new Function('localNow','resolveContextualMenu','getOwnerBody','sharedTaskHoverMenu',`${code};return showTaskContextualHoverMenu;`)(()=> 'now',resolveContextualMenu,()=>({}),{activateTrigger(){},show:(options:any)=>{calls.push(options);return true;}});
 const settings={contextualMenuOpenDelayMs:0,contextualMenuActionAllowlist:['startTimer']};
 for(const id of ['A','B']){const options={surface:'readingRow',taskId:id,getTask:()=>task,getSettings:()=>settings,resolveAnchorRect:()=>({}),isTracking:()=>active===id,onAction:()=>{}};
  active='A';show({},options);assert.equal(calls.at(-1).context.isTracking,id==='A');
  active='B';show({},options);assert.equal(calls.at(-1).context.isTracking,id==='B');}
});
