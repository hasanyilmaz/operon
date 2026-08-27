import { projectTaskToGantt } from '../../systems/gantt-core';
import type { IndexedTask } from '../../types/fields';
import type { GanttTaskProjection } from '../../types/gantt';
import {
	collectTableGanttTaskDependencyEdges,
	type TableGanttDependencyEdge,
} from './table-gantt-dependencies';
import type { TableScrollPerformanceRecorder } from './table-scroll-performance';
import type { TableTaskTreeRenderItem } from './table-task-tree';

export interface TableGanttTaskModel {
	projections: ReadonlyMap<string, GanttTaskProjection>;
	dependencyEdges: readonly TableGanttDependencyEdge[];
	taskDates: readonly string[];
}

interface ProjectionCacheEntry {
	signature: string;
	projection: GanttTaskProjection;
}

interface DependencyCacheEntry {
	signature: string;
	edges: readonly TableGanttDependencyEdge[];
}

function isGanttTaskItem(
	item: TableTaskTreeRenderItem,
): item is Extract<TableTaskTreeRenderItem, { kind: 'task' | 'parentContext' }> {
	return item.kind === 'task' || item.kind === 'parentContext';
}

function resolveProjectionSignature(task: IndexedTask): string {
	const fields = task.fieldValues;
	return JSON.stringify([
		fields['dateStarted'] ?? '',
		fields['dateScheduled'] ?? '',
		fields['dateDue'] ?? '',
		fields['datetimeStart'] ?? '',
		fields['datetimeEnd'] ?? '',
		fields['estimate'] ?? '',
	]);
}

function resolveDependencySignature(task: IndexedTask): string {
	return JSON.stringify([
		task.fieldValues['blocking'] ?? '',
		task.fieldValues['blockedBy'] ?? '',
	]);
}

function appendProjectionDates(target: string[], projection: GanttTaskProjection): void {
	if (projection.bar) target.push(projection.bar.startDate, projection.bar.endDate);
	if (projection.deadline) target.push(projection.deadline.date);
	for (const marker of projection.markers) target.push(marker.date);
}

export class TableGanttTaskModelCache {
	private readonly projections = new Map<string, ProjectionCacheEntry>();
	private readonly dependencies = new Map<string, DependencyCacheEntry>();
	private lastItems: readonly TableTaskTreeRenderItem[] | null = null;
	private lastModel: TableGanttTaskModel | null = null;
	private lastDependencyContributionCount = 0;

	resolve(
		items: readonly TableTaskTreeRenderItem[],
		performanceRecorder?: TableScrollPerformanceRecorder,
	): TableGanttTaskModel {
		if (this.lastItems === items && this.lastModel) {
			const taskCount = this.lastModel.projections.size;
			performanceRecorder?.recordCounter('ganttProjectionCacheHits', taskCount);
			performanceRecorder?.recordCounter(
				'ganttDependencyModelCacheHits',
				this.lastDependencyContributionCount,
			);
			return this.lastModel;
		}

		const seenTaskIds = new Set<string>();
		const seenDependencyKeys = new Set<string>();
		const projections = new Map<string, GanttTaskProjection>();
		const dependencyEdges = new Map<string, TableGanttDependencyEdge>();
		const taskDates: string[] = [];
		for (const item of items) {
			if (!isGanttTaskItem(item)) continue;
			const task = item.task;
			if (!seenTaskIds.has(task.operonId)) {
				seenTaskIds.add(task.operonId);
				const projectionSignature = resolveProjectionSignature(task);
				const cachedProjection = this.projections.get(task.operonId);
				const projection = cachedProjection?.signature === projectionSignature
					? cachedProjection.projection
					: projectTaskToGantt(task);
				if (cachedProjection?.signature === projectionSignature) {
					performanceRecorder?.recordCounter('ganttProjectionCacheHits');
				} else {
					this.projections.set(task.operonId, { signature: projectionSignature, projection });
					performanceRecorder?.recordCounter('ganttProjectionCacheMisses');
				}
				projections.set(task.operonId, projection);
				appendProjectionDates(taskDates, projection);
			}

			const dependencySignature = resolveDependencySignature(task);
			const dependencyKey = JSON.stringify([task.operonId, dependencySignature]);
			if (seenDependencyKeys.has(dependencyKey)) continue;
			seenDependencyKeys.add(dependencyKey);
			const cachedDependency = this.dependencies.get(dependencyKey);
			const edges = cachedDependency?.signature === dependencySignature
				? cachedDependency.edges
				: collectTableGanttTaskDependencyEdges(task);
			if (cachedDependency?.signature === dependencySignature) {
				performanceRecorder?.recordCounter('ganttDependencyModelCacheHits');
			} else {
				this.dependencies.set(dependencyKey, { signature: dependencySignature, edges });
				performanceRecorder?.recordCounter('ganttDependencyModelCacheMisses');
			}
			for (const edge of edges) dependencyEdges.set(edge.key, edge);
		}

		for (const taskId of this.projections.keys()) {
			if (!seenTaskIds.has(taskId)) this.projections.delete(taskId);
		}
		for (const dependencyKey of this.dependencies.keys()) {
			if (!seenDependencyKeys.has(dependencyKey)) this.dependencies.delete(dependencyKey);
		}

		const model: TableGanttTaskModel = {
			projections,
			dependencyEdges: [...dependencyEdges.values()],
			taskDates,
		};
		this.lastItems = items;
		this.lastModel = model;
		this.lastDependencyContributionCount = seenDependencyKeys.size;
		return model;
	}

	clear(): void {
		this.projections.clear();
		this.dependencies.clear();
		this.lastItems = null;
		this.lastModel = null;
		this.lastDependencyContributionCount = 0;
	}
}
