import assert from 'node:assert/strict';
import test from 'node:test';
import {executionFixture} from './execution.test';
import {createRoutedCreationMutationGatewayV1,type RoutedCreationMutationPortsV1} from '../../../src/agent-runtime/extensions/task-creation-v1/mutation-gateway';
import {structuredErrorV1} from '../../../src/agent-runtime/contracts/v1/primitives';
import type {RoutedTaskCreationMutationResultV1,RoutedTaskCreationPlanV1} from '../../../src/agent-runtime/extensions/task-creation-v1/contracts';
const previewInput=executionFixture().request;
import {validate} from './extension.test';
const sample=(name:string,value:unknown)=>{const key=name.split('/')[1];assert.ok(validate('developer'+key[0].toUpperCase()+key.slice(1),value));};
function successful(requestId:string,plan:RoutedTaskCreationPlanV1):RoutedTaskCreationMutationResultV1 {return {contractVersion:1,requestId,kind:'mutation-result',status:'applied',mutationMayHaveApplied:true,retryAllowed:false,groupResults:plan.atomicGroups.map(g=>({groupId:g.groupId,status:'committed'})),receipt:{contractVersion:1,vaultIdentityHash:'a'.repeat(64),clientInstanceId:plan.clientInstanceId,idempotencyKeyHash:plan.idempotencyKeyHash,planHash:plan.planHash,mutationKind:plan.mutationKind,targetDigest:plan.receiptTargetDigest,terminalOutcome:'applied',effectiveAt:plan.createdAt,completedAt:plan.createdAt,expiresAt:plan.expiresAt},postflight:{status:'verified',observedAt:plan.createdAt,contextRevision:plan.contextRevision}};}
function fixture(overrides:{hasRecoveryEvidence:RoutedCreationMutationPortsV1['hasRecoveryEvidence'];applyCore:RoutedCreationMutationPortsV1['apply']}) {
 return {runtime:createRoutedCreationMutationGatewayV1({ready:()=>true,now:()=>Date.parse(executionFixture().plan.createdAt),audit:async()=>{},hasRecoveryEvidence:overrides.hasRecoveryEvidence,apply:async(request,execution)=>{await execution.dispatch(execution.recoveryOnly?'recovery-dispatched':'apply-dispatched');return overrides.applyCore(request,execution);},preview:async request=>{const f=executionFixture();f.plan.clientInstanceId=request.clientInstanceId;f.plan.idempotencyKeyHash=sha256HexV1(request.idempotencyKey);f.plan.spec=request.spec;f.seal();return {contractVersion:1,requestId:request.requestId,kind:'mutation-preview-result',ok:true,warnings:f.plan.warnings,plan:f.plan};}})};
}
import {sha256HexV1} from '../../../src/agent-runtime/contracts/v1/canonical';
import type {TaskCreationDeveloperOptionsV1} from '../../../src/agent-runtime/extensions/task-creation-v1/session-contract';
import { TASK_CREATION_CAPABILITIES_V1 } from '../../../src/agent-runtime/extensions/task-creation-v1/contracts';
import { getTaskCreationDeveloperApiV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/developer-api';
import { DeveloperMutationSecurityPolicyV1 } from '../../../src/agent-runtime/developer-api/security';
import { IndexedDbDeveloperMutationRecoveryStoreV1 } from '../../../src/agent-runtime/developer-api/recovery-store';
import type { DeveloperApiGrantEvaluationV1 } from '../../../src/agent-runtime/developer-api/grants';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
import { FakeIndexedDbFactory } from '../developer-api/recovery-store.test';
import { validateCliInvocationForTransportV1 } from '../../../src/agent-runtime/transport/invocation-validator';

function developerFixture(compensate = false) {
 const now = new Date(executionFixture().plan.createdAt), consumer = { id: 'title.consumer', name: 'Title Consumer', version: '1.0.0', instanceEpoch: 'epoch1' };
 const state = { active: true, available: true, dispatches: 0, recover: false, evidence: true };
 const f = fixture({ hasRecoveryEvidence: async () => state.evidence, applyCore: async req => {
  state.dispatches++;
  if (!state.recover) throw new Error('lost completion');
  if (compensate) return { contractVersion: 1, requestId: req.requestId, kind: 'mutation-result', status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [], recoveryOutcome: 'compensated', error: structuredErrorV1('stale-source', 'Verified compensation') };
  return successful(req.requestId, req.plan);
 } });
 const core = { taskCreation: {mutations:f.runtime}, hasCapability: () => state.available } as unknown as OperonAgentRuntimeCoreV1;
 const store = new IndexedDbDeveloperMutationRecoveryStoreV1({ indexedDBFactory: new FakeIndexedDbFactory() as unknown as IDBFactory, now: () => now.getTime() });
 const evaluate = (): DeveloperApiGrantEvaluationV1 => ({ state: state.active ? 'active' : 'revoked', revision: 1, grantedCapabilities: TASK_CREATION_CAPABILITIES_V1, effectiveCapabilities: state.active ? TASK_CREATION_CAPABILITIES_V1 : [], pendingCapabilities: [], reason: state.active ? 'active-grant' : 'revoked' } as DeveloperApiGrantEvaluationV1);
 const policy = new DeveloperMutationSecurityPolicyV1({ consent: { requestConsent: async () => 'approved' }, isSessionCurrent: s => s.consumerId === consumer.id, isGrantCurrent: () => state.active, now: () => now });
 const options: TaskCreationDeveloperOptionsV1 = { isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: c => c === core, grantController: { verifyConsumer: () => consumer, isConsumerCurrent: () => true, evaluate, recordPending: () => {} }, mutationSecurityPolicy: policy, recoveryStore: store, now: () => now };
 const access = () => getTaskCreationDeveloperApiV1(core, {} as OperonDeveloperApiConsumerPluginV1, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.create.routed.preview', 'tasks.create.routed.apply'] as const }, options);
 return { state, store, access, consumer };
}

test('Developer API opaque handles, revoked grants and restarted recovery preserve uncertainty', async () => {
 const f = developerFixture(), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations!.preview!({ capability: 'tasks.create.routed.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 sample('developer-api/previewResult', preview); sample('developer-api/planHandle', preview.plan);
 assert.equal((await access.api.mutations!.apply!({ plan: structuredClone(preview.plan) })).status, 'failed');
 const uncertain = await access.api.mutations!.apply!({ plan: preview.plan }); sample('developer-api/executionResult', uncertain); assert.equal(uncertain.status, 'outcome-unknown');
 f.state.active = false;
 const denied = await access.api.mutations!.recover!({ plan: preview.plan }); assert.equal(denied.status, 'outcome-unknown'); assert.equal(denied.mutationMayHaveApplied, true); assert.equal(f.state.dispatches, 1); assert.equal(f.access().ok, false);
 f.state.active = true; f.state.recover = true;
 const resumed = f.access(); assert.ok(resumed.ok); if (!resumed.ok) return;
 const pending = await resumed.api.mutations!.pendingRecoveries!(); sample('developer-api/pendingRecoveriesResult', pending); assert.ok(pending.ok && pending.recoveries.length === 1);
 const recovered = await resumed.api.mutations!.recover!({ recoveryRef: preview.plan.recoveryRef }); sample('developer-api/executionResult', recovered); assert.equal(recovered.status, 'applied'); assert.equal((await f.store.list(f.consumer.id)).length, 0);
});

test('verified compensation closes the durable Developer API recovery record', async () => {
 const f = developerFixture(true), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations!.preview!({ capability: 'tasks.create.routed.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 await access.api.mutations!.apply!({ plan: preview.plan }); f.state.recover = true;
 const result = await access.api.mutations!.recover!({ plan: preview.plan }); assert.equal(result.status, 'failed', JSON.stringify(result)); assert.equal(result.mutationMayHaveApplied, false); assert.equal((await f.store.list(f.consumer.id)).length, 0);
});

test('lost compensation finalization keeps recovery uncertain and refuses replay without durable evidence', async () => {
 const f = developerFixture(true), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations!.preview!({ capability: 'tasks.create.routed.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 await access.api.mutations!.apply!({ plan: preview.plan }); f.state.recover = true;
 const markRefused = f.store.markRefused.bind(f.store);
 f.store.markRefused = async () => { throw new Error('Injected finalization failure'); };
 const result = await access.api.mutations!.recover!({ plan: preview.plan });
 assert.equal(result.status, 'outcome-unknown'); assert.equal(result.mutationMayHaveApplied, true);
 f.store.markRefused = markRefused; f.state.evidence = false;
 const restarted = f.access(); assert.ok(restarted.ok); if (!restarted.ok) return;
 const pending = await restarted.api.mutations!.pendingRecoveries!(); assert.ok(pending.ok && pending.recoveries.length === 1);
 assert.equal((await restarted.api.mutations!.recover!({ recoveryRef: preview.plan.recoveryRef })).status, 'outcome-unknown');
 assert.equal(f.state.dispatches, 2, 'no new write can run without the original journal or receipt');
});



test('Developer API concurrent recovery dispatches once and cross-consumer references are refused',async()=>{
 const f=developerFixture(),access=f.access();assert.ok(access.ok);if(!access.ok)return;
 const preview=await access.api.mutations!.preview!({capability:'tasks.create.routed.preview',mutationKind:'task.create',spec:previewInput.spec});assert.ok(preview.ok);if(!preview.ok)return;
 assert.ok(preview.creation.target);assert.equal('planHash' in preview.plan,false);
 await access.api.mutations!.apply!({plan:preview.plan});f.state.recover=true;
 const owner=f.consumer.id;f.consumer.id='another.consumer';const wrong=f.access();assert.ok(wrong.ok);if(wrong.ok)assert.equal((await wrong.api.mutations!.recover!({recoveryRef:preview.plan.recoveryRef})).status,'failed');f.consumer.id=owner;
 const resumed=f.access();assert.ok(resumed.ok);if(!resumed.ok)return;
 const results=await Promise.all([resumed.api.mutations!.recover!({recoveryRef:preview.plan.recoveryRef}),resumed.api.mutations!.recover!({recoveryRef:preview.plan.recoveryRef})]);
 assert.ok(results.some(result=>result.status==='applied'));assert.equal(f.state.dispatches,2);
});
