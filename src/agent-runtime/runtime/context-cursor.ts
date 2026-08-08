import {
	canonicalJsonV1,
	sha256HexV1,
	toJsonValueV1,
} from '../contracts/v1/canonical';
import type { ContextRevisionV1 } from '../contracts/v1/identity';
import {
	CONTRACT_LIMITS_V1,
	structuredErrorV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import type { TaskFinderRequestV1, TaskQueryFiltersV1 } from '../contracts/v1/context';

interface ContextCursorPayloadV1 {
	version: 1;
	revisionDigest: string;
	queryDigest: string;
	asOf: string;
	offset: number;
}

export type ContextCursorDecodeResultV1 =
	| { ok: true; value: ContextCursorPayloadV1 }
	| { ok: false; error: StructuredErrorV1 };

/**
 * Session-local cursor signer. The key is intentionally never persisted, so a
 * Runtime restart invalidates every cursor even if the index revision happens
 * to serialize to the same value.
 */
export class RuntimeContextCursorCodecV1 {
	private readonly key: CryptoKey | Promise<CryptoKey>;
	private readonly crypto: Crypto;

	constructor(crypto: Crypto, secret?: Uint8Array) {
		this.crypto = crypto;
		const material = secret ?? randomBytes(this.crypto, 32);
		this.key = this.crypto.subtle.importKey(
			'raw',
			toArrayBuffer(material),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign', 'verify'],
		);
	}

	async encode(options: {
		revision: ContextRevisionV1;
		filters: TaskQueryFiltersV1;
		asOf: string;
		offset: number;
	}): Promise<string> {
		const payload: ContextCursorPayloadV1 = {
			version: 1,
			revisionDigest: revisionDigest(options.revision),
			queryDigest: queryDigest(options.filters),
			asOf: options.asOf,
			offset: options.offset,
		};
		const encodedPayload = encodeUtf8Base64Url(canonicalJsonV1(toJsonValueV1(payload)));
		const signature = await this.sign(encodedPayload);
		const cursor = `${encodedPayload}.${signature}`;
		if (cursor.length > CONTRACT_LIMITS_V1.cursorCharacters) {
			throw new Error('Context cursor exceeds the V1 size limit.');
		}
		return cursor;
	}

	async decode(options: {
		cursor: string;
		revision: ContextRevisionV1;
		filters: TaskQueryFiltersV1;
	}): Promise<ContextCursorDecodeResultV1> {
		if (
			options.cursor.length === 0
			|| options.cursor.length > CONTRACT_LIMITS_V1.cursorCharacters
			|| !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(options.cursor)
		) return staleCursor();
		const [encodedPayload, encodedSignature] = options.cursor.split('.');
		if (!await this.verify(encodedPayload, encodedSignature)) return staleCursor();
		let parsed: unknown;
		try {
			parsed = JSON.parse(decodeUtf8Base64Url(encodedPayload));
		} catch {
			return staleCursor();
		}
		if (!isCursorPayload(parsed)) return staleCursor();
		if (
			parsed.revisionDigest !== revisionDigest(options.revision)
			|| parsed.queryDigest !== queryDigest(options.filters)
		) return staleCursor();
		return { ok: true, value: parsed };
	}

	async encodeFinder(options: {
		revision: ContextRevisionV1;
		request: TaskFinderRequestV1;
		asOf: string;
		offset: number;
	}): Promise<string> {
		return await this.encodeDigest({
			revision: options.revision,
			queryDigest: finderQueryDigest(options.request),
			asOf: options.asOf,
			offset: options.offset,
		});
	}

	async decodeFinder(options: {
		cursor: string;
		revision: ContextRevisionV1;
		request: TaskFinderRequestV1;
	}): Promise<ContextCursorDecodeResultV1> {
		return await this.decodeDigest({
			cursor: options.cursor,
			revision: options.revision,
			queryDigest: finderQueryDigest(options.request),
		});
	}

	async encodeFilterQuery(options: {
		revision: ContextRevisionV1;
		queryDigest: string;
		asOf: string;
		offset: number;
	}): Promise<string> {
		return await this.encodeDigest(options);
	}

	async decodeFilterQuery(options: {
		cursor: string;
		revision: ContextRevisionV1;
		queryDigest: string;
	}): Promise<ContextCursorDecodeResultV1> {
		return await this.decodeDigest(options);
	}

	private async encodeDigest(options: {
		revision: ContextRevisionV1;
		queryDigest: string;
		asOf: string;
		offset: number;
	}): Promise<string> {
		const payload: ContextCursorPayloadV1 = {
			version: 1,
			revisionDigest: revisionDigest(options.revision),
			queryDigest: options.queryDigest,
			asOf: options.asOf,
			offset: options.offset,
		};
		const encodedPayload = encodeUtf8Base64Url(canonicalJsonV1(toJsonValueV1(payload)));
		const signature = await this.sign(encodedPayload);
		const cursor = `${encodedPayload}.${signature}`;
		if (cursor.length > CONTRACT_LIMITS_V1.cursorCharacters) {
			throw new Error('Context cursor exceeds the V1 size limit.');
		}
		return cursor;
	}

	private async decodeDigest(options: {
		cursor: string;
		revision: ContextRevisionV1;
		queryDigest: string;
	}): Promise<ContextCursorDecodeResultV1> {
		if (
			options.cursor.length === 0
			|| options.cursor.length > CONTRACT_LIMITS_V1.cursorCharacters
			|| !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(options.cursor)
		) return staleCursor();
		const [encodedPayload, encodedSignature] = options.cursor.split('.');
		if (!await this.verify(encodedPayload, encodedSignature)) return staleCursor();
		let parsed: unknown;
		try {
			parsed = JSON.parse(decodeUtf8Base64Url(encodedPayload));
		} catch {
			return staleCursor();
		}
		if (!isCursorPayload(parsed)) return staleCursor();
		if (
			parsed.revisionDigest !== revisionDigest(options.revision)
			|| parsed.queryDigest !== options.queryDigest
		) return staleCursor();
		return { ok: true, value: parsed };
	}

	private async sign(payload: string): Promise<string> {
		const signature = await this.crypto.subtle.sign(
			'HMAC',
			await this.key,
			toArrayBuffer(new TextEncoder().encode(payload)),
		);
		return encodeBytesBase64Url(new Uint8Array(signature));
	}

	private async verify(payload: string, signature: string): Promise<boolean> {
		try {
			return await this.crypto.subtle.verify(
				'HMAC',
				await this.key,
				toArrayBuffer(decodeBytesBase64Url(signature)),
				toArrayBuffer(new TextEncoder().encode(payload)),
			);
		} catch {
			return false;
		}
	}
}

function revisionDigest(revision: ContextRevisionV1): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1(revision)));
}

function queryDigest(filters: TaskQueryFiltersV1): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1({
		filters,
		sort: 'planning-workload-v1',
	})));
}

function finderQueryDigest(request: TaskFinderRequestV1): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1({
		text: request.text ?? '',
		filters: request.filters ?? {},
		representations: request.representations ?? [],
		scope: request.scope ?? 'normal',
		project: request.project ?? null,
		sort: request.text?.trim() ? 'task-finder-rank-v1' : `task-finder-${request.scope ?? 'normal'}-v1`,
	})));
}

function isCursorPayload(value: unknown): value is ContextCursorPayloadV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (Object.getPrototypeOf(value) !== Object.prototype) return false;
	const record = value as Record<string, unknown>;
	return Object.keys(record).length === 5
		&& record.version === 1
		&& typeof record.revisionDigest === 'string'
		&& /^[a-f0-9]{64}$/u.test(record.revisionDigest)
		&& typeof record.queryDigest === 'string'
		&& /^[a-f0-9]{64}$/u.test(record.queryDigest)
		&& typeof record.asOf === 'string'
		&& !Number.isNaN(Date.parse(record.asOf))
		&& Number.isSafeInteger(record.offset)
		&& (record.offset as number) >= 0;
}

function randomBytes(crypto: Crypto, length: number): Uint8Array {
	const value = new Uint8Array(length);
	crypto.getRandomValues(value);
	return value;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}

function encodeUtf8Base64Url(value: string): string {
	return encodeBytesBase64Url(new TextEncoder().encode(value));
}

function decodeUtf8Base64Url(value: string): string {
	return new TextDecoder('utf-8', { fatal: true }).decode(decodeBytesBase64Url(value));
}

function encodeBytesBase64Url(value: Uint8Array): string {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function decodeBytesBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(
		Math.ceil(value.length / 4) * 4,
		'=',
	);
	const binary = atob(padded);
	return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function staleCursor(): ContextCursorDecodeResultV1 {
	return {
		ok: false,
		error: structuredErrorV1(
			'stale-cursor',
			'The cursor is invalid, stale, or belongs to another Runtime session.',
			{ retryable: true },
		),
	};
}
