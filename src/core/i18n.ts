/**
 * Internationalization (i18n) module for Operon.
 * Multilingual support: English (default) + Turkish + German + French.
 *
 * Spec Section 25:
 * - JSON locale files at i18n/locales/
 * - Only user-facing UI is translated
 * - System internals (field names, YAML keys, paths) stay in English
 * - {{variableName}} placeholder syntax
 * - Language detection from Obsidian's locale setting
 * - Fallback to English if locale not found
 */

import en from '../../i18n/locales/en.json';
import tr from '../../i18n/locales/tr.json';
import de from '../../i18n/locales/de.json';
import fr from '../../i18n/locales/fr.json';

/** All available locale data, keyed by language code */
const LOCALES: Record<string, LocaleData> = { en, tr, de, fr };

/** Supported language codes */
export type LangCode = 'en' | 'tr' | 'de' | 'fr';

/** Structure of a locale file — matches Spec Section 25.4 */
export interface LocaleData {
	commands: Record<string, string>;
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
	taskEditor: Record<string, string>;
	indexStats: Record<string, string>;
	pinnedTasks: Record<string, string>;
}

/** Active language state */
let currentLang: LangCode = 'en';
let currentLocale: LocaleData = en;

/**
 * Initialize i18n.
 * If languageOverride is 'en' or 'tr', use that directly.
 * If languageOverride is 'auto' (or undefined), detect from Obsidian's locale.
 * Falls back to English if the detected locale isn't available.
 *
 * Spec Section 25.7: Detection flow.
 */
export function initI18n(obsidianLocale?: string, languageOverride?: string): void {
	let lang: string;

	if (languageOverride && languageOverride !== 'auto' && languageOverride in LOCALES) {
		lang = languageOverride;
	} else {
		lang = obsidianLocale?.substring(0, 2)?.toLowerCase() ?? 'en';
	}

	if (lang in LOCALES) {
		currentLang = lang as LangCode;
		currentLocale = LOCALES[lang];
	} else {
		currentLang = 'en';
		currentLocale = en;
	}
}

/**
 * Get a translated string by category and key.
 * Supports {{variableName}} placeholder substitution.
 *
 * @param category - Locale file category (commands, notifications, etc.)
 * @param key - Translation key within the category
 * @param vars - Optional variable replacements for {{placeholders}}
 * @returns Translated string, or the key itself as fallback
 */
export function t(
	category: keyof LocaleData,
	key: string,
	vars?: Record<string, string>,
): string {
	// Try current locale first
	const cat = currentLocale[category] as Record<string, string> | undefined;
	let str = cat?.[key];

	// Fallback to English
	if (!str && currentLang !== 'en') {
		const enCat = (en as LocaleData)[category] as Record<string, string> | undefined;
		str = enCat?.[key];
	}

	// Final fallback: return the key
	if (!str) return key;

	// Replace {{placeholders}}
	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			str = str.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), value);
		}
	}

	return str;
}

/** Get the current language code */
export function getCurrentLang(): LangCode {
	return currentLang;
}
