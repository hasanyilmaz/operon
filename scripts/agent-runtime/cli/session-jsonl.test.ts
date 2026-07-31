import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import type { PublicCommandOutcomeV1 } from '../../../packages/operon-cli/src/command-line';
import {
	isJsonlSessionArgsV1,
	runJsonlSessionV1,
} from '../../../packages/operon-cli/src/session-jsonl';
import { PersistentReadTransportV1 } from '../../../packages/operon-cli/src/persistent-read-client';
import { saveOperonCliConfigV1 } from '../../../packages/operon-cli/src/config';
import {
	canonicalVaultIdentityV1,
	createCanonicalVaultFenceV1,
} from '../../../packages/operon-cli/src/protocol';

const CLOCK_OFFSET_TOLERANCE_MS = process.platform === 'win32' ? 20 : 2;

test('session route is exact and additive', () => {
	assert.equal(isJsonlSessionArgsV1(['session', '--jsonl']), true);
	assert.equal(isJsonlSessionArgsV1(['session']), false);
	assert.equal(isJsonlSessionArgsV1(['session', '--jsonl', '--json']), false);
	assert.equal(isJsonlSessionArgsV1(['version', '--json']), false);
});

test('JSONL session executes frames sequentially without shell parsing', async () => {
	const frames = [
		{ id: 'first', argv: ['version', '--json'] },
		{
			id: 2,
			argv: ['task', 'get', '--input', '-', '--json'],
			input: { description: 'one argument with spaces' },
		},
		{ id: 'third', argv: ['manifest', '--json'] },
	];
	let active = 0;
	let maxActive = 0;
	const outputModes: unknown[] = [];
	const calls: Array<{ argv: string[]; input?: string }> = [];
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([frames.map(frame => JSON.stringify(frame)).join('\n') + '\n']),
		output,
		runCommand: async (argv, ports) => {
			outputModes.push((ports as { outputMode?: unknown } | undefined)?.outputMode);
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolve => setTimeout(resolve, 2));
			calls.push({
				argv: [...argv],
				...(ports?.input ? { input: ports.input.toString('utf8') } : {}),
			});
			active -= 1;
			return localOutcome(argv[0], calls.length);
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(maxActive, 1);
	assert.deepEqual(outputModes, ['envelope-only', 'envelope-only', 'envelope-only']);
	assert.deepEqual(calls, [
		{ argv: ['version', '--json'] },
		{
			argv: ['task', 'get', '--input', '-', '--json'],
			input: '{"description":"one argument with spaces"}',
		},
		{ argv: ['manifest', '--json'] },
	]);
	assert.deepEqual(output.lines(), [
		{
			id: 'first',
			exitCode: 0,
			result: localOutcome('version', 1).envelope,
		},
		{
			id: 2,
			exitCode: 0,
			result: localOutcome('task', 2).envelope,
		},
		{
			id: 'third',
			exitCode: 0,
			result: localOutcome('manifest', 3).envelope,
		},
	]);
});

test('JSONL read group runs 2-8 allowlisted children and writes ordered child responses', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-config-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	const output = captureOutput();
	const batchCounts: number[] = [];
	let active = 0;
	let maxActive = 0;
	const transport = {
		beginBatch(count: number) {
			batchCounts.push(count);
		},
		consumeLastEvidence() {
			return 'persistent' as const;
		},
		close() {},
	};
	try {
		const exitCode = await runJsonlSessionV1({
			input: Readable.from([
				`${JSON.stringify({
					id: 'reads',
					reads: [
						{ id: 'health', argv: ['health', '--vault', vault, '--json'] },
						{
							id: 'query',
							argv: ['query', '--vault', vault, '--input', '-', '--json'],
							input: { kind: 'task-query' },
						},
					],
				})}\n`,
			]),
			output,
			commandPorts: { configRoot, _persistentReadTransport: transport as never },
			runCommand: async argv => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise(resolve => setTimeout(resolve, argv[0] === 'health' ? 4 : 1));
				active -= 1;
				return localOutcome(argv[0], argv[0] === 'health' ? 1 : 2);
			},
		});
		assert.equal(exitCode, 0);
		assert.deepEqual(batchCounts, [2]);
		assert.equal(maxActive, 2);
		assert.deepEqual(output.lines().map(line => line.id), ['health', 'query']);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group accepts exactly eight children', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-max-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	const output = captureOutput();
	const batchCounts: number[] = [];
	let calls = 0;
	try {
		const exitCode = await runJsonlSessionV1({
			input: Readable.from([
				`${JSON.stringify({
					id: 'max-reads',
					reads: Array.from({ length: 8 }, (_, index) => ({
						id: `read-${index}`,
						argv: ['health', '--vault', vault, '--json'],
					})),
				})}\n`,
			]),
			output,
			commandPorts: {
				configRoot,
				_persistentReadTransport: {
					beginBatch(count: number) {
						batchCounts.push(count);
					},
					consumeLastEvidence: () => 'persistent',
					close() {},
				} as never,
			},
			runCommand: async argv => {
				calls += 1;
				return localOutcome(argv[0], calls);
			},
		});
		assert.equal(exitCode, 0);
		assert.equal(calls, 8);
		assert.deepEqual(batchCounts, [8]);
		assert.deepEqual(output.lines().map(line => line.id), [
			'read-0',
			'read-1',
			'read-2',
			'read-3',
			'read-4',
			'read-5',
			'read-6',
			'read-7',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group emits only the contiguous ordered prefix after out-of-order completion', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-order-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	const output = captureOutput();
	const pending = Array.from({ length: 4 }, () => deferred<PublicCommandOutcomeV1>());
	let calls = 0;
	try {
		const run = runJsonlSessionV1({
			input: Readable.from([`${JSON.stringify({
				id: 'ordered',
				reads: Array.from({ length: 4 }, (_, index) => ({
					id: `read-${index}`,
					argv: ['health', '--vault', vault, '--json'],
				})),
			})}\n`]),
			output,
			commandPorts: {
				configRoot,
				_persistentReadTransport: {
					beginBatch() {},
					consumeLastEvidence: () => 'persistent',
					close() {},
				} as never,
			},
			runCommand: async () => {
				const index = calls;
				calls += 1;
				return pending[index]!.promise;
			},
		});
		await waitUntil(() => calls === 4);
		pending[2]!.resolve(localOutcome('health', 3));
		pending[3]!.resolve(localOutcome('health', 4));
		await nextTurn();
		assert.equal(output.text(), '');
		pending[0]!.resolve(localOutcome('health', 1));
		await nextTurn();
		assert.deepEqual(output.lines().map(line => line.id), ['read-0']);
		pending[1]!.resolve(localOutcome('health', 2));
		assert.equal(await run, 0);
		assert.deepEqual(output.lines().map(line => line.id), [
			'read-0',
			'read-1',
			'read-2',
			'read-3',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group backpressure blocks later children and the next top-level frame', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-backpressure-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	const chunks: string[] = [];
	const listeners = new Map<string, (error?: Error) => void>();
	let calls = 0;
	const output = {
		write(chunk: string) {
			chunks.push(chunk);
			return chunks.length !== 1;
		},
		once(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			listeners.set(event, listener);
		},
		removeListener(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			if (listeners.get(event) === listener) listeners.delete(event);
		},
	};
	try {
		const run = runJsonlSessionV1({
			input: Readable.from([
				`${JSON.stringify({
					id: 'group',
					reads: Array.from({ length: 3 }, (_, index) => ({
						id: `child-${index}`,
						argv: ['health', '--vault', vault, '--json'],
					})),
				})}\n`,
				`${JSON.stringify({ id: 'after', argv: ['version'] })}\n`,
			]),
			output,
			commandPorts: {
				configRoot,
				_persistentReadTransport: {
					beginBatch() {},
					consumeLastEvidence: () => 'persistent',
					close() {},
				} as never,
			},
			runCommand: async argv => {
				calls += 1;
				return localOutcome(argv[0], calls);
			},
		});
		await waitUntil(() => chunks.length === 1);
		assert.equal(calls, 3);
		listeners.get('drain')?.();
		assert.equal(await run, 0);
		assert.equal(calls, 4);
		assert.deepEqual(chunks.map(chunk => JSON.parse(chunk).id), [
			'child-0',
			'child-1',
			'child-2',
			'after',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('aborting read-group backpressure emits no response after the accepted prefix', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-abort-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	const controller = new AbortController();
	const chunks: string[] = [];
	const listeners = new Map<string, (error?: Error) => void>();
	const output = {
		write(chunk: string) {
			chunks.push(chunk);
			return false;
		},
		once(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			listeners.set(event, listener);
		},
		removeListener(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			if (listeners.get(event) === listener) listeners.delete(event);
		},
	};
	try {
		const run = runJsonlSessionV1({
			input: Readable.from([`${JSON.stringify({
				id: 'group',
				reads: Array.from({ length: 3 }, (_, index) => ({
					id: `child-${index}`,
					argv: ['health', '--vault', vault, '--json'],
				})),
			})}\n`]),
			output,
			signal: controller.signal,
			commandPorts: {
				configRoot,
				_persistentReadTransport: {
					beginBatch() {},
					consumeLastEvidence: () => 'persistent',
					close() {},
				} as never,
			},
			runCommand: async argv => localOutcome(argv[0], 1),
		});
		await waitUntil(() => chunks.length === 1);
		controller.abort();
		assert.equal(await run, 130);
		assert.equal(chunks.length, 1);
		assert.equal(JSON.parse(chunks[0]!).id, 'child-0');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group canonicalizes alias, profile, and implicit targets before dispatch', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-target-'));
	const configRoot = path.join(root, 'config');
	const vault = path.join(root, 'vault');
	const alias = path.join(root, 'vault-alias');
	mkdirSync(vault, { recursive: true, mode: 0o700 });
	symlinkSync(vault, alias);
	const identity = canonicalVaultIdentityV1(vault);
	saveOperonCliConfigV1({
		version: 1,
		defaultProfile: 'same',
		profiles: [{
			name: 'same',
			canonicalPath: identity.canonicalPath,
			vaultSha256: identity.sha256,
			verifiedAt: '2026-07-29T00:00:00.000Z',
		}],
	}, configRoot);
	const output = captureOutput();
	const targets: unknown[] = [];
	const argvs: string[][] = [];
	try {
		const exitCode = await runJsonlSessionV1({
			input: Readable.from([`${JSON.stringify({
				id: 'canonical',
				reads: [
					{ id: 'alias', argv: ['health', '--vault', alias] },
					{ id: 'profile', argv: ['task', 'get', '--profile', 'same', '--input', '-'], input: { operonId: 'x' } },
					{ id: 'implicit', argv: ['context', '--input', '-'], input: { kind: 'task-query' } },
				],
			})}\n`]),
			output,
			commandPorts: {
				configRoot,
				cwd: vault,
				_persistentReadTransport: {
					beginBatch() {},
					consumeLastEvidence: () => 'persistent',
					close() {},
				} as never,
			},
			runCommand: async (argv, ports) => {
				argvs.push([...argv]);
				targets.push(ports?._resolvedTarget);
				return localOutcome(argv[0], argvs.length);
			},
		});
		assert.equal(exitCode, 0);
		assert.equal(argvs.length, 3);
		assert.ok(argvs.every(argv => (
			argv.includes('--vault')
			&& argv[argv.indexOf('--vault') + 1] === identity.canonicalPath
			&& !argv.includes('--profile')
		)));
		assert.equal(new Set(targets).size, 1);
		assert.deepEqual(readdirSync(configRoot).sort(), [
			'client-v1.json',
			'client-v1.json.initialized',
			'config-v1.json',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group rejects canonical profile or implicit target mismatch before publication', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-session-group-mismatch-'));
	const configRoot = path.join(root, 'config');
	const requestRoot = path.join(root, 'requests');
	const firstVault = path.join(root, 'first');
	const secondVault = path.join(root, 'second');
	mkdirSync(firstVault, { recursive: true, mode: 0o700 });
	mkdirSync(secondVault, { recursive: true, mode: 0o700 });
	mkdirSync(requestRoot, { recursive: true, mode: 0o700 });
	const first = canonicalVaultIdentityV1(firstVault);
	const second = canonicalVaultIdentityV1(secondVault);
	saveOperonCliConfigV1({
		version: 1,
		defaultProfile: 'first',
		profiles: [
			{
				name: 'first',
				canonicalPath: first.canonicalPath,
				vaultSha256: first.sha256,
				verifiedAt: '2026-07-29T00:00:00.000Z',
			},
			{
				name: 'second',
				canonicalPath: second.canonicalPath,
				vaultSha256: second.sha256,
				verifiedAt: '2026-07-29T00:00:00.000Z',
			},
		],
	}, configRoot);
	let dispatches = 0;
	const output = captureOutput();
	try {
		const exitCode = await runJsonlSessionV1({
			input: Readable.from([`${JSON.stringify({
				id: 'mismatch',
				reads: [
					{ id: 'implicit', argv: ['health'] },
					{ id: 'profile', argv: ['health', '--profile', 'second'] },
				],
			})}\n`]),
			output,
			commandPorts: {
				configRoot,
				cwd: firstVault,
				requestRoot,
				_persistentReadTransport: {
					beginBatch() {
						throw new Error('batch-must-not-start');
					},
					consumeLastEvidence: () => null,
					close() {},
				} as never,
			},
			runCommand: async argv => {
				dispatches += 1;
				return localOutcome(argv[0], dispatches);
			},
		});
		assert.equal(exitCode, 0);
		assert.equal(dispatches, 0);
		assert.deepEqual(readdirSync(requestRoot), []);
		assert.equal(output.lines()[0]?.error?.code, 'invalid-request');
		assert.equal(
			(output.lines()[0]?.error?.details as { reasonCode?: string } | undefined)?.reasonCode,
			'session-read-group-target-mismatch',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('JSONL read group rejects invalid bounds, duplicate IDs, target drift, and mutations before dispatch', async () => {
	const output = captureOutput();
	let calls = 0;
	const frames = [
		{ id: 'small', reads: [{ id: 'one', argv: ['health'] }] },
		{
			id: 'large',
			reads: Array.from({ length: 9 }, (_, index) => ({
				id: `read-${index}`,
				argv: ['health'],
			})),
		},
		{
			id: 'duplicate',
			reads: [
				{ id: 'same', argv: ['health'] },
				{ id: 'same', argv: ['health'] },
			],
		},
		{
			id: 'target-drift',
			reads: [
				{
					id: 'one',
					argv: ['health', '--vault', path.join(tmpdir(), 'operon-cli-test-vault-missing')],
				},
				{ id: 'two', argv: ['health', '--profile', 'other'] },
			],
		},
		{
			id: 'mutation',
			reads: [
				{ id: 'one', argv: ['health'] },
				{ id: 'two', argv: ['mutation', 'apply', '--plan-ref', 'sealed'] },
			],
		},
	];
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`]),
		output,
		commandPorts: {
			_persistentReadTransport: {
				consumeLastEvidence: () => null,
				close() {},
			} as never,
		},
		runCommand: async argv => {
			calls += 1;
			return localOutcome(argv[0], calls);
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(calls, 0);
	assert.equal(output.lines().length, frames.length);
	assert.ok(output.lines().every(line => line.exitCode === 2));
});

test('session rejects malformed, oversized, recursive, and non-isolated input frames', async () => {
	const output = captureOutput();
	let calls = 0;
	const frames = [
		'not-json',
		JSON.stringify({
			id: 'oversized',
			argv: ['task', 'get', '--input', '-'],
			input: 'x'.repeat(20),
		}),
		JSON.stringify({ id: 'missing-input', argv: ['task', 'get', '--input', '-'] }),
		JSON.stringify({ id: 'detached-input', argv: ['version'], input: {} }),
		JSON.stringify({ id: 'recursive', argv: ['session', '--jsonl'] }),
		JSON.stringify({ id: 'valid', argv: ['version', '--json'] }),
	].join('\n') + '\n';
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([frames]),
		output,
		limits: {
			lineBytes: 1_024,
			inputBytes: 16,
			argvItems: 16,
			argumentBytes: 128,
			argvBytes: 512,
		},
		runCommand: async argv => {
			calls += 1;
			return localOutcome(argv[0], calls);
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(calls, 1);
	assert.deepEqual(
		output.lines().map(line => line.error?.code ?? 'ok'),
		[
			'invalid-request',
			'invalid-request',
			'invalid-request',
			'invalid-request',
			'invalid-request',
			'ok',
		],
	);
	assert.deepEqual(
		output.lines().slice(0, 5).map(line =>
			(line.error?.details as { reasonCode?: string } | undefined)?.reasonCode),
		[
			'session-frame-invalid',
			'session-input-too-large',
			'session-input-isolation-required',
			'session-input-isolation-required',
			'session-recursion-disabled',
		],
	);
});

test('session bounds an oversized line, resumes at the next frame, and isolates failures', async () => {
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${'x'.repeat(80)}\n`,
			`${JSON.stringify({ id: 'throws', argv: ['version'] })}\n`,
			`${JSON.stringify({ id: 'after', argv: ['manifest'] })}\n`,
		]),
		output,
		limits: {
			lineBytes: 64,
			inputBytes: 64,
			argvItems: 16,
			argumentBytes: 32,
			argvBytes: 64,
		},
		runCommand: async argv => {
			if (argv[0] === 'version') throw new Error('sensitive internal failure');
			return localOutcome(argv[0], 1);
		},
	});
	assert.equal(exitCode, 0);
	assert.deepEqual(output.lines(), [
		{
			id: null,
			exitCode: 2,
			error: {
				contractVersion: 1,
				code: 'invalid-request',
				reason: 'The JSONL session frame exceeds the byte limit.',
				retryable: false,
				action: 'fix-request',
				details: { reasonCode: 'session-line-too-large' },
			},
		},
		{
			id: 'throws',
			exitCode: 70,
			error: {
				contractVersion: 1,
				code: 'internal-error',
				reason: 'The Operon command failed unexpectedly.',
				retryable: false,
				action: 'report-bug',
				details: { reasonCode: 'session-command-failed' },
			},
		},
		{
			id: 'after',
			exitCode: 0,
			result: localOutcome('manifest', 1).envelope,
		},
	]);
	assert.doesNotMatch(output.text(), /sensitive internal failure/u);
});

test('session honors output backpressure before dispatching the next frame', async () => {
	const chunks: string[] = [];
	const listeners = new Map<string, (error?: Error) => void>();
	let calls = 0;
	const output = {
		write(chunk: string) {
			chunks.push(chunk);
			if (chunks.length !== 1) return true;
			queueMicrotask(() => listeners.get('drain')?.());
			return false;
		},
		once(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			listeners.set(event, listener);
		},
		removeListener(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			if (listeners.get(event) === listener) listeners.delete(event);
		},
	};
	const run = runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({ id: 1, argv: ['version'] })}\n`,
			`${JSON.stringify({ id: 2, argv: ['manifest'] })}\n`,
		]),
		output,
		runCommand: async argv => {
			calls += 1;
			return localOutcome(argv[0], calls);
		},
	});
	assert.equal(await run, 0);
	assert.equal(calls, 2);
	assert.equal(chunks.length, 2);
});

test('benchmark-only frame timing covers decode through output drain and flushes once', async () => {
	const chunks: string[] = [];
	const listeners = new Map<string, (error?: Error) => void>();
	const batches: Array<{
		records: readonly {
			sequence: number;
			id: string | number | null;
			submittedMs: number;
			serviceStartMs: number;
			serviceEndMs: number;
			transport: 'persistent' | 'request-file-fallback' | 'one-shot';
		}[];
		overflow: number;
		timeOriginMs: number;
		clockOffsetMs: number;
	}> = [];
	const output = {
		write(chunk: string) {
			chunks.push(chunk);
			queueMicrotask(() => listeners.get('drain')?.());
			return false;
		},
		once(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			listeners.set(event, listener);
		},
		removeListener(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void) {
			if (listeners.get(event) === listener) listeners.delete(event);
		},
	};
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({ id: 'timed', argv: ['version'] })}\n`,
		]),
		output,
		runCommand: async argv => localOutcome(argv[0], 1),
		frameTiming: batch => {
			batches.push(batch);
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(chunks.length, 1);
	assert.equal(batches.length, 1);
	assert.equal(batches[0].overflow, 0);
	assert.equal(batches[0].records.length, 1);
	assert.equal(batches[0].records[0].sequence, 1);
	assert.equal(batches[0].records[0].id, 'timed');
	assert.equal(batches[0].records[0].transport, 'one-shot');
	assert.ok(Number.isFinite(batches[0].timeOriginMs));
	assertClockOffsetIsBounded(batches[0].clockOffsetMs);
	assert.ok(batches[0].records[0].serviceStartMs >= batches[0].records[0].submittedMs);
	assert.ok(batches[0].records[0].serviceEndMs >= batches[0].records[0].serviceStartMs);
});

test('persistent read client handshakes, preserves request identity, and rejects mutations', {
	skip: process.platform !== 'darwin',
}, async t => {
	// Darwin's Unix socket path limit requires the intentionally short transport root.
	const root = await mkdtemp('/private/tmp/operon-persistent-cli-');
	chmodSync(root, 0o700);
	const vaultPath = path.join(root, 'vault');
	mkdirSync(vaultPath, { mode: 0o700 });
	const vaultFence = createCanonicalVaultFenceV1(vaultPath);
	const serverInstanceId = 'a'.repeat(64);
	const authSecret = 'c'.repeat(64);
	const socketBasename = `read-${'b'.repeat(48)}.sock`;
	const socketPath = path.join(root, socketBasename);
	const seen: Array<Record<string, unknown>> = [];
	let authNonceSequence = 0;
	let connectionCount = 0;
	const idleClose = deferred<void>();
	const server = createServer(socket => {
		connectionCount += 1;
		let pending = Buffer.alloc(0);
		let closesAfterResponse = false;
		socket.on('close', () => {
			if (closesAfterResponse) idleClose.resolve();
		});
		socket.on('data', chunk => {
			pending = Buffer.concat([pending, Buffer.from(chunk)]);
			while (pending.byteLength >= 4) {
				const length = pending.readUInt32BE(0);
				if (pending.byteLength < length + 4) return;
				const message = JSON.parse(
					pending.subarray(4, length + 4).toString('utf8'),
				) as Record<string, unknown>;
				pending = pending.subarray(length + 4);
				seen.push(message);
				const responses = message.type === 'hello'
					? [{
						type: 'hello-ack',
						protocolVersion: 1,
						serverInstanceId,
						vaultSha256: vaultFence.sha256,
						connectionNonce: message.connectionNonce,
					}]
					: message.type === 'batch'
						? (message.requests as Array<Record<string, unknown>>).map((request, index) => ({
							type: 'batch-item-response',
							sequence: message.sequence,
							index,
							requestId: request.requestId,
							result: JSON.stringify({ ok: true, requestId: request.requestId }),
						}))
						: [{
						type: 'response',
						sequence: message.sequence,
						requestId: message.requestId,
						result: JSON.stringify({ ok: true }),
					}];
				for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
					const response = responses[responseIndex];
					if (!response) continue;
					authNonceSequence += 1;
					const authenticatedResponse = authenticatePersistentTestFrameV1({
						...response,
						connectionNonce: message.connectionNonce,
						authNonce: authNonceSequence.toString(16).padStart(64, '0'),
					}, authSecret);
					const body = Buffer.from(JSON.stringify(authenticatedResponse), 'utf8');
					const frame = Buffer.alloc(4 + body.byteLength);
					frame.writeUInt32BE(body.byteLength, 0);
					body.copy(frame, 4);
					if (message.requestId === 'read-one') {
						closesAfterResponse = true;
						socket.end(frame);
					} else {
						socket.write(frame);
					}
					if (
						message.type === 'batch'
						&& (message.requests as Array<Record<string, unknown>>)[0]?.requestId === 'disconnect-one'
						&& responseIndex === 0
					) {
						socket.destroy();
						break;
					}
				}
			}
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(socketPath, () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
	} catch (error) {
		if (isNodeError(error) && error.code === 'EPERM') {
			t.skip('Unix-domain socket listen is unavailable in the current sandbox.');
			return;
		}
		throw error;
	}
	chmodSync(socketPath, 0o600);
	writeFileSync(
		path.join(root, `persistent-read-${vaultFence.sha256}.json`),
		JSON.stringify({
			protocolVersion: 1,
			serverInstanceId,
			vaultSha256: vaultFence.sha256,
			endpointKind: 'unix-domain-socket',
			endpoint: socketPath,
			authSecret,
			expiresAt: Date.now() + 60_000,
			pluginVersion: 'test',
			apiVersion: 1,
		}),
		{ encoding: 'utf8', mode: 0o600 },
	);
	const client = new PersistentReadTransportV1(root);
	try {
		const result = await client.invoke({
			requestId: 'read-one',
			command: 'health',
			requestToken: 'A'.repeat(32),
			vaultFence,
		});
		assert.deepEqual(JSON.parse(result.result.toString('utf8')), { ok: true });
		assert.equal(seen[1]?.requestId, 'read-one');
		assert.equal(seen[1]?.command, 'health');
		await idleClose.promise;
		await nextTurn();
		const reconnected = await client.invoke({
			requestId: 'read-two',
			command: 'health',
			requestToken: 'G'.repeat(32),
			vaultFence,
		});
		assert.deepEqual(JSON.parse(reconnected.result.toString('utf8')), { ok: true });
		assert.equal(connectionCount, 2);
		assert.equal(seen[2]?.type, 'hello');
		assert.equal(seen[3]?.requestId, 'read-two');
		client.beginBatch(2);
		const batch = await Promise.all([
			client.invoke({
				requestId: 'batch-health',
				command: 'health',
				requestToken: 'C'.repeat(32),
				vaultFence,
			}),
			client.invoke({
				requestId: 'batch-query',
				command: 'tasks.query',
				requestToken: 'D'.repeat(32),
				vaultFence,
			}),
		]);
		assert.equal(seen[4]?.type, 'batch');
		assert.equal((seen[4]?.requests as unknown[]).length, 2);
		assert.equal(JSON.parse(batch[1]!.result.toString('utf8')).requestId, 'batch-query');
		client.beginBatch(2);
		const disconnected = await Promise.allSettled([
			client.invoke({
				requestId: 'disconnect-one',
				command: 'health',
				requestToken: 'E'.repeat(32),
				vaultFence,
			}),
			client.invoke({
				requestId: 'disconnect-two',
				command: 'tasks.query',
				requestToken: 'F'.repeat(32),
				vaultFence,
			}),
		]);
		assert.equal(disconnected[0]?.status, 'fulfilled');
		assert.equal(disconnected[1]?.status, 'rejected');
		await assert.rejects(client.invoke({
			requestId: 'mutation',
			command: 'mutation.apply',
			requestToken: 'B'.repeat(32),
			vaultFence,
		}), /PERSISTENT_COMMAND_NOT_ALLOWED/u);
		assert.equal(seen.length, 6);
	} finally {
		client.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});

test('pre-aborted session does not dispatch a buffered EOF mutation frame', async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			JSON.stringify({ id: 'apply', argv: ['plan', 'apply', 'plan-ref-one'] }),
		]),
		output,
		signal: controller.signal,
		runCommand: async argv => {
			calls += 1;
			return localOutcome(argv[0], calls);
		},
	});
	assert.equal(exitCode, 130);
	assert.equal(calls, 0);
	assert.equal(output.text(), '');
});

test('unexpected apply rejection preserves same-plan recovery evidence', async () => {
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({
				id: 'apply',
				argv: ['plan', 'apply', 'plan-ref-one', '--json'],
			})}\n`,
		]),
		output,
		runCommand: async () => {
			throw new Error('transport ended after apply started');
		},
	});
	assert.equal(exitCode, 0);
	assert.deepEqual(output.lines(), [{
		id: 'apply',
		exitCode: 5,
		error: {
			contractVersion: 1,
			code: 'outcome-unknown',
			reason: 'Apply may have started. Recover only the same stored plan reference.',
			retryable: false,
			action: 'recover-same-plan',
			details: { reasonCode: 'session-apply-outcome-unknown' },
		},
		recovery: {
			required: true,
			action: 'recover-same-plan',
			planRef: 'plan-ref-one',
			mutationMayHaveApplied: true,
		},
	}]);
});

test('normalized local apply failure preserves internally generated plan recovery evidence', async () => {
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({
				id: 'compact',
				argv: ['task', 'create', 'Compact task'],
			})}\n`,
		]),
		output,
		runCommand: async () => ({
			exitCode: 70,
			json: false,
			envelope: {
				contractVersion: 1,
				kind: 'operon-cli-local-result',
				command: 'task.create',
				ok: false,
				error: {
					contractVersion: 1,
					code: 'internal-error',
					reason: 'Synthetic local failure.',
					retryable: false,
					action: 'report-bug',
				},
			},
			human: 'Synthetic local failure.',
			_recoveryPlanRef: 'generated-plan-ref',
		}),
	});
	assert.equal(exitCode, 0);
	assert.deepEqual(output.lines(), [{
		id: 'compact',
		exitCode: 5,
		error: {
			contractVersion: 1,
			code: 'outcome-unknown',
			reason: 'Apply may have started. Recover only the same stored plan reference.',
			retryable: false,
			action: 'recover-same-plan',
			details: { reasonCode: 'session-apply-outcome-unknown' },
		},
		recovery: {
			required: true,
			action: 'recover-same-plan',
			planRef: 'generated-plan-ref',
			mutationMayHaveApplied: true,
		},
	}]);
});

test('post-dispatch session interruption queues recovery evidence and exits 5', async () => {
	const controller = new AbortController();
	const output = captureOutput();
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({
				id: 'interrupted-apply',
				argv: ['plan', 'apply', 'interrupted-plan-ref', '--json'],
			})}\n`,
		]),
		output,
		signal: controller.signal,
		runCommand: async () => {
			controller.abort();
			return {
				exitCode: 5,
				json: true,
				envelope: {
					contractVersion: 1,
					kind: 'operon-cli-local-result',
					command: 'plan.apply',
					ok: false,
					error: {
						contractVersion: 1,
						code: 'outcome-unknown',
						reason: 'Synthetic interrupted apply.',
						retryable: false,
						action: 'recover-same-plan',
					},
				},
				human: 'Synthetic interrupted apply.',
				_recoveryPlanRef: 'interrupted-plan-ref',
			};
		},
	});
	assert.equal(exitCode, 5);
	assert.equal(output.lines()[0]?.exitCode, 5);
	assert.equal(
		(output.lines()[0]?.recovery as { planRef?: string } | undefined)?.planRef,
		'interrupted-plan-ref',
	);
});

test('post-dispatch recovery frame drains under backpressure after abort', async () => {
	const controller = new AbortController();
	let serialized = '';
	const output = new Writable({
		highWaterMark: 1,
		write(chunk, _encoding, callback) {
			serialized += chunk.toString();
			setImmediate(callback);
		},
	});
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({
				id: 'backpressured-apply',
				argv: ['plan', 'apply', 'backpressured-plan-ref', '--json'],
			})}\n`,
		]),
		output,
		signal: controller.signal,
		runCommand: async () => {
			controller.abort();
			return {
				exitCode: 5,
				json: true,
				envelope: {
					contractVersion: 1,
					kind: 'operon-cli-local-result',
					command: 'plan.apply',
					ok: false,
					error: {
						contractVersion: 1,
						code: 'outcome-unknown',
						reason: 'Synthetic interrupted apply.',
						retryable: false,
						action: 'recover-same-plan',
					},
				},
				human: '',
				_recoveryPlanRef: 'backpressured-plan-ref',
			};
		},
	});
	assert.equal(exitCode, 5);
	assert.equal(JSON.parse(serialized).recovery.planRef, 'backpressured-plan-ref');
});

test('output backpressure wait terminates on session abort', async () => {
	const controller = new AbortController();
	const output = {
		write() {
			queueMicrotask(() => controller.abort());
			return false;
		},
		once() {},
		removeListener() {},
	};
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({ id: 'version', argv: ['version'] })}\n`,
		]),
		output,
		signal: controller.signal,
		runCommand: async argv => localOutcome(argv[0], 1),
	});
	assert.equal(exitCode, 130);
});

test('frame timing is emitted once at close with child epoch boundaries', async () => {
	const output = captureOutput();
	const batches: Array<Parameters<NonNullable<
		Parameters<typeof runJsonlSessionV1>[0]['frameTiming']
	>>[0]> = [];
	const exitCode = await runJsonlSessionV1({
		input: Readable.from([
			`${JSON.stringify({ id: 'one', argv: ['version'] })}\n`,
			`${JSON.stringify({ id: 'two', argv: ['version'] })}\n`,
		]),
		output,
		runCommand: async argv => localOutcome(argv[0], 1),
		frameTiming: batch => {
			batches.push(batch);
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(batches.length, 1);
	assert.equal(batches[0]?.overflow, 0);
	assert.equal(batches[0]?.records.length, 2);
	assertClockOffsetIsBounded(batches[0]?.clockOffsetMs);
	assert.deepEqual(batches[0]?.records.map(record => record.id), ['one', 'two']);
	for (const record of batches[0]?.records ?? []) {
		assert.equal(record.submittedEpochMs, batches[0]!.timeOriginMs + record.submittedMs);
		assert.equal(record.serviceStartEpochMs, batches[0]!.timeOriginMs + record.serviceStartMs);
		assert.equal(record.serviceEndEpochMs, batches[0]!.timeOriginMs + record.serviceEndMs);
		assert.ok(record.serviceStartMs >= record.submittedMs);
		assert.ok(record.serviceEndMs >= record.serviceStartMs);
	}
});

test('frame timing uses a fixed 1024-record capacity and reports overflow', async () => {
	const frameCount = 1_026;
	const output = captureOutput();
	let batch: Parameters<NonNullable<
		Parameters<typeof runJsonlSessionV1>[0]['frameTiming']
	>>[0] | undefined;
	const frames = Array.from({ length: frameCount }, (_, index) => (
		`${JSON.stringify({ id: index, argv: ['version'] })}\n`
	));
	const exitCode = await runJsonlSessionV1({
		input: Readable.from(frames),
		output,
		runCommand: async argv => localOutcome(argv[0], 1),
		frameTiming: value => {
			assert.equal(batch, undefined);
			batch = value;
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(batch?.records.length, 1_024);
	assert.equal(batch?.overflow, 2);
	assert.equal(batch?.records[0]?.sequence, 1);
	assert.equal(batch?.records.at(-1)?.sequence, 1_024);
});

function assertClockOffsetIsBounded(value: number | undefined): void {
	assert.ok(Number.isFinite(value));
	const clockOffsetMs = value as number;
	assert.ok(
		Math.abs(clockOffsetMs) <= CLOCK_OFFSET_TOLERANCE_MS,
		`Clock offset ${clockOffsetMs.toFixed(3)} ms exceeded ${CLOCK_OFFSET_TOLERANCE_MS} ms.`,
	);
}

function localOutcome(command: string, sequence: number): PublicCommandOutcomeV1 {
	return {
		exitCode: 0,
		json: true,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command,
			ok: true,
			result: { sequence },
		},
		human: `result ${sequence}`,
	};
}

function captureOutput(): Writable & { text(): string; lines(): Array<Record<string, any>> } {
	const chunks: Buffer[] = [];
	const output = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(Buffer.from(chunk));
			callback();
		},
	}) as Writable & { text(): string; lines(): Array<Record<string, any>> };
	output.text = () => Buffer.concat(chunks).toString('utf8');
	output.lines = () => output.text()
		.trim()
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, any>);
	return output;
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function nextTurn(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await nextTurn();
	}
	throw new Error('TEST_CONDITION_TIMEOUT');
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error;
}

function authenticatePersistentTestFrameV1(
	value: Record<string, unknown>,
	authSecret: string,
): Record<string, unknown> {
	return {
		...value,
		authMac: createHmac('sha256', authSecret)
			.update(stableAuthenticatedTestJsonV1(value))
			.digest('hex'),
	};
}

function stableAuthenticatedTestJsonV1(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableAuthenticatedTestJsonV1).join(',')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.filter(key => key !== 'authMac')
			.sort()
			.map(key => `${JSON.stringify(key)}:${stableAuthenticatedTestJsonV1(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}
