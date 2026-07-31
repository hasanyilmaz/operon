import type {
	CreateFieldItemV1,
	CreateTaskTargetV1,
	FieldDescriptorV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	CONTRACT_LIMITS_V1,
	OPERON_ID_PATTERN_V1,
	TEMPORAL_CREATE_KEYS_V1,
	utf8ByteLengthV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	parseAbsoluteReminder,
	parseReminderRule,
} from '../../../src/core/reminder-rules';
import { parseRepeatRule, serializeRepeatRule } from '../../../src/core/repeat-rule';
import type {
	GuidedCreationIntentV1,
	GuidedCreationModelV1,
} from './guided-creation';
import {
	CREATE_FIELD_CAP,
	CREATE_LIST_ITEM_CAP,
	DESCRIPTION_BYTE_CAP,
	DESCRIPTION_CHARACTER_CAP,
	buildGuidedCreationBuiltInFieldV1,
	buildGuidedCreationCustomFieldV1,
	isGuidedCreationFieldV1,
	isSafeInteractiveText,
	parseGuidedCreationPropertyValueV1,
	TAG_PATTERN,
} from './guided-creation';
const TEMPORAL_CREATE_KEY_SET = new Set<string>(TEMPORAL_CREATE_KEYS_V1);
const SYNTAX_ERROR = 'COMPACT_SYNTAX_INVALID';
const VALUE_ERROR = 'INVALID_FIELD_VALUE';
export type CompactCreateRepresentationV1 = 'inline' | 'file';

export interface CompactCreateAssignmentV1 {
	key: string;
	value: string;
}

export interface CompactCreateAstV1 {
	description: string;
	representation: CompactCreateRepresentationV1 | null;
	assignments: CompactCreateAssignmentV1[];
}

export interface CompactCreateLegacyRouteV1 {
	route: 'legacy-guided';
	initialDescription?: string;
}

export type CompactCreateArgvRouteV1 =
	| { route: 'compact'; ast: CompactCreateAstV1 }
	| CompactCreateLegacyRouteV1;

export type CompactCreateErrorCodeV1 =
	| 'AMBIGUOUS_PRIORITY'
	| 'AMBIGUOUS_STATUS'
	| 'COMPACT_DESCRIPTION_QUOTE_REQUIRED'
	| 'COMPACT_DESCRIPTION_REQUIRED'
	| 'COMPACT_BATCH_BLANK_LINE'
	| 'COMPACT_BATCH_CAPABILITY_UNAVAILABLE'
	| 'COMPACT_BATCH_EMPTY'
	| 'COMPACT_BATCH_LINE_ENDING_INVALID'
	| 'COMPACT_BATCH_TOO_MANY_ITEMS'
	| 'COMPACT_SYNTAX_INVALID'
	| 'COMPACT_VALUE_QUOTE_REQUIRED'
	| 'CREATE_CAPABILITY_UNAVAILABLE'
	| 'DUPLICATE_KEY'
	| 'DUPLICATE_LIST_ELEMENT'
	| 'EMPTY_LIST_ELEMENT'
	| 'FIELD_NOT_WRITABLE'
	| 'INVALID_FIELD_VALUE'
	| 'INVALID_PARENT_TASK'
	| 'INVALID_PRIORITY'
	| 'INVALID_STATUS'
	| 'REQUIRED_ASSIGNEES_MISSING'
	| 'UNKNOWN_CANONICAL_KEY';

export type CompactCreateErrorV1 = Error & {
	code: CompactCreateErrorCodeV1;
	key?: string;
	capability?: 'create-capability-unavailable';
};

/** Parses shell-resolved positional tokens following `task create`. */
export function parseCompactCreateArgvV1(inputTokens: readonly string[]): CompactCreateArgvRouteV1 {
	const tokens = inputTokens;
	if (tokens.length === 0) return { route: 'legacy-guided' };
	if (tokens.length === 1) {
		return {
			route: 'legacy-guided',
			initialDescription: normalizeCompactValueV1(tokens[0]),
		};
	}

	let representation: CompactCreateRepresentationV1 | null = null;
	let descriptionIndex = 0;
	if (isRepresentation(tokens[0]) && !tokens[1].includes('::')) {
		representation = tokens[0];
		descriptionIndex = 1;
	}
	const description = normalizeDescription(tokens[descriptionIndex]);
	const assignmentTokens = tokens.slice(descriptionIndex + 1);
	if (representation === null && assignmentTokens.length === 0) {
		throw compactError(SYNTAX_ERROR);
	}
	return {
		route: 'compact',
		ast: buildAst(representation, description, assignmentTokens.map(parseCompactArgvAssignmentV1)),
	};
}

/**
 * Parses raw compact input. Straight ASCII double quotes are mandatory around
 * the description and every value because no shell has supplied quote context.
 */
export function parseCompactCreateInputV1(rawInput: string): CompactCreateAstV1 {
	const input = rawInput.trim();
	if (!input) {
		throw compactError('COMPACT_DESCRIPTION_REQUIRED');
	}
	const descriptionMatch = /^(?:(inline|file)\s+)?"((?:\\.|[^"\\])*)"/u.exec(input);
	if (!descriptionMatch) {
		throw compactError('COMPACT_DESCRIPTION_QUOTE_REQUIRED');
	}
	const representation = (descriptionMatch[1] as CompactCreateRepresentationV1 | undefined) ?? null;
	const description = decodeRawQuotedValue(descriptionMatch[2]);
	let cursor = descriptionMatch[0].length;
	const assignments: CompactCreateAssignmentV1[] = [];
	const assignmentPattern = /\s+((?:(?!::).)+?)::"((?:\\.|[^"\\])*)"/gy;
	while (cursor < input.length) {
		assignmentPattern.lastIndex = cursor;
		const assignment = assignmentPattern.exec(input);
		if (!assignment) {
			const key = /^\s+((?:(?!::).)+?)::/u.exec(input.slice(cursor))?.[1];
			throw compactError(key ? 'COMPACT_VALUE_QUOTE_REQUIRED' : SYNTAX_ERROR, key);
		}
		assignments.push({
			key: assignment[1],
			value: normalizeCompactValueV1(decodeRawQuotedValue(assignment[2])),
		});
		cursor = assignmentPattern.lastIndex;
	}
	return buildAst(representation, normalizeDescription(description), assignments);
}

/**
 * Parses one compact create record per line without hiding structural blanks.
 * One trailing line ending is allowed; every other line must contain a record.
 */
export function parseCompactCreateLinesInputV1(rawInput: string): CompactCreateAstV1[] {
	if (/(?:^|[^\r])\r(?!\n)/u.test(rawInput)) {
		throw compactError('COMPACT_BATCH_LINE_ENDING_INVALID');
	}
	const lines = rawInput.replace(/\r\n/gu, '\n').split('\n');
	if (lines.at(-1) === '') lines.pop();
	if (lines.length === 0) throw compactError('COMPACT_BATCH_EMPTY');
	if (lines.length > CONTRACT_LIMITS_V1.createItems) {
		throw compactError('COMPACT_BATCH_TOO_MANY_ITEMS');
	}
	if (lines.some(line => line.trim().length === 0)) {
		throw compactError('COMPACT_BATCH_BLANK_LINE');
	}
	return lines.map(line => parseCompactCreateInputV1(line));
}

export function parseCompactListV1(
	value: string,
	key?: string,
): { items: string[]; canonical: string } {
	const items: string[] = [];
	let current = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === '\\' && value[index + 1] === ';') {
			current += ';';
			index += 1;
			continue;
		}
		if (character === ';') {
			pushListItem(items, current, key);
			current = '';
			continue;
		}
		current += character;
	}
	pushListItem(items, current, key);
	if (items.length > CREATE_LIST_ITEM_CAP) {
		throw compactError(VALUE_ERROR, key);
	}
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item)) {
			throw compactError('DUPLICATE_LIST_ELEMENT', key);
		}
		seen.add(item);
	}
	return {
		items,
		canonical: items.map(item => item.replace(/;/gu, '\\;')).join('; '),
	};
}

export function compileCompactCreateIntentV1(options: {
	ast: CompactCreateAstV1;
	model: GuidedCreationModelV1;
	itemRef: string;
}): GuidedCreationIntentV1 {
	const { ast, model } = options;
	const fields: CreateFieldItemV1[] = [];
	let tags: string[] | undefined;
	let statusId: string | undefined;
	let priorityId: string | undefined;
	let parent: { kind: 'existing'; operonId: string } | undefined;
	let recurrenceRule: string | undefined;
	let recurrenceEndDatetime: string | undefined;

	for (const assignment of ast.assignments) {
		const { key, value } = assignment;
		if (TEMPORAL_CREATE_KEY_SET.has(key)) {
			requireTemporalCreateCapability(model, key);
			if (key === 'reminderDatetimes') {
				fields.push(compileAbsoluteReminders(value, key));
				continue;
			}
			if (key === 'reminderRules') {
				fields.push(compileReminderRules(value, key));
				continue;
			}
			if (key === 'repeat') {
				const parsed = parseRepeatRule(value);
				if (!parsed) throw compactError(VALUE_ERROR, key);
				recurrenceRule = serializeRepeatRule(parsed);
				continue;
			}
			const parsed = parseAbsoluteReminder(value);
			if (!parsed.ok) throw compactError(VALUE_ERROR, key);
			recurrenceEndDatetime = parsed.value.localDatetime;
			continue;
		}
		if (key === 'status') {
			statusId = resolveStatusId(model, value);
			continue;
		}
		if (key === 'priority') {
			priorityId = resolvePriorityId(model, value);
			continue;
		}
		if (key === 'parentTask') {
			if (!OPERON_ID_PATTERN_V1.test(value)) {
				throw compactError('INVALID_PARENT_TASK', key);
			}
			parent = { kind: 'existing', operonId: value };
			continue;
		}

		const descriptor = model.fields.find(field => field.canonicalKey === key);
		if (!descriptor) {
			throw compactError('UNKNOWN_CANONICAL_KEY', key);
		}
		if (!isGuidedCreationFieldV1(descriptor)) {
			throw compactError('FIELD_NOT_WRITABLE', key);
		}
		if (key === 'tags') {
			tags = parseListField(value, descriptor);
			for (const tag of tags) {
				if (!TAG_PATTERN.test(tag)) {
					throw compactError(VALUE_ERROR, key);
				}
			}
			continue;
		}
		fields.push(compileField(descriptor, value));
	}

	if (recurrenceEndDatetime && !recurrenceRule) {
		throw compactError(VALUE_ERROR, 'datetimeRepeatEnd');
	}
	if (recurrenceRule) {
		fields.push({
			kind: 'recurrence',
			rule: recurrenceRule,
			...(recurrenceEndDatetime ? { endDatetime: recurrenceEndDatetime } : {}),
		});
	}
	if (fields.length > CREATE_FIELD_CAP) {
		throw compactError(VALUE_ERROR);
	}
	if (
		model.policies.creation.assigneesRequired
		&& !fields.some(field => field.kind === 'list' && field.field === 'assignees')
	) {
		throw compactError('REQUIRED_ASSIGNEES_MISSING', 'assignees');
	}

	const target: CreateTaskTargetV1 = ast.representation === null
		? { mode: 'configured-default' }
		: { representation: ast.representation, mode: 'configured-default' };
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'Compact create.',
		spec: {
			operation: 'create',
			items: [{
				itemRef: options.itemRef,
				description: ast.description,
				target,
				fields,
				...(tags ? { tags } : {}),
				...(statusId ? { statusId } : {}),
				...(priorityId ? { priorityId } : {}),
				...(parent ? { parent } : {}),
			}],
		},
	};
}

export function compileCompactCreateBatchIntentV1(options: {
	asts: readonly CompactCreateAstV1[];
	model: GuidedCreationModelV1;
	itemRefs: readonly string[];
}): GuidedCreationIntentV1 {
	const { asts, itemRefs, model } = options;
	if (asts.length === 0) throw compactError('COMPACT_BATCH_EMPTY');
	if (asts.length > CONTRACT_LIMITS_V1.createItems) {
		throw compactError('COMPACT_BATCH_TOO_MANY_ITEMS');
	}
	if (itemRefs.length !== asts.length || new Set(itemRefs).size !== itemRefs.length) {
		throw compactError(SYNTAX_ERROR);
	}
	requireCompactBatchCapability(model);
	const items = asts.map((ast, index) => (
		compileCompactCreateIntentV1({
			ast,
			model,
			itemRef: itemRefs[index],
		}).spec.items[0]
	));
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'Compact multi-create.',
		spec: {
			operation: 'create',
			items,
		},
	};
}

function requireCompactBatchCapability(model: GuidedCreationModelV1): void {
	const creation = model.policies.creation;
	if (
		creation.compactBatchVersion !== 1
		|| creation.compactBatchInputFormat !== 'compact-lines'
		|| creation.compactBatchMaxItems !== CONTRACT_LIMITS_V1.createItems
	) {
		throw compactError(
			'COMPACT_BATCH_CAPABILITY_UNAVAILABLE',
			undefined,
			'create-capability-unavailable',
		);
	}
}

function requireTemporalCreateCapability(model: GuidedCreationModelV1, key: string): void {
	const creation = model.policies.creation;
	if (
		creation.temporalCreateVersion !== 1
		|| !Array.isArray(creation.temporalCreateKeys)
		|| creation.temporalCreateKeys.length !== TEMPORAL_CREATE_KEYS_V1.length
		|| creation.temporalCreateKeys.some((candidate, index) => (
			candidate !== TEMPORAL_CREATE_KEYS_V1[index]
		))
	) {
		throw compactError(
			'CREATE_CAPABILITY_UNAVAILABLE',
			key,
			'create-capability-unavailable',
		);
	}
}

function compileAbsoluteReminders(value: string, key: string): CreateFieldItemV1 {
	const parsedList = parseCompactListV1(value, key);
	const values: string[] = [];
	const seen = new Set<string>();
	for (const raw of parsedList.items) {
		const parsed = parseAbsoluteReminder(raw);
		if (!parsed.ok) throw compactError(VALUE_ERROR, key);
		if (seen.has(parsed.value.localDatetime)) {
			throw compactError('DUPLICATE_LIST_ELEMENT', key);
		}
		seen.add(parsed.value.localDatetime);
		values.push(parsed.value.localDatetime);
	}
	return { kind: 'reminder-datetimes', values };
}

function compileReminderRules(value: string, key: string): CreateFieldItemV1 {
	const parsedList = parseCompactListV1(value, key);
	const values: string[] = [];
	const seen = new Set<string>();
	for (const raw of parsedList.items) {
		const parsed = parseReminderRule(raw);
		if (!parsed.ok) throw compactError(VALUE_ERROR, key);
		if (seen.has(parsed.value.canonical)) {
			throw compactError('DUPLICATE_LIST_ELEMENT', key);
		}
		seen.add(parsed.value.canonical);
		values.push(parsed.value.canonical);
	}
	return { kind: 'reminder-rules', values };
}

function isRepresentation(value: string): value is CompactCreateRepresentationV1 {
	return value === 'inline' || value === 'file';
}

export function parseCompactArgvAssignmentV1(token: string): CompactCreateAssignmentV1 {
	const delimiter = token.indexOf('::');
	if (delimiter <= 0) {
		throw compactError(SYNTAX_ERROR);
	}
	return {
		key: token.slice(0, delimiter),
		value: normalizeCompactValueV1(token.slice(delimiter + 2)),
	};
}

function buildAst(
	representation: CompactCreateRepresentationV1 | null,
	description: string,
	assignments: CompactCreateAssignmentV1[],
): CompactCreateAstV1 {
	const seen = new Set<string>();
	for (const assignment of assignments) {
		if (!assignment.key || assignment.key !== assignment.key.trim()) {
			throw compactError(SYNTAX_ERROR);
		}
		if (seen.has(assignment.key)) {
			throw compactError('DUPLICATE_KEY', assignment.key);
		}
		seen.add(assignment.key);
	}
	return {
		description,
		representation,
		assignments,
	};
}

function normalizeDescription(value: string): string {
	const description = normalizeCompactValueV1(value);
	if (!description) {
		throw compactError('COMPACT_DESCRIPTION_REQUIRED');
	}
	if (
		[...description].length > DESCRIPTION_CHARACTER_CAP
		|| utf8ByteLengthV1(description) > DESCRIPTION_BYTE_CAP
		|| !isSafeInteractiveText(description)
	) {
		throw compactError(VALUE_ERROR);
	}
	return description;
}

export function normalizeCompactValueV1(value: string): string {
	return value.trim().normalize('NFC');
}

function decodeRawQuotedValue(value: string): string {
	return value.replace(/\\(["\\])/gu, '$1');
}

function pushListItem(items: string[], raw: string, key?: string): void {
	const item = normalizeCompactValueV1(raw);
	if (!item) {
		throw compactError('EMPTY_LIST_ELEMENT', key);
	}
	if (!isSafeInteractiveText(item) || utf8ByteLengthV1(item) > CONTRACT_LIMITS_V1.generalStringBytes) {
		throw compactError(VALUE_ERROR, key);
	}
	items.push(item);
}

function compileField(descriptor: FieldDescriptorV1, value: string): CreateFieldItemV1 {
	const parsed = parseCompactFieldValueV1(descriptor, value);
	if (descriptor.source === 'custom') {
		return buildGuidedCreationCustomFieldV1(descriptor, parsed);
	}
	const field = buildGuidedCreationBuiltInFieldV1(descriptor, parsed);
	if (!field) throw compactError('FIELD_NOT_WRITABLE', descriptor.canonicalKey);
	return field;
}

export function parseCompactFieldValueV1(
	descriptor: FieldDescriptorV1,
	value: string,
): string | number | boolean | string[] {
	if (!value) throw invalidValue(descriptor);
	if (descriptor.valueType === 'list') return parseListField(value, descriptor);
	if (descriptor.valueType === 'checkbox') {
		if (value === 'true') return true;
		if (value === 'false') return false;
		throw invalidValue(descriptor);
	}
	const parsed = parseGuidedCreationPropertyValueV1(descriptor.valueType, value);
	if (parsed === undefined) throw invalidValue(descriptor);
	return parsed;
}

function parseListField(value: string, descriptor: FieldDescriptorV1): string[] {
	if (descriptor.valueType !== 'list') throw invalidValue(descriptor);
	return parseCompactListV1(value, descriptor.canonicalKey).items;
}

function resolveStatusId(model: GuidedCreationModelV1, value: string): string {
	let id: string | undefined;
	for (const pipeline of model.pipelines) {
		if (pipeline.identityStatus !== 'resolved') continue;
		for (const status of pipeline.statuses) {
			if (
				status.identityStatus !== 'resolved'
				|| `${pipeline.name}.${status.label}`.normalize('NFC') !== value
			) continue;
			if (id) throw compactError('AMBIGUOUS_STATUS', 'status');
			id = status.id;
		}
	}
	if (!id) throw compactError('INVALID_STATUS', 'status');
	return id;
}

function resolvePriorityId(model: GuidedCreationModelV1, value: string): string {
	let id: string | undefined;
	for (const priority of model.priorities) {
		if (
			priority.identityStatus !== 'resolved'
			|| priority.label.normalize('NFC') !== value
		) continue;
		if (id) throw compactError('AMBIGUOUS_PRIORITY', 'priority');
		id = priority.id;
	}
	if (!id) throw compactError('INVALID_PRIORITY', 'priority');
	return id;
}

function invalidValue(descriptor: Pick<FieldDescriptorV1, 'canonicalKey' | 'valueType'>): CompactCreateErrorV1 {
	return compactError(VALUE_ERROR, descriptor.canonicalKey);
}

function compactError(
	code: CompactCreateErrorCodeV1,
	key?: string,
	capability?: 'create-capability-unavailable',
): CompactCreateErrorV1 {
	return Object.assign(new Error(code), { code, key, capability });
}
