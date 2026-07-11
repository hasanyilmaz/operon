import { composeStatusValue, type Pipeline } from '../types/pipeline';

export interface WorkflowStatusOrderPosition {
	pipelineOrder: number;
	statusOrder: number;
}

export interface WorkflowStatusOrderIndex {
	positionsByValue: ReadonlyMap<string, WorkflowStatusOrderPosition>;
	pipelineOrderByName: ReadonlyMap<string, number>;
}

/**
 * Cache signature for configured workflow identity and nested array order.
 * Presentation-only fields and stable ids are intentionally excluded.
 */
export function buildWorkflowStatusOrderSignature(pipelines: readonly Pipeline[]): string {
	return JSON.stringify(pipelines.map(pipeline => [
		pipeline.name,
		pipeline.statuses.map(status => status.label),
	]));
}

export type WorkflowStatusOrderDirection = 'asc' | 'desc';
export type WorkflowStatusEmptyPlacement = 'first' | 'last';

interface KnownWorkflowStatusOrderValue {
	kind: 'known';
	value: string;
	position: WorkflowStatusOrderPosition;
}

interface UnknownWorkflowStatusOrderValue {
	kind: 'unknown';
	value: string;
}

interface EmptyWorkflowStatusOrderValue {
	kind: 'empty';
	value: '';
}

type ClassifiedWorkflowStatusOrderValue =
	| KnownWorkflowStatusOrderValue
	| UnknownWorkflowStatusOrderValue
	| EmptyWorkflowStatusOrderValue;

interface KnownWorkflowPipelineOrderValue {
	kind: 'known';
	value: string;
	pipelineOrder: number;
}

interface UnknownWorkflowPipelineOrderValue {
	kind: 'unknown';
	value: string;
}

interface EmptyWorkflowPipelineOrderValue {
	kind: 'empty';
	value: '';
}

type ClassifiedWorkflowPipelineOrderValue =
	| KnownWorkflowPipelineOrderValue
	| UnknownWorkflowPipelineOrderValue
	| EmptyWorkflowPipelineOrderValue;

export function buildWorkflowStatusOrderIndex(
	pipelines: readonly Pipeline[],
): WorkflowStatusOrderIndex {
	const positionsByValue = new Map<string, WorkflowStatusOrderPosition>();
	const pipelineOrderByName = new Map<string, number>();
	for (const [pipelineIndex, pipeline] of pipelines.entries()) {
		const pipelineName = pipeline.name.trim();
		if (pipelineName && !pipelineOrderByName.has(pipelineName)) {
			pipelineOrderByName.set(pipelineName, pipelineIndex + 1);
		}
		for (const [statusIndex, status] of pipeline.statuses.entries()) {
			const value = composeStatusValue(pipeline.name, status.label);
			if (positionsByValue.has(value)) continue;
			positionsByValue.set(value, {
				pipelineOrder: pipelineIndex + 1,
				statusOrder: statusIndex + 1,
			});
		}
	}
	return { positionsByValue, pipelineOrderByName };
}

export function compareWorkflowPipelineValues(
	leftRaw: string | null | undefined,
	rightRaw: string | null | undefined,
	index: WorkflowStatusOrderIndex,
	options: {
		direction: WorkflowStatusOrderDirection;
		empty: WorkflowStatusEmptyPlacement;
	},
): number {
	const left = classifyWorkflowPipelineOrderValue(leftRaw, index);
	const right = classifyWorkflowPipelineOrderValue(rightRaw, index);
	const leftBucket = getWorkflowOrderBucket(left.kind, options.empty);
	const rightBucket = getWorkflowOrderBucket(right.kind, options.empty);
	if (leftBucket !== rightBucket) return leftBucket - rightBucket;

	if (left.kind === 'known' && right.kind === 'known') {
		return applyWorkflowStatusOrderDirection(
			left.pipelineOrder - right.pipelineOrder,
			options.direction,
		);
	}

	if (left.kind === 'unknown' && right.kind === 'unknown') {
		const comparison = compareUnknownWorkflowOrderValues(left.value, right.value);
		return applyWorkflowStatusOrderDirection(comparison, options.direction);
	}

	return 0;
}

export function compareWorkflowStatusValues(
	leftRaw: string | null | undefined,
	rightRaw: string | null | undefined,
	index: WorkflowStatusOrderIndex,
	options: {
		direction: WorkflowStatusOrderDirection;
		empty: WorkflowStatusEmptyPlacement;
	},
): number {
	const left = classifyWorkflowStatusOrderValue(leftRaw, index);
	const right = classifyWorkflowStatusOrderValue(rightRaw, index);
	const leftBucket = getWorkflowOrderBucket(left.kind, options.empty);
	const rightBucket = getWorkflowOrderBucket(right.kind, options.empty);
	if (leftBucket !== rightBucket) return leftBucket - rightBucket;

	if (left.kind === 'known' && right.kind === 'known') {
		const pipelineComparison = left.position.pipelineOrder - right.position.pipelineOrder;
		const statusComparison = left.position.statusOrder - right.position.statusOrder;
		return applyWorkflowStatusOrderDirection(
			pipelineComparison || statusComparison,
			options.direction,
		);
	}

	if (left.kind === 'unknown' && right.kind === 'unknown') {
		const comparison = compareUnknownWorkflowOrderValues(left.value, right.value);
		return applyWorkflowStatusOrderDirection(comparison, options.direction);
	}

	return 0;
}

function classifyWorkflowPipelineOrderValue(
	rawValue: string | null | undefined,
	index: WorkflowStatusOrderIndex,
): ClassifiedWorkflowPipelineOrderValue {
	const value = rawValue?.trim() ?? '';
	if (!value) return { kind: 'empty', value: '' };
	const pipelineOrder = index.pipelineOrderByName.get(value);
	return pipelineOrder === undefined
		? { kind: 'unknown', value }
		: { kind: 'known', value, pipelineOrder };
}

function classifyWorkflowStatusOrderValue(
	rawValue: string | null | undefined,
	index: WorkflowStatusOrderIndex,
): ClassifiedWorkflowStatusOrderValue {
	const value = rawValue?.trim() ?? '';
	if (!value) return { kind: 'empty', value: '' };
	const position = index.positionsByValue.get(value);
	return position
		? { kind: 'known', value, position }
		: { kind: 'unknown', value };
}

function getWorkflowOrderBucket(
	kind: 'known' | 'unknown' | 'empty',
	empty: WorkflowStatusEmptyPlacement,
): number {
	if (empty === 'first') {
		if (kind === 'empty') return 0;
		return kind === 'known' ? 1 : 2;
	}
	if (kind === 'known') return 0;
	return kind === 'unknown' ? 1 : 2;
}

function compareUnknownWorkflowOrderValues(left: string, right: string): number {
	return left.localeCompare(right, undefined, {
		numeric: true,
		sensitivity: 'base',
	}) || left.localeCompare(right);
}

function applyWorkflowStatusOrderDirection(
	comparison: number,
	direction: WorkflowStatusOrderDirection,
): number {
	if (comparison === 0) return 0;
	const normalized = comparison > 0 ? 1 : -1;
	return direction === 'desc' ? -normalized : normalized;
}
