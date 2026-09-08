import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { App } from 'obsidian';
import { DeveloperApiGrantControllerV1 } from '../../../src/agent-runtime/developer-api/grant-controller';
import {
	approveDeveloperApiCapabilities,
	createEmptyDeveloperApiGrantPackage,
	evaluateDeveloperApiGrant,
	normalizeDeveloperApiGrantPackage,
	recordDeveloperApiGrantRequest,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
	type DeveloperApiConsumerDescriptorV1,
	type DeveloperApiGrantPackageV1,
} from '../../../src/agent-runtime/developer-api/grants';
import {
	buildOperonDataPackageFromSettings,
	type OperonDataPackageV1,
} from '../../../src/storage/operon-data-package';
import { OperonStorage } from '../../../src/storage/operon-storage';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

const NOW = '2026-08-06T12:00:00.000Z';
const LATER = '2026-08-06T12:01:00.000Z';
const CONFIG_DIR = '.obsidian';
const CANONICAL_DATA_PATH = `${CONFIG_DIR}/plugins/operon/data.json`;

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function stableHash(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function consumer(id: string, version = '1.2.3'): DeveloperApiConsumerDescriptorV1 {
	return {
		id,
		name: `Consumer ${id}`,
		version,
		instanceEpoch: `instance-${id}`,
	};
}

function activeGrant(
	grantPackage = createEmptyDeveloperApiGrantPackage(),
	id = 'consumer.active',
): DeveloperApiGrantPackageV1 {
	return approveDeveloperApiCapabilities(
		grantPackage,
		consumer(id),
		['tasks.read'],
		NOW,
	);
}

function pendingCapabilityGrant(): DeveloperApiGrantPackageV1 {
	return recordDeveloperApiGrantRequest(
		activeGrant(),
		consumer('consumer.active'),
		['tasks.read', 'tasks.query'],
		LATER,
	);
}

function suspendedGrant(): DeveloperApiGrantPackageV1 {
	const active = activeGrant();
	const revision = active.consumersById['consumer.active']?.revision ?? -1;
	return suspendDeveloperApiGrantForAuditRecovery(
		active,
		'consumer.active',
		revision,
		LATER,
	);
}

function revokedGrant(): DeveloperApiGrantPackageV1 {
	return revokeDeveloperApiGrant(activeGrant(), 'consumer.active', LATER);
}

const EMPTY_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {},
};
const ACTIVE_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {
		'consumer.active': {
			consumerId: 'consumer.active',
			consumerName: 'Active Consumer',
			consumerVersion: '1.2.3',
			approvedMajorVersion: 1,
			state: 'active',
			revision: 1,
			grantedCapabilities: ['tasks.read'],
			pendingCapabilities: [],
			createdAt: NOW,
			updatedAt: NOW,
		},
	},
};
const PENDING_CAPABILITY_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {
		'consumer.pending': {
			consumerId: 'consumer.pending',
			consumerName: 'Pending Consumer',
			consumerVersion: '1.2.3',
			approvedMajorVersion: 1,
			state: 'active',
			revision: 1,
			grantedCapabilities: ['tasks.read'],
			pendingCapabilities: ['tasks.query'],
			createdAt: NOW,
			updatedAt: LATER,
		},
	},
};
const SUSPENDED_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {
		'consumer.suspended': {
			consumerId: 'consumer.suspended',
			consumerName: 'Suspended Consumer',
			consumerVersion: '1.2.3',
			approvedMajorVersion: 1,
			state: 'suspended',
			suspensionReason: 'audit-activation-incomplete',
			revision: 2,
			grantedCapabilities: ['tasks.read'],
			pendingCapabilities: ['tasks.read'],
			createdAt: NOW,
			updatedAt: LATER,
		},
	},
};
const REVOKED_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {
		'consumer.revoked': {
			consumerId: 'consumer.revoked',
			consumerName: 'Revoked Consumer',
			consumerVersion: '1.2.3',
			approvedMajorVersion: 1,
			state: 'revoked',
			revision: 2,
			grantedCapabilities: ['tasks.read'],
			pendingCapabilities: [],
			createdAt: NOW,
			updatedAt: LATER,
		},
	},
};
const MULTI_CONSUMER_GRANT: DeveloperApiGrantPackageV1 = {
	version: 1,
	consumersById: {
		...ACTIVE_GRANT.consumersById,
		...PENDING_CAPABILITY_GRANT.consumersById,
		...REVOKED_GRANT.consumersById,
		...SUSPENDED_GRANT.consumersById,
	},
};

function packageWithGrant(grantPackage: DeveloperApiGrantPackageV1): OperonDataPackageV1 {
	return buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: grantPackage,
	});
}

interface SaveGate {
	readonly started: Promise<void>;
	release(): void;
}

class DurablePluginData {
	private failNext = false;
	private failNextPublication = false;
	private nextGate: {
		started(): void;
		wait: Promise<void>;
	} | null = null;
	readonly writes: OperonDataPackageV1[] = [];
	readonly rootPath: string;
	readonly dataPath: string;
	readonly initialSha256: string;
	readonly operations: string[] = [];

	constructor(initial: OperonDataPackageV1) {
		this.rootPath = mkdtempSync(path.join(tmpdir(), 'operon-pr118-persistence-'));
		this.dataPath = path.join(this.rootPath, CONFIG_DIR, 'plugins', 'operon', 'data.json');
		mkdirSync(path.dirname(this.dataPath), { recursive: true });
		const initialBytes = `${JSON.stringify(initial, null, '\t')}\n`;
		writeFileSync(this.dataPath, initialBytes, 'utf8');
		this.initialSha256 = createHash('sha256').update(initialBytes).digest('hex');
	}

	readonly loadData = async (): Promise<OperonDataPackageV1> => this.snapshot();

	readonly saveData = async (candidate: unknown): Promise<void> => {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('injected plugin-data save failure');
		}
		const gate = this.nextGate;
		this.nextGate = null;
		if (gate) {
			gate.started();
			await gate.wait;
		}
		const next = clone(candidate as OperonDataPackageV1);
		const temporaryPath = `${this.dataPath}.tmp`;
		writeFileSync(temporaryPath, `${JSON.stringify(next, null, '\t')}\n`, 'utf8');
		this.operations.push(`plugin-write:${this.relativePath(temporaryPath)}`);
		if (this.failNextPublication) {
			this.failNextPublication = false;
			rmSync(temporaryPath, { force: true });
			throw new Error('injected plugin-data publication failure');
		}
		renameSync(temporaryPath, this.dataPath);
		this.operations.push(`plugin-rename:${this.relativePath(temporaryPath)}->${this.relativePath(this.dataPath)}`);
		this.writes.push(clone(next));
	};

	failNextSave(): void {
		this.failNext = true;
	}

	failNextSavePublication(): void {
		this.failNextPublication = true;
	}

	deferNextSave(): SaveGate {
		let signalStarted!: () => void;
		let release!: () => void;
		const started = new Promise<void>(resolve => {
			signalStarted = resolve;
		});
		const wait = new Promise<void>(resolve => {
			release = resolve;
		});
		this.nextGate = { started: signalStarted, wait };
		return { started, release };
	}

	snapshot(): OperonDataPackageV1 {
		return JSON.parse(readFileSync(this.dataPath, 'utf8')) as OperonDataPackageV1;
	}

	bytesSha256(): string {
		return createHash('sha256').update(readFileSync(this.dataPath)).digest('hex');
	}

	canonicalBytes(): string {
		return readFileSync(this.dataPath, 'utf8');
	}

	replaceCanonicalPackage(candidate: OperonDataPackageV1): void {
		writeFileSync(this.dataPath, `${JSON.stringify(candidate, null, '\t')}\n`, 'utf8');
		this.operations.push(`external-write:${this.relativePath(this.dataPath)}`);
	}

	replaceCanonicalRaw(bytes: string): void {
		writeFileSync(this.dataPath, bytes, 'utf8');
		this.operations.push(`external-write:${this.relativePath(this.dataPath)}`);
	}

	listFiles(): string[] {
		const files: string[] = [];
		const visit = (directory: string): void => {
			for (const entry of readdirSync(directory)) {
				const absolute = path.join(directory, entry);
				if (statSync(absolute).isDirectory()) visit(absolute);
				else files.push(this.relativePath(absolute));
			}
		};
		visit(this.rootPath);
		return files.sort();
	}

	assertNoTemporaryFiles(): void {
		assert.equal(
			this.listFiles().some(file => file.includes('.tmp') || file.includes('.replace-backup')),
			false,
		);
	}

	resolveVaultPath(vaultPath: string): string {
		const absolute = path.resolve(this.rootPath, ...vaultPath.split('/'));
		const relative = path.relative(this.rootPath, absolute);
		assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`));
		return absolute;
	}

	relativePath(absolutePath: string): string {
		return path.relative(this.rootPath, absolutePath).split(path.sep).join('/');
	}

	dispose(): void {
		rmSync(this.rootPath, { recursive: true, force: true });
	}
}

function disposeAfterTest(testContext: unknown, durable: DurablePluginData): void {
	(testContext as { after(callback: () => void): void }).after(() => durable.dispose());
}

function assertAllowedFixtureFiles(
	durable: DurablePluginData,
	allowBackups = false,
	allowExternalWrites = false,
): void {
	const files = durable.listFiles();
	assert.ok(files.includes(CANONICAL_DATA_PATH));
	for (const file of files) {
		assert.ok(
			file === CANONICAL_DATA_PATH
				|| (allowBackups && /^\.obsidian\/plugins\/operon\/data\.json\.invalid-\d+\.bak$/u.test(file)),
			`unexpected fixture file: ${file}`,
		);
	}
	for (const operation of durable.operations) {
		const canonical = CANONICAL_DATA_PATH.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
		const backup = `${canonical}\\.invalid-\\d+\\.bak`;
		const backupTemporary = `${backup}\\.tmp-\\d+-[a-z0-9]+`;
		const allowed = [
			/^mkdir:\.obsidian\/plugins\/operon\/(?:state|runtime|cache)$/u,
			new RegExp(`^plugin-write:${canonical}\\.tmp$`, 'u'),
			new RegExp(`^plugin-rename:${canonical}\\.tmp->${canonical}$`, 'u'),
		];
		if (allowBackups) {
			allowed.push(
				new RegExp(`^write:(?:${backup}|${backupTemporary})$`, 'u'),
				new RegExp(`^remove:(?:${backup}|${backupTemporary})$`, 'u'),
				new RegExp(`^rename:${backupTemporary}->${backup}$`, 'u'),
			);
		}
		if (allowExternalWrites) {
			allowed.push(new RegExp(`^external-write:${canonical}$`, 'u'));
		}
		assert.ok(allowed.some(pattern => pattern.test(operation)), `unexpected fixture operation: ${operation}`);
	}
	durable.assertNoTemporaryFiles();
}

class FileBackedVaultAdapter {
	private failWrite: ((path: string) => boolean) | null = null;
	private failRead: ((path: string) => boolean) | null = null;
	private corruptWrite: ((path: string) => boolean) | null = null;
	private failRename: ((from: string, to: string) => boolean) | null = null;

	constructor(private readonly durable: DurablePluginData) {}

	async exists(path: string): Promise<boolean> {
		return existsSync(this.durable.resolveVaultPath(path));
	}

	async mkdir(path: string): Promise<void> {
		mkdirSync(this.durable.resolveVaultPath(path));
		this.durable.operations.push(`mkdir:${path}`);
	}

	async read(path: string): Promise<string> {
		if (this.failRead?.(path)) {
			this.failRead = null;
			throw new Error(`injected adapter read failure: ${path}`);
		}
		return readFileSync(this.durable.resolveVaultPath(path), 'utf8');
	}

	async write(path: string, data: string): Promise<void> {
		if (this.failWrite?.(path)) {
			this.failWrite = null;
			throw new Error(`injected adapter write failure: ${path}`);
		}
		const corrupt = this.corruptWrite?.(path) === true;
		if (corrupt) this.corruptWrite = null;
		writeFileSync(this.durable.resolveVaultPath(path), corrupt ? `${data}corrupt` : data, 'utf8');
		this.durable.operations.push(`write:${path}`);
	}

	async remove(path: string): Promise<void> {
		rmSync(this.durable.resolveVaultPath(path), { force: true });
		this.durable.operations.push(`remove:${path}`);
	}

	async rename(from: string, to: string): Promise<void> {
		if (this.failRename?.(from, to)) {
			this.failRename = null;
			throw new Error(`injected adapter rename failure: ${from}->${to}`);
		}
		renameSync(this.durable.resolveVaultPath(from), this.durable.resolveVaultPath(to));
		this.durable.operations.push(`rename:${from}->${to}`);
	}

	async process(path: string, callback: (data: string) => string): Promise<string> {
		const next = callback(await this.read(path));
		await this.write(path, next);
		return next;
	}

	failNextWriteMatching(predicate: (path: string) => boolean): void {
		this.failWrite = predicate;
	}

	failNextReadMatching(predicate: (path: string) => boolean): void {
		this.failRead = predicate;
	}

	corruptNextWriteMatching(predicate: (path: string) => boolean): void {
		this.corruptWrite = predicate;
	}

	failNextRenameMatching(predicate: (from: string, to: string) => boolean): void {
		this.failRename = predicate;
	}
}

function createStorage(durable: DurablePluginData, adapter: FileBackedVaultAdapter): OperonStorage {
	const app = {
		locale: 'en',
		vault: {
			configDir: CONFIG_DIR,
			adapter,
			getFiles: () => [],
		},
	} as unknown as App;
	return new OperonStorage(app, {
		loadData: durable.loadData,
		saveData: durable.saveData,
	});
}

async function initializeStorage(
	durable: DurablePluginData,
	adapter: FileBackedVaultAdapter,
): Promise<OperonStorage> {
	const storage = createStorage(durable, adapter);
	await storage.initialize();
	await storage.flushPendingWrites();
	return storage;
}

async function replaceGrant(
	storage: OperonStorage,
	grantPackage: DeveloperApiGrantPackageV1,
): Promise<void> {
	await storage.getDeveloperApiGrantDataStore().updateDataPackage(current => ({
		...current,
		integrations: {
			...current.integrations,
			developerApi: clone(grantPackage),
		},
	}));
}

const grantFixtures: ReadonlyArray<{
	readonly name: string;
	readonly grantPackage: DeveloperApiGrantPackageV1;
	readonly initialSha256: string;
}> = [
	{ name: 'empty', grantPackage: EMPTY_GRANT, initialSha256: '13f313ca8c124bb4332ce049cc18b2e72df33adcb6afa5aa98bf581ee32b0b25' },
	{ name: 'active', grantPackage: ACTIVE_GRANT, initialSha256: 'a63a9eef16e2338424c51a78c083b42ccf75b564071852ae6904ff7192f6608e' },
	{ name: 'pending-capability', grantPackage: PENDING_CAPABILITY_GRANT, initialSha256: 'a54ea87aa2093632ffdcdfba46599d24eb2de5810e6325e47e35351ade482b17' },
	{ name: 'suspended', grantPackage: SUSPENDED_GRANT, initialSha256: 'e31946b2748f7286ebb6ccd8c10bd07985d0cf53e4f937cfbec2310a841ec61c' },
	{ name: 'revoked', grantPackage: REVOKED_GRANT, initialSha256: 'd227f4202a5d76534ec8f075f2f4915689ae78ca6febcb9b9cf92ef497f07776' },
	{ name: 'multi-consumer', grantPackage: MULTI_CONSUMER_GRANT, initialSha256: 'c1ce5fd350dd87dfb1955f37d246a15774c71ed63f6f2a81cc59fbc68754117d' },
];

function assertGrantSemantics(name: string, grantPackage: DeveloperApiGrantPackageV1): void {
	if (name === 'empty') {
		assert.equal(evaluateDeveloperApiGrant(grantPackage, consumer('consumer.missing'), ['tasks.read']).state, 'pending');
		return;
	}
	if (name === 'active' || name === 'multi-consumer') {
		assert.equal(evaluateDeveloperApiGrant(grantPackage, consumer('consumer.active'), ['tasks.read']).state, 'active');
	}
	if (name === 'pending-capability' || name === 'multi-consumer') {
		const pending = evaluateDeveloperApiGrant(
			grantPackage,
			consumer('consumer.pending'),
			['tasks.read', 'tasks.query'],
		);
		assert.equal(pending.state, 'pending');
		assert.deepEqual(pending.pendingCapabilities, ['tasks.query']);
	}
	if (name === 'suspended' || name === 'multi-consumer') {
		const suspended = evaluateDeveloperApiGrant(grantPackage, consumer('consumer.suspended'), ['tasks.read']);
		assert.equal(suspended.state, 'suspended');
		assert.equal(suspended.reason, 'audit-activation-incomplete');
		assert.deepEqual(suspended.effectiveCapabilities, []);
	}
	if (name === 'revoked' || name === 'multi-consumer') {
		const revoked = evaluateDeveloperApiGrant(grantPackage, consumer('consumer.revoked'), ['tasks.read']);
		assert.equal(revoked.state, 'revoked');
		assert.deepEqual(
			recordDeveloperApiGrantRequest(
				grantPackage,
				consumer('consumer.revoked'),
				['tasks.query'],
				LATER,
			),
			grantPackage,
		);
	}
}

for (const { name, grantPackage, initialSha256 } of grantFixtures) {
	test(`preserves ${name} Developer API grants across settings save and two clean restarts`, async t => {
		assert.deepEqual(normalizeDeveloperApiGrantPackage(grantPackage), grantPackage);
		assertGrantSemantics(name, grantPackage);
		const durable = new DurablePluginData(packageWithGrant(grantPackage));
		disposeAfterTest(t, durable);
		assert.equal(durable.initialSha256, initialSha256);
		const adapter = new FileBackedVaultAdapter(durable);
		const first = await initializeStorage(durable, adapter);
		const baselineWrites = durable.writes.length;
		assert.equal(baselineWrites, 1);
		assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);

		await first.updateSettings({ demoWorkspacePromptDismissed: true });
		await first.flushPendingWrites();
		assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
		assert.equal(durable.snapshot().settings.demoWorkspacePromptDismissed, true);
		assert.equal(durable.writes.length, baselineWrites + 1);
		const committedHash = stableHash(durable.snapshot());
		const committedBytesHash = durable.bytesSha256();
		first.destroy();

		const writesBeforeSecond = durable.writes.length;
		const second = await initializeStorage(durable, adapter);
		assert.equal(durable.writes.length, writesBeforeSecond);
		assert.equal(stableHash(durable.snapshot()), committedHash);
		assert.equal(durable.bytesSha256(), committedBytesHash);
		assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
		second.destroy();

		const writesBeforeThird = durable.writes.length;
		const third = await initializeStorage(durable, adapter);
		assert.equal(durable.writes.length, writesBeforeThird);
		assert.equal(stableHash(durable.snapshot()), committedHash);
		assert.equal(durable.bytesSha256(), committedBytesHash);
		assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
		third.destroy();

		assertAllowedFixtureFiles(durable);
	});
}

test('serializes a grant mutation before an in-flight settings save without losing either change', async t => {
	const durable = new DurablePluginData(packageWithGrant(activeGrant()));
	const adapter = new FileBackedVaultAdapter(durable);
	let storage: OperonStorage | null = null;
	let gate: SaveGate | null = null;
	(t as unknown as { after(callback: () => Promise<void>): void }).after(async () => {
		gate?.release();
		try {
			await storage?.flushPendingWrites();
		} catch {
			// The test assertion owns the original failure; cleanup must still finish.
		}
		storage?.destroy();
		durable.assertNoTemporaryFiles();
		durable.dispose();
	});
	storage = await initializeStorage(durable, adapter);
	const nextGrant = activeGrant(durable.snapshot().integrations.developerApi, 'consumer.second');
	gate = durable.deferNextSave();
	const grantSave = replaceGrant(storage, nextGrant);
	await gate.started;
	const settingsSave = storage.updateSettings({ demoWorkspacePromptDismissed: true });
	gate.release();
	await Promise.all([grantSave, settingsSave]);
	await storage.flushPendingWrites();

	assert.deepEqual(durable.snapshot().integrations.developerApi, nextGrant);
	assert.equal(durable.snapshot().settings.demoWorkspacePromptDismissed, true);
	storage.destroy();

	const restarted = await initializeStorage(durable, adapter);
	assert.deepEqual(durable.snapshot().integrations.developerApi, nextGrant);
	assert.equal(restarted.getSettings().demoWorkspacePromptDismissed, true);
	restarted.destroy();
	assertAllowedFixtureFiles(durable);
});

test('serializes a grant mutation after an in-flight settings save without restoring a stale grant', async t => {
	const durable = new DurablePluginData(packageWithGrant(activeGrant()));
	const adapter = new FileBackedVaultAdapter(durable);
	let storage: OperonStorage | null = null;
	let gate: SaveGate | null = null;
	(t as unknown as { after(callback: () => Promise<void>): void }).after(async () => {
		gate?.release();
		try {
			await storage?.flushPendingWrites();
		} catch {
			// The test assertion owns the original failure; cleanup must still finish.
		}
		storage?.destroy();
		durable.assertNoTemporaryFiles();
		durable.dispose();
	});
	storage = await initializeStorage(durable, adapter);
	const nextGrant = activeGrant(durable.snapshot().integrations.developerApi, 'consumer.second');
	gate = durable.deferNextSave();
	const settingsSave = storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await gate.started;
	const grantSave = replaceGrant(storage, nextGrant);
	gate.release();
	await Promise.all([settingsSave, grantSave]);
	await storage.flushPendingWrites();

	assert.deepEqual(durable.snapshot().integrations.developerApi, nextGrant);
	assert.equal(durable.snapshot().settings.demoWorkspacePromptDismissed, true);
	storage.destroy();
	assertAllowedFixtureFiles(durable);
});

test('keeps the data-package queue usable after a settings save failure and exact retry', async t => {
	const grantPackage = pendingCapabilityGrant();
	const initial = packageWithGrant(grantPackage);
	const durable = new DurablePluginData(initial);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const sealedHash = stableHash(durable.snapshot());
	const writesBeforeFailure = durable.writes.length;

	storage.getSettings().demoWorkspacePromptDismissed = false;
	durable.failNextSave();
	await assert.rejects(
		storage.updateSettings({ demoWorkspacePromptDismissed: true }),
		/injected plugin-data save failure/u,
	);
	assert.equal(storage.getSettings().demoWorkspacePromptDismissed, false);
	assert.equal(stableHash(durable.snapshot()), sealedHash);
	assert.equal(durable.writes.length, writesBeforeFailure);

	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.equal(durable.snapshot().settings.demoWorkspacePromptDismissed, true);
	assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
	storage.destroy();

	const restarted = await initializeStorage(durable, adapter);
	assert.equal(restarted.getSettings().demoWorkspacePromptDismissed, true);
	assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
	restarted.destroy();
	assertAllowedFixtureFiles(durable);
});

test('recovers cleanly when plugin data publication is interrupted before rename', async t => {
	const initial = packageWithGrant(PENDING_CAPABILITY_GRANT);
	const durable = new DurablePluginData(initial);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const sealedHash = durable.bytesSha256();
	durable.failNextSavePublication();

	await assert.rejects(
		storage.updateSettings({ demoWorkspacePromptDismissed: true }),
		/injected plugin-data publication failure/u,
	);
	assert.equal(durable.bytesSha256(), sealedHash);
	durable.assertNoTemporaryFiles();
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.equal(durable.snapshot().settings.demoWorkspacePromptDismissed, true);
	assert.deepEqual(durable.snapshot().integrations.developerApi, PENDING_CAPABILITY_GRANT);
	storage.destroy();
	assertAllowedFixtureFiles(durable);
});

test('does not expose an uncommitted grant after failure and accepts a later grant retry', async t => {
	const initialGrant = activeGrant();
	const durable = new DurablePluginData(packageWithGrant(initialGrant));
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const nextGrant = activeGrant(initialGrant, 'consumer.second');
	durable.failNextSave();

	await assert.rejects(replaceGrant(storage, nextGrant), /injected plugin-data save failure/u);
	assert.deepEqual(
		storage.getDeveloperApiGrantDataStore().getDataPackage().integrations.developerApi,
		initialGrant,
	);
	assert.deepEqual(durable.snapshot().integrations.developerApi, initialGrant);

	await replaceGrant(storage, nextGrant);
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.deepEqual(durable.snapshot().integrations.developerApi, nextGrant);
	storage.destroy();
	assertAllowedFixtureFiles(durable);
});

test('fails closed on backup failure, then resumes only after an exact verified backup', async t => {
	const grantPackage = suspendedGrant();
	const durable = new DurablePluginData(packageWithGrant(grantPackage));
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const sealed = durable.snapshot();
	const sealedHash = stableHash(sealed);
	adapter.failNextWriteMatching(path => path.includes('.invalid-'));

	await assert.rejects(
		storage.backupCanonicalSettingsPackage(sealed),
		/injected adapter write failure/u,
	);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /backup failed/u);
	assert.equal(stableHash(durable.snapshot()), sealedHash);
	assert.deepEqual(durable.listFiles(), [`${CONFIG_DIR}/plugins/operon/data.json`]);
	durable.assertNoTemporaryFiles();
	await assert.rejects(
		storage.updateSettings({ demoWorkspacePromptDismissed: true }),
		/writes are suspended/u,
	);
	assert.equal(stableHash(durable.snapshot()), sealedHash);

	adapter.corruptNextWriteMatching(path => path.includes('.invalid-'));
	await assert.rejects(
		storage.backupCanonicalSettingsPackage(sealed),
		/backup verification failed/u,
	);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /backup failed/u);
	assert.deepEqual(durable.listFiles(), [`${CONFIG_DIR}/plugins/operon/data.json`]);
	durable.assertNoTemporaryFiles();

	adapter.failNextReadMatching(path => path.includes('.invalid-'));
	await assert.rejects(
		storage.backupCanonicalSettingsPackage(sealed),
		/injected adapter read failure/u,
	);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /backup failed/u);
	assert.deepEqual(durable.listFiles(), [CANONICAL_DATA_PATH]);
	durable.assertNoTemporaryFiles();

	adapter.failNextRenameMatching((from, to) => from.includes('.invalid-') && to.includes('.invalid-'));
	await assert.rejects(
		storage.backupCanonicalSettingsPackage(sealed),
		/injected adapter rename failure/u,
	);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /backup failed/u);
	assert.equal(stableHash(durable.snapshot()), sealedHash);
	assert.deepEqual(durable.listFiles(), [CANONICAL_DATA_PATH]);
	durable.assertNoTemporaryFiles();

	const sealedBytesHash = durable.bytesSha256();
	const backupPath = await storage.backupCanonicalSettingsPackage(sealed);
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), null);
	assert.equal(
		createHash('sha256').update(await adapter.read(backupPath)).digest('hex'),
		sealedBytesHash,
	);
	assert.equal(stableHash(durable.snapshot()), sealedHash);
	const backupPaths = durable.listFiles().filter(path => path.includes('.invalid-'));
	assert.deepEqual(backupPaths, [backupPath]);
	durable.assertNoTemporaryFiles();

	const sealedBytes = await adapter.read(backupPath);
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
	storage.destroy();
	durable.replaceCanonicalRaw(sealedBytes);
	assert.equal(durable.bytesSha256(), sealedBytesHash);

	const writesBeforeRestart = durable.writes.length;
	const restarted = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, writesBeforeRestart);
	assert.deepEqual(durable.snapshot().integrations.developerApi, grantPackage);
	assert.equal(restarted.getSettings().demoWorkspacePromptDismissed, false);
	restarted.destroy();
	assertAllowedFixtureFiles(durable, true, true);
});

test('defaults a supported legacy package with a missing grant slice and stabilizes after settings save', async t => {
	const legacyPackage = clone(packageWithGrant(EMPTY_GRANT));
	delete (legacyPackage.integrations as unknown as { developerApi?: unknown }).developerApi;
	const durable = new DurablePluginData(legacyPackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	assert.equal(durable.initialSha256, '56e7e7d8694f6253c10d2d9eec5b2d3cc458d2698971e1cb553c48832857ae6d');
	const storage = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, 1);
	assert.deepEqual(
		storage.getDeveloperApiGrantDataStore().getDataPackage().integrations.developerApi,
		EMPTY_GRANT,
	);
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.equal(durable.bytesSha256(), 'c23707feb8008c53c62389bbe0776b45e9d62d156760a123b2e1e482c7eacfd1');
	storage.destroy();

	const writesBeforeRestart = durable.writes.length;
	const restarted = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, writesBeforeRestart);
	assert.deepEqual(durable.snapshot().integrations.developerApi, EMPTY_GRANT);
	restarted.destroy();
	assertAllowedFixtureFiles(durable);
});

test('backs up and canonicalizes a malformed recoverable V1 grant slice before restart', async t => {
	const malformedPackage = clone(packageWithGrant(ACTIVE_GRANT));
	(malformedPackage.integrations.developerApi.consumersById as Record<string, unknown>)['consumer.forged'] = {
		consumerId: 'different.consumer',
		consumerName: 'Forged Consumer',
		consumerVersion: '1.0.0',
		approvedMajorVersion: 1,
		state: 'active',
		revision: 1,
		grantedCapabilities: ['tasks.read'],
		pendingCapabilities: [],
		createdAt: NOW,
		updatedAt: NOW,
	};
	const durable = new DurablePluginData(malformedPackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const initialHash = durable.bytesSha256();
	assert.equal(initialHash, 'bcebaa369b22ca8bd6d13c06abfb51aeaa45b6ff9b180a66edc9373040a78a8b');
	const storage = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, 2);
	assert.equal(durable.bytesSha256(), '912fb6f4d6f3365d97f35bf069ba4a6c606f797528f74aaec836cc5640a537ce');
	assert.deepEqual(durable.snapshot().integrations.developerApi, ACTIVE_GRANT);
	const backups = durable.listFiles().filter(file => file.includes('.invalid-'));
	assert.equal(backups.length, 1);
	assert.equal(
		createHash('sha256').update(await adapter.read(backups[0]!)).digest('hex'),
		initialHash,
	);
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.equal(durable.bytesSha256(), '2359755b9c694a6bc1cc7ac2770d5f52791cbe9b9a0f4ab0f3362cba3a17383c');
	storage.destroy();

	const writesBeforeRestart = durable.writes.length;
	const restarted = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, writesBeforeRestart);
	assert.deepEqual(durable.snapshot().integrations.developerApi, ACTIVE_GRANT);
	restarted.destroy();
	assertAllowedFixtureFiles(durable, true);
});

test('fails closed across restart when canonical plugin data is malformed JSON', async t => {
	const durable = new DurablePluginData(packageWithGrant(ACTIVE_GRANT));
	disposeAfterTest(t, durable);
	durable.replaceCanonicalRaw('{invalid-json\n');
	assert.equal(durable.bytesSha256(), '3c063ffb4cde81bd5fb3930e0dec9b367aae125150588d19d6cccf48082334dc');
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /could not be read safely/iu);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), '3c063ffb4cde81bd5fb3930e0dec9b367aae125150588d19d6cccf48082334dc');
	storage.destroy();

	const restarted = await initializeStorage(durable, adapter);
	assert.match(restarted.getCanonicalSettingsWriteSuspensionReason() ?? '', /could not be read safely/iu);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), '3c063ffb4cde81bd5fb3930e0dec9b367aae125150588d19d6cccf48082334dc');
	restarted.destroy();
	assertAllowedFixtureFiles(durable, false, true);
});

test('fails closed without overwriting an unsupported future Developer API grant package', async t => {
	const futurePackage = clone(packageWithGrant(ACTIVE_GRANT));
	(futurePackage.integrations as unknown as { developerApi: unknown }).developerApi = {
		version: 2,
		consumersById: clone(ACTIVE_GRANT.consumersById),
	};
	const durable = new DurablePluginData(futurePackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const initialHash = durable.bytesSha256();
	assert.equal(initialHash, '8d567bf27c085f61e08e1e071fb70fce20f5faf0ee3f96e3c13d21dfe9a6572c');
	const storage = await initializeStorage(durable, adapter);

	assert.match(
		storage.getCanonicalSettingsWriteSuspensionReason() ?? '',
		/unsupported future Developer API grant package version/iu,
	);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), initialHash);
	assert.deepEqual(
		storage.getDeveloperApiGrantDataStore().getDataPackage().integrations.developerApi,
		createEmptyDeveloperApiGrantPackage(),
	);
	await assert.rejects(
		storage.updateSettings({ demoWorkspacePromptDismissed: true }),
		/writes are suspended/iu,
	);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), initialHash);
	const backupPath = await storage.backupCanonicalSettingsPackage();
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /unsupported future/iu);
	assert.equal(
		createHash('sha256').update(await adapter.read(backupPath)).digest('hex'),
		initialHash,
	);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), initialHash);
	durable.assertNoTemporaryFiles();
	storage.destroy();

	const restarted = await initializeStorage(durable, adapter);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), initialHash);
	restarted.destroy();
	assertAllowedFixtureFiles(durable, true);
});

test('keeps a future-version write lock sticky across startup taxonomy backup', async t => {
	const futurePackage = clone(packageWithGrant(ACTIVE_GRANT));
	(futurePackage.integrations as unknown as { developerApi: unknown }).developerApi = {
		version: 2,
		consumersById: clone(ACTIVE_GRANT.consumersById),
	};
	futurePackage.taxonomy.pipelines.pipelines = [];
	const durable = new DurablePluginData(futurePackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const initialHash = durable.bytesSha256();
	assert.equal(initialHash, '0362f9401889e5d6204c3de1df54371f901c27a2558b9a40cfbaadf47d6f5ac9');
	const storage = await initializeStorage(durable, adapter);

	assert.match(
		storage.getCanonicalSettingsWriteSuspensionReason() ?? '',
		/unsupported future Developer API grant package version/iu,
	);
	assert.equal(durable.writes.length, 0);
	assert.equal(durable.bytesSha256(), initialHash);
	const backups = durable.listFiles().filter(file => file.includes('.invalid-'));
	assert.equal(backups.length, 1);
	assert.equal(
		createHash('sha256').update(await adapter.read(backups[0]!)).digest('hex'),
		initialHash,
	);
	assertAllowedFixtureFiles(durable, true);
	storage.destroy();
});

test('suspends persistence for every explicit corrupt Developer API package version', async t => {
	const cases = [
		{ version: 2.5, initialSha256: '38c0b81330684bef5123c4ba929444b59e3dc0960f4095766bd88e4a761fb054' },
		{ version: '2', initialSha256: '3fe9bb0450bcfae47287dc102da9f0c0b491b005e950cfbdfff2ba1503fce0a4' },
		{ version: null, initialSha256: '67da604ac2acd476d6eb399d21c8e97b1948bd7ad3b9cc82521ccdcfe612ebdf' },
	] as const;
	for (const { version, initialSha256 } of cases) {
		const corruptPackage = clone(packageWithGrant(ACTIVE_GRANT));
		(corruptPackage.integrations as unknown as { developerApi: unknown }).developerApi = {
			version,
			consumersById: clone(ACTIVE_GRANT.consumersById),
		};
		const durable = new DurablePluginData(corruptPackage);
		disposeAfterTest(t, durable);
		const adapter = new FileBackedVaultAdapter(durable);
		const initialHash = durable.bytesSha256();
		assert.equal(initialHash, initialSha256);
		const storage = await initializeStorage(durable, adapter);
		assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /unsupported future/iu);
		assert.deepEqual(
			storage.getDeveloperApiGrantDataStore().getDataPackage().integrations.developerApi,
			createEmptyDeveloperApiGrantPackage(),
		);
		assert.equal(durable.writes.length, 0);
		assert.equal(durable.bytesSha256(), initialHash);
		assertAllowedFixtureFiles(durable);
		storage.destroy();
	}
});

test('fails closed for explicit non-object Developer API grant slices', async t => {
	const cases = [
		{ value: null, initialSha256: 'c87fff5cd64cb3fec96c3226641b1e0280031ca4f4f51c7c56bf9dddd8b7c283' },
		{ value: [], initialSha256: '9b042c612366d46d9ae409c6a80713a331baa4eb5e5c44a3c19ffe093ffce70d' },
		{ value: 'corrupt', initialSha256: 'c53f008965f56f028b9b25fa14b303e38251ab3b88fcc82b01a00f9eb16ab160' },
	] as const;
	for (const { value, initialSha256 } of cases) {
		const corruptPackage = clone(packageWithGrant(ACTIVE_GRANT));
		(corruptPackage.integrations as unknown as { developerApi: unknown }).developerApi = clone(value);
		const durable = new DurablePluginData(corruptPackage);
		disposeAfterTest(t, durable);
		assert.equal(durable.bytesSha256(), initialSha256);
		const adapter = new FileBackedVaultAdapter(durable);
		const storage = await initializeStorage(durable, adapter);
		assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /unsupported future/iu);
		assert.equal(durable.writes.length, 0);
		assert.equal(durable.bytesSha256(), initialSha256);
		await assert.rejects(storage.updateSettings({ demoWorkspacePromptDismissed: true }), /writes are suspended/iu);
		storage.destroy();
		assertAllowedFixtureFiles(durable);
	}
});

test('reload refuses a future grant package and recovers only after a supported replacement', async t => {
	const supportedPackage = packageWithGrant(ACTIVE_GRANT);
	const durable = new DurablePluginData(supportedPackage);
	disposeAfterTest(t, durable);
	assert.equal(durable.initialSha256, 'a63a9eef16e2338424c51a78c083b42ccf75b564071852ae6904ff7192f6608e');
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const controller = new DeveloperApiGrantControllerV1({
		store: storage.getDeveloperApiGrantDataStore(),
		verifier: {
			verify: () => null,
			isCurrent: () => true,
		},
	});
	const futurePackage = clone(supportedPackage);
	(futurePackage.integrations as unknown as { developerApi: unknown }).developerApi = {
		version: 2,
		consumersById: clone(ACTIVE_GRANT.consumersById),
	};
	durable.replaceCanonicalPackage(futurePackage);
	const futureHash = durable.bytesSha256();
	assert.equal(futureHash, '8d567bf27c085f61e08e1e071fb70fce20f5faf0ee3f96e3c13d21dfe9a6572c');
	const writesBeforeReload = durable.writes.length;

	const refused = await storage.reloadCanonicalSettingsPackage();
	assert.equal(refused.changed, false);
	assert.match(refused.diagnostics.warnings.join('\n'), /unsupported future Developer API/iu);
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /unsupported future/iu);
	assert.equal(durable.writes.length, writesBeforeReload);
	assert.equal(durable.bytesSha256(), futureHash);
	assert.deepEqual(
		storage.getDeveloperApiGrantDataStore().getDataPackage().integrations.developerApi,
		ACTIVE_GRANT,
	);
	const refusedEvaluation = controller.evaluate(consumer('consumer.active'), ['tasks.read']);
	assert.equal(refusedEvaluation.state, 'suspended');
	assert.equal(refusedEvaluation.reason, 'grant-persistence-unavailable');
	assert.deepEqual(refusedEvaluation.effectiveCapabilities, []);

	durable.replaceCanonicalPackage(supportedPackage);
	const recovered = await storage.reloadCanonicalSettingsPackage();
	assert.equal(recovered.diagnostics.warnings.some(warning => /unsupported future/iu.test(warning)), false);
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), null);
	const recoveredEvaluation = controller.evaluate(consumer('consumer.active'), ['tasks.read']);
	assert.equal(recoveredEvaluation.state, 'active');
	assert.deepEqual(recoveredEvaluation.effectiveCapabilities, ['tasks.read']);
	await storage.updateSettings({ demoWorkspacePromptDismissed: true });
	await storage.flushPendingWrites();
	assert.deepEqual(durable.snapshot().integrations.developerApi, ACTIVE_GRANT);
	assertAllowedFixtureFiles(durable, false, true);
	storage.destroy();
});

test('preserves an existing manual write suspension across future and supported reloads', async t => {
	const supportedPackage = packageWithGrant(ACTIVE_GRANT);
	const durable = new DurablePluginData(supportedPackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	storage.suspendCanonicalSettingsWrites('manual fixture suspension');
	const futurePackage = clone(supportedPackage);
	(futurePackage.integrations as unknown as { developerApi: unknown }).developerApi = {
		version: 2,
		consumersById: clone(ACTIVE_GRANT.consumersById),
	};
	durable.replaceCanonicalPackage(futurePackage);
	await storage.reloadCanonicalSettingsPackage();
	assert.match(storage.getCanonicalSettingsWriteSuspensionReason() ?? '', /unsupported future/iu);

	durable.replaceCanonicalPackage(supportedPackage);
	await storage.reloadCanonicalSettingsPackage();
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), 'manual fixture suspension');
	await assert.rejects(
		storage.updateSettings({ demoWorkspacePromptDismissed: true }),
		/writes are suspended/iu,
	);
	storage.resumeCanonicalSettingsWrites();
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), null);
	assertAllowedFixtureFiles(durable, false, true);
	storage.destroy();
});

test('does not clear a manual suspension to canonicalize a recoverable grant slice', async t => {
	const supportedPackage = packageWithGrant(ACTIVE_GRANT);
	const durable = new DurablePluginData(supportedPackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const baselineWrites = durable.writes.length;
	storage.suspendCanonicalSettingsWrites('manual fixture suspension');
	const malformedPackage = clone(supportedPackage);
	(malformedPackage.integrations.developerApi.consumersById as Record<string, unknown>)['consumer.forged'] = {
		consumerId: 'different.consumer',
	};
	durable.replaceCanonicalPackage(malformedPackage);
	const malformedHash = durable.bytesSha256();

	await assert.rejects(storage.reloadCanonicalSettingsPackage(), /writes are suspended/iu);
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), 'manual fixture suspension');
	assert.equal(durable.bytesSha256(), malformedHash);
	assert.equal(durable.writes.length, baselineWrites);
	assert.equal(durable.listFiles().filter(file => file.includes('.invalid-')).length, 1);
	storage.destroy();
	assertAllowedFixtureFiles(durable, true, true);
});

test('preserves a manual suspension added after a future-version lock', async t => {
	const supportedPackage = packageWithGrant(ACTIVE_GRANT);
	const durable = new DurablePluginData(supportedPackage);
	disposeAfterTest(t, durable);
	const adapter = new FileBackedVaultAdapter(durable);
	const storage = await initializeStorage(durable, adapter);
	const futurePackage = clone(supportedPackage);
	(futurePackage.integrations as unknown as { developerApi: unknown }).developerApi = {
		version: 2,
		consumersById: clone(ACTIVE_GRANT.consumersById),
	};
	durable.replaceCanonicalPackage(futurePackage);
	await storage.reloadCanonicalSettingsPackage();
	storage.suspendCanonicalSettingsWrites('manual suspension after future lock');

	durable.replaceCanonicalPackage(supportedPackage);
	await storage.reloadCanonicalSettingsPackage();
	assert.equal(storage.getCanonicalSettingsWriteSuspensionReason(), 'manual suspension after future lock');
	await assert.rejects(storage.updateSettings({ demoWorkspacePromptDismissed: true }), /writes are suspended/iu);
	storage.destroy();
	assertAllowedFixtureFiles(durable, false, true);
});
