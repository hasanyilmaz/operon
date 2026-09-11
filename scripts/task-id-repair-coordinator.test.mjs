import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-coordinator-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const modules=[['executeTaskIdRepair','src/systems/task-id-repair-coordinator'],['TaskWriter','src/core/task-writer'],['parseTaskLine','src/core/parser'],['TFile','scripts/test-support/obsidian']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {executeTaskIdRepair:execute,TaskWriter,parseTaskLine:parse,TFile}=await import(pathToFileURL(outfile).href);
 let count=0;const test=async(name,run)=>{await run();count++;console.log('PASS',name);};
 const setup=()=>{
  const original={'Owner.md':'- [ ] Owner {{operonId:: bad-id}}','Ref.md':'- [ ] Ref {{operonId:: ref0001}} {{parentTask:: bad-id}}'};
  const values={...original},buffers={...original},writes=[];
  const files=Object.fromEntries(Object.keys(values).map(key=>[key,new TFile(key)]));
  const control={allowed:true,fail:null,settleFailure:false,settlements:0};
  const app={vault:{getAbstractFileByPath:key=>files[key]??null,getFiles:()=>Object.values(files),getMarkdownFiles:()=>Object.values(files).filter(f=>f.extension==='md'),read:async file=>values[file.path],process:async(file,transform)=>{if(control.fail===file.path)throw Error('write refused');const next=transform(values[file.path]);writes.push(file.path);values[file.path]=next;return next;}}};
  const open={matches:(key,value)=>buffers[key]===value,synchronize:(key,before,after)=>{if(buffers[key]!==before)return false;buffers[key]=after;return true;}};
  const writer=new TaskWriter(app,{},[],{validatePluginWritePath:async()=>true,validateWritePath:async()=>false});
  const options={app,writer,target:{...parse(original['Owner.md'],0,'Owner.md',[]),format:'inline'},nextId:'new1234',modifiedAt:'2026-09-11T15:00:00',keyMappings:[],openMarkdown:open,openCanvas:open,openTables:open,canWritePath:async()=>true,canCommit:()=>control.allowed,settle:async(paths,id)=>{assert.deepEqual(paths,['Owner.md','Ref.md']);assert.equal(id,'new1234');control.settlements++;if(control.settleFailure)throw Error('index failed');}};
  return {values,buffers,writes,files,original,control,options,run:()=>execute(options)};
 };
 await test('repair changes the owner and exact references through the existing TaskWriter',async()=>{const s=setup();assert.equal(await s.run(),'committed');assert.match(s.values['Owner.md'],/operonId:: new1234/);assert.match(s.values['Ref.md'],/parentTask:: new1234/);assert.deepEqual(s.buffers,s.values);assert.equal(s.control.settlements,1);});
 await test('closed operation gate performs zero writes',async()=>{const s=setup();s.control.allowed=false;assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);assert.equal(s.control.settlements,0);});
 await test('duplicate raw owner rejects before any reference or source mutation',async()=>{const s=setup();s.values['Ref.md']='- [ ] Other {{operonId:: bad-id}}';s.buffers['Ref.md']=s.values['Ref.md'];await assert.rejects(s.run());assert.equal(s.writes.length,0);});
 await test('unsaved open source prevents entire repair',async()=>{const s=setup();s.buffers['Ref.md']='typing';assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);assert.equal(s.buffers['Ref.md'],'typing');});
 await test('later file write refusal restores earlier source changes',async()=>{const s=setup();s.control.fail='Ref.md';assert.equal(await s.run(),'rolled-back');assert.deepEqual(s.values,s.original);assert.deepEqual(s.buffers,s.original);assert.equal(s.control.settlements,0);});
 await test('failed index settlement reports uncertainty without replaying committed writes',async()=>{const s=setup();s.control.settleFailure=true;assert.equal(await s.run(),'outcome-unknown');assert.match(s.values['Owner.md'],/operonId:: new1234/);assert.equal(s.writes.filter(key=>key==='Owner.md').length,1);assert.equal(s.control.settlements,1);});
 console.log(`${count}/${count} task ID coordinator tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
