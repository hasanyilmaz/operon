/**
 * PinnedCache — in-memory facade for pinned task state.
 * Canonical persistence lives in the Operon data package so Obsidian Sync can
 * carry pin state with plugin data.
 */

import {
	createEmptyPinnedTasksPackage,
	mergePinnedTasksPackages,
	normalizePinnedTasksPackage,
	OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
	prunePinnedTaskTombstones,
	type OperonPinnedTasksPackageV1,
} from './operon-data-package';

export interface PinnedCachePackagePersistence {
	getPackage(): OperonPinnedTasksPackageV1;
	updatePackage(mutator: (current: OperonPinnedTasksPackageV1) => OperonPinnedTasksPackageV1): Promise<OperonPinnedTasksPackageV1>;
	canPersist(): boolean;
}

export class PinnedCache {
	private pinnedPackage: OperonPinnedTasksPackageV1 = createEmptyPinnedTasksPackage();
	private pinnedSet: Set<string> = new Set();
	private generation = 0;
	private listeners: Set<() => void> = new Set();
	private mutationQueue: Promise<void> = Promise.resolve();
	private packagePersistence: PinnedCachePackagePersistence | null = null;

	constructor(_app: unknown, _writeQueue: unknown) {}

	setPackagePersistence(packagePersistence: PinnedCachePackagePersistence): void {
		this.packagePersistence = packagePersistence;
	}

	/**
	 * Load pinned ids during plugin init.
	 * When the canonical package already had pinned state, use it even if empty.
	 * Otherwise, start from the empty canonical package.
	 */
	async load(options: { preferPackage?: boolean } = {}): Promise<void> {
		const packageData = this.packagePersistence?.getPackage() ?? createEmptyPinnedTasksPackage();
		if (options.preferPackage || this.hasPackageEntries(packageData)) {
			this.loadFromPackage(packageData, { resetGeneration: true });
			return;
		}

		this.loadFromPackage(packageData, { resetGeneration: true });
	}

	loadFromPackage(packageData: OperonPinnedTasksPackageV1, options: { resetGeneration?: boolean } = {}): boolean {
		return this.applyPackage(packageData, options);
	}

	toPackage(): OperonPinnedTasksPackageV1 {
		return prunePinnedTaskTombstones(
			this.pinnedPackage,
			this.nowIso(),
			OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
		);
	}

	/** Check if a task is pinned (synchronous, in-memory). */
	isPinned(operonId: string): boolean {
		return this.pinnedSet.has(operonId);
	}

	/** Pin a task. No-op if already pinned. */
	async pin(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePackage((current, now) => {
			const existing = current.itemsById[normalized];
			if (existing?.pinned === true) return current;
			return this.withEntry(current, normalized, { pinned: true, updatedAt: now });
		});
	}

	/** Unpin a task. No-op if not pinned. */
	async unpin(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePackage((current, now) => {
			const existing = current.itemsById[normalized];
			if (existing?.pinned !== true) return current;
			return this.withEntry(current, normalized, { pinned: false, updatedAt: now });
		});
	}

	/** Toggle pin state for a task. */
	async toggle(operonId: string): Promise<void> {
		const normalized = operonId.trim();
		if (!normalized) return;
		await this.mutatePackage((current, now) => {
			const isPinned = current.itemsById[normalized]?.pinned === true;
			return this.withEntry(current, normalized, { pinned: !isPinned, updatedAt: now });
		});
	}

	/** Return all pinned operonIds. */
	getPinnedIds(): string[] {
		return [...this.pinnedSet];
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

	async replacePinnedIds(operonIds: Iterable<string>): Promise<void> {
		const nextPinnedIds = new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean));
		await this.mutatePackage((current, now) => {
			let next = current;
			for (const [operonId, entry] of Object.entries(current.itemsById)) {
				if (entry.pinned && !nextPinnedIds.has(operonId)) {
					next = this.withEntry(next, operonId, { pinned: false, updatedAt: now });
				}
			}
			for (const operonId of nextPinnedIds) {
				if (next.itemsById[operonId]?.pinned !== true) {
					next = this.withEntry(next, operonId, { pinned: true, updatedAt: now });
				}
			}
			return next;
		});
	}

	async removePinnedIds(operonIds: Iterable<string>): Promise<void> {
		const idsToRemove = new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean));
		if (idsToRemove.size === 0) return;
		await this.mutatePackage((current, now) => {
			let next = current;
			for (const operonId of idsToRemove) {
				if (next.itemsById[operonId]?.pinned === true) {
					next = this.withEntry(next, operonId, { pinned: false, updatedAt: now });
				}
			}
			return next;
		});
	}

	async retainPinnedIds(operonIds: Iterable<string>): Promise<void> {
		const idsToRetain = new Set(Array.from(operonIds).map(id => id.trim()).filter(Boolean));
		await this.mutatePackage((current, now) => {
			let next = current;
			for (const [operonId, entry] of Object.entries(current.itemsById)) {
				if (entry.pinned && !idsToRetain.has(operonId)) {
					next = this.withEntry(next, operonId, { pinned: false, updatedAt: now });
				}
			}
			return next;
		});
	}

	private async mutatePackage(
		transform: (current: OperonPinnedTasksPackageV1, now: string) => OperonPinnedTasksPackageV1,
	): Promise<void> {
		const run = this.mutationQueue.then(async () => {
			const now = this.nowIso();
			if (this.packagePersistence?.canPersist()) {
				const persisted = await this.packagePersistence.updatePackage(currentPackage => {
					const base = mergePinnedTasksPackages(currentPackage, this.pinnedPackage);
					const next = transform(base, now);
					return prunePinnedTaskTombstones(next, now, OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS);
				});
				this.applyPackage(persisted);
				return;
			}

			const next = prunePinnedTaskTombstones(
				transform(this.pinnedPackage, now),
				now,
				OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
			);
			this.applyPackage(next);
		});
		this.mutationQueue = run.catch(() => {});
		await run;
	}

	private withEntry(
		current: OperonPinnedTasksPackageV1,
		operonId: string,
		entry: { pinned: boolean; updatedAt: string },
	): OperonPinnedTasksPackageV1 {
		return normalizePinnedTasksPackage({
			version: current.version,
			itemsById: {
				...current.itemsById,
				[operonId]: entry,
			},
		});
	}

	private applyPackage(
		packageData: OperonPinnedTasksPackageV1,
		options: { resetGeneration?: boolean } = {},
	): boolean {
		const normalized = normalizePinnedTasksPackage(packageData);
		const changed = this.packageSignature(normalized) !== this.packageSignature(this.pinnedPackage);
		this.pinnedPackage = normalized;
		this.pinnedSet = new Set(
			Object.entries(normalized.itemsById)
				.filter(([, entry]) => entry.pinned)
				.map(([operonId]) => operonId),
		);
		if (options.resetGeneration) {
			this.generation = 0;
			return changed;
		}
		if (changed) this.bumpGeneration();
		return changed;
	}

	private hasPackageEntries(packageData: OperonPinnedTasksPackageV1): boolean {
		return Object.keys(normalizePinnedTasksPackage(packageData).itemsById).length > 0;
	}

	private packageSignature(packageData: OperonPinnedTasksPackageV1): string {
		return JSON.stringify(normalizePinnedTasksPackage(packageData));
	}

	private nowIso(): string {
		return new Date().toISOString();
	}

	private bumpGeneration(): void {
		this.generation += 1;
		for (const listener of this.listeners) {
			listener();
		}
	}
}
