import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { DeveloperApiConsumerDescriptorV1 } from '../../developer-api/grants';
import {
	DEVELOPER_RECOVERY_RETENTION_MS_V1,
	DeveloperMutationRecoveryStoreErrorV1,
	IndexedDbDeveloperMutationRecoveryStoreV1,
	type DeveloperMutationRecoveryRecordV1,
	type DeveloperMutationRecoveryStoreV1,
} from '../../developer-api/recovery-store';
import type {
	DeveloperCapabilityGrantV1,
	DeveloperPlanSecurityBindingV1,
	DeveloperSecuritySessionV1,
} from '../../developer-api/security';
import {
	structuredErrorV1,
	type ContractWarningV1,
	type StructuredErrorV1,
} from '../../contracts/v1/primitives';
import type {
	AtomicGroupResultV1,
	MutationAcknowledgementV1,
	MutationAuthorizationV1,
} from '../../contracts/v1/mutation';
import {
	type AdoptTaskPreviewIntentV1,
	type AdoptTaskSealedPlanV1,
	type PeriodicNoteCreateSealedPlanV1,
	type PeriodicNoteCreateSpecV1,
	type PeriodicNoteUpdateSealedPlanV1,
	type PeriodicNoteUpdateSpecV1,
	type TaskFilterQueryRequestV1,
	type TaskFilterQueryResultV1,
	type TaskWorkflowMutationResultV1,
	type TaskWorkflowPreviewResultV1,
	type TaskWorkflowSealedPlanV1,
} from './contracts';
import {
	decodeAdoptPreviewIntentExtensionV1,
	decodePeriodicNoteCreateSpecExtensionV1,
	decodePeriodicNoteUpdateSpecExtensionV1,
} from './decode';
import type {
	OperonTaskWorkflowDeveloperCapabilityApiV1,
	TaskWorkflowDeveloperAccessCapabilityV1,
	TaskWorkflowDeveloperCapabilitySubsetV1,
	TaskWorkflowDeveloperApiRuntimeOptionsV1,
	TaskWorkflowDeveloperMutationExecutionResultV1,
	TaskWorkflowDeveloperMutationPlanHandleV1,
	TaskWorkflowDeveloperMutationPreviewResultV1,
	TaskWorkflowDeveloperMutationRecoverInputV1,
	TaskWorkflowDeveloperPendingRecoveriesResultV1,
} from './developer-api';

type StateV1 = 'idle' | 'applying' | 'recovery-required' | 'terminal';

interface BoundPlanV1 {
	readonly recoveryRef: string;
	readonly sealed: AdoptTaskSealedPlanV1 | PeriodicNoteCreateSealedPlanV1 | PeriodicNoteUpdateSealedPlanV1;
	readonly binding: DeveloperPlanSecurityBindingV1;
	readonly idempotencyKey: string;
	readonly dispatch: { readonly binding: DeveloperPlanSecurityBindingV1; dispatchStarted: boolean };
	state: StateV1;
	authorization?: MutationAuthorizationV1;
	acknowledgements?: readonly MutationAcknowledgementV1[];
	terminalResult?: TaskWorkflowMutationResultV1;
}

/**
 * Shared Developer API mutation-session pattern for the additive task workflow
 * family. It owns only host bindings, durable recovery, and sealed Runtime
 * delegation; callers never receive an extension sealed plan.
 */
export function createTaskWorkflowDeveloperMutationSessionV1<
	TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
>(
	core: OperonAgentRuntimeCoreV1,
	consumer: DeveloperApiConsumerDescriptorV1,
	requestedCapabilities: TCapabilities,
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
): OperonTaskWorkflowDeveloperCapabilityApiV1<TCapabilities> {
	const requested = new Set(requestedCapabilities);
	const sessionId = options.createSessionId?.() ?? randomSessionId();
	const securitySession: DeveloperSecuritySessionV1 = Object.freeze({
		consumerId: consumer.id,
		instanceEpoch: consumer.instanceEpoch,
		sessionId,
	});
	const recoveryStore = options.recoveryStore ?? new IndexedDbDeveloperMutationRecoveryStoreV1({
		now: () => (options.now?.() ?? new Date()).getTime(),
	});
	const boundPlans = new WeakMap<TaskWorkflowDeveloperMutationPlanHandleV1, BoundPlanV1>();
	let sequence = 0;
	const nextRequestId = (): string => `${sessionId}-${(++sequence).toString(36)}`;
	const activeGrant = (): DeveloperCapabilityGrantV1 => {
		const result = options.grantController.evaluate(consumer, requestedCapabilities);
		return {
			consumerId: consumer.id,
			state: result.state,
			revision: result.revision,
			capabilities: new Set(result.effectiveCapabilities.filter(isAccessCapability)),
		};
	};
	const canUse = (capability: TaskWorkflowDeveloperAccessCapabilityV1): boolean => {
		if (!requested.has(capability) || !options.isCoreActive(core) || !options.grantController.isConsumerCurrent(consumer) || options.lifecyclePhase() !== 'ready') return false;
		const grant = options.grantController.evaluate(consumer, requestedCapabilities);
		return grant.state === 'active'
			&& grant.effectiveCapabilities.includes(capability)
			&& core.hasCapability(capability);
	};
	const denied = (capability: TaskWorkflowDeveloperAccessCapabilityV1): StructuredErrorV1 => {
		if (!requested.has(capability)) return structuredErrorV1('authority-insufficient', 'This capability was not granted to the current task-workflow Developer API session.', { details: { capability } });
		if (!options.isCoreActive(core) || !options.grantController.isConsumerCurrent(consumer)) return structuredErrorV1('authority-insufficient', 'The task-workflow Developer API session is no longer current.');
		const grant = options.grantController.evaluate(consumer, requestedCapabilities);
		if (grant.state !== 'active' || !grant.effectiveCapabilities.includes(capability)) return structuredErrorV1('authority-insufficient', 'The task-workflow capability grant is no longer active.', { details: { capability } });
		return structuredErrorV1('capability-unavailable', 'The requested task-workflow capability is not currently available.', { details: { capability } });
	};

	const tasks: Record<string, unknown> = {};
	if (requested.has('tasks.filter-query')) {
		tasks.filterQuery = async (input: TaskFilterQueryRequestV1): Promise<TaskFilterQueryResultV1> => {
			if (!canUse('tasks.filter-query') || !core.tasks.filterQuery) return freezeDto(filterFailure(input, denied('tasks.filter-query')));
			const snapshot = cloneSafe<TaskFilterQueryRequestV1>(input);
			if (!snapshot) return freezeDto(filterFailure(input, structuredErrorV1('invalid-request', 'The saved-filter request is not structured-cloneable.')));
			return freezeDto(await core.tasks.filterQuery(snapshot));
		};
	}
	if (requested.has('tasks.adopt.preview') || requested.has('tasks.adopt.apply')) {
		const adopt: Record<string, unknown> = {};
		if (requested.has('tasks.adopt.preview')) {
			adopt.preview = async (input: AdoptTaskPreviewIntentV1): Promise<TaskWorkflowDeveloperMutationPreviewResultV1> => {
				const requestId = nextRequestId();
				if (!canUse('tasks.adopt.preview') || !core.mutations.previewTaskWorkflow) return previewFailure(requestId, denied('tasks.adopt.preview'));
				const snapshot = cloneSafe<AdoptTaskPreviewIntentV1>(input);
				if (!snapshot || !decodeAdoptPreviewIntentExtensionV1(snapshot).ok) return previewFailure(requestId, structuredErrorV1('invalid-request', 'The task-adoption preview intent is invalid.'));
				const policy = options.mutationSecurityPolicy;
				if (!policy) return previewFailure(requestId, mutationAuthorityError());
				const admission = policy.admitPreview({ session: securitySession, grant: activeGrant(), capability: 'tasks.adopt.preview' });
				if (!admission.ok) return previewFailure(requestId, policyError(admission));
				const idempotencyKey = hostMutationKey(sessionId, requestId);
				let result: TaskWorkflowPreviewResultV1;
				try {
					result = await core.mutations.previewTaskWorkflow({
						contractVersion: 1,
						requestId,
						kind: 'mutation-preview',
						clientInstanceId: `developer-api:${consumer.id}:${consumer.instanceEpoch}`,
						idempotencyKey,
						correlationId: requestId,
						capability: 'tasks.adopt.preview',
						mutationKind: 'task.adopt',
						spec: snapshot,
						authorization: admission.authorization,
					});
				} catch {
					return previewFailure(requestId, structuredErrorV1('internal-error', 'The task-workflow preview handler failed unexpectedly.'));
				}
				if (!result.ok) return previewFailure(requestId, result.error, result.warnings);
				if (result.plan.mutationKind !== 'task.adopt') return previewFailure(requestId, structuredErrorV1('internal-error', 'The task-workflow preview produced an invalid adoption plan.'), result.warnings);
				const binding = policy.bindPlan({ session: securitySession, grant: activeGrant(), plan: result.plan });
				if (!binding.ok) return previewFailure(requestId, policyError(binding), result.warnings);
				const handle = createHandle(result.plan, recoveryRef());
				boundPlans.set(handle, {
					recoveryRef: handle.recoveryRef,
					sealed: result.plan,
					binding: binding.binding,
					idempotencyKey,
					dispatch: { binding: binding.binding, dispatchStarted: false },
					state: 'idle',
				});
				// Do not structured-clone the handle after binding it: WeakMap identity
				// is the unforgeable session proof exposed to the consumer.
				return freezeStructure({ contractVersion: 1, kind: 'task-workflow-developer-mutation-preview-result', requestId, ok: true, plan: handle, warnings: freezeDto(result.warnings) });
			};
		}
		if (requested.has('tasks.adopt.apply')) {
			adopt.apply = async (input: Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1 }>): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!exactInput(input, ['plan'])) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Task adoption apply accepts only one opaque plan handle.'));
				const bound = boundPlans.get(input.plan);
				if (!bound) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The task-adoption plan is not an opaque handle from this Developer API session.'));
				if (bound.state === 'terminal' && bound.terminalResult) return terminalReplay(requestId, bound.terminalResult);
				if (bound.state !== 'idle') return executionFailure(requestId, stateError('apply', bound.state));
				if (!canUse('tasks.adopt.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.adopt.apply'));
				bound.state = 'applying';
				const policy = options.mutationSecurityPolicy;
				if (!policy) { bound.state = 'terminal'; return executionFailure(requestId, mutationAuthorityError()); }
				const admission = await policy.admitApply({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!admission.ok) { bound.state = 'terminal'; return executionFailure(requestId, policyError(admission)); }
				bound.authorization = admission.authorization;
				bound.acknowledgements = admission.acknowledgements;
				try { await recoveryStore.putPrepared(recoveryRecord(consumer.id, bound, options.now?.() ?? new Date())); }
				catch (error) { bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				const dispatch = policy.claimApplyDispatch({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!dispatch.ok) {
					bound.state = 'terminal';
					try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); } catch { /* prepared entries are not recoverable */ }
					return executionFailure(requestId, policyError(dispatch));
				}
				try { await recoveryStore.markDispatched(consumer.id, bound.recoveryRef); }
				catch (error) { policy.releaseApplyDispatchClaim({ session: securitySession, plan: bound.sealed }); bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				bound.dispatch.dispatchStarted = true;
				const result = await apply(core, requestId, bound);
				bound.state = stateAfter(result);
				if (bound.state === 'terminal') {
					if (successful(result)) { bound.terminalResult = result; await markTerminal(recoveryStore, consumer.id, bound.recoveryRef); }
					else {
						try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); }
						catch { bound.state = 'recovery-required'; return project(requestId, input.plan, dispatchedFailure(requestId)); }
					}
				}
				return project(requestId, input.plan, result);
			};
			adopt.recover = async (input: TaskWorkflowDeveloperMutationRecoverInputV1): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!validRecoveryInput(input)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Task-adoption recovery requires exactly one opaque plan or recovery reference.'));
				if (!canUse('tasks.adopt.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.adopt.apply'));
				let handle: TaskWorkflowDeveloperMutationPlanHandleV1;
				let bound: BoundPlanV1 | undefined;
				if ('plan' in input && input.plan) { handle = input.plan; bound = boundPlans.get(handle); }
				else {
					let record: DeveloperMutationRecoveryRecordV1 | undefined;
					try { record = await recoveryStore.get(consumer.id, input.recoveryRef); }
					catch (error) { return executionFailure(requestId, recoveryError(error)); }
					if (!record || !isAdoptPlan(record.sealed)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The recovery reference is not pending for this task-workflow Developer API consumer.'));
					handle = createHandle(record.sealed, record.recoveryRef);
					bound = { recoveryRef: record.recoveryRef, sealed: record.sealed, binding: record.binding, idempotencyKey: record.idempotencyKey, dispatch: { binding: record.binding, dispatchStarted: true }, state: 'recovery-required', authorization: record.authorization, acknowledgements: record.acknowledgements };
					boundPlans.set(handle, bound);
				}
				if (!bound || !bound.authorization || !bound.acknowledgements) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Recovery requires the same opaque plan after apply dispatch.'));
				if (bound.state !== 'recovery-required') return executionFailure(requestId, stateError('recover', bound.state));
				const policy = options.mutationSecurityPolicy;
				if (!policy) return executionFailure(requestId, mutationAuthorityError());
				const admission = policy.admitRecovery({ session: securitySession, plan: bound.sealed, dispatch: bound.dispatch });
				if (!admission.ok) return executionFailure(requestId, policyError(admission));
				bound.state = 'applying';
				const result = await recover(options, requestId, bound);
				bound.state = stateAfter(result);
				if (bound.state === 'terminal') {
					if (successful(result)) await markTerminal(recoveryStore, consumer.id, bound.recoveryRef);
					else {
						try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); }
						catch { bound.state = 'recovery-required'; return project(requestId, handle, dispatchedFailure(requestId)); }
					}
				}
				return project(requestId, handle, result);
			};
			adopt.pendingRecoveries = async (): Promise<TaskWorkflowDeveloperPendingRecoveriesResultV1> => {
				if (!canUse('tasks.adopt.apply')) return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: denied('tasks.adopt.apply') });
				try {
					const records = await recoveryStore.list(consumer.id);
					return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: true, recoveries: records.filter(record => isAdoptPlan(record.sealed)).map(record => ({ recoveryRef: record.recoveryRef, planDigest: record.planDigest, createdAt: record.createdAt, expiresAt: record.expiresAt })) });
				} catch (error) { return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: recoveryError(error) }); }
			};
		}
		tasks.adopt = Object.freeze(adopt);
	}
	if (requested.has('tasks.create.periodic-note.preview') || requested.has('tasks.create.periodic-note.apply')) {
		const periodic: Record<string, unknown> = {};
		if (requested.has('tasks.create.periodic-note.preview')) {
			periodic.preview = async (input: PeriodicNoteCreateSpecV1): Promise<TaskWorkflowDeveloperMutationPreviewResultV1> => {
				const requestId = nextRequestId();
				if (!canUse('tasks.create.periodic-note.preview') || !core.mutations.previewTaskWorkflow) return previewFailure(requestId, denied('tasks.create.periodic-note.preview'));
				const snapshot = cloneSafe<PeriodicNoteCreateSpecV1>(input);
				if (!snapshot || !decodePeriodicNoteCreateSpecExtensionV1(snapshot).ok) return previewFailure(requestId, structuredErrorV1('invalid-request', 'The periodic-note create spec is invalid.'));
				const policy = options.mutationSecurityPolicy;
				if (!policy) return previewFailure(requestId, mutationAuthorityError());
				const admission = policy.admitPreview({ session: securitySession, grant: activeGrant(), capability: 'tasks.create.periodic-note.preview' });
				if (!admission.ok) return previewFailure(requestId, policyError(admission));
				const idempotencyKey = hostMutationKey(sessionId, requestId);
				let result: TaskWorkflowPreviewResultV1;
				try {
					result = await core.mutations.previewTaskWorkflow({
						contractVersion: 1, requestId, kind: 'mutation-preview',
						clientInstanceId: `developer-api:${consumer.id}:${consumer.instanceEpoch}`,
						idempotencyKey, correlationId: requestId,
						capability: 'tasks.create.periodic-note.preview', mutationKind: 'task.create',
						spec: snapshot, authorization: admission.authorization,
					});
				} catch {
					return previewFailure(requestId, structuredErrorV1('internal-error', 'The periodic-note preview handler failed unexpectedly.'));
				}
				if (!result.ok) return previewFailure(requestId, result.error, result.warnings);
				if (result.plan.capability !== 'tasks.create.periodic-note.preview') return previewFailure(requestId, structuredErrorV1('internal-error', 'The Runtime produced an invalid periodic-note plan.'), result.warnings);
				const binding = policy.bindPlan({ session: securitySession, grant: activeGrant(), plan: result.plan });
				if (!binding.ok) return previewFailure(requestId, policyError(binding), result.warnings);
				const handle = createHandle(result.plan, recoveryRef());
				boundPlans.set(handle, { recoveryRef: handle.recoveryRef, sealed: result.plan, binding: binding.binding, idempotencyKey, dispatch: { binding: binding.binding, dispatchStarted: false }, state: 'idle' });
				return freezeStructure({ contractVersion: 1, kind: 'task-workflow-developer-mutation-preview-result', requestId, ok: true, plan: handle, warnings: freezeDto(result.warnings) });
			};
		}
		if (requested.has('tasks.create.periodic-note.apply')) {
			periodic.apply = async (input: Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1 }>): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!exactInput(input, ['plan'])) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Periodic-note apply accepts only one opaque plan handle.'));
				const bound = boundPlans.get(input.plan);
				if (!bound || !isPeriodicPlan(bound.sealed)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The periodic-note plan is not an opaque handle from this Developer API session.'));
				if (bound.state === 'terminal' && bound.terminalResult) return terminalReplay(requestId, bound.terminalResult);
				if (bound.state !== 'idle') return executionFailure(requestId, stateError('apply', bound.state));
				if (!canUse('tasks.create.periodic-note.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.create.periodic-note.apply'));
				bound.state = 'applying';
				const policy = options.mutationSecurityPolicy;
				if (!policy) { bound.state = 'terminal'; return executionFailure(requestId, mutationAuthorityError()); }
				const admission = await policy.admitApply({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!admission.ok) { bound.state = 'terminal'; return executionFailure(requestId, policyError(admission)); }
				bound.authorization = admission.authorization;
				bound.acknowledgements = admission.acknowledgements;
				try { await recoveryStore.putPrepared(recoveryRecord(consumer.id, bound, options.now?.() ?? new Date())); }
				catch (error) { bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				const dispatch = policy.claimApplyDispatch({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!dispatch.ok) {
					bound.state = 'terminal';
					try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); } catch { /* prepared entries are not recoverable */ }
					return executionFailure(requestId, policyError(dispatch));
				}
				try { await recoveryStore.markDispatched(consumer.id, bound.recoveryRef); }
				catch (error) { policy.releaseApplyDispatchClaim({ session: securitySession, plan: bound.sealed }); bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				bound.dispatch.dispatchStarted = true;
				const result = await apply(core, requestId, bound);
				bound.state = stateAfter(result);
				if (bound.state === 'terminal') {
					if (successful(result)) { bound.terminalResult = result; await markTerminal(recoveryStore, consumer.id, bound.recoveryRef); }
					else {
						try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); }
						catch { bound.state = 'recovery-required'; return project(requestId, input.plan, dispatchedFailure(requestId)); }
					}
				}
				return project(requestId, input.plan, result);
			};
			periodic.recover = async (input: TaskWorkflowDeveloperMutationRecoverInputV1): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!validRecoveryInput(input)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Periodic-note recovery requires exactly one opaque plan or recovery reference.'));
				if (!canUse('tasks.create.periodic-note.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.create.periodic-note.apply'));
				let handle: TaskWorkflowDeveloperMutationPlanHandleV1;
				let bound: BoundPlanV1 | undefined;
				if ('plan' in input && input.plan) { handle = input.plan; bound = boundPlans.get(handle); }
				else {
					let record: DeveloperMutationRecoveryRecordV1 | undefined;
					try { record = await recoveryStore.get(consumer.id, input.recoveryRef); }
					catch (error) { return executionFailure(requestId, recoveryError(error)); }
					if (!record || !isPeriodicPlan(record.sealed)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The recovery reference is not pending for periodic-note creation.'));
					handle = createHandle(record.sealed, record.recoveryRef);
					bound = { recoveryRef: record.recoveryRef, sealed: record.sealed, binding: record.binding, idempotencyKey: record.idempotencyKey, dispatch: { binding: record.binding, dispatchStarted: true }, state: 'recovery-required', authorization: record.authorization, acknowledgements: record.acknowledgements };
					boundPlans.set(handle, bound);
				}
				if (!bound || !isPeriodicPlan(bound.sealed) || !bound.authorization || !bound.acknowledgements) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Recovery requires the same opaque periodic-note plan after apply dispatch.'));
				if (bound.state !== 'recovery-required') return executionFailure(requestId, stateError('recover', bound.state));
				const policy = options.mutationSecurityPolicy;
				if (!policy) return executionFailure(requestId, mutationAuthorityError());
				const admission = policy.admitRecovery({ session: securitySession, plan: bound.sealed, dispatch: bound.dispatch });
				if (!admission.ok) return executionFailure(requestId, policyError(admission));
				bound.state = 'applying';
				const result = await recover(options, requestId, bound);
				bound.state = stateAfter(result);
				if (bound.state === 'terminal') {
					if (successful(result)) await markTerminal(recoveryStore, consumer.id, bound.recoveryRef);
					else {
						try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); }
						catch { bound.state = 'recovery-required'; return project(requestId, handle, dispatchedFailure(requestId)); }
					}
				}
				return project(requestId, handle, result);
			};
			periodic.pendingRecoveries = async (): Promise<TaskWorkflowDeveloperPendingRecoveriesResultV1> => {
				if (!canUse('tasks.create.periodic-note.apply')) return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: denied('tasks.create.periodic-note.apply') });
				try {
					const records = await recoveryStore.list(consumer.id);
					return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: true, recoveries: records.filter(record => isPeriodicPlan(record.sealed)).map(record => ({ recoveryRef: record.recoveryRef, planDigest: record.planDigest, createdAt: record.createdAt, expiresAt: record.expiresAt })) });
				} catch (error) { return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: recoveryError(error) }); }
			};
		}
		tasks.createPeriodicNote = Object.freeze(periodic);
	}
	if (requested.has('tasks.update.periodic-note.preview') || requested.has('tasks.update.periodic-note.apply')) {
		const periodicUpdate: Record<string, unknown> = {};
		if (requested.has('tasks.update.periodic-note.preview')) {
			periodicUpdate.preview = async (input: PeriodicNoteUpdateSpecV1): Promise<TaskWorkflowDeveloperMutationPreviewResultV1> => {
				const requestId = nextRequestId();
				if (!canUse('tasks.update.periodic-note.preview') || !core.mutations.previewTaskWorkflow) return previewFailure(requestId, denied('tasks.update.periodic-note.preview'));
				const snapshot = cloneSafe<PeriodicNoteUpdateSpecV1>(input);
				if (!snapshot || !decodePeriodicNoteUpdateSpecExtensionV1(snapshot).ok) return previewFailure(requestId, structuredErrorV1('invalid-request', 'The periodic-note update spec is invalid.'));
				const policy = options.mutationSecurityPolicy;
				if (!policy) return previewFailure(requestId, mutationAuthorityError());
				const admission = policy.admitPreview({ session: securitySession, grant: activeGrant(), capability: 'tasks.update.periodic-note.preview' });
				if (!admission.ok) return previewFailure(requestId, policyError(admission));
				const idempotencyKey = hostMutationKey(sessionId, requestId);
				let result: TaskWorkflowPreviewResultV1;
				try {
					result = await core.mutations.previewTaskWorkflow({ contractVersion: 1, requestId, kind: 'mutation-preview', clientInstanceId: `developer-api:${consumer.id}:${consumer.instanceEpoch}`, idempotencyKey, correlationId: requestId, capability: 'tasks.update.periodic-note.preview', mutationKind: 'task.update', spec: snapshot, authorization: admission.authorization });
				} catch { return previewFailure(requestId, structuredErrorV1('internal-error', 'The periodic-note update preview handler failed unexpectedly.')); }
				if (!result.ok) return previewFailure(requestId, result.error, result.warnings);
				if (!isPeriodicUpdatePlan(result.plan)) return previewFailure(requestId, structuredErrorV1('internal-error', 'The Runtime produced an invalid periodic-note update plan.'), result.warnings);
				const binding = policy.bindPlan({ session: securitySession, grant: activeGrant(), plan: result.plan });
				if (!binding.ok) return previewFailure(requestId, policyError(binding), result.warnings);
				const handle = createHandle(result.plan, recoveryRef());
				boundPlans.set(handle, { recoveryRef: handle.recoveryRef, sealed: result.plan, binding: binding.binding, idempotencyKey, dispatch: { binding: binding.binding, dispatchStarted: false }, state: 'idle' });
				return freezeStructure({ contractVersion: 1, kind: 'task-workflow-developer-mutation-preview-result', requestId, ok: true, plan: handle, warnings: freezeDto(result.warnings) });
			};
		}
		if (requested.has('tasks.update.periodic-note.apply')) {
			periodicUpdate.apply = async (input: Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1 }>): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!exactInput(input, ['plan'])) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Periodic-note update apply accepts only one opaque plan handle.'));
				const bound = boundPlans.get(input.plan);
				if (!bound || !isPeriodicUpdatePlan(bound.sealed)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The periodic-note update plan is not an opaque handle from this Developer API session.'));
				if (bound.state === 'terminal' && bound.terminalResult) return terminalReplay(requestId, bound.terminalResult);
				if (bound.state !== 'idle') return executionFailure(requestId, stateError('apply', bound.state));
				if (!canUse('tasks.update.periodic-note.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.update.periodic-note.apply'));
				bound.state = 'applying';
				const policy = options.mutationSecurityPolicy;
				if (!policy) { bound.state = 'terminal'; return executionFailure(requestId, mutationAuthorityError()); }
				const admission = await policy.admitApply({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!admission.ok) { bound.state = 'terminal'; return executionFailure(requestId, policyError(admission)); }
				bound.authorization = admission.authorization; bound.acknowledgements = admission.acknowledgements;
				try { await recoveryStore.putPrepared(recoveryRecord(consumer.id, bound, options.now?.() ?? new Date())); } catch (error) { bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				const dispatch = policy.claimApplyDispatch({ session: securitySession, grant: activeGrant(), binding: bound.binding, plan: bound.sealed });
				if (!dispatch.ok) { bound.state = 'terminal'; try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); } catch { /* prepared entries are not recoverable */ } return executionFailure(requestId, policyError(dispatch)); }
				try { await recoveryStore.markDispatched(consumer.id, bound.recoveryRef); } catch (error) { policy.releaseApplyDispatchClaim({ session: securitySession, plan: bound.sealed }); bound.state = 'idle'; return executionFailure(requestId, recoveryError(error)); }
				bound.dispatch.dispatchStarted = true;
				const result = await apply(core, requestId, bound); bound.state = stateAfter(result);
				if (bound.state === 'terminal') { if (successful(result)) { bound.terminalResult = result; await markTerminal(recoveryStore, consumer.id, bound.recoveryRef); } else { try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); } catch { bound.state = 'recovery-required'; return project(requestId, input.plan, dispatchedFailure(requestId)); } } }
				return project(requestId, input.plan, result);
			};
			periodicUpdate.recover = async (input: TaskWorkflowDeveloperMutationRecoverInputV1): Promise<TaskWorkflowDeveloperMutationExecutionResultV1> => {
				const requestId = nextRequestId();
				if (!validRecoveryInput(input)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Periodic-note update recovery requires exactly one opaque plan or recovery reference.'));
				if (!canUse('tasks.update.periodic-note.apply') || !core.mutations.applyTaskWorkflow) return executionFailure(requestId, denied('tasks.update.periodic-note.apply'));
				let handle: TaskWorkflowDeveloperMutationPlanHandleV1; let bound: BoundPlanV1 | undefined;
				if ('plan' in input && input.plan) { handle = input.plan; bound = boundPlans.get(handle); } else { let record: DeveloperMutationRecoveryRecordV1 | undefined; try { record = await recoveryStore.get(consumer.id, input.recoveryRef); } catch (error) { return executionFailure(requestId, recoveryError(error)); } if (!record || !isPeriodicUpdatePlan(record.sealed)) return executionFailure(requestId, structuredErrorV1('invalid-request', 'The recovery reference is not pending for periodic-note update.')); handle = createHandle(record.sealed, record.recoveryRef); bound = { recoveryRef: record.recoveryRef, sealed: record.sealed, binding: record.binding, idempotencyKey: record.idempotencyKey, dispatch: { binding: record.binding, dispatchStarted: true }, state: 'recovery-required', authorization: record.authorization, acknowledgements: record.acknowledgements }; boundPlans.set(handle, bound); }
				if (!bound || !isPeriodicUpdatePlan(bound.sealed) || !bound.authorization || !bound.acknowledgements) return executionFailure(requestId, structuredErrorV1('invalid-request', 'Recovery requires the same opaque periodic-note update plan after apply dispatch.'));
				if (bound.state !== 'recovery-required') return executionFailure(requestId, stateError('recover', bound.state));
				const policy = options.mutationSecurityPolicy; if (!policy) return executionFailure(requestId, mutationAuthorityError());
				const admission = policy.admitRecovery({ session: securitySession, plan: bound.sealed, dispatch: bound.dispatch }); if (!admission.ok) return executionFailure(requestId, policyError(admission));
				bound.state = 'applying'; const result = await recover(options, requestId, bound); bound.state = stateAfter(result);
				if (bound.state === 'terminal') { if (successful(result)) await markTerminal(recoveryStore, consumer.id, bound.recoveryRef); else { try { await recoveryStore.markRefused(consumer.id, bound.recoveryRef); } catch { bound.state = 'recovery-required'; return project(requestId, handle, dispatchedFailure(requestId)); } } }
				return project(requestId, handle, result);
			};
			periodicUpdate.pendingRecoveries = async (): Promise<TaskWorkflowDeveloperPendingRecoveriesResultV1> => {
				if (!canUse('tasks.update.periodic-note.apply')) return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: denied('tasks.update.periodic-note.apply') });
				try { const records = await recoveryStore.list(consumer.id); return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: true, recoveries: records.filter(record => isPeriodicUpdatePlan(record.sealed)).map(record => ({ recoveryRef: record.recoveryRef, planDigest: record.planDigest, createdAt: record.createdAt, expiresAt: record.expiresAt })) }); } catch (error) { return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-pending-recoveries-result', ok: false, error: recoveryError(error) }); }
			};
		}
		tasks.updatePeriodicNote = Object.freeze(periodicUpdate);
	}
	return freezeStructure({
		contractVersion: 1,
		runtimeApi: 1,
		tasks,
	}) as OperonTaskWorkflowDeveloperCapabilityApiV1<TCapabilities>;
}

async function apply(core: OperonAgentRuntimeCoreV1, requestId: string, bound: BoundPlanV1): Promise<TaskWorkflowMutationResultV1> {
	if (!bound.authorization || !bound.acknowledgements || !core.mutations.applyTaskWorkflow) return dispatchedFailure(requestId);
	try {
		return await core.mutations.applyTaskWorkflow({ contractVersion: 1, requestId, kind: 'mutation-apply', plan: bound.sealed, authorization: bound.authorization, idempotencyKey: bound.idempotencyKey, acknowledgements: [...bound.acknowledgements] });
	} catch { return dispatchedFailure(requestId); }
}

async function recover(
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
	requestId: string,
	bound: BoundPlanV1,
): Promise<TaskWorkflowMutationResultV1> {
	if (!bound.authorization || !bound.acknowledgements || !options.recoverTaskWorkflowMutation) {
		return dispatchedFailure(requestId);
	}
	try {
		return await options.recoverTaskWorkflowMutation({
			contractVersion: 1,
			requestId,
			kind: 'mutation-apply',
			plan: bound.sealed,
			authorization: bound.authorization,
			idempotencyKey: bound.idempotencyKey,
			acknowledgements: [...bound.acknowledgements],
		});
	} catch {
		return dispatchedFailure(requestId);
	}
}

function createHandle(plan: AdoptTaskSealedPlanV1 | PeriodicNoteCreateSealedPlanV1 | PeriodicNoteUpdateSealedPlanV1, recoveryRef: string): TaskWorkflowDeveloperMutationPlanHandleV1 {
	return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-plan', recoveryRef, planDigest: plan.planHash, createdAt: plan.createdAt, expiresAt: plan.expiresAt, riskLevel: plan.riskLevel, requiresConsent: plan.requiresConfirmation }) as TaskWorkflowDeveloperMutationPlanHandleV1;
}

function recoveryRecord(consumerId: string, bound: BoundPlanV1, now: Date): DeveloperMutationRecoveryRecordV1 {
	if (!bound.authorization || !bound.acknowledgements) throw new DeveloperMutationRecoveryStoreErrorV1('recovery-store-corrupt', 'Host-owned recovery credentials are incomplete.');
	const createdAtMs = now.getTime();
	return { contractVersion: 1, recoveryRef: bound.recoveryRef, consumerId, planDigest: bound.sealed.planHash, sealed: bound.sealed, binding: bound.binding, idempotencyKey: bound.idempotencyKey, authorization: bound.authorization, acknowledgements: [...bound.acknowledgements], state: 'prepared', createdAt: new Date(createdAtMs).toISOString(), expiresAt: new Date(createdAtMs + DEVELOPER_RECOVERY_RETENTION_MS_V1).toISOString() };
}

function isAdoptPlan(value: DeveloperMutationRecoveryRecordV1['sealed']): value is AdoptTaskSealedPlanV1 {
	return value.mutationKind === 'task.adopt' && value.capability === 'tasks.adopt.preview';
}

function isPeriodicPlan(value: DeveloperMutationRecoveryRecordV1['sealed']): value is PeriodicNoteCreateSealedPlanV1 {
	return value.mutationKind === 'task.create' && value.capability === 'tasks.create.periodic-note.preview';
}

function isPeriodicUpdatePlan(value: TaskWorkflowSealedPlanV1 | DeveloperMutationRecoveryRecordV1['sealed']): value is PeriodicNoteUpdateSealedPlanV1 {
	return value.mutationKind === 'task.update' && value.capability === 'tasks.update.periodic-note.preview';
}

function previewFailure(requestId: string, error: StructuredErrorV1, warnings: readonly ContractWarningV1[] = []): TaskWorkflowDeveloperMutationPreviewResultV1 {
	return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-preview-result', requestId, ok: false, warnings: [...warnings], error });
}

function executionFailure(requestId: string, error: StructuredErrorV1, groupResults: readonly AtomicGroupResultV1[] = []): TaskWorkflowDeveloperMutationExecutionResultV1 {
	return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-execution-result', requestId, status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [...groupResults], error });
}

function project(requestId: string, handle: TaskWorkflowDeveloperMutationPlanHandleV1, result: TaskWorkflowMutationResultV1): TaskWorkflowDeveloperMutationExecutionResultV1 {
	if ((result.status === 'applied' || result.status === 'already-applied') && result.receipt && (result.postflight?.status === 'verified' || result.postflight?.status === 'receipt-replay')) {
		return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-execution-result', requestId, status: result.status, mutationMayHaveApplied: true, retryAllowed: false, groupResults: result.groupResults, receipt: { contractVersion: 1, planDigest: result.receipt.planHash, mutationKind: result.receipt.mutationKind, targetDigest: result.receipt.targetDigest, terminalOutcome: result.status, effectiveAt: result.receipt.effectiveAt, completedAt: result.receipt.completedAt, expiresAt: result.receipt.expiresAt }, postflight: result.postflight });
	}
	if (result.status === 'failed' && !result.mutationMayHaveApplied) return executionFailure(requestId, result.error ?? structuredErrorV1('internal-error', 'Task adoption failed without an error.'), result.groupResults);
	return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-execution-result', requestId, status: result.status === 'partial' ? 'partial' : 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, groupResults: result.groupResults, error: structuredErrorV1('outcome-unknown', result.error?.reason ?? 'The task-adoption outcome is uncertain. Recover only with this same opaque plan.', { retryable: false, action: 'recover-same-plan' }), recovery: { required: true, action: 'recover-same-plan', mutationMayHaveApplied: true, recoveryRef: handle.recoveryRef, planDigest: handle.planDigest, plan: handle } });
}

function terminalReplay(requestId: string, result: TaskWorkflowMutationResultV1): TaskWorkflowDeveloperMutationExecutionResultV1 {
	if (!successful(result) || !result.receipt) return executionFailure(requestId, structuredErrorV1('internal-error', 'The terminal task-adoption receipt is unavailable for replay.'));
	return freezeDto({ contractVersion: 1, kind: 'task-workflow-developer-mutation-execution-result', requestId, status: 'already-applied', mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], receipt: { contractVersion: 1, planDigest: result.receipt.planHash, mutationKind: result.receipt.mutationKind, targetDigest: result.receipt.targetDigest, terminalOutcome: 'already-applied', effectiveAt: result.receipt.effectiveAt, completedAt: result.receipt.completedAt, expiresAt: result.receipt.expiresAt }, postflight: { status: 'receipt-replay' } });
}

function successful(result: TaskWorkflowMutationResultV1): boolean {
	return (result.status === 'applied' && !!result.receipt && result.postflight?.status === 'verified') || (result.status === 'already-applied' && !!result.receipt && result.postflight?.status === 'receipt-replay');
}

function stateAfter(result: TaskWorkflowMutationResultV1): StateV1 {
	return successful(result) || (result.status === 'failed' && !result.mutationMayHaveApplied) ? 'terminal' : 'recovery-required';
}

function dispatchedFailure(requestId: string): TaskWorkflowMutationResultV1 {
	return { contractVersion: 1, requestId, kind: 'mutation-result', status: 'outcome-unknown', mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], error: structuredErrorV1('outcome-unknown', 'The task-workflow apply handler failed after dispatch began.', { retryable: false, action: 'recover-same-plan' }) };
}

function filterFailure(request: unknown, error: StructuredErrorV1): TaskFilterQueryResultV1 {
	return { contractVersion: 1, requestId: isRecord(request) && typeof request.requestId === 'string' ? request.requestId : 'invalid-request', kind: 'task-filter-query-result', ok: false, freshness: { source: 'live-runtime', coherence: 'unverified', observedAt: new Date(0).toISOString(), settled: false }, warnings: [], error };
}

function policyError(denial: { readonly code: Parameters<typeof structuredErrorV1>[0]; readonly reason: string; readonly retryable: boolean; readonly reasonCode: string }): StructuredErrorV1 {
	return structuredErrorV1(denial.code, denial.reason, { retryable: denial.retryable, details: { reasonCode: denial.reasonCode } });
}

function recoveryError(error: unknown): StructuredErrorV1 {
	if (error instanceof DeveloperMutationRecoveryStoreErrorV1 && error.code === 'plan-expired') return structuredErrorV1('plan-expired', error.message, { retryable: false, action: 'do-not-retry' });
	return structuredErrorV1('receipt-store-unavailable', 'Durable Developer API recovery admission is unavailable.', { retryable: true, action: 'wait-and-retry' });
}

function stateError(action: 'apply' | 'recover', state: StateV1): StructuredErrorV1 {
	return structuredErrorV1('invalid-request', action === 'apply' ? `Apply is unavailable while this task-adoption plan is ${state}.` : `Recovery is available only while this task-adoption plan is recovery-required, not ${state}.`);
}

function mutationAuthorityError(): StructuredErrorV1 {
	return structuredErrorV1('authority-insufficient', 'Developer API task-adoption admission requires the host security policy.');
}

async function markTerminal(store: DeveloperMutationRecoveryStoreV1, consumerId: string, recovery: string): Promise<void> {
	try { await store.markTerminal(consumerId, recovery); } catch { /* dispatched record remains conservatively recoverable */ }
}

function validRecoveryInput(value: unknown): value is TaskWorkflowDeveloperMutationRecoverInputV1 {
	if (!isRecord(value) || !onlyKeys(value, ['plan', 'recoveryRef'])) return false;
	const keys = Reflect.ownKeys(value);
	const hasPlan = keys.includes('plan');
	const hasRef = keys.includes('recoveryRef');
	return hasPlan !== hasRef && (!hasRef || (typeof value.recoveryRef === 'string' && /^dvr1_[0-9a-f]{48}$/u.test(value.recoveryRef)));
}

function exactInput(value: unknown, keys: readonly string[]): value is Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1 }> {
	return isRecord(value) && Reflect.ownKeys(value).length === keys.length && onlyKeys(value, keys);
}

function isAccessCapability(value: unknown): value is TaskWorkflowDeveloperAccessCapabilityV1 {
	return value === 'tasks.filter-query'
		|| value === 'tasks.create.periodic-note.preview'
		|| value === 'tasks.create.periodic-note.apply'
		|| value === 'tasks.update.periodic-note.preview'
		|| value === 'tasks.update.periodic-note.apply'
		|| value === 'tasks.adopt.preview'
		|| value === 'tasks.adopt.apply';
}

function hostMutationKey(session: string, request: string): string { return `${session}:${request}:${hex(16)}`; }
function recoveryRef(): string { return `dvr1_${hex(24)}`; }
function randomSessionId(): string { return `task-workflow-developer-${hex(16)}`; }
function hex(length: number): string { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
function cloneSafe<T>(value: unknown): T | null { try { return freezeDto(value) as T; } catch { return null; } }
function freezeDto<T>(value: T): T { const clone = structuredClone(value); freeze(clone, new WeakSet<object>()); return clone; }
function freezeStructure<T>(value: T): T { freeze(value, new WeakSet<object>()); return value; }
function freeze(value: unknown, seen: WeakSet<object>): void { if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return; seen.add(value); for (const child of Object.values(value)) freeze(child, seen); Object.freeze(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)); }
