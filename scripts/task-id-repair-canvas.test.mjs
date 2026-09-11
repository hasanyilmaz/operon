import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-canvas-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const modules=[['createTaskIdRepairCanvasResources','src/systems/task-id-repair-canvas'],['executeTaskIdRepairTransaction','src/systems/task-id-repair-transaction'],['TaskIdReferenceRepair','src/core/task-id-repair-references'],['TFile','scripts/test-support/obsidian']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {createTaskIdRepairCanvasResources:create,executeTaskIdRepairTransaction:execute,TaskIdReferenceRepair,TFile}=await import(pathToFileURL(outfile).href);
 let count=0;const test=async(name,run)=>{await run();count++;console.log('PASS',name);};
 const setup=()=>{
  const original={'Board.canvas':JSON.stringify({nodes:[{id:'bad-id',type:'text',text:'Custom text',operonTask:{version:1,taskId:'bad-id'}}],edges:[{id:'bad-id',fromNode:'bad-id',toNode:'other'}]}),'Other.canvas':JSON.stringify({nodes:[],edges:[]})};
  const values={...original},buffers={...original},writes=[];let allowed=true;
  const files=Object.fromEntries(Object.keys(values).map(key=>[key,new TFile(key)]));
  const app={vault:{getAbstractFileByPath:key=>files[key]??null,getFiles:()=>Object.values(files),read:async file=>values[file.path],process:async(file,transform)=>{const next=transform(values[file.path]);writes.push(file.path);values[file.path]=next;return next;}}};
  const open={matches:(key,value)=>buffers[key]===value,synchronize:(key,before,after)=>{if(buffers[key]!==before)return false;buffers[key]=after;return true;}};
  const repair=new TaskIdReferenceRepair('bad-id','new1234');
  const sources=Object.entries(original).map(([filePath,content])=>({filePath,content}));
  const bundle=create(app,sources,repair,open,async()=>allowed);
  const run=()=>execute(bundle.resources,bundle.inventoryMatches,()=>true);
  return {original,values,buffers,writes,files,app,open,repair,sources,bundle,run,deny:()=>{allowed=false;}};
 };
 await test('updates task binding and open view, preserving node IDs, edges and custom text',async()=>{const s=setup();assert.equal(await s.run(),'committed');const result=JSON.parse(s.values['Board.canvas']);assert.equal(result.nodes[0].operonTask.taskId,'new1234');assert.equal(result.nodes[0].id,'bad-id');assert.equal(result.nodes[0].text,'Custom text');assert.deepEqual(result.edges,JSON.parse(s.original['Board.canvas']).edges);assert.deepEqual(s.buffers,s.values);assert.deepEqual(s.writes,['Board.canvas']);});
 await test('unsaved Canvas blocks zero-write',async()=>{const s=setup();s.buffers['Board.canvas']='unsaved';assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('new Canvas invalidates reference inventory',async()=>{const s=setup();s.files['New.canvas']=new TFile('New.canvas');assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('path policy rejection prevents writes',async()=>{const s=setup();s.deny();assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('external update between preflight and process is preserved',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{s.values[file.path]='external';s.buffers[file.path]='external';return process(file,transform);};assert.equal(await s.run(),'outcome-unknown');assert.equal(s.values['Board.canvas'],'external');assert.equal(s.writes.length,0);});
 await test('failed later resource rolls Canvas disk and view back together',async()=>{const s=setup();const failure={key:'state',before:'a',after:'b',read:async()=> 'a',compareAndSet:async()=>false};assert.equal(await execute([...s.bundle.resources,failure],s.bundle.inventoryMatches,()=>true),'rolled-back');assert.deepEqual(s.values,s.original);assert.deepEqual(s.buffers,s.original);assert.equal(s.writes.length,2);});
 await test('Canvas edited during process is not overwritten by view synchronization',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{const result=await process(file,transform);s.buffers[file.path]='user edit';return result;};assert.equal(await s.run(),'outcome-unknown');assert.equal(s.buffers['Board.canvas'],'user edit');});
 await test('unknown affected Canvas reference version rejects preparation',async()=>{const s=setup();const sources=[{filePath:'Board.canvas',content:s.original['Board.canvas'].replace('"version":1','"version":2')}];assert.throws(()=>create(s.app,sources,s.repair,s.open,async()=>true));assert.equal(s.writes.length,0);});
 console.log(`${count}/${count} task ID Canvas adapter tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
