import { t } from './i18n';

export interface FilenameRule {
	preset: 'same' | 'kebab' | 'snake';
}

export type FileTaskTitleChangeMode = 'keep' | 'ask' | 'auto';

export interface FileTaskRenameSuggestion {
	filename: string;
	error?: string;
}

export const DEFAULT_FILENAME_RULE: FilenameRule = {
	preset: 'same',
};

export function normalizeFilenameRule(value: unknown): FilenameRule {
	const record = value && typeof value === 'object' ? value : {};
	const preset = 'preset' in record ? record.preset : undefined;
	return {
		preset: preset === 'kebab' || preset === 'snake' ? preset : 'same',
	};
}

export function sanitizeTaskFilename(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

export function deriveTaskFilename(title: string, rule: FilenameRule): string {
	let filename = title.trim();
	if (rule.preset === 'kebab' || rule.preset === 'snake') {
		const separator = rule.preset === 'kebab' ? '-' : '_';
		filename = filename.toLowerCase()
			.replace(/[\s\p{P}]+/gu, separator)
			.replace(rule.preset === 'kebab' ? /[^\p{L}\p{M}\p{N}-]/gu : /[^\p{L}\p{M}\p{N}_]/gu, '')
			.replace(rule.preset === 'kebab' ? /-+/g : /_+/g, separator)
			.replace(rule.preset === 'kebab' ? /^-+|-+$/g : /^_+|_+$/g, '');
	}
	return sanitizeTaskFilename(filename);
}

/** Called only after an Operon UI title edit has committed, never by index refresh. */
export async function filenameSuggestionAfterTitleEdit(
	title: string,
	basename: string,
	mode: FileTaskTitleChangeMode,
	rule: FilenameRule,
): Promise<FileTaskRenameSuggestion | null> {
	if (mode !== 'ask' || !title.trim()) return null;
	const filename = deriveTaskFilename(title, rule);
	if (!filename) return {
		filename: basename,
		error: t('taskEditor', 'fileTaskFilenameFallback', { filename: `${basename}.md` }),
	};
	if (filename === basename) return null;
	return { filename };
}
