import type { CreateFieldItemV1 } from '../contracts/v1/mutation';
import {
	isPeriodicNoteDateKey,
	resolvePeriodicNoteAnchorDateKey,
	type PeriodicNoteKind,
} from '../../core/periodic-note-path';

export type PeriodicNoteRouteSourceV1 =
	| 'explicit-route-date'
	| 'date-scheduled'
	| 'datetime-start-local-date'
	| 'local-today';

export interface PeriodicNoteCreateRouteV1 {
	periodicKind: PeriodicNoteKind;
	routeDateKey: string;
	periodicAnchorDateKey: string;
	routeSource: PeriodicNoteRouteSourceV1;
	conflictingFieldDate?: string;
}

export type PeriodicNoteCreateRouteResultV1 =
	| { ok: true; route: PeriodicNoteCreateRouteV1 }
	| { ok: false; reason: string };

export function resolvePeriodicNoteCreateRouteV1(options: {
	periodicKind: PeriodicNoteKind;
	routeDate?: string;
	fields: readonly CreateFieldItemV1[];
	today: string;
}): PeriodicNoteCreateRouteResultV1 {
	const explicitRouteDate = options.routeDate?.trim() ?? '';
	if (explicitRouteDate && !isPeriodicNoteDateKey(explicitRouteDate)) {
		return { ok: false, reason: 'Periodic routeDate must be a strict local YYYY-MM-DD date.' };
	}
	const scheduledDates = options.fields.filter(field => (
		field.kind === 'date' && field.field === 'dateScheduled'
	));
	const startDatetimes = options.fields.filter(field => (
		field.kind === 'datetime' && field.field === 'datetimeStart'
	));
	if (scheduledDates.length > 1 || startDatetimes.length > 1) {
		return { ok: false, reason: 'Periodic routing fields must not be duplicated.' };
	}
	const scheduledDate = (scheduledDates[0] as { value?: string } | undefined)?.value?.trim() ?? '';
	if (scheduledDate && !isPeriodicNoteDateKey(scheduledDate)) {
		return { ok: false, reason: 'dateScheduled must be a strict local YYYY-MM-DD date.' };
	}
	const startDate = (startDatetimes[0] as { value?: string } | undefined)?.value?.slice(0, 10) ?? '';
	if (startDatetimes.length > 0 && !isPeriodicNoteDateKey(startDate)) {
		return { ok: false, reason: 'datetimeStart must contain a valid local calendar date.' };
	}
	if (!isPeriodicNoteDateKey(options.today)) {
		return { ok: false, reason: 'The Runtime local-today fallback is invalid.' };
	}

	const routeDateKey = explicitRouteDate || scheduledDate || startDate || options.today;
	const routeSource: PeriodicNoteRouteSourceV1 = explicitRouteDate
		? 'explicit-route-date'
		: scheduledDate
			? 'date-scheduled'
			: startDate
				? 'datetime-start-local-date'
				: 'local-today';
	const periodicAnchorDateKey = resolvePeriodicNoteAnchorDateKey(options.periodicKind, routeDateKey);
	if (!periodicAnchorDateKey) return { ok: false, reason: 'The periodic route anchor is invalid.' };
	const conflictingFieldDate = explicitRouteDate && (scheduledDate || startDate)
		&& explicitRouteDate !== (scheduledDate || startDate)
		? (scheduledDate || startDate)
		: undefined;
	return {
		ok: true,
		route: {
			periodicKind: options.periodicKind,
			routeDateKey,
			periodicAnchorDateKey,
			routeSource,
			...(conflictingFieldDate ? { conflictingFieldDate } : {}),
		},
	};
}
