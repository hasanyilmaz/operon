#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_TRANSITION_RECOVERY_FEATURES = [
	'terminal-after-state-verification',
	'same-plan-forward-continuation',
	'compare-aware-compensation',
	'cross-file-transition-journal',
];
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const vaultPath = realpathSync('/private/tmp/cli-test-vault');
assert.equal(vaultPath, '/private/tmp/cli-test-vault');
assert.equal(lstatSync(vaultPath).isSymbolicLink(), false);
assert.deepEqual(process.argv.slice(2), ['run']);

const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const configRoot = path.join(
	realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir()),
	'operon-a12-source-happy-cli',
);
const requestRoot = path.join(
	realpathSync(tmpdir()),
	`operon-agent-runtime-uid-${typeof process.getuid === 'function' ? process.getuid() : 'unavailable'}`,
);
rmSync(configRoot, { recursive: true, force: true });
mkdirSync(configRoot, { recursive: true, mode: 0o700 });

assertRuntimeReady();
const manifest = runCli(['manifest']);
for (const command of ['task.relocate', 'task.convert', 'task.delete']) {
	const contract = manifest.result?.convenienceContracts?.[command];
	assert.equal(contract?.sourceTransitionRecoveryVersion, 1);
	assert.deepEqual(
		contract?.sourceTransitionRecoveryFeatures,
		SOURCE_TRANSITION_RECOVERY_FEATURES,
	);
}
const catalog = runCli(['catalog']);
assert.equal(catalog.result?.policies?.sourceTransitionRecoveryVersion, 1);
assert.deepEqual(
	catalog.result?.policies?.sourceTransitionRecoveryFeatures,
	SOURCE_TRANSITION_RECOVERY_FEATURES,
);
const templates = catalog.result?.policies?.creation?.fileTaskTemplateCandidates ?? [];
const templateMatches = templates.filter(candidate => (
	candidate.kind === 'folder'
	&& candidate.sourcePath === 'Templates/Fixture Task.md'
));
assert.equal(templateMatches.length, 1);
const templateName = templateMatches[0].name;

let task = readTask('inln001');
const sameFileLine = firstPlacementLine(
	'Daily/2026-01-15.md',
	task.locator.lineNumber,
);
assertApplied(runCli([
	'task', 'relocate', '--id', 'inln001',
	'--target-file', 'Daily/2026-01-15.md', '--line', String(sameFileLine + 1),
]));
task = readTask('inln001');
assert.equal(task.locator.filePath, 'Daily/2026-01-15.md');
assert.equal(task.locator.lineNumber, sameFileLine);

const crossFileLine = firstPlacementLine('Warm/Conversion Target.md');
assertApplied(runCli([
	'task', 'relocate', '--id', 'inln001',
	'--target-file', 'Warm/Conversion Target.md', '--line', String(crossFileLine + 1),
]));
task = readTask('inln001');
assert.equal(task.locator.filePath, 'Warm/Conversion Target.md');
assert.equal(task.locator.lineNumber, crossFileLine);

const convertedFile = 'Tasks/A12 Direct Inline To File.md';
assert.equal(existsSync(path.join(vaultPath, convertedFile)), false);
assertApplied(runCli([
	'task', 'convert', '--id', 'inln001', '--to', 'file',
	'--template', templateName, '--target-file', convertedFile,
]));
task = readTask('inln001');
assert.equal(task.representation, 'file');
assert.equal(task.locator.filePath, convertedFile);

const inlineTargetLine = firstPlacementLine('Daily/2026-01-15.md');
const fileToInlinePreview = runCli([
	'task', 'convert', '--id', 'inln001', '--to', 'inline',
	'--target-file', 'Daily/2026-01-15.md', '--line', String(inlineTargetLine + 1),
]);
assertStoredDestructivePlan(fileToInlinePreview, 'task.convert');
assert.ok(
	fileToInlinePreview.result?.plan?.conversionEffect?.lossManifest?.length > 0,
	'File-to-inline conversion must disclose its exact loss manifest.',
);
assertApplied(applyStoredPlan(fileToInlinePreview.client.planRef));
assert.equal(existsSync(path.join(vaultPath, convertedFile)), false);
task = readTask('inln001');
assert.equal(task.representation, 'inline');
assert.equal(task.locator.filePath, 'Daily/2026-01-15.md');
assert.equal(task.locator.lineNumber, inlineTargetLine);

const inlineDeletePreview = runCli(['task', 'delete', '--id', 'inln001']);
assertStoredDestructivePlan(inlineDeletePreview, 'task.delete');
assertApplied(applyStoredPlan(inlineDeletePreview.client.planRef));
assertTaskMissing('inln001');

assertApplied(runCli(['task', 'pin', '--id', 'delw000']));
assert.equal(readTask('delw000').pinned, true);
const fileDeletePreview = runCli(['task', 'delete', '--id', 'delw000']);
assertStoredDestructivePlan(fileDeletePreview, 'task.delete');
assertApplied(applyStoredPlan(fileDeletePreview.client.planRef));
assertTaskMissing('delw000');
assert.equal(existsSync(path.join(vaultPath, 'Warm/Delete 000.md')), false);

assertRuntimeReady();
rmSync(configRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vaultPath,
	sameFileRelocate: 'verified',
	crossFileRelocate: 'verified',
	inlineToFile: 'applied',
	fileToInline: 'confirmed-applied',
	inlineDelete: 'confirmed-applied',
	fileDeletePinnedCleanup: 'confirmed-applied',
	samePlan: true,
}, null, 2)}\n`);

function firstPlacementLine(filePath, excludedLine = -1) {
	const context = runCli(['context'], {
		contractVersion: 1,
		requestId: `a12-source-placement-${randomUUID()}`,
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'placement-candidates',
		placement: { mode: 'lines', filePath },
		limit: 100,
	});
	assert.equal(context.result?.ok, true);
	assert.deepEqual(context.result?.warnings, []);
	assert.deepEqual(context.result?.truncations, []);
	assert.equal(context.result?.placement?.mode, 'lines');
	assert.equal(context.result?.placement?.truncated, false);
	const candidate = context.result.placement.lines.find(item => (
		item.locator?.filePath === filePath
		&& item.locator?.lineNumber !== excludedLine
	));
	assert.equal(Number.isSafeInteger(candidate?.locator?.lineNumber), true);
	return candidate.locator.lineNumber;
}

function applyStoredPlan(planRef) {
	const shown = runCli(['plan', 'show', planRef]);
	const token = shown.result?.plan?.confirmationToken;
	assert.match(token, /^[A-Za-z0-9_-]{16,}$/u);
	return runCli(['plan', 'apply', planRef, '--confirm', token, '--timeout-ms', '30000']);
}

function assertStoredDestructivePlan(result, mutationKind) {
	assert.match(result.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
	assert.equal(result.result?.plan?.mutationKind, mutationKind);
	assert.equal(result.result?.plan?.riskLevel, 'destructive');
	assert.equal(result.result?.plan?.requiresConfirmation, true);
	assert.notEqual(result.result?.status, 'applied');
}

function assertApplied(result) {
	assert.ok(['applied', 'already-applied'].includes(result.result?.status));
	assert.equal(result.result?.postflight?.status, 'verified');
}

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a12-source-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['source-markdown'],
	});
	assert.equal(result.result?.ok, true);
	assert.deepEqual(result.result?.truncations, []);
	return result.result.task;
}

function assertTaskMissing(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a12-source-missing-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
	}, true);
	assert.equal(result.failure?.error?.code, 'entity-not-found');
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

function runCli(command, input, allowFailure = false) {
	const local = command[0] === 'manifest' || command[0] === 'plan';
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
	else assert.notEqual(result.status, 0);
	assert.match(result.stdout, /\S/u, result.stderr);
	if (!local) assertRequestRootClean();
	return JSON.parse(result.stdout);
}
