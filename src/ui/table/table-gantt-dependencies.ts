import { parseDependencyIdList } from '../../core/dependency-graph';
import { ganttDateToX } from '../../systems/gantt-core';
import type { IndexedTask } from '../../types/fields';
import type { GanttDateAxis, GanttTaskProjection } from '../../types/gantt';
import type { TableTaskTreeRenderItem } from './table-task-tree';

export type TableGanttDependencyPortSide = 'incoming' | 'outgoing';

export interface TableGanttDependencyEdge {
	key: string;
	fromId: string;
	toId: string;
}

export interface TableGanttDependencyOccurrence {
	task: IndexedTask;
	rowIndex: number;
	left: number;
	right: number;
	centerY: number;
}

export interface TableGanttDependencyConnector {
	edge: TableGanttDependencyEdge;
	source: TableGanttDependencyOccurrence;
	target: TableGanttDependencyOccurrence;
	path: string;
	arrowPath: string;
}

export interface ResolveTableGanttDependencyLayoutOptions {
	items: readonly TableTaskTreeRenderItem[];
	startIndex: number;
	endIndex: number;
	rowHeight: number;
	axis: GanttDateAxis;
	resolveProjection: (task: IndexedTask) => GanttTaskProjection;
	edges?: readonly TableGanttDependencyEdge[];
	additionalEdges?: readonly TableGanttDependencyEdge[];
}

export const TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX = 7;
const TABLE_GANTT_DEPENDENCY_ROUTE_GUTTER_PX = 12;
const TABLE_GANTT_DEPENDENCY_ARROW_LENGTH_PX = 5;
const TABLE_GANTT_DEPENDENCY_ARROW_HALF_HEIGHT_PX = 3;

export function resolveTableGanttDependencyEdgeKey(fromId: string, toId: string): string {
	return `${fromId}\u0000${toId}`;
}

function isRenderableTaskItem(
	item: TableTaskTreeRenderItem | undefined,
): item is Extract<TableTaskTreeRenderItem, { kind: 'task' | 'parentContext' }> {
	return item?.kind === 'task' || item?.kind === 'parentContext';
}

function occurrencePriority(item: Extract<TableTaskTreeRenderItem, { kind: 'task' | 'parentContext' }>): number {
	if (item.kind === 'task' && item.tree?.context !== true) return 0;
	if (item.kind === 'parentContext') return 1;
	return 2;
}

export function collectTableGanttDependencyEdges(
	items: readonly TableTaskTreeRenderItem[],
): TableGanttDependencyEdge[] {
	const edges = new Map<string, TableGanttDependencyEdge>();
	for (const item of items) {
		if (!isRenderableTaskItem(item)) continue;
		for (const edge of collectTableGanttTaskDependencyEdges(item.task)) edges.set(edge.key, edge);
	}
	return [...edges.values()];
}

export function collectTableGanttTaskDependencyEdges(task: IndexedTask): TableGanttDependencyEdge[] {
	const edges = new Map<string, TableGanttDependencyEdge>();
	for (const toId of parseDependencyIdList(task.fieldValues['blocking'])) {
		const key = resolveTableGanttDependencyEdgeKey(task.operonId, toId);
		edges.set(key, { key, fromId: task.operonId, toId });
	}
	for (const fromId of parseDependencyIdList(task.fieldValues['blockedBy'])) {
		const key = resolveTableGanttDependencyEdgeKey(fromId, task.operonId);
		edges.set(key, { key, fromId, toId: task.operonId });
	}
	return [...edges.values()];
}

function resolveBarHorizontalGeometry(
	axis: GanttDateAxis,
	projection: GanttTaskProjection,
): { left: number; right: number } | null {
	if (!projection.bar) return null;
	const left = ganttDateToX(axis, projection.bar.startDate);
	const end = ganttDateToX(axis, projection.bar.endDate);
	if (left === null || end === null) return null;
	return { left, right: end + axis.dayWidthPx };
}

export function selectTableGanttDependencyOccurrences(
	options: ResolveTableGanttDependencyLayoutOptions,
): ReadonlyMap<string, TableGanttDependencyOccurrence> {
	const selected = new Map<string, { occurrence: TableGanttDependencyOccurrence; priority: number }>();
	const startIndex = Math.max(0, Math.floor(options.startIndex));
	const endIndex = Math.min(options.items.length, Math.max(startIndex, Math.ceil(options.endIndex)));
	for (let rowIndex = startIndex; rowIndex < endIndex; rowIndex += 1) {
		const item = options.items[rowIndex];
		if (!isRenderableTaskItem(item)) continue;
		const geometry = resolveBarHorizontalGeometry(options.axis, options.resolveProjection(item.task));
		if (!geometry) continue;
		const priority = occurrencePriority(item);
		const current = selected.get(item.task.operonId);
		if (current && current.priority <= priority) continue;
		selected.set(item.task.operonId, {
			priority,
			occurrence: {
				task: item.task,
				rowIndex,
				left: geometry.left,
				right: geometry.right,
				centerY: (rowIndex * options.rowHeight) + (options.rowHeight / 2),
			},
		});
	}
	return new Map([...selected].map(([taskId, value]) => [taskId, value.occurrence]));
}

export function buildTableGanttDependencyPath(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): { path: string; arrowPath: string } {
	const forwardDistance = endX - startX;
	let path: string;
	if (forwardDistance >= TABLE_GANTT_DEPENDENCY_ROUTE_GUTTER_PX * 2) {
		const middleX = startX + (forwardDistance / 2);
		path = `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
	} else {
		const rightX = Math.max(startX, endX) + TABLE_GANTT_DEPENDENCY_ROUTE_GUTTER_PX;
		const leftX = Math.min(startX, endX) - TABLE_GANTT_DEPENDENCY_ROUTE_GUTTER_PX;
		const middleY = startY + ((endY - startY) / 2);
		path = `M ${startX} ${startY} H ${rightX} V ${middleY} H ${leftX} V ${endY} H ${endX}`;
	}
	const arrowPath = [
		`M ${endX - TABLE_GANTT_DEPENDENCY_ARROW_LENGTH_PX} ${endY - TABLE_GANTT_DEPENDENCY_ARROW_HALF_HEIGHT_PX}`,
		`L ${endX} ${endY}`,
		`L ${endX - TABLE_GANTT_DEPENDENCY_ARROW_LENGTH_PX} ${endY + TABLE_GANTT_DEPENDENCY_ARROW_HALF_HEIGHT_PX}`,
	].join(' ');
	return { path, arrowPath };
}

export function resolveTableGanttDependencyDirection(
	startTaskId: string,
	startSide: TableGanttDependencyPortSide,
	targetTaskId: string,
	targetSide: TableGanttDependencyPortSide,
): { fromId: string; toId: string } | null {
	if (!startTaskId || !targetTaskId || startTaskId === targetTaskId || startSide === targetSide) return null;
	return startSide === 'outgoing'
		? { fromId: startTaskId, toId: targetTaskId }
		: { fromId: targetTaskId, toId: startTaskId };
}

export function resolveTableGanttDependencyConnectors(
	options: ResolveTableGanttDependencyLayoutOptions,
): {
	edges: readonly TableGanttDependencyEdge[];
	occurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>;
	connectors: readonly TableGanttDependencyConnector[];
} {
	const edgesByKey = new Map(
		(options.edges ?? collectTableGanttDependencyEdges(options.items)).map(edge => [edge.key, edge]),
	);
	for (const edge of options.additionalEdges ?? []) edgesByKey.set(edge.key, edge);
	const edges = [...edgesByKey.values()];
	const occurrences = selectTableGanttDependencyOccurrences(options);
	const connectors: TableGanttDependencyConnector[] = [];
	for (const edge of edges) {
		const source = occurrences.get(edge.fromId);
		const target = occurrences.get(edge.toId);
		if (!source || !target) continue;
		const startX = source.right + TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX;
		const endX = target.left - TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX;
		const geometry = buildTableGanttDependencyPath(startX, source.centerY, endX, target.centerY);
		connectors.push({ edge, source, target, ...geometry });
	}
	return { edges, occurrences, connectors };
}
