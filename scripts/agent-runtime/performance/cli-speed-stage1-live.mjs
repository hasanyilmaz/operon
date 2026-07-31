#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { hostname, platform, release } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
	assertCliSpeedStage1Vault,
	buildStage1Evidence,
	CLI_SPEED_STAGE1_RESULTS_DIRECTORY,
	CLI_SPEED_STAGE1_RESULT_PATH,
	CLI_SPEED_STAGE1_VAULT,
	classifyApplyCorrectness,
	percentile,
} from './cli-speed-stage1-core.mjs';

assert.equal(process.platform, 'darwin', 'Live CLI speed Stage 1 currently requires macOS.');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const liveOptions = parseLiveArguments();
const comparePath = liveOptions.compare;
const smoke = process.env.OPERON_CLI_SPEED_SMOKE === '1';
const resultPath = process.env.OPERON_CLI_SPEED_RESULT_PATH ?? (smoke
	? path.join(CLI_SPEED_STAGE1_RESULTS_DIRECTORY, 'cli-speed-stage1-smoke.json')
	: CLI_SPEED_STAGE1_RESULT_PATH);
const readinessTimeoutMs = sampleCount('OPERON_CLI_SPEED_READINESS_TIMEOUT_MS', 90_000);
const allowLegacyProbe = process.env.OPERON_CLI_SPEED_ALLOW_LEGACY_PROBE === '1';
const counts = {
	cold: sampleCount('OPERON_CLI_SPEED_COLD_SAMPLES', 10),
	warm: sampleCount('OPERON_CLI_SPEED_WARM_SAMPLES', 30),
	warmup: sampleCount('OPERON_CLI_SPEED_WARMUPS', 3, true),
	batch: sampleCount('OPERON_CLI_SPEED_BATCH_SAMPLES', 20),
	batchWarmup: sampleCount('OPERON_CLI_SPEED_BATCH_WARMUPS', 3, true),
};
const REQUIRED_PROBE_SPANS = new Set([
	'settings-refresh',
	'pre-read-settlement',
	'revision-before',
	'projection',
	'revision-after',
	'lock-wait',
	'receipt-health',
	'receipt-admission-open',
	'receipt-admission-probe-snapshot',
	'receipt-admission-validate-prune',
	'receipt-admission-commit',
	'receipt-admission-clone',
	'vault-identity',
	'receipt-lookup',
	'journal-lookup',
	'context-revision',
	'prepare',
	'commit',
	'reindex',
	'settlement',
	'settlement-index-side-effects-flush',
	'semantic-postflight',
	'receipt-persist',
	'receipt-terminal-metadata-journal',
	'receipt-terminal-generation-plan',
	'receipt-terminal-validate-prune',
	'receipt-terminal-commit',
]);
const LEGACY_REQUIRED_PROBE_SPANS = new Set([
	'settings-refresh',
	'pre-read-settlement',
	'revision-before',
	'projection',
	'revision-after',
	'lock-wait',
	'receipt-lookup',
	'prepare',
	'commit',
	'reindex',
	'settlement',
	'semantic-postflight',
	'receipt-persist',
]);
const TARGETED_FAMILY_ALLOWLIST = new Set([
	'task-get-warm',
	'file-update-core',
	'file-update-characterization',
	'batch-1',
	'batch-20',
	'batch-64',
	'human-compact-create',
	'human-exact-update',
]);
const selectedFamilies = resolveSelectedFamilies(liveOptions.families);
const targetedCollection = selectedFamilies !== null;
let probeCliSubspans = [];
if (smoke) {
	for (const key of Object.keys(counts)) counts[key] = key.includes('Warmup') ? 0 : 1;
	counts.warmup = 0;
}

buildStage1Artifacts();
assert.equal(existsSync(cliArtifact), true, `Operon CLI artifact is missing: ${cliArtifact}`);
mkdirSync(CLI_SPEED_STAGE1_RESULTS_DIRECTORY, { recursive: true });
ensureGuardedVaultExists();
ensureObsidianRunning();

let completed = false;
let benchmarkError;
let lastReadinessEvidence = null;
let measuredMutationCount = 0;
try {
	resetProductionVault();
	const collection = collectProductionMatrix(selectedFamilies);
	const fileUpdateCharacterization = (
		selectedFamilies === null
			? liveOptions.stage2
			: selectedFamilies.has('file-update-characterization')
	)
		? collectFileUpdateCharacterization()
		: undefined;
	const tailCharacterization = liveOptions.tail ? collectTailCharacterization() : undefined;
	const concurrencyCharacterization = liveOptions.concurrency
		? await collectConcurrencyCharacterization()
		: undefined;
	const probeStageTimings = collectProbeDiagnostics(selectedFamilies);
	const collectedProbeSpans = new Set(probeStageTimings.map(timing => timing.span));
	assert.equal(probeStageTimings.length > 0, true, 'Probe timing sink returned no spans.');
	for (const span of requiredProbeSpans(selectedFamilies)) {
		assert.equal(collectedProbeSpans.has(span), true, `Probe timing span is missing: ${span}`);
	}
	const baseline = comparePath ? JSON.parse(readFileSync(path.resolve(comparePath), 'utf8')) : undefined;
	const fixtureDigest = fileUpdateCharacterization
		? combinedFixtureDigest(
			collection.fixtureDigest,
			fileUpdateCharacterization.fixtureDigest,
		)
		: collection.fixtureDigest;
	const evidence = buildStage1Evidence({
		environment: environmentEvidence(),
		artifacts: artifactEvidence(),
		fixtureDigest,
		samples: collection.samples,
		scenarioMetadata: collection.scenarioMetadata,
		batchSpeedups: collection.batchSpeedups,
		probeStageTimings,
		baseline,
	});
	evidence.diagnostics = {
		...(evidence.diagnostics ?? {}),
		cliProbeSubspans: probeCliSubspans,
	};
	evidence.collection = {
		mode: targetedCollection ? 'targeted' : smoke ? 'smoke' : 'core',
		counts,
		production: {
			status: 'collected',
			authoritativeForGates: !smoke && !targetedCollection,
		},
		probe: {
			status: 'collected',
			authoritativeForGates: false,
			spanCount: probeStageTimings.length,
			attributedSpanCount: probeStageTimings.filter(
				timing => timing.scenario !== 'unattributed',
			).length,
			orphanSpanCount: probeStageTimings.filter(
				timing => timing.scenario === 'unattributed',
			).length,
		},
		notCollected: [
			...(liveOptions.tail ? [] : ['tail']),
			...(liveOptions.concurrency ? [] : ['concurrency']),
		],
	};
	if (targetedCollection) {
		evidence.collection.selectedFamilies = [...selectedFamilies];
	}
	evidence.agentWorkflows = collection.agentWorkflows;
	evidence.agentWorkflowSamples = collection.agentWorkflowSamples;
	evidence.humanOneLineWorkflows = collection.humanOneLineWorkflows;
	evidence.humanOneLineSamples = collection.humanOneLineSamples;
	evidence.correctnessSamples = collection.samples
		.filter(sample => sample.kind === 'mutation')
		.map(sample => ({
			sampleId: sample.sampleId,
			scenario: sample.scenario,
			correctness: sample.correctness,
		}));
		if (liveOptions.stage2 || targetedCollection) {
			if (liveOptions.stage2) {
				evidence.suite = 'operon-cli-speed-stage2-candidate';
			} else {
				evidence.suite = 'operon-cli-speed-stage3-targeted';
			}
		evidence.rawSamples = collection.samples;
		if (fileUpdateCharacterization) {
			evidence.fileUpdateCharacterization = fileUpdateCharacterization;
		}
		if (
			fileUpdateCharacterization
			&& fileUpdateCharacterization.ok !== true
		) {
			evidence.gates.ok = false;
			evidence.gates.failures.push('file-update-characterization:all-attempts-not-met');
		}
	}
	if (tailCharacterization) evidence.tail = tailCharacterization;
	if (concurrencyCharacterization) evidence.concurrency = concurrencyCharacterization;
	const smokeCorrectnessOk = Object.values(evidence.scenarios).every(
		scenario => scenario.successes === scenario.attempts,
	);
	const targetedCorrectnessOk = smokeCorrectnessOk
		&& Object.values(collection.humanOneLineSamples)
			.flat()
			.every(sample => sample.ok === true)
		&& (fileUpdateCharacterization?.ok ?? true);
	evidence.collection.performanceGatesAuthoritative = !smoke && !targetedCollection;
	evidence.collection.exitGate = targetedCollection
		? { kind: 'targeted-correctness', ok: targetedCorrectnessOk }
		: smoke
		? { kind: 'correctness-smoke', ok: smokeCorrectnessOk }
		: { kind: 'performance', ok: evidence.gates.ok };
	writeFileSync(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	completed = targetedCollection
		? targetedCorrectnessOk
		: smoke
			? smokeCorrectnessOk
			: evidence.gates.ok;
} catch (error) {
	benchmarkError = error;
	if (targetedCollection) {
		try {
			const failureEvidence = {
				schemaVersion: 1,
				suite: 'operon-cli-speed-stage3-targeted',
				recordedAt: new Date().toISOString(),
				environment: environmentEvidence(),
				artifacts: artifactEvidence(),
				collection: {
					mode: 'targeted',
					selectedFamilies: [...selectedFamilies],
					counts,
					production: { status: 'failed', authoritativeForGates: false },
					probe: { status: 'not-completed', authoritativeForGates: false },
					performanceGatesAuthoritative: false,
					exitGate: { kind: 'targeted-correctness', ok: false },
				},
				failure: serializeBenchmarkError(error),
				lastReadinessEvidence,
				measuredMutationCount,
			};
			writeFileSync(resultPath, `${JSON.stringify(failureEvidence, null, 2)}\n`, 'utf8');
			process.stdout.write(`${JSON.stringify(failureEvidence, null, 2)}\n`);
		} catch (failureWriteError) {
			benchmarkError = new AggregateError(
				[error, failureWriteError],
				'Targeted benchmark and failure-evidence persistence both failed.',
			);
		}
	}
} finally {
	// A benchmark never leaves its mutations behind, including after an assertion failure.
	try {
		restoreProductionVault();
	} catch (restoreError) {
		if (benchmarkError) {
			throw new AggregateError(
				[benchmarkError, restoreError],
				'Stage 1 benchmark and final production-vault restore both failed.',
			);
		}
		throw restoreError;
	}
}
if (benchmarkError) throw benchmarkError;
if (!completed) process.exitCode = 1;

function collectProductionMatrix(selection = null) {
	const samples = [];
	const scenarioMetadata = {};
	const batchTotals = new Map();

	if (selection === null) {
		for (const command of ['health', 'capabilities', 'catalog', 'creation-context']) {
			const scenario = `${command}.cold`;
			scenarioMetadata[scenario] = { warm: false, phase: 'read', family: command };
			for (let index = 0; index < counts.cold; index += 1) {
				const configRoot = freshConfigRoot(`cold-${command}`);
				try {
					const envelope = command === 'creation-context'
						? runCliReadWithRetry(['context'], creationContextRequest(), configRoot)
						: runSimpleReadWithRetry(command, configRoot);
					const verified = command === 'health'
						? isReadyHealth(envelope)
						: command === 'catalog'
							? envelope.ok === true && envelope.result?.ok === true
							: command === 'creation-context'
								? envelope.ok === true
									&& envelope.result?.ok === true
									&& envelope.result?.projection === 'creation-context'
							: envelope.ok === true && Array.isArray(envelope.result);
					samples.push(readSample(scenario, `cold-${command}-${index}`, envelope, verified));
				} finally {
					rmSync(configRoot, { recursive: true, force: true });
				}
			}
		}
	}

	if (selection === null || selection.has('task-get-warm')) {
		const readConfig = freshConfigRoot('warm-reads');
		try {
			for (const [scenario, operation] of [
			['task-get.warm', () => runCliReadWithRetry(
				['task', 'get'],
				{
					contractVersion: 1,
					requestId: `stage1-task-${randomUUID()}`,
					kind: 'task-get',
					selector: { kind: 'operon-id', operonId: 'inln001' },
					consistency: 'live-verified',
				},
				readConfig,
			)],
			['query.warm', () => runCliReadWithRetry(
				['query'],
				{
					contractVersion: 1,
					requestId: `stage1-query-${randomUUID()}`,
					kind: 'task-query',
					consistency: 'live-verified',
					filters: { filePath: 'Daily/2026-01-15.md' },
					limit: 10,
				},
				readConfig,
			)],
			['context-pack.warm', () => runCliReadWithRetry(
				['context'],
				smallContextPackRequest(),
				readConfig,
			)],
			].filter(([scenario]) => (
				selection === null || scenario === 'task-get.warm'
			))) {
				scenarioMetadata[scenario] = {
					warm: true,
					phase: 'read',
					family: scenario.split('.')[0],
				};
				for (let index = 0; index < counts.warmup + counts.warm; index += 1) {
					const envelope = operation();
					if (index >= counts.warmup) {
						samples.push(readSample(
							scenario,
							`${scenario}-${index - counts.warmup}`,
							envelope,
							envelope.ok === true && envelope.result?.ok === true,
						));
					}
				}
			}
		} finally {
			rmSync(readConfig, { recursive: true, force: true });
		}
		assert.equal(
			waitUntilReady(readinessTimeoutMs),
			true,
			'Runtime did not recover after the measured warm-read family.',
		);
	}

	const workflowResults = {};
	const humanOneLineResults = {
		create: [],
		update: [],
	};
	const mutationAttempts = counts.warmup + counts.warm;
	const batchAttempts = counts.batchWarmup + counts.batch;
	const mutationFamilies = (selection === null ? [
		'update',
		'transition',
		'file-update',
		'reminder',
		'timer',
		'relocate',
		'conversion',
		'delete',
		'compact-create',
		'typed-create-single',
	] : [
		...(selection.has('file-update-core') ? ['file-update'] : []),
	]);
	const batchSizes = selection === null
		? [1, 5, 20, 64]
		: [1, 20, 64].filter(size => selection.has(`batch-${size}`));
	const fixtureFamilies = [
		...mutationFamilies,
		...(selection?.has('human-exact-update') ? ['update'] : []),
	];
	const fixtureDigest = prepareCanonicalFixtureDigest(
		mutationAttempts,
		batchAttempts,
		{
			families: fixtureFamilies,
			batchSizes,
		},
	);
	for (const family of mutationFamilies) {
		resetAndPrepareCoreFixtures(mutationAttempts, batchAttempts, {
			families: [family],
			batchSizes: [],
		});
		const configRoot = freshConfigRoot(`mutation-${family}`);
		try {
			scenarioMetadata[`${family}.preview`] = { warm: true, phase: 'preview', family };
			scenarioMetadata[`${family}.apply`] = { warm: true, phase: 'apply', family };
			for (let index = 0; index < mutationAttempts; index += 1) {
				if (index >= counts.warmup) measuredMutationCount += 1;
				const result = runMutationFamily(family, index, configRoot);
				if (index >= counts.warmup) {
					pushMutationSamples(
						samples,
						family,
						index - counts.warmup,
						result,
					);
					if (family === 'update' || family === 'compact-create') {
						(workflowResults[family] ??= []).push({
							totalMs: result.workflowMs,
							runtimeCalls: result.runtimeCalls,
							retryCount: result.workflowRetries ?? 0,
						});
					}
				}
			}
		} finally {
			rmSync(configRoot, { recursive: true, force: true });
		}
	}

	if (selection === null) {
		resetAndPrepareCoreFixtures(mutationAttempts, batchAttempts, {
			families: ['update'],
			batchSizes: [],
		});
		const humanOneLineConfig = freshConfigRoot('human-one-line');
		try {
			for (let index = 0; index < mutationAttempts; index += 1) {
				if (index >= counts.warmup) measuredMutationCount += 2;
				const create = runHumanOneLineCompactCreate(index, humanOneLineConfig);
				const update = runHumanOneLineExactUpdate(index, humanOneLineConfig);
				if (index >= counts.warmup) {
					humanOneLineResults.create.push(create);
					humanOneLineResults.update.push(update);
				}
			}
		} finally {
			rmSync(humanOneLineConfig, { recursive: true, force: true });
		}
	} else {
		for (const humanFamily of ['human-compact-create', 'human-exact-update']) {
			if (!selection.has(humanFamily)) continue;
			resetAndPrepareCoreFixtures(mutationAttempts, batchAttempts, {
				families: humanFamily === 'human-exact-update' ? ['update'] : [],
				batchSizes: [],
			});
			const humanOneLineConfig = freshConfigRoot(humanFamily);
			try {
				for (let index = 0; index < mutationAttempts; index += 1) {
					if (index >= counts.warmup) measuredMutationCount += 1;
					const result = humanFamily === 'human-compact-create'
						? runHumanOneLineCompactCreate(index, humanOneLineConfig)
						: runHumanOneLineExactUpdate(index, humanOneLineConfig);
					if (index >= counts.warmup) {
						const resultKey = humanFamily === 'human-compact-create' ? 'create' : 'update';
						humanOneLineResults[resultKey].push(result);
					}
				}
			} finally {
				rmSync(humanOneLineConfig, { recursive: true, force: true });
			}
		}
	}

	for (const size of batchSizes) {
		resetAndPrepareCoreFixtures(mutationAttempts, batchAttempts, {
			families: [],
			batchSizes: [size],
		});
		const configRoot = freshConfigRoot(`batch-${size}`);
		try {
			const totalAttempts = batchAttempts;
			const family = `batch-create-${size}`;
			scenarioMetadata[`${family}.preview`] = { warm: true, phase: 'preview', family };
			scenarioMetadata[`${family}.apply`] = { warm: true, phase: 'apply', family };
			const totals = [];
			for (let index = 0; index < totalAttempts; index += 1) {
				if (index >= counts.batchWarmup) measuredMutationCount += 1;
				const result = runBatchCreate(size, index, configRoot);
				cleanupBatchTarget(size, index, configRoot);
				if (index >= counts.batchWarmup) {
					pushMutationSamples(samples, family, index - counts.batchWarmup, result);
					totals.push(result.workflowMs);
					(workflowResults[family] ??= []).push({
						totalMs: result.workflowMs,
						runtimeCalls: result.runtimeCalls,
						retryCount: result.workflowRetries ?? 0,
					});
				}
			}
			batchTotals.set(size, totals);
		} finally {
			rmSync(configRoot, { recursive: true, force: true });
		}
	}

	const batchOneP50 = percentile(batchTotals.get(1) ?? [], 0.5);
	const batchSpeedups = {};
	for (const size of [20, 64]) {
		const batchP50 = percentile(batchTotals.get(size) ?? [], 0.5);
		batchSpeedups[size] = Number.isFinite(batchOneP50) && Number.isFinite(batchP50)
			? (batchOneP50 * size) / batchP50
			: null;
	}
	return {
		samples,
		scenarioMetadata,
		batchSpeedups,
		fixtureDigest,
		agentWorkflows: summarizeAgentWorkflows(workflowResults),
		agentWorkflowSamples: workflowResults,
		humanOneLineWorkflows: summarizeHumanOneLineWorkflows(humanOneLineResults),
		humanOneLineSamples: humanOneLineResults,
	};
}

function resetAndPrepareCoreFixtures(mutationAttempts, batchAttempts, options) {
	resetProductionVaultForFixturePreparation();
	prepareCoreFixtures(mutationAttempts, batchAttempts, options);
	reloadAppAndWaitReady();
}

function prepareCanonicalFixtureDigest(mutationAttempts, batchAttempts, options) {
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	disableOperonForReset();
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		'--production',
		'--allow-active-vault-ephemera',
		CLI_SPEED_STAGE1_VAULT,
	]);
	prepareCoreFixtures(mutationAttempts, batchAttempts, options);
	return digestVaultFixtures();
}

function collectProbeDiagnostics(selection = null) {
	const probePath = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
	assert.equal(existsSync(probePath), true, `Probe bundle is missing: ${probePath}`);
	const mutationSamples = sampleCount(
		'OPERON_CLI_SPEED_PROBE_MUTATION_SAMPLES',
		1,
	);
	const probeFileUpdate = selection === null
		? liveOptions.stage2
		: selection.has('file-update-core') || selection.has('file-update-characterization');
	const probeBatchSizes = selection === null
		? (liveOptions.stage2 ? [1, 20, 64] : [])
		: [1, 20, 64].filter(size => selection.has(`batch-${size}`));
	const probeUpdate = selection === null
		|| selection.has('human-exact-update');
	const probeCompactCreate = selection?.has('human-compact-create') === true;
	resetProbeVaultForFixturePreparation();
	prepareCoreFixtures(mutationSamples, 1, {
		families: [
			...(probeUpdate ? ['update'] : []),
			...(probeFileUpdate ? ['file-update'] : []),
			...(probeCompactCreate ? ['compact-create'] : []),
		],
		batchSizes: probeBatchSizes,
	});
	reloadAppAndWaitReady();
	const configRoot = freshConfigRoot('probe-diagnostics');
	try {
		const correlations = new Map();
		const record = (scenario, sample, result) => {
			for (const phase of ['preview', 'apply']) {
				const envelope = result[phase];
				if (typeof envelope?.requestId === 'string') {
					correlations.set(envelope.requestId, {
						scenario,
						phase,
						sample,
						handlerMs: envelope.timing?.handlerMs,
					});
				}
			}
		};
		const read = readTask('inln001', configRoot);
		if (typeof read.requestId === 'string') {
			correlations.set(read.requestId, {
				scenario: 'task-get',
				phase: 'read',
				sample: 0,
				handlerMs: read.timing?.handlerMs,
			});
		}
		for (let sample = 0; sample < mutationSamples; sample += 1) {
			if (probeUpdate) {
				record('update', sample, runUpdateMutation(sample, configRoot));
			}
			if (probeCompactCreate) {
				record('compact-create', sample, runCompactCreate(sample, configRoot));
			}
		}
		if (probeFileUpdate) {
			record('file-update', 0, runFileUpdateMutation(0, configRoot));
		}
		for (const size of probeBatchSizes) {
			const batch = runBatchCreate(size, 0, configRoot);
			record(`batch-create-${size}`, 0, batch);
			cleanupBatchTarget(size, 0, configRoot);
		}
		const result = spawnSync('obsidian', [
			'vault=cli-test-vault',
			'operon:transport-probe',
			'operation=timings',
			'requestId=stage1-timing-drain',
		], {
			cwd: pluginRoot,
			encoding: 'utf8',
			maxBuffer: 8 * 1_024 * 1_024,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const response = JSON.parse(result.stdout);
		assert.equal(response.ok, true, 'Runtime timing probe drain failed.');
		const timings = Array.isArray(response.runtimeTimings)
			? response.runtimeTimings.map(timing => ({
				...timing,
				...(correlations.get(timing.requestId) ?? {
					scenario: 'unattributed',
					phase: 'unknown',
					sample: null,
				}),
			}))
			: [];
		probeCliSubspans = readCliProbeSubspans(configRoot, correlations);
		assertProbeRequestCoverage(timings, correlations);
		return timings;
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
}

function readCliProbeSubspans(configRoot, correlations) {
	const tracePath = runtimeDispatchTracePath(configRoot).replace(
		/runtime-dispatches\.jsonl$/u,
		'cli-subspans.jsonl',
	);
	if (!existsSync(tracePath)) return [];
	return readFileSync(tracePath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line))
		.map(span => ({
			...span,
			...(correlations.get(span.requestId) ?? {
				scenario: span.scenario ?? 'unattributed',
				phase: span.phase ?? 'unknown',
				sample: span.sample ?? null,
			}),
		}));
}

function assertProbeRequestCoverage(timings, correlations) {
	const byRequestId = new Map();
	for (const timing of timings) {
		if (!correlations.has(timing.requestId)) continue;
		const requestTimings = byRequestId.get(timing.requestId) ?? [];
		requestTimings.push(timing);
		byRequestId.set(timing.requestId, requestTimings);
	}
	for (const [requestId, metadata] of correlations) {
		const requestTimings = byRequestId.get(requestId) ?? [];
		assert.equal(
			requestTimings.length > 0,
			true,
			`Probe request has no correlated spans: ${metadata.scenario}/${metadata.phase}/${requestId}`,
		);
		const spans = new Set(requestTimings.map(timing => timing.span));
		const required = metadata.phase === 'read'
			? [
				'settings-refresh',
				'pre-read-settlement',
				'revision-before',
				'projection',
				'revision-after',
			]
			: metadata.phase === 'preview'
				? ['prepare']
				: [...(allowLegacyProbe ? LEGACY_REQUIRED_PROBE_SPANS : REQUIRED_PROBE_SPANS)]
					.filter(span => ![
						'settings-refresh',
						'pre-read-settlement',
						'revision-before',
						'projection',
						'revision-after',
					].includes(span));
		for (const span of required) {
			assert.equal(
				spans.has(span),
				true,
				`Probe span ${span} is missing for ${metadata.scenario}/${metadata.phase}/${requestId}`,
			);
		}
		if (metadata.phase === 'apply' && metadata.scenario.startsWith('batch-create-')) {
			assert.equal(
				requestTimings.filter(timing => timing.span === 'reindex').length,
				1,
				`Same-source ${metadata.scenario} must emit exactly one reindex span.`,
			);
		}
		const exclusiveSpanMs = requestTimings.reduce(
			(total, timing) => total + (
				timing.span.startsWith('settlement-')
					|| timing.span.startsWith('receipt-admission-')
					|| timing.span.startsWith('receipt-terminal-')
					? 0
					: Number.isFinite(timing.durationMs) ? timing.durationMs : 0
			),
			0,
		);
		if (Number.isFinite(metadata.handlerMs)) {
			assert.equal(
				exclusiveSpanMs <= metadata.handlerMs + 2,
				true,
				`Probe exclusive spans exceed handler time for ${metadata.scenario}/${metadata.phase}.`,
			);
		}
	}
}

function requiredProbeSpans(selection) {
	if (selection === null || [...selection].some(family => family !== 'task-get-warm')) {
		return allowLegacyProbe ? LEGACY_REQUIRED_PROBE_SPANS : REQUIRED_PROBE_SPANS;
	}
	return new Set([
		'settings-refresh',
		'pre-read-settlement',
		'revision-before',
		'projection',
		'revision-after',
	]);
}

function collectFileUpdateCharacterization() {
	resetProductionVaultForFixturePreparation();
	const attempts = sampleCount('OPERON_CLI_SPEED_FILE_UPDATE_SAMPLES', 100);
	prepareCoreFixtures(attempts, 1, {
		families: ['file-update'],
		batchSizes: [],
	});
	const fixtureDigest = digestVaultFixtures();
	reloadAppAndWaitReady();
	const configRoot = freshConfigRoot(`stage2-file-update-${attempts}`);
	const failures = [];
	const rawSamples = [];
	let successes = 0;
	let recoveries = 0;
	try {
		for (let index = 0; index < attempts; index += 1) {
			const result = runFileUpdateMutation(index, configRoot);
			const classification = classifyApplyCorrectness({ correctness: result.correctness });
			rawSamples.push({
				id: `file-update-characterization-${index}`,
				ok: classification.ok,
				metrics: {
					previewOuterWallMs: result.preview?._wallMs,
					applyOuterWallMs: result.apply?._wallMs,
					previewHandlerMs: result.preview?.timing?.handlerMs,
					applyHandlerMs: result.apply?.timing?.handlerMs,
				},
				runtimeEvidence: {
					preview: runtimeEnvelopeEvidence(result.preview),
					apply: runtimeEnvelopeEvidence(result.apply),
				},
				correctness: result.correctness,
			});
			if (result.apply?._samePlanRecovery) recoveries += 1;
			if (classification.ok) {
				successes += 1;
			} else {
				failures.push({
					sample: index,
					reasons: classification.reasons,
					preview: runtimeEnvelopeEvidence(result.preview),
					apply: runtimeEnvelopeEvidence(result.apply),
					correctness: result.correctness,
				});
			}
		}
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
	return {
		attempts,
		successes,
		recoveries,
		outcomeUnknown: failures.filter(failure => (
			failure.apply.status === 'outcome-unknown'
		)).length,
		ok: successes === attempts && recoveries === 0,
		failures,
		rawSamples,
		fixtureDigest,
	};
}

function collectTailCharacterization() {
	resetProductionVault();
	const configRoot = freshConfigRoot('tail');
	const sampleCount = sampleCountFromEnvironment(
		'OPERON_CLI_SPEED_TAIL_SAMPLES',
		100,
	);
	try {
		prepareBatchTargets(64, 1);
		reloadAndWaitReady();
		const burst = runBatchCreate(64, 0, configRoot);
		assert.equal(
			classifyApplyCorrectness({ correctness: burst.correctness }).ok,
			true,
			'The tail write burst must pass mutation correctness before reads are sampled.',
		);
		const totalMs = [];
		const handlerMs = [];
		for (let index = 0; index < sampleCount; index += 1) {
			const read = readTask('inln001', configRoot);
			assert.equal(read.result?.ok, true);
			totalMs.push(read._wallMs);
			if (Number.isFinite(read.timing?.handlerMs)) handlerMs.push(read.timing.handlerMs);
		}
		return {
			status: 'collected',
			postWriteBurstItems: 64,
			samples: sampleCount,
			totalMs: {
				p50: percentile(totalMs, 0.5),
				p95: percentile(totalMs, 0.95),
				...(sampleCount >= 300 ? { p99: percentile(totalMs, 0.99) } : {}),
				max: Math.max(...totalMs),
			},
			handlerMs: {
				p50: percentile(handlerMs, 0.5),
				p95: percentile(handlerMs, 0.95),
				...(sampleCount >= 300 ? { p99: percentile(handlerMs, 0.99) } : {}),
				max: handlerMs.length ? Math.max(...handlerMs) : null,
			},
		};
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
}

async function collectConcurrencyCharacterization() {
	const scenarios = [];
	const repetitions = sampleCountFromEnvironment(
		'OPERON_CLI_SPEED_CONCURRENCY_REPETITIONS',
		1,
	);
	for (const writers of [3, 6]) {
		for (const mode of ['sequential', 'parallel']) {
			for (let repetition = 0; repetition < repetitions; repetition += 1) {
				resetProductionVaultForFixturePreparation();
				prepareConcurrencyFixtures(writers);
				reloadAppAndWaitReady();
				const configRoot = freshConfigRoot(
					`concurrency-${writers}-${mode}-${repetition}`,
				);
				try {
				const prepareWriter = index => {
					const startedAt = performance.now();
					const operonId = fixtureOperonId('cw', index);
					const task = readTask(operonId, configRoot).result.task;
					const preview = runCli(
						['mutation', 'preview'],
						updateRequest(task, `Concurrency ${writers}-${mode}-${index}`, `concurrency-${index}`),
						configRoot,
					);
					return { index, operonId, preview, startedAt };
				};
				const applyWriter = async writer => {
					const outcome = await runCliAsync(
						['plan', 'apply', writer.preview.client.planRef],
						configRoot,
					);
					return {
						...writer,
						firstOutcome: outcome,
						outcome,
						freshPreviewCount: 0,
						finishedAt: performance.now(),
					};
				};
				const refreshAndApplyWriter = async writer => {
					const refreshedTask = readTask(writer.operonId, configRoot).result.task;
					const preview = runCli(
							['mutation', 'preview'],
							updateRequest(
								refreshedTask,
								`Concurrency ${writers}-${mode}-${writer.index}`,
								`concurrency-${writer.index}-fresh`,
							),
							configRoot,
						);
					const outcome = await runCliAsync(
						['plan', 'apply', preview.client.planRef],
						configRoot,
					);
					return {
						...writer,
						preview,
						outcome,
						freshPreviewCount: writer.freshPreviewCount + 1,
						finishedAt: performance.now(),
					};
				};
				const started = performance.now();
				const writerResults = [];
				if (mode === 'sequential') {
					for (let index = 0; index < writers; index += 1) {
						writerResults.push(await applyWriter(prepareWriter(index)));
					}
				} else {
					writerResults.push(...await Promise.all(
						Array.from(
							{ length: writers },
							(_, index) => applyWriter(prepareWriter(index)),
						),
					));
					for (let index = 0; index < writerResults.length; index += 1) {
						const writer = writerResults[index];
						const errorCode = writer.outcome.result?.error?.code
							?? writer.outcome.failure?.error?.code;
						if (!['stale-source', 'stale-context'].includes(errorCode)) continue;
						writerResults[index] = await refreshAndApplyWriter(writer);
					}
				}
				const wallMs = performance.now() - started;
				const outcomes = [];
				for (let index = 0; index < writerResults.length; index += 1) {
					const writerResult = writerResults[index];
					const initialOutcome = writerResult.firstOutcome;
					let outcome = writerResult.outcome;
					const uncertain = isUncertainApplyEnvelope(outcome);
					if (uncertain) {
						outcome = runCli(
							['plan', 'recover', writerResult.preview.client.planRef],
							undefined,
							configRoot,
						);
						writerResult.finishedAt = performance.now();
					}
					const final = readTask(fixtureOperonId('cw', index), configRoot);
					outcomes.push({
						initialStatus: initialOutcome.result?.status
							?? initialOutcome.failure?.error?.code,
						errorCode: initialOutcome.result?.error?.code
							?? initialOutcome.failure?.error?.code
							?? null,
						applyWallMs: writerResult.outcome._wallMs,
						writerWallMs: writerResult.finishedAt - writerResult.startedAt,
						freshPreviewCount: writerResult.freshPreviewCount,
						recoveryAttempted: uncertain,
						terminalStatus: outcome.result?.status
							?? outcome.failure?.error?.code,
						postflightStatus: outcome.result?.postflight?.status,
						finalVerified:
							final.result?.task?.description === `Concurrency ${writers}-${mode}-${index}`,
					});
				}
				scenarios.push({
					writers,
					mode,
					repetition,
					wallMs,
					runtimeCalls: countRuntimeCalls(configRoot),
					successes: outcomes.filter(outcome => (
						['applied', 'already-applied'].includes(outcome.terminalStatus)
						&& outcome.finalVerified
					)).length,
					outcomes,
				});
				} finally {
					rmSync(configRoot, { recursive: true, force: true });
				}
			}
		}
	}
	return { status: 'collected', scenarios };
}

function runMutationFamily(family, index, configRoot) {
	switch (family) {
		case 'update': return runUpdateMutation(index, configRoot);
		case 'transition': return runTransitionMutation(index, configRoot);
		case 'file-update': return runFileUpdateMutation(index, configRoot);
		case 'reminder': return runReminderMutation(index, configRoot);
		case 'timer': return runTimerMutation(index, configRoot);
		case 'relocate': return runRelocateMutation(index, configRoot);
		case 'conversion': return runConversionMutation(index, configRoot);
		case 'delete': return runDeleteMutation(index, configRoot);
		case 'compact-create': return runCompactCreate(index, configRoot);
		case 'typed-create-single': return runTypedSingleCreate(index, configRoot);
		default: throw new Error(`Unknown Stage 1 mutation family: ${family}`);
	}
}

function runUpdateMutation(index, configRoot) {
	const operonId = fixtureOperonId('up', index);
	const callsBeforeDiscovery = countRuntimeCalls(configRoot);
	const capabilities = runSimpleReadWithRetry('capabilities', configRoot);
	const beforeEnvelope = readTask(operonId, configRoot);
	const catalog = runSimpleReadWithRetry('catalog', configRoot);
	const callsAfterDiscovery = countRuntimeCalls(configRoot);
	const before = beforeEnvelope.result.task;
	const description = `Stage 1 updated description ${index}`;
	const request = {
		contractVersion: 1,
		requestId: `stage1-update-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'cli-speed-stage1',
		idempotencyKey: `stage1-update-${randomUUID()}`,
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: exactTarget(before),
		spec: {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: description }],
		},
		authorization: speedAuthorization('Stage 1 update benchmark.'),
	};
	const result = previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			return {
				envelope: afterEnvelope,
				description: after.description === description,
				status: after.workflow.status.id === before.workflow.status.id,
				locator: sameLocator(after.locator, before.locator),
				revision: revisionDigest(after) !== revisionDigest(before),
			};
		},
	});
	result.workflowMs += readWallMs(capabilities)
		+ readWallMs(beforeEnvelope)
		+ readWallMs(catalog);
	result.workflowRetries = readRetryCount(capabilities)
		+ readRetryCount(beforeEnvelope)
		+ readRetryCount(catalog);
	result.runtimeCalls = sumRuntimeCallCounts(
		runtimeCallDelta(callsAfterDiscovery, callsBeforeDiscovery),
		result.runtimeCalls,
	);
	return result;
}

function runTransitionMutation(index, configRoot) {
	const operonId = fixtureOperonId('tr', index);
	const before = readTask(operonId, configRoot).result.task;
	const parentBefore = readTask('tmrpar1', configRoot).result.task;
	const targetStatusId = 'st_fixture_done';
	const request = {
		contractVersion: 1,
		requestId: `stage1-transition-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'cli-speed-stage1',
		idempotencyKey: `stage1-transition-${randomUUID()}`,
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(before),
		spec: {
			operation: 'transition',
			targetStatusId,
			expectedStatusId: before.workflow.status.id,
		},
		authorization: speedAuthorization('Stage 1 transition benchmark.'),
	};
	return previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			const parentAfter = readTask('tmrpar1', configRoot).result.task;
			return {
				envelope: afterEnvelope,
				description: after.description === before.description,
				status: after.workflow.status.id === targetStatusId,
				locator: sameLocator(after.locator, before.locator),
				revision: revisionDigest(after) !== revisionDigest(before),
				derivedState: revisionDigest(parentAfter) !== revisionDigest(parentBefore),
			};
		},
		extraCorrectness: { derivedStateRequired: true },
	});
}

function runFileUpdateMutation(index, configRoot) {
	const operonId = fixtureOperonId('fu', index);
	const before = readTask(operonId, configRoot).result.task;
	const priorityId = 'pr_fixture_p2';
	return previewApplyVerify({
		configRoot,
		request: mutationRequest({
			name: `file-update-${index}`,
			capability: 'tasks.update.preview',
			mutationKind: 'task.update',
			target: exactTarget(before),
			spec: {
				operation: 'update',
				changes: [{ field: 'priority', valueType: 'text', value: priorityId }],
			},
		}),
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			return verifiedTaskFields(afterEnvelope, after, {
				description: after.description === before.description,
				status: after.workflow.status.id === before.workflow.status.id,
				locator: sameLocator(after.locator, before.locator),
				revision: after.priority.id === priorityId
					&& revisionDigest(after) !== revisionDigest(before),
			});
		},
	});
}

function runReminderMutation(index, configRoot) {
	const operonId = fixtureOperonId('rm', index);
	const before = readTask(operonId, configRoot).result.task;
	const reminder = new Date(Date.UTC(2099, 0, 1 + index, 9, 0, 0))
		.toISOString()
		.slice(0, 19);
	const request = mutationRequest({
		name: `reminder-${index}`,
		capability: 'tasks.reminder.preview',
		mutationKind: 'task.reminder-item',
		target: exactTarget(before),
		spec: {
			operation: 'add',
			collection: 'reminderDatetimes',
			value: reminder,
		},
	});
	return previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			const reminderVerified = readFileSync(
				path.join(CLI_SPEED_STAGE1_VAULT, after.locator.filePath),
				'utf8',
			).includes(reminder);
			return verifiedTaskFields(afterEnvelope, after, {
				description: after.description === before.description,
				status: after.workflow.status.id === before.workflow.status.id,
				locator: sameLocator(after.locator, before.locator),
				revision: reminderVerified && revisionDigest(after) !== revisionDigest(before),
			});
		},
	});
}

function runTimerMutation(index, configRoot) {
	const operonId = fixtureOperonId('tm', index);
	const before = readTask(operonId, configRoot).result.task;
	const parentBefore = readTask('tmrpar1', configRoot).result.task;
	const stateBefore = readTimer(configRoot).result.state;
	assert.equal(stateBefore.active, null, 'Each timer sample must start from an idle tracker.');
	const request = mutationRequest({
		name: `timer-${index}`,
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		target: exactTarget(before),
		spec: { operation: 'start' },
	});
	let activeStart;
	const result = previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterState = readTimer(configRoot);
			activeStart = afterState.result.state.active?.start;
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			return {
				envelope: afterState,
				description: after.description === before.description,
				status: after.workflow.status.id === 'st_fixture_active',
				locator: sameLocator(after.locator, before.locator),
				revision:
					after.contextRevision.activeTrackerGeneration
						!== before.contextRevision.activeTrackerGeneration,
				derivedState: afterState.result.state.active?.operonId === operonId,
			};
		},
		extraCorrectness: { derivedStateRequired: true },
	});
	assert.equal(typeof activeStart, 'string', 'Timer start did not expose an active start.');
	const stop = previewApplyVerify({
		configRoot,
		request: mutationRequest({
			name: `timer-stop-${index}`,
			capability: 'timers.control.preview',
			mutationKind: 'timer.control',
			spec: { operation: 'stop', expectedActiveStart: activeStart },
		}),
		previewExactTarget: true,
		verify: () => {
			const state = readTimer(configRoot);
			const taskEnvelope = readTask(operonId, configRoot);
			const task = taskEnvelope.result.task;
			const parent = readTask('tmrpar1', configRoot).result.task;
			const derivedState = state.result.state.active === null
				&& revisionDigest(task) !== revisionDigest(before)
				&& revisionDigest(parent) !== revisionDigest(parentBefore);
			return {
				envelope: taskEnvelope,
				description: task.description === before.description,
				status: task.workflow.status.id === 'st_fixture_active',
				locator: sameLocator(task.locator, before.locator),
				revision: revisionDigest(task) !== revisionDigest(before),
				derivedState,
			};
		},
		extraCorrectness: { derivedStateRequired: true },
	});
	const stopClassification = classifyApplyCorrectness({ correctness: stop.correctness });
	assert.equal(
		stopClassification.ok,
		true,
		`Timer cleanup and parent aggregate verification failed: ${JSON.stringify({
			reasons: stopClassification.reasons,
			correctness: stop.correctness,
		})}`,
	);
	result.correctness.finalState.derivedState = true;
	return result;
}

function runRelocateMutation(index, configRoot) {
	const operonId = fixtureOperonId('rl', index);
	const before = readTask(operonId, configRoot).result.task;
	const relativePath = `Performance/Relocate ${index}.md`;
	const source = readFileSync(path.join(CLI_SPEED_STAGE1_VAULT, relativePath), 'utf8');
	const lines = source.split('\n');
	const destinationLineNumber = lines.findIndex(
		(line, lineIndex) => lineIndex !== before.locator.lineNumber && line.trim() === '',
	);
	assert.ok(destinationLineNumber >= 0);
	const sourceRevision = { algorithm: 'sha256', contentDigest: sha256(source) };
	const request = mutationRequest({
		name: `relocate-${index}`,
		capability: 'tasks.inline.relocate.preview',
		mutationKind: 'task.inline-relocate',
		target: exactTarget(before),
		spec: {
			operation: 'relocate-inline',
			source: {
				locator: before.locator,
				lineDigest: sha256(lines[before.locator.lineNumber]),
				sourceRevision,
			},
			destination: {
				locator: {
					representation: 'inline',
					filePath: relativePath,
					lineNumber: destinationLineNumber,
				},
				lineDigest: sha256(lines[destinationLineNumber]),
				sourceRevision,
				mustBeBlank: true,
			},
		},
	});
	return previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			return verifiedTaskFields(afterEnvelope, after, {
				description: after.description === before.description,
				status: after.workflow.status.id === before.workflow.status.id,
				locator: after.locator.lineNumber === destinationLineNumber
					&& after.locator.filePath === relativePath,
				revision: revisionDigest(after) !== revisionDigest(before),
			});
		},
	});
}

function runConversionMutation(index, configRoot) {
	const operonId = fixtureOperonId('cv', index);
	const before = readTask(operonId, configRoot).result.task;
	const targetPath = `Tasks/Stage 1 conversion ${index}.md`;
	const request = mutationRequest({
		name: `conversion-${index}`,
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(before),
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'builtin-minimal-file-task-template:pl_fixture_work',
			targetPath,
		},
	});
	return previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const afterEnvelope = readTask(operonId, configRoot);
			const after = afterEnvelope.result.task;
			return {
				...verifiedTaskFields(afterEnvelope, after, {
					description: after.description === before.description,
					status: after.workflow.status.id === before.workflow.status.id,
					locator: after.representation === 'file' && after.locator.filePath === targetPath,
					revision:
						typeof revisionDigest(after) === 'string'
						&& revisionDigest(after) !== revisionDigest(before),
				}),
				copyCount: countOperonIdCopies(operonId) === 1,
				sourceAbsent: !readFileSync(
					path.join(CLI_SPEED_STAGE1_VAULT, `Performance/Convert ${index}.md`),
					'utf8',
				).includes(operonId),
				targetPresent: existsSync(path.join(CLI_SPEED_STAGE1_VAULT, targetPath)),
			};
		},
		extraCorrectness: {
			copyCountRequired: true,
			sourceAbsenceRequired: true,
			targetPresenceRequired: true,
		},
	});
}

function runDeleteMutation(index, configRoot) {
	const operonId = fixtureOperonId('dl', index);
	const before = readTask(operonId, configRoot).result.task;
	const request = mutationRequest({
		name: `delete-${index}`,
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: exactTarget(before),
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
	});
	return previewApplyVerify({
		configRoot,
		request,
		verify: () => {
			const missing = readTaskMissing(operonId, configRoot);
			const absent = missing.failure?.error?.code === 'entity-not-found';
			return {
				envelope: missing,
				description: absent,
				status: absent,
				locator: absent,
				revision: absent,
				copyCount: countOperonIdCopies(operonId) === 0,
				sourceAbsent: absent,
			};
		},
		extraCorrectness: {
			copyCountRequired: true,
			sourceAbsenceRequired: true,
		},
	});
}

function runCompactCreate(index, configRoot) {
	const description = `Stage 1 compact create ${index}`;
	const unrelatedBefore = digestFile('Tasks/Unrelated Fixture.md');
	const settingsBefore = runtimeSettingsFingerprint(configRoot);
	const callsBefore = countRuntimeCalls(configRoot);
	const preview = runCli(
		['task', 'create', '--input-format', 'compact'],
		`file "${description}"`,
		configRoot,
	);
	const apply = applyStoredPlan(preview, configRoot);
	const callsAfterApply = countRuntimeCalls(configRoot);
	const effect = preview.result?.plan?.createEffects?.[0];
	const afterEnvelope = readTask(effect.operonId, configRoot);
	const after = afterEnvelope.result.task;
	return createdTaskResult({
		preview,
		apply,
		after,
		afterEnvelope,
		description,
		unrelatedBefore,
		settingsBefore,
		configRoot,
		runtimeCalls: runtimeCallDelta(callsAfterApply, callsBefore),
	});
}

function runHumanOneLineCompactCreate(index, configRoot) {
	const description = `Stage 3 human compact create ${index}`;
	const dispatchesBefore = readRuntimeDispatches(configRoot);
	const initial = runCli(['task', 'create', 'file', description], undefined, configRoot);
	const initialPlanRef = initial.client?.planRef;
	const command = initial.result?.kind === 'mutation-preview-result' && initialPlanRef
		? combineHumanOneLineFallback(initial, applyStoredPlan(initial, configRoot), initialPlanRef)
		: initial;
	const dispatches = readRuntimeDispatches(configRoot).slice(dispatchesBefore.length);
	const resolved = readTaskByExactDescription(description, configRoot);
	const afterEnvelope = resolved?.identity?.operonId
		? readTask(resolved.identity.operonId, configRoot)
		: null;
	const after = afterEnvelope?.result?.task;
	return humanOneLineSample({
		command,
		runtimeCalls: dispatches.length,
		applyOuterWallMs: exactApplyDispatchWallMs(dispatches),
		finalVerified:
			afterEnvelope?.ok === true
			&& afterEnvelope.vaultIdentity?.expectedMatch === true
			&& after?.identity?.operonId === resolved?.identity?.operonId
			&& after?.description === description
			&& after?.locator?.representation === 'file'
			&& typeof revisionDigest(after) === 'string',
	});
}

function combineHumanOneLineFallback(preview, apply, planRef) {
	const combined = {
		...apply,
		client: {
			...apply.client,
			planRef,
		},
	};
	Object.defineProperties(combined, {
		_wallMs: { value: preview._wallMs + apply._wallMs, enumerable: false },
		_exitCode: { value: apply._exitCode, enumerable: false },
	});
	return combined;
}

function runHumanOneLineExactUpdate(index, configRoot) {
	const operonId = fixtureOperonId('up', index);
	const before = readTask(operonId, configRoot).result.task;
	const description = `Stage 3 human exact update ${index}`;
	const dispatchesBefore = readRuntimeDispatches(configRoot);
	const command = runCli([
		'task',
		'update',
		'--id',
		operonId,
		`description::${description}`,
	], undefined, configRoot);
	const dispatches = readRuntimeDispatches(configRoot).slice(dispatchesBefore.length);
	const afterEnvelope = readTask(operonId, configRoot);
	const after = afterEnvelope.result?.task;
	return humanOneLineSample({
		command,
		runtimeCalls: dispatches.length,
		applyOuterWallMs: exactApplyDispatchWallMs(dispatches),
		finalVerified:
			afterEnvelope.ok === true
			&& afterEnvelope.vaultIdentity?.expectedMatch === true
			&& after?.identity?.operonId === operonId
			&& after?.description === description
			&& sameLocator(after?.locator, before?.locator)
			&& revisionDigest(after) !== revisionDigest(before),
	});
}

function humanOneLineSample({ command, runtimeCalls, applyOuterWallMs, finalVerified }) {
	const applied = command?.result?.status === 'applied';
	const alreadyApplied = command?.result?.status === 'already-applied';
	const postflightVerified = command?.result?.postflight?.status === 'verified';
	const mutationOutcomeCertain = applied
		|| alreadyApplied
		|| command?.result?.mutationMayHaveApplied !== true;
	const ok =
		command?.ok === true
		&& (applied || alreadyApplied)
		&& postflightVerified
		&& mutationOutcomeCertain
		&& finalVerified === true;
	return {
		ok,
		outerWallMs: command?._wallMs,
		cliTotalMs: command?.timing?.totalMs,
		handlerMs: command?.timing?.handlerMs,
		runtimeCalls,
		applyOuterWallMs,
		applied,
		alreadyApplied,
		postflightVerified,
		mutationOutcomeCertain,
		finalVerified: finalVerified === true,
		...(!ok ? { runtimeEvidence: runtimeEnvelopeEvidence(command) } : {}),
	};
}

function runTypedSingleCreate(index, configRoot) {
	const description = `Stage 1 typed create ${index}`;
	const unrelatedBefore = digestFile('Tasks/Unrelated Fixture.md');
	const settingsBefore = runtimeSettingsFingerprint(configRoot);
	const callsBefore = countRuntimeCalls(configRoot);
	const preview = runCli(['task', 'create'], {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'Stage 1 typed single create.',
		spec: {
			operation: 'create',
			items: [{
				itemRef: 'single',
				description,
			target: {
				representation: 'inline',
				mode: 'exact-path',
				filePath: `Performance/Typed Create ${index}.md`,
				},
				fields: [],
			}],
		},
	}, configRoot);
	const apply = applyStoredPlan(preview, configRoot);
	const callsAfterApply = countRuntimeCalls(configRoot);
	const effect = preview.result?.plan?.createEffects?.[0];
	const afterEnvelope = readTask(effect.operonId, configRoot);
	const after = afterEnvelope.result.task;
	return createdTaskResult({
		preview,
		apply,
		after,
		afterEnvelope,
		description,
		unrelatedBefore,
		settingsBefore,
		configRoot,
		runtimeCalls: runtimeCallDelta(callsAfterApply, callsBefore),
	});
}

function runBatchCreate(size, index, configRoot) {
	const targetPath = `Performance/Batch ${size}-${index}.md`;
	const unrelatedBefore = digestFile('Tasks/Unrelated Fixture.md');
	const settingsBefore = runtimeSettingsFingerprint(configRoot);
	const items = Array.from({ length: size }, (_, itemIndex) => ({
		itemRef: `item-${itemIndex}`,
		description: `Stage 1 batch ${size}-${index}-${itemIndex}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: targetPath,
		},
		fields: [],
	}));
	const previewStarted = performance.now();
	const callsBefore = countRuntimeCalls(configRoot);
	const preview = runCli(['task', 'create'], {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: `Stage 1 same-source batch create ${size}.`,
		spec: { operation: 'create', items },
	}, configRoot);
	const apply = applyStoredPlan(preview, configRoot);
	const mutationFinished = performance.now();
	const callsAfterApply = countRuntimeCalls(configRoot);
	const effects = preview.result?.plan?.createEffects ?? [];
	const query = queryTasks(targetPath, configRoot, Math.max(64, size));
	const tasks = query.result?.tasks ?? [];
	const byId = new Map(tasks.map(task => [task.identity.operonId, task]));
	const itemsByRef = new Map(items.map(item => [item.itemRef, item]));
	const allVerified = effects.length === size && effects.every((effect) => {
		const task = byId.get(effect.operonId);
		const item = itemsByRef.get(effect.itemRef);
		return task
			&& item
			&& task.description === item.description
			&& task.locator.filePath === targetPath
			&& task.workflow.status.id === 'st_fixture_inbox'
			&& typeof revisionDigest(task) === 'string';
	});
	const correctness = mutationCorrectness({
		preview,
		apply,
		final: {
			description: allVerified,
			status: allVerified,
			locator: allVerified,
			revision: allVerified,
			copyCount: tasks.length === size,
		},
		extra: {
			copyCountRequired: true,
			unrelatedFixtureUnchanged:
				digestFile('Tasks/Unrelated Fixture.md') === unrelatedBefore,
			settingsFingerprintUnchanged:
				sameNonEmptyFingerprint(runtimeSettingsFingerprint(configRoot), settingsBefore),
		},
		previewExactTarget:
			effects.length === size
			&& effects.every(effect => effect.locator?.filePath === targetPath),
		previewEffectsVerified:
			effects.length === size
			&& Array.isArray(preview.result?.plan?.predictedEffects)
			&& preview.result.plan.predictedEffects.length > 0,
	});
	return {
		preview,
		apply,
		correctness,
		workflowMs: mutationFinished - previewStarted,
		runtimeCalls: runtimeCallDelta(callsAfterApply, callsBefore),
	};
}

function previewApplyVerify({
	configRoot,
	request,
	verify,
	previewExactTarget,
	previewEffectsVerified,
	extraCorrectness = {},
}) {
	const unrelatedBefore = digestFile('Tasks/Unrelated Fixture.md');
	const settingsBefore = runtimeSettingsFingerprint(configRoot);
	const callsBefore = countRuntimeCalls(configRoot);
	const preview = runCli(['mutation', 'preview'], request, configRoot);
	const apply = applyStoredPlan(preview, configRoot);
	const callsAfterApply = countRuntimeCalls(configRoot);
	const final = verify();
	const requestedOperonId = request.target?.operonId;
	const plan = preview.result?.plan;
	return {
		preview,
		apply,
		correctness: mutationCorrectness({
			preview,
			apply,
			final,
			extra: {
				unrelatedFixtureUnchanged: digestFile('Tasks/Unrelated Fixture.md') === unrelatedBefore,
				settingsFingerprintUnchanged:
					sameNonEmptyFingerprint(runtimeSettingsFingerprint(configRoot), settingsBefore),
				...extraCorrectness,
			},
			previewExactTarget: previewExactTarget ?? (
				typeof requestedOperonId === 'string'
				&& Array.isArray(plan?.targets)
				&& plan.targets.some(target => (
					target.operonId === requestedOperonId
					&& sameLocator(target.locator, request.target.locator)
				))
			),
			previewEffectsVerified:
				previewEffectsVerified ?? predictedEffectsMatchRequest(plan, request),
		}),
		workflowMs: preview._wallMs + apply._wallMs,
		runtimeCalls: runtimeCallDelta(callsAfterApply, callsBefore),
	};
}

function mutationCorrectness({
	preview,
	apply,
	final,
	extra = {},
	previewExactTarget,
	previewEffectsVerified,
}) {
	const plan = preview.result?.plan;
	const planText = JSON.stringify(plan ?? {});
	const initialApplyStatus = apply.result?.status;
	const recoveryStatus = apply._samePlanRecovery?.result?.status;
	const recoveryPostflightStatus = apply._samePlanRecovery?.result?.postflight?.status;
	const recoveryConfirmedApplied = recoveryStatus === 'already-applied'
		&& recoveryPostflightStatus === 'receipt-replay';
	const applyStatus = initialApplyStatus ?? (recoveryConfirmedApplied ? 'applied' : undefined);
	const terminalApply = applyStatus === 'applied' || applyStatus === 'already-applied';
	const finalTaskVerified = [
		final.description,
		final.status,
		final.locator,
		final.revision,
	].every(Boolean);
	return {
		preview: {
			ok: preview.ok === true && Boolean(plan),
			exactTarget: previewExactTarget ?? (Boolean(plan) && (
				Array.isArray(plan.createEffects)
					? plan.createEffects.length > 0
					: planText.includes('inln001')
			)),
			expectedEffects: previewEffectsVerified ?? (
				Array.isArray(plan?.predictedEffects) && plan.predictedEffects.length > 0
			),
		},
		apply: {
			planRef: preview.client?.planRef,
			planRefUsed: preview.client?.planRef,
			status: applyStatus,
			...(initialApplyStatus === undefined && recoveryConfirmedApplied
				? { initialStatus: 'transport-interrupted' }
				: {}),
			reportedMutationMayHaveApplied: apply.result?.mutationMayHaveApplied === true,
			mutationMayHaveApplied:
				apply.result?.mutationMayHaveApplied === true && !terminalApply,
			postflightStatus: apply.result?.postflight?.status
				?? (recoveryConfirmedApplied ? 'verified' : undefined),
			...(apply._samePlanRecovery ? {
				samePlanRecovery: {
					status: apply._samePlanRecovery.result?.status
						?? apply._samePlanRecovery.failure?.error?.code,
					postflightStatus: apply._samePlanRecovery.result?.postflight?.status,
				},
			} : {}),
		},
		finalState: {
			verified: finalTaskVerified,
			description: final.description,
			status: final.status,
			locator: final.locator,
			revision: final.revision,
			...(final.copyCount !== undefined ? { copyCount: final.copyCount } : {}),
			...(final.sourceAbsent !== undefined ? { sourceAbsent: final.sourceAbsent } : {}),
			...(final.targetPresent !== undefined ? { targetPresent: final.targetPresent } : {}),
			...(final.derivedState !== undefined ? { derivedState: final.derivedState } : {}),
		},
		unrelatedFixtureUnchanged: extra.unrelatedFixtureUnchanged === true,
		settingsFingerprintUnchanged: extra.settingsFingerprintUnchanged === true,
		...extra,
	};
}

function pushMutationSamples(samples, family, index, result) {
	for (const phase of ['preview', 'apply']) {
		const envelope = result[phase];
		samples.push({
			sampleId: `${family}-${phase}-${index}`,
			scenario: `${family}.${phase}`,
			kind: 'mutation',
			handlerMs: envelope.timing?.handlerMs,
			totalMs: envelope._wallMs,
			outerWallMs: envelope._wallMs,
			cliTotalMs: envelope.timing?.totalMs,
			retryCount: 0,
			runtimeEvidence: runtimeEnvelopeEvidence(envelope),
			correctness: result.correctness,
		});
	}
}

function readSample(scenario, sampleId, envelope, verified) {
	return {
		sampleId,
		scenario,
		kind: 'read',
		handlerMs: envelope.timing?.handlerMs,
		totalMs: readWallMs(envelope),
		outerWallMs: readWallMs(envelope),
		cliTotalMs: envelope.timing?.totalMs,
		retryCount: readRetryCount(envelope),
		runtimeEvidence: runtimeEnvelopeEvidence(envelope),
		correctness: {
			verified,
			liveVerified: verified && envelope.vaultIdentity?.expectedMatch === true,
		},
	};
}

function readTask(operonId, configRoot) {
	return runCliReadWithRetry(['task', 'get'], {
		contractVersion: 1,
		requestId: `stage1-task-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
	}, configRoot);
}

function readTaskByExactDescription(description, configRoot) {
	const envelope = runCliReadWithRetry(['query'], {
		contractVersion: 1,
		requestId: `stage1-description-${randomUUID()}`,
		kind: 'task-query',
		consistency: 'live-verified',
		filters: { text: description },
		limit: 250,
	}, configRoot);
	const matches = envelope.result?.tasks?.filter(task => task.description === description) ?? [];
	assert.equal(envelope.result?.truncations?.length ?? 0, 0);
	assert.equal(matches.length, 1, `Expected one exact task named ${description}.`);
	return matches[0];
}

function queryTasks(filePath, configRoot, limit) {
	return runCliReadWithRetry(['query'], {
		contractVersion: 1,
		requestId: `stage1-query-${randomUUID()}`,
		kind: 'task-query',
		consistency: 'live-verified',
		filters: { filePath },
		limit,
	}, configRoot);
}

function runCliReadWithRetry(command, request, configRoot) {
	const first = runCli(command, request, configRoot, [0, 3, 70]);
	if (!isRetryableReadEnvelope(first)) return withReadAttemptEvidence(first, first._wallMs, 0);
	const second = runCli(command, request, configRoot, [0, 3, 70]);
	return withReadAttemptEvidence(second, first._wallMs + second._wallMs, 1);
}

function runSimpleReadWithRetry(command, configRoot) {
	const requestId = `stage1-${command}-${randomUUID()}`;
	const args = [command, '--request-id', requestId];
	const first = runCli(args, undefined, configRoot, [0, 3, 70]);
	if (!isRetryableReadEnvelope(first)) return withReadAttemptEvidence(first, first._wallMs, 0);
	const second = runCli(args, undefined, configRoot, [0, 3, 70]);
	return withReadAttemptEvidence(second, first._wallMs + second._wallMs, 1);
}

function withReadAttemptEvidence(envelope, cumulativeWallMs, retryCount) {
	Object.defineProperties(envelope, {
		_cumulativeWallMs: { value: cumulativeWallMs, enumerable: false },
		_retryCount: { value: retryCount, enumerable: false },
	});
	return envelope;
}

function readWallMs(envelope) {
	return Number.isFinite(envelope?._cumulativeWallMs)
		? envelope._cumulativeWallMs
		: envelope?._wallMs;
}

function readRetryCount(envelope) {
	return Number.isSafeInteger(envelope?._retryCount) && envelope._retryCount >= 0
		? envelope._retryCount
		: 0;
}

function isRetryableReadEnvelope(envelope) {
	const error = envelope.failure?.error;
	return error?.retryable === true
		&& ['live-settling', 'transport-unavailable'].includes(error.code);
}

function readTimer(configRoot) {
	const requestId = `stage1-timer-read-${randomUUID()}`;
	return runCliReadWithRetry(
		['timer', 'get', '--request-id', requestId],
		undefined,
		configRoot,
	);
}

function readTaskMissing(operonId, configRoot) {
	const request = {
		contractVersion: 1,
		requestId: `stage1-missing-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
	};
	const first = runCli(['task', 'get'], request, configRoot, [3, 5, 70]);
	if (!isRetryableReadEnvelope(first)) return withReadAttemptEvidence(first, first._wallMs, 0);
	const second = runCli(['task', 'get'], request, configRoot, [3, 5, 70]);
	return withReadAttemptEvidence(second, first._wallMs + second._wallMs, 1);
}

function applyStoredPlan(preview, configRoot) {
	const plan = preview.result?.plan;
	const confirmationRequired = plan?.riskLevel === 'destructive'
		|| plan?.requiresConfirmation === true
		|| (plan?.requiredAcknowledgements?.length ?? 0) > 0;
	const shown = confirmationRequired
		? runCli(['plan', 'show', preview.client.planRef], undefined, configRoot)
		: undefined;
	const token = shown?.result?.plan?.confirmationToken;
	if (confirmationRequired) assert.match(token, /^[A-Za-z0-9_-]{16,}$/u);
	const applied = runCli([
		'plan',
		'apply',
		preview.client.planRef,
		...(token ? ['--confirm', token] : []),
	], undefined, configRoot, [0, 3, 5, 70]);
	if (isUncertainApplyEnvelope(applied)) {
		const recovery = runCli(
			['plan', 'recover', preview.client.planRef],
			undefined,
			configRoot,
			[0, 5],
		);
		Object.defineProperty(applied, '_samePlanRecovery', {
			value: recovery,
			enumerable: false,
		});
	}
	return applied;
}

function runCli(command, request, configRoot, expectedStatus = 0) {
	const isLocalPlanCommand = command[0] === 'plan';
	const args = [
		cliArtifact,
		...command,
		...(isLocalPlanCommand ? [] : ['--vault', CLI_SPEED_STAGE1_VAULT]),
		...(
			isLocalPlanCommand && !['apply', 'recover'].includes(command[1])
				? []
				: ['--timeout-ms', '30000']
		),
		'--json',
	];
	if (request !== undefined) args.push('--input', '-');
	const started = performance.now();
	const result = spawnSync(process.execPath, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CONFIG_HOME: configRoot,
			OPERON_CLI_BENCHMARK_TRACE_PATH: runtimeDispatchTracePath(configRoot),
		},
		...(request === undefined ? {} : {
			input: typeof request === 'string' ? `${request}\n` : `${JSON.stringify(request)}\n`,
		}),
		maxBuffer: 16 * 1_024 * 1_024,
	});
	const wallMs = performance.now() - started;
	const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
	const envelope = result.stdout ? JSON.parse(result.stdout) : null;
	if (!expectedStatuses.includes(result.status)) {
		const failure = new Error(result.stderr || result.stdout || command.join(' '));
		failure.name = 'BenchmarkCliStatusError';
		failure.exitCode = result.status;
		failure.runtimeEvidence = envelope ? runtimeEnvelopeEvidence(envelope) : null;
		failure.timing = envelope?.timing ?? null;
		throw failure;
	}
	assert.ok(envelope, 'Operon CLI returned no JSON envelope.');
	Object.defineProperties(envelope, {
		_wallMs: { value: wallMs, enumerable: false },
		_exitCode: { value: result.status, enumerable: false },
	});
	return envelope;
}

function isUncertainApplyEnvelope(envelope) {
	const status = envelope.result?.status;
	return status === 'partial'
		|| status === 'outcome-unknown'
		|| (
			envelope.result?.mutationMayHaveApplied === true
			&& status !== 'applied'
			&& status !== 'already-applied'
		)
		|| envelope._exitCode === 3
		|| envelope._exitCode === 70;
}

function runCliAsync(command, configRoot) {
	const args = [
		cliArtifact,
		...command,
		'--timeout-ms',
		'30000',
		'--json',
	];
	const started = performance.now();
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: pluginRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				OPERON_CONFIG_HOME: configRoot,
				OPERON_CLI_BENCHMARK_TRACE_PATH: runtimeDispatchTracePath(configRoot),
			},
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
		child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
		child.on('error', reject);
		child.on('close', (exitCode, signal) => {
			try {
				const output = Buffer.concat(stdout).toString('utf8');
				const envelope = JSON.parse(output);
				Object.defineProperties(envelope, {
					_exitCode: { value: exitCode, enumerable: false },
					_signal: { value: signal, enumerable: false },
					_wallMs: { value: performance.now() - started, enumerable: false },
				});
				resolve(envelope);
			} catch (error) {
				reject(new Error(
					`Concurrent CLI output was not JSON: ${Buffer.concat(stderr).toString('utf8')}`,
					{ cause: error },
				));
			}
		});
	});
}

function resetProductionVault() {
	resetProductionVaultForFixturePreparation();
	reloadAppAndWaitReady();
}

function resetProductionVaultForFixturePreparation() {
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	disableOperonForReset();
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		'--production',
		'--allow-active-vault-ephemera',
		CLI_SPEED_STAGE1_VAULT,
	]);
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
}

function resetProbeVaultForFixturePreparation() {
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	disableOperonForReset();
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		'--allow-active-vault-ephemera',
		CLI_SPEED_STAGE1_VAULT,
	]);
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
}

function restoreProductionVault() {
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	disableOperonForReset();
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		'--production',
		'--allow-active-vault-ephemera',
		CLI_SPEED_STAGE1_VAULT,
	]);
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	runRequired('obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']);
	assert.equal(
		waitUntilReady(readinessTimeoutMs),
		true,
		'Production Runtime did not become ready after the final guarded restore.',
	);
}

function reloadAppAndWaitReady() {
	runRequired('obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']);
	assert.equal(
		waitUntilReady(readinessTimeoutMs),
		true,
		'Operon Runtime did not become ready/verified/settled after app reload.',
	);
}

function reloadAndWaitReady() {
	runRequired('obsidian', ['vault=cli-test-vault', 'plugin:reload', 'id=operon']);
	assert.equal(
		waitUntilReady(readinessTimeoutMs),
		true,
		'Operon Runtime did not become ready/verified/settled after plugin reload.',
	);
}

function disableOperonForReset() {
	runRequired('obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']);
	const deadline = Date.now() + 10_000;
	do {
		const result = spawnSync('obsidian', ['vault=cli-test-vault', 'plugin', 'id=operon'], {
			cwd: pluginRoot,
			encoding: 'utf8',
			maxBuffer: 2 * 1_024 * 1_024,
		});
		if (result.status === 0 && /(?:^|\n)enabled\tfalse(?:\n|$)/u.test(result.stdout)) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	} while (Date.now() < deadline);
	throw new Error('Operon plugin did not become disabled before the guarded vault reset.');
}

function waitUntilReady(timeoutMs) {
	const configRoot = freshConfigRoot('readiness');
	try {
		const deadline = Date.now() + timeoutMs;
		do {
			try {
				const health = runCli(['health'], undefined, configRoot);
				lastReadinessEvidence = runtimeEnvelopeEvidence(health);
				if (isReadyHealth(health)) return true;
			} catch (error) {
				lastReadinessEvidence = {
					error: serializeBenchmarkError(error),
				};
				// Obsidian can briefly interrupt the native transport during reload.
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
		} while (Date.now() < deadline);
		return false;
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
}

function isReadyHealth(envelope) {
	return envelope.ok === true
		&& envelope.result?.lifecyclePhase === 'ready'
		&& envelope.result?.v8PersistencePhase === 'idle'
		&& envelope.result?.admission?.reads === true
		&& envelope.result?.admission?.writes === true
		&& envelope.vaultIdentity?.expectedMatch === true;
}

function ensureGuardedVaultExists() {
	if (!existsSync(CLI_SPEED_STAGE1_VAULT)) {
		mkdirSync(CLI_SPEED_STAGE1_VAULT, { recursive: false });
	}
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
}

function ensureObsidianRunning() {
	const version = () => spawnSync('obsidian', ['version'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
	if (version().status === 0) return;
	runRequired('open', ['-a', 'Obsidian']);
	const deadline = Date.now() + 30_000;
	do {
		if (version().status === 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	} while (Date.now() < deadline);
	throw new Error('Obsidian did not become available to its CLI after launch.');
}

function prepareBatchTargets(size, attempts) {
	const directory = path.join(CLI_SPEED_STAGE1_VAULT, 'Performance');
	mkdirSync(directory, { recursive: true });
	for (let index = 0; index < attempts; index += 1) {
		writeFileSync(
			path.join(directory, `Batch ${size}-${index}.md`),
			`# Stage 1 batch target ${size}-${index}\n\n`,
			'utf8',
		);
	}
}

function cleanupBatchTarget(size, index, configRoot) {
	const targetPath = `Performance/Batch ${size}-${index}.md`;
	writeFileSync(
		path.join(CLI_SPEED_STAGE1_VAULT, targetPath),
		`# Stage 1 batch target ${size}-${index}\n\n`,
		'utf8',
	);
	const deadline = Date.now() + readinessTimeoutMs;
	do {
		const query = queryTasks(targetPath, configRoot, Math.max(64, size));
		if (query.result?.ok === true && (query.result.tasks?.length ?? 0) === 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	} while (Date.now() < deadline);
	throw new Error(`Batch target did not return to its empty fixture state: ${targetPath}`);
}

function prepareConcurrencyFixtures(writers) {
	const directory = path.join(CLI_SPEED_STAGE1_VAULT, 'Performance');
	mkdirSync(directory, { recursive: true });
	for (let index = 0; index < writers; index += 1) {
		writeFileSync(
			path.join(directory, `Concurrent Writer ${index}.md`),
			`- [ ] Concurrent writer ${index} {{operonId:: ${fixtureOperonId('cw', index)}}} {{status:: Work.Inbox}}\n`,
			'utf8',
		);
	}
}

function runRequired(command, args) {
	const result = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1_024 * 1_024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout || `${command} failed.`);
}

function buildStage1Artifacts() {
	if (process.env.OPERON_CLI_SPEED_SKIP_BUILD === '1') return;
	runRequired(process.execPath, ['packages/operon-cli/build.mjs']);
	runRequired(process.execPath, ['esbuild.config.mjs', 'production']);
	runRequired(process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe']);
}

function mutationRequest({ name, capability, mutationKind, target, spec }) {
	return {
		contractVersion: 1,
		requestId: `stage1-${name}-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'cli-speed-stage1',
		idempotencyKey: `stage1-${name}-${randomUUID()}`,
		capability,
		mutationKind,
		...(target ? { target } : {}),
		spec,
		authorization: speedAuthorization(`Stage 1 ${name} benchmark.`),
	};
}

function updateRequest(task, description, name) {
	return mutationRequest({
		name,
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: exactTarget(task),
		spec: {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: description }],
		},
	});
}

function verifiedTaskFields(envelope, _task, fields) {
	return { envelope, ...fields };
}

function createdTaskResult({
	preview,
	apply,
	after,
	afterEnvelope,
	description,
	unrelatedBefore,
	settingsBefore,
	configRoot,
	runtimeCalls,
}) {
	const effect = preview.result?.plan?.createEffects?.[0];
	const verified = after.identity.operonId === effect?.operonId
		&& after.description === description
		&& typeof revisionDigest(after) === 'string';
	const statusVerified = after.workflow.status.id === 'st_fixture_inbox';
	return {
		preview,
		apply,
		correctness: mutationCorrectness({
			preview,
			apply,
			final: {
				envelope: afterEnvelope,
				description: verified,
				status: verified && statusVerified,
				locator: verified && after.locator.filePath === effect.locator.filePath,
				revision: verified,
			},
			extra: {
				unrelatedFixtureUnchanged:
					digestFile('Tasks/Unrelated Fixture.md') === unrelatedBefore,
				settingsFingerprintUnchanged:
					sameNonEmptyFingerprint(runtimeSettingsFingerprint(configRoot), settingsBefore),
			},
			previewExactTarget: effect?.locator?.filePath === after.locator.filePath,
			previewEffectsVerified:
				Array.isArray(preview.result?.plan?.predictedEffects)
				&& preview.result.plan.predictedEffects.length > 0,
		}),
		workflowMs: preview._wallMs + apply._wallMs,
		runtimeCalls,
	};
}

function creationContextRequest() {
	return {
		contractVersion: 1,
		requestId: `stage1-creation-context-${randomUUID()}`,
		kind: 'context',
		purpose: 'creation',
		projection: 'creation-context',
		consistency: 'live-verified',
	};
}

function smallContextPackRequest() {
	return {
		contractVersion: 1,
		requestId: `stage1-context-pack-${randomUUID()}`,
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		selector: { kind: 'operon-id', operonId: 'inln001' },
		mutationKind: 'task.update',
	};
}

function prepareCoreFixtures(
	mutationAttempts,
	batchAttempts,
	{
		families = [
			'update',
			'transition',
			'file-update',
			'reminder',
			'timer',
			'relocate',
			'conversion',
			'delete',
			'compact-create',
			'typed-create-single',
		],
		batchSizes = [1, 5, 20, 64],
	} = {},
) {
	const directory = path.join(CLI_SPEED_STAGE1_VAULT, 'Performance');
	mkdirSync(directory, { recursive: true });
	for (const [family, prefix, label] of [
		['update', 'up', 'Update'],
		['transition', 'tr', 'Transition'],
		['reminder', 'rm', 'Reminder'],
		['timer', 'tm', 'Timer'],
		['relocate', 'rl', 'Relocate'],
		['conversion', 'cv', 'Convert'],
		['delete', 'dl', 'Delete'],
	]) {
		if (!families.includes(family)) continue;
		for (let index = 0; index < mutationAttempts; index += 1) {
			const parent = family === 'transition' || family === 'timer'
				? ' {{parentTask:: tmrpar1}}'
				: '';
			writeFileSync(
				path.join(directory, `${label} ${index}.md`),
				`- [ ] Stage 1 ${family} ${index} {{operonId:: ${fixtureOperonId(prefix, index)}}} {{status:: Work.Inbox}}${parent}\n\n\n`,
				'utf8',
			);
		}
	}
	if (families.includes('file-update')) {
		for (let index = 0; index < mutationAttempts; index += 1) {
			const operonId = fixtureOperonId('fu', index);
			writeFileSync(
				path.join(directory, `File Update ${index}.md`),
				`---\noperonId: ${operonId}\nstatus: Work.Active\npriority: P1\ndatetimeCreated: 2026-01-15T10:20:30\ndatetimeModified: 2026-01-15T10:20:30\n---\n\n# Stage 1 file update ${index}\n`,
				'utf8',
			);
		}
	}
	if (families.includes('typed-create-single')) {
		for (let index = 0; index < mutationAttempts; index += 1) {
			writeFileSync(
				path.join(directory, `Typed Create ${index}.md`),
				`# Stage 1 typed create target ${index}\n\n`,
				'utf8',
			);
		}
	}
	for (const size of batchSizes) {
		prepareBatchTargets(size, batchAttempts);
	}
}

function fixtureOperonId(prefix, index) {
	return `${prefix}${String(index).padStart(5, '0')}`;
}

function countOperonIdCopies(operonId) {
	let count = 0;
	const stack = [CLI_SPEED_STAGE1_VAULT];
	while (stack.length > 0) {
		const directory = stack.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const absolutePath = path.join(directory, entry.name);
			const relativePath = path.relative(CLI_SPEED_STAGE1_VAULT, absolutePath);
			if (entry.isDirectory()) {
				if (relativePath.startsWith('.obsidian')) continue;
				stack.push(absolutePath);
			} else if (
				entry.isFile()
				&& entry.name.endsWith('.md')
			) {
				const content = readFileSync(absolutePath, 'utf8');
				let offset = 0;
				while ((offset = content.indexOf(operonId, offset)) >= 0) {
					count += 1;
					offset += operonId.length;
				}
			}
		}
	}
	return count;
}

function summarizeAgentWorkflows(workflows) {
	return Object.fromEntries(Object.entries(workflows).map(([family, values]) => {
		const runtimeCalls = values
			.map(value => value.runtimeCalls)
			.filter(Number.isFinite);
		const retryCounts = values.map(value => value.retryCount ?? 0);
		return [family, {
			samples: values.length,
			totalMs: {
				p50: percentile(values.map(value => value.totalMs), 0.5),
				p95: percentile(values.map(value => value.totalMs), 0.95),
				max: values.length ? Math.max(...values.map(value => value.totalMs)) : null,
			},
			runtimeCalls: {
				available: runtimeCalls.length === values.length,
				p50: percentile(runtimeCalls, 0.5),
				p95: percentile(runtimeCalls, 0.95),
				max: runtimeCalls.length ? Math.max(...runtimeCalls) : null,
			},
			retries: {
				retriedSamples: retryCounts.filter(value => value > 0).length,
				attempts: retryCounts.reduce((total, value) => total + value, 0),
			},
		}];
	}));
}

function summarizeHumanOneLineWorkflows(workflows) {
	return Object.fromEntries(Object.entries(workflows).map(([family, values]) => {
		const successful = values.filter(value => value.ok === true);
		const summarizeMetric = key => {
			const samples = successful.map(value => value[key]).filter(Number.isFinite);
			return {
				samples: samples.length,
				p50: percentile(samples, 0.5),
				p95: percentile(samples, 0.95),
				max: samples.length ? Math.max(...samples) : null,
			};
		};
		return [family, {
			attempts: values.length,
			successes: successful.length,
			correctnessFailures: values
				.map((value, index) => value.ok === true ? null : {
					index,
					applied: value.applied,
					postflightVerified: value.postflightVerified,
					mutationOutcomeCertain: value.mutationOutcomeCertain,
					finalVerified: value.finalVerified,
				})
				.filter(Boolean),
			outerWallMs: summarizeMetric('outerWallMs'),
			cliTotalMs: summarizeMetric('cliTotalMs'),
			handlerMs: summarizeMetric('handlerMs'),
			runtimeCalls: summarizeMetric('runtimeCalls'),
			applyOuterWallMs: summarizeMetric('applyOuterWallMs'),
		}];
	}));
}

function exactTarget(task) {
	return { operonId: task.identity.operonId, locator: task.locator };
}

function sameLocator(left, right) {
	return left?.representation === right?.representation
		&& left?.filePath === right?.filePath
		&& left?.lineNumber === right?.lineNumber;
}

function predictedEffectsMatchRequest(plan, request) {
	const effects = plan?.predictedEffects;
	if (!Array.isArray(effects) || effects.length === 0) return false;
	if (request.mutationKind === 'timer.control') {
		return effects.some(effect => (
			effect.resourceKind === 'active-tracker'
			&& effect.action === 'state-change'
		));
	}
	const sourcePath = request.target?.locator?.filePath;
	if (typeof sourcePath !== 'string') return false;
	if (request.mutationKind === 'task.convert') {
		return effects.some(effect => effect.resourceKey === sourcePath)
			&& effects.some(effect => effect.action === 'create');
	}
	const targetEffect = effects.find(effect => (
		effect.resourceKind === 'task-source' && effect.resourceKey === sourcePath
	));
	if (!targetEffect) return false;
	if (request.mutationKind === 'task.delete') {
		return targetEffect.action === 'trash' || targetEffect.action === 'update';
	}
	return targetEffect.action === 'update' || targetEffect.action === 'state-change';
}

function revisionDigest(task) {
	return task?.sourceRevision?.contentDigest;
}

function speedAuthorization(reason) {
	return { basis: 'user-explicit-request', reason };
}

function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function combinedFixtureDigest(...digests) {
	return sha256(JSON.stringify(digests));
}

function serializeBenchmarkError(error, depth = 0) {
	if (depth > 4) return { message: 'error-cause-depth-exceeded' };
	if (!(error instanceof Error)) return { value: error };
	const serialized = {
		name: error.name,
		message: error.message,
		stack: error.stack,
	};
	for (const key of Object.getOwnPropertyNames(error)) {
		if (['name', 'message', 'stack', 'cause'].includes(key)) continue;
		const value = error[key];
		serialized[key] = value instanceof Error
			? serializeBenchmarkError(value, depth + 1)
			: value;
	}
	if (error.cause !== undefined) {
		serialized.cause = serializeBenchmarkError(error.cause, depth + 1);
	}
	return serialized;
}

function freshConfigRoot(label) {
	const root = mkdtempSync(`/private/tmp/operon-cli-speed-${label}-`);
	return root;
}

function runtimeDispatchTracePath(configRoot) {
	return path.join(configRoot, 'runtime-dispatches.jsonl');
}

function countRuntimeCalls(configRoot) {
	return readRuntimeDispatches(configRoot).length;
}

function readRuntimeDispatches(configRoot) {
	const tracePath = runtimeDispatchTracePath(configRoot);
	if (!existsSync(tracePath)) return [];
	return readFileSync(tracePath, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line));
}

function exactApplyDispatchWallMs(dispatches) {
	const applies = dispatches.filter(value => (
		Array.isArray(value?.command)
		&& value.command[0] === 'mutation'
		&& value.command[1] === 'apply'
		&& Number.isFinite(value.outerWallMs)
	));
	return applies.length === 1 ? applies[0].outerWallMs : null;
}

function runtimeCallDelta(after, before, excluded = 0) {
	return Number.isFinite(after) && Number.isFinite(before)
		? after - before - excluded
		: null;
}

function sumRuntimeCallCounts(...counts) {
	return counts.every(Number.isFinite)
		? counts.reduce((sum, count) => sum + count, 0)
		: null;
}

function runtimeEnvelopeEvidence(envelope) {
	const value = envelope ?? {};
	const result = value.result ?? {};
	const failureDetails = value.failure?.error?.details ?? {};
	const postflight = result.postflight ?? {};
	return {
		requestId: value.requestId ?? null,
		command: value.command ?? null,
		planRef: typeof value.client?.planRef === 'string' ? value.client.planRef : null,
		ok: value.ok === true,
		status: result.status ?? null,
		postflightStatus: postflight.status ?? null,
		failure: value.failure?.error ?? value.error ?? null,
		resultError: result.error ?? null,
		groupResults: result.groupResults ?? null,
		readiness:
			result.readiness
			?? failureDetails.readiness
			?? failureDetails.runtimeReadiness
			?? null,
		ambiguitySource:
			failureDetails.ambiguitySource
			?? postflight.ambiguitySource
			?? null,
		contextRevision:
			result.contextRevision
			?? postflight.contextRevision
			?? null,
		timing: {
			handlerMs: Number.isFinite(value.timing?.handlerMs) ? value.timing.handlerMs : null,
			totalMs: Number.isFinite(value.timing?.totalMs) ? value.timing.totalMs : null,
		},
		revisions: {
			before:
				result.revisionBefore
				?? failureDetails.revisionBefore
				?? null,
			after:
				result.revisionAfter
				?? failureDetails.revisionAfter
				?? null,
			source:
				result.sourceRevision
				?? postflight.sourceRevision
				?? failureDetails.sourceRevision
				?? null,
			committed:
				result.committedSourceRevision
				?? postflight.committedSourceRevision
				?? failureDetails.committedSourceRevision
				?? null,
		},
		reindexGeneration:
			result.reindexGeneration
			?? postflight.reindexGeneration
			?? result.contextRevision?.indexGeneration
			?? postflight.contextRevision?.indexGeneration
			?? failureDetails.reindexGeneration
			?? null,
	};
}

function digestFile(relativePath) {
	return createHash('sha256')
		.update(readFileSync(path.join(CLI_SPEED_STAGE1_VAULT, relativePath)))
		.digest('hex');
}

function digestFileOrAbsent(relativePath) {
	const absolutePath = path.join(CLI_SPEED_STAGE1_VAULT, relativePath);
	return existsSync(absolutePath) ? digestFile(relativePath) : 'absent';
}

function runtimeSettingsFingerprint(configRoot) {
	const requestId = `stage1-settings-fingerprint-${randomUUID()}`;
	const command = ['health', '--request-id', requestId];
	const health = runCliReadWithRetry(command, undefined, configRoot);
	return health.result?.contextRevision?.settingsFingerprint ?? null;
}

function sameNonEmptyFingerprint(left, right) {
	return typeof left === 'string' && left.length > 0 && left === right;
}

function digestVaultFixtures() {
	const files = [];
	walkFixtureFiles(CLI_SPEED_STAGE1_VAULT, files);
	const digest = createHash('sha256');
	for (const file of files.sort()) {
		digest.update(file);
		digest.update('\0');
		digest.update(digestFile(file));
		digest.update('\0');
	}
	return digest.digest('hex');
}

function walkFixtureFiles(directory, files) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolutePath = path.join(directory, entry.name);
		const relativePath = path.relative(CLI_SPEED_STAGE1_VAULT, absolutePath);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) {
			if (entry.name.startsWith('.') && relativePath !== '.obsidian') continue;
			if (relativePath.startsWith('.obsidian/plugins/operon/runtime')) continue;
			if (relativePath.startsWith('.obsidian/plugins/operon/cache')) continue;
			if (
				relativePath.startsWith('.obsidian')
				&& relativePath !== '.obsidian'
				&& relativePath !== '.obsidian/plugins'
				&& relativePath !== '.obsidian/plugins/operon'
			) continue;
			walkFixtureFiles(absolutePath, files);
		} else if (
			entry.isFile()
			&& relativePath.endsWith('.md')
		) {
			files.push(relativePath);
		}
	}
}

function artifactEvidence() {
	const productionPath = path.join(pluginRoot, 'main.js');
	const probePath = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
	return {
		production: fileArtifact(productionPath),
		probe: existsSync(probePath) ? fileArtifact(probePath) : { status: 'not-built' },
		cli: fileArtifact(cliArtifact),
	};
}

function fileArtifact(filePath) {
	const bytes = readFileSync(filePath);
	return {
		path: filePath,
		bytes: statSync(filePath).size,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function environmentEvidence() {
	const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
	const cliPackage = JSON.parse(
		readFileSync(path.join(pluginRoot, 'packages/operon-cli/package.json'), 'utf8'),
	);
	const obsidianVersion = spawnSync('obsidian', ['version'], {
		encoding: 'utf8',
		maxBuffer: 1_024 * 1_024,
	});
	return {
		host: hostname(),
		platform: platform(),
		osRelease: release(),
		architecture: process.arch,
		node: process.version,
		pluginVersion: manifest.version,
		cliVersion: cliPackage.version,
		obsidianVersion: obsidianVersion.status === 0
			? obsidianVersion.stdout.trim()
			: 'unavailable',
	};
}

function sampleCount(name, fallback, allowZero = false) {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
		throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`);
	}
	return value;
}

function sampleCountFromEnvironment(name, fallback) {
	return sampleCount(name, fallback);
}

function parseLiveArguments() {
	const args = process.argv.slice(2);
	const options = {
		compare: undefined,
		tail: false,
		concurrency: false,
		stage2: false,
		families: [],
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--tail') {
			options.tail = true;
			continue;
		}
		if (argument === '--concurrency') {
			options.concurrency = true;
			continue;
		}
		if (argument === '--stage2') {
			options.stage2 = true;
			continue;
		}
		if (argument === '--family') {
			const value = args[index + 1];
			if (!value || value.startsWith('--')) {
				throw new Error('--family requires an exact family name.');
			}
			options.families.push(value);
			index += 1;
			continue;
		}
		if (argument === '--compare') {
			const value = args[index + 1];
			if (!value || value.startsWith('--')) {
				throw new Error('--compare requires a path.');
			}
			options.compare = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown CLI speed Stage 1 live argument: ${argument}`);
	}
	return options;
}

function resolveSelectedFamilies(argumentFamilies) {
	const environmentValue = process.env.OPERON_CLI_SPEED_FAMILIES;
	const environmentFamilies = environmentValue === undefined
		? []
		: environmentValue.split(',').map(value => value.trim());
	const requested = [...argumentFamilies, ...environmentFamilies];
	if (requested.length === 0) return null;
	if (requested.some(value => value.length === 0)) {
		throw new Error('OPERON_CLI_SPEED_FAMILIES must not contain empty family names.');
	}
	for (const family of requested) {
		if (!TARGETED_FAMILY_ALLOWLIST.has(family)) {
			throw new Error(
				`Unknown targeted CLI speed family: ${family}. Allowed: ${
					[...TARGETED_FAMILY_ALLOWLIST].join(', ')
				}`,
			);
		}
	}
	const requestedSet = new Set(requested);
	return new Set([...TARGETED_FAMILY_ALLOWLIST].filter(family => requestedSet.has(family)));
}
