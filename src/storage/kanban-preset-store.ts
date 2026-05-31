import { App } from 'obsidian';
import { KanbanPreset, normalizeBuiltInKanbanPreset } from '../types/kanban';
import type { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const KANBAN_PRESETS_FILE = '.operon/kanban-presets.json';
const KANBAN_PRESET_STORE_VERSION = 1;
const KANBAN_PRESET_STORE_QUEUE_KEY = `${KANBAN_PRESETS_FILE}::__store__`;

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
	private packagePersist: ((settings: KanbanPresetStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: KanbanPresetStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
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
		if (!(await adapter.exists(KANBAN_PRESETS_FILE))) {
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
			raw = await adapter.read(KANBAN_PRESETS_FILE);
			const parsed = JSON.parse(raw) as Partial<KanbanPresetStoreData>;
			this.settings = readStoreData(parsed, legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse kanban presets store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, KANBAN_PRESETS_FILE, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: KanbanPresetStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(KANBAN_PRESETS_FILE),
			this.recoveredFromMalformed,
			options,
		)) {
			this.settings = nextSettings;
			return;
		}
		this.settings = nextSettings;
		this.serializedSettings = nextSerialized;
		if (this.packagePersist) {
			await this.packagePersist(this.getAll());
			this.recoveredFromMalformed = false;
			return;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const data: KanbanPresetStoreData = {
			version: KANBAN_PRESET_STORE_VERSION,
			presets: cloneKanbanPresets(this.settings.kanbanPresets),
			defaultPresetId: this.settings.kanbanDefaultPresetId,
		};
		await this.writeQueue.enqueue(KANBAN_PRESET_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, KANBAN_PRESETS_FILE, data);
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
