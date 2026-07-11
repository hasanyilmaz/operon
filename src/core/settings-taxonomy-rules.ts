import { clonePipeline, Pipeline, StatusDefinition } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { normalizePriorityValue } from './priority-rank';

export function hasDuplicatePriorityLabel(
	priorities: PriorityDefinition[],
	priorityId: string,
	nextLabel: string,
): boolean {
	// Priority matching is case/whitespace-insensitive, so guard duplicates the same way
	// (e.g. "High" and "high" would otherwise collide into one rank).
	const normalizedNext = normalizePriorityValue(nextLabel);
	return priorities.some(candidate => candidate.id !== priorityId && normalizePriorityValue(candidate.label) === normalizedNext);
}

export function hasDuplicateStatusLabel(
	statuses: StatusDefinition[],
	statusId: string,
	nextLabel: string,
): boolean {
	return statuses.some(candidate => candidate.id !== statusId && candidate.label === nextLabel);
}

export function resolveDefaultPriorityAfterDelete(
	defaultPriority: string,
	deletedPriorityLabel: string,
	remainingPriorities: PriorityDefinition[],
): string {
	if (!defaultPriority) return '';
	if (defaultPriority === deletedPriorityLabel) {
		return remainingPriorities[0]?.label ?? '';
	}
	return remainingPriorities.some(priority => priority.label === defaultPriority)
		? defaultPriority
		: remainingPriorities[0]?.label ?? '';
}

export function createUniqueTaxonomyLabel(baseLabel: string, existingLabels: Iterable<string>): string {
	const existing = new Set(existingLabels);
	if (!existing.has(baseLabel)) return baseLabel;
	let suffix = 2;
	while (existing.has(`${baseLabel} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

export function buildPipelineNameDraft(currentPipeline: Pipeline, nextName: string): Pipeline {
	const draft = clonePipeline(currentPipeline);
	draft.name = nextName;
	return draft;
}

export function buildPipelineStatusLabelDraft(
	currentPipeline: Pipeline,
	statusId: string,
	nextLabel: string,
): Pipeline | null {
	const draft = clonePipeline(currentPipeline);
	const status = draft.statuses.find(candidate => candidate.id === statusId);
	if (!status) return null;
	status.label = nextLabel;
	return draft;
}
