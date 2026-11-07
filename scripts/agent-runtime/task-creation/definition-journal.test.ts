import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { retainInlinePropertyDefinition, type InlinePropertyDefinition, type InlinePropertyDefinitions } from '../../../src/core/inline-property-definitions';
import { prepareCreationDefinitionStepV1, applyCreationDefinitionStepV1, readCreationDefinitionStateV1, verifyRetainedCreationDefinitionsV1, creationDefinitionStatesMatchV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/definition-journal';
import { executeRuntimeGraphTransactionRecoveryV1 } from '../../../src/agent-runtime/runtime/graph-transaction-executor';
import type { GraphTransactionJournalV1 } from '../../../src/agent-runtime/runtime/receipts/graph-transaction-journal';
const entry = { sourceName: 'score', type: 'number' as const, encoding: 'vault-v1' as const };
function fixture() {
 let definitions: InlinePropertyDefinitions | undefined;
 let writes = 0;
 const mappings = structuredClone(DEFAULT_SETTINGS.keyMappings);
 const ports = { mappings: () => mappings, definitions: () => definitions, async register(entries: readonly InlinePropertyDefinition[], canCommit: () => boolean) { assert.ok(canCommit()); for(const item of entries) definitions = retainInlinePropertyDefinition(definitions,item); writes++; } };
 const step = prepareCreationDefinitionStepV1([entry],mappings,definitions,'source:Tasks.md')!;
 return { ports, step, writes: () => writes, set(value: InlinePropertyDefinitions) { definitions = value; } };
}
test('definition preview is read only; registration is idempotent and preserves unrelated definitions',async()=>{
 const f=fixture();assert.equal(f.writes(),0);assert.equal(f.ports.definitions(),undefined);
 f.set({version:1,entries:[{sourceName:'other',type:'text',encoding:'vault-v1'}]});
 assert.equal(await applyCreationDefinitionStepV1(f.step,f.ports),true);assert.equal(await applyCreationDefinitionStepV1(f.step,f.ports),true);
 assert.equal(f.writes(),1);assert.equal(f.ports.definitions()!.entries.length,2);
 assert.equal(prepareCreationDefinitionStepV1([entry],f.ports.mappings(),f.ports.definitions(),'source'),null);
});
test('definition conflicts and key mapping drift fail before registration',async()=>{
 const f=fixture();f.set({version:1,entries:[{...entry,type:'text'}]});assert.equal(await applyCreationDefinitionStepV1(f.step,f.ports),false);assert.equal(f.writes(),0);
 const second=fixture();second.ports.mappings()[0].visiblePropertyName='Changed';assert.equal(await applyCreationDefinitionStepV1(second.step,second.ports),false);
});
test('retained definitions are accepted only for compensation and cannot be reinterpreted',async()=>{
 const f=fixture();assert.ok(verifyRetainedCreationDefinitionsV1(f.step,f.ports));
 await applyCreationDefinitionStepV1(f.step,f.ports);assert.ok(verifyRetainedCreationDefinitionsV1(f.step,f.ports));
 assert.equal(creationDefinitionStatesMatchV1(readCreationDefinitionStateV1(f.step,f.ports),f.step.before),false);
 f.set({version:1,entries:[{...entry,type:'text'}]});assert.equal(verifyRetainedCreationDefinitionsV1(f.step,f.ports),false);
});
test('malformed, removal, and reinterpreting journal material never writes',async()=>{
 const f=fixture();const broken=structuredClone(f.step);broken.after.content='{}';await assert.rejects(()=>applyCreationDefinitionStepV1(broken,f.ports));assert.equal(f.writes(),0);
 const removal={...f.step,before:f.step.after,after:f.step.before};await assert.rejects(()=>applyCreationDefinitionStepV1(removal,f.ports));
});
test('interrupted compensation repeats without deleting definitions or resuming task creation',async()=>{
 const f=fixture();await applyCreationDefinitionStepV1(f.step,f.ports);
 const journal={phase:'compensating',completedStepCount:1,steps:[f.step]} as GraphTransactionJournalV1;
 let forwards=0;let reverses=0;
 for(let attempt=0;attempt<2;attempt++) {
  const result=await executeRuntimeGraphTransactionRecoveryV1(journal,{readState:step=>Promise.resolve(readCreationDefinitionStateV1(step,f.ports)),statesMatch:creationDefinitionStatesMatchV1,applyForward:async()=>{forwards++;},applyCompensation:async step=>{assert.ok(verifyRetainedCreationDefinitionsV1(step,f.ports));reverses++;},checkpoint:async()=>{},verifyState:async expected=>expected==='before' && verifyRetainedCreationDefinitionsV1(f.step,f.ports)});
  assert.equal(result.status,'compensated');
 }
 assert.equal(forwards,0);assert.equal(reverses,2);assert.equal(f.ports.definitions()!.entries.length,1);assert.equal(f.writes(),1);
});
