import type { Entry, FileEntry } from '@zip.js/zip.js';
// The package exports this runtime-only subpath but its types require modern
// moduleResolution. Keep the project-wide resolver unchanged and bind the
// subpath to the package's public type surface explicitly.
// @ts-expect-error TS7016 -- declaration is supplied by the typed binding below.
import * as zipCoreNativeRuntime from '@zip.js/zip.js/lib/zip-core-native.js';
import {
	OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES,
} from './settings-backup-table-manifest';
import { OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES } from './settings-backup-format';

const zipCoreNative = zipCoreNativeRuntime as typeof import('@zip.js/zip.js');
const { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } = zipCoreNative;

export const OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_MANIFEST_BYTES = 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_SETTINGS_BYTES = OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES;
export const OPERON_SETTINGS_BACKUP_MAX_TABLE_ENTRY_BYTES = OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES;
export const OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRIES = OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES + 2;
export const OPERON_SETTINGS_BACKUP_MAX_COMPRESSION_RATIO = 200;

const ARCHIVE_MANIFEST_PATH = 'manifest.json';
const ARCHIVE_SETTINGS_PATH = 'settings.json';
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_DRIVE_PATH = /^[a-z]:/iu;
const SUPPORTED_COMPRESSION_METHODS = new Set([0, 8]);
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_SYMBOLIC_LINK = 0o120000;

export type OperonSettingsBackupArchiveErrorCode =
	| 'archive-size-limit'
	| 'entry-count-limit'
	| 'entry-size-limit'
	| 'total-size-limit'
	| 'compression-ratio-limit'
	| 'unsafe-path'
	| 'duplicate-path'
	| 'path-collision'
	| 'undeclared-entry'
	| 'missing-entry'
	| 'encrypted-entry'
	| 'symlink-entry'
	| 'special-entry'
	| 'unsupported-compression'
	| 'invalid-manifest'
	| 'invalid-archive'
	| 'integrity-failed';

export class OperonSettingsBackupArchiveError extends Error {
	readonly cause?: unknown;

	constructor(
		readonly code: OperonSettingsBackupArchiveErrorCode,
		message: string,
		readonly entryPath: string | null = null,
		options?: { cause?: unknown },
	) {
		super(message);
		this.name = 'OperonSettingsBackupArchiveError';
		if (options && 'cause' in options) this.cause = options.cause;
	}
}

export interface OperonSettingsBackupArchiveEntryInput {
	path: string;
	bytes: Uint8Array;
}

export interface OperonSettingsBackupArchiveEntry {
	path: string;
	bytes: Uint8Array;
	compressedBytes: number;
	uncompressedBytes: number;
}

export interface OperonSettingsBackupArchiveReadResult {
	entries: OperonSettingsBackupArchiveEntry[];
	manifestBytes: Uint8Array;
	settingsBytes: Uint8Array;
}

export interface OperonSettingsBackupArchiveLimits {
	maxArchiveBytes?: number;
	maxManifestBytes?: number;
	maxSettingsBytes?: number;
	maxTableEntryBytes?: number;
	maxTotalBytes?: number;
	maxEntries?: number;
	maxCompressionRatio?: number;
}

interface ResolvedArchiveLimits {
	maxArchiveBytes: number;
	maxManifestBytes: number;
	maxSettingsBytes: number;
	maxTableEntryBytes: number;
	maxTotalBytes: number;
	maxEntries: number;
	maxCompressionRatio: number;
}

/**
 * Read and fully validate the Stage 6 portable archive. No vault paths are
 * touched here: callers receive bounded in-memory bytes only after the whole
 * archive and its manifest-declared inventory have passed validation.
 */
export async function readOperonSettingsBackupArchiveV1(
	archiveBytes: Uint8Array,
	limits: OperonSettingsBackupArchiveLimits = {},
): Promise<OperonSettingsBackupArchiveReadResult> {
	const resolved = resolveLimits(limits);
	if (archiveBytes.byteLength > resolved.maxArchiveBytes) {
		throw archiveError('archive-size-limit', `Archive exceeds the ${resolved.maxArchiveBytes} byte limit.`);
	}

	const reader = new ZipReader(new Uint8ArrayReader(copyBytes(archiveBytes)), {
		strictness: 'strict',
		useWebWorkers: false,
		checkSignature: true,
		checkOverlappingEntry: true,
	});
	try {
		const entries: Entry[] = [];
		for await (const entry of reader.getEntriesGenerator({ strictness: 'strict' })) {
			entries.push(entry);
			if (entries.length > resolved.maxEntries) {
				throw archiveError('entry-count-limit', `Archive exceeds the ${resolved.maxEntries} entry limit.`);
			}
		}
		validateEntryMetadata(entries, resolved);
		const manifestEntry = requireFileEntry(entries, ARCHIVE_MANIFEST_PATH);
		const manifestBytes = await extractEntry(manifestEntry, resolved);
		const declaredPaths = parseDeclaredPaths(manifestBytes);
		validateDeclaredInventory(entries, declaredPaths);

		const extracted: OperonSettingsBackupArchiveEntry[] = [];
		let emittedTotal = 0;
		for (const entry of entries) {
			if (entry.directory) continue;
			const bytes = entry.filename === ARCHIVE_MANIFEST_PATH
				? manifestBytes
				: await extractEntry(entry, resolved);
			emittedTotal += bytes.byteLength;
			if (emittedTotal > resolved.maxTotalBytes) {
				throw archiveError('total-size-limit', `Archive emitted more than ${resolved.maxTotalBytes} bytes.`, entry.filename);
			}
			extracted.push({
				path: entry.filename,
				bytes,
				compressedBytes: entry.compressedSize,
				uncompressedBytes: entry.uncompressedSize,
			});
		}
		extracted.sort((left, right) => compareArchivePaths(left.path, right.path));
		const settings = extracted.find(entry => entry.path === ARCHIVE_SETTINGS_PATH);
		if (!settings) throw archiveError('missing-entry', `Archive is missing ${ARCHIVE_SETTINGS_PATH}.`, ARCHIVE_SETTINGS_PATH);
		return { entries: extracted, manifestBytes, settingsBytes: settings.bytes };
	} catch (error) {
		if (error instanceof OperonSettingsBackupArchiveError) throw error;
		throw classifyZipError(error);
	} finally {
		await reader.close().catch(() => undefined);
	}
}

/** Create a byte-for-byte deterministic, unencrypted ZIP using stored entries. */
export async function createOperonSettingsBackupArchiveV1(
	inputEntries: readonly OperonSettingsBackupArchiveEntryInput[],
	limits: OperonSettingsBackupArchiveLimits = {},
): Promise<Uint8Array> {
	const resolved = resolveLimits(limits);
	const entries = inputEntries.map(entry => ({ path: entry.path, bytes: copyBytes(entry.bytes) }));
	validateWriterEntries(entries, resolved);
	const manifest = entries.find(entry => entry.path === ARCHIVE_MANIFEST_PATH);
	if (!manifest) throw archiveError('missing-entry', `Archive is missing ${ARCHIVE_MANIFEST_PATH}.`, ARCHIVE_MANIFEST_PATH);
	const declaredPaths = parseDeclaredPaths(manifest.bytes);
	validateDeclaredInputInventory(entries, declaredPaths);
	entries.sort((left, right) => compareArchivePaths(left.path, right.path));

	const output = new Uint8ArrayWriter();
	const writer = new ZipWriter(output, {
		bufferedWrite: true,
		dataDescriptor: false,
		extendedTimestamp: false,
		keepOrder: true,
		level: 0,
		useUnicodeFileNames: true,
		useWebWorkers: false,
		zip64: false,
	});
	try {
		for (const entry of entries) {
			await writer.add(entry.path, new Uint8ArrayReader(entry.bytes), {
				bufferedWrite: true,
				dataDescriptor: false,
				extendedTimestamp: false,
				lastModDate: ZIP_EPOCH,
				level: 0,
				useWebWorkers: false,
			});
		}
		const bytes = await writer.close(new Uint8Array(0));
		if (bytes.byteLength > resolved.maxArchiveBytes) {
			throw archiveError('archive-size-limit', `Generated archive exceeds the ${resolved.maxArchiveBytes} byte limit.`);
		}
		return copyBytes(bytes);
	} catch (error) {
		if (error instanceof OperonSettingsBackupArchiveError) throw error;
		throw classifyZipError(error);
	}
}

function validateEntryMetadata(entries: readonly Entry[], limits: ResolvedArchiveLimits): void {
	if (entries.length > limits.maxEntries) {
		throw archiveError('entry-count-limit', `Archive exceeds the ${limits.maxEntries} entry limit.`);
	}
	const exact = new Set<string>();
	const collisionKeys = new Map<string, string>();
	let total = 0;
	for (const entry of entries) {
		validateArchivePath(entry.filename);
		if (exact.has(entry.filename)) throw archiveError('duplicate-path', `Duplicate archive path: ${entry.filename}.`, entry.filename);
		exact.add(entry.filename);
		const collisionKey = windowsCollisionKey(entry.filename);
		const collision = collisionKeys.get(collisionKey);
		if (collision !== undefined) {
			throw archiveError('path-collision', `Archive paths collide: ${collision} and ${entry.filename}.`, entry.filename);
		}
		collisionKeys.set(collisionKey, entry.filename);
		if (entry.directory) throw archiveError('special-entry', 'Directory entries are not allowed.', entry.filename);
		if (entry.encrypted) throw archiveError('encrypted-entry', 'Encrypted entries are not allowed.', entry.filename);
		if (!SUPPORTED_COMPRESSION_METHODS.has(entry.compressionMethod)) {
			throw archiveError('unsupported-compression', `Compression method ${entry.compressionMethod} is not allowed.`, entry.filename);
		}
		validateUnixFileType(entry);
		const entryLimit = entryLimitForPath(entry.filename, limits);
		if (entry.uncompressedSize > entryLimit) {
			throw archiveError('entry-size-limit', `Entry exceeds the ${entryLimit} byte limit.`, entry.filename);
		}
		total += entry.uncompressedSize;
		if (total > limits.maxTotalBytes) {
			throw archiveError('total-size-limit', `Archive exceeds the ${limits.maxTotalBytes} byte uncompressed limit.`, entry.filename);
		}
		validateCompressionRatio(entry, limits.maxCompressionRatio);
	}
}

function validateUnixFileType(entry: Entry): void {
	const unixMode = entry.unixMode ?? (entry.externalFileAttributes >>> 16);
	const fileType = unixMode & UNIX_FILE_TYPE_MASK;
	if (fileType === UNIX_SYMBOLIC_LINK) throw archiveError('symlink-entry', 'Symbolic links are not allowed.', entry.filename);
	if (fileType !== 0 && fileType !== UNIX_REGULAR_FILE) {
		throw archiveError('special-entry', 'Non-regular archive entries are not allowed.', entry.filename);
	}
	if ((entry.externalFileAttributes & 0x08) !== 0) {
		throw archiveError('special-entry', 'MS-DOS volume entries are not allowed.', entry.filename);
	}
}

function validateCompressionRatio(entry: Entry, maximum: number): void {
	if (entry.uncompressedSize === 0) return;
	if (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > maximum) {
		throw archiveError('compression-ratio-limit', `Entry exceeds the ${maximum}:1 compression-ratio limit.`, entry.filename);
	}
}

async function extractEntry(entry: FileEntry, limits: ResolvedArchiveLimits): Promise<Uint8Array> {
	try {
		const entryLimit = entryLimitForPath(entry.filename, limits);
		const boundedWriter = new BoundedArchiveWriter(entryLimit, entry.filename);
		await entry.getData(boundedWriter, {
			checkOverlappingEntry: true,
			checkSignature: true,
			strictness: 'strict',
			useWebWorkers: false,
		});
		const value = boundedWriter.getBytes();
		if (value.byteLength !== entry.uncompressedSize || value.byteLength > entryLimit) {
			throw archiveError('entry-size-limit', 'Entry emitted an unexpected number of bytes.', entry.filename);
		}
		return copyBytes(value);
	} catch (error) {
		if (error instanceof OperonSettingsBackupArchiveError) throw error;
		throw new OperonSettingsBackupArchiveError(
			'integrity-failed',
			`Entry integrity validation failed: ${entry.filename}.`,
			entry.filename,
			{ cause: error },
		);
	}
}

class BoundedArchiveWriter {
	readonly writable: WritableStream<Uint8Array>;
	private readonly chunks: Uint8Array[] = [];
	private emittedBytes = 0;

	constructor(maxBytes: number, entryPath: string) {
		this.writable = new WritableStream<Uint8Array>({
			write: chunk => {
				this.emittedBytes += chunk.byteLength;
				if (this.emittedBytes > maxBytes) {
					throw archiveError('entry-size-limit', `Entry emitted more than ${maxBytes} bytes.`, entryPath);
				}
				this.chunks.push(copyBytes(chunk));
			},
		});
	}

	getBytes(): Uint8Array {
		const output = new Uint8Array(this.emittedBytes);
		let offset = 0;
		for (const chunk of this.chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	}
}

function parseDeclaredPaths(manifestBytes: Uint8Array): Set<string> {
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
	} catch (error) {
		throw new OperonSettingsBackupArchiveError('invalid-manifest', 'Archive manifest is not valid UTF-8 JSON.', ARCHIVE_MANIFEST_PATH, { cause: error });
	}
	if (!isRecord(raw) || !isRecord(raw.settings) || !Array.isArray(raw.tableFiles)) {
		throw archiveError('invalid-manifest', 'Archive manifest does not declare settings and tableFiles.', ARCHIVE_MANIFEST_PATH);
	}
	const settingsPath = raw.settings.path;
	if (settingsPath !== ARCHIVE_SETTINGS_PATH) {
		throw archiveError('invalid-manifest', `Archive manifest settings path must be ${ARCHIVE_SETTINGS_PATH}.`, ARCHIVE_MANIFEST_PATH);
	}
	const declared = new Set<string>([ARCHIVE_MANIFEST_PATH, ARCHIVE_SETTINGS_PATH]);
	for (const value of raw.tableFiles) {
		if (!isRecord(value) || typeof value.path !== 'string') {
			throw archiveError('invalid-manifest', 'Archive manifest contains an invalid Table path.', ARCHIVE_MANIFEST_PATH);
		}
		validateArchivePath(value.path);
		if (!value.path.startsWith('tables/') || !value.path.endsWith('.table')) {
			throw archiveError('invalid-manifest', 'Table entries must use tables/*.table paths.', value.path);
		}
		if (declared.has(value.path)) throw archiveError('duplicate-path', `Manifest declares ${value.path} more than once.`, value.path);
		declared.add(value.path);
	}
	return declared;
}

function validateDeclaredInventory(entries: readonly Entry[], declared: ReadonlySet<string>): void {
	const actual = new Set(entries.map(entry => entry.filename));
	for (const path of actual) {
		if (!declared.has(path)) throw archiveError('undeclared-entry', `Archive contains undeclared entry ${path}.`, path);
	}
	for (const path of declared) {
		if (!actual.has(path)) throw archiveError('missing-entry', `Archive is missing declared entry ${path}.`, path);
	}
}

function validateDeclaredInputInventory(
	entries: readonly OperonSettingsBackupArchiveEntryInput[],
	declared: ReadonlySet<string>,
): void {
	const actual = new Set(entries.map(entry => entry.path));
	for (const path of actual) {
		if (!declared.has(path)) throw archiveError('undeclared-entry', `Archive contains undeclared entry ${path}.`, path);
	}
	for (const path of declared) {
		if (!actual.has(path)) throw archiveError('missing-entry', `Archive is missing declared entry ${path}.`, path);
	}
}

function validateWriterEntries(
	entries: readonly OperonSettingsBackupArchiveEntryInput[],
	limits: ResolvedArchiveLimits,
): void {
	if (entries.length > limits.maxEntries) throw archiveError('entry-count-limit', `Archive exceeds the ${limits.maxEntries} entry limit.`);
	const exact = new Set<string>();
	const collisionKeys = new Map<string, string>();
	let total = 0;
	for (const entry of entries) {
		validateArchivePath(entry.path);
		if (exact.has(entry.path)) throw archiveError('duplicate-path', `Duplicate archive path: ${entry.path}.`, entry.path);
		exact.add(entry.path);
		const collisionKey = windowsCollisionKey(entry.path);
		const collision = collisionKeys.get(collisionKey);
		if (collision !== undefined) throw archiveError('path-collision', `Archive paths collide: ${collision} and ${entry.path}.`, entry.path);
		collisionKeys.set(collisionKey, entry.path);
		const entryLimit = entryLimitForPath(entry.path, limits);
		if (entry.bytes.byteLength > entryLimit) throw archiveError('entry-size-limit', `Entry exceeds the ${entryLimit} byte limit.`, entry.path);
		total += entry.bytes.byteLength;
		if (total > limits.maxTotalBytes) throw archiveError('total-size-limit', `Archive exceeds the ${limits.maxTotalBytes} byte limit.`, entry.path);
	}
}

function validateArchivePath(path: string): void {
	if (!path || path !== path.normalize('NFC') || hasControlCharacter(path) || path.includes('\\')
		|| path.startsWith('/') || path.startsWith('//') || WINDOWS_DRIVE_PATH.test(path)) {
		throw archiveError('unsafe-path', `Unsafe archive path: ${path}.`, path);
	}
	const segments = path.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..'
		|| segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')
		|| WINDOWS_RESERVED_SEGMENT.test(segment))) {
		throw archiveError('unsafe-path', `Unsafe archive path: ${path}.`, path);
	}
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some(character => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}

function windowsCollisionKey(path: string): string {
	return path.normalize('NFKC').toLowerCase();
}

function requireFileEntry(entries: readonly Entry[], path: string): FileEntry {
	const entry = entries.find(candidate => candidate.filename === path);
	if (!entry || entry.directory) throw archiveError('missing-entry', `Archive is missing ${path}.`, path);
	return entry;
}

function resolveLimits(limits: OperonSettingsBackupArchiveLimits): ResolvedArchiveLimits {
	return {
		maxArchiveBytes: positiveLimit(limits.maxArchiveBytes, OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_BYTES, 'maxArchiveBytes'),
		maxManifestBytes: positiveLimit(limits.maxManifestBytes, OPERON_SETTINGS_BACKUP_MAX_MANIFEST_BYTES, 'maxManifestBytes'),
		maxSettingsBytes: positiveLimit(limits.maxSettingsBytes, OPERON_SETTINGS_BACKUP_MAX_SETTINGS_BYTES, 'maxSettingsBytes'),
		maxTableEntryBytes: positiveLimit(limits.maxTableEntryBytes, OPERON_SETTINGS_BACKUP_MAX_TABLE_ENTRY_BYTES, 'maxTableEntryBytes'),
		maxTotalBytes: positiveLimit(limits.maxTotalBytes, OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES, 'maxTotalBytes'),
		maxEntries: positiveLimit(limits.maxEntries, OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRIES, 'maxEntries'),
		maxCompressionRatio: positiveLimit(limits.maxCompressionRatio, OPERON_SETTINGS_BACKUP_MAX_COMPRESSION_RATIO, 'maxCompressionRatio'),
	};
}

function entryLimitForPath(path: string, limits: ResolvedArchiveLimits): number {
	if (path === ARCHIVE_MANIFEST_PATH) return limits.maxManifestBytes;
	if (path === ARCHIVE_SETTINGS_PATH) return limits.maxSettingsBytes;
	return limits.maxTableEntryBytes;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
	return resolved;
}

function compareArchivePaths(left: string, right: string): number {
	const rank = (path: string): number => path === ARCHIVE_MANIFEST_PATH ? 0 : path === ARCHIVE_SETTINGS_PATH ? 1 : 2;
	const rankDifference = rank(left) - rank(right);
	if (rankDifference !== 0 || left === right) return rankDifference;
	return left < right ? -1 : 1;
}

function copyBytes(value: Uint8Array): Uint8Array {
	return Uint8Array.from(value);
}

function archiveError(
	code: OperonSettingsBackupArchiveErrorCode,
	message: string,
	entryPath: string | null = null,
): OperonSettingsBackupArchiveError {
	return new OperonSettingsBackupArchiveError(code, message, entryPath);
}

function classifyZipError(error: unknown): OperonSettingsBackupArchiveError {
	const message = error instanceof Error ? error.message : String(error);
	const reason = isRecord(error) && typeof error.reason === 'string' ? error.reason : '';
	if (/duplicate/iu.test(`${message} ${reason}`)) return new OperonSettingsBackupArchiveError('duplicate-path', 'Archive contains duplicate entries.', null, { cause: error });
	if (/encrypted|password/iu.test(message)) return new OperonSettingsBackupArchiveError('encrypted-entry', 'Encrypted archives are not allowed.', null, { cause: error });
	if (/signature|crc|overlap/iu.test(message)) return new OperonSettingsBackupArchiveError('integrity-failed', 'Archive integrity validation failed.', null, { cause: error });
	return new OperonSettingsBackupArchiveError('invalid-archive', 'Archive structure is invalid or ambiguous.', null, { cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
