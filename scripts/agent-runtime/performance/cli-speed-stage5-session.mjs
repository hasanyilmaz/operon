#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdtempSync,
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
import { STAGE5_PROFILE, summarize } from './cli-speed-stage5-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cli = path.resolve(process.env.OPERON_CLI_EXECUTABLE ?? (
	path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs')
));
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage5-session-');
const timeoutMs = 30_000;

assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });

let result;
try {
	result = await collect();
} catch (error) {
	result = {
		status: 'blocked',
		reason: /transport-unavailable/iu.test(String(error))
			? 'transport-unavailable'
			: 'collection-failed',
		message: error instanceof Error ? error.message : String(error),
	};
} finally {
	rmSync(configRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.env.OPERON_CLI_SPEED_STAGE5_SESSION_RESULT_PATH) {
	const destination = path.resolve(process.env.OPERON_CLI_SPEED_STAGE5_SESSION_RESULT_PATH);
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}
if (result.status !== 'collected') process.exitCode = 1;

async function collect() {
	resetVault();
	const session = startSession();
	try {
		for (let index = 0; index < 2; index += 1) {
			const response = await session.request(readFrame(`warmup-${index}`, index));
			assert.equal(readResponseOk(response.response), true);
		}
		const mixedStarted = performance.now();
		const mixed = await Promise.all(Array.from(
			{ length: STAGE5_PROFILE.session },
			(_, index) => session.request(readFrame(`mixed-${index}`, index)),
		));
		const mixedWallMs = performance.now() - mixedStarted;
		const rssBeforeBytes = processRssBytes(session.pid);
		const fdBefore = processFdCount(session.pid);
		const soak = [];
		for (let index = 0; index < STAGE5_PROFILE.soak; index += 1) {
			soak.push(await session.request(readFrame(`soak-${index}`, index)));
		}
		const rssAfterBytes = processRssBytes(session.pid);
		const fdAfter = processFdCount(session.pid);
		await session.close();
		const skillWorkflow = await collectSkillWorkflow();
		return {
			status: 'collected',
			protocol: 'operon-session-jsonl-v1',
			mixed: summarizeSessionSamples(mixed, mixedWallMs),
			soak: {
				...successCounts(soak, value => readResponseOk(value.response)),
				rssBeforeBytes,
				rssAfterBytes,
				rssDeltaBytes: rssAfterBytes - rssBeforeBytes,
				fdBefore,
				fdAfter,
				fdDelta: fdAfter - fdBefore,
				pendingRequestsAfter: session.pendingCount(),
			},
			skillWorkflow,
			rawSamples: {
				mixed: mixed.map(sessionAudit),
				soak: soak.map(sessionAudit),
			},
		};
	} catch (error) {
		await session.terminate();
		throw error;
	}
}

async function collectSkillWorkflow() {
	resetVault();
	const baseline = [];
	for (let index = 0; index < STAGE5_PROFILE.skillWorkflow; index += 1) {
		const description = `Stage 5 one-shot skill workflow ${index}`;
		const started = performance.now();
		const preview = runOneShot([
			'task', 'create', '--vault', CLI_SPEED_STAGE1_VAULT,
			'--input-format', 'compact', '--input', '-', '--json',
		], `"${description}"`);
		const planRef = preview?.client?.planRef;
		const apply = typeof planRef === 'string'
			? runOneShot(['plan', 'apply', planRef, '--json'])
			: null;
		baseline.push(workflowSample(preview, apply, planRef, performance.now() - started));
	}
	resetVault();
	const candidate = [];
	const session = startSession();
	try {
		for (let index = 0; index < STAGE5_PROFILE.skillWorkflow; index += 1) {
			const description = `Stage 5 session skill workflow ${index}`;
			const started = performance.now();
			const previewResponse = await session.request({
				id: `skill-preview-${index}-${randomUUID()}`,
				argv: [
					'task', 'create', '--vault', CLI_SPEED_STAGE1_VAULT,
					'--input-format', 'compact', '--input', '-', '--json',
				],
				input: `"${description}"\n`,
			});
			const preview = previewResponse.response?.result;
			const planRef = preview?.client?.planRef;
			const applyResponse = typeof planRef === 'string'
				? await session.request({
					id: `skill-apply-${index}-${randomUUID()}`,
					argv: ['plan', 'apply', planRef, '--json'],
				})
				: null;
			candidate.push(workflowSample(
				preview,
				applyResponse?.response?.result,
				planRef,
				performance.now() - started,
			));
		}
		await session.close();
	} catch (error) {
		await session.terminate();
		throw error;
	}
	const baselineSummary = summarizeWorkflows(baseline);
	const candidateSummary = summarizeWorkflows(candidate);
	return {
		baseline: baselineSummary,
		candidate: candidateSummary,
		samePlanRef: candidate.filter(value => value.samePlanRef).length,
		speedupP50: baselineSummary.outerWallMs.p50 / candidateSummary.outerWallMs.p50,
		rawSamples: { baseline, candidate },
	};
}

function startSession() {
	const child = spawn(process.execPath, [cli, 'session', '--jsonl'], {
		cwd: pluginRoot,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, OPERON_CONFIG_HOME: configRoot },
	});
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', chunk => {
		stderr += chunk;
	});
	const pending = new Map();
	let stdout = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', chunk => {
		stdout += chunk;
		while (stdout.includes('\n')) {
			const newline = stdout.indexOf('\n');
			const line = stdout.slice(0, newline).trim();
			stdout = stdout.slice(newline + 1);
			if (!line) continue;
			let response;
			try {
				response = JSON.parse(line);
			} catch (error) {
				rejectAll(error);
				continue;
			}
			const entry = pending.get(response.id);
			if (!entry) continue;
			pending.delete(response.id);
			clearTimeout(entry.timeout);
			const outerMs = performance.now() - entry.started;
			const serviceMs = envelopeServiceMs(response);
			entry.resolve({
				response,
				outerMs,
				serviceMs,
				queueWaitMs: Number.isFinite(serviceMs) ? Math.max(0, outerMs - serviceMs) : null,
			});
		}
	});
	const exited = new Promise(resolve => {
		child.once('exit', (code, signal) => {
			if (code !== 0) rejectAll(new Error(
				`JSONL session exited ${String(code)}${signal ? ` (${signal})` : ''}: ${stderr}`,
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
		async request(frame) {
			const started = performance.now();
			const promise = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					pending.delete(frame.id);
					reject(new Error(`JSONL request timed out: ${frame.id}`));
				}, timeoutMs);
				pending.set(frame.id, { resolve, reject, timeout, started });
			});
			await writeLine(child, `${JSON.stringify(frame)}\n`);
			return promise;
		},
		async close() {
			child.stdin.end();
			const exit = await withTimeout(exited, timeoutMs);
			assert.equal(exit.code, 0, stderr);
		},
		async terminate() {
			if (child.exitCode === null) child.kill('SIGTERM');
			await withTimeout(exited, 5_000).catch(() => {
				if (child.exitCode === null) child.kill('SIGKILL');
			});
		},
	};
}

function readFrame(label, index) {
	return {
		id: `${label}-${randomUUID()}`,
		argv: [
			'task', 'get', '--vault', CLI_SPEED_STAGE1_VAULT,
			'--json', '--input', '-',
		],
		input: `${JSON.stringify({
			contractVersion: 1,
			requestId: `stage5-${label}-${randomUUID()}`,
			kind: 'task-get',
			selector: { kind: 'operon-id', operonId: index % 2 === 0 ? 'inln001' : 'file001' },
			consistency: 'live-verified',
		})}\n`,
	};
}

function runOneShot(argv, input = '') {
	const result = spawnSync(process.execPath, [cli, ...argv], {
		cwd: pluginRoot,
		encoding: 'utf8',
		input,
		env: { ...process.env, OPERON_CONFIG_HOME: configRoot },
		maxBuffer: 8 * 1024 * 1024,
	});
	if (!result.stdout.trim()) return null;
	return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

function workflowSample(preview, apply, planRef, outerWallMs) {
	const applyPlanRef = apply?.client?.planRef ?? null;
	const verified = apply?.ok === true
		&& ['applied', 'already-applied'].includes(apply?.result?.status)
		&& apply?.result?.postflight?.status === 'verified';
	return {
		ok: preview?.ok === true && verified && applyPlanRef === planRef,
		outerWallMs,
		planRef,
		applyPlanRef,
		samePlanRef: typeof planRef === 'string' && applyPlanRef === planRef,
		verified,
	};
}

function summarizeWorkflows(values) {
	return {
		...successCounts(values, value => value.ok),
		outerWallMs: summarize(values.filter(value => value.ok).map(value => value.outerWallMs)),
	};
}

function summarizeSessionSamples(values, wallMs) {
	const successful = values.filter(value => readResponseOk(value.response));
	return {
		attempts: values.length,
		successes: successful.length,
		wallMs,
		requestsPerSecond: wallMs > 0 ? values.length * 1000 / wallMs : null,
		outerWallMs: summarize(successful.map(value => value.outerMs)),
		queueWaitMs: summarize(successful.map(value => value.queueWaitMs)),
		serviceMs: summarize(successful.map(value => value.serviceMs)),
	};
}

function sessionAudit(value) {
	return {
		id: value.response?.id ?? null,
		ok: readResponseOk(value.response),
		outerMs: value.outerMs,
		queueWaitMs: value.queueWaitMs,
		serviceMs: value.serviceMs,
	};
}

function envelopeServiceMs(response) {
	const timing = response?.result?.timing;
	return Number.isFinite(timing?.totalMs) ? timing.totalMs : null;
}

function readResponseOk(response) {
	const envelope = response?.result;
	return response?.exitCode === 0
		&& !response?.error
		&& envelope?.ok === true
		&& envelope?.vaultIdentity?.expectedMatch === true;
}

function successCounts(values, predicate) {
	return { attempts: values.length, successes: values.filter(predicate).length };
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
	throw new Error('Runtime did not become ready/settled after Stage 5 fixture reset.');
}

async function writeLine(child, line) {
	if (child.stdin.write(line)) return;
	await new Promise((resolve, reject) => {
		child.stdin.once('drain', resolve);
		child.stdin.once('error', reject);
	});
}

async function withTimeout(promise, milliseconds) {
	let timeout;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Operation timed out.')), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

function processRssBytes(pid) {
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	assert.equal(result.status, 0);
	return Number(result.stdout.trim()) * 1024;
}

function processFdCount(pid) {
	const result = spawnSync('lsof', ['-a', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
	assert.equal(result.status, 0);
	return result.stdout.split('\n').filter(line => line.startsWith('n')).length;
}
