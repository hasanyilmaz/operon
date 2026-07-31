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
	type OperonPinnedTaskPackageEntry,
	type OperonPinnedTasksPackageV1,
} from './operon-data-package';

export interface PinnedCachePackagePersistence {
	getPackage(): OperonPinnedTasksPackageV1;
	updatePackage(mutator: (current: OperonPinnedTasksPackageV1) => OperonPinnedTasksPackageV1): Promise<OperonPinnedTasksPackageV1>;
	canPersist(): boolean;
}

export type PinnedCacheEntrySnapshot = OperonPinnedTaskPackageEntry | null;

export type PinnedCacheCompareAndSetResult =
	| {
		outcome: 'committed';
		before: PinnedCacheEntrySnapshot;
		after: OperonPinnedTaskPackageEntry;
	}
	| {
		outcome: 'no-change';
		before: PinnedCacheEntrySnapshot;
		after: PinnedCacheEntrySnapshot;
	}
	| {
		outcome: 'already-applied';
		before: PinnedCacheEntrySnapshot;
		after: OperonPinnedTaskPackageEntry;
	}
	| {
		outcome: 'conflict';
		before: PinnedCacheEntrySnapshot;
		after: PinnedCacheEntrySnapshot;
	};

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

	canPersistCanonical(): boolean {
		return this.packagePersistence?.canPersist() === true;
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

	getEntry(operonId: string): OperonPinnedTaskPackageEntry | undefined {
		const entry = this.pinnedPackage.itemsById[operonId.trim()];
		return entry ? { ...entry } : undefined;
	}

	getCanonicalEntry(operonId: string): PinnedCacheEntrySnapshot {
		const packageData = this.packagePersistence?.getPackage();
		if (!packageData) return null;
		const entry = normalizePinnedTasksPackage(packageData).itemsById[operonId.trim()];
		return entry ? { ...entry } : null;
	}

	hasManualOrder(): boolean {
		return !!this.pinnedPackage.manualOrder;
	}

	getManualOrderIds(): string[] {
		return [...(this.pinnedPackage.manualOrder?.operonIds ?? [])];
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

	/**
	 * Persist one exact pin-state transition only while the canonical entry still
	 * matches the snapshot sealed during preview. Runtime mutations must use this
	 * path instead of the permissive UI helpers above: it never falls back to
	 * memory-only state when canonical data-package persistence is unavailable.
	 */
	async compareAndSetPinned(
		operonId: string,
		expected: PinnedCacheEntrySnapshot,
		pinned: boolean,
		updatedAt: string,
	): Promise<PinnedCacheCompareAndSetResult> {
		const normalized = operonId.trim();
		if (!normalized) throw new Error('Pinned task compare-and-set requires an operonId.');
		if (!Number.isFinite(Date.parse(updatedAt))) {
			throw new Error('Pinned task compare-and-set requires a valid updatedAt timestamp.');
		}
		const expectedSnapshot = expected ? { ...expected } : null;
		const run = this.mutationQueue.then(async (): Promise<PinnedCacheCompareAndSetResult> => {
			if (!this.packagePersistence?.canPersist()) {
				throw new Error('Canonical pinned task persistence is unavailable.');
			}
			const operationState: { result: PinnedCacheCompareAndSetResult | null } = { result: null };
			let persisted: OperonPinnedTasksPackageV1;
			try {
				persisted = await this.packagePersistence.updatePackage(currentPackage => {
					// Runtime CAS authority is the canonical package passed by the
					// persistence queue. Never merge the in-memory facade here: doing so
					// could flush unrelated stale memory entries during one exact mutation.
					const base = normalizePinnedTasksPackage(currentPackage);
					const currentEntry = base.itemsById[normalized]
						? { ...base.itemsById[normalized] }
						: null;
					const plannedEntry = { pinned, updatedAt };
					if (this.entriesEqual(currentEntry, plannedEntry)) {
						operationState.result = {
							outcome: 'already-applied',
							before: expectedSnapshot,
							after: plannedEntry,
						};
						return base;
					}
					if (!this.entriesEqual(currentEntry, expectedSnapshot)) {
						operationState.result = {
							outcome: 'conflict',
							before: expectedSnapshot,
							after: currentEntry,
						};
						return base;
					}
					if ((currentEntry?.pinned ?? false) === pinned) {
						operationState.result = {
							outcome: 'no-change',
							before: currentEntry,
							after: currentEntry,
						};
						return base;
					}
					operationState.result = {
						outcome: 'committed',
						before: currentEntry,
						after: plannedEntry,
					};
					return this.withEntry(base, normalized, plannedEntry);
				});
			} catch (error) {
				// The package store may have committed before losing its acknowledgement.
				// Rehydrate the facade from the canonical read without attempting
				// another write so same-plan recovery can prove an exact after-state.
				try {
					this.applyPackage(this.packagePersistence.getPackage());
				} catch {
					// Preserve the original persistence error and its uncertainty fence.
				}
				throw error;
			}
			this.applyPackage(persisted);
			const result = operationState.result;
			if (!result) {
				throw new Error('Canonical pinned task compare-and-set did not execute.');
			}
			if (result.outcome === 'committed' && !this.entriesEqual(this.getEntry(normalized) ?? null, result.after)) {
				throw new Error('Canonical pinned task compare-and-set could not be verified.');
			}
			return result;
		});
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return await run;
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

	async ensureManualOrder(operonIds: Iterable<string>): Promise<void> {
		await this.mutatePackage((current, now) => {
			if (current.manualOrder) return current;
			return this.withManualOrder(current, operonIds, now);
		}, { requirePersistence: true });
	}

	async replaceManualOrder(operonIds: Iterable<string>): Promise<void> {
		await this.mutatePackage((current, now) => {
			const normalizedIds = this.normalizeOperonIds(operonIds);
			if (current.manualOrder && this.sameOperonIds(current.manualOrder.operonIds, normalizedIds)) return current;
			return this.withManualOrder(current, normalizedIds, now);
		}, { requirePersistence: true });
	}

	async reorderVisibleManualOrder(operonIds: Iterable<string>): Promise<void> {
		await this.mutatePackage((current, now) => {
			const visibleIds = this.normalizeOperonIds(operonIds);
			const storedIds = current.manualOrder?.operonIds ?? [];
			const visibleIdSet = new Set(visibleIds);
			const currentlyVisibleIds = storedIds.filter(operonId => visibleIdSet.has(operonId));
			const allVisibleIdsAlreadyStored = visibleIds.every(operonId => storedIds.includes(operonId));
			if (allVisibleIdsAlreadyStored && this.sameOperonIds(currentlyVisibleIds, visibleIds)) return current;

			const firstRemovedIndex = storedIds.findIndex(operonId => visibleIdSet.has(operonId));
			const retainedIds = storedIds.filter(operonId => !visibleIdSet.has(operonId));
			const insertAt = firstRemovedIndex < 0
				? retainedIds.length
				: Math.min(firstRemovedIndex, retainedIds.length);
			const nextIds = [
				...retainedIds.slice(0, insertAt),
				...visibleIds,
				...retainedIds.slice(insertAt),
			];
			if (current.manualOrder && this.sameOperonIds(storedIds, nextIds)) return current;
			return this.withManualOrder(current, nextIds, now);
		}, { requirePersistence: true });
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
		options: { requirePersistence?: boolean } = {},
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
			if (options.requirePersistence) {
				throw new Error('Pinned task manual order persistence is unavailable.');
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
			...(current.manualOrder ? { manualOrder: current.manualOrder } : {}),
		});
	}

	private withManualOrder(
		current: OperonPinnedTasksPackageV1,
		operonIds: Iterable<string>,
		updatedAt: string,
	): OperonPinnedTasksPackageV1 {
		return normalizePinnedTasksPackage({
			version: current.version,
			itemsById: current.itemsById,
			manualOrder: {
				operonIds: this.normalizeOperonIds(operonIds),
				updatedAt,
			},
		});
	}

	private normalizeOperonIds(operonIds: Iterable<string>): string[] {
		const seen = new Set<string>();
		const normalizedIds: string[] = [];
		for (const rawId of operonIds) {
			const operonId = rawId.trim();
			if (!operonId || seen.has(operonId)) continue;
			seen.add(operonId);
			normalizedIds.push(operonId);
		}
		return normalizedIds;
	}

	private sameOperonIds(left: readonly string[], right: readonly string[]): boolean {
		return left.length === right.length && left.every((operonId, index) => operonId === right[index]);
	}

	private entriesEqual(
		left: PinnedCacheEntrySnapshot,
		right: PinnedCacheEntrySnapshot,
	): boolean {
		return left === null
			? right === null
			: right !== null
				&& left.pinned === right.pinned
				&& left.updatedAt === right.updatedAt;
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
