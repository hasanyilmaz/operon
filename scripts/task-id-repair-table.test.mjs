import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-table-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const modules=[['repairTableTaskReferences','src/systems/task-id-repair-table'],['createDefaultTablePreset','src/types/table'],['serializeOperonTableFile','src/storage/table-file'],['createTaskIdRepairTableResources','src/systems/task-id-repair-table'],['executeTaskIdRepairTransaction','src/systems/task-id-repair-transaction'],['TaskIdReferenceRepair','src/core/task-id-repair-references'],['TFile','scripts/test-support/obsidian']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {repairTableTaskReferences,createDefaultTablePreset,serializeOperonTableFile,createTaskIdRepairTableResources:create,executeTaskIdRepairTransaction:execute,TaskIdReferenceRepair,TFile}=await import(pathToFileURL(outfile).href);
 let count=0;const test=async(name,run)=>{await run();count++;console.log('PASS',name);};
 const setup=()=>{
  const preset=createDefaultTablePreset();preset.expandedTaskTreeIds=['bad-id','other01'];preset.search.parent={mode:'pt',parentId:'bad-id',parentName:'Keep name'};const original={'Board.table':serializeOperonTableFile(preset),'Other.table':serializeOperonTableFile({...createDefaultTablePreset(),id:'other-table'})};
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
 await test('updates tree and parent references while preserving all other table data',async()=>{const s=setup();assert.equal(await s.run(),'committed');const before=JSON.parse(s.original['Board.table']),after=JSON.parse(s.values['Board.table']);assert.deepEqual(after,{...before,expandedTaskTreeIds:['new1234','other01'],search:{...before.search,parent:{...before.search.parent,parentId:'new1234'}}});assert.deepEqual(s.writes,['Board.table']);assert.deepEqual(s.buffers,s.values);});
 await test('legacy v4 source is not migrated by ID repair',async()=>{const s=setup(),raw=JSON.parse(s.original['Board.table']);raw.version=4;delete raw.gantt;const after=JSON.parse(repairTableTaskReferences(JSON.stringify(raw),s.repair));assert.equal(after.version,4);assert.equal(Object.hasOwn(after,'gantt'),false);assert.equal(after.search.parent.parentId,'new1234');});
 await test('pending Table edits reject repair before writing',async()=>{const s=setup();s.buffers['Board.table']='pending';assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('new table invalidates complete reference inventory',async()=>{const s=setup();s.files['New.table']=new TFile('New.table');assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('policy denied path remains untouched',async()=>{const s=setup();s.deny();assert.equal(await s.run(),'rolled-back');assert.equal(s.writes.length,0);});
 await test('concurrent Table edit at write boundary is preserved',async()=>{const s=setup();const process=s.app.vault.process;s.app.vault.process=async(file,transform)=>{s.values[file.path]='external';s.buffers[file.path]='external';return process(file,transform);};assert.equal(await s.run(),'outcome-unknown');assert.equal(s.values['Board.table'],'external');assert.equal(s.writes.length,0);});
 await test('later failure restores original file and view',async()=>{const s=setup();const fail={key:'later',before:'a',after:'b',read:async()=> 'a',compareAndSet:async()=>false};assert.equal(await execute([...s.bundle.resources,fail],s.bundle.inventoryMatches,()=>true),'rolled-back');assert.deepEqual(s.values,s.original);assert.deepEqual(s.buffers,s.original);});
 await test('unchanged reference source stays byte-identical',async()=>{const s=setup();assert.equal(repairTableTaskReferences(s.original['Other.table'],s.repair),s.original['Other.table']);});
 await test('invalid table source is not normalized or rewritten',async()=>{const s=setup();assert.throws(()=>repairTableTaskReferences('{"version":999}',s.repair));assert.equal(s.writes.length,0);});
 console.log(`${count}/${count} task ID Table adapter tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
