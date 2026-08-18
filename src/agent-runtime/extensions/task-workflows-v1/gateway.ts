import { structuredErrorV1 } from '../../contracts/v1/primitives';
import type { RuntimeInvocationContextV1 } from '../../runtime/types';
import {
	admitTaskWorkflowApplyRequestExtensionV1,
	decodeTaskWorkflowApplyRequestExtensionV1,
	decodeTaskWorkflowMutationResultExtensionV1,
	decodeTaskWorkflowPreviewRequestExtensionV1,
	decodeTaskWorkflowPreviewResultExtensionV1,
} from './decode';
import type {
	TaskWorkflowApplyRequestV1,
	TaskWorkflowMutationResultV1,
	TaskWorkflowPreviewRequestV1,
	TaskWorkflowPreviewResultV1,
} from './contracts';

export interface TaskWorkflowGatewayPortsV1 {
	isReady(): boolean;
	nowEpochMs(): number;
	preview(
		request: TaskWorkflowPreviewRequestV1,
		context?: RuntimeInvocationContextV1,
	): Promise<TaskWorkflowPreviewResultV1>;
	/**
	 * A plan past its five-minute freshness window may enter only the bounded
	 * same-plan receipt/journal recovery path. This is intentionally a private
	 * gateway port rather than a public contract relaxation.
	 */
	hasSamePlanRecoveryEvidence(request: TaskWorkflowApplyRequestV1): Promise<boolean>;
	apply(
		request: TaskWorkflowApplyRequestV1,
		execution: TaskWorkflowApplyExecutionV1,
	): Promise<TaskWorkflowMutationResultV1>;
	auditDispatched(
		event: TaskWorkflowDispatchAuditEventV1,
		request: TaskWorkflowApplyRequestV1,
	): Promise<void>;
	auditCompleted(
		event: TaskWorkflowTerminalAuditEventV1,
		request: TaskWorkflowApplyRequestV1,
		result: TaskWorkflowMutationResultV1,
	): Promise<void>;
}

type TaskWorkflowDispatchAuditEventV1 = 'apply-dispatched' | 'recovery-dispatched';
type TaskWorkflowTerminalAuditEventV1 = 'apply-completed' | 'recovery-completed';

interface TaskWorkflowApplyExecutionV1 {
	readonly recoveryOnly: boolean;
	dispatch(event: TaskWorkflowDispatchAuditEventV1): Promise<void>;
}

export function taskWorkflowTerminalAuditFieldsV1(
	result: TaskWorkflowMutationResultV1,
): Readonly<{ outcome: 'succeeded' | 'failed' | 'outcome-unknown'; errorCode: string | null }> {
	const terminalOutcome = result.receipt?.terminalOutcome;
	if (
		terminalOutcome === 'applied'
		|| terminalOutcome === 'already-applied'
		|| result.status === 'applied'
		|| result.status === 'already-applied'
	) return { outcome: 'succeeded', errorCode: null };
	if (terminalOutcome === 'outcome-unknown' || result.status === 'outcome-unknown') {
		return { outcome: 'outcome-unknown', errorCode: result.error?.code ?? 'outcome-unknown' };
	}
	return { outcome: 'failed', errorCode: result.error?.code ?? null };
}

/**
 * Strict admission boundary for the additive task-workflow extension.
 *
 * The frozen Runtime V1 gateway never sees these request kinds. Extension
 * decoding and readiness admission complete here before execution is delegated
 * to extension-only ports.
 */
export class TaskWorkflowGatewayV1 {
	constructor(private readonly ports: TaskWorkflowGatewayPortsV1) {}

	async preview(
		value: unknown,
		context?: RuntimeInvocationContextV1,
	): Promise<TaskWorkflowPreviewResultV1> {
		const decoded = decodeTaskWorkflowPreviewRequestExtensionV1(value);
		if (!decoded.ok) return previewFailure(requestId(value), 'invalid-request', 'The task-workflow preview request is invalid.');
		if (!this.ports.isReady()) return previewFailure(decoded.value.requestId, 'live-settling', 'Runtime is not ready for task-workflow preview.', true);
		try {
			const result = decodeTaskWorkflowPreviewResultExtensionV1(
				await this.ports.preview(decoded.value, context),
			);
			return result.ok && result.value.requestId === decoded.value.requestId
				? result.value
				: previewFailure(
					decoded.value.requestId,
					'internal-error',
					'Task-workflow preview produced an invalid extension result.',
				);
		} catch {
			return previewFailure(decoded.value.requestId, 'internal-error', 'Task-workflow preview failed inside its isolated gateway.');
		}
	}

	async apply(value: unknown): Promise<TaskWorkflowMutationResultV1> {
		return this.executeApply(value, false);
	}

	/** Host-internal same-plan recovery entrypoint; never exposed by Runtime V1. */
	async recover(value: unknown): Promise<TaskWorkflowMutationResultV1> {
		return this.executeApply(value, true);
	}

	private async executeApply(
		value: unknown,
		recoveryIntent: boolean,
	): Promise<TaskWorkflowMutationResultV1> {
		const decoded = decodeTaskWorkflowApplyRequestExtensionV1(value);
		if (!decoded.ok) return applyFailure(requestId(value), 'invalid-request', 'The task-workflow apply request is invalid.');
		const admission = admitTaskWorkflowApplyRequestExtensionV1(decoded.value, this.ports.nowEpochMs());
		const expired = !admission.ok && hasOnlyExpiredPlanIssue(admission.issues);
		if (!admission.ok) {
			if (!expired) {
				return applyFailure(decoded.value.requestId, 'invalid-request', 'The task-workflow apply request is invalid.');
			}
		}
		if (expired) {
			try {
				if (!await this.ports.hasSamePlanRecoveryEvidence(decoded.value)) {
					return applyFailure(
						decoded.value.requestId,
						'plan-expired',
						'The sealed task-workflow plan has expired.',
					);
				}
			} catch {
				return applyFailure(
					decoded.value.requestId,
					'plan-expired',
					'The sealed task-workflow plan has expired.',
				);
			}
		}
		const recoveryOnly = expired;
		if (!this.ports.isReady()) return applyFailure(decoded.value.requestId, 'live-settling', 'Runtime is not ready for task-workflow apply.', true);
		let dispatchedEvent: TaskWorkflowDispatchAuditEventV1 | null = null;
		const dispatch = async (event: TaskWorkflowDispatchAuditEventV1): Promise<void> => {
			const effectiveEvent = recoveryIntent ? 'recovery-dispatched' : event;
			if (dispatchedEvent) {
				if (dispatchedEvent !== effectiveEvent) throw new Error('Task-workflow apply cannot change audit mode after dispatch.');
				return;
			}
			await this.ports.auditDispatched(effectiveEvent, decoded.value);
			dispatchedEvent = effectiveEvent;
		};
		try {
			const output = decodeTaskWorkflowMutationResultExtensionV1(
				await this.ports.apply(decoded.value, { recoveryOnly, dispatch }),
			);
			const result = output.ok && output.value.requestId === decoded.value.requestId
				? output.value
				: applyOutcomeUnknown(
					decoded.value,
					'Task-workflow execution produced an invalid extension result; same-plan recovery is required.',
				);
			if (dispatchedEvent) {
				try {
					await this.ports.auditCompleted(
						dispatchedEvent === 'recovery-dispatched'
							? 'recovery-completed'
							: 'apply-completed',
						decoded.value,
						result,
					);
				} catch {
					return applyOutcomeUnknown(decoded.value, 'Task-workflow execution completed, but its terminal security audit could not be persisted.');
				}
			}
			return result;
		} catch {
			if (dispatchedEvent) {
				try {
					await this.ports.auditCompleted(
						dispatchedEvent === 'recovery-dispatched'
							? 'recovery-completed'
							: 'apply-completed',
						decoded.value,
						applyOutcomeUnknown(decoded.value, 'Task-workflow execution stopped after dispatch.'),
					);
				} catch {
					// The dominant outcome is already uncertain; preserve same-plan recovery.
				}
			}
			return applyOutcomeUnknown(
				decoded.value,
				'Task-workflow execution stopped after apply admission; same-plan recovery is required.',
			);
		}
	}
}

function hasOnlyExpiredPlanIssue(
	issues: ReadonlyArray<{ readonly path: string }>,
): boolean {
	return issues.length === 1 && issues[0]?.path === '/plan/expiresAt';
}

function previewFailure(
	requestId: string,
	code: Parameters<typeof structuredErrorV1>[0],
	reason: string,
	retryable = false,
): TaskWorkflowPreviewResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'mutation-preview-result',
		ok: false,
		warnings: [],
		error: structuredErrorV1(code, reason, { retryable }),
	};
}

function applyFailure(
	requestId: string,
	code: Parameters<typeof structuredErrorV1>[0],
	reason: string,
	retryable = false,
): TaskWorkflowMutationResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'mutation-result',
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: retryable,
		groupResults: [],
		error: structuredErrorV1(code, reason, { retryable }),
	};
}

function applyOutcomeUnknown(
	request: TaskWorkflowApplyRequestV1,
	reason: string,
): TaskWorkflowMutationResultV1 {
	const error = structuredErrorV1('outcome-unknown', reason, { retryable: false });
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [{
			groupId: request.plan.atomicGroups[0]?.groupId ?? 'task-workflow-dispatch',
			status: 'outcome-unknown',
			error,
		}],
		ambiguitySource: 'group-outcome',
		error,
	};
}

function requestId(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid-request';
	const candidate = (value as { requestId?: unknown }).requestId;
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'invalid-request';
}
