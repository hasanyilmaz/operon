import assert from 'node:assert/strict';
import test from 'node:test';
import {
	planTaskEditorDeleteDependencyCleanupV1,
	planTaskEditorDeleteHierarchyV1,
	type TaskEditorDeleteDependencySnapshot,
	type TaskEditorDeleteHierarchySnapshot,
} from '../src/systems/task-editor-delete-plan';

function inline(
	operonId: string,
	filePath: string,
	lineNumber: number,
	parentOperonId: string | null = null,
	duplicate = false,
): TaskEditorDeleteHierarchySnapshot {
	return {
		operonId,
		locator: { representation: 'inline', filePath, lineNumber },
		parentOperonId,
		duplicate,
	};
}

function file(
	operonId: string,
	filePath: string,
	parentOperonId: string | null = null,
	duplicate = false,
): TaskEditorDeleteHierarchySnapshot {
	return {
		operonId,
		locator: { representation: 'file', filePath },
		parentOperonId,
		duplicate,
	};
}

function dependency(
	operonId: string,
	filePath: string,
	lineNumber: number,
	blockingIds: readonly string[] = [],
	blockedByIds: readonly string[] = [],
	duplicate = false,
): TaskEditorDeleteDependencySnapshot {
	return {
		operonId,
		locator: { representation: 'inline', filePath, lineNumber },
		blockingIds,
		blockedByIds,
		duplicate,
	};
}

test('inline parent deletion detaches only direct children and writes the parent source last', () => {
	const parent = inline('parent1', 'Projects.md', 4);
	const tasks = new Map<string, TaskEditorDeleteHierarchySnapshot>([
		['child01', inline('child01', 'Projects.md', 8, 'parent1')],
		['child02', file('child02', 'Child.md', 'parent1')],
		['grand01', inline('grand01', 'Grandchildren.md', 2, 'child01')],
	]);
	const result = planTaskEditorDeleteHierarchyV1({
		parent,
		directChildIds: ['child02', 'child01'],
		resolveTask: operonId => tasks.get(operonId) ?? null,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	if (!result.ok) return;
	assert.deepEqual(result.value.survivingChildren.map(child => child.operonId), [
		'child01',
		'child02',
	]);
	assert.deepEqual(result.value.removedWithParentChildIds, []);
	assert.deepEqual(result.value.orderedSourcePaths, ['Child.md', 'Projects.md']);
	assert.equal(result.value.survivingChildren.some(child => child.operonId === 'grand01'), false);
});

test('YAML parent deletion ignores children removed with its file and roots only survivors', () => {
	const parent = file('parent1', 'Parent.md');
	const tasks = new Map<string, TaskEditorDeleteHierarchySnapshot>([
		['child01', inline('child01', 'Parent.md', 12, 'parent1')],
		['child02', inline('child02', 'Tasks.md', 2, 'parent1')],
		['child03', file('child03', 'Child.md', 'parent1')],
	]);
	const result = planTaskEditorDeleteHierarchyV1({
		parent,
		directChildIds: ['child03', 'child01', 'child02'],
		resolveTask: operonId => tasks.get(operonId) ?? null,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	if (!result.ok) return;
	assert.deepEqual(result.value.survivingChildren.map(child => child.operonId), [
		'child02',
		'child03',
	]);
	assert.deepEqual(result.value.removedWithParentChildIds, ['child01']);
	assert.deepEqual(result.value.orderedSourcePaths, ['Child.md', 'Tasks.md', 'Parent.md']);
});

test('duplicate, stale, invalid, and cyclic child identities fail closed', () => {
	const parent = inline('parent1', 'Projects.md', 4);
	const validChild = inline('child01', 'Projects.md', 8, 'parent1');
	const cyclicParent = { ...parent, parentOperonId: 'parent2' };
	const cyclicAncestor = inline('parent2', 'Ancestors.md', 2, 'parent3');
	const cyclicRoot = inline('parent3', 'Ancestors.md', 4, 'parent1');
	const cases = [
		{
			name: 'duplicate source index entry',
			childIds: ['child01', 'child01'],
			resolveTask: () => validChild,
			code: 'invalid-request',
		},
		{
			name: 'missing source',
			childIds: ['child01'],
			resolveTask: () => null,
			code: 'stale-source',
		},
		{
			name: 'stale parent link',
			childIds: ['child01'],
			resolveTask: () => ({ ...validChild, parentOperonId: 'other01' }),
			code: 'stale-source',
		},
		{
			name: 'duplicate task identity',
			childIds: ['child01'],
			resolveTask: () => ({ ...validChild, duplicate: true }),
			code: 'duplicate-operon-id',
		},
		{
			name: 'parent cycle',
			childIds: ['parent1'],
			resolveTask: () => parent,
			code: 'invalid-request',
		},
		{
			name: 'invalid child identity',
			childIds: ['bad'],
			resolveTask: () => validChild,
			code: 'invalid-request',
		},
		{
			name: 'mismatched resolved child identity',
			childIds: ['child01'],
			resolveTask: () => ({ ...validChild, operonId: 'child02' }),
			code: 'stale-source',
		},
	] as const;
	for (const scenario of cases) {
		const result = planTaskEditorDeleteHierarchyV1({
			parent,
			directChildIds: scenario.childIds,
			resolveTask: scenario.resolveTask,
		});
		assert.equal(result.ok, false, scenario.name);
		if (!result.ok) assert.equal(result.code, scenario.code, scenario.name);
	}

	const cyclic = planTaskEditorDeleteHierarchyV1({
		parent: cyclicParent,
		directChildIds: [],
		resolveTask: operonId => (
			operonId === 'parent2' ? cyclicAncestor
				: operonId === 'parent3' ? cyclicRoot : null
		),
	});
	assert.equal(cyclic.ok, false);
	if (!cyclic.ok) assert.equal(cyclic.code, 'invalid-request');

	const missingAncestorBoundary = planTaskEditorDeleteHierarchyV1({
		parent: { ...parent, parentOperonId: 'miss001' },
		directChildIds: ['child01'],
		resolveTask: operonId => operonId === 'child01' ? validChild : null,
	});
	assert.equal(missingAncestorBoundary.ok, true, JSON.stringify(missingAncestorBoundary));
});

test('dependency cleanup removes only the deleted ID from every surviving relationship owner', () => {
	const result = planTaskEditorDeleteDependencyCleanupV1({
		deletedOperonId: 'parent1',
		deletedLocator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 4 },
		tasks: [
			dependency('source1', 'Dependencies.md', 2, ['parent1', 'keep0001']),
			dependency('target1', 'Dependencies.md', 5, [], ['keep0002', 'parent1']),
			dependency('both001', 'Tasks.md', 8, ['parent1'], ['parent1']),
			dependency('clean001', 'Other.md', 1, ['keep0003'], ['keep0004']),
		],
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	if (!result.ok) return;
	assert.deepEqual(result.value.map(cleanup => ({
		operonId: cleanup.task.operonId,
		blockingAfter: cleanup.blockingAfter,
		blockedByAfter: cleanup.blockedByAfter,
	})), [{
		operonId: 'source1',
		blockingAfter: ['keep0001'],
		blockedByAfter: null,
	}, {
		operonId: 'target1',
		blockingAfter: null,
		blockedByAfter: ['keep0002'],
	}, {
		operonId: 'both001',
		blockingAfter: [],
		blockedByAfter: [],
	}]);
});

test('dependency cleanup skips tasks removed with a YAML source and rejects ambiguous owners', () => {
	const removedWithFile = dependency('inline1', 'Parent.md', 8, ['parent1']);
	const skipped = planTaskEditorDeleteDependencyCleanupV1({
		deletedOperonId: 'parent1',
		deletedLocator: { representation: 'file', filePath: 'Parent.md' },
		tasks: [removedWithFile],
	});
	assert.deepEqual(skipped, { ok: true, value: [] });

	const duplicate = planTaskEditorDeleteDependencyCleanupV1({
		deletedOperonId: 'parent1',
		deletedLocator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 4 },
		tasks: [{ ...dependency('source1', 'Dependencies.md', 2, ['parent1']), duplicate: true }],
	});
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'duplicate-operon-id');
});
