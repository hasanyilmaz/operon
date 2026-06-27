import { App } from 'obsidian';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const EXTERNAL_CALENDAR_CACHE_FILE_NAME = 'external-calendars.json';
const EXTERNAL_CALENDAR_CACHE_VERSION = 1;

export interface ExternalCalendarCachedEvent {
	id: string;
	sourceId: string;
	uid: string;
	recurrenceId: string | null;
	title: string;
	isAllDay: boolean;
	startDate: string;
	endDate: string;
	startDateTime: string | null;
	endDateTime: string | null;
}

export interface ExternalCalendarSourceCache {
	sourceId: string;
	syncedAt: string | null;
	lastAttemptAt: string | null;
	etag: string | null;
	lastModified: string | null;
	coveredRangeStart: string | null;
	coveredRangeEnd: string | null;
	lastError: string | null;
	events: ExternalCalendarCachedEvent[];
}

export interface ExternalCalendarCacheDocument {
	version: number;
	sources: ExternalCalendarSourceCache[];
}

function emptyDocument(): ExternalCalendarCacheDocument {
	return {
		version: EXTERNAL_CALENDAR_CACHE_VERSION,
		sources: [],
	};
}

function cloneSourceCache(source: ExternalCalendarSourceCache): ExternalCalendarSourceCache {
	return {
		...source,
		events: source.events.map(event => ({ ...event })),
	};
}

function cloneDocument(document: ExternalCalendarCacheDocument): ExternalCalendarCacheDocument {
	return {
		version: EXTERNAL_CALENDAR_CACHE_VERSION,
		sources: document.sources.map(cloneSourceCache),
	};
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeCachedEvent(raw: unknown): ExternalCalendarCachedEvent | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = normalizeOptionalString(src.id);
	const sourceId = normalizeOptionalString(src.sourceId);
	const uid = normalizeOptionalString(src.uid);
	const title = typeof src.title === 'string' ? src.title : '';
	const startDate = normalizeOptionalString(src.startDate);
	const endDate = normalizeOptionalString(src.endDate);
	if (!id || !sourceId || !uid || !startDate || !endDate) return null;
	return {
		id,
		sourceId,
		uid,
		recurrenceId: normalizeOptionalString(src.recurrenceId),
		title,
		isAllDay: src.isAllDay === true,
		startDate,
		endDate,
		startDateTime: normalizeOptionalString(src.startDateTime),
		endDateTime: normalizeOptionalString(src.endDateTime),
	};
}

function normalizeSourceCache(raw: unknown): ExternalCalendarSourceCache | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const sourceId = normalizeOptionalString(src.sourceId);
	if (!sourceId) return null;
	return {
		sourceId,
		syncedAt: normalizeOptionalString(src.syncedAt),
		lastAttemptAt: normalizeOptionalString(src.lastAttemptAt),
		etag: normalizeOptionalString(src.etag),
		lastModified: normalizeOptionalString(src.lastModified),
		coveredRangeStart: normalizeOptionalString(src.coveredRangeStart),
		coveredRangeEnd: normalizeOptionalString(src.coveredRangeEnd),
		lastError: normalizeOptionalString(src.lastError),
		events: Array.isArray(src.events)
			? src.events
				.map(event => normalizeCachedEvent(event))
				.filter((event): event is ExternalCalendarCachedEvent => !!event)
			: [],
	};
}

export class ExternalCalendarCacheStore {
	private readonly app: App;
	private readonly writeQueue: WriteQueue;
	private cacheDocument: ExternalCalendarCacheDocument = emptyDocument();
	private mutationQueue: Promise<void> = Promise.resolve();
	private readonly filePath: string;

	constructor(app: App, writeQueue: WriteQueue, filePath?: string) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath ?? buildOperonPluginStoragePath(app.vault.configDir, 'cache', EXTERNAL_CALENDAR_CACHE_FILE_NAME);
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const loadPath = await this.resolveLoadPath();
		if (!loadPath) {
			this.cacheDocument = emptyDocument();
			return;
		}
		let raw = '';
		try {
			raw = await adapter.read(loadPath);
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			this.cacheDocument = {
				version: EXTERNAL_CALENDAR_CACHE_VERSION,
				sources: Array.isArray(parsed.sources)
					? parsed.sources
						.map(entry => normalizeSourceCache(entry))
						.filter((entry): entry is ExternalCalendarSourceCache => !!entry)
					: [],
			};
			if (loadPath !== this.filePath) {
				await this.flush(this.cacheDocument);
			}
		} catch {
			console.warn('Operon: Failed to parse external-calendars.json, preserving invalid file as backup and starting empty');
			if (loadPath === this.filePath) {
				await preserveInvalidJsonFile(adapter, this.filePath, raw);
			}
			this.cacheDocument = emptyDocument();
		}
	}

	getAllSources(): ExternalCalendarSourceCache[] {
		return this.cacheDocument.sources.map(cloneSourceCache);
	}

	getSource(sourceId: string): ExternalCalendarSourceCache | null {
		const found = this.cacheDocument.sources.find(source => source.sourceId === sourceId);
		if (!found) return null;
		return cloneSourceCache(found);
	}

	async upsertSource(source: ExternalCalendarSourceCache): Promise<void> {
		await this.mutateDocument(current => {
			const nextSources = current.sources.filter(entry => entry.sourceId !== source.sourceId);
			nextSources.push(cloneSourceCache(source));
			return {
				version: EXTERNAL_CALENDAR_CACHE_VERSION,
				sources: nextSources,
			};
		});
	}

	async removeSourcesExcept(sourceIds: Iterable<string>): Promise<void> {
		const keep = new Set(Array.from(sourceIds).filter(Boolean));
		await this.mutateDocument(current => {
			const nextSources = current.sources.filter(source => keep.has(source.sourceId));
			if (nextSources.length === current.sources.length) return current;
			return {
				version: EXTERNAL_CALENDAR_CACHE_VERSION,
				sources: nextSources,
			};
		});
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private async mutateDocument(
		transform: (current: ExternalCalendarCacheDocument) => ExternalCalendarCacheDocument,
	): Promise<void> {
		const run = this.mutationQueue.then(async () => {
			const next = cloneDocument(transform(cloneDocument(this.cacheDocument)));
			if (sameDocument(next, this.cacheDocument)) return;
			this.cacheDocument = next;
			await this.flush(next);
		});
		this.mutationQueue = run.catch(() => {});
		await run;
	}

	private async flush(document: ExternalCalendarCacheDocument): Promise<void> {
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, document);
		});
	}

	private async resolveLoadPath(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.filePath)) return this.filePath;
		return null;
	}
}

function sameDocument(left: ExternalCalendarCacheDocument, right: ExternalCalendarCacheDocument): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
