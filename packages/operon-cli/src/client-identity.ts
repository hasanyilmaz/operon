import { randomUUID } from 'node:crypto';
import {
	closeSync,
	lstatSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { operonCliConfigRootV1 } from './config';
import {
	assertSecureFileV1,
	ensureSecureDirectoryV1,
	secureCreatedFileV1,
} from './secure-storage';

const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function getOrCreateOperonCliClientIdV1(
	statePath: string = join(operonCliConfigRootV1(), 'client-v1.json'),
	legacyStatePath: string = join(homedir(), '.codex', 'operon', 'client-v1.json'),
): string {
	const existing = readClientId(statePath);
	if (existing) return existing;
	const markerPath = `${statePath}.initialized`;
	if (fileExists(markerPath)) throw new Error('CLIENT_IDENTITY_MISSING');
	const legacy = legacyStatePath === statePath ? null : readClientId(legacyStatePath);
	if (legacy) {
		writeClientIdentity(statePath, legacy);
		writeInitializationMarker(markerPath);
		try {
			unlinkSync(legacyStatePath);
		} catch {
			// The new owner-only identity is already durable; legacy cleanup is best effort.
		}
		return legacy;
	}
	const clientInstanceId = `operon-cli-${randomUUID()}`;
	writeClientIdentity(statePath, clientInstanceId);
	writeInitializationMarker(markerPath);
	return readClientId(statePath) ?? clientInstanceId;
}

function writeClientIdentity(statePath: string, clientInstanceId: string): void {
	ensureSecureDirectoryV1(dirname(statePath));
	const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
	let descriptor: number | null = null;
	let published = false;
	try {
		descriptor = openSync(temporaryPath, 'wx', 0o600);
		writeFileSync(descriptor, `${JSON.stringify({ version: 1, clientInstanceId })}\n`, 'utf8');
		closeSync(descriptor);
		descriptor = null;
		renameSync(temporaryPath, statePath);
		published = true;
		secureCreatedFileV1(statePath);
	} finally {
		if (descriptor !== null) closeSync(descriptor);
		if (!published) {
			try {
				unlinkSync(temporaryPath);
			} catch {
				// The temporary file may not have been created.
			}
		}
	}
}

function writeInitializationMarker(markerPath: string): void {
	if (fileExists(markerPath)) return;
	const descriptor = openSync(markerPath, 'wx', 0o600);
	try {
		writeFileSync(descriptor, 'operon-cli-client-identity-v1\n', 'utf8');
	} finally {
		closeSync(descriptor);
	}
	secureCreatedFileV1(markerPath);
}

function readClientId(statePath: string): string | null {
	try {
		try {
			assertSecureFileV1(statePath);
		} catch (error) {
			if (hasErrorCode(error, 'ENOENT')) throw error;
			throw new Error('Operon CLI client identity file failed owner-only validation.');
		}
		const stat = lstatSync(statePath);
		const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
		if (
			!stat.isFile()
			|| stat.isSymbolicLink()
			|| (currentUid !== null && stat.uid !== currentUid)
			|| (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
		) {
			throw new Error('Operon CLI client identity file failed owner-only validation.');
		}
		const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('Operon CLI client identity file is malformed.');
		}
		const record = raw as Record<string, unknown>;
		const clientInstanceId = record.version === 1
			&& typeof record.clientInstanceId === 'string'
			&& CLIENT_ID_PATTERN.test(record.clientInstanceId)
			? record.clientInstanceId
			: null;
		if (!clientInstanceId) throw new Error('Operon CLI client identity file is malformed.');
		return clientInstanceId;
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return null;
		throw error;
	}
}

function fileExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return false;
		throw error;
	}
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
	if (!error || typeof error !== 'object') return false;
	return (error as Record<string, unknown>).code === expectedCode;
}
