import type { MutationKindV1, MutationReceiptV1 } from '../../contracts/v1';
import type { MutationReceiptScopeV1 } from './indexeddb-receipt-store';

export const GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1 = 8_388_608;
export const GRAPH_TRANSACTION_JOURNAL_MAX_STEPS_V1 = 512;
export const GRAPH_TRANSACTION_JOURNAL_LEASE_MS_V1 = 30_000;

export type GraphTransactionJournalPhaseV1 =
	| 'prepared'
	| 'committing'
	| 'compensating'
	| 'postflight';

export type GraphTransactionResourceKindV1 =
	| 'task-source'
	| 'repeat-series'
	| 'pinned'
	| 'active-tracker'
	| 'semantic-transition';

export interface GraphTransactionResourceStateV1 {
	state: 'absent' | 'present';
	digest: string;
	content: string | null;
}

export interface GraphTransactionJournalStepV1 {
	stepId: string;
	groupId: string;
	resourceKind: GraphTransactionResourceKindV1;
	resourceKey: string;
	operation: 'create' | 'modify' | 'delete';
	before: GraphTransactionResourceStateV1;
	after: GraphTransactionResourceStateV1;
}

/**
 * Internal durable recovery material. It is deliberately not part of the
 * public Runtime contract and must never be returned or logged. An unresolved
 * journal intentionally has no TTL: only atomic receipt finalization or a
 * verified compensation may remove its same-plan recovery fence.
 */
export interface GraphTransactionJournalV1 {
	contractVersion: 1;
	vaultIdentityHash: string;
	clientInstanceId: string;
	idempotencyKeyHash: string;
	mutationKind: MutationKindV1;
	planHash: string;
	targetDigest: string;
	planId: string;
	effectiveAt: string;
	createdAt: string;
	phase: GraphTransactionJournalPhaseV1;
	completedStepCount: number;
	steps: GraphTransactionJournalStepV1[];
}

export type GraphTransactionRecoveryClassificationV1 =
	| 'forward-continuation'
	| 'postflight-finalization'
	| 'reverse-compensation'
	| 'outcome-unknown';

export type TimerControlRecoveryPrefixV1 =
	| { readonly status: 'ordered-prefix'; readonly completedStepCount: number }
	| { readonly status: 'outcome-unknown' };

export function classifyTimerControlRecoveryPrefixV1(
	orderedStates: readonly ('before' | 'after' | 'other')[],
): TimerControlRecoveryPrefixV1 {
	let completedStepCount = 0;
	let reachedBefore = false;
	for (const state of orderedStates) {
		if (state === 'other') return { status: 'outcome-unknown' };
		if (state === 'after') {
			if (reachedBefore) return { status: 'outcome-unknown' };
			completedStepCount += 1;
		} else {
			reachedBefore = true;
		}
	}
	return { status: 'ordered-prefix', completedStepCount };
}

export function graphJournalScopeV1(
	journal: GraphTransactionJournalV1,
): MutationReceiptScopeV1 {
	return {
		vaultIdentityHash: journal.vaultIdentityHash,
		clientInstanceId: journal.clientInstanceId,
		idempotencyKeyHash: journal.idempotencyKeyHash,
		mutationKind: journal.mutationKind,
	};
}

export function graphJournalMatchesReceiptV1(
	journal: GraphTransactionJournalV1,
	receipt: MutationReceiptV1,
): boolean {
	return journal.vaultIdentityHash === receipt.vaultIdentityHash
		&& journal.clientInstanceId === receipt.clientInstanceId
		&& journal.idempotencyKeyHash === receipt.idempotencyKeyHash
		&& journal.mutationKind === receipt.mutationKind
		&& journal.planHash === receipt.planHash
		&& journal.targetDigest === receipt.targetDigest;
}

export function graphJournalMatchesPlanV1(
	journal: GraphTransactionJournalV1,
	value: {
		planId: string;
		planHash: string;
		receiptTargetDigest: string;
		clientInstanceId: string;
		idempotencyKeyHash: string;
		mutationKind: MutationKindV1;
	},
	vaultIdentityHash: string,
): boolean {
	return journal.vaultIdentityHash === vaultIdentityHash
		&& journal.clientInstanceId === value.clientInstanceId
		&& journal.idempotencyKeyHash === value.idempotencyKeyHash
		&& journal.mutationKind === value.mutationKind
		&& journal.planId === value.planId
		&& journal.planHash === value.planHash
		&& journal.targetDigest === value.receiptTargetDigest;
}
