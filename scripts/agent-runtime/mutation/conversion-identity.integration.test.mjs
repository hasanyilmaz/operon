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
const methodNames = ['beginAgentRuntimeConversionIdentityTransition', 'reindexAgentRuntimeTaskSourceWrite', 'reindexAgentRuntimeGraphCommittedPrefix'];
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
const dir = await mkdtemp(path.join(tmpdir(), 'operon-conversion-identity-'));
try {
 const outfile = path.join(dir, 'tests.mjs');
 await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import test from 'node:test';
import {TFile,TFolder} from 'obsidian';
import {OperonIndexer} from './src/indexer/indexer';
import {TaskWriter} from './src/core/task-writer';
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
 return {probe,indexer,contents,files,writes,put,reindex,journal,plan,request,steps,sourceBefore,sourceAfter,targetBefore,targetAfter,checkpoint,
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
` }, outfile, bundle:true, format:'esm', platform:'node', target:'node22', logLevel:'silent', define:{OPERON_AGENT_RUNTIME_PROBE_ENABLED:'false'}, alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')} });
 await import(pathToFileURL(outfile).href);
} finally { await rm(dir,{recursive:true,force:true}); }
