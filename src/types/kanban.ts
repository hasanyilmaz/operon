import type { KanbanTaskColorSource } from '../core/task-color-source';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import type { ProjectSerialDisplay } from '../core/project-serials';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import type { IndexedTask } from './fields';
import type { RelatedViewCreateTarget, RelatedViewOpenTarget } from './related-views';

export type BuiltInKanbanSwimlaneBy =
	| 'priority'
	| 'tags'
	| 'contexts'
	| 'assignees'
	| 'dateDue'
	| 'dateScheduled';
export type KanbanCustomFieldKey = string & { readonly __kanbanCustomFieldKey?: never };
export type KanbanSwimlaneBy = BuiltInKanbanSwimlaneBy | KanbanCustomFieldKey;

export type KanbanColorSource = KanbanTaskColorSource;
export type KanbanAppearanceMode = 'theme' | 'anupuccin-light' | 'anupuccin-dark' | 'catppuccin-dark' | 'atom-light' | 'atom-dark' | 'flexoki-light' | 'flexoki-dark';
export type BuiltInKanbanSortField =
	| 'alphabetical'
	| 'priority'
	| 'dateDue'
	| 'dateScheduled'
	| 'dateStarted'
	| 'dateCompleted'
	| 'dateCancelled'
	| 'datetimeCreated'
	| 'datetimeModified'
	| 'progress'
	| 'estimate'
	| 'duration'
	| 'totalDuration'
	| 'totalEstimate';
export type KanbanSortField = BuiltInKanbanSortField | KanbanCustomFieldKey;
export type KanbanSortDirection = 'asc' | 'desc';
export type KanbanSortEmptyPlacement = 'first' | 'last';
export type KanbanSortMode = 'automatic' | 'manual';

export interface KanbanSortRule {
	field: KanbanSortField;
	direction: KanbanSortDirection;
	empty: KanbanSortEmptyPlacement;
}

export interface KanbanPreset {
	id: string;
	name: string;
	pipelineId: string | null;
	filterSetId: string | null;
	swimlaneBy: KanbanSwimlaneBy | null;
	colorSource: KanbanColorSource;
	appearanceModeLight: KanbanAppearanceMode;
	appearanceModeDark: KanbanAppearanceMode;
	collapseEmptyColumns: boolean;
	collapseEmptySwimlanes: boolean;
	autoCollapseFinishedColumns: boolean;
	sortMode: KanbanSortMode;
	sortRules: KanbanSortRule[];
}

const DEFAULT_KANBAN_PRESET_ID = 'kanban-preset-default';
const LEGACY_DEFAULT_KANBAN_NAME = 'Default Kanban';
const DEFAULT_KANBAN_NAME = 'My First Kanban Board';
const DEFAULT_KANBAN_PIPELINE_ID = 'pl_project';

export interface KanbanLeafState {
	presetId: string | null;
	searchQuery: string;
	collapsedStatusIds: string[];
	collapsedLaneKeys: string[];
	collapsedStatusIdsByPreset: Record<string, string[]>;
	collapsedLaneKeysByPreset: Record<string, string[]>;
	collapsedStatusIdsByScope: Record<string, string[]>;
	collapsedLaneKeysByScope: Record<string, string[]>;
	expandedPreviewParentIds: string[];
}

export interface KanbanLeafStateNormalizationOptions {
	availablePresetIds: string[];
	availableStatusIds: string[];
	defaultPresetId: string | null;
	statusCollapseScopeKey?: string | null;
	laneCollapseScopeKey?: string | null;
	availableStatusCollapseScopeKeys?: string[];
	availableLaneCollapseScopeKeys?: string[];
}

export interface KanbanDropContext {
	taskId: string;
	sourceStatusId: string | null;
	sourceLaneKey: string;
	targetStatusId: string;
	targetLaneKey: string;
	swimlaneBy: KanbanSwimlaneBy | null;
	targetBeforeTaskId: string | null;
}

export type KanbanCellActionId = 'pickTask' | 'createFileTask' | 'createInlineTask';

export interface KanbanCellActionContext {
	targetStatusId: string;
	targetStatusLabel: string;
	targetLaneKey: string;
	targetLaneLabel: string;
	swimlaneBy: KanbanSwimlaneBy | null;
	pipelineId: string | null;
}

export interface KanbanViewCallbacks {
	getManualOrder?: (presetId: string) => Record<string, string[]>;
	onCardDrop?: (context: KanbanDropContext) => void | Promise<void>;
	onItemAction?: ContextualMenuActionHandler;
	onOpenTaskSource?: (taskId: string) => void | Promise<void>;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	onOpenPresetSettings?: (presetId: string) => void | Promise<void>;
	onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>;
	onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>;
	onCellAction?: (context: KanbanCellActionContext) => void | Promise<void>;
	updateField?: (operonId: string, key: string, value: string) => void | boolean | Promise<void | boolean>;
	updateFields?: (operonId: string, payload: Record<string, string>) => void | boolean | Promise<void | boolean>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getRepeatSkipSignature?: () => string;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getProjectSerialSignature?: () => string;
	isTaskTracking?: (operonId: string) => boolean;
	toggleTimer?: (operonId: string) => void | Promise<void>;
	getTrackingSignature?: () => string;
}

export const DEFAULT_KANBAN_PRESETS: KanbanPreset[] = [
	{
		id: DEFAULT_KANBAN_PRESET_ID,
		name: DEFAULT_KANBAN_NAME,
		pipelineId: DEFAULT_KANBAN_PIPELINE_ID,
		filterSetId: null,
		swimlaneBy: 'priority',
		colorSource: 'noColor',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		collapseEmptyColumns: true,
		collapseEmptySwimlanes: true,
		autoCollapseFinishedColumns: false,
		sortMode: 'automatic',
		sortRules: createDefaultKanbanSortRules(),
	},
];

export const KANBAN_COLLAPSED_COLUMN_WIDTH_PX = 56;

export function cloneDefaultKanbanPresets(): KanbanPreset[] {
	return DEFAULT_KANBAN_PRESETS.map(preset => ({
		...preset,
		sortMode: preset.sortMode ?? 'automatic',
		sortRules: preset.sortRules.map(rule => ({ ...rule })),
	}));
}

export function createKanbanPresetId(): string {
	return `kp_${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultKanbanSortRules(): KanbanSortRule[] {
	return [{
		field: 'datetimeModified',
		direction: 'desc',
		empty: 'last',
	}];
}

export const KANBAN_BUILT_IN_SWIMLANE_FIELDS: BuiltInKanbanSwimlaneBy[] = [
	'priority',
	'tags',
	'contexts',
	'assignees',
	'dateDue',
	'dateScheduled',
];

const KANBAN_BUILT_IN_SWIMLANE_FIELD_SET = new Set<string>(KANBAN_BUILT_IN_SWIMLANE_FIELDS);

export function isBuiltInKanbanSwimlaneBy(value: string | null | undefined): value is BuiltInKanbanSwimlaneBy {
	return typeof value === 'string' && KANBAN_BUILT_IN_SWIMLANE_FIELD_SET.has(value);
}

export const KANBAN_BUILT_IN_SORT_FIELDS: BuiltInKanbanSortField[] = [
	'alphabetical',
	'priority',
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'dateCompleted',
	'dateCancelled',
	'datetimeCreated',
	'datetimeModified',
	'progress',
	'estimate',
	'duration',
	'totalDuration',
	'totalEstimate',
];

const KANBAN_BUILT_IN_SORT_FIELD_SET = new Set<string>(KANBAN_BUILT_IN_SORT_FIELDS);

export function isBuiltInKanbanSortField(value: string | null | undefined): value is BuiltInKanbanSortField {
	return typeof value === 'string' && KANBAN_BUILT_IN_SORT_FIELD_SET.has(value);
}

const KANBAN_CUSTOM_FIELD_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;

export function normalizeKanbanCustomFieldReference(value: unknown): KanbanCustomFieldKey | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return KANBAN_CUSTOM_FIELD_REFERENCE_PATTERN.test(trimmed) ? trimmed : null;
}

export function buildKanbanStatusCollapseScopeKey(
	presetId: string | null | undefined,
	pipelineId: string | null | undefined,
): string | null {
	const presetPart = normalizeCollapseScopePart(presetId);
	if (!presetPart) return null;
	return `${presetPart}::${normalizeCollapseScopePart(pipelineId) ?? 'none'}`;
}

export function buildKanbanLaneCollapseScopeKey(
	presetId: string | null | undefined,
	pipelineId: string | null | undefined,
	swimlaneBy: KanbanSwimlaneBy | null | undefined,
): string | null {
	const statusScope = buildKanbanStatusCollapseScopeKey(presetId, pipelineId);
	if (!statusScope) return null;
	return `${statusScope}::${normalizeCollapseScopePart(swimlaneBy) ?? 'none'}`;
}

export function normalizeBuiltInKanbanPreset(preset: KanbanPreset): KanbanPreset {
	if (!isLegacyDefaultKanbanPreset(preset)) {
		return {
			...preset,
			sortMode: preset.sortMode ?? 'automatic',
			sortRules: preset.sortRules.map(rule => ({ ...rule })),
		};
	}
	const next = DEFAULT_KANBAN_PRESETS[0];
	return {
		...next,
		sortRules: next.sortRules.map(rule => ({ ...rule })),
	};
}

function isLegacyDefaultKanbanPreset(preset: KanbanPreset): boolean {
	return preset.id === DEFAULT_KANBAN_PRESET_ID
		&& preset.name === LEGACY_DEFAULT_KANBAN_NAME
		&& preset.pipelineId === null
		&& preset.filterSetId === null
		&& preset.swimlaneBy === 'priority'
		&& preset.colorSource === 'taskColor'
		&& preset.appearanceModeLight === 'theme'
		&& preset.appearanceModeDark === 'theme'
		&& preset.collapseEmptyColumns === true
		&& preset.collapseEmptySwimlanes === true
		&& preset.autoCollapseFinishedColumns === true
		&& (preset.sortMode === undefined || preset.sortMode === 'automatic')
		&& preset.sortRules.length === 1
		&& preset.sortRules[0]?.field === 'alphabetical'
		&& preset.sortRules[0]?.direction === 'asc'
		&& preset.sortRules[0]?.empty === 'last';
}

export const KANBAN_SORT_FIELD_OPTIONS: Array<{ value: BuiltInKanbanSortField; label: string }> = [
	{ value: 'alphabetical', label: 'Alphabetical' },
	{ value: 'priority', label: 'Priority' },
	{ value: 'dateDue', label: 'Due date' },
	{ value: 'dateScheduled', label: 'Scheduled date' },
	{ value: 'dateStarted', label: 'Started date' },
	{ value: 'dateCompleted', label: 'Completed date' },
	{ value: 'dateCancelled', label: 'Cancelled date' },
	{ value: 'datetimeCreated', label: 'Created date/time' },
	{ value: 'datetimeModified', label: 'Modified date/time' },
	{ value: 'progress', label: 'Progress' },
	{ value: 'estimate', label: 'Estimate' },
	{ value: 'duration', label: 'Duration' },
	{ value: 'totalDuration', label: 'Total duration' },
	{ value: 'totalEstimate', label: 'Total estimate' },
];

export function normalizeKanbanLeafState(
	state: Partial<KanbanLeafState> | null | undefined,
	options: KanbanLeafStateNormalizationOptions,
): KanbanLeafState {
	const rawState = state ?? {};
	const availableStatusScopeKeys = normalizeAvailableCollapseScopeKeys(options.availableStatusCollapseScopeKeys);
	const availableLaneScopeKeys = normalizeAvailableCollapseScopeKeys(options.availableLaneCollapseScopeKeys);
	const statusCollapseScopeKey = getAvailableCollapseScopeKey(options.statusCollapseScopeKey, availableStatusScopeKeys);
	const laneCollapseScopeKey = getAvailableCollapseScopeKey(options.laneCollapseScopeKey, availableLaneScopeKeys);
	const fallbackPresetId = options.defaultPresetId && options.availablePresetIds.includes(options.defaultPresetId)
		? options.defaultPresetId
		: options.availablePresetIds[0] ?? null;
	const requestedPresetId = typeof rawState.presetId === 'string' && rawState.presetId.trim()
		? rawState.presetId
		: fallbackPresetId;
	const presetId = requestedPresetId && options.availablePresetIds.includes(requestedPresetId)
		? requestedPresetId
		: fallbackPresetId;
	const searchQuery = typeof rawState.searchQuery === 'string' ? rawState.searchQuery.slice(0, 200) : '';
	const collapsedSource = Array.isArray(rawState.collapsedStatusIds) ? rawState.collapsedStatusIds : [];
	const collapsedLaneSource = Array.isArray(rawState.collapsedLaneKeys) ? rawState.collapsedLaneKeys : [];
	const expandedSource = Array.isArray(rawState.expandedPreviewParentIds) ? rawState.expandedPreviewParentIds : [];
	const collapsedStatusIdsByPreset = normalizePresetCollapseMap(rawState.collapsedStatusIdsByPreset, options.availablePresetIds);
	const collapsedLaneKeysByPreset = normalizePresetCollapseMap(rawState.collapsedLaneKeysByPreset, options.availablePresetIds);
	const collapsedStatusIdsByScope = normalizeCollapseScopeMap(rawState.collapsedStatusIdsByScope, availableStatusScopeKeys);
	const collapsedLaneKeysByScope = normalizeCollapseScopeMap(rawState.collapsedLaneKeysByScope, availableLaneScopeKeys);
	const collapsedStatusIds = Array.isArray(rawState.collapsedStatusIds)
		? collapsedSource
			.filter((value): value is string => typeof value === 'string')
			.filter(value => options.availableStatusIds.includes(value))
		: [];
	const collapsedLaneKeys = Array.isArray(rawState.collapsedLaneKeys)
		? collapsedLaneSource.filter((value): value is string => typeof value === 'string' && !!value.trim())
		: [];
	const expandedPreviewParentIds = Array.isArray(rawState.expandedPreviewParentIds)
		? expandedSource.filter((value): value is string => typeof value === 'string' && !!value.trim())
		: [];
	const presetCollapsedStatusIds = presetId
		? collapsedStatusIdsByPreset[presetId]?.filter(value => options.availableStatusIds.includes(value)) ?? []
		: [];
	const presetCollapsedLaneKeys = presetId
		? collapsedLaneKeysByPreset[presetId] ?? []
		: [];
	const hasScopedStatusEntry = hasCollapseMapEntry(collapsedStatusIdsByScope, statusCollapseScopeKey);
	const hasScopedLaneEntry = hasCollapseMapEntry(collapsedLaneKeysByScope, laneCollapseScopeKey);
	const hasPresetStatusEntry = hasCollapseMapEntry(collapsedStatusIdsByPreset, presetId);
	const hasPresetLaneEntry = hasCollapseMapEntry(collapsedLaneKeysByPreset, presetId);
	const activeCollapsedStatusIds = hasScopedStatusEntry && statusCollapseScopeKey
		? collapsedStatusIdsByScope[statusCollapseScopeKey].filter(value => options.availableStatusIds.includes(value))
		: hasPresetStatusEntry
			? presetCollapsedStatusIds
			: collapsedStatusIds;
	const activeCollapsedLaneKeys = hasScopedLaneEntry && laneCollapseScopeKey
		? collapsedLaneKeysByScope[laneCollapseScopeKey]
		: hasPresetLaneEntry
			? presetCollapsedLaneKeys
			: collapsedLaneKeys;
	if (!hasScopedStatusEntry && statusCollapseScopeKey && activeCollapsedStatusIds.length > 0) {
		collapsedStatusIdsByScope[statusCollapseScopeKey] = Array.from(new Set(
			activeCollapsedStatusIds.filter(value => options.availableStatusIds.includes(value)),
		));
	}
	if (!hasScopedLaneEntry && laneCollapseScopeKey && activeCollapsedLaneKeys.length > 0) {
		collapsedLaneKeysByScope[laneCollapseScopeKey] = Array.from(new Set(activeCollapsedLaneKeys));
	}

	return {
		presetId,
		searchQuery,
		collapsedStatusIds: Array.from(new Set(
			activeCollapsedStatusIds
				.filter(value => options.availableStatusIds.includes(value)),
		)),
		collapsedLaneKeys: Array.from(new Set(activeCollapsedLaneKeys)),
		collapsedStatusIdsByPreset,
		collapsedLaneKeysByPreset,
		collapsedStatusIdsByScope,
		collapsedLaneKeysByScope,
		expandedPreviewParentIds: Array.from(new Set(expandedPreviewParentIds)),
	};
}

export function areKanbanLeafStatesEqual(left: KanbanLeafState | null, right: KanbanLeafState | null): boolean {
	if (!left || !right) return left === right;
	return left.presetId === right.presetId
		&& left.searchQuery === right.searchQuery
		&& areOrderedStringArraysEqual(left.collapsedStatusIds, right.collapsedStatusIds)
		&& areOrderedStringArraysEqual(left.collapsedLaneKeys, right.collapsedLaneKeys)
		&& areStringArrayRecordsEqual(left.collapsedStatusIdsByPreset, right.collapsedStatusIdsByPreset)
		&& areStringArrayRecordsEqual(left.collapsedLaneKeysByPreset, right.collapsedLaneKeysByPreset)
		&& areStringArrayRecordsEqual(left.collapsedStatusIdsByScope, right.collapsedStatusIdsByScope)
		&& areStringArrayRecordsEqual(left.collapsedLaneKeysByScope, right.collapsedLaneKeysByScope)
		&& areOrderedStringArraysEqual(left.expandedPreviewParentIds, right.expandedPreviewParentIds);
}

function normalizeCollapseScopePart(value: string | null | undefined): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed || null;
}

function hasCollapseMapEntry(map: Record<string, string[]>, key: string | null | undefined): key is string {
	return typeof key === 'string' && key in map;
}

function normalizePresetCollapseMap(
	raw: unknown,
	availablePresetIds: string[],
): Record<string, string[]> {
	if (!raw || typeof raw !== 'object') return {};
	const allowedPresetIds = new Set(availablePresetIds);
	const normalized: Record<string, string[]> = {};
	const rawPresetMap = raw as Record<string, unknown>;
	for (const [presetId, value] of Object.entries(rawPresetMap)) {
		if (!allowedPresetIds.has(presetId) || !Array.isArray(value)) continue;
		normalized[presetId] = Array.from(new Set(
			value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()),
		));
	}
	return normalized;
}

function normalizeCollapseScopeMap(raw: unknown, availableScopeKeys: Set<string> | null): Record<string, string[]> {
	if (!raw || typeof raw !== 'object') return {};
	const normalized: Record<string, string[]> = {};
	const rawScopeMap = raw as Record<string, unknown>;
	for (const [scopeKey, value] of Object.entries(rawScopeMap)) {
		if (!scopeKey.trim() || !Array.isArray(value)) continue;
		if (availableScopeKeys && !availableScopeKeys.has(scopeKey)) continue;
		normalized[scopeKey] = Array.from(new Set(
			value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()),
		));
	}
	return normalized;
}

function normalizeAvailableCollapseScopeKeys(values: string[] | undefined): Set<string> | null {
	if (!values) return null;
	return new Set(values.filter(value => typeof value === 'string' && !!value.trim()));
}

function getAvailableCollapseScopeKey(key: string | null | undefined, availableScopeKeys: Set<string> | null): string | null {
	if (typeof key !== 'string' || !key.trim()) return null;
	if (availableScopeKeys && !availableScopeKeys.has(key)) return null;
	return key;
}

function areOrderedStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function areStringArrayRecordsEqual(left: Record<string, string[]>, right: Record<string, string[]>): boolean {
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	if (!areOrderedStringArraysEqual(leftKeys, rightKeys)) return false;
	for (const key of leftKeys) {
		if (!areOrderedStringArraysEqual(left[key] ?? [], right[key] ?? [])) return false;
	}
	return true;
}
