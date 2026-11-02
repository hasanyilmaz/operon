import type { IndexedTask } from '../types/fields';
import type { KanbanPreset } from '../types/kanban';
import type { OperonSettings, FilterSet } from '../types/settings';
import { resolveKanbanEffectiveSorting } from '../types/kanban';
import { resolveKanbanAxes, normalizeKanbanAxisValue, kanbanAxisValueKey, type KanbanAxisValue, type KanbanAxes } from '../core/kanban-axis-model';
import type { createKanbanPropertyAccess, KanbanPropertyRead } from '../core/kanban-axis-properties';
import { buildKanbanGroupingSnapshot, buildKanbanGroupingCellKey, type KanbanGroupingOptions, type KanbanGroupingSnapshot } from './kanban-grouping';
import { resolveKanbanOrderAliases } from './kanban-axis-state';
import { buildKanbanCellPlan, type KanbanCellPlan, type KanbanCellTarget } from './kanban-cell-actions';
import type { KanbanColumn as LegacyColumn, KanbanLane as LegacyLane } from './kanban-query';
import type { Pipeline } from '../types/pipeline';
import { buildOptimisticStatusPatch, applyOptimisticRenderPatch } from './optimistic-status-patch';
import { buildWorkflowStatusIdentityIndex, resolveConfiguredStatusIdentity } from '../core/workflow-status-identity';
import { localNow } from '../core/local-time';

export interface KanbanColumn extends LegacyColumn { axisValue: KanbanAxisValue; }
export interface KanbanLane extends LegacyLane { axisValue: KanbanAxisValue | null; isFinished: boolean; }
export interface KanbanBoardData {
	preset: KanbanPreset;
	axes: KanbanAxes;
	pipeline: Pipeline | null;
	filterSet: FilterSet | null;
	columns: KanbanColumn[];
	lanes: KanbanLane[];
	relevantTasks: IndexedTask[];
	snapshot: KanbanGroupingSnapshot;
	getCellTasks(columnKey: string, rowKey: string): IndexedTask[];
	getCellCount(columnKey: string, rowKey: string): number;
	getTarget(columnKey: string, rowKey: string): KanbanCellTarget | null;
	getActionPlan(columnKey: string, rowKey: string, task?: IndexedTask): ReturnType<typeof buildKanbanCellPlan>;
	getSorting(columnKey: string): ReturnType<typeof resolveKanbanEffectiveSorting>;
}
export interface KanbanBoardOverlay {
	taskId: string;
	plan?: KanbanCellPlan;
	nextTask?: IndexedTask;
	columnKey?: string;
	rowKey?: string;
	beforeTaskId?: string | null;
}
type Settings = Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines' | 'inlinePropertyDefinitions'>;
type Access = ReturnType<typeof createKanbanPropertyAccess>;

/** Project the same status consequences as a cell action, without writing or reading sources. */
export function projectKanbanStatusIcon(task: IndexedTask, settings: Settings & Pick<OperonSettings, 'taskIconClickAction'>, access: Access): IndexedTask | null {
	const patch = buildOptimisticStatusPatch(task, settings);
	if (!patch) return null;
	let next = applyOptimisticRenderPatch(task, patch.patch);
	const status = resolveConfiguredStatusIdentity(patch.nextStatus, buildWorkflowStatusIdentityIndex(settings.pipelines));
	if (status.kind === 'configured') {
		const plan = buildKanbanCellPlan({ task, settings, access,
			axes: { version: 1, columns: { kind: 'status', pipelineId: status.pipeline.id }, swimlanes: null },
			target: { columns: { kind: 'status', pipelineId: status.pipeline.id, id: status.status.id }, swimlanes: null } });
		if (plan.state !== 'blocked') next = { ...task, ...plan.nextDraft };
	}
	const modified = localNow();
	return { ...next, datetimeModified: modified, fieldValues: { ...next.fieldValues, datetimeModified: modified, dateModified: modified.slice(0, 10) } };
}

export function kanbanTaskMatchesCell(axes: KanbanAxes, target: KanbanCellTarget, task: IndexedTask, access: Access, plan?: KanbanCellPlan): boolean {
	const reader = plan ? overlayAccess(access, new Map([[task.operonId, { taskId: task.operonId, plan }]])) : access;
	return (['columns', 'swimlanes'] as const).every(side => {
		const axis = axes[side], value = target[side];
		if (!axis) return value === null;
		if (!value) return false;
		const ref = axis.kind === 'status' ? { source: 'managed' as const, key: 'status', type: 'text' as const } : axis.property;
		const read = reader.read(task, ref);
		return (read.state === 'ready' || read.state === 'empty') && read.values.some(candidate => kanbanAxisValueKey(candidate) === kanbanAxisValueKey(value));
	});
}

/** One task overlay, never one task clone per cell. Native values stay in this read-only projection. */
function overlayAccess(access: Access, overlays: ReadonlyMap<string, KanbanBoardOverlay>): Access {
	return { ...access, read(task, ref): KanbanPropertyRead {
		const resolved = access.resolve(ref);
		const requirement = resolved.ok ? overlays.get(task.operonId)?.plan?.requirements.find(req => req.field.identity === resolved.field.identity) : undefined;
		if (!requirement?.target) return access.read(task, ref);
		const raw = requirement.value;
		const values = raw === null || raw === '' || Array.isArray(raw) && raw.length === 0
			? [{ kind: 'empty' } as const]
			: ref.type === 'list'
				? (Array.isArray(raw) ? raw : [raw]).map(value => normalizeKanbanAxisValue({ kind: 'value', value }, ref)).filter((value): value is KanbanAxisValue => value !== null)
				: requirement.values;
		return { state: values[0]?.kind === 'empty' ? 'empty' : 'ready', values, target: requirement.target };
	} };
}

export function queryKanbanAxisBoard(options: Omit<KanbanGroupingOptions, 'settings' | 'propertyAccess'> & {
	settings: Settings; propertyAccess: Access; manualOrder?: Record<string, string[]>; overlays?: readonly KanbanBoardOverlay[];
}): KanbanBoardData | { state: 'unavailable'; reason: string } {
	const decoded = resolveKanbanAxes(options.preset, options.settings.keyMappings);
	if (!decoded.ok) return { state: 'unavailable', reason: decoded.reason };
	const overlays = new Map((options.overlays ?? []).map(overlay => [overlay.taskId, overlay]));
	const access = overlayAccess(options.propertyAccess, overlays);
	const tasks = overlays.size ? options.tasks.map(task => {
		const overlay = overlays.get(task.operonId);
		return overlay?.nextTask ?? (overlay?.plan ? { ...task, ...overlay.plan.nextDraft } : task);
	}) : options.tasks;
	const snapshot = buildKanbanGroupingSnapshot({ ...options, tasks, propertyAccess: access });
	if (snapshot.state === 'unavailable') return snapshot;
	const finished = (value: KanbanAxisValue | null): boolean => value?.kind === 'status'
		&& options.settings.pipelines.find(pipeline => pipeline.id === value.pipelineId)?.statuses.find(status => status.id === value.id)?.isFinished === true;
	const columns: KanbanColumn[] = snapshot.columns.map(header => ({ statusId: header.key, statusLabel: header.label,
		statusValue: header.label, color: header.color, count: header.count, isFinished: finished(header.value), axisValue: header.value! }));
	const lanes: KanbanLane[] = snapshot.rows.map(header => ({ key: header.key, label: header.label, value: header.label,
		isNoValue: header.value?.kind === 'empty', color: header.color, count: header.count, isFinished: finished(header.value), axisValue: header.value }));
	const columnByKey = new Map(columns.map(column => [column.statusId, column]));
	const rowByKey = new Map(lanes.map(lane => [lane.key, lane]));
	const order = resolveKanbanOrderAliases(options.preset, options.manualOrder ?? {}, options.settings, access);
	const getTarget = (columnKey: string, rowKey: string): KanbanCellTarget | null => {
		const column = columnByKey.get(columnKey), row = rowByKey.get(rowKey);
		return column && row ? { columns: column.axisValue, swimlanes: row.axisValue } : null;
	};
	const getSorting = (key: string) => {
		const value = columnByKey.get(key)?.axisValue;
		return resolveKanbanEffectiveSorting(options.preset, value?.kind === 'status' ? value.id : '');
	};
	const columnAxis = decoded.axes.columns;
	return { preset: options.preset, axes: decoded.axes,
		pipeline: columnAxis.kind === 'status' ? options.settings.pipelines.find(p => p.id === columnAxis.pipelineId) ?? null : null,
		filterSet: options.filterSet ?? null, columns, lanes, snapshot,
		relevantTasks: snapshot.taskIds.map(id => snapshot.getTask(id)!), getTarget, getSorting,
		getActionPlan(columnKey, rowKey, task) {
			const target = getTarget(columnKey, rowKey);
			return target ? buildKanbanCellPlan({ axes: decoded.axes, target, task, access: options.propertyAccess, settings: options.settings })
				: { state: 'blocked', reason: 'target-unavailable' };
		},
		getCellCount: (column, row) => snapshot.getCellCount(column, row),
		getCellTasks(column, row) {
			const ids = snapshot.getCellTaskIds(column, row, order[buildKanbanGroupingCellKey(column, row)]);
			if (getSorting(column).sortMode === 'manual') for (const overlay of overlays.values()) {
				if (overlay.columnKey !== column || overlay.rowKey !== row || !ids.includes(overlay.taskId)) continue;
				ids.splice(ids.indexOf(overlay.taskId), 1);
				const before = overlay.beforeTaskId ? ids.indexOf(overlay.beforeTaskId) : -1;
				ids.splice(before < 0 ? ids.length : before, 0, overlay.taskId);
			}
			return ids.map(id => snapshot.getTask(id)!);
		},
	};
}

/** Automatic row collapse uses an ID union, never a column-by-row count matrix. */
export function getKanbanAutoCollapse(board: KanbanBoardData, expandedColumns: Iterable<string> = [], expandedRows: Iterable<string> = []) {
	const columnExceptions = new Set(expandedColumns), rowExceptions = new Set(expandedRows);
	const columns = new Set(board.columns.filter(column => !columnExceptions.has(column.statusId) && (
		board.preset.autoCollapseFinishedColumns && column.isFinished
		|| board.snapshot.countsComplete && board.preset.collapseEmptyColumns && column.count === 0
	)).map(column => column.statusId));
	const visibleIds = new Set<string>();
	for (const [key, ids] of board.snapshot.columnMembers) if (!columns.has(key)) for (const id of ids) visibleIds.add(id);
	const rows = new Set(board.lanes.filter(row => !rowExceptions.has(row.key) && (
		board.preset.autoCollapseFinishedColumns && row.isFinished
		|| board.snapshot.countsComplete && board.preset.collapseEmptySwimlanes && ![...(board.snapshot.rowMembers.get(row.key) ?? [])].some(id => visibleIds.has(id))
	)).map(row => row.key));
	return { columns, rows };
}
