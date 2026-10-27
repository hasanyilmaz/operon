import { RE2JS, RE2JSException } from 're2js';
import { t } from './i18n';

export interface FilenameRegexRule {
	pattern: string;
	replacement: string;
}

export interface FilenameRule {
	preset: 'same' | 'kebab' | 'snake' | 'custom';
	lowercase: boolean;
	rules: FilenameRegexRule[];
}

export type FileTaskTitleChangeMode = 'keep' | 'ask' | 'auto';

export interface FileTaskRenameSuggestion {
	filename: string;
	error?: string;
}

export const DEFAULT_FILENAME_RULE: FilenameRule = {
	preset: 'kebab',
	lowercase: true,
	rules: [],
};

const MAX_RULES = 16;
const MAX_PATTERN_LENGTH = 256;
const MAX_REPLACEMENT_LENGTH = 256;
const MAX_TEXT_LENGTH = 1024;
const MAX_PROGRAM_SIZE = 2048;

function assertRuleLimit(condition: boolean): void {
	if (!condition) throw new Error(t('settings', 'fileTaskFilenameRuleLimits'));
}

function compileFilenameRules(rule: FilenameRule): RE2JS[] {
	assertRuleLimit(rule.rules.length <= MAX_RULES);
	return rule.rules.map(item => {
		assertRuleLimit(item.pattern.length <= MAX_PATTERN_LENGTH && item.replacement.length <= MAX_REPLACEMENT_LENGTH);
		let compiled: RE2JS;
		try {
			compiled = RE2JS.compile(RE2JS.translateRegExp(item.pattern));
		} catch (error) {
			if (!(error instanceof RE2JSException)) throw error;
			throw new Error(t('settings', 'fileTaskFilenameRuleInvalid', { error: error.message }));
		}
		assertRuleLimit(compiled.programSize() <= MAX_PROGRAM_SIZE);
		return compiled;
	});
}

export function validateFilenameRule(rule: FilenameRule): void {
	if (rule.preset === 'custom') compileFilenameRules(rule);
}

export function normalizeFilenameRule(value: unknown): FilenameRule {
	const record = value && typeof value === 'object' ? value : {};
	const preset = 'preset' in record ? record.preset : undefined;
	return {
		preset: preset === 'same' || preset === 'snake' || preset === 'custom' ? preset : 'kebab',
		lowercase: 'lowercase' in record ? record.lowercase === true : true,
		rules: 'rules' in record && Array.isArray(record.rules)
			? record.rules.filter((rule: unknown): rule is FilenameRegexRule => (
				!!rule && typeof rule === 'object'
				&& 'pattern' in rule && typeof rule.pattern === 'string'
				&& 'replacement' in rule && typeof rule.replacement === 'string'
			)).map(rule => ({ pattern: rule.pattern, replacement: rule.replacement }))
			: [],
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
			.replace(rule.preset === 'kebab' ? /[^\p{L}\p{N}-]/gu : /[^\p{L}\p{N}_]/gu, '')
			.replace(rule.preset === 'kebab' ? /-+/g : /_+/g, separator)
			.replace(rule.preset === 'kebab' ? /^-+|-+$/g : /^_+|_+$/g, '');
	} else if (rule.preset === 'custom') {
		assertRuleLimit(filename.length <= MAX_TEXT_LENGTH);
		const compiled = compileFilenameRules(rule);
		if (rule.lowercase) filename = filename.toLowerCase();
		assertRuleLimit(filename.length <= MAX_TEXT_LENGTH);
		for (const [index, pattern] of compiled.entries()) {
			filename = pattern.matcher(filename).replaceAll(rule.rules[index].replacement);
			assertRuleLimit(filename.length <= MAX_TEXT_LENGTH);
		}
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
	let filename: string;
	try {
		filename = deriveTaskFilename(title, rule);
	} catch (error) {
		return { filename: sanitizeTaskFilename(title), error: error instanceof Error ? error.message : String(error) };
	}
	if (!filename) return {
		filename: basename,
		error: t('taskEditor', 'fileTaskFilenameFallback', { filename: `${basename}.md` }),
	};
	if (filename === basename) return null;
	return { filename };
}
