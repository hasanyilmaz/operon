#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';
import {
	auditStage7BatchUpdate,
	STAGE7_PROFILE,
	STAGE7_REQUIRED_UNITS,
	summarizeStage7Samples,
	summarizeStage7Values,
} from './cli-speed-stage7-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const candidateCli = path.resolve(process.env.OPERON_CLI_STAGE7_CANDIDATE ?? '');
const resultPath = process.env.OPERON_CLI_STAGE7_RESULT_PATH;
const unitIndex = process.argv.indexOf('--unit');
const unit = unitIndex >= 0 ? process.argv[unitIndex + 1] : '';
const cleanupOnly = process.argv.includes('--cleanup');
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage7-');
const tracePath = path.join(configRoot, 'runtime-dispatches.jsonl');
const stage6EvidencePath =
	'/private/tmp/operon-agent-runtime-results/cli-speed-stage6.json';

assert.equal(existsSync(candidateCli), true, `Missing Stage 7 CLI: ${candidateCli}`);
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, {
	lstatSync: (await import('node:fs')).lstatSync,
	realpathSync: (await import('node:fs')).realpathSync,
});

if (cleanupOnly) {
	try {
		resetVault(false);
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
	process.exit(0);
}

assert.equal(STAGE7_REQUIRED_UNITS.includes(unit), true, `Unknown Stage 7 unit: ${unit}`);
assert.equal(typeof resultPath, 'string', 'OPERON_CLI_STAGE7_RESULT_PATH is required.');

let result;
try {
	result = await collectUnit(unit);
} catch (error) {
	result = {
		status: 'failed',
		unit,
		reason: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : null,
	};
} finally {
	rmSync(configRoot, { recursive: true, force: true });
}
atomicWriteJson(resultPath, result);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'collected') process.exitCode = 1;

async function collectUnit(name) {
	resetVault(name === 'probe');
	const fixture = prepareInlineTargets(STAGE7_PROFILE.maxBatchSize);
	if (name === 'probe') return collectProbe(fixture);
	if (name === 'compact-update-single') return collectSingle(fixture);
	if (name === 'compact-update-5') return collectBatchFamily(fixture, 5, STAGE7_PROFILE.workflow);
	if (name === 'compact-update-20') return collectBatchFamily(fixture, 20, STAGE7_PROFILE.workflow);
	if (name === 'compact-update-64') return collectBatchFamily(fixture, 64, STAGE7_PROFILE.retention);
	if (name === 'mixed-workflow') return collectLogicalWorkload(fixture, [5, 20, 50]);
	if (name === 'soak') return collectSoak(fixture);
	throw new Error(`Unsupported Stage 7 unit: ${name}`);
}

function collectProbe(fixture) {
	const samples = [];
	const applyRequestIds = new Set();
	for (let index = 0; index < STAGE7_PROFILE.probe; index += 1) {
		const sample = runBatchUpdate(fixture, 5, `probe-${index}`);
		samples.push(sample);
		applyRequestIds.add(sample.applyRequestId);
	}
	const drained = spawnSync('obsidian', [
		'vault=cli-test-vault',
		'operon:transport-probe',
		'operation=timings',
		'requestId=stage7-timing-drain',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(drained.status, 0, drained.stderr || drained.stdout);
	const response = JSON.parse(drained.stdout);
	assert.equal(response.ok, true, 'Stage 7 timing probe drain failed.');
	const timings = (response.runtimeTimings ?? []).filter(
		value => applyRequestIds.has(value?.requestId),
	);
	const spanCounts = {};
	for (const timing of timings) {
		spanCounts[timing.span] = (spanCounts[timing.span] ?? 0) + 1;
	}
	return {
		status: 'collected',
		...summarizeCandidate(samples),
		spanCounts,
		rawProbeSpans: timings,
	};
}

function collectSingle(fixture) {
	const candidate = [];
	for (let index = 0; index < STAGE7_PROFILE.workflow; index += 1) {
		candidate.push(runSingleUpdate(fixture, `candidate-${index}`));
	}
	return {
		status: 'collected',
		baselineMode: 'stage6-authoritative-json',
		baseline: loadStage6UpdateBaseline(),
		candidate: summarizeCandidate(candidate),
	};
}

function loadStage6UpdateBaseline() {
	assert.equal(existsSync(stage6EvidencePath), true, 'Stage 6 baseline evidence is missing.');
	const stage6 = JSON.parse(readFileSync(stage6EvidencePath, 'utf8'));
	const family = stage6?.units?.['compact-single']?.families?.update;
	assert.equal(family?.attempts, STAGE7_PROFILE.workflow);
	assert.equal(family?.successes, STAGE7_PROFILE.workflow);
	assert.equal(Array.isArray(family?.rawSamples), true);
	const samples = family.rawSamples.map(value => ({
		ok: value?.ok === true,
		outerWallMs: value?.candidateOuterWallMs,
		logicalUpdates: 1,
		dispatches: 3,
	}));
	return {
		...summarizeStage7Samples(samples),
		source: {
			path: stage6EvidencePath,
			suite: stage6.suite,
			recordedAt: stage6.recordedAt,
			cliDigest: stage6?.units?.['compact-single']?.historicalCliDigest,
		},
	};
}

function collectBatchFamily(fixture, size, attempts) {
	const baseline = [];
	const candidate = [];
	for (let index = 0; index < attempts; index += 1) {
		const order = index % 2 === 0
			? ['baseline', 'candidate']
			: ['candidate', 'baseline'];
		for (const label of order) {
			const sample = label === 'baseline'
				? runSequentialEquivalent(fixture, size, index)
				: runBatchUpdate(fixture, size, `${size}-${index}`);
			(label === 'baseline' ? baseline : candidate).push(sample);
		}
	}
	return {
		status: 'collected',
		size,
		baselineMode: 'same-binary-verified-single-command-linear',
		baseline: summarizeStage7Samples(baseline),
		candidate: summarizeCandidate(candidate),
	};
}

function collectLogicalWorkload(fixture, sizes) {
	const samples = sizes.map((size, index) => (
		runBatchUpdate(fixture, size, `mixed-${index}`)
	));
	return { status: 'collected', ...summarizeCandidate(samples), batchSizes: sizes };
}

function collectSoak(fixture) {
	const obsidianPid = findObsidianPid();
	const rssBefore = processRssBytes(obsidianPid);
	const fdBefore = processFdCount(obsidianPid);
	const socketBefore = processUnixFdCount(obsidianPid);
	const pendingBefore = pendingRequestFileCount();
	const sizes = [60, 60, 60, 60, 60];
	const samples = sizes.map((size, index) => (
		runBatchUpdate(fixture, size, `soak-${index}`)
	));
	return {
		status: 'collected',
		...summarizeCandidate(samples),
		batchSizes: sizes,
		rssDeltaBytes: processRssBytes(obsidianPid) - rssBefore,
		fdDelta: Math.max(0, processFdCount(obsidianPid) - fdBefore),
		socketDelta: Math.max(0, processUnixFdCount(obsidianPid) - socketBefore),
		pendingAfter: pendingRequestFileCount(),
		observed: {
			obsidianPid,
			pendingBefore,
			fdBefore,
			socketBefore,
		},
	};
}

function prepareInlineTargets(size) {
	const descriptions = Array.from(
		{ length: size },
		(_, index) => `Stage 7 target ${index} ${randomUUID()}`,
	);
	const input = descriptions.map(value => `inline "${value}"`).join('\n');
	const preview = runCli(
		['task', 'create', '--input-format', 'compact-lines'],
		input,
	);
	const effects = preview.result?.plan?.createEffects ?? [];
	assert.equal(effects.length, size, 'Stage 7 fixture creation did not retain every target.');
	const apply = applyPlan(preview);
	assert.equal(apply.result?.postflight?.status, 'verified');
	const sourcePath = effects[0]?.locator?.filePath;
	assert.equal(
		effects.every(value => value?.locator?.filePath === sourcePath),
		true,
		'Stage 7 fixture targets must share one Markdown source.',
	);
	return {
		sourcePath,
		operonIds: effects.map(value => value.operonId),
	};
}

function runSingleUpdate(fixture, label) {
	const value = `Stage 7 single ${label} ${randomUUID()}`;
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const dispatchBefore = dispatchCount();
	const started = performance.now();
	const envelope = runCli([
		'task', 'update', '--id', fixture.operonIds[0], `note::"${value}"`,
	]);
	const outerWallMs = performance.now() - started;
	const result = envelope.result;
	const group = result?.groupResults?.[0];
	const sourceWrites = group?.resourceRevisions?.filter(
		item => item?.resourceKind === 'task-source',
	).length ?? 0;
	const postflightVerified = result?.postflight?.status === 'verified';
	return {
		ok: result?.status === 'applied'
			&& postflightVerified
			&& sourceWrites === 1
			&& sourceContains(fixture.sourcePath, [value]),
		outerWallMs,
		logicalUpdates: 1,
		dispatches: dispatchCount() - dispatchBefore,
		verifiedIntents: postflightVerified ? 1 : 0,
		uncertain: postflightVerified ? false : true,
		samePlanRef: typeof envelope.client?.planRef === 'string',
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
		sourceWrites,
		reindexes: postflightVerified ? 1 : 0,
		settlements: postflightVerified ? 1 : 0,
		receiptPersists: result?.receipt?.terminalOutcome === 'applied' ? 1 : 0,
		postflightParses: postflightVerified ? 1 : 0,
	};
}

function runSequentialEquivalent(fixture, size, index) {
	const representative = runSingleUpdate(fixture, `model-${size}-${index}`);
	return {
		ok: representative.ok,
		outerWallMs: representative.outerWallMs * size,
		representativeWallMs: representative.outerWallMs,
		logicalUpdates: size,
		dispatches: representative.dispatches * size,
		modeled: true,
		observedCommands: 1,
		equivalentModel: 'verified-single-command-linear',
	};
}

function runBatchUpdate(fixture, size, label) {
	const values = fixture.operonIds.slice(0, size).map(
		(_, index) => `Stage 7 ${label} ${index} ${randomUUID()}`,
	);
	const expected = fixture.operonIds.slice(0, size).map((operonId, index) => ({
		operonId,
		changes: [{ field: 'note', valueType: 'text', value: values[index] }],
	}));
	const input = expected.map((item, index) => (
		`--id "${item.operonId}" note::"${values[index]}"`
	)).join('\n');
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const dispatchBefore = dispatchCount();
	const started = performance.now();
	const preview = runCli(
		['task', 'update', '--input-format', 'compact-lines'],
		input,
	);
	const planRef = preview.client?.planRef;
	const apply = applyPlan(preview);
	const outerWallMs = performance.now() - started;
	const dispatches = dispatchCount() - dispatchBefore;
	const perTargetObserved = sourceHasExactFieldValues(
		fixture.sourcePath,
		expected.map((item, index) => ({
			operonId: item.operonId,
			field: 'note',
			value: values[index],
		})),
	);
	const audit = auditStage7BatchUpdate(preview, apply, expected, perTargetObserved);
	const sourceWrites = audit.committed ? 1 : 0;
	return {
		ok: audit.valid
			&& dispatches === 3
			&& perTargetObserved,
		outerWallMs,
		logicalUpdates: size,
		dispatches,
		verifiedIntents: audit.verifiedIntents,
		uncertain: audit.uncertain,
		samePlanRef:
			typeof planRef === 'string' && apply._appliedPlanRef === planRef,
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
		sourceWrites,
		reindexes: audit.postflightVerified ? 1 : 0,
		settlements: audit.postflightVerified ? 1 : 0,
		receiptPersists:
			apply.result?.receipt?.terminalOutcome === 'applied' ? 1 : 0,
		postflightParses: audit.postflightVerified ? 1 : 0,
		perTargetObserved,
		previewRequestId: preview.requestId,
		applyRequestId: apply.requestId,
		correctness: audit,
	};
}

function summarizeCandidate(samples) {
	return {
		...summarizeStage7Samples(samples),
		verifiedIntents: sum(samples, 'verifiedIntents'),
		uncertain: samples.filter(value => value.uncertain).length,
		samePlanRef: samples.filter(value => value.samePlanRef).length,
		unrelatedUnchanged: samples.filter(value => value.unrelatedUnchanged).length,
		settingsUnchanged: samples.filter(value => value.settingsUnchanged).length,
		dispatches: summarizeStage7Values(samples.map(value => value.dispatches)),
		sourceWrites: sum(samples, 'sourceWrites'),
		reindexes: sum(samples, 'reindexes'),
		settlements: sum(samples, 'settlements'),
		receiptPersists: sum(samples, 'receiptPersists'),
		postflightParses: sum(samples, 'postflightParses'),
		perTargetObserved: samples.filter(value => value.perTargetObserved).length,
	};
}

function sum(values, field) {
	return values.reduce((total, value) => total + Number(value?.[field] ?? 0), 0);
}

function applyPlan(preview) {
	const planRef = preview.client?.planRef;
	assert.equal(typeof planRef, 'string', 'Stage 7 preview did not store a planRef.');
	const applied = runCli(['plan', 'apply', planRef], undefined, [0, 5]);
	Object.defineProperty(applied, '_appliedPlanRef', {
		value: planRef,
		enumerable: false,
	});
	return applied;
}

function runCli(command, input, expectedStatuses = [0]) {
	const localPlan = command[0] === 'plan';
	const args = [
		candidateCli,
		...command,
		...(localPlan ? [] : ['--vault', CLI_SPEED_STAGE1_VAULT]),
		'--timeout-ms', '30000',
		'--json',
		...(input === undefined ? [] : ['--input', '-']),
	];
	const result = spawnSync(process.execPath, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: benchmarkEnv(),
		...(input === undefined ? {} : { input: `${input}\n` }),
		maxBuffer: 32 * 1024 * 1024,
	});
	assert.equal(
		expectedStatuses.includes(result.status),
		true,
		result.stderr || result.stdout || command.join(' '),
	);
	return JSON.parse(result.stdout);
}

function resetVault(probe) {
	for (const [command, args] of [
		['obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']],
		[process.execPath, [
			path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
			...(probe ? [] : ['--production']),
			'--allow-active-vault-ephemera',
			CLI_SPEED_STAGE1_VAULT,
		]],
		['obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']],
	]) {
		const result = spawnSync(command, args, {
			cwd: pluginRoot,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const health = spawnSync(process.execPath, [
			candidateCli, 'health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json',
		], {
			cwd: pluginRoot,
			encoding: 'utf8',
			env: benchmarkEnv(),
		});
		if (health.status === 0) return;
		spawnSync('sleep', ['0.25']);
	}
	throw new Error('Stage 7 Runtime did not become ready after vault reset.');
}

function benchmarkEnv() {
	return {
		...process.env,
		OPERON_CONFIG_HOME: configRoot,
		OPERON_CLI_BENCHMARK_TRACE_PATH: tracePath,
	};
}

function dispatchCount() {
	if (!existsSync(tracePath)) return 0;
	return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).length;
}

function sourceContains(relativePath, values) {
	const content = readFileSync(path.join(CLI_SPEED_STAGE1_VAULT, relativePath), 'utf8');
	return values.every(value => content.includes(value));
}

function sourceHasExactFieldValues(relativePath, expected) {
	const lines = readFileSync(
		path.join(CLI_SPEED_STAGE1_VAULT, relativePath),
		'utf8',
	).split(/\r?\n/u);
	return expected.every(item => {
		const matching = lines.filter(line => line.includes(`{{operonId:: ${item.operonId}}}`));
		return matching.length === 1
			&& matching[0].includes(`{{${item.field}:: ${item.value}}}`);
	});
}

function digestVaultPath(relativePath) {
	const target = path.join(CLI_SPEED_STAGE1_VAULT, relativePath);
	return existsSync(target)
		? createHash('sha256').update(readFileSync(target)).digest('hex')
		: 'absent';
}

function findObsidianPid() {
	const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const matches = result.stdout.split('\n').flatMap(line => {
		const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
		return match && /Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/u.test(match[2])
			? [Number.parseInt(match[1], 10)]
			: [];
	});
	assert.equal(matches.length, 1, 'Expected exactly one main Obsidian process.');
	return matches[0];
}

function processRssBytes(pid) {
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return Number.parseInt(result.stdout.trim(), 10) * 1024;
}

function processFdCount(pid) {
	const result = spawnSync('lsof', ['-a', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split('\n').filter(line => line.startsWith('f')).length;
}

function processUnixFdCount(pid) {
	const result = spawnSync('lsof', ['-a', '-U', '-p', String(pid), '-Fn'], {
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split('\n').filter(line => line.startsWith('f')).length;
}

function pendingRequestFileCount() {
	const root = `/private/tmp/operon-agent-runtime-uid-${process.getuid()}`;
	if (!existsSync(root)) return 0;
	return readdirSync(root).filter(name => name.endsWith('.request.json')).length;
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}
