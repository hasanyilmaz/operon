import { App } from 'obsidian';
import { OperonSettings } from '../types/settings';
import { clonePriorityDefinition, PriorityDefinition } from '../types/priority';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const PRIORITIES_FILE = '.operon/priorities.json';
const PRIORITY_STORE_VERSION = 1;
const PRIORITY_STORE_QUEUE_KEY = `${PRIORITIES_FILE}::__store__`;

export type PriorityStoreSettings = Pick<OperonSettings, 'priorities' | 'defaultPriority'>;

interface PriorityStoreData {
	version: number;
	priorities: PriorityDefinition[];
	defaultPriority: string;
}

function clonePriorities(priorities: PriorityDefinition[]): PriorityDefinition[] {
	return priorities.map(priority => {
		const clone = clonePriorityDefinition(priority);
		const description = typeof clone.description === 'string'
			? clone.description.trim()
			: '';
		if (description) {
			clone.description = description;
		} else {
			delete clone.description;
		}
		return clone;
	});
}

function cloneSettings(settings: PriorityStoreSettings): PriorityStoreSettings {
	return {
		priorities: clonePriorities(settings.priorities),
		defaultPriority: settings.defaultPriority,
	};
}

function readStoreData(raw: Partial<PriorityStoreData>, fallback: PriorityStoreSettings): PriorityStoreSettings {
	return {
		priorities: Array.isArray(raw.priorities)
			? clonePriorities(raw.priorities)
			: clonePriorities(fallback.priorities),
		defaultPriority: typeof raw.defaultPriority === 'string'
			? raw.defaultPriority
			: fallback.defaultPriority,
	};
}

export class PriorityStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: PriorityStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: PriorityStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: PriorityStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	getAll(): PriorityStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: PriorityStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: PriorityStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async load(
		legacySettings: PriorityStoreSettings | null = null,
		defaults: PriorityStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(PRIORITIES_FILE))) {
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
			raw = await adapter.read(PRIORITIES_FILE);
			const parsed = JSON.parse(raw) as Partial<PriorityStoreData>;
			this.settings = readStoreData(parsed, defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse priorities store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, PRIORITIES_FILE, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: PriorityStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(PRIORITIES_FILE),
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
		const data: PriorityStoreData = {
			version: PRIORITY_STORE_VERSION,
			priorities: clonePriorities(this.settings.priorities),
			defaultPriority: this.settings.defaultPriority,
		};
		await this.writeQueue.enqueue(PRIORITY_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, PRIORITIES_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}
