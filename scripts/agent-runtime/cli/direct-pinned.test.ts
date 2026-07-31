import assert from 'node:assert/strict';

import { compileDirectPinnedIntentV1 } from '../../../packages/operon-cli/src/direct-pinned';
import { isExpectedDirectMutationKindV1 } from '../../../packages/operon-cli/src/command-line';
import type { TaskContextV1 } from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonDirectPinnedTestRun: Promise<void> | undefined;
}

globalThis.__operonDirectPinnedTestRun = Promise.resolve().then(run);

function run(): void {
	const unpinned = task(false);
	const pin = compileDirectPinnedIntentV1({ action: 'pin', task: unpinned });
	assert.equal(pin.status, 'ready');
	if (pin.status === 'ready') {
		assert.deepEqual(pin.intent.target, {
			operonId: 'abc1234',
			locator: unpinned.locator,
		});
		assert.deepEqual(pin.intent.spec, {
			operation: 'set-pinned',
			pinned: true,
		});
	}
	const pinned = task(true);
	const unpin = compileDirectPinnedIntentV1({ action: 'unpin', task: pinned });
	assert.equal(unpin.status, 'ready');
	if (unpin.status === 'ready') {
		assert.deepEqual(unpin.intent.spec, {
			operation: 'set-pinned',
			pinned: false,
		});
	}
	assert.equal(
		compileDirectPinnedIntentV1({ action: 'pin', task: pinned }).status,
		'no-change',
	);
	assert.equal(
		compileDirectPinnedIntentV1({ action: 'unpin', task: unpinned }).status,
		'no-change',
	);
	assert.throws(
		() => compileDirectPinnedIntentV1({
			action: 'pin',
			task: {
				...unpinned,
				identity: { ...unpinned.identity, operonId: 'invalid!' },
			},
		}),
		/INVALID_OPERON_ID/u,
	);
	assert.equal(
		isExpectedDirectMutationKindV1(
			{ mutationKind: 'task.pinned-state' },
			'task.pinned-state',
		),
		true,
	);
	assert.equal(
		isExpectedDirectMutationKindV1(
			{ mutationKind: 'task.update' },
			'task.pinned-state',
		),
		false,
	);
	console.log('Direct pinned-state compiler tests passed');
}

function task(pinned: boolean): TaskContextV1 {
	return {
		identity: {
			operonId: 'abc1234',
			validity: 'canonical',
			mutationAllowed: true,
		},
		description: 'Pinned state test',
		representation: 'inline',
		locator: {
			representation: 'inline',
			filePath: 'Tasks.md',
			lineNumber: 2,
		},
		checkbox: 'open',
		dates: {},
		datetimes: {},
		relationships: {
			childOperonIds: [],
			relatedOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 0 },
		pinned,
		sourceRevision: { algorithm: 'sha256', contentDigest: 'a'.repeat(64) },
		contextRevision: {
			index: {
				sessionId: 'session',
				ramGeneration: 1,
				durable: {
					status: 'available',
					revision: 1,
					settingsFingerprint: 'b'.repeat(64),
					manifestDigest: 'c'.repeat(64),
				},
			},
			settingsFingerprint: 'b'.repeat(64),
			pinnedGeneration: 1,
			activeTrackerGeneration: 1,
			repeatSeriesRevision: 1,
			projectSerialGeneration: 1,
			projectSerialSignature: 'd'.repeat(64),
		},
	} as unknown as TaskContextV1;
}
