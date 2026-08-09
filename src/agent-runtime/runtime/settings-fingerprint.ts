import {
	canonicalJsonV1,
	sha256HexV1,
	toJsonValueV1,
} from '../contracts/v1/canonical';
import type { JsonValue } from '../contracts/v1/primitives';
import type { FilterSet, OperonSettings } from '../../types/settings';

export const CONTEXT_SETTINGS_FINGERPRINT_VERSION_V1 = 1 as const;

const CREATION_KEYS = [
	'taskDescriptionRequired',
	'assigneesRequired',
	'fileTasksFolder',
	'inlineTaskSaveMode',
	'inlineTaskUseDailyNote',
	'inlineTaskTargetFile',
	'inlineTaskHeading',
	'fileTaskParentInlineTargetMode',
	'fileTaskParentFileTargetMode',
	'inlineToFileTaskMovePlainCheckboxes',
	'inlineTaskParentInlineTargetMode',
	'inlineTaskParentFileTargetMode',
	'inlineTaskParentFileHeadingKeyword',
	'inlineTaskDailyNoteAddStartDate',
	'inlineTaskDailyNoteAddScheduledDate',
	'calendarInlineTaskHeading',
	'autoParentFileTask',
	'autoParentLinkedFileSubtasks',
	'childTaskInheritanceFields',
	'childTaskInheritanceStatusPipelineSource',
	'taskCreatorDefaultToFileTask',
	'taskCreatorDefaultFileTemplateId',
	'fileTaskTemplateFolder',
	'createDailyNotesAsOperonTask',
	'defaultEstimateMinutes',
] as const satisfies readonly (keyof OperonSettings)[];

const AUTOMATION_KEYS = [
	'autoCompleteParentWhenAllChildrenTerminal',
	'cascadeCancelToDescendants',
	'newOccurrencePosition',
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
	'fileRepeatDestination',
	'fileRepeatCustomFolder',
	'estimateAutoReallocation',
	'trackerSplitSessionsAtMidnight',
	'reminderCatchUpWindowMinutes',
	'reminderAutoPinDueTasks',
	'pinnedDockAutoPin',
	'pinnedDockAutoUnpinFinished',
] as const satisfies readonly (keyof OperonSettings)[];

export function projectContextSettingsV1(settings: Readonly<OperonSettings>): JsonValue {
	const material = {
		version: CONTEXT_SETTINGS_FINGERPRINT_VERSION_V1,
		taxonomy: {
			defaultPipelineName: settings.defaultPipelineName,
			defaultPriority: settings.defaultPriority,
			pipelines: settings.pipelines.map(pipeline => compactObject({
				id: pipeline.id,
				name: pipeline.name,
				description: pipeline.description,
				statuses: pipeline.statuses.map(status => compactObject({
					id: status.id,
					label: status.label,
					color: status.color,
					pipelineStatusIcon: status.pipelineStatusIcon,
					isFinished: status.isFinished,
					isCancelled: status.isCancelled,
					isScheduledTarget: status.isScheduledTarget,
					isTrackingTarget: status.isTrackingTarget,
					propertyMapping: status.propertyMapping,
				})),
			})),
			priorities: settings.priorities.map(priority => compactObject({
				id: priority.id,
				label: priority.label,
				color: priority.color,
				description: priority.description,
				priorityIcon: priority.priorityIcon,
			})),
			keyMappings: settings.keyMappings.map(mapping => compactObject({
				canonicalKey: mapping.canonicalKey,
				visiblePropertyName: mapping.visiblePropertyName,
				type: mapping.type,
				sync: mapping.sync,
				enabled: mapping.enabled,
				icon: mapping.icon,
				isSystem: mapping.isSystem,
				isInternal: mapping.isInternal,
				customOrder: mapping.customOrder,
				description: mapping.description,
			})),
		},
		indexSemantics: {
			fileTaskTemplateFolder: settings.fileTaskTemplateFolder,
			excludedFolders: [...settings.excludedFolders].sort(compareText),
		},
		filters: settings.filterSets,
		creation: pickSettings(settings, CREATION_KEYS),
		automation: pickSettings(settings, AUTOMATION_KEYS),
		projectSerialScopes: settings.projectSerialScopes,
	};
	return toJsonValueV1(compactJson(material));
}

export function computeContextSettingsFingerprintV1(settings: Readonly<OperonSettings>): string {
	return sha256HexV1(canonicalJsonV1(projectContextSettingsV1(settings)));
}

export function savedFilterQueryDigestV1(
	filterSet: FilterSet,
	scope: { kind: 'exact-file' | 'folder-tree'; path: string } | undefined,
): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1(compactJson({
		filterSet,
		scope: scope ?? null,
	}))));
}

function pickSettings<K extends keyof OperonSettings>(
	settings: Readonly<OperonSettings>,
	keys: readonly K[],
): Record<K, OperonSettings[K]> {
	const output = {} as Record<K, OperonSettings[K]>;
	for (const key of keys) output[key] = settings[key];
	return output;
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (item !== undefined) output[key] = item;
	}
	return output;
}

function compactJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(compactJson);
	if (!value || typeof value !== 'object') return value;
	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (item !== undefined) output[key] = compactJson(item);
	}
	return output;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
