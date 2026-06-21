import { CheckboxState } from './keys';

/**
 * Pipeline and status model for Operon.
 * Based on Spec Sections 5.3.1 - 5.3.4.
 */

/** A single status definition within a pipeline */
export interface StatusDefinition {
	/** Internal stable status id used for settings-side rename matching */
	id: string;
	/** Status label (e.g. "Brainstorming", "InProgress", "Finished") */
	label: string;
	/** Primary color for status display (hex) */
	color: string;
	/** Optional icon used by pipeline-aware task icon displays */
	pipelineStatusIcon?: string;
	/** Whether this status is a terminal "finished" state */
	isFinished: boolean;
	/** Whether this status is a terminal "cancelled" state */
	isCancelled: boolean;
	/** Whether assigning dateScheduled should move tasks into this status */
	isScheduledTarget: boolean;
	/** Whether starting a tracker should move tasks into this status */
	isTrackingTarget: boolean;
	/** Optional property mapping for sync/export (e.g. "PRJ_BS") */
	propertyMapping: string | null;
}

/** A pipeline containing ordered status definitions */
export interface Pipeline {
	/** Internal stable pipeline id used for settings-side rename matching */
	id: string;
	/** Pipeline name (e.g. "Project", "Prompting") */
	name: string;
	/** Optional human/agent guidance for when this pipeline should be used */
	description?: string;
	/** Ordered status definitions within this pipeline */
	statuses: StatusDefinition[];
}

export interface WorkflowStatusResolution {
	value: string;
	definition: StatusDefinition;
	checkbox: CheckboxState;
	terminalDateKey: 'dateCompleted' | 'dateCancelled' | null;
}

export interface CheckboxToggleWorkflowResolution {
	checkbox: CheckboxState;
	workflow: WorkflowStatusResolution | null;
}

export interface ReverseWorkflowResolution {
	pipelineName: string | null;
	workflow: WorkflowStatusResolution | null;
	checkbox: CheckboxState;
	clearDateCompleted: boolean;
	clearDateCancelled: boolean;
	isValid: boolean;
	errorMessage?: string;
}

export type PipelineAutomationTrigger = 'scheduled' | 'tracking';

function createEntityId(prefix: 'pl' | 'st'): string {
	return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createPipelineId(): string {
	return createEntityId('pl');
}

export function createStatusId(): string {
	return createEntityId('st');
}

export function cloneStatusDefinition(status: StatusDefinition): StatusDefinition {
	return { ...status };
}

export function clonePipeline(pipeline: Pipeline): Pipeline {
	return {
		...pipeline,
		statuses: pipeline.statuses.map(status => cloneStatusDefinition(status)),
	};
}

/** Default pipeline configuration */
export const DEFAULT_PIPELINES: Pipeline[] = [
	{
		id: 'pl_project',
		name: 'Project',
		description: 'Use this pipeline for outcome-based work with a clear deliverable. Brainstorming is for shaping rough ideas, Planned is for committed work, InProgress is for active execution, Paused is for blocked or intentionally deferred work, Finished is for completed deliverables, and Dropped is for work that was intentionally abandoned.',
		statuses: [
			{ id: 'st_project_brainstorming', label: 'Brainstorming', color: '#239eaf', isFinished: false, isCancelled: false, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
			{ id: 'st_project_planned', label: 'Planned', color: '#ff7b0f', isFinished: false, isCancelled: false, isScheduledTarget: true, isTrackingTarget: false, propertyMapping: null },
			{ id: 'st_project_in_progress', label: 'InProgress', color: '#f31212', isFinished: false, isCancelled: false, isScheduledTarget: false, isTrackingTarget: true, propertyMapping: null },
			{ id: 'st_project_finished', label: 'Finished', color: '#787878', isFinished: true, isCancelled: false, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
			{ id: 'st_project_paused', label: 'Paused', color: '#1a7ebc', isFinished: false, isCancelled: false, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
			{ id: 'st_project_dropped', label: 'Dropped', color: '#1f1f1f', isFinished: false, isCancelled: true, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
		],
	},
];

/**
 * Compose a canonical status value from pipeline and status label.
 * Format: "Pipeline.Status" (e.g. "Project.InProgress")
 */
export function composeStatusValue(pipelineName: string, statusLabel: string): string {
	return `${pipelineName}.${statusLabel}`;
}

/**
 * Parse a canonical status value into pipeline name and status label.
 * Returns null if the value doesn't contain a dot separator.
 */
export function parseStatusValue(value: string): { pipeline: string; status: string } | null {
	const dotIndex = value.indexOf('.');
	if (dotIndex === -1) return null;
	return {
		pipeline: value.substring(0, dotIndex),
		status: value.substring(dotIndex + 1),
	};
}

/**
 * Find a StatusDefinition by its canonical status value in a list of pipelines.
 */
export function findStatusDef(pipelines: Pipeline[], statusValue: string): StatusDefinition | null {
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return null;
	const pipeline = pipelines.find(p => p.name === parsed.pipeline);
	if (!pipeline) return null;
	return pipeline.statuses.find(s => s.label === parsed.status) ?? null;
}

export function canStatusBeAutomationTarget(
	status: Pick<StatusDefinition, 'isFinished' | 'isCancelled'>,
): boolean {
	return !status.isFinished && !status.isCancelled;
}

type AutomationStatusKey = 'isScheduledTarget' | 'isTrackingTarget';

function getAutomationStatusKey(trigger: PipelineAutomationTrigger): AutomationStatusKey {
	return trigger === 'scheduled' ? 'isScheduledTarget' : 'isTrackingTarget';
}

export function findPipelineAutomationTarget(
	pipeline: Pipeline,
	trigger: PipelineAutomationTrigger,
): StatusDefinition | null {
	const key = getAutomationStatusKey(trigger);
	return pipeline.statuses.find(status => canStatusBeAutomationTarget(status) && status[key]) ?? null;
}

export function resolveAutomationWorkflowStatus(
	pipelines: Pipeline[],
	statusValue: string | undefined,
	defaultPipelineName: string,
	trigger: PipelineAutomationTrigger,
): WorkflowStatusResolution | null {
	const pipeline = getCurrentOrDefaultPipeline(pipelines, statusValue, defaultPipelineName);
	if (!pipeline) return null;

	const target = findPipelineAutomationTarget(pipeline, trigger);
	if (!target) return null;

	return resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, target.label));
}

export function shouldTriggerOneShotAutomation(
	previousValue: string | undefined,
	nextValue: string | undefined,
): boolean {
	const previous = previousValue?.trim() ?? '';
	const next = nextValue?.trim() ?? '';
	return !previous && !!next;
}

export function resolveWorkflowStatus(
	pipelines: Pipeline[],
	statusValue: string | undefined,
): WorkflowStatusResolution | null {
	if (!statusValue) return null;
	const def = findStatusDef(pipelines, statusValue);
	if (!def) return null;

	if (def.isFinished) {
		return {
			value: statusValue,
			definition: def,
			checkbox: 'done',
			terminalDateKey: 'dateCompleted',
		};
	}

	if (def.isCancelled) {
		return {
			value: statusValue,
			definition: def,
			checkbox: 'cancelled',
			terminalDateKey: 'dateCancelled',
		};
	}

	return {
		value: statusValue,
		definition: def,
		checkbox: 'open',
		terminalDateKey: null,
	};
}

export function getNextWorkflowStatus(
	pipelines: Pipeline[],
	statusValue: string | undefined,
): WorkflowStatusResolution | null {
	if (!statusValue) return null;
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return null;

	const pipeline = pipelines.find(p => p.name === parsed.pipeline);
	if (!pipeline || pipeline.statuses.length === 0) return null;

	const currentIdx = pipeline.statuses.findIndex(s => s.label === parsed.status);
	const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % pipeline.statuses.length;
	const nextStatus = pipeline.statuses[nextIdx];
	const nextValue = composeStatusValue(pipeline.name, nextStatus.label);

	return resolveWorkflowStatus(pipelines, nextValue);
}

export function getNextCheckboxWorkflowStatus(
	pipelines: Pipeline[],
	statusValue: string | undefined,
): WorkflowStatusResolution | null {
	if (!statusValue) return null;
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return null;

	const pipeline = pipelines.find(p => p.name === parsed.pipeline);
	if (!pipeline || pipeline.statuses.length === 0) return null;

	const eligibleStatuses = pipeline.statuses.filter(status => !status.isCancelled);
	if (eligibleStatuses.length === 0) return null;

	const current = pipeline.statuses.find(status => status.label === parsed.status);
	if (!current) {
		return resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, eligibleStatuses[0].label));
	}

	if (current.isCancelled) {
		return resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, eligibleStatuses[0].label));
	}

	const currentEligibleIndex = eligibleStatuses.findIndex(status => status.label === current.label);
	if (currentEligibleIndex === -1) {
		return resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, eligibleStatuses[0].label));
	}

	const nextEligibleIndex = (currentEligibleIndex + 1) % eligibleStatuses.length;
	return resolveWorkflowStatus(
		pipelines,
		composeStatusValue(pipeline.name, eligibleStatuses[nextEligibleIndex].label),
	);
}

export function getCheckboxToggleWorkflowStatus(
	pipelines: Pipeline[],
	statusValue: string | undefined,
	currentCheckbox: CheckboxState,
): CheckboxToggleWorkflowResolution {
	if (!statusValue) {
		return { checkbox: getNextCheckboxState(currentCheckbox), workflow: null };
	}

	const parsed = parseStatusValue(statusValue);
	if (!parsed) {
		return { checkbox: getNextCheckboxState(currentCheckbox), workflow: null };
	}

	const pipeline = pipelines.find(candidate => candidate.name === parsed.pipeline);
	if (!pipeline || pipeline.statuses.length === 0) {
		return { checkbox: getNextCheckboxState(currentCheckbox), workflow: null };
	}

	const currentWorkflow = resolveWorkflowStatus(pipelines, statusValue);
	const firstStatus = pipeline.statuses[0];
	const finishedStatus = pipeline.statuses.find(status => status.isFinished) ?? null;
	const cancelledStatus = pipeline.statuses.find(status => status.isCancelled) ?? null;

	if (currentCheckbox === 'open') {
		return {
			checkbox: 'done',
			workflow: finishedStatus
				? resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, finishedStatus.label))
				: currentWorkflow,
		};
	}

	if (currentCheckbox === 'done') {
		return {
			checkbox: 'cancelled',
			workflow: cancelledStatus
				? resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, cancelledStatus.label))
				: currentWorkflow,
		};
	}

	return {
		checkbox: 'open',
		workflow: resolveWorkflowStatus(pipelines, composeStatusValue(pipeline.name, firstStatus.label)) ?? currentWorkflow,
	};
}

export function resolveReverseWorkflowFromTerminalDate(
	pipelines: Pipeline[],
	statusValue: string | undefined,
	defaultPipelineName: string,
	terminalDateKey: 'dateCompleted' | 'dateCancelled',
	dateValue: string | undefined,
): ReverseWorkflowResolution {
	const targetPipeline = getCurrentOrDefaultPipeline(pipelines, statusValue, defaultPipelineName);
	if (!targetPipeline) {
		return {
			pipelineName: null,
			workflow: null,
			checkbox: 'open',
			clearDateCompleted: terminalDateKey === 'dateCancelled',
			clearDateCancelled: terminalDateKey === 'dateCompleted',
			isValid: false,
			errorMessage: 'No valid pipeline is available for reverse workflow resolution.',
		};
	}

	if (!dateValue?.trim()) {
		const firstStatus = targetPipeline.statuses[0];
		if (!firstStatus) {
			return {
				pipelineName: targetPipeline.name,
				workflow: null,
				checkbox: 'open',
				clearDateCompleted: true,
				clearDateCancelled: true,
				isValid: false,
				errorMessage: `Pipeline "${targetPipeline.name}" has no statuses to reopen the task.`,
			};
		}

		return {
			pipelineName: targetPipeline.name,
			workflow: resolveWorkflowStatus(
				pipelines,
				composeStatusValue(targetPipeline.name, firstStatus.label),
			),
			checkbox: 'open',
			clearDateCompleted: true,
			clearDateCancelled: true,
			isValid: true,
		};
	}

	const matchingStatus = targetPipeline.statuses.find(status =>
		terminalDateKey === 'dateCompleted' ? status.isFinished : status.isCancelled,
	);

	if (!matchingStatus) {
		const terminalLabel = terminalDateKey === 'dateCompleted' ? 'finished' : 'cancelled';
		return {
			pipelineName: targetPipeline.name,
			workflow: null,
			checkbox: terminalDateKey === 'dateCompleted' ? 'done' : 'cancelled',
			clearDateCompleted: terminalDateKey === 'dateCancelled',
			clearDateCancelled: terminalDateKey === 'dateCompleted',
			isValid: false,
			errorMessage: `Pipeline "${targetPipeline.name}" has no ${terminalLabel} status.`,
		};
	}

	return {
		pipelineName: targetPipeline.name,
		workflow: resolveWorkflowStatus(
			pipelines,
			composeStatusValue(targetPipeline.name, matchingStatus.label),
		),
		checkbox: terminalDateKey === 'dateCompleted' ? 'done' : 'cancelled',
		clearDateCompleted: terminalDateKey === 'dateCancelled',
		clearDateCancelled: terminalDateKey === 'dateCompleted',
		isValid: true,
	};
}

function getCurrentOrDefaultPipeline(
	pipelines: Pipeline[],
	statusValue: string | undefined,
	defaultPipelineName: string,
): Pipeline | null {
	const parsed = statusValue ? parseStatusValue(statusValue) : null;
	if (parsed) {
		const currentPipeline = pipelines.find(candidate => candidate.name === parsed.pipeline);
		if (currentPipeline) return currentPipeline;
	}

	return pipelines.find(candidate => candidate.name === defaultPipelineName)
		?? pipelines[0]
		?? null;
}

function getNextCheckboxState(currentCheckbox: CheckboxState): CheckboxState {
	if (currentCheckbox === 'open') return 'done';
	if (currentCheckbox === 'done') return 'cancelled';
	return 'open';
}
