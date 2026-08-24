import { sha256HexV1 } from '../contracts/v1/canonical';
import type { KeyMapping } from '../../types/settings';
import type { RuntimeMutationSettlementWindowV1 } from './mutation-gateway';
import type {
	GraphTransactionJournalStepV1,
	GraphTransactionResourceStateV1,
} from './receipts/graph-transaction-journal';
import { resolveRuntimeSourceModifiedTimeSettlementRevisionV1 } from './task-mutation-adapter';

export type RuntimeIdentityGraphSettlementResultV1 =
	| { ok: true; observedSteps: GraphTransactionJournalStepV1[] }
	| { ok: false };

function statesMatch(
	left: GraphTransactionResourceStateV1,
	right: GraphTransactionResourceStateV1,
): boolean {
	return left.state === right.state
		&& left.digest === right.digest
		&& left.content === right.content;
}

/**
 * Reconciles only the live post-commit after-state. Journal before/after
 * fences, CAS, compensation, and recovery classification remain exact.
 */
export async function reconcileRuntimeIdentityGraphSettlementV1(
	steps: readonly GraphTransactionJournalStepV1[],
	readState: (step: GraphTransactionJournalStepV1) => Promise<GraphTransactionResourceStateV1>,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[],
	settlementWindow: RuntimeMutationSettlementWindowV1,
): Promise<RuntimeIdentityGraphSettlementResultV1> {
	const observedSteps: GraphTransactionJournalStepV1[] = [];
	for (const step of steps) {
		const observed = await readState(step);
		if (statesMatch(observed, step.after)) {
			observedSteps.push({ ...step, before: { ...step.before }, after: { ...observed } });
			continue;
		}
		if (
			step.resourceKind !== 'task-source'
			|| step.after.state !== 'present'
			|| step.after.content === null
			|| observed.state !== 'present'
			|| observed.content === null
			|| sha256HexV1(observed.content) !== observed.digest
		) return { ok: false };
		const revision = resolveRuntimeSourceModifiedTimeSettlementRevisionV1(
			step.after.content,
			observed.content,
			keyMappings,
			modifiedTimeFrontmatterKeys,
			settlementWindow,
		);
		if (revision !== observed.digest) return { ok: false };
		observedSteps.push({ ...step, before: { ...step.before }, after: { ...observed } });
	}
	return { ok: true, observedSteps };
}
