import type { IndexedTask } from '../types/fields';
import type { FilterFieldType, OperonSettings } from '../types/settings';
import type { AutomationAction } from './automation-rules';
import { EDITABLE_TASK_FIELD_KEYS } from './editable-task-fields';
import { getManagedCustomFieldOptionMapping, getManagedTaskFieldType } from './managed-task-fields';
import { classifyFilePropertyCell, decodeFilePropertyColumnKey, hasFileTaskDisplayTitleMapping, isWritableRawYamlPropertyName } from './raw-yaml-property';
import { getManagedYamlAliases, readYamlFields } from './yaml-fields';
import { resolveInlinePropertyDefinition } from './inline-property-definitions';
import { parseListValue } from './parser';
import { parseTaskMediaReferenceList } from './task-media-reference';
import { normalizeTaskColorValue } from './task-color-value';
import { normalizeTaskIconValue } from './task-icon-value';
import { decodeVaultPropertyList, decodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { addDays, addMonths, resolvePresetDay } from '../ui/field-pickers/date-nlp-fallback';
import { canonicalizeLocalDatetime, localToday, toLocalDate } from './local-time';
import { parseRepeatRule } from './repeat-rule';
import { parseAbsoluteReminder, parseReminderRule } from './reminder-rules';
import type { TableFilePropertyQueryContext, TableFilePropertyField } from '../ui/table/table-file-property';

export type PlanValue = VaultPropertyValue;
export type Member = string | number;
export type ActionIssue = 'read-only' | 'invalid-value' | 'unsupported-source' | 'source-unavailable' | 'ambiguous-property';
export type AutomationFieldSettings = Pick<OperonSettings, 'keyMappings' | 'inlinePropertyDefinitions' | 'fileTaskDisplayTitleEnabled'>;
export interface ActionField {
	type: FilterFieldType;
	native: boolean;
	typedList?: boolean;
	before: PlanValue;
}
export interface AutomationFieldSource {
	settings: AutomationFieldSettings;
	getInlineList(task: IndexedTask, name: string): Member[] | null;
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

/** Field-level capability shared by the rule editor and the per-task planner. */
export function managedAutomationFieldType(key: string, settings: AutomationFieldSettings): FilterFieldType | null {
	if (key === 'tags') return 'tags';
	if (key === 'pinned') return 'checkbox';
	if (key === 'checkbox' || key === 'description') return 'text';
	if (key === 'fileTaskDisplayTitle') {
		if (!settings.fileTaskDisplayTitleEnabled || !hasFileTaskDisplayTitleMapping(settings.keyMappings)) return null;
	} else if (!EDITABLE_TASK_FIELD_KEYS.has(key) && key !== 'reminderDatetimes' && key !== 'reminderRules'
		&& !getManagedCustomFieldOptionMapping(key, settings.keyMappings, { includeCheckbox: true })) return null;
	return getManagedTaskFieldType(key, settings.keyMappings);
}

export function automationTypedListMapping(key: string, settings: AutomationFieldSettings) {
	const mapping = getManagedCustomFieldOptionMapping(key, settings.keyMappings);
	if (mapping?.type !== 'list') return null;
	const definition = resolveInlinePropertyDefinition(mapping.visiblePropertyName, 'list', settings.keyMappings, settings.inlinePropertyDefinitions);
	return definition.encoding === 'vault-v1' ? mapping : null;
}

export function isAutomationNativeKeyWritable(key: string, settings: AutomationFieldSettings): boolean {
	const name = decodeFilePropertyColumnKey(key);
	return !!name && isWritableRawYamlPropertyName(name, settings.keyMappings, 'case-insensitive');
}

/** Resolve the source and its write capability before interpreting the action's literal. */
export function readAutomationField(task: IndexedTask, key: string, source: AutomationFieldSource): ActionField | ActionIssue {
	const { settings } = source;
	if (key.startsWith('file.property:')) {
		if (!isAutomationNativeKeyWritable(key, settings)) return 'read-only';
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
	if (key === 'fileTaskDisplayTitle' && task.primary.format !== 'yaml') return 'read-only';
	const type = managedAutomationFieldType(key, settings);
	if (!type) return 'read-only';
	const typedMapping = type === 'list' ? automationTypedListMapping(key, settings) : null;
	if (typedMapping && task.primary.format === 'inline') {
		const before = source.getInlineList(task, typedMapping.visiblePropertyName);
		return before ? { before, type, native: false, typedList: true } : 'source-unavailable';
	}
	let raw = task.fieldValues[key] ?? '';
	if (task.primary.format === 'yaml' && type === 'list') {
		const fm = source.getFrontmatter(task);
		if (!fm || readYamlFields(fm, settings.keyMappings).operonId !== task.operonId) return 'source-unavailable';
		const keys = getManagedYamlAliases(key, settings.keyMappings).filter(name => Object.prototype.hasOwnProperty.call(fm, name));
		if (keys.length > 1) return 'ambiguous-property';
		const value: unknown = keys.length ? fm[keys[0]] : undefined;
		const items = Array.isArray(value) ? value : value == null ? [] : [value];
		if (!items.every(item => typeof item === 'string')) return 'unsupported-source';
		if (key !== 'taskGallery' && items.some(item => item.includes(';'))) return 'unsupported-source';
		if (Array.isArray(value)) return { before: [...items], type, native: false, typedList: !!typedMapping };
		raw = items[0] ?? '';
	}
	try {
		const before = type === 'list' ? (key === 'taskGallery' ? parseTaskMediaReferenceList(raw) : parseListValue(raw)) : raw === '' ? null : scalar(raw, type);
		return { before, type, native: false, typedList: !!typedMapping };
	} catch {
		return 'source-unavailable';
	}
}

/** Untagged actions keep their original text-member semantics. */
export function readAutomationListMembers(action: AutomationAction, native: boolean): Member[] {
	if (action.valueEncoding === 'vault-v1') {
		if (typeof action.value !== 'string') throw new Error('Expected one encoded list member');
		const members = decodeVaultPropertyList(action.value);
		if (members.length !== 1) throw new Error('Expected one encoded list member');
		return members;
	}
	if (native) return (Array.isArray(action.value) ? action.value : [action.value]).flatMap(decodeVaultPropertyList);
	return Array.isArray(action.value) ? action.value : parseListValue(action.value);
}

// A language-independent day offset or weekend preset, optionally followed by a local wall time.
const RELATIVE_ACTION_DATE = /^([^@]+)(?:@((?:[01]\d|2[0-3]):[0-5]\d))?$/u;

function resolveRelativeActionDate(value: AutomationAction['value'], type: FilterFieldType, referenceDay: string): string {
	const match = typeof value === 'string' && RELATIVE_ACTION_DATE.exec(value);
	if (!match || (type !== 'date' && type !== 'datetime')) throw new Error('Invalid relative date action');
	const [, rule, time] = match;
	if ((type === 'datetime') !== !!time) throw new Error('Unexpected relative action time');
	const reference = new Date(referenceDay + 'T12:00:00');
	const shift = /^(days|offsetDays|weeks|months):(0|-?[1-9]\d*)$/u.exec(rule);
	let date: Date | undefined;
	if (shift) {
		const amount = Number(shift[2]);
		date = shift[1] === 'months' ? addMonths(reference, amount)
			: addDays(reference, shift[1] === 'weeks' ? amount * 7 : amount);
	} else {
		date = resolvePresetDay(rule, reference);
	}
	if (!date || !Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) throw new Error('Invalid relative date action');
	return toLocalDate(date) + (time ? 'T' + time + ':00' : '');
}

export function readActionLiteral(action: AutomationAction, field: Pick<ActionField, 'type' | 'native' | 'typedList'>, referenceDay?: string): PlanValue {
	const { type } = field;
	if (action.valueEncoding === 'relative-day-v1') return resolveRelativeActionDate(action.value, type, referenceDay ?? localToday());
	if (action.valueEncoding && !field.typedList) throw new Error('Expected a typed mapped list');
	if (type === 'list' || type === 'tags') {
		const members = readAutomationListMembers(action, field.native);
		const values = type === 'tags' && !field.native ? members.map(value => String(value).replace(/^#/, '')) : members;
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
