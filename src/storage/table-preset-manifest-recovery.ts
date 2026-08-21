import type { DiscoveredOperonTableFile } from '../types/table-file';
import {
	DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT,
	isSafeTablePresetId,
	isTableEmbedDefaultWidthPercent,
	isTableEmbedVisibleRows,
} from '../types/table';
import { getOperonTableFilePathKey, normalizeOperonTableFilePath } from './table-file';
import { TABLE_PRESET_MANIFEST_VERSION } from './table-preset-manifest';
import {
	isStructurallyCompleteOperonDataPackageV1,
	removeRetiredOperonDataPackageSettings,
} from './operon-data-package';
import { isSafeVaultRelativeFolderPath, normalizeSettingsFolderPath } from '../core/settings-folder-rules';

export type TablePresetManifestRecoveryBlockCode =
	| 'data-package-invalid'
	| 'manifest-malformed'
	| 'manifest-version-unsupported'
	| 'manifest-version-future'
	| 'preset-ids-empty'
	| 'preset-id-invalid'
	| 'preset-id-duplicate'
	| 'default-id-mismatch'
	| 'embedded-legacy-presets'
	| 'binding-invalid'
	| 'binding-partial'
	| 'binding-path-mismatch'
	| 'table-file-missing'
	| 'table-file-invalid'
	| 'table-file-duplicate';

export type TablePresetLegacySidecarRetirementBlockCode =
	| TablePresetManifestRecoveryBlockCode
	| 'legacy-sidecar-bindings-nonempty'
	| 'legacy-sidecar-index-missing'
	| 'legacy-sidecar-index-invalid'
	| 'legacy-sidecar-index-mismatch'
	| 'legacy-sidecar-file-missing'
	| 'legacy-sidecar-file-invalid'
	| 'legacy-sidecar-id-mismatch';

export interface TablePresetManifestRecoveryFileEvidence {
	path: string;
	status: DiscoveredOperonTableFile['status'];
	presetId: string | null;
	claimedPresetId: string | null;
}

/**
 * Read-only evidence from the retired V1 Table preset sidecar store. The
 * recovery path uses it only to prove that a blocked V2 manifest is the exact
 * historical shape that can safely lose its obsolete preset authority.
 */
export interface TablePresetLegacySidecarEvidenceV1 {
	index: { path: string; source: string | null };
	presets: Array<{ id: string; path: string; source: string | null }>;
}

export type TablePresetManifestRecoveryPreflight =
	| { status: 'not-needed'; reason: 'current' }
	| {
		status: 'recoverable';
		sourceVersion: 2 | 3;
		presetIds: string[];
		bindings: Array<{ id: string; path: string }>;
		initialized: boolean;
	}
	| { status: 'blocked'; code: TablePresetManifestRecoveryBlockCode };

export type TablePresetLegacySidecarRetirementPreflight =
	| {
		status: 'recoverable';
		presetIds: string[];
		indexPath: string;
		presetPaths: Array<{ id: string; path: string }>;
	}
	| { status: 'blocked'; code: TablePresetLegacySidecarRetirementBlockCode };

export function preflightTablePresetManifestRecoveryV1(
	dataPackage: unknown,
	files: readonly TablePresetManifestRecoveryFileEvidence[],
): TablePresetManifestRecoveryPreflight {
	if (!isStructurallyCompleteOperonDataPackageV1(dataPackage)) {
		return { status: 'blocked', code: 'data-package-invalid' };
	}
	const tableManifest = dataPackage.views.tablePresets;
	if (!isRecord(tableManifest) || !Number.isInteger(tableManifest.version)) {
		return { status: 'blocked', code: 'manifest-malformed' };
	}
	if (tableManifest.version === TABLE_PRESET_MANIFEST_VERSION) {
		return { status: 'not-needed', reason: 'current' };
	}
	if (tableManifest.version > TABLE_PRESET_MANIFEST_VERSION) {
		return { status: 'blocked', code: 'manifest-version-future' };
	}
	if (tableManifest.version !== 2 && tableManifest.version !== 3) {
		return { status: 'blocked', code: 'manifest-version-unsupported' };
	}
	const legacySettings = dataPackage.settings as Record<string, unknown>;
	if ((Array.isArray(tableManifest.tablePresets) && tableManifest.tablePresets.length > 0)
		|| (Array.isArray(legacySettings.tablePresets) && legacySettings.tablePresets.length > 0)) {
		return { status: 'blocked', code: 'embedded-legacy-presets' };
	}
	if (typeof tableManifest.tableEmbedVisibleRows !== 'number'
		|| !isTableEmbedVisibleRows(tableManifest.tableEmbedVisibleRows)
		|| (tableManifest.tableEmbedDefaultWidthPercent !== undefined
			&& (typeof tableManifest.tableEmbedDefaultWidthPercent !== 'number'
				|| !isTableEmbedDefaultWidthPercent(tableManifest.tableEmbedDefaultWidthPercent)))
		|| typeof tableManifest.tableShowLineNumbers !== 'boolean'
		|| typeof tableManifest.tableShowTaskIcon !== 'boolean'
		|| typeof tableManifest.tableShowTaskTypeIcon !== 'boolean') {
		return { status: 'blocked', code: 'manifest-malformed' };
	}
	if (!isValidLegacyTableDefaultFolder(tableManifest)) {
		return { status: 'blocked', code: 'manifest-malformed' };
	}

	const existingBindings = parseBindings(tableManifest.fileBindings);
	if (!existingBindings.ok) return { status: 'blocked', code: 'binding-invalid' };
	if (!Array.isArray(tableManifest.presetIds)) {
		return { status: 'blocked', code: 'manifest-malformed' };
	}
	if (tableManifest.presetIds.length === 0) {
		if (tableManifest.version === 3
			&& tableManifest.initialized === false
			&& tableManifest.tableDefaultPresetId === null
			&& existingBindings.bindings.length === 0) {
			return {
				status: 'recoverable',
				sourceVersion: 3,
				presetIds: [],
				bindings: [],
				initialized: false,
			};
		}
		return { status: 'blocked', code: 'preset-ids-empty' };
	}
	const presetIds: string[] = [];
	const presetIdSet = new Set<string>();
	for (const rawId of tableManifest.presetIds) {
		if (typeof rawId !== 'string' || rawId !== rawId.trim() || !isSafeTablePresetId(rawId)) {
			return { status: 'blocked', code: 'preset-id-invalid' };
		}
		if (presetIdSet.has(rawId)) return { status: 'blocked', code: 'preset-id-duplicate' };
		presetIdSet.add(rawId);
		presetIds.push(rawId);
	}
	if (tableManifest.tableDefaultPresetId !== null
		&& (typeof tableManifest.tableDefaultPresetId !== 'string'
			|| !presetIdSet.has(tableManifest.tableDefaultPresetId))) {
		return { status: 'blocked', code: 'default-id-mismatch' };
	}
	if (existingBindings.bindings.length > 0
		&& (existingBindings.bindings.length !== presetIds.length
			|| existingBindings.bindings.some(binding => !presetIdSet.has(binding.id)))) {
		return { status: 'blocked', code: 'binding-partial' };
	}

	const evidenceById = new Map<string, TablePresetManifestRecoveryFileEvidence[]>();
	for (const file of files) {
		const claimedId = file.presetId ?? file.claimedPresetId;
		if (!claimedId || !presetIdSet.has(claimedId)) continue;
		const matches = evidenceById.get(claimedId) ?? [];
		matches.push(file);
		evidenceById.set(claimedId, matches);
	}
	const existingBindingById = new Map(existingBindings.bindings.map(binding => [binding.id, binding]));
	const bindings: Array<{ id: string; path: string }> = [];
	for (const presetId of presetIds) {
		const matches = evidenceById.get(presetId) ?? [];
		if (matches.length === 0) return { status: 'blocked', code: 'table-file-missing' };
		if (matches.length !== 1 || matches[0].status === 'conflict') {
			return { status: 'blocked', code: 'table-file-duplicate' };
		}
		const match = matches[0];
		if (match.status !== 'loaded' || match.presetId !== presetId) {
			return { status: 'blocked', code: 'table-file-invalid' };
		}
		const path = normalizeOperonTableFilePath(match.path);
		const existingBinding = existingBindingById.get(presetId);
		if (existingBinding && getOperonTableFilePathKey(existingBinding.path) !== getOperonTableFilePathKey(path)) {
			return { status: 'blocked', code: 'binding-path-mismatch' };
		}
		bindings.push({ id: presetId, path });
	}
	return { status: 'recoverable', sourceVersion: tableManifest.version, presetIds, bindings, initialized: true };
}

export function buildRecoveredTablePresetDataPackageV1<T>(
	dataPackage: T,
	preflight: Extract<TablePresetManifestRecoveryPreflight, { status: 'recoverable' }>,
): T {
	const cloned = cloneJson(dataPackage) as unknown;
	if (!isRecord(cloned) || !isRecord(cloned.views) || !isRecord(cloned.views.tablePresets)) {
		throw new Error('Table preset recovery candidate is not a complete data package.');
	}
	const tableManifest = { ...cloned.views.tablePresets };
	const legacyTaskTypeIcon = tableManifest.tableShowTaskTypeIcon;
	delete tableManifest.tablePresets;
	delete tableManifest.fileMigrationVersion;
	delete tableManifest.fileMigrationFinalizedVersion;
	delete tableManifest.tableShowTaskTypeIcon;
	cloned.views = {
		...cloned.views,
		tablePresets: {
			...tableManifest,
			version: TABLE_PRESET_MANIFEST_VERSION,
			presetIds: [...preflight.presetIds],
			fileBindings: preflight.bindings.map(binding => ({ ...binding })),
			initialized: preflight.initialized,
			tableShowTaskDataTypeIcon: legacyTaskTypeIcon,
		},
	};
	return cloned as T;
}

/**
 * Classify the one retired-sidecar shape affected by Issue #162. Unlike the
 * legacy manifest recovery above, this intentionally does not read, normalize,
 * or migrate preset bodies. It only proves their old identity before retiring
 * their no-longer-supported authority from data.json.
 */
export function preflightLegacyTablePresetSidecarRetirementV1(
	dataPackage: unknown,
	evidence: TablePresetLegacySidecarEvidenceV1,
): TablePresetLegacySidecarRetirementPreflight {
	const manifestPreflight = preflightTablePresetManifestRecoveryV1(dataPackage, []);
	if (manifestPreflight.status !== 'blocked' || manifestPreflight.code !== 'table-file-missing') {
		return manifestPreflight.status === 'blocked'
			? { status: 'blocked', code: manifestPreflight.code }
			: { status: 'blocked', code: 'manifest-malformed' };
	}
	if (!isRecord(dataPackage) || !isRecord(dataPackage.views) || !isRecord(dataPackage.views.tablePresets)) {
		return { status: 'blocked', code: 'manifest-malformed' };
	}
	const manifest = dataPackage.views.tablePresets;
	if (!Array.isArray(manifest.fileBindings) || manifest.fileBindings.length !== 0) {
		return { status: 'blocked', code: 'legacy-sidecar-bindings-nonempty' };
	}
	if (evidence.index.source === null) return { status: 'blocked', code: 'legacy-sidecar-index-missing' };

	let index: unknown;
	try {
		index = JSON.parse(evidence.index.source) as unknown;
	} catch {
		return { status: 'blocked', code: 'legacy-sidecar-index-invalid' };
	}
	if (!isRecord(index)
		|| index.version !== 1
		|| !Array.isArray(index.presetIds)
		|| (index.tableDefaultPresetId !== null && typeof index.tableDefaultPresetId !== 'string')
		|| !isTableEmbedVisibleRows(index.tableEmbedVisibleRows as number)
		|| typeof index.tableShowLineNumbers !== 'boolean'
		|| typeof index.tableShowTaskIcon !== 'boolean'
		|| typeof index.tableShowTaskTypeIcon !== 'boolean') {
		return { status: 'blocked', code: 'legacy-sidecar-index-invalid' };
	}

	const presetIds = [...(manifest.presetIds as string[])];
	if (index.presetIds.length !== presetIds.length
		|| index.presetIds.some((id, indexPosition) => id !== presetIds[indexPosition])
		|| index.tableDefaultPresetId !== manifest.tableDefaultPresetId
		|| index.tableEmbedVisibleRows !== manifest.tableEmbedVisibleRows
		|| index.tableShowLineNumbers !== manifest.tableShowLineNumbers
		|| index.tableShowTaskIcon !== manifest.tableShowTaskIcon
		|| index.tableShowTaskTypeIcon !== manifest.tableShowTaskTypeIcon) {
		return { status: 'blocked', code: 'legacy-sidecar-index-mismatch' };
	}

	const evidenceById = new Map(evidence.presets.map(entry => [entry.id, entry]));
	if (evidenceById.size !== evidence.presets.length) return { status: 'blocked', code: 'legacy-sidecar-file-invalid' };
	const presetPaths: Array<{ id: string; path: string }> = [];
	for (const presetId of presetIds) {
		const entry = evidenceById.get(presetId);
		if (!entry || entry.source === null) return { status: 'blocked', code: 'legacy-sidecar-file-missing' };
		let preset: unknown;
		try {
			preset = JSON.parse(entry.source) as unknown;
		} catch {
			return { status: 'blocked', code: 'legacy-sidecar-file-invalid' };
		}
		if (!isRecord(preset) || preset.version !== 1) {
			return { status: 'blocked', code: 'legacy-sidecar-file-invalid' };
		}
		if (preset.id !== presetId) return { status: 'blocked', code: 'legacy-sidecar-id-mismatch' };
		presetPaths.push({ id: presetId, path: entry.path });
	}
	return { status: 'recoverable', presetIds, indexPath: evidence.index.path, presetPaths };
}

/**
 * Retire obsolete V1 sidecar authority without touching those sidecar files.
 * The sparse current manifest lets the registry adopt any actual .table files, or
 * seed one new default when none exist.
 */
export function buildRetiredLegacyTablePresetDataPackageV1<T>(
	dataPackage: T,
	preflight: Extract<TablePresetLegacySidecarRetirementPreflight, { status: 'recoverable' }>,
): T {
	const cloned = cloneJson(dataPackage) as unknown;
	if (!isRecord(cloned) || !isRecord(cloned.views) || !isRecord(cloned.views.tablePresets)) {
		throw new Error('Legacy Table sidecar retirement candidate is not a complete data package.');
	}
	const manifest = cloned.views.tablePresets;
	const retiredIds = new Set(preflight.presetIds);
	const nextManifest: Record<string, unknown> = {
		version: TABLE_PRESET_MANIFEST_VERSION,
		presetIds: [],
		fileBindings: [],
		initialized: false,
		tableDefaultPresetId: null,
		tableEmbedVisibleRows: manifest.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: isTableEmbedDefaultWidthPercent(manifest.tableEmbedDefaultWidthPercent as number)
			? manifest.tableEmbedDefaultWidthPercent
			: DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT,
		tableShowLineNumbers: manifest.tableShowLineNumbers,
		tableShowTaskIcon: manifest.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: manifest.tableShowTaskTypeIcon,
	};
	if (typeof manifest.tableDefaultFolder === 'string') nextManifest.tableDefaultFolder = manifest.tableDefaultFolder;
	cloned.views = { ...cloned.views, tablePresets: nextManifest };

	if (isRecord(cloned.ui) && isRecord(cloned.ui.presetFavorites) && Array.isArray(cloned.ui.presetFavorites.table)) {
		cloned.ui = {
			...cloned.ui,
			presetFavorites: {
				...cloned.ui.presetFavorites,
				table: cloned.ui.presetFavorites.table.filter(value => typeof value !== 'string' || !retiredIds.has(value)),
			},
		};
	}
	return cloned as T;
}

export function readLooseTablePresetIdV1(source: string): string | null {
	try {
		const value: unknown = JSON.parse(source);
		if (!isRecord(value) || typeof value.id !== 'string') return null;
		const id = value.id.trim();
		return isSafeTablePresetId(id) ? id : null;
	} catch {
		return null;
	}
}

export function overlayKnownDataPackageFieldsPreservingUnknownV1<T>(source: unknown, known: T): T {
	const merged = overlayKnownJsonFields(source, known);
	if (isRecord(merged) && Object.prototype.hasOwnProperty.call(merged, 'settings')) {
		merged.settings = removeRetiredOperonDataPackageSettings(merged.settings);
	}
	return merged as T;
}

function isValidLegacyTableDefaultFolder(manifest: Record<string, unknown>): boolean {
	if (!Object.prototype.hasOwnProperty.call(manifest, 'tableDefaultFolder')) return true;
	const value = manifest.tableDefaultFolder;
	if (typeof value !== 'string' || value !== normalizeSettingsFolderPath(value)) return false;
	return value === '' || isSafeVaultRelativeFolderPath(value);
}

function overlayKnownJsonFields(source: unknown, known: unknown): unknown {
	if (!isRecord(source) || !isRecord(known)) return cloneJson(known);
	const result: Record<string, unknown> = cloneJson(source);
	for (const [key, value] of Object.entries(known)) {
		result[key] = overlayKnownJsonFields(source[key], value);
	}
	return result;
}

function parseBindings(value: unknown):
	| { ok: true; bindings: Array<{ id: string; path: string }> }
	| { ok: false } {
	if (!Array.isArray(value)) return { ok: false };
	const bindings: Array<{ id: string; path: string }> = [];
	const ids = new Set<string>();
	const paths = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.path !== 'string') return { ok: false };
		const id = raw.id.trim();
		const path = normalizeOperonTableFilePath(raw.path);
		const pathKey = getOperonTableFilePathKey(path);
		if (id !== raw.id || !isSafeTablePresetId(id) || !path || ids.has(id) || paths.has(pathKey)) return { ok: false };
		ids.add(id);
		paths.add(pathKey);
		bindings.push({ id, path });
	}
	return { ok: true, bindings };
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
