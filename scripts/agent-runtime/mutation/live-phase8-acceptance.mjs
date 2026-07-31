#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PHASE8_MUTATION_FAMILIES,
	assertPhase8CompletionFamilies,
	selectPhase8MutationFamilies,
} from './phase8-capability-selection.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
const requestedVault = process.argv[2] ?? path.join(expectedTempRoot, 'operon-agent-runtime-phase1-v1');
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true, 'Live acceptance target must be a directory.');
assert.equal(vaultStat.isSymbolicLink(), false, 'Live acceptance target cannot be a symlink.');
assert.equal(path.dirname(vaultPath), expectedTempRoot, 'Live acceptance target must stay in the fixed temp root.');
assert.match(path.basename(vaultPath), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);
const cliConfigRoot = mkdtempSync(path.join(tmpdir(), 'operon-phase8-cli-'));
process.on('exit', () => {
	rmSync(cliConfigRoot, { recursive: true, force: true });
});

const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const dailyRelativePath = 'Daily/2026-01-15.md';
const dailyPath = path.join(vaultPath, dailyRelativePath);
const settingsPath = path.join(vaultPath, '.obsidian/plugins/operon/data.json');
const originalFileTaskPath = path.join(vaultPath, 'Tasks/Synthetic File Task.md');
const unrelatedFileTaskPath = path.join(vaultPath, 'Tasks/Unrelated Fixture.md');
const repeatSeriesStatePath = path.join(
	vaultPath,
	'.obsidian/plugins/operon/state/repeat-series.json',
);
const convertedRelativePath = 'Tasks/Phase 8 converted.md';
const convertedPath = path.join(vaultPath, convertedRelativePath);

assert.equal(existsSync(convertedPath), false, 'Conversion target must start absent.');
let task = readTask('inln001', 'phase8-initial');
const healthBefore = readHealth('phase8-health-before');
const settingsFingerprintBefore = healthBefore.contextRevision.settingsFingerprint;
const stableDigestsBefore = new Map([
	[dailyPath, digestFile(dailyPath)],
	[settingsPath, digestFile(settingsPath)],
	[unrelatedFileTaskPath, digestFile(unrelatedFileTaskPath)],
]);
const capabilityEnvelope = runCli(['capabilities']);
assert.equal(capabilityEnvelope.ok, true, 'Capability discovery transport must succeed.');
assert.ok(Array.isArray(capabilityEnvelope.result), 'Capability discovery must return an advertisement list.');
const selectedFamilies = selectPhase8MutationFamilies(capabilityEnvelope.result);
if (process.env.OPERON_PHASE8_STRICT_COMPLETION === '1') {
	assertPhase8CompletionFamilies(capabilityEnvelope.result);
}
const publishedFamilies = selectedFamilies.published;
const refusedFamilies = selectedFamilies.refused;
const unavailableFamilies = selectedFamilies.unavailable;

const refusalDigestBefore = snapshotDigests(stableDigestsBefore.keys());
const nonPublishedFamilies = [
	...refusedFamilies,
	...unavailableFamilies.map(item => item.family),
];
for (const key of nonPublishedFamilies) {
	const definition = PHASE8_MUTATION_FAMILIES.find(item => item.key === key);
	assert.ok(definition);
	const refusal = runCli(
		['mutation', 'preview'],
		refusalRequest(definition, task),
		undefined,
		4,
	);
	assert.equal(refusal.ok, false, `${key} contract-only preview must be refused.`);
	assert.equal(refusal.failure?.stage, 'capability');
	assert.equal(refusal.failure?.error?.code, 'capability-unavailable');
}
assert.deepEqual(
	snapshotDigests(stableDigestsBefore.keys()),
	refusalDigestBefore,
	'Contract-only refusal checks must remain read-only.',
);

const published = new Set(publishedFamilies);
const timings = {};
if (published.has('update')) {
	timings.update = runUpdate();
}
if (published.has('reminder')) {
	timings.reminder = runReminder();
}
if (published.has('transition')) {
	timings.transition = runTransition();
	timings.recurrence = runRecurringTransitions();
}
if (published.has('timer')) {
	timings.timer = runTimer();
}
if (published.has('relocation')) {
	timings.relocation = runRelocation();
}
if (published.has('conversion')) {
	timings.conversion = runConversion();
}
if (published.has('delete')) {
	timings.delete = runDeletion();
}

const settingsFingerprintAfter = readHealth('phase8-health-after').contextRevision.settingsFingerprint;
assert.equal(
	settingsFingerprintAfter,
	settingsFingerprintBefore,
	'Mutation acceptance must not change agent-visible settings semantics.',
);
assert.equal(
	digestFile(unrelatedFileTaskPath),
	stableDigestsBefore.get(unrelatedFileTaskPath),
	'Unrelated File Task must remain byte-identical.',
);

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vault: path.basename(vaultPath),
	publishedFamilies,
	refusedFamilies,
	unavailableFamilies,
	timings,
	settingsFingerprintUnchanged: true,
	dataPackageStateChangesAllowed: true,
	unrelatedTaskUnchanged: true,
	finalTaskAbsent: published.has('delete'),
}, null, 2)}\n`);

function runUpdate() {
	const result = mutate({
		name: 'update',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: exactTarget(task),
		spec: {
			operation: 'update',
			changes: [
				{ field: 'description', valueType: 'text', value: 'Phase 8 updated synthetic task' },
				{ field: 'priority', valueType: 'text', value: 'pr_fixture_p1' },
				{ field: 'fixtureTopic', valueType: 'text', value: 'Mutation infrastructure' },
			],
		},
	});
	task = readTask('inln001', 'phase8-updated');
	assert.equal(task.description, 'Phase 8 updated synthetic task');
	assert.equal(task.priority.id, 'pr_fixture_p1');
	assert.equal(task.customFields.fixtureTopic, 'Mutation infrastructure');
	return result.timing;
}

function runReminder() {
	const result = mutate({
		name: 'reminder',
		capability: 'tasks.reminder.preview',
		mutationKind: 'task.reminder-item',
		target: exactTarget(task),
		spec: {
			operation: 'add',
			collection: 'reminderDatetimes',
			value: '2099-01-16T10:30:00',
		},
	});
	task = readTask('inln001', 'phase8-reminder');
	assert.match(task.sourceMarkdown, /2099-01-16T10:30:00/u);
	return result.timing;
}

function runTransition() {
	const done = mutate({
		name: 'transition-done',
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(task),
		spec: {
			operation: 'transition',
			targetStatusId: 'st_fixture_done',
			expectedStatusId: task.workflow.status.id,
		},
	});
	task = readTask('inln001', 'phase8-transition-done');
	assert.equal(task.checkbox, 'done');
	assert.equal(task.workflow.status.id, 'st_fixture_done');
	const open = mutate({
		name: 'transition-open',
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(task),
		spec: {
			operation: 'transition',
			targetStatusId: 'st_fixture_active',
			expectedStatusId: 'st_fixture_done',
		},
	});
	task = readTask('inln001', 'phase8-transition-open');
	assert.equal(task.checkbox, 'open');
	assert.equal(task.workflow.status.id, 'st_fixture_active');
	return { done: done.timing, open: open.timing };
}

function runRecurringTransitions() {
	let inlineTask = readTask('rec0001', 'phase8-recurring-inline-before');
	const inline = mutate({
		name: 'transition-recurring-inline',
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(inlineTask),
		spec: {
			operation: 'transition',
			targetStatusId: 'st_fixture_done',
			expectedStatusId: inlineTask.workflow.status.id,
		},
	});
	const inlineNextId = sealedRecurrenceTaskId(inline.preview.result.plan);
	inlineTask = readTask(inlineNextId, 'phase8-recurring-inline-after');
	assert.equal(inlineTask.representation, 'inline');
	assert.equal(inlineTask.locator.filePath, dailyRelativePath);
	assert.equal(inlineTask.checkbox, 'open');
	assert.doesNotMatch(
		readFileSync(dailyPath, 'utf8'),
		/\{\{operonId:: rec0001\}\}/u,
		'Replace-completed recurrence must remove the terminal inline source occurrence.',
	);
	assert.equal(
		readTask('recpar1', 'phase8-recurring-inline-parent').identity.operonId,
		'recpar1',
		'Same-file recurrence must retain and postflight its aggregate parent.',
	);

	let fileTask = readTask('recf001', 'phase8-recurring-file-before');
	const file = mutate({
		name: 'transition-recurring-file',
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(fileTask),
		spec: {
			operation: 'transition',
			targetStatusId: 'st_fixture_done',
			expectedStatusId: fileTask.workflow.status.id,
		},
	});
	const fileNextId = sealedRecurrenceTaskId(file.preview.result.plan);
	fileTask = readTask(fileNextId, 'phase8-recurring-file-after');
	assert.equal(fileTask.representation, 'file');
	assert.equal(fileTask.checkbox, 'open');
	assert.notEqual(fileTask.locator.filePath, 'Tasks/Recurring Fixture - 2026-01-15.md');
	assert.equal(existsSync(path.join(vaultPath, fileTask.locator.filePath)), true);
	assert.ok(
		readdirSync(path.join(vaultPath, 'Tasks')).some(name => name.includes('Recurring Fixture')),
		'Recurring File Task materialization must remain visible in the canonical target folder.',
	);

	const plainSourcePath = 'Tasks/Plain Recurring Fixture.md';
	let plainTask = readTask('recp001', 'phase8-recurring-plain-file-before');
	const plain = mutate({
		name: 'transition-recurring-plain-file',
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(plainTask),
		spec: {
			operation: 'transition',
			targetStatusId: 'st_fixture_done',
			expectedStatusId: plainTask.workflow.status.id,
		},
	});
	const plainNextId = sealedRecurrenceTaskId(plain.preview.result.plan);
	const plainNextTask = readTask(plainNextId, 'phase8-recurring-plain-file-next');
	assert.equal(plainNextTask.locator.filePath, plainSourcePath);
	assert.equal(plainNextTask.checkbox, 'open');
	plainTask = readTask('recp001', 'phase8-recurring-plain-file-archive');
	assert.notEqual(plainTask.locator.filePath, plainSourcePath);
	assert.match(
		plainTask.locator.filePath,
		/^Tasks\/2026-01-15 - Plain Recurring Fixture(?: \(\d+\))?\.md$/u,
	);
	assert.equal(
		plainTask.description,
		path.basename(plainTask.locator.filePath, '.md'),
	);
	assert.equal(plainTask.checkbox, 'done');
	return { inline: inline.timing, file: file.timing, plainFile: plain.timing };
}

function sealedRecurrenceTaskId(plan) {
	for (const effect of plan.predictedEffects) {
		const match = effect.summary.match(/Materialize sealed recurrence task ([a-z0-9]{7})/u);
		if (match) return match[1];
	}
	throw new Error('Transition preview did not disclose the sealed recurrence task identity.');
}

function runTimer() {
	const assignedStart = mutate({
		name: 'timer-start-assigned',
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		target: exactTarget(task),
		spec: { operation: 'start' },
	});
	let timer = readTimer('phase8-timer-assigned');
	assert.equal(timer.active?.operonId, 'inln001');
	assert.equal(timer.active?.isUnassigned, false);
	const assignedStop = mutate({
		name: 'timer-stop-assigned',
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		spec: { operation: 'stop', expectedActiveStart: timer.active.start },
	});
	timer = readTimer('phase8-timer-assigned-stopped');
	assert.equal(timer.active, null);
	const unassignedStart = mutate({
		name: 'timer-start-unassigned',
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		spec: { operation: 'start' },
	});
	timer = readTimer('phase8-timer-unassigned');
	assert.equal(timer.active?.isUnassigned, true);
	const unassignedStop = mutate({
		name: 'timer-stop-unassigned',
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		spec: { operation: 'stop', expectedActiveStart: timer.active.start },
	});
	assert.equal(readTimer('phase8-timer-unassigned-stopped').active, null);
	return {
		assignedStart: assignedStart.timing,
		assignedStop: assignedStop.timing,
		unassignedStart: unassignedStart.timing,
		unassignedStop: unassignedStop.timing,
	};
}

function runRelocation() {
	task = readTask('inln001', 'phase8-before-relocation');
	assert.equal(task.locator.representation, 'inline');
	const source = readFileSync(dailyPath, 'utf8');
	const lines = source.split('\n');
	const sourceLine = lines[task.locator.lineNumber];
	const destinationLineNumber = lines.findIndex(
		(line, index) => index !== task.locator.lineNumber && line.trim() === '',
	);
	assert.ok(destinationLineNumber >= 0, 'Relocation fixture requires an exact blank target line.');
	const result = mutate({
		name: 'relocate-inline',
		capability: 'tasks.inline.relocate.preview',
		mutationKind: 'task.inline-relocate',
		target: exactTarget(task),
		spec: relocationSpec(task, destinationLineNumber),
	});
	task = readTask('inln001', 'phase8-relocated');
	assert.equal(task.locator.lineNumber, destinationLineNumber);
	assert.equal(readFileSync(dailyPath, 'utf8').split('\n')[destinationLineNumber], sourceLine);
	return result.timing;
}

function runConversion() {
	const titleLossSourcePath = path.join(vaultPath, 'Tasks/Title Loss Fixture.md');
	const titleLossTask = readTask('title01', 'phase8-title-loss-before');
	const needsTarget = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `phase8-needs-target-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-live-acceptance',
		idempotencyKey: `phase8-needs-target-${randomUUID()}`,
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(titleLossTask),
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'configured-target',
				filePath: 'Targets/No Blank Target.md',
			},
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Verify configured conversion target requires an exact blank line.',
		},
	}, undefined, 5);
	assert.equal(needsTarget.failure?.stage, 'runtime');
	assert.equal(needsTarget.failure?.error?.code, 'needs-target');
	const titleLossTargetLines = readFileSync(dailyPath, 'utf8').split('\n');
	const titleLossTargetLine = titleLossTargetLines.findIndex(line => line.trim() === '');
	assert.ok(titleLossTargetLine >= 0);
	const titleLossConversion = mutate({
		name: 'convert-title-loss-file-to-inline',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(titleLossTask),
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: dailyRelativePath,
				lineNumber: titleLossTargetLine,
			},
		},
		destructive: true,
	});
	assert.ok(
		titleLossConversion.preview.result.plan.conversionEffect.lossManifest.some(
			item => item.key === 'title',
		),
		'File-to-inline preview must disclose the YAML title property.',
	);
	assert.equal(existsSync(titleLossSourcePath), false);

	const templaterTask = readTask('tmpl001', 'phase8-templater-refusal-before');
	const needsTemplate = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `phase8-needs-template-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-live-acceptance',
		idempotencyKey: `phase8-needs-template-${randomUUID()}`,
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(templaterTask),
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'folder-file-task-template:Templates/Missing Fixture.md',
			targetPath: 'Tasks/Missing template MUST NOT write.md',
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Verify conversion requires an existing static template.',
		},
	}, undefined, 5);
	assert.equal(needsTemplate.failure?.stage, 'runtime');
	assert.equal(needsTemplate.failure?.error?.code, 'needs-template');
	const templaterRefusal = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `phase8-templater-refusal-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-live-acceptance',
		idempotencyKey: `phase8-templater-refusal-${randomUUID()}`,
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(templaterTask),
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'folder-file-task-template:Templates/Dynamic Fixture.md',
			targetPath: 'Tasks/Templater MUST NOT run.md',
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Verify Runtime V1 refuses dynamic Templater execution.',
		},
	}, undefined, 5);
	assert.equal(templaterRefusal.ok, false);
	assert.equal(templaterRefusal.failure?.stage, 'runtime');
	assert.equal(templaterRefusal.failure?.error?.code, 'template-processing-required');
	assert.equal(existsSync(path.join(vaultPath, 'Tasks/Templater MUST NOT run.md')), false);

	let repeatConversionTask = readTask('cnv0001', 'phase8-repeat-conversion-before');
	const parentDigestBeforeConversion = digestFile(originalFileTaskPath);
	const grandparentPath = path.join(vaultPath, 'Tasks/Conversion Grandparent.md');
	const grandparentDigestBeforeConversion = digestFile(grandparentPath);
	const repeatTargetRelativePath = 'Tasks/Repeat Conversion Fixture.md';
	const repeatTargetPath = path.join(vaultPath, repeatTargetRelativePath);
	const repeatInlineToFile = mutate({
		name: 'convert-repeat-inline-to-file',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(repeatConversionTask),
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'folder-file-task-template:Templates/Fixture Task.md',
			targetPath: repeatTargetRelativePath,
		},
	});
	assert.match(
		readFileSync(repeatTargetPath, 'utf8'),
		/- \[ \] Attached plain checkbox survives conversion/u,
		'Inline-to-file conversion must move the exact attached plain-checkbox block.',
	);
	assert.equal(readRepeatSeries('rscnv01').sourceFormat, 'yaml');
	assert.notEqual(
		digestFile(originalFileTaskPath),
		parentDigestBeforeConversion,
		'Conversion must refresh the exact parent source timestamp and aggregates.',
	);
	assert.notEqual(
		digestFile(grandparentPath),
		grandparentDigestBeforeConversion,
		'Conversion must refresh every exact ancestor source in the hierarchy.',
	);
	const conversionGroupIds = new Set(
		repeatInlineToFile.applied.result.groupResults.map(group => group.groupId),
	);
	assert.ok(conversionGroupIds.has('task-source:Tasks/Synthetic File Task.md'));
	assert.ok(conversionGroupIds.has('task-source:Tasks/Conversion Grandparent.md'));
	repeatConversionTask = readTask('cnv0001', 'phase8-repeat-conversion-file');
	const repeatDestinationLines = readFileSync(dailyPath, 'utf8').split('\n');
	const repeatDestinationLine = repeatDestinationLines.findIndex(line => line.trim() === '');
	assert.ok(repeatDestinationLine >= 0);
	const repeatFileToInline = mutate({
		name: 'convert-repeat-file-to-inline',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(repeatConversionTask),
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: dailyRelativePath,
				lineNumber: repeatDestinationLine,
			},
		},
		destructive: true,
	});
	assert.ok(repeatFileToInline.preview.result.plan.conversionEffect.lossManifest.length > 0);
	assert.equal(readRepeatSeries('rscnv01').sourceFormat, 'inline');
	assert.equal(existsSync(repeatTargetPath), false);

	task = readTask('inln001', 'phase8-before-conversion');
	const inlineToFile = mutate({
		name: 'convert-inline-to-file',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(task),
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'folder-file-task-template:Templates/Fixture Task.md',
			targetPath: convertedRelativePath,
		},
	});
	assert.equal(existsSync(convertedPath), true);
	assert.match(
		readFileSync(convertedPath, 'utf8'),
		/# Fixture template/u,
		'Static folder-template body must be preserved by canonical conversion.',
	);
	task = readTask('inln001', 'phase8-converted-file');
	assert.equal(task.representation, 'file');
	assert.equal(task.locator.filePath, convertedRelativePath);
	const fileToInline = mutate({
		name: 'convert-file-to-inline',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(task),
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'configured-target',
				filePath: dailyRelativePath,
			},
		},
		destructive: true,
	});
	const configuredTargetLine = fileToInline.preview.result.plan
		.conversionEffect.afterLocator.lineNumber;
	assert.equal(
		Number.isInteger(configuredTargetLine),
		true,
		'Configured target preview must seal an exact destination line.',
	);
	assert.ok(
		fileToInline.preview.result.plan.conversionEffect.lossManifest.length > 0,
		'File-to-inline preview must itemize template body or YAML loss.',
	);
	assert.equal(existsSync(convertedPath), false, 'Destructive conversion must trash the source File Task.');
	task = readTask('inln001', 'phase8-converted-inline');
	assert.equal(task.representation, 'inline');
	assert.equal(task.locator.filePath, dailyRelativePath);
	assert.equal(task.locator.lineNumber, configuredTargetLine);
	return {
		titleFileToInline: titleLossConversion.timing,
		repeatInlineToFile: repeatInlineToFile.timing,
		repeatFileToInline: repeatFileToInline.timing,
		inlineToFile: inlineToFile.timing,
		fileToInline: fileToInline.timing,
	};
}

function runDeletion() {
	task = readTask('inln001', 'phase8-before-delete');
	const result = mutate({
		name: 'delete',
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: exactTarget(task),
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
		destructive: true,
	});
	const missing = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `phase8-deleted-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId: 'inln001' },
		consistency: 'live-verified',
	}, undefined, 5);
	assert.equal(missing.ok, false, 'Deleted task read must return a failed CLI envelope.');
	assert.equal(missing.failure?.error?.code, 'entity-not-found');
	return result.timing;
}

function mutate({
	name,
	capability,
	mutationKind,
	target,
	spec,
	destructive = false,
}) {
	const idempotencyKey = `phase8-${name}-${randomUUID()}`;
	const previewRequest = () => ({
		contractVersion: 1,
		requestId: `phase8-${name}-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-live-acceptance',
		idempotencyKey,
		capability,
		mutationKind,
		...(target ? { target } : {}),
		spec,
		authorization: {
			basis: 'user-explicit-request',
			reason: `Phase 8 sanitized ${name} preview.`,
		},
	});
	if (process.env.OPERON_PHASE8_STRICT_COMPLETION === '1') {
		const warmup = runCli(['mutation', 'preview'], previewRequest());
		assert.equal(warmup.result?.ok, true, `${name} warmup preview must succeed.`);
	}
	const previewSamples = [];
	const configuredPreviewSamples = Number.parseInt(
		process.env.OPERON_PHASE8_PREVIEW_SAMPLES ?? '',
		10,
	);
	const previewSampleCount = Number.isInteger(configuredPreviewSamples)
		&& configuredPreviewSamples > 0
		? configuredPreviewSamples
		: process.env.OPERON_PHASE8_STRICT_COMPLETION === '1' ? 20 : 1;
	let preview;
	for (let sample = 0; sample < previewSampleCount; sample += 1) {
		preview = runCli(['mutation', 'preview'], previewRequest());
		previewSamples.push(preview.timing);
	}
	assert.equal(preview.ok, true, `${name} preview transport must succeed.`);
	assert.equal(preview.result?.ok, true, `${name} preview must return a sealed plan.`);
	const previewHandlerP95 = percentile(
		previewSamples.map(sample => sample.handlerMs),
		0.95,
	);
	if (process.env.OPERON_PHASE8_DEFER_PER_RUN_PERFORMANCE !== '1') {
		assert.ok(
			previewHandlerP95 < 100,
			`${name} preview handler p95 must remain below 100 ms; received ${previewHandlerP95}.`,
		);
	}
	const plan = preview.result.plan;
	if (destructive) {
		assert.equal(plan.riskLevel, 'destructive');
		assert.equal(plan.requiresConfirmation, true);
		assert.ok(plan.requiredAcknowledgements.length > 0);
	}
	assert.equal(typeof preview.client?.planRef, 'string', `${name} preview must persist an owner-only plan reference.`);
	const confirmationRequired = plan.riskLevel === 'destructive'
		|| plan.requiresConfirmation
		|| plan.requiredAcknowledgements.length > 0;
	const shown = confirmationRequired
		? runCli(['plan', 'show', preview.client.planRef])
		: undefined;
	const confirmationToken = shown?.result?.plan?.confirmationToken;
	if (confirmationRequired) {
		assert.match(confirmationToken, /^[a-f0-9]{64}$/u);
	}
	const applied = runCli([
		'plan',
		'apply',
		preview.client.planRef,
		...(confirmationToken ? ['--confirm', confirmationToken] : []),
	]);
	assert.equal(applied.ok, true, `${name} apply transport must succeed.`);
	assert.equal(applied.result?.status, 'applied', `${name} apply must commit.`);
	const applyLimitMs = ['task.inline-relocate', 'task.convert', 'task.delete'].includes(mutationKind)
		? 3_000
		: 2_000;
	if (process.env.OPERON_PHASE8_DEFER_PER_RUN_PERFORMANCE !== '1') {
		assert.ok(
			applied.timing.handlerMs < applyLimitMs,
			`${name} apply handler must remain below ${applyLimitMs} ms.`,
		);
	}
	return {
		preview,
		applied,
		timing: {
			preview: {
				samples: previewSamples.length,
				handlerP95: previewHandlerP95,
				totalP95: percentile(previewSamples.map(sample => sample.totalMs), 0.95),
			},
			apply: applied.timing,
		},
	};
}

function percentile(values, ratio) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function refusalRequest(definition, taskValue) {
	const base = {
		contractVersion: 1,
		requestId: `phase8-${definition.key}-refusal-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-live-refusal',
		idempotencyKey: `phase8-${definition.key}-refusal-${randomUUID()}`,
		capability: definition.preview,
		mutationKind: definition.mutationKind,
		authorization: {
			basis: 'user-explicit-request',
			reason: `Verify ${definition.key} remains behind its publication gate.`,
		},
	};
	if (definition.key === 'update') {
		return {
			...base,
			target: exactTarget(taskValue),
			spec: {
				operation: 'update',
				changes: [{ field: 'description', valueType: 'text', value: 'MUST NOT APPLY' }],
			},
		};
	}
	if (definition.key === 'reminder') {
		return {
			...base,
			target: exactTarget(taskValue),
			spec: { operation: 'add', collection: 'reminderRules', value: 'dateDue.15m' },
		};
	}
	if (definition.key === 'transition') {
		return {
			...base,
			target: exactTarget(taskValue),
			spec: {
				operation: 'transition',
				targetStatusId: 'st_fixture_done',
				expectedStatusId: taskValue.workflow.status.id,
			},
		};
	}
	if (definition.key === 'timer') {
		return {
			...base,
			target: exactTarget(taskValue),
			spec: { operation: 'start' },
		};
	}
	if (definition.key === 'relocation') {
		const lines = readFileSync(dailyPath, 'utf8').split('\n');
		const destinationLineNumber = lines.findIndex(
			(line, index) => index !== taskValue.locator.lineNumber && line.trim() === '',
		);
		assert.ok(destinationLineNumber >= 0);
		return {
			...base,
			target: exactTarget(taskValue),
			spec: relocationSpec(taskValue, destinationLineNumber),
		};
	}
	if (definition.key === 'conversion') {
		return {
			...base,
			target: exactTarget(taskValue),
			spec: {
				operation: 'convert',
				from: 'inline',
				to: 'file',
				templateId: 'builtin-minimal-file-task-template:pl_fixture_work',
				targetPath: convertedRelativePath,
			},
		};
	}
	return {
		...base,
		target: exactTarget(taskValue),
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
	};
}

function relocationSpec(taskValue, destinationLineNumber) {
	const source = readFileSync(dailyPath, 'utf8');
	const lines = source.split('\n');
	return {
		operation: 'relocate-inline',
		source: {
			locator: taskValue.locator,
			lineDigest: sha256(lines[taskValue.locator.lineNumber]),
			sourceRevision: { algorithm: 'sha256', contentDigest: sha256(source) },
		},
		destination: {
			locator: {
				representation: 'inline',
				filePath: dailyRelativePath,
				lineNumber: destinationLineNumber,
			},
			lineDigest: sha256(lines[destinationLineNumber]),
			sourceRevision: { algorithm: 'sha256', contentDigest: sha256(source) },
			mustBeBlank: true,
		},
	};
}

function readTask(operonId, suffix) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `${suffix}-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['custom-fields', 'source-markdown'],
	});
	assert.equal(result.result?.ok, true, `Task ${operonId} must be readable from the live Runtime.`);
	return result.result.task;
}

function readTimer(suffix) {
	const result = runCli(['timer', 'get'], undefined, suffix);
	assert.equal(result.result?.ok, true, 'Timer state must be readable from the live Runtime.');
	return result.result.state;
}

function readHealth(suffix) {
	const result = runCli(['health'], undefined, suffix);
	assert.equal(result.result?.ok, true, 'Runtime health must remain ready.');
	return result.result;
}

function exactTarget(taskValue) {
	return {
		operonId: taskValue.identity.operonId,
		locator: taskValue.locator,
	};
}

function runCli(command, request, requestId = undefined, expectedStatus = 0) {
	const isLocalPlanCommand = command[0] === 'plan';
	const args = [
		cliArtifact,
		...command,
		...(isLocalPlanCommand ? [] : ['--vault', vaultPath]),
		...(
			isLocalPlanCommand && !['apply', 'recover'].includes(command[1])
				? []
				: ['--timeout-ms', '30000']
		),
		'--json',
	];
	if (request !== undefined) args.push('--input', '-');
	if (requestId !== undefined) args.push('--request-id', requestId);
	const result = spawnSync(process.execPath, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CONFIG_HOME: cliConfigRoot,
		},
		...(request !== undefined ? { input: `${JSON.stringify(request)}\n` } : {}),
		maxBuffer: 4 * 1_024 * 1_024,
	});
	assert.equal(result.status, expectedStatus, result.stderr || result.stdout || 'Operon CLI failed.');
	return JSON.parse(result.stdout);
}

function snapshotDigests(filePaths) {
	return Object.fromEntries([...filePaths].map(filePath => [filePath, digestFile(filePath)]));
}

function readRepeatSeries(seriesId) {
	const state = JSON.parse(readFileSync(repeatSeriesStatePath, 'utf8'));
	const entry = state.series?.[seriesId];
	assert.ok(entry, `Repeat-series fixture ${seriesId} must exist.`);
	return entry;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function digestFile(filePath) {
	return sha256(readFileSync(filePath));
}
