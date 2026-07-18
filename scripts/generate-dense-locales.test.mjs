import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
	LOCALE_DEFINITIONS,
	buildDenseLocalePack,
	checkDenseLocaleArtifact,
	createDenseLocaleArtifact,
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

function readStringArrayConstant(relativePath, constantName) {
	const sourceFile = readTypeScriptSource(relativePath);
	let values;
	function visit(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === constantName) {
			const initializer = node.initializer && unwrapTypeScriptExpression(node.initializer);
			if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
				throw new Error(`${constantName} must be an array literal.`);
			}
			values = initializer.elements.map(element => {
				if (!ts.isStringLiteralLike(element)) throw new Error(`${constantName} must contain only string literals.`);
				return element.text;
			});
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (!values) throw new Error(`Could not find ${constantName}.`);
	return values;
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

function readObjectArrayStringProperty(relativePath, constantName, propertyName) {
	const sourceFile = readTypeScriptSource(relativePath);
	let values;
	function visit(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === constantName) {
			const initializer = node.initializer && unwrapTypeScriptExpression(node.initializer);
			if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
				throw new Error(`${constantName} must be an array literal.`);
			}
			values = initializer.elements.map(element => {
				if (!ts.isObjectLiteralExpression(element)) throw new Error(`${constantName} must contain object literals.`);
				const property = element.properties.find(candidate => (
					ts.isPropertyAssignment(candidate)
					&& ((ts.isIdentifier(candidate.name) && candidate.name.text === propertyName)
						|| (ts.isStringLiteralLike(candidate.name) && candidate.name.text === propertyName))
				));
				if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
					throw new Error(`${constantName}.${propertyName} must be a string literal.`);
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

test('dense locale generator is deterministic and independent of property order', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory);

	const first = buildDenseLocalePack({ localeDirectory: fixture.localeDirectory });
	const second = buildDenseLocalePack({ localeDirectory: fixture.localeDirectory });
	assert.deepEqual(second, first);
	assert.equal(serializeDenseLocalePack(second), serializeDenseLocalePack(first));
	assert.deepEqual(first.languageOrder, LOCALE_DEFINITIONS.map(definition => definition.code));
	assert.deepEqual(first.keyIndex, {
		alpha: { empty: 0, first: 1 },
		beta: { unicode: 2, zeta: 3 },
	});
	assert.equal(first.locales.en[2], 'Türkçe 日本語 😀 \\ quoted "value"');
	assert.equal(first.locales.tr[3], 'tr {{count}}');
	assert.equal(first.keyCount, 4);
});

test('dense locale generator realigns every language when a key is inserted', t => {
	const fixture = createFixture(t);
	writeFixtureLocales(fixture.localeDirectory, (locale, code) => {
		locale.alpha.between = code === 'en' ? 'Between' : `Between ${code}`;
	});

	const pack = buildDenseLocalePack({ localeDirectory: fixture.localeDirectory });
	assert.deepEqual(pack.keyIndex.alpha, { between: 0, empty: 1, first: 2 });
	assert.equal(pack.locales.en[0], 'Between');
	assert.equal(pack.locales.de[0], 'Between de');
	assert.equal(pack.locales.ru[2], 'First ru');
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

test('dense locale manifest stays aligned with runtime and settings language lists', () => {
	const languages = LOCALE_DEFINITIONS.map(definition => definition.code);
	assert.deepEqual(readStringUnionType('src/core/i18n.ts', 'LangCode'), languages);
	assert.deepEqual(readStringArrayConstant('src/types/settings.ts', 'SUPPORTED_LANGUAGE_OPTIONS'), ['auto', ...languages]);
	assert.deepEqual(readObjectArrayStringProperty('src/ui/settings-tab.ts', 'languageOptions', 'value'), languages);
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
		localeDirectory: fixture.localeDirectory,
		artifactPath: fixture.artifactPath,
	};

	assert.throws(() => checkDenseLocaleArtifact(options), /artifact is missing/u);
	writeDenseLocaleArtifact(options);
	assert.equal(checkDenseLocaleArtifact(options).output, createDenseLocaleArtifact(options));

	fs.appendFileSync(fixture.artifactPath, ' ', 'utf8');
	assert.throws(() => checkDenseLocaleArtifact(options), /artifact is stale/u);

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

test('real dense locale pack preserves all 25,605 source values', () => {
	const localeDirectory = path.join(repoRoot, 'i18n/locales');
	const pack = buildDenseLocalePack({ localeDirectory });
	assert.equal(pack.keyCount, 2_845);
	assert.equal(pack.languageOrder.length, 9);
	assert.equal(pack.keyCount * pack.languageOrder.length, 25_605);
	assert.equal(serializeDenseLocalePack(pack), createDenseLocaleArtifact({ localeDirectory }));

	for (const definition of LOCALE_DEFINITIONS) {
		const locale = JSON.parse(fs.readFileSync(path.join(localeDirectory, definition.file), 'utf8'));
		const values = pack.locales[definition.code];
		assert.equal(values.length, pack.keyCount);
		for (const [category, keys] of Object.entries(pack.keyIndex)) {
			for (const [key, index] of Object.entries(keys)) {
				assert.equal(values[index], locale[category][key], `${definition.code}:${category}.${key}`);
			}
		}
	}
});
