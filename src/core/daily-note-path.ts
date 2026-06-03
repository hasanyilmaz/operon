import { moment } from 'obsidian';

export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';

const DAILY_NOTE_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/u;

export interface DailyNotePathConfig {
	folder: string;
	format?: string | null;
}

type MomentDate = {
	isValid: () => boolean;
	format: (format: string) => string;
};

type MomentParser = (input: string, format: string, strict: boolean) => MomentDate;

export function isDailyNoteDateKey(value: string | null | undefined): boolean {
	return DAILY_NOTE_DATE_KEY_RE.test((value ?? '').trim());
}

export function normalizeDailyNoteFormat(format: string | null | undefined): string {
	const normalized = (format ?? '').trim();
	return normalized || DEFAULT_DAILY_NOTE_FORMAT;
}

export function normalizeDailyNotesFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/gu, '');
}

export function resolveDailyNotePathFromDateKey(dateKey: string, config: DailyNotePathConfig): string | null {
	const normalizedDate = dateKey.trim();
	if (!isDailyNoteDateKey(normalizedDate)) return null;

	const parseMomentDate = moment as unknown as MomentParser;
	const parsedDate = parseMomentDate(normalizedDate, DEFAULT_DAILY_NOTE_FORMAT, true);
	if (!parsedDate.isValid()) return null;

	const formattedPath = normalizeDailyNoteFormattedPath(parsedDate.format(normalizeDailyNoteFormat(config.format)));
	if (!formattedPath) return null;

	const folder = normalizeDailyNotesFolder(config.folder);
	const fileName = `${formattedPath}.md`;
	return folder ? `${folder}/${fileName}` : fileName;
}

export function resolveDailyNoteDateKeyFromPath(filePath: string | null | undefined, config: DailyNotePathConfig): string | null {
	const normalizedPath = normalizeDailyNoteFormattedPath(filePath ?? '');
	if (!normalizedPath || !/\.md$/iu.test(normalizedPath)) return null;

	const pathWithoutExtension = normalizedPath.slice(0, -3);
	const folder = normalizeDailyNotesFolder(config.folder);
	const formattedPath = folder
		? pathWithoutExtension.startsWith(`${folder}/`)
			? pathWithoutExtension.slice(folder.length + 1)
			: null
		: pathWithoutExtension;
	if (!formattedPath) return null;

	const format = normalizeDailyNoteFormat(config.format);
	const parseMomentDate = moment as unknown as MomentParser;
	const parsedDate = parseMomentDate(formattedPath, format, true);
	if (!parsedDate.isValid()) return null;

	const dateKey = parsedDate.format(DEFAULT_DAILY_NOTE_FORMAT);
	const expectedPath = resolveDailyNotePathFromDateKey(dateKey, config);
	return dailyNotePathsMatch(normalizedPath, expectedPath) ? dateKey : null;
}

export function dailyNotePathsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
	const normalizedLeft = normalizeDailyNoteFormattedPath(left ?? '');
	const normalizedRight = normalizeDailyNoteFormattedPath(right ?? '');
	return !!normalizedLeft && normalizedLeft === normalizedRight;
}

function normalizeDailyNoteFormattedPath(path: string): string {
	return path.trim().replace(/^\/+|\/+$/gu, '');
}
