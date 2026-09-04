import { toLocalDatetime } from '../core/local-time';
import { CalendarSlotSelection, CalendarWritebackPlan } from '../types/calendar';

export const CALENDAR_TIMED_SNAP_MINUTES = 15;
export const CALENDAR_DAILY_INLINE_HEADING_PLACEHOLDER = '## New Todo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_INLINE_HEADING_RE = /^#{1,6}\s+\S.*$/;

export interface InlineHeadingInsertionResult {
	content: string;
	insertedLineNumber: number;
}

export function isValidCalendarInlineHeading(raw: string): boolean {
	return CALENDAR_INLINE_HEADING_RE.test(raw.trim());
}

export function resolveCalendarInlineHeading(raw: string): string {
	const trimmed = raw.trim();
	return isValidCalendarInlineHeading(trimmed)
		? trimmed
		: CALENDAR_DAILY_INLINE_HEADING_PLACEHOLDER;
}

export function buildTimedSlotSelection(
	dateKey: string,
	startMinuteOfDay: number,
	endMinuteOfDay: number,
	snapMinutes = CALENDAR_TIMED_SNAP_MINUTES,
): CalendarSlotSelection {
	const safeSnapMinutes = Math.max(1, Math.round(snapMinutes || CALENDAR_TIMED_SNAP_MINUTES));
	const snappedStart = snapCalendarMinute(startMinuteOfDay, safeSnapMinutes);
	const snappedEnd = snapCalendarMinute(endMinuteOfDay, safeSnapMinutes);

	let rangeStart = Math.min(snappedStart, snappedEnd);
	let rangeEnd = Math.max(snappedStart, snappedEnd);
	if (rangeEnd <= rangeStart) {
		rangeEnd = Math.min(24 * 60, rangeStart + safeSnapMinutes);
	}
	if (rangeEnd <= rangeStart) {
		rangeStart = Math.max(0, rangeEnd - safeSnapMinutes);
	}

	return {
		mode: 'timed',
		start: formatDateKeyMinuteOfDay(dateKey, rangeStart),
		end: formatDateKeyMinuteOfDay(dateKey, rangeEnd),
		startDate: dateKey,
		endDate: dateKey,
		isAllDay: false,
		slotMinutes: safeSnapMinutes,
	};
}

export function buildTimedCalendarWritebackPlan(selection: CalendarSlotSelection): CalendarWritebackPlan {
	const minimumDurationMinutes = selection.mode === 'timed'
		? Math.max(1, Math.round(selection.slotMinutes || CALENDAR_TIMED_SNAP_MINUTES))
		: CALENDAR_TIMED_SNAP_MINUTES;
	const start = normalizeSelectionBoundary(selection.startDate, selection.start);
	const end = normalizeSelectionBoundary(selection.endDate, selection.end);
	const startDate = start.slice(0, 10);

	let startDateObject = parseSelectionDateTime(start);
	let endDateObject = parseSelectionDateTime(end);
	if (!startDateObject || !endDateObject || endDateObject.getTime() <= startDateObject.getTime()) {
		startDateObject = parseSelectionDateTime(start);
		endDateObject = startDateObject ? new Date(startDateObject.getTime() + minimumDurationMinutes * 60000) : null;
	}

	const datetimeStart = startDateObject ? toLocalDatetime(startDateObject) : start;
	const datetimeEnd = endDateObject ? toLocalDatetime(endDateObject) : end;
	const estimateSeconds = startDateObject && endDateObject
		? Math.max(minimumDurationMinutes * 60, Math.round((endDateObject.getTime() - startDateObject.getTime()) / 1000))
		: minimumDurationMinutes * 60;

	return {
		payload: {
			dateScheduled: startDate,
			datetimeStart,
			datetimeEnd,
			estimate: String(estimateSeconds),
		},
	};
}

export function getTimedCalendarSelectionDurationSeconds(selection: CalendarSlotSelection): number {
	if (selection.mode !== 'timed') return 0;
	const start = parseSelectionDateTime(normalizeSelectionBoundary(selection.startDate, selection.start));
	const end = parseSelectionDateTime(normalizeSelectionBoundary(selection.endDate, selection.end));
	if (!start || !end) return 0;
	return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

export function deriveTimedTaskDurationSeconds(
	currentFields: Record<string, string>,
	minimumDurationMinutes = CALENDAR_TIMED_SNAP_MINUTES,
): number {
	const minimumDurationSeconds = Math.max(1, Math.round(minimumDurationMinutes || CALENDAR_TIMED_SNAP_MINUTES)) * 60;
	const estimate = Number.parseInt((currentFields['estimate'] ?? '').trim(), 10);
	if (Number.isFinite(estimate) && estimate > 0) {
		return estimate;
	}

	const currentStart = parseSelectionDateTime(currentFields['datetimeStart'] ?? '');
	const currentEnd = parseSelectionDateTime(currentFields['datetimeEnd'] ?? '');
	if (!currentStart || !currentEnd || currentEnd.getTime() <= currentStart.getTime()) {
		return minimumDurationSeconds;
	}

	return Math.max(
		minimumDurationSeconds,
		Math.round((currentEnd.getTime() - currentStart.getTime()) / 1000),
	);
}

export function buildTimedCalendarWritebackPlanForExistingTask(
	selection: CalendarSlotSelection,
	currentFields: Record<string, string>,
	options: { preserveExistingDuration?: boolean } = {},
): CalendarWritebackPlan {
	const basePlan = buildTimedCalendarWritebackPlan(selection);
	if (selection.mode !== 'timed') return basePlan;
	const minimumDurationSeconds = Math.max(1, Math.round(selection.slotMinutes || CALENDAR_TIMED_SNAP_MINUTES)) * 60;
	const shouldPreserveExistingDuration = options.preserveExistingDuration === true
		|| getTimedCalendarSelectionDurationSeconds(selection) <= minimumDurationSeconds;
	if (!shouldPreserveExistingDuration) {
		return basePlan;
	}

	const start = parseSelectionDateTime(normalizeSelectionBoundary(selection.startDate, selection.start));
	if (!start) return basePlan;

	const durationSeconds = deriveTimedTaskDurationSeconds(currentFields, selection.slotMinutes);
	const end = new Date(start.getTime() + durationSeconds * 1000);

	return {
		payload: {
			dateScheduled: selection.startDate,
			datetimeStart: toLocalDatetime(start),
			datetimeEnd: toLocalDatetime(end),
			estimate: String(durationSeconds),
		},
	};
}

export function buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
	selection: CalendarSlotSelection,
	currentFields: Record<string, string>,
	options: { preserveExistingDuration?: boolean } = {},
): CalendarWritebackPlan {
	const plan = buildTimedCalendarWritebackPlanForExistingTask(selection, currentFields, options);
	plan.payload.dateStarted = '';
	if (isExpandedAllDayRange(currentFields)) {
		plan.payload.dateDue = '';
	}
	return plan;
}

export function buildTimedCalendarWritebackPlanForDueLaneTransfer(
	selection: CalendarSlotSelection,
	currentFields: Record<string, string>,
): CalendarWritebackPlan {
	return buildTimedCalendarWritebackPlanForExistingTask(selection, currentFields, {
		preserveExistingDuration: true,
	});
}

export function buildAllDaySlotSelection(startDate: string, endDate: string): CalendarSlotSelection {
	const normalizedStart = normalizeDateKey(startDate);
	const normalizedEnd = normalizeDateKey(endDate);
	const orderedStart = normalizedStart && normalizedEnd && normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd;
	const orderedEnd = normalizedStart && normalizedEnd && normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart;
	const fallbackDate = normalizedStart || normalizedEnd || '';

	return {
		mode: 'allDay',
		start: orderedStart || fallbackDate,
		end: orderedEnd || fallbackDate,
		startDate: orderedStart || fallbackDate,
		endDate: orderedEnd || fallbackDate,
		isAllDay: true,
		slotMinutes: undefined,
	};
}

export function buildAllDayCalendarWritebackPlan(selection: CalendarSlotSelection): CalendarWritebackPlan {
	const startDate = normalizeDateKey(selection.startDate);
	const endDate = normalizeDateKey(selection.endDate || selection.startDate);
	const orderedStart = startDate && endDate && startDate <= endDate ? startDate : endDate;
	const orderedEnd = startDate && endDate && startDate <= endDate ? endDate : startDate;
	const anchorDate = orderedStart || startDate || endDate || '';
	const finalEnd = orderedEnd || anchorDate;
	const isMultiDay = !!anchorDate && !!finalEnd && finalEnd > anchorDate;

	return {
		payload: {
			dateScheduled: anchorDate,
			dateStarted: isMultiDay ? anchorDate : '',
			dateDue: isMultiDay ? finalEnd : '',
			datetimeStart: '',
			datetimeEnd: '',
		},
	};
}

export function buildCalendarWritebackPlan(selection: CalendarSlotSelection): CalendarWritebackPlan {
	return selection.mode === 'allDay'
		? buildAllDayCalendarWritebackPlan(selection)
		: buildTimedCalendarWritebackPlan(selection);
}

export function buildAllDayMoveWritebackPlan(
	currentFields: Record<string, string>,
	nextStartDate: string,
): CalendarWritebackPlan {
	const currentScheduled = normalizeDateKey(currentFields['dateScheduled']);
	const currentStarted = normalizeDateKey(currentFields['dateStarted']);
	const nextStart = normalizeDateKey(nextStartDate);
	if (!nextStart) {
		return {
			payload: {},
		};
	}

	if (isExpandedAllDayRange(currentFields)) {
		const rangeStart = currentStarted || currentScheduled;
		if (!rangeStart) {
			return {
				payload: {},
			};
		}
		const deltaDays = diffCalendarDays(rangeStart, nextStart);
		const currentDue = normalizeDateKey(currentFields['dateDue']);
		return {
			payload: {
				dateScheduled: currentScheduled ? shiftDateKeyByDays(currentScheduled, deltaDays) : nextStart,
				dateStarted: nextStart,
				dateDue: currentDue ? shiftDateKeyByDays(currentDue, deltaDays) : '',
				datetimeStart: '',
				datetimeEnd: '',
			},
		};
	}

	return {
		payload: {
			dateScheduled: nextStart,
		},
	};
}

export function buildAllDayResizeRightWritebackPlan(
	currentFields: Record<string, string>,
	nextEndDate: string,
): CalendarWritebackPlan {
	const currentScheduled = normalizeDateKey(currentFields['dateScheduled']);
	const currentStarted = normalizeDateKey(currentFields['dateStarted']);
	const anchorDate = isExpandedAllDayRange(currentFields)
		? (currentStarted || currentScheduled)
		: currentScheduled;
	const normalizedEnd = normalizeDateKey(nextEndDate);
	if (!anchorDate || !normalizedEnd) {
		return {
			payload: {},
		};
	}

	if (normalizedEnd <= anchorDate) {
		return {
			payload: {
				dateScheduled: anchorDate,
				dateStarted: '',
				dateDue: '',
				datetimeStart: '',
				datetimeEnd: '',
			},
		};
	}

	return {
		payload: {
			dateScheduled: currentScheduled || anchorDate,
			dateStarted: anchorDate,
			dateDue: normalizedEnd,
			datetimeStart: '',
			datetimeEnd: '',
		},
	};
}

export function formatCalendarSlotSelectionLabel(selection: CalendarSlotSelection): string {
	if (selection.mode !== 'timed') {
		return selection.startDate === selection.endDate
			? selection.startDate
			: `${selection.startDate} -> ${selection.endDate}`;
	}

	const startTime = selection.start.slice(11, 16);
	const endTime = selection.end.slice(11, 16);
	return selection.startDate === selection.endDate
		? `${selection.startDate} ${startTime}-${endTime}`
		: `${selection.startDate} ${startTime} -> ${selection.endDate} ${endTime}`;
}

export function insertInlineTaskUnderHeading(
	content: string,
	heading: string,
	taskLine: string,
): InlineHeadingInsertionResult {
	const lines = splitPreservingEmptyTrailingLine(content);
	const normalizedHeading = heading.trim();
	const headingIndex = lines.findIndex(line => line.trim() === normalizedHeading);

	if (headingIndex >= 0) {
		const insertIndex = headingIndex + 1;
		lines.splice(insertIndex, 0, taskLine);
		return {
			content: lines.join('\n'),
			insertedLineNumber: insertIndex,
		};
	}

	const nextLines = [...lines];
	while (nextLines.length > 0 && !nextLines[nextLines.length - 1].trim()) {
		nextLines.pop();
	}
	if (nextLines.length > 0) {
		nextLines.push('');
	}
	nextLines.push(normalizedHeading);
	nextLines.push(taskLine);

	return {
		content: nextLines.join('\n'),
		insertedLineNumber: nextLines.length - 1,
	};
}

export function snapCalendarMinute(minuteOfDay: number, snapMinutes = CALENDAR_TIMED_SNAP_MINUTES): number {
	const safeSnapMinutes = Math.max(1, Math.round(snapMinutes || CALENDAR_TIMED_SNAP_MINUTES));
	const clamped = clampCalendarMinute(minuteOfDay);
	if (clamped >= (24 * 60) - safeSnapMinutes) {
		return 24 * 60;
	}
	return clampCalendarMinute(Math.round(clamped / safeSnapMinutes) * safeSnapMinutes);
}

export function isExpandedAllDayRange(currentFields: Record<string, string>): boolean {
	const started = normalizeDateKey(currentFields['dateStarted']);
	const due = normalizeDateKey(currentFields['dateDue']);
	return !!started && !!due && due >= started;
}

function clampCalendarMinute(minuteOfDay: number): number {
	if (!Number.isFinite(minuteOfDay)) return 0;
	return Math.max(0, Math.min(24 * 60, Math.round(minuteOfDay)));
}

function formatDateKeyMinuteOfDay(dateKey: string, minuteOfDay: number): string {
	const clamped = clampCalendarMinute(minuteOfDay);
	const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
	const minutes = String(clamped % 60).padStart(2, '0');
	return `${dateKey}T${hours}:${minutes}:00`;
}

function normalizeDateKey(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function parseDateKey(value: string): Date | null {
	const normalized = normalizeDateKey(value);
	if (!normalized) return null;
	const [year, month, day] = normalized.split('-').map(part => Number.parseInt(part, 10));
	if ([year, month, day].some(part => !Number.isFinite(part))) return null;
	return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shiftDateKeyByDays(value: string, deltaDays: number): string {
	const parsed = parseDateKey(value);
	if (!parsed) return value;
	parsed.setDate(parsed.getDate() + deltaDays);
	const year = parsed.getFullYear();
	const month = String(parsed.getMonth() + 1).padStart(2, '0');
	const day = String(parsed.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function diffCalendarDays(fromDate: string, toDate: string): number {
	const from = parseDateKey(fromDate);
	const to = parseDateKey(toDate);
	if (!from || !to) return 0;
	return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function normalizeSelectionBoundary(dateKey: string, value: string): string {
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
		return trimmed;
	}
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
		return `${trimmed}:00`;
	}
	return `${dateKey}T00:00:00`;
}

function parseSelectionDateTime(value: string): Date | null {
	const normalized = normalizeSelectionBoundary(value.slice(0, 10), value);
	const [datePart, timePart] = normalized.split('T');
	if (!datePart || !timePart) return null;

	const [year, month, day] = datePart.split('-').map(part => Number.parseInt(part, 10));
	const [hours, minutes, seconds] = timePart.split(':').map(part => Number.parseInt(part, 10));
	if ([year, month, day, hours, minutes, seconds].some(part => !Number.isFinite(part))) return null;

	return new Date(year, month - 1, day, hours, minutes, seconds, 0);
}

function splitPreservingEmptyTrailingLine(content: string): string[] {
	if (!content.length) return [];
	return content.split('\n');
}
