import type { JsonValue } from '../agent-runtime/contracts/v1/primitives';
import type { OperonSettings } from '../types/settings';
import {
	getNormalFilterSets,
	isSpecialDynamicFilterSet,
	projectDynamicFilterTemplatePreferences,
} from './dynamic-file-task-filter';
import {
	ALL_OPERON_SETTINGS_BACKUP_KEYS,
	SETTINGS_BACKUP_COMPATIBILITY_BY_KEY,
	SETTINGS_BACKUP_GROUP_CODEC_VERSION,
	SETTINGS_BACKUP_GROUPS,
	SETTINGS_BACKUP_SYSTEM_KEY_OVERRIDE_FIELDS,
	type SettingsBackupProfileGroupId,
	type SettingsBackupSupportClass,
} from './settings-backup-compatibility';
import {
	buildOperonSettingsBackupV1,
	canonicalizeOperonSettingsBackupJson,
	OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES,
	parseOperonSettingsBackupV1,
	serializeOperonSettingsBackupV1,
	type OperonSettingsBackupDiagnostic,
	type OperonSettingsBackupGroupsV1,
	type OperonSettingsBackupScopeV1,
	type OperonSettingsBackupV1,
} from './settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from './settings-backup-group-validation';

export interface OperonSettingsBackupExportSourceV1 {
	pluginVersion: string;
	obsidianVersion: string;
	dataPackageSchemaVersion: number;
}

export interface OperonSettingsBackupExportInputV1 {
	settings: Readonly<OperonSettings>;
	source: OperonSettingsBackupExportSourceV1;
	createdAt: string;
	canonicalWritesSuspended?: boolean;
}

export interface OperonSettingsBackupExportReportV1 {
	includedGroups: SettingsBackupProfileGroupId[];
	includedSettingKeyCount: number;
	excludedSettingCountsBySupport: Partial<Record<SettingsBackupSupportClass, number>>;
	recordCounts: {
		pipelines: number;
		priorities: number;
		systemKeyOverrides: number;
		customKeys: number;
		filters: number;
		reservedFiltersOmitted: number;
		calendarPresets: number;
		kanbanPresets: number;
		presetFavorites: number;
	};
	canonicalStorage: { writesSuspended: boolean };
	externalCalendars: {
		included: boolean;
		sourceCount: number;
		includedUrlCount: number;
		maskedUrlCount: number;
	};
}

export type OperonSettingsBackupExportResultV1 =
	| {
		ok: true;
		backup: OperonSettingsBackupV1;
		json: string;
		utf8Bytes: number;
		bodyChecksum: string;
		suggestedFileName: string;
		report: OperonSettingsBackupExportReportV1;
		diagnostics: [];
	}
	| {
		ok: false;
		backup: null;
		json: null;
		utf8Bytes: null;
		bodyChecksum: null;
		suggestedFileName: null;
		report: OperonSettingsBackupExportReportV1;
		diagnostics: OperonSettingsBackupDiagnostic[];
	};

/**
 * Build a deterministic, portable settings JSON document without reading or
 * writing Obsidian, vault or filesystem state. Callers own the download/write.
 */
export function exportOperonSettingsBackupJsonV1(
	input: OperonSettingsBackupExportInputV1,
): OperonSettingsBackupExportResultV1 {
	let report = createEmptyReport(input.canonicalWritesSuspended === true);

	try {
		report = createReport(
			input.settings,
			input.canonicalWritesSuspended === true,
		);
		const groups = buildGroups(input.settings);
		const groupValidation = validateOperonSettingsBackupGroupsV1(groups, {
			targetSettings: input.settings,
		});
		if (!groupValidation.ok) return failure(report, groupValidation.diagnostics);

		const scope: OperonSettingsBackupScopeV1 = {
			configuration: 'portable',
			tableFiles: 'excluded',
			externalCalendarUrls: 'included',
			developerApiGrants: 'excluded',
			mobileIdentity: 'excluded',
			operationalState: 'excluded',
			runtime: 'excluded',
			cache: 'excluded',
		};
		const backup = buildOperonSettingsBackupV1({
			createdAt: input.createdAt,
			source: {
				...input.source,
				settingsVersion: input.settings.settingsVersion,
			},
			scope,
			groups,
		});
		const json = serializeOperonSettingsBackupV1(backup);
		const utf8Bytes = new TextEncoder().encode(json).byteLength;
		if (utf8Bytes > OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES) {
			return failure(report, [diagnostic(
				'$',
				'value',
				`Export exceeds the ${OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES} byte JSON limit.`,
			)]);
		}
		const parsed = parseOperonSettingsBackupV1(json);
		if (!parsed.ok) return failure(report, parsed.diagnostics);
		return {
			ok: true,
			backup: parsed.value,
			json,
			utf8Bytes,
			bodyChecksum: parsed.value.integrity.value,
			suggestedFileName: suggestOperonSettingsBackupFileNameV1(input.createdAt),
			report,
			diagnostics: [],
		};
	} catch (error) {
		return failure(report, [diagnostic(
			'$',
			'value',
			error instanceof Error && error.name === 'OperonSettingsBackupCanonicalJsonError'
				? error.message
				: 'Settings backup export failed validation.',
		)]);
	}
}

function buildGroups(settings: Readonly<OperonSettings>): OperonSettingsBackupGroupsV1 {
	const generalDefinition = SETTINGS_BACKUP_GROUPS.find(group => group.id === 'general');
	if (!generalDefinition) throw new Error('Missing general settings backup group.');
	const general = Object.fromEntries(generalDefinition.settingKeys.map(key => [key, settings[key]]));
	const systemMappings = settings.keyMappings
		.filter(mapping => mapping.isSystem !== false)
		.map(mapping => ({
			canonicalKey: mapping.canonicalKey,
			visiblePropertyName: mapping.visiblePropertyName,
			...Object.fromEntries(SETTINGS_BACKUP_SYSTEM_KEY_OVERRIDE_FIELDS.flatMap(field => (
				mapping[field] === undefined ? [] : [[field, mapping[field]]]
			))),
		}));
	const groups: OperonSettingsBackupGroupsV1 = {
		general: versioned(general),
		pipelines: versioned({ pipelines: settings.pipelines, defaultPipelineName: settings.defaultPipelineName }),
		priorities: versioned({ priorities: settings.priorities, defaultPriority: settings.defaultPriority }),
		'system-key-mappings': versioned({ overrides: systemMappings }),
		'custom-keys': versioned({ customKeys: settings.keyMappings.filter(mapping => mapping.isSystem === false) }),
		filters: versioned({
			filterSets: getNormalFilterSets(settings.filterSets),
			dynamicTemplates: projectDynamicFilterTemplatePreferences(settings.filterSets),
		}),
		calendar: versioned({
			calendarPresets: settings.calendarPresets,
			calendarDefaultPresetId: settings.calendarDefaultPresetId,
			calendarMobileDefaultSourcePresetId: settings.calendarMobileDefaultSourcePresetId,
			calendarMobileAgendaSourcePresetId: settings.calendarMobileAgendaSourcePresetId,
			calendarMobileDaySourcePresetId: settings.calendarMobileDaySourcePresetId,
			calendarMobileTwoDaySourcePresetId: settings.calendarMobileTwoDaySourcePresetId,
			calendarMobileThreeDaySourcePresetId: settings.calendarMobileThreeDaySourcePresetId,
		}),
		kanban: versioned({ kanbanPresets: settings.kanbanPresets, kanbanDefaultPresetId: settings.kanbanDefaultPresetId }),
		'preset-favorites': versioned({
			presetFavorites: {
				...settings.presetFavorites,
				table: [],
			},
		}),
		'table-global': versioned({
			tableDefaultFolder: settings.tableDefaultFolder,
			tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
			tableEmbedDefaultWidthPercent: settings.tableEmbedDefaultWidthPercent,
			tableShowLineNumbers: settings.tableShowLineNumbers,
			tableShowTaskIcon: settings.tableShowTaskIcon,
			tableShowTaskDataTypeIcon: settings.tableShowTaskDataTypeIcon,
			tableGanttDefaultSplitPercent: settings.tableGanttDefaultSplitPercent,
			tableGanttDefaultScale: settings.tableGanttDefaultScale,
			tableGanttDefaultUnitWidthMultiplier: settings.tableGanttDefaultUnitWidthMultiplier,
			tableGanttDefaultBarColorMode: settings.tableGanttDefaultBarColorMode,
			tableGanttShowToday: settings.tableGanttShowToday,
			tableGanttShowWeekends: settings.tableGanttShowWeekends,
			tableGanttShowDateStartedMarkers: settings.tableGanttShowDateStartedMarkers,
			tableGanttShowDateScheduledMarkers: settings.tableGanttShowDateScheduledMarkers,
			tableGanttShowDateDueMarkers: settings.tableGanttShowDateDueMarkers,
			tableGanttFocusTodayOnOpen: settings.tableGanttFocusTodayOnOpen,
			tableGanttBarClickAction: settings.tableGanttBarClickAction,
			tableGanttBarRightClickAction: settings.tableGanttBarRightClickAction,
			tableGanttOneDayClickBehavior: settings.tableGanttOneDayClickBehavior,
			tableGanttMoveOpenDescendantsWithParent: settings.tableGanttMoveOpenDescendantsWithParent,
			tableGanttMoveOpenBlockedTasksWithBlocker: settings.tableGanttMoveOpenBlockedTasksWithBlocker,
		}),
		'external-calendars': versioned({ externalCalendars: settings.externalCalendars }),
	};
	return groups;
}

function versioned(data: unknown): { codecVersion: number; data: JsonValue } {
	const jsonValue = toBackupJsonValue(data, new Set<object>());
	return {
		codecVersion: SETTINGS_BACKUP_GROUP_CODEC_VERSION,
		data: JSON.parse(canonicalizeOperonSettingsBackupJson(jsonValue)) as JsonValue,
	};
}

function toBackupJsonValue(value: unknown, stack: Set<object>): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Settings backup contains a non-finite number.');
		return value;
	}
	if (Array.isArray(value)) {
		if (stack.has(value)) throw new Error('Settings backup contains a cyclic array.');
		stack.add(value);
		try {
			return value.map(item => {
				if (item === undefined) throw new Error('Settings backup contains an undefined array item.');
				return toBackupJsonValue(item, stack);
			});
		} finally {
			stack.delete(value);
		}
	}
	if (typeof value !== 'object' || value === null) throw new Error('Settings backup contains a non-JSON value.');
	const prototype = Object.getPrototypeOf(value) as object | null;
	if (prototype !== Object.prototype && prototype !== null) throw new Error('Settings backup contains a non-plain object.');
	if (stack.has(value)) throw new Error('Settings backup contains a cyclic object.');
	stack.add(value);
	try {
		const output: Record<string, JsonValue> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Settings backup contains a forbidden prototype key.');
			if (item !== undefined) output[key] = toBackupJsonValue(item, stack);
		}
		return output;
	} finally {
		stack.delete(value);
	}
}

function createReport(
	settings: Readonly<OperonSettings>,
	canonicalWritesSuspended: boolean,
): OperonSettingsBackupExportReportV1 {
	const includedGroups = SETTINGS_BACKUP_GROUPS.map(group => group.id);
	const includedKeys = new Set(SETTINGS_BACKUP_GROUPS
		.filter(group => includedGroups.includes(group.id))
		.flatMap(group => group.settingKeys));
	const excludedSettingCountsBySupport: Partial<Record<SettingsBackupSupportClass, number>> = {};
	for (const key of ALL_OPERON_SETTINGS_BACKUP_KEYS) {
		if (includedKeys.has(key)) continue;
		const support = SETTINGS_BACKUP_COMPATIBILITY_BY_KEY[key].support;
		excludedSettingCountsBySupport[support] = (excludedSettingCountsBySupport[support] ?? 0) + 1;
	}
	return {
		includedGroups,
		includedSettingKeyCount: includedKeys.size,
		excludedSettingCountsBySupport,
		recordCounts: {
			pipelines: settings.pipelines.length,
			priorities: settings.priorities.length,
			systemKeyOverrides: settings.keyMappings.filter(mapping => mapping.isSystem !== false).length,
			customKeys: settings.keyMappings.filter(mapping => mapping.isSystem === false).length,
			filters: getNormalFilterSets(settings.filterSets).length,
			reservedFiltersOmitted: settings.filterSets.filter(isSpecialDynamicFilterSet).length,
			calendarPresets: settings.calendarPresets.length,
			kanbanPresets: settings.kanbanPresets.length,
			presetFavorites: settings.presetFavorites.calendar.length
				+ settings.presetFavorites.kanban.length
				+ settings.presetFavorites.filter.length,
		},
		canonicalStorage: { writesSuspended: canonicalWritesSuspended },
		externalCalendars: {
			included: true,
			sourceCount: settings.externalCalendars.length,
			includedUrlCount: settings.externalCalendars.length,
			maskedUrlCount: 0,
		},
	};
}

function createEmptyReport(
	canonicalWritesSuspended: boolean,
): OperonSettingsBackupExportReportV1 {
	return {
		includedGroups: [],
		includedSettingKeyCount: 0,
		excludedSettingCountsBySupport: {},
		recordCounts: {
			pipelines: 0,
			priorities: 0,
			systemKeyOverrides: 0,
			customKeys: 0,
			filters: 0,
			reservedFiltersOmitted: 0,
			calendarPresets: 0,
			kanbanPresets: 0,
			presetFavorites: 0,
		},
		canonicalStorage: { writesSuspended: canonicalWritesSuspended },
		externalCalendars: {
			included: true,
			sourceCount: 0,
			includedUrlCount: 0,
			maskedUrlCount: 0,
		},
	};
}

export function suggestOperonSettingsBackupFileNameV1(createdAt: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/u.exec(createdAt);
	if (!match) return 'operon-settings-backup.json';
	return `operon-settings-backup-${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z.json`;
}

function failure(
	report: OperonSettingsBackupExportReportV1,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupExportResultV1 {
	return {
		ok: false,
		backup: null,
		json: null,
		utf8Bytes: null,
		bodyChecksum: null,
		suggestedFileName: null,
		report,
		diagnostics,
	};
}

function diagnostic(
	path: string,
	code: OperonSettingsBackupDiagnostic['code'],
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'error', message };
}
