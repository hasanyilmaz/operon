import type { JsonValue } from '../agent-runtime/contracts/v1/primitives';
import type { PresetFavorites } from './preset-favorites';
import {
	applyDynamicFilterTemplatePreferences,
	projectDynamicFilterTemplatePreferences,
	type DynamicFilterTemplatePreferencesProjection,
} from './dynamic-file-task-filter';
import { isFilePropertyColumnKey } from './raw-yaml-property';
import { SETTINGS_BACKUP_GROUPS, type SettingsBackupProfileGroupId } from './settings-backup-compatibility';
import {
	canonicalizeOperonSettingsBackupJson,
	type OperonSettingsBackupDiagnostic,
	type OperonSettingsBackupGroupsV1,
} from './settings-backup-format';
import type {
	ExternalCalendarSource,
	FilterSet,
	KeyMapping,
	OperonSettings,
} from '../types/settings';
import type { CalendarPreset } from '../types/calendar';
import { CANONICAL_KEYS } from '../types/keys';
import type { KanbanPreset } from '../types/kanban';
import type { Pipeline } from '../types/pipeline';
import type { PriorityDefinition } from '../types/priority';
import {
	DEFAULT_SETTINGS,
	FILE_TASK_ARCHIVE_ROUTING_SETTINGS_VERSION,
	migrateSettings,
} from '../types/settings';

export interface OperonSettingsBackupGeneralGroupV1 {
	readonly [key: string]: JsonValue;
}

export interface OperonSettingsBackupPipelinesGroupV1 {
	pipelines: Pipeline[];
	defaultPipelineName: string;
}

export interface OperonSettingsBackupPrioritiesGroupV1 {
	priorities: PriorityDefinition[];
	defaultPriority: string;
}

export interface OperonSettingsBackupSystemKeyOverrideV1 {
	canonicalKey: string;
	visiblePropertyName: string;
	hideInFileTaskView?: boolean;
	icon?: string;
}

export interface OperonSettingsBackupSystemKeyMappingsGroupV1 {
	overrides: OperonSettingsBackupSystemKeyOverrideV1[];
}

export interface OperonSettingsBackupCustomKeysGroupV1 {
	customKeys: KeyMapping[];
}

export interface OperonSettingsBackupFiltersGroupV1 {
	filterSets: FilterSet[];
	dynamicTemplates?: DynamicFilterTemplatePreferencesProjection;
}

export interface OperonSettingsBackupCalendarGroupV1 {
	calendarPresets: CalendarPreset[];
	calendarDefaultPresetId: string | null;
	calendarMobileDefaultSourcePresetId: string | null;
	calendarMobileAgendaSourcePresetId: string | null;
	calendarMobileDaySourcePresetId: string | null;
	calendarMobileTwoDaySourcePresetId: string | null;
	calendarMobileThreeDaySourcePresetId: string | null;
}

export interface OperonSettingsBackupKanbanGroupV1 {
	kanbanPresets: KanbanPreset[];
	kanbanDefaultPresetId: string | null;
}

export interface OperonSettingsBackupPresetFavoritesGroupV1 {
	presetFavorites: PresetFavorites;
}

export interface OperonSettingsBackupTableGlobalGroupV1 {
	tableDefaultFolder?: string;
	tableEmbedVisibleRows: OperonSettings['tableEmbedVisibleRows'];
	tableEmbedDefaultWidthPercent?: OperonSettings['tableEmbedDefaultWidthPercent'];
	tableShowLineNumbers: boolean;
	tableShowTaskIcon: boolean;
	tableShowTaskDataTypeIcon: boolean;
	tableGanttDefaultSplitPercent: OperonSettings['tableGanttDefaultSplitPercent'];
	tableGanttDefaultScale: OperonSettings['tableGanttDefaultScale'];
	tableGanttDefaultUnitWidthMultiplier: OperonSettings['tableGanttDefaultUnitWidthMultiplier'];
	tableGanttDefaultBarColorMode: OperonSettings['tableGanttDefaultBarColorMode'];
	tableGanttShowToday: boolean;
	tableGanttShowWeekends: boolean;
	tableGanttShowDateStartedMarkers: boolean;
	tableGanttShowDateScheduledMarkers: boolean;
	tableGanttShowDateDueMarkers: boolean;
	tableGanttFocusTodayOnOpen: boolean;
	tableGanttBarClickAction: OperonSettings['tableGanttBarClickAction'];
	tableGanttBarRightClickAction: OperonSettings['tableGanttBarRightClickAction'];
	tableGanttOneDayClickBehavior: OperonSettings['tableGanttOneDayClickBehavior'];
	tableGanttMoveOpenDescendantsWithParent: boolean;
}

export interface OperonSettingsBackupExternalCalendarsGroupV1 {
	externalCalendars: ExternalCalendarSource[];
}

export interface OperonSettingsBackupGroupPayloadsV1 {
	general: OperonSettingsBackupGeneralGroupV1;
	pipelines: OperonSettingsBackupPipelinesGroupV1;
	priorities: OperonSettingsBackupPrioritiesGroupV1;
	'system-key-mappings': OperonSettingsBackupSystemKeyMappingsGroupV1;
	'custom-keys': OperonSettingsBackupCustomKeysGroupV1;
	filters: OperonSettingsBackupFiltersGroupV1;
	calendar: OperonSettingsBackupCalendarGroupV1;
	kanban: OperonSettingsBackupKanbanGroupV1;
	'preset-favorites': OperonSettingsBackupPresetFavoritesGroupV1;
	'table-global': OperonSettingsBackupTableGlobalGroupV1;
	'external-calendars': OperonSettingsBackupExternalCalendarsGroupV1;
}

export interface OperonSettingsBackupGroupValidationContextV1 {
	targetSettings?: OperonSettings;
	/** Source provenance controls narrow compatibility validation for retired archive controls. */
	sourceSettingsVersion?: number;
	/** JSON-only restore keeps target Table favorites and treats source Table references as advisory. */
	ignoreTableFavoriteReferences?: boolean;
}

export interface OperonSettingsBackupGroupValidationResultV1 {
	ok: boolean;
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>;
	diagnostics: OperonSettingsBackupDiagnostic[];
}

export interface OperonSettingsBackupGroupCodecV1<K extends SettingsBackupProfileGroupId = SettingsBackupProfileGroupId> {
	readonly group: K;
	readonly codecVersion: 1;
	decode(data: unknown, path: string): {
		value: OperonSettingsBackupGroupPayloadsV1[K] | null;
		diagnostics: OperonSettingsBackupDiagnostic[];
	};
}

type AnyObject = Record<string, unknown>;
type Decoder = (data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]) => AnyObject | null;

const RESERVED_DYNAMIC_FILTER_IDS = new Set(['fs_dynamic_file_task', 'fs_dynamic_subtasks_filter']);
const GENERAL_KEYS = new Set(
	SETTINGS_BACKUP_GROUPS.find(group => group.id === 'general')?.settingKeys.map(String) ?? [],
);
const LEGACY_ARCHIVE_ROUTING_KEYS = new Set([
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchivePipelineLocations',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
]);
const BUILT_IN_FILTER_FIELDS = new Set([
	...CANONICAL_KEYS.map(key => key.name),
	'checkbox',
	'tags',
	'description',
	'pinned',
	'happensOn',
	'folders',
	'projectTree',
	'projectSerialScope',
]);
const BUILT_IN_KANBAN_FIELDS = new Set([
	'alphabetical', 'priority', 'tags', 'contexts', 'assignees', 'dateDue', 'dateScheduled',
	'dateStarted', 'dateCompleted', 'dateCancelled', 'datetimeCreated', 'datetimeModified',
	'progress', 'estimate', 'duration', 'totalDuration', 'totalEstimate',
]);

export const SETTINGS_BACKUP_GROUP_CODECS_V1: Readonly<{
	[K in SettingsBackupProfileGroupId]: OperonSettingsBackupGroupCodecV1<K>;
}> = Object.freeze({
	general: codec('general', decodeGeneral),
	pipelines: codec('pipelines', decodePipelines),
	priorities: codec('priorities', decodePriorities),
	'system-key-mappings': codec('system-key-mappings', decodeSystemMappings),
	'custom-keys': codec('custom-keys', decodeCustomKeys),
	filters: codec('filters', decodeFilters),
	calendar: codec('calendar', decodeCalendar),
	kanban: codec('kanban', decodeKanban),
	'preset-favorites': codec('preset-favorites', decodeFavorites),
	'table-global': codec('table-global', decodeTableGlobal),
	'external-calendars': codec('external-calendars', decodeExternalCalendars),
});

export function validateOperonSettingsBackupGroupsV1(
	groups: Partial<OperonSettingsBackupGroupsV1>,
	context: OperonSettingsBackupGroupValidationContextV1 = {},
): OperonSettingsBackupGroupValidationResultV1 {
	const diagnostics: OperonSettingsBackupDiagnostic[] = [];
	const payloads: Partial<OperonSettingsBackupGroupPayloadsV1> = {};
	for (const groupName of Object.keys(groups)) {
		if (!(groupName in SETTINGS_BACKUP_GROUP_CODECS_V1)) {
			diagnostics.push(error(`$.body.groups.${groupName}`, 'unknown-field', `Unknown settings backup group: ${groupName}.`));
			continue;
		}
		const name = groupName as SettingsBackupProfileGroupId;
		const versioned = groups[name];
		if (!versioned) continue;
		const path = `$.body.groups.${name}`;
		if (versioned.codecVersion !== 1) {
			diagnostics.push(error(`${path}.codecVersion`, 'unsupported-version', `Unsupported ${name} codec version: ${versioned.codecVersion}.`));
			continue;
		}
		const decoded = SETTINGS_BACKUP_GROUP_CODECS_V1[name].decode(versioned.data, `${path}.data`);
		diagnostics.push(...decoded.diagnostics);
		if (decoded.value) assignPayload(payloads, name, decoded.value);
	}
	validateReferences(payloads, context, diagnostics);
	validateCanonicalProjection(payloads, context, diagnostics);
	return { ok: !diagnostics.some(item => item.severity === 'error'), payloads, diagnostics };
}

function codec<K extends SettingsBackupProfileGroupId>(group: K, decoder: Decoder): OperonSettingsBackupGroupCodecV1<K> {
	return Object.freeze({
		group,
		codecVersion: 1 as const,
		decode(data: unknown, path: string) {
			const diagnostics: OperonSettingsBackupDiagnostic[] = [];
			const value = decoder(data, path, diagnostics);
			return {
				value: diagnostics.some(item => item.severity === 'error')
					? null
					: value as OperonSettingsBackupGroupPayloadsV1[K] | null,
				diagnostics,
			};
		},
	});
}

function assignPayload<K extends SettingsBackupProfileGroupId>(
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	group: K,
	value: OperonSettingsBackupGroupPayloadsV1[K],
): void {
	(payloads as Record<SettingsBackupProfileGroupId, unknown>)[group] = value;
}

function decodeGeneral(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, [...GENERAL_KEYS], [], diagnostics);
	if (!object) return null;
	for (const [key, value] of Object.entries(object)) {
		if (!isJsonValue(value)) diagnostics.push(error(`${path}.${key}`, 'type', 'General setting must be JSON-safe.'));
	}
	return object;
}

function decodePipelines(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['pipelines', 'defaultPipelineName'], ['pipelines', 'defaultPipelineName'], diagnostics);
	if (!object) return null;
	const pipelines = inspectArray(object.pipelines, `${path}.pipelines`, diagnostics);
	if (!pipelines) return object;
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const [index, raw] of pipelines.entries()) {
		const itemPath = `${path}.pipelines[${index}]`;
		const pipeline = inspectObject(raw, itemPath, ['id', 'name', 'description', 'statuses'], ['id', 'name', 'statuses'], diagnostics);
		if (!pipeline) continue;
		validateFieldTypes(pipeline, itemPath, { id: 'string', name: 'string', description: 'string', statuses: 'array' }, diagnostics);
		const id = requiredString(pipeline.id, `${itemPath}.id`, diagnostics);
		const name = requiredString(pipeline.name, `${itemPath}.name`, diagnostics);
		checkDuplicate(id, ids, `${itemPath}.id`, 'pipeline ID', diagnostics);
		checkDuplicate(name?.toLocaleLowerCase('en-US') ?? null, names, `${itemPath}.name`, 'pipeline name', diagnostics);
		const statuses = inspectArray(pipeline.statuses, `${itemPath}.statuses`, diagnostics);
		const statusIds = new Set<string>();
		const statusNames = new Set<string>();
		for (const [statusIndex, rawStatus] of (statuses ?? []).entries()) {
			const statusPath = `${itemPath}.statuses[${statusIndex}]`;
			const status = inspectObject(rawStatus, statusPath, [
				'id', 'label', 'color', 'pipelineStatusIcon', 'isFinished', 'isCancelled',
				'isScheduledTarget', 'isTrackingTarget', 'propertyMapping',
			], ['id', 'label', 'color', 'isFinished', 'isCancelled', 'isScheduledTarget', 'isTrackingTarget', 'propertyMapping'], diagnostics);
			if (!status) continue;
			validateFieldTypes(status, statusPath, {
				id: 'string', label: 'string', color: 'string', pipelineStatusIcon: 'string',
				isFinished: 'boolean', isCancelled: 'boolean', isScheduledTarget: 'boolean',
				isTrackingTarget: 'boolean', propertyMapping: 'nullable-string',
			}, diagnostics);
			const statusId = requiredString(status.id, `${statusPath}.id`, diagnostics);
			const label = requiredString(status.label, `${statusPath}.label`, diagnostics);
			checkDuplicate(statusId, statusIds, `${statusPath}.id`, 'status ID', diagnostics);
			checkDuplicate(label?.toLocaleLowerCase('en-US') ?? null, statusNames, `${statusPath}.label`, 'status name', diagnostics);
		}
	}
	const defaultName = requiredString(object.defaultPipelineName, `${path}.defaultPipelineName`, diagnostics);
	if (defaultName && !pipelines.some(raw => isObject(raw) && raw.name === defaultName)) {
		diagnostics.push(error(`${path}.defaultPipelineName`, 'value', `Default pipeline does not exist: ${defaultName}.`));
	}
	return object;
}

function decodePriorities(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['priorities', 'defaultPriority'], ['priorities', 'defaultPriority'], diagnostics);
	if (!object) return null;
	const priorities = inspectArray(object.priorities, `${path}.priorities`, diagnostics);
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const [index, raw] of (priorities ?? []).entries()) {
		const itemPath = `${path}.priorities[${index}]`;
		const item = inspectObject(raw, itemPath, ['id', 'label', 'color', 'description', 'priorityIcon'], ['id', 'label', 'color'], diagnostics);
		if (!item) continue;
		validateFieldTypes(item, itemPath, { id: 'string', label: 'string', color: 'string', description: 'string', priorityIcon: 'string' }, diagnostics);
		checkDuplicate(requiredString(item.id, `${itemPath}.id`, diagnostics), ids, `${itemPath}.id`, 'priority ID', diagnostics);
		const label = requiredString(item.label, `${itemPath}.label`, diagnostics);
		checkDuplicate(label?.toLocaleLowerCase('en-US') ?? null, names, `${itemPath}.label`, 'priority name', diagnostics);
	}
	if (typeof object.defaultPriority !== 'string') diagnostics.push(error(`${path}.defaultPriority`, 'type', 'defaultPriority must be a string.'));
	else if (object.defaultPriority && !(priorities ?? []).some(raw => isObject(raw) && raw.label === object.defaultPriority)) {
		diagnostics.push(error(`${path}.defaultPriority`, 'value', `Default priority does not exist: ${object.defaultPriority}.`));
	}
	return object;
}

function decodeSystemMappings(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['overrides'], ['overrides'], diagnostics);
	if (!object) return null;
	const mappings = inspectArray(object.overrides, `${path}.overrides`, diagnostics);
	const canonicalKeys = new Set<string>();
	const visibleNames = new Set<string>();
	for (const [index, raw] of (mappings ?? []).entries()) {
		const itemPath = `${path}.overrides[${index}]`;
		const item = inspectObject(raw, itemPath, ['canonicalKey', 'visiblePropertyName', 'hideInFileTaskView', 'icon'], ['canonicalKey', 'visiblePropertyName'], diagnostics);
		if (!item) continue;
		validateFieldTypes(item, itemPath, { canonicalKey: 'string', visiblePropertyName: 'string', hideInFileTaskView: 'boolean', icon: 'string' }, diagnostics);
		const canonical = requiredString(item.canonicalKey, `${itemPath}.canonicalKey`, diagnostics);
		const visible = requiredString(item.visiblePropertyName, `${itemPath}.visiblePropertyName`, diagnostics);
		checkDuplicate(canonical?.toLocaleLowerCase('en-US') ?? null, canonicalKeys, `${itemPath}.canonicalKey`, 'canonical key', diagnostics);
		checkDuplicate(visible?.toLocaleLowerCase('en-US') ?? null, visibleNames, `${itemPath}.visiblePropertyName`, 'visible property name', diagnostics);
		if (canonical && !CANONICAL_KEYS.some(key => key.name === canonical)) diagnostics.push(error(`${itemPath}.canonicalKey`, 'value', `Unknown system canonical key: ${canonical}.`));
	}
	return object;
}

function decodeCustomKeys(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['customKeys'], ['customKeys'], diagnostics);
	if (!object) return null;
	const mappings = inspectArray(object.customKeys, `${path}.customKeys`, diagnostics);
	const canonicalKeys = new Set<string>();
	const visibleNames = new Set<string>();
	for (const [index, raw] of (mappings ?? []).entries()) {
		const itemPath = `${path}.customKeys[${index}]`;
		const item = inspectObject(raw, itemPath, [
			'canonicalKey', 'visiblePropertyName', 'type', 'sync', 'enabled', 'hideInFileTaskView', 'icon',
			'isSystem', 'isInternal', 'customOrder', 'showInEditor', 'showInCreator', 'showInChips',
			'showInKanbanSwimlane', 'description',
		], ['canonicalKey', 'visiblePropertyName', 'type', 'sync', 'enabled', 'isSystem'], diagnostics);
		if (!item) continue;
		validateFieldTypes(item, itemPath, {
			canonicalKey: 'string', visiblePropertyName: 'string', type: 'string', sync: 'string', enabled: 'boolean',
			hideInFileTaskView: 'boolean', icon: 'string', isSystem: 'boolean', isInternal: 'boolean', customOrder: 'number',
			showInEditor: 'boolean', showInCreator: 'boolean', showInChips: 'boolean', showInKanbanSwimlane: 'boolean', description: 'string',
		}, diagnostics);
		const canonical = requiredString(item.canonicalKey, `${itemPath}.canonicalKey`, diagnostics);
		const visible = requiredString(item.visiblePropertyName, `${itemPath}.visiblePropertyName`, diagnostics);
		checkDuplicate(canonical?.toLocaleLowerCase('en-US') ?? null, canonicalKeys, `${itemPath}.canonicalKey`, 'canonical key', diagnostics);
		checkDuplicate(visible?.toLocaleLowerCase('en-US') ?? null, visibleNames, `${itemPath}.visiblePropertyName`, 'visible property name', diagnostics);
		if (!['text', 'number', 'date', 'datetime', 'list', 'checkbox'].includes(String(item.type))) diagnostics.push(error(`${itemPath}.type`, 'value', `Unsupported Custom Key type: ${String(item.type)}.`));
		if (!['yes', 'no', 'auto'].includes(String(item.sync))) diagnostics.push(error(`${itemPath}.sync`, 'value', `Unsupported Custom Key sync mode: ${String(item.sync)}.`));
		if (item.isSystem !== false) diagnostics.push(error(`${itemPath}.isSystem`, 'value', 'Custom key isSystem must be false.'));
	}
	return object;
}

function decodeFilters(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['filterSets', 'dynamicTemplates'], ['filterSets'], diagnostics);
	if (!object) return null;
	const filters = inspectArray(object.filterSets, `${path}.filterSets`, diagnostics);
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const [index, raw] of (filters ?? []).entries()) {
		const itemPath = `${path}.filterSets[${index}]`;
		const item = inspectObject(raw, itemPath, [
			'id', 'name', 'icon', 'rootGroup', 'sorts', 'subgroupBy', 'subgroupOrder', 'matchLogic',
			'conditions', 'sortBy', 'sortOrder', 'groupBy', 'groupOrder',
		], ['id', 'name', 'rootGroup', 'sorts', 'matchLogic', 'conditions'], diagnostics);
		if (!item) continue;
		validateFieldTypes(item, itemPath, {
			id: 'string', name: 'string', icon: 'string', rootGroup: 'object', sorts: 'array', subgroupBy: 'string',
			subgroupOrder: 'string', matchLogic: 'string', conditions: 'array', sortBy: 'string', sortOrder: 'string',
			groupBy: 'string', groupOrder: 'string',
		}, diagnostics);
		const id = requiredString(item.id, `${itemPath}.id`, diagnostics);
		const name = requiredString(item.name, `${itemPath}.name`, diagnostics);
		checkDuplicate(id, ids, `${itemPath}.id`, 'filter ID', diagnostics);
		checkDuplicate(name?.toLocaleLowerCase('en-US') ?? null, names, `${itemPath}.name`, 'filter name', diagnostics);
		if (id && RESERVED_DYNAMIC_FILTER_IDS.has(id)) diagnostics.push(error(`${itemPath}.id`, 'value', `Reserved dynamic filter cannot be imported: ${id}.`));
		validateFilterNode(item.rootGroup, `${itemPath}.rootGroup`, diagnostics);
		const conditions = inspectArray(item.conditions, `${itemPath}.conditions`, diagnostics);
		for (const [conditionIndex, condition] of (conditions ?? []).entries()) validateFilterCondition(condition, `${itemPath}.conditions[${conditionIndex}]`, diagnostics);
		const sorts = inspectArray(item.sorts, `${itemPath}.sorts`, diagnostics);
		for (const [sortIndex, rawSort] of (sorts ?? []).entries()) {
			const sortPath = `${itemPath}.sorts[${sortIndex}]`;
			const sort = inspectObject(rawSort, sortPath, ['field', 'order'], ['field', 'order'], diagnostics);
			if (sort) validateFieldTypes(sort, sortPath, { field: 'string', order: 'string' }, diagnostics);
		}
	}
	if (object.dynamicTemplates !== undefined) {
		decodeDynamicTemplates(object.dynamicTemplates, `${path}.dynamicTemplates`, diagnostics);
	}
	return object;
}

function decodeDynamicTemplates(
	data: unknown,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): AnyObject | null {
	const object = inspectObject(data, path, ['fileTask', 'subtasks'], ['fileTask', 'subtasks'], diagnostics);
	if (!object) return null;
	for (const key of ['fileTask', 'subtasks'] as const) {
		decodeDynamicTemplatePreferences(object[key], `${path}.${key}`, diagnostics);
	}
	return object;
}

function decodeDynamicTemplatePreferences(
	data: unknown,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): AnyObject | null {
	const keys = ['name', 'icon', 'sorts', 'groupBy', 'groupOrder', 'subgroupBy', 'subgroupOrder'];
	const object = inspectObject(data, path, keys, ['name', 'icon', 'sorts'], diagnostics);
	if (!object) return null;
	validateFieldTypes(object, path, {
		name: 'string', icon: 'string', sorts: 'array', groupBy: 'string', groupOrder: 'string',
		subgroupBy: 'string', subgroupOrder: 'string',
	}, diagnostics);
	requiredString(object.name, `${path}.name`, diagnostics);
	requiredString(object.icon, `${path}.icon`, diagnostics);
	for (const key of ['groupOrder', 'subgroupOrder'] as const) {
		if (object[key] !== undefined && object[key] !== 'asc' && object[key] !== 'desc') {
			diagnostics.push(error(`${path}.${key}`, 'value', `${key} must be asc or desc.`));
		}
	}
	const sorts = inspectArray(object.sorts, `${path}.sorts`, diagnostics);
	for (const [index, rawSort] of (sorts ?? []).entries()) {
		const sortPath = `${path}.sorts[${index}]`;
		const sort = inspectObject(rawSort, sortPath, ['field', 'order'], ['field', 'order'], diagnostics);
		if (!sort) continue;
		validateFieldTypes(sort, sortPath, { field: 'string', order: 'string' }, diagnostics);
		requiredString(sort.field, `${sortPath}.field`, diagnostics);
		if (sort.order !== 'asc' && sort.order !== 'desc') {
			diagnostics.push(error(`${sortPath}.order`, 'value', 'Sort order must be asc or desc.'));
		}
	}
	return object;
}

function decodeCalendar(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const keys = ['calendarPresets', 'calendarDefaultPresetId', 'calendarMobileDefaultSourcePresetId', 'calendarMobileAgendaSourcePresetId', 'calendarMobileDaySourcePresetId', 'calendarMobileTwoDaySourcePresetId', 'calendarMobileThreeDaySourcePresetId'];
	const object = inspectObject(data, path, keys, keys, diagnostics);
	if (!object) return null;
	const presets = inspectArray(object.calendarPresets, `${path}.calendarPresets`, diagnostics);
	validateNamedPresets(presets, `${path}.calendarPresets`, [
		'id', 'name', 'surfaceType', 'weekCount', 'focusedWeekNumber', 'dayCount', 'todayPosition', 'slotMinutes',
		'filterSetId', 'navigationMode', 'showAllDayLane', 'showDueMarkers', 'showWeekends', 'showProjectedOccurrences',
		'showExternalCalendars', 'hiddenTimeStart', 'hiddenTimeEnd', 'colorSource', 'appearanceModeLight',
		'appearanceModeDark', 'externalCalendarVisibility',
	], diagnostics);
	for (const [index, raw] of (presets ?? []).entries()) if (isObject(raw)) validateFieldTypes(raw, `${path}.calendarPresets[${index}]`, {
		id: 'string', name: 'string', surfaceType: 'string', weekCount: 'number', focusedWeekNumber: 'number', dayCount: 'number',
		todayPosition: 'number', slotMinutes: 'number', filterSetId: 'nullable-string', navigationMode: 'string', showAllDayLane: 'boolean',
		showDueMarkers: 'boolean', showWeekends: 'boolean', showProjectedOccurrences: 'boolean', showExternalCalendars: 'boolean',
		hiddenTimeStart: 'string', hiddenTimeEnd: 'string', colorSource: 'string', appearanceModeLight: 'string', appearanceModeDark: 'string',
		externalCalendarVisibility: 'object',
	}, diagnostics);
	for (const [index, raw] of (presets ?? []).entries()) {
		if (!isObject(raw) || !isObject(raw.externalCalendarVisibility)) continue;
		for (const [sourceId, visible] of Object.entries(raw.externalCalendarVisibility)) {
			if (typeof visible !== 'boolean') diagnostics.push(error(`${path}.calendarPresets[${index}].externalCalendarVisibility.${sourceId}`, 'type', 'External calendar visibility must be a boolean.'));
		}
	}
	validatePresetDefault(object.calendarDefaultPresetId, presets, `${path}.calendarDefaultPresetId`, diagnostics);
	for (const key of keys.slice(2)) validatePresetDefault(object[key], presets, `${path}.${key}`, diagnostics);
	return object;
}

function decodeKanban(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['kanbanPresets', 'kanbanDefaultPresetId'], ['kanbanPresets', 'kanbanDefaultPresetId'], diagnostics);
	if (!object) return null;
	const presets = inspectArray(object.kanbanPresets, `${path}.kanbanPresets`, diagnostics);
	validateNamedPresets(presets, `${path}.kanbanPresets`, [
		'id', 'name', 'pipelineId', 'filterSetId', 'swimlaneBy', 'colorSource', 'cardImageSource', 'appearanceModeLight',
		'appearanceModeDark', 'collapseEmptyColumns', 'collapseEmptySwimlanes', 'autoCollapseFinishedColumns',
		'sortMode', 'sortRules', 'columnSortOverrides',
	], diagnostics);
	for (const [index, raw] of (presets ?? []).entries()) if (isObject(raw)) validateFieldTypes(raw, `${path}.kanbanPresets[${index}]`, {
		id: 'string', name: 'string', pipelineId: 'nullable-string', filterSetId: 'nullable-string', swimlaneBy: 'nullable-string',
		colorSource: 'string', cardImageSource: 'string', appearanceModeLight: 'string', appearanceModeDark: 'string', collapseEmptyColumns: 'boolean',
		collapseEmptySwimlanes: 'boolean', autoCollapseFinishedColumns: 'boolean', sortMode: 'string', sortRules: 'array', columnSortOverrides: 'array',
	}, diagnostics);
	for (const [index, raw] of (presets ?? []).entries()) {
		if (!isObject(raw)) continue;
		const rules = inspectArray(raw.sortRules, `${path}.kanbanPresets[${index}].sortRules`, diagnostics);
		for (const [ruleIndex, rawRule] of (rules ?? []).entries()) {
			const rulePath = `${path}.kanbanPresets[${index}].sortRules[${ruleIndex}]`;
			const rule = inspectObject(rawRule, rulePath, ['field', 'direction', 'empty'], ['field', 'direction', 'empty'], diagnostics);
			if (rule) validateFieldTypes(rule, rulePath, { field: 'string', direction: 'string', empty: 'string' }, diagnostics);
		}
		const overrides = raw.columnSortOverrides === undefined
			? []
			: inspectArray(raw.columnSortOverrides, `${path}.kanbanPresets[${index}].columnSortOverrides`, diagnostics);
		for (const [overrideIndex, rawOverride] of (overrides ?? []).entries()) {
			const overridePath = `${path}.kanbanPresets[${index}].columnSortOverrides[${overrideIndex}]`;
			const override = inspectObject(rawOverride, overridePath, ['statusId', 'sortMode', 'sortRules'], ['statusId', 'sortMode', 'sortRules'], diagnostics);
			if (!override) continue;
			validateFieldTypes(override, overridePath, { statusId: 'string', sortMode: 'string', sortRules: 'array' }, diagnostics);
			const overrideRules = inspectArray(override.sortRules, `${overridePath}.sortRules`, diagnostics);
			for (const [ruleIndex, rawRule] of (overrideRules ?? []).entries()) {
				const rulePath = `${overridePath}.sortRules[${ruleIndex}]`;
				const rule = inspectObject(rawRule, rulePath, ['field', 'direction', 'empty'], ['field', 'direction', 'empty'], diagnostics);
				if (rule) validateFieldTypes(rule, rulePath, { field: 'string', direction: 'string', empty: 'string' }, diagnostics);
			}
		}
	}
	validatePresetDefault(object.kanbanDefaultPresetId, presets, `${path}.kanbanDefaultPresetId`, diagnostics);
	return object;
}

function decodeFavorites(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['presetFavorites'], ['presetFavorites'], diagnostics);
	if (!object) return null;
	const favorites = inspectObject(object.presetFavorites, `${path}.presetFavorites`, ['table', 'calendar', 'kanban', 'filter'], ['table', 'calendar', 'kanban', 'filter'], diagnostics);
	for (const key of ['table', 'calendar', 'kanban', 'filter']) {
		const values = inspectArray(favorites?.[key], `${path}.presetFavorites.${key}`, diagnostics);
		validateUniqueStringArray(values, `${path}.presetFavorites.${key}`, diagnostics);
	}
	return object;
}

function decodeTableGlobal(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const keys = [
		'tableDefaultFolder', 'tableEmbedVisibleRows', 'tableEmbedDefaultWidthPercent', 'tableShowLineNumbers',
		'tableShowTaskIcon', 'tableShowTaskDataTypeIcon', 'tableShowTaskTypeIcon',
		'tableGanttDefaultSplitPercent', 'tableGanttDefaultScale', 'tableGanttDefaultUnitWidthMultiplier',
		'tableGanttDefaultBarColorMode', 'tableGanttShowToday', 'tableGanttShowWeekends',
		'tableGanttShowDateStartedMarkers', 'tableGanttShowDateScheduledMarkers', 'tableGanttShowDateDueMarkers',
		'tableGanttFocusTodayOnOpen', 'tableGanttBarClickAction', 'tableGanttBarRightClickAction', 'tableGanttOneDayClickBehavior',
		'tableGanttMoveOpenDescendantsWithParent',
	];
	const requiredKeys = ['tableEmbedVisibleRows', 'tableShowLineNumbers', 'tableShowTaskIcon'];
	const object = inspectObject(data, path, keys, requiredKeys, diagnostics);
	if (!object) return null;
	if ('tableDefaultFolder' in object && typeof object.tableDefaultFolder !== 'string') {
		diagnostics.push(error(`${path}.tableDefaultFolder`, 'type', 'tableDefaultFolder must be a string.'));
	}
	if (typeof object.tableEmbedVisibleRows !== 'number' || !Number.isFinite(object.tableEmbedVisibleRows)) diagnostics.push(error(`${path}.tableEmbedVisibleRows`, 'type', 'tableEmbedVisibleRows must be a finite number.'));
	if ('tableEmbedDefaultWidthPercent' in object && (typeof object.tableEmbedDefaultWidthPercent !== 'number' || !Number.isFinite(object.tableEmbedDefaultWidthPercent))) {
		diagnostics.push(error(`${path}.tableEmbedDefaultWidthPercent`, 'type', 'tableEmbedDefaultWidthPercent must be a finite number.'));
	}
	for (const key of ['tableShowLineNumbers', 'tableShowTaskIcon']) if (typeof object[key] !== 'boolean') diagnostics.push(error(`${path}.${key}`, 'type', `${key} must be a boolean.`));
	if (typeof object.tableShowTaskDataTypeIcon !== 'boolean' && typeof object.tableShowTaskTypeIcon !== 'boolean') {
		diagnostics.push(error(`${path}.tableShowTaskDataTypeIcon`, 'type', 'tableShowTaskDataTypeIcon must be a boolean.'));
	} else if (typeof object.tableShowTaskDataTypeIcon !== 'boolean') {
		object.tableShowTaskDataTypeIcon = object.tableShowTaskTypeIcon;
	}
	delete object.tableShowTaskTypeIcon;
	if ('tableGanttDefaultSplitPercent' in object && ![50, 60, 70, 80].includes(object.tableGanttDefaultSplitPercent as number)) diagnostics.push(error(`${path}.tableGanttDefaultSplitPercent`, 'value', 'tableGanttDefaultSplitPercent must be 50, 60, 70, or 80.'));
	if ('tableGanttDefaultScale' in object && !['day', 'week'].includes(object.tableGanttDefaultScale as string)) diagnostics.push(error(`${path}.tableGanttDefaultScale`, 'value', 'tableGanttDefaultScale must be day or week.'));
	if ('tableGanttDefaultUnitWidthMultiplier' in object && ![0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(object.tableGanttDefaultUnitWidthMultiplier as number)) diagnostics.push(error(`${path}.tableGanttDefaultUnitWidthMultiplier`, 'value', 'tableGanttDefaultUnitWidthMultiplier is invalid.'));
	if ('tableGanttDefaultBarColorMode' in object && !['noColor', 'taskColor', 'statusColor', 'priorityColor', 'randomColors'].includes(object.tableGanttDefaultBarColorMode as string)) diagnostics.push(error(`${path}.tableGanttDefaultBarColorMode`, 'value', 'tableGanttDefaultBarColorMode is invalid.'));
	for (const key of [
		'tableGanttShowToday',
		'tableGanttShowWeekends',
		'tableGanttShowDateStartedMarkers',
		'tableGanttShowDateScheduledMarkers',
		'tableGanttShowDateDueMarkers',
		'tableGanttFocusTodayOnOpen',
		'tableGanttMoveOpenDescendantsWithParent',
	]) if (key in object && typeof object[key] !== 'boolean') diagnostics.push(error(`${path}.${key}`, 'type', `${key} must be a boolean.`));
	for (const key of ['tableGanttBarClickAction', 'tableGanttBarRightClickAction']) {
		if (key in object && !['none', 'openTaskEditor', 'goToSource', 'contextMenu'].includes(object[key] as string)) {
			diagnostics.push(error(`${path}.${key}`, 'value', `${key} is invalid.`));
		}
	}
	if ('tableGanttOneDayClickBehavior' in object && !['scheduled', 'dateRange'].includes(object.tableGanttOneDayClickBehavior as string)) diagnostics.push(error(`${path}.tableGanttOneDayClickBehavior`, 'value', 'tableGanttOneDayClickBehavior is invalid.'));
	return object;
}

function decodeExternalCalendars(data: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): AnyObject | null {
	const object = inspectObject(data, path, ['externalCalendars'], ['externalCalendars'], diagnostics);
	if (!object) return null;
	const calendars = inspectArray(object.externalCalendars, `${path}.externalCalendars`, diagnostics);
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const [index, raw] of (calendars ?? []).entries()) {
		const itemPath = `${path}.externalCalendars[${index}]`;
		const item = inspectObject(raw, itemPath, ['id', 'type', 'name', 'url', 'color', 'enabled', 'hideCreatedEvents', 'refreshIntervalHours'], ['id', 'type', 'name', 'url', 'color', 'enabled', 'hideCreatedEvents', 'refreshIntervalHours'], diagnostics);
		if (!item) continue;
		validateFieldTypes(item, itemPath, { id: 'string', type: 'string', name: 'string', url: 'string', color: 'string', enabled: 'boolean', hideCreatedEvents: 'boolean', refreshIntervalHours: 'number' }, diagnostics);
		const id = requiredString(item.id, `${itemPath}.id`, diagnostics);
		const name = requiredString(item.name, `${itemPath}.name`, diagnostics);
		checkDuplicate(id, ids, `${itemPath}.id`, 'external calendar ID', diagnostics);
		checkDuplicate(name?.toLocaleLowerCase('en-US') ?? null, names, `${itemPath}.name`, 'external calendar name', diagnostics);
		if (item.type !== 'ics') diagnostics.push(error(`${itemPath}.type`, 'value', 'External calendar type must be ics.'));
	}
	return object;
}

function validateReferences(
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	context: OperonSettingsBackupGroupValidationContextV1,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	const target = context.targetSettings;
	const pipelines = payloads.pipelines?.pipelines ?? target?.pipelines;
	const filters = payloads.filters?.filterSets ?? target?.filterSets;
	const customKeys = payloads['custom-keys']?.customKeys ?? target?.keyMappings.filter(mapping => mapping.isSystem === false);
	const calendars = payloads.calendar?.calendarPresets ?? target?.calendarPresets;
	const kanbans = payloads.kanban?.kanbanPresets ?? target?.kanbanPresets;
	const pipelineIds = pipelines ? new Set(pipelines.map(item => item.id)) : null;
	const filterIds = filters ? new Set(filters.map(item => item.id)) : null;
	const customCanonicalKeys = customKeys ? new Set(customKeys.map(item => item.canonicalKey)) : null;
	const baselineSystemMappings = (target ?? DEFAULT_SETTINGS).keyMappings.filter(mapping => mapping.isSystem !== false);
	const systemOverrides = new Map(
		(payloads['system-key-mappings']?.overrides ?? []).map(mapping => [mapping.canonicalKey, mapping]),
	);
	const systemVisibleNames = new Set(baselineSystemMappings.map(mapping => (
		systemOverrides.get(mapping.canonicalKey)?.visiblePropertyName ?? mapping.visiblePropertyName
	).toLocaleLowerCase('en-US')));
	const systemCanonicalKeys = new Set(CANONICAL_KEYS.map(key => key.name.toLocaleLowerCase('en-US')));
	if (payloads['custom-keys']) {
		for (const [index, mapping] of payloads['custom-keys'].customKeys.entries()) {
			const base = `$.body.groups.custom-keys.data.customKeys[${index}]`;
			if (systemCanonicalKeys.has(mapping.canonicalKey.toLocaleLowerCase('en-US'))) diagnostics.push(error(`${base}.canonicalKey`, 'value', `Custom canonical key collides with a system key: ${mapping.canonicalKey}.`));
			if (systemVisibleNames.has(mapping.visiblePropertyName.toLocaleLowerCase('en-US'))) diagnostics.push(error(`${base}.visiblePropertyName`, 'value', `Custom visible property name collides with a system key: ${mapping.visiblePropertyName}.`));
		}
	}

	for (const [index, filter] of (payloads.filters?.filterSets ?? []).entries()) {
		for (const reference of collectFilterFieldReferences(filter)) {
			validateFilterFieldReference(reference, `$.body.groups.filters.data.filterSets[${index}]`, customCanonicalKeys, diagnostics);
		}
	}
	const dynamicTemplates = payloads.filters?.dynamicTemplates;
	if (dynamicTemplates) {
		for (const key of ['fileTask', 'subtasks'] as const) {
			const preferences = dynamicTemplates[key];
			const base = `$.body.groups.filters.data.dynamicTemplates.${key}`;
			for (const [index, sort] of preferences.sorts.entries()) {
				validateFilterFieldReference(sort.field, `${base}.sorts[${index}].field`, customCanonicalKeys, diagnostics);
			}
			if (preferences.groupBy) validateFilterFieldReference(preferences.groupBy, `${base}.groupBy`, customCanonicalKeys, diagnostics);
			if (preferences.subgroupBy) validateFilterFieldReference(preferences.subgroupBy, `${base}.subgroupBy`, customCanonicalKeys, diagnostics);
		}
	}
	for (const [index, preset] of (payloads.calendar?.calendarPresets ?? []).entries()) {
		if (preset.filterSetId && !filterIds) diagnostics.push(error(`$.body.groups.calendar.data.calendarPresets[${index}].filterSetId`, 'required', 'Calendar Filter reference requires an imported Filters group or target settings context.'));
		else if (preset.filterSetId && !filterIds?.has(preset.filterSetId)) diagnostics.push(error(`$.body.groups.calendar.data.calendarPresets[${index}].filterSetId`, 'value', `Calendar preset references missing Filter: ${preset.filterSetId}.`));
	}
	for (const [index, preset] of (payloads.kanban?.kanbanPresets ?? []).entries()) {
		const base = `$.body.groups.kanban.data.kanbanPresets[${index}]`;
		if (preset.pipelineId && !pipelineIds) diagnostics.push(error(`${base}.pipelineId`, 'required', 'Kanban Pipeline reference requires an imported Pipelines group or target settings context.'));
		else if (preset.pipelineId && !pipelineIds?.has(preset.pipelineId)) diagnostics.push(error(`${base}.pipelineId`, 'value', `Kanban preset references missing Pipeline: ${preset.pipelineId}.`));
		if (preset.filterSetId && !filterIds) diagnostics.push(error(`${base}.filterSetId`, 'required', 'Kanban Filter reference requires an imported Filters group or target settings context.'));
		else if (preset.filterSetId && !filterIds?.has(preset.filterSetId)) diagnostics.push(error(`${base}.filterSetId`, 'value', `Kanban preset references missing Filter: ${preset.filterSetId}.`));
		for (const [fieldPath, field] of [
			['swimlaneBy', preset.swimlaneBy],
			...preset.sortRules.map((rule, ruleIndex) => [`sortRules[${ruleIndex}].field`, rule.field]),
			...(preset.columnSortOverrides ?? []).flatMap((override, overrideIndex) => override.sortRules.map((rule, ruleIndex) => [`columnSortOverrides[${overrideIndex}].sortRules[${ruleIndex}].field`, rule.field])),
		] as Array<[string, string | null]>) {
			if (field && !BUILT_IN_KANBAN_FIELDS.has(field) && !customCanonicalKeys) diagnostics.push(error(`${base}.${fieldPath}`, 'required', `Kanban Custom Key reference requires an imported Custom Keys group or target settings context: ${field}.`));
			else if (field && customCanonicalKeys && !BUILT_IN_KANBAN_FIELDS.has(field) && !customCanonicalKeys.has(field)) diagnostics.push(error(`${base}.${fieldPath}`, 'value', `Kanban preset references missing Custom Key: ${field}.`));
		}
	}
	const favorites = payloads['preset-favorites']?.presetFavorites;
	if (favorites) {
		validateFavoriteRefs(favorites.filter, filters?.map(item => item.id), '$.body.groups.preset-favorites.data.presetFavorites.filter', diagnostics);
		validateFavoriteRefs(favorites.calendar, calendars?.map(item => item.id), '$.body.groups.preset-favorites.data.presetFavorites.calendar', diagnostics);
		validateFavoriteRefs(favorites.kanban, kanbans?.map(item => item.id), '$.body.groups.preset-favorites.data.presetFavorites.kanban', diagnostics);
		if (!context.ignoreTableFavoriteReferences) {
			validateFavoriteRefs(favorites.table, target?.tablePresetOrderIds, '$.body.groups.preset-favorites.data.presetFavorites.table', diagnostics);
		}
	}
}

function validateFilterFieldReference(
	reference: string,
	path: string,
	customCanonicalKeys: ReadonlySet<string> | null,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	if (BUILT_IN_FILTER_FIELDS.has(reference) || isFilePropertyColumnKey(reference)) return;
	if (!customCanonicalKeys) {
		diagnostics.push(error(path, 'required', `Filter Custom Key reference requires an imported Custom Keys group or target settings context: ${reference}.`));
	} else if (!customCanonicalKeys.has(reference)) {
		diagnostics.push(error(path, 'value', `Filter references missing Custom Key: ${reference}.`));
	}
}

function validateCanonicalProjection(
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	context: OperonSettingsBackupGroupValidationContextV1,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	const general = payloads.general;
	const baseline = context.targetSettings ?? DEFAULT_SETTINGS;
	const systemOverrides = new Map(
		(payloads['system-key-mappings']?.overrides ?? []).map(mapping => [mapping.canonicalKey, mapping]),
	);
	const systemMappings = baseline.keyMappings
		.filter(mapping => mapping.isSystem !== false)
		.map(mapping => ({ ...mapping, ...(systemOverrides.get(mapping.canonicalKey) ?? {}) }));
	const customMappings = payloads['custom-keys']?.customKeys
		?? baseline.keyMappings.filter(mapping => mapping.isSystem === false);
	const candidateFilterSets = payloads.filters
		? payloads.filters.dynamicTemplates
			? applyDynamicFilterTemplatePreferences(payloads.filters.filterSets, payloads.filters.dynamicTemplates)
			: payloads.filters.filterSets
		: baseline.filterSets;
	const candidate = migrateSettings({
		...baseline,
		...general,
		pipelines: payloads.pipelines?.pipelines ?? baseline.pipelines,
		defaultPipelineName: payloads.pipelines?.defaultPipelineName ?? baseline.defaultPipelineName,
		priorities: payloads.priorities?.priorities ?? baseline.priorities,
		defaultPriority: payloads.priorities?.defaultPriority ?? baseline.defaultPriority,
		keyMappings: [...systemMappings, ...customMappings],
		filterSets: candidateFilterSets,
		calendarPresets: payloads.calendar?.calendarPresets ?? baseline.calendarPresets,
		calendarDefaultPresetId: payloads.calendar?.calendarDefaultPresetId ?? baseline.calendarDefaultPresetId,
		calendarMobileDefaultSourcePresetId: payloads.calendar?.calendarMobileDefaultSourcePresetId
			?? baseline.calendarMobileDefaultSourcePresetId,
		calendarMobileAgendaSourcePresetId: payloads.calendar?.calendarMobileAgendaSourcePresetId
			?? baseline.calendarMobileAgendaSourcePresetId,
		calendarMobileDaySourcePresetId: payloads.calendar?.calendarMobileDaySourcePresetId
			?? baseline.calendarMobileDaySourcePresetId,
		calendarMobileTwoDaySourcePresetId: payloads.calendar?.calendarMobileTwoDaySourcePresetId
			?? baseline.calendarMobileTwoDaySourcePresetId,
		calendarMobileThreeDaySourcePresetId: payloads.calendar?.calendarMobileThreeDaySourcePresetId
			?? baseline.calendarMobileThreeDaySourcePresetId,
		kanbanPresets: payloads.kanban?.kanbanPresets ?? baseline.kanbanPresets,
		kanbanDefaultPresetId: payloads.kanban?.kanbanDefaultPresetId ?? baseline.kanbanDefaultPresetId,
		presetFavorites: payloads['preset-favorites']?.presetFavorites ?? baseline.presetFavorites,
		...(payloads['table-global'] ?? {}),
		externalCalendars: payloads['external-calendars']?.externalCalendars ?? baseline.externalCalendars,
	});
	for (const [key, value] of Object.entries(general ?? {})) {
		if (
			context.sourceSettingsVersion !== undefined
			&& context.sourceSettingsVersion < FILE_TASK_ARCHIVE_ROUTING_SETTINGS_VERSION
			&& LEGACY_ARCHIVE_ROUTING_KEYS.has(key)
		) continue;
		const normalized = candidate[key as keyof OperonSettings];
		assertCanonicalProjection(value, normalized, `$.body.groups.general.data.${key}`, key, diagnostics);
	}
	if (payloads.pipelines) assertCanonicalProjection(payloads.pipelines, { pipelines: candidate.pipelines, defaultPipelineName: candidate.defaultPipelineName }, '$.body.groups.pipelines.data', 'pipelines', diagnostics);
	if (payloads.priorities) assertCanonicalProjection(payloads.priorities, { priorities: candidate.priorities, defaultPriority: candidate.defaultPriority }, '$.body.groups.priorities.data', 'priorities', diagnostics);
	if (payloads['custom-keys']) assertCanonicalProjection(payloads['custom-keys'].customKeys, candidate.keyMappings.filter(mapping => mapping.isSystem === false), '$.body.groups.custom-keys.data.customKeys', 'customKeys', diagnostics);
	if (payloads.filters) assertCanonicalProjection(payloads.filters.filterSets, candidate.filterSets.filter(filter => !RESERVED_DYNAMIC_FILTER_IDS.has(filter.id)), '$.body.groups.filters.data.filterSets', 'filterSets', diagnostics);
	if (payloads.filters?.dynamicTemplates) assertCanonicalProjection(
		payloads.filters.dynamicTemplates,
		projectDynamicFilterTemplatePreferences(candidate.filterSets),
		'$.body.groups.filters.data.dynamicTemplates',
		'dynamicTemplates',
		diagnostics,
	);
	if (payloads.calendar) assertCanonicalProjection(payloads.calendar, {
		calendarPresets: candidate.calendarPresets,
		calendarDefaultPresetId: candidate.calendarDefaultPresetId,
		calendarMobileDefaultSourcePresetId: candidate.calendarMobileDefaultSourcePresetId,
		calendarMobileAgendaSourcePresetId: candidate.calendarMobileAgendaSourcePresetId,
		calendarMobileDaySourcePresetId: candidate.calendarMobileDaySourcePresetId,
		calendarMobileTwoDaySourcePresetId: candidate.calendarMobileTwoDaySourcePresetId,
		calendarMobileThreeDaySourcePresetId: candidate.calendarMobileThreeDaySourcePresetId,
	}, '$.body.groups.calendar.data', 'calendar', diagnostics);
	if (payloads.kanban) assertCanonicalProjection(payloads.kanban, { kanbanPresets: candidate.kanbanPresets, kanbanDefaultPresetId: candidate.kanbanDefaultPresetId }, '$.body.groups.kanban.data', 'kanban', diagnostics);
	if (payloads['preset-favorites']) assertCanonicalProjection(payloads['preset-favorites'].presetFavorites, candidate.presetFavorites, '$.body.groups.preset-favorites.data.presetFavorites', 'presetFavorites', diagnostics);
	if (payloads['table-global']) assertCanonicalProjection(payloads['table-global'], {
		tableDefaultFolder: candidate.tableDefaultFolder,
		tableEmbedVisibleRows: candidate.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: candidate.tableEmbedDefaultWidthPercent,
		tableShowLineNumbers: candidate.tableShowLineNumbers,
		tableShowTaskIcon: candidate.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: candidate.tableShowTaskDataTypeIcon,
		tableGanttDefaultSplitPercent: candidate.tableGanttDefaultSplitPercent,
		tableGanttDefaultScale: candidate.tableGanttDefaultScale,
		tableGanttDefaultUnitWidthMultiplier: candidate.tableGanttDefaultUnitWidthMultiplier,
		tableGanttDefaultBarColorMode: candidate.tableGanttDefaultBarColorMode,
		tableGanttShowToday: candidate.tableGanttShowToday,
		tableGanttShowWeekends: candidate.tableGanttShowWeekends,
		tableGanttShowDateStartedMarkers: candidate.tableGanttShowDateStartedMarkers,
		tableGanttShowDateScheduledMarkers: candidate.tableGanttShowDateScheduledMarkers,
		tableGanttShowDateDueMarkers: candidate.tableGanttShowDateDueMarkers,
		tableGanttFocusTodayOnOpen: candidate.tableGanttFocusTodayOnOpen,
		tableGanttBarClickAction: candidate.tableGanttBarClickAction,
		tableGanttBarRightClickAction: candidate.tableGanttBarRightClickAction,
		tableGanttOneDayClickBehavior: candidate.tableGanttOneDayClickBehavior,
		tableGanttMoveOpenDescendantsWithParent: candidate.tableGanttMoveOpenDescendantsWithParent,
	}, '$.body.groups.table-global.data', 'table-global', diagnostics);
	if (payloads['external-calendars']) assertCanonicalProjection(payloads['external-calendars'].externalCalendars, candidate.externalCalendars, '$.body.groups.external-calendars.data.externalCalendars', 'externalCalendars', diagnostics);
	for (const [index, override] of (payloads['system-key-mappings']?.overrides ?? []).entries()) {
		const normalized = candidate.keyMappings.find(mapping => mapping.isSystem !== false && mapping.canonicalKey === override.canonicalKey);
		if (!normalized) continue;
		const projection = Object.fromEntries(Object.keys(override).map(key => [key, normalized[key as keyof KeyMapping]]));
		assertCanonicalProjection(override, projection, `$.body.groups.system-key-mappings.data.overrides[${index}]`, 'system key override', diagnostics);
	}
}

function assertCanonicalProjection(
	value: unknown,
	normalized: unknown,
	path: string,
	label: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	try {
		const projected = projectNormalizedShape(value, normalized);
		if (canonicalizeOperonSettingsBackupJson(value) !== canonicalizeOperonSettingsBackupJson(projected)) {
			const differencePath = findFirstProjectionDifference(value, projected, path);
			diagnostics.push(error(differencePath, 'value', `${label} is not canonical for the current group codec.`));
		}
	} catch (normalizationError) {
		diagnostics.push(error(path, 'value', normalizationError instanceof Error ? normalizationError.message : String(normalizationError)));
	}
}

function findFirstProjectionDifference(source: unknown, projected: unknown, path: string): string {
	if (Array.isArray(source) && Array.isArray(projected)) {
		for (let index = 0; index < Math.max(source.length, projected.length); index++) {
			if (canonicalValuesEqual(source[index], projected[index])) continue;
			return findFirstProjectionDifference(source[index], projected[index], `${path}[${index}]`);
		}
		return path;
	}
	if (isPlainRecord(source) && isPlainRecord(projected)) {
		for (const key of Object.keys(source)) {
			if (canonicalValuesEqual(source[key], projected[key])) continue;
			return findFirstProjectionDifference(source[key], projected[key], `${path}.${key}`);
		}
		return path;
	}
	return path;
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
	try {
		return canonicalizeOperonSettingsBackupJson(left) === canonicalizeOperonSettingsBackupJson(right);
	} catch {
		return false;
	}
}

function projectNormalizedShape(source: unknown, normalized: unknown): unknown {
	if (Array.isArray(source)) {
		if (!Array.isArray(normalized)) return normalized;
		const normalizedItems = normalized as unknown[];
		const normalizedById = new Map(normalizedItems
			.filter(isPlainRecord)
			.filter(item => typeof item.id === 'string')
			.map(item => [item.id, item]));
		return source.map((item, index) => {
			const matching = isPlainRecord(item) && typeof item.id === 'string'
				? normalizedById.get(item.id)
				: normalizedItems[index];
			return projectNormalizedShape(item, matching);
		});
	}
	if (isPlainRecord(source)) {
		if (!isPlainRecord(normalized)) return normalized;
		return Object.fromEntries(Object.keys(source).map(key => [
			key,
			projectNormalizedShape(source[key], normalized[key]),
		]));
	}
	return normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as object | null;
	return prototype === Object.prototype || prototype === null;
}

function validateFilterNode(value: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	const object = inspectObject(value, path, ['id', 'logic', 'children', 'field', 'fieldType', 'operator', 'value', 'values'], ['id'], diagnostics);
	if (!object) return;
	if ('children' in object) {
		const children = inspectArray(object.children, `${path}.children`, diagnostics);
		for (const [index, child] of (children ?? []).entries()) validateFilterNode(child, `${path}.children[${index}]`, diagnostics);
	} else {
		validateFilterCondition(value, path, diagnostics);
	}
}

function validateFilterCondition(value: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	const object = inspectObject(value, path, ['id', 'field', 'fieldType', 'operator', 'value', 'values'], ['id', 'field', 'fieldType', 'operator'], diagnostics);
	if (!object) return;
	requiredString(object.field, `${path}.field`, diagnostics);
}

function collectFilterFieldReferences(filter: FilterSet): string[] {
	const references = [filter.sortBy, filter.groupBy, filter.subgroupBy, ...filter.sorts.map(sort => sort.field), ...filter.conditions.map(condition => condition.field)];
	const visit = (node: FilterSet['rootGroup']): void => {
		for (const child of node.children) {
			if ('children' in child) visit(child);
			else references.push(child.field);
		}
	};
	visit(filter.rootGroup);
	return references.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function validateNamedPresets(
	presets: unknown[] | null,
	path: string,
	knownFields: string[],
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const [index, raw] of (presets ?? []).entries()) {
		const itemPath = `${path}[${index}]`;
		const item = inspectObject(raw, itemPath, knownFields, ['id', 'name'], diagnostics);
		if (!item) continue;
		const id = requiredString(item.id, `${itemPath}.id`, diagnostics);
		const name = requiredString(item.name, `${itemPath}.name`, diagnostics);
		checkDuplicate(id, ids, `${itemPath}.id`, 'preset ID', diagnostics);
		checkDuplicate(name?.toLocaleLowerCase('en-US') ?? null, names, `${itemPath}.name`, 'preset name', diagnostics);
	}
}

function validatePresetDefault(value: unknown, presets: unknown[] | null, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	if (value !== null && typeof value !== 'string') {
		diagnostics.push(error(path, 'type', 'Preset reference must be a string or null.'));
		return;
	}
	if (typeof value === 'string' && !(presets ?? []).some(item => isObject(item) && item.id === value)) diagnostics.push(error(path, 'value', `Preset reference does not exist: ${value}.`));
}

function validateFavoriteRefs(values: string[], available: string[] | undefined, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	if (!available) {
		if (values.length > 0) diagnostics.push(error(path, 'required', 'Favorite references require the corresponding imported preset group or target settings context.'));
		return;
	}
	const ids = new Set(available);
	for (const [index, value] of values.entries()) if (!ids.has(value)) diagnostics.push(error(`${path}[${index}]`, 'value', `Favorite references missing preset: ${value}.`));
}

function validateUniqueStringArray(values: unknown[] | null, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	const seen = new Set<string>();
	for (const [index, value] of (values ?? []).entries()) {
		const normalized = requiredString(value, `${path}[${index}]`, diagnostics);
		checkDuplicate(normalized, seen, `${path}[${index}]`, 'favorite ID', diagnostics);
	}
}

function inspectObject(
	value: unknown,
	path: string,
	knownFields: readonly string[],
	requiredFields: readonly string[],
	diagnostics: OperonSettingsBackupDiagnostic[],
): AnyObject | null {
	if (!isObject(value)) {
		diagnostics.push(error(path, 'type', 'Expected an object.'));
		return null;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
		diagnostics.push(error(path, 'prototype', 'Object must have a plain prototype.'));
		return null;
	}
	const known = new Set(knownFields);
	for (const key of Object.keys(value)) if (!known.has(key)) diagnostics.push(error(`${path}.${key}`, 'unknown-field', `Unknown field: ${key}.`));
	for (const key of requiredFields) if (!(key in value)) diagnostics.push(error(`${path}.${key}`, 'required', `Missing required field: ${key}.`));
	return value;
}

function inspectArray(value: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): unknown[] | null {
	if (!Array.isArray(value)) {
		diagnostics.push(error(path, 'type', 'Expected an array.'));
		return null;
	}
	const result: unknown[] = [];
	for (const entry of value) result.push(entry as unknown);
	return result;
}

type FieldType = 'string' | 'nullable-string' | 'boolean' | 'number' | 'array' | 'object';

function validateFieldTypes(
	object: AnyObject,
	path: string,
	types: Readonly<Record<string, FieldType>>,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	for (const [key, expected] of Object.entries(types)) {
		if (!(key in object)) continue;
		const value = object[key];
		const valid = expected === 'string'
			? typeof value === 'string'
			: expected === 'nullable-string'
				? value === null || typeof value === 'string'
				: expected === 'boolean'
					? typeof value === 'boolean'
					: expected === 'number'
						? typeof value === 'number' && Number.isFinite(value)
						: expected === 'array'
							? Array.isArray(value)
							: isObject(value);
		if (!valid) diagnostics.push(error(`${path}.${key}`, 'type', `${key} must be ${expected}.`));
	}
}

function requiredString(value: unknown, path: string, diagnostics: OperonSettingsBackupDiagnostic[]): string | null {
	if (typeof value !== 'string' || !value.trim()) {
		diagnostics.push(error(path, 'type', 'Expected a non-empty string.'));
		return null;
	}
	if (value !== value.trim()) diagnostics.push(error(path, 'value', 'String must not contain leading or trailing whitespace.'));
	return value.trim();
}

function checkDuplicate(value: string | null, seen: Set<string>, path: string, label: string, diagnostics: OperonSettingsBackupDiagnostic[]): void {
	if (!value) return;
	if (seen.has(value)) diagnostics.push(error(path, 'value', `Duplicate ${label}: ${value}.`));
	else seen.add(value);
}

function isObject(value: unknown): value is AnyObject {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isObject(value) && Object.values(value).every(isJsonValue);
}

function error(
	path: string,
	code: OperonSettingsBackupDiagnostic['code'],
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'error', message };
}
