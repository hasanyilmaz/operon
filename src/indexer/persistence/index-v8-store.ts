import type { DataAdapter } from 'obsidian';
import { enginePerfLog, enginePerfNow, isOperonEnginePerfDebugEnabled } from '../../core/engine-perf';
import type { OperonStoragePaths } from '../../storage/operon-storage-paths';
import { writeTextSafely } from '../../storage/storage-file-ops';
import { WriteQueue } from '../../storage/write-queue';
import {
	INDEX_V8_MAX_MANIFEST_BYTES,
	INDEX_V8_MAX_SHARD_BYTES,
	type IndexManifestV8,
	type IndexShardDescriptorV8,
	type IndexShardV8,
	type IndexV8ShardId,
} from './index-v8-contract';
import {
	finalizeValidatedIndexV8Snapshot,
	IndexV8CodecError,
	utf8ByteLength,
	validateIndexV8ShardBinaryPayload,
	validateIndexV8ShardPayload,
	validateIndexV8Manifest,
	validateIndexV8Snapshot,
	sha256Hex,
	type ValidatedIndexV8Manifest,
	type ValidatedIndexV8ShardPart,
	type ValidatedIndexV8Snapshot,
} from './index-v8-codec';

const DEFAULT_IO_CONCURRENCY = 4;
const MAX_LOAD_PIPELINE_CONCURRENCY = 4;
const MAX_IO_CONCURRENCY = 8;
const CONTENT_ADDRESSED_SHARD = /^(?:0[0-9a-f]|1[0-9a-f])-[a-f0-9]{64}\.json$/u;
const OWNED_SHARD_TEMP_FILE = /^(?:0[0-9a-f]|1[0-9a-f])-[a-f0-9]{64}\.json\.tmp-\d{10,}-[a-z0-9]{6}$/u;
const OWNED_MANIFEST_TEMP_FILE = /^manifest\.json\.tmp-\d{10,}-[a-z0-9]{6}$/u;
const ALTERNATE_MANIFEST_FILE = /^manifest(?: \([^/]*(?:conflict|conflicted)[^/]*\)|\.sync-conflict-[a-z0-9._-]+)\.json$/iu;
const OWNED_SHARD_CLEANUP_CLAIM = /^(?:0[0-9a-f]|1[0-9a-f])-[a-f0-9]{64}\.json\.cleanup-\d{10,}-[a-z0-9]{6}$/u;
const OWNED_MANIFEST_CLEANUP_CLAIM = /^manifest(?: \([^/]*(?:conflict|conflicted)[^/]*\)|\.sync-conflict-[a-z0-9._-]+)?\.json\.cleanup-\d{10,}-[a-z0-9]{6}$/iu;
const DEFAULT_CLEANUP_MAX_FILES = 32;
const DEFAULT_CLEANUP_MAX_BYTES = 16_000_000;
const MAX_RECOVERY_MARKER_BYTES = 4_096;
const RECOVERY_MARKER_PAYLOAD = '{"version":1,"required":true}';
const ADAPTER_WRITE_QUEUES = new WeakMap<object, WriteQueue>();

export type IndexV8StoragePaths = OperonStoragePaths['runtime']['indexV8'];

export interface IndexV8SnapshotPayloads {
	manifestPayload: string;
	shardPayloads: Map<IndexV8ShardId, string>;
	expectedBaseSnapshotId?: string;
	expectedBaseManifestPayload?: string;
	expectedBaseMissing?: boolean;
}

export interface IndexV8IncrementalCommit {
	expectedBaseSnapshotId: string;
	expectedBaseManifestPayload: string;
	manifestPayload: string;
	changedShardPayloads: ReadonlyMap<IndexV8ShardId, string>;
}

export interface IndexV8LoadMetrics {
	manifestBytes: number;
	shardBytes: number;
	shardsRead: number;
	manifestStatMs?: number;
	manifestReadMs?: number;
	manifestValidationMs?: number;
	manifestValidationPasses?: number;
	shardPhaseMs?: number;
	shardStatMs?: number;
	shardReadMs?: number;
	shardValidationMs?: number;
	shardValidationPasses?: number;
	maxShardValidationConcurrency?: number;
	globalValidationMs?: number;
	globalValidationPasses?: number;
	hydrationMs?: number;
	secondaryRebuildMs?: number;
	totalMs: number;
}

interface IndexV8LoadBase {
	metrics: IndexV8LoadMetrics;
}

export type IndexV8LoadResult =
	| (IndexV8LoadBase & { status: 'missing' })
	| (IndexV8LoadBase & {
		status: 'loaded';
		manifest: IndexManifestV8;
		manifestPayload: string;
		shards: IndexShardV8[];
		validatedSnapshot: ValidatedIndexV8Snapshot;
	})
	| (IndexV8LoadBase & {
		status: 'incomplete';
		retryable: true;
		snapshotId: string;
		manifest: IndexManifestV8;
		manifestPayload: string;
		missingShardIds: IndexV8ShardId[];
	})
	| (IndexV8LoadBase & { status: 'invalid'; retryable: false; code: string })
	| (IndexV8LoadBase & { status: 'unsupported'; retryable: false; code: string })
	| (IndexV8LoadBase & { status: 'io-error'; retryable: true; code: string });

export interface IndexV8CommitMetrics {
	preflightMs: number;
	transactionQueueWaitMs: number;
	ensureFoldersMs: number;
	shardPhaseMs: number;
	shardExistsMs: number;
	shardReadMs: number;
	shardWriteMs: number;
	shardVerifyMs: number;
	manifestWriteMs: number;
	manifestVerifyMs: number;
	postflightMs: number;
	totalMs: number;
}

export interface IndexV8CommitResult {
	status: 'committed' | 'unchanged';
	snapshotId: string;
	shardsWritten: number;
	shardsReused: number;
	bytesWritten: number;
	manifestWritten: boolean;
	ioConcurrency: number;
	metrics: IndexV8CommitMetrics;
}

export interface IndexV8StorageEntry {
	name: string;
	path: string;
	kind: 'active-shard' | 'orphan-shard' | 'owned-temp' | 'alternate-manifest' | 'foreign';
	sizeBytes: number;
	mtimeMs: number;
	shardId?: IndexV8ShardId;
	sha256?: string;
}

export interface IndexV8StorageInspection {
	manifestStatus: IndexV8LoadResult['status'];
	manifestCode?: string;
	activeSnapshotId?: string;
	activeManifestPayload?: string;
	entries: IndexV8StorageEntry[];
	protectedShardNames: string[];
	cleanupSuppressedReasons: string[];
}

export interface IndexV8CleanupOptions {
	nowMs?: number;
	maxFiles?: number;
	maxBytes?: number;
}

export interface IndexV8CleanupCandidate {
	name: string;
	kind: 'alternate-manifest' | 'orphan-shard' | 'owned-temp';
	path: string;
	sizeBytes: number;
	mtimeMs: number;
}

export interface IndexV8CleanupPlan {
	activeSnapshotId: string;
	expectedManifestPayload: string;
	inspectedAt: number;
	candidates: IndexV8CleanupCandidate[];
	hasMoreCandidates: boolean;
	suppressedReasons: string[];
}

export interface IndexV8CleanupResult {
	status: 'applied' | 'unchanged' | 'stale' | 'suppressed' | 'partial';
	deletedCount: number;
	deletedBytes: number;
	skippedCount: number;
	backlogRemaining: boolean;
	errorCodes: string[];
}

export interface IndexV8FileFingerprint {
	sizeBytes: number;
	mtimeMs: number;
}

export interface IndexV8MaintenanceDiagnostics {
	inspection: IndexV8StorageInspection;
	manifestCode?: string;
	verifiedSnapshot: boolean;
	entryCounts: Record<IndexV8StorageEntry['kind'], number>;
	entryBytes: Record<IndexV8StorageEntry['kind'], number>;
	recoveryMarker: { status: 'missing' | 'required' | 'invalid' | 'io-error' };
}

export interface IndexV8CanonicalResetPlan {
	manifestStatus: IndexV8LoadResult['status'];
	expectedManifestPayload: string;
	manifestPayloadReadable: boolean;
	manifestFingerprint: IndexV8FileFingerprint | null;
	expectedRecoveryMarkerPayload: string | null;
	plannedAt: number;
	conflictingShards: Array<{
		path: string;
		fingerprint: IndexV8FileFingerprint;
		expectedPayload: string;
	}>;
	suppressedReasons: string[];
}

export interface IndexV8CanonicalResetResult {
	status: 'applied' | 'unchanged' | 'stale' | 'suppressed' | 'partial';
	recoveryMarkerCreated: boolean;
	manifestRemoved: boolean;
	conflictingShardsRemoved: number;
	errorCodes: string[];
}

export interface IndexV8StoreOptions {
	ioConcurrency?: number;
	collectLoadMetrics?: boolean;
	recoveryRequiredPath?: string;
}

export type IndexV8StorageErrorCode =
	| 'INVALID_SNAPSHOT'
	| 'BASE_SNAPSHOT_CHANGED'
	| 'CONTENT_ADDRESS_CONFLICT'
	| 'SHARD_POSTFLIGHT_FAILED'
	| 'MANIFEST_POSTFLIGHT_FAILED'
	| 'SNAPSHOT_POSTFLIGHT_FAILED';

export class IndexV8StorageError extends Error {
	constructor(
		public readonly code: IndexV8StorageErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'IndexV8StorageError';
	}
}

interface ShardCommitOutcome {
	written: boolean;
	bytesWritten: number;
	existsMs: number;
	readMs: number;
	writeMs: number;
	verifyMs: number;
}

interface RecoveryMarkerInspection {
	status: 'missing' | 'required' | 'invalid' | 'io-error';
	payload: string | null;
}

export class IndexV8Store {
	private readonly writeQueue: WriteQueue;
	private readonly ioConcurrency: number;
	private readonly collectLoadMetrics: boolean | undefined;
	private readonly recoveryRequiredPath: string;
	private readonly verifiedShardFingerprints = new Map<string, { sha256: string; bytes: number; mtimeMs: number }>();
	private verifiedSnapshotId: string | null = null;

	constructor(
		private readonly adapter: DataAdapter,
		private readonly paths: IndexV8StoragePaths,
		options: IndexV8StoreOptions = {},
	) {
		this.writeQueue = getAdapterWriteQueue(adapter);
		this.ioConcurrency = options.ioConcurrency ?? DEFAULT_IO_CONCURRENCY;
		this.collectLoadMetrics = options.collectLoadMetrics;
		const runtimeRoot = this.paths.rootPath.slice(0, this.paths.rootPath.lastIndexOf('/'));
		this.recoveryRequiredPath = options.recoveryRequiredPath ?? `${runtimeRoot}/index-v8-recovery-required.json`;
		if (!Number.isInteger(this.ioConcurrency) || this.ioConcurrency < 1 || this.ioConcurrency > MAX_IO_CONCURRENCY) {
			throw new RangeError(`ioConcurrency must be an integer from 1 to ${MAX_IO_CONCURRENCY}`);
		}
	}

	async load(): Promise<IndexV8LoadResult> {
		const collectTimings = this.collectLoadMetrics ?? isOperonEnginePerfDebugEnabled();
		const startedAt = collectTimings ? enginePerfNow() : 0;
		const metrics: IndexV8LoadMetrics = {
			manifestBytes: 0,
			shardBytes: 0,
			shardsRead: 0,
			manifestStatMs: 0,
			manifestReadMs: 0,
			manifestValidationMs: 0,
			manifestValidationPasses: 0,
			shardPhaseMs: 0,
			shardStatMs: 0,
			shardReadMs: 0,
			shardValidationMs: 0,
			shardValidationPasses: 0,
			maxShardValidationConcurrency: 0,
			globalValidationMs: 0,
			globalValidationPasses: 0,
			hydrationMs: 0,
			secondaryRebuildMs: 0,
			totalMs: 0,
		};
		try {
			let activeShardValidations = 0;
			const manifestStatStartedAt = collectTimings ? enginePerfNow() : 0;
			const manifestStat = await this.adapter.stat(this.paths.manifestPath);
			if (collectTimings) metrics.manifestStatMs = enginePerfNow() - manifestStatStartedAt;
			if (!manifestStat) {
				return this.finishLoad({ status: 'missing', metrics }, startedAt);
			}
			if (manifestStat.type !== 'file' || manifestStat.size > INDEX_V8_MAX_MANIFEST_BYTES) {
				return this.finishLoad({ status: 'invalid', retryable: false, code: 'MANIFEST_TOO_LARGE', metrics }, startedAt);
			}
			const manifestReadStartedAt = collectTimings ? enginePerfNow() : 0;
			const manifestPayload = await this.adapter.read(this.paths.manifestPath);
			if (collectTimings) metrics.manifestReadMs = enginePerfNow() - manifestReadStartedAt;
			metrics.manifestBytes = utf8ByteLength(manifestPayload);
			if (metrics.manifestBytes > INDEX_V8_MAX_MANIFEST_BYTES) {
				return this.finishLoad({ status: 'invalid', retryable: false, code: 'MANIFEST_TOO_LARGE', metrics }, startedAt);
			}

			let manifest: ValidatedIndexV8Manifest;
			try {
				const manifestValidationStartedAt = collectTimings ? enginePerfNow() : 0;
				manifest = await validateIndexV8Manifest(manifestPayload);
				if (collectTimings) metrics.manifestValidationMs = enginePerfNow() - manifestValidationStartedAt;
				if (collectTimings) metrics.manifestValidationPasses = 1;
			} catch (error) {
				return this.finishLoad(this.codecFailure(error, metrics), startedAt);
			}

			const missingShardIds: IndexV8ShardId[] = [];
			const shardPhaseStartedAt = collectTimings ? enginePerfNow() : 0;
			const pipelineConcurrency = Math.min(this.ioConcurrency, MAX_LOAD_PIPELINE_CONCURRENCY);
			const runShardWorker = createAsyncLimiter(pipelineConcurrency);
			const shardSettled = await Promise.allSettled(manifest.shards.map(descriptor => runShardWorker(async () => {
				const path = this.getShardPath(descriptor.shardId, descriptor.sha256);
				const statStartedAt = collectTimings ? enginePerfNow() : 0;
				const stat = await this.adapter.stat(path);
				if (collectTimings) metrics.shardStatMs = (metrics.shardStatMs ?? 0) + enginePerfNow() - statStartedAt;
				if (!stat) {
					missingShardIds.push(descriptor.shardId);
					return null;
				}
				if (stat.type !== 'file' || stat.size > INDEX_V8_MAX_SHARD_BYTES || stat.size !== descriptor.bytes) {
					throw new IndexV8CodecError(`Shard byte count mismatch: ${descriptor.shardId}`);
				}
				const readStartedAt = collectTimings ? enginePerfNow() : 0;
				const bytes = await this.adapter.readBinary(path);
				if (collectTimings) metrics.shardReadMs = (metrics.shardReadMs ?? 0) + enginePerfNow() - readStartedAt;
				metrics.shardBytes += descriptor.bytes;
				metrics.shardsRead += 1;
				const validationStartedAt = collectTimings ? enginePerfNow() : 0;
				if (collectTimings) {
					activeShardValidations += 1;
					metrics.maxShardValidationConcurrency = Math.max(
						metrics.maxShardValidationConcurrency ?? 0,
						activeShardValidations,
					);
				}
				try {
					const validated = await validateIndexV8ShardBinaryPayload(descriptor, bytes);
					this.verifiedShardFingerprints.set(path, {
						sha256: descriptor.sha256,
						bytes: descriptor.bytes,
						mtimeMs: stat.mtime,
					});
					if (collectTimings) metrics.shardValidationPasses = (metrics.shardValidationPasses ?? 0) + 1;
					return validated;
				} finally {
					if (collectTimings) {
						activeShardValidations -= 1;
						metrics.shardValidationMs = (metrics.shardValidationMs ?? 0) + enginePerfNow() - validationStartedAt;
					}
				}
			})));
			if (collectTimings) metrics.shardPhaseMs = enginePerfNow() - shardPhaseStartedAt;
			const shardErrors: unknown[] = [];
			for (const result of shardSettled) {
				if (result.status === 'rejected') shardErrors.push(result.reason as unknown);
			}
			const unsupportedError = shardErrors.find(error => (
				error instanceof IndexV8CodecError && error.kind === 'unsupported'
			));
			const invalidError = shardErrors.find(error => error instanceof IndexV8CodecError);
			const prioritizedError = unsupportedError ?? invalidError ?? shardErrors[0];
			if (prioritizedError instanceof Error) throw prioritizedError;
			if (prioritizedError !== undefined) throw new Error('V8 shard load failed');
			const shardResults = shardSettled.map(result => (
				result.status === 'fulfilled' ? result.value : null
			));
			missingShardIds.sort(compareText);
			if (missingShardIds.length > 0) {
				return this.finishLoad({
					status: 'incomplete',
					retryable: true,
					snapshotId: manifest.snapshotId,
					manifest,
					manifestPayload,
					missingShardIds,
					metrics,
				}, startedAt);
			}

			try {
				const globalValidationStartedAt = collectTimings ? enginePerfNow() : 0;
				const validated = finalizeValidatedIndexV8Snapshot(
					manifest,
					shardResults.filter((part): part is ValidatedIndexV8ShardPart => part !== null),
				);
				this.verifiedSnapshotId = validated.manifest.snapshotId;
				if (collectTimings) metrics.globalValidationMs = enginePerfNow() - globalValidationStartedAt;
				if (collectTimings) metrics.globalValidationPasses = 1;
				return this.finishLoad({
					status: 'loaded',
					manifest: validated.manifest,
					manifestPayload,
					shards: validated.shards,
					validatedSnapshot: validated,
					metrics,
				}, startedAt);
			} catch (error) {
				return this.finishLoad(this.codecFailure(error, metrics), startedAt);
			}
		} catch (error) {
			if (error instanceof IndexV8CodecError) {
				return this.finishLoad(this.codecFailure(error, metrics), startedAt);
			}
			return this.finishLoad({ status: 'io-error', retryable: true, code: 'ADAPTER_IO', metrics }, startedAt);
		}
	}

	async commit(snapshot: IndexV8SnapshotPayloads): Promise<IndexV8CommitResult> {
		const requestedAt = enginePerfNow();
		const sealedSnapshot: IndexV8SnapshotPayloads = {
			manifestPayload: snapshot.manifestPayload,
			shardPayloads: new Map(snapshot.shardPayloads),
			...(snapshot.expectedBaseSnapshotId ? { expectedBaseSnapshotId: snapshot.expectedBaseSnapshotId } : {}),
			...(snapshot.expectedBaseManifestPayload ? { expectedBaseManifestPayload: snapshot.expectedBaseManifestPayload } : {}),
			...(snapshot.expectedBaseMissing === true ? { expectedBaseMissing: true } : {}),
		};
		return await this.writeQueue.enqueue(this.paths.rootPath, async () => {
			const operationStartedAt = enginePerfNow();
			const queueWaitMs = operationStartedAt - requestedAt;
			const preflightStartedAt = enginePerfNow();
			let manifest: IndexManifestV8;
			let expectedBaseManifest: ValidatedIndexV8Manifest | null = null;
			if (utf8ByteLength(sealedSnapshot.manifestPayload) > INDEX_V8_MAX_MANIFEST_BYTES) {
				throw new IndexV8StorageError('INVALID_SNAPSHOT', 'V8 manifest exceeds the storage size limit');
			}
			try {
				manifest = (await validateIndexV8Snapshot(sealedSnapshot.manifestPayload, sealedSnapshot.shardPayloads)).manifest;
				const hasExpectedId = typeof sealedSnapshot.expectedBaseSnapshotId === 'string';
				const hasExpectedPayload = typeof sealedSnapshot.expectedBaseManifestPayload === 'string';
				if (hasExpectedId !== hasExpectedPayload) {
					throw new IndexV8CodecError('Full V8 replacement requires both expected-base fields');
				}
				if (sealedSnapshot.expectedBaseMissing === true && (hasExpectedId || hasExpectedPayload)) {
					throw new IndexV8CodecError('Expected-missing cannot be combined with an expected base manifest');
				}
				if (hasExpectedPayload) {
					expectedBaseManifest = await validateIndexV8Manifest(sealedSnapshot.expectedBaseManifestPayload!);
					if (expectedBaseManifest.snapshotId !== sealedSnapshot.expectedBaseSnapshotId) {
						throw new IndexV8CodecError('Expected base snapshot ID does not match the supplied base manifest');
					}
				}
			} catch (error) {
				const detail = error instanceof Error ? `: ${error.message}` : '';
				throw new IndexV8StorageError('INVALID_SNAPSHOT', `V8 snapshot failed preflight validation${detail}`);
			}
			const preflightMs = enginePerfNow() - preflightStartedAt;

			const ensureStartedAt = enginePerfNow();
			await this.ensureFolder(this.paths.rootPath);
			await this.ensureFolder(this.paths.shardsPath);
			const ensureFoldersMs = enginePerfNow() - ensureStartedAt;

			const shardStartedAt = enginePerfNow();
			const outcomes = await mapBounded(manifest.shards, this.ioConcurrency, async descriptor => {
				const payload = sealedSnapshot.shardPayloads.get(descriptor.shardId);
				if (payload === undefined) {
					throw new IndexV8StorageError('INVALID_SNAPSHOT', `Missing payload for shard ${descriptor.shardId}`);
				}
				return await this.commitShard(descriptor.shardId, descriptor.sha256, payload);
			});
			const shardPhaseMs = enginePerfNow() - shardStartedAt;

			const existingManifest = await this.readOptionalBounded(
				this.paths.manifestPath,
				INDEX_V8_MAX_MANIFEST_BYTES,
				'Manifest exceeds the storage size limit',
			);
			if (expectedBaseManifest && existingManifest !== sealedSnapshot.expectedBaseManifestPayload) {
				throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'Active V8 manifest no longer matches the full-replacement base');
			}
			if (sealedSnapshot.expectedBaseMissing === true && existingManifest !== null) {
				throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'An active V8 manifest appeared during initial full commit');
			}
			let manifestWritten = false;
			let manifestWriteMs = 0;
			let rollbackManifest = sealedSnapshot.manifestPayload;
			const manifestVerifyStartedAt = enginePerfNow();
			try {
				if (existingManifest !== sealedSnapshot.manifestPayload) {
					const manifestWriteStartedAt = enginePerfNow();
					if (expectedBaseManifest) {
						await this.adapter.process(this.paths.manifestPath, currentManifest => {
							if (currentManifest !== sealedSnapshot.expectedBaseManifestPayload) {
								throw new IndexV8StorageError(
									'BASE_SNAPSHOT_CHANGED',
									'Active V8 manifest changed during full replacement',
								);
							}
							return sealedSnapshot.manifestPayload;
						});
					} else {
						if (sealedSnapshot.expectedBaseMissing === true) {
							const racedManifest = await this.readOptionalBounded(
								this.paths.manifestPath,
								INDEX_V8_MAX_MANIFEST_BYTES,
								'Manifest exceeds the storage size limit',
							);
							if (racedManifest !== null) {
								throw new IndexV8StorageError(
									'BASE_SNAPSHOT_CHANGED',
									'An active V8 manifest appeared before initial activation',
								);
							}
						}
						if (sealedSnapshot.expectedBaseMissing === true) {
							await this.createInitialManifest(sealedSnapshot.manifestPayload);
						} else {
							await writeTextSafely(this.adapter, this.paths.manifestPath, sealedSnapshot.manifestPayload);
						}
					}
					manifestWriteMs = enginePerfNow() - manifestWriteStartedAt;
					manifestWritten = true;
				}
				const persistedManifest = await this.adapter.read(this.paths.manifestPath);
				if (persistedManifest !== sealedSnapshot.manifestPayload) {
					try {
						await validateIndexV8Manifest(persistedManifest);
					} catch (error) {
						if (!(error instanceof IndexV8CodecError) || error.kind !== 'unsupported') {
							rollbackManifest = persistedManifest;
						}
					}
					throw new IndexV8StorageError('MANIFEST_POSTFLIGHT_FAILED', 'Persisted V8 manifest differs from the committed payload');
				}
			} catch (error) {
				await this.restoreManifestBestEffort(existingManifest, rollbackManifest);
				if (error instanceof IndexV8StorageError) throw error;
				throw new IndexV8StorageError('MANIFEST_POSTFLIGHT_FAILED', 'V8 manifest write or verification failed');
			}
			const manifestVerifyMs = enginePerfNow() - manifestVerifyStartedAt;

			const postflightStartedAt = enginePerfNow();
			let postflight: IndexV8LoadResult;
			try {
				postflight = await this.load();
			} catch {
				await this.restoreManifestBestEffort(existingManifest, sealedSnapshot.manifestPayload);
				throw new IndexV8StorageError('SNAPSHOT_POSTFLIGHT_FAILED', 'Committed V8 snapshot could not be read during postflight');
			}
			const postflightMs = enginePerfNow() - postflightStartedAt;
			if (postflight.status !== 'loaded' || postflight.manifest.snapshotId !== manifest.snapshotId) {
				await this.restoreManifestBestEffort(existingManifest, sealedSnapshot.manifestPayload);
				throw new IndexV8StorageError('SNAPSHOT_POSTFLIGHT_FAILED', `Committed V8 snapshot failed postflight with status ${postflight.status}`);
			}

			const written = outcomes.filter(outcome => outcome.written);
			const result: IndexV8CommitResult = {
				status: written.length === 0 && !manifestWritten ? 'unchanged' : 'committed',
				snapshotId: manifest.snapshotId,
				shardsWritten: written.length,
				shardsReused: outcomes.length - written.length,
				bytesWritten: written.reduce((total, outcome) => total + outcome.bytesWritten, 0)
					+ (manifestWritten ? utf8ByteLength(sealedSnapshot.manifestPayload) : 0),
				manifestWritten,
				ioConcurrency: this.ioConcurrency,
				metrics: {
					preflightMs,
					transactionQueueWaitMs: queueWaitMs,
					ensureFoldersMs,
					shardPhaseMs,
					shardExistsMs: sum(outcomes, 'existsMs'),
					shardReadMs: sum(outcomes, 'readMs'),
					shardWriteMs: sum(outcomes, 'writeMs'),
					shardVerifyMs: sum(outcomes, 'verifyMs'),
					manifestWriteMs,
					manifestVerifyMs,
					postflightMs,
					totalMs: enginePerfNow() - requestedAt,
				},
			};
			enginePerfLog(
				'index.v8.storage.commit',
				`snapshotId=${result.snapshotId}`,
				`shardsWritten=${result.shardsWritten}`,
				`shardsReused=${result.shardsReused}`,
				`bytesWritten=${result.bytesWritten}`,
				`queueWaitMs=${Math.round(result.metrics.transactionQueueWaitMs)}`,
				`totalMs=${Math.round(result.metrics.totalMs)}`,
			);
			return result;
		});
	}

	async commitIncremental(input: IndexV8IncrementalCommit): Promise<IndexV8CommitResult> {
		const requestedAt = enginePerfNow();
		const sealedInput: IndexV8IncrementalCommit = {
			expectedBaseSnapshotId: input.expectedBaseSnapshotId,
			expectedBaseManifestPayload: input.expectedBaseManifestPayload,
			manifestPayload: input.manifestPayload,
			changedShardPayloads: new Map(input.changedShardPayloads),
		};
		return await this.writeQueue.enqueue(this.paths.rootPath, async () => {
			const operationStartedAt = enginePerfNow();
			const queueWaitMs = operationStartedAt - requestedAt;
			const preflightStartedAt = enginePerfNow();
			let baseManifest: ValidatedIndexV8Manifest;
			let candidateManifest: ValidatedIndexV8Manifest;
			try {
				if (utf8ByteLength(sealedInput.expectedBaseManifestPayload) > INDEX_V8_MAX_MANIFEST_BYTES
					|| utf8ByteLength(sealedInput.manifestPayload) > INDEX_V8_MAX_MANIFEST_BYTES) {
					throw new IndexV8CodecError('V8 manifest exceeds the storage size limit');
				}
				baseManifest = await validateIndexV8Manifest(sealedInput.expectedBaseManifestPayload);
				candidateManifest = await validateIndexV8Manifest(sealedInput.manifestPayload);
				this.validateIncrementalCommitInput(baseManifest, candidateManifest, sealedInput);
			} catch (error) {
				const detail = error instanceof Error ? `: ${error.message}` : '';
				throw new IndexV8StorageError('INVALID_SNAPSHOT', `Incremental V8 snapshot failed preflight validation${detail}`);
			}
			const changedDescriptors = candidateManifest.shards.filter((descriptor, index) => (
				!shardDescriptorsEqual(descriptor, baseManifest.shards[index])
			));
			await mapBounded(changedDescriptors, this.ioConcurrency, async descriptor => {
				const payload = sealedInput.changedShardPayloads.get(descriptor.shardId);
				if (payload === undefined) {
					throw new IndexV8StorageError('INVALID_SNAPSHOT', `Missing changed payload for shard ${descriptor.shardId}`);
				}
				try {
					await validateIndexV8ShardPayload(descriptor, payload);
				} catch (error) {
					const detail = error instanceof Error ? `: ${error.message}` : '';
					throw new IndexV8StorageError('INVALID_SNAPSHOT', `Changed shard ${descriptor.shardId} failed validation${detail}`);
				}
			});
			const preflightMs = enginePerfNow() - preflightStartedAt;

			const activeManifest = await this.readOptionalBounded(
				this.paths.manifestPath,
				INDEX_V8_MAX_MANIFEST_BYTES,
				'Manifest exceeds the storage size limit',
			);
			if (activeManifest !== sealedInput.expectedBaseManifestPayload) {
				throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'Active V8 manifest no longer matches the incremental base');
			}

			const ensureStartedAt = enginePerfNow();
			await this.ensureFolder(this.paths.rootPath);
			await this.ensureFolder(this.paths.shardsPath);
			const ensureFoldersMs = enginePerfNow() - ensureStartedAt;

			const changedIds = new Set(changedDescriptors.map(descriptor => descriptor.shardId));
			const reusedDescriptors = candidateManifest.shards.filter(descriptor => !changedIds.has(descriptor.shardId));
			await mapBounded(reusedDescriptors, this.ioConcurrency, async descriptor => {
				await this.verifyReusedShard(descriptor);
			});

			const shardStartedAt = enginePerfNow();
			const outcomes = await mapBounded(changedDescriptors, this.ioConcurrency, async descriptor => (
				await this.commitShard(
					descriptor.shardId,
					descriptor.sha256,
					sealedInput.changedShardPayloads.get(descriptor.shardId)!,
				)
			));
			const shardPhaseMs = enginePerfNow() - shardStartedAt;

			let manifestWritten = false;
			let manifestWriteMs = 0;
			const manifestVerifyStartedAt = enginePerfNow();
			try {
				if (sealedInput.manifestPayload !== sealedInput.expectedBaseManifestPayload) {
					const manifestWriteStartedAt = enginePerfNow();
					await this.adapter.process(this.paths.manifestPath, currentManifest => {
						if (currentManifest !== sealedInput.expectedBaseManifestPayload) {
							throw new IndexV8StorageError(
								'BASE_SNAPSHOT_CHANGED',
								'Active V8 manifest changed during incremental commit',
							);
						}
						return sealedInput.manifestPayload;
					});
					manifestWriteMs = enginePerfNow() - manifestWriteStartedAt;
					manifestWritten = true;
				}
				const persistedManifest = await this.adapter.read(this.paths.manifestPath);
				if (persistedManifest !== sealedInput.manifestPayload) {
					throw new IndexV8StorageError('MANIFEST_POSTFLIGHT_FAILED', 'Persisted incremental V8 manifest differs from the candidate payload');
				}
				await validateIndexV8Manifest(persistedManifest);
			} catch (error) {
				await this.restoreManifestBestEffort(
					sealedInput.expectedBaseManifestPayload,
					sealedInput.manifestPayload,
				);
				if (error instanceof IndexV8StorageError) throw error;
				throw new IndexV8StorageError('MANIFEST_POSTFLIGHT_FAILED', 'Incremental V8 manifest CAS or verification failed');
			}
			const manifestVerifyMs = enginePerfNow() - manifestVerifyStartedAt;

			const postflightStartedAt = enginePerfNow();
			try {
				await mapBounded(changedDescriptors, this.ioConcurrency, async descriptor => {
					const payload = await this.readOptionalBounded(
						this.getShardPath(descriptor.shardId, descriptor.sha256),
						INDEX_V8_MAX_SHARD_BYTES,
						`Shard ${descriptor.shardId} exceeds the storage size limit`,
					);
					if (payload === null) throw new IndexV8CodecError(`Missing changed shard: ${descriptor.shardId}`);
					await validateIndexV8ShardPayload(descriptor, payload);
				});
				await mapBounded(reusedDescriptors, this.ioConcurrency, async descriptor => {
					await this.verifyReusedShard(descriptor);
				});
			} catch {
				await this.restoreManifestBestEffort(
					sealedInput.expectedBaseManifestPayload,
					sealedInput.manifestPayload,
				);
				throw new IndexV8StorageError('SNAPSHOT_POSTFLIGHT_FAILED', 'Incremental V8 snapshot failed changed-shard postflight');
			}
			const postflightMs = enginePerfNow() - postflightStartedAt;

			const written = outcomes.filter(outcome => outcome.written);
			const result: IndexV8CommitResult = {
				status: written.length === 0 && !manifestWritten ? 'unchanged' : 'committed',
				snapshotId: candidateManifest.snapshotId,
				shardsWritten: written.length,
				shardsReused: candidateManifest.shards.length - written.length,
				bytesWritten: written.reduce((total, outcome) => total + outcome.bytesWritten, 0)
					+ (manifestWritten ? utf8ByteLength(sealedInput.manifestPayload) : 0),
				manifestWritten,
				ioConcurrency: this.ioConcurrency,
				metrics: {
					preflightMs,
					transactionQueueWaitMs: queueWaitMs,
					ensureFoldersMs,
					shardPhaseMs,
					shardExistsMs: sum(outcomes, 'existsMs'),
					shardReadMs: sum(outcomes, 'readMs'),
					shardWriteMs: sum(outcomes, 'writeMs'),
					shardVerifyMs: sum(outcomes, 'verifyMs'),
					manifestWriteMs,
					manifestVerifyMs,
					postflightMs,
					totalMs: enginePerfNow() - requestedAt,
				},
			};
			enginePerfLog(
				'index.v8.storage.commit-incremental',
				`snapshotId=${result.snapshotId}`,
				`shardsWritten=${result.shardsWritten}`,
				`shardsReused=${result.shardsReused}`,
				`bytesWritten=${result.bytesWritten}`,
				`queueWaitMs=${Math.round(result.metrics.transactionQueueWaitMs)}`,
				`totalMs=${Math.round(result.metrics.totalMs)}`,
			);
			return result;
		});
	}

	async inspect(): Promise<IndexV8StorageInspection> {
		const entries: IndexV8StorageEntry[] = [];
		const protectedShardNames = new Set<string>();
		const active = await this.inspectActiveManifestMetadata();
		if (active.manifest) {
			for (const descriptor of active.manifest.shards) protectedShardNames.add(shardFileName(descriptor));
		}
		const rootFiles = await this.listFileNames(this.paths.rootPath);
		const shardFiles = await this.listFileNames(this.paths.shardsPath);

		const activeShardNames = new Set(active.manifest?.shards.map(shardFileName) ?? []);
		for (const name of shardFiles) {
			const path = `${this.paths.shardsPath}/${name}`;
			const stat = await this.adapter.stat(path);
			if (!stat || stat.type !== 'file') continue;
			const parsed = parseShardFileName(name);
			entries.push({
				name,
				kind: activeShardNames.has(name)
					? 'active-shard'
					: CONTENT_ADDRESSED_SHARD.test(name)
						? 'orphan-shard'
						: OWNED_SHARD_TEMP_FILE.test(name) || OWNED_SHARD_CLEANUP_CLAIM.test(name) ? 'owned-temp' : 'foreign',
				path,
				sizeBytes: stat.size,
				mtimeMs: stat.mtime,
				...(parsed ? { shardId: parsed.shardId, sha256: parsed.sha256 } : {}),
			});
		}
		for (const name of rootFiles) {
			if (name === 'manifest.json') continue;
			const stat = await this.adapter.stat(`${this.paths.rootPath}/${name}`);
			if (!stat || stat.type !== 'file') continue;
			entries.push({
				name,
				path: `${this.paths.rootPath}/${name}`,
				kind: ALTERNATE_MANIFEST_FILE.test(name)
					? 'alternate-manifest'
					: OWNED_MANIFEST_TEMP_FILE.test(name) || OWNED_MANIFEST_CLEANUP_CLAIM.test(name) ? 'owned-temp' : 'foreign',
				sizeBytes: stat.size,
				mtimeMs: stat.mtime,
			});
		}
		return {
			manifestStatus: active.status,
			...(active.code ? { manifestCode: active.code } : {}),
			...(active.manifest ? { activeSnapshotId: active.manifest.snapshotId } : {}),
			...(active.payload !== null ? { activeManifestPayload: active.payload } : {}),
			entries: entries.sort((left, right) => compareText(left.name, right.name)),
			protectedShardNames: [...protectedShardNames].sort(compareText),
			cleanupSuppressedReasons: [],
		};
	}

	async diagnoseMaintenance(): Promise<IndexV8MaintenanceDiagnostics> {
		const inspection = await this.inspect();
		const entryCounts = createStorageKindRecord();
		const entryBytes = createStorageKindRecord();
		for (const entry of inspection.entries) {
			entryCounts[entry.kind] += 1;
			entryBytes[entry.kind] += entry.sizeBytes;
		}
		const marker = await this.inspectRecoveryMarker();
		return {
			inspection,
			...(inspection.manifestCode ? { manifestCode: inspection.manifestCode } : {}),
			verifiedSnapshot: inspection.activeSnapshotId !== undefined
				&& inspection.activeSnapshotId === this.verifiedSnapshotId,
			entryCounts,
			entryBytes,
			recoveryMarker: { status: marker.status },
		};
	}

	async planCanonicalV8Reset(
		desiredShardPayloads: ReadonlyMap<IndexV8ShardId, string> = new Map(),
		nowMs = Date.now(),
	): Promise<IndexV8CanonicalResetPlan> {
		const active = await this.inspectActiveManifestMetadata();
		const marker = await this.inspectRecoveryMarker();
		const suppressedReasons: string[] = [];
		let manifestFingerprint: IndexV8FileFingerprint | null = null;
		const conflictingShards: IndexV8CanonicalResetPlan['conflictingShards'] = [];
		try {
			const stat = await this.adapter.stat(this.paths.manifestPath);
			if (!stat) suppressedReasons.push('canonical-manifest-missing');
			else if (stat.type !== 'file') suppressedReasons.push('canonical-manifest-not-file');
			else manifestFingerprint = statFingerprint(stat);
		} catch {
			suppressedReasons.push('canonical-manifest-io-error');
		}
		if (active.payload === null) {
			suppressedReasons.push(`canonical-manifest-unsealed-${active.status}`);
		}
		if (marker.status === 'invalid' || marker.status === 'io-error') {
			suppressedReasons.push(`recovery-marker-${marker.status}`);
		}
		for (const [shardId, expectedPayload] of desiredShardPayloads) {
			try {
				const sha256 = await sha256Hex(expectedPayload);
				const path = this.getShardPath(shardId, sha256);
				const stat = await this.adapter.stat(path);
				if (!stat) continue;
				if (stat.type !== 'file') {
					suppressedReasons.push('desired-shard-not-file');
					continue;
				}
				const actualPayload = await this.adapter.read(path);
				if (actualPayload !== expectedPayload) {
					conflictingShards.push({ path, fingerprint: statFingerprint(stat), expectedPayload });
				}
			} catch {
				suppressedReasons.push('desired-shard-io-error');
			}
		}
		return {
			manifestStatus: active.status,
			expectedManifestPayload: active.payload ?? '',
			manifestPayloadReadable: true,
			manifestFingerprint,
			expectedRecoveryMarkerPayload: marker.payload,
			plannedAt: nowMs,
			conflictingShards,
			suppressedReasons: [...new Set(suppressedReasons)].sort(compareText),
		};
	}

	async applyCanonicalV8Reset(plan: IndexV8CanonicalResetPlan): Promise<IndexV8CanonicalResetResult> {
		const sealedPlan: IndexV8CanonicalResetPlan = {
			...plan,
			manifestFingerprint: plan.manifestFingerprint ? { ...plan.manifestFingerprint } : null,
			conflictingShards: plan.conflictingShards.map(candidate => ({
				...candidate,
				fingerprint: { ...candidate.fingerprint },
			})),
			suppressedReasons: [...plan.suppressedReasons],
		};
		const unchanged: IndexV8CanonicalResetResult = {
			status: 'unchanged', recoveryMarkerCreated: false, manifestRemoved: false,
			conflictingShardsRemoved: 0, errorCodes: [],
		};
		if (sealedPlan.suppressedReasons.length > 0 || !sealedPlan.manifestFingerprint) {
			return { ...unchanged, status: 'suppressed' };
		}
		const expectedManifestFingerprint = sealedPlan.manifestFingerprint;
		return await this.writeQueue.enqueue(this.paths.rootPath, async () => {
			let recoveryMarkerCreated = false;
			let manifestRemoved = false;
			let conflictingShardsRemoved = 0;
			let claimedManifestPath: string | null = null;
			try {
				if (!(await this.manifestAndStatMatch(
					sealedPlan.expectedManifestPayload,
					expectedManifestFingerprint,
					sealedPlan.manifestPayloadReadable,
				))) {
					return { ...unchanged, status: 'stale' };
				}
				const marker = await this.inspectRecoveryMarker();
				if (marker.payload !== sealedPlan.expectedRecoveryMarkerPayload
					|| (marker.status !== 'missing' && marker.status !== 'required')) {
					return { ...unchanged, status: 'stale' };
				}
				if (marker.status === 'missing') {
					if (!(await this.createRecoveryMarkerIfMissing())) return { ...unchanged, status: 'stale' };
					recoveryMarkerCreated = true;
				}
				if (!(await this.manifestAndStatMatch(
					sealedPlan.expectedManifestPayload,
					expectedManifestFingerprint,
					sealedPlan.manifestPayloadReadable,
				))) {
					return { ...unchanged, status: recoveryMarkerCreated ? 'partial' : 'stale', recoveryMarkerCreated };
				}
				claimedManifestPath = `${this.paths.manifestPath}.reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				await this.adapter.rename(this.paths.manifestPath, claimedManifestPath);
				const claimedManifestStat = await this.adapter.stat(claimedManifestPath);
				const claimedManifestPayload = await this.readOptionalBounded(
					claimedManifestPath,
					INDEX_V8_MAX_MANIFEST_BYTES,
					'Claimed manifest exceeds the storage size limit',
				);
				if (!claimedManifestStat || claimedManifestStat.type !== 'file'
					|| claimedManifestPayload !== sealedPlan.expectedManifestPayload
					|| !fingerprintsEqual(statFingerprint(claimedManifestStat), expectedManifestFingerprint)) {
					await this.restoreClaimNoClobber(claimedManifestPath, this.paths.manifestPath);
					claimedManifestPath = null;
					return { ...unchanged, status: recoveryMarkerCreated ? 'partial' : 'stale', recoveryMarkerCreated };
				}
				const markerAfterClaim = await this.inspectRecoveryMarker();
				if (markerAfterClaim.status !== 'required' || await this.adapter.exists(this.paths.manifestPath)) {
					await this.adapter.remove(claimedManifestPath);
					claimedManifestPath = null;
					return {
						status: 'partial', recoveryMarkerCreated, manifestRemoved: true,
						conflictingShardsRemoved, errorCodes: ['RESET_AUTHORITY_CHANGED'],
					};
				}
				await this.adapter.remove(claimedManifestPath);
				claimedManifestPath = null;
				manifestRemoved = true;
				for (const candidate of sealedPlan.conflictingShards) {
					if (await this.adapter.exists(this.paths.manifestPath)) {
						return {
							status: 'partial', recoveryMarkerCreated, manifestRemoved,
							conflictingShardsRemoved, errorCodes: ['RESET_AUTHORITY_CHANGED'],
						};
					}
					if (!candidate.path.startsWith(`${this.paths.shardsPath}/`)) {
						return { ...unchanged, status: 'stale', recoveryMarkerCreated };
					}
					const stat = await this.adapter.stat(candidate.path);
					if (!stat || stat.type !== 'file' || !fingerprintsEqual(statFingerprint(stat), candidate.fingerprint)) {
						return { ...unchanged, status: recoveryMarkerCreated ? 'partial' : 'stale', recoveryMarkerCreated };
					}
					const actualPayload = await this.adapter.read(candidate.path);
					if (actualPayload === candidate.expectedPayload) continue;
					await this.adapter.remove(candidate.path);
					conflictingShardsRemoved += 1;
				}
				const postMarker = await this.inspectRecoveryMarker();
				const postManifest = await this.adapter.stat(this.paths.manifestPath);
				if (postMarker.status !== 'required' || postManifest) {
					return {
						status: 'partial', recoveryMarkerCreated, manifestRemoved: !postManifest,
						conflictingShardsRemoved,
						errorCodes: ['RESET_POSTFLIGHT_CHANGED'],
					};
				}
				return {
					status: 'applied', recoveryMarkerCreated, manifestRemoved: true,
					conflictingShardsRemoved, errorCodes: [],
				};
			} catch {
				if (claimedManifestPath) {
					await this.restoreClaimNoClobber(claimedManifestPath, this.paths.manifestPath);
				}
				return {
					status: 'partial', recoveryMarkerCreated, manifestRemoved,
					conflictingShardsRemoved, errorCodes: ['RESET_IO_FAILED'],
				};
			}
		});
	}

	async planCleanup(options: IndexV8CleanupOptions = {}): Promise<IndexV8CleanupPlan> {
		const inspectedAt = options.nowMs ?? Date.now();
		const maxFiles = Math.min(options.maxFiles ?? DEFAULT_CLEANUP_MAX_FILES, DEFAULT_CLEANUP_MAX_FILES);
		const maxBytes = Math.min(options.maxBytes ?? DEFAULT_CLEANUP_MAX_BYTES, DEFAULT_CLEANUP_MAX_BYTES);
		if (![maxFiles, maxBytes].every(value => Number.isFinite(value) && value >= 0)) {
			throw new RangeError('Cleanup limits must be finite non-negative numbers');
		}
		const verified = await this.load();
		const inspection = await this.inspect();
		const marker = await this.inspectRecoveryMarker();
		const suppressedReasons = [...inspection.cleanupSuppressedReasons];
		if (verified.status !== 'loaded') {
			suppressedReasons.push(`active-snapshot-${verified.status}`);
		} else if (inspection.activeSnapshotId !== verified.manifest.snapshotId
			|| inspection.activeManifestPayload !== verified.manifestPayload) {
			suppressedReasons.push('active-manifest-changed-during-planning');
		}
		if (marker.status !== 'missing') suppressedReasons.push(`recovery-marker-${marker.status}`);
		const alternates = inspection.entries.filter(
			(entry): entry is IndexV8StorageEntry & { kind: 'alternate-manifest' } => entry.kind === 'alternate-manifest',
		);
		const eligibleOwnedEntries = inspection.entries.filter(
			(entry): entry is IndexV8StorageEntry & { kind: 'orphan-shard' | 'owned-temp' } => (
				entry.kind === 'orphan-shard' || entry.kind === 'owned-temp'
			),
		);
		const processingAlternates = alternates.length > 0;
		const eligible = (processingAlternates ? alternates : eligibleOwnedEntries)
			.sort((left, right) => left.mtimeMs - right.mtimeMs || compareText(left.name, right.name));
		const candidates: IndexV8CleanupCandidate[] = [];
		let bytes = 0;
		if (suppressedReasons.length === 0) {
			for (const entry of eligible) {
				if (candidates.length >= Math.floor(maxFiles)) break;
				const budgetBytes = entry.kind === 'alternate-manifest' ? 0 : entry.sizeBytes;
				if (bytes + budgetBytes > maxBytes) continue;
				candidates.push({ name: entry.name, kind: entry.kind, path: entry.path, sizeBytes: entry.sizeBytes, mtimeMs: entry.mtimeMs });
				bytes += budgetBytes;
			}
		}
		return {
			activeSnapshotId: inspection.activeSnapshotId ?? '',
			expectedManifestPayload: inspection.activeManifestPayload ?? '',
			inspectedAt,
			candidates,
			hasMoreCandidates: suppressedReasons.length === 0
				&& (candidates.length < eligible.length || (processingAlternates && eligibleOwnedEntries.length > 0)),
			suppressedReasons: [...new Set(suppressedReasons)].sort(compareText),
		};
	}

	async applyCleanup(plan: IndexV8CleanupPlan, isActive: () => boolean = () => true): Promise<IndexV8CleanupResult> {
		const sealedPlan: IndexV8CleanupPlan = {
			activeSnapshotId: plan.activeSnapshotId,
			expectedManifestPayload: plan.expectedManifestPayload,
			inspectedAt: plan.inspectedAt,
			candidates: plan.candidates.map(candidate => ({ ...candidate })),
			hasMoreCandidates: plan.hasMoreCandidates,
			suppressedReasons: [...plan.suppressedReasons],
		};
		const result: IndexV8CleanupResult = {
			status: 'unchanged',
			deletedCount: 0,
			deletedBytes: 0,
			skippedCount: 0,
			backlogRemaining: sealedPlan.hasMoreCandidates,
			errorCodes: [],
		};
		if (sealedPlan.suppressedReasons.length > 0) return { ...result, status: 'suppressed' };
		if (!(await this.cleanupAuthorityMatches(sealedPlan))) {
			return { ...result, status: 'stale', skippedCount: sealedPlan.candidates.length, backlogRemaining: true };
		}
		for (const candidate of sealedPlan.candidates) {
			if (!isActive()) {
				result.skippedCount += sealedPlan.candidates.length - result.deletedCount - result.skippedCount;
				return { ...result, status: result.deletedCount > 0 ? 'partial' : 'stale', backlogRemaining: true };
			}
			const shouldContinue = await this.writeQueue.enqueue(this.paths.rootPath, async () => {
				let candidateDeleted = false;
				let candidateClaimPath: string | null = null;
				let candidateBackupPath: string | null = null;
				let recoverablePayload: string | null = null;
				try {
					if (!isActive()) return false;
					const initialAuthorityMatches = await this.cleanupAuthorityMatches(sealedPlan);
					if (!isActive() || !initialAuthorityMatches) return false;
					const isShardTemp = OWNED_SHARD_TEMP_FILE.test(candidate.name);
					const isManifestTemp = OWNED_MANIFEST_TEMP_FILE.test(candidate.name);
					const isShardClaim = OWNED_SHARD_CLEANUP_CLAIM.test(candidate.name);
					const isManifestClaim = OWNED_MANIFEST_CLEANUP_CLAIM.test(candidate.name);
					const expectedPath = candidate.kind === 'orphan-shard' || isShardTemp || isShardClaim
						? `${this.paths.shardsPath}/${candidate.name}`
						: `${this.paths.rootPath}/${candidate.name}`;
					if (candidate.path !== expectedPath
						|| (candidate.kind === 'alternate-manifest'
							? !ALTERNATE_MANIFEST_FILE.test(candidate.name)
							: candidate.kind === 'orphan-shard'
								? !CONTENT_ADDRESSED_SHARD.test(candidate.name)
								: !isShardTemp && !isManifestTemp && !isShardClaim && !isManifestClaim)) {
						result.skippedCount += 1;
						result.errorCodes.push('INVALID_PLAN');
						return true;
					}
					const currentStat = await this.adapter.stat(expectedPath);
					if (!isActive()
						|| !currentStat
						|| currentStat.type !== 'file'
						|| currentStat.size !== candidate.sizeBytes
						|| currentStat.mtime !== candidate.mtimeMs) {
						result.skippedCount += 1;
						return true;
					}
					// Sync may activate a new canonical manifest while candidate metadata
					// is being checked. Seal authority again immediately around the claim.
					const preclaimAuthorityMatches = await this.cleanupAuthorityMatches(sealedPlan);
					if (!isActive() || !preclaimAuthorityMatches) return false;
					candidateClaimPath = `${candidate.path}.cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
					if (!isActive()) return false;
					await this.adapter.rename(candidate.path, candidateClaimPath);
					const claimedAuthorityMatches = await this.cleanupAuthorityMatches(sealedPlan);
					if (!isActive() || !claimedAuthorityMatches) {
						await this.restoreClaimNoClobber(candidateClaimPath, candidate.path);
						candidateClaimPath = null;
						return false;
					}
					const backupToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
					const shardBaseName = candidate.name.match(/^((?:0[0-9a-f]|1[0-9a-f])-[a-f0-9]{64}\.json)/u)?.[1];
					candidateBackupPath = shardBaseName
						? `${this.paths.shardsPath}/${shardBaseName}.tmp-${backupToken}`
						: `${this.paths.rootPath}/manifest.json.tmp-${backupToken}`;
					if (!isActive()) {
						await this.restoreClaimNoClobber(candidateClaimPath, candidate.path);
						candidateClaimPath = null;
						return false;
					}
					await this.adapter.copy(candidateClaimPath, candidateBackupPath);
					if (candidate.kind !== 'alternate-manifest') {
						recoverablePayload = await this.readOptionalBounded(
							candidateBackupPath,
							DEFAULT_CLEANUP_MAX_BYTES,
							'Cleanup candidate exceeds the storage batch size limit',
						);
						if (recoverablePayload === null) throw new Error('Cleanup backup disappeared');
					}
					if (!isActive()) {
						await this.restoreClaimNoClobber(candidateClaimPath, candidate.path);
						candidateClaimPath = null;
						await this.adapter.remove(candidateBackupPath);
						candidateBackupPath = null;
						return false;
					}
					await this.adapter.remove(candidateClaimPath);
					candidateClaimPath = null;
					const postClaimDeleteAuthorityMatches = await this.cleanupAuthorityMatches(sealedPlan);
					if (!isActive() || !postClaimDeleteAuthorityMatches) {
						await this.restoreClaimNoClobber(candidateBackupPath, candidate.path);
						candidateBackupPath = null;
						return false;
					}
					if (!isActive()) {
						await this.restoreClaimNoClobber(candidateBackupPath, candidate.path);
						candidateBackupPath = null;
						return false;
					}
					await this.adapter.remove(candidateBackupPath);
					candidateBackupPath = null;
					const postBackupDeleteAuthorityMatches = await this.cleanupAuthorityMatches(sealedPlan);
					if (!isActive() || !postBackupDeleteAuthorityMatches) {
						if (recoverablePayload !== null) {
							await this.restorePayloadNoClobber(recoverablePayload, candidate.path);
						}
						return false;
					}
					candidateDeleted = true;
					result.deletedCount += 1;
					result.deletedBytes += candidate.sizeBytes;
				} catch {
					if (candidateClaimPath) await this.restoreClaimNoClobber(candidateClaimPath, candidate.path);
					else if (candidateBackupPath) await this.restoreClaimNoClobber(candidateBackupPath, candidate.path);
					if (!candidateDeleted) result.skippedCount += 1;
					result.errorCodes.push('CLEANUP_IO_FAILED');
					return false;
				}
				return true;
			});
			if (!shouldContinue) {
				result.skippedCount += sealedPlan.candidates.length - result.deletedCount - result.skippedCount;
				result.status = result.deletedCount > 0 ? 'partial' : 'stale';
				result.backlogRemaining = true;
				return result;
			}
		}
		result.status = result.errorCodes.length > 0 ? 'partial' : result.deletedCount > 0 ? 'applied' : 'unchanged';
		return result;
	}

	private async inspectActiveManifestMetadata(): Promise<{
		status: IndexV8LoadResult['status'];
		manifest: ValidatedIndexV8Manifest | null;
		payload: string | null;
		code?: string;
	}> {
		try {
			const stat = await this.adapter.stat(this.paths.manifestPath);
			if (!stat) return { status: 'missing', manifest: null, payload: null };
			if (stat.type !== 'file' || stat.size > INDEX_V8_MAX_MANIFEST_BYTES) {
				return { status: 'invalid', manifest: null, payload: null, code: 'MANIFEST_TOO_LARGE' };
			}
			const payload = await this.adapter.read(this.paths.manifestPath);
			if (utf8ByteLength(payload) > INDEX_V8_MAX_MANIFEST_BYTES) {
				return { status: 'invalid', manifest: null, payload: null, code: 'MANIFEST_TOO_LARGE' };
			}
			let manifest: ValidatedIndexV8Manifest;
			try {
				manifest = await validateIndexV8Manifest(payload);
			} catch (error) {
				return {
					status: error instanceof IndexV8CodecError && error.kind === 'unsupported' ? 'unsupported' : 'invalid',
					manifest: null,
					payload,
					code: error instanceof IndexV8CodecError && error.kind === 'unsupported' ? 'UNSUPPORTED_CONTRACT' : 'INVALID_SNAPSHOT',
				};
			}
			let missing = false;
			for (const descriptor of manifest.shards) {
				const shardStat = await this.adapter.stat(this.getShardPath(descriptor.shardId, descriptor.sha256));
				if (!shardStat) {
					missing = true;
					continue;
				}
				if (shardStat.type !== 'file' || shardStat.size !== descriptor.bytes || shardStat.size > INDEX_V8_MAX_SHARD_BYTES) {
					return { status: 'invalid', manifest, payload, code: 'SHARD_METADATA_MISMATCH' };
				}
			}
			return { status: missing ? 'incomplete' : 'loaded', manifest, payload };
		} catch {
			return { status: 'io-error', manifest: null, payload: null, code: 'ADAPTER_IO' };
		}
	}

	private async cleanupManifestMatches(plan: IndexV8CleanupPlan): Promise<boolean> {
		try {
			const payload = await this.readOptionalBounded(
				this.paths.manifestPath,
				INDEX_V8_MAX_MANIFEST_BYTES,
				'Manifest exceeds the storage size limit',
			);
			if (payload !== plan.expectedManifestPayload) return false;
			const manifest = await validateIndexV8Manifest(payload);
			return manifest.snapshotId === plan.activeSnapshotId;
		} catch {
			return false;
		}
	}

	private async cleanupAuthorityMatches(plan: IndexV8CleanupPlan): Promise<boolean> {
		if (!(await this.cleanupManifestMatches(plan))) return false;
		const marker = await this.inspectRecoveryMarker();
		return marker.status === 'missing';
	}

	private async manifestPayloadMatches(expectedPayload: string): Promise<boolean> {
		try {
			return await this.readOptionalBounded(
				this.paths.manifestPath,
				INDEX_V8_MAX_MANIFEST_BYTES,
				'Manifest exceeds the storage size limit',
			) === expectedPayload;
		} catch {
			return false;
		}
	}

	private async manifestAndStatMatch(
		expectedPayload: string,
		expectedFingerprint: IndexV8FileFingerprint,
		requirePayloadMatch = true,
	): Promise<boolean> {
		try {
			const stat = await this.adapter.stat(this.paths.manifestPath);
			if (!stat || stat.type !== 'file' || !fingerprintsEqual(statFingerprint(stat), expectedFingerprint)) return false;
			return !requirePayloadMatch || await this.manifestPayloadMatches(expectedPayload);
		} catch {
			return false;
		}
	}

	private async inspectRecoveryMarker(): Promise<RecoveryMarkerInspection> {
		try {
			const stat = await this.adapter.stat(this.recoveryRequiredPath);
			if (!stat) return { status: 'missing', payload: null };
			if (stat.type !== 'file' || stat.size > MAX_RECOVERY_MARKER_BYTES) return { status: 'invalid', payload: null };
			const payload = await this.adapter.read(this.recoveryRequiredPath);
			if (utf8ByteLength(payload) > MAX_RECOVERY_MARKER_BYTES) return { status: 'invalid', payload };
			let parsed: unknown;
			try {
				parsed = JSON.parse(payload) as unknown;
			} catch {
				return { status: 'invalid', payload };
			}
			const marker = parsed as { version?: unknown; required?: unknown } | null;
			return marker && marker.version === 1 && marker.required === true
				? { status: 'required', payload }
				: { status: 'invalid', payload };
		} catch {
			return { status: 'io-error', payload: null };
		}
	}

	private async createRecoveryMarkerIfMissing(): Promise<boolean> {
		const tempPath = `${this.recoveryRequiredPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let tempExists = false;
		try {
			if (await this.adapter.exists(this.recoveryRequiredPath)) return false;
			await this.adapter.write(tempPath, RECOVERY_MARKER_PAYLOAD);
			tempExists = true;
			if (await this.adapter.exists(this.recoveryRequiredPath)) return false;
			try {
				// DataAdapter.copy is explicitly no-clobber, unlike rename on several
				// supported filesystems. This turns a concurrent marker arrival into stale.
				await this.adapter.copy(tempPath, this.recoveryRequiredPath);
				return true;
			} catch (error) {
				if (await this.adapter.exists(this.recoveryRequiredPath)) return false;
				throw error;
			}
		} finally {
			if (tempExists) {
				try {
					if (await this.adapter.exists(tempPath)) await this.adapter.remove(tempPath);
				} catch {
					// The canonical marker was never overwritten; leftover temp is non-authoritative.
				}
			}
		}
	}

	private async restoreClaimNoClobber(claimedPath: string, canonicalPath: string): Promise<void> {
		try {
			if (!(await this.adapter.exists(claimedPath))) return;
			if (!(await this.adapter.exists(canonicalPath))) {
				try {
					await this.adapter.copy(claimedPath, canonicalPath);
				} catch {
					// A concurrent writer may have restored/replaced the canonical path.
				}
			}
			if (await this.adapter.exists(canonicalPath)) await this.adapter.remove(claimedPath);
		} catch {
			// Preserve the claim rather than risk overwriting a concurrent canonical file.
		}
	}

	private async restorePayloadNoClobber(payload: string, canonicalPath: string): Promise<void> {
		const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const name = canonicalPath.slice(canonicalPath.lastIndexOf('/') + 1);
		const shardBaseName = name.match(/^((?:0[0-9a-f]|1[0-9a-f])-[a-f0-9]{64}\.json)/u)?.[1];
		const tempPath = shardBaseName
			? `${this.paths.shardsPath}/${shardBaseName}.tmp-${token}`
			: `${this.paths.rootPath}/manifest.json.tmp-${token}`;
		try {
			await this.adapter.write(tempPath, payload);
			await this.restoreClaimNoClobber(tempPath, canonicalPath);
		} catch {
			// Keep any successfully written owned temp so a later maintenance pass
			// can retry without overwriting a concurrent canonical file.
		}
	}

	private async verifyReusedShard(descriptor: IndexShardDescriptorV8): Promise<void> {
		const path = this.getShardPath(descriptor.shardId, descriptor.sha256);
		const stat = await this.adapter.stat(path);
		if (!stat || stat.type !== 'file' || stat.size !== descriptor.bytes || stat.size > INDEX_V8_MAX_SHARD_BYTES) {
			throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', `Reused shard ${descriptor.shardId} is missing or changed`);
		}
		const cached = this.verifiedShardFingerprints.get(path);
		if (cached && cached.sha256 === descriptor.sha256 && cached.bytes === descriptor.bytes && cached.mtimeMs === stat.mtime) return;
		try {
			const bytes = await this.adapter.readBinary(path);
			await validateIndexV8ShardBinaryPayload(descriptor, bytes);
			this.verifiedShardFingerprints.set(path, { sha256: descriptor.sha256, bytes: descriptor.bytes, mtimeMs: stat.mtime });
		} catch {
			throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', `Reused shard ${descriptor.shardId} fingerprint changed`);
		}
	}

	private async commitShard(shardId: IndexV8ShardId, sha256: string, payload: string): Promise<ShardCommitOutcome> {
		const path = this.getShardPath(shardId, sha256);
		const existsStartedAt = enginePerfNow();
		const exists = await this.adapter.exists(path);
		const existsMs = enginePerfNow() - existsStartedAt;
		let readMs = 0;
		let writeMs = 0;
		if (exists) {
			const stat = await this.adapter.stat(path);
			const expectedBytes = utf8ByteLength(payload);
			if (stat && (stat.size > INDEX_V8_MAX_SHARD_BYTES || stat.size !== expectedBytes)) {
				throw new IndexV8StorageError('CONTENT_ADDRESS_CONFLICT', `Content-addressed shard ${shardId} has an unexpected byte size`);
			}
			const readStartedAt = enginePerfNow();
			const existing = await this.adapter.read(path);
			readMs = enginePerfNow() - readStartedAt;
			if (existing !== payload) {
				throw new IndexV8StorageError('CONTENT_ADDRESS_CONFLICT', `Content-addressed shard ${shardId} differs from its expected payload`);
			}
			return { written: false, bytesWritten: 0, existsMs, readMs, writeMs, verifyMs: 0 };
		}

		const writeStartedAt = enginePerfNow();
		const written = await this.createContentAddressedShard(path, payload, shardId);
		writeMs = enginePerfNow() - writeStartedAt;
		const verifyStartedAt = enginePerfNow();
		const persisted = await this.adapter.read(path);
		const verifyMs = enginePerfNow() - verifyStartedAt;
		if (persisted !== payload) {
			throw new IndexV8StorageError('SHARD_POSTFLIGHT_FAILED', `Persisted shard ${shardId} differs from its committed payload`);
		}
		return { written, bytesWritten: written ? utf8ByteLength(payload) : 0, existsMs, readMs, writeMs, verifyMs };
	}

	private async createContentAddressedShard(
		path: string,
		payload: string,
		shardId: IndexV8ShardId,
	): Promise<boolean> {
		const tempPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let tempExists = false;
		try {
			await this.adapter.write(tempPath, payload);
			tempExists = true;
			if (await this.adapter.exists(path)) {
				const racedPayload = await this.adapter.read(path);
				if (racedPayload !== payload) {
					throw new IndexV8StorageError(
						'CONTENT_ADDRESS_CONFLICT',
						`Content-addressed shard ${shardId} appeared with different content during creation`,
					);
				}
				return false;
			}
			try {
				await this.adapter.rename(tempPath, path);
				tempExists = false;
				return true;
			} catch (error) {
				if (!(await this.adapter.exists(path))) throw error;
				const racedPayload = await this.adapter.read(path);
				if (racedPayload !== payload) {
					throw new IndexV8StorageError(
						'CONTENT_ADDRESS_CONFLICT',
						`Content-addressed shard ${shardId} won a creation race with different content`,
					);
				}
				return false;
			}
		} finally {
			if (tempExists) {
				try {
					if (await this.adapter.exists(tempPath)) await this.adapter.remove(tempPath);
				} catch {
					// Best-effort cleanup only. Inventory classifies any leftover temp file.
				}
			}
		}
	}

	/**
	 * Activate the first manifest without using the generic replace path. If a
	 * Sync winner becomes visible before rename, preserve it and fail closed.
	 * Atomic no-clobber rename semantics across devices remain a Sync-layer
	 * concern; this path never calls process/remove on an existing manifest.
	 */
	private async createInitialManifest(payload: string): Promise<void> {
		const path = this.paths.manifestPath;
		const tempPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let tempExists = false;
		try {
			if (await this.adapter.exists(path)) {
				throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'An active V8 manifest appeared before initial creation');
			}
			await this.adapter.write(tempPath, payload);
			tempExists = true;
			if (await this.adapter.exists(path)) {
				throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'An active V8 manifest won the initial creation race');
			}
			try {
				await this.adapter.rename(tempPath, path);
				tempExists = false;
			} catch (error) {
				if (await this.adapter.exists(path)) {
					throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'An active V8 manifest won the initial rename race');
				}
				throw error;
			}
		} finally {
			if (tempExists) {
				try {
					if (await this.adapter.exists(tempPath)) await this.adapter.remove(tempPath);
				} catch {
					// Best-effort cleanup only. Inventory classifies any leftover temp file.
				}
			}
		}
	}

	private validateIncrementalCommitInput(
		baseManifest: ValidatedIndexV8Manifest,
		candidateManifest: ValidatedIndexV8Manifest,
		input: IndexV8IncrementalCommit,
	): void {
		if (baseManifest.snapshotId !== input.expectedBaseSnapshotId) {
			throw new IndexV8CodecError('Expected base snapshot ID does not match the supplied base manifest');
		}
		if (candidateManifest.indexSemanticsSignature !== baseManifest.indexSemanticsSignature
			|| candidateManifest.coherenceBasis !== baseManifest.coherenceBasis
			|| candidateManifest.lastFullScanAt !== baseManifest.lastFullScanAt) {
			throw new IndexV8CodecError('Incremental commit cannot change semantics, coherence basis, or full-scan provenance');
		}
		const changedIds = new Set<IndexV8ShardId>();
		let sourceCount = 0;
		let taskInstanceCount = 0;
		for (let index = 0; index < candidateManifest.shards.length; index++) {
			const descriptor = candidateManifest.shards[index];
			sourceCount += descriptor.sourceCount;
			taskInstanceCount += descriptor.taskInstanceCount;
			if (!shardDescriptorsEqual(descriptor, baseManifest.shards[index])) changedIds.add(descriptor.shardId);
		}
		if (sourceCount !== candidateManifest.totals.sourceCount
			|| taskInstanceCount !== candidateManifest.totals.taskInstanceCount) {
			throw new IndexV8CodecError('Incremental manifest totals do not match its shard descriptors');
		}
		if (input.changedShardPayloads.size !== changedIds.size) {
			throw new IndexV8CodecError('Changed shard payloads must exactly match descriptor changes');
		}
		for (const shardId of input.changedShardPayloads.keys()) {
			if (!changedIds.has(shardId)) {
				throw new IndexV8CodecError(`Unexpected changed shard payload: ${shardId}`);
			}
		}
	}

	private getShardPath(shardId: IndexV8ShardId, sha256: string): string {
		return `${this.paths.shardsPath}/${shardId}-${sha256}.json`;
	}

	private async ensureFolder(path: string): Promise<void> {
		const segments = path.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
		}
	}

	private async readOptionalBounded(path: string, maxBytes: number, message: string): Promise<string | null> {
		if (!(await this.adapter.exists(path))) return null;
		const stat = await this.adapter.stat(path);
		if (stat && stat.size > maxBytes) throw new IndexV8StorageError('INVALID_SNAPSHOT', message);
		const payload = await this.adapter.read(path);
		if (utf8ByteLength(payload) > maxBytes) throw new IndexV8StorageError('INVALID_SNAPSHOT', message);
		return payload;
	}

	private async listFileNames(path: string): Promise<string[]> {
		if (!(await this.adapter.exists(path))) return [];
		const listed = await this.adapter.list(path);
		return listed.files.map(file => file.slice(file.lastIndexOf('/') + 1)).sort(compareText);
	}

	private async restoreManifestBestEffort(previousManifest: string | null, attemptedManifest: string): Promise<void> {
		try {
			if (previousManifest === null || !(await this.adapter.exists(this.paths.manifestPath))) return;
			await this.adapter.process(this.paths.manifestPath, currentManifest => (
				currentManifest === attemptedManifest ? previousManifest : currentManifest
			));
		} catch {
			// Preserve the original commit failure; Markdown remains the recovery authority.
		}
	}

	private codecFailure(error: unknown, metrics: IndexV8LoadMetrics): IndexV8LoadResult {
		return error instanceof IndexV8CodecError && error.kind === 'unsupported'
			? { status: 'unsupported', retryable: false, code: 'UNSUPPORTED_CONTRACT', metrics }
			: { status: 'invalid', retryable: false, code: 'INVALID_SNAPSHOT', metrics };
	}

	private finishLoad<T extends IndexV8LoadResult>(result: T, startedAt: number): T {
		result.metrics.totalMs = startedAt === 0 ? 0 : enginePerfNow() - startedAt;
		if (isOperonEnginePerfDebugEnabled()) {
			enginePerfLog(
				'index.v8.storage.load',
				`status=${result.status}`,
				`manifestBytes=${result.metrics.manifestBytes}`,
				`shardBytes=${result.metrics.shardBytes}`,
				`shardsRead=${result.metrics.shardsRead}`,
				`manifestValidationMs=${Math.round(result.metrics.manifestValidationMs ?? 0)}`,
				`manifestValidationPasses=${result.metrics.manifestValidationPasses ?? 0}`,
				`shardPhaseMs=${Math.round(result.metrics.shardPhaseMs ?? 0)}`,
				`shardValidationMs=${Math.round(result.metrics.shardValidationMs ?? 0)}`,
				`shardValidationPasses=${result.metrics.shardValidationPasses ?? 0}`,
				`maxShardValidationConcurrency=${result.metrics.maxShardValidationConcurrency ?? 0}`,
				`globalValidationMs=${Math.round(result.metrics.globalValidationMs ?? 0)}`,
				`globalValidationPasses=${result.metrics.globalValidationPasses ?? 0}`,
				`totalMs=${Math.round(result.metrics.totalMs)}`,
			);
		}
		return result;
	}
}

async function mapBounded<T, R>(items: readonly T[], concurrency: number, action: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let firstError: unknown = null;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (firstError === null) {
			const index = nextIndex++;
			if (index >= items.length) return;
			try {
				results[index] = await action(items[index]);
			} catch (error) {
				if (firstError === null) firstError = error;
			}
		}
	});
	await Promise.all(workers);
	if (firstError !== null) throw firstError instanceof Error ? firstError : new Error('Bounded V8 storage operation failed');
	return results;
}

function createAsyncLimiter(concurrency: number): <T>(action: () => Promise<T>) => Promise<T> {
	let active = 0;
	const queue: Array<() => void> = [];
	const acquire = async (): Promise<void> => {
		if (active < concurrency) {
			active += 1;
			return;
		}
		await new Promise<void>(resolve => queue.push(resolve));
	};
	const release = (): void => {
		const next = queue.shift();
		if (next) next();
		else active -= 1;
	};
	return async <T>(action: () => Promise<T>): Promise<T> => {
		await acquire();
		try {
			return await action();
		} finally {
			release();
		}
	};
}

function sum(outcomes: ShardCommitOutcome[], key: keyof ShardCommitOutcome): number {
	return outcomes.reduce((total, outcome) => total + Number(outcome[key]), 0);
}

function shardDescriptorsEqual(left: IndexShardDescriptorV8, right: IndexShardDescriptorV8): boolean {
	return left.shardId === right.shardId
		&& left.path === right.path
		&& left.sha256 === right.sha256
		&& left.bytes === right.bytes
		&& left.sourceCount === right.sourceCount
		&& left.taskInstanceCount === right.taskInstanceCount;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function createStorageKindRecord(): Record<IndexV8StorageEntry['kind'], number> {
	return {
		'active-shard': 0,
		'orphan-shard': 0,
		'owned-temp': 0,
		'alternate-manifest': 0,
		foreign: 0,
	};
}

function statFingerprint(stat: { size: number; mtime: number }): IndexV8FileFingerprint {
	return { sizeBytes: stat.size, mtimeMs: stat.mtime };
}

function fingerprintsEqual(left: IndexV8FileFingerprint, right: IndexV8FileFingerprint): boolean {
	return left.sizeBytes === right.sizeBytes && left.mtimeMs === right.mtimeMs;
}

function shardFileName(descriptor: IndexShardDescriptorV8): string {
	return descriptor.path.slice('shards/'.length);
}

function parseShardFileName(name: string): { shardId: IndexV8ShardId; sha256: string } | null {
	if (!CONTENT_ADDRESSED_SHARD.test(name)) return null;
	return {
		shardId: name.slice(0, 2),
		sha256: name.slice(3, 67),
	};
}

function getAdapterWriteQueue(adapter: DataAdapter): WriteQueue {
	const existing = ADAPTER_WRITE_QUEUES.get(adapter);
	if (existing) return existing;
	const queue = new WriteQueue();
	ADAPTER_WRITE_QUEUES.set(adapter, queue);
	return queue;
}
