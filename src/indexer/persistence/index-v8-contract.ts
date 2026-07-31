import type { CheckboxState } from '../../types/keys';
import type { PlainCheckboxProgress } from '../../types/fields';

export const INDEX_V8_SCHEMA_VERSION = 8 as const;
export const INDEX_V8_LAYOUT_VERSION = 1 as const;
export const INDEX_V8_SHARD_COUNT = 32 as const;
export const INDEX_V8_MAX_MANIFEST_BYTES = 256_000 as const;
export const INDEX_V8_MAX_SHARD_BYTES = 4_000_000 as const;
export const INDEX_V8_PARTITION_ALGORITHM = 'fnv1a32-utf8-nfc-v1' as const;
export const INDEX_V8_PARTITION_KEY = 'normalized-source-path' as const;

export type IndexV8ShardId = string;
export type IndexV8CoherenceBasis = 'verified-full-scan';
export type IndexV8RuntimeCoherenceBasis = IndexV8CoherenceBasis | 'unverified';

export interface PersistedTaskLocationV8 {
	lineNumber: number;
	format: 'inline' | 'yaml';
}

export interface PersistedTaskInstanceV8 {
	operonId: string;
	description: string;
	checkbox: CheckboxState;
	fieldValues: Record<string, string>;
	tags: string[];
	location: PersistedTaskLocationV8;
	datetimeModified: string;
	/** Present only when needed to preserve the canonical duplicate instance. */
	canonical?: true;
	plainCheckboxProgress?: PlainCheckboxProgress;
}

export interface IndexSourceRecordV8 {
	path: string;
	mtimeMs: number;
	sizeBytes: number;
	instances: PersistedTaskInstanceV8[];
}

export interface IndexShardV8 {
	schemaVersion: typeof INDEX_V8_SCHEMA_VERSION;
	layoutVersion: typeof INDEX_V8_LAYOUT_VERSION;
	shardId: IndexV8ShardId;
	partitionAlgorithm: typeof INDEX_V8_PARTITION_ALGORITHM;
	sources: IndexSourceRecordV8[];
}

export interface IndexShardDescriptorV8 {
	shardId: IndexV8ShardId;
	path: string;
	sha256: string;
	bytes: number;
	sourceCount: number;
	taskInstanceCount: number;
}

export interface IndexManifestV8 {
	schemaVersion: typeof INDEX_V8_SCHEMA_VERSION;
	layoutVersion: typeof INDEX_V8_LAYOUT_VERSION;
	snapshotId: string;
	committedAt: string;
	lastFullScanAt: string;
	coherenceBasis: IndexV8CoherenceBasis;
	indexSemanticsSignature: string;
	partition: {
		algorithm: typeof INDEX_V8_PARTITION_ALGORITHM;
		key: typeof INDEX_V8_PARTITION_KEY;
		shardCount: typeof INDEX_V8_SHARD_COUNT;
	};
	totals: {
		sourceCount: number;
		taskInstanceCount: number;
	};
	shards: IndexShardDescriptorV8[];
}

export interface IndexV8Snapshot {
	manifest: IndexManifestV8;
	manifestPayload: string;
	shards: IndexShardV8[];
	shardPayloads: Map<IndexV8ShardId, string>;
}
