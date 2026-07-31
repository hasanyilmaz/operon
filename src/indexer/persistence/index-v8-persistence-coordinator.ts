import type { IndexData } from '../../types/fields';
import { enginePerfLog, enginePerfNow } from '../../core/engine-perf';
import { getActiveWindow } from '../../core/dom-compat';
import {
	buildIndexV8Snapshot,
	getIndexV8CanonicalInstanceKeys,
	IndexV8CodecError,
	projectIndexDataToV8Sources,
	type IndexV8SourceStat,
} from './index-v8-codec';
import type { IndexV8CoherenceBasis } from './index-v8-contract';
import {
	assertIndexV8IncrementalParity,
	assertIndexV8Parity,
	IndexV8ParityError,
	type IndexV8IncrementalParityProjection,
} from './index-v8-parity';
import {
	IndexV8StorageError,
	type IndexV8CommitResult,
	type IndexV8IncrementalCommit,
	type IndexV8SnapshotPayloads,
} from './index-v8-store';
import {
	buildIndexV8BaselineMembership,
	compileIndexV8Incremental,
	type IndexV8BaselineMembership,
	type IndexV8DirtyBatch,
	type IndexV8RamSourceIndexes,
} from './index-v8-incremental-compiler';

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;

export interface IndexV8PersistenceInput {
	sequence: number;
	indexData: Readonly<IndexData>;
	sourceStats: ReadonlyMap<string, IndexV8SourceStat>;
	committedAt: string;
	lastFullScanAt: string;
	indexSemanticsSignature: string;
	coherenceBasis: IndexV8CoherenceBasis;
	incrementalParityProjection?: IndexV8IncrementalParityProjection;
}

export interface IndexV8PersistenceStatus {
	enabled: boolean;
	phase: 'idle' | 'scheduled' | 'running' | 'retrying' | 'disabled';
	attempted: number;
	succeeded: number;
	failed: number;
	coalesced: number;
	pendingDepth: 0 | 1;
	lastSuccessfulSnapshotId?: string;
	lastErrorCode?: string;
	coherenceBasis?: IndexV8CoherenceBasis;
}

export type IndexV8RuntimePhase = 'idle' | 'sync-settling' | 'rebasing' | 'recovery-required';

export interface IndexV8PersistenceStore {
	commit(snapshot: IndexV8SnapshotPayloads): Promise<IndexV8CommitResult>;
	commitIncremental?(input: IndexV8IncrementalCommit): Promise<IndexV8CommitResult>;
}

export interface IndexV8PersistResult {
	status: 'committed' | 'unchanged';
	mode: 'full' | 'incremental';
	sequence: number;
	snapshotId: string;
	committedAt: string;
	dirtyShardCount: number;
	shardsWritten: number;
	shardsReused: number;
	bytesWritten: number;
}

export interface IndexV8PersistenceScheduler {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
	delay(delayMs: number): Promise<void>;
}

interface PendingPersistenceInput {
	input: IndexV8PersistenceInput;
	immediate: boolean;
	retryCount: number;
}

export class IndexV8PersistenceCoordinator {
	private readonly scheduler: IndexV8PersistenceScheduler;
	private readonly debounceMs: number;
	private readonly maxDelayMs: number;
	private readonly retryDelayMs: number;
	private timer: unknown = null;
	private pending: PendingPersistenceInput | null = null;
	private pendingSinceMs = 0;
	private retryNotBeforeMs = 0;
	private active: Promise<void> | null = null;
	private permanentlyDisabled = false;
	private lastCommittedSequence = 0;
	private highestAcceptedSequence = 0;
	private primaryBaselineManifestPayload: string | null = null;
	private primaryBaselineMembership: IndexV8BaselineMembership | null = null;
	private runtimePhase: IndexV8RuntimePhase = 'idle';
	private status: IndexV8PersistenceStatus;

	constructor(
		private readonly store: IndexV8PersistenceStore,
		options: {
			debounceMs?: number;
			maxDelayMs?: number;
			retryDelayMs?: number;
			scheduler?: IndexV8PersistenceScheduler;
		} = {},
	) {
		this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
		this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.scheduler = options.scheduler ?? createDefaultScheduler();
		this.status = {
			enabled: true,
			phase: 'idle',
			attempted: 0,
			succeeded: 0,
			failed: 0,
			coalesced: 0,
			pendingDepth: 0,
		};
	}

	getStatus(): IndexV8PersistenceStatus {
		const enabled = this.isEnabled();
		return {
			...this.status,
			enabled,
			phase: enabled ? this.status.phase : 'disabled',
			pendingDepth: this.pending ? 1 : 0,
		};
	}

	getRuntimePhase(): IndexV8RuntimePhase {
		return this.runtimePhase;
	}

	setRuntimePhase(phase: IndexV8RuntimePhase): void {
		if (this.runtimePhase === 'recovery-required' && phase !== 'recovery-required') return;
		this.runtimePhase = phase;
	}

	isVerifiedBaseline(manifestPayload: string): boolean {
		return this.primaryBaselineManifestPayload === manifestPayload;
	}

	/** Adopt a manifest that has already passed the store's full startup validation. */
	adoptVerifiedBaseline(manifestPayload: string, authority: Readonly<IndexData>): void {
		this.primaryBaselineManifestPayload = manifestPayload;
		this.primaryBaselineMembership = buildIndexV8BaselineMembership(authority);
	}

	clearPrimaryBaseline(): void {
		this.primaryBaselineManifestPayload = null;
		this.primaryBaselineMembership = null;
	}

	/** Re-arm V8 only for an explicitly confirmed, sealed Markdown repair. */
	beginSealedRepair(): void {
		this.clearTimer();
		this.pending = null;
		this.pendingSinceMs = 0;
		this.retryNotBeforeMs = 0;
		this.permanentlyDisabled = false;
		this.primaryBaselineManifestPayload = null;
		this.primaryBaselineMembership = null;
		this.runtimePhase = 'rebasing';
		this.status.enabled = true;
		this.status.phase = 'idle';
		this.status.pendingDepth = 0;
		this.status.lastErrorCode = undefined;
	}

	async persistPrimary(
		input: IndexV8PersistenceInput,
		dirtyBatch: IndexV8DirtyBatch,
		sourceIndexes: IndexV8RamSourceIndexes,
	): Promise<IndexV8PersistResult> {
		if (!this.isEnabled()) {
			throw new IndexV8StorageError('INVALID_SNAPSHOT', 'V8 primary persistence is disabled for this session');
		}
		const compileStartedAt = enginePerfNow();
		const compiled = await compileIndexV8Incremental({
			...(this.primaryBaselineManifestPayload
				? { baseManifestPayload: this.primaryBaselineManifestPayload }
				: {}),
			indexData: input.indexData,
			sourceStats: input.sourceStats,
			sourceIndexes,
			...(this.primaryBaselineMembership ? { baseMembership: this.primaryBaselineMembership } : {}),
			dirtyBatch,
			committedAt: input.committedAt,
			lastFullScanAt: input.lastFullScanAt,
			indexSemanticsSignature: input.indexSemanticsSignature,
			coherenceBasis: input.coherenceBasis,
		});
		const compileMs = enginePerfNow() - compileStartedAt;
		let committed: IndexV8CommitResult | null = null;
		if (compiled.status === 'changed') {
			if (compiled.mode === 'full') {
				const snapshot = {
					manifest: compiled.manifest,
					manifestPayload: compiled.manifestPayload,
					shards: [],
					shardPayloads: compiled.changedShardPayloads,
				};
				await assertIndexV8Parity(input.indexData, snapshot, Date.now(), input.sourceStats);
				committed = await this.store.commit({
					manifestPayload: compiled.manifestPayload,
					shardPayloads: compiled.changedShardPayloads,
					...(compiled.expectedBaseSnapshotId && compiled.expectedBaseManifestPayload ? {
						expectedBaseSnapshotId: compiled.expectedBaseSnapshotId,
						expectedBaseManifestPayload: compiled.expectedBaseManifestPayload,
					} : { expectedBaseMissing: true }),
				});
			} else {
				if (!this.store.commitIncremental
					|| !compiled.expectedBaseSnapshotId
					|| !compiled.expectedBaseManifestPayload) {
					throw new IndexV8StorageError('INVALID_SNAPSHOT', 'Incremental V8 store contract is unavailable');
				}
				if (!input.incrementalParityProjection) {
					throw new IndexV8StorageError('INVALID_SNAPSHOT', 'Incremental V8 parity projection is unavailable');
				}
				await assertIndexV8IncrementalParity(input.indexData, input.incrementalParityProjection);
				committed = await this.store.commitIncremental({
					expectedBaseSnapshotId: compiled.expectedBaseSnapshotId,
					expectedBaseManifestPayload: compiled.expectedBaseManifestPayload,
					manifestPayload: compiled.manifestPayload,
					changedShardPayloads: compiled.changedShardPayloads,
				});
			}
			this.primaryBaselineManifestPayload = compiled.manifestPayload;
			this.primaryBaselineMembership = compiled.baselineMembership;
		} else {
			// An unchanged projection still proves that the latest RAM membership
			// matches the active content-addressed snapshot.
			this.primaryBaselineMembership = compiled.baselineMembership;
		}
		const result: IndexV8PersistResult = {
			status: compiled.status === 'unchanged' ? 'unchanged' : committed?.status ?? 'committed',
			mode: compiled.mode,
			sequence: input.sequence,
			snapshotId: compiled.manifest.snapshotId,
			committedAt: compiled.manifest.committedAt,
			dirtyShardCount: compiled.dirtyShardIds.length,
			shardsWritten: committed?.shardsWritten ?? 0,
			shardsReused: committed?.shardsReused ?? compiled.shardsReused,
			bytesWritten: committed?.bytesWritten ?? 0,
		};
		enginePerfLog(
			'index.v8.primary.persist',
			`status=${result.status}`,
			`mode=${result.mode}`,
			`sequence=${result.sequence}`,
			`dirtyShards=${result.dirtyShardCount}`,
			`shardsWritten=${result.shardsWritten}`,
			`shardsReused=${result.shardsReused}`,
			`bytesWritten=${result.bytesWritten}`,
			`compileMs=${Math.round(compileMs)}`,
		);
		return result;
	}

	enqueue(input: IndexV8PersistenceInput, options: { immediate?: boolean } = {}): void {
		if (!this.isEnabled()) return;
		const sealed = sealIndexV8PersistenceInput(input);
		if (sealed.sequence <= this.highestAcceptedSequence) {
			this.status.coalesced += 1;
			return;
		}
		this.highestAcceptedSequence = sealed.sequence;
		if (this.pending) this.status.coalesced += 1;
		else this.pendingSinceMs = this.scheduler.now();
		this.pending = {
			input: sealed,
			immediate: options.immediate === true,
			retryCount: 0,
		};
		this.retryNotBeforeMs = 0;
		this.status.pendingDepth = 1;
		if (this.active) return;
		this.schedulePending();
	}

	async drain(): Promise<void> {
		this.clearTimer();
		while (this.active || this.pending) {
			if (!this.active && this.pending) this.startPending();
			const active = this.active;
			if (active) await active;
		}
	}

	disable(code: string): void {
		this.permanentlyDisabled = true;
		this.clearTimer();
		this.pending = null;
		this.status.enabled = false;
		this.status.pendingDepth = 0;
		this.status.phase = 'disabled';
		this.status.lastErrorCode = code;
	}

	destroy(): void {
		this.disable('PERSISTENCE_DESTROYED');
	}

	private schedulePending(): void {
		if (!this.pending || this.active || !this.isEnabled()) return;
		this.clearTimer();
		const elapsed = Math.max(0, this.scheduler.now() - this.pendingSinceMs);
		const normalDelayMs = this.pending.immediate
			? 0
			: Math.max(0, Math.min(this.debounceMs, this.maxDelayMs - elapsed));
		const delayMs = Math.max(normalDelayMs, this.retryNotBeforeMs - this.scheduler.now());
		this.status.phase = this.pending.retryCount > 0 ? 'retrying' : 'scheduled';
		if (delayMs === 0) {
			this.startPending();
			return;
		}
		this.timer = this.scheduler.setTimeout(() => {
			this.timer = null;
			this.startPending();
		}, delayMs);
	}

	private startPending(): void {
		if (!this.pending || this.active || !this.isEnabled()) return;
		this.clearTimer();
		const job = this.pending;
		this.pending = null;
		this.retryNotBeforeMs = 0;
		this.status.pendingDepth = 0;
		this.active = this.runJob(job).finally(() => {
			this.active = null;
			if (this.pending) this.schedulePending();
			else if (this.isEnabled() && this.status.phase !== 'retrying') this.status.phase = 'idle';
		});
	}

	private async runJob(job: PendingPersistenceInput): Promise<void> {
		const startedAt = enginePerfNow();
		this.status.phase = 'running';
		this.status.attempted += 1;
		try {
			const sources = projectIndexDataToV8Sources(job.input.indexData, job.input.sourceStats);
			if (job.input.coherenceBasis === 'verified-full-scan'
				&& sources.some(source => source.mtimeMs <= 0 || source.sizeBytes <= 0)) {
				throw new IndexV8CodecError('Verified full-scan source metadata is incomplete');
			}
			const snapshot = await buildIndexV8Snapshot({
				committedAt: job.input.committedAt,
				lastFullScanAt: job.input.lastFullScanAt,
				coherenceBasis: job.input.coherenceBasis,
				indexSemanticsSignature: job.input.indexSemanticsSignature,
				sources,
				canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(job.input.indexData),
			});
			await assertIndexV8Parity(
				job.input.indexData,
				snapshot,
				Date.parse(job.input.committedAt),
				job.input.sourceStats,
			);
			const result = await this.store.commit(snapshot);
			this.lastCommittedSequence = job.input.sequence;
			this.status.succeeded += 1;
			this.status.lastSuccessfulSnapshotId = result.snapshotId;
			this.status.coherenceBasis = job.input.coherenceBasis;
			this.status.lastErrorCode = undefined;
			enginePerfLog(
				'index.v8.persistence',
				`sequence=${job.input.sequence}`,
				`status=${result.status}`,
				`snapshotId=${result.snapshotId}`,
				`shardsWritten=${result.shardsWritten}`,
				`shardsReused=${result.shardsReused}`,
				`bytesWritten=${result.bytesWritten}`,
				`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
			);
		} catch (error) {
			this.status.failed += 1;
			const code = getPersistenceErrorCode(error);
			this.status.lastErrorCode = code;
			enginePerfLog(
				'index.v8.persistence',
				`sequence=${job.input.sequence}`,
				'status=failed',
				`code=${code}`,
				`totalMs=${Math.round(enginePerfNow() - startedAt)}`,
			);
			if (mustDisablePersistence(error)) {
				this.disable(code);
				return;
			}
			if (job.retryCount === 0 && isRetryablePersistenceError(error) && !this.hasNewerPending(job.input.sequence)) {
				this.pending = { ...job, immediate: false, retryCount: 1 };
				this.pendingSinceMs = this.scheduler.now();
				this.retryNotBeforeMs = this.scheduler.now() + this.retryDelayMs;
				this.status.pendingDepth = 1;
				this.status.phase = 'retrying';
			}
		}
	}

	private hasNewerPending(sequence: number): boolean {
		return (this.pending?.input.sequence ?? 0) > sequence;
	}

	private isEnabled(): boolean {
		return !this.permanentlyDisabled;
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		this.scheduler.clearTimeout(this.timer);
		this.timer = null;
	}
}

export function sealIndexData(data: IndexData): IndexData {
	return {
		...data,
		tasks: Object.fromEntries(Object.entries(data.tasks).map(([key, task]) => [key, cloneTask(task)])),
		...(data.taskInstances ? {
			taskInstances: Object.fromEntries(Object.entries(data.taskInstances).map(([key, task]) => [key, {
				...cloneTask(task),
				instanceKey: task.instanceKey,
			}])),
		} : {}),
	};
}

export function sealIndexV8PersistenceInput(input: IndexV8PersistenceInput): IndexV8PersistenceInput {
	return {
		...input,
		indexData: sealIndexData(input.indexData),
		sourceStats: new Map(Array.from(input.sourceStats, ([path, stat]) => [path, { ...stat }])),
		...(input.incrementalParityProjection ? {
			incrementalParityProjection: structuredClone(input.incrementalParityProjection),
		} : {}),
	};
}

function cloneTask<T extends IndexData['tasks'][string]>(task: T): T {
	return {
		...task,
		fieldValues: { ...task.fieldValues },
		tags: [...task.tags],
		primary: { ...task.primary },
		...(task.plainCheckboxProgress ? {
			plainCheckboxProgress: { ...task.plainCheckboxProgress },
		} : {}),
	};
}

function mustDisablePersistence(error: unknown): boolean {
	return error instanceof IndexV8CodecError
		|| (error instanceof IndexV8StorageError
			&& (error.code === 'INVALID_SNAPSHOT' || error.code === 'CONTENT_ADDRESS_CONFLICT'))
		|| (error instanceof IndexV8ParityError && error.code === 'PARITY_NORMALIZATION_COLLISION');
}

function isRetryablePersistenceError(error: unknown): boolean {
	if (error instanceof IndexV8ParityError || error instanceof IndexV8CodecError) return false;
	if (error instanceof IndexV8StorageError) {
		return error.code === 'SHARD_POSTFLIGHT_FAILED'
			|| error.code === 'MANIFEST_POSTFLIGHT_FAILED'
			|| error.code === 'SNAPSHOT_POSTFLIGHT_FAILED';
	}
	return error instanceof Error && error.name === 'IndexV8TransientIoError';
}

function getPersistenceErrorCode(error: unknown): string {
	if (error instanceof IndexV8ParityError || error instanceof IndexV8StorageError) return error.code;
	if (error instanceof IndexV8CodecError) return 'CODEC_INVALID';
	return 'PERSISTENCE_IO';
}

function createDefaultScheduler(): IndexV8PersistenceScheduler {
	const win = getActiveWindow();
	return {
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
		clearTimeout: handle => win.clearTimeout(handle as ReturnType<Window['setTimeout']>),
		delay: delayMs => new Promise(resolve => win.setTimeout(resolve, delayMs)),
	};
}
