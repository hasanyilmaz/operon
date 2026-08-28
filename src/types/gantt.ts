export const GANTT_SCALES = ['day', 'week'] as const;
export type GanttScale = typeof GANTT_SCALES[number];

export const GANTT_UNIT_WIDTH_MULTIPLIERS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type GanttUnitWidthMultiplier = typeof GANTT_UNIT_WIDTH_MULTIPLIERS[number];
export const LEGACY_GANTT_SCALE = 'month' as const;
export const LEGACY_MONTH_GANTT_UNIT_WIDTH_MULTIPLIERS = [0.75, 1, 1.25, 1.5] as const;
export type GanttWeekStart = 'monday' | 'sunday';

export interface NormalizedGanttScaleAndWidth {
	scale: GanttScale;
	unitWidthMultiplier: GanttUnitWidthMultiplier;
}

export function normalizeGanttScaleAndWidth(
	scale: unknown,
	unitWidthMultiplier: unknown,
	fallback: NormalizedGanttScaleAndWidth = { scale: 'day', unitWidthMultiplier: 1 },
): NormalizedGanttScaleAndWidth {
	if (scale === LEGACY_GANTT_SCALE) {
		return {
			scale: 'week',
			unitWidthMultiplier: normalizeLegacyMonthWidth(unitWidthMultiplier),
		};
	}
	return {
		scale: GANTT_SCALES.includes(scale as GanttScale) ? scale as GanttScale : fallback.scale,
		unitWidthMultiplier: GANTT_UNIT_WIDTH_MULTIPLIERS.includes(unitWidthMultiplier as GanttUnitWidthMultiplier)
			? unitWidthMultiplier as GanttUnitWidthMultiplier
			: fallback.unitWidthMultiplier,
	};
}

export function isSupportedPersistedGanttScaleAndWidth(
	scale: unknown,
	unitWidthMultiplier: unknown,
): boolean {
	if (scale === LEGACY_GANTT_SCALE) {
		return LEGACY_MONTH_GANTT_UNIT_WIDTH_MULTIPLIERS.includes(
			unitWidthMultiplier as typeof LEGACY_MONTH_GANTT_UNIT_WIDTH_MULTIPLIERS[number],
		);
	}
	return GANTT_SCALES.includes(scale as GanttScale)
		&& GANTT_UNIT_WIDTH_MULTIPLIERS.includes(unitWidthMultiplier as GanttUnitWidthMultiplier);
}

function normalizeLegacyMonthWidth(value: unknown): GanttUnitWidthMultiplier {
	if (value === 0.75 || value === 1) return 0.25;
	if (value === 1.25 || value === 1.5) return 0.5;
	return 0.25;
}

export type GanttTaskBarKind = 'all-day-range' | 'timed' | 'scheduled';

export interface GanttTaskBar {
	kind: GanttTaskBarKind;
	startDate: string;
	endDate: string;
	startDateTime: string | null;
	endDateTime: string | null;
}

export interface GanttDeadlineMarker {
	date: string;
}

export const GANTT_DATE_MARKER_KEYS = ['dateStarted', 'dateScheduled', 'dateDue'] as const;
export type GanttDateMarkerKey = typeof GANTT_DATE_MARKER_KEYS[number];

export interface GanttDateMarker {
	key: GanttDateMarkerKey;
	date: string;
}

export interface GanttTaskProjection {
	taskId: string;
	bar: GanttTaskBar | null;
	deadline: GanttDeadlineMarker | null;
	markers: GanttDateMarker[];
}

export interface GanttDateAxisDay {
	date: string;
	index: number;
	x: number;
	width: number;
}

export interface GanttDateAxisHeaderGroup {
	scale: GanttScale;
	startDate: string;
	endDate: string;
	startIndex: number;
	dayCount: number;
	x: number;
	width: number;
}

export type GanttDateAxisContextUnit = 'week' | 'month';

export interface GanttDateAxisContextGroup {
	unit: GanttDateAxisContextUnit;
	startDate: string;
	endDate: string;
	startIndex: number;
	dayCount: number;
	x: number;
	width: number;
}

export interface GanttDateAxis {
	startDate: string;
	endDate: string;
	scale: GanttScale;
	weekStart: GanttWeekStart;
	dayWidthPx: number;
	totalWidthPx: number;
	days: GanttDateAxisDay[];
	headerGroups: GanttDateAxisHeaderGroup[];
	contextHeaderGroups: GanttDateAxisContextGroup[];
}

export interface BuildGanttDateAxisOptions {
	startDate: string;
	endDate: string;
	scale: GanttScale;
	weekStart: GanttWeekStart;
	baseDayWidthPx: number;
	unitWidthMultiplier: GanttUnitWidthMultiplier;
}
