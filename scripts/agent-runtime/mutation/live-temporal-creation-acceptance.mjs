#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPORAL_CREATE_KEYS = [
	'reminderDatetimes',
	'reminderRules',
	'repeat',
	'datetimeRepeatEnd',
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
const requestedVault = process.argv[2] ?? path.join(
	expectedTempRoot,
	'operon-agent-runtime-phase1-v1',
);
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true, 'Live acceptance target must be a directory.');
assert.equal(vaultStat.isSymbolicLink(), false, 'Live acceptance target cannot be a symlink.');
assert.equal(path.dirname(vaultPath), expectedTempRoot, 'Live acceptance target must stay in temp.');
assert.match(path.basename(vaultPath), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);

const cliConfigRoot = mkdtempSync(path.join(tmpdir(), 'operon-a4-temporal-cli-'));
process.on('exit', () => {
	rmSync(cliConfigRoot, { recursive: true, force: true });
});
const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const settingsPath = path.join(vaultPath, '.obsidian/plugins/operon/data.json');
const repeatSeriesPath = path.join(
	vaultPath,
	'.obsidian/plugins/operon/state/repeat-series.json',
);

const manifest = runCli(['manifest']);
assert.equal(manifest.ok, true, 'Packaged CLI manifest must be readable.');
assert.equal(
	manifest.result?.convenienceContracts?.['task.create']?.temporalCreateVersion,
	1,
	'Packaged task.create must advertise temporal create v1.',
);
assert.deepEqual(
	manifest.result.convenienceContracts['task.create'].temporalCreateKeys,
	TEMPORAL_CREATE_KEYS,
	'Packaged task.create must advertise the exact temporal key order.',
);

const catalog = runCli(['catalog']);
assert.equal(catalog.ok, true, 'Live Runtime Catalog must be readable.');
assert.equal(
	catalog.result?.policies?.creation?.temporalCreateVersion,
	1,
	'Live Runtime Catalog must advertise temporal create v1.',
);
assert.deepEqual(
	catalog.result.policies.creation.temporalCreateKeys,
	TEMPORAL_CREATE_KEYS,
	'Live Runtime Catalog must advertise the exact temporal key order.',
);

const unique = randomUUID();
const description = `A4 compact temporal ${unique}`;
const compactInput = [
	`file "${description}"`,
	'dateDue::"2099-01-15"',
	'reminderDatetimes::"2099-01-14T09:00:00"',
	'reminderRules::"dateDue.30m"',
	'repeat::"mode=schedule|freq=day|interval=1"',
	'datetimeRepeatEnd::"2099-02-15T23:59:00"',
].join(' ');
const beforePreview = {
	settings: digestFileOrAbsent(settingsPath),
	repeatSeries: digestFileOrAbsent(repeatSeriesPath),
};
const preview = runCli(
	['task', 'create', '--input-format', 'compact', '--input', '-'],
	compactInput,
);
assert.equal(preview.ok, true, 'Compact create preview transport must succeed.');
assert.equal(preview.result?.ok, true, 'Compact create must return a sealed preview.');
assert.match(preview.client?.planRef, /^[A-Za-z0-9_-]{32}$/u);
assert.equal(
	digestFileOrAbsent(settingsPath),
	beforePreview.settings,
	'Preview must not modify canonical settings.',
);
assert.equal(
	digestFileOrAbsent(repeatSeriesPath),
	beforePreview.repeatSeries,
	'Preview must not modify repeat-series state.',
);

const planRef = preview.client.planRef;
const plan = preview.result.plan;
assert.equal(plan.createEffects.length, 1, 'Preview must seal exactly one created task.');
const effect = plan.createEffects[0];
assert.ok(effect.repeatSeriesId, 'Temporal preview must seal a repeat-series ID.');
const targetPath = path.join(vaultPath, effect.locator.filePath);
assert.equal(existsSync(targetPath), false, 'Randomized target must start absent.');
const sourceResource = {
	resourceKind: 'task-source',
	resourceKey: effect.locator.filePath,
};
const repeatResource = {
	resourceKind: 'repeat-series',
	resourceKey: effect.repeatSeriesId,
};
assert.equal(
	plan.atomicGroups.some(group => (
		group.resources.some(resource => sameResource(resource, sourceResource))
		&& group.resources.some(resource => sameResource(resource, repeatResource))
	)),
	true,
	'Task source and repeat-series state must be sealed in one atomic group.',
);
assert.equal(
	plan.affectedResources.some(resource => sameResource(resource, repeatResource)),
	true,
	'The sealed plan must include repeat-series revision state.',
);
assert.equal(existsSync(targetPath), false, 'Preview must not create the target source.');

const planFile = path.join(cliConfigRoot, 'plans', `${planRef}.json`);
const storedPlan = JSON.parse(readFileSync(planFile, 'utf8'));
const applied = runCli(['plan', 'apply', planRef]);
assert.equal(applied.ok, true, 'Temporal plan apply transport must succeed.');
assert.equal(applied.result?.status, 'applied', 'The first temporal apply must commit.');
assert.equal(applied.result?.postflight?.status, 'verified');
assert.equal(existsSync(targetPath), true, 'Temporal apply must create the source file.');

const createdTask = readTask(effect.operonId);
assert.equal(createdTask.representation, 'file');
assert.equal(createdTask.locator.filePath, effect.locator.filePath);
assert.equal(createdTask.dates.due, '2099-01-15');
assert.equal(createdTask.recurrence.repeating, true);
assert.equal(createdTask.recurrence.seriesId, effect.repeatSeriesId);
assert.deepEqual(
	createdTask.reminderItems?.map(item => [item.collection, item.expectedValue]),
	[
		['reminderDatetimes', '2099-01-14T09:00:00'],
		['reminderRules', 'dateDue.30m'],
	],
);
assert.match(createdTask.sourceMarkdown, new RegExp(effect.repeatSeriesId, 'u'));
assert.match(createdTask.sourceMarkdown, /mode=schedule\|freq=day\|interval=1/u);
assert.match(createdTask.sourceMarkdown, /2099-02-15T23:59:00/u);

const repeatSeriesData = JSON.parse(readFileSync(repeatSeriesPath, 'utf8'));
const repeatSeriesEntry = repeatSeriesData.series?.[effect.repeatSeriesId];
assert.ok(repeatSeriesEntry, 'Temporal apply must persist the sealed repeat-series entry.');
assert.equal(repeatSeriesEntry.seriesId, effect.repeatSeriesId);
assert.equal(repeatSeriesEntry.sourceTaskId, effect.operonId);
assert.equal(repeatSeriesEntry.sourceFormat, 'yaml');
assert.ok(
	repeatSeriesEntry.baseTemporalTemplate,
	'Repeat-series state must preserve the base temporal template.',
);

const afterApply = {
	source: digestFileOrAbsent(targetPath),
	repeatSeries: digestFileOrAbsent(repeatSeriesPath),
};
storedPlan.applyRequest = {
	contractVersion: 1,
	requestId: `a4-temporal-recover-${randomUUID()}`,
	kind: 'mutation-apply',
	plan: storedPlan.plan,
	authorization: {
		basis: 'user-explicit-request',
		reason: 'A4 same-plan recovery acceptance.',
	},
	idempotencyKey: storedPlan.idempotencyKey,
	acknowledgements: [],
};
writeFileSync(planFile, `${JSON.stringify(storedPlan, null, 2)}\n`, { mode: 0o600 });
chmodSync(planFile, 0o600);
const recovered = runCli(['plan', 'recover', planRef]);
assert.equal(recovered.ok, true, 'Same-plan recovery transport must succeed.');
assert.equal(
	recovered.result?.status,
	'already-applied',
	'Same-plan recovery must replay the durable receipt.',
);
assert.equal(recovered.result?.postflight?.status, 'receipt-replay');
assert.equal(
	digestFileOrAbsent(targetPath),
	afterApply.source,
	'Same-plan recovery must not rewrite the task source.',
);
assert.equal(
	digestFileOrAbsent(repeatSeriesPath),
	afterApply.repeatSeries,
	'Same-plan recovery must not rewrite repeat-series state.',
);
assert.equal(existsSync(planFile), false, 'Successful recovery must discard the recovered plan.');

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vault: path.basename(vaultPath),
	manifestGate: true,
	catalogGate: true,
	previewWasReadOnly: true,
	createdOperonId: effect.operonId,
	repeatSeriesId: effect.repeatSeriesId,
	sourceAndStateVerified: true,
	recoveryStatus: recovered.result.status,
	recoveryWasWriteFree: true,
}, null, 2)}\n`);

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a4-temporal-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['source-markdown', 'reminder-items'],
	});
	assert.equal(result.result?.ok, true, `Task ${operonId} must be live-readable.`);
	return result.result.task;
}

function runCli(command, input) {
	const isLocalCommand = command[0] === 'manifest' || command[0] === 'plan';
	const hasInputFlag = command.includes('--input');
	const inputArguments = input === undefined || hasInputFlag ? [] : ['--input', '-'];
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(isLocalCommand ? [] : ['--vault', vaultPath]),
			...(command[0] === 'plan' && ['apply', 'recover'].includes(command[1])
				? ['--timeout-ms', '30000']
				: []),
			...inputArguments,
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CONFIG_HOME: cliConfigRoot,
			},
			...(input === undefined
				? {}
				: { input: typeof input === 'string' ? `${input}\n` : `${JSON.stringify(input)}\n` }),
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	return JSON.parse(result.stdout);
}

function digestFileOrAbsent(filePath) {
	if (!existsSync(filePath)) return 'absent';
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sameResource(left, right) {
	return left.resourceKind === right.resourceKind && left.resourceKey === right.resourceKey;
}
