import { kanbanListIsTyped } from './kanban-list-values';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import type { KanbanPreset } from '../types/kanban';
import { composeStatusValue } from '../types/pipeline';
import { localToday } from '../core/local-time';
import { parseListValue } from '../core/parser';
import { resolveKanbanAxes, normalizeKanbanAxisValue, kanbanAxisValueKey, type KanbanAxes, type KanbanAxisValue, type KanbanPropertyReference } from '../core/kanban-axis-model';
import type { createKanbanPropertyAccess, KanbanPropertyDescriptor, KanbanPropertyWriteTarget } from '../core/kanban-axis-properties';
import { decodeVaultPropertyList, encodeVaultPropertyValue, type VaultPropertyValue } from '../core/vault-property-codec';
import type { InlinePropertyChange } from '../core/inline-property-source';
import type { FileTaskPropertyChange } from '../core/file-task-property-draft';
import { KANBAN_NO_VALUE_KEY } from './kanban-query';
import type { KanbanWritebackDraft } from './kanban-writeback';

type Settings = Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines' | 'inlinePropertyDefinitions'>;
type Access = Pick<ReturnType<typeof createKanbanPropertyAccess>, 'resolve' | 'read'>;
export interface KanbanCellTarget { columns: KanbanAxisValue; swimlanes: KanbanAxisValue | null; }
export interface KanbanCellRequirement {
 field: KanbanPropertyDescriptor;
 values: KanbanAxisValue[];
 target?: KanbanPropertyWriteTarget;
 value: VaultPropertyValue;
}
export interface KanbanCellPlan {
 state: 'ready' | 'noop';
 payload: Record<string, string>;
 expectedFieldValues: Record<string, string>;
 inlinePropertyDraft: InlinePropertyChange[];
 filePropertyDraft: { changes: FileTaskPropertyChange[] };
 changedKeys: string[];
 requirements: KanbanCellRequirement[];
 seeds: { sourceName: string; value: VaultPropertyValue }[];
 nextDraft: KanbanWritebackDraft;
}
export type KanbanCellPlanResult = KanbanCellPlan | { state: 'blocked'; reason: string };
const equal = (a: KanbanAxisValue, b: KanbanAxisValue) => kanbanAxisValueKey(a) === kanbanAxisValueKey(b);
const managedValue = (task: IndexedTask, key: string) => key === '_tags' ? task.tags.join(';') : key === '_description' ? task.description : key === '_checkbox' ? task.checkbox : task.fieldValues[key] ?? '';
/** Preserve existing membership order and typed member identity. Never remove a source lane. */
export function mergeKanbanListValues(current: readonly (string | number)[], added: readonly (string | number)[]): (string | number)[] {
 return [...new Map([...current, ...added].map(value => [JSON.stringify([typeof value, value]), value])).values()];
}
export function buildKanbanCellPlan(input: { axes: KanbanAxes; target: KanbanCellTarget; task?: IndexedTask; access: Access; settings: Settings; today?: string }): KanbanCellPlanResult {
 const { axes, target, task, access, settings } = input;
 const groups = new Map<string, { field: KanbanPropertyDescriptor; values: KanbanAxisValue[] }>();
 for (const [axis, raw] of [[axes.columns, target.columns], [axes.swimlanes, target.swimlanes]] as const) {
  if (!axis) { if (raw !== null) return { state: 'blocked', reason: 'unexpected-row' }; continue; }
  if (!raw) return { state: 'blocked', reason: 'missing-target' };
  const reference: KanbanPropertyReference = axis.kind === 'status' ? { source: 'managed', key: 'status', type: 'text' } : axis.property;
  const resolved = access.resolve(reference);
  if (!resolved.ok) return { state: 'blocked', reason: resolved.reason };
  const field = resolved.field;
  let value: KanbanAxisValue | null;
  if (axis.kind === 'status') {
   const pipelines = settings.pipelines.filter(p => p.id === axis.pipelineId);
   if (raw.kind !== 'status' || raw.pipelineId !== axis.pipelineId || pipelines.length !== 1 || pipelines[0].statuses.filter(s => s.id === raw.id).length !== 1)
    return { state: 'blocked', reason: 'status-unavailable' };
   value = raw;
  } else {
   if (field.reference.key === 'status' && field.reference.source === 'managed') return { state: 'blocked', reason: 'status-axis-required' };
   value = normalizeKanbanAxisValue(raw, field.reference);
   if (!value || axis.values.length && !axis.values.some(v => equal(v, value!))) return { state: 'blocked', reason: 'target-not-selected' };
   if (value.kind === 'priority' && settings.priorities.filter(p => p.id === (value as { id: string }).id).length !== 1) return { state: 'blocked', reason: 'priority-unavailable' };
  }
  const group = groups.get(field.identity) ?? { field, values: [] };
  if (!group.values.some(v => equal(v, value))) group.values.push(value);
  groups.set(field.identity, group);
 }
 const plan: KanbanCellPlan = { state: 'noop', payload: {}, expectedFieldValues: {}, inlinePropertyDraft: [], filePropertyDraft: { changes: [] }, changedKeys: [], requirements: [], seeds: [],
  nextDraft: { description: task?.description ?? '', checkbox: task?.checkbox ?? 'open', fieldValues: { ...task?.fieldValues }, tags: [...task?.tags ?? []] } };
 for (const { field, values } of groups.values()) {
  const ref = field.reference, empty = values.some(v => v.kind === 'empty');
  if (values.length > 1 && (ref.type !== 'list' || empty)) return { state: 'blocked', reason: 'conflicting-axis-targets' };
  const read = task ? access.read(task, ref) : null;
  if (read && read.state !== 'ready' && read.state !== 'empty') return { state: 'blocked', reason: 'reason' in read ? read.reason : 'unavailable' };
  const current = read && 'target' in read ? read : null;
  if (ref.type === 'list' && empty && current?.state === 'ready') return { state: 'blocked', reason: 'list-clear-not-allowed' };
  let value: VaultPropertyValue;
  const first = values[0];
  if (ref.type === 'list') {
   const before = current?.target.expected.value;
   value = mergeKanbanListValues(Array.isArray(before) ? before : [], values.flatMap(v => v.kind === 'value' && typeof v.value !== 'boolean' ? [v.value] : []));
  } else if (first.kind === 'status') {
   const pipeline = settings.pipelines.find(p => p.id === first.pipelineId)!;
   value = composeStatusValue(pipeline.name, pipeline.statuses.find(s => s.id === first.id)!.label);
  } else if (first.kind === 'priority') value = settings.priorities.find(p => p.id === first.id)!.label;
  else value = first.kind === 'empty' ? (ref.type === 'text' ? '' : null) : first.value;
  const requirement: KanbanCellRequirement = { field, values, value, ...(current ? { target: current.target } : {}) };
  plan.requirements.push(requirement);
  plan.seeds.push({ sourceName: field.reference.source === 'managed' ? ref.key : field.label, value });
  const matches = current && values.every(v => current.values.some(c => equal(c, v)));
  const key = ref.key === 'tags' && ref.source === 'managed' ? '_tags' : ref.key === 'description' && ref.source === 'managed' ? '_description' : ref.key;
  let serialized = empty ? '' : encodeVaultPropertyValue(value, ref.type);
  if (field.encoding === 'legacy') {
   if (ref.type === 'list') {
    // Legacy fields have no quoting grammar. Reject lossy values instead of splitting an individual member.
    serialized = (value as (string | number)[]).map(item => String(item).replace(/;/g, '\\;')).join('; ');
    if (JSON.stringify(parseListValue(serialized)) !== JSON.stringify(value)) return { state: 'blocked', reason: 'unrepresentable-legacy-list' };
   } else if (ref.type === 'text') serialized = String(value ?? '');
   if (!matches) plan.payload[key] = serialized;
   if (task) plan.expectedFieldValues[key] = managedValue(task, key);
  } else if (current) {
   const sourceName = current.target.sourceName;
   if (task?.primary.format === 'inline') plan.inlinePropertyDraft.push({ sourceName, type: ref.type,
    expected: { present: current.target.expected.present, rawValue: current.target.expected.rawValue }, mutation: empty ? { kind: 'remove' } : { kind: 'set', value } });
   else plan.filePropertyDraft.changes.push({ propertyName: sourceName, nativeType: ref.type,
    expected: { present: current.target.expected.present, value: current.target.expected.value }, value: empty ? null : value, remove: empty });
  }
  if (key === '_tags') plan.nextDraft.tags = (value as (string | number)[]).map(String);
  else if (key === '_description') plan.nextDraft.description = serialized;
  else plan.nextDraft.fieldValues[ref.key] = serialized;
  if (!matches) plan.state = 'ready';
  if (first.kind === 'status' && !matches) {
   const status = settings.pipelines.find(p => p.id === first.pipelineId)!.statuses.find(s => s.id === first.id)!;
   const checkbox = status.isFinished ? 'done' : status.isCancelled ? 'cancelled' : 'open';
   plan.payload._checkbox = checkbox; plan.nextDraft.checkbox = checkbox;
   for (const k of ['_checkbox', 'dateCompleted', 'dateCancelled']) if (task && (k !== '_checkbox' || task.primary.format === 'inline')) plan.expectedFieldValues[k] = managedValue(task, k);
  }
 }
 const statusRequirement = plan.requirements.find(req => req.values[0].kind === 'status');
 if (statusRequirement) {
  const value = statusRequirement.values[0];
  if (value.kind !== 'status') return { state: 'blocked', reason: 'status-unavailable' };
  const status = settings.pipelines.find(p => p.id === value.pipelineId)!.statuses.find(s => s.id === value.id)!;
  for (const [key, active] of [['dateCompleted', !!status.isFinished], ['dateCancelled', !!status.isCancelled && !status.isFinished]] as const) {
   const requested = plan.requirements.find(req => req.field.reference.source === 'managed' && req.field.reference.key === key);
   if (requested && (active ? !requested.value : !!requested.value)) return { state: 'blocked', reason: 'domain-target-conflict' };
   if ('_checkbox' in plan.payload) plan.payload[key] = active ? String(requested?.value || task?.fieldValues[key] || input.today || localToday()) : '';
  }
 }
 // Status consequences may collide with an explicitly targeted date field. Reject before any write.
 for (const req of plan.requirements) {
  const ref = req.field.reference, key = ref.key === 'description' ? '_description' : ref.key === 'tags' ? '_tags' : ref.key;
  if (ref.source === 'managed' && req.field.encoding === 'legacy' && key in plan.payload && ref.type !== 'list') {
   const expected = req.value === null ? '' : String(req.value);
   if (plan.payload[key] !== expected) return { state: 'blocked', reason: 'domain-target-conflict' };
  }
 }
 Object.assign(plan.nextDraft.fieldValues, Object.fromEntries(Object.entries(plan.payload).filter(([key]) => !key.startsWith('_'))));
 plan.changedKeys = Object.keys(plan.payload);
 return plan;
}
/** Legacy view adapter only: all decisions still go through the typed planner. */
export function resolveLegacyKanbanCellTarget(preset: KanbanPreset, statusId: string, laneKey: string, settings: Settings): { axes: KanbanAxes; target: KanbanCellTarget } | null {
 const decoded = resolveKanbanAxes(preset, settings.keyMappings);
 if (!decoded.ok || decoded.axes.columns.kind !== 'status' || !decoded.axes.columns.pipelineId) return null;
 const lane = decoded.axes.swimlanes;
 if (lane?.kind === 'status') return null;
 let value: KanbanAxisValue | null = null;
 if (lane) {
  if (laneKey === KANBAN_NO_VALUE_KEY) value = { kind: 'empty' };
  else if (lane.property.key === 'priority') {
   const matches = settings.priorities.filter(p => p.label.trim().toLowerCase() === laneKey.trim().toLowerCase());
   if (matches.length !== 1) return null;
   value = { kind: 'priority', id: matches[0].id };
  } else {
   let raw: string | number | boolean = laneKey;
   const mapping = settings.keyMappings.find(m => m.canonicalKey === lane.property.key);
   try {
    if (lane.property.type === 'list' && kanbanListIsTyped(mapping, settings.keyMappings, settings.inlinePropertyDefinitions)) {
     const items = decodeVaultPropertyList(laneKey); if (items.length !== 1) return null; raw = items[0];
    }
   } catch { return null; }
   value = normalizeKanbanAxisValue({ kind: 'value', value: raw }, lane.property);
  }
  if (!value) return null;
 }
 return { axes: decoded.axes, target: { columns: { kind: 'status', pipelineId: decoded.axes.columns.pipelineId, id: statusId }, swimlanes: value } };
}

/** Guard field-rule normalization before any task/timer transaction commits. */
export function kanbanPayloadMatchesPlan(plan: KanbanCellPlan, task: IndexedTask, payload: Record<string, string>): boolean {
 return plan.requirements.every(req => {
  if (req.field.encoding !== 'legacy') return true;
  const ref = req.field.reference;
  const key = ref.key === 'tags' ? '_tags' : ref.key === 'description' ? '_description' : ref.key;
  const raw = payload[key] ?? managedValue(task, key);
  if (ref.type === 'list') return JSON.stringify(parseListValue(raw)) === JSON.stringify(req.value);
  if (ref.type === 'number') return req.value === null ? raw === '' : raw.trim() !== '' && Number(raw) === req.value;
  return raw === (req.value === null ? '' : String(req.value));
 });
}

/** Explicit No value must override templates/defaults rather than act as an absent surface hint. */
export function splitKanbanCreatorSeeds(seeds: KanbanCellPlan['seeds']) {
 const surface: KanbanCellPlan['seeds'] = [], user: KanbanCellPlan['seeds'] = [];
 for (const seed of seeds) {
  if (seed.sourceName === 'description') continue;
  const empty = seed.value === null || seed.value === '' || Array.isArray(seed.value) && seed.value.length === 0;
  (empty ? user : surface).push({ ...seed, value: Array.isArray(seed.value) ? [...seed.value] : seed.value });
 }
 return { surface, user };
}
