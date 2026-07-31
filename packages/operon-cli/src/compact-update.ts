import type {
	FieldDescriptorV1,
	GeneralUpdateItemV1,
	OperonCatalogV1,
	RecurrenceUpdateItemV1,
	RecurrenceUpdateScopeV1,
	TaskContextV1,
	UpdateTaskRecurrenceSpecV1,
	WritableFieldValueV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	COMPACT_UPDATE_BATCH_FEATURES_V1,
	OPERON_ID_PATTERN_V1,
	isGeneralUpdateFieldV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	normalizeCompactValueV1,
	parseCompactArgvAssignmentV1,
	parseCompactFieldValueV1,
	parseCompactListV1,
	type CompactCreateAssignmentV1,
} from './compact-create';
import type { GuidedMutationIntentV1 } from './guided-maintenance';

const RELATIONSHIP_FIELDS = new Set(['parentTask', 'blocking', 'blockedBy']);
export const COMPACT_RECURRENCE_KEYS_V1 = Object.freeze([
	'repeat',
	'datetimeRepeatEnd',
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
] as const);
const RECURRENCE_FIELDS = new Set<string>(COMPACT_RECURRENCE_KEYS_V1);
const RECURRING_TEMPORAL_FIELDS = new Set([
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

export interface CompactUpdateAstV1 {
	assignments: CompactCreateAssignmentV1[];
	clearKeys: string[];
}

export interface CompactUpdateBatchItemAstV1 {
	operonId: string;
	update: CompactUpdateAstV1;
}

export const COMPACT_UPDATE_BATCH_MAX_ITEMS_V1 = 64;

export type CompactUpdateErrorCodeV1 =
	| 'AMBIGUOUS_PRIORITY'
	| 'COMPACT_SYNTAX_INVALID'
	| 'COMPACT_UPDATE_BATCH_BLANK_LINE'
	| 'COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE'
	| 'COMPACT_UPDATE_BATCH_DUPLICATE_ID'
	| 'COMPACT_UPDATE_BATCH_EMPTY'
	| 'COMPACT_UPDATE_BATCH_LINE_ENDING_INVALID'
	| 'COMPACT_UPDATE_BATCH_SELECTOR_REQUIRED'
	| 'COMPACT_UPDATE_BATCH_TOO_FEW_ITEMS'
	| 'COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS'
	| 'DESCRIPTION_CLEAR_UNAVAILABLE'
	| 'DUPLICATE_CLEAR'
	| 'DUPLICATE_KEY'
	| 'FIELD_NOT_WRITABLE'
	| 'FIELD_OWNED_BY_OTHER_COMMAND'
	| 'INVALID_OPERON_ID'
	| 'INVALID_PRIORITY'
	| 'RELATIONSHIP_GENERAL_UPDATE_CONFLICT'
	| 'RELATIONSHIP_INVERSE_CONFLICT'
	| 'RELATIONSHIP_SELF_REFERENCE'
	| 'RELATIONSHIP_TARGET_INVALID'
	| 'RECURRENCE_GENERAL_UPDATE_CONFLICT'
	| 'RECURRENCE_SCOPE_INVALID'
	| 'RECURRING_TEMPORAL_REQUIRES_SCOPE'
	| 'SET_CLEAR_CONFLICT'
	| 'UPDATE_CHANGES_REQUIRED'
	| 'WRITABLE_FIELDS_INCOMPLETE';

export type CompactUpdateErrorV1 = Error & {
	code: CompactUpdateErrorCodeV1;
	field?: string;
};

type HydratedTaskV1 = TaskContextV1 & {
	writableFields?: WritableFieldValueV1[];
};

type CompactUpdateCatalogV1 = Pick<
	Extract<OperonCatalogV1, { ok: true }>,
	'taxonomy' | 'fields'
> & {
	policies?: Extract<OperonCatalogV1, { ok: true }>['policies'];
};

export type CompactUpdateRouteV1 = 'general-update' | 'relationship-update' | 'recurrence-update';

interface CompactRelationshipChangeV1 {
	field: 'parentTask' | 'blocking' | 'blockedBy';
	targetOperonIds: string[];
}

export function compactUpdateRouteV1(
	ast: CompactUpdateAstV1,
	scope?: string,
): CompactUpdateRouteV1 {
	const keys = [
		...ast.assignments.map(assignment => assignment.key),
		...ast.clearKeys,
	];
	const relationshipCount = keys.filter(key => RELATIONSHIP_FIELDS.has(key)).length;
	if (relationshipCount > 0 && relationshipCount !== keys.length) {
		throw compactUpdateError('RELATIONSHIP_GENERAL_UPDATE_CONFLICT');
	}
	if (relationshipCount > 0) {
		if (scope !== undefined) throw compactUpdateError('RECURRENCE_GENERAL_UPDATE_CONFLICT');
		return 'relationship-update';
	}
	const recurrenceCount = keys.filter(key => RECURRENCE_FIELDS.has(key)).length;
	const explicitRecurrenceRoute = scope !== undefined
		|| keys.includes('repeat')
		|| keys.includes('datetimeRepeatEnd');
	if (explicitRecurrenceRoute && recurrenceCount !== keys.length) {
		throw compactUpdateError('RECURRENCE_GENERAL_UPDATE_CONFLICT');
	}
	return explicitRecurrenceRoute ? 'recurrence-update' : 'general-update';
}

export function parseCompactUpdateArgvV1(
	assignmentTokens: readonly string[],
	clearValues: readonly string[],
): CompactUpdateAstV1 {
	const assignments = assignmentTokens.map(parseCompactArgvAssignmentV1);
	const seenAssignments = new Set<string>();
	for (const assignment of assignments) {
		if (!assignment.key || assignment.key !== assignment.key.trim()) {
			throw compactUpdateError('COMPACT_SYNTAX_INVALID');
		}
		if (seenAssignments.has(assignment.key)) {
			throw compactUpdateError('DUPLICATE_KEY', assignment.key);
		}
		seenAssignments.add(assignment.key);
	}
	const clearKeys: string[] = [];
	const seenClears = new Set<string>();
	for (const raw of clearValues) {
		const key = normalizeCompactValueV1(raw);
		if (!key || key !== raw.trim()) {
			throw compactUpdateError('COMPACT_SYNTAX_INVALID');
		}
		if (seenClears.has(key)) {
			throw compactUpdateError('DUPLICATE_CLEAR', key);
		}
		if (seenAssignments.has(key)) {
			throw compactUpdateError('SET_CLEAR_CONFLICT', key);
		}
		seenClears.add(key);
		clearKeys.push(key);
	}
	if (assignments.length === 0 && clearKeys.length === 0) {
		throw compactUpdateError('UPDATE_CHANGES_REQUIRED');
	}
	return { assignments, clearKeys };
}

/**
 * Parses two to 64 raw compact update records. Each record uses the existing
 * update assignment/clear grammar and must begin with one exact quoted --id.
 * Structural validation completes for every line before Runtime discovery.
 */
export function parseCompactUpdateLinesInputV1(rawInput: string): CompactUpdateBatchItemAstV1[] {
	if (/(?:^|[^\r])\r(?!\n)/u.test(rawInput)) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_LINE_ENDING_INVALID');
	}
	const lines = rawInput.replace(/\r\n/gu, '\n').split('\n');
	if (lines.at(-1) === '') lines.pop();
	if (lines.length === 0) throw compactUpdateError('COMPACT_UPDATE_BATCH_EMPTY');
	if (lines.length < 2) throw compactUpdateError('COMPACT_UPDATE_BATCH_TOO_FEW_ITEMS');
	if (lines.length > COMPACT_UPDATE_BATCH_MAX_ITEMS_V1) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS');
	}
	if (lines.some(line => line.trim().length === 0)) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_BLANK_LINE');
	}
	const items = lines.map(parseCompactUpdateLineV1);
	const seenIds = new Set<string>();
	for (const item of items) {
		if (seenIds.has(item.operonId)) {
			throw compactUpdateError('COMPACT_UPDATE_BATCH_DUPLICATE_ID');
		}
		seenIds.add(item.operonId);
	}
	return items;
}

function parseCompactUpdateLineV1(rawLine: string): CompactUpdateBatchItemAstV1 {
	const input = rawLine.trim();
	const idMatch = /^--id\s+"((?:\\.|[^"\\])*)"/u.exec(input);
	if (!idMatch) throw compactUpdateError('COMPACT_UPDATE_BATCH_SELECTOR_REQUIRED');
	const operonId = normalizeCompactValueV1(decodeRawQuotedValueV1(idMatch[1]));
	if (!OPERON_ID_PATTERN_V1.test(operonId)) {
		throw compactUpdateError('INVALID_OPERON_ID');
	}
	let cursor = idMatch[0].length;
	const assignmentTokens: string[] = [];
	const clearValues: string[] = [];
	const tokenPattern = /\s+(?:(--clear)\s+"((?:\\.|[^"\\])*)"|((?:(?!::).)+?)::"((?:\\.|[^"\\])*)")/gy;
	while (cursor < input.length) {
		tokenPattern.lastIndex = cursor;
		const token = tokenPattern.exec(input);
		if (!token) throw compactUpdateError('COMPACT_SYNTAX_INVALID');
		if (token[1] === '--clear') {
			clearValues.push(decodeRawQuotedValueV1(token[2]));
		} else {
			assignmentTokens.push(`${token[3]}::${decodeRawQuotedValueV1(token[4])}`);
		}
		cursor = tokenPattern.lastIndex;
	}
	const update = parseCompactUpdateArgvV1(assignmentTokens, clearValues);
	if (compactUpdateRouteV1(update) !== 'general-update') {
		throw compactUpdateError('FIELD_OWNED_BY_OTHER_COMMAND');
	}
	return { operonId, update };
}

function decodeRawQuotedValueV1(value: string): string {
	return value.replace(/\\(["\\])/gu, '$1');
}

export function compileCompactUpdateIntentV1(options: {
	ast: CompactUpdateAstV1;
	task: HydratedTaskV1;
	catalog: CompactUpdateCatalogV1;
	includeNoChange?: boolean;
}): GuidedMutationIntentV1 {
	const { ast, task, catalog } = options;
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw compactUpdateError('INVALID_OPERON_ID');
	}
	if (!Array.isArray(task.writableFields)) {
		throw compactUpdateError('WRITABLE_FIELDS_INCOMPLETE');
	}
	const hydratedFields = new Map(task.writableFields.map(field => [field.canonicalKey, field]));
	const descriptors = new Map(catalog.fields.map(field => [field.canonicalKey, field]));
	const changes: GeneralUpdateItemV1[] = [];
	for (const assignment of ast.assignments) {
		const descriptor = requireWritableDescriptor(descriptors.get(assignment.key), assignment.key);
		const hydrated = requireHydratedField(hydratedFields, descriptor.canonicalKey);
		requireRecurrenceScope(task, descriptor.canonicalKey);
		const value = descriptor.canonicalKey === 'priority'
			? resolvePriorityId(catalog, assignment.value)
			: parseCompactFieldValueV1(descriptor, assignment.value);
		if (
			!options.includeNoChange
			&& hydrated.present
			&& writableValuesEqual(hydrated.value, value)
		) continue;
		changes.push({
			field: descriptor.canonicalKey,
			valueType: descriptor.valueType,
			value,
		} as GeneralUpdateItemV1);
	}
	for (const key of ast.clearKeys) {
		const descriptor = requireWritableDescriptor(descriptors.get(key), key);
		const hydrated = requireHydratedField(hydratedFields, descriptor.canonicalKey);
		requireRecurrenceScope(task, descriptor.canonicalKey);
		if (descriptor.canonicalKey === 'description' || !hydrated.canClear) {
			throw compactUpdateError('DESCRIPTION_CLEAR_UNAVAILABLE', descriptor.canonicalKey);
		}
		if (!options.includeNoChange && !hydrated.present) continue;
		changes.push({
			operation: 'clear',
			field: descriptor.canonicalKey,
			valueType: descriptor.valueType,
		});
	}
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user requested a direct human-readable Operon task update.',
		target: {
			operonId,
			locator: structuredClone(task.locator),
		},
		spec: {
			operation: 'update',
			changes,
		},
	};
}

export function compileCompactUpdateBatchIntentV1(options: {
	items: readonly CompactUpdateBatchItemAstV1[];
	tasks: readonly HydratedTaskV1[];
	catalog: CompactUpdateCatalogV1;
	itemRefs: readonly string[];
}): GuidedMutationIntentV1 {
	const { items, tasks, catalog, itemRefs } = options;
	if (items.length < 2) throw compactUpdateError('COMPACT_UPDATE_BATCH_TOO_FEW_ITEMS');
	if (items.length > COMPACT_UPDATE_BATCH_MAX_ITEMS_V1) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS');
	}
	if (
		tasks.length !== items.length
		|| itemRefs.length !== items.length
		|| new Set(itemRefs).size !== itemRefs.length
	) {
		throw compactUpdateError('COMPACT_SYNTAX_INVALID');
	}
	requireCompactUpdateBatchCapabilityV1(catalog);
	const taskById = new Map(tasks.map(task => [task.identity.operonId, task]));
	const compiledItems = items.map((item, index) => {
		const task = taskById.get(item.operonId);
		if (!task) throw compactUpdateError('WRITABLE_FIELDS_INCOMPLETE');
		const compiled = compileCompactUpdateIntentV1({
			ast: item.update,
			task,
			catalog,
			includeNoChange: true,
		});
		if (!compiled.target || compiled.spec.operation !== 'update') {
			throw compactUpdateError('COMPACT_SYNTAX_INVALID');
		}
		return {
			itemRef: itemRefs[index],
			target: compiled.target,
			changes: compiled.spec.changes,
		};
	});
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'Compact multi-update.',
		spec: {
			operation: 'update-batch',
			items: compiledItems,
		},
	};
}

function requireCompactUpdateBatchCapabilityV1(catalog: CompactUpdateCatalogV1): void {
	if (!catalog.policies) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE');
	}
	const update = catalog.policies.taskUpdate as typeof catalog.policies.taskUpdate & {
		compactUpdateBatchVersion?: number;
		compactUpdateBatchInputFormat?: string;
		compactUpdateBatchMaxItems?: number;
		compactUpdateBatchFeatures?: string[];
	};
	if (
		update.compactUpdateBatchVersion !== 1
		|| update.compactUpdateBatchInputFormat !== 'compact-lines'
		|| update.compactUpdateBatchMaxItems !== COMPACT_UPDATE_BATCH_MAX_ITEMS_V1
		|| !Array.isArray(update.compactUpdateBatchFeatures)
		|| update.compactUpdateBatchFeatures.length !== COMPACT_UPDATE_BATCH_FEATURES_V1.length
		|| update.compactUpdateBatchFeatures.some((feature, index) => (
			feature !== COMPACT_UPDATE_BATCH_FEATURES_V1[index]
		))
	) {
		throw compactUpdateError('COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE');
	}
}

export function compileCompactRelationshipUpdateIntentV1(options: {
	ast: CompactUpdateAstV1;
	task: TaskContextV1;
}): GuidedMutationIntentV1 {
	const { ast, task } = options;
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw compactUpdateError('INVALID_OPERON_ID');
	}
	if (compactUpdateRouteV1(ast) !== 'relationship-update') {
		throw compactUpdateError('RELATIONSHIP_GENERAL_UPDATE_CONFLICT');
	}
	const changes = [
		...ast.assignments.map(assignment => ({
			field: relationshipField(assignment.key),
			targetOperonIds: relationshipTargets(assignment.key, assignment.value, operonId),
		})),
		...ast.clearKeys.map(key => ({
			field: relationshipField(key),
			targetOperonIds: [] as string[],
		})),
	];
	const desired = new Map(changes.map(change => [change.field, change.targetOperonIds]));
	const blocking = desired.get('blocking') ?? task.relationships.blockingOperonIds;
	const blockedBy = new Set(
		desired.get('blockedBy') ?? task.relationships.blockedByOperonIds,
	);
	if (blocking.some(targetId => blockedBy.has(targetId))) {
		throw compactUpdateError('RELATIONSHIP_INVERSE_CONFLICT');
	}
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user requested a direct human-readable Operon relationship replacement.',
		target: {
			operonId,
			locator: structuredClone(task.locator),
		},
		spec: {
			operation: 'replace-relationships',
			changes,
		},
	};
}

export function compileCompactRecurrenceUpdateIntentV1(options: {
	ast: CompactUpdateAstV1;
	task: TaskContextV1;
	catalog: CompactUpdateCatalogV1;
	scope?: string;
}): GuidedMutationIntentV1 {
	const { ast, task, catalog } = options;
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw compactUpdateError('INVALID_OPERON_ID');
	}
	if (compactUpdateRouteV1(ast, options.scope) !== 'recurrence-update') {
		throw compactUpdateError('RECURRENCE_GENERAL_UPDATE_CONFLICT');
	}
	const scope = resolveRecurrenceScope(task, ast, options.scope);
	const descriptors = new Map(catalog.fields.map(field => [field.canonicalKey, field]));
	const changes: RecurrenceUpdateItemV1[] = [];
	for (const assignment of ast.assignments) {
		const descriptor = requireRecurrenceDescriptor(descriptors.get(assignment.key), assignment.key);
		if (
			scope === 'this-task'
			&& (descriptor.canonicalKey === 'repeat' || descriptor.canonicalKey === 'datetimeRepeatEnd')
		) {
			throw compactUpdateError('RECURRENCE_SCOPE_INVALID', descriptor.canonicalKey);
		}
		const value = parseCompactFieldValueV1(descriptor, assignment.value);
		changes.push({
			field: descriptor.canonicalKey,
			valueType: descriptor.valueType,
			value,
		} as RecurrenceUpdateItemV1);
	}
	for (const key of ast.clearKeys) {
		const descriptor = requireRecurrenceDescriptor(descriptors.get(key), key);
		if (
			scope === 'this-task'
			&& (descriptor.canonicalKey === 'repeat' || descriptor.canonicalKey === 'datetimeRepeatEnd')
		) {
			throw compactUpdateError('RECURRENCE_SCOPE_INVALID', descriptor.canonicalKey);
		}
		changes.push({
			operation: 'clear',
			field: descriptor.canonicalKey,
			valueType: descriptor.valueType,
		} as RecurrenceUpdateItemV1);
	}
	const spec: UpdateTaskRecurrenceSpecV1 = {
		operation: 'update-recurrence',
		scope,
		changes,
	};
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user requested a direct scoped Operon recurrence update.',
		target: {
			operonId,
			locator: structuredClone(task.locator),
		},
		spec: spec as unknown as Record<string, unknown>,
	};
}

export function compactRelationshipUpdateWouldChangeTaskV1(
	intent: GuidedMutationIntentV1,
	task: TaskContextV1,
): boolean {
	const changesValue: unknown = intent.spec.changes;
	if (
		intent.spec.operation !== 'replace-relationships'
		|| !isCompactRelationshipChangeArray(changesValue)
	) return true;
	const changes = changesValue;
	return changes.some(change => {
		const current = change.field === 'parentTask'
			? task.relationships.parentOperonId
				? [task.relationships.parentOperonId]
				: []
			: change.field === 'blocking'
				? task.relationships.blockingOperonIds
				: change.field === 'blockedBy'
					? task.relationships.blockedByOperonIds
					: null;
		return current === null
			|| current.length !== change.targetOperonIds.length
			|| current.some((value, index) => value !== change.targetOperonIds[index]);
	});
}

function isCompactRelationshipChangeArray(value: unknown): value is CompactRelationshipChangeV1[] {
	return Array.isArray(value) && value.every(isCompactRelationshipChange);
}

function isCompactRelationshipChange(value: unknown): value is CompactRelationshipChangeV1 {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		(record.field === 'parentTask' || record.field === 'blocking' || record.field === 'blockedBy')
		&& Array.isArray(record.targetOperonIds)
		&& record.targetOperonIds.every(target => typeof target === 'string')
	);
}

function relationshipField(key: string): 'parentTask' | 'blocking' | 'blockedBy' {
	if (key === 'parentTask' || key === 'blocking' || key === 'blockedBy') return key;
	throw compactUpdateError('RELATIONSHIP_GENERAL_UPDATE_CONFLICT', key);
}

function relationshipTargets(key: string, value: string, sourceOperonId: string): string[] {
	const targets = key === 'parentTask'
		? [value]
		: parseCompactListV1(value, key).items;
	if (
		targets.length === 0
		|| (key === 'parentTask' && targets.length !== 1)
		|| targets.some(target => !OPERON_ID_PATTERN_V1.test(target))
	) {
		throw compactUpdateError('RELATIONSHIP_TARGET_INVALID', key);
	}
	if (targets.includes(sourceOperonId)) {
		throw compactUpdateError('RELATIONSHIP_SELF_REFERENCE', key);
	}
	return targets;
}

function writableValuesEqual(
	current: WritableFieldValueV1['value'],
	next: WritableFieldValueV1['value'],
): boolean {
	if (Array.isArray(current) || Array.isArray(next)) {
		return Array.isArray(current)
			&& Array.isArray(next)
			&& current.length === next.length
			&& current.every((value, index) => value === next[index]);
	}
	return current === next;
}

function requireWritableDescriptor(
	descriptor: FieldDescriptorV1 | undefined,
	key: string,
): FieldDescriptorV1 {
	if (
		descriptor
		&& (
			descriptor.mutationClass !== 'general-update'
			|| descriptor.mutationOwner !== 'tasks.update'
		)
	) {
		throw compactUpdateError(
			'FIELD_OWNED_BY_OTHER_COMMAND',
			key,
			fieldOwnerReason(descriptor),
		);
	}
	if (
		!descriptor
		|| !isGeneralUpdateFieldV1(descriptor)
		|| descriptor.mutationClass !== 'general-update'
		|| descriptor.mutationOwner !== 'tasks.update'
	) {
		throw compactUpdateError('FIELD_NOT_WRITABLE', key);
	}
	return descriptor;
}

function requireRecurrenceDescriptor(
	descriptor: FieldDescriptorV1 | undefined,
	key: string,
): FieldDescriptorV1 & {
	canonicalKey: typeof COMPACT_RECURRENCE_KEYS_V1[number];
	valueType: 'text' | 'number' | 'date' | 'datetime';
} {
	const expectedTypes: Readonly<Record<string, FieldDescriptorV1['valueType']>> = {
		repeat: 'text',
		datetimeRepeatEnd: 'datetime',
		dateScheduled: 'date',
		dateStarted: 'date',
		dateDue: 'date',
		datetimeStart: 'datetime',
		datetimeEnd: 'datetime',
		estimate: 'number',
	};
	if (
		!descriptor
		|| !RECURRENCE_FIELDS.has(descriptor.canonicalKey)
		|| descriptor.mappingStatus !== 'mapped'
		|| !descriptor.readable
		|| descriptor.valueType !== expectedTypes[descriptor.canonicalKey]
	) {
		throw compactUpdateError('FIELD_NOT_WRITABLE', key);
	}
	return descriptor as FieldDescriptorV1 & {
		canonicalKey: typeof COMPACT_RECURRENCE_KEYS_V1[number];
		valueType: 'text' | 'number' | 'date' | 'datetime';
	};
}

function resolveRecurrenceScope(
	task: TaskContextV1,
	ast: CompactUpdateAstV1,
	rawScope: string | undefined,
): RecurrenceUpdateScopeV1 {
	if (
		rawScope !== undefined
		&& rawScope !== 'this-task'
		&& rawScope !== 'this-and-following'
	) throw compactUpdateError('RECURRENCE_SCOPE_INVALID');
	if (rawScope) return rawScope;
	const startsRecurrence = !task.recurrence.repeating
		&& ast.assignments.some(assignment => assignment.key === 'repeat');
	if (startsRecurrence) return 'this-and-following';
	throw compactUpdateError('RECURRING_TEMPORAL_REQUIRES_SCOPE');
}

function fieldOwnerReason(descriptor: FieldDescriptorV1): string {
	const owner = descriptor.mutationOwner;
	if (owner === 'tasks.transition') {
		return `Field "${descriptor.canonicalKey}" is semantic; use operon task transition.`;
	}
	if (owner === 'tasks.reminder') {
		return `Field "${descriptor.canonicalKey}" is semantic; use the operon reminder commands.`;
	}
	if (owner === 'timers.control') {
		return `Field "${descriptor.canonicalKey}" is semantic; use the operon timer commands.`;
	}
	if (owner === 'tasks.convert') {
		return `Field "${descriptor.canonicalKey}" is semantic; use operon task convert.`;
	}
	return `Field "${descriptor.canonicalKey}" is owned by a dedicated Operon command and cannot be changed with task update.`;
}

function requireHydratedField(
	fields: Map<string, WritableFieldValueV1>,
	key: string,
): WritableFieldValueV1 {
	const field = fields.get(key);
	if (!field) throw compactUpdateError('WRITABLE_FIELDS_INCOMPLETE', key);
	return field;
}

function requireRecurrenceScope(task: TaskContextV1, key: string): void {
	if (task.recurrence.repeating && RECURRING_TEMPORAL_FIELDS.has(key)) {
		throw compactUpdateError('RECURRING_TEMPORAL_REQUIRES_SCOPE', key);
	}
}

function resolvePriorityId(
	catalog: CompactUpdateCatalogV1,
	value: string,
): string {
	const matches = catalog.taxonomy.priorities.filter(priority => (
		priority.identityStatus === 'resolved'
		&& priority.label.normalize('NFC') === value
	));
	if (matches.length > 1) throw compactUpdateError('AMBIGUOUS_PRIORITY', 'priority');
	if (matches.length === 0) throw compactUpdateError('INVALID_PRIORITY', 'priority');
	return matches[0].id;
}

function compactUpdateError(
	code: CompactUpdateErrorCodeV1,
	field?: string,
	publicReason?: string,
): CompactUpdateErrorV1 {
	return Object.assign(new Error(code), {
		code,
		field,
		...(publicReason ? { publicReason } : {}),
	});
}
