export const CONTRACT_VERSION_V1 = 1 as const;

export const CONTRACT_LIMITS_V1 = Object.freeze({
	transportInputBytes: 786_432,
	transportResultBytes: 3_145_728,
	requestIdBytes: 128,
	idempotencyKeyBytes: 256,
	cursorCharacters: 4_096,
	jsonObjectKeys: 128,
	errorDetailKeys: 32,
	generalStringBytes: 65_536,
	reasonBytes: 2_048,
	collectionItems: 512,
	createItems: 64,
	createRelationsPerItem: 64,
	planTargets: 128,
	affectedResources: 128,
	atomicGroups: 128,
	predictedEffects: 256,
	acknowledgements: 128,
	warnings: 256,
});

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const IDEMPOTENCY_KEY_PATTERN_V1 = /^[A-Za-z0-9._:-]{16,256}$/;
export const REQUEST_ID_PATTERN_V1 = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const WARNING_CODE_PATTERN_V1 = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type ConsistencyV1 = 'live-verified' | 'best-effort' | 'offline-unverified';
export type CoherenceV1 = 'verified' | 'settling' | 'unverified';
export type FreshnessSourceV1 = 'live-runtime' | 'persisted-index' | 'source-file';

export interface FreshnessV1 {
	source: FreshnessSourceV1;
	coherence: CoherenceV1;
	observedAt: string;
	settled: boolean;
}

export const STRUCTURED_ERROR_CODES_V1 = [
	'invalid-request',
	'unsupported-version',
	'unsupported-platform',
	'incompatible-version',
	'unknown-capability',
	'capability-unavailable',
	'invalid-operon-id',
	'duplicate-operon-id',
	'ambiguous-selector',
	'entity-not-found',
	'invalid-locator',
	'vault-mismatch',
	'stale-source',
	'stale-context',
	'stale-cursor',
	'stale-plan',
	'plan-expired',
	'plan-tampered',
	'confirmation-required',
	'acknowledgement-required',
	'authority-insufficient',
	'consent-denied',
	'audit-unavailable',
	'field-not-writable',
	'needs-template',
	'needs-target',
	'template-processing-required',
	'mutation-kind-mismatch',
	'outcome-unknown',
	'payload-too-large',
	'result-too-large',
	'projection-too-broad',
	'receipt-store-unavailable',
	'transport-unavailable',
	'desktop-unavailable',
	'handler-unavailable',
	'live-settling',
	'internal-error',
] as const;

export type KnownStructuredErrorCodeV1 = typeof STRUCTURED_ERROR_CODES_V1[number];
/**
 * Error identifiers are additive in Runtime API V1. Unknown identifiers must
 * be treated as stop-and-inspect, never as retry or mutation authorization.
 */
export type StructuredErrorCodeV1 = string;

export const ERROR_ACTIONS_V1 = [
	'fix-request',
	'rediscover',
	'refresh-state',
	'wait-and-retry',
	'request-consent',
	'request-authority',
	'narrow-request',
	'upgrade-client',
	'fix-environment',
	'recover-same-plan',
	'do-not-retry',
	'report-bug',
] as const;

export type ErrorActionV1 = typeof ERROR_ACTIONS_V1[number];

export interface StructuredErrorV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	code: StructuredErrorCodeV1;
	reason: string;
	retryable: boolean;
	action: ErrorActionV1;
	details?: Record<string, JsonValue>;
}

export type ErrorExitClassV1 =
	| 'usage'
	| 'unavailable'
	| 'refused'
	| 'runtime-failure'
	| 'internal';

export interface ErrorRegistryEntryV1 {
	readonly code: KnownStructuredErrorCodeV1;
	readonly action: ErrorActionV1;
	readonly retryable: boolean;
	readonly recovery: 'none' | 'same-plan';
	readonly exitClass: ErrorExitClassV1;
}

const ERROR_POLICY_V1: Readonly<Record<KnownStructuredErrorCodeV1, Omit<ErrorRegistryEntryV1, 'code'>>> =
	Object.freeze({
		'invalid-request': policy('fix-request', false, 'none', 'usage'),
		'unsupported-version': policy('upgrade-client', false, 'none', 'refused'),
		'unsupported-platform': policy('fix-environment', false, 'none', 'refused'),
		'incompatible-version': policy('upgrade-client', false, 'none', 'refused'),
		'unknown-capability': policy('rediscover', false, 'none', 'refused'),
		'capability-unavailable': policy('rediscover', false, 'none', 'refused'),
		'invalid-operon-id': policy('fix-request', false, 'none', 'usage'),
		'duplicate-operon-id': policy('narrow-request', false, 'none', 'refused'),
		'ambiguous-selector': policy('narrow-request', false, 'none', 'refused'),
		'entity-not-found': policy('refresh-state', false, 'none', 'refused'),
		'invalid-locator': policy('fix-request', false, 'none', 'usage'),
		'vault-mismatch': policy('fix-environment', false, 'none', 'refused'),
		'stale-source': policy('refresh-state', false, 'none', 'refused'),
		'stale-context': policy('refresh-state', false, 'none', 'refused'),
		'stale-cursor': policy('refresh-state', false, 'none', 'refused'),
		'stale-plan': policy('refresh-state', false, 'none', 'refused'),
		'plan-expired': policy('refresh-state', false, 'none', 'refused'),
		'plan-tampered': policy('do-not-retry', false, 'none', 'refused'),
		'confirmation-required': policy('request-consent', false, 'none', 'refused'),
		'acknowledgement-required': policy('request-consent', false, 'none', 'refused'),
		'authority-insufficient': policy('request-authority', false, 'none', 'refused'),
		'consent-denied': policy('do-not-retry', false, 'none', 'refused'),
		'audit-unavailable': policy('fix-environment', false, 'none', 'refused'),
		'field-not-writable': policy('fix-request', false, 'none', 'refused'),
		'needs-template': policy('fix-request', false, 'none', 'refused'),
		'needs-target': policy('fix-request', false, 'none', 'refused'),
		'template-processing-required': policy('fix-request', false, 'none', 'refused'),
		'mutation-kind-mismatch': policy('fix-request', false, 'none', 'usage'),
		'outcome-unknown': policy('recover-same-plan', false, 'same-plan', 'runtime-failure'),
		'payload-too-large': policy('narrow-request', false, 'none', 'usage'),
		'result-too-large': policy('narrow-request', false, 'none', 'runtime-failure'),
		'projection-too-broad': policy('narrow-request', false, 'none', 'usage'),
		'receipt-store-unavailable': policy('wait-and-retry', true, 'none', 'runtime-failure'),
		'transport-unavailable': policy('wait-and-retry', true, 'none', 'unavailable'),
		'desktop-unavailable': policy('fix-environment', false, 'none', 'unavailable'),
		'handler-unavailable': policy('fix-environment', false, 'none', 'unavailable'),
		'live-settling': policy('wait-and-retry', true, 'none', 'unavailable'),
		'internal-error': policy('report-bug', false, 'none', 'internal'),
	});

export const ERROR_REGISTRY_V1: readonly ErrorRegistryEntryV1[] = Object.freeze(
	STRUCTURED_ERROR_CODES_V1.map(code => Object.freeze({ code, ...ERROR_POLICY_V1[code] })),
);

export function errorPolicyForCodeV1(code: StructuredErrorCodeV1): Omit<ErrorRegistryEntryV1, 'code'> & {
	readonly code: string;
} {
	return ERROR_REGISTRY_V1.find(entry => entry.code === code)
		?? Object.freeze({
			code: String(code),
			action: 'do-not-retry',
			retryable: false,
			recovery: 'none',
			exitClass: 'internal',
		});
}

export function structuredErrorV1(
	code: StructuredErrorCodeV1,
	reason: string,
	options: {
		details?: Record<string, JsonValue>;
		retryable?: boolean;
		action?: ErrorActionV1;
	} = {},
): StructuredErrorV1 {
	const policyEntry = errorPolicyForCodeV1(code);
	return {
		contractVersion: CONTRACT_VERSION_V1,
		code,
		reason,
		retryable: options.retryable ?? policyEntry.retryable,
		action: options.action ?? policyEntry.action,
		...(options.details ? { details: options.details } : {}),
	};
}

export function normalizeStructuredErrorV1(error: StructuredErrorV1): StructuredErrorV1 {
	const policyEntry = errorPolicyForCodeV1(error.code);
	return {
		...error,
		retryable: error.retryable,
		action: error.action ?? policyEntry.action,
		...(error.details ? { details: { ...error.details } } : {}),
	};
}

function policy(
	action: ErrorActionV1,
	retryable: boolean,
	recovery: ErrorRegistryEntryV1['recovery'],
	exitClass: ErrorExitClassV1,
): Omit<ErrorRegistryEntryV1, 'code'> {
	return Object.freeze({ action, retryable, recovery, exitClass });
}

export interface ContractWarningV1 {
	code: string;
	message: string;
	path?: string;
}

export interface ProvenanceV1 {
	path: string;
	source: FreshnessSourceV1;
	revision?: string;
	derived: boolean;
}

export interface TruncationV1 {
	path: string;
	actualCount: number;
	returnedCount: number;
	limit: number;
}

export interface CompatibilityRangeV1 {
	min: number;
	max: number;
}

export interface CompatibilityOfferV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	runtimeApi: CompatibilityRangeV1;
}

export interface CompatibilitySelectionV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	compatible: boolean;
	runtimeApi?: 1;
	error?: StructuredErrorV1;
}

export function utf8ByteLengthV1(value: string): number {
	let bytes = 0;
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code === undefined) continue;
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (code <= 0xffff) bytes += 3;
		else bytes += 4;
	}
	return bytes;
}

export function negotiateCompatibilityV1(
	local: CompatibilityOfferV1,
	remote: CompatibilityOfferV1,
): CompatibilitySelectionV1 {
	const runtimeApi = rangesOverlapAtV1(local.runtimeApi, remote.runtimeApi) ? 1 : undefined;
	if (runtimeApi) {
		return { contractVersion: CONTRACT_VERSION_V1, compatible: true, runtimeApi };
	}
	return {
		contractVersion: CONTRACT_VERSION_V1,
		compatible: false,
		error: structuredErrorV1(
			'incompatible-version',
			'No mutually supported Runtime API version.',
		),
	};
}

function rangesOverlapAtV1(left: CompatibilityRangeV1, right: CompatibilityRangeV1): boolean {
	return left.min <= 1 && left.max >= 1 && right.min <= 1 && right.max >= 1;
}
