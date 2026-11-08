import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {canonicalJsonV1,sha256HexV1,toJsonValueV1} from '../../../src/agent-runtime/contracts/v1/canonical';
import {structuredErrorV1} from '../../../src/agent-runtime/contracts/v1/primitives';
import {decodeRoutedTaskCreationPlanV1,decodeRoutedTaskCreationPreviewV1,decodeRoutedTaskCreationApplyV1} from '../../../src/agent-runtime/extensions/task-creation-v1/decode';
import {createRoutedCreationMutationGatewayV1} from '../../../src/agent-runtime/extensions/task-creation-v1/mutation-gateway';
import type {ExecutableRoutedCreationPlanV1,RoutedTaskCreationMutationResultV1,RoutedTaskCreationPreviewRequestV1,RoutedTaskCreationApplyRequestV1} from '../../../src/agent-runtime/extensions/task-creation-v1/contracts';
export function executionFixture() {
 const legacy=JSON.parse(readFileSync('scripts/agent-runtime/receipts/legacy-transaction-identifiers.json','utf8')).file.plan;
 const request:RoutedTaskCreationPreviewRequestV1={contractVersion:1,requestId:'routed-preview',kind:'mutation-preview',capability:'tasks.create.routed.preview',mutationKind:'task.create',clientInstanceId:legacy.clientInstanceId,idempotencyKey:'routed-create-key',authorization:{basis:'user-explicit-request'},spec:{operation:'create',item:{...legacy.spec.items[0],title:legacy.spec.items[0].description,template:{mode:'none'}}}};
 delete (request.spec.item as unknown as Record<string,unknown>).description;
 const plan:ExecutableRoutedCreationPlanV1={...legacy,capability:request.capability,extension:'task-creation-v1',spec:request.spec,idempotencyKeyHash:sha256HexV1(request.idempotencyKey),policyRevision:'a'.repeat(64),creation:{version:1,executionSpec:{...legacy.spec,items:[{...legacy.spec.items[0],target:{...legacy.spec.items[0].target,identityPlaceholderPolicy:'resolve-operon-id-v1'}}]},periodicRoute:null,templateId:null,templateDigest:sha256HexV1(''),materialRevision:'b'.repeat(64),graphDigest:'c'.repeat(64),resolvedFields:{},resolvedTags:[],nativeProperties:[],allocations:[],fileAllocations:[],definitions:[],skipped:[],retention:'preserve-definitions-on-failure'}};
 const seal=()=>{const {planHash:_hash,...body}=plan;plan.planHash=sha256HexV1(canonicalJsonV1(toJsonValueV1(body)));};seal();
 const apply:RoutedTaskCreationApplyRequestV1={contractVersion:1,requestId:'routed-apply',kind:'mutation-apply',authorization:{basis:'user-explicit-request'},plan,idempotencyKey:request.idempotencyKey,acknowledgements:[]};
 return {request,plan,apply,seal};
}
test('executable plans bind native/type/template and graph evidence without changing old V1 plans',()=>{
 const f=executionFixture();assert.ok(decodeRoutedTaskCreationPlanV1(f.plan).ok);assert.ok(decodeRoutedTaskCreationApplyV1(f.apply).ok);
 f.plan.creation.graphDigest='d'.repeat(64);assert.equal(decodeRoutedTaskCreationApplyV1(f.apply).ok,false);f.seal();assert.ok(decodeRoutedTaskCreationApplyV1(f.apply).ok);
 f.plan.creation.allocations=['invalid!'];f.seal();assert.equal(decodeRoutedTaskCreationApplyV1(f.apply).ok,false);
});
test('native properties require bounded typed values and do not allow object injection',()=>{
 const f=executionFixture();f.request.spec.item.nativeProperties=[{sourceName:'score',value:7}];assert.ok(decodeRoutedTaskCreationPreviewV1(f.request).ok);
 assert.equal(decodeRoutedTaskCreationPreviewV1({...f.request,spec:{...f.request.spec,item:{...f.request.spec.item,nativeProperties:[{sourceName:'score',value:{nested:true}}]}}}).ok,false);
});
test('gateway validates intent, audit order, expired recovery and post-dispatch uncertainty',async()=>{
 const f=executionFixture();const events:string[]=[];let expired=false;let evidence=false;let throws=false;
 const result:RoutedTaskCreationMutationResultV1={contractVersion:1,requestId:f.apply.requestId,kind:'mutation-result',status:'failed',mutationMayHaveApplied:false,retryAllowed:false,groupResults:[],error:structuredErrorV1('stale-source','Synthetic source conflict.')};
 const gateway=createRoutedCreationMutationGatewayV1({ready:()=>true,now:()=>Date.parse(expired?f.plan.expiresAt:f.plan.createdAt)+(expired?1:0),preview:async()=>({contractVersion:1,requestId:f.request.requestId,kind:'mutation-preview-result',ok:true,warnings:f.plan.warnings,plan:f.plan}),hasRecoveryEvidence:async()=>evidence,audit:async event=>{events.push(event);},apply:async(_request,execution)=>{await execution.dispatch(execution.recoveryOnly?'recovery-dispatched':'apply-dispatched');if(throws)throw new Error('uncertain');return result;}});
 assert.equal((await gateway.preview(f.request)).ok,true);
 assert.equal((await gateway.apply(f.apply)).status,'failed');assert.deepEqual(events,['apply-dispatched','apply-completed']);
 expired=true;events.length=0;assert.equal((await gateway.apply(f.apply)).error?.code,'plan-expired');assert.equal(events.length,0);
 evidence=true;throws=true;assert.equal((await gateway.recover(f.apply)).status,'outcome-unknown');assert.equal(events[0],'recovery-dispatched');
});
test('gateway cannot execute a reserved Stage 1 plan',async()=>{
 const f=executionFixture();delete (f.plan as {creation?:unknown}).creation;f.seal();let dispatched=false;
 const gateway=createRoutedCreationMutationGatewayV1({ready:()=>true,now:()=>Date.parse(f.plan.createdAt),preview:async()=>{throw new Error();},hasRecoveryEvidence:async()=>false,audit:async()=>{dispatched=true;},apply:async()=>{throw new Error();}});
 assert.equal((await gateway.apply(f.apply)).error?.code,'invalid-request');assert.equal(dispatched,false);
});
