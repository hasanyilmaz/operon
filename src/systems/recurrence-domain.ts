import { deriveDatetimeEnd, parseEstimateSeconds } from '../core/scheduling-rules';
import {
	calculateNextRepeatDate,
	listRepeatOccurrencesInRange,
	parseRepeatRule,
	type RepeatRule,
} from '../core/repeat-rule';
import { IndexedTask } from '../types/fields';
import {
	RepeatSeriesEntry,
	RepeatSingleOccurrenceOverride,
	RepeatTemporalTemplate,
} from '../storage/repeat-series-store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;

export interface RepeatSeriesContext {
	seriesId: string;
	tasks: IndexedTask[];
	earliestTask: IndexedTask;
	latestTask: IndexedTask;
	materializedOccurrenceDates: string[];
	latestOccurrenceDate: string;
}

export interface ResolvedOccurrencePlan {
	occurrenceDate: string;
	scheduledDate: string;
	temporalTemplate: RepeatTemporalTemplate;
	singleOverride: RepeatSingleOccurrenceOverride | null;
}

export interface RepeatMoveWindow {
	previousOccurrenceDate: string | null;
	nextOccurrenceDate: string | null;
}

export function resolveOccurrenceDate(task: Pick<IndexedTask, 'fieldValues'>): string {
	const occurrenceDate = normalizeDate(task.fieldValues['repeatOccurrenceDate']);
	if (occurrenceDate) return occurrenceDate;
	return normalizeDate(task.fieldValues['dateScheduled']);
}

export const getTaskRepeatOccurrenceDate = resolveOccurrenceDate;

export function getSeriesMaterializedTasks(tasks: IndexedTask[], seriesId: string): IndexedTask[] {
	return tasks
		.filter(task => (task.fieldValues['repeatSeriesId'] ?? '').trim() === seriesId)
		.sort(compareTasksByOccurrenceDate);
}

export function buildRepeatSeriesContext(seriesId: string, tasks: IndexedTask[]): RepeatSeriesContext | null {
	const seriesTasks = getSeriesMaterializedTasks(tasks, seriesId);
	if (!seriesTasks.length) return null;
	const materializedOccurrenceDates = [...new Set(
		seriesTasks
			.map(task => resolveOccurrenceDate(task))
			.filter(date => DATE_RE.test(date)),
	)].sort();
	const latestTask = seriesTasks[seriesTasks.length - 1];
	const latestOccurrenceDate = resolveOccurrenceDate(latestTask);
	if (!latestOccurrenceDate) return null;
	return {
		seriesId,
		tasks: seriesTasks,
		earliestTask: seriesTasks[0],
		latestTask,
		materializedOccurrenceDates,
		latestOccurrenceDate,
	};
}

export function buildRepeatSeriesContexts(tasks: IndexedTask[]): RepeatSeriesContext[] {
	const groups = new Map<string, IndexedTask[]>();
	for (const task of tasks) {
		const seriesId = normalizeOptional(task.fieldValues['repeatSeriesId']);
		if (!seriesId) continue;
		if (!parseRepeatRule(task.fieldValues['repeat'])) continue;
		const bucket = groups.get(seriesId);
		if (bucket) {
			bucket.push(task);
		} else {
			groups.set(seriesId, [task]);
		}
	}

	return [...groups.entries()]
		.map(([seriesId, seriesTasks]) => buildRepeatSeriesContext(seriesId, seriesTasks))
		.filter((context): context is RepeatSeriesContext => !!context);
}

export function getLatestSeriesOccurrenceDate(seriesId: string, tasks: IndexedTask[]): string {
	return buildRepeatSeriesContext(seriesId, tasks)?.latestOccurrenceDate ?? '';
}

export function isLatestMaterializedRecurringTask(task: IndexedTask, tasks: IndexedTask[]): boolean {
	const seriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
	if (!seriesId || !parseRepeatRule(task.fieldValues['repeat'])) return false;
	const occurrenceDate = resolveOccurrenceDate(task);
	if (!occurrenceDate) return false;
	return getLatestSeriesOccurrenceDate(seriesId, tasks) === occurrenceDate;
}

export function isRecurringProjectionSourceTask(task: IndexedTask): boolean {
	const seriesId = normalizeOptional(task.fieldValues['repeatSeriesId']);
	if (!seriesId) return false;
	if (task.checkbox !== 'open') return false;
	if (!parseRepeatRule(task.fieldValues['repeat'])) return false;
	return !!resolveOccurrenceDate(task);
}

export function isRepeatSeriesProjectionActive(context: RepeatSeriesContext): boolean {
	return isRecurringProjectionSourceTask(context.latestTask);
}

export function deriveTemporalTemplateFromTask(task: Pick<IndexedTask, 'fieldValues'>): RepeatTemporalTemplate {
	return deriveTemporalTemplateFromTaskAtOccurrence(task, resolveOccurrenceDate(task));
}

export function deriveTemporalTemplateFromTaskAtOccurrence(
	task: Pick<IndexedTask, 'fieldValues'>,
	occurrenceDate: string | null | undefined,
): RepeatTemporalTemplate {
	const normalizedOccurrenceDate = normalizeDate(occurrenceDate);
	const scheduledDate = normalizeDate(task.fieldValues['dateScheduled']);
	const datetimeStart = normalizeDatetime(task.fieldValues['datetimeStart']);
	let datetimeEnd = normalizeDatetime(task.fieldValues['datetimeEnd']);
	const startTime = extractTimeLike(task.fieldValues['datetimeStart']);
	const endTime = extractTimeLike(task.fieldValues['datetimeEnd']);
	if (datetimeStart && !datetimeEnd) {
		const estimateSeconds = parseEstimateSeconds(task.fieldValues['estimate']);
		if (estimateSeconds !== null) {
			datetimeEnd = deriveDatetimeEnd(datetimeStart, estimateSeconds);
		}
	}
	const mode: RepeatTemporalTemplate['mode'] = startTime && (endTime || !!datetimeEnd) ? 'timed' : 'allDay';
	const dateShiftDays = normalizedOccurrenceDate && scheduledDate
		? dateDiffDays(normalizedOccurrenceDate, scheduledDate)
		: 0;
	const startDate = mode === 'timed'
		? normalizeDate(datetimeStart.slice(0, 10)) || scheduledDate
		: normalizeDate(task.fieldValues['dateStarted']) || scheduledDate;
	const endDate = mode === 'timed'
		? normalizeDate(datetimeEnd.slice(0, 10)) || scheduledDate
		: resolveAllDayEndDate(task.fieldValues, scheduledDate);
	return {
		mode,
		dateShiftDays,
		startDateShiftDays: normalizedOccurrenceDate && startDate ? dateDiffDays(normalizedOccurrenceDate, startDate) : dateShiftDays,
		endDateShiftDays: normalizedOccurrenceDate && endDate ? dateDiffDays(normalizedOccurrenceDate, endDate) : dateShiftDays,
		startTime,
		endTime: datetimeEnd ? datetimeEnd.slice(11) : endTime,
		estimate: normalizeOptional(task.fieldValues['estimate']),
	};
}

export function resolveSeriesTemporalTemplate(
	entry: RepeatSeriesEntry,
	occurrenceDate: string,
	fallbackTemplate: RepeatTemporalTemplate | null = null,
): RepeatTemporalTemplate | null {
	let resolved = entry.baseTemporalTemplate ?? fallbackTemplate;
	for (const override of entry.overrides.following) {
		if (override.effectiveFrom > occurrenceDate) break;
		resolved = {
			mode: override.mode,
			dateShiftDays: override.dateShiftDays,
			startDateShiftDays: override.startDateShiftDays,
			endDateShiftDays: override.endDateShiftDays,
			startTime: override.startTime,
			endTime: override.endTime,
			estimate: override.estimate,
		};
	}
	return resolved ? { ...resolved } : null;
}

export const resolveSeriesTimelineTemplate = resolveSeriesTemporalTemplate;

export function resolveSingleOccurrenceOverride(
	entry: RepeatSeriesEntry,
	occurrenceDate: string,
): RepeatSingleOccurrenceOverride | null {
	return entry.overrides.single[occurrenceDate]
		? { ...entry.overrides.single[occurrenceDate] }
		: null;
}

export const applySingleOccurrenceOverride = resolveSingleOccurrenceOverride;

export function isOccurrenceSkipped(entry: RepeatSeriesEntry, occurrenceDate: string): boolean {
	if (entry.overrides.single[occurrenceDate]) return false;
	return entry.skipDates.includes(occurrenceDate);
}

export const isSkippedOccurrence = isOccurrenceSkipped;

export function resolveOccurrencePlan(input: {
	entry: RepeatSeriesEntry;
	occurrenceDate: string;
	fallbackTemplate: RepeatTemporalTemplate | null;
}): ResolvedOccurrencePlan | null {
	const occurrenceDate = normalizeDate(input.occurrenceDate);
	if (!occurrenceDate) return null;
	const singleOverride = resolveSingleOccurrenceOverride(input.entry, occurrenceDate);
	if (!singleOverride && isOccurrenceSkipped(input.entry, occurrenceDate)) return null;

	const temporalTemplate = singleOverride
		? {
			mode: singleOverride.mode,
			dateShiftDays: dateDiffDays(occurrenceDate, singleOverride.scheduledDate),
			startDateShiftDays: singleOverride.startDateShiftDays,
			endDateShiftDays: singleOverride.endDateShiftDays,
			startTime: singleOverride.startTime,
			endTime: singleOverride.endTime,
			estimate: singleOverride.estimate,
		}
		: resolveSeriesTemporalTemplate(input.entry, occurrenceDate, input.fallbackTemplate);
	if (!temporalTemplate) return null;

	return {
		occurrenceDate,
		scheduledDate: singleOverride?.scheduledDate ?? shiftDateKey(occurrenceDate, temporalTemplate.dateShiftDays),
		temporalTemplate,
		singleOverride,
	};
}

export function resolveMoveWindow(input: {
	seriesId: string;
	tasks: IndexedTask[];
	entry: RepeatSeriesEntry | null | undefined;
	occurrenceDate: string;
	rule: RepeatRule;
}): RepeatMoveWindow {
	const context = buildRepeatSeriesContext(input.seriesId, input.tasks);
	const materializedDates = context?.materializedOccurrenceDates ?? [];

	let previousOccurrenceDate: string | null = null;
	let anchorDate: string | null = null;
	for (const materializedDate of materializedDates) {
		if (materializedDate < input.occurrenceDate) previousOccurrenceDate = materializedDate;
		if (materializedDate <= input.occurrenceDate) anchorDate = materializedDate;
	}

	if (anchorDate && anchorDate < input.occurrenceDate && input.rule.mode !== 'done') {
		const generatedDates = listRepeatOccurrencesInRange(input.rule, {
			anchorDate,
			rangeStart: anchorDate,
			rangeEnd: input.occurrenceDate,
			skipDates: input.entry?.skipDates,
		});
		for (const generatedDate of generatedDates) {
			if (generatedDate < input.occurrenceDate && (!previousOccurrenceDate || generatedDate > previousOccurrenceDate)) {
				previousOccurrenceDate = generatedDate;
			}
		}
	}

	let nextOccurrenceDate = materializedDates.find(date => date > input.occurrenceDate) ?? null;
	if (input.rule.mode !== 'done' && !(input.rule.mode === 'count' && (input.rule.count ?? 0) <= 1)) {
		const calculatedNextDate = calculateNextRepeatDate(input.rule, {
			anchorDate: input.occurrenceDate,
			skipDates: input.entry?.skipDates,
		});
		if (calculatedNextDate && (!nextOccurrenceDate || calculatedNextDate < nextOccurrenceDate)) {
			nextOccurrenceDate = calculatedNextDate;
		}
	}

	return { previousOccurrenceDate, nextOccurrenceDate };
}

export function canMoveOccurrenceDate(input: {
	rule: Pick<RepeatRule, 'freq' | 'interval'>;
	occurrenceDate: string;
	scheduledDate: string;
	window?: RepeatMoveWindow | null;
}): boolean {
	const occurrenceDate = normalizeDate(input.occurrenceDate);
	const scheduledDate = normalizeDate(input.scheduledDate);
	if (!occurrenceDate || !scheduledDate) return false;

	if (input.rule.freq === 'day' && input.rule.interval === 1) {
		return scheduledDate === occurrenceDate;
	}

	const previousOccurrenceDate = normalizeDate(input.window?.previousOccurrenceDate);
	if (previousOccurrenceDate && scheduledDate <= previousOccurrenceDate) return false;

	const nextOccurrenceDate = normalizeDate(input.window?.nextOccurrenceDate);
	if (nextOccurrenceDate && scheduledDate >= nextOccurrenceDate) return false;

	return true;
}

export function resolveProjectionRangePadding(
	entry: RepeatSeriesEntry,
	fallbackTemplate: RepeatTemporalTemplate,
): number {
	let maxDays = 1;
	const consider = (value: unknown): void => {
		if (typeof value !== 'number' || !Number.isFinite(value)) return;
		maxDays = Math.max(maxDays, Math.abs(Math.trunc(value)));
	};
	const considerTemplate = (template: RepeatTemporalTemplate | null | undefined): void => {
		if (!template) return;
		consider(template.dateShiftDays);
		consider(template.startDateShiftDays);
		consider(template.endDateShiftDays);
	};

	considerTemplate(fallbackTemplate);
	considerTemplate(entry.baseTemporalTemplate);
	for (const override of entry.overrides.following) {
		consider(override.dateShiftDays);
		consider(override.startDateShiftDays);
		consider(override.endDateShiftDays);
	}
	for (const override of Object.values(entry.overrides.single)) {
		consider(dateDiffDays(override.occurrenceDate, override.scheduledDate));
		consider(override.startDateShiftDays);
		consider(override.endDateShiftDays);
	}

	return maxDays;
}

export function dateDiffDays(leftDate: string, rightDate: string): number {
	const left = parseDateKey(leftDate);
	const right = parseDateKey(rightDate);
	if (!left || !right) return 0;
	return Math.round((right.getTime() - left.getTime()) / 86400000);
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
	const parsed = parseDateKey(dateKey);
	if (!parsed) return dateKey;
	parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
	const year = parsed.getUTCFullYear();
	const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
	const day = String(parsed.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function compareTasksByOccurrenceDate(left: IndexedTask, right: IndexedTask): number {
	const leftDate = resolveOccurrenceDate(left);
	const rightDate = resolveOccurrenceDate(right);
	if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
	return left.operonId.localeCompare(right.operonId);
}

function resolveAllDayEndDate(fieldValues: Record<string, string>, scheduledDate: string): string {
	const dateStarted = normalizeDate(fieldValues['dateStarted']);
	const dateDue = normalizeDate(fieldValues['dateDue']);
	if (dateStarted && dateDue && dateDue >= dateStarted) {
		return dateDue;
	}
	return scheduledDate;
}

function normalizeOptional(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	return trimmed || null;
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function normalizeDatetime(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATETIME_RE.test(trimmed) ? trimmed : '';
}

function extractTimeLike(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return null;
	if (/^\d{2}:\d{2}:\d{2}$/u.test(trimmed)) return trimmed;
	if (/^\d{2}:\d{2}$/u.test(trimmed)) return `${trimmed}:00`;
	if (DATETIME_RE.test(trimmed)) return trimmed.slice(11);
	return null;
}

function parseDateKey(value: string): Date | null {
	if (!DATE_RE.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}
