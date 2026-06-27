import { App } from 'obsidian';
import { CalendarPreset, normalizeBuiltInCalendarPreset } from '../types/calendar';
import type { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const CALENDAR_PRESETS_FILE = '.operon/calendar-presets.json';
const CALENDAR_PRESET_STORE_VERSION = 1;
const CALENDAR_PRESET_STORE_QUEUE_KEY = `${CALENDAR_PRESETS_FILE}::__store__`;

export type CalendarPresetStoreSettings = Pick<OperonSettings, 'calendarPresets' | 'calendarDefaultPresetId'>;

interface CalendarPresetStoreData {
	version: number;
	presets: CalendarPreset[];
	defaultPresetId: string | null;
}

function cloneCalendarPresets(presets: CalendarPreset[]): CalendarPreset[] {
	return presets.map(preset => normalizeBuiltInCalendarPreset({ ...preset }));
}

export class CalendarPresetStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: CalendarPresetStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: CalendarPresetStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: CalendarPresetStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	getAll(): CalendarPresetStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: CalendarPresetStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: CalendarPresetStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async load(
		legacySettings: CalendarPresetStoreSettings | null = null,
		defaults: CalendarPresetStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(CALENDAR_PRESETS_FILE))) {
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
			raw = await adapter.read(CALENDAR_PRESETS_FILE);
			const parsed = JSON.parse(raw) as Partial<CalendarPresetStoreData>;
			this.settings = readStoreData(parsed, legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(readSerializedStoreSnapshot(parsed, this.settings));
			this.recoveredFromMalformed = !Array.isArray(parsed.presets) || parsed.presets.length === 0;
		} catch {
			console.warn('Operon: Failed to parse calendar presets store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, CALENDAR_PRESETS_FILE, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: CalendarPresetStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(CALENDAR_PRESETS_FILE),
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
		const data: CalendarPresetStoreData = {
			version: CALENDAR_PRESET_STORE_VERSION,
			presets: cloneCalendarPresets(this.settings.calendarPresets),
			defaultPresetId: this.settings.calendarDefaultPresetId,
		};
		await this.writeQueue.enqueue(CALENDAR_PRESET_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, CALENDAR_PRESETS_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}

function cloneSettings(settings: CalendarPresetStoreSettings): CalendarPresetStoreSettings {
	return {
		calendarPresets: cloneCalendarPresets(settings.calendarPresets),
		calendarDefaultPresetId: settings.calendarDefaultPresetId,
	};
}

function readSerializedStoreSnapshot(
	raw: Partial<CalendarPresetStoreData>,
	resolved: CalendarPresetStoreSettings,
): CalendarPresetStoreSettings {
	return {
		calendarPresets: Array.isArray(raw.presets) && raw.presets.length > 0
			? cloneCalendarPresets(raw.presets)
			: cloneCalendarPresets(resolved.calendarPresets),
		calendarDefaultPresetId: typeof raw.defaultPresetId === 'string' || raw.defaultPresetId === null
			? raw.defaultPresetId
			: null,
	};
}

function readStoreData(
	raw: Partial<CalendarPresetStoreData>,
	fallback: CalendarPresetStoreSettings,
): CalendarPresetStoreSettings {
	const storedPresets = Array.isArray(raw.presets) ? cloneCalendarPresets(raw.presets) : [];
	const calendarPresets = storedPresets.length > 0
		? storedPresets
		: cloneCalendarPresets(fallback.calendarPresets);
	const rawDefaultPresetId = typeof raw.defaultPresetId === 'string' || raw.defaultPresetId === null
		? raw.defaultPresetId
		: fallback.calendarDefaultPresetId;
	const fallbackDefaultPresetId = fallback.calendarDefaultPresetId && calendarPresets.some(preset => preset.id === fallback.calendarDefaultPresetId)
		? fallback.calendarDefaultPresetId
		: calendarPresets[0]?.id ?? null;
	return {
		calendarPresets,
		calendarDefaultPresetId: rawDefaultPresetId && calendarPresets.some(preset => preset.id === rawDefaultPresetId)
			? rawDefaultPresetId
			: fallbackDefaultPresetId,
	};
}
