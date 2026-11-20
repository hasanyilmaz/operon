import type { IndexedTask } from '../types/fields';
import type { FilterFieldType, OperonSettings } from '../types/settings';
import type { AutomationAction } from './automation-rules';
import { EDITABLE_TASK_FIELD_KEYS } from './editable-task-fields';
import { getManagedCustomFieldOptionMapping, getManagedTaskFieldType } from './managed-task-fields';
import { classifyFilePropertyCell, decodeFilePropertyColumnKey, hasFileTaskDisplayTitleMapping, isWritableRawYamlPropertyName } from './raw-yaml-property';
import { getManagedYamlAliases, readYamlFields } from './yaml-fields';
import { parseListValue } from './parser';
import { parseTaskMediaReferenceList } from './task-media-reference';
import { normalizeTaskColorValue } from './task-color-value';
import { normalizeTaskIconValue } from './task-icon-value';
import { decodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { canonicalizeLocalDatetime } from './local-time';
import { parseRepeatRule } from './repeat-rule';
import { parseAbsoluteReminder, parseReminderRule } from './reminder-rules';
import type { TableFilePropertyQueryContext, TableFilePropertyField } from '../ui/table/table-file-property';

export type PlanValue = VaultPropertyValue;
export type Member = string | number;
export type ActionIssue = 'read-only' | 'invalid-value' | 'unsupported-source' | 'source-unavailable';
export type AutomationFieldSettings = Pick<OperonSettings, 'keyMappings' | 'fileTaskDisplayTitleEnabled'>;
export interface ActionField {
	type: FilterFieldType;
	native: boolean;
	before: PlanValue;
}
export interface AutomationFieldSource {
	settings: AutomationFieldSettings;
	getFrontmatter(task: IndexedTask): Record<string, unknown> | null;
	pins: ReadonlySet<string> | null;
	native?: TableFilePropertyQueryContext;
	nativeFields: ReadonlyMap<string, TableFilePropertyField>;
}

function scalar(raw: string, type: FilterFieldType): PlanValue {
	if (type === 'text') return raw;
	if (type !== 'number' && type !== 'date' && type !== 'datetime' && type !== 'checkbox') throw new Error('Unexpected field type');
	const value = decodeVaultPropertyValue(raw, type);
	return type === 'datetime' && typeof value === 'string' ? canonicalizeLocalDatetime(value) : value;
}

/** Resolve the source and its write capability before interpreting the action's literal. */
export function readAutomationField(task: IndexedTask, key: string, source: AutomationFieldSource): ActionField | ActionIssue {
	const { settings } = source;
	if (key.startsWith('file.property:')) {
		const name = decodeFilePropertyColumnKey(key);
		if (!name || !isWritableRawYamlPropertyName(name, settings.keyMappings)) return 'read-only';
		const field = source.nativeFields.get(key);
		if (!field || !source.native || field.unavailable) return 'source-unavailable';
		const cell = source.native.getCell(task, key);
		if (cell.readOnlyReason === 'unavailable' || cell.nativeState === undefined) return 'source-unavailable';
		if (cell.readOnlyReason === 'type-conflict') return 'source-unavailable';
		if (field.readonly || cell.nativeState !== 'ready') return 'read-only';
		const state = classifyFilePropertyCell(field, cell);
		if (state.kind === 'unsupported') return 'unsupported-source';
		const value = state.value ?? (field.type === 'list' || field.type === 'tags' ? [] : null);
		if (Array.isArray(value) && !value.every((item): item is Member => typeof item === 'number' || typeof item === 'string')) return 'unsupported-source';
		return { before: field.type === 'datetime' && typeof value === 'string' ? canonicalizeLocalDatetime(value) : value, type: field.type, native: true };
	}
	if (key === 'tags') return { before: task.tags, type: 'tags', native: false };
	if (key === 'pinned') return source.pins ? { before: source.pins.has(task.operonId), type: 'checkbox', native: false } : 'source-unavailable';
	if (key === 'checkbox') return { before: task.checkbox, type: 'text', native: false };
	if (key === 'description') return { before: task.description, type: 'text', native: false };
	const custom = getManagedCustomFieldOptionMapping(key, settings.keyMappings, { includeCheckbox: true });
	if (key === 'fileTaskDisplayTitle') {
		if (task.primary.format !== 'yaml' || !settings.fileTaskDisplayTitleEnabled || !hasFileTaskDisplayTitleMapping(settings.keyMappings)) return 'read-only';
	} else if (!EDITABLE_TASK_FIELD_KEYS.has(key) && !custom && key !== 'reminderDatetimes' && key !== 'reminderRules') return 'read-only';
	const type = getManagedTaskFieldType(key, settings.keyMappings);
	if (!type) return 'read-only';
	if (task.primary.format === 'yaml' && type === 'list') {
		const fm = source.getFrontmatter(task);
		if (!fm || readYamlFields(fm, settings.keyMappings).operonId !== task.operonId) return 'source-unavailable';
		const keys = getManagedYamlAliases(key, settings.keyMappings).filter(name => Object.prototype.hasOwnProperty.call(fm, name));
		if (keys.length > 1) return 'source-unavailable';
		const value: unknown = keys.length ? fm[keys[0]] : undefined;
		const items = Array.isArray(value) ? value : value == null ? [] : [value];
		if (!items.every(item => typeof item === 'string')) return 'unsupported-source';
		if (key !== 'taskGallery' && items.some(item => item.includes(';'))) return 'unsupported-source';
		if (Array.isArray(value)) return { before: [...items], type, native: false };
	}
	const raw = task.fieldValues[key] ?? '';
	try {
		const before = type === 'list' ? (key === 'taskGallery' ? parseTaskMediaReferenceList(raw) : parseListValue(raw)) : raw === '' ? null : scalar(raw, type);
		return { before, type, native: false };
	} catch {
		return 'source-unavailable';
	}
}

export function readActionLiteral(action: AutomationAction, field: ActionField): PlanValue {
	const { type } = field;
	if (type === 'list' || type === 'tags') {
		const raw = Array.isArray(action.value) ? action.value : [action.value];
		const values = field.native
			? raw.flatMap(value => decodeVaultPropertyValue(value, 'list') as Member[])
			: (Array.isArray(action.value) ? raw : raw.flatMap(value => parseListValue(value))).map(value => type === 'tags' ? value.replace(/^#/, '') : value);
		if (!values.length || values.some(value => value === '' || (action.field === 'reminderRules' && !parseReminderRule(String(value)).ok)
			|| (action.field === 'reminderDatetimes' && !parseAbsoluteReminder(String(value)).ok))) throw new Error('Invalid list literal');
		return [...new Set(values)];
	}
	if (typeof action.value !== 'string' || !action.value.trim()) throw new Error('Expected a value');
	const value = action.value.trim();
	if (action.field === 'checkbox' && !['open', 'done', 'cancelled'].includes(value)) throw new Error('Unknown checkbox state');
	if (action.field === 'repeat' && action.operation === 'add' && !parseRepeatRule(value)) throw new Error('Invalid recurrence');
	if (action.field === 'taskColor') return normalizeTaskColorValue(value);
	if (action.field === 'taskIcon') return normalizeTaskIconValue(value);
	return scalar(field.native && type === 'text' ? action.value : value, type);
}
