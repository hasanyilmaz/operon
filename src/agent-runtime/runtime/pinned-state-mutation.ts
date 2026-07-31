import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../contracts/v1/canonical';
import type {
	MutationPreviewRequestV1,
	PinnedTaskStateSpecV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';
import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import type {
	PinnedCacheEntrySnapshot,
} from '../../storage/pinned-cache';
import type { RuntimePreparedMutationV1 } from './mutation-gateway';

export interface RuntimePinnedStateTaskSnapshotV1 {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly duplicate: boolean;
}

export interface RuntimePinnedStateMutationPortsV1 {
	getTask(operonId: string): RuntimePinnedStateTaskSnapshotV1 | null;
	getPinnedEntry(operonId: string): PinnedCacheEntrySnapshot;
	canPersist(): boolean;
}

export interface RuntimePinnedStateMutationPreparationV1 {
	readonly kind: 'pinned-state';
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly expectedEntry: PinnedCacheEntrySnapshot;
	readonly expectedEntryRevision: string;
	readonly expectedPinned: boolean;
	readonly pinned: boolean;
	readonly effectiveAt: string;
	readonly noChange: boolean;
}

export type RuntimePinnedStateMutationPreparationResultV1 =
	| { ok: true; value: RuntimePreparedMutationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export function pinnedEntryRevisionV1(
	operonId: string,
	entry: PinnedCacheEntrySnapshot,
): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1({
		operonId,
		entry: entry ? { ...entry } : null,
	})));
}

export function prepareRuntimePinnedStateMutationV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimePinnedStateMutationPortsV1,
): RuntimePinnedStateMutationPreparationResultV1 {
	if (request.mutationKind !== 'task.pinned-state' || request.spec.operation !== 'set-pinned') {
		return failure('mutation-kind-mismatch', 'This adapter handles pinned-state mutations only.');
	}
	if (!ports.canPersist()) {
		return failure('capability-unavailable', 'Canonical pinned-state persistence is unavailable.');
	}
	if (!request.target) {
		return failure('invalid-request', 'Pinned-state mutation requires an exact task target.');
	}
	const task = ports.getTask(request.target.operonId);
	if (!task) return failure('entity-not-found', 'The exact Operon task does not exist.');
	if (task.duplicate) {
		return failure('duplicate-operon-id', 'Duplicate operonId instances block pinned-state mutation.');
	}
	if (!sameTaskSourceLocatorV1(task.locator, request.target.locator)) {
		return failure('stale-source', 'The exact task locator changed before pinned-state preview.');
	}
	const expectedEntry = cloneEntry(ports.getPinnedEntry(task.operonId));
	const expectedPinned = expectedEntry?.pinned ?? false;
	const expectedEntryRevision = pinnedEntryRevisionV1(task.operonId, expectedEntry);
	const spec = request.spec;
	if (
		spec.expectedPinned !== undefined
		&& (
			spec.expectedPinned !== expectedPinned
			|| spec.expectedEntryRevision !== expectedEntryRevision
			|| spec.effectiveAt !== effectiveAt
		)
	) {
		return failure('stale-context', 'Pinned state no longer matches the sealed expected entry.');
	}
	const sealedSpec: PinnedTaskStateSpecV1 = {
		operation: 'set-pinned',
		pinned: spec.pinned,
		expectedPinned,
		expectedEntryRevision,
		effectiveAt,
	};
	const token: RuntimePinnedStateMutationPreparationV1 = {
		kind: 'pinned-state',
		operonId: task.operonId,
		locator: task.locator,
		expectedEntry,
		expectedEntryRevision,
		expectedPinned,
		pinned: spec.pinned,
		effectiveAt,
		noChange: expectedPinned === spec.pinned,
	};
	const targetDigest = sha256HexV1(canonicalJsonV1(toJsonValueV1({
		operonId: task.operonId,
		locator: task.locator,
		expectedEntryRevision,
		pinned: spec.pinned,
	})));
	return {
		ok: true,
		value: {
			target: {
				operonId: task.operonId,
				locator: task.locator,
				targetDigest,
			},
			affectedResources: [{
				resourceKind: 'pinned',
				resourceKey: task.operonId,
				revision: expectedEntryRevision,
			}],
			atomicGroups: [{
				groupId: `pinned:${task.operonId}`,
				order: 0,
				resources: [{
					resourceKind: 'pinned',
					resourceKey: task.operonId,
				}],
			}],
			predictedEffects: [{
				resourceKind: 'pinned',
				resourceKey: task.operonId,
				action: 'state-change',
				summary: token.noChange
					? `Task ${task.operonId} already has the requested pinned state.`
					: `${spec.pinned ? 'Pin' : 'Unpin'} task ${task.operonId}.`,
			}],
			warnings: [],
			sealedSpec,
			token,
		},
	};
}

export function isRuntimePinnedStateMutationPreparationV1(
	value: unknown,
): value is RuntimePinnedStateMutationPreparationV1 {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<RuntimePinnedStateMutationPreparationV1>;
	return candidate.kind === 'pinned-state'
		&& typeof candidate.operonId === 'string'
		&& typeof candidate.expectedEntryRevision === 'string'
		&& typeof candidate.expectedPinned === 'boolean'
		&& typeof candidate.pinned === 'boolean'
		&& typeof candidate.effectiveAt === 'string'
		&& typeof candidate.noChange === 'boolean';
}

function cloneEntry(entry: PinnedCacheEntrySnapshot): PinnedCacheEntrySnapshot {
	return entry ? { ...entry } : null;
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): Extract<RuntimePinnedStateMutationPreparationResultV1, { ok: false }> {
	return { ok: false, code, reason };
}
