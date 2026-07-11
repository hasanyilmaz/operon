import type { Pipeline } from '../types/pipeline';

type WorkflowStatusSemanticsTuple = readonly [
	pipelineName: string,
	statusLabel: string,
	isFinished: boolean,
	isCancelled: boolean,
];

function compareText(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function compareTuples(
	left: WorkflowStatusSemanticsTuple,
	right: WorkflowStatusSemanticsTuple,
): number {
	const pipelineComparison = compareText(left[0], right[0]);
	if (pipelineComparison !== 0) return pipelineComparison;

	const statusComparison = compareText(left[1], right[1]);
	if (statusComparison !== 0) return statusComparison;

	const finishedComparison = Number(left[2]) - Number(right[2]);
	if (finishedComparison !== 0) return finishedComparison;

	return Number(left[3]) - Number(right[3]);
}

/**
 * Build the workflow semantics signature used by the persisted task index.
 *
 * Pipeline/status position, stable ids, presentation fields, automation flags,
 * and the default pipeline do not affect indexed checkbox/tier semantics. The
 * sorted tuple list keeps the signature deterministic and order-independent
 * while preserving duplicate tuples as meaningful taxonomy input.
 */
export function buildWorkflowStatusSemanticsSignature(
	pipelines: readonly Pipeline[],
): string {
	const tuples: WorkflowStatusSemanticsTuple[] = [];
	for (const pipeline of pipelines) {
		for (const status of pipeline.statuses) {
			tuples.push([
				pipeline.name,
				status.label,
				status.isFinished,
				status.isCancelled,
			]);
		}
	}

	tuples.sort(compareTuples);
	return JSON.stringify(tuples);
}
