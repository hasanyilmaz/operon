import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { OperonIndexer } from '../../../src/indexer/indexer';
import { SecondaryIndexes } from '../../../src/indexer/secondary-indexes';
import type {
	DuplicateOperonConflict,
	IndexedTask,
	IndexedTaskInstance,
} from '../../../src/types/fields';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

let assertions = 0;

function check(condition: unknown, message?: string): asserts condition {
	assert.ok(condition, message);
	assertions += 1;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function task(
	operonId: string,
	options: {
		filePath?: string;
		lineNumber?: number;
		parentTask?: string;
		status?: string;
		priority?: string;
		dateDue?: string;
		checkbox?: IndexedTask['checkbox'];
	} = {},
): IndexedTask {
	return {
		operonId,
		description: `Task ${operonId}`,
		checkbox: options.checkbox ?? 'open',
		fieldValues: {
			status: options.status ?? 'todo',
			priority: options.priority ?? 'normal',
			...(options.parentTask ? { parentTask: options.parentTask } : {}),
			...(options.dateDue ? { dateDue: options.dateDue } : {}),
		},
		tags: ['fixture'],
		primary: {
			filePath: options.filePath ?? 'Tasks/Fixture.md',
			lineNumber: options.lineNumber ?? 0,
			format: 'inline',
		},
		datetimeModified: '2026-07-23T10:00:00.000Z',
		tier: 'hot',
		plainCheckboxProgress: { total: 2, completed: 1 },
	};
}

function instance(source: IndexedTask, instanceKey: string, lineNumber: number): IndexedTaskInstance {
	return {
		...structuredClone(source),
		instanceKey,
		primary: { ...source.primary, lineNumber },
	};
}

type MutableIndexer = {
	tasks: Map<string, IndexedTask>;
	duplicateConflicts: Map<string, DuplicateOperonConflict>;
	coherenceBasis: 'verified-full-scan' | 'unverified';
	lastFullScanAt: string;
	recoveryRequired: boolean;
	secondary: SecondaryIndexes;
};

function mutable(indexer: OperonIndexer): MutableIndexer {
	return indexer as unknown as MutableIndexer;
}

function createIndexer(tasks: IndexedTask[]): OperonIndexer {
	const app = {} as App;
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
	};
	const indexer = new OperonIndexer(app, storage as never);
	const state = mutable(indexer);
	state.tasks = new Map(tasks.map(value => [value.operonId, value]));
	state.secondary.rebuild(state.tasks);
	return indexer;
}

function testSecondarySnapshots(): void {
	const parent = task('parent1');
	const childB = task('child02', {
		parentTask: parent.operonId,
		filePath: 'Tasks/B.md',
		status: 'doing',
		priority: 'High',
		dateDue: '2026-07-24',
	});
	const childA = task('child01', {
		parentTask: parent.operonId,
		filePath: 'Tasks/B.md',
		status: 'doing',
		priority: 'HIGH',
		dateDue: '2026-07-23',
	});
	const indexes = new SecondaryIndexes();
	indexes.rebuild(new Map([parent, childB, childA].map(value => [value.operonId, value])));

	const open = indexes.getOpenTaskIdsSnapshot();
	const children = indexes.getChildIdsSnapshot(parent.operonId);
	const file = indexes.getTaskIdsInFileSnapshot('Tasks/B.md');
	const workflow = indexes.getTaskIdsByWorkflowStatusSnapshot('doing');
	const priority = indexes.getTaskIdsByPrioritySnapshot(' high ');
	const due = indexes.getTaskIdsDueInRangeSnapshot('2026-07-23', '2026-07-24');

	for (const snapshot of [open, children, file, workflow, priority, due]) {
		check(Object.isFrozen(snapshot), 'secondary projections must be frozen');
	}
	deepEqual(children, ['child01', 'child02']);
	deepEqual(file, ['child01', 'child02']);
	deepEqual(workflow, ['child01', 'child02']);
	deepEqual(priority, ['child01', 'child02']);
	deepEqual(due, ['child01', 'child02']);

	const internalChildren = indexes.getChildIds(parent.operonId);
	internalChildren.add('internal-change');
	deepEqual(children, ['child01', 'child02'], 'existing snapshots must not share the backing Set');
}

function testIndexerTaskAndDuplicateSnapshots(): void {
	const source = task('dup0001');
	const indexer = createIndexer([source]);
	const first = instance(source, 'inline:Tasks/Fixture.md:0', 0);
	const second = instance(source, 'inline:Tasks/Fixture.md:1', 1);
	mutable(indexer).duplicateConflicts.set(source.operonId, {
		operonId: source.operonId,
		instances: [first, second],
		detectedAt: '2026-07-23T10:00:00.000Z',
		updatedAt: '2026-07-23T10:00:00.000Z',
		canonicalInstanceKey: first.instanceKey,
	});

	const snapshot = indexer.getTaskSnapshot(source.operonId);
	check(snapshot);
	check(Object.isFrozen(snapshot));
	check(Object.isFrozen(snapshot.fieldValues));
	check(Object.isFrozen(snapshot.tags));
	check(Object.isFrozen(snapshot.primary));
	check(Object.isFrozen(snapshot.plainCheckboxProgress));
	equal(snapshot.fieldValues.status, 'todo');

	source.fieldValues.status = 'changed-after-snapshot';
	source.tags.push('changed-after-snapshot');
	source.primary.filePath = 'Tasks/Changed.md';
	equal(snapshot.fieldValues.status, 'todo');
	deepEqual(snapshot.tags, ['fixture']);
	equal(snapshot.primary.filePath, 'Tasks/Fixture.md');

	const allTasks = indexer.getAllTaskSnapshots();
	check(Object.isFrozen(allTasks));
	equal(allTasks.length, 1);
	check(Object.isFrozen(allTasks[0]));
	equal(allTasks[0].primary.filePath, 'Tasks/Changed.md');

	const duplicates = indexer.getDuplicateInstanceSnapshots(source.operonId);
	check(Object.isFrozen(duplicates));
	equal(duplicates.length, 2);
	for (const duplicate of duplicates) {
		check(Object.isFrozen(duplicate));
		check(Object.isFrozen(duplicate.fieldValues));
		check(Object.isFrozen(duplicate.tags));
		check(Object.isFrozen(duplicate.primary));
	}
	first.fieldValues.status = 'mutated-internal-instance';
	equal(duplicates[0].fieldValues.status, 'todo');
	deepEqual(indexer.getDuplicateInstanceSnapshots('missing'), []);
}

function testIndexerQueryAndAuthoritySnapshots(): void {
	const parent = task('parent1');
	const child = task('child01', {
		parentTask: parent.operonId,
		filePath: 'Tasks/Child.md',
		status: 'doing',
		priority: 'high',
		dateDue: '2026-07-23',
	});
	const indexer = createIndexer([parent, child]);

	deepEqual(indexer.getOpenTaskIdsSnapshot(), ['child01', 'parent1']);
	deepEqual(indexer.getChildIdsSnapshot(parent.operonId), ['child01']);
	deepEqual(indexer.getTaskIdsInFileSnapshot('Tasks/Child.md'), ['child01']);
	deepEqual(indexer.getTaskIdsByWorkflowStatusSnapshot('doing'), ['child01']);
	deepEqual(indexer.getTaskIdsByPrioritySnapshot('HIGH'), ['child01']);
	deepEqual(indexer.getTaskIdsDueInRangeSnapshot('2026-07-23', '2026-07-23'), ['child01']);

	const initial = indexer.getLiveReadAuthoritySnapshot();
	equal(initial.state, 'unverified');
	check(initial.settled);
	check(Object.isFrozen(initial));
	check(Object.isFrozen(initial.durable));

	const state = mutable(indexer);
	state.coherenceBasis = 'verified-full-scan';
	state.lastFullScanAt = '2026-07-23T09:00:00.000Z';
	const verified = indexer.getLiveReadAuthoritySnapshot();
	equal(verified.state, 'verified');
	equal(verified.lastFullScanAt, '2026-07-23T09:00:00.000Z');

	state.recoveryRequired = true;
	equal(indexer.getLiveReadAuthoritySnapshot().state, 'recovery-required');
	state.recoveryRequired = false;
	indexer.destroy();
	equal(indexer.getLiveReadAuthoritySnapshot().state, 'unloading');
}

function run(): void {
	testSecondarySnapshots();
	testIndexerTaskAndDuplicateSnapshots();
	testIndexerQueryAndAuthoritySnapshots();
	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

run();
