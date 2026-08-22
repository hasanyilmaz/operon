import type { DiscoveredOperonTableFile } from '../types/table-file';
import {
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

export interface TablePresetManifestRecoveryFileEvidence {
	path: string;
	status: DiscoveredOperonTableFile['status'];
	presetId: string | null;
	claimedPresetId: string | null;
	/** Exact contents observed while classifying this file. */
	sourceSha256?: string;
	/** Vault mtime observed with the same source snapshot. */
	mtime?: number;
}

export interface TablePresetDuplicateRecoveryGroup {
	presetId: string;
	winnerPath: string;
	otherPaths: string[];
}

export type TablePresetManifestRecoveryPreflight =
	| { status: 'not-needed'; reason: 'current' }
	| {
		status: 'recoverable';
		sourceVersion: 2 | 3;
		presetIds: string[];
		bindings: Array<{ id: string; path: string }>;
		initialized: boolean;
		duplicateGroups?: TablePresetDuplicateRecoveryGroup[];
	}
	| { status: 'degraded'; code: 'table-file-missing' | 'table-file-invalid' }
	| { status: 'blocked'; code: TablePresetManifestRecoveryBlockCode };

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
		return isValidCurrentTablePresetManifest(tableManifest)
			? { status: 'not-needed', reason: 'current' }
			: { status: 'blocked', code: 'manifest-malformed' };
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
	const invalidClaimsById = new Set<string>();
	for (const file of files) {
		if (file.status === 'invalid') {
			if (file.claimedPresetId && presetIdSet.has(file.claimedPresetId)) invalidClaimsById.add(file.claimedPresetId);
			continue;
		}
		if (!file.presetId || !presetIdSet.has(file.presetId)) continue;
		const matches = evidenceById.get(file.presetId) ?? [];
		matches.push(file);
		evidenceById.set(file.presetId, matches);
	}
	const existingBindingById = new Map(existingBindings.bindings.map(binding => [binding.id, binding]));
	const bindings: Array<{ id: string; path: string }> = [];
	const duplicateGroups: TablePresetDuplicateRecoveryGroup[] = [];
	for (const presetId of presetIds) {
		const matches = evidenceById.get(presetId) ?? [];
		if (matches.length === 0) {
			return { status: 'degraded', code: invalidClaimsById.has(presetId) ? 'table-file-invalid' : 'table-file-missing' };
		}
		const existingBinding = existingBindingById.get(presetId);
		if (existingBinding && !matches.some(file =>
			getOperonTableFilePathKey(file.path) === getOperonTableFilePathKey(existingBinding.path))) {
			return { status: 'degraded', code: invalidClaimsById.has(presetId) ? 'table-file-invalid' : 'table-file-missing' };
		}
		const ranked = [...matches].sort((left, right) => compareRecoveryCandidates(left, right, existingBinding?.path));
		const match = ranked[0];
		if (!match || match.presetId !== presetId) return { status: 'degraded', code: 'table-file-invalid' };
		const path = normalizeOperonTableFilePath(match.path);
		if (ranked.length > 1) {
			duplicateGroups.push({
				presetId,
				winnerPath: path,
				otherPaths: ranked.slice(1).map(file => normalizeOperonTableFilePath(file.path)),
			});
		}
		bindings.push({ id: presetId, path });
	}
	return {
		status: 'recoverable',
		sourceVersion: tableManifest.version,
		presetIds,
		bindings,
		initialized: true,
		...(duplicateGroups.length > 0 ? { duplicateGroups } : {}),
	};
}

function isValidCurrentTablePresetManifest(manifest: Record<string, unknown>): boolean {
	if (!Array.isArray(manifest.presetIds)
		|| typeof manifest.initialized !== 'boolean'
		|| typeof manifest.tableDefaultFolder !== 'string'
		|| manifest.tableDefaultFolder !== normalizeSettingsFolderPath(manifest.tableDefaultFolder)
		|| (manifest.tableDefaultFolder !== '' && !isSafeVaultRelativeFolderPath(manifest.tableDefaultFolder))
		|| typeof manifest.tableEmbedVisibleRows !== 'number'
		|| !isTableEmbedVisibleRows(manifest.tableEmbedVisibleRows)
		|| typeof manifest.tableEmbedDefaultWidthPercent !== 'number'
		|| !isTableEmbedDefaultWidthPercent(manifest.tableEmbedDefaultWidthPercent)
		|| typeof manifest.tableShowLineNumbers !== 'boolean'
		|| typeof manifest.tableShowTaskIcon !== 'boolean'
		|| typeof manifest.tableShowTaskDataTypeIcon !== 'boolean') return false;
	const ids = new Set<string>();
	for (const value of manifest.presetIds) {
		if (typeof value !== 'string' || value !== value.trim() || !isSafeTablePresetId(value) || ids.has(value)) return false;
		ids.add(value);
	}
	if (manifest.tableDefaultPresetId !== null
		&& (typeof manifest.tableDefaultPresetId !== 'string' || !ids.has(manifest.tableDefaultPresetId))) return false;
	const bindings = parseBindings(manifest.fileBindings);
	return bindings.ok
		&& bindings.bindings.every(binding => ids.has(binding.id))
		&& (manifest.initialized
			? bindings.bindings.length === ids.size
			: bindings.bindings.length === 0);
}

function compareRecoveryCandidates(
	left: TablePresetManifestRecoveryFileEvidence,
	right: TablePresetManifestRecoveryFileEvidence,
	boundPath: string | undefined,
): number {
	const mtimeDelta = (right.mtime ?? 0) - (left.mtime ?? 0);
	if (mtimeDelta !== 0) return mtimeDelta;
	if (boundPath) {
		const boundKey = getOperonTableFilePathKey(boundPath);
		const leftBound = getOperonTableFilePathKey(left.path) === boundKey;
		const rightBound = getOperonTableFilePathKey(right.path) === boundKey;
		if (leftBound !== rightBound) return leftBound ? -1 : 1;
	}
	const leftPath = normalizeOperonTableFilePath(left.path);
	const rightPath = normalizeOperonTableFilePath(right.path);
	return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
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
