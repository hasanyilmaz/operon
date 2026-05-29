import { deriveDatetimeEnd, extractDatePart, parseEstimateSeconds } from '../core/scheduling-rules';
import {
	CalendarItem,
	CalendarPreset,
	buildCalendarRenderSnapshot,
} from '../types/calendar';
import { IndexedTask } from '../types/fields';
import { RepeatSeriesEntry } from '../storage/repeat-series-store';
import { getTaskRepeatOccurrenceDate } from './recurrence-domain';
import { buildProjectedRecurringCalendarItems } from './recurrence-projection';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;

export interface CalendarQueryResult {
	visibleDates: string[];
	rangeStart: string;
	rangeEnd: string;
	items: CalendarItem[];
}

export type CalendarQueryPreset = Pick<CalendarPreset, 'dayCount' | 'showWeekends' | 'todayPosition'> & Partial<Pick<CalendarPreset, 'showProjectedOccurrences'>>;
export type CalendarRangeQueryPreset = Partial<Pick<CalendarPreset, 'showProjectedOccurrences'>>;

export interface CalendarQueryOptions {
	todayKey?: string;
}

export function queryCalendarItems(
	tasks: IndexedTask[],
	anchorDate: string,
	preset: CalendarQueryPreset,
	repeatSeriesEntries: RepeatSeriesEntry[] = [],
	options: CalendarQueryOptions = {},
): CalendarQueryResult {
	const visibleDates = buildVisibleCalendarDates(anchorDate, preset.dayCount, preset.showWeekends, preset.todayPosition);
	return queryCalendarItemsForVisibleDates(
		tasks,
		visibleDates,
		preset,
		repeatSeriesEntries,
		options,
	);
}

export function queryCalendarItemsForVisibleDates(
	tasks: IndexedTask[],
	visibleDatesInput: string[],
	preset: CalendarRangeQueryPreset = {},
	repeatSeriesEntries: RepeatSeriesEntry[] = [],
	options: CalendarQueryOptions = {},
): CalendarQueryResult {
	const visibleDates = normalizeVisibleDates(visibleDatesInput);
	if (visibleDates.length === 0) {
		return {
			visibleDates: [],
			rangeStart: '',
			rangeEnd: '',
			items: [],
		};
	}
	const rangeStart = visibleDates[0];
	const rangeEnd = visibleDates[visibleDates.length - 1] ?? rangeStart;
	const items: CalendarItem[] = [];
	const latestOccurrenceBySeries = buildLatestOccurrenceMap(tasks);

	for (const task of tasks) {
		items.push(...deriveCalendarItemsForTask(task, rangeStart, rangeEnd, latestOccurrenceBySeries));
	}

	if (preset.showProjectedOccurrences !== false) {
		items.push(...buildProjectedRecurringCalendarItems({
			tasks,
			entries: repeatSeriesEntries,
			rangeStart,
			rangeEnd,
			todayKey: options.todayKey,
		}));
	}

	items.sort((left, right) => {
		const kindRank = getKindRank(left.kind) - getKindRank(right.kind);
		if (kindRank !== 0) return kindRank;

		const startRank = left.startDate.localeCompare(right.startDate);
		if (startRank !== 0) return startRank;

		const endRank = left.endDate.localeCompare(right.endDate);
		if (endRank !== 0) return endRank;

		const timedLeft = left.startDateTime ?? '';
		const timedRight = right.startDateTime ?? '';
		if (timedLeft !== timedRight) return timedLeft.localeCompare(timedRight);

		return resolveItemLabel(left).localeCompare(resolveItemLabel(right));
	});

	return {
		visibleDates,
		rangeStart,
		rangeEnd,
		items,
	};
}

function normalizeVisibleDates(visibleDates: string[]): string[] {
	const normalized = Array.from(new Set(
		visibleDates
			.map(date => normalizeDate(date))
			.filter((date): date is string => !!date),
	));
	normalized.sort();
	return normalized;
}

export function buildVisibleCalendarDates(
	anchorDate: string,
	dayCount: number,
	showWeekends: boolean,
	todayPosition = 1,
): string[] {
	const safeDayCount = Math.max(1, Math.min(42, Math.round(dayCount || 1)));
	const safeTodayPosition = Math.max(1, Math.min(safeDayCount, Math.round(todayPosition || 1)));
	const start = shiftVisibleDate(anchorDate, -(safeTodayPosition - 1), showWeekends);
	if (!start) return [];
	const visibleDates: string[] = [];
	const cursor = new Date(start);

	while (visibleDates.length < safeDayCount) {
		if (showWeekends || !isWeekend(cursor)) {
			visibleDates.push(formatDateKey(cursor));
		}
		cursor.setDate(cursor.getDate() + 1);
	}

	return visibleDates;
}

export function shiftCalendarDateKey(dateKey: string, deltaDays: number): string {
	const parsed = parseDateKey(dateKey);
	if (!parsed) return dateKey;
	const next = new Date(parsed);
	next.setDate(next.getDate() + deltaDays);
	return formatDateKey(next);
}

function buildLatestOccurrenceMap(tasks: IndexedTask[]): Map<string, string> {
	const latestBySeries = new Map<string, string>();
	for (const task of tasks) {
		const seriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
		if (!seriesId) continue;
		const occurrenceDate = getTaskRepeatOccurrenceDate(task);
		if (!occurrenceDate) continue;
		const current = latestBySeries.get(seriesId);
		if (!current || occurrenceDate > current) {
			latestBySeries.set(seriesId, occurrenceDate);
		}
	}
	return latestBySeries;
}

function deriveCalendarItemsForTask(
	task: IndexedTask,
	rangeStart: string,
	rangeEnd: string,
	latestOccurrenceBySeries: Map<string, string>,
): CalendarItem[] {
	const items: CalendarItem[] = [];
	const fieldValues = task.fieldValues;
	const renderSnapshot = buildCalendarRenderSnapshot(task);
	const repeatSeriesId = (fieldValues['repeatSeriesId'] ?? '').trim();
	const repeatOccurrenceDate = getTaskRepeatOccurrenceDate(task);
	const repeatRef = repeatSeriesId && repeatOccurrenceDate
		? {
			seriesId: repeatSeriesId,
			occurrenceDate: repeatOccurrenceDate,
			isLatestMaterialized: latestOccurrenceBySeries.get(repeatSeriesId) === repeatOccurrenceDate,
			isProjected: false,
		}
		: null;

	const dateScheduled = normalizeDate(fieldValues['dateScheduled']);
	const dateStarted = normalizeDate(fieldValues['dateStarted']);
	const dateDue = normalizeDate(fieldValues['dateDue']);
	const dateCompleted = normalizeDate(fieldValues['dateCompleted']);

	const datetimeStart = normalizeDatetime(fieldValues['datetimeStart']);
	let datetimeEnd = normalizeDatetime(fieldValues['datetimeEnd']);

	if (datetimeStart && !datetimeEnd) {
		const estimateSeconds = parseEstimateSeconds(fieldValues['estimate']);
		if (estimateSeconds !== null) {
			datetimeEnd = deriveDatetimeEnd(datetimeStart, estimateSeconds);
		}
	}

	const hasTimedBlock = !!datetimeStart && !!datetimeEnd;

	if (hasTimedBlock) {
		const startDate = extractDatePart(datetimeStart);
		const endDate = extractDatePart(datetimeEnd) || startDate;
		if (intersectsDateRange(startDate, endDate, rangeStart, rangeEnd)) {
			items.push({
				taskId: task.operonId,
				kind: 'timed',
				startDate,
				endDate,
				startDateTime: datetimeStart,
				endDateTime: datetimeEnd,
				isDashed: false,
				isReadOnly: true,
				origin: 'materialized',
				repeatRef,
				externalRef: null,
				sourceTask: task,
				renderSnapshot,
			});
		}
	}

	if (!hasTimedBlock) {
		const allDayRange = resolveAllDayCalendarRange(dateScheduled, dateStarted, dateDue);
		if (allDayRange && intersectsDateRange(allDayRange.startDate, allDayRange.endDate, rangeStart, rangeEnd)) {
			items.push({
				taskId: task.operonId,
				kind: 'allDayScheduled',
				startDate: allDayRange.startDate,
				endDate: allDayRange.endDate,
				startDateTime: null,
				endDateTime: null,
				isDashed: false,
				isReadOnly: true,
				origin: 'materialized',
				repeatRef,
				externalRef: null,
				sourceTask: task,
				renderSnapshot,
			});
		}
	}

	if (dateDue && dateDue >= rangeStart && dateDue <= rangeEnd) {
		items.push({
			taskId: task.operonId,
			kind: 'dueMarker',
			startDate: dateDue,
			endDate: dateDue,
			startDateTime: null,
			endDateTime: null,
			isDashed: true,
			isReadOnly: true,
			origin: 'materialized',
			repeatRef,
			externalRef: null,
			sourceTask: task,
			renderSnapshot,
		});
	}

	if (dateCompleted && dateCompleted >= rangeStart && dateCompleted <= rangeEnd) {
		items.push({
			taskId: task.operonId,
			kind: 'finishedMarker',
			startDate: dateCompleted,
			endDate: dateCompleted,
			startDateTime: null,
			endDateTime: null,
			isDashed: true,
			isReadOnly: true,
			origin: 'materialized',
			repeatRef,
			externalRef: null,
			sourceTask: task,
			renderSnapshot,
		});
	}

	return items;
}

function resolveItemLabel(item: CalendarItem): string {
	return item.renderSnapshot.description || item.taskId;
}

function getKindRank(kind: CalendarItem['kind']): number {
	if (kind === 'allDayScheduled') return 0;
	if (kind === 'dueMarker') return 1;
	if (kind === 'finishedMarker') return 2;
	return 3;
}

function intersectsDateRange(
	startDate: string,
	endDate: string,
	rangeStart: string,
	rangeEnd: string,
): boolean {
	if (!startDate || !endDate || !rangeStart || !rangeEnd) return false;
	return startDate <= rangeEnd && endDate >= rangeStart;
}

function resolveAllDayCalendarRange(
	dateScheduled: string,
	dateStarted: string,
	dateDue: string,
): { startDate: string; endDate: string } | null {
	if (dateStarted && dateDue && dateDue >= dateStarted) {
		return {
			startDate: dateStarted,
			endDate: dateDue,
		};
	}
	if (!dateScheduled) return null;
	return {
		startDate: dateScheduled,
		endDate: dateScheduled,
	};
}

function normalizeDate(value: string | undefined | null): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function normalizeDatetime(value: string | undefined | null): string {
	const trimmed = (value ?? '').trim();
	return DATETIME_RE.test(trimmed) ? trimmed : '';
}

function parseDateKey(value: string): Date | null {
	if (!DATE_RE.test(value.trim())) return null;
	const [year, month, day] = value.trim().split('-').map(part => Number.parseInt(part, 10));
	return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function isWeekend(date: Date): boolean {
	const day = date.getDay();
	return day === 0 || day === 6;
}

function shiftVisibleDate(dateKey: string, deltaVisibleDays: number, showWeekends: boolean): Date | null {
	const start = parseDateKey(dateKey);
	if (!start) return null;
	if (deltaVisibleDays === 0) return start;

	const direction = deltaVisibleDays > 0 ? 1 : -1;
	let remaining = Math.abs(deltaVisibleDays);
	const cursor = new Date(start);

	while (remaining > 0) {
		cursor.setDate(cursor.getDate() + direction);
		if (showWeekends || !isWeekend(cursor)) {
			remaining -= 1;
		}
	}

	return cursor;
}
