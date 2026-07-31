import assert from 'node:assert/strict';
import test from 'node:test';

import type { MutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1';
import {
	prepareRuntimeTaskRelationshipMutationV1,
	verifyRuntimeTaskRelationshipPostflightV1,
	type RuntimeTaskRelationshipSnapshotV1,
} from '../../../src/agent-runtime/runtime/task-relationship-adapter';

const effectiveAt = '2026-07-27T12:34:56.000Z';
const sourceLocator = { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 2 };
const expectedModifiedAt = (() => {
	const date = new Date(effectiveAt);
	const pad = (part: number): string => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
		+ `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
})();

function snapshot(
	operonId: string,
	fieldValues: Readonly<Record<string, string>> = {},
	lineNumber: number = 2,
): RuntimeTaskRelationshipSnapshotV1 {
	return {
		operonId,
		locator: { ...sourceLocator, lineNumber },
		fieldValues,
		sourceContent: `- [ ] ${operonId} {{operonId:: ${operonId}}}`,
		duplicate: false,
	};
}

function request(
	changes: MutationPreviewRequestV1['spec'] extends infer Spec
		? Spec extends { operation: 'replace-relationships'; changes: infer Changes }
			? Changes
			: never
		: never,
): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: 'relationship-adapter',
		kind: 'mutation-preview',
		clientInstanceId: 'relationship-adapter-test',
		idempotencyKey: 'relationship-adapter-key',
		capability: 'tasks.relationship.preview',
		mutationKind: 'task.relationship',
		target: { operonId: 'src0001', locator: sourceLocator },
		spec: { operation: 'replace-relationships', changes },
		authorization: { basis: 'user-explicit-request' },
	};
}

function ports(tasks: readonly RuntimeTaskRelationshipSnapshotV1[]) {
	return {
		getTask: (operonId: string) => tasks.find(task => task.operonId === operonId) ?? null,
		getAllTasks: () => tasks,
	};
}

test('relationship replacement updates both dependency owners and seals exact current state', () => {
	const source = snapshot('src0001', { blocking: 'old0001' });
	const oldTarget = snapshot('old0001', { blockedBy: 'src0001' }, 3);
	const newTarget: RuntimeTaskRelationshipSnapshotV1 = {
		...snapshot('new0001', {}, 4),
		locator: { representation: 'file', filePath: 'Tasks/New target.md' },
	};
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'blocking', targetOperonIds: ['new0001'] }]),
		effectiveAt,
		ports([source, oldTarget, newTarget]),
	);

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.noChange, false);
	assert.deepEqual(result.value.sealedSpec, {
		operation: 'replace-relationships',
		changes: [{
			field: 'blocking',
			targetOperonIds: ['new0001'],
			expectedTargetOperonIds: ['old0001'],
		}],
		affectedOperonIds: ['new0001', 'old0001', 'src0001'],
	});
	assert.deepEqual(
		result.value.patches.map(patch => ({
			operonId: patch.task.operonId,
			fields: patch.fieldValues,
		})),
		[
			{
				operonId: 'new0001',
				fields: { blockedBy: 'src0001', datetimeModified: expectedModifiedAt },
			},
			{
				operonId: 'old0001',
				fields: { blockedBy: '', datetimeModified: expectedModifiedAt },
			},
			{
				operonId: 'src0001',
				fields: { blocking: 'new0001', datetimeModified: expectedModifiedAt },
			},
		],
	);
	const committedTasks = new Map(result.value.patches.map(patch => [
		patch.task.operonId,
		{
			primary: {
				format: patch.task.locator.representation === 'file' ? 'yaml' as const : 'inline' as const,
				filePath: patch.task.locator.filePath,
				lineNumber: patch.task.locator.representation === 'inline'
					? patch.task.locator.lineNumber
					: 0,
			},
			fieldValues: { ...patch.task.fieldValues, ...patch.fieldValues },
		},
	]));
	const verify = () => verifyRuntimeTaskRelationshipPostflightV1(
		result.value,
		expectedModifiedAt,
		operonId => committedTasks.get(operonId),
		() => false,
		() => true,
	);
	assert.equal(verify(), true);
	const committedFile = committedTasks.get('new0001');
	assert.ok(committedFile);
	committedFile.fieldValues.datetimeModified = '2026-07-27T15:00:00';
	assert.equal(verify(), true);
	const committedSource = committedTasks.get('src0001');
	assert.ok(committedSource);
	committedSource.fieldValues.blocking = 'old0001';
	assert.equal(verify(), false);
});

test('relationship replacement rejects a target requested on both dependency sides', () => {
	const source = snapshot('src0001');
	const target = snapshot('dup0001', {}, 3);
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([
			{ field: 'blocking', targetOperonIds: ['dup0001'] },
			{ field: 'blockedBy', targetOperonIds: ['dup0001'] },
		]),
		effectiveAt,
		ports([source, target]),
	);

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.code, 'invalid-request');
		assert.match(result.reason, /both blocking and blockedBy/u);
	}
});

test('relationship replacement can reverse an existing edge without a false cycle', () => {
	const source = snapshot('src0001', { blocking: 'old0001' });
	const target = snapshot('old0001', { blockedBy: 'src0001' }, 3);
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([
			{ field: 'blocking', targetOperonIds: [] },
			{ field: 'blockedBy', targetOperonIds: ['old0001'] },
		]),
		effectiveAt,
		ports([source, target]),
	);

	assert.equal(result.ok, true);
	if (!result.ok) return;
	const sourcePatch = result.value.patches.find(patch => patch.task.operonId === 'src0001');
	const targetPatch = result.value.patches.find(patch => patch.task.operonId === 'old0001');
	assert.equal(sourcePatch?.fieldValues.blockedBy, 'old0001');
	assert.equal(sourcePatch?.fieldValues.blocking, '');
	assert.equal(targetPatch?.fieldValues.blockedBy, '');
	assert.equal(targetPatch?.fieldValues.blocking, 'src0001');
});

test('relationship replacement includes ancestors of every reciprocal target patch', () => {
	const source = snapshot('src0001');
	const target = snapshot('new0001', { parentTask: 'par0001' }, 3);
	const parent = snapshot('par0001', { parentTask: 'top0001' }, 4);
	const top = snapshot('top0001', {}, 5);
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'blocking', targetOperonIds: ['new0001'] }]),
		effectiveAt,
		ports([source, target, parent, top]),
	);

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.value.aggregateAncestorOperonIds, ['par0001', 'top0001']);
	assert.deepEqual(
		result.value.sealedSpec.affectedOperonIds,
		['new0001', 'par0001', 'src0001', 'top0001'],
	);
	const committedTasks = new Map(result.value.patches.map(patch => [
		patch.task.operonId,
		{
			primary: {
				format: 'inline' as const,
				filePath: patch.task.locator.filePath,
				lineNumber: patch.task.locator.representation === 'inline'
					? patch.task.locator.lineNumber
					: 0,
			},
			fieldValues: { ...patch.task.fieldValues, ...patch.fieldValues },
		},
	]));
	for (const ancestor of [parent, top]) {
		committedTasks.set(ancestor.operonId, {
			primary: {
				format: 'inline',
				filePath: ancestor.locator.filePath,
				lineNumber: ancestor.locator.representation === 'inline'
					? ancestor.locator.lineNumber
					: 0,
			},
			fieldValues: { ...ancestor.fieldValues, datetimeModified: expectedModifiedAt },
		});
	}
	assert.equal(
		verifyRuntimeTaskRelationshipPostflightV1(
			result.value,
			expectedModifiedAt,
			operonId => committedTasks.get(operonId),
			() => false,
			() => false,
		),
		false,
	);
});

test('relationship replacement fails closed on a missing inverse for a source edge', () => {
	const source = snapshot('src0001', { blocking: 'old0001' });
	const driftedTarget = snapshot('old0001', {}, 3);
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'blocking', targetOperonIds: [] }]),
		effectiveAt,
		ports([source, driftedTarget]),
	);

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.code, 'invalid-request');
		assert.match(result.reason, /relationship drift/u);
	}
});

test('relationship replacement fails closed on an inverse-only edge to the source', () => {
	const source = snapshot('src0001');
	const driftedTarget = snapshot('old0001', { blockedBy: 'src0001' }, 3);
	const result = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'parentTask', targetOperonIds: [] }]),
		effectiveAt,
		ports([source, driftedTarget]),
	);

	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.code, 'invalid-request');
		assert.match(result.reason, /not reciprocal/u);
	}
});

test('parent replacement rejects a cycle and exact dependency replay is a no-op', () => {
	const source = snapshot('src0001', { blocking: 'old0001' });
	const child = snapshot('kid0001', { parentTask: 'src0001' }, 3);
	const target = snapshot('old0001', { blockedBy: 'src0001' }, 4);
	const cycle = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'parentTask', targetOperonIds: ['kid0001'] }]),
		effectiveAt,
		ports([source, child, target]),
	);
	assert.equal(cycle.ok, false);
	if (!cycle.ok) assert.match(cycle.reason, /parent cycle/u);

	const replay = prepareRuntimeTaskRelationshipMutationV1(
		request([{ field: 'blocking', targetOperonIds: ['old0001'] }]),
		effectiveAt,
		ports([source, child, target]),
	);
	assert.equal(replay.ok, true);
	if (replay.ok) {
		assert.equal(replay.value.noChange, true);
		assert.deepEqual(replay.value.patches, []);
	}
});
