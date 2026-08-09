import { structuredErrorV1 } from '../../contracts/v1/primitives';
import type { RuntimeInvocationContextV1 } from '../../runtime/types';
import {
	admitTaskWorkflowApplyRequestExtensionV1,
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
	apply(request: TaskWorkflowApplyRequestV1): Promise<TaskWorkflowMutationResultV1>;
	auditDispatched(request: TaskWorkflowApplyRequestV1): Promise<void>;
	auditCompleted(request: TaskWorkflowApplyRequestV1, result: TaskWorkflowMutationResultV1): Promise<void>;
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
		const decoded = admitTaskWorkflowApplyRequestExtensionV1(value, this.ports.nowEpochMs());
		if (!decoded.ok) return applyFailure(requestId(value), 'invalid-request', 'The task-workflow apply request is invalid.');
		if (!this.ports.isReady()) return applyFailure(decoded.value.requestId, 'live-settling', 'Runtime is not ready for task-workflow apply.', true);
		try {
			await this.ports.auditDispatched(decoded.value);
		} catch {
			return applyFailure(decoded.value.requestId, 'audit-unavailable', 'The security audit admission record could not be persisted.');
		}
		try {
			const output = decodeTaskWorkflowMutationResultExtensionV1(
				await this.ports.apply(decoded.value),
			);
			const result = output.ok && output.value.requestId === decoded.value.requestId
				? output.value
				: applyOutcomeUnknown(
					decoded.value,
					'Task-workflow execution produced an invalid extension result; same-plan recovery is required.',
				);
			try {
				await this.ports.auditCompleted(decoded.value, result);
			} catch {
				return applyOutcomeUnknown(decoded.value, 'Task-workflow execution completed, but its terminal security audit could not be persisted.');
			}
			return result;
		} catch {
			try {
				await this.ports.auditCompleted(decoded.value, applyOutcomeUnknown(decoded.value, 'Task-workflow execution stopped after dispatch.'));
			} catch {
				// The dominant outcome is already uncertain; preserve same-plan recovery.
			}
			return applyOutcomeUnknown(
				decoded.value,
				'Task-workflow execution stopped after apply admission; same-plan recovery is required.',
			);
		}
	}
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
