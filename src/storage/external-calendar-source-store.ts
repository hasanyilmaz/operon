import { App } from 'obsidian';
import { ExternalCalendarSource } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const EXTERNAL_CALENDAR_SOURCES_FILE = '.operon/external-calendar-sources.json';
const EXTERNAL_CALENDAR_SOURCE_STORE_VERSION = 1;
const EXTERNAL_CALENDAR_SOURCE_STORE_QUEUE_KEY = `${EXTERNAL_CALENDAR_SOURCES_FILE}::__store__`;

interface ExternalCalendarSourceStoreData {
	version: number;
	sources: ExternalCalendarSource[];
}

function cloneExternalCalendarSource(source: ExternalCalendarSource): ExternalCalendarSource {
	return { ...source, enabled: source.enabled !== false };
}

function cloneExternalCalendarSources(sources: ExternalCalendarSource[]): ExternalCalendarSource[] {
	return sources.map(cloneExternalCalendarSource);
}

export class ExternalCalendarSourceStore {
	private app: App;
	private writeQueue: WriteQueue;
	private sources: ExternalCalendarSource[] = [];
	private serializedSources = '[]';
	private recoveredFromMalformed = false;
	private packagePersist: ((sources: ExternalCalendarSource[]) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue) {
		this.app = app;
		this.writeQueue = writeQueue;
	}

	getAll(): ExternalCalendarSource[] {
		return cloneExternalCalendarSources(this.sources);
	}

	setPackagePersistence(persist: (sources: ExternalCalendarSource[]) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(sources: ExternalCalendarSource[]): void {
		this.sources = cloneExternalCalendarSources(sources);
		this.serializedSources = JSON.stringify(this.sources);
		this.recoveredFromMalformed = false;
	}

	async load(legacySources: ExternalCalendarSource[] | null = null): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(EXTERNAL_CALENDAR_SOURCES_FILE))) {
			this.sources = legacySources ? cloneExternalCalendarSources(legacySources) : [];
			this.serializedSources = JSON.stringify(this.sources);
			this.recoveredFromMalformed = false;
			if (legacySources) {
				await this.persist();
			}
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(EXTERNAL_CALENDAR_SOURCES_FILE);
			const parsed = JSON.parse(raw) as Partial<ExternalCalendarSourceStoreData>;
			this.sources = Array.isArray(parsed.sources) ? cloneExternalCalendarSources(parsed.sources) : [];
			this.serializedSources = JSON.stringify(this.sources);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse external calendar sources store, preserving invalid file as backup and recovering from fallback sources');
			await preserveInvalidJsonFile(adapter, EXTERNAL_CALENDAR_SOURCES_FILE, raw);
			this.sources = legacySources ? cloneExternalCalendarSources(legacySources) : [];
			this.serializedSources = JSON.stringify(this.sources);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(sources: ExternalCalendarSource[], options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSources = cloneExternalCalendarSources(sources);
		const nextSerialized = JSON.stringify(nextSources);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSources,
			await adapter.exists(EXTERNAL_CALENDAR_SOURCES_FILE),
			this.recoveredFromMalformed,
			options,
		)) {
			this.sources = nextSources;
			return;
		}
		this.sources = nextSources;
		this.serializedSources = nextSerialized;
		if (this.packagePersist) {
			await this.packagePersist(this.getAll());
			this.recoveredFromMalformed = false;
			return;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const data: ExternalCalendarSourceStoreData = {
			version: EXTERNAL_CALENDAR_SOURCE_STORE_VERSION,
			sources: cloneExternalCalendarSources(this.sources),
		};
		await this.writeQueue.enqueue(EXTERNAL_CALENDAR_SOURCE_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, EXTERNAL_CALENDAR_SOURCES_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}
