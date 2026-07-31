import type { IndexedTask } from '../types/fields';
import type { Pipeline } from '../types/pipeline';
import { isDependencyBlockerResolved } from './dependency-graph';
import type { WorkflowStatusIdentityIndex } from './workflow-status-identity';

export type BlockedByVisualState = 'active' | 'resolved' | 'missing';

export const BLOCKED_BY_ACTIVE_COLOR = '#dc2626';
export const BLOCKED_BY_RESOLVED_COLOR = '#2563eb';

export type BlockedByTaskResolver = (operonId: string) => IndexedTask | undefined;

export function resolveBlockedByVisualState(
	blockerTask: IndexedTask | null | undefined,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): BlockedByVisualState {
	if (!blockerTask) return 'missing';
	return isDependencyBlockerResolved(blockerTask, pipelines, workflowStatusIdentityIndex)
		? 'resolved'
		: 'active';
}

export function resolveBlockedByVisualStateForId(
	operonId: string,
	getTask: BlockedByTaskResolver,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): BlockedByVisualState {
	return resolveBlockedByVisualState(
		getTask(operonId.trim()),
		pipelines,
		workflowStatusIdentityIndex,
	);
}

export function resolveBlockedByAggregateVisualState(
	operonIds: Iterable<string>,
	getTask: BlockedByTaskResolver,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): BlockedByVisualState | null {
	let aggregate: BlockedByVisualState | null = null;
	for (const rawOperonId of operonIds) {
		const operonId = rawOperonId.trim();
		if (!operonId) continue;
		const state = resolveBlockedByVisualStateForId(
			operonId,
			getTask,
			pipelines,
			workflowStatusIdentityIndex,
		);
		if (state === 'active') return 'active';
		if (state === 'missing') aggregate = 'missing';
		else if (!aggregate) aggregate = 'resolved';
	}
	return aggregate;
}

export function resolveBlockedByVisualStateColor(
	state: BlockedByVisualState | null | undefined,
): string | null {
	if (state === 'resolved') return BLOCKED_BY_RESOLVED_COLOR;
	if (state === 'active' || state === 'missing') return BLOCKED_BY_ACTIVE_COLOR;
	return null;
}
