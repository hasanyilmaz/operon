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
 const methods=['refreshMarkdownTaskSurfaces','runScheduledIndexSideEffects'].map(name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast));
 const outfile=path.join(dir,'test.mjs');
 const prelude=`import {createGlobalMarkdownRefreshScope} from ${JSON.stringify(path.join(root,'src/core/markdown-refresh-scope'))};
 export class EditorView{dispatch(value){this.effects=value.effects;}}
 export class MarkdownView{constructor(filePath,mode='preview'){this.file={path:filePath};this.mode=mode;this.calls=[];this.indexValue='loading';this.rendered='loading';this.editor={cm:new EditorView()};this.previewMode={rerender:force=>{this.calls.push(force);if(force)this.rendered=this.indexValue;}};}getMode(){return this.mode;}}
 const operonIndexRefreshEffect={of:()=> 'index'},operonEditorCloseRefreshEffect={of:()=> 'close'},operonTaskWikilinkForceRevealEffect={of:value=>value};
 const getEditorViewFromEditor=editor=>editor.cm;
 const refreshEmbeddedMarkdownSourceEditors=()=>({refreshedEditors:0,skippedEditors:0});
 const enginePerfNow=()=>0,enginePerfLog=()=>{};
 export class Harness{${methods.join('\n')}}`;
 await build({stdin:{contents:prelude,resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const {Harness,MarkdownView}=await import(pathToFileURL(outfile).href);
 const setup=(views)=>{const h=new Harness();h.app={workspace:{getLeavesOfType:()=>views.map(view=>({view}))}};return h;};
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
 await test('startup readiness already schedules an authoritative refresh',()=>{
  let ready;const visit=node=>{if(ts.isExpressionStatement(node)&&node.getText(ast)==="this.taskCardIndexState = 'ready';")ready=node;ts.forEachChild(node,visit);};visit(cls);
  assert.ok(ready);const statements=ready.parent.statements;const index=statements.indexOf(ready);
  assert.ok(statements.slice(index+1).some(n=>n.getText(ast)==='this.refreshViews();'));
 });
 console.log(`Reading refresh: ${count}/${count} passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
