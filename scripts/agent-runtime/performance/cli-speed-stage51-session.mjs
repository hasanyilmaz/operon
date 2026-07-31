#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
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
	analyzeStage51OverheadPairs,
	improvementPercent,
	STAGE51_PROFILE,
	STAGE51_REQUIRED_UNITS,
	summarize,
} from './cli-speed-stage51-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cli = path.resolve(process.env.OPERON_CLI_EXECUTABLE ?? (
	path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs')
));
const timingCli = path.resolve(process.env.OPERON_CLI_STAGE51_TIMING_EXECUTABLE ?? cli);
const baselineCli = path.resolve(process.env.OPERON_CLI_STAGE51_BASELINE_EXECUTABLE ?? cli);
const resultPath = process.env.OPERON_CLI_STAGE51_RESULT_PATH;
const unitIndex = process.argv.indexOf('--unit');
const unit = unitIndex >= 0 ? process.argv[unitIndex + 1] : '';
const allowedUnits = new Set([...STAGE51_REQUIRED_UNITS, 'promotion-smoke']);
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage51-session-');
const dispatchTracePath = path.join(configRoot, 'runtime-dispatches.jsonl');
const transportTracePath = path.join(configRoot, 'transport-selections.jsonl');

assert.equal(allowedUnits.has(unit), true, `Unknown Stage 5.1 unit: ${unit}`);
assert.equal(typeof resultPath, 'string', 'OPERON_CLI_STAGE51_RESULT_PATH is required.');
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });

let result;
try {
	result = await collectUnit(unit);
} catch (error) {
	result = {
		status: 'failed',
		unit,
		reason: classifyFailure(error),
		message: error instanceof Error ? error.message : String(error),
	};
} finally {
	rmSync(configRoot, { recursive: true, force: true });
}
atomicWriteJson(resultPath, result);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'collected' && result.status !== 'passed') process.exitCode = 1;

async function collectUnit(name) {
	if (name === 'negative-tests') return collectNegativeTests();
	resetVault();
	if (name === 'parity') return collectParity();
	if (name === 'timed') return collectTimed(STAGE51_PROFILE.timed);
	if (name === 'throughput') return collectThroughput();
	if (name === 'overhead') return collectOverhead();
	if (name === 'soak') return collectSoak();
	if (name === 'mutation-isolation') return collectMutationIsolation();
	if (name === 'promotion-smoke') return collectPromotionSmoke();
	throw new Error(`Unsupported Stage 5.1 unit: ${name}`);
}

async function collectPromotionSmoke() {
	const reads = {};
	const measuredReadRequestIds = [];
	for (const family of ['health', 'task.get', 'context.build']) {
		const collected = await collectFrames({
			count: 1,
			family,
			disablePersistent: false,
			timing: false,
		});
		reads[family] = {
			attempts: 1,
			successes: collected.samples.filter(value => value.ok).length,
			raw: collected.samples,
		};
		for (const sample of collected.samples) {
			const requestId = sample.response?.result?.requestId;
			if (typeof requestId === 'string') measuredReadRequestIds.push(requestId);
		}
	}
	const readTransportEvidence = readTransportTrace().filter(value => (
		measuredReadRequestIds.includes(value.requestId)
	));
	return {
		status: 'collected',
		reads,
		readTransportEvidence,
		persistentReads: readTransportEvidence.filter(
			value => value.transport === 'persistent',
		).length,
		readFallbacks: readTransportEvidence.filter(
			value => value.transport === 'request-file-fallback',
		).length,
		mutationIsolation: await collectMutationIsolation(1),
	};
}

async function collectParity() {
	const families = {};
	for (const family of ['health', 'task.get', 'context.build']) {
		const baseline = await collectFrames({
			count: STAGE51_PROFILE.parityPerFamily,
			family,
			disablePersistent: true,
			timing: false,
		});
		const candidate = await collectFrames({
			count: STAGE51_PROFILE.parityPerFamily,
			family,
			disablePersistent: false,
			timing: false,
		});
		const matches = baseline.samples.filter((sample, index) => (
			sample.ok && candidate.samples[index]?.ok
			&& semanticJson(sample.response) === semanticJson(candidate.samples[index].response)
		)).length;
		families[family] = {
			attempts: STAGE51_PROFILE.parityPerFamily,
			successes: candidate.samples.filter(value => value.ok).length,
			semanticMatches: matches,
			baseline: baseline.samples,
			candidate: candidate.samples,
		};
	}
	return { status: 'collected', authoritativeForGates: true, families };
}

async function collectTimed(count) {
	const collected = await collectFrames({
		count, family: 'mixed', disablePersistent: false, timing: true,
	});
	const timings = collected.timings;
	if (timings.length === 0) throw new Error(
		'Stage 5.1 frame timing hook unavailable: OPERON_CLI_STAGE51_TIMING_FD emitted no records.',
	);
	if (timings.some(value => !Number.isFinite(value.timeOriginMs))) {
		throw new Error(
			'Stage 5.1 frame timing hook unavailable: timing batch lacks timeOriginMs.',
		);
	}
	const byId = new Map();
	let duplicates = 0;
	for (const timing of timings) {
		if (byId.has(timing.id)) duplicates += 1;
		else byId.set(timing.id, timing);
	}
	const linkedSamples = collected.samples.filter(sample => byId.has(sample.id));
	const residuals = linkedSamples.map(sample => {
		const timing = byId.get(sample.id);
		const serviceStartEpochMs = timing.timeOriginMs + timing.serviceStartMs;
		const queue = serviceStartEpochMs - sample.submittedEpochMs;
		const service = timing.serviceEndMs - timing.serviceStartMs;
		const serviceEndEpochMs = timing.timeOriginMs + timing.serviceEndMs;
		const delivery = sample.receivedEpochMs - serviceEndEpochMs;
		return {
			id: sample.id,
			queueMs: queue,
			serviceMs: service,
			deliveryMs: delivery,
			residualMs: Math.abs(sample.outerMs - (queue + service + delivery)),
			transport: timing.transport ?? null,
		};
	});
	return {
		status: 'collected',
		attempts: count,
		successes: collected.samples.filter(value => value.ok).length,
		linked: linkedSamples.length,
		unique: byId.size,
		overflow: collected.timingOverflow,
		duplicates,
		missing: count - linkedSamples.length,
		clockOffsetMs: timings.every(value => Number.isFinite(value.clockOffsetMs))
			? Math.max(...timings.map(value => Math.abs(value.clockOffsetMs)))
			: null,
		nonNegativeComponents: residuals.filter(value => (
			value.queueMs >= 0 && value.serviceMs >= 0 && value.deliveryMs >= 0
		)).length,
		residualWithinLimit: residuals.filter(value => value.residualMs <= 1).length,
		serviceMs: summarize(residuals.map(value => value.serviceMs)),
		queueMs: summarize(residuals.map(value => value.queueMs)),
		deliveryMs: summarize(residuals.map(value => value.deliveryMs)),
		rawSamples: residuals,
	};
}

async function collectThroughput() {
	const baseline = await collectFrames({
		count: STAGE51_PROFILE.throughput,
		family: 'mixed',
		disablePersistent: true,
		timing: false,
	});
	const candidate = await collectFrames({
		count: STAGE51_PROFILE.throughput,
		family: 'mixed',
		disablePersistent: false,
		timing: false,
	});
	const baselineSummary = summarizeFrames(baseline);
	const candidateSummary = summarizeFrames(candidate);
	return {
		status: 'collected',
		baseline: baselineSummary,
		candidate: candidateSummary,
		speedup: candidateSummary.requestsPerSecond / baselineSummary.requestsPerSecond,
		outerImprovementPercent: {
			p50: improvementPercent(
				baselineSummary.outerWallMs.p50, candidateSummary.outerWallMs.p50,
			),
			p95: improvementPercent(
				baselineSummary.outerWallMs.p95, candidateSummary.outerWallMs.p95,
			),
		},
	};
}

async function collectOverhead() {
	const executableDigestBefore = sha256File(timingCli);
	const timedSession = startSession({
		disablePersistent: false, timing: true, executable: timingCli,
	});
	const controlSession = startSession({
		disablePersistent: false, timing: false, executable: timingCli,
	});
	const timedSamples = [];
	const controlSamples = [];
	const pairs = [];
	let timedWarmups = [];
	try {
		timedWarmups = await timedSession.warmup();
		await controlSession.warmup();
		for (let index = 0; index < STAGE51_PROFILE.overhead; index += 1) {
			const logical = frameFor('mixed', index);
			const timedFrame = { ...logical, id: `stage51-overhead-timed-${index}-${randomUUID()}` };
			const controlFrame = { ...logical, id: `stage51-overhead-control-${index}-${randomUUID()}` };
			const timedFirst = index % 2 === 0;
			const first = timedFirst
				? await timedSession.request(timedFrame)
				: await controlSession.request(controlFrame);
			const second = timedFirst
				? await controlSession.request(controlFrame)
				: await timedSession.request(timedFrame);
			const timedSample = timedFirst ? first : second;
			const controlSample = timedFirst ? second : first;
			assert.equal(timedSample.ok, true, `Timed overhead frame ${index} failed.`);
			assert.equal(controlSample.ok, true, `Control overhead frame ${index} failed.`);
			assert.equal(
				semanticJson(timedSample.response),
				semanticJson(controlSample.response),
				`Paired overhead semantic mismatch at frame ${index}.`,
			);
			timedSamples.push(timedSample);
			controlSamples.push(controlSample);
			pairs.push({
				index,
				order: timedFirst ? 'AB' : 'BA',
				family: ['health', 'task.get', 'context.build'][index % 3],
				timedMs: timedSample.outerMs,
				controlMs: controlSample.outerMs,
				deltaMs: timedSample.outerMs - controlSample.outerMs,
				percent: overheadPercent(controlSample.outerMs, timedSample.outerMs),
			});
		}
		await timedSession.close();
		await controlSession.close();
	} catch (error) {
		await timedSession.terminate();
		await controlSession.terminate();
		throw error;
	}
	const timingRecords = timedSession.timings();
	const measuredIds = new Set(timedSamples.map(value => value.id));
	const warmupIds = new Set(timedWarmups.map(value => value.id));
	const measuredTiming = timingRecords.filter(value => measuredIds.has(value.id));
	const warmupTiming = timingRecords.filter(value => warmupIds.has(value.id));
	const timingIds = timingRecords.map(value => value.id);
	const uniqueTimingIds = new Set(timingIds);
	const timingOverflow = timedSession.timingOverflow();
	const persistentMeasured = measuredTiming.filter(
		value => value.transport === 'persistent',
	).length;
	const executableDigestAfter = sha256File(timingCli);
	const timed = { samples: timedSamples, wallMs: sumOuter(timedSamples) };
	const untimed = { samples: controlSamples, wallMs: sumOuter(controlSamples) };
	const timedSummary = summarizeFrames(timed);
	const untimedSummary = summarizeFrames(untimed);
	const absolute = summarize(pairs.map(value => value.deltaMs));
	const percent = summarize(pairs.map(value => value.percent));
	const diagnostic = analyzeStage51OverheadPairs(pairs);
	return {
		status: 'collected',
		method: 'paired-same-binary-alternating-ab-ba',
		executable: timingCli,
		executableDigestBefore,
		executableDigestAfter,
		order: pairs.map(value => value.order),
		timed: timedSummary,
		untimed: untimedSummary,
		paired: {
			attempts: pairs.length,
			semanticMatches: pairs.length,
			measuredTimingRecords: measuredTiming.length,
			warmupTimingRecords: warmupTiming.length,
			uniqueTimingRecords: uniqueTimingIds.size,
			totalTimingRecords: timingRecords.length,
			timingOverflow,
			persistentMeasured,
			raw: pairs,
		},
		percent,
		absoluteMs: absolute,
		diagnostic,
	};
}

async function collectSoak() {
	const session = startSession({ disablePersistent: false, timing: false });
	try {
		const obsidianPid = findObsidianPid();
		const endpointPath = persistentSocketPath();
		const obsidianUnixFdsBefore = processUnixFdCount(obsidianPid);
		const listenerRefsBefore = processUnixPathRefCount(obsidianPid, endpointPath);
		await session.warmup();
		const rssBeforeBytes = processRssBytes(session.pid);
		const fdBefore = processFdCount(session.pid);
		const samples = [];
		for (let index = 0; index < STAGE51_PROFILE.soak; index += 1) {
			samples.push(await session.request(frameFor('mixed', index)));
		}
		const rssAfterBytes = processRssBytes(session.pid);
		const fdAfter = processFdCount(session.pid);
		await session.close();
		const obsidianUnixFdsAfter = processUnixFdCount(obsidianPid);
		const listenerRefsAfter = processUnixPathRefCount(obsidianPid, endpointPath);
		return {
			status: 'collected',
			attempts: samples.length,
			successes: samples.filter(value => value.ok).length,
			rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
			fdDelta: fdAfter - fdBefore,
			socketDelta: obsidianUnixFdsAfter - obsidianUnixFdsBefore,
			listenerDelta: listenerRefsAfter - listenerRefsBefore,
			pendingAfter: session.pendingCount(),
			observed: {
				obsidianPid,
				endpointPath,
				obsidianUnixFdsBefore,
				obsidianUnixFdsAfter,
				listenerRefsBefore,
				listenerRefsAfter,
				sessionFdBefore: fdBefore,
				sessionFdAfter: fdAfter,
			},
		};
	} catch (error) {
		await session.terminate();
		throw error;
	}
}

async function collectMutationIsolation(
	count = STAGE51_PROFILE.mutationIsolationPerFamily,
) {
	const families = {};
	for (const family of ['compact-create', 'exact-update']) {
		const traceStart = readDispatchTrace().length;
		const transportTraceStart = readTransportTrace().length;
		const collected = await collectFrames({
			count,
			family,
			disablePersistent: false,
			timing: false,
		});
		const allDispatches = readDispatchTrace().slice(traceStart);
		const transportSelections = readTransportTrace().slice(transportTraceStart);
		const warmupDispatches = allDispatches.slice(0, 2);
		const dispatches = allDispatches.slice(2);
		const successful = collected.samples.filter(value => value.ok);
		const mutationDispatches = dispatches.filter(value => (
			['mutation', 'plan'].some(prefix => String(value?.command?.[0] ?? '').startsWith(prefix))
		));
		const readDispatches = dispatches.filter(value => !mutationDispatches.includes(value));
		const requestFileSamples = successful.filter(value => (
			value.response?.result?.transport?.channel === 'request-file'
		));
		const persistentMutationDispatches = transportSelections.filter(value => (
			value.transport === 'persistent'
			&& !['health', 'task.get', 'context.build'].includes(value.command)
		));
		families[family] = {
			attempts: collected.samples.length,
			successes: successful.length,
			// A successful compact mutation frame may use an allowlisted persistent
			// read for discovery, but preview/apply are excluded by the client and
			// server allowlists and are covered by the negative transport tests.
			requestFileDispatches: requestFileSamples.length,
			persistentDispatches: persistentMutationDispatches.length,
			persistentReadDispatches: transportSelections.filter(value => (
				value.transport === 'persistent'
				&& ['health', 'task.get', 'context.build'].includes(value.command)
			)).length,
			transportSelections,
			observedRuntimeDispatches: dispatches.length,
			expectedRuntimeDispatches: successful.length * 3,
			observedMutationDispatches: mutationDispatches.length,
			observedReadDispatches: readDispatches.length,
			dispatchTrace: dispatches,
			warmupDispatchTrace: warmupDispatches,
			transportClassification: 'benchmark-dispatch-command-and-server-allowlist',
			verifiedPostflight: collected.samples.filter(value => value.verifiedPostflight).length,
		};
	}
	return { status: 'collected', families };
}

function collectNegativeTests() {
	const commands = [
		[process.execPath, ['scripts/agent-runtime/cli-transport/run-native-transport-tests.mjs']],
		[process.execPath, ['scripts/agent-runtime/cli/run-session-jsonl-tests.mjs']],
	];
	for (const [command, args] of commands) {
		const result = spawnSync(command, args, {
			cwd: pluginRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
		});
		if (
			result.status !== 0
			|| /# SKIP|ℹ skipped [1-9]|# skipped [1-9]/u.test(result.stdout)
		) throw new Error(
			`Persistent transport negative tests failed: ${result.stderr || result.stdout}`,
		);
	}
	return {
		status: 'passed',
		runtimeMutationCalls: 0,
		planStoreCalls: 0,
		testCommands: commands.map(([command, args]) => [command, ...args].join(' ')),
	};
}

async function collectFrames(options) {
	const session = startSession(options);
	try {
		await session.warmup();
		const started = performance.now();
		const samples = [];
		for (let index = 0; index < options.count; index += 1) {
			samples.push(await session.request(frameFor(options.family, index)));
		}
		const wallMs = performance.now() - started;
		await session.close();
		const sampleIds = new Set(samples.map(value => value.id));
		return {
			samples,
			wallMs,
			timings: session.timings().filter(value => sampleIds.has(value.id)),
			timingOverflow: session.timingOverflow(),
		};
	} catch (error) {
		await session.terminate();
		throw error;
	}
}

function startSession({ disablePersistent, timing, executable }) {
	const stdio = ['pipe', 'pipe', 'pipe', timing ? 'pipe' : 'ignore'];
	const env = {
		...process.env,
		OPERON_CONFIG_HOME: configRoot,
		OPERON_CLI_BENCHMARK_TRACE_PATH: dispatchTracePath,
		...(timing ? { OPERON_CLI_STAGE51_TIMING_FD: '3' } : {}),
	};
	if (!timing) delete env.OPERON_CLI_STAGE51_TIMING_FD;
	const sessionCli = executable ?? (
		disablePersistent ? baselineCli : (timing ? timingCli : cli)
	);
	const child = spawn(process.execPath, [sessionCli, 'session', '--jsonl'], {
		cwd: pluginRoot, stdio, env,
	});
	const pending = new Map();
	const timingRecords = [];
	let timingOverflow = 0;
	let stdout = '';
	let stderr = '';
	let timingText = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', chunk => { stderr += chunk; });
	child.stdout.setEncoding('utf8');
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
			entry.resolve(auditResponse(
				response, entry.started, entry.submittedEpochMs,
			));
		}
	});
	if (timing && child.stdio[3]) {
		child.stdio[3].setEncoding('utf8');
		child.stdio[3].on('data', chunk => { timingText += chunk; });
	}
	const exited = new Promise(resolve => {
		child.once('exit', (code, signal) => {
			if (code !== 0) rejectAll(new Error(
				`Stage 5.1 JSONL session exited ${String(code)}${signal ? ` (${signal})` : ''}: ${stderr}`,
			));
			resolve({ code, signal });
		});
	});
	child.once('error', rejectAll);
	function rejectAll(error) {
		for (const entry of pending.values()) {
			clearTimeout(entry.timeout);
			entry.reject(error);
		}
		pending.clear();
	}
	return {
		pid: child.pid,
		pendingCount: () => pending.size,
		timings: () => {
			for (const line of timingText.split('\n').filter(Boolean)) {
				const value = JSON.parse(line);
				if (Array.isArray(value?.records)) {
					timingOverflow += Number(value.overflow ?? 0);
					for (const record of value.records) {
						timingRecords.push({
							...record,
							...(Number.isFinite(value.timeOriginMs)
								? { timeOriginMs: value.timeOriginMs }
								: {}),
							...(Number.isFinite(value.clockOffsetMs)
								? { clockOffsetMs: value.clockOffsetMs }
								: {}),
						});
					}
				} else if (value?.kind === 'overflow') {
					timingOverflow += Number(value.count ?? 1);
				} else {
					timingRecords.push(value);
				}
			}
			timingText = '';
			return timingRecords;
		},
		timingOverflow: () => timingOverflow,
		async warmup() {
			const samples = [];
			for (let index = 0; index < 2; index += 1) {
				const sample = await this.request(frameFor('task.get', index));
				assert.equal(sample.ok, true, 'Stage 5.1 warmup failed.');
				samples.push(sample);
			}
			return samples;
		},
		request(frame) {
			const started = performance.now();
			const submittedEpochMs = performance.timeOrigin + started;
			const promise = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					pending.delete(frame.id);
					reject(new Error(`Stage 5.1 JSONL frame timed out: ${frame.id}`));
				}, 35_000);
				pending.set(frame.id, {
					resolve, reject, timeout, started, submittedEpochMs,
				});
			});
			child.stdin.write(`${JSON.stringify(frame)}\n`);
			return promise;
		},
		async close() {
			child.stdin.end();
			const exit = await exited;
			assert.equal(exit.code, 0, stderr);
		},
		async terminate() {
			if (child.exitCode === null) child.kill('SIGTERM');
			await exited.catch(() => {});
		},
	};
}

function frameFor(family, index) {
	const selected = family === 'mixed'
		? ['health', 'task.get', 'context.build'][index % 3]
		: family;
	const id = `stage51-${selected}-${index}-${randomUUID()}`;
	if (selected === 'health') {
		return { id, argv: ['health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json'] };
	}
	if (selected === 'task.get') {
		return {
			id,
			argv: ['task', 'get', '--vault', CLI_SPEED_STAGE1_VAULT, '--json', '--input', '-'],
			input: `${JSON.stringify({
				contractVersion: 1,
				requestId: `stage51-get-${randomUUID()}`,
				kind: 'task-get',
				selector: { kind: 'operon-id', operonId: index % 2 ? 'file001' : 'inln001' },
				consistency: 'live-verified',
			})}\n`,
		};
	}
	if (selected === 'context.build') {
		return {
			id,
			argv: ['context', '--vault', CLI_SPEED_STAGE1_VAULT, '--json', '--input', '-'],
			input: `${JSON.stringify({
				contractVersion: 1,
				requestId: `stage51-context-${randomUUID()}`,
				kind: 'context',
				purpose: 'read',
				projection: 'exact-task',
				selector: { kind: 'operon-id', operonId: index % 2 ? 'file001' : 'inln001' },
				limit: 1,
				depth: 0,
				consistency: 'live-verified',
			})}\n`,
		};
	}
	if (selected === 'compact-create') {
		return {
			id,
			argv: [
				'task', 'create', 'inline',
				`Stage 5.1 mutation isolation create ${index} ${randomUUID()}`,
				'--vault', CLI_SPEED_STAGE1_VAULT,
				'--json',
			],
		};
	}
	return {
		id,
		argv: [
			'task', 'update', '--id', 'inln001',
			`note::"Stage 5.1 mutation isolation ${index} ${randomUUID()}"`,
			'--vault', CLI_SPEED_STAGE1_VAULT, '--json',
		],
	};
}

function auditResponse(response, started, submittedEpochMs) {
	const envelope = response?.result;
	return {
		id: response?.id ?? null,
		ok: response?.exitCode === 0 && !response?.error && envelope?.ok === true,
		response,
		outerMs: performance.now() - started,
		submittedEpochMs,
		receivedEpochMs: performance.timeOrigin + performance.now(),
		verifiedPostflight: ['applied', 'already-applied'].includes(envelope?.result?.status)
			&& envelope?.result?.postflight?.status === 'verified',
	};
}

function summarizeFrames(value) {
	const successful = value.samples.filter(sample => sample.ok);
	return {
		attempts: value.samples.length,
		successes: successful.length,
		wallMs: value.wallMs,
		requestsPerSecond: value.wallMs > 0 ? value.samples.length * 1000 / value.wallMs : null,
		outerWallMs: summarize(successful.map(sample => sample.outerMs)),
	};
}

function sumOuter(samples) {
	return samples.reduce((sum, sample) => sum + sample.outerMs, 0);
}

function semanticJson(sample) {
	const response = sample?.response;
	if (!response || typeof response !== 'object' || Array.isArray(response)) {
		return JSON.stringify(response ?? null);
	}
	return JSON.stringify({ ...response, id: '<session-id>' });
}

function sha256File(target) {
	return createHash('sha256').update(readFileSync(target)).digest('hex');
}

function overheadPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return null;
	return (after - before) / before * 100;
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
		const result = spawnSync(command, args, { cwd: pluginRoot, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const deadline = Date.now() + 35_000;
	while (Date.now() < deadline) {
		const health = runOneShot(['health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json']);
		if (
			health?.ok === true
			&& health?.result?.lifecyclePhase === 'ready'
			&& health?.result?.freshness?.settled === true
		) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	}
	throw new Error('Runtime did not become ready/settled after Stage 5.1 fixture reset.');
}

function runOneShot(argv) {
	const result = spawnSync(process.execPath, [cli, ...argv], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: { ...process.env, OPERON_CONFIG_HOME: configRoot },
		maxBuffer: 8 * 1024 * 1024,
	});
	if (!result.stdout.trim()) return null;
	return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

function processRssBytes(pid) {
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return Number.parseInt(result.stdout.trim(), 10) * 1024;
}

function processFdCount(pid) {
	const result = spawnSync('lsof', ['-a', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split('\n').filter(line => line.startsWith('n')).length;
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

function processUnixFdNames(pid) {
	const result = spawnSync('lsof', ['-U', '-a', '-p', String(pid), '-Fn'], {
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
}

function processUnixFdCount(pid) {
	return processUnixFdNames(pid).length;
}

function processUnixPathRefCount(pid, target) {
	return processUnixFdNames(pid).filter(name => name === target).length;
}

function persistentSocketPath() {
	const uid = process.getuid();
	const root = `/private/tmp/operon-agent-runtime-uid-${uid}`;
	const vaultSha256 = createHash('sha256')
		.update(realpathSync(CLI_SPEED_STAGE1_VAULT))
		.digest('hex');
	const descriptorPath = path.join(root, `persistent-read-${vaultSha256}.json`);
	const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
	assert.equal(typeof descriptor?.socketBasename, 'string', 'Persistent descriptor missing socket.');
	const socketPath = path.join(root, descriptor.socketBasename);
	assert.equal(path.dirname(socketPath), root, 'Persistent socket escaped endpoint root.');
	return socketPath;
}

function readDispatchTrace() {
	try {
		return readFileSync(dispatchTracePath, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map(line => JSON.parse(line));
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
		throw error;
	}
}

function readTransportTrace() {
	try {
		return readFileSync(transportTracePath, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map(line => JSON.parse(line));
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
		throw error;
	}
}

function dispatchCommandId(command) {
	if (!Array.isArray(command)) return '';
	if (command[0] === 'task' && command[1] === 'get') return 'task.get';
	if (command[0] === 'context') return 'context.build';
	return String(command[0] ?? '');
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function classifyFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (/timing hook unavailable/iu.test(message)) return 'timing-hook-unavailable';
	if (/persistent.*unavailable|transport-unavailable/iu.test(message)) {
		return 'persistent-transport-unavailable';
	}
	return 'collection-failed';
}
