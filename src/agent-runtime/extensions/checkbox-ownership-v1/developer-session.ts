import { isRecord } from '../../../core/unknown-value';
import { structuredErrorV1, type StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { DeveloperApiConsumerDescriptorV1 } from '../../developer-api/grants';
import type { DeveloperCapabilityGrantV1, DeveloperPlanSecurityBindingV1 } from '../../developer-api/security';
import { IndexedDbDeveloperMutationRecoveryStoreV1, DEVELOPER_RECOVERY_RETENTION_MS_V1, type DeveloperMutationRecoveryRecordV1 } from '../../developer-api/recovery-store';
import { checkboxOwnershipApplyCapabilityV1, isCheckboxOwnershipCapabilityV1, type CheckboxOwnershipCapabilityV1, type CheckboxOwnershipSealedPlanV1, type CheckboxOwnershipMutationResultV1, type CheckboxOwnershipApplyRequestV1, type CheckboxOwnershipFilterRequestV1, type CheckboxOwnershipFilterResultV1 } from './contracts';
import { decodeCheckboxOwnershipPreviewV1, isCheckboxOwnershipPreviewCapabilityV1 } from './decode';
import { exactKeys, type CheckboxOwnershipCapabilitySubsetV1, type CheckboxOwnershipDeveloperApiV1, type CheckboxOwnershipDeveloperOptionsV1, type CheckboxOwnershipDeveloperPreviewIntentV1, type CheckboxOwnershipDeveloperPreviewResultV1, type CheckboxOwnershipDeveloperExecutionResultV1, type CheckboxOwnershipRecoverInputV1, type CheckboxOwnershipPendingRecoveriesResultV1, type CheckboxOwnershipPlanHandleV1 } from './developer-api';

interface BoundPlan {
 sealed: CheckboxOwnershipSealedPlanV1;
 binding: DeveloperPlanSecurityBindingV1;
 idempotencyKey: string;
 handle: CheckboxOwnershipPlanHandleV1;
 state: 'idle' | 'applying' | 'recovery-required' | 'terminal';
 credentials?: Pick<CheckboxOwnershipApplyRequestV1, 'authorization' | 'acknowledgements'>;
 terminal?: CheckboxOwnershipMutationResultV1;
}
/** Opaque host session; durable records use the existing guarded recovery store. */
export function createCheckboxOwnershipDeveloperSessionV1<C extends CheckboxOwnershipCapabilitySubsetV1>(core: OperonAgentRuntimeCoreV1, consumer: DeveloperApiConsumerDescriptorV1, capabilities: C, options: CheckboxOwnershipDeveloperOptionsV1): CheckboxOwnershipDeveloperApiV1<C> {
 const runtime = core.checkboxOwnership!;
 const session = Object.freeze({ consumerId: consumer.id, instanceEpoch: consumer.instanceEpoch, sessionId: options.createSessionId?.() ?? `checkbox-${hex(16)}` });
 const store = options.recoveryStore ?? new IndexedDbDeveloperMutationRecoveryStoreV1({ now: () => (options.now?.() ?? new Date()).getTime() });
 const policy = options.mutationSecurityPolicy;
 const plans = new WeakMap<CheckboxOwnershipPlanHandleV1, BoundPlan>();
 // Reference lookups in one session share state, so concurrent recovery cannot dispatch twice.
 const references = new Map<string, BoundPlan>();
 let sequence = 0;
 const nextId = () => `${session.sessionId}-${++sequence}`;
 const grant = (): DeveloperCapabilityGrantV1 => { const g = options.grantController.evaluate(consumer, capabilities); return { consumerId: consumer.id, state: g.state, revision: g.revision, capabilities: new Set(g.effectiveCapabilities) }; };
 const canUse = (capability: CheckboxOwnershipCapabilityV1): boolean => capabilities.includes(capability) && options.isCoreActive(core) && options.lifecyclePhase() === 'ready' && options.grantController.isConsumerCurrent(consumer) && grant().state === 'active' && grant().capabilities.has(capability) && core.hasCapability(capability);
 const denied = () => structuredErrorV1('authority-insufficient', 'The exact capability, active grant and current consumer session are required.');
 const bindHandle = (sealed: CheckboxOwnershipSealedPlanV1, binding: DeveloperPlanSecurityBindingV1, key: string, ref = `dvr1_${hex(24)}`): BoundPlan => {
  const handle = freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-plan', recoveryRef: ref, planDigest: sealed.planHash, createdAt: sealed.createdAt, expiresAt: sealed.expiresAt, riskLevel: sealed.riskLevel, requiresConsent: sealed.requiresConfirmation }) as CheckboxOwnershipPlanHandleV1;
  const bound: BoundPlan = { sealed: freeze(structuredClone(sealed)), binding, idempotencyKey: key, handle, state: 'idle' };
  plans.set(handle, bound); references.set(ref, bound); return bound;
 };
 const finish = async (id: string, bound: BoundPlan, result: CheckboxOwnershipMutationResultV1, recovery: boolean): Promise<CheckboxOwnershipDeveloperExecutionResultV1> => {
  if (recovery && !successful(result)) { bound.state = 'recovery-required'; return project(id, bound, { ...uncertain(id), error: result.error ?? uncertain(id).error }); }
  const success = successful(result);
  bound.state = success || (result.status === 'failed' && !result.mutationMayHaveApplied) ? 'terminal' : 'recovery-required';
  if (success) {
   bound.terminal = result;
   try { await store.markTerminal(consumer.id, bound.handle.recoveryRef); } catch { /* Keep the dispatched recovery record if finalization failed. */ }
  } else if (bound.state === 'terminal') {
   try { await store.markRefused(consumer.id, bound.handle.recoveryRef); }
   catch { bound.state = 'recovery-required'; return project(id, bound, uncertain(id)); }
  }
  return project(id, bound, result);
 };
 const execute = async (id: string, bound: BoundPlan, recovery: boolean): Promise<CheckboxOwnershipDeveloperExecutionResultV1> => {
  const capability = checkboxOwnershipApplyCapabilityV1(bound.sealed.capability);
  if (!canUse(capability) || !policy) return failed(id, denied());
  if (bound.terminal) return project(id, bound, { ...bound.terminal, status: 'already-applied', groupResults: [], postflight: { status: 'receipt-replay' } });
  if (bound.state !== (recovery ? 'recovery-required' : 'idle')) return failed(id, structuredErrorV1('invalid-request', `This plan is ${bound.state}; it cannot be dispatched again.`));
  bound.state = 'applying';
  if (recovery) {
   const admission = policy.admitRecovery({ session, plan: bound.sealed, dispatch: { binding: bound.binding, dispatchStarted: !!bound.credentials } });
   if (!admission.ok) { bound.state = 'recovery-required'; return failed(id, structuredErrorV1(admission.code, admission.reason)); }
  } else {
   const admission = await policy.admitApply({ session, grant: grant(), binding: bound.binding, plan: bound.sealed });
   if (!admission.ok || !canUse(capability)) { bound.state = 'terminal'; return failed(id, admission.ok ? denied() : structuredErrorV1(admission.code, admission.reason)); }
   bound.credentials = { authorization: admission.authorization, acknowledgements: [...admission.acknowledgements] };
   const createdAt = options.now?.() ?? new Date();
   try {
    await store.putPrepared({ contractVersion: 1, recoveryRef: bound.handle.recoveryRef, consumerId: consumer.id, planDigest: bound.sealed.planHash, sealed: bound.sealed, binding: bound.binding, idempotencyKey: bound.idempotencyKey, ...bound.credentials, state: 'prepared', createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + DEVELOPER_RECOVERY_RETENTION_MS_V1).toISOString() });
   } catch { bound.state = 'idle'; return failed(id, storageError()); }
   const dispatch = policy.claimApplyDispatch({ session, grant: grant(), binding: bound.binding, plan: bound.sealed });
   if (!dispatch.ok || !canUse(capability)) {
    bound.state = 'terminal';
    if (dispatch.ok) policy.releaseApplyDispatchClaim({ session, plan: bound.sealed });
    try { await store.markRefused(consumer.id, bound.handle.recoveryRef); } catch { /* Prepared records cannot recover. */ }
    return failed(id, dispatch.ok ? denied() : structuredErrorV1(dispatch.code, dispatch.reason));
   }
   try { await store.markDispatched(consumer.id, bound.handle.recoveryRef); }
   catch { policy.releaseApplyDispatchClaim({ session, plan: bound.sealed }); bound.state = 'idle'; return failed(id, storageError()); }
  }
  if (!canUse(capability)) { bound.state = 'recovery-required'; return failed(id, denied()); }
  let result: CheckboxOwnershipMutationResultV1;
  try { result = await runtime[recovery ? 'recover' : 'apply']({ contractVersion: 1, requestId: id, kind: 'mutation-apply', plan: bound.sealed, idempotencyKey: bound.idempotencyKey, ...bound.credentials }); }
  catch { result = uncertain(id); }
  return finish(id, bound, result, recovery);
 };
 const tasks: Record<string, unknown> = {};
 if (capabilities.includes('tasks.filter-query.contiguous')) tasks.filterQuery = async (input: CheckboxOwnershipFilterRequestV1): Promise<CheckboxOwnershipFilterResultV1> => {
  const fail = (error: StructuredErrorV1): CheckboxOwnershipFilterResultV1 => ({ contractVersion: 1, kind: 'task-filter-query-result', requestId: input?.requestId ?? 'invalid-request', ok: false, error, warnings: [], freshness: { source: 'live-runtime', coherence: 'unverified', observedAt: new Date(0).toISOString(), settled: false } });
  if (!canUse('tasks.filter-query.contiguous')) return freeze(fail(denied()));
  try { const result = await runtime.filterQuery(structuredClone(input)); return freeze(canUse('tasks.filter-query.contiguous') ? structuredClone(result) : fail(denied())); }
  catch { return freeze(fail(structuredErrorV1('invalid-request', 'The query could not be evaluated.'))); }
 };
 const mutations: Record<string, unknown> = {};
 if (capabilities.some(c => c.endsWith('.preview'))) mutations.preview = async (intent: CheckboxOwnershipDeveloperPreviewIntentV1): Promise<CheckboxOwnershipDeveloperPreviewResultV1> => {
  const id = nextId();
  const fail = (error: StructuredErrorV1): CheckboxOwnershipDeveloperPreviewResultV1 => freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-preview-result', requestId: id, ok: false, warnings: [], error });
  if (!isRecord(intent) || !(exactKeys(intent, ['capability', 'mutationKind', 'spec']) || exactKeys(intent, ['capability', 'mutationKind', 'spec', 'target'])) || !isCheckboxOwnershipPreviewCapabilityV1(intent.capability)) return fail(structuredErrorV1('invalid-request', 'Preview accepts only capability, mutationKind and spec.'));
  if (!canUse(intent.capability) || !policy) return fail(denied());
  const admission = policy.admitPreview({ session, grant: grant(), capability: intent.capability });
  if (!admission.ok) return fail(structuredErrorV1(admission.code, admission.reason));
  const key = hex(24);
  try {
   const request = { ...structuredClone(intent), contractVersion: 1, kind: 'mutation-preview', requestId: id, correlationId: id, clientInstanceId: `developer-api:${consumer.id}:${consumer.instanceEpoch}`, idempotencyKey: key, authorization: admission.authorization };
   if (!decodeCheckboxOwnershipPreviewV1(request).ok) return fail(structuredErrorV1('invalid-request', 'Invalid checkbox ownership preview intent.'));
   const result = await runtime.preview(request);
   if (!result.ok) return fail(result.error);
   if (!canUse(intent.capability) || result.plan.capability !== intent.capability) return fail(denied());
   const binding = policy.bindPlan({ session, grant: grant(), plan: result.plan });
   if (!binding.ok) return fail(structuredErrorV1(binding.code, binding.reason));
   const bound = bindHandle(result.plan, binding.binding, key);
   return freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-preview-result', requestId: id, ok: true, plan: bound.handle, warnings: structuredClone(result.warnings) });
  } catch { return fail(structuredErrorV1('internal-error', 'Checkbox ownership preview failed.')); }
 };
 if (capabilities.some(c => c.endsWith('.apply'))) {
  mutations.apply = async (input: { readonly plan: CheckboxOwnershipPlanHandleV1 }): Promise<CheckboxOwnershipDeveloperExecutionResultV1> => {
   const id = nextId(); const bound = isRecord(input) && exactKeys(input, ['plan']) ? plans.get(input.plan) : undefined;
   return bound ? execute(id, bound, false) : failed(id, structuredErrorV1('invalid-request', 'Apply requires an opaque plan from this session.'));
  };
  mutations.recover = async (input: CheckboxOwnershipRecoverInputV1): Promise<CheckboxOwnershipDeveloperExecutionResultV1> => {
   const id = nextId();
   if (!isRecord(input) || (!exactKeys(input, ['plan']) && !exactKeys(input, ['recoveryRef']))) return failed(id, structuredErrorV1('invalid-request', 'Recover requires exactly one plan or recoveryRef.'));
   let bound = input.plan ? plans.get(input.plan) : references.get(input.recoveryRef);
   if (!bound && typeof input.recoveryRef === 'string' && /^dvr1_[0-9a-f]{48}$/u.test(input.recoveryRef)) {
    let record: DeveloperMutationRecoveryRecordV1 | undefined;
    try { record = await store.get(consumer.id, input.recoveryRef); } catch { return failed(id, storageError()); }
    if (!record || record.state !== 'dispatched' || !('extension' in record.sealed) || record.sealed.extension !== 'checkbox-ownership-v1' || !canUse(checkboxOwnershipApplyCapabilityV1(record.sealed.capability))) return failed(id, denied());
    // Another lookup may have completed while storage was awaited.
    bound = references.get(input.recoveryRef) ?? bindHandle(record.sealed, record.binding, record.idempotencyKey, record.recoveryRef);
    if (bound.state === 'idle') { bound.state = 'recovery-required'; bound.credentials = { authorization: record.authorization, acknowledgements: [...record.acknowledgements] }; }
   }
   return bound ? execute(id, bound, true) : failed(id, structuredErrorV1('invalid-request', 'The recovery reference does not belong to a dispatched plan.'));
  };
  mutations.pendingRecoveries = async (): Promise<CheckboxOwnershipPendingRecoveriesResultV1> => {
   const failure = (error: StructuredErrorV1): CheckboxOwnershipPendingRecoveriesResultV1 => freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-pending-recoveries-result', ok: false, error });
   if (!capabilities.some(c => c.endsWith('.apply') && canUse(c))) return failure(denied());
   try {
    const records = await store.list(consumer.id);
    if (!capabilities.some(c => c.endsWith('.apply') && canUse(c))) return failure(denied());
    return freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-pending-recoveries-result', ok: true, recoveries: records.filter(r => r.state === 'dispatched' && isCheckboxOwnershipCapabilityV1(r.sealed.capability) && canUse(checkboxOwnershipApplyCapabilityV1(r.sealed.capability))).map(r => ({ recoveryRef: r.recoveryRef, planDigest: r.planDigest, createdAt: r.createdAt, expiresAt: r.expiresAt })) });
   } catch { return failure(storageError()); }
  };
 }
 return freeze({ contractVersion: 1, runtimeApi: 1, tasks, mutations }) as CheckboxOwnershipDeveloperApiV1<C>;
}
function project(id: string, bound: BoundPlan, result: CheckboxOwnershipMutationResultV1): CheckboxOwnershipDeveloperExecutionResultV1 {
 if (successful(result) && result.receipt && result.postflight) return freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-execution-result', requestId: id, status: result.status as 'applied' | 'already-applied', mutationMayHaveApplied: true, retryAllowed: false, groupResults: structuredClone(result.groupResults), receipt: { contractVersion: 1, planDigest: result.receipt.planHash, mutationKind: result.receipt.mutationKind, targetDigest: result.receipt.targetDigest, terminalOutcome: result.status as 'applied' | 'already-applied', effectiveAt: result.receipt.effectiveAt, completedAt: result.receipt.completedAt, expiresAt: result.receipt.expiresAt }, postflight: structuredClone(result.postflight) });
 if (result.status === 'failed' && !result.mutationMayHaveApplied) return failed(id, result.error ?? structuredErrorV1('internal-error', 'The operation failed.'));
 return freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-execution-result', requestId: id, status: result.status === 'partial' ? 'partial' : 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, groupResults: structuredClone(result.groupResults), error: structuredErrorV1('outcome-unknown', result.error?.reason ?? 'Recover this same plan.', { action: 'recover-same-plan' }), recovery: { required: true, action: 'recover-same-plan', mutationMayHaveApplied: true, recoveryRef: bound.handle.recoveryRef, planDigest: bound.handle.planDigest, plan: bound.handle } });
}
function successful(result: CheckboxOwnershipMutationResultV1): boolean { return ((result.status === 'applied' && result.postflight?.status === 'verified') || (result.status === 'already-applied' && result.postflight?.status === 'receipt-replay')) && !!result.receipt; }
function failed(id: string, error: StructuredErrorV1): CheckboxOwnershipDeveloperExecutionResultV1 { return freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-mutation-execution-result', requestId: id, status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [], error }); }
function uncertain(id: string): CheckboxOwnershipMutationResultV1 { return { contractVersion: 1, kind: 'mutation-result', requestId: id, status: 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], error: structuredErrorV1('outcome-unknown', 'Recover the same plan.', { action: 'recover-same-plan' }) }; }
function storageError(): StructuredErrorV1 { return structuredErrorV1('receipt-store-unavailable', 'Durable recovery storage is unavailable.'); }
function hex(length: number): string { return Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => byte.toString(16).padStart(2, '0')).join(''); }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
