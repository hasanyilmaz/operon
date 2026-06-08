import { deriveDatetimeEnd, parseEstimateSeconds } from '../core/scheduling-rules';
import { calculateNextRepeatDate, parseRepeatRule, listRepeatOccurrencesInRange, RepeatRule } from '../core/repeat-rule';
import {
	CalendarItem,
	CalendarProjectionKind,
	buildCalendarRenderSnapshot,
} from '../types/calendar';
import { IndexedTask } from '../types/fields';
import { localToday } from '../core/local-time';
import {
	RepeatSeriesEntry,
	RepeatTemporalTemplate,
} from '../storage/repeat-series-store';
import {
	buildRepeatSeriesContexts,
	deriveTemporalTemplateFromTask,
	isRepeatSeriesProjectionActive,
	resolveOccurrencePlan,
	resolveProjectionRangePadding,
	shiftDateKey,
} from './recurrence-domain';
import {
	renderRepeatSeriesTitle,
	resolveLatestRepeatSeriesNamingConfig,
	resolveRecurringFileDisplayDate,
} from './recurring-file-naming';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export interface ProjectedRecurringCalendarItemsInput {
	tasks: IndexedTask[];
	entries: RepeatSeriesEntry[];
	rangeStart: string;
	rangeEnd: string;
	todayKey?: string;
}

export function buildProjectedRecurringCalendarItems(
	input: ProjectedRecurringCalendarItemsInput,
): CalendarItem[] {
	const rangeStart = normalizeDate(input.rangeStart);
	const rangeEnd = normalizeDate(input.rangeEnd);
	if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];
	const todayKey = normalizeDate(input.todayKey) || localToday();

	const entryBySeriesId = new Map(input.entries.map(entry => [entry.seriesId, entry]));
	const projected: CalendarItem[] = [];

	for (const group of buildRepeatSeriesContexts(input.tasks)) {
		if (!isRepeatSeriesProjectionActive(group)) continue;

		const latestRule = parseRepeatRule(group.latestTask.fieldValues['repeat']);
		if (!latestRule) continue;

		const entry = entryBySeriesId.get(group.seriesId);
		if (!entry) continue;

		const fallbackTemplate = deriveTemporalTemplateFromTask(group.earliestTask);
		const materializedOccurrenceDates = new Set(group.materializedOccurrenceDates);
		const projectionPaddingDays = resolveProjectionRangePadding(entry, fallbackTemplate);
		const projectionRangeStart = shiftDateKey(rangeStart, -projectionPaddingDays);
		const projectionRangeEnd = shiftDateKey(rangeEnd, projectionPaddingDays);
		const latestOccurrenceDate = group.latestOccurrenceDate;
		if (!latestOccurrenceDate) continue;
		const occurrenceDates = latestRule.mode === 'done'
			? listDoneRollingOccurrencesInRange(latestRule, {
				anchorDate: latestOccurrenceDate,
				todayKey,
				rangeStart: projectionRangeStart,
				rangeEnd: projectionRangeEnd,
				repeatEnd: group.latestTask.fieldValues['datetimeRepeatEnd'],
			})
			: listRepeatOccurrencesInRange(latestRule, {
				anchorDate: latestOccurrenceDate,
				rangeStart: projectionRangeStart,
				rangeEnd: projectionRangeEnd,
				repeatEnd: group.latestTask.fieldValues['datetimeRepeatEnd'],
			});
		const snapshot = buildCalendarRenderSnapshot(group.latestTask);

		for (const occurrenceDate of occurrenceDates) {
			if (materializedOccurrenceDates.has(occurrenceDate)) continue;
			const item = buildProjectedItemForOccurrence({
				entry,
				occurrenceDate,
				rangeStart,
				rangeEnd,
				fallbackTemplate,
				snapshot,
				projectionKind: latestRule.mode === 'done' ? 'doneRolling' : 'scheduled',
			});
			if (item) projected.push(item);
		}
	}

	return projected;
}

function buildProjectedItemForOccurrence(
	input: {
		entry: RepeatSeriesEntry;
		occurrenceDate: string;
		rangeStart: string;
		rangeEnd: string;
		fallbackTemplate: RepeatTemporalTemplate;
		snapshot: ReturnType<typeof buildCalendarRenderSnapshot>;
		projectionKind: CalendarProjectionKind;
	},
): CalendarItem | null {
	const entry = input.projectionKind === 'doneRolling'
		? { ...input.entry, skipDates: [] }
		: input.entry;
	const occurrencePlan = resolveOccurrencePlan({
		entry,
		occurrenceDate: input.occurrenceDate,
		fallbackTemplate: input.fallbackTemplate,
	});
	if (!occurrencePlan) return null;
	const scheduledDate = occurrencePlan.scheduledDate;
	const template = occurrencePlan.temporalTemplate;

	if (template.mode === 'timed') {
		const startDate = shiftDateKey(input.occurrenceDate, template.startDateShiftDays);
		const endDate = shiftDateKey(input.occurrenceDate, template.endDateShiftDays);
		const startDateTime = buildDateTimeValue(startDate, template.startTime);
		let endDateTime = buildDateTimeValue(endDate, template.endTime);
		if (startDateTime && !endDateTime) {
			const estimateSeconds = parseEstimateSeconds(input.snapshot.fieldValues['estimate']);
			if (estimateSeconds !== null) {
				endDateTime = deriveDatetimeEnd(startDateTime, estimateSeconds);
			}
		}
		if (!startDateTime || !endDateTime) return null;
		const timedStartDate = startDateTime.slice(0, 10);
		const timedEndDate = endDateTime.slice(0, 10);
		if (!intersectsDateRange(timedStartDate, timedEndDate, input.rangeStart, input.rangeEnd)) return null;
		return {
			taskId: `projected:${entry.seriesId}:${input.occurrenceDate}`,
			kind: 'timed',
			startDate: timedStartDate,
			endDate: timedEndDate,
			startDateTime,
			endDateTime,
			isDashed: false,
			isReadOnly: true,
			origin: 'projected',
			repeatRef: {
				seriesId: entry.seriesId,
				occurrenceDate: input.occurrenceDate,
				isLatestMaterialized: false,
				isProjected: true,
				projectionKind: input.projectionKind,
			},
			externalRef: null,
			sourceTask: null,
			renderSnapshot: {
				description: resolveProjectedDescription(entry, input.snapshot.description, scheduledDate, input.occurrenceDate),
				checkbox: input.snapshot.checkbox,
				fieldValues: {
					...input.snapshot.fieldValues,
					dateScheduled: scheduledDate,
					dateStarted: '',
					dateDue: '',
					repeatOccurrenceDate: input.occurrenceDate,
					datetimeStart: startDateTime,
					datetimeEnd: endDateTime,
				},
				tags: [...input.snapshot.tags],
			},
		};
	}

	const allDayStartDate = shiftDateKey(input.occurrenceDate, template.startDateShiftDays);
	const allDayEndDate = shiftDateKey(input.occurrenceDate, template.endDateShiftDays);
	if (!intersectsDateRange(allDayStartDate, allDayEndDate, input.rangeStart, input.rangeEnd)) return null;
	return {
		taskId: `projected:${entry.seriesId}:${input.occurrenceDate}`,
		kind: 'allDayScheduled',
		startDate: allDayStartDate,
		endDate: allDayEndDate,
		startDateTime: null,
		endDateTime: null,
		isDashed: false,
		isReadOnly: true,
		origin: 'projected',
		repeatRef: {
			seriesId: entry.seriesId,
			occurrenceDate: input.occurrenceDate,
			isLatestMaterialized: false,
			isProjected: true,
			projectionKind: input.projectionKind,
		},
		externalRef: null,
		sourceTask: null,
		renderSnapshot: {
			description: resolveProjectedDescription(entry, input.snapshot.description, scheduledDate, input.occurrenceDate),
			checkbox: input.snapshot.checkbox,
			fieldValues: {
				...input.snapshot.fieldValues,
				dateScheduled: scheduledDate,
				dateStarted: allDayStartDate,
				dateDue: allDayEndDate,
				repeatOccurrenceDate: input.occurrenceDate,
				datetimeStart: '',
				datetimeEnd: '',
			},
			tags: [...input.snapshot.tags],
		},
	};
}

function listDoneRollingOccurrencesInRange(
	rule: RepeatRule,
	options: {
		anchorDate: string;
		todayKey: string;
		rangeStart: string;
		rangeEnd: string;
		repeatEnd?: string | null;
	},
): string[] {
	const todayKey = normalizeDate(options.todayKey);
	const anchorDate = normalizeDate(options.anchorDate);
	const rangeStart = normalizeDate(options.rangeStart);
	const rangeEnd = normalizeDate(options.rangeEnd);
	if (!todayKey || !anchorDate || !rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];

	const results: string[] = [];
	let current = anchorDate > todayKey ? anchorDate : todayKey;
	for (let guard = 0; guard < 5000; guard += 1) {
		const next = calculateNextRepeatDate(rule, {
			anchorDate: current,
			repeatEnd: options.repeatEnd ?? undefined,
		});
		if (!next) break;
		current = next;
		if (next <= todayKey) continue;
		if (next >= rangeStart && next <= rangeEnd) results.push(next);
		if (next > rangeEnd) break;
	}
	return results;
}

function resolveProjectedDescription(
	entry: RepeatSeriesEntry,
	fallbackDescription: string,
	scheduledDate: string,
	occurrenceDate: string,
): string {
	const naming = resolveLatestRepeatSeriesNamingConfig(fallbackDescription, entry.naming);
	if (!naming) return fallbackDescription;
	const displayDate = resolveRecurringFileDisplayDate({
		dateScheduled: scheduledDate,
		repeatOccurrenceDate: occurrenceDate,
	});
	return displayDate ? renderRepeatSeriesTitle(naming, displayDate) : fallbackDescription;
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function buildDateTimeValue(dateKey: string, timeValue: string | null): string | null {
	if (!DATE_RE.test(dateKey) || !timeValue) return null;
	return `${dateKey}T${timeValue}`;
}

function intersectsDateRange(startDate: string, endDate: string, rangeStart: string, rangeEnd: string): boolean {
	return startDate <= rangeEnd && endDate >= rangeStart;
}
