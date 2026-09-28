import { structuredErrorV1 } from '../../contracts/v1/primitives';
import type { MutationPreviewRequestV1, MutationApplyRequestV1, MutationPreviewResultV1, MutationResultV1 } from '../../contracts/v1/mutation';
import type { TaskWorkflowPreviewRequestV1, TaskWorkflowApplyRequestV1, TaskWorkflowPreviewResultV1, TaskWorkflowMutationResultV1, TaskFilterQueryRequestV1 } from '../task-workflows-v1/contracts';
import { isRecord } from '../../../core/unknown-value';
import { CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1, checkboxOwnershipExecutionKeyV1, decodeCheckboxOwnershipApplyV1, decodeCheckboxOwnershipPreviewResultV1, decodeCheckboxOwnershipMutationResultV1, decodeCheckboxOwnershipPreviewV1, decodeCheckboxOwnershipFilterV1, sealCheckboxOwnershipPlanV1 } from './decode';
import type { CheckboxOwnershipApplyRequestV1, CheckboxOwnershipPreviewResultV1, CheckboxOwnershipMutationResultV1, CheckboxOwnershipFilterResultV1, CheckboxOwnershipExecutionPlanV1 } from './contracts';

export interface CheckboxOwnershipRuntimeV1 {
 preview(value: unknown): Promise<CheckboxOwnershipPreviewResultV1>;
 apply(value: unknown): Promise<CheckboxOwnershipMutationResultV1>;
 recover(value: unknown): Promise<CheckboxOwnershipMutationResultV1>;
 filterQuery(value: unknown): Promise<CheckboxOwnershipFilterResultV1>;
}
export interface CheckboxOwnershipPortsV1 {
 ready(): boolean;
 hasRecoveryEvidence(request: CheckboxOwnershipApplyRequestV1): Promise<boolean>;
 previewCore(request: MutationPreviewRequestV1): Promise<MutationPreviewResultV1>;
 applyCore(request: MutationApplyRequestV1): Promise<MutationResultV1>;
 previewAdopt(request: TaskWorkflowPreviewRequestV1): Promise<{ result: TaskWorkflowPreviewResultV1; afterDigest?: string }>;
 applyAdopt(request: TaskWorkflowApplyRequestV1, afterDigest: string, recovery: boolean): Promise<TaskWorkflowMutationResultV1>;
 filterQuery(request: TaskFilterQueryRequestV1): Promise<CheckboxOwnershipFilterResultV1>;
 audit(event: 'apply-dispatched' | 'apply-completed' | 'recovery-dispatched' | 'recovery-completed', request: CheckboxOwnershipApplyRequestV1, result?: CheckboxOwnershipMutationResultV1): Promise<void>;
}
/** Only admission/projection: writes, leases and recovery remain with existing executors. */
export function createCheckboxOwnershipRuntimeV1(ports: CheckboxOwnershipPortsV1): CheckboxOwnershipRuntimeV1 {
 const execute = async (value: unknown, recovery: boolean): Promise<CheckboxOwnershipMutationResultV1> => {
  const decoded = decodeCheckboxOwnershipApplyV1(value);
  if (!decoded.ok) return failure(requestId(value), 'invalid-request');
  const request = decoded.value;
  if (!ports.ready()) return failure(request.requestId, 'live-settling');
  try { if (recovery && !await ports.hasRecoveryEvidence(request)) return failure(request.requestId, 'invalid-request'); } catch { return failure(request.requestId, 'audit-unavailable'); }
  const inner = request.plan.executionPlan;
  const innerRequest = { ...request, plan: inner, idempotencyKey: checkboxOwnershipExecutionKeyV1(request.plan.capability, request.idempotencyKey), acknowledgements: request.acknowledgements.map(a => ({ ...a, planHash: inner.planHash })) };
  const prefix = recovery ? 'recovery' : 'apply';
  try { await ports.audit(`${prefix}-dispatched`, request); } catch { return failure(request.requestId, 'audit-unavailable'); }
  let result: MutationResultV1 | TaskWorkflowMutationResultV1;
  try {
   result = inner.capability === 'tasks.adopt.preview'
    ? await ports.applyAdopt(innerRequest as TaskWorkflowApplyRequestV1, request.plan.adoptionAfterDigest!, recovery)
    : await ports.applyCore(innerRequest as MutationApplyRequestV1);
  } catch { return uncertain(request); }
  const { continuation, ...rest } = result;
  const projected: CheckboxOwnershipMutationResultV1 = { ...rest,
   ...(result.receipt ? { receipt: { ...result.receipt, planHash: request.plan.planHash, idempotencyKeyHash: request.plan.idempotencyKeyHash } } : {}),
   ...(continuation ? { continuation: { ...continuation, originPlanHash: request.plan.planHash, plan: sealCheckboxOwnershipPlanV1(continuation.plan as CheckboxOwnershipExecutionPlanV1, request.plan.capability, request.idempotencyKey) } } : {}),
  };
  try { await ports.audit(`${prefix}-completed`, request, projected); } catch { return uncertain(request); }
  const output = decodeCheckboxOwnershipMutationResultV1(projected);
  return output.ok ? output.value : uncertain(request);
 };
 return Object.freeze({
  async preview(value: unknown): Promise<CheckboxOwnershipPreviewResultV1> {
   const decoded = decodeCheckboxOwnershipPreviewV1(value);
   if (!decoded.ok) return previewFailure(requestId(value), 'invalid-request');
   const request = decoded.value;
   if (!ports.ready()) return previewFailure(request.requestId, 'live-settling');
   const innerRequest = { ...request, capability: CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1[request.capability], idempotencyKey: checkboxOwnershipExecutionKeyV1(request.capability, request.idempotencyKey) };
   try {
    const prepared = request.capability === 'tasks.adopt.contiguous.preview'
     ? await ports.previewAdopt(innerRequest as TaskWorkflowPreviewRequestV1)
     : { result: await ports.previewCore(innerRequest as MutationPreviewRequestV1), afterDigest: undefined };
    if (!prepared.result.ok) return prepared.result;
    if (request.capability === 'tasks.adopt.contiguous.preview' && !prepared.afterDigest) return previewFailure(request.requestId, 'internal-error');
    const plan = sealCheckboxOwnershipPlanV1(prepared.result.plan as CheckboxOwnershipExecutionPlanV1, request.capability, request.idempotencyKey, prepared.afterDigest);
    const output = decodeCheckboxOwnershipPreviewResultV1({ ...prepared.result, plan });
    return output.ok ? output.value : previewFailure(request.requestId, 'internal-error');
   } catch { return previewFailure(request.requestId, 'internal-error'); }
  },
  apply: (value: unknown) => execute(value, false),
  recover: (value: unknown) => execute(value, true),
  async filterQuery(value: unknown): Promise<CheckboxOwnershipFilterResultV1> {
   const decoded = decodeCheckboxOwnershipFilterV1(value);
   if (!decoded.ok || !ports.ready()) return { contractVersion: 1, requestId: requestId(value), kind: 'task-filter-query-result', ok: false, freshness: { source: 'live-runtime', coherence: 'unverified', observedAt: new Date().toISOString(), settled: false }, warnings: [], error: structuredErrorV1(decoded.ok ? 'live-settling' : 'invalid-request', 'Checkbox ownership query admission failed.') };
   return await ports.filterQuery({ ...decoded.value, kind: 'task-filter-query' });
  },
 });
}
function requestId(value: unknown): string { return isRecord(value) && typeof value.requestId === 'string' ? value.requestId : 'invalid-request'; }
function failure(id: string, code: 'invalid-request' | 'live-settling' | 'audit-unavailable'): CheckboxOwnershipMutationResultV1 {
 return { contractVersion: 1, requestId: id, kind: 'mutation-result', status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [], error: structuredErrorV1(code, 'Checkbox ownership mutation admission failed.') };
}
function uncertain(request: CheckboxOwnershipApplyRequestV1): CheckboxOwnershipMutationResultV1 {
 return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-result', status: 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, ambiguitySource: 'group-outcome', groupResults: [{ groupId: request.plan.atomicGroups[0].groupId, status: 'outcome-unknown', error: structuredErrorV1('outcome-unknown', 'The dispatched group needs same-plan recovery.') }], error: structuredErrorV1('outcome-unknown', 'Recover the same checkbox ownership plan; do not repeat the mutation.') };
}
function previewFailure(id: string, code: 'invalid-request' | 'live-settling' | 'internal-error'): CheckboxOwnershipPreviewResultV1 {
 return { contractVersion: 1, requestId: id, kind: 'mutation-preview-result', ok: false, warnings: [], error: structuredErrorV1(code, 'Checkbox ownership preview failed.') };
}
