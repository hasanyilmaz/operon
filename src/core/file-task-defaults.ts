import {
	composeStatusValue,
	findStatusDef,
	Pipeline,
	resolveAutomationWorkflowStatus,
} from '../types/pipeline';
import { normalizeLegacyCreatedDatetime } from './yaml-fields';
import { normalizeTaskIconValue } from './task-icon-value';

export interface ResolveFileTaskDefaultsOptions {
	sourceFieldValues: Record<string, string>;
	templateFieldValues?: Record<string, string>;
	existingOperonId?: string | null;
	seedCreatedAt?: string | null;
	defaultPipelineName: string;
	defaultPriority: string;
	pipelines: Pipeline[];
	now: string;
	generateOperonId: () => string;
}

export interface ResolvedFileTaskDefaults {
	operonId: string;
	datetimeCreated?: string;
	status?: string;
	priority?: string;
	taskIcon?: string;
	datetimeModified: string;
}

function normalizeRequiredValue(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function resolveDefaultFileTaskStatus(pipelines: Pipeline[], defaultPipelineName: string): string | undefined {
	const preferred = pipelines.find(pipeline => pipeline.name === defaultPipelineName) ?? pipelines[0];
	const firstStatus = preferred?.statuses[0];
	if (!preferred || !firstStatus) return undefined;
	return composeStatusValue(preferred.name, firstStatus.label);
}

function resolveTemplateStatus(value: string | null | undefined, pipelines: Pipeline[]): string | undefined {
	const normalized = normalizeRequiredValue(value);
	if (!normalized) return undefined;
	return findStatusDef(pipelines, normalized) ? normalized : undefined;
}

function resolveScheduledAutomationStatus(
	sourceFieldValues: Record<string, string>,
	templateFieldValues: Record<string, string>,
	pipelines: Pipeline[],
	defaultPipelineName: string,
): string | undefined {
	const scheduled = normalizeRequiredValue(sourceFieldValues['dateScheduled'])
		?? normalizeRequiredValue(templateFieldValues['dateScheduled']);
	if (!scheduled) return undefined;

	return resolveAutomationWorkflowStatus(
		pipelines,
		undefined,
		defaultPipelineName,
		'scheduled',
	)?.value;
}

export function resolveFileTaskDefaults(options: ResolveFileTaskDefaultsOptions): ResolvedFileTaskDefaults {
	const sourceFieldValues = options.sourceFieldValues ?? {};
	const templateFieldValues = options.templateFieldValues ?? {};

	const operonId = normalizeRequiredValue(options.existingOperonId)
		?? normalizeRequiredValue(sourceFieldValues['operonId'])
		?? options.generateOperonId();

	const status = normalizeRequiredValue(sourceFieldValues['status'])
		?? resolveTemplateStatus(templateFieldValues['status'], options.pipelines)
		?? resolveScheduledAutomationStatus(
			sourceFieldValues,
			templateFieldValues,
			options.pipelines,
			options.defaultPipelineName,
		)
		?? resolveDefaultFileTaskStatus(options.pipelines, options.defaultPipelineName);

	const priority = normalizeRequiredValue(sourceFieldValues['priority'])
		?? normalizeRequiredValue(templateFieldValues['priority'])
		?? normalizeRequiredValue(options.defaultPriority);

	return {
		operonId,
		datetimeCreated: (() => {
			const resolved = normalizeRequiredValue(sourceFieldValues['datetimeCreated'])
				?? normalizeRequiredValue(sourceFieldValues['dateCreated'])
				?? normalizeRequiredValue(templateFieldValues['datetimeCreated'])
				?? normalizeRequiredValue(templateFieldValues['dateCreated'])
				?? normalizeRequiredValue(options.seedCreatedAt);
			return resolved ? normalizeLegacyCreatedDatetime(resolved) : undefined;
		})(),
		status,
		priority,
		taskIcon: (() => {
			const resolved = normalizeTaskIconValue(
				normalizeRequiredValue(sourceFieldValues['taskIcon'])
				?? normalizeRequiredValue(templateFieldValues['taskIcon'])
				?? '',
			);
			return resolved || undefined;
		})(),
		datetimeModified: options.now,
	};
}
