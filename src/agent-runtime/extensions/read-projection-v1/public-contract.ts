import type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
} from '../../contracts/v1/context';
import type { RuntimeDiagnosticsV1 } from '../../contracts/v1/lifecycle';
import type { StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../../contracts/v1/timer';
import type { DeepReadonlyV1, OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import {
	READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1,
	type ReadProjectionDeveloperCapabilityIdV1,
} from './contracts';

export type ReadProjectionDeveloperAccessCapabilityV1 = ReadProjectionDeveloperCapabilityIdV1;

type OrderedCapabilitySubsetsV1<T extends readonly ReadProjectionDeveloperAccessCapabilityV1[]> =
	T extends readonly [
		infer Head extends ReadProjectionDeveloperAccessCapabilityV1,
		...infer Tail extends readonly ReadProjectionDeveloperAccessCapabilityV1[],
	]
		? OrderedCapabilitySubsetsV1<Tail> | readonly [Head, ...OrderedCapabilitySubsetsV1<Tail>]
		: readonly [];

export type ReadProjectionDeveloperCapabilitySubsetV1 = Exclude<
	OrderedCapabilitySubsetsV1<typeof READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1>,
	readonly []
>;

export interface ReadProjectionDeveloperApiAccessRequestV1<
	TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
> {
	readonly contractVersion: 1;
	readonly runtimeApi: Readonly<{ readonly min: number; readonly max: number }>;
	readonly requestedCapabilities: TCapabilities;
}

type IncludesCapabilityV1<
	TCapabilities extends readonly ReadProjectionDeveloperAccessCapabilityV1[],
	TCapability extends ReadProjectionDeveloperAccessCapabilityV1,
> = TCapability extends TCapabilities[number] ? true : false;

type ProjectedGroupV1<TEnabled extends boolean, TMethods> = TEnabled extends true
	? Readonly<TMethods>
	: Readonly<Record<never, never>>;

export type OperonReadProjectionDeveloperApiV1<
	TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
> = Readonly<{
	readonly contractVersion: 1;
	readonly runtimeApi: 1;
	readonly hasCapability: (capability: string) => boolean;
	readonly system: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.system.diagnostics'>, { readonly diagnostics: () => Promise<DeepReadonlyV1<RuntimeDiagnosticsV1>> }>;
	readonly tasks: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.tasks.finder'>, { readonly find: (request: DeepReadonlyV1<TaskFinderRequestV1>) => Promise<DeepReadonlyV1<TaskFinderResultV1>> }>;
	readonly entities: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.entities.resolve'>, { readonly resolve: (request: DeepReadonlyV1<EntityResolveRequestV1>) => Promise<DeepReadonlyV1<EntityResolutionResultV1>> }>;
	readonly relationships: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.relationships.read'>, { readonly get: (request: DeepReadonlyV1<RelationshipRequestV1>) => Promise<DeepReadonlyV1<RelationshipResultV1>> }>;
	readonly context: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.context.build'>, { readonly build: (request: DeepReadonlyV1<ContextRequestV1>) => Promise<DeepReadonlyV1<ContextPackV1>> }>;
	readonly timers: ProjectedGroupV1<IncludesCapabilityV1<TCapabilities, 'read-projection.timers.read'>, { readonly read: (request: DeepReadonlyV1<TimerReadRequestV1>) => Promise<DeepReadonlyV1<TimerReadResultV1>> }>;
}>;

export type ReadProjectionDeveloperApiAccessResultV1<
	TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
> = Readonly<{
	readonly contractVersion: 1;
	readonly kind: 'read-projection-developer-api-access-result';
} & (
	| Readonly<{ readonly ok: true; readonly api: OperonReadProjectionDeveloperApiV1<TCapabilities>; readonly error?: never }>
	| Readonly<{ readonly ok: false; readonly error: DeepReadonlyV1<StructuredErrorV1>; readonly api?: never }>
)>;

export interface OperonReadProjectionDeveloperApiAccessorV1 {
	getReadProjectionDeveloperApiV1<
		TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
	>(
		consumerPlugin: OperonDeveloperApiConsumerPluginV1,
		request: ReadProjectionDeveloperApiAccessRequestV1<TCapabilities>,
	): ReadProjectionDeveloperApiAccessResultV1<TCapabilities>;
}
