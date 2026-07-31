import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	MutationPreviewRequestV1,
	TimerSessionSpecV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	prepareRuntimeTimerSessionMutationV1,
	verifyRuntimeTimerSessionPostflightV1,
	type RuntimeTimerSessionSnapshotV1,
} from '../../../src/agent-runtime/runtime/timer-session-adapter';

const effectiveAt = '2026-07-27T12:34:56.000Z';
const locator = { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 2 };

function snapshot(fieldValues: Readonly<Record<string, string>>): RuntimeTimerSessionSnapshotV1 {
	return {
		operonId: 'task001',
		locator,
		fieldValues,
		sourceContent: '- [ ] Timer task {{operonId:: task001}}',
		duplicate: false,
	};
}

function request(spec: TimerSessionSpecV1): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: 'timer-session-adapter',
		kind: 'mutation-preview',
		clientInstanceId: 'timer-session-adapter-test',
		idempotencyKey: 'timer-session-adapter-key',
		capability: 'timers.session.preview',
		mutationKind: 'timer.session',
		target: { operonId: 'task001', locator },
		spec,
		authorization: { basis: 'user-explicit-request' },
	};
}

function prepare(
	task: RuntimeTimerSessionSnapshotV1,
	spec: TimerSessionSpecV1,
	splitAtMidnight = false,
) {
	return prepareRuntimeTimerSessionMutationV1(request(spec), effectiveAt, {
		getTask: operonId => operonId === task.operonId ? task : null,
		splitSessionsAtMidnight: () => splitAtMidnight,
	});
}

test('oldest-first ordinal seals the exact raw storage index and range', () => {
	const task = snapshot({
		trackers: [
			'2026-07-27T10:00:00/2026-07-27T11:00:00',
			'2026-07-27T09:00:00/2026-07-27T09:30:00',
		].join('; '),
		duration: '5400',
	});
	const result = prepare(task, {
		operation: 'update-session',
		sessionNumber: 1,
		start: '2026-07-27T09:15:00',
		end: '2026-07-27T10:15:00',
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.sealedSpec.selectedRawIndex, 1);
	assert.equal(result.value.sealedSpec.expectedStart, '2026-07-27T09:00:00');
	assert.equal(result.value.sealedSpec.expectedEnd, '2026-07-27T09:30:00');
	assert.equal(result.value.sealedSpec.nextDuration, 7200);
	assert.match(result.value.fieldValues.trackers, /09:15:00\/2026-07-27T10:15:00/u);
});

test('duplicate ranges remain distinguishable by raw index', () => {
	const range = '2026-07-27T09:00:00/2026-07-27T10:00:00';
	const task = snapshot({ trackers: `${range}; ${range}`, duration: '7200' });
	const result = prepare(task, {
		operation: 'remove-session',
		sessionNumber: 2,
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.sealedSpec.selectedRawIndex, 1);
	assert.equal(result.value.sealedSpec.nextTrackers, range);
	assert.equal(result.value.sealedSpec.nextDuration, 3600);
});

test('update preserves raw position and reuses midnight splitting', () => {
	const task = snapshot({
		trackers: '2026-07-27T09:00:00/2026-07-27T10:00:00',
		duration: '3600',
	});
	const result = prepare(task, {
		operation: 'update-session',
		sessionNumber: 1,
		start: '2026-07-27T23:30:00',
		end: '2026-07-28T00:30:00',
	}, true);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(
		result.value.sealedSpec.nextTrackers,
		'2026-07-27T23:30:00/2026-07-28T00:00:00; 2026-07-28T00:00:00/2026-07-28T00:30:00',
	);
	assert.equal(result.value.sealedSpec.nextDuration, 3600);
});

test('same-range update is no-change and last remove clears trackers and duration', () => {
	const range = '2026-07-27T09:00:00/2026-07-27T10:00:00';
	const task = snapshot({ trackers: range, duration: '3600' });
	const noChange = prepare(task, {
		operation: 'update-session',
		sessionNumber: 1,
		start: '2026-07-27T09:00:00',
		end: '2026-07-27T10:00:00',
	});
	assert.equal(noChange.ok, true);
	if (noChange.ok) {
		assert.equal(noChange.value.noChange, true);
		assert.deepEqual(noChange.value.fieldValues, {});
	}
	const removed = prepare(task, { operation: 'remove-session', sessionNumber: 1 });
	assert.equal(removed.ok, true);
	if (!removed.ok) return;
	assert.equal(removed.value.sealedSpec.nextTrackers, '');
	assert.equal(removed.value.sealedSpec.nextDuration, 0);
});

test('malformed hydration and sealed tracker drift fail closed', () => {
	const malformed = prepare(
		snapshot({ trackers: 'not-a-range; 2026-07-27T09:00:00/2026-07-27T10:00:00' }),
		{ operation: 'remove-session', sessionNumber: 1 },
	);
	assert.equal(malformed.ok, false);
	const task = snapshot({
		trackers: '2026-07-27T09:00:00/2026-07-27T10:00:00',
		duration: '3600',
	});
	const sealed = prepare(task, { operation: 'remove-session', sessionNumber: 1 });
	assert.equal(sealed.ok, true);
	if (!sealed.ok) return;
	const drifted = prepare(
		snapshot({
			trackers: '2026-07-27T09:30:00/2026-07-27T10:00:00',
			duration: '1800',
		}),
		sealed.value.sealedSpec,
	);
	assert.equal(drifted.ok, false);
	if (!drifted.ok) assert.equal(drifted.code, 'stale-source');
});

test('postflight verifies exact final trackers, duration and locator', () => {
	const task = snapshot({});
	const result = prepare(task, {
		operation: 'add-session',
		start: '2026-07-27T09:00:00',
		end: '2026-07-27T10:00:00',
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(verifyRuntimeTimerSessionPostflightV1(
		result.value,
		() => ({
			locator,
			fieldValues: {
				trackers: result.value.sealedSpec.nextTrackers ?? '',
				duration: String(result.value.sealedSpec.nextDuration ?? 0),
			},
		}),
	), true);
});
