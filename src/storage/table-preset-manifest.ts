import {
	cloneTablePreset,
	type TablePreset,
	type TablePresetPackageSettings,
	type TablePresetProjectionSettings,
} from '../types/table';

export const TABLE_PRESET_MANIFEST_VERSION = 3;
export type TablePresetBootstrapAction = 'none' | 'adopt-existing' | 'seed-default';

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
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
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
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
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
