import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
const dir = 'contracts/agent-runtime/extensions/checkbox-ownership-v1';
const hash = v => createHash('sha256').update(v).digest('hex');
export async function schemas() {
 const ajv = new Ajv2020({ strict: true, strictSchema: false, strictRequired: false, strictTypes: false, validateFormats: false });
 for (const folder of ['contracts/agent-runtime/v1', 'contracts/agent-runtime/extensions/task-workflows-v1', dir]) {
  for (const file of (await readdir(folder)).filter(f => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(await readFile(path.join(folder,file),'utf8')));
 }
 return ajv;
}
test('checkbox ownership manifest seals independent schemas and all entrypoints compile', async () => {
 const manifest = JSON.parse(await readFile(path.join(dir,'extension-manifest.json'),'utf8'));
 const digest=manifest.aggregateSha256;delete manifest.aggregateSha256;
 assert.equal(hash(JSON.stringify(manifest)),digest);
 assert.equal(manifest.capabilities.length,9);assert.equal(manifest.cliSupport,'deferred');
 const ajv=await schemas();
 for(const doc of manifest.documents){const bytes=await readFile(path.join(dir,doc.file));assert.equal(hash(bytes),doc.sha256);assert.equal(JSON.parse(bytes).$id,doc.id);}
 for(const entry of manifest.entrypoints) assert.equal(typeof ajv.getSchema(entry.ref),'function',entry.ref);
});
test('new inputs reject legacy discriminators, unknown fields and unsupported conversion direction',async()=>{
 const ajv=await schemas(),validate=ajv.getSchema('urn:operon:schema:runtime:v1:extension:checkbox-ownership:read#/$defs/request');
 const input={contractVersion:1,requestId:'query-test',kind:'task-filter-query-contiguous',consistency:'live-verified',filterSetId:'filter1'};
 assert.equal(validate(input),true,JSON.stringify(validate.errors));
 assert.equal(validate({...input,kind:'task-filter-query'}),false);
 assert.equal(validate({...input,policy:'contiguous'}),false);
 const access=ajv.getSchema('urn:operon:schema:runtime:v1:extension:checkbox-ownership:developer-api#/$defs/accessRequest');
 const request={contractVersion:1,runtimeApi:{min:1,max:1},requestedCapabilities:['tasks.filter-query.contiguous']};
 assert.equal(access(request),true);assert.equal(access({...request,requestedCapabilities:['tasks.filter-query']}),false);assert.equal(access({...request,requestedCapabilities:[...request.requestedCapabilities,...request.requestedCapabilities]}),false);
});
