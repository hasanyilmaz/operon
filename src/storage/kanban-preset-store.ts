import { assertKanbanAxesWritable } from '../core/kanban-axis-model';
import { App } from 'obsidian';
import { KanbanPreset, normalizeBuiltInKanbanPreset } from '../types/kanban';
import type { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const KANBAN_PRESETS_FILE_NAME = 'kanban-presets.json';
const KANBAN_PRESET_STORE_VERSION = 1;

export type KanbanPresetStoreSettings = Pick<OperonSettings, 'kanbanPresets' | 'kanbanDefaultPresetId'>;

interface KanbanPresetStoreData {
	version: number;
	presets: KanbanPreset[];
	defaultPresetId: string | null;
}

function cloneKanbanPresets(presets: KanbanPreset[]): KanbanPreset[] {
	return presets.map(preset => normalizeBuiltInKanbanPreset({ ...preset }));
}

export class KanbanPresetStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: KanbanPresetStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private pendingReplace: Promise<void> = Promise.resolve();
	private packagePersist: ((settings: KanbanPresetStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: KanbanPresetStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', KANBAN_PRESETS_FILE_NAME);
	}

	getAll(): KanbanPresetStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: KanbanPresetStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: KanbanPresetStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async load(
		legacySettings: KanbanPresetStoreSettings | null = null,
		defaults: KanbanPresetStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		if (!(await adapter.exists(filePath))) {
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
			if (legacySettings) {
				await this.persist();
			}
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(filePath);
			const parsed = JSON.parse(raw) as Partial<KanbanPresetStoreData>;
			this.settings = readStoreData(parsed, legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse kanban presets store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, filePath, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: KanbanPresetStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const next = cloneSettings(settings);
		const operation = this.pendingReplace.then(() => this.replaceNow(next, options));
		this.pendingReplace = operation.catch(() => undefined);
		await operation;
	}

	private async replaceNow(next: KanbanPresetStoreSettings, options: RecoveredStoreWriteOptions): Promise<void> {
		assertKanbanAxesWritable(this.settings.kanbanPresets);
		assertKanbanAxesWritable(next.kanbanPresets);
		const serialized = JSON.stringify(next);
		if (shouldSkipStoreWrite(serialized === this.serializedSettings,
			await this.app.vault.adapter.exists(this.getFilePath()), this.recoveredFromMalformed, options)) return;
		if (this.packagePersist) await this.packagePersist(cloneSettings(next));
		else await this.persist(next);
		this.settings = next;
		this.serializedSettings = serialized;
		this.recoveredFromMalformed = false;
	}

	private async persist(settings = this.settings): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		const data: KanbanPresetStoreData = {
			version: KANBAN_PRESET_STORE_VERSION,
			presets: cloneKanbanPresets(settings.kanbanPresets),
			defaultPresetId: settings.kanbanDefaultPresetId,
		};
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
		});
		this.recoveredFromMalformed = false;
	}
}

function cloneSettings(settings: KanbanPresetStoreSettings): KanbanPresetStoreSettings {
	return {
		kanbanPresets: cloneKanbanPresets(settings.kanbanPresets),
		kanbanDefaultPresetId: settings.kanbanDefaultPresetId,
	};
}

function readStoreData(
	raw: Partial<KanbanPresetStoreData>,
	fallback: KanbanPresetStoreSettings,
): KanbanPresetStoreSettings {
	return {
		kanbanPresets: Array.isArray(raw.presets)
			? cloneKanbanPresets(raw.presets)
			: cloneKanbanPresets(fallback.kanbanPresets),
		kanbanDefaultPresetId: typeof raw.defaultPresetId === 'string' || raw.defaultPresetId === null
			? raw.defaultPresetId
			: fallback.kanbanDefaultPresetId,
	};
}
