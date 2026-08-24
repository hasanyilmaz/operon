import type { IndexedTask } from '../../types/fields';
import type { TableRenderItem } from './table-surface';

export interface TableTaskTreeProjection {
	depth: number;
	path: number[];
	hasChildren: boolean;
	expanded: boolean;
	context: boolean;
}

export type TableTaskTreeRenderItem =
	| Exclude<TableRenderItem, { kind: 'task' }>
	| (Extract<TableRenderItem, { kind: 'task' }> & { tree?: TableTaskTreeProjection });

function getParentId(task: IndexedTask): string | null {
	const value = (task.fieldValues.parentTask ?? '').trim();
	return value && value !== task.operonId ? value : null;
}

/**
 * Adds a visual hierarchy to the already-materialized Table result. Base rows
 * keep their identity; filter-excluded descendants are context projections and
 * therefore never enter Table counts, summaries, grouping or export.
 */
export function projectTableTaskTree(
	items: readonly TableRenderItem[],
	allTasks: readonly IndexedTask[],
	expandedTaskIds: readonly string[],
	sortSiblings?: (tasks: readonly IndexedTask[]) => IndexedTask[],
): TableTaskTreeRenderItem[] {
	const expanded = new Set(expandedTaskIds);
	const taskById = new Map<string, IndexedTask>();
	const sourceRank = new Map<string, number>();
	allTasks.forEach((task, index) => {
		if (!taskById.has(task.operonId)) taskById.set(task.operonId, task);
		if (!sourceRank.has(task.operonId)) sourceRank.set(task.operonId, index);
	});
	const childrenByParent = new Map<string, IndexedTask[]>();
	for (const task of taskById.values()) {
		const parentId = getParentId(task);
		if (!parentId || !taskById.has(parentId)) continue;
		const children = childrenByParent.get(parentId) ?? [];
		children.push(task);
		childrenByParent.set(parentId, children);
	}
	for (const [parentId, children] of childrenByParent) {
		childrenByParent.set(parentId, sortSiblings
			? sortSiblings(children)
			: children.sort((left, right) => (sourceRank.get(left.operonId) ?? 0) - (sourceRank.get(right.operonId) ?? 0)));
	}

	const baseByGroup = new Map<string, Map<string, Extract<TableRenderItem, { kind: 'task' }>>>();
	const groupOrder: string[] = [];
	for (const item of items) {
		if (item.kind !== 'task') continue;
		const key = item.groupKey ?? '';
		let byId = baseByGroup.get(key);
		if (!byId) {
			byId = new Map();
			baseByGroup.set(key, byId);
			groupOrder.push(key);
		}
		if (!byId.has(item.task.operonId)) byId.set(item.task.operonId, item);
	}

	const projectedByGroup = new Map<string, TableTaskTreeRenderItem[]>();
	for (const groupKey of groupOrder) {
		const base = baseByGroup.get(groupKey);
		if (!base) continue;
		const roots = Array.from(base.values()).filter(item => {
			const parentId = getParentId(item.task);
			return !parentId || !base.has(parentId);
		});
		const structurallyCovered = new Set<string>();
		const markStructuralDescendants = (taskId: string): void => {
			if (structurallyCovered.has(taskId)) return;
			structurallyCovered.add(taskId);
			for (const child of childrenByParent.get(taskId) ?? []) {
				if (base.has(child.operonId)) markStructuralDescendants(child.operonId);
			}
		};
		for (const root of roots) markStructuralDescendants(root.task.operonId);
		const output: TableTaskTreeRenderItem[] = [];
		const emittedBase = new Set<string>();

		const append = (
			task: IndexedTask,
			path: number[],
			lineage: ReadonlySet<string>,
			context: boolean,
		): void => {
			if (lineage.has(task.operonId)) return;
			if (!context && emittedBase.has(task.operonId)) return;
			const baseItem = base.get(task.operonId);
			const nextLineage = new Set(lineage);
			nextLineage.add(task.operonId);
			const children = (childrenByParent.get(task.operonId) ?? [])
				.filter(child => !nextLineage.has(child.operonId));
			const item: TableTaskTreeRenderItem = baseItem
				? { ...baseItem }
				: {
					kind: 'task',
					task,
					groupKey: groupKey || null,
					ordinalKey: `${groupKey || '__ungrouped'}\u0000treeContext\u0000${task.operonId}`,
				};
			item.tree = {
				depth: path.length,
				path,
				hasChildren: children.length > 0,
				expanded: expanded.has(task.operonId),
				context,
			};
			output.push(item);
			if (baseItem) emittedBase.add(task.operonId);
			if (!expanded.has(task.operonId)) return;
			children.forEach((child, index) => append(
				child,
				[...path, index + 1],
				nextLineage,
				!base.has(child.operonId),
			));
		};

		for (const root of roots) append(root.task, [], new Set(), false);
		// A pure cycle has no root. Preserve each base row once and cut the cycle.
		for (const item of base.values()) {
			if (!structurallyCovered.has(item.task.operonId) && !emittedBase.has(item.task.operonId)) {
				append(item.task, [], new Set(), false);
			}
		}
		projectedByGroup.set(groupKey, output);
	}

	const result: TableTaskTreeRenderItem[] = [];
	const insertedGroups = new Set<string>();
	for (const item of items) {
		if (item.kind !== 'task') {
			result.push(item);
			continue;
		}
		const key = item.groupKey ?? '';
		if (insertedGroups.has(key)) continue;
		insertedGroups.add(key);
		result.push(...(projectedByGroup.get(key) ?? []));
	}
	return result;
}

export function formatTableTaskTreePath(path: readonly number[]): string {
	return path.join('.');
}
