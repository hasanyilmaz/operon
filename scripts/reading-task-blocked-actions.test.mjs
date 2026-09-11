import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-reading-blocked-'));
try {
 const outfile=path.join(dir,'test.mjs');
 await build({stdin:{contents:`export {guardReadingTaskRowActions} from ${JSON.stringify(path.join(root,'src/ui/reading-task-row'))};`,resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {guardReadingTaskRowActions:guard}=await import(pathToFileURL(outfile).href);
 const actions=['openEditor','cycleStatus','navigateToTask','updateField','onContextualAction','toggleTimer','requestSubtask','updateFields','updateSubtasks','updateDependencyField','updateRepeatSeriesInlineCompletionMode'];
 let calls=0,blocked=0;const original=Object.fromEntries(actions.map(key=>[key,()=>{calls++;}]));
 const settings={};original.getSettings=()=>settings;original.isTaskPinned=()=>true;
 const safe=guard(original,()=>{blocked++;});
 for(const action of actions){await safe[action]('bad-id');assert.equal(calls,0,action);}
 assert.equal(blocked,actions.length);
 assert.equal(safe.updateFields('bad-id',{}),false);
 assert.equal(safe.getSettings(),settings);assert.equal(safe.isTaskPinned('bad-id'),true);
 assert.notEqual(original.openEditor,safe.openEditor);
 const minimal=guard({openEditor(){},cycleStatus(){},navigateToTask(){},updateField(){}},()=>{});
 assert.equal(minimal.toggleTimer,undefined);assert.equal(minimal.onContextualAction,undefined);
 console.log('Reading blocked actions: 11/11 action callbacks blocked; display providers preserved');
 const lpSource=fs.readFileSync(path.join(root,'src/ui/live-preview-conceal.ts'),'utf8');
 const ast=ts.createSourceFile('lp.ts',lpSource,ts.ScriptTarget.Latest,true);
 const names=['blockInvalidLivePreviewTaskAction','bindInvalidLivePreviewTaskActions'];
 const methods=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
 const lpOut=path.join(dir,'lp.mjs');
 await build({stdin:{contents:`import {isValidOperonId} from ${JSON.stringify(path.join(root,'src/core/id-generator'))};${methods}`,loader:'ts',resolveDir:root},outfile:lpOut,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const lp=await import(pathToFileURL(lpOut).href);
 let tested=0;
 for(const id of ['bad-id','',null,'abc1234']){
  const node=new EventTarget();let blocked=0,actions=0;const task={operonId:id};
  lp.bindInvalidLivePreviewTaskActions(node,task,{onBlockedTaskAction:source=>{assert.equal(source,task);blocked++;}});
  for(const name of ['click','auxclick','contextmenu','dragstart','keydown'])node.addEventListener(name,()=>{actions++;});
  for(const [name,key] of [['click'],['auxclick'],['contextmenu'],['dragstart'],['keydown','Enter'],['keydown',' ']]){
   const event=new Event(name,{cancelable:true});if(key)Object.defineProperty(event,'key',{value:key});node.dispatchEvent(event);
   assert.equal(event.defaultPrevented,id!=='abc1234');tested++;
  }
  assert.equal(blocked,id==='abc1234'?0:6);assert.equal(actions,id==='abc1234'?6:0);
  const arrow=new Event('keydown',{cancelable:true});Object.defineProperty(arrow,'key',{value:'ArrowRight'});node.dispatchEvent(arrow);assert.equal(arrow.defaultPrevented,false);
 }
 assert.equal(lp.blockInvalidLivePreviewTaskAction({operonId:'bad-id'},{}),true);
 console.log(`Live Preview blocked actions: ${tested}/${tested} activation events checked; caret navigation preserved`);

} finally {fs.rmSync(dir,{recursive:true,force:true});}
