import { localToday } from './local-time';

export type TaskDateTone = 'default' | 'today' | 'overdue';

export const TASK_DATE_TONE_TODAY_COLOR = '#2563eb';
export const TASK_DATE_TONE_OVERDUE_COLOR = '#dc2626';

export function resolveTaskDateTone(
	key: string,
	value: string,
	fieldValues: Partial<Record<string, string | undefined>> = {},
): TaskDateTone {
	if (key !== 'dateScheduled' && key !== 'dateDue') return 'default';
	if (hasTerminalTaskDate(fieldValues)) return 'default';
	if (!isValidDateKey(value)) return 'default';

	const today = localToday();
	if (value < today) return 'overdue';
	if (value === today) return 'today';
	return 'default';
}

export function resolveTaskDateToneColor(tone: TaskDateTone): string | null {
	if (tone === 'today') return TASK_DATE_TONE_TODAY_COLOR;
	if (tone === 'overdue') return TASK_DATE_TONE_OVERDUE_COLOR;
	return null;
}

function hasTerminalTaskDate(fieldValues: Partial<Record<string, string | undefined>>): boolean {
	return !!fieldValues.dateCompleted?.trim() || !!fieldValues.dateCancelled?.trim();
}

function isValidDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
