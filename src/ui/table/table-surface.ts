import type { IndexedTask } from '../../types/fields';
import {
	createDefaultTablePreset,
	resolveTableColumnDisplayMode,
	TABLE_LINE_NUMBER_COLUMN_KEY,
	TABLE_TASK_ICON_COLUMN_KEY,
	TABLE_TASK_TYPE_COLUMN_KEY,
	type TableColumn,
	type TableColumnAlignment,
	type TablePreset,
	type TableAdminColumnKey,
} from '../../types/table';
import type { OperonSettings } from '../../types/settings';
import { createTableGroupPathKey, type TableQueryGroup, type TableQuerySubgroup } from '../../systems/table-query';
import { t } from '../../core/i18n';
import { buildTableTaskFieldCatalog } from './table-field-catalog';
import { orderTablePresetColumnsByPinState } from './table-preset-model';

export const TABLE_ROW_HEIGHT = 38;
export const TABLE_COMFORTABLE_ROW_HEIGHT = 44;
export const TABLE_OVERSCAN_ROWS = 8;
export const TABLE_DEFAULT_BODY_HEIGHT = 520;
export const TABLE_ICON_ONLY_COLUMN_WIDTH = 56;
export const TABLE_SUBGROUP_PARENT_LABEL_MAX_LENGTH = 15;

export type TableRenderItem =
	| { kind: 'group'; group: TableQueryGroup | TableQuerySubgroup; groupKey: string; depth: number; parentGroup?: TableQueryGroup }
	| { kind: 'task'; task: IndexedTask; groupKey: string | null; ordinalKey: string }
	| { kind: 'groupSummary'; group: TableQueryGroup | TableQuerySubgroup; groupKey: string; depth: number }
	| { kind: 'summary' };

export const DEFAULT_TABLE_COLUMN_WIDTHS: Record<string, number> = {
	[TABLE_LINE_NUMBER_COLUMN_KEY]: 45,
	[TABLE_TASK_ICON_COLUMN_KEY]: 46,
	[TABLE_TASK_TYPE_COLUMN_KEY]: 56,
	description: 280,
	status: 160,
	priority: 110,
	dateDue: 160,
	dateScheduled: 160,
	dateStarted: 160,
	dateCompleted: 160,
	dateCancelled: 160,
	datetimeCreated: 180,
	datetimeStart: 180,
	datetimeEnd: 180,
	datetimeRepeatEnd: 180,
	datetimeModified: 180,
	parentTask: 180,
	estimate: 120,
	duration: 120,
	totalEstimate: 140,
	totalDuration: 140,
	source: 220,
};

export interface ResolvedTableColumns {
	taskColumns: TableColumn[];
	renderColumns: TableColumn[];
}

export interface TableColumnGeometryEntry {
	column: TableColumn;
	index: number;
	widthPx: number;
	stickyLeftPx: number;
	pinned: boolean;
	lastPinned: boolean;
}

export interface TableColumnGeometry {
	entries: TableColumnGeometryEntry[];
	columnTemplate: string;
	tableWidthPx: number;
	pinnedBoundaryPx: number;
	lastPinnedIndex: number;
	signature: string;
}

export function buildTableRenderItems(
	rows: readonly IndexedTask[],
	groups: readonly TableQueryGroup[],
	collapsedGroupKeys: readonly string[],
	hasSummaryRow: boolean,
): TableRenderItem[] {
	const taskOccurrenceCounts = new Map<string, number>();
	const createTaskItem = (task: IndexedTask, groupKey: string | null): TableRenderItem => {
		const occurrenceBaseKey = `${groupKey ?? '__ungrouped'}\u0000${task.operonId}`;
		const occurrence = (taskOccurrenceCounts.get(occurrenceBaseKey) ?? 0) + 1;
		taskOccurrenceCounts.set(occurrenceBaseKey, occurrence);
		return {
			kind: 'task',
			task,
			groupKey,
			ordinalKey: `${occurrenceBaseKey}\u0000${occurrence}`,
		};
	};
	const appendSummary = (items: TableRenderItem[]): TableRenderItem[] => {
		if (hasSummaryRow) items.push({ kind: 'summary' });
		return items;
	};
	if (groups.length === 0) {
		return appendSummary(rows.map(task => createTaskItem(task, null)));
	}
	const collapsed = new Set(collapsedGroupKeys);
	const items: TableRenderItem[] = [];
	for (const group of groups) {
		items.push({ kind: 'group', group, groupKey: group.key, depth: 0 });
		if (collapsed.has(group.key)) continue;
		if (group.subgroups?.length) {
			for (const subgroup of group.subgroups) {
				const subgroupKey = createTableGroupPathKey(group.key, subgroup.key);
				items.push({ kind: 'group', group: subgroup, groupKey: subgroupKey, depth: 1, parentGroup: group });
				if (collapsed.has(subgroupKey)) continue;
				for (const task of subgroup.rows) {
					items.push(createTaskItem(task, subgroupKey));
				}
				if (hasSummaryRow) items.push({ kind: 'groupSummary', group: subgroup, groupKey: subgroupKey, depth: 1 });
			}
			continue;
		}
		for (const task of group.rows) {
			items.push(createTaskItem(task, group.key));
		}
		if (hasSummaryRow) items.push({ kind: 'groupSummary', group, groupKey: group.key, depth: 0 });
	}
	return appendSummary(items);
}

export function hasVisibleTableSummaryRule(
	rules: readonly { key: string }[],
	columns: readonly TableColumn[],
): boolean {
	const visibleKeys = new Set(columns.map(column => column.key));
	return rules.some(rule => visibleKeys.has(rule.key));
}

export function resolveTableColumns(preset: TablePreset, settings: OperonSettings): ResolvedTableColumns {
	const taskColumns = resolveVisibleTableColumns(preset, settings);
	const adminColumns: TableColumn[] = [];
	if (settings.tableShowLineNumbers !== false) {
		adminColumns.push(createTableAdminColumn(TABLE_LINE_NUMBER_COLUMN_KEY));
	}
	if (settings.tableShowTaskTypeIcon !== false) {
		adminColumns.push(createTableAdminColumn(TABLE_TASK_TYPE_COLUMN_KEY));
	}
	if (settings.tableShowTaskIcon !== false) {
		adminColumns.push(createTableAdminColumn(TABLE_TASK_ICON_COLUMN_KEY));
	}
	return {
		taskColumns,
		renderColumns: [...adminColumns, ...taskColumns],
	};
}

export function resolveVisibleTableColumns(preset: TablePreset, settings: OperonSettings): TableColumn[] {
	const supportedKeys = new Set(buildTableTaskFieldCatalog(settings).map(field => field.key));
	const allowSource = preset.display.showSource !== false;
	const columns = orderTablePresetColumnsByPinState(preset.columns)
		.filter(column => supportedKeys.has(column.key) && !column.hidden && (allowSource || column.key !== 'source'));
	if (columns.length > 0) return columns;
	const fallback = preset.columns.find(column => supportedKeys.has(column.key) && (allowSource || column.key !== 'source'))
		?? createDefaultTablePreset().columns.find(column => supportedKeys.has(column.key) && (allowSource || column.key !== 'source'));
	return fallback
		? [fallback]
		: createDefaultTablePreset().columns.filter(column => supportedKeys.has(column.key) && (allowSource || column.key !== 'source'));
}

export function resolveTableRowHeight(preset: TablePreset): number {
	return preset.display.density === 'comfortable' ? TABLE_COMFORTABLE_ROW_HEIGHT : TABLE_ROW_HEIGHT;
}

export function buildTableColumnTemplate(columns: readonly TableColumn[]): string {
	return buildTableColumnGeometry(columns).columnTemplate;
}

export function calculateTableMinWidth(columns: readonly TableColumn[]): number {
	return buildTableColumnGeometry(columns).tableWidthPx;
}

export function calculateTableLeadingAdminWidth(columns: readonly TableColumn[]): number {
	let total = 0;
	for (const column of columns) {
		if (!isTableAdminColumn(column)) break;
		total += resolveTableColumnWidth(column);
	}
	return total;
}

export function buildTableColumnGeometry(columns: readonly TableColumn[]): TableColumnGeometry {
	let tableWidthPx = 0;
	let pinnedBoundaryPx = 0;
	let lastPinnedIndex = -1;
	let inPinnedSegment = true;
	const entries: TableColumnGeometryEntry[] = columns.map((column, index): TableColumnGeometryEntry => {
		const widthPx = resolveTableColumnWidth(column);
		const stickyLeftPx = tableWidthPx;
		const pinned = inPinnedSegment && isTableColumnRenderPinned(column);
		if (pinned) {
			pinnedBoundaryPx += widthPx;
			lastPinnedIndex = index;
		} else {
			inPinnedSegment = false;
		}
		tableWidthPx += widthPx;
		return {
			column,
			index,
			widthPx,
			stickyLeftPx,
			pinned,
			lastPinned: false,
		};
	});
	for (const entry of entries) {
		entry.lastPinned = entry.index === lastPinnedIndex;
	}
	return {
		entries,
		columnTemplate: entries.map(entry => `${entry.widthPx}px`).join(' '),
		tableWidthPx,
		pinnedBoundaryPx,
		lastPinnedIndex,
		signature: entries.map(entry => [
			entry.column.kind,
			entry.column.key,
			entry.widthPx,
			entry.column.align ?? 'left',
			entry.column.colorMode ?? '',
			entry.column.displayMode ?? '',
			entry.column.hidden === true ? 'hidden' : 'visible',
			entry.column.pinned === true ? 'pinned' : 'unpinned',
			entry.pinned ? entry.stickyLeftPx : '',
			entry.lastPinned ? 'last' : '',
		].join(':')).join('|'),
	};
}

const tableScrollbarGutterCache = new WeakMap<Document, number>();

export function measureTableScrollbarGutterPx(ownerDocument: Document): number {
	const cached = tableScrollbarGutterCache.get(ownerDocument);
	if (typeof cached === 'number') return cached;
	const body = ownerDocument.body;
	if (!body) return 0;
	const probe = ownerDocument.createElement('div');
	probe.className = 'operon-table-scrollbar-measure';
	body.appendChild(probe);
	const gutter = Math.max(0, probe.offsetWidth - probe.clientWidth);
	probe.remove();
	tableScrollbarGutterCache.set(ownerDocument, gutter);
	return gutter;
}

export function resolveTableColumnWidth(column: TableColumn): number {
	if (column.kind === 'task' && resolveTableColumnDisplayMode(column) === 'icon') {
		return TABLE_ICON_ONLY_COLUMN_WIDTH;
	}
	return column.widthPx ?? DEFAULT_TABLE_COLUMN_WIDTHS[column.key] ?? 150;
}

export function resolveTableColumnAlignment(column: TableColumn): TableColumnAlignment {
	return column.align === 'center' || column.align === 'right' ? column.align : 'left';
}

export function applyTableColumnAlignmentClass(element: HTMLElement, column: TableColumn): void {
	const align = resolveTableColumnAlignment(column);
	element.classList.toggle('is-align-center', align === 'center');
	element.classList.toggle('is-align-right', align === 'right');
}

export function applyTableColumnGeometryClass(element: HTMLElement, entry: TableColumnGeometryEntry | undefined): void {
	const pinned = entry?.pinned === true;
	element.classList.toggle('is-pinned-column', pinned);
	element.classList.toggle('is-last-pinned-column', entry?.lastPinned === true);
	if (pinned && entry) {
		element.style.setProperty('--operon-table-sticky-left', `${entry.stickyLeftPx}px`);
	} else {
		element.style.removeProperty('--operon-table-sticky-left');
	}
}

export function isTableAdminColumn(column: TableColumn): boolean {
	return column.kind === 'admin';
}

export function isTableColumnRenderPinned(column: TableColumn): boolean {
	return isTableAdminColumn(column) || column.pinned === true;
}

export function buildTableTaskOrdinalMap(items: readonly TableRenderItem[]): Map<string, number> {
	const ordinals = new Map<string, number>();
	let ordinal = 0;
	for (const item of items) {
		if (item.kind !== 'task') continue;
		ordinal += 1;
		ordinals.set(item.ordinalKey, ordinal);
	}
	return ordinals;
}

export function resolveTableGroupDisplayLabel(group: TableQueryGroup | TableQuerySubgroup): string {
	return group.isNoValue ? t('table', 'groupNoValue') : group.label;
}

export function truncateTableSubgroupParentLabel(label: string): string {
	return label.length > TABLE_SUBGROUP_PARENT_LABEL_MAX_LENGTH
		? `${label.slice(0, TABLE_SUBGROUP_PARENT_LABEL_MAX_LENGTH)}...`
		: label;
}

export function formatTableTaskCount(count: number): string {
	return t('table', 'taskCount', { count: count.toLocaleString() });
}

export function formatTableSearchPlaceholder(count: number): string {
	return t('table', 'searchPlaceholderWithCount', { count: count.toLocaleString() });
}

function createTableAdminColumn(key: TableAdminColumnKey): TableColumn {
	return { key, kind: 'admin', align: 'center' };
}

export function buildTableEditableCellKey(task: IndexedTask, key: string): string {
	return `${task.operonId}:${key}`;
}
