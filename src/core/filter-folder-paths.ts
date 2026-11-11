import type { FilterGroup, FilterNode, FilterSet, FilterSetCondition } from '../types/settings';

function folderKey(path: string): string {
	return path.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
}

// Folder queries can also match a suffix of a path. Count each matching folder
// once, even when the query also covers all of that folder's descendants.
function countFolderQueries(paths: readonly string[], queries: ReadonlySet<string>): Map<string, number> {
	const matches = new Map<string, number>();
	for (const path of paths) {
		let suffix = folderKey(path);
		while (suffix) {
			if (queries.has(suffix)) matches.set(suffix, (matches.get(suffix) ?? 0) + 1);
			const slash = suffix.indexOf('/');
			if (slash < 0) break;
			suffix = suffix.slice(slash + 1);
		}
	}
	return matches;
}

/** Capture from the post-rename vault so queued moves can be applied in event order. */
export function captureFilterFolderRenames(oldPath: string, newPath: string, folderPaths: readonly string[]): Map<string, string> {
	const paths = [...new Set(folderPaths)];
	if (!folderKey(oldPath) || !folderKey(newPath) || oldPath === newPath || !paths.includes(newPath)) return new Map();

	const before: string[] = [];
	const moved = new Map<string, string>();
	for (const path of paths) {
		if (path === newPath || path.startsWith(newPath + '/')) {
			const previous = oldPath + path.slice(newPath.length);
			before.push(previous);
			moved.set(folderKey(previous), path);
		} else {
			before.push(path);
		}
	}
	const oldCounts = countFolderQueries(before, new Set(moved.keys()));
	const newCounts = countFolderQueries(paths, new Set(Array.from(moved.values(), folderKey)));
	for (const [oldKey, path] of moved) {
		if (oldCounts.get(oldKey) !== 1 || newCounts.get(folderKey(path)) !== 1) moved.delete(oldKey);
	}
	return moved;
}

export function rewriteFilterFolderPaths(filter: FilterSet, renames: ReadonlyMap<string, string>): FilterSet {
	const rewriteCondition = (condition: FilterSetCondition): FilterSetCondition => {
		if (condition?.field !== 'folders' || condition.fieldType !== 'folders' || condition.operator !== 'isInFolderTree'
			|| typeof condition.value !== 'string') return condition;
		const next = renames.get(folderKey(condition.value));
		return next && next !== condition.value ? { ...condition, value: next } : condition;
	};
	const rewriteGroup = (group: FilterGroup): FilterGroup => {
		if (!Array.isArray(group?.children)) return group;
		const children = group.children.map(rewriteNode);
		return children.some((child, i) => child !== group.children[i]) ? { ...group, children } : group;
	};
	const rewriteNode = (node: FilterNode): FilterNode => {
		if (!node || typeof node !== 'object') return node;
		return 'children' in node ? rewriteGroup(node) : rewriteCondition(node);
	};
	const rootGroup = rewriteGroup(filter.rootGroup);
	const conditions = Array.isArray(filter.conditions) ? filter.conditions.map(rewriteCondition) : filter.conditions;
	const rootChanged = rootGroup !== filter.rootGroup;
	const conditionsChanged = Array.isArray(conditions) && conditions.some((condition, i) => condition !== filter.conditions[i]);
	if (!rootChanged && !conditionsChanged) return filter;
	return { ...filter, ...(rootChanged ? { rootGroup } : {}), ...(conditionsChanged ? { conditions } : {}) };
}
