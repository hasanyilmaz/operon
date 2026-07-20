import assert from 'node:assert/strict';
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	NON_ENGLISH_LANGUAGE_OPTIONS,
	migrateLegacyLanguageSettings,
	migrateSettings,
	preserveCanonicalLanguageForLegacyReload,
} from '../src/types/settings';
import { buildLanguagePackDropdownOptions } from '../src/ui/language-pack-options';
import {
	buildLocalePackReconcileOrder,
	hasLocalePackIntentChanged,
	shouldActivateReconciledLocale,
} from '../src/core/locale-pack-orchestration';

let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	const fresh = migrateSettings({});
	equal(fresh.language, 'en', 'fresh installs default to English');
	deepEqual(fresh.languagePackSubscriptions, [], 'fresh installs have no subscriptions');

	const legacyEnglish = migrateSettings(migrateLegacyLanguageSettings({ settingsVersion: 106, language: 'en' }, 'tr'));
	equal(legacyEnglish.language, 'en');
	deepEqual(legacyEnglish.languagePackSubscriptions, []);

	for (const language of NON_ENGLISH_LANGUAGE_OPTIONS) {
		const migrated = migrateSettings(migrateLegacyLanguageSettings({ settingsVersion: 106, language }, 'en'));
		equal(migrated.language, language, `explicit ${language} is preserved`);
		deepEqual(migrated.languagePackSubscriptions, [language], `explicit ${language} is subscribed`);
	}

	const autoCases = [
		['en', 'en'],
		['tr-TR', 'tr'],
		['de-DE', 'de'],
		['zh-Hant', 'zh-TW'],
		['pt-BR', 'en'],
	] as const;
	for (const [obsidianLocale, expected] of autoCases) {
		const migrated = migrateSettings(migrateLegacyLanguageSettings({ settingsVersion: 106, language: 'auto' }, obsidianLocale));
		equal(migrated.language, expected, `auto resolves ${obsidianLocale}`);
		deepEqual(migrated.languagePackSubscriptions, expected === 'en' ? [] : [expected]);
	}

	const missing = migrateSettings(migrateLegacyLanguageSettings({ settingsVersion: 106 }, 'fr-FR'));
	equal(missing.language, 'fr', 'missing legacy language resolves once');
	deepEqual(missing.languagePackSubscriptions, ['fr']);

	const corrupt = migrateSettings(migrateLegacyLanguageSettings({ settingsVersion: 106, language: 42 }, 'tr'));
	equal(corrupt.language, 'en', 'corrupt explicit language falls back to English');
	deepEqual(corrupt.languagePackSubscriptions, []);

	const normalized = migrateSettings(migrateLegacyLanguageSettings({
		settingsVersion: 106,
		language: 'de',
		languagePackSubscriptions: ['tr', 'tr', 'en', 'invalid'],
	}, 'en'));
	deepEqual(normalized.languagePackSubscriptions, ['tr', 'de'], 'subscriptions are unique, valid, and include active locale');

	const secondPass = migrateLegacyLanguageSettings({
		settingsVersion: CURRENT_SETTINGS_VERSION,
		language: 'en',
		languagePackSubscriptions: [],
	}, 'de-DE');
	equal(secondPass.language, 'en', 'current schema does not re-run locale detection');
	deepEqual(secondPass.languagePackSubscriptions, []);

	const delayedLegacyReload = preserveCanonicalLanguageForLegacyReload({
		settingsVersion: 106,
		language: 'auto',
		languagePackSubscriptions: [],
		timeFormat: '12h',
	}, {
		settingsVersion: CURRENT_SETTINGS_VERSION,
		language: 'de',
		languagePackSubscriptions: ['tr', 'de'],
	});
	equal(delayedLegacyReload.language, 'de', 'delayed legacy reload preserves canonical explicit language');
	deepEqual(delayedLegacyReload.languagePackSubscriptions, ['tr', 'de']);
	equal(delayedLegacyReload.timeFormat, '12h', 'non-language incoming settings still merge');
	const repeatedLegacyReload = preserveCanonicalLanguageForLegacyReload(delayedLegacyReload, {
		settingsVersion: CURRENT_SETTINGS_VERSION,
		language: 'de',
		languagePackSubscriptions: ['tr', 'de'],
	});
	equal(repeatedLegacyReload.language, 'de', 'legacy reload never re-runs Obsidian locale detection');

	deepEqual(buildLocalePackReconcileOrder({
		language: 'de',
		languagePackSubscriptions: ['tr', 'de', 'ja', 'tr'],
	}), ['de', 'tr', 'ja'], 'active locale is reconciled first and subscriptions are deduplicated');
	deepEqual(buildLocalePackReconcileOrder({
		language: 'en',
		languagePackSubscriptions: ['tr', 'ja'],
	}), ['tr', 'ja'], 'English leaves subscribed packs in stable order');
	equal(hasLocalePackIntentChanged({
		language: 'en',
		languagePackSubscriptions: ['tr'],
	}, {
		language: 'de',
		languagePackSubscriptions: ['tr', 'de'],
	}), true, 'canonical language changes trigger reconciliation');
	equal(hasLocalePackIntentChanged({
		language: 'de',
		languagePackSubscriptions: ['de', 'tr'],
	}, {
		language: 'de',
		languagePackSubscriptions: ['de', 'tr'],
	}), false, 'unchanged canonical locale intent does not trigger reconciliation');
	equal(shouldActivateReconciledLocale('de', 'de'), true);
	equal(shouldActivateReconciledLocale('de', 'en'), false, 'late download cannot reactivate a no-longer-selected locale');

	equal(DEFAULT_SETTINGS.language, 'en');
	deepEqual(DEFAULT_SETTINGS.languagePackSubscriptions, []);

	const optionStates = {
		de: { installed: false, updateAvailable: false, activity: 'idle' as const },
		es: { installed: false, updateAvailable: false, activity: 'downloading' as const },
		fr: { installed: true, updateAvailable: false, activity: 'idle' as const },
		ja: { installed: true, updateAvailable: true, activity: 'idle' as const },
		tr: { installed: true, updateAvailable: true, activity: 'updating' as const },
	};
	const options = buildLanguagePackDropdownOptions({
		english: { value: 'en', label: 'English' },
		languages: [
			{ value: 'tr', label: 'Turkish' },
			{ value: 'ja', label: 'Japanese' },
			{ value: 'fr', label: 'French' },
			{ value: 'es', label: 'Spanish' },
			{ value: 'de', label: 'German' },
		],
		locale: 'en',
		getStatus: language => optionStates[language as keyof typeof optionStates],
		statusLabels: {
			download: 'Download',
			downloading: 'Downloading…',
			update: 'Update',
			updating: 'Updating…',
		},
	});
	deepEqual(options.map(option => option.label), [
		'English',
		'French',
		'German — Download',
		'Japanese — Update',
		'Spanish — Downloading…',
		'Turkish — Updating…',
	], 'pure option builder sorts base labels and exposes every pack state');
	console.log(`Locale settings migration tests passed: ${assertions} assertions`);
}

declare global {
	var __operonLocaleSettingsMigrationTestRun: Promise<void> | undefined;
}

globalThis.__operonLocaleSettingsMigrationTestRun = run();
