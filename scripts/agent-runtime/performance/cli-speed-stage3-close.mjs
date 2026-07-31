#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
	closeSync,
} from 'node:fs';
import { arch, hostname, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	aggregateSamples,
	assertCliSpeedStage1Vault,
	classifyApplyCorrectness,
	CLI_SPEED_STAGE1_VAULT,
	evaluateStage1Gates,
	percentile,
} from './cli-speed-stage1-core.mjs';
import {
	assessCheckpoint,
	buildStage3CheckpointIdentity,
	createCheckpoint,
	isRetryablePreHandlerShardFailure,
	recordUnit,
	validateStage3Checkpoint,
} from './cli-speed-stage3-checkpoint-core.mjs';
import { evaluateStage3Candidate } from './cli-speed-stage3-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsDirectory = '/private/tmp/operon-agent-runtime-results';
const checkpointDirectory = path.join(resultsDirectory, 'stage3-close');
const checkpointPath = path.join(checkpointDirectory, 'checkpoint.json');
const closeLockPath = path.join(resultsDirectory, 'stage3-close.lock');
const finalResultPath = path.join(resultsDirectory, 'cli-speed-stage3.json');
const milestonePath = path.join(resultsDirectory, 'stage3-baseline', 'stage2-batch-milestone.json');
const baselineManifestPath = path.join(resultsDirectory, 'stage3-baseline', 'manifest.json');
const productionPath = path.join(pluginRoot, 'main.js');
const probePath = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
const cliPath = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const benchmarkHarnessPaths = Object.freeze([
	path.join(scriptDirectory, 'cli-speed-stage1-live.mjs'),
	path.join(scriptDirectory, 'cli-speed-stage3-live.mjs'),
	path.join(scriptDirectory, 'cli-speed-stage3-session.mjs'),
]);
const packageJson = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
const standardProfile = Object.freeze({
	name: 'standard-close',
	cold: 0,
	warm: 20,
	warmup: 2,
	batch: 10,
	batchWarmup: 2,
	fileUpdate: 75,
	sessionWarm: 75,
	sessionThroughput: 75,
	sessionLeak: 300,
});
const unitDefinitions = Object.freeze({
	compact: Object.freeze({
		families: ['human-compact-create', 'human-exact-update'],
	}),
	'file-update': Object.freeze({
		families: ['file-update-core', 'file-update-characterization'],
	}),
	batch: Object.freeze({
		families: ['batch-1', 'batch-20', 'batch-64'],
	}),
	jsonl: Object.freeze({
		families: ['task-get-warm'],
		jsonl: true,
	}),
});
const requiredUnits = Object.freeze(Object.keys(unitDefinitions));

assert.equal(process.platform, 'darwin', 'Stage 3 close currently requires macOS.');
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
mkdirSync(checkpointDirectory, { recursive: true });
for (const requiredPath of [milestonePath, baselineManifestPath]) {
	assert.equal(existsSync(requiredPath), true, `Stage 3 sealed evidence is missing: ${requiredPath}`);
}

const closeLock = acquireCloseLock();
try {
	runClose();
} finally {
	releaseCloseLock(closeLock);
}

function runClose() {
	buildArtifacts();
	const identity = buildIdentity();
	let checkpoint = loadOrCreateCheckpoint(identity);
	checkpoint = restartFailedUnits(checkpoint, identity);
	atomicWriteJson(checkpointPath, checkpoint);

	for (const unitId of requiredUnits) {
		assertSessionIdentity(identity.sessionIdentity);
		if (checkpoint.units[unitId]?.status === 'passed') continue;
		const definition = unitDefinitions[unitId];
		const targetPath = path.join(checkpointDirectory, `${unitId}.json`);
		let run = runTargetUnit(unitId, definition, targetPath);
		assertSessionIdentity(identity.sessionIdentity);
		let evidence = existsSync(targetPath) ? readJson(targetPath) : null;
		if (isRetryablePreHandlerShardFailure(evidence, run.status)) {
			atomicWriteJson(
				path.join(checkpointDirectory, `${unitId}-pre-handler-retry-${Date.now()}.json`),
				evidence,
			);
			run = runTargetUnit(unitId, definition, targetPath);
			assertSessionIdentity(identity.sessionIdentity);
			evidence = existsSync(targetPath) ? readJson(targetPath) : null;
		}
		const unit = buildCheckpointUnit(unitId, evidence, run);
		checkpoint = recordUnit(checkpoint, unit);
		atomicWriteJson(checkpointPath, checkpoint);
		if (unit.status === 'failed') {
			process.stdout.write(`${JSON.stringify({
				status: 'failed',
				stage: 'stage3-close',
				unit: unitId,
				checkpoint: assessCheckpoint(checkpoint, identity),
				rawFailure: unit.rawFailure,
			}, null, 2)}\n`);
			process.exitCode = 1;
			break;
		}
	}

	if (!process.exitCode) {
		assertSessionIdentity(identity.sessionIdentity);
		const authority = assessCheckpoint(checkpoint, identity);
		assert.equal(authority.authoritative, true, 'Stage 3 close checkpoint is incomplete.');
		const assembled = assembleClosureEvidence(checkpoint, identity);
		atomicWriteJson(finalResultPath, assembled);
		process.stdout.write(`${JSON.stringify(assembled, null, 2)}\n`);
		if (!assembled.gates.ok) process.exitCode = 1;
	}
}

function buildArtifacts() {
	runRequired(process.execPath, ['packages/operon-cli/build.mjs']);
	runRequired(process.execPath, ['esbuild.config.mjs', 'production']);
	runRequired(process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe']);
}

function buildIdentity() {
	const sessionIdentity = obsidianSessionIdentity();
	return buildStage3CheckpointIdentity({
		vaultRealpath: realpathSync(CLI_SPEED_STAGE1_VAULT),
		profile: standardProfile,
		artifactDigests: {
			production: sha256File(productionPath),
			probe: sha256File(probePath),
			cli: sha256File(cliPath),
		},
		fixtureGeneratorDigest: sha256Text(
			benchmarkHarnessPaths.map(filePath => sha256File(filePath)).join(':'),
		),
		environmentIdentity: {
			host: hostname(),
			platform: platform(),
			osRelease: release(),
			architecture: arch(),
			node: process.version,
			pluginVersion: packageJson.version,
		},
		sessionIdentity,
		stage2MilestoneHash: sha256File(milestonePath),
		baselineHash: sha256File(baselineManifestPath),
	});
}

function obsidianSessionIdentity() {
	const run = spawnSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr || 'Could not inspect the Obsidian process.');
	const matches = run.stdout.split('\n')
		.map(line => line.trim())
		.filter(line => /\/Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/u.test(line));
	assert.equal(matches.length, 1, `Expected one running Obsidian process, found ${matches.length}.`);
	const match = /^(\d+)\s+(.+?)\s+(\/.*)$/u.exec(matches[0]);
	assert.ok(match, 'Could not parse the Obsidian process identity.');
	return {
		pid: Number(match[1]),
		startedAt: match[2],
		commandDigest: sha256Text(match[3]),
	};
}

function assertSessionIdentity(expected) {
	assert.deepEqual(
		obsidianSessionIdentity(),
		expected,
		'Obsidian session identity changed during Stage 3 qualification.',
	);
}

function acquireCloseLock() {
	const owner = {
		pid: process.pid,
		startedAt: new Date().toISOString(),
	};
	try {
		mkdirSync(closeLockPath);
	} catch (error) {
		if (error?.code !== 'EEXIST') throw error;
		const existingOwnerPath = path.join(closeLockPath, 'owner.json');
		const existing = existsSync(existingOwnerPath) ? readJson(existingOwnerPath) : null;
		if (Number.isSafeInteger(existing?.pid) && isProcessAlive(existing.pid)) {
			throw new Error(`Stage 3 close is already running under PID ${existing.pid}.`);
		}
		rmSync(closeLockPath, { recursive: true, force: true });
		mkdirSync(closeLockPath);
	}
	atomicWriteJson(path.join(closeLockPath, 'owner.json'), owner);
	return owner;
}

function releaseCloseLock(owner) {
	const ownerPath = path.join(closeLockPath, 'owner.json');
	const current = existsSync(ownerPath) ? readJson(ownerPath) : null;
	if (current?.pid !== owner.pid) {
		throw new Error('Stage 3 close lock ownership changed before release.');
	}
	rmSync(closeLockPath, { recursive: true, force: true });
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === 'ESRCH') return false;
		throw error;
	}
}

function loadOrCreateCheckpoint(expectedIdentity) {
	if (!existsSync(checkpointPath)) return createCheckpoint(expectedIdentity, requiredUnits);
	const existing = validateStage3Checkpoint(readJson(checkpointPath));
	try {
		assessCheckpoint(existing, expectedIdentity);
		return existing;
	} catch {
		archiveCheckpoint(existing, 'identity-mismatch');
		return createCheckpoint(expectedIdentity, requiredUnits);
	}
}

function restartFailedUnits(value, expectedIdentity) {
	const failed = Object.values(value.units).filter(unit => unit.status === 'failed');
	if (failed.length === 0) return value;
	archiveCheckpoint(value, 'failed-attempt');
	let next = createCheckpoint(expectedIdentity, requiredUnits);
	for (const unit of Object.values(value.units)) {
		if (unit.status !== 'passed') continue;
		next = recordUnit(next, unit);
	}
	return next;
}

function archiveCheckpoint(value, reason) {
	const archivePath = path.join(
		checkpointDirectory,
		`checkpoint-${reason}-${Date.now()}-${value.identity.digest.slice(0, 12)}.json`,
	);
	atomicWriteJson(archivePath, value);
}

function runTargetUnit(unitId, definition, targetPath) {
	rmSync(targetPath, { force: true });
	const args = [
		path.join(scriptDirectory, 'cli-speed-stage3-live.mjs'),
		'--target',
		...definition.families.flatMap(family => ['--family', family]),
		...(definition.jsonl ? ['--jsonl'] : []),
	];
	const environment = { ...process.env };
	for (const name of [
		'OPERON_CLI_SPEED_FAMILIES',
		'OPERON_CLI_SPEED_SMOKE',
		'OPERON_CLI_SPEED_RESULT_PATH',
		'OPERON_CLI_SPEED_SKIP_BUILD',
		'OPERON_CLI_SPEED_TAIL_SAMPLES',
	]) {
		delete environment[name];
	}
	Object.assign(environment, {
		OPERON_CLI_SPEED_STAGE3_RESULT_PATH: targetPath,
		OPERON_CLI_SPEED_COLD_SAMPLES: '5',
		OPERON_CLI_SPEED_WARM_SAMPLES: '20',
		OPERON_CLI_SPEED_WARMUPS: '2',
		OPERON_CLI_SPEED_BATCH_SAMPLES: '10',
		OPERON_CLI_SPEED_BATCH_WARMUPS: '2',
		OPERON_CLI_SPEED_FILE_UPDATE_SAMPLES: '75',
		OPERON_CLI_SPEED_SESSION_WARMUPS: '2',
		OPERON_CLI_SPEED_SESSION_WARM_SAMPLES: '75',
		OPERON_CLI_SPEED_SESSION_THROUGHPUT_SAMPLES: '75',
		OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES: '300',
	});
	return spawnSync(process.execPath, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: environment,
		maxBuffer: 256 * 1_024 * 1_024,
	});
}

function buildCheckpointUnit(unitId, evidence, run) {
	const samples = evidence ? checkpointSamples(unitId, evidence) : [];
	const gateOk = evidence?.gate?.ok === true;
	const fixtureMatched = (
		typeof evidence?.baseline?.fixtureDigest === 'string'
		&& evidence.baseline.fixtureDigest.length > 0
		&& evidence.baseline.fixtureDigest === evidence?.candidate?.fixtureDigest
	);
	const status = run.status === 0 && gateOk && fixtureMatched ? 'passed' : 'failed';
	return {
		id: unitId,
		status,
		completedAt: new Date().toISOString(),
		samples,
		...(status === 'failed' ? {
			rawFailure: {
				exitCode: run.status,
				signal: run.signal,
				stderr: run.stderr ?? '',
				stdoutTail: run.stdout?.slice(-8_192) ?? '',
				gate: evidence?.gate ?? null,
				fixtureMatched,
				evidencePresent: evidence !== null,
			},
		} : {}),
	};
}

function checkpointSamples(unitId, evidence) {
	const samples = [{
		id: `${unitId}:evidence`,
		ok: evidence.gate?.ok === true,
		metrics: {},
		raw: evidence,
	}];
	for (const [side, source] of [
		['baseline', evidence.baseline],
		['candidate', evidence.candidate],
	]) {
		for (const sample of source?.rawSamples ?? []) {
			samples.push(stage1CheckpointSample(unitId, side, sample));
		}
		for (const [family, values] of Object.entries(source?.humanOneLineSamples ?? {})) {
			for (let index = 0; index < values.length; index += 1) {
				const value = values[index];
				samples.push({
					id: `${unitId}:${side}:human-${family}:${index}`,
					ok: value.ok === true
						&& value.applied === true
						&& value.postflightVerified === true
						&& value.finalVerified === true,
					metrics: numericMetrics(value),
					raw: value,
				});
			}
		}
		for (const value of source?.fileUpdateCharacterization?.rawSamples ?? []) {
			samples.push({
				id: `${unitId}:${side}:${value.id}`,
				ok: value.ok === true,
				metrics: numericMetrics(value.metrics),
				raw: value,
			});
		}
	}
	for (const [phase, values] of Object.entries(evidence.jsonlSession?.rawSamples ?? {})) {
		for (const value of values) {
			samples.push({
				id: `${unitId}:candidate:${phase}:${value.id}`,
				ok: value.ok === true,
				metrics: numericMetrics(value.metrics),
				raw: value,
			});
		}
	}
	return samples;
}

function stage1CheckpointSample(unitId, side, sample) {
	const ok = sample.kind === 'mutation'
		? classifyApplyCorrectness(sample).ok
		: sample.correctness?.verified === true && sample.correctness?.liveVerified === true;
	return {
		id: `${unitId}:${side}:${sample.sampleId}`,
		ok,
		metrics: numericMetrics({
			handlerMs: sample.handlerMs,
			totalMs: sample.totalMs,
			outerWallMs: sample.outerWallMs,
			cliTotalMs: sample.cliTotalMs,
		}),
		raw: sample,
	};
}

function assembleClosureEvidence(checkpointValue, checkpointIdentity) {
	const evidenceByUnit = Object.fromEntries(
		requiredUnits.map(unitId => [
			unitId,
			checkpointValue.units[unitId].samples.find(sample => sample.id === `${unitId}:evidence`).raw,
		]),
	);
	const baseline = assembleSideEvidence(evidenceByUnit, 'baseline');
	const candidate = assembleSideEvidence(evidenceByUnit, 'candidate');
	const jsonlSession = recomputeJsonlSession(evidenceByUnit.jsonl.jsonlSession);
	const gates = evaluateStage3Candidate({
		baseline,
		candidate,
		jsonlSession,
		expectedProfile: standardProfile,
	});
	return {
		...candidate,
		schemaVersion: 4,
		suite: 'operon-cli-speed-stage3',
		recordedAt: new Date().toISOString(),
		qualificationProfile: standardProfile,
		gates,
		stage3: {
			sameSession: true,
			targetedClosure: true,
			checkpointIdentity,
			checkpointRevision: checkpointValue.revision,
			requiredUnits,
			baselineSession: {
				kind: 'same-session-targeted-qualification',
				artifacts: baseline.artifacts,
			},
			candidateArtifacts: candidate.artifacts,
			jsonlSession,
		},
	};
}

function assembleSideEvidence(evidenceByUnit, side) {
	const parts = requiredUnits.map(unitId => evidenceByUnit[unitId]?.[side]).filter(Boolean);
	assert.ok(parts.length > 0, `No ${side} target evidence was collected.`);
	assertCompatibleParts(parts, side);
	const rawSamples = parts.flatMap(part => part.rawSamples ?? []);
	const scenarioMetadata = Object.assign({}, ...parts.map(part => part.scenarioMetadata ?? {}));
	const batch = evidenceByUnit.batch[side];
	const file = evidenceByUnit['file-update'][side];
	const compact = evidenceByUnit.compact[side];
	const primary = parts[0];
	const assembled = {
		schemaVersion: 1,
		suite: `operon-cli-speed-stage3-${side}-targeted`,
		recordedAt: new Date().toISOString(),
		vaultPath: CLI_SPEED_STAGE1_VAULT,
		environment: primary.environment,
		artifacts: normalizeArtifacts(primary.artifacts),
		fixtureDigest: combinedFixtureDigest(parts),
		scenarios: aggregateSamples(rawSamples),
		scenarioMetadata,
		batchSpeedups: recomputeBatchSpeedups(batch.agentWorkflowSamples),
		rawSamples,
		fileUpdateCharacterization: recomputeFileUpdateCharacterization(
			file.fileUpdateCharacterization,
		),
		humanOneLineWorkflows: recomputeHumanWorkflows(compact.humanOneLineSamples),
		humanOneLineSamples: compact.humanOneLineSamples,
		collection: {
			mode: 'core',
			scope: 'stage3-targeted-closure',
			counts: {
				cold: 0,
				warm: 20,
				warmup: 2,
				batch: 10,
				batchWarmup: 2,
			},
			performanceGatesAuthoritative: true,
			production: { status: 'collected', authoritativeForGates: true },
			probe: { status: 'diagnostic', authoritativeForGates: false },
		},
	};
	assembled.gates = evaluateStage1Gates(assembled);
	return assembled;
}

function assertCompatibleParts(parts, side) {
	const first = parts[0];
	for (const part of parts.slice(1)) {
		assert.deepEqual(part.environment, first.environment, `${side} environment identity drifted.`);
		assert.deepEqual(
			normalizeArtifacts(part.artifacts),
			normalizeArtifacts(first.artifacts),
			`${side} artifact identity drifted.`,
		);
	}
}

function recomputeBatchSpeedups(workflows) {
	const p50 = size => percentile(
		(workflows?.[`batch-create-${size}`] ?? [])
			.map(value => value.totalMs)
			.filter(Number.isFinite),
		0.5,
	);
	const one = p50(1);
	return Object.fromEntries([20, 64].map(size => {
		const observed = p50(size);
		return [size, Number.isFinite(one) && Number.isFinite(observed) && observed > 0
			? (one * size) / observed
			: null];
	}));
}

function recomputeFileUpdateCharacterization(value) {
	const rawSamples = Array.isArray(value?.rawSamples) ? value.rawSamples : [];
	const successes = rawSamples.filter(sample => sample.ok === true).length;
	return {
		attempts: rawSamples.length,
		successes,
		ok: rawSamples.length > 0 && successes === rawSamples.length,
		failures: rawSamples.filter(sample => sample.ok !== true),
		outcomeUnknown: rawSamples.filter(sample => (
			sample.correctness?.apply?.status === 'outcome-unknown'
			|| sample.correctness?.apply?.mutationMayHaveApplied === true
		)).length,
		recoveries: rawSamples.filter(sample => sample.recovered === true).length,
		fixtureDigest: value?.fixtureDigest,
		rawSamples,
	};
}

function recomputeHumanWorkflows(workflows) {
	return Object.fromEntries(Object.entries(workflows ?? {}).map(([family, values]) => {
		const successful = values.filter(value => value.ok === true);
		const summarize = key => summarizeNumericValues(
			successful.map(value => value[key]).filter(Number.isFinite),
		);
		return [family, {
			attempts: values.length,
			successes: successful.length,
			correctnessFailures: values
				.map((value, index) => value.ok === true ? null : { index, ...value })
				.filter(Boolean),
			outerWallMs: summarize('outerWallMs'),
			cliTotalMs: summarize('cliTotalMs'),
			handlerMs: summarize('handlerMs'),
			runtimeCalls: summarize('runtimeCalls'),
		}];
	}));
}

function recomputeJsonlSession(value) {
	const summarizePhase = phase => {
		const samples = value?.rawSamples?.[phase] ?? [];
		const successful = samples.filter(sample => sample.ok === true);
		return {
			attempts: samples.length,
			successes: successful.length,
			durationMs: summarizeNumericValues(
				successful.map(sample => sample.metrics?.durationMs).filter(Number.isFinite),
			),
		};
	};
	const warmReads = summarizePhase('warm');
	const throughputSummary = summarizePhase('throughput');
	const leakSummary = summarizePhase('leak');
	const throughputWallMs = value?.throughput?.wallMs;
	return {
		status: value?.status,
		protocol: value?.protocol,
		samplePlan: value?.samplePlan,
		warmupSamples: value?.warmupSamples,
		warmReads,
		throughput: {
			...throughputSummary,
			wallMs: throughputWallMs,
			requestsPerSecond: Number.isFinite(throughputWallMs) && throughputWallMs > 0
				? throughputSummary.attempts * 1000 / throughputWallMs
				: null,
		},
		leakCharacterization: {
			...leakSummary,
			rssBeforeBytes: value?.leakCharacterization?.rssBeforeBytes,
			rssAfterBytes: value?.leakCharacterization?.rssAfterBytes,
			rssDeltaBytes: (
				Number.isFinite(value?.leakCharacterization?.rssBeforeBytes)
				&& Number.isFinite(value?.leakCharacterization?.rssAfterBytes)
			)
				? value.leakCharacterization.rssAfterBytes
					- value.leakCharacterization.rssBeforeBytes
				: null,
		},
		runtimeDispatches: value?.runtimeDispatches,
		rawSamples: value?.rawSamples,
	};
}

function summarizeNumericValues(values) {
	return {
		samples: values.length,
		p50: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		max: values.length > 0 ? Math.max(...values) : null,
	};
}

function normalizeArtifacts(artifacts) {
	return Object.fromEntries(
		Object.entries(artifacts ?? {}).map(([name, artifact]) => [
			name,
			{ bytes: artifact.bytes, sha256: artifact.sha256 },
		]),
	);
}

function combinedFixtureDigest(parts) {
	return sha256Text(JSON.stringify(parts.map(part => part.fixtureDigest)));
}

function numericMetrics(value) {
	return Object.fromEntries(
		Object.entries(value ?? {}).filter(([, metric]) => Number.isFinite(metric)),
	);
}

function atomicWriteJson(destination, value) {
	mkdirSync(path.dirname(destination), { recursive: true });
	const temporary = `${destination}.tmp-${process.pid}`;
	rmSync(temporary, { force: true });
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
	});
	const descriptor = openSync(temporary, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, destination);
	fsyncDirectory(path.dirname(destination));
}

function fsyncDirectory(directory) {
	const descriptor = openSync(directory, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
	return createHash('sha256').update(value).digest('hex');
}

function runRequired(command, args) {
	const run = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1_024 * 1_024,
	});
	assert.equal(run.status, 0, run.stderr || run.stdout || `${command} failed.`);
}
