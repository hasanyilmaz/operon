import { t } from '../../core/i18n';
import { formatUiDate } from '../../core/ui-date-format';
import { CalendarWritebackPlan } from '../../types/calendar';
import { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';

export const CALENDAR_ASSIGNMENT_FIELDS = [
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
] as const;

export type CalendarAssignmentField = typeof CALENDAR_ASSIGNMENT_FIELDS[number];

export interface CalendarAssignmentDisplayOptions {
	settings: Pick<OperonSettings, 'dateDisplayFormat'>;
}

export function taskHasCalendarAssignment(task: IndexedTask): boolean {
	return CALENDAR_ASSIGNMENT_FIELDS.some(key => !!task.fieldValues[key]?.trim());
}

export function buildTaskPickerSearchText(task: IndexedTask): string {
	return [
		task.description,
		task.operonId,
		task.primary.filePath,
		task.fieldValues['status'] ?? '',
		task.fieldValues['dateScheduled'] ?? '',
		task.fieldValues['dateDue'] ?? '',
		task.fieldValues['datetimeStart'] ?? '',
	]
		.filter(Boolean)
		.join(' ');
}

export function getCalendarTaskPickerSortRank(task: IndexedTask): number {
	if (task.checkbox !== 'open') return 2;
	return taskHasCalendarAssignment(task) ? 1 : 0;
}

export function sortCalendarTasksForPicker(tasks: IndexedTask[]): IndexedTask[] {
	// Rank and timestamp are precomputed once per task; the picker re-sorts on
	// every keystroke, so comparator-side Date.parse calls multiply fast.
	return tasks
		.map(task => ({
			task,
			rank: getCalendarTaskPickerSortRank(task),
			modifiedTs: Date.parse(task.datetimeModified || task.fieldValues['datetimeModified'] || '') || 0,
		}))
		.sort((left, right) => {
			if (left.rank !== right.rank) return left.rank - right.rank;
			if (left.modifiedTs !== right.modifiedTs) return right.modifiedTs - left.modifiedTs;
			return left.task.description.localeCompare(right.task.description);
		})
		.map(entry => entry.task);
}

export function summarizeTaskCalendarAssignment(
	task: IndexedTask,
	display?: CalendarAssignmentDisplayOptions,
): string[] {
	const summaries: string[] = [];
	const values = task.fieldValues;

	if (values['datetimeStart']?.trim() && values['datetimeEnd']?.trim()) {
		summaries.push(`${formatCalendarAssignmentValue('datetimeStart', values['datetimeStart'], display)} -> ${formatCalendarAssignmentValue('datetimeEnd', values['datetimeEnd'], display)}`);
	} else if (values['datetimeStart']?.trim()) {
		summaries.push(t('calendar', 'assignmentStarts', {
			value: formatCalendarAssignmentValue('datetimeStart', values['datetimeStart'], display),
		}));
	}

	if (values['dateScheduled']?.trim()) {
		summaries.push(t('calendar', 'assignmentScheduled', {
			value: formatCalendarAssignmentValue('dateScheduled', values['dateScheduled'], display),
		}));
	}
	if (values['dateStarted']?.trim()) {
		summaries.push(t('calendar', 'assignmentStart', {
			value: formatCalendarAssignmentValue('dateStarted', values['dateStarted'], display),
		}));
	}
	if (values['dateDue']?.trim()) {
		summaries.push(t('calendar', 'assignmentDue', {
			value: formatCalendarAssignmentValue('dateDue', values['dateDue'], display),
		}));
	}

	return summaries;
}

export function shouldConfirmCalendarReplacement(
	task: IndexedTask,
	_writebackPlan?: CalendarWritebackPlan | null,
): boolean {
	return taskHasCalendarAssignment(task);
}

export function buildCalendarReplacementDetails(
	task: IndexedTask,
	writebackPlan: CalendarWritebackPlan,
	display?: CalendarAssignmentDisplayOptions,
): Array<{ label: string; before: string; after: string }> {
	const payload = writebackPlan.payload ?? {};
	const rows: Array<{ label: string; before: string; after: string }> = [];
	const labels: Record<CalendarAssignmentField, string> = {
		dateScheduled: t('calendar', 'assignmentLabelScheduled'),
		dateStarted: t('calendar', 'assignmentLabelStartDate'),
		dateDue: t('calendar', 'assignmentLabelDueDate'),
		datetimeStart: t('calendar', 'assignmentLabelStartsAt'),
		datetimeEnd: t('calendar', 'assignmentLabelEndsAt'),
	};

	for (const key of CALENDAR_ASSIGNMENT_FIELDS) {
		const before = task.fieldValues[key]?.trim() ?? '';
		const after = payload[key]?.trim() ?? '';
		if (!before && !after) continue;
		rows.push({
			label: labels[key],
			before: before ? formatCalendarAssignmentValue(key, before, display) : '—',
			after: after ? formatCalendarAssignmentValue(key, after, display) : t('calendar', 'assignmentCleared'),
		});
	}

	return rows;
}

function formatCalendarAssignmentValue(
	key: CalendarAssignmentField,
	value: string,
	display: CalendarAssignmentDisplayOptions | undefined,
): string {
	if (!display) return value;
	if (key !== 'datetimeStart' && key !== 'datetimeEnd') {
		return formatUiDate(value, display.settings);
	}
	const trimmed = value.trim();
	const datePart = /^(\d{4}-\d{2}-\d{2})(?=[T ])/u.exec(trimmed)?.[1];
	return datePart
		? `${formatUiDate(datePart, display.settings)}${trimmed.slice(datePart.length)}`
		: value;
}
