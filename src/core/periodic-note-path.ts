import type { WeekNumbering } from './calendar-row-week';
import { moment } from 'obsidian';
import { isSafeVaultRelativeMarkdownPath, isSafeVaultRelativePath } from './vault-path-safety';

export { isSafeVaultRelativeMarkdownPath, isSafeVaultRelativePath } from './vault-path-safety';

export type PeriodicNoteKind = 'daily' | 'weekly';

export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_WEEKLY_NOTE_FORMAT = 'GGGG-[W]WW';

export const DEFAULT_PERIODIC_NOTE_FORMATS: Readonly<Record<PeriodicNoteKind, string>> = {
	daily: DEFAULT_DAILY_NOTE_FORMAT,
	weekly: DEFAULT_WEEKLY_NOTE_FORMAT,
};

const ISO_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/u;

export type PeriodicWeekStart = 'monday' | 'sunday';

export interface PeriodicNotePathConfig {
	weekStart?: PeriodicWeekStart;
	folder: string;
	format?: string | null;
}

export function localWeekNumbering(format: string | undefined): WeekNumbering | undefined {
	const tokens = normalizePeriodicNoteFormat('weekly', format).replace(/\[[^\]]*\]/gu, '');
	if (!tokens.includes('gggg') || !tokens.includes('ww') || tokens.includes('GGGG') || tokens.includes('WW')) return undefined;
	const locale = moment.localeData();
	const firstDay = locale.firstDayOfWeek();
	// Moment defines its first week by dow/doy. Convert doy to the January date inside week one.
	return { firstDay, januaryAnchor: 7 + firstDay - locale.firstDayOfYear() };
}

type MomentDate = {
	clone: () => MomentDate;
	add: (days: number, unit: 'day') => MomentDate;
	format: (format: string) => string;
	isValid: () => boolean;
	startOf: (unit: 'isoWeek') => MomentDate;
};

type MomentParser = (input: string, format: string, strict: boolean) => MomentDate;

export function isPeriodicNoteDateKey(value: string | null | undefined): boolean {
	const normalized = (value ?? '').trim();
	if (!ISO_DATE_KEY_RE.test(normalized)) return false;
	return parseDateKey(normalized)?.format(DEFAULT_DAILY_NOTE_FORMAT) === normalized;
}

export function normalizePeriodicNoteFormat(
	kind: PeriodicNoteKind,
	format: string | null | undefined,
): string {
	const normalized = (format ?? '').trim();
	return normalized || DEFAULT_PERIODIC_NOTE_FORMATS[kind];
}

export function isValidPeriodicNoteFormat(kind: PeriodicNoteKind, format: string): boolean {
	const tokens = normalizePeriodicNoteFormat(kind, format).replace(/\[[^\]]*\]/gu, '');
	const hasIsoWeekYear = tokens.includes('GGGG');
	const hasIsoWeek = tokens.includes('WW');
	const hasLocaleWeekYear = tokens.includes('gggg');
	const hasLocaleWeek = tokens.includes('ww');
	const hasIsoFamily = hasIsoWeekYear || hasIsoWeek;
	const hasLocaleFamily = hasLocaleWeekYear || hasLocaleWeek;
	if (hasIsoFamily && hasLocaleFamily) return false;
	if (hasIsoFamily && (!hasIsoWeekYear || !hasIsoWeek)) return false;
	if (hasLocaleFamily && (!hasLocaleWeekYear || !hasLocaleWeek)) return false;
	return true;
}

/** Empty represents the vault root; null represents an unsafe path. */
export function normalizePeriodicNoteFolder(folder: string | null | undefined): string | null {
	const normalized = (folder ?? '').trim();
	if (!normalized) return '';
	return isSafeVaultRelativePath(normalized) ? normalized : null;
}

/** ISO Monday remains the default for callers without a UI week-start preference. */
export function resolvePeriodicNoteAnchorDateKey(
	kind: PeriodicNoteKind,
	dateKey: string | null | undefined,
	weekStart: PeriodicWeekStart = 'monday',
): string | null {
	const parsed = parseDateKey((dateKey ?? '').trim());
	if (!parsed) return null;
	if (kind === 'weekly' && weekStart === 'sunday') {
		return parsed.add(1, 'day').startOf('isoWeek').add(-1, 'day').format(DEFAULT_DAILY_NOTE_FORMAT);
	}
	const anchor = kind === 'weekly' ? parsed.startOf('isoWeek') : parsed;
	return anchor.format(DEFAULT_DAILY_NOTE_FORMAT);
}

export function weeklyRowMonday(dateKey: string, weekStart: PeriodicWeekStart): string | null {
	const parsed = parseDateKey(dateKey);
	if (!parsed) return null;
	if (weekStart === 'sunday') parsed.add(1, 'day');
	return parsed.startOf('isoWeek').format(DEFAULT_DAILY_NOTE_FORMAT);
}

export function formatPeriodicNoteTitleFromDateKey(
	kind: PeriodicNoteKind,
	dateKey: string | null | undefined,
	format: string | null | undefined,
	weekStart: PeriodicWeekStart = 'monday',
): string | null {
	const anchorDateKey = resolvePeriodicNoteAnchorDateKey(kind, dateKey, weekStart);
	if (!anchorDateKey) return null;
	const parsed = parseDateKey(anchorDateKey);
	if (!parsed) return null;
	const normalizedFormat = normalizePeriodicNoteFormat(kind, format);
	if (!isValidPeriodicNoteFormat(kind, normalizedFormat)) return null;
	// Week-number tokens describe the calendar row by its Monday, including at year boundaries.
	const monday = kind === 'weekly' && weekStart === 'sunday' ? parsed.clone().add(1, 'day') : null;
	const titleFormat = monday ? normalizedFormat.replace(/\[[^\]]*\]|\\?(?:G{4,5}|GG|g{4,5}|gg|WW|Wo|W|ww|wo|w)|\\./gu,
		token => token.startsWith('[') || token.startsWith('\\') ? token : '[' + monday.format(token) + ']') : normalizedFormat;
	const title = parsed.format(titleFormat);
	if (title.toLowerCase().endsWith('.md')) return null;
	return isSafeVaultRelativeMarkdownPath(`${title}.md`) ? title : null;
}

export function resolvePeriodicNotePathFromDateKey(
	kind: PeriodicNoteKind,
	dateKey: string,
	config: PeriodicNotePathConfig,
): string | null {
	const folder = normalizePeriodicNoteFolder(config.folder);
	if (folder === null) return null;
	const title = formatPeriodicNoteTitleFromDateKey(kind, dateKey, config.format, config.weekStart);
	if (!title) return null;
	const filePath = folder ? `${folder}/${title}.md` : `${title}.md`;
	return isSafeVaultRelativeMarkdownPath(filePath) ? filePath : null;
}

/** Resolve the canonical Daily date or Weekly anchor represented by a path. */
export function resolvePeriodicNoteDateKeyFromPath(
	kind: PeriodicNoteKind,
	filePath: string | null | undefined,
	config: PeriodicNotePathConfig,
): string | null {
	const normalizedPath = (filePath ?? '').trim();
	if (!isSafeVaultRelativeMarkdownPath(normalizedPath)) return null;
	const folder = normalizePeriodicNoteFolder(config.folder);
	if (folder === null) return null;
	const pathWithoutExtension = normalizedPath.slice(0, -3);
	const formattedTitle = folder
		? pathWithoutExtension.startsWith(`${folder}/`)
			? pathWithoutExtension.slice(folder.length + 1)
			: null
		: pathWithoutExtension;
	if (!formattedTitle || !isSafeVaultRelativeMarkdownPath(`${formattedTitle}.md`)) return null;

	const parseMomentDate = moment as unknown as MomentParser;
	const parsed = parseMomentDate(formattedTitle, normalizePeriodicNoteFormat(kind, config.format), true);
	if (!parsed.isValid()) return null;
	const anchorDateKey = resolvePeriodicNoteAnchorDateKey(kind, parsed.format(DEFAULT_DAILY_NOTE_FORMAT), config.weekStart);
	if (!anchorDateKey) return null;
	const expectedPath = resolvePeriodicNotePathFromDateKey(kind, anchorDateKey, config);
	return periodicNotePathsMatch(normalizedPath, expectedPath) ? anchorDateKey : null;
}

export function periodicNotePathsMatch(
	left: string | null | undefined,
	right: string | null | undefined,
): boolean {
	const normalizedLeft = (left ?? '').trim();
	const normalizedRight = (right ?? '').trim();
	return !!normalizedLeft && normalizedLeft === normalizedRight;
}

function parseDateKey(value: string): MomentDate | null {
	if (!ISO_DATE_KEY_RE.test(value)) return null;
	const parseMomentDate = moment as unknown as MomentParser;
	const parsed = parseMomentDate(value, DEFAULT_DAILY_NOTE_FORMAT, true);
	return parsed.isValid() ? parsed : null;
}
