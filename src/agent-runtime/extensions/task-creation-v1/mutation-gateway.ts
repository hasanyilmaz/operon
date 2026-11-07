import { isRecord } from '../../../core/unknown-value';
import { structuredErrorV1 } from '../../contracts/v1/primitives';
import type { RuntimeInvocationContextV1 } from '../../runtime/types';
import type { ExecutableRoutedCreationPlanV1, RoutedTaskCreationApplyRequestV1, RoutedTaskCreationMutationResultV1, RoutedTaskCreationPreviewRequestV1, RoutedTaskCreationPreviewResultV1 } from './contracts';
import { decodeRoutedTaskCreationApplyV1, decodeRoutedTaskCreationMutationResultV1, decodeRoutedTaskCreationPreviewResultV1, decodeRoutedTaskCreationPreviewV1 } from './decode';
export interface RoutedCreationMutationPortsV1 {
 ready():boolean;
 now():number;
 preview(request:RoutedTaskCreationPreviewRequestV1,context?:RuntimeInvocationContextV1):Promise<RoutedTaskCreationPreviewResultV1>;
 hasRecoveryEvidence(request:RoutedTaskCreationApplyRequestV1):Promise<boolean>;
 apply(request:Omit<RoutedTaskCreationApplyRequestV1,'plan'> & {plan:ExecutableRoutedCreationPlanV1},execution:{recoveryOnly:boolean;dispatch(event:'apply-dispatched'|'recovery-dispatched'):Promise<void>}):Promise<RoutedTaskCreationMutationResultV1>;
 audit(event:'apply-dispatched'|'recovery-dispatched'|'apply-completed'|'recovery-completed',request:RoutedTaskCreationApplyRequestV1,result?:RoutedTaskCreationMutationResultV1):Promise<void>;
}
const id=(value:unknown)=>isRecord(value)&&typeof value.requestId==='string'?value.requestId:'invalid-request';
const fail=(requestId:string,code:Parameters<typeof structuredErrorV1>[0],message:string):RoutedTaskCreationMutationResultV1=>({contractVersion:1,requestId,kind:'mutation-result',status:'failed',mutationMayHaveApplied:false,retryAllowed:false,groupResults:[],error:structuredErrorV1(code,message)});
const previewFail=(requestId:string,code:Parameters<typeof structuredErrorV1>[0],message:string):RoutedTaskCreationPreviewResultV1=>({contractVersion:1,requestId,kind:'mutation-preview-result',ok:false,warnings:[],error:structuredErrorV1(code,message)});
function uncertain(request:RoutedTaskCreationApplyRequestV1):RoutedTaskCreationMutationResultV1 {
 const error=structuredErrorV1('outcome-unknown','Recover this same creation plan; do not repeat the task creation. Native property definitions may have been retained.');
 return {contractVersion:1,requestId:request.requestId,kind:'mutation-result',status:'outcome-unknown',mutationMayHaveApplied:true,retryAllowed:false,ambiguitySource:'group-outcome',groupResults:[{groupId:request.plan.atomicGroups[0].groupId,status:'outcome-unknown',error}],error};
}
/** Admission only. Durable execution remains in the shared Plugin graph transaction engine. */
export function createRoutedCreationMutationGatewayV1(ports:RoutedCreationMutationPortsV1) {
 const execute=async(value:unknown,recovery:boolean):Promise<RoutedTaskCreationMutationResultV1>=>{
  const decoded=decodeRoutedTaskCreationApplyV1(value);
  if(!decoded.ok || !decoded.value.plan.creation || !decoded.value.plan.createEffects?.length) return fail(id(value),'invalid-request','An executable routed creation plan is required.');
  const request=decoded.value;
  if(!ports.ready()) return fail(request.requestId,'live-settling','Runtime creation is not ready.');
  const expired=ports.now()>Date.parse(request.plan.expiresAt);
  if(Date.parse(request.plan.createdAt)>ports.now()) return fail(request.requestId,'stale-plan','The creation plan is not current.');
  if(expired || recovery) {
   try {if(!await ports.hasRecoveryEvidence(request)) return fail(request.requestId,'plan-expired','No durable same-plan recovery evidence exists.');}
   catch {return fail(request.requestId,'receipt-store-unavailable','Creation recovery evidence could not be read.');}
  }
  let dispatched:'apply-dispatched'|'recovery-dispatched'|null=null;
  const dispatch=async(event:'apply-dispatched'|'recovery-dispatched')=>{
   const selected=recovery?'recovery-dispatched':event;
   if(dispatched) {if(dispatched!==selected) throw new Error('Creation audit mode changed.');return;}
   await ports.audit(selected,request);dispatched=selected;
  };
  try {
   const result=await ports.apply({...request,plan:request.plan as ExecutableRoutedCreationPlanV1},{recoveryOnly:expired||recovery,dispatch});
   const checked=decodeRoutedTaskCreationMutationResultV1(result);
   if(!checked.ok || checked.value.requestId!==request.requestId) return uncertain(request);
   if(dispatched) await ports.audit(dispatched==='recovery-dispatched'?'recovery-completed':'apply-completed',request,checked.value);
   return checked.value;
  } catch {return dispatched?uncertain(request):fail(request.requestId,'internal-error','Creation stopped before dispatch.');}
 };
 return {
  async preview(value:unknown,context?:RuntimeInvocationContextV1):Promise<RoutedTaskCreationPreviewResultV1> {
   const decoded=decodeRoutedTaskCreationPreviewV1(value);
   if(!decoded.ok) return previewFail(id(value),'invalid-request','Invalid routed creation request.');
   const request=decoded.value;
   if(request.authorization.basis!=='user-explicit-request') return previewFail(request.requestId,'authority-insufficient','Creation requires an explicit user request.');
   if(!ports.ready()) return previewFail(request.requestId,'live-settling','Runtime creation is not ready.');
   try {
    const result=decodeRoutedTaskCreationPreviewResultV1(await ports.preview(request,context));
    if(!ports.ready() || context?.deadlineAtMs!==undefined && ports.now()>context.deadlineAtMs) return previewFail(request.requestId,'live-settling','Creation preview did not settle.');
    return result.ok && result.value.requestId===request.requestId ? result.value : previewFail(request.requestId,'internal-error','Creation preview failed validation.');
   } catch(error) {return previewFail(request.requestId,'invalid-request',error instanceof Error?error.message:'Creation inputs could not be prepared.');}
  },
  apply:(value:unknown)=>execute(value,false),recover:(value:unknown)=>execute(value,true),
 };
}
