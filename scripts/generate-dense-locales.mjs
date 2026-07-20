import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DENSE_LOCALE_SCHEMA_VERSION = 1;
export const LOCALE_PACK_SCHEMA_VERSION = 1;
export const COMPATIBILITY_ALIAS_DEFINITIONS = Object.freeze({
	taskEditor: Object.freeze([
		'colorNameAmber',
		'colorNameBlack',
		'colorNameBlue',
		'colorNameBrown',
		'colorNameBurgundy',
		'colorNameCharcoal',
		'colorNameCoral',
		'colorNameCyan',
		'colorNameEmerald',
		'colorNameFuchsia',
		'colorNameGreen',
		'colorNameIndigo',
		'colorNameLime',
		'colorNameOlive',
		'colorNameOrange',
		'colorNamePink',
		'colorNamePurple',
		'colorNameRed',
		'colorNameRose',
		'colorNameSand',
		'colorNameSky',
		'colorNameSlate',
		'colorNameSteel',
		'colorNameTaupe',
		'colorNameTeal',
		'colorNameViolet',
		'colorNameYellow',
		'colorNameZinc',
	]),
});
export const LOCALE_DEFINITIONS = Object.freeze([
	{ code: 'en', file: 'en.json' },
	{ code: 'tr', file: 'tr.json' },
	{ code: 'de', file: 'de.json' },
	{ code: 'fr', file: 'fr.json' },
	{ code: 'es', file: 'es.json' },
	{ code: 'zh-CN', file: 'zh-CN.json' },
	{ code: 'zh-TW', file: 'zh-TW.json' },
	{ code: 'ja', file: 'ja.json' },
	{ code: 'ru', file: 'ru.json' },
]);

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLocaleDirectory = path.join(scriptRoot, 'i18n/locales');
const defaultArtifactPath = path.join(scriptRoot, 'src/generated/dense-locales.json');
const defaultCatalogPath = path.join(scriptRoot, 'src/generated/locale-pack-catalog.json');
const defaultCompatibilityAliasesPath = path.join(scriptRoot, 'src/generated/locale-compatibility-aliases.json');
const defaultReleaseAssetDirectory = path.join(scriptRoot, 'release-assets/locales');
const defaultManifestPath = path.join(scriptRoot, 'manifest.json');
const placeholderPattern = /\{\{([A-Za-z0-9_]+)\}\}/gu;
const rawRepositoryBaseUrl = 'https://raw.githubusercontent.com/hasanyilmaz/operon';

export class DenseLocaleError extends Error {
	constructor(message) {
		super(message);
		this.name = 'DenseLocaleError';
	}
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(filePath, label) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not read ${label}: ${message}`);
	}

	try {
		return JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not parse ${label} JSON: ${message}`);
	}
}

function readLocaleFile(filePath, code) {
	return readJsonFile(filePath, `${code} locale`);
}

function flattenLocale(locale, code) {
	if (!isPlainObject(locale)) throw new DenseLocaleError(`${code} locale root must be an object.`);

	const leaves = new Map();
	for (const category of Object.keys(locale).sort(compareText)) {
		const categoryValue = locale[category];
		if (!isPlainObject(categoryValue)) {
			throw new DenseLocaleError(`${code} locale category ${category} must be an object.`);
		}
		for (const key of Object.keys(categoryValue).sort(compareText)) {
			const value = categoryValue[key];
			if (typeof value !== 'string') {
				throw new DenseLocaleError(`${code} locale value ${category}.${key} must be a string.`);
			}
			leaves.set(`${category}\u0000${key}`, { category, key, value });
		}
	}

	if (leaves.size === 0) throw new DenseLocaleError(`${code} locale contains no string values.`);
	return leaves;
}

function extractPlaceholders(value) {
	return [...value.matchAll(placeholderPattern)].map(match => match[1]).sort(compareText);
}

function sha256(contents) {
	return createHash('sha256').update(contents, 'utf8').digest('hex');
}

function assertLocaleFileInventory(localeDirectory, definitions) {
	let entries;
	try {
		entries = fs.readdirSync(localeDirectory, { withFileTypes: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not inspect locale directory: ${message}`);
	}

	const expectedFiles = definitions.map(definition => definition.file).sort(compareText);
	const actualFiles = entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
		.map(entry => entry.name)
		.sort(compareText);
	const expectedSet = new Set(expectedFiles);
	const actualSet = new Set(actualFiles);
	const missing = expectedFiles.filter(file => !actualSet.has(file));
	const unlisted = actualFiles.filter(file => !expectedSet.has(file));
	if (missing.length > 0 || unlisted.length > 0) {
		throw new DenseLocaleError(
			`Locale file inventory mismatch: missing=[${missing.join(',') || 'none'}] `
			+ `unlisted=[${unlisted.join(',') || 'none'}].`,
		);
	}
}

function assertLocaleParity(englishLeaves, localeLeaves, code) {
	for (const [compoundKey, englishLeaf] of englishLeaves) {
		const localeLeaf = localeLeaves.get(compoundKey);
		if (!localeLeaf) throw new DenseLocaleError(`Missing ${code} locale key: ${englishLeaf.category}.${englishLeaf.key}`);
		const englishPlaceholders = extractPlaceholders(englishLeaf.value);
		const localePlaceholders = extractPlaceholders(localeLeaf.value);
		if (englishPlaceholders.join('\u0000') !== localePlaceholders.join('\u0000')) {
			throw new DenseLocaleError(
				`Placeholder mismatch for ${code} locale key ${englishLeaf.category}.${englishLeaf.key}: `
				+ `en=[${englishPlaceholders.join(',')}] ${code}=[${localePlaceholders.join(',')}].`,
			);
		}
	}

	for (const [compoundKey, localeLeaf] of localeLeaves) {
		if (!englishLeaves.has(compoundKey)) {
			throw new DenseLocaleError(`Extra ${code} locale key: ${localeLeaf.category}.${localeLeaf.key}`);
		}
	}
}

function validateDefinitions(definitions) {
	if (!Array.isArray(definitions) || definitions.length < 2 || definitions[0]?.code !== 'en') {
		throw new DenseLocaleError('Locale definitions must begin with English and include at least one remote locale.');
	}
	const localeCodes = new Set();
	const localeFiles = new Set();
	for (const definition of definitions) {
		if (!definition || typeof definition.code !== 'string' || typeof definition.file !== 'string') {
			throw new DenseLocaleError('Every locale definition must provide string code and file values.');
		}
		if (localeCodes.has(definition.code)) throw new DenseLocaleError(`Duplicate locale code: ${definition.code}`);
		if (localeFiles.has(definition.file)) throw new DenseLocaleError(`Duplicate locale file: ${definition.file}`);
		if (definition.file !== `${definition.code}.json`) {
			throw new DenseLocaleError(`Locale ${definition.code} must use file ${definition.code}.json, received ${definition.file}.`);
		}
		localeCodes.add(definition.code);
		localeFiles.add(definition.file);
	}
}

function readSourceVersion(options) {
	if (typeof options.sourceVersion === 'string') return options.sourceVersion;
	const manifestPath = path.resolve(options.manifestPath ?? defaultManifestPath);
	const manifest = readJsonFile(manifestPath, 'plugin manifest');
	if (!manifest || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
		throw new DenseLocaleError('Plugin manifest version must be a semver string without a v prefix.');
	}
	return manifest.version;
}

function buildTranslations(orderedEnglishLeaves, localeLeaves) {
	const translations = {};
	for (const englishLeaf of orderedEnglishLeaves) {
		const localeLeaf = localeLeaves.get(`${englishLeaf.category}\u0000${englishLeaf.key}`);
		if (!translations[englishLeaf.category]) translations[englishLeaf.category] = {};
		translations[englishLeaf.category][englishLeaf.key] = localeLeaf.value;
	}
	return translations;
}

function buildCompatibilityAliases(locales, definitions, aliasDefinitions) {
	const aliases = {};
	for (const category of Object.keys(aliasDefinitions).sort(compareText)) {
		const categoryAliases = {};
		for (const key of [...aliasDefinitions[category]].sort(compareText)) {
			const compoundKey = `${category}\u0000${key}`;
			if (!locales.get('en')?.has(compoundKey)) continue;
			const values = definitions
				.map(definition => locales.get(definition.code)?.get(compoundKey)?.value)
				.filter(value => typeof value === 'string' && value.length > 0);
			categoryAliases[key] = [...new Set(values)];
		}
		if (Object.keys(categoryAliases).length > 0) aliases[category] = categoryAliases;
	}
	return aliases;
}

export function serializeDenseLocalePack(pack) {
	return `${JSON.stringify(pack, null, 2)}\n`;
}

export function serializeLocalePack(pack) {
	return `${JSON.stringify(pack, null, 2)}\n`;
}

export function buildLocaleArtifacts(options = {}) {
	const localeDirectory = path.resolve(options.localeDirectory ?? defaultLocaleDirectory);
	const definitions = options.localeDefinitions ?? LOCALE_DEFINITIONS;
	validateDefinitions(definitions);
	assertLocaleFileInventory(localeDirectory, definitions);
	const sourceVersion = readSourceVersion(options);

	const locales = new Map();
	for (const definition of definitions) {
		locales.set(
			definition.code,
			flattenLocale(readLocaleFile(path.join(localeDirectory, definition.file), definition.code), definition.code),
		);
	}
	const englishLeaves = locales.get('en');
	if (!englishLeaves) throw new DenseLocaleError('English locale is required.');
	for (const [code, leaves] of locales) {
		if (code !== 'en') assertLocaleParity(englishLeaves, leaves, code);
	}

	const orderedEnglishLeaves = [...englishLeaves.values()].sort((left, right) => (
		compareText(left.category, right.category) || compareText(left.key, right.key)
	));
	const keyIndex = {};
	orderedEnglishLeaves.forEach((leaf, index) => {
		if (!keyIndex[leaf.category]) keyIndex[leaf.category] = {};
		keyIndex[leaf.category][leaf.key] = index;
	});
	const keyFingerprint = sha256(orderedEnglishLeaves.map(leaf => `${leaf.category}\u0000${leaf.key}`).join('\n'));
	const englishValues = orderedEnglishLeaves.map(leaf => leaf.value);
	const embeddedPack = {
		schemaVersion: DENSE_LOCALE_SCHEMA_VERSION,
		languageOrder: ['en'],
		keyCount: orderedEnglishLeaves.length,
		keyIndex,
		locales: { en: englishValues },
	};
	const compatibilityAliases = buildCompatibilityAliases(
		locales,
		definitions,
		options.compatibilityAliasDefinitions ?? COMPATIBILITY_ALIAS_DEFINITIONS,
	);

	const releaseAssets = [];
	const catalogLocales = {};
	for (const definition of definitions.slice(1)) {
		const localePackContent = {
			schemaVersion: LOCALE_PACK_SCHEMA_VERSION,
			locale: definition.code,
			keyCount: orderedEnglishLeaves.length,
			keyFingerprint,
			translations: buildTranslations(orderedEnglishLeaves, locales.get(definition.code)),
		};
		const contentSourceVersion = sha256(serializeLocalePack(localePackContent));
		const localePack = {
			...localePackContent,
			sourceVersion: contentSourceVersion,
		};
		const contents = serializeLocalePack(localePack);
		const digest = sha256(contents);
		const assetName = `operon-locale-${definition.code}-${digest.slice(0, 12)}.json`;
		releaseAssets.push({ assetName, code: definition.code, contents, pack: localePack, sha256: digest });
		catalogLocales[definition.code] = {
			assetName,
			url: `${rawRepositoryBaseUrl}/${sourceVersion}/release-assets/locales/${assetName}`,
			sourceVersion: contentSourceVersion,
			sha256: digest,
			sizeBytes: Buffer.byteLength(contents, 'utf8'),
		};
	}

	const catalog = {
		schemaVersion: LOCALE_PACK_SCHEMA_VERSION,
		sourceVersion,
		keyCount: orderedEnglishLeaves.length,
		keyFingerprint,
		languageOrder: definitions.slice(1).map(definition => definition.code),
		locales: catalogLocales,
	};
	return { catalog, compatibilityAliases, embeddedPack, releaseAssets };
}

export function buildDenseLocalePack(options = {}) {
	return buildLocaleArtifacts(options).embeddedPack;
}

export function createDenseLocaleArtifact(options = {}) {
	return serializeDenseLocalePack(buildDenseLocalePack(options));
}

export function createLocaleCatalogArtifact(options = {}) {
	return serializeLocalePack(buildLocaleArtifacts(options).catalog);
}

export function createLocaleCompatibilityAliasesArtifact(options = {}) {
	return serializeLocalePack(buildLocaleArtifacts(options).compatibilityAliases);
}

export function writeFileAtomically(filePath, contents, fileSystem = fs) {
	const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
	let fileDescriptor;
	try {
		fileDescriptor = fileSystem.openSync(tempPath, 'wx');
		fileSystem.writeFileSync(fileDescriptor, contents, 'utf8');
		fileSystem.closeSync(fileDescriptor);
		fileDescriptor = undefined;
		fileSystem.renameSync(tempPath, filePath);
	} catch (error) {
		if (fileDescriptor !== undefined) {
			try { fileSystem.closeSync(fileDescriptor); } catch { /* Preserve the original failure. */ }
		}
		try {
			fileSystem.unlinkSync(tempPath);
		} catch (cleanupError) {
			if (!cleanupError || typeof cleanupError !== 'object' || !('code' in cleanupError) || cleanupError.code !== 'ENOENT') {
				throw cleanupError;
			}
		}
		throw error;
	}
}

function resolveOutputPaths(options) {
	return {
		artifactPath: path.resolve(options.artifactPath ?? defaultArtifactPath),
		catalogPath: path.resolve(options.catalogPath ?? defaultCatalogPath),
		compatibilityAliasesPath: path.resolve(options.compatibilityAliasesPath ?? defaultCompatibilityAliasesPath),
		releaseAssetDirectory: path.resolve(options.releaseAssetDirectory ?? defaultReleaseAssetDirectory),
	};
}

export function writeDenseLocaleArtifact(options = {}) {
	const paths = resolveOutputPaths(options);
	const artifacts = buildLocaleArtifacts(options);
	fs.mkdirSync(path.dirname(paths.artifactPath), { recursive: true });
	fs.mkdirSync(path.dirname(paths.catalogPath), { recursive: true });
	fs.mkdirSync(path.dirname(paths.compatibilityAliasesPath), { recursive: true });
	fs.mkdirSync(paths.releaseAssetDirectory, { recursive: true });
	writeFileAtomically(paths.artifactPath, serializeDenseLocalePack(artifacts.embeddedPack), options.fileSystem ?? fs);
	writeFileAtomically(paths.catalogPath, serializeLocalePack(artifacts.catalog), options.fileSystem ?? fs);
	writeFileAtomically(
		paths.compatibilityAliasesPath,
		serializeLocalePack(artifacts.compatibilityAliases),
		options.fileSystem ?? fs,
	);

	const expectedNames = new Set(artifacts.releaseAssets.map(asset => asset.assetName));
	for (const entry of fs.readdirSync(paths.releaseAssetDirectory, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith('.json') && !expectedNames.has(entry.name)) {
			fs.unlinkSync(path.join(paths.releaseAssetDirectory, entry.name));
		}
	}
	for (const asset of artifacts.releaseAssets) {
		writeFileAtomically(path.join(paths.releaseAssetDirectory, asset.assetName), asset.contents, options.fileSystem ?? fs);
	}
	return {
		...paths,
		...artifacts,
		output: serializeDenseLocalePack(artifacts.embeddedPack),
		pack: artifacts.embeddedPack,
	};
}

function checkFileContents(filePath, expected, missingMessage, staleMessage) {
	let actual;
	try {
		actual = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new DenseLocaleError(missingMessage);
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new DenseLocaleError(`Could not read generated locale artifact: ${message}`);
	}
	if (actual !== expected) throw new DenseLocaleError(staleMessage);
}

export function checkDenseLocaleArtifact(options = {}) {
	const paths = resolveOutputPaths(options);
	const artifacts = buildLocaleArtifacts(options);
	checkFileContents(
		paths.artifactPath,
		serializeDenseLocalePack(artifacts.embeddedPack),
		`Dense locale artifact is missing: ${paths.artifactPath}. Run npm run i18n:generate.`,
		'Dense locale artifact is stale. Run npm run i18n:generate and review the generated diff.',
	);
	checkFileContents(
		paths.catalogPath,
		serializeLocalePack(artifacts.catalog),
		`Locale pack catalog is missing: ${paths.catalogPath}. Run npm run i18n:generate.`,
		'Locale pack catalog is stale. Run npm run i18n:generate and review the generated diff.',
	);
	checkFileContents(
		paths.compatibilityAliasesPath,
		serializeLocalePack(artifacts.compatibilityAliases),
		`Locale compatibility aliases are missing: ${paths.compatibilityAliasesPath}. Run npm run i18n:generate.`,
		'Locale compatibility aliases are stale. Run npm run i18n:generate and review the generated diff.',
	);

	let actualAssetNames;
	try {
		actualAssetNames = fs.readdirSync(paths.releaseAssetDirectory, { withFileTypes: true })
			.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
			.map(entry => entry.name)
			.sort(compareText);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new DenseLocaleError(`Locale release asset directory is missing: ${paths.releaseAssetDirectory}.`);
		}
		throw error;
	}
	const expectedAssetNames = artifacts.releaseAssets.map(asset => asset.assetName).sort(compareText);
	if (actualAssetNames.join('\u0000') !== expectedAssetNames.join('\u0000')) {
		throw new DenseLocaleError(
			`Locale release asset inventory is stale: expected=[${expectedAssetNames.join(',')}] `
			+ `actual=[${actualAssetNames.join(',')}]. Run npm run i18n:generate.`,
		);
	}
	for (const asset of artifacts.releaseAssets) {
		checkFileContents(
			path.join(paths.releaseAssetDirectory, asset.assetName),
			asset.contents,
			`Locale release asset is missing: ${asset.assetName}.`,
			`Locale release asset is stale: ${asset.assetName}.`,
		);
	}
	return {
		...paths,
		...artifacts,
		output: serializeDenseLocalePack(artifacts.embeddedPack),
		pack: artifacts.embeddedPack,
	};
}

export function runDenseLocaleGenerator(args = [], options = {}) {
	const logger = options.logger ?? console;
	try {
		if (args.length !== 1 || (args[0] !== '--write' && args[0] !== '--check')) {
			throw new DenseLocaleError('Usage: generate-dense-locales.mjs --write|--check');
		}
		const result = args[0] === '--write' ? writeDenseLocaleArtifact(options) : checkDenseLocaleArtifact(options);
		const action = args[0] === '--write' ? 'generated' : 'passed freshness check';
		logger.log(
			`Operon locale artifacts ${action}: ${result.embeddedPack.keyCount.toLocaleString('en-US')} keys, `
			+ `English embedded, ${result.releaseAssets.length.toLocaleString('en-US')} downloadable language packs.`,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`Operon locale generation failed: ${message}`);
		return 1;
	}
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) process.exitCode = runDenseLocaleGenerator(process.argv.slice(2));
