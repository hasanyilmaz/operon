import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMINDER_SOUND_PACK_SCHEMA_VERSION = 1;
export const REMINDER_SOUND_FILES = Object.freeze([
	{ id: 'reminder-1', assetName: 'operon-reminder-1.mp3', fileName: 'Operon Reminder 1.mp3' },
	{ id: 'reminder-2', assetName: 'operon-reminder-2.mp3', fileName: 'Operon Reminder 2.mp3' },
	{ id: 'reminder-3', assetName: 'operon-reminder-3.mp3', fileName: 'Operon Reminder 3.mp3' },
	{ id: 'reminder-4', assetName: 'operon-reminder-4.mp3', fileName: 'Operon Reminder 4.mp3' },
]);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAssetDirectory = path.join(rootDir, 'release-assets/reminder-sounds');
const defaultCatalogPath = path.join(rootDir, 'src/generated/reminder-sound-pack-catalog.json');
const repositoryAssetBaseUrl = 'https://raw.githubusercontent.com/hasanyilmaz/operon/main/release-assets/reminder-sounds';

export class ReminderSoundPackGeneratorError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ReminderSoundPackGeneratorError';
	}
}

export function generateReminderSoundPackCatalog({
	assetDirectory = defaultAssetDirectory,
} = {}) {
	assertAssetInventory(assetDirectory);
	return {
		schemaVersion: REMINDER_SOUND_PACK_SCHEMA_VERSION,
		files: REMINDER_SOUND_FILES.map(definition => {
			const assetPath = path.join(assetDirectory, definition.assetName);
			const bytes = fs.readFileSync(assetPath);
			return {
				...definition,
				url: `${repositoryAssetBaseUrl}/${definition.assetName}`,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				sizeBytes: bytes.byteLength,
			};
		}),
	};
}

export function writeReminderSoundPackCatalog({ catalogPath = defaultCatalogPath, ...options } = {}) {
	const catalog = generateReminderSoundPackCatalog(options);
	const output = `${JSON.stringify(catalog, null, '\t')}\n`;
	fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
	fs.writeFileSync(catalogPath, output, 'utf8');
	return catalog;
}

export function checkReminderSoundPackCatalog({ catalogPath = defaultCatalogPath, ...options } = {}) {
	const expected = `${JSON.stringify(generateReminderSoundPackCatalog(options), null, '\t')}\n`;
	let actual = '';
	try {
		actual = fs.readFileSync(catalogPath, 'utf8');
	} catch {
		throw new ReminderSoundPackGeneratorError('Reminder sound pack catalog is missing.');
	}
	if (actual !== expected) {
		throw new ReminderSoundPackGeneratorError('Reminder sound pack catalog is stale; run npm run reminder:sounds:generate.');
	}
}

function assertAssetInventory(assetDirectory) {
	let actual;
	try {
		actual = fs.readdirSync(assetDirectory, { withFileTypes: true })
			.filter(entry => entry.isFile())
			.map(entry => entry.name)
			.sort();
	} catch (error) {
		throw new ReminderSoundPackGeneratorError(`Could not inspect reminder sound assets: ${message(error)}`);
	}
	const expected = REMINDER_SOUND_FILES.map(entry => entry.assetName).sort();
	if (actual.join('\u0000') !== expected.join('\u0000')) {
		throw new ReminderSoundPackGeneratorError(`Reminder sound asset inventory mismatch: expected=[${expected.join(', ')}], actual=[${actual.join(', ')}].`);
	}
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const mode = process.argv[2];
	if (mode === '--write') {
		writeReminderSoundPackCatalog();
	} else if (mode === '--check') {
		checkReminderSoundPackCatalog();
	} else {
		throw new ReminderSoundPackGeneratorError('Usage: generate-reminder-sound-pack.mjs --write|--check');
	}
}
