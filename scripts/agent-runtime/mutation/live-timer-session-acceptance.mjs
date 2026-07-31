#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const vaultPath = realpathSync('/private/tmp/cli-test-vault');
assert.equal(vaultPath, '/private/tmp/cli-test-vault');
assert.equal(lstatSync(vaultPath).isSymbolicLink(), false);
const phase = process.argv[2] ?? 'happy';
assert.ok(['happy', 'prepare', 'recover'].includes(phase));
assert.equal(process.argv.length, 3);

const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const fixedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const configRoot = phase === 'happy'
	? path.join(fixedTempRoot, 'operon-a12-timer-happy-cli')
	: path.join(fixedTempRoot, 'operon-a12-timer-recovery-cli');
const statePath = path.join(fixedTempRoot, 'operon-a12-timer-recovery-state.json');
const requestRoot = path.join(
	realpathSync(tmpdir()),
	`operon-agent-runtime-uid-${typeof process.getuid === 'function' ? process.getuid() : 'unavailable'}`,
);

if (phase === 'happy') {
	rmSync(configRoot, { recursive: true, force: true });
	mkdirSync(configRoot, { recursive: true, mode: 0o700 });
	assertRuntimeReady();
	assertTaskSessions([]);
	assertApplied(runDirect([
		'timer', 'session', 'add', '--id', 'tmrch01',
		'--start', '2026-07-27T10:00', '--end', '2026-07-27T11:00',
	]));
	assertTaskSessions(['2026-07-27T10:00:00/2026-07-27T11:00:00']);
	assertApplied(runDirect([
		'timer', 'session', 'update', '--id', 'tmrch01', '--session', '1',
		'--start', '2026-07-27T09:30', '--end', '2026-07-27T10:45',
	]));
	assertTaskSessions(['2026-07-27T09:30:00/2026-07-27T10:45:00']);
	assertApplied(runDirect([
		'timer', 'session', 'add', '--id', 'tmrch01',
		'--start', '2026-07-27T09:30', '--end', '2026-07-27T10:45',
	]));
	assertTaskSessions([
		'2026-07-27T09:30:00/2026-07-27T10:45:00',
		'2026-07-27T09:30:00/2026-07-27T10:45:00',
	]);
	const removal = runDirect([
		'timer', 'session', 'remove', '--id', 'tmrch01', '--session', '2',
	]);
	const planRef = removal.envelope.client?.planRef;
	const plan = removal.envelope.result?.plan;
	assert.match(planRef, /^[A-Za-z0-9_-]{32}$/u);
	assert.equal(plan?.riskLevel, 'destructive');
	assert.equal(plan?.requiresConfirmation, true);
	assert.equal(plan?.spec?.selectedRawIndex, 1);
	const storedPlan = runCli(['plan', 'show', planRef]).envelope.result?.plan;
	const removed = runCli([
		'plan', 'apply', planRef, '--confirm', storedPlan.confirmationToken,
	]);
	assertApplied(removed);
	assertTaskSessions(['2026-07-27T09:30:00/2026-07-27T10:45:00']);
	const finalRemoval = runDirect([
		'timer', 'session', 'remove', '--id', 'tmrch01', '--session', '1',
	]);
	const finalPlanRef = finalRemoval.envelope.client?.planRef;
	assert.match(finalPlanRef, /^[A-Za-z0-9_-]{32}$/u);
	const finalStoredPlan = runCli(['plan', 'show', finalPlanRef]).envelope.result?.plan;
	assertApplied(runCli([
		'plan', 'apply', finalPlanRef, '--confirm', finalStoredPlan.confirmationToken,
	]));
	assertTaskSessions([]);
	const cleared = readTask('tmrch01');
	assert.doesNotMatch(cleared.sourceMarkdown, /\{\{(?:trackers|duration)::/u);
	assert.doesNotMatch(readTask('tmrpar1').sourceMarkdown, /totalDuration:\s*[1-9]/u);
	assertApplied(runDirect([
		'timer', 'session', 'add', '--id', 'tmrch01',
		'--start', '2026-07-27T10:00', '--end', '2026-07-27T11:00',
	]));
	assertApplied(runDirect([
		'timer', 'session', 'update', '--id', 'tmrch01', '--session', '1',
		'--start', '2026-07-27T23:30', '--end', '2026-07-28T00:30',
	]));
	const midnight = readTask('tmrch01');
	assert.deepEqual(midnight.trackerHistory, [
		'2026-07-27T23:30:00/2026-07-28T00:00:00',
		'2026-07-28T00:00:00/2026-07-28T00:30:00',
	]);
	assert.equal(midnight.tracker.sessionCount, 2);
	assert.match(midnight.sourceMarkdown, /\{\{duration:: 3600\}\}/u);
	assert.match(readTask('tmrpar1').sourceMarkdown, /totalDuration:\s*3600/u);
	assertRuntimeReady();
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		vaultPath,
		add: 'applied',
		update: 'applied',
		duplicateRange: 'verified',
		remove: 'confirmed-applied',
		lastItemClear: 'verified',
		midnight: 'verified',
		parentAggregate: 'verified',
	}, null, 2)}\n`);
	process.exit(0);
}

if (phase === 'prepare') {
	rmSync(configRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	mkdirSync(configRoot, { recursive: true, mode: 0o700 });
	assertRuntimeReady();
	const task = readTask('tmrch01');
	const preview = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `a12-timer-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'a12-live-timer-session-acceptance',
		idempotencyKey: 'a12-probe-timer-session-interrupt-v1',
		capability: 'timers.session.preview',
		mutationKind: 'timer.session',
		target: { operonId: task.identity.operonId, locator: task.locator },
		spec: {
			operation: 'add-session',
			start: '2026-07-27T12:00:00',
			end: '2026-07-27T13:00:00',
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'A12 probe timer-session interruption acceptance.',
		},
	});
	const planRef = preview.envelope.client?.planRef;
	assert.match(planRef, /^[A-Za-z0-9_-]{32}$/u);
	assert.equal(preview.envelope.result?.plan?.atomicGroups?.[0]?.resources.length > 1, true);
	const interrupted = runCli(
		['plan', 'apply', planRef, '--timeout-ms', '30000'],
		undefined,
		true,
	);
	assert.notEqual(interrupted.exitCode, 0);
	assert.equal(interrupted.envelope.result?.status, 'outcome-unknown');
	assert.equal(interrupted.envelope.result?.retryAllowed, false);
	writeFileSync(statePath, `${JSON.stringify({ vaultPath, planRef })}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify({
		status: 'interrupted',
		planRef,
		recoveryOnly: true,
	}, null, 2)}\n`);
	process.exit(0);
}

assertRuntimeReady();
const state = JSON.parse(readFileSync(statePath, 'utf8'));
assert.equal(state.vaultPath, vaultPath);
const recovered = runCli(['plan', 'recover', state.planRef, '--timeout-ms', '30000']);
assert.ok(['applied', 'already-applied'].includes(recovered.envelope.result?.status));
assertTaskSessions(['2026-07-27T12:00:00/2026-07-27T13:00:00']);
assert.match(readTask('tmrpar1').sourceMarkdown, /totalDuration:\s*3600/u);
assert.equal(
	existsSync(path.join(configRoot, 'plans', `${state.planRef}.json`)),
	true,
	'Terminal timer-session recovery must retain its replay tombstone.',
);
rmSync(configRoot, { recursive: true, force: true });
rmSync(statePath, { force: true });
process.stdout.write(`${JSON.stringify({
	status: 'ok',
	recovery: recovered.envelope.result.status,
	samePlan: true,
	parentAggregate: 'verified',
}, null, 2)}\n`);

function runDirect(args) {
	return runCli(args);
}

function assertApplied(result) {
	assert.ok(['applied', 'already-applied'].includes(result.envelope.result?.status));
	assert.equal(result.envelope.result?.postflight?.status, 'verified');
}

function assertTaskSessions(expected) {
	const task = readTask('tmrch01');
	assert.deepEqual(task.trackerHistory, expected);
	assert.equal(task.tracker.sessionCount, expected.length);
}

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a12-timer-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['source-markdown', 'tracker-history'],
	});
	assert.equal(result.envelope.result?.ok, true);
	assert.deepEqual(result.envelope.result?.truncations, []);
	return result.envelope.result.task;
}

function assertRuntimeReady() {
	assertRequestRootClean();
	const diagnostics = runCli(['diagnostics']);
	assert.equal(diagnostics.envelope.ok, true);
	assert.equal(diagnostics.envelope.vaultIdentity?.expectedMatch, true);
	assert.equal(diagnostics.envelope.result?.health?.lifecyclePhase, 'ready');
	assert.equal(diagnostics.envelope.result?.health?.v8PersistencePhase, 'idle');
	assertRequestRootClean();
}

function assertRequestRootClean() {
	if (!existsSync(requestRoot)) return;
	const stat = lstatSync(requestRoot);
	assert.equal(stat.isDirectory(), true);
	assert.equal(stat.isSymbolicLink(), false);
	assert.equal(stat.uid, typeof process.getuid === 'function' ? process.getuid() : -1);
	assert.equal(stat.mode & 0o777, 0o700);
	assert.equal(readdirSync(requestRoot).length, 0);
}

function runCli(command, input, allowFailure = false) {
	const local = command[0] === 'plan';
	if (!local) assertRequestRootClean();
	const result = spawnSync(process.execPath, [
		cliArtifact,
		...command,
		...(local ? [] : ['--vault', vaultPath]),
		...(input === undefined ? [] : ['--input', '-']),
		'--json',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: { ...process.env, OPERON_CONFIG_HOME: configRoot },
		...(input === undefined ? {} : { input: `${JSON.stringify(input)}\n` }),
		maxBuffer: 4 * 1_024 * 1_024,
	});
	if (!allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /\S/u, result.stderr);
	if (!local) assertRequestRootClean();
	return { exitCode: result.status, envelope: JSON.parse(result.stdout) };
}
