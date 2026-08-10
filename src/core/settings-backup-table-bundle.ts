import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import { parseOperonTableFile } from '../storage/table-file';
import type { OperonSettings } from '../types/settings';
import { isSafeTablePresetId } from '../types/table';
import { exportOperonSettingsBackupJsonV1, type OperonSettingsBackupExportInputV1 } from './settings-backup-export';
import {
	buildOperonSettingsBackupV1,
	serializeOperonSettingsBackupV1,
	type OperonSettingsBackupDiagnostic,
	type OperonSettingsBackupV1,
} from './settings-backup-format';
import {
	OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_SETTINGS_ENTRY_BYTES,
	OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES,
	OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT,
	OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION,
	validateOperonSettingsBackupTableManifestV1,
	type OperonSettingsBackupArchiveEntryV1,
	type OperonSettingsBackupTableManifestV1,
} from './settings-backup-table-manifest';
import {
	createOperonSettingsBackupArchiveV1,
	readOperonSettingsBackupArchiveV1,
} from './settings-backup-archive';
import type { OperonSettingsBackupValidatedTableBundleV1 } from './settings-backup-table-resource-preflight';

export interface OperonSettingsBackupTableBundleSourceFileV1 {
	/** Exact authoritative vault path from the committed settings binding. */
	path: string;
	/** Exact text returned by the coordinator's bounded, race-checked read. */
	text: string;
}

export interface OperonSettingsBackupTableBundleExportInputV1 extends OperonSettingsBackupExportInputV1 {
	tableFiles: readonly OperonSettingsBackupTableBundleSourceFileV1[];
}

export interface OperonSettingsBackupTableBundleExportV1 {
	backup: OperonSettingsBackupV1;
	settingsJson: string;
	manifest: OperonSettingsBackupTableManifestV1;
	manifestJson: string;
	entries: readonly OperonSettingsBackupArchiveEntryV1[];
	suggestedFileName: string;
}

export type OperonSettingsBackupTableBundleExportResultV1 =
	| { ok: true; bundle: OperonSettingsBackupTableBundleExportV1; diagnostics: [] }
	| { ok: false; bundle: null; diagnostics: OperonSettingsBackupDiagnostic[] };

/**
 * Build the logical contents for an included-Table ZIP. This is deliberately
 * filesystem-free: the coordinator must supply one exact, authoritative read
 * for every committed binding and owns the final archive write/download.
 */
export function exportOperonSettingsBackupTableBundleV1(
	input: OperonSettingsBackupTableBundleExportInputV1,
): OperonSettingsBackupTableBundleExportResultV1 {
	const diagnostics: OperonSettingsBackupDiagnostic[] = [];
	const base = exportOperonSettingsBackupJsonV1(input);
	if (!base.ok) return { ok: false, bundle: null, diagnostics: base.diagnostics };

	const bindings = orderedBindings(input.settings, diagnostics);
	if (bindings.length > OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES) {
		diagnostics.push(error('$.tableFiles', 'value', `Table bundle exceeds ${OPERON_SETTINGS_BACKUP_MAX_TABLE_FILES} files.`));
	}
	const sourceByPath = new Map<string, OperonSettingsBackupTableBundleSourceFileV1>();
	for (const [index, source] of input.tableFiles.entries()) {
		if (!isSafePortableTablePath(source.path)) {
			diagnostics.push(error(`$.tableFiles[${index}].path`, 'value', `Unsafe or non-portable Table path: ${source.path}.`));
		}
		if (sourceByPath.has(source.path)) {
			diagnostics.push(error(`$.tableFiles[${index}].path`, 'value', `Duplicate authoritative Table path: ${source.path}.`));
		}
		sourceByPath.set(source.path, source);
	}
	if (input.tableFiles.length !== bindings.length) {
		diagnostics.push(error('$.tableFiles', 'value', 'Authoritative Table reads must exactly match committed bindings.'));
	}

	const encoder = new TextEncoder();
	const tableDescriptors: OperonSettingsBackupTableManifestV1['tableFiles'] = [];
	const tableEntries: OperonSettingsBackupArchiveEntryV1[] = [];
	let totalBytes = 0;
	for (const [index, binding] of bindings.entries()) {
		const source = sourceByPath.get(binding.path);
		if (!source) {
			diagnostics.push(error(`$.bindings[${index}]`, 'required', `Bound Table file is missing: ${binding.path}.`));
			continue;
		}
		sourceByPath.delete(binding.path);
		const bytes = encoder.encode(source.text);
		if (bytes.byteLength > OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES) {
			diagnostics.push(error(`$.bindings[${index}].bytes`, 'value', `Table file exceeds ${OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_ENTRY_BYTES} bytes.`));
			continue;
		}
		totalBytes += bytes.byteLength;
		const parsed = parseOperonTableFile(source.text, binding.path);
		if (parsed.status !== 'valid' || !parsed.file || !parsed.preset) {
			for (const item of parsed.diagnostics) {
				diagnostics.push(error(
					`$.bindings[${index}].content${item.field ? `.${item.field}` : ''}`,
					'value',
					item.message,
				));
			}
			continue;
		}
		if (parsed.preset.id !== binding.id) {
			diagnostics.push(error(`$.bindings[${index}].id`, 'value', 'Committed binding ID does not match the Table file ID.'));
			continue;
		}
		const archivePath = `tables/${String(index + 1).padStart(4, '0')}.table`;
		const sha256 = sha256HexV1(source.text);
		tableDescriptors.push({
			id: binding.id,
			originalPath: binding.path,
			path: archivePath,
			formatVersion: parsed.file.version,
			sha256,
			bytes: bytes.byteLength,
		});
		tableEntries.push({ path: archivePath, bytes });
	}
	for (const path of sourceByPath.keys()) {
		diagnostics.push(error('$.tableFiles', 'unknown-field', `Authoritative read is not declared by settings: ${path}.`));
	}

	const includedIds = new Set(tableDescriptors.map(item => item.id));
	const defaultPresetId = input.settings.tableDefaultPresetId;
	if (defaultPresetId !== null && !includedIds.has(defaultPresetId)) {
		diagnostics.push(error('$.settings.tableDefaultPresetId', 'value', 'The Table default is not backed by an included valid binding.'));
	}
	if (diagnostics.length > 0 || tableDescriptors.length !== bindings.length) {
		return { ok: false, bundle: null, diagnostics };
	}

	const backup = buildOperonSettingsBackupV1({
		...base.backup.body,
		scope: { ...base.backup.body.scope, tableFiles: 'included' },
		tableInventory: {
			mode: 'included',
			items: tableDescriptors.map(item => ({
				id: item.id,
				originalPath: item.originalPath,
				sha256: item.sha256,
			})),
			defaultPresetId,
		},
	});
	const settingsJson = serializeOperonSettingsBackupV1(backup);
	const settingsBytes = encoder.encode(settingsJson);
	totalBytes += settingsBytes.byteLength;
	if (settingsBytes.byteLength > OPERON_SETTINGS_BACKUP_MAX_SETTINGS_ENTRY_BYTES) {
		return { ok: false, bundle: null, diagnostics: [error('$.settings', 'value', 'settings.json exceeds the archive entry limit.')] };
	}
	if (totalBytes > OPERON_SETTINGS_BACKUP_MAX_ARCHIVE_TOTAL_BYTES) {
		return { ok: false, bundle: null, diagnostics: [error('$.entries', 'value', 'Logical archive entries exceed the total byte limit.')] };
	}

	const manifest: OperonSettingsBackupTableManifestV1 = {
		format: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT,
		manifestVersion: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION,
		settings: {
			path: 'settings.json',
			sha256: sha256HexV1(settingsJson),
			bytes: settingsBytes.byteLength,
		},
		tableFiles: tableDescriptors,
		defaultPresetId,
	};
	const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
	const manifestBytes = encoder.encode(manifestJson);
	const logicalEntries = [{ path: 'settings.json', bytes: settingsBytes }, ...tableEntries];
	const validated = validateOperonSettingsBackupTableManifestV1(manifest, logicalEntries);
	if (!validated.ok) return { ok: false, bundle: null, diagnostics: validated.diagnostics };

	return {
		ok: true,
		bundle: {
			backup,
			settingsJson,
			manifest,
			manifestJson,
			entries: [{ path: 'manifest.json', bytes: manifestBytes }, ...logicalEntries],
			suggestedFileName: base.suggestedFileName.replace(/\.json$/u, '.zip'),
		},
		diagnostics: [],
	};
}

/** Serialize a previously validated logical bundle into the deterministic ZIP container. */
export async function createOperonSettingsBackupTableBundleArchiveV1(
	bundle: OperonSettingsBackupTableBundleExportV1,
): Promise<Uint8Array> {
	return createOperonSettingsBackupArchiveV1([
		...bundle.entries.map(entry => ({ path: entry.path, bytes: entry.bytes })),
	]);
}

/**
 * Strictly open an archive and bind its manifest, settings document and every
 * Table byte before resource preflight is allowed to inspect the target vault.
 */
export async function readOperonSettingsBackupTableBundleArchiveV1(
	archiveBytes: Uint8Array,
): Promise<OperonSettingsBackupValidatedTableBundleV1> {
	const archive = await readOperonSettingsBackupArchiveV1(archiveBytes);
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const manifestText = decoder.decode(archive.manifestBytes);
	let manifest: unknown;
	try {
		manifest = JSON.parse(manifestText);
	} catch {
		throw new Error('Table bundle manifest is not valid JSON.');
	}
	const logicalEntries = archive.entries
		.filter(entry => entry.path !== 'manifest.json')
		.map(entry => ({ path: entry.path, bytes: entry.bytes }));
	const validated = validateOperonSettingsBackupTableManifestV1(manifest, logicalEntries);
	if (!validated.ok || !validated.manifest) {
		throw new Error('Table bundle manifest does not exactly bind the archive inventory.');
	}
	const settingsEntry = logicalEntries.find(entry => entry.path === validated.manifest.settings.path);
	if (!settingsEntry) throw new Error('Table bundle settings entry is missing.');
	const byPath = new Map(logicalEntries.map(entry => [entry.path, entry.bytes]));
	const tableFiles = validated.manifest.tableFiles.map(descriptor => {
		const bytes = byPath.get(descriptor.path);
		if (!bytes) throw new Error(`Table bundle entry is missing: ${descriptor.path}.`);
		return { descriptor, text: decoder.decode(bytes) };
	});
	const digest = await crypto.subtle.digest('SHA-256', archiveBytes.slice());
	const archiveSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	return {
		manifest: validated.manifest,
		settingsText: decoder.decode(settingsEntry.bytes),
		tableFiles,
		archiveSha256,
	};
}

function orderedBindings(
	settings: Readonly<OperonSettings>,
	diagnostics: OperonSettingsBackupDiagnostic[],
): Array<{ id: string; path: string }> {
	const order = new Map(settings.tablePresetOrderIds.map((id, index) => [id, index]));
	const ids = new Set<string>();
	const paths = new Set<string>();
	const bindings = settings.tablePresetFileBindings.map(binding => ({ ...binding }));
	for (const [index, binding] of bindings.entries()) {
		if (!isSafeTablePresetId(binding.id)) diagnostics.push(error(`$.bindings[${index}].id`, 'value', 'Table binding ID is unsafe.'));
		if (!isSafePortableTablePath(binding.path)) diagnostics.push(error(`$.bindings[${index}].path`, 'value', 'Table binding path is unsafe or non-portable.'));
		if (ids.has(binding.id)) diagnostics.push(error(`$.bindings[${index}].id`, 'value', `Duplicate Table binding ID: ${binding.id}.`));
		const pathKey = portablePathKey(binding.path);
		if (paths.has(pathKey)) diagnostics.push(error(`$.bindings[${index}].path`, 'value', `Colliding Table binding path: ${binding.path}.`));
		ids.add(binding.id);
		paths.add(pathKey);
	}
	return bindings.sort((left, right) => (
		(order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
		|| compareCodeUnits(left.id, right.id)
		|| compareCodeUnits(left.path, right.path)
	));
}

function isSafePortableTablePath(path: string): boolean {
	if (!path.endsWith('.table') || path !== path.normalize('NFC') || path.startsWith('/')
		|| /^[A-Za-z]:/u.test(path) || path.includes('\\') || path.includes('\0')) return false;
	return path.split('/').every(segment => {
		if (!segment || segment === '.' || segment === '..') return false;
		if ([...segment].some(character => character.charCodeAt(0) <= 0x1F || character.charCodeAt(0) === 0x7F)) return false;
		if (/[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) return false;
		const deviceStem = segment.split('.')[0]?.toLocaleLowerCase('en-US') ?? '';
		return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(deviceStem);
	});
}

function portablePathKey(path: string): string {
	return path.split('/').map(segment => segment.normalize('NFC').replace(/[. ]+$/u, '').toLocaleLowerCase('en-US')).join('/');
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function error(
	path: string,
	code: OperonSettingsBackupDiagnostic['code'],
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'error', message };
}
