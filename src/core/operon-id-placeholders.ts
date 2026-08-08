import { isTaskLineCandidate } from './parser';
import { splitFrontmatterDocument } from './file-task-template-merge';

export interface ResolveOperonIdPlaceholdersOptions {
	generateOperonId: () => string;
	now?: string;
	rawContext?: RawOperonTaskLinePlaceholderContext;
	onIdentityAllocation?: (allocation: { occurrence: number; suffix?: string; operonId: string }) => void;
}

export interface RawOperonTaskLinePlaceholderContext {
	status: string;
	priority: string;
}

export interface OperonTemplatePlaceholderContext {
	date: string;
	time: string;
	datetime: string;
	taskDescription: string;
	note: string;
	dateStarted: string;
	dateScheduled: string;
	dateDue: string;
	status: string;
	priority: string;
}

export interface ResolveOperonTemplatePlaceholdersOptions extends ResolveOperonIdPlaceholdersOptions {
	context: OperonTemplatePlaceholderContext;
	resolveBodyText?: boolean;
}

const PLACEHOLDER_PATTERN = /\{\{operonId([0-9A-Za-z]?)\}\}/g;
const RAW_TASK_LINE_PLACEHOLDER_PATTERN = /\{\{(date|time|datetime|status|priority)\}\}/g;
const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{(date|time|datetime|taskDescription|note|dateStarted|dateScheduled|dateDue|status|priority)\}\}/g;

function replaceRawTaskLinePlaceholders(text: string, options: ResolveOperonIdPlaceholdersOptions): string {
	if (!options.now && !options.rawContext) return text;
	return text.replace(RAW_TASK_LINE_PLACEHOLDER_PATTERN, (match, key: string) => {
		if (key === 'date') return options.now ? options.now.slice(0, 10) : match;
		if (key === 'time') return options.now ? options.now.slice(11, 16) : match;
		if (key === 'datetime') return options.now ?? match;
		return options.rawContext?.[key as keyof RawOperonTaskLinePlaceholderContext] ?? '';
	});
}

function hasRawTaskLinePlaceholder(text: string): boolean {
	RAW_TASK_LINE_PLACEHOLDER_PATTERN.lastIndex = 0;
	const found = RAW_TASK_LINE_PLACEHOLDER_PATTERN.test(text);
	RAW_TASK_LINE_PLACEHOLDER_PATTERN.lastIndex = 0;
	return found;
}

function replaceTemplatePlaceholders(
	text: string,
	context: OperonTemplatePlaceholderContext,
): string {
	return text.replace(TEMPLATE_PLACEHOLDER_PATTERN, (_match, key: string) => {
		return context[key as keyof OperonTemplatePlaceholderContext] ?? '';
	});
}

function hasTemplatePlaceholder(text: string): boolean {
	TEMPLATE_PLACEHOLDER_PATTERN.lastIndex = 0;
	const found = TEMPLATE_PLACEHOLDER_PATTERN.test(text);
	TEMPLATE_PLACEHOLDER_PATTERN.lastIndex = 0;
	return found;
}

function generateUniqueLocalOperonId(
	generateOperonId: () => string,
	usedIds: Set<string>,
): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		const next = generateOperonId();
		if (usedIds.has(next)) continue;
		usedIds.add(next);
		return next;
	}
	throw new Error('Failed to generate unique local operonId placeholder after 100 attempts');
}

function replaceYamlPlaceholders(
	frontmatter: string,
	options: ResolveOperonIdPlaceholdersOptions,
	usedIds: Set<string>,
	stableIds: Map<string, string>,
	context?: OperonTemplatePlaceholderContext,
	ordinal: { value: number } = { value: 0 },
): string {
	const resolvedIds = frontmatter.replace(PLACEHOLDER_PATTERN, (_match, suffix: string) => {
		const operonId = !suffix
			? generateUniqueLocalOperonId(options.generateOperonId, usedIds)
			: stableIds.get(suffix) ?? generateUniqueLocalOperonId(options.generateOperonId, usedIds);
		if (suffix && !stableIds.has(suffix)) stableIds.set(suffix, operonId);
		options.onIdentityAllocation?.({ occurrence: ordinal.value++, ...(suffix ? { suffix } : {}), operonId });
		return operonId;
	});

	if (context) return replaceTemplatePlaceholders(resolvedIds, context);
	return resolvedIds;
}

function replaceCheckboxLinePlaceholders(
	body: string,
	options: ResolveOperonIdPlaceholdersOptions,
	usedIds: Set<string>,
	stableIds: Map<string, string>,
	context?: OperonTemplatePlaceholderContext,
	resolveBodyText = false,
	ordinal: { value: number } = { value: 0 },
): string {
	const lines = body.split('\n');
	let inFencedCodeBlock = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';

		if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (inFencedCodeBlock) continue;

		let nextLine = line;
		if (isTaskLineCandidate(nextLine) && nextLine.includes('{{operonId')) {
				nextLine = nextLine.replace(PLACEHOLDER_PATTERN, (_match, suffix: string) => {
					const operonId = !suffix
						? generateUniqueLocalOperonId(options.generateOperonId, usedIds)
						: stableIds.get(suffix) ?? generateUniqueLocalOperonId(options.generateOperonId, usedIds);
					if (suffix && !stableIds.has(suffix)) stableIds.set(suffix, operonId);
					options.onIdentityAllocation?.({ occurrence: ordinal.value++, ...(suffix ? { suffix } : {}), operonId });
					return operonId;
				});
		}
		if (context && resolveBodyText && nextLine.includes('{{')) {
			nextLine = replaceTemplatePlaceholders(nextLine, context);
		} else if (!context && isTaskLineCandidate(nextLine) && nextLine.includes('{{')) {
			nextLine = replaceRawTaskLinePlaceholders(nextLine, options);
		}

		lines[index] = nextLine;
	}

	return lines.join('\n');
}

export function resolveOperonIdPlaceholdersInTaskBlock(
	content: string,
	options: ResolveOperonIdPlaceholdersOptions,
): string {
	if (!content.includes('{{operonId') && !hasRawTaskLinePlaceholder(content)) return content;
	return replaceCheckboxLinePlaceholders(content, options, new Set<string>(), new Map<string, string>());
}

export function resolveOperonIdPlaceholders(
	content: string,
	options: ResolveOperonIdPlaceholdersOptions,
): string {
	if (!content.includes('{{operonId') && !hasRawTaskLinePlaceholder(content)) return content;

	const { frontmatter, body } = splitFrontmatterDocument(content);
	const usedIds = new Set<string>();
	const stableIds = new Map<string, string>();
	const ordinal = { value: 0 };
	const nextFrontmatter = frontmatter == null
		? null
		: replaceYamlPlaceholders(frontmatter, options, usedIds, stableIds, undefined, ordinal);
	const nextBody = replaceCheckboxLinePlaceholders(body, options, usedIds, stableIds, undefined, false, ordinal);

	if (nextFrontmatter == null) return nextBody;
	return `---\n${nextFrontmatter}\n---\n${nextBody}`;
}

export function resolveOperonTemplatePlaceholders(
	content: string,
	options: ResolveOperonTemplatePlaceholdersOptions,
): string {
	if (!content.includes('{{operonId') && !hasTemplatePlaceholder(content)) return content;

	const { frontmatter, body } = splitFrontmatterDocument(content);
	const usedIds = new Set<string>();
	const stableIds = new Map<string, string>();
	const ordinal = { value: 0 };
	const nextFrontmatter = frontmatter == null
		? null
		: replaceYamlPlaceholders(frontmatter, options, usedIds, stableIds, options.context, ordinal);
	const nextBody = replaceCheckboxLinePlaceholders(
		body,
		options,
		usedIds,
		stableIds,
		options.context,
		options.resolveBodyText !== false,
		ordinal,
	);

	if (nextFrontmatter == null) return nextBody;
	return `---\n${nextFrontmatter}\n---\n${nextBody}`;
}
