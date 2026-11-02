import type { IndexedTask } from '../types/fields';
import type { OperonSettings, KeyMapping } from '../types/settings';
import { CANONICAL_KEY_MAP } from '../types/keys';
import type { NativePropertyIndex } from '../indexer/native-property-index';
import { EDITABLE_TASK_FIELD_KEYS } from './editable-task-fields';
import { getManagedCustomFieldMappings } from './managed-task-fields';
import { resolveInlinePropertyDefinition } from './inline-property-definitions';
import { nativeEditorPropertyTypes } from './task-editor-native-properties';
import { decodeVaultPropertyValue, encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { parseListValue } from './parser';
import { normalizePriorityValue } from './priority-rank';
import { buildWorkflowStatusIdentityIndex, resolveConfiguredStatusIdentity } from './workflow-status-identity';
import { kanbanAxisValueKey, type KanbanAxisValue, type KanbanPropertyReference } from './kanban-axis-model';

type Settings = Pick<OperonSettings, 'keyMappings' | 'inlinePropertyDefinitions' | 'priorities' | 'pipelines'>;
type NativeIndex = Pick<NativePropertyIndex, 'getTypes' | 'getTask' | 'isReady' | 'getRevision'>;
export interface KanbanPropertyDescriptor {
	identity: string;
	reference: KanbanPropertyReference;
	label: string;
	aliases: readonly string[];
	encoding: 'legacy' | 'vault-v1';
}
export type KanbanPropertyResolution = { ok: true; field: KanbanPropertyDescriptor }
	| { ok: false; reason: 'missing-property' | 'type-conflict' | 'unsupported' };
export interface KanbanPropertyWriteTarget {
	property: KanbanPropertyReference;
	sourceFormat: IndexedTask['primary']['format'];
	sourceName: string;
	expected: { present: boolean; value: VaultPropertyValue | undefined; rawValue?: string };
	revision?: string;
}
export type KanbanPropertyRead =
	| { state: 'ready' | 'empty'; values: KanbanAxisValue[]; target: KanbanPropertyWriteTarget }
	| { state: 'pending' | 'unavailable'; reason: string };
const identity = (key: string): string => key.trim().toLowerCase();

/** A board-scoped reader over the shared index. It never scans, writes, or owns source data. */
export function createKanbanPropertyAccess(settings: Settings, native: NativeIndex) {
	const fields: KanbanPropertyDescriptor[] = [];
	const byAlias = new Map<string, KanbanPropertyDescriptor[]>();
	const mappings = settings.keyMappings;
	const declarations = native.getTypes();
	const nativeTypes = nativeEditorPropertyTypes(declarations, mappings, settings.inlinePropertyDefinitions);
	const add = (field: KanbanPropertyDescriptor) => {
		fields.push(field);
		for (const alias of new Set(field.aliases.map(identity))) byAlias.set(alias, [...(byAlias.get(alias) ?? []), field]);
	};
	const managed = (key: string, mapping?: KeyMapping) => {
		const type = mapping?.type ?? (key === 'tags' ? 'list' : key === 'description' ? 'text' : CANONICAL_KEY_MAP.get(key)?.type);
		if (!type) return;
		const label = mapping?.visiblePropertyName || key;
		let encoding: 'legacy' | 'vault-v1' = 'legacy';
		try { if (mapping?.isSystem === false) encoding = resolveInlinePropertyDefinition(label, type, mappings, settings.inlinePropertyDefinitions).encoding; }
		catch { return; }
		add({ identity: `managed:${key}`, reference: { source: 'managed', key, type }, label,
			aliases: [key, label], encoding });
	};
	for (const key of EDITABLE_TASK_FIELD_KEYS) {
		if (CANONICAL_KEY_MAP.get(key)?.internal) continue;
		const mapping = mappings.find(entry => entry.canonicalKey === key);
		if (mapping?.isSystem === false) continue;
		managed(key, mapping);
	}
	for (const mapping of getManagedCustomFieldMappings(mappings, { includeCheckbox: true })) managed(mapping.canonicalKey, mapping);
	for (const [key, type] of Object.entries(nativeTypes)) {
		// Ownership stays with the managed identity even when native encoding is used.
		if (mappings.some(mapping => [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => identity(alias) === identity(key)))
			|| byAlias.has(identity(key))) continue;
		add({ identity: `native:${identity(key)}`, reference: { source: 'native', key, type }, label: key, aliases: [key], encoding: 'vault-v1' });
	}
	const statusIndex = buildWorkflowStatusIdentityIndex(settings.pipelines);
	const resolve = (reference: KanbanPropertyReference): KanbanPropertyResolution => {
		const owners = mappings.filter(mapping => [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => identity(alias) === identity(reference.key)));
		const candidates = reference.source === 'managed'
			? fields.filter(field => field.reference.source === 'managed' && field.reference.key === reference.key)
			: byAlias.get(identity(reference.key)) ?? [];
		if (owners.length > 1 || candidates.length > 1) return { ok: false, reason: 'type-conflict' };
		const field = candidates[0];
		if (!field) return { ok: false, reason: owners.length ? 'unsupported' : 'missing-property' };
		if (reference.source === 'managed' && field.reference.source !== 'managed') return { ok: false, reason: 'missing-property' };
		if (reference.type !== field.reference.type) return { ok: false, reason: 'type-conflict' };
		const assigned = Object.entries(declarations).filter(([key]) => field.aliases.some(alias => identity(alias) === identity(key)));
		if (assigned.some(([, type]) => (type === 'multitext' || type === 'tags' && field.reference.key === 'tags' ? 'list' : type) !== reference.type)
			|| assigned.some(([key], i) => assigned.some(([other], j) => i !== j && identity(key) === identity(other)))) return { ok: false, reason: 'type-conflict' };
		return { ok: true, field };
	};
	const read = (task: IndexedTask, reference: KanbanPropertyReference): KanbanPropertyRead => {
		const resolved = resolve(reference);
		if (!resolved.ok) return { state: 'unavailable', reason: resolved.reason };
		const field = resolved.field;
		let value: VaultPropertyValue | undefined;
		let rawValue: string | undefined;
		let present = false;
		let sourceName = field.label;
		let revision: string | undefined;
		try {
			if (field.encoding === 'vault-v1') {
				if (!native.isReady([task])) return { state: 'pending', reason: 'index-not-ready' };
				const row = native.getTask(task);
				if (!row.available) return { state: 'unavailable', reason: 'source-unavailable' };
				const properties = [...new Set(field.aliases.flatMap(alias => { const property = row.properties.get(identity(alias)); return property ? [property] : []; }))];
				if (properties.length > 1) return { state: 'unavailable', reason: 'type-conflict' };
				const property = properties[0];
				if (property?.reason || property?.type && property.type !== reference.type) return { state: 'unavailable', reason: property?.reason ?? 'type-conflict' };
				value = property?.value as VaultPropertyValue | undefined;
				present = property?.present ?? false;
				rawValue = property?.inline?.rawValue;
				sourceName = property?.sourceName ?? sourceName;
				revision = row.revision;
			} else {
				const key = field.reference.key;
				rawValue = key === 'description' ? task.description : task.fieldValues[key];
				present = key === 'tags' ? task.tags.length > 0 : rawValue !== undefined;
				value = key === 'tags' ? [...task.tags] : reference.type === 'list' ? parseListValue(rawValue ?? '')
					: reference.type === 'text' ? rawValue ?? '' : decodeVaultPropertyValue(rawValue ?? '', reference.type);
			}
			if (value !== undefined && value !== null) encodeVaultPropertyValue(value, reference.type);
			const target: KanbanPropertyWriteTarget = { property: { ...field.reference }, sourceFormat: task.primary.format, sourceName,
				expected: { present, value: Array.isArray(value) ? [...value] : value, rawValue }, revision };
			if (!present || value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0)
				return { state: 'empty', values: [{ kind: 'empty' }], target };
			if (field.reference.source === 'managed' && field.reference.key === 'status') {
				const status = resolveConfiguredStatusIdentity(String(value), statusIndex);
				if (status.kind !== 'configured') return { state: 'unavailable', reason: 'unresolved-status' };
				return { state: 'ready', values: [{ kind: 'status', pipelineId: status.pipeline.id, id: status.status.id }], target };
			}
			if (field.reference.source === 'managed' && field.reference.key === 'priority') {
				const matches = settings.priorities.filter(priority => normalizePriorityValue(priority.label) === normalizePriorityValue(String(value)));
				if (matches.length !== 1) return { state: 'unavailable', reason: 'unresolved-priority' };
				return { state: 'ready', values: [{ kind: 'priority', id: matches[0].id }], target };
			}
			const values: KanbanAxisValue[] = (Array.isArray(value) ? value : [value]).map(item => ({ kind: 'value', value: item }));
			return { state: 'ready', values: [...new Map(values.map(item => [kanbanAxisValueKey(item), item])).values()], target };
		} catch { return { state: 'unavailable', reason: 'type-conflict' }; }
	};
	return { fields: fields.filter(field => resolve(field.reference).ok), resolve, read, revision: native.getRevision(), getCurrentRevision: () => native.getRevision() };
}
