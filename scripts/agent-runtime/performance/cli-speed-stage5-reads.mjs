#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
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
const configRoot = mkdtempSync('/private/tmp/operon-cli-speed-stage5-reads-');
const tracePath = path.join(configRoot, 'runtime-dispatches.jsonl');
const subspanPath = path.join(configRoot, 'cli-subspans.jsonl');
const samples = sampleCount('OPERON_CLI_SPEED_STAGE5_READ_SAMPLES', STAGE5_PROFILE.reads);

assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });

let evidence;
try {
	const setup = run(
		['setup', '--vault', CLI_SPEED_STAGE1_VAULT, '--name', 'stage5', '--default', '--json'],
		'',
		{},
		false,
	);
	assert.equal(setup.envelope?.ok, true, 'Stage 5 profile setup failed.');
	const explicitVault = collectRoute('explicit-vault', ['--vault', CLI_SPEED_STAGE1_VAULT]);
	const profile = collectRoute('profile', ['--profile', 'stage5']);
	evidence = {
		status: 'collected',
		explicitVault: summarizeRoute(explicitVault),
		profile: summarizeRoute(profile),
		rawSamples: { explicitVault, profile },
	};
} catch (error) {
	evidence = {
		status: 'blocked',
		reason: /transport-unavailable/iu.test(String(error))
			? 'transport-unavailable'
			: 'collection-failed',
		message: error instanceof Error ? error.message : String(error),
	};
} finally {
	rmSync(configRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(evidence)}\n`);
if (evidence.status !== 'collected') process.exitCode = 1;

function collectRoute(route, targetArgs) {
	for (let index = 0; index < 2; index += 1) {
		const warmup = readTask(`${route}-warmup-${index}`, targetArgs);
		assert.equal(warmup.ok, true);
	}
	return Array.from(
		{ length: samples },
		(_, index) => readTask(`${route}-${index}`, targetArgs),
	);
}

function sampleCount(name, fallback) {
	if (process.env[name] === undefined) return fallback;
	const value = Number(process.env[name]);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive.`);
	return value;
}

function readTask(sample, targetArgs) {
	const traceBefore = readTrace().length;
	const runtimeTraceBefore = readRuntimeTrace().length;
	const result = run(
		['task', 'get', ...targetArgs, '--json', '--input', '-'],
		`${JSON.stringify({
			contractVersion: 1,
			requestId: `stage5-read-${randomUUID()}`,
			kind: 'task-get',
			selector: { kind: 'operon-id', operonId: 'inln001' },
			consistency: 'live-verified',
		})}\n`,
		{
			OPERON_CLI_BENCHMARK_SCENARIO: `stage5-${sample.split('-').slice(0, -1).join('-')}`,
			OPERON_CLI_BENCHMARK_PHASE: 'read',
			OPERON_CLI_BENCHMARK_SAMPLE: sample,
			OPERON_CLI_BENCHMARK_DISPATCH: '0',
		},
	);
	const traces = readTrace().slice(traceBefore);
	const runtimeTraces = readRuntimeTrace().slice(runtimeTraceBefore);
	const service = traces.find(value => value.span === 'obsidian-spawn-to-close')?.durationMs
		?? runtimeTraces.at(-1)?.outerWallMs;
	const envelope = result.envelope;
	const ok = result.status === 0
		&& envelope?.ok === true
		&& envelope?.vaultIdentity?.expectedMatch === true
		&& envelope?.result?.task?.identity?.operonId === 'inln001'
		&& Number.isFinite(service);
	return {
		ok,
		outerWallMs: result.outerWallMs,
		cliTotalMs: envelope?.timing?.totalMs ?? null,
		serviceMs: service ?? null,
		handlerMs: envelope?.timing?.handlerMs ?? null,
		traceLinked: traces.length > 0 && traces.every(value => (
			typeof value.sample === 'string'
			&& value.phase === 'read'
			&& value.dispatch === '0'
		)),
	};
}

function run(args, input = '', extraEnvironment = {}, benchmarkTrace = true) {
	const started = performance.now();
	const result = spawnSync(process.execPath, [cli, ...args], {
		cwd: pluginRoot,
		encoding: 'utf8',
		input,
		env: {
			...process.env,
			...extraEnvironment,
			OPERON_CONFIG_HOME: configRoot,
			...(benchmarkTrace ? { OPERON_CLI_BENCHMARK_TRACE_PATH: tracePath } : {}),
			...(benchmarkTrace ? { OPERON_CLI_BENCHMARK_SUBSPANS: '1' } : {}),
		},
		maxBuffer: 8 * 1024 * 1024,
	});
	const outerWallMs = performance.now() - started;
	let envelope = null;
	if (result.stdout.trim()) {
		envelope = JSON.parse(result.stdout.trim().split('\n').at(-1));
	}
	return { status: result.status, envelope, outerWallMs };
}

function summarizeRoute(values) {
	const successful = values.filter(value => value.ok);
	return {
		attempts: values.length,
		successes: successful.length,
		traceLinked: successful.filter(value => value.traceLinked).length,
		outerWallMs: summarize(successful.map(value => value.outerWallMs)),
		cliTotalMs: summarize(successful.map(value => value.cliTotalMs)),
		serviceMs: summarize(successful.map(value => value.serviceMs)),
		handlerMs: summarize(successful.map(value => value.handlerMs)),
	};
}

function readTrace() {
	try {
		return readFileSync(subspanPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
	} catch {
		return [];
	}
}

function readRuntimeTrace() {
	try {
		return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
	} catch {
		return [];
	}
}
