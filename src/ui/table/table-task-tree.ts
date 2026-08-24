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
 * Adds expandable context projections without moving or hiding any row from
 * the already-materialized Table result. Projected descendants therefore never
 * enter Table counts, summaries, grouping or export.
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

	const result: TableTaskTreeRenderItem[] = [];
	for (const item of items) {
		if (item.kind !== 'task') {
			result.push(item);
			continue;
		}
		const baseChildren = childrenByParent.get(item.task.operonId) ?? [];
		result.push({
			...item,
			tree: {
				depth: 0,
				path: [],
				hasChildren: baseChildren.length > 0,
				expanded: expanded.has(item.task.operonId),
				context: false,
			},
		});
		if (!expanded.has(item.task.operonId)) continue;

		const appendProjection = (
			task: IndexedTask,
			path: number[],
			lineage: ReadonlySet<string>,
		): void => {
			if (lineage.has(task.operonId)) return;
			const nextLineage = new Set(lineage);
			nextLineage.add(task.operonId);
			const children = (childrenByParent.get(task.operonId) ?? [])
				.filter(child => !nextLineage.has(child.operonId));
			const pathKey = path.join('.');
			result.push({
				kind: 'task',
				task,
				groupKey: item.groupKey,
				ordinalKey: `${item.ordinalKey}\u0000treeContext\u0000${pathKey}\u0000${task.operonId}`,
				tree: {
					depth: path.length,
					path,
					hasChildren: children.length > 0,
					expanded: expanded.has(task.operonId),
					context: true,
				},
			});
			if (!expanded.has(task.operonId)) return;
			children.forEach((child, index) => appendProjection(child, [...path, index + 1], nextLineage));
		};

		const lineage = new Set([item.task.operonId]);
		baseChildren
			.filter(child => !lineage.has(child.operonId))
			.forEach((child, index) => appendProjection(child, [index + 1], lineage));
	}
	return result;
}

export function formatTableTaskTreePath(path: readonly number[]): string {
	return path.join('.');
}
