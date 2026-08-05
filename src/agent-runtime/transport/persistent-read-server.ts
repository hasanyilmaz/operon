import { Platform, type Plugin } from 'obsidian';
import {
	type CliCommandV1,
	type CliRuntimeMetadataV1,
} from '../contracts/v1/cli';
import { CONTRACT_LIMITS_V1 } from '../contracts/v1/primitives';
import type { OperonAgentRuntimeCoreV1 } from '../runtime/types';
import type { RuntimeTimingSinkV1 } from '../runtime/timing-probe';
import {
	computeRunningVaultSha256V1,
} from './secure-request-file';
import { dispatchAgentRuntimeCliV1 } from './dispatcher';
import {
	createAgentRuntimeDesktopNodeApiLoaderV1,
} from './desktop-node-api';
import {
	cancelWindowsBrokerStageV1,
	getWindowsBrokerStageStateV1,
	registerWindowsBrokerScopeV1,
	stageWindowsBrokerInvocationV1,
	unregisterWindowsBrokerScopeV1,
	type WindowsBrokerScopeV1,
} from './windows-broker-state';

const PROTOCOL_VERSION_V1 = 1;
const MAX_CONNECTIONS_V1 = 4;
const IDLE_TIMEOUT_MS_V1 = 30_000;
const AUTHENTICATED_FRAME_OVERHEAD_BYTES_V1 = 16 * 1024;
const MAX_FRAME_BYTES_V1 = CONTRACT_LIMITS_V1.transportInputBytes
	+ AUTHENTICATED_FRAME_OVERHEAD_BYTES_V1;
const READ_COMMANDS_V1 = new Set<CliCommandV1>([
	'health',
	'capabilities',
	'diagnostics',
	'catalog',
	'entity.resolve',
	'task.get',
	'tasks.query',
	'tasks.finder',
	'relationships.get',
	'context.build',
	'timers.read',
]);
const HEX_256_PATTERN_V1 = /^[a-f0-9]{64}$/u;
const REQUEST_TOKEN_PATTERN_V1 = /^[A-Za-z0-9_-]{32}$/u;
const FATAL_UTF8_DECODER_V1 = new TextDecoder('utf-8', { fatal: true });
const DESCRIPTOR_TTL_MS_V1 = 24 * 60 * 60 * 1_000;
const DESCRIPTOR_REFRESH_MS_V1 = 12 * 60 * 60 * 1_000;
const HANDSHAKE_DEADLINE_MS_V1 = 5_000;
const SERVER_REPLAY_CACHE_LIMIT_V1 = 65_536;
const WINDOWS_ACL_TIMEOUT_MS_V1 = 30_000;
const WINDOWS_ACL_RESULT_LIMIT_V1 = 16_384;

interface PersistentReadNodeBufferV1 extends Uint8Array {
	readUInt32BE(offset: number): number;
	toString(encoding?: 'utf8'): string;
}

interface PersistentReadSocketV1 {
	destroyed: boolean;
	on(event: 'data', listener: (chunk: Uint8Array) => void): this;
	on(event: 'drain' | 'close' | 'error' | 'timeout', listener: () => void): this;
	once(event: 'drain' | 'close' | 'error', listener: () => void): this;
	off(event: 'drain' | 'close' | 'error', listener: () => void): this;
	setTimeout(milliseconds: number): this;
	pause(): this;
	resume(): this;
	write(value: Uint8Array): boolean;
	destroy(): void;
}

interface PersistentReadServerV1 {
	listen(path: string, listener: () => void): this;
	on(event: 'connection', listener: (socket: PersistentReadSocketV1) => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	once(event: 'error', listener: (error: Error) => void): this;
	close(listener?: (error?: Error) => void): void;
}

interface PersistentReadNodeModulesV1 {
	readonly buffer: {
		from(value: string | Uint8Array, encoding?: 'utf8'): PersistentReadNodeBufferV1;
		allocUnsafe(size: number): PersistentReadNodeBufferV1;
		concat(values: readonly Uint8Array[]): PersistentReadNodeBufferV1;
	};
	readonly crypto: {
		randomBytes(size: number): { toString(encoding: 'hex' | 'base64url'): string };
		createHmac(algorithm: 'sha256', key: string): {
			update(value: string): { digest(encoding: 'hex'): string };
		};
		timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
	};
	readonly fs: {
		constants: {
			O_CREAT: number;
			O_EXCL: number;
			O_NOFOLLOW: number;
			O_WRONLY: number;
		};
		chmodSync(path: string, mode: number): void;
		lstatSync(path: string): {
			isFile(): boolean;
			isSymbolicLink(): boolean;
		};
		writeFileSync(path: string, value: Uint8Array, options: { flag: 'wx'; mode: number }): void;
		renameSync(oldPath: string, newPath: string): void;
	};
	readonly fsp: {
		chmod(path: string, mode: number): Promise<void>;
		link(existingPath: string, newPath: string): Promise<void>;
		lstat(path: string): Promise<{
			dev: number;
			ino: number;
			mode: number;
			uid: number;
			isDirectory(): boolean;
			isFile(): boolean;
			isSocket(): boolean;
			isSymbolicLink(): boolean;
		}>;
		open(path: string, flags: number, mode: number): Promise<{
			writeFile(value: Uint8Array): Promise<void>;
			sync(): Promise<void>;
			close(): Promise<void>;
		}>;
		realpath(path: string): Promise<string>;
		unlink(path: string): Promise<void>;
	};
	readonly net: {
		createServer(): PersistentReadServerV1;
	};
	readonly process: {
		platform: string;
		env: Record<string, string | undefined>;
	};
	readonly os: {
		release(): string;
	};
	readonly childProcess: {
		spawnSync(command: string, args: readonly string[], options: {
			encoding: 'utf8';
			env: Record<string, string>;
			shell: false;
			windowsHide: true;
			timeout: number;
			maxBuffer: number;
			killSignal: 'SIGKILL';
		}): { status: number | null; stdout: string; stderr: string; error?: Error };
	};
}

interface PersistentReadDescriptorV1 {
	readonly protocolVersion: 1;
	readonly serverInstanceId: string;
	readonly vaultSha256: string;
	readonly endpointKind: 'unix-domain-socket' | 'windows-named-pipe';
	readonly endpoint: string;
	readonly authSecret: string;
	readonly expiresAt: number;
	readonly pluginVersion: string;
	readonly apiVersion: 1;
}

interface PersistentReadHelloV1 {
	readonly type: 'hello';
	readonly protocolVersion: 1;
	readonly serverInstanceId: string;
	readonly vaultSha256: string;
	readonly connectionNonce: string;
	readonly authMac: string;
}

interface PersistentReadRequestV1 {
	readonly type: 'request';
	readonly sequence: number;
	readonly connectionNonce: string;
	readonly requestId: string;
	readonly command: CliCommandV1;
	readonly requestToken: string;
	readonly authNonce: string;
	readonly authMac: string;
}

interface PersistentReadBatchRequestV1 {
	readonly type: 'batch';
	readonly sequence: number;
	readonly connectionNonce: string;
	readonly requests: ReadonlyArray<{
		readonly requestId: string;
		readonly command: CliCommandV1;
		readonly requestToken: string;
	}>;
	readonly authNonce: string;
	readonly authMac: string;
}

interface BrokerControlRequestV1 {
	readonly type: 'stage' | 'status' | 'cancel';
	readonly sequence: number;
	readonly connectionNonce: string;
	readonly requestId: string;
	readonly requestToken?: string;
	readonly invocation?: string;
	readonly authNonce: string;
	readonly authMac: string;
}

export interface AgentRuntimePersistentReadServerOptionsV1 {
	readonly runtimeMetadata: CliRuntimeMetadataV1;
	readonly timingSink?: RuntimeTimingSinkV1;
	readonly isStartCurrent?: () => boolean;
	readonly descriptorRefreshMs?: number;
	readonly replayCacheLimit?: number;
	readonly beforeDescriptorCommit?: (publication: number) => Promise<void>;
}

export interface AgentRuntimePersistentReadServerHandleV1 {
	readonly available: boolean;
	readonly reason?: string;
	onUnavailable(listener: (reason: string) => void): () => void;
	close(): Promise<void>;
}

interface OwnedPathV1 {
	readonly path: string;
	readonly dev: number;
	readonly ino: number;
}

export async function startAgentRuntimePersistentReadServerV1(
	plugin: Plugin,
	runtime: OperonAgentRuntimeCoreV1,
	options: AgentRuntimePersistentReadServerOptionsV1,
): Promise<AgentRuntimePersistentReadServerHandleV1> {
	try {
		return await startAgentRuntimePersistentReadServerInternalV1(plugin, runtime, options);
	} catch (error) {
		return unavailableHandle(classifyPersistentReadServerStartFailureV1(error));
	}
}

async function startAgentRuntimePersistentReadServerInternalV1(
	plugin: Plugin,
	runtime: OperonAgentRuntimeCoreV1,
	options: AgentRuntimePersistentReadServerOptionsV1,
): Promise<AgentRuntimePersistentReadServerHandleV1> {
	if (!Platform.isDesktop) return unavailableHandle('desktop-required');
	const nodeApi = await createAgentRuntimeDesktopNodeApiLoaderV1()();
	const modules = loadPersistentReadNodeModulesV1();
	const platform = modules.process.platform;
	if (!['darwin', 'linux', 'win32'].includes(platform)) {
		return unavailableHandle('platform-unsupported');
	}
	if (
		platform === 'linux'
		&& (
			modules.process.env['WSL_DISTRO_NAME']
			|| modules.process.env['WSL_INTEROP']
			|| modules.os.release().toLowerCase().includes('microsoft')
		)
	) return unavailableHandle('wsl-unsupported');
	const uid = nodeApi.getuid();
	if (platform !== 'win32' && uid === null) return unavailableHandle('owner-identity-unavailable');
	const requestRoot = resolvePersistentEndpointRootV1(modules, nodeApi, uid);
	await nodeApi.mkdir(requestRoot, { recursive: true, mode: 0o700 });
	if (platform === 'win32') {
		applyAndVerifyWindowsOwnerOnlyPathV1(modules, requestRoot, true);
	} else {
		const rootStat = await modules.fsp.lstat(requestRoot);
		if (
			rootStat.isSymbolicLink()
			|| !rootStat.isDirectory()
			|| rootStat.uid !== uid
			|| (rootStat.mode & 0o777) !== 0o700
		) {
			return unavailableHandle('request-root-not-secure');
		}
	}
	const rootPath = await modules.fsp.realpath(requestRoot);
	const vaultSha256 = await computeRunningVaultSha256V1(nodeApi, plugin.app.vault.adapter);
	const serverInstanceId = modules.crypto.randomBytes(32).toString('hex');
	const authSecret = modules.crypto.randomBytes(32).toString('hex');
	const brokerScope: WindowsBrokerScopeV1 = { serverInstanceId, vaultSha256 };
	const endpointKind = platform === 'win32' ? 'windows-named-pipe' : 'unix-domain-socket';
	const endpoint = platform === 'win32'
		? `\\\\.\\pipe\\operon-${serverInstanceId}`
		: nodeApi.resolve(rootPath, `read-${modules.crypto.randomBytes(24).toString('hex')}.sock`);
	const socketPath = endpoint;
	const descriptorPath = nodeApi.resolve(rootPath, `persistent-read-${vaultSha256}.json`);
	if (
		(endpointKind === 'unix-domain-socket' && nodeApi.dirname(socketPath) !== rootPath)
		|| nodeApi.dirname(descriptorPath) !== rootPath
	) {
		return unavailableHandle('persistent-read-path-escape');
	}

	const sockets = new Set<PersistentReadSocketV1>();
	const server = modules.net.createServer();
	let socketIdentity: OwnedPathV1 | null = null;
	let descriptorRefreshTimer: number | null = null;
	let descriptorPublication: Promise<void> | null = null;
	let descriptorPublicationGeneration = 0;
	let descriptorPublicationSequence = 0;
	let terminalFailureReason: string | null = null;
	let closing = false;
	let closePromise: Promise<void> | null = null;
	const unavailableListeners = new Set<(reason: string) => void>();
	const canPublishDescriptor = (generation: number): boolean => (
		!closing
		&& generation === descriptorPublicationGeneration
		&& (options.isStartCurrent?.() ?? true)
	);
	const close = (): Promise<void> => {
		if (closePromise) return closePromise;
		closing = true;
		descriptorPublicationGeneration += 1;
		if (descriptorRefreshTimer !== null) window.clearInterval(descriptorRefreshTimer);
		descriptorRefreshTimer = null;
		if (endpointKind === 'windows-named-pipe') unregisterWindowsBrokerScopeV1(brokerScope);
		for (const socket of sockets) socket.destroy();
		const inFlightDescriptorPublication = descriptorPublication;
		closePromise = (async (): Promise<void> => {
			await inFlightDescriptorPublication?.catch(() => undefined);
			await new Promise<void>(resolve => server.close(() => resolve()));
			await unlinkOwnedPathV1(modules, socketIdentity);
		})();
		return closePromise;
	};
	const fail = async (reason: string): Promise<void> => {
		if (terminalFailureReason !== null) return;
		terminalFailureReason = reason;
		await close();
		for (const listener of unavailableListeners) listener(reason);
		unavailableListeners.clear();
	};

	try {
		const seenAuthNonces = new Set<string>();
		const replayCacheLimit = Math.max(
			1,
			Math.floor(options.replayCacheLimit ?? SERVER_REPLAY_CACHE_LIMIT_V1),
		);
		server.on('connection', socket => {
			if (closing || sockets.size >= MAX_CONNECTIONS_V1) {
				socket.destroy();
				return;
			}
			sockets.add(socket);
			socket.setTimeout(IDLE_TIMEOUT_MS_V1);
			handlePersistentReadConnectionV1({
				socket,
				modules,
				runtime,
				nodeApi,
				plugin,
				options,
				vaultSha256,
				serverInstanceId,
				authSecret,
				endpointKind,
				brokerScope,
				seenAuthNonces,
				replayCacheLimit,
				onReplayCacheExhausted: () => {
					void fail('persistent-read-replay-cache-exhausted');
				},
			});
			socket.on('close', () => sockets.delete(socket));
			socket.on('error', () => socket.destroy());
			socket.on('timeout', () => socket.destroy());
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(socketPath, resolve);
		});
		server.on('error', () => {
			void fail('persistent-read-server-error');
		});
		if (endpointKind === 'unix-domain-socket') {
			modules.fs.chmodSync(socketPath, 0o600);
			const socketStat = await modules.fsp.lstat(socketPath);
			if (
				socketStat.isSymbolicLink()
				|| !socketStat.isSocket()
				|| socketStat.uid !== uid
				|| (socketStat.mode & 0o777) !== 0o600
			) throw new Error('persistent-read-socket-not-secure');
			socketIdentity = { path: socketPath, dev: socketStat.dev, ino: socketStat.ino };
		}
		const publishCurrentDescriptor = (): Promise<void> => {
			if (descriptorPublication) return descriptorPublication;
			const generation = descriptorPublicationGeneration;
			const publication = descriptorPublicationSequence + 1;
			descriptorPublicationSequence = publication;
			const pending = (async (): Promise<void> => {
				if (!canPublishDescriptor(generation)) {
					throw new Error('persistent-read-descriptor-publication-cancelled');
				}
				const descriptor: PersistentReadDescriptorV1 = {
					protocolVersion: PROTOCOL_VERSION_V1,
					serverInstanceId,
					vaultSha256,
					endpointKind,
					endpoint,
					authSecret,
					expiresAt: Date.now() + DESCRIPTOR_TTL_MS_V1,
					pluginVersion: plugin.manifest.version,
					apiVersion: 1,
				};
				if (endpointKind === 'windows-named-pipe') {
					await publishWindowsDescriptorV1(
						modules,
						descriptorPath,
						descriptor,
						() => options.beforeDescriptorCommit?.(publication) ?? Promise.resolve(),
						() => canPublishDescriptor(generation),
					);
				} else {
					await publishDescriptorV1(
						modules,
						rootPath,
						descriptorPath,
						descriptor,
						uid as number,
						() => options.beforeDescriptorCommit?.(publication) ?? Promise.resolve(),
						() => canPublishDescriptor(generation),
					);
				}
			})();
			descriptorPublication = pending;
			void pending.then(
				() => {
					if (descriptorPublication === pending) descriptorPublication = null;
				},
				() => {
					if (descriptorPublication === pending) descriptorPublication = null;
				},
			);
			return pending;
		};
		await publishCurrentDescriptor();
		if (endpointKind === 'windows-named-pipe') registerWindowsBrokerScopeV1(brokerScope);
		descriptorRefreshTimer = window.setInterval(() => {
			if (closing) return;
			void publishCurrentDescriptor().catch(() => {
				if (!closing) void fail('persistent-read-descriptor-refresh-failed');
			});
		}, Math.max(1, options.descriptorRefreshMs ?? DESCRIPTOR_REFRESH_MS_V1));
		return {
			get available() {
				return !closing && terminalFailureReason === null;
			},
			get reason() {
				return terminalFailureReason ?? undefined;
			},
			onUnavailable(listener) {
				if (terminalFailureReason !== null) {
					listener(terminalFailureReason);
					return () => undefined;
				}
				unavailableListeners.add(listener);
				return () => unavailableListeners.delete(listener);
			},
			close,
		};
	} catch (error) {
		await close();
		return unavailableHandle(classifyPersistentReadServerStartFailureV1(error));
	}
}

function handlePersistentReadConnectionV1(input: {
	readonly socket: PersistentReadSocketV1;
	readonly modules: PersistentReadNodeModulesV1;
	readonly runtime: OperonAgentRuntimeCoreV1;
	readonly nodeApi: Awaited<ReturnType<ReturnType<typeof createAgentRuntimeDesktopNodeApiLoaderV1>>>;
	readonly plugin: Plugin;
	readonly options: AgentRuntimePersistentReadServerOptionsV1;
	readonly vaultSha256: string;
	readonly serverInstanceId: string;
	readonly authSecret: string;
	readonly endpointKind: 'unix-domain-socket' | 'windows-named-pipe';
	readonly brokerScope: WindowsBrokerScopeV1;
	readonly seenAuthNonces: Set<string>;
	readonly replayCacheLimit: number;
	readonly onReplayCacheExhausted: () => void;
}): void {
	let buffered = input.modules.buffer.allocUnsafe(0);
	let handshaken = false;
	let connectionNonce: string | null = null;
	let processing = false;
	let expectedSequence = 1;
	const seenRequestIds = new Set<string>();
	const seenRequestAuthNonces = new Set<string>();
	const maxSeenRequestIds = 1_024;
	const handshakeDeadline = window.setTimeout(() => {
		if (!handshaken) input.socket.destroy();
	}, HANDSHAKE_DEADLINE_MS_V1);
	const clearHandshakeDeadline = (): void => window.clearTimeout(handshakeDeadline);
	input.socket.once('close', clearHandshakeDeadline);
	input.socket.once('error', clearHandshakeDeadline);
	input.socket.on('data', chunk => {
		buffered = input.modules.buffer.concat([buffered, chunk]);
		if (processing) return;
		void processFrames();
	});

	const processFrames = async (): Promise<void> => {
		if (processing) return;
		processing = true;
		input.socket.pause();
		try {
			while (!input.socket.destroyed && buffered.byteLength >= 4) {
				const length = buffered.readUInt32BE(0);
				if (length === 0 || length > MAX_FRAME_BYTES_V1) {
					input.socket.destroy();
					return;
				}
				if (buffered.byteLength < 4 + length) break;
				const raw = buffered.subarray(4, 4 + length);
				buffered = input.modules.buffer.from(buffered.subarray(4 + length));
				const decoded = decodeFrameV1(input.modules, raw);
				if (!handshaken) {
					if (
						!isValidHelloV1(decoded, input.serverInstanceId, input.vaultSha256)
						|| !verifyMacV1(input.modules, input.authSecret, decoded)
						|| input.seenAuthNonces.has(decoded.connectionNonce)
					) {
						input.socket.destroy();
						return;
					}
					if (input.seenAuthNonces.size >= input.replayCacheLimit) {
						input.socket.destroy();
						input.onReplayCacheExhausted();
						return;
					}
					handshaken = true;
					connectionNonce = decoded.connectionNonce;
					clearHandshakeDeadline();
					input.seenAuthNonces.add(decoded.connectionNonce);
					await writeFrameV1(input.socket, input.modules, {
						type: 'hello-ack',
						protocolVersion: PROTOCOL_VERSION_V1,
						serverInstanceId: input.serverInstanceId,
						vaultSha256: input.vaultSha256,
						connectionNonce: decoded.connectionNonce,
					}, input.authSecret);
					continue;
				}
				if (
					connectionNonce === null
					|| !isAuthenticatedRequestV1(
						decoded,
						expectedSequence,
						connectionNonce,
						input.modules,
						input.authSecret,
					)
				) {
					input.socket.destroy();
					return;
				}
				if (seenRequestAuthNonces.has(decoded.authNonce)) {
					input.socket.destroy();
					return;
				}
				if (seenRequestAuthNonces.size >= maxSeenRequestIds) {
					input.socket.destroy();
					return;
				}
				seenRequestAuthNonces.add(decoded.authNonce);
				if (isValidBrokerControlRequestV1(decoded)) {
					if (input.endpointKind !== 'windows-named-pipe') {
						input.socket.destroy();
						return;
					}
					if (
						seenRequestIds.has(decoded.requestId)
						|| seenRequestIds.size >= maxSeenRequestIds
					) {
						input.socket.destroy();
						return;
					}
					seenRequestIds.add(decoded.requestId);
					expectedSequence += 1;
					await handleBrokerControlV1(
						input.socket,
						input.modules,
						decoded,
						input.authSecret,
						input.brokerScope,
					);
					continue;
				}
				const requests = decoded.type === 'batch' ? decoded.requests : [decoded];
				if (
					requests.some(request => seenRequestIds.has(request.requestId))
					|| seenRequestIds.size + requests.length > maxSeenRequestIds
				) {
					input.socket.destroy();
					return;
				}
				expectedSequence += 1;
				for (const request of requests) seenRequestIds.add(request.requestId);
				const runningVaultSha256 = await computeRunningVaultSha256V1(
					input.nodeApi,
					input.plugin.app.vault.adapter,
				);
				if (runningVaultSha256 !== input.vaultSha256) {
					input.socket.destroy();
					return;
				}
				await Promise.all(requests.map(async (request, index) => {
					const result = await dispatchAgentRuntimeCliV1(
						{
							runtime: input.runtime,
							nodeApi: input.nodeApi,
							vaultAdapter: input.plugin.app.vault.adapter,
							runtimeMetadata: input.options.runtimeMetadata,
							monotonicNow: () => performance.now(),
							...(input.options.timingSink ? { timingSink: input.options.timingSink } : {}),
						},
						{
							expectedCommand: request.command,
							expectedRequestId: request.requestId,
							requestToken: request.requestToken,
							brokerScope: input.brokerScope,
							transportKind: input.endpointKind === 'windows-named-pipe'
								? 'windows-named-pipe'
								: 'request-file',
						},
					);
					await writeFrameV1(
						input.socket,
						input.modules,
						decoded.type === 'batch'
							? {
								type: 'batch-item-response',
								sequence: decoded.sequence,
								index,
								requestId: request.requestId,
								connectionNonce: decoded.connectionNonce,
								result,
							}
							: {
								type: 'response',
								sequence: decoded.sequence,
								requestId: request.requestId,
								connectionNonce: decoded.connectionNonce,
								result,
							},
						input.authSecret,
					);
				}));
			}
		} catch {
			input.socket.destroy();
		} finally {
			processing = false;
			if (!input.socket.destroyed) input.socket.resume();
		}
	};
}

function decodeFrameV1(
	modules: PersistentReadNodeModulesV1,
	raw: Uint8Array,
): unknown {
	try {
		const text = FATAL_UTF8_DECODER_V1.decode(raw);
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function isValidHelloV1(
	value: unknown,
	serverInstanceId: string,
	vaultSha256: string,
): value is PersistentReadHelloV1 {
	if (!isRecordV1(value)) return false;
	return value['type'] === 'hello'
		&& value['protocolVersion'] === PROTOCOL_VERSION_V1
		&& value['serverInstanceId'] === serverInstanceId
		&& value['vaultSha256'] === vaultSha256
		&& typeof value['connectionNonce'] === 'string'
		&& HEX_256_PATTERN_V1.test(value['connectionNonce'])
		&& typeof value['authMac'] === 'string'
		&& HEX_256_PATTERN_V1.test(value['authMac']);
}

function isValidReadRequestV1(value: unknown): value is PersistentReadRequestV1 {
	if (!isRecordV1(value)) return false;
	return value['type'] === 'request'
		&& Number.isSafeInteger(value['sequence'])
		&& (value['sequence'] as number) > 0
		&& typeof value['connectionNonce'] === 'string'
		&& HEX_256_PATTERN_V1.test(value['connectionNonce'])
		&& typeof value['requestId'] === 'string'
		&& value['requestId'].length > 0
		&& typeof value['command'] === 'string'
		&& READ_COMMANDS_V1.has(value['command'] as CliCommandV1)
		&& typeof value['requestToken'] === 'string'
		&& REQUEST_TOKEN_PATTERN_V1.test(value['requestToken'])
		&& hasAuthenticationFieldsV1(value);
}

function isValidReadBatchRequestV1(value: unknown): value is PersistentReadBatchRequestV1 {
	if (!isRecordV1(value) || !Array.isArray(value['requests'])) return false;
	const requests = value['requests'];
	if (
		value['type'] !== 'batch'
		|| !Number.isSafeInteger(value['sequence'])
		|| (value['sequence'] as number) <= 0
		|| typeof value['connectionNonce'] !== 'string'
		|| !HEX_256_PATTERN_V1.test(value['connectionNonce'])
		|| requests.length < 2
		|| requests.length > 8
		|| !hasAuthenticationFieldsV1(value)
	) return false;
	const ids = new Set<string>();
	for (const request of requests) {
		if (
			!isRecordV1(request)
			|| typeof request['requestId'] !== 'string'
			|| request['requestId'].length === 0
			|| ids.has(request['requestId'])
			|| typeof request['command'] !== 'string'
			|| !READ_COMMANDS_V1.has(request['command'] as CliCommandV1)
			|| typeof request['requestToken'] !== 'string'
			|| !REQUEST_TOKEN_PATTERN_V1.test(request['requestToken'])
		) return false;
		ids.add(request['requestId']);
	}
	return true;
}

function isValidBrokerControlRequestV1(value: unknown): value is BrokerControlRequestV1 {
	if (!isRecordV1(value) || !['stage', 'status', 'cancel'].includes(String(value['type']))) {
		return false;
	}
	if (
		!Number.isSafeInteger(value['sequence'])
		|| (value['sequence'] as number) <= 0
		|| typeof value['connectionNonce'] !== 'string'
		|| !HEX_256_PATTERN_V1.test(value['connectionNonce'])
		|| typeof value['requestId'] !== 'string'
		|| value['requestId'].length < 1
		|| !hasAuthenticationFieldsV1(value)
	) return false;
	if (value['type'] === 'stage') {
		return typeof value['invocation'] === 'string'
			&& new TextEncoder().encode(value['invocation']).byteLength
				<= CONTRACT_LIMITS_V1.transportInputBytes;
	}
	return typeof value['requestToken'] === 'string'
		&& REQUEST_TOKEN_PATTERN_V1.test(value['requestToken']);
}

function isAuthenticatedRequestV1(
	value: unknown,
	expectedSequence: number,
	expectedConnectionNonce: string,
	modules: PersistentReadNodeModulesV1,
	authSecret: string,
): value is PersistentReadRequestV1 | PersistentReadBatchRequestV1 | BrokerControlRequestV1 {
	return (
		isValidReadRequestV1(value)
		|| isValidReadBatchRequestV1(value)
		|| isValidBrokerControlRequestV1(value)
	)
		&& value.sequence === expectedSequence
		&& value.connectionNonce === expectedConnectionNonce
		&& verifyMacV1(modules, authSecret, value);
}

function hasAuthenticationFieldsV1(value: Record<string, unknown>): boolean {
	return typeof value['authNonce'] === 'string'
		&& HEX_256_PATTERN_V1.test(value['authNonce'])
		&& typeof value['authMac'] === 'string'
		&& HEX_256_PATTERN_V1.test(value['authMac']);
}

function verifyMacV1(
	modules: PersistentReadNodeModulesV1,
	secret: string,
	value: object,
): boolean {
	const record = value as Record<string, unknown>;
	const supplied = record['authMac'];
	if (typeof supplied !== 'string' || !HEX_256_PATTERN_V1.test(supplied)) return false;
	const expected = modules.crypto.createHmac('sha256', secret)
		.update(stableAuthenticatedJsonV1(record))
		.digest('hex');
	return modules.crypto.timingSafeEqual(
		modules.buffer.from(supplied, 'utf8'),
		modules.buffer.from(expected, 'utf8'),
	);
}

function stableAuthenticatedJsonV1(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableAuthenticatedJsonV1).join(',')}]`;
	if (isRecordV1(value)) {
		return `{${Object.keys(value)
			.filter(key => key !== 'authMac')
			.sort()
			.map(key => `${JSON.stringify(key)}:${stableAuthenticatedJsonV1(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

async function handleBrokerControlV1(
	socket: PersistentReadSocketV1,
	modules: PersistentReadNodeModulesV1,
	request: BrokerControlRequestV1,
	authSecret: string,
	scope: WindowsBrokerScopeV1,
): Promise<void> {
	if (request.type === 'stage') {
		const requestToken = modules.crypto.randomBytes(24).toString('base64url');
		const stagingReceipt = modules.crypto.randomBytes(32).toString('hex');
		stageWindowsBrokerInvocationV1({
			token: requestToken,
			raw: request.invocation ?? '',
			receipt: stagingReceipt,
			scope,
		});
		await writeFrameV1(socket, modules, {
			type: 'broker-response',
			sequence: request.sequence,
			requestId: request.requestId,
			requestToken,
			stagingReceipt,
			state: 'staged',
			connectionNonce: request.connectionNonce,
		}, authSecret);
		return;
	}
	const requestToken = request.requestToken ?? '';
	const result = request.type === 'cancel'
		? cancelWindowsBrokerStageV1(requestToken, scope)
		: { cancelled: false, state: getWindowsBrokerStageStateV1(requestToken, scope) };
	await writeFrameV1(socket, modules, {
		type: 'broker-response',
		sequence: request.sequence,
		requestId: request.requestId,
		...result,
		connectionNonce: request.connectionNonce,
	}, authSecret);
}

async function writeFrameV1(
	socket: PersistentReadSocketV1,
	modules: PersistentReadNodeModulesV1,
	value: unknown,
	authSecret?: string,
): Promise<void> {
	const authenticatedValue = authSecret && isRecordV1(value)
		? authenticateFrameV1(modules, authSecret, value)
		: value;
	const body = modules.buffer.from(JSON.stringify(authenticatedValue), 'utf8');
	if (body.byteLength > CONTRACT_LIMITS_V1.transportResultBytes + AUTHENTICATED_FRAME_OVERHEAD_BYTES_V1) {
		throw new Error('persistent-read-result-too-large');
	}
	const header = modules.buffer.allocUnsafe(4);
	new DataView(header.buffer, header.byteOffset, 4).setUint32(0, body.byteLength, false);
	const frame = modules.buffer.concat([header, body]);
	if (socket.write(frame)) return;
	await new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			socket.off('drain', onDrain);
			socket.off('error', onError);
			socket.off('close', onClose);
		};
		const onDrain = (): void => {
			cleanup();
			resolve();
		};
		const onError = (): void => {
			cleanup();
			reject(new Error('persistent-read-socket-error-during-drain'));
		};
		const onClose = (): void => {
			cleanup();
			reject(new Error('persistent-read-socket-closed-during-drain'));
		};
		socket.once('drain', onDrain);
		socket.once('error', onError);
		socket.once('close', onClose);
	});
}

function authenticateFrameV1(
	modules: PersistentReadNodeModulesV1,
	secret: string,
	value: Record<string, unknown>,
): Record<string, unknown> {
	const unsigned = {
		...value,
		authNonce: modules.crypto.randomBytes(32).toString('hex'),
	};
	return {
		...unsigned,
		authMac: modules.crypto.createHmac('sha256', secret)
			.update(stableAuthenticatedJsonV1(unsigned))
			.digest('hex'),
	};
}

async function publishDescriptorV1(
	modules: PersistentReadNodeModulesV1,
	rootPath: string,
	descriptorPath: string,
	descriptor: PersistentReadDescriptorV1,
	uid: number,
	beforeCommit: () => Promise<void>,
	canCommit: () => boolean,
): Promise<OwnedPathV1> {
	const temporaryPath = `${descriptorPath}.${modules.crypto.randomBytes(16).toString('hex')}.tmp`;
	const flags = modules.fs.constants.O_WRONLY
		| modules.fs.constants.O_CREAT
		| modules.fs.constants.O_EXCL
		| modules.fs.constants.O_NOFOLLOW;
	let temporaryIdentity: OwnedPathV1 | null = null;
	try {
		const handle = await modules.fsp.open(temporaryPath, flags, 0o600);
		try {
			await handle.writeFile(modules.buffer.from(`${JSON.stringify(descriptor)}\n`, 'utf8'));
			await handle.sync();
		} finally {
			await handle.close();
		}
		const temporaryStat = await modules.fsp.lstat(temporaryPath);
		if (
			temporaryStat.isSymbolicLink()
			|| !temporaryStat.isFile()
			|| temporaryStat.uid !== uid
			|| (temporaryStat.mode & 0o777) !== 0o600
		) {
			throw new Error('persistent-read-descriptor-not-secure');
		}
			temporaryIdentity = {
				path: temporaryPath,
				dev: temporaryStat.dev,
				ino: temporaryStat.ino,
			};
			await beforeCommit();
			if (!canCommit()) {
				throw new Error('persistent-read-descriptor-publication-cancelled');
			}
			modules.fs.renameSync(temporaryPath, descriptorPath);
		const publishedStat = await modules.fsp.lstat(descriptorPath);
		if (
			publishedStat.dev !== temporaryStat.dev
			|| publishedStat.ino !== temporaryStat.ino
			|| nodePathDirnameV1(descriptorPath) !== rootPath
		) {
			throw new Error('persistent-read-descriptor-publication-failed');
		}
		temporaryIdentity = null;
		return {
			path: descriptorPath,
			dev: publishedStat.dev,
			ino: publishedStat.ino,
		};
	} finally {
		await unlinkOwnedPathV1(modules, temporaryIdentity);
	}
}

function resolvePersistentEndpointRootV1(
	modules: PersistentReadNodeModulesV1,
	nodeApi: Awaited<ReturnType<ReturnType<typeof createAgentRuntimeDesktopNodeApiLoaderV1>>>,
	uid: number | null,
): string {
	if (modules.process.platform === 'win32') {
		const localAppData = modules.process.env['LOCALAPPDATA'];
		if (!localAppData) throw new Error('local-app-data-unavailable');
		return nodeApi.join(localAppData, 'Operon', 'runtime');
	}
	if (modules.process.platform === 'linux' && uid !== null) {
		const runtimeRoot = `/run/user/${uid}`;
		try {
			const stat = (runtimeRequireV1('node:fs') as {
				lstatSync(path: string): {
					uid: number;
					mode: number;
					isDirectory(): boolean;
					isSymbolicLink(): boolean;
				};
			}).lstatSync(runtimeRoot);
			if (
				stat.isDirectory()
				&& !stat.isSymbolicLink()
				&& stat.uid === uid
				&& (stat.mode & 0o077) === 0
			) return nodeApi.join(runtimeRoot, 'operon-agent-runtime');
		} catch {
			// Fall through to the verified per-user /tmp root.
		}
	}
	return nodeApi.join(
		modules.process.platform === 'darwin' ? '/private/tmp' : '/tmp',
		`operon-agent-runtime-uid-${uid ?? 'unavailable'}`,
	);
}

async function publishWindowsDescriptorV1(
	modules: PersistentReadNodeModulesV1,
	descriptorPath: string,
	descriptor: PersistentReadDescriptorV1,
	beforeCommit: () => Promise<void>,
	canCommit: () => boolean,
): Promise<OwnedPathV1> {
	const temporaryPath = `${descriptorPath}.${modules.crypto.randomBytes(16).toString('hex')}.tmp`;
	modules.fs.writeFileSync(
		temporaryPath,
		modules.buffer.from(`${JSON.stringify(descriptor)}\n`, 'utf8'),
		{ flag: 'wx', mode: 0o600 },
	);
	try {
		applyAndVerifyWindowsOwnerOnlyPathV1(modules, temporaryPath, false);
		const existing = await modules.fsp.lstat(descriptorPath).catch(() => null);
			if (existing) {
				if (existing.isSymbolicLink() || !existing.isFile()) {
					throw new Error('windows-descriptor-target-not-regular');
				}
				assertWindowsOwnerOnlyPathV1(modules, descriptorPath, false);
			}
			await beforeCommit();
			if (!canCommit()) {
				throw new Error('persistent-read-descriptor-publication-cancelled');
			}
			modules.fs.renameSync(temporaryPath, descriptorPath);
		assertWindowsOwnerOnlyPathV1(modules, descriptorPath, false);
		const stat = await modules.fsp.lstat(descriptorPath);
		return { path: descriptorPath, dev: stat.dev, ino: stat.ino };
	} catch (error) {
		await modules.fsp.unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

function applyAndVerifyWindowsOwnerOnlyPathV1(
	modules: PersistentReadNodeModulesV1,
	path: string,
	directory: boolean,
): void {
	const { executable, environment } = resolveWindowsPowerShellV1(modules);
	const rights = directory ? 'FullControl' : 'Read,Write,Delete';
	const inheritance = directory ? 'ContainerInherit,ObjectInherit' : 'None';
	const setAccessControl = directory
		? '[IO.Directory]::SetAccessControl($p,$acl)'
		: '[IO.File]::SetAccessControl($p,$acl)';
	const getAccessControl = directory
		? '[IO.Directory]::GetAccessControl($p)'
		: '[IO.File]::GetAccessControl($p)';
	const securityDescriptor = directory
		? '[Security.AccessControl.DirectorySecurity]::new()'
		: '[Security.AccessControl.FileSecurity]::new()';
	const script = [
		'$ErrorActionPreference="Stop"',
		`$p=[System.IO.Path]::GetFullPath(${powershellLiteralV1(path)})`,
		`$exists=${directory ? '[IO.Directory]::Exists($p)' : '[IO.File]::Exists($p)'}`,
		'if (-not $exists) { throw "path-kind-mismatch" }',
		'if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse-point" }',
		`$cursor=${directory ? '[IO.DirectoryInfo]::new($p)' : '([IO.FileInfo]::new($p)).Directory'}`,
		'while($null -ne $cursor){ if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse-point" }; $cursor=$cursor.Parent }',
		'$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User',
		`$acl=${securityDescriptor}`,
		'$acl.SetOwner($sid)',
		'$acl.SetAccessRuleProtection($true,$false)',
		`$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]"${rights}",[Security.AccessControl.InheritanceFlags]"${inheritance}",[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)`,
		'[void]$acl.AddAccessRule($rule)',
		setAccessControl,
		`$actual=${getAccessControl}`,
		'$owner=$actual.GetOwner([Security.Principal.SecurityIdentifier]).Value',
		'if ($owner -ne $sid.Value) { throw "owner-mismatch" }',
		'if (-not $actual.AreAccessRulesProtected) { throw "acl-inherited" }',
		'$rules=$actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])',
		'foreach($access in $rules){ if($access.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $access.IdentityReference.Value -ne $sid.Value){ throw "acl-too-broad" } }',
		'if ($rules.Count -eq 0) { throw "acl-too-broad" }',
		`[Console]::Out.Write('{"ok":true,"directory":${directory ? 'true' : 'false'}}')`,
	].join(';');
	const result = modules.childProcess.spawnSync(
		executable,
		['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
		{
			encoding: 'utf8',
			env: environment,
			shell: false,
			windowsHide: true,
			timeout: WINDOWS_ACL_TIMEOUT_MS_V1,
			maxBuffer: WINDOWS_ACL_RESULT_LIMIT_V1,
			killSignal: 'SIGKILL',
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error('windows-owner-only-acl-setup-failed');
	}
	if (result.stdout !== `{"ok":true,"directory":${directory ? 'true' : 'false'}}`) {
		throw new Error('windows-owner-only-acl-required');
	}
}

function assertWindowsOwnerOnlyPathV1(
	modules: PersistentReadNodeModulesV1,
	path: string,
	directory: boolean,
): void {
	const { executable, environment } = resolveWindowsPowerShellV1(modules);
	const getAccessControl = directory
		? '[IO.Directory]::GetAccessControl($p)'
		: '[IO.File]::GetAccessControl($p)';
	const script = [
		'$ErrorActionPreference="Stop"',
		`$p=[System.IO.Path]::GetFullPath(${powershellLiteralV1(path)})`,
		`$exists=${directory ? '[IO.Directory]::Exists($p)' : '[IO.File]::Exists($p)'}`,
		'if (-not $exists) { throw "path-kind-mismatch" }',
		'if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse-point" }',
		`$cursor=${directory ? '[IO.DirectoryInfo]::new($p)' : '([IO.FileInfo]::new($p)).Directory'}`,
		'while($null -ne $cursor){ if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "reparse-point" }; $cursor=$cursor.Parent }',
		'$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User',
		`$acl=${getAccessControl}`,
		'$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value',
		'if ($owner -ne $sid.Value) { throw "owner-mismatch" }',
		'if (-not $acl.AreAccessRulesProtected) { throw "acl-inherited" }',
		'$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])',
		'foreach($access in $rules){ if($access.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $access.IdentityReference.Value -ne $sid.Value){ throw "acl-too-broad" } }',
		'if ($rules.Count -eq 0) { throw "acl-too-broad" }',
		`[Console]::Out.Write('{"ok":true,"directory":${directory ? 'true' : 'false'}}')`,
	].join(';');
	const result = modules.childProcess.spawnSync(
		executable,
		['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
		{
			encoding: 'utf8',
			env: environment,
			shell: false,
			windowsHide: true,
			timeout: WINDOWS_ACL_TIMEOUT_MS_V1,
			maxBuffer: WINDOWS_ACL_RESULT_LIMIT_V1,
			killSignal: 'SIGKILL',
		},
	);
	if (
		result.error
		|| result.status !== 0
		|| result.stdout !== `{"ok":true,"directory":${directory ? 'true' : 'false'}}`
	) {
		throw new Error('windows-owner-only-acl-required');
	}
}

function resolveWindowsPowerShellV1(modules: PersistentReadNodeModulesV1): {
	readonly executable: string;
	readonly environment: Record<string, string>;
} {
	const systemRoot = modules.process.env.SystemRoot;
	const windowsDirectory = modules.process.env.WINDIR;
	if (
		!systemRoot
		|| !windowsDirectory
		|| systemRoot.includes('\0')
		|| windowsDirectory.includes('\0')
		|| !/^[A-Za-z]:[\\/]/u.test(systemRoot)
		|| !/^[A-Za-z]:[\\/]/u.test(windowsDirectory)
	) throw new Error('windows-powershell-unavailable');
	const normalize = (value: string): string => value.replace(/\//gu, '\\').replace(/\\+$/u, '');
	const normalizedRoot = normalize(systemRoot);
	if (normalizedRoot.toLocaleLowerCase('en-US') !== normalize(windowsDirectory).toLocaleLowerCase('en-US')) {
		throw new Error('windows-powershell-unavailable');
	}
	const executable = `${normalizedRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
	let cursor = executable;
	while (true) {
		let stat: ReturnType<PersistentReadNodeModulesV1['fs']['lstatSync']>;
		try {
			stat = modules.fs.lstatSync(cursor);
		} catch {
			throw new Error('windows-powershell-unavailable');
		}
		if (stat.isSymbolicLink() || (cursor === executable && !stat.isFile())) {
			throw new Error('windows-powershell-unavailable');
		}
		const separator = cursor.lastIndexOf('\\');
		if (separator <= 2) break;
		cursor = cursor.slice(0, separator);
	}
	return {
		executable,
		environment: {
			SystemRoot: normalizedRoot,
			WINDIR: normalizedRoot,
		},
	};
}

function powershellLiteralV1(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

function runtimeRequireV1(moduleId: string): unknown {
	const runtimeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
	if (typeof runtimeRequire !== 'function') throw new Error('desktop-require-unavailable');
	return runtimeRequire(moduleId);
}

function nodePathDirnameV1(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

async function unlinkOwnedPathV1(
	modules: PersistentReadNodeModulesV1,
	owned: OwnedPathV1 | null,
): Promise<void> {
	if (!owned) return;
	const current = await modules.fsp.lstat(owned.path).catch(() => null);
	if (
		current
		&& !current.isSymbolicLink()
		&& current.dev === owned.dev
		&& current.ino === owned.ino
	) {
		await modules.fsp.unlink(owned.path).catch(() => undefined);
	}
}

function unavailableHandle(reason: string): AgentRuntimePersistentReadServerHandleV1 {
	return {
		available: false,
		reason,
		onUnavailable: () => () => undefined,
		close: () => Promise.resolve(),
	};
}

function classifyPersistentReadServerStartFailureV1(error: unknown): string {
	if (
		error instanceof Error
		&& [
			'local-app-data-unavailable',
			'windows-owner-only-acl-setup-failed',
			'windows-owner-only-acl-required',
			'windows-powershell-unavailable',
		].includes(error.message)
	) return error.message;
	if (
		error
		&& typeof error === 'object'
		&& 'code' in error
		&& error.code === 'EPERM'
	) return 'persistent-read-server-listen-denied';
	if (error instanceof Error && /\blisten\s+EPERM\b/u.test(error.message)) {
		return 'persistent-read-server-listen-denied';
	}
	return 'persistent-read-server-start-failed';
}

function isRecordV1(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPersistentReadNodeModulesV1(): PersistentReadNodeModulesV1 {
	const runtimeRequire = (window as unknown as {
		require?: (moduleId: string) => unknown;
	}).require;
	if (typeof runtimeRequire !== 'function') throw new Error('desktop-require-unavailable');
	return {
		buffer: (runtimeRequire('node:buffer') as { Buffer: PersistentReadNodeModulesV1['buffer'] }).Buffer,
		crypto: runtimeRequire('node:crypto') as PersistentReadNodeModulesV1['crypto'],
		fs: runtimeRequire('node:fs') as PersistentReadNodeModulesV1['fs'],
		fsp: runtimeRequire('node:fs/promises') as PersistentReadNodeModulesV1['fsp'],
		net: runtimeRequire('node:net') as PersistentReadNodeModulesV1['net'],
		process: runtimeRequire('node:process') as PersistentReadNodeModulesV1['process'],
		os: runtimeRequire('node:os') as PersistentReadNodeModulesV1['os'],
		childProcess: runtimeRequire('node:child_process') as PersistentReadNodeModulesV1['childProcess'],
	};
}
