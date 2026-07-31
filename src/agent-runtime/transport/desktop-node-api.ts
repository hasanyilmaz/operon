import { Platform } from 'obsidian';
import {
	AgentRuntimeTransportErrorV1,
	type AgentRuntimeDesktopNodeApiV1,
	type AgentRuntimeTransportFileHandleV1,
	type AgentRuntimeTransportFileStatV1,
} from './types';

export type {
	AgentRuntimeDesktopNodeApiV1,
	AgentRuntimeTransportFileHandleV1,
	AgentRuntimeTransportFileStatV1,
} from './types';
export { AgentRuntimeTransportErrorV1 } from './types';

export type AgentRuntimeDesktopNodeApiLoaderV1 = () => Promise<AgentRuntimeDesktopNodeApiV1>;

/**
 * Creates one plugin-lifetime lazy loader. Concurrent callers share the same
 * load, while a rejected load is forgotten so a later desktop recovery can
 * retry instead of being pinned to a stale failure.
 */
export function createAgentRuntimeDesktopNodeApiLoaderV1(
	load: AgentRuntimeDesktopNodeApiLoaderV1 = loadAgentRuntimeDesktopNodeApiV1,
): AgentRuntimeDesktopNodeApiLoaderV1 {
	let pending: Promise<AgentRuntimeDesktopNodeApiV1> | null = null;
	return () => {
		if (pending) return pending;
		const attempt = Promise.resolve().then(load);
		pending = attempt;
		void attempt.catch(() => {
			if (pending === attempt) pending = null;
		});
		return attempt;
	};
}

export async function loadAgentRuntimeDesktopNodeApiV1(): Promise<AgentRuntimeDesktopNodeApiV1> {
	if (!Platform.isDesktop) {
		throw new AgentRuntimeTransportErrorV1('transport-unavailable', 'desktop-runtime-required');
	}
	const runtimeRequire = (window as unknown as {
		require?: (moduleId: string) => unknown;
	}).require;
	if (typeof runtimeRequire !== 'function') {
		throw new AgentRuntimeTransportErrorV1('transport-unavailable', 'desktop-require-unavailable');
	}
	try {
		const cryptoModule = runtimeRequire('node:crypto') as {
			createHash(algorithm: string): {
				update(value: Uint8Array): { digest(encoding: 'hex'): string };
			};
		};
		const fileSystemModule = runtimeRequire('node:fs') as {
			constants: { O_RDONLY: number; O_NOFOLLOW?: number };
		};
		const fileSystemPromisesModule = runtimeRequire('node:fs/promises') as {
			lstat(path: string): Promise<AgentRuntimeTransportFileStatV1>;
			mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
			open(path: string, flags: number): Promise<AgentRuntimeTransportFileHandleV1>;
			realpath(path: string): Promise<string>;
			unlink(path: string): Promise<void>;
		};
		const operatingSystemModule = runtimeRequire('node:os') as { tmpdir(): string };
		const pathModule = runtimeRequire('node:path') as {
			dirname(path: string): string;
			join(...parts: string[]): string;
			resolve(...parts: string[]): string;
		};
		const bufferModule = runtimeRequire('node:buffer') as {
			Buffer: {
				from(value: string | Uint8Array, encoding?: 'utf8'): Uint8Array & {
					toString(encoding: 'utf8'): string;
				};
			};
		};
		const processModule = runtimeRequire('node:process') as {
			platform?: string;
			getuid?: () => number;
		};
		const noFollow = fileSystemModule.constants.O_NOFOLLOW;
		const windows = processModule.platform === 'win32';
		if (!windows && (typeof noFollow !== 'number' || typeof processModule.getuid !== 'function')) {
			throw new AgentRuntimeTransportErrorV1(
				'transport-unavailable',
				'owner-only-no-follow-filesystem-required',
			);
		}
		return {
			platform: processModule.platform ?? 'unknown',
			fileOpenReadOnlyNoFollow: fileSystemModule.constants.O_RDONLY | (noFollow ?? 0),
			createSha256: value => cryptoModule.createHash('sha256').update(value).digest('hex'),
			lstat: path => fileSystemPromisesModule.lstat(path),
			mkdir: (path, options) => fileSystemPromisesModule.mkdir(path, options),
			open: (path, flags) => fileSystemPromisesModule.open(path, flags),
			realpath: path => fileSystemPromisesModule.realpath(path),
			unlink: path => fileSystemPromisesModule.unlink(path),
			tmpdir: () => operatingSystemModule.tmpdir(),
			dirname: path => pathModule.dirname(path),
			join: (...parts) => pathModule.join(...parts),
			resolve: (...parts) => pathModule.resolve(...parts),
			getuid: () => processModule.getuid?.() ?? null,
			utf8: value => bufferModule.Buffer.from(value, 'utf8'),
			decodeUtf8: value => bufferModule.Buffer.from(value).toString('utf8'),
			delay: milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds)),
		};
	} catch (error) {
		if (error instanceof AgentRuntimeTransportErrorV1) throw error;
		throw new AgentRuntimeTransportErrorV1(
			'transport-unavailable',
			'desktop-node-api-unavailable',
		);
	}
}
