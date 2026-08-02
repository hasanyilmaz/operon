#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

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
const cliConfigRoot = mkdtempSync(path.join(tmpdir(), 'operon-phase11-creation-cli-'));
process.on('exit', () => {
	rmSync(cliConfigRoot, { recursive: true, force: true });
});

const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const dailyPath = path.join(vaultPath, 'Daily/2026-01-15.md');
const fileTaskPath = path.join(vaultPath, 'Tasks/Phase 7 synthetic child.md');
const settingsPath = path.join(vaultPath, '.obsidian/plugins/operon/data.json');
const before = {
	daily: digestFile(dailyPath),
	settings: digestFile(settingsPath),
	fileTaskExists: existsSync(fileTaskPath),
};
assert.equal(before.fileTaskExists, false, 'Sanitized File Task target must start absent.');
const existingParentBefore = readTask('inln001', 'phase7-parent-before');
const existingDependencyBefore = readTask('file001', 'phase11-dependency-before');

const idempotencyKey = `phase7-sanitized-${randomUUID()}`;
const previewRequest = {
	contractVersion: 1,
	requestId: `phase7-preview-${randomUUID()}`,
	kind: 'mutation-preview',
	clientInstanceId: 'phase7-live-acceptance',
	idempotencyKey,
	capability: 'tasks.create.preview',
	mutationKind: 'task.create',
	spec: {
		operation: 'create',
		items: [
			{
				itemRef: 'parent-inline',
				description: 'Phase 7 synthetic parent',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Daily/2026-01-15.md',
				},
				fields: [{
					kind: 'custom',
					field: 'fixtureTopic',
					valueType: 'text',
					value: 'Architecture',
				}],
				tags: ['phase7', 'synthetic'],
				statusId: 'st_fixture_inbox',
				priorityId: 'pr_fixture_p2',
				parent: { kind: 'existing', operonId: 'inln001' },
			},
			{
				itemRef: 'child-file',
				description: 'Phase 7 synthetic child',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Phase 7 synthetic child.md',
				},
				fields: [{
					kind: 'custom',
					field: 'fixtureTopic',
					valueType: 'text',
					value: 'Architecture',
				}],
				tags: ['phase7', 'synthetic'],
				statusId: 'st_fixture_active',
				priorityId: 'pr_fixture_p1',
				parent: { kind: 'created', itemRef: 'parent-inline' },
				related: [{ kind: 'existing', operonId: 'file001' }],
				dependencies: [{
					relation: 'blocked-by',
					target: { kind: 'created', itemRef: 'parent-inline' },
				}, {
					relation: 'blocks',
					target: { kind: 'existing', operonId: 'file001' },
				}],
				bodyMarkdown: '# Acceptance\n\nContract parity and sanitized-vault verification.',
			},
		],
	},
	authorization: {
		basis: 'user-explicit-request',
		reason: 'Phase 7 sanitized live acceptance.',
	},
};

const preview = runCli(['mutation', 'preview'], previewRequest);
assert.equal(preview.ok, true, 'Mutation preview transport must succeed.');
assert.equal(preview.result?.ok, true, 'Mutation preview must return a sealed plan.');
assert.equal(digestFile(dailyPath), before.daily, 'Preview must not modify the inline source.');
assert.equal(digestFile(settingsPath), before.settings, 'Preview must not modify canonical settings.');
assert.equal(existsSync(fileTaskPath), false, 'Preview must not create the File Task.');

const plan = preview.result.plan;
assert.equal(plan.createEffects.length, 2);
assert.match(preview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
assert.match(
	plan.predictedEffects.find(
		effect => effect.resourceKey === existingDependencyBefore.locator.filePath,
	)?.summary ?? '',
	/reciprocal dependency target/u,
	'Preview must explain the reciprocal write to the existing dependency target.',
);
const applied = runCli(['plan', 'apply', preview.client.planRef]);
assert.equal(applied.ok, true, 'Mutation apply transport must succeed.');
assert.equal(applied.result?.status, 'applied', 'The first apply must commit.');
assert.equal(digestFile(settingsPath), before.settings, 'Mutation apply must not modify canonical settings.');
assert.equal(existsSync(fileTaskPath), true, 'Mutation apply must create the File Task.');

const inlineEffect = plan.createEffects.find(effect => effect.itemRef === 'parent-inline');
const fileEffect = plan.createEffects.find(effect => effect.itemRef === 'child-file');
assert.ok(inlineEffect && fileEffect, 'Both sealed create effects must be present.');
const dailyContent = readFileSync(dailyPath, 'utf8');
const fileTaskContent = readFileSync(fileTaskPath, 'utf8');
assert.equal(countOccurrences(dailyContent, inlineEffect.operonId), 1);
assert.equal(countOccurrences(fileTaskContent, fileEffect.operonId), 1);
assert.ok(fileTaskContent.includes(inlineEffect.operonId), 'Created child must reference the created parent.');
assert.ok(fileTaskContent.includes('file001'), 'Created child must preserve the exact related task reference.');
assert.ok(
	dailyContent.includes(fileEffect.operonId),
	'Created dependency owner must preserve the reciprocal blocking reference.',
);
assert.match(fileTaskContent, /# Acceptance\n\nContract parity and sanitized-vault verification\./u);
assert.deepEqual(fileEffect.resolvedDependencies, [{
	relation: 'blocked-by',
	operonId: inlineEffect.operonId,
}, {
	relation: 'blocks',
	operonId: 'file001',
}]);
assert.equal(fileEffect.bodyMarkdownSummary?.utf8Bytes, 63);
const existingParentAfter = readTask('inln001', 'phase7-parent-after');
assert.notEqual(
	existingParentAfter.datetimes.modified,
	existingParentBefore.datetimes.modified,
	'The exact existing parent modified timestamp must advance.',
);
const createdInline = readTask(inlineEffect.operonId, 'phase7-created-inline');
const createdFile = readTask(fileEffect.operonId, 'phase7-created-file');
const existingDependencyAfter = readTask('file001', 'phase11-dependency-after');
assert.equal(createdInline.workflow.status.id, 'st_fixture_inbox');
assert.equal(createdInline.priority.id, 'pr_fixture_p2');
assert.equal(createdInline.customFields.fixtureTopic, 'Architecture');
assert.match(createdInline.sourceMarkdown, /(?:^|\s)#phase7(?:\s|$)/u);
assert.match(createdInline.sourceMarkdown, /(?:^|\s)#synthetic(?:\s|$)/u);
assert.equal(createdFile.workflow.status.id, 'st_fixture_active');
assert.equal(createdFile.priority.id, 'pr_fixture_p1');
assert.equal(createdFile.customFields.fixtureTopic, 'Architecture');
assert.match(createdFile.sourceMarkdown, /tags:\s*\n(?:\s+-\s+\S+\s*\n)+/u);
assert.match(createdFile.sourceMarkdown, /(?:^|\n)\s+-\s+phase7\s*(?:\n|$)/u);
assert.match(createdFile.sourceMarkdown, /(?:^|\n)\s+-\s+synthetic\s*(?:\n|$)/u);
assert.notEqual(
	existingDependencyAfter.datetimes.modified,
	existingDependencyBefore.datetimes.modified,
	'The exact existing dependency target modified timestamp must advance.',
);
assert.match(
	existingDependencyAfter.sourceMarkdown,
	new RegExp(fileEffect.operonId, 'u'),
	'The existing dependency target must preserve the reciprocal blocked-by reference.',
);

const configuredKey = `phase7-configured-${randomUUID()}`;
const configuredPreview = runCli(['mutation', 'preview'], {
	contractVersion: 1,
	requestId: `phase7-configured-preview-${randomUUID()}`,
	kind: 'mutation-preview',
	clientInstanceId: 'phase7-live-acceptance',
	idempotencyKey: configuredKey,
	capability: 'tasks.create.preview',
	mutationKind: 'task.create',
	spec: {
		operation: 'create',
		items: [{
			itemRef: 'configured-child',
			description: 'Phase 7 configured child',
			target: { mode: 'configured-default' },
			fields: [],
			parent: { kind: 'existing', operonId: inlineEffect.operonId },
		}],
	},
	authorization: {
		basis: 'user-explicit-request',
		reason: 'Verify configured target placement and inherited tags.',
	},
});
assert.equal(configuredPreview.result?.ok, true);
const configuredPlan = configuredPreview.result.plan;
assert.match(configuredPreview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
const configuredApplied = runCli(['plan', 'apply', configuredPreview.client.planRef]);
assert.equal(configuredApplied.result?.status, 'applied');
const configuredEffect = configuredPlan.createEffects[0];
assert.equal(configuredEffect.locator.filePath, 'Daily/2026-01-15.md');
const configuredTask = readTask(configuredEffect.operonId, 'phase7-configured-child');
assert.match(
	configuredTask.sourceMarkdown,
	/(?:^|\s)#phase7(?:\s|$)/u,
	'Omitted tags must inherit from the parent.',
);
assert.match(
	configuredTask.sourceMarkdown,
	/(?:^|\s)#synthetic(?:\s|$)/u,
	'Omitted tags must inherit from the parent.',
);
const configuredDailyLines = readFileSync(dailyPath, 'utf8').split('\n');
assert.equal(
	configuredDailyLines.findIndex(line => line.includes(configuredEffect.operonId)),
	configuredDailyLines.findIndex(line => line.includes(inlineEffect.operonId)) + 1,
	'Configured inline child must be placed directly below its inline parent.',
);
const aggregateParentLine = configuredDailyLines.find(line => line.includes(inlineEffect.operonId)) ?? '';
assert.match(
	aggregateParentLine,
	/\{\{directSubtaskCount:: 2\}\}/u,
	'Creation postflight must await canonical hierarchy aggregate reconciliation.',
);

const localConfiguredKey = `phase7-local-configured-${randomUUID()}`;
const localConfiguredPreview = runCli(['mutation', 'preview'], {
	contractVersion: 1,
	requestId: `phase7-local-configured-preview-${randomUUID()}`,
	kind: 'mutation-preview',
	clientInstanceId: 'phase7-live-acceptance',
	idempotencyKey: localConfiguredKey,
	capability: 'tasks.create.preview',
	mutationKind: 'task.create',
	spec: {
		operation: 'create',
		items: [
			{
				itemRef: 'local-configured-parent',
				description: 'Phase 7 local configured parent',
				target: { representation: 'inline', mode: 'configured-default' },
				fields: [],
				tags: ['local-configured'],
			},
			{
				itemRef: 'local-configured-child',
				description: 'Phase 7 local configured child',
				target: { representation: 'inline', mode: 'configured-default' },
				fields: [],
				parent: { kind: 'created', itemRef: 'local-configured-parent' },
			},
		],
	},
	authorization: {
		basis: 'user-explicit-request',
		reason: 'Verify request-local configured parent target policy.',
	},
});
assert.equal(localConfiguredPreview.result?.ok, true);
const localConfiguredPlan = localConfiguredPreview.result.plan;
assert.match(localConfiguredPreview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
const localConfiguredApplied = runCli(['plan', 'apply', localConfiguredPreview.client.planRef]);
assert.equal(localConfiguredApplied.result?.status, 'applied');
const localParentEffect = localConfiguredPlan.createEffects.find(
	effect => effect.itemRef === 'local-configured-parent',
);
const localChildEffect = localConfiguredPlan.createEffects.find(
	effect => effect.itemRef === 'local-configured-child',
);
assert.ok(localParentEffect && localChildEffect);
assert.equal(localParentEffect.locator.filePath, localChildEffect.locator.filePath);
const localConfiguredLines = readFileSync(
	path.join(vaultPath, localParentEffect.locator.filePath),
	'utf8',
).split('\n');
assert.equal(
	localConfiguredLines.findIndex(line => line.includes(localChildEffect.operonId)),
	localConfiguredLines.findIndex(line => line.includes(localParentEffect.operonId)) + 1,
	'Request-local configured child must be placed directly below its created inline parent.',
);
assert.match(
	localConfiguredLines.find(line => line.includes(localChildEffect.operonId)) ?? '',
	/#local-configured(?:\s|$)/u,
	'Request-local configured child must inherit omitted tags from its created parent.',
);

const mixedConfiguredKey = `phase7-mixed-configured-${randomUUID()}`;
const mixedConfiguredPreview = runCli(['mutation', 'preview'], {
	contractVersion: 1,
	requestId: `phase7-mixed-configured-preview-${randomUUID()}`,
	kind: 'mutation-preview',
	clientInstanceId: 'phase7-live-acceptance',
	idempotencyKey: mixedConfiguredKey,
	capability: 'tasks.create.preview',
	mutationKind: 'task.create',
	spec: {
		operation: 'create',
		items: [
			{
				itemRef: 'mixed-file-parent',
				description: 'Phase 7 mixed runtime parent',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Phase 7 mixed runtime parent.md',
				},
				fields: [],
				tags: ['mixed-runtime'],
				bodyMarkdown: '# Mixed parent body\n\nSeed content.',
			},
			{
				itemRef: 'mixed-inline-child',
				description: 'Phase 7 mixed runtime child',
				target: { representation: 'inline', mode: 'configured-default' },
				fields: [],
				parent: { kind: 'created', itemRef: 'mixed-file-parent' },
			},
			{
				itemRef: 'mixed-inline-grandchild',
				description: 'Phase 11 mixed runtime grandchild',
				target: { representation: 'inline', mode: 'configured-default' },
				fields: [],
				parent: { kind: 'created', itemRef: 'mixed-inline-child' },
			},
		],
	},
	authorization: {
		basis: 'user-explicit-request',
		reason: 'Verify mixed File Task parent and request-local inline child postflight.',
	},
});
assert.equal(mixedConfiguredPreview.result?.ok, true);
const mixedConfiguredPlan = mixedConfiguredPreview.result.plan;
assert.match(mixedConfiguredPreview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
const mixedConfiguredApplied = runCli(['plan', 'apply', mixedConfiguredPreview.client.planRef]);
assert.equal(mixedConfiguredApplied.result?.status, 'applied');
const mixedParentEffect = mixedConfiguredPlan.createEffects.find(
	effect => effect.itemRef === 'mixed-file-parent',
);
const mixedChildEffect = mixedConfiguredPlan.createEffects.find(
	effect => effect.itemRef === 'mixed-inline-child',
);
const mixedGrandchildEffect = mixedConfiguredPlan.createEffects.find(
	effect => effect.itemRef === 'mixed-inline-grandchild',
);
assert.ok(mixedParentEffect && mixedChildEffect && mixedGrandchildEffect);
const mixedParentTask = readTask(mixedParentEffect.operonId, 'phase7-mixed-parent');
const mixedChildTask = readTask(mixedChildEffect.operonId, 'phase7-mixed-child');
const mixedGrandchildTask = readTask(
	mixedGrandchildEffect.operonId,
	'phase11-mixed-grandchild',
);
assert.equal(mixedParentTask.representation, 'file');
assert.equal(mixedChildTask.representation, 'inline');
assert.equal(mixedChildTask.locator.filePath, mixedParentTask.locator.filePath);
assert.equal(mixedChildTask.relationships.parentOperonId, mixedParentEffect.operonId);
assert.equal(mixedGrandchildTask.locator.filePath, mixedParentTask.locator.filePath);
assert.equal(mixedGrandchildTask.relationships.parentOperonId, mixedChildEffect.operonId);
assert.match(mixedParentTask.sourceMarkdown, /# Mixed parent body\n\nSeed content\./u);
assert.match(mixedParentTask.sourceMarkdown, new RegExp(mixedChildEffect.operonId, 'u'));
assert.match(mixedParentTask.sourceMarkdown, new RegExp(mixedGrandchildEffect.operonId, 'u'));

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vault: path.basename(vaultPath),
	previewHandlerMs: preview.timing.handlerMs,
	applyHandlerMs: applied.timing.handlerMs,
	createdRepresentations: plan.createEffects.map(effect => effect.locator.representation).sort(),
	atomicGroups: applied.result.groupResults.length,
	settingsUnchanged: true,
	previewWasReadOnly: true,
	configuredTarget: configuredEffect.locator,
	configuredTagsInherited: true,
	localConfiguredParentPolicy: true,
	mixedFileParentInlineChildVerified: true,
	existingDependencyReciprocalWriteVerified: true,
	hierarchyAggregatesVerified: true,
}, null, 2)}\n`);

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

function runCli(command, request) {
	const isLocalPlanCommand = command[0] === 'plan';
	const requestArguments = request === undefined ? [] : ['--input', '-'];
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(isLocalPlanCommand ? [] : ['--vault', vaultPath]),
			...(isLocalPlanCommand && ['apply', 'recover'].includes(command[1])
				? ['--timeout-ms', '30000']
				: []),
			...requestArguments,
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CONFIG_HOME: cliConfigRoot,
			},
			...(request === undefined ? {} : { input: `${JSON.stringify(request)}\n` }),
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	return JSON.parse(result.stdout);
}

function digestFile(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function countOccurrences(content, value) {
	return content.split(value).length - 1;
}
