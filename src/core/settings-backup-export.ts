import type { JsonValue } from '../agent-runtime/contracts/v1/primitives';
import type { OperonSettings } from '../types/settings';
import { isSafeTablePresetId } from '../types/table';
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
	type OperonSettingsBackupTableInventoryV1,
	type OperonSettingsBackupV1,
} from './settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from './settings-backup-group-validation';

const RESERVED_DYNAMIC_FILTER_IDS = new Set(['fs_dynamic_file_task', 'fs_dynamic_subtasks_filter']);

export interface OperonSettingsBackupExportSourceV1 {
	pluginVersion: string;
	obsidianVersion: string;
	dataPackageSchemaVersion: number;
}

export interface OperonSettingsBackupExportInputV1 {
	settings: Readonly<OperonSettings>;
	source: OperonSettingsBackupExportSourceV1;
	createdAt: string;
	includeExternalCalendarUrls?: boolean;
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
	tableFiles: {
		mode: 'excluded';
		inventoryCount: number;
		contentCount: 0;
		duplicateIdCount: number;
		duplicatePathCount: number;
		unsafeIdCount: number;
		nonPortablePathCount: number;
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
	const includeExternalCalendars = input.includeExternalCalendarUrls === true;
	let report = createEmptyReport(includeExternalCalendars, input.canonicalWritesSuspended === true);

	try {
		const tableInventory = buildExcludedTableInventory(input.settings);
		report = createReport(
			input.settings,
			includeExternalCalendars,
			tableInventory,
			input.canonicalWritesSuspended === true,
		);
		const groups = buildGroups(input.settings, includeExternalCalendars);
		const groupValidation = validateOperonSettingsBackupGroupsV1(groups, {
			targetSettings: input.settings,
		});
		if (!groupValidation.ok) return failure(report, groupValidation.diagnostics);

		const scope: OperonSettingsBackupScopeV1 = {
			configuration: 'portable',
			tableFiles: 'excluded',
			externalCalendarUrls: includeExternalCalendars ? 'included' : 'excluded',
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
			tableInventory: tableInventory.inventory,
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
			suggestedFileName: suggestedFileName(input.createdAt),
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

function buildGroups(
	settings: Readonly<OperonSettings>,
	includeExternalCalendars: boolean,
): OperonSettingsBackupGroupsV1 {
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
			filterSets: settings.filterSets.filter(filter => !RESERVED_DYNAMIC_FILTER_IDS.has(filter.id)),
		}),
		calendar: versioned({
			calendarPresets: includeExternalCalendars
				? settings.calendarPresets
				: scrubExternalCalendarVisibility(settings),
			calendarDefaultPresetId: settings.calendarDefaultPresetId,
			calendarMobileDefaultSourcePresetId: settings.calendarMobileDefaultSourcePresetId,
			calendarMobileAgendaSourcePresetId: settings.calendarMobileAgendaSourcePresetId,
			calendarMobileDaySourcePresetId: settings.calendarMobileDaySourcePresetId,
			calendarMobileTwoDaySourcePresetId: settings.calendarMobileTwoDaySourcePresetId,
			calendarMobileThreeDaySourcePresetId: settings.calendarMobileThreeDaySourcePresetId,
		}),
		kanban: versioned({ kanbanPresets: settings.kanbanPresets, kanbanDefaultPresetId: settings.kanbanDefaultPresetId }),
		'preset-favorites': versioned({ presetFavorites: settings.presetFavorites }),
		'table-global': versioned({
			tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
			tableShowLineNumbers: settings.tableShowLineNumbers,
			tableShowTaskIcon: settings.tableShowTaskIcon,
			tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
		}),
	};
	if (includeExternalCalendars) {
		groups['external-calendars'] = versioned({ externalCalendars: settings.externalCalendars });
	}
	return groups;
}

function scrubExternalCalendarVisibility(settings: Readonly<OperonSettings>): OperonSettings['calendarPresets'] {
	const sensitiveKeys = new Set(settings.externalCalendars.flatMap(source => [source.id, source.url]));
	return settings.calendarPresets.map(preset => ({
		...preset,
		externalCalendarVisibility: Object.fromEntries(Object.entries(preset.externalCalendarVisibility).filter(([key]) => (
			!sensitiveKeys.has(key) && !/^(?:https?|webcal):\/\//iu.test(key)
		))),
	}));
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

interface ExcludedTableInventoryResult {
	inventory: OperonSettingsBackupTableInventoryV1;
	duplicateIdCount: number;
	duplicatePathCount: number;
	unsafeIdCount: number;
	nonPortablePathCount: number;
}

function buildExcludedTableInventory(settings: Readonly<OperonSettings>): ExcludedTableInventoryResult {
	const order = new Map(settings.tablePresetOrderIds.map((id, index) => [id, index]));
	const bindings = settings.tablePresetFileBindings.map(binding => ({ ...binding })).sort((left, right) => {
		const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
		return leftOrder - rightOrder || compareCodeUnits(left.id, right.id) || compareCodeUnits(left.path, right.path);
	});
	const ids = new Set<string>();
	const paths = new Set<string>();
	let duplicateIdCount = 0;
	let duplicatePathCount = 0;
	let unsafeIdCount = 0;
	let nonPortablePathCount = 0;
	for (const binding of bindings) {
		if (!isSafeTablePresetId(binding.id)) unsafeIdCount += 1;
		if (!isSafePortableTablePath(binding.path)) nonPortablePathCount += 1;
		if (ids.has(binding.id)) duplicateIdCount += 1;
		const pathKey = portablePathKey(binding.path);
		if (paths.has(pathKey)) duplicatePathCount += 1;
		ids.add(binding.id);
		paths.add(pathKey);
	}
	return {
		inventory: {
			mode: 'excluded',
			items: bindings.map(binding => ({ id: binding.id, originalPath: binding.path, sha256: null })),
		},
		duplicateIdCount,
		duplicatePathCount,
		unsafeIdCount,
		nonPortablePathCount,
	};
}

function createReport(
	settings: Readonly<OperonSettings>,
	includeExternalCalendars: boolean,
	tableInventory: ExcludedTableInventoryResult,
	canonicalWritesSuspended: boolean,
): OperonSettingsBackupExportReportV1 {
	const includedGroups = SETTINGS_BACKUP_GROUPS
		.filter(group => group.id !== 'external-calendars' || includeExternalCalendars)
		.map(group => group.id);
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
			filters: settings.filterSets.filter(filter => !RESERVED_DYNAMIC_FILTER_IDS.has(filter.id)).length,
			reservedFiltersOmitted: settings.filterSets.filter(filter => RESERVED_DYNAMIC_FILTER_IDS.has(filter.id)).length,
			calendarPresets: settings.calendarPresets.length,
			kanbanPresets: settings.kanbanPresets.length,
			presetFavorites: settings.presetFavorites.table.length
				+ settings.presetFavorites.calendar.length
				+ settings.presetFavorites.kanban.length
				+ settings.presetFavorites.filter.length,
		},
		canonicalStorage: { writesSuspended: canonicalWritesSuspended },
		externalCalendars: {
			included: includeExternalCalendars,
			sourceCount: settings.externalCalendars.length,
			includedUrlCount: includeExternalCalendars ? settings.externalCalendars.length : 0,
			maskedUrlCount: includeExternalCalendars ? 0 : settings.externalCalendars.length,
		},
		tableFiles: {
			mode: 'excluded',
			inventoryCount: tableInventory.inventory.items.length,
			contentCount: 0,
			duplicateIdCount: tableInventory.duplicateIdCount,
			duplicatePathCount: tableInventory.duplicatePathCount,
			unsafeIdCount: tableInventory.unsafeIdCount,
			nonPortablePathCount: tableInventory.nonPortablePathCount,
		},
	};
}

function createEmptyReport(
	includeExternalCalendars: boolean,
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
			included: includeExternalCalendars,
			sourceCount: 0,
			includedUrlCount: 0,
			maskedUrlCount: 0,
		},
		tableFiles: {
			mode: 'excluded',
			inventoryCount: 0,
			contentCount: 0,
			duplicateIdCount: 0,
			duplicatePathCount: 0,
			unsafeIdCount: 0,
			nonPortablePathCount: 0,
		},
	};
}

function isSafePortableTablePath(path: string): boolean {
	if (!path.endsWith('.table') || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.includes('\\')) return false;
	const segments = path.split('/');
	return segments.every(segment => {
		if (!segment || segment === '.' || segment === '..') return false;
		if ([...segment].some(character => character.charCodeAt(0) <= 0x1F)) return false;
		if (/[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) return false;
		const deviceStem = segment.split('.')[0]?.toLocaleLowerCase('en-US') ?? '';
		return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(deviceStem);
	});
}

function portablePathKey(path: string): string {
	return path.split('/').map(segment => (
		segment.normalize('NFC').replace(/[. ]+$/u, '').toLocaleLowerCase('en-US')
	)).join('/');
}

function suggestedFileName(createdAt: string): string {
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

function compareCodeUnits(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
