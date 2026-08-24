import type { DataAdapter } from 'obsidian';
import { buildOperonPluginStoragePath } from './operon-storage-paths';
import { sha256HexForStorage } from './storage-sha256';
import { writeTextSafely } from './storage-file-ops';
import {
	getOperonTableFilePathKey,
	buildUniqueOperonTableFilePath,
	normalizeOperonTableFilePath,
	parseOperonTableFile,
} from './table-file';
import {
	OPERON_TABLE_FILE_LEGACY_VERSION,
	OPERON_TABLE_FILE_PREVIOUS_VERSION,
	OPERON_TABLE_FILE_FORMAT,
	OPERON_TABLE_FILE_V3_VERSION,
} from '../types/table-file';
import { writeCanonicalTableFileWithAcknowledgement } from './table-file-write-acknowledgement';
import { isSafeVaultRelativeFolderPath } from '../core/settings-folder-rules';
import type { TablePreset } from '../types/table';

const TABLE_FILE_V3_MIGRATION_VERSION = 1 as const;
const TABLE_FILE_V3_MIGRATION_FOLDER = 'table-file-v3-migration' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const tableFileV3MigrationQueues = new WeakMap<object, Map<string, Promise<void>>>();

function serializeOperonTableFileV3(preset: TablePreset): string {
	const { expandedTaskTreeIds: _expandedTaskTreeIds, ...v3Preset } = preset;
	return `${JSON.stringify({
		format: OPERON_TABLE_FILE_FORMAT,
		version: OPERON_TABLE_FILE_V3_VERSION,
		...v3Preset,
	}, null, 2)}\n`;
}

type TableFileV3MigrationAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove' | 'mkdir'>
	& Pick<DataAdapter, 'process'>
	& Partial<Pick<DataAdapter, 'rename'>>;

export interface TableFileV3MigrationFile {
	path: string;
	stat?: { mtime: number };
}

export interface TableFileV3MigrationEnvironment<TFile extends TableFileV3MigrationFile> {
	adapter: TableFileV3MigrationAdapter;
	configDir: string;
	listTableFiles: () => readonly TFile[] | Promise<readonly TFile[]>;
	readTableFile: (file: TFile) => Promise<string>;
	processTableFile: (file: TFile, transform: (source: string) => string) => Promise<unknown>;
	renameTableFile?: (file: TFile, destinationPath: string) => Promise<unknown>;
	loadFileBindings?: () => ReadonlyArray<{ id: string; path: string }>;
	/** Legacy migration test/recovery seam. New production startup must not initiate V1/V2 writes. */
	allowNewMigration?: boolean;
	/** Internal test seam; production callers omit it and no hook is retained. */
	beforeFirstPersistentMutation?: () => Promise<void>;
}

export type TableFileV3MigrationResult =
	| { status: 'not-needed' }
	| { status: 'migrated'; transactionSha256: string; migratedPaths: string[]; repairedConflict: boolean }
	| { status: 'resumed'; transactionSha256: string; migratedPaths: string[]; repairedConflict: boolean }
	| { status: 'finalized'; transactionSha256: string };

type MigrationTarget = {
	path: string;
	candidatePath?: string;
	sourceId?: string;
	candidateId?: string;
	sourceMtime?: number;
	sourceSha256: string;
	candidateSha256: string;
	backupPath: string;
};

type MigrationMarker = {
	version: typeof TABLE_FILE_V3_MIGRATION_VERSION;
	targetTableVersion: typeof OPERON_TABLE_FILE_V3_VERSION;
	phase: 'prepared' | 'files-applied';
	transactionSha256: string;
	targets: MigrationTarget[];
};

type MigrationReceipt = {
	version: typeof TABLE_FILE_V3_MIGRATION_VERSION;
	targetTableVersion: typeof OPERON_TABLE_FILE_V3_VERSION;
	transactionSha256: string;
	markerSha256: string;
	phase: 'committed';
	targets: MigrationTarget[];
};

type PreparedTarget<TFile extends TableFileV3MigrationFile> = MigrationTarget & {
	file: TFile;
	source: string;
	candidate: string;
	state: 'source' | 'candidate';
};

type StoredPaths = {
	root: string;
	activePath: string;
	backupsRoot: string;
	receiptsRoot: string;
};

/**
 * Raised for a blocked migration rather than attempting to repair unknown
 * table data. The retained marker and immutable backups are the only recovery
 * authority; live documents are never automatically restored.
 */
export class TableFileV3MigrationError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = 'TableFileV3MigrationError';
	}
}

export interface TableFileV3MigrationRecoveryEvidence {
	activeMarkerPath: string;
	backupRootPath: string;
	affectedPaths: string[];
}

export async function inspectTableFileV3MigrationRecoveryEvidence(
	adapter: Pick<DataAdapter, 'exists' | 'read'>,
	configDir: string,
): Promise<TableFileV3MigrationRecoveryEvidence> {
	const paths = getMigrationPaths(normalizeMigrationConfigDir(configDir));
	const affectedPaths = new Set<string>([paths.activePath]);
	try {
		if (await adapter.exists(paths.activePath)) {
			const marker = JSON.parse(await adapter.read(paths.activePath)) as unknown;
			if (isRecord(marker) && Array.isArray(marker.targets)) {
				for (const target of marker.targets) {
					if (!isRecord(target)) continue;
					for (const key of ['path', 'sourcePath', 'candidatePath', 'backupPath'] as const) {
						if (typeof target[key] === 'string') affectedPaths.add(target[key]);
					}
				}
			}
		}
	} catch {
		// The stable marker and backup paths still provide actionable recovery evidence.
	}
	return {
		activeMarkerPath: paths.activePath,
		backupRootPath: paths.backupsRoot,
		affectedPaths: [...affectedPaths],
	};
}

/**
 * Startup-only V1/V2 `.table` migration. It first seals every source and a
 * transaction marker, then conditionally advances each source to its exact
 * V3 candidate. A restart only resumes marker sources or finalizes an already
 * receipt-backed transaction; divergent live documents fail closed.
 */
export async function migrateOperonTableFilesToV3<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
): Promise<TableFileV3MigrationResult> {
	const normalizedConfigDir = normalizeMigrationConfigDir(environment.configDir);
	const paths = getMigrationPaths(normalizedConfigDir);
	return await runWithTableFileV3MigrationMutex(environment.adapter, normalizedConfigDir, () =>
		migrateOperonTableFilesToV3Unlocked(environment, paths));
}

async function migrateOperonTableFilesToV3Unlocked<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	paths: StoredPaths,
): Promise<TableFileV3MigrationResult> {
	const markerRead = await readMarker(environment.adapter, paths.activePath);
	if (markerRead.status === 'invalid') {
		throw new TableFileV3MigrationError('marker-invalid', 'Table file V3 migration marker is invalid; automatic migration is blocked.');
	}
	if (markerRead.status === 'valid') {
		if (!await isMarkerIdentityValid(markerRead.marker, paths)) {
			throw new TableFileV3MigrationError('marker-identity-invalid', 'Table file V3 migration marker does not match its sealed target identities.');
		}
		return await resumeMarkedMigration(environment, paths, markerRead.marker, markerRead.serialized);
	}
	if (environment.allowNewMigration !== true) return { status: 'not-needed' };

	const preflight = await preflightNewMigration(environment, paths);
	if (preflight.targets.length === 0) return { status: 'not-needed' };
	await environment.beforeFirstPersistentMutation?.();
	await ensureMigrationFolders(environment.adapter, paths);

	for (const target of preflight.targets) {
		await writeImmutableExact(environment.adapter, target.backupPath, target.source, 'backup');
	}

	const marker = await buildMarker(preflight.targets);
	const markerSerialized = serializeMarker(marker);
	await writeInitialMigrationMarkerCas(environment.adapter, paths.activePath, markerSerialized);

	await advanceTargets(environment, marker.targets, preflight.byPath);
	await verifyAllCandidates(environment, marker.targets, preflight.byPath);
	const filesAppliedMarker = { ...marker, phase: 'files-applied' as const };
	const filesAppliedSerialized = await replaceMarkerPhase(
		environment.adapter,
		paths.activePath,
		markerSerialized,
		filesAppliedMarker,
	);
	const receipt = await buildReceipt(filesAppliedMarker, filesAppliedSerialized);
	const receiptPath = `${paths.receiptsRoot}/${marker.transactionSha256}.json`;
	await writeImmutableExact(environment.adapter, receiptPath, serializeReceipt(receipt), 'migration receipt');
	await removeActiveMarkerObserved(environment.adapter, paths.activePath, filesAppliedSerialized);
	return {
		status: 'migrated',
		transactionSha256: marker.transactionSha256,
		migratedPaths: marker.targets.map(target => target.path),
		repairedConflict: marker.targets.some(target => target.sourceId !== undefined
			&& target.candidateId !== undefined && target.sourceId !== target.candidateId),
	};
}

/**
 * Serializes only in-process callers that share one vault adapter and one
 * normalized migration root. Persistent marker/backup evidence remains the
 * recovery authority across process restarts and is deliberately not used as
 * a cross-process lock.
 */
async function runWithTableFileV3MigrationMutex<T>(
	adapter: TableFileV3MigrationAdapter,
	normalizedConfigRoot: string,
	operation: () => Promise<T>,
): Promise<T> {
	const adapterKey = adapter as object;
	let queues = tableFileV3MigrationQueues.get(adapterKey);
	if (!queues) {
		queues = new Map();
		tableFileV3MigrationQueues.set(adapterKey, queues);
	}
	const previous = queues.get(normalizedConfigRoot) ?? Promise.resolve();
	let release!: () => void;
	const completion = new Promise<void>(resolve => {
		release = resolve;
	});
	const queued = previous.then(() => completion, () => completion);
	queues.set(normalizedConfigRoot, queued);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (queues.get(normalizedConfigRoot) === queued) {
			queues.delete(normalizedConfigRoot);
			if (queues.size === 0) tableFileV3MigrationQueues.delete(adapterKey);
		}
	}
}

/**
 * Keeps the startup ordering explicit and testable: a registry may not perform
 * its first discovery refresh until the durable V3 migration has either
 * completed, resumed, finalized, or safely reported a blocked state.
 */
export async function migrateOperonTableFilesBeforeRegistryRefresh<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	refreshRegistry: () => Promise<void>,
): Promise<TableFileV3MigrationResult> {
	const result = await migrateOperonTableFilesToV3(environment);
	await refreshRegistry();
	return result;
}

function getMigrationPaths(configDir: string): StoredPaths {
	const root = buildOperonPluginStoragePath(configDir, 'state', TABLE_FILE_V3_MIGRATION_FOLDER);
	return {
		root,
		activePath: `${root}/active.json`,
		backupsRoot: `${root}/backups`,
		receiptsRoot: `${root}/receipts`,
	};
}

function normalizeMigrationConfigDir(configDir: string): string {
	return configDir
		.replace(/\\/gu, '/')
		.split('/')
		.map(segment => segment.trim())
		.filter(segment => segment && segment !== '.')
		.join('/');
}

async function preflightNewMigration<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	paths: StoredPaths,
): Promise<{ targets: PreparedTarget<TFile>[]; byPath: Map<string, PreparedTarget<TFile>> }> {
	const files = await listSortedTableFiles(environment);
	const records: Array<{
		file: TFile;
		path: string;
		source: string;
		parsed: ReturnType<typeof parseOperonTableFile>;
		mtime: number;
	}> = [];
	for (const file of files) {
		const path = normalizeOperonTableFilePath(file.path);
		let source: string;
		try {
			source = await environment.readTableFile(file);
		} catch {
			continue;
		}
		const parsed = parseOperonTableFile(source, path);
		records.push({ file, path, source, parsed, mtime: file.stat?.mtime ?? 0 });
	}

	const legacyRecords = records.filter(record => (
		record.parsed.status === 'valid'
		&& (record.parsed.file.version === OPERON_TABLE_FILE_LEGACY_VERSION
			|| record.parsed.file.version === OPERON_TABLE_FILE_PREVIOUS_VERSION)
	));
	const duplicatePath = findDuplicatePath(records.map(record => record.path));
	if (duplicatePath) {
		throw new TableFileV3MigrationError('preflight-duplicate-path', `Table file V3 migration found ambiguous path ${duplicatePath}; automatic migration is blocked.`);
	}

	const validRecords = records.filter((record): record is typeof record & {
		parsed: Extract<ReturnType<typeof parseOperonTableFile>, { status: 'valid' }>;
	} => record.parsed.status === 'valid');
	const bindings = new Map((environment.loadFileBindings?.() ?? []).map(binding => [binding.id, binding.path]));
	const repairByPath = await buildDuplicateRepairCandidates(validRecords, bindings);
	if (legacyRecords.length === 0 && repairByPath.size === 0) return { targets: [], byPath: new Map() };

	const targets: PreparedTarget<TFile>[] = [];
	for (const record of validRecords) {
		if (record.parsed.status !== 'valid') continue;
		const repair = repairByPath.get(getOperonTableFilePathKey(record.path));
		const preset = repair
			? { ...record.parsed.preset, id: repair.id, name: repair.name }
			: record.parsed.preset;
		const needsVersionMigration = record.parsed.file.version === OPERON_TABLE_FILE_LEGACY_VERSION
			|| record.parsed.file.version === OPERON_TABLE_FILE_PREVIOUS_VERSION;
		if (!repair && !needsVersionMigration) continue;
		const sourceSha256 = await sha256HexForStorage(record.source);
		const candidate = serializeOperonTableFileV3(preset);
		const candidateSha256 = await sha256HexForStorage(candidate);
		const pathSha256 = await sha256HexForStorage(getOperonTableFilePathKey(record.path));
			targets.push({
			file: record.file,
			path: record.path,
			...(repair ? {
				candidatePath: repair.path,
				sourceId: record.parsed.preset.id,
				candidateId: repair.id,
				sourceMtime: record.mtime,
			} : {}),
			source: record.source,
			candidate,
			sourceSha256,
			candidateSha256,
			backupPath: `${paths.backupsRoot}/${pathSha256}-${sourceSha256}.table.bak`,
			state: 'source',
		});
	}
	targets.sort((left, right) => compareStrings(left.path, right.path));
	return { targets, byPath: new Map(targets.map(target => [getOperonTableFilePathKey(target.path), target])) };
}

async function buildDuplicateRepairCandidates<TFile extends TableFileV3MigrationFile>(
	records: ReadonlyArray<{
		file: TFile;
		path: string;
		source: string;
		mtime: number;
		parsed: Extract<ReturnType<typeof parseOperonTableFile>, { status: 'valid' }>;
	}>,
	bindings: ReadonlyMap<string, string>,
): Promise<Map<string, { id: string; name: string; path: string }>> {
	const byId = new Map<string, typeof records[number][]>();
	for (const record of records) {
		const group = byId.get(record.parsed.preset.id) ?? [];
		group.push(record);
		byId.set(record.parsed.preset.id, group);
	}
	const occupiedIds = new Set(records.map(record => record.parsed.preset.id));
	const occupiedPaths = records.map(record => record.path);
	const repairs = new Map<string, { id: string; name: string; path: string }>();
	for (const [presetId, group] of byId) {
		if (group.length < 2) continue;
		const boundPath = bindings.get(presetId);
		const ranked = [...group].sort((left, right) => {
			const mtimeDelta = right.mtime - left.mtime;
			if (mtimeDelta !== 0) return mtimeDelta;
			if (boundPath) {
				const boundKey = getOperonTableFilePathKey(boundPath);
				const leftBound = getOperonTableFilePathKey(left.path) === boundKey;
				const rightBound = getOperonTableFilePathKey(right.path) === boundKey;
				if (leftBound !== rightBound) return leftBound ? -1 : 1;
			}
			return compareStrings(normalizeOperonTableFilePath(left.path), normalizeOperonTableFilePath(right.path));
		});
		for (const loser of ranked.slice(1)) {
			let attempt = 0;
			let id = '';
			while (!id || occupiedIds.has(id)) {
				const seed = `${presetId}:${getOperonTableFilePathKey(loser.path)}:${await sha256HexForStorage(loser.source)}:${attempt}`;
				id = `tp_recovered_${(await sha256HexForStorage(seed)).slice(0, 12)}`;
				attempt += 1;
			}
			occupiedIds.add(id);
			const name = `${loser.parsed.preset.name} ID Conflict`;
			const slash = loser.path.lastIndexOf('/');
			const folder = slash < 0 ? '' : loser.path.slice(0, slash);
			const path = buildUniqueOperonTableFilePath(folder, name, occupiedPaths);
			occupiedPaths.push(path);
			repairs.set(getOperonTableFilePathKey(loser.path), { id, name, path });
		}
	}
	return repairs;
}

async function resumeMarkedMigration<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	paths: StoredPaths,
	marker: MigrationMarker,
	markerSerialized: string,
): Promise<TableFileV3MigrationResult> {
	const files = await listSortedTableFiles(environment);
	const byFilePath = new Map<string, TFile>();
	for (const file of files) {
		const key = getOperonTableFilePathKey(file.path);
		if (byFilePath.has(key)) {
			throw new TableFileV3MigrationError('marker-duplicate-path', `Table file V3 migration cannot resume ambiguous path ${file.path}.`);
		}
		byFilePath.set(key, file);
	}
	const preparedByPath = new Map<string, PreparedTarget<TFile>>();
	for (const target of marker.targets) {
		const sourceFile = byFilePath.get(getOperonTableFilePathKey(target.path));
		const candidateFile = target.candidatePath
			? byFilePath.get(getOperonTableFilePathKey(target.candidatePath))
			: undefined;
		if (sourceFile && candidateFile && sourceFile !== candidateFile) {
			throw new TableFileV3MigrationError('marker-source-ambiguous', `Table file recovery found both source and candidate paths for ${target.path}.`);
		}
		const file = candidateFile ?? sourceFile;
		if (!file) {
			throw new TableFileV3MigrationError('marker-source-missing', `Table file V3 migration source is missing: ${target.path}.`);
		}
		const backup = await readExactImmutableBackup(environment.adapter, target);
		let current: string;
		try {
			current = await environment.readTableFile(file);
		} catch {
			throw new TableFileV3MigrationError('marker-source-unreadable', `Table file V3 migration source is unreadable: ${target.path}.`);
		}
		const currentSha256 = await sha256HexForStorage(current);
		if (currentSha256 === target.candidateSha256 && current !== backup) {
			preparedByPath.set(getOperonTableFilePathKey(target.path), {
				...target,
				file,
				source: backup,
				candidate: current,
				state: 'candidate',
			});
			continue;
		}
		if (currentSha256 !== target.sourceSha256 || current !== backup) {
			throw new TableFileV3MigrationError('marker-source-divergent', `Table file V3 migration found divergent source data: ${target.path}.`);
		}
		if (target.sourceMtime !== undefined && file.stat?.mtime !== target.sourceMtime) {
			throw new TableFileV3MigrationError('marker-source-divergent', `Table file V3 migration found a newer source timestamp: ${target.path}.`);
		}
		const parsed = parseOperonTableFile(current, target.path);
		if (parsed.status !== 'valid') {
			throw new TableFileV3MigrationError('marker-source-invalid', `Table file V3 migration source no longer has a valid legacy shape: ${target.path}.`);
		}
		const candidatePreset = target.candidateId
			? { ...parsed.preset, id: target.candidateId, name: deriveRecoveredName(parsed.preset.name) }
			: parsed.preset;
		const candidate = serializeOperonTableFileV3(candidatePreset);
		if (await sha256HexForStorage(candidate) !== target.candidateSha256) {
			throw new TableFileV3MigrationError('marker-candidate-mismatch', `Table file V3 migration candidate changed for ${target.path}.`);
		}
		preparedByPath.set(getOperonTableFilePathKey(target.path), {
			...target,
			file,
			source: current,
			candidate,
			state: 'source',
		});
	}

	const receiptPath = `${paths.receiptsRoot}/${marker.transactionSha256}.json`;
	const receiptRead = await readReceipt(environment.adapter, receiptPath);
	if (receiptRead.status === 'invalid') {
		throw new TableFileV3MigrationError('receipt-invalid', 'Table file V3 migration receipt is invalid; automatic migration is blocked.');
	}
	if (receiptRead.status === 'valid') {
		const receipt = await buildReceipt(marker, markerSerialized);
		if (receiptRead.serialized !== serializeReceipt(receipt)) {
			throw new TableFileV3MigrationError('receipt-mismatch', 'Table file V3 migration receipt does not match its active marker.');
		}
		await verifyAllCandidates(environment, marker.targets, preparedByPath);
		await removeActiveMarkerObserved(environment.adapter, paths.activePath, markerSerialized);
		return { status: 'finalized', transactionSha256: marker.transactionSha256 };
	}

	if (marker.phase === 'prepared') await advanceTargets(environment, marker.targets, preparedByPath);
	await verifyAllCandidates(environment, marker.targets, preparedByPath);
	const filesAppliedMarker = marker.phase === 'files-applied'
		? marker
		: { ...marker, phase: 'files-applied' as const };
	const filesAppliedSerialized = marker.phase === 'files-applied'
		? markerSerialized
		: await replaceMarkerPhase(environment.adapter, paths.activePath, markerSerialized, filesAppliedMarker);
	const receipt = await buildReceipt(filesAppliedMarker, filesAppliedSerialized);
	await writeImmutableExact(environment.adapter, receiptPath, serializeReceipt(receipt), 'migration receipt');
	await removeActiveMarkerObserved(environment.adapter, paths.activePath, filesAppliedSerialized);
	return {
		status: 'resumed',
		transactionSha256: marker.transactionSha256,
		migratedPaths: marker.targets.map(target => target.path),
		repairedConflict: marker.targets.some(target => target.sourceId !== undefined
			&& target.candidateId !== undefined && target.sourceId !== target.candidateId),
	};
}

async function advanceTargets<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	targets: readonly MigrationTarget[],
	byPath: ReadonlyMap<string, PreparedTarget<TFile>>,
): Promise<void> {
	for (const target of targets) {
		const prepared = byPath.get(getOperonTableFilePathKey(target.path));
		if (!prepared) throw new TableFileV3MigrationError('target-missing', `Table file V3 migration target is unavailable: ${target.path}.`);
		if (prepared.state === 'candidate') {
			await advanceTargetPath(environment, prepared);
			continue;
		}
		let casMismatch = false;
		const acknowledgement = await writeCanonicalTableFileWithAcknowledgement({
			previous: prepared.source,
			candidate: prepared.candidate,
			writeCandidate: async () => {
				await environment.processTableFile(prepared.file, current => {
					if (current !== prepared.source) {
						casMismatch = true;
						throw new Error(`Table file V3 migration source changed: ${prepared.path}`);
					}
					return prepared.candidate;
				});
			},
			readCurrent: () => environment.readTableFile(prepared.file),
		});
		if (acknowledgement.status !== 'candidate') {
			const code = casMismatch ? 'cas-mismatch' : `target-${acknowledgement.status}`;
			throw new TableFileV3MigrationError(code, `Table file V3 migration could not verify ${target.path}; restart may resume only exact source or candidate data.`);
		}
		await advanceTargetPath(environment, prepared);
	}
}

async function advanceTargetPath<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	target: PreparedTarget<TFile>,
): Promise<void> {
	if (!target.candidatePath || getOperonTableFilePathKey(target.file.path) === getOperonTableFilePathKey(target.candidatePath)) return;
	if (!environment.renameTableFile) {
		throw new TableFileV3MigrationError('rename-unavailable', `Table file recovery cannot rename ${target.path} safely.`);
	}
	try {
		await environment.renameTableFile(target.file, target.candidatePath);
	} catch {
		const sourceExists = await environment.adapter.exists(target.path);
		const candidateExists = await environment.adapter.exists(target.candidatePath);
		if (candidateExists && !sourceExists) {
			target.file.path = target.candidatePath;
		} else if (sourceExists && !candidateExists) {
			throw new TableFileV3MigrationError('rename-previous', `Table file recovery rename did not commit for ${target.path}; restart can resume.`);
		} else {
			throw new TableFileV3MigrationError('rename-state-unknown', `Table file recovery could not determine rename state for ${target.path}.`);
		}
	}
	if (getOperonTableFilePathKey(target.file.path) !== getOperonTableFilePathKey(target.candidatePath)) {
		throw new TableFileV3MigrationError('rename-unacknowledged', `Table file recovery could not verify rename of ${target.path}.`);
	}
}

async function verifyAllCandidates<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
	targets: readonly MigrationTarget[],
	byPath: ReadonlyMap<string, PreparedTarget<TFile>>,
): Promise<void> {
	for (const target of targets) {
		const prepared = byPath.get(getOperonTableFilePathKey(target.path));
		if (!prepared) throw new TableFileV3MigrationError('target-missing', `Table file V3 migration target is unavailable: ${target.path}.`);
		let current: string;
		try {
			current = await environment.readTableFile(prepared.file);
		} catch {
			throw new TableFileV3MigrationError('candidate-unreadable', `Table file V3 migration candidate is unreadable: ${target.path}.`);
		}
		if (current !== prepared.candidate || await sha256HexForStorage(current) !== target.candidateSha256) {
			throw new TableFileV3MigrationError('candidate-divergent', `Table file V3 migration candidate diverged: ${target.path}.`);
		}
		if (target.candidatePath
			&& getOperonTableFilePathKey(prepared.file.path) !== getOperonTableFilePathKey(target.candidatePath)) {
			await advanceTargetPath(environment, prepared);
		}
	}
}

async function buildMarker<TFile extends TableFileV3MigrationFile>(targets: readonly PreparedTarget<TFile>[]): Promise<MigrationMarker> {
	const markerTargets = targets.map(target => toMigrationTarget(target));
	const transactionSha256 = await sha256HexForStorage(JSON.stringify({
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		targets: markerTargets,
	}));
	return {
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		phase: 'prepared',
		transactionSha256,
		targets: markerTargets,
	};
}

function toMigrationTarget(target: MigrationTarget): MigrationTarget {
	return {
		path: target.path,
		...(target.candidatePath ? { candidatePath: target.candidatePath } : {}),
		...(target.sourceId ? { sourceId: target.sourceId } : {}),
		...(target.candidateId ? { candidateId: target.candidateId } : {}),
		...(target.sourceMtime !== undefined ? { sourceMtime: target.sourceMtime } : {}),
		sourceSha256: target.sourceSha256,
		candidateSha256: target.candidateSha256,
		backupPath: target.backupPath,
	};
}

function deriveRecoveredName(sourceName: string): string {
	return sourceName.endsWith(' ID Conflict') ? sourceName : `${sourceName} ID Conflict`;
}

async function buildReceipt(marker: MigrationMarker, markerSerialized: string): Promise<MigrationReceipt> {
	return {
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		transactionSha256: marker.transactionSha256,
		markerSha256: await sha256HexForStorage(markerSerialized),
		phase: 'committed',
		targets: marker.targets.map(target => ({ ...target })),
	};
}

function serializeMarker(marker: MigrationMarker): string {
	return `${JSON.stringify(marker, null, '\t')}\n`;
}

function serializeReceipt(receipt: MigrationReceipt): string {
	return `${JSON.stringify(receipt, null, '\t')}\n`;
}

async function listSortedTableFiles<TFile extends TableFileV3MigrationFile>(
	environment: TableFileV3MigrationEnvironment<TFile>,
): Promise<TFile[]> {
	const files = [...await environment.listTableFiles()];
	return files.sort((left, right) => (
		compareStrings(normalizeOperonTableFilePath(left.path), normalizeOperonTableFilePath(right.path))
		|| compareStrings(left.path, right.path)
	));
}

function findDuplicatePath(paths: readonly string[]): string | null {
	const seen = new Set<string>();
	for (const path of paths) {
		const key = getOperonTableFilePathKey(path);
		if (seen.has(key)) return path;
		seen.add(key);
	}
	return null;
}

async function readExactImmutableBackup(adapter: TableFileV3MigrationAdapter, target: MigrationTarget): Promise<string> {
	let source: string;
	try {
		if (!(await adapter.exists(target.backupPath))) {
			throw new TableFileV3MigrationError('backup-missing', `Table file V3 migration backup is missing: ${target.path}.`);
		}
		source = await adapter.read(target.backupPath);
	} catch (error) {
		if (error instanceof TableFileV3MigrationError) throw error;
		throw new TableFileV3MigrationError('backup-unreadable', `Table file V3 migration backup is unreadable: ${target.path}.`);
	}
	if (await sha256HexForStorage(source) !== target.sourceSha256) {
		throw new TableFileV3MigrationError('backup-mismatch', `Table file V3 migration backup does not match source: ${target.path}.`);
	}
	return source;
}

async function isMarkerIdentityValid(marker: MigrationMarker, paths: StoredPaths): Promise<boolean> {
	const expectedTransactionSha256 = await sha256HexForStorage(JSON.stringify({
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		targets: marker.targets,
	}));
	if (marker.transactionSha256 !== expectedTransactionSha256) return false;
	for (const target of marker.targets) {
		const pathSha256 = await sha256HexForStorage(getOperonTableFilePathKey(target.path));
		if (target.backupPath !== `${paths.backupsRoot}/${pathSha256}-${target.sourceSha256}.table.bak`) return false;
	}
	return true;
}

async function readMarker(adapter: TableFileV3MigrationAdapter, path: string): Promise<
	| { status: 'missing' }
	| { status: 'invalid' }
	| { status: 'valid'; marker: MigrationMarker; serialized: string }
> {
	try {
		if (!(await adapter.exists(path))) return { status: 'missing' };
		const serialized = await adapter.read(path);
		if (serialized === '') return { status: 'missing' };
		const marker = parseMarker(serialized);
		return marker ? { status: 'valid', marker, serialized } : { status: 'invalid' };
	} catch {
		return { status: 'invalid' };
	}
}

async function readReceipt(adapter: TableFileV3MigrationAdapter, path: string): Promise<
	| { status: 'missing' }
	| { status: 'invalid' }
	| { status: 'valid'; receipt: MigrationReceipt; serialized: string }
> {
	try {
		if (!(await adapter.exists(path))) return { status: 'missing' };
		const serialized = await adapter.read(path);
		const receipt = parseReceipt(serialized);
		return receipt ? { status: 'valid', receipt, serialized } : { status: 'invalid' };
	} catch {
		return { status: 'invalid' };
	}
}

function parseMarker(serialized: string): MigrationMarker | null {
	let value: unknown;
	try {
		value = JSON.parse(serialized) as unknown;
	} catch {
		return null;
	}
	if (!isRecord(value)
		|| (!hasExactKeys(value, ['version', 'targetTableVersion', 'transactionSha256', 'targets'])
			&& !hasExactKeys(value, ['version', 'targetTableVersion', 'phase', 'transactionSha256', 'targets']))
		|| value.version !== TABLE_FILE_V3_MIGRATION_VERSION
		|| value.targetTableVersion !== OPERON_TABLE_FILE_V3_VERSION
		|| !isSha256(value.transactionSha256)
		|| (value.phase !== undefined && value.phase !== 'prepared' && value.phase !== 'files-applied')
		|| !Array.isArray(value.targets)
		|| value.targets.length === 0) return null;
	const targets = value.targets.map(parseTarget);
	if (targets.some((target): target is null => target === null)) return null;
	const resolvedTargets = targets as MigrationTarget[];
	if (!isSortedUniqueTargets(resolvedTargets)) return null;
	return {
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		phase: value.phase === 'files-applied' ? 'files-applied' : 'prepared',
		transactionSha256: value.transactionSha256,
		targets: resolvedTargets,
	};
}

function parseReceipt(serialized: string): MigrationReceipt | null {
	let value: unknown;
	try {
		value = JSON.parse(serialized) as unknown;
	} catch {
		return null;
	}
	if (!isRecord(value)
		|| (!hasExactKeys(value, ['version', 'targetTableVersion', 'transactionSha256', 'markerSha256', 'targets'])
			&& !hasExactKeys(value, ['version', 'targetTableVersion', 'phase', 'transactionSha256', 'markerSha256', 'targets']))
		|| value.version !== TABLE_FILE_V3_MIGRATION_VERSION
		|| value.targetTableVersion !== OPERON_TABLE_FILE_V3_VERSION
		|| !isSha256(value.transactionSha256)
		|| !isSha256(value.markerSha256)
		|| (value.phase !== undefined && value.phase !== 'committed')
		|| !Array.isArray(value.targets)
		|| value.targets.length === 0) return null;
	const targets = value.targets.map(parseTarget);
	if (targets.some((target): target is null => target === null)) return null;
	const resolvedTargets = targets as MigrationTarget[];
	if (!isSortedUniqueTargets(resolvedTargets)) return null;
	return {
		version: TABLE_FILE_V3_MIGRATION_VERSION,
		targetTableVersion: OPERON_TABLE_FILE_V3_VERSION,
		phase: 'committed',
		transactionSha256: value.transactionSha256,
		markerSha256: value.markerSha256,
		targets: resolvedTargets,
	};
}

function parseTarget(value: unknown): MigrationTarget | null {
	if (!isRecord(value)
		|| (!hasExactKeys(value, ['path', 'sourceSha256', 'candidateSha256', 'backupPath'])
			&& !hasExactKeys(value, [
				'path', 'candidatePath', 'sourceId', 'candidateId', 'sourceMtime',
				'sourceSha256', 'candidateSha256', 'backupPath',
			]))
		|| typeof value.path !== 'string'
		|| !value.path
		|| normalizeOperonTableFilePath(value.path) !== value.path
		|| !isSafeTableRecoveryPath(value.path)
		|| !value.path.toLocaleLowerCase('en-US').endsWith('.table')
		|| !isSha256(value.sourceSha256)
		|| !isSha256(value.candidateSha256)
		|| (value.candidatePath !== undefined && (
			typeof value.candidatePath !== 'string'
			|| normalizeOperonTableFilePath(value.candidatePath) !== value.candidatePath
			|| !isSafeTableRecoveryPath(value.candidatePath)
			|| !value.candidatePath.toLocaleLowerCase('en-US').endsWith('.table')
		))
		|| (value.sourceId !== undefined && typeof value.sourceId !== 'string')
		|| (value.candidateId !== undefined && typeof value.candidateId !== 'string')
		|| (value.sourceMtime !== undefined && (typeof value.sourceMtime !== 'number' || !Number.isFinite(value.sourceMtime)))
		|| typeof value.backupPath !== 'string'
		|| !value.backupPath) return null;
	return {
		path: value.path,
		...(typeof value.candidatePath === 'string' ? { candidatePath: value.candidatePath } : {}),
		...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
		...(typeof value.candidateId === 'string' ? { candidateId: value.candidateId } : {}),
		...(typeof value.sourceMtime === 'number' ? { sourceMtime: value.sourceMtime } : {}),
		sourceSha256: value.sourceSha256,
		candidateSha256: value.candidateSha256,
		backupPath: value.backupPath,
	};
}

function isSafeTableRecoveryPath(path: string): boolean {
	const slash = path.lastIndexOf('/');
	const folder = slash < 0 ? '' : path.slice(0, slash);
	const name = slash < 0 ? path : path.slice(slash + 1);
	return !!name && !name.includes('\0') && (folder === '' || isSafeVaultRelativeFolderPath(folder));
}

function isSortedUniqueTargets(targets: readonly MigrationTarget[]): boolean {
	let previousPath = '';
	const seenPaths = new Set<string>();
	for (const target of targets) {
		const pathKey = getOperonTableFilePathKey(target.path);
		if (seenPaths.has(pathKey) || (previousPath && compareStrings(previousPath, target.path) >= 0)) return false;
		seenPaths.add(pathKey);
		previousPath = target.path;
	}
	return true;
}

async function writeImmutableExact(
	adapter: TableFileV3MigrationAdapter,
	path: string,
	serialized: string,
	label: string,
): Promise<void> {
	try {
		if (await adapter.exists(path)) {
			if (await adapter.read(path) !== serialized) {
				throw new TableFileV3MigrationError('immutable-mismatch', `Existing ${label} does not match its expected content.`);
			}
			return;
		}
	} catch (error) {
		if (error instanceof TableFileV3MigrationError) throw error;
		throw new TableFileV3MigrationError('immutable-preflight-failed', `Could not inspect existing ${label}.`);
	}
	await writeExactObserved(adapter, path, serialized, label);
}

async function writeExactObserved(
	adapter: TableFileV3MigrationAdapter,
	path: string,
	serialized: string,
	label: string,
): Promise<void> {
	let writeError: unknown;
	try {
		await writeTextSafely(adapter, path, serialized, { forceAtomicReplacement: true, verifyAtomicReplacement: true });
	} catch (error) {
		writeError = error;
	}
	try {
		if (await adapter.read(path) === serialized) return;
	} catch {
		// The original write failure is reported below and no outcome is assumed.
	}
	throw new TableFileV3MigrationError(
		'write-unacknowledged',
		`Could not verify ${label}${writeError ? ' after a failed write' : ''}.`,
	);
}

async function removeActiveMarkerObserved(
	adapter: TableFileV3MigrationAdapter,
	path: string,
	expectedSerialized: string,
): Promise<void> {
	let accepted = false;
	await adapter.process(path, source => {
		if (source !== expectedSerialized) return source;
		accepted = true;
		return '';
	});
	if (!accepted) throw new TableFileV3MigrationError('marker-divergent', 'Table file V3 migration marker changed before finalization.');
	let removeError: unknown;
	try {
		if (await adapter.read(path) === '') await adapter.remove(path);
	} catch (error) { removeError = error; }
	try {
		if (!(await adapter.exists(path)) || await adapter.read(path) === '') return;
	} catch {
		// Fall through to the fail-closed marker result.
	}
	if (removeError instanceof TableFileV3MigrationError) throw removeError;
	throw new TableFileV3MigrationError('marker-finalization-failed', 'Table file V3 migration receipt is retained because active marker finalization was not observed.');
}

async function replaceMarkerPhase(
	adapter: TableFileV3MigrationAdapter,
	path: string,
	expectedSerialized: string,
	marker: MigrationMarker,
): Promise<string> {
	const serialized = serializeMarker(marker);
	let accepted = false;
	await adapter.process(path, source => {
		if (source !== expectedSerialized) return source;
		accepted = true;
		return serialized;
	});
	if (!accepted || await adapter.read(path) !== serialized) {
		throw new TableFileV3MigrationError('marker-divergent', 'Table file recovery marker changed before its phase transition.');
	}
	return serialized;
}

async function writeInitialMigrationMarkerCas(
	adapter: TableFileV3MigrationAdapter,
	path: string,
	serialized: string,
): Promise<void> {
	if (!(await adapter.exists(path))) {
		await writeImmutableExact(adapter, path, serialized, 'migration marker');
		return;
	}
	let accepted = false;
	await adapter.process(path, source => {
		if (source !== '') return source;
		accepted = true;
		return serialized;
	});
	if (!accepted || await adapter.read(path) !== serialized) {
		throw new TableFileV3MigrationError('marker-divergent', 'Table file recovery marker changed before transaction preparation.');
	}
}

async function ensureFolder(adapter: TableFileV3MigrationAdapter, path: string): Promise<void> {
	const segments = path.split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (await adapter.exists(current)) continue;
		await adapter.mkdir(current);
	}
}

async function ensureMigrationFolders(adapter: TableFileV3MigrationAdapter, paths: StoredPaths): Promise<void> {
	await ensureFolder(adapter, paths.root);
	await ensureFolder(adapter, paths.backupsRoot);
	await ensureFolder(adapter, paths.receiptsRoot);
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
