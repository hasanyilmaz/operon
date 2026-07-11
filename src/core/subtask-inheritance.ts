import { OperonIndexer } from '../indexer/indexer';
import {
	CHILD_TASK_INHERITANCE_TAGS_KEY,
	DEFAULT_CHILD_TASK_INHERITANCE_FIELDS,
	isChildTaskInheritanceEligibleFieldKey,
	normalizeChildTaskInheritanceFields,
	OperonSettings,
} from '../types/settings';
import { composeStatusValue, parseStatusValue } from '../types/pipeline';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredPipelineNameIdentity,
	resolveWorkflowPipelineIdentity,
} from './workflow-status-identity';

export interface SubtaskInitialFields {
	parentTask?: string;
	status?: string;
	priority?: string;
	taskIcon?: string;
	taskColor?: string;
	tags?: string[];
	[key: string]: string | string[] | undefined;
}

function resolveInitialStatus(parentStatus: string | undefined, settings: OperonSettings): string | undefined {
	const pipelines = settings.pipelines ?? [];
	const identityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const explicitDefault = resolveConfiguredPipelineNameIdentity(settings.defaultPipelineName, identityIndex);
	if (explicitDefault.kind === 'ambiguous') return undefined;
	const defaultPipeline = explicitDefault.kind === 'configured' ? explicitDefault.pipeline : pipelines[0];
	let targetPipeline = defaultPipeline;
	if (settings.childTaskInheritanceStatusPipelineSource !== 'default' && parentStatus) {
		const identity = resolveWorkflowPipelineIdentity(
			parentStatus,
				identityIndex,
		);
		if (identity.kind === 'ambiguous') return undefined;
		if (identity.kind === 'configured') {
			targetPipeline = identity.pipeline;
		} else {
			const parsed = parseStatusValue(identity.value);
				if (!parsed) {
					targetPipeline = defaultPipeline;
				} else {
					const parsedPipeline = resolveConfiguredPipelineNameIdentity(parsed.pipeline, identityIndex);
					if (parsedPipeline.kind === 'ambiguous') return undefined;
					targetPipeline = parsedPipeline.kind === 'configured'
						? parsedPipeline.pipeline
						: defaultPipeline;
				}
		}
	}

	const firstStatus = targetPipeline?.statuses[0];
	if (!targetPipeline || !firstStatus) return undefined;
	return composeStatusValue(targetPipeline.name, firstStatus.label);
}

function resolveInheritanceFieldKeys(parentTaskId: string | null, settings: OperonSettings): string[] {
	if (!parentTaskId) return [...DEFAULT_CHILD_TASK_INHERITANCE_FIELDS];
	return normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings);
}

function normalizeInheritedTags(tags: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const rawTag of tags ?? []) {
		const tag = rawTag.trim().replace(/^#/, '').trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		normalized.push(tag);
	}
	return normalized;
}

function applyInheritedField(
	inherited: SubtaskInitialFields,
	key: string,
	parentFields: Record<string, string>,
	parentTags: readonly string[] | null | undefined,
	settings: OperonSettings,
): void {
	if (key === CHILD_TASK_INHERITANCE_TAGS_KEY) {
		const normalizedTags = normalizeInheritedTags(parentTags);
		if (normalizedTags.length > 0) inherited.tags = normalizedTags;
		return;
	}
	if (key === 'status') {
		const inheritedStatus = resolveInitialStatus(parentFields.status, settings);
		if (inheritedStatus) inherited.status = inheritedStatus;
		return;
	}
	if (key === 'priority') {
		if (parentFields.priority?.trim()) {
			inherited.priority = parentFields.priority.trim();
		} else if (settings.defaultPriority?.trim()) {
			inherited.priority = settings.defaultPriority.trim();
		}
		return;
	}
	if (key === 'taskIcon') {
		const normalizedTaskIcon = normalizeTaskIconValue(parentFields.taskIcon);
		if (normalizedTaskIcon) inherited.taskIcon = normalizedTaskIcon;
		return;
	}
	if (key === 'taskColor') {
		const normalizedTaskColor = normalizeTaskColorValue(parentFields.taskColor);
		if (normalizedTaskColor) inherited.taskColor = normalizedTaskColor;
		return;
	}
	const value = parentFields[key]?.trim();
	if (value && isChildTaskInheritanceEligibleFieldKey(key, settings.keyMappings)) {
		inherited[key] = value;
	}
}

export function resolveSubtaskInitialFieldsFromParentValues(
	parentTaskId: string | null,
	parentFieldValues: Record<string, string> | null | undefined,
	settings: OperonSettings,
	parentTags?: readonly string[] | null,
): SubtaskInitialFields {
	const inherited: SubtaskInitialFields = {};
	const parentFields = parentFieldValues ?? {};
	if (parentTaskId) inherited.parentTask = parentTaskId;

	for (const key of resolveInheritanceFieldKeys(parentTaskId, settings)) {
		applyInheritedField(inherited, key, parentFields, parentTags, settings);
	}

	return inherited;
}

export function getSubtaskInitialFieldKeys(inherited: SubtaskInitialFields): string[] {
	return Object.keys(inherited).filter(key => {
		const value = inherited[key];
		return typeof value === 'string' && !!value.trim();
	});
}

export function getSubtaskInheritedFieldKeys(inherited: SubtaskInitialFields): string[] {
	return getSubtaskInitialFieldKeys(inherited).filter(key => key !== 'parentTask');
}

export function resolveSubtaskInitialFields(
	parentTaskId: string | null,
	indexer: OperonIndexer,
	settings: OperonSettings,
): SubtaskInitialFields {
	const parent = parentTaskId ? indexer.getTask(parentTaskId) : null;
	return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, parent?.fieldValues, settings, parent?.tags);
}
