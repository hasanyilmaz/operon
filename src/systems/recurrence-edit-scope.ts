import { CalendarSlotSelection } from '../types/calendar';
import {
	RepeatFollowingOverride,
	RepeatSingleOccurrenceOverride,
	RepeatTemporalMode,
} from '../storage/repeat-series-store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;

export type RepeatEditScopeChoice = 'thisTask' | 'thisAndFollowingTasks' | 'skipThisTask';

export interface RepeatTemporalSnapshot {
	occurrenceDate: string;
	scheduledDate: string;
	mode: RepeatTemporalMode;
	dateShiftDays: number;
	startDateShiftDays: number;
	endDateShiftDays: number;
	startTime: string | null;
	endTime: string | null;
	estimate: string | null;
}

export interface RepeatTemporalSnapshotLabels {
	unavailable: string;
	allDay: string;
}

export interface RepeatTemporalSnapshotFromSelectionOptions {
	preserveExistingDuration?: boolean;
}

const DEFAULT_REPEAT_TEMPORAL_SNAPSHOT_LABELS: RepeatTemporalSnapshotLabels = {
	unavailable: 'Unavailable',
	allDay: 'All day',
};

export function buildRepeatTemporalSnapshotFromFieldValues(
	occurrenceDate: string,
	fieldValues: Record<string, string>,
): RepeatTemporalSnapshot | null {
	const canonicalDate = normalizeDate(occurrenceDate);
	const scheduledDate = normalizeDate(fieldValues['dateScheduled']);
	if (!canonicalDate || !scheduledDate) return null;

	const datetimeStart = normalizeDatetime(fieldValues['datetimeStart']);
	const datetimeEnd = normalizeDatetime(fieldValues['datetimeEnd']);
	const startTime = extractTime(datetimeStart);
	const endTime = extractTime(datetimeEnd);
	const mode: RepeatTemporalMode = startTime && endTime ? 'timed' : 'allDay';
	const startDate = mode === 'timed'
		? datetimeStart.slice(0, 10)
		: normalizeDate(fieldValues['dateStarted']) || scheduledDate;
	const endDate = mode === 'timed'
		? datetimeEnd.slice(0, 10)
		: resolveAllDayEndDate(fieldValues, scheduledDate);
	return {
		occurrenceDate: canonicalDate,
		scheduledDate,
		mode,
		dateShiftDays: dateDiffDays(canonicalDate, scheduledDate),
		startDateShiftDays: dateDiffDays(canonicalDate, startDate),
		endDateShiftDays: dateDiffDays(canonicalDate, endDate),
		startTime: mode === 'timed' ? startTime : null,
		endTime: mode === 'timed' ? endTime : null,
		estimate: normalizeOptional(fieldValues['estimate']),
	};
}

export function buildRepeatTemporalSnapshotFromSelection(
	occurrenceDate: string,
	selection: CalendarSlotSelection,
	existingFields: Record<string, string> = {},
	options: RepeatTemporalSnapshotFromSelectionOptions = {},
): RepeatTemporalSnapshot | null {
	const canonicalDate = normalizeDate(occurrenceDate);
	if (!canonicalDate) return null;

	if (selection.mode === 'allDay') {
		const scheduledDate = normalizeDate(selection.startDate);
		const endDate = normalizeDate(selection.endDate);
		if (!scheduledDate || !endDate) return null;
		return {
			occurrenceDate: canonicalDate,
			scheduledDate,
			mode: 'allDay',
			dateShiftDays: dateDiffDays(canonicalDate, scheduledDate),
			startDateShiftDays: dateDiffDays(canonicalDate, scheduledDate),
			endDateShiftDays: dateDiffDays(canonicalDate, endDate),
			startTime: null,
			endTime: null,
			estimate: normalizeOptional(existingFields['estimate']),
		};
	}

	const scheduledDate = normalizeDate(selection.startDate);
	const startDate = extractDate(selection.start);
	const endDate = extractDate(selection.end);
	const startTime = extractTime(selection.start);
	const endTime = extractTime(selection.end);
	if (!scheduledDate || !startDate || !endDate || !startTime || !endTime) return null;
	const estimateSeconds = calculateSelectionEstimateSeconds(selection);
	const existingEstimate = normalizeOptional(existingFields['estimate']);
	const preservedEstimateSeconds = options.preserveExistingDuration === true && existingEstimate
		? Number.parseInt(existingEstimate, 10)
		: 0;
	const preservedEnd = Number.isFinite(preservedEstimateSeconds) && preservedEstimateSeconds > 0
		? deriveSelectionEndFromEstimate(selection.start, preservedEstimateSeconds)
		: null;
	const finalEndDate = preservedEnd?.date ?? endDate;
	const finalEndTime = preservedEnd?.time ?? endTime;
	return {
		occurrenceDate: canonicalDate,
		scheduledDate,
		mode: 'timed',
		dateShiftDays: dateDiffDays(canonicalDate, scheduledDate),
		startDateShiftDays: dateDiffDays(canonicalDate, startDate),
		endDateShiftDays: dateDiffDays(canonicalDate, finalEndDate),
		startTime,
		endTime: finalEndTime,
		estimate: preservedEnd && existingEstimate
			? existingEstimate
			: estimateSeconds > 0
				? String(estimateSeconds)
				: existingEstimate,
	};
}

export function buildSingleOccurrenceOverride(
	snapshot: RepeatTemporalSnapshot,
	now: string,
): RepeatSingleOccurrenceOverride {
	return {
		occurrenceDate: snapshot.occurrenceDate,
		scheduledDate: snapshot.scheduledDate,
		mode: snapshot.mode,
		startDateShiftDays: snapshot.startDateShiftDays,
		endDateShiftDays: snapshot.endDateShiftDays,
		startTime: snapshot.startTime,
		endTime: snapshot.endTime,
		estimate: snapshot.estimate,
		updatedAt: now,
	};
}

export function buildFollowingOverride(
	snapshot: RepeatTemporalSnapshot,
	now: string,
): RepeatFollowingOverride {
	return {
		effectiveFrom: snapshot.occurrenceDate,
		dateShiftDays: snapshot.dateShiftDays,
		mode: snapshot.mode,
		startDateShiftDays: snapshot.startDateShiftDays,
		endDateShiftDays: snapshot.endDateShiftDays,
		startTime: snapshot.startTime,
		endTime: snapshot.endTime,
		estimate: snapshot.estimate,
		updatedAt: now,
	};
}

export function reanchorRepeatTemporalSnapshotToScheduledDate(
	snapshot: RepeatTemporalSnapshot,
): RepeatTemporalSnapshot {
	const nextOccurrenceDate = snapshot.scheduledDate;
	const startDate = shiftDateKey(snapshot.occurrenceDate, snapshot.startDateShiftDays);
	const endDate = shiftDateKey(snapshot.occurrenceDate, snapshot.endDateShiftDays);
	return {
		...snapshot,
		occurrenceDate: nextOccurrenceDate,
		dateShiftDays: 0,
		startDateShiftDays: dateDiffDays(nextOccurrenceDate, startDate),
		endDateShiftDays: dateDiffDays(nextOccurrenceDate, endDate),
	};
}

export function hasRepeatTemporalChange(
	beforeSnapshot: RepeatTemporalSnapshot | null,
	afterSnapshot: RepeatTemporalSnapshot | null,
): boolean {
	if (!beforeSnapshot || !afterSnapshot) return false;
	return beforeSnapshot.scheduledDate !== afterSnapshot.scheduledDate
		|| beforeSnapshot.mode !== afterSnapshot.mode
		|| beforeSnapshot.startDateShiftDays !== afterSnapshot.startDateShiftDays
		|| beforeSnapshot.endDateShiftDays !== afterSnapshot.endDateShiftDays
		|| beforeSnapshot.startTime !== afterSnapshot.startTime
		|| beforeSnapshot.endTime !== afterSnapshot.endTime
		|| beforeSnapshot.estimate !== afterSnapshot.estimate;
}

export function formatRepeatTemporalSnapshot(
	snapshot: RepeatTemporalSnapshot | null,
	labels: RepeatTemporalSnapshotLabels = DEFAULT_REPEAT_TEMPORAL_SNAPSHOT_LABELS,
): string {
	if (!snapshot) return labels.unavailable;
	if (snapshot.mode === 'allDay') {
		const endDate = shiftDateKey(snapshot.occurrenceDate, snapshot.endDateShiftDays);
		return endDate === snapshot.scheduledDate
			? `${snapshot.scheduledDate} · ${labels.allDay}`
			: `${snapshot.scheduledDate} → ${endDate} · ${labels.allDay}`;
	}
	const start = snapshot.startTime ? snapshot.startTime.slice(0, 5) : '--:--';
	const end = snapshot.endTime ? snapshot.endTime.slice(0, 5) : '--:--';
	const endDate = shiftDateKey(snapshot.occurrenceDate, snapshot.endDateShiftDays);
	return endDate === snapshot.scheduledDate
		? `${snapshot.scheduledDate} · ${start}-${end}`
		: `${snapshot.scheduledDate} → ${endDate} · ${start}-${end}`;
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function extractTime(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return null;
	if (/^\d{2}:\d{2}:\d{2}$/u.test(trimmed)) return trimmed;
	if (/^\d{2}:\d{2}$/u.test(trimmed)) return `${trimmed}:00`;
	if (DATETIME_RE.test(trimmed)) return trimmed.slice(11);
	return null;
}

function extractDate(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return null;
	if (DATETIME_RE.test(trimmed)) return trimmed.slice(0, 10);
	return normalizeDate(trimmed) || null;
}

function normalizeDatetime(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return DATETIME_RE.test(trimmed) ? trimmed : '';
}

function normalizeOptional(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	return trimmed || null;
}

function dateDiffDays(fromDate: string, toDate: string): number {
	const from = parseDateKey(fromDate);
	const to = parseDateKey(toDate);
	if (!from || !to) return 0;
	return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function parseDateKey(value: string): Date | null {
	if (!DATE_RE.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
	const parsed = parseDateKey(dateKey);
	if (!parsed) return dateKey;
	parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
	const year = parsed.getUTCFullYear();
	const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
	const day = String(parsed.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function resolveAllDayEndDate(fieldValues: Record<string, string>, scheduledDate: string): string {
	const dateStarted = normalizeDate(fieldValues['dateStarted']);
	const dateDue = normalizeDate(fieldValues['dateDue']);
	if (!dateDue) return scheduledDate;
	// Anchor the due-date offset to dateStarted when present, otherwise to
	// dateScheduled. Without this fallback a task that only has scheduled + due
	// (no started) loses its due offset on recurrence and dateDue collapses onto
	// dateScheduled.
	const anchor = dateStarted ?? scheduledDate;
	return dateDue >= anchor ? dateDue : scheduledDate;
}

function parseBoundary(value: string): Date | null {
	const trimmed = value.trim();
	if (!DATETIME_RE.test(trimmed)) return null;
	const [datePart, timePart] = trimmed.split('T');
	const [year, month, day] = datePart.split('-').map(Number);
	const [hour, minute, second] = timePart.split(':').map(Number);
	return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
}

function calculateSelectionEstimateSeconds(selection: CalendarSlotSelection): number {
	const start = parseBoundary(selection.start);
	const end = parseBoundary(selection.end);
	if (!start || !end) return 0;
	return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function deriveSelectionEndFromEstimate(startValue: string, estimateSeconds: number): { date: string; time: string } | null {
	const start = parseBoundary(startValue);
	if (!start || !Number.isFinite(estimateSeconds) || estimateSeconds <= 0) return null;
	const end = new Date(start.getTime() + estimateSeconds * 1000);
	return {
		date: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`,
		time: `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}:${String(end.getUTCSeconds()).padStart(2, '0')}`,
	};
}
