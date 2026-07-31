#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
	CLI_SPEED_STAGE1_VAULT,
	assertCliSpeedStage1Vault,
	summarizeDurations,
} from './cli-speed-stage1-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cliArtifact = path.resolve(process.env.OPERON_CLI_EXECUTABLE ?? (
	path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs')
));
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage3-jsonl-');
const tracePath = path.join(configRoot, 'runtime-dispatches.jsonl');
const samplePlan = Object.freeze({
	warmup: sampleCount('OPERON_CLI_SPEED_SESSION_WARMUPS', 3),
	warm: sampleCount('OPERON_CLI_SPEED_SESSION_WARM_SAMPLES', 100),
	throughput: sampleCount('OPERON_CLI_SPEED_SESSION_THROUGHPUT_SAMPLES', 100),
	leak: sampleCount('OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES', 1000),
});
const REQUEST_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;

assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, {
	lstatSync,
	realpathSync,
});

let result;
try {
	result = await collect();
} catch (error) {
	result = {
		status: 'blocked',
		reason: classifyBlocker(error),
		message: error instanceof Error ? error.message : String(error),
	};
} finally {
	rmSync(configRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== 'collected') process.exitCode = 1;

async function collect() {
	const child = spawn(process.execPath, [cliArtifact, 'session', '--jsonl'], {
		cwd: pluginRoot,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			OPERON_CONFIG_HOME: configRoot,
			OPERON_CLI_BENCHMARK_TRACE_PATH: tracePath,
		},
	});
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', chunk => {
		stderr += chunk;
	});
	const pending = new Map();
	const rejectPending = error => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timeout);
			entry.reject(error);
		}
		pending.clear();
	};
	let stdoutBuffer = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', chunk => {
		stdoutBuffer += chunk;
		while (true) {
			const newlineIndex = stdoutBuffer.indexOf('\n');
			if (newlineIndex < 0) break;
			const line = stdoutBuffer.slice(0, newlineIndex).trim();
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			if (!line) continue;
			let response;
			try {
				response = JSON.parse(line);
			} catch (error) {
				rejectPending(error);
				continue;
			}
			const entry = pending.get(response.id);
			if (!entry) continue;
			pending.delete(response.id);
			clearTimeout(entry.timeout);
			entry.resolve(response);
		}
	});
	const exited = new Promise(resolve => {
		child.once('exit', (code, signal) => {
			const error = new Error(
				`JSONL session exited ${String(code)}${signal ? ` (${signal})` : ''}: ${stderr.trim()}`,
			);
			rejectPending(error);
			resolve({ code, signal });
		});
	});
	child.once('error', error => {
		rejectPending(error);
	});
	const request = async (sequence, phase) => {
		const id = `${phase}-${sequence}-${randomUUID()}`;
		const payload = taskGetPayload(id);
		const started = performance.now();
		const responsePromise = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`JSONL request timed out after ${REQUEST_TIMEOUT_MS}ms: ${id}`));
			}, REQUEST_TIMEOUT_MS);
			pending.set(id, { resolve, reject, timeout });
		});
		try {
			await writeLine(child, `${JSON.stringify(payload)}\n`, REQUEST_TIMEOUT_MS);
		} catch (error) {
			const entry = pending.get(id);
			if (entry) {
				pending.delete(id);
				clearTimeout(entry.timeout);
			}
			throw error;
		}
		const response = await responsePromise;
		return {
			ok: responseOk(response),
			durationMs: performance.now() - started,
			response,
		};
	};

	try {
		for (let index = 0; index < samplePlan.warmup; index += 1) {
		const warmup = await request(index, 'warmup');
		assert.equal(warmup.ok, true, `JSONL warmup failed: ${JSON.stringify(warmup.response)}`);
		}
		const warmReadResults = [];
		for (let index = 0; index < samplePlan.warm; index += 1) {
			warmReadResults.push(await request(index, 'warm'));
		}
		const throughputStarted = performance.now();
		const throughputResults = await Promise.all(
			Array.from({ length: samplePlan.throughput }, (_, index) => request(index, 'throughput')),
		);
		const throughputWallMs = performance.now() - throughputStarted;
		const rssBeforeBytes = processRssBytes(child.pid);
		const fdBefore = processFdCount(child.pid);
		const leakResults = [];
		for (let index = 0; index < samplePlan.leak; index += 1) {
			leakResults.push(await request(index, 'leak'));
		}
		const rssAfterBytes = processRssBytes(child.pid);
		const fdAfter = processFdCount(child.pid);
		child.stdin.end();
		const exit = await withTimeout(
			exited,
			EXIT_TIMEOUT_MS,
			`JSONL session did not exit within ${EXIT_TIMEOUT_MS}ms.`,
		);
		if (exit.code !== 0) {
			throw new Error(`JSONL session exited ${String(exit.code)}: ${stderr.trim()}`);
		}
		const dispatchCount = traceLineCount();
		const expectedDispatches = samplePlan.warmup
			+ samplePlan.warm
			+ samplePlan.throughput
			+ samplePlan.leak;
		return {
			status: 'collected',
			protocol: 'operon-session-jsonl-v1',
			samplePlan,
			warmupSamples: samplePlan.warmup,
			warmReads: summarizeResults(warmReadResults),
			throughput: {
				...summarizeResults(throughputResults),
				wallMs: throughputWallMs,
				requestsPerSecond: throughputWallMs > 0
					? samplePlan.throughput * 1000 / throughputWallMs
					: null,
			},
			leakCharacterization: {
				...summarizeResults(leakResults),
				rssBeforeBytes,
				rssAfterBytes,
				rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
				fdBefore,
				fdAfter,
				fdDelta: fdAfter - fdBefore,
				pendingRequestsAfter: pending.size,
			},
			runtimeDispatches: {
				count: dispatchCount,
				expected: expectedDispatches,
				perRequest: dispatchCount / expectedDispatches,
			},
			rawSamples: {
				warm: rawSessionSamples('warm', warmReadResults),
				throughput: rawSessionSamples('throughput', throughputResults),
				leak: rawSessionSamples('leak', leakResults),
			},
		};
	} catch (error) {
		await terminateChild(child, exited);
		throw error;
	}
}

function rawSessionSamples(phase, values) {
	return values.map((value, index) => ({
		id: `jsonl-${phase}-${index}`,
		ok: value.ok,
		metrics: { durationMs: value.durationMs },
		raw: responseAuditEvidence(value.response),
	}));
}

function responseAuditEvidence(response) {
	const result = response?.result;
	const errorCode = firstNonEmptyString(
		response?.error?.code,
		response?.error?.details?.code,
		result?.error?.code,
	);
	const exitCode = Number.isSafeInteger(response?.exitCode) ? response.exitCode : null;
	const vaultExpectedMatch = typeof result?.vaultIdentity?.expectedMatch === 'boolean'
		? result.vaultIdentity.expectedMatch
		: null;
	const operonId = firstNonEmptyString(result?.result?.task?.identity?.operonId);
	const validationReasons = [];
	if (exitCode !== 0) validationReasons.push('exit-code-nonzero-or-missing');
	if (response?.error) validationReasons.push('response-error');
	if (result?.ok !== true) validationReasons.push('result-not-ok');
	if (vaultExpectedMatch !== true) validationReasons.push('vault-identity-not-verified');
	if (operonId !== 'inln001') validationReasons.push('operon-id-mismatch-or-missing');
	return {
		exitCode,
		errorCode,
		vaultExpectedMatch,
		operonId,
		validationReasons,
	};
}

function firstNonEmptyString(...values) {
	return values.find(value => typeof value === 'string' && value.length > 0) ?? null;
}

async function terminateChild(child, exited) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.stdin.destroy();
	child.kill('SIGTERM');
	try {
		await withTimeout(exited, 5_000, 'JSONL session ignored SIGTERM.');
	} catch {
		child.kill('SIGKILL');
		try {
			await withTimeout(exited, 5_000, 'JSONL session ignored SIGKILL.');
		} catch {
			// The collector is already failing; leave the original error as the reported blocker.
		}
	}
}

function sampleCount(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return value;
}

function taskGetPayload(id) {
	return {
		id,
		argv: [
			'task',
			'get',
			'--vault',
			CLI_SPEED_STAGE1_VAULT,
			'--json',
			'--input',
			'-',
		],
		input: `${JSON.stringify({
			contractVersion: 1,
			requestId: `stage3-session-${randomUUID()}`,
			kind: 'task-get',
			selector: { kind: 'operon-id', operonId: 'inln001' },
			consistency: 'live-verified',
		})}\n`,
	};
}

function responseOk(response) {
	if (response?.exitCode !== 0 || response.error) return false;
	const result = response.result;
	return result?.ok === true
		&& result?.vaultIdentity?.expectedMatch === true
		&& result?.result?.task?.identity?.operonId === 'inln001';
}

function summarizeResults(values) {
	const successes = values.filter(value => value.ok).length;
	return {
		attempts: values.length,
		successes,
		durationMs: summarizeDurations(values.filter(value => value.ok).map(value => value.durationMs)),
	};
}

async function writeLine(child, line, timeoutMs) {
	if (child.exitCode !== null) throw new Error('JSONL session exited before accepting input.');
	if (child.stdin.write(line)) return;
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`JSONL stdin remained backpressured for ${timeoutMs}ms.`));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timeout);
			child.stdin.off('drain', onDrain);
			child.stdin.off('error', onError);
			child.stdin.off('close', onClose);
		};
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onError = error => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new Error('JSONL stdin closed while waiting for drain.'));
		};
		child.stdin.once('drain', onDrain);
		child.stdin.once('error', onError);
		child.stdin.once('close', onClose);
	});
}

async function withTimeout(promise, timeoutMs, message) {
	let timeout;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function processRssBytes(pid) {
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error('Could not inspect JSONL session RSS.');
	const kibibytes = Number(result.stdout.trim());
	if (!Number.isFinite(kibibytes)) throw new Error('JSONL session RSS is invalid.');
	return kibibytes * 1024;
}

function processFdCount(pid) {
	const result = spawnSync('lsof', ['-a', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error('Could not inspect JSONL session file descriptors.');
	return result.stdout.split('\n').filter(line => line.startsWith('n')).length;
}

function traceLineCount() {
	try {
		return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).length;
	} catch {
		return 0;
	}
}

function classifyBlocker(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (/unknown command "session"|did you mean|exited (2|64)(?:\\D|$)/iu.test(message)) {
		return 'capability-unavailable';
	}
	if (/transport-unavailable/iu.test(message)) return 'transport-unavailable';
	return 'collection-failed';
}
