import type { App } from 'obsidian';
import { ActiveTrackerRecord, ActiveTrackersData, TrackerSource } from '../types/tracker';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';

const ACTIVE_TRACKERS_FILE = '.operon/active-trackers.json';
const ACTIVE_TRACKERS_VERSION = 1;
const CURRENT_USER_ID = '';
const CURRENT_USER_NAME = '';

export interface ActiveTrackerStoreLike {
	load(): Promise<void>;
	getActiveForUser(userId?: string): ActiveTrackerRecord | null;
	getAll(): ActiveTrackerRecord[];
	setActiveForUser(record: Omit<ActiveTrackerRecord, 'id' | 'userId' | 'userName' | 'createdAt' | 'updatedAt'> & {
		id?: string;
		userId?: string;
		userName?: string;
		createdAt?: string;
		updatedAt?: string;
	}): Promise<ActiveTrackerRecord>;
	clearActiveForUser(userId?: string): Promise<void>;
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
	private readonly filePath: string;
	private readonly legacyFilePath: string | null;
	private legacyFallbackEnabled = true;

	constructor(app: App, writeQueue: WriteQueue, filePath = ACTIVE_TRACKERS_FILE, legacyFilePath: string | null = null) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath;
		this.legacyFilePath = legacyFilePath;
	}

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
			const data = JSON.parse(raw) as Partial<ActiveTrackersData>;
			this.active = this.normalizeRecords(Array.isArray(data.active) ? data.active : []);
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
				this.writesSuspended = false;
			} catch {
				console.warn('Operon: Failed to preserve invalid active-trackers.json backup; active tracker writes suspended');
				this.writesSuspended = true;
			}
		}
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
	}): Promise<ActiveTrackerRecord> {
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
		});
		return committed!;
	}

	async clearActiveForUser(userId = CURRENT_USER_ID): Promise<void> {
		const normalizedUserId = normalizeUserId(userId);
		await this.mutateActive(current => current.filter(record => record.userId !== normalizedUserId));
	}

	getGeneration(): number {
		return this.generation;
	}

	setLegacyFallbackEnabled(enabled: boolean): void {
		this.legacyFallbackEnabled = enabled;
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

	private async mutateActive(transform: (current: ActiveTrackerRecord[]) => ActiveTrackerRecord[]): Promise<void> {
		const run = this.mutationQueue.then(async () => {
			const next = this.normalizeRecords(transform(this.active.map(record => ({ ...record }))));
			if (this.sameRecords(next)) return;
			await this.commit(next);
		});
		this.mutationQueue = run.catch(() => {});
		await run;
	}

	private async commit(next: ActiveTrackerRecord[]): Promise<void> {
		await this.flush(next);
		this.active = next;
		this.bumpGeneration();
	}

	private async flush(active: ActiveTrackerRecord[]): Promise<void> {
		if (this.writesSuspended) {
			throw new Error('Active tracker writes are suspended');
		}
		const data: ActiveTrackersData = {
			version: ACTIVE_TRACKERS_VERSION,
			active,
		};
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data);
		});
	}

	private async resolveLoadPath(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.filePath)) return this.filePath;
		if (this.legacyFallbackEnabled && this.legacyFilePath && await adapter.exists(this.legacyFilePath)) return this.legacyFilePath;
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
