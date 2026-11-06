import { structuredErrorV1 } from '../../contracts/v1/primitives';
import type { MutationPreviewRequestV1, MutationApplyRequestV1, MutationPreviewResultV1, MutationResultV1 } from '../../contracts/v1/mutation';
import { isRecord } from '../../../core/unknown-value';
import { fileTaskTitlesExecutionRequestV1, fileTaskTitlesExecutionKeyV1, decodeFileTaskTitlesApplyV1, decodeFileTaskTitlesPreviewResultV1, decodeFileTaskTitlesMutationResultV1, decodeFileTaskTitlesPreviewV1, sealFileTaskTitlesPlanV1 } from './decode';
import type { FileTaskTitlesApplyRequestV1, FileTaskTitlesPreviewResultV1, FileTaskTitlesMutationResultV1 } from './contracts';

export interface FileTaskTitlesRuntimeV1 {
 preview(value: unknown): Promise<FileTaskTitlesPreviewResultV1>;
 apply(value: unknown): Promise<FileTaskTitlesMutationResultV1>;
 recover(value: unknown): Promise<FileTaskTitlesMutationResultV1>;
}
export interface FileTaskTitlesPortsV1 {
 ready(): boolean;
 hasRecoveryEvidence(request: FileTaskTitlesApplyRequestV1): Promise<boolean>;
 previewCore(request: MutationPreviewRequestV1): Promise<MutationPreviewResultV1>;
 applyCore(request: MutationApplyRequestV1): Promise<MutationResultV1 & { recoveryOutcome?: 'compensated' }>;
 audit(event: 'apply-dispatched' | 'apply-completed' | 'recovery-dispatched' | 'recovery-completed', request: FileTaskTitlesApplyRequestV1, result?: FileTaskTitlesMutationResultV1): Promise<void>;
}
/** Only admission/projection: writes, leases and recovery remain with existing executors. */
export function createFileTaskTitlesRuntimeV1(ports: FileTaskTitlesPortsV1): FileTaskTitlesRuntimeV1 {
 const execute = async (value: unknown, recovery: boolean): Promise<FileTaskTitlesMutationResultV1> => {
  const decoded = decodeFileTaskTitlesApplyV1(value);
  if (!decoded.ok) return failure(requestId(value), 'invalid-request');
  const request = decoded.value;
  if (!ports.ready()) return failure(request.requestId, 'live-settling');
  try { if (recovery && !await ports.hasRecoveryEvidence(request)) return failure(request.requestId, 'invalid-request'); } catch { return failure(request.requestId, 'audit-unavailable'); }
  const inner = request.plan.executionPlan;
  const innerRequest = { ...request, plan: inner, idempotencyKey: fileTaskTitlesExecutionKeyV1(request.plan.capability, request.idempotencyKey), acknowledgements: request.acknowledgements.map(a => ({ ...a, planHash: inner.planHash })) };
  const prefix = recovery ? 'recovery' : 'apply';
  try { await ports.audit(`${prefix}-dispatched`, request); } catch { return failure(request.requestId, 'audit-unavailable'); }
  let result: MutationResultV1 & { recoveryOutcome?: 'compensated' };
  try {
   result = await ports.applyCore(innerRequest);
  } catch { return uncertain(request); }
  const { continuation, ...rest } = result;
  const projected: FileTaskTitlesMutationResultV1 = { ...rest,
   ...(result.receipt ? { receipt: { ...result.receipt, planHash: request.plan.planHash, idempotencyKeyHash: request.plan.idempotencyKeyHash } } : {}),
   ...(continuation ? { continuation: { ...continuation, originPlanHash: request.plan.planHash, plan: sealFileTaskTitlesPlanV1(continuation.plan, request.plan.capability, request.idempotencyKey, request.plan.spec) } } : {}),
  };
  try { await ports.audit(`${prefix}-completed`, request, projected); } catch { return uncertain(request); }
  const output = decodeFileTaskTitlesMutationResultV1(projected);
  return output.ok ? output.value : uncertain(request);
 };
 return Object.freeze({
  async preview(value: unknown): Promise<FileTaskTitlesPreviewResultV1> {
   const decoded = decodeFileTaskTitlesPreviewV1(value);
   if (!decoded.ok) return previewFailure(requestId(value), 'invalid-request');
   const request = decoded.value;
   if (!ports.ready()) return previewFailure(request.requestId, 'live-settling');
   try {
    const result = await ports.previewCore(fileTaskTitlesExecutionRequestV1(request));
    if (!result.ok) return result;
    const plan = sealFileTaskTitlesPlanV1(result.plan, request.capability, request.idempotencyKey, request.spec);
    const output = decodeFileTaskTitlesPreviewResultV1({ ...result, plan });
    return output.ok ? output.value : previewFailure(request.requestId, 'internal-error');
   } catch { return previewFailure(request.requestId, 'internal-error'); }
  },
  apply: (value: unknown) => execute(value, false),
  recover: (value: unknown) => execute(value, true),

 });
}
function requestId(value: unknown): string { return isRecord(value) && typeof value.requestId === 'string' ? value.requestId : 'invalid-request'; }
function failure(id: string, code: 'invalid-request' | 'live-settling' | 'audit-unavailable'): FileTaskTitlesMutationResultV1 {
 return { contractVersion: 1, requestId: id, kind: 'mutation-result', status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [], error: structuredErrorV1(code, 'File Task title mutation admission failed.') };
}
function uncertain(request: FileTaskTitlesApplyRequestV1): FileTaskTitlesMutationResultV1 {
 return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-result', status: 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, ambiguitySource: 'group-outcome', groupResults: [{ groupId: request.plan.atomicGroups[0].groupId, status: 'outcome-unknown', error: structuredErrorV1('outcome-unknown', 'The dispatched group needs same-plan recovery.') }], error: structuredErrorV1('outcome-unknown', 'Recover the same File Task title plan; do not repeat the mutation.') };
}
function previewFailure(id: string, code: 'invalid-request' | 'live-settling' | 'internal-error'): FileTaskTitlesPreviewResultV1 {
 return { contractVersion: 1, requestId: id, kind: 'mutation-preview-result', ok: false, warnings: [], error: structuredErrorV1(code, 'File Task title preview failed.') };
}
