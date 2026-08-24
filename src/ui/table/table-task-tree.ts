import type { IndexedTask } from '../../types/fields';
import type { TableRenderItem } from './table-surface';

export interface TableTaskTreeProjection {
	depth: number;
	path: number[];
	tokenWidthChars: number;
	expansionKey: string;
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
	expandedOccurrenceKeys: readonly string[],
	sortSiblings?: (tasks: readonly IndexedTask[]) => IndexedTask[],
	taskOrdinals?: ReadonlyMap<string, number>,
): TableTaskTreeRenderItem[] {
	const expanded = new Set(expandedOccurrenceKeys);
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
		const baseExpansionKey = item.ordinalKey;
		const baseOrdinal = taskOrdinals?.get(item.ordinalKey);
		result.push({
			...item,
			tree: {
				depth: 0,
				path: baseChildren.length > 0 && baseOrdinal !== undefined ? [baseOrdinal] : [],
				tokenWidthChars: 1,
				expansionKey: baseExpansionKey,
				hasChildren: baseChildren.length > 0,
				expanded: expanded.has(baseExpansionKey),
				context: false,
			},
		});
		if (!expanded.has(baseExpansionKey)) continue;

		const appendProjection = (
			task: IndexedTask,
			path: number[],
			lineage: ReadonlySet<string>,
			parentExpansionKey: string,
		): void => {
			if (lineage.has(task.operonId)) return;
			const nextLineage = new Set(lineage);
			nextLineage.add(task.operonId);
			const children = (childrenByParent.get(task.operonId) ?? [])
				.filter(child => !nextLineage.has(child.operonId));
			const expansionKey = `${parentExpansionKey}\u0000treeChild\u0000${task.operonId}`;
			result.push({
				kind: 'task',
				task,
				groupKey: item.groupKey,
				ordinalKey: expansionKey,
				tree: {
					depth: path.length,
					path,
					tokenWidthChars: 1,
					expansionKey,
					hasChildren: children.length > 0,
					expanded: expanded.has(expansionKey),
					context: true,
				},
			});
			if (!expanded.has(expansionKey)) return;
			children.forEach((child, index) => appendProjection(child, [...path, index + 1], nextLineage, expansionKey));
		};

		const lineage = new Set([item.task.operonId]);
		const rootPath = baseOrdinal === undefined ? [] : [baseOrdinal];
		baseChildren
			.filter(child => !lineage.has(child.operonId))
			.forEach((child, index) => appendProjection(child, [...rootPath, index + 1], lineage, baseExpansionKey));
	}
	const tokenWidthChars = result.reduce((width, item) => {
		if (item.kind !== 'task' || !item.tree) return width;
		return Math.max(width, formatTableTaskTreePath(item.tree.path).length);
	}, 1);
	for (const item of result) {
		if (item.kind === 'task' && item.tree) item.tree.tokenWidthChars = tokenWidthChars;
	}
	return result;
}

export function formatTableTaskTreePath(path: readonly number[]): string {
	return path.join('.');
}
