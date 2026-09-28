import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = await readFile(path.join(root, 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
const methodNames = ['beginAgentRuntimeConversionIdentityTransition', 'reindexAgentRuntimeTaskSourceWrite', 'reindexAgentRuntimeGraphCommittedPrefix', 'applyUiCanonicalConversion', 'refreshUiConversionViews'];
const methods = methodNames.map(name => {
 const method = plugin.members.find(node => node.name?.getText(ast) === name);
 assert.ok(method, name); return method.getText(ast);
}).join('\n');
const localNames = ['graphResourceState', 'readGraphResourceState', 'graphStatesMatch', 'verifyGraphSteps', 'applyGraphStep', 'requireGraphStep'];
const portNames = ['commitMutationTransaction', 'recoverMutationTransaction', 'verifyRecoveredMutationTransaction'];
const locals = new Map(), ports = new Map();
function visit(node) {
 if (ts.isVariableDeclaration(node) && localNames.includes(node.name.getText(ast)) && !locals.has(node.name.getText(ast))) locals.set(node.name.getText(ast), `const ${node.getText(ast)};`);
 if (ts.isPropertyAssignment(node) && portNames.includes(node.name.getText(ast)) && !ports.has(node.name.getText(ast))) ports.set(node.name.getText(ast), node.getText(ast));
 ts.forEachChild(node, visit);
}
visit(plugin);
assert.equal(locals.size, localNames.length); assert.equal(ports.size, portNames.length);
// Reuse the receipt suite's IndexedDB implementation without loading its test cases.
const receiptSource = await readFile(path.join(root, 'scripts/agent-runtime/receipts/indexeddb-receipt-store.test.ts'), 'utf8');
const receiptAst = ts.createSourceFile('receipts.ts', receiptSource, ts.ScriptTarget.Latest, true);
const receiptClassNames = ['FakeIndexedDbFactory', 'FakeDatabase', 'FakeRequest', 'FakeOpenRequest', 'FakeTransaction', 'FakeObjectStore'];
const receiptClasses = receiptClassNames.map(name => {
 const declaration = receiptAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
 assert.ok(declaration, name); return declaration.getText(receiptAst);
}).join('\n');
const dir = await mkdtemp(path.join(tmpdir(), 'operon-conversion-identity-'));
try {
 const outfile = path.join(dir, 'tests.mjs');
 await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import test from 'node:test';
import {TFile,TFolder} from 'obsidian';
import {OperonIndexer} from './src/indexer/indexer';
import {TaskWriter} from './src/core/task-writer';
import {RuntimeMutationGatewayV1} from './src/agent-runtime/runtime/mutation-gateway';
import {IndexedDbMutationReceiptStoreV1} from './src/agent-runtime/runtime/receipts';
import {decodeMutationApplyRequestV1} from './src/agent-runtime/contracts/v1';
import {conversionPreparationFailure} from './src/systems/plugin-ui-conversion-transaction';
${receiptClasses}
if(typeof window==='undefined')globalThis.window=globalThis;
const Platform={isMobile:false};
const getActiveWindow=()=>globalThis;
const t=(_domain,key)=>key;
const createScopedMarkdownRefreshScope=paths=>({paths});
import {DEFAULT_SETTINGS} from './src/types/settings';
import {canonicalJsonV1,toJsonValueV1,sha256HexV1} from './src/agent-runtime/contracts/v1/canonical';
import {sourceRevisionForTaskCreationV1} from './src/agent-runtime/runtime/task-creation-adapter';
import {reindexCommittedRuntimeTaskSourceWriteV1} from './src/agent-runtime/runtime';
import {executeRuntimeGraphTransactionCommitV1,executeRuntimeGraphTransactionRecoveryV1} from './src/agent-runtime/runtime/graph-transaction-executor';
import {collectScopedPlainCheckboxMoveLines,removePlainCheckboxMoveLinesFromContent} from './src/core/plain-checkbox-lines';
class Probe {
${methods}
ports(){ ${localNames.map(name=>locals.get(name)).join('\n')}
return {${portNames.map(name=>ports.get(name)).join(',\n')}}; }
}
` + String.raw`
const state = content => ({state:content===null?'absent':'present',content,digest:sha256HexV1(content??'')});
async function fixture({direction='inline-to-file',child=true,checkbox=true,carry=true,policy='contiguous'}={}) {
 const files=new Map(),contents=new Map(),writes=[];
 let failSource=false,afterCreate=null;
 function put(p,c){let f=files.get(p)??new TFile(p); f.stat={mtime:1750000000000,ctime:1750000000000,size:c.length};files.set(p,f);contents.set(p,c);return f;}
 const childText=child?'\n- [ ] Child {{operonId:: child01}} {{parentTask:: parent1}}\n- [ ] Dependent {{operonId:: depend1}} {{blockedBy:: parent1}}':'';
 const boxes=checkbox?'\n- [ ] Own\n  - [x] Nested\n\n- [ ] Outside':'';
 const sourceBefore=direction==='inline-to-file'?'- [ ] Parent {{operonId:: parent1}}'+boxes+childText:'---\noperonId: parent1\n---\nBody';
 const targetBefore=direction==='inline-to-file'?null:'\nKeep'+childText;
 const beforeLocator={filePath:'Source.md',representation:direction==='inline-to-file'?'inline':'file',...(direction==='inline-to-file'?{lineNumber:0}:{})};
 const afterLocator={filePath:'Target.md',representation:direction==='inline-to-file'?'file':'inline',...(direction==='inline-to-file'?{}:{lineNumber:0})};
 let sourceAfter=null,targetAfter='- [ ] Parent {{operonId:: parent1}}'+targetBefore;
 if(direction==='inline-to-file') {
  const rows=carry?collectScopedPlainCheckboxMoveLines(sourceBefore,'Source.md',[],{kind:'inline',operonId:'parent1'},0,policy):[];
  sourceAfter=removePlainCheckboxMoveLinesFromContent(sourceBefore,0,rows).replace('- [ ] Parent {{operonId:: parent1}}','[[Target]]');
  targetAfter='---\noperonId: parent1\n---\n'+rows.map(row=>row.rawLine).join('\n');
 }
 put('Source.md',sourceBefore);if(targetBefore!==null)put('Target.md',targetBefore);
 const app={vault:{getAbstractFileByPath:p=>p===''?new TFolder(''):files.get(p)??null,read:async f=>contents.get(f.path),cachedRead:async f=>contents.get(f.path),
  create:async(p,c)=>{writes.push(['create',p]);const file=put(p,c);await afterCreate?.();return file},
  modify:async(f,c)=>{if(failSource&&f.path==='Source.md')throw Error('source write failure');writes.push(['modify',f.path]);put(f.path,c)}},
  fileManager:{trashFile:async f=>{if(failSource&&f.path==='Source.md')throw Error('source trash failure');writes.push(['trash',f.path]);files.delete(f.path);contents.delete(f.path)}}};
 const settings={...DEFAULT_SETTINGS,keyMappings:[]};
 const indexer=new OperonIndexer(app,{getSettings:()=>settings});
 const reindex=async p=>{const file=files.get(p);if(file)await indexer.forceReindexKnownFileAfterMutation(file,{notify:false},contents.get(p));else await indexer.forceRemoveFilePathAfterMutation(p,{notify:false});};
 for(const p of files.keys())await reindex(p);
 const probe=new Probe();Object.assign(probe,{app,indexer,settings,writer:new TaskWriter(app,indexer,[]),readAgentRuntimeMutationSource:async p=>({content:contents.get(p)??null})});
 const steps=[{stepId:'target',groupId:'target',resourceKind:'task-source',resourceKey:'Target.md',operation:targetBefore===null?'create':'modify',before:state(targetBefore),after:state(targetAfter)},
 {stepId:'source',groupId:'source',resourceKind:'task-source',resourceKey:'Source.md',operation:sourceAfter===null?'delete':'modify',before:state(sourceBefore),after:state(sourceAfter)}];
 const journal={phase:'prepared',completedStepCount:0,steps};
 const plan={spec:{operation:'convert'},mutationKind:'task.convert',targets:[{operonId:'parent1',locator:beforeLocator}],conversionEffect:{operonId:'parent1',direction,beforeLocator,afterLocator},atomicGroups:steps.map(step=>({groupId:step.groupId,resources:[{resourceKind:'task-source',resourceKey:step.resourceKey}]}))};
 const request={plan};const checkpoint=async value=>Object.assign(journal,value);
 const ports=probe.ports();
 return {probe,indexer,contents,files,writes,put,reindex,ports,journal,plan,request,steps,sourceBefore,sourceAfter,targetBefore,targetAfter,checkpoint,
  commit:(cp=checkpoint,policy)=>ports.commitMutationTransaction(request,{token:{kind:'source-transition'}},'2026-09-28',journal,cp,policy),
  recover:(cp=checkpoint)=>ports.recoverMutationTransaction(request,journal,cp),
  verify:()=>ports.verifyRecoveredMutationTransaction(request,journal),
  failSource:()=>{failSource=true},afterCreate:fn=>{afterCreate=fn}};
}
for(const direction of ['inline-to-file','file-to-inline'])test('private UI buffer guard stops '+direction+' before source cleanup',async()=>{
 const f=await fixture({direction});let writes=0;
 const result=await f.commit(f.checkpoint,{conversionSources:{canWrite:()=>writes===0,didWrite:()=>{writes++;return true}}});
 assert.equal(result.status,'partial');assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.contents.get('Target.md'),f.targetAfter);assert.equal(writes,1);
});
test('private UI guard denies the first write without mutating source or target',async()=>{
 const f=await fixture();const result=await f.commit(f.checkpoint,{conversionSources:{canWrite:()=>false,didWrite:()=>assert.fail('no write')}});
 assert.equal(result.status,'failed');assert.equal(f.writes.length,0);
});
test('post-write UI callback failure releases allowance without replaying',async()=>{
 const f=await fixture();await assert.rejects(f.commit(f.checkpoint,{conversionSources:{canWrite:()=>true,didWrite:()=>false}}),/open buffer changed/);
 assert.equal(f.writes.length,1);assert.equal(f.contents.get('Source.md'),f.sourceBefore);
 await f.reindex('Target.md');assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
test('unprotected real writer reproduces the source-cleanup failure',async()=>{
 const f=await fixture();f.probe.beginAgentRuntimeConversionIdentityTransition=async()=>()=>{};
 assert.equal((await f.commit()).status,'partial');assert.equal(f.contents.get('Source.md'),f.sourceBefore);
 assert.equal(f.contents.get('Target.md'),f.targetAfter);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
for(const child of [false,true])for(const checkbox of [false,true])for(const carry of [false,true])for(const policy of ['legacy-v1','contiguous']) {
 test('inline to file: '+JSON.stringify({child,checkbox,carry,policy}),async()=>{
  const f=await fixture({child,checkbox,carry,policy});const result=await f.commit();
  assert.equal(result.status,'committed');assert.equal(f.contents.get('Source.md'),f.sourceAfter);assert.equal(f.contents.get('Target.md'),f.targetAfter);
  assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);assert.equal(await f.verify(),true);
  if(child){assert.equal(f.indexer.getTask('child01').primary.filePath,'Source.md');assert.equal(f.indexer.getTask('child01').fieldValues.parentTask,'parent1');assert.equal(f.indexer.getTask('depend1').fieldValues.blockedBy,'parent1');}
  if(checkbox){assert.equal(f.targetAfter.includes('Own'),carry);assert.equal(f.targetAfter.includes('Outside'),carry&&policy==='legacy-v1');assert.equal(f.sourceAfter.includes('Outside'),!(carry&&policy==='legacy-v1'));}
 });
}
for(const child of [false,true])test('file to inline preserves destination relationships: '+child,async()=>{
 const f=await fixture({direction:'file-to-inline',child});assert.equal((await f.commit()).status,'committed');
 assert.equal(f.files.has('Source.md'),false);assert.equal(f.contents.get('Target.md'),f.targetAfter);assert.equal(await f.verify(),true);
 if(child)assert.equal(f.indexer.getTask('child01').fieldValues.parentTask,'parent1');
});
for(const direction of ['inline-to-file','file-to-inline'])test(direction+': interruption releases allowance and same-plan recovery reaches one identity',async()=>{
 const f=await fixture({direction});await assert.rejects(f.commit(async value=>{await f.checkpoint(value);if(value.completedStepCount===1)throw Error('checkpoint acknowledgement lost')}));
 assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
 const recovery=await f.recover();assert.equal(recovery.status,'forward-completed',JSON.stringify({recovery,writes:f.writes,contents:[...f.contents]}));assert.equal(await f.verify(),true);
 assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);const count=f.writes.length;
 assert.equal((await f.recover()).status,'forward-completed');assert.equal(f.writes.length,count);
});
test('recovery restores a stale index projection from exact sealed source snapshots',async()=>{
 const f=await fixture();f.put('Target.md',f.targetAfter);f.journal.phase='committing';f.journal.completedStepCount=1;
 assert.equal(f.indexer.getTask('parent1').primary.format,'inline');assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);
 assert.equal((await f.recover()).status,'forward-completed');assert.equal(await f.verify(),true);
});
test('ancestor source and recurrence state remain in the same prepared transaction',async()=>{
 const f=await fixture();const ancestorBefore='- [ ] Ancestor {{operonId:: ancestor1}} {{datetimeModified:: 2026-09-01T12:00:00}}';
 const ancestorAfter=ancestorBefore.replace('2026-09-01','2026-09-28');f.put('Ancestor.md',ancestorBefore);await f.reindex('Ancestor.md');
 let entry={sourceTaskId:'parent1',sourceFormat:'inline'},revision=0;
 f.probe.storage={repeatSeries:{getEntry:()=>entry,getRevision:()=>revision,compareAndSetEntry:async(_id,before,after)=>{if(canonicalJsonV1(toJsonValueV1(entry))!==canonicalJsonV1(toJsonValueV1(before)))return 'conflict';entry=after;revision++;return 'committed'}}};
 const extra=[{stepId:'ancestor',groupId:'ancestor',resourceKind:'task-source',resourceKey:'Ancestor.md',operation:'modify',before:state(ancestorBefore),after:state(ancestorAfter)},
 {stepId:'repeat',groupId:'repeat',resourceKind:'repeat-series',resourceKey:'series1',operation:'modify',before:state(canonicalJsonV1(toJsonValueV1(entry))),after:state(canonicalJsonV1(toJsonValueV1({...entry,sourceFormat:'yaml'})))}];
 f.journal.steps.push(...extra);f.plan.atomicGroups.push(...extra.map(step=>({groupId:step.groupId,resources:[{resourceKind:step.resourceKind,resourceKey:step.resourceKey}]})));
 assert.equal((await f.commit()).status,'committed');assert.equal(f.contents.get('Ancestor.md'),ancestorAfter);assert.equal(entry.sourceFormat,'yaml');assert.equal(revision,1);assert.equal(await f.verify(),true);
});
test('fresh commit rejects a third copy with zero writes',async()=>{
 const f=await fixture();f.put('Third.md','- [ ] Other {{operonId:: parent1}}');await f.reindex('Third.md');
 assert.equal((await f.commit()).status,'failed');assert.equal(f.writes.length,0);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
for(const changed of ['source','target','line','journal'])test('fresh commit rejects '+changed+' before any write',async()=>{
 const f=await fixture();
 if(changed==='source')f.put('Source.md',f.sourceBefore+'\nExternal edit');
 if(changed==='target')f.put('Target.md',f.targetAfter);
 if(changed==='line')f.plan.conversionEffect.beforeLocator.lineNumber=99;
 if(changed==='journal')f.journal.steps.push({...f.steps[0]});
 assert.equal((await f.commit()).status,'failed');assert.equal(f.writes.length,0);
});
test('source failure leaves conflict visible; recovery compensates exact target',async()=>{
 const f=await fixture();f.failSource();await assert.rejects(f.commit());assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
 assert.equal((await f.recover()).status,'compensated');assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.files.has('Target.md'),false);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);
});
test('third copy after interruption is never suppressed and does not block safe compensation',async()=>{
 const f=await fixture();await assert.rejects(f.commit(async value=>{await f.checkpoint(value);throw Error('interrupted')}));
 const third='- [ ] External copy {{operonId:: parent1}}';f.put('Third.md',third);await f.reindex('Third.md');
 assert.equal((await f.recover()).status,'compensated');assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.contents.get('Third.md'),third);assert.equal(f.files.has('Target.md'),false);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
for(const changedPath of ['Source.md','Target.md'])test('changed '+changedPath+' after interruption is not authorized by the sealed pair',async()=>{
 const f=await fixture();await assert.rejects(f.commit(async value=>{await f.checkpoint(value);throw Error('interrupted')}));
 const changed=f.contents.get(changedPath)+'\nExternal edit';f.put(changedPath,changed);await f.reindex(changedPath);
 assert.equal(await f.probe.beginAgentRuntimeConversionIdentityTransition(f.plan,f.journal,true),null);
 const result=await f.recover();assert.equal(result.status,'outcome-unknown');assert.equal(f.contents.get(changedPath),changed);
 assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
test('third copy appearing during commit remains a real conflict',async()=>{
 const f=await fixture();f.afterCreate(async()=>{f.put('Third.md','- [ ] Third {{operonId:: parent1}}');await f.reindex('Third.md')});
 assert.equal((await f.commit()).status,'partial');assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);assert.equal(await f.verify(),false);
});
test('postflight checkpoint error cannot leave an identity allowance active',async()=>{
 const f=await fixture();await assert.rejects(f.commit(async value=>{await f.checkpoint(value);if(value.phase==='postflight')throw Error('checkpoint failed')}));
 f.put('Source.md',f.sourceBefore);await f.reindex('Source.md');assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});
async function durableFixture(options={}) {
 const f=await fixture(options),factory=new FakeIndexedDbFactory();
 let now=Date.now(),sequence=0,checkpointFailure=false,finalizeFailure=false,postflightFailure=false;
 const store=new IndexedDbMutationReceiptStoreV1({indexedDBFactory:factory,now:()=>now});
 const persist=store.persistJournal.bind(store),finalize=store.finalizeReceiptAfterApplyAdmission.bind(store);
 store.persistJournal=async(...args)=>{
  await persist(...args);
  if(checkpointFailure&&args[0].completedStepCount===1){checkpointFailure=false;throw Error('checkpoint acknowledgement lost')}
 };
 store.finalizeReceiptAfterApplyAdmission=async(...args)=>{
  if(finalizeFailure){finalizeFailure=false;throw Error('receipt finalization failed')}
  return await finalize(...args);
 };
 const revision={index:{sessionId:'conversion-e2e',ramGeneration:1,durable:{status:'missing'}},settingsFingerprint:sha256HexV1('settings'),pinnedGeneration:0,activeTrackerGeneration:0,repeatSeriesRevision:0,projectSerialGeneration:0,projectSerialSignature:sha256HexV1('serial')};
 const effect={...f.plan.conversionEffect,...(options.direction==='file-to-inline'?{}:{templateId:'test-template',templateRevision:sha256HexV1('template')}),plannedTargetDigest:sha256HexV1(f.targetAfter),plannedSourceDigest:sha256HexV1(f.sourceAfter??''),settingsFingerprint:revision.settingsFingerprint,resolvedFieldDiff:[],lossManifest:[],lossManifestDigest:sha256HexV1('[]')};
 const prepared={target:{...f.plan.targets[0],targetDigest:sha256HexV1(f.sourceBefore)},
  affectedResources:f.steps.map(step=>({resourceKind:step.resourceKind,resourceKey:step.resourceKey,revision:sourceRevisionForTaskCreationV1(step.resourceKey,step.before.content)})).sort((a,b)=>a.resourceKey.localeCompare(b.resourceKey)),
  atomicGroups:f.plan.atomicGroups.map((group,order)=>({...group,order})),
  predictedEffects:f.steps.map(step=>({resourceKind:step.resourceKind,resourceKey:step.resourceKey,action:step.operation==='create'?'create':step.operation==='delete'?'trash':'update',summary:'Convert representation.'})),
  warnings:[],conversionEffect:effect,token:{kind:'source-transition',operation:'convert'}};
 const newGateway=()=>new RuntimeMutationGatewayV1({
  isReady:()=>true,sampleContextRevision:()=>revision,
  prepareCreation:async()=>assert.fail('not creation'),commitCreation:async()=>assert.fail('not creation'),
  prepareMutation:async()=>({ok:true,value:prepared}),commitMutation:async()=>assert.fail('journal required'),
  prepareMutationTransaction:async()=>({ok:true,steps:f.steps}),...f.ports,
  verifyMutationTransactionState:async(j,expected)=>j.steps.every(step=>(f.contents.get(step.resourceKey)??null)===step[expected].content),
  verifyMutation:async()=>{if(postflightFailure){postflightFailure=false;return false}return await f.verify()},
  reindexAffectedSources:async paths=>{for(const p of paths)await f.reindex(p)},settleAfterMutation:async()=>{},
  reconcileCreatedHierarchy:async()=>({ok:true,resourceRevisions:[]}),verifyCreatedTasks:async()=>false,
  receiptStore:()=>store,vaultIdentityHash:async()=>sha256HexV1('conversion-vault'),nowEpochMs:()=>now,randomId:()=> 'conversion-'+(++sequence),
 });
 const gateway=newGateway(),spec=options.direction==='file-to-inline'
  ?{operation:'convert',from:'file',to:'inline',target:{mode:'exact-line',filePath:'Target.md',lineNumber:0}}
  :{operation:'convert',from:'inline',to:'file',templateId:'test-template',targetPath:'Target.md'};
 const preview=await gateway.preview({contractVersion:1,requestId:'preview',kind:'mutation-preview',clientInstanceId:'conversion-test',idempotencyKey:'conversion-e2e-key',capability:'tasks.convert.preview',mutationKind:'task.convert',target:{operonId:'parent1',locator:effect.beforeLocator},spec,authorization:{basis:'user-explicit-request'}});
 assert.equal(preview.ok,true,JSON.stringify(preview));
 const request={contractVersion:1,requestId:'apply',kind:'mutation-apply',plan:preview.plan,idempotencyKey:'conversion-e2e-key',authorization:{basis:preview.plan.requiresConfirmation?'user-explicit-confirmation':'user-explicit-request'},acknowledgements:preview.plan.requiredAcknowledgements.map(code=>({code,planHash:preview.plan.planHash,targetDigest:preview.plan.targets[0].targetDigest,acknowledgedAt:new Date(now).toISOString()}))};
 assert.equal(decodeMutationApplyRequestV1(request).ok,true,JSON.stringify(decodeMutationApplyRequestV1(request)));
 return {...f,gateway,newGateway,store,factory,request,spec,
  advance:()=>{now+=30001},failCheckpoint:()=>{checkpointFailure=true},failFinalize:()=>{finalizeFailure=true},failPostflight:()=>{postflightFailure=true}};
}
for(const direction of ['inline-to-file','file-to-inline'])for(const failure of ['none','checkpoint','finalize','postflight'])test('durable conversion '+direction+' '+failure+' recovers with real indexer/writer/store',async()=>{
 const f=await durableFixture({direction});
 if(failure==='checkpoint')f.failCheckpoint();if(failure==='finalize')f.failFinalize();if(failure==='postflight')f.failPostflight();
 const first=await f.gateway.apply(f.request);
 if(failure==='none')assert.equal(first.status,'applied',JSON.stringify(first));
 else {assert.equal(first.status,'outcome-unknown',JSON.stringify(first));assert.equal(f.factory.journals.size,1);assert.equal((await f.gateway.apply(f.request)).status,'applied');}
 assert.equal(f.contents.get('Source.md')??null,f.sourceAfter);assert.equal(f.contents.get('Target.md'),f.targetAfter);
 assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);assert.equal(f.indexer.getTask('child01').fieldValues.parentTask,'parent1');
 const count=f.writes.length;assert.equal((await f.gateway.apply(f.request)).status,'already-applied');assert.equal(f.writes.length,count);assert.equal(count,2);assert.equal(f.factory.journals.size,0);
});
test('durable conversion new gateway respects old lease then recovers the sealed pair',async()=>{
 const f=await durableFixture();f.failCheckpoint();assert.equal((await f.gateway.apply(f.request)).status,'outcome-unknown');
 const other=f.newGateway(),count=f.writes.length;const blocked=await other.apply(f.request);assert.notEqual(blocked.status,'applied');assert.equal(f.writes.length,count);
 f.advance();assert.equal((await other.apply(f.request)).status,'applied');assert.equal(f.writes.length,2);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);
});
test('durable conversion concurrent same-plan calls write once',async()=>{
 const f=await durableFixture();const results=await Promise.all([f.gateway.apply(f.request),f.gateway.apply(f.request)]);
 assert.deepEqual(results.map(r=>r.status),['applied','already-applied']);assert.equal(f.writes.length,2);
});
test('durable conversion source failure compensates exact target and preserves relationships',async()=>{
 const f=await durableFixture();f.failSource();assert.equal((await f.gateway.apply(f.request)).status,'outcome-unknown');
 const recovered=await f.gateway.apply(f.request);assert.equal(recovered.status,'failed');assert.equal(recovered.mutationMayHaveApplied,false);assert.equal(recovered.retryAllowed,false);assert.equal(f.factory.journals.size,0);assert.equal(f.factory.records.size,0);assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.files.has('Target.md'),false);
 assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);assert.equal(f.indexer.getTask('child01').fieldValues.parentTask,'parent1');
});
for(const path of ['Source.md','Target.md'])test('durable conversion lost '+path+' acknowledgement recovers without replay',async()=>{
 const f=await durableFixture();
 if(path==='Target.md')f.afterCreate(async()=>{throw Error('lost create acknowledgement')});
 else {const modify=f.probe.app.vault.modify;f.probe.app.vault.modify=async(file,content)=>{await modify(file,content);if(file.path===path)throw Error('lost modify acknowledgement')};}
 assert.equal((await f.gateway.apply(f.request)).status,'outcome-unknown');
 assert.equal((await f.gateway.apply(f.request)).status,'applied');assert.equal(f.writes.length,2);
 assert.equal(f.contents.get('Source.md'),f.sourceAfter);assert.equal(f.contents.get('Target.md'),f.targetAfter);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);
});
test('durable recovery preserves a third copy and compensates only its own target',async()=>{
 const f=await durableFixture();f.failCheckpoint();assert.equal((await f.gateway.apply(f.request)).status,'outcome-unknown');
 const third='- [ ] External copy {{operonId:: parent1}}';f.put('Third.md',third);await f.reindex('Third.md');
 const recovered=await f.gateway.apply(f.request);assert.equal(recovered.status,'failed');assert.equal(recovered.mutationMayHaveApplied,false);assert.equal(recovered.retryAllowed,false);assert.equal(f.factory.journals.size,0);assert.equal(f.factory.records.size,0);assert.equal(f.contents.get('Third.md'),third);assert.equal(f.contents.get('Source.md'),f.sourceBefore);assert.equal(f.files.has('Target.md'),false);assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),true);
});

for(const direction of ['inline-to-file','file-to-inline'])test('desktop UI conversion uses actual gateway, store, indexer and writer: '+direction,async()=>{
 const f=await durableFixture({direction}),buffers=new Map([['Source.md',f.sourceBefore]]);
 if(f.targetBefore!==null)buffers.set('Target.md',f.targetBefore);
 f.indexer.reindexFilesBatch=async paths=>{for(const p of paths)await f.reindex(p)};
 f.indexer.forceReindexFilePathAfterMutation=async p=>f.reindex(p);
 Object.assign(f.probe,{
  previewAgentRuntimeMutation:(r,_context,policy)=>f.gateway.previewForPluginUi(r,policy),applyAgentRuntimeMutation:(r,policy)=>{assert.equal(decodeMutationApplyRequestV1(r).ok,true,JSON.stringify(decodeMutationApplyRequestV1(r)));return f.gateway.applyForPluginUi(r,policy)},
  persistTaskEditorDeleteOpenSources:async()=>true,agentRuntimeTaskLocator:task=>({filePath:task.primary.filePath,representation:task.primary.format==='yaml'?'file':'inline',...(task.primary.format==='inline'?{lineNumber:task.primary.lineNumber}:{})}),
  taskEditorDeleteOpenViewsMatch:(p,c)=>!buffers.has(p)||buffers.get(p)===c,
  syncTaskEditorDeleteOpenViews:(p,b,a)=>{if(!buffers.has(p))return true;if(buffers.get(p)!==b)return false;buffers.set(p,a);return true},
  promptConfirmAction:async()=>true,refreshViews:()=>{},refreshMarkdownTaskSurfaces:()=>{},scheduleInlineToFileTaskMarkdownRefresh:()=>{},scheduleInlineToFileTaskMetadataRefresh:()=>{},
 });
 const result=await f.probe.applyUiCanonicalConversion(f.indexer.getTask('parent1'),f.spec);
 assert.equal(result.status,'committed',JSON.stringify(result));assert.equal(f.writes.length,2);assert.equal(f.factory.journals.size,0);assert.equal(f.factory.records.size,1);
 assert.equal(f.contents.get('Source.md')??null,f.sourceAfter);assert.equal(f.contents.get('Target.md'),f.targetAfter);
 if(f.sourceAfter!==null)assert.equal(buffers.get('Source.md'),f.sourceAfter);if(f.targetBefore!==null)assert.equal(buffers.get('Target.md'),f.targetAfter);
});

` }, outfile, bundle:true, format:'esm', platform:'node', target:'node22', logLevel:'silent', define:{OPERON_AGENT_RUNTIME_PROBE_ENABLED:'false'}, alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')} });
 await import(pathToFileURL(outfile).href);
} finally { await rm(dir,{recursive:true,force:true}); }
