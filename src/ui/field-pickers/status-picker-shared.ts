import { composeStatusValue, Pipeline } from '../../types/pipeline';
import { scrollChildIntoView } from './common';

export interface StatusPickerOption {
	value: string;
	color: string;
	pipelineId: string;
	pipelineName: string;
	statusId: string;
	statusLabel: string;
}

export function buildStatusPickerOptions(pipelines: Pipeline[]): StatusPickerOption[] {
	const allStatuses: StatusPickerOption[] = [];
	for (const pipeline of pipelines) {
		for (const status of pipeline.statuses) {
			allStatuses.push({
				value: composeStatusValue(pipeline.name, status.label),
				color: status.color,
				pipelineId: pipeline.id,
				pipelineName: pipeline.name,
				statusId: status.id,
				statusLabel: status.label,
			});
		}
	}
	return allStatuses;
}

export function filterStatusPickerOptions(
	allStatuses: StatusPickerOption[],
	query: string,
): StatusPickerOption[] {
	const trimmed = query.trim();
	const exactMatches = trimmed
		? allStatuses.filter(status => status.value === trimmed)
		: [];
	const selectedPipeline = exactMatches.length === 1
		? exactMatches[0]
		: null;

	if (selectedPipeline) {
		return allStatuses.filter(status =>
			status.pipelineId === selectedPipeline.pipelineId
			&& status.pipelineName === selectedPipeline.pipelineName,
		);
	}

	return trimmed.length === 0
		? allStatuses
		: allStatuses.filter(status => status.value.toLowerCase().includes(trimmed.toLowerCase()));
}

export function ensureActiveStatusOptionVisible(container: HTMLElement, activeIndex: number): void {
	const activeItem = container.querySelector<HTMLElement>(`.operon-status-dropdown-item[data-status-index="${activeIndex}"]`);
	scrollChildIntoView(container, activeItem);
}
