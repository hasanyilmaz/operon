import { sha256HexV1 } from '../contracts/v1/canonical';
import type {
	AtomicGroupResultV1,
	AtomicResourceGroupV1,
	PredictedEffectV1,
} from '../contracts/v1/mutation';
import type {
	AffectedResourceRevisionMapV1,
	ResourceRevisionV1,
	TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import {
	RESOURCE_QUEUE_ORDER_V1,
	sameTaskSourceLocatorV1,
} from '../contracts/v1/identity';
import {
	structuredErrorV1,
	type StructuredErrorCodeV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import type {
	RuntimeExactTaskMutationSnapshotV1,
	RuntimeTaskFieldMutationPreparationV1,
} from './task-mutation-adapter';
import { sourceRevisionForTaskCreationV1 } from './task-creation-adapter';

const MAX_TRANSITION_ANCESTOR_DEPTH_V1 = 100;

export interface RuntimeSemanticTransitionStateRevisionsV1 {
	readonly activeTracker: string;
	readonly repeatSeries: string;
	readonly pinned: string;
	readonly projectSerial: string;
}

export interface RuntimeSemanticTransitionPlannerPortsV1 {
	getTask(operonId: string): RuntimeExactTaskMutationSnapshotV1 | null;
	isPinned(operonId: string): boolean;
	hasProjectSerialScopes(): boolean;
	stateRevisions(): RuntimeSemanticTransitionStateRevisionsV1;
	planRecurrence?(
		request: RuntimeSemanticTransitionRecurrencePlanningRequestV1,
	): Promise<RuntimeSemanticTransitionRecurrencePlanningResultV1>;
}

export interface RuntimeSemanticTransitionAncestorGroupV1 {
	readonly groupId: string;
	readonly filePath: string;
	readonly sourceRevision: string;
	/** Descendant-first order matches aggregate propagation order. */
	readonly ancestors: readonly RuntimeExactTaskMutationSnapshotV1[];
}

export interface RuntimeSemanticTransitionRecurrenceEffectV1 {
	readonly groupId: string;
	readonly sourceOperonId: string;
	readonly seriesId: string | null;
	readonly terminalCheckbox: 'done' | 'cancelled';
	readonly preview: RuntimeSemanticTransitionRecurrencePreviewV1;
}

export interface RuntimeSemanticTransitionRecurrencePlanningRequestV1 {
	readonly sourceTask: RuntimeExactTaskMutationSnapshotV1;
	readonly transitionFieldValues: Readonly<Record<string, string>>;
	/** Full descendant-first chain, available for coalesced aggregate rendering. */
	readonly ancestors: readonly RuntimeExactTaskMutationSnapshotV1[];
	/**
	 * The live adapter must use a sealed planning instant on preview and apply.
	 * It must not inject a fresh wall-clock value while rebuilding the plan.
	 */
	readonly effectiveAt: string;
}

export interface RuntimeSemanticTransitionRecurrenceMaterializationPreviewV1 {
	readonly disposition: 'materialize';
	readonly seriesId: string;
	readonly nextOperonId: string;
	readonly nextLocator: TaskSourceLocatorV1;
	/** Exact post-materialization source content held only in the internal token. */
	readonly plannedSourceContent: string;
	readonly plannedSourceRevision: string;
	/** Exact content expected immediately before recurrence materialization. */
	readonly applyExpectedSourceContent: string | null;
	readonly sourcePrecondition:
		| { readonly expectedAbsence: true }
		| { readonly expectedSourceRevision: string };
	/** Whether the terminal source task remains addressable after materialization. */
	readonly sourceTaskRetained: boolean;
	/** Exact terminal-task locator after plain-name File Task archival. */
	readonly sourceTaskFinalLocator?: TaskSourceLocatorV1;
	/** Additional exact archive source required by plain-name File Task recurrence. */
	readonly archiveSource?: {
		readonly locator: TaskSourceLocatorV1;
		readonly plannedSourceContent: string;
		readonly plannedSourceRevision: string;
		readonly sourcePrecondition: { readonly expectedAbsence: true };
	};
	/**
	 * True when primary and recurrence must be rendered into one guarded source
	 * write because V1 binds a resource to exactly one atomic group.
	 */
	readonly coalescedWithPrimarySource: boolean;
}

export interface RuntimeSemanticTransitionRecurrenceEndedPreviewV1 {
	readonly disposition: 'ended';
	readonly seriesId: string | null;
	readonly reason: 'repeat-end' | 'count-exhausted' | 'no-next-occurrence';
}

export type RuntimeSemanticTransitionRecurrencePreviewV1 =
	| RuntimeSemanticTransitionRecurrenceMaterializationPreviewV1
	| RuntimeSemanticTransitionRecurrenceEndedPreviewV1;

export type RuntimeSemanticTransitionRecurrencePlanningResultV1 =
	| { readonly ok: true; readonly value: RuntimeSemanticTransitionRecurrencePreviewV1 }
	| {
		readonly ok: false;
		readonly code: StructuredErrorCodeV1;
		readonly reason: string;
		readonly collision?: {
			readonly kind: 'operon-id' | 'file-path' | 'source-revision';
			readonly value: string;
		};
	};

export interface RuntimeSemanticTransitionPlanV1 {
	readonly kind: 'semantic-transition-plan';
	readonly operation: 'task.transition';
	readonly effectiveAt: string;
	readonly prepared: RuntimeTaskFieldMutationPreparationV1;
	readonly noChange: boolean;
	readonly primaryGroup: AtomicResourceGroupV1;
	/** Ancestors co-located with the target and reconciled by the primary source write. */
	readonly primaryAncestors: readonly RuntimeExactTaskMutationSnapshotV1[];
	readonly recurrence: RuntimeSemanticTransitionRecurrenceEffectV1 | null;
	readonly ancestorGroups: readonly RuntimeSemanticTransitionAncestorGroupV1[];
	readonly pinnedGroup: AtomicResourceGroupV1 | null;
	readonly projectSerialGroup: AtomicResourceGroupV1 | null;
	readonly affectedResources: AffectedResourceRevisionMapV1;
	readonly atomicGroups: readonly AtomicResourceGroupV1[];
	readonly predictedEffects: readonly PredictedEffectV1[];
}

export type RuntimeSemanticTransitionPlanningResultV1 =
	| { ok: true; value: RuntimeSemanticTransitionPlanV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export type RuntimeSemanticTransitionRecurrenceDispositionV1 =
	| 'created'
	| 'ended';

export interface RuntimeSemanticTransitionStepSuccessV1 {
	readonly ok: true;
	readonly resourceRevisions?: readonly ResourceRevisionV1[];
	readonly affectedFilePaths?: readonly string[];
}

export interface RuntimeSemanticTransitionStepFailureV1 {
	readonly ok: false;
	readonly reason: string;
	/**
	 * True when the step may have durably changed state before its result became
	 * uncertain. The coordinator never reports a clean failure in that case.
	 */
	readonly outcomeUnknown?: boolean;
}

export type RuntimeSemanticTransitionStepResultV1 =
	| RuntimeSemanticTransitionStepSuccessV1
	| RuntimeSemanticTransitionStepFailureV1;

export type RuntimeSemanticTransitionRecurrenceResultV1 =
	| (
		RuntimeSemanticTransitionStepSuccessV1
		& { readonly disposition: RuntimeSemanticTransitionRecurrenceDispositionV1 }
	)
	| RuntimeSemanticTransitionStepFailureV1;

export interface RuntimeSemanticTransitionCoordinatorPortsV1 {
	commitPrimary(
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionStepResultV1>;
	materializeRecurrence(
		effect: RuntimeSemanticTransitionRecurrenceEffectV1,
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionRecurrenceResultV1>;
	reconcilePrimaryAncestors(
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionStepResultV1>;
	reconcileAncestorGroup(
		group: RuntimeSemanticTransitionAncestorGroupV1,
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionStepResultV1>;
	removePinned(
		operonId: string,
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionStepResultV1>;
	settleProjectSerial(
		plan: RuntimeSemanticTransitionPlanV1,
	): Promise<RuntimeSemanticTransitionStepResultV1>;
}

export interface RuntimeSemanticTransitionExecutionResultV1 {
	readonly status: 'committed' | 'failed' | 'partial' | 'outcome-unknown';
	readonly groupResults: readonly AtomicGroupResultV1[];
	readonly affectedFilePaths: readonly string[];
	readonly recurrenceDisposition?: RuntimeSemanticTransitionRecurrenceDispositionV1;
	readonly reason?: string;
}

export interface RuntimeSemanticTransitionExecutionOptionsV1 {
	/**
	 * Durable operation steps that were verified and checkpointed by an earlier
	 * same-plan execution. Recovery skips only this exact ordered prefix.
	 */
	readonly completedStepIds?: readonly string[];
	readonly onStepCommitted?: (
		stepId: string,
		completedStepCount: number,
	) => Promise<void>;
	readonly classifyUncheckpointedStep?: (
		stepId: string,
	) => Promise<'before' | 'after' | 'other'>;
}

export function runtimeSemanticTransitionStepIdsV1(
	plan: RuntimeSemanticTransitionPlanV1,
): string[] {
	if (plan.noChange) return ['primary'];
	return [
		'primary',
		...(plan.recurrence ? ['recurrence'] : []),
		...(plan.primaryAncestors.length > 0 ? ['primary-ancestors'] : []),
		...plan.ancestorGroups.map(group => `ancestor:${group.groupId}`),
		...(plan.pinnedGroup ? ['pinned'] : []),
		...(plan.projectSerialGroup ? ['project-serial'] : []),
	];
}

export interface RuntimeSemanticTransitionPostflightEvidenceV1 {
	readonly primaryVerified: boolean;
	readonly timer?: {
		readonly activeTrackerCleared: boolean;
		readonly sessionStateVerified: boolean;
		readonly activeTrackerRevision: string;
		readonly committedActiveTrackerRevision?: string;
	};
	readonly recurrence?: {
		readonly disposition: RuntimeSemanticTransitionRecurrenceDispositionV1;
		readonly nextOperonId?: string;
		readonly nextLocator?: TaskSourceLocatorV1;
		readonly sourceRevision?: string;
		readonly committedSourceRevision?: string;
		readonly archiveSourceRevision?: string;
		readonly stateVerified: boolean;
	};
	readonly verifiedAncestorOperonIds: readonly string[];
	readonly pinned: boolean;
	readonly projectSerialRevision?: string;
	readonly committedProjectSerialRevision?: string;
}

export interface RuntimeSemanticTransitionPostflightResultV1 {
	readonly ok: boolean;
	readonly failures: readonly (
		| 'primary'
		| 'timer'
		| 'recurrence'
		| 'ancestors'
		| 'pinned'
		| 'project-serial'
	)[];
}

/**
 * Expands the field-level transition preparation into the full set of durable
 * effects that the live adapter must seal. It performs no I/O and does not
 * change the V1 wire contract.
 */
export async function planRuntimeSemanticTransitionV1(
	prepared: RuntimeTaskFieldMutationPreparationV1,
	effectiveAt: string,
	ports: RuntimeSemanticTransitionPlannerPortsV1,
): Promise<RuntimeSemanticTransitionPlanningResultV1> {
	if (prepared.operation !== 'transition' || !prepared.transition) {
		return failure(
			'mutation-kind-mismatch',
			'Semantic transition planning requires a prepared tasks.transition mutation.',
		);
	}
	if (!isValidIsoInstant(effectiveAt)) {
		return failure('invalid-request', 'Semantic transition effectiveAt must be an ISO instant.');
	}

	const revisions = ports.stateRevisions();
	const pinnedRequired = prepared.transition.autoUnpin
		&& ports.isPinned(prepared.task.operonId);
	const primaryResources: AtomicResourceGroupV1['resources'] = [
		...(prepared.transition.finalizeActiveTimer
			? [{ resourceKind: 'active-tracker' as const, resourceKey: 'current-user' }]
			: []),
		{
			resourceKind: 'task-source',
			resourceKey: prepared.task.locator.filePath,
		},
	];
	const primaryGroup: AtomicResourceGroupV1 = {
		groupId: `task-transition:${prepared.task.operonId}`,
		order: 0,
		resources: primaryResources,
	};

	if (
		prepared.noChange
		&& !prepared.transition.finalizeActiveTimer
		&& !pinnedRequired
	) {
		const affectedResources = primaryResources.map(resource => (
			resource.resourceKind === 'active-tracker'
				? { ...resource, revision: revisions.activeTracker }
				: { ...resource, revision: prepared.sourceRevision }
		));
		return {
			ok: true,
			value: {
				kind: 'semantic-transition-plan',
				operation: 'task.transition',
				effectiveAt,
				prepared,
				noChange: true,
				primaryGroup,
				primaryAncestors: [],
				recurrence: null,
				ancestorGroups: [],
				pinnedGroup: null,
				projectSerialGroup: null,
				affectedResources,
				atomicGroups: [primaryGroup],
				predictedEffects: [],
			},
		};
	}

	const ancestors = resolveTransitionAncestors(prepared, ports);
	if (!ancestors.ok) return ancestors;

	const ancestorGroups = buildAncestorGroups(
		ancestors.value,
		prepared.task.locator.filePath,
	);
	if (!ancestorGroups.ok) return ancestorGroups;
	const primaryAncestors = ancestors.value.filter(
		ancestor => ancestor.locator.filePath === prepared.task.locator.filePath,
	);
	if (primaryAncestors.some(ancestor => (
		ancestor.sourceContent !== prepared.task.sourceContent
	))) {
		return failure(
			'stale-source',
			'Co-located ancestor snapshots disagree with the primary task source.',
		);
	}

	let recurrence: RuntimeSemanticTransitionRecurrenceEffectV1 | null = null;
	if (prepared.transition.materializeRecurrence) {
		if (!ports.planRecurrence) {
			return failure(
				'capability-unavailable',
				'Recurrence transition preview requires the read-only recurrence planning port.',
			);
		}
		const recurrencePlan = await ports.planRecurrence({
			sourceTask: prepared.task,
			transitionFieldValues: prepared.fieldValues,
			ancestors: ancestors.value,
			effectiveAt,
		});
		if (!recurrencePlan.ok) {
			return failure(recurrencePlan.code, recurrencePlan.reason);
		}
		const recurrenceValidation = validateRecurrencePreview(
			recurrencePlan.value,
			prepared,
			ports,
		);
		if (!recurrenceValidation.ok) return recurrenceValidation;
		if (
			prepared.transition.finalizeActiveTimer
			&& recurrencePlan.value.disposition === 'materialize'
			&& !recurrencePlan.value.sourceTaskRetained
		) {
			return failure(
				'capability-unavailable',
				'An active timer cannot be finalized when recurrence replaces the terminal inline task.',
			);
		}
		if (recurrencePlan.value.disposition === 'materialize') {
			const nextFilePath = recurrencePlan.value.nextLocator.filePath;
			if (
				!recurrencePlan.value.coalescedWithPrimarySource
				&& ancestors.value.some(ancestor => ancestor.locator.filePath === nextFilePath)
			) {
				return failure(
					'stale-source',
					'Planned recurrence source collides with a sealed ancestor source.',
				);
			}
		}
		recurrence = {
			groupId: `repeat-series:${prepared.task.operonId}`,
			sourceOperonId: prepared.task.operonId,
			seriesId: recurrencePlan.value.seriesId,
			terminalCheckbox: prepared.transition.toCheckbox as 'done' | 'cancelled',
			preview: recurrencePlan.value,
		};
	}
	const pinnedGroup = pinnedRequired
		? {
			groupId: `pinned:${prepared.task.operonId}`,
			order: 0,
			resources: [{
				resourceKind: 'pinned' as const,
				resourceKey: prepared.task.operonId,
			}],
		}
		: null;
	const projectSerialGroup: AtomicResourceGroupV1 | null = ports.hasProjectSerialScopes()
		? {
			groupId: 'project-serial:global',
			order: 0,
			resources: [{
				resourceKind: 'project-serial',
				resourceKey: 'global',
			}],
		}
		: null;

	const atomicGroups: AtomicResourceGroupV1[] = [primaryGroup];
	if (recurrence) {
		const recurrenceResources: AtomicResourceGroupV1['resources'] = [{
			resourceKind: 'repeat-series',
			resourceKey: recurrence.seriesId ?? 'global',
		}];
		if (
			recurrence.preview.disposition === 'materialize'
			&& !recurrence.preview.coalescedWithPrimarySource
		) {
			recurrenceResources.push({
				resourceKind: 'task-source',
				resourceKey: recurrence.preview.nextLocator.filePath,
			});
		}
		if (
			recurrence.preview.disposition === 'materialize'
			&& recurrence.preview.archiveSource
		) {
			recurrenceResources.push({
				resourceKind: 'task-source',
				resourceKey: recurrence.preview.archiveSource.locator.filePath,
			});
		}
		atomicGroups.push({
			groupId: recurrence.groupId,
			order: atomicGroups.length,
			resources: recurrenceResources,
		});
	}
	for (const group of ancestorGroups.value) {
		atomicGroups.push({
			groupId: group.groupId,
			order: atomicGroups.length,
			resources: [{
				resourceKind: 'task-source',
				resourceKey: group.filePath,
			}],
		});
	}
	if (pinnedGroup) {
		atomicGroups.push({ ...pinnedGroup, order: atomicGroups.length });
	}
	if (projectSerialGroup) {
		atomicGroups.push({ ...projectSerialGroup, order: atomicGroups.length });
	}

	const affectedResources = dedupeResourceRevisions([
		...(prepared.transition.finalizeActiveTimer
			? [{
				resourceKind: 'active-tracker' as const,
				resourceKey: 'current-user',
				revision: revisions.activeTracker,
			}]
			: []),
		{
			resourceKind: 'task-source' as const,
			resourceKey: prepared.task.locator.filePath,
			revision: prepared.sourceRevision,
		},
		...(recurrence
			? [{
				resourceKind: 'repeat-series' as const,
				resourceKey: recurrence.seriesId ?? 'global',
				revision: revisions.repeatSeries,
			}, ...(
				recurrence.preview.disposition === 'materialize'
					&& !recurrence.preview.coalescedWithPrimarySource
					? [{
						resourceKind: 'task-source' as const,
						resourceKey: recurrence.preview.nextLocator.filePath,
						revision: 'expectedAbsence' in recurrence.preview.sourcePrecondition
							? sourceRevisionForTaskCreationV1(
								recurrence.preview.nextLocator.filePath,
								null,
							)
							: recurrence.preview.sourcePrecondition.expectedSourceRevision,
					}]
					: []
			), ...(
				recurrence.preview.disposition === 'materialize'
					&& recurrence.preview.archiveSource
					? [{
						resourceKind: 'task-source' as const,
						resourceKey: recurrence.preview.archiveSource.locator.filePath,
						revision: sourceRevisionForTaskCreationV1(
							recurrence.preview.archiveSource.locator.filePath,
							null,
						),
					}]
					: []
			)]
			: []),
		...ancestorGroups.value.map(group => ({
			resourceKind: 'task-source' as const,
			resourceKey: group.filePath,
			revision: group.sourceRevision,
		})),
		...(pinnedGroup
			? [{
				resourceKind: 'pinned' as const,
				resourceKey: prepared.task.operonId,
				revision: revisions.pinned,
			}]
			: []),
		...(projectSerialGroup
			? [{
				resourceKind: 'project-serial' as const,
				resourceKey: 'global',
				revision: revisions.projectSerial,
			}]
			: []),
	]).sort(compareResourceReferences);
	const recurrenceSourceAction: PredictedEffectV1['action'] = (
		recurrence?.preview.disposition === 'materialize'
			&& 'expectedAbsence' in recurrence.preview.sourcePrecondition
	)
		? 'create'
		: 'update';
	const predictedEffects: PredictedEffectV1[] = [
		{
			resourceKind: 'task-source' as const,
			resourceKey: prepared.task.locator.filePath,
			action: 'update' as const,
			summary: primaryAncestors.length > 0
				? `${prepared.summary} Reconcile ${primaryAncestors.length} co-located ancestor task(s).`
				: prepared.summary,
		},
		...(prepared.transition.finalizeActiveTimer
			? [{
				resourceKind: 'active-tracker' as const,
				resourceKey: 'current-user',
				action: 'state-change' as const,
				summary: 'Finalize the active timer with the terminal task source write.',
			}]
			: []),
		...(recurrence
			? [{
				resourceKind: 'repeat-series' as const,
				resourceKey: recurrence.seriesId ?? 'global',
				action: 'state-change' as const,
				summary: recurrence.preview.disposition === 'materialize'
					? `Materialize sealed recurrence task ${recurrence.preview.nextOperonId}`
						+ ` with source digest ${recurrence.preview.plannedSourceRevision}.`
					: `Verify that the sealed recurrence series ended: ${recurrence.preview.reason}.`,
			}, ...(
				recurrence.preview.disposition === 'materialize'
					&& !recurrence.preview.coalescedWithPrimarySource
					? [{
							resourceKind: 'task-source' as const,
							resourceKey: recurrence.preview.nextLocator.filePath,
							action: recurrenceSourceAction,
							summary: `Write sealed recurrence source for ${recurrence.preview.nextOperonId}`
								+ ` with digest ${recurrence.preview.plannedSourceRevision}.`,
					}]
					: []
			), ...(
				recurrence.preview.disposition === 'materialize'
					&& recurrence.preview.archiveSource
					? [{
						resourceKind: 'task-source' as const,
						resourceKey: recurrence.preview.archiveSource.locator.filePath,
						action: 'create' as const,
						summary: `Archive terminal recurrence source for ${prepared.task.operonId}`
							+ ` with digest ${recurrence.preview.archiveSource.plannedSourceRevision}.`,
					}]
					: []
			)]
			: []),
		...ancestorGroups.value.map(group => ({
			resourceKind: 'task-source' as const,
			resourceKey: group.filePath,
			action: 'update' as const,
			summary: `Reconcile ${group.ancestors.length} ancestor task(s) after the transition.`,
		})),
		...(pinnedGroup
			? [{
				resourceKind: 'pinned' as const,
				resourceKey: prepared.task.operonId,
				action: 'state-change' as const,
				summary: 'Remove the terminal task from pinned state.',
			}]
			: []),
		...(projectSerialGroup
			? [{
				resourceKind: 'project-serial' as const,
				resourceKey: 'global',
				action: 'state-change' as const,
				summary: 'Settle project serial state after all task and hierarchy effects.',
			}]
			: []),
	].sort(compareResourceReferences);

	return {
		ok: true,
		value: {
			kind: 'semantic-transition-plan',
			operation: 'task.transition',
			effectiveAt,
			prepared,
			noChange: false,
			primaryGroup,
			primaryAncestors,
			recurrence,
			ancestorGroups: ancestorGroups.value,
			pinnedGroup: pinnedGroup
				? atomicGroups.find(group => group.groupId === pinnedGroup.groupId) ?? null
				: null,
			projectSerialGroup: projectSerialGroup
				? atomicGroups.find(group => group.groupId === projectSerialGroup.groupId) ?? null
				: null,
			affectedResources,
			atomicGroups,
			predictedEffects,
		},
	};
}

/**
 * Runs the already sealed effects in canonical behavior order. Once primary
 * state commits, a later fault is outcome-unknown rather than a clean failure.
 */
export async function executeRuntimeSemanticTransitionV1(
	plan: RuntimeSemanticTransitionPlanV1,
	ports: RuntimeSemanticTransitionCoordinatorPortsV1,
	options: RuntimeSemanticTransitionExecutionOptionsV1 = {},
): Promise<RuntimeSemanticTransitionExecutionResultV1> {
	const orderedStepIds = runtimeSemanticTransitionStepIdsV1(plan);
	const completedStepIds = options.completedStepIds ?? [];
	if (
		completedStepIds.some((stepId, index) => orderedStepIds[index] !== stepId)
	) {
		return {
			status: 'outcome-unknown',
			groupResults: [],
			affectedFilePaths: [],
			reason: 'The semantic-transition recovery checkpoint is not an ordered plan prefix.',
		};
	}
	const completedPrefix = new Set(completedStepIds);
	let completedStepCount = completedStepIds.length;
	if (plan.noChange) {
		if (!completedPrefix.has('primary')) {
			await options.onStepCommitted?.('primary', 1);
		}
		return {
			status: 'committed',
			groupResults: [committedGroup(plan.primaryGroup, plan.affectedResources)],
			affectedFilePaths: [],
		};
	}

	const groupResults: AtomicGroupResultV1[] = [];
	const affectedFilePaths = new Set<string>();
	let committedEffect = false;
	let recurrenceDisposition: RuntimeSemanticTransitionRecurrenceDispositionV1 | undefined;

	const runStep = async (
		stepId: string,
		group: AtomicResourceGroupV1,
		run: () => Promise<RuntimeSemanticTransitionStepResultV1>,
	): Promise<RuntimeSemanticTransitionExecutionResultV1 | null> => {
		if (completedPrefix.has(stepId)) {
			committedEffect = true;
			groupResults.push(committedGroup(group, plan.affectedResources));
			return null;
		}
		const observed = await options.classifyUncheckpointedStep?.(stepId);
		if (observed === 'other') {
			return {
				status: 'outcome-unknown',
				groupResults,
				affectedFilePaths: [...affectedFilePaths],
				reason: `Semantic transition step is neither at its sealed before nor after state: ${stepId}`,
			};
		}
		if (observed === 'after') {
			committedEffect = true;
			groupResults.push(committedGroup(group, plan.affectedResources));
			completedStepCount += 1;
			await options.onStepCommitted?.(stepId, completedStepCount);
			return null;
		}
		let result: RuntimeSemanticTransitionStepResultV1;
		try {
			result = await run();
		} catch (error) {
			result = {
				ok: false,
				outcomeUnknown: true,
				reason: error instanceof Error ? error.message : 'Semantic transition step threw.',
			};
		}
		if (!result.ok) {
			const status = result.outcomeUnknown
				? 'outcome-unknown'
				: committedEffect
					? 'partial'
					: 'failed';
			groupResults.push(failedGroup(
				group,
				result.outcomeUnknown ? 'outcome-unknown' : 'failed',
				result.reason,
			));
			return {
				status,
				groupResults,
				affectedFilePaths: [...affectedFilePaths],
				reason: result.reason,
			};
		}
		committedEffect = true;
		for (const path of result.affectedFilePaths ?? []) affectedFilePaths.add(path);
		groupResults.push(committedGroup(
			group,
			result.resourceRevisions,
		));
		completedStepCount += 1;
		await options.onStepCommitted?.(stepId, completedStepCount);
		return null;
	};

	const primaryFailure = await runStep(
		'primary',
		plan.primaryGroup,
		() => ports.commitPrimary(plan),
	);
	if (primaryFailure) return primaryFailure;

	if (plan.recurrence) {
		const recurrenceGroup = findGroup(plan, plan.recurrence.groupId);
		const recurrenceResult: {
			value?: RuntimeSemanticTransitionRecurrenceResultV1;
		} = {};
		const recurrenceFailure = await runStep('recurrence', recurrenceGroup, async () => {
			recurrenceResult.value = await ports.materializeRecurrence(plan.recurrence!, plan);
			const expectedDisposition = plan.recurrence!.preview.disposition === 'materialize'
				? 'created'
				: 'ended';
			if (
				recurrenceResult.value.ok
				&& recurrenceResult.value.disposition !== expectedDisposition
			) {
				return {
					ok: false,
					outcomeUnknown: true,
					reason: 'Recurrence apply outcome does not match the sealed recurrence preview.',
				};
			}
			return recurrenceResult.value;
		});
		if (recurrenceFailure) return recurrenceFailure;
		if (completedPrefix.has('recurrence')) {
			recurrenceDisposition = plan.recurrence.preview.disposition === 'materialize'
				? 'created'
				: 'ended';
		} else if (recurrenceResult.value?.ok) {
			recurrenceDisposition = recurrenceResult.value.disposition;
			if (
				plan.recurrence.preview.disposition === 'materialize'
				&& plan.recurrence.preview.coalescedWithPrimarySource
				&& recurrenceResult.value.resourceRevisions
			) {
				const primaryResultIndex = groupResults.findIndex(
					result => result.groupId === plan.primaryGroup.groupId,
				);
				if (primaryResultIndex >= 0) {
					const previousRevisions = groupResults[primaryResultIndex].resourceRevisions ?? [];
					const latestByResource = new Map(
						[
							...previousRevisions,
							...recurrenceResult.value.resourceRevisions,
						].map(revision => [
							`${revision.resourceKind}\0${revision.resourceKey}`,
							revision,
						]),
					);
					groupResults[primaryResultIndex] = committedGroup(
						plan.primaryGroup,
						[...latestByResource.values()],
					);
				}
			}
		}
	}

	if (plan.primaryAncestors.length > 0) {
		const primaryAncestorResult = completedPrefix.has('primary-ancestors')
			? { ok: true as const }
			: await ports.reconcilePrimaryAncestors(plan);
		if (!primaryAncestorResult.ok) {
			const reason = primaryAncestorResult.reason;
			const primaryResultIndex = groupResults.findIndex(
				result => result.groupId === plan.primaryGroup.groupId,
			);
			if (primaryResultIndex >= 0) {
				groupResults[primaryResultIndex] = failedGroup(
					plan.primaryGroup,
					'outcome-unknown',
					reason,
				);
			}
			return {
				status: 'outcome-unknown',
				groupResults,
				affectedFilePaths: [...affectedFilePaths],
				reason,
			};
		}
		if (!completedPrefix.has('primary-ancestors')) {
			completedStepCount += 1;
			await options.onStepCommitted?.('primary-ancestors', completedStepCount);
		}
		for (const path of primaryAncestorResult.affectedFilePaths ?? []) {
			affectedFilePaths.add(path);
		}
		const primaryResultIndex = groupResults.findIndex(
			result => result.groupId === plan.primaryGroup.groupId,
		);
		if (primaryResultIndex >= 0 && primaryAncestorResult.resourceRevisions) {
			const previousRevisions = groupResults[primaryResultIndex].resourceRevisions ?? [];
			const latestByResource = new Map(
				[
					...previousRevisions,
					...primaryAncestorResult.resourceRevisions,
				].map(revision => [
					`${revision.resourceKind}\0${revision.resourceKey}`,
					revision,
				]),
			);
			groupResults[primaryResultIndex] = committedGroup(
				plan.primaryGroup,
				[...latestByResource.values()],
			);
		}
	}

	for (const ancestorGroup of plan.ancestorGroups) {
		const group = findGroup(plan, ancestorGroup.groupId);
		const ancestorFailure = await runStep(
			`ancestor:${ancestorGroup.groupId}`,
			group,
			() => ports.reconcileAncestorGroup(ancestorGroup, plan),
		);
		if (ancestorFailure) return ancestorFailure;
	}

	if (plan.pinnedGroup) {
		const pinnedFailure = await runStep(
			'pinned',
			plan.pinnedGroup,
			() => ports.removePinned(plan.prepared.task.operonId, plan),
		);
		if (pinnedFailure) return pinnedFailure;
	}

	if (plan.projectSerialGroup) {
		const projectSerialFailure = await runStep(
			'project-serial',
			plan.projectSerialGroup,
			() => ports.settleProjectSerial(plan),
		);
		if (projectSerialFailure) return projectSerialFailure;
	}

	return {
		status: 'committed',
		groupResults,
		affectedFilePaths: [...affectedFilePaths],
		...(recurrenceDisposition ? { recurrenceDisposition } : {}),
	};
}

export function verifyRuntimeSemanticTransitionPostflightV1(
	plan: RuntimeSemanticTransitionPlanV1,
	evidence: RuntimeSemanticTransitionPostflightEvidenceV1,
): RuntimeSemanticTransitionPostflightResultV1 {
	if (plan.noChange) {
		const timerVerified = !plan.prepared.transition?.finalizeActiveTimer
			|| (
				evidence.timer?.activeTrackerCleared === true
				&& evidence.timer.sessionStateVerified
				&& evidence.timer.activeTrackerRevision
					=== evidence.timer.committedActiveTrackerRevision
			);
		return {
			ok: evidence.primaryVerified && timerVerified,
			failures: [
				...(evidence.primaryVerified ? [] : ['primary' as const]),
				...(timerVerified ? [] : ['timer' as const]),
			],
		};
	}
	const failures: RuntimeSemanticTransitionPostflightResultV1['failures'][number][] = [];
	if (!evidence.primaryVerified) failures.push('primary');
	if (
		plan.prepared.transition?.finalizeActiveTimer
		&& (
			evidence.timer?.activeTrackerCleared !== true
			|| !evidence.timer.sessionStateVerified
			|| evidence.timer.activeTrackerRevision
				!== evidence.timer.committedActiveTrackerRevision
		)
	) failures.push('timer');
	if (plan.recurrence) {
		if (plan.recurrence.preview.disposition === 'ended') {
			if (
				evidence.recurrence?.disposition !== 'ended'
				|| !evidence.recurrence.stateVerified
			) failures.push('recurrence');
		} else if (
			evidence.recurrence?.disposition !== 'created'
			|| evidence.recurrence.nextOperonId !== plan.recurrence.preview.nextOperonId
			|| !sameTaskSourceLocatorV1(
				evidence.recurrence.nextLocator,
				plan.recurrence.preview.nextLocator,
			)
			|| !evidence.recurrence.stateVerified
			|| evidence.recurrence.sourceRevision
				!== evidence.recurrence.committedSourceRevision
			|| (
				!(
					plan.recurrence.preview.coalescedWithPrimarySource
					&& plan.primaryAncestors.length > 0
				)
				&& evidence.recurrence.sourceRevision
					!== plan.recurrence.preview.plannedSourceRevision
			)
			|| (
				plan.recurrence.preview.archiveSource
				&& evidence.recurrence.archiveSourceRevision
					!== plan.recurrence.preview.archiveSource.plannedSourceRevision
			)
		) {
			failures.push('recurrence');
		}
	}
	const expectedAncestors = new Set(
		[
			...plan.primaryAncestors.map(task => task.operonId),
			...plan.ancestorGroups.flatMap(group => group.ancestors.map(task => task.operonId)),
		],
	);
	const verifiedAncestors = new Set(evidence.verifiedAncestorOperonIds);
	if ([...expectedAncestors].some(operonId => !verifiedAncestors.has(operonId))) {
		failures.push('ancestors');
	}
	if (plan.pinnedGroup && evidence.pinned) failures.push('pinned');
	if (
		plan.projectSerialGroup
		&& (
			!evidence.projectSerialRevision
			|| evidence.projectSerialRevision !== evidence.committedProjectSerialRevision
		)
	) failures.push('project-serial');
	return { ok: failures.length === 0, failures };
}

function resolveTransitionAncestors(
	prepared: RuntimeTaskFieldMutationPreparationV1,
	ports: RuntimeSemanticTransitionPlannerPortsV1,
):
	| { ok: true; value: RuntimeExactTaskMutationSnapshotV1[] }
	| { ok: false; code: StructuredErrorCodeV1; reason: string } {
	const ancestors: RuntimeExactTaskMutationSnapshotV1[] = [];
	const visited = new Set<string>([prepared.task.operonId]);
	let nextId = clean(prepared.task.fieldValues['parentTask']);
	for (let depth = 0; nextId; depth += 1) {
		if (depth >= MAX_TRANSITION_ANCESTOR_DEPTH_V1) {
			return failure(
				'invalid-request',
				`Ancestor chain exceeds ${MAX_TRANSITION_ANCESTOR_DEPTH_V1} tasks.`,
			);
		}
		if (!isOperonId(nextId)) {
			return failure('invalid-request', 'The task has an invalid or ambiguous parentTask relation.');
		}
		if (visited.has(nextId)) {
			return failure('invalid-request', `Ancestor cycle detected at ${nextId}.`);
		}
		visited.add(nextId);
		const ancestor = ports.getTask(nextId);
		if (!ancestor) {
			return failure('entity-not-found', `Ancestor task is unavailable: ${nextId}.`);
		}
		if (ancestor.duplicate) {
			return failure('duplicate-operon-id', `Ancestor operonId is duplicated: ${nextId}.`);
		}
		ancestors.push(ancestor);
		nextId = clean(ancestor.fieldValues['parentTask']);
	}
	return { ok: true, value: ancestors };
}

function buildAncestorGroups(
	ancestors: readonly RuntimeExactTaskMutationSnapshotV1[],
	primaryFilePath: string,
):
	| { ok: true; value: RuntimeSemanticTransitionAncestorGroupV1[] }
	| { ok: false; code: StructuredErrorCodeV1; reason: string } {
	const grouped = new Map<string, RuntimeExactTaskMutationSnapshotV1[]>();
	for (const ancestor of ancestors) {
		if (ancestor.locator.filePath === primaryFilePath) continue;
		const existing = grouped.get(ancestor.locator.filePath);
		if (existing) existing.push(ancestor);
		else grouped.set(ancestor.locator.filePath, [ancestor]);
	}
	const groups: RuntimeSemanticTransitionAncestorGroupV1[] = [];
	for (const [filePath, tasks] of grouped) {
		const sourceContents = new Set(tasks.map(task => task.sourceContent));
		if (sourceContents.size !== 1) {
			return failure(
				'stale-source',
				`Ancestor snapshots disagree for shared source: ${filePath}.`,
			);
		}
		groups.push({
			groupId: `ancestor-source:${filePath}`,
			filePath,
			sourceRevision: sha256HexV1(tasks[0].sourceContent),
			ancestors: tasks,
		});
	}
	return { ok: true, value: groups };
}

function validateRecurrencePreview(
	preview: RuntimeSemanticTransitionRecurrencePreviewV1,
	prepared: RuntimeTaskFieldMutationPreparationV1,
	ports: RuntimeSemanticTransitionPlannerPortsV1,
): { ok: true } | { ok: false; code: StructuredErrorCodeV1; reason: string } {
	if (preview.disposition === 'ended') return { ok: true };
	if (
		!isOperonId(preview.nextOperonId)
		|| preview.nextOperonId === prepared.task.operonId
		|| ports.getTask(preview.nextOperonId) !== null
	) {
		return failure(
			'duplicate-operon-id',
			`Recurrence preview did not seal one unused operonId: ${preview.nextOperonId}.`,
		);
	}
	if (preview.plannedSourceRevision !== sha256HexV1(preview.plannedSourceContent)) {
		return failure(
			'stale-source',
			'Recurrence preview content does not match its sealed source revision.',
		);
	}
	if (preview.archiveSource) {
		if (
			preview.archiveSource.locator.representation !== 'file'
			|| preview.archiveSource.locator.filePath === prepared.task.locator.filePath
			|| preview.archiveSource.plannedSourceRevision
				!== sha256HexV1(preview.archiveSource.plannedSourceContent)
		) {
			return failure(
				'invalid-request',
				'Plain-name recurrence archive source is not exact or digest-bound.',
			);
		}
		if (
			preview.sourceTaskFinalLocator?.representation !== 'file'
			|| preview.sourceTaskFinalLocator.filePath
				!== preview.archiveSource.locator.filePath
		) {
			return failure(
				'invalid-request',
				'Plain-name recurrence must bind the terminal task to its archive locator.',
			);
		}
	}
	const samePrimarySource = (
		preview.nextLocator.filePath === prepared.task.locator.filePath
	);
	if (preview.coalescedWithPrimarySource !== samePrimarySource) {
		return failure(
			'invalid-request',
			'Recurrence preview coalescing does not match its exact next source locator.',
		);
	}
	if (samePrimarySource) {
		if (
			!('expectedSourceRevision' in preview.sourcePrecondition)
			|| preview.sourcePrecondition.expectedSourceRevision !== prepared.sourceRevision
			|| preview.applyExpectedSourceContent === null
		) {
			return failure(
				'stale-source',
				'Co-located recurrence preview is not bound to the primary source revision.',
			);
		}
	} else if (
		!('expectedAbsence' in preview.sourcePrecondition)
		|| preview.applyExpectedSourceContent !== null
	) {
		return failure(
			'invalid-request',
			'A distinct recurrence source must seal exact absence before apply.',
		);
	}
	return { ok: true };
}

function committedGroup(
	group: AtomicResourceGroupV1,
	revisions?: readonly ResourceRevisionV1[],
): AtomicGroupResultV1 {
	if (!revisions) {
		return {
			groupId: group.groupId,
			status: 'committed',
		};
	}
	return {
		groupId: group.groupId,
		status: 'committed',
		resourceRevisions: group.resources.map(resource => (
			revisions.find(revision => (
				revision.resourceKind === resource.resourceKind
				&& revision.resourceKey === resource.resourceKey
			)) ?? { ...resource, revision: 'unavailable' }
		)),
	};
}

function failedGroup(
	group: AtomicResourceGroupV1,
	status: 'failed' | 'outcome-unknown',
	reason: string,
): AtomicGroupResultV1 {
	return {
		groupId: group.groupId,
		status,
		error: runtimeStepError(reason),
	};
}

function runtimeStepError(reason: string): StructuredErrorV1 {
	return structuredErrorV1('capability-unavailable', reason);
}

function findGroup(
	plan: RuntimeSemanticTransitionPlanV1,
	groupId: string,
): AtomicResourceGroupV1 {
	const group = plan.atomicGroups.find(candidate => candidate.groupId === groupId);
	if (!group) throw new Error(`Semantic transition plan is missing group ${groupId}.`);
	return group;
}

function dedupeResourceRevisions(
	resources: readonly ResourceRevisionV1[],
): AffectedResourceRevisionMapV1 {
	const seen = new Set<string>();
	const result: ResourceRevisionV1[] = [];
	for (const resource of resources) {
		const key = `${resource.resourceKind}\0${resource.resourceKey}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(resource);
	}
	return result;
}

function compareResourceReferences(
	left: Pick<ResourceRevisionV1, 'resourceKind' | 'resourceKey'>,
	right: Pick<ResourceRevisionV1, 'resourceKind' | 'resourceKey'>,
): number {
	const kindOrder = RESOURCE_QUEUE_ORDER_V1[left.resourceKind]
		- RESOURCE_QUEUE_ORDER_V1[right.resourceKind];
	if (kindOrder !== 0) return kindOrder;
	return left.resourceKey.localeCompare(right.resourceKey);
}

function isValidIsoInstant(value: string): boolean {
	return Number.isFinite(Date.parse(value)) && value.includes('T');
}

function isOperonId(value: string): boolean {
	return /^[a-z0-9]{7}$/u.test(value);
}

function clean(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): { ok: false; code: StructuredErrorCodeV1; reason: string } {
	return { ok: false, code, reason };
}
