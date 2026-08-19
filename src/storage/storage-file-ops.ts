import type { DataAdapter } from 'obsidian';

type StorageAdapter = Pick<DataAdapter, 'exists' | 'write' | 'remove'>
	& Partial<Pick<DataAdapter, 'process' | 'read' | 'rename'>>;

export interface RecoveredStoreWriteOptions {
	forceRecoveredWrite?: boolean;
}

export interface SafeTextWriteOptions {
	forceAtomicReplacement?: boolean;
	verifyAtomicReplacement?: boolean;
}

function buildTempPath(path: string): string {
	return `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildInvalidJsonBackupPath(path: string, timestamp = Date.now()): string {
	return `${path}.invalid-${timestamp}.bak`;
}

export async function writeTextSafely(
	adapter: StorageAdapter,
	path: string,
	data: string,
	options: SafeTextWriteOptions = {},
): Promise<void> {
	if (!options.forceAtomicReplacement && typeof adapter.process === 'function' && await adapter.exists(path)) {
		await adapter.process(path, () => data);
		return;
	}

	if (typeof adapter.rename !== 'function') {
		if (options.forceAtomicReplacement) {
			throw new Error('Atomic replacement requires adapter rename support');
		}
		await adapter.write(path, data);
		return;
	}
	if (options.verifyAtomicReplacement === true && typeof adapter.read !== 'function') {
		throw new Error('Verified atomic replacement requires adapter read support');
	}

	const tempPath = buildTempPath(path);
	const backupPath = buildTempPath(`${path}.replace-backup`);
	let tempWritten = false;
	let originalMoved = false;
	try {
		await adapter.write(tempPath, data);
		tempWritten = true;
		if (options.verifyAtomicReplacement === true && await adapter.read!(tempPath) !== data) {
			throw new Error('Atomic replacement temporary write was not observed exactly');
		}
		if (await adapter.exists(path)) {
			await adapter.rename(path, backupPath);
			originalMoved = true;
		}
		await adapter.rename(tempPath, path);
		tempWritten = false;
		if (options.verifyAtomicReplacement === true && await adapter.read!(path) !== data) {
			throw new Error('Atomic replacement target write was not observed exactly');
		}
		if (originalMoved) {
			try {
				await adapter.remove(backupPath);
				originalMoved = false;
			} catch {
				// The new target is authoritative; an orphaned backup is safer than failing the write.
			}
		}
	} catch (error) {
		if (originalMoved) {
			try {
				if (await adapter.exists(backupPath)) {
					if (await adapter.exists(path)) await adapter.remove(path);
					await adapter.rename(backupPath, path);
					originalMoved = false;
				}
			} catch {
				// Preserve the backup in place when restoration is unavailable.
			}
		}
		if (tempWritten) {
			try {
				if (await adapter.exists(tempPath)) {
					await adapter.remove(tempPath);
				}
			} catch {
				// Best-effort cleanup only; preserve the original write error.
			}
		}
		throw error;
	}
}

export async function writeJsonSafely(
	adapter: StorageAdapter,
	path: string,
	data: unknown,
): Promise<string> {
	const json = JSON.stringify(data, null, '\t');
	await writeTextSafely(adapter, path, json);
	return json;
}

export async function preserveInvalidJsonFile(
	adapter: StorageAdapter,
	path: string,
	raw: string,
): Promise<string> {
	const backupPath = buildInvalidJsonBackupPath(path);
	await writeTextSafely(adapter, backupPath, raw);
	return backupPath;
}

export function shouldSkipStoreWrite(
	isSameSerialized: boolean,
	fileExists: boolean,
	recoveredFromMalformed: boolean,
	options: RecoveredStoreWriteOptions = {},
): boolean {
	if (!fileExists) return false;
	if (recoveredFromMalformed) return options.forceRecoveredWrite !== true;
	return isSameSerialized;
}
