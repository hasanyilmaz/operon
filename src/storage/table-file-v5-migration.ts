import type { DataAdapter } from 'obsidian';
import { buildOperonPluginStoragePath } from './operon-storage-paths';
import { sha256HexForStorage } from './storage-sha256';
import { writeTextSafely } from './storage-file-ops';
import {
	getOperonTableFilePathKey,
	normalizeOperonTableFilePath,
	parseOperonTableFile,
	serializeOperonTableFile,
} from './table-file';
import { OPERON_TABLE_FILE_V4_VERSION, OPERON_TABLE_FILE_VERSION } from '../types/table-file';
import type { TablePreset } from '../types/table';

const MIGRATION_VERSION = 1 as const;
const MIGRATION_FOLDER = 'table-file-v5-migration' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const migrationQueues = new WeakMap<object, Map<string, Promise<void>>>();

type MigrationAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove' | 'mkdir' | 'process'>
	& Partial<Pick<DataAdapter, 'rename'>>;

export interface TableFileV5MigrationFile {
	path: string;
}

export interface TableFileV5MigrationEnvironment<TFile extends TableFileV5MigrationFile> {
	adapter: MigrationAdapter;
	configDir: string;
	listTableFiles: () => readonly TFile[] | Promise<readonly TFile[]>;
	readTableFile: (file: TFile) => Promise<string>;
	processTableFile: (file: TFile, transform: (source: string) => string) => Promise<unknown>;
	beforeFirstPersistentMutation?: () => Promise<void>;
}

export type TableFileV5MigrationResult =
	| { status: 'not-needed' }
	| { status: 'migrated' | 'resumed'; transactionSha256: string; migratedPaths: string[] }
	| { status: 'finalized'; transactionSha256: string };

type MigrationTarget = {
	path: string;
	sourceSha256: string;
	candidateSha256: string;
	backupPath: string;
};

type MigrationMarker = {
	version: typeof MIGRATION_VERSION;
	targetTableVersion: typeof OPERON_TABLE_FILE_VERSION;
	phase: 'prepared' | 'files-applied';
	transactionSha256: string;
	targets: MigrationTarget[];
};

type MigrationReceipt = {
	version: typeof MIGRATION_VERSION;
	targetTableVersion: typeof OPERON_TABLE_FILE_VERSION;
	phase: 'committed';
	transactionSha256: string;
	markerSha256: string;
	targets: MigrationTarget[];
};

type PreparedTarget<TFile extends TableFileV5MigrationFile> = MigrationTarget & {
	file: TFile;
	source: string;
	candidate: string;
};

type StoredPaths = {
	root: string;
	activePath: string;
	backupsRoot: string;
	receiptsRoot: string;
};

export class TableFileV5MigrationError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = 'TableFileV5MigrationError';
	}
}

export interface TableFileV5MigrationRecoveryEvidence {
	activeMarkerPath: string;
	backupRootPath: string;
	affectedPaths: string[];
}

export async function inspectTableFileV5MigrationRecoveryEvidence(
	adapter: Pick<DataAdapter, 'exists' | 'read'>,
	configDir: string,
): Promise<TableFileV5MigrationRecoveryEvidence> {
	const paths = getMigrationPaths(normalizeConfigDir(configDir));
	const affectedPaths = new Set<string>([paths.activePath]);
	try {
		if (await adapter.exists(paths.activePath)) {
			const marker = JSON.parse(await adapter.read(paths.activePath)) as unknown;
			if (isRecord(marker) && Array.isArray(marker.targets)) {
				for (const target of marker.targets) {
					if (!isRecord(target)) continue;
					if (typeof target.path === 'string') affectedPaths.add(target.path);
					if (typeof target.backupPath === 'string') affectedPaths.add(target.backupPath);
				}
			}
		}
	} catch {
		// Stable state paths remain useful when the marker itself is unreadable.
	}
	return { activeMarkerPath: paths.activePath, backupRootPath: paths.backupsRoot, affectedPaths: [...affectedPaths] };
}

export async function migrateOperonTableFilesToV5<TFile extends TableFileV5MigrationFile>(
	environment: TableFileV5MigrationEnvironment<TFile>,
): Promise<TableFileV5MigrationResult> {
	const configDir = normalizeConfigDir(environment.configDir);
	return await runWithMutex(environment.adapter, configDir, async () => {
		const paths = getMigrationPaths(configDir);
		const storedMarker = await readMarker(environment.adapter, paths.activePath);
		if (storedMarker.status === 'invalid') {
			throw new TableFileV5MigrationError('marker-invalid', 'Table file V5 migration marker is invalid; automatic migration is blocked.');
		}
		if (storedMarker.status === 'valid') {
			return await resumeMigration(environment, paths, storedMarker.marker, storedMarker.serialized);
		}

		const prepared = await preflight(environment, paths);
		if (prepared.length === 0) return { status: 'not-needed' };
		await environment.beforeFirstPersistentMutation?.();
		await ensureMigrationFolders(environment.adapter, paths);
		for (const target of prepared) {
			await writeImmutableExact(environment.adapter, target.backupPath, target.source, 'migration backup');
		}
		const marker = await buildMarker(prepared);
		const markerSerialized = serialize(marker);
		await writeInitialMarker(environment.adapter, paths.activePath, markerSerialized);
		await advanceTargets(environment, prepared);
		await verifyCandidates(environment, prepared);
		const appliedMarker = { ...marker, phase: 'files-applied' as const };
		const appliedSerialized = await replaceMarker(environment.adapter, paths.activePath, markerSerialized, appliedMarker);
		await finalizeMigration(environment.adapter, paths, appliedMarker, appliedSerialized);
		return { status: 'migrated', transactionSha256: marker.transactionSha256, migratedPaths: marker.targets.map(target => target.path) };
	});
}

async function preflight<TFile extends TableFileV5MigrationFile>(
	environment: TableFileV5MigrationEnvironment<TFile>,
	paths: StoredPaths,
): Promise<PreparedTarget<TFile>[]> {
	const files = [...await environment.listTableFiles()]
		.map(file => ({ file, path: normalizeOperonTableFilePath(file.path) }))
		.sort((left, right) => compareStrings(left.path, right.path));
	const seen = new Set<string>();
	const prepared: PreparedTarget<TFile>[] = [];
	for (const entry of files) {
		const pathKey = getOperonTableFilePathKey(entry.path);
		if (seen.has(pathKey)) throw new TableFileV5MigrationError('preflight-duplicate-path', `Table file V5 migration found ambiguous path ${entry.path}.`);
		seen.add(pathKey);
		let source: string;
		try {
			source = await environment.readTableFile(entry.file);
		} catch {
			throw new TableFileV5MigrationError('preflight-read-failed', `Table file V5 migration could not read ${entry.path}.`);
		}
		const parsed = parseOperonTableFile(source, entry.path);
		if (parsed.status === 'invalid') {
			throw new TableFileV5MigrationError('preflight-invalid-table', `Table file V5 migration found invalid or unsupported data in ${entry.path}.`);
		}
		if (parsed.file.version !== OPERON_TABLE_FILE_V4_VERSION) continue;
		if (serializeOperonTableFileV4(parsed.preset) !== source) {
			throw new TableFileV5MigrationError('preflight-noncanonical-v4', `Table file V5 migration requires canonical V4 source: ${entry.path}.`);
		}
		const candidate = serializeOperonTableFile(parsed.preset);
		const sourceSha256 = await sha256HexForStorage(source);
		const candidateSha256 = await sha256HexForStorage(candidate);
		prepared.push({
			file: entry.file,
			path: entry.path,
			source,
			candidate,
			sourceSha256,
			candidateSha256,
			backupPath: `${paths.backupsRoot}/${sourceSha256}.table.bak`,
		});
	}
	return prepared;
}

async function resumeMigration<TFile extends TableFileV5MigrationFile>(
	environment: TableFileV5MigrationEnvironment<TFile>,
	paths: StoredPaths,
	marker: MigrationMarker,
	markerSerialized: string,
): Promise<TableFileV5MigrationResult> {
	const receiptPath = `${paths.receiptsRoot}/${marker.transactionSha256}.json`;
	if (marker.phase === 'files-applied' && await environment.adapter.exists(receiptPath)) {
		const receipt = await environment.adapter.read(receiptPath);
		if (!await isReceiptValid(receipt, marker, markerSerialized)) {
			throw new TableFileV5MigrationError('receipt-invalid', 'Table file V5 migration receipt is invalid.');
		}
		await removeActiveMarker(environment.adapter, paths.activePath, markerSerialized);
		return { status: 'finalized', transactionSha256: marker.transactionSha256 };
	}

	const files = new Map((await environment.listTableFiles()).map(file => [getOperonTableFilePathKey(file.path), file]));
	const prepared: PreparedTarget<TFile>[] = [];
	for (const target of marker.targets) {
		const file = files.get(getOperonTableFilePathKey(target.path));
		if (!file) throw new TableFileV5MigrationError('target-missing', `Table file V5 migration target is missing: ${target.path}.`);
		const source = await readExactBackup(environment.adapter, target);
		const parsed = parseOperonTableFile(source, target.path);
		if (parsed.status !== 'valid' || parsed.file.version !== OPERON_TABLE_FILE_V4_VERSION) {
			throw new TableFileV5MigrationError('backup-invalid', `Table file V5 migration backup is invalid: ${target.path}.`);
		}
		if (serializeOperonTableFileV4(parsed.preset) !== source) {
			throw new TableFileV5MigrationError('backup-noncanonical-v4', `Table file V5 migration backup is not canonical V4: ${target.path}.`);
		}
		const candidate = serializeOperonTableFile(parsed.preset);
		if (await sha256HexForStorage(candidate) !== target.candidateSha256) {
			throw new TableFileV5MigrationError('candidate-identity-invalid', `Table file V5 migration candidate identity changed: ${target.path}.`);
		}
		prepared.push({ ...target, file, source, candidate });
	}
	await advanceTargets(environment, prepared);
	await verifyCandidates(environment, prepared);
	const appliedMarker = marker.phase === 'files-applied' ? marker : { ...marker, phase: 'files-applied' as const };
	const appliedSerialized = marker.phase === 'files-applied'
		? markerSerialized
		: await replaceMarker(environment.adapter, paths.activePath, markerSerialized, appliedMarker);
	await finalizeMigration(environment.adapter, paths, appliedMarker, appliedSerialized);
	return { status: 'resumed', transactionSha256: marker.transactionSha256, migratedPaths: marker.targets.map(target => target.path) };
}

async function advanceTargets<TFile extends TableFileV5MigrationFile>(
	environment: TableFileV5MigrationEnvironment<TFile>,
	targets: readonly PreparedTarget<TFile>[],
): Promise<void> {
	for (const target of targets) {
		let accepted = false;
		await environment.processTableFile(target.file, current => {
			if (current === target.candidate) return current;
			if (current !== target.source) return current;
			accepted = true;
			return target.candidate;
		});
		const observed = await environment.readTableFile(target.file);
		if (observed !== target.candidate) {
			throw new TableFileV5MigrationError(
				accepted ? 'candidate-readback-failed' : 'target-divergent',
				`Table file V5 migration could not advance exact source: ${target.path}.`,
			);
		}
	}
}

async function verifyCandidates<TFile extends TableFileV5MigrationFile>(
	environment: TableFileV5MigrationEnvironment<TFile>,
	targets: readonly PreparedTarget<TFile>[],
): Promise<void> {
	for (const target of targets) {
		const observed = await environment.readTableFile(target.file);
		if (observed !== target.candidate || await sha256HexForStorage(observed) !== target.candidateSha256) {
			throw new TableFileV5MigrationError('candidate-readback-failed', `Table file V5 migration readback failed: ${target.path}.`);
		}
	}
}

async function finalizeMigration(
	adapter: MigrationAdapter,
	paths: StoredPaths,
	marker: MigrationMarker,
	markerSerialized: string,
): Promise<void> {
	const receipt: MigrationReceipt = {
		version: MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_VERSION,
		phase: 'committed',
		transactionSha256: marker.transactionSha256,
		markerSha256: await sha256HexForStorage(markerSerialized),
		targets: marker.targets,
	};
	await writeImmutableExact(adapter, `${paths.receiptsRoot}/${marker.transactionSha256}.json`, serialize(receipt), 'migration receipt');
	await removeActiveMarker(adapter, paths.activePath, markerSerialized);
}

async function buildMarker(targets: readonly MigrationTarget[]): Promise<MigrationMarker> {
	const sealedTargets = targets.map(({ path, sourceSha256, candidateSha256, backupPath }) => ({ path, sourceSha256, candidateSha256, backupPath }));
	return {
		version: MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_VERSION,
		phase: 'prepared',
		transactionSha256: await sha256HexForStorage(JSON.stringify(sealedTargets)),
		targets: sealedTargets,
	};
}

async function readMarker(adapter: MigrationAdapter, path: string): Promise<
	| { status: 'missing' }
	| { status: 'invalid' }
	| { status: 'valid'; marker: MigrationMarker; serialized: string }
> {
	if (!await adapter.exists(path)) return { status: 'missing' };
	let serialized: string;
	let value: unknown;
	try {
		serialized = await adapter.read(path);
		if (serialized === '') return { status: 'missing' };
		value = JSON.parse(serialized) as unknown;
	} catch {
		return { status: 'invalid' };
	}
	if (!isMigrationMarker(value)) return { status: 'invalid' };
	if (await sha256HexForStorage(JSON.stringify(value.targets)) !== value.transactionSha256) return { status: 'invalid' };
	return { status: 'valid', marker: value, serialized };
}

function isMigrationMarker(value: unknown): value is MigrationMarker {
	if (!isRecord(value) || !hasExactKeys(value, ['version', 'targetTableVersion', 'phase', 'transactionSha256', 'targets'])) return false;
	if (value.version !== MIGRATION_VERSION || value.targetTableVersion !== OPERON_TABLE_FILE_VERSION) return false;
	if (value.phase !== 'prepared' && value.phase !== 'files-applied') return false;
	if (!isSha256(value.transactionSha256) || !Array.isArray(value.targets) || value.targets.length === 0) return false;
	let previousPath = '';
	for (const target of value.targets) {
		if (!isRecord(target) || !hasExactKeys(target, ['path', 'sourceSha256', 'candidateSha256', 'backupPath'])) return false;
		if (typeof target.path !== 'string' || normalizeOperonTableFilePath(target.path) !== target.path || target.path <= previousPath) return false;
		if (!isSha256(target.sourceSha256) || !isSha256(target.candidateSha256) || typeof target.backupPath !== 'string') return false;
		previousPath = target.path;
	}
	return true;
}

async function isReceiptValid(serialized: string, marker: MigrationMarker, markerSerialized: string): Promise<boolean> {
	try {
		const value = JSON.parse(serialized) as unknown;
		return isRecord(value)
			&& hasExactKeys(value, ['version', 'targetTableVersion', 'phase', 'transactionSha256', 'markerSha256', 'targets'])
			&& value.version === MIGRATION_VERSION
			&& value.targetTableVersion === OPERON_TABLE_FILE_VERSION
			&& value.phase === 'committed'
			&& value.transactionSha256 === marker.transactionSha256
			&& value.markerSha256 === await sha256HexForStorage(markerSerialized)
			&& JSON.stringify(value.targets) === JSON.stringify(marker.targets);
	} catch {
		return false;
	}
}

async function readExactBackup(adapter: MigrationAdapter, target: MigrationTarget): Promise<string> {
	let backup: string;
	try {
		backup = await adapter.read(target.backupPath);
	} catch {
		throw new TableFileV5MigrationError('backup-missing', `Table file V5 migration backup is missing: ${target.path}.`);
	}
	if (await sha256HexForStorage(backup) !== target.sourceSha256) {
		throw new TableFileV5MigrationError('backup-divergent', `Table file V5 migration backup changed: ${target.path}.`);
	}
	return backup;
}

async function writeImmutableExact(adapter: MigrationAdapter, path: string, data: string, label: string): Promise<void> {
	if (await adapter.exists(path)) {
		if (await adapter.read(path) !== data) throw new TableFileV5MigrationError('immutable-mismatch', `Existing ${label} is divergent.`);
		return;
	}
	try {
		await writeTextSafely(adapter, path, data, { forceAtomicReplacement: true, verifyAtomicReplacement: true });
		if (await adapter.read(path) !== data) throw new Error('readback mismatch');
	} catch {
		throw new TableFileV5MigrationError('write-unacknowledged', `Could not verify ${label}.`);
	}
}

async function writeInitialMarker(adapter: MigrationAdapter, path: string, data: string): Promise<void> {
	if (!await adapter.exists(path)) {
		await writeImmutableExact(adapter, path, data, 'migration marker');
		return;
	}
	throw new TableFileV5MigrationError('marker-divergent', 'Table file V5 migration marker appeared during preparation.');
}

async function replaceMarker(adapter: MigrationAdapter, path: string, expected: string, marker: MigrationMarker): Promise<string> {
	const data = serialize(marker);
	let accepted = false;
	await adapter.process(path, current => {
		if (current !== expected) return current;
		accepted = true;
		return data;
	});
	if (!accepted || await adapter.read(path) !== data) throw new TableFileV5MigrationError('marker-divergent', 'Table file V5 migration marker changed.');
	return data;
}

async function removeActiveMarker(adapter: MigrationAdapter, path: string, expected: string): Promise<void> {
	let accepted = false;
	await adapter.process(path, current => {
		if (current !== expected) return current;
		accepted = true;
		return '';
	});
	if (!accepted) throw new TableFileV5MigrationError('marker-divergent', 'Table file V5 migration marker changed before finalization.');
	try {
		if (await adapter.read(path) === '') await adapter.remove(path);
	} catch {
		// The observed empty marker is a safe finalized tombstone.
	}
	if (await adapter.exists(path) && await adapter.read(path) !== '') {
		throw new TableFileV5MigrationError('marker-finalization-failed', 'Table file V5 migration marker could not be finalized.');
	}
}

async function ensureMigrationFolders(adapter: MigrationAdapter, paths: StoredPaths): Promise<void> {
	for (const path of [paths.root, paths.backupsRoot, paths.receiptsRoot]) await ensureFolder(adapter, path);
}

async function ensureFolder(adapter: MigrationAdapter, path: string): Promise<void> {
	let current = '';
	for (const segment of path.split('/').filter(Boolean)) {
		current = current ? `${current}/${segment}` : segment;
		if (!await adapter.exists(current)) await adapter.mkdir(current);
	}
}

function getMigrationPaths(configDir: string): StoredPaths {
	const root = buildOperonPluginStoragePath(configDir, 'state', MIGRATION_FOLDER);
	return { root, activePath: `${root}/active.json`, backupsRoot: `${root}/backups`, receiptsRoot: `${root}/receipts` };
}

function normalizeConfigDir(configDir: string): string {
	return configDir.replace(/\\/gu, '/').split('/').map(segment => segment.trim()).filter(segment => segment && segment !== '.').join('/');
}

async function runWithMutex<T>(adapter: MigrationAdapter, key: string, operation: () => Promise<T>): Promise<T> {
	let queues = migrationQueues.get(adapter);
	if (!queues) {
		queues = new Map();
		migrationQueues.set(adapter, queues);
	}
	const previous = queues.get(key) ?? Promise.resolve();
	let release!: () => void;
	const completion = new Promise<void>(resolve => { release = resolve; });
	const queued = previous.then(() => completion, () => completion);
	queues.set(key, queued);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (queues.get(key) === queued) queues.delete(key);
	}
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeOperonTableFileV4(preset: TablePreset): string {
	const { gantt: _gantt, ...v4Preset } = preset;
	return serialize({ format: 'operon-table', version: OPERON_TABLE_FILE_V4_VERSION, ...v4Preset });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
