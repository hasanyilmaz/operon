import type { App } from 'obsidian';
import { ActiveTrackerRecord, ActiveTrackersData, TrackerSource } from '../types/tracker';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const ACTIVE_TRACKERS_FILE_NAME = 'active-trackers.json';
const ACTIVE_TRACKERS_VERSION = 1;
const CURRENT_USER_ID = '';
const CURRENT_USER_NAME = '';

export type ActiveTrackerRefreshResult = 'changed' | 'unchanged' | 'unavailable';
export type ActiveTrackerChangeSource = 'local' | 'external';

export interface ActiveTrackerStoreLike {
	/** Optional for in-memory stores without an external persistence source. */
	refreshFromDisk?(canApply?: () => boolean): Promise<ActiveTrackerRefreshResult>;
	assertSourceCurrent?(): Promise<void>;
	getChangeSource?(): ActiveTrackerChangeSource;
	getExternalRevision?(): number;
	load(): Promise<void>;
	getActiveForUser(userId?: string): ActiveTrackerRecord | null;
	getAll(): ActiveTrackerRecord[];
	setActiveForUser(record: Omit<ActiveTrackerRecord, 'id' | 'userId' | 'userName' | 'createdAt' | 'updatedAt'> & {
		id?: string;
		userId?: string;
		userName?: string;
		createdAt?: string;
		updatedAt?: string;
	}, canCommit?: () => boolean): Promise<ActiveTrackerRecord>;
	clearActiveForUser(userId?: string, canCommit?: () => boolean): Promise<void>;
	getGeneration(): number;
	drain(): Promise<void>;
	subscribe(listener: () => void): () => void;
}

export class ActiveTrackerStore implements ActiveTrackerStoreLike {
	private app: App;
	private writeQueue: WriteQueue;
	private active: ActiveTrackerRecord[] = [];
	private generation = 0;
	private listeners: Set<() => void> = new Set();
	private mutationQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private observedFile = false;
	private recoveredSource: string | null = null;
	private sourceRead: object | null = null;
	private changeSource: ActiveTrackerChangeSource = 'local';
	private externalRevision = 0;
	private readonly filePath: string;

	constructor(app: App, writeQueue: WriteQueue, filePath?: string) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath ?? buildOperonPluginStoragePath(app.vault.configDir, 'state', ACTIVE_TRACKERS_FILE_NAME);
	}

	get sourcePath(): string { return this.filePath; }

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const loadPath = await this.resolveLoadPath();
		if (!loadPath) {
			this.active = [];
			this.generation = 0;
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(loadPath);
			this.observedFile = true;
			const data = JSON.parse(raw) as Partial<ActiveTrackersData>;
			this.active = this.normalizeRecords(Array.isArray(data.active) ? data.active : []);
			// Preserve startup's existing normalization contract only for this exact source.
			this.recoveredSource = (data.version === 1 || data.version === undefined) && !parseExternalRecords(raw) ? raw : null;
			this.generation = 0;
			this.writesSuspended = false;
			if (loadPath !== this.filePath) {
				await this.flush(this.active);
			}
		} catch {
			console.warn('Operon: Failed to parse active-trackers.json, preserving invalid file as backup and starting empty');
			this.active = [];
			this.generation = 0;
			if (loadPath !== this.filePath) {
				this.writesSuspended = false;
				return;
			}
			try {
				await preserveInvalidJsonFile(adapter, this.filePath, raw);
				this.recoveredSource = raw;
				this.writesSuspended = false;
			} catch {
				console.warn('Operon: Failed to preserve invalid active-trackers.json backup; active tracker writes suspended');
				this.writesSuspended = true;
			}
		}
	}

	/** Read-only reconciliation. Never run startup recovery on a sync probe. */
	async refreshFromDisk(canApply: () => boolean = () => true): Promise<ActiveTrackerRefreshResult> {
		let result: ActiveTrackerRefreshResult = 'unavailable';
		const run = this.mutationQueue.then(async () => {
			if (!canApply()) return;
			try {
				const raw = await this.readSource();
				if (!canApply()) return;
				if (raw === null) {
					if (!this.observedFile && this.active.length === 0) result = 'unchanged';
					return;
				}
				if (raw === this.recoveredSource && !this.writesSuspended) { result = 'unchanged'; return; }
				const next = parseExternalRecords(raw);
				if (!next) return;
				this.recoveredSource = null;
				this.observedFile = true;
				if (this.sameRecords(next)) { result = 'unchanged'; return; }
				this.active = next;
				this.changeSource = 'external';
				this.externalRevision += 1;
				result = 'changed';
				this.bumpGeneration();
			} catch {
				// A sync provider may temporarily replace or hydrate this small file.
				// Keep the last valid state; the next visible probe can retry the read.
			}
		});
		this.mutationQueue = run.catch(() => {});
		await run;
		return result;
	}

	getChangeSource(): ActiveTrackerChangeSource { return this.changeSource; }
	getExternalRevision(): number { return this.externalRevision; }

	async assertSourceCurrent(): Promise<void> {
		this.assertExpectedSource(await this.readSource());
	}

	private async readSource(): Promise<string | null> {
		// Do not accumulate I/O requests if a provider never settles its last read.
		if (this.sourceRead) throw new Error('Active tracker source read is still pending');
		const owner = {};
		this.sourceRead = owner;
		const adapter = this.app.vault.adapter;
		const read = (async () => await adapter.exists(this.filePath) ? await adapter.read(this.filePath) : null)();
		const release = (): void => { if (this.sourceRead === owner) this.sourceRead = null; };
		void read.then(release, release);
		let timeout: number | undefined;
		try {
			return await Promise.race([
				read,
				new Promise<never>((_resolve, reject) => {
					timeout = window.setTimeout(() => reject(new Error('Active tracker source read timed out')), 3_000);
				}),
			]);
		} finally {
			window.clearTimeout(timeout);
		}
	}

	private assertExpectedSource(raw: string | null): void {
		if (raw !== null && raw === this.recoveredSource && !this.writesSuspended) return;
		if (raw === null && !this.observedFile && this.active.length === 0) return;
		const records = raw === null ? null : parseExternalRecords(raw);
		if (!records || !this.sameRecords(records)) throw new Error('Active tracker source changed or is unavailable');
	}

	getActiveForUser(userId = CURRENT_USER_ID): ActiveTrackerRecord | null {
		const normalizedUserId = normalizeUserId(userId);
		return this.active.find(record => record.userId === normalizedUserId) ?? null;
	}

	getAll(): ActiveTrackerRecord[] {
		return this.active.map(record => ({ ...record }));
	}

	async setActiveForUser(record: Omit<ActiveTrackerRecord, 'id' | 'userId' | 'userName' | 'createdAt' | 'updatedAt'> & {
		id?: string;
		userId?: string;
		userName?: string;
		createdAt?: string;
		updatedAt?: string;
	}, canCommit?: () => boolean): Promise<ActiveTrackerRecord> {
		let committed: ActiveTrackerRecord | null = null;
		await this.mutateActive(current => {
			const now = record.updatedAt?.trim() || record.createdAt?.trim() || new Date().toISOString();
			const userId = normalizeUserId(record.userId);
			const existing = current.find(entry => entry.userId === userId);
			const nextRecord: ActiveTrackerRecord = {
				id: record.id?.trim() || existing?.id || createActiveTrackerId(),
				userId,
				userName: record.userName !== undefined
					? record.userName.trim()
					: existing?.userName ?? CURRENT_USER_NAME,
				taskId: normalizeTaskId(record.taskId),
				start: record.start.trim(),
				source: normalizeTrackerSource(record.source),
				createdAt: record.createdAt?.trim() || existing?.createdAt || now,
				updatedAt: now,
			};
			committed = nextRecord;
			return [
				...current.filter(entry => entry.userId !== userId),
				nextRecord,
			];
		}, canCommit);
		return committed!;
	}

	async clearActiveForUser(userId = CURRENT_USER_ID, canCommit?: () => boolean): Promise<void> {
		const normalizedUserId = normalizeUserId(userId);
		await this.mutateActive(current => current.filter(record => record.userId !== normalizedUserId), canCommit);
	}

	getGeneration(): number {
		return this.generation;
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private async mutateActive(transform: (current: ActiveTrackerRecord[]) => ActiveTrackerRecord[], canCommit?: () => boolean): Promise<void> {
		const run = this.mutationQueue.then(async () => {
			if (canCommit && !canCommit()) throw new Error('Active tracker write is no longer allowed');
			await this.assertSourceCurrent();
			const next = this.normalizeRecords(transform(this.active.map(record => ({ ...record }))));
			if (this.sameRecords(next)) return;
			await this.commit(next, canCommit);
		});
		this.mutationQueue = run.catch(() => {});
		await run;
	}

	private async commit(next: ActiveTrackerRecord[], canCommit?: () => boolean): Promise<void> {
		await this.flush(next, canCommit);
		this.active = next;
		this.observedFile = true;
		this.changeSource = 'local';
		this.recoveredSource = null;
		this.bumpGeneration();
	}

	private async flush(active: ActiveTrackerRecord[], canCommit?: () => boolean): Promise<void> {
		if (this.writesSuspended) {
			throw new Error('Active tracker writes are suspended');
		}
		const data: ActiveTrackersData = {
			version: ACTIVE_TRACKERS_VERSION,
			active,
		};
		await this.writeQueue.enqueue(this.filePath, async () => {
			await this.assertSourceCurrent();
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data, {
				canCommit,
				assertCurrentText: raw => this.assertExpectedSource(raw),
				beforeAtomicReplace: () => this.assertSourceCurrent(),
			});
		});
	}

	private async resolveLoadPath(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.filePath)) return this.filePath;
		return null;
	}

	private normalizeRecords(records: unknown[]): ActiveTrackerRecord[] {
		const byUser = new Map<string, ActiveTrackerRecord>();
		for (const rawRecord of records) {
			if (!rawRecord || typeof rawRecord !== 'object') continue;
			const input = rawRecord as Partial<ActiveTrackerRecord>;
			const start = typeof input.start === 'string' ? input.start.trim() : '';
			if (!start) continue;
			const userId = normalizeUserId(input.userId);
			const record: ActiveTrackerRecord = {
				id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createActiveTrackerId(),
				userId,
				userName: typeof input.userName === 'string' ? input.userName.trim() : CURRENT_USER_NAME,
				taskId: normalizeTaskId(input.taskId),
				start,
				source: normalizeTrackerSource(input.source),
				createdAt: typeof input.createdAt === 'string' && input.createdAt.trim() ? input.createdAt.trim() : start,
				updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.trim() ? input.updatedAt.trim() : start,
			};
			const existing = byUser.get(userId);
			if (!existing || compareRecordFreshness(record, existing) > 0) {
				byUser.set(userId, record);
			}
		}
		return Array.from(byUser.values()).sort((a, b) => a.userId.localeCompare(b.userId));
	}

	private sameRecords(next: ActiveTrackerRecord[]): boolean {
		if (next.length !== this.active.length) return false;
		for (let index = 0; index < next.length; index++) {
			const a = next[index];
			const b = this.active[index];
			if (!b) return false;
			if (
				a.id !== b.id
				|| a.userId !== b.userId
				|| a.userName !== b.userName
				|| a.taskId !== b.taskId
				|| a.start !== b.start
				|| a.source !== b.source
				|| a.createdAt !== b.createdAt
				|| a.updatedAt !== b.updatedAt
			) {
				return false;
			}
		}
		return true;
	}

	private bumpGeneration(): void {
		this.generation += 1;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

function normalizeUserId(userId: string | undefined | null): string {
	return typeof userId === 'string' ? userId.trim() : CURRENT_USER_ID;
}

function normalizeTaskId(taskId: string | null | undefined): string | null {
	if (typeof taskId !== 'string') return null;
	const normalized = taskId.trim();
	return normalized || null;
}

function normalizeTrackerSource(source: TrackerSource | undefined): TrackerSource {
	const allowed: TrackerSource[] = ['editor', 'command', 'sidebar-search', 'history-play', 'status-bar', 'flowtime'];
	return source && allowed.includes(source) ? source : 'command';
}

function createActiveTrackerId(): string {
	return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compareRecordFreshness(a: ActiveTrackerRecord, b: ActiveTrackerRecord): number {
	const updated = a.updatedAt.localeCompare(b.updatedAt);
	if (updated !== 0) return updated;
	return a.start.localeCompare(b.start);
}

/** Strict external snapshots must not silently drop records or manufacture IDs. */
function parseExternalRecords(raw: string): ActiveTrackerRecord[] | null {
	try {
		const data: unknown = JSON.parse(raw);
		if (!data || typeof data !== 'object') return null;
		const input = data as Partial<ActiveTrackersData>;
		if (input.version !== ACTIVE_TRACKERS_VERSION || !Array.isArray(input.active)) return null;
		const users = new Set<string>();
		const ids = new Set<string>();
		const records: ActiveTrackerRecord[] = [];
		for (const entry of input.active) {
			if (!entry || typeof entry !== 'object'
				|| typeof entry.id !== 'string' || !entry.id.trim()
				|| typeof entry.userId !== 'string' || typeof entry.userName !== 'string'
				|| !(entry.taskId === null || (typeof entry.taskId === 'string' && !!entry.taskId.trim()))
				|| typeof entry.source !== 'string' || normalizeTrackerSource(entry.source) !== entry.source
				|| ![entry.start, entry.createdAt, entry.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
			) return null;
			const record = { ...entry, id: entry.id.trim(), userId: entry.userId.trim(), userName: entry.userName.trim(), taskId: entry.taskId?.trim() ?? null };
			if (users.has(record.userId) || ids.has(record.id)) return null;
			users.add(record.userId); ids.add(record.id); records.push(record);
		}
		return records.sort((a, b) => a.userId.localeCompare(b.userId));
	} catch { return null; }
}
