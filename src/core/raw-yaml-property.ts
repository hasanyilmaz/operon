import { CANONICAL_KEYS, LEGACY_CANONICAL_KEY_ALIASES } from '../types/keys';
import type { IndexedTask } from '../types/fields';
import type { FilterFieldType } from '../types/settings';
import type { KeyMapping } from '../types/settings';
import { parseLocalTimestamp } from './local-time';

export const FILE_PROPERTY_COLUMN_PREFIX = 'file.property:';

export type RawYamlPropertyScalar = string | number | boolean | null;
export type RawYamlPropertyValue = RawYamlPropertyScalar | RawYamlPropertyScalar[];

export interface RawYamlPropertyExpectation {
	present: boolean;
	value: RawYamlPropertyValue | undefined;
}

export type RawYamlPropertyMutation =
	| { kind: 'set'; value: RawYamlPropertyValue }
	| { kind: 'delete' };

export type RawYamlPropertyWriteOutcome =
	| 'updated'
	| 'already-updated'
	| 'conflict'
	| 'missing'
	| 'unsupported';

export interface RawYamlPropertyWriteResult {
	outcome: RawYamlPropertyWriteOutcome;
	filePath: string | null;
	current: RawYamlPropertyExpectation;
}

export interface FilePropertyFieldDescriptor {
	readonly key: string;
	readonly type: FilterFieldType;
}

export interface FilePropertyCellValue {
	readonly present: boolean;
	readonly rawValue: unknown;
	readonly normalizedValue: string;
}

export interface FilePropertyQueryContext<
	TField extends FilePropertyFieldDescriptor = FilePropertyFieldDescriptor,
	TCell extends FilePropertyCellValue = FilePropertyCellValue,
> {
	readonly signature: string;
	readonly fields: readonly TField[];
	getCell(task: IndexedTask, columnKey: string): TCell;
	getCandidates(columnKey: string): readonly string[];
}

export type FilePropertyValueState =
	| { kind: 'empty'; value: undefined }
	| { kind: 'valid'; value: RawYamlPropertyValue }
	| { kind: 'unsupported'; value: unknown };

const RESERVED_RAW_PROPERTY_NAMES = new Set([
	'aliases',
	'cssclasses',
	'position',
	'tags',
	'title',
	'pinned',
]);

export function encodeFilePropertyColumnKey(propertyName: string): string | null {
	if (!propertyName || !propertyName.trim()) return null;
	return `${FILE_PROPERTY_COLUMN_PREFIX}${encodeURIComponent(propertyName)}`;
}

export function decodeFilePropertyColumnKey(columnKey: string): string | null {
	if (!columnKey.startsWith(FILE_PROPERTY_COLUMN_PREFIX)) return null;
	const encoded = columnKey.slice(FILE_PROPERTY_COLUMN_PREFIX.length);
	if (!encoded) return null;
	try {
		const propertyName = decodeURIComponent(encoded);
		if (!propertyName || !propertyName.trim()) return null;
		return encodeFilePropertyColumnKey(propertyName) === columnKey ? propertyName : null;
	} catch {
		return null;
	}
}

export function isFilePropertyColumnKey(columnKey: string): boolean {
	return decodeFilePropertyColumnKey(columnKey) !== null;
}

export function isSupportedRawYamlPropertyValue(value: unknown): value is RawYamlPropertyValue {
	if (value === null) return true;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
	if (!Array.isArray(value)) return false;
	return value.every(item => (
		item === null
		|| typeof item === 'string'
		|| typeof item === 'number'
		|| typeof item === 'boolean'
	));
}

export function classifyFilePropertyCell(
	field: Pick<FilePropertyFieldDescriptor, 'type'>,
	cell: Pick<FilePropertyCellValue, 'present' | 'rawValue'>,
): FilePropertyValueState {
	if (!cell.present || isEmptyFilePropertyValue(cell.rawValue)) {
		return { kind: 'empty', value: undefined };
	}
	if (!isSupportedRawYamlPropertyValue(cell.rawValue) || !isValueCompatibleWithFilePropertyField(field, cell.rawValue)) {
		return { kind: 'unsupported', value: cell.rawValue };
	}
	return { kind: 'valid', value: cell.rawValue };
}

export function isEmptyFilePropertyValue(value: unknown): boolean {
	return value === null
		|| value === undefined
		|| (typeof value === 'string' && value.trim().length === 0)
		|| (Array.isArray(value) && value.length === 0);
}

function isValueCompatibleWithFilePropertyField(
	field: Pick<FilePropertyFieldDescriptor, 'type'>,
	value: RawYamlPropertyValue,
): boolean {
	switch (field.type) {
		case 'list':
		case 'tags':
			return Array.isArray(value) && value.every(item => (
				item !== null
					&& (typeof item === 'string'
						|| typeof item === 'boolean'
						|| (typeof item === 'number' && Number.isFinite(item)))
			));
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'checkbox':
			return typeof value === 'boolean';
		case 'date':
		case 'datetime':
			return typeof value === 'string' && parseLocalTimestamp(value.trim()) !== null;
		case 'text':
		default:
			return typeof value === 'string';
	}
}

export function isWritableRawYamlPropertyName(
	propertyName: string,
	keyMappings: readonly KeyMapping[],
): boolean {
	if (!propertyName || !propertyName.trim() || propertyName.startsWith('_')) return false;
	if (RESERVED_RAW_PROPERTY_NAMES.has(propertyName)) return false;
	const managedNames = new Set<string>();
	for (const canonical of CANONICAL_KEYS) {
		managedNames.add(canonical.name);
		for (const alias of LEGACY_CANONICAL_KEY_ALIASES[canonical.name] ?? []) managedNames.add(alias);
	}
	for (const mapping of keyMappings) {
		managedNames.add(mapping.canonicalKey);
		if (mapping.visiblePropertyName) managedNames.add(mapping.visiblePropertyName);
	}
	return !managedNames.has(propertyName);
}

export function readRawYamlPropertyExpectation(
	frontmatter: Record<string, unknown>,
	propertyName: string,
): RawYamlPropertyExpectation | null {
	const present = Object.keys(frontmatter).includes(propertyName);
	if (!present) return { present: false, value: undefined };
	const value = frontmatter[propertyName];
	return isSupportedRawYamlPropertyValue(value) ? { present: true, value } : null;
}

export function rawYamlPropertyExpectationsEqual(
	left: RawYamlPropertyExpectation,
	right: RawYamlPropertyExpectation,
): boolean {
	if (left.present !== right.present) return false;
	if (!left.present) return true;
	return rawYamlPropertyValuesEqual(left.value, right.value);
}

function rawYamlPropertyValuesEqual(left: RawYamlPropertyValue | undefined, right: RawYamlPropertyValue | undefined): boolean {
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((value, index) => Object.is(value, right[index]));
	}
	return Object.is(left, right);
}
