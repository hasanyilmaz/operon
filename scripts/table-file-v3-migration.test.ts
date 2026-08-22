import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	migrateOperonTableFilesBeforeRegistryRefresh,
	migrateOperonTableFilesToV3,
	TableFileV3MigrationError,
	type TableFileV3MigrationFile,
} from '../src/storage/table-file-v3-migration';
import { sha256HexForStorage } from '../src/storage/storage-sha256';
import { TablePresetRegistry } from '../src/storage/table-preset-registry';
import { createDefaultTablePreset } from '../src/types/table';
import { serializeOperonTableFile } from '../src/storage/table-file';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message ?? 'Values must be equal.');
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message ?? 'Values must be deeply equal.');
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

type FailureMode = 'normal' | 'throw-before' | 'commit-then-throw' | 'diverge-then-throw' | 'cas-mismatch' | 'post-ack-diverge';
type MutableMigrationTarget = {
	path: string;
	sourceSha256: string;
	candidateSha256: string;
	backupPath: string;
};
type MutableMigrationMarker = {
	version: number;
	targetTableVersion: number;
	phase?: 'prepared' | 'files-applied';
	transactionSha256: string;
	targets: MutableMigrationTarget[];
};
type MutableMigrationReceipt = Omit<MutableMigrationMarker, 'phase'> & { phase: 'committed'; markerSha256: string };

async function buildTestReceipt(marker: MutableMigrationMarker): Promise<MutableMigrationReceipt> {
	return {
		version: marker.version,
		targetTableVersion: marker.targetTableVersion,
		phase: 'committed',
		transactionSha256: marker.transactionSha256,
		markerSha256: await sha256HexForStorage(`${JSON.stringify(marker, null, '\t')}\n`),
		targets: marker.targets,
	};
}

class MigrationMemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readonly tablePaths: string[];
	readonly mutations: Array<{ operation: string; path: string; nextPath?: string }> = [];
	readCalls = 0;
	listCalls = 0;
	sourceProcessCalls = 0;
	readonly sourceProcessPaths: string[] = [];
	sourceFailureAt: number | null = null;
	sourceFailureMode: FailureMode = 'normal';
	writeFailurePath: string | null = null;
	renameFailurePath: string | null = null;
	renameCommitThenThrowPath: string | null = null;
	removeFailurePath: string | null = null;
	removeCommitThenThrowPath: string | null = null;
	readFailureAfterSourceProcessPath: string | null = null;
	readFailureAfterSourceProcessCount = 1;
	readonly readsAfterSourceProcess = new Map<string, number>();
	readonly unreadablePaths = new Set<string>();

	constructor(tableFiles: Record<string, string>, private readonly tableMtimes: Record<string, number> = {}) {
		this.tablePaths = Object.keys(tableFiles).sort();
		for (const [filePath, source] of Object.entries(tableFiles)) this.files.set(filePath, source);
	}

	async exists(filePath: string): Promise<boolean> {
		return this.files.has(filePath) || this.folders.has(filePath);
	}

	async read(filePath: string): Promise<string> {
		this.readCalls += 1;
		if (this.unreadablePaths.has(filePath)) throw new Error(`UNREADABLE:${filePath}`);
		if (this.readFailureAfterSourceProcessPath === filePath && this.sourceProcessCalls > 0) {
			const reads = (this.readsAfterSourceProcess.get(filePath) ?? 0) + 1;
			this.readsAfterSourceProcess.set(filePath, reads);
			if (reads >= this.readFailureAfterSourceProcessCount) throw new Error(`READBACK_FAILED:${filePath}`);
		}
		const source = this.files.get(filePath);
		if (source === undefined) throw new Error(`Missing: ${filePath}`);
		return source;
	}
	async process(filePath: string, change: (source: string) => string): Promise<string> {
		const next = change(await this.read(filePath));
		this.files.set(filePath, next);
		this.mutations.push({ operation: 'process', path: filePath });
		return next;
	}

	async write(filePath: string, source: string): Promise<void> {
		this.mutations.push({ operation: 'write', path: filePath });
		if (this.writeFailurePath && filePath.includes(this.writeFailurePath)) throw new Error(`WRITE_FAILED:${filePath}`);
		this.files.set(filePath, source);
	}

	async rename(filePath: string, nextPath: string): Promise<void> {
		this.mutations.push({ operation: 'rename', path: filePath, nextPath });
		if (this.renameFailurePath && nextPath.includes(this.renameFailurePath)) throw new Error(`RENAME_FAILED:${nextPath}`);
		const source = await this.read(filePath);
		this.files.set(nextPath, source);
		this.files.delete(filePath);
		if (this.renameCommitThenThrowPath && nextPath.includes(this.renameCommitThenThrowPath)) {
			this.renameCommitThenThrowPath = null;
			throw new Error(`RENAME_ACK_LOST:${nextPath}`);
		}
	}

	async remove(filePath: string): Promise<void> {
		this.mutations.push({ operation: 'remove', path: filePath });
		if (this.removeFailurePath && filePath.includes(this.removeFailurePath)) throw new Error(`REMOVE_FAILED:${filePath}`);
		this.files.delete(filePath);
		if (this.removeCommitThenThrowPath && filePath.includes(this.removeCommitThenThrowPath)) {
			throw new Error(`REMOVE_ACK_LOST:${filePath}`);
		}
	}

	async mkdir(folder: string): Promise<void> {
		this.mutations.push({ operation: 'mkdir', path: folder });
		this.folders.add(folder);
	}

	async processTable(file: TestTableFile, transform: (source: string) => string): Promise<void> {
		this.mutations.push({ operation: 'process', path: file.path });
		const source = await this.read(file.path);
		this.sourceProcessCalls += 1;
		this.sourceProcessPaths.push(file.path);
		if (this.sourceFailureAt === this.sourceProcessCalls) {
			if (this.sourceFailureMode === 'throw-before') throw new Error('SOURCE_WRITE_BEFORE');
			if (this.sourceFailureMode === 'diverge-then-throw') {
				this.files.set(file.path, '{"thirdParty":true}\n');
				throw new Error('SOURCE_WRITE_DIVERGED');
			}
			if (this.sourceFailureMode === 'commit-then-throw') {
				this.files.set(file.path, transform(source));
				throw new Error('SOURCE_WRITE_ACK_LOST');
			}
			if (this.sourceFailureMode === 'cas-mismatch') {
				this.files.set(file.path, `${source}\nthird-party`);
				transform(`${source}\nthird-party`);
				return;
			}
			if (this.sourceFailureMode === 'post-ack-diverge') {
				this.files.set(file.path, transform(source));
				this.files.set(file.path, '{"thirdParty":true}\n');
				return;
			}
		}
		this.files.set(file.path, transform(source));
	}

	filesForMigration(): TestTableFile[] {
		this.listCalls += 1;
		return this.tablePaths.map(filePath => ({ path: filePath, stat: { mtime: this.tableMtimes[filePath] ?? 0 } }));
	}

	writePaths(): string[] {
		return this.mutations.filter(entry => entry.operation === 'write' || entry.operation === 'rename' || entry.operation === 'remove')
			.map(entry => entry.path);
	}
}

class MigrationDiskAdapter {
	readonly mutations: Array<{ operation: string; path: string; nextPath?: string }> = [];
	sourceProcessCalls = 0;
	readonly sourceProcessPaths: string[] = [];

	constructor(private readonly root: string) {}

	private resolve(filePath: string): string { return path.join(this.root, filePath); }

	async exists(filePath: string): Promise<boolean> {
		try {
			await access(this.resolve(filePath));
			return true;
		} catch {
			return false;
		}
	}

	async read(filePath: string): Promise<string> { return await readFile(this.resolve(filePath), 'utf8'); }
	async process(filePath: string, change: (source: string) => string): Promise<string> {
		const next = change(await this.read(filePath));
		await writeFile(this.resolve(filePath), next, 'utf8');
		this.mutations.push({ operation: 'process', path: filePath });
		return next;
	}

	async write(filePath: string, source: string): Promise<void> {
		this.mutations.push({ operation: 'write', path: filePath });
		const target = this.resolve(filePath);
		await this.mkdir(path.dirname(filePath));
		await writeFile(target, source, 'utf8');
	}

	async rename(filePath: string, nextPath: string): Promise<void> {
		this.mutations.push({ operation: 'rename', path: filePath, nextPath });
		const target = this.resolve(nextPath);
		await this.mkdir(path.dirname(nextPath));
		await rename(this.resolve(filePath), target);
	}

	async remove(filePath: string): Promise<void> {
		this.mutations.push({ operation: 'remove', path: filePath });
		await unlink(this.resolve(filePath));
	}

	async mkdir(folder: string): Promise<void> {
		this.mutations.push({ operation: 'mkdir', path: folder });
		await mkdir(this.resolve(folder), { recursive: true });
	}

	async processTable(file: TestTableFile, transform: (source: string) => string): Promise<void> {
		this.mutations.push({ operation: 'process', path: file.path });
		this.sourceProcessCalls += 1;
		this.sourceProcessPaths.push(file.path);
		const source = await this.read(file.path);
		await writeFile(this.resolve(file.path), transform(source), 'utf8');
	}
}

type TestTableFile = TableFileV3MigrationFile;

function legacySource(version: 1 | 2, id: string, filterSetId = 'fs-unrelated'): string {
	const value = JSON.parse(serializeOperonTableFile({ ...createDefaultTablePreset(), id, name: id })) as Record<string, unknown>;
	value.version = version;
	value.filterSetId = filterSetId;
	value.columns = [
		{ key: 'taskType', kind: 'task', label: 'Legacy source kind' },
		{ key: '__taskType', kind: 'task' },
		{ key: 'status', kind: 'task' },
	];
	value.sortRules = [
		{ key: 'taskType', direction: 'asc', empty: 'last' },
		{ key: '__taskType', direction: 'desc', empty: 'first' },
	];
	value.groupBy = 'taskType';
	value.subgroupBy = '__taskType';
	value.summaries = [
		{ key: 'taskType', function: 'Count' },
		{ key: '__taskType', function: 'Filled' },
	];
	if (version === 1) delete value.collapsedGroupKeys;
	return JSON.stringify(value, null, 2);
}

function v3Source(id: string): string {
	return serializeOperonTableFile({ ...createDefaultTablePreset(), id, name: id });
}

type MigrationTestOptions = {
	configDir?: string;
	beforeFirstPersistentMutation?: () => Promise<void>;
	bindings?: Array<{ id: string; path: string }>;
};

function migration(adapter: MigrationMemoryAdapter, options: MigrationTestOptions = {}) {
	return migrateOperonTableFilesToV3({
		adapter,
		configDir: options.configDir ?? '.obsidian',
		listTableFiles: () => adapter.filesForMigration(),
		readTableFile: file => adapter.read(file.path),
		processTableFile: (file, transform) => adapter.processTable(file, transform),
		renameTableFile: async (file, destinationPath) => {
			const sourcePath = file.path;
			try {
				await adapter.rename(sourcePath, destinationPath);
			} finally {
				if (adapter.files.has(destinationPath) && !adapter.files.has(sourcePath)) {
					const index = adapter.tablePaths.indexOf(sourcePath);
					if (index >= 0) adapter.tablePaths[index] = destinationPath;
					file.path = destinationPath;
				}
			}
		},
		loadFileBindings: () => options.bindings ?? [],
		beforeFirstPersistentMutation: options.beforeFirstPersistentMutation,
	});
}

function sources(adapter: MigrationMemoryAdapter): Record<string, unknown> {
	return Object.fromEntries(adapter.tablePaths.map(filePath => [filePath, adapter.files.get(filePath)]));
}

function migrationPaths(adapter: MigrationMemoryAdapter): string[] {
	return [...adapter.files.keys()].filter(filePath => filePath.includes('state/table-file-v3-migration/')).sort();
}

function activeMarkerPath(adapter: MigrationMemoryAdapter): string {
	const activePath = migrationPaths(adapter).find(filePath => filePath.endsWith('/active.json'));
	if (!activePath) throw new Error('Expected active migration marker.');
	return activePath;
}

function assertNoMigrationTemporaryFiles(adapter: MigrationMemoryAdapter): void {
	const temporary = migrationPaths(adapter).filter(filePath => filePath.includes('.tmp-') || filePath.includes('.replace-backup'));
	deepEqual(temporary, [], 'Migration storage must not retain atomic-write temporary or replacement-backup files.');
}

type MigrationMutation = { operation: string; path: string; nextPath?: string };

type ExactMigrationMutationAllowlist = {
	exactPaths: ReadonlySet<string>;
	atomicWriteTargets: readonly string[];
};

async function buildExactMigrationMutationAllowlist(
	configDir: string,
	receiptPath: string,
	read: (filePath: string) => Promise<string>,
): Promise<ExactMigrationMutationAllowlist> {
	const receipt = JSON.parse(await read(receiptPath)) as MutableMigrationReceipt;
	const configParts = configDir.split('/').map(part => part.trim()).filter(Boolean);
	const root = [...configParts, 'plugins', 'operon', 'state', 'table-file-v3-migration'].join('/');
	const rootParts = root.split('/');
	const exactPaths = new Set<string>();
	for (let index = 1; index <= rootParts.length; index += 1) exactPaths.add(rootParts.slice(0, index).join('/'));
	exactPaths.add(`${root}/backups`);
	exactPaths.add(`${root}/receipts`);
	exactPaths.add(`${root}/active.json`);
	exactPaths.add(receiptPath);
	for (const target of receipt.targets) {
		exactPaths.add(target.path);
		exactPaths.add(target.backupPath);
	}
	return {
		exactPaths,
		atomicWriteTargets: [
			`${root}/active.json`,
			receiptPath,
			...receipt.targets.map(target => target.backupPath),
		],
	};
}

function mutationPathIsAllowed(filePath: string, allowlist: ExactMigrationMutationAllowlist): boolean {
	if (allowlist.exactPaths.has(filePath)) return true;
	return allowlist.atomicWriteTargets.some(target => (
		filePath.startsWith(`${target}.tmp-`)
		|| filePath.startsWith(`${target}.replace-backup.tmp-`)
	));
}

function assertMutationsUseExactMigrationAllowlist(
	mutations: readonly MigrationMutation[],
	allowlist: ExactMigrationMutationAllowlist,
): void {
	for (const mutation of mutations) {
		const paths = [mutation.path, mutation.nextPath].filter((value): value is string => Boolean(value));
		for (const filePath of paths) {
			ok(
				mutationPathIsAllowed(filePath, allowlist),
				`Unexpected migration write target: ${filePath}`,
			);
		}
	}
}

async function assertAllowedMigrationMutations(adapter: MigrationMemoryAdapter): Promise<void> {
	const receiptPath = migrationPaths(adapter).find(filePath => filePath.includes('/receipts/'));
	if (!receiptPath) throw new Error('Expected a durable migration receipt before asserting mutation paths.');
	const allowlist = await buildExactMigrationMutationAllowlist('.obsidian', receiptPath, filePath => adapter.read(filePath));
	assertMutationsUseExactMigrationAllowlist(adapter.mutations, allowlist);
	equal(mutationPathIsAllowed('Tables/Unexpected.table', allowlist), false, 'Only exact sealed legacy source paths may be mutated.');
	equal(
		mutationPathIsAllowed('.obsidian/plugins/operon/state/table-file-v3-migration-evil/active.json', allowlist),
		false,
		'Prefix-adjacent migration directories must not enter the mutation allowlist.',
	);
}

async function listDiskPaths(root: string, relative = ''): Promise<string[]> {
	const directory = path.join(root, relative);
	const entries = await readdir(directory, { withFileTypes: true });
	const paths: string[] = [];
	for (const entry of entries) {
		const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			paths.push(...await listDiskPaths(root, nextRelative));
		} else {
			paths.push(nextRelative);
		}
	}
	return paths.sort();
}

async function resealMarker(adapter: MigrationMemoryAdapter, mutate: (marker: MutableMigrationMarker) => void): Promise<void> {
	const markerPath = activeMarkerPath(adapter);
	const marker = JSON.parse(await adapter.read(markerPath)) as MutableMigrationMarker;
	mutate(marker);
	marker.transactionSha256 = await sha256HexForStorage(JSON.stringify({
		version: marker.version,
		targetTableVersion: marker.targetTableVersion,
		targets: marker.targets,
	}));
	adapter.files.set(markerPath, `${JSON.stringify(marker, null, '\t')}\n`);
}

async function buildInterruptedMigrationAdapter(id = 'interrupted'): Promise<MigrationMemoryAdapter> {
	const adapter = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, id) });
	adapter.sourceFailureAt = 1;
	adapter.sourceFailureMode = 'throw-before';
	await expectBlocked(() => migration(adapter), 'target-previous');
	return adapter;
}

async function expectBlocked(action: () => Promise<unknown>, code: string): Promise<void> {
	await assert.rejects(action, error => error instanceof TableFileV3MigrationError && error.code === code);
	assertions += 1;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>(nextResolve => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function run(): Promise<void> {
	const originalV3 = `${v3Source('table-v3')}\n`;
	const adapter = new MigrationMemoryAdapter({
		'Tables/One.table': legacySource(1, 'table-one'),
		'Tables/Two.table': legacySource(2, 'table-two'),
		'Tables/Three.table': originalV3,
	});
	const before = sources(adapter);
	const first = await migration(adapter);
	equal(first.status, 'migrated');
	if (first.status === 'migrated') deepEqual(first.migratedPaths, ['Tables/One.table', 'Tables/Two.table']);
	equal(adapter.files.get('Tables/Three.table'), originalV3, 'Existing V3 bytes must remain untouched.');
	for (const filePath of ['Tables/One.table', 'Tables/Two.table']) {
		const migrated = JSON.parse(await adapter.read(filePath)) as Record<string, unknown>;
		equal(migrated.version, 3);
		deepEqual((migrated.columns as Array<{ key: string }>).map(column => column.key), ['__taskDataType', 'status']);
		deepEqual((migrated.sortRules as Array<{ key: string }>).map(rule => rule.key), ['__taskDataType']);
		deepEqual((migrated.summaries as Array<{ key: string }>).map(rule => rule.key), ['__taskDataType']);
		equal(migrated.groupBy, '__taskDataType');
		equal(migrated.subgroupBy, null);
		equal(migrated.filterSetId, 'fs-unrelated', 'Generic FilterSet identity must be preserved verbatim.');
	}
	const statePaths = migrationPaths(adapter);
	equal(statePaths.some(filePath => filePath.endsWith('/active.json')), false, 'Completed transactions must clear only the active marker.');
	equal(statePaths.filter(filePath => filePath.includes('/backups/')).length, 2, 'Each legacy source must retain one immutable backup.');
	equal(statePaths.filter(filePath => filePath.includes('/receipts/')).length, 1, 'Each transaction must retain one receipt.');
	for (const backupPath of statePaths.filter(filePath => filePath.includes('/backups/'))) {
		const backup = await adapter.read(backupPath);
		ok(Object.values(before).includes(backup), 'Backups must remain exact sealed preimages for external/manual restore.');
	}
	await assertAllowedMigrationMutations(adapter);
	assertNoMigrationTemporaryFiles(adapter);
	const sourceProcessesAfterFirst = adapter.sourceProcessCalls;
	const writesAfterFirst = adapter.writePaths().length;
	equal((await migration(adapter)).status, 'not-needed');
	equal(adapter.sourceProcessCalls, sourceProcessesAfterFirst, 'Second initialization must not rewrite V3 table sources.');
	equal(adapter.writePaths().length, writesAfterFirst, 'Second initialization must not rewrite marker, receipt, or data package state.');

	const duplicateSource = v3Source('table-duplicate');
	const duplicateRecovery = new MigrationMemoryAdapter({
		'Tables/Older.table': duplicateSource,
		'Tables/Newer.table': duplicateSource.replace('"name": "table-duplicate"', '"name": "Newest"'),
		'Tables/Invalid.table': '{',
	}, {
		'Tables/Older.table': 10,
		'Tables/Newer.table': 20,
		'Tables/Invalid.table': 999,
	});
	const invalidBefore = await duplicateRecovery.read('Tables/Invalid.table');
	const duplicateResult = await migration(duplicateRecovery, {
		bindings: [{ id: 'table-duplicate', path: 'Tables/Older.table' }],
	});
	equal(duplicateResult.status, 'migrated');
	equal(JSON.parse(await duplicateRecovery.read('Tables/Newer.table')).id, 'table-duplicate', 'Newest valid file keeps the original ID.');
	const recoveredPath = duplicateRecovery.tablePaths.find(filePath => filePath !== 'Tables/Newer.table' && filePath.endsWith('.table') && filePath !== 'Tables/Invalid.table');
	ok(recoveredPath && recoveredPath !== 'Tables/Older.table', 'Older duplicate receives a unique recovered filename.');
	const recoveredPreset = JSON.parse(await duplicateRecovery.read(recoveredPath));
	ok(typeof recoveredPreset.id === 'string' && recoveredPreset.id.startsWith('tp_recovered_'));
	equal(recoveredPreset.name, 'table-duplicate ID Conflict');
	equal(await duplicateRecovery.read('Tables/Invalid.table'), invalidBefore, 'Invalid claimant remains byte-for-byte untouched.');
	const duplicateMutations = duplicateRecovery.mutations.length;
	equal((await migration(duplicateRecovery, { bindings: [{ id: 'table-duplicate', path: 'Tables/Newer.table' }] })).status, 'not-needed');
	equal(duplicateRecovery.mutations.length, duplicateMutations, 'Duplicate recovery is zero-write on second startup.');

	const missingBindingDuplicate = new MigrationMemoryAdapter({
		'Tables/A.table': v3Source('missing-binding-duplicate'),
		'Tables/B.table': v3Source('missing-binding-duplicate'),
	}, { 'Tables/A.table': 5, 'Tables/B.table': 15 });
	const missingBindingResult = await migration(missingBindingDuplicate, {
		bindings: [{ id: 'missing-binding-duplicate', path: 'Tables/Gone.table' }],
	});
	equal(missingBindingResult.status, 'migrated');
	equal(JSON.parse(await missingBindingDuplicate.read('Tables/B.table')).id, 'missing-binding-duplicate');
	const missingBindingRecoveredPath = missingBindingDuplicate.tablePaths.find(filePath => filePath.includes('ID Conflict.table'));
	ok(missingBindingRecoveredPath, 'A missing historical binding must not block deterministic duplicate recovery.');
	ok(JSON.parse(await missingBindingDuplicate.read(missingBindingRecoveredPath)).id.startsWith('tp_recovered_'));
	equal((await migration(missingBindingDuplicate)).status, 'not-needed');

	for (const mode of ['throw-before', 'commit-then-throw'] as const) {
		const interruptedDuplicate = new MigrationMemoryAdapter({
			'Tables/Old.table': v3Source('duplicate-interrupted'),
			'Tables/New.table': v3Source('duplicate-interrupted'),
		}, { 'Tables/Old.table': 1, 'Tables/New.table': 2 });
		if (mode === 'throw-before') interruptedDuplicate.renameFailurePath = 'ID Conflict.table';
		else interruptedDuplicate.renameCommitThenThrowPath = 'ID Conflict.table';
		if (mode === 'throw-before') {
			await expectBlocked(() => migration(interruptedDuplicate), 'rename-previous');
			interruptedDuplicate.renameFailurePath = null;
			equal((await migration(interruptedDuplicate)).status, 'resumed');
		} else {
			equal((await migration(interruptedDuplicate)).status, 'migrated', 'Rename acknowledgement loss is accepted after exact path observation.');
		}
		ok(interruptedDuplicate.tablePaths.some(filePath => filePath.includes('ID Conflict.table')));
	}

	const concurrent = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'concurrent') });
	const admitted = deferred();
	const releaseFirstMigration = deferred();
	const firstConcurrentMigration = migration(concurrent, {
		configDir: '.obsidian/',
		beforeFirstPersistentMutation: async () => {
			admitted.resolve();
			await releaseFirstMigration.promise;
		},
	});
	await admitted.promise;
	const waitingReadCalls = concurrent.readCalls;
	const waitingListCalls = concurrent.listCalls;
	const waitingMutations = concurrent.mutations.length;
	const secondConcurrentMigration = migration(concurrent, { configDir: '.obsidian' });
	await Promise.resolve();
	equal(concurrent.readCalls, waitingReadCalls, 'A same-adapter caller must not begin a second marker read while the first transaction holds the mutex.');
	equal(concurrent.listCalls, waitingListCalls, 'A same-adapter caller must not begin a second preflight while the first transaction holds the mutex.');
	equal(concurrent.mutations.length, waitingMutations, 'A same-adapter caller must not mutate migration state while waiting for the mutex.');
	releaseFirstMigration.resolve();
	const [firstConcurrentResult, secondConcurrentResult] = await Promise.all([firstConcurrentMigration, secondConcurrentMigration]);
	equal(firstConcurrentResult.status, 'migrated');
	equal(secondConcurrentResult.status, 'not-needed', 'The waiting caller must restart from fresh evidence after lock acquisition.');
	equal(concurrent.sourceProcessCalls, 1, 'Concurrent startup must perform only one source CAS.');
	equal(migrationPaths(concurrent).filter(filePath => filePath.includes('/backups/')).length, 1, 'Concurrent startup must retain one exact backup only.');
	equal(migrationPaths(concurrent).filter(filePath => filePath.includes('/receipts/')).length, 1, 'Concurrent startup must retain one exact receipt only.');
	equal(migrationPaths(concurrent).some(filePath => filePath.endsWith('/active.json')), false, 'Concurrent startup must not retain a duplicate active marker.');
	assertNoMigrationTemporaryFiles(concurrent);

	for (const invalid of ['{', JSON.stringify({ format: 'operon-table', version: 4 })]) {
		const isolated = new MigrationMemoryAdapter({
			'Tables/Legacy.table': legacySource(2, 'legacy-blocked'),
			'Tables/Invalid.table': invalid,
		});
		const invalidBefore = await isolated.read('Tables/Invalid.table');
		equal((await migration(isolated)).status, 'migrated');
		equal(await isolated.read('Tables/Invalid.table'), invalidBefore, 'Invalid Table evidence must remain isolated and untouched.');
	}
	const missing = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'legacy-missing') });
	missing.tablePaths.push('Tables/Missing.table');
	equal((await migration(missing)).status, 'migrated');
	equal(missing.sourceProcessCalls, 1, 'Temporarily missing Table evidence must not block valid source migration.');

	const duplicate = new MigrationMemoryAdapter({
		'Tables/One.table': legacySource(1, 'duplicate-id'),
		'Tables/Two.table': legacySource(2, 'duplicate-id'),
	}, { 'Tables/One.table': 1, 'Tables/Two.table': 2 });
	equal((await migration(duplicate)).status, 'migrated');
	equal(JSON.parse(await duplicate.read('Tables/Two.table')).id, 'duplicate-id');
	ok(duplicate.tablePaths.some(filePath => filePath.includes('ID Conflict.table')));

	const malformedMarker = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'malformed-marker') });
	malformedMarker.files.set('.obsidian/plugins/operon/state/table-file-v3-migration/active.json', '{');
	const malformedMarkerMutations = malformedMarker.mutations.length;
	await expectBlocked(() => migration(malformedMarker), 'marker-invalid');
	equal(malformedMarker.mutations.length, malformedMarkerMutations, 'Malformed markers must block before any directory, source, or state write.');

	const invalidTransactionMarker = await buildInterruptedMigrationAdapter('invalid-transaction-marker');
	const invalidTransactionMarkerPath = activeMarkerPath(invalidTransactionMarker);
	const invalidTransactionMarkerValue = JSON.parse(await invalidTransactionMarker.read(invalidTransactionMarkerPath)) as MutableMigrationMarker;
	invalidTransactionMarkerValue.transactionSha256 = '0'.repeat(64);
	invalidTransactionMarker.files.set(invalidTransactionMarkerPath, `${JSON.stringify(invalidTransactionMarkerValue, null, '\t')}\n`);
	const invalidTransactionMutations = invalidTransactionMarker.mutations.length;
	await expectBlocked(() => migration(invalidTransactionMarker), 'marker-identity-invalid');
	equal(invalidTransactionMarker.mutations.length, invalidTransactionMutations, 'Valid-shape but invalid transaction markers must be total zero-write.');

	const invalidBackupIdentityMarker = await buildInterruptedMigrationAdapter('invalid-backup-marker');
	await resealMarker(invalidBackupIdentityMarker, marker => {
		marker.targets[0].backupPath = '.obsidian/plugins/operon/state/table-file-v3-migration/backups/not-the-sealed-backup.table.bak';
	});
	const invalidBackupIdentityMutations = invalidBackupIdentityMarker.mutations.length;
	await expectBlocked(() => migration(invalidBackupIdentityMarker), 'marker-identity-invalid');
	equal(invalidBackupIdentityMarker.mutations.length, invalidBackupIdentityMutations, 'Invalid backup identities must block before any write.');

	const backupFailure = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'backup-failure') });
	backupFailure.writeFailurePath = '/backups/';
	await expectBlocked(() => migration(backupFailure), 'write-unacknowledged');
	equal(backupFailure.sourceProcessCalls, 0, 'Backup failure must occur before any source CAS.');
	assertNoMigrationTemporaryFiles(backupFailure);

	const backupAcknowledgementLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'backup-ack-loss') });
	backupAcknowledgementLoss.renameCommitThenThrowPath = '/backups/';
	equal((await migration(backupAcknowledgementLoss)).status, 'migrated', 'Exact immutable backup readback must recover a commit-then-error write.');

	const markerFailure = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'marker-failure') });
	markerFailure.renameFailurePath = '/active.json';
	await expectBlocked(() => migration(markerFailure), 'write-unacknowledged');
	equal(markerFailure.sourceProcessCalls, 0, 'Marker failure must occur before any source CAS.');
	assertNoMigrationTemporaryFiles(markerFailure);

	const markerWriteAcknowledgementLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'marker-write-ack-loss') });
	markerWriteAcknowledgementLoss.renameCommitThenThrowPath = '/active.json';
	equal((await migration(markerWriteAcknowledgementLoss)).status, 'migrated', 'Exact marker readback must recover a commit-then-error marker write.');

	const acknowledgedLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'ack-loss') });
	acknowledgedLoss.sourceFailureAt = 1;
	acknowledgedLoss.sourceFailureMode = 'commit-then-throw';
	equal((await migration(acknowledgedLoss)).status, 'migrated', 'Exact candidate readback must recover a commit-then-error source write.');
	equal((JSON.parse(await acknowledgedLoss.read('Tables/Legacy.table')) as { version: number }).version, 3);

	const mixedPartialRestart = new MigrationMemoryAdapter({
		'Tables/First.table': legacySource(1, 'mixed-first'),
		'Tables/Middle.table': legacySource(2, 'mixed-middle'),
		'Tables/Last.table': legacySource(2, 'mixed-last'),
	});
	mixedPartialRestart.sourceFailureAt = 2;
	mixedPartialRestart.sourceFailureMode = 'throw-before';
	await expectBlocked(() => migration(mixedPartialRestart), 'target-previous');
	deepEqual(mixedPartialRestart.sourceProcessPaths, ['Tables/First.table', 'Tables/Last.table'], 'Initial ordered source attempt must stop at the failing target.');
	const processesBeforeMixedResume = mixedPartialRestart.sourceProcessPaths.length;
	mixedPartialRestart.sourceFailureAt = null;
	mixedPartialRestart.sourceFailureMode = 'normal';
	equal((await migration(mixedPartialRestart)).status, 'resumed');
	deepEqual(
		mixedPartialRestart.sourceProcessPaths.slice(processesBeforeMixedResume),
		['Tables/Last.table', 'Tables/Middle.table'],
		'An already-exact candidate must receive zero source CAS attempts during restart; only retained exact source may resume.',
	);

	for (const [failureAt, label] of [[1, 'first'], [2, 'middle'], [3, 'last']] as const) {
		const interrupted = new MigrationMemoryAdapter({
			'Tables/First.table': legacySource(1, `interrupted-${label}-first`),
			'Tables/Middle.table': legacySource(2, `interrupted-${label}-middle`),
			'Tables/Last.table': legacySource(2, `interrupted-${label}-last`),
		});
		interrupted.sourceFailureAt = failureAt;
		interrupted.sourceFailureMode = 'throw-before';
		await expectBlocked(() => migration(interrupted), 'target-previous');
		equal(migrationPaths(interrupted).some(filePath => filePath.endsWith('/active.json')), true, `${label} interruption must retain the active marker.`);
		interrupted.sourceFailureAt = null;
		interrupted.sourceFailureMode = 'normal';
		equal((await migration(interrupted)).status, 'resumed');
		equal(migrationPaths(interrupted).some(filePath => filePath.endsWith('/active.json')), false);
		for (const filePath of interrupted.tablePaths) equal((JSON.parse(await interrupted.read(filePath)) as { version: number }).version, 3);
	}

	const unreadableAcknowledgement = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'readback-loss') });
	unreadableAcknowledgement.readFailureAfterSourceProcessPath = 'Tables/Legacy.table';
	await expectBlocked(() => migration(unreadableAcknowledgement), 'target-unreadable');
	unreadableAcknowledgement.readFailureAfterSourceProcessPath = null;
	equal((await migration(unreadableAcknowledgement)).status, 'resumed', 'A source write with unreadable acknowledgement must only resume from exact candidate evidence.');

	const candidateVerificationUnreadable = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'candidate-verify-readback') });
	candidateVerificationUnreadable.readFailureAfterSourceProcessPath = 'Tables/Legacy.table';
	candidateVerificationUnreadable.readFailureAfterSourceProcessCount = 2;
	await expectBlocked(() => migration(candidateVerificationUnreadable), 'candidate-unreadable');
	const candidateVerificationProcesses = candidateVerificationUnreadable.sourceProcessCalls;
	candidateVerificationUnreadable.readFailureAfterSourceProcessPath = null;
	equal((await migration(candidateVerificationUnreadable)).status, 'resumed');
	equal(candidateVerificationUnreadable.sourceProcessCalls, candidateVerificationProcesses, 'Post-ack verification recovery must not replay an exact candidate CAS.');

	const postAckDivergence = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'post-ack-divergence') });
	postAckDivergence.sourceFailureAt = 1;
	postAckDivergence.sourceFailureMode = 'post-ack-diverge';
	await expectBlocked(() => migration(postAckDivergence), 'target-divergent');

	const actualCasMismatch = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'actual-cas-mismatch') });
	actualCasMismatch.sourceFailureAt = 1;
	actualCasMismatch.sourceFailureMode = 'cas-mismatch';
	await expectBlocked(() => migration(actualCasMismatch), 'cas-mismatch');

	const divergent = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'divergent') });
	divergent.sourceFailureAt = 1;
	divergent.sourceFailureMode = 'diverge-then-throw';
	await expectBlocked(() => migration(divergent), 'target-divergent');
	divergent.sourceFailureAt = null;
	divergent.sourceFailureMode = 'normal';
	await expectBlocked(() => migration(divergent), 'marker-source-divergent');

	const sourceMissingOnResume = await buildInterruptedMigrationAdapter('source-missing-on-resume');
	sourceMissingOnResume.tablePaths.splice(0, sourceMissingOnResume.tablePaths.length);
	await expectBlocked(() => migration(sourceMissingOnResume), 'marker-source-missing');

	const sourceUnreadableOnResume = await buildInterruptedMigrationAdapter('source-unreadable-on-resume');
	sourceUnreadableOnResume.unreadablePaths.add('Tables/Legacy.table');
	await expectBlocked(() => migration(sourceUnreadableOnResume), 'marker-source-unreadable');

	const missingBackupOnResume = await buildInterruptedMigrationAdapter('missing-backup-on-resume');
	missingBackupOnResume.files.delete(migrationPaths(missingBackupOnResume).find(filePath => filePath.includes('/backups/'))!);
	await expectBlocked(() => migration(missingBackupOnResume), 'backup-missing');

	const unreadableBackupOnResume = await buildInterruptedMigrationAdapter('unreadable-backup-on-resume');
	unreadableBackupOnResume.unreadablePaths.add(migrationPaths(unreadableBackupOnResume).find(filePath => filePath.includes('/backups/'))!);
	await expectBlocked(() => migration(unreadableBackupOnResume), 'backup-unreadable');

	const mismatchedBackupOnResume = await buildInterruptedMigrationAdapter('mismatched-backup-on-resume');
	mismatchedBackupOnResume.files.set(migrationPaths(mismatchedBackupOnResume).find(filePath => filePath.includes('/backups/'))!, 'tampered backup');
	await expectBlocked(() => migration(mismatchedBackupOnResume), 'backup-mismatch');

	const candidateRecomputationMismatch = await buildInterruptedMigrationAdapter('candidate-recompute-mismatch');
	await resealMarker(candidateRecomputationMismatch, marker => {
		marker.targets[0].candidateSha256 = 'f'.repeat(64);
	});
	await expectBlocked(() => migration(candidateRecomputationMismatch), 'marker-candidate-mismatch');

	const finalizationLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'finalize-loss') });
	finalizationLoss.removeFailurePath = '/active.json';
	equal((await migration(finalizationLoss)).status, 'migrated');
	equal(await finalizationLoss.read(activeMarkerPath(finalizationLoss)), '');
	const processesBeforeFinalizeResume = finalizationLoss.sourceProcessCalls;
	finalizationLoss.removeFailurePath = null;
	equal((await migration(finalizationLoss)).status, 'not-needed', 'A CAS-finalized empty marker must not replay source CAS.');
	equal(finalizationLoss.sourceProcessCalls, processesBeforeFinalizeResume);

	const receiptAcknowledgementLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'receipt-ack-loss') });
	receiptAcknowledgementLoss.renameCommitThenThrowPath = '/receipts/';
	equal((await migration(receiptAcknowledgementLoss)).status, 'migrated', 'Exact receipt readback must recover a commit-then-error receipt write.');

	const receiptBeforeCommit = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'receipt-before') });
	receiptBeforeCommit.renameFailurePath = '/receipts/';
	await expectBlocked(() => migration(receiptBeforeCommit), 'write-unacknowledged');
	equal(migrationPaths(receiptBeforeCommit).some(filePath => filePath.endsWith('/active.json')), true, 'Receipt failure must retain the marker for restart recovery.');
	assertNoMigrationTemporaryFiles(receiptBeforeCommit);
	receiptBeforeCommit.renameFailurePath = null;
	equal((await migration(receiptBeforeCommit)).status, 'resumed');

	const invalidReceipt = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'invalid-receipt') });
	invalidReceipt.renameFailurePath = '/receipts/';
	await expectBlocked(() => migration(invalidReceipt), 'write-unacknowledged');
	const invalidReceiptMarker = JSON.parse(await invalidReceipt.read(activeMarkerPath(invalidReceipt))) as { transactionSha256: string };
	invalidReceipt.files.set(`.obsidian/plugins/operon/state/table-file-v3-migration/receipts/${invalidReceiptMarker.transactionSha256}.json`, '{');
	invalidReceipt.renameFailurePath = null;
	const invalidReceiptProcesses = invalidReceipt.sourceProcessCalls;
	await expectBlocked(() => migration(invalidReceipt), 'receipt-invalid');
	equal(invalidReceipt.sourceProcessCalls, invalidReceiptProcesses, 'Invalid receipts must block without replaying a candidate CAS.');

	const mismatchedReceipt = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'mismatched-receipt') });
	mismatchedReceipt.renameFailurePath = '/receipts/';
	await expectBlocked(() => migration(mismatchedReceipt), 'write-unacknowledged');
	const mismatchedReceiptMarker = JSON.parse(await mismatchedReceipt.read(activeMarkerPath(mismatchedReceipt))) as MutableMigrationMarker;
	const mismatchedReceiptPath = `.obsidian/plugins/operon/state/table-file-v3-migration/receipts/${mismatchedReceiptMarker.transactionSha256}.json`;
	const mismatchedReceiptValue = await buildTestReceipt(mismatchedReceiptMarker);
	mismatchedReceiptValue.markerSha256 = 'e'.repeat(64);
	mismatchedReceipt.files.set(mismatchedReceiptPath, `${JSON.stringify(mismatchedReceiptValue, null, '\t')}\n`);
	mismatchedReceipt.renameFailurePath = null;
	const mismatchReceiptProcesses = mismatchedReceipt.sourceProcessCalls;
	await expectBlocked(() => migration(mismatchedReceipt), 'receipt-mismatch');
	equal(mismatchedReceipt.sourceProcessCalls, mismatchReceiptProcesses, 'Mismatched receipts must block without source replay.');

	const markerAckLoss = new MigrationMemoryAdapter({ 'Tables/Legacy.table': legacySource(2, 'marker-ack-loss') });
	markerAckLoss.removeCommitThenThrowPath = '/active.json';
	equal((await migration(markerAckLoss)).status, 'migrated', 'An observed marker removal must recover an acknowledgement loss only after receipt persistence.');

	const sanitizedRoot = await mkdtemp(path.join(tmpdir(), 'operon-table-file-v3-migration-'));
	const sealedPreimageRoot = await mkdtemp(path.join(tmpdir(), 'operon-table-file-v3-sealed-'));
	try {
		const disk = new MigrationDiskAdapter(sanitizedRoot);
		const exactV3 = `${v3Source('disk-v3')}\n`;
		const tableSources = new Map<string, string>([
			['Tables/One.table', legacySource(1, 'disk-one', 'disk-filter-one')],
			['Tables/Two.table', legacySource(2, 'disk-two', 'disk-filter-two')],
			['Tables/Three.table', exactV3],
		]);
		const unrelatedSources = new Map<string, string>([
			['Filters/Keep.filter', JSON.stringify({ id: 'disk-filter-one', conditions: [{ field: 'taskType', operator: 'is', value: 'kept' }] })],
			['Notes/Keep.md', '# Keep\nUnrelated fixture note.\n'],
		]);
		for (const [filePath, source] of [...tableSources, ...unrelatedSources]) await disk.write(filePath, source);
		const sealedPreimage = new Map<string, { source: string; sha256: string }>();
		for (const [filePath, source] of [...tableSources, ...unrelatedSources]) {
			sealedPreimage.set(filePath, { source, sha256: await sha256HexForStorage(source) });
		}
		await writeFile(
			path.join(sealedPreimageRoot, 'sealed-preimage.json'),
			JSON.stringify(Object.fromEntries(sealedPreimage), null, 2),
			'utf8',
		);
		const diskFiles = [...tableSources.keys()].map(filePath => ({ path: filePath }));
		const registry = new TablePresetRegistry<TestTableFile>({
			loadFileBindings: () => [],
			listTableFiles: () => diskFiles,
			readTableFile: file => disk.read(file.path),
			applyPatch: preset => preset,
		});
		let refreshes = 0;
		disk.mutations.length = 0;
		const diskResult = await migrateOperonTableFilesBeforeRegistryRefresh({
			adapter: disk,
			configDir: '.obsidian',
			listTableFiles: () => diskFiles,
			readTableFile: file => disk.read(file.path),
			processTableFile: (file, transform) => disk.processTable(file, transform),
		}, async () => {
			refreshes += 1;
			await registry.refresh();
		});
		equal(diskResult.status, 'migrated', 'A sanitized disk fixture must execute the shared startup migration transaction.');
		equal(refreshes, 1, 'The real Table preset registry refresh must follow the shared migration helper exactly once.');
		equal(registry.getPreset('disk-one')?.id, 'disk-one', 'Registry discovery must see the migrated V3 table on first startup.');
		equal(await disk.read('Tables/Three.table'), exactV3, 'Existing V3 table bytes must survive startup migration exactly.');
		for (const filePath of ['Tables/One.table', 'Tables/Two.table']) {
			const migrated = JSON.parse(await disk.read(filePath)) as { version: number; filterSetId: string };
			equal(migrated.version, 3);
			equal(migrated.filterSetId, filePath === 'Tables/One.table' ? 'disk-filter-one' : 'disk-filter-two');
		}
		for (const [filePath, sealed] of unrelatedSources) equal(await disk.read(filePath), sealed, `Unrelated ${filePath} bytes must remain unchanged.`);
		const receiptNames = await readdir(path.join(sanitizedRoot, '.obsidian/plugins/operon/state/table-file-v3-migration/receipts'));
		equal(receiptNames.length, 1, 'Sanitized startup must retain exactly one durable receipt.');
		const receiptPath = `.obsidian/plugins/operon/state/table-file-v3-migration/receipts/${receiptNames[0]}`;
		const diskAllowlist = await buildExactMigrationMutationAllowlist('.obsidian', receiptPath, filePath => disk.read(filePath));
		assertMutationsUseExactMigrationAllowlist(disk.mutations, diskAllowlist);
		ok(!disk.mutations.some(mutation => mutation.path.endsWith('/data.json') || mutation.nextPath?.endsWith('/data.json')), 'Disk startup migration must not write the settings data package.');
		const firstStartupMutations = disk.mutations.length;
		const firstStartupProcesses = disk.sourceProcessCalls;
		const secondDiskResult = await migrateOperonTableFilesBeforeRegistryRefresh({
			adapter: disk,
			configDir: '.obsidian',
			listTableFiles: () => diskFiles,
			readTableFile: file => disk.read(file.path),
			processTableFile: (file, transform) => disk.processTable(file, transform),
		}, async () => {
			refreshes += 1;
			await registry.refresh();
		});
		equal(secondDiskResult.status, 'not-needed');
		equal(refreshes, 2, 'Second startup must still refresh the existing Table registry after a no-op migration check.');
		equal(disk.mutations.length, firstStartupMutations, 'Second startup must perform zero source or migration-state writes.');
		equal(disk.sourceProcessCalls, firstStartupProcesses, 'Second startup must perform zero Table source CAS writes.');
		const diskPaths = await listDiskPaths(sanitizedRoot);
		deepEqual(
			diskPaths.filter(filePath => filePath.includes('.tmp-') || filePath.includes('.replace-backup')),
			[],
			'Sanitized startup must not retain atomic temporary or replacement-backup files.',
		);
		const receipt = JSON.parse(await disk.read(receiptPath)) as MutableMigrationReceipt;
		for (const target of receipt.targets) {
			const current = await disk.read(target.path);
			equal(await sha256HexForStorage(current), target.candidateSha256, 'Test-only restore may proceed only from an exact candidate.');
			const backup = await disk.read(target.backupPath);
			await disk.processTable({ path: target.path }, source => {
				if (source !== current) throw new Error(`Conditional restore source changed: ${target.path}`);
				return backup;
			});
		}
		for (const [filePath, sealed] of sealedPreimage) {
			equal(await disk.read(filePath), sealed.source, `Test-only conditional restore must exactly restore ${filePath}.`);
			equal(await sha256HexForStorage(await disk.read(filePath)), sealed.sha256, `Restored preimage hash must match for ${filePath}.`);
		}
	} finally {
		await rm(sanitizedRoot, { recursive: true, force: true });
		await rm(sealedPreimageRoot, { recursive: true, force: true });
	}

	const mainSource = await readFile(path.join(process.cwd(), 'main.ts'), 'utf8');
	const initializeIndex = mainSource.indexOf('private async initializeTablePresetRegistry(): Promise<void>');
	const migrationIndex = mainSource.indexOf('await migrateOperonTableFilesBeforeRegistryRefresh({', initializeIndex);
	const refreshIndex = mainSource.indexOf('await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });', migrationIndex);
	ok(migrationIndex > initializeIndex && refreshIndex > migrationIndex, 'V3 migration must run through the shared startup helper before the first Table registry refresh.');

	console.log(`Table file V3 migration tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableFileV3MigrationTestRun: Promise<void> | undefined;
}

globalThis.__operonTableFileV3MigrationTestRun = run();
