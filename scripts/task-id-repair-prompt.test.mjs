import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-prompt-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const modules=[['requestTaskIdRepair','src/ui/task-id-repair-prompt'],['Modal','scripts/test-support/obsidian']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {requestTaskIdRepair:request,Modal}=await import(pathToFileURL(outfile).href);
 let shown=[];Modal.prototype.open=function(){shown.push(this);};
 let count=0;const test=async(name,run)=>{shown=[];await run();count++;console.log('PASS',name);};
 const target=()=>({format:'inline',filePath:'Note.md',lineNumber:4,rawLine:'- [ ] Task {{operonId:: bad-id}}',operonId:'bad-id'});
 await test('Cancel never calls repair',async()=>{let writes=0;const promise=request({},target(),async()=>{writes++;});assert.equal(shown.length,1);shown[0].finish(false);assert.deepEqual(await promise,{confirmed:false});assert.equal(writes,0);});
 await test('closing the shared modal never calls repair',async()=>{let writes=0;const promise=request({},target(),async()=>{writes++;});shown[0].close();assert.deepEqual(await promise,{confirmed:false});assert.equal(writes,0);});
 await test('confirmation calls repair once even with repeated modal signals',async()=>{let writes=0;const promise=request({},target(),async()=>{writes++;return 'committed';});assert.equal(writes,0);shown[0].finish(true);shown[0].finish(true);shown[0].close();assert.deepEqual(await promise,{confirmed:true,result:'committed'});assert.equal(writes,1);});
 await test('confirmation keeps the original source snapshot',async()=>{const original=target();let received;const promise=request({},original,async snapshot=>{received=snapshot;});original.rawLine='user edited source';original.lineNumber=99;shown[0].finish(true);await promise;assert.equal(received.lineNumber,4);assert.match(received.rawLine,/bad-id/);});
 await test('valid canonical ID cannot enter repair prompt',async()=>{let writes=0;assert.deepEqual(await request({},{...target(),operonId:'abc1234'},async()=>{writes++;}),{confirmed:false});assert.equal(shown.length,0);assert.equal(writes,0);});
 await test('repair error propagates without replay',async()=>{let writes=0;const promise=request({},target(),async()=>{writes++;throw Error('conflict');});shown[0].finish(true);await assert.rejects(promise,/conflict/);assert.equal(writes,1);});
 await test('agreed message and buttons reuse shared modal',async()=>{const promise=request({},target(),async()=>{});assert.equal(shown[0].options.title,'Incompatible task ID');assert.equal(shown[0].options.confirmText,'Regenerate ID');assert.equal(shown[0].options.cancelText,'Cancel');assert.match(shown[0].options.message,/exactly 7 lowercase letters or numbers/);assert.equal(shown[0].options.initialFocus,'cancel');shown[0].close();await promise;});
 console.log(`${count}/${count} task ID prompt tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
