import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import type { ReminderSoundPackCatalog } from '../src/core/reminder-sound-pack';
import { ReminderSoundPackManager } from '../src/core/reminder-sound-pack-manager';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

class MemoryAdapter {
	readonly files = new Map<string, ArrayBuffer>();
	readonly folders = new Set<string>();
	createCount = 0;
	createConflictFor: string | null = null;
	onCreateBinary: ((path: string) => void) | null = null;

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const bytes = this.files.get(path);
		if (!bytes) throw new Error(`Missing ${path}`);
		return bytes.slice(0);
	}

	async stat(path: string): Promise<{ type: 'file'; ctime: number; mtime: number; size: number } | null> {
		const bytes = this.files.get(path);
		return bytes ? { type: 'file', ctime: 0, mtime: 0, size: bytes.byteLength } : null;
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}

	async createBinary(path: string, bytes: ArrayBuffer): Promise<void> {
		if (this.createConflictFor && path.endsWith(this.createConflictFor)) {
			this.files.set(path, bytesForText('foreign file'));
			throw new Error('target exists');
		}
		if (this.files.has(path)) throw new Error(`Target exists: ${path}`);
		this.createCount += 1;
		this.files.set(path, bytes.slice(0));
		this.onCreateBinary?.(path);
	}
}

function bytesForText(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

function sha256(value: ArrayBuffer): string {
	return createHash('sha256').update(Buffer.from(value)).digest('hex');
}

function catalog(): { catalog: ReminderSoundPackCatalog; assets: Map<string, ArrayBuffer> } {
	const assets = new Map<string, ArrayBuffer>();
	const files = [1, 2, 3, 4].map(number => {
		const assetName = `operon-reminder-${String(number)}.mp3`;
		const assetBytes = bytesForText(`sound-${String(number)}`);
		assets.set(assetName, assetBytes);
		return {
			id: `reminder-${String(number)}`,
			assetName,
			fileName: `Operon Reminder ${String(number)}.mp3`,
			url: `https://raw.githubusercontent.com/hasanyilmaz/operon/main/release-assets/reminder-sounds/${assetName}`,
			sha256: sha256(assetBytes),
			sizeBytes: assetBytes.byteLength,
		};
	});
	return { catalog: { schemaVersion: 1, files }, assets };
}

function assetNameFromUrl(url: string): string {
	return url.slice(url.lastIndexOf('/') + 1);
}

function managerOptions(
	adapter: MemoryAdapter,
	fixture: ReturnType<typeof catalog>,
	fetchAsset: (url: string) => Promise<{ status: number; arrayBuffer: ArrayBuffer }>,
) {
	return {
		adapter,
		catalog: fixture.catalog,
		fetchAsset,
		createFolder: adapter.createFolder.bind(adapter),
		createBinary: adapter.createBinary.bind(adapter),
		deleteBinary: adapter.remove.bind(adapter),
	};
}

test('downloads the four verified sounds and reports an installed package', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	let fetchCount = 0;
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => {
			fetchCount += 1;
			return { status: 200, arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0) };
	}));
	assert.equal((await manager.refreshStatus()).installed, false);
	const result = await manager.ensurePack();
	assert.equal(result.installedCount, 4);
	assert.equal(result.skippedCount, 0);
	assert.equal(manager.getStatus().installed, true);
	assert.equal(fetchCount, 4);
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 1.mp3'), true);
});

test('skips exact installed files without downloading them', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	for (const entry of fixture.catalog.files) {
		adapter.files.set(`Operon/Reminder Sounds/${entry.fileName}`, fixture.assets.get(entry.assetName)!.slice(0));
	}
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async () => { throw new Error('network must not be used'); }));
	await manager.initialize();
	assert.equal(manager.getStatus().installed, true);
	const result = await manager.ensurePack();
	assert.equal(result.installedCount, 0);
	assert.equal(result.skippedCount, 4);
});

test('refuses to overwrite a different user file before any download or write', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	adapter.files.set('Operon/Reminder Sounds/Operon Reminder 2.mp3', bytesForText('user file'));
	let fetchCount = 0;
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async () => {
			fetchCount += 1;
			throw new Error('must not fetch');
	}));
	await assert.rejects(manager.ensurePack(), /Refusing to overwrite/u);
	assert.equal(fetchCount, 0);
	assert.equal(adapter.createCount, 0);
	assert.equal(new TextDecoder().decode(adapter.files.get('Operon/Reminder Sounds/Operon Reminder 2.mp3')), 'user file');
});

test('verifies every download before writing the first file', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	let releaseFourth!: () => void;
	const fourthReady = new Promise<void>(resolve => { releaseFourth = resolve; });
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => {
			if (assetNameFromUrl(url) === 'operon-reminder-4.mp3') await fourthReady;
			return { status: 200, arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0) };
	}));
	const install = manager.ensurePack();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(adapter.createCount, 0);
	releaseFourth();
	await install;
	assert.equal(adapter.createCount, 4);
});

test('rolls back only assets created by the failed transaction', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	const first = fixture.catalog.files[0]!;
	adapter.files.set(`Operon/Reminder Sounds/${first.fileName}`, fixture.assets.get(first.assetName)!.slice(0));
	adapter.createConflictFor = 'Operon Reminder 3.mp3';
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => ({
		status: 200,
		arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0),
	})));
	await assert.rejects(manager.ensurePack(), /Refusing to overwrite/u);
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 1.mp3'), true);
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 2.mp3'), false);
	assert.equal(new TextDecoder().decode(adapter.files.get('Operon/Reminder Sounds/Operon Reminder 3.mp3')), 'foreign file');
});

test('deduplicates concurrent install requests and exposes downloading status', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	let fetchCount = 0;
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => {
			fetchCount += 1;
			await Promise.resolve();
			return { status: 200, arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0) };
	}));
	const [left, right] = await Promise.all([manager.ensurePack(), manager.ensurePack()]);
	assert.equal(left.installedCount, 4);
	assert.equal(right.installedCount, 4);
	assert.equal(fetchCount, 4);
	assert.equal(manager.getStatus().activity, 'idle');
});

test('does not create target files when HTTP, size, or hash verification fails', async () => {
	for (const response of [
		{ name: 'HTTP', status: 404, mutate: (value: ArrayBuffer) => value },
		{ name: 'size', status: 200, mutate: () => bytesForText('wrong size') },
		{ name: 'hash', status: 200, mutate: (value: ArrayBuffer) => bytesForText(`${new TextDecoder().decode(value)}!`) },
	]) {
		const adapter = new MemoryAdapter();
		const fixture = catalog();
		const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => ({
			status: response.status,
			arrayBuffer: response.mutate(fixture.assets.get(assetNameFromUrl(url))!.slice(0)),
		})));
		await assert.rejects(manager.ensurePack());
		assert.equal(adapter.createCount, 0, response.name);
		assert.equal([...adapter.files.keys()].filter(path => path.startsWith('Operon/Reminder Sounds/')).length, 0, response.name);
	}
});

test('rechecks skipped files after creates and rolls back only this transaction on mutation', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	const first = fixture.catalog.files[0]!;
	adapter.files.set(`Operon/Reminder Sounds/${first.fileName}`, fixture.assets.get(first.assetName)!.slice(0));
	adapter.onCreateBinary = path => {
		if (path.endsWith('Operon Reminder 4.mp3')) {
			adapter.files.set(`Operon/Reminder Sounds/${first.fileName}`, bytesForText('changed by sync'));
		}
	};
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => ({
		status: 200,
		arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0),
	})));
	await assert.rejects(manager.ensurePack(), /could not verify every file/u);
	assert.equal(manager.getStatus().installed, false);
	assert.equal(new TextDecoder().decode(adapter.files.get(`Operon/Reminder Sounds/${first.fileName}`)), 'changed by sync');
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 2.mp3'), false);
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 3.mp3'), false);
	assert.equal(adapter.files.has('Operon/Reminder Sounds/Operon Reminder 4.mp3'), false);
});

test('refresh waits for an in-flight install before reporting status', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	let releaseFetch!: () => void;
	const fetchReady = new Promise<void>(resolve => { releaseFetch = resolve; });
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => {
		if (assetNameFromUrl(url) === 'operon-reminder-4.mp3') await fetchReady;
		return { status: 200, arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0) };
	}));
	const install = manager.ensurePack();
	await Promise.resolve();
	const refresh = manager.refreshStatus();
	releaseFetch();
	await install;
	assert.equal((await refresh).installed, true);
});

test('install waits for an in-flight refresh before changing durable status', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	let releaseStat!: () => void;
	const statReady = new Promise<void>(resolve => { releaseStat = resolve; });
	const originalStat = adapter.stat.bind(adapter);
	let pauseOnce = true;
	adapter.stat = async path => {
		if (pauseOnce) {
			pauseOnce = false;
			await statReady;
		}
		return await originalStat(path);
	};
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async url => ({
		status: 200,
		arrayBuffer: fixture.assets.get(assetNameFromUrl(url))!.slice(0),
	})));
	const refresh = manager.refreshStatus();
	const install = manager.ensurePack();
	releaseStat();
	await refresh;
	await install;
	assert.equal(manager.getStatus().installed, true);
});

test('rejects oversized existing targets without reading their contents', async () => {
	const adapter = new MemoryAdapter();
	const fixture = catalog();
	const target = 'Operon/Reminder Sounds/Operon Reminder 1.mp3';
	adapter.files.set(target, bytesForText('placeholder'));
	adapter.stat = async path => path === target
		? { type: 'file', ctime: 0, mtime: 0, size: 100_000_000 }
		: null;
	let readCount = 0;
	adapter.readBinary = async path => {
		readCount += 1;
		return MemoryAdapter.prototype.readBinary.call(adapter, path);
	};
	const manager = new ReminderSoundPackManager(managerOptions(adapter, fixture, async () => { throw new Error('must not fetch'); }));
	await assert.rejects(manager.ensurePack(), /Refusing to overwrite/u);
	assert.equal(readCount, 0);
});
