import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeCoherentReadCoordinatorV1 } from '../../../src/agent-runtime/runtime/coherent-read';
import { RuntimeLifecycleCoordinatorV1 } from '../../../src/agent-runtime/runtime/lifecycle';
import {
	measureRuntimeTimingSpanV1,
	RuntimeTimingProbeBufferV1,
} from '../../../src/agent-runtime/runtime/timing-probe';
import type { RuntimeRevisionSnapshotV1 } from '../../../src/agent-runtime/runtime/types';

test('bounded timing buffer drops oldest spans and snapshot does not mutate storage', () => {
	const buffer = new RuntimeTimingProbeBufferV1(2);
	for (const [requestId, durationMs] of [['one', 1], ['two', 2], ['three', 3]] as const) {
		buffer.emit({
			requestId,
			flow: 'read',
			span: 'projection',
			durationMs,
		});
	}
	const snapshot = buffer.snapshot();
	assert.deepEqual(snapshot.map(value => value.requestId), ['two', 'three']);
	snapshot[0] = { ...snapshot[0]!, requestId: 'changed' };
	assert.deepEqual(buffer.snapshot().map(value => value.requestId), ['two', 'three']);
	assert.deepEqual(buffer.drain().map(value => value.requestId), ['two', 'three']);
	assert.deepEqual(buffer.snapshot(), []);
});

test('timing diagnostics cannot change operation success or failure behavior', async () => {
	const throwingSink = { emit: (): never => { throw new Error('sink failed'); } };
	assert.equal(await measureRuntimeTimingSpanV1(
		throwingSink,
		{ requestId: 'success', flow: 'read', span: 'projection' },
		async () => 42,
		() => { throw new Error('clock failed'); },
	), 42);
	await assert.rejects(
		measureRuntimeTimingSpanV1(
			throwingSink,
			{ requestId: 'failure', flow: 'read', span: 'projection' },
			async () => { throw new Error('operation failed'); },
		),
		/operation failed/u,
	);
});

test('coherent read emits request-linked spans without changing the result', async () => {
	const lifecycle = readyLifecycle();
	const timingSink = new RuntimeTimingProbeBufferV1();
	let clock = 0;
	const revision: RuntimeRevisionSnapshotV1 = {
		contextRevision: {
			index: {
				sessionId: 'session-one',
				ramGeneration: 1,
				durable: {
					status: 'available',
					snapshotId: 'snapshot-one',
					committedAt: '2026-07-28T10:00:00.000Z',
				},
			},
			settingsFingerprint: 'a'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: 'b'.repeat(64),
		},
		packageRevision: '1:1',
	};
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		timingSink,
		timingNow: () => ++clock,
		refreshSettings: async () => undefined,
		settle: async () => undefined,
		sampleRevision: () => revision,
		now: () => Date.now(),
		setTimer: callback => setTimeout(callback, 0),
		clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	});
	const result = await coordinator.execute({
		requestId: 'read-request-one',
		minimumConsistency: 'live-verified',
		read: async () => ({ value: 'stable' }),
	});
	assert.equal(result.ok, true);
	assert.deepEqual(
		timingSink.snapshot().map(value => [value.requestId, value.flow, value.span, value.attempt]),
		[
			['read-request-one', 'read', 'settings-refresh', undefined],
			['read-request-one', 'read', 'pre-read-settlement', undefined],
			['read-request-one', 'read', 'revision-before', 1],
			['read-request-one', 'read', 'projection', 1],
			['read-request-one', 'read', 'revision-after', 1],
		],
	);
});

function readyLifecycle(): RuntimeLifecycleCoordinatorV1 {
	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	const releaseStartup = lifecycle.beginSettling();
	lifecycle.markCacheReady();
	lifecycle.markReady();
	releaseStartup();
	assert.equal(lifecycle.getPhase(), 'ready');
	return lifecycle;
}
