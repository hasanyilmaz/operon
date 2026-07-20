import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
	COMPATIBILITY_ALIAS_DEFINITIONS,
	LOCALE_DEFINITIONS,
	buildLocaleArtifacts,
	buildDenseLocalePack,
	checkDenseLocaleArtifact,
	createDenseLocaleArtifact,
	createLocaleCompatibilityAliasesArtifact,
	createLocaleCatalogArtifact,
	runDenseLocaleGenerator,
	serializeDenseLocalePack,
	writeDenseLocaleArtifact,
	writeFileAtomically,
} from './generate-dense-locales.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readTypeScriptSource(relativePath) {
	const filePath = path.join(repoRoot, relativePath);
	return ts.createSourceFile(
		filePath,
		fs.readFileSync(filePath, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

function unwrapTypeScriptExpression(expression) {
	let current = expression;
	while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

function readStringUnionType(relativePath, typeName) {
	const sourceFile = readTypeScriptSource(relativePath);
	let values;
	function visit(node) {
		if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
			const members = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type];
			values = members.map(member => {
				if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteralLike(member.literal)) {
					throw new Error(`${typeName} must contain only string literal types.`);
				}
				return member.literal.text;
			});
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (!values) throw new Error(`Could not find ${typeName}.`);
	return values;
}

function readObjectStringValuesConstant(relativePath, constantName) {
	const sourceFile = readTypeScriptSource(relativePath);
	let values;
	function visit(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === constantName) {
			const initializer = node.initializer && unwrapTypeScriptExpression(node.initializer);
			if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
				throw new Error(`${constantName} must be an object literal.`);
			}
			values = initializer.properties.map(property => {
				if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
					throw new Error(`${constantName} values must be string literals.`);
				}
				return property.initializer.text;
			});
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (!values) throw new Error(`Could not find ${constantName}.`);
	return values;
}

function createFixture(t) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-dense-locales-'));
	t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
	const localeDirectory = path.join(rootDir, 'locales');
	fs.mkdirSync(localeDirectory, { recursive: true });
	return {
		rootDir,
		localeDirectory,
		artifactPath: path.join(rootDir, 'dense-locales.json'),
		catalogPath: path.join(rootDir, 'locale-pack-catalog.json'),
		compatibilityAliasesPath: path.join(rootDir, 'locale-compatibility-aliases.json'),
		releaseAssetDirectory: path.join(rootDir, 'release-assets'),
	};
}

function fixtureOptions(fixture) {
	return {
		localeDirectory: fixture.localeDirectory,
		artifactPath: fixture.artifactPath,
		catalogPath: fixture.catalogPath,
		compatibilityAliasesPath: fixture.compatibilityAliasesPath,
		releaseAssetDirectory: fixture.releaseAssetDirectory,
		sourceVersion: '9.8.7',
		compatibilityAliasDefinitions: { alpha: ['first'] },
	};
}

function createLocale(code, reverseOrder = false) {
	const alpha = {
		empty: '',
		first: code === 'en' ? 'First' : `First ${code}`,
	};
	const beta = {
		unicode: code === 'en' ? 'Türkçe 日本語 😀 \\ quoted "value"' : `Unicode ${code} 😀`,
		zeta: code === 'en' ? 'Count {{count}}' : `${code} {{count}}`,
	};
	return reverseOrder ? { beta: { zeta: beta.zeta, unicode: beta.unicode }, alpha } : { alpha, beta };
}

function writeFixtureLocales(localeDirectory, transform = () => {}) {
	for (const [index, definition] of LOCALE_DEFINITIONS.entries()) {
		const locale = createLocale(definition.code, index % 2 === 1);
		transform(locale, definition.code);
		fs.writeFileSync(path.join(localeDirectory, definition.file), JSON.stringify(locale, null, 2), 'utf8');
	}
}

test('locale generator is deterministic and embeds only English', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory);

	const options = fixtureOptions(fixture);
	const first = buildLocaleArtifacts(options);
	const second = buildLocaleArtifacts(options);
	assert.deepEqual(second, first);
	assert.equal(serializeDenseLocalePack(second.embeddedPack), serializeDenseLocalePack(first.embeddedPack));
	assert.deepEqual(first.embeddedPack.languageOrder, ['en']);
	assert.deepEqual(Object.keys(first.embeddedPack.locales), ['en']);
	assert.deepEqual(first.embeddedPack.keyIndex, {
		alpha: { empty: 0, first: 1 },
		beta: { unicode: 2, zeta: 3 },
	});
	assert.equal(first.embeddedPack.locales.en[2], 'Türkçe 日本語 😀 \\ quoted "value"');
	assert.equal(first.embeddedPack.keyCount, 4);
	assert.equal(first.releaseAssets.length, 8);
	assert.equal(first.releaseAssets[0].pack.translations.beta.zeta, 'tr {{count}}');
	assert.deepEqual(first.catalog.languageOrder, LOCALE_DEFINITIONS.slice(1).map(definition => definition.code));
	assert.equal(first.catalog.sourceVersion, '9.8.7');
	assert.deepEqual(first.compatibilityAliases, {
		alpha: { first: LOCALE_DEFINITIONS.map(definition => `First${definition.code === 'en' ? '' : ` ${definition.code}`}`) },
	});
	for (const asset of first.releaseAssets) {
		assert.match(asset.assetName, new RegExp(`^operon-locale-${asset.code}-[a-f0-9]{12}\\.json$`, 'u'));
		assert.equal(first.catalog.locales[asset.code].sha256, asset.sha256);
		assert.equal(first.catalog.locales[asset.code].sourceVersion, asset.pack.sourceVersion);
		assert.match(asset.pack.sourceVersion, /^[a-f0-9]{64}$/u);
		assert.equal(first.catalog.locales[asset.code].sizeBytes, Buffer.byteLength(asset.contents, 'utf8'));
		assert.equal(
			first.catalog.locales[asset.code].url,
			`https://raw.githubusercontent.com/hasanyilmaz/operon/9.8.7/release-assets/locales/${asset.assetName}`,
		);
	}
	const nextPluginRelease = buildLocaleArtifacts({ ...options, sourceVersion: '9.8.8' });
	assert.deepEqual(
		nextPluginRelease.releaseAssets.map(asset => ({ assetName: asset.assetName, contents: asset.contents, sha256: asset.sha256 })),
		first.releaseAssets.map(asset => ({ assetName: asset.assetName, contents: asset.contents, sha256: asset.sha256 })),
		'unchanged translations must not produce a new downloadable pack',
	);
	assert.equal(nextPluginRelease.catalog.sourceVersion, '9.8.8');
	assert.match(nextPluginRelease.catalog.locales.de.url, /\/9\.8\.8\/release-assets\/locales\/operon-locale-de-/u);
});

test('dense locale generator realigns every language when a key is inserted', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory, (locale, code) => {
		locale.alpha.between = code === 'en' ? 'Between' : `Between ${code}`;
	});

	const artifacts = buildLocaleArtifacts(fixtureOptions(fixture));
	const pack = artifacts.embeddedPack;
	assert.deepEqual(pack.keyIndex.alpha, { between: 0, empty: 1, first: 2 });
	assert.equal(pack.locales.en[0], 'Between');
	assert.equal(artifacts.releaseAssets.find(asset => asset.code === 'de').pack.translations.alpha.between, 'Between de');
	assert.equal(artifacts.releaseAssets.find(asset => asset.code === 'ru').pack.translations.alpha.first, 'First ru');
	assert.equal(pack.keyIndex.beta.zeta, 4);
});

test('dense locale generator rejects missing and unlisted locale files', t => {
	const missingFixture = createFixture(t);
	writeFixtureLocales(missingFixture.localeDirectory);
	fs.unlinkSync(path.join(missingFixture.localeDirectory, 'ru.json'));
	assert.throws(
		() => buildDenseLocalePack({ localeDirectory: missingFixture.localeDirectory }),
		/Locale file inventory mismatch: missing=\[ru\.json\] unlisted=\[none\]/u,
	);

	const unlistedFixture = createFixture(t);
	writeFixtureLocales(unlistedFixture.localeDirectory);
	fs.writeFileSync(path.join(unlistedFixture.localeDirectory, 'it.json'), '{}', 'utf8');
	assert.throws(
		() => buildDenseLocalePack({ localeDirectory: unlistedFixture.localeDirectory }),
		/Locale file inventory mismatch: missing=\[none\] unlisted=\[it\.json\]/u,
	);
});

test('dense locale generator rejects duplicate and mismatched locale definitions', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory);

	const duplicateCode = LOCALE_DEFINITIONS.map(definition => ({ ...definition }));
	duplicateCode[1].code = 'en';
	assert.throws(
		() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory, localeDefinitions: duplicateCode }),
		/Duplicate locale code: en/u,
	);

	const duplicateFile = LOCALE_DEFINITIONS.map(definition => ({ ...definition }));
	duplicateFile[1].file = 'en.json';
	assert.throws(
		() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory, localeDefinitions: duplicateFile }),
		/Duplicate locale file: en\.json/u,
	);

	const swappedFiles = LOCALE_DEFINITIONS.map(definition => ({ ...definition }));
	[swappedFiles[0].file, swappedFiles[1].file] = [swappedFiles[1].file, swappedFiles[0].file];
	assert.throws(
		() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory, localeDefinitions: swappedFiles }),
		/Locale en must use file en\.json, received tr\.json/u,
	);
});

test('locale manifest stays aligned with the runtime language union', () => {
	const languages = LOCALE_DEFINITIONS.map(definition => definition.code);
	assert.deepEqual(readStringUnionType('src/core/i18n.ts', 'LangCode'), languages);
});

test('compatibility alias keys stay aligned with default color-name normalization', () => {
	assert.deepEqual(
		[...COMPATIBILITY_ALIAS_DEFINITIONS.taskEditor].sort(),
		readObjectStringValuesConstant('src/core/color-palette.ts', 'DEFAULT_COLOR_NAME_I18N_KEYS').sort(),
	);
});

test('dense locale generator rejects malformed structures and parity drift', async t => {
	await t.test('malformed JSON', () => {
		const fixture = createFixture(t);
		writeFixtureLocales(fixture.localeDirectory);
		fs.writeFileSync(path.join(fixture.localeDirectory, 'tr.json'), '{', 'utf8');
		assert.throws(
			() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory }),
			/Could not parse tr locale JSON/u,
		);
	});

	await t.test('non-string value', () => {
		const fixture = createFixture(t);
		writeFixtureLocales(fixture.localeDirectory, (locale, code) => {
			if (code === 'tr') locale.alpha.first = 42;
		});
		assert.throws(
			() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory }),
			/tr locale value alpha\.first must be a string/u,
		);
	});

	await t.test('missing and extra keys', () => {
		const missingFixture = createFixture(t);
		writeFixtureLocales(missingFixture.localeDirectory, (locale, code) => {
			if (code === 'de') delete locale.beta.unicode;
		});
		assert.throws(
			() => buildDenseLocalePack({ localeDirectory: missingFixture.localeDirectory }),
			/Missing de locale key: beta\.unicode/u,
		);

		const extraFixture = createFixture(t);
		writeFixtureLocales(extraFixture.localeDirectory, (locale, code) => {
			if (code === 'fr') locale.beta.extra = 'Extra';
		});
		assert.throws(
			() => buildDenseLocalePack({ localeDirectory: extraFixture.localeDirectory }),
			/Extra fr locale key: beta\.extra/u,
		);
	});

	await t.test('placeholder mismatch', () => {
		const fixture = createFixture(t);
		writeFixtureLocales(fixture.localeDirectory, (locale, code) => {
			if (code === 'es') locale.beta.zeta = 'Cuenta {{total}}';
		});
		assert.throws(
			() => buildDenseLocalePack({ localeDirectory: fixture.localeDirectory }),
			/Placeholder mismatch for es locale key beta\.zeta/u,
		);
	});
});

test('dense locale freshness check is read-only and detects missing or stale artifacts', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory);
	const options = {
		...fixtureOptions(fixture),
	};

	assert.throws(() => checkDenseLocaleArtifact(options), /artifact is missing/u);
	writeDenseLocaleArtifact(options);
	assert.equal(checkDenseLocaleArtifact(options).output, createDenseLocaleArtifact(options));
	assert.equal(
		fs.readFileSync(fixture.catalogPath, 'utf8'),
		createLocaleCatalogArtifact(options),
	);
	assert.equal(
		fs.readFileSync(fixture.compatibilityAliasesPath, 'utf8'),
		createLocaleCompatibilityAliasesArtifact(options),
	);

	fs.appendFileSync(fixture.artifactPath, ' ', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /artifact is stale/u);
	writeDenseLocaleArtifact(options);
	fs.writeFileSync(path.join(fixture.releaseAssetDirectory, 'unexpected.json'), '{}\n', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /asset inventory is stale/u);
	writeDenseLocaleArtifact(options);
	fs.appendFileSync(fixture.catalogPath, ' ', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /catalog is stale/u);
	writeDenseLocaleArtifact(options);
	fs.appendFileSync(fixture.compatibilityAliasesPath, ' ', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /compatibility aliases are stale/u);
	writeDenseLocaleArtifact(options);
	const [releaseAssetName] = fs.readdirSync(fixture.releaseAssetDirectory);
	fs.appendFileSync(path.join(fixture.releaseAssetDirectory, releaseAssetName), ' ', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /release asset is stale/u);

	const errors = [];
	assert.equal(runDenseLocaleGenerator(['--check'], {
		...options,
		logger: { log() {}, error: message => errors.push(message) },
	}), 1);
	assert.match(errors.join('\n'), /generation failed/u);
});

test('atomic artifact writes preserve the last good file and clean up on rename failure', t => {
	const fixture = createFixture(t);
	const original = 'last-known-good\n';
	fs.writeFileSync(fixture.artifactPath, original, 'utf8');
	const failingFileSystem = {
		openSync: fs.openSync,
		writeFileSync: fs.writeFileSync,
		closeSync: fs.closeSync,
		renameSync() {
			throw new Error('simulated rename failure');
		},
		unlinkSync: fs.unlinkSync,
	};

	assert.throws(
		() => writeFileAtomically(fixture.artifactPath, 'replacement\n', failingFileSystem),
		/simulated rename failure/u,
	);
	assert.equal(fs.readFileSync(fixture.artifactPath, 'utf8'), original);
	assert.deepEqual(fs.readdirSync(fixture.rootDir).sort(), ['dense-locales.json', 'locales']);
});

test('real locale artifacts preserve English plus all eight keyed remote packs', () => {
	const localeDirectory = path.join(repoRoot, 'i18n/locales');
	const artifacts = buildLocaleArtifacts({ localeDirectory });
	const pack = artifacts.embeddedPack;
	assert.equal(pack.keyCount, 2_930);
	assert.deepEqual(pack.languageOrder, ['en']);
	assert.equal(artifacts.releaseAssets.length, 8);
	assert.equal(pack.keyCount * (1 + artifacts.releaseAssets.length), 26_370);
	assert.equal(serializeDenseLocalePack(pack), createDenseLocaleArtifact({ localeDirectory }));

	for (const definition of LOCALE_DEFINITIONS) {
		const locale = JSON.parse(fs.readFileSync(path.join(localeDirectory, definition.file), 'utf8'));
		const remotePack = artifacts.releaseAssets.find(asset => asset.code === definition.code)?.pack;
		const values = definition.code === 'en' ? pack.locales.en : undefined;
		if (values) assert.equal(values.length, pack.keyCount);
		for (const [category, keys] of Object.entries(pack.keyIndex)) {
			for (const [key, index] of Object.entries(keys)) {
				const actual = values ? values[index] : remotePack.translations[category][key];
				assert.equal(actual, locale[category][key], `${definition.code}:${category}.${key}`);
			}
		}
	}

	for (const key of COMPATIBILITY_ALIAS_DEFINITIONS.taskEditor) {
		const expected = [...new Set(LOCALE_DEFINITIONS.map(definition => (
			JSON.parse(fs.readFileSync(path.join(localeDirectory, definition.file), 'utf8')).taskEditor[key]
		)))];
		assert.deepEqual(artifacts.compatibilityAliases.taskEditor[key], expected, `compatibility:${key}`);
	}
});
