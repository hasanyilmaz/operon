import {
	cloneTablePreset,
	type TablePreset,
	type TablePresetFileBinding,
	type TablePresetPackageSettings,
	type TablePresetProjectionSettings,
} from '../types/table';

export const TABLE_PRESET_MANIFEST_VERSION = 4;
export type TablePresetBootstrapAction = 'none' | 'adopt-existing' | 'seed-default';

export interface AvailableTablePresetFileAuthority {
	id: string;
	path: string;
}

export interface ReconciledTablePresetFileAuthority {
	presetIds: string[];
	fileBindings: TablePresetFileBinding[];
	tableDefaultPresetId: string | null;
	initialized: boolean;
}

export function resolveTablePresetBootstrapAction(input: {
	initialized: boolean;
	registryEntryCount: number;
	bindingCount: number;
}): TablePresetBootstrapAction {
	if (input.initialized) return 'none';
	if (input.registryEntryCount > 0 || input.bindingCount > 0) return 'adopt-existing';
	return 'seed-default';
}

export function buildTablePresetPackageManifest(
	settings: TablePresetProjectionSettings,
): TablePresetPackageSettings & { version: number } {
	return {
		version: TABLE_PRESET_MANIFEST_VERSION,
		presetIds: normalizeTablePresetOrderIds(settings.tablePresetOrderIds, settings.tablePresets),
		fileBindings: (settings.tablePresetFileBindings ?? []).map(binding => ({ ...binding })),
		initialized: settings.tablePresetFileInitialized,
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tableDefaultFolder: settings.tableDefaultFolder,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: settings.tableEmbedDefaultWidthPercent,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: settings.tableShowTaskDataTypeIcon,
	};
}

export function pickTablePresetProjectionSettings(
	settings: TablePresetProjectionSettings,
): TablePresetProjectionSettings {
	return {
		tablePresets: settings.tablePresets.map(cloneTablePreset),
		tablePresetOrderIds: normalizeTablePresetOrderIds(settings.tablePresetOrderIds, settings.tablePresets),
		tablePresetFileBindings: (settings.tablePresetFileBindings ?? []).map(binding => ({ ...binding })),
		tablePresetFileInitialized: settings.tablePresetFileInitialized,
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tableDefaultFolder: settings.tableDefaultFolder,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: settings.tableEmbedDefaultWidthPercent,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: settings.tableShowTaskDataTypeIcon,
	};
}

export function normalizeTablePresetOrderIds(value: unknown, tablePresets: readonly TablePreset[]): string[] {
	const ids = normalizePresetIds(value);
	const seen = new Set(ids);
	for (const preset of tablePresets) {
		const id = preset.id.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function mergeTablePresetRegistryOrder(
	currentOrder: readonly string[],
	registryIds: readonly string[],
): string[] {
	const nextOrder: string[] = [];
	const seen = new Set<string>();
	for (const id of [...currentOrder, ...registryIds]) {
		const normalized = id.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		nextOrder.push(normalized);
	}
	return nextOrder;
}

/** Keep an adopted file-backed Table usable when old authority had no default. */
export function resolveTablePresetDefaultAfterRegistrySync(
	currentDefaultId: string | null,
	orderedPresetIds: readonly string[],
	availablePresetIds: readonly string[],
): string | null {
	const available = new Set(availablePresetIds);
	if (currentDefaultId && available.has(currentDefaultId)) return currentDefaultId;
	for (const presetId of orderedPresetIds) {
		if (available.has(presetId)) return presetId;
	}
	return availablePresetIds[0] ?? null;
}

/**
 * Build the complete Table preset authority from usable `.table` files only.
 * Existing order survives for still-available ids; newly discovered files are
 * appended by a stable path order. Missing, conflicting, and settings-only ids
 * are intentionally omitted.
 */
export function reconcileTablePresetFileAuthority(input: {
	currentPresetIds: readonly string[];
	currentDefaultPresetId: string | null;
	currentInitialized: boolean;
	availableFiles: readonly AvailableTablePresetFileAuthority[];
}): ReconciledTablePresetFileAuthority {
	const availableById = new Map<string, AvailableTablePresetFileAuthority>();
	const claimedPaths = new Set<string>();
	for (const candidate of [...input.availableFiles].sort(compareAvailableTableFiles)) {
		const id = candidate.id.trim();
		const path = candidate.path.trim();
		const pathKey = path.toLocaleLowerCase('en-US');
		if (!id || !path || availableById.has(id) || claimedPaths.has(pathKey)) continue;
		availableById.set(id, { id, path });
		claimedPaths.add(pathKey);
	}

	const presetIds: string[] = [];
	const seen = new Set<string>();
	for (const rawId of input.currentPresetIds) {
		const id = rawId.trim();
		if (!id || seen.has(id) || !availableById.has(id)) continue;
		seen.add(id);
		presetIds.push(id);
	}
	for (const id of availableById.keys()) {
		if (seen.has(id)) continue;
		seen.add(id);
		presetIds.push(id);
	}

	const tableDefaultPresetId = input.currentDefaultPresetId
		&& availableById.has(input.currentDefaultPresetId)
		? input.currentDefaultPresetId
		: presetIds[0] ?? null;
	return {
		presetIds,
		fileBindings: presetIds.map(id => ({ id, path: availableById.get(id)!.path })),
		tableDefaultPresetId,
		initialized: input.currentInitialized || presetIds.length > 0,
	};
}

function compareAvailableTableFiles(
	left: AvailableTablePresetFileAuthority,
	right: AvailableTablePresetFileAuthority,
): number {
	return left.path.localeCompare(right.path, 'en', { sensitivity: 'base' })
		|| left.path.localeCompare(right.path, 'en')
		|| left.id.localeCompare(right.id, 'en');
}

function normalizePresetIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const entry of value) {
		const id = typeof entry === 'string' ? entry.trim() : '';
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}
