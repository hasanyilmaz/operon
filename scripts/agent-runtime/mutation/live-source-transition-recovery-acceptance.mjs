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
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const vaultPath = realpathSync('/private/tmp/cli-test-vault');
assert.equal(vaultPath, '/private/tmp/cli-test-vault');
assert.equal(lstatSync(vaultPath).isSymbolicLink(), false);
const phase = process.argv[2];
assert.ok(['prepare-pre-trash', 'prepare-post-trash', 'recover'].includes(phase));
assert.equal(process.argv.length, 3);

const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const fixedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const configRoot = path.join(fixedTempRoot, 'operon-a12-source-recovery-cli');
const statePath = path.join(fixedTempRoot, 'operon-a12-source-recovery-state.json');
const requestRoot = path.join(
	realpathSync(tmpdir()),
	`operon-agent-runtime-uid-${typeof process.getuid === 'function' ? process.getuid() : 'unavailable'}`,
);

if (phase === 'prepare-pre-trash') {
	resetCliState();
	assertRuntimeReady();
	const task = readTask('title01');
	assert.equal(task.locator.representation, 'file');
	const targetFile = 'Daily/2026-01-15.md';
	const targetContent = readFileSync(path.join(vaultPath, targetFile), 'utf8');
	const targetLine = targetContent.split('\n').findIndex(line => line.trim() === '');
	assert.ok(targetLine >= 0, 'Pre-trash recovery fixture requires an exact blank line.');
	const preview = previewMutation({
		idempotencyKey: 'a12-probe-source-pre-trash-interrupt-v1',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(task),
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: targetFile,
				lineNumber: targetLine,
			},
		},
		reason: 'A12 probe source transition interruption before trash.',
	});
	const planRef = requirePlanRef(preview);
	assert.equal(preview.result?.plan?.riskLevel, 'destructive');
	assert.equal(preview.result?.plan?.requiresConfirmation, true);
	const interrupted = applyExpectingInterruption(planRef);
	assertInterrupted(interrupted);
	assert.equal(existsSync(path.join(vaultPath, task.locator.filePath)), true);
	assert.equal(
		countActiveTaskCopies('title01'),
		2,
		'The probe must stop after the reversible destination write and before source trash.',
	);
	saveRecoveryState({
		scenario: 'pre-trash',
		planRef,
		operonId: 'title01',
		sourceFile: task.locator.filePath,
		targetFile,
		targetLine,
	});
	report({ status: 'interrupted', scenario: 'pre-trash', planRef, recoveryOnly: true });
	process.exit(0);
}

if (phase === 'prepare-post-trash') {
	resetCliState();
	assertRuntimeReady();
	const task = readTask('unrel01');
	assert.equal(task.locator.representation, 'file');
	const pinned = runCli(['task', 'pin', '--id', 'unrel01'], undefined, true);
	if (pinned.exitCode === 0) {
		assertApplied(pinned);
	} else {
		assert.equal(pinned.envelope.result?.status, 'outcome-unknown');
		assert.match(pinned.envelope.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
		assertApplied(runCli(['plan', 'recover', pinned.envelope.client.planRef, '--timeout-ms', '30000']));
	}
	assert.equal(readTask('unrel01').pinned, true);
	const preview = previewMutation({
		idempotencyKey: 'a12-probe-source-post-trash-interrupt-v1',
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: exactTarget(readTask('unrel01')),
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
		reason: 'A12 probe source transition interruption after trash.',
	});
	const planRef = requirePlanRef(preview);
	assert.equal(preview.result?.plan?.riskLevel, 'destructive');
	assert.equal(preview.result?.plan?.requiresConfirmation, true);
	const interrupted = applyExpectingInterruption(planRef);
	assertInterrupted(interrupted);
	assert.equal(existsSync(path.join(vaultPath, task.locator.filePath)), false);
	assert.equal(readPinnedState('unrel01'), true);
	saveRecoveryState({
		scenario: 'post-trash',
		planRef,
		operonId: 'unrel01',
		sourceFile: task.locator.filePath,
	});
	report({ status: 'interrupted', scenario: 'post-trash', planRef, recoveryOnly: true });
	process.exit(0);
}

assertRuntimeReady();
const state = JSON.parse(readFileSync(statePath, 'utf8'));
assert.equal(state.vaultPath, vaultPath);
assert.ok(['pre-trash', 'post-trash'].includes(state.scenario));
const recovered = runCli(['plan', 'recover', state.planRef, '--timeout-ms', '30000']);
assertApplied(recovered);
assert.equal(recovered.result?.postflight?.status, 'verified');
if (state.scenario === 'pre-trash') {
	const task = readTask(state.operonId);
	assert.equal(task.locator.representation, 'inline');
	assert.equal(task.locator.filePath, state.targetFile);
	assert.equal(task.locator.lineNumber, state.targetLine);
	assert.equal(existsSync(path.join(vaultPath, state.sourceFile)), false);
	assert.equal(countActiveTaskCopies(state.operonId), 1);
} else {
	assertTaskMissing(state.operonId);
	assert.equal(existsSync(path.join(vaultPath, state.sourceFile)), false);
	assert.equal(countActiveTaskCopies(state.operonId), 0);
	assert.equal(readPinnedState(state.operonId), false);
}
assert.equal(
	existsSync(path.join(configRoot, 'plans', `${state.planRef}.json`)),
	true,
	'Terminal source-transition recovery must retain its replay tombstone.',
);
rmSync(configRoot, { recursive: true, force: true });
rmSync(statePath, { force: true });
report({
	status: 'ok',
	scenario: state.scenario,
	recovery: recovered.result.status,
	samePlan: true,
	postflight: 'verified',
	duplicateCopies: 0,
});

function resetCliState() {
	rmSync(configRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	mkdirSync(configRoot, { recursive: true, mode: 0o700 });
}

function previewMutation({
	idempotencyKey,
	capability,
	mutationKind,
	target,
	spec,
	reason,
}) {
	return runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `a12-source-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'a12-live-source-transition-recovery',
		idempotencyKey,
		capability,
		mutationKind,
		target,
		spec,
		authorization: { basis: 'user-explicit-request', reason },
	});
}

function requirePlanRef(preview) {
	assert.equal(preview.ok, true);
	assert.equal(preview.result?.ok, true);
	assert.match(preview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
	return preview.client.planRef;
}

function applyExpectingInterruption(planRef) {
	const shown = runCli(['plan', 'show', planRef]);
	assert.match(shown.result?.plan?.confirmationToken, /^[a-f0-9]{64}$/u);
	return runCli(
		[
			'plan', 'apply', planRef,
			'--confirm', shown.result.plan.confirmationToken,
			'--timeout-ms', '30000',
		],
		undefined,
		true,
	);
}

function assertInterrupted(result) {
	assert.notEqual(result.exitCode, 0);
	assert.equal(result.envelope.result?.status, 'outcome-unknown');
	assert.equal(result.envelope.result?.mutationMayHaveApplied, true);
	assert.equal(result.envelope.result?.retryAllowed, false);
}

function saveRecoveryState(state) {
	writeFileSync(
		statePath,
		`${JSON.stringify({ vaultPath, ...state })}\n`,
		{ mode: 0o600 },
	);
}

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a12-source-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['custom-fields', 'source-markdown'],
	});
	assert.equal(result.ok, true);
	assert.equal(result.result?.ok, true);
	assert.deepEqual(result.result?.truncations, []);
	return result.result.task;
}

function assertTaskMissing(operonId) {
	const result = runCli([
		'task', 'get', '--input', '-',
	], {
		contractVersion: 1,
		requestId: `a12-source-missing-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
	}, true);
	assert.notEqual(result.exitCode, 0);
	assert.equal(result.envelope.failure?.error?.code, 'entity-not-found');
}

function exactTarget(task) {
	return { operonId: task.identity.operonId, locator: task.locator };
}

function assertApplied(result) {
	const envelope = 'envelope' in result ? result.envelope : result;
	assert.ok(['applied', 'already-applied'].includes(envelope.result?.status));
}

function assertRuntimeReady() {
	assertRequestRootClean();
	const diagnostics = runCli(['diagnostics']);
	assert.equal(diagnostics.ok, true);
	assert.equal(diagnostics.vaultIdentity?.expectedMatch, true);
	assert.equal(diagnostics.result?.health?.lifecyclePhase, 'ready');
	assert.equal(diagnostics.result?.health?.v8PersistencePhase, 'idle');
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

function countActiveTaskCopies(operonId) {
	const needle = new RegExp(
		`(?:operonId\\s*:\\s*${escapeRegExp(operonId)}\\b|operonId\\s*::\\s*${escapeRegExp(operonId)}\\b)`,
		'gu',
	);
	let count = 0;
	const visit = directory => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(entryPath);
			else if (entry.isFile() && entry.name.endsWith('.md')) {
				count += [...readFileSync(entryPath, 'utf8').matchAll(needle)].length;
			}
		}
	};
	visit(vaultPath);
	return count;
}

function readPinnedState(operonId) {
	const dataPackage = JSON.parse(readFileSync(
		path.join(vaultPath, '.obsidian/plugins/operon/data.json'),
		'utf8',
	));
	return dataPackage.state?.pinnedTasks?.itemsById?.[operonId]?.pinned;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function runCli(command, input, allowFailure = false) {
	const local = command[0] === 'plan';
	if (!local) assertRequestRootClean();
	const result = spawnSync(process.execPath, [
		cliArtifact,
		...command,
		...(local ? [] : ['--vault', vaultPath]),
		...(input === undefined || command.includes('--input') ? [] : ['--input', '-']),
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
	const envelope = JSON.parse(result.stdout);
	return allowFailure ? { exitCode: result.status, envelope } : envelope;
}

function report(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
