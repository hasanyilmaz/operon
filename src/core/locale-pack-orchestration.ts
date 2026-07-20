import type { LangCode, NonEnglishLangCode } from './i18n';

export interface LocalePackIntent {
	language: LangCode;
	languagePackSubscriptions: readonly NonEnglishLangCode[];
}

export function buildLocalePackReconcileOrder(intent: LocalePackIntent): NonEnglishLangCode[] {
	const active = intent.language === 'en' ? null : intent.language;
	return [...new Set(active
		? [active, ...intent.languagePackSubscriptions]
		: intent.languagePackSubscriptions)];
}

export function hasLocalePackIntentChanged(before: LocalePackIntent, after: LocalePackIntent): boolean {
	if (before.language !== after.language) return true;
	if (before.languagePackSubscriptions.length !== after.languagePackSubscriptions.length) return true;
	return before.languagePackSubscriptions.some((language, index) =>
		language !== after.languagePackSubscriptions[index]);
}

export function shouldActivateReconciledLocale(
	downloadedLocale: NonEnglishLangCode,
	currentLanguage: LangCode,
): boolean {
	return downloadedLocale === currentLanguage;
}
