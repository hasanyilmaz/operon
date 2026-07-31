#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

const [executable, vaultPath, configRoot] = process.argv.slice(2);
assert.ok(executable && vaultPath && configRoot, 'Usage: meeting-agent-fixture <operon> <vault> <config-root>');

const env = {
	...process.env,
	OPERON_CONFIG_HOME: configRoot,
};

const manifest = run(['manifest', '--json']);
assert.equal(manifest.ok, true);
assert.equal(manifest.result.package.name, 'operon-cli');
const createContract = manifest.result.convenienceContracts['task.create'];
const updateContract = manifest.result.convenienceContracts['task.update'];
assert.equal(createContract.mutationKind, 'task.create');
assert.equal(
	manifest.result.mutationCapabilities[createContract.mutationKind].preview,
	'tasks.create.preview',
);
assert.equal(
	manifest.result.mutationCapabilities[updateContract.mutationKind].apply,
	'tasks.update.apply',
);
assert.equal(manifest.result.runtimeContracts['context.build'].requestSchema, 'context-request');

const schemaList = run(['schema', 'list', '--json']);
assert.equal(schemaList.ok, true);
assert.ok(schemaList.result.entrypoints.some(item => item.schemaId === 'mutation-preview-request'));
assert.equal(run(['schema', 'get', 'mutation-intent', '--json']).ok, true);

const setup = run([
	'setup',
	'--vault',
	vaultPath,
	'--name',
	'meeting',
	'--default',
	'--live',
	'--json',
]);
assert.equal(setup.ok, true);
assert.equal(setup.result.live.result.transport.available, true);

const capabilities = run(['capabilities', '--profile', 'meeting', '--json']);
assert.equal(capabilities.ok, true);
const requiredCapabilities = new Set(['context.build']);
for (const mutationKind of Object.values(manifest.result.convenienceMutations)) {
	const mapping = manifest.result.mutationCapabilities[mutationKind];
	requiredCapabilities.add(mapping.preview);
	requiredCapabilities.add(mapping.apply);
}
for (const capability of requiredCapabilities) {
	const item = capabilities.result.find(candidate => candidate.id === capability);
	assert.equal(item?.availability, 'available', `${capability} must be available`);
}
assert.throws(
	() => requireCapability([{ id: 'tasks.update.preview', availability: 'contract-only' }], 'tasks.update.preview'),
	/CAPABILITY_UNAVAILABLE/u,
);
const capabilityRefusalWrapper = path.join(configRoot, 'capability-refusal.mjs');
writeFileSync(
	capabilityRefusalWrapper,
	[
		'#!/usr/bin/env node',
		'import { readFileSync, statSync } from "node:fs";',
		'import { tmpdir } from "node:os";',
		'import path from "node:path";',
		'const token = process.argv.find(value => value.startsWith("requestToken="))?.slice(13);',
		'const root = path.join(tmpdir(), `operon-agent-runtime-uid-${process.getuid()}`);',
		'const requestPath = path.join(root, `${token}.request.json`);',
		'const invocation = JSON.parse(readFileSync(requestPath, "utf8"));',
		'process.stdout.write(JSON.stringify({',
		' contractVersion: 1, kind: "cli-result", requestId: invocation.requestId, command: invocation.command, ok: false,',
		' transport: { channel: "request-file", inputBytes: statSync(requestPath).size },',
		' vaultIdentity: { expectedMatch: true }, timing: { handlerMs: 0 }, warnings: [],',
		' failure: { stage: "capability", error: { contractVersion: 1, code: "capability-unavailable", reason: "Synthetic unavailable capability.", retryable: false } }',
		'}) + "\\n");',
		'',
	].join('\n'),
	{ mode: 0o700 },
);
chmodSync(capabilityRefusalWrapper, 0o700);
const installedCapabilityRefusal = runAllowFailure([
	'task',
	'create',
	'--profile',
	'meeting',
	'--input',
	'-',
	'--obsidian-bin',
	capabilityRefusalWrapper,
	'--json',
], {
	contractVersion: 1,
	kind: 'mutation-intent',
	spec: {
		operation: 'create',
		items: [{
			itemRef: 'must-not-write',
			description: 'Capability refusal MUST NOT write',
			target: {
				representation: 'inline',
				mode: 'exact-path',
				filePath: 'Daily/2026-01-15.md',
			},
			fields: [],
			statusId: 'st_fixture_inbox',
			priorityId: 'pr_fixture_p2',
		}],
	},
});
assert.equal(installedCapabilityRefusal.status, 4);
assert.equal(installedCapabilityRefusal.envelope.failure.error.code, 'capability-unavailable');

const creationContext = runRuntime(
	['context', '--profile', 'meeting'],
	{
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'context',
		purpose: 'creation',
		projection: 'creation-context',
		consistency: 'live-verified',
	},
);
assert.equal(creationContext.result.ok, true);
assert.equal(creationContext.result.projection, 'creation-context');

const createPreview = previewConvenience('task', 'create', {
	contractVersion: 1,
	kind: 'mutation-intent',
	reason: 'Create two synthetic meeting follow-up tasks.',
	spec: {
		operation: 'create',
		items: [
			{
				itemRef: 'meeting-a',
				description: 'Phase 9 Meeting follow-up',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Daily/2026-01-15.md',
				},
				fields: [],
				statusId: 'st_fixture_inbox',
				priorityId: 'pr_fixture_p2',
			},
			{
				itemRef: 'meeting-b',
				description: 'Phase 9 Meeting follow-up',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Daily/2026-01-15.md',
				},
				fields: [],
				statusId: 'st_fixture_inbox',
				priorityId: 'pr_fixture_p2',
			},
		],
	},
});
const createPlanRef = createPreview.client.planRef;
const createPlan = run(['plan', 'show', createPlanRef, '--json']).result;
assert.equal(createPlan.plan.mutationKind, 'task.create');
const createdId = createPlan.plan.createEffects.find(effect => effect.itemRef === 'meeting-a').operonId;
const secondaryId = createPlan.plan.createEffects.find(effect => effect.itemRef === 'meeting-b').operonId;
assert.equal(run(['plan', 'apply', createPlanRef, '--json']).result.status, 'applied');

const ambiguous = runRuntime(
	['entity', 'resolve', '--profile', 'meeting'],
	{
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'entity-resolve',
		selector: { kind: 'search', query: 'Phase 9 Meeting follow-up', limit: 10 },
		limit: 10,
		consistency: 'live-verified',
	},
);
assert.equal(ambiguous.result.ok, true);
assert.equal(ambiguous.result.resolution, 'ambiguous');
assert.ok(ambiguous.result.candidates.length >= 2);

let task = readTask(createdId);
const exactTarget = () => ({
	operonId: task.identity.operonId,
	locator: task.locator,
});

const lostResponsePreview = previewConvenience('task', 'update', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: {
		operation: 'update',
		changes: [{ field: 'description', valueType: 'text', value: 'Phase 9 Meeting action accepted' }],
	},
});
const lostResponseWrapper = path.join(configRoot, 'lost-response-observer.mjs');
writeFileSync(
	lostResponseWrapper,
	[
		'#!/usr/bin/env node',
		'import { spawnSync } from "node:child_process";',
		'const child = spawnSync("obsidian", process.argv.slice(2), { stdio: ["ignore", "ignore", "inherit"] });',
		'process.exit(child.status === 0 ? 1 : (child.status ?? 1));',
		'',
	].join('\n'),
	{ mode: 0o700 },
);
chmodSync(lostResponseWrapper, 0o700);
const lostResponse = runAllowFailure([
	'plan',
	'apply',
	lostResponsePreview.client.planRef,
	'--obsidian-bin',
	lostResponseWrapper,
	'--json',
]);
assert.equal(lostResponse.status, 3);
const recovered = run(['plan', 'recover', lostResponsePreview.client.planRef, '--json']);
assert.equal(recovered.ok, true);
assert.ok(['applied', 'already-applied'].includes(recovered.result.status));
task = readTask(createdId);
assert.equal(task.description, 'Phase 9 Meeting action accepted');

applyConvenience('task', 'transition', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: {
		operation: 'transition',
		targetStatusId: 'st_fixture_active',
		expectedStatusId: task.workflow.status.id,
	},
});
task = readTask(createdId);
assert.equal(task.workflow.status.id, 'st_fixture_active');

applyConvenience('timer', 'start', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: { operation: 'start' },
});
const timerState = run(['timer', 'state', '--profile', 'meeting', '--json']);
assert.equal(timerState.ok, true);
assert.equal(timerState.result.state.active?.operonId, createdId);
applyConvenience('timer', 'stop', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: {
		operation: 'stop',
		expectedActiveStart: timerState.result.state.active.start,
	},
});

let secondaryTask = readTask(secondaryId);
applyConvenience('reminder', 'add', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'add',
		collection: 'reminderDatetimes',
		value: '2099-01-16T10:30:00',
	},
});
secondaryTask = readTask(secondaryId);
let reminderItems = readTaskWithReminderItems(secondaryId).reminderItems;
const addedReminder = reminderItems.find(item => (
	item.collection === 'reminderDatetimes'
	&& item.expectedValue === '2099-01-16T10:30:00'
));
assert.ok(addedReminder);
applyConvenience('reminder', 'replace', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'replace',
		collection: addedReminder.collection,
		itemId: addedReminder.itemId,
		expectedValue: addedReminder.expectedValue,
		value: '2099-01-16T11:30:00',
	},
});
reminderItems = readTaskWithReminderItems(secondaryId).reminderItems;
const replacedReminder = reminderItems.find(item => (
	item.collection === 'reminderDatetimes'
	&& item.expectedValue === '2099-01-16T11:30:00'
));
assert.ok(replacedReminder);
applyConvenience('reminder', 'remove', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'remove',
		collection: replacedReminder.collection,
		itemId: replacedReminder.itemId,
		expectedValue: replacedReminder.expectedValue,
	},
});
assert.equal(
	readTaskWithReminderItems(secondaryId).reminderItems.some(
		item => item.expectedValue === '2099-01-16T11:30:00',
	),
	false,
);

const relocationDestination = 1;
applyConvenience('task', 'relocate', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'relocate-inline',
		destination: {
			locator: {
				representation: 'inline',
				filePath: 'Daily/2026-01-15.md',
				lineNumber: relocationDestination,
			},
			mustBeBlank: true,
		},
	},
});
secondaryTask = readTask(secondaryId);
assert.equal(secondaryTask.locator.lineNumber, relocationDestination);

const convertedRelativePath = 'Tasks/Phase 9 Meeting Converted.md';
applyConvenience('task', 'convert', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'folder-file-task-template:Templates/Fixture Task.md',
		targetPath: convertedRelativePath,
	},
});
assert.equal(existsSync(path.join(vaultPath, convertedRelativePath)), true);
secondaryTask = readTask(secondaryId);
assert.equal(secondaryTask.representation, 'file');
const conversionDestination = 3;
applyConvenience('task', 'convert', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: {
		operation: 'convert',
		from: 'file',
		to: 'inline',
		target: {
			mode: 'exact-line',
			filePath: 'Daily/2026-01-15.md',
			lineNumber: conversionDestination,
		},
	},
}, { destructive: true });
secondaryTask = readTask(secondaryId);
assert.equal(secondaryTask.representation, 'inline');
assert.equal(existsSync(path.join(vaultPath, convertedRelativePath)), false);

const stalePreview = previewConvenience('task', 'update', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: {
		operation: 'update',
		changes: [{ field: 'note', valueType: 'text', value: 'Stale plan must not apply' }],
	},
});
applyConvenience('task', 'update', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: {
		operation: 'update',
		changes: [{ field: 'note', valueType: 'text', value: 'Fresh meeting note' }],
	},
});
const staleApply = runAllowFailure(['plan', 'apply', stalePreview.client.planRef, '--json']);
assert.equal(staleApply.status, 5);
assert.equal(staleApply.envelope.ok, true);
assert.ok(!['applied', 'already-applied'].includes(staleApply.envelope.result.status));
assert.equal(staleApply.envelope.result.mutationMayHaveApplied, false);

task = readTask(createdId);
const deletePreview = previewConvenience('task', 'delete', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: exactTarget(),
	spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
});
const refusedDelete = runAllowFailure(['plan', 'apply', deletePreview.client.planRef, '--json']);
assert.equal(refusedDelete.status, 4);
assert.equal(refusedDelete.envelope.error.code, 'plan-confirmation-required');
assert.equal(readTask(createdId).identity.operonId, createdId);
assert.equal(run(['plan', 'discard', deletePreview.client.planRef, '--json']).result.discarded, true);

const actualDelete = previewConvenience('task', 'delete', {
	contractVersion: 1,
	kind: 'mutation-intent',
	target: {
		operonId: secondaryTask.identity.operonId,
		locator: secondaryTask.locator,
	},
	spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
});
const deletePlan = run(['plan', 'show', actualDelete.client.planRef, '--json']).result.plan;
assert.equal(deletePlan.receiptTargetDigest, undefined);
const deleted = run([
	'plan',
	'apply',
	actualDelete.client.planRef,
	'--confirm',
	deletePlan.confirmationToken,
	'--json',
]);
assert.equal(deleted.result.status, 'applied');
const missingDeletedTask = runAllowFailure([
	'task',
	'get',
	'--profile',
	'meeting',
	'--id',
	secondaryId,
	'--json',
]);
assert.equal(missingDeletedTask.status, 5);

const rawApplyRefusal = runAllowFailure(['mutation', 'apply', '--input', '-', '--json'], {});
assert.equal(rawApplyRefusal.status, 4);
assert.equal(rawApplyRefusal.envelope.error.code, 'raw-mutation-apply-disabled');

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: manifest.result.package,
	profile: setup.result.profile.name,
	contextProjection: creationContext.result.projection,
	ambiguousCandidates: ambiguous.result.candidates.length,
	createdOperonId: createdId,
	update: 'applied',
	transition: 'applied',
	timer: 'start-stop-applied',
	reminder: 'add-replace-remove-applied',
	relocation: 'applied',
	conversion: 'round-trip-applied',
	recovery: recovered.result.status,
	stalePlan: 'refused',
	destructiveWithoutConfirmation: 'refused',
	capabilityUnavailable: 'refused',
	delete: 'confirmed-and-applied',
}, null, 2)}\n`);

function previewConvenience(group, operation, input) {
	const envelope = runRuntime(
		[group, operation, '--profile', 'meeting'],
		input,
	);
	assert.equal(envelope.result.ok, true);
	assert.match(envelope.client.planRef, /^[A-Za-z0-9_-]{32}$/u);
	return envelope;
}

function applyConvenience(group, operation, input, options = {}) {
	const preview = previewConvenience(group, operation, input);
	const plan = run(['plan', 'show', preview.client.planRef, '--json']).result.plan;
	const applied = run([
		'plan',
		'apply',
		preview.client.planRef,
		...(options.destructive ? ['--confirm', plan.confirmationToken] : []),
		'--json',
	]);
	assert.equal(applied.ok, true);
	assert.ok(['applied', 'already-applied'].includes(applied.result.status));
	return applied;
}

function requireCapability(items, capability) {
	const item = items.find(candidate => candidate.id === capability);
	if (!item || !['available', 'degraded'].includes(item.availability)) {
		throw new Error(`CAPABILITY_UNAVAILABLE:${capability}`);
	}
	return item;
}

function readTask(operonId) {
	const envelope = run(['task', 'get', '--profile', 'meeting', '--id', operonId, '--json']);
	assert.equal(envelope.ok, true);
	assert.equal(envelope.result.ok, true);
	return envelope.result.task;
}

function readTaskWithReminderItems(operonId) {
	const envelope = runRuntime(
		['task', 'get', '--profile', 'meeting'],
		{
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'task-get',
			selector: { kind: 'operon-id', operonId },
			include: ['reminder-items'],
			consistency: 'live-verified',
		},
	);
	assert.equal(envelope.result.ok, true);
	assert.ok(Array.isArray(envelope.result.task.reminderItems));
	return envelope.result.task;
}

function runRuntime(args, input) {
	const result = runAllowFailure([...args, '--input', '-', '--json'], input);
	assert.equal(result.status, 0, result.stderr || JSON.stringify(result.envelope));
	return result.envelope;
}

function run(args) {
	const result = runAllowFailure(args);
	assert.equal(result.status, 0, result.stderr || JSON.stringify(result.envelope));
	return result.envelope;
}

function runAllowFailure(args, input) {
	const child = spawnSync(executable, args, {
		env,
		encoding: 'utf8',
		input: input === undefined ? undefined : `${JSON.stringify(input)}\n`,
	});
	assert.equal(child.error, undefined);
	assert.ok(child.stdout.trim().length > 0, child.stderr);
	return {
		status: child.status,
		envelope: JSON.parse(child.stdout),
		stderr: child.stderr,
	};
}
