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

export interface PeriodicNotePathConfig {
	folder: string;
	format?: string | null;
}

type MomentDate = {
	clone: () => MomentDate;
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

/** Resolve the canonical anchor date. Weekly notes always use the ISO Monday. */
export function resolvePeriodicNoteAnchorDateKey(
	kind: PeriodicNoteKind,
	dateKey: string | null | undefined,
): string | null {
	const parsed = parseDateKey((dateKey ?? '').trim());
	if (!parsed) return null;
	const anchor = kind === 'weekly' ? parsed.clone().startOf('isoWeek') : parsed;
	return anchor.format(DEFAULT_DAILY_NOTE_FORMAT);
}

export function formatPeriodicNoteTitleFromDateKey(
	kind: PeriodicNoteKind,
	dateKey: string | null | undefined,
	format: string | null | undefined,
): string | null {
	const anchorDateKey = resolvePeriodicNoteAnchorDateKey(kind, dateKey);
	if (!anchorDateKey) return null;
	const parsed = parseDateKey(anchorDateKey);
	if (!parsed) return null;
	const normalizedFormat = normalizePeriodicNoteFormat(kind, format);
	if (!isValidPeriodicNoteFormat(kind, normalizedFormat)) return null;
	const title = parsed.format(normalizedFormat);
	if (title.toLowerCase().endsWith('.md')) return null;
	return isSafeVaultRelativePath(title) ? title : null;
}

export function resolvePeriodicNotePathFromDateKey(
	kind: PeriodicNoteKind,
	dateKey: string,
	config: PeriodicNotePathConfig,
): string | null {
	const folder = normalizePeriodicNoteFolder(config.folder);
	if (folder === null) return null;
	const title = formatPeriodicNoteTitleFromDateKey(kind, dateKey, config.format);
	if (!title) return null;
	const filePath = folder ? `${folder}/${title}.md` : `${title}.md`;
	return isSafeVaultRelativeMarkdownPath(filePath) ? filePath : null;
}

/** Resolve the canonical Daily date or Weekly ISO-Monday represented by a path. */
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
	if (!formattedTitle || !isSafeVaultRelativePath(formattedTitle)) return null;

	const parseMomentDate = moment as unknown as MomentParser;
	const parsed = parseMomentDate(formattedTitle, normalizePeriodicNoteFormat(kind, config.format), true);
	if (!parsed.isValid()) return null;
	const anchorDateKey = resolvePeriodicNoteAnchorDateKey(kind, parsed.format(DEFAULT_DAILY_NOTE_FORMAT));
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
