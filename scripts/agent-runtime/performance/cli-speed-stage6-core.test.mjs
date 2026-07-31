import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
	auditStage6CreateApply,
	canonicalizeStage6ReadSemanticValue,
	diagnoseOutliers,
	evaluateStage6Evidence,
	migrateStage6CompactCheckpointV1,
	partitionStage6ReadGroups,
	recoverStage61InterruptedCheckpointV1,
	STAGE6_BASELINES,
	STAGE6_COMPACT_MIGRATION_UNITS,
	STAGE6_PROFILE,
	summarizeStage6Samples,
	summarizeStage6TransportEvidence,
} from './cli-speed-stage6-core.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));

function samples(count, outerWallMs = 10) {
	return Array.from({ length: count }, (_, index) => ({
		ok: true,
		outerWallMs: outerWallMs + index / 100,
	}));
}

function summary(count, outerWallMs = 10) {
	return summarizeStage6Samples(samples(count, outerWallMs));
}

function modeledSummary(count, size, outerWallMs) {
	const value = summary(count, outerWallMs);
	value.rawSamples.forEach(sample => {
		sample.modeled = true;
		sample.observedCommands = 1;
		sample.equivalentModel = 'verified-single-command-linear';
		sample.dispatches = size * 3;
		sample.representativeDispatches = 3;
		sample.representativeWallMs = sample.outerWallMs / size;
	});
	return value;
}

function passingEvidence() {
	const single = (baseline, candidate) => {
		const value = {
			attempts: 20,
			successes: 20,
			verified: 20,
			uncertain: 0,
			unrelatedUnchanged: 20,
			settingsUnchanged: 20,
			dispatches: { p50: 3, max: 3 },
			baselineOuterWallMs: { p50: baseline, p95: baseline },
			candidateOuterWallMs: { p50: candidate, p95: candidate, max: candidate },
			...summary(20, candidate),
		};
		value.rawSamples.forEach((sample, index) => {
			sample.baselineOuterWallMs = baseline + index / 100;
			sample.candidateOuterWallMs = sample.outerWallMs;
		});
		return value;
	};
	const compactGroup = (size, baselineMs, candidateMs, p50, p95) => ({
		baseline: {
			...modeledSummary(20, size, baselineMs),
			dispatches: { p50: size * 3, max: size * 3 },
		},
		candidate: {
			...summary(20, candidateMs),
			dispatches: { p50: 3, max: 3 },
			verifiedIntents: 20 * size,
			samePlanRef: 20,
			uncertain: 0,
			unrelatedUnchanged: 20,
			settingsUnchanged: 20,
		},
		speedup: { p50, p95 },
	});
	const sequentialReads = { ...summary(75, 20), requestsPerSecond: 90 };
	const groupedReads = {
		...summary(75, 10),
		requestsPerSecond: 150,
		logicalResults: 75,
		orderedResults: 75,
		socketFrames: Math.ceil(
			STAGE6_PROFILE.reads / STAGE6_PROFILE.readGroupSize,
		),
		requestFiles: 75,
		runtimeReads: 75,
		semanticMismatches: 0,
		commandCounts: {
			health: 18,
			'task.get': 19,
			'tasks.query': 19,
			'context.build': 19,
		},
	};
	groupedReads.rawSamples.forEach((sample, index) => {
		sample.responseReadyMs = null;
		sample.responseReadyObservation = 'not-observed';
		sample.commandFamily = [
			'task.get', 'tasks.query', 'context.build', 'health',
		][index % 4];
		sample.groupIndex = Math.floor(index / STAGE6_PROFILE.readGroupSize);
		sample.groupPosition = index % STAGE6_PROFILE.readGroupSize;
		sample.handlerMs = sample.outerWallMs - 2;
		sample.cliTotalMs = sample.outerWallMs - 1;
		sample.orderedCompletionMs = sample.outerWallMs;
		sample.amortizedLogicalCostMs = sample.outerWallMs / STAGE6_PROFILE.readGroupSize;
	});
	const structuralSmokeSamples = samples(STAGE6_PROFILE.readSmoke, 10);
	const structuralSmoke = {
		...summarizeStage6Samples(structuralSmokeSamples),
		logicalResults: STAGE6_PROFILE.readSmoke,
		orderedResults: STAGE6_PROFILE.readSmoke,
		socketFrames: Math.ceil(
			STAGE6_PROFILE.readSmoke / STAGE6_PROFILE.readGroupSize,
		),
		requestFiles: STAGE6_PROFILE.readSmoke,
		runtimeReads: STAGE6_PROFILE.readSmoke,
		fallbacks: 0,
		semanticMismatches: 0,
		groupSizes: [3, 3, 3, 3, 3, 3, 2],
		commandCounts: {
			health: 5,
			'task.get': 5,
			'tasks.query': 5,
			'context.build': 5,
		},
	};
	const readGroupSizes = partitionStage6ReadGroups(STAGE6_PROFILE.reads);
	const groupCount = readGroupSizes.length;
	const pairedGroupSamples = Array.from({ length: groupCount }, (_, groupIndex) => ({
		ok: true,
		outerWallMs: 80 + groupIndex / 100,
		groupIndex,
		pairOrder: groupIndex % 2 === 0
			? 'sequential-group'
			: 'group-sequential',
		size: readGroupSizes[groupIndex],
		sequentialWallMs: 100 + groupIndex / 100,
		groupWallMs: 80 + groupIndex / 100,
		makespanRatio:
			(80 + groupIndex / 100) / (100 + groupIndex / 100),
		makespanImprovementPercent:
			(20 / (100 + groupIndex / 100)) * 100,
		sequentialSemanticKeys: Array.from(
			{
				length: readGroupSizes[groupIndex],
			},
			(_, index) => `semantic-${groupIndex}-${index}`,
		),
		groupSemanticKeys: Array.from(
			{
				length: readGroupSizes[groupIndex],
			},
			(_, index) => `semantic-${groupIndex}-${index}`,
		),
	}));
	return {
		compactSingle: {
			families: {
				create: single(100, 95),
				update: single(100, 95),
			},
		},
		compactCreate5: compactGroup(5, 100, 30, 3.2, 3.1),
		compactCreate20: compactGroup(20, 1_300, 80, 13, 12),
		batchRetention: {
			batch20: {
				...summary(5, 10),
				baselineRawSamples: modeledSummary(5, 20, 130).rawSamples,
				speedup: 12,
			},
			batch64: {
				...summary(5, 10),
				baselineRawSamples: modeledSummary(5, 64, 230).rawSamples,
				speedup: 22,
			},
		},
		readBatch: {
			structuralSmoke,
			sequential: sequentialReads,
			grouped: groupedReads,
			pairedGroups: summarizeStage6Samples(pairedGroupSamples),
			speedup: 1.3,
			fallbacks: 0,
		},
		soak: {
			...summary(300, 10),
			rssDeltaBytes: 1_000_000,
			fdDelta: 0,
			socketDelta: 0,
			listenerDelta: 0,
			pendingAfter: 0,
		},
		negativeContract: { status: 'passed', mutationCalls: 0 },
		bundle: { candidateBytes: STAGE6_BASELINES.productionBundleBytes + 10_000 },
	};
}

test('Stage 6 evaluator accepts the light 5/20/75/300 profile with raw gates', () => {
	const result = evaluateStage6Evidence(passingEvidence());
	assert.deepEqual(result, { ok: true, failures: [] });
	assert.equal(STAGE6_PROFILE.workflow, 20);
	assert.equal(STAGE6_PROFILE.readSmoke, 20);
	assert.equal(STAGE6_PROFILE.reads, 75);
	assert.equal(STAGE6_PROFILE.readGroupSize, 3);
	assert.equal(STAGE6_PROFILE.soak, 300);
});

test('Stage 6 read grouping rebalances tails into bounded two-to-three item groups', () => {
	assert.deepEqual(partitionStage6ReadGroups(4), [2, 2]);
	assert.deepEqual(partitionStage6ReadGroups(7), [3, 2, 2]);
	assert.deepEqual(partitionStage6ReadGroups(10), [3, 3, 2, 2]);
	assert.deepEqual(partitionStage6ReadGroups(20), [3, 3, 3, 3, 3, 3, 2]);
	assert.deepEqual(partitionStage6ReadGroups(75), Array(25).fill(3));
	assert.throws(() => partitionStage6ReadGroups(1), /at least two logical reads/u);
});

test('read semantic canonicalization ignores observation tokens but retains revisions and results', () => {
	const base = {
		requestId: 'first',
		freshness: { observedAt: '2026-01-01T00:00:00Z' },
		page: {
			asOf: '2026-01-01T00:00:00Z',
			nextCursor: 'observation-bound-first',
			actualCount: 2,
		},
		contextRevision: {
			index: { sessionId: 'runtime-a', ramGeneration: 4 },
			settingsFingerprint: 'a'.repeat(64),
		},
		tasks: [{
			identity: { operonId: 'task001' },
			description: 'Stable result',
			sourceRevision: { contentDigest: 'b'.repeat(64) },
		}],
	};
	const observationDrift = structuredClone(base);
	observationDrift.requestId = 'second';
	observationDrift.freshness.observedAt = '2026-01-01T00:00:01Z';
	observationDrift.page.asOf = '2026-01-01T00:00:01Z';
	observationDrift.page.nextCursor = 'observation-bound-second';
	assert.deepEqual(
		canonicalizeStage6ReadSemanticValue(base),
		canonicalizeStage6ReadSemanticValue(observationDrift),
	);
	for (const mutate of [
		value => { value.contextRevision.index.ramGeneration += 1; },
		value => { value.tasks[0].sourceRevision.contentDigest = 'c'.repeat(64); },
		value => { value.tasks[0].description = 'Different result'; },
	]) {
		const drift = structuredClone(base);
		mutate(drift);
		assert.notDeepEqual(
			canonicalizeStage6ReadSemanticValue(base),
			canonicalizeStage6ReadSemanticValue(drift),
		);
	}
});

test('Stage 6 evaluator rejects filtered correctness and latency evidence', () => {
	const evidence = passingEvidence();
	evidence.compactCreate5.candidate.performanceFiltered = 1;
	evidence.compactCreate5.candidate.rawSamples.pop();
	const result = evaluateStage6Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes(
		'compact-create5:candidate:raw-unfiltered-samples-required',
	));
});

test('Stage 6 evaluator recomputes success cardinality from unfiltered raw samples', () => {
	const evidence = passingEvidence();
	evidence.compactCreate5.candidate.rawSamples[3].ok = false;
	const result = evaluateStage6Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes(
		'compact-create5:candidate:raw-unfiltered-samples-required',
	));
});

test('Stage 6 evaluator enforces dispatch, read-frame, regression and bundle gates', () => {
	const evidence = passingEvidence();
	evidence.compactCreate20.candidate.dispatches.max = 4;
	evidence.readBatch.grouped.socketFrames = 16;
	evidence.readBatch.structuralSmoke.socketFrames = 8;
	for (const sample of evidence.compactSingle.families.create.rawSamples) {
		sample.outerWallMs = 116;
		sample.candidateOuterWallMs = 116;
	}
	evidence.bundle.candidateBytes = STAGE6_BASELINES.productionBundleBytes + 25_000;
	const result = evaluateStage6Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes(
		'compact-create20:candidate-exactly-three-dispatches-required',
	));
	assert.ok(result.failures.includes(
		'read-batch:one-socket-frame-per-group-and-all-runtime-reads-required',
	));
	assert.ok(result.failures.includes(
		'read-batch:20-logical-structural-smoke-required',
	));
	assert.ok(result.failures.includes(
		'compact-single:create:p95-regressed-over-15-percent',
	));
	assert.ok(result.failures.includes('bundle:delta-must-be-below-25000-bytes'));
});

test('Stage 6 evaluator uses the approved compact and grouped-read performance floors', () => {
	const evidence = passingEvidence();
	for (const value of evidence.compactCreate5.candidate.rawSamples) value.outerWallMs = 34;
	for (const value of evidence.compactCreate20.candidate.rawSamples) value.outerWallMs = 109;
	evidence.readBatch.grouped.requestsPerSecond =
		evidence.readBatch.sequential.requestsPerSecond * 1.19;
	for (const value of evidence.readBatch.pairedGroups.rawSamples) {
		value.groupWallMs = 90;
		value.outerWallMs = 90;
		value.makespanRatio = value.groupWallMs / value.sequentialWallMs;
		value.makespanImprovementPercent =
			(value.sequentialWallMs - value.groupWallMs)
			/ value.sequentialWallMs * 100;
	}
	const result = evaluateStage6Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes('compact-create5:p50-speedup-below-3x'));
	assert.ok(result.failures.includes('compact-create20:p95-speedup-below-11.964x'));
	assert.ok(result.failures.includes('read-batch:speedup-below-1.2x'));
	assert.ok(result.failures.includes('read-batch:makespan-p50-improvement-below-15-percent'));
	assert.ok(result.failures.includes('read-batch:makespan-p95-improvement-below-15-percent'));
});

test('grouped reads gate paired makespan, every group and ordered completion separately', () => {
	const regressedGroup = passingEvidence();
	regressedGroup.readBatch.pairedGroups.rawSamples[0].groupWallMs = 101;
	let result = evaluateStage6Evidence(regressedGroup);
	assert.ok(result.failures.includes('read-batch:paired-group-makespan-evidence-required'));

	const orderedTail = passingEvidence();
	for (const sample of orderedTail.readBatch.grouped.rawSamples) {
		sample.outerWallMs = 100;
		sample.orderedCompletionMs = 100;
	}
	result = evaluateStage6Evidence(orderedTail);
	assert.ok(result.failures.includes('read-batch:ordered-completion-p95-regressed'));

	const mislabeledReady = passingEvidence();
	mislabeledReady.readBatch.grouped.rawSamples[0].responseReadyMs = 5;
	result = evaluateStage6Evidence(mislabeledReady);
	assert.ok(result.failures.includes('read-batch:timing-semantics-evidence-required'));

	const semanticDrift = passingEvidence();
	semanticDrift.readBatch.pairedGroups.rawSamples[0].groupSemanticKeys[0] =
		'actual-result-with-different-revision';
	result = evaluateStage6Evidence(semanticDrift);
	assert.ok(result.failures.includes('read-batch:paired-group-makespan-evidence-required'));

	const weakTail = passingEvidence();
	for (const slowest of weakTail.readBatch.pairedGroups.rawSamples.slice(-2)) {
		slowest.groupWallMs = slowest.sequentialWallMs * 0.99;
		slowest.outerWallMs = slowest.groupWallMs;
		slowest.makespanRatio = 0.99;
		slowest.makespanImprovementPercent = 1;
	}
	result = evaluateStage6Evidence(weakTail);
	assert.ok(result.failures.includes(
		'read-batch:makespan-p95-improvement-below-15-percent',
	));
});

test('Stage 6.1 migration preserves only sealed compact units and fails closed', () => {
	const seal = {
		checkpointRevision: 44,
		identityDigest: 'prior-identity',
		units: Object.fromEntries(STAGE6_COMPACT_MIGRATION_UNITS.map(unit => [
			unit,
			{ dependencyDigest: `old-${unit}`, evidenceDigest: `evidence-${unit}` },
		])),
	};
	const checkpoint = {
		revision: 44,
		units: Object.fromEntries([
			...STAGE6_COMPACT_MIGRATION_UNITS.map(unit => [
				unit,
				{
					status: 'passed',
					dependencyDigest: `old-${unit}`,
					evidenceDigest: `evidence-${unit}`,
				},
			]),
			['read-batch', { status: 'passed' }],
			['soak', { status: 'passed' }],
			['negative-contract', { status: 'passed' }],
		]),
	};
	const input = {
		checkpoint,
		priorFinal: {
			suite: 'operon-cli-speed-stage6',
			checkpoint: { revision: 44 },
		},
		seal,
		priorIdentityDigest: 'prior-identity',
		currentSafetyIdentityMatches: true,
		actualEvidenceDigests: Object.fromEntries(
			STAGE6_COMPACT_MIGRATION_UNITS.map(unit => [unit, `evidence-${unit}`]),
		),
		newDependencyDigests: Object.fromEntries(
			STAGE6_COMPACT_MIGRATION_UNITS.map(unit => [unit, `new-${unit}`]),
		),
	};
	const result = migrateStage6CompactCheckpointV1(input);
	assert.equal(result.migrated, true);
	assert.equal(result.checkpoint.revision, 45);
	assert.deepEqual(Object.keys(result.checkpoint.units).sort(), [
		'batch-retention', 'compact-create20', 'compact-create5', 'compact-single',
	]);
	assert.equal(result.checkpoint.units['compact-single'].dependencyDigest, 'new-compact-single');
	assert.equal(checkpoint.units['compact-single'].dependencyDigest, 'old-compact-single');

	for (const mutate of [
		value => { value.priorIdentityDigest = 'wrong'; },
		value => { value.currentSafetyIdentityMatches = false; },
		value => { value.actualEvidenceDigests['compact-create5'] = 'wrong'; },
		value => { value.checkpoint.units['compact-create20'].dependencyDigest = 'wrong'; },
	]) {
		const candidate = structuredClone(input);
		mutate(candidate);
		const rejected = migrateStage6CompactCheckpointV1(candidate);
		assert.equal(rejected.migrated, false);
		assert.deepEqual(rejected.checkpoint, candidate.checkpoint);
	}
});

test('interrupted Stage 6.1 recovery keeps current single and sealed heavy compact units', () => {
	const seal = {
		checkpointRevision: 46,
		identityDigest: 'interrupted-identity',
		units: {
			'compact-single': { dependencyDigest: 'current-single', evidenceDigest: 'single-evidence' },
			'compact-create20': { dependencyDigest: 'old-20', evidenceDigest: '20-evidence' },
			'batch-retention': { dependencyDigest: 'old-retention', evidenceDigest: 'retention-evidence' },
		},
	};
	const checkpoint = {
		revision: 46,
		units: {
			'compact-single': {
				status: 'passed', dependencyDigest: 'current-single', evidenceDigest: 'single-evidence',
			},
			'compact-create5': { status: 'failed' },
			'compact-create20': {
				status: 'passed', dependencyDigest: 'old-20', evidenceDigest: '20-evidence',
			},
			'batch-retention': {
				status: 'passed',
				dependencyDigest: 'old-retention',
				evidenceDigest: 'retention-evidence',
			},
			'read-batch': { status: 'passed' },
			soak: { status: 'passed' },
			'negative-contract': { status: 'passed' },
		},
	};
	const input = {
		checkpoint,
		priorFinal: {
			suite: 'operon-cli-speed-stage6',
			checkpoint: { revision: 46 },
		},
		seal,
		priorIdentityDigest: 'interrupted-identity',
		currentSafetyIdentityMatches: true,
		actualEvidenceDigests: {
			'compact-single': 'single-evidence',
			'compact-create20': '20-evidence',
			'batch-retention': 'retention-evidence',
		},
		newDependencyDigests: {
			'compact-single': 'current-single',
			'compact-create20': 'new-20',
			'batch-retention': 'new-retention',
		},
	};
	const result = recoverStage61InterruptedCheckpointV1(input);
	assert.equal(result.migrated, true);
	assert.equal(result.checkpoint.revision, 47);
	assert.deepEqual(Object.keys(result.checkpoint.units).sort(), [
		'batch-retention', 'compact-create20', 'compact-single',
	]);
	assert.equal(result.checkpoint.units['compact-create20'].dependencyDigest, 'new-20');

	for (const mutate of [
		value => { value.priorIdentityDigest = 'wrong'; },
		value => { value.actualEvidenceDigests['compact-single'] = 'wrong'; },
		value => { value.newDependencyDigests['compact-single'] = 'different-current'; },
		value => { value.checkpoint.units['batch-retention'].evidenceDigest = 'wrong'; },
	]) {
		const candidate = structuredClone(input);
		mutate(candidate);
		assert.equal(recoverStage61InterruptedCheckpointV1(candidate).migrated, false);
	}
});

test('diagnostic outliers never alter raw authoritative statistics', () => {
	const raw = samples(20, 10);
	raw[7] = { ok: true, outerWallMs: 500 };
	const result = summarizeStage6Samples(raw);
	assert.equal(result.rawSamples.length, 20);
	assert.equal(result.outerWallMs.max, 500);
	assert.equal(result.performanceFiltered, 0);
	assert.deepEqual(diagnoseOutliers(raw.map(value => value.outerWallMs)).map(value => value.index), [7]);
});

test('transport aggregation preserves one frame and per-completed-child counters', () => {
	const records = Array.from(
		{
			length: Math.ceil(
				STAGE6_PROFILE.reads / STAGE6_PROFILE.readGroupSize,
			),
		},
		(_, groupIndex) => {
			const groupSize = Math.min(
				STAGE6_PROFILE.readGroupSize,
				STAGE6_PROFILE.reads - groupIndex * STAGE6_PROFILE.readGroupSize,
			);
			return [
			...Array.from({ length: groupSize }, () => ({
				transport: 'persistent',
			})),
			...Array.from({ length: groupSize }, (_, index) => ({
				transport: 'persistent',
				batchSize: groupSize,
				batchIndex: index,
				socketFrames: index === groupIndex % groupSize ? 1 : 0,
				requestFiles: 1,
				runtimeReads: 1,
				groupIndex,
			})),
			];
		},
	).flat();
	assert.deepEqual(summarizeStage6TransportEvidence(records), {
		socketFrames: Math.ceil(
			STAGE6_PROFILE.reads / STAGE6_PROFILE.readGroupSize,
		),
		requestFiles: 75,
		runtimeReads: 75,
		fallbacks: 0,
	});
});

test('create apply audit rejects wrong locator, revision and effect cardinality', () => {
	const description = 'Stage 6 exact create';
	const revision = {
		settingsFingerprint: 'a'.repeat(64),
		taskSourceGeneration: 1,
	};
	const preview = {
		result: {
			plan: {
				spec: {
					operation: 'create',
					items: [{ itemRef: 'compact-1', description }],
				},
				createEffects: [{
					itemRef: 'compact-1',
					operonId: 'created001',
					locator: { representation: 'inline', filePath: 'Tasks/Stage6.md', lineNumber: 1 },
					renderedTaskDigest: 'b'.repeat(64),
					plannedSourceDigest: 'c'.repeat(64),
				}],
				affectedResources: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks/Stage6.md',
					revision: 'before',
				}],
				atomicGroups: [{
					groupId: 'task-source:Tasks/Stage6.md',
					order: 0,
					resources: [{
						resourceKind: 'task-source',
						resourceKey: 'Tasks/Stage6.md',
					}],
				}],
			},
		},
	};
	const apply = {
		result: {
			status: 'applied',
			mutationMayHaveApplied: true,
			groupResults: [{
				groupId: 'task-source:Tasks/Stage6.md',
				status: 'committed',
				resourceRevisions: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks/Stage6.md',
					revision: 'after',
				}],
			}],
			receipt: { terminalOutcome: 'applied' },
			postflight: { status: 'verified', contextRevision: revision },
		},
	};
	assert.equal(auditStage6CreateApply(preview, apply, [description]).valid, true);
	for (const mutate of [
		value => { value.result.plan.createEffects.push(structuredClone(value.result.plan.createEffects[0])); },
		value => { value.result.plan.createEffects[0].locator.filePath = 'Tasks/Wrong.md'; },
		(_value, result) => { delete result.result.groupResults[0].resourceRevisions; },
	]) {
		const candidatePreview = structuredClone(preview);
		const candidateApply = structuredClone(apply);
		mutate(candidatePreview, candidateApply);
		assert.equal(
			auditStage6CreateApply(candidatePreview, candidateApply, [description]).valid,
			false,
		);
	}
});

test('Stage 6 runner is vault-pinned, checkpointed and uses canonical batch interfaces', () => {
	const live = readFileSync(path.join(directory, 'cli-speed-stage6-live.mjs'), 'utf8');
	const worker = readFileSync(path.join(directory, 'cli-speed-stage6-session.mjs'), 'utf8');
	assert.match(live, /cli-speed-stage6\.json/u);
	assert.match(live, /stage6-close/u);
	assert.match(live, /assertCliSpeedStage1Vault\(CLI_SPEED_STAGE1_VAULT/u);
	assert.match(live, /dependencyDigest\(unit, identity\)/u);
	assert.match(live, /artifactDomain/u);
	assert.match(live, /sourceFunctionsDigest/u);
	assert.match(live, /SEALED_STAGE51_CLI_SHA256/u);
	assert.match(worker, /'compact-lines'/u);
	assert.match(worker, /reads: groupedFrames/u);
	assert.match(worker, /responseReadyObservation: 'not-observed'/u);
	assert.match(worker, /amortizedLogicalCostMs/u);
	assert.match(worker, /\(Math\.abs\(index\) \+ 1\) % commands\.length/u);
	assert.match(worker, /collectReadStructuralSmoke/u);
	assert.match(
		worker,
		/let structuralSmoke;[\s\S]+structuralSmoke = await collectReadStructuralSmoke\(session\)/u,
	);
	assert.ok(
		worker.indexOf('evaluateStage6ReadSmoke(structuralSmoke')
			< worker.indexOf('partitionStage6ReadGroups(STAGE6_PROFILE.reads)'),
		'Structural smoke must fail before the authoritative read schedule starts.',
	);
	assert.match(worker, /readObservedSemanticKey/u);
	assert.match(worker, /contextRevision/u);
	assert.match(worker, /handlerMs/u);
	assert.match(worker, /groupPosition/u);
	assert.match(worker, /STAGE6_PROFILE\.soak/u);
	assert.doesNotMatch(worker, /\.filter\([^)]*outlier/iu);
});
