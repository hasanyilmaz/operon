import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createConnection, type Socket } from 'node:net';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	realpath,
	rm,
	symlink,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { constants as fsConstants, lstatSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
	CLI_COMMANDS_V1,
	type CliInvocationV1,
} from '../../../src/agent-runtime/contracts/v1/cli';
import { decodeCliResultEnvelopeV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import {
	CONTRACT_VERSION_V1,
	type CompatibilityOfferV1,
} from '../../../src/agent-runtime/contracts/v1/primitives';
import type { RuntimeHealthV1 } from '../../../src/agent-runtime/contracts/v1/lifecycle';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { RuntimeTimingSpanV1 } from '../../../src/agent-runtime/runtime/timing-probe';
import { createAgentRuntimeDesktopNodeApiLoaderV1 } from '../../../src/agent-runtime/transport/desktop-node-api';
import { dispatchAgentRuntimeCliV1 } from '../../../src/agent-runtime/transport/dispatcher';
import {
	registerAgentRuntimeCliHandlersV1,
} from '../../../src/agent-runtime/transport/native-cli';
import {
	startAgentRuntimePersistentReadServerV1,
	type AgentRuntimePersistentReadServerHandleV1,
} from '../../../src/agent-runtime/transport/persistent-read-server';
import {
	AgentRuntimePersistentReadSupervisorV1,
} from '../../../src/agent-runtime/transport/persistent-read-supervisor';
import {
	computeRunningVaultSha256V1,
	getAgentRuntimeRequestRootV1,
	readAndConsumeAgentRuntimeRequestFileV1,
} from '../../../src/agent-runtime/transport/secure-request-file';
import type {
	AgentRuntimeDesktopNodeApiV1,
	AgentRuntimeTransportFileStatV1,
} from '../../../src/agent-runtime/transport/types';
import {
	cancelWindowsBrokerStageV1,
	clearWindowsBrokerStagesForTestsV1,
	consumeWindowsBrokerInvocationV1,
	getWindowsBrokerStageStateV1,
	markWindowsBrokerDispatchStartedV1,
	registerWindowsBrokerScopeV1,
	stageWindowsBrokerInvocationV1,
} from '../../../src/agent-runtime/transport/windows-broker-state';

const COMPATIBILITY: CompatibilityOfferV1 = {
	contractVersion: CONTRACT_VERSION_V1,
	runtimeApi: { min: 1, max: 1 },
};
const WINDOWS_BROKER_SCOPE = {
	serverInstanceId: '1'.repeat(64),
	vaultSha256: '2'.repeat(64),
} as const;
const REQUIRE_NATIVE_TRANSPORT = process.env['OPERON_REQUIRE_NATIVE_TRANSPORT'] === '1';

interface PersistentReadTestDescriptor {
	readonly protocolVersion: 1;
	readonly serverInstanceId: string;
	readonly vaultSha256: string;
	readonly endpointKind: 'unix-domain-socket' | 'windows-named-pipe';
	readonly endpoint: string;
	readonly authSecret: string;
}

interface PersistentRequestPublication {
	readonly token: string;
	readonly requestPath?: string;
	readonly descriptor?: PersistentReadTestDescriptor;
}

let brokerConnectionSequence = 0;

function persistentEndpointRootV1(): string {
	if (process.platform === 'win32') {
		const localAppData = process.env['LOCALAPPDATA'];
		if (!localAppData) throw new Error('PERSISTENT_LOCAL_APP_DATA_MISSING');
		return join(localAppData, 'Operon', 'runtime');
	}
	const uid = typeof process.getuid === 'function' ? process.getuid() : null;
	const userSegment = uid === null ? 'uid-unavailable' : `uid-${uid}`;
	if (process.platform === 'linux') {
		if (
			process.env['WSL_DISTRO_NAME']
			|| process.env['WSL_INTEROP']
			|| release().toLowerCase().includes('microsoft')
		) throw new Error('PERSISTENT_WSL_UNSUPPORTED');
		const runtimeRoot = uid === null ? null : `/run/user/${uid}`;
		if (runtimeRoot) {
			try {
				const stats = lstatSync(runtimeRoot);
				if (
					stats.isDirectory()
					&& !stats.isSymbolicLink()
					&& stats.uid === uid
					&& (stats.mode & 0o077) === 0
				) return join(runtimeRoot, 'operon-agent-runtime');
			} catch {
				// Match the server's verified per-user /tmp fallback.
			}
		}
		return join('/tmp', `operon-agent-runtime-${userSegment}`);
	}
	return join('/private/tmp', `operon-agent-runtime-${userSegment}`);
}

const nodeApi: AgentRuntimeDesktopNodeApiV1 = {
	platform: process.platform,
	fileOpenReadOnlyNoFollow: fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
	createSha256: value => createHash('sha256').update(value).digest('hex'),
	lstat: async path => asTransportStat(await lstat(path)),
	mkdir: async (path, options) => await mkdir(path, options),
	open: async (path, flags) => {
		const handle = await open(path, flags);
		return {
			stat: async () => asTransportStat(await handle.stat()),
			readFile: async () => await handle.readFile(),
			close: async () => await handle.close(),
		};
	},
	realpath,
	unlink,
	tmpdir,
	dirname,
	join,
	resolve,
	getuid: () => process.getuid?.() ?? null,
	utf8: value => Buffer.from(value, 'utf8'),
	decodeUtf8: value => Buffer.from(value).toString('utf8'),
	delay: async () => undefined,
};

test('desktop Node API loader shares success and forgets rejection', async () => {
	let successfulLoads = 0;
	let releaseLoad: ((value: AgentRuntimeDesktopNodeApiV1) => void) | undefined;
	const sharedLoader = createAgentRuntimeDesktopNodeApiLoaderV1(async () => {
		successfulLoads += 1;
		return await new Promise<AgentRuntimeDesktopNodeApiV1>(resolve => {
			releaseLoad = resolve;
		});
	});
	const first = sharedLoader();
	const second = sharedLoader();
	assert.equal(first, second);
	assert.equal(successfulLoads, 0);
	await Promise.resolve();
	assert.equal(successfulLoads, 1);
	releaseLoad?.(nodeApi);
	assert.equal(await first, nodeApi);
	assert.equal(await sharedLoader(), nodeApi);
	assert.equal(successfulLoads, 1);

	let attempts = 0;
	const retryingLoader = createAgentRuntimeDesktopNodeApiLoaderV1(async () => {
		attempts += 1;
		if (attempts === 1) throw new Error('synthetic load failure');
		return nodeApi;
	});
	await assert.rejects(retryingLoader(), /synthetic load failure/u);
	await Promise.resolve();
	assert.equal(await retryingLoader(), nodeApi);
	assert.equal(attempts, 2);
});

test('native CLI registration retries only handlers missing from a partial attempt', () => {
	const attempts = new Map<string, number>();
	let throwOnce = true;
	const plugin = {
		manifest: { id: 'operon', version: '3.0.0', minAppVersion: '1.7.2' },
		registerCliHandler(
			command: string,
			_description: string,
			_flags: unknown,
			_handler: unknown,
		) {
			attempts.set(command, (attempts.get(command) ?? 0) + 1);
			if (throwOnce && attempts.size === 3) {
				throwOnce = false;
				throw new Error('synthetic registration failure');
			}
		},
	};
	const first = registerAgentRuntimeCliHandlersV1(plugin as never, createRuntime());
	assert.equal(first.registered, false);
	assert.equal(first.retryable, true);
	assert.equal(first.commands.length, 2);
	assert.equal(first.missingCommands.length, CLI_COMMANDS_V1.length - 2);
	const second = registerAgentRuntimeCliHandlersV1(plugin as never, createRuntime());
	assert.equal(second.registered, true);
	assert.equal(second.retryable, false);
	assert.equal(second.commands.length, CLI_COMMANDS_V1.length);
	assert.equal(second.missingCommands.length, 0);
	assert.equal([...attempts.values()].filter(count => count > 1).length, 1);
});

test('persistent read supervisor restarts late failures and reports truthful state', async () => {
	const scheduler = createSupervisorScheduler();
	const handles: TestPersistentHandle[] = [];
	const supervisor = new AgentRuntimePersistentReadSupervisorV1({
		startServer: async () => {
			const handle = new TestPersistentHandle(true);
			handles.push(handle);
			return handle;
		},
		restartDelaysMs: [250, 1_000],
		stableResetMs: 60_000,
		now: () => scheduler.now,
		random: () => 0.5,
		setTimer: scheduler.setTimer,
		clearTimer: scheduler.clearTimer,
	});
	await supervisor.start();
	assert.deepEqual(supervisor.snapshot(), {
		state: 'available',
		available: true,
		consecutiveFailures: 0,
	});
	await handles[0]?.fail('persistent-read-server-error');
	assert.deepEqual(supervisor.snapshot(), {
		state: 'backoff',
		available: false,
		reason: 'persistent-read-server-error',
		consecutiveFailures: 1,
		nextRetryAt: 250,
	});
	await scheduler.runNext();
	assert.equal(handles.length, 2);
	assert.equal(supervisor.snapshot().available, true);
	assert.equal(supervisor.snapshot().consecutiveFailures, 1);
	await scheduler.runNext();
	assert.equal(supervisor.snapshot().consecutiveFailures, 0);
	await supervisor.close();
	assert.equal(handles[1]?.closed, true);
	assert.equal(supervisor.snapshot().state, 'closed');
});

test('persistent read supervisor bounds restart attempts and cancels backoff on close', async () => {
	const scheduler = createSupervisorScheduler();
	let starts = 0;
	const supervisor = new AgentRuntimePersistentReadSupervisorV1({
		startServer: async () => {
			starts += 1;
			return new TestPersistentHandle(false, 'persistent-read-server-start-failed');
		},
		restartDelaysMs: [10, 20],
		now: () => scheduler.now,
		random: () => 0.5,
		setTimer: scheduler.setTimer,
		clearTimer: scheduler.clearTimer,
	});
	await supervisor.start();
	await scheduler.runNext();
	await scheduler.runNext();
	assert.equal(starts, 3);
	assert.deepEqual(supervisor.snapshot(), {
		state: 'unavailable',
		available: false,
		reason: 'persistent-read-restart-exhausted:persistent-read-server-start-failed',
		consecutiveFailures: 3,
	});

	const closingScheduler = createSupervisorScheduler();
	const closingSupervisor = new AgentRuntimePersistentReadSupervisorV1({
		startServer: async () => new TestPersistentHandle(false, 'persistent-read-server-start-failed'),
		restartDelaysMs: [10],
		now: () => closingScheduler.now,
		random: () => 0.5,
		setTimer: closingScheduler.setTimer,
		clearTimer: closingScheduler.clearTimer,
	});
	await closingSupervisor.start();
	assert.equal(closingScheduler.size, 1);
	await closingSupervisor.close();
	assert.equal(closingScheduler.size, 0);
	assert.equal(closingSupervisor.snapshot().state, 'closed');
});

test('persistent read supervisor preserves failure reason while restarting', async () => {
	const scheduler = createSupervisorScheduler();
	let starts = 0;
	let releaseRestart: ((handle: AgentRuntimePersistentReadServerHandleV1) => void) | undefined;
	const supervisor = new AgentRuntimePersistentReadSupervisorV1({
		startServer: async () => {
			starts += 1;
			if (starts === 1) {
				return new TestPersistentHandle(false, 'persistent-read-server-error');
			}
			return await new Promise<AgentRuntimePersistentReadServerHandleV1>(resolveStart => {
				releaseRestart = resolveStart;
			});
		},
		restartDelaysMs: [10],
		now: () => scheduler.now,
		random: () => 0.5,
		setTimer: scheduler.setTimer,
		clearTimer: scheduler.clearTimer,
	});
	await supervisor.start();
	assert.equal(supervisor.snapshot().reason, 'persistent-read-server-error');
	await scheduler.runNext();
	assert.deepEqual(supervisor.snapshot(), {
		state: 'starting',
		available: false,
		reason: 'persistent-read-server-error',
		consecutiveFailures: 1,
	});
	releaseRestart?.(new TestPersistentHandle(true));
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(supervisor.snapshot().available, true);
	assert.equal(supervisor.snapshot().reason, undefined);
	await supervisor.close();
});

test('persistent read supervisor invalidates and closes an in-flight start', async () => {
	let releaseStart: ((handle: AgentRuntimePersistentReadServerHandleV1) => void) | undefined;
	let isCurrent: (() => boolean) | undefined;
	const lateHandle = new TestPersistentHandle(true);
	const supervisor = new AgentRuntimePersistentReadSupervisorV1({
		startServer: async current => {
			isCurrent = current;
			return await new Promise<AgentRuntimePersistentReadServerHandleV1>(resolveStart => {
				releaseStart = resolveStart;
			});
		},
	});
	const starting = supervisor.start();
	await Promise.resolve();
	assert.equal(isCurrent?.(), true);
	const closing = supervisor.close();
	assert.equal(isCurrent?.(), false);
	releaseStart?.(lateHandle);
	await Promise.all([starting, closing]);
	assert.equal(lateHandle.closed, true);
	assert.equal(supervisor.snapshot().state, 'closed');
});

test('Runtime vault identity normalizes Windows case, Unicode and extended paths', async () => {
	const windowsNodeApi: AgentRuntimeDesktopNodeApiV1 = {
		...nodeApi,
		platform: 'win32',
		realpath: async () => '\\\\?\\C:\\VAULTS\\Cafe\u0301\\Türkçe\\😀',
	};
	const digest = await computeRunningVaultSha256V1(windowsNodeApi, {
		getFullPath: () => 'C:\\unused',
	});
	assert.equal(
		digest,
		createHash('sha256').update('c:\\vaults\\café\\türkçe\\😀').digest('hex'),
	);
});

test('Windows broker staging is one-shot, bounded and expires fail-closed', () => {
	clearWindowsBrokerStagesForTestsV1();
	registerWindowsBrokerScopeV1(WINDOWS_BROKER_SCOPE);
	const token = 'w'.repeat(32);
	stageWindowsBrokerInvocationV1({
		token,
		raw: '{"kind":"cli-invocation"}',
		receipt: 'r'.repeat(64),
		scope: WINDOWS_BROKER_SCOPE,
		now: 1_000,
	});
	const foreignScope = {
		serverInstanceId: '3'.repeat(64),
		vaultSha256: '4'.repeat(64),
	};
	assert.equal(getWindowsBrokerStageStateV1(token, foreignScope, 1_001), 'unknown');
	assert.deepEqual(cancelWindowsBrokerStageV1(token, foreignScope, 1_001), {
		cancelled: false,
		state: 'unknown',
	});
	assert.equal(consumeWindowsBrokerInvocationV1(token, foreignScope, 1_001), null);
	assert.equal(getWindowsBrokerStageStateV1(token, WINDOWS_BROKER_SCOPE, 1_001), 'staged');
	assert.deepEqual(consumeWindowsBrokerInvocationV1(token, WINDOWS_BROKER_SCOPE, 1_002), {
		raw: '{"kind":"cli-invocation"}',
		inputBytes: 25,
		scope: WINDOWS_BROKER_SCOPE,
	});
	assert.equal(consumeWindowsBrokerInvocationV1(token, WINDOWS_BROKER_SCOPE, 1_003), null);
	assert.equal(getWindowsBrokerStageStateV1(token, WINDOWS_BROKER_SCOPE, 1_003), 'consumed');
	markWindowsBrokerDispatchStartedV1(token, WINDOWS_BROKER_SCOPE);
	assert.equal(getWindowsBrokerStageStateV1(token, WINDOWS_BROKER_SCOPE, 1_004), 'dispatch-started');
	assert.deepEqual(cancelWindowsBrokerStageV1(token, WINDOWS_BROKER_SCOPE, 1_005), {
		cancelled: false,
		state: 'dispatch-started',
	});

	const cancellable = 'c'.repeat(32);
	stageWindowsBrokerInvocationV1({
		token: cancellable,
		raw: '{}',
		receipt: 's'.repeat(64),
		scope: WINDOWS_BROKER_SCOPE,
		now: 2_000,
	});
	assert.deepEqual(cancelWindowsBrokerStageV1(cancellable, WINDOWS_BROKER_SCOPE, 2_001), {
		cancelled: true,
		state: 'staged',
	});
	assert.equal(getWindowsBrokerStageStateV1(cancellable, WINDOWS_BROKER_SCOPE, 2_002), 'unknown');

	const expiring = 'e'.repeat(32);
	stageWindowsBrokerInvocationV1({
		token: expiring,
		raw: '{}',
		receipt: 't'.repeat(64),
		scope: WINDOWS_BROKER_SCOPE,
		now: 3_000,
	});
	assert.equal(getWindowsBrokerStageStateV1(expiring, WINDOWS_BROKER_SCOPE, 33_000), 'unknown');
	for (let index = 0; index < 64; index += 1) {
		stageWindowsBrokerInvocationV1({
			token: index.toString(16).padStart(32, '0'),
			raw: '{}',
				receipt: 'u'.repeat(64),
				scope: WINDOWS_BROKER_SCOPE,
			now: 40_000,
		});
	}
	assert.throws(() => stageWindowsBrokerInvocationV1({
		token: 'z'.repeat(32),
		raw: '{}',
		receipt: 'v'.repeat(64),
		scope: WINDOWS_BROKER_SCOPE,
		now: 40_001,
	}), /broker-capacity-full/u);
	clearWindowsBrokerStagesForTestsV1();
});

if (process.platform !== 'win32') {
test('persistent read server dispatches allowlisted tokens and rejects mutation frames', async context => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-persistent-read-vault-'));
	const expectedVaultSha256 = createHash('sha256').update(await realpath(vault)).digest('hex');
	const runtimeRequire = createRequire(import.meta.url);
	(globalThis as { window?: unknown }).window = {
		require: runtimeRequire,
		setInterval,
		clearInterval,
		setTimeout,
		clearTimeout,
	};
	const plugin = {
		manifest: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
		app: { vault: { adapter: { getFullPath: () => vault } } },
	};
	const handle = await startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{
			runtimeMetadata: {
				appVersion: '1.13.3',
				plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
				apiVersion: 1,
			},
		},
	);
	if (!handle.available && handle.reason === 'persistent-read-server-listen-denied') {
		skipUnavailableNativeTransport(context);
		await rm(vault, { recursive: true, force: true });
		return;
	}
	assert.equal(handle.available, true, handle.reason);
	const root = persistentEndpointRootV1();
	const descriptorPath = join(root, `persistent-read-${expectedVaultSha256}.json`);
	const descriptor = JSON.parse(await readFileUtf8(descriptorPath)) as {
		protocolVersion: 1;
		serverInstanceId: string;
		vaultSha256: string;
		endpoint: string;
		authSecret: string;
	};
	const socketPath = descriptor.endpoint;
	const socket = createConnection(socketPath);
	const readFrame = createFrameReader(socket);
	try {
		await new Promise<void>((resolveConnection, rejectConnection) => {
			socket.once('connect', resolveConnection);
			socket.once('error', rejectConnection);
		});
			const authenticatedHello = authenticateTestFrame({
				type: 'hello',
				protocolVersion: 1,
				serverInstanceId: descriptor.serverInstanceId,
				vaultSha256: descriptor.vaultSha256,
				connectionNonce: 'a'.repeat(64),
			}, descriptor.authSecret);
			writeTestFrame(socket, authenticatedHello);
			const hello = await readFrame() as { type?: string; connectionNonce?: string };
			assert.equal(hello.type, 'hello-ack');
			assert.equal(hello.connectionNonce, 'a'.repeat(64));
			const replaySocket = createConnection(socketPath);
			await new Promise<void>((resolveConnection, rejectConnection) => {
				replaySocket.once('connect', resolveConnection);
				replaySocket.once('error', rejectConnection);
			});
			writeTestFrame(replaySocket, authenticatedHello);
			await Promise.race([
				new Promise<void>(resolveClose => replaySocket.once('close', () => resolveClose())),
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => reject(new Error('replayed hello was not rejected')), 1_000);
				}),
			]);

		const token = 'j'.repeat(32);
		const invocation: CliInvocationV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'cli-invocation',
			requestId: 'persistent-health',
			command: 'health',
			mode: 'live',
			clientVersion: '0.1.0-test',
			compatibility: COMPATIBILITY,
			cliContract: { min: 1, max: 1 },
			expectedVaultSha256,
			readinessTimeoutMs: 15_000,
		};
		await publishRequest(token, JSON.stringify(invocation), 0o600);
		writeTestFrame(socket, authenticateTestFrame({
				type: 'request',
				sequence: 1,
				connectionNonce: 'a'.repeat(64),
			requestId: invocation.requestId,
			command: invocation.command,
			requestToken: token,
		}, descriptor.authSecret));
		const response = await readFrame() as {
			type?: string;
			sequence?: number;
			result?: string;
		};
		assert.equal(response.type, 'response');
		assert.equal(response.sequence, 1);
		assert.equal((JSON.parse(response.result ?? '{}') as { ok?: boolean }).ok, true);

		const batchInvocations = ['batch-one', 'batch-two'].map((requestId, index) => ({
			...invocation,
			requestId,
			command: 'health' as const,
			requestToken: String.fromCharCode(108 + index).repeat(32),
		}));
		for (const batchInvocation of batchInvocations) {
			await publishRequest(
				batchInvocation.requestToken,
				JSON.stringify({
					...batchInvocation,
					requestToken: undefined,
				}),
				0o600,
			);
		}
		writeTestFrame(socket, authenticateTestFrame({
				type: 'batch',
				sequence: 2,
				connectionNonce: 'a'.repeat(64),
			requests: batchInvocations.map(batchInvocation => ({
				requestId: batchInvocation.requestId,
				command: batchInvocation.command,
				requestToken: batchInvocation.requestToken,
			})),
		}, descriptor.authSecret));
		const batchResponses = await Promise.all([readFrame(), readFrame()]) as Array<{
			type?: string;
			sequence?: number;
			index?: number;
			requestId?: string;
			result?: string;
		}>;
		assert.ok(batchResponses.every(item => item.type === 'batch-item-response'));
		assert.ok(batchResponses.every(item => item.sequence === 2));
		const orderedBatchResponses = [...batchResponses].sort(
			(left, right) => (left.index ?? -1) - (right.index ?? -1),
		);
		assert.deepEqual(orderedBatchResponses.map(item => item.index), [0, 1]);
		assert.deepEqual(
			orderedBatchResponses.map(item => item.requestId),
			['batch-one', 'batch-two'],
		);
		assert.ok(batchResponses.every(item => (
			(JSON.parse(item.result ?? '{}') as { ok?: boolean }).ok === true
		)));

		const mutationToken = 'k'.repeat(32);
		const mutationPath = await publishRequest(mutationToken, '{}', 0o600);
		writeTestFrame(socket, authenticateTestFrame({
				type: 'request',
				sequence: 3,
				connectionNonce: 'a'.repeat(64),
			requestId: 'mutation-must-not-dispatch',
			command: 'mutation.preview',
			requestToken: mutationToken,
		}, descriptor.authSecret));
		await new Promise<void>(resolveClose => socket.once('close', () => resolveClose()));
		assert.equal((await lstat(mutationPath)).isFile(), true);
		await unlink(mutationPath);
		} finally {
			socket.destroy();
			await handle.close();
			assert.equal((await lstat(descriptorPath)).isFile(), true);
			await assert.rejects(lstat(socketPath));
			await unlink(descriptorPath);
			await rm(vault, { recursive: true, force: true });
	}
});
}

test('persistent read server accepts every V1 read command as a single request', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'all-single-reads');
	if (!harness) return;
	const publications: PersistentRequestPublication[] = [];
	try {
		const readCommands = [
			'health',
			'capabilities',
			'diagnostics',
			'catalog',
			'entity.resolve',
			'task.get',
			'tasks.query',
			'tasks.finder',
			'relationships.get',
			'timers.read',
			'context.build',
		] as const;
		for (const [index, command] of readCommands.entries()) {
			const requestId = `persistent-${command}`;
			const requestToken = createHash('sha256')
				.update(`single:${command}`)
				.digest('hex')
				.slice(0, 32);
			const publication = await publishPersistentRequest(
				harness.descriptor,
				requestToken,
				JSON.stringify(persistentReadInvocation(harness.expectedVaultSha256, requestId, command)),
			);
			publications.push(publication);
			writeTestFrame(harness.socket, authenticateTestFrame({
				type: 'request',
				sequence: index + 1,
				connectionNonce: harness.connectionNonce,
				requestId,
				command,
				requestToken: publication.token,
			}, harness.descriptor.authSecret));
			const response = await harness.readFrame() as {
				type?: string;
				sequence?: number;
				requestId?: string;
				result?: string;
			};
			assert.equal(response.type, 'response', `${command} must be accepted by persistent transport`);
			assert.equal(response.sequence, index + 1);
			assert.equal(response.requestId, requestId);
			const envelope = JSON.parse(response.result ?? 'null') as {
				requestId?: string;
				command?: string;
				failure?: { stage?: string; error?: { code?: string } };
			};
			const decoded = decodeCliResultEnvelopeV1(envelope);
			assert.equal(
				decoded.ok,
				true,
				decoded.ok ? undefined : `${command}:${JSON.stringify(decoded.issues)}`,
			);
			assert.equal(envelope.command, command);
			assert.equal(envelope.requestId, requestId);
			assert.notEqual(envelope.failure?.error?.code, 'invalid-request');
			await assertPersistentRequestDispatched(publication);
		}
	} finally {
		await cleanupPersistentHarness(harness, publications);
	}
});

test('persistent read server accepts an eight-item read batch', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'maximum-read-batch');
	if (!harness) return;
	const publications: PersistentRequestPublication[] = [];
	try {
		const commands = [
			'health',
			'capabilities',
			'diagnostics',
			'catalog',
			'entity.resolve',
			'tasks.finder',
			'relationships.get',
			'timers.read',
		] as const;
		const requests = [] as Array<{
			requestId: string;
			command: (typeof commands)[number];
			requestToken: string;
		}>;
		for (const [index, command] of commands.entries()) {
			const requestId = `persistent-batch-${command}`;
			const publication = await publishPersistentRequest(
				harness.descriptor,
				createHash('sha256').update(`batch:${index}:${command}`).digest('hex').slice(0, 32),
				JSON.stringify(persistentReadInvocation(
					harness.expectedVaultSha256,
					requestId,
					command,
				)),
			);
			publications.push(publication);
			requests.push({ requestId, command, requestToken: publication.token });
		}
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'batch',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requests,
		}, harness.descriptor.authSecret));
		const responses = await Promise.all(requests.map(() => harness.readFrame())) as Array<{
			type?: string;
			sequence?: number;
			index?: number;
			requestId?: string;
			result?: string;
		}>;
		assert.ok(responses.every(response => response.type === 'batch-item-response'));
		assert.ok(responses.every(response => response.sequence === 1));
		const ordered = [...responses].sort((left, right) => (left.index ?? -1) - (right.index ?? -1));
		for (const [index, response] of ordered.entries()) {
			const envelope = JSON.parse(response.result ?? 'null') as {
				requestId?: string;
				command?: string;
				failure?: { error?: { code?: string } };
			};
			const decoded = decodeCliResultEnvelopeV1(envelope);
			assert.equal(decoded.ok, true, decoded.ok ? undefined : JSON.stringify(decoded.issues));
			assert.equal(envelope.command, commands[index]);
			assert.equal(envelope.requestId, requests[index]?.requestId);
			assert.notEqual(envelope.failure?.error?.code, 'invalid-request');
		}
		assert.deepEqual(ordered.map(response => response.index), requests.map((_request, index) => index));
		assert.deepEqual(ordered.map(response => response.requestId), requests.map(request => request.requestId));
		await forEachPersistentRequestSequentially(publications, assertPersistentRequestDispatched);
	} finally {
		await cleanupPersistentHarness(harness, publications);
	}
});

for (const mutationCommand of ['mutation.preview', 'mutation.apply'] as const) {
	test(`persistent read server rejects ${mutationCommand}`, async context => {
		const harness = await createAuthenticatedPersistentReadHarness(context, mutationCommand);
		if (!harness) return;
		const requestToken = createHash('sha256').update(mutationCommand).digest('hex').slice(0, 32);
		const publication = await publishPersistentRequest(harness.descriptor, requestToken, '{}');
		try {
			writeTestFrame(harness.socket, authenticateTestFrame({
				type: 'request',
				sequence: 1,
				connectionNonce: harness.connectionNonce,
				requestId: `persistent-reject-${mutationCommand}`,
				command: mutationCommand,
				requestToken: publication.token,
			}, harness.descriptor.authSecret));
			await withTestTimeout(
				new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
				`${mutationCommand} persistent frame was not rejected`,
			);
			await assertPersistentRequestUnconsumed(publication);
		} finally {
			await cleanupPersistentRequest(publication);
			await harness.cleanup();
		}
	});
}

test('persistent read server rejects a mixed read and mutation batch before dispatch', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'mixed-read-mutation');
	if (!harness) return;
	const requestInputs = [
		{ requestId: 'mixed-health', command: 'health', preferredToken: '1'.repeat(32) },
		{ requestId: 'mixed-mutation', command: 'mutation.apply', preferredToken: '2'.repeat(32) },
	] as const;
	const publications = await Promise.all(
		requestInputs.map(request => publishPersistentRequest(
			harness.descriptor,
			request.preferredToken,
			'{}',
		)),
	);
	const requests = requestInputs.map((request, index) => ({
		requestId: request.requestId,
		command: request.command,
		requestToken: publications[index]?.token ?? assert.fail('missing staged request token'),
	}));
	try {
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'batch',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requests,
		}, harness.descriptor.authSecret));
		await withTestTimeout(
			new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
			'mixed read and mutation batch was not rejected',
		);
		await forEachPersistentRequestSequentially(publications, assertPersistentRequestUnconsumed);
	} finally {
		await cleanupPersistentHarness(harness, publications);
	}
});

test('persistent read server rejects a nine-item batch before dispatch', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'oversized-read-batch');
	if (!harness) return;
	const commands = [
		'health',
		'capabilities',
		'diagnostics',
		'catalog',
		'entity.resolve',
		'task.get',
		'tasks.query',
		'tasks.finder',
		'relationships.get',
	] as const;
	const requestInputs = commands.map((command, index) => ({
		requestId: `oversized-batch-${command}`,
		command,
		preferredToken: createHash('sha256')
			.update(`oversized:${index}:${command}`)
			.digest('hex')
			.slice(0, 32),
	}));
	const publications: PersistentRequestPublication[] = [];
	try {
		for (const request of requestInputs) {
			publications.push(await publishPersistentRequest(
				harness.descriptor,
				request.preferredToken,
				JSON.stringify(persistentReadInvocation(
					harness.expectedVaultSha256,
					request.requestId,
					request.command,
				)),
			));
		}
		const requests = requestInputs.map((request, index) => ({
			requestId: request.requestId,
			command: request.command,
			requestToken: publications[index]?.token ?? assert.fail('missing staged request token'),
		}));
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'batch',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requests,
		}, harness.descriptor.authSecret));
		await withTestTimeout(
			new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
			'oversized persistent batch was not rejected',
		);
		await forEachPersistentRequestSequentially(publications, assertPersistentRequestUnconsumed);
	} finally {
		await cleanupPersistentHarness(harness, publications);
	}
});

test('persistent read server rejects a tampered request HMAC without consuming its token', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'tampered-request-hmac');
	if (!harness) return;
	const requestId = 'tampered-request-hmac';
	const publication = await publishPersistentRequest(
		harness.descriptor,
		createHash('sha256').update(requestId).digest('hex').slice(0, 32),
		JSON.stringify(persistentReadInvocation(harness.expectedVaultSha256, requestId, 'health')),
	);
	try {
		const authenticated = authenticateTestFrame({
			type: 'request',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requestId,
			command: 'health',
			requestToken: publication.token,
		}, harness.descriptor.authSecret);
		writeTestFrame(harness.socket, { ...authenticated, authMac: '0'.repeat(64) });
		await withTestTimeout(
			new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
			'tampered request HMAC was not rejected',
		);
		await assertPersistentRequestUnconsumed(publication);
	} finally {
		await cleanupPersistentRequest(publication);
		await harness.cleanup();
	}
});

test('persistent read server rejects a replayed authenticated hello nonce', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'replayed-hello-nonce');
	if (!harness) return;
	const replaySocket = createConnection(harness.descriptor.endpoint);
	try {
		await new Promise<void>((resolveConnection, rejectConnection) => {
			replaySocket.once('connect', resolveConnection);
			replaySocket.once('error', rejectConnection);
		});
		writeTestFrame(replaySocket, authenticateTestFrame({
			type: 'hello',
			protocolVersion: 1,
			serverInstanceId: harness.descriptor.serverInstanceId,
			vaultSha256: harness.descriptor.vaultSha256,
			connectionNonce: harness.connectionNonce,
		}, harness.descriptor.authSecret));
		await withTestTimeout(
			new Promise<void>(resolveClose => replaySocket.once('close', () => resolveClose())),
			'replayed authenticated hello nonce was not rejected',
		);
	} finally {
		replaySocket.destroy();
		await harness.cleanup();
	}
});

test('persistent read server rejects an initial sequence gap without consuming its token', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'initial-sequence-gap');
	if (!harness) return;
	const requestId = 'initial-sequence-gap';
	const publication = await publishPersistentRequest(
		harness.descriptor,
		createHash('sha256').update(requestId).digest('hex').slice(0, 32),
		JSON.stringify(persistentReadInvocation(harness.expectedVaultSha256, requestId, 'health')),
	);
	try {
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'request',
			sequence: 2,
			connectionNonce: harness.connectionNonce,
			requestId,
			command: 'health',
			requestToken: publication.token,
		}, harness.descriptor.authSecret));
		await withTestTimeout(
			new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
			'initial sequence gap was not rejected',
		);
		await assertPersistentRequestUnconsumed(publication);
	} finally {
		await cleanupPersistentRequest(publication);
		await harness.cleanup();
	}
});

test('persistent read server rejects a replayed sequence without consuming the next token', async context => {
	const harness = await createAuthenticatedPersistentReadHarness(context, 'replayed-request-sequence');
	if (!harness) return;
	const firstRequestId = 'replayed-sequence-first';
	const first = await publishPersistentRequest(
		harness.descriptor,
		createHash('sha256').update(firstRequestId).digest('hex').slice(0, 32),
		JSON.stringify(persistentReadInvocation(
			harness.expectedVaultSha256,
			firstRequestId,
			'health',
		)),
	);
	const secondRequestId = 'replayed-sequence-second';
	let second: PersistentRequestPublication | undefined;
	try {
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'request',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requestId: firstRequestId,
			command: 'health',
			requestToken: first.token,
		}, harness.descriptor.authSecret));
		assert.equal((await harness.readFrame() as { type?: string }).type, 'response');
		await assertPersistentRequestDispatched(first);

		second = await publishPersistentRequest(
			harness.descriptor,
			createHash('sha256').update(secondRequestId).digest('hex').slice(0, 32),
			JSON.stringify(persistentReadInvocation(
				harness.expectedVaultSha256,
				secondRequestId,
				'health',
			)),
		);
		writeTestFrame(harness.socket, authenticateTestFrame({
			type: 'request',
			sequence: 1,
			connectionNonce: harness.connectionNonce,
			requestId: secondRequestId,
			command: 'health',
			requestToken: second.token,
		}, harness.descriptor.authSecret));
		await withTestTimeout(
			new Promise<void>(resolveClose => harness.socket.once('close', () => resolveClose())),
			'replayed request sequence was not rejected',
		);
		await assertPersistentRequestUnconsumed(second);
	} finally {
		await cleanupPersistentRequest(first);
		if (second) await cleanupPersistentRequest(second);
		await harness.cleanup();
	}
});

test('persistent read startup and close preserve a successor descriptor', async context => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-persistent-successor-vault-'));
	installPersistentReadTestWindow();
	const plugin = persistentReadTestPlugin(vault);
	let firstHandle: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let successorHandle: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let staleStart: Promise<AgentRuntimePersistentReadServerHandleV1> | undefined;
	let descriptorPath: string | undefined;
	let releaseStaleCommit: (() => void) | undefined;
	(context as unknown as {
		after(cleanup: () => Promise<void>): void;
	}).after(async () => {
		releaseStaleCommit?.();
		const staleHandle = await staleStart?.catch(() => undefined);
		await staleHandle?.close().catch(() => undefined);
		await successorHandle?.close().catch(() => undefined);
		await firstHandle?.close().catch(() => undefined);
		if (descriptorPath) await unlink(descriptorPath).catch(() => undefined);
		await rm(vault, { recursive: true, force: true });
	});
	const first = await startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{ runtimeMetadata: persistentReadTestMetadata() },
	);
	firstHandle = first;
	if (!first.available && first.reason === 'persistent-read-server-listen-denied') {
		skipUnavailableNativeTransport(context);
		return;
	}
	assert.equal(first.available, true, first.reason);
	const vaultSha256 = await computeRunningVaultSha256V1(nodeApi, plugin.app.vault.adapter);
	descriptorPath = join(persistentEndpointRootV1(), `persistent-read-${vaultSha256}.json`);
	const firstDescriptor = JSON.parse(await readFileUtf8(descriptorPath)) as {
		serverInstanceId: string;
		endpoint: string;
	};
	const successor = await startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{ runtimeMetadata: persistentReadTestMetadata() },
	);
	successorHandle = successor;
	assert.equal(successor.available, true, successor.reason);
	const successorDescriptor = JSON.parse(await readFileUtf8(descriptorPath)) as {
		serverInstanceId: string;
		endpoint: string;
	};
	assert.notEqual(successorDescriptor.serverInstanceId, firstDescriptor.serverInstanceId);
	await first.close();
	assert.equal(
		(JSON.parse(await readFileUtf8(descriptorPath)) as { serverInstanceId: string }).serverInstanceId,
		successorDescriptor.serverInstanceId,
	);

	let staleStartCurrent = true;
	let signalStaleCommit: (() => void) | undefined;
	const staleCommitReached = new Promise<void>(resolveCommit => {
		signalStaleCommit = resolveCommit;
	});
	const staleCommitRelease = new Promise<void>(resolveRelease => {
		releaseStaleCommit = resolveRelease;
	});
	const pendingStaleStart = startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{
			runtimeMetadata: persistentReadTestMetadata(),
			isStartCurrent: () => staleStartCurrent,
			beforeDescriptorCommit: async publication => {
				if (publication !== 1) return;
				signalStaleCommit?.();
				await staleCommitRelease;
			},
		},
	);
	staleStart = pendingStaleStart;
	await withTestTimeout(staleCommitReached, 'stale descriptor publication did not reach commit');
	staleStartCurrent = false;
	releaseStaleCommit?.();
	const stale = await pendingStaleStart;
	assert.equal(stale.available, false);
	assert.equal(
		(JSON.parse(await readFileUtf8(descriptorPath)) as { serverInstanceId: string }).serverInstanceId,
		successorDescriptor.serverInstanceId,
	);

	await successor.close();
	assert.equal((await lstat(descriptorPath)).isFile(), true);
	if (process.platform !== 'win32') {
		await assert.rejects(lstat(firstDescriptor.endpoint));
		await assert.rejects(lstat(successorDescriptor.endpoint));
	}
	await unlink(descriptorPath);
});

if (process.platform === 'win32') {
test('persistent read rejects a broad existing descriptor ACL', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-persistent-broad-acl-vault-'));
	installPersistentReadTestWindow();
	const plugin = persistentReadTestPlugin(vault);
	let firstHandle: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let descriptorPath: string | undefined;
	try {
		firstHandle = await startAgentRuntimePersistentReadServerV1(
			plugin as never,
			createRuntime(),
			{ runtimeMetadata: persistentReadTestMetadata() },
		);
		assert.equal(firstHandle.available, true, firstHandle.reason);
		const vaultSha256 = await computeRunningVaultSha256V1(nodeApi, plugin.app.vault.adapter);
		descriptorPath = join(persistentEndpointRootV1(), `persistent-read-${vaultSha256}.json`);
		const descriptorBeforeTamper = await readFileUtf8(descriptorPath);
		broadenWindowsAclForTest(descriptorPath, 'file');
		const refused = await startAgentRuntimePersistentReadServerV1(
			plugin as never,
			createRuntime(),
			{ runtimeMetadata: persistentReadTestMetadata() },
		);
		assert.equal(refused.available, false);
		assert.equal(refused.reason, 'windows-owner-only-acl-required');
		assert.equal(await readFileUtf8(descriptorPath), descriptorBeforeTamper);
	} finally {
		await firstHandle?.close().catch(() => undefined);
		if (descriptorPath) await unlink(descriptorPath).catch(() => undefined);
		await rm(vault, { recursive: true, force: true });
	}
});
}

test('persistent read close waits for and cancels an in-flight descriptor refresh', async context => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-persistent-refresh-close-vault-'));
	installPersistentReadTestWindow();
	const plugin = persistentReadTestPlugin(vault);
	let handleForCleanup: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let descriptorPath: string | undefined;
	let releaseRefreshCommit: (() => void) | undefined;
	(context as unknown as {
		after(cleanup: () => Promise<void>): void;
	}).after(async () => {
		releaseRefreshCommit?.();
		await handleForCleanup?.close().catch(() => undefined);
		if (descriptorPath) await unlink(descriptorPath).catch(() => undefined);
		await rm(vault, { recursive: true, force: true });
	});
	let signalRefreshCommit: (() => void) | undefined;
	const refreshCommitReached = new Promise<void>(resolveCommit => {
		signalRefreshCommit = resolveCommit;
	});
	const refreshCommitRelease = new Promise<void>(resolveRelease => {
		releaseRefreshCommit = resolveRelease;
	});
	const handle = await startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{
			runtimeMetadata: persistentReadTestMetadata(),
			descriptorRefreshMs: 1,
			beforeDescriptorCommit: async publication => {
				if (publication !== 2) return;
				signalRefreshCommit?.();
				await refreshCommitRelease;
			},
		},
	);
	handleForCleanup = handle;
	if (!handle.available && handle.reason === 'persistent-read-server-listen-denied') {
		skipUnavailableNativeTransport(context);
		return;
	}
	assert.equal(handle.available, true, handle.reason);
	const vaultSha256 = await computeRunningVaultSha256V1(nodeApi, plugin.app.vault.adapter);
	descriptorPath = join(persistentEndpointRootV1(), `persistent-read-${vaultSha256}.json`);
	const descriptorBeforeRefresh = await readFileUtf8(descriptorPath);
	await withTestTimeout(refreshCommitReached, 'descriptor refresh did not reach commit');
	let closeSettled = false;
	const closing = handle.close().then(() => {
		closeSettled = true;
	});
	await Promise.resolve();
	assert.equal(closeSettled, false);
	releaseRefreshCommit?.();
	await closing;
	assert.equal(await readFileUtf8(descriptorPath), descriptorBeforeRefresh);
	await unlink(descriptorPath);
});

test('persistent read replay-cache exhaustion rotates the server handle', async context => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-persistent-replay-limit-vault-'));
	installPersistentReadTestWindow();
	const plugin = persistentReadTestPlugin(vault);
	let handleForCleanup: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let descriptorPath: string | undefined;
	let firstSocket: Socket | undefined;
	let secondSocket: Socket | undefined;
	(context as unknown as {
		after(cleanup: () => Promise<void>): void;
	}).after(async () => {
		firstSocket?.destroy();
		secondSocket?.destroy();
		await handleForCleanup?.close().catch(() => undefined);
		if (descriptorPath) await unlink(descriptorPath).catch(() => undefined);
		await rm(vault, { recursive: true, force: true });
	});
	const handle = await startAgentRuntimePersistentReadServerV1(
		plugin as never,
		createRuntime(),
		{
			runtimeMetadata: persistentReadTestMetadata(),
			replayCacheLimit: 1,
		},
	);
	handleForCleanup = handle;
	if (!handle.available && handle.reason === 'persistent-read-server-listen-denied') {
		skipUnavailableNativeTransport(context);
		return;
	}
	assert.equal(handle.available, true, handle.reason);
	const vaultSha256 = await computeRunningVaultSha256V1(nodeApi, plugin.app.vault.adapter);
	descriptorPath = join(persistentEndpointRootV1(), `persistent-read-${vaultSha256}.json`);
	const descriptor = JSON.parse(await readFileUtf8(descriptorPath)) as {
		serverInstanceId: string;
		vaultSha256: string;
		endpoint: string;
		authSecret: string;
	};
	firstSocket = createConnection(descriptor.endpoint);
	const firstReadFrame = createFrameReader(firstSocket);
	await new Promise<void>((resolveConnection, rejectConnection) => {
		firstSocket.once('connect', resolveConnection);
		firstSocket.once('error', rejectConnection);
	});
	writeTestFrame(firstSocket, authenticateTestFrame({
		type: 'hello',
		protocolVersion: 1,
		serverInstanceId: descriptor.serverInstanceId,
		vaultSha256: descriptor.vaultSha256,
		connectionNonce: 'e'.repeat(64),
	}, descriptor.authSecret));
	assert.equal((await firstReadFrame() as { type?: string }).type, 'hello-ack');

	const unavailable = new Promise<string>(resolveUnavailable => {
		handle.onUnavailable(resolveUnavailable);
	});
	secondSocket = createConnection(descriptor.endpoint);
	await new Promise<void>((resolveConnection, rejectConnection) => {
		secondSocket.once('connect', resolveConnection);
		secondSocket.once('error', rejectConnection);
	});
	writeTestFrame(secondSocket, authenticateTestFrame({
		type: 'hello',
		protocolVersion: 1,
		serverInstanceId: descriptor.serverInstanceId,
		vaultSha256: descriptor.vaultSha256,
		connectionNonce: 'f'.repeat(64),
	}, descriptor.authSecret));
	assert.equal(
		await withTestTimeout(unavailable, 'replay-cache exhaustion did not fail the server'),
		'persistent-read-replay-cache-exhausted',
	);
	assert.equal(handle.available, false);
	firstSocket.destroy();
	secondSocket.destroy();
	await handle.close();
	assert.equal((await lstat(descriptorPath)).isFile(), true);
	await unlink(descriptorPath);
});

if (process.platform !== 'win32') {
test('owner-only request files are consumed once and removed', async () => {
	const token = 'a'.repeat(32);
	const requestPath = await publishRequest(token, '{"ok":true}', 0o600);
	const consumed = await readAndConsumeAgentRuntimeRequestFileV1(nodeApi, token);
	assert.equal(consumed.raw, '{"ok":true}');
	assert.equal(consumed.inputBytes, 11);
	await assert.rejects(lstat(requestPath));
});

test('unsafe request mode fails closed and safely cleans the same inode', async () => {
	const token = 'b'.repeat(32);
	const requestPath = await publishRequest(token, '{}', 0o644);
	await assert.rejects(
		readAndConsumeAgentRuntimeRequestFileV1(nodeApi, token),
		/request-permissions-not-owner-only/u,
	);
	await assert.rejects(lstat(requestPath));
});

test('request symlinks fail closed without reading their target', async () => {
	const token = 'e'.repeat(32);
	const root = getAgentRuntimeRequestRootV1(nodeApi);
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	const targetPath = join(tmpdir(), `${token}.outside`);
	const requestPath = join(root, `${token}.request.json`);
	await writeFile(targetPath, '{"secret":true}', { mode: 0o600 });
	await symlink(targetPath, requestPath);
	try {
		await assert.rejects(
			readAndConsumeAgentRuntimeRequestFileV1(nodeApi, token),
			/request-not-regular-file/u,
		);
		assert.equal((await lstat(requestPath)).isSymbolicLink(), true);
	} finally {
		await unlink(requestPath).catch(() => undefined);
		await unlink(targetPath).catch(() => undefined);
	}
});

test('request inode replacement fails closed and preserves the replacement', async () => {
	const token = 'f'.repeat(32);
	const requestPath = await publishRequest(token, '{"original":true}', 0o600);
	const originalStat = await lstat(requestPath);
	let swapped = false;
	const swappingNodeApi: AgentRuntimeDesktopNodeApiV1 = {
		...nodeApi,
		open: async (path, flags) => {
			if (!swapped) {
				swapped = true;
				await unlink(path);
				await writeFile(path, '{"replacement":true}', { mode: 0o600 });
			}
			const handle = await nodeApi.open(path, flags);
			return {
				...handle,
				stat: async () => {
					const replacementStat = await handle.stat();
					return {
						...replacementStat,
						dev: Number(originalStat.dev),
						ino: Number(originalStat.ino),
						size: Number(originalStat.size),
						ctimeMs: Number(originalStat.ctimeMs) + 1,
					};
				},
			};
		},
	};
	await assert.rejects(
		readAndConsumeAgentRuntimeRequestFileV1(swappingNodeApi, token),
		/request-file-changed/u,
	);
	assert.equal(await readFileUtf8(requestPath), '{"replacement":true}');
	await unlink(requestPath);
});

test('dispatcher verifies vault identity, compatibility and command binding', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-cli-vault-'));
	try {
		const expectedVaultSha256 = createHash('sha256').update(await realpath(vault)).digest('hex');
		const invocation: CliInvocationV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'cli-invocation',
			requestId: 'health-test',
			command: 'health',
			mode: 'live',
			clientVersion: '0.1.0-test',
			compatibility: COMPATIBILITY,
			cliContract: { min: 1, max: 1 },
			expectedVaultSha256,
			readinessTimeoutMs: 15_000,
		};
		await publishRequest('c'.repeat(32), JSON.stringify(invocation), 0o600);
		const timings: RuntimeTimingSpanV1[] = [];
		let now = 10;
		const output = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(),
				nodeApi,
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => {
					now += 1;
					return now;
				},
				timingSink: { emit: value => timings.push(value) },
			},
			{
				expectedCommand: 'health',
				requestToken: 'c'.repeat(32),
				nodeApiLoadDurationMs: 4.25,
			},
		);
		const envelope = JSON.parse(output) as Record<string, unknown>;
		assert.equal(envelope.ok, true);
		assert.deepEqual(envelope.vaultIdentity, { expectedMatch: true });
		const decodedSuccess = decodeCliResultEnvelopeV1(envelope);
		assert.equal(
			decodedSuccess.ok,
			true,
			decodedSuccess.ok ? undefined : JSON.stringify(decodedSuccess.issues),
		);
		assert.deepEqual(
			timings.map(value => ({
				requestId: value.requestId,
				flow: value.flow,
				span: value.span,
			})),
			[
				{ requestId: 'health-test', flow: 'read', span: 'node-api-load' },
				{ requestId: 'health-test', flow: 'read', span: 'secure-request-consume' },
				{ requestId: 'health-test', flow: 'read', span: 'running-vault-identity' },
			],
		);
		assert.equal(timings[0]?.durationMs, 4.25);
		assert.ok((timings[1]?.durationMs ?? 0) > 0);
		assert.ok((timings[2]?.durationMs ?? 0) > 0);

		await publishRequest('d'.repeat(32), JSON.stringify(invocation), 0o600);
		const mismatchOutput = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(),
				nodeApi,
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => 10,
			},
			{ expectedCommand: 'catalog', requestToken: 'd'.repeat(32) },
		);
		const mismatchEnvelope = JSON.parse(mismatchOutput) as {
			ok: boolean;
			failure?: { stage?: string; error?: { code?: string } };
		};
		assert.equal(mismatchEnvelope.ok, false);
		assert.equal(mismatchEnvelope.failure?.stage, 'client-input');
		assert.equal(mismatchEnvelope.failure?.error?.code, 'invalid-request');
		const decodedFailure = decodeCliResultEnvelopeV1(mismatchEnvelope);
		assert.equal(
			decodedFailure.ok,
			true,
			decodedFailure.ok ? undefined : JSON.stringify(decodedFailure.issues),
		);

		await publishRequest('i'.repeat(32), JSON.stringify(invocation), 0o600);
		const requestIdMismatchOutput = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(),
				nodeApi,
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => 10,
			},
			{
				expectedCommand: 'health',
				expectedRequestId: 'different-frame-request',
				requestToken: 'i'.repeat(32),
			},
		);
		const requestIdMismatchEnvelope = JSON.parse(requestIdMismatchOutput) as {
			ok: boolean;
			failure?: { stage?: string; error?: { code?: string } };
		};
		assert.equal(requestIdMismatchEnvelope.ok, false);
		assert.equal(requestIdMismatchEnvelope.failure?.stage, 'client-input');
		assert.equal(requestIdMismatchEnvelope.failure?.error?.code, 'invalid-request');
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test('dispatcher fails immediately for a terminal Runtime startup error', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-cli-fatal-vault-'));
	try {
		const invocation = await catalogInvocation(vault, 'fatal-runtime', 15_000);
		await publishRequest('g'.repeat(32), JSON.stringify(invocation), 0o600);
		const fatalHealth: RuntimeHealthV1 = {
			...createHealth(),
			ok: false,
			lifecyclePhase: 'booting',
			admission: { reads: false, writes: false },
			freshness: {
				source: 'live-runtime',
				coherence: 'unverified',
				observedAt: '2026-07-23T12:00:00.000Z',
				settled: false,
			},
			error: {
				contractVersion: 1,
				code: 'internal-error',
				reason: 'Synthetic fatal startup failure.',
				retryable: false,
				action: 'report-bug',
			},
		};
		const output = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(fatalHealth),
				nodeApi: { ...nodeApi, delay: async () => assert.fail('fatal health must not poll') },
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => 10,
			},
			{ expectedCommand: 'catalog', requestToken: 'g'.repeat(32) },
		);
		const envelope = JSON.parse(output) as {
			ok: boolean;
			failure?: { stage?: string; error?: { reason?: string; retryable?: boolean } };
		};
		assert.equal(envelope.ok, false);
		assert.equal(envelope.failure?.stage, 'readiness');
		assert.equal(envelope.failure?.error?.reason, 'Synthetic fatal startup failure.');
		assert.equal(envelope.failure?.error?.retryable, false);
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test('dispatcher readiness deadline includes pre-admission work', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-cli-deadline-vault-'));
	try {
		const invocation = await catalogInvocation(vault, 'total-budget', 50);
		await publishRequest('h'.repeat(32), JSON.stringify(invocation), 0o600);
		const settlingHealth: RuntimeHealthV1 = {
			...createHealth(),
			lifecyclePhase: 'settling',
			admission: { reads: false, writes: false },
			freshness: {
				source: 'live-runtime',
				coherence: 'settling',
				observedAt: '2026-07-23T12:00:00.000Z',
				settled: false,
			},
			retryAfterMs: 500,
		};
		let clockReads = 0;
		const output = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(settlingHealth),
				nodeApi: { ...nodeApi, delay: async () => assert.fail('expired total budget must not poll') },
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => (clockReads++ === 0 ? 0 : 100),
			},
			{ expectedCommand: 'catalog', requestToken: 'h'.repeat(32) },
		);
		const envelope = JSON.parse(output) as {
			ok: boolean;
			failure?: { stage?: string; error?: { code?: string } };
		};
		assert.equal(envelope.ok, false);
		assert.equal(envelope.failure?.stage, 'readiness');
		assert.equal(envelope.failure?.error?.code, 'live-settling');
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test('dispatcher rejects a ready sample that arrives after the total deadline', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-cli-late-ready-vault-'));
	try {
		const invocation = await catalogInvocation(vault, 'late-ready', 50);
		await publishRequest('j'.repeat(32), JSON.stringify(invocation), 0o600);
		let clockReads = 0;
		const output = await dispatchAgentRuntimeCliV1(
			{
				runtime: createRuntime(createHealth()),
				nodeApi: { ...nodeApi, delay: async () => assert.fail('late ready sample must not poll') },
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => (clockReads++ === 0 ? 0 : 100),
			},
			{ expectedCommand: 'catalog', requestToken: 'j'.repeat(32) },
		);
		const envelope = JSON.parse(output) as {
			ok: boolean;
			failure?: { stage?: string; error?: { code?: string } };
		};
		assert.equal(envelope.ok, false);
		assert.equal(envelope.failure?.stage, 'readiness');
		assert.equal(envelope.failure?.error?.code, 'live-settling');
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});

test('best-effort transport warning respects the V1 warning cap', async () => {
	const vault = await mkdtemp(join(tmpdir(), 'operon-cli-warning-cap-vault-'));
	try {
		const invocation = await catalogInvocation(vault, 'warning-cap', 15_000);
		if (invocation.request?.kind === 'catalog') invocation.request.consistency = 'best-effort';
		await publishRequest('i'.repeat(32), JSON.stringify(invocation), 0o600);
		const health: RuntimeHealthV1 = {
			...createHealth(),
			capabilities: [
				...createHealth().capabilities,
				{ id: 'catalog.read', availability: 'available', stability: 'stable' },
			],
		};
		const baseRuntime = createRuntime(health);
		const runtime: OperonAgentRuntimeCoreV1 = {
			...baseRuntime,
			hasCapability: capability => (
				capability === 'system.health'
				|| capability === 'system.capabilities'
				|| capability === 'catalog.read'
			),
			catalog: {
				snapshot: async () => ({
					warnings: Array.from({ length: 256 }, (_, index) => ({
						code: `synthetic-${index}`,
						message: `Synthetic warning ${index}.`,
					})),
				}) as never,
			},
		};
		const output = await dispatchAgentRuntimeCliV1(
			{
				runtime,
				nodeApi,
				vaultAdapter: { getFullPath: () => vault },
				runtimeMetadata: {
					appVersion: '1.13.3',
					plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
					apiVersion: 1,
				},
				monotonicNow: () => 10,
			},
			{ expectedCommand: 'catalog', requestToken: 'i'.repeat(32) },
		);
		const envelope = JSON.parse(output) as {
			warnings: Array<{ code: string }>;
		};
		assert.equal(envelope.warnings.length, 256);
		assert.equal(envelope.warnings[0]?.code, 'best-effort-consistency');
	} finally {
		await rm(vault, { recursive: true, force: true });
	}
});
}

function createRuntime(health: RuntimeHealthV1 = createHealth()): OperonAgentRuntimeCoreV1 {
	const unsupported = async (): Promise<never> => {
		throw new Error('not used');
	};
	return {
		apiVersion: 1,
		hasCapability: capability => capability === 'system.health' || capability === 'system.capabilities',
		system: {
			health: async () => health,
			capabilities: () => health.capabilities,
			diagnostics: async () => ({
				contractVersion: 1,
				kind: 'runtime-diagnostics',
				health,
				capabilities: health.capabilities,
					transport: { channel: 'native-cli', available: true },
				warnings: [],
			}),
		},
		catalog: { snapshot: unsupported },
		entities: { resolve: unsupported },
		tasks: { get: unsupported, query: unsupported, find: unsupported },
		relationships: { get: unsupported },
		context: { build: unsupported },
		timers: { read: unsupported },
		mutations: { preview: unsupported, apply: unsupported },
	};
}

async function catalogInvocation(
	vault: string,
	requestId: string,
	readinessTimeoutMs: number,
): Promise<CliInvocationV1> {
	return {
		contractVersion: 1,
		kind: 'cli-invocation',
		requestId,
		command: 'catalog',
		mode: 'live',
		clientVersion: '0.1.0-test',
		compatibility: COMPATIBILITY,
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256: createHash('sha256').update(await realpath(vault)).digest('hex'),
		readinessTimeoutMs,
		request: {
			contractVersion: 1,
			requestId,
			kind: 'catalog',
			consistency: 'live-verified',
		},
	};
}

function createHealth(): RuntimeHealthV1 {
	return {
		apiVersion: 1,
		contractVersion: CONTRACT_VERSION_V1,
		ok: true,
		lifecyclePhase: 'ready',
		v8PersistencePhase: 'idle',
		compatibility: COMPATIBILITY,
		capabilities: CLI_COMMANDS_V1.slice(0, 2).map(command => ({
			id: command === 'health' ? 'system.health' : 'system.capabilities',
			availability: 'available',
			stability: 'stable',
		})),
		freshness: {
			source: 'live-runtime',
			coherence: 'verified',
			observedAt: '2026-07-23T12:00:00.000Z',
			settled: true,
		},
		admission: { reads: true, writes: true },
		warnings: [],
	};
}

async function publishRequest(token: string, payload: string, mode: number): Promise<string> {
	const root = getAgentRuntimeRequestRootV1(nodeApi);
	await mkdir(root, { recursive: true, mode: 0o700 });
	await chmod(root, 0o700);
	const requestPath = join(root, `${token}.request.json`);
	await writeFile(requestPath, payload, { mode });
	await chmod(requestPath, mode);
	return requestPath;
}

async function publishPersistentRequest(
	descriptor: PersistentReadTestDescriptor,
	preferredToken: string,
	payload: string,
): Promise<PersistentRequestPublication> {
	if (process.platform !== 'win32') {
		return {
			token: preferredToken,
			requestPath: await publishRequest(preferredToken, payload, 0o600),
		};
	}
	const response = await sendBrokerControlRequest(descriptor, {
		type: 'stage',
		invocation: payload,
	});
	assert.equal(response.state, 'staged');
	assert.match(response.requestToken ?? '', /^[A-Za-z0-9_-]{32}$/u);
	assert.match(response.stagingReceipt ?? '', /^[a-f0-9]{64}$/u);
	return { token: response.requestToken as string, descriptor };
}

async function assertPersistentRequestDispatched(
	publication: PersistentRequestPublication,
): Promise<void> {
	if (publication.descriptor) {
		const response = await sendBrokerControlRequest(publication.descriptor, {
			type: 'status',
			requestToken: publication.token,
		});
		assert.equal(response.state, 'consumed');
		return;
	}
	if (!publication.requestPath) assert.fail('persistent request publication has no backing store');
	await assert.rejects(lstat(publication.requestPath));
}

async function assertPersistentRequestUnconsumed(
	publication: PersistentRequestPublication,
): Promise<void> {
	if (publication.descriptor) {
		const response = await sendBrokerControlRequest(publication.descriptor, {
			type: 'status',
			requestToken: publication.token,
		});
		assert.equal(response.state, 'staged');
		return;
	}
	if (!publication.requestPath) assert.fail('persistent request publication has no backing store');
	assert.equal((await lstat(publication.requestPath)).isFile(), true);
}

async function cleanupPersistentRequest(publication: PersistentRequestPublication): Promise<void> {
	if (publication.descriptor) {
		const status = await sendBrokerControlRequest(publication.descriptor, {
			type: 'status',
			requestToken: publication.token,
		});
		if (status.state === 'staged') {
			const cancelled = await sendBrokerControlRequest(publication.descriptor, {
				type: 'cancel',
				requestToken: publication.token,
			});
			assert.equal(cancelled.cancelled, true);
			assert.equal(cancelled.state, 'staged');
			const afterCancel = await sendBrokerControlRequest(publication.descriptor, {
				type: 'status',
				requestToken: publication.token,
			});
			assert.equal(afterCancel.state, 'unknown');
		}
		return;
	}
	if (publication.requestPath) await unlink(publication.requestPath).catch(() => undefined);
}

async function forEachPersistentRequestSequentially(
	publications: readonly PersistentRequestPublication[],
	operation: (publication: PersistentRequestPublication) => Promise<void>,
): Promise<void> {
	for (const publication of publications) await operation(publication);
}

async function cleanupPersistentHarness(
	harness: { cleanup(): Promise<void> },
	publications: readonly PersistentRequestPublication[],
): Promise<void> {
	let firstError: unknown;
	for (const publication of publications) {
		try {
			await cleanupPersistentRequest(publication);
		} catch (error) {
			firstError ??= error;
		}
	}
	try {
		await harness.cleanup();
	} catch (error) {
		firstError ??= error;
	}
	if (firstError !== undefined) throw firstError;
}

async function sendBrokerControlRequest(
	descriptor: PersistentReadTestDescriptor,
	request: {
		readonly type: 'stage';
		readonly invocation: string;
	} | {
		readonly type: 'status' | 'cancel';
		readonly requestToken: string;
	},
): Promise<{
	type?: string;
	state?: string;
	cancelled?: boolean;
	requestToken?: string;
	stagingReceipt?: string;
}> {
	const socket = createConnection(descriptor.endpoint);
	const readFrame = createFrameReader(socket);
	brokerConnectionSequence += 1;
	const connectionNonce = createHash('sha256')
		.update(`broker-control:${brokerConnectionSequence}:${request.type}`)
		.digest('hex');
	try {
		await new Promise<void>((resolveConnection, rejectConnection) => {
			socket.once('connect', resolveConnection);
			socket.once('error', rejectConnection);
		});
		writeTestFrame(socket, authenticateTestFrame({
			type: 'hello',
			protocolVersion: 1,
			serverInstanceId: descriptor.serverInstanceId,
			vaultSha256: descriptor.vaultSha256,
			connectionNonce,
		}, descriptor.authSecret));
		assert.equal((await readFrame() as { type?: string }).type, 'hello-ack');
		const requestId = `broker-${request.type}-${brokerConnectionSequence}`;
		writeTestFrame(socket, authenticateTestFrame({
			...request,
			sequence: 1,
			connectionNonce,
			requestId,
		}, descriptor.authSecret));
		const response = await readFrame() as {
			type?: string;
			sequence?: number;
			requestId?: string;
			state?: string;
			cancelled?: boolean;
			requestToken?: string;
			stagingReceipt?: string;
		};
		assert.equal(response.type, 'broker-response');
		assert.equal(response.sequence, 1);
		assert.equal(response.requestId, requestId);
		return response;
	} finally {
		socket.destroy();
	}
}

function skipUnavailableNativeTransport(context: { skip(message: string): void }): void {
	if (REQUIRE_NATIVE_TRANSPORT) {
		throw new Error('required native transport could not listen');
	}
	context.skip('sandbox does not permit native transport listen');
}

function installPersistentReadTestWindow(): void {
	const runtimeRequire = createRequire(import.meta.url);
	(globalThis as { window?: unknown }).window = {
		require: runtimeRequire,
		setInterval,
		clearInterval,
		setTimeout,
		clearTimeout,
	};
}

function persistentReadTestPlugin(vaultPath: string): {
	manifest: { id: string; version: string; minAppVersion: string };
	app: { vault: { adapter: { getFullPath: () => string } } };
} {
	return {
		manifest: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
		app: { vault: { adapter: { getFullPath: () => vaultPath } } },
	};
}

function persistentReadTestMetadata() {
	return {
		appVersion: '1.13.3',
		plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.7.2' },
		apiVersion: 1,
	} as const;
}

async function createAuthenticatedPersistentReadHarness(
	context: { skip(message: string): void },
	label: string,
) {
	const vault = await mkdtemp(join(tmpdir(), `operon-persistent-${label}-vault-`));
	let handle: AgentRuntimePersistentReadServerHandleV1 | undefined;
	let socket: Socket | undefined;
	let descriptorPath: string | undefined;
	try {
		installPersistentReadTestWindow();
		const plugin = persistentReadTestPlugin(vault);
		const expectedVaultSha256 = await computeRunningVaultSha256V1(
			nodeApi,
			plugin.app.vault.adapter,
		);
		handle = await startAgentRuntimePersistentReadServerV1(
			plugin as never,
			createRuntime(),
			{ runtimeMetadata: persistentReadTestMetadata() },
		);
		if (!handle.available && handle.reason === 'persistent-read-server-listen-denied') {
			skipUnavailableNativeTransport(context);
			await handle.close().catch(() => undefined);
			await rm(vault, { recursive: true, force: true });
			return null;
		}
		assert.equal(handle.available, true, handle.reason);
		descriptorPath = join(
			persistentEndpointRootV1(),
			`persistent-read-${expectedVaultSha256}.json`,
		);
		const descriptor = JSON.parse(await readFileUtf8(descriptorPath)) as {
			protocolVersion: 1;
			serverInstanceId: string;
			vaultSha256: string;
			endpointKind: 'unix-domain-socket' | 'windows-named-pipe';
			endpoint: string;
			authSecret: string;
		};
		assert.equal(
			descriptor.endpointKind,
			process.platform === 'win32' ? 'windows-named-pipe' : 'unix-domain-socket',
		);
		socket = createConnection(descriptor.endpoint);
		const readFrame = createFrameReader(socket);
		await new Promise<void>((resolveConnection, rejectConnection) => {
			socket?.once('connect', resolveConnection);
			socket?.once('error', rejectConnection);
		});
		const connectionNonce = createHash('sha256').update(`nonce:${label}`).digest('hex');
		writeTestFrame(socket, authenticateTestFrame({
			type: 'hello',
			protocolVersion: 1,
			serverInstanceId: descriptor.serverInstanceId,
			vaultSha256: descriptor.vaultSha256,
			connectionNonce,
		}, descriptor.authSecret));
		assert.equal((await readFrame() as { type?: string }).type, 'hello-ack');
		const activeHandle = handle;
		const activeSocket = socket;
		const activeDescriptorPath = descriptorPath;
		return {
			expectedVaultSha256,
			descriptor,
			socket: activeSocket,
			readFrame,
			connectionNonce,
			cleanup: async (): Promise<void> => {
				activeSocket.destroy();
				await activeHandle.close();
				await unlink(activeDescriptorPath).catch(() => undefined);
				await rm(vault, { recursive: true, force: true });
				if (process.platform === 'win32') clearWindowsBrokerStagesForTestsV1();
			},
		};
	} catch (error) {
		socket?.destroy();
		await handle?.close().catch(() => undefined);
		if (descriptorPath) await unlink(descriptorPath).catch(() => undefined);
		await rm(vault, { recursive: true, force: true });
		throw error;
	}
}

function persistentReadInvocation(
	expectedVaultSha256: string,
	requestId: string,
	command: (typeof CLI_COMMANDS_V1)[number],
): CliInvocationV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'cli-invocation',
		requestId,
		command,
		mode: 'live',
		clientVersion: '0.1.0-test',
		compatibility: COMPATIBILITY,
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256,
		readinessTimeoutMs: 15_000,
		...(() => {
			const base = {
				contractVersion: CONTRACT_VERSION_V1,
				requestId,
				consistency: 'live-verified' as const,
			};
			const selector = { kind: 'operon-id' as const, operonId: 'abc1234' };
			switch (command) {
				case 'health':
				case 'capabilities':
				case 'diagnostics':
					return {};
				case 'catalog':
					return { request: { ...base, kind: 'catalog' as const } };
				case 'entity.resolve':
					return { request: { ...base, kind: 'entity-resolve' as const, selector } };
				case 'task.get':
					return { request: { ...base, kind: 'task-get' as const, selector } };
				case 'tasks.query':
					return { request: { ...base, kind: 'task-query' as const } };
				case 'tasks.finder':
					return { request: { ...base, kind: 'task-finder' as const } };
				case 'relationships.get':
					return { request: { ...base, kind: 'relationship' as const, selector } };
				case 'context.build':
					return {
						request: {
							...base,
							kind: 'context' as const,
							purpose: 'read' as const,
							projection: 'exact-task' as const,
							selector,
						},
					};
				case 'timers.read':
					return { request: { ...base, kind: 'timer-read' as const } };
				case 'mutation.preview':
				case 'mutation.apply':
					throw new Error(`${command} is not a persistent read command`);
			}
		})(),
	};
}

async function withTestTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
	const timeoutMs = process.platform === 'win32' ? 30_000 : 1_000;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function broadenWindowsAclForTest(
	target: string,
	kind: 'file' | 'directory',
): void {
	const systemRoot = process.env.SystemRoot;
	const windowsDirectory = process.env.WINDIR;
	if (!systemRoot || !windowsDirectory) throw new Error('windows-system-root-unavailable');
	const normalizedRoot = systemRoot.replace(/\//gu, '\\').replace(/\\+$/u, '');
	const normalizedWindowsDirectory = windowsDirectory.replace(/\//gu, '\\').replace(/\\+$/u, '');
	if (normalizedRoot.toLowerCase() !== normalizedWindowsDirectory.toLowerCase()) {
		throw new Error('windows-system-root-mismatch');
	}
	const powershell = join(
		normalizedRoot,
		'System32',
		'WindowsPowerShell',
		'v1.0',
		'powershell.exe',
	);
	const getAccessControl = kind === 'directory'
		? '[IO.Directory]::GetAccessControl($p)'
		: '[IO.File]::GetAccessControl($p)';
	const setAccessControl = kind === 'directory'
		? '[IO.Directory]::SetAccessControl($p,$acl)'
		: '[IO.File]::SetAccessControl($p,$acl)';
	const inheritance = kind === 'directory'
		? 'ContainerInherit,ObjectInherit'
		: 'None';
	const script = [
		'$ErrorActionPreference="Stop"',
		'$p=[Environment]::GetEnvironmentVariable("OPERON_TEST_SECURITY_PATH","Process")',
		`$acl=${getAccessControl}`,
		'$users=[Security.Principal.SecurityIdentifier]::new("S-1-5-32-545")',
		`$rule=[Security.AccessControl.FileSystemAccessRule]::new($users,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.InheritanceFlags]"${inheritance}",[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)`,
		'[void]$acl.AddAccessRule($rule)',
		setAccessControl,
	].join(';');
	execFileSync(powershell, [
		'-NoLogo',
		'-NoProfile',
		'-NonInteractive',
		'-ExecutionPolicy',
		'Bypass',
		'-Command',
		script,
	], {
		env: {
			SystemRoot: normalizedRoot,
			WINDIR: normalizedRoot,
			OPERON_TEST_SECURITY_PATH: target,
		},
		stdio: 'ignore',
		windowsHide: true,
		timeout: 15_000,
	});
}

async function readFileUtf8(filePath: string): Promise<string> {
	const handle = await open(filePath, fsConstants.O_RDONLY);
	try {
		return Buffer.from(await handle.readFile()).toString('utf8');
	} finally {
		await handle.close();
	}
}

function asTransportStat(
	stat: Awaited<ReturnType<typeof lstat>>,
): AgentRuntimeTransportFileStatV1 {
	return {
		dev: Number(stat.dev),
		ino: Number(stat.ino),
		mode: Number(stat.mode),
		size: Number(stat.size),
		ctimeMs: Number(stat.ctimeMs),
		uid: Number(stat.uid),
		isDirectory: () => stat.isDirectory(),
		isFile: () => stat.isFile(),
		isSymbolicLink: () => stat.isSymbolicLink(),
	};
}

function writeTestFrame(socket: Socket, value: unknown): void {
	const body = Buffer.from(JSON.stringify(value), 'utf8');
	const header = Buffer.allocUnsafe(4);
	header.writeUInt32BE(body.byteLength, 0);
	socket.write(Buffer.concat([header, body]));
}

function authenticateTestFrame(
	value: Record<string, unknown>,
	secret: string,
): Record<string, unknown> {
	const unsigned = {
		...value,
		authNonce: createHash('sha256')
			.update(`${secret}:${JSON.stringify(value)}:${testAuthSequence++}`)
			.digest('hex'),
	};
	return {
		...unsigned,
		authMac: createHmac('sha256', secret)
			.update(stableTestJson(unsigned))
			.digest('hex'),
	};
}

let testAuthSequence = 0;

function stableTestJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableTestJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.filter(key => key !== 'authMac')
			.sort()
			.map(key => `${JSON.stringify(key)}:${stableTestJson(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function createFrameReader(socket: Socket): () => Promise<unknown> {
	let buffered = Buffer.alloc(0);
	const waiters: Array<{
		resolve(value: unknown): void;
		reject(reason: unknown): void;
	}> = [];
	const drain = (): void => {
		while (waiters.length > 0 && buffered.byteLength >= 4) {
			const length = buffered.readUInt32BE(0);
			if (buffered.byteLength < 4 + length) return;
			const body = buffered.subarray(4, 4 + length);
			buffered = buffered.subarray(4 + length);
			waiters.shift()?.resolve(JSON.parse(body.toString('utf8')) as unknown);
		}
	};
	socket.on('data', chunk => {
		buffered = Buffer.concat([buffered, chunk]);
		drain();
	});
	socket.on('error', error => {
		for (const waiter of waiters.splice(0)) waiter.reject(error);
	});
	socket.on('close', () => {
		for (const waiter of waiters.splice(0)) waiter.reject(new Error('socket-closed'));
	});
	return () => new Promise<unknown>((resolveFrame, rejectFrame) => {
		waiters.push({ resolve: resolveFrame, reject: rejectFrame });
		drain();
	});
}

class TestPersistentHandle implements AgentRuntimePersistentReadServerHandleV1 {
	private readonly listeners = new Set<(reason: string) => void>();
	closed = false;

	constructor(
		readonly available: boolean,
		readonly reason?: string,
	) {}

	onUnavailable(listener: (reason: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	async fail(reason: string): Promise<void> {
		this.closed = true;
		for (const listener of this.listeners) listener(reason);
		await Promise.resolve();
	}
}

function createSupervisorScheduler(): {
	readonly now: number;
	readonly size: number;
	setTimer(callback: () => void, delayMs: number): number;
	clearTimer(handle: unknown): void;
	runNext(): Promise<void>;
} {
	let now = 0;
	let sequence = 0;
	const timers = new Map<number, { callback: () => void; dueAt: number }>();
	return {
		get now() {
			return now;
		},
		get size() {
			return timers.size;
		},
		setTimer(callback, delayMs) {
			const id = ++sequence;
			timers.set(id, { callback, dueAt: now + delayMs });
			return id;
		},
		clearTimer(handle) {
			if (typeof handle === 'number') timers.delete(handle);
		},
		async runNext() {
			const next = [...timers.entries()]
				.sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
			assert.ok(next, 'expected a scheduled supervisor timer');
			timers.delete(next[0]);
			now = next[1].dueAt;
			next[1].callback();
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}
