import {
	cloneTablePreset,
	cloneTablePresetSearchState,
	createDefaultTableColumn,
	createDefaultTablePreset,
	createTablePresetId,
	normalizeTableColumnColorMode,
	normalizeTableColumnDisplayMode,
	normalizeTableDurationDisplayMode,
	type TableColumn,
	type TableColumnAlignment,
	type TableColumnColorMode,
	type TableColumnDisplayMode,
	type TableDurationDisplayMode,
	type TablePreset,
	type TablePresetPatch,
	type TableSortRule,
	type TableSortDirection,
	type TableSummaryFunction,
} from '../../types/table';
import type { FilterFieldType, OperonSettings } from '../../types/settings';
import { getTableTaskField } from './table-field-catalog';

const TABLE_COLUMN_MIN_WIDTH = 80;
const TABLE_COLUMN_MAX_WIDTH = 640;
type TableColumnDefaultSettings = Pick<OperonSettings, 'keyMappings'>;
export type TableGroupSortPresetPatchScope = 'grouping' | 'sortRules';

function hasTablePresetPatchKey<K extends keyof TablePresetPatch>(patch: TablePresetPatch, key: K): boolean {
	return Object.prototype.hasOwnProperty.call(patch, key) === true;
}

export function createTablePresetFromSource(source: TablePreset | null | undefined, name: string): TablePreset {
	const preset = cloneTablePreset(source ?? createDefaultTablePreset());
	preset.id = createTablePresetId();
	preset.name = name.trim() || createDefaultTablePreset().name;
	return preset;
}

export function normalizeTablePresetForEditing(preset: TablePreset): TablePreset {
	return normalizeTablePresetColumnOrder(cloneTablePreset(preset));
}

export function normalizeTablePresetForColumnUi(preset: TablePreset): TablePreset {
	const draft = cloneTablePreset(preset);
	if (draft.display.showSource === false) {
		const sourceColumn = draft.columns.find(column => column.key === 'source');
		if (sourceColumn) {
			sourceColumn.hidden = true;
		}
		draft.display.showSource = true;
	}
	return normalizeTablePresetColumnOrder(draft);
}

// Base preset for header/popover edits that get persisted. The stored preset must win:
// render presets carry query-resolution artifacts (summaries filtered by key-mapping
// availability, groupBy nulled when its field is unavailable) that must never be
// written back to settings.
export function resolveTableEditingPreset(
	storedPreset: TablePreset | null | undefined,
	renderPreset: TablePreset | null | undefined,
): TablePreset {
	return normalizeTablePresetForEditing(storedPreset ?? renderPreset ?? createDefaultTablePreset());
}

export function applyTablePresetPatch(preset: TablePreset, patch: TablePresetPatch): TablePreset {
	const draft = cloneTablePreset(preset);
	if (hasTablePresetPatchKey(patch, 'name') && patch.name !== undefined) {
		draft.name = patch.name;
	}
	if (hasTablePresetPatchKey(patch, 'filterSetId')) {
		draft.filterSetId = patch.filterSetId ?? null;
	}
	if (patch.columns) {
		draft.columns = replaceTablePresetColumns(draft, patch.columns).columns;
	}
	if (patch.sortRules) {
		draft.sortRules = replaceTablePresetSortRules(draft, patch.sortRules).sortRules;
	}
	if (hasTablePresetPatchKey(patch, 'groupBy')) {
		draft.groupBy = patch.groupBy?.trim() || null;
	}
	if (hasTablePresetPatchKey(patch, 'groupOrder') && patch.groupOrder !== undefined) {
		draft.groupOrder = draft.groupBy ? normalizeTablePresetSortDirection(patch.groupOrder) : 'asc';
	}
	if (hasTablePresetPatchKey(patch, 'subgroupBy')) {
		const subgroupBy = patch.subgroupBy?.trim() || null;
		draft.subgroupBy = draft.groupBy && subgroupBy && subgroupBy !== draft.groupBy ? subgroupBy : null;
	}
	if (hasTablePresetPatchKey(patch, 'subgroupOrder') && patch.subgroupOrder !== undefined) {
		draft.subgroupOrder = draft.subgroupBy ? normalizeTablePresetSortDirection(patch.subgroupOrder) : 'asc';
	}
	if (!draft.groupBy) {
		draft.groupOrder = 'asc';
		draft.subgroupBy = null;
		draft.subgroupOrder = 'asc';
	} else if (draft.subgroupBy === draft.groupBy) {
		draft.subgroupBy = null;
		draft.subgroupOrder = 'asc';
	}
	if (patch.summaries) {
		draft.summaries = patch.summaries.map(summary => ({ ...summary }));
	}
	if (patch.display) {
		draft.display = { ...patch.display };
	}
	if (patch.search) {
		draft.search = cloneTablePresetSearchState(patch.search);
	}
	return patch.columns ? normalizeTablePresetColumnOrder(draft) : draft;
}

export function buildTableGroupSortPresetPatch(
	updatedPreset: TablePreset,
	scope: TableGroupSortPresetPatchScope,
): TablePresetPatch {
	if (scope === 'grouping') {
		return {
			id: updatedPreset.id,
			groupBy: updatedPreset.groupBy,
			groupOrder: updatedPreset.groupOrder,
			subgroupBy: updatedPreset.subgroupBy,
			subgroupOrder: updatedPreset.subgroupOrder,
		};
	}
	return {
		id: updatedPreset.id,
		sortRules: updatedPreset.sortRules.map(rule => ({ ...rule })),
	};
}

export function orderTablePresetColumnsByPinState(columns: readonly TableColumn[]): TableColumn[] {
	const visiblePinned: TableColumn[] = [];
	const visibleUnpinned: TableColumn[] = [];
	const hidden: TableColumn[] = [];
	for (const column of columns) {
		if (column.hidden === true) {
			hidden.push(column);
		} else if (isTablePresetColumnPinned(column)) {
			visiblePinned.push(column);
		} else {
			visibleUnpinned.push(column);
		}
	}
	return [...visiblePinned, ...visibleUnpinned, ...hidden];
}

export function filterTablePresetColumnsBySupportedKeys(
	preset: TablePreset,
	supportedKeys: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const seen = new Set<string>();
	draft.columns = draft.columns.filter(column => {
		const key = column.key.trim();
		if (!key || !supportedKeys.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	if (draft.columns.length === 0) {
		draft.columns = createDefaultTablePreset().columns
			.filter(column => supportedKeys.has(column.key))
			.map(column => ({ ...column }));
	}
	return normalizeTablePresetColumnOrder(draft);
}

export function setTablePresetColumnVisible(
	preset: TablePreset,
	key: string,
	visible: boolean,
	settings?: TableColumnDefaultSettings,
): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (column) {
		if (!visible) {
			const visibleTaskColumnCount = draft.columns.filter(entry => entry.kind === 'task' && !entry.hidden).length;
			if (visibleTaskColumnCount <= 1 && column.hidden !== true) return draft;
		}
		column.hidden = visible ? undefined : true;
		return normalizeTablePresetColumnOrder(draft);
	}
	if (visible) {
		draft.columns.push(createTableColumn(normalizedKey, settings));
	}
	return normalizeTablePresetColumnOrder(draft);
}

export function setTablePresetColumnAlignment(
	preset: TablePreset,
	key: string,
	align: TableColumnAlignment,
): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	if (align === 'left') {
		delete column.align;
		return draft;
	}
	column.align = align;
	return draft;
}

export function setTablePresetColumnPinned(preset: TablePreset, key: string, pinned: boolean): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	if (pinned) {
		column.pinned = true;
	} else {
		delete column.pinned;
	}
	return normalizeTablePresetColumnOrder(draft);
}

export function setTablePresetColumnColorMode(
	preset: TablePreset,
	key: string,
	mode: TableColumnColorMode,
): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	const colorMode = normalizeTableColumnColorMode(mode, normalizedKey);
	if (colorMode) {
		column.colorMode = colorMode;
	} else {
		delete column.colorMode;
	}
	return draft;
}

export function setTablePresetColumnDurationDisplayMode(
	preset: TablePreset,
	key: string,
	mode: TableDurationDisplayMode,
): TablePreset {
	const normalizedKey = key.trim();
	if (normalizedKey !== 'duration') return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	const durationDisplayMode = normalizeTableDurationDisplayMode(mode, normalizedKey);
	if (durationDisplayMode) {
		column.durationDisplayMode = durationDisplayMode;
	} else {
		delete column.durationDisplayMode;
	}
	return draft;
}

export function setTablePresetColumnDisplayMode(
	preset: TablePreset,
	key: string,
	mode: TableColumnDisplayMode,
	settings: Pick<OperonSettings, 'keyMappings'>,
): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	const displayMode = normalizeTableColumnDisplayMode(mode);
	if (displayMode) {
		if (!getTableTaskField(normalizedKey, settings)?.icon) return draft;
		column.displayMode = displayMode;
	} else {
		delete column.displayMode;
	}
	return draft;
}

export function insertTablePresetColumnNear(
	preset: TablePreset,
	key: string,
	anchorKey: string,
	side: 'left' | 'right',
	settings?: TableColumnDefaultSettings,
): TablePreset {
	const normalizedKey = key.trim();
	const normalizedAnchorKey = anchorKey.trim();
	if (!normalizedKey || !normalizedAnchorKey || normalizedKey === normalizedAnchorKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const sourceIndex = draft.columns.findIndex(column => column.key === normalizedKey);
	const restoringExistingColumn = sourceIndex >= 0;
	const [column] = sourceIndex >= 0
		? draft.columns.splice(sourceIndex, 1)
		: [createTableColumn(normalizedKey, settings)];
	if (!column) return draft;
	column.hidden = undefined;
	const anchorIndex = draft.columns.findIndex(entry => entry.key === normalizedAnchorKey);
	if (anchorIndex === -1) {
		draft.columns.push(column);
		return normalizeTablePresetColumnOrder(draft);
	}
	const anchorColumn = draft.columns[anchorIndex];
	if (restoringExistingColumn && anchorColumn) {
		if (isTablePresetColumnPinned(anchorColumn)) {
			column.pinned = true;
		} else {
			delete column.pinned;
		}
	}
	draft.columns.splice(side === 'left' ? anchorIndex : anchorIndex + 1, 0, column);
	return normalizeTablePresetColumnOrder(draft);
}

export function moveTablePresetColumn(preset: TablePreset, fromKey: string, toKey: string): TablePreset {
	const draft = cloneTablePreset(preset);
	const fromIndex = draft.columns.findIndex(column => column.key === fromKey);
	const toIndex = draft.columns.findIndex(column => column.key === toKey);
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return draft;
	const fromColumn = draft.columns[fromIndex];
	const toColumn = draft.columns[toIndex];
	if (!fromColumn || !toColumn || isTablePresetColumnPinned(fromColumn) !== isTablePresetColumnPinned(toColumn)) {
		return draft;
	}
	const [column] = draft.columns.splice(fromIndex, 1);
	if (!column) return draft;
	draft.columns.splice(toIndex, 0, column);
	return normalizeTablePresetColumnOrder(draft);
}

export function moveTablePresetColumnByDelta(preset: TablePreset, key: string, delta: -1 | 1): TablePreset {
	const targetKey = getTablePresetColumnMoveTargetKey(preset, key, delta);
	return targetKey ? moveTablePresetColumn(preset, key, targetKey) : cloneTablePreset(preset);
}

export function getTablePresetColumnMoveTargetKey(preset: TablePreset, key: string, delta: -1 | 1): string | null {
	const normalizedKey = key.trim();
	if (!normalizedKey) return null;
	const visibleColumns = orderTablePresetColumnsByPinState(preset.columns).filter(column => !column.hidden);
	const visibleIndex = visibleColumns.findIndex(column => column.key === normalizedKey);
	if (visibleIndex === -1) return null;
	const source = visibleColumns[visibleIndex];
	const target = visibleColumns[visibleIndex + delta];
	if (!source || !target) return null;
	return isTablePresetColumnPinned(source) === isTablePresetColumnPinned(target) ? target.key : null;
}

export function resizeTablePresetColumn(preset: TablePreset, key: string, widthPx: number): TablePreset {
	const draft = cloneTablePreset(preset);
	let column = draft.columns.find(entry => entry.key === key);
	if (!column) {
		column = createTableColumn(key);
		draft.columns.push(column);
	}
	column.widthPx = normalizeTableColumnWidth(widthPx);
	return draft;
}

export function resetTablePresetColumnWidth(preset: TablePreset, key: string): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const column = draft.columns.find(entry => entry.key === normalizedKey);
	if (!column) return draft;
	delete column.widthPx;
	return draft;
}

export function replaceTablePresetColumns(preset: TablePreset, columns: readonly TableColumn[]): TablePreset {
	const draft = cloneTablePreset(preset);
	const seen = new Set<string>();
	draft.columns = columns
		.map(column => ({ ...column, kind: 'task' as const }))
		.filter(column => {
			if (!column.key.trim() || seen.has(column.key)) return false;
			seen.add(column.key);
			if (column.widthPx !== undefined) {
				column.widthPx = normalizeTableColumnWidth(column.widthPx);
			}
			if (column.pinned !== true) {
				delete column.pinned;
			}
			const colorMode = normalizeTableColumnColorMode(column.colorMode, column.key);
			if (colorMode) {
				column.colorMode = colorMode;
			} else {
				delete column.colorMode;
			}
			const durationDisplayMode = normalizeTableDurationDisplayMode(column.durationDisplayMode, column.key);
			if (durationDisplayMode) {
				column.durationDisplayMode = durationDisplayMode;
			} else {
				delete column.durationDisplayMode;
			}
			const displayMode = normalizeTableColumnDisplayMode(column.displayMode);
			if (displayMode) {
				column.displayMode = displayMode;
			} else {
				delete column.displayMode;
			}
			return true;
		});
	if (draft.columns.length === 0) {
		draft.columns = cloneTablePreset(createDefaultTablePreset()).columns;
	}
	return normalizeTablePresetColumnOrder(draft);
}

export function filterTablePresetSortRulesBySupportedKeys(
	preset: TablePreset,
	supportedKeys: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const seen = new Set<string>();
	draft.sortRules = draft.sortRules.filter(rule => {
		const key = rule.key.trim();
		if (!key || !supportedKeys.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return draft;
}

export function filterTablePresetGroupByBySupportedKeys(
	preset: TablePreset,
	supportedKeys: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const groupBy = draft.groupBy?.trim();
	draft.groupBy = groupBy && supportedKeys.has(groupBy) ? groupBy : null;
	draft.groupOrder = draft.groupBy ? normalizeTablePresetSortDirection(draft.groupOrder) : 'asc';
	const subgroupBy = draft.subgroupBy?.trim();
	draft.subgroupBy = draft.groupBy && subgroupBy && subgroupBy !== draft.groupBy && supportedKeys.has(subgroupBy)
		? subgroupBy
		: null;
	draft.subgroupOrder = draft.subgroupBy ? normalizeTablePresetSortDirection(draft.subgroupOrder) : 'asc';
	return draft;
}

export function setTablePresetGroupBy(
	preset: TablePreset,
	groupBy: string | null | undefined,
	supportedKeys?: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const normalizedGroupBy = groupBy?.trim() || null;
	draft.groupBy = normalizedGroupBy && (!supportedKeys || supportedKeys.has(normalizedGroupBy))
		? normalizedGroupBy
		: null;
	if (!draft.groupBy) {
		draft.groupOrder = 'asc';
		draft.subgroupBy = null;
		draft.subgroupOrder = 'asc';
	} else if (draft.subgroupBy === draft.groupBy || (supportedKeys && draft.subgroupBy && !supportedKeys.has(draft.subgroupBy))) {
		draft.subgroupBy = null;
		draft.subgroupOrder = 'asc';
	}
	return draft;
}

export function setTablePresetGroupOrder(
	preset: TablePreset,
	groupOrder: TableSortDirection,
): TablePreset {
	const draft = cloneTablePreset(preset);
	draft.groupOrder = draft.groupBy ? normalizeTablePresetSortDirection(groupOrder) : 'asc';
	return draft;
}

export function setTablePresetSubgroupBy(
	preset: TablePreset,
	subgroupBy: string | null | undefined,
	supportedKeys?: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const normalizedSubgroupBy = subgroupBy?.trim() || null;
	draft.subgroupBy = draft.groupBy
		&& normalizedSubgroupBy
		&& normalizedSubgroupBy !== draft.groupBy
		&& (!supportedKeys || supportedKeys.has(normalizedSubgroupBy))
		? normalizedSubgroupBy
		: null;
	draft.subgroupOrder = draft.subgroupBy ? normalizeTablePresetSortDirection(draft.subgroupOrder) : 'asc';
	return draft;
}

export function setTablePresetSubgroupOrder(
	preset: TablePreset,
	subgroupOrder: TableSortDirection,
): TablePreset {
	const draft = cloneTablePreset(preset);
	draft.subgroupOrder = draft.subgroupBy ? normalizeTablePresetSortDirection(subgroupOrder) : 'asc';
	return draft;
}

export function replaceTablePresetSortRules(
	preset: TablePreset,
	sortRules: readonly TableSortRule[],
	supportedKeys?: ReadonlySet<string>,
): TablePreset {
	const draft = cloneTablePreset(preset);
	const seen = new Set<string>();
	draft.sortRules = sortRules
		.map(rule => ({
			key: rule.key.trim(),
			direction: rule.direction === 'desc' ? 'desc' as const : 'asc' as const,
			empty: rule.empty === 'first' ? 'first' as const : 'last' as const,
		}))
		.filter(rule => {
			if (!rule.key || seen.has(rule.key)) return false;
			if (supportedKeys && !supportedKeys.has(rule.key)) return false;
			seen.add(rule.key);
			return true;
		});
	return draft;
}

export function setTablePresetSummary(
	preset: TablePreset,
	key: string,
	summaryFunction: TableSummaryFunction,
	supportedKeys?: ReadonlySet<string>,
): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey || (supportedKeys && !supportedKeys.has(normalizedKey))) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const existing = draft.summaries.find(summary => summary.key === normalizedKey);
	if (existing) {
		existing.function = summaryFunction;
		return draft;
	}
	draft.summaries.push({ key: normalizedKey, function: summaryFunction });
	return draft;
}

export function clearTablePresetSummary(preset: TablePreset, key: string): TablePreset {
	const normalizedKey = key.trim();
	const draft = cloneTablePreset(preset);
	draft.summaries = draft.summaries.filter(summary => summary.key !== normalizedKey);
	return draft;
}

export function cycleTablePresetPrimarySort(preset: TablePreset, key: string): TablePreset {
	const normalizedKey = key.trim();
	if (!normalizedKey) return cloneTablePreset(preset);
	const draft = cloneTablePreset(preset);
	const currentRules = draft.sortRules.filter(rule => rule.key !== normalizedKey);
	const activeRule = draft.sortRules[0]?.key === normalizedKey
		? draft.sortRules[0]
		: null;
	if (!activeRule) {
		draft.sortRules = [{ key: normalizedKey, direction: 'asc', empty: 'last' }, ...currentRules];
		return draft;
	}
	if (activeRule.direction === 'asc') {
		draft.sortRules = [{ key: normalizedKey, direction: 'desc', empty: activeRule.empty }, ...currentRules];
		return draft;
	}
	draft.sortRules = currentRules;
	return draft;
}

export function normalizeTableColumnWidth(widthPx: number): number {
	if (!Number.isFinite(widthPx)) return TABLE_COLUMN_MIN_WIDTH;
	return Math.max(TABLE_COLUMN_MIN_WIDTH, Math.min(TABLE_COLUMN_MAX_WIDTH, Math.round(widthPx)));
}

function createTableColumn(key: string, settings?: TableColumnDefaultSettings): TableColumn {
	const column = createDefaultTableColumn(key);
	const field = settings ? getTableTaskField(key, settings) : null;
	if (field?.group !== 'custom') return column;
	const align = getDefaultCustomTableColumnAlignment(field.type);
	if (align === 'left') {
		delete column.align;
	} else {
		column.align = align;
	}
	const widthPx = getDefaultCustomTableColumnWidth(field.type);
	if (widthPx !== null) {
		column.widthPx = widthPx;
	}
	return column;
}

function getDefaultCustomTableColumnAlignment(type: FilterFieldType): TableColumnAlignment {
	if (type === 'number') return 'right';
	if (type === 'date' || type === 'datetime' || type === 'checkbox') return 'center';
	return 'left';
}

function getDefaultCustomTableColumnWidth(type: FilterFieldType): number | null {
	if (type === 'date') return 160;
	if (type === 'datetime') return 180;
	return null;
}

function normalizeTablePresetColumnOrder(preset: TablePreset): TablePreset {
	preset.columns = orderTablePresetColumnsByPinState(preset.columns);
	return preset;
}

function isTablePresetColumnPinned(column: TableColumn): boolean {
	return column.kind === 'task' && column.pinned === true;
}

function normalizeTablePresetSortDirection(value: TableSortDirection | undefined): TableSortDirection {
	return value === 'desc' ? 'desc' : 'asc';
}
