import { requestUrl, type DataAdapter } from 'obsidian';
import generatedCatalog from '../generated/locale-pack-catalog.json';
import { buildOperonStoragePaths, joinVaultPath } from '../storage/operon-storage-paths';
import { writeTextSafely } from '../storage/storage-file-ops';
import type { NonEnglishLangCode } from './i18n';
import {
	LocalePackError,
	MAX_LOCALE_PACK_BYTES,
	sha256Hex,
	utf8ByteLength,
	validateLocalePack,
	validateLocalePackCatalog,
	type LocalePack,
	type LocalePackCatalog,
	type LocaleTranslations,
} from './locale-pack';

const LOCALE_CACHE_MANIFEST_VERSION = 1;

export interface LocalePackFetchResponse {
	status: number;
	text: string;
}

export type LocalePackFetcher = (url: string) => Promise<LocalePackFetchResponse>;

export interface InstalledLocalePackRecord {
	fileName: string;
	sha256: string;
	sizeBytes: number;
	schemaVersion: number;
	sourceVersion: string;
	keyCount: number;
	keyFingerprint: string;
	installedAt: string;
}

export interface LocalePackCacheManifest {
	version: number;
	locales: Partial<Record<NonEnglishLangCode, InstalledLocalePackRecord>>;
}

export type LocalePackActivity = 'idle' | 'downloading' | 'updating';

export interface LocalePackStatus {
	locale: NonEnglishLangCode;
	installed: boolean;
	updateAvailable: boolean;
	activity: LocalePackActivity;
	error: string | null;
	sizeBytes: number;
}

export interface LoadedLocalePack {
	pack: LocalePack;
	translations: LocaleTranslations;
	record: InstalledLocalePackRecord;
	isCurrent: boolean;
}

export interface LocalePackUpdateResult {
	locale: NonEnglishLangCode;
	pack: LoadedLocalePack | null;
	error: Error | null;
}

export interface LocalePackManagerOptions {
	adapter: Pick<DataAdapter, 'exists' | 'list' | 'mkdir' | 'read' | 'remove' | 'rename' | 'write'>
		& Partial<Pick<DataAdapter, 'process'>>;
	configDir: string;
	pluginId?: string;
	catalog?: LocalePackCatalog;
	fetchPack?: LocalePackFetcher;
	now?: () => Date;
}

type LocalePackStatusListener = (status: LocalePackStatus) => void;

export const DEFAULT_LOCALE_PACK_CATALOG = validateLocalePackCatalog(generatedCatalog);

export class LocalePackManager {
	private readonly adapter: LocalePackManagerOptions['adapter'];
	private readonly catalog: LocalePackCatalog;
	private readonly fetchPack: LocalePackFetcher;
	private readonly now: () => Date;
	private readonly paths: ReturnType<typeof buildOperonStoragePaths>;
	private readonly activities = new Map<NonEnglishLangCode, LocalePackActivity>();
	private readonly errors = new Map<NonEnglishLangCode, string>();
	private readonly invalidCachedLocales = new Set<NonEnglishLangCode>();
	private readonly loadedLocales = new Map<NonEnglishLangCode, LoadedLocalePack>();
	private readonly inFlight = new Map<NonEnglishLangCode, Promise<LoadedLocalePack>>();
	private readonly listeners = new Set<LocalePackStatusListener>();
	private manifest: LocalePackCacheManifest = createEmptyManifest();
	private initialized = false;
	private initialization: Promise<void> | null = null;
	private manifestCommit: Promise<void> = Promise.resolve();

	constructor(options: LocalePackManagerOptions) {
		this.adapter = options.adapter;
		this.catalog = validateLocalePackCatalog(options.catalog ?? DEFAULT_LOCALE_PACK_CATALOG);
		this.fetchPack = options.fetchPack ?? fetchLocalePack;
		this.now = options.now ?? (() => new Date());
		this.paths = buildOperonStoragePaths(options.configDir, options.pluginId ?? 'operon');
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialization ??= this.initializeInternal();
		await this.initialization;
	}

	private async initializeInternal(): Promise<void> {
		this.manifest = await this.readManifest();
		this.initialized = true;
	}

	getCatalog(): LocalePackCatalog {
		return this.catalog;
	}

	getStatus(locale: NonEnglishLangCode): LocalePackStatus {
		const record = this.manifest.locales[locale];
		const installed = Boolean(record) && !this.invalidCachedLocales.has(locale);
		return {
			locale,
			installed,
			updateAvailable: installed && record?.sha256 !== this.catalog.locales[locale].sha256,
			activity: this.activities.get(locale) ?? 'idle',
			error: this.errors.get(locale) ?? null,
			sizeBytes: this.catalog.locales[locale].sizeBytes,
		};
	}

	getAllStatuses(): LocalePackStatus[] {
		return this.catalog.languageOrder.map(locale => this.getStatus(locale));
	}

	getLoadedLocale(locale: NonEnglishLangCode): LoadedLocalePack | null {
		return this.loadedLocales.get(locale) ?? null;
	}

	subscribe(listener: LocalePackStatusListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async loadCachedLocale(locale: NonEnglishLangCode): Promise<LoadedLocalePack | null> {
		await this.initialize();
		const record = this.manifest.locales[locale];
		if (!record) return null;
		const alreadyLoaded = this.loadedLocales.get(locale);
		if (alreadyLoaded?.record.sha256 === record.sha256) return alreadyLoaded;

		try {
			const filePath = this.getPackPath(record.fileName);
			if (!(await this.adapter.exists(filePath))) throw new LocalePackError('Cached language pack is missing.', 'storage');
			const raw = await this.adapter.read(filePath);
			if (utf8ByteLength(raw) !== record.sizeBytes || record.sizeBytes > MAX_LOCALE_PACK_BYTES) {
				throw new LocalePackError('Cached language pack size does not match its manifest.', 'integrity');
			}
			if (await sha256Hex(raw) !== record.sha256) {
				throw new LocalePackError('Cached language pack integrity check failed.', 'integrity');
			}
			const pack = validateLocalePack(parseJson(raw));
			if (pack.locale !== locale
				|| pack.schemaVersion !== record.schemaVersion
				|| pack.sourceVersion !== record.sourceVersion
				|| pack.keyCount !== record.keyCount
				|| pack.keyFingerprint !== record.keyFingerprint) {
				throw new LocalePackError('Cached language pack metadata does not match its manifest.', 'integrity');
			}
			const loaded: LoadedLocalePack = {
				pack,
				translations: pack.translations,
				record,
				isCurrent: record.sha256 === this.catalog.locales[locale].sha256,
			};
			this.loadedLocales.set(locale, loaded);
			this.invalidCachedLocales.delete(locale);
			this.errors.delete(locale);
			this.emit(locale);
			return loaded;
		} catch (error) {
			this.loadedLocales.delete(locale);
			this.invalidCachedLocales.add(locale);
			this.errors.set(locale, getErrorMessage(error));
			this.emit(locale);
			return null;
		}
	}

	async ensureLocale(locale: NonEnglishLangCode): Promise<LoadedLocalePack> {
		const existing = this.inFlight.get(locale);
		if (existing) return await existing;
		const operation = this.ensureLocaleInternal(locale);
		this.inFlight.set(locale, operation);
		try {
			return await operation;
		} finally {
			this.inFlight.delete(locale);
		}
	}

	async updateSubscribedLocales(
		locales: readonly NonEnglishLangCode[],
		options: { activeLocale?: NonEnglishLangCode | null } = {},
	): Promise<LocalePackUpdateResult[]> {
		await this.initialize();
		const ordered = uniqueLocales(options.activeLocale ? [options.activeLocale, ...locales] : locales);
		const results: LocalePackUpdateResult[] = [];
		for (const locale of ordered) {
			const status = this.getStatus(locale);
			if (status.installed && !status.updateAvailable) {
				const cached = await this.loadCachedLocale(locale);
				if (cached) {
					results.push({ locale, pack: cached, error: null });
					continue;
				}
			}
			try {
				results.push({ locale, pack: await this.ensureLocale(locale), error: null });
			} catch (error) {
				results.push({ locale, pack: null, error: toError(error) });
			}
		}
		return results;
	}

	private async ensureLocaleInternal(locale: NonEnglishLangCode): Promise<LoadedLocalePack> {
		await this.initialize();
		const currentEntry = this.catalog.locales[locale];
		const existingRecord = this.manifest.locales[locale];
		if (existingRecord?.sha256 === currentEntry.sha256) {
			const cached = await this.loadCachedLocale(locale);
			if (cached) return cached;
		}

		const stalePack = existingRecord ? await this.loadCachedLocale(locale) : null;
		this.activities.set(locale, stalePack ? 'updating' : 'downloading');
		this.errors.delete(locale);
		this.emit(locale);
		try {
			const response = await this.fetchPack(currentEntry.url);
			if (response.status < 200 || response.status >= 300) {
				throw new LocalePackError(`Language pack download failed with HTTP ${response.status}.`, 'network');
			}
			const sizeBytes = utf8ByteLength(response.text);
			if (sizeBytes > MAX_LOCALE_PACK_BYTES || sizeBytes !== currentEntry.sizeBytes) {
				throw new LocalePackError('Downloaded language pack size does not match the catalog.', 'integrity');
			}
			const hash = await sha256Hex(response.text);
			if (hash !== currentEntry.sha256) {
				throw new LocalePackError('Downloaded language pack integrity check failed.', 'integrity');
			}
			const pack = validateLocalePack(parseJson(response.text), {
				locale,
				catalog: this.catalog,
				entry: currentEntry,
			});
			const record: InstalledLocalePackRecord = {
				fileName: currentEntry.assetName,
				sha256: hash,
				sizeBytes,
				schemaVersion: pack.schemaVersion,
				sourceVersion: pack.sourceVersion,
				keyCount: pack.keyCount,
				keyFingerprint: pack.keyFingerprint,
				installedAt: this.now().toISOString(),
			};
			await this.persistDownloadedPack(response.text, record);
			await this.commitManifest(locale, record);
			const loaded: LoadedLocalePack = { pack, translations: pack.translations, record, isCurrent: true };
			this.loadedLocales.set(locale, loaded);
			this.invalidCachedLocales.delete(locale);
			this.errors.delete(locale);
			await this.cleanupOldPacks(locale, existingRecord, record);
			return loaded;
		} catch (error) {
			this.errors.set(locale, getErrorMessage(error));
			throw error;
		} finally {
			this.activities.set(locale, 'idle');
			this.emit(locale);
		}
	}

	private async readManifest(): Promise<LocalePackCacheManifest> {
		try {
			if (!(await this.adapter.exists(this.paths.runtime.locales.manifestPath))) return createEmptyManifest();
			const parsed = parseJson(await this.adapter.read(this.paths.runtime.locales.manifestPath));
			return validateCacheManifest(parsed);
		} catch {
			return createEmptyManifest();
		}
	}

	private async persistDownloadedPack(raw: string, record: InstalledLocalePackRecord): Promise<void> {
		await this.ensureCacheDirectories();
		const targetPath = this.getPackPath(record.fileName);
		if (await this.adapter.exists(targetPath)) {
			const existing = await this.adapter.read(targetPath);
			if (utf8ByteLength(existing) === record.sizeBytes && await sha256Hex(existing) === record.sha256) return;
			await this.adapter.remove(targetPath);
		}

		const tempPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let tempWritten = false;
		try {
			await this.adapter.write(tempPath, raw);
			tempWritten = true;
			const persisted = await this.adapter.read(tempPath);
			if (utf8ByteLength(persisted) !== record.sizeBytes || await sha256Hex(persisted) !== record.sha256) {
				throw new LocalePackError('Language pack cache verification failed.', 'storage');
			}
			await this.adapter.rename(tempPath, targetPath);
		} catch (error) {
			if (tempWritten && await this.adapter.exists(tempPath)) {
				try {
					await this.adapter.remove(tempPath);
				} catch {
					// Best-effort cleanup; keep the original storage failure.
				}
			}
			throw error;
		}
	}

	private async commitManifest(locale: NonEnglishLangCode, record: InstalledLocalePackRecord): Promise<void> {
		let resolveCommit: (() => void) | undefined;
		const previousCommit = this.manifestCommit;
		this.manifestCommit = new Promise<void>(resolve => {
			resolveCommit = resolve;
		});
		await previousCommit;
		try {
			const next: LocalePackCacheManifest = {
				version: LOCALE_CACHE_MANIFEST_VERSION,
				locales: { ...this.manifest.locales, [locale]: record },
			};
			await this.ensureCacheDirectories();
			await writeTextSafely(this.adapter, this.paths.runtime.locales.manifestPath, JSON.stringify(next, null, '\t'));
			this.manifest = next;
		} finally {
			resolveCommit?.();
		}
	}

	private async ensureCacheDirectories(): Promise<void> {
		for (const path of [
			joinVaultPath(this.paths.pluginDir, 'runtime'),
			this.paths.runtime.locales.rootPath,
			this.paths.runtime.locales.packsPath,
		]) {
			if (await this.adapter.exists(path)) continue;
			try {
				await this.adapter.mkdir(path);
			} catch (error) {
				if (!(await this.adapter.exists(path))) throw error;
			}
		}
	}

	private getPackPath(fileName: string): string {
		if (!/^[A-Za-z0-9._-]+$/u.test(fileName)) throw new LocalePackError('Language pack filename is unsafe.');
		return joinVaultPath(this.paths.runtime.locales.packsPath, fileName);
	}

	private async cleanupOldPacks(
		locale: NonEnglishLangCode,
		previous: InstalledLocalePackRecord | undefined,
		current: InstalledLocalePackRecord,
	): Promise<void> {
		try {
			const listed = await this.adapter.list(this.paths.runtime.locales.packsPath);
			const keep = new Set([current.fileName, previous?.fileName].filter((name): name is string => Boolean(name)));
			const prefix = `operon-locale-${locale}-`;
			for (const filePath of listed.files) {
				const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
				if (fileName.startsWith(prefix) && !keep.has(fileName)) await this.adapter.remove(filePath);
			}
		} catch {
			// Cache cleanup is non-critical; immutable orphan packs are safe to retain.
		}
	}

	private emit(locale: NonEnglishLangCode): void {
		const status = this.getStatus(locale);
		for (const listener of this.listeners) {
			try {
				listener(status);
			} catch (error) {
				console.warn('Operon: language pack status listener failed', error);
			}
		}
	}
}

async function fetchLocalePack(url: string): Promise<LocalePackFetchResponse> {
	try {
		const response = await requestUrl({ url, throw: false });
		return { status: response.status, text: response.text };
	} catch (error) {
		throw new LocalePackError(`Language pack download failed: ${getErrorMessage(error)}`, 'network');
	}
}

function validateCacheManifest(value: unknown): LocalePackCacheManifest {
	if (!isPlainRecord(value) || value.version !== LOCALE_CACHE_MANIFEST_VERSION || !isPlainRecord(value.locales)) {
		throw new LocalePackError('Language pack cache manifest is invalid.', 'storage');
	}
	const locales: LocalePackCacheManifest['locales'] = {};
	for (const [locale, record] of Object.entries(value.locales)) {
		if (!isNonEnglishLangCode(locale) || !isInstalledRecord(record)) continue;
		locales[locale] = record;
	}
	return { version: LOCALE_CACHE_MANIFEST_VERSION, locales };
}

function isInstalledRecord(value: unknown): value is InstalledLocalePackRecord {
	return isPlainRecord(value)
		&& typeof value.fileName === 'string'
		&& /^[A-Za-z0-9._-]+$/u.test(value.fileName)
		&& typeof value.sha256 === 'string'
		&& /^[a-f0-9]{64}$/u.test(value.sha256)
		&& Number.isSafeInteger(value.sizeBytes)
		&& Number(value.sizeBytes) > 0
		&& Number(value.sizeBytes) <= MAX_LOCALE_PACK_BYTES
		&& Number.isSafeInteger(value.schemaVersion)
		&& typeof value.sourceVersion === 'string'
		&& Number.isSafeInteger(value.keyCount)
		&& typeof value.keyFingerprint === 'string'
		&& /^[a-f0-9]{64}$/u.test(value.keyFingerprint)
		&& typeof value.installedAt === 'string';
}

function createEmptyManifest(): LocalePackCacheManifest {
	return { version: LOCALE_CACHE_MANIFEST_VERSION, locales: {} };
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new LocalePackError('Language pack JSON is malformed.');
	}
}

function uniqueLocales(locales: readonly NonEnglishLangCode[]): NonEnglishLangCode[] {
	return [...new Set(locales)];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEnglishLangCode(value: string): value is NonEnglishLangCode {
	return value === 'tr'
		|| value === 'de'
		|| value === 'fr'
		|| value === 'es'
		|| value === 'zh-CN'
		|| value === 'zh-TW'
		|| value === 'ja'
		|| value === 'ru';
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
