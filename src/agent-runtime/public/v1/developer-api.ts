import type { CapabilityAdvertisementV1, CapabilityIdV1, MutationKindV1 } from '../../contracts/v1/capabilities';
import type { CatalogRequestV1, OperonCatalogV1 } from '../../contracts/v1/catalog';
import type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from '../../contracts/v1/context';
import type { RuntimeDiagnosticsV1, RuntimeHealthV1, RuntimeLifecyclePhaseV1 } from '../../contracts/v1/lifecycle';
import type {
	AtomicGroupResultV1,
	AdoptTaskPreviewIntentV1,
	ConvertTaskSpecV1,
	CreateTaskSpecV1,
	DeleteTaskSpecV1,
	ExactMutationTargetV1,
	MutationPostflightV1,
	PredictedEffectV1,
	PinnedTaskStateSpecV1,
	RelocateInlineTaskPreviewIntentV1,
	RelocateInlineTaskSpecV1,
	ReminderItemSpecV1,
	ReplaceTaskRelationshipsSpecV1,
	RiskLevelV1,
	TimerControlSpecV1,
	TimerSessionSpecV1,
	TransitionTaskSpecV1,
	UpdateTaskBatchSpecV1,
	UpdateTaskRecurrenceSpecV1,
	UpdateTaskSpecV1,
} from '../../contracts/v1/mutation';
import type {
	CompatibilityRangeV1,
	ContractWarningV1,
	StructuredErrorV1,
} from '../../contracts/v1/primitives';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../../contracts/v1/timer';

export type { AtomicGroupResultV1 } from '../../contracts/v1/mutation';

/**
 * Public DTOs are immutable snapshots. This utility is intentionally exported
 * so consumer wrappers can preserve that boundary in their own types.
 */
export type DeepReadonlyV1<T> =
	T extends (...args: never[]) => unknown
		? T
		: T extends readonly (infer Item)[]
			? readonly DeepReadonlyV1<Item>[]
			: T extends object
				? { readonly [Key in keyof T]: DeepReadonlyV1<T[Key]> }
				: T;

export type DeveloperApiChannelAvailabilityV1 = 'available' | 'degraded' | 'unavailable';

export type DeveloperApiChannelReasonV1 =
	| 'ready'
	| 'booting'
	| 'cache-ready'
	| 'settling'
	| 'unloading'
	| 'terminal-startup-failure'
	| 'accessor-unavailable'
	| 'unsupported-platform'
	| 'unsupported-version';

export type DeveloperApiAuthorityStateV1 = 'read-only' | 'granted' | 'revoked';

/**
 * Structural view of an Obsidian plugin instance. Operon verifies the object
 * against the live host registry; these caller-readable fields are metadata,
 * never identity evidence on their own.
 */
export interface OperonDeveloperApiConsumerPluginV1 {
	readonly manifest: Readonly<{
		readonly id: string;
		readonly name: string;
		readonly version: string;
	}>;
}

export interface DeveloperApiConsumerSummaryV1 {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly instanceEpoch: string;
}

export type DeveloperApiGrantStateV1 = 'pending' | 'active' | 'suspended' | 'revoked';

export interface DeveloperApiGrantSummaryV1 {
	readonly state: DeveloperApiGrantStateV1;
	readonly revision: number;
	readonly requestedCapabilities: readonly CapabilityIdV1[];
	readonly grantedCapabilities: readonly CapabilityIdV1[];
	readonly effectiveCapabilities: readonly CapabilityIdV1[];
}

export interface DeveloperApiChannelStatusV1 {
	readonly contractVersion: 1;
	readonly kind: 'developer-api-channel-status';
	readonly runtimeApiVersion: 1;
	readonly availability: DeveloperApiChannelAvailabilityV1;
	readonly reason: DeveloperApiChannelReasonV1;
	readonly lifecyclePhase?: RuntimeLifecyclePhaseV1;
	readonly authority: DeveloperApiAuthorityStateV1;
	readonly consumer?: DeveloperApiConsumerSummaryV1;
	readonly grant?: DeveloperApiGrantSummaryV1;
	readonly admission: Readonly<{
		reads: boolean;
		writes: boolean;
	}>;
	readonly capabilities: readonly CapabilityAdvertisementV1[];
	readonly retryAfterMs?: number;
	readonly error?: StructuredErrorV1;
}

/**
 * The host derives consumer identity. The caller can request capabilities but
 * cannot supply an identity, authority claim, consent proof, or grant token.
 */
export interface OperonDeveloperApiAccessRequestV1 {
	readonly contractVersion: 1;
	readonly runtimeApi: Readonly<CompatibilityRangeV1>;
	readonly requestedCapabilities: readonly CapabilityIdV1[];
}

export type OperonDeveloperApiAccessResultV1 =
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-api-access-result';
		ok: true;
		status: DeveloperApiChannelStatusV1;
		api: OperonDeveloperApiV1;
	}>
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-api-access-result';
		ok: false;
		status: DeveloperApiChannelStatusV1;
		error: StructuredErrorV1;
	}>;

export interface OperonDeveloperApiAccessorV1 {
	readonly getDeveloperApiV1: (
		consumerPlugin: OperonDeveloperApiConsumerPluginV1,
		request: OperonDeveloperApiAccessRequestV1,
	) => OperonDeveloperApiAccessResultV1;
}

export interface DeveloperApiChannelV1 {
	readonly status: () => DeveloperApiChannelStatusV1;
}

export interface DeveloperApiSystemV1 {
	readonly health: () => Promise<DeepReadonlyV1<RuntimeHealthV1>>;
	readonly capabilities: () => readonly CapabilityAdvertisementV1[];
	readonly diagnostics: () => Promise<DeepReadonlyV1<RuntimeDiagnosticsV1>>;
}

export interface DeveloperApiCatalogV1 {
	readonly snapshot: (
		request?: DeepReadonlyV1<CatalogRequestV1>,
	) => Promise<DeepReadonlyV1<OperonCatalogV1>>;
}

export interface DeveloperApiEntitiesV1 {
	readonly resolve: (
		request: DeepReadonlyV1<EntityResolveRequestV1>,
	) => Promise<DeepReadonlyV1<EntityResolutionResultV1>>;
}

export interface DeveloperApiTasksV1 {
	readonly get: (
		request: DeepReadonlyV1<TaskGetRequestV1>,
	) => Promise<DeepReadonlyV1<TaskGetResultV1>>;
	readonly query: (
		request: DeepReadonlyV1<TaskQueryRequestV1>,
	) => Promise<DeepReadonlyV1<TaskQueryResultV1>>;
	readonly filterQuery: (
		request: DeepReadonlyV1<TaskFilterQueryRequestV1>,
	) => Promise<DeepReadonlyV1<TaskFilterQueryResultV1>>;
	readonly find: (
		request: DeepReadonlyV1<TaskFinderRequestV1>,
	) => Promise<DeepReadonlyV1<TaskFinderResultV1>>;
}

export interface DeveloperApiRelationshipsV1 {
	readonly get: (
		request: DeepReadonlyV1<RelationshipRequestV1>,
	) => Promise<DeepReadonlyV1<RelationshipResultV1>>;
}

export interface DeveloperApiContextV1 {
	readonly build: (
		request: DeepReadonlyV1<ContextRequestV1>,
	) => Promise<DeepReadonlyV1<ContextPackV1>>;
}

export interface DeveloperApiTimersV1 {
	readonly read: (
		request: DeepReadonlyV1<TimerReadRequestV1>,
	) => Promise<DeepReadonlyV1<TimerReadResultV1>>;
}

/**
 * Channel-safe preview intent. Correlation, request, consumer, authorization,
 * consent, acknowledgement, plan-store and idempotency state are host-owned.
 */
type DeveloperTargetedMutationPreviewInputV1<
	Kind extends MutationKindV1,
	Capability extends CapabilityIdV1,
	Spec,
> = Readonly<{
	capability: Capability;
	mutationKind: Kind;
	target: DeepReadonlyV1<ExactMutationTargetV1>;
	spec: DeepReadonlyV1<Spec>;
}>;

/**
 * Each public preview intent binds an exact mutation kind, preview capability,
 * target policy and spec. This prevents a consumer from compiling a mismatched
 * capability/spec pair and mirrors the closed JSON Schema admission boundary.
 */
export type DeveloperMutationPreviewInputV1 =
	| Readonly<{
		capability: 'tasks.create.preview';
		mutationKind: 'task.create';
		target?: never;
		spec: DeepReadonlyV1<CreateTaskSpecV1>;
	}>
	| Readonly<{
		capability: 'tasks.adopt.preview';
		mutationKind: 'task.adopt';
		target?: never;
		spec: DeepReadonlyV1<AdoptTaskPreviewIntentV1>;
	}>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.update',
		'tasks.update.preview',
		UpdateTaskSpecV1
	>
	| Readonly<{
		capability: 'tasks.update.preview';
		mutationKind: 'task.update';
		target?: never;
		spec: DeepReadonlyV1<UpdateTaskBatchSpecV1>;
	}>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.recurrence',
		'tasks.recurrence.preview',
		UpdateTaskRecurrenceSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.relationship',
		'tasks.relationship.preview',
		ReplaceTaskRelationshipsSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.reminder-item',
		'tasks.reminder.preview',
		ReminderItemSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.transition',
		'tasks.transition.preview',
		TransitionTaskSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.pinned-state',
		'tasks.pinned.preview',
		PinnedTaskStateSpecV1
	>
	| Readonly<{
		capability: 'timers.control.preview';
		mutationKind: 'timer.control';
		target?: DeepReadonlyV1<ExactMutationTargetV1>;
		spec: DeepReadonlyV1<TimerControlSpecV1>;
	}>
	| DeveloperTargetedMutationPreviewInputV1<
		'timer.session',
		'timers.session.preview',
		TimerSessionSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.convert',
		'tasks.convert.preview',
		ConvertTaskSpecV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.inline-relocate',
		'tasks.inline.relocate.preview',
		RelocateInlineTaskSpecV1 | RelocateInlineTaskPreviewIntentV1
	>
	| DeveloperTargetedMutationPreviewInputV1<
		'task.delete',
		'tasks.delete.preview',
		DeleteTaskSpecV1
	>;

declare const developerMutationPlanHandleBrandV1: unique symbol;

/**
 * Opaque plan returned only by this Developer API session. The handle itself is
 * session-bound; its recoveryRef can resume only a durably dispatched plan for
 * the same host-verified consumer after restart.
 */
export interface DeveloperMutationPlanHandleV1 {
	readonly [developerMutationPlanHandleBrandV1]: 'operon-developer-mutation-plan-v1';
	readonly contractVersion: 1;
	readonly kind: 'developer-mutation-plan';
	readonly recoveryRef: string;
	readonly planDigest: string;
	readonly capability: CapabilityIdV1;
	readonly mutationKind: MutationKindV1;
	readonly createdAt: string;
	readonly expiresAt: string;
	readonly riskLevel: RiskLevelV1;
	readonly requiresConsent: boolean;
	readonly targets: readonly DeepReadonlyV1<ExactMutationTargetV1>[];
	readonly predictedEffects: readonly DeepReadonlyV1<PredictedEffectV1>[];
	readonly warnings: readonly ContractWarningV1[];
}

export type DeveloperMutationPreviewResultV1 =
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-mutation-preview-result';
		requestId: string;
		ok: true;
		plan: DeveloperMutationPlanHandleV1;
		warnings: readonly ContractWarningV1[];
	}>
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-mutation-preview-result';
		requestId: string;
		ok: false;
		error: StructuredErrorV1;
		warnings: readonly ContractWarningV1[];
	}>;

export interface DeveloperMutationApplyInputV1 {
	readonly plan: DeveloperMutationPlanHandleV1;
}

export type DeveloperMutationRecoverInputV1 =
	| Readonly<{ plan: DeveloperMutationPlanHandleV1; recoveryRef?: never }>
	| Readonly<{ recoveryRef: string; plan?: never }>;

export interface DeveloperMutationRecoveryRefV1 {
	readonly recoveryRef: string;
	readonly planDigest: string;
}

export interface DeveloperMutationPendingRecoveryV1
	extends DeveloperMutationRecoveryRefV1 {
	readonly mutationKind: MutationKindV1;
	readonly capability: CapabilityIdV1;
	readonly riskLevel: RiskLevelV1;
	readonly createdAt: string;
	readonly expiresAt: string;
}

export type DeveloperMutationPendingRecoveriesResultV1 =
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-mutation-pending-recoveries-result';
		ok: true;
		recoveries: readonly DeveloperMutationPendingRecoveryV1[];
	}>
	| Readonly<{
		contractVersion: 1;
		kind: 'developer-mutation-pending-recoveries-result';
		ok: false;
		error: StructuredErrorV1;
	}>;

export interface DeveloperMutationReceiptV1 {
	readonly contractVersion: 1;
	readonly planDigest: string;
	readonly mutationKind: MutationKindV1;
	readonly targetDigest: string;
	readonly terminalOutcome: 'applied' | 'already-applied';
	readonly effectiveAt: string;
	readonly completedAt: string;
	readonly expiresAt: string;
}

export interface DeveloperMutationRecoveryV1 {
	readonly required: true;
	readonly action: 'recover-same-plan';
	readonly mutationMayHaveApplied: true;
	readonly recoveryRef: string;
	readonly planDigest: string;
	readonly plan: DeveloperMutationPlanHandleV1;
}

export type DeveloperMutationRecoveryErrorV1 = StructuredErrorV1 & {
	readonly code: 'outcome-unknown';
	readonly retryable: false;
	readonly action: 'recover-same-plan';
};

interface DeveloperMutationExecutionResultBaseV1 {
	readonly contractVersion: 1;
	readonly kind: 'developer-mutation-execution-result';
	readonly requestId: string;
	readonly groupResults: readonly DeepReadonlyV1<AtomicGroupResultV1>[];
}

export type DeveloperMutationExecutionResultV1 =
	DeveloperMutationExecutionResultBaseV1 & (
		| {
			readonly status: 'applied';
			readonly mutationMayHaveApplied: true;
			readonly retryAllowed: false;
			readonly receipt: DeveloperMutationReceiptV1 & { readonly terminalOutcome: 'applied' };
			readonly postflight: DeepReadonlyV1<MutationPostflightV1> & { readonly status: 'verified' };
			readonly error?: never;
			readonly recovery?: never;
		}
		| {
			readonly status: 'already-applied';
			readonly mutationMayHaveApplied: true;
			readonly retryAllowed: false;
			readonly receipt: DeveloperMutationReceiptV1 & { readonly terminalOutcome: 'already-applied' };
			readonly postflight: DeepReadonlyV1<MutationPostflightV1> & { readonly status: 'receipt-replay' };
			readonly error?: never;
			readonly recovery?: never;
		}
		| {
			readonly status: 'failed';
			readonly mutationMayHaveApplied: false;
			readonly retryAllowed: false;
			readonly error: StructuredErrorV1;
			readonly receipt?: never;
			readonly postflight?: never;
			readonly recovery?: never;
		}
		| {
			readonly status: 'partial' | 'outcome-unknown';
			readonly mutationMayHaveApplied: true;
			readonly retryAllowed: false;
			readonly error: DeveloperMutationRecoveryErrorV1;
			readonly recovery: DeveloperMutationRecoveryV1;
			readonly receipt?: never;
			readonly postflight?: never;
		}
	);

export interface DeveloperApiMutationsV1 {
	readonly preview: (
		input: DeveloperMutationPreviewInputV1,
	) => Promise<DeveloperMutationPreviewResultV1>;
	readonly apply: (
		input: DeveloperMutationApplyInputV1,
	) => Promise<DeveloperMutationExecutionResultV1>;
	readonly recover: (
		input: DeveloperMutationRecoverInputV1,
	) => Promise<DeveloperMutationExecutionResultV1>;
	readonly pendingRecoveries: () => Promise<DeveloperMutationPendingRecoveriesResultV1>;
}

export interface OperonDeveloperApiV1 {
	readonly contractVersion: 1;
	readonly runtimeApiVersion: 1;
	readonly sessionId: string;
	readonly hasCapability: (name: string) => boolean;
	readonly channel: DeveloperApiChannelV1;
	readonly system: DeveloperApiSystemV1;
	readonly catalog: DeveloperApiCatalogV1;
	readonly entities: DeveloperApiEntitiesV1;
	readonly tasks: DeveloperApiTasksV1;
	readonly relationships: DeveloperApiRelationshipsV1;
	readonly context: DeveloperApiContextV1;
	readonly timers: DeveloperApiTimersV1;
	readonly mutations: DeveloperApiMutationsV1;
}
