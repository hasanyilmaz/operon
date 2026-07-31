import {
	canonicalJsonV1,
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	sha256HexV1,
	toJsonValueV1,
} from '../contracts/v1/canonical';
import type {
	AffectedResourceRevisionMapV1,
	ContextRevisionV1,
} from '../contracts/v1/identity';
import { RESOURCE_QUEUE_ORDER_V1 } from '../contracts/v1/identity';
import type {
	AtomicResourceGroupV1,
	AtomicGroupResultV1,
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationReceiptV1,
	MutationResultV1,
	MutationSpecV1,
	PredictedEffectV1,
	RiskLevelV1,
	SealedMutationPlanV1,
} from '../contracts/v1/mutation';
import {
	authorizationPermitsRiskV1,
	requiredRiskForSpecV1,
} from '../contracts/v1/mutation';
import {
	structuredErrorV1,
	type StructuredErrorCodeV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import type { TaskCreationCommitSummary } from '../../core/task-creation-domain';
import type { RuntimeTaskCreationPreparationV1 } from './task-creation-adapter';
import type {
	GraphTransactionJournalPhaseV1,
	GraphTransactionJournalStepV1,
	GraphTransactionJournalV1,
	IndexedDbMutationReceiptStoreV1,
	IndexedDbSecurityAuditStoreV1,
	MutationReceiptApplyAdmissionTokenV1,
	MutationReceiptScopeV1,
	SecurityAuditEventV1,
} from './receipts';
import {
	GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1,
	graphJournalMatchesPlanV1,
} from './receipts';
import {
	isRuntimeMutationPlanExpiredV1,
	validateRuntimeMutationApplyRequestV1,
	validateRuntimeMutationPreviewRequestV1,
} from './mutation-request-validator';
import {
	defaultRuntimeTimingNowV1,
	emitRuntimeTimingSpanV1,
	measureRuntimeTimingSpanV1,
	runtimeTimingNowV1,
	type RuntimeTimingSinkV1,
	type RuntimeTimingSpanNameV1,
} from './timing-probe';
import type { RuntimeInvocationContextV1 } from './types';
import { clearWindowTimeout, setWindowTimeout } from '../../core/dom-compat';

declare const OPERON_AGENT_RUNTIME_PROBE_ENABLED: boolean;

const ROUTINE_PLAN_TTL_MS = 5 * 60 * 1_000;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const RECEIPT_SCOPE_TAILS_V1 = new Map<string, Promise<void>>();
const VAULT_MUTATION_TAILS_V1 = new Map<string, Promise<void>>();

function buildTerminalMutationReceiptV1(
	request: MutationApplyRequestV1,
	vaultIdentityHash: string,
	effectiveAt: string,
	completedAt: string,
	terminalOutcome: MutationReceiptV1['terminalOutcome'],
): MutationReceiptV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash,
		clientInstanceId: request.plan.clientInstanceId,
		idempotencyKeyHash: request.plan.idempotencyKeyHash,
		planHash: request.plan.planHash,
		mutationKind: request.plan.mutationKind,
		targetDigest: request.plan.receiptTargetDigest,
		terminalOutcome,
		effectiveAt,
		completedAt,
		expiresAt: new Date(Date.parse(completedAt) + RECEIPT_TTL_MS).toISOString(),
	};
}

export interface RuntimePreparedMutationV1 {
	readonly target: {
		operonId?: string;
		locator?: SealedMutationPlanV1['targets'][number]['locator'];
		targetDigest: string;
	};
	/** Exact ordered targets for a sealed multi-target mutation. */
	readonly targets?: SealedMutationPlanV1['targets'];
	readonly affectedResources: AffectedResourceRevisionMapV1;
	/** Actual durable execution order. Resource lock acquisition remains canonical. */
	readonly atomicGroups?: AtomicResourceGroupV1[];
	readonly predictedEffects: PredictedEffectV1[];
	readonly warnings: SealedMutationPlanV1['warnings'];
	readonly riskLevel?: RiskLevelV1;
	readonly requiredAcknowledgements?: string[];
	readonly conversionEffect?: SealedMutationPlanV1['conversionEffect'];
	readonly updateBatchEffects?: SealedMutationPlanV1['updateBatchEffects'];
	/** Full apply-safe spec sealed by Runtime when preview accepted a reduced public intent. */
	readonly sealedSpec?: MutationSpecV1;
	/** Internal immutable preparation material. It is never serialized into the plan. */
	readonly token: unknown;
}

export interface RuntimePreparedMutationCommitV1 {
	readonly status: 'committed' | 'failed' | 'partial' | 'outcome-unknown';
	readonly groupResults: AtomicGroupResultV1[];
	readonly affectedFilePaths: string[];
	readonly reason?: string;
}

export interface RuntimeGraphTransactionCheckpointV1 {
	phase: GraphTransactionJournalPhaseV1;
	completedStepCount: number;
}

export interface RuntimeGraphTransactionRecoveryV1 {
	status: 'forward-completed' | 'compensated' | 'outcome-unknown';
	groupResults: AtomicGroupResultV1[];
	affectedFilePaths: string[];
	verified: boolean;
	reason?: string;
}

export type RuntimeCreationTransactionCheckpointV1 = RuntimeGraphTransactionCheckpointV1;
export type RuntimeCreationTransactionRecoveryV1 = RuntimeGraphTransactionRecoveryV1;

export async function checkpointGraphForwardCompletionV1(
	journalPhase: GraphTransactionJournalPhaseV1,
	completedStepCount: number,
	checkpoint: (value: RuntimeGraphTransactionCheckpointV1) => Promise<void>,
): Promise<void> {
	if (journalPhase === 'prepared') {
		await checkpoint({ phase: 'committing', completedStepCount });
	}
	await checkpoint({ phase: 'postflight', completedStepCount });
}

export interface RuntimeMutationGatewayPortsV1 {
	/** Optional development-only timing sink. Production embeddings omit it. */
	timingSink?: RuntimeTimingSinkV1;
	/** Optional monotonic clock used only when the timing sink is enabled. */
	timingNow?: () => number;
	isReady(): boolean;
	sampleContextRevision(): Promise<ContextRevisionV1> | ContextRevisionV1;
	prepareCreation(
		requestId: string,
		spec: Extract<MutationPreviewRequestV1['spec'], { operation: 'create' }>,
		sealedIds?: ReadonlyMap<string, string>,
		effectiveAt?: string,
		activeItemRefs?: ReadonlySet<string>,
		sealedSeriesIds?: ReadonlyMap<string, string>,
	): Promise<RuntimeTaskCreationPreparationV1>;
	commitCreation(
		prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
		modifiedAt: string,
	): Promise<TaskCreationCommitSummary>;
	prepareCreationTransaction?(
		prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
		modifiedAt: string,
	): Promise<
		| { ok: true; steps: GraphTransactionJournalStepV1[] }
		| { ok: false; code: StructuredErrorCodeV1; reason: string }
	>;
	commitCreationTransaction?(
		prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
		modifiedAt: string,
		journal: GraphTransactionJournalV1,
		checkpoint: (value: RuntimeGraphTransactionCheckpointV1) => Promise<void>,
	): Promise<TaskCreationCommitSummary>;
	recoverCreationTransaction?(
		request: MutationApplyRequestV1,
		journal: GraphTransactionJournalV1,
		checkpoint: (value: RuntimeGraphTransactionCheckpointV1) => Promise<void>,
	): Promise<RuntimeGraphTransactionRecoveryV1>;
	verifyCreationTransactionState?(
		journal: GraphTransactionJournalV1,
		expected: 'before' | 'after',
	): Promise<boolean>;
	prepareMutationTransaction?(
		request: MutationApplyRequestV1,
		prepared: RuntimePreparedMutationV1,
		effectiveAt: string,
	): Promise<
		| { ok: true; steps: GraphTransactionJournalStepV1[] }
		| { ok: false; code: StructuredErrorCodeV1; reason: string }
	>;
	commitMutationTransaction?(
		request: MutationApplyRequestV1,
		prepared: RuntimePreparedMutationV1,
		effectiveAt: string,
		journal: GraphTransactionJournalV1,
		checkpoint: (value: RuntimeGraphTransactionCheckpointV1) => Promise<void>,
	): Promise<RuntimePreparedMutationCommitV1>;
	recoverMutationTransaction?(
		request: MutationApplyRequestV1,
		journal: GraphTransactionJournalV1,
		checkpoint: (value: RuntimeGraphTransactionCheckpointV1) => Promise<void>,
	): Promise<RuntimeGraphTransactionRecoveryV1>;
	verifyMutationTransactionState?(
		journal: GraphTransactionJournalV1,
		expected: 'before' | 'after',
	): Promise<boolean>;
	verifyRecoveredMutationTransaction?(
		request: MutationApplyRequestV1,
		journal: GraphTransactionJournalV1,
		postflightRevision: ContextRevisionV1,
	): Promise<boolean>;
	reindexAffectedSources(filePaths: readonly string[]): Promise<void>;
	settleAfterMutation(requestId: string): Promise<void>;
	reconcileCreatedHierarchy(
		prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
		modifiedAt: string,
	): Promise<{ ok: boolean; resourceRevisions: AffectedResourceRevisionMapV1 }>;
	verifyCreatedTasks(
		prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
		contextRevision: ContextRevisionV1,
		modifiedAt: string,
		groupResults: readonly AtomicGroupResultV1[],
	): Promise<boolean>;
	prepareMutation?(
		request: MutationPreviewRequestV1,
		effectiveAt: string,
	): Promise<
		| { ok: true; value: RuntimePreparedMutationV1 }
		| { ok: false; code: StructuredErrorCodeV1; reason: string; retryable?: boolean }
	>;
	commitMutation?(
		request: MutationApplyRequestV1,
		prepared: RuntimePreparedMutationV1,
		effectiveAt: string,
	): Promise<RuntimePreparedMutationCommitV1>;
	verifyMutation?(
		request: MutationApplyRequestV1,
		prepared: RuntimePreparedMutationV1,
		postflightRevision: ContextRevisionV1,
		commit: RuntimePreparedMutationCommitV1,
	): Promise<boolean>;
	/**
	 * Read-only same-plan recovery for mutations whose exact sealed after-state
	 * can be proven without executing another write.
	 */
	recoverMutation?(request: MutationApplyRequestV1): Promise<boolean>;
	receiptStore(): IndexedDbMutationReceiptStoreV1 | null;
	securityAuditStore?(): IndexedDbSecurityAuditStoreV1 | null;
	createSecurityAuditEvent?(
		event:
			| 'apply-dispatched'
			| 'apply-completed'
			| 'recovery-dispatched'
			| 'recovery-completed',
		request: MutationApplyRequestV1,
		receipt?: MutationReceiptV1,
	): SecurityAuditEventV1 | null;
	vaultIdentityHash(): Promise<string>;
	nowEpochMs(): number;
	randomId(): string;
}

export class RuntimeMutationGatewayV1 {
	constructor(private readonly ports: RuntimeMutationGatewayPortsV1) {}

	async preview(
		value: unknown,
		context?: RuntimeInvocationContextV1,
	): Promise<MutationPreviewResultV1> {
		if (
			context?.deadlineAtMs !== undefined
			&& context.deadlineAtMs <= Date.now()
		) {
			return previewFailure(
				readRequestId(value),
				'live-settling',
				'The mutation preview deadline elapsed before preparation started.',
				true,
			);
		}
		const operation = this.previewWithinBoundary(value, context?.deadlineAtMs);
		if (context?.deadlineAtMs === undefined) return await operation;
		const remainingMs = Math.max(0, context.deadlineAtMs - Date.now());
		let timer: ReturnType<typeof setWindowTimeout> | undefined;
		const deadline = new Promise<MutationPreviewResultV1>(resolve => {
			timer = setWindowTimeout(() => {
				resolve(previewFailure(
					readRequestId(value),
					'live-settling',
					'The mutation preview deadline elapsed before a verified plan was available.',
					true,
				));
			}, remainingMs);
		});
		const result = await Promise.race([operation, deadline]);
		if (timer !== undefined) clearWindowTimeout(timer);
		return result;
	}

	private async previewWithinBoundary(
		value: unknown,
		deadlineAtMs?: number,
	): Promise<MutationPreviewResultV1> {
		const decoded = validateRuntimeMutationPreviewRequestV1(value);
		const requestId = readRequestId(value);
		if (!decoded.ok) {
			return previewFailure(requestId, 'invalid-request', 'The mutation preview request does not match V1.');
		}
		const request = decoded.value;
		const risk = requiredRiskForSpecV1(request.spec);
		const previewAuthorityPermitted = risk === 'destructive'
			? (
				request.authorization.basis === 'user-explicit-request'
				|| request.authorization.basis === 'user-explicit-confirmation'
			)
			: authorizationPermitsRiskV1(request.authorization, risk);
		if (!previewAuthorityPermitted) {
			return previewFailure(
				request.requestId,
				'authority-insufficient',
				'The supplied authority does not permit this mutation risk.',
			);
		}
		if (
			request.mutationKind === 'task.create'
			&& request.authorization.basis !== 'user-explicit-request'
		) {
			return previewFailure(
				request.requestId,
				'authority-insufficient',
				'Task creation preview requires an explicit user request.',
			);
		}
		if (!this.ports.isReady()) {
			return previewFailure(request.requestId, 'live-settling', 'Runtime is not ready for a live-verified preview.', true);
		}

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const revisionBefore = await this.ports.sampleContextRevision();
			const revisionDeadlineFailure = previewDeadlineFailure(request.requestId, deadlineAtMs);
			if (revisionDeadlineFailure) return revisionDeadlineFailure;
			const createdAt = new Date(this.ports.nowEpochMs()).toISOString();
			if (request.spec.operation !== 'create') {
				if (!this.ports.prepareMutation) {
					return previewFailure(
						request.requestId,
						'capability-unavailable',
						'The requested mutation family has not passed its Runtime adapter gate.',
					);
				}
				const prepared = await this.measureMutation(
					request.requestId,
					'mutation-preview',
					'prepare',
					attempt + 1,
					() => this.ports.prepareMutation!(request, createdAt),
				);
				const preparationDeadlineFailure = previewDeadlineFailure(request.requestId, deadlineAtMs);
				if (preparationDeadlineFailure) return preparationDeadlineFailure;
				if (!prepared.ok) {
					return previewFailure(
						request.requestId,
						prepared.code,
						prepared.reason,
						prepared.retryable ?? false,
					);
				}
				const revisionAfter = await this.ports.sampleContextRevision();
				const finalDeadlineFailure = previewDeadlineFailure(request.requestId, deadlineAtMs);
				if (finalDeadlineFailure) return finalDeadlineFailure;
				if (!contextRevisionsEqual(revisionBefore, revisionAfter)) {
					if (attempt === 0 && this.ports.isReady()) continue;
					return previewFailure(
						request.requestId,
						'live-settling',
						'Runtime context changed while the mutation plan was prepared.',
						true,
					);
				}
				const sealedSpec = prepared.value.sealedSpec
					?? (isSealedMutationSpecV1(request.spec) ? request.spec : null);
				if (!sealedSpec) {
					return previewFailure(
						request.requestId,
						'internal-error',
						'Runtime did not seal the reduced mutation intent into an apply-safe specification.',
					);
				}
				return {
					contractVersion: 1,
					requestId: request.requestId,
					kind: 'mutation-preview-result',
					ok: true,
					warnings: prepared.value.warnings,
					plan: buildPreparedMutationPlan(
						request,
						prepared.value,
						sealedSpec,
						revisionAfter,
						createdAt,
						this.ports.randomId(),
					),
				};
			}
			const createSpec = request.spec;
			const prepared = await this.measureMutation(
				request.requestId,
				'mutation-preview',
				'prepare',
				attempt + 1,
				() => this.ports.prepareCreation(
					request.requestId,
					createSpec,
					undefined,
					createdAt,
				),
			);
			const preparationDeadlineFailure = previewDeadlineFailure(request.requestId, deadlineAtMs);
			if (preparationDeadlineFailure) return preparationDeadlineFailure;
			if (!prepared.ok) {
				return previewFailure(
					request.requestId,
					prepared.code,
					prepared.reason,
					false,
					prepared.details,
				);
			}
			const revisionAfter = await this.ports.sampleContextRevision();
			const finalDeadlineFailure = previewDeadlineFailure(request.requestId, deadlineAtMs);
			if (finalDeadlineFailure) return finalDeadlineFailure;
			if (!contextRevisionsEqual(revisionBefore, revisionAfter)) {
				if (attempt === 0 && this.ports.isReady()) continue;
				return previewFailure(
					request.requestId,
					'live-settling',
					'Runtime context changed while the task creation plan was prepared.',
					true,
				);
			}
			const plan = buildSealedPlan(
				{ ...request, spec: request.spec },
				prepared,
				revisionAfter,
				createdAt,
				this.ports.randomId(),
			);
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: plan.warnings,
				plan,
			};
		}
		return previewFailure(request.requestId, 'live-settling', 'Runtime context could not settle.', true);
	}

	async apply(value: unknown): Promise<MutationResultV1> {
		const requestId = readRequestId(value);
		const nowEpochMs = this.ports.nowEpochMs();
		const admitted = validateRuntimeMutationApplyRequestV1(
			value,
			nowEpochMs,
			{ allowExpired: true },
		);
		if (!admitted.ok) {
			return mutationFailure(requestId, 'invalid-request', 'The mutation apply request failed V1 admission.');
		}
		const request = admitted.value;
		const risk = requiredRiskForSpecV1(request.plan.spec);
		if (!authorizationPermitsRiskV1(request.authorization, risk)) {
			return mutationFailure(
				request.requestId,
				'authority-insufficient',
				'The supplied authority does not permit this mutation risk.',
			);
		}
		if (
			request.plan.mutationKind === 'task.create'
			&& request.authorization.basis !== (
				request.plan.requiresConfirmation
					? 'user-explicit-confirmation'
					: 'user-explicit-request'
			)
		) {
			return mutationFailure(
				request.requestId,
				'authority-insufficient',
				request.plan.requiresConfirmation
					? 'Confirmed task creation apply requires explicit user confirmation.'
					: 'Task creation apply requires the same explicit user-request authority.',
			);
		}
		if (!this.ports.isReady()) {
			return mutationFailure(
				request.requestId,
				'live-settling',
				'Runtime apply admission is closed until Operon is ready.',
				true,
			);
		}

		const receiptStore = this.ports.receiptStore();
		if (!receiptStore) {
			return mutationFailure(
				request.requestId,
				'receipt-store-unavailable',
				'The durable mutation receipt store is unavailable.',
				true,
			);
		}
		if (this.ports.securityAuditStore) {
			const auditStore = this.ports.securityAuditStore();
			if (!auditStore || !await auditStore.health()) {
				return mutationFailure(
					request.requestId,
					'audit-unavailable',
					'The security audit store is unavailable, so mutation admission is closed.',
				);
			}
		}
		const vaultIdentityHash = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'vault-identity',
			undefined,
			() => this.ports.vaultIdentityHash(),
		);
		const receiptScope: MutationReceiptScopeV1 = {
			vaultIdentityHash,
			clientInstanceId: request.plan.clientInstanceId,
			idempotencyKeyHash: request.plan.idempotencyKeyHash,
			mutationKind: request.plan.mutationKind,
		};
		const timingEnabled = OPERON_AGENT_RUNTIME_PROBE_ENABLED && Boolean(this.ports.timingSink);
		const timingNow = timingEnabled
			? (this.ports.timingNow ?? defaultRuntimeTimingNowV1)
			: defaultRuntimeTimingNowV1;
		const lockWaitStartedAt = timingEnabled ? runtimeTimingNowV1(timingNow) : 0;
		return await withRuntimeVaultMutationLockV1(vaultIdentityHash, async () => (
			await this.withReceiptScopeLock(receiptScope, async () => {
		if (timingEnabled) {
			emitRuntimeTimingSpanV1(this.ports.timingSink, {
				requestId: request.requestId,
				flow: 'mutation-apply',
				span: 'lock-wait',
				durationMs: runtimeTimingNowV1(timingNow) - lockWaitStartedAt,
			});
		}
		let admission;
		try {
			admission = await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'receipt-health',
				undefined,
				async () => {
					if (typeof receiptStore.lookupForApplyAdmission === 'function') {
						if (OPERON_AGENT_RUNTIME_PROBE_ENABLED && this.ports.timingSink) {
							return await receiptStore.lookupForApplyAdmission(
								receiptScope,
								{
									requestId: request.requestId,
									timingSink: this.ports.timingSink,
									timingNow,
								},
							);
						}
						return await receiptStore.lookupForApplyAdmission(receiptScope);
					}
					// Preserve compatibility with narrow internal test doubles. The
					// production store always uses the single-transaction admission.
					const health = await receiptStore.health(true);
					return {
						health,
						receipt: health.healthy ? await receiptStore.lookup(receiptScope) : null,
						journal: health.healthy && typeof receiptStore.lookupJournal === 'function'
							? await receiptStore.lookupJournal(receiptScope)
							: null,
						admissionToken: null,
					};
				},
			);
		} catch {
			return mutationFailure(
				request.requestId,
				'receipt-store-unavailable',
				'The durable mutation receipt could not be read before apply.',
				true,
			);
		}
			if (!admission.health.healthy) {
			return mutationFailure(
				request.requestId,
				'receipt-store-unavailable',
				'The durable mutation receipt store is unavailable.',
				true,
				);
			}
			const admissionToken = admission.admissionToken ?? null;
			const existingReceipt = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'receipt-lookup',
			undefined,
			() => Promise.resolve(admission.receipt),
		);
		const existingJournal = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'journal-lookup',
			undefined,
			() => Promise.resolve(admission.journal),
		);
		const journalLeaseOwner = this.ports.randomId();
		if (existingReceipt) {
			if (
				existingReceipt.planHash !== request.plan.planHash
				|| existingReceipt.targetDigest !== request.plan.receiptTargetDigest
			) {
				return mutationFailure(
					request.requestId,
					'stale-plan',
					'The idempotency key is already bound to a different mutation plan.',
				);
			}
				if (
					existingReceipt.terminalOutcome !== 'applied'
					&& existingReceipt.terminalOutcome !== 'already-applied'
				) {
					if (
						request.plan.mutationKind === 'task.pinned-state'
						&& this.ports.recoverMutation
					) {
						const recoveryAuditError = await this.appendDispatchAudit(
							request,
							'recovery-dispatched',
						);
						if (recoveryAuditError) return recoveryAuditError;
						let recovered = false;
						try {
							recovered = await this.ports.recoverMutation(request);
						} catch {
							recovered = false;
						}
						if (recovered) {
							const completedAt = new Date(this.ports.nowEpochMs()).toISOString();
							const recoveredReceipt: MutationReceiptV1 = {
								...existingReceipt,
								terminalOutcome: 'already-applied',
								completedAt,
								expiresAt: new Date(Date.parse(completedAt) + RECEIPT_TTL_MS).toISOString(),
							};
							try {
								await this.persistReceiptWithAdmission(
									receiptStore,
									request,
									recoveredReceipt,
									admissionToken,
									'recovery-completed',
								);
								return {
									contractVersion: 1,
									requestId: request.requestId,
									kind: 'mutation-result',
									status: 'already-applied',
									mutationMayHaveApplied: true,
									retryAllowed: false,
									groupResults: [],
									receipt: recoveredReceipt,
									postflight: { status: 'receipt-replay' },
								};
							} catch {
								// Preserve the original uncertain fence when receipt
								// finalization cannot be durably recorded.
							}
						}
						try {
							await this.appendTerminalAudit(
								request,
								'recovery-completed',
								existingReceipt,
							);
						} catch {
							// Recovery remains fenced by the existing uncertain receipt.
						}
					}
					const firstGroup = request.plan.atomicGroups[0];
				return {
					contractVersion: 1,
					requestId: request.requestId,
					kind: 'mutation-result',
					status: 'outcome-unknown',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: firstGroup
						? [{
							groupId: firstGroup.groupId,
							status: 'outcome-unknown',
							error: structuredError(
								'outcome-unknown',
								'The durable receipt records an uncertain terminal mutation outcome.',
								false,
							),
						}]
						: [],
					ambiguitySource: 'group-outcome',
					receipt: existingReceipt,
					error: structuredError(
						'outcome-unknown',
						'The idempotency scope has an uncertain terminal receipt and cannot be replayed safely.',
						false,
					),
				};
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'already-applied',
				mutationMayHaveApplied: true,
				retryAllowed: false,
				groupResults: [],
				receipt: {
					...existingReceipt,
					terminalOutcome: 'already-applied',
				},
				postflight: { status: 'receipt-replay' },
			};
		}
		if (existingJournal) {
			if (!graphJournalMatchesPlanV1(existingJournal, request.plan, vaultIdentityHash)) {
				return mutationFailure(
					request.requestId,
					'stale-plan',
					'Another graph plan fenced this idempotency key.',
				);
			}
			try {
				if (!await receiptStore.claimJournal(
					receiptScope,
					existingJournal,
					journalLeaseOwner,
				)) {
					return mutationOutcomeUnknown(
						request,
						'Another Runtime owns this graph transaction.',
					);
				}
			} catch {
				return mutationOutcomeUnknown(
					request,
					'Cannot acquire the durable graph recovery lease.',
				);
			}
				const recoveryAuditError = await this.appendDispatchAudit(
					request,
					'recovery-dispatched',
				);
				if (recoveryAuditError) return recoveryAuditError;
				return request.plan.spec.operation === 'create'
					? await this.recoverCreationGraphTransaction(
						request,
						receiptStore,
						receiptScope,
						existingJournal,
						vaultIdentityHash,
						journalLeaseOwner,
						admissionToken,
					)
					: await this.recoverPreparedGraphTransaction(
						request,
						receiptStore,
						receiptScope,
						existingJournal,
						vaultIdentityHash,
						journalLeaseOwner,
						admissionToken,
					);
		}
		if (isRuntimeMutationPlanExpiredV1(request, nowEpochMs)) {
			return mutationFailure(request.requestId, 'plan-expired', 'The sealed mutation plan has expired.');
		}

		const currentRevision = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'context-revision',
			1,
			() => this.ports.sampleContextRevision(),
		);
		if (!mutationContextRevisionsEqual(currentRevision, request.plan.contextRevision)) {
			return mutationFailure(
				request.requestId,
				'stale-context',
				'Runtime context changed after preview. Create a fresh mutation plan.',
			);
		}
		if (request.plan.spec.operation !== 'create') {
				return await this.applyPreparedMutation(
					request,
					receiptStore,
					receiptScope,
					vaultIdentityHash,
					admissionToken,
				);
		}
			const sealedIds = new Map(
				(request.plan.createEffects ?? []).map(effect => [effect.itemRef, effect.operonId]),
			);
			const sealedSeriesIds = new Map(
				(request.plan.createEffects ?? []).flatMap(effect => (
					effect.repeatSeriesId ? [[effect.itemRef, effect.repeatSeriesId] as const] : []
				)),
			);
			const createSpec = request.plan.spec;
			const previewPrepared = await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'prepare',
				1,
				() => this.ports.prepareCreation(
					request.requestId,
					createSpec,
					sealedIds,
					request.plan.createdAt,
					new Set(
						(request.plan.createEffects ?? [])
							.filter(effect => request.plan.affectedResources.some(
								resource => resource.resourceKey === effect.locator.filePath,
							))
							.map(effect => effect.itemRef),
					),
					sealedSeriesIds,
				),
			);
		if (!previewPrepared.ok) {
			return mutationFailure(request.requestId, 'stale-source', previewPrepared.reason);
		}
		if (!preparationMatchesPlan(previewPrepared, request.plan)) {
			return mutationFailure(
				request.requestId,
				'stale-source',
				'Task sources, mappings, or templates changed after preview.',
			);
		}
		const effectiveAt = new Date(this.ports.nowEpochMs()).toISOString();
		const prepared = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'prepare',
			2,
			() => this.ports.prepareCreation(
				request.requestId,
				createSpec,
				sealedIds,
				effectiveAt,
				new Set((request.plan.createEffects ?? []).map(effect => effect.itemRef)),
				sealedSeriesIds,
			),
		);
		if (!prepared.ok || !preparationStaticShapeMatches(previewPrepared, prepared)) {
			return mutationFailure(
				request.requestId,
				'stale-source',
				prepared.ok
					? 'Task creation targets changed while apply-time values were captured.'
					: prepared.reason,
			);
		}
		const applyPreparedRevision = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'context-revision',
			2,
			() => this.ports.sampleContextRevision(),
		);
		if (!mutationContextRevisionsEqual(applyPreparedRevision, request.plan.contextRevision)) {
			return mutationFailure(
				request.requestId,
				'stale-context',
				'Runtime context changed while apply-time task values were prepared.',
			);
		}

		let graphJournal: GraphTransactionJournalV1 | null = null;
		const creationTransactionReady = (
			this.ports.prepareCreationTransaction !== undefined
			&& this.ports.commitCreationTransaction !== undefined
			&& this.ports.recoverCreationTransaction !== undefined
			&& this.ports.verifyCreationTransactionState !== undefined
		);
		if (
			prepared.sourceGroupGraph.crossSourcePartialRisk
			|| creationTransactionReady
		) {
			if (!creationTransactionReady) {
				return mutationFailure(
					request.requestId,
					'capability-unavailable',
					'Graph transaction recovery is unavailable.',
				);
			}
			const transactionPreparation = await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'creation-transaction-prepare',
				undefined,
				() => this.ports.prepareCreationTransaction!(
					prepared,
					effectiveAt,
				),
			);
			if (!transactionPreparation.ok) {
				return mutationFailure(
					request.requestId,
					transactionPreparation.code,
					transactionPreparation.reason,
				);
			}
			const acquiredGraphJournal = buildGraphTransactionJournalV1(
				request,
				vaultIdentityHash,
				effectiveAt,
				transactionPreparation.steps,
			);
			graphJournal = acquiredGraphJournal;
			if (graphJournalByteLengthV1(graphJournal) > GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1) {
				return mutationFailure(
					request.requestId,
					'payload-too-large',
					`The graph transaction recovery journal exceeds ${GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1} bytes.`,
				);
			}
			try {
				if (!await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'journal-acquire',
					undefined,
					() => receiptStore.acquireJournal(acquiredGraphJournal, journalLeaseOwner),
				)) {
					return mutationOutcomeUnknown(
						request,
						'Another Runtime holds this graph journal.',
					);
				}
				const persistedJournal = await receiptStore.lookupJournal(receiptScope);
				if (
					!persistedJournal
					|| JSON.stringify(persistedJournal) !== JSON.stringify(graphJournal)
				) {
					return mutationFailure(
						request.requestId,
						'receipt-store-unavailable',
						'Graph journal verification failed before write.',
						true,
					);
				}
			} catch {
				return mutationFailure(
					request.requestId,
					'receipt-store-unavailable',
					'Graph journal persistence failed before write.',
					true,
				);
			}
		}

		const dispatchAuditError = await this.appendDispatchAudit(
			request,
			'apply-dispatched',
		);
		if (dispatchAuditError) {
			if (graphJournal) {
				try {
					await receiptStore.deleteJournal(
						receiptScope,
						graphJournal,
						journalLeaseOwner,
					);
				} catch {
					return mutationOutcomeUnknown(
						request,
						'Security audit failed and the pre-write graph fence could not be removed.',
					);
				}
			}
			return dispatchAuditError;
		}
		try {
			const checkpoint = async (
				value: RuntimeGraphTransactionCheckpointV1,
			): Promise<void> => {
				if (!graphJournal) {
					throw new Error('Graph checkpoint has no durable journal.');
				}
				graphJournal = advanceGraphTransactionJournalV1(graphJournal, value);
				await receiptStore.persistJournal(graphJournal, journalLeaseOwner);
			};
			const commit = await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'commit',
				undefined,
				() => graphJournal && this.ports.commitCreationTransaction
					? this.ports.commitCreationTransaction(
						prepared,
						effectiveAt,
						graphJournal,
						checkpoint,
					)
					: this.ports.commitCreation(prepared, effectiveAt),
			);
			let groupResults = toGroupResults(commit);
			if (commit.status !== 'committed') {
				if (commit.status === 'failed') {
					if (graphJournal) {
						try {
							await this.ports.reindexAffectedSources(
								commit.groups.map(group => group.filePath),
							);
							await this.ports.settleAfterMutation(request.requestId);
							if (!await receiptStore.deleteJournal(
								receiptScope,
								graphJournal,
								journalLeaseOwner,
							)) {
								throw new Error('Graph fence changed before cleanup.');
							}
						} catch {
							return await this.outcomeUnknownAfterAuditFence(
								request,
								'apply-completed',
								'Graph compensation cleanup failed.',
								markLastGroupUnknown(
									groupResults,
									'Graph compensation cleanup failed.',
								),
							);
						}
					}
					try {
						await this.appendTerminalAudit(request, 'apply-completed');
					} catch {
						return mutationFailure(
							request.requestId,
							'audit-unavailable',
							'Mutation failed safely, but its terminal audit record could not be persisted.',
						);
					}
					return {
						contractVersion: 1,
						requestId: request.requestId,
						kind: 'mutation-result',
						status: 'failed',
						mutationMayHaveApplied: false,
						retryAllowed: false,
						groupResults,
						error: structuredError(
							'stale-source',
							'Task creation did not commit its first atomic source group.',
							false,
						),
					};
				}
				if (graphJournal) {
					return await this.outcomeUnknownAfterAuditFence(
						request,
						'apply-completed',
						'Graph transaction stopped.',
						groupResults,
					);
				}
				try {
					await this.ports.reindexAffectedSources(
						commit.groups
							.filter(group => group.result.status === 'committed')
							.map(group => group.filePath),
					);
					await this.ports.settleAfterMutation(request.requestId);
				} catch {
					// Receipt fencing remains mandatory if partial reconciliation fails.
				}
				return await this.persistPreparedMutationUncertainty(
					request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					'Task creation stopped before all atomic source groups committed.',
					groupResults,
				);
			}
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'reindex',
				1,
				() => this.ports.reindexAffectedSources(taskSourcePathsFromPlan(request.plan)),
			);
			const hierarchy = graphJournal
				? { ok: true, resourceRevisions: [] as AffectedResourceRevisionMapV1 }
				: await this.ports.reconcileCreatedHierarchy(prepared, effectiveAt);
			if (!hierarchy.ok) {
				groupResults = markLastGroupUnknown(
					groupResults,
					'Created tasks were written, but hierarchy aggregates could not be reconciled.',
				);
				return await this.persistPreparedMutationUncertainty(
					request,
						receiptStore,
						vaultIdentityHash,
						effectiveAt,
						admissionToken,
						'Task creation committed, but hierarchy reconciliation did not complete.',
					groupResults,
				);
			}
			groupResults = replaceCommittedResourceRevisions(
				groupResults,
				hierarchy.resourceRevisions,
			);
			if (!graphJournal) {
				await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'reindex',
					2,
					() => this.ports.reindexAffectedSources(taskSourcePathsFromPlan(request.plan)),
				);
			}
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'settlement',
				undefined,
				() => this.ports.settleAfterMutation(request.requestId),
			);
			const postflightRevision = await this.ports.sampleContextRevision();
			if (!(await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'semantic-postflight',
				undefined,
				() => this.ports.verifyCreatedTasks(
					prepared,
					postflightRevision,
					effectiveAt,
					groupResults,
				),
			))) {
				groupResults = markLastGroupUnknown(
					groupResults,
					'The source write completed, but the created task was not verified in the live index.',
				);
				if (graphJournal) {
					return await this.outcomeUnknownAfterAuditFence(
						request,
						'apply-completed',
						'Graph source writes completed, but postflight did not verify every created task.',
						groupResults,
					);
				}
				return await this.persistPreparedMutationUncertainty(
				request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					'Source writes completed, but the live index postflight could not verify every created task.',
				groupResults,
				);
			}
			if (
				graphJournal
				&& await this.ports.verifyCreationTransactionState?.(graphJournal, 'after') !== true
			) {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'apply-completed',
					'Graph resources changed during postflight settlement.',
					markLastGroupUnknown(groupResults, 'Graph state changed after postflight.'),
				);
			}

			const postflight = verifiedPostflightV1(
				postflightRevision,
				new Date(this.ports.nowEpochMs()).toISOString(),
			);
		const completedAt = new Date(this.ports.nowEpochMs()).toISOString();
		const receipt = buildTerminalMutationReceiptV1(
			request,
			vaultIdentityHash,
			effectiveAt,
			completedAt,
			'applied',
		);
		try {
			if (graphJournal) {
				const journal = graphJournal;
				await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'receipt-persist',
					undefined,
						() => this.finalizeReceiptWithAdmission(
							receiptStore,
							request,
							receipt,
							journal,
							journalLeaseOwner,
							admissionToken,
						),
				);
			} else {
				await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'receipt-persist',
					undefined,
						() => this.persistReceiptWithAdmission(
							receiptStore,
							request,
							receipt,
							admissionToken,
						),
				);
			}
		} catch {
			try {
				await this.appendTerminalAudit(request, 'apply-completed');
			} catch {
				// Same-plan recovery remains the dominant safety requirement.
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'outcome-unknown',
				mutationMayHaveApplied: true,
				retryAllowed: false,
					groupResults: [],
					ambiguitySource: 'receipt-persist-failure',
					postflight,
				error: structuredError(
					'outcome-unknown',
					'Task creation was verified, but its durable receipt could not be persisted.',
					false,
				),
			};
		}
		return {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-result',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
				groupResults,
				receipt,
				postflight,
			};
		} catch {
			try {
				await this.ports.reindexAffectedSources(taskSourcePathsFromPlan(request.plan));
				await this.ports.settleAfterMutation(request.requestId);
			} catch {
				// Receipt fencing below remains mandatory even when reconciliation fails.
			}
			if (graphJournal) {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'apply-completed',
					'Graph transaction stopped without a verified outcome.',
				);
			}
			return await this.persistPreparedMutationUncertainty(
				request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					'Task creation may have been applied; automatic retry is unsafe.',
			);
		}
			})
		));
	}

	private async recoverCreationGraphTransaction(
		request: MutationApplyRequestV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		receiptScope: MutationReceiptScopeV1,
		initialJournal: GraphTransactionJournalV1,
		vaultIdentityHash: string,
		journalLeaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
	): Promise<MutationResultV1> {
		return await this.recoverGraphTransaction(
			request,
			receiptStore,
			receiptScope,
			initialJournal,
			vaultIdentityHash,
			journalLeaseOwner,
			admissionToken,
			request.plan.spec.operation === 'create'
				&& this.ports.recoverCreationTransaction
				? (applyRequest, journal, checkpoint) => (
					this.ports.recoverCreationTransaction!(applyRequest, journal, checkpoint)
				)
				: undefined,
			this.ports.verifyCreationTransactionState
				? (journal, expected) => this.ports.verifyCreationTransactionState!(journal, expected)
				: undefined,
		);
		}

	private async applyPreparedGraphTransaction(
		request: MutationApplyRequestV1,
		prepared: RuntimePreparedMutationV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		receiptScope: MutationReceiptScopeV1,
		vaultIdentityHash: string,
		effectiveAt: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
	): Promise<MutationResultV1> {
		if (
			!this.ports.prepareMutationTransaction
			|| !this.ports.commitMutationTransaction
			|| !this.ports.recoverMutationTransaction
			|| !this.ports.verifyMutationTransactionState
			|| !this.ports.verifyMutation
		) {
			return mutationFailure(
				request.requestId,
				'capability-unavailable',
				'The prepared mutation transaction is unavailable.',
			);
		}
		let transactionPreparation:
			| { ok: true; steps: GraphTransactionJournalStepV1[] }
			| { ok: false; code: StructuredErrorCodeV1; reason: string };
		try {
			transactionPreparation = await this.ports.prepareMutationTransaction(
				request,
				prepared,
				effectiveAt,
			);
		} catch {
			return mutationFailure(
				request.requestId,
				'internal-error',
				'The mutation transaction could not be sealed before write.',
			);
		}
		if (!transactionPreparation.ok) {
			return mutationFailure(
				request.requestId,
				transactionPreparation.code,
				transactionPreparation.reason,
			);
		}
		const journalLeaseOwner = this.ports.randomId();
		let journal = buildGraphTransactionJournalV1(
			request,
			vaultIdentityHash,
			effectiveAt,
			transactionPreparation.steps,
		);
		if (graphJournalByteLengthV1(journal) > GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1) {
			return mutationFailure(
				request.requestId,
				'payload-too-large',
				`The graph transaction recovery journal exceeds ${GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1} bytes.`,
			);
		}
		try {
			if (!await receiptStore.acquireJournal(journal, journalLeaseOwner)) {
				return mutationOutcomeUnknown(
					request,
					'Another Runtime holds this mutation journal.',
				);
			}
			const persistedJournal = await receiptStore.lookupJournal(receiptScope);
			if (!persistedJournal || JSON.stringify(persistedJournal) !== JSON.stringify(journal)) {
				return mutationFailure(
					request.requestId,
					'receipt-store-unavailable',
					'Mutation journal verification failed before write.',
					true,
				);
			}
		} catch {
			return mutationFailure(
				request.requestId,
				'receipt-store-unavailable',
				'Mutation journal persistence failed before write.',
				true,
			);
		}
		const dispatchAuditError = await this.appendDispatchAudit(
			request,
			'apply-dispatched',
		);
		if (dispatchAuditError) {
			try {
				await receiptStore.deleteJournal(receiptScope, journal, journalLeaseOwner);
			} catch {
				return mutationOutcomeUnknown(
					request,
					'Security audit failed and the pre-write mutation fence could not be removed.',
				);
			}
			return dispatchAuditError;
		}
		const checkpoint = async (value: RuntimeGraphTransactionCheckpointV1): Promise<void> => {
			journal = advanceGraphTransactionJournalV1(journal, value);
			await receiptStore.persistJournal(journal, journalLeaseOwner);
		};
		let commit: RuntimePreparedMutationCommitV1;
		try {
			commit = await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'commit',
				undefined,
				() => this.ports.commitMutationTransaction!(
					request,
					prepared,
					effectiveAt,
					journal,
					checkpoint,
				),
			);
		} catch {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'apply-completed',
				'Mutation transaction stopped after execution began.',
			);
		}
		if (commit.status !== 'committed') {
			if (commit.status !== 'failed') {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'apply-completed',
					commit.reason ?? 'Relationship graph transaction stopped.',
					markLastGroupUnknown(
						commit.groupResults,
						commit.reason ?? 'Mutation transaction stopped.',
					),
				);
			}
			try {
				if (!await receiptStore.deleteJournal(
					receiptScope,
					journal,
					journalLeaseOwner,
				)) {
					throw new Error('Mutation fence changed before cleanup.');
				}
			} catch {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'apply-completed',
					'Mutation failed, but its before-state or recovery fence could not be verified.',
					markLastGroupUnknown(
						commit.groupResults,
						'Mutation failure cleanup was not verified.',
					),
				);
			}
			try {
				await this.appendTerminalAudit(request, 'apply-completed');
			} catch {
				return mutationFailure(
					request.requestId,
					'audit-unavailable',
					'Mutation failed safely, but its terminal audit record could not be persisted.',
				);
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'failed',
				mutationMayHaveApplied: false,
				retryAllowed: false,
				groupResults: commit.groupResults,
				error: structuredError(
					'stale-source',
					commit.reason ?? 'The mutation did not commit its first atomic group.',
					false,
				),
			};
		}
		let postflightRevision: ContextRevisionV1;
		let observedAt: string;
		try {
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'reindex',
				undefined,
				() => this.ports.reindexAffectedSources(commit.affectedFilePaths),
			);
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'settlement',
				undefined,
				() => this.ports.settleAfterMutation(request.requestId),
			);
			postflightRevision = await this.ports.sampleContextRevision();
			if (!(await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'semantic-postflight',
				undefined,
				() => this.ports.verifyMutation!(request, prepared, postflightRevision, commit),
			))) {
				throw new Error('Mutation semantic postflight did not verify.');
			}
			if (!await this.ports.verifyMutationTransactionState(journal, 'after')) {
				throw new Error('Mutation resources changed during settlement.');
			}
			observedAt = new Date(this.ports.nowEpochMs()).toISOString();
		} catch {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'apply-completed',
				'Mutation committed, but live postflight remains unresolved.',
				markLastGroupUnknown(
					commit.groupResults,
					'Mutation postflight was not verified.',
				),
			);
		}
		const completedAt = new Date(this.ports.nowEpochMs()).toISOString();
		const receipt = buildTerminalMutationReceiptV1(
			request,
			vaultIdentityHash,
			effectiveAt,
			completedAt,
			'applied',
		);
		const postflight = verifiedPostflightV1(postflightRevision, observedAt);
		try {
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'receipt-persist',
				undefined,
				() => this.finalizeReceiptWithAdmission(
					receiptStore,
					request,
					receipt,
					journal,
					journalLeaseOwner,
					admissionToken,
				),
			);
		} catch {
			try {
				await this.appendTerminalAudit(request, 'apply-completed');
			} catch {
				// Same-plan recovery remains the dominant safety requirement.
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'outcome-unknown',
				mutationMayHaveApplied: true,
				retryAllowed: false,
				groupResults: [],
				ambiguitySource: 'receipt-persist-failure',
				postflight,
				error: structuredError(
					'outcome-unknown',
					'The mutation was verified, but receipt finalization failed; same-plan recovery is required.',
					false,
				),
			};
		}
		return {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-result',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: commit.groupResults,
			receipt,
			postflight,
		};
	}

	private async recoverPreparedGraphTransaction(
		request: MutationApplyRequestV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		receiptScope: MutationReceiptScopeV1,
		initialJournal: GraphTransactionJournalV1,
		vaultIdentityHash: string,
		journalLeaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
	): Promise<MutationResultV1> {
		if (!this.ports.verifyRecoveredMutationTransaction) {
			return mutationOutcomeUnknown(
				request,
				'Recovered graph semantics cannot be verified by this Runtime.',
			);
		}
		return await this.recoverGraphTransaction(
			request,
			receiptStore,
			receiptScope,
			initialJournal,
			vaultIdentityHash,
			journalLeaseOwner,
			admissionToken,
			this.ports.recoverMutationTransaction
				? (applyRequest, journal, checkpoint) => (
					this.ports.recoverMutationTransaction!(applyRequest, journal, checkpoint)
				)
				: undefined,
			this.ports.verifyMutationTransactionState
				? (journal, expected) => this.ports.verifyMutationTransactionState!(journal, expected)
				: undefined,
		);
	}

	private async recoverGraphTransaction(
		request: MutationApplyRequestV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		receiptScope: MutationReceiptScopeV1,
		initialJournal: GraphTransactionJournalV1,
		vaultIdentityHash: string,
		journalLeaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		recover: RuntimeMutationGatewayPortsV1['recoverMutationTransaction'],
		verifyState: RuntimeMutationGatewayPortsV1['verifyMutationTransactionState'],
	): Promise<MutationResultV1> {
		if (!recover || !verifyState) {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				'The durable graph transaction cannot be recovered.',
			);
		}
		let journal = initialJournal;
		const checkpoint = async (value: RuntimeGraphTransactionCheckpointV1): Promise<void> => {
			journal = advanceGraphTransactionJournalV1(journal, value);
			await receiptStore.persistJournal(journal, journalLeaseOwner);
		};
		let recovery: RuntimeGraphTransactionRecoveryV1;
		try {
			recovery = await recover(request, journal, checkpoint);
		} catch {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				'Same-plan graph recovery did not return a verified outcome.',
			);
		}
		if (recovery.status === 'outcome-unknown' || !recovery.verified) {
			const reason = recovery.reason ?? 'Graph recovery remains unresolved.';
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				reason,
				normalizeGraphRecoveryGroupResultsV1(
					recovery.groupResults,
					'outcome-unknown',
					reason,
				),
			);
		}
		if (recovery.status === 'compensated') {
			try {
				await this.ports.reindexAffectedSources(recovery.affectedFilePaths);
				await this.ports.settleAfterMutation(request.requestId);
				if (!await verifyState(journal, 'before')) throw new Error();
				if (!await receiptStore.deleteJournal(
					receiptScope,
					journal,
					journalLeaseOwner,
				)) {
					throw new Error();
				}
			} catch {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'recovery-completed',
					'Graph compensation settlement or fence cleanup failed.',
					normalizeGraphRecoveryGroupResultsV1(
						recovery.groupResults,
						'outcome-unknown',
						'Graph compensation was not verified.',
					),
				);
			}
			const reason = recovery.reason ?? 'The graph transaction was fully compensated.';
			try {
				await this.appendTerminalAudit(request, 'recovery-completed');
			} catch {
				return await this.outcomeUnknownAfterAuditFence(
					request,
					'recovery-completed',
					'Graph recovery was compensated, but terminal audit persistence failed.',
				);
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'failed',
				mutationMayHaveApplied: false,
				retryAllowed: false,
				groupResults: normalizeGraphRecoveryGroupResultsV1(
					recovery.groupResults,
					'failed',
					reason,
				),
				error: structuredError('stale-source', reason, false),
			};
		}
		try {
			await this.ports.reindexAffectedSources(recovery.affectedFilePaths);
			await this.ports.settleAfterMutation(request.requestId);
			if (!await verifyState(journal, 'after')) throw new Error();
		} catch {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				'Graph recovery writes completed, but settlement remains unresolved.',
				recovery.groupResults,
			);
		}
		const postflightRevision = await this.ports.sampleContextRevision();
		if (
			this.ports.verifyRecoveredMutationTransaction
			&& !await this.ports.verifyRecoveredMutationTransaction(
				request,
				journal,
				postflightRevision,
			)
		) {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				'Recovered graph bytes settled, but semantic postflight was not verified.',
				recovery.groupResults,
			);
		}
		const observedAt = new Date(this.ports.nowEpochMs()).toISOString();
		const receipt = buildTerminalMutationReceiptV1(
			request,
			vaultIdentityHash,
			journal.effectiveAt,
			observedAt,
			'applied',
		);
		try {
			await this.finalizeReceiptWithAdmission(
				receiptStore,
				request,
				receipt,
				journal,
				journalLeaseOwner,
				admissionToken,
				'recovery-completed',
			);
		} catch {
			return await this.outcomeUnknownAfterAuditFence(
				request,
				'recovery-completed',
				'Graph recovery was verified, but receipt finalization failed.',
				recovery.groupResults,
			);
		}
		return {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-result',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: recovery.groupResults,
			receipt,
			postflight: verifiedPostflightV1(postflightRevision, observedAt),
		};
	}

	private async applyPreparedMutation(
		request: MutationApplyRequestV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		receiptScope: MutationReceiptScopeV1,
		vaultIdentityHash: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
	): Promise<MutationResultV1> {
		if (
			!this.ports.prepareMutation
			|| !this.ports.commitMutation
			|| !this.ports.verifyMutation
		) {
			return mutationFailure(
				request.requestId,
				'capability-unavailable',
				'The requested mutation family has not passed its Runtime adapter gate.',
			);
		}
		// Prepared mutations seal every derived effect against the preview instant.
		// Reusing it at apply keeps recurrence content, terminal timestamps, and
		// confirmation-bound impact deterministic for the plan lifetime.
		const effectiveAt = request.plan.createdAt;
		const previewRequest: MutationPreviewRequestV1 = {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-preview',
			clientInstanceId: request.plan.clientInstanceId,
			idempotencyKey: request.idempotencyKey,
			correlationId: request.plan.correlationId,
			capability: request.plan.capability,
			mutationKind: request.plan.mutationKind,
			target: String(request.plan.spec.operation) !== 'update-batch'
				&& request.plan.targets[0]?.operonId
				&& request.plan.targets[0]?.locator
				? {
					operonId: request.plan.targets[0].operonId,
					locator: request.plan.targets[0].locator,
				}
				: undefined,
			spec: request.plan.spec,
			authorization: request.authorization,
		};
		const prepared = await this.measureMutation(
			request.requestId,
			'mutation-apply',
			'prepare',
			undefined,
			() => this.ports.prepareMutation!(previewRequest, effectiveAt),
		);
		if (!prepared.ok) {
			return mutationFailure(
				request.requestId,
				prepared.code,
				prepared.reason,
				prepared.retryable ?? false,
			);
		}
		if (!preparedMutationMatchesPlan(prepared.value, request.plan)) {
			return mutationFailure(
				request.requestId,
				'stale-source',
				'The mutation target or predicted effects changed after preview.',
			);
		}
		const preparedRevision = await this.ports.sampleContextRevision();
			if (!mutationContextRevisionsEqual(preparedRevision, request.plan.contextRevision)) {
				return mutationFailure(
					request.requestId,
					'stale-context',
					'Runtime context changed while apply-time mutation state was prepared.',
				);
			}
			if (isPreparedGraphTransactionPlan(request.plan)) {
				return await this.applyPreparedGraphTransaction(
					request,
					prepared.value,
					receiptStore,
					receiptScope,
						vaultIdentityHash,
						effectiveAt,
						admissionToken,
					);
			}

			const dispatchAuditError = await this.appendDispatchAudit(
				request,
				'apply-dispatched',
			);
			if (dispatchAuditError) return dispatchAuditError;
				let commit: RuntimePreparedMutationCommitV1;
			let postflightRevision: ContextRevisionV1 | null = null;
			let postflightObservedAt: string | null = null;
			try {
				commit = await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'commit',
					undefined,
					() => this.ports.commitMutation!(request, prepared.value, effectiveAt),
				);
			} catch {
				try {
				await this.ports.reindexAffectedSources(taskSourcePathsFromPlan(request.plan));
				await this.ports.settleAfterMutation(request.requestId);
			} catch {
				// The durable outcome is already uncertain; reconciliation is best effort only.
			}
			return await this.persistPreparedMutationUncertainty(
				request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					'Mutation execution began but did not return a verified outcome.',
			);
		}
		if (commit.status !== 'committed') {
			if (commit.status === 'failed') {
				try {
					await this.appendTerminalAudit(request, 'apply-completed');
				} catch {
					return mutationFailure(
						request.requestId,
						'audit-unavailable',
						'Mutation failed safely, but its terminal audit record could not be persisted.',
					);
				}
				return {
					contractVersion: 1,
					requestId: request.requestId,
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: commit.groupResults,
					error: structuredError(
						'stale-source',
						commit.reason ?? 'The mutation did not commit its first atomic resource group.',
						false,
					),
				};
			}
			const uncertainGroupResults = markLastGroupUnknown(
				commit.groupResults,
				commit.reason ?? 'The mutation did not commit every atomic resource group.',
			);
			try {
				await this.ports.reindexAffectedSources(commit.affectedFilePaths);
				await this.ports.settleAfterMutation(request.requestId);
			} catch {
				// Receipt fencing below remains mandatory even when reconciliation fails.
			}
			return await this.persistPreparedMutationUncertainty(
				request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					commit.reason ?? 'The mutation did not commit every atomic resource group.',
				uncertainGroupResults,
			);
		}
		try {
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'reindex',
				undefined,
				() => this.ports.reindexAffectedSources(commit.affectedFilePaths),
			);
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'settlement',
				undefined,
				() => this.ports.settleAfterMutation(request.requestId),
			);
				postflightRevision = await this.ports.sampleContextRevision();
				if (!(await this.measureMutation(
					request.requestId,
					'mutation-apply',
					'semantic-postflight',
					undefined,
					() => this.ports.verifyMutation!(
						request,
						prepared.value,
						postflightRevision!,
						commit,
					),
				))) {
				return await this.persistPreparedMutationUncertainty(
					request,
						receiptStore,
						vaultIdentityHash,
						effectiveAt,
						admissionToken,
						'The mutation committed, but live postflight verification did not settle.',
					markLastGroupUnknown(
						commit.groupResults,
						'The source mutation committed, but its live postflight was not verified.',
					),
				);
				}
				postflightObservedAt = new Date(this.ports.nowEpochMs()).toISOString();
		} catch {
			return await this.persistPreparedMutationUncertainty(
				request,
					receiptStore,
					vaultIdentityHash,
					effectiveAt,
					admissionToken,
					'The mutation committed, but a post-commit reconciliation stage failed.',
				markLastGroupUnknown(
					commit.groupResults,
					'The source mutation committed, but its post-commit state is uncertain.',
				),
			);
		}

			if (!postflightRevision || !postflightObservedAt) {
				return await this.persistPreparedMutationUncertainty(
					request,
						receiptStore,
						vaultIdentityHash,
						effectiveAt,
						admissionToken,
						'The mutation did not retain verified postflight evidence.',
					markLastGroupUnknown(
						commit.groupResults,
						'The source mutation committed without retained postflight evidence.',
					),
				);
			}
			const postflight = verifiedPostflightV1(
				postflightRevision,
				postflightObservedAt,
			);
			const completedAt = new Date(this.ports.nowEpochMs()).toISOString();
			const receipt = buildTerminalMutationReceiptV1(
				request,
				vaultIdentityHash,
				effectiveAt,
				completedAt,
				'applied',
			);
		try {
			await this.measureMutation(
				request.requestId,
				'mutation-apply',
				'receipt-persist',
				undefined,
				() => this.persistReceiptWithAdmission(
					receiptStore,
					request,
					receipt,
					admissionToken,
				),
			);
		} catch {
			try {
				await this.appendTerminalAudit(request, 'apply-completed');
			} catch {
				// Same-plan recovery remains the dominant safety requirement.
			}
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'outcome-unknown',
				mutationMayHaveApplied: true,
				retryAllowed: false,
					groupResults: [],
					ambiguitySource: 'receipt-persist-failure',
					postflight,
				error: structuredError(
					'outcome-unknown',
					'The mutation was verified, but its durable receipt could not be persisted.',
					false,
				),
			};
		}
		return {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-result',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
				groupResults: commit.groupResults,
				receipt,
				postflight,
			};
	}

	private async persistPreparedMutationUncertainty(
		request: MutationApplyRequestV1,
		receiptStore: IndexedDbMutationReceiptStoreV1,
		vaultIdentityHash: string,
		effectiveAt: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		reason: string,
		groupResults: AtomicGroupResultV1[] = [],
	): Promise<MutationResultV1> {
		const completedAt = new Date(this.ports.nowEpochMs()).toISOString();
		const receipt = buildTerminalMutationReceiptV1(
			request,
			vaultIdentityHash,
			effectiveAt,
			completedAt,
			'outcome-unknown',
		);
		let persisted = true;
		try {
			await this.persistReceiptWithAdmission(receiptStore, request, receipt, admissionToken);
		} catch {
			persisted = false;
		}
		const normalizedGroupResults = groupResults.length > 0
			? groupResults
			: unknownFirstAtomicGroup(request.plan, reason);
		return {
			...mutationOutcomeUnknown(request, reason, normalizedGroupResults),
			// This path is already ambiguous because a group or postflight could not
			// be proven. Receipt persistence failure must not replace that dominant
			// ambiguity with the narrower verified-postflight outcome.
			ambiguitySource: 'group-outcome',
			...(persisted ? { receipt } : {}),
		};
	}

	private async persistReceiptWithAdmission(
		receiptStore: IndexedDbMutationReceiptStoreV1,
		request: MutationApplyRequestV1,
		receipt: MutationReceiptV1,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		auditEvent: 'apply-completed' | 'recovery-completed' = 'apply-completed',
	): Promise<void> {
		if (admissionToken) {
			const terminalAuditEvent = this.ports.createSecurityAuditEvent?.(
				auditEvent,
				request,
				receipt,
			);
			if (terminalAuditEvent) {
				await receiptStore.persistWithSecurityAuditAfterApplyAdmission(
					receipt,
					terminalAuditEvent,
					admissionToken,
				);
				return;
			}
			await receiptStore.persistAfterApplyAdmission(receipt, admissionToken);
			return;
		}
		await receiptStore.persist(receipt);
		await this.appendTerminalAudit(request, auditEvent, receipt);
	}

	private async finalizeReceiptWithAdmission(
		receiptStore: IndexedDbMutationReceiptStoreV1,
		request: MutationApplyRequestV1,
		receipt: MutationReceiptV1,
		journal: GraphTransactionJournalV1,
		journalLeaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		auditEvent: 'apply-completed' | 'recovery-completed' = 'apply-completed',
	): Promise<void> {
		if (admissionToken) {
			const terminalAuditEvent = this.ports.createSecurityAuditEvent?.(
				auditEvent,
				request,
				receipt,
			);
			if (terminalAuditEvent) {
				await receiptStore.finalizeReceiptWithSecurityAuditAfterApplyAdmission(
					receipt,
					journal,
					journalLeaseOwner,
					terminalAuditEvent,
					admissionToken,
				);
				return;
			}
			await receiptStore.finalizeReceiptAfterApplyAdmission(
				receipt,
				journal,
				journalLeaseOwner,
				admissionToken,
			);
			return;
		}
		await receiptStore.finalizeReceipt(receipt, journal, journalLeaseOwner);
		await this.appendTerminalAudit(request, auditEvent, receipt);
	}

	private async appendDispatchAudit(
		request: MutationApplyRequestV1,
		event: 'apply-dispatched' | 'recovery-dispatched',
	): Promise<MutationResultV1 | null> {
		if (!this.ports.securityAuditStore || !this.ports.createSecurityAuditEvent) {
			return null;
		}
		const store = this.ports.securityAuditStore();
		if (!store) {
			return mutationFailure(
				request.requestId,
				'audit-unavailable',
				'The security audit store is unavailable, so mutation dispatch was refused.',
			);
		}
		try {
			const auditEvent = this.ports.createSecurityAuditEvent(event, request);
			if (!auditEvent) return null;
			await store.append(auditEvent);
			return null;
		} catch {
			return mutationFailure(
				request.requestId,
				'audit-unavailable',
				'The security audit admission record could not be persisted.',
			);
		}
	}

	private async appendTerminalAudit(
		request: MutationApplyRequestV1,
		event: 'apply-completed' | 'recovery-completed',
		receipt?: MutationReceiptV1,
	): Promise<void> {
		if (!this.ports.securityAuditStore || !this.ports.createSecurityAuditEvent) return;
		const store = this.ports.securityAuditStore();
		if (!store) throw new Error('Security audit store unavailable after dispatch.');
		const auditEvent = this.ports.createSecurityAuditEvent(event, request, receipt);
		if (auditEvent) await store.append(auditEvent);
	}

	private async outcomeUnknownAfterAuditFence(
		request: MutationApplyRequestV1,
		event: 'apply-completed' | 'recovery-completed',
		reason: string,
		groupResults?: AtomicGroupResultV1[],
	): Promise<MutationResultV1> {
		try {
			await this.appendTerminalAudit(request, event);
		} catch {
			// The mutation is already fenced as uncertain. Audit unavailability
			// cannot safely downgrade or replace the dominant recovery outcome.
		}
		return mutationOutcomeUnknown(request, reason, groupResults);
	}

	private measureMutation<T>(
		requestId: string,
		flow: 'mutation-preview' | 'mutation-apply',
		span: RuntimeTimingSpanNameV1,
		attempt: number | undefined,
		operation: () => Promise<T> | T,
	): Promise<T> | T {
		if (!OPERON_AGENT_RUNTIME_PROBE_ENABLED || !this.ports.timingSink) {
			return operation();
		}
		return measureRuntimeTimingSpanV1(
			this.ports.timingSink,
			{
				requestId,
				flow,
				span,
				...(attempt === undefined ? {} : { attempt }),
			},
			operation,
			this.ports.timingNow,
		);
	}

	private async withReceiptScopeLock<T>(
		scope: MutationReceiptScopeV1,
		operation: () => Promise<T>,
	): Promise<T> {
		const key = canonicalJsonV1(toJsonValueV1(scope));
		const previous = RECEIPT_SCOPE_TAILS_V1.get(key) ?? Promise.resolve();
		let release = (): void => undefined;
		const current = new Promise<void>(resolve => {
			release = resolve;
		});
		const tail = previous.then(() => current);
		RECEIPT_SCOPE_TAILS_V1.set(key, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (RECEIPT_SCOPE_TAILS_V1.get(key) === tail) {
				RECEIPT_SCOPE_TAILS_V1.delete(key);
			}
		}
	}

}

export async function withRuntimeVaultMutationLockV1<T>(
	vaultIdentityHash: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = VAULT_MUTATION_TAILS_V1.get(vaultIdentityHash) ?? Promise.resolve();
	let release = (): void => undefined;
	const current = new Promise<void>(resolve => {
		release = resolve;
	});
	const tail = previous.then(() => current);
	VAULT_MUTATION_TAILS_V1.set(vaultIdentityHash, tail);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (VAULT_MUTATION_TAILS_V1.get(vaultIdentityHash) === tail) {
			VAULT_MUTATION_TAILS_V1.delete(vaultIdentityHash);
		}
	}
}

export async function tryWithRuntimeVaultMutationLockV1<T>(
	vaultIdentityHash: string,
	operation: () => Promise<T>,
): Promise<T | null> {
	if (VAULT_MUTATION_TAILS_V1.has(vaultIdentityHash)) return null;
	return await withRuntimeVaultMutationLockV1(vaultIdentityHash, operation);
}

function buildSealedPlan(
	request: MutationPreviewRequestV1 & { spec: Extract<MutationPreviewRequestV1['spec'], { operation: 'create' }> },
	prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	contextRevision: ContextRevisionV1,
	createdAt: string,
	randomId: string,
): SealedMutationPlanV1 {
	const affectedResourceCandidates: AffectedResourceRevisionMapV1 = [
		...prepared.plan.sourceGroups.map(group => ({
			resourceKind: 'task-source' as const,
			resourceKey: group.filePath,
			revision: group.expectedRevision,
		})),
		...prepared.parentResources.map(parent => ({
			resourceKind: 'task-source' as const,
			resourceKey: parent.filePath,
			revision: parent.sourceRevision,
		})),
		...(prepared.recurrenceResources ?? []).map(resource => ({
			resourceKind: 'repeat-series' as const,
			resourceKey: resource.seriesId,
			revision: resource.revision,
		})),
	];
	const affectedResources = [...new Map(
		affectedResourceCandidates.map(resource => [`${resource.resourceKind}\0${resource.resourceKey}`, resource]),
	).values()].sort((left, right) => (
		RESOURCE_QUEUE_ORDER_V1[left.resourceKind] - RESOURCE_QUEUE_ORDER_V1[right.resourceKind]
			|| left.resourceKey.localeCompare(right.resourceKey)
	));
	const targets = prepared.createEffects.map(effect => ({
		operonId: effect.operonId,
		locator: effect.locator,
		targetDigest: sha256HexV1(canonicalJsonV1(toJsonValueV1(effect))),
	}));
	const crossSourcePartialRisk = prepared.sourceGroupGraph.crossSourcePartialRisk;
	const requiredAcknowledgements = crossSourcePartialRisk
		? ['confirm:cross-source-graph-partial-risk']
		: [];
	const warnings: SealedMutationPlanV1['warnings'] = [{
		code: 'apply-time-values-projected',
		message: 'Creation and modified timestamps are projected at preview and captured authoritatively at apply.',
	}, ...(crossSourcePartialRisk ? [{
		code: 'cross-source-graph-partial-risk',
		message: 'This creation graph spans ordered task sources; a later source conflict can leave an earlier source committed.',
	}] : [])];
	const base: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: randomId,
		planHash: '0'.repeat(64),
		clientInstanceId: request.clientInstanceId,
		correlationId: request.correlationId ?? request.requestId,
		idempotencyKeyHash: sha256HexV1(request.idempotencyKey),
		receiptTargetDigest: computeReceiptTargetDigestV1(targets),
		capability: request.capability,
		mutationKind: request.mutationKind,
		createdAt,
		expiresAt: new Date(Date.parse(createdAt) + ROUTINE_PLAN_TTL_MS).toISOString(),
		targets,
		contextRevision,
		affectedResources,
		atomicGroups: buildCreationAtomicGroups(prepared, affectedResources),
		predictedEffects: buildPredictedEffects(prepared, affectedResources),
		riskLevel: crossSourcePartialRisk ? 'elevated' : 'routine',
		requiresConfirmation: requiredAcknowledgements.length > 0,
		requiredAcknowledgements,
		warnings,
		spec: request.spec,
		createEffects: prepared.createEffects,
	};
	base.planHash = computeSealedMutationPlanHashV1(base);
	return base;
}

function buildCreationAtomicGroups(
	prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	resources: AffectedResourceRevisionMapV1,
): AtomicResourceGroupV1[] {
	const resourceKeys = new Set(resources.map(resource => (
		`${resource.resourceKind}\0${resource.resourceKey}`
	)));
	const availableSourcePaths = new Set([
		...prepared.plan.sourceGroups.map(group => group.filePath),
		...prepared.parentResources.map(resource => resource.filePath),
	]);
	const sourcePaths = [
		...prepared.sourceGroupGraph.sourceOrder.filter(filePath => availableSourcePaths.has(filePath)),
		...[...availableSourcePaths]
			.filter(filePath => !prepared.sourceGroupGraph.sourceOrder.includes(filePath))
			.sort((left, right) => left.localeCompare(right)),
	];
	return sourcePaths.map((filePath, order) => {
		const groupResources: AtomicResourceGroupV1['resources'] = [];
		for (const recurrence of (prepared.recurrenceResources ?? [])
			.filter(resource => resource.filePath === filePath)
			.sort((left, right) => left.seriesId.localeCompare(right.seriesId))) {
			if (resourceKeys.has(`repeat-series\0${recurrence.seriesId}`)) {
				groupResources.push({
					resourceKind: 'repeat-series',
					resourceKey: recurrence.seriesId,
				});
			}
		}
		if (resourceKeys.has(`task-source\0${filePath}`)) {
			groupResources.push({ resourceKind: 'task-source', resourceKey: filePath });
		}
		return {
			groupId: `task-source:${filePath}`,
			order,
			resources: groupResources,
		};
	});
}

function buildPreparedMutationPlan(
	request: MutationPreviewRequestV1,
	prepared: RuntimePreparedMutationV1,
	sealedSpec: MutationSpecV1,
	contextRevision: ContextRevisionV1,
	createdAt: string,
	randomId: string,
): SealedMutationPlanV1 {
	const riskLevel = prepared.riskLevel ?? requiredRiskForSpecV1(sealedSpec);
	const destructive = riskLevel === 'destructive';
	const requiredAcknowledgements = prepared.requiredAcknowledgements?.length
		? [...prepared.requiredAcknowledgements]
		: destructive
			? [`confirm:${request.mutationKind}`]
			: [];
	const requiresConfirmation = requiredAcknowledgements.length > 0;
	const targets = prepared.targets ?? [prepared.target];
	const base: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: randomId,
		planHash: '0'.repeat(64),
		clientInstanceId: request.clientInstanceId,
		correlationId: request.correlationId ?? request.requestId,
		idempotencyKeyHash: sha256HexV1(request.idempotencyKey),
		receiptTargetDigest: computeReceiptTargetDigestV1(targets),
		capability: request.capability,
		mutationKind: request.mutationKind,
		createdAt,
		expiresAt: new Date(
			Date.parse(createdAt) + (destructive ? 60_000 : ROUTINE_PLAN_TTL_MS),
		).toISOString(),
		targets,
		contextRevision,
		affectedResources: prepared.affectedResources,
		atomicGroups: prepared.atomicGroups ?? prepared.affectedResources.map((resource, order) => ({
			groupId: `${resource.resourceKind}:${resource.resourceKey}`,
			order,
			resources: [{
				resourceKind: resource.resourceKind,
				resourceKey: resource.resourceKey,
			}],
		})),
		predictedEffects: prepared.predictedEffects,
		riskLevel,
		requiresConfirmation,
		requiredAcknowledgements,
		warnings: prepared.warnings,
		spec: sealedSpec,
		...(prepared.conversionEffect
			? { conversionEffect: prepared.conversionEffect }
			: {}),
		...(prepared.updateBatchEffects
			? { updateBatchEffects: prepared.updateBatchEffects }
			: {}),
	};
	base.planHash = computeSealedMutationPlanHashV1(base);
	return base;
}

function isSealedMutationSpecV1(
	spec: MutationPreviewRequestV1['spec'],
): spec is MutationSpecV1 {
	return spec.operation !== 'relocate-inline' || 'source' in spec;
}

function isPreparedGraphTransactionPlan(plan: SealedMutationPlanV1): boolean {
	return [
		'task.inline-relocate',
		'task.convert',
		'task.delete',
	].includes(String(plan.mutationKind)) || (
		String(plan.spec.operation) === 'update-batch'
	) || (
		String(plan.mutationKind) === 'task.relationship'
		&& String(plan.spec.operation) === 'replace-relationships'
	) || (
		String(plan.mutationKind) === 'task.recurrence'
		&& String(plan.spec.operation) === 'update-recurrence'
	) || (
		String(plan.mutationKind) === 'timer.session'
		&& (
			String(plan.spec.operation) === 'add-session'
			|| String(plan.spec.operation) === 'update-session'
			|| String(plan.spec.operation) === 'remove-session'
		)
	);
}

function preparedMutationMatchesPlan(
	prepared: RuntimePreparedMutationV1,
	plan: SealedMutationPlanV1,
): boolean {
	const riskLevel = prepared.riskLevel ?? requiredRiskForSpecV1(plan.spec);
	const destructive = riskLevel === 'destructive';
	const requiredAcknowledgements = prepared.requiredAcknowledgements?.length
		? [...prepared.requiredAcknowledgements]
		: destructive
			? [`confirm:${plan.mutationKind}`]
			: [];
	const expectedGroups = prepared.atomicGroups ?? prepared.affectedResources.map((resource, order) => ({
		groupId: `${resource.resourceKind}:${resource.resourceKey}`,
		order,
		resources: [{
			resourceKind: resource.resourceKind,
			resourceKey: resource.resourceKey,
		}],
	}));
	return canonicalJsonV1(toJsonValueV1(prepared.targets ?? [prepared.target]))
			=== canonicalJsonV1(toJsonValueV1(plan.targets))
		&& canonicalJsonV1(toJsonValueV1(prepared.sealedSpec ?? plan.spec))
			=== canonicalJsonV1(toJsonValueV1(plan.spec))
		&& canonicalJsonV1(toJsonValueV1(prepared.affectedResources))
			=== canonicalJsonV1(toJsonValueV1(plan.affectedResources))
		&& canonicalJsonV1(toJsonValueV1(prepared.predictedEffects))
			=== canonicalJsonV1(toJsonValueV1(plan.predictedEffects))
		&& canonicalJsonV1(toJsonValueV1(prepared.updateBatchEffects ?? []))
			=== canonicalJsonV1(toJsonValueV1(plan.updateBatchEffects ?? []))
		&& canonicalJsonV1(toJsonValueV1(expectedGroups))
			=== canonicalJsonV1(toJsonValueV1(plan.atomicGroups))
		&& riskLevel === plan.riskLevel
		&& (requiredAcknowledgements.length > 0) === plan.requiresConfirmation
		&& canonicalJsonV1(toJsonValueV1(requiredAcknowledgements))
			=== canonicalJsonV1(toJsonValueV1(plan.requiredAcknowledgements))
		&& canonicalJsonV1(toJsonValueV1(prepared.warnings))
			=== canonicalJsonV1(toJsonValueV1(plan.warnings))
		&& canonicalJsonV1(toJsonValueV1(prepared.conversionEffect ?? null))
			=== canonicalJsonV1(toJsonValueV1(plan.conversionEffect ?? null));
}

function mutationOutcomeUnknown(
	request: MutationApplyRequestV1,
	reason: string,
	groupResults: AtomicGroupResultV1[] = [],
): MutationResultV1 {
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: markLastGroupUnknown(
			groupResults.length > 0
				? groupResults
				: unknownFirstAtomicGroup(request.plan, reason),
			reason,
		),
		ambiguitySource: 'group-outcome',
		error: structuredError('outcome-unknown', reason, false),
	};
}

function taskSourcePathsFromPlan(plan: SealedMutationPlanV1): string[] {
	return plan.affectedResources
		.filter(resource => resource.resourceKind === 'task-source')
		.map(resource => resource.resourceKey);
}

function unknownFirstAtomicGroup(
	plan: SealedMutationPlanV1,
	reason: string,
): AtomicGroupResultV1[] {
	const firstGroup = plan.atomicGroups[0];
	return firstGroup
		? [{
			groupId: firstGroup.groupId,
			status: 'outcome-unknown',
			error: structuredError('outcome-unknown', reason, false),
		}]
		: [];
}

function preparationMatchesPlan(
	prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	plan: SealedMutationPlanV1,
): boolean {
	const currentResourceCandidates = [
		...prepared.plan.sourceGroups.map(group => ({
			resourceKind: 'task-source' as const,
			resourceKey: group.filePath,
			revision: group.expectedRevision,
		})),
		...prepared.parentResources.map(parent => ({
			resourceKind: 'task-source' as const,
			resourceKey: parent.filePath,
			revision: parent.sourceRevision,
		})),
		...(prepared.recurrenceResources ?? []).map(resource => ({
			resourceKind: 'repeat-series' as const,
			resourceKey: resource.seriesId,
			revision: resource.revision,
		})),
	];
	const currentResources = [...new Map(
		currentResourceCandidates.map(resource => [`${resource.resourceKind}\0${resource.resourceKey}`, resource]),
	).values()].sort((left, right) => (
		RESOURCE_QUEUE_ORDER_V1[left.resourceKind] - RESOURCE_QUEUE_ORDER_V1[right.resourceKind]
			|| left.resourceKey.localeCompare(right.resourceKey)
	));
	const currentEffects = prepared.createEffects;
	const plannedEffects = (plan.createEffects ?? []).filter(effect => (
		currentResources.some(resource => resource.resourceKey === effect.locator.filePath)
	));
	const currentTargets = currentEffects.map(effect => ({
		operonId: effect.operonId,
		locator: effect.locator,
		targetDigest: sha256HexV1(canonicalJsonV1(toJsonValueV1(effect))),
	}));
	const plannedTargets = plan.targets.filter(target => (
		currentEffects.some(effect => effect.operonId === target.operonId)
	));
	const expectedGroups = buildCreationAtomicGroups(prepared, currentResources);
	const expectedPredictedEffects = buildPredictedEffects(prepared, currentResources);
	const crossSourcePartialRisk = prepared.sourceGroupGraph.crossSourcePartialRisk;
	const requiredAcknowledgements = crossSourcePartialRisk
		? ['confirm:cross-source-graph-partial-risk']
		: [];
	const expectedWarnings: SealedMutationPlanV1['warnings'] = [{
		code: 'apply-time-values-projected',
		message: 'Creation and modified timestamps are projected at preview and captured authoritatively at apply.',
	}, ...(crossSourcePartialRisk ? [{
		code: 'cross-source-graph-partial-risk',
		message: 'This creation graph spans ordered task sources; a later source conflict can leave an earlier source committed.',
	}] : [])];
	return canonicalJsonV1(toJsonValueV1(currentResources))
			=== canonicalJsonV1(toJsonValueV1(plan.affectedResources))
		&& canonicalJsonV1(toJsonValueV1(currentEffects))
			=== canonicalJsonV1(toJsonValueV1(plannedEffects))
		&& canonicalJsonV1(toJsonValueV1(currentTargets))
			=== canonicalJsonV1(toJsonValueV1(plannedTargets))
		&& canonicalJsonV1(toJsonValueV1(expectedGroups))
			=== canonicalJsonV1(toJsonValueV1(plan.atomicGroups))
		&& canonicalJsonV1(toJsonValueV1(expectedPredictedEffects))
			=== canonicalJsonV1(toJsonValueV1(plan.predictedEffects))
		&& plan.riskLevel === (crossSourcePartialRisk ? 'elevated' : 'routine')
		&& plan.requiresConfirmation === crossSourcePartialRisk
		&& canonicalJsonV1(toJsonValueV1(plan.requiredAcknowledgements))
			=== canonicalJsonV1(toJsonValueV1(requiredAcknowledgements))
		&& canonicalJsonV1(toJsonValueV1(plan.warnings))
			=== canonicalJsonV1(toJsonValueV1(expectedWarnings));
}

function preparationStaticShapeMatches(
	preview: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	apply: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
): boolean {
	const projectEffect = (effect: NonNullable<SealedMutationPlanV1['createEffects']>[number]) => ({
		itemRef: effect.itemRef,
		operonId: effect.operonId,
		locator: effect.locator,
		...(effect.targetBeforeDigest ? { targetBeforeDigest: effect.targetBeforeDigest } : {}),
		...(effect.expectedAbsence ? { expectedAbsence: true } : {}),
		...(effect.templateId ? { templateId: effect.templateId } : {}),
		...(effect.templateDigest ? { templateDigest: effect.templateDigest } : {}),
		...(effect.resolvedParentOperonId
			? { resolvedParentOperonId: effect.resolvedParentOperonId }
			: {}),
		resolvedRelatedOperonIds: effect.resolvedRelatedOperonIds,
		...(effect.resolvedDependencies
			? { resolvedDependencies: effect.resolvedDependencies }
			: {}),
		...(effect.bodyMarkdownSummary
			? { bodyMarkdownSummary: effect.bodyMarkdownSummary }
			: {}),
		...(effect.repeatSeriesId ? { repeatSeriesId: effect.repeatSeriesId } : {}),
	});
	const projectGroups = (value: typeof preview) => value.plan.sourceGroups.map(group => ({
		groupId: group.groupId,
		filePath: group.filePath,
		expectedRevision: group.expectedRevision,
		expectedState: group.expectedState,
		expectedContent: group.expectedContent,
		operation: group.operation,
		taskItemKeys: group.taskItemKeys,
	}));
	const projectParents = (value: typeof preview) => value.parentResources.map(parent => ({
		operonId: parent.operonId,
		filePath: parent.filePath,
		sourceRevision: parent.sourceRevision,
		format: parent.format,
		...(parent.lineNumber === undefined ? {} : { lineNumber: parent.lineNumber }),
	}));
	const projectDependencies = (value: typeof preview) => (value.dependencyResources ?? []).map(resource => ({
		operonId: resource.operonId,
		filePath: resource.filePath,
		format: resource.format,
		...(resource.lineNumber === undefined ? {} : { lineNumber: resource.lineNumber }),
		additions: resource.additions,
	}));
	return canonicalJsonV1(toJsonValueV1(preview.createEffects.map(projectEffect)))
			=== canonicalJsonV1(toJsonValueV1(apply.createEffects.map(projectEffect)))
		&& canonicalJsonV1(toJsonValueV1(projectGroups(preview)))
			=== canonicalJsonV1(toJsonValueV1(projectGroups(apply)))
		&& canonicalJsonV1(toJsonValueV1(projectParents(preview)))
			=== canonicalJsonV1(toJsonValueV1(projectParents(apply)))
		&& canonicalJsonV1(toJsonValueV1(projectDependencies(preview)))
			=== canonicalJsonV1(toJsonValueV1(projectDependencies(apply)))
		&& canonicalJsonV1(toJsonValueV1(preview.sourceGroupGraph))
			=== canonicalJsonV1(toJsonValueV1(apply.sourceGroupGraph))
		&& canonicalJsonV1(toJsonValueV1(preview.recurrenceResources ?? []))
			=== canonicalJsonV1(toJsonValueV1(apply.recurrenceResources ?? []));
}

function buildPredictedEffects(
	prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	resources: AffectedResourceRevisionMapV1,
): SealedMutationPlanV1['predictedEffects'] {
	return resources.map(resource => {
		if (resource.resourceKind === 'repeat-series') {
			const recurrence = (prepared.recurrenceResources ?? []).find(
				candidate => candidate.seriesId === resource.resourceKey,
			);
			return {
				resourceKind: resource.resourceKind,
				resourceKey: resource.resourceKey,
				action: 'create' as const,
				summary: `Create recurrence series for ${recurrence?.operonId ?? resource.resourceKey}.`,
			};
		}
		const sourceGroup = prepared.plan.sourceGroups.find(group => group.filePath === resource.resourceKey);
		const parentCount = prepared.parentResources.filter(parent => parent.filePath === resource.resourceKey).length;
		const dependencyCount = (prepared.dependencyResources ?? []).filter(
			dependency => dependency.filePath === resource.resourceKey,
		).length;
		const summaries = [];
		if (sourceGroup && sourceGroup.taskItemKeys.length > 0) {
			summaries.push(`Create ${sourceGroup.taskItemKeys.length} Operon task(s)`);
		}
		if (dependencyCount > 0) {
			summaries.push(`update ${dependencyCount} reciprocal dependency target(s)`);
		}
		if (parentCount > 0) {
			summaries.push(`update ${parentCount} parent task timestamp(s)`);
		}
		return {
			resourceKind: resource.resourceKind,
			resourceKey: resource.resourceKey,
			action: sourceGroup?.operation === 'create' ? 'create' as const : 'update' as const,
			summary: `${summaries.join(', ') || 'Update task source'} in ${resource.resourceKey}.`,
		};
	});
}

function buildGraphTransactionJournalV1(
	request: MutationApplyRequestV1,
	vaultIdentityHash: string,
	effectiveAt: string,
	steps: GraphTransactionJournalStepV1[],
): GraphTransactionJournalV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash,
		clientInstanceId: request.plan.clientInstanceId,
		idempotencyKeyHash: request.plan.idempotencyKeyHash,
		mutationKind: request.plan.mutationKind,
		planHash: request.plan.planHash,
		targetDigest: request.plan.receiptTargetDigest,
		planId: request.plan.planId,
		effectiveAt,
		createdAt: request.plan.createdAt,
		phase: 'prepared',
		completedStepCount: 0,
		steps: steps.map(step => ({
			...step,
			before: { ...step.before },
			after: { ...step.after },
		})),
	};
}

function advanceGraphTransactionJournalV1(
	journal: GraphTransactionJournalV1,
	checkpoint: RuntimeGraphTransactionCheckpointV1,
): GraphTransactionJournalV1 {
	if (
		!Number.isSafeInteger(checkpoint.completedStepCount)
		|| checkpoint.completedStepCount < journal.completedStepCount
		|| checkpoint.completedStepCount > journal.steps.length
	) {
		throw new Error('Graph transaction checkpoint is outside the sealed step range.');
	}
	return {
		...journal,
		phase: checkpoint.phase,
		completedStepCount: checkpoint.completedStepCount,
	};
}

function graphJournalByteLengthV1(journal: GraphTransactionJournalV1): number {
	return new TextEncoder().encode(JSON.stringify(journal)).byteLength;
}

function normalizeGraphRecoveryGroupResultsV1(
	results: readonly AtomicGroupResultV1[],
	status: 'failed' | 'outcome-unknown',
	reason: string,
): AtomicGroupResultV1[] {
	const stoppingGroup = results[0];
	return stoppingGroup ? [{
		groupId: stoppingGroup.groupId,
		status,
		error: structuredError(
			status === 'failed' ? 'stale-source' : 'outcome-unknown',
			reason,
			false,
		),
	}] : [];
}

function toGroupResults(commit: TaskCreationCommitSummary): AtomicGroupResultV1[] {
	return commit.groups.map(group => ({
		groupId: group.groupId,
		status: group.result.status === 'committed'
			? 'committed'
			: group.result.status === 'outcome-unknown' ? 'outcome-unknown' : 'failed',
		...(group.result.status === 'committed'
			? {
				resourceRevisions: [...(group.result.resourceRevisions ?? [{
					resourceKind: 'task-source' as const,
					resourceKey: group.filePath,
					revision: group.result.resultingRevision,
				}])].sort((left, right) => (
					RESOURCE_QUEUE_ORDER_V1[left.resourceKind]
						- RESOURCE_QUEUE_ORDER_V1[right.resourceKind]
					|| left.resourceKey.localeCompare(right.resourceKey)
				)),
			}
			: {
				error: structuredError(
					group.result.status === 'outcome-unknown' ? 'outcome-unknown' : 'stale-source',
					group.result.reason,
					false,
				),
			}),
	}));
}

function markLastGroupUnknown(
	results: readonly AtomicGroupResultV1[],
	reason: string,
): AtomicGroupResultV1[] {
	if (results.length === 0) return [];
	const lastIndex = results.length - 1;
	return results.map((result, index) => (
		index === lastIndex
			? {
				groupId: result.groupId,
				status: 'outcome-unknown' as const,
				error: structuredError('outcome-unknown', reason, false),
			}
			: result
	));
}

function replaceCommittedResourceRevisions(
	results: readonly AtomicGroupResultV1[],
	revisions: AffectedResourceRevisionMapV1,
): AtomicGroupResultV1[] {
	const byKey = new Map(revisions.map(resource => [
		`${resource.resourceKind}\0${resource.resourceKey}`,
		resource,
	]));
	return results.map(result => {
		if (result.status !== 'committed' || !result.resourceRevisions) return result;
		return {
			...result,
			resourceRevisions: result.resourceRevisions.map(resource => (
				byKey.get(`${resource.resourceKind}\0${resource.resourceKey}`) ?? resource
			)),
		};
	});
}

function contextRevisionsEqual(left: ContextRevisionV1, right: ContextRevisionV1): boolean {
	return canonicalJsonV1(toJsonValueV1(left)) === canonicalJsonV1(toJsonValueV1(right));
}

function mutationContextRevisionsEqual(left: ContextRevisionV1, right: ContextRevisionV1): boolean {
	const semanticProjection = (revision: ContextRevisionV1) => ({
		...revision,
		index: {
			sessionId: revision.index.sessionId,
			ramGeneration: revision.index.ramGeneration,
		},
	});
	return canonicalJsonV1(toJsonValueV1(semanticProjection(left)))
		=== canonicalJsonV1(toJsonValueV1(semanticProjection(right)));
}

function previewFailure(
	requestId: string,
	code: StructuredErrorCodeV1,
	reason: string,
	retryable: boolean = false,
	details?: StructuredErrorV1['details'],
): MutationPreviewResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'mutation-preview-result',
		ok: false,
		warnings: [],
		error: structuredError(code, reason, retryable, details),
	};
}

function previewDeadlineFailure(
	requestId: string,
	deadlineAtMs: number | undefined,
): MutationPreviewResultV1 | null {
	if (deadlineAtMs === undefined || deadlineAtMs > Date.now()) return null;
	return previewFailure(
		requestId,
		'live-settling',
		'The mutation preview deadline elapsed before a verified plan was available.',
		true,
	);
}

function mutationFailure(
	requestId: string,
	code: StructuredErrorCodeV1,
	reason: string,
	retryable: boolean = false,
): MutationResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'mutation-result',
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: retryable,
		groupResults: [],
		error: structuredError(code, reason, retryable),
	};
}

function verifiedPostflightV1(
	contextRevision: ContextRevisionV1,
	observedAt: string,
): NonNullable<MutationResultV1['postflight']> {
	return {
		status: 'verified',
		observedAt,
		contextRevision,
	};
}

function structuredError(
	code: StructuredErrorCodeV1,
	reason: string,
	retryable: boolean,
	details?: StructuredErrorV1['details'],
): StructuredErrorV1 {
	return structuredErrorV1(code, reason, {
		retryable,
		...(details ? { details } : {}),
	});
}

function readRequestId(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid-request';
	try {
		const requestId = (value as Record<string, unknown>).requestId;
		return typeof requestId === 'string' && requestId ? requestId : 'invalid-request';
	} catch {
		return 'invalid-request';
	}
}
