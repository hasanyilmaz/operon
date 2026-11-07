import type { createRoutedCreationMutationGatewayV1 } from './mutation-gateway';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import { structuredErrorV1, type StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { RuntimeInvocationContextV1 } from '../../runtime/types';
import type { TaskCreationPolicyRequestV1, TaskCreationPolicyResultV1, TaskCreationPolicyV1 } from './contracts';
import { decodeTaskCreationPolicyRequestV1, decodeTaskCreationPolicyResultV1 } from './decode';
export interface TaskCreationRuntimeV1 {
 mutations?: ReturnType<typeof createRoutedCreationMutationGatewayV1>;
 readPolicy(value: unknown, context?: RuntimeInvocationContextV1): Promise<TaskCreationPolicyResultV1>;
}
export interface TaskCreationReadPortsV1 {
 ready(): boolean;
 admit(request: TaskCreationPolicyRequestV1, context?: RuntimeInvocationContextV1): Promise<{ ok: boolean; error?: StructuredErrorV1 }>;
 readSource(): Promise<TaskCreationPolicyV1>;
}
export function creationPolicyFailureV1(requestId: string, code: Parameters<typeof structuredErrorV1>[0], reason: string): TaskCreationPolicyResultV1 {
 return { contractVersion: 1, requestId, kind: 'task-creation-policy-result', ok: false, error: structuredErrorV1(code, reason) };
}
/** No write port: policy reads cannot create notes, process templates or remember selections. */
export function createTaskCreationRuntimeV1(ports: TaskCreationReadPortsV1, mutations?: ReturnType<typeof createRoutedCreationMutationGatewayV1>): TaskCreationRuntimeV1 {
 return Object.freeze({ ...(mutations ? {mutations} : {}), async readPolicy(value: unknown, context?: RuntimeInvocationContextV1): Promise<TaskCreationPolicyResultV1> {
  const decoded = decodeTaskCreationPolicyRequestV1(value);
  if (!decoded.ok) return creationPolicyFailureV1('invalid-request', 'invalid-request', 'Invalid creation policy request.');
  const request = decoded.value;
  if (!ports.ready()) return creationPolicyFailureV1(request.requestId, 'live-settling', 'Creation policy is not ready.');
  try {
   const admission = await ports.admit(request, context);
   if (!admission.ok) return { contractVersion: 1, requestId: request.requestId, kind: 'task-creation-policy-result', ok: false, error: admission.error ?? structuredErrorV1('live-settling', 'Creation policy is not ready.') };
   const before = await ports.readSource();
   const material = canonicalJsonV1(toJsonValueV1(before));
   const after = await ports.readSource();
   if (!ports.ready() || context?.deadlineAtMs !== undefined && Date.now() > context.deadlineAtMs || material !== canonicalJsonV1(toJsonValueV1(after))) return creationPolicyFailureV1(request.requestId, 'live-settling', 'Creation policy changed during the read; request it again.');
   const output = decodeTaskCreationPolicyResultV1({ contractVersion: 1, requestId: request.requestId, kind: 'task-creation-policy-result', ok: true, policy: before, policyRevision: sha256HexV1(material) });
   return output.ok ? output.value : creationPolicyFailureV1(request.requestId, 'capability-unavailable', 'Creation policy cannot be represented by this extension.');
  } catch { return creationPolicyFailureV1(request.requestId, 'internal-error', 'Creation policy could not be read.'); }
 } });
}
