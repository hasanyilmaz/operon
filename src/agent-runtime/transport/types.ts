export interface AgentRuntimeTransportFileStatV1 {
	dev: number;
	ino: number;
	mode: number;
	size: number;
	ctimeMs: number;
	uid: number;
	isDirectory(): boolean;
	isFile(): boolean;
	isSymbolicLink(): boolean;
}

export interface AgentRuntimeTransportFileHandleV1 {
	stat(): Promise<AgentRuntimeTransportFileStatV1>;
	readFile(): Promise<Uint8Array>;
	close(): Promise<void>;
}

export interface AgentRuntimeDesktopNodeApiV1 {
	readonly platform: string;
	readonly fileOpenReadOnlyNoFollow: number;
	createSha256(value: Uint8Array): string;
	lstat(path: string): Promise<AgentRuntimeTransportFileStatV1>;
	mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
	open(path: string, flags: number): Promise<AgentRuntimeTransportFileHandleV1>;
	realpath(path: string): Promise<string>;
	unlink(path: string): Promise<void>;
	tmpdir(): string;
	dirname(path: string): string;
	join(...parts: string[]): string;
	resolve(...parts: string[]): string;
	getuid(): number | null;
	utf8(value: string): Uint8Array;
	decodeUtf8(value: Uint8Array): string;
	delay(milliseconds: number): Promise<void>;
}

export class AgentRuntimeTransportErrorV1 extends Error {
	constructor(
		readonly code:
			| 'invalid-request'
			| 'payload-too-large'
			| 'transport-unavailable'
			| 'vault-mismatch'
			| 'result-too-large'
			| 'internal-error',
		readonly reason: string,
	) {
		super(reason);
		this.name = 'AgentRuntimeTransportErrorV1';
	}
}
