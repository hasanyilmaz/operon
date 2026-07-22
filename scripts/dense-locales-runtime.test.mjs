import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import { LOCALE_DEFINITIONS } from './generate-dense-locales.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDirectory = path.join(repoRoot, 'i18n/locales');

function readLocales() {
	return Object.fromEntries(LOCALE_DEFINITIONS.map(definition => [
		definition.code,
		JSON.parse(fs.readFileSync(path.join(localeDirectory, definition.file), 'utf8')),
	]));
}

async function loadDenseRuntime(t) {
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-dense-runtime-'));
	t.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
	const outfile = path.join(tempDirectory, 'dense-runtime.mjs');
	await build({
		stdin: {
			contents: [
				"export { activateI18nLocale, getCurrentLang, getTranslations, initI18n, installI18nLocale, resolveSupportedLocale, t } from './src/core/i18n';",
				"export { normalizeColorPalette } from './src/core/color-palette';",
				"export { default as densePack } from './src/generated/dense-locales.json';",
			].join('\n'),
			resolveDir: repoRoot,
			sourcefile: 'dense-runtime-entry.ts',
			loader: 'ts',
		},
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	return import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
}

function expectedTranslations(locales, category, key) {
	const values = LOCALE_DEFINITIONS
		.map(definition => locales[definition.code][category]?.[key])
		.filter(value => typeof value === 'string' && value.length > 0);
	return [...new Set(values)];
}

test('English-only runtime installs keyed language packs and preserves i18n behavior', async t => {
	const runtime = await loadDenseRuntime(t);
	const locales = readLocales();
	const { densePack } = runtime;

	assert.deepEqual(densePack.languageOrder, ['en']);
	assert.deepEqual(Object.keys(densePack.locales), ['en']);
	assert.equal(densePack.keyCount, 2_947);
	const indexes = Object.values(densePack.keyIndex)
		.flatMap(category => Object.values(category))
		.sort((left, right) => left - right);
	assert.equal(indexes.length, densePack.keyCount);
	assert.equal(indexes[0], 0);
	assert.equal(indexes[indexes.length - 1], densePack.keyCount - 1);
	assert.equal(new Set(indexes).size, densePack.keyCount);
	const localizedRed = locales.tr.taskEditor.colorNameRed;
	const preinstallNormalizedPalette = runtime.normalizeColorPalette([
		{ id: 'red', name: localizedRed, hex: '#DC2626' },
	]);
	assert.equal(
		preinstallNormalizedPalette.find(entry => entry.id === 'red')?.name,
		'Red',
		'legacy localized color defaults must normalize before remote packs load',
	);

	for (const definition of LOCALE_DEFINITIONS.filter(definition => definition.code !== 'en')) {
		runtime.installI18nLocale(definition.code, locales[definition.code]);
	}
	for (const definition of LOCALE_DEFINITIONS) {
		runtime.initI18n(undefined, definition.code);
		assert.equal(runtime.getCurrentLang(), definition.code);
		for (const [category, entries] of Object.entries(locales[definition.code])) {
			for (const [key, expected] of Object.entries(entries)) {
				assert.equal(runtime.t(category, key), expected, `${definition.code}:${category}.${key}`);
			}
		}
	}

	runtime.initI18n(undefined, 'en');
	for (const [category, entries] of Object.entries(locales.en)) {
		for (const key of Object.keys(entries)) {
			assert.deepEqual(
				runtime.getTranslations(category, key),
				expectedTranslations(locales, category, key),
				`getTranslations:${category}.${key}`,
			);
		}
	}

	assert.equal(runtime.t('modals', 'releaseNotesVersion', { version: '9.9.9' }), 'Version 9.9.9');
	assert.equal(runtime.t('missing', 'unknownKey'), 'unknownKey');
	assert.deepEqual(runtime.getTranslations('missing', 'unknownKey'), []);

	const [fallbackCategory, fallbackEntries] = Object.entries(densePack.keyIndex)[0];
	const [fallbackKey, fallbackIndex] = Object.entries(fallbackEntries)[0];
	const partialTurkish = structuredClone(locales.tr);
	delete partialTurkish[fallbackCategory][fallbackKey];
	runtime.installI18nLocale('tr', partialTurkish);
	runtime.initI18n(undefined, 'tr');
	assert.equal(runtime.t(fallbackCategory, fallbackKey), densePack.locales.en[fallbackIndex]);
	runtime.installI18nLocale('tr', locales.tr);

	for (const locale of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG']) {
		assert.equal(runtime.resolveSupportedLocale(locale), 'zh-CN', locale);
		runtime.initI18n(locale, undefined);
		assert.equal(runtime.getCurrentLang(), 'zh-CN', locale);
	}
	for (const locale of ['zh-TW', 'zh-Hant', 'zh-HK', 'zh-MO']) {
		assert.equal(runtime.resolveSupportedLocale(locale), 'zh-TW', locale);
		runtime.initI18n(locale, undefined);
		assert.equal(runtime.getCurrentLang(), 'zh-TW', locale);
	}
	runtime.initI18n('zh-HK', 'zh-CN');
	assert.equal(runtime.getCurrentLang(), 'zh-CN');
	runtime.initI18n('xx-XX', 'unsupported');
	assert.equal(runtime.getCurrentLang(), 'en');
	assert.equal(runtime.resolveSupportedLocale('xx-XX'), null);
	for (const language of ['en', 'tr', 'zh-TW', 'en']) {
		runtime.initI18n(undefined, language);
		assert.equal(runtime.getCurrentLang(), language);
	}

	const normalizedPalette = runtime.normalizeColorPalette([
		{ id: 'red', name: localizedRed, hex: '#DC2626' },
	]);
	assert.equal(normalizedPalette.find(entry => entry.id === 'red')?.name, 'Red');
	runtime.initI18n(undefined, 'en');
});
