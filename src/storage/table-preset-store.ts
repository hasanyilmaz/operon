import type { App, DataAdapter } from 'obsidian';
import {
	cloneTablePreset,
	DEFAULT_TABLE_PRESET_ID,
	normalizeTableEmbedVisibleRows,
	normalizeTablePreset,
	normalizeTablePresets,
	type TableEmbedVisibleRows,
	type TablePreset,
	type TablePresetPackageSettings,
	type TablePresetStoreSettings,
} from '../types/table';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { buildOperonPluginStoragePath, joinVaultPath } from './operon-storage-paths';

const TABLE_PRESET_STORE_VERSION = 1;
const TABLE_PRESET_MANIFEST_VERSION = 2;

type TablePresetAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'mkdir' | 'remove' | 'list'>
	& Partial<Pick<DataAdapter, 'process' | 'rename'>>;

export interface TablePresetIndexData {
	version: number;
	presetIds: string[];
	tableDefaultPresetId: string | null;
	tableEmbedVisibleRows: TableEmbedVisibleRows;
	tableShowLineNumbers: boolean;
	tableShowTaskIcon: boolean;
	tableShowTaskTypeIcon: boolean;
}

export interface TablePresetStoreRuntimeSnapshot {
	settings: TablePresetStoreSettings;
	serializedIndex: string;
	serializedPresetsById: Map<string, string>;
	pendingMissingIndexedPresetIds: Set<string>;
	pendingIndexData: TablePresetIndexData | null;
}

type TablePresetFileData = TablePreset & {
	version: number;
};

type TablePresetFileReadResult =
	| { status: 'loaded'; preset: TablePreset }
	| { status: 'missing' }
	| { status: 'invalid' };

interface TablePresetIndexReadResult {
	presets: TablePreset[];
	missingIds: string[];
	invalidIds: string[];
}

interface TablePresetStoreLoadOptions {
	availableFilterSetIds: readonly string[];
	canSeedFromFallback?: boolean;
}

export interface TablePresetStoreLoadResult {
	settings: TablePresetStoreSettings;
	changed: boolean;
}

export function buildTablePresetPackageManifest(settings: TablePresetStoreSettings): TablePresetPackageSettings & { version: number } {
	return {
		version: TABLE_PRESET_MANIFEST_VERSION,
		presetIds: settings.tablePresets.map(preset => preset.id),
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
	};
}

export function pickTablePresetStoreSettings(settings: TablePresetStoreSettings): TablePresetStoreSettings {
	return {
		tablePresets: settings.tablePresets.map(cloneTablePreset),
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
	};
}

export class TablePresetStore {
	private readonly app: App;
	private readonly writeQueue: WriteQueue;
	private readonly folderPath: string;
	private settings: TablePresetStoreSettings;
	private serializedIndex = '';
	private serializedPresetsById = new Map<string, string>();
	private pendingMissingIndexedPresetIds = new Set<string>();
	private pendingIndexData: TablePresetIndexData | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: TablePresetStoreSettings, folderPath?: string) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.folderPath = folderPath ?? buildOperonPluginStoragePath(this.app.vault.configDir, 'data', 'table-presets');
		this.settings = pickTablePresetStoreSettings(defaults);
		this.setSerializedSnapshot(this.settings);
	}

	getAll(): TablePresetStoreSettings {
		return pickTablePresetStoreSettings(this.settings);
	}

	captureRuntimeSnapshot(): TablePresetStoreRuntimeSnapshot {
		return {
			settings: this.getAll(),
			serializedIndex: this.serializedIndex,
			serializedPresetsById: new Map(this.serializedPresetsById),
			pendingMissingIndexedPresetIds: new Set(this.pendingMissingIndexedPresetIds),
			pendingIndexData: this.pendingIndexData ? cloneIndexData(this.pendingIndexData) : null,
		};
	}

	restoreRuntimeSnapshot(snapshot: TablePresetStoreRuntimeSnapshot): void {
		this.settings = pickTablePresetStoreSettings(snapshot.settings);
		this.serializedIndex = snapshot.serializedIndex;
		this.serializedPresetsById = new Map(snapshot.serializedPresetsById);
		this.pendingMissingIndexedPresetIds = new Set(snapshot.pendingMissingIndexedPresetIds);
		this.pendingIndexData = snapshot.pendingIndexData ? cloneIndexData(snapshot.pendingIndexData) : null;
	}

	loadFromSettings(
		settings: TablePresetStoreSettings,
		options: { indexData?: TablePresetIndexData; missingIndexedPresetIds?: readonly string[] } = {},
	): void {
		this.settings = pickTablePresetStoreSettings(settings);
		this.setSerializedSnapshot(this.settings, options.indexData);
		this.pendingMissingIndexedPresetIds = new Set(options.missingIndexedPresetIds ?? []);
		this.pendingIndexData = this.pendingMissingIndexedPresetIds.size > 0 && options.indexData
			? options.indexData
			: null;
	}

	toPackage(): TablePresetPackageSettings & { version: number } {
		return buildTablePresetPackageManifest(this.settings);
	}

	async load(
		legacySettings: TablePresetStoreSettings,
		options: TablePresetStoreLoadOptions,
	): Promise<TablePresetStoreLoadResult> {
		const previousSignature = buildStoreSettingsSignature(this.settings);
		await this.ensureFolder();
		const fallback = normalizeStoreSettings(legacySettings, legacySettings, options.availableFilterSetIds);
		const index = await this.readIndex();
		if (index) {
			const indexedRead = await this.readPresetFilesByIds(index.presetIds, options.availableFilterSetIds);
			const settings = normalizeStoreSettings({
				tablePresets: indexedRead.presets,
				tableDefaultPresetId: index.tableDefaultPresetId,
				tableEmbedVisibleRows: index.tableEmbedVisibleRows,
				tableShowLineNumbers: index.tableShowLineNumbers,
				tableShowTaskIcon: index.tableShowTaskIcon,
				tableShowTaskTypeIcon: index.tableShowTaskTypeIcon,
			}, fallback, options.availableFilterSetIds);
			const normalizedIndexSerialized = JSON.stringify(buildIndexData(settings));
			const diskIndexSerialized = JSON.stringify(index);
			if (indexedRead.missingIds.length > 0) {
				this.loadFromSettings(settings, {
					indexData: index,
					missingIndexedPresetIds: indexedRead.missingIds,
				});
			} else if (
				(indexedRead.invalidIds.length > 0 || normalizedIndexSerialized !== diskIndexSerialized)
				&& options.canSeedFromFallback !== false
			) {
				await this.replaceAll(settings);
			} else {
				this.loadFromSettings(settings);
			}
			return this.buildLoadResult(previousSignature);
		}

		const recoveredPresets = await this.readAllPresetFiles(options.availableFilterSetIds);
		if (recoveredPresets.length > 0) {
			const settings = normalizeStoreSettings({
				...fallback,
				tablePresets: recoveredPresets,
			}, fallback, options.availableFilterSetIds);
			if (options.canSeedFromFallback !== false) {
				await this.replaceAll(settings);
			} else {
				this.loadFromSettings(settings);
			}
			return this.buildLoadResult(previousSignature);
		}

		if (options.canSeedFromFallback !== false) {
			await this.replaceAll(fallback);
		} else {
			this.loadFromSettings(fallback);
		}
		return this.buildLoadResult(previousSignature);
	}

	async replaceAll(settings: TablePresetStoreSettings): Promise<void> {
		const nextSettings = normalizeResolvedStoreSettings(settings, this.settings);
		const { index: nextIndex, preservedMissingIds } = this.buildIndexDataForWrite(nextSettings);
		const nextIndexSerialized = JSON.stringify(nextIndex);
		const nextPresetSerializations = new Map<string, string>();
		for (const preset of nextSettings.tablePresets) {
			nextPresetSerializations.set(preset.id, JSON.stringify(buildPresetFileData(preset)));
		}

		const adapter = this.app.vault.adapter as TablePresetAdapter;
		const deletedIds = [...this.serializedPresetsById.keys()].filter(presetId => !nextPresetSerializations.has(presetId));
		const changedPresets: TablePreset[] = [];
		for (const preset of nextSettings.tablePresets) {
			const filePath = this.getPresetFilePath(preset.id);
			if (
				this.serializedPresetsById.get(preset.id) !== nextPresetSerializations.get(preset.id)
				|| !(await adapter.exists(filePath))
			) {
				changedPresets.push(preset);
			}
		}
		const indexChanged = this.serializedIndex !== nextIndexSerialized || !(await adapter.exists(this.getIndexPath()));
		if (!indexChanged && changedPresets.length === 0 && deletedIds.length === 0) {
			this.settings = pickTablePresetStoreSettings(nextSettings);
			this.serializedIndex = nextIndexSerialized;
			this.serializedPresetsById = nextPresetSerializations;
			this.pendingMissingIndexedPresetIds = new Set(preservedMissingIds);
			this.pendingIndexData = preservedMissingIds.length > 0 ? nextIndex : null;
			return;
		}

		const folder = this.getFolderPath();
		await this.writeQueue.enqueue(`${folder}/__store__`, async () => {
			await this.ensureFolder();
			for (const preset of changedPresets) {
				await writeJsonSafely(adapter, this.getPresetFilePath(preset.id), buildPresetFileData(preset));
			}
			for (const presetId of deletedIds) {
				const path = this.getPresetFilePath(presetId);
				if (await adapter.exists(path)) {
					await adapter.remove(path);
				}
			}
			if (indexChanged) {
				await writeJsonSafely(adapter, this.getIndexPath(), nextIndex);
			}
		});
		this.settings = pickTablePresetStoreSettings(nextSettings);
		this.serializedIndex = nextIndexSerialized;
		this.serializedPresetsById = nextPresetSerializations;
		this.pendingMissingIndexedPresetIds = new Set(preservedMissingIds);
		this.pendingIndexData = preservedMissingIds.length > 0 ? nextIndex : null;
	}

	private getFolderPath(): string {
		return this.folderPath;
	}

	private getIndexPath(): string {
		return joinVaultPath(this.getFolderPath(), 'index.json');
	}

	private getPresetFilePath(presetId: string): string {
		return joinVaultPath(this.getFolderPath(), `${encodeURIComponent(presetId)}.json`);
	}

	private async ensureFolder(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const folder = this.getFolderPath();
		const segments = folder.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	private async readIndex(): Promise<TablePresetIndexData | null> {
		const adapter = this.app.vault.adapter as TablePresetAdapter;
		const indexPath = this.getIndexPath();
		if (!(await adapter.exists(indexPath))) return null;
		let raw = '';
		try {
			raw = await adapter.read(indexPath);
			const index = normalizeIndex(JSON.parse(raw));
			if (!index) throw new Error('Invalid table preset index');
			return index;
		} catch {
			console.warn('Operon: Failed to parse table preset index, preserving invalid file and recovering from preset files');
			await preserveInvalidJsonFile(adapter, indexPath, raw);
			return null;
		}
	}

	private async readPresetFilesByIds(
		presetIds: readonly string[],
		availableFilterSetIds: readonly string[],
	): Promise<TablePresetIndexReadResult> {
		const presets: TablePreset[] = [];
		const missingIds: string[] = [];
		const invalidIds: string[] = [];
		const seen = new Set<string>();
		for (const presetId of presetIds) {
			if (seen.has(presetId)) continue;
			seen.add(presetId);
			const result = await this.readPresetFile(this.getPresetFilePath(presetId), availableFilterSetIds, presetId);
			if (result.status === 'loaded') {
				presets.push(result.preset);
			} else if (result.status === 'missing') {
				missingIds.push(presetId);
			} else {
				invalidIds.push(presetId);
			}
		}
		return { presets, missingIds, invalidIds };
	}

	private async readAllPresetFiles(availableFilterSetIds: readonly string[]): Promise<TablePreset[]> {
		const adapter = this.app.vault.adapter as TablePresetAdapter;
		const list = await adapter.list(this.getFolderPath());
		const seen = new Set<string>();
		const presets: TablePreset[] = [];
		for (const path of list.files.filter(path => isPresetFilePath(path)).sort((left, right) => left.localeCompare(right))) {
			const result = await this.readPresetFile(path, availableFilterSetIds);
			if (result.status !== 'loaded' || seen.has(result.preset.id)) continue;
			const preset = result.preset;
			seen.add(preset.id);
			presets.push(preset);
		}
		return presets;
	}

	private async readPresetFile(
		path: string,
		availableFilterSetIds: readonly string[],
		expectedPresetId?: string,
	): Promise<TablePresetFileReadResult> {
		const adapter = this.app.vault.adapter as TablePresetAdapter;
		if (!(await adapter.exists(path))) return { status: 'missing' };
		let raw = '';
		try {
			raw = await adapter.read(path);
			const parsed: unknown = JSON.parse(raw);
			const preset = normalizeTablePreset(parsed, { availableFilterSetIds });
			if (!preset) {
				console.warn(`Operon: Invalid table preset file skipped (${path})`);
				return { status: 'invalid' };
			}
			if (expectedPresetId && preset.id !== expectedPresetId) {
				console.warn(`Operon: Table preset file id mismatch skipped (${path})`);
				await preserveInvalidJsonFile(adapter, path, raw);
				return { status: 'invalid' };
			}
			return { status: 'loaded', preset };
		} catch {
			console.warn(`Operon: Failed to parse table preset file, preserving invalid file (${path})`);
			await preserveInvalidJsonFile(adapter, path, raw);
			return { status: 'invalid' };
		}
	}

	private setSerializedSnapshot(settings: TablePresetStoreSettings, indexData?: TablePresetIndexData): void {
		this.serializedIndex = JSON.stringify(indexData ?? buildIndexData(settings));
		this.serializedPresetsById = new Map(settings.tablePresets.map(preset => [
			preset.id,
			JSON.stringify(buildPresetFileData(preset)),
		]));
	}

	private buildIndexDataForWrite(settings: TablePresetStoreSettings): {
		index: TablePresetIndexData;
		preservedMissingIds: string[];
	} {
		const baseIndex = buildIndexData(settings);
		if (!this.pendingIndexData || this.pendingMissingIndexedPresetIds.size === 0) {
			return { index: baseIndex, preservedMissingIds: [] };
		}

		const settingsIds = new Set(baseIndex.presetIds);
		const preservedMissingIds = [...this.pendingMissingIndexedPresetIds].filter(presetId => !settingsIds.has(presetId));
		if (preservedMissingIds.length === 0) {
			return { index: baseIndex, preservedMissingIds: [] };
		}

		const preservedMissingIdSet = new Set(preservedMissingIds);
		const mergedPresetIds: string[] = [];
		const appendUnique = (presetId: string): void => {
			if (mergedPresetIds.includes(presetId)) return;
			mergedPresetIds.push(presetId);
		};
		for (const presetId of this.pendingIndexData.presetIds) {
			if (settingsIds.has(presetId) || preservedMissingIdSet.has(presetId)) {
				appendUnique(presetId);
			}
		}
		for (const presetId of baseIndex.presetIds) {
			appendUnique(presetId);
		}

		const shouldPreserveMissingDefault = this.pendingIndexData.tableDefaultPresetId
			&& preservedMissingIdSet.has(this.pendingIndexData.tableDefaultPresetId)
			&& settings.tableDefaultPresetId === this.settings.tableDefaultPresetId;
		return {
			index: {
				...baseIndex,
				presetIds: mergedPresetIds,
				tableDefaultPresetId: shouldPreserveMissingDefault
					? this.pendingIndexData.tableDefaultPresetId
					: baseIndex.tableDefaultPresetId,
			},
			preservedMissingIds,
		};
	}

	private buildLoadResult(previousSignature: string): TablePresetStoreLoadResult {
		const settings = this.getAll();
		return {
			settings,
			changed: buildStoreSettingsSignature(settings) !== previousSignature,
		};
	}
}

function normalizeIndex(value: unknown): TablePresetIndexData | null {
	if (!isRecord(value) || value.version !== TABLE_PRESET_STORE_VERSION) return null;
	const presetIds = normalizePresetIds(value.presetIds);
	return {
		version: TABLE_PRESET_STORE_VERSION,
		presetIds,
		tableDefaultPresetId: readNullableString(value.tableDefaultPresetId, null),
		tableEmbedVisibleRows: normalizeTableEmbedVisibleRows(value.tableEmbedVisibleRows),
		tableShowLineNumbers: readBoolean(value.tableShowLineNumbers, true),
		tableShowTaskIcon: readBoolean(value.tableShowTaskIcon, false),
		tableShowTaskTypeIcon: readBoolean(value.tableShowTaskTypeIcon, false),
	};
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

function normalizeStoreSettings(
	settings: TablePresetStoreSettings,
	fallback: TablePresetStoreSettings,
	availableFilterSetIds: readonly string[],
): TablePresetStoreSettings {
	const tablePresets = normalizeTablePresets(settings.tablePresets, { availableFilterSetIds });
	const fallbackDefaultPresetId = fallback.tableDefaultPresetId && tablePresets.some(preset => preset.id === fallback.tableDefaultPresetId)
		? fallback.tableDefaultPresetId
		: null;
	const requestedDefaultPresetId = settings.tableDefaultPresetId && tablePresets.some(preset => preset.id === settings.tableDefaultPresetId)
		? settings.tableDefaultPresetId
		: null;
	return {
		tablePresets,
		tableDefaultPresetId: requestedDefaultPresetId
			?? fallbackDefaultPresetId
			?? tablePresets.find(preset => preset.id === DEFAULT_TABLE_PRESET_ID)?.id
			?? tablePresets[0]?.id
			?? null,
		tableEmbedVisibleRows: normalizeTableEmbedVisibleRows(settings.tableEmbedVisibleRows, fallback.tableEmbedVisibleRows),
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
	};
}

function normalizeResolvedStoreSettings(
	settings: TablePresetStoreSettings,
	fallback: TablePresetStoreSettings,
): TablePresetStoreSettings {
	const seen = new Set<string>();
	const tablePresets = settings.tablePresets
		.map(cloneTablePreset)
		.filter(preset => {
			if (!preset.id.trim() || seen.has(preset.id)) return false;
			seen.add(preset.id);
			return true;
		});
	const resolvedPresets = tablePresets.length > 0 ? tablePresets : fallback.tablePresets.map(cloneTablePreset);
	const defaultPresetId = settings.tableDefaultPresetId && resolvedPresets.some(preset => preset.id === settings.tableDefaultPresetId)
		? settings.tableDefaultPresetId
		: fallback.tableDefaultPresetId && resolvedPresets.some(preset => preset.id === fallback.tableDefaultPresetId)
			? fallback.tableDefaultPresetId
			: resolvedPresets.find(preset => preset.id === DEFAULT_TABLE_PRESET_ID)?.id
				?? resolvedPresets[0]?.id
				?? null;
	return {
		tablePresets: resolvedPresets,
		tableDefaultPresetId: defaultPresetId,
		tableEmbedVisibleRows: normalizeTableEmbedVisibleRows(settings.tableEmbedVisibleRows, fallback.tableEmbedVisibleRows),
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
	};
}

function buildIndexData(settings: TablePresetStoreSettings): TablePresetIndexData {
	return {
		version: TABLE_PRESET_STORE_VERSION,
		presetIds: settings.tablePresets.map(preset => preset.id),
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
	};
}

function cloneIndexData(index: TablePresetIndexData): TablePresetIndexData {
	return {
		...index,
		presetIds: [...index.presetIds],
	};
}

function buildStoreSettingsSignature(settings: TablePresetStoreSettings): string {
	return JSON.stringify({
		index: buildIndexData(settings),
		presets: settings.tablePresets.map(buildPresetFileData),
	});
}

function buildPresetFileData(preset: TablePreset): TablePresetFileData {
	return {
		version: TABLE_PRESET_STORE_VERSION,
		...cloneTablePreset(preset),
	};
}

function isPresetFilePath(path: string): boolean {
	const name = path.split('/').pop() ?? '';
	return name.endsWith('.json') && name !== 'index.json' && !name.includes('.invalid-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNullableString(value: unknown, fallback: string | null): string | null {
	return typeof value === 'string' || value === null ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}
