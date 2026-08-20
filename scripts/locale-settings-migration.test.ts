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
import {
	isTableAdminColumnKey,
	isTablePersistedColumnReservedKey,
} from '../src/types/table';

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
		['pt', 'pt-BR'],
		['pt-BR', 'pt-BR'],
		['pt-BR-x-private', 'pt-BR'],
		['pt-PT', 'en'],
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

	const legacySystemMappings = JSON.parse(JSON.stringify(
		DEFAULT_SETTINGS.keyMappings.filter(mapping => !['taskType', 'taskImage', 'taskGallery'].includes(mapping.canonicalKey)),
	));
	const normalSettingsInitialization = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: legacySystemMappings,
	});
	equal(normalSettingsInitialization.settingsVersion, CURRENT_SETTINGS_VERSION, 'normal settings initialization advances the settings version once');
	deepEqual(
		normalSettingsInitialization.keyMappings
			.filter(mapping => ['taskType', 'taskImage', 'taskGallery'].includes(mapping.canonicalKey))
			.map(mapping => ({ canonicalKey: mapping.canonicalKey, type: mapping.type, sync: mapping.sync, isSystem: mapping.isSystem })),
		[
			{ canonicalKey: 'taskType', type: 'text', sync: 'yes', isSystem: true },
			{ canonicalKey: 'taskImage', type: 'text', sync: 'yes', isSystem: true },
			{ canonicalKey: 'taskGallery', type: 'list', sync: 'yes', isSystem: true },
		],
		'normal settings initialization adds the three canonical system mappings with their declared value types',
	);
	const retiredAdminMapping = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: [
			...legacySystemMappings,
			{
				canonicalKey: '__taskType',
				visiblePropertyName: 'Legacy Task Type',
				type: 'text',
				sync: 'yes',
				enabled: true,
				isSystem: false,
			},
		],
	});
	equal(
		retiredAdminMapping.keyMappings.some(mapping => mapping.canonicalKey === '__taskType'),
		false,
		'The retired __taskType admin key must not remain an active writable custom mapping.',
	);
	const exactCollision = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: [
			...legacySystemMappings,
			{
				canonicalKey: 'TASKTYPE',
				visiblePropertyName: 'UserTaskClassification',
				type: 'list',
				sync: 'no',
				enabled: true,
				isSystem: false,
			},
			{
				canonicalKey: 'TASKIMAGE',
				visiblePropertyName: 'UserTaskCover',
				type: 'list',
				sync: 'no',
				enabled: true,
				isSystem: false,
			},
			{
				canonicalKey: 'TASKGALLERY',
				visiblePropertyName: 'UserTaskMedia',
				type: 'text',
				sync: 'no',
				enabled: true,
				isSystem: false,
			},
		],
	});
	deepEqual(
		exactCollision.keyMappings
			.filter(mapping => ['taskType', 'taskImage', 'taskGallery'].includes(mapping.canonicalKey))
			.map(mapping => ({
				canonicalKey: mapping.canonicalKey,
				visiblePropertyName: mapping.visiblePropertyName,
				type: mapping.type,
				sync: mapping.sync,
				isSystem: mapping.isSystem,
			})),
		[
			{ canonicalKey: 'taskType', visiblePropertyName: 'UserTaskClassification', type: 'text', sync: 'yes', isSystem: true },
			{ canonicalKey: 'taskImage', visiblePropertyName: 'UserTaskCover', type: 'text', sync: 'yes', isSystem: true },
			{ canonicalKey: 'taskGallery', visiblePropertyName: 'UserTaskMedia', type: 'list', sync: 'yes', isSystem: true },
		],
		'exact canonical collisions hand each user property name to one system mapping with its declared type',
	);

	const visibleCollision = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: [
			...legacySystemMappings,
			{ canonicalKey: 'customType', visiblePropertyName: 'TASKTYPE', type: 'text', sync: 'yes', enabled: true, isSystem: false },
			{ canonicalKey: 'customOperonType', visiblePropertyName: 'operontasktype', type: 'text', sync: 'yes', enabled: true, isSystem: false },
			{ canonicalKey: 'customImage', visiblePropertyName: 'TASKIMAGE', type: 'text', sync: 'yes', enabled: true, isSystem: false },
			{ canonicalKey: 'customGallery', visiblePropertyName: 'TASKGALLERY', type: 'text', sync: 'yes', enabled: true, isSystem: false },
			{ canonicalKey: 'customOperonGallery', visiblePropertyName: 'operontaskgallery', type: 'text', sync: 'yes', enabled: true, isSystem: false },
		],
	});
	equal(visibleCollision.keyMappings.find(mapping => mapping.canonicalKey === 'customType')?.isSystem, false, 'visible-only collision preserves the custom mapping');
	equal(visibleCollision.keyMappings.find(mapping => mapping.canonicalKey === 'taskType')?.visiblePropertyName, 'OperonTaskType2', 'visible-only collision assigns the first case-insensitive free Operon fallback');
	equal(visibleCollision.keyMappings.find(mapping => mapping.canonicalKey === 'taskImage')?.visiblePropertyName, 'OperonTaskImage', 'taskImage visible-only collision assigns its deterministic Operon fallback');
	equal(visibleCollision.keyMappings.find(mapping => mapping.canonicalKey === 'taskGallery')?.visiblePropertyName, 'OperonTaskGallery2', 'taskGallery visible-only collision assigns the first case-insensitive free suffix');

	const preservedFilter = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.filterSets[0]));
	const filterCondition = { id: 'cond_task_type_preserved', field: 'taskType', fieldType: 'text', operator: 'is', value: 'Research' };
	preservedFilter.rootGroup.children.push(filterCondition);
	preservedFilter.conditions.push(filterCondition);
	const migratedTableReferences = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: legacySystemMappings,
		filterSets: [preservedFilter],
		tablePresets: [{
			...DEFAULT_SETTINGS.tablePresets[0],
			columns: [{ key: 'taskType', kind: 'task' }, { key: '__taskType', kind: 'task' }, { key: '__taskDataType', kind: 'task' }, { key: 'description', kind: 'task' }],
			sortRules: [{ key: 'taskType', direction: 'asc', empty: 'last' }, { key: '__taskType', direction: 'desc', empty: 'first' }],
			groupBy: 'taskType',
			subgroupBy: 'status',
			summaries: [{ key: 'taskType', function: 'Count' }, { key: '__taskType', function: 'Count' }],
		}],
	});
	const migratedTable = migratedTableReferences.tablePresets[0]!;
	deepEqual(migratedTable.columns.map(column => column.key), ['__taskDataType', 'description'], 'legacy Table columns migrate and dedupe to Task Data Type');
	deepEqual(migratedTable.sortRules.map(rule => rule.key), ['__taskDataType'], 'legacy Table sort rules migrate and dedupe to Task Data Type');
	equal(migratedTable.groupBy, '__taskDataType', 'legacy Table group migrates to Task Data Type');
	equal(migratedTable.subgroupBy, 'status', 'unrelated Table subgroup remains intact when Task Data Type becomes the group');
	deepEqual(migratedTable.summaries.map(summary => summary.key), ['__taskDataType'], 'legacy Table summaries migrate and dedupe to Task Data Type');
	equal(isTableAdminColumnKey('__taskDataType'), true, 'Task Data Type remains valid for its injected admin-column path');
	equal(isTablePersistedColumnReservedKey('__taskDataType'), false, 'Task Data Type remains eligible for persisted Table columns and rules');
	equal(
		migratedTableReferences.filterSets[0]?.conditions.find(condition => condition.id === filterCondition.id)?.field,
		'taskType',
		'generic FilterSet conditions remain untouched',
	);
	deepEqual(migratedTableReferences.filterSets[0]?.conditions, preservedFilter.conditions, 'generic FilterSet condition payloads remain byte-for-byte equivalent as parsed JSON');
	const subgroupMigration = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 114,
		keyMappings: legacySystemMappings,
		tablePresets: [{
			...DEFAULT_SETTINGS.tablePresets[0],
			groupBy: 'status',
			subgroupBy: '__taskType',
		}],
	});
	equal(subgroupMigration.tablePresets[0]?.subgroupBy, '__taskDataType', 'legacy Table subgroup migrates to Task Data Type when it is distinct from the group');

	const currentSettingsTable = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: CURRENT_SETTINGS_VERSION,
		tablePresets: [{
			...DEFAULT_SETTINGS.tablePresets[0],
			columns: [{ key: 'taskType', kind: 'task' }, { key: '__taskDataType', kind: 'task' }],
			sortRules: [{ key: 'taskType', direction: 'asc', empty: 'last' }],
			groupBy: 'taskType',
			subgroupBy: '__taskDataType',
			summaries: [{ key: 'taskType', function: 'Count' }],
		}],
	});
	const currentTable = currentSettingsTable.tablePresets[0]!;
	deepEqual(currentTable.columns.map(column => column.key), ['taskType', '__taskDataType'], 'current settings preserve the real writable taskType column');
	equal(currentTable.groupBy, 'taskType', 'current settings preserve real taskType grouping');
	deepEqual(currentTable.sortRules.map(rule => rule.key), ['taskType'], 'current settings preserve real taskType sorting');
	deepEqual(currentTable.summaries.map(summary => summary.key), ['taskType'], 'current settings preserve real taskType summaries');
	console.log(`Locale settings migration tests passed: ${assertions} assertions`);
}

declare global {
	var __operonLocaleSettingsMigrationTestRun: Promise<void> | undefined;
}

globalThis.__operonLocaleSettingsMigrationTestRun = run();
