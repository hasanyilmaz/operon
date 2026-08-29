import { isValidOperonId } from '../core/id-generator';

export type TaskEditorDeleteSourceLocator =
	| Readonly<{ representation: 'file'; filePath: string }>
	| Readonly<{ representation: 'inline'; filePath: string; lineNumber: number }>;

export interface TaskEditorDeleteHierarchySnapshot {
	readonly operonId: string;
	readonly locator: TaskEditorDeleteSourceLocator;
	readonly parentOperonId: string | null;
	readonly duplicate: boolean;
}

export interface TaskEditorDeleteHierarchyPlanV1 {
	readonly survivingChildren: readonly TaskEditorDeleteHierarchySnapshot[];
	readonly removedWithParentChildIds: readonly string[];
	readonly orderedSourcePaths: readonly string[];
}

export type TaskEditorDeleteHierarchyPlanResultV1 =
	| { readonly ok: true; readonly value: TaskEditorDeleteHierarchyPlanV1 }
	| {
		readonly ok: false;
		readonly code: 'invalid-request' | 'duplicate-operon-id' | 'stale-source';
		readonly reason: string;
	};

export interface TaskEditorDeleteDependencySnapshot {
	readonly operonId: string;
	readonly locator: TaskEditorDeleteSourceLocator;
	readonly blockingIds: readonly string[];
	readonly blockedByIds: readonly string[];
	readonly duplicate: boolean;
}

export interface TaskEditorDeleteDependencyCleanupV1 {
	readonly task: TaskEditorDeleteDependencySnapshot;
	readonly blockingAfter: readonly string[] | null;
	readonly blockedByAfter: readonly string[] | null;
}

export type TaskEditorDeleteDependencyPlanResultV1 =
	| { readonly ok: true; readonly value: readonly TaskEditorDeleteDependencyCleanupV1[] }
	| {
		readonly ok: false;
		readonly code: 'invalid-request' | 'duplicate-operon-id';
		readonly reason: string;
	};

function validLocator(locator: TaskEditorDeleteSourceLocator): boolean {
	return locator.filePath.trim().length > 0
		&& (
			locator.representation === 'file'
			|| (Number.isInteger(locator.lineNumber) && locator.lineNumber >= 0)
		);
}

export function planTaskEditorDeleteDependencyCleanupV1(input: {
	readonly deletedOperonId: string;
	readonly deletedLocator: TaskEditorDeleteSourceLocator;
	readonly tasks: readonly TaskEditorDeleteDependencySnapshot[];
}): TaskEditorDeleteDependencyPlanResultV1 {
	if (!isValidOperonId(input.deletedOperonId) || !validLocator(input.deletedLocator)) {
		return {
			ok: false,
			code: 'invalid-request',
			reason: 'The Task Editor delete dependency target is invalid.',
		};
	}
	const cleanup: TaskEditorDeleteDependencyCleanupV1[] = [];
	for (const task of input.tasks) {
		if (task.operonId === input.deletedOperonId) continue;
		const clearsBlocking = task.blockingIds.includes(input.deletedOperonId);
		const clearsBlockedBy = task.blockedByIds.includes(input.deletedOperonId);
		if (!clearsBlocking && !clearsBlockedBy) continue;
		if (!isValidOperonId(task.operonId) || !validLocator(task.locator)) {
			return {
				ok: false,
				code: 'invalid-request',
				reason: `A dependency owner has an invalid identity or locator: ${task.operonId}.`,
			};
		}
		if (task.duplicate) {
			return {
				ok: false,
				code: 'duplicate-operon-id',
				reason: `A dependency owner has duplicate Operon identities: ${task.operonId}.`,
			};
		}
		if (
			input.deletedLocator.representation === 'file'
			&& task.locator.filePath === input.deletedLocator.filePath
		) continue;
		cleanup.push({
			task,
			blockingAfter: clearsBlocking
				? task.blockingIds.filter(operonId => operonId !== input.deletedOperonId)
				: null,
			blockedByAfter: clearsBlockedBy
				? task.blockedByIds.filter(operonId => operonId !== input.deletedOperonId)
				: null,
		});
	}
	cleanup.sort((left, right) => (
		left.task.locator.filePath.localeCompare(right.task.locator.filePath)
		|| left.task.operonId.localeCompare(right.task.operonId)
	));
	return { ok: true, value: cleanup };
}

export function planTaskEditorDeleteHierarchyV1(input: {
	readonly parent: TaskEditorDeleteHierarchySnapshot;
	readonly directChildIds: readonly string[];
	readonly resolveTask: (operonId: string) => TaskEditorDeleteHierarchySnapshot | null;
}): TaskEditorDeleteHierarchyPlanResultV1 {
	const { parent } = input;
	if (
		!isValidOperonId(parent.operonId)
		|| parent.duplicate
		|| !validLocator(parent.locator)
	) {
		return {
			ok: false,
			code: parent.duplicate ? 'duplicate-operon-id' : 'invalid-request',
			reason: 'The Task Editor delete parent identity is invalid or ambiguous.',
		};
	}

	const childIds = [...input.directChildIds].sort();
	if (new Set(childIds).size !== childIds.length) {
		return {
			ok: false,
			code: 'invalid-request',
			reason: 'The direct-child index contains duplicate task identities.',
		};
	}

	const visitedAncestorIds = new Set<string>([parent.operonId]);
	let ancestorId = parent.parentOperonId;
	while (ancestorId) {
		if (!isValidOperonId(ancestorId)) {
			return {
				ok: false,
				code: 'invalid-request',
				reason: 'The Task Editor delete parent chain contains an invalid identity.',
			};
		}
		if (visitedAncestorIds.has(ancestorId)) {
			return {
				ok: false,
				code: 'invalid-request',
				reason: 'The Task Editor delete parent chain contains a cycle.',
			};
		}
		visitedAncestorIds.add(ancestorId);
		const ancestor = input.resolveTask(ancestorId);
		if (!ancestor) break;
		if (ancestor.duplicate) {
			return {
				ok: false,
				code: 'duplicate-operon-id',
				reason: `A Task Editor delete ancestor has duplicate Operon identities: ${ancestorId}.`,
			};
		}
		ancestorId = ancestor.parentOperonId;
	}

	const survivingChildren: TaskEditorDeleteHierarchySnapshot[] = [];
	const removedWithParentChildIds: string[] = [];
	for (const childId of childIds) {
		if (!isValidOperonId(childId) || childId === parent.operonId) {
			return {
				ok: false,
				code: 'invalid-request',
				reason: 'The direct-child index contains an invalid identity or parent cycle.',
			};
		}
		const child = input.resolveTask(childId);
		if (
			!child
			|| child.operonId !== childId
			|| child.parentOperonId !== parent.operonId
			|| !validLocator(child.locator)
		) {
			return {
				ok: false,
				code: 'stale-source',
				reason: `The direct child changed or became unavailable: ${childId}.`,
			};
		}
		if (child.duplicate) {
			return {
				ok: false,
				code: 'duplicate-operon-id',
				reason: `A direct child has duplicate Operon identities: ${childId}.`,
			};
		}
		if (
			parent.locator.representation === 'file'
			&& child.locator.filePath === parent.locator.filePath
		) {
			removedWithParentChildIds.push(childId);
			continue;
		}
		survivingChildren.push(child);
	}

	const childSourcePaths = [...new Set(
		survivingChildren.map(child => child.locator.filePath),
	)]
		.filter(filePath => filePath !== parent.locator.filePath)
		.sort((left, right) => left.localeCompare(right));
	return {
		ok: true,
		value: {
			survivingChildren,
			removedWithParentChildIds,
			orderedSourcePaths: [...childSourcePaths, parent.locator.filePath],
		},
	};
}
