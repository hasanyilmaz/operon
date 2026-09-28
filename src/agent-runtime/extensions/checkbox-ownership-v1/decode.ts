import { decodeMutationPreviewRequestV1, decodeMutationApplyRequestV1, decodeMutationPreviewResultV1, decodeMutationResultV1, type DecodeResultV1 } from '../../contracts/v1/decode';
import { canonicalJsonV1, computeSealedMutationPlanHashV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import { decodeTaskWorkflowPreviewRequestExtensionV1, decodeTaskWorkflowApplyRequestExtensionV1, decodeTaskFilterQueryRequestExtensionV1, decodeTaskWorkflowPreviewResultExtensionV1, decodeTaskWorkflowMutationResultExtensionV1 } from '../task-workflows-v1/decode';
import { IDEMPOTENCY_KEY_PATTERN_V1, CONTRACT_LIMITS_V1 } from '../../contracts/v1/primitives';
import { isRecord } from '../../../core/unknown-value';
import { CHECKBOX_OWNERSHIP_EXTENSION_V1, type CheckboxOwnershipPreviewCapabilityV1, type CheckboxOwnershipPreviewRequestV1, type CheckboxOwnershipApplyRequestV1, type CheckboxOwnershipSealedPlanV1, type CheckboxOwnershipExecutionPlanV1, type CheckboxOwnershipFilterRequestV1, type CheckboxOwnershipPreviewResultV1, type CheckboxOwnershipMutationResultV1 } from './contracts';

export const CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1 = {
 'tasks.create.contiguous.preview': 'tasks.create.preview',
 'tasks.adopt.contiguous.preview': 'tasks.adopt.preview',
 'tasks.inline.relocate.contiguous.preview': 'tasks.inline.relocate.preview',
 'tasks.convert.contiguous.preview': 'tasks.convert.preview',
} as const;
export function isCheckboxOwnershipPreviewCapabilityV1(value: unknown): value is CheckboxOwnershipPreviewCapabilityV1 {
 return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1, value) === true;
}
export function checkboxOwnershipExecutionKeyV1(capability: CheckboxOwnershipPreviewCapabilityV1, key: string): string {
 return sha256HexV1(`${CHECKBOX_OWNERSHIP_EXTENSION_V1}\0${capability}\0${key}`);
}
export function checkboxOwnershipPlanHashV1(plan: CheckboxOwnershipSealedPlanV1): string {
 const { planHash: _hash, ...body } = plan;
 return sha256HexV1(canonicalJsonV1(toJsonValueV1(body)));
}
export function sealCheckboxOwnershipPlanV1(executionPlan: CheckboxOwnershipExecutionPlanV1, capability: CheckboxOwnershipPreviewCapabilityV1, key: string, adoptionAfterDigest?: string): CheckboxOwnershipSealedPlanV1 {
 const plan: CheckboxOwnershipSealedPlanV1 = { ...executionPlan, extension: CHECKBOX_OWNERSHIP_EXTENSION_V1, capability, executionPlan, idempotencyKeyHash: sha256HexV1(key), planHash: '', ...(adoptionAfterDigest ? { adoptionAfterDigest } : {}) };
 plan.planHash = checkboxOwnershipPlanHashV1(plan);
 return plan;
}
export function decodeCheckboxOwnershipPreviewV1(value: unknown): DecodeResultV1<CheckboxOwnershipPreviewRequestV1> {
 if (!isRecord(value) || !isCheckboxOwnershipPreviewCapabilityV1(value.capability)) return invalid();
 const inner = { ...value, capability: CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1[value.capability] };
 const decoded = value.capability === 'tasks.adopt.contiguous.preview' ? decodeTaskWorkflowPreviewRequestExtensionV1(inner) : decodeMutationPreviewRequestV1(inner);
 if (!decoded.ok || (value.capability === 'tasks.convert.contiguous.preview' && (!isRecord(value.spec) || value.spec.from !== 'inline' || value.spec.to !== 'file'))) return invalid();
 return { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipPreviewRequestV1 };
}
export function decodeCheckboxOwnershipFilterV1(value: unknown): DecodeResultV1<CheckboxOwnershipFilterRequestV1> {
 if (!isRecord(value) || value.kind !== 'task-filter-query-contiguous') return invalid();
 const decoded = decodeTaskFilterQueryRequestExtensionV1({ ...value, kind: 'task-filter-query' });
 return decoded.ok ? { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipFilterRequestV1 } : invalid();
}
export function decodeCheckboxOwnershipApplyV1(value: unknown): DecodeResultV1<CheckboxOwnershipApplyRequestV1> {
 try {
  if (new TextEncoder().encode(JSON.stringify(value)).length > CONTRACT_LIMITS_V1.transportInputBytes) return invalid();
  return decodeApply(value);
 } catch { return invalid(); }
}
function decodeApply(value: unknown): DecodeResultV1<CheckboxOwnershipApplyRequestV1> {
 if (!isRecord(value) || !isRecord(value.plan) || !isRecord(value.plan.executionPlan) || !isCheckboxOwnershipPreviewCapabilityV1(value.plan.capability) || (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN_V1.test(value.idempotencyKey))) return invalid();
 const plan = value.plan;
 const capability = value.plan.capability;
 const inner = value.plan.executionPlan;
 if (inner.capability !== CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1[capability]) return invalid();
 const adopt = capability === 'tasks.adopt.contiguous.preview';
 if (adopt ? typeof plan.adoptionAfterDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(plan.adoptionAfterDigest) : plan.adoptionAfterDigest !== undefined) return invalid();
 const executionKey = checkboxOwnershipExecutionKeyV1(capability, value.idempotencyKey);
 const innerApply: Record<string, unknown> = { ...value, plan: inner, idempotencyKey: executionKey };
 // Only the hash is translated, after the external acknowledgement binding is checked below.
 if (!Array.isArray(value.acknowledgements) || value.acknowledgements.some(a => !isRecord(a) || a.planHash !== plan.planHash || a.targetDigest !== (Array.isArray(plan.targets) && isRecord(plan.targets[0]) ? plan.targets[0].targetDigest : undefined))) return invalid();
 innerApply.acknowledgements = value.acknowledgements.map((a: unknown) => { if (!isRecord(a)) throw new Error('Invalid acknowledgement'); return { ...a, planHash: inner.planHash }; });
 const decoded = adopt ? decodeTaskWorkflowApplyRequestExtensionV1(innerApply) : decodeMutationApplyRequestV1(innerApply);
 if (!decoded.ok || inner.idempotencyKeyHash !== sha256HexV1(executionKey)) return invalid();
 if (capability === 'tasks.convert.contiguous.preview' && (!isRecord(inner.spec) || inner.spec.from !== 'inline' || inner.spec.to !== 'file')) return invalid();
 const executionPlan = inner as unknown as CheckboxOwnershipExecutionPlanV1;
 const innerHash = adopt ? hashWithoutPlanHash(inner) : computeSealedMutationPlanHashV1(executionPlan as import('../../contracts/v1/mutation').SealedMutationPlanV1);
 if (inner.planHash !== innerHash) return invalid();
 const expected = sealCheckboxOwnershipPlanV1(executionPlan, capability, value.idempotencyKey, adopt ? plan.adoptionAfterDigest as string : undefined);
 if (canonicalJsonV1(toJsonValueV1(plan)) !== canonicalJsonV1(toJsonValueV1(expected))) return invalid();
 return { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipApplyRequestV1 };
}
function hashWithoutPlanHash(plan: Record<string, unknown>): string {
 const { planHash: _hash, ...body } = plan;
 return sha256HexV1(canonicalJsonV1(toJsonValueV1(body)));
}
function invalid<T>(): DecodeResultV1<T> {
 return { ok: false, issues: [{ path: '', code: 'value', message: 'Invalid checkbox-ownership extension input or sealed binding.' }] };
}

/** Validate response envelopes without requiring a caller's raw idempotency key. */
export function decodeCheckboxOwnershipPlanV1(value: unknown): DecodeResultV1<CheckboxOwnershipSealedPlanV1> {
 try {
  if (!isRecord(value) || !isRecord(value.executionPlan) || !isCheckboxOwnershipPreviewCapabilityV1(value.capability) || typeof value.idempotencyKeyHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.idempotencyKeyHash)) return invalid();
  const inner = value.executionPlan;
  if (inner.capability !== CHECKBOX_OWNERSHIP_INNER_CAPABILITIES_V1[value.capability]) return invalid();
  const adopt = value.capability === 'tasks.adopt.contiguous.preview';
  const preview = { contractVersion: 1, requestId: 'checkbox-plan-validation', kind: 'mutation-preview-result', ok: true, warnings: [], plan: inner };
  if (!(adopt ? decodeTaskWorkflowPreviewResultExtensionV1(preview) : decodeMutationPreviewResultV1(preview)).ok) return invalid();
  if (inner.planHash !== (adopt ? hashWithoutPlanHash(inner) : computeSealedMutationPlanHashV1(inner as unknown as import('../../contracts/v1/mutation').SealedMutationPlanV1))) return invalid();
  if (adopt ? typeof value.adoptionAfterDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.adoptionAfterDigest) : value.adoptionAfterDigest !== undefined) return invalid();
  if (value.capability === 'tasks.convert.contiguous.preview' && (!isRecord(inner.spec) || inner.spec.from !== 'inline' || inner.spec.to !== 'file')) return invalid();
  const expected = { ...inner, extension: CHECKBOX_OWNERSHIP_EXTENSION_V1, capability: value.capability, executionPlan: inner, idempotencyKeyHash: value.idempotencyKeyHash, planHash: value.planHash, ...(adopt ? { adoptionAfterDigest: value.adoptionAfterDigest } : {}) };
  if (canonicalJsonV1(toJsonValueV1(expected)) !== canonicalJsonV1(toJsonValueV1(value)) || value.planHash !== hashWithoutPlanHash(value)) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipSealedPlanV1 };
 } catch { return invalid(); }
}
export function decodeCheckboxOwnershipPreviewResultV1(value: unknown): DecodeResultV1<CheckboxOwnershipPreviewResultV1> {
 try {
  if (!isRecord(value) || new TextEncoder().encode(JSON.stringify(value)).length > CONTRACT_LIMITS_V1.transportResultBytes) return invalid();
  if (value.ok === false) { const result = decodeMutationPreviewResultV1(value); return result.ok ? { ok: true, value: result.value as CheckboxOwnershipPreviewResultV1 } : invalid(); }
  const plan = decodeCheckboxOwnershipPlanV1(value.plan);
  if (!plan.ok) return invalid();
  const inner = { ...value, plan: plan.value.executionPlan };
  if (!(plan.value.capability === 'tasks.adopt.contiguous.preview' ? decodeTaskWorkflowPreviewResultExtensionV1(inner) : decodeMutationPreviewResultV1(inner)).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipPreviewResultV1 };
 } catch { return invalid(); }
}
export function decodeCheckboxOwnershipMutationResultV1(value: unknown): DecodeResultV1<CheckboxOwnershipMutationResultV1> {
 try {
  if (!isRecord(value) || new TextEncoder().encode(JSON.stringify(value)).length > CONTRACT_LIMITS_V1.transportResultBytes) return invalid();
  let continuation = value.continuation;
  if (continuation !== undefined) {
   if (!isRecord(continuation)) return invalid();
   const plan = decodeCheckboxOwnershipPlanV1(continuation.plan);
   if (!plan.ok || plan.value.capability === 'tasks.adopt.contiguous.preview') return invalid();
   continuation = { ...continuation, plan: plan.value.executionPlan };
  }
  const inner = { ...value, ...(continuation === undefined ? {} : { continuation }) };
  if (isRecord(value.receipt) && !['task.create', 'task.adopt', 'task.inline-relocate', 'task.convert'].includes(value.receipt.mutationKind as string)) return invalid();
  const adopt = isRecord(value.receipt) && value.receipt.mutationKind === 'task.adopt';
  if (!(adopt ? decodeTaskWorkflowMutationResultExtensionV1(inner) : decodeMutationResultV1(inner)).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as CheckboxOwnershipMutationResultV1 };
 } catch { return invalid(); }
}
