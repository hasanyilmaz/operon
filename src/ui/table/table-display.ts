import { formatDurationHuman } from '../../systems/tracker-utils';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { getTableTaskField } from './table-field-catalog';
import type { TableTaskLookup } from './table-value-adapter';

type TableDisplaySettings = Pick<OperonSettings, 'keyMappings'>;

const DURATION_LIKE_TASK_FIELDS = new Set([
	'estimate',
	'duration',
	'totalEstimate',
	'totalDuration',
]);

export interface TableDisplayContext {
	settings: TableDisplaySettings;
	taskLookup?: TableTaskLookup;
}

export function isTableDurationLikeTaskField(
	key: string,
	settings: TableDisplaySettings,
): boolean {
	if (DURATION_LIKE_TASK_FIELDS.has(key)) return true;
	const field = getTableTaskField(key, settings);
	if (field?.group !== 'custom' || field.type !== 'number') return false;
	const normalizedKey = key.toLocaleLowerCase();
	const normalizedLabel = field.label.toLocaleLowerCase();
	return normalizedKey.includes('estimate')
		|| normalizedKey.includes('duration')
		|| normalizedLabel.includes('estimate')
		|| normalizedLabel.includes('duration');
}

export function formatTableTaskValueForDisplay(
	key: string,
	value: string,
	context: TableDisplayContext,
): string {
	if (key === 'parentTask') {
		return formatParentTaskDisplayValue(value, context.taskLookup);
	}
	if (!isTableDurationLikeTaskField(key, context.settings)) return value;
	const seconds = parseTableDurationSeconds(value);
	return seconds === null ? value : formatTableDurationSeconds(seconds);
}

export function formatTableSummaryNumber(
	key: string,
	value: number,
	context: TableDisplayContext,
	formatNumber: (value: number) => string,
): string {
	if (!isTableDurationLikeTaskField(key, context.settings)) return formatNumber(value);
	return formatTableDurationSeconds(value);
}

export function formatTableSummaryScalarValue(
	key: string,
	value: string,
	context: TableDisplayContext,
): string {
	if (!isTableDurationLikeTaskField(key, context.settings)) return value;
	const seconds = parseTableDurationSeconds(value);
	return seconds === null ? value : formatTableDurationSeconds(seconds);
}

function formatParentTaskDisplayValue(value: string, taskLookup: TableTaskLookup | undefined): string {
	const parentId = value.trim();
	if (!parentId) return '';
	const parentTask = taskLookup?.getTask(parentId);
	return formatParentTaskLabel(parentTask, parentId);
}

function formatParentTaskLabel(parentTask: IndexedTask | null | undefined, fallback: string): string {
	const description = parentTask?.description.trim();
	return description || fallback;
}

function parseTableDurationSeconds(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const numericValue = Number(trimmed);
	return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function formatTableDurationSeconds(seconds: number): string {
	return formatDurationHuman(Math.round(seconds));
}
