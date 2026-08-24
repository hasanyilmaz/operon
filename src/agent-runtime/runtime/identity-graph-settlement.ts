import { parseDependencyIdList } from '../../core/dependency-graph';
import type { KeyMapping } from '../../types/settings';
import type { AtomicGroupResultV1, SealedCreateEffectV1 } from '../contracts/v1/mutation';
import { sha256HexV1 } from '../contracts/v1/canonical';
import type { IdentityPlaceholderSealedCreateEffectV1 } from '../extensions/task-workflows-v1/contracts';
import type { GraphTransactionJournalStepV1 } from './receipts/graph-transaction-journal';
import type { RuntimeMutationSettlementWindowV1 } from './mutation-gateway';
import { sourceRevisionForTaskCreationV1 } from './task-creation-adapter';
import {
	resolveRuntimeSourceModifiedTimeSettlementEvidenceV1,
} from './task-mutation-adapter';

export interface RuntimeIdentityGraphSourceSettlementProofV1 {
	readonly filePath: string;
	readonly observedContent: string;
	readonly verificationContent: string;
	readonly observedRevision: string;
	readonly reconciled: boolean;
}

export type RuntimeIdentityGraphSettlementResultV1 =
	| {
		readonly ok: true;
		readonly observedSteps: readonly GraphTransactionJournalStepV1[];
		readonly sourceProofs: readonly RuntimeIdentityGraphSourceSettlementProofV1[];
	}
	| { readonly ok: false };

export type RuntimeIdentityGraphSettlementOriginV1 =
	| 'fresh-commit'
	| 'recovery'
	| 'compensation';

function isSelfConsistentGraphStateV1(
	state: GraphTransactionJournalStepV1['after'],
): boolean {
	return state.state === 'absent'
		? state.content === null
		: state.content !== null && state.digest === sha256HexV1(state.content);
}

/**
 * Reconciles only the bounded modified-time write that can follow a newly
 * committed graph. The returned journal projection contains the real observed
 * revisions while source proofs retain the byte-exact sealed verification view.
 */
export async function reconcileRuntimeIdentityGraphSettlementV1(
	steps: readonly GraphTransactionJournalStepV1[],
	readState: (
		step: GraphTransactionJournalStepV1,
	) => Promise<GraphTransactionJournalStepV1['after']>,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[],
	settlementWindow: RuntimeMutationSettlementWindowV1,
): Promise<RuntimeIdentityGraphSettlementResultV1> {
	const observedSteps: GraphTransactionJournalStepV1[] = [];
	const sourceProofs: RuntimeIdentityGraphSourceSettlementProofV1[] = [];
	const taskSourcePaths = new Set<string>();
	for (const step of steps) {
		if (!isSelfConsistentGraphStateV1(step.after)) return { ok: false };
		const observed = await readState(step);
		if (!isSelfConsistentGraphStateV1(observed)) return { ok: false };
		if (step.resourceKind === 'task-source') {
			if (taskSourcePaths.has(step.resourceKey)) return { ok: false };
			taskSourcePaths.add(step.resourceKey);
		}
		if (
			observed.state === step.after.state
			&& observed.digest === step.after.digest
			&& observed.content === step.after.content
		) {
			observedSteps.push({ ...step, after: observed });
			if (step.resourceKind === 'task-source' && observed.content !== null) {
				sourceProofs.push({
					filePath: step.resourceKey,
					observedContent: observed.content,
					verificationContent: observed.content,
					observedRevision: observed.digest,
					reconciled: false,
				});
			}
			continue;
		}
		if (
			step.resourceKind !== 'task-source'
			|| step.after.state !== 'present'
			|| step.after.content === null
			|| observed.state !== 'present'
			|| observed.content === null
		) return { ok: false };
		const evidence = resolveRuntimeSourceModifiedTimeSettlementEvidenceV1(
			step.after.content,
			observed.content,
			keyMappings,
			modifiedTimeFrontmatterKeys,
			settlementWindow,
		);
		if (
			!evidence
			|| evidence.observedRevision !== observed.digest
			|| evidence.restoredContent !== step.after.content
		) return { ok: false };
		observedSteps.push({ ...step, after: observed });
		sourceProofs.push({
			filePath: step.resourceKey,
			observedContent: observed.content,
			verificationContent: evidence.restoredContent,
			observedRevision: evidence.observedRevision,
			reconciled: true,
		});
	}
	return { ok: true, observedSteps, sourceProofs };
}

/** Keeps recovery and compensation exact while admitting bounded fresh settlement. */
export function settleRuntimeIdentityGraphPostflightV1(
	origin: RuntimeIdentityGraphSettlementOriginV1,
	steps: readonly GraphTransactionJournalStepV1[],
	readState: (
		step: GraphTransactionJournalStepV1,
	) => Promise<GraphTransactionJournalStepV1['after']>,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[],
	settlementWindow?: RuntimeMutationSettlementWindowV1,
): Promise<RuntimeIdentityGraphSettlementResultV1> {
	if (origin === 'fresh-commit' && !settlementWindow) {
		return Promise.resolve({ ok: false });
	}
	return reconcileRuntimeIdentityGraphSettlementV1(
		steps,
		readState,
		keyMappings,
		origin === 'fresh-commit' ? modifiedTimeFrontmatterKeys : [],
		origin === 'fresh-commit'
			? settlementWindow as RuntimeMutationSettlementWindowV1
			: { applyStartedAtEpochMs: 0, settlementObservedAtEpochMs: 0 },
	);
}

export function buildRuntimeIdentityGraphGroupResultsV1(
	steps: readonly GraphTransactionJournalStepV1[],
	repeatSeriesRevision: string,
): AtomicGroupResultV1[] {
	return [...new Set(steps.map(step => step.groupId))].map(groupId => ({
		groupId,
		status: 'committed',
		resourceRevisions: steps.filter(step => step.groupId === groupId).map(step => ({
			resourceKind: step.resourceKind === 'repeat-series' ? 'repeat-series' : 'task-source',
			resourceKey: step.resourceKey,
			revision: step.resourceKind === 'repeat-series'
				? repeatSeriesRevision
				: sourceRevisionForTaskCreationV1(step.resourceKey, step.after.content),
		})),
	}));
}

export interface RuntimeIdentityGraphIndexedTaskProofV1 {
	readonly operonId: string;
	readonly duplicate: boolean;
	readonly filePath: string;
	readonly format: 'inline' | 'yaml';
	readonly lineNumber?: number;
	readonly fieldValues: Readonly<Record<string, string>>;
}

type RuntimeIdentityGraphCreateEffectV1 = SealedCreateEffectV1 & Partial<
	Pick<IdentityPlaceholderSealedCreateEffectV1, 'templateIdentityAllocations'>
>;

function normalizedUniqueValuesV1(values: readonly string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
}

function equalStringListsV1(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Verifies one sealed creation effect against indexed and explicit source proof. */
export function verifyRuntimeIdentityCreationEffectAfterStateV1(
	effect: RuntimeIdentityGraphCreateEffectV1,
	indexed: RuntimeIdentityGraphIndexedTaskProofV1 | null,
	sourceProof: RuntimeIdentityGraphSourceSettlementProofV1,
	repeatSeriesSourceTaskId?: string,
): boolean {
	if (
		!indexed
		|| indexed.duplicate
		|| indexed.operonId !== effect.operonId
		|| indexed.filePath !== effect.locator.filePath
		|| indexed.format !== (effect.locator.representation === 'file' ? 'yaml' : 'inline')
		|| (
			effect.locator.representation === 'inline'
			&& indexed.lineNumber !== effect.locator.lineNumber
		)
		|| (effect.resolvedParentOperonId ?? '') !== (indexed.fieldValues['parentTask'] ?? '')
		|| sourceProof.filePath !== effect.locator.filePath
		|| sourceProof.observedRevision !== sha256HexV1(sourceProof.observedContent)
		|| sourceProof.reconciled === (
			sourceProof.observedContent === sourceProof.verificationContent
		)
		|| sha256HexV1(sourceProof.verificationContent) !== effect.plannedSourceDigest
	) return false;
	const related = normalizedUniqueValuesV1((indexed.fieldValues['related'] ?? '').split(';'));
	if (!equalStringListsV1(related, normalizedUniqueValuesV1(effect.resolvedRelatedOperonIds))) return false;
	for (const relation of ['blocks', 'blocked-by'] as const) {
		const field = relation === 'blocks' ? 'blocking' : 'blockedBy';
		const actual = normalizedUniqueValuesV1(parseDependencyIdList(indexed.fieldValues[field]));
		const expected = normalizedUniqueValuesV1(
			(effect.resolvedDependencies ?? [])
				.filter(item => item.relation === relation)
				.map(item => item.operonId),
		);
		if (!equalStringListsV1(actual, expected)) return false;
	}
	const rendered = effect.locator.representation === 'file'
		? sourceProof.verificationContent
		: sourceProof.verificationContent.split(/\r?\n/u)[effect.locator.lineNumber];
	if (rendered === undefined || sha256HexV1(rendered) !== effect.renderedTaskDigest) return false;
	if (
		effect.templateIdentityAllocations?.some(
			allocation => !sourceProof.verificationContent.includes(allocation.operonId),
		)
	) return false;
	return effect.repeatSeriesId === undefined
		? true
		: repeatSeriesSourceTaskId === effect.operonId;
}
