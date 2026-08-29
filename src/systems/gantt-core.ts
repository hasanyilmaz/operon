import { deriveDatetimeEnd, extractDatePart, parseEstimateSeconds } from '../core/scheduling-rules';
import type { IndexedTask } from '../types/fields';
import {
	GANTT_UNIT_WIDTH_MULTIPLIERS,
	normalizeGanttScaleAndWidth,
	type BuildGanttDateAxisOptions,
	type GanttDateAxis,
	type GanttDateAxisContextGroup,
	type GanttDateAxisContextUnit,
	type GanttDateAxisHeaderGroup,
	type GanttScale,
	type GanttTaskBar,
	type GanttTaskProjection,
	type GanttUnitWidthMultiplier,
} from '../types/gantt';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeGanttScale(value: unknown): GanttScale {
	return normalizeGanttScaleAndWidth(value, 1).scale;
}

export function normalizeGanttUnitWidthMultiplier(value: unknown): GanttUnitWidthMultiplier {
	return typeof value === 'number' && GANTT_UNIT_WIDTH_MULTIPLIERS.includes(value as GanttUnitWidthMultiplier)
		? value as GanttUnitWidthMultiplier
		: 1;
}

export function normalizeGanttDateKey(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	const match = DATE_KEY_RE.exec(trimmed);
	if (!match) return '';
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const date = createUtcDate(year, month - 1, day);
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
	return trimmed;
}

export function ganttDateKeyToOrdinal(value: string): number | null {
	const normalized = normalizeGanttDateKey(value);
	if (!normalized) return null;
	const [year, month, day] = normalized.split('-').map(part => Number.parseInt(part, 10));
	return Math.trunc(createUtcDate(year, month - 1, day).getTime() / MILLISECONDS_PER_DAY);
}

export function ganttOrdinalToDateKey(ordinal: number): string {
	if (!Number.isFinite(ordinal)) return '';
	const date = new Date(Math.trunc(ordinal) * MILLISECONDS_PER_DAY);
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function shiftGanttDateKey(value: string, deltaDays: number): string {
	const ordinal = ganttDateKeyToOrdinal(value);
	if (ordinal === null || !Number.isFinite(deltaDays)) return '';
	return ganttOrdinalToDateKey(ordinal + Math.trunc(deltaDays));
}

export function diffGanttDateKeys(fromDate: string, toDate: string): number | null {
	const fromOrdinal = ganttDateKeyToOrdinal(fromDate);
	const toOrdinal = ganttDateKeyToOrdinal(toDate);
	return fromOrdinal === null || toOrdinal === null ? null : toOrdinal - fromOrdinal;
}

export function projectTaskToGantt(task: IndexedTask): GanttTaskProjection {
	const fields = task.fieldValues;
	const dateStarted = normalizeGanttDateKey(fields['dateStarted']);
	const dateScheduled = normalizeGanttDateKey(fields['dateScheduled']);
	const dateDue = normalizeGanttDateKey(fields['dateDue']);
	const allDayRange = dateStarted && dateDue && dateDue >= dateStarted
		? createBar('all-day-range', dateStarted, dateDue)
		: null;
	const timedRange = allDayRange ? null : resolveTimedBar(fields);
	const scheduled = allDayRange || timedRange || !dateScheduled
		? null
		: createBar('scheduled', dateScheduled, dateScheduled);
	const markers: GanttTaskProjection['markers'] = [];
	if (dateStarted) markers.push({ key: 'dateStarted', date: dateStarted });
	if (dateScheduled) markers.push({ key: 'dateScheduled', date: dateScheduled });
	if (dateDue) markers.push({ key: 'dateDue', date: dateDue });

	return {
		taskId: task.operonId,
		bar: allDayRange ?? timedRange ?? scheduled,
		deadline: dateDue ? { date: dateDue } : null,
		markers,
	};
}

export function buildGanttDateAxis(options: BuildGanttDateAxisOptions): GanttDateAxis | null {
	const startOrdinal = ganttDateKeyToOrdinal(options.startDate);
	const endOrdinal = ganttDateKeyToOrdinal(options.endDate);
	if (startOrdinal === null || endOrdinal === null || endOrdinal < startOrdinal) return null;
	if (!Number.isFinite(options.baseDayWidthPx) || options.baseDayWidthPx <= 0) return null;

	const scale = normalizeGanttScale(options.scale);
	const multiplier = normalizeGanttUnitWidthMultiplier(options.unitWidthMultiplier);
	const dayWidthPx = options.baseDayWidthPx * multiplier;
	const dayCount = endOrdinal - startOrdinal + 1;
	const days = Array.from({ length: dayCount }, (_, index) => ({
		date: ganttOrdinalToDateKey(startOrdinal + index),
		index,
		x: index * dayWidthPx,
		width: dayWidthPx,
	}));

	return {
		startDate: days[0].date,
		endDate: days[days.length - 1].date,
		scale,
		weekStart: options.weekStart,
		dayWidthPx,
		totalWidthPx: dayCount * dayWidthPx,
		days,
		headerGroups: buildHeaderGroups(days.map(day => day.date), scale, options.weekStart, dayWidthPx),
		contextHeaderGroups: buildContextHeaderGroups(
			days.map(day => day.date),
			resolveContextHeaderUnit(scale),
			options.weekStart,
			dayWidthPx,
		),
	};
}

export function ganttDateToX(axis: GanttDateAxis, dateKey: string): number | null {
	const offset = diffGanttDateKeys(axis.startDate, dateKey);
	if (offset === null || offset < 0 || offset >= axis.days.length) return null;
	return offset * axis.dayWidthPx;
}

export function ganttXToDate(axis: GanttDateAxis, x: number): string | null {
	if (!Number.isFinite(x) || axis.days.length === 0 || axis.dayWidthPx <= 0) return null;
	const clampedX = Math.max(0, Math.min(x, Math.max(0, axis.totalWidthPx - Number.EPSILON)));
	const index = Math.min(axis.days.length - 1, Math.floor(clampedX / axis.dayWidthPx));
	return axis.days[index]?.date ?? null;
}

export function getGanttInclusiveBarWidthPx(axis: GanttDateAxis, startDate: string, endDate: string): number | null {
	const startOffset = diffGanttDateKeys(axis.startDate, startDate);
	const endOffset = diffGanttDateKeys(axis.startDate, endDate);
	if (startOffset === null || endOffset === null || endOffset < startOffset) return null;
	if (startOffset < 0 || endOffset >= axis.days.length) return null;
	return (endOffset - startOffset + 1) * axis.dayWidthPx;
}

function resolveTimedBar(fields: Record<string, string>): GanttTaskBar | null {
	const startDateTime = normalizeDatetime(fields['datetimeStart']);
	if (!startDateTime) return null;
	let endDateTime = normalizeDatetime(fields['datetimeEnd']);
	if (!endDateTime) {
		const estimateSeconds = parseEstimateSeconds(fields['estimate']);
		if (estimateSeconds !== null) endDateTime = normalizeDatetime(deriveDatetimeEnd(startDateTime, estimateSeconds));
	}
	if (!endDateTime || endDateTime < startDateTime) return null;
	const startDate = normalizeGanttDateKey(extractDatePart(startDateTime));
	const endDate = normalizeGanttDateKey(extractDatePart(endDateTime));
	if (!startDate || !endDate || endDate < startDate) return null;
	return createBar('timed', startDate, endDate, startDateTime, endDateTime);
}

function createBar(
	kind: GanttTaskBar['kind'],
	startDate: string,
	endDate: string,
	startDateTime: string | null = null,
	endDateTime: string | null = null,
): GanttTaskBar {
	return { kind, startDate, endDate, startDateTime, endDateTime };
}

function normalizeDatetime(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	const match = DATETIME_RE.exec(trimmed);
	if (!match) return '';
	const date = normalizeGanttDateKey(match[1]);
	const hours = Number.parseInt(match[2], 10);
	const minutes = Number.parseInt(match[3], 10);
	const seconds = Number.parseInt(match[4] ?? '0', 10);
	if (!date || hours > 23 || minutes > 59 || seconds > 59) return '';
	return `${date}T${match[2]}:${match[3]}:${String(seconds).padStart(2, '0')}`;
}

function createUtcDate(year: number, monthIndex: number, day: number): Date {
	const date = new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(year, monthIndex, day);
	return date;
}

function buildHeaderGroups(
	dates: readonly string[],
	scale: GanttScale,
	weekStart: BuildGanttDateAxisOptions['weekStart'],
	dayWidthPx: number,
): GanttDateAxisHeaderGroup[] {
	const groups: GanttDateAxisHeaderGroup[] = [];
	let activeKey = '';
	for (const [index, date] of dates.entries()) {
		const key = getHeaderGroupKey(date, scale, weekStart);
		const active = groups[groups.length - 1];
		if (!active || key !== activeKey) {
			activeKey = key;
			groups.push({
				scale,
				startDate: date,
				endDate: date,
				startIndex: index,
				dayCount: 1,
				x: index * dayWidthPx,
				width: dayWidthPx,
			});
			continue;
		}
		active.endDate = date;
		active.dayCount += 1;
		active.width = active.dayCount * dayWidthPx;
	}
	return groups;
}

function resolveContextHeaderUnit(scale: GanttScale): GanttDateAxisContextUnit {
	if (scale === 'day') return 'week';
	return 'month';
}

function buildContextHeaderGroups(
	dates: readonly string[],
	unit: GanttDateAxisContextUnit,
	weekStart: BuildGanttDateAxisOptions['weekStart'],
	dayWidthPx: number,
): GanttDateAxisContextGroup[] {
	const groups: GanttDateAxisContextGroup[] = [];
	let activeKey = '';
	for (const [index, date] of dates.entries()) {
		const key = getContextHeaderGroupKey(date, unit, weekStart);
		const active = groups[groups.length - 1];
		if (!active || key !== activeKey) {
			activeKey = key;
			groups.push({
				unit,
				startDate: date,
				endDate: date,
				startIndex: index,
				dayCount: 1,
				x: index * dayWidthPx,
				width: dayWidthPx,
			});
			continue;
		}
		active.endDate = date;
		active.dayCount += 1;
		active.width = active.dayCount * dayWidthPx;
	}
	return groups;
}

function getContextHeaderGroupKey(
	dateKey: string,
	unit: GanttDateAxisContextUnit,
	weekStart: BuildGanttDateAxisOptions['weekStart'],
): string {
	if (unit === 'week') return getHeaderGroupKey(dateKey, 'week', weekStart);
	return dateKey.slice(0, 7);
}

function getHeaderGroupKey(dateKey: string, scale: GanttScale, weekStart: BuildGanttDateAxisOptions['weekStart']): string {
	if (scale === 'day') return dateKey;
	const ordinal = ganttDateKeyToOrdinal(dateKey);
	if (ordinal === null) return dateKey;
	const date = new Date(ordinal * MILLISECONDS_PER_DAY);
	const weekday = date.getUTCDay();
	const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
	return ganttOrdinalToDateKey(ordinal - offset);
}
