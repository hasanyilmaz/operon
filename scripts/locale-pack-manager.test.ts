import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import type { LocalePackCatalog } from '../src/core/locale-pack';
import { LocalePackManager } from '../src/core/locale-pack-manager';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const KEY_FINGERPRINT = '1'.repeat(64);
const SOURCE_VERSION = '2'.repeat(64);

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>(['.obsidian', '.obsidian/plugins', '.obsidian/plugins/operon']);
	failManifestWrite = false;
	manifestReadCount = 0;
	blockSecondManifestRead = false;
	private releaseSecondManifestRead: (() => void) | null = null;
	private readonly secondManifestRead = new Promise<void>(resolve => {
		this.releaseSecondManifestRead = resolve;
	});

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		return {
			files: [...this.files.keys()].filter(file => file.startsWith(`${path}/`)),
			folders: [...this.folders].filter(folder => folder.startsWith(`${path}/`)),
		};
	}

	async mkdir(path: string): Promise<void> {
		this.folders.add(path);
	}

	async read(path: string): Promise<string> {
		if (path.endsWith('/runtime/locales/manifest.json')) {
			this.manifestReadCount += 1;
			if (this.blockSecondManifestRead && this.manifestReadCount === 2) await this.secondManifestRead;
		}
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing ${path}`);
		return value;
	}

	releaseBlockedManifestRead(): void {
		this.releaseSecondManifestRead?.();
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}

	async rename(from: string, to: string): Promise<void> {
		const value = await this.read(from);
		if (this.files.has(to)) throw new Error(`Target exists: ${to}`);
		this.files.set(to, value);
		this.files.delete(from);
	}

	async write(path: string, value: string): Promise<void> {
		if (this.failManifestWrite && path.endsWith('/manifest.json')) throw new Error('manifest write failed');
		this.files.set(path, value);
	}

	async process(path: string, update: (value: string) => string): Promise<string> {
		if (this.failManifestWrite && path.endsWith('/manifest.json')) throw new Error('manifest write failed');
		const current = this.files.get(path);
		if (current === undefined) throw new Error(`Missing ${path}`);
		const value = update(current);
		this.files.set(path, value);
		return value;
	}
}

function buildPack(locale: 'tr' | 'de', value: string): string {
	return JSON.stringify({
		schemaVersion: 1,
		locale,
		sourceVersion: SOURCE_VERSION,
		keyCount: 1,
		keyFingerprint: KEY_FINGERPRINT,
		translations: { buttons: { save: value } },
	});
}

function buildCatalog(locale: 'tr' | 'de', raw: string): LocalePackCatalog {
	const sha256 = createHash('sha256').update(raw).digest('hex');
	return {
		schemaVersion: 1,
		sourceVersion: '2.4.0',
		keyCount: 1,
		keyFingerprint: KEY_FINGERPRINT,
		languageOrder: [locale],
		locales: {
			[locale]: {
				assetName: `operon-locale-${locale}-${sha256.slice(0, 12)}.json`,
				url: `https://example.com/${locale}/${sha256}`,
				sha256,
				sizeBytes: Buffer.byteLength(raw),
				sourceVersion: SOURCE_VERSION,
			},
		} as LocalePackCatalog['locales'],
	};
}

test('downloads, validates, caches, and reuses a current locale without network', async () => {
	const adapter = new MemoryAdapter();
	const raw = buildPack('tr', 'Kaydet');
	const catalog = buildCatalog('tr', raw);
	let fetchCount = 0;
	const manager = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog,
		fetchPack: async () => {
			fetchCount += 1;
			return { status: 200, text: raw };
		},
	});
	const downloaded = await manager.ensureLocale('tr');
	assert.equal(downloaded.translations.buttons?.save, 'Kaydet');
	assert.equal(manager.getStatus('tr').installed, true);
	assert.equal(manager.getStatus('tr').updateAvailable, false);
	assert.equal(fetchCount, 1);

	const restarted = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog,
		fetchPack: async () => {
			fetchCount += 1;
			throw new Error('network must not be used');
		},
	});
	assert.equal((await restarted.ensureLocale('tr')).translations.buttons?.save, 'Kaydet');
	assert.equal(fetchCount, 1);
});

test('updates a stale cached locale by SHA and retains the prior generation', async () => {
	const adapter = new MemoryAdapter();
	const firstRaw = buildPack('tr', 'Kaydet');
	const firstCatalog = buildCatalog('tr', firstRaw);
	await new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: firstCatalog,
		fetchPack: async () => ({ status: 200, text: firstRaw }),
	}).ensureLocale('tr');

	const nextRaw = buildPack('tr', 'Şimdi kaydet');
	const nextCatalog = buildCatalog('tr', nextRaw);
	const manager = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: nextCatalog,
		fetchPack: async () => ({ status: 200, text: nextRaw }),
	});
	await manager.initialize();
	assert.equal(manager.getStatus('tr').updateAvailable, true);
	assert.equal((await manager.loadCachedLocale('tr'))?.translations.buttons?.save, 'Kaydet');
	assert.equal((await manager.ensureLocale('tr')).translations.buttons?.save, 'Şimdi kaydet');
	assert.equal(adapter.files.has(`.obsidian/plugins/operon/runtime/locales/packs/${firstCatalog.locales.tr.assetName}`), true);
});

test('repairs a corrupted current cache instead of trusting the manifest', async () => {
	const adapter = new MemoryAdapter();
	const raw = buildPack('tr', 'Kaydet');
	const catalog = buildCatalog('tr', raw);
	await new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog,
		fetchPack: async () => ({ status: 200, text: raw }),
	}).ensureLocale('tr');
	const packPath = `.obsidian/plugins/operon/runtime/locales/packs/${catalog.locales.tr.assetName}`;
	adapter.files.set(packPath, '{"corrupt":true}');
	let fetchCount = 0;
	const restarted = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog,
		fetchPack: async () => {
			fetchCount += 1;
			return { status: 200, text: raw };
		},
	});
	const [result] = await restarted.updateSubscribedLocales(['tr'], { activeLocale: 'tr' });
	assert.equal(result.pack?.translations.buttons?.save, 'Kaydet');
	assert.equal(fetchCount, 1);
});

test('rejects integrity, oversize, and wrong-locale responses without installing them', async () => {
	for (const response of [
		{ name: 'hash', raw: buildPack('tr', 'Changed'), catalogRaw: buildPack('tr', 'Expected') },
		{ name: 'oversize', raw: `${buildPack('tr', 'Expected')}${' '.repeat(1_000_000)}`, catalogRaw: buildPack('tr', 'Expected') },
		{ name: 'locale', raw: buildPack('de', 'Speichern'), catalogRaw: buildPack('de', 'Speichern'), requested: 'tr' as const },
	]) {
		const adapter = new MemoryAdapter();
		const sourceLocale = response.name === 'locale' ? 'tr' : 'tr';
		const catalog = buildCatalog(sourceLocale, response.catalogRaw);
		if (response.name === 'locale') {
			const sha256 = createHash('sha256').update(response.raw).digest('hex');
			catalog.locales.tr = {
				...catalog.locales.tr,
				assetName: `operon-locale-tr-${sha256.slice(0, 12)}.json`,
				sha256,
				sizeBytes: Buffer.byteLength(response.raw),
				sourceVersion: SOURCE_VERSION,
			};
		}
		const manager = new LocalePackManager({
			adapter,
			configDir: '.obsidian',
			catalog,
			fetchPack: async () => ({ status: 200, text: response.raw }),
		});
		await assert.rejects(manager.ensureLocale(response.requested ?? 'tr'));
		assert.equal(manager.getStatus('tr').installed, false, response.name);
	}
});

test('keeps the old cached pack active when manifest promotion fails', async () => {
	const adapter = new MemoryAdapter();
	const oldRaw = buildPack('tr', 'Kaydet');
	const oldCatalog = buildCatalog('tr', oldRaw);
	await new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: oldCatalog,
		fetchPack: async () => ({ status: 200, text: oldRaw }),
	}).ensureLocale('tr');

	const newRaw = buildPack('tr', 'Şimdi kaydet');
	const manager = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: buildCatalog('tr', newRaw),
		fetchPack: async () => ({ status: 200, text: newRaw }),
	});
	adapter.failManifestWrite = true;
	await assert.rejects(manager.ensureLocale('tr'), /manifest write failed/u);
	adapter.failManifestWrite = false;
	const restarted = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: oldCatalog,
		fetchPack: async () => { throw new Error('network must not be used'); },
	});
	assert.equal((await restarted.ensureLocale('tr')).translations.buttons?.save, 'Kaydet');
});

test('deduplicates concurrent downloads for the same locale', async () => {
	const adapter = new MemoryAdapter();
	const raw = buildPack('tr', 'Kaydet');
	let fetchCount = 0;
	const manager = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog: buildCatalog('tr', raw),
		fetchPack: async () => {
			fetchCount += 1;
			await Promise.resolve();
			return { status: 200, text: raw };
		},
	});
	const [left, right] = await Promise.all([manager.ensureLocale('tr'), manager.ensureLocale('tr')]);
	assert.equal(left.record.sha256, right.record.sha256);
	assert.equal(fetchCount, 1);
});

test('coalesces first-use initialization so concurrent locales cannot lose manifest records', async () => {
	const adapter = new MemoryAdapter();
	const manifestPath = '.obsidian/plugins/operon/runtime/locales/manifest.json';
	adapter.folders.add('.obsidian/plugins/operon/runtime');
	adapter.folders.add('.obsidian/plugins/operon/runtime/locales');
	adapter.files.set(manifestPath, JSON.stringify({ version: 1, locales: {} }));
	adapter.blockSecondManifestRead = true;
	const trRaw = buildPack('tr', 'Kaydet');
	const deRaw = buildPack('de', 'Speichern');
	const trCatalog = buildCatalog('tr', trRaw);
	const deCatalog = buildCatalog('de', deRaw);
	const catalog: LocalePackCatalog = {
		...trCatalog,
		languageOrder: ['tr', 'de'],
		locales: { tr: trCatalog.locales.tr, de: deCatalog.locales.de } as LocalePackCatalog['locales'],
	};
	const manager = new LocalePackManager({
		adapter,
		configDir: '.obsidian',
		catalog,
		fetchPack: async url => ({ status: 200, text: url.includes('/tr/') ? trRaw : deRaw }),
	});
	const trPromise = manager.ensureLocale('tr');
	const dePromise = manager.ensureLocale('de');
	await trPromise;
	adapter.releaseBlockedManifestRead();
	await dePromise;
	const manifest = JSON.parse(adapter.files.get(manifestPath) ?? '{}') as { locales?: Record<string, unknown> };
	assert.deepEqual(Object.keys(manifest.locales ?? {}).sort(), ['de', 'tr']);
	assert.equal(adapter.manifestReadCount, 1);
});
