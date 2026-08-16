import assert from 'node:assert/strict';
import {
	decodeFilterGroupClipboard,
	encodeFilterGroupClipboard,
	FILTER_GROUP_CLIPBOARD_MAX_BYTES,
	FILTER_GROUP_CLIPBOARD_MAX_NODES,
	findFilterGroupPasteCompatibilityIssue,
	resolveFilterGroupPasteTarget,
	type FindFilterGroupPasteCompatibilityIssueOptions,
} from '../src/core/filter-group-clipboard';
import type { FilterFieldType, FilterGroup, FilterNode } from '../src/types/settings';

let assertions = 0;

function check(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message) assert.deepEqual(actual, expected, message);
	else assert.deepEqual(actual, expected);
	assertions += 1;
}

function decode(text: string, seed: string) {
	let groupId = 0;
	let conditionId = 0;
	const operatorsByType: Partial<Record<FilterFieldType, readonly string[]>> = {
		checkbox: ['isOpen', 'isDone'],
		date: ['isToday', 'underDaysAgo'],
		text: ['contains'],
	};
	return decodeFilterGroupClipboard(text, {
		createGroupId: () => `${seed}_group_${++groupId}`,
		createConditionId: () => `${seed}_condition_${++conditionId}`,
		isOperatorAllowed: (_field: string, type: FilterFieldType, operator: string) => (
			operatorsByType[type]?.includes(operator) ?? false
		),
	});
}

function stripIds(node: FilterNode): unknown {
	if ('children' in node) {
		return {
			logic: node.logic,
			children: node.children.map(stripIds),
		};
	}
	return {
		field: node.field,
		fieldType: node.fieldType,
		operator: node.operator,
		...(node.value !== undefined ? { value: node.value } : {}),
		...(node.values !== undefined ? { values: node.values } : {}),
	};
}

function collectIds(group: FilterGroup): string[] {
	const ids = [group.id];
	for (const child of group.children) {
		if ('children' in child) ids.push(...collectIds(child));
		else ids.push(child.id);
	}
	return ids;
}

async function run(): Promise<void> {
	const source: FilterGroup = {
		id: 'source_root',
		logic: 'any',
		children: [
			{
				id: 'source_checkbox',
				field: 'checkbox',
				fieldType: 'checkbox',
				operator: 'isOpen',
			},
			{
				id: 'source_nested',
				logic: 'none',
				children: [{
					id: 'source_date',
					field: 'dateScheduled',
					fieldType: 'date',
					operator: 'underDaysAgo',
					value: '7',
				}],
			},
		],
	};
	const serialized = encodeFilterGroupClipboard(source);
	check(serialized.includes('"kind":"operon.filter-group"'));
	check(!serialized.includes('source_root'), 'clipboard payload must omit source IDs');

	const first = decode(serialized, 'first');
	const second = decode(serialized, 'second');
	equal(first.ok, true);
	equal(second.ok, true);
	if (first.ok && second.ok) {
		equal(stripIds(first.group), stripIds(source), 'recursive group semantics must round-trip exactly');
		equal(stripIds(second.group), stripIds(source), 'repeated paste must preserve the same semantics');
		const firstIds = collectIds(first.group);
		const secondIds = collectIds(second.group);
		equal(new Set(firstIds).size, firstIds.length, 'every pasted node must receive a unique ID');
		check(firstIds.every(id => !collectIds(source).includes(id)), 'pasted IDs must differ from source IDs');
		check(firstIds.every(id => !secondIds.includes(id)), 'repeated paste must create independent IDs');
	}

	equal(decode('not json', 'invalid').ok, false);
	const wrongKind = JSON.stringify({ ...JSON.parse(serialized), kind: 'other' });
	equal(decode(wrongKind, 'invalid').ok, false);
	const wrongVersion = JSON.stringify({ ...JSON.parse(serialized), version: 2 });
	equal(decode(wrongVersion, 'invalid').ok, false);
	const unknownEnvelopeKey = JSON.stringify({ ...JSON.parse(serialized), extra: true });
	equal(decode(unknownEnvelopeKey, 'invalid').ok, false);
	const unknownGroupKey = JSON.parse(serialized);
	unknownGroupKey.group.extra = true;
	equal(decode(JSON.stringify(unknownGroupKey), 'invalid').ok, false);
	const unknownConditionKey = JSON.parse(serialized);
	unknownConditionKey.group.children[0].extra = true;
	equal(decode(JSON.stringify(unknownConditionKey), 'invalid').ok, false);
	const invalidOperator = JSON.parse(serialized);
	invalidOperator.group.children[0].operator = 'not-real';
	equal(decode(JSON.stringify(invalidOperator), 'invalid').ok, false);
	const invalidValue = JSON.parse(serialized);
	invalidValue.group.children[1].children[0].value = 7;
	equal(decode(JSON.stringify(invalidValue), 'invalid').ok, false);
	const ambiguousValueShape = JSON.parse(serialized);
	ambiguousValueShape.group.children[1].children[0].values = ['7'];
	equal(decode(JSON.stringify(ambiguousValueShape), 'invalid').ok, false);

	const tooManyNodes = {
		kind: 'operon.filter-group',
		version: 1,
		group: {
			logic: 'all',
			children: Array.from({ length: FILTER_GROUP_CLIPBOARD_MAX_NODES }, () => ({
				field: 'checkbox',
				fieldType: 'checkbox',
				operator: 'isOpen',
			})),
		},
	};
	const nodeLimitResult = decode(JSON.stringify(tooManyNodes), 'nodes');
	equal(nodeLimitResult.ok, false);
	if (!nodeLimitResult.ok) equal(nodeLimitResult.reason, 'limit');

	let deepGroup: Record<string, unknown> = { logic: 'all', children: [] };
	for (let index = 0; index < 16; index += 1) {
		deepGroup = { logic: 'all', children: [deepGroup] };
	}
	const deepPayload = JSON.stringify({ kind: 'operon.filter-group', version: 1, group: deepGroup });
	const deepResult = decode(deepPayload, 'deep');
	equal(deepResult.ok, false);
	if (!deepResult.ok) equal(deepResult.reason, 'limit');
	const oversizedResult = decode('x'.repeat(FILTER_GROUP_CLIPBOARD_MAX_BYTES + 1), 'large');
	equal(oversizedResult.ok, false);
	if (!oversizedResult.ok) equal(oversizedResult.reason, 'limit');

	const compatibilityGroup: FilterGroup = {
		id: 'compatibility_root',
		logic: 'all',
		children: [
			{
				id: 'missing_custom',
				field: 'managedCustomKey',
				fieldType: 'text',
				operator: 'contains',
				value: 'x',
			},
			{
				id: 'raw_property',
				field: 'file.property:Owner',
				fieldType: 'text',
				operator: 'contains',
				value: 'Ada',
			},
			{
				id: 'scope',
				field: 'projectSerialScope',
				fieldType: 'projectSerialScope',
				operator: 'isAnyOf',
				values: ['project-alpha', 'project-missing'],
			},
		],
	};
	const compatibilityOptions: FindFilterGroupPasteCompatibilityIssueOptions = {
		getFieldType: (field: string) => field === 'projectSerialScope' ? 'projectSerialScope' : null,
		isRawFileProperty: (field: string) => field.startsWith('file.property:'),
		isProjectScopeAvailable: (scope: string) => scope === 'project-alpha',
	};
	equal(
		findFilterGroupPasteCompatibilityIssue(compatibilityGroup, compatibilityOptions),
		{ kind: 'field', value: 'managedCustomKey' },
	);
	compatibilityOptions.getFieldType = field => (
		field === 'managedCustomKey'
			? 'text'
			: field === 'projectSerialScope'
				? 'projectSerialScope'
				: null
	);
	equal(
		findFilterGroupPasteCompatibilityIssue(compatibilityGroup, compatibilityOptions),
		{ kind: 'projectScope', value: 'project-missing' },
	);
	compatibilityOptions.isProjectScopeAvailable = () => true;
	equal(findFilterGroupPasteCompatibilityIssue(compatibilityGroup, compatibilityOptions), null);
	compatibilityOptions.getFieldType = field => (
		field === 'managedCustomKey'
			? 'number'
			: field === 'projectSerialScope'
				? 'projectSerialScope'
				: null
	);
	equal(
		findFilterGroupPasteCompatibilityIssue(compatibilityGroup, compatibilityOptions),
		{ kind: 'field', value: 'managedCustomKey' },
	);
	const invalidRawTypeGroup: FilterGroup = {
		id: 'raw_type_root',
		logic: 'all',
		children: [{
			id: 'raw_type',
			field: 'file.property:Owner',
			fieldType: 'projectTree',
			operator: 'matchesTree',
		}],
	};
	compatibilityOptions.getFieldType = () => null;
	equal(
		findFilterGroupPasteCompatibilityIssue(invalidRawTypeGroup, compatibilityOptions),
		{ kind: 'field', value: 'file.property:Owner' },
	);

	const target: FilterGroup = { id: 'target', logic: 'all', children: [] };
	const destination: FilterGroup = { id: 'destination', logic: 'all', children: [target] };
	const pasted: FilterGroup = { id: 'pasted', logic: 'any', children: [] };
	const resolvedTarget = resolveFilterGroupPasteTarget(destination, target.id, pasted);
	equal(resolvedTarget.ok, true);
	if (resolvedTarget.ok) equal(resolvedTarget.target, target);
	equal(resolveFilterGroupPasteTarget(destination, 'missing', pasted), { ok: false, reason: 'target' });

	let deepTarget: FilterGroup = { id: 'deep_target', logic: 'all', children: [] };
	const deepDestination = deepTarget;
	for (let depth = 1; depth <= 16; depth += 1) {
		deepTarget.children.push({ id: `deep_${depth}`, logic: 'all', children: [] });
		deepTarget = deepTarget.children[0] as FilterGroup;
	}
	equal(
		resolveFilterGroupPasteTarget(deepDestination, deepTarget.id, pasted),
		{ ok: false, reason: 'limit' },
	);
	equal(
		resolveFilterGroupPasteTarget(deepDestination, deepDestination.id, pasted),
		{ ok: false, reason: 'limit' },
	);
	const fullDestination: FilterGroup = {
		id: 'full',
		logic: 'all',
		children: Array.from({ length: FILTER_GROUP_CLIPBOARD_MAX_NODES - 1 }, (_, index) => ({
			id: `full_condition_${index}`,
			field: 'checkbox',
			fieldType: 'checkbox' as const,
			operator: 'isOpen',
		})),
	};
	equal(
		resolveFilterGroupPasteTarget(fullDestination, fullDestination.id, pasted),
		{ ok: false, reason: 'limit' },
	);

	console.log(`Filter group clipboard: ${assertions}/${assertions} passed`);
}

globalThis.__operonFilterGroupClipboardTestRun = run();

declare global {
	var __operonFilterGroupClipboardTestRun: Promise<void> | undefined;
}
