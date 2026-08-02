#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const vaultPath = realpathSync(process.argv[2] ?? '/private/tmp/operon-agent-runtime-phase1-v1');
const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const dailyRelativePath = 'Daily/2026-01-15.md';
const cliConfigRoot = mkdtempSync(path.join(tmpdir(), 'operon-phase8-warm-cli-'));
process.on('exit', () => {
	rmSync(cliConfigRoot, { recursive: true, force: true });
});
const samples = 20;
const timings = Object.fromEntries(
	['update', 'reminder', 'transition', 'timer', 'relocation', 'conversion', 'delete']
		.map(family => [family, { preview: [], apply: [] }]),
);

// One unmeasured live call warms the portable client, native handler, Runtime,
// catalog and exact-task projection before any sample is retained.
readTask('inln001', 'warmup');

for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-update-${index}`);
	record('update', mutate({
		name: `warm-update-${index}`,
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: exactTarget(task),
		spec: {
			operation: 'update',
			changes: [{
				field: 'description',
				valueType: 'text',
				value: `Warm update ${index % 2}`,
			}],
		},
	}));
}

for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-reminder-${index}`);
	record('reminder', mutate({
		name: `warm-reminder-${index}`,
		capability: 'tasks.reminder.preview',
		mutationKind: 'task.reminder-item',
		target: exactTarget(task),
		spec: {
			operation: 'add',
			collection: 'reminderDatetimes',
			value: `2027-01-${String(index + 1).padStart(2, '0')}T09:00:00`,
		},
	}));
}

for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-transition-${index}`);
	const targetStatusId = index % 2 === 0 ? 'st_fixture_done' : 'st_fixture_active';
	record('transition', mutate({
		name: `warm-transition-${index}`,
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		target: exactTarget(task),
		spec: {
			operation: 'transition',
			targetStatusId,
			expectedStatusId: task.workflow.status.id,
		},
	}));
}

for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-timer-${index}`);
	const start = index % 2 === 0;
	const active = readTimer(`warm-timer-state-${index}`).active;
	record('timer', mutate({
		name: `warm-timer-${index}`,
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		...(start ? { target: exactTarget(task) } : {}),
		spec: start
			? { operation: 'start' }
			: { operation: 'stop', expectedActiveStart: active?.start },
	}));
}

for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-relocation-${index}`);
	assert.equal(task.locator.representation, 'inline');
	const destinationLine = task.locator.lineNumber === 1 ? 2 : 1;
	record('relocation', mutate({
		name: `warm-relocation-${index}`,
		capability: 'tasks.inline.relocate.preview',
		mutationKind: 'task.inline-relocate',
		target: exactTarget(task),
		spec: relocationSpec(destinationLine),
	}));
}

const warmConversionPath = 'Tasks/Warm Conversion.md';
for (let index = 0; index < samples; index += 1) {
	const task = readTask('inln001', `warm-conversion-${index}`);
	const inlineToFile = task.representation === 'inline';
	record('conversion', mutate({
		name: `warm-conversion-${index}`,
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: exactTarget(task),
		spec: inlineToFile
			? {
				operation: 'convert',
				from: 'inline',
				to: 'file',
				templateId: 'folder-file-task-template:Templates/Fixture Task.md',
				targetPath: warmConversionPath,
			}
			: {
				operation: 'convert',
				from: 'file',
				to: 'inline',
				target: { mode: 'configured-target', filePath: 'Warm/Conversion Target.md' },
			},
		destructive: !inlineToFile,
	}));
}

for (let index = 0; index < samples; index += 1) {
	const operonId = `delw${String(index).padStart(3, '0')}`;
	const task = readTask(operonId, `warm-delete-${index}`);
	record('delete', mutate({
		name: `warm-delete-${index}`,
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: exactTarget(task),
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
		destructive: true,
	}));
}

const performance = {};
for (const [family, familyTimings] of Object.entries(timings)) {
	assert.equal(familyTimings.preview.length, samples);
	assert.equal(familyTimings.apply.length, samples);
	const previewHandlerP95 = percentile(familyTimings.preview, 'handlerMs');
	const previewTotalP95 = percentile(familyTimings.preview, 'totalMs');
	const applyHandlerP95 = percentile(familyTimings.apply, 'handlerMs');
	const applyTotalP95 = percentile(familyTimings.apply, 'totalMs');
	const applyLimit = ['relocation', 'conversion', 'delete'].includes(family) ? 3_000 : 2_000;
	assert.ok(previewHandlerP95 < 100, `${family} warm preview p95 exceeded 100 ms.`);
	assert.ok(applyHandlerP95 < applyLimit, `${family} warm apply p95 exceeded ${applyLimit} ms.`);
	performance[family] = {
		samples,
		previewHandlerP95,
		previewTotalP95,
		applyHandlerP95,
		applyTotalP95,
	};
}

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	runtimeSession: 'single-warm-session',
	samplesPerFamily: samples,
	performance,
}, null, 2)}\n`);

function mutate({
	name,
	capability,
	mutationKind,
	target,
	spec,
	destructive = false,
}) {
	const idempotencyKey = `phase8-${name}-${randomUUID()}`;
	const preview = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `phase8-${name}-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase8-warm-benchmark',
		idempotencyKey,
		capability,
		mutationKind,
		...(target ? { target } : {}),
		spec,
		authorization: {
			basis: 'user-explicit-request',
			reason: `Phase 8 warm ${name} preview.`,
		},
	});
	assert.equal(preview.result?.ok, true, `${name} preview must succeed.`);
	const plan = preview.result.plan;
	assert.equal(typeof preview.client?.planRef, 'string', `${name} preview must persist a plan reference.`);
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
	const apply = runCli([
		'plan',
		'apply',
		preview.client.planRef,
		...(confirmationToken ? ['--confirm', confirmationToken] : []),
	]);
	assert.equal(apply.result?.status, 'applied', `${name} apply must succeed.`);
	return { preview: preview.timing, apply: apply.timing };
}

function record(family, result) {
	timings[family].preview.push(result.preview);
	timings[family].apply.push(result.apply);
}

function relocationSpec(destinationLineNumber) {
	return {
		operation: 'relocate-inline',
		destination: {
			locator: {
				representation: 'inline',
				filePath: dailyRelativePath,
				lineNumber: destinationLineNumber,
			},
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
	});
	assert.equal(result.result?.ok, true);
	return result.result.task;
}

function readTimer(suffix) {
	const result = runCli(['timer', 'get'], undefined, suffix);
	assert.equal(result.result?.ok, true);
	return result.result.state;
}

function exactTarget(task) {
	return { operonId: task.identity.operonId, locator: task.locator };
}

function runCli(command, request, requestId) {
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
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return JSON.parse(result.stdout);
}

function percentile(values, field) {
	const sorted = values.map(value => value[field]).sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}
