import type { LangCode, LocaleData, NonEnglishLangCode } from './i18n';

export const LOCALE_PACK_SCHEMA_VERSION = 1;
export const MAX_LOCALE_PACK_BYTES = 1_000_000;

export type LocaleTranslations = Partial<{
	[Category in keyof LocaleData]: Partial<LocaleData[Category]>;
}>;

export interface LocalePack {
	schemaVersion: number;
	locale: NonEnglishLangCode;
	sourceVersion: string;
	keyCount: number;
	keyFingerprint: string;
	translations: LocaleTranslations;
}

export interface LocalePackCatalogEntry {
	assetName: string;
	url: string;
	sha256: string;
	sizeBytes: number;
	sourceVersion: string;
}

export interface LocalePackCatalog {
	schemaVersion: number;
	sourceVersion: string;
	keyCount: number;
	keyFingerprint: string;
	languageOrder: NonEnglishLangCode[];
	locales: Record<NonEnglishLangCode, LocalePackCatalogEntry>;
}

export interface LocaleKeyIndex {
	[category: string]: Record<string, number> | undefined;
}

export interface ExpectedLocalePack {
	locale: NonEnglishLangCode;
	catalog: LocalePackCatalog;
	entry: LocalePackCatalogEntry;
}

export class LocalePackError extends Error {
	constructor(
		message: string,
		public readonly kind: 'invalid' | 'integrity' | 'network' | 'storage' = 'invalid',
	) {
		super(message);
		this.name = 'LocalePackError';
	}
}

export function validateLocalePack(
	value: unknown,
	expected?: ExpectedLocalePack,
): LocalePack {
	if (!isPlainRecord(value)) throw new LocalePackError('Language pack root must be an object.');
	if (value.schemaVersion !== LOCALE_PACK_SCHEMA_VERSION) {
		throw new LocalePackError('Unsupported language pack schema.', 'invalid');
	}
	if (!isNonEnglishLangCode(value.locale)) throw new LocalePackError('Unsupported language pack locale.');
	if (typeof value.sourceVersion !== 'string' || !isSha256(value.sourceVersion)) {
		throw new LocalePackError('Language pack sourceVersion is invalid.');
	}
	if (!Number.isSafeInteger(value.keyCount) || Number(value.keyCount) <= 0 || Number(value.keyCount) > 10_000) {
		throw new LocalePackError('Language pack keyCount is invalid.');
	}
	if (typeof value.keyFingerprint !== 'string' || !isSha256(value.keyFingerprint)) {
		throw new LocalePackError('Language pack keyFingerprint is invalid.');
	}
	if (!isPlainRecord(value.translations)) throw new LocalePackError('Language pack translations are invalid.');

	let keyCount = 0;
	for (const [category, entries] of Object.entries(value.translations)) {
		if (!category || !isPlainRecord(entries)) {
			throw new LocalePackError(`Language pack category ${category || '(empty)'} is invalid.`);
		}
		for (const [key, translation] of Object.entries(entries)) {
			if (!key || typeof translation !== 'string') {
				throw new LocalePackError(`Language pack value ${category}.${key || '(empty)'} must be a string.`);
			}
			keyCount += 1;
		}
	}
	if (keyCount !== value.keyCount) {
		throw new LocalePackError(`Language pack key count mismatch: expected ${String(value.keyCount)}, found ${keyCount}.`);
	}

	if (expected) {
		if (value.locale !== expected.locale) throw new LocalePackError('Language pack locale does not match the request.');
		if (value.schemaVersion !== expected.catalog.schemaVersion) {
			throw new LocalePackError('Language pack schema does not match the catalog.');
		}
		if (value.sourceVersion !== expected.entry.sourceVersion) {
			throw new LocalePackError('Language pack content version does not match the catalog.');
		}
		if (value.keyCount !== expected.catalog.keyCount || value.keyFingerprint !== expected.catalog.keyFingerprint) {
			throw new LocalePackError('Language pack key set does not match the catalog.');
		}
	}

	return value as unknown as LocalePack;
}

export function compileLocalePack(
	pack: Pick<LocalePack, 'translations'>,
	keyIndex: LocaleKeyIndex,
	keyCount: number,
): string[] {
	const compiled = new Array<string>(keyCount).fill('');
	for (const [category, entries] of Object.entries(pack.translations)) {
		const categoryIndex = keyIndex[category];
		if (!categoryIndex || !entries) continue;
		for (const [key, value] of Object.entries(entries)) {
			const index = categoryIndex[key];
			if (index === undefined || typeof value !== 'string') continue;
			compiled[index] = value;
		}
	}
	return compiled;
}

export function validateLocalePackCatalog(value: unknown): LocalePackCatalog {
	if (!isPlainRecord(value)) throw new LocalePackError('Language pack catalog root must be an object.');
	if (value.schemaVersion !== LOCALE_PACK_SCHEMA_VERSION) {
		throw new LocalePackError('Unsupported language pack catalog schema.');
	}
	if (typeof value.sourceVersion !== 'string' || !value.sourceVersion.trim()) {
		throw new LocalePackError('Language pack catalog sourceVersion is invalid.');
	}
	if (!Number.isSafeInteger(value.keyCount) || Number(value.keyCount) <= 0 || Number(value.keyCount) > 10_000) {
		throw new LocalePackError('Language pack catalog keyCount is invalid.');
	}
	if (typeof value.keyFingerprint !== 'string' || !isSha256(value.keyFingerprint)) {
		throw new LocalePackError('Language pack catalog keyFingerprint is invalid.');
	}
	if (!Array.isArray(value.languageOrder) || !isPlainRecord(value.locales)) {
		throw new LocalePackError('Language pack catalog locale inventory is invalid.');
	}
	if (value.languageOrder.some(language => !isNonEnglishLangCode(language))
		|| new Set(value.languageOrder).size !== value.languageOrder.length) {
		throw new LocalePackError('Language pack catalog languageOrder is invalid.');
	}
	const languageOrder = value.languageOrder.filter(isNonEnglishLangCode);
	const localeKeys = Object.keys(value.locales);
	const languageSet: ReadonlySet<string> = new Set(languageOrder);
	if (localeKeys.length !== languageOrder.length || localeKeys.some(language => !languageSet.has(language))) {
		throw new LocalePackError('Language pack catalog locale inventory does not align.');
	}
	for (const language of languageOrder) {
		const entry = value.locales[language];
		if (!isPlainRecord(entry)
			|| typeof entry.assetName !== 'string'
			|| !entry.assetName
			|| typeof entry.url !== 'string'
			|| !entry.url.startsWith('https://')
			|| typeof entry.sha256 !== 'string'
			|| !isSha256(entry.sha256)
			|| !Number.isSafeInteger(entry.sizeBytes)
			|| Number(entry.sizeBytes) <= 0
			|| Number(entry.sizeBytes) > MAX_LOCALE_PACK_BYTES
			|| typeof entry.sourceVersion !== 'string'
			|| !isSha256(entry.sourceVersion)) {
			throw new LocalePackError(`Language pack catalog entry ${language} is invalid.`);
		}
	}
	return value as unknown as LocalePackCatalog;
}

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

export async function sha256Hex(value: string): Promise<string> {
	const subtle = (typeof window === 'undefined' ? crypto : window.crypto)?.subtle;
	if (!subtle) throw new LocalePackError('SHA-256 is unavailable in this runtime.', 'integrity');
	const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value: string): boolean {
	return /^[a-f0-9]{64}$/u.test(value);
}

function isNonEnglishLangCode(value: unknown): value is NonEnglishLangCode {
	return typeof value === 'string' && value !== 'en' && isLangCode(value);
}

function isLangCode(value: string): value is LangCode {
	return value === 'en'
		|| value === 'tr'
		|| value === 'de'
		|| value === 'fr'
		|| value === 'es'
		|| value === 'zh-CN'
		|| value === 'zh-TW'
		|| value === 'ja'
		|| value === 'ru';
}
