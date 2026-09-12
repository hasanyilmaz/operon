import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(tmpdir(), 'operon-id-transaction-'));
try {
 const outfile = path.join(dir, 'test.mjs');
 await build({entryPoints:[path.join(root,'src/systems/task-id-repair-transaction.ts')], outfile, bundle:true, format:'esm', platform:'node', logLevel:'silent'});
 const { executeTaskIdRepairTransaction: execute } = await import(pathToFileURL(outfile).href);
 let count=0;
 const test=async(name,run)=>{await run();count++;console.log('PASS',name);};
 const setup=()=>{
  const values={owner:'old',refs:'old',dependency:'same'}; const writes=[];
  const resources=Object.entries(values).map(([key,before])=>({key,before,after:key==='dependency'?before:'new',read:async()=>values[key],compareAndSet:async(expected,next)=>{writes.push([key,expected,next]);if(values[key]!==expected)return false;values[key]=next;return true;}}));
  return {values,writes,resources};
 };
 await test('commits owner and references; unchanged dependencies are not written',async()=>{
  const s=setup();assert.equal(await execute(s.resources,async()=>true,()=>true),'committed');assert.deepEqual(s.values,{owner:'new',refs:'new',dependency:'same'});assert.equal(s.writes.length,2);
 });
 await test('Cancel before commit is zero-write',async()=>{const s=setup();assert.equal(await execute(s.resources,async()=>true,()=>false),'rolled-back');assert.equal(s.writes.length,0);});
 await test('changed dependency blocks before any write',async()=>{const s=setup();s.values.dependency='external';assert.equal(await execute(s.resources,async()=>true,()=>true),'rolled-back');assert.equal(s.writes.length,0);});
 await test('duplicate resource identity rejects plan',async()=>{const s=setup();assert.equal(await execute([...s.resources,s.resources[0]],async()=>true,()=>true),'rolled-back');assert.equal(s.writes.length,0);});
 await test('read failure before writing is safe rejection',async()=>{const s=setup();s.resources[0].read=async()=>{throw Error('offline');};assert.equal(await execute(s.resources,async()=>true,()=>true),'rolled-back');assert.equal(s.writes.length,0);});
 await test('failed reference write rolls back preceding owner',async()=>{const s=setup();s.resources[1].compareAndSet=async()=>false;assert.equal(await execute(s.resources,async()=>true,()=>true),'rolled-back');assert.equal(s.values.owner,'old');});
 for(const mode of ['throw','false']) await test('observes '+mode+' acknowledgement after successful write without replay',async()=>{
  const s=setup();const write=s.resources[0].compareAndSet;s.resources[0].compareAndSet=async(a,b)=>{await write(a,b);if(mode==='throw')throw Error('lost');return false;};
  assert.equal(await execute(s.resources,async()=>true,()=>true),'committed');assert.equal(s.writes.length,2);
 });
 await test('new source during transaction triggers rollback',async()=>{const s=setup();let inventory=true;const write=s.resources[0].compareAndSet;s.resources[0].compareAndSet=async(a,b)=>{const result=await write(a,b);inventory=false;return result;};assert.equal(await execute(s.resources,async()=>inventory,()=>true),'rolled-back');assert.equal(s.values.owner,'old');});
 await test('changed unchanged dependency during transaction is preserved',async()=>{const s=setup();const write=s.resources[0].compareAndSet;s.resources[0].compareAndSet=async(a,b)=>{const result=await write(a,b);s.values.dependency='external';return result;};assert.equal(await execute(s.resources,async()=>true,()=>true),'rolled-back');assert.equal(s.values.owner,'old');assert.equal(s.values.dependency,'external');});
 await test('concurrent edit to committed owner prevents destructive rollback',async()=>{const s=setup();s.resources[1].compareAndSet=async()=>{s.values.owner='external';return false;};assert.equal(await execute(s.resources,async()=>true,()=>true),'outcome-unknown');assert.equal(s.values.owner,'external');});
 await test('final dependency edit prevents success claim',async()=>{const s=setup();const write=s.resources[1].compareAndSet;s.resources[1].compareAndSet=async(a,b)=>{const result=await write(a,b);s.values.dependency='external';return result;};assert.equal(await execute(s.resources,async()=>true,()=>true),'outcome-unknown');});
 console.log(`${count}/${count} task ID repair transaction tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
