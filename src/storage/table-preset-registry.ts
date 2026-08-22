import { cloneTablePreset, type TablePreset, type TablePresetFileBinding, type TablePresetPatch } from '../types/table';
import type { DiscoveredOperonTableFile, OperonTableFileDescriptor } from '../types/table-file';
import type {
	TablePresetRegistryCallbacks,
	TablePresetRegistryConflict,
	TablePresetRegistryEntry,
	TablePresetRegistryListener,
	TablePresetRegistryPatchContext,
	TablePresetRegistryPatchControl,
	TablePresetRegistryPatchHooks,
	TablePresetRegistryPatchOptions,
	TablePresetRegistrySnapshot,
	TablePresetRegistrySource,
} from '../types/table-preset-registry';
import { discoverOperonTableFiles, getOperonTableFilePathKey, normalizeOperonTableFilePath, parseOperonTableFile, serializeOperonTableFile } from './table-file';
import { WriteQueue } from './write-queue';

export const DEFAULT_TABLE_PRESET_PATCH_DELAY_MS = 350;

interface PendingPatch {
	presetId: string;
	scope: string;
	patch: TablePresetPatch;
	hooks: TablePresetRegistryPatchHooks[];
	timer: number | null;
	promise: Promise<void> | null;
	surfaceTokens: Set<string>;
}

export class TablePresetRegistry<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	private readonly callbacks: TablePresetRegistryCallbacks<TDescriptor>;
	private readonly writeQueue: WriteQueue;
	private readonly schedulePatch: (callback: () => void, delayMs: number) => number;
	private readonly cancelScheduledPatch: (timerId: number) => void;
	private snapshot: TablePresetRegistrySnapshot<TDescriptor> = emptySnapshot();
	private authoritativeEntries = new Map<string, TablePresetRegistryEntry<TDescriptor>>();
	private authoritativeGeneration = 0;
	private refreshSequence = 0;
	private readonly listeners = new Map<string, Set<TablePresetRegistryListener<TDescriptor>>>();
	private readonly pendingPatches = new Map<string, PendingPatch>();
	private acceptingPatches = true;

	constructor(callbacks: TablePresetRegistryCallbacks<TDescriptor>, writeQueue = new WriteQueue()) {
		this.callbacks = callbacks;
		this.writeQueue = writeQueue;
		this.schedulePatch = callbacks.schedulePatch ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
		this.cancelScheduledPatch = callbacks.cancelScheduledPatch ?? (timerId => window.clearTimeout(timerId));
	}

	getSnapshot(): TablePresetRegistrySnapshot<TDescriptor> {
		return cloneSnapshot(this.snapshot);
	}

	get(presetId: string): TablePresetRegistryEntry<TDescriptor> | null {
		return cloneEntry(this.snapshot.entries.get(presetId) ?? null);
	}

	getPreset(presetId: string): TablePreset | null {
		const preset = this.snapshot.entries.get(presetId)?.preset;
		return preset ? cloneTablePreset(preset) : null;
	}

	getSource(presetId: string): TablePresetRegistrySource<TDescriptor> | null {
		const source = this.snapshot.entries.get(presetId)?.source;
		return source ? { ...source } : null;
	}

	getPath(presetId: string): string | null {
		return this.snapshot.entries.get(presetId)?.source.path ?? null;
	}

	projectFilePreset(path: string, basePreset: TablePreset): TablePreset {
		const entry = this.snapshot.entries.get(basePreset.id);
		if (entry?.status === 'conflict') return cloneTablePreset(basePreset);
		if (entry?.source.kind === 'table-file' && entry.source.path
			&& getOperonTableFilePathKey(entry.source.path) !== getOperonTableFilePathKey(path)) {
			return cloneTablePreset(basePreset);
		}
		let projected = cloneTablePreset(basePreset);
		for (const pending of this.pendingPatches.values()) {
			if (pending.presetId !== basePreset.id) continue;
			projected = this.callbacks.applyPatch(projected, pending.patch);
		}
		return cloneTablePreset(projected);
	}

	subscribe(presetId: string, listener: TablePresetRegistryListener<TDescriptor>, emitCurrent = true): () => void {
		const listeners = this.listeners.get(presetId) ?? new Set<TablePresetRegistryListener<TDescriptor>>();
		listeners.add(listener);
		this.listeners.set(presetId, listeners);
		if (emitCurrent) listener(this.get(presetId), this.getSnapshot());
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(presetId);
		};
	}

	async refresh(sourceRevision = this.callbacks.getSourceRevision?.() ?? this.snapshot.sourceRevision + 1): Promise<boolean> {
		const sequence = ++this.refreshSequence;
		while (sequence === this.refreshSequence && sourceRevision >= this.snapshot.sourceRevision) {
			const authoritativeGeneration = this.authoritativeGeneration;
			const [bindings, descriptors] = await Promise.all([
				this.callbacks.loadFileBindings(),
				this.callbacks.listTableFiles(),
			]);
			const discovery = await discoverOperonTableFiles(descriptors, descriptor => this.callbacks.readTableFile(descriptor));
			if (sequence !== this.refreshSequence || sourceRevision < this.snapshot.sourceRevision) return false;
			if (authoritativeGeneration !== this.authoritativeGeneration) continue;

			const merged = mergeRegistryEntries(bindings, discovery.files);
			this.authoritativeEntries = cloneEntries(merged.entries);
			this.authoritativeGeneration += 1;
			const optimisticEntries = this.projectPendingPatches(this.authoritativeEntries);
			this.publish({
				revision: this.snapshot.revision + 1,
				sourceRevision,
				entries: optimisticEntries,
				fileDiagnostics: discovery.diagnostics,
				conflicts: merged.conflicts,
			});
			return true;
		}
		return false;
	}

	queuePatch(
		presetId: string,
		scope: string,
		patch: TablePresetPatch,
		options: TablePresetRegistryPatchOptions = {},
	): TablePresetRegistryPatchControl {
		if (!this.acceptingPatches) throw new Error('Table preset registry is shutting down.');
		if (patch.id !== presetId) throw new Error(`Table preset patch id "${patch.id}" does not match "${presetId}".`);
		const entry = this.snapshot.entries.get(presetId);
		if (!entry?.preset) throw new Error(`Table preset "${presetId}" is not available.`);
		if (entry.status === 'conflict') throw new Error(`Table preset "${presetId}" has an unresolved source conflict.`);
		if (options.expectedRevision !== undefined && options.expectedRevision !== this.snapshot.revision) {
			throw new Error(`Table preset registry revision changed from ${options.expectedRevision} to ${this.snapshot.revision}.`);
		}
		const key = patchKey(presetId, scope);
		const candidate = this.pendingPatches.get(key);
		const existing = candidate?.promise ? undefined : candidate;
		const pending: PendingPatch = existing ?? {
			presetId,
			scope,
			patch: candidate ? { ...candidate.patch } : { id: presetId },
			hooks: [],
			timer: null,
			promise: null,
			surfaceTokens: new Set<string>(),
		};
		pending.patch = { ...pending.patch, ...patch, id: presetId };
		if (options.surfaceToken) pending.surfaceTokens.add(options.surfaceToken);
		let resolveSettled!: () => void;
		let rejectSettled!: (error: unknown) => void;
		const settled = new Promise<void>((resolve, reject) => {
			resolveSettled = resolve;
			rejectSettled = reject;
		});
		void settled.catch(() => {});
		pending.hooks.push({
			onFlushed: (preset, revision) => {
				try {
					options.onFlushed?.(preset, revision);
				} finally {
					resolveSettled();
				}
			},
			onCancelled: () => {
				try {
					options.onCancelled?.();
				} finally {
					resolveSettled();
				}
			},
			onError: error => {
				try {
					options.onError?.(error);
				} finally {
					rejectSettled(error);
				}
			},
		});
		this.pendingPatches.set(key, pending);
		this.publishProjectedEntries();
		const acceptedRevision = this.snapshot.revision;
		if (pending.timer !== null) this.cancelScheduledPatch(pending.timer);
		pending.timer = this.schedulePatch(() => {
			void this.flushPatchKey(key).catch(() => {});
		}, options.delayMs ?? DEFAULT_TABLE_PRESET_PATCH_DELAY_MS);
		return {
			acceptedRevision,
			settled,
			flush: () => this.flushPendingPatch(key, pending),
			cancel: () => this.cancelPendingPatch(key, pending),
		};
	}

	async flushPatches(presetId?: string, scope?: string): Promise<void> {
		const keys = [...this.pendingPatches.keys()].filter(key => {
			const pending = this.pendingPatches.get(key);
			return pending && (presetId === undefined || pending.presetId === presetId)
				&& (scope === undefined || pending.scope === scope);
		});
		await Promise.all(keys.map(key => this.flushPatchKey(key)));
	}

	cancelPatches(presetId?: string, scope?: string): void {
		for (const [key, pending] of this.pendingPatches) {
			if ((presetId === undefined || pending.presetId === presetId) && (scope === undefined || pending.scope === scope)) {
				this.cancelPatchKey(key);
			}
		}
	}

	async drain(): Promise<void> {
		this.acceptingPatches = false;
		const pendingWrites = [...this.pendingPatches.keys()].map(key => this.flushPatchKey(key));
		const results = await Promise.allSettled(pendingWrites);
		await this.writeQueue.drain();
		const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failure) throw failure.reason;
	}

	dispose(): void {
		this.acceptingPatches = false;
		this.cancelPatches();
		this.listeners.clear();
	}

	private async flushPatchKey(key: string): Promise<void> {
		const pending = this.pendingPatches.get(key);
		if (!pending) return;
		if (pending.promise) return pending.promise;
		if (pending.timer !== null) this.cancelScheduledPatch(pending.timer);
		pending.timer = null;
		pending.promise = this.persistPatch(pending)
			.then(() => {
				if (this.pendingPatches.get(key) === pending) this.pendingPatches.delete(key);
				this.publishProjectedEntries();
			})
			.catch(error => {
				if (this.pendingPatches.get(key) === pending) this.pendingPatches.delete(key);
				this.publishProjectedEntries();
				for (const hooks of pending.hooks) hooks.onError?.(error);
				throw error;
			})
			.then(() => undefined);
		return pending.promise;
	}

	private flushPendingPatch(key: string, pending: PendingPatch): Promise<void> {
		if (this.pendingPatches.get(key) === pending) return this.flushPatchKey(key);
		return pending.promise ?? Promise.resolve();
	}

	private cancelPendingPatch(key: string, pending: PendingPatch): void {
		if (this.pendingPatches.get(key) === pending) this.cancelPatchKey(key);
	}

	private cancelPatchKey(key: string): void {
		const pending = this.pendingPatches.get(key);
		if (!pending || pending.promise) return;
		if (pending.timer !== null) this.cancelScheduledPatch(pending.timer);
		this.pendingPatches.delete(key);
		this.publishProjectedEntries();
		for (const hooks of pending.hooks) hooks.onCancelled?.();
	}

	private async persistPatch(pending: PendingPatch): Promise<void> {
		const initialEntry = this.snapshot.entries.get(pending.presetId);
		if (!initialEntry) throw new Error(`Table preset "${pending.presetId}" is not available.`);
		let persistedPreset: TablePreset | null = null;
		await this.writeQueue.enqueue(writeKey(initialEntry.source), async () => {
			const entry = this.snapshot.entries.get(pending.presetId);
			if (!entry || !entry.preset) throw new Error(`Table preset "${pending.presetId}" is not available.`);
			if (entry.status === 'conflict') throw new Error(`Table preset "${pending.presetId}" has an unresolved source conflict.`);
			const baseRevision = this.snapshot.revision;
			let basePreset = entry.preset;
			let baseFileContent: string | undefined;
			if (entry.source.kind === 'table-file') {
				if (!entry.source.descriptor || !entry.source.path) {
					throw new Error(`Table preset "${pending.presetId}" has no readable file source.`);
				}
				baseFileContent = await this.callbacks.readTableFile(entry.source.descriptor);
				const latest = parseOperonTableFile(baseFileContent, entry.source.path);
				if (latest.status !== 'valid' || !latest.preset || latest.preset.id !== pending.presetId) {
					throw new Error(`Table file "${entry.source.path}" changed to an invalid or conflicting document.`);
				}
				basePreset = latest.preset;
			}
			const preset = this.callbacks.applyPatch(basePreset, pending.patch);
			const context: TablePresetRegistryPatchContext<TDescriptor> = {
				presetId: pending.presetId,
				scope: pending.scope,
				source: { ...entry.source },
				baseRevision,
				...(baseFileContent !== undefined ? { baseFileContent } : {}),
			};
			if (entry.source.kind !== 'table-file' || !entry.source.path || !this.callbacks.writeTableFile) {
				throw new Error(`Table preset "${pending.presetId}" has no writable table file source.`);
			}
			await this.callbacks.writeTableFile(entry.source.path, serializeOperonTableFile(preset), context);
			const currentEntry = this.snapshot.entries.get(pending.presetId);
			const authoritativeEntry = this.authoritativeEntries.get(pending.presetId) ?? currentEntry;
			const persistedEntry: TablePresetRegistryEntry<TDescriptor> | null = authoritativeEntry ? {
				...authoritativeEntry,
				status: 'available',
				preset: cloneTablePreset(preset),
				source: { ...authoritativeEntry.source },
			} : null;
			if (persistedEntry) {
				this.authoritativeEntries.set(pending.presetId, persistedEntry);
				this.authoritativeGeneration += 1;
			}
			persistedPreset = preset;
		});
		if (!persistedPreset) throw new Error(`Table preset "${pending.presetId}" was not persisted.`);
		for (const hooks of pending.hooks) hooks.onFlushed?.(cloneTablePreset(persistedPreset), this.snapshot.revision);
	}

	private projectPendingPatches(
		entries: ReadonlyMap<string, TablePresetRegistryEntry<TDescriptor>>,
	): Map<string, TablePresetRegistryEntry<TDescriptor>> {
		const nextEntries = cloneEntries(entries);
		for (const pending of this.pendingPatches.values()) {
			const entry = nextEntries.get(pending.presetId);
			if (!entry?.preset || entry.status !== 'available') continue;
			nextEntries.set(pending.presetId, {
				...entry,
				preset: cloneTablePreset(this.callbacks.applyPatch(entry.preset, pending.patch)),
				source: { ...entry.source },
			});
		}
		return nextEntries;
	}

	private publishProjectedEntries(): void {
		this.publish({
			...this.snapshot,
			revision: this.snapshot.revision + 1,
			entries: this.projectPendingPatches(this.authoritativeEntries),
		});
	}

	private publish(snapshot: TablePresetRegistrySnapshot<TDescriptor>): void {
		const previousEntries = this.snapshot.entries;
		this.snapshot = cloneSnapshot(snapshot);
		for (const [id, listeners] of this.listeners) {
			if (registryEntriesEqual(previousEntries.get(id), this.snapshot.entries.get(id))) continue;
			for (const listener of listeners) listener(this.get(id), this.getSnapshot());
		}
	}
}

function mergeRegistryEntries<TDescriptor extends OperonTableFileDescriptor>(
	bindings: readonly TablePresetFileBinding[],
	files: readonly DiscoveredOperonTableFile<TDescriptor>[],
): { entries: Map<string, TablePresetRegistryEntry<TDescriptor>>; conflicts: TablePresetRegistryConflict[] } {
	const entries = new Map<string, TablePresetRegistryEntry<TDescriptor>>();
	const conflicts: TablePresetRegistryConflict[] = [];
	const bindingsById = groupBy(bindings.map(binding => ({ ...binding, path: normalizeOperonTableFilePath(binding.path) })), binding => binding.id);
	const bindingsByPath = groupBy([...bindingsById.values()].flat(), binding => getOperonTableFilePathKey(binding.path));
	const filesByPath = new Map(files.map(file => [getOperonTableFilePathKey(file.path), file]));
	const consumedPaths = new Set<string>();

	for (const [id, matches] of bindingsById) {
		if (matches.length > 1) conflicts.push(conflict('duplicate-binding-id', id, `Preset id "${id}" has multiple file bindings.`, matches.map(match => match.path)));
	}
	for (const matches of bindingsByPath.values()) {
		if (matches.length > 1) {
			for (const match of matches) conflicts.push(conflict('duplicate-binding-path', match.id, `Table file "${match.path}" is bound more than once.`, [match.path]));
		}
	}

	for (const [id, idBindings] of bindingsById) {
		const bindingConflicts = conflicts.filter(item => item.presetId === id);
		if (idBindings.length !== 1 || bindingConflicts.length > 0) {
			const requestedPath = idBindings[0]?.path ?? null;
			entries.set(id, conflictEntry(id, requestedPath, bindingConflicts, requestedPath));
			continue;
		}
		const binding = idBindings[0];
		const file = filesByPath.get(getOperonTableFilePathKey(binding.path));
		if (!file) {
			entries.set(id, missingEntry(id, binding.path));
			continue;
		}
		consumedPaths.add(file.path);
		if (file.status === 'conflict') {
			const item = conflict('duplicate-table-file', id, `Bound table preset id "${id}" is duplicated across table files.`, duplicatePaths(files, id));
			conflicts.push(item);
			entries.set(id, conflictEntry(id, binding.path, [item], binding.path));
		} else if (file.status !== 'loaded' || !file.preset) {
			entries.set(id, missingEntry(id, binding.path));
		} else if (file.preset.id !== id) {
			const item = conflict('bound-id-mismatch', id, `Bound table file contains preset id "${file.preset.id}" instead of "${id}".`, [binding.path]);
			conflicts.push(item);
			entries.set(id, conflictEntry(id, binding.path, [item], binding.path));
		} else {
			entries.set(id, availableFileEntry(file, true, binding.path));
		}
	}

	for (const file of files) {
		if (consumedPaths.has(file.path) || !file.preset) continue;
		const id = file.preset.id;
		if (file.status === 'conflict') {
			if (!entries.has(id)) {
				const item = conflict('duplicate-table-file', id, `Table preset id "${id}" is duplicated across table files.`, duplicatePaths(files, id));
				conflicts.push(item);
				entries.set(id, conflictEntry(id, file.path, [item]));
			}
			continue;
		}
		if (file.status !== 'loaded') continue;
		if (!entries.has(id)) {
			entries.set(id, availableFileEntry(file, false));
		}
	}

	return { entries, conflicts: dedupeConflicts(conflicts) };
}

function availableFileEntry<TDescriptor extends OperonTableFileDescriptor>(
	file: DiscoveredOperonTableFile<TDescriptor>,
	bound: boolean,
	requestedPath: string | null = null,
): TablePresetRegistryEntry<TDescriptor> {
	const preset = file.preset!;
	return { id: preset.id, status: 'available', preset: cloneTablePreset(preset), source: source<TDescriptor>('table-file', preset.id, file.path, requestedPath, bound, file.descriptor), conflicts: [] };
}

function missingEntry<TDescriptor extends OperonTableFileDescriptor>(id: string, path: string): TablePresetRegistryEntry<TDescriptor> {
	return { id, status: 'missing', preset: null, source: source<TDescriptor>('missing-bound-file', id, path, path, true, null), conflicts: [] };
}

function conflictEntry<TDescriptor extends OperonTableFileDescriptor>(
	id: string,
	path: string | null,
	conflicts: TablePresetRegistryConflict[],
	requestedPath: string | null = null,
): TablePresetRegistryEntry<TDescriptor> {
	return { id, status: 'conflict', preset: null, source: source<TDescriptor>('conflict', id, path, requestedPath, path !== null, null), conflicts: conflicts.map(cloneConflict) };
}

function source<TDescriptor extends OperonTableFileDescriptor>(kind: TablePresetRegistrySource<TDescriptor>['kind'], presetId: string, path: string | null, requestedPath: string | null, bound: boolean, descriptor: TDescriptor | null): TablePresetRegistrySource<TDescriptor> {
	return { kind, presetId, path, requestedPath, bound, descriptor };
}

function conflict(code: TablePresetRegistryConflict['code'], presetId: string, message: string, paths: string[]): TablePresetRegistryConflict {
	return { code, presetId, message, paths: [...paths] };
}

function duplicatePaths<TDescriptor extends OperonTableFileDescriptor>(files: readonly DiscoveredOperonTableFile<TDescriptor>[], id: string): string[] {
	return files.filter(file => file.preset?.id === id).map(file => file.path);
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
	const result = new Map<string, T[]>();
	for (const value of values) result.set(keyOf(value), [...(result.get(keyOf(value)) ?? []), value]);
	return result;
}

function dedupeConflicts(conflicts: readonly TablePresetRegistryConflict[]): TablePresetRegistryConflict[] {
	const seen = new Set<string>();
	return conflicts.filter(item => {
		const key = `${item.code}\u0000${item.presetId}\u0000${item.paths.join('\u0000')}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).map(cloneConflict);
}

function cloneConflict(conflictValue: TablePresetRegistryConflict): TablePresetRegistryConflict {
	return { ...conflictValue, paths: [...conflictValue.paths] };
}

function cloneEntry<TDescriptor extends OperonTableFileDescriptor>(entry: TablePresetRegistryEntry<TDescriptor> | null): TablePresetRegistryEntry<TDescriptor> | null {
	return entry ? { ...entry, preset: entry.preset ? cloneTablePreset(entry.preset) : null, source: { ...entry.source }, conflicts: entry.conflicts.map(cloneConflict) } : null;
}

function registryEntriesEqual<TDescriptor extends OperonTableFileDescriptor>(
	left: TablePresetRegistryEntry<TDescriptor> | undefined,
	right: TablePresetRegistryEntry<TDescriptor> | undefined,
): boolean {
	if (!left || !right) return left === right;
	return JSON.stringify({
		status: left.status,
		preset: left.preset,
		source: { kind: left.source.kind, path: left.source.path, requestedPath: left.source.requestedPath, bound: left.source.bound },
		conflicts: left.conflicts,
	}) === JSON.stringify({
		status: right.status,
		preset: right.preset,
		source: { kind: right.source.kind, path: right.source.path, requestedPath: right.source.requestedPath, bound: right.source.bound },
		conflicts: right.conflicts,
	});
}

function cloneSnapshot<TDescriptor extends OperonTableFileDescriptor>(snapshot: TablePresetRegistrySnapshot<TDescriptor>): TablePresetRegistrySnapshot<TDescriptor> {
	return {
		...snapshot,
		entries: new Map([...snapshot.entries].map(([id, entry]) => [id, cloneEntry(entry)!])),
		fileDiagnostics: snapshot.fileDiagnostics.map(item => ({ ...item })),
		conflicts: snapshot.conflicts.map(cloneConflict),
	};
}

function cloneEntries<TDescriptor extends OperonTableFileDescriptor>(
	entries: ReadonlyMap<string, TablePresetRegistryEntry<TDescriptor>>,
): Map<string, TablePresetRegistryEntry<TDescriptor>> {
	return new Map([...entries].map(([id, entry]) => [id, cloneEntry(entry)!]));
}

function emptySnapshot<TDescriptor extends OperonTableFileDescriptor>(): TablePresetRegistrySnapshot<TDescriptor> {
	return { revision: 0, sourceRevision: 0, entries: new Map(), fileDiagnostics: [], conflicts: [] };
}

function patchKey(presetId: string, scope: string): string {
	return `${presetId}\u0000${scope}`;
}

function writeKey<TDescriptor extends OperonTableFileDescriptor>(sourceValue: TablePresetRegistrySource<TDescriptor>): string {
	return `table-preset:${sourceValue.presetId}`;
}
