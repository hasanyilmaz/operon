import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-reading-refresh-'));
try {
 const source=fs.readFileSync(path.join(root,'main.ts'),'utf8');
 const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonPlugin');
 const methods=['getDynamicFileTaskFilterMarkdownViews','refreshMarkdownTaskSurfaces','isUnrelatedReadingTaskView','runScheduledIndexSideEffects','refreshRetainedReadingSections'].map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast));
 const outfile=path.join(dir,'test.mjs');
 const prelude=`import {createGlobalMarkdownRefreshScope} from ${JSON.stringify(path.join(root,'src/core/markdown-refresh-scope'))};
 export class EditorView{dispatch(value){this.effects=value.effects;}}
 export class FixtureElement {
  constructor(classes=[],attrs={},tag='div'){this.classes=classes;this.attrs=attrs;this.tag=tag;this.children=[];this.isConnected=true;}
  append(node){this.children.push(node);return node;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
   if(selector.startsWith('.'))return this.classes.includes(selector.slice(1));
   if(selector==='[class*="operon-"]')return this.classes.some(value=>value.includes('operon-'));
   if(selector.startsWith('[data-'))return Object.hasOwn(this.attrs,selector.slice(1,-1));
   if(selector==='input[type="checkbox"]')return this.tag==='input'&&this.attrs.type==='checkbox';
   if(selector==='a.internal-link')return this.tag==='a'&&this.classes.includes('internal-link');
   return false;
  }
  querySelectorAll(selector){return this.children.flatMap(child=>[child,...child.querySelectorAll('*')]).filter(child=>selector==='*'||selector.split(',').some(part=>child.matches(part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 }
 export class MarkdownView{constructor(filePath,mode='preview'){this.file={path:filePath};this.contentEl=new FixtureElement();this.root=this.contentEl.append(new FixtureElement(['markdown-preview-sizer']));this.source='- [ ] Indexed task {{id::task001}}';this.metadata={listItems:[{task:' '}]};this.mode=mode;this.calls=[];this.indexValue='loading';this.rendered='loading';this.editor={cm:new EditorView()};this.previewMode={rerender:force=>{this.calls.push(force);if(force)this.rendered=this.indexValue;}};}getMode(){return this.mode;}getViewData(){return this.source;}}
 const operonIndexRefreshEffect={of:()=> 'index'},operonEditorCloseRefreshEffect={of:()=> 'close'},operonTaskWikilinkForceRevealEffect={of:value=>value};
 const getNativeLightboxLeaves=app=>app.ownedLeaves;
 const getEditorViewFromEditor=editor=>editor.cm;
 const refreshEmbeddedMarkdownSourceEditors=()=>({refreshedEditors:0,skippedEditors:0});
 const enginePerfNow=()=>0,enginePerfLog=()=>{};
 export class Harness{taskCardIndexState='ready';readingInlineMounts=new Map();indexer={getTask:()=>({}),getTaskIdsInFileSnapshot:()=>[],getLiveReadAuthoritySnapshot:()=>({state:'verified'})};${methods.join('\n')}}`;
 await build({stdin:{contents:prelude,resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const {Harness,MarkdownView,FixtureElement}=await import(pathToFileURL(outfile).href);
 const setup=(views)=>{const h=new Harness();h.app={ownedLeaves:[],metadataCache:{getFileCache:file=>[...views,...h.app.ownedLeaves.map(leaf=>leaf.view)].find(view=>view.file===file)?.metadata??null},workspace:{getLeavesOfType:()=>views.map(view=>({view}))}};return h;};
 let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
 await test('default refresh replaces the loading render after index readiness',()=>{
  const view=new MarkdownView('Note.md'),h=setup([view]);view.indexValue='ready';h.refreshMarkdownTaskSurfaces();
  assert.deepEqual(view.calls,[true]);assert.equal(view.rendered,'ready');
 });
 await test('index-only task change refreshes unchanged markdown content',()=>{
  const view=new MarkdownView('Note.md'),h=setup([view]);view.indexValue='todo';h.refreshMarkdownTaskSurfaces();view.indexValue='done';h.refreshMarkdownTaskSurfaces();assert.equal(view.rendered,'done');
 });
 await test('scoped refresh leaves unrelated notes untouched',()=>{
  const a=new MarkdownView('A.md'),b=new MarkdownView('B.md'),h=setup([a,b]);
  const result=h.refreshMarkdownTaskSurfaces({scope:{mode:'scoped',filePaths:['A.md'],reason:'test'}});
  assert.deepEqual(a.calls,[true]);assert.deepEqual(b.calls,[]);assert.equal(result.skippedLeaves,1);
 });
 await test('Live Preview still receives its existing editor effect',()=>{
  const view=new MarkdownView('Note.md','source'),h=setup([view]);h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[]);assert.deepEqual(view.editor.cm.effects,['index']);
 });
 await test('isolated lightbox receives index and settings refresh with no normal tab',()=>{
  const preview=new MarkdownView('Note.md'),live=new MarkdownView('Live.md','source'),h=setup([]);
  h.app.ownedLeaves=[{view:preview},{view:live}];preview.indexValue='ready';
  let result=h.refreshMarkdownTaskSurfaces();
  assert.equal(preview.rendered,'ready');assert.deepEqual(live.editor.cm.effects,['index']);assert.equal(result.refreshedLeaves,2);
  preview.indexValue='changed';h.refreshMarkdownTaskSurfaces({resetLivePreviewReveal:true});
  assert.equal(preview.rendered,'changed');assert.deepEqual(live.editor.cm.effects,['close']);
  h.app.ownedLeaves=[];result=h.refreshMarkdownTaskSurfaces();assert.equal(result.refreshedLeaves,0);
 });
 await test('owned views honor scoped refresh and duplicate workspace ownership',()=>{
  const a=new MarkdownView('A.md'),b=new MarkdownView('B.md'),h=setup([a]);
  h.app.ownedLeaves=[{view:a},{view:b}];
  const result=h.refreshMarkdownTaskSurfaces({scope:{mode:'scoped',filePaths:['A.md'],reason:'test'}});
  assert.deepEqual(a.calls,[true]);assert.deepEqual(b.calls,[]);assert.equal(result.refreshedLeaves,1);assert.equal(result.skippedLeaves,1);
 });
 await test('explicit lightweight refresh remains available',()=>{
  const view=new MarkdownView('Note.md'),h=setup([view]);h.refreshMarkdownTaskSurfaces({forceReadingViewRerender:false});assert.deepEqual(view.calls,[false]);
 });
 await test('a detached Reading view cannot prevent refreshing the next view',()=>{
  const a=new MarkdownView('A.md'),b=new MarkdownView('B.md'),h=setup([a,b]);a.previewMode.rerender=()=>{throw Error('detached');};h.refreshMarkdownTaskSurfaces();assert.deepEqual(b.calls,[true]);
 });
 await test('existing index-update side effects reach the corrected refresh',async()=>{
  const view=new MarkdownView('Note.md'),h=setup([view]);view.indexValue='ready';Object.assign(h,{timeTracker:{resumeFromIndex:async()=>{}},recurrenceService:{reconcileStoredSeries:async()=>{}},reconcileAdditiveDependencyLinksWhenSafe:async()=>{},settings:{},indexSideEffectSettlement:{settleIfIdle(){}},syncDuplicateConflictUi(){},refreshViews(options){assert.equal(options.fromIndexUpdate,true);this.refreshMarkdownTaskSurfaces();}});
  await h.runScheduledIndexSideEffects();assert.deepEqual(view.calls,[true]);assert.equal(view.rendered,'ready');
 });
 await test('retained inline sections update without replacing the preview',()=>{
  const view=new MarkdownView('Note.md'),h=setup([view]);let refreshed=0;
  view.contentEl.querySelector=()=>({});view.contentEl.contains=()=>true;
  h.readingInlineMounts.set({isConnected:true,querySelectorAll:()=>[{dataset:{operonReadingTaskId:'task'}}]}, {sourcePath:'Note.md',refresh:()=>refreshed++});
  h.refreshMarkdownTaskSurfaces();assert.equal(refreshed,1);assert.deepEqual(view.calls,[]);
  h.refreshMarkdownTaskSurfaces({forceReadingViewRerender:true});assert.deepEqual(view.calls,[true]);
 });
 await test('missing tasks and failed section refresh fall back to a complete preview refresh',()=>{
  for(const missing of [true,false]){
   const view=new MarkdownView('Note.md'),h=setup([view]);view.contentEl.querySelector=()=>({});view.contentEl.contains=()=>true;
   h.indexer.getTask=()=>missing?null:{};
   h.readingInlineMounts.set({isConnected:true,querySelectorAll:()=>[{dataset:{operonReadingTaskId:'task'}}]}, {sourcePath:'Note.md',refresh:()=>{throw Error('stale section');}});
   h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
  }
 });
 await test('startup readiness already schedules an authoritative refresh',()=>{
  let ready;const visit=node=>{if(ts.isExpressionStatement(node)&&node.getText(ast)==="this.taskCardIndexState = 'ready';")ready=node;ts.forEachChild(node,visit);};visit(cls);
  assert.ok(ready);const statements=ready.parent.statements;const index=statements.indexOf(ready);
  assert.ok(statements.slice(index+1).some(n=>n.getText(ast)==='this.refreshViews();'));
 });
 const plainView = () => {const view=new MarkdownView('Plain.md');view.source='# Home\nPlain text';view.metadata={sections:[{type:'heading'},{type:'paragraph'}]};return view;};
 await test('plain Reading note is skipped on both primary and followup passes',()=>{
  const view=plainView(),h=setup([view]);
  for(let i=0;i<2;i++){const result=h.refreshMarkdownTaskSurfaces();assert.equal(result.refreshedLeaves,0);assert.equal(result.skippedLeaves,1);}
  assert.deepEqual(view.calls,[]);
 });
 await test('two Bases blocks and a banner retain their DOM without full render',()=>{
  const view=plainView(),h=setup([view]);view.source='---\nbanner: cover.jpg\n---\n# Home\n```base\nviews: []\n```\n```base\nviews: []\n```';
  view.metadata={sections:[{type:'yaml'},{type:'heading'},{type:'code'},{type:'code'}]};
  const nodes=[view.root.append(new FixtureElement(['banner'])),view.root.append(new FixtureElement(['bases-embed'])),view.root.append(new FixtureElement(['bases-embed']))];
  h.refreshMarkdownTaskSurfaces();h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[]);assert.deepEqual(view.root.children,nodes);
 });
 for(const state of ['loading','error']) await test(`index ${state} keeps the fallback`,()=>{
  const view=plainView(),h=setup([view]);h.taskCardIndexState=state;h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 for(const state of ['settling','unverified','recovery-required','unloading']) await test(`startup-ready index with live authority ${state} preserves a pending File Task`,()=>{
  const view=plainView(),h=setup([view]);view.source='---\noperonId: pending001\n---\nNew File Task';
  h.indexer.getLiveReadAuthoritySnapshot=()=>({state});h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 for(const kind of ['inline','file']) await test(`${kind} task not yet rendered remains refreshable`,()=>{
  const view=plainView(),h=setup([view]);h.indexer.getTaskIdsInFileSnapshot=()=>['task001'];h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 for(const [name,change] of [
  ['missing metadata',view=>view.metadata=null],['missing file',view=>view.file=null],
  ['detached preview',view=>view.root.isConnected=false],['missing preview root',view=>view.contentEl.children=[]],
  ['missing source reader',view=>view.getViewData=undefined],['source read error',view=>view.getViewData=()=>{throw Error('detached');}],
  ['metadata error',(_,h)=>h.app.metadataCache.getFileCache=()=>{throw Error('unavailable');}],
  ['unindexed checkbox metadata',view=>view.metadata.listItems=[{task:' '}]],
  ['unresolved link metadata',view=>view.metadata.links=[{link:'Missing.md'}]],
  ['Markdown embed metadata',view=>view.metadata.embeds=[{link:'Embedded.md'}]],
 ]) await test(`${name} cannot be classified as unrelated`,()=>{
  const view=plainView(),h=setup([view]);change(view,h);h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 for(const text of ['- [ ] New task', '[[Not indexed yet]]', '[Task](Task.md)', '[Task][reference]', '```operon\nfilter: Empty\n```', '> ~~~operon-table\npreset: Table\n~~~', '```operon-task\ntask001\n```']) await test(`loaded source protects a pending surface: ${JSON.stringify(text)}`,()=>{
  const view=plainView(),h=setup([view]);view.source=text;h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 for(const className of ['operon-embed','operon-table-embed','operon-dynamic-file-task-filter-host','operon-task-card','task-list-item','internal-embed']) await test(`existing ${className} keeps empty and populated surfaces refreshable`,()=>{
  const view=plainView(),h=setup([view]);view.root.append(new FixtureElement([className]));h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 await test('removed task wrappers keep the stale-row fallback even with an empty index',()=>{
  const view=plainView(),h=setup([view]);view.root.append(new FixtureElement([],{'data-operon-reading-task-id':'removed'}));
  h.indexer.getTask=()=>null;h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 await test('plain note becomes task-bearing on the next refresh without cached irrelevance',()=>{
  const view=plainView(),h=setup([view]);h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[]);
  view.source+='\n[[New task]]';h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[true]);
 });
 await test('explicit force overrides plain-note skip and false remains non-forcing for task notes',()=>{
  const view=plainView(),h=setup([view]);h.refreshMarkdownTaskSurfaces({forceReadingViewRerender:true});assert.deepEqual(view.calls,[true]);
  view.calls=[];h.refreshMarkdownTaskSurfaces({forceReadingViewRerender:false});assert.deepEqual(view.calls,[]);
 });
 await test('plain owned lightbox and scoped unrelated tabs skip while task tabs still refresh',()=>{
  const view=plainView(),task=new MarkdownView('Task.md'),h=setup([task]);h.app.ownedLeaves=[{view}];
  const result=h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.calls,[]);assert.deepEqual(task.calls,[true]);assert.equal(result.skippedLeaves,1);
  const scoped=h.refreshMarkdownTaskSurfaces({scope:{mode:'scoped',filePaths:['Plain.md'],reason:'test'}});assert.equal(scoped.skippedLeaves,2);
 });
 await test('plain Live Preview still receives the index effect',()=>{
  const view=plainView(),h=setup([view]);view.mode='source';h.refreshMarkdownTaskSurfaces();assert.deepEqual(view.editor.cm.effects,['index']);
 });
 console.log(`Reading refresh: ${count}/${count} passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
