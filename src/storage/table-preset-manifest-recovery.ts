import type { DiscoveredOperonTableFile } from '../types/table-file';
import { isSafeTablePresetId, isTableEmbedVisibleRows } from '../types/table';
import { getOperonTableFilePathKey, normalizeOperonTableFilePath } from './table-file';
import { TABLE_PRESET_MANIFEST_VERSION } from './table-preset-manifest';
import { removeRetiredOperonDataPackageSettings } from './operon-data-package';

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
}

export type TablePresetManifestRecoveryPreflight =
	| { status: 'not-needed'; reason: 'current' }
	| {
		status: 'recoverable';
		presetIds: string[];
		bindings: Array<{ id: string; path: string }>;
	}
	| { status: 'blocked'; code: TablePresetManifestRecoveryBlockCode };

export function preflightTablePresetManifestRecoveryV1(
	dataPackage: unknown,
	files: readonly TablePresetManifestRecoveryFileEvidence[],
): TablePresetManifestRecoveryPreflight {
	if (!isRecord(dataPackage)
		|| dataPackage.schemaVersion !== 2
		|| !isRecord(dataPackage.settings)
		|| !isRecord(dataPackage.taxonomy)
		|| !isRecord(dataPackage.views)
		|| !isRecord(dataPackage.ui)
		|| !isRecord(dataPackage.automation)
		|| !isRecord(dataPackage.integrations)
		|| !isRecord(dataPackage.state)) {
		return { status: 'blocked', code: 'data-package-invalid' };
	}
	const tableManifest = dataPackage.views.tablePresets;
	if (!isRecord(tableManifest) || !Number.isInteger(tableManifest.version)) {
		return { status: 'blocked', code: 'manifest-malformed' };
	}
	if (tableManifest.version === TABLE_PRESET_MANIFEST_VERSION) {
		return { status: 'not-needed', reason: 'current' };
	}
	if ((tableManifest.version as number) > TABLE_PRESET_MANIFEST_VERSION) {
		return { status: 'blocked', code: 'manifest-version-future' };
	}
	if (tableManifest.version !== 2) {
		return { status: 'blocked', code: 'manifest-version-unsupported' };
	}
	if ((Array.isArray(tableManifest.tablePresets) && tableManifest.tablePresets.length > 0)
		|| (Array.isArray(dataPackage.settings.tablePresets) && dataPackage.settings.tablePresets.length > 0)) {
		return { status: 'blocked', code: 'embedded-legacy-presets' };
	}
	if (!Array.isArray(tableManifest.presetIds) || tableManifest.presetIds.length === 0) {
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
	if (typeof tableManifest.tableEmbedVisibleRows !== 'number'
		|| !isTableEmbedVisibleRows(tableManifest.tableEmbedVisibleRows)
		|| typeof tableManifest.tableShowLineNumbers !== 'boolean'
		|| typeof tableManifest.tableShowTaskIcon !== 'boolean'
		|| typeof tableManifest.tableShowTaskTypeIcon !== 'boolean') {
		return { status: 'blocked', code: 'manifest-malformed' };
	}

	const existingBindings = parseBindings(tableManifest.fileBindings);
	if (!existingBindings.ok) return { status: 'blocked', code: 'binding-invalid' };
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
	return { status: 'recoverable', presetIds, bindings };
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
	delete tableManifest.tablePresets;
	delete tableManifest.fileMigrationVersion;
	delete tableManifest.fileMigrationFinalizedVersion;
	cloned.views = {
		...cloned.views,
		tablePresets: {
			...tableManifest,
			version: TABLE_PRESET_MANIFEST_VERSION,
			presetIds: [...preflight.presetIds],
			fileBindings: preflight.bindings.map(binding => ({ ...binding })),
			initialized: true,
		},
	};
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
