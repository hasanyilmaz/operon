import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-main-'));
try {
 const source=fs.readFileSync(path.join(root,'main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonPlugin');
 const method=cls.members.find(n=>n.name?.getText(ast)==='requestInvalidTaskIdRepair').getText(ast);
 const editorMethod=cls.members.find(n=>n.name?.getText(ast)==='openTaskEditorFor').getText(ast);
 const registration=cls.members.find(n=>n.name?.getText(ast)==='registerInlineTaskBar');
 let cycle;
 const visit=node=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='cycleStatus'&&node.initializer.getText(ast).startsWith('(task: ParsedTask,'))cycle=node.initializer.getText(ast);ts.forEachChild(node,visit);};
 visit(registration);assert.ok(cycle);
 const outfile=path.join(dir,'test.mjs');
 const prelude=`export const calls={prompt:0,execute:0,released:0,nativeReleased:0,confirm:true,outcome:'committed',pause:null};class Notice{constructor(message){}};function generateOperonId(){return 'new1234';}function localNow(){return '2026-09-11T15:00:00';}class TaskIdReferenceRepair{constructor(...args){}};async function requestTaskIdRepair(app,target,repair){calls.prompt++;if(calls.pause)await calls.pause;if(!calls.confirm)return {confirmed:false};return {confirmed:true,result:await repair(target)};}function createTaskIdRepairCanvasViewSources(){return {matches:()=>true,synchronize:()=>true,release(){calls.nativeReleased++;}};}function parseOperonTableFile(){return {status:'invalid'};}async function executeTaskIdRepair(options){calls.execute++;calls.options=options;if(calls.outcome==='committed')await options.settle(['Note.md']);return calls.outcome;}function isValidOperonId(id){return /^[a-z0-9]{7}$/.test(id);}export class Harness{${method} ${editorMethod} cycle=${cycle};}`;
 await build({stdin:{contents:prelude,resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const {Harness,calls}=await import(pathToFileURL(outfile).href);
 const target={format:'inline',filePath:'Note.md',lineNumber:0,rawLine:'- [ ] Task {{operonId:: bad-id}}',operonId:'bad-id'};
 const setup=()=>{Object.assign(calls,{prompt:0,execute:0,released:0,nativeReleased:0,confirm:true,outcome:'committed',pause:null});const h=new Harness();Object.assign(h,{app:{workspace:{getLeavesOfType:()=>[]}},writer:{},settings:{keyMappings:[]},reminderScheduler:{},storage:{suspendCanonicalSettingsWrites(){h.suspended=true;}},tablePresetRegistry:{refresh:async()=>{}},indexer:{forceReindexFilePathAfterMutation:async()=>{h.reindexed=true;},getTask:()=>({primary:{filePath:'Note.md'}})},canvasTaskIntegration:{reserveTaskIdRepairViews:()=>({views:[],isCurrent:()=>true,release(){calls.released++;}})},syncTablePresetProjectionFromRegistry(){},refreshViews(){h.refreshes++;},refreshes:0});return h;};
 let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
 await test('Cancel never enters transaction or reserves native state',async()=>{const h=setup();calls.confirm=false;await h.requestInvalidTaskIdRepair(target);assert.equal(calls.execute,0);assert.equal(calls.released,0);assert.equal(calls.nativeReleased,0);assert.equal(h.refreshes,0);assert.equal(h.taskIdRepairPromptActive,false);});
 await test('confirmation invokes coordinator without reserving native Canvas state',async()=>{const h=setup();await h.requestInvalidTaskIdRepair(target);assert.equal(calls.execute,1);assert.equal(calls.options.target,target);assert.equal(calls.options.nextId,'new1234');assert.equal(h.reindexed,true);assert.equal(calls.released,0);assert.equal(calls.nativeReleased,0);assert.equal(h.taskIdRepairActive,false);assert.equal(h.refreshes,1);});
 await test('unknown outcome prevents automatic repair retry',async()=>{const h=setup();calls.outcome='outcome-unknown';await h.requestInvalidTaskIdRepair(target);assert.equal(h.taskIdRepairUncertain,true);await h.requestInvalidTaskIdRepair(target);assert.equal(calls.prompt,1);assert.equal(calls.execute,1);});
 await test('repeated action while prompt is pending does not open a second dialog',async()=>{const h=setup();let release;calls.confirm=false;calls.pause=new Promise(resolve=>{release=resolve;});const first=h.requestInvalidTaskIdRepair(target);await h.requestInvalidTaskIdRepair(target);assert.equal(calls.prompt,1);release();await first;assert.equal(calls.execute,0);});
 await test('existing inline editor blocks malformed and missing IDs before opening or saving',async()=>{
  for(const id of ['bad-id','ABCDEFG','abcdefgh','',null]){
   const h=setup();let requested;let saves=0;
   h.requestInvalidTaskIdRepair=async value=>{requested=value;};
   h.indexer.getTask=()=>{throw new Error('must not open editor');};
   const task={operonId:id,filePath:'Note.md',lineNumber:3,rawLine:'- [ ] Task {{priority:: 2}}',fields:[{key:'priority',value:'2'}]};
   await h.openTaskEditorFor(task,async()=>{saves++;});
   assert.deepEqual(requested,{...task,format:'inline'});assert.equal(saves,0);
  }
 });
 await test('valid inline IDs continue into the existing editor route',async()=>{
  const h=setup();let repairs=0;h.requestInvalidTaskIdRepair=async()=>{repairs++;};
  h.indexer.getTask=()=>{throw new Error('existing editor route');};
  await assert.rejects(h.openTaskEditorFor({operonId:'abc1234',rawLine:'- [ ] Task',fields:[{}]},async()=>{}),/existing editor route/);
  assert.equal(repairs,0);
 });
 await test('Live Preview icon routes invalid and missing IDs to repair without cycling',async()=>{
  const h=setup();const repaired=[],cycled=[];
  h.requestInvalidTaskIdRepair=async task=>{repaired.push(task);};h.handleTaskIconClick=async id=>{cycled.push(id);};
  for(const id of ['bad-id','',null])h.cycle({...target,operonId:id},{});
  assert.deepEqual(repaired.map(task=>task.operonId),['bad-id','',null]);assert.deepEqual(cycled,[]);
  h.cycle({...target,operonId:'abc1234'},{});assert.deepEqual(cycled,['abc1234']);
 });
 console.log(`${count}/${count} main ID repair controller tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
