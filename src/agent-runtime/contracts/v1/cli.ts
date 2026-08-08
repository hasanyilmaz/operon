import {
	MUTATION_CAPABILITY_MAP_V1,
	type CapabilityAdvertisementV1,
	type CapabilityIdV1,
} from './capabilities';
import type { CatalogRequestV1, OperonCatalogV1 } from './catalog';
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
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from './context';
import type { RuntimeDiagnosticsV1, RuntimeHealthV1 } from './lifecycle';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationResultV1,
} from './mutation';
import type { TimerReadRequestV1, TimerReadResultV1 } from './timer';
import type {
	CompatibilityOfferV1,
	CompatibilitySelectionV1,
	ContractWarningV1,
	StructuredErrorV1,
} from './primitives';
import { CONTRACT_VERSION_V1 } from './primitives';

export const CLI_CONTRACT_VERSION_V1 = 1 as const;
export const CLI_DEFAULT_READINESS_TIMEOUT_MS_V1 = 15_000;
export const CLI_MAX_READINESS_TIMEOUT_MS_V1 = 30_000;

export const CLI_COMMANDS_V1 = [
	'health',
	'capabilities',
	'diagnostics',
	'catalog',
	'entity.resolve',
	'task.get',
	'tasks.query',
	'tasks.filter-query',
	'tasks.finder',
	'relationships.get',
	'context.build',
	'timers.read',
	'mutation.preview',
	'mutation.apply',
] as const;

export type CliCommandV1 = typeof CLI_COMMANDS_V1[number];

export const CLI_FAILURE_STAGES_V1 = [
	'client-input',
	'transport',
	'vault',
	'compatibility',
	'readiness',
	'capability',
	'runtime',
	'internal',
] as const;

export type CliFailureStageV1 = typeof CLI_FAILURE_STAGES_V1[number];

export const CLI_EXIT_CODES_V1 = Object.freeze({
	success: 0,
	usage: 2,
	unavailable: 3,
	refused: 4,
	runtimeFailure: 5,
	internal: 70,
} as const);

export const CLI_COMMAND_CAPABILITY_V1: Readonly<Partial<Record<CliCommandV1, CapabilityIdV1>>> = Object.freeze({
	health: 'system.health',
	capabilities: 'system.capabilities',
	diagnostics: 'system.diagnostics',
	catalog: 'catalog.read',
	'entity.resolve': 'entities.resolve',
	'task.get': 'tasks.read',
	'tasks.query': 'tasks.query',
	'tasks.filter-query': 'tasks.filter-query',
	'tasks.finder': 'tasks.finder',
	'relationships.get': 'relationships.read',
	'context.build': 'context.build',
	'timers.read': 'timers.read',
});

export const CLI_COMMAND_HANDLER_V1: Readonly<Record<CliCommandV1, string>> = Object.freeze({
	health: 'operon:health',
	capabilities: 'operon:capabilities',
	diagnostics: 'operon:diagnostics',
	catalog: 'operon:catalog',
	'entity.resolve': 'operon:entity-resolve',
	'task.get': 'operon:task-get',
	'tasks.query': 'operon:query',
	'tasks.filter-query': 'operon:filter-query',
	'tasks.finder': 'operon:task-finder',
	'relationships.get': 'operon:relationships',
	'context.build': 'operon:context',
	'timers.read': 'operon:timers-read',
	'mutation.preview': 'operon:mutation-preview',
	'mutation.apply': 'operon:mutation-apply',
});

export type CliRuntimeRequestV1 =
	| CatalogRequestV1
	| EntityResolveRequestV1
	| TaskGetRequestV1
	| TaskQueryRequestV1
	| TaskFilterQueryRequestV1
	| TaskFinderRequestV1
	| RelationshipRequestV1
	| ContextRequestV1
	| TimerReadRequestV1
	| MutationPreviewRequestV1
	| MutationApplyRequestV1;

export type CliRuntimeResultV1 =
	| RuntimeHealthV1
	| RuntimeDiagnosticsV1
	| CapabilityAdvertisementV1[]
	| OperonCatalogV1
	| EntityResolutionResultV1
	| TaskGetResultV1
	| TaskQueryResultV1
	| TaskFilterQueryResultV1
	| TaskFinderResultV1
	| RelationshipResultV1
	| ContextPackV1
	| TimerReadResultV1
	| MutationPreviewResultV1
	| MutationResultV1;

export interface CliInvocationV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	kind: 'cli-invocation';
	requestId: string;
	command: CliCommandV1;
	mode: 'live';
	clientVersion: string;
	compatibility: CompatibilityOfferV1;
	cliContract: { min: 1; max: 1 };
	expectedVaultSha256: string;
	readinessTimeoutMs: number;
	request?: CliRuntimeRequestV1;
}

export interface CliRuntimeMetadataV1 {
	appVersion: string;
	plugin: {
		id: 'operon';
		version: string;
		minAppVersion: string;
	};
	apiVersion: 1;
}

export interface CliTransportSummaryV1 {
	channel: 'request-file';
	inputBytes: number;
}

export interface CliTimingV1 {
	handlerMs: number;
	totalMs?: number;
}

export interface CliFailureV1 {
	stage: CliFailureStageV1;
	error: StructuredErrorV1;
}

export interface CliRecoveryV1 {
	required: true;
	planRef: string;
	action: 'recover-same-plan';
	mutationMayHaveApplied: true;
}

export interface CliClientErrorEnvelopeV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	kind: 'cli-client-error';
	ok: false;
	error: StructuredErrorV1;
}

interface CliResultEnvelopeBaseV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	kind: 'cli-result';
	requestId: string;
	command: CliCommandV1;
	transport: CliTransportSummaryV1;
	vaultIdentity: {
		expectedMatch: boolean | null;
	};
	compatibility?: CompatibilitySelectionV1;
	cliContract?: 1;
	runtime?: CliRuntimeMetadataV1;
	timing: CliTimingV1;
	warnings: ContractWarningV1[];
	client?: {
		profile?: string;
		planRef?: string;
	};
	recovery?: CliRecoveryV1;
}

export type CliResultEnvelopeV1 = CliResultEnvelopeBaseV1 & (
	| {
		ok: true;
		vaultIdentity: { expectedMatch: true };
		compatibility: CompatibilitySelectionV1 & { compatible: true };
		cliContract: 1;
		runtime: CliRuntimeMetadataV1;
		result: CliRuntimeResultV1;
		failure?: never;
	}
	| {
		ok: false;
		result?: never;
		failure: CliFailureV1;
	}
);

export function isCliCommandV1(value: string): value is CliCommandV1 {
	return (CLI_COMMANDS_V1 as readonly string[]).includes(value);
}

export function resolveCliInvocationCapabilityV1(
	invocation: Pick<CliInvocationV1, 'command' | 'request'>,
): CapabilityIdV1 | undefined {
	if (
		invocation.command === 'mutation.preview'
		&& invocation.request?.kind === 'mutation-preview'
	) {
		return MUTATION_CAPABILITY_MAP_V1[invocation.request.mutationKind].preview;
	}
	if (
		invocation.command === 'mutation.apply'
		&& invocation.request?.kind === 'mutation-apply'
	) {
		return MUTATION_CAPABILITY_MAP_V1[invocation.request.plan.mutationKind].apply;
	}
	return CLI_COMMAND_CAPABILITY_V1[invocation.command];
}

export function cliRequestKindForCommandV1(command: CliCommandV1): CliRuntimeRequestV1['kind'] | undefined {
	switch (command) {
		case 'health':
		case 'capabilities':
		case 'diagnostics':
			return undefined;
		case 'catalog':
			return 'catalog';
		case 'entity.resolve':
			return 'entity-resolve';
		case 'task.get':
			return 'task-get';
		case 'tasks.query':
			return 'task-query';
		case 'tasks.filter-query':
			return 'task-filter-query';
		case 'tasks.finder':
			return 'task-finder';
		case 'relationships.get':
			return 'relationship';
		case 'context.build':
			return 'context';
		case 'timers.read':
			return 'timer-read';
		case 'mutation.preview':
			return 'mutation-preview';
		case 'mutation.apply':
			return 'mutation-apply';
	}
}

export function cliResultKindForCommandV1(command: CliCommandV1): string | undefined {
	switch (command) {
		case 'health':
		case 'capabilities':
			return undefined;
		case 'diagnostics':
			return 'runtime-diagnostics';
		case 'catalog':
			return 'catalog-result';
		case 'entity.resolve':
			return 'entity-resolution-result';
		case 'task.get':
			return 'task-get-result';
		case 'tasks.query':
			return 'task-query-result';
		case 'tasks.filter-query':
			return 'task-filter-query-result';
		case 'tasks.finder':
			return 'task-finder-result';
		case 'relationships.get':
			return 'relationship-result';
		case 'context.build':
			return 'context-pack';
		case 'timers.read':
			return 'timer-read-result';
		case 'mutation.preview':
			return 'mutation-preview-result';
		case 'mutation.apply':
			return 'mutation-result';
	}
}
