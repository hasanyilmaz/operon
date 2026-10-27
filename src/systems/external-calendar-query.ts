import { CalendarExternalEventRef, CalendarItem, CalendarRenderSnapshot } from '../types/calendar';
import { ExternalCalendarSource } from '../types/settings';
import { ExternalCalendarCachedEvent } from '../storage/external-calendar-cache';

const EMPTY_SNAPSHOT: CalendarRenderSnapshot = {
	description: '',
	sourceFormat: 'inline',
	checkbox: 'open',
	fieldValues: {},
	tags: [],
};

export function buildExternalCalendarItems(
	events: ExternalCalendarCachedEvent[],
	sources: ExternalCalendarSource[],
	rangeStart: string,
	rangeEnd: string,
	presetVisibility?: Record<string, boolean>,
	showExternalCalendars = true,
): CalendarItem[] {
	const sourceMap = new Map(
		sources
			.filter(source => source.enabled && showExternalCalendars !== false && (presetVisibility === undefined || presetVisibility[source.id] === true))
			.map(source => [source.id, source])
	);
	const items: CalendarItem[] = [];
	for (const event of events) {
		const source = sourceMap.get(event.sourceId);
		if (!source) continue;
		if (!intersectsDateRange(event.startDate, event.endDate, rangeStart, rangeEnd)) continue;
		const externalRef: CalendarExternalEventRef = {
			sourceId: source.id,
			sourceName: source.name,
			sourceColor: source.color,
			eventId: event.id,
			uid: event.uid,
			recurrenceId: event.recurrenceId,
			url: source.url,
		};
		items.push({
			taskId: event.id,
			kind: event.isAllDay ? 'allDayScheduled' : 'timed',
			startDate: event.startDate,
			endDate: event.endDate,
			startDateTime: event.startDateTime,
			endDateTime: event.endDateTime,
			isDashed: false,
			isReadOnly: true,
			origin: 'external',
			repeatRef: null,
			externalRef,
			sourceTask: null,
			renderSnapshot: {
				...EMPTY_SNAPSHOT,
				description: event.title,
			},
		});
	}
	return items;
}

function intersectsDateRange(
	startDate: string,
	endDate: string,
	rangeStart: string,
	rangeEnd: string,
): boolean {
	return startDate <= rangeEnd && endDate >= rangeStart;
}
