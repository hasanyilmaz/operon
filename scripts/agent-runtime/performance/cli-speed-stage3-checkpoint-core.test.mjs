import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessCheckpoint,
	buildStage3CheckpointIdentity,
	commitCheckpointUnit,
	createCheckpoint,
	createStage3Checkpoint,
	evaluateCheckpointAuthority,
	isRetryablePreHandlerShardFailure,
	mergeRawSampleEvidence,
	mergeStage3Checkpoints,
	recordUnit,
	summarizeCheckpointSamples,
	validateStage3Checkpoint,
} from './cli-speed-stage3-checkpoint-core.mjs';

const digest = character => character.repeat(64);

function identity(overrides = {}) {
	return buildStage3CheckpointIdentity({
		vaultRealpath: '/private/tmp/cli-test-vault',
		profile: { core: 20, fileUpdate: 75, leak: 300 },
		artifactDigests: {
			production: digest('a'),
			probe: digest('b'),
			cli: digest('c'),
		},
		fixtureGeneratorDigest: digest('d'),
		environmentIdentity: {
			arch: 'arm64',
			machine: 'test-machine',
			obsidianVersion: '1.9.10',
		},
		sessionIdentity: {
			obsidianPid: 123,
			sessionId: 'session-1',
		},
		stage2MilestoneHash: digest('e'),
		baselineHash: digest('f'),
		...overrides,
	});
}

function unit(id, values = [10, 20], overrides = {}) {
	return {
		id,
		status: 'passed',
		samples: values.map((duration, index) => ({
			id: `${id}-${index}`,
			ok: true,
			metrics: {
				outerWallMs: duration,
				nested: { handlerMs: duration / 2 },
			},
			raw: {
				exitCode: 0,
				validationReasons: [],
			},
		})),
		...overrides,
	};
}

test('identity covers artifacts, fixtures, environment, session, milestone, and baseline', () => {
	const original = identity();
	for (const changed of [
		identity({ vaultRealpath: '/private/tmp/another-vault' }),
		identity({ profile: { core: 21, fileUpdate: 75, leak: 300 } }),
		identity({ fixtureGeneratorDigest: digest('1') }),
		identity({ environmentIdentity: { machine: 'other' } }),
		identity({ sessionIdentity: { sessionId: 'session-2' } }),
		identity({ stage2MilestoneHash: digest('2') }),
		identity({ baselineHash: digest('3') }),
		identity({
			artifactDigests: {
				production: digest('4'),
				probe: digest('b'),
				cli: digest('c'),
			},
		}),
	]) {
		assert.notEqual(changed.digest, original.digest);
	}
});

test('identity canonicalization is stable across object key order', () => {
	const first = identity({
		profile: { core: 20, fileUpdate: 75 },
		environmentIdentity: { machine: 'test', arch: 'arm64' },
	});
	const second = identity({
		profile: { fileUpdate: 75, core: 20 },
		environmentIdentity: { arch: 'arm64', machine: 'test' },
	});
	assert.equal(first.digest, second.digest);
});

test('checkpoint remains non-authoritative until every required unit passes', () => {
	const empty = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update', 'batch-20'],
	});
	assert.deepEqual(evaluateCheckpointAuthority(empty), {
		authoritative: false,
		missingUnits: ['batch-20', 'file-update'],
		failedUnits: [],
		incompleteUnits: [],
	});
	const one = commitCheckpointUnit(empty, {
		expectedRevision: 0,
		unit: unit('file-update'),
	});
	assert.equal(one.authority.authoritative, false);
	assert.deepEqual(one.authority.missingUnits, ['batch-20']);
	const complete = commitCheckpointUnit(one, {
		expectedRevision: 1,
		unit: unit('batch-20'),
	});
	assert.equal(complete.authority.authoritative, true);
});

test('atomic commit rejects stale revisions and duplicate unit ids', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update'],
	});
	const committed = commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: unit('file-update'),
	});
	assert.throws(
		() => commitCheckpointUnit(committed, { expectedRevision: 0, unit: unit('other') }),
		/revision mismatch/u,
	);
	assert.throws(
		() => commitCheckpointUnit(committed, { expectedRevision: 1, unit: unit('file-update') }),
		/Duplicate checkpoint unit/u,
	);
});

test('duplicate sample ids are rejected within and across units', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['a'],
	});
	assert.throws(
		() => commitCheckpointUnit(checkpoint, {
			expectedRevision: 0,
			unit: {
				id: 'a',
				status: 'passed',
				samples: [
					{ id: 'same', ok: true, metrics: {} },
					{ id: 'same', ok: true, metrics: {}, raw: { evidence: true } },
				],
			},
		}),
		/Duplicate checkpoint sample/u,
	);
	const first = commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: {
			id: 'a',
			status: 'passed',
			samples: [{ id: 'same', ok: true, metrics: {}, raw: { evidence: true } }],
		},
	});
	assert.throws(
		() => commitCheckpointUnit(first, {
			expectedRevision: 1,
			unit: {
				id: 'b',
				status: 'passed',
				samples: [{ id: 'same', ok: true, metrics: {}, raw: { evidence: true } }],
			},
		}),
		/Duplicate checkpoint sample/u,
	);
});

test('failed units retain raw failure and completed siblings', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update', 'batch-20'],
	});
	const sibling = commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: unit('file-update'),
	});
	const failed = commitCheckpointUnit(sibling, {
		expectedRevision: 1,
		unit: {
			id: 'batch-20',
			status: 'failed',
			samples: [{ id: 'batch-20-0', ok: false, metrics: { outerWallMs: 35_000 } }],
			rawFailure: {
				code: 'live-settling',
				requestId: 'request-20',
				rawMessage: 'Runtime did not settle.',
			},
		},
	});
	assert.equal(failed.units['file-update'].status, 'passed');
	assert.deepEqual(failed.units['batch-20'].rawFailure, {
		code: 'live-settling',
		rawMessage: 'Runtime did not settle.',
		requestId: 'request-20',
	});
	assert.deepEqual(failed.authority.failedUnits, ['batch-20']);
	assert.equal(failed.authority.authoritative, false);
	assert.throws(
		() => commitCheckpointUnit(checkpoint, {
			expectedRevision: 0,
			unit: { id: 'batch-20', status: 'failed', samples: [] },
		}),
		/must retain rawFailure/u,
	);
});

test('merge preserves distinct completed siblings and rejects identity mismatch', () => {
	const seed = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update', 'batch-20'],
	});
	const left = commitCheckpointUnit(seed, {
		expectedRevision: 0,
		unit: unit('file-update'),
	});
	const right = commitCheckpointUnit(seed, {
		expectedRevision: 0,
		unit: unit('batch-20'),
	});
	const merged = mergeStage3Checkpoints(left, right);
	assert.deepEqual(Object.keys(merged.units), ['batch-20', 'file-update']);
	assert.equal(merged.authority.authoritative, true);

	const foreignSeed = createStage3Checkpoint({
		identity: identity({ sessionIdentity: { sessionId: 'foreign' } }),
		requiredUnits: ['file-update', 'batch-20'],
	});
	const foreign = commitCheckpointUnit(foreignSeed, {
		expectedRevision: 0,
		unit: unit('batch-20'),
	});
	assert.throws(() => mergeStage3Checkpoints(left, foreign), /identity mismatch/u);
	assert.throws(() => mergeStage3Checkpoints(left, left), /Duplicate checkpoint unit/u);
});

test('summaries are recomputed from raw samples and stored percentiles are ignored', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update'],
	});
	const committed = commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: {
			...unit('file-update', [1, 2, 100]),
			summary: {
				attempts: 999,
				metrics: { outerWallMs: { p50: -1, p95: -1, max: -1 } },
			},
		},
	});
	assert.deepEqual(committed.units['file-update'].summary.metrics.outerWallMs, {
		samples: 3,
		p50: 2,
		p95: 100,
		max: 100,
	});
	const tampered = structuredClone(committed);
	tampered.units['file-update'].summary.metrics.outerWallMs.p50 = -999;
	const restored = validateStage3Checkpoint(tampered);
	assert.equal(restored.units['file-update'].summary.metrics.outerWallMs.p50, 2);
});

test('a passed unit with an unsuccessful raw sample is non-authoritative', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update'],
	});
	const committed = commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: {
			id: 'file-update',
			status: 'passed',
			samples: [{
				id: 'failed-sample',
				ok: false,
				metrics: { outerWallMs: 10 },
				raw: { failureCode: 'sample-failed' },
			}],
		},
	});
	assert.deepEqual(committed.authority.incompleteUnits, ['file-update']);
	assert.equal(committed.authority.authoritative, false);
});

test('passed units require samples with non-empty raw evidence', () => {
	const checkpoint = createStage3Checkpoint({
		identity: identity(),
		requiredUnits: ['file-update'],
	});
	assert.throws(
		() => commitCheckpointUnit(checkpoint, {
			expectedRevision: 0,
			unit: { id: 'file-update', status: 'passed', samples: [] },
		}),
		/must retain at least one raw evidence sample/u,
	);
	assert.throws(
		() => commitCheckpointUnit(checkpoint, {
			expectedRevision: 0,
			unit: {
				id: 'file-update',
				status: 'passed',
				samples: [{ id: 'missing-raw', ok: true, metrics: { durationMs: 1 } }],
			},
		}),
		/sample missing-raw must retain raw evidence/u,
	);
	assert.throws(
		() => commitCheckpointUnit(checkpoint, {
			expectedRevision: 0,
			unit: {
				id: 'file-update',
				status: 'passed',
				samples: [{
					id: 'empty-raw',
					ok: true,
					metrics: { durationMs: 1 },
					raw: {},
				}],
			},
		}),
		/sample empty-raw must retain raw evidence/u,
	);
	assert.equal(commitCheckpointUnit(checkpoint, {
		expectedRevision: 0,
		unit: {
			id: 'file-update',
			status: 'passed',
			samples: [{
				id: 'auditable',
				ok: true,
				metrics: { durationMs: 1 },
				raw: { exitCode: 0, expectedMatch: true },
			}],
		},
	}).authority.authoritative, true);
});

test('standalone raw summary supports nested finite metrics only', () => {
	assert.deepEqual(summarizeCheckpointSamples([
		{
			id: 'one',
			ok: true,
			metrics: {
				durationMs: 5,
				handler: { durationMs: 2 },
				ignored: null,
			},
		},
	]), {
		attempts: 1,
		successes: 1,
		metrics: {
			durationMs: { samples: 1, p50: 5, p95: 5, max: 5 },
			'handler.durationMs': { samples: 1, p50: 2, p95: 2, max: 2 },
		},
	});
});

test('concise orchestrator API records, assesses, and merges raw evidence safely', () => {
	const expectedIdentity = identity();
	const seed = createCheckpoint(expectedIdentity, ['file-update']);
	const completed = recordUnit(seed, unit('file-update', [3, 7]));
	const assessment = assessCheckpoint(completed, expectedIdentity);
	assert.equal(assessment.authoritative, true);
	assert.equal(assessment.summaries['file-update'].metrics.outerWallMs.p95, 7);
	assert.throws(
		() => assessCheckpoint(completed, identity({
			sessionIdentity: { sessionId: 'different-session' },
		})),
		/identity mismatch/u,
	);
	const merged = mergeRawSampleEvidence(
		[{ id: 'raw-1', ok: true, metrics: { durationMs: 2 } }],
		[{ id: 'raw-2', ok: true, metrics: { durationMs: 4 } }],
	);
	assert.equal(merged.summary.metrics.durationMs.p50, 2);
	assert.throws(
		() => mergeRawSampleEvidence(
			[{ id: 'duplicate', ok: true, metrics: {} }],
			[{ id: 'duplicate', ok: true, metrics: {} }],
		),
		/Duplicate checkpoint sample/u,
	);
});

test('only an exact pre-handler readiness failure permits one shard retry', () => {
	const safeFailure = {
		gate: { ok: false },
		baseline: {
			collection: { production: { status: 'failed' } },
			failure: {
				name: 'BenchmarkCliStatusError',
				timing: { handlerMs: 0 },
				runtimeEvidence: {
					failure: { code: 'live-settling' },
					status: null,
					postflightStatus: null,
					groupResults: null,
				},
			},
			rawSamples: [],
		},
		candidate: {
			collection: { production: { status: 'collected' } },
			rawSamples: [],
		},
	};
	assert.equal(isRetryablePreHandlerShardFailure(safeFailure, 1), true);
	assert.equal(isRetryablePreHandlerShardFailure(safeFailure, 0), false);
	assert.equal(isRetryablePreHandlerShardFailure({
		...safeFailure,
		baseline: {
			...safeFailure.baseline,
			failure: {
				...safeFailure.baseline.failure,
				timing: { handlerMs: 0.1 },
			},
		},
	}, 1), false);
	assert.equal(isRetryablePreHandlerShardFailure({
		...safeFailure,
		candidate: {
			...safeFailure.candidate,
			rawSamples: [{
				correctness: {
					apply: { status: 'outcome-unknown', mutationMayHaveApplied: true },
				},
			}],
		},
	}, 1), false);
	assert.equal(isRetryablePreHandlerShardFailure({
		...safeFailure,
		baseline: {
			...safeFailure.baseline,
			failure: {
				...safeFailure.baseline.failure,
				runtimeEvidence: {
					...safeFailure.baseline.failure.runtimeEvidence,
					command: 'mutation.apply',
					planRef: 'retained-plan',
				},
			},
		},
	}, 1), false);
});
