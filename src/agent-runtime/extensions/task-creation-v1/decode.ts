import { validateInlinePropertyDefinitions } from '../../../core/inline-property-definitions';
import { isSupportedRawYamlPropertyValue } from '../../../core/raw-yaml-property';
import { decodeTaskWorkflowPreviewRequestExtensionV1, decodeTaskWorkflowPreviewResultExtensionV1 } from '../task-workflows-v1/decode';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1, computeSealedMutationPlanHashV1 } from '../../contracts/v1/canonical';
import type { SealedMutationPlanV1, CreateTaskTargetV1 } from '../../contracts/v1/mutation';
import { decodeMutationPreviewRequestV1, decodeMutationPreviewResultV1, decodeMutationApplyRequestV1, decodeMutationResultV1, decodeStructuredErrorV1, type DecodeResultV1 } from '../../contracts/v1/decode';
import { REQUEST_ID_PATTERN_V1, CONTRACT_LIMITS_V1, utf8ByteLengthV1 } from '../../contracts/v1/primitives';
import { isRecord } from '../../../core/unknown-value';
import { TASK_CREATION_POLICY_SCHEMA_V1, matchesCreationSchemaV1 } from './schema';
import type { TaskCreationPolicyRequestV1, TaskCreationPolicyResultV1, RoutedTaskCreationPreviewRequestV1, RoutedTaskCreationApplyRequestV1, RoutedTaskCreationPlanV1, RoutedTaskCreationPreviewResultV1, RoutedTaskCreationMutationResultV1 } from './contracts';
export function creationKeysV1(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
 return required.every(k => Object.prototype.hasOwnProperty.call(value, k)) && Reflect.ownKeys(value).every(k => typeof k === 'string' && [...required, ...optional].includes(k));
}
function invalid<T>(): DecodeResultV1<T> { return { ok: false, issues: [{ path: '', code: 'value', message: 'Invalid task creation extension value.' }] }; }
function validId(value: unknown): value is string { return typeof value === 'string' && REQUEST_ID_PATTERN_V1.test(value) && utf8ByteLengthV1(value) <= CONTRACT_LIMITS_V1.requestIdBytes; }
export function decodeTaskCreationPolicyRequestV1(value: unknown): DecodeResultV1<TaskCreationPolicyRequestV1> {
 try {
 if (!isRecord(value) || !creationKeysV1(value, ['contractVersion', 'requestId', 'kind', 'consistency']) || value.contractVersion !== 1 || value.kind !== 'task-creation-policy' || value.consistency !== 'live-verified' || !validId(value.requestId)) return invalid();
 return { ok: true, value: structuredClone(value) as unknown as TaskCreationPolicyRequestV1 };
 } catch { return invalid(); }
}
export function decodeTaskCreationPolicyResultV1(value: unknown): DecodeResultV1<TaskCreationPolicyResultV1> {
 try {
 if (utf8ByteLengthV1(JSON.stringify(value) ?? '') > CONTRACT_LIMITS_V1.transportResultBytes - 16384) return invalid();
 if (!isRecord(value) || value.contractVersion !== 1 || value.kind !== 'task-creation-policy-result' || !validId(value.requestId)) return invalid();
 const base = ['contractVersion', 'requestId', 'kind', 'ok'];
 if (value.ok === false && creationKeysV1(value, [...base, 'error']) && decodeStructuredErrorV1(value.error).ok) return { ok: true, value: structuredClone(value) as unknown as TaskCreationPolicyResultV1 };
 if (value.ok !== true || !creationKeysV1(value, [...base, 'policy', 'policyRevision']) || typeof value.policyRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.policyRevision) || !matchesCreationSchemaV1(value.policy, TASK_CREATION_POLICY_SCHEMA_V1)) return invalid();
 return { ok: true, value: structuredClone(value) as unknown as TaskCreationPolicyResultV1 };
 } catch { return invalid(); }
}
/** Strict single-task intent admission; execution uses the shared Plugin services. */
export function decodeRoutedTaskCreationPreviewV1(value: unknown): DecodeResultV1<RoutedTaskCreationPreviewRequestV1> {
 try {
 if (utf8ByteLengthV1(JSON.stringify(value) ?? '') > CONTRACT_LIMITS_V1.transportInputBytes) return invalid();
 if (!isRecord(value) || value.capability !== 'tasks.create.routed.preview' || value.mutationKind !== 'task.create' || 'target' in value || !isRecord(value.spec) || !creationKeysV1(value.spec, ['operation', 'item']) || value.spec.operation !== 'create' || !isRecord(value.spec.item)) return invalid();
 const item = value.spec.item;
 if (!isRecord(item.target) || !isRecord(item.template) || 'description' in item) return invalid();
 const target = item.target, template = item.template;
 if (template.mode === 'selected' ? !creationKeysV1(template, ['mode', 'templateId']) || typeof template.templateId !== 'string' || template.templateId.length > 4096 || !template.templateId.trim() : !creationKeysV1(template, ['mode']) || !['configured', 'none'].includes(String(template.mode))) return invalid();
 let legacyTarget: unknown = target;
 if (target.mode === 'periodic-note') {
  if (!creationKeysV1(target, ['mode', 'representation', 'periodicKind'], ['routeDate']) || target.representation !== 'inline' || !['daily', 'weekly'].includes(String(target.periodicKind)) || item.parent !== undefined || item.bodyMarkdown !== undefined) return invalid();
  if (target.routeDate !== undefined && (typeof target.routeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(target.routeDate) || Number.isNaN(Date.parse(target.routeDate)) || new Date(target.routeDate).toISOString().slice(0, 10) !== target.routeDate)) return invalid();
  legacyTarget = { mode: 'configured-default', representation: 'inline' };
 } else if (target.mode === 'configured-default') {
  if (!creationKeysV1(target, ['mode'], ['representation'])) return invalid();
 } else if (target.mode === 'exact-path') {
  if (!creationKeysV1(target, ['mode', 'representation', 'filePath'], ['lineNumber']) || target.representation === 'file' && target.lineNumber !== undefined) return invalid();
 } else return invalid();
 if (item.nativeProperties !== undefined && (!Array.isArray(item.nativeProperties) || item.nativeProperties.length > 128 || !item.nativeProperties.every(field => isRecord(field) && creationKeysV1(field, ['sourceName','value']) && typeof field.sourceName === 'string' && field.sourceName.length > 0 && field.sourceName.length <= 256 && isSupportedRawYamlPropertyValue(field.value)))) return invalid();
 const { title, template: _template, nativeProperties: _native, ...rest } = item;
 const legacy = { ...value, capability: 'tasks.create.preview', spec: { operation: 'create', items: [{ ...rest, description: title, target: legacyTarget }] } };
 if (!decodeMutationPreviewRequestV1(legacy).ok) return invalid();
 return { ok: true, value: structuredClone(value) as unknown as RoutedTaskCreationPreviewRequestV1 };
 } catch { return invalid(); }
}
/** Structural admission only; a valid seal still needs Runtime authorization and live checks. */
export function decodeRoutedTaskCreationPlanV1(value: unknown): DecodeResultV1<RoutedTaskCreationPlanV1> {
 try {
  if (!isRecord(value) || value.extension !== 'task-creation-v1' || value.capability !== 'tasks.create.routed.preview' || value.mutationKind !== 'task.create' || typeof value.policyRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.policyRevision)) return invalid();
  const request = decodeRoutedTaskCreationPreviewV1({ contractVersion: 1, requestId: 'plan-validation', kind: 'mutation-preview', capability: value.capability, mutationKind: value.mutationKind, clientInstanceId: value.clientInstanceId, idempotencyKey: 'creation-plan-validation', authorization: { basis: 'user-explicit-request' }, spec: value.spec });
  if (!request.ok) return invalid();
  const { planHash: _hash, ...body } = value;
  if (sha256HexV1(canonicalJsonV1(toJsonValueV1(body))) !== value.planHash) return invalid();
  const plan = value as unknown as RoutedTaskCreationPlanV1;
  if ('creation' in plan && !validCreationEvidence(plan)) return invalid();
  if (!decodeMutationPreviewResultV1({ contractVersion: 1, requestId: 'plan-validation', kind: 'mutation-preview-result', ok: true, warnings: [], plan: structuralPlan(plan) }).ok) return invalid();
  return { ok: true, value: structuredClone(plan) };
 } catch { return invalid(); }
}
/** Reuse frozen V1 validation without changing or admitting an old executable plan. */
function structuralPlan(plan: RoutedTaskCreationPlanV1): SealedMutationPlanV1 {
 const { extension: _extension, policyRevision: _revision, creation: _creation, spec, ...base } = plan;
 const { title, template: _template, nativeProperties: _native, ...item } = spec.item;
 let target:CreateTaskTargetV1;
 if(item.target.mode==='periodic-note') target={mode:'configured-default',representation:'inline'};
 else if(item.target.mode==='configured-default') target={mode:'configured-default',representation:item.target.representation??plan.createEffects?.[0]?.locator.representation??'inline'};
 else target=item.target;
 if(target.representation==='file' && plan.creation?.templateId) target={...target,templateId:plan.creation.templateId};
 const periodicParent=plan.creation?.periodicRoute?.container.operonId;
 const shadow: SealedMutationPlanV1 = { ...base, capability: 'tasks.create.preview', spec: { operation: 'create', items: [{ ...item, ...(periodicParent?{parent:{kind:'existing' as const,operonId:periodicParent}}:{}), description: title, target }] } };
 shadow.planHash = computeSealedMutationPlanHashV1(shadow);
 return shadow;
}
export function decodeRoutedTaskCreationApplyV1(value: unknown): DecodeResultV1<RoutedTaskCreationApplyRequestV1> {
 try {
  if (!isRecord(value) || utf8ByteLengthV1(JSON.stringify(value)) > CONTRACT_LIMITS_V1.transportInputBytes) return invalid();
  const decoded = decodeRoutedTaskCreationPlanV1(value.plan);
  if (!decoded.ok || !Array.isArray(value.acknowledgements)) return invalid();
  const plan = structuralPlan(decoded.value);
  const acknowledgements = value.acknowledgements.map((ack: unknown) => {
   if (!isRecord(ack) || ack.planHash !== decoded.value.planHash) throw new Error('Invalid acknowledgement binding');
   return { ...ack, planHash: plan.planHash };
  });
  if (!decodeMutationApplyRequestV1({ ...value, plan, acknowledgements }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as RoutedTaskCreationApplyRequestV1 };
 } catch { return invalid(); }
}

export function decodeRoutedTaskCreationPreviewResultV1(value: unknown): DecodeResultV1<RoutedTaskCreationPreviewResultV1> {
 try {
  if (!isRecord(value)) return invalid();
  if (value.ok === false) {
   const result = decodeMutationPreviewResultV1(value);
   return result.ok ? { ok: true, value: result.value as RoutedTaskCreationPreviewResultV1 } : invalid();
  }
  const plan = decodeRoutedTaskCreationPlanV1(value.plan);
  if (!plan.ok || !decodeMutationPreviewResultV1({ ...value, plan: structuralPlan(plan.value) }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as RoutedTaskCreationPreviewResultV1 };
 } catch { return invalid(); }
}
export function decodeRoutedTaskCreationMutationResultV1(value: unknown): DecodeResultV1<RoutedTaskCreationMutationResultV1> {
 try {
  if (!isRecord(value)) return invalid();
  let continuation = value.continuation;
  if (continuation !== undefined) {
   if (!isRecord(continuation)) return invalid();
   const plan = decodeRoutedTaskCreationPlanV1(continuation.plan);
   if (!plan.ok || continuation.originPlanHash === plan.value.planHash) return invalid();
   continuation = { ...continuation, plan: structuralPlan(plan.value) };
  }
  if (isRecord(value.receipt) && value.receipt.mutationKind !== 'task.create') return invalid();
  const {recoveryOutcome,...base}=value;
  if(recoveryOutcome!==undefined && (recoveryOutcome!=='compensated' || value.status!=='failed' || value.mutationMayHaveApplied!==false)) return invalid();
  if (!decodeMutationResultV1({ ...base, ...(continuation === undefined ? {} : { continuation }) }).ok) return invalid();
  return { ok: true, value: structuredClone(value) as unknown as RoutedTaskCreationMutationResultV1 };
 } catch { return invalid(); }
}

function validCreationEvidence(plan: RoutedTaskCreationPlanV1): boolean {
 const evidence = plan.creation;
 if (!evidence || !creationKeysV1(evidence as unknown as Record<string,unknown>, ['version','executionSpec','periodicRoute','templateId','templateDigest','materialRevision','graphDigest','resolvedFields','resolvedTags','nativeProperties','allocations','fileAllocations','definitions','skipped','retention']) || evidence.version !== 1 || evidence.retention !== 'preserve-definitions-on-failure') return false;
 for (const digest of [evidence.templateDigest,evidence.materialRevision,evidence.graphDigest]) if (!/^[a-f0-9]{64}$/u.test(digest)) return false;
 if (evidence.templateId !== null && (typeof evidence.templateId !== 'string' || evidence.templateId.length > 4096)) return false;
 if (!Array.isArray(evidence.allocations) || evidence.allocations.length > 128 || evidence.allocations.some(id=>typeof id!=='string' || !/^[a-z0-9]{7}$/u.test(id)) || new Set(evidence.allocations).size !== evidence.allocations.length) return false;
 if (!Array.isArray(evidence.fileAllocations) || evidence.fileAllocations.length > 128 || !Array.isArray(evidence.definitions) || evidence.definitions.length > 128 || !Array.isArray(evidence.skipped) || evidence.skipped.length > 512) return false;
 if(!evidence.definitions.every(entry=>isRecord(entry)&&creationKeysV1(entry,['sourceName','type','encoding']))) return false;
 validateInlinePropertyDefinitions({version:1,entries:evidence.definitions});
 if (!evidence.skipped.every(item=>isRecord(item) && creationKeysV1(item,['sourceName','reason']) && typeof item.sourceName==='string' && item.sourceName.length<=4096 && typeof item.reason==='string' && item.reason.length<=4096)) return false;
 if(!isRecord(evidence.resolvedFields) || Object.keys(evidence.resolvedFields).length>256 || !Object.entries(evidence.resolvedFields).every(([key,value])=>key.length<=256 && typeof value==='string') || !Array.isArray(evidence.resolvedTags) || evidence.resolvedTags.length>256 || evidence.resolvedTags.some(tag=>typeof tag!=='string')) return false;
 if(!Array.isArray(evidence.nativeProperties) || evidence.nativeProperties.length>128 || !evidence.nativeProperties.every(field=>isRecord(field)&&creationKeysV1(field,['sourceName','value'])&&typeof field.sourceName==='string'&&field.sourceName.length<=256&&isSupportedRawYamlPropertyValue(field.value))) return false;
 const capability = evidence.periodicRoute ? 'tasks.create.periodic-note.preview' : 'tasks.create.identity-placeholders';
 const validationRequest={contractVersion:1,kind:'mutation-preview',requestId:'creation-validation',clientInstanceId:plan.clientInstanceId,idempotencyKey:'creation-validation',capability,mutationKind:'task.create',authorization:{basis:'user-explicit-request'},spec:evidence.executionSpec};
 const inline=!evidence.periodicRoute && evidence.executionSpec.items[0]?.target.representation==='inline';
 if(inline) {
  if(evidence.executionSpec.items.length!==1 || evidence.fileAllocations.length || !decodeMutationPreviewRequestV1({...validationRequest,capability:'tasks.create.preview'}).ok) return false;
  return true;
 }
 if (!decodeTaskWorkflowPreviewRequestExtensionV1(validationRequest).ok) return false;
 const {extension:_extension,policyRevision:_policy,creation:_creation,...base}=plan;
 const shadow={...base,capability,spec:evidence.executionSpec,...(evidence.periodicRoute ? {periodicRoute:evidence.periodicRoute} : {createEffects:plan.createEffects?.map(effect=>({...effect,templateIdentityAllocations:evidence.fileAllocations}))})};
 const {planHash:_hash,...body}=shadow;
 shadow.planHash=sha256HexV1(canonicalJsonV1(toJsonValueV1(body)));
 return decodeTaskWorkflowPreviewResultExtensionV1({contractVersion:1,requestId:'creation-validation',kind:'mutation-preview-result',ok:true,warnings:plan.warnings,plan:shadow}).ok;
}
