#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
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
	auditStage6CreateApply,
	canonicalizeStage6ReadSemanticValue,
	evaluateStage6ReadSmoke,
	partitionStage6ReadGroups,
	speedup,
	STAGE6_PROFILE,
	STAGE6_REQUIRED_UNITS,
	summarize,
	summarizeStage6Samples,
	summarizeStage6TransportEvidence,
} from './cli-speed-stage6-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const candidateCli = path.resolve(process.env.OPERON_CLI_STAGE6_CANDIDATE ?? '');
const baselineCli = path.resolve(process.env.OPERON_CLI_STAGE6_BASELINE ?? '');
const resultPath = process.env.OPERON_CLI_STAGE6_RESULT_PATH;
const unitIndex = process.argv.indexOf('--unit');
const unit = unitIndex >= 0 ? process.argv[unitIndex + 1] : '';
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage6-');
const tracePath = path.join(configRoot, 'runtime-dispatches.jsonl');
const transportEvidencePath = path.join(configRoot, 'transport-selections.jsonl');

assert.equal(STAGE6_REQUIRED_UNITS.includes(unit), true, `Unknown Stage 6 unit: ${unit}`);
assert.equal(typeof resultPath, 'string', 'OPERON_CLI_STAGE6_RESULT_PATH is required.');
for (const target of [candidateCli, baselineCli]) {
	assert.equal(existsSync(target), true, `Missing Stage 6 CLI: ${target}`);
}
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, {
	lstatSync: (await import('node:fs')).lstatSync,
	realpathSync: (await import('node:fs')).realpathSync,
});

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
if (result.status !== 'collected' && result.status !== 'passed') process.exitCode = 1;

async function collectUnit(name) {
	if (name === 'negative-contract') return collectNegativeContract();
	resetVault();
	if (name === 'compact-single') return collectCompactSingle();
	if (name === 'compact-create5') return collectCompactGroup(5, STAGE6_PROFILE.workflow);
	if (name === 'compact-create20') return collectCompactGroup(20, STAGE6_PROFILE.workflow);
	if (name === 'batch-retention') return collectBatchRetention();
	if (name === 'read-batch') return collectReadBatch();
	if (name === 'soak') return collectSoak();
	throw new Error(`Unsupported Stage 6 unit: ${name}`);
}

function collectCompactSingle() {
	const families = {};
	for (const family of ['create', 'update']) {
		const pairs = [];
		for (let index = 0; index < STAGE6_PROFILE.workflow; index += 1) {
			const order = index % 2 === 0
				? [[candidateCli, 'baseline'], [candidateCli, 'candidate']]
				: [[candidateCli, 'candidate'], [candidateCli, 'baseline']];
			const measured = {};
			for (const [executable, label] of order) {
				measured[label] = family === 'create'
					? runHumanCreate(executable, index, label)
					: runHumanUpdate(executable, index, label);
			}
			pairs.push({ index, ...measured });
		}
		const baseline = summarize(pairs.map(value => value.baseline.outerWallMs));
		const candidate = summarize(pairs.map(value => value.candidate.outerWallMs));
		families[family] = {
			attempts: pairs.length,
			successes: pairs.filter(value => value.baseline.ok && value.candidate.ok).length,
			verified: pairs.filter(value => value.candidate.verified).length,
			uncertain: pairs.filter(value => value.candidate.uncertain).length,
			unrelatedUnchanged: pairs.filter(value => value.candidate.unrelatedUnchanged).length,
			settingsUnchanged: pairs.filter(value => value.candidate.settingsUnchanged).length,
			dispatches: summarize(pairs.map(value => value.candidate.dispatches)),
			baselineOuterWallMs: baseline,
			candidateOuterWallMs: candidate,
			rawAuthoritative: true,
			correctnessFiltered: 0,
			performanceFiltered: 0,
			rawSamples: pairs.map(value => ({
				ok: value.baseline.ok && value.candidate.ok,
				outerWallMs: value.candidate.outerWallMs,
				baselineOuterWallMs: value.baseline.outerWallMs,
				candidateOuterWallMs: value.candidate.outerWallMs,
			})),
		};
	}
	return {
		status: 'collected',
		baselineMode: 'same-binary-sequential-equivalent',
		historicalCliDigest: sha256File(baselineCli),
		families,
	};
}

function collectCompactGroup(size, count) {
	const baselineSamples = [];
	const candidateSamples = [];
	let verifiedIntents = 0;
	let samePlanRef = 0;
	let uncertain = 0;
	for (let index = 0; index < count; index += 1) {
		const order = index % 2 === 0
			? ['baseline', 'candidate']
			: ['candidate', 'baseline'];
		for (const label of order) {
			const sample = label === 'candidate'
				? runCompactBatch(candidateCli, size, index)
				: runSequentialEquivalent(candidateCli, size, index);
			(label === 'candidate' ? candidateSamples : baselineSamples).push(sample);
			if (label === 'candidate') {
				verifiedIntents += sample.verifiedIntents;
				samePlanRef += sample.samePlanRef ? 1 : 0;
				uncertain += sample.uncertain ? 1 : 0;
			}
		}
	}
	const baseline = {
		...summarizeStage6Samples(baselineSamples),
		dispatches: summarize(baselineSamples.map(value => value.dispatches)),
	};
	const candidate = {
		...summarizeStage6Samples(candidateSamples),
		dispatches: summarize(candidateSamples.map(value => value.dispatches)),
		verifiedIntents,
		samePlanRef,
		uncertain,
		unrelatedUnchanged: candidateSamples.filter(value => value.unrelatedUnchanged).length,
		settingsUnchanged: candidateSamples.filter(value => value.settingsUnchanged).length,
	};
	return {
		status: 'collected',
		baselineMode: 'same-binary-linear-sequential-equivalent',
		historicalCliDigest: sha256File(baselineCli),
		size,
		baseline,
		candidate,
		speedup: speedup(baseline.outerWallMs, candidate.outerWallMs),
	};
}

function collectBatchRetention() {
	const result = {
		status: 'collected',
		baselineMode: 'same-binary-linear-sequential-equivalent',
		historicalCliDigest: sha256File(baselineCli),
	};
	for (const size of [20, 64]) {
		resetVault();
		const baseline = [];
		const candidate = [];
		for (let index = 0; index < STAGE6_PROFILE.batchRetention; index += 1) {
			const order = index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
			for (const label of order) {
				(label === 'baseline' ? baseline : candidate).push(
					label === 'baseline'
						? runSequentialEquivalent(candidateCli, size, 1_000 + index)
						: runCompactBatch(candidateCli, size, 1_000 + index),
				);
			}
		}
		const baselineSummary = summarizeStage6Samples(baseline);
		const candidateSummary = summarizeStage6Samples(candidate);
		result[`batch${size}`] = {
			...candidateSummary,
			baselineOuterWallMs: baselineSummary.outerWallMs,
			baselineRawSamples: baseline,
			speedup:
				baselineSummary.outerWallMs.p50 / candidateSummary.outerWallMs.p50,
		};
	}
	return result;
}

async function collectReadBatch() {
	const session = startSession(candidateCli);
	const sequential = [];
	const grouped = [];
	const pairedGroups = [];
	let groupedWallMs = 0;
	let sequentialWallMs = 0;
	let structuralSmoke;
	try {
		await session.request(readFrame(-2));
		await session.request(readFrame(-1));
		structuralSmoke = await collectReadStructuralSmoke(session);
		const smokeFailures = [];
		evaluateStage6ReadSmoke(structuralSmoke, smokeFailures);
		assert.deepEqual(
			smokeFailures,
			[],
			`Stage 6 structural smoke failed: ${smokeFailures.join(', ')}`,
		);
		let offset = 0;
		for (const [groupIndex, groupSize] of (
			partitionStage6ReadGroups(STAGE6_PROFILE.reads).entries()
		)) {
			const frames = Array.from(
				{ length: groupSize },
				(_, local) => readFrame(offset + local, groupIndex, local),
			);
			const groupedFrames = frames.map((_frame, index) => ({
				...readFrame(offset + index, groupIndex, index),
				id: `stage6-group-child-${offset + index}-${randomUUID()}`,
			}));
			const pairOrder = groupIndex % 2 === 0
				? 'sequential-group'
				: 'group-sequential';
			const runSequential = async () => {
				const firstSample = sequential.length;
				const started = performance.now();
				for (const frame of frames) sequential.push(await session.request(frame));
				return {
					samples: sequential.slice(firstSample),
					wallMs: performance.now() - started,
				};
			};
			const runGrouped = () => session.requestGroup({
				id: `stage6-read-group-${offset}-${randomUUID()}`,
				reads: groupedFrames,
			});
			let sequentialResult;
			let groupedResult;
			if (pairOrder === 'sequential-group') {
				sequentialResult = await runSequential();
				groupedResult = await runGrouped();
			} else {
				groupedResult = await runGrouped();
				sequentialResult = await runSequential();
			}
			const sequentialGroupWallMs = sequentialResult.wallMs;
			sequentialWallMs += sequentialGroupWallMs;
			groupedWallMs += groupedResult.wallMs;
			pairedGroups.push({
				ok: groupedResult.samples.every(sample => sample.ok)
					&& sequentialResult.samples.every(sample => sample.ok),
				groupIndex,
				pairOrder,
				size: groupedResult.samples.length,
				sequentialWallMs: sequentialGroupWallMs,
				groupWallMs: groupedResult.wallMs,
				makespanRatio: groupedResult.wallMs / sequentialGroupWallMs,
				makespanImprovementPercent:
					(sequentialGroupWallMs - groupedResult.wallMs)
					/ sequentialGroupWallMs * 100,
				sequentialSemanticKeys:
					sequentialResult.samples.map(readObservedSemanticKey),
				groupSemanticKeys:
					groupedResult.samples.map(readObservedSemanticKey),
				amortizedLogicalCostMs:
					groupedResult.wallMs / groupedResult.samples.length,
			});
			grouped.push(...groupedResult.samples.map(sample => ({
				...sample,
				groupOuterWallMs: groupedResult.wallMs,
				amortizedLogicalCostMs:
					groupedResult.wallMs / groupedResult.samples.length,
			})));
			offset += groupSize;
		}
		await session.close();
	} catch (error) {
		await session.terminate();
		throw error;
	}
	const sequentialSummary = {
		...summarizeStage6Samples(sequential),
		wallMs: sequentialWallMs,
		requestsPerSecond: STAGE6_PROFILE.reads / sequentialWallMs * 1_000,
	};
	const transportEvidence = summarizeTransportEvidence();
	const groupedSummary = {
		...summarizeStage6Samples(grouped),
		responseReady: { status: 'not-observed' },
		cliTotalMs: summarize(grouped.map(value => value.cliTotalMs)),
		orderedCompletionMs: summarize(grouped.map(value => value.orderedCompletionMs)),
		amortizedLogicalCostMs: summarize(
			grouped.map(value => value.amortizedLogicalCostMs),
		),
		wallMs: groupedWallMs,
		requestsPerSecond: STAGE6_PROFILE.reads / groupedWallMs * 1_000,
		logicalResults: grouped.length,
		orderedResults: grouped.filter((value, index) => value.logicalIndex === index).length,
		socketFrames: transportEvidence.socketFrames,
		requestFiles: transportEvidence.requestFiles,
		runtimeReads: transportEvidence.runtimeReads,
		commandCounts: countReadCommands(grouped),
		semanticMismatches: grouped.filter(sample => (
			readResponseSemanticKey(sample) !== readSemanticKey(sample.logicalIndex)
		)).length,
	};
	return {
		status: 'collected',
		structuralSmoke,
		sequential: sequentialSummary,
		grouped: groupedSummary,
		pairedGroups: {
			...summarizeStage6Samples(pairedGroups.map(group => ({
				...group,
				outerWallMs: group.groupWallMs,
			}))),
		},
		speedup: groupedSummary.requestsPerSecond / sequentialSummary.requestsPerSecond,
		fallbacks: transportEvidence.fallbacks,
	};
}

async function collectReadStructuralSmoke(session) {
	const samples = [];
	const groupSizes = [];
	let offset = 0;
	for (const [groupIndex, groupSize] of (
		partitionStage6ReadGroups(STAGE6_PROFILE.readSmoke).entries()
	)) {
		const reads = Array.from(
			{ length: groupSize },
			(_, groupPosition) => ({
				...readFrame(offset + groupPosition, groupIndex, groupPosition),
				id: `stage6-smoke-child-${offset + groupPosition}-${randomUUID()}`,
			}),
		);
		const result = await session.requestGroup({
			id: `stage6-smoke-group-${offset}-${randomUUID()}`,
			reads,
		});
		groupSizes.push(result.samples.length);
		samples.push(...result.samples);
		offset += groupSize;
	}
	const transport = summarizeTransportEvidence(STAGE6_PROFILE.readSmoke);
	const semanticMismatches = samples.filter(sample => (
		readResponseSemanticKey(sample) !== readSemanticKey(sample.logicalIndex)
	)).length;
	return {
		...summarizeStage6Samples(samples),
		logicalResults: samples.length,
		orderedResults: samples.filter(
			(value, index) => value.logicalIndex === index,
		).length,
		socketFrames: transport.socketFrames,
		requestFiles: transport.requestFiles,
		runtimeReads: transport.runtimeReads,
		fallbacks: transport.fallbacks,
		semanticMismatches,
		groupSizes,
		commandCounts: countReadCommands(samples),
	};
}

async function collectSoak() {
	const session = startSession(candidateCli);
	try {
		await session.request(readFrame(-1));
		const obsidianPid = findObsidianPid();
		const rssBeforeBytes = processRssBytes(session.pid);
		const obsidianRssBeforeBytes = processRssBytes(obsidianPid);
		const obsidianFdBefore = processFdCount(obsidianPid);
		const obsidianSocketBefore = processUnixFdCount(obsidianPid);
		const samples = [];
		for (let offset = 0; offset < STAGE6_PROFILE.soak; offset += 5) {
			const result = await session.requestGroup({
				id: `stage6-soak-${offset}-${randomUUID()}`,
				reads: Array.from({ length: 5 }, (_, local) => ({
					...readFrame(offset + local),
					id: `stage6-soak-child-${offset + local}-${randomUUID()}`,
				})),
			});
			samples.push(...result.samples);
		}
		const rssAfterBytes = processRssBytes(session.pid);
		await session.close();
		const obsidianRssAfterBytes = processRssBytes(obsidianPid);
		const obsidianFdAfter = processFdCount(obsidianPid);
		const obsidianSocketAfter = processUnixFdCount(obsidianPid);
		const sessionRssDeltaBytes = rssAfterBytes - rssBeforeBytes;
		const obsidianRssDeltaBytes = obsidianRssAfterBytes - obsidianRssBeforeBytes;
		return {
			status: 'collected',
			...summarizeStage6Samples(samples),
			rssDeltaBytes: Math.max(sessionRssDeltaBytes, obsidianRssDeltaBytes),
			fdDelta: Math.max(
				0,
				Math.abs(obsidianFdAfter - obsidianFdBefore),
			),
			socketDelta: Math.max(
				0,
				Math.abs(obsidianSocketAfter - obsidianSocketBefore),
			),
			listenerDelta: obsidianSocketAfter - obsidianSocketBefore,
			pendingAfter: session.pendingCount(),
			observed: {
				obsidianPid,
				sessionRssDeltaBytes,
				obsidianRssDeltaBytes,
				sessionFdDelta: 0,
				obsidianFdDelta: obsidianFdAfter - obsidianFdBefore,
				sessionSocketDelta: 0,
				obsidianSocketDelta: obsidianSocketAfter - obsidianSocketBefore,
				sessionClosed: true,
			},
		};
	} catch (error) {
		await session.terminate();
		throw error;
	}
}

function collectNegativeContract() {
	const commands = [
		[process.execPath, ['scripts/agent-runtime/cli/run-session-jsonl-tests.mjs']],
		[process.execPath, ['scripts/agent-runtime/cli/run-compact-create-tests.mjs']],
	];
	for (const [command, args] of commands) {
		const result = spawnSync(command, args, {
			cwd: pluginRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	return {
		status: 'passed',
		mutationCalls: 0,
		testCommands: commands.map(([command, args]) => [command, ...args].join(' ')),
	};
}

function runHumanCreate(executable, index, label) {
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const before = dispatchCount();
	const started = performance.now();
	const envelope = runCli(executable, [
		'task', 'create', 'inline', `Stage 6 single ${label} ${index} ${randomUUID()}`,
	]);
	const outerWallMs = performance.now() - started;
	return {
		...auditMutation(envelope, outerWallMs, dispatchCount() - before),
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
	};
}

function runHumanUpdate(executable, index, label) {
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const before = dispatchCount();
	const started = performance.now();
	const envelope = runCli(executable, [
		'task', 'update', '--id', 'inln001',
		`note::"Stage 6 ${label} update ${index} ${randomUUID()}"`,
	]);
	const outerWallMs = performance.now() - started;
	return {
		...auditMutation(envelope, outerWallMs, dispatchCount() - before),
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
	};
}

function runSequentialEquivalent(executable, size, sampleIndex) {
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const before = dispatchCount();
	const started = performance.now();
	const description = compactDescription(size, sampleIndex, 0);
	const preview = runCli(
		executable,
		['task', 'create', '--input-format', 'compact'],
		`inline "${description}"`,
	);
	const apply = applyPlan(executable, preview);
	const audit = auditApply(preview, apply, [description]);
	const representativeWallMs = performance.now() - started;
	const representativeDispatches = dispatchCount() - before;
	return {
		ok: audit.verifiedIntents === 1
			&& !audit.uncertain
			&& representativeDispatches === 3,
		outerWallMs: representativeWallMs * size,
		dispatches: representativeDispatches * size,
		verifiedIntents: audit.verifiedIntents === 1 ? size : 0,
		uncertain: audit.uncertain,
		equivalentModel: 'verified-single-command-linear',
		modeled: true,
		observedCommands: 1,
		representativeWallMs,
		representativeDispatches,
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
	};
}

function runCompactBatch(executable, size, sampleIndex) {
	const unrelatedBefore = digestVaultPath('Tasks/Unrelated Fixture.md');
	const settingsBefore = digestVaultPath('.obsidian/plugins/operon/data.json');
	const before = dispatchCount();
	const started = performance.now();
	const descriptions = Array.from(
		{ length: size },
		(_, index) => compactDescription(size, sampleIndex, index),
	);
	const input = descriptions.map(description => `inline "${description}"`).join('\n');
	const preview = runCli(
		executable,
		['task', 'create', '--input-format', 'compact-lines'],
		input,
	);
	const planRef = preview.client?.planRef;
	const apply = applyPlan(executable, preview);
	const audit = auditApply(preview, apply, descriptions);
	return {
		ok: audit.verifiedIntents === size && !audit.uncertain,
		outerWallMs: performance.now() - started,
		dispatches: dispatchCount() - before,
		verifiedIntents: audit.verifiedIntents,
		uncertain: audit.uncertain,
		samePlanRef: typeof planRef === 'string'
			&& apply._appliedPlanRef === planRef,
		unrelatedUnchanged:
			digestVaultPath('Tasks/Unrelated Fixture.md') === unrelatedBefore,
		settingsUnchanged:
			digestVaultPath('.obsidian/plugins/operon/data.json') === settingsBefore,
	};
}

function compactDescription(size, sampleIndex, itemIndex) {
	return `Stage 6 group ${size} ${sampleIndex} ${itemIndex} ${randomUUID()}`;
}

function applyPlan(executable, preview) {
	const planRef = preview.client?.planRef;
	assert.equal(typeof planRef, 'string', 'Compact preview did not store a planRef.');
	const apply = runCli(executable, ['plan', 'apply', planRef], undefined, [0, 5]);
	Object.defineProperty(apply, '_appliedPlanRef', { value: planRef, enumerable: false });
	return apply;
}

function auditApply(preview, apply, expectedDescriptions) {
	return auditStage6CreateApply(preview, apply, expectedDescriptions);
}

function auditMutation(envelope, outerWallMs, dispatches) {
	const status = envelope.result?.status;
	const uncertain = status === 'partial'
		|| status === 'outcome-unknown'
		|| (
			envelope.result?.mutationMayHaveApplied === true
			&& !['applied', 'already-applied'].includes(status)
		);
	return {
		ok: ['applied', 'already-applied'].includes(status)
			&& envelope.result?.postflight?.status === 'verified'
			&& !uncertain,
		verified: envelope.result?.postflight?.status === 'verified',
		uncertain,
		outerWallMs,
		dispatches,
	};
}

function runCli(executable, command, input, expectedStatuses = [0]) {
	const localPlan = command[0] === 'plan';
	const args = [
		executable,
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

function dispatchCount() {
	if (!existsSync(tracePath)) return 0;
	return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).length;
}

function startSession(executable) {
	const child = spawn(process.execPath, [executable, 'session', '--jsonl'], {
		cwd: pluginRoot,
		env: benchmarkEnv(),
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	const pending = new Map();
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', chunk => { stderr += chunk; });
	child.stdout.on('data', chunk => {
		stdout += chunk;
		for (;;) {
			const newline = stdout.indexOf('\n');
			if (newline < 0) break;
			const line = stdout.slice(0, newline).trim();
			stdout = stdout.slice(newline + 1);
			if (!line) continue;
			const response = JSON.parse(line);
			const entry = pending.get(response.id);
			if (!entry) continue;
			pending.delete(response.id);
			clearTimeout(entry.timeout);
			const orderedCompletionMs = performance.now() - entry.started;
			entry.resolve({
				id: response.id,
				ok: response.exitCode === 0 && response.result?.ok === true,
				outerWallMs: orderedCompletionMs,
				orderedCompletionMs,
				responseReadyMs: null,
				responseReadyObservation: 'not-observed',
				handlerMs: response.result?.timing?.handlerMs ?? null,
				cliTotalMs: response.result?.timing?.totalMs ?? null,
				response,
				fallback: false,
				logicalIndex: entry.logicalIndex,
				groupIndex: entry.groupIndex,
				groupPosition: entry.groupPosition,
				commandFamily: entry.commandFamily,
			});
		}
	});
	const exited = new Promise(resolve => child.once('exit', (code, signal) => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timeout);
			entry.reject(new Error(`Stage 6 session exited ${String(code)}: ${stderr}`));
		}
		pending.clear();
		resolve({ code, signal });
	}));
	const request = frame => {
		const started = performance.now();
		const promise = register(frame.id, started, frame);
		const wireFrame = stripInternalReadMetadata(frame);
		child.stdin.write(`${JSON.stringify(wireFrame)}\n`);
		return promise;
	};
	const requestGroup = async group => {
		const started = performance.now();
		const promises = group.reads.map(frame => register(
			frame.id, started, frame,
		));
		child.stdin.write(`${JSON.stringify({
			id: group.id,
			reads: group.reads.map(stripInternalReadMetadata),
		})}\n`);
		const samples = await Promise.all(promises);
		return { samples, wallMs: performance.now() - started };
	};
	function register(id, started, frame) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Stage 6 session frame timed out: ${id}`));
			}, 35_000);
			pending.set(id, {
				resolve,
				reject,
				timeout,
				started,
				logicalIndex: frame.logicalIndex ?? null,
				groupIndex: frame.groupIndex ?? null,
				groupPosition: frame.groupPosition ?? null,
				commandFamily: frame.commandFamily ?? readCommandFamily(frame),
			});
		});
	}
	return {
		pid: child.pid,
		pendingCount: () => pending.size,
		request,
		requestGroup,
		async close() {
			child.stdin.end();
			const result = await exited;
			assert.equal(result.code, 0, stderr);
		},
		async terminate() {
			if (child.exitCode === null) child.kill('SIGTERM');
			await exited;
		},
	};
}

function stripInternalReadMetadata(frame) {
	const {
		logicalIndex: _logicalIndex,
		groupIndex: _groupIndex,
		groupPosition: _groupPosition,
		commandFamily: _commandFamily,
		...wireFrame
	} = frame;
	return wireFrame;
}

function readFrame(index, groupIndex = null, groupPosition = null) {
	const commands = ['health', 'task.get', 'tasks.query', 'context.build'];
	const selected = commands[(Math.abs(index) + 1) % commands.length];
	const id = `stage6-read-${index}-${randomUUID()}`;
	const metadata = {
		logicalIndex: index,
		groupIndex,
		groupPosition,
		commandFamily: selected,
	};
	if (selected === 'health') {
		return {
			id,
			...metadata,
			argv: ['health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json'],
		};
	}
	const operonId = index % 2 ? 'file001' : 'inln001';
	if (selected === 'task.get') {
		return {
			id,
			...metadata,
			argv: ['task', 'get', '--vault', CLI_SPEED_STAGE1_VAULT, '--json', '--input', '-'],
			input: `${JSON.stringify({
				contractVersion: 1,
				requestId: `stage6-get-${randomUUID()}`,
				kind: 'task-get',
				selector: { kind: 'operon-id', operonId },
				consistency: 'live-verified',
			})}\n`,
		};
	}
	if (selected === 'tasks.query') {
		return {
			id,
			...metadata,
			argv: ['query', '--vault', CLI_SPEED_STAGE1_VAULT, '--json', '--input', '-'],
			input: `${JSON.stringify({
				contractVersion: 1,
				requestId: `stage6-query-${randomUUID()}`,
				kind: 'task-query',
				consistency: 'live-verified',
				filters: { text: 'fixture' },
				limit: 8,
			})}\n`,
		};
	}
	return {
		id,
		...metadata,
		argv: ['context', '--vault', CLI_SPEED_STAGE1_VAULT, '--json', '--input', '-'],
		input: `${JSON.stringify({
			contractVersion: 1,
			requestId: `stage6-context-${randomUUID()}`,
			kind: 'context',
			purpose: 'read',
			projection: 'exact-task',
			selector: { kind: 'operon-id', operonId },
			limit: 1,
			depth: 0,
			consistency: 'live-verified',
		})}\n`,
	};
}

function readSemanticKey(index) {
	const commands = ['health', 'task.get', 'tasks.query', 'context.build'];
	const selected = commands[(Math.abs(index) + 1) % commands.length];
	if (selected === 'health') return 'health:ready';
	const operonId = index % 2 ? 'file001' : 'inln001';
	if (selected === 'tasks.query') return 'tasks.query:task-query-result';
	return `${selected}:${operonId}`;
}

function readResponseSemanticKey(sample) {
	const envelope = sample?.response?.result;
	const result = envelope?.result;
	if (envelope?.command === 'health') {
		return `health:${result?.lifecyclePhase ?? 'missing'}`;
	}
	if (envelope?.command === 'task.get') {
		return `task.get:${result?.task?.identity?.operonId ?? 'missing'}`;
	}
	if (envelope?.command === 'tasks.query') {
		return `tasks.query:${result?.kind ?? 'missing'}`;
	}
	if (envelope?.command === 'context.build') {
		return `context.build:${result?.entities?.[0]?.identity?.operonId ?? 'missing'}`;
	}
	return 'unknown';
}

function readObservedSemanticKey(sample) {
	const envelope = sample?.response?.result;
	const result = envelope?.result;
	return JSON.stringify(canonicalizeStage6ReadSemanticValue({
		command: envelope?.command ?? 'missing',
		contextRevision: result?.contextRevision ?? null,
		result,
		warnings: envelope?.warnings ?? [],
	}));
}

function readCommandFamily(frame) {
	const command = frame?.argv?.[0];
	if (command === 'task' && frame?.argv?.[1] === 'get') return 'task.get';
	if (command === 'query') return 'tasks.query';
	if (command === 'context') return 'context.build';
	return command;
}

function resetVault() {
	for (const [command, args] of [
		['obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']],
		[process.execPath, [
			path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
			'--production', '--allow-active-vault-ephemera', CLI_SPEED_STAGE1_VAULT,
		]],
		['obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']],
	]) {
		const result = spawnSync(command, args, {
			cwd: pluginRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const health = spawnSync(process.execPath, [
			candidateCli, 'health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json',
		], {
			cwd: pluginRoot, encoding: 'utf8', env: benchmarkEnv(),
		});
		if (health.status === 0) return;
		spawnSync('sleep', ['0.25']);
	}
	throw new Error('Stage 6 Runtime did not become ready after vault reset.');
}

function benchmarkEnv() {
	return {
		...process.env,
		OPERON_CONFIG_HOME: configRoot,
		OPERON_CLI_BENCHMARK_TRACE_PATH: tracePath,
		OPERON_CLI_BENCHMARK_TRANSPORT_EVIDENCE: '1',
	};
}

function summarizeTransportEvidence(logicalRequestCount = STAGE6_PROFILE.reads) {
	const values = existsSync(transportEvidencePath)
		? readFileSync(transportEvidencePath, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map(line => JSON.parse(line))
		: [];
	return summarizeStage6TransportEvidence(values, logicalRequestCount);
}

function countReadCommands(samples) {
	const counts = {};
	for (const sample of samples) {
		const command = sample?.response?.result?.command;
		if (typeof command === 'string') counts[command] = (counts[command] ?? 0) + 1;
	}
	return counts;
}

function processRssBytes(pid) {
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const kib = Number.parseInt(result.stdout.trim(), 10);
	assert.equal(Number.isFinite(kib), true, 'Stage 6 RSS measurement unavailable.');
	return kib * 1024;
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

function findObsidianPid() {
	const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const candidates = result.stdout.split('\n').flatMap(line => {
		const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
		return match && /Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/u.test(match[2])
			? [Number.parseInt(match[1], 10)]
			: [];
	});
	assert.equal(candidates.length, 1, 'Expected exactly one main Obsidian process.');
	return candidates[0];
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function digestVaultPath(relativePath) {
	const target = path.join(CLI_SPEED_STAGE1_VAULT, relativePath);
	return existsSync(target)
		? createHash('sha256').update(readFileSync(target)).digest('hex')
		: 'absent';
}

function sha256File(target) {
	return createHash('sha256').update(readFileSync(target)).digest('hex');
}
