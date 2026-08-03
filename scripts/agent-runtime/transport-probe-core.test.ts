import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'obsidian';
import {
	buildProbeRequest,
	fixedRequestRoot,
	writeSecureRequest,
} from './transport/protocol.mjs';
import {
	getTransportProbePhase,
	handleTransportProbe,
	registerTransportProbe,
	resetTransportProbePhase,
	setTransportProbePhase,
	TRANSPORT_PROBE_COMMAND,
	type TransportProbeResultV1,
	type TransportProbeOptionsV1,
} from '../../src/agent-runtime/transport-probe';

(global as unknown as {
	window: {
		require: (moduleId: string) => unknown;
		setTimeout: typeof setTimeout;
	};
}).window = {
	require: createRequire(import.meta.url),
	setTimeout,
};

declare global {
	var __operonAgentRuntimeTransportProbeTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeTransportProbeTestRun = run();

async function run(): Promise<void> {
	await testPhaseProgression();
	await testFeatureDetectionAndRegistration();
	await testArgvDigestAndVaultIdentity();
	await testAsyncDelayAndGeneratedOutput();
	await testRuntimeTimingDrain();
	if (process.platform !== 'win32') {
		await testOwnerOnlyRequestFileAndCleanup();
		await testUnsafeRequestFilesFailClosed();
	} else {
		console.log('Skipping POSIX request-file permission checks on Windows.');
	}
	await testInputAndVaultErrors();
	console.log('Agent Runtime transport probe core tests passed');
}

async function testPhaseProgression(): Promise<void> {
	resetTransportProbePhase();
	assert.equal(getTransportProbePhase(), 'loading');
	setTransportProbePhase('layout-ready');
	setTransportProbePhase('plugin-loaded');
	assert.equal(getTransportProbePhase(), 'layout-ready');
	setTransportProbePhase('startup-reconciled');
	assert.equal(getTransportProbePhase(), 'startup-reconciled');
	setTransportProbePhase('load-failed');
	setTransportProbePhase('startup-reconciled');
	assert.equal(getTransportProbePhase(), 'load-failed');
	setTransportProbePhase('unloading');
	assert.equal(getTransportProbePhase(), 'unloading');
}

async function testFeatureDetectionAndRegistration(): Promise<void> {
	const withoutCli = createPluginFixture();
	assert.equal(registerTransportProbe(withoutCli.plugin), false);

	const withCli = createPluginFixture(true);
	assert.equal(registerTransportProbe(withCli.plugin), true);
	assert.equal(withCli.registration?.command, TRANSPORT_PROBE_COMMAND);
	assert.equal(typeof withCli.registration?.handler, 'function');
}

async function testArgvDigestAndVaultIdentity(): Promise<void> {
	const fixture = createPluginFixture();
	const vaultPath = await realpath(fixture.vaultPath);
	const expectedVaultSha256 = sha256(vaultPath);
	const payload = Buffer.from('synthetic argv payload', 'utf8');
	const result = await invoke(fixture.plugin, {
		operation: 'digest',
		requestId: 'argv-digest',
		channel: 'argv',
		payload: payload.toString('base64url'),
		expectedVaultSha256,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.input.channel, 'argv');
	assert.equal(result.input.bytes, payload.byteLength);
	assert.equal(result.input.sha256, sha256(payload));
	assert.equal(result.vaultIdentity.expectedMatch, true);
	assert.equal(JSON.stringify(result).includes(vaultPath), false);
}

async function testAsyncDelayAndGeneratedOutput(): Promise<void> {
	const fixture = createPluginFixture();
	const delayed = await invoke(fixture.plugin, {
		operation: 'delay',
		requestId: 'async-delay',
		delayMs: '5',
	});
	assert.equal(delayed.ok, true);
	assert.ok(delayed.handlerMs >= 4);

	const generated = await invoke(fixture.plugin, {
		operation: 'generate',
		requestId: 'generated-output',
		outputBytes: '4096',
	});
	assert.equal(generated.ok, true);
	assert.equal(generated.output.bytes, 4096);
	assert.equal(Buffer.from(generated.generatedPayload ?? '', 'base64url').byteLength, 4096);
	assert.equal(generated.output.sha256, sha256(Buffer.from('x'.repeat(4096))));
}

async function testRuntimeTimingDrain(): Promise<void> {
	const fixture = createPluginFixture();
	let drained = false;
	const runtimeTimings = [{
		requestId: 'runtime-read-1',
		flow: 'read' as const,
		span: 'projection' as const,
		durationMs: 12.5,
		attempt: 1,
	}];
	const result = await invoke(
		fixture.plugin,
		{ operation: 'timings', requestId: 'timing-drain' },
		{
			drainRuntimeTimings: () => {
				drained = true;
				return runtimeTimings;
			},
		},
	);
	assert.equal(result.ok, true);
	assert.equal(drained, true);
	assert.deepEqual(result.runtimeTimings, runtimeTimings);
	assert.equal(result.output.bytes, Buffer.byteLength(JSON.stringify(runtimeTimings)));
}

async function testOwnerOnlyRequestFileAndCleanup(): Promise<void> {
	const fixture = createPluginFixture();
	const requestRoot = fixedRequestRoot();
	await mkdir(requestRoot, { recursive: true, mode: 0o700 });
	const payload = Buffer.from('owner-only synthetic payload', 'utf8');
	const built = buildProbeRequest({
		payload,
		requestId: 'request-file',
		operation: 'digest',
		expectedVaultSha256: null,
		outputBytes: 0,
		delayMs: 0,
	});
	const published = writeSecureRequest(built.request);

	const result = await invoke(fixture.plugin, {
		channel: 'request-file',
		requestToken: published.token,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.requestId, 'request-file');
	assert.equal(result.operation, 'digest');
	assert.equal(result.input.channel, 'request-file');
	assert.equal(result.input.sha256, sha256(payload));
	await assert.rejects(realpath(published.path));
}

async function testUnsafeRequestFilesFailClosed(): Promise<void> {
	const fixture = createPluginFixture();
	const requestRoot = fixedRequestRoot();
	await mkdir(requestRoot, { recursive: true, mode: 0o700 });

	const permissiveToken = requestToken();
	const permissivePath = join(requestRoot, `${permissiveToken}.request.json`);
	await writeFile(permissivePath, 'unsafe permissions', { mode: 0o644, flag: 'wx' });
	await chmod(permissivePath, 0o644);
	const permissive = await invoke(fixture.plugin, {
		operation: 'digest',
		requestId: 'permissive-file',
		channel: 'request-file',
		requestToken: permissiveToken,
	});
	assert.equal(permissive.ok, false);
	assert.equal(permissive.error?.reason, 'request-permissions-not-owner-only');
	assert.equal(typeof await realpath(permissivePath), 'string');
	await unlink(permissivePath);

	const symlinkToken = requestToken();
	const symlinkPath = join(requestRoot, `${symlinkToken}.request.json`);
	const outsidePath = join(tmpdir(), `${symlinkToken}.outside`);
	await writeFile(outsidePath, 'outside', { mode: 0o600, flag: 'wx' });
	await symlink(outsidePath, symlinkPath);
	const symlinkResult = await invoke(fixture.plugin, {
		operation: 'digest',
		requestId: 'symlink-file',
		channel: 'request-file',
		requestToken: symlinkToken,
	});
	assert.equal(symlinkResult.ok, false);
	assert.equal(symlinkResult.error?.code, 'REQUEST_FILE_INVALID');
	await unlink(symlinkPath);
	await unlink(outsidePath);
}

async function testInputAndVaultErrors(): Promise<void> {
	const fixture = createPluginFixture();
	const mismatch = await invoke(fixture.plugin, {
		operation: 'health',
		requestId: 'vault-mismatch',
		expectedVaultSha256: '0'.repeat(64),
	});
	assert.equal(mismatch.ok, false);
	assert.equal(mismatch.error?.code, 'VAULT_MISMATCH');
	assert.equal(mismatch.vaultIdentity.expectedMatch, false);

	const invalidPayload = await invoke(fixture.plugin, {
		operation: 'digest',
		requestId: 'invalid-payload',
		payload: 'contains+non-base64url',
	});
	assert.equal(invalidPayload.ok, false);
	assert.equal(invalidPayload.error?.reason, 'invalid-base64url-payload');

	const invalidToken = await invoke(fixture.plugin, {
		operation: 'digest',
		requestId: 'invalid-token',
		channel: 'request-file',
		requestToken: '../outside',
	});
	assert.equal(invalidToken.ok, false);
	assert.equal(invalidToken.error?.reason, 'invalid-request-token');
}

function createPluginFixture(withCli = false): {
	plugin: Plugin;
	vaultPath: string;
	registration?: {
		command: string;
		handler: (params: Record<string, string | 'true'>) => string | Promise<string>;
	};
} {
	const vaultPath = process.cwd();
	const fixture: {
		plugin: Plugin;
		vaultPath: string;
		registration?: {
			command: string;
			handler: (params: Record<string, string | 'true'>) => string | Promise<string>;
		};
	} = {
		plugin: {} as Plugin,
		vaultPath,
	};
	const pluginLike = {
		app: {
			vault: {
				adapter: {
					getFullPath: () => vaultPath,
				},
			},
		},
		...(withCli ? {
			registerCliHandler: (
				command: string,
				_description: string,
				_flags: unknown,
				handler: (params: Record<string, string | 'true'>) => string | Promise<string>,
			) => {
				fixture.registration = { command, handler };
			},
		} : {}),
	};
	fixture.plugin = pluginLike as unknown as Plugin;
	return fixture;
}

async function invoke(
	plugin: Plugin,
	params: Record<string, string>,
	options?: TransportProbeOptionsV1,
): Promise<TransportProbeResultV1> {
	return JSON.parse(await handleTransportProbe(plugin, params, options)) as TransportProbeResultV1;
}

function requestToken(): string {
	return randomBytes(24).toString('base64url');
}

function sha256(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}
