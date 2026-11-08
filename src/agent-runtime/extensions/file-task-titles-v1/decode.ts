import { decodeMutationPreviewRequestV1, decodeMutationApplyRequestV1, decodeMutationPreviewResultV1, decodeMutationResultV1, type DecodeResultV1 } from '../../contracts/v1/decode';
import { canonicalJsonV1, computeSealedMutationPlanHashV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import { CONTRACT_LIMITS_V1, IDEMPOTENCY_KEY_PATTERN_V1 } from '../../contracts/v1/primitives';
import type { MutationPreviewRequestV1, MutationSpecV1, SealedMutationPlanV1 } from '../../contracts/v1/mutation';
import { isRecord } from '../../../core/unknown-value';
import { FILE_TASK_TITLES_EXTENSION_V1, type FileTaskTitlesPreviewCapabilityV1, type FileTaskTitlesPreviewRequestV1, type FileTaskTitlesSealedPlanV1, type FileTaskTitlesApplyRequestV1, type FileTaskTitlesPreviewResultV1, type FileTaskTitlesMutationResultV1 } from './contracts';

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)); }
export function isFileTaskTitlesPreviewCapabilityV1(value: unknown): value is FileTaskTitlesPreviewCapabilityV1 { return value === 'tasks.file.create.preview' || value === 'tasks.file.title.preview'; }
export function fileTaskTitlesExecutionKeyV1(capability: FileTaskTitlesPreviewCapabilityV1, key: string): string { return sha256HexV1(`${FILE_TASK_TITLES_EXTENSION_V1}\0${capability}\0${key}`); }
function equal(a: unknown, b: unknown): boolean { return canonicalJsonV1(toJsonValueV1(a)) === canonicalJsonV1(toJsonValueV1(b)); }
function hash(plan: FileTaskTitlesSealedPlanV1): string { const { planHash: _hash, ...body } = plan; return sha256HexV1(canonicalJsonV1(toJsonValueV1(body))); }
function innerSpec(spec: FileTaskTitlesSealedPlanV1['spec']): MutationSpecV1 {
 if (spec.operation === 'create-file') { const { displayTitle, ...item } = spec.item; return { operation: 'create', items: [{ ...item, description: displayTitle }] }; }
 return { operation: 'update', changes: [spec.displayTitle === null ? { operation: 'clear', field: 'fileTaskDisplayTitle', valueType: 'text' } : { field: 'fileTaskDisplayTitle', valueType: 'text', value: spec.displayTitle }] };
}
export function fileTaskTitlesExecutionRequestV1(request: FileTaskTitlesPreviewRequestV1): MutationPreviewRequestV1 {
 return { ...request, capability: request.capability === 'tasks.file.create.preview' ? 'tasks.create.preview' : 'tasks.update.preview', spec: innerSpec(request.spec), idempotencyKey: fileTaskTitlesExecutionKeyV1(request.capability, request.idempotencyKey) };
}
function validSpec(capability: FileTaskTitlesPreviewCapabilityV1, value: unknown): boolean {
 if (!isRecord(value)) return false;
 if (capability === 'tasks.file.create.preview') return exactKeys(value, ['operation', 'item']) && value.operation === 'create-file' && isRecord(value.item) && typeof value.item.displayTitle === 'string' && new TextEncoder().encode(value.item.displayTitle).length <= 8192 && !('description' in value.item) && isRecord(value.item.target) && value.item.target.representation === 'file';
 return exactKeys(value, ['operation', 'displayTitle']) && value.operation === 'set-title' && (value.displayTitle === null || typeof value.displayTitle === 'string' && new TextEncoder().encode(value.displayTitle).length <= 8192);
}
export function decodeFileTaskTitlesPreviewV1(value: unknown): DecodeResultV1<FileTaskTitlesPreviewRequestV1> {
 try {
  if (!isRecord(value) || !isFileTaskTitlesPreviewCapabilityV1(value.capability) || !validSpec(value.capability, value.spec) || new TextEncoder().encode(JSON.stringify(value)).length > CONTRACT_LIMITS_V1.transportInputBytes) return invalid();
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN_V1.test(value.idempotencyKey)) return invalid();
  if (value.capability === 'tasks.file.title.preview' && (!isRecord(value.target) || !isRecord(value.target.locator) || value.target.locator.representation !== 'file')) return invalid();
  if (value.capability === 'tasks.file.create.preview' && 'target' in value) return invalid();
  const request = value as unknown as FileTaskTitlesPreviewRequestV1;
  if (!decodeMutationPreviewRequestV1(fileTaskTitlesExecutionRequestV1(request)).ok) return invalid();
  return { ok: true, value: structuredClone(request) };
 } catch { return invalid(); }
}
export function sealFileTaskTitlesPlanV1(executionPlan: SealedMutationPlanV1, capability: FileTaskTitlesPreviewCapabilityV1, key: string, spec: FileTaskTitlesSealedPlanV1['spec']): FileTaskTitlesSealedPlanV1 {
 const plan: FileTaskTitlesSealedPlanV1 = { ...executionPlan, extension: FILE_TASK_TITLES_EXTENSION_V1, capability, spec, executionPlan, idempotencyKeyHash: sha256HexV1(key), planHash: '' };
 plan.planHash = hash(plan); return plan;
}
export function decodeFileTaskTitlesPlanV1(value: unknown): DecodeResultV1<FileTaskTitlesSealedPlanV1> {
 try {
  if (!isRecord(value) || !isFileTaskTitlesPreviewCapabilityV1(value.capability) || !validSpec(value.capability, value.spec) || !isRecord(value.executionPlan) || typeof value.idempotencyKeyHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.idempotencyKeyHash)) return invalid();
  const plan = value as unknown as FileTaskTitlesSealedPlanV1, inner = plan.executionPlan;
  if (inner.capability !== (plan.capability === 'tasks.file.create.preview' ? 'tasks.create.preview' : 'tasks.update.preview') || !equal(inner.spec, innerSpec(plan.spec))) return invalid();
  if (!decodeMutationPreviewResultV1({ contractVersion: 1, requestId: 'file-title-plan', kind: 'mutation-preview-result', ok: true, warnings: [], plan: inner }).ok || inner.planHash !== computeSealedMutationPlanHashV1(inner)) return invalid();
  if (plan.capability === 'tasks.file.title.preview' && (inner.targets.length !== 1 || inner.targets[0]?.locator?.representation !== 'file')) return invalid();
  const expected = { ...inner, extension: FILE_TASK_TITLES_EXTENSION_V1, capability: plan.capability, spec: plan.spec, executionPlan: inner, idempotencyKeyHash: plan.idempotencyKeyHash, planHash: plan.planHash };
  if (!equal(plan, expected) || hash(plan) !== plan.planHash) return invalid();
  return { ok: true, value: structuredClone(plan) };
 } catch { return invalid(); }
}
export function decodeFileTaskTitlesApplyV1(value: unknown): DecodeResultV1<FileTaskTitlesApplyRequestV1> {
 try {
  if (!isRecord(value) || new TextEncoder().encode(JSON.stringify(value)).length > CONTRACT_LIMITS_V1.transportInputBytes) return invalid();
  const decoded = decodeFileTaskTitlesPlanV1(value.plan);
  if (!decoded.ok || typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN_V1.test(value.idempotencyKey)) return invalid();
  const plan = decoded.value, key = fileTaskTitlesExecutionKeyV1(plan.capability, value.idempotencyKey);
  if (plan.idempotencyKeyHash !== sha256HexV1(value.idempotencyKey) || plan.executionPlan.idempotencyKeyHash !== sha256HexV1(key)) return invalid();
  if (!Array.isArray(value.acknowledgements) || value.acknowledgements.some(a => !isRecord(a) || a.planHash !== plan.planHash || a.targetDigest !== plan.targets[0]?.targetDigest)) return invalid();
  const acknowledgements = value.acknowledgements.map((a: unknown) => { if (!isRecord(a)) throw new Error('Invalid acknowledgement'); return { ...a, planHash: plan.executionPlan.planHash }; });
  if (!decodeMutationApplyRequestV1({ ...value, plan: plan.executionPlan, idempotencyKey: key, acknowledgements }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as FileTaskTitlesApplyRequestV1 };
 } catch { return invalid(); }
}
export function decodeFileTaskTitlesPreviewResultV1(value: unknown): DecodeResultV1<FileTaskTitlesPreviewResultV1> {
 try {
  if (!isRecord(value)) return invalid();
  if (value.ok === false) { const result = decodeMutationPreviewResultV1(value); return result.ok ? { ok: true, value: result.value as FileTaskTitlesPreviewResultV1 } : invalid(); }
  const plan = decodeFileTaskTitlesPlanV1(value.plan);
  if (!plan.ok || !decodeMutationPreviewResultV1({ ...value, plan: plan.value.executionPlan }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as FileTaskTitlesPreviewResultV1 };
 } catch { return invalid(); }
}
export function decodeFileTaskTitlesMutationResultV1(value: unknown): DecodeResultV1<FileTaskTitlesMutationResultV1> {
 try {
  if (!isRecord(value)) return invalid();
  let continuation = value.continuation;
  if (continuation !== undefined) { if (!isRecord(continuation)) return invalid(); const plan = decodeFileTaskTitlesPlanV1(continuation.plan); if (!plan.ok || plan.value.capability !== 'tasks.file.create.preview') return invalid(); continuation = { ...continuation, plan: plan.value.executionPlan }; }
  if (isRecord(value.receipt) && !['task.create', 'task.update'].includes(value.receipt.mutationKind as string)) return invalid();
  if (value.recoveryOutcome !== undefined && (value.recoveryOutcome !== 'compensated' || value.status !== 'failed' || value.mutationMayHaveApplied !== false || continuation !== undefined)) return invalid();
  const { recoveryOutcome: _recoveryOutcome, ...result } = value;
  if (!decodeMutationResultV1({ ...result, ...(continuation === undefined ? {} : { continuation }) }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as FileTaskTitlesMutationResultV1 };
 } catch { return invalid(); }
}
function invalid<T>(): DecodeResultV1<T> { return { ok: false, issues: [{ path: '', code: 'value', message: 'Invalid File Task title request or sealed plan binding.' }] }; }
