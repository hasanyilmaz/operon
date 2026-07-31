import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
} from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { release } from 'node:os';
import path from 'node:path';

import { CONTRACT_LIMITS_V1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import type { CliInvocationV1 } from '../../../src/agent-runtime/contracts/v1/cli';
import {
	type CanonicalVaultFenceV1,
	assertCanonicalVaultFenceV1,
	ensureSecureRequestRootV1,
} from './protocol';
import {
	assertSecureFileV1,
	ensureSecureDirectoryV1,
} from './secure-storage';

const DESCRIPTOR_MAX_BYTES = 16 * 1024;
const AUTHENTICATED_FRAME_MAX_BYTES = CONTRACT_LIMITS_V1.transportInputBytes + 16 * 1024;
const AUTHENTICATED_RESULT_FRAME_MAX_BYTES = CONTRACT_LIMITS_V1.transportResultBytes + 16 * 1024;
const PROTOCOL_VERSION = 1;
const HEX_64 = /^[a-f0-9]{64}$/u;
const UNIX_SOCKET_BASENAME = /^read-[a-f0-9]{48}\.sock$/u;
const WINDOWS_PIPE = /^\\\\\.\\pipe\\operon-[a-f0-9]{64}$/u;
const READ_COMMANDS = new Set(['health', 'task.get', 'tasks.query', 'context.build']);

interface PersistentDescriptorV1 {
	protocolVersion: 1;
	serverInstanceId: string;
	vaultSha256: string;
	endpointKind: 'unix-domain-socket' | 'windows-named-pipe';
	endpoint: string;
	authSecret: string;
	expiresAt: number;
	pluginVersion: string;
	apiVersion: 1;
}

interface PersistentResponseV1 {
	type: 'response';
	sequence: number;
	requestId: string;
	result: string;
}

interface PersistentBatchItemResponseV1 {
	type: 'batch-item-response';
	sequence: number;
	index: number;
	requestId: string;
	result: string;
}

export interface PersistentReadInvocationV1 {
	requestId: string;
	command: string;
	requestToken: string;
	vaultFence: CanonicalVaultFenceV1;
	signal?: AbortSignal;
}

export interface PersistentReadResultV1 {
	result: Buffer;
	totalMs: number;
}

export interface PersistentReadTransportEvidenceV1 {
	requestId: string;
	command: string;
	transport: 'persistent' | 'request-file-fallback';
	socketFrames?: number;
	requestFiles?: number;
	runtimeReads?: number;
	batchSize?: number;
	batchIndex?: number;
}

export class PersistentReadTransportErrorV1 extends Error {
	constructor(
		code: string,
		readonly frameSent: boolean,
	) {
		super(code);
		this.name = 'PersistentReadTransportErrorV1';
	}
}

export class PersistentReadTransportV1 {
	private connection: PersistentConnectionV1 | null = null;
	private lastEvidence: 'persistent' | 'request-file-fallback' | null = null;
	private batchExpected = 0;
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private batchQueue: Array<{
		invocation: PersistentReadInvocationV1;
		resolve(value: PersistentReadResultV1): void;
		reject(error: Error): void;
		startedAt: number;
	}> = [];

	constructor(
		private readonly requestRoot = persistentEndpointRootV1(),
		private readonly evidenceSink?: (evidence: PersistentReadTransportEvidenceV1) => void,
	) {}

	beginBatch(count: number): void {
		if (this.batchExpected !== 0 || count < 2 || count > 8) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_BATCH_INVALID', false);
		}
		this.batchExpected = count;
		this.batchQueue = [];
		this.batchTimer = setTimeout(() => this.rejectIncompleteBatch(), 5_000);
	}

	async invoke(invocation: PersistentReadInvocationV1): Promise<PersistentReadResultV1> {
		if (!READ_COMMANDS.has(invocation.command)) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_COMMAND_NOT_ALLOWED', false);
		}
		assertCanonicalVaultFenceV1(invocation.vaultFence);
		if (this.batchExpected > 0) {
			return await new Promise<PersistentReadResultV1>((resolve, reject) => {
				this.batchQueue.push({
					invocation,
					resolve,
					reject,
					startedAt: performance.now(),
				});
				if (this.batchQueue.length === this.batchExpected) {
					if (this.batchTimer) clearTimeout(this.batchTimer);
					this.batchTimer = null;
					void this.flushBatch();
				}
			});
		}
		const startedAt = performance.now();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				let connection = this.connection;
				if (
					!connection
					|| connection.vaultSha256 !== invocation.vaultFence.sha256
					|| !connection.isUsable()
				) {
					this.close();
					connection = await PersistentConnectionV1.connect(
						this.requestRoot,
						invocation.vaultFence.sha256,
						invocation.signal,
					);
					this.connection = connection;
				}
				assertCanonicalVaultFenceV1(invocation.vaultFence);
				const result = await connection.request({
					requestId: invocation.requestId,
					command: invocation.command,
					requestToken: invocation.requestToken,
				}, invocation.signal);
				this.lastEvidence = 'persistent';
				this.evidenceSink?.({
					requestId: invocation.requestId,
					command: invocation.command,
					transport: 'persistent',
				});
				return {
					result: Buffer.from(result, 'utf8'),
					totalMs: Math.max(0, performance.now() - startedAt),
				};
			} catch (error) {
				this.close();
				const failure = error instanceof PersistentReadTransportErrorV1
					? error
					: new PersistentReadTransportErrorV1('PERSISTENT_REQUEST_FAILED', true);
				if (attempt === 0 && !failure.frameSent && !invocation.signal?.aborted) continue;
				throw failure;
			}
		}
		throw new PersistentReadTransportErrorV1('PERSISTENT_REQUEST_FAILED', false);
	}

	private async flushBatch(): Promise<void> {
		const queued = this.batchQueue;
		const expected = this.batchExpected;
		this.batchQueue = [];
		this.batchExpected = 0;
		if (queued.length !== expected) {
			for (const item of queued) {
				item.reject(new PersistentReadTransportErrorV1('PERSISTENT_BATCH_INCOMPLETE', false));
			}
			return;
		}
		const vaultSha256 = queued[0]?.invocation.vaultFence.sha256;
		if (!vaultSha256 || queued.some(item => item.invocation.vaultFence.sha256 !== vaultSha256)) {
			for (const item of queued) {
				item.reject(new PersistentReadTransportErrorV1('PERSISTENT_BATCH_VAULT_MISMATCH', false));
			}
			return;
		}
		let connection = this.connection;
		const completed = new Set<number>();
		let socketFrameReported = false;
		try {
			for (const item of queued) assertCanonicalVaultFenceV1(item.invocation.vaultFence);
			if (
				!connection
				|| connection.vaultSha256 !== vaultSha256
				|| !connection.isUsable()
			) {
				this.close();
				connection = await PersistentConnectionV1.connect(
					this.requestRoot,
					vaultSha256,
					queued[0]?.invocation.signal,
				);
				this.connection = connection;
			}
			await connection.requestBatch(queued.map(item => ({
				requestId: item.invocation.requestId,
				command: item.invocation.command,
				requestToken: item.invocation.requestToken,
			})), queued[0]?.invocation.signal, (index, result) => {
				const item = queued[index];
				if (!item) return;
				completed.add(index);
				this.lastEvidence = 'persistent';
				const socketFrames = socketFrameReported ? 0 : 1;
				socketFrameReported = true;
				this.evidenceSink?.({
					requestId: item.invocation.requestId,
					command: item.invocation.command,
					transport: 'persistent',
					socketFrames,
					requestFiles: 1,
					runtimeReads: 1,
					batchSize: queued.length,
					batchIndex: index,
				});
				item.resolve({
					result: Buffer.from(result, 'utf8'),
					totalMs: Math.max(0, performance.now() - item.startedAt),
				});
			});
		} catch (error) {
			this.close();
			const failure = error instanceof PersistentReadTransportErrorV1
				? error
				: new PersistentReadTransportErrorV1('PERSISTENT_BATCH_FAILED', true);
			for (const item of queued) {
				// Already completed children were resolved as their response frames arrived.
				if (!completed.has(queued.indexOf(item))) item.reject(failure);
			}
		}
	}

	private rejectIncompleteBatch(): void {
		const queued = this.batchQueue;
		this.batchQueue = [];
		this.batchExpected = 0;
		this.batchTimer = null;
		for (const item of queued) {
			item.reject(new PersistentReadTransportErrorV1('PERSISTENT_BATCH_INCOMPLETE', false));
		}
	}

	noteFallback(invocation: PersistentReadInvocationV1): void {
		this.lastEvidence = 'request-file-fallback';
		this.evidenceSink?.({
			requestId: invocation.requestId,
			command: invocation.command,
			transport: 'request-file-fallback',
		});
	}

	consumeLastEvidence(): 'persistent' | 'request-file-fallback' | null {
		const evidence = this.lastEvidence;
		this.lastEvidence = null;
		return evidence;
	}

	close(): void {
		if (this.batchTimer) clearTimeout(this.batchTimer);
		this.batchTimer = null;
		this.rejectIncompleteBatch();
		this.connection?.close();
		this.connection = null;
	}
}

export type WindowsBrokerStageStateV1 =
	| 'staged'
	| 'consumed'
	| 'dispatch-started'
	| 'unknown';

export interface WindowsBrokerClientOptionsV1 {
	vaultSha256: string;
	signal?: AbortSignal;
}

export class WindowsBrokerClientV1 {
	private constructor(
		private readonly connection: PersistentConnectionV1,
		private readonly defaultSignal?: AbortSignal,
	) {}

	static async create(options: WindowsBrokerClientOptionsV1): Promise<WindowsBrokerClientV1> {
		if (process.platform !== 'win32') {
			throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_PLATFORM_REQUIRED', false);
		}
		const connection = await PersistentConnectionV1.connect(
			persistentEndpointRootV1(),
			options.vaultSha256,
			options.signal,
		);
		if (connection.endpointKind !== 'windows-named-pipe') {
			connection.close();
			throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_ENDPOINT_REQUIRED', false);
		}
		return new WindowsBrokerClientV1(connection, options.signal);
	}

	async stage(invocation: CliInvocationV1): Promise<{
		requestToken: string;
		stagingReceipt: string;
	}> {
		const response = await this.connection.brokerRequest({
			type: 'stage',
			requestId: invocation.requestId,
			invocation: JSON.stringify(invocation),
		}, this.defaultSignal);
		if (
			typeof response.requestToken !== 'string'
			|| !/^[A-Za-z0-9_-]{32}$/u.test(response.requestToken)
			|| typeof response.stagingReceipt !== 'string'
			|| !HEX_64.test(response.stagingReceipt)
			|| response.state !== 'staged'
		) throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_STAGE_INVALID', true);
		return {
			requestToken: response.requestToken,
			stagingReceipt: response.stagingReceipt,
		};
	}

	async status(requestToken: string): Promise<{ state: WindowsBrokerStageStateV1 }> {
		const response = await this.connection.brokerRequest({
			type: 'status',
			requestId: randomBytes(16).toString('hex'),
			requestToken,
		}, this.defaultSignal);
		return { state: parseBrokerStateV1(response.state) };
	}

	async cancel(requestToken: string): Promise<{
		cancelled: boolean;
		state: WindowsBrokerStageStateV1;
	}> {
		const response = await this.connection.brokerRequest({
			type: 'cancel',
			requestId: randomBytes(16).toString('hex'),
			requestToken,
		}, this.defaultSignal);
		if (typeof response.cancelled !== 'boolean') {
			throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_CANCEL_INVALID', true);
		}
		return {
			cancelled: response.cancelled,
			state: parseBrokerStateV1(response.state),
		};
	}

	close(): void {
		this.connection.close();
	}
}

export async function createWindowsBrokerClientV1(
	options: WindowsBrokerClientOptionsV1,
): Promise<WindowsBrokerClientV1> {
	return WindowsBrokerClientV1.create(options);
}

function parseBrokerStateV1(value: unknown): WindowsBrokerStageStateV1 {
	if (value === 'staged' || value === 'consumed' || value === 'dispatch-started' || value === 'unknown') {
		return value;
	}
	throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_STATE_INVALID', true);
}

export function persistentEndpointRootV1(): string {
	if (process.platform === 'win32') {
		const localAppData = process.env['LOCALAPPDATA'];
		if (!localAppData) throw new PersistentReadTransportErrorV1('PERSISTENT_LOCAL_APP_DATA_MISSING', false);
		return path.join(localAppData, 'Operon', 'runtime');
	}
	const uid = typeof process.getuid === 'function' ? process.getuid() : null;
	const userSegment = uid === null ? 'uid-unavailable' : `uid-${uid}`;
	if (process.platform === 'linux') {
		if (isWslV1()) throw new PersistentReadTransportErrorV1('PERSISTENT_WSL_UNSUPPORTED', false);
		const runtimeRoot = uid === null ? null : `/run/user/${uid}`;
		if (runtimeRoot) {
			try {
				const stat = lstatSync(runtimeRoot);
				if (
					stat.isDirectory()
					&& !stat.isSymbolicLink()
					&& stat.uid === uid
					&& (stat.mode & 0o077) === 0
				) return path.join(runtimeRoot, 'operon-agent-runtime');
			} catch {
				// Use the verified per-user /tmp fallback.
			}
		}
		return path.join('/tmp', `operon-agent-runtime-${userSegment}`);
	}
	return path.join('/private/tmp', `operon-agent-runtime-${userSegment}`);
}

function isWslV1(): boolean {
	return Boolean(process.env['WSL_DISTRO_NAME'])
		|| Boolean(process.env['WSL_INTEROP'])
		|| release().toLowerCase().includes('microsoft');
}

class PersistentConnectionV1 {
	private sequence = 0;
	private pending: PendingFrameV1 | null = null;
	private input: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	private closed = false;

	private constructor(
		private readonly socket: Socket,
		readonly vaultSha256: string,
		private readonly descriptor: PersistentDescriptorV1,
		private readonly connectionNonce: string,
	) {
		socket.on('data', chunk => this.receive(Buffer.from(chunk)));
		socket.on('error', () => this.markClosed('PERSISTENT_SOCKET_ERROR'));
		socket.on('close', () => this.markClosed('PERSISTENT_SOCKET_CLOSED'));
	}

	get endpointKind(): PersistentDescriptorV1['endpointKind'] {
		return this.descriptor.endpointKind;
	}

	isUsable(): boolean {
		return !this.closed && !this.socket.destroyed;
	}

	authenticate(value: Record<string, unknown>): Record<string, unknown> {
		const unsigned = {
			...value,
			connectionNonce: this.connectionNonce,
			authNonce: randomBytes(32).toString('hex'),
		};
		return {
			...unsigned,
			authMac: createHmac('sha256', this.descriptor.authSecret)
				.update(stableAuthenticatedJsonV1(unsigned))
				.digest('hex'),
		};
	}

	verifyAuthenticatedFrame(value: unknown): value is Record<string, unknown> {
		if (
			!isRecord(value)
			|| value.connectionNonce !== this.connectionNonce
			|| typeof value.authMac !== 'string'
			|| !HEX_64.test(value.authMac)
		) {
			return false;
		}
		const expected = createHmac('sha256', this.descriptor.authSecret)
			.update(stableAuthenticatedJsonV1(value))
			.digest('hex');
		return timingSafeEqual(Buffer.from(value.authMac, 'utf8'), Buffer.from(expected, 'utf8'));
	}

	static async connect(
		requestRoot: string,
		vaultSha256: string,
		signal?: AbortSignal,
	): Promise<PersistentConnectionV1> {
		if (!['darwin', 'linux', 'win32'].includes(process.platform) || isWslV1()) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_PLATFORM_UNSUPPORTED', false);
		}
		const root = process.platform === 'win32'
			? (ensureSecureDirectoryV1(requestRoot), requestRoot)
			: ensureSecureRequestRootV1(requestRoot);
		const descriptor = readSecureDescriptor(root, vaultSha256);
		const socketPath = descriptor.endpoint;
		const socketIdentity = descriptor.endpointKind === 'unix-domain-socket'
			? assertSecureSocket(socketPath)
			: null;
		const socket = await connectSocket(socketPath, signal);
		const connectedIdentity = descriptor.endpointKind === 'unix-domain-socket'
			? assertSecureSocket(socketPath)
			: null;
		if (
			socketIdentity
			&& connectedIdentity
			&& (
				connectedIdentity.dev !== socketIdentity.dev
				|| connectedIdentity.ino !== socketIdentity.ino
			)
		) {
			socket.destroy();
			throw new PersistentReadTransportErrorV1('PERSISTENT_SOCKET_CHANGED', false);
		}
		const connectionNonce = randomBytes(32).toString('hex');
		const connection = new PersistentConnectionV1(
			socket,
			vaultSha256,
			descriptor,
			connectionNonce,
		);
		try {
			const hello = await connection.exchange(connection.authenticate({
				type: 'hello',
				protocolVersion: PROTOCOL_VERSION,
				serverInstanceId: descriptor.serverInstanceId,
				vaultSha256,
				connectionNonce,
			}), signal, false);
			if (
				!isRecord(hello)
				|| hello.type !== 'hello-ack'
				|| hello.protocolVersion !== PROTOCOL_VERSION
				|| hello.serverInstanceId !== descriptor.serverInstanceId
				|| hello.vaultSha256 !== vaultSha256
				|| hello.connectionNonce !== connectionNonce
				|| !connection.verifyAuthenticatedFrame(hello)
			) throw new PersistentReadTransportErrorV1('PERSISTENT_HANDSHAKE_INVALID', false);
			return connection;
		} catch (error) {
			connection.close();
			if (error instanceof PersistentReadTransportErrorV1) throw error;
			throw new PersistentReadTransportErrorV1('PERSISTENT_HANDSHAKE_FAILED', false);
		}
	}

	async request(
		request: { requestId: string; command: string; requestToken: string },
		signal?: AbortSignal,
	): Promise<string> {
		this.sequence += 1;
		const response = await this.exchange(this.authenticate({
			type: 'request',
			sequence: this.sequence,
			...request,
		}), signal, true);
		if (
			!isPersistentResponse(response)
			|| response.sequence !== this.sequence
			|| response.requestId !== request.requestId
		) throw new PersistentReadTransportErrorV1('PERSISTENT_RESPONSE_INVALID', true);
		if (Buffer.byteLength(response.result, 'utf8') > CONTRACT_LIMITS_V1.transportResultBytes) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_RESULT_TOO_LARGE', true);
		}
		return response.result;
	}

	async requestBatch(
		requests: Array<{ requestId: string; command: string; requestToken: string }>,
		signal?: AbortSignal,
		onItem?: (index: number, result: string) => void,
	): Promise<void> {
		this.sequence += 1;
		await this.exchangeBatch(this.authenticate({
			type: 'batch',
			sequence: this.sequence,
			requests,
		}), requests.map(request => request.requestId), signal, onItem);
	}

	async brokerRequest(
		request: {
			type: 'stage' | 'status' | 'cancel';
			requestId: string;
			requestToken?: string;
			invocation?: string;
		},
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		this.sequence += 1;
		const response = await this.exchange(this.authenticate({
			...request,
			sequence: this.sequence,
		}), signal, true);
		if (
			!isRecord(response)
			|| response.type !== 'broker-response'
			|| response.sequence !== this.sequence
			|| response.requestId !== request.requestId
		) throw new PersistentReadTransportErrorV1('WINDOWS_BROKER_RESPONSE_INVALID', true);
		return response;
	}

	private exchangeBatch(
		message: Record<string, unknown>,
		requestIds: string[],
		signal: AbortSignal | undefined,
		onItem?: (index: number, result: string) => void,
	): Promise<void> {
		if (this.closed || this.pending) {
			return Promise.reject(new PersistentReadTransportErrorV1(
				this.closed ? 'PERSISTENT_SOCKET_CLOSED' : 'PERSISTENT_REQUEST_IN_FLIGHT',
				false,
			));
		}
		const body = Buffer.from(JSON.stringify(message), 'utf8');
		if (body.byteLength > AUTHENTICATED_FRAME_MAX_BYTES) {
			return Promise.reject(new PersistentReadTransportErrorV1('PERSISTENT_FRAME_TOO_LARGE', false));
		}
		const frame = Buffer.allocUnsafe(4 + body.byteLength);
		frame.writeUInt32BE(body.byteLength, 0);
		body.copy(frame, 4);
		return new Promise<void>((resolve, reject) => {
			const abort = () => {
				this.pending = null;
				this.close();
				reject(new PersistentReadTransportErrorV1('PERSISTENT_ABORTED', true));
			};
			this.pending = {
				resolve,
				reject,
				frameSent: true,
				batch: { requestIds, completed: new Set<number>(), onItem },
				...(signal ? { signal, abort } : {}),
			};
			signal?.addEventListener('abort', abort, { once: true });
			this.socket.write(frame, error => {
				if (error) this.fail('PERSISTENT_WRITE_FAILED');
			});
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.socket.destroy();
		this.fail('PERSISTENT_SOCKET_CLOSED');
	}

	private markClosed(code: string): void {
		this.closed = true;
		this.fail(code);
	}

	private exchange(
		message: Record<string, unknown>,
		signal: AbortSignal | undefined,
		frameSent: boolean,
	): Promise<unknown> {
		if (this.closed || this.pending) {
			return Promise.reject(new PersistentReadTransportErrorV1(
				this.closed ? 'PERSISTENT_SOCKET_CLOSED' : 'PERSISTENT_REQUEST_IN_FLIGHT',
				false,
			));
		}
		const body = Buffer.from(JSON.stringify(message), 'utf8');
		if (body.byteLength > AUTHENTICATED_FRAME_MAX_BYTES) {
			return Promise.reject(new PersistentReadTransportErrorV1(
				'PERSISTENT_FRAME_TOO_LARGE',
				false,
			));
		}
		const frame = Buffer.allocUnsafe(4 + body.byteLength);
		frame.writeUInt32BE(body.byteLength, 0);
		body.copy(frame, 4);
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.pending = null;
				this.close();
				reject(new PersistentReadTransportErrorV1('PERSISTENT_ABORTED', frameSent));
			};
			this.pending = {
				resolve,
				reject,
				frameSent,
				...(signal ? { signal, abort } : {}),
			};
			signal?.addEventListener('abort', abort, { once: true });
			this.socket.write(frame, error => {
				if (error) this.fail('PERSISTENT_WRITE_FAILED');
			});
		});
	}

	private receive(chunk: Buffer): void {
		if (this.closed) return;
		this.input = this.input.byteLength === 0 ? chunk : Buffer.concat([this.input, chunk]);
		while (this.input.byteLength >= 4) {
			const length = this.input.readUInt32BE(0);
			if (length < 1 || length > AUTHENTICATED_RESULT_FRAME_MAX_BYTES) {
				this.fail('PERSISTENT_FRAME_INVALID');
				return;
			}
			if (this.input.byteLength < 4 + length) return;
			const body = this.input.subarray(4, 4 + length);
			this.input = this.input.subarray(4 + length);
			this.receiveFrame(body);
			if (this.closed) return;
		}
	}

	private receiveFrame(body: Buffer): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
		} catch {
			this.fail('PERSISTENT_FRAME_INVALID');
			return;
		}
		const pending = this.pending;
		if (!pending) {
			this.fail('PERSISTENT_UNSOLICITED_FRAME');
			return;
		}
		if (!this.verifyAuthenticatedFrame(parsed)) {
			this.fail('PERSISTENT_FRAME_AUTH_INVALID');
			return;
		}
		if (pending.batch) {
			if (
				!isPersistentBatchItemResponse(parsed)
				|| parsed.sequence !== this.sequence
				|| parsed.index < 0
				|| parsed.index >= pending.batch.requestIds.length
				|| pending.batch.completed.has(parsed.index)
				|| parsed.requestId !== pending.batch.requestIds[parsed.index]
				|| Buffer.byteLength(parsed.result, 'utf8') > CONTRACT_LIMITS_V1.transportResultBytes
			) {
				this.fail('PERSISTENT_BATCH_RESPONSE_INVALID');
				return;
			}
			pending.batch.completed.add(parsed.index);
			pending.batch.onItem?.(parsed.index, parsed.result);
			if (pending.batch.completed.size < pending.batch.requestIds.length) return;
			this.pending = null;
			if (pending.signal && pending.abort) {
				pending.signal.removeEventListener('abort', pending.abort);
			}
			pending.resolve(undefined);
			return;
		}
		this.pending = null;
		if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
		if (isRecord(parsed) && parsed.type === 'error') {
			pending.reject(new PersistentReadTransportErrorV1('PERSISTENT_SERVER_REJECTED', pending.frameSent));
			return;
		}
		pending.resolve(parsed);
	}

	private fail(code: string): void {
		const pending = this.pending;
		this.pending = null;
		if (pending?.signal && pending.abort) {
			pending.signal.removeEventListener('abort', pending.abort);
		}
		pending?.reject(new PersistentReadTransportErrorV1(code, pending.frameSent));
	}
}

interface PendingFrameV1 {
	resolve(value: unknown): void;
	reject(error: Error): void;
	frameSent: boolean;
	signal?: AbortSignal;
	abort?: () => void;
	batch?: {
		requestIds: string[];
		completed: Set<number>;
		onItem?: (index: number, result: string) => void;
	};
}

function readSecureDescriptor(root: string, vaultSha256: string): PersistentDescriptorV1 {
	if (!HEX_64.test(vaultSha256)) throw new PersistentReadTransportErrorV1('PERSISTENT_VAULT_SHA_INVALID', false);
	const descriptorPath = path.join(root, `persistent-read-${vaultSha256}.json`);
	let pathStat: ReturnType<typeof lstatSync>;
	try {
		pathStat = lstatSync(descriptorPath);
	} catch (error) {
		if (isErrorCodeV1(error, 'ENOENT')) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_DESCRIPTOR_MISSING', false);
		}
		throw error;
	}
	if (
		pathStat.isSymbolicLink()
		|| !pathStat.isFile()
		|| (process.platform !== 'win32' && (pathStat.mode & 0o777) !== 0o600)
	) {
		throw new PersistentReadTransportErrorV1('PERSISTENT_DESCRIPTOR_INSECURE', false);
	}
	if (process.platform === 'win32') assertSecureFileV1(descriptorPath);
	if (typeof process.getuid === 'function' && pathStat.uid !== process.getuid()) {
		throw new PersistentReadTransportErrorV1('PERSISTENT_DESCRIPTOR_WRONG_OWNER', false);
	}
	let descriptorFd: number | null = null;
	try {
		descriptorFd = openSync(
			descriptorPath,
			fsConstants.O_RDONLY
				| (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0)),
		);
		const openedStat = fstatSync(descriptorFd);
		if (
			openedStat.dev !== pathStat.dev
			|| openedStat.ino !== pathStat.ino
			|| openedStat.size < 2
			|| openedStat.size > DESCRIPTOR_MAX_BYTES
		) throw new PersistentReadTransportErrorV1('PERSISTENT_DESCRIPTOR_CHANGED', false);
		const parsed = JSON.parse(readFileSync(descriptorFd, 'utf8')) as unknown;
		if (!isDescriptor(parsed, vaultSha256, root)) {
			throw new PersistentReadTransportErrorV1('PERSISTENT_DESCRIPTOR_INVALID', false);
		}
		return parsed;
	} finally {
		if (descriptorFd !== null) closeSync(descriptorFd);
	}
}

function isErrorCodeV1(error: unknown, code: string): boolean {
	return typeof error === 'object'
		&& error !== null
		&& 'code' in error
		&& (error as { code?: unknown }).code === code;
}

function assertSecureSocket(socketPath: string): { dev: number; ino: number } {
	const stat = lstatSync(socketPath);
	if (
		stat.isSymbolicLink()
		|| !stat.isSocket()
		|| (stat.mode & 0o777) !== 0o600
		|| (typeof process.getuid === 'function' && stat.uid !== process.getuid())
	) throw new PersistentReadTransportErrorV1('PERSISTENT_SOCKET_INSECURE', false);
	return { dev: stat.dev, ino: stat.ino };
}

function connectSocket(socketPath: string, signal?: AbortSignal): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection({ path: socketPath });
		socket.setTimeout(30_000, () => socket.destroy(new Error('PERSISTENT_IDLE_TIMEOUT')));
		const cleanup = () => {
			socket.removeListener('connect', onConnect);
			socket.removeListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
		};
		const onConnect = () => {
			cleanup();
			resolve(socket);
		};
		const onError = () => {
			cleanup();
			socket.destroy();
			reject(new PersistentReadTransportErrorV1('PERSISTENT_CONNECT_FAILED', false));
		};
		const onAbort = () => {
			cleanup();
			socket.destroy();
			reject(new PersistentReadTransportErrorV1('PERSISTENT_ABORTED', false));
		};
		socket.once('connect', onConnect);
		socket.once('error', onError);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function isDescriptor(
	value: unknown,
	vaultSha256: string,
	root: string,
): value is PersistentDescriptorV1 {
	return isRecord(value)
		&& Object.keys(value).length === 9
		&& Object.keys(value).every(key => [
			'protocolVersion',
			'serverInstanceId',
			'vaultSha256',
			'endpointKind',
			'endpoint',
			'authSecret',
			'expiresAt',
			'pluginVersion',
			'apiVersion',
		].includes(key))
		&& value.protocolVersion === PROTOCOL_VERSION
		&& value.apiVersion === 1
		&& value.vaultSha256 === vaultSha256
		&& typeof value.serverInstanceId === 'string'
		&& HEX_64.test(value.serverInstanceId)
		&& (value.endpointKind === 'unix-domain-socket' || value.endpointKind === 'windows-named-pipe')
		&& typeof value.endpoint === 'string'
		&& (
			(
				value.endpointKind === 'unix-domain-socket'
				&& path.dirname(value.endpoint) === root
				&& UNIX_SOCKET_BASENAME.test(path.basename(value.endpoint))
			)
			|| (value.endpointKind === 'windows-named-pipe' && WINDOWS_PIPE.test(value.endpoint))
		)
		&& typeof value.authSecret === 'string'
		&& HEX_64.test(value.authSecret)
		&& typeof value.expiresAt === 'number'
		&& Number.isSafeInteger(value.expiresAt)
		&& value.expiresAt > Date.now()
		&& typeof value.pluginVersion === 'string'
		&& value.pluginVersion.length > 0;
}

function isPersistentResponse(value: unknown): value is PersistentResponseV1 {
	return isRecord(value)
		&& value.type === 'response'
		&& Number.isSafeInteger(value.sequence)
		&& typeof value.requestId === 'string'
		&& typeof value.result === 'string';
}

function isPersistentBatchItemResponse(value: unknown): value is PersistentBatchItemResponseV1 {
	return isRecord(value)
		&& value.type === 'batch-item-response'
		&& Number.isSafeInteger(value.sequence)
		&& Number.isSafeInteger(value.index)
		&& typeof value.requestId === 'string'
		&& typeof value.result === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableAuthenticatedJsonV1(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableAuthenticatedJsonV1).join(',')}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.filter(key => key !== 'authMac')
			.sort()
			.map(key => `${JSON.stringify(key)}:${stableAuthenticatedJsonV1(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}
