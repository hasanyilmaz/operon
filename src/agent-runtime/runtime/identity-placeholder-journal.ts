import type {
	GraphTransactionJournalStepV1,
	GraphTransactionJournalV1,
} from './receipts/graph-transaction-journal';

interface IdentityPlaceholderJournalPlanV1 {
	clientInstanceId: string;
	createdAt: string;
	idempotencyKeyHash: string;
	planHash: string;
	planId: string;
	receiptTargetDigest: string;
}

/**
 * Builds the private recovery fence for identity-placeholder File Task
 * creation. The preview timestamp remains the creation timestamp; the
 * execution timestamp is recorded separately for the apply attempt.
 */
export function buildIdentityPlaceholderJournalV1(
	plan: IdentityPlaceholderJournalPlanV1,
	vaultIdentityHash: string,
	effectiveAt: string,
	steps: readonly GraphTransactionJournalStepV1[],
): GraphTransactionJournalV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash,
		clientInstanceId: plan.clientInstanceId,
		idempotencyKeyHash: plan.idempotencyKeyHash,
		mutationKind: 'task.create',
		planHash: plan.planHash,
		targetDigest: plan.receiptTargetDigest,
		planId: plan.planId,
		effectiveAt,
		createdAt: plan.createdAt,
		phase: 'prepared',
		completedStepCount: 0,
		steps: steps.map(step => ({
			...step,
			before: { ...step.before },
			after: { ...step.after },
		})),
	};
}

/** UTF-8 byte length, rather than JavaScript UTF-16 code-unit length. */
export function utf8ByteLengthV1(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function identityPlaceholderJournalByteLengthV1(
	journal: GraphTransactionJournalV1,
): number {
	return utf8ByteLengthV1(JSON.stringify(journal));
}

function canonicalizeJournalValueV1(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalizeJournalValueV1).join(',')}]`;
	if (typeof value !== 'object') throw new TypeError('Identity journal contains a non-JSON value');
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalizeJournalValueV1(record[key])}`).join(',')}}`;
}

/**
 * Compare persisted journal material through canonical JSON so durable
 * readback must retain every sealed field without depending on key order.
 */
export function identityPlaceholderJournalsEqualV1(
	left: GraphTransactionJournalV1,
	right: GraphTransactionJournalV1,
): boolean {
	return canonicalizeJournalValueV1(left) === canonicalizeJournalValueV1(right);
}
