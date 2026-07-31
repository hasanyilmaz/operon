import assert from 'node:assert/strict';
import test from 'node:test';

import {
	auditStage7BatchUpdate,
	evaluateStage7Evidence,
	STAGE7_CHECKPOINT_PATH,
	STAGE7_PROFILE,
	STAGE7_REQUIRED_UNITS,
	STAGE7_RESULT_PATH,
	summarizeStage7Samples,
} from './cli-speed-stage7-core.mjs';

test('Stage 7 fixes the approved profile, units and private tmp paths', () => {
	assert.deepEqual(STAGE7_PROFILE, {
		probe: 5,
		workflow: 20,
		retention: 5,
		mixedLogicalUpdates: 75,
		soakLogicalUpdates: 300,
		maxBatchSize: 64,
	});
	assert.deepEqual(STAGE7_REQUIRED_UNITS, [
		'probe',
		'compact-update-single',
		'compact-update-5',
		'compact-update-20',
		'compact-update-64',
		'mixed-workflow',
		'soak',
	]);
	assert.equal(
		STAGE7_RESULT_PATH,
		'/private/tmp/operon-agent-runtime-results/cli-speed-stage7.json',
	);
	assert.equal(
		STAGE7_CHECKPOINT_PATH,
		'/private/tmp/operon-agent-runtime-results/stage7-close/checkpoint.json',
	);
});

test('batch audit requires ordered update-batch items, one source and verified apply', () => {
	const expected = [
		{ operonId: 'a', changes: [{ field: 'note', op: 'set', value: 'A' }] },
		{ operonId: 'b', changes: [{ field: 'dateDue', op: 'clear' }] },
	];
	const targets = expected.map(value => ({
		operonId: value.operonId,
		locator: { filePath: 'Tasks.md', line: 1 },
	}));
	const preview = {
		result: {
			plan: {
				spec: {
					operation: 'update-batch',
					items: expected.map((value, index) => ({
						itemRef: `item-${index}`,
						target: { operonId: value.operonId },
						changes: value.changes,
					})),
				},
				targets,
				updateBatchEffects: expected.map((value, index) => ({
					itemRef: `item-${index}`,
					operonId: value.operonId,
					locator: targets[index].locator,
					beforeDigest: 'a'.repeat(64),
					requestedCanonicalFields: value.changes.map(change => change.field),
					action: 'update',
					directChange: true,
					plannedSourceDigest: 'b'.repeat(64),
				})),
				atomicGroups: [{
					groupId: 'g',
					resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks.md' }],
				}],
			},
		},
	};
	const apply = {
		result: {
			status: 'applied',
			mutationMayHaveApplied: true,
			receipt: { terminalOutcome: 'applied' },
			groupResults: [{
				groupId: 'g',
				status: 'committed',
				resourceRevisions: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					revision: 'next',
				}],
			}],
			postflight: {
				status: 'verified',
				contextRevision: { indexGeneration: 2 },
				targets: expected.map(value => ({
					operonId: value.operonId,
					verified: true,
				})),
			},
		},
	};
	assert.deepEqual(auditStage7BatchUpdate(preview, apply, expected, true), {
		valid: true,
		verifiedIntents: 2,
		exactItems: true,
		exactTargets: true,
		exactEffects: true,
		oneAtomicSource: true,
		committed: true,
		postflightVerified: true,
		uncertain: false,
	});
	assert.equal(auditStage7BatchUpdate(preview, apply, expected).valid, false);
	const reordered = structuredClone(preview);
	reordered.result.plan.spec.items.reverse();
	assert.equal(auditStage7BatchUpdate(reordered, apply, expected, true).valid, false);
	const split = structuredClone(preview);
	split.result.plan.targets[1].locator.filePath = 'Other.md';
	assert.equal(auditStage7BatchUpdate(split, apply, expected, true).valid, false);
});

test('summaries retain every raw authoritative sample and logical update', () => {
	const samples = [
		{ ok: true, outerWallMs: 10, logicalUpdates: 5 },
		{ ok: false, outerWallMs: 20, logicalUpdates: 5 },
	];
	assert.deepEqual(summarizeStage7Samples(samples), {
		attempts: 2,
		successes: 1,
		logicalUpdates: 10,
		rawAuthoritative: true,
		correctnessFiltered: 0,
		performanceFiltered: 0,
		rawSamples: samples,
		outerWallMs: { samples: 2, p50: 10, p95: 20, max: 20 },
	});
});

test('complete evidence passes all Stage 7 correctness and speed gates', () => {
	const evidence = passingEvidence();
	assert.deepEqual(evaluateStage7Evidence(evidence), { ok: true, failures: [] });
});

test('single-update correctness does not require the batch-only per-target counter', () => {
	const evidence = passingEvidence();
	evidence.compactUpdateSingle.candidate.perTargetObserved = 0;
	assert.deepEqual(evaluateStage7Evidence(evidence), { ok: true, failures: [] });
});

test('300 logical soak cannot be replaced with 300 batch transactions', () => {
	const evidence = passingEvidence();
	evidence.soak.attempts = 300;
	evidence.soak.successes = 300;
	evidence.soak.rawSamples = Array.from(
		{ length: 300 },
		() => ({ ok: true, outerWallMs: 1, logicalUpdates: 1 }),
	);
	evidence.soak.dispatches = { p50: 3, p95: 3, max: 3 };
	evidence.soak.samePlanRef = 300;
	evidence.soak.unrelatedUnchanged = 300;
	evidence.soak.settingsUnchanged = 300;
	evidence.soak.sourceWrites = 300;
	evidence.soak.reindexes = 300;
	evidence.soak.settlements = 300;
	evidence.soak.receiptPersists = 300;
	evidence.soak.postflightParses = 300;
	const result = evaluateStage7Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes(
		'soak:must-use-successful-batches-not-one-command-per-logical-update',
	));
});

test('phase count and raw sample filtering violations fail closed', () => {
	const evidence = passingEvidence();
	evidence.compactUpdate20.candidate.reindexes -= 1;
	evidence.compactUpdate5.candidate.performanceFiltered = 1;
	const result = evaluateStage7Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes(
		'compact-update-20:correctness-and-exact-phase-evidence-required',
	));
	assert.ok(result.failures.includes(
		'compact-update-5:candidate:raw-unfiltered-authoritative-samples-required',
	));
});

function passingEvidence() {
	const single = pair(1, 20, 100, 100);
	single.baselineMode = 'stage6-authoritative-json';
	single.baseline.source = {
		path: '/private/tmp/operon-agent-runtime-results/cli-speed-stage6.json',
		cliDigest: 'a'.repeat(64),
	};
	return {
		probe: {
			...candidate(5, 5, 50),
			spanCounts: {
				commit: 5,
				reindex: 5,
				settlement: 5,
				'semantic-postflight': 5,
				'receipt-persist': 5,
			},
		},
		compactUpdateSingle: single,
		compactUpdate5: pair(5, 20, 20, 100),
		compactUpdate20: pair(20, 20, 10, 110),
		compactUpdate64: pair(64, 5, 10, 160),
		mixedWorkflow: candidate(3, 75, 30),
		soak: {
			...candidate(5, 300, 40),
			rssDeltaBytes: 1024,
			fdDelta: 0,
			socketDelta: 0,
			listenerDelta: 0,
			pendingAfter: 0,
		},
		bundle: { candidateBytes: 4_252_419 },
	};
}

function pair(size, attempts, candidateMs, baselineRepresentativeMs) {
	const value = candidate(attempts, attempts * size, candidateMs);
	const baselineRaw = Array.from({ length: attempts }, () => ({
		ok: true,
		outerWallMs: baselineRepresentativeMs * size,
		representativeWallMs: baselineRepresentativeMs,
		logicalUpdates: size,
		dispatches: size * 3,
		modeled: true,
		observedCommands: 1,
		equivalentModel: 'verified-single-command-linear',
	}));
	return {
		candidate: value,
		baseline: summarizeStage7Samples(baselineRaw),
	};
}

function candidate(attempts, logicalUpdates, outerWallMs) {
	const sizes = distribute(logicalUpdates, attempts);
	const raw = sizes.map(size => ({
		ok: true,
		outerWallMs,
		logicalUpdates: size,
		dispatches: 3,
	}));
	return {
		...summarizeStage7Samples(raw),
		verifiedIntents: logicalUpdates,
		uncertain: 0,
		samePlanRef: attempts,
		unrelatedUnchanged: attempts,
		settingsUnchanged: attempts,
		dispatches: { samples: attempts, p50: 3, p95: 3, max: 3 },
		sourceWrites: attempts,
		reindexes: attempts,
		settlements: attempts,
		receiptPersists: attempts,
		postflightParses: attempts,
		perTargetObserved: attempts,
	};
}

function distribute(total, groups) {
	const base = Math.floor(total / groups);
	return Array.from(
		{ length: groups },
		(_, index) => base + (index < total % groups ? 1 : 0),
	);
}
