import { App } from 'obsidian';
import {
	ContextualMenuActionId,
	ContextualMenuSurface,
	ContextualMenuSurfaceActionMatrix,
} from '../core/contextual-menu-engine';
import { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const CONTEXTUAL_MENU_FILE = '.operon/contextual-menu.json';
const CONTEXTUAL_MENU_STORE_VERSION = 1;
const CONTEXTUAL_MENU_STORE_QUEUE_KEY = `${CONTEXTUAL_MENU_FILE}::__store__`;

export type ContextualMenuStoreSettings = Pick<
	OperonSettings,
	'contextualMenuActionAllowlist' | 'contextualMenuSurfaceActionMatrix' | 'contextualMenuOpenDelayMs'
>;

interface ContextualMenuStoreData {
	version: number;
	actionAllowlist: ContextualMenuActionId[];
	surfaceActionMatrix: ContextualMenuSurfaceActionMatrix;
	openDelayMs: number;
}

function cloneActionAllowlist(actionAllowlist: ContextualMenuActionId[]): ContextualMenuActionId[] {
	return [...actionAllowlist];
}

function cloneSurfaceActionMatrix(surfaceActionMatrix: ContextualMenuSurfaceActionMatrix): ContextualMenuSurfaceActionMatrix {
	const clone: ContextualMenuSurfaceActionMatrix = {};
	for (const [surface, actionIds] of Object.entries(surfaceActionMatrix) as [ContextualMenuSurface, ContextualMenuActionId[]][]) {
		clone[surface] = [...actionIds];
	}
	return clone;
}

function cloneSettings(settings: ContextualMenuStoreSettings): ContextualMenuStoreSettings {
	return {
		contextualMenuActionAllowlist: cloneActionAllowlist(settings.contextualMenuActionAllowlist),
		contextualMenuSurfaceActionMatrix: cloneSurfaceActionMatrix(settings.contextualMenuSurfaceActionMatrix),
		contextualMenuOpenDelayMs: settings.contextualMenuOpenDelayMs,
	};
}

function readStoreData(
	raw: Partial<ContextualMenuStoreData>,
	fallback: ContextualMenuStoreSettings,
): ContextualMenuStoreSettings {
	return {
		contextualMenuActionAllowlist: Array.isArray(raw.actionAllowlist)
			? [...raw.actionAllowlist] as ContextualMenuActionId[]
			: cloneActionAllowlist(fallback.contextualMenuActionAllowlist),
		contextualMenuSurfaceActionMatrix: raw.surfaceActionMatrix
			&& typeof raw.surfaceActionMatrix === 'object'
			&& !Array.isArray(raw.surfaceActionMatrix)
			? cloneSurfaceActionMatrix(raw.surfaceActionMatrix)
			: cloneSurfaceActionMatrix(fallback.contextualMenuSurfaceActionMatrix),
		contextualMenuOpenDelayMs: typeof raw.openDelayMs === 'number'
			&& Number.isFinite(raw.openDelayMs)
			? raw.openDelayMs
			: fallback.contextualMenuOpenDelayMs,
	};
}

export class ContextualMenuStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: ContextualMenuStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: ContextualMenuStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: ContextualMenuStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	getAll(): ContextualMenuStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: ContextualMenuStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: ContextualMenuStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async load(
		legacySettings: ContextualMenuStoreSettings | null = null,
		defaults: ContextualMenuStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(CONTEXTUAL_MENU_FILE))) {
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
			raw = await adapter.read(CONTEXTUAL_MENU_FILE);
			const parsed = JSON.parse(raw) as Partial<ContextualMenuStoreData>;
			this.settings = readStoreData(parsed, defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse contextual menu store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, CONTEXTUAL_MENU_FILE, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: ContextualMenuStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(CONTEXTUAL_MENU_FILE),
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
		const data: ContextualMenuStoreData = {
			version: CONTEXTUAL_MENU_STORE_VERSION,
			actionAllowlist: cloneActionAllowlist(this.settings.contextualMenuActionAllowlist),
			surfaceActionMatrix: cloneSurfaceActionMatrix(this.settings.contextualMenuSurfaceActionMatrix),
			openDelayMs: this.settings.contextualMenuOpenDelayMs,
		};
		await this.writeQueue.enqueue(CONTEXTUAL_MENU_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, CONTEXTUAL_MENU_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}
