import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error TS7016 -- the package subpath maps to the public root types.
import * as zipCoreNativeRuntime from '@zip.js/zip.js/lib/zip-core-native.js';
import {
	createOperonSettingsBackupArchiveV1,
	OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_COMPRESSION_RATIO,
	OPERON_SETTINGS_BACKUP_MAX_MANIFEST_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_SETTINGS_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_TABLE_ENTRY_BYTES,
	OperonSettingsBackupArchiveError,
	readOperonSettingsBackupArchiveV1,
	type OperonSettingsBackupArchiveErrorCode,
} from '../src/core/settings-backup-archive';

const zipCoreNative = zipCoreNativeRuntime as typeof import('@zip.js/zip.js');
const { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } = zipCoreNative;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FIXED_DATE = new Date('1980-01-01T00:00:00.000Z');

function bytes(value: string): Uint8Array {
	return encoder.encode(value);
}

function manifest(tablePaths: readonly string[] = []): Uint8Array {
	return bytes(JSON.stringify({
		format: 'operon-settings-backup-table-manifest',
		manifestVersion: 1,
		settings: { path: 'settings.json', sha256: '0'.repeat(64), bytes: 2 },
		tableFiles: tablePaths.map((path, index) => ({
			id: `table-${index}`,
			path,
			originalPath: `Tables/Table-${index}.table`,
			formatVersion: 1,
			sha256: '0'.repeat(64),
			bytes: 2,
		})),
	}));
}

function portableEntries(tablePaths: readonly string[] = []) {
	return [
		{ path: 'manifest.json', bytes: manifest(tablePaths) },
		{ path: 'settings.json', bytes: bytes('{}') },
		...tablePaths.map(path => ({ path, bytes: bytes('{}') })),
	];
}

async function expectCode(action: () => Promise<unknown>, code: OperonSettingsBackupArchiveErrorCode): Promise<void> {
	await assert.rejects(action, error => {
		assert.equal(error instanceof OperonSettingsBackupArchiveError, true);
		assert.equal((error as OperonSettingsBackupArchiveError).code, code);
		return true;
	});
}

async function rawZip(
	entries: readonly { path: string; data: Uint8Array; options?: Record<string, unknown> }[],
	writerOptions: Record<string, unknown> = {},
): Promise<Uint8Array> {
	const sink = new Uint8ArrayWriter();
	const writer = new ZipWriter(sink, {
		bufferedWrite: true,
		dataDescriptor: false,
		extendedTimestamp: false,
		useWebWorkers: false,
		...writerOptions,
	});
	for (const entry of entries) {
		await writer.add(entry.path, new Uint8ArrayReader(entry.data), {
			bufferedWrite: true,
			dataDescriptor: false,
			extendedTimestamp: false,
			lastModDate: FIXED_DATE,
			useWebWorkers: false,
			...entry.options,
		});
	}
	return writer.close(new Uint8Array(0));
}

function replaceAsciiEverywhere(input: Uint8Array, from: string, to: string): Uint8Array {
	assert.equal(from.length, to.length);
	const output = Uint8Array.from(input);
	const needle = bytes(from);
	const replacement = bytes(to);
	let replacements = 0;
	for (let index = 0; index <= output.length - needle.length; index += 1) {
		if (needle.every((value, offset) => output[index + offset] === value)) {
			output.set(replacement, index);
			replacements += 1;
			index += needle.length - 1;
		}
	}
	assert.ok(replacements >= 2);
	return output;
}

function replaceAsciiFirst(input: Uint8Array, from: string, to: string): Uint8Array {
	assert.equal(from.length, to.length);
	const output = Uint8Array.from(input);
	const needle = bytes(from);
	const replacement = bytes(to);
	const offset = output.findIndex((_, index) => needle.every((value, inner) => output[index + inner] === value));
	assert.ok(offset >= 0);
	output.set(replacement, offset);
	return output;
}

function setCompressionMethod(input: Uint8Array, targetPath: string, method: number): Uint8Array {
	const output = Uint8Array.from(input);
	const target = bytes(targetPath);
	let patches = 0;
	for (let index = 0; index <= output.length - 46; index += 1) {
		const signature = output[index] | output[index + 1] << 8 | output[index + 2] << 16 | output[index + 3] << 24;
		const local = signature === 0x04034b50;
		const central = signature === 0x02014b50;
		if (!local && !central) continue;
		const nameOffset = index + (local ? 30 : 46);
		if (!target.every((value, offset) => output[nameOffset + offset] === value)) continue;
		const methodOffset = index + (local ? 8 : 10);
		output[methodOffset] = method;
		output[methodOffset + 1] = 0;
		patches += 1;
	}
	assert.equal(patches, 2);
	return output;
}

test('archive constants preserve the approved path-aware resource limits', () => {
	assert.equal(OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_BYTES, 50 * 1024 * 1024);
	assert.equal(OPERON_SETTINGS_BACKUP_MAX_MANIFEST_BYTES, 1024 * 1024);
	assert.equal(OPERON_SETTINGS_BACKUP_MAX_SETTINGS_BYTES, 10 * 1024 * 1024);
	assert.equal(OPERON_SETTINGS_BACKUP_MAX_TABLE_ENTRY_BYTES, 5 * 1024 * 1024);
	assert.equal(OPERON_SETTINGS_BACKUP_MAX_COMPRESSION_RATIO, 200);
});

test('deterministic writer produces a strict round-trip with canonical ordering', async () => {
	const inputs = portableEntries(['tables/z.table', 'tables/a.table']).reverse();
	const first = await createOperonSettingsBackupArchiveV1(inputs);
	const second = await createOperonSettingsBackupArchiveV1(inputs);
	assert.deepEqual(first, second);
	const result = await readOperonSettingsBackupArchiveV1(first);
	assert.deepEqual(result.entries.map(entry => entry.path), [
		'manifest.json',
		'settings.json',
		'tables/a.table',
		'tables/z.table',
	]);
	assert.equal(decoder.decode(result.settingsBytes), '{}');
	assert.equal(result.entries.every(entry => entry.compressedBytes === entry.uncompressedBytes), true);
});

test('writer rejects traversal, absolute, backslash, non-NFC and Windows-unsafe paths', async () => {
	for (const path of ['../evil.table', '/evil.table', 'C:/evil.table', 'tables\\evil.table', 'tables/e\u0301.table', 'tables/CON.table', 'tables/trailing.']) {
		await expectCode(
			() => createOperonSettingsBackupArchiveV1([...portableEntries(), { path, bytes: bytes('{}') }]),
			'unsafe-path',
		);
	}
});

test('writer rejects exact duplicates, portable collisions and manifest inventory mismatch', async () => {
	await expectCode(
		() => createOperonSettingsBackupArchiveV1([...portableEntries(), { path: 'settings.json', bytes: bytes('{}') }]),
		'duplicate-path',
	);
	await expectCode(
		() => createOperonSettingsBackupArchiveV1(portableEntries(['tables/A.table', 'tables/a.table'])),
		'path-collision',
	);
	await expectCode(
		() => createOperonSettingsBackupArchiveV1([...portableEntries(), { path: 'tables/extra.table', bytes: bytes('{}') }]),
		'undeclared-entry',
	);
	await expectCode(
		() => createOperonSettingsBackupArchiveV1(portableEntries(['tables/missing.table']).slice(0, 2)),
		'missing-entry',
	);
});

test('writer enforces entry, total and count limits before compression', async () => {
	await expectCode(
		() => createOperonSettingsBackupArchiveV1(portableEntries(), { maxManifestBytes: 1 }),
		'entry-size-limit',
	);
	await expectCode(
		() => createOperonSettingsBackupArchiveV1(portableEntries(), { maxTotalBytes: 2 }),
		'total-size-limit',
	);
	await expectCode(
		() => createOperonSettingsBackupArchiveV1(portableEntries(), { maxEntries: 1 }),
		'entry-count-limit',
	);
});

test('reader rejects archives over the physical byte limit', async () => {
	const archive = await createOperonSettingsBackupArchiveV1(portableEntries());
	await expectCode(() => readOperonSettingsBackupArchiveV1(archive, { maxArchiveBytes: archive.length - 1 }), 'archive-size-limit');
});

test('valid near-limit STORE archive round-trips within the platform-neutral 50 MiB cap', async () => {
	const tablePaths = Array.from({ length: 9 }, (_, index) => `tables/near-limit-${index}.table`);
	const payload = new Uint8Array(OPERON_SETTINGS_BACKUP_MAX_TABLE_ENTRY_BYTES);
	payload.fill(0x61);
	const entries = [
		{ path: 'manifest.json', bytes: manifest(tablePaths) },
		{ path: 'settings.json', bytes: bytes('{}') },
		...tablePaths.map(path => ({ path, bytes: payload })),
	];
	const archive = await createOperonSettingsBackupArchiveV1(entries);
	assert.ok(archive.byteLength > 45 * 1024 * 1024);
	assert.ok(archive.byteLength <= OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_BYTES);
	const opened = await readOperonSettingsBackupArchiveV1(archive);
	assert.equal(opened.entries.length, entries.length);
	assert.equal(opened.entries.every(entry => entry.compressedBytes === entry.uncompressedBytes), true);
});

test('strict reader rejects duplicate central entries and unsafe names before extraction', async () => {
	const base = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}') },
		{ path: 'spareone', data: bytes('1') },
		{ path: 'sparetwo', data: bytes('2') },
	], { level: 0 });
	await expectCode(
		() => readOperonSettingsBackupArchiveV1(replaceAsciiEverywhere(base, 'sparetwo', 'spareone')),
		'duplicate-path',
	);
	const unsafeBase = await rawZip([
		{ path: 'manifest.json', data: manifest(['tables/safe.txt']) },
		{ path: 'settings.json', data: bytes('{}') },
		{ path: 'tables/safe.txt', data: bytes('{}') },
	], { level: 0 });
	await expectCode(
		() => readOperonSettingsBackupArchiveV1(replaceAsciiEverywhere(unsafeBase, 'tables/safe.txt', '../evil/xxx.txt')),
		'unsafe-path',
	);
});

test('reader rejects encrypted, symbolic-link and special Unix entries', async () => {
	const encrypted = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}'), options: { password: 'secret' } },
	], { level: 0 });
	await expectCode(() => readOperonSettingsBackupArchiveV1(encrypted), 'encrypted-entry');

	const symlink = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}'), options: { unixMode: 0o120777, versionMadeBy: 0x31e } },
	], { level: 0 });
	await expectCode(() => readOperonSettingsBackupArchiveV1(symlink), 'symlink-entry');

	const fifo = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}'), options: { unixMode: 0o010644, versionMadeBy: 0x31e } },
	], { level: 0 });
	await expectCode(() => readOperonSettingsBackupArchiveV1(fifo), 'special-entry');
});

test('reader rejects compressed bomb entries before inflation', async () => {
	const compressed = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('a'.repeat(200_000)) },
	], { level: 9 });
	await expectCode(() => readOperonSettingsBackupArchiveV1(compressed), 'unsupported-compression');
});

test('reader rejects unsupported compression methods declared consistently in both headers', async () => {
	const archive = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}') },
	], { level: 0 });
	await expectCode(
		() => readOperonSettingsBackupArchiveV1(setCompressionMethod(archive, 'settings.json', 99)),
		'unsupported-compression',
	);
});

test('reader accepts only portable STORE archives and rejects DEFLATE without host-dependent behavior', async () => {
	const archive = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('{}') },
	], { level: 9 });
	await expectCode(() => readOperonSettingsBackupArchiveV1(archive), 'unsupported-compression');
});

test('strict reader rejects local and central header filename disagreement', async () => {
	const archive = await rawZip([
		{ path: 'manifest.json', data: manifest(['tables/safe.table']) },
		{ path: 'settings.json', data: bytes('{}') },
		{ path: 'tables/safe.table', data: bytes('{}') },
	], { level: 0 });
	await expectCode(
		() => readOperonSettingsBackupArchiveV1(replaceAsciiFirst(archive, 'tables/safe.table', 'tables/evil.table')),
		'integrity-failed',
	);
});

test('reader rejects CRC corruption during bounded extraction', async () => {
	const original = await rawZip([
		{ path: 'manifest.json', data: manifest() },
		{ path: 'settings.json', data: bytes('unique-payload-for-crc') },
	], { level: 0 });
	const corrupt = Uint8Array.from(original);
	const needle = bytes('unique-payload-for-crc');
	const offset = corrupt.findIndex((_, index) => needle.every((value, inner) => corrupt[index + inner] === value));
	assert.ok(offset >= 0);
	corrupt[offset] ^= 0xff;
	await expectCode(() => readOperonSettingsBackupArchiveV1(corrupt), 'integrity-failed');
});
