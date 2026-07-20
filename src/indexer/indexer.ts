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
import type { KeyMapping, OperonSettings } from '../types/settings';
import { OperonStorage, type IndexV8RecoveryMarkerStatus } from '../storage/operon-storage';
import { scanFileWithMappings, inlineLocation, yamlLocation } from './file-scanner';
import { SecondaryIndexes } from './secondary-indexes';
import { clonePipeline, Pipeline, resolveWorkflowStatus } from '../types/pipeline';
import { resolveYamlTaskEffectiveTimestamps } from '../core/yaml-task-file-stat-sync';
import { isOperonExcludedPath } from '../core/operon-path-exclusions';
import {
	enginePerfLog,
	enginePerfNow,
	formatEnginePerfTraceMetadata,
	IndexPerfContext,
	isOperonEnginePerfDebugEnabled,
} from '../core/engine-perf';
import { WindowTimeoutHandle, clearWindowTimeout, setWindowTimeout } from '../core/dom-compat';
import { parseTaskStatsReadModel } from '../core/task-stats-read-model';
import { isManagedTaskFieldCanonicalKey } from '../core/managed-task-fields';
import { getManagedYamlAliases } from '../core/yaml-fields';
import { buildWorkflowStatusSemanticsSignature } from '../core/workflow-status-semantics';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import { computeIndexTier } from './index-tier';
import { buildIndexV8SemanticsSignature } from './persistence/index-v8-semantics';
import type { IndexV8CoherenceBasis } from './persistence/index-v8-contract';
import {
	IndexV8ShadowWriter,
	sealIndexData,
	type IndexV8ShadowInput,
	type IndexV8RuntimePhase,
} from './persistence/index-v8-shadow-writer';
import {
	IndexV8StorageError,
	type IndexV8CleanupPlan,
	type IndexV8CleanupResult,
	type IndexV8MaintenanceDiagnostics,
	type IndexV7RetirementPlan,
	type IndexV7RetirementResult,
	type IndexV8CanonicalResetPlan,
	type IndexV8CanonicalResetResult,
	type IndexV8LoadResult,
} from './persistence/index-v8-store';
import {
	prepareIndexV8Startup,
	type IndexV8FallbackReason,
} from './persistence/index-v8-startup';
import {
	IndexV8CodecError,
	buildIndexV8Snapshot,
	getIndexV8CanonicalInstanceKeys,
	projectIndexDataToV8Sources,
	type IndexV8SourceStat,
} from './persistence/index-v8-codec';
import {
	IndexV8ParityError,
	projectIndexV8IncrementalParity,
} from './persistence/index-v8-parity';
import { IndexV8IncrementalCompileError } from './persistence/index-v8-incremental-compiler';
import {
	getIndexV8ShardId,
	normalizeIndexV8SourcePath,
} from './persistence/index-v8-partition';
import type { IndexV8ShardId } from './persistence/index-v8-contract';

declare global {
	interface Window {
		operonIndexV8ReadEnabled?: boolean;
	}
}

// Bump when index semantics change (e.g., scanner exclusions) so stale cache is discarded.
const INDEX_VERSION = 7;
// The final bounded confirmation allows a snapshot that first becomes complete
// at the 7-second probe to prove stability without exceeding ~15 seconds.
const INDEX_V8_SETTLE_DELAYS_MS = [1_000, 3_000, 7_000, 3_000] as const;
const INDEX_V8_MARKDOWN_QUIET_MS = 2_000;
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

export type IndexReconciliationEvent =
	| { kind: 'full'; generation: number }
	| { kind: 'incremental'; generation: number; affectedOperonIds: string[] };

export interface ReindexOptions {
	notify?: boolean;
	perfContext?: IndexPerfContext;
}

export type CachedIndexLoadResult =
	| {
		status: 'loaded';
		source: 'v8';
		requiresFullReindex: boolean;
		fallbackReason?: IndexV8FallbackReason;
	}
	| { status: 'missing'; fallbackReason?: IndexV8FallbackReason }
	| {
		status: 'incompatible';
		reason: 'version';
		expectedVersion: number;
		cachedVersion: number | null;
	}
	| {
		status: 'incompatible';
		reason: 'workflow-semantics';
		expectedSignature: string;
		cachedSignature: string | null;
	}
	| {
		status: 'incompatible';
		reason: 'index-semantics';
		expectedSignature: string;
		cachedSignature: string;
	};

export interface IndexV8ReadStore {
	load(): Promise<IndexV8LoadResult>;
	planCleanup?(): Promise<IndexV8CleanupPlan>;
	applyCleanup?(plan: IndexV8CleanupPlan): Promise<IndexV8CleanupResult>;
	diagnoseMaintenance?(): Promise<IndexV8MaintenanceDiagnostics>;
	planLegacyIndexV7Retirement?(): Promise<IndexV7RetirementPlan>;
	applyLegacyIndexV7Retirement?(plan: IndexV7RetirementPlan): Promise<IndexV7RetirementResult>;
	planCanonicalV8Reset?(
		desiredShardPayloads?: ReadonlyMap<IndexV8ShardId, string>,
	): Promise<IndexV8CanonicalResetPlan>;
	applyCanonicalV8Reset?(plan: IndexV8CanonicalResetPlan): Promise<IndexV8CanonicalResetResult>;
}

export type IndexV8HealthState =
	| 'healthy'
	| 'recovery-required'
	| 'sync-settling'
	| 'incomplete'
	| 'invalid'
	| 'unsupported'
	| 'missing';

export interface IndexV8DiagnosticSnapshot {
	health: IndexV8HealthState;
	runtimePhase: IndexV8RuntimePhase;
	verifiedThisSession: boolean;
	taskCount: number;
	sourceCount: number;
	activeShardCount: number;
	protectedShardCount: number;
	activeBytes: number;
	maxShardBytes: number;
	averageShardBytes: number;
	maintenanceCounts: Record<string, number>;
	maintenanceBytes: Record<string, number>;
	cleanupCandidateCount: number;
	cleanupCandidateBytes: number;
	recoveryMarkerPresent: boolean;
	legacyV7: { present: boolean; bytes: number; retirementEligible: boolean };
	manifestStatus: IndexV8LoadResult['status'];
	dirtySourceCount: number;
	codes: string[];
}

export interface IndexV8RecoveryScheduler {
	now(): number;
	delay(delayMs: number): Promise<void>;
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

function compareDuplicateInstances(left: IndexedTaskInstance, right: IndexedTaskInstance): number {
	const timeCompare = (right.datetimeModified ?? '').localeCompare(left.datetimeModified ?? '');
	return timeCompare !== 0 ? timeCompare : left.instanceKey.localeCompare(right.instanceKey);
}

function isIndexV8ReadEnabled(): boolean {
	return typeof window === 'undefined' || window.operonIndexV8ReadEnabled !== false;
}

interface PersistIndexOptions {
	immediate?: boolean;
	shadowImmediate?: boolean;
	coherenceBasis?: IndexV8CoherenceBasis;
	dirtySourcePaths?: Iterable<string>;
	affectedOperonIds?: Iterable<string>;
	forceFull?: boolean;
	perfContext?: IndexPerfContext;
}

export interface IndexV8DirtyBatch {
	sequence: number;
	dirtySourcePaths: ReadonlySet<string>;
	affectedOperonIds: ReadonlySet<string>;
	forceFull: boolean;
}

interface PendingIndexPersistenceSnapshot {
	input: IndexV8ShadowInput;
	dirty: IndexV8DirtyBatch;
	shadowImmediate: boolean;
	retryCount: 0 | 1;
}

interface IndexState {
	tasks: Map<string, IndexedTask>;
	taskInstances: Map<string, IndexedTaskInstance>;
	operonIdInstances: Map<string, Set<string>>;
	duplicateConflicts: Map<string, DuplicateOperonConflict>;
	fileMtimes: Map<string, number>;
	fileSizes: Map<string, number>;
	sourceInstanceKeys: Map<string, Set<string>>;
	sourcePathsByShard: Map<IndexV8ShardId, Set<string>>;
	secondary: SecondaryIndexes;
}

interface FullIndexBuild {
	state: IndexState;
	workflowStatusSemanticsSignature: string;
	indexV8SemanticsSignature: string;
	fileCount: number;
	setupMs: number;
	enumerateMs: number;
	scanMs: number;
	secondaryMs: number;
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
	private fileSizes: Map<string, number> = new Map();
	/** Rebuildable persistence indexes; values reference taskInstances rather than copying tasks. */
	private sourceInstanceKeys: Map<string, Set<string>> = new Map();
	private sourcePathsByShard: Map<IndexV8ShardId, Set<string>> = new Map();

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
	private readonly reconciliationListeners = new Set<(event: IndexReconciliationEvent) => void>();

	/** ISO timestamp of when the index was last persisted (from loaded cache) */
	private lastSavedAt: number = 0;

	/** Monotonic token for caches that depend on indexed task state */
	private generation = 0;
	private pendingPersistData: PendingIndexPersistenceSnapshot | null = null;
	private pendingPersistRequestCount = 0;
	private pendingPersistContext: IndexPerfContext | null = null;
	private persistTimer: WindowTimeoutHandle | null = null;
	private persistRetryScheduled = false;
	private readonly persistDebounceMs = 350;
	private indexOperationTail: Promise<void> = Promise.resolve();
	private coherentWorkflowStatusSemanticsSignature: string | null = null;
	private coherentIndexV8SemanticsSignature: string | null = null;
	private persistenceSequence = 0;
	private lastDurableCommittedAt = '';
	private lastFullScanAt = '';
	private coherenceBasis: IndexV8CoherenceBasis = 'v7-startup-seed';
	private startupV8SourceStats: Map<string, IndexV8SourceStat> | null = null;
	private startupV8CommittedAtMs = 0;
	private shuttingDown = false;
	private recoveryRequired = false;
	private lastMarkdownEventAt = 0;
	private syncRecovery: Promise<void> | null = null;
	private recoveryPersistAllowed = false;

	constructor(
		app: App,
		storage: OperonStorage,
		private readonly indexV8ShadowWriter: IndexV8ShadowWriter | null = null,
		private readonly indexV8Store: IndexV8ReadStore | null = null,
		private readonly indexV8RecoveryScheduler: IndexV8RecoveryScheduler = {
			now: () => Date.now(),
			delay: delayMs => new Promise(resolve => setWindowTimeout(resolve, delayMs)),
		},
	) {
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
		if (this.shuttingDown) return;
		await this.enqueueIndexOperation(() => this.doFullReindex());
	}

	getIndexV8RuntimePhase(): IndexV8RuntimePhase {
		return this.indexV8ShadowWriter?.getRuntimePhase?.() ?? (this.recoveryRequired ? 'recovery-required' : 'idle');
	}

	/** Stat-gated monitor entry point. A changed stat is validated before recovery starts. */
	async observeIndexV8ManifestChange(): Promise<void> {
		if (!this.indexV8Store || !this.indexV8ShadowWriter || this.shuttingDown || this.recoveryRequired) return;
		const loaded = await this.indexV8Store.load();
		if (loaded.status === 'loaded' && this.indexV8ShadowWriter.isVerifiedBaseline?.(loaded.manifestPayload)) return;
		if (loaded.status === 'invalid' || loaded.status === 'unsupported') {
			await this.enterCurrentStateRecoveryRequired(loaded.code);
			return;
		}
		await this.requestIndexV8SyncRecovery(`manifest-${loaded.status}`);
	}

	recoverStartupV8IfNeeded(reason?: IndexV8FallbackReason): void {
		if (reason === 'incomplete' || reason === 'io-error') {
			void this.requestIndexV8SyncRecovery(`startup-${reason}`);
		}
	}

	private async doFullReindex(): Promise<void> {
		const startTime = enginePerfNow();
		const built = await this.buildFullIndexState();
		const {
			state: staged,
			workflowStatusSemanticsSignature,
			indexV8SemanticsSignature,
			fileCount,
			setupMs,
			enumerateMs,
			scanMs,
			secondaryMs,
		} = built;
		const commitStartedAt = enginePerfNow();
		this.commitIndexState(staged);
		this.coherentWorkflowStatusSemanticsSignature = workflowStatusSemanticsSignature;
		this.coherentIndexV8SemanticsSignature = indexV8SemanticsSignature;
		this.lastFullScanAt = new Date().toISOString();
		this.coherenceBasis = 'verified-full-scan';
		this.generation += 1;
		const commitMs = enginePerfNow() - commitStartedAt;

		const elapsed = enginePerfNow() - startTime;
		console.debug(`Operon: Full reindex completed — ${this.tasks.size} tasks from ${fileCount} files in ${elapsed.toFixed(0)}ms`);

		const persistStartedAt = enginePerfNow();
		await this.persistIndex({
			immediate: true,
			shadowImmediate: true,
			forceFull: true,
			perfContext: { source: 'full-reindex' },
		});
		const persistMs = enginePerfNow() - persistStartedAt;
		enginePerfLog(
			'index.reindex.full',
			`files=${fileCount}`,
			`tasks=${this.tasks.size}`,
			`instances=${this.taskInstances.size}`,
			`setupMs=${Math.round(setupMs)}`,
			`enumerateMs=${Math.round(enumerateMs)}`,
			`scanMs=${Math.round(scanMs)}`,
			`secondaryMs=${Math.round(secondaryMs)}`,
			`commitMs=${Math.round(commitMs)}`,
			`persistMs=${Math.round(persistMs)}`,
			`totalMs=${Math.round(enginePerfNow() - startTime)}`,
		);
		this.emitIndexReconciliation({ kind: 'full', generation: this.generation });
		this.onIndexUpdated?.();
	}

	private async buildFullIndexState(): Promise<FullIndexBuild> {
		const setupStartedAt = enginePerfNow();
		const staged = this.createEmptyIndexState();
		const settingsSnapshot = structuredClone(this.storage.getSettings());
		const pipelineSnapshot = settingsSnapshot.pipelines.map(pipeline => clonePipeline(pipeline));
		const workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(pipelineSnapshot);
		const indexV8SemanticsSignature = buildIndexV8SemanticsSignature(settingsSnapshot);
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelineSnapshot);
		const setupMs = enginePerfNow() - setupStartedAt;

		const enumerateStartedAt = enginePerfNow();
		const files = this.app.vault.getMarkdownFiles()
			.filter(file => !isOperonExcludedPath(file.path, settingsSnapshot));
		const enumerateMs = enginePerfNow() - enumerateStartedAt;

		const scanStartedAt = enginePerfNow();
		for (const file of files) {
			await this.indexFile(
				file,
				staged,
				pipelineSnapshot,
				workflowStatusIdentityIndex,
				settingsSnapshot.keyMappings,
				settingsSnapshot,
			);
		}
		const scanMs = enginePerfNow() - scanStartedAt;

		const secondaryStart = enginePerfNow();
		staged.secondary.rebuild(staged.tasks);
		const secondaryMs = enginePerfNow() - secondaryStart;
		enginePerfLog('secondary.rebuild.full', `${Math.round(secondaryMs)}ms`, `tasks=${staged.tasks.size}`);
		return {
			state: staged,
			workflowStatusSemanticsSignature,
			indexV8SemanticsSignature,
			fileCount: files.length,
			setupMs,
			enumerateMs,
			scanMs,
			secondaryMs,
		};
	}

	/**
	 * Load cached index from disk, then verify in background.
	 * Architecture doc Section 4.5: Load cached first (< 100ms), background verify.
	 */
	async loadCachedIndex(): Promise<CachedIndexLoadResult> {
		let fallbackReason: IndexV8FallbackReason | undefined;
		const markerStatus = await this.inspectDurableV8RecoveryMarker();
		if (markerStatus !== 'missing') {
			enginePerfLog('index.load.cached', 'status=recovery-required', 'source=marker', `marker=${markerStatus}`);
			return { status: 'missing', fallbackReason: 'recovery-required' };
		}
		if (this.indexV8Store && isIndexV8ReadEnabled()) {
			const collectTimings = isOperonEnginePerfDebugEnabled();
			const startedAt = collectTimings ? enginePerfNow() : 0;
			const loadStartedAt = collectTimings ? enginePerfNow() : 0;
			const loaded = await this.indexV8Store.load();
			const loadMs = collectTimings ? enginePerfNow() - loadStartedAt : 0;
			const expectedSignature = buildIndexV8SemanticsSignature(this.storage.getSettings());
			const decision = prepareIndexV8Startup(loaded, expectedSignature);
			if (decision.status === 'incompatible') {
				enginePerfLog(
					'index.load.cached',
					'source=v8',
					'status=incompatible-index-semantics',
					`loadMs=${Math.round(loadMs)}`,
					`totalMs=${Math.round(collectTimings ? enginePerfNow() - startedAt : 0)}`,
				);
				return {
					status: 'incompatible',
					reason: 'index-semantics',
					expectedSignature: decision.expectedSignature,
					cachedSignature: decision.cachedSignature,
				};
			}
			if (decision.status === 'eligible') {
				try {
					const stagingStartedAt = collectTimings ? enginePerfNow() : 0;
					const staged = this.createEmptyIndexState();
					for (const [operonId, task] of decision.tasks) {
						staged.tasks.set(operonId, task);
					}
					for (const [instanceKey, task] of decision.taskInstances) {
						staged.taskInstances.set(instanceKey, task);
					}
					for (const [operonId, instanceKeys] of decision.operonIdInstances) {
						staged.operonIdInstances.set(operonId, instanceKeys);
					}
					for (const [filePath, stat] of decision.sourceStats) {
						staged.fileMtimes.set(filePath, stat.mtimeMs);
						staged.fileSizes.set(filePath, stat.sizeBytes);
					}
					const conflictTime = new Date().toISOString();
					for (const operonId of decision.duplicateOperonIds) {
						const task = staged.tasks.get(operonId);
						const instanceKeys = staged.operonIdInstances.get(operonId);
						if (!task || !instanceKeys) continue;
						const instances = Array.from(instanceKeys)
							.map(instanceKey => staged.taskInstances.get(instanceKey))
							.filter((instance): instance is IndexedTaskInstance => !!instance)
							.sort(compareDuplicateInstances);
						staged.duplicateConflicts.set(operonId, {
							operonId,
							instances,
							detectedAt: conflictTime,
							updatedAt: conflictTime,
							canonicalInstanceKey: this.buildInstanceKey(task.primary),
						});
					}
					const stagingMs = collectTimings ? enginePerfNow() - stagingStartedAt : 0;
					const secondaryStartedAt = collectTimings ? enginePerfNow() : 0;
					staged.secondary.rebuild(staged.tasks);
					const secondaryMs = collectTimings ? enginePerfNow() - secondaryStartedAt : 0;
					if (collectTimings && loaded.status === 'loaded') loaded.metrics.secondaryRebuildMs = secondaryMs;
					const committedAtMs = Date.parse(decision.manifest.committedAt);
					const workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(
						this.storage.getSettings().pipelines,
					);
					const startupSourceStats = new Map(decision.sourceStats);
					this.rebuildSourcePersistenceIndexes(staged);
					this.commitIndexState(staged);
					this.lastSavedAt = committedAtMs;
					this.lastDurableCommittedAt = decision.manifest.committedAt;
					this.lastFullScanAt = decision.manifest.lastFullScanAt;
					this.coherenceBasis = 'verified-full-scan';
					this.coherentWorkflowStatusSemanticsSignature = workflowStatusSemanticsSignature;
					this.coherentIndexV8SemanticsSignature = decision.manifest.indexSemanticsSignature;
					if (loaded.status === 'loaded') {
						this.indexV8ShadowWriter?.adoptVerifiedBaseline?.(loaded.manifestPayload, {
							version: INDEX_VERSION,
							workflowStatusSemanticsSignature,
							lastFullReindex: decision.manifest.lastFullScanAt,
							tasks: Object.fromEntries(staged.tasks),
							taskInstances: Object.fromEntries(staged.taskInstances),
						});
					}
					this.startupV8SourceStats = startupSourceStats;
					this.startupV8CommittedAtMs = this.lastSavedAt;
					this.generation += 1;
					enginePerfLog(
						'index.load.cached',
						'source=v8',
						'status=loaded',
						`tasks=${this.tasks.size}`,
						`instances=${this.taskInstances.size}`,
						`sources=${decision.sourceStats.size}`,
						`bytes=${loaded.status === 'loaded' ? loaded.metrics.manifestBytes + loaded.metrics.shardBytes : 0}`,
						`loadMs=${Math.round(loadMs)}`,
						`hydrationMs=${Math.round(decision.hydrationMs)}`,
						`stagingMs=${Math.round(stagingMs)}`,
						`secondaryMs=${Math.round(secondaryMs)}`,
						`totalMs=${Math.round(collectTimings ? enginePerfNow() - startedAt : 0)}`,
					);
					this.emitIndexReconciliation({ kind: 'full', generation: this.generation });
					return { status: 'loaded', source: 'v8', requiresFullReindex: false };
				} catch {
					fallbackReason = 'hydration-failed';
					this.indexV8ShadowWriter?.disable('STARTUP_HYDRATION_FAILED');
					enginePerfLog(
						'index.load.cached',
						'source=v8',
						'status=fallback',
						'code=hydration-failed',
						`loadMs=${Math.round(loadMs)}`,
						`totalMs=${Math.round(collectTimings ? enginePerfNow() - startedAt : 0)}`,
					);
				}
			} else {
				fallbackReason = decision.reason;
				if (decision.disableShadow && decision.reason !== 'incomplete' && decision.reason !== 'io-error') {
					this.indexV8ShadowWriter?.disable(`STARTUP_${decision.code ?? decision.reason.toUpperCase()}`);
				}
				enginePerfLog(
					'index.load.cached',
					'source=v8',
					'status=fallback',
					`code=${decision.code ?? decision.reason}`,
					`loadMs=${Math.round(loadMs)}`,
					`totalMs=${Math.round(collectTimings ? enginePerfNow() - startedAt : 0)}`,
				);
			}
		} else if (this.indexV8Store) {
			fallbackReason = 'read-disabled';
			this.indexV8ShadowWriter?.disable('STARTUP_READ_DISABLED');
		}
		return { status: 'missing', ...(fallbackReason ? { fallbackReason } : {}) };
	}

	private async inspectDurableV8RecoveryMarker(): Promise<IndexV8RecoveryMarkerStatus> {
		const storage = this.storage as OperonStorage & {
			inspectIndexV8RecoveryRequired?: () => Promise<IndexV8RecoveryMarkerStatus>;
			hasIndexV8RecoveryRequired?: () => Promise<boolean>;
		};
		if (storage.inspectIndexV8RecoveryRequired) return await storage.inspectIndexV8RecoveryRequired();
		return await storage.hasIndexV8RecoveryRequired?.() ? 'required' : 'missing';
	}

	/**
	 * Scan only files modified since the cache was last saved.
	 * Fast on normal restarts (few or no changed files); catches agent-written tasks.
	 */
	async diffReindex(): Promise<void> {
		if (this.shuttingDown) return;
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

	/** Reconcile a verified V8 startup snapshot against current vault metadata in one index operation. */
	async reconcileV8StartupSources(): Promise<void> {
		if (this.shuttingDown || !this.startupV8SourceStats) return;
		const sourceStats = this.startupV8SourceStats;
		const committedAtMs = this.startupV8CommittedAtMs;
		this.startupV8SourceStats = null;
		this.startupV8CommittedAtMs = 0;
		await this.enqueueIndexOperation(async () => {
			const startedAt = enginePerfNow();
			const settings = this.storage.getSettings();
			const currentFiles = this.app.vault.getMarkdownFiles();
			const currentByPath = new Map(currentFiles.map(file => [file.path, file]));
			const candidates: string[] = [];
			const removedSourceStats: IndexV8SourceStat[] = [];

			for (const [filePath, cachedStat] of sourceStats) {
				const file = currentByPath.get(filePath);
				if (!file || isOperonExcludedPath(filePath, settings)) {
					candidates.push(filePath);
					removedSourceStats.push(cachedStat);
					continue;
				}
				if (file.stat.mtime !== cachedStat.mtimeMs || file.stat.size !== cachedStat.sizeBytes) {
					candidates.push(filePath);
				}
			}

			for (const file of currentFiles) {
				if (sourceStats.has(file.path) || isOperonExcludedPath(file.path, settings)) continue;
				const renameCandidate = removedSourceStats.some(stat => (
					stat.mtimeMs === file.stat.mtime && stat.sizeBytes === file.stat.size
				));
				const metadataCandidate = this.mightContainTaskFromMetadata(file, settings);
				if (file.stat.mtime > committedAtMs
					|| file.stat.ctime > committedAtMs
					|| renameCandidate
					|| metadataCandidate) {
					candidates.push(file.path);
				}
			}

			const uniqueCandidates = [...new Set(candidates)];
			if (uniqueCandidates.length > 0) {
				await this.doReindexFilesBatch(uniqueCandidates, {
					notify: false,
					perfContext: { source: 'v8-startup-reconcile' },
				});
			}
			enginePerfLog(
				'index.v8.startup.reconcile',
				`cachedSources=${sourceStats.size}`,
				`candidates=${uniqueCandidates.length}`,
				`removed=${removedSourceStats.length}`,
				`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
			);
		});
	}

	private mightContainTaskFromMetadata(file: TFile, settings: OperonSettings): boolean {
		const cache = this.app.metadataCache?.getFileCache(file);
		// Metadata can still be settling during Sync startup. Failing open prevents a missed task.
		if (!cache) return true;
		if (cache.listItems === undefined && cache.frontmatter === undefined) return true;
		if (cache.listItems?.some(item => item.task !== undefined)) return true;
		const frontmatter = cache.frontmatter;
		if (!frontmatter) return false;
		return getManagedYamlAliases('operonId', settings.keyMappings).some(key => (
			Object.prototype.hasOwnProperty.call(frontmatter, key)
		));
	}

	// --- Incremental Reindex ---

	/**
	 * Schedule an incremental reindex for a file.
	 * Debounces rapid events (Spec Section 9.4, Architecture doc Section 4.2).
	 */
	scheduleReindex(filePath: string): void {
		if (this.shuttingDown) return;
		this.noteMarkdownEvent();
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
		if (this.shuttingDown) return;
		this.noteMarkdownEvent();
		await this.enqueueIndexOperation(() => this.doReindexFilePath(filePath, options));
	}

	private async doReindexFilePath(filePath: string, options: ReindexOptions = {}): Promise<void> {
		const startedAt = enginePerfNow();
		if (isOperonExcludedPath(filePath, this.storage.getSettings())) {
			const beforeById = this.snapshotCanonicalTasksByInstanceFile(filePath);
			const removedTasks = this.removeTasksByFile(filePath);
			this.fileMtimes.delete(filePath);
			this.fileSizes.delete(filePath);
			const deltas = this.applySecondaryDeltas(beforeById);
			this.generation += 1;
			await this.persistIndex({
				dirtySourcePaths: [filePath],
				affectedOperonIds: beforeById.keys(),
				perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-file-excluded'),
			});
			this.emitIncrementalReconciliation(beforeById.keys());
			this.notifyTaskChanges(deltas, options);
			if (options.notify !== false && removedTasks.length > 0) {
				this.onTasksRemoved?.(removedTasks);
			}
			if (options.notify !== false) {
				this.onIndexUpdated?.();
			}
			enginePerfLog(
				'index.reindex.incremental',
				'files=1',
				'excluded=true',
				`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
			);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const staged = this.createEmptyIndexState();
		const scanStartedAt = enginePerfNow();
		let scannedIds: Set<string>;
		try {
			scannedIds = await this.indexFile(file, staged);
		} catch (error) {
			console.warn(`Operon: failed to reindex ${filePath}; keeping previous index state`, error);
			return;
		}
		const scanMs = enginePerfNow() - scanStartedAt;

		const reconcileStartedAt = enginePerfNow();
		const beforeById = this.snapshotCanonicalTasksByInstanceFile(filePath);

		// Remove old tasks from this file
		const removedCandidates = this.removeTasksByFile(filePath);

		this.commitFileScanState(staged);
		const reconcileMs = enginePerfNow() - reconcileStartedAt;

		// Update secondary indexes for affected task ids only
		const secondaryStartedAt = enginePerfNow();
		const deltas = this.applySecondaryDeltas(beforeById, scannedIds);
		const secondaryMs = enginePerfNow() - secondaryStartedAt;
		this.generation += 1;

		// Persist (debounced via write queue)
		const persistStartedAt = enginePerfNow();
		const affectedOperonIds = new Set([...beforeById.keys(), ...scannedIds]);
		await this.persistIndex({
			dirtySourcePaths: [filePath],
			affectedOperonIds,
			perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-file'),
		});
		const persistScheduleMs = enginePerfNow() - persistStartedAt;
		const removedTasks = this.collectActuallyRemovedTasks(removedCandidates);
		this.emitIncrementalReconciliation(affectedOperonIds);
		this.notifyTaskChanges(deltas, options);
		if (options.notify !== false && removedTasks.length > 0) {
			this.onTasksRemoved?.(removedTasks);
		}

		// Notify listeners that the index has changed (e.g. refresh views)
		if (options.notify !== false) {
			this.onIndexUpdated?.();
		}
		enginePerfLog(
			'index.reindex.incremental',
			'files=1',
			`scanMs=${Math.round(scanMs)}`,
			`replaceAndReconcileMs=${Math.round(reconcileMs)}`,
			`secondaryMs=${Math.round(secondaryMs)}`,
			`persistScheduleMs=${Math.round(persistScheduleMs)}`,
			`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
		);
	}

	/**
	 * Batch reindex multiple files, then notify once at the end.
	 * Avoids firing onIndexUpdated per-file when many files are pending.
	 */
	async reindexFilesBatch(filePaths: string[], options: ReindexOptions = {}): Promise<void> {
		if (this.shuttingDown) return;
		this.noteMarkdownEvent();
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
		if (this.shuttingDown) return false;
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
			this.fileSizes.set(file.path, file.stat.size);
		}
		this.generation += 1;
		await this.persistIndex({
			dirtySourcePaths: new Set(prepared.map(({ file }) => file.path)),
			affectedOperonIds: new Set(prepared.map(({ task }) => task.operonId)),
			perfContext: this.resolveIndexPerfContext(options.perfContext, 'aggregate-index-patch'),
		});
		this.emitIncrementalReconciliation(prepared.map(({ task }) => task.operonId));
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
		const scanAndHydrationStartedAt = enginePerfNow();
		const pipelines = this.storage.getSettings().pipelines;
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines);
		const removedTasks: IndexedTask[] = [];
		const beforeById = new Map<string, IndexedTask | undefined>();
		const scannedIds = new Set<string>();
		let mutated = false;
		for (const fp of filePaths) {
			if (isOperonExcludedPath(fp, this.storage.getSettings())) {
				for (const [operonId, task] of this.snapshotCanonicalTasksByInstanceFile(fp)) {
					if (!beforeById.has(operonId)) beforeById.set(operonId, task);
				}
				removedTasks.push(...this.removeTasksByFile(fp));
				this.fileMtimes.delete(fp);
				this.fileSizes.delete(fp);
				mutated = true;
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(fp);
			if (!(file instanceof TFile) || file.extension !== 'md') {
				const existing = this.snapshotCanonicalTasksByInstanceFile(fp);
				if (existing.size === 0) continue;
				for (const [operonId, task] of existing) {
					if (!beforeById.has(operonId)) beforeById.set(operonId, task);
				}
				removedTasks.push(...this.removeTasksByFile(fp));
				this.fileMtimes.delete(fp);
				this.fileSizes.delete(fp);
				mutated = true;
				continue;
			}
			const staged = this.createEmptyIndexState();
			let fileScannedIds: Set<string>;
			try {
				fileScannedIds = await this.indexFile(file, staged, pipelines, workflowStatusIdentityIndex);
			} catch (error) {
				console.warn(`Operon: failed to reindex ${fp}; keeping previous index state`, error);
				continue;
			}
			for (const [operonId, task] of this.snapshotCanonicalTasksByInstanceFile(fp)) {
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
			enginePerfLog('index.reindex.incremental', `files=${filePaths.length}`, 'mutated=false', `totalMs=${Math.round(enginePerfNow() - startedAt)}`);
			return;
		}
		const scanAndHydrationMs = enginePerfNow() - scanAndHydrationStartedAt;
		const secondaryStartedAt = enginePerfNow();
		const deltas = this.applySecondaryDeltas(beforeById, scannedIds);
		const secondaryMs = enginePerfNow() - secondaryStartedAt;
		this.generation += 1;
		const persistStartedAt = enginePerfNow();
		const affectedOperonIds = new Set([...beforeById.keys(), ...scannedIds]);
		await this.persistIndex({
			dirtySourcePaths: filePaths,
			affectedOperonIds,
			perfContext: this.resolveIndexPerfContext(options.perfContext, 'reindex-batch'),
		});
		const persistScheduleMs = enginePerfNow() - persistStartedAt;
		const actuallyRemovedTasks = this.collectActuallyRemovedTasks(removedTasks);
		this.emitIncrementalReconciliation(affectedOperonIds);
		this.notifyTaskChanges(deltas, options);
		if (options.notify !== false && actuallyRemovedTasks.length > 0) {
			this.onTasksRemoved?.(actuallyRemovedTasks);
		}
		if (options.notify !== false) {
			this.onIndexUpdated?.();
		}
		enginePerfLog(
			'index.reindex.incremental',
			`files=${filePaths.length}`,
			`scanAndHydrationMs=${Math.round(scanAndHydrationMs)}`,
			`secondaryMs=${Math.round(secondaryMs)}`,
			`persistScheduleMs=${Math.round(persistScheduleMs)}`,
			`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
		);
	}

	/**
	 * Handle file deletion: remove all tasks from that file.
	 */
	async handleFileDelete(filePath: string): Promise<void> {
		if (this.shuttingDown) return;
		this.noteMarkdownEvent();
		await this.enqueueIndexOperation(() => this.doHandleFileDelete(filePath));
	}

	private async doHandleFileDelete(filePath: string): Promise<void> {
		const beforeById = this.snapshotCanonicalTasksByInstanceFile(filePath);
		const removedTasks = this.removeTasksByFile(filePath);
		this.fileMtimes.delete(filePath);
		this.fileSizes.delete(filePath);
		const deltas = this.applySecondaryDeltas(beforeById);
		this.generation += 1;
		await this.persistIndex({
			dirtySourcePaths: [filePath],
			affectedOperonIds: beforeById.keys(),
			perfContext: { source: 'file-delete' },
		});
		this.emitIncrementalReconciliation(beforeById.keys());
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
		if (this.shuttingDown) return;
		this.noteMarkdownEvent();
		void this.enqueueIndexOperation(() => this.doHandleFileRename(oldPath, newPath));
	}

	private async doHandleFileRename(oldPath: string, newPath: string): Promise<void> {
		const beforeById = this.snapshotCanonicalTasksByInstanceFile(oldPath);
		if (isOperonExcludedPath(newPath, this.storage.getSettings())) {
			const removedTasks = this.removeTasksByFile(oldPath);
			this.fileMtimes.delete(oldPath);
			this.fileMtimes.delete(newPath);
			this.fileSizes.delete(oldPath);
			this.fileSizes.delete(newPath);
			const deltas = this.applySecondaryDeltas(beforeById);
			this.generation += 1;
			await this.persistIndex({
				dirtySourcePaths: [oldPath, newPath],
				affectedOperonIds: beforeById.keys(),
				perfContext: { source: 'file-rename-excluded' },
			});
			this.emitIncrementalReconciliation(beforeById.keys());
			this.notifyTaskChanges(deltas);
			if (removedTasks.length > 0) this.onTasksRemoved?.(removedTasks);
			this.onIndexUpdated?.();
			return;
		}
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
			this.removeSourceInstanceKey(oldPath, oldKey, this.getLiveIndexState());
			this.taskInstances.set(newKey, {
				...task,
				instanceKey: newKey,
				primary: nextPrimary,
			});
			this.addSourceInstanceKey(newPath, newKey, this.getLiveIndexState());
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
		this.fileSizes.delete(oldPath);
		this.fileSizes.delete(newPath);
		const renamedFile = this.app.vault.getAbstractFileByPath(newPath);
		if (renamedFile instanceof TFile) {
			this.fileMtimes.set(newPath, renamedFile.stat.mtime);
			this.fileSizes.set(newPath, renamedFile.stat.size);
		} else {
			this.invalidateV8Coherence();
		}

		for (const operonId of affectedOperonIds) {
			this.reconcileOperonId(operonId);
		}
		const deltas = this.applySecondaryDeltas(beforeById, affectedOperonIds);
		this.generation += 1;
		await this.persistIndex({
			dirtySourcePaths: [oldPath, newPath],
			affectedOperonIds,
			perfContext: { source: 'file-rename' },
		});
		this.emitIncrementalReconciliation(affectedOperonIds);
		this.notifyTaskChanges(deltas);

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
	private async indexFile(
		file: TFile,
		state: IndexState = this.getLiveIndexState(),
		pipelines: Pipeline[] = this.storage.getSettings().pipelines,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines),
		keyMappings: KeyMapping[] = this.storage.getSettings().keyMappings,
		exclusionSettings: OperonSettings = this.storage.getSettings(),
	): Promise<Set<string>> {
		const scannedIds = new Set<string>();
		if (isOperonExcludedPath(file.path, exclusionSettings)) {
			state.fileMtimes.delete(file.path);
			state.fileSizes.delete(file.path);
			return scannedIds;
		}

		const result = await scanFileWithMappings(this.app, file, keyMappings);
		state.fileMtimes.set(file.path, result.mtime);
		state.fileSizes.set(file.path, result.sizeBytes);

		// Process inline tasks
		for (const parsed of result.inlineTasks) {
			if (!parsed.operonId) continue;
			scannedIds.add(parsed.operonId);

			const location = inlineLocation(parsed.filePath, parsed.lineNumber);
			const fieldValues: Record<string, string> = {};
			const inlineTags = new Set(parsed.tags.map(tag => tag.trim()).filter(Boolean));
			for (const f of parsed.fields) {
				const canonicalKey = f.key;
				if (canonicalKey === 'pinned') continue;
				if (canonicalKey === 'tags') {
					for (const tag of f.value.split(/[;,]/)) {
						const cleaned = tag.trim().replace(/^#/, '');
						if (cleaned) inlineTags.add(cleaned);
					}
					continue;
				}
				if (!isManagedTaskFieldCanonicalKey(canonicalKey, keyMappings)) continue;
				fieldValues[canonicalKey] = f.value;
			}
			const workflowState = resolveWorkflowStatus(pipelines, fieldValues['status'], workflowStatusIdentityIndex);
			let checkbox = parsed.checkbox;
			if (workflowState) {
				checkbox = workflowState.checkbox;
			} else if (fieldValues['dateCancelled']) {
				checkbox = 'cancelled';
			} else if (fieldValues['dateCompleted']) {
				checkbox = 'done';
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
			const workflowState = resolveWorkflowStatus(pipelines, fv['status'], workflowStatusIdentityIndex);
			let checkbox: CheckboxState = 'open';
			if (workflowState) {
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
			tier: computeIndexTier(data.checkbox, sanitizedFieldValues),
			plainCheckboxProgress: data.plainCheckboxProgress,
		});
		const instanceKeys = state.operonIdInstances.get(operonId) ?? new Set<string>();
		instanceKeys.add(instanceKey);
		state.operonIdInstances.set(operonId, instanceKeys);
		this.addSourceInstanceKey(data.location.filePath, instanceKey, state);
		this.reconcileOperonId(operonId, state);
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
			this.removeSourceInstanceKey(task.primary.filePath, instanceKey, state);
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
			fileSizes: new Map(),
			sourceInstanceKeys: new Map(),
			sourcePathsByShard: new Map(),
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
			fileSizes: this.fileSizes,
			sourceInstanceKeys: this.sourceInstanceKeys,
			sourcePathsByShard: this.sourcePathsByShard,
			secondary: this.secondary,
		};
	}

	private commitIndexState(state: IndexState): void {
		this.tasks = state.tasks;
		this.taskInstances = state.taskInstances;
		this.operonIdInstances = state.operonIdInstances;
		this.duplicateConflicts = state.duplicateConflicts;
		this.fileMtimes = state.fileMtimes;
		this.fileSizes = state.fileSizes;
		this.sourceInstanceKeys = state.sourceInstanceKeys;
		this.sourcePathsByShard = state.sourcePathsByShard;
		this.secondary = state.secondary;
	}

	private commitFileScanState(state: IndexState): void {
		for (const task of state.taskInstances.values()) {
			this.insertTaskInstance(task);
		}
		for (const [filePath, mtime] of state.fileMtimes) {
			this.fileMtimes.set(filePath, mtime);
		}
		for (const [filePath, size] of state.fileSizes) {
			this.fileSizes.set(filePath, size);
		}
	}

	private insertTaskInstance(task: IndexedTaskInstance, state: IndexState = this.getLiveIndexState()): void {
		const previous = state.taskInstances.get(task.instanceKey);
		if (previous) this.removeSourceInstanceKey(previous.primary.filePath, task.instanceKey, state);
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
		this.addSourceInstanceKey(task.primary.filePath, task.instanceKey, state);
		this.reconcileOperonId(task.operonId, state);
	}

	private addSourceInstanceKey(filePath: string, instanceKey: string, state: IndexState): void {
		const normalizedPath = normalizeIndexV8SourcePath(filePath);
		const instanceKeys = state.sourceInstanceKeys.get(normalizedPath) ?? new Set<string>();
		instanceKeys.add(instanceKey);
		state.sourceInstanceKeys.set(normalizedPath, instanceKeys);
		const shardId = getIndexV8ShardId(normalizedPath);
		const sourcePaths = state.sourcePathsByShard.get(shardId) ?? new Set<string>();
		sourcePaths.add(normalizedPath);
		state.sourcePathsByShard.set(shardId, sourcePaths);
	}

	private removeSourceInstanceKey(filePath: string, instanceKey: string, state: IndexState): void {
		const normalizedPath = normalizeIndexV8SourcePath(filePath);
		const instanceKeys = state.sourceInstanceKeys.get(normalizedPath);
		if (!instanceKeys) return;
		instanceKeys.delete(instanceKey);
		if (instanceKeys.size > 0) return;
		state.sourceInstanceKeys.delete(normalizedPath);
		const shardId = getIndexV8ShardId(normalizedPath);
		const sourcePaths = state.sourcePathsByShard.get(shardId);
		if (!sourcePaths) return;
		sourcePaths.delete(normalizedPath);
		if (sourcePaths.size === 0) state.sourcePathsByShard.delete(shardId);
	}

	private rebuildSourcePersistenceIndexes(state: IndexState = this.getLiveIndexState()): void {
		state.sourceInstanceKeys.clear();
		state.sourcePathsByShard.clear();
		for (const [instanceKey, task] of state.taskInstances) {
			this.addSourceInstanceKey(task.primary.filePath, instanceKey, state);
		}
	}

	// --- Persistence ---

	/**
	 * Persist current index through the storage runtime index contract.
	 * Uses atomic write via storage write queue.
	 */
	private async persistIndex(options: PersistIndexOptions = {}): Promise<void> {
		if (this.coherentWorkflowStatusSemanticsSignature === null) {
			console.warn('Operon: skipped index persistence before a coherent cache or full scan was available');
			return;
		}
		const snapshotStartedAt = enginePerfNow();
		const committedAt = new Date().toISOString();
		const data = sealIndexData({
			version: INDEX_VERSION,
			workflowStatusSemanticsSignature: this.coherentWorkflowStatusSemanticsSignature,
			lastFullReindex: committedAt,
			tasks: Object.fromEntries(this.tasks),
			taskInstances: Object.fromEntries(this.taskInstances),
		});
		const sourceStats = new Map<string, { mtimeMs: number; sizeBytes: number }>();
		for (const filePath of new Set(Array.from(this.taskInstances.values(), task => task.primary.filePath))) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			const mtimeMs = this.fileMtimes.get(filePath) ?? (file instanceof TFile ? file.stat.mtime : 0);
			const sizeBytes = this.fileSizes.get(filePath) ?? (file instanceof TFile ? file.stat.size : 0);
			sourceStats.set(filePath, { mtimeMs, sizeBytes });
		}
		const sequence = ++this.persistenceSequence;
		const dirtySourcePaths = new Set<string>();
		for (const filePath of options.dirtySourcePaths ?? []) {
			dirtySourcePaths.add(normalizeIndexV8SourcePath(filePath));
		}
		const snapshot: PendingIndexPersistenceSnapshot = {
			input: {
				sequence,
				indexData: data,
				sourceStats,
				committedAt,
				lastFullScanAt: this.lastFullScanAt || committedAt,
				indexSemanticsSignature: this.coherentIndexV8SemanticsSignature
					?? buildIndexV8SemanticsSignature(this.storage.getSettings()),
				coherenceBasis: options.coherenceBasis ?? this.coherenceBasis,
				incrementalParityProjection: projectIndexV8IncrementalParity(this.tasks, this.secondary),
			},
			dirty: {
				sequence,
				dirtySourcePaths,
				affectedOperonIds: new Set(options.affectedOperonIds ?? []),
				forceFull: options.forceFull === true,
			},
			shadowImmediate: options.shadowImmediate ?? options.immediate ?? false,
			retryCount: 0,
		};
		const snapshotBuildMs = enginePerfNow() - snapshotStartedAt;
		const perfContext = {
			...this.resolveIndexPerfContext(options.perfContext, 'index-update'),
			snapshotBuildMs,
		};
		if (!this.recoveryPersistAllowed && this.indexV8ShadowWriter && this.getIndexV8RuntimePhase() !== 'idle') {
			this.pendingPersistData = this.pendingPersistData
				? this.mergePendingPersistSnapshots(this.pendingPersistData, snapshot)
				: snapshot;
			this.pendingPersistRequestCount += 1;
			this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
			return;
		}
		if (options.immediate) {
			this.discardPendingPersist();
			await this.flushPersistData(snapshot, perfContext, 1);
			return;
		}
		this.pendingPersistData = this.pendingPersistData
			? this.mergePendingPersistSnapshots(this.pendingPersistData, snapshot)
			: snapshot;
		this.pendingPersistRequestCount++;
		this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
		if (this.persistTimer && !this.persistRetryScheduled) return;
		if (this.persistTimer) clearWindowTimeout(this.persistTimer);
		this.persistRetryScheduled = false;
		this.persistTimer = setWindowTimeout(() => {
			this.persistTimer = null;
			void this.enqueueIndexOperation(() => this.flushPendingPersist());
		}, this.persistDebounceMs);
	}

	private mergePendingPersistSnapshots(
		previous: PendingIndexPersistenceSnapshot,
		next: PendingIndexPersistenceSnapshot,
	): PendingIndexPersistenceSnapshot {
		return {
			...next,
			dirty: {
				sequence: next.dirty.sequence,
				dirtySourcePaths: new Set([
					...previous.dirty.dirtySourcePaths,
					...next.dirty.dirtySourcePaths,
				]),
				affectedOperonIds: new Set([
					...previous.dirty.affectedOperonIds,
					...next.dirty.affectedOperonIds,
				]),
				forceFull: previous.dirty.forceFull || next.dirty.forceFull,
			},
			shadowImmediate: previous.shadowImmediate || next.shadowImmediate,
			retryCount: next.retryCount,
		};
	}

	private discardPendingPersist(): void {
		if (this.persistTimer) {
			clearWindowTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.persistRetryScheduled = false;
		this.pendingPersistData = null;
		this.pendingPersistRequestCount = 0;
		this.pendingPersistContext = null;
	}

	async flushPendingPersist(): Promise<void> {
		if (this.persistTimer) {
			clearWindowTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.persistRetryScheduled = false;
		const snapshot = this.pendingPersistData;
		const requestCount = this.pendingPersistRequestCount;
		const perfContext = this.pendingPersistContext ?? { source: 'index-update' };
		this.pendingPersistData = null;
		this.pendingPersistRequestCount = 0;
		this.pendingPersistContext = null;
		if (!snapshot) return;
		await this.flushPersistData(snapshot, perfContext, Math.max(1, requestCount));
	}

	private async flushPersistData(
		snapshot: PendingIndexPersistenceSnapshot,
		perfContext: IndexPerfContext,
		requestCount: number,
	): Promise<void> {
		if (!this.recoveryPersistAllowed && this.indexV8ShadowWriter && this.getIndexV8RuntimePhase() !== 'idle') {
			this.pendingPersistData = this.pendingPersistData
				? this.mergePendingPersistSnapshots(snapshot, this.pendingPersistData)
				: snapshot;
			this.pendingPersistRequestCount += requestCount;
			this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
			return;
		}
		const data = snapshot.input.indexData as IndexData;
		if (!this.indexV8ShadowWriter || this.recoveryRequired) {
			if (!this.recoveryRequired) {
				await this.enterRecoveryRequired(
					new IndexV8StorageError('INVALID_SNAPSHOT', 'V8 primary persistence is unavailable'),
					perfContext,
					requestCount,
				);
			}
			return;
		}

		const startedAt = enginePerfNow();
		let primaryResult;
		try {
			primaryResult = await this.indexV8ShadowWriter.persistPrimary(
				snapshot.input,
				snapshot.dirty,
				{
					sourceInstanceKeys: this.sourceInstanceKeys,
					sourcePathsByShard: this.sourcePathsByShard,
				},
			);
		} catch (error) {
			if (this.recoveryPersistAllowed) throw error;
			if (this.isSyncRecoveryV8Error(error)) {
				if (this.shuttingDown) {
					await this.enterRecoveryRequired(error, perfContext, requestCount);
					return;
				}
				this.pendingPersistData = this.pendingPersistData
					? this.mergePendingPersistSnapshots(snapshot, this.pendingPersistData)
					: snapshot;
				this.pendingPersistRequestCount += requestCount;
				this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
				void this.requestIndexV8SyncRecovery('primary-cas');
				return;
			}
			if (snapshot.retryCount === 0 && this.isRetryableV8PrimaryError(error)) {
				this.scheduleV8PrimaryRetry(snapshot, perfContext, requestCount, error);
				return;
			}
			await this.enterRecoveryRequired(error, perfContext, requestCount);
			return;
		}

		if (primaryResult.status === 'committed') {
			this.lastSavedAt = Date.parse(primaryResult.committedAt);
			this.lastDurableCommittedAt = primaryResult.committedAt;
		}
		if (snapshot.dirty.forceFull && snapshot.input.coherenceBasis === 'verified-full-scan') {
			const storage = this.storage as OperonStorage & { clearIndexV8RecoveryRequired?: () => Promise<void> };
			await storage.clearIndexV8RecoveryRequired?.();
		}
		const totalMs = Math.round(enginePerfNow() - startedAt);
		const slow = totalMs >= 100;
		enginePerfLog(
			'persistIndex',
			`${totalMs}ms`,
			'authority=v8',
			`source=${perfContext.source}`,
			`requestCount=${requestCount}`,
			`snapshotBuildMs=${Math.round(perfContext.snapshotBuildMs ?? 0)}`,
			...formatEnginePerfTraceMetadata(perfContext.trace),
			`tasks=${Object.keys(data.tasks).length}`,
			`taskInstances=${Object.keys(data.taskInstances ?? {}).length}`,
			`dirtySources=${snapshot.dirty.dirtySourcePaths.size}`,
			`affectedIds=${snapshot.dirty.affectedOperonIds.size}`,
			`dirtyShards=${primaryResult.dirtyShardCount}`,
			`shardsWritten=${primaryResult.shardsWritten}`,
			`shardsReused=${primaryResult.shardsReused}`,
			`bytesWritten=${primaryResult.bytesWritten}`,
			`totalMs=${totalMs}`,
			`slow=${String(slow)}`,
		);
	}

	private scheduleV8PrimaryRetry(
		snapshot: PendingIndexPersistenceSnapshot,
		perfContext: IndexPerfContext,
		requestCount: number,
		error: unknown,
	): void {
		const retrySnapshot: PendingIndexPersistenceSnapshot = { ...snapshot, retryCount: 1 };
		this.pendingPersistData = this.pendingPersistData
			? this.mergePendingPersistSnapshots(retrySnapshot, this.pendingPersistData)
			: retrySnapshot;
		this.pendingPersistRequestCount += requestCount;
		this.pendingPersistContext = this.mergeIndexPerfContexts(this.pendingPersistContext, perfContext);
		if (this.persistTimer) clearWindowTimeout(this.persistTimer);
		this.persistRetryScheduled = true;
		this.persistTimer = setWindowTimeout(() => {
			this.persistTimer = null;
			this.persistRetryScheduled = false;
			void this.enqueueIndexOperation(() => this.flushPendingPersist());
		}, 5_000);
		enginePerfLog(
			'index.v8.primary.retry',
			'status=scheduled',
			`sequence=${snapshot.input.sequence}`,
			`code=${error instanceof Error ? error.name : 'unknown'}`,
		);
	}

	private async persistRecoveryRequiredMarker(
		perfContext: IndexPerfContext,
		requestCount: number,
		reason: string,
	): Promise<void> {
		const storage = this.storage as OperonStorage & { markIndexV8RecoveryRequired?: () => Promise<void> };
		if (!storage.markIndexV8RecoveryRequired) {
			throw new Error('RECOVERY_MARKER_UNAVAILABLE');
		}
		await storage.markIndexV8RecoveryRequired();
		enginePerfLog(
			'persistIndex',
			'authority=recovery-marker',
			`reason=${reason}`,
			`source=${perfContext.source}`,
			`requestCount=${requestCount}`,
		);
	}

	private isRetryableV8PrimaryError(error: unknown): boolean {
		if (error instanceof IndexV8CodecError
			|| error instanceof IndexV8ParityError
			|| error instanceof IndexV8IncrementalCompileError) return false;
		if (!(error instanceof IndexV8StorageError)) return true;
		return error.code === 'SHARD_POSTFLIGHT_FAILED'
			|| error.code === 'MANIFEST_POSTFLIGHT_FAILED'
			|| error.code === 'SNAPSHOT_POSTFLIGHT_FAILED';
	}

	private isSyncRecoveryV8Error(error: unknown): boolean {
		if (!(error instanceof IndexV8StorageError)) return false;
		return error.code === 'BASE_SNAPSHOT_CHANGED'
			|| error.code === 'SHARD_POSTFLIGHT_FAILED'
			|| error.code === 'MANIFEST_POSTFLIGHT_FAILED'
			|| error.code === 'SNAPSHOT_POSTFLIGHT_FAILED';
	}

	private noteMarkdownEvent(): void {
		this.lastMarkdownEventAt = this.indexV8RecoveryScheduler.now();
	}

	private requestIndexV8SyncRecovery(reason: string): Promise<void> {
		if (this.syncRecovery) return this.syncRecovery;
		if (this.shuttingDown || this.recoveryRequired || !this.indexV8ShadowWriter) return Promise.resolve();
		this.syncRecovery = this.runIndexV8SyncRecovery(reason)
			.catch(async error => {
				await this.enterCurrentStateRecoveryRequired(error);
			})
			.finally(() => {
				this.syncRecovery = null;
			});
		return this.syncRecovery;
	}

	private async runIndexV8SyncRecovery(reason: string): Promise<void> {
		if (!this.indexV8ShadowWriter || !this.indexV8Store) return;
		enginePerfLog('index.v8.sync.recovery', 'status=started', `reason=${reason}`);
		const recoveryDirtySourcePaths = new Set<string>();
		const recoveryAffectedOperonIds = new Set<string>();
		for (let attempt = 0; attempt < 2; attempt++) {
			this.indexV8ShadowWriter.setRuntimePhase?.('sync-settling');
			const stable = await this.settleIndexV8Manifest();
			if (!stable) throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'V8 manifest did not settle');
			try {
				await this.enqueueIndexOperation(async () => {
					if (this.shuttingDown || this.recoveryRequired) return;
					this.indexV8ShadowWriter?.setRuntimePhase?.('rebasing');
					await this.doFullReindex();
					if (!this.indexV8ShadowWriter) return;
					for (const path of this.pendingPersistData?.dirty.dirtySourcePaths ?? []) {
						recoveryDirtySourcePaths.add(path);
					}
					for (const operonId of this.pendingPersistData?.dirty.affectedOperonIds ?? []) {
						recoveryAffectedOperonIds.add(operonId);
					}
					this.indexV8ShadowWriter.adoptVerifiedBaseline(stable.manifestPayload, this.sealCurrentIndexData());
					this.recoveryPersistAllowed = true;
					try {
						await this.persistIndex({
							immediate: true,
							shadowImmediate: true,
							forceFull: true,
							dirtySourcePaths: recoveryDirtySourcePaths,
							affectedOperonIds: recoveryAffectedOperonIds,
							coherenceBasis: 'verified-full-scan',
							perfContext: { source: 'v8-sync-rebase' },
						});
					} finally {
						this.recoveryPersistAllowed = false;
					}
				});
				this.indexV8ShadowWriter.setRuntimePhase?.('idle');
				enginePerfLog('index.v8.sync.recovery', 'status=recovered', `attempt=${attempt + 1}`);
				return;
			} catch (error) {
				if (attempt === 0 && this.isSyncRecoveryV8Error(error)) continue;
				throw error;
			}
		}
	}

	private async settleIndexV8Manifest(): Promise<Extract<IndexV8LoadResult, { status: 'loaded' }> | null> {
		if (!this.indexV8Store) return null;
		let previousPayload: string | null = null;
		for (const delayMs of INDEX_V8_SETTLE_DELAYS_MS) {
			await this.indexV8RecoveryScheduler.delay(delayMs);
			if (this.shuttingDown || this.recoveryRequired) return null;
			const loaded = await this.indexV8Store.load();
			if (loaded.status === 'invalid' || loaded.status === 'unsupported') {
				throw new IndexV8StorageError('INVALID_SNAPSHOT', `V8 recovery refused ${loaded.status} manifest`);
			}
			if (loaded.status !== 'loaded') {
				previousPayload = null;
				continue;
			}
			const quiet = this.indexV8RecoveryScheduler.now() - this.lastMarkdownEventAt >= INDEX_V8_MARKDOWN_QUIET_MS;
			if (quiet && loaded.manifestPayload === previousPayload) return loaded;
			previousPayload = loaded.manifestPayload;
		}
		return null;
	}

	private sealCurrentIndexData(): IndexData {
		const committedAt = this.lastDurableCommittedAt || new Date().toISOString();
		return sealIndexData({
			version: INDEX_VERSION,
			workflowStatusSemanticsSignature: this.coherentWorkflowStatusSemanticsSignature ?? '',
			lastFullReindex: committedAt,
			tasks: Object.fromEntries(this.tasks),
			taskInstances: Object.fromEntries(this.taskInstances),
		});
	}

	private async enterCurrentStateRecoveryRequired(error: unknown): Promise<void> {
		if (this.shuttingDown || this.recoveryRequired) return;
		if (!this.coherentWorkflowStatusSemanticsSignature) {
			this.indexV8ShadowWriter?.setRuntimePhase?.('idle');
			return;
		}
		await this.enqueueIndexOperation(async () => {
			if (this.recoveryRequired || !this.coherentWorkflowStatusSemanticsSignature) return;
			await this.enterRecoveryRequired(
				error,
				{ source: 'v8-sync-recovery' },
				1,
			);
		});
	}

	private async enterRecoveryRequired(
		error: unknown,
		perfContext: IndexPerfContext,
		requestCount: number,
	): Promise<void> {
		const code = error instanceof IndexV8StorageError
			? error.code
			: error instanceof Error ? error.name : 'unknown';
		let markerStatus: 'written' | 'failed' = 'written';
		let markerErrorCode = '';
		try {
			await this.persistRecoveryRequiredMarker(perfContext, requestCount, code);
		} catch (markerError) {
			markerStatus = 'failed';
			markerErrorCode = markerError instanceof Error ? markerError.name : 'unknown';
		} finally {
			this.recoveryRequired = true;
			this.indexV8ShadowWriter?.setRuntimePhase?.('recovery-required');
			this.indexV8ShadowWriter?.disable(`PRIMARY_${code}`);
		}
		enginePerfLog(
			'index.v8.primary',
			'mode=recovery-required',
			`code=${code}`,
			`marker=${markerStatus}`,
			...(markerErrorCode ? [`markerCode=${markerErrorCode}`] : []),
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
			snapshotBuildMs: perfContext.snapshotBuildMs,
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
			snapshotBuildMs: (current.snapshotBuildMs ?? 0) + (next.snapshotBuildMs ?? 0),
		};
	}

	/** Preserve a verified V8 full-scan provenance before cached-startup diff work begins. */
	async adoptV8ShadowProvenance(): Promise<void> {
		if (!this.indexV8ShadowWriter || this.shuttingDown || !this.lastDurableCommittedAt) return;
		let durabilityBoundary = '';
		let semanticsSignature = '';
		await this.enqueueIndexOperation(async () => {
			await this.flushPendingPersist();
			durabilityBoundary = this.lastDurableCommittedAt;
			semanticsSignature = this.coherentIndexV8SemanticsSignature
				?? buildIndexV8SemanticsSignature(this.storage.getSettings());
		});
		const decision = await this.indexV8ShadowWriter.inspectStartupSeedOnce(
			durabilityBoundary,
			semanticsSignature,
		);
		if (decision.action !== 'current') return;
		await this.enqueueIndexOperation(async () => {
			const currentSemantics = this.coherentIndexV8SemanticsSignature
				?? buildIndexV8SemanticsSignature(this.storage.getSettings());
			if (this.lastDurableCommittedAt !== durabilityBoundary || currentSemantics !== semanticsSignature) return;
			this.coherenceBasis = decision.manifest.coherenceBasis;
			this.lastFullScanAt = decision.manifest.lastFullScanAt;
		});
	}

	/** Ensure a non-V8 startup state has exactly one matching V8 snapshot. */
	async ensureV8ShadowSeed(): Promise<void> {
		if (!this.indexV8ShadowWriter || this.shuttingDown || !this.lastDurableCommittedAt) return;
		let durabilityBoundary = '';
		let semanticsSignature = '';
		await this.enqueueIndexOperation(async () => {
			await this.flushPendingPersist();
			durabilityBoundary = this.lastDurableCommittedAt;
			semanticsSignature = this.coherentIndexV8SemanticsSignature
				?? buildIndexV8SemanticsSignature(this.storage.getSettings());
		});
		const decision = await this.indexV8ShadowWriter.inspectStartupSeed(
			durabilityBoundary,
			semanticsSignature,
		);
		await this.enqueueIndexOperation(async () => {
			const currentSemantics = this.coherentIndexV8SemanticsSignature
				?? buildIndexV8SemanticsSignature(this.storage.getSettings());
			if (this.lastDurableCommittedAt !== durabilityBoundary || currentSemantics !== semanticsSignature) return;
			if (decision.action === 'current') {
				this.coherenceBasis = decision.manifest.coherenceBasis;
				this.lastFullScanAt = decision.manifest.lastFullScanAt;
				return;
			}
			if (decision.action !== 'rewrite') return;
			await this.persistIndex({
				immediate: true,
				shadowImmediate: true,
				coherenceBasis: 'v7-startup-seed',
				perfContext: { source: 'v8-startup-seed' },
			});
		});
	}

	/** Downgrade V8 provenance immediately when settings can change scan semantics. */
	invalidateV8Coherence(): void {
		this.coherenceBasis = 'v7-startup-seed';
		this.coherentIndexV8SemanticsSignature = buildIndexV8SemanticsSignature(this.storage.getSettings());
	}

	async drainV8Shadow(): Promise<void> {
		await this.indexV8ShadowWriter?.drain();
	}

	async runIndexV8CleanupMaintenance(): Promise<boolean> {
		if (!this.indexV8Store?.planCleanup || !this.indexV8Store.applyCleanup
			|| !this.indexV8ShadowWriter || this.shuttingDown || this.recoveryRequired) return false;
		if (this.getIndexV8RuntimePhase() !== 'idle') return false;
		await this.flushPendingPersist();
		await this.indexV8ShadowWriter.drain();
		const ready = await this.enqueueIndexOperation(async () => (
			this.getIndexV8RuntimePhase() === 'idle' && !this.pendingPersistData && !this.shuttingDown
		));
		if (!ready) return false;
		const plan = await this.indexV8Store.planCleanup();
		if (plan.suppressedReasons.length > 0 || this.getIndexV8RuntimePhase() !== 'idle') return false;
		const result = await this.indexV8Store.applyCleanup(plan);
		enginePerfLog(
			'index.v8.cleanup',
			`status=${result.status}`,
			`candidates=${plan.candidates.length}`,
			`deleted=${result.deletedCount}`,
			`bytes=${result.deletedBytes}`,
			`suppressed=${plan.suppressedReasons.length}`,
		);
		return result.status !== 'stale' && result.status !== 'suppressed' && result.status !== 'partial';
	}

	async getIndexV8Diagnostics(): Promise<IndexV8DiagnosticSnapshot> {
		if (!this.indexV8Store?.diagnoseMaintenance) {
			return this.unavailableIndexV8Diagnostics();
		}
		const diagnostics = await this.indexV8Store.diagnoseMaintenance();
		const cleanupPlan = this.indexV8Store.planCleanup ? await this.indexV8Store.planCleanup() : null;
		const retirementPlan = this.indexV8Store.planLegacyIndexV7Retirement
			? await this.indexV8Store.planLegacyIndexV7Retirement()
			: null;
		const activeEntries = diagnostics.inspection.entries.filter(entry => entry.kind === 'active-shard');
		const activeBytes = activeEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
		const maxShardBytes = activeEntries.reduce((max, entry) => Math.max(max, entry.sizeBytes), 0);
		const runtimePhase = this.getIndexV8RuntimePhase();
		const markerPresent = diagnostics.recoveryMarker.status === 'required';
		const manifestStatus = diagnostics.inspection.manifestStatus;
		const health = this.resolveIndexV8Health(manifestStatus, runtimePhase, markerPresent);
		const codes: string[] = [];
		if (diagnostics.manifestCode) codes.push(diagnostics.manifestCode);
		if (markerPresent) codes.push('RECOVERY_MARKER_PRESENT');
		if ((cleanupPlan?.suppressedReasons.length ?? 0) > 0) codes.push('CLEANUP_SUPPRESSED');
		if ((retirementPlan?.suppressedReasons.length ?? 0) > 0) codes.push('RETIREMENT_BLOCKED');
		if (maxShardBytes >= 1_000_000 || (activeEntries.length > 0 && maxShardBytes / (activeBytes / activeEntries.length) > 3)) {
			codes.push('LAYOUT_REVIEW');
		}
		const cleanupCandidateBytes = cleanupPlan?.candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0) ?? 0;
		return {
			health,
			runtimePhase,
			verifiedThisSession: diagnostics.verifiedSnapshot,
			taskCount: this.tasks.size,
			sourceCount: this.sourceInstanceKeys.size,
			activeShardCount: activeEntries.length,
			protectedShardCount: diagnostics.inspection.protectedShardNames.length,
			activeBytes,
			maxShardBytes,
			averageShardBytes: activeEntries.length > 0 ? activeBytes / activeEntries.length : 0,
			maintenanceCounts: { ...diagnostics.entryCounts },
			maintenanceBytes: { ...diagnostics.entryBytes },
			cleanupCandidateCount: cleanupPlan?.candidates.length ?? 0,
			cleanupCandidateBytes,
			recoveryMarkerPresent: markerPresent,
			legacyV7: {
				present: diagnostics.legacyIndex.status === 'file',
				bytes: diagnostics.legacyIndex.fingerprint?.sizeBytes ?? 0,
				retirementEligible: retirementPlan?.suppressedReasons.length === 0
					&& runtimePhase === 'idle'
					&& !this.pendingPersistData
					&& !this.shuttingDown
					&& !this.recoveryRequired,
			},
			manifestStatus,
			dirtySourceCount: this.pendingPersistData?.dirty.dirtySourcePaths.size ?? 0,
			codes: [...new Set(codes)].sort(),
		};
	}

	async validateIndexV8Now(): Promise<IndexV8LoadResult> {
		return this.indexV8Store?.load() ?? {
			status: 'io-error', retryable: true, code: 'STORE_UNAVAILABLE',
			metrics: { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 },
		};
	}

	async runIndexV8CleanupNow(): Promise<IndexV8CleanupResult> {
		if (!this.indexV8Store?.planCleanup || !this.indexV8Store.applyCleanup) {
			return { status: 'suppressed', deletedCount: 0, deletedBytes: 0, skippedCount: 0, errorCodes: ['STORE_UNAVAILABLE'] };
		}
		if (this.getIndexV8RuntimePhase() !== 'idle' || this.shuttingDown || this.recoveryRequired) {
			return { status: 'suppressed', deletedCount: 0, deletedBytes: 0, skippedCount: 0, errorCodes: ['RUNTIME_BUSY'] };
		}
		await this.flushPendingPersist();
		await this.indexV8ShadowWriter?.drain();
		if (this.getIndexV8RuntimePhase() !== 'idle' || this.pendingPersistData) {
			return { status: 'suppressed', deletedCount: 0, deletedBytes: 0, skippedCount: 0, errorCodes: ['RUNTIME_BUSY'] };
		}
		const plan = await this.indexV8Store.planCleanup();
		return await this.indexV8Store.applyCleanup(plan);
	}

	async retireLegacyIndexV7(): Promise<IndexV7RetirementResult> {
		if (!this.indexV8Store?.planLegacyIndexV7Retirement || !this.indexV8Store.applyLegacyIndexV7Retirement) {
			return { status: 'suppressed', deletedBytes: 0, errorCodes: ['STORE_UNAVAILABLE'] };
		}
		if (this.getIndexV8RuntimePhase() !== 'idle' || this.shuttingDown || this.recoveryRequired) {
			return { status: 'suppressed', deletedBytes: 0, errorCodes: ['RUNTIME_BUSY'] };
		}
		await this.flushPendingPersist();
		await this.indexV8ShadowWriter?.drain();
		if (this.getIndexV8RuntimePhase() !== 'idle' || this.pendingPersistData) {
			return { status: 'suppressed', deletedBytes: 0, errorCodes: ['RUNTIME_BUSY'] };
		}
		const plan = await this.indexV8Store.planLegacyIndexV7Retirement();
		return await this.indexV8Store.applyLegacyIndexV7Retirement(plan);
	}

	async repairIndexV8FromMarkdown(): Promise<{
		status: 'applied' | 'suppressed' | 'failed';
		shardsWritten: number;
		bytesWritten: number;
		codes: string[];
	}> {
		if (!this.indexV8Store?.planCanonicalV8Reset || !this.indexV8Store.applyCanonicalV8Reset
			|| !this.indexV8ShadowWriter || this.shuttingDown) {
			return { status: 'suppressed', shardsWritten: 0, bytesWritten: 0, codes: ['STORE_UNAVAILABLE'] };
		}
		return await this.enqueueIndexOperation(async () => {
			await this.flushPendingPersist();
			await this.indexV8ShadowWriter?.drain();
			this.discardPendingPersist();
			const storage = this.storage as OperonStorage & {
				markIndexV8RecoveryRequired?: () => Promise<void>;
				clearIndexV8RecoveryRequired?: () => Promise<void>;
			};
			await storage.markIndexV8RecoveryRequired?.();
			const built = await this.buildFullIndexState();
			const committedAt = new Date().toISOString();
			const indexData = this.sealIndexStateData(
				built.state,
				built.workflowStatusSemanticsSignature,
				committedAt,
			);
			const sourceStats = this.buildSourceStatsFromState(built.state);
			const candidate = await buildIndexV8Snapshot({
				committedAt,
				lastFullScanAt: committedAt,
				coherenceBasis: 'verified-full-scan',
				indexSemanticsSignature: built.indexV8SemanticsSignature,
				sources: projectIndexDataToV8Sources(indexData, sourceStats),
				canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(indexData),
			});
			const resetPlan = await this.indexV8Store!.planCanonicalV8Reset!(candidate.shardPayloads);
			const reset = await this.indexV8Store!.applyCanonicalV8Reset!(resetPlan);
			if (reset.status !== 'applied') {
				return { status: 'suppressed', shardsWritten: 0, bytesWritten: 0, codes: reset.errorCodes };
			}
			this.indexV8ShadowWriter!.beginSealedRepair();
			try {
				const result = await this.indexV8ShadowWriter!.persistPrimary({
					sequence: ++this.persistenceSequence,
					indexData,
					sourceStats,
					committedAt,
					lastFullScanAt: committedAt,
					indexSemanticsSignature: built.indexV8SemanticsSignature,
					coherenceBasis: 'verified-full-scan',
					incrementalParityProjection: projectIndexV8IncrementalParity(built.state.tasks, built.state.secondary),
				}, {
					sequence: this.persistenceSequence,
					dirtySourcePaths: new Set(built.state.sourceInstanceKeys.keys()),
					affectedOperonIds: new Set(built.state.tasks.keys()),
					forceFull: true,
				}, {
					sourceInstanceKeys: built.state.sourceInstanceKeys,
					sourcePathsByShard: built.state.sourcePathsByShard,
				});
				this.commitIndexState(built.state);
				this.coherentWorkflowStatusSemanticsSignature = built.workflowStatusSemanticsSignature;
				this.coherentIndexV8SemanticsSignature = built.indexV8SemanticsSignature;
				this.lastFullScanAt = committedAt;
				this.lastDurableCommittedAt = result.committedAt;
				this.lastSavedAt = Date.parse(result.committedAt);
				this.coherenceBasis = 'verified-full-scan';
				this.generation += 1;
				await storage.clearIndexV8RecoveryRequired?.();
				this.recoveryRequired = false;
				this.indexV8ShadowWriter!.setRuntimePhase('idle');
				this.emitIndexReconciliation({ kind: 'full', generation: this.generation });
				this.onIndexUpdated?.();
				return {
					status: 'applied' as const,
					shardsWritten: result.shardsWritten,
					bytesWritten: result.bytesWritten,
					codes: [],
				};
			} catch (error) {
				this.indexV8ShadowWriter!.setRuntimePhase('recovery-required');
				this.indexV8ShadowWriter!.disable('REPAIR_FAILED');
				return {
					status: 'failed' as const,
					shardsWritten: 0,
					bytesWritten: 0,
					codes: [error instanceof Error ? error.name : 'REPAIR_FAILED'],
				};
			}
		});
	}

	private sealIndexStateData(state: IndexState, workflowSignature: string, committedAt: string): IndexData {
		return sealIndexData({
			version: INDEX_VERSION,
			workflowStatusSemanticsSignature: workflowSignature,
			lastFullReindex: committedAt,
			tasks: Object.fromEntries(state.tasks),
			taskInstances: Object.fromEntries(state.taskInstances),
		});
	}

	private buildSourceStatsFromState(state: IndexState): Map<string, IndexV8SourceStat> {
		const stats = new Map<string, IndexV8SourceStat>();
		for (const path of state.sourceInstanceKeys.keys()) {
			stats.set(path, {
				mtimeMs: state.fileMtimes.get(path) ?? 0,
				sizeBytes: state.fileSizes.get(path) ?? 0,
			});
		}
		return stats;
	}

	private resolveIndexV8Health(
		manifestStatus: IndexV8LoadResult['status'],
		phase: IndexV8RuntimePhase,
		markerPresent: boolean,
	): IndexV8HealthState {
		if (markerPresent || phase === 'recovery-required') return 'recovery-required';
		if (phase === 'sync-settling' || phase === 'rebasing') return 'sync-settling';
		if (manifestStatus === 'loaded') return 'healthy';
		if (manifestStatus === 'io-error') return 'incomplete';
		return manifestStatus;
	}

	private unavailableIndexV8Diagnostics(): IndexV8DiagnosticSnapshot {
		return {
			health: 'missing', runtimePhase: this.getIndexV8RuntimePhase(), verifiedThisSession: false,
			taskCount: this.tasks.size, sourceCount: this.sourceInstanceKeys.size, activeShardCount: 0,
			protectedShardCount: 0,
			activeBytes: 0, maxShardBytes: 0, averageShardBytes: 0,
			maintenanceCounts: {}, maintenanceBytes: {}, cleanupCandidateCount: 0, cleanupCandidateBytes: 0,
			recoveryMarkerPresent: this.recoveryRequired,
			legacyV7: { present: false, bytes: 0, retirementEligible: false },
			manifestStatus: 'missing', dirtySourceCount: this.pendingPersistData?.dirty.dirtySourcePaths.size ?? 0,
			codes: ['STORE_UNAVAILABLE'],
		};
	}

	async prepareForUnload(): Promise<void> {
		// Let an already bounded settle/rebase reach a deterministic V8 or emergency
		// boundary before shutdown starts suppressing new index work.
		if (this.syncRecovery) await this.syncRecovery;
		this.shuttingDown = true;
		if (this.reindexTimer) {
			clearWindowTimeout(this.reindexTimer);
			this.reindexTimer = null;
		}
		this.pendingFiles.clear();
		await this.indexOperationTail;
		await this.flushPendingPersist();
		// Unload cannot leave a delayed primary retry behind; the second attempt
		// either commits V8 or durably marks the session as recovery-required.
		if (this.pendingPersistData) await this.flushPendingPersist();
		await this.indexOperationTail;
		try {
			await this.drainV8Shadow();
		} catch (error) {
			enginePerfLog(
				'index.v8.shadow.unload',
				'status=failed',
				`code=${error instanceof Error ? error.name : 'unknown'}`,
			);
		}
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
		this.reconcileExpectedDuplicateTransition(normalizedOperonId);

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
			this.reconcileExpectedDuplicateTransition(normalizedOperonId);
		};
	}

	private reconcileExpectedDuplicateTransition(operonId: string): void {
		const hadConflict = this.duplicateConflicts.has(operonId);
		this.reconcileOperonId(operonId);
		if (hadConflict === this.duplicateConflicts.has(operonId)) return;
		this.generation += 1;
		this.emitIncrementalReconciliation([operonId]);
	}

	getGeneration(): number {
		return this.generation;
	}

	subscribeIndexReconciliation(listener: (event: IndexReconciliationEvent) => void): () => void {
		this.reconciliationListeners.add(listener);
		return () => this.reconciliationListeners.delete(listener);
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
		this.reconciliationListeners.clear();
		this.indexV8ShadowWriter?.destroy();
	}

	private snapshotTasksByFile(filePath: string): Map<string, IndexedTask | undefined> {
		const snapshot = new Map<string, IndexedTask | undefined>();
		for (const operonId of this.secondary.getTasksInFile(filePath)) {
			snapshot.set(operonId, this.tasks.get(operonId));
		}
		return snapshot;
	}

	private snapshotCanonicalTasksByInstanceFile(filePath: string): Map<string, IndexedTask | undefined> {
		const snapshot = new Map<string, IndexedTask | undefined>();
		for (const instance of this.taskInstances.values()) {
			if (instance.primary.filePath !== filePath || snapshot.has(instance.operonId)) continue;
			snapshot.set(instance.operonId, this.tasks.get(instance.operonId));
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

	private emitIncrementalReconciliation(affectedOperonIds: Iterable<string>): void {
		this.emitIndexReconciliation({
			kind: 'incremental',
			generation: this.generation,
			affectedOperonIds: [...new Set(affectedOperonIds)],
		});
	}

	private emitIndexReconciliation(event: IndexReconciliationEvent): void {
		for (const listener of this.reconciliationListeners) {
			try {
				listener(event);
			} catch (error) {
				console.warn('Operon: Index reconciliation listener failed', error);
			}
		}
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
