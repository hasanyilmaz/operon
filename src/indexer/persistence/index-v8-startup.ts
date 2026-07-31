import type { IndexedTask, IndexedTaskInstance } from '../../types/fields';
import {
	hydrateValidatedIndexV8Snapshot,
	type IndexV8SourceStat,
} from './index-v8-codec';
import { enginePerfNow, isOperonEnginePerfDebugEnabled } from '../../core/engine-perf';
import type { IndexManifestV8 } from './index-v8-contract';
import type { IndexV8LoadResult } from './index-v8-store';

export type IndexV8FallbackReason =
	| 'recovery-required'
	| 'missing'
	| 'incomplete'
	| 'io-error'
	| 'invalid'
	| 'unsupported'
	| 'hydration-failed';

export type IndexV8StartupDecision =
	| {
		status: 'eligible';
		manifest: IndexManifestV8;
		tasks: Map<string, IndexedTask>;
		taskInstances: Map<string, IndexedTaskInstance>;
		operonIdInstances: Map<string, Set<string>>;
		duplicateOperonIds: Set<string>;
		sourceStats: Map<string, IndexV8SourceStat>;
		hydrationMs: number;
	}
	| {
		status: 'fallback';
		reason: IndexV8FallbackReason;
		code?: string;
	}
	| {
		status: 'incompatible';
		reason: 'index-semantics';
		expectedSignature: string;
		cachedSignature: string;
	};

/** Convert a fully validated store load into a bounded startup decision. */
export function prepareIndexV8Startup(
	loaded: IndexV8LoadResult,
	expectedSemanticsSignature: string,
	nowMs: number = Date.now(),
): IndexV8StartupDecision {
	if (loaded.status !== 'loaded') {
		const reason = loaded.status === 'io-error' ? 'io-error' : loaded.status;
		return {
			status: 'fallback',
			reason,
			...(loaded.status === 'invalid' || loaded.status === 'unsupported' || loaded.status === 'io-error'
				? { code: loaded.code }
				: {}),
		};
	}

	const validated = loaded.validatedSnapshot;
	const manifest = validated.manifest;
	if (manifest.indexSemanticsSignature !== expectedSemanticsSignature) {
		return {
			status: 'incompatible',
			reason: 'index-semantics',
			expectedSignature: expectedSemanticsSignature,
			cachedSignature: manifest.indexSemanticsSignature,
		};
	}
	const committedAtMs = Date.parse(manifest.committedAt);
	const lastFullScanAtMs = Date.parse(manifest.lastFullScanAt);
	if (!Number.isFinite(committedAtMs)
		|| !Number.isFinite(lastFullScanAtMs)
		|| lastFullScanAtMs > committedAtMs) {
		return invalidFallback('INVALID_PROVENANCE');
	}

	const sourceStats = new Map<string, IndexV8SourceStat>();
	for (const shard of validated.shards) {
		for (const source of shard.sources) {
			if (source.instances.length === 0 || source.mtimeMs <= 0 || source.sizeBytes <= 0) {
				return invalidFallback('INVALID_SOURCE_METADATA');
			}
			sourceStats.set(source.path, {
				mtimeMs: source.mtimeMs,
				sizeBytes: source.sizeBytes,
			});
		}
	}
	if (sourceStats.size !== manifest.totals.sourceCount) {
		return invalidFallback('INVALID_SOURCE_TOTAL');
	}

	try {
		const collectTimings = isOperonEnginePerfDebugEnabled();
		const hydrationStartedAt = collectTimings ? enginePerfNow() : 0;
		const hydrated = hydrateValidatedIndexV8Snapshot(validated, nowMs);
		const hydrationMs = collectTimings ? enginePerfNow() - hydrationStartedAt : 0;
		if (collectTimings) loaded.metrics.hydrationMs = hydrationMs;
		return {
			status: 'eligible',
			manifest,
			tasks: hydrated.tasks,
			taskInstances: hydrated.taskInstances,
			operonIdInstances: hydrated.operonIdInstances,
			duplicateOperonIds: hydrated.duplicateOperonIds,
			sourceStats,
			hydrationMs,
		};
	} catch {
		return {
			status: 'fallback',
			reason: 'hydration-failed',
			code: 'HYDRATION_FAILED',
		};
	}
}

function invalidFallback(code: string): IndexV8StartupDecision {
	return {
		status: 'fallback',
		reason: 'invalid',
		code,
	};
}
