import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import { parseOperonTableFile } from '../storage/table-file';
import { isSafeTablePresetId } from '../types/table';
import {
	OPERON_TABLE_FILE_LEGACY_VERSION,
	OPERON_TABLE_FILE_VERSION,
} from '../types/table-file';
import type { OperonSettingsBackupDiagnostic } from './settings-backup-format';
import { parseOperonSettingsBackupV1 } from './settings-backup-format';

export const OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT = 'operon-settings-backup-table-manifest' as const;
export const OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION = 1 as const;
export const OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES = 1_000;
export const OPERON_SETTINGS_BACKUP_MAX_MANIFEST_BYTES = 1 * 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_SETTINGS_ENTRY_BYTES = 10 * 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES = 5 * 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES = 100 * 1024 * 1024;

export interface OperonSettingsBackupArchiveEntryV1 {
	path: string;
	bytes: Uint8Array;
}

export interface OperonSettingsBackupArchiveFileDescriptorV1 {
	path: string;
	sha256: string;
	bytes: number;
}

export interface OperonSettingsBackupTableFileDescriptorV1
	extends OperonSettingsBackupArchiveFileDescriptorV1 {
	id: string;
	originalPath: string;
	formatVersion: typeof OPERON_TABLE_FILE_LEGACY_VERSION | typeof OPERON_TABLE_FILE_VERSION;
}

export interface OperonSettingsBackupTableManifestV1 {
	format: typeof OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT;
	manifestVersion: typeof OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION;
	settings: OperonSettingsBackupArchiveFileDescriptorV1 & { path: 'settings.json' };
	tableFiles: OperonSettingsBackupTableFileDescriptorV1[];
	/** Optional for legacy V1 manifests; new included bundles always declare it. */
	defaultPresetId?: string | null;
}

export interface OperonSettingsBackupValidatedTableEntryV1 {
	descriptor: OperonSettingsBackupTableFileDescriptorV1;
	text: string;
}

export type OperonSettingsBackupTableManifestValidationResult =
	| {
		ok: true;
		manifest: OperonSettingsBackupTableManifestV1;
		settingsText: string;
		tableFiles: OperonSettingsBackupValidatedTableEntryV1[];
		diagnostics: [];
	}
	| {
		ok: false;
		manifest: null;
		settingsText: null;
		tableFiles: [];
		diagnostics: OperonSettingsBackupDiagnostic[];
	};

/**
 * Validate a parsed logical manifest against already bounded archive entries.
 * ZIP central-directory and decompression checks belong to the archive engine.
 * The supplied entries intentionally exclude manifest.json itself.
 */
export function validateOperonSettingsBackupTableManifestV1(
	rawManifest: unknown,
	archiveEntries: readonly OperonSettingsBackupArchiveEntryV1[],
): OperonSettingsBackupTableManifestValidationResult {
	const diagnostics: OperonSettingsBackupDiagnostic[] = [];
	const manifest = parseManifest(rawManifest, diagnostics);
	if (!manifest) return failure(diagnostics);
	if (archiveEntries.length > OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES + 1) {
		diagnostics.push(error(
			'$.entries',
			'value',
			`Archive exceeds the maximum of ${OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES + 1} logical entries.`,
		));
	}

	const entriesByPath = new Map<string, OperonSettingsBackupArchiveEntryV1>();
	let totalEntryBytes = 0;
	for (let index = 0; index < Math.min(archiveEntries.length, OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES + 1); index++) {
		const entry = archiveEntries[index];
		const path = entry.path;
		totalEntryBytes += entry.bytes.byteLength;
		const entryLimit = path === 'settings.json'
			? OPERON_SETTINGS_BACKUP_MAX_SETTINGS_ENTRY_BYTES
			: OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES;
		if (entry.bytes.byteLength > entryLimit) {
			diagnostics.push(error(
				`$.entries[${index}].bytes`,
				'value',
				`Archive entry exceeds the ${entryLimit} byte limit.`,
			));
		}
		if (!isSafeArchivePath(path, path === 'settings.json')) {
			diagnostics.push(error(`$.entries[${index}].path`, 'value', `Unsafe or unsupported archive path: ${path}.`));
			continue;
		}
		if (entriesByPath.has(path)) {
			diagnostics.push(error(`$.entries[${index}].path`, 'value', `Duplicate archive path: ${path}.`));
			continue;
		}
		entriesByPath.set(path, entry);
	}
	if (totalEntryBytes > OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES) {
		diagnostics.push(error(
			'$.entries',
			'value',
			`Archive entries exceed the ${OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES} byte total limit.`,
		));
	}

	const declaredPaths = new Set<string>([
		manifest.settings.path,
		...manifest.tableFiles.map(item => item.path),
	]);
	for (const path of entriesByPath.keys()) {
		if (!declaredPaths.has(path)) diagnostics.push(error('$.entries', 'unknown-field', `Undeclared archive entry: ${path}.`));
	}
	for (const path of declaredPaths) {
		if (!entriesByPath.has(path)) diagnostics.push(error('$.entries', 'required', `Declared archive entry is missing: ${path}.`));
	}

	const settingsEntry = entriesByPath.get(manifest.settings.path);
	const settingsText = settingsEntry
		? validateEntryBytes(manifest.settings, settingsEntry.bytes, '$.settings', diagnostics)
		: null;
	const tableFiles: OperonSettingsBackupValidatedTableEntryV1[] = [];
	for (let index = 0; index < manifest.tableFiles.length; index++) {
		const descriptor = manifest.tableFiles[index];
		const entry = entriesByPath.get(descriptor.path);
		if (!entry) continue;
		const path = `$.tableFiles[${index}]`;
		const text = validateEntryBytes(descriptor, entry.bytes, path, diagnostics);
		if (text === null) continue;
		const parsed = parseOperonTableFile(text, descriptor.originalPath);
		if (parsed.status !== 'valid' || !parsed.file || !parsed.preset) {
			for (const item of parsed.diagnostics) {
				diagnostics.push(error(
					`${path}.content${item.field ? `.${item.field}` : ''}`,
					'value',
					item.message,
				));
			}
			continue;
		}
		if (parsed.preset.id !== descriptor.id) {
			diagnostics.push(error(`${path}.id`, 'value', 'Manifest Table ID does not match the Table file ID.'));
		}
		if (parsed.file.version !== descriptor.formatVersion) {
			diagnostics.push(error(`${path}.formatVersion`, 'value', 'Manifest Table version does not match the Table file version.'));
		}
		if (parsed.preset.id === descriptor.id && parsed.file.version === descriptor.formatVersion) {
			tableFiles.push({ descriptor, text });
		}
	}
	if (settingsText !== null) validateSettingsTableInventory(settingsText, manifest, diagnostics);

	if (diagnostics.length > 0 || settingsText === null || tableFiles.length !== manifest.tableFiles.length) {
		return failure(diagnostics);
	}
	return { ok: true, manifest, settingsText, tableFiles, diagnostics: [] };
}

function parseManifest(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupTableManifestV1 | null {
	const object = inspectObject(
		raw,
		'$',
		['format', 'manifestVersion', 'settings', 'tableFiles', 'defaultPresetId'],
		diagnostics,
		['defaultPresetId'],
	);
	if (!object) return null;
	if (object.format !== OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT) {
		diagnostics.push(error('$.format', 'value', `Expected ${OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT}.`));
	}
	if (object.manifestVersion !== OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION) {
		diagnostics.push(error('$.manifestVersion', 'unsupported-version', `Unsupported Table manifest version: ${String(object.manifestVersion)}.`));
	}
	const settings = parseFileDescriptor(
		object.settings,
		'$.settings',
		diagnostics,
		true,
		OPERON_SETTINGS_BACKUP_MAX_SETTINGS_ENTRY_BYTES,
	);
	if (settings && settings.path !== 'settings.json') {
		diagnostics.push(error('$.settings.path', 'value', 'Settings archive path must be settings.json.'));
	}
	if (!Array.isArray(object.tableFiles)) {
		diagnostics.push(error('$.tableFiles', 'type', 'tableFiles must be an array.'));
		return null;
	}
	if (object.tableFiles.length > OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES) {
		diagnostics.push(error(
			'$.tableFiles',
			'value',
			`tableFiles exceeds the maximum of ${OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES} items.`,
		));
	}

	const tableFiles: OperonSettingsBackupTableFileDescriptorV1[] = [];
	const ids = new Set<string>();
	const originalPaths = new Set<string>();
	const archivePaths = new Set<string>();
	for (let index = 0; index < Math.min(object.tableFiles.length, OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES); index++) {
		const path = `$.tableFiles[${index}]`;
		const item = inspectObject(
			object.tableFiles[index],
			path,
			['id', 'originalPath', 'path', 'formatVersion', 'sha256', 'bytes'],
			diagnostics,
		);
		if (!item) continue;
		const id = readString(item, 'id', path, diagnostics);
		const originalPath = readString(item, 'originalPath', path, diagnostics);
		const descriptor = parseFileDescriptor(item, path, diagnostics, false, OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES);
		const formatVersion = item.formatVersion;
		if (formatVersion !== OPERON_TABLE_FILE_LEGACY_VERSION && formatVersion !== OPERON_TABLE_FILE_VERSION) {
			diagnostics.push(error(`${path}.formatVersion`, 'unsupported-version', `Unsupported Table file version: ${String(formatVersion)}.`));
		}
		if (id && !isSafeTablePresetId(id)) diagnostics.push(error(`${path}.id`, 'value', 'Table ID is unsafe.'));
		if (originalPath && !isSafeOriginalTablePath(originalPath)) {
			diagnostics.push(error(`${path}.originalPath`, 'value', 'originalPath must be a safe vault-relative .table path.'));
		}
		if (descriptor && !isSafeArchivePath(descriptor.path, false)) {
			diagnostics.push(error(`${path}.path`, 'value', 'Table archive path must be a safe tables/... .table path.'));
		}
		if (id && ids.has(id)) diagnostics.push(error(`${path}.id`, 'value', `Duplicate Table ID: ${id}.`));
		const originalPathKey = originalPath ? portablePathCollisionKey(originalPath) : null;
		const archivePathKey = descriptor ? portablePathCollisionKey(descriptor.path) : null;
		if (originalPathKey && originalPaths.has(originalPathKey)) {
			diagnostics.push(error(`${path}.originalPath`, 'value', `Duplicate original Table path: ${originalPath}.`));
		}
		if (archivePathKey && archivePaths.has(archivePathKey)) {
			diagnostics.push(error(`${path}.path`, 'value', `Duplicate Table archive path: ${descriptor?.path ?? String(item.path)}.`));
		}
		if (id) ids.add(id);
		if (originalPathKey) originalPaths.add(originalPathKey);
		if (archivePathKey) archivePaths.add(archivePathKey);
		if (
			id && originalPath && descriptor
			&& isSafeTablePresetId(id)
			&& isSafeOriginalTablePath(originalPath)
			&& isSafeArchivePath(descriptor.path, false)
			&& (formatVersion === OPERON_TABLE_FILE_LEGACY_VERSION || formatVersion === OPERON_TABLE_FILE_VERSION)
		) {
			tableFiles.push({ ...descriptor, id, originalPath, formatVersion });
		}
	}
	let defaultPresetId: string | null | undefined;
	if (object.defaultPresetId === null) defaultPresetId = null;
	else if (object.defaultPresetId !== undefined) {
		defaultPresetId = readString(object, 'defaultPresetId', '$', diagnostics);
		if (defaultPresetId && !tableFiles.some(item => item.id === defaultPresetId)) {
			diagnostics.push(error('$.defaultPresetId', 'value', 'defaultPresetId must reference a declared Table file.'));
		}
	}
	if (
		object.format !== OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT
		|| object.manifestVersion !== OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION
		|| !settings
		|| settings.path !== 'settings.json'
		|| tableFiles.length !== object.tableFiles.length
		|| diagnostics.length > 0
	) return null;
	return {
		format: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT,
		manifestVersion: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION,
		settings: { ...settings, path: 'settings.json' },
		tableFiles,
		...(defaultPresetId !== undefined ? { defaultPresetId } : {}),
	};
}

function parseFileDescriptor(
	raw: unknown,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
	inspect: boolean,
	byteLimit: number,
): OperonSettingsBackupArchiveFileDescriptorV1 | null {
	const object = inspect
		? inspectObject(raw, path, ['path', 'sha256', 'bytes'], diagnostics)
		: raw as Record<string, unknown>;
	if (!object) return null;
	const entryPath = readString(object, 'path', path, diagnostics);
	const sha256 = readString(object, 'sha256', path, diagnostics);
	const bytes = object.bytes;
	if (sha256 && !/^[a-f0-9]{64}$/u.test(sha256)) {
		diagnostics.push(error(`${path}.sha256`, 'value', 'sha256 must be 64 lowercase hexadecimal characters.'));
	}
	if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
		diagnostics.push(error(`${path}.bytes`, 'type', 'bytes must be a non-negative safe integer.'));
	} else if (bytes > byteLimit) {
		diagnostics.push(error(
			`${path}.bytes`,
			'value',
			`bytes exceeds the ${byteLimit} byte entry limit.`,
		));
	}
	if (!entryPath || !sha256 || !/^[a-f0-9]{64}$/u.test(sha256)
		|| typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0
		|| bytes > byteLimit) return null;
	return { path: entryPath, sha256, bytes };
}

function validateEntryBytes(
	descriptor: OperonSettingsBackupArchiveFileDescriptorV1,
	bytes: Uint8Array,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): string | null {
	if (bytes.byteLength !== descriptor.bytes) {
		diagnostics.push(error(`${path}.bytes`, 'value', `Expected ${descriptor.bytes} bytes, received ${bytes.byteLength}.`));
	}
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		diagnostics.push(error(`${path}.content`, 'value', 'Archive entry is not valid UTF-8.'));
		return null;
	}
	if (new TextEncoder().encode(text).byteLength !== bytes.byteLength) {
		diagnostics.push(error(`${path}.content`, 'value', 'Archive entry is not canonical UTF-8 text.'));
		return null;
	}
	if (sha256HexV1(text) !== descriptor.sha256) {
		diagnostics.push(error(`${path}.sha256`, 'integrity-failed', 'Archive entry checksum does not match.'));
	}
	return text;
}

function inspectObject(
	value: unknown,
	path: string,
	allowedFields: readonly string[],
	diagnostics: OperonSettingsBackupDiagnostic[],
	optionalFields: readonly string[] = [],
): Record<string, unknown> | null {
	if (!isPlainRecord(value)) {
		diagnostics.push(error(path, 'type', 'Expected a plain JSON object.'));
		return null;
	}
	const allowed = new Set(allowedFields);
	for (const key of Object.keys(value)) {
		if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
			diagnostics.push(error(`${path}.${key}`, 'prototype', 'Prototype-related keys are forbidden.'));
		} else if (!allowed.has(key)) {
			diagnostics.push(error(`${path}.${key}`, 'unknown-field', `Unknown field: ${key}.`));
		}
	}
	const optional = new Set(optionalFields);
	for (const key of allowedFields) {
		if (optional.has(key)) continue;
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			diagnostics.push(error(`${path}.${key}`, 'required', 'Required field is missing.'));
		}
	}
	return value;
}

function readString(
	object: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): string | null {
	const value = object[key];
	if (typeof value !== 'string' || value.length === 0) {
		diagnostics.push(error(`${path}.${key}`, 'type', `${key} must be a non-empty string.`));
		return null;
	}
	return value;
}

function isSafeArchivePath(path: string, settings: boolean): boolean {
	if (settings) return path === 'settings.json';
	if (!path.startsWith('tables/') || !path.endsWith('.table')) return false;
	return isSafeRelativePath(path);
}

function isSafeOriginalTablePath(path: string): boolean {
	return path.endsWith('.table') && isSafeRelativePath(path);
}

function isSafeRelativePath(path: string): boolean {
	if (!path || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.includes('\\') || path.includes('\0')) return false;
	const segments = path.split('/');
	return segments.every(isPortablePathSegment);
}

function portablePathCollisionKey(path: string): string {
	return path
		.split('/')
		.map(segment => segment.normalize('NFC').replace(/[. ]+$/u, '').toLocaleLowerCase('en-US'))
		.join('/');
}

function isPortablePathSegment(segment: string): boolean {
	if (!segment || segment === '.' || segment === '..') return false;
	if ([...segment].some(character => character.charCodeAt(0) <= 0x1F)) return false;
	if (/[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) return false;
	const deviceStem = segment.split('.')[0]?.toLocaleLowerCase('en-US') ?? '';
	return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(deviceStem);
}

function validateSettingsTableInventory(
	settingsText: string,
	manifest: OperonSettingsBackupTableManifestV1,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	const parsed = parseOperonSettingsBackupV1(settingsText);
	if (!parsed.ok) {
		diagnostics.push(error('$.settings.content', 'value', 'settings.json is not a valid Operon settings backup.'));
		return;
	}
	if (parsed.value.body.scope.tableFiles !== 'included' || parsed.value.body.tableInventory?.mode !== 'included') {
		diagnostics.push(error('$.settings.content.body.scope.tableFiles', 'value', 'Table bundle settings must declare included Table files and inventory.'));
		return;
	}
	const inventory = parsed.value.body.tableInventory.items;
	const inventoryIds = new Set(inventory.map(item => item.id));
	if (inventoryIds.size !== inventory.length) {
		diagnostics.push(error('$.settings.content.body.tableInventory.items', 'value', 'Table inventory contains duplicate IDs.'));
	}
	for (const [index, descriptor] of manifest.tableFiles.entries()) {
		const item = inventory[index];
		const path = `$.tableFiles[${index}]`;
		if (!item) {
			diagnostics.push(error(`${path}.id`, 'required', `Table inventory is missing ordered ID: ${descriptor.id}.`));
			continue;
		}
		if (item.id !== descriptor.id) {
			diagnostics.push(error(`${path}.id`, 'value', 'Table inventory order or ID does not match the manifest.'));
			continue;
		}
		if (item.originalPath !== descriptor.originalPath) {
			diagnostics.push(error(`${path}.originalPath`, 'value', 'Table inventory originalPath does not match the manifest.'));
		}
		if (item.sha256 !== descriptor.sha256) {
			diagnostics.push(error(`${path}.sha256`, 'integrity-failed', 'Table inventory checksum does not match the manifest.'));
		}
	}
	if (inventory.length > manifest.tableFiles.length) {
		for (const item of inventory.slice(manifest.tableFiles.length)) {
			diagnostics.push(error('$.settings.content.body.tableInventory.items', 'unknown-field', `Table inventory contains undeclared ID: ${item.id}.`));
		}
	}
	const inventoryDefault = parsed.value.body.tableInventory.defaultPresetId;
	if (inventoryDefault !== manifest.defaultPresetId) {
		diagnostics.push(error(
			'$.defaultPresetId',
			'value',
			'Table inventory defaultPresetId does not match the manifest.',
		));
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as object | null;
	return prototype === Object.prototype || prototype === null;
}

function error(
	path: string,
	code: OperonSettingsBackupDiagnostic['code'],
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'error', message };
}

function failure(
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupTableManifestValidationResult {
	return { ok: false, manifest: null, settingsText: null, tableFiles: [], diagnostics };
}
