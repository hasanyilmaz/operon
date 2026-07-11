import { CANONICAL_KEY_ORDER } from '../types/keys';
import { isRetiredKeyMapping, KeyMapping } from '../types/settings';
import { buildForwardMapping, buildReverseMapping } from './yaml-fields';
import { ResolvedFileTaskDefaults } from './file-task-defaults';
import { formatTaskColorYamlValue, normalizeTaskColorValue } from './task-color-value';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';

export type FileTaskBodyStrategy = 'preserve-source' | 'use-template';
type SectionKind = 'managed' | 'title' | 'tags' | 'unknown';
type KeyChoiceSource = 'source' | 'template' | 'settings';

interface RawSection {
	yamlKey: string;
	lines: string[];
	raw: string;
}

export interface OrderedFrontmatterKeyChoice {
	canonicalKey: string;
	yamlKey: string;
	source: KeyChoiceSource;
}

export interface ParsedFrontmatterSection {
	yamlKey: string;
	kind: SectionKind;
	raw: string;
	canonicalKey: string | null;
}

export interface ParsedFrontmatterDocument {
	hasFrontmatter: boolean;
	body: string;
	sections: ParsedFrontmatterSection[];
	managedFieldValues: Record<string, string>;
	managedFieldPresence: Set<string>;
	keyChoices: Map<string, OrderedFrontmatterKeyChoice>;
	tags: string[];
	tagsPresent: boolean;
}

export interface FileTaskSourceInput {
	description: string;
	fieldValues: Record<string, string>;
	fieldPresence?: Set<string>;
	explicitEmptyFieldKeys?: Set<string>;
	tags?: string[];
	tagsPresent?: boolean;
	frontmatterDocument?: ParsedFrontmatterDocument | null;
}

export interface BuildMergedFileTaskDraftOptions {
	source: FileTaskSourceInput;
	template?: ParsedFrontmatterDocument | null;
	defaults: ResolvedFileTaskDefaults;
	keyMappings: KeyMapping[];
	bodyStrategy: FileTaskBodyStrategy;
	preserveSourceKeyChoices?: boolean;
}

export interface MergedFileTaskDraft {
	operonId: string;
	description: string;
	body: string;
	content: string;
	fieldValues: Record<string, string>;
	fieldPresence: Set<string>;
	tags: string[];
	tagsPresent: boolean;
	keyChoices: Map<string, OrderedFrontmatterKeyChoice>;
	orderedYamlKeys: string[];
}

const REQUIRED_DEFAULT_KEYS = new Set(['operonId', 'status', 'priority']);

export function splitFrontmatterDocument(content: string): { frontmatter: string | null; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
	if (!match) {
		return {
			frontmatter: null,
			body: content,
		};
	}

	return {
		frontmatter: match[1],
		body: content.slice(match[0].length),
	};
}

function isTopLevelYamlKey(line: string): boolean {
	if (!line || /^\s/.test(line)) return false;
	const colonIndex = line.indexOf(':');
	if (colonIndex <= 0) return false;
	return !line.startsWith('- ');
}

function parseSections(frontmatter: string): RawSection[] {
	const lines = frontmatter.split(/\r?\n/);
	const sections: RawSection[] = [];
	let current: RawSection | null = null;

	for (const line of lines) {
		if (isTopLevelYamlKey(line)) {
			if (current) sections.push(current);
			const yamlKey = line.slice(0, line.indexOf(':')).trim();
			current = {
				yamlKey,
				lines: [line],
				raw: line,
			};
			continue;
		}

		if (current) {
			current.lines.push(line);
			current.raw = current.lines.join('\n');
		}
	}

	if (current) sections.push(current);
	return sections;
}

function unquote(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
		const inner = value.slice(1, -1);
		if (value.startsWith('"')) {
			return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
		}
		return inner.replace(/\\'/g, '\'').replace(/\\\\/g, '\\');
	}
	return value;
}

function parseInlineList(value: string): string[] {
	const inner = value.trim().slice(1, -1).trim();
	if (!inner) return [];

	const items: string[] = [];
	let current = '';
	let quote: '"' | '\'' | null = null;
	let escaping = false;

	for (const char of inner) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === '\\') {
			current += char;
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			current += char;
			continue;
		}
		if (char === '"' || char === '\'') {
			quote = char;
			current += char;
			continue;
		}
		if (char === ',') {
			items.push(unquote(current.trim()));
			current = '';
			continue;
		}
		current += char;
	}

	if (current.trim()) items.push(unquote(current.trim()));
	return items;
}

function parseScalarValue(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (!trimmed || trimmed === 'null' || trimmed === '~') return '';
	return unquote(trimmed);
}

function parseListSection(section: RawSection): string[] {
	const headerLine = section.lines[0] ?? '';
	const valuePart = headerLine.slice(headerLine.indexOf(':') + 1).trim();
	if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
		return parseInlineList(valuePart);
	}

	const items: string[] = [];
	for (const line of section.lines.slice(1)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('- ')) continue;
		items.push(parseScalarValue(trimmed.slice(2)));
	}
	return items;
}

function renderScalar(value: string, forceQuoted = false): string {
	if (!value) return '""';
	const safePlain = /^[A-Za-z0-9_./@:+()-]+(?: [A-Za-z0-9_./@:+()-]+)*$/;
	if (!forceQuoted && safePlain.test(value)) {
		return value;
	}
	if (!value.includes('\'') && (value.includes('"') || value.includes('<%') || value.includes('%>'))) {
		return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\'\'')}'`;
	}
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderListSection(yamlKey: string, values: string[]): string {
	if (values.length === 0) return `${yamlKey}:`;
	return [
		`${yamlKey}:`,
		...values.map(value => `  - ${renderScalar(value)}`),
	].join('\n');
}

function renderManagedSection(
	yamlKey: string,
	canonicalKey: string,
	value: string,
	keyMappings: KeyMapping[],
): string {
	const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
	if (fieldType === 'list') {
		if (!value) return `${yamlKey}:`;
		const items = value.split(';').map(item => item.trim()).filter(Boolean);
		return renderListSection(yamlKey, items);
	}

	if (!value) return `${yamlKey}:`;
	if (fieldType === 'number' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		return `${yamlKey}: ${value.trim()}`;
	}
	if (canonicalKey === 'taskColor') {
		return `${yamlKey}: ${renderScalar(formatTaskColorYamlValue(value))}`;
	}

	return `${yamlKey}: ${renderScalar(value)}`;
}

function renderTagsSection(tags: string[]): string {
	return renderListSection('tags', tags);
}

function buildOrderedFieldPresence(values: Record<string, string>, provided?: Set<string>): Set<string> {
	if (provided) return new Set(provided);
	return new Set(Object.keys(values));
}

function parseSection(
	section: RawSection,
	reverseMap: Map<string, string>,
	keyMappings: KeyMapping[],
): {
	parsed: ParsedFrontmatterSection;
	value?: string | string[];
} {
	if (section.yamlKey === 'title') {
		const headerLine = section.lines[0] ?? '';
		const valuePart = headerLine.slice(headerLine.indexOf(':') + 1);
		return {
			parsed: {
				yamlKey: section.yamlKey,
				kind: 'title',
				raw: section.raw,
				canonicalKey: null,
			},
			value: parseScalarValue(valuePart),
		};
	}

	if (section.yamlKey === 'tags') {
		return {
			parsed: {
				yamlKey: section.yamlKey,
				kind: 'tags',
				raw: section.raw,
				canonicalKey: null,
			},
			value: parseListSection(section),
		};
	}

	const mappedKey = reverseMap.get(section.yamlKey);
	const canonicalKey = mappedKey
		? (isRetiredKeyMapping(mappedKey) ? null : mappedKey)
		: isManagedTaskFieldCanonicalKey(section.yamlKey, keyMappings)
			? section.yamlKey
			: null;
	if (!canonicalKey) {
		return {
			parsed: {
				yamlKey: section.yamlKey,
				kind: 'unknown',
				raw: section.raw,
				canonicalKey: null,
			},
		};
	}

	const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
	const headerLine = section.lines[0] ?? '';
	const valuePart = headerLine.slice(headerLine.indexOf(':') + 1);
	const value = fieldType === 'list'
		? parseListSection(section).join('; ')
		: canonicalKey === 'taskColor'
			? normalizeTaskColorValue(parseScalarValue(valuePart))
			: parseScalarValue(valuePart);

	return {
		parsed: {
			yamlKey: section.yamlKey,
			kind: 'managed',
			raw: section.raw,
			canonicalKey,
		},
		value,
	};
}

export function parseFrontmatterDocument(content: string, keyMappings: KeyMapping[]): ParsedFrontmatterDocument {
	const { frontmatter, body } = splitFrontmatterDocument(content);
	if (frontmatter === null) {
		return {
			hasFrontmatter: false,
			body,
			sections: [],
			managedFieldValues: {},
			managedFieldPresence: new Set<string>(),
			keyChoices: new Map<string, OrderedFrontmatterKeyChoice>(),
			tags: [],
			tagsPresent: false,
		};
	}

	const reverseMap = buildReverseMapping(keyMappings);
	const rawSections = parseSections(frontmatter);
	const sections: ParsedFrontmatterSection[] = [];
	const managedFieldValues: Record<string, string> = {};
	const managedFieldPresence = new Set<string>();
	const keyChoices = new Map<string, OrderedFrontmatterKeyChoice>();
	let tags: string[] = [];
	let tagsPresent = false;

	for (const rawSection of rawSections) {
		const { parsed, value } = parseSection(rawSection, reverseMap, keyMappings);
		sections.push(parsed);
		if (parsed.kind === 'title') {
			continue;
		}
		if (parsed.kind === 'tags') {
			tags = Array.isArray(value) ? value : [];
			tagsPresent = true;
			continue;
		}
		if (parsed.kind !== 'managed' || !parsed.canonicalKey) continue;

		managedFieldValues[parsed.canonicalKey] = typeof value === 'string' ? value : '';
		managedFieldPresence.add(parsed.canonicalKey);
		keyChoices.set(parsed.canonicalKey, {
			canonicalKey: parsed.canonicalKey,
			yamlKey: parsed.yamlKey,
			source: 'source',
		});
	}

	return {
		hasFrontmatter: true,
		body,
		sections,
		managedFieldValues,
		managedFieldPresence,
		keyChoices,
		tags,
		tagsPresent,
	};
}

export function applyRawYamlValueRemovals(
	document: ParsedFrontmatterDocument,
	rawYamlKeys: Iterable<string>,
	protectedRawYamlKeys: Iterable<string> = [],
): ParsedFrontmatterDocument {
	const removalKeys = new Set(
		[...rawYamlKeys]
			.map(value => value.trim())
			.filter(Boolean),
	);
	if (!removalKeys.size) {
		return {
			...document,
			sections: document.sections.map(section => ({ ...section })),
			managedFieldValues: { ...document.managedFieldValues },
			managedFieldPresence: new Set(document.managedFieldPresence),
			keyChoices: new Map([...document.keyChoices.entries()].map(([key, value]) => [key, { ...value }])),
			tags: [...document.tags],
		};
	}
	const protectedKeys = new Set(
		[...protectedRawYamlKeys]
			.map(value => value.trim())
			.filter(Boolean),
	);
	const nextManagedFieldValues = { ...document.managedFieldValues };
	const nextManagedFieldPresence = new Set(document.managedFieldPresence);
	const nextSections = document.sections.map(section => {
		const cloned = { ...section };
		if (!removalKeys.has(cloned.yamlKey) || protectedKeys.has(cloned.yamlKey)) {
			return cloned;
		}
		cloned.raw = `${cloned.yamlKey}:`;
		if (cloned.kind === 'managed' && cloned.canonicalKey) {
			nextManagedFieldValues[cloned.canonicalKey] = '';
			nextManagedFieldPresence.add(cloned.canonicalKey);
		}
		return cloned;
	});
	const nextTags = removalKeys.has('tags') && !protectedKeys.has('tags') ? [] : [...document.tags];
	const nextTagsPresent = (removalKeys.has('tags') && !protectedKeys.has('tags'))
		? true
		: document.tagsPresent;
	return {
		...document,
		sections: nextSections,
		managedFieldValues: nextManagedFieldValues,
		managedFieldPresence: nextManagedFieldPresence,
		keyChoices: new Map([...document.keyChoices.entries()].map(([key, value]) => [key, { ...value }])),
		tags: nextTags,
		tagsPresent: nextTagsPresent,
	};
}

function buildMergedManagedFields(
	sourceValues: Record<string, string>,
	sourcePresence: Set<string>,
	templateValues: Record<string, string>,
	templatePresence: Set<string>,
	defaults: ResolvedFileTaskDefaults,
	keyMappings: KeyMapping[],
	explicitEmptySourceKeys: Set<string> = new Set(),
): { values: Record<string, string>; presence: Set<string> } {
	const values: Record<string, string> = {};
	const presence = new Set<string>();
	const candidateKeys = new Set<string>([
		...Object.keys(sourceValues),
		...sourcePresence,
		...Object.keys(templateValues),
		...templatePresence,
		'operonId',
		'datetimeModified',
	]);

	if (sourcePresence.has('datetimeCreated') || templatePresence.has('datetimeCreated') || defaults.datetimeCreated) {
		candidateKeys.add('datetimeCreated');
	}

	if (sourcePresence.has('status') || templatePresence.has('status') || defaults.status) {
		candidateKeys.add('status');
	}
	if (sourcePresence.has('priority') || templatePresence.has('priority') || defaults.priority !== undefined) {
		candidateKeys.add('priority');
	}

	for (const key of candidateKeys) {
		if (!isManagedTaskFieldCanonicalKey(key, keyMappings)) continue;
		const sourceHasValue = sourcePresence.has(key);
		const templateHasValue = templatePresence.has(key);
		const sourceValue = sourceValues[key] ?? '';
		const templateValue = templateValues[key] ?? '';

		if (key === 'datetimeModified') {
			values[key] = defaults.datetimeModified;
			presence.add(key);
			continue;
		}

		if (key === 'operonId') {
			values[key] = defaults.operonId;
			presence.add(key);
			continue;
		}

		if (key === 'datetimeCreated') {
			if (sourceHasValue) {
				values[key] = sourceValue;
				presence.add(key);
				continue;
			}
			if (templateHasValue) {
				values[key] = templateValue;
				presence.add(key);
				continue;
			}
			if (!defaults.datetimeCreated) continue;
			values[key] = defaults.datetimeCreated;
			presence.add(key);
			continue;
		}

		if (REQUIRED_DEFAULT_KEYS.has(key)) {
			if (sourceHasValue && explicitEmptySourceKeys.has(key) && !sourceValue.trim()) {
				values[key] = '';
				presence.add(key);
				continue;
			}
			if (sourceHasValue && sourceValue.trim()) {
				values[key] = sourceValue;
				presence.add(key);
				continue;
			}
			if (key === 'status' && defaults.status) {
				values[key] = defaults.status;
				presence.add(key);
				continue;
			}
			if (key === 'priority' && defaults.priority !== undefined) {
				values[key] = defaults.priority;
				presence.add(key);
				continue;
			}
			if (templateHasValue) {
				values[key] = templateValue;
				presence.add(key);
			}
			continue;
		}

		if (sourceHasValue) {
			values[key] = sourceValue;
			presence.add(key);
			continue;
		}
		if (templateHasValue) {
			values[key] = templateValue;
			presence.add(key);
		}
	}

	return { values, presence };
}

function resolveChosenYamlKey(
	canonicalKey: string,
	sourceDocument: ParsedFrontmatterDocument | null | undefined,
	_template: ParsedFrontmatterDocument | null | undefined,
	forwardMap: Map<string, string>,
	preserveSourceKeyChoices: boolean,
): OrderedFrontmatterKeyChoice {
	if (preserveSourceKeyChoices) {
		const sourceChoice = sourceDocument?.keyChoices.get(canonicalKey);
		if (sourceChoice) return { ...sourceChoice };
	}
	return {
		canonicalKey,
		yamlKey: forwardMap.get(canonicalKey) ?? canonicalKey,
		source: 'settings',
	};
}

function buildChosenKeyMap(
	presence: Set<string>,
	sourceDocument: ParsedFrontmatterDocument | null | undefined,
	template: ParsedFrontmatterDocument | null | undefined,
	keyMappings: KeyMapping[],
	preserveSourceKeyChoices: boolean,
): Map<string, OrderedFrontmatterKeyChoice> {
	const forwardMap = buildForwardMapping(keyMappings);
	const chosen = new Map<string, OrderedFrontmatterKeyChoice>();
	for (const key of presence) {
		chosen.set(key, resolveChosenYamlKey(key, sourceDocument, template, forwardMap, preserveSourceKeyChoices));
	}
	return chosen;
}

function resolveTags(
	source: FileTaskSourceInput,
	template: ParsedFrontmatterDocument | null | undefined,
): { tags: string[]; tagsPresent: boolean } {
	const sourceTags = [...(source.tags ?? [])];
	const sourceTagsPresent = source.tagsPresent === true || sourceTags.length > 0;
	if (sourceTagsPresent) {
		return {
			tags: sourceTags,
			tagsPresent: true,
		};
	}

	if (template?.tagsPresent) {
		return {
			tags: [...template.tags],
			tagsPresent: true,
		};
	}

	return {
		tags: [],
		tagsPresent: false,
	};
}

function deterministicAppendOrder(presence: Set<string>): string[] {
	const ordered = ['operonId'];
	const seen = new Set<string>(ordered);
	for (const def of CANONICAL_KEY_ORDER) {
		if (def.name === 'operonId') continue;
		if (presence.has(def.name)) {
			ordered.push(def.name);
			seen.add(def.name);
		}
	}
	for (const key of presence) {
		if (seen.has(key)) continue;
		ordered.push(key);
	}
	return ordered;
}

export function buildMergedFileTaskDraft(options: BuildMergedFileTaskDraftOptions): MergedFileTaskDraft {
	const source = options.source;
	const template = options.template ?? null;
	const sourceDocument = source.frontmatterDocument ?? null;
	const sourcePresence = buildOrderedFieldPresence(source.fieldValues, source.fieldPresence);
	const templateValues = template?.managedFieldValues ?? {};
	const templatePresence = template?.managedFieldPresence ?? new Set<string>();
	const mergedFields = buildMergedManagedFields(
		source.fieldValues,
		sourcePresence,
		templateValues,
		templatePresence,
		options.defaults,
		options.keyMappings,
		source.explicitEmptyFieldKeys,
	);
	const chosenKeyMap = buildChosenKeyMap(
		mergedFields.presence,
		sourceDocument,
		template,
		options.keyMappings,
		options.preserveSourceKeyChoices === true,
	);
	const { tags, tagsPresent } = resolveTags(source, template);
	const description = source.description;
	const body = options.bodyStrategy === 'preserve-source'
		? sourceDocument?.body ?? ''
		: template?.body ?? '';

	const managedYamlKeys = new Set<string>();
	for (const choice of chosenKeyMap.values()) {
		managedYamlKeys.add(choice.yamlKey);
	}
	if (tagsPresent) managedYamlKeys.add('tags');

	const sections: string[] = [];
	const orderedYamlKeys: string[] = [];
	const emitted = new Set<string>();

	const emit = (yamlKey: string, raw: string): void => {
		if (emitted.has(yamlKey)) return;
		emitted.add(yamlKey);
		orderedYamlKeys.push(yamlKey);
		sections.push(raw);
	};

	const emitDocumentSections = (document: ParsedFrontmatterDocument | null, preserveTitle: boolean): void => {
		if (!document) return;
		for (const section of document.sections) {
			if (section.kind === 'unknown') {
				if (!managedYamlKeys.has(section.yamlKey)) {
					emit(section.yamlKey, section.raw);
				}
				continue;
			}
			if (section.kind === 'title') {
				const isDynamicTemplateTitle = !preserveTitle && /\{\{title\}\}/.test(section.raw);
				if ((preserveTitle || isDynamicTemplateTitle) && !managedYamlKeys.has(section.yamlKey)) {
					emit(section.yamlKey, section.raw);
				}
				continue;
			}
			if (section.kind === 'tags') {
				if (tagsPresent) emit('tags', renderTagsSection(tags));
				continue;
			}
			if (!section.canonicalKey) continue;
			const choice = chosenKeyMap.get(section.canonicalKey);
			if (!choice) continue;
			if (!mergedFields.presence.has(section.canonicalKey)) continue;
			if (choice.yamlKey !== section.yamlKey) continue;
			const mergedValue = mergedFields.values[section.canonicalKey] ?? '';
			const originalValue = document.managedFieldValues[section.canonicalKey] ?? '';
			if (mergedValue === originalValue) {
				emit(choice.yamlKey, section.raw);
				continue;
			}
			emit(choice.yamlKey, renderManagedSection(choice.yamlKey, section.canonicalKey, mergedValue, options.keyMappings));
		}
	};

	emitDocumentSections(sourceDocument, true);
	emitDocumentSections(template, false);

	const operonIdChoice = chosenKeyMap.get('operonId');
	if (operonIdChoice) {
		emit(
			operonIdChoice.yamlKey,
			renderManagedSection(operonIdChoice.yamlKey, 'operonId', mergedFields.values['operonId'] ?? '', options.keyMappings),
		);
	}

	for (const canonicalKey of deterministicAppendOrder(mergedFields.presence)) {
		if (canonicalKey === 'operonId') continue;
		const choice = chosenKeyMap.get(canonicalKey);
		if (!choice) continue;
		emit(
			choice.yamlKey,
			renderManagedSection(choice.yamlKey, canonicalKey, mergedFields.values[canonicalKey] ?? '', options.keyMappings),
		);
	}

	if (tagsPresent) {
		emit('tags', renderTagsSection(tags));
	}

	const frontmatter = sections.join('\n');
	const content = `---\n${frontmatter}\n---\n${body}`;

	return {
		operonId: mergedFields.values['operonId'] ?? options.defaults.operonId,
		description,
		body,
		content,
		fieldValues: mergedFields.values,
		fieldPresence: mergedFields.presence,
		tags,
		tagsPresent,
		keyChoices: chosenKeyMap,
		orderedYamlKeys,
	};
}
