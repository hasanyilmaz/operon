import type {
	CatalogPipelineV1,
	CatalogStatusV1,
	OperonCatalogV1,
	TaskContextV1,
} from '../../../src/agent-runtime/contracts/v1';
import { OPERON_ID_PATTERN_V1 } from '../../../src/agent-runtime/contracts/v1';
import type { GuidedMutationIntentV1 } from './guided-maintenance';

export const DIRECT_LIFECYCLE_ACTIONS_V1 = [
	'complete',
	'reopen',
	'cancel',
] as const;

export type DirectLifecycleActionV1 = typeof DIRECT_LIFECYCLE_ACTIONS_V1[number];

export type DirectLifecycleCompileResultV1 =
	| {
		status: 'no-change';
		action: DirectLifecycleActionV1;
		message: string;
	}
	| {
		status: 'ready';
		action: DirectLifecycleActionV1;
		intent: GuidedMutationIntentV1;
		targetStatus: {
			id: string;
			label: string;
		};
	};

export type DirectLifecycleErrorCodeV1 =
	| 'AMBIGUOUS_LIFECYCLE_TARGET'
	| 'CURRENT_PIPELINE_UNAVAILABLE'
	| 'CURRENT_STATUS_UNAVAILABLE'
	| 'INVALID_OPERON_ID'
	| 'LIFECYCLE_ACTION_UNAVAILABLE'
	| 'LIFECYCLE_TARGET_UNAVAILABLE';

export type DirectLifecycleErrorV1 = Error & {
	code: DirectLifecycleErrorCodeV1;
	action?: DirectLifecycleActionV1;
};

export function compileDirectLifecycleIntentV1(options: {
	action: DirectLifecycleActionV1;
	task: TaskContextV1;
	catalog: Extract<OperonCatalogV1, { ok: true }>;
}): DirectLifecycleCompileResultV1 {
	const { action, task, catalog } = options;
	requireSupportedAction(catalog, action);
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw directLifecycleError('INVALID_OPERON_ID', action);
	}
	const workflow = task.workflow;
	if (!workflow?.pipeline.id) {
		throw directLifecycleError('CURRENT_PIPELINE_UNAVAILABLE', action);
	}
	if (!workflow.status.id) {
		throw directLifecycleError('CURRENT_STATUS_UNAVAILABLE', action);
	}
	const pipeline = requireCurrentPipeline(
		catalog.taxonomy.pipelines,
		workflow.pipeline.id,
		action,
	);
	const currentStatuses = pipeline.statuses.filter(status => (
		status.identityStatus === 'resolved'
		&& status.id === workflow.status.id
	));
	if (currentStatuses.length !== 1) {
		throw directLifecycleError('CURRENT_STATUS_UNAVAILABLE', action);
	}
	const currentStatus = currentStatuses[0];
	const targetStatus = resolveTargetStatus(pipeline, action);
	if (hasRequestedSemantics(currentStatus, action)) {
		return {
			status: 'no-change',
			action,
			message: noChangeMessage(action),
		};
	}
	return {
		status: 'ready',
		action,
		targetStatus: {
			id: targetStatus.id,
			label: targetStatus.label,
		},
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: `The user requested the direct human-readable Operon task ${action} action.`,
			target: {
				operonId,
				locator: structuredClone(task.locator),
			},
			spec: {
				operation: 'transition',
				targetStatusId: targetStatus.id,
				expectedStatusId: workflow.status.id,
			},
		},
	};
}

function requireSupportedAction(
	catalog: Extract<OperonCatalogV1, { ok: true }>,
	action: DirectLifecycleActionV1,
): void {
	if (!catalog.policies.transitions.actions.includes(action)) {
		throw directLifecycleError('LIFECYCLE_ACTION_UNAVAILABLE', action);
	}
}

function requireCurrentPipeline(
	pipelines: readonly CatalogPipelineV1[],
	pipelineId: string,
	action: DirectLifecycleActionV1,
): CatalogPipelineV1 {
	const matches = pipelines.filter(pipeline => (
		pipeline.identityStatus === 'resolved'
		&& pipeline.id === pipelineId
	));
	if (matches.length !== 1) {
		throw directLifecycleError('CURRENT_PIPELINE_UNAVAILABLE', action);
	}
	return matches[0];
}

function resolveTargetStatus(
	pipeline: CatalogPipelineV1,
	action: DirectLifecycleActionV1,
): CatalogStatusV1 {
	const resolved = pipeline.statuses.filter(status => status.identityStatus === 'resolved');
	const candidates = action === 'complete'
		? resolved.filter(status => status.isFinished)
		: action === 'cancel'
			? resolved.filter(status => status.isCancelled)
			: resolved
				.filter(status => !status.isFinished && !status.isCancelled)
				.sort(compareStatusOrder);
	if (candidates.length === 0) {
		throw directLifecycleError('LIFECYCLE_TARGET_UNAVAILABLE', action);
	}
	if (action !== 'reopen' && candidates.length !== 1) {
		throw directLifecycleError('AMBIGUOUS_LIFECYCLE_TARGET', action);
	}
	return candidates[0];
}

function compareStatusOrder(left: CatalogStatusV1, right: CatalogStatusV1): number {
	return left.order - right.order
		|| left.label.localeCompare(right.label)
		|| left.id.localeCompare(right.id);
}

function hasRequestedSemantics(
	status: CatalogStatusV1,
	action: DirectLifecycleActionV1,
): boolean {
	if (action === 'complete') return status.isFinished;
	if (action === 'cancel') return status.isCancelled;
	return !status.isFinished && !status.isCancelled;
}

function noChangeMessage(action: DirectLifecycleActionV1): string {
	if (action === 'complete') return 'The task is already complete.';
	if (action === 'cancel') return 'The task is already cancelled.';
	return 'The task is already open.';
}

function directLifecycleError(
	code: DirectLifecycleErrorCodeV1,
	action?: DirectLifecycleActionV1,
): DirectLifecycleErrorV1 {
	return Object.assign(new Error(code), { code, action });
}
