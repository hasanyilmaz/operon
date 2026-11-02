import type { KanbanPreset, KanbanSwimlaneBy } from '../types/kanban';
import { CANONICAL_KEY_MAP, type ValueType } from '../types/keys';
import type { KeyMapping } from '../types/settings';
import { decodeVaultPropertyValue, encodeVaultPropertyValue } from './vault-property-codec';

export interface KanbanPropertyReference {
	source: 'managed' | 'native';
	key: string;
	type: ValueType;
}
export type KanbanAxisValue = { kind: 'empty' } | { kind: 'value'; value: string | number | boolean } | { kind: 'priority'; id: string } | { kind: 'status'; pipelineId: string; id: string };
export type KanbanAxis = { kind: 'status'; pipelineId: string | null }
	| { kind: 'property'; property: KanbanPropertyReference; values: KanbanAxisValue[] };
export interface KanbanAxes { version: 1; columns: KanbanAxis; swimlanes: KanbanAxis | null; inactiveSwimlanes?: KanbanAxis; }
export type KanbanAxesResult = { ok: true; axes: KanbanAxes } | { ok: false; reason: 'invalid' | 'future-version' | 'missing-property' };
const TYPES: readonly string[] = ['text', 'number', 'date', 'datetime', 'checkbox', 'list'];
const LEGACY_FIELDS: Readonly<Record<string, ValueType>> = {
	priority: 'text', tags: 'list', contexts: 'list', assignees: 'list', dateDue: 'date', dateScheduled: 'date',
};
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
	return Object.keys(value).every(key => allowed.includes(key));
}
function name(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\r\n]/u.test(value);
}
export function cloneKanbanAxesPayload(value: unknown): unknown {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}
export function kanbanAxisValueKey(value: KanbanAxisValue): string {
	return value.kind === 'value' ? JSON.stringify(['value', typeof value.value, value.value])
		: value.kind === 'priority' ? JSON.stringify(['priority', value.id])
		: value.kind === 'status' ? JSON.stringify(['status', value.pipelineId, value.id]) : '["empty"]';
}
export function normalizeKanbanAxisValue(raw: unknown, property: KanbanPropertyReference): KanbanAxisValue | null {
	if (!record(raw)) return null;
	if (raw.kind === 'empty' && keys(raw, ['kind'])) return { kind: 'empty' };
	if (property.source === 'managed' && property.key === 'priority') {
		return raw.kind === 'priority' && keys(raw, ['kind', 'id']) && name(raw.id) ? { kind: 'priority', id: raw.id } : null;
	}
	if (raw.kind !== 'value' || !keys(raw, ['kind', 'value'])) return null;
	let value = raw.value;
	try {
		if (property.type === 'number' && typeof value === 'string') value = decodeVaultPropertyValue(value, 'number');
		if (property.type === 'list') {
			if (typeof value !== 'string' && typeof value !== 'number') return null;
			encodeVaultPropertyValue([value], 'list');
		} else {
			if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
			encodeVaultPropertyValue(value, property.type);
			if (property.type === 'text' && value === '') return null;
		}
		if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
		return { kind: 'value', value: typeof value === 'number' && Object.is(value, -0) ? 0 : value };
	} catch { return null; }
}
function decodeAxis(raw: unknown): KanbanAxis | null {
	if (!record(raw)) return null;
	if (raw.kind === 'status') return keys(raw, ['kind', 'pipelineId']) && (raw.pipelineId === null || name(raw.pipelineId))
		? { kind: 'status', pipelineId: raw.pipelineId } : null;
	if (raw.kind !== 'property' || !keys(raw, ['kind', 'property', 'values']) || !record(raw.property) || !Array.isArray(raw.values)) return null;
	const ref = raw.property;
	if (!keys(ref, ['source', 'key', 'type']) || (ref.source !== 'managed' && ref.source !== 'native')
		|| !name(ref.key) || typeof ref.type !== 'string' || !TYPES.includes(ref.type)
		|| ref.source === 'managed' && ref.key === 'status') return null;
	const property: KanbanPropertyReference = { source: ref.source, key: ref.key, type: ref.type as ValueType };
	const values: KanbanAxisValue[] = [];
	const seen = new Set<string>();
	for (const entry of raw.values) {
		const value = normalizeKanbanAxisValue(entry, property);
		if (!value) return null;
		const key = kanbanAxisValueKey(value);
		if (!seen.has(key)) { seen.add(key); values.push(value); }
	}
	return { kind: 'property', property, values };
}
export function decodeKanbanAxes(raw: unknown): KanbanAxesResult {
	if (!record(raw)) return { ok: false, reason: 'invalid' };
	if (typeof raw.version === 'number' && raw.version > 1) return { ok: false, reason: 'future-version' };
	if (raw.version !== 1 || !keys(raw, ['version', 'columns', 'swimlanes', 'inactiveSwimlanes'])) return { ok: false, reason: 'invalid' };
	const columns = decodeAxis(raw.columns);
	const swimlanes = raw.swimlanes === null ? null : decodeAxis(raw.swimlanes);
	const inactiveSwimlanes = raw.inactiveSwimlanes === undefined ? undefined : decodeAxis(raw.inactiveSwimlanes);
	return !columns || raw.swimlanes !== null && !swimlanes
		|| raw.inactiveSwimlanes !== undefined && (!inactiveSwimlanes || swimlanes !== null)
		? { ok: false, reason: 'invalid' } : { ok: true, axes: { version: 1, columns, swimlanes, ...(inactiveSwimlanes ? { inactiveSwimlanes } : {}) } };
}
/** Does not add an axes envelope to legacy settings or cause persistence. */
export function resolveKanbanAxes(preset: KanbanPreset, mappings: readonly KeyMapping[] = []): KanbanAxesResult {
	if (preset.axes !== undefined) return decodeKanbanAxes(preset.axes);
	let swimlanes: KanbanAxis | null = null;
	if (preset.swimlaneBy !== null) {
		const type = legacyFieldType(preset.swimlaneBy, mappings);
		if (!type) return { ok: false, reason: 'missing-property' };
		swimlanes = { kind: 'property', property: { source: 'managed', key: preset.swimlaneBy, type }, values: [] };
	}
	return { ok: true, axes: { version: 1, columns: { kind: 'status', pipelineId: preset.pipelineId }, swimlanes } };
}
function legacyFieldType(key: string, mappings: readonly KeyMapping[]): ValueType | null {
	return (Object.prototype.hasOwnProperty.call(LEGACY_FIELDS, key) ? LEGACY_FIELDS[key] : undefined) ?? mappings.find(mapping => mapping.canonicalKey === key && mapping.isSystem === false && !mapping.isInternal)?.type ?? null;
}
/** Stage 1 gate: generic or selected-value axes must never render through stale legacy fields. */
export function projectKanbanLegacyAxes(preset: KanbanPreset, mappings: readonly KeyMapping[] = []):
	{ ok: true; pipelineId: string | null; swimlaneBy: KanbanSwimlaneBy | null } | { ok: false } {
	if (preset.axes === undefined) return { ok: true, pipelineId: preset.pipelineId, swimlaneBy: preset.swimlaneBy };
	const result = decodeKanbanAxes(preset.axes);
	if (!result.ok || result.axes.columns.kind !== 'status') return { ok: false };
	const lane = result.axes.swimlanes;
	if (lane && (lane.kind !== 'property' || lane.property.source !== 'managed' || lane.values.length !== 0
		|| lane.property.type === 'checkbox' || legacyFieldType(lane.property.key, mappings) !== lane.property.type)) return { ok: false };
	return { ok: true, pipelineId: result.axes.columns.pipelineId, swimlaneBy: lane?.kind === 'property' ? lane.property.key : null };
}
export function updateKanbanLegacyAxes(preset: KanbanPreset, patch: { pipelineId?: string | null; swimlaneBy?: KanbanSwimlaneBy | null }, mappings: readonly KeyMapping[]): void {
	const projection = projectKanbanLegacyAxes(preset, mappings);
	if (!projection.ok) throw new Error('This Kanban axis configuration cannot be edited by the current controls');
	const next = { ...projection, ...patch };
	if (preset.axes !== undefined) {
		const previous = decodeKanbanAxes(preset.axes);
		const resolved = resolveKanbanAxes({ ...preset, axes: undefined, pipelineId: next.pipelineId, swimlaneBy: next.swimlaneBy }, mappings);
		if (!resolved.ok) throw new Error('Kanban property is unavailable');
		if (!resolved.axes.swimlanes && previous.ok && previous.axes.inactiveSwimlanes) resolved.axes.inactiveSwimlanes = previous.axes.inactiveSwimlanes;
		preset.axes = resolved.axes;
	}
	preset.pipelineId = next.pipelineId;
	preset.swimlaneBy = next.swimlaneBy;
}
export function kanbanPresetReferencesManagedField(preset: KanbanPreset, key: string): boolean {
	const result = decodeKanbanAxes(preset.axes);
	return result.ok && [result.axes.columns, result.axes.swimlanes, result.axes.inactiveSwimlanes].some(axis => axis?.kind === 'property'
		&& axis.property.source === 'managed' && axis.property.key === key);
}
export function assertKanbanAxesWritable(presets: readonly KanbanPreset[]): void {
	for (const preset of presets) if (preset.axes !== undefined && !decodeKanbanAxes(preset.axes).ok)
		throw new Error('Unsupported or invalid Kanban axes; original settings must be preserved');
}
export function kanbanManagedReferenceType(key: string, mappings: readonly KeyMapping[]): ValueType | null {
	return mappings.find(mapping => mapping.canonicalKey === key)?.type ?? (key === 'tags' ? 'list' : key === 'description' ? 'text' : CANONICAL_KEY_MAP.get(key)?.type ?? null);
}

/** Explicit draft/save operation; readers must use resolveKanbanAxes instead. */
export function setKanbanPresetAxes(preset: KanbanPreset, axes: KanbanAxes, mappings: readonly KeyMapping[]): void {
	preset.axes = cloneKanbanAxesPayload(axes);
	const projection = projectKanbanLegacyAxes(preset, mappings);
	preset.pipelineId = projection.ok ? projection.pipelineId : null;
	preset.swimlaneBy = projection.ok ? projection.swimlaneBy : null;
}
