import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { ManualDatePickerOptions } from '../field-pickers/date-picker';

const TABLE_DIRECT_DATE_PICKER_KEYS = new Set([
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'dateCompleted',
	'dateCancelled',
]);

export function normalizeTablePickerPayload(payload: Record<string, string | string[]>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [rawKey, rawValue] of Object.entries(payload)) {
		const key = rawKey === 'tags' ? '_tags' : rawKey;
		normalized[key] = Array.isArray(rawValue)
			? rawValue.map(value => key === '_tags' ? normalizeTagPickerValue(value) : value).join('; ')
			: key === '_tags' ? normalizeTagPickerValue(rawValue) : rawValue;
	}
	return normalized;
}

export function getExcludedTablePickerTaskIds(key: string, task: IndexedTask, allTasks: readonly IndexedTask[]): string[] {
	if (key !== 'parentTask') return task.operonId ? [task.operonId] : [];
	const excluded = new Set<string>();
	if (task.operonId) {
		excluded.add(task.operonId);
		collectDescendantTaskIds(task.operonId, allTasks, excluded);
	}
	return [...excluded];
}

export function getTableManualDatePickerOptions(
	key: string,
	settings: Pick<OperonSettings, 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'>,
): ManualDatePickerOptions | undefined {
	if (!TABLE_DIRECT_DATE_PICKER_KEYS.has(key)) return undefined;
	return {
		weekStart: settings.calendarWeekStart,
		showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
	};
}

export function formatTableTrackerSessionRange(start: string, end: string): string {
	const startDate = start.substring(0, 10);
	const endDate = end.substring(0, 10);
	const startTime = formatTrackerSessionTime(start);
	const endTime = formatTrackerSessionTime(end);
	if (startDate && startDate === endDate) return `${startDate} ${startTime}-${endTime}`;
	return `${startDate || start} ${startTime} - ${endDate || end} ${endTime}`;
}

function formatTrackerSessionTime(value: string): string {
	const time = value.includes('T') ? value.substring(value.indexOf('T') + 1) : value;
	const [hours = '00', minutes = '00', seconds = '00'] = time.split(':');
	return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.substring(0, 2).padStart(2, '0')}`;
}

function normalizeTagPickerValue(value: string): string {
	return value.trim().replace(/^#+/, '');
}

function collectDescendantTaskIds(parentId: string, allTasks: readonly IndexedTask[], excluded: Set<string>): void {
	for (const candidate of allTasks) {
		if ((candidate.fieldValues['parentTask'] ?? '').trim() !== parentId) continue;
		if (excluded.has(candidate.operonId)) continue;
		excluded.add(candidate.operonId);
		collectDescendantTaskIds(candidate.operonId, allTasks, excluded);
	}
}
