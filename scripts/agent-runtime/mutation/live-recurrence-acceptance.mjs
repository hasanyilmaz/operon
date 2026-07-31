#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
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

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const fixedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const requiredVaultPath = path.join(fixedTempRoot, 'cli-test-vault');
const phase = process.argv[2] ?? 'run';
assert.ok(
	['run', 'happy', 'prepare', 'recover'].includes(phase),
	'Expected run, happy, prepare or recover phase.',
);
assert.equal(process.argv.length <= 3, true, 'Recurrence acceptance does not accept a vault override.');
const vaultPath = phase === 'run' ? requiredVaultPath : realpathSync(requiredVaultPath);
const vaultStat = phase === 'run' ? null : lstatSync(vaultPath);
assert.equal(vaultStat === null || vaultStat.isDirectory(), true, 'Recurrence acceptance target must be a directory.');
assert.equal(
	vaultStat !== null && vaultStat.isSymbolicLink(),
	false,
	'Recurrence acceptance target cannot be a symlink.',
);
assert.equal(
	vaultPath,
	'/private/tmp/cli-test-vault',
	'Recurrence acceptance is restricted to /private/tmp/cli-test-vault.',
);

const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const runtimeTempRoot = realpathSync(tmpdir());
const requestRoot = path.join(
	runtimeTempRoot,
	`operon-agent-runtime-uid-${typeof process.getuid === 'function' ? process.getuid() : 'unavailable'}`,
);

if (phase === 'run') {
	const productionAcceptance = Boolean(process.env.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT);
	resetSanitizedVault(productionAcceptance);
	waitForReadyRuntime();
	const happy = runHappyPhase();
	if (productionAcceptance) {
		resetSanitizedVault(false);
		waitForReadyRuntime();
	}
	const prepared = runPhase('prepare');
	const reload = reloadRuntime();
	waitForReadyRuntime();
	wait(30_500);
	const recovered = runPhase('recover');
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		vaultPath,
		happy,
		prepared,
		reload,
		recovered,
		recoveryVerified: true,
	}, null, 2)}\n`);
	process.exit(0);
}

const durableConfigRoot = path.join(fixedTempRoot, 'operon-a12-recurrence-recovery-cli');
const recoveryStatePath = path.join(
	fixedTempRoot,
	'operon-a12-recurrence-recovery-state.json',
);
const cliConfigRoot = phase === 'happy'
	? mkdtempSync(path.join(tmpdir(), 'operon-a12-recurrence-cli-'))
	: durableConfigRoot;
const sourcePath = path.join(vaultPath, 'Daily/2026-01-15.md');
const settingsPath = path.join(vaultPath, '.obsidian/plugins/operon/data.json');
const repeatSeriesPath = path.join(
	vaultPath,
	'.obsidian/plugins/operon/state/repeat-series.json',
);
process.on('exit', () => {
	if (phase === 'happy') rmSync(cliConfigRoot, { recursive: true, force: true });
});

if (phase === 'prepare') {
	prepareInterruptedRecovery();
	process.exit(0);
}
if (phase === 'recover') {
	recoverInterruptedPlan();
	process.exit(0);
}

assertRuntimeReady();
const initial = readTask('inln001', 'initial');
assert.equal(initial.recurrence.repeating, false, 'Start fixture must be non-recurring.');
assert.equal(initial.dates.scheduled, undefined, 'Start fixture must not already have an anchor.');
const initialSettingsDigest = digestFile(settingsPath);

const started = mutate('start', initial, {
	operation: 'update-recurrence',
	scope: 'this-and-following',
	changes: [{
		field: 'repeat',
		valueType: 'text',
		value: 'mode=schedule|freq=day|interval=1',
	}, {
		field: 'dateScheduled',
		valueType: 'date',
		value: '2099-01-01',
	}],
}, { repeatSeriesEffect: 'write' });
let task = readTask('inln001', 'started');
assert.equal(task.recurrence.repeating, true);
assert.equal(task.dates.scheduled, '2099-01-01');
assert.match(task.recurrence.seriesId, /^rs[a-z0-9]{5}$/u);
assert.match(task.sourceMarkdown, /mode=schedule\|freq=day\|interval=1/u);
const seriesId = task.recurrence.seriesId;

const thisTask = mutate('this-task', task, {
	operation: 'update-recurrence',
	scope: 'this-task',
	changes: [{
		field: 'dateDue',
		valueType: 'date',
		value: '2099-01-02',
	}],
}, { repeatSeriesEffect: 'none' });
task = readTask('inln001', 'this-task');
assert.equal(task.dates.due, '2099-01-02');
assert.equal(task.recurrence.seriesId, seriesId);

const following = mutate('this-and-following', task, {
	operation: 'update-recurrence',
	scope: 'this-and-following',
	changes: [{
		field: 'dateScheduled',
		valueType: 'date',
		value: '2099-01-03',
	}],
}, { repeatSeriesEffect: 'write' });
task = readTask('inln001', 'this-and-following');
assert.equal(task.dates.scheduled, '2099-01-03');
assert.equal(task.recurrence.occurrenceDate, '2099-01-03');
assert.equal(task.recurrence.seriesId, seriesId);
const seriesAfterFollowing = readRepeatSeries(seriesId);
assert.equal(
	seriesAfterFollowing.overrides.following.some(override => (
		override.effectiveFrom === '2099-01-03'
	)),
	true,
	'This-and-following must persist an override at the reanchored occurrence.',
);

const cleared = mutate('clear', task, {
	operation: 'update-recurrence',
	scope: 'this-and-following',
	changes: [{
		operation: 'clear',
		field: 'repeat',
		valueType: 'text',
	}],
}, { repeatSeriesEffect: 'write' });
task = readTask('inln001', 'cleared');
assert.equal(task.recurrence.repeating, false);
assert.equal(task.recurrence.seriesId, undefined);
assert.doesNotMatch(task.sourceMarkdown, /\{\{repeat::/u);
assert.doesNotMatch(task.sourceMarkdown, /\{\{repeatSeriesId::/u);
assert.equal(readRepeatSeries(seriesId, false), null);
assert.equal(digestFile(settingsPath), initialSettingsDigest, 'Acceptance must not change settings.');
assertRuntimeReady();

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vaultPath,
	vaultIdentityMatched: true,
	runtimeReady: true,
	persistenceIdle: true,
	requestRootClean: true,
	start: started.status,
	thisTask: thisTask.status,
	thisAndFollowing: following.status,
	clear: cleared.status,
	recoveryVerified: false,
	settingsUnchanged: true,
}, null, 2)}\n`);

function mutate(name, currentTask, spec, options) {
	assertRuntimeReady();
	const beforePreview = {
		source: digestFile(sourcePath),
		settings: digestFile(settingsPath),
		repeatSeries: digestFileOrAbsent(repeatSeriesPath),
	};
	const preview = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `a12-${name}-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'a12-live-recurrence-acceptance',
		idempotencyKey: `a12-${name}-${randomUUID()}`,
		capability: 'tasks.recurrence.preview',
		mutationKind: 'task.recurrence',
		target: exactTarget(currentTask),
		spec,
		authorization: {
			basis: 'user-explicit-request',
			reason: `A12 sanitized recurrence ${name} acceptance.`,
		},
	});
	assert.equal(preview.envelope.ok, true, `${name} preview transport must succeed.`);
	assert.equal(preview.envelope.result?.ok, true, `${name} must return a sealed plan.`);
	assert.deepEqual(
		{
			source: digestFile(sourcePath),
			settings: digestFile(settingsPath),
			repeatSeries: digestFileOrAbsent(repeatSeriesPath),
		},
		beforePreview,
		`${name} preview must be read-only.`,
	);
	const planRef = preview.envelope.client?.planRef;
	assert.match(planRef, /^[A-Za-z0-9_-]{32}$/u);
	const plan = preview.envelope.result?.plan;
	const shown = runCli(['plan', 'show', planRef]);
	const shownPlan = shown.envelope.result?.plan;
	assert.equal(plan?.mutationKind, 'task.recurrence');
	assert.equal(plan?.spec?.scope, spec.scope);
	assert.equal(shownPlan?.mutationKind, plan?.mutationKind);
	assert.deepEqual(shownPlan?.targets, plan?.targets);
	assert.deepEqual(shownPlan?.atomicGroups, plan?.atomicGroups);
	assert.equal(plan?.riskLevel, 'routine');
	assert.equal(plan?.requiresConfirmation, false);
	assert.deepEqual(plan?.warnings, []);
	assert.deepEqual(plan?.targets?.map(target => target.operonId), ['inln001']);
	assert.deepEqual(plan?.targets?.[0]?.locator, currentTask.locator);
	assertRecurrenceAtomicity(
		plan,
		options.repeatSeriesEffect,
		currentTask.locator.filePath,
	);
	const applied = runCli(['plan', 'apply', planRef, '--timeout-ms', '30000']);
	assert.equal(applied.envelope.result?.status, 'applied', `${name} apply must commit.`);
	assert.equal(applied.envelope.result?.postflight?.status, 'verified');
	if (options.repeatSeriesEffect === 'none') {
		assert.equal(
			digestFileOrAbsent(repeatSeriesPath),
			beforePreview.repeatSeries,
			`${name} must not rewrite repeat-series state.`,
		);
	}
	return { status: applied.envelope.result.status };
}

function prepareInterruptedRecovery() {
	rmSync(durableConfigRoot, { recursive: true, force: true });
	rmSync(recoveryStatePath, { force: true });
	mkdirSync(durableConfigRoot, { recursive: true, mode: 0o700 });
	assertRuntimeReady();
	const task = readTask('recp001', 'recovery-prepare');
	assert.equal(task.recurrence.repeating, true);
	assert.equal(task.recurrence.seriesId, 'rspln01');
	assert.equal(task.recurrence.occurrenceDate, '2026-01-15');
	const preview = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `a12-recovery-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'a12-live-recurrence-acceptance',
		idempotencyKey: 'a12-probe-recurrence-interrupt-v1',
		capability: 'tasks.recurrence.preview',
		mutationKind: 'task.recurrence',
		target: exactTarget(task),
		spec: {
			operation: 'update-recurrence',
			scope: 'this-and-following',
			changes: [{
				operation: 'clear',
				field: 'repeat',
				valueType: 'text',
			}],
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'A12 probe-build recurrence interruption acceptance.',
		},
	});
	const plan = preview.envelope.result?.plan;
	assert.equal(plan?.mutationKind, 'task.recurrence');
	assert.equal(plan?.riskLevel, 'routine');
	assert.equal(plan?.requiresConfirmation, false);
	assert.deepEqual(plan?.warnings, []);
	assert.deepEqual(plan?.targets?.[0]?.locator, task.locator);
	assertRecurrenceAtomicity(plan, 'write', task.locator.filePath);
	const planRef = preview.envelope.client?.planRef;
	assert.match(planRef, /^[A-Za-z0-9_-]{32}$/u);
	const interrupted = runCli(
		['plan', 'apply', planRef, '--timeout-ms', '30000'],
		undefined,
		true,
	);
	assert.notEqual(
		interrupted.exitCode,
		0,
		'Probe recurrence apply must stop after its first journal step.',
	);
	assert.equal(interrupted.envelope.result?.status, 'outcome-unknown');
	assert.equal(interrupted.envelope.result?.mutationMayHaveApplied, true);
	assert.equal(interrupted.envelope.result?.retryAllowed, false);
	assert.equal(existsSync(path.join(durableConfigRoot, 'plans', `${planRef}.json`)), true);
	const state = {
		contractVersion: 1,
		vaultPath,
		planRef,
		operonId: task.identity.operonId,
		seriesId: task.recurrence.seriesId,
	};
	writeFileSync(recoveryStatePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	chmodSync(recoveryStatePath, 0o600);
	process.stdout.write(`${JSON.stringify({
		status: 'interrupted',
		planRef,
		planFenced: true,
		recoveryOnly: true,
	}, null, 2)}\n`);
}

function recoverInterruptedPlan() {
	assertRuntimeReady();
	const state = JSON.parse(readFileSync(recoveryStatePath, 'utf8'));
	assert.equal(state.contractVersion, 1);
	assert.equal(state.vaultPath, vaultPath);
	assert.equal(state.operonId, 'recp001');
	assert.equal(state.seriesId, 'rspln01');
	const recovered = runCli([
		'plan',
		'recover',
		state.planRef,
		'--timeout-ms',
		'30000',
	]);
	assert.ok(['applied', 'already-applied'].includes(recovered.envelope.result?.status));
	assert.equal(recovered.envelope.result?.mutationMayHaveApplied, true);
	const task = readTask(state.operonId, 'recovery-complete');
	assert.equal(task.recurrence.repeating, false);
	assert.equal(task.recurrence.seriesId, undefined);
	assert.match(
		task.sourceMarkdown,
		/(?:^|\n)repeat:\s*(?:\n|$)/u,
		'File Task recurrence clear must preserve the canonical blank frontmatter field.',
	);
	assert.equal(readRepeatSeries(state.seriesId, false), null);
	const terminalState = {
		source: digestFile(sourcePath),
		repeatSeries: digestFileOrAbsent(repeatSeriesPath),
	};
	const replayed = runCli([
		'plan',
		'recover',
		state.planRef,
		'--timeout-ms',
		'30000',
	]);
	assert.equal(replayed.envelope.result?.status, 'already-applied');
	assert.equal(replayed.envelope.result?.postflight?.status, 'receipt-replay');
	assert.deepEqual(
		{
			source: digestFile(sourcePath),
			repeatSeries: digestFileOrAbsent(repeatSeriesPath),
		},
		terminalState,
		'Terminal recurrence recovery replay must not write source or repeat-series state.',
	);
	const terminalPlanPath = path.join(durableConfigRoot, 'plans', `${state.planRef}.json`);
	assert.equal(
		existsSync(terminalPlanPath),
		true,
		'Terminal recurrence recovery must retain the exact 24-hour tombstone.',
	);
	const terminalPlan = JSON.parse(readFileSync(terminalPlanPath, 'utf8'));
	assert.equal(terminalPlan.terminalResult?.status, 'already-applied');
	assert.equal(terminalPlan.terminalResult?.postflight?.status, 'receipt-replay');
	assert.equal(terminalPlan.terminalResult?.receipt?.planHash, terminalPlan.plan?.planHash);
	assert.ok(Date.parse(terminalPlan.recoveryExpiresAt) > Date.now());
	rmSync(durableConfigRoot, { recursive: true, force: true });
	rmSync(recoveryStatePath, { force: true });
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		recovery: recovered.envelope.result.status,
		replay: replayed.envelope.result.status,
		samePlan: true,
		sourceAndSeriesVerified: true,
	}, null, 2)}\n`);
}

function assertRecurrenceAtomicity(plan, repeatSeriesEffect, sourceKey) {
	const affectedResources = plan?.affectedResources ?? [];
	const sourceResources = affectedResources.filter(resource => (
		resource.resourceKind === 'task-source'
		&& resource.resourceKey === sourceKey
	));
	assert.equal(sourceResources.length, 1, 'Recurrence plan must affect the exact task source once.');
	const seriesResources = affectedResources.filter(resource => (
		resource.resourceKind === 'repeat-series'
	));
	if (repeatSeriesEffect === 'none') {
		assert.equal(
			seriesResources.length,
			0,
			'This-task recurrence must not seal a repeat-series write.',
		);
		return;
	}
	assert.equal(seriesResources.length, 1, 'Recurrence series mutation must affect one exact series.');
	const seriesResource = seriesResources[0];
	assert.equal(
		(plan?.atomicGroups ?? []).some(group => (
			group.resources.some(resource => (
				resource.resourceKind === 'task-source'
				&& resource.resourceKey === sourceKey
			))
			&& group.resources.some(resource => (
				resource.resourceKind === 'repeat-series'
				&& resource.resourceKey === seriesResource.resourceKey
			))
		)),
		true,
		'Task source and repeat-series state must be sealed in the same atomic group.',
	);
}

function resetSanitizedVault(useProductionArtifact = false) {
	spawnSync('obsidian', [
		'vault=cli-test-vault',
		'plugin:disable',
		'id=operon',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
	const resetEnvironment = { ...process.env };
	if (!useProductionArtifact) delete resetEnvironment.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT;
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		...(useProductionArtifact ? ['--production'] : []),
		requiredVaultPath,
	], { env: resetEnvironment });
	runRequired('obsidian', ['vault=cli-test-vault', 'reload']);
	const enable = spawnSync('obsidian', [
		'vault=cli-test-vault',
		'plugin:enable',
		'id=operon',
		'filter=community',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
		timeout: 10_000,
	});
	assert.equal(
		enable.status === 0 || enable.error?.code === 'ETIMEDOUT',
		true,
		enable.stderr || enable.stdout || enable.error?.message || 'Operon probe enable failed.',
	);
}

function waitForReadyRuntime() {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			assertRequestRootClean();
			const result = spawnSync(process.execPath, [
				cliArtifact,
				'diagnostics',
				'--vault',
				requiredVaultPath,
				'--json',
			], {
				cwd: pluginRoot,
				encoding: 'utf8',
				maxBuffer: 4 * 1_024 * 1_024,
			});
			if (result.status === 0 && result.stdout.trim()) {
				const envelope = JSON.parse(result.stdout);
				if (
					envelope.ok === true
					&& envelope.vaultIdentity?.expectedMatch === true
					&& envelope.result?.health?.lifecyclePhase === 'ready'
					&& envelope.result?.health?.v8PersistencePhase === 'idle'
				) {
					assertRequestRootClean();
					return;
				}
				if (envelope.error?.retryable === false) break;
			}
		} catch {
			// Reload can briefly make the exact Runtime or request root unavailable.
		}
		wait(250);
	}
	throw new Error('Sanitized recurrence Runtime did not become ready and idle after reset.');
}

function runHappyPhase() {
	return runPhase('happy');
}

function runPhase(targetPhase) {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(import.meta.url), targetPhase],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CLI_EXECUTABLE: cliArtifact,
			},
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return JSON.parse(result.stdout);
}

function reloadRuntime() {
	const reload = spawnSync('obsidian', [
		'vault=cli-test-vault',
		'command',
		'id=app:reload',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 1 * 1_024 * 1_024,
	});
	if (reload.status === 0) return { action: 'reload' };
	const restart = spawnSync('obsidian', [
		'vault=cli-test-vault',
		'restart',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 1 * 1_024 * 1_024,
	});
	assert.equal(restart.status, 0, restart.stderr || restart.stdout || reload.stderr);
	return { action: 'restart' };
}

function runRequired(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 8 * 1_024 * 1_024,
		...options,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout || `${command} failed.`);
}

function wait(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertRuntimeReady() {
	assertRequestRootClean();
	const diagnostics = runCli(['diagnostics']);
	assert.equal(diagnostics.envelope.ok, true, 'Diagnostics transport must succeed.');
	assert.equal(
		diagnostics.envelope.vaultIdentity?.expectedMatch,
		true,
		'Runtime must match the exact requested vault identity.',
	);
	assert.equal(
		diagnostics.envelope.result?.health?.lifecyclePhase,
		'ready',
		'Runtime lifecycle must be ready.',
	);
	assert.equal(
		diagnostics.envelope.result?.health?.v8PersistencePhase,
		'idle',
		'Runtime persistence must be idle.',
	);
	assertRequestRootClean();
}

function assertRequestRootClean() {
	if (!existsSync(requestRoot)) return;
	const stat = lstatSync(requestRoot);
	assert.equal(stat.isDirectory(), true, 'Runtime request root must be a directory.');
	assert.equal(stat.isSymbolicLink(), false, 'Runtime request root cannot be a symlink.');
	assert.equal(
		stat.uid,
		typeof process.getuid === 'function' ? process.getuid() : -1,
		'Runtime request root must be owned by the current user.',
	);
	assert.equal(stat.mode & 0o777, 0o700, 'Runtime request root must be owner-only.');
	assert.equal(
		readdirSync(requestRoot).length,
		0,
		'Runtime request root must be empty before and after every live request.',
	);
}

function readTask(operonId, stage) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a12-${stage}-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['source-markdown'],
	});
	assert.equal(result.envelope.result?.ok, true, `Task ${operonId} must be live-readable.`);
	return result.envelope.result.task;
}

function exactTarget(task) {
	return {
		operonId: task.identity.operonId,
		locator: task.locator,
	};
}

function readRepeatSeries(seriesId, required = true) {
	const data = JSON.parse(readFileSync(repeatSeriesPath, 'utf8'));
	const series = data.series?.[seriesId] ?? null;
	if (required) assert.ok(series, `Repeat series ${seriesId} must exist.`);
	return series;
}

function runCli(command, input, allowFailure = false) {
	const localCommand = command[0] === 'plan';
	if (!localCommand) assertRequestRootClean();
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(localCommand ? [] : ['--vault', vaultPath]),
			...(input === undefined ? [] : ['--input', '-']),
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CONFIG_HOME: cliConfigRoot,
			},
			...(input === undefined ? {} : { input: `${JSON.stringify(input)}\n` }),
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	if (!allowFailure) {
		assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	}
	assert.match(result.stdout, /\S/u, result.stderr || 'Operon CLI returned no JSON.');
	if (!localCommand) assertRequestRootClean();
	return {
		exitCode: result.status,
		envelope: JSON.parse(result.stdout),
	};
}

function digestFile(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function digestFileOrAbsent(filePath) {
	return existsSync(filePath) ? digestFile(filePath) : 'absent';
}
