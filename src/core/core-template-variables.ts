import { moment } from 'obsidian';

export const CORE_TEMPLATE_DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const CORE_TEMPLATE_DEFAULT_TIME_FORMAT = 'HH:mm';

export interface CoreTemplateVariableContext {
	title: string;
	/** ISO-like local date in YYYY-MM-DD form. */
	date: string;
	/** ISO-like local datetime in YYYY-MM-DDTHH:mm:ss form. */
	now: string;
	/** Optional caller-provided equivalent of Obsidian Templates' Date format setting. */
	dateFormat?: string | null;
	/** Optional caller-provided equivalent of Obsidian Templates' Time format setting. */
	timeFormat?: string | null;
}

export interface ResolveCoreTemplateVariablesOptions {
	/** Keep fenced examples copyable in Operon-owned file-task templates. */
	resolveFencedCodeBlocks?: boolean;
}

type MomentDate = {
	isValid: () => boolean;
	format: (format: string) => string;
};

type MomentParser = (input: string, format: string, strict: boolean) => MomentDate;

const CORE_TEMPLATE_VARIABLE_PATTERN = /\{\{(title|date|time)(?::([^}]*))?\}\}/g;

function resolveFormat(explicitFormat: string | undefined, configuredFormat: string | null | undefined, fallback: string): string {
	if (explicitFormat?.trim()) return explicitFormat;
	return configuredFormat?.trim() || fallback;
}

function formatMomentValue(value: string, sourceFormat: string, outputFormat: string): string | null {
	const parseMomentDate = moment as unknown as MomentParser;
	const parsed = parseMomentDate(value, sourceFormat, true);
	return parsed.isValid() ? parsed.format(outputFormat) : null;
}

/**
 * Resolves the documented Obsidian Core Templates variables without invoking
 * the Core plugin. Callers choose when this is appropriate for their own
 * creation flow; ordinary Core Templates insertion remains Core-owned.
 */
export function resolveCoreTemplateVariables(
	content: string,
	context: CoreTemplateVariableContext,
	options: ResolveCoreTemplateVariablesOptions = {},
): string {
	if (!content.includes('{{')) return content;

	const resolveLine = (value: string): string => value.replace(CORE_TEMPLATE_VARIABLE_PATTERN, (match, key: string, explicitFormat: string | undefined) => {
		if (key === 'title') {
			// Core Templates does not define a formatted title form.
			return explicitFormat === undefined ? context.title : match;
		}
		if (explicitFormat !== undefined && !explicitFormat.trim()) return match;

		if (key === 'date') {
			const format = resolveFormat(explicitFormat, context.dateFormat, CORE_TEMPLATE_DEFAULT_DATE_FORMAT);
			return formatMomentValue(context.date, CORE_TEMPLATE_DEFAULT_DATE_FORMAT, format) ?? match;
		}

		const format = resolveFormat(explicitFormat, context.timeFormat, CORE_TEMPLATE_DEFAULT_TIME_FORMAT);
		return formatMomentValue(context.now, 'YYYY-MM-DDTHH:mm:ss', format) ?? match;
	});

	if (options.resolveFencedCodeBlocks !== false) return resolveLine(content);

	let inFencedCodeBlock = false;
	return content.split('\n').map(line => {
		if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			return line;
		}
		return inFencedCodeBlock ? line : resolveLine(line);
	}).join('\n');
}
