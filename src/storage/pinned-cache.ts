/**
 * PinnedCache — external cache for pinned task state.
 * Stores pinned operonIds outside task files.
 * Never writes to vault task files → no reindex loop.
 */

import type { App } from 'obsidian';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';

const PINNED_CACHE_FILE = '.operon/cache/pinned-cache.json';

interface PinnedCacheData {
	pinned: string[];
}

export class PinnedCache {
	private app: App;
	private writeQueue: WriteQueue;
	private pinnedSet: Set<string> = new Set();
	private generation = 0;
	private listeners: Set<() => void> = new Set();
	private mutationQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private readonly filePath: string;
	private readonly legacyFilePath: string | null;
	private legacyFallbackEnabled = true;

	constructor(app: App, writeQueue: WriteQueue, filePath = PINNED_CACHE_FILE, legacyFilePath: string | null = null) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath;
		this.legacyFilePath = legacyFilePath;
	}

	/**
	 * Load pinned ids from cache file. Call during plugin init.
	 * If file doesn't exist, starts empty (ignores any vault fieldValues['pinned']).
	 */
	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const loadPath = await this.resolveLoadPath();
		if (!loadPath) {
			this.pinnedSet = new Set();
			this.generation = 0;
			return;
		}
		let raw = '';
		try {
			raw = await adapter.read(loadPath);
			const data = JSON.parse(raw) as PinnedCacheData;
			this.pinnedSet = new Set(Array.isArray(data.pinned) ? data.pinned : []);
			this.generation = 0;
			this.writesSuspended = false;
			if (loadPath !== this.filePath) {
				await this.flush(this.pinnedSet);
			}
		} catch {
			console.warn('Operon: Failed to parse pinned-cache.json, preserving invalid file as backup and starting empty');
			this.pinnedSet = new Set();
			this.generation = 0;
			if (loadPath !== this.filePath) {
				this.writesSuspended = false;
				return;
			}
			try {
				await preserveInvalidJsonFile(adapter, this.filePath, raw);
				this.writesSuspended = false;
			} catch {
				console.warn('Operon: Failed to preserve invalid pinned-cache.json backup; pinned cache writes suspended');
				this.writesSuspended = true;
			}
		}
	}

	/** Check if a task is pinned (synchronous, in-memory). */
	isPinned(operonId: string): boolean {
		return this.pinnedSet.has(operonId);
	}

	/** Pin a task. No-op if already pinned. */
	async pin(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePinnedSet(current => {
			current.add(normalized);
			return current;
		});
	}

	/** Unpin a task. No-op if not pinned. */
	async unpin(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePinnedSet(current => {
			current.delete(normalized);
			return current;
		});
	}

	/** Toggle pin state for a task. */
	async toggle(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePinnedSet(current => {
			if (current.has(normalized)) {
				current.delete(normalized);
			} else {
				current.add(normalized);
			}
			return current;
		});
	}

	/** Return all pinned operonIds. */
	getPinnedIds(): string[] {
		return [...this.pinnedSet];
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

	async replacePinnedIds(operonIds: Iterable<string>): Promise<void> {
		await this.mutatePinnedSet(() => new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean)));
	}

	async removePinnedIds(operonIds: Iterable<string>): Promise<void> {
		const idsToRemove = new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean));
		if (idsToRemove.size === 0) return;
		await this.mutatePinnedSet(current => {
			for (const id of idsToRemove) {
				current.delete(id);
			}
			return current;
		});
	}

	async retainPinnedIds(operonIds: Iterable<string>): Promise<void> {
		const idsToRetain = new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean));
		await this.mutatePinnedSet(current => {
			for (const id of [...current]) {
				if (!idsToRetain.has(id)) current.delete(id);
			}
			return current;
		});
	}

	private async mutatePinnedSet(transform: (current: Set<string>) => Set<string>): Promise<void> {
		const run = this.mutationQueue.then(async () => {
			const next = transform(new Set(this.pinnedSet));
			if (this.sameSet(next)) return;
			await this.commit(next);
		});
		this.mutationQueue = run.catch(() => {});
		await run;
	}

	private async flush(pinnedSet: Set<string>): Promise<boolean> {
		if (this.writesSuspended) {
			console.warn('Operon: Pinned cache write skipped because writes are suspended');
			return false;
		}
		const data: PinnedCacheData = { pinned: [...pinnedSet] };
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data);
		});
		return true;
	}

	private async resolveLoadPath(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.filePath)) return this.filePath;
		if (this.legacyFallbackEnabled && this.legacyFilePath && await adapter.exists(this.legacyFilePath)) return this.legacyFilePath;
		return null;
	}

	private async commit(next: Set<string>): Promise<void> {
		if (!(await this.flush(next))) return;
		this.pinnedSet = next;
		this.bumpGeneration();
	}

	private sameSet(next: Set<string>): boolean {
		if (next.size !== this.pinnedSet.size) return false;
		for (const value of next) {
			if (!this.pinnedSet.has(value)) return false;
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
