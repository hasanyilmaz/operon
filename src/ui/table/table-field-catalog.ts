import { getConfiguredKeyMappingIcon } from '../../core/key-mapping-icons';
import { getManagedCustomFieldMappings } from '../../core/managed-task-fields';
import { CANONICAL_KEYS, type ValueType } from '../../types/keys';
import { CHECKBOX_PROGRESS_COLUMN_KEY } from '../task-progress-tracks';
import {
	isRetiredKeyMapping,
	type FilterFieldType,
	type OperonSettings,
} from '../../types/settings';

export type TableTaskFieldGroup =
	| 'task'
	| 'workflow'
	| 'scheduling'
	| 'dependencies'
	| 'source'
	| 'identity'
	| 'custom';

export interface TableTaskField {
	key: string;
	label: string;
	type: FilterFieldType;
	group: TableTaskFieldGroup;
	icon: string;
	readonly: boolean;
	aliases: string[];
}

type TableTaskFieldCatalogSettings = Pick<OperonSettings, 'keyMappings'>;

const TABLE_FIELD_LABEL_OVERRIDES: Record<string, string> = {
	progress: 'Subtask Progress',
};

export const TABLE_EDITABLE_TASK_FIELD_KEYS = new Set([
	'description',
	'note',
	'status',
	'priority',
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'datetimeRepeatEnd',
	'estimate',
	'repeat',
	'parentTask',
	'blocking',
	'blockedBy',
	'assignees',
	'contexts',
	'tags',
	'links',
	'taskIcon',
	'taskColor',
	'location',
]);

const SYNTHETIC_TABLE_FIELDS: Array<Omit<TableTaskField, 'aliases'>> = [
	{ key: 'taskType', label: 'Task Type', type: 'text', group: 'source', icon: 'database', readonly: true },
	{ key: 'description', label: 'Task', type: 'text', group: 'task', icon: 'list-todo', readonly: false },
	{ key: 'checkbox', label: 'Checkbox', type: 'checkbox', group: 'workflow', icon: 'square-check-big', readonly: true },
	{ key: CHECKBOX_PROGRESS_COLUMN_KEY, label: 'Checkbox Progress', type: 'number', group: 'workflow', icon: 'list-checks', readonly: true },
	{ key: 'tags', label: 'Tags', type: 'tags', group: 'workflow', icon: 'hash', readonly: false },
	{ key: 'source', label: 'Source', type: 'text', group: 'source', icon: 'file-search', readonly: true },
	{ key: 'sourcePath', label: 'Source path', type: 'text', group: 'source', icon: 'folder-input', readonly: true },
	{ key: 'sourceLine', label: 'Source line', type: 'number', group: 'source', icon: 'list-ordered', readonly: true },
	{ key: 'sourceFormat', label: 'Source format', type: 'text', group: 'source', icon: 'braces', readonly: true },
	{ key: 'file.name', label: 'File name', type: 'text', group: 'source', icon: 'file-text', readonly: true },
	{ key: 'file.basename', label: 'File basename', type: 'text', group: 'source', icon: 'file', readonly: true },
	{ key: 'file.path', label: 'File path', type: 'text', group: 'source', icon: 'folder-tree', readonly: true },
	{ key: 'file.folder', label: 'File folder', type: 'text', group: 'source', icon: 'folder', readonly: true },
];

interface TableTaskFieldCatalogCacheEntry {
	keyMappings: TableTaskFieldCatalogSettings['keyMappings'];
	catalog: TableTaskField[];
	fieldByKey: Map<string, TableTaskField>;
	aliasToKey: Map<string, string>;
}

let tableTaskFieldCatalogCache: TableTaskFieldCatalogCacheEntry | null = null;

// Building the catalog walks CANONICAL_KEYS × keyMappings and its callers sit on
// per-cell render paths (labels, editability, key normalization), so the result is
// memoized by keyMappings identity — every settings write path replaces that array
// wholesale, never mutates it in place.
function resolveTableTaskFieldCatalog(settings: TableTaskFieldCatalogSettings): TableTaskFieldCatalogCacheEntry {
	if (tableTaskFieldCatalogCache && tableTaskFieldCatalogCache.keyMappings === settings.keyMappings) {
		return tableTaskFieldCatalogCache;
	}
	const catalog = buildTableTaskFieldCatalogUncached(settings);
	const fieldByKey = new Map(catalog.map(field => [field.key, field] as const));
	const aliasToKey = new Map<string, string>();
	for (const field of catalog) {
		for (const alias of field.aliases) {
			const normalizedAlias = normalizeAlias(alias);
			if (!aliasToKey.has(normalizedAlias)) {
				aliasToKey.set(normalizedAlias, field.key);
			}
		}
	}
	tableTaskFieldCatalogCache = { keyMappings: settings.keyMappings, catalog, fieldByKey, aliasToKey };
	return tableTaskFieldCatalogCache;
}

export function buildTableTaskFieldCatalog(settings: TableTaskFieldCatalogSettings): TableTaskField[] {
	return resolveTableTaskFieldCatalog(settings).catalog;
}

function buildTableTaskFieldCatalogUncached(settings: TableTaskFieldCatalogSettings): TableTaskField[] {
	const fields: TableTaskField[] = [];
	const seen = new Set<string>();
	const keyMappings = settings.keyMappings ?? [];

	for (const field of SYNTHETIC_TABLE_FIELDS) {
		addField(fields, seen, {
			...field,
			aliases: buildAliases(field.key, field.label),
		});
	}

	for (const canonical of CANONICAL_KEYS) {
		if (canonical.internal === true || isRetiredKeyMapping(canonical.name)) continue;
		const mapping = keyMappings.find(entry => entry.canonicalKey === canonical.name);
		const customLabel = mapping?.visiblePropertyName?.trim();
		const label = customLabel && normalizeAlias(customLabel) !== normalizeAlias(canonical.name)
			? customLabel
			: TABLE_FIELD_LABEL_OVERRIDES[canonical.name] || canonical.name;
		addField(fields, seen, {
			key: canonical.name,
			label,
			type: toFilterFieldType(canonical.type),
			group: canonical.name === 'operonId' ? 'identity' : canonical.group === 'core' ? 'task' : canonical.group,
			icon: getConfiguredKeyMappingIcon(canonical.name, keyMappings) || getFallbackFieldIcon(canonical.name, canonical.type),
			readonly: canonical.sync === 'auto' || canonical.name === 'operonId',
			aliases: buildAliases(canonical.name, label, canonical.name === 'progress' ? ['Progress'] : []),
		});
	}

	for (const mapping of getManagedCustomFieldMappings(keyMappings, { includeCheckbox: true })) {
		const label = mapping.visiblePropertyName?.trim() || mapping.canonicalKey;
		addField(fields, seen, {
			key: mapping.canonicalKey,
			label,
			type: toFilterFieldType(mapping.type),
			group: 'custom',
			icon: getConfiguredKeyMappingIcon(mapping.canonicalKey, keyMappings) || getFallbackFieldIcon(mapping.canonicalKey, mapping.type),
			readonly: false,
			aliases: buildAliases(mapping.canonicalKey, label),
		});
	}

	return fields;
}

export function getTableTaskField(
	key: string,
	settings: TableTaskFieldCatalogSettings,
): TableTaskField | null {
	const entry = resolveTableTaskFieldCatalog(settings);
	const raw = key?.trim();
	if (!raw) return null;
	const normalizedKey = entry.aliasToKey.get(normalizeAlias(raw));
	if (!normalizedKey) return null;
	return entry.fieldByKey.get(normalizedKey) ?? null;
}

export function normalizeTableTaskFieldKey(
	value: string | null | undefined,
	settings: TableTaskFieldCatalogSettings,
): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	return resolveTableTaskFieldCatalog(settings).aliasToKey.get(normalizeAlias(raw)) ?? null;
}

export function normalizeTableTaskFieldKeys(
	values: readonly string[],
	settings: TableTaskFieldCatalogSettings,
): { keys: string[]; unsupported: string[] } {
	const keys: string[] = [];
	const unsupported: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const key = normalizeTableTaskFieldKey(value, settings);
		if (!key) {
			unsupported.push(value);
			continue;
		}
		if (seen.has(key)) continue;
		seen.add(key);
		keys.push(key);
	}
	return { keys, unsupported };
}

export function getTableTaskFieldLabel(key: string, settings: TableTaskFieldCatalogSettings): string {
	return getTableTaskField(key, settings)?.label ?? key;
}

export function isEditableTableTaskFieldKey(key: string, settings: TableTaskFieldCatalogSettings): boolean {
	if (TABLE_EDITABLE_TASK_FIELD_KEYS.has(key)) return true;
	const field = getTableTaskField(key, settings);
	return field?.group === 'custom' && field.readonly === false && field.type !== 'checkbox';
}

function addField(fields: TableTaskField[], seen: Set<string>, field: TableTaskField): void {
	if (seen.has(field.key)) return;
	seen.add(field.key);
	fields.push(field);
}

function buildAliases(key: string, label: string, extras: string[] = []): string[] {
	const aliases = new Set<string>([
		key,
		label,
		`note.${key}`,
		`note.${label}`,
		...extras,
		...extras.map(extra => `note.${extra}`),
	]);
	if (key.startsWith('file.')) aliases.add(key);
	return [...aliases].filter(alias => alias.trim().length > 0);
}

function normalizeAlias(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function toFilterFieldType(type: ValueType): FilterFieldType {
	switch (type) {
		case 'number':
			return 'number';
		case 'date':
			return 'date';
		case 'datetime':
			return 'datetime';
		case 'checkbox':
			return 'checkbox';
		case 'list':
			return 'list';
		case 'text':
		default:
			return 'text';
	}
}

function getFallbackFieldIcon(key: string, type: ValueType): string {
	switch (key) {
		case 'status':
			return 'circle-dot';
		case 'priority':
			return 'flag';
		case 'parentTask':
			return 'git-branch';
		case 'estimate':
		case 'duration':
		case 'totalEstimate':
		case 'totalDuration':
			return 'timer';
		case 'dateDue':
		case 'dateScheduled':
		case 'dateStarted':
		case 'dateCompleted':
		case 'dateCancelled':
			return 'calendar';
		case 'contexts':
			return 'at-sign';
		case 'assignees':
			return 'user';
		case 'links':
			return 'link';
		default:
			break;
	}
	switch (type) {
		case 'number':
			return 'hash';
		case 'date':
		case 'datetime':
			return 'calendar';
		case 'checkbox':
			return 'square-check-big';
		case 'list':
		case 'text':
		default:
			return 'text';
	}
}
