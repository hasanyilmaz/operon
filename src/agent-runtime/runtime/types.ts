import type { CapabilityAdvertisementV1 } from '../contracts/v1/capabilities';
import type { CatalogRequestV1, OperonCatalogV1 } from '../contracts/v1/catalog';
export type { CatalogRequestV1, OperonCatalogV1 } from '../contracts/v1/catalog';
import type { ContextRevisionV1, IndexRevisionV1 } from '../contracts/v1/identity';
import type {
	ConsistencyV1,
	ContractWarningV1,
	StructuredErrorV1,
} from '../contracts/v1/primitives';
import type {
	RuntimeHealthV1,
	RuntimeDiagnosticsV1,
} from '../contracts/v1/lifecycle';
import type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from '../contracts/v1/context';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationResultV1,
} from '../contracts/v1/mutation';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../contracts/v1/timer';
export type { TimerReadRequestV1, TimerReadResultV1 } from '../contracts/v1/timer';
export type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from '../contracts/v1/context';
export type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationResultV1,
} from '../contracts/v1/mutation';
import type {
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskWorkflowApplyRequestV1,
	TaskWorkflowMutationResultV1,
	TaskWorkflowPreviewRequestV1,
	TaskWorkflowPreviewResultV1,
} from '../extensions/task-workflows-v1';
export type { TaskFilterQueryRequestV1, TaskFilterQueryResultV1 } from '../extensions/task-workflows-v1';
import { RUNTIME_API_VERSION_V1 } from '../contracts/v1/lifecycle';
import type { RuntimeTimingSinkV1 } from './timing-probe';

export {
	RUNTIME_API_VERSION_V1,
	RUNTIME_LIFECYCLE_PHASES_V1,
	RUNTIME_RETRY_AFTER_MAX_MS_V1,
	V8_PERSISTENCE_PHASES_V1 as RUNTIME_PERSISTENCE_PHASES_V1,
} from '../contracts/v1/lifecycle';
export type {
	RuntimeHealthV1,
	RuntimeLifecyclePhaseV1,
	V8PersistencePhaseV1 as RuntimePersistencePhaseV1,
} from '../contracts/v1/lifecycle';

export interface RuntimeRevisionSnapshotV1 {
	contextRevision: ContextRevisionV1;
	packageRevision: string;
}

export interface RuntimeSystemFacadeV1 {
	health(): Promise<RuntimeHealthV1>;
	capabilities(): CapabilityAdvertisementV1[];
	diagnostics(): Promise<RuntimeDiagnosticsV1>;
}

/** Transport-owned bounds that never enter the public V1 request schema. */
export interface RuntimeInvocationContextV1 {
	deadlineAtMs?: number;
}

export interface RuntimeCatalogFacadeV1 {
	snapshot(request?: CatalogRequestV1, context?: RuntimeInvocationContextV1): Promise<OperonCatalogV1>;
}

export interface RuntimeEntitiesFacadeV1 {
	resolve(request: EntityResolveRequestV1, context?: RuntimeInvocationContextV1): Promise<EntityResolutionResultV1>;
}

export interface RuntimeTasksFacadeV1 {
	get(request: TaskGetRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskGetResultV1>;
	query(request: TaskQueryRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskQueryResultV1>;
	filterQuery?(request: TaskFilterQueryRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskFilterQueryResultV1>;
	find(request: TaskFinderRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskFinderResultV1>;
}

export interface RuntimeRelationshipsFacadeV1 {
	get(request: RelationshipRequestV1, context?: RuntimeInvocationContextV1): Promise<RelationshipResultV1>;
}

export interface RuntimeContextFacadeV1 {
	build(request: ContextRequestV1, context?: RuntimeInvocationContextV1): Promise<ContextPackV1>;
}

export interface RuntimeMutationsFacadeV1 {
	preview(request: MutationPreviewRequestV1, context?: RuntimeInvocationContextV1): Promise<MutationPreviewResultV1>;
	apply(request: MutationApplyRequestV1): Promise<MutationResultV1>;
	previewTaskWorkflow?(request: TaskWorkflowPreviewRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskWorkflowPreviewResultV1>;
	applyTaskWorkflow?(request: TaskWorkflowApplyRequestV1): Promise<TaskWorkflowMutationResultV1>;
}

export interface RuntimeTimersFacadeV1 {
	read(request: TimerReadRequestV1, context?: RuntimeInvocationContextV1): Promise<TimerReadResultV1>;
}

export interface OperonAgentRuntimeCoreV1 {
	apiVersion: typeof RUNTIME_API_VERSION_V1;
	hasCapability(name: string): boolean;
	system: RuntimeSystemFacadeV1;
	catalog: RuntimeCatalogFacadeV1;
	entities: RuntimeEntitiesFacadeV1;
	tasks: RuntimeTasksFacadeV1;
	relationships: RuntimeRelationshipsFacadeV1;
	context: RuntimeContextFacadeV1;
	timers: RuntimeTimersFacadeV1;
	mutations: RuntimeMutationsFacadeV1;
}

export interface RuntimeAdmissionV1 {
	ok: boolean;
	warnings: ContractWarningV1[];
	error?: StructuredErrorV1;
}

export interface RuntimeReadSuccessV1<T> {
	ok: true;
	value: T;
	revision: RuntimeRevisionSnapshotV1;
	warnings: ContractWarningV1[];
	attempts: 1 | 2;
}

export interface RuntimeReadFailureV1 {
	ok: false;
	error: StructuredErrorV1;
	revision?: RuntimeRevisionSnapshotV1;
	warnings: ContractWarningV1[];
	attempts: 0 | 1 | 2;
}

export type RuntimeReadResultV1<T> = RuntimeReadSuccessV1<T> | RuntimeReadFailureV1;

export interface RuntimeReadRequestV1<T> {
	/** Internal diagnostic correlation only; never serialized into a V1 response. */
	requestId?: string;
	minimumConsistency: ConsistencyV1;
	deadlineAtMs?: number;
	signal?: AbortSignal;
	read(revision: RuntimeRevisionSnapshotV1, signal?: AbortSignal): Promise<T>;
	isRevisionStable?(
		before: RuntimeRevisionSnapshotV1,
		after: RuntimeRevisionSnapshotV1,
	): boolean;
}

export interface RuntimeReadTimingPortsV1 {
	now(): number;
	setTimer(callback: () => void, delayMs: number): unknown;
	clearTimer(handle: unknown): void;
}

export interface RuntimeReadPortsV1 extends RuntimeReadTimingPortsV1 {
	/** Optional development-only timing sink. Production embeddings omit it. */
	timingSink?: RuntimeTimingSinkV1;
	/** Optional monotonic clock used only when the timing sink is enabled. */
	timingNow?: () => number;
	refreshSettings(): Promise<void>;
	settle(requestId?: string): Promise<void>;
	sampleRevision(signal?: AbortSignal): Promise<RuntimeRevisionSnapshotV1> | RuntimeRevisionSnapshotV1;
}

export interface RuntimeRevisionPortsV1 {
	indexRevision(): IndexRevisionV1;
	settingsFingerprint(): string;
	pinnedGeneration(): number;
	activeTrackerGeneration(): number;
	repeatSeriesRevision(): number;
	projectSerialGeneration(): number;
	projectSerialSignature(): string;
	packageRevision(): string;
}
