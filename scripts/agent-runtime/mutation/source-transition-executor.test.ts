import assert from 'node:assert/strict';
import test from 'node:test';

import {
	executeRuntimeSourceTransitionGroupsV1,
	type RuntimeSourceTransitionWriteOutcomeV1,
} from '../../../src/agent-runtime/runtime/source-transition-executor';
import type {
	RuntimeSourceTransitionGroupV1,
} from '../../../src/agent-runtime/runtime/task-mutation-adapter';

const create: RuntimeSourceTransitionGroupV1 = {
	filePath: 'Tasks/Converted.md',
	expectedContent: null,
	nextContent: 'converted',
	action: 'create',
};
const replace: RuntimeSourceTransitionGroupV1 = {
	filePath: 'Daily.md',
	expectedContent: 'before',
	nextContent: 'after',
	action: 'modify',
};
const trash: RuntimeSourceTransitionGroupV1 = {
	filePath: 'Tasks/Source.md',
	expectedContent: 'source',
	action: 'trash',
};

function ports(
	outcomes: RuntimeSourceTransitionWriteOutcomeV1[],
	options: { failAfterTrash?: boolean } = {},
) {
	const queue = [...outcomes];
	const trashed: string[] = [];
	return {
		trashed,
		value: {
			apply: async (group: RuntimeSourceTransitionGroupV1) => ({
				outcome: queue.shift() ?? 'committed',
				...(group.action === 'trash'
					? {}
					: { committedContent: group.nextContent ?? '' }),
			}),
			afterTrash: async (filePath: string) => {
				trashed.push(filePath);
				if (options.failAfterTrash) throw new Error('fault:after-trash');
			},
		},
	};
}

test('conversion target-create failure is a clean failed first group', async () => {
	const adapter = ports(['exists']);
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[create, replace],
		{ rollbackCreatedTargetOnFailure: true },
		adapter.value,
	);
	assert.equal(result.status, 'failed');
	assert.deepEqual(result.affectedFilePaths, []);
	assert.deepEqual(result.groups.map(group => group.status), ['failed']);
});

test('a first-group writer exception is outcome-unknown and cannot authorize a retry', async () => {
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[replace],
		{ rollbackCreatedTargetOnFailure: false },
		{
			apply: async () => {
				throw new Error('lost response after possible write');
			},
			afterTrash: async () => undefined,
		},
	);
	assert.equal(result.status, 'outcome-unknown');
	assert.deepEqual(result.groups.map(group => group.status), ['outcome-unknown']);
});

test('source replacement failure rolls back the created conversion target', async () => {
	const adapter = ports(['committed', 'conflict', 'committed']);
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[create, replace],
		{ rollbackCreatedTargetOnFailure: true },
		adapter.value,
	);
	assert.equal(result.status, 'failed');
	assert.deepEqual(result.affectedFilePaths, []);
	assert.deepEqual(adapter.trashed, [create.filePath]);
	assert.deepEqual(result.groups.map(group => group.status), ['failed', 'failed']);
	assert.deepEqual(result.groups.map(group => group.group.filePath), [
		create.filePath,
		replace.filePath,
	]);
});

test('rollback failure closes replay with outcome-unknown', async () => {
	const adapter = ports(['committed', 'conflict', 'conflict']);
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[create, replace],
		{ rollbackCreatedTargetOnFailure: true },
		adapter.value,
	);
	assert.equal(result.status, 'outcome-unknown');
	assert.deepEqual(result.affectedFilePaths, [create.filePath]);
	assert.deepEqual(result.groups.map(group => group.status), [
		'committed',
		'outcome-unknown',
	]);
});

test('file-to-inline source trash failure reports a partial result', async () => {
	const adapter = ports(['committed', 'conflict']);
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[replace, trash],
		{ rollbackCreatedTargetOnFailure: false },
		adapter.value,
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.affectedFilePaths, [replace.filePath]);
	assert.deepEqual(result.groups.map(group => group.status), ['committed', 'failed']);
});

test('committed trash with failed index cleanup is outcome-unknown', async () => {
	const adapter = ports(['committed', 'committed'], { failAfterTrash: true });
	const result = await executeRuntimeSourceTransitionGroupsV1(
		[replace, trash],
		{ rollbackCreatedTargetOnFailure: false },
		adapter.value,
	);
	assert.equal(result.status, 'outcome-unknown');
	assert.deepEqual(result.affectedFilePaths, [replace.filePath, trash.filePath]);
	assert.deepEqual(result.groups.map(group => group.status), [
		'committed',
		'outcome-unknown',
	]);
});
