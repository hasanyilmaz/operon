/**
 * Internationalization runtime for Operon.
 *
 * English is embedded in main.js. Other supported languages are keyed, data-only
 * packs that are validated and cached by LocalePackManager before being installed
 * into this in-memory runtime.
 */

import denseLocales from '../generated/dense-locales.json';
import generatedCompatibilityAliases from '../generated/locale-compatibility-aliases.json';
import { compileLocalePack, type LocaleTranslations } from './locale-pack';

/** Supported language codes. */
export type LangCode = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'zh-CN' | 'zh-TW' | 'ja' | 'ru';
export type NonEnglishLangCode = Exclude<LangCode, 'en'>;

export const SUPPORTED_LANGUAGES: readonly LangCode[] = [
	'en',
	'tr',
	'de',
	'fr',
	'es',
	'zh-CN',
	'zh-TW',
	'ja',
	'ru',
];

const SUPPORTED_LANGUAGE_SET: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

/** Structure of a locale source file. */
export interface LocaleData {
	commands: Record<string, string>;
	presetFavorites: Record<string, string>;
	contextMenu: Record<string, string>;
	modals: Record<string, string>;
	notifications: Record<string, string>;
	duplicateOperonId: Record<string, string>;
	settings: Record<string, string>;
	buttons: Record<string, string>;
	tooltips: Record<string, string>;
	errors: Record<string, string>;
	calendar: Record<string, string>;
	filters: Record<string, string>;
	filterSets: Record<string, string>;
	location: Record<string, string>;
	reminders: Record<string, string>;
	taskEditor: Record<string, string>;
	indexStats: Record<string, string>;
	pinnedTasks: Record<string, string>;
	table: Record<string, string>;
}

interface EmbeddedLocalePack {
	schemaVersion: number;
	languageOrder: string[];
	keyCount: number;
	keyIndex: Partial<Record<keyof LocaleData, Record<string, number>>>;
	locales: { en: string[] };
}

const EMBEDDED_LOCALES = denseLocales as unknown as EmbeddedLocalePack;
const LOCALE_KEY_INDEX = EMBEDDED_LOCALES.keyIndex;
const ENGLISH_LOCALE: readonly string[] = EMBEDDED_LOCALES.locales.en;
const COMPATIBILITY_ALIASES = generatedCompatibilityAliases as Partial<
	Record<keyof LocaleData, Record<string, string[]>>
>;
const installedLocales = new Map<LangCode, readonly string[]>([['en', ENGLISH_LOCALE]]);

let currentLang: LangCode = 'en';
let currentLocale: readonly string[] = ENGLISH_LOCALE;

/**
 * Maps an Obsidian/browser locale string to an Operon-supported language.
 * This is deliberately independent from which language packs are installed.
 */
export function resolveSupportedLocale(rawLocale: string): LangCode | null {
	const lower = rawLocale.trim().toLowerCase();
	if (!lower) return null;

	if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-hans') || lower.startsWith('zh-sg')) {
		return 'zh-CN';
	}
	if (lower.startsWith('zh-tw') || lower.startsWith('zh-hant') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) {
		return 'zh-TW';
	}

	const short = lower.substring(0, 2);
	return SUPPORTED_LANGUAGE_SET.has(short) ? short as LangCode : null;
}

export function isSupportedLanguage(value: string): value is LangCode {
	return SUPPORTED_LANGUAGE_SET.has(value);
}

export function isNonEnglishLanguage(value: string): value is NonEnglishLangCode {
	return value !== 'en' && isSupportedLanguage(value);
}

/**
 * Initializes the active locale from already-installed in-memory packs.
 * Missing remote packs always fall back to embedded English without changing
 * the persisted user preference owned by the settings layer.
 */
export function initI18n(obsidianLocale?: string, languageOverride?: string): void {
	let requested: LangCode | null = null;
	if (languageOverride && languageOverride !== 'auto' && isSupportedLanguage(languageOverride)) {
		requested = languageOverride;
	} else if (obsidianLocale) {
		requested = resolveSupportedLocale(obsidianLocale);
	}
	if (!requested || !activateI18nLocale(requested)) resetI18nToEnglish();
}

/** Compiles and installs a previously validated keyed language pack in memory. */
export function installI18nLocale(locale: NonEnglishLangCode, translations: LocaleTranslations): void {
	const compiled = compileLocalePack(
		{ translations },
		LOCALE_KEY_INDEX,
		EMBEDDED_LOCALES.keyCount,
	);
	installedLocales.set(locale, compiled);
}

/** Activates an installed locale. Returns false without changing state when unavailable. */
export function activateI18nLocale(locale: LangCode): boolean {
	const installed = installedLocales.get(locale);
	if (!installed) return false;
	currentLang = locale;
	currentLocale = installed;
	return true;
}

export function hasI18nLocale(locale: LangCode): boolean {
	return installedLocales.has(locale);
}

export function removeI18nLocale(locale: NonEnglishLangCode): void {
	installedLocales.delete(locale);
	if (currentLang === locale) resetI18nToEnglish();
}

export function resetI18nToEnglish(): void {
	currentLang = 'en';
	currentLocale = ENGLISH_LOCALE;
}

/**
 * Gets a translated string by category and key, with English and key fallbacks.
 */
export function t(
	category: keyof LocaleData,
	key: string,
	vars?: Record<string, string>,
): string {
	const index = LOCALE_KEY_INDEX[category]?.[key];
	let str = index === undefined ? undefined : currentLocale[index];
	if (!str && currentLang !== 'en') str = index === undefined ? undefined : ENGLISH_LOCALE[index];
	if (!str) return key;

	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			str = str.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), value);
		}
	}
	return str;
}

/** Gets all translations currently installed in memory for a key. */
export function getTranslations(category: keyof LocaleData, key: string): string[] {
	const index = LOCALE_KEY_INDEX[category]?.[key];
	const installedValues = index === undefined
		? []
		: SUPPORTED_LANGUAGES
			.map(language => installedLocales.get(language)?.[index])
			.filter((value): value is string => typeof value === 'string' && value.length > 0);
	const values = [...installedValues, ...(COMPATIBILITY_ALIASES[category]?.[key] ?? [])];
	return [...new Set(values)];
}

export function getCurrentLang(): LangCode {
	return currentLang;
}
