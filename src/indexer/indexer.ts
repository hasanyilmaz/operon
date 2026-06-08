/**
 * Operon task indexer.
 * Builds and maintains the in-memory task index with storage-managed persistence.
 *
 * Architecture (from Architecture doc Section 3):
 * - Unified index with three tiers: Hot (open/in-progress), Warm (completed < 90 days), Cold (completed > 90 days)
 * - Primary index: Map<operonId, IndexedTask> for O(1) lookup
 * - Full reindex on startup, incremental updates via file watcher
 * - Atomic persistence (temp-write + replace)
 *
 * Performance targets (Spec Section 17.3):
 * - Full index build (5000 tasks, 1000 files): < 3s
 * - Incremental update (1 file): < 100ms
 * - Find by operonId: < 50ms (O(1) Map lookup)
 */

import { App, TFile } from 'obsidian';
import {
	DuplicateOperonConflict,
	DuplicateRegistrySnapshot,
	IndexedTask,
	IndexedTaskInstance,
	IndexData,
	PlainCheckboxProgress,
	TaskLocation,
} from '../types/fields';
import { CheckboxState, TASK_STATS_CANONICAL_KEYS } from '../types/keys';
import { OperonStorage } from '../storage/operon-storage';
import { scanFileWithMappings, inlineLocation, yamlLocation } from './file-scanner';
import { SecondaryIndexes } from './secondary-indexes';
import { resolveWorkflowStatus } from '../types/pipeline';
import { resolveYamlTaskEffectiveTimestamps } from '../core/yaml-task-file-stat-sync';
import { isOperonExcludedPath } from '../core/operon-path-exclusions';
import {
	enginePerfLog,
	enginePerfNow,
	formatEnginePerfTraceMetadata,
	IndexPerfContext,
} from '../core/engine-perf';
import { WindowTimeoutHandle, clearWindowTimeout, setWindowTimeout } from '../core/dom-compat';
import { parseTaskStatsReadModel } from '../core/task-stats-read-model';

const WARM_THRESHOLD_DAYS = 90;
// Bump when index semantics change (e.g., scanner exclusions) so stale cache is discarded.
const INDEX_VERSION = 5;
const AGGREGATE_FIELD_PATCH_KEYS = new Set([
	'progress',
	...TASK_STATS_CANONICAL_KEYS,
	'totalDuration',
	'totalEstimate',
	'datetimeModified',
]);

export interface DescendantTaskSummary {
	total: number;
	done: number;
	cancelled: number;
	hasDescendants: boolean;
	allDone: boolean;
}

export interface IndexedTaskDelta {
	before: IndexedTask | null;
	after: IndexedTask | null;
}

export interface ReindexOptions {
	notify?: boolean;
	perfContext?: IndexPerfContext;
}

export interface AggregateFieldPatch {
	operonId: string;
	payload: Record<string, string>;
}

export interface AggregateFieldPatchOptions {
	perfContext?: IndexPerfContext;
}

function normalizePlainCheckboxProgress(
	progress: PlainCheckboxProgress | null | undefined,
): PlainCheckboxProgress | undefined {
	if (!progress) return undefined;
	const total = Number(progress.total);
	const completed = Number(progress.completed);
	if (!Number.isInteger(total) || total <= 0) return undefined;
	if (!Number.isInteger(completed) || completed < 0) return undefined;
	return {
		total,
		completed: Math.min(completed, total),
	};
}

interface PersistIndexOptions {
	immediate?: boolean;
	perfContext?: IndexPerfContext;
}

interface IndexState {
	tasks: Map<string, IndexedTask>;
	taskInstances: Map<string, IndexedTaskInstance>;
	operonIdInstances: Map<string, Set<string>>;
	duplicateConflicts: Map<string, DuplicateOperonConflict>;
	fileMtimes: Map<string, number>;
	secondary: SecondaryIndexes;
}

export class OperonIndexer {
	private app: App;
	private storage: OperonStorage;

	/** Primary index: operonId → IndexedTask */
	private tasks: Map<string, IndexedTask> = new Map();

	/** Source-level instances keyed by exact location. */
	private taskInstances: Map<string, IndexedTaskInstance> = new Map();

	/** All known instance keys per operonId. */
	private operonIdInstances: Map<string, Set<string>> = new Map();

	/** Duplicate operonId conflicts derived from taskInstances. */
	private duplicateConflicts: Map<string, DuplicateOperonConflict> = new Map();

	/** Instance keys that may temporarily share an operonId during an atomic format transition. */
	private expectedDuplicateTransitionInstances: Map<string, Map<string, number>> = new Map();

	/** File mtime cache for incremental detection */
	private fileMtimes: Map<string, number> = new Map();

	/** Secondary indexes for fast queries */
	secondary: SecondaryIndexes;

	/** Debounce timer for coalescing rapid file events */
	private reindexTimer: WindowTimeoutHandle | null = null;
	private pendingFiles: Set<string> = new Set();
	private debounceMs: number;


	/** Callback fired after every reindex completes (use to refresh views) */
	onIndexUpdated: (() => void) | null = null;
	onTasksRemoved: ((removedTasks: IndexedTask[]) => void) | null = null;
	onTasksChanged: ((changes: IndexedTaskDelta[]) => void) | null = null;

	/** ISO timestamp of when the index was last persisted (from loaded cache) */
	private lastSavedAt: number = 0;

	/** Monotonic token for caches that depend on indexed task state */
	private generation = 0;
	private pendingPersistData: IndexData | null = null;
	private pendingPersistRequestCount = 0;
	private pendingPersistContext: IndexPerfContext | null = null;
	private persistTimer: WindowTimeoutHandle | null = null;
	private readonly persistDebounceMs = 350;
	private indexOperationTail: Promise<void> = Promise.resolve();

	constructor(app: App, storage: OperonStorage) {
		this.app = app;
		this.storage = storage;
		this.secondary = new SecondaryIndexes();
		this.debounceMs = storage.getSettings().indexEventDebounceMs;
	}

	// --- Full Reindex ---

	/**
	 * Full vault reindex. Scans all .md files and builds complete index.
	 * Architecture doc Section 4.1: Target < 3s for 5000 tasks across 1000 files.
	 */
	async fullReindex(): Promise<void> {
		await this.enqueueIndexOperation(() => this.doFullReindex());
	}

	private async doFullReindex(): Promise<void> {
		const startTime = performance.now();
		const staged = this.createEmptyIndexState();

		const files = this.app.vault.getMarkdownFiles()
			.filter(file => !isOperonExcludedPath(file.path, this.storage.getSettings()));

		for (const file of files) {
			await this.indexFile(file, staged);
		}

		const secondaryStart = enginePerfNow();
		staged.secondary.rebuild(staged.tasks);
		enginePerfLog('secondary.rebuild.full', `${Math.round(enginePerfNow() - secondaryStart)}ms`, `tasks=${staged.tasks.size}`);
		this.commitIndexState(staged);
		this.generation += 1;

		const elapsed = performance.now() - startTime;
		console.debug(`Operon: Full reindex completed — ${this.tasks.size} tasks from ${files.length} files in ${elapsed.toFixed(0)}ms`);

		await this.persistIndex({ immediate: true, perfContext: { source: 'full-reindex' } });
		this.onIndexUpdated?.();
	}

	/**
	 * Load cached index from disk, then verify in background.
	 * Architecture doc Section 4.5: Load cached first (< 100ms), background verify.
	 */
	async loadCachedIndex(): Promise<boolean> {
		const data = await this.storage.loadIndex();
		if (!data || data.version !== INDEX_VERSION) return false;

		this.tasks.clear();
		this.taskInstances.clear();
		this.operonIdInstances.clear();
		this.duplicateConflicts.clear();

		if (data.taskInstances && Object.keys(data.taskInstances).length > 0) {
			for (const [instanceKey, task] of Object.entries(data.taskInstances)) {
				delete task.fieldValues['pinned'];
				this.taskInstances.set(instanceKey, {
					...task,
					instanceKey,
				});
				const instanceKeys = this.operonIdInstances.get(task.operonId) ?? new Set<string>();
				instanceKeys.add(instanceKey);
				this.operonIdInstances.set(task.operonId, instanceKeys);
			}
			for (const operonId of this.operonIdInstances.keys()) {
				this.reconcileOperonId(operonId);
			}
		} else {
			for (const [id, task] of Object.entries(data.tasks)) {
				delete task.fieldValues['pinned'];
				this.tasks.set(id, task);
				const instanceKey = this.buildInstanceKey(task.primary);
				this.taskInstances.set(instanceKey, {
					...task,
					instanceKey,
				});
				this.operonIdInstances.set(id, new Set([instanceKey]));
			}
		}

		const excludedPaths = new Set(
			Array.from(this.taskInstances.values())
				.map(task => task.primary.filePath)
				.filter(filePath => isOperonExcludedPath(filePath, this.storage.getSettings()))
		);
		for (const filePath of excludedPaths) {
			this.removeTasksByFile(filePath);
			this.fileMtimes.delete(filePath);
		}

		const secondaryStart = enginePerfNow();
		this.secondary.rebuild(this.tasks);
		enginePerfLog('secondary.rebuild.cached', `${Math.round(enginePerfNow() - secondaryStart)}ms`, `tasks=${this.tasks.size}`);
		this.lastSavedAt = data.lastFullReindex ? new Date(data.lastFullReindex).getTime() : 0;
		this.generation += 1;
		console.debug(`Operon: Loaded cached index — ${this.tasks.size} tasks`);
		return true;
	}

	/**
	 * Scan only files modified since the cache was last saved.
	 * Fast on normal restarts (few or no changed files); catches agent-written tasks.
	 */
	async diffReindex(): Promise<void> {
		await this.enqueueIndexOperation(async () => {
			if (this.lastSavedAt === 0) return; // no timestamp — skip
			const startTime = performance.now();
			const files = this.app.vault.getMarkdownFiles()
				.filter(file => !isOperonExcludedPath(file.path, this.storage.getSettings()));
			const changed = files.filter(f => f.stat.mtime > this.lastSavedAt);

			if (changed.length === 0) return;

			await this.doReindexFilesBatch(changed.map(file => file.path));
			const elapsed = performance.now() - startTime;
			console.debug(`Operon: Diff reindex completed — ${changed.length} changed files in ${elapsed.toFixed(0)}ms`);
		});
	}

	// --- Incremental Reindex ---

	/**
	 * Schedule an incremental reindex for a file.
	 * Debounces rapid events (Spec Section 9.4, Architecture doc Section 4.2).
	 */
	scheduleReindex(filePath: string): void {
		this.pendingFiles.add(filePath);

		if (this.reindexTimer) {
			clearWindowTimeout(this.reindexTimer);
		}

		this.reindexTimer = setWindowTimeout(() => {
			const files = [...this.pendingFiles];
			this.pendingFiles.clear();
			this.reindexTimer = null;

			void (async () => {
				if (files.length === 1) {
					await this.reindexFilePath(files[0]);
					return;
				}

				// Batch reindex: process all files, then notify once
				await this.reindexFilesBatch(files);
			})();
		}, this.debounceMs);
	}

	/**
	 * Reindex a single file by path.
	 * Architecture doc Section 4.2: Target < 50ms for single file.
	 */
	async reindexFilePath(filePath: string, options: ReindexOptions = {}): Promise<void> {
		await this.enqueueIndexOperation(() => this.doReindexFilePath(filePath, options));
	}

	private async doReindexFilePath(filePath: string, options: ReindexOptions = {}): Promise<void> {
		const startedAt = enginePerfNow();
		if (isOperonExcludedPath(filePath, this.storage.getSettings())) {
			const beforeById = this.snapshotTasksByFile(filePath);
			const removedTasks = this.removeTasksByFile(filePath);
			this.fileMtimes.delete(filePath);
			const deltas = this.applySecondaryDeltas(beforeById);
			this.generation += 1;
			await this.persistIndex({ perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-file-excluded') });
			this.notifyTaskChanges(deltas, options);
			if (options.notify !== false && removedTasks.length > 0) {
				this.onTasksRemoved?.(removedTasks);
			}
			if (options.notify !== false) {
				this.onIndexUpdated?.();
			}
			enginePerfLog('reindexFilePath', `${Math.round(enginePerfNow() - startedAt)}ms`, filePath);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const staged = this.createEmptyIndexState();
		let scannedIds: Set<string>;
		try {
			scannedIds = await this.indexFile(file, staged);
		} catch (error) {
			console.warn(`Operon: failed to reindex ${filePath}; keeping previous index state`, error);
			return;
		}

		const beforeById = this.snapshotTasksByFile(filePath);

		// Remove old tasks from this file
		const removedCandidates = this.removeTasksByFile(filePath);

		this.commitFileScanState(staged);

		// Update secondary indexes for affected task ids only
		const deltas = this.applySecondaryDeltas(beforeById, scannedIds);
		this.generation += 1;

		// Persist (debounced via write queue)
		await this.persistIndex({ perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-file') });
		const removedTasks = this.collectActuallyRemovedTasks(removedCandidates);
		this.notifyTaskChanges(deltas, options);
		if (options.notify !== false && removedTasks.length > 0) {
			this.onTasksRemoved?.(removedTasks);
		}

		// Notify listeners that the index has changed (e.g. refresh views)
		if (options.notify !== false) {
			this.onIndexUpdated?.();
		}
		enginePerfLog('reindexFilePath', `${Math.round(enginePerfNow() - startedAt)}ms`, filePath);
	}

	/**
	 * Batch reindex multiple files, then notify once at the end.
	 * Avoids firing onIndexUpdated per-file when many files are pending.
	 */
	async reindexFilesBatch(filePaths: string[], options: ReindexOptions = {}): Promise<void> {
		await this.enqueueIndexOperation(() => this.doReindexFilesBatch(filePaths, options));
	}

	/**
	 * Update aggregate-maintained fields in the live index without re-scanning
	 * parent files. This is intentionally limited to fields that do not affect
	 * secondary indexes.
	 */
	async commitAggregateFieldPatches(
		patches: AggregateFieldPatch[],
		options: AggregateFieldPatchOptions = {},
	): Promise<boolean> {
		return await this.enqueueIndexOperation(() => this.doCommitAggregateFieldPatches(patches, options));
	}

	private async doCommitAggregateFieldPatches(
		patches: AggregateFieldPatch[],
		options: AggregateFieldPatchOptions = {},
	): Promise<boolean> {
		if (patches.length === 0) return true;
		for (const patch of patches) {
			for (const key of Object.keys(patch.payload)) {
				if (!AGGREGATE_FIELD_PATCH_KEYS.has(key)) return false;
			}
		}

		const prepared: Array<{
			task: IndexedTask;
			instance: IndexedTaskInstance;
			payload: Record<string, string>;
			file: TFile;
		}> = [];
		for (const patch of patches) {
			const task = this.tasks.get(patch.operonId);
			if (!task) return false;
			const instance = this.taskInstances.get(this.buildInstanceKey(task.primary));
			if (!instance) return false;
			const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
			if (!(file instanceof TFile)) return false;
			prepared.push({ task, instance, payload: patch.payload, file });
		}

		for (const { task, instance, payload, file } of prepared) {
			this.applyAggregateFieldPatch(task, payload);
			this.applyAggregateFieldPatch(instance, payload);
			this.fileMtimes.set(file.path, file.stat.mtime);
		}
		this.generation += 1;
		await this.persistIndex({
			perfContext: this.resolveIndexPerfContext(options.perfContext, 'aggregate-index-patch'),
		});
		return true;
	}

	private applyAggregateFieldPatch(
		task: IndexedTask | IndexedTaskInstance,
		payload: Record<string, string>,
	): void {
		for (const [key, value] of Object.entries(payload)) {
			if (value) {
				task.fieldValues[key] = value;
			} else {
				delete task.fieldValues[key];
			}
			if (key === 'datetimeModified') {
				task.datetimeModified = value;
			}
		}
	}

	private async doReindexFilesBatch(filePaths: string[], options: ReindexOptions = {}): Promise<void> {
		const startedAt = enginePerfNow();
		const removedTasks: IndexedTask[] = [];
		const beforeById = new Map<string, IndexedTask | undefined>();
		const scannedIds = new Set<string>();
		let mutated = false;
		for (const fp of filePaths) {
			if (isOperonExcludedPath(fp, this.storage.getSettings())) {
				for (const [operonId, task] of this.snapshotTasksByFile(fp)) {
					if (!beforeById.has(operonId)) beforeById.set(operonId, task);
				}
				removedTasks.push(...this.removeTasksByFile(fp));
				this.fileMtimes.delete(fp);
				mutated = true;
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(fp);
			if (!(file instanceof TFile) || file.extension !== 'md') continue;
			const staged = this.createEmptyIndexState();
			let fileScannedIds: Set<string>;
			try {
				fileScannedIds = await this.indexFile(file, staged);
			} catch (error) {
				console.warn(`Operon: failed to reindex ${fp}; keeping previous index state`, error);
				continue;
			}
			for (const [operonId, task] of this.snapshotTasksByFile(fp)) {
				if (!beforeById.has(operonId)) beforeById.set(operonId, task);
			}
			removedTasks.push(...this.removeTasksByFile(fp));
			this.commitFileScanState(staged);
			for (const operonId of fileScannedIds) {
				scannedIds.add(operonId);
			}
			mutated = true;
		}
		if (!mutated) {
			enginePerfLog('reindexFilesBatch', `${Math.round(enginePerfNow() - startedAt)}ms`, `files=${filePaths.length}`);
			return;
		}
		const deltas = this.applySecondaryDeltas(beforeById, scannedIds);
		this.generation += 1;
		await this.persistIndex({ perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-batch') });
		const actuallyRemovedTasks = this.collectActuallyRemovedTasks(removedTasks);
		this.notifyTaskChanges(deltas, options);
		if (options.notify !== false && actuallyRemovedTasks.length > 0) {
			this.onTasksRemoved?.(actuallyRemovedTasks);
		}
		if (options.notify !== false) {
			this.onIndexUpdated?.();
		}
		enginePerfLog('reindexFilesBatch', `${Math.round(enginePerfNow() - startedAt)}ms`, `files=${filePaths.length}`);
	}

	/**
	 * Handle file deletion: remove all tasks from that file.
	 */
	async handleFileDelete(filePath: string): Promise<void> {
		await this.enqueueIndexOperation(() => this.doHandleFileDelete(filePath));
	}

	private async doHandleFileDelete(filePath: string): Promise<void> {
		const beforeById = this.snapshotTasksByFile(filePath);
		const removedTasks = this.removeTasksByFile(filePath);
		this.fileMtimes.delete(filePath);
		const deltas = this.applySecondaryDeltas(beforeById);
		this.generation += 1;
		await this.persistIndex({ perfContext: { source: 'file-delete' } });
		this.notifyTaskChanges(deltas);
		if (removedTasks.length > 0) {
			this.onTasksRemoved?.(removedTasks);
		}
	}

	/**
	 * Handle file rename: update all task locations and ensure pending reindex
	 * targets the new path. Also schedules a fresh reindex so file content
	 * (which may have changed before the move) is re-read at the new location.
	 */
	handleFileRename(oldPath: string, newPath: string): void {
		void this.enqueueIndexOperation(() => this.doHandleFileRename(oldPath, newPath));
	}

	private async doHandleFileRename(oldPath: string, newPath: string): Promise<void> {
		const beforeById = this.snapshotTasksByFile(oldPath);
		const movedInstances = Array.from(this.taskInstances.values())
			.filter(task => task.primary.filePath === oldPath);
		const affectedOperonIds = new Set<string>();

		for (const task of movedInstances) {
			const oldKey = task.instanceKey;
			const nextPrimary = {
				...task.primary,
				filePath: newPath,
			};
			const newKey = this.buildInstanceKey(nextPrimary);
			this.taskInstances.delete(oldKey);
			this.taskInstances.set(newKey, {
				...task,
				instanceKey: newKey,
				primary: nextPrimary,
			});
			const instanceKeys = this.operonIdInstances.get(task.operonId);
			if (instanceKeys) {
				instanceKeys.delete(oldKey);
				instanceKeys.add(newKey);
			}
			affectedOperonIds.add(task.operonId);
		}

		// Migrate any pending reindex from old path → new path
		if (this.pendingFiles.has(oldPath)) {
			this.pendingFiles.delete(oldPath);
			this.pendingFiles.add(newPath);
		}

		this.fileMtimes.delete(oldPath);
		this.fileMtimes.delete(newPath);

		for (const operonId of affectedOperonIds) {
			this.reconcileOperonId(operonId);
		}
		this.applySecondaryDeltas(beforeById, affectedOperonIds);
		this.generation += 1;
		await this.persistIndex({ perfContext: { source: 'file-rename' } });

		// Notify views immediately so filter/editor show updated path
		this.onIndexUpdated?.();

		// Schedule a reindex of the new path so fresh content is re-read
		// (the file may have been modified before the move — e.g., status change
		// triggered the rename via FileTransport)
		this.scheduleReindex(newPath);
	}

	// --- Internal Indexing ---

	/**
	 * Index a single file: scan for tasks and merge into primary index.
	 */
	private async indexFile(file: TFile, state: IndexState = this.getLiveIndexState()): Promise<Set<string>> {
		const scannedIds = new Set<string>();
		if (isOperonExcludedPath(file.path, this.storage.getSettings())) {
			state.fileMtimes.delete(file.path);
			return scannedIds;
		}

		const keyMappings = this.storage.getSettings().keyMappings;
		const reverseMap = new Map<string, string>();
		for (const mapping of keyMappings) {
			if (!mapping.visiblePropertyName) continue;
			reverseMap.set(mapping.visiblePropertyName, mapping.canonicalKey);
		}

		const result = await scanFileWithMappings(this.app, file, keyMappings);
		state.fileMtimes.set(file.path, result.mtime);

		// Process inline tasks
		for (const parsed of result.inlineTasks) {
			if (!parsed.operonId) continue;
			scannedIds.add(parsed.operonId);

			const location = inlineLocation(parsed.filePath, parsed.lineNumber);
			const fieldValues: Record<string, string> = {};
			const inlineTags = new Set(parsed.tags.map(tag => tag.trim()).filter(Boolean));
			for (const f of parsed.fields) {
				const canonicalKey = reverseMap.get(f.key) ?? f.key;
				if (canonicalKey === 'pinned') continue;
				if (canonicalKey === 'tags') {
					for (const tag of f.value.split(/[;,]/)) {
						const cleaned = tag.trim().replace(/^#/, '');
						if (cleaned) inlineTags.add(cleaned);
					}
					continue;
				}
				fieldValues[canonicalKey] = f.value;
			}
			const workflowState = resolveWorkflowStatus(this.storage.getSettings().pipelines, fieldValues['status']);
			let checkbox = parsed.checkbox;
			if (workflowState?.checkbox === 'done' || workflowState?.checkbox === 'cancelled') {
				checkbox = workflowState.checkbox;
			} else if (fieldValues['dateCancelled']) {
				checkbox = 'cancelled';
			} else if (fieldValues['dateCompleted']) {
				checkbox = 'done';
			} else if (workflowState) {
				checkbox = 'open';
			}

				this.mergeTaskInstance(parsed.operonId, {
					description: parsed.description,
					checkbox,
					fieldValues,
					tags: Array.from(inlineTags),
					location,
					datetimeModified: fieldValues['datetimeModified'] ?? '',
					plainCheckboxProgress: normalizePlainCheckboxProgress(result.plainCheckboxProgress.byInlineTaskId[parsed.operonId]),
				}, state);
		}

		// Process YAML task
		if (result.yamlTask) {
			scannedIds.add(result.yamlTask.operonId);
			const location = yamlLocation(result.yamlTask.filePath);
			const fv = { ...result.yamlTask.fieldValues };
			const effectiveTimestamps = resolveYamlTaskEffectiveTimestamps({
				storedCreated: fv['datetimeCreated'] ?? '',
				storedModified: fv['datetimeModified'] ?? '',
				mtime: file.stat.mtime,
				ctime: file.stat.ctime,
			});
			if (effectiveTimestamps.datetimeCreated) {
				fv['datetimeCreated'] = effectiveTimestamps.datetimeCreated;
			}
			if (effectiveTimestamps.datetimeModified) {
				fv['datetimeModified'] = effectiveTimestamps.datetimeModified;
			}

			// If workflow status resolves, it is the semantic source of truth.
			const workflowState = resolveWorkflowStatus(this.storage.getSettings().pipelines, fv['status']);
			let checkbox: CheckboxState = 'open';
			if (workflowState?.checkbox === 'done' || workflowState?.checkbox === 'cancelled') {
				checkbox = workflowState.checkbox;
			} else if (fv['dateCancelled']) {
				checkbox = 'cancelled';
			} else if (fv['dateCompleted']) {
				checkbox = 'done';
			}

				this.mergeTaskInstance(result.yamlTask.operonId, {
					description: result.yamlTask.description,
					checkbox,
					fieldValues: fv,
					tags: result.yamlTask.tags,
					location,
					datetimeModified: effectiveTimestamps.datetimeModified,
					plainCheckboxProgress: normalizePlainCheckboxProgress(result.plainCheckboxProgress.file),
				}, state);
			}
			return scannedIds;
		}

	/**
	 * Add or update a task in the primary index.
	 * If task already exists (same operonId from another scan pass), update with latest data.
	 */
	private mergeTaskInstance(operonId: string, data: {
		description: string;
		checkbox: CheckboxState;
		fieldValues: Record<string, string>;
		tags: string[];
		location: TaskLocation;
		datetimeModified: string;
		plainCheckboxProgress?: PlainCheckboxProgress;
	}, state: IndexState = this.getLiveIndexState()): void {
		const instanceKey = this.buildInstanceKey(data.location);
		const sanitizedFieldValues = { ...data.fieldValues };
		delete sanitizedFieldValues['pinned'];
		state.taskInstances.set(instanceKey, {
			instanceKey,
			operonId,
			description: data.description,
			checkbox: data.checkbox,
			fieldValues: sanitizedFieldValues,
			tags: data.tags,
			primary: data.location,
			datetimeModified: data.datetimeModified,
			tier: this.computeTier(data.checkbox, sanitizedFieldValues),
			plainCheckboxProgress: data.plainCheckboxProgress,
		});
		const instanceKeys = state.operonIdInstances.get(operonId) ?? new Set<string>();
		instanceKeys.add(instanceKey);
		state.operonIdInstances.set(operonId, instanceKeys);
		this.reconcileOperonId(operonId, state);
	}

	/**
	 * Compute index tier for a task.
	 * Architecture doc Section 3.2: Hot/Warm/Cold tiered storage.
	 *
	 * Hot: open + in-progress tasks (default query scope, full fields)
	 * Warm: completed < 90 days (project progress, full fields)
	 * Cold: completed > 90 days (historical, compressed fields)
	 */
	private computeTier(
		checkbox: CheckboxState,
		fieldValues: Record<string, string>
	): 'hot' | 'warm' | 'cold' {
		if (checkbox === 'open') return 'hot';

		// Check completion/cancellation date for warm vs cold
		const completedDate = fieldValues['dateCompleted'] || fieldValues['dateCancelled'];
		if (!completedDate) return 'warm'; // Completed but no date — treat as warm

		const completed = new Date(completedDate);
		const now = new Date();
		const daysSince = (now.getTime() - completed.getTime()) / (1000 * 60 * 60 * 24);

		return daysSince <= WARM_THRESHOLD_DAYS ? 'warm' : 'cold';
	}

	/**
	 * Remove all tasks from a specific file.
	 */
	private removeTasksByFile(filePath: string, state: IndexState = this.getLiveIndexState()): IndexedTask[] {
		const removedTasks: IndexedTask[] = [];
		const affectedOperonIds = new Set<string>();
		for (const [instanceKey, task] of state.taskInstances) {
			if (task.primary.filePath !== filePath) continue;
			removedTasks.push(this.stripInstance(task));
			state.taskInstances.delete(instanceKey);
			const instanceKeys = state.operonIdInstances.get(task.operonId);
			if (instanceKeys) {
				instanceKeys.delete(instanceKey);
				if (instanceKeys.size === 0) {
					state.operonIdInstances.delete(task.operonId);
				}
			}
			affectedOperonIds.add(task.operonId);
		}
		for (const operonId of affectedOperonIds) {
			this.reconcileOperonId(operonId, state);
		}
		return removedTasks;
	}

	private collectActuallyRemovedTasks(candidates: IndexedTask[]): IndexedTask[] {
		const removedTasks: IndexedTask[] = [];
		const seen = new Set<string>();
		for (const task of candidates) {
			if (this.tasks.has(task.operonId)) continue;
			if (seen.has(task.operonId)) continue;
			seen.add(task.operonId);
			removedTasks.push(task);
		}
		return removedTasks;
	}

	private createEmptyIndexState(): IndexState {
		return {
			tasks: new Map(),
			taskInstances: new Map(),
			operonIdInstances: new Map(),
			duplicateConflicts: new Map(),
			fileMtimes: new Map(),
			secondary: new SecondaryIndexes(),
		};
	}

	private getLiveIndexState(): IndexState {
		return {
			tasks: this.tasks,
			taskInstances: this.taskInstances,
			operonIdInstances: this.operonIdInstances,
			duplicateConflicts: this.duplicateConflicts,
			fileMtimes: this.fileMtimes,
			secondary: this.secondary,
		};
	}

	private commitIndexState(state: IndexState): void {
		this.tasks = state.tasks;
		this.taskInstances = state.taskInstances;
		this.operonIdInstances = state.operonIdInstances;
		this.duplicateConflicts = state.duplicateConflicts;
		this.fileMtimes = state.fileMtimes;
		this.secondary = state.secondary;
	}

	private commitFileScanState(state: IndexState): void {
		for (const task of state.taskInstances.values()) {
			this.insertTaskInstance(task);
		}
		for (const [filePath, mtime] of state.fileMtimes) {
			this.fileMtimes.set(filePath, mtime);
		}
	}

	private insertTaskInstance(task: IndexedTaskInstance, state: IndexState = this.getLiveIndexState()): void {
		state.taskInstances.set(task.instanceKey, {
			...task,
			fieldValues: { ...task.fieldValues },
			tags: [...task.tags],
			primary: { ...task.primary },
			plainCheckboxProgress: normalizePlainCheckboxProgress(task.plainCheckboxProgress),
		});
		const instanceKeys = state.operonIdInstances.get(task.operonId) ?? new Set<string>();
		instanceKeys.add(task.instanceKey);
		state.operonIdInstances.set(task.operonId, instanceKeys);
		this.reconcileOperonId(task.operonId, state);
	}

	// --- Persistence ---

	/**
	 * Persist current index through the storage runtime index contract.
	 * Uses atomic write via storage write queue.
	 */
	private async persistIndex(options: PersistIndexOptions = {}): Promise<void> {
		const data: IndexData = {
			version: INDEX_VERSION,
			lastFullReindex: new Date().toISOString(),
			tasks: Object.fromEntries(this.tasks),
			taskInstances: Object.fromEntries(this.taskInstances),
		};
		const perfContext = this.resolveIndexPerfContext(options.perfContext, 'index-update');
		if (options.immediate) {
			await this.flushPersistData(data, perfContext, 1);
			return;
		}
		this.pendingPersistData = data;
		this.pendingPersistRequestCount++;
		this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
		if (this.persistTimer) return;
		this.persistTimer = setWindowTimeout(() => {
			this.persistTimer = null;
			void this.flushPendingPersist();
		}, this.persistDebounceMs);
	}

	async flushPendingPersist(): Promise<void> {
		if (this.persistTimer) {
			clearWindowTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		const data = this.pendingPersistData;
		const requestCount = this.pendingPersistRequestCount;
		const perfContext = this.pendingPersistContext ?? { source: 'index-update' };
		this.pendingPersistData = null;
		this.pendingPersistRequestCount = 0;
		this.pendingPersistContext = null;
		if (!data) return;
		await this.flushPersistData(data, perfContext, Math.max(1, requestCount));
	}

	private async flushPersistData(
		data: IndexData,
		perfContext: IndexPerfContext,
		requestCount: number,
	): Promise<void> {
		const metrics = (await this.storage.saveIndex(data)) ?? {
			jsonBytes: 0,
			stringifyMs: 0,
			writeMs: 0,
			queueWaitMs: 0,
			totalMs: 0,
		};
		this.lastSavedAt = data.lastFullReindex ? new Date(data.lastFullReindex).getTime() : Date.now();
		const totalMs = Math.round(metrics.totalMs);
		const stringifyMs = Math.round(metrics.stringifyMs);
		const writeMs = Math.round(metrics.writeMs);
		const queueWaitMs = Math.round(metrics.queueWaitMs);
		const slow = totalMs >= 100 || writeMs >= 100 || queueWaitMs >= 100;
		enginePerfLog(
			'persistIndex',
			`${totalMs}ms`,
			`source=${perfContext.source}`,
			`requestCount=${requestCount}`,
			...formatEnginePerfTraceMetadata(perfContext.trace),
			`tasks=${Object.keys(data.tasks).length}`,
			`taskInstances=${Object.keys(data.taskInstances ?? {}).length}`,
			`jsonBytes=${metrics.jsonBytes}`,
			`stringifyMs=${stringifyMs}`,
			`writeMs=${writeMs}`,
			`queueWaitMs=${queueWaitMs}`,
			`totalMs=${totalMs}`,
			`slow=${String(slow)}`,
		);
	}

	private resolveIndexPerfContext(
		perfContext: IndexPerfContext | null | undefined,
		fallbackSource: string,
	): IndexPerfContext {
		if (!perfContext) return { source: fallbackSource };
		return {
			source: perfContext.source || fallbackSource,
			trace: perfContext.trace ?? null,
		};
	}

	private mergeIndexPerfContexts(
		current: IndexPerfContext | null,
		next: IndexPerfContext,
	): IndexPerfContext {
		if (!current) return next;
		return {
			source: current.source === next.source ? current.source : 'mixed',
			trace: next.trace ?? current.trace ?? null,
		};
	}

	// --- Query API ---

	/** Get task by operonId. O(1) lookup. */
	getTask(operonId: string): IndexedTask | undefined {
		return this.tasks.get(operonId);
	}

	getTaskInstance(instanceKey: string): IndexedTaskInstance | undefined {
		return this.taskInstances.get(instanceKey);
	}

	/** Get the YAML/file task whose primary file path matches the given path. */
	getFileTaskByPath(filePath: string): IndexedTask | undefined {
		const candidates = this.secondary.getTasksInFile(filePath);
		for (const operonId of candidates) {
			const task = this.tasks.get(operonId);
			if (!task) continue;
			if (task.primary.format === 'yaml' && task.primary.filePath === filePath) {
				return task;
			}
		}
		return undefined;
	}

	getDescendantTaskSummary(operonId: string): DescendantTaskSummary {
		const parentTask = this.tasks.get(operonId);
		const stats = parentTask ? parseTaskStatsReadModel(parentTask.fieldValues) : null;
		if (stats) {
			const total = stats.tree.effective;
			const done = stats.tree.done;
			return {
				total,
				done,
				cancelled: stats.tree.cancelled,
				hasDescendants: total > 0,
				allDone: total > 0 && done === total,
			};
		}

		let total = 0;
		let done = 0;
		let cancelled = 0;

		for (const descendantId of this.secondary.getAllDescendantIds(operonId)) {
			const task = this.tasks.get(descendantId);
			if (!task) continue;

			if (task.checkbox === 'cancelled') {
				cancelled += 1;
				continue;
			}

			total += 1;
			if (task.checkbox === 'done') {
				done += 1;
			}
		}

		return {
			total,
			done,
			cancelled,
			hasDescendants: total > 0,
			allDone: total > 0 && done === total,
		};
	}

	/** Get all tasks as an array. */
	getAllTasks(): IndexedTask[] {
		return Array.from(this.tasks.values());
	}

	getDuplicateRegistry(): DuplicateRegistrySnapshot {
		const conflicts = Array.from(this.duplicateConflicts.values())
			.map(conflict => ({
				...conflict,
				instances: conflict.instances.map(instance => ({ ...instance })),
			}))
			.sort((left, right) => left.operonId.localeCompare(right.operonId));
		return {
			conflicts,
			revision: this.generation,
			totalConflictCount: conflicts.length,
		};
	}

	getDuplicateConflict(operonId: string): DuplicateOperonConflict | null {
		const conflict = this.duplicateConflicts.get(operonId);
		return conflict
			? {
				...conflict,
				instances: conflict.instances.map(instance => ({ ...instance })),
			}
			: null;
	}

	hasDuplicateOperonIdConflict(operonId: string): boolean {
		return this.duplicateConflicts.has(operonId);
	}

	beginExpectedDuplicateOperonIdTransition(operonId: string, locations: TaskLocation[]): () => void {
		const normalizedOperonId = operonId.trim();
		if (!normalizedOperonId || locations.length === 0) return () => {};

		const instanceKeys = locations.map(location => this.buildInstanceKey(location));
		const counts = this.expectedDuplicateTransitionInstances.get(normalizedOperonId) ?? new Map<string, number>();
		for (const instanceKey of instanceKeys) {
			counts.set(instanceKey, (counts.get(instanceKey) ?? 0) + 1);
		}
		this.expectedDuplicateTransitionInstances.set(normalizedOperonId, counts);
		this.reconcileOperonId(normalizedOperonId);

		let released = false;
		return () => {
			if (released) return;
			released = true;
			const activeCounts = this.expectedDuplicateTransitionInstances.get(normalizedOperonId);
			if (!activeCounts) return;
			for (const instanceKey of instanceKeys) {
				const nextCount = (activeCounts.get(instanceKey) ?? 0) - 1;
				if (nextCount > 0) {
					activeCounts.set(instanceKey, nextCount);
				} else {
					activeCounts.delete(instanceKey);
				}
			}
			if (activeCounts.size === 0) {
				this.expectedDuplicateTransitionInstances.delete(normalizedOperonId);
			}
			this.reconcileOperonId(normalizedOperonId);
		};
	}

	getGeneration(): number {
		return this.generation;
	}

	/** Get all hot-tier tasks (open/in-progress). */
	getHotTasks(): IndexedTask[] {
		return this.getAllTasks().filter(t => t.tier === 'hot');
	}

	/** Get hot + warm tasks (open + recently completed). */
	getActiveAndRecentTasks(): IndexedTask[] {
		return this.getAllTasks().filter(t => t.tier !== 'cold');
	}

	/** Get total task count. */
	get taskCount(): number {
		return this.tasks.size;
	}

	/** Get set of all known operonIds (for ID collision checks). */
	getAllOperonIds(): Set<string> {
		return new Set(this.tasks.keys());
	}

	// --- Cleanup ---

	destroy(): void {
		if (this.reindexTimer) {
			clearWindowTimeout(this.reindexTimer);
			this.reindexTimer = null;
		}
		if (this.persistTimer) {
			clearWindowTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.pendingFiles.clear();
	}

	private snapshotTasksByFile(filePath: string): Map<string, IndexedTask | undefined> {
		const snapshot = new Map<string, IndexedTask | undefined>();
		for (const operonId of this.secondary.getTasksInFile(filePath)) {
			snapshot.set(operonId, this.tasks.get(operonId));
		}
		return snapshot;
	}

	private applySecondaryDeltas(
		beforeById: Map<string, IndexedTask | undefined>,
		additionalAffectedIds: Iterable<string> = [],
	): IndexedTaskDelta[] {
		const affectedIds = new Set<string>(beforeById.keys());
		for (const operonId of additionalAffectedIds) {
			affectedIds.add(operonId);
		}

		const deltas: IndexedTaskDelta[] = [];
		for (const operonId of affectedIds) {
			const before = beforeById.get(operonId) ?? null;
			const after = this.tasks.get(operonId) ?? null;
			if (before === after) continue;
			deltas.push({ before, after });
		}

		const startedAt = enginePerfNow();
		this.secondary.applyTaskDeltas(deltas.map(delta => ({
			before: delta.before ?? undefined,
			after: delta.after ?? undefined,
		})));
		enginePerfLog(
			'secondary.applyDeltas',
			`${Math.round(enginePerfNow() - startedAt)}ms`,
			`deltas=${deltas.length}`,
		);
		return deltas;
	}

	private notifyTaskChanges(deltas: IndexedTaskDelta[], options: ReindexOptions = {}): void {
		if (options.notify === false || !this.onTasksChanged) return;
		const changes = deltas.filter(delta => !!delta.after);
		if (changes.length === 0) return;
		this.onTasksChanged(changes);
	}

	private buildInstanceKey(location: TaskLocation): string {
		return `${location.format}:${location.filePath}:${location.lineNumber}`;
	}

	private stripInstance(task: IndexedTaskInstance): IndexedTask {
		const indexedTask: IndexedTask = { ...task };
		delete (indexedTask as { instanceKey?: string }).instanceKey;
		return indexedTask;
	}

	private async enqueueIndexOperation<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.indexOperationTail;
		let result: T;
		const next = previous.then(async () => {
			result = await operation();
		});
		this.indexOperationTail = next.catch(() => {});
		await next;
		return result!;
	}

	private reconcileOperonId(operonId: string, state: IndexState = this.getLiveIndexState()): void {
		const instanceKeys = state.operonIdInstances.get(operonId);
		if (!instanceKeys || instanceKeys.size === 0) {
			state.tasks.delete(operonId);
			state.duplicateConflicts.delete(operonId);
			return;
		}

		const instances = Array.from(instanceKeys)
			.map(instanceKey => state.taskInstances.get(instanceKey))
			.filter((task): task is IndexedTaskInstance => !!task);
		if (instances.length === 0) {
			state.tasks.delete(operonId);
			state.duplicateConflicts.delete(operonId);
			state.operonIdInstances.delete(operonId);
			return;
		}

		const previousCanonicalKey = state.duplicateConflicts.get(operonId)?.canonicalInstanceKey
			?? this.buildInstanceKey(state.tasks.get(operonId)?.primary ?? instances[0].primary);
		const canonical = instances.find(task => task.instanceKey === previousCanonicalKey)
			?? [...instances].sort((left, right) => left.instanceKey.localeCompare(right.instanceKey))[0];
		state.tasks.set(operonId, this.stripInstance(canonical));

		if (instances.length <= 1) {
			state.duplicateConflicts.delete(operonId);
			return;
		}

		if (this.isExpectedDuplicateTransitionConflict(operonId, instances)) {
			state.duplicateConflicts.delete(operonId);
			return;
		}

		const existingConflict = state.duplicateConflicts.get(operonId);
		const now = new Date().toISOString();
		const sortedInstances = [...instances].sort((left, right) => {
			const timeCompare = (right.datetimeModified ?? '').localeCompare(left.datetimeModified ?? '');
			if (timeCompare !== 0) return timeCompare;
			return left.instanceKey.localeCompare(right.instanceKey);
		});
		console.warn(
			`[Operon] Duplicate operonId "${operonId}" detected in ${sortedInstances.length} copies:\n` +
			sortedInstances
				.map(instance => `  - ${instance.primary.filePath}:${instance.primary.lineNumber}`)
				.join('\n')
		);
		state.duplicateConflicts.set(operonId, {
			operonId,
			instances: sortedInstances,
			detectedAt: existingConflict?.detectedAt ?? now,
			updatedAt: now,
			canonicalInstanceKey: canonical.instanceKey,
		});
	}

	private isExpectedDuplicateTransitionConflict(
		operonId: string,
		instances: IndexedTaskInstance[],
	): boolean {
		const expectedInstanceCounts = this.expectedDuplicateTransitionInstances.get(operonId);
		if (!expectedInstanceCounts) return false;
		return instances.every(instance => (expectedInstanceCounts.get(instance.instanceKey) ?? 0) > 0);
	}
}
