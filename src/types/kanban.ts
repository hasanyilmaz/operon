import type { KanbanTaskColorSource } from '../core/task-color-source';

export type KanbanSwimlaneBy =
	| 'priority'
	| 'tags'
	| 'contexts'
	| 'assignees'
	| 'dateDue'
	| 'dateScheduled';

export type KanbanColorSource = KanbanTaskColorSource;
export type KanbanAppearanceMode = 'theme' | 'anupuccin-light' | 'anupuccin-dark' | 'catppuccin-dark' | 'atom-light' | 'atom-dark' | 'flexoki-light' | 'flexoki-dark';
export type KanbanSortField =
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
	onItemAction?: (
		taskId: string,
		actionId: import('../core/contextual-menu-engine').ContextualMenuActionId,
	) => void | Promise<void>;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	onOpenPresetSettings?: (presetId: string) => void | Promise<void>;
	onCellAction?: (context: KanbanCellActionContext) => void | Promise<void>;
}

export const DEFAULT_KANBAN_PRESETS: KanbanPreset[] = [
	{
		id: DEFAULT_KANBAN_PRESET_ID,
		name: DEFAULT_KANBAN_NAME,
		pipelineId: DEFAULT_KANBAN_PIPELINE_ID,
		filterSetId: null,
		swimlaneBy: 'priority',
		colorSource: 'taskColor',
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

export const KANBAN_SORT_FIELD_OPTIONS: Array<{ value: KanbanSortField; label: string }> = [
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
	const collapsedStatusIdsByScope = normalizeCollapseScopeMap(rawState.collapsedStatusIdsByScope);
	const collapsedLaneKeysByScope = normalizeCollapseScopeMap(rawState.collapsedLaneKeysByScope);
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
	const hasScopedStatusEntry = hasCollapseMapEntry(collapsedStatusIdsByScope, options.statusCollapseScopeKey);
	const hasScopedLaneEntry = hasCollapseMapEntry(collapsedLaneKeysByScope, options.laneCollapseScopeKey);
	const hasPresetStatusEntry = hasCollapseMapEntry(collapsedStatusIdsByPreset, presetId);
	const hasPresetLaneEntry = hasCollapseMapEntry(collapsedLaneKeysByPreset, presetId);
	const activeCollapsedStatusIds = hasScopedStatusEntry && options.statusCollapseScopeKey
		? collapsedStatusIdsByScope[options.statusCollapseScopeKey].filter(value => options.availableStatusIds.includes(value))
		: hasPresetStatusEntry
			? presetCollapsedStatusIds
			: collapsedStatusIds;
	const activeCollapsedLaneKeys = hasScopedLaneEntry && options.laneCollapseScopeKey
		? collapsedLaneKeysByScope[options.laneCollapseScopeKey]
		: hasPresetLaneEntry
			? presetCollapsedLaneKeys
			: collapsedLaneKeys;
	if (!hasScopedStatusEntry && options.statusCollapseScopeKey && activeCollapsedStatusIds.length > 0) {
		collapsedStatusIdsByScope[options.statusCollapseScopeKey] = Array.from(new Set(
			activeCollapsedStatusIds.filter(value => options.availableStatusIds.includes(value)),
		));
	}
	if (!hasScopedLaneEntry && options.laneCollapseScopeKey && activeCollapsedLaneKeys.length > 0) {
		collapsedLaneKeysByScope[options.laneCollapseScopeKey] = Array.from(new Set(activeCollapsedLaneKeys));
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
	for (const [presetId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!allowedPresetIds.has(presetId) || !Array.isArray(value)) continue;
		normalized[presetId] = Array.from(new Set(
			value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()),
		));
	}
	return normalized;
}

function normalizeCollapseScopeMap(raw: unknown): Record<string, string[]> {
	if (!raw || typeof raw !== 'object') return {};
	const normalized: Record<string, string[]> = {};
	for (const [scopeKey, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!scopeKey.trim() || !Array.isArray(value)) continue;
		normalized[scopeKey] = Array.from(new Set(
			value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()),
		));
	}
	return normalized;
}
