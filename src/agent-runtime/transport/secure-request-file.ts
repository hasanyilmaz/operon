import { CONTRACT_LIMITS_V1 } from '../contracts/v1/primitives';
import {
	AgentRuntimeTransportErrorV1,
	type AgentRuntimeDesktopNodeApiV1,
	type AgentRuntimeTransportFileHandleV1,
} from './types';
import { normalizeCanonicalVaultPathForIdentityV1 } from './vault-path-identity';

export const AGENT_RUNTIME_REQUEST_TOKEN_PATTERN_V1 = /^[A-Za-z0-9_-]{32}$/u;
export const AGENT_RUNTIME_VAULT_SHA256_PATTERN_V1 = /^[a-f0-9]{64}$/u;
export const AGENT_RUNTIME_REQUEST_FILE_SUFFIX_V1 = '.request.json';

export interface ConsumedAgentRuntimeRequestFileV1 {
	readonly raw: string;
	readonly inputBytes: number;
}

interface AgentRuntimeRequestFileIdentityV1 {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly ctimeMs: number;
}

export function getAgentRuntimeRequestRootV1(nodeApi: AgentRuntimeDesktopNodeApiV1): string {
	const uid = nodeApi.getuid();
	if (uid === null) {
		throw new AgentRuntimeTransportErrorV1(
			'transport-unavailable',
			'owner-identity-unavailable',
		);
	}
	return nodeApi.join(nodeApi.tmpdir(), `operon-agent-runtime-uid-${uid}`);
}

export async function readAndConsumeAgentRuntimeRequestFileV1(
	nodeApi: AgentRuntimeDesktopNodeApiV1,
	tokenValue: string | undefined,
): Promise<ConsumedAgentRuntimeRequestFileV1> {
	const token = tokenValue ?? '';
	if (!AGENT_RUNTIME_REQUEST_TOKEN_PATTERN_V1.test(token)) {
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'invalid-request-token');
	}

	const requestRoot = getAgentRuntimeRequestRootV1(nodeApi);
	await nodeApi.mkdir(requestRoot, { recursive: true, mode: 0o700 });
	const rootStat = await nodeApi.lstat(requestRoot);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-root-not-secure');
	}
	const currentUid = nodeApi.getuid();
	if (currentUid === null || rootStat.uid !== currentUid) {
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-root-owner-mismatch');
	}
	if ((rootStat.mode & 0o777) !== 0o700) {
		throw new AgentRuntimeTransportErrorV1(
			'invalid-request',
			'request-root-permissions-not-owner-only',
		);
	}

	const rootPath = await nodeApi.realpath(requestRoot);
	const requestPath = nodeApi.resolve(rootPath, `${token}${AGENT_RUNTIME_REQUEST_FILE_SUFFIX_V1}`);
	if (nodeApi.dirname(requestPath) !== rootPath) {
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-path-escape');
	}

	let handle: AgentRuntimeTransportFileHandleV1 | null = null;
	let consumedIdentity: AgentRuntimeRequestFileIdentityV1 | null = null;
	try {
		const pathStat = await nodeApi.lstat(requestPath);
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
			throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-not-regular-file');
		}
		if (pathStat.uid === currentUid) {
			consumedIdentity = requestFileIdentityV1(pathStat);
		}
		handle = await nodeApi.open(requestPath, nodeApi.fileOpenReadOnlyNoFollow);
		const openedStat = await handle.stat();
		if (!openedStat.isFile()) {
			throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-not-regular-file');
		}
		if (openedStat.uid !== currentUid) {
			throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-owner-mismatch');
		}
		if ((openedStat.mode & 0o777) !== 0o600) {
			throw new AgentRuntimeTransportErrorV1(
				'invalid-request',
				'request-permissions-not-owner-only',
			);
		}
		if (!requestFileIdentityMatchesV1(requestFileIdentityV1(pathStat), openedStat)) {
			throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-file-changed');
		}
		consumedIdentity = requestFileIdentityV1(openedStat);
		if (openedStat.size > CONTRACT_LIMITS_V1.transportInputBytes) {
			throw new AgentRuntimeTransportErrorV1(
				'payload-too-large',
				'request-file-exceeds-transport-limit',
			);
		}
		const canonicalRequestPath = await nodeApi.realpath(requestPath);
		if (nodeApi.dirname(canonicalRequestPath) !== rootPath) {
			throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-realpath-escape');
		}
		const requestBytes = await handle.readFile();
		if (requestBytes.byteLength > CONTRACT_LIMITS_V1.transportInputBytes) {
			throw new AgentRuntimeTransportErrorV1(
				'payload-too-large',
				'request-file-exceeds-transport-limit',
			);
		}
		return {
			raw: nodeApi.decodeUtf8(requestBytes),
			inputBytes: requestBytes.byteLength,
		};
	} catch (error) {
		if (error instanceof AgentRuntimeTransportErrorV1) throw error;
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-file-unavailable');
	} finally {
		await handle?.close().catch(() => undefined);
		if (consumedIdentity) {
			const currentStat = await nodeApi.lstat(requestPath).catch(() => null);
			if (
				currentStat
				&& !currentStat.isSymbolicLink()
				&& currentStat.isFile()
				&& requestFileIdentityMatchesV1(consumedIdentity, currentStat)
			) {
				await nodeApi.unlink(requestPath).catch(() => undefined);
			}
		}
	}
}

function requestFileIdentityV1(stat: {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly ctimeMs: number;
}): AgentRuntimeRequestFileIdentityV1 {
	return {
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		ctimeMs: stat.ctimeMs,
	};
}

function requestFileIdentityMatchesV1(
	expected: AgentRuntimeRequestFileIdentityV1,
	actual: {
		readonly dev: number;
		readonly ino: number;
		readonly size: number;
		readonly ctimeMs: number;
	},
): boolean {
	return expected.dev === actual.dev
		&& expected.ino === actual.ino
		&& expected.size === actual.size
		&& expected.ctimeMs === actual.ctimeMs;
}

export async function computeRunningVaultSha256V1(
	nodeApi: AgentRuntimeDesktopNodeApiV1,
	adapter: unknown,
): Promise<string> {
	const adapterRecord = adapter as { getFullPath?: (normalizedPath: string) => string } | null;
	if (typeof adapterRecord?.getFullPath !== 'function') {
		throw new AgentRuntimeTransportErrorV1(
			'transport-unavailable',
			'filesystem-adapter-required',
		);
	}
	const canonicalVaultPath = await nodeApi.realpath(adapterRecord.getFullPath(''));
	return nodeApi.createSha256(nodeApi.utf8(
		normalizeCanonicalVaultPathForIdentityV1(canonicalVaultPath, nodeApi.platform),
	));
}
