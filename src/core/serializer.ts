/**
 * Operon task line serializer.
 * Writes ParsedTask back to canonical task line format.
 *
 * Based on Spec Sections 7.1 - 7.5.
 * Canonical order: checkbox, time prefix, description, tags, fields (ordered), datetimeModified last.
 */

import { CANONICAL_KEY_MAP } from '../types/keys';
import { OperonField, ParsedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { normalizeLegacyCreatedDatetime } from './yaml-fields';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';
import { parseTaskLine } from './parser';
import { getManagedCustomKeyOrder, getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';

/**
 * Escape special characters in a field value for safe inline storage.
 * Line breaks are encoded so inline fields never split the physical task line.
 */
function escapeValue(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '\\') {
			result += '\\\\';
		} else if (ch === '\r') {
			if (i + 1 < value.length && value[i + 1] === '\n') {
				i++;
			}
			result += '\\u000A';
		} else if (ch === '\n') {
			result += '\\u000A';
		} else if (ch === '}' && i + 1 < value.length && value[i + 1] === '}') {
			result += '\\}';
		} else if (ch === '{' && i + 1 < value.length && value[i + 1] === '{') {
			result += '\\{';
		} else {
			result += ch;
		}
	}
	return result;
}

/**
 * Get the canonical sort position for a field key.
 * Known canonical keys get their defined position.
 * Unknown unmanaged keys keep the legacy fallback bucket.
 * datetimeModified always sorts last among canonical keys.
 */
function getFieldSortPosition(key: string): number {
	const def = CANONICAL_KEY_MAP.get(key);
	if (def) return def.position;
	return 30.5;
}

function getCustomFieldAnchorPosition(fields: OperonField[]): number | null {
	if (fields.some(field => field.key === 'datetimeCreated')) {
		return CANONICAL_KEY_MAP.get('datetimeCreated')?.position ?? null;
	}
	if (fields.some(field => field.key === 'datetimeModified')) {
		return CANONICAL_KEY_MAP.get('datetimeModified')?.position ?? null;
	}
	return null;
}

/**
 * Sort fields into canonical order (Spec Section 7.2).
 * operonId first, timestamps late, managed custom keys by insertion order.
 */
function sortFieldsCanonical(fields: OperonField[], keyMappings: KeyMapping[] = []): OperonField[] {
	const customAnchorPosition = getCustomFieldAnchorPosition(fields);
	return fields
		.map((field, index) => ({ field, index }))
		.sort((a, b) => {
			const customOrderA = getManagedCustomKeyOrder(a.field.key, keyMappings);
			const customOrderB = getManagedCustomKeyOrder(b.field.key, keyMappings);
			const isCustomA = customOrderA !== null;
			const isCustomB = customOrderB !== null;

			if (isCustomA && isCustomB) {
				if (customOrderA !== customOrderB) return customOrderA - customOrderB;
				return a.index - b.index;
			}

			if (isCustomA || isCustomB) {
				if (customAnchorPosition === null) {
					if (isCustomA && !isCustomB) return 1;
					if (!isCustomA && isCustomB) return -1;
				}
				const builtInField = isCustomA ? b.field : a.field;
				const builtInPosition = getFieldSortPosition(builtInField.key);
				const customComesFirst = customAnchorPosition !== null
					? builtInPosition >= customAnchorPosition
					: false;
				if (isCustomA) return customComesFirst ? -1 : 1;
				return customComesFirst ? 1 : -1;
			}

			const posA = getFieldSortPosition(a.field.key);
			const posB = getFieldSortPosition(b.field.key);
			if (posA !== posB) return posA - posB;
			const managedA = isManagedTaskFieldCanonicalKey(a.field.key, keyMappings);
			const managedB = isManagedTaskFieldCanonicalKey(b.field.key, keyMappings);
			if (managedA !== managedB) return managedA ? -1 : 1;
			if (!managedA && !managedB) return a.field.key.localeCompare(b.field.key);
			return a.index - b.index;
		})
		.map(entry => entry.field);
}

/**
 * Serialize a single field to its inline format: {{key:: value}}
 */
function getSerializedKeyName(field: OperonField, _keyMappings: KeyMapping[]): string {
	if (field.key === 'datetimeCreated' && field.sourceKey === 'dateCreated') {
		return field.key;
	}
	if (field.sourceKey) return field.sourceKey;
	return field.key;
}

export function serializeField(field: OperonField, keyMappings: KeyMapping[] = []): string {
	const normalizedValue = field.key === 'datetimeCreated'
		? normalizeLegacyCreatedDatetime(field.value)
		: field.key === 'taskIcon'
			? normalizeTaskIconValue(field.value)
			: field.key === 'taskColor'
				? normalizeTaskColorValue(field.value)
			: field.value;
	const escapedValue = escapeValue(normalizedValue);
	const keyName = getSerializedKeyName(field, keyMappings);
	if (!escapedValue) {
		return `{{${keyName}::}}`;
	}
	return `{{${keyName}:: ${escapedValue}}}`;
}

/**
 * Serialize a complete ParsedTask back to its canonical task line format.
 *
 * Format: - [STATUS] TIME DESCRIPTION #tags {{operonId:: x}} {{fields}} {{datetimeModified:: x}}
 */
export function serializeTask(task: ParsedTask, keyMappings: KeyMapping[] = []): string {
	const parts: string[] = [];

	// 1. Checkbox
	let checkboxChar: string;
	switch (task.checkbox) {
		case 'done': checkboxChar = 'x'; break;
		case 'cancelled': checkboxChar = '-'; break;
		default: checkboxChar = ' ';
	}
	parts.push(`- [${checkboxChar}]`);

	// 2. Optional time prefix
	if (task.timePrefix) {
		parts.push(task.timePrefix.raw);
	}

	// 3. Description text
	if (task.description) {
		parts.push(task.description);
	}

	// 4. Tags (Obsidian-native, outside containers)
	for (const tag of task.tags) {
		parts.push(`#${tag}`);
	}

	// 5. Fields in canonical order
	const sortedFields = sortFieldsCanonical(task.fields, keyMappings);
	for (const field of sortedFields) {
		parts.push(serializeField(field, keyMappings));
	}

	const indent = task.rawLine ? task.rawLine.slice(0, task.checkboxRange.from) : '';
	return `${indent}${parts.join(' ')}`;
}

/**
 * Normalize a task line: parse it and serialize it back to canonical format.
 * This reorders fields, normalizes spacing, and ensures canonical structure.
 */
export function normalizeTaskLine(
	line: string,
	lineNumber: number,
	filePath: string,
	keyMappings: KeyMapping[] = [],
): string | null {
	const task = parseTaskLine(line, lineNumber, filePath, keyMappings);
	if (!task) return null;
	return serializeTask(task, keyMappings);
}

/**
 * Build a canonical task line from individual components.
 * Useful for creating new tasks programmatically.
 */
export function buildTaskLine(
	description: string,
	fields: Record<string, string>,
	options?: {
		checkbox?: 'open' | 'done' | 'cancelled';
		timePrefix?: string;
		tags?: string[];
		keyMappings?: KeyMapping[];
	}
): string {
	const parts: string[] = [];

	// Checkbox
	const checkboxChar = options?.checkbox === 'done' ? 'x' :
	                     options?.checkbox === 'cancelled' ? '-' : ' ';
	parts.push(`- [${checkboxChar}]`);

	// Time prefix
	if (options?.timePrefix) {
		parts.push(options.timePrefix);
	}

	// Description
	if (description) {
		parts.push(description);
	}

	// Tags
	if (options?.tags) {
		for (const tag of options.tags) {
			parts.push(`#${tag}`);
		}
	}

	// Build OperonField array for sorting
	const keyMappings = options?.keyMappings ?? [];
	const operonFields: OperonField[] = Object.entries(fields).map(([key, value]) => ({
		sourceKey: key,
		key,
		value,
		rawValue: value,
		type: getManagedTaskFieldType(key, keyMappings) ?? 'text',
		isCanonical: isManagedTaskFieldCanonicalKey(key, keyMappings),
		containerRange: { from: 0, to: 0 },
		valueRange: { from: 0, to: 0 },
	}));

	const sortedFields = sortFieldsCanonical(operonFields, keyMappings);
	for (const field of sortedFields) {
		parts.push(serializeField(field, keyMappings));
	}

	return parts.join(' ');
}
