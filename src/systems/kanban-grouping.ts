import { getTimeScopeSignature } from '../core/time-scope-values';
import type { IndexedTask } from '../types/fields';
import type { FilterSet, OperonSettings } from '../types/settings';
import type { KanbanPreset } from '../types/kanban';
import { resolveKanbanEffectiveSorting } from '../types/kanban';
import { filterTasksForDisplay, type FilterEvaluationOptions } from '../core/filter-display';
import { resolveKanbanAxes, normalizeKanbanAxisValue, kanbanAxisValueKey, type KanbanAxis, type KanbanAxisValue, type KanbanPropertyReference } from '../core/kanban-axis-model';
import type { createKanbanPropertyAccess, KanbanPropertyRead } from '../core/kanban-axis-properties';
import { buildKanbanTaskComparator, applyManualKanbanTaskOrder, getKanbanNoValueLabel } from './kanban-query';
import { buildTaskSearchMatcher } from './task-search';
import type { PinnedCache } from '../storage/pinned-cache';
import type { ProjectSerialDisplay } from '../core/project-serials';

type PropertyAccess = Pick<ReturnType<typeof createKanbanPropertyAccess>, 'resolve' | 'read' | 'revision' | 'getCurrentRevision'>;
type Settings = Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines'>;
export interface KanbanGroupHeader {
	readonly key: string;
	readonly value: Readonly<KanbanAxisValue> | null;
	readonly label: string;
	readonly color: string | null;
	readonly count: number;
}
export interface KanbanGroupingDiagnostic {
	readonly taskId: string;
	readonly axis: 'columns' | 'rows' | 'both';
	readonly state: 'pending' | 'unavailable';
	readonly reason: string;
}
export interface KanbanGroupingSnapshot {
	readonly state: 'ready' | 'partial';
	readonly countsComplete: boolean;
	readonly revision: Readonly<{ tasks: string | number; settings: string | number; native: number }>;
	readonly columns: readonly KanbanGroupHeader[];
	readonly rows: readonly KanbanGroupHeader[];
	readonly rowAxisHidden: boolean;
	readonly total: number;
	readonly diagnostics: readonly KanbanGroupingDiagnostic[];
	/** Memberships contain only tasks contributing to this snapshot's displayed totals. */
	readonly columnMembers: ReadonlyMap<string, ReadonlySet<string>>;
	readonly rowMembers: ReadonlyMap<string, ReadonlySet<string>>;
	getTask(taskId: string): IndexedTask | undefined;
	getCellCount(columnKey: string, rowKey: string): number;
	getCellTaskIds(columnKey: string, rowKey: string, manualOrderIds?: readonly string[]): string[];
}
export type KanbanGroupingResult = KanbanGroupingSnapshot | {
	readonly state: 'unavailable';
	readonly reason: string;
	readonly axis: 'columns' | 'rows' | 'both';
};
export interface KanbanGroupingOptions {
	preset: KanbanPreset;
	settings: Settings;
	tasks: readonly IndexedTask[];
	propertyAccess: PropertyAccess;
	revision: { tasks: string | number; settings: string | number };
	filterSet?: FilterSet | null;
	filterEvaluationOptions?: FilterEvaluationOptions;
	pinnedCache?: PinnedCache | null;
	searchQuery?: string | null;
	taskIdFilter?: Iterable<string>;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}
interface AxisPlan {
	identity: string;
	property: KanbanPropertyReference | null;
	fixed: KanbanAxisValue[] | null;
	type: KanbanPropertyReference['type'] | null;
	priority: boolean;
	metadata: Map<string, { label: string; color: string | null }>;
	status: boolean;
}
const HIDDEN_ROW_KEY = JSON.stringify(['hidden-row']);
export function buildKanbanGroupingCellKey(columnKey: string, rowKey: string): string {
	return JSON.stringify([columnKey, rowKey]);
}
function groupKey(axis: AxisPlan, value: KanbanAxisValue): string {
	return JSON.stringify([axis.identity, kanbanAxisValueKey(value)]);
}
function prepareAxis(axis: KanbanAxis | null, options: KanbanGroupingOptions): AxisPlan | string {
	if (!axis) return { identity: 'hidden-row', property: null, fixed: [], type: null, priority: false, metadata: new Map(), status: false };
	const metadata = new Map<string, { label: string; color: string | null }>();
	if (axis.kind === 'status') {
		if (!axis.pipelineId) return 'pipeline-not-selected';
		const matches = options.settings.pipelines.filter(pipeline => pipeline.id === axis.pipelineId);
		if (matches.length !== 1) return 'pipeline-unavailable';
		const pipeline = matches[0];
		const fixed: KanbanAxisValue[] = [];
		for (const status of pipeline.statuses) {
			const value: KanbanAxisValue = { kind: 'status', pipelineId: pipeline.id, id: status.id };
			const key = kanbanAxisValueKey(value);
			if (metadata.has(key)) return 'status-identity-conflict';
			fixed.push(value); metadata.set(key, { label: status.label, color: status.color?.trim() || null });
		}
		const property: KanbanPropertyReference = { source: 'managed', key: 'status', type: 'text' };
		const resolved = options.propertyAccess.resolve(property);
		if (!resolved.ok) return resolved.reason;
		return { identity: JSON.stringify(['status', pipeline.id]), property, fixed, type: 'text', priority: false, metadata, status: true };
	}
	const resolved = options.propertyAccess.resolve(axis.property);
	if (!resolved.ok) return resolved.reason;
	const property = { ...resolved.field.reference };
	if (property.source === 'managed' && property.key === 'status') return 'status-axis-required';
	const priority = property.source === 'managed' && property.key === 'priority';
	const defined: KanbanAxisValue[] = [];
	if (priority) for (const entry of options.settings.priorities) {
		const value: KanbanAxisValue = { kind: 'priority', id: entry.id };
		const key = kanbanAxisValueKey(value);
		if (metadata.has(key)) return 'priority-identity-conflict';
		defined.push(value); metadata.set(key, { label: entry.label, color: entry.color?.trim() || null });
	}
	const selected: KanbanAxisValue[] = [];
	for (const raw of axis.values) {
		const value = normalizeKanbanAxisValue(raw, property);
		if (!value || priority && value.kind !== 'empty' && !metadata.has(kanbanAxisValueKey(value))) return 'selected-value-unavailable';
		selected.push(value);
	}
	return { identity: resolved.field.identity, property, fixed: selected.length ? selected : priority ? defined : null,
		type: property.type, priority: priority && !selected.length, metadata, status: false };
}
function compareValues(left: KanbanAxisValue, right: KanbanAxisValue, type: AxisPlan['type']): number {
	if (left.kind === 'empty' || right.kind === 'empty') return left.kind === right.kind ? 0 : left.kind === 'empty' ? 1 : -1;
	if (left.kind === 'value' && right.kind === 'value') {
		if (type === 'number') return Number(left.value) - Number(right.value);
		if (type === 'checkbox') return Number(left.value) - Number(right.value);
		const order = String(left.value).localeCompare(String(right.value), undefined, { sensitivity: 'base' });
		if (order) return order;
	}
	const a = kanbanAxisValueKey(left), b = kanbanAxisValueKey(right);
	return a < b ? -1 : a > b ? 1 : 0;
}
/** Compare only repeated IDs; ordinary unique tasks never pay serialization cost. */
function equivalentTaskRecords(left: IndexedTask, right: IndexedTask): boolean {
 const serialize = (task: IndexedTask) => JSON.stringify(task, (_key, entry: unknown) => {
  if (entry && typeof entry === 'object' && !Array.isArray(entry))
   return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return entry;
 });
 return serialize(left) === serialize(right) && getTimeScopeSignature(left) === getTimeScopeSignature(right);
}
/** Pure, synchronous query over ready index data. No hydration, Cartesian expansion, or retained cell cache. */
export function buildKanbanGroupingSnapshot(options: KanbanGroupingOptions): KanbanGroupingResult {
	if (options.propertyAccess.revision !== options.propertyAccess.getCurrentRevision()) return { state: 'unavailable', axis: 'both', reason: 'stale-property-access' };
	const decoded = resolveKanbanAxes(options.preset, options.settings.keyMappings);
	if (!decoded.ok) return { state: 'unavailable', axis: 'both', reason: decoded.reason };
	const column = prepareAxis(decoded.axes.columns, options), row = prepareAxis(decoded.axes.swimlanes, options);
	if (typeof column === 'string') return { state: 'unavailable', axis: 'columns', reason: column };
	if (typeof row === 'string') return { state: 'unavailable', axis: 'rows', reason: row };
	const axes = [column, row];
	const domains = axes.map(() => new Map<string, KanbanAxisValue>());
	const diagnostics: KanbanGroupingDiagnostic[] = [];
	// Repeated references are harmless; conflicting records must not pick an arbitrary owner.
	const unique = new Map<string, IndexedTask>(), conflicts = new Set<string>();
	for (const task of options.tasks) {
		const previous = unique.get(task.operonId);
		if (previous && previous !== task && !equivalentTaskRecords(previous, task)) conflicts.add(task.operonId);
		else if (!previous) unique.set(task.operonId, task);
	}
	for (const taskId of conflicts) {
		unique.delete(taskId);
		diagnostics.push({ taskId, axis: 'both', state: 'unavailable', reason: 'duplicate-task-identity' });
	}
	const tasks = [...unique.values()];
	const scoped = filterTasksForDisplay(options.filterSet ?? null, tasks, options.settings.priorities, options.pinnedCache, {
		...options.filterEvaluationOptions, pipelines: options.settings.pipelines,
		dependencyTasks: tasks, projectSerialScopeTasks: tasks,
	});
	const reads = new Map<string, [KanbanPropertyRead | null, KanbanPropertyRead | null]>();
	for (const task of scoped) {
		const byProperty = new Map<string, KanbanPropertyRead>();
		const pair = axes.map((axis, index) => {
			if (!axis.property) return null;
			const identity = JSON.stringify([axis.property.source, axis.property.key, axis.property.type]);
			let read = byProperty.get(identity);
			if (!read) { read = options.propertyAccess.read(task, axis.property); byProperty.set(identity, read); }
			if (read.state === 'ready' || read.state === 'empty') {
				for (const value of read.values) domains[index].set(kanbanAxisValueKey(value), value);
			} else if ('reason' in read) diagnostics.push({ taskId: task.operonId, axis: index === 0 ? 'columns' : 'rows', state: read.state, reason: read.reason });
			return read;
		}) as [KanbanPropertyRead | null, KanbanPropertyRead | null];
		reads.set(task.operonId, pair);
	}
	const headers = axes.map((axis, index) => {
		if (!axis.property) return [{ key: HIDDEN_ROW_KEY, value: null, label: '', color: null, count: 0 }];
		const values = axis.fixed ? [...axis.fixed] : [...domains[index].values()].sort((a, b) => compareValues(a, b, axis.type));
		if (axis.priority && domains[index].has(kanbanAxisValueKey({ kind: 'empty' }))) values.push({ kind: 'empty' });
		return values.map(value => ({ key: groupKey(axis, value), value: Object.freeze({ ...value }),
			label: axis.metadata.get(kanbanAxisValueKey(value))?.label ?? (value.kind === 'empty' ? getKanbanNoValueLabel() : value.kind === 'value' ? String(value.value) : ''),
			color: axis.metadata.get(kanbanAxisValueKey(value))?.color ?? null, count: 0 }));
	});
	const memberships = headers.map(list => new Map(list.map(header => [header.key, new Set<string>()])));
	const allowed = options.taskIdFilter ? new Set(options.taskIdFilter) : null;
	const search = (options.searchQuery ?? '').trim().toLocaleLowerCase();
	const matcher = search ? buildTaskSearchMatcher(tasks, options.settings.keyMappings) : null;
	const displayed = new Map<string, IndexedTask>();
	for (const task of scoped) {
		if (allowed && !allowed.has(task.operonId) || matcher && !matcher(task, search)) continue;
		const pair = reads.get(task.operonId)!;
		if (pair.some(read => read && read.state !== 'ready' && read.state !== 'empty')) continue;
		const keys = axes.map((axis, index) => {
			if (!axis.property) return [HIDDEN_ROW_KEY];
			const read = pair[index];
			if (!read || read.state !== 'ready' && read.state !== 'empty') return [];
			return [...new Set(read.values.map(value => groupKey(axis, value)).filter(key => memberships[index].has(key)))];
		});
		if (!keys[0].length || !keys[1].length) continue;
		displayed.set(task.operonId, task);
		keys.forEach((list, index) => { for (const key of list) memberships[index].get(key)!.add(task.operonId); });
	}
	// Capture sorting configuration: later settings edits require a new snapshot.
	const preset: KanbanPreset = { ...options.preset, sortRules: options.preset.sortRules.map(rule => ({ ...rule })),
		columnSortOverrides: options.preset.columnSortOverrides?.map(override => ({ ...override, sortRules: override.sortRules.map(rule => ({ ...rule })) })) };
	const priorities = options.settings.priorities.map(priority => ({ ...priority }));
	const keyMappings = options.settings.keyMappings.map(mapping => ({ ...mapping }));
	const sorting = new Map(headers[0].map(header => [header.key, resolveKanbanEffectiveSorting(preset, column.status && header.value?.kind === 'status' ? header.value.id : '')]));
	const comparators = new Map<string, (left: IndexedTask, right: IndexedTask) => number>();
	const visitCell = (columnKey: string, rowKey: string, visit: (id: string) => void): void => {
		const columns = memberships[0].get(columnKey), rows = memberships[1].get(rowKey);
		if (!columns || !rows) return;
		const [small, large] = columns.size <= rows.size ? [columns, rows] : [rows, columns];
		for (const id of small) if (large.has(id)) visit(id);
	};
	return {
		state: diagnostics.length ? 'partial' : 'ready', countsComplete: diagnostics.length === 0,
		revision: Object.freeze({ ...options.revision, native: options.propertyAccess.revision }),
		columns: Object.freeze(headers[0].map(header => Object.freeze({ ...header, count: memberships[0].get(header.key)!.size }))),
		rows: Object.freeze(headers[1].map(header => Object.freeze({ ...header, count: memberships[1].get(header.key)!.size }))),
		rowAxisHidden: !row.property, total: displayed.size, diagnostics: Object.freeze(diagnostics.map(entry => Object.freeze(entry))),
		columnMembers: memberships[0], rowMembers: memberships[1],
		getTask: id => displayed.get(id),
		getCellCount: (columnKey, rowKey) => { let count = 0; visitCell(columnKey, rowKey, () => count++); return count; },
		getCellTaskIds: (columnKey, rowKey, manualOrderIds = []) => {
			const result: IndexedTask[] = [];
			visitCell(columnKey, rowKey, id => result.push(displayed.get(id)!));
			if (sorting.get(columnKey)?.sortMode === 'manual') applyManualKanbanTaskOrder(result, [...manualOrderIds]);
			else {
				const policy = sorting.get(columnKey);
				const key = JSON.stringify(policy?.sortRules ?? preset.sortRules);
				let comparator = comparators.get(key);
				if (!comparator) { comparator = buildKanbanTaskComparator({ preset, sorting: policy, priorities, keyMappings, getProjectSerialDisplay: options.getProjectSerialDisplay }); comparators.set(key, comparator); }
				result.sort(comparator);
			}
			return result.map(task => task.operonId);
		},
	};
}
