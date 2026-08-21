import {
	DEFAULT_DAILY_NOTE_FORMAT,
	formatPeriodicNoteTitleFromDateKey,
	periodicNotePathsMatch,
	resolvePeriodicNoteDateKeyFromPath,
	resolvePeriodicNotePathFromDateKey,
	type PeriodicNotePathConfig,
} from './periodic-note-path';

export { DEFAULT_DAILY_NOTE_FORMAT } from './periodic-note-path';

export type DailyNotePathConfig = PeriodicNotePathConfig;

export function isDailyNoteDateKey(value: string | null | undefined): boolean {
	return formatPeriodicNoteTitleFromDateKey('daily', value, DEFAULT_DAILY_NOTE_FORMAT) !== null;
}

export function normalizeDailyNoteFormat(format: string | null | undefined): string {
	const normalized = (format ?? '').trim();
	return normalized || DEFAULT_DAILY_NOTE_FORMAT;
}

/**
 * Format an ISO date key using the Core Daily Notes date format.
 * Returns null when the source date key is not a valid YYYY-MM-DD value.
 */
export function formatDailyNoteTitleFromDateKey(
	dateKey: string | null | undefined,
	format: string | null | undefined,
): string | null {
	return formatPeriodicNoteTitleFromDateKey('daily', dateKey, format);
}

export function normalizeDailyNotesFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/gu, '');
}

export function resolveDailyNotePathFromDateKey(dateKey: string, config: DailyNotePathConfig): string | null {
	return resolvePeriodicNotePathFromDateKey('daily', dateKey, config);
}

export function resolveDailyNoteDateKeyFromPath(filePath: string | null | undefined, config: DailyNotePathConfig): string | null {
	return resolvePeriodicNoteDateKeyFromPath('daily', filePath, config);
}

export function dailyNotePathsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
	const normalizedLeft = (left ?? '').trim().replace(/^\/+|\/+$/gu, '');
	const normalizedRight = (right ?? '').trim().replace(/^\/+|\/+$/gu, '');
	return periodicNotePathsMatch(normalizedLeft, normalizedRight);
}
