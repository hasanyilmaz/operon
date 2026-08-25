export const GANTT_SCALES = ['day', 'week', 'month'] as const;
export type GanttScale = typeof GANTT_SCALES[number];

export const GANTT_UNIT_WIDTH_MULTIPLIERS = [0.75, 1, 1.25, 1.5] as const;
export type GanttUnitWidthMultiplier = typeof GANTT_UNIT_WIDTH_MULTIPLIERS[number];
export type GanttWeekStart = 'monday' | 'sunday';

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

export interface GanttTaskProjection {
	taskId: string;
	bar: GanttTaskBar | null;
	deadline: GanttDeadlineMarker | null;
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

export interface GanttDateAxis {
	startDate: string;
	endDate: string;
	scale: GanttScale;
	weekStart: GanttWeekStart;
	dayWidthPx: number;
	totalWidthPx: number;
	days: GanttDateAxisDay[];
	headerGroups: GanttDateAxisHeaderGroup[];
}

export interface BuildGanttDateAxisOptions {
	startDate: string;
	endDate: string;
	scale: GanttScale;
	weekStart: GanttWeekStart;
	baseDayWidthPx: number;
	unitWidthMultiplier: GanttUnitWidthMultiplier;
}
