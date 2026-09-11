import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-markdown-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const modules=[['createTaskIdRepairMarkdownResources','src/systems/task-id-repair-markdown'],['executeTaskIdRepairTransaction','src/systems/task-id-repair-transaction'],['TaskWriter','src/core/task-writer'],['planTaskIdRepairSources','src/core/task-id-repair-sources'],['parseTaskLine','src/core/parser'],['TFile','scripts/test-support/obsidian']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {createTaskIdRepairMarkdownResources:create,executeTaskIdRepairTransaction:execute,TaskWriter,planTaskIdRepairSources:plan,parseTaskLine:parse,TFile}=await import(pathToFileURL(outfile).href);
 let count=0;const test=async(name,run)=>{await run();count++;console.log('PASS',name);};
 const setup=()=>{
  const original={'Owner.md':'- [ ] Owner {{operonId:: bad-id}}','Ref.md':'- [ ] Ref {{operonId:: ref0001}} {{parentTask:: bad-id}}','Note.md':'Unrelated'};
  const values={...original},buffers={...original},writes=[];
  const files=Object.fromEntries(Object.keys(values).map(key=>[key,new TFile(key)]));
  const app={vault:{getAbstractFileByPath:key=>files[key]??null,getMarkdownFiles:()=>Object.values(files),read:async file=>values[file.path],process:async(file,transform)=>{const next=transform(values[file.path]);writes.push(file.path);values[file.path]=next;return next;}}};
  const open={matches:(key,value)=>buffers[key]===value,synchronize:(key,before,after)=>{if(buffers[key]!==before)return false;buffers[key]=after;return true;}};
  const p=plan(Object.entries(original).map(([filePath,content])=>({filePath,content})),{...parse(original['Owner.md'],0,'Owner.md',[]),format:'inline'},'new1234','2026-09-11T15:00:00',[]);assert.equal(p.ok,true,p.reason);
  const writer=new TaskWriter(app,{},[],{validatePluginWritePath:async()=>true,validateWritePath:async()=>false});
  const run=()=>writer.runExclusiveTaskMutation(async permit=>{const bundle=create(app,writer,permit,p,open);return execute(bundle.resources,bundle.inventoryMatches,()=>true);});
  return {original,values,buffers,writes,files,app,open,p,writer,run};
 };
 await test('source planner commits through actual TaskWriter exclusive permit and plugin path policy',async()=>{const s=setup();assert.equal(await s.run(),'committed');assert.match(s.values['Owner.md'],/operonId:: new1234/);assert.match(s.values['Ref.md'],/parentTask:: new1234/);assert.deepEqual(s.buffers,s.values);assert.deepEqual(s.writes,['Owner.md','Ref.md']);});
 await test('unsaved unrelated editor blocks entire operation without writes',async()=>{const s=setup();s.buffers['Note.md']='typing';assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);assert.equal(s.buffers['Note.md'],'typing');});
 await test('new Markdown source invalidates complete inventory',async()=>{const s=setup();s.files['New.md']=new TFile('New.md');s.values['New.md']='new';assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('deleted source prevents any write',async()=>{const s=setup();delete s.files['Ref.md'];assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('unrecognized concurrent reference content stops with outcome unknown',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{if(file.path==='Ref.md'){s.values['Ref.md']='external';s.buffers['Ref.md']='external';}return process(file,transform);};assert.equal(await s.run(),'outcome-unknown');assert.equal(s.values['Owner.md'],'- [ ] Owner {{operonId:: new1234}} {{datetimeModified:: 2026-09-11T15:00:00}}');assert.equal(s.values['Ref.md'],'external');});
 await test('known failure before reference write rolls back preceding owner',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{if(file.path==='Ref.md')throw Error('write unavailable');return process(file,transform);};assert.equal(await s.run(),'rolled-back');assert.equal(s.values['Owner.md'],s.original['Owner.md']);assert.equal(s.buffers['Owner.md'],s.original['Owner.md']);});
 await test('editor edit during disk commit remains untouched and outcome is uncertain',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{const result=await process(file,transform);s.buffers[file.path]='typing';return result;};assert.equal(await s.run(),'outcome-unknown');assert.equal(s.buffers['Owner.md'],'typing');assert.equal(s.writes.length,1);});
 await test('duplicate or unsealed plan entries cannot create resources',async()=>{const s=setup();await s.writer.runExclusiveTaskMutation(async permit=>{assert.throws(()=>create(s.app,s.writer,permit,{...s.p,readSet:[...s.p.readSet,s.p.readSet[0]]},s.open));assert.throws(()=>create(s.app,s.writer,permit,{...s.p,changes:[{filePath:'Other.md',before:'x',after:'y'}]},s.open));});assert.equal(s.writes.length,0);});
 console.log(`${count}/${count} task ID Markdown adapter tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
