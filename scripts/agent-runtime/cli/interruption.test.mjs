import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
	console.log(
		'Windows process-level interruption acceptance requires the native Ctrl-Break and authenticated broker harness; broker and session interruption contracts are covered separately.',
	);
	process.exit(0);
}

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-interruption-'));
const vault = path.join(temporaryRoot, 'vault');
const fakeObsidian = path.join(temporaryRoot, 'fake-obsidian.mjs');
const marker = path.join(temporaryRoot, 'invocation.json');
const configRoot = path.join(temporaryRoot, 'config');
await writeFile(path.join(temporaryRoot, '.keep'), '');
await mkdir(vault);
await mkdir(path.join(vault, '.obsidian', 'plugins', 'operon'), { recursive: true });
await writeFile(
	path.join(vault, '.obsidian', 'plugins', 'operon', 'manifest.json'),
	JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' }),
);
await writeFile(fakeObsidian, `#!/usr/bin/env node
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.on('SIGTERM', () => process.exit(0));
if (process.argv.some(value => value.includes('mutation-apply'))) {
	const token = process.argv.find(value => value.startsWith('requestToken='))?.slice(13);
	if (token) {
		const uid = process.getuid?.();
		unlinkSync(path.join(tmpdir(), 'operon-agent-runtime-uid-' + uid, token + '.request.json'));
	}
}
writeFileSync(process.env.OPERON_CLI_INTERRUPT_MARKER, JSON.stringify(process.argv.slice(2)));
setInterval(() => undefined, 1000);
`);
await chmod(fakeObsidian, 0o755);

let child;
try {
	child = spawn(process.execPath, [
		cliPath,
		'health',
		'--vault',
		vault,
		'--obsidian-bin',
		fakeObsidian,
		'--json',
	], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			OPERON_CLI_INTERRUPT_MARKER: marker,
		},
	});
	await waitForFile(marker, 5_000);
	const args = JSON.parse(await readFile(marker, 'utf8'));
	const tokenArgument = args.find(value => value.startsWith('requestToken='));
	assert.ok(tokenArgument);
	const token = tokenArgument.slice('requestToken='.length);
	const uid = process.getuid?.();
	assert.equal(typeof uid, 'number');
	const requestPath = path.join(
		tmpdir(),
		`operon-agent-runtime-uid-${uid}`,
		`${token}.request.json`,
	);
	await stat(requestPath);
	child.kill('SIGINT');
	const exitCode = await waitForExit(child, 5_000);
	assert.equal(exitCode, 3);
	await assert.rejects(stat(requestPath), error => error?.code === 'ENOENT');

	const preDispatch = spawn(process.execPath, [cliPath, 'session', '--jsonl'], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			OPERON_CONFIG_HOME: configRoot,
		},
	});
	let preDispatchStdout = '';
	preDispatch.stdout.setEncoding('utf8');
	preDispatch.stdout.on('data', chunk => {
		preDispatchStdout += chunk;
	});
	preDispatch.stdin.write(`${JSON.stringify({
		id: 'ready',
		argv: ['version', '--json'],
	})}\n`);
	await waitForCondition(() => preDispatchStdout.includes('\n'), 5_000);
	preDispatchStdout = '';
	preDispatch.stdin.write(JSON.stringify({
		id: 'buffered-apply',
		argv: ['plan', 'apply', 'p1234567890123456789012345678901', '--json'],
	}));
	await delay(50);
	preDispatch.kill('SIGINT');
	assert.equal(await waitForExit(preDispatch, 5_000), 130);
	assert.equal(preDispatchStdout, '');

	const recoveryRecord = await createPendingPlanRecord(await realpath(vault));
	await mkdir(path.join(configRoot, 'plans'), { recursive: true, mode: 0o700 });
	await writeFile(
		path.join(configRoot, 'client-v1.json'),
		`${JSON.stringify({
			version: 1,
			clientInstanceId: recoveryRecord.clientInstanceId,
		})}\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		path.join(configRoot, 'plans', `${recoveryRecord.planRef}.json`),
		`${JSON.stringify(recoveryRecord)}\n`,
		{ mode: 0o600 },
	);
	await rm(marker, { force: true });
	const postDispatch = spawn(process.execPath, [
		cliPath,
		'plan',
		'recover',
		recoveryRecord.planRef,
		'--obsidian-bin',
		fakeObsidian,
		'--json',
	], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			OPERON_CONFIG_HOME: configRoot,
			OPERON_CLI_INTERRUPT_MARKER: marker,
		},
	});
	let postDispatchStdout = '';
	let postDispatchStderr = '';
	postDispatch.stdout.setEncoding('utf8');
	postDispatch.stderr.setEncoding('utf8');
	postDispatch.stdout.on('data', chunk => {
		postDispatchStdout += chunk;
	});
	postDispatch.stderr.on('data', chunk => {
		postDispatchStderr += chunk;
	});
	try {
		await waitForFile(marker, 5_000);
	} catch {
		throw new Error(
			`POST_DISPATCH_DID_NOT_START:${postDispatch.exitCode}:`
			+ `${postDispatchStdout}:${postDispatchStderr}`,
		);
	}
	postDispatch.kill('SIGTERM');
	assert.equal(await waitForExit(postDispatch, 5_000), 5);
	const interruptedApply = JSON.parse(postDispatchStdout);
	assert.equal(interruptedApply.recovery.required, true);
	assert.equal(interruptedApply.recovery.planRef, recoveryRecord.planRef);
	assert.equal(interruptedApply.recovery.action, 'recover-same-plan');
	const retained = JSON.parse(await readFile(
		path.join(configRoot, 'plans', `${recoveryRecord.planRef}.json`),
		'utf8',
	));
	assert.equal(retained.applyRequest.kind, 'mutation-apply');
	assert.equal(
		Date.parse(retained.recoveryExpiresAt) - Date.parse(retained.recoveryStartedAt),
		24 * 60 * 60 * 1_000,
	);
	console.log('Agent Runtime CLI interruption and mutation recovery tests passed');
} finally {
	if (child && child.exitCode === null) child.kill('SIGKILL');
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function createPendingPlanRecord(vaultPath) {
	const now = Date.now();
	const fixtures = JSON.parse(await readFile(
		path.join(pluginRoot, 'scripts', 'agent-runtime', 'contracts', 'fixtures', 'cases.json'),
		'utf8',
	));
	const applyRequest = fixtures.cases.find(
		item => item.id === 'valid-destructive-delete-apply',
	)?.value;
	assert.ok(applyRequest);
	const { plan, idempotencyKey } = applyRequest;
	const recoveryStartedAt = new Date(now).toISOString();
	return {
		version: 1,
		planRef: 'p1234567890123456789012345678901',
		vaultPath,
		vaultSha256: createHash('sha256').update(vaultPath).digest('hex'),
		clientInstanceId: plan.clientInstanceId,
		idempotencyKey,
		plan,
		createdAt: plan.createdAt,
		expiresAt: plan.expiresAt,
		applyRequest,
		recoveryStartedAt,
		recoveryExpiresAt: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
		lastOutcome: {
			status: 'outcome-unknown',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			ambiguitySource: 'group-outcome',
		},
	};
}

async function delay(ms) {
	await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCondition(predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await delay(20);
	}
	throw new Error('INTERRUPTION_CONDITION_TIMEOUT');
}

async function waitForFile(filePath, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await stat(filePath);
			return;
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	throw new Error('INTERRUPTION_MARKER_TIMEOUT');
}

async function waitForExit(processHandle, timeoutMs) {
	return await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('INTERRUPTION_EXIT_TIMEOUT')), timeoutMs);
		processHandle.once('error', error => {
			clearTimeout(timer);
			reject(error);
		});
		processHandle.once('close', code => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}
