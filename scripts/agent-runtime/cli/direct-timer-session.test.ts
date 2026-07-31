import assert from 'node:assert/strict';

import {
	compileDirectTimerSessionIntentV1,
	parseDirectTimerSessionArgsV1,
	type DirectTimerSessionActionV1,
	type DirectTimerSessionArgsV1,
} from '../../../packages/operon-cli/src/direct-timer-session';
import type { TaskContextV1 } from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonDirectTimerSessionTestRun: Promise<void> | undefined;
}

globalThis.__operonDirectTimerSessionTestRun = Promise.resolve().then(run);

function run(): void {
	const context = task();
	assert.deepEqual(
		intent('add', {
			start: '2026-07-27T09:00',
			end: '2026-07-27T10:00:30',
		}).spec,
		{
			operation: 'add-session',
			start: '2026-07-27T09:00:00',
			end: '2026-07-27T10:00:30',
		},
	);
	assert.deepEqual(
		intent('update', {
			session: '2',
			start: '2026-07-27T09:15',
			end: '2026-07-27T10:30',
		}).spec,
		{
			operation: 'update-session',
			sessionNumber: 2,
			start: '2026-07-27T09:15:00',
			end: '2026-07-27T10:30:00',
		},
	);
	assert.deepEqual(
		intent('remove', { session: '1' }).spec,
		{ operation: 'remove-session', sessionNumber: 1 },
	);

	for (const invalid of [
		'2026-02-30T09:00',
		'2026-07-27T24:00',
		'2026-07-27T09:00Z',
		'2026-07-27T09:00+02:00',
	]) {
		assert.throws(
			() => intent('add', { start: invalid, end: '2026-07-27T10:00' }),
			/DIRECT_TIMER_SESSION_DATETIME_INVALID/u,
		);
	}
	assert.throws(
		() => intent('add', {
			start: '2026-07-27T10:00',
			end: '2026-07-27T09:00',
		}),
		/DIRECT_TIMER_SESSION_RANGE_INVALID/u,
	);
	assert.throws(
		() => intent('update', {
			session: '0',
			start: '2026-07-27T09:00',
			end: '2026-07-27T10:00',
		}),
		/DIRECT_TIMER_SESSION_NUMBER_INVALID/u,
	);
	assert.throws(
		() => intent('remove', { session: '1', start: '2026-07-27T09:00' }),
		/DIRECT_TIMER_SESSION_RANGE_CONFLICT/u,
	);
	console.log('Direct timer-session compiler tests passed');

	function intent(
		action: DirectTimerSessionActionV1,
		args: DirectTimerSessionArgsV1,
	) {
		return compileDirectTimerSessionIntentV1({
			spec: parseDirectTimerSessionArgsV1(action, args),
			task: context,
		});
	}
}

function task(): TaskContextV1 {
	return {
		identity: {
			operonId: 'abc1234',
			validity: 'canonical',
			mutationAllowed: true,
		},
		description: 'Timer session test',
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
		pinned: false,
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
