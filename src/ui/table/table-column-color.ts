import { normalizeColorPalette } from '../../core/color-palette';
import {
	normalizeColor,
	normalizeTaskFieldColor,
	resolveTaskColorSourceForTask,
} from '../../core/task-color-source';
import { resolveTaskDateTone, resolveTaskDateToneColor } from '../../core/task-date-tone';
import type { IndexedTask } from '../../types/fields';
import { findStatusDef } from '../../types/pipeline';
import type { OperonSettings } from '../../types/settings';
import {
	getDefaultTableColumnColorMode,
	type TableColumn,
	type TableColumnColorMode,
} from '../../types/table';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';

export const TABLE_COLUMN_COLOR_MENU_MODES: readonly TableColumnColorMode[] = [
	'noColor',
	'taskColor',
	'priorityColor',
	'statusColor',
	'randomColors',
];

type TableColumnColorSettings = Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'>;

const TABLE_COLUMN_COLOR_INELIGIBLE_KEYS = new Set(['description', 'source', 'duration']);

export function isTableColumnColorModeEligible(column: TableColumn): boolean {
	return column.kind === 'task' && !TABLE_COLUMN_COLOR_INELIGIBLE_KEYS.has(column.key);
}

export function resolveEffectiveTableColumnColorMode(column: Pick<TableColumn, 'key' | 'colorMode'>): TableColumnColorMode {
	return column.colorMode ?? getDefaultTableColumnColorMode(column.key);
}

export function resolveTableColumnCellAccent(
	column: Pick<TableColumn, 'key' | 'colorMode'>,
	value: string,
	options: {
		task?: IndexedTask;
		settings?: TableColumnColorSettings;
		workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	} = {},
): string | null {
	const settings = options.settings;
	if (!settings) return null;
	const colorMode = resolveEffectiveTableColumnColorMode(column);
	if (colorMode === 'noColor') return null;
	if (colorMode === 'randomColors') {
		return resolveTableRandomColumnColor(column.key, value, settings);
	}
	if (options.task) {
		return resolveTaskColorSourceForTask(
			options.task,
			colorMode,
			settings,
			options.workflowStatusIdentityIndex,
		);
	}
	return resolveTableColorModeFromValue(
		column.key,
		value,
		colorMode,
		settings,
		options.workflowStatusIdentityIndex,
	);
}

export function resolveTableIconOnlyCellAccent(
	column: Pick<TableColumn, 'key' | 'colorMode'>,
	value: string,
	options: {
		task?: IndexedTask;
		settings?: TableColumnColorSettings;
		workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	} = {},
): string | null {
	const dateStateAccent = resolveTaskDateToneColor(resolveTaskDateTone(column.key, value, options.task?.fieldValues ?? {}));
	return dateStateAccent ?? resolveTableColumnCellAccent(column, value, options);
}

export function normalizeTableRandomColorValue(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveTableRandomColumnColor(
	columnKey: string,
	value: string,
	settings: TableColumnColorSettings,
): string | null {
	const normalizedValue = normalizeTableRandomColorValue(value);
	if (!normalizedValue) return null;
	const palette = normalizeColorPalette(settings.colorPalette);
	if (palette.length === 0) return null;
	const hash = hashTableColumnColorKey(`${columnKey}\u001F${normalizedValue}`);
	const entry = palette[hash % palette.length];
	return normalizeColor(entry?.hex);
}

function resolveTableColorModeFromValue(
	columnKey: string,
	value: string,
	colorMode: Exclude<TableColumnColorMode, 'noColor' | 'randomColors'>,
	settings: TableColumnColorSettings,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string | null {
	if (colorMode === 'taskColor') {
		return columnKey === 'taskColor' ? normalizeTaskFieldColor(value) : null;
	}
	if (colorMode === 'statusColor') {
		return normalizeColor(findStatusDef(settings.pipelines, value, workflowStatusIdentityIndex)?.color);
	}
	const priorityDef = settings.priorities.find(priority => priority.label === value);
	return normalizeColor(priorityDef?.color);
}

function hashTableColumnColorKey(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
