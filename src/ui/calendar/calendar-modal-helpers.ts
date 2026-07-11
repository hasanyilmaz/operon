import { t } from '../../core/i18n';
import { CalendarWritebackPlan } from '../../types/calendar';
import { IndexedTask } from '../../types/fields';

export const CALENDAR_ASSIGNMENT_FIELDS = [
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
] as const;

export type CalendarAssignmentField = typeof CALENDAR_ASSIGNMENT_FIELDS[number];

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

export function summarizeTaskCalendarAssignment(task: IndexedTask): string[] {
	const summaries: string[] = [];
	const values = task.fieldValues;

	if (values['datetimeStart']?.trim() && values['datetimeEnd']?.trim()) {
		summaries.push(`${values['datetimeStart']} -> ${values['datetimeEnd']}`);
	} else if (values['datetimeStart']?.trim()) {
		summaries.push(t('calendar', 'assignmentStarts', { value: values['datetimeStart'] }));
	}

	if (values['dateScheduled']?.trim()) {
		summaries.push(t('calendar', 'assignmentScheduled', { value: values['dateScheduled'] }));
	}
	if (values['dateStarted']?.trim()) {
		summaries.push(t('calendar', 'assignmentStart', { value: values['dateStarted'] }));
	}
	if (values['dateDue']?.trim()) {
		summaries.push(t('calendar', 'assignmentDue', { value: values['dateDue'] }));
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
			before: before || '—',
			after: after || t('calendar', 'assignmentCleared'),
		});
	}

	return rows;
}
