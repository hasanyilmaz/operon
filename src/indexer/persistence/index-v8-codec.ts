import type { IndexedTask, IndexedTaskInstance, IndexData } from '../../types/fields';
import {
	INDEX_V8_LAYOUT_VERSION,
	INDEX_V8_MAX_SHARD_BYTES,
	INDEX_V8_PARTITION_ALGORITHM,
	INDEX_V8_PARTITION_KEY,
	INDEX_V8_SCHEMA_VERSION,
	INDEX_V8_SHARD_COUNT,
	type IndexManifestV8,
	type IndexShardDescriptorV8,
	type IndexShardV8,
	type IndexSourceRecordV8,
	type IndexV8CoherenceBasis,
	type IndexV8ShardId,
	type IndexV8Snapshot,
	type PersistedTaskInstanceV8,
} from './index-v8-contract';
import {
	getAllIndexV8ShardIds,
	getIndexV8ShardId,
	normalizeIndexV8SourcePath,
} from './index-v8-partition';
import { computeIndexTier } from '../index-tier';

export interface IndexV8SourceInput {
	path: string;
	mtimeMs: number;
	sizeBytes: number;
	instances: IndexedTaskInstance[];
}

export interface IndexV8SourceStat {
	mtimeMs: number;
	sizeBytes: number;
}

export interface BuildIndexV8SnapshotInput {
	committedAt: string;
	lastFullScanAt: string;
	coherenceBasis: IndexV8CoherenceBasis;
	indexSemanticsSignature: string;
	sources: IndexV8SourceInput[];
	canonicalInstanceKeys?: ReadonlySet<string>;
}

export interface BuildIndexV8ManifestInput {
	committedAt: string;
	lastFullScanAt: string;
	coherenceBasis: IndexV8CoherenceBasis;
	indexSemanticsSignature: string;
	totals: IndexManifestV8['totals'];
	descriptors: IndexShardDescriptorV8[];
}

export interface EncodedIndexV8Shard {
	shard: IndexShardV8;
	payload: string;
	descriptor: IndexShardDescriptorV8;
}

export interface HydratedIndexV8 {
	tasks: Map<string, IndexedTask>;
	taskInstances: Map<string, IndexedTaskInstance>;
	operonIdInstances: Map<string, Set<string>>;
	duplicateOperonIds: Set<string>;
}

declare const validatedManifestBrand: unique symbol;
declare const validatedShardPartBrand: unique symbol;
declare const validatedSnapshotBrand: unique symbol;

export type ValidatedIndexV8Manifest = IndexManifestV8 & {
	readonly [validatedManifestBrand]: true;
};

export type ValidatedIndexV8ShardPart = {
	descriptor: IndexShardDescriptorV8;
	shard: IndexShardV8;
	readonly [validatedShardPartBrand]: true;
};

export type ValidatedIndexV8Snapshot = {
	manifest: ValidatedIndexV8Manifest;
	shards: IndexShardV8[];
	readonly [validatedSnapshotBrand]: true;
};

export class IndexV8CodecError extends Error {
	constructor(
		message: string,
		public readonly kind: 'invalid' | 'unsupported' = 'invalid',
	) {
		super(message);
		this.name = 'IndexV8CodecError';
	}
}

export function stableCompactStringify(value: unknown): string {
	return stableSerialize(value);
}

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

export async function sha256Hex(value: string): Promise<string> {
	return await sha256HexBytes(new TextEncoder().encode(value).buffer);
}

export async function sha256HexBytes(value: ArrayBuffer): Promise<string> {
	const subtle = (typeof window === 'undefined' ? crypto : window.crypto)?.subtle;
	if (!subtle) throw new IndexV8CodecError('SHA-256 is unavailable in this runtime');
	const digest = await subtle.digest('SHA-256', value);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function projectIndexDataToV8Sources(
	data: IndexData,
	sourceStats: ReadonlyMap<string, IndexV8SourceStat> = new Map(),
): IndexV8SourceInput[] {
	const normalizedStats = new Map<string, IndexV8SourceStat>();
	for (const [path, stat] of sourceStats) {
		normalizedStats.set(normalizeIndexV8SourcePath(path), stat);
	}
	const grouped = new Map<string, IndexedTaskInstance[]>();
	const entries = data.taskInstances && Object.keys(data.taskInstances).length > 0
		? Object.entries(data.taskInstances)
		: Object.values(data.tasks).map(task => [deriveIndexV8InstanceKey(task.primary.filePath, task.primary.lineNumber, task.primary.format), {
			...task,
			instanceKey: deriveIndexV8InstanceKey(task.primary.filePath, task.primary.lineNumber, task.primary.format),
		}] as const);
	for (const [instanceKey, task] of entries) {
		const path = normalizeIndexV8SourcePath(task.primary.filePath);
		const instances = grouped.get(path) ?? [];
		instances.push({ ...task, instanceKey });
		grouped.set(path, instances);
	}
	return Array.from(grouped, ([path, instances]) => {
		const stat = normalizedStats.get(path);
		return {
			path,
			mtimeMs: stat?.mtimeMs ?? 0,
			sizeBytes: stat?.sizeBytes ?? 0,
			instances,
		};
	});
}

export function getIndexV8CanonicalInstanceKeys(data: IndexData): Set<string> {
	const keys = new Set<string>();
	const counts = new Map<string, number>();
	for (const instance of Object.values(data.taskInstances ?? {})) {
		counts.set(instance.operonId, (counts.get(instance.operonId) ?? 0) + 1);
	}
	for (const task of Object.values(data.tasks)) {
		if ((counts.get(task.operonId) ?? 1) <= 1) continue;
		keys.add(deriveIndexV8InstanceKey(task.primary.filePath, task.primary.lineNumber, task.primary.format));
	}
	return keys;
}

export async function buildIndexV8Snapshot(input: BuildIndexV8SnapshotInput): Promise<IndexV8Snapshot> {
	const shardSources = new Map<IndexV8ShardId, IndexSourceRecordV8[]>(
		getAllIndexV8ShardIds().map(shardId => [shardId, []]),
	);
	const seenSources = new Set<string>();
	const seenInstanceKeys = new Set<string>();
	const operonIdCounts = new Map<string, number>();
	const canonicalCounts = new Map<string, number>();
	for (const sourceInput of input.sources) {
		const source = projectIndexV8Source(sourceInput, input.canonicalInstanceKeys);
		if (seenSources.has(source.path)) {
			throw new IndexV8CodecError(`Duplicate source path: ${source.path}`);
		}
		seenSources.add(source.path);
		for (const instance of source.instances) {
			const instanceKey = deriveIndexV8InstanceKey(
				source.path,
				instance.location.lineNumber,
				instance.location.format,
			);
			if (seenInstanceKeys.has(instanceKey)) {
				throw new IndexV8CodecError(`Duplicate task instance location: ${instanceKey}`);
			}
			seenInstanceKeys.add(instanceKey);
			operonIdCounts.set(instance.operonId, (operonIdCounts.get(instance.operonId) ?? 0) + 1);
			if (instance.canonical) {
				canonicalCounts.set(instance.operonId, (canonicalCounts.get(instance.operonId) ?? 0) + 1);
			}
		}
		shardSources.get(getIndexV8ShardId(source.path))!.push(source);
	}
	for (const [operonId, count] of operonIdCounts) {
		const canonicalCount = canonicalCounts.get(operonId) ?? 0;
		if (count > 1 && canonicalCount !== 1) {
			throw new IndexV8CodecError(`Duplicate operonId requires exactly one canonical instance: ${operonId}`);
		}
		if (count === 1 && canonicalCount !== 0) {
			throw new IndexV8CodecError(`Unique operonId must not carry a canonical marker: ${operonId}`);
		}
	}

	const shards: IndexShardV8[] = [];
	const shardPayloads = new Map<IndexV8ShardId, string>();
	const descriptors: IndexShardDescriptorV8[] = [];
	for (const shardId of getAllIndexV8ShardIds()) {
		const encoded = await encodeIndexV8Shard(shardId, shardSources.get(shardId)!);
		shards.push(encoded.shard);
		shardPayloads.set(shardId, encoded.payload);
		descriptors.push(encoded.descriptor);
	}

	const encodedManifest = await buildIndexV8Manifest({
		committedAt: input.committedAt,
		lastFullScanAt: input.lastFullScanAt,
		coherenceBasis: input.coherenceBasis,
		indexSemanticsSignature: input.indexSemanticsSignature,
		totals: {
			sourceCount: input.sources.length,
			taskInstanceCount: seenInstanceKeys.size,
		},
		descriptors,
	});
	return {
		manifest: encodedManifest.manifest,
		manifestPayload: encodedManifest.manifestPayload,
		shards,
		shardPayloads,
	};
}

export function projectIndexV8Source(
	input: IndexV8SourceInput,
	canonicalInstanceKeys?: ReadonlySet<string>,
): IndexSourceRecordV8 {
	return projectSource(input, canonicalInstanceKeys);
}

export async function encodeIndexV8Shard(
	shardId: IndexV8ShardId,
	sourceRecords: readonly IndexSourceRecordV8[],
): Promise<EncodedIndexV8Shard> {
	if (!getAllIndexV8ShardIds().includes(shardId)) throw new IndexV8CodecError(`Invalid shard ID: ${shardId}`);
	const sources = [...sourceRecords].sort(compareSourceRecords);
	for (const source of sources) {
		if (getIndexV8ShardId(source.path) !== shardId) {
			throw new IndexV8CodecError(`Source is assigned to the wrong shard: ${shardId}`);
		}
	}
	const shard: IndexShardV8 = {
		schemaVersion: INDEX_V8_SCHEMA_VERSION,
		layoutVersion: INDEX_V8_LAYOUT_VERSION,
		shardId,
		partitionAlgorithm: INDEX_V8_PARTITION_ALGORITHM,
		sources,
	};
	assertShardShape(shard);
	const payload = stableCompactStringify(shard);
	const bytes = utf8ByteLength(payload);
	if (bytes > INDEX_V8_MAX_SHARD_BYTES) {
		throw new IndexV8CodecError(`Shard ${shardId} exceeds the ${INDEX_V8_MAX_SHARD_BYTES}-byte contract limit`);
	}
	const sha256 = await sha256Hex(payload);
	return {
		shard,
		payload,
		descriptor: {
			shardId,
			path: `shards/${shardId}-${sha256}.json`,
			sha256,
			bytes,
			sourceCount: sources.length,
			taskInstanceCount: sources.reduce((total, source) => total + source.instances.length, 0),
		},
	};
}

export async function buildIndexV8Manifest(
	input: BuildIndexV8ManifestInput,
): Promise<{ manifest: IndexManifestV8; manifestPayload: string }> {
	validateTimestamp(input.committedAt, 'committedAt');
	validateTimestamp(input.lastFullScanAt, 'lastFullScanAt');
	if (input.coherenceBasis !== 'verified-full-scan') {
		throw new IndexV8CodecError('Invalid coherence basis');
	}
	if (!input.indexSemanticsSignature) throw new IndexV8CodecError('indexSemanticsSignature must be non-empty');
	if (!Number.isInteger(input.totals.sourceCount) || input.totals.sourceCount < 0
		|| !Number.isInteger(input.totals.taskInstanceCount) || input.totals.taskInstanceCount < 0) {
		throw new IndexV8CodecError('Invalid manifest totals');
	}
	const expectedShardIds = getAllIndexV8ShardIds();
	if (input.descriptors.length !== expectedShardIds.length
		|| input.descriptors.some((descriptor, index) => descriptor.shardId !== expectedShardIds[index])) {
		throw new IndexV8CodecError('Manifest shard descriptors must cover 00 through 1f in order');
	}
	const manifestBody: Omit<IndexManifestV8, 'snapshotId'> = {
		schemaVersion: INDEX_V8_SCHEMA_VERSION,
		layoutVersion: INDEX_V8_LAYOUT_VERSION,
		committedAt: input.committedAt,
		lastFullScanAt: input.lastFullScanAt,
		coherenceBasis: input.coherenceBasis,
		indexSemanticsSignature: input.indexSemanticsSignature,
		partition: {
			algorithm: INDEX_V8_PARTITION_ALGORITHM,
			key: INDEX_V8_PARTITION_KEY,
			shardCount: INDEX_V8_SHARD_COUNT,
		},
		totals: { ...input.totals },
		shards: input.descriptors.map(descriptor => ({ ...descriptor })),
	};
	const manifest: IndexManifestV8 = {
		...manifestBody,
		snapshotId: await sha256Hex(stableCompactStringify(manifestBody)),
	};
	return { manifest, manifestPayload: stableCompactStringify(manifest) };
}

export function decodeIndexV8Manifest(payload: string): IndexManifestV8 {
	const parsed = parseJsonObject(payload, 'manifest');
	assertManifestShape(parsed);
	return parsed;
}

/** Validate every manifest-controlled reference before any caller reads a shard path. */
export async function validateIndexV8Manifest(payload: string): Promise<ValidatedIndexV8Manifest> {
	const manifest = decodeIndexV8Manifest(payload);
	const expectedIds = getAllIndexV8ShardIds();
	if (manifest.shards.length !== INDEX_V8_SHARD_COUNT) {
		throw new IndexV8CodecError('Manifest must contain exactly 32 shard descriptors');
	}
	for (let index = 0; index < expectedIds.length; index++) {
		const descriptor = manifest.shards[index];
		const shardId = expectedIds[index];
		if (descriptor.shardId !== shardId) {
			throw new IndexV8CodecError('Manifest shard descriptors must cover 00 through 1f in order');
		}
		if (descriptor.path !== `shards/${shardId}-${descriptor.sha256}.json`) {
			throw new IndexV8CodecError(`Shard path is not content-addressed: ${shardId}`);
		}
	}
	const { snapshotId: _snapshotId, ...manifestBody } = manifest;
	const expectedSnapshotId = await sha256Hex(stableCompactStringify(manifestBody));
	if (manifest.snapshotId !== expectedSnapshotId) {
		throw new IndexV8CodecError('Manifest snapshot ID does not match its shard descriptors');
	}
	return manifest as ValidatedIndexV8Manifest;
}

export async function validateIndexV8Snapshot(
	manifestPayload: string,
	shardPayloads: Map<IndexV8ShardId, string>,
): Promise<ValidatedIndexV8Snapshot> {
	const manifest = await validateIndexV8Manifest(manifestPayload);
	if (shardPayloads.size !== INDEX_V8_SHARD_COUNT) {
		throw new IndexV8CodecError('Snapshot must provide exactly 32 shard payloads');
	}
	const parts: ValidatedIndexV8ShardPart[] = [];
	for (const descriptor of manifest.shards) {
		const payload = shardPayloads.get(descriptor.shardId);
		if (payload === undefined) throw new IndexV8CodecError(`Missing shard payload: ${descriptor.shardId}`);
		parts.push(await validateIndexV8ShardPayload(descriptor, payload));
	}
	return finalizeValidatedIndexV8Snapshot(manifest, parts);
}

export function finalizeValidatedIndexV8Snapshot(
	manifest: ValidatedIndexV8Manifest,
	parts: ValidatedIndexV8ShardPart[],
): ValidatedIndexV8Snapshot {
	if (parts.length !== INDEX_V8_SHARD_COUNT) {
		throw new IndexV8CodecError('Snapshot must provide exactly 32 validated shards');
	}
	const shards: IndexShardV8[] = [];
	const seenSources = new Set<string>();
	const seenInstanceKeys = new Set<string>();
	const operonIdCounts = new Map<string, number>();
	const canonicalCounts = new Map<string, number>();
	let sourceCount = 0;
	let taskInstanceCount = 0;
	for (let index = 0; index < manifest.shards.length; index++) {
		const descriptor = manifest.shards[index];
		const part = parts[index];
		if (part.descriptor !== descriptor) {
			throw new IndexV8CodecError(`Validated shard descriptor mismatch: ${descriptor.shardId}`);
		}
		const shard = part.shard;
		if (shard.shardId !== descriptor.shardId) {
			throw new IndexV8CodecError(`Validated shard order mismatch: ${descriptor.shardId}`);
		}
		shards.push(shard);
		for (const source of shard.sources) {
			if (seenSources.has(source.path)) throw new IndexV8CodecError(`Source appears in multiple shards: ${source.path}`);
			seenSources.add(source.path);
			for (const instance of source.instances) {
				const key = deriveIndexV8InstanceKey(source.path, instance.location.lineNumber, instance.location.format);
				if (seenInstanceKeys.has(key)) throw new IndexV8CodecError(`Duplicate task instance key: ${key}`);
				seenInstanceKeys.add(key);
				operonIdCounts.set(instance.operonId, (operonIdCounts.get(instance.operonId) ?? 0) + 1);
				if (instance.canonical) {
					canonicalCounts.set(instance.operonId, (canonicalCounts.get(instance.operonId) ?? 0) + 1);
				}
			}
		}
		sourceCount += shard.sources.length;
		taskInstanceCount += shard.sources.reduce((total, source) => total + source.instances.length, 0);
	}
	if (sourceCount !== manifest.totals.sourceCount || taskInstanceCount !== manifest.totals.taskInstanceCount) {
		throw new IndexV8CodecError('Manifest totals do not match shard contents');
	}
	for (const [operonId, count] of operonIdCounts) {
		const canonicalCount = canonicalCounts.get(operonId) ?? 0;
		if (count > 1 && canonicalCount !== 1) {
			throw new IndexV8CodecError(`Duplicate operonId requires exactly one canonical instance: ${operonId}`);
		}
		if (count === 1 && canonicalCount !== 0) {
			throw new IndexV8CodecError(`Unique operonId must not carry a canonical marker: ${operonId}`);
		}
	}
	return { manifest, shards } as ValidatedIndexV8Snapshot;
}

export function hydrateIndexV8Shards(shards: IndexShardV8[], nowMs: number = Date.now()): HydratedIndexV8 {
	return hydrateIndexV8ShardRecords(shards, nowMs, true);
}

export function hydrateValidatedIndexV8Snapshot(
	snapshot: ValidatedIndexV8Snapshot,
	nowMs: number = Date.now(),
): HydratedIndexV8 {
	return hydrateIndexV8ShardRecords(snapshot.shards, nowMs, false);
}

function hydrateIndexV8ShardRecords(
	shards: IndexShardV8[],
	nowMs: number,
	validateShape: boolean,
): HydratedIndexV8 {
	const taskInstances = new Map<string, IndexedTaskInstance>();
	const operonIdInstances = new Map<string, Set<string>>();
	const canonicalInstanceKeys = new Map<string, string>();
	for (const shard of shards) {
		if (validateShape) assertShardShape(shard);
		for (const source of shard.sources) {
			for (const persisted of source.instances) {
				const instanceKey = deriveIndexV8InstanceKey(
					source.path,
					persisted.location.lineNumber,
					persisted.location.format,
				);
				if (taskInstances.has(instanceKey)) {
					throw new IndexV8CodecError(`Duplicate task instance key: ${instanceKey}`);
				}
				const instance = hydrateInstance(source.path, instanceKey, persisted, nowMs);
				taskInstances.set(instanceKey, instance);
				const keys = operonIdInstances.get(instance.operonId) ?? new Set<string>();
				keys.add(instanceKey);
				operonIdInstances.set(instance.operonId, keys);
				if (persisted.canonical) {
					if (canonicalInstanceKeys.has(instance.operonId)) {
						throw new IndexV8CodecError(`Multiple canonical instances for operonId: ${instance.operonId}`);
					}
					canonicalInstanceKeys.set(instance.operonId, instanceKey);
				}
			}
		}
	}
	const tasks = new Map<string, IndexedTask>();
	const duplicateOperonIds = new Set<string>();
	for (const [operonId, keys] of operonIdInstances) {
		if (keys.size === 1 && canonicalInstanceKeys.has(operonId)) {
			throw new IndexV8CodecError(`Unique operonId must not carry a canonical marker: ${operonId}`);
		}
		const canonicalKey = canonicalInstanceKeys.get(operonId) ?? selectCanonicalIndexV8InstanceKey(keys);
		if (keys.size > 1 && !canonicalInstanceKeys.has(operonId)) {
			throw new IndexV8CodecError(`Duplicate operonId has no canonical instance: ${operonId}`);
		}
		const canonical = taskInstances.get(canonicalKey);
		if (!canonical) {
			throw new IndexV8CodecError(`Missing canonical instance: ${operonId}`);
		}
		const task: IndexedTask = { ...canonical };
		delete (task as { instanceKey?: string }).instanceKey;
		tasks.set(operonId, task);
		if (keys.size > 1) duplicateOperonIds.add(operonId);
	}
	return { tasks, taskInstances, operonIdInstances, duplicateOperonIds };
}

/** Lock duplicate conflict fallback selection to bytewise JS string ordering. */
export function selectCanonicalIndexV8InstanceKey(instanceKeys: Iterable<string>): string {
	const sortedKeys = [...instanceKeys].sort(compareText);
	if (sortedKeys.length === 0) throw new IndexV8CodecError('Cannot select a canonical task from an empty instance set');
	return sortedKeys[0];
}

export function deriveIndexV8InstanceKey(
	filePath: string,
	lineNumber: number,
	format: 'inline' | 'yaml',
): string {
	return `${format}:${normalizeIndexV8SourcePath(filePath)}:${lineNumber}`;
}

export async function validateIndexV8ShardPayload(
	descriptor: IndexShardDescriptorV8,
	payload: string,
): Promise<ValidatedIndexV8ShardPart> {
	if (utf8ByteLength(payload) !== descriptor.bytes) throw new IndexV8CodecError(`Shard byte count mismatch: ${descriptor.shardId}`);
	if (await sha256Hex(payload) !== descriptor.sha256) throw new IndexV8CodecError(`Shard checksum mismatch: ${descriptor.shardId}`);
	return validateDecodedIndexV8ShardPayload(descriptor, payload);
}

export async function validateIndexV8ShardBinaryPayload(
	descriptor: IndexShardDescriptorV8,
	bytes: ArrayBuffer,
): Promise<ValidatedIndexV8ShardPart> {
	if (bytes.byteLength !== descriptor.bytes) throw new IndexV8CodecError(`Shard byte count mismatch: ${descriptor.shardId}`);
	if (await sha256HexBytes(bytes) !== descriptor.sha256) throw new IndexV8CodecError(`Shard checksum mismatch: ${descriptor.shardId}`);
	let payload: string;
	try {
		payload = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new IndexV8CodecError(`Shard contains invalid UTF-8: ${descriptor.shardId}`);
	}
	return validateDecodedIndexV8ShardPayload(descriptor, payload);
}

function validateDecodedIndexV8ShardPayload(
	descriptor: IndexShardDescriptorV8,
	payload: string,
): ValidatedIndexV8ShardPart {
	if (descriptor.path !== `shards/${descriptor.shardId}-${descriptor.sha256}.json`) {
		throw new IndexV8CodecError(`Shard path is not content-addressed: ${descriptor.shardId}`);
	}
	const parsed = parseJsonObject(payload, `shard ${descriptor.shardId}`);
	assertShardShape(parsed);
	if (parsed.shardId !== descriptor.shardId) throw new IndexV8CodecError(`Shard ID mismatch: ${descriptor.shardId}`);
	const taskInstanceCount = parsed.sources.reduce((total, source) => total + source.instances.length, 0);
	if (parsed.sources.length !== descriptor.sourceCount || taskInstanceCount !== descriptor.taskInstanceCount) {
		throw new IndexV8CodecError(`Shard descriptor count mismatch: ${descriptor.shardId}`);
	}
	return { descriptor, shard: parsed } as unknown as ValidatedIndexV8ShardPart;
}

function projectSource(
	input: IndexV8SourceInput,
	canonicalInstanceKeys: ReadonlySet<string> | undefined,
): IndexSourceRecordV8 {
	const path = normalizeIndexV8SourcePath(input.path);
	if (!Number.isFinite(input.mtimeMs) || input.mtimeMs < 0) throw new IndexV8CodecError(`Invalid mtime for source: ${path}`);
	if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) throw new IndexV8CodecError(`Invalid size for source: ${path}`);
	const instances = input.instances.map(instance => projectInstance(path, instance, canonicalInstanceKeys));
	instances.sort(comparePersistedInstances);
	return { path, mtimeMs: input.mtimeMs, sizeBytes: input.sizeBytes, instances };
}

function projectInstance(
	sourcePath: string,
	instance: IndexedTaskInstance,
	canonicalInstanceKeys: ReadonlySet<string> | undefined,
): PersistedTaskInstanceV8 {
	if (normalizeIndexV8SourcePath(instance.primary.filePath) !== sourcePath) {
		throw new IndexV8CodecError('Task instance source does not match its source record');
	}
	const fieldValues = Object.fromEntries(
		Object.entries(instance.fieldValues)
			.filter(([key]) => key !== 'pinned')
			.sort(([left], [right]) => compareText(left, right)),
	);
	const persisted: PersistedTaskInstanceV8 = {
		operonId: instance.operonId,
		description: instance.description,
		checkbox: instance.checkbox,
		fieldValues,
		tags: [...instance.tags],
		location: {
			lineNumber: instance.primary.lineNumber,
			format: instance.primary.format,
		},
		datetimeModified: instance.datetimeModified,
		...(canonicalInstanceKeys?.has(deriveIndexV8InstanceKey(
			instance.primary.filePath,
			instance.primary.lineNumber,
			instance.primary.format,
		)) ? { canonical: true as const } : {}),
		...(instance.plainCheckboxProgress ? {
			plainCheckboxProgress: { ...instance.plainCheckboxProgress },
		} : {}),
	};
	if (!isPersistedInstance(persisted)) {
		throw new IndexV8CodecError('Task instance contains invalid persisted values');
	}
	return persisted;
}

function hydrateInstance(
	sourcePath: string,
	instanceKey: string,
	instance: PersistedTaskInstanceV8,
	nowMs: number,
): IndexedTaskInstance {
	return {
		instanceKey,
		operonId: instance.operonId,
		description: instance.description,
		checkbox: instance.checkbox,
		fieldValues: { ...instance.fieldValues },
		tags: [...instance.tags],
		primary: {
			filePath: sourcePath,
			lineNumber: instance.location.lineNumber,
			format: instance.location.format,
		},
		datetimeModified: instance.datetimeModified,
		tier: computeIndexTier(instance.checkbox, instance.fieldValues, nowMs),
		...(instance.plainCheckboxProgress ? {
			plainCheckboxProgress: { ...instance.plainCheckboxProgress },
		} : {}),
	};
}

function assertManifestShape(value: unknown): asserts value is IndexManifestV8 {
	if (!isRecord(value)) throw new IndexV8CodecError('Manifest must be a JSON object');
	if ('tasks' in value || 'taskInstances' in value || 'pinned' in value) throw new IndexV8CodecError('Manifest contains forbidden persisted state');
	if (value.schemaVersion !== INDEX_V8_SCHEMA_VERSION) throw new IndexV8CodecError('Unsupported V8 manifest schema', 'unsupported');
	if (value.layoutVersion !== INDEX_V8_LAYOUT_VERSION) throw new IndexV8CodecError('Unsupported V8 manifest layout', 'unsupported');
	if (typeof value.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotId)) throw new IndexV8CodecError('Invalid snapshot ID');
	if (typeof value.committedAt !== 'string' || typeof value.lastFullScanAt !== 'string') throw new IndexV8CodecError('Invalid manifest timestamps');
	validateTimestamp(value.committedAt, 'committedAt');
	validateTimestamp(value.lastFullScanAt, 'lastFullScanAt');
	if (value.coherenceBasis !== 'verified-full-scan') {
		throw new IndexV8CodecError('Invalid coherence basis');
	}
	if (typeof value.indexSemanticsSignature !== 'string' || !value.indexSemanticsSignature) throw new IndexV8CodecError('Invalid index semantics signature');
	if (!isRecord(value.partition)) throw new IndexV8CodecError('Invalid partition descriptor');
	if (
		value.partition.algorithm !== INDEX_V8_PARTITION_ALGORITHM
		|| value.partition.key !== INDEX_V8_PARTITION_KEY
		|| value.partition.shardCount !== INDEX_V8_SHARD_COUNT
	) throw new IndexV8CodecError('Unsupported partition contract', 'unsupported');
	if (!isRecord(value.totals) || !isNonNegativeInteger(value.totals.sourceCount) || !isNonNegativeInteger(value.totals.taskInstanceCount)) {
		throw new IndexV8CodecError('Invalid manifest totals');
	}
	if (!Array.isArray(value.shards) || !value.shards.every(isShardDescriptor)) throw new IndexV8CodecError('Invalid shard descriptors');
}

function assertShardShape(value: unknown): asserts value is IndexShardV8 {
	if (!isRecord(value)) throw new IndexV8CodecError('Shard must be a JSON object');
	if ('tasks' in value || 'taskInstances' in value || 'pinned' in value) throw new IndexV8CodecError('Shard contains forbidden persisted state');
	if (value.schemaVersion !== INDEX_V8_SCHEMA_VERSION) throw new IndexV8CodecError('Unsupported V8 shard schema', 'unsupported');
	if (value.layoutVersion !== INDEX_V8_LAYOUT_VERSION) throw new IndexV8CodecError('Unsupported V8 shard layout', 'unsupported');
	if (typeof value.shardId !== 'string' || !getAllIndexV8ShardIds().includes(value.shardId)) throw new IndexV8CodecError('Invalid shard ID');
	if (value.partitionAlgorithm !== INDEX_V8_PARTITION_ALGORITHM) throw new IndexV8CodecError('Unsupported shard partition algorithm', 'unsupported');
	if (!Array.isArray(value.sources)) throw new IndexV8CodecError('Invalid shard sources');
	let previousPath = '';
	for (const source of value.sources) {
		if (!isSourceRecord(source)) throw new IndexV8CodecError('Invalid source record');
		const normalizedPath = normalizeIndexV8SourcePath(source.path);
		if (normalizedPath !== source.path) throw new IndexV8CodecError('Source path is not normalized');
		if (getIndexV8ShardId(source.path) !== value.shardId) throw new IndexV8CodecError('Source is assigned to the wrong shard');
		if (previousPath && compareText(previousPath, source.path) >= 0) throw new IndexV8CodecError('Shard sources are not uniquely sorted');
		previousPath = source.path;
		for (let index = 1; index < source.instances.length; index++) {
			if (comparePersistedInstances(source.instances[index - 1], source.instances[index]) > 0) {
				throw new IndexV8CodecError('Source task instances are not deterministically sorted');
			}
		}
	}
}

function isShardDescriptor(value: unknown): value is IndexShardDescriptorV8 {
	return isRecord(value)
		&& typeof value.shardId === 'string'
		&& typeof value.path === 'string'
		&& typeof value.sha256 === 'string'
		&& /^[a-f0-9]{64}$/.test(value.sha256)
		&& isNonNegativeInteger(value.bytes)
		&& value.bytes <= INDEX_V8_MAX_SHARD_BYTES
		&& isNonNegativeInteger(value.sourceCount)
		&& isNonNegativeInteger(value.taskInstanceCount);
}

function isSourceRecord(value: unknown): value is IndexSourceRecordV8 {
	if (!isRecord(value)) return false;
	if ('filePath' in value || 'tasks' in value || 'taskInstances' in value || 'pinned' in value) return false;
	if (typeof value.path !== 'string' || !isNonNegativeFiniteNumber(value.mtimeMs) || !isNonNegativeInteger(value.sizeBytes)) return false;
	if (!Array.isArray(value.instances)) return false;
	return value.instances.every(isPersistedInstance);
}

function isPersistedInstance(value: unknown): value is PersistedTaskInstanceV8 {
	if (!isRecord(value)) return false;
	if ('instanceKey' in value || 'primary' in value || 'filePath' in value || 'tasks' in value || 'pinned' in value || 'tier' in value) return false;
	if (typeof value.operonId !== 'string' || value.operonId.length === 0 || typeof value.description !== 'string') return false;
	if (value.checkbox !== 'open' && value.checkbox !== 'done' && value.checkbox !== 'cancelled') return false;
	if (!isRecord(value.fieldValues) || 'pinned' in value.fieldValues) return false;
	if (!Object.values(value.fieldValues).every(entry => typeof entry === 'string')) return false;
	if (!Array.isArray(value.tags) || !value.tags.every(entry => typeof entry === 'string')) return false;
	if (!isRecord(value.location) || !isNonNegativeInteger(value.location.lineNumber)) return false;
	if (value.location.format !== 'inline' && value.location.format !== 'yaml') return false;
	if (typeof value.datetimeModified !== 'string') return false;
	if (value.canonical !== undefined && value.canonical !== true) return false;
	if (value.plainCheckboxProgress !== undefined) {
		if (!isRecord(value.plainCheckboxProgress)) return false;
		if (!isNonNegativeInteger(value.plainCheckboxProgress.total) || !isNonNegativeInteger(value.plainCheckboxProgress.completed)) return false;
		if (value.plainCheckboxProgress.completed > value.plainCheckboxProgress.total) return false;
	}
	return true;
}

function parseJsonObject(payload: string, label: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(payload);
		if (!isRecord(parsed)) throw new IndexV8CodecError(`${label} must be a JSON object`);
		return parsed;
	} catch (error) {
		if (error instanceof IndexV8CodecError) throw error;
		throw new IndexV8CodecError(`Invalid ${label} JSON`);
	}
}

function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new IndexV8CodecError('Unsupported value in compact payload');
		return serialized;
	}
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.filter(key => record[key] !== undefined)
		.sort(compareText)
		.map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
		.join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateTimestamp(value: string, label: string): void {
	if (!isIsoDateTime(value)) throw new IndexV8CodecError(`${label} must be an ISO timestamp`);
}

function isIsoDateTime(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)
		&& !Number.isNaN(Date.parse(value));
}

function compareSourceRecords(left: IndexSourceRecordV8, right: IndexSourceRecordV8): number {
	return compareText(left.path, right.path);
}

function comparePersistedInstances(left: PersistedTaskInstanceV8, right: PersistedTaskInstanceV8): number {
	const line = left.location.lineNumber - right.location.lineNumber;
	if (line !== 0) return line;
	const format = compareText(left.location.format, right.location.format);
	if (format !== 0) return format;
	return compareText(left.operonId, right.operonId);
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
