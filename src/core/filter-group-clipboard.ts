import type {
	FilterFieldType,
	FilterGroup,
	FilterGroupLogic,
	FilterNode,
	FilterSetCondition,
} from '../types/settings';

export const FILTER_GROUP_CLIPBOARD_KIND = 'operon.filter-group';
export const FILTER_GROUP_CLIPBOARD_VERSION = 1;
export const FILTER_GROUP_CLIPBOARD_MAX_BYTES = 256 * 1024;
export const FILTER_GROUP_CLIPBOARD_MAX_DEPTH = 16;
export const FILTER_GROUP_CLIPBOARD_MAX_NODES = 500;

const FILTER_FIELD_TYPES = new Set<FilterFieldType>([
	'text',
	'number',
	'date',
	'datetime',
	'list',
	'checkbox',
	'tags',
	'pinned',
	'projectTree',
	'folders',
	'projectSerialScope',
]);

const FILTER_GROUP_LOGICS = new Set<FilterGroupLogic>(['all', 'any', 'none']);
const RAW_FILE_PROPERTY_FIELD_TYPES = new Set<FilterFieldType>([
	'text',
	'number',
	'date',
	'datetime',
	'list',
	'checkbox',
]);
const ENVELOPE_KEYS = new Set(['kind', 'version', 'group']);
const GROUP_KEYS = new Set(['logic', 'children']);
const CONDITION_KEYS = new Set(['field', 'fieldType', 'operator', 'value', 'values']);

interface FilterGroupClipboardConditionV1 {
	field: string;
	fieldType: FilterFieldType;
	operator: string;
	value?: string;
	values?: string[];
}

interface FilterGroupClipboardGroupV1 {
	logic: FilterGroupLogic;
	children: Array<FilterGroupClipboardGroupV1 | FilterGroupClipboardConditionV1>;
}

interface FilterGroupClipboardEnvelopeV1 {
	kind: typeof FILTER_GROUP_CLIPBOARD_KIND;
	version: typeof FILTER_GROUP_CLIPBOARD_VERSION;
	group: FilterGroupClipboardGroupV1;
}

export interface DecodeFilterGroupClipboardOptions {
	createGroupId: () => string;
	createConditionId: () => string;
	isOperatorAllowed: (field: string, fieldType: FilterFieldType, operator: string) => boolean;
}

export type DecodeFilterGroupClipboardResult =
	| { ok: true; group: FilterGroup }
	| { ok: false; reason: 'invalid' | 'limit' };

export type FilterGroupPasteCompatibilityIssue =
	| { kind: 'field'; value: string }
	| { kind: 'projectScope'; value: string };

export interface FindFilterGroupPasteCompatibilityIssueOptions {
	getFieldType: (field: string) => FilterFieldType | null;
	isRawFileProperty: (field: string) => boolean;
	isProjectScopeAvailable: (scope: string) => boolean;
}

export type ResolveFilterGroupPasteTargetResult =
	| { ok: true; target: FilterGroup }
	| { ok: false; reason: 'target' | 'limit' };

class FilterGroupClipboardLimitError extends Error {}

export function encodeFilterGroupClipboard(group: FilterGroup): string {
	const state = { nodes: 0 };
	const envelope: FilterGroupClipboardEnvelopeV1 = {
		kind: FILTER_GROUP_CLIPBOARD_KIND,
		version: FILTER_GROUP_CLIPBOARD_VERSION,
		group: encodeGroup(group, 1, state),
	};
	const serialized = JSON.stringify(envelope);
	if (getUtf8ByteLength(serialized) > FILTER_GROUP_CLIPBOARD_MAX_BYTES) {
		throw new FilterGroupClipboardLimitError('Filter group clipboard payload exceeds the maximum size.');
	}
	return serialized;
}

export function decodeFilterGroupClipboard(
	text: string,
	options: DecodeFilterGroupClipboardOptions,
): DecodeFilterGroupClipboardResult {
	if (getUtf8ByteLength(text) > FILTER_GROUP_CLIPBOARD_MAX_BYTES) {
		return { ok: false, reason: 'limit' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	if (!isRecord(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS)) {
		return { ok: false, reason: 'invalid' };
	}
	if (
		parsed.kind !== FILTER_GROUP_CLIPBOARD_KIND
		|| parsed.version !== FILTER_GROUP_CLIPBOARD_VERSION
	) {
		return { ok: false, reason: 'invalid' };
	}
	try {
		const state = { nodes: 0 };
		const group = decodeGroup(parsed.group, 1, state, options);
		return group ? { ok: true, group } : { ok: false, reason: 'invalid' };
	} catch (error) {
		if (error instanceof FilterGroupClipboardLimitError) {
			return { ok: false, reason: 'limit' };
		}
		throw error;
	}
}

export function findFilterGroupPasteCompatibilityIssue(
	group: FilterGroup,
	options: FindFilterGroupPasteCompatibilityIssueOptions,
): FilterGroupPasteCompatibilityIssue | null {
	const visit = (node: FilterNode): FilterGroupPasteCompatibilityIssue | null => {
		if (isFilterGroup(node)) {
			for (const child of node.children) {
				const issue = visit(child);
				if (issue) return issue;
			}
			return null;
		}
		const destinationType = options.getFieldType(node.field);
		if (options.isRawFileProperty(node.field)) {
			if (
				(destinationType && destinationType !== node.fieldType)
				|| (!destinationType && !RAW_FILE_PROPERTY_FIELD_TYPES.has(node.fieldType))
			) {
				return { kind: 'field', value: node.field };
			}
		} else {
			if (!destinationType || destinationType !== node.fieldType) {
				return { kind: 'field', value: node.field };
			}
		}
		if (node.fieldType === 'projectSerialScope') {
			const missingScope = node.values?.find(scope => !options.isProjectScopeAvailable(scope));
			if (missingScope) return { kind: 'projectScope', value: missingScope };
		}
		return null;
	};
	return visit(group);
}

export function resolveFilterGroupPasteTarget(
	rootGroup: FilterGroup,
	targetGroupId: string,
	pastedGroup: FilterGroup,
): ResolveFilterGroupPasteTargetResult {
	const rootInspection = inspectFilterGroupTree(rootGroup, targetGroupId);
	const pastedInspection = inspectFilterGroupTree(pastedGroup, null);
	if (!rootInspection || !pastedInspection || rootInspection.targetMatches !== 1 || !rootInspection.target) {
		return { ok: false, reason: 'target' };
	}
	if (
		rootInspection.nodes + pastedInspection.nodes > FILTER_GROUP_CLIPBOARD_MAX_NODES
		|| rootInspection.maxDepth > FILTER_GROUP_CLIPBOARD_MAX_DEPTH
		|| rootInspection.targetDepth + pastedInspection.maxDepth > FILTER_GROUP_CLIPBOARD_MAX_DEPTH
	) {
		return { ok: false, reason: 'limit' };
	}
	return { ok: true, target: rootInspection.target };
}

function encodeGroup(
	group: FilterGroup,
	depth: number,
	state: { nodes: number },
): FilterGroupClipboardGroupV1 {
	countNode(depth, state);
	return {
		logic: group.logic,
		children: group.children.map(child => (
			isFilterGroup(child)
				? encodeGroup(child, depth + 1, state)
				: encodeCondition(child, depth + 1, state)
		)),
	};
}

function encodeCondition(
	condition: FilterSetCondition,
	depth: number,
	state: { nodes: number },
): FilterGroupClipboardConditionV1 {
	countNode(depth, state);
	return {
		field: condition.field,
		fieldType: condition.fieldType,
		operator: condition.operator,
		...(condition.value !== undefined ? { value: condition.value } : {}),
		...(condition.values !== undefined ? { values: [...condition.values] } : {}),
	};
}

function decodeGroup(
	value: unknown,
	depth: number,
	state: { nodes: number },
	options: DecodeFilterGroupClipboardOptions,
): FilterGroup | null {
	countNode(depth, state);
	if (!isRecord(value) || !hasExactKeys(value, GROUP_KEYS)) return null;
	if (!FILTER_GROUP_LOGICS.has(value.logic as FilterGroupLogic)) return null;
	if (!Array.isArray(value.children)) return null;
	const children: FilterNode[] = [];
	for (const child of value.children) {
		const decoded = isRecord(child) && hasOwn(child, 'children')
			? decodeGroup(child, depth + 1, state, options)
			: decodeCondition(child, depth + 1, state, options);
		if (!decoded) return null;
		children.push(decoded);
	}
	return {
		id: options.createGroupId(),
		logic: value.logic as FilterGroupLogic,
		children,
	};
}

function decodeCondition(
	value: unknown,
	depth: number,
	state: { nodes: number },
	options: DecodeFilterGroupClipboardOptions,
): FilterSetCondition | null {
	countNode(depth, state);
	if (!isRecord(value) || !hasAllowedKeys(value, CONDITION_KEYS)) return null;
	if (!isNonEmptyTrimmedString(value.field)) return null;
	if (!FILTER_FIELD_TYPES.has(value.fieldType as FilterFieldType)) return null;
	if (!isNonEmptyTrimmedString(value.operator)) return null;
	const fieldType = value.fieldType as FilterFieldType;
	if (!options.isOperatorAllowed(value.field, fieldType, value.operator)) return null;
	const conditionValue = value.value;
	const conditionValues = value.values;
	if (hasOwn(value, 'value') && typeof conditionValue !== 'string') return null;
	if (hasOwn(value, 'values')) {
		if (!isNonEmptyTrimmedStringArray(conditionValues)) return null;
	}
	if (hasOwn(value, 'value') && hasOwn(value, 'values')) return null;
	if (hasOwn(value, 'values') && (
		fieldType !== 'projectSerialScope'
		|| (value.operator !== 'isAnyOf' && value.operator !== 'isNoneOf')
	)) return null;
	return {
		id: options.createConditionId(),
		field: value.field,
		fieldType,
		operator: value.operator,
		...(typeof conditionValue === 'string' ? { value: conditionValue } : {}),
		...(isNonEmptyTrimmedStringArray(conditionValues) ? { values: [...conditionValues] } : {}),
	};
}

function countNode(depth: number, state: { nodes: number }): void {
	state.nodes += 1;
	if (depth > FILTER_GROUP_CLIPBOARD_MAX_DEPTH || state.nodes > FILTER_GROUP_CLIPBOARD_MAX_NODES) {
		throw new FilterGroupClipboardLimitError('Filter group clipboard payload exceeds structural limits.');
	}
}

function inspectFilterGroupTree(
	rootGroup: FilterGroup,
	targetGroupId: string | null,
): {
	nodes: number;
	maxDepth: number;
	target: FilterGroup | null;
	targetDepth: number;
	targetMatches: number;
} | null {
	const seen = new Set<FilterNode>();
	const stack: Array<{ node: FilterNode; depth: number }> = [{ node: rootGroup, depth: 1 }];
	let nodes = 0;
	let maxDepth = 0;
	let target: FilterGroup | null = null;
	let targetDepth = 0;
	let targetMatches = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || seen.has(current.node)) return null;
		seen.add(current.node);
		nodes += 1;
		maxDepth = Math.max(maxDepth, current.depth);
		if (!isFilterGroup(current.node)) continue;
		if (targetGroupId !== null && current.node.id === targetGroupId) {
			target = current.node;
			targetDepth = current.depth;
			targetMatches += 1;
		}
		for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
			stack.push({ node: current.node.children[index], depth: current.depth + 1 });
		}
	}
	return { nodes, maxDepth, target, targetDepth, targetMatches };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	const keys = Object.keys(value);
	return keys.length === allowed.size && keys.every(key => allowed.has(key));
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every(key => allowed.has(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.keys(value).includes(key);
}

function isNonEmptyTrimmedString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isNonEmptyTrimmedStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isNonEmptyTrimmedString);
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
	return 'children' in node;
}

function getUtf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
