import type {
	ContextHydrationKeyV1,
	TaskContextV1,
	TaskQueryPageV1,
} from '../../contracts/v1/context';
import type { ContextRevisionV1, InlineTaskSourceLocatorV1 } from '../../contracts/v1/identity';
import type {
	MutationAcknowledgementV1,
	MutationAuthorizationV1,
	SealedMutationPlanV1,
	CreateTaskItemV1,
	CreateTaskSpecV1,
	SealedCreateEffectV1,
	AtomicGroupResultV1,
	MutationAmbiguitySourceV1,
	MutationPostflightV1,
	MutationResultStatusV1,
} from '../../contracts/v1/mutation';
import type {
	ConsistencyV1,
	CompatibilityOfferV1,
	ContractWarningV1,
	FreshnessV1,
	ProvenanceV1,
	StructuredErrorV1,
	TruncationV1,
} from '../../contracts/v1/primitives';

export const TASK_WORKFLOW_CAPABILITY_IDS_V1 = [
	'tasks.filter-query',
	'tasks.create.identity-placeholders',
	'tasks.adopt.preview',
	'tasks.adopt.apply',
] as const;

export type TaskWorkflowCapabilityIdV1 = typeof TASK_WORKFLOW_CAPABILITY_IDS_V1[number];
export type TaskWorkflowMutationKindV1 = 'task.adopt' | 'task.create';
export type IdentityPlaceholderPolicyV1 = 'resolve-operon-id-v1';

export const TASK_WORKFLOW_CAPABILITY_REGISTRY_V1 = Object.freeze([
	Object.freeze({ id: 'tasks.filter-query' as const, mode: 'read' as const, destructive: false }),
	Object.freeze({ id: 'tasks.create.identity-placeholders' as const, mode: 'preview' as const, destructive: false }),
	Object.freeze({ id: 'tasks.adopt.preview' as const, mode: 'preview' as const, mutationKind: 'task.adopt' as const, destructive: false }),
	Object.freeze({ id: 'tasks.adopt.apply' as const, mode: 'apply' as const, mutationKind: 'task.adopt' as const, destructive: false }),
]);

export function isTaskWorkflowCapabilityIdV1(value: string): value is TaskWorkflowCapabilityIdV1 {
	return (TASK_WORKFLOW_CAPABILITY_IDS_V1 as readonly string[]).includes(value);
}

export interface TaskFilterQueryScopeV1 {
	kind: 'exact-file' | 'folder-tree';
	path: string;
}

export interface TaskFilterQueryRequestV1 {
	contractVersion: 1;
	requestId: string;
	kind: 'task-filter-query';
	consistency: ConsistencyV1;
	filterSetId: string;
	scope?: TaskFilterQueryScopeV1;
	include?: ContextHydrationKeyV1[];
	limit?: number;
	cursor?: string;
}

type TaskFilterQueryResultBaseV1 = {
	contractVersion: 1;
	requestId: string;
	kind: 'task-filter-query-result';
	ok: boolean;
	freshness: FreshnessV1;
	warnings: ContractWarningV1[];
};

export type TaskFilterQueryResultV1 = TaskFilterQueryResultBaseV1 & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		tasks: TaskContextV1[];
		page: TaskQueryPageV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		tasks?: never;
		page?: never;
		provenance?: never;
		truncations?: never;
	}
);

export interface AdoptTaskPreviewIntentV1 {
	operation: 'adopt-inline';
	source: {
		filePath: string;
		lineNumber: number;
		expectedLine: string;
	};
	statusId?: string;
	terminalSourcePolicy?: 'reopen';
	operonId?: never;
	resolvedStatusId?: never;
	resultingLine?: never;
	sourceDigest?: never;
	resultDigest?: never;
	locator?: never;
}

export interface AdoptTaskSpecV1 {
	operation: 'adopt-inline';
	source: AdoptTaskPreviewIntentV1['source'];
	statusId?: string;
	terminalSourcePolicy?: 'reopen';
	operonId: string;
	resolvedStatusId?: string;
	resultingLine: string;
	sourceDigest: string;
	resultDigest: string;
	locator: InlineTaskSourceLocatorV1;
}

export type IdentityPlaceholderFileTargetV1 =
	| {
		representation: 'file';
		mode: 'configured-default';
		filePath?: never;
		templateId?: string;
		identityPlaceholderPolicy: IdentityPlaceholderPolicyV1;
	}
	| {
		representation: 'file';
		mode: 'exact-path';
		filePath: string;
		templateId?: string;
		identityPlaceholderPolicy: IdentityPlaceholderPolicyV1;
	};

export type IdentityPlaceholderCreateItemV1 = Omit<CreateTaskItemV1, 'target'> & {
	target: IdentityPlaceholderFileTargetV1;
};

export type IdentityPlaceholderCreateSpecV1 = Omit<CreateTaskSpecV1, 'items'> & {
	items: IdentityPlaceholderCreateItemV1[];
};

export interface TemplateIdentityAllocationV1 {
	occurrence: number;
	suffix?: string;
	operonId: string;
}

export type IdentityPlaceholderSealedCreateEffectV1 = SealedCreateEffectV1 & {
	templateIdentityAllocations: TemplateIdentityAllocationV1[];
};

type TaskWorkflowPlanBaseV1 = Omit<
	SealedMutationPlanV1,
	'capability' | 'mutationKind' | 'spec' | 'createEffects'
>;

export type AdoptTaskSealedPlanV1 = TaskWorkflowPlanBaseV1 & {
	capability: 'tasks.adopt.preview';
	mutationKind: 'task.adopt';
	spec: AdoptTaskSpecV1;
	createEffects?: never;
};

export type IdentityPlaceholderSealedPlanV1 = TaskWorkflowPlanBaseV1 & {
	capability: 'tasks.create.identity-placeholders';
	mutationKind: 'task.create';
	spec: IdentityPlaceholderCreateSpecV1;
	createEffects: IdentityPlaceholderSealedCreateEffectV1[];
};

export type TaskWorkflowSealedPlanV1 = AdoptTaskSealedPlanV1 | IdentityPlaceholderSealedPlanV1;

export type TaskWorkflowPreviewRequestV1 =
	| {
		contractVersion: 1;
		requestId: string;
		kind: 'mutation-preview';
		clientInstanceId: string;
		idempotencyKey: string;
		correlationId?: string;
		capability: 'tasks.adopt.preview';
		mutationKind: 'task.adopt';
		target?: never;
		spec: AdoptTaskPreviewIntentV1;
		authorization: MutationAuthorizationV1;
	}
	| {
		contractVersion: 1;
		requestId: string;
		kind: 'mutation-preview';
		clientInstanceId: string;
		idempotencyKey: string;
		correlationId?: string;
		capability: 'tasks.create.identity-placeholders';
		mutationKind: 'task.create';
		target?: never;
		spec: IdentityPlaceholderCreateSpecV1;
		authorization: MutationAuthorizationV1;
	};

export interface TaskWorkflowApplyRequestV1 {
	contractVersion: 1;
	requestId: string;
	kind: 'mutation-apply';
	plan: TaskWorkflowSealedPlanV1;
	authorization: MutationAuthorizationV1;
	idempotencyKey: string;
	acknowledgements: MutationAcknowledgementV1[];
}

export type TaskWorkflowPreviewResultV1 = {
	contractVersion: 1;
	requestId: string;
	kind: 'mutation-preview-result';
	warnings: ContractWarningV1[];
} & (
	| { ok: true; plan: TaskWorkflowSealedPlanV1; error?: never }
	| { ok: false; plan?: never; error: StructuredErrorV1 }
);

export interface TaskWorkflowMutationReceiptV1 {
	contractVersion: 1;
	vaultIdentityHash: string;
	clientInstanceId: string;
	idempotencyKeyHash: string;
	planHash: string;
	mutationKind: 'task.adopt' | 'task.create';
	targetDigest: string;
	terminalOutcome: 'applied' | 'already-applied' | 'outcome-unknown';
	effectiveAt: string;
	completedAt: string;
	expiresAt: string;
}

export interface TaskWorkflowMutationResultV1 {
	contractVersion: 1;
	requestId: string;
	kind: 'mutation-result';
	status: MutationResultStatusV1;
	mutationMayHaveApplied: boolean;
	retryAllowed: boolean;
	groupResults: AtomicGroupResultV1[];
	continuation?: {
		originPlanHash: string;
		remainingGroupIds: string[];
		plan: TaskWorkflowSealedPlanV1;
	};
	ambiguitySource?: MutationAmbiguitySourceV1;
	receipt?: TaskWorkflowMutationReceiptV1;
	postflight?: MutationPostflightV1;
	error?: StructuredErrorV1;
}

export interface TaskWorkflowCliInvocationBaseV1 {
	contractVersion: 1;
	kind: 'cli-invocation';
	requestId: string;
	mode: 'live';
	clientVersion: string;
	compatibility: CompatibilityOfferV1;
	cliContract: { min: 1; max: 1 };
	expectedVaultSha256: string;
	readinessTimeoutMs: number;
}

export type TaskWorkflowCliInvocationV1 = TaskWorkflowCliInvocationBaseV1 & (
	| { command: 'tasks.filter-query'; request: TaskFilterQueryRequestV1 }
	| { command: 'mutation.preview'; request: TaskWorkflowPreviewRequestV1 }
	| { command: 'mutation.apply'; request: TaskWorkflowApplyRequestV1 }
);

export type TaskWorkflowCliResultEnvelopeV1 = {
	contractVersion: 1;
	kind: 'cli-result';
	requestId: string;
	command: 'tasks.filter-query' | 'mutation.preview' | 'mutation.apply';
	transport: { channel: 'request-file'; inputBytes: number };
	vaultIdentity: { expectedMatch: boolean | null };
	compatibility?: { contractVersion: 1; compatible: boolean; runtimeApi?: 1 };
	cliContract?: 1;
	runtime?: { appVersion: string; plugin: { id: 'operon'; version: string; minAppVersion: string }; apiVersion: 1 };
	timing: { handlerMs: number; totalMs?: number };
	warnings: ContractWarningV1[];
	client?: { profile?: string; planRef?: string };
	recovery?: { required: true; planRef: string; action: 'recover-same-plan'; mutationMayHaveApplied: true };
} & (
	| {
		ok: true;
		vaultIdentity: { expectedMatch: true };
		compatibility: { contractVersion: 1; compatible: true; runtimeApi: 1 };
		cliContract: 1;
		runtime: { appVersion: string; plugin: { id: 'operon'; version: string; minAppVersion: string }; apiVersion: 1 };
		result: TaskFilterQueryResultV1 | TaskWorkflowPreviewResultV1 | TaskWorkflowMutationResultV1;
		failure?: never;
	}
	| {
		ok: false;
		result?: never;
		failure: {
			stage: 'client-input' | 'transport' | 'vault' | 'compatibility' | 'readiness' | 'capability' | 'runtime' | 'internal';
			error: StructuredErrorV1;
		};
	}
);
