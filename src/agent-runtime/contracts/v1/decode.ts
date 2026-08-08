import {
	CapabilityDefinitionV1,
	type CapabilityAdvertisementV1,
	CAPABILITY_REGISTRY_V1,
	isCapabilityIdV1,
	isMutationKindV1,
	MUTATION_CAPABILITY_MAP_V1,
} from './capabilities';
import {
	CONTEXT_HYDRATION_KEYS_V1,
	CONTEXT_HYDRATION_CAPS_V1,
	CONTEXT_PROJECTION_LIMITS_V1,
	CONTEXT_PROJECTIONS_V1,
	CONTEXT_PURPOSES_V1,
	MUTATION_READINESS_OPERON_IDS_MAX_V1,
	MUTATION_READINESS_OPERON_IDS_MIN_V1,
	TASK_GET_HYDRATION_KEYS_V1,
	TASK_FINDER_PROJECT_MODES_V1,
	TASK_FINDER_REPRESENTATIONS_V1,
	TASK_FINDER_SCOPES_V1,
	ContextRequestV1,
	ContextPackV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RELATIONSHIP_KINDS_V1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskContextV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from './context';
import {
	CATALOG_LIMITS_V1,
	CatalogRequestV1,
	FieldDescriptorV1,
	FIELD_CATALOG_LIMITS_V1,
	FIELD_VALUE_TYPES_V1,
	GENERAL_UPDATE_BUILT_IN_KEYS_V1,
	MUTATION_CLASSES_V1,
	OperonCatalogV1,
	RECURRENCE_UPDATE_KEYS_V1,
	RUNTIME_OWNED_KEYS_V1,
	SEMANTIC_CAPABILITY_KEYS_V1,
	TEMPORAL_CREATE_KEYS_V1,
	TYPED_CREATE_FEATURES_V1,
	GRAPH_TRANSACTION_FEATURES_V1,
	SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
	COMPACT_UPDATE_BATCH_FEATURES_V1,
} from './catalog';
import {
	CLI_COMMANDS_V1,
	CLI_FAILURE_STAGES_V1,
	CLI_MAX_READINESS_TIMEOUT_MS_V1,
	CliClientErrorEnvelopeV1,
	CliCommandV1,
	CliInvocationV1,
	CliResultEnvelopeV1,
	cliRequestKindForCommandV1,
	isCliCommandV1,
} from './cli';
import {
	canonicalJsonV1,
	computeReceiptTargetDigestV1,
	sha256HexV1,
	toJsonValueV1,
	verifySealedMutationPlanHashV1,
} from './canonical';
import {
	OPERON_ID_PATTERN_V1,
	RESOURCE_QUEUE_ORDER_V1,
	RESOURCE_KINDS_V1,
	SHA256_HEX_PATTERN_V1,
	TaskSourceLocatorV1,
	validateLocatorLexicallyV1,
	validateVaultRelativePathV1,
} from './identity';
import {
	RUNTIME_API_VERSION_V1,
	RUNTIME_LIFECYCLE_PHASES_V1,
	RUNTIME_RETRY_AFTER_MAX_MS_V1,
	RuntimeHealthV1,
	V8_PERSISTENCE_PHASES_V1,
} from './lifecycle';
import type { TimerReadRequestV1, TimerReadResultV1 } from './timer';
import {
	AUTHORIZATION_BASES_V1,
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationReceiptV1,
	MutationResultV1,
	MutationResultAdmissionScopeV1,
	MutationSpecV1,
	requiredRiskForSpecV1,
	RECURRENCE_UPDATE_SCOPES_V1,
	RISK_LEVELS_V1,
	SealedMutationPlanV1,
	validateTaskRelationshipSpecV1,
} from './mutation';
import {
	CompatibilityOfferV1,
	CompatibilitySelectionV1,
	CONTRACT_LIMITS_V1,
	CONTRACT_VERSION_V1,
	ERROR_ACTIONS_V1,
	errorPolicyForCodeV1,
	STRUCTURED_ERROR_CODES_V1,
	IDEMPOTENCY_KEY_PATTERN_V1,
	JsonValue,
	REQUEST_ID_PATTERN_V1,
	StructuredErrorV1,
	utf8ByteLengthV1,
	WARNING_CODE_PATTERN_V1,
} from './primitives';

export interface DecodeIssueV1 {
	path: string;
	code: 'type' | 'required' | 'unknown-field' | 'value' | 'prototype' | 'length';
	message: string;
}

export type DecodeResultV1<T> =
	| { ok: true; value: T }
	| { ok: false; issues: DecodeIssueV1[] };

const BUILT_IN_GENERAL_UPDATE_TYPES: Readonly<Record<string, string>> = Object.freeze({
	description: 'text',
	priority: 'text',
	dateDue: 'date',
	dateScheduled: 'date',
	dateStarted: 'date',
	datetimeStart: 'datetime',
	datetimeEnd: 'datetime',
	estimate: 'number',
	assignees: 'list',
	contexts: 'list',
	tags: 'list',
	taskIcon: 'text',
	taskColor: 'text',
	note: 'text',
	location: 'text',
	links: 'list',
});

export function decodeDeveloperApiAccessRequestV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectObject(
		value,
		'',
		['contractVersion', 'runtimeApi', 'requestedCapabilities'],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRange(object.runtimeApi, '/runtimeApi', issues);
	checkDeveloperCapabilityIds(
		object.requestedCapabilities,
		'/requestedCapabilities',
		issues,
	);
	return finish(value, issues);
}

export function decodeDeveloperApiChannelStatusV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	checkDeveloperApiChannelStatus(value, '', issues);
	return finish(value, issues);
}

export function decodeDeveloperApiAccessFailureV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(
		value,
		'',
		['contractVersion', 'kind', 'ok', 'status', 'error'],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'developer-api-access-result', '/kind', issues);
	checkLiteral(object.ok, false, '/ok', issues);
	checkDeveloperApiChannelStatus(object.status, '/status', issues);
	checkStructuredError(object.error, '/error', issues);
	checkDeveloperForbiddenFields(object, '', ['api'], issues);
	return finish(value, issues);
}

export function decodeDeveloperMutationPreviewInputV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectObject(
		value,
		'',
		['capability', 'mutationKind', 'target', 'spec'],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkCapabilityMutationPair(object.capability, object.mutationKind, 'preview', issues);
	if (object.target !== undefined) checkExactMutationTarget(object.target, '/target', issues);
	if (
		object.mutationKind !== 'task.create'
		&& object.mutationKind !== 'task.adopt'
		&& object.mutationKind !== 'timer.control'
		&& object.target === undefined
		&& !(isPlainRecord(object.spec) && object.spec.operation === 'update-batch')
	) {
		issues.push(issue(
			'/target',
			'required',
			'Non-create Developer API mutation preview requires an exact target.',
		));
	}
	if (
		isPlainRecord(object.spec)
		&& object.spec.operation === 'update-batch'
		&& object.target !== undefined
	) {
		issues.push(issue(
			'/target',
			'value',
			'update-batch owns its exact targets and does not accept an outer target.',
		));
	}
	if (object.mutationKind === 'task.create' && object.target !== undefined) {
		issues.push(issue('/target', 'value', 'Task creation does not accept an exact target.'));
	}
	checkMutationSpec(object.spec, '/spec', object.mutationKind, issues, true);
	return finish(value, issues);
}

export function decodeDeveloperMutationPreviewResultV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(
		value,
		'',
		['contractVersion', 'kind', 'requestId', 'ok', 'plan', 'error', 'warnings'],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'developer-mutation-preview-result', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.ok === true) {
		if (object.plan === undefined) {
			issues.push(issue('/plan', 'required', 'Successful preview result requires a plan handle.'));
		} else {
			checkDeveloperMutationPlanHandle(object.plan, '/plan', false, issues);
		}
		if (object.error !== undefined) {
			issues.push(issue('/error', 'value', 'Successful preview result cannot include an error.'));
		}
	} else if (object.ok === false) {
		if (object.error === undefined) {
			issues.push(issue('/error', 'required', 'Failed preview result requires an error.'));
		} else {
			checkStructuredError(object.error, '/error', issues);
		}
		if (object.plan !== undefined) {
			issues.push(issue('/plan', 'value', 'Failed preview result cannot include a plan handle.'));
		}
	}
	return finish(value, issues);
}

export function decodeDeveloperMutationApplyInputV1(value: unknown): DecodeResultV1<unknown> {
	return decodeDeveloperMutationPlanInput(value);
}

export function decodeDeveloperMutationRecoverInputV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectObject(value, '', ['plan', 'recoveryRef'], issues);
	if (!object) return { ok: false, issues };
	const hasPlan = object.plan !== undefined;
	const hasRecoveryRef = object.recoveryRef !== undefined;
	if (hasPlan === hasRecoveryRef) {
		issues.push(issue('/', 'value', 'Recovery requires exactly one of plan or recoveryRef.'));
	}
	if (hasPlan) checkDeveloperMutationPlanHandle(object.plan, '/plan', true, issues);
	if (hasRecoveryRef) checkDeveloperRecoveryRef(object.recoveryRef, '/recoveryRef', issues);
	return finish(value, issues);
}

export function decodeDeveloperMutationPendingRecoveriesResultV1(
	value: unknown,
): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(
		value,
		'',
		['contractVersion', 'kind', 'ok', 'recoveries', 'error'],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(
		object.kind,
		'developer-mutation-pending-recoveries-result',
		'/kind',
		issues,
	);
	checkBoolean(object.ok, '/ok', issues);
	if (object.ok === true) {
		if (!Array.isArray(object.recoveries)) {
			issues.push(issue('/recoveries', 'type', 'Expected a pending recovery array.'));
		} else {
			if (object.recoveries.length > 256) {
				issues.push(issue('/recoveries', 'length', 'Pending recoveries exceed the V1 limit.'));
			}
			for (let index = 0; index < object.recoveries.length; index++) {
				checkDeveloperPendingRecovery(
					object.recoveries[index],
					`/recoveries/${index}`,
					issues,
				);
			}
		}
		if (object.error !== undefined) {
			issues.push(issue('/error', 'value', 'A successful pending-recovery result cannot include an error.'));
		}
	} else if (object.ok === false) {
		checkStructuredError(object.error, '/error', issues);
		if (object.recoveries !== undefined) {
			issues.push(issue('/recoveries', 'value', 'A failed pending-recovery result cannot include records.'));
		}
	}
	return finish(value, issues);
}

export function decodeDeveloperMutationExecutionResultV1(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(
		value,
		'',
		[
			'contractVersion',
			'kind',
			'requestId',
			'status',
			'mutationMayHaveApplied',
			'retryAllowed',
			'groupResults',
			'receipt',
			'postflight',
			'error',
			'recovery',
		],
		issues,
	);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'developer-mutation-execution-result', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkEnum(
		object.status,
		['applied', 'already-applied', 'partial', 'failed', 'outcome-unknown'],
		'/status',
		issues,
	);
	checkBoolean(object.mutationMayHaveApplied, '/mutationMayHaveApplied', issues);
	checkBoolean(object.retryAllowed, '/retryAllowed', issues);
	checkGroupResults(object.groupResults, '/groupResults', issues);
	if (object.receipt !== undefined) {
		checkDeveloperMutationReceipt(object.receipt, '/receipt', issues);
	}
	if (object.postflight !== undefined) {
		checkMutationPostflight(object.postflight, '/postflight', issues);
	}
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	if (object.recovery !== undefined) {
		checkDeveloperMutationRecovery(object.recovery, '/recovery', issues);
		if (!['partial', 'failed', 'outcome-unknown'].includes(String(object.status))) {
			issues.push(issue('/recovery', 'value', 'Final mutation results cannot include recovery.'));
		}
		if (object.mutationMayHaveApplied !== true || object.retryAllowed !== false) {
			issues.push(issue(
				'/recovery',
				'value',
				'Recovery requires a possibly applied, non-retryable mutation result.',
			));
		}
	}
	checkDeveloperMutationExecutionState(object, issues);
	return finish(value, issues);
}

function checkDeveloperMutationExecutionState(
	object: Record<string, unknown>,
	issues: DecodeIssueV1[],
): void {
	const groups = Array.isArray(object.groupResults) ? object.groupResults : [];
	const statuses = groups.filter(isPlainRecord).map(group => group.status);
	const allCommitted = statuses.length > 0 && statuses.every(status => status === 'committed');
	const anyCommitted = statuses.some(status => status === 'committed');
	const anyFailed = statuses.some(status => status === 'failed');
	const anyUnknown = statuses.some(status => status === 'outcome-unknown');
	const receipt = isPlainRecord(object.receipt) ? object.receipt : null;
	const postflight = isPlainRecord(object.postflight) ? object.postflight : null;
	const recovery = isPlainRecord(object.recovery) ? object.recovery : null;
	switch (object.status) {
		case 'applied':
			if (
				!allCommitted
				|| object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error !== undefined
				|| recovery !== null
				|| receipt?.terminalOutcome !== 'applied'
				|| postflight?.status !== 'verified'
			) {
				issues.push(issue('/', 'value', 'Applied result requires committed groups, matching receipt and verified postflight.'));
			}
			break;
		case 'already-applied':
			if (
				groups.length !== 0
				|| object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error !== undefined
				|| recovery !== null
				|| receipt?.terminalOutcome !== 'already-applied'
				|| postflight?.status !== 'receipt-replay'
			) {
				issues.push(issue('/', 'value', 'Already-applied result requires a matching receipt and receipt-replay postflight.'));
			}
			break;
		case 'failed':
			if (
				anyCommitted
				|| anyUnknown
				|| object.mutationMayHaveApplied !== false
				|| object.retryAllowed !== false
				|| object.error === undefined
				|| receipt !== null
				|| postflight !== null
				|| recovery !== null
			) {
				issues.push(issue('/', 'value', 'Failed result requires no possible effects, no retry, and a structured error.'));
			}
			break;
		case 'partial':
			{
				const errorPolicy = isPlainRecord(object.error) && typeof object.error.code === 'string'
					? errorPolicyForCodeV1(object.error.code)
					: null;
				if (
					!anyCommitted
					|| !anyFailed
					|| anyUnknown
					|| object.mutationMayHaveApplied !== true
					|| object.retryAllowed !== false
					|| object.error === undefined
					|| receipt !== null
					|| postflight !== null
					|| recovery === null
					|| errorPolicy?.recovery !== 'same-plan'
					|| errorPolicy?.action !== 'recover-same-plan'
				) {
					issues.push(issue('/', 'value', 'Partial result requires committed and failed groups plus same-plan recovery.'));
				}
				break;
			}
		case 'outcome-unknown':
			{
				const errorPolicy = isPlainRecord(object.error) && typeof object.error.code === 'string'
					? errorPolicyForCodeV1(object.error.code)
					: null;
				if (
					object.mutationMayHaveApplied !== true
					|| object.retryAllowed !== false
					|| object.error === undefined
					|| receipt !== null
					|| postflight !== null
					|| recovery === null
					|| errorPolicy?.recovery !== 'same-plan'
					|| errorPolicy?.action !== 'recover-same-plan'
				) {
					issues.push(issue('/', 'value', 'Outcome-unknown requires no retry and same-plan recovery.'));
				}
				break;
			}
		default:
			break;
	}
}

function decodeDeveloperMutationPlanInput(value: unknown): DecodeResultV1<unknown> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectObject(value, '', ['plan'], issues);
	if (!object) return { ok: false, issues };
	checkDeveloperMutationPlanHandle(object.plan, '/plan', true, issues);
	return finish(value, issues);
}

function checkDeveloperApiChannelStatus(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectResponseObject(
		value,
		path,
		[
			'contractVersion',
			'kind',
			'runtimeApiVersion',
			'availability',
			'reason',
			'lifecyclePhase',
			'authority',
			'admission',
			'capabilities',
			'retryAfterMs',
			'error',
		],
		issues,
	);
	if (!object) return;
	checkContractVersion(object, issues, path);
	checkLiteral(
		object.kind,
		'developer-api-channel-status',
		`${path}/kind`,
		issues,
	);
	checkLiteral(object.runtimeApiVersion, RUNTIME_API_VERSION_V1, `${path}/runtimeApiVersion`, issues);
	checkEnum(
		object.availability,
		['available', 'degraded', 'unavailable'],
		`${path}/availability`,
		issues,
	);
	checkEnum(
		object.reason,
		[
			'ready',
			'booting',
			'cache-ready',
			'settling',
			'unloading',
			'terminal-startup-failure',
			'accessor-unavailable',
			'unsupported-platform',
			'unsupported-version',
		],
		`${path}/reason`,
		issues,
	);
	if (object.lifecyclePhase !== undefined) {
		checkEnum(
			object.lifecyclePhase,
			RUNTIME_LIFECYCLE_PHASES_V1,
			`${path}/lifecyclePhase`,
			issues,
		);
	}
	checkEnum(object.authority, ['read-only', 'granted', 'revoked'], `${path}/authority`, issues);
	const admission = inspectResponseObject(
		object.admission,
		`${path}/admission`,
		['reads', 'writes'],
		issues,
	);
	if (admission) {
		checkBoolean(admission.reads, `${path}/admission/reads`, issues);
		checkBoolean(admission.writes, `${path}/admission/writes`, issues);
	}
	checkCapabilityAdvertisements(object.capabilities, `${path}/capabilities`, issues);
	if (object.retryAfterMs !== undefined) {
		checkBoundedPositiveInteger(
			object.retryAfterMs,
			`${path}/retryAfterMs`,
			RUNTIME_RETRY_AFTER_MAX_MS_V1,
			issues,
		);
	}
	if (object.error !== undefined) checkStructuredError(object.error, `${path}/error`, issues);
}

function checkDeveloperCapabilityIds(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected a capability array.'));
		return;
	}
	if (value.length > 512) {
		issues.push(issue(path, 'length', 'Requested capabilities exceed the V1 limit.'));
	}
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const capability: unknown = value[index];
		const itemPath = `${path}/${index}`;
		if (
			typeof capability !== 'string'
			|| !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(capability)
		) {
			issues.push(issue(itemPath, 'value', 'Invalid capability identifier.'));
		} else if (!isCapabilityIdV1(capability)) {
			issues.push(issue(itemPath, 'value', 'Unknown capability identifier.'));
		} else if (seen.has(capability)) {
			issues.push(issue(itemPath, 'value', 'Requested capabilities must be unique.'));
		} else {
			seen.add(capability);
		}
	}
}

function checkDeveloperMutationPlanHandle(
	value: unknown,
	path: string,
	strict: boolean,
	issues: DecodeIssueV1[],
): void {
	const fields = [
		'contractVersion',
		'kind',
		'recoveryRef',
		'planDigest',
		'capability',
		'mutationKind',
		'createdAt',
		'expiresAt',
		'riskLevel',
		'requiresConsent',
		'targets',
		'predictedEffects',
		'warnings',
	] as const;
	const object = strict
		? inspectObject(value, path, fields, issues)
		: inspectResponseObject(value, path, fields, issues);
	if (!object) return;
	checkDeveloperForbiddenFields(
		object,
		path,
		[
			'clientInstanceId',
			'authorization',
			'consentToken',
			'acknowledgements',
			'idempotencyKey',
			'idempotencyKeyHash',
			'planRef',
			'vaultIdentityHash',
			'planHash',
			'planId',
			'correlationId',
			'receiptTargetDigest',
			'contextRevision',
			'affectedResources',
			'atomicGroups',
			'requiresConfirmation',
			'requiredAcknowledgements',
			'spec',
			'createEffects',
			'conversionEffect',
			'updateBatchEffects',
		],
		issues,
	);
	checkContractVersion(object, issues, path);
	checkLiteral(object.kind, 'developer-mutation-plan', `${path}/kind`, issues);
	checkDeveloperRecoveryRef(object.recoveryRef, `${path}/recoveryRef`, issues);
	checkSha256(object.planDigest, `${path}/planDigest`, issues);
	if (
		typeof object.capability !== 'string'
		|| !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(object.capability)
	) {
		issues.push(issue(`${path}/capability`, 'value', 'Invalid capability identifier.'));
	}
	if (typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind)) {
		issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown mutation kind.'));
	}
	checkTimestamp(object.createdAt, `${path}/createdAt`, issues);
	checkTimestamp(object.expiresAt, `${path}/expiresAt`, issues);
	const createdAt = parseTimestamp(object.createdAt);
	const expiresAt = parseTimestamp(object.expiresAt);
	if (createdAt !== null && expiresAt !== null && expiresAt <= createdAt) {
		issues.push(issue(`${path}/expiresAt`, 'value', 'Plan expiry must follow creation.'));
	}
	checkEnum(object.riskLevel, RISK_LEVELS_V1, `${path}/riskLevel`, issues);
	checkBoolean(object.requiresConsent, `${path}/requiresConsent`, issues);
	checkDeveloperMutationTargets(object.targets, `${path}/targets`, issues);
	checkDeveloperPredictedEffects(object.predictedEffects, `${path}/predictedEffects`, issues);
	checkWarnings(object.warnings, `${path}/warnings`, issues);
}

function checkDeveloperMutationTargets(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected a target array.'));
		return;
	}
	if (value.length > 128) issues.push(issue(path, 'length', 'Plan targets exceed the V1 limit.'));
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		checkExactMutationTarget(value[index], `${path}/${index}`, issues);
		const key = JSON.stringify(value[index]);
		if (seen.has(key)) issues.push(issue(`${path}/${index}`, 'value', 'Plan targets must be unique.'));
		seen.add(key);
	}
}

function checkDeveloperPredictedEffects(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected a predicted-effects array.'));
		return;
	}
	if (value.length > 128) {
		issues.push(issue(path, 'length', 'Predicted effects exceed the V1 limit.'));
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(
			value[index],
			itemPath,
			['resourceKind', 'resourceKey', 'action', 'summary'],
			issues,
		);
		if (!item) continue;
		checkEnum(item.resourceKind, RESOURCE_KINDS_V1, `${itemPath}/resourceKind`, issues);
		checkNonEmptyString(item.resourceKey, `${itemPath}/resourceKey`, issues);
		checkEnum(
			item.action,
			['create', 'update', 'trash', 'state-change'],
			`${itemPath}/action`,
			issues,
		);
		checkNonEmptyString(item.summary, `${itemPath}/summary`, issues);
	}
}

function checkDeveloperMutationReceipt(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectResponseObject(
		value,
		path,
		[
			'contractVersion',
			'planDigest',
			'mutationKind',
			'targetDigest',
			'terminalOutcome',
			'effectiveAt',
			'completedAt',
			'expiresAt',
		],
		issues,
	);
	if (!object) return;
	checkDeveloperForbiddenFields(
		object,
		path,
		[
			'clientInstanceId',
			'idempotencyKey',
			'idempotencyKeyHash',
			'vaultIdentityHash',
			'planHash',
			'planRef',
		],
		issues,
	);
	checkContractVersion(object, issues, path);
	checkSha256(object.planDigest, `${path}/planDigest`, issues);
	if (typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind)) {
		issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown mutation kind.'));
	}
	checkSha256(object.targetDigest, `${path}/targetDigest`, issues);
	checkEnum(
		object.terminalOutcome,
		['applied', 'already-applied'],
		`${path}/terminalOutcome`,
		issues,
	);
	checkTimestamp(object.effectiveAt, `${path}/effectiveAt`, issues);
	checkTimestamp(object.completedAt, `${path}/completedAt`, issues);
	checkTimestamp(object.expiresAt, `${path}/expiresAt`, issues);
}

function checkDeveloperMutationRecovery(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectResponseObject(
		value,
		path,
		[
			'required',
			'action',
			'mutationMayHaveApplied',
			'recoveryRef',
			'planDigest',
			'plan',
		],
		issues,
	);
	if (!object) return;
	checkLiteral(object.required, true, `${path}/required`, issues);
	checkLiteral(object.action, 'recover-same-plan', `${path}/action`, issues);
	checkLiteral(object.mutationMayHaveApplied, true, `${path}/mutationMayHaveApplied`, issues);
	checkDeveloperRecoveryRef(object.recoveryRef, `${path}/recoveryRef`, issues);
	checkSha256(object.planDigest, `${path}/planDigest`, issues);
	checkDeveloperMutationPlanHandle(object.plan, `${path}/plan`, false, issues);
	if (
		isPlainRecord(object.plan)
		&& (
			object.plan.recoveryRef !== object.recoveryRef
			|| object.plan.planDigest !== object.planDigest
		)
	) {
		issues.push(issue(path, 'value', 'Recovery metadata must match the opaque plan handle.'));
	}
}

function checkDeveloperPendingRecovery(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectResponseObject(
		value,
		path,
		[
			'recoveryRef',
			'planDigest',
			'mutationKind',
			'capability',
			'riskLevel',
			'createdAt',
			'expiresAt',
		],
		issues,
	);
	if (!object) return;
	checkDeveloperRecoveryRef(object.recoveryRef, `${path}/recoveryRef`, issues);
	checkSha256(object.planDigest, `${path}/planDigest`, issues);
	if (typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind)) {
		issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown mutation kind.'));
	}
	if (typeof object.capability !== 'string' || !isCapabilityIdV1(object.capability)) {
		issues.push(issue(`${path}/capability`, 'value', 'Unknown capability.'));
	}
	checkEnum(object.riskLevel, RISK_LEVELS_V1, `${path}/riskLevel`, issues);
	checkTimestamp(object.createdAt, `${path}/createdAt`, issues);
	checkTimestamp(object.expiresAt, `${path}/expiresAt`, issues);
}

function checkDeveloperRecoveryRef(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (typeof value !== 'string' || !/^dvr1_[0-9a-f]{48}$/u.test(value)) {
		issues.push(issue(path, 'value', 'Invalid Developer API recovery reference.'));
	}
}

function checkDeveloperForbiddenFields(
	object: Record<string, unknown>,
	path: string,
	forbidden: readonly string[],
	issues: DecodeIssueV1[],
): void {
	for (const key of forbidden) {
		if (Object.prototype.hasOwnProperty.call(object, key)) {
			issues.push(issue(
				`${path}/${key}`,
				'value',
				`Developer API boundary forbids internal field: ${key}.`,
			));
		}
	}
}

export function decodeCompatibilityOfferV1(value: unknown): DecodeResultV1<CompatibilityOfferV1> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectObject(value, '', ['contractVersion', 'runtimeApi'], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRange(object.runtimeApi, '/runtimeApi', issues);
	return finish<CompatibilityOfferV1>(value, issues);
}

function decodeCompatibilityAdvertisementV1(
	value: unknown,
): DecodeResultV1<CompatibilityOfferV1> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(value, '', ['contractVersion', 'runtimeApi'], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRange(object.runtimeApi, '/runtimeApi', issues);
	return finish<CompatibilityOfferV1>(value, issues);
}

export function decodeCompatibilitySelectionV1(value: unknown): DecodeResultV1<CompatibilitySelectionV1> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(value, '', [
		'contractVersion', 'compatible', 'runtimeApi', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkBoolean(object.compatible, '/compatible', issues);
	if (object.runtimeApi !== undefined) checkLiteral(object.runtimeApi, 1, '/runtimeApi', issues);
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	if (object.compatible === true && (object.runtimeApi !== 1 || object.error !== undefined)) {
		issues.push(issue('/', 'value', 'Compatible selection requires Runtime API V1 and no error.'));
	}
	if (object.compatible === false && object.error === undefined) {
		issues.push(issue('/error', 'required', 'Incompatible selection requires a structured error.'));
	}
	return finish<CompatibilitySelectionV1>(value, issues);
}

export function decodeStructuredErrorV1(value: unknown): DecodeResultV1<StructuredErrorV1> {
	const issues: DecodeIssueV1[] = [];
	checkStructuredError(value, '', issues);
	return finish<StructuredErrorV1>(value, issues);
}

export function decodeCliInvocationV1(value: unknown): DecodeResultV1<CliInvocationV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion',
		'kind',
		'requestId',
		'command',
		'mode',
		'clientVersion',
		'compatibility',
		'cliContract',
		'expectedVaultSha256',
		'readinessTimeoutMs',
		'request',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'cli-invocation', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkEnum(object.command, CLI_COMMANDS_V1, '/command', issues);
	checkLiteral(object.mode, 'live', '/mode', issues);
	checkBoundedNonEmptyString(object.clientVersion, '/clientVersion', 256, issues);
	const compatibility = decodeCompatibilityOfferV1(object.compatibility);
	appendDecodeIssues(issues, compatibility, '/compatibility');
	if (object.cliContract === undefined) {
		issues.push(issue('/cliContract', 'required', 'CLI contract range is required.'));
	} else {
		const cliContract = inspectObject(object.cliContract, '/cliContract', ['min', 'max'], issues);
		if (cliContract) {
			checkLiteral(cliContract.min, 1, '/cliContract/min', issues);
			checkLiteral(cliContract.max, 1, '/cliContract/max', issues);
		}
	}
	checkSha256(object.expectedVaultSha256, '/expectedVaultSha256', issues);
	checkPositiveInteger(object.readinessTimeoutMs, '/readinessTimeoutMs', issues);
	if (
		typeof object.readinessTimeoutMs === 'number'
		&& object.readinessTimeoutMs > CLI_MAX_READINESS_TIMEOUT_MS_V1
	) {
		issues.push(issue(
			'/readinessTimeoutMs',
			'value',
			'CLI readiness timeout exceeds the V1 maximum.',
		));
	}
	if (typeof object.command === 'string' && isCliCommandV1(object.command)) {
		checkCliInvocationRequest(object.command, object.request, issues);
		if (
			isPlainRecord(object.request)
			&& typeof object.request.requestId === 'string'
			&& object.request.requestId !== object.requestId
		) {
			issues.push(issue('/request/requestId', 'value', 'Runtime requestId must match the CLI invocation requestId.'));
		}
	}
	return finish<CliInvocationV1>(value, issues);
}

export function decodeCliResultEnvelopeV1(value: unknown): DecodeResultV1<CliResultEnvelopeV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectResponseObject(value, '', [
		'contractVersion',
		'kind',
		'requestId',
		'command',
		'ok',
		'transport',
		'vaultIdentity',
		'compatibility',
		'cliContract',
		'runtime',
		'timing',
		'warnings',
		'client',
		'result',
		'failure',
		'recovery',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'cli-result', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkEnum(object.command, CLI_COMMANDS_V1, '/command', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkCliTransportSummary(object.transport, '/transport', issues);
	checkCliVaultIdentity(object.vaultIdentity, '/vaultIdentity', issues);
	if (object.compatibility !== undefined) {
		const compatibility = decodeCompatibilitySelectionV1(object.compatibility);
		appendDecodeIssues(issues, compatibility, '/compatibility');
	}
	if (object.cliContract !== undefined) checkLiteral(object.cliContract, 1, '/cliContract', issues);
	if (object.runtime !== undefined) checkCliRuntimeMetadata(object.runtime, '/runtime', issues);
	checkCliTiming(object.timing, '/timing', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.client !== undefined) {
		const client = inspectResponseObject(object.client, '/client', ['profile', 'planRef'], issues);
		if (client) {
			if (client.profile !== undefined) {
				checkBoundedNonEmptyString(client.profile, '/client/profile', 128, issues);
			}
			if (client.planRef !== undefined) {
				checkBoundedNonEmptyString(client.planRef, '/client/planRef', 128, issues);
			}
		}
	}
	if (object.recovery !== undefined) {
		checkRecovery(object.recovery, '/recovery', object, issues);
	}
	if (object.ok === true) {
		if (!isPlainRecord(object.vaultIdentity) || object.vaultIdentity.expectedMatch !== true) {
			issues.push(issue('/vaultIdentity/expectedMatch', 'value', 'Successful CLI result requires a matching vault.'));
		}
		if (!isPlainRecord(object.compatibility) || object.compatibility.compatible !== true) {
			issues.push(issue('/compatibility', 'required', 'Successful CLI result requires compatible V1 contracts.'));
		}
		if (object.cliContract !== 1) {
			issues.push(issue('/cliContract', 'required', 'Successful CLI result requires CLI contract V1.'));
		}
		if (object.runtime === undefined) {
			issues.push(issue('/runtime', 'required', 'Successful CLI result requires Runtime metadata.'));
		}
		if (object.failure !== undefined) {
			issues.push(issue('/failure', 'value', 'Successful CLI result cannot contain a failure.'));
		}
		if (object.result === undefined) {
			issues.push(issue('/result', 'required', 'Successful CLI result requires a command result.'));
		} else if (typeof object.command === 'string' && isCliCommandV1(object.command)) {
			checkCliCommandResult(object.command, object.result, issues);
			if (
				isPlainRecord(object.result)
				&& typeof object.result.requestId === 'string'
				&& object.result.requestId !== object.requestId
			) {
				issues.push(issue('/result/requestId', 'value', 'Runtime result requestId must match the CLI envelope requestId.'));
			}
		}
	} else if (object.ok === false) {
		if (object.result !== undefined) {
			issues.push(issue('/result', 'value', 'Failed CLI result cannot contain a command result.'));
		}
		checkCliFailure(object.failure, '/failure', issues);
	}
	return finish<CliResultEnvelopeV1>(value, issues);
}

export function decodeCliClientErrorEnvelopeV1(
	value: unknown,
): DecodeResultV1<CliClientErrorEnvelopeV1> {
	const issues: DecodeIssueV1[] = [];
	const object = inspectResponseObject(value, '', [
		'contractVersion',
		'kind',
		'ok',
		'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'cli-client-error', '/kind', issues);
	checkLiteral(object.ok, false, '/ok', issues);
	checkStructuredError(object.error, '/error', issues);
	return finish<CliClientErrorEnvelopeV1>(value, issues);
}

export function decodeRuntimeHealthV1(value: unknown): DecodeResultV1<RuntimeHealthV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectResponseObject(value, '', [
		'apiVersion', 'contractVersion', 'ok', 'lifecyclePhase', 'v8PersistencePhase',
		'compatibility', 'capabilities', 'freshness', 'contextRevision', 'admission',
		'retryAfterMs', 'warnings', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkLiteral(object.apiVersion, RUNTIME_API_VERSION_V1, '/apiVersion', issues);
	checkContractVersion(object, issues);
	checkBoolean(object.ok, '/ok', issues);
	checkEnum(object.lifecyclePhase, RUNTIME_LIFECYCLE_PHASES_V1, '/lifecyclePhase', issues);
	checkEnum(object.v8PersistencePhase, V8_PERSISTENCE_PHASES_V1, '/v8PersistencePhase', issues);
	const compatibility = decodeCompatibilityAdvertisementV1(object.compatibility);
	if (compatibility.ok === false) {
		compatibility.issues.forEach(item => issues.push({
			...item,
			path: `/compatibility${item.path === '/' ? '' : item.path}`,
		}));
	}
	checkCapabilityAdvertisements(object.capabilities, '/capabilities', issues);
	checkFreshness(object.freshness, '/freshness', issues);
	if (object.contextRevision !== undefined) {
		checkContextRevision(object.contextRevision, '/contextRevision', issues);
	}
	checkRuntimeAdmission(object.admission, '/admission', issues);
	if (object.retryAfterMs !== undefined) {
		checkPositiveInteger(object.retryAfterMs, '/retryAfterMs', issues);
		if (
			typeof object.retryAfterMs === 'number'
			&& object.retryAfterMs > RUNTIME_RETRY_AFTER_MAX_MS_V1
		) {
			issues.push(issue('/retryAfterMs', 'value', 'retryAfterMs exceeds the capped V1 polling hint.'));
		}
		if (object.lifecyclePhase === 'ready' || object.lifecyclePhase === 'unloading') {
			issues.push(issue(
				'/retryAfterMs',
				'value',
				'Ready and unloading Runtime health must not contain a retry hint.',
			));
		}
		if (
			object.ok === false
			&& isPlainRecord(object.error)
			&& object.error.retryable === false
		) {
			issues.push(issue(
				'/retryAfterMs',
				'value',
				'Fatal non-retryable Runtime health must not contain a retry hint.',
			));
		}
	}
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	if (object.ok === true && object.error !== undefined) {
		issues.push(issue('/error', 'value', 'Successful health cannot contain an error.'));
	}
	if (object.ok === false && object.error === undefined) {
		issues.push(issue('/error', 'required', 'Failed health requires a structured error.'));
	}
	if (object.lifecyclePhase === 'ready' && object.admission !== undefined) {
		const admission = object.admission as Record<string, unknown>;
		if (admission.reads !== true || admission.writes !== true) {
			issues.push(issue('/admission', 'value', 'Ready Runtime must admit reads and writes.'));
		}
	}
	if (object.lifecyclePhase !== 'ready' && isPlainRecord(object.admission) && object.admission.writes !== false) {
		issues.push(issue('/admission/writes', 'value', 'Writes are admitted only while the Runtime is ready.'));
	}
	return finish<RuntimeHealthV1>(value, issues);
}

export function decodeRuntimeDiagnosticsV1(
	value: unknown,
): DecodeResultV1<import('./lifecycle').RuntimeDiagnosticsV1> {
	const issues: DecodeIssueV1[] = [];
	checkRuntimeDiagnostics(value, '', issues);
	return finish<import('./lifecycle').RuntimeDiagnosticsV1>(value, issues);
}

export function decodeCapabilityRegistryV1(
	value: unknown,
): DecodeResultV1<CapabilityDefinitionV1[]> {
	const issues: DecodeIssueV1[] = [];
	if (!Array.isArray(value)) return failure('/', 'type', 'Expected an array.');
	const entries = value as unknown[];
	if (entries.length !== CAPABILITY_REGISTRY_V1.length) {
		issues.push(issue('/', 'value', 'Capability registry must exactly match the frozen V1 registry.'));
	}
	for (let index = 0; index < entries.length; index++) {
		const path = `/${index}`;
		const item: unknown = entries[index];
		if (!isPlainRecord(item)) {
			issues.push(issue(path, 'type', 'Expected a capability object.'));
			continue;
		}
		checkObjectFields(item, path, ['id', 'mode', 'mutationKind', 'destructive'], issues);
		if (typeof item.id !== 'string' || !isCapabilityIdV1(item.id)) {
			issues.push(issue(`${path}/id`, 'value', 'Unknown capability.'));
		}
		checkEnum(item.mode, ['read', 'preview', 'apply'], `${path}/mode`, issues);
		checkBoolean(item.destructive, `${path}/destructive`, issues);
		if (item.mutationKind !== undefined && (typeof item.mutationKind !== 'string' || !isMutationKindV1(item.mutationKind))) {
			issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown mutation kind.'));
		}
		const expected = CAPABILITY_REGISTRY_V1[index];
		if (
			!expected
			|| item.id !== expected.id
			|| item.mode !== expected.mode
			|| item.mutationKind !== expected.mutationKind
			|| item.destructive !== expected.destructive
		) {
			issues.push(issue(path, 'value', 'Capability entry differs from the frozen V1 registry.'));
		}
	}
	return finish<CapabilityDefinitionV1[]>(value, issues);
}

export function decodeCapabilityAdvertisementsV1(
	value: unknown,
): DecodeResultV1<CapabilityAdvertisementV1[]> {
	const issues: DecodeIssueV1[] = [];
	checkCapabilityAdvertisements(value, '', issues);
	return finish<CapabilityAdvertisementV1[]>(value, issues);
}

function checkCapabilityAdvertisements(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
		issues.push(issue(path, 'value', 'Capability advertisements exceed the V1 collection limit.'));
	}
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectResponseObject(value[index], itemPath, [
			'id', 'availability', 'stability', 'reason', 'deprecation',
		], issues);
		if (!item) continue;
		if (
			typeof item.id !== 'string'
			|| !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(item.id)
		) {
			issues.push(issue(`${itemPath}/id`, 'value', 'Invalid capability identifier.'));
		} else if (seen.has(item.id)) {
			issues.push(issue(`${itemPath}/id`, 'value', 'Duplicate capability advertisement.'));
		} else {
			seen.add(item.id);
		}
		checkEnum(
			item.availability,
			['contract-only', 'available', 'degraded', 'unavailable'],
			`${itemPath}/availability`,
			issues,
		);
		checkLiteral(item.stability, 'stable', `${itemPath}/stability`, issues);
		if (item.reason !== undefined) {
			checkNonEmptyString(item.reason, `${itemPath}/reason`, issues);
			checkCharacterCap(item.reason, `${itemPath}/reason`, 1_024, issues);
		}
		if (item.availability === 'contract-only' && item.reason === undefined) {
			issues.push(issue(`${itemPath}/reason`, 'required', 'Contract-only capability requires a reason.'));
		}
		if (item.deprecation !== undefined) {
			const deprecation = inspectResponseObject(item.deprecation, `${itemPath}/deprecation`, [
				'announcedIn', 'removal', 'replacement',
			], issues);
			if (deprecation) {
				checkNonEmptyString(deprecation.announcedIn, `${itemPath}/deprecation/announcedIn`, issues);
				checkLiteral(deprecation.removal, 'runtime-v2', `${itemPath}/deprecation/removal`, issues);
				if (deprecation.replacement !== undefined) {
					checkNonEmptyString(deprecation.replacement, `${itemPath}/deprecation/replacement`, issues);
				}
			}
		}
	}
}

export function decodeFieldCatalogV1(value: unknown): DecodeResultV1<FieldDescriptorV1[]> {
	const issues: DecodeIssueV1[] = [];
	if (!Array.isArray(value)) return failure('/', 'type', 'Expected an array.');
	if (value.length > FIELD_CATALOG_LIMITS_V1.descriptors) {
		issues.push(issue('/', 'value', 'Field catalog exceeds the V1 descriptor cap.'));
	}
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const path = `/${index}`;
		const item = inspectObject(value[index], path, [
			'canonicalKey', 'displayName', 'description', 'valueType', 'source',
			'mappingStatus', 'readable', 'mutationClass', 'mutationOwner',
			'requiresStableTaxonomyId',
		], issues);
		if (!item) continue;
		checkNonEmptyString(item.canonicalKey, `${path}/canonicalKey`, issues);
		checkNonEmptyString(item.displayName, `${path}/displayName`, issues);
		if (typeof item.description !== 'string') issues.push(issue(`${path}/description`, 'type', 'Expected a string.'));
		checkCharacterCap(item.canonicalKey, `${path}/canonicalKey`, FIELD_CATALOG_LIMITS_V1.canonicalKeyCharacters, issues);
		checkCharacterCap(item.displayName, `${path}/displayName`, FIELD_CATALOG_LIMITS_V1.displayNameCharacters, issues);
		checkCharacterCap(item.description, `${path}/description`, FIELD_CATALOG_LIMITS_V1.descriptionCharacters, issues);
		checkEnum(item.valueType, FIELD_VALUE_TYPES_V1, `${path}/valueType`, issues);
		checkEnum(item.source, ['built-in', 'custom'], `${path}/source`, issues);
		checkEnum(item.mappingStatus, ['mapped', 'unmapped', 'collision', 'reserved'], `${path}/mappingStatus`, issues);
		checkBoolean(item.readable, `${path}/readable`, issues);
		checkEnum(item.mutationClass, MUTATION_CLASSES_V1, `${path}/mutationClass`, issues);
		if (item.mutationOwner !== undefined) {
			checkNonEmptyString(item.mutationOwner, `${path}/mutationOwner`, issues);
			checkCharacterCap(
				item.mutationOwner,
				`${path}/mutationOwner`,
				FIELD_CATALOG_LIMITS_V1.mutationOwnerCharacters,
				issues,
			);
		}
		checkBoolean(item.requiresStableTaxonomyId, `${path}/requiresStableTaxonomyId`, issues);
		if (typeof item.canonicalKey === 'string') {
			if (seen.has(item.canonicalKey)) issues.push(issue(`${path}/canonicalKey`, 'value', 'Duplicate canonical key.'));
			seen.add(item.canonicalKey);
		}
		const mapped = item.mappingStatus === 'mapped';
		if (typeof item.readable === 'boolean' && item.readable !== mapped) {
			issues.push(issue(`${path}/readable`, 'value', 'Only mapped fields can be readable.'));
		}
		if (
			item.mutationClass === 'general-update'
			&& (!mapped || item.readable !== true || item.mutationOwner !== 'tasks.update')
		) {
			issues.push(issue(
				`${path}/mutationClass`,
				'value',
				'General-update fields must be mapped, readable, and owned by tasks.update.',
			));
		}
	}
	return finish<FieldDescriptorV1[]>(value, issues);
}

export function decodeCatalogRequestV1(value: unknown): DecodeResultV1<CatalogRequestV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', ['contractVersion', 'requestId', 'kind', 'consistency'], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'catalog', '/kind', issues);
	checkEnum(object.consistency, ['live-verified', 'best-effort', 'offline-unverified'], '/consistency', issues);
	return finish<CatalogRequestV1>(value, issues);
}

export function decodeTimerReadRequestV1(value: unknown): DecodeResultV1<TimerReadRequestV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', ['contractVersion', 'requestId', 'kind', 'consistency'], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'timer-read', '/kind', issues);
	checkEnum(object.consistency, ['live-verified', 'best-effort', 'offline-unverified'], '/consistency', issues);
	return finish<TimerReadRequestV1>(value, issues);
}

export function decodeTimerReadResultV1(value: unknown): DecodeResultV1<TimerReadResultV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'freshness', 'warnings',
		'state', 'contextRevision', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'timer-read-result', '/kind', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkFreshness(object.freshness, '/freshness', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.ok === true) {
		if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful timer read cannot contain an error.'));
		checkContextRevision(object.contextRevision, '/contextRevision', issues);
		checkTimerState(object.state, '/state', issues);
	} else if (object.ok === false) {
		if (object.state !== undefined || object.contextRevision !== undefined) {
			issues.push(issue('/', 'value', 'Failed timer read cannot contain state or contextRevision.'));
		}
		checkStructuredError(object.error, '/error', issues);
	}
	return finish<TimerReadResultV1>(value, issues);
}

function checkTimerState(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['active', 'transition'], issues);
	if (!object) return;
	if (object.active !== null) {
		const active = inspectObject(
			object.active,
			`${path}/active`,
			['operonId', 'start', 'source', 'elapsedSeconds', 'isUnassigned'],
			issues,
		);
		if (active) {
			if (active.operonId !== null) checkCanonicalOperonId(active.operonId, `${path}/active/operonId`, issues);
			checkNonEmptyString(active.start, `${path}/active/start`, issues);
			checkNonEmptyString(active.source, `${path}/active/source`, issues);
			checkNonNegativeInteger(active.elapsedSeconds, `${path}/active/elapsedSeconds`, issues);
			checkBoolean(active.isUnassigned, `${path}/active/isUnassigned`, issues);
		}
	}
	if (object.transition !== null) {
		const transition = inspectObject(
			object.transition,
			`${path}/transition`,
			['kind', 'operonId', 'start'],
			issues,
		);
		if (transition) {
			checkEnum(transition.kind, ['starting', 'stopping'], `${path}/transition/kind`, issues);
			if (transition.operonId !== null) {
				checkCanonicalOperonId(transition.operonId, `${path}/transition/operonId`, issues);
			}
			checkNonEmptyString(transition.start, `${path}/transition/start`, issues);
		}
	}
}

export function decodeOperonCatalogV1(value: unknown): DecodeResultV1<OperonCatalogV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'freshness', 'warnings',
		'contextRevision', 'settingsFingerprint', 'catalogRevision', 'taxonomy', 'fields', 'policies', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'catalog-result', '/kind', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkFreshness(object.freshness, '/freshness', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
	if (object.ok === true) {
		if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful catalog cannot contain an error.'));
		checkSha256(object.settingsFingerprint, '/settingsFingerprint', issues);
		checkSha256(object.catalogRevision, '/catalogRevision', issues);
		checkCatalogNestedBounds({
			taxonomy: object.taxonomy,
			fields: object.fields,
			policies: object.policies,
		}, '/', issues);
		checkCatalogTaxonomy(object.taxonomy, '/taxonomy', issues);
		const fields = decodeFieldCatalogV1(object.fields);
		if (fields.ok === false) {
			fields.issues.forEach(item => issues.push({
				...item,
				path: `/fields${item.path === '/' ? '' : item.path}`,
			}));
		}
		checkCatalogPolicies(object.policies, '/policies', issues);
		if (
			typeof object.settingsFingerprint === 'string'
			&& typeof object.catalogRevision === 'string'
			&& object.taxonomy !== undefined
			&& object.fields !== undefined
			&& object.policies !== undefined
		) {
			try {
				const expectedCatalogRevision = sha256HexV1(canonicalJsonV1(toJsonValueV1({
					settingsFingerprint: object.settingsFingerprint,
					taxonomy: object.taxonomy,
					fields: object.fields,
					policies: object.policies,
				})));
				if (object.catalogRevision !== expectedCatalogRevision) {
					issues.push(issue('/catalogRevision', 'value', 'Catalog revision does not match the catalog contents.'));
				}
			} catch {
				issues.push(issue('/catalogRevision', 'value', 'Catalog contents cannot be hashed canonically.'));
			}
		}
		if (object.contextRevision === undefined) {
			issues.push(issue('/contextRevision', 'required', 'Successful catalog requires a context revision.'));
		} else if (
			isPlainRecord(object.contextRevision)
			&& object.contextRevision.settingsFingerprint !== object.settingsFingerprint
		) {
			issues.push(issue('/settingsFingerprint', 'value', 'Catalog fingerprint must match its context revision.'));
		}
	} else if (object.ok === false) {
		if (object.error === undefined) issues.push(issue('/error', 'required', 'Failed catalog requires an error.'));
		else checkStructuredError(object.error, '/error', issues);
		for (const field of ['settingsFingerprint', 'catalogRevision', 'taxonomy', 'fields', 'policies']) {
			if (object[field] !== undefined) {
				issues.push(issue(`/${field}`, 'value', 'Failed catalog cannot expose a partial catalog.'));
			}
		}
	}
	return finish<OperonCatalogV1>(value, issues);
}

function checkCatalogTaxonomy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['defaultPipeline', 'defaultPriority', 'pipelines', 'priorities'], issues);
	if (!object) return;
	checkCatalogDefaultReference(object.defaultPipeline, `${path}/defaultPipeline`, issues);
	checkCatalogDefaultReference(object.defaultPriority, `${path}/defaultPriority`, issues);
	if (!Array.isArray(object.pipelines)) {
		issues.push(issue(`${path}/pipelines`, 'type', 'Expected an array.'));
	} else {
		if (object.pipelines.length > CATALOG_LIMITS_V1.pipelines) {
			issues.push(issue(`${path}/pipelines`, 'value', 'Pipeline catalog exceeds the V1 cap.'));
		}
		const ids = new Set<string>();
		object.pipelines.forEach((entry, index) => {
			const itemPath = `${path}/pipelines/${index}`;
			const item = inspectObject(entry, itemPath, ['id', 'name', 'description', 'order', 'identityStatus', 'statuses'], issues);
			if (!item) return;
			checkCatalogIdentity(item.id, `${itemPath}/id`, ids, issues);
			checkNonEmptyString(item.name, `${itemPath}/name`, issues);
			if (typeof item.description !== 'string') issues.push(issue(`${itemPath}/description`, 'type', 'Expected a string.'));
			checkCharacterCap(item.description, `${itemPath}/description`, CATALOG_LIMITS_V1.textCharacters, issues);
			checkLiteral(item.order, index, `${itemPath}/order`, issues);
			checkEnum(item.identityStatus, ['resolved', 'ambiguous'], `${itemPath}/identityStatus`, issues);
			checkCatalogStatuses(item.statuses, itemPath, issues);
		});
	}
	if (!Array.isArray(object.priorities)) {
		issues.push(issue(`${path}/priorities`, 'type', 'Expected an array.'));
	} else {
		if (object.priorities.length > CATALOG_LIMITS_V1.priorities) {
			issues.push(issue(`${path}/priorities`, 'value', 'Priority catalog exceeds the V1 cap.'));
		}
		const ids = new Set<string>();
		object.priorities.forEach((entry, index) => {
			const itemPath = `${path}/priorities/${index}`;
			const item = inspectObject(entry, itemPath, [
				'id', 'label', 'description', 'order', 'color', 'icon', 'isDefault', 'identityStatus',
			], issues);
			if (!item) return;
			checkCatalogIdentity(item.id, `${itemPath}/id`, ids, issues);
			checkNonEmptyString(item.label, `${itemPath}/label`, issues);
			if (typeof item.description !== 'string') issues.push(issue(`${itemPath}/description`, 'type', 'Expected a string.'));
			checkCharacterCap(item.description, `${itemPath}/description`, CATALOG_LIMITS_V1.textCharacters, issues);
			checkLiteral(item.order, index, `${itemPath}/order`, issues);
			checkNonEmptyString(item.color, `${itemPath}/color`, issues);
			if (item.icon !== undefined) checkNonEmptyString(item.icon, `${itemPath}/icon`, issues);
			checkBoolean(item.isDefault, `${itemPath}/isDefault`, issues);
			checkEnum(item.identityStatus, ['resolved', 'ambiguous'], `${itemPath}/identityStatus`, issues);
		});
	}
}

function checkCatalogStatuses(value: unknown, pipelinePath: string, issues: DecodeIssueV1[]): void {
	const path = `${pipelinePath}/statuses`;
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CATALOG_LIMITS_V1.statusesPerPipeline) {
		issues.push(issue(path, 'value', 'Status catalog exceeds the per-pipeline V1 cap.'));
	}
	const ids = new Set<string>();
	value.forEach((entry, index) => {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(entry, itemPath, [
			'id', 'label', 'order', 'color', 'icon', 'propertyMapping',
			'isFinished', 'isCancelled', 'isScheduledTarget', 'isTrackingTarget',
			'identityStatus',
		], issues);
		if (!item) return;
		checkCatalogIdentity(item.id, `${itemPath}/id`, ids, issues);
		checkNonEmptyString(item.label, `${itemPath}/label`, issues);
		checkLiteral(item.order, index, `${itemPath}/order`, issues);
		checkNonEmptyString(item.color, `${itemPath}/color`, issues);
		if (item.icon !== undefined) checkNonEmptyString(item.icon, `${itemPath}/icon`, issues);
		if (item.propertyMapping !== undefined) checkNonEmptyString(item.propertyMapping, `${itemPath}/propertyMapping`, issues);
		checkBoolean(item.isFinished, `${itemPath}/isFinished`, issues);
		checkBoolean(item.isCancelled, `${itemPath}/isCancelled`, issues);
		checkBoolean(item.isScheduledTarget, `${itemPath}/isScheduledTarget`, issues);
		checkBoolean(item.isTrackingTarget, `${itemPath}/isTrackingTarget`, issues);
		checkEnum(item.identityStatus, ['resolved', 'ambiguous'], `${itemPath}/identityStatus`, issues);
	});
}

function checkCatalogIdentity(
	value: unknown,
	path: string,
	seen: Set<string>,
	issues: DecodeIssueV1[],
): void {
	checkNonEmptyString(value, path, issues);
	if (typeof value !== 'string') return;
	if (seen.has(value)) issues.push(issue(path, 'value', 'Catalog stable IDs must be unique.'));
	seen.add(value);
}

function checkCatalogDefaultReference(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['configuredValue', 'id', 'status'], issues);
	if (!object) return;
	if (typeof object.configuredValue !== 'string') issues.push(issue(`${path}/configuredValue`, 'type', 'Expected a string.'));
	if (object.id !== undefined) checkNonEmptyString(object.id, `${path}/id`, issues);
	checkEnum(object.status, ['resolved', 'none', 'ambiguous', 'unavailable'], `${path}/status`, issues);
	if (object.status === 'resolved' && object.id === undefined) {
		issues.push(issue(`${path}/id`, 'required', 'Resolved default reference requires a stable ID.'));
	}
	if (object.status !== 'resolved' && object.id !== undefined) {
		issues.push(issue(`${path}/id`, 'value', 'Unresolved default reference cannot claim a stable ID.'));
	}
}

function checkCatalogPolicies(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'sourceTransitionRecoveryVersion', 'sourceTransitionRecoveryFeatures',
		'creation', 'inheritance', 'exclusions', 'filters', 'automation', 'reminders',
		'conversion', 'taskUpdate', 'relationships', 'transitions', 'timer', 'inlineRelocation',
		'deletion', 'projectSerialScopes',
	], issues);
	if (!object) return;
	const hasSourceTransitionRecoveryVersion =
		object.sourceTransitionRecoveryVersion !== undefined;
	const hasSourceTransitionRecoveryFeatures =
		object.sourceTransitionRecoveryFeatures !== undefined;
	if (hasSourceTransitionRecoveryVersion !== hasSourceTransitionRecoveryFeatures) {
		issues.push(issue(
			path,
			'required',
			'Source transition recovery version and features must be advertised together.',
		));
	}
	if (hasSourceTransitionRecoveryVersion) {
		checkLiteral(
			object.sourceTransitionRecoveryVersion,
			1,
			`${path}/sourceTransitionRecoveryVersion`,
			issues,
		);
	}
	if (hasSourceTransitionRecoveryFeatures) {
		checkExactStringArray(
			object.sourceTransitionRecoveryFeatures,
			SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
			`${path}/sourceTransitionRecoveryFeatures`,
			issues,
		);
	}
	checkCatalogCreationPolicy(object.creation, `${path}/creation`, issues);
	checkCatalogInheritancePolicy(object.inheritance, `${path}/inheritance`, issues);
	const exclusions = inspectObject(object.exclusions, `${path}/exclusions`, ['folders'], issues);
	if (exclusions) checkCatalogPathArray(exclusions.folders, `${path}/exclusions/folders`, issues);
	checkCatalogFilters(object.filters, `${path}/filters`, issues);
	checkCatalogAutomationPolicy(object.automation, `${path}/automation`, issues);
	checkCatalogReminderPolicy(object.reminders, `${path}/reminders`, issues);
	checkCatalogConversionPolicy(object.conversion, `${path}/conversion`, issues);
	const taskUpdate = inspectObject(object.taskUpdate, `${path}/taskUpdate`, [
		'writableKeys',
		'customKeyPolicy',
		'compactUpdateBatchVersion',
		'compactUpdateBatchInputFormat',
		'compactUpdateBatchMaxItems',
		'compactUpdateBatchFeatures',
	], issues);
	if (taskUpdate) {
		checkStringArray(taskUpdate.writableKeys, `${path}/taskUpdate/writableKeys`, issues);
		checkLiteral(
			taskUpdate.customKeyPolicy,
			'active-valid-nonreserved-text-number-date-datetime-list-checkbox',
			`${path}/taskUpdate/customKeyPolicy`,
			issues,
		);
		const batchFields = [
			taskUpdate.compactUpdateBatchVersion,
			taskUpdate.compactUpdateBatchInputFormat,
			taskUpdate.compactUpdateBatchMaxItems,
			taskUpdate.compactUpdateBatchFeatures,
		];
		const batchFieldCount = batchFields.filter(item => item !== undefined).length;
		if (batchFieldCount !== 0 && batchFieldCount !== batchFields.length) {
			issues.push(issue(
				`${path}/taskUpdate`,
				'required',
				'Compact update batch fields must be advertised together.',
			));
		}
		if (taskUpdate.compactUpdateBatchVersion !== undefined) {
			checkLiteral(
				taskUpdate.compactUpdateBatchVersion,
				1,
				`${path}/taskUpdate/compactUpdateBatchVersion`,
				issues,
			);
		}
		if (taskUpdate.compactUpdateBatchInputFormat !== undefined) {
			checkLiteral(
				taskUpdate.compactUpdateBatchInputFormat,
				'compact-lines',
				`${path}/taskUpdate/compactUpdateBatchInputFormat`,
				issues,
			);
		}
		if (taskUpdate.compactUpdateBatchMaxItems !== undefined) {
			checkLiteral(
				taskUpdate.compactUpdateBatchMaxItems,
				64,
				`${path}/taskUpdate/compactUpdateBatchMaxItems`,
				issues,
			);
		}
		if (taskUpdate.compactUpdateBatchFeatures !== undefined) {
			checkExactStringArray(
				taskUpdate.compactUpdateBatchFeatures,
				COMPACT_UPDATE_BATCH_FEATURES_V1,
				`${path}/taskUpdate/compactUpdateBatchFeatures`,
				issues,
			);
		}
	}
	const relationships = inspectObject(object.relationships, `${path}/relationships`, [
		'writableFields', 'actions', 'parentMaxTargets', 'dependencyInverseWrites',
	], issues);
	if (relationships) {
		checkExactStringArray(
			relationships.writableFields,
			['parentTask', 'blocking', 'blockedBy'],
			`${path}/relationships/writableFields`,
			issues,
		);
		checkExactStringArray(
			relationships.actions,
			['replace', 'clear'],
			`${path}/relationships/actions`,
			issues,
		);
		checkLiteral(relationships.parentMaxTargets, 1, `${path}/relationships/parentMaxTargets`, issues);
		checkLiteral(
			relationships.dependencyInverseWrites,
			true,
			`${path}/relationships/dependencyInverseWrites`,
			issues,
		);
	}
	checkCatalogActionPolicy(object.transitions, `${path}/transitions`, ['set-status', 'complete', 'cancel', 'reopen'], issues);
	checkCatalogActionPolicy(object.timer, `${path}/timer`, ['start', 'stop'], issues);
	const relocation = inspectObject(object.inlineRelocation, `${path}/inlineRelocation`, ['target'], issues);
	if (relocation) checkLiteral(relocation.target, 'exact-blank-line', `${path}/inlineRelocation/target`, issues);
	const deletion = inspectObject(object.deletion, `${path}/deletion`, [
		'requiresExplicitConfirmation', 'deleteAdditionalTasks', 'referenceCleanup',
	], issues);
	if (deletion) {
		checkLiteral(deletion.requiresExplicitConfirmation, true, `${path}/deletion/requiresExplicitConfirmation`, issues);
		checkLiteral(deletion.deleteAdditionalTasks, false, `${path}/deletion/deleteAdditionalTasks`, issues);
		checkLiteral(deletion.referenceCleanup, 'explicit-or-block', `${path}/deletion/referenceCleanup`, issues);
	}
	checkProjectSerialScopes(object.projectSerialScopes, `${path}/projectSerialScopes`, issues);
}

function checkCatalogCreationPolicy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'descriptionRequired', 'assigneesRequired', 'defaultEstimateMinutes', 'defaultToFileTask',
		'fileTaskTargetFolder', 'fileTaskTemplateFolder', 'defaultFileTemplateId',
		'inlineTaskSaveMode', 'inlineTaskTargetFile', 'inlineTaskHeading',
		'dailyNoteAddsStartDate', 'dailyNoteAddsScheduledDate', 'createDailyNotesAsFileTasks',
		'calendarInlineTaskHeading', 'builtInTemplateCandidates', 'fileTaskTemplateCandidates',
		'typedCreateVersion', 'typedCreateFeatures',
		'temporalCreateVersion', 'temporalCreateKeys',
		'compactBatchVersion', 'compactBatchInputFormat', 'compactBatchMaxItems',
		'graphTransactionVersion', 'graphTransactionFeatures',
	], issues);
	if (!object) return;
	for (const key of [
		'descriptionRequired', 'assigneesRequired', 'defaultToFileTask',
		'dailyNoteAddsStartDate', 'dailyNoteAddsScheduledDate', 'createDailyNotesAsFileTasks',
	]) checkBoolean(object[key], `${path}/${key}`, issues);
	checkNonNegativeInteger(object.defaultEstimateMinutes, `${path}/defaultEstimateMinutes`, issues);
	for (const key of ['fileTaskTargetFolder', 'fileTaskTemplateFolder', 'inlineTaskTargetFile']) {
		checkOptionalCatalogPath(object[key], `${path}/${key}`, issues);
	}
	for (const key of ['inlineTaskHeading', 'calendarInlineTaskHeading']) {
		if (typeof object[key] !== 'string') issues.push(issue(`${path}/${key}`, 'type', 'Expected a string.'));
	}
	if (object.defaultFileTemplateId !== undefined) checkNonEmptyString(object.defaultFileTemplateId, `${path}/defaultFileTemplateId`, issues);
	const hasTypedCreateVersion = object.typedCreateVersion !== undefined;
	const hasTypedCreateFeatures = object.typedCreateFeatures !== undefined;
	if (hasTypedCreateVersion !== hasTypedCreateFeatures) {
		issues.push(issue(path, 'required', 'Typed create version and features must be advertised together.'));
	}
	if (hasTypedCreateVersion) {
		checkLiteral(object.typedCreateVersion, 1, `${path}/typedCreateVersion`, issues);
	}
	if (hasTypedCreateFeatures) {
		checkExactStringArray(
			object.typedCreateFeatures,
			TYPED_CREATE_FEATURES_V1,
			`${path}/typedCreateFeatures`,
			issues,
		);
	}
	const hasTemporalCreateVersion = object.temporalCreateVersion !== undefined;
	const hasTemporalCreateKeys = object.temporalCreateKeys !== undefined;
	if (hasTemporalCreateVersion !== hasTemporalCreateKeys) {
		issues.push(issue(path, 'required', 'Temporal create version and keys must be advertised together.'));
	}
	if (hasTemporalCreateVersion) {
		checkLiteral(object.temporalCreateVersion, 1, `${path}/temporalCreateVersion`, issues);
	}
	if (hasTemporalCreateKeys) {
		checkExactStringArray(
			object.temporalCreateKeys,
			TEMPORAL_CREATE_KEYS_V1,
			`${path}/temporalCreateKeys`,
			issues,
		);
	}
	const compactBatchFields = [
		object.compactBatchVersion,
		object.compactBatchInputFormat,
		object.compactBatchMaxItems,
	];
	const compactBatchFieldCount = compactBatchFields.filter(item => item !== undefined).length;
	if (compactBatchFieldCount !== 0 && compactBatchFieldCount !== compactBatchFields.length) {
		issues.push(issue(path, 'required', 'Compact batch version, input format, and max items must be advertised together.'));
	}
	if (object.compactBatchVersion !== undefined) {
		checkLiteral(object.compactBatchVersion, 1, `${path}/compactBatchVersion`, issues);
	}
	if (object.compactBatchInputFormat !== undefined) {
		checkLiteral(object.compactBatchInputFormat, 'compact-lines', `${path}/compactBatchInputFormat`, issues);
	}
	if (object.compactBatchMaxItems !== undefined) {
		checkLiteral(object.compactBatchMaxItems, CONTRACT_LIMITS_V1.createItems, `${path}/compactBatchMaxItems`, issues);
	}
	const hasGraphTransactionVersion = object.graphTransactionVersion !== undefined;
	const hasGraphTransactionFeatures = object.graphTransactionFeatures !== undefined;
	if (hasGraphTransactionVersion !== hasGraphTransactionFeatures) {
		issues.push(issue(path, 'required', 'Graph transaction version and features must be advertised together.'));
	}
	if (hasGraphTransactionVersion) {
		checkLiteral(object.graphTransactionVersion, 1, `${path}/graphTransactionVersion`, issues);
	}
	if (hasGraphTransactionFeatures) {
		checkExactStringArray(
			object.graphTransactionFeatures,
			GRAPH_TRANSACTION_FEATURES_V1,
			`${path}/graphTransactionFeatures`,
			issues,
		);
	}
	checkEnum(
		object.inlineTaskSaveMode,
		['daily-notes', 'specific-file', 'active-file', 'ask-every-time'],
		`${path}/inlineTaskSaveMode`,
		issues,
	);
	if (!Array.isArray(object.builtInTemplateCandidates)) {
		issues.push(issue(`${path}/builtInTemplateCandidates`, 'type', 'Expected an array.'));
	} else {
		if (object.builtInTemplateCandidates.length > CATALOG_LIMITS_V1.templateCandidates) {
			issues.push(issue(`${path}/builtInTemplateCandidates`, 'value', 'Template candidates exceed the V1 cap.'));
		}
		object.builtInTemplateCandidates.forEach((entry, index) => {
			const itemPath = `${path}/builtInTemplateCandidates/${index}`;
			const item = inspectObject(entry, itemPath, ['id', 'pipelineId', 'initialStatusId'], issues);
			if (!item) return;
			checkNonEmptyString(item.id, `${itemPath}/id`, issues);
			checkNonEmptyString(item.pipelineId, `${itemPath}/pipelineId`, issues);
			checkNonEmptyString(item.initialStatusId, `${itemPath}/initialStatusId`, issues);
		});
	}
	if (object.fileTaskTemplateCandidates !== undefined) {
		checkFileTaskTemplateCandidates(object.fileTaskTemplateCandidates, `${path}/fileTaskTemplateCandidates`, issues);
	}
}

function checkFileTaskTemplateCandidates(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CATALOG_LIMITS_V1.templateCandidates) {
		issues.push(issue(path, 'value', 'Template candidates exceed the V1 cap.'));
	}
	value.forEach((entry, index) => {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(entry, itemPath, [
			'id', 'name', 'kind', 'sourcePath', 'pipelineId', 'initialStatusId',
		], issues);
		if (!item) return;
		checkNonEmptyString(item.id, `${itemPath}/id`, issues);
		checkNonEmptyString(item.name, `${itemPath}/name`, issues);
		checkEnum(item.kind, ['builtin-pipeline-minimal', 'folder'], `${itemPath}/kind`, issues);
		if (item.sourcePath !== undefined) {
			checkOptionalCatalogPath(item.sourcePath, `${itemPath}/sourcePath`, issues);
			if (item.sourcePath === '') {
				issues.push(issue(`${itemPath}/sourcePath`, 'value', 'Expected a non-empty vault-relative path.'));
			}
		}
		if (item.pipelineId !== undefined) checkNonEmptyString(item.pipelineId, `${itemPath}/pipelineId`, issues);
		if (item.initialStatusId !== undefined) {
			checkNonEmptyString(item.initialStatusId, `${itemPath}/initialStatusId`, issues);
		}
	});
}

function checkCatalogInheritancePolicy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'fields', 'statusPipelineSource', 'autoParentFileTask', 'autoParentLinkedFileSubtasks',
		'fileTaskParentInlineTargetMode', 'fileTaskParentFileTargetMode',
		'inlineTaskParentInlineTargetMode', 'inlineTaskParentFileTargetMode',
		'inlineTaskParentFileHeadingKeyword',
	], issues);
	if (!object) return;
	checkStringArray(object.fields, `${path}/fields`, issues);
	checkEnum(object.statusPipelineSource, ['parent', 'default'], `${path}/statusPipelineSource`, issues);
	checkBoolean(object.autoParentFileTask, `${path}/autoParentFileTask`, issues);
	checkBoolean(object.autoParentLinkedFileSubtasks, `${path}/autoParentLinkedFileSubtasks`, issues);
	checkEnum(object.fileTaskParentInlineTargetMode, ['default', 'same-folder'], `${path}/fileTaskParentInlineTargetMode`, issues);
	checkEnum(object.fileTaskParentFileTargetMode, ['default', 'same-folder'], `${path}/fileTaskParentFileTargetMode`, issues);
	checkEnum(object.inlineTaskParentInlineTargetMode, ['default', 'below-parent'], `${path}/inlineTaskParentInlineTargetMode`, issues);
	checkEnum(object.inlineTaskParentFileTargetMode, ['default', 'inside-parent-file'], `${path}/inlineTaskParentFileTargetMode`, issues);
	if (typeof object.inlineTaskParentFileHeadingKeyword !== 'string') {
		issues.push(issue(`${path}/inlineTaskParentFileHeadingKeyword`, 'type', 'Expected a string.'));
	}
}

function checkCatalogAutomationPolicy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const keys = [
		'autoCompleteParentWhenAllChildrenTerminal', 'cascadeCancelToDescendants',
		'newOccurrencePosition', 'fileTaskAutoArchiveEnabled', 'fileTaskArchiveFolder',
		'fileTaskArchiveDelaySeconds', 'fileTaskArchiveOnlyFromFileTasksFolder',
		'fileRepeatDestination', 'fileRepeatCustomFolder', 'estimateAutoReallocation',
		'trackerSplitSessionsAtMidnight', 'reminderCatchUpWindowMinutes',
		'reminderAutoPinDueTasks', 'pinnedDockAutoPin', 'pinnedDockAutoUnpinFinished',
	];
	const object = inspectObject(value, path, keys, issues);
	if (!object) return;
	for (const key of [
		'autoCompleteParentWhenAllChildrenTerminal', 'cascadeCancelToDescendants',
		'fileTaskAutoArchiveEnabled', 'fileTaskArchiveOnlyFromFileTasksFolder',
		'estimateAutoReallocation', 'trackerSplitSessionsAtMidnight',
		'reminderAutoPinDueTasks', 'pinnedDockAutoPin', 'pinnedDockAutoUnpinFinished',
	]) checkBoolean(object[key], `${path}/${key}`, issues);
	checkEnum(object.newOccurrencePosition, ['above', 'below'], `${path}/newOccurrencePosition`, issues);
	checkEnum(object.fileRepeatDestination, ['same-folder', 'custom-folder'], `${path}/fileRepeatDestination`, issues);
	checkOptionalCatalogPath(object.fileTaskArchiveFolder, `${path}/fileTaskArchiveFolder`, issues);
	checkOptionalCatalogPath(object.fileRepeatCustomFolder, `${path}/fileRepeatCustomFolder`, issues);
	checkNonNegativeInteger(object.fileTaskArchiveDelaySeconds, `${path}/fileTaskArchiveDelaySeconds`, issues);
	checkNonNegativeInteger(object.reminderCatchUpWindowMinutes, `${path}/reminderCatchUpWindowMinutes`, issues);
}

function checkCatalogReminderPolicy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['fields', 'ruleAnchors', 'itemActions'], issues);
	if (!object) return;
	if (!Array.isArray(object.fields) || object.fields.length !== 2) {
		issues.push(issue(`${path}/fields`, 'value', 'Reminder policy requires exactly two field entries.'));
	} else {
		object.fields.forEach((entry, index) => {
			const itemPath = `${path}/fields/${index}`;
			const item = inspectObject(entry, itemPath, [
				'canonicalKey', 'availability', 'visiblePropertyName',
			], issues);
			if (!item) return;
			checkEnum(item.canonicalKey, ['reminderDatetimes', 'reminderRules'], `${itemPath}/canonicalKey`, issues);
			checkEnum(item.availability, ['available', 'unavailable', 'collision'], `${itemPath}/availability`, issues);
			if (item.visiblePropertyName !== undefined) checkNonEmptyString(item.visiblePropertyName, `${itemPath}/visiblePropertyName`, issues);
		});
	}
	checkExactStringArray(
		object.ruleAnchors,
		['datetimeStart', 'datetimeEnd', 'dateStarted', 'dateScheduled', 'dateDue'],
		`${path}/ruleAnchors`,
		issues,
	);
	checkExactStringArray(object.itemActions, ['add', 'replace', 'remove'], `${path}/itemActions`, issues);
}

function checkCatalogConversionPolicy(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'directions', 'templateSelection', 'targetModes',
		'inlineToFileMovesPlainCheckboxes', 'fileToInlineRequiresExplicitConfirmation',
	], issues);
	if (!object) return;
	checkExactStringArray(object.directions, ['inline-to-file', 'file-to-inline'], `${path}/directions`, issues);
	checkLiteral(object.templateSelection, 'explicit-or-needs-template', `${path}/templateSelection`, issues);
	checkExactStringArray(object.targetModes, ['exact-line', 'configured-target'], `${path}/targetModes`, issues);
	checkBoolean(object.inlineToFileMovesPlainCheckboxes, `${path}/inlineToFileMovesPlainCheckboxes`, issues);
	checkLiteral(object.fileToInlineRequiresExplicitConfirmation, true, `${path}/fileToInlineRequiresExplicitConfirmation`, issues);
}

function checkCatalogFilters(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CATALOG_LIMITS_V1.filters) issues.push(issue(path, 'value', 'Saved filters exceed the V1 cap.'));
	let nodeCount = 0;
	value.forEach((entry, index) => {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(entry, itemPath, [
			'id', 'name', 'icon', 'root', 'sorts', 'subgroupBy',
			'subgroupOrder', 'groupBy', 'groupOrder',
		], issues);
		if (!item) return;
		checkNonEmptyString(item.id, `${itemPath}/id`, issues);
		checkNonEmptyString(item.name, `${itemPath}/name`, issues);
		if (item.icon !== undefined) checkNonEmptyString(item.icon, `${itemPath}/icon`, issues);
		nodeCount += checkCatalogFilterNode(item.root, `${itemPath}/root`, issues);
		if (!Array.isArray(item.sorts)) issues.push(issue(`${itemPath}/sorts`, 'type', 'Expected an array.'));
		else item.sorts.forEach((sort, sortIndex) => {
			const sortPath = `${itemPath}/sorts/${sortIndex}`;
			const sortObject = inspectObject(sort, sortPath, ['field', 'order'], issues);
			if (!sortObject) return;
			checkNonEmptyString(sortObject.field, `${sortPath}/field`, issues);
			checkEnum(sortObject.order, ['asc', 'desc'], `${sortPath}/order`, issues);
		});
		for (const key of ['subgroupBy', 'groupBy']) {
			if (item[key] !== undefined) checkNonEmptyString(item[key], `${itemPath}/${key}`, issues);
		}
		for (const key of ['subgroupOrder', 'groupOrder']) {
			if (item[key] !== undefined) checkEnum(item[key], ['asc', 'desc'], `${itemPath}/${key}`, issues);
		}
	});
	if (nodeCount > CATALOG_LIMITS_V1.filterNodes) issues.push(issue(path, 'value', 'Saved filter nodes exceed the V1 cap.'));
}

function checkCatalogFilterNode(value: unknown, path: string, issues: DecodeIssueV1[], depth = 0): number {
	if (depth > 64) {
		issues.push(issue(path, 'value', 'Saved filter nesting exceeds the V1 depth cap.'));
		return 0;
	}
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a filter node.'));
		return 0;
	}
	if (value.kind === 'group') {
		const item = inspectObject(value, path, ['kind', 'id', 'logic', 'children'], issues);
		if (!item) return 0;
		checkNonEmptyString(item.id, `${path}/id`, issues);
		checkEnum(item.logic, ['all', 'any', 'none'], `${path}/logic`, issues);
		if (!Array.isArray(item.children)) {
			issues.push(issue(`${path}/children`, 'type', 'Expected an array.'));
			return 1;
		}
		let count = 1;
		for (const [index, child] of (item.children as unknown[]).entries()) {
			count += checkCatalogFilterNode(child, `${path}/children/${index}`, issues, depth + 1);
			if (count > CATALOG_LIMITS_V1.filterNodes) break;
		}
		return count;
	}
	if (value.kind === 'condition') {
		const item = inspectObject(value, path, ['kind', 'id', 'field', 'fieldType', 'operator', 'value', 'values'], issues);
		if (!item) return 0;
		for (const key of ['id', 'field', 'fieldType', 'operator']) checkNonEmptyString(item[key], `${path}/${key}`, issues);
		if (item.value !== undefined && typeof item.value !== 'string') issues.push(issue(`${path}/value`, 'type', 'Expected a string.'));
		if (item.values !== undefined) checkStringArray(item.values, `${path}/values`, issues);
		return 1;
	}
	issues.push(issue(`${path}/kind`, 'value', 'Unknown filter node kind.'));
	return 0;
}

function checkCatalogActionPolicy(
	value: unknown,
	path: string,
	actions: readonly string[],
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(value, path, ['actions'], issues);
	if (object) checkExactStringArray(object.actions, actions, `${path}/actions`, issues);
}

function checkProjectSerialScopes(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CATALOG_LIMITS_V1.projectSerialScopes) {
		issues.push(issue(path, 'value', 'Project Serial scopes exceed the V1 cap.'));
	}
	value.forEach((entry, index) => {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(entry, itemPath, ['id', 'prefix', 'parentOperonId'], issues);
		if (!item) return;
		checkNonEmptyString(item.id, `${itemPath}/id`, issues);
		checkNonEmptyString(item.prefix, `${itemPath}/prefix`, issues);
		checkCanonicalOperonId(item.parentOperonId, `${itemPath}/parentOperonId`, issues);
	});
}

function checkCatalogPathArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	checkStringArray(value, path, issues);
	if (!Array.isArray(value)) return;
	if (value.length > CATALOG_LIMITS_V1.pathItems) issues.push(issue(path, 'value', 'Path list exceeds the V1 cap.'));
	const items = value as unknown[];
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (typeof item !== 'string' || item === '') continue;
		const error = validateVaultRelativePathV1(item);
		if (error) issues.push(issue(`${path}/${index}`, 'value', error.reason));
	}
}

function checkOptionalCatalogPath(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') {
		issues.push(issue(path, 'type', 'Expected a string.'));
		return;
	}
	checkCharacterCap(value, path, CATALOG_LIMITS_V1.textCharacters, issues);
	if (value === '') return;
	const error = validateVaultRelativePathV1(value);
	if (error) issues.push(issue(path, 'value', error.reason));
}

function checkCatalogNestedBounds(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const pending: Array<{ value: unknown; path: string }> = [{ value, path }];
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (typeof current.value === 'string') {
			checkCharacterCap(current.value, current.path, CATALOG_LIMITS_V1.textCharacters, issues);
			continue;
		}
		if (Array.isArray(current.value)) {
			if (current.value.length > CONTRACT_LIMITS_V1.collectionItems) {
				issues.push(issue(current.path, 'value', 'Catalog collection exceeds the V1 item cap.'));
			}
			current.value.forEach((item, index) => pending.push({
				value: item,
				path: `${current.path}/${index}`,
			}));
			continue;
		}
		if (isPlainRecord(current.value)) {
			for (const [key, item] of Object.entries(current.value)) {
				pending.push({ value: item, path: `${current.path}/${key}` });
			}
		}
	}
}

function checkExactStringArray(
	value: unknown,
	expected: readonly string[],
	path: string,
	issues: DecodeIssueV1[],
): void {
	checkStringArray(value, path, issues);
	if (!Array.isArray(value)) return;
	if (value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
		issues.push(issue(path, 'value', 'Array differs from the frozen V1 order.'));
	}
}

export function decodeTaskSourceLocatorV1(value: unknown): DecodeResultV1<TaskSourceLocatorV1> {
	const issues: DecodeIssueV1[] = [];
	checkLocator(value, '', issues);
	return finish<TaskSourceLocatorV1>(value, issues);
}

export function decodeTaskContextV1(value: unknown): DecodeResultV1<TaskContextV1> {
	const issues: DecodeIssueV1[] = [];
	checkTaskContext(value, '', issues);
	return finish<TaskContextV1>(value, issues);
}

export function decodeEntityResolveRequestV1(value: unknown): DecodeResultV1<EntityResolveRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'entity-resolve', ['selector', 'limit'], issues);
	if (object) {
		checkSelector(object.selector, '/selector', issues);
		if (object.limit !== undefined) checkBoundedPositiveInteger(object.limit, '/limit', 500, issues);
	}
	return finish<EntityResolveRequestV1>(value, issues);
}

export function decodeEntityResolutionResultV1(value: unknown): DecodeResultV1<EntityResolutionResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'entity-resolution-result', [
		'contextRevision', 'resolution', 'candidates', 'selected', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['resolution', 'candidates'], ['selected'], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.resolution !== undefined) checkEnum(object.resolution, ['resolved', 'ambiguous', 'not-found'], '/resolution', issues);
		if (object.candidates !== undefined) checkCandidates(object.candidates, '/candidates', issues);
		if (object.selected !== undefined) checkCandidate(object.selected, '/selected', issues);
		if (object.ok === true && object.resolution === 'resolved' && object.selected === undefined) {
			issues.push(issue('/selected', 'required', 'Resolved entity result requires a selected candidate.'));
		}
		if (object.ok === true && object.resolution !== 'resolved' && object.selected !== undefined) {
			issues.push(issue('/selected', 'value', 'Only resolved entity results may select a candidate.'));
		}
	}
	return finish<EntityResolutionResultV1>(value, issues);
}

export function decodeTaskGetRequestV1(value: unknown): DecodeResultV1<TaskGetRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'task-get', ['selector', 'include'], issues);
	if (object) {
		checkSelector(object.selector, '/selector', issues);
		if (object.include !== undefined) checkTaskGetHydrationKeys(object.include, '/include', issues);
	}
	return finish<TaskGetRequestV1>(value, issues);
}

export function decodeTaskGetResultV1(value: unknown): DecodeResultV1<TaskGetResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'task-get-result', [
		'contextRevision', 'task', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['task', 'provenance', 'truncations'], [], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.task !== undefined) checkTaskContext(object.task, '/task', issues);
		if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
		if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	}
	return finish<TaskGetResultV1>(value, issues);
}

export function decodeTaskQueryRequestV1(value: unknown): DecodeResultV1<TaskQueryRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'task-query', ['filters', 'include', 'limit', 'cursor'], issues);
	if (object) {
		if (object.filters !== undefined) checkTaskQueryFilters(object.filters, '/filters', issues);
		if (object.include !== undefined) checkHydrationKeys(object.include, '/include', issues);
		if (object.limit !== undefined) checkBoundedPositiveInteger(object.limit, '/limit', 250, issues);
		if (object.cursor !== undefined) checkCursor(object.cursor, '/cursor', issues);
	}
	return finish<TaskQueryRequestV1>(value, issues);
}

export function decodeTaskQueryResultV1(value: unknown): DecodeResultV1<TaskQueryResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'task-query-result', [
		'contextRevision', 'tasks', 'page', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['tasks', 'page', 'provenance', 'truncations'], [], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.tasks !== undefined) checkTaskArray(object.tasks, '/tasks', 250, issues);
		if (object.page !== undefined) checkTaskQueryPage(object.page, '/page', issues);
		if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
		if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	}
	return finish<TaskQueryResultV1>(value, issues);
}

export function decodeTaskFilterQueryRequestV1(value: unknown): DecodeResultV1<TaskFilterQueryRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'task-filter-query', [
		'filterSetId', 'scope', 'include', 'limit', 'cursor',
	], issues);
	if (object) {
		checkBoundedNonEmptyString(object.filterSetId, '/filterSetId', 256, issues);
		if (object.scope !== undefined) {
			const scope = inspectObject(object.scope, '/scope', ['kind', 'path'], issues);
			if (scope) {
				checkEnum(scope.kind, ['exact-file', 'folder-tree'], '/scope/kind', issues);
				checkVaultRelativePath(scope.path, '/scope/path', issues);
			}
		}
		if (object.include !== undefined) checkHydrationKeys(object.include, '/include', issues);
		if (object.limit !== undefined) checkBoundedPositiveInteger(object.limit, '/limit', 250, issues);
		if (object.cursor !== undefined) checkCursor(object.cursor, '/cursor', issues);
	}
	return finish<TaskFilterQueryRequestV1>(value, issues);
}

export function decodeTaskFilterQueryResultV1(value: unknown): DecodeResultV1<TaskFilterQueryResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'task-filter-query-result', [
		'contextRevision', 'tasks', 'page', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['tasks', 'page', 'provenance', 'truncations'], [], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.tasks !== undefined) checkTaskArray(object.tasks, '/tasks', 250, issues);
		if (object.page !== undefined) checkTaskQueryPage(object.page, '/page', issues);
		if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
		if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	}
	return finish<TaskFilterQueryResultV1>(value, issues);
}

export function decodeTaskFinderRequestV1(value: unknown): DecodeResultV1<TaskFinderRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'task-finder', [
		'text', 'filters', 'representations', 'scope', 'project', 'limit', 'cursor',
	], issues);
	if (object) {
		if (object.text !== undefined) {
			checkNonEmptyString(object.text, '/text', issues);
			checkCharacterCap(object.text, '/text', 4_096, issues);
			if (typeof object.text === 'string' && object.text.trim().length < 2) {
				issues.push(issue('/text', 'value', 'Task Finder text requires at least two characters.'));
			}
			if (typeof object.text === 'string' && !/[\p{L}\p{N}]/u.test(object.text)) {
				issues.push(issue('/text', 'value', 'Task Finder text requires at least one letter or number.'));
			}
		}
		if (object.filters !== undefined) {
			checkTaskQueryFilters(object.filters, '/filters', issues);
			if (isPlainRecord(object.filters)) {
				for (const key of ['text', 'filePath', 'parentOperonId']) {
					if (object.filters[key] !== undefined) {
						issues.push(issue(`/filters/${key}`, 'unknown-field', 'Task Finder owns this filter at the request level.'));
					}
				}
			}
		}
		if (object.representations !== undefined) {
			checkStringEnumArray(object.representations, TASK_FINDER_REPRESENTATIONS_V1, '/representations', issues);
			checkUniqueStrings(object.representations, '/representations', issues);
			if (Array.isArray(object.representations) && object.representations.length === 0) {
				issues.push(issue('/representations', 'length', 'Task Finder representations requires at least one item.'));
			}
		}
		if (object.scope !== undefined) checkEnum(object.scope, TASK_FINDER_SCOPES_V1, '/scope', issues);
		if (object.project !== undefined) {
			const project = inspectObject(object.project, '/project', ['mode', 'rootOperonId'], issues);
			if (project) {
				checkEnum(project.mode, TASK_FINDER_PROJECT_MODES_V1, '/project/mode', issues);
				if (project.rootOperonId !== undefined) {
					checkCanonicalOperonId(project.rootOperonId, '/project/rootOperonId', issues);
				}
			}
		}
		if (object.limit !== undefined) checkBoundedPositiveInteger(object.limit, '/limit', 250, issues);
		if (object.cursor !== undefined) checkCursor(object.cursor, '/cursor', issues);
	}
	return finish<TaskFinderRequestV1>(value, issues);
}

export function decodeTaskFinderResultV1(value: unknown): DecodeResultV1<TaskFinderResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'task-finder-result', [
		'contextRevision', 'rows', 'page', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['rows', 'page', 'provenance', 'truncations'], [], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.rows !== undefined) checkTaskFinderRows(object.rows, '/rows', issues);
		if (object.page !== undefined) checkTaskQueryPage(object.page, '/page', issues);
		if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
		if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	}
	return finish<TaskFinderResultV1>(value, issues);
}

export function decodeRelationshipRequestV1(value: unknown): DecodeResultV1<RelationshipRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'relationship', ['selector', 'kinds', 'limit', 'depth'], issues);
	if (object) {
		checkSelector(object.selector, '/selector', issues);
		if (object.kinds !== undefined) checkStringEnumArray(object.kinds, RELATIONSHIP_KINDS_V1, '/kinds', issues);
		if (object.limit !== undefined) checkBoundedPositiveInteger(object.limit, '/limit', 500, issues);
		if (object.depth !== undefined) checkBoundedNonNegativeInteger(object.depth, '/depth', 6, issues);
	}
	return finish<RelationshipRequestV1>(value, issues);
}

export function decodeRelationshipResultV1(value: unknown): DecodeResultV1<RelationshipResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadResult(value, 'relationship-result', [
		'contextRevision', 'relationships', 'tasks', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		checkSuccessFailureState(object, ['relationships', 'tasks', 'provenance', 'truncations'], [], issues);
		if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
		if (object.relationships !== undefined) checkRelationshipSet(object.relationships, '/relationships', issues);
		if (object.tasks !== undefined) checkTaskArray(object.tasks, '/tasks', 500, issues);
		if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
		if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	}
	return finish<RelationshipResultV1>(value, issues);
}

export function decodeContextRequestV1(value: unknown): DecodeResultV1<ContextRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = checkReadRequest(value, 'context', [
		'purpose', 'projection', 'selector', 'filters', 'include', 'limit', 'depth',
		'cursor', 'targetFilePath', 'mutationKind', 'placement', 'operonIds',
	], issues);
	if (!object) return finish<ContextRequestV1>(value, issues);
	checkEnum(object.purpose, CONTEXT_PURPOSES_V1, '/purpose', issues);
	checkEnum(object.projection, CONTEXT_PROJECTIONS_V1, '/projection', issues);
	if (object.selector !== undefined) checkSelector(object.selector, '/selector', issues);
	if (object.operonIds !== undefined) {
		checkOperonIdArray(
			object.operonIds,
			'/operonIds',
			MUTATION_READINESS_OPERON_IDS_MIN_V1,
			MUTATION_READINESS_OPERON_IDS_MAX_V1,
			issues,
		);
	}
	if (object.filters !== undefined) checkTaskQueryFilters(object.filters, '/filters', issues);
	if (object.include !== undefined) checkHydrationKeys(object.include, '/include', issues);
	const projection = typeof object.projection === 'string'
		&& Object.prototype.hasOwnProperty.call(CONTEXT_PROJECTION_LIMITS_V1, object.projection)
		? object.projection as keyof typeof CONTEXT_PROJECTION_LIMITS_V1
		: null;
	if (object.limit !== undefined) {
		checkPositiveInteger(object.limit, '/limit', issues);
		if (projection && typeof object.limit === 'number' && object.limit > CONTEXT_PROJECTION_LIMITS_V1[projection].hardLimit) {
			issues.push(issue('/limit', 'value', 'Requested limit exceeds the projection hard cap.'));
		}
	}
	if (object.depth !== undefined) {
		checkNonNegativeInteger(object.depth, '/depth', issues);
		const maxDepth = projection ? CONTEXT_PROJECTION_LIMITS_V1[projection].maxDepth : null;
		if (maxDepth !== null && typeof object.depth === 'number' && object.depth > maxDepth) {
			issues.push(issue('/depth', 'value', 'Requested depth exceeds the projection hard cap.'));
		}
	}
	if (object.cursor !== undefined) checkCursor(object.cursor, '/cursor', issues);
	if (object.targetFilePath !== undefined) {
		if (typeof object.targetFilePath !== 'string') issues.push(issue('/targetFilePath', 'type', 'Expected a string.'));
		else {
			const pathError = validateVaultRelativePathV1(object.targetFilePath);
			if (pathError) issues.push(issue('/targetFilePath', 'value', pathError.reason));
		}
	}
	if (object.mutationKind !== undefined && (
		typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind)
	)) {
		issues.push(issue('/mutationKind', 'value', 'Unknown mutation kind.'));
	}
	if (object.placement !== undefined) checkPlacementRequest(object.placement, '/placement', issues);
	checkContextProjectionInvariants(object, issues);
	return finish<ContextRequestV1>(value, issues);
}

export function decodeContextPackV1(value: unknown): DecodeResultV1<ContextPackV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'purpose', 'projection', 'execution',
		'contextRevision', 'catalogRevision', 'asOf', 'entities', 'relationships',
		'catalog', 'policies', 'resourceRevisions', 'summary', 'query', 'provenance',
		'placement', 'truncations', 'warnings', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'context-pack', '/kind', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkEnum(object.purpose, CONTEXT_PURPOSES_V1, '/purpose', issues);
	checkEnum(object.projection, CONTEXT_PROJECTIONS_V1, '/projection', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	checkSuccessFailureState(object, [
		'execution', 'entities', 'relationships', 'provenance', 'truncations',
	], [
		'catalogRevision', 'asOf', 'catalog', 'policies', 'resourceRevisions',
		'summary', 'query', 'placement',
	], issues);
	if (object.execution !== undefined) checkFreshness(object.execution, '/execution', issues);
	if (object.contextRevision !== undefined) checkContextRevision(object.contextRevision, '/contextRevision', issues);
	if (object.catalogRevision !== undefined) checkSha256(object.catalogRevision, '/catalogRevision', issues);
	if (object.asOf !== undefined) checkTimestamp(object.asOf, '/asOf', issues);
	if (object.entities !== undefined) {
		const limit = typeof object.projection === 'string' && object.projection in CONTEXT_PROJECTION_LIMITS_V1
			? CONTEXT_PROJECTION_LIMITS_V1[object.projection as keyof typeof CONTEXT_PROJECTION_LIMITS_V1].hardLimit
			: 500;
		checkTaskArray(object.entities, '/entities', limit, issues);
		if (object.ok === true && object.projection === 'exact-task' && Array.isArray(object.entities) && object.entities.length !== 1) {
			issues.push(issue('/entities', 'value', 'Successful exact-task context contains exactly one entity.'));
		}
	}
	if (object.relationships !== undefined) checkRelationshipSet(object.relationships, '/relationships', issues);
	if (object.catalog !== undefined) checkContextCatalogSlice(object.catalog, '/catalog', issues);
	if (object.policies !== undefined) checkCatalogPolicies(object.policies, '/policies', issues);
	if (object.resourceRevisions !== undefined) checkAffectedResourceRevisions(object.resourceRevisions, '/resourceRevisions', issues);
	if (object.summary !== undefined) checkContextSummary(object.summary, '/summary', issues);
	if (object.query !== undefined) checkTaskQueryPage(object.query, '/query', issues);
	if (object.placement !== undefined) checkPlacementCandidates(object.placement, '/placement', issues);
	if (object.provenance !== undefined) checkProvenance(object.provenance, '/provenance', issues);
	if (object.truncations !== undefined) checkTruncations(object.truncations, '/truncations', issues);
	if (object.ok === true && object.projection === 'placement-candidates') {
		if (object.placement === undefined) {
			issues.push(issue('/placement', 'required', 'placement-candidates requires placement results.'));
		}
		if (Array.isArray(object.entities) && object.entities.length !== 0) {
			issues.push(issue('/entities', 'value', 'placement-candidates does not return task entities.'));
		}
	} else if (object.placement !== undefined) {
		issues.push(issue('/placement', 'value', 'Only placement-candidates may return placement results.'));
	}
	return finish<ContextPackV1>(value, issues);
}

function checkContextProjectionInvariants(
	request: Record<string, unknown>,
	issues: DecodeIssueV1[],
): void {
	const projection = request.projection;
	if (
		(projection === 'exact-task'
			|| projection === 'task-neighborhood'
			|| projection === 'project-analysis'
			|| projection === 'mutation-preview')
		&& request.selector === undefined
		&& request.operonIds === undefined
	) {
		issues.push(issue('/selector', 'required', `${String(projection)} requires an entity selector.`));
	}
	if (request.selector !== undefined && request.operonIds !== undefined) {
		issues.push(issue('/operonIds', 'value', 'Exact multi-task roots are mutually exclusive with selector.'));
	}
	if (projection === 'planning-workload' && request.selector !== undefined) {
		issues.push(issue('/selector', 'value', 'planning-workload does not accept an entity selector.'));
	}
	if (projection !== 'mutation-preview' && request.operonIds !== undefined) {
		issues.push(issue('/operonIds', 'value', 'Only mutation-preview accepts exact multi-task roots.'));
	}
	if (projection !== 'planning-workload' && request.filters !== undefined) {
		issues.push(issue('/filters', 'value', 'Only planning-workload accepts task query filters.'));
	}
	if ((projection === 'exact-task' || projection === 'mutation-preview') && request.cursor !== undefined) {
		issues.push(issue('/cursor', 'value', `${String(projection)} does not paginate.`));
	}
	if ((projection === 'planning-workload' || projection === 'mutation-preview') && request.depth !== undefined) {
		issues.push(issue('/depth', 'value', `${String(projection)} does not accept relationship depth.`));
	}
	if (projection === 'exact-task') {
		if (request.limit !== undefined && request.limit !== 1) {
			issues.push(issue('/limit', 'value', 'exact-task limit is exactly one.'));
		}
		if (request.depth !== undefined && request.depth !== 0) {
			issues.push(issue('/depth', 'value', 'exact-task depth is exactly zero.'));
		}
	}
	if (projection !== 'creation-context' && request.targetFilePath !== undefined) {
		issues.push(issue('/targetFilePath', 'value', 'Only creation-context accepts targetFilePath.'));
	}
	if (projection === 'mutation-preview') {
		if (request.purpose !== 'mutation-readiness') {
			issues.push(issue('/purpose', 'value', 'mutation-preview requires mutation-readiness purpose.'));
		}
		if (request.mutationKind === undefined) {
			issues.push(issue('/mutationKind', 'required', 'mutation-preview requires a mutation kind.'));
		}
		if (request.operonIds !== undefined && request.mutationKind !== 'task.update') {
			issues.push(issue('/mutationKind', 'value', 'Exact multi-task roots support task.update readiness only.'));
		}
		if (request.operonIds !== undefined && request.limit !== undefined) {
			issues.push(issue('/limit', 'value', 'Exact multi-task readiness is bounded by operonIds and does not accept limit.'));
		}
	} else if (request.mutationKind !== undefined) {
		issues.push(issue('/mutationKind', 'value', 'Only mutation-preview accepts mutationKind.'));
	}
	if (projection === 'creation-context' && request.purpose !== 'creation') {
		issues.push(issue('/purpose', 'value', 'creation-context requires creation purpose.'));
	}
	if (projection === 'placement-candidates') {
		if (request.purpose !== 'mutation-readiness') {
			issues.push(issue('/purpose', 'value', 'placement-candidates requires mutation-readiness purpose.'));
		}
		if (request.placement === undefined) {
			issues.push(issue('/placement', 'required', 'placement-candidates requires placement parameters.'));
		}
		for (const field of [
			'selector', 'operonIds', 'filters', 'include', 'depth', 'cursor', 'targetFilePath', 'mutationKind',
		]) {
			if (request[field] !== undefined) {
				issues.push(issue(`/${field}`, 'value', `placement-candidates does not accept ${field}.`));
			}
		}
	} else if (request.placement !== undefined) {
		issues.push(issue('/placement', 'value', 'Only placement-candidates accepts placement parameters.'));
	}
}

function checkPlacementRequest(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a placement request object.'));
		return;
	}
	if (value.mode === 'files') {
		checkObjectFields(value, path, ['mode', 'query'], issues);
		if (value.query !== undefined) {
			checkNonEmptyString(value.query, `${path}/query`, issues);
			checkCharacterCap(
				value.query,
				`${path}/query`,
				CONTEXT_HYDRATION_CAPS_V1.placementQueryCharacters,
				issues,
			);
			if (typeof value.query === 'string' && hasControlCharacterV1(value.query)) {
				issues.push(issue(`${path}/query`, 'value', 'Placement query cannot contain control characters.'));
			}
		}
		return;
	}
	if (value.mode === 'lines') {
		checkObjectFields(value, path, ['mode', 'filePath'], issues);
		checkPlacementFilePath(value.filePath, `${path}/filePath`, issues);
		return;
	}
	issues.push(issue(`${path}/mode`, 'value', 'Placement mode must be files or lines.'));
}

function checkPlacementCandidates(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected placement candidates.'));
		return;
	}
	if (value.mode === 'files') {
		checkObjectFields(
			value,
			path,
			['mode', 'actualCount', 'returnedCount', 'truncated', 'files'],
			issues,
		);
		checkPlacementPage(value, path, CONTEXT_HYDRATION_CAPS_V1.placementFiles, issues);
		if (!Array.isArray(value.files)) {
			issues.push(issue(`${path}/files`, 'type', 'Expected placement file candidates.'));
			return;
		}
		if (value.files.length > CONTEXT_HYDRATION_CAPS_V1.placementFiles) {
			issues.push(issue(`${path}/files`, 'value', 'Placement file candidates exceed the hard cap.'));
		}
		for (let index = 0; index < value.files.length; index += 1) {
			const itemPath = `${path}/files/${index}`;
			const item = inspectObject(value.files[index], itemPath, ['filePath', 'noteName'], issues);
			if (!item) continue;
			checkPlacementFilePath(item.filePath, `${itemPath}/filePath`, issues);
			checkNonEmptyString(item.noteName, `${itemPath}/noteName`, issues);
			checkCharacterCap(
				item.noteName,
				`${itemPath}/noteName`,
				CONTEXT_HYDRATION_CAPS_V1.placementNoteNameCharacters,
				issues,
			);
		}
		if (typeof value.returnedCount === 'number' && value.returnedCount !== value.files.length) {
			issues.push(issue(`${path}/returnedCount`, 'value', 'returnedCount must equal the file candidate count.'));
		}
		return;
	}
	if (value.mode === 'lines') {
		checkObjectFields(
			value,
			path,
			[
				'mode', 'filePath', 'sourceRevision', 'actualCount', 'returnedCount',
				'truncated', 'lines',
			],
			issues,
		);
		checkPlacementPage(value, path, CONTEXT_HYDRATION_CAPS_V1.placementLines, issues);
		checkPlacementFilePath(value.filePath, `${path}/filePath`, issues);
		checkSourceRevision(value.sourceRevision, `${path}/sourceRevision`, issues);
		if (!Array.isArray(value.lines)) {
			issues.push(issue(`${path}/lines`, 'type', 'Expected placement line candidates.'));
			return;
		}
		if (value.lines.length > CONTEXT_HYDRATION_CAPS_V1.placementLines) {
			issues.push(issue(`${path}/lines`, 'value', 'Placement line candidates exceed the hard cap.'));
		}
		for (let index = 0; index < value.lines.length; index += 1) {
			const itemPath = `${path}/lines/${index}`;
			const item = inspectObject(value.lines[index], itemPath, ['locator', 'heading', 'contextLabel'], issues);
			if (!item) continue;
			checkLocator(item.locator, `${itemPath}/locator`, issues);
			if (
				isPlainRecord(item.locator)
				&& (
					item.locator.representation !== 'inline'
					|| item.locator.filePath !== value.filePath
				)
			) {
				issues.push(issue(`${itemPath}/locator`, 'value', 'Placement line locators must belong to the exact requested file.'));
			}
			if (item.heading !== undefined) {
				checkNonEmptyString(item.heading, `${itemPath}/heading`, issues);
				checkCharacterCap(
					item.heading,
					`${itemPath}/heading`,
					CONTEXT_HYDRATION_CAPS_V1.placementHeadingCharacters,
					issues,
				);
			}
			checkNonEmptyString(item.contextLabel, `${itemPath}/contextLabel`, issues);
			checkCharacterCap(
				item.contextLabel,
				`${itemPath}/contextLabel`,
				CONTEXT_HYDRATION_CAPS_V1.placementContextLabelCharacters,
				issues,
			);
		}
		if (typeof value.returnedCount === 'number' && value.returnedCount !== value.lines.length) {
			issues.push(issue(`${path}/returnedCount`, 'value', 'returnedCount must equal the line candidate count.'));
		}
		return;
	}
	issues.push(issue(`${path}/mode`, 'value', 'Placement result mode must be files or lines.'));
}

function checkPlacementPage(
	value: Record<string, unknown>,
	path: string,
	hardCap: number,
	issues: DecodeIssueV1[],
): void {
	checkBoundedNonNegativeInteger(value.actualCount, `${path}/actualCount`, Number.MAX_SAFE_INTEGER, issues);
	checkBoundedNonNegativeInteger(value.returnedCount, `${path}/returnedCount`, hardCap, issues);
	checkBoolean(value.truncated, `${path}/truncated`, issues);
	if (
		typeof value.actualCount === 'number'
		&& typeof value.returnedCount === 'number'
		&& value.returnedCount > value.actualCount
	) {
		issues.push(issue(`${path}/returnedCount`, 'value', 'returnedCount cannot exceed actualCount.'));
	}
	if (
		typeof value.actualCount === 'number'
		&& typeof value.returnedCount === 'number'
		&& typeof value.truncated === 'boolean'
		&& value.truncated !== (value.returnedCount < value.actualCount)
	) {
		issues.push(issue(`${path}/truncated`, 'value', 'truncated must reflect omitted placement candidates.'));
	}
}

function checkPlacementFilePath(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') {
		issues.push(issue(path, 'type', 'Expected a vault-relative Markdown path.'));
		return;
	}
	const pathError = validateVaultRelativePathV1(value);
	if (pathError) issues.push(issue(path, 'value', pathError.reason));
	if (!value.toLowerCase().endsWith('.md')) {
		issues.push(issue(path, 'value', 'Placement paths must target Markdown files.'));
	}
}

function checkReadRequest(
	value: unknown,
	kind: string,
	extraFields: readonly string[],
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'consistency', ...extraFields,
	], issues);
	if (!object) return null;
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, kind, '/kind', issues);
	checkEnum(object.consistency, ['live-verified', 'best-effort', 'offline-unverified'], '/consistency', issues);
	return object;
}

function checkReadResult(
	value: unknown,
	kind: string,
	extraFields: readonly string[],
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'freshness', 'warnings', ...extraFields,
	], issues);
	if (!object) return null;
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, kind, '/kind', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkFreshness(object.freshness, '/freshness', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	return object;
}

function checkSuccessFailureState(
	object: Record<string, unknown>,
	requiredSuccessFields: readonly string[],
	optionalSuccessFields: readonly string[],
	issues: DecodeIssueV1[],
): void {
	if (object.ok === true) {
		if (object.contextRevision === undefined) issues.push(issue('/contextRevision', 'required', 'Successful read requires a context revision.'));
		if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful read cannot contain an error.'));
		for (const key of requiredSuccessFields) {
			if (object[key] === undefined) issues.push(issue(`/${key}`, 'required', `Successful read requires ${key}.`));
		}
		return;
	}
	if (object.ok === false) {
		if (object.error === undefined) issues.push(issue('/error', 'required', 'Failed read requires a structured error.'));
		for (const key of [...requiredSuccessFields, ...optionalSuccessFields]) {
			if (object[key] !== undefined) issues.push(issue(`/${key}`, 'value', 'Failed reads cannot contain partial result data.'));
		}
	}
}

function checkHydrationKeys(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	checkStringEnumArray(value, CONTEXT_HYDRATION_KEYS_V1, path, issues);
	checkUniqueStrings(value, path, issues);
}

function checkTaskGetHydrationKeys(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	checkStringEnumArray(value, TASK_GET_HYDRATION_KEYS_V1, path, issues);
	checkUniqueStrings(value, path, issues);
}

function checkBoundedPositiveInteger(value: unknown, path: string, maximum: number, issues: DecodeIssueV1[]): void {
	checkPositiveInteger(value, path, issues);
	if (typeof value === 'number' && value > maximum) issues.push(issue(path, 'value', `Value exceeds the V1 maximum of ${maximum}.`));
}

function checkBoundedNonNegativeInteger(value: unknown, path: string, maximum: number, issues: DecodeIssueV1[]): void {
	checkNonNegativeInteger(value, path, issues);
	if (typeof value === 'number' && value > maximum) issues.push(issue(path, 'value', `Value exceeds the V1 maximum of ${maximum}.`));
}

function checkTaskArray(value: unknown, path: string, maximum: number, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > maximum) issues.push(issue(path, 'value', 'Task result exceeds its V1 cap.'));
	value.forEach((task, index) => checkTaskContext(task, `${path}/${index}`, issues));
}

function checkTaskQueryFilters(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'checkbox', 'pipelineIds', 'statusIds', 'priorityIds', 'tiers',
		'filePath', 'parentOperonId', 'due', 'text',
	], issues);
	if (!object) return;
	if (object.checkbox !== undefined) {
		checkStringEnumArray(object.checkbox, ['open', 'done', 'cancelled'], `${path}/checkbox`, issues);
		checkUniqueStrings(object.checkbox, `${path}/checkbox`, issues);
	}
	for (const key of ['pipelineIds', 'statusIds', 'priorityIds', 'tiers']) {
		if (object[key] !== undefined) {
			checkStringArray(object[key], `${path}/${key}`, issues);
			checkUniqueStrings(object[key], `${path}/${key}`, issues);
			if (Array.isArray(object[key]) && object[key].length > 128) {
				issues.push(issue(`${path}/${key}`, 'value', 'Filter list exceeds the V1 cap.'));
			}
			if (Array.isArray(object[key])) {
				(object[key] as unknown[]).forEach((entry, index) => {
					checkBoundedNonEmptyString(entry, `${path}/${key}/${index}`, 4_096, issues);
				});
			}
		}
	}
	if (object.filePath !== undefined) {
		if (typeof object.filePath !== 'string') issues.push(issue(`${path}/filePath`, 'type', 'Expected a string.'));
		else {
			const error = validateVaultRelativePathV1(object.filePath);
			if (error) issues.push(issue(`${path}/filePath`, 'value', error.reason));
		}
	}
	if (object.parentOperonId !== undefined) checkCanonicalOperonId(object.parentOperonId, `${path}/parentOperonId`, issues);
	if (object.due !== undefined) {
		const due = inspectObject(object.due, `${path}/due`, ['from', 'to'], issues);
		if (due) {
			if (due.from === undefined && due.to === undefined) {
				issues.push(issue(`${path}/due`, 'value', 'Due range requires from or to.'));
			}
			for (const key of ['from', 'to']) {
				if (due[key] !== undefined && (typeof due[key] !== 'string' || !isValidCalendarDate(due[key]))) {
					issues.push(issue(`${path}/due/${key}`, 'value', 'Expected a real YYYY-MM-DD date.'));
				}
			}
		}
	}
	if (object.text !== undefined) {
		checkNonEmptyString(object.text, `${path}/text`, issues);
		checkCharacterCap(object.text, `${path}/text`, 4_096, issues);
	}
}

function checkTaskQueryPage(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['actualCount', 'returnedCount', 'truncated', 'nextCursor', 'asOf'], issues);
	if (!object) return;
	checkNonNegativeInteger(object.actualCount, `${path}/actualCount`, issues);
	checkNonNegativeInteger(object.returnedCount, `${path}/returnedCount`, issues);
	checkBoolean(object.truncated, `${path}/truncated`, issues);
	checkTimestamp(object.asOf, `${path}/asOf`, issues);
	if (object.nextCursor !== undefined) checkCursor(object.nextCursor, `${path}/nextCursor`, issues);
	if (object.truncated === true && object.nextCursor === undefined) {
		issues.push(issue(`${path}/nextCursor`, 'required', 'A truncated query page requires a next cursor.'));
	}
	if (object.truncated === false && object.nextCursor !== undefined) {
		issues.push(issue(`${path}/nextCursor`, 'value', 'A complete query page cannot expose a next cursor.'));
	}
}

function checkTaskFinderRows(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > 250) issues.push(issue(path, 'value', 'Task Finder rows exceed the V1 cap.'));
	value.forEach((entry, index) => {
		const itemPath = `${path}/${index}`;
		if (!isPlainRecord(entry)) {
			issues.push(issue(itemPath, 'type', 'Expected an object.'));
			return;
		}
		const kind = entry.kind;
		const keys = kind === 'project'
			? [
				'kind', 'task', 'score', 'directTaskCount', 'treeTaskCount',
				'visibleDirectTaskCount', 'visibleTreeTaskCount',
			]
			: ['kind', 'task', 'score'];
		const row = inspectObject(entry, itemPath, keys, issues);
		if (!row) return;
		checkEnum(row.kind, ['task', 'project'], `${itemPath}/kind`, issues);
		checkTaskContext(row.task, `${itemPath}/task`, issues);
		if (typeof row.score !== 'number' || !Number.isFinite(row.score)) {
			issues.push(issue(`${itemPath}/score`, 'type', 'Expected a finite score.'));
		}
		if (row.kind === 'project') {
			for (const key of [
				'directTaskCount', 'treeTaskCount', 'visibleDirectTaskCount', 'visibleTreeTaskCount',
			]) {
				checkNonNegativeInteger(row[key], `${itemPath}/${key}`, issues);
			}
		}
	});
}

function checkRelationshipSet(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['explicit', 'derived', 'inferred'], issues);
	if (!object) return;
	for (const provenanceClass of ['explicit', 'derived', 'inferred'] as const) {
		const edges = object[provenanceClass];
		if (!Array.isArray(edges)) {
			issues.push(issue(`${path}/${provenanceClass}`, 'type', 'Expected an array.'));
			continue;
		}
		if (edges.length > 500) issues.push(issue(`${path}/${provenanceClass}`, 'value', 'Relationship edge list exceeds the V1 cap.'));
		edges.forEach((edge, index) => checkRelationshipEdge(edge, `${path}/${provenanceClass}/${index}`, provenanceClass, issues));
	}
}

function checkRelationshipEdge(value: unknown, path: string, expectedClass: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'kind', 'sourceOperonId', 'targetOperonId', 'provenanceClass', 'reason', 'confidence',
	], issues);
	if (!object) return;
	checkEnum(object.kind, RELATIONSHIP_KINDS_V1, `${path}/kind`, issues);
	checkCanonicalOperonId(object.sourceOperonId, `${path}/sourceOperonId`, issues);
	checkCanonicalOperonId(object.targetOperonId, `${path}/targetOperonId`, issues);
	checkLiteral(object.provenanceClass, expectedClass, `${path}/provenanceClass`, issues);
	checkBoundedNonEmptyString(object.reason, `${path}/reason`, CONTRACT_LIMITS_V1.reasonBytes, issues);
	if (object.confidence !== undefined && (
		typeof object.confidence !== 'number'
		|| !Number.isFinite(object.confidence)
		|| object.confidence < 0
		|| object.confidence > 1
	)) issues.push(issue(`${path}/confidence`, 'value', 'Confidence must be between zero and one.'));
	if (expectedClass !== 'inferred' && object.confidence !== undefined) {
		issues.push(issue(`${path}/confidence`, 'value', 'Only inferred relationships may carry confidence.'));
	}
}

function checkContextCatalogSlice(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['taxonomy', 'fields'], issues);
	if (!object) return;
	checkCatalogTaxonomy(object.taxonomy, `${path}/taxonomy`, issues);
	const fields = decodeFieldCatalogV1(object.fields);
	if (fields.ok === false) {
		fields.issues.forEach(item => issues.push({ ...item, path: `${path}/fields${item.path === '/' ? '' : item.path}` }));
	}
}

function checkContextSummary(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'entityCount', 'relationshipCount', 'openCount', 'doneCount', 'cancelledCount',
	], issues);
	if (!object) return;
	for (const key of ['entityCount', 'relationshipCount', 'openCount', 'doneCount', 'cancelledCount']) {
		checkNonNegativeInteger(object[key], `${path}/${key}`, issues);
	}
}

export function decodeMutationPreviewRequestV1(value: unknown): DecodeResultV1<MutationPreviewRequestV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'clientInstanceId', 'idempotencyKey', 'correlationId',
		'capability', 'mutationKind',
		'target', 'spec', 'authorization',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'mutation-preview', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkBoundedNonEmptyString(object.clientInstanceId, '/clientInstanceId', 128, issues);
	checkIdempotencyKey(object.idempotencyKey, '/idempotencyKey', issues);
	if (object.correlationId !== undefined) checkRequestId(object.correlationId, '/correlationId', issues);
	checkCapabilityMutationPair(object.capability, object.mutationKind, 'preview', issues);
	if (object.target !== undefined) checkExactMutationTarget(object.target, '/target', issues);
	if (
		object.mutationKind !== 'task.create'
		&& object.mutationKind !== 'task.adopt'
		&& object.mutationKind !== 'timer.control'
		&& object.target === undefined
		&& !(isPlainRecord(object.spec) && object.spec.operation === 'update-batch')
	) {
		issues.push(issue('/target', 'required', 'Non-create mutation preview requires an exact target.'));
	}
	if (
		isPlainRecord(object.spec)
		&& object.spec.operation === 'update-batch'
		&& object.target !== undefined
	) {
		issues.push(issue('/target', 'value', 'update-batch owns its exact targets and does not accept an outer target.'));
	}
	checkMutationSpec(object.spec, '/spec', object.mutationKind, issues, true);
	checkAuthorization(object.authorization, '/authorization', issues);
	return finish<MutationPreviewRequestV1>(value, issues);
}

export function decodeSealedMutationPlanV1(value: unknown): DecodeResultV1<SealedMutationPlanV1> {
	const issues: DecodeIssueV1[] = [];
	checkSealedPlan(value, '', issues);
	return finish<SealedMutationPlanV1>(value, issues);
}

export function decodeMutationPreviewResultV1(value: unknown): DecodeResultV1<MutationPreviewResultV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'plan', 'error', 'warnings',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkLiteral(object.kind, 'mutation-preview-result', '/kind', issues);
	checkBoolean(object.ok, '/ok', issues);
	checkWarnings(object.warnings, '/warnings', issues);
	if (object.ok === true) {
		if (object.plan === undefined) issues.push(issue('/plan', 'required', 'Successful preview result requires a sealed plan.'));
		else checkSealedPlan(object.plan, '/plan', issues);
		if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful preview result cannot include an error.'));
	} else if (object.ok === false) {
		if (object.error === undefined) issues.push(issue('/error', 'required', 'Failed preview result requires a structured error.'));
		else checkStructuredError(object.error, '/error', issues);
		if (object.plan !== undefined) issues.push(issue('/plan', 'value', 'Failed preview result cannot include a plan.'));
	}
	return finish<MutationPreviewResultV1>(value, issues);
}

export function decodeMutationApplyRequestV1(value: unknown): DecodeResultV1<MutationApplyRequestV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportInputBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'plan', 'authorization',
		'idempotencyKey', 'acknowledgements',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'mutation-apply', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkSealedPlan(object.plan, '/plan', issues);
	checkAuthorization(object.authorization, '/authorization', issues);
	checkIdempotencyKey(object.idempotencyKey, '/idempotencyKey', issues);
	if (
		typeof object.idempotencyKey === 'string'
		&& isPlainRecord(object.plan)
		&& object.plan.idempotencyKeyHash !== sha256HexV1(object.idempotencyKey)
	) {
		issues.push(issue('/idempotencyKey', 'value', 'Raw idempotency key does not match the sealed plan hash.'));
	}
	checkAcknowledgements(object.acknowledgements, '/acknowledgements', issues);
	if (isPlainRecord(object.plan) && object.plan.riskLevel === 'destructive') {
		if (!isPlainRecord(object.authorization) || object.authorization.basis !== 'user-explicit-confirmation') {
			issues.push(issue('/authorization/basis', 'value', 'Destructive apply requires user-explicit-confirmation.'));
		}
	}
	if (isPlainRecord(object.plan) && Array.isArray(object.acknowledgements)) {
		checkAcknowledgementBindings(
			object.acknowledgements as unknown[],
			object.plan as unknown as SealedMutationPlanV1,
			'/acknowledgements',
			issues,
		);
	}
	return finish<MutationApplyRequestV1>(value, issues);
}

export function decodeMutationResultV1(value: unknown): DecodeResultV1<MutationResultV1> {
	const issues: DecodeIssueV1[] = [];
	checkJsonByteCap(value, '/', CONTRACT_LIMITS_V1.transportResultBytes, issues);
	const object = inspectObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'status', 'mutationMayHaveApplied',
		'retryAllowed', 'groupResults', 'continuation', 'ambiguitySource', 'receipt', 'postflight', 'error',
	], issues);
	if (!object) return { ok: false, issues };
	checkContractVersion(object, issues);
	checkLiteral(object.kind, 'mutation-result', '/kind', issues);
	checkRequestId(object.requestId, '/requestId', issues);
	checkEnum(object.status, ['applied', 'already-applied', 'partial', 'failed', 'outcome-unknown'], '/status', issues);
	checkBoolean(object.mutationMayHaveApplied, '/mutationMayHaveApplied', issues);
	checkBoolean(object.retryAllowed, '/retryAllowed', issues);
	checkGroupResults(object.groupResults, '/groupResults', issues);
	if (object.continuation !== undefined) checkContinuation(object.continuation, '/continuation', object.groupResults, issues);
	if (object.ambiguitySource !== undefined) {
		checkEnum(object.ambiguitySource, ['group-outcome', 'receipt-persist-failure'], '/ambiguitySource', issues);
	}
	if (object.receipt !== undefined) checkReceipt(object.receipt, '/receipt', issues);
	if (object.postflight !== undefined) checkMutationPostflight(object.postflight, '/postflight', issues);
	if (object.error !== undefined) checkStructuredError(object.error, '/error', issues);
	checkMutationResultState(object, issues);
	return finish<MutationResultV1>(value, issues);
}

export function decodeMutationReceiptV1(value: unknown): DecodeResultV1<MutationReceiptV1> {
	const issues: DecodeIssueV1[] = [];
	checkReceipt(value, '', issues);
	return finish<MutationReceiptV1>(value, issues);
}

/**
 * Required result admission gate. A structurally valid result is not trusted until
 * its receipts, executed groups, and continuation are bound to the admitted apply.
 */
export function admitMutationResultV1(
	resultValue: unknown,
	applyRequestValue: unknown,
	scopeValue: unknown,
): DecodeResultV1<MutationResultV1> {
	const result = decodeMutationResultV1(resultValue);
	if (!result.ok) return result;
	const applyRequest = decodeMutationApplyRequestV1(applyRequestValue);
	if (!applyRequest.ok) {
		return {
			ok: false,
			issues: applyRequest.issues.map(item => ({
				...item,
				path: `/applyRequest${item.path === '/' ? '' : item.path}`,
			})),
		};
	}
	const issues: DecodeIssueV1[] = [];
	const scope = inspectObject(
		scopeValue,
		'/scope',
		['vaultIdentityHash', 'clientInstanceId'],
		issues,
	);
	if (scope) {
		checkSha256(scope.vaultIdentityHash, '/scope/vaultIdentityHash', issues);
		checkBoundedNonEmptyString(scope.clientInstanceId, '/scope/clientInstanceId', 128, issues);
	}
	const plan = applyRequest.value.plan;
	checkResultGroupPlanBinding(result.value, plan, issues);
	if (result.value.receipt !== undefined && scope) {
		checkReceiptPlanBinding(result.value.receipt, plan, scope as unknown as MutationResultAdmissionScopeV1, issues);
	}
	if (result.value.continuation !== undefined) {
		checkContinuationPlanBinding(result.value, plan, issues);
	}
	return issues.length === 0 ? result : { ok: false, issues };
}

export function validateMutationResultAdmissionV1(
	resultValue: unknown,
	applyRequestValue: unknown,
	scopeValue: unknown,
): DecodeIssueV1[] {
	const result = admitMutationResultV1(resultValue, applyRequestValue, scopeValue);
	return result.ok ? [] : result.issues;
}

export function validateSealedMutationPlanSafetyV1(value: unknown): DecodeIssueV1[] {
	const result = decodeSealedMutationPlanV1(value);
	return result.ok ? [] : result.issues;
}

export function validateMutationApplySafetyV1(value: unknown): DecodeIssueV1[] {
	const result = decodeMutationApplyRequestV1(value);
	return result.ok ? [] : result.issues;
}

/**
 * Required apply admission gate. Structural decoding alone never authorizes an apply.
 */
export function admitMutationApplyV1(
	value: unknown,
	nowEpochMs: number,
): DecodeResultV1<MutationApplyRequestV1> {
	const decoded = decodeMutationApplyRequestV1(value);
	if (!decoded.ok) return decoded;
	const issues: DecodeIssueV1[] = [];
	if (!Number.isFinite(nowEpochMs) || !Number.isSafeInteger(nowEpochMs)) {
		issues.push(issue('/nowEpochMs', 'value', 'Apply admission requires a finite safe epoch millisecond clock.'));
	} else {
		const createdAt = parseTimestamp(decoded.value.plan.createdAt);
		const expiresAt = parseTimestamp(decoded.value.plan.expiresAt);
		if (createdAt === null || expiresAt === null || nowEpochMs < createdAt) {
			issues.push(issue('/plan/createdAt', 'value', 'Plan is not yet valid at the admission clock.'));
		}
		if (expiresAt === null || nowEpochMs >= expiresAt) {
			issues.push(issue('/plan/expiresAt', 'value', 'Plan has expired at the admission clock.'));
		}
		decoded.value.acknowledgements.forEach((acknowledgement, index) => {
			const acknowledgedAt = parseTimestamp(acknowledgement.acknowledgedAt);
			if (acknowledgedAt === null || acknowledgedAt > nowEpochMs) {
				issues.push(issue(`/acknowledgements/${index}/acknowledgedAt`, 'value', 'Acknowledgement cannot be in the admission clock future.'));
			}
		});
	}
	return issues.length === 0 ? decoded : { ok: false, issues };
}

export function validateMutationApplyAdmissionV1(value: unknown, nowEpochMs: number): DecodeIssueV1[] {
	const result = admitMutationApplyV1(value, nowEpochMs);
	return result.ok ? [] : result.issues;
}

export function validateMutationResultStateV1(value: unknown): DecodeIssueV1[] {
	const result = decodeMutationResultV1(value);
	return result.ok ? [] : result.issues;
}

export function validateCapabilityRegistryExactV1(value: unknown): DecodeIssueV1[] {
	const result = decodeCapabilityRegistryV1(value);
	return result.ok ? [] : result.issues;
}

function checkAcknowledgementBindings(
	acknowledgements: unknown[],
	plan: SealedMutationPlanV1,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (acknowledgements.length > CONTRACT_LIMITS_V1.acknowledgements) {
		issues.push(issue(path, 'value', 'Acknowledgement count exceeds the V1 cap.'));
	}
	const requiredCodes = new Set(plan.requiredAcknowledgements);
	const acknowledgedCodes = new Set<string>();
	const targetDigests = new Set(plan.targets.map(target => target.targetDigest));
	const createdAt = parseTimestamp(plan.createdAt);
	const expiresAt = parseTimestamp(plan.expiresAt);
	for (let index = 0; index < acknowledgements.length; index++) {
		const acknowledgement = acknowledgements[index];
		if (!isPlainRecord(acknowledgement)) continue;
		if (typeof acknowledgement.code === 'string') {
			if (acknowledgedCodes.has(acknowledgement.code)) {
				issues.push(issue(`${path}/${index}/code`, 'value', 'Acknowledgement codes must be unique.'));
			}
			acknowledgedCodes.add(acknowledgement.code);
			if (!requiredCodes.has(acknowledgement.code)) {
				issues.push(issue(`${path}/${index}/code`, 'value', 'Acknowledgement code is not required by the sealed plan.'));
			}
		}
		if (acknowledgement.planHash !== plan.planHash) {
			issues.push(issue(`${path}/${index}/planHash`, 'value', 'Acknowledgement must bind the exact sealed plan hash.'));
		}
		if (typeof acknowledgement.targetDigest !== 'string' || !targetDigests.has(acknowledgement.targetDigest)) {
			issues.push(issue(`${path}/${index}/targetDigest`, 'value', 'Acknowledgement target is not part of the sealed plan.'));
		}
		const acknowledgedAt = parseTimestamp(acknowledgement.acknowledgedAt);
		if (
			acknowledgedAt === null
			|| createdAt === null
			|| expiresAt === null
			|| acknowledgedAt < createdAt
			|| acknowledgedAt > expiresAt
		) {
			issues.push(issue(`${path}/${index}/acknowledgedAt`, 'value', 'Acknowledgement must occur within the plan interval.'));
		}
	}
	if (
		acknowledgedCodes.size !== requiredCodes.size
		|| [...requiredCodes].some(code => !acknowledgedCodes.has(code))
	) {
		issues.push(issue(path, 'value', 'Acknowledgements must exactly cover every required code.'));
	}
}

function checkResultGroupPlanBinding(
	result: MutationResultV1,
	plan: SealedMutationPlanV1,
	issues: DecodeIssueV1[],
): void {
	if (result.groupResults.length > plan.atomicGroups.length) {
		issues.push(issue('/groupResults', 'value', 'Result contains more groups than the sealed plan.'));
		return;
	}
	result.groupResults.forEach((group, index) => {
		const plannedGroup = plan.atomicGroups[index];
		if (group.groupId !== plannedGroup?.groupId) {
			issues.push(issue(
				`/groupResults/${index}/groupId`,
				'value',
				'Result groups must be the exact ordered execution prefix of the sealed plan.',
			));
		}
		if (group.resourceRevisions !== undefined && plannedGroup !== undefined) {
			const actualResources = group.resourceRevisions.map(resource => (
				`${resource.resourceKind}\0${resource.resourceKey}`
			));
			const expectedResources = plannedGroup.resources.map(resource => (
				`${resource.resourceKind}\0${resource.resourceKey}`
			));
			if (!canonicalValuesEqual(actualResources, expectedResources)) {
				issues.push(issue(
					`/groupResults/${index}/resourceRevisions`,
					'value',
					'Committed resource revisions must exactly cover their sealed atomic group.',
				));
			}
		}
	});
}

function checkReceiptPlanBinding(
	receipt: MutationReceiptV1,
	plan: SealedMutationPlanV1,
	scope: MutationResultAdmissionScopeV1,
	issues: DecodeIssueV1[],
): void {
	const bindings: Array<[unknown, unknown, string, string]> = [
		[receipt.planHash, plan.planHash, '/receipt/planHash', 'Receipt plan hash does not match the admitted plan.'],
		[
			receipt.idempotencyKeyHash,
			plan.idempotencyKeyHash,
			'/receipt/idempotencyKeyHash',
			'Receipt idempotency scope does not match the admitted plan.',
		],
		[
			receipt.mutationKind,
			plan.mutationKind,
			'/receipt/mutationKind',
			'Receipt mutation kind does not match the admitted plan.',
		],
		[
			receipt.targetDigest,
			plan.receiptTargetDigest,
			'/receipt/targetDigest',
			'Receipt target digest does not match the sealed aggregate target binding.',
		],
		[
			receipt.vaultIdentityHash,
			scope.vaultIdentityHash,
			'/receipt/vaultIdentityHash',
			'Receipt vault identity does not match the admission scope.',
		],
		[
			receipt.clientInstanceId,
			scope.clientInstanceId,
			'/receipt/clientInstanceId',
			'Receipt client instance does not match the admission scope.',
		],
	];
	for (const [actual, expected, path, message] of bindings) {
		if (actual !== expected) issues.push(issue(path, 'value', message));
	}
}

function checkContinuationPlanBinding(
	result: MutationResultV1,
	originPlan: SealedMutationPlanV1,
	issues: DecodeIssueV1[],
): void {
	const continuation = result.continuation;
	if (!continuation) return;
	const plan = continuation.plan;
	if (continuation.originPlanHash !== originPlan.planHash) {
		issues.push(issue('/continuation/originPlanHash', 'value', 'Continuation origin must be the admitted plan hash.'));
	}
	const semanticBindings: Array<[unknown, unknown, string]> = [
		[plan.capability, originPlan.capability, 'capability'],
		[plan.mutationKind, originPlan.mutationKind, 'mutationKind'],
		[plan.idempotencyKeyHash, originPlan.idempotencyKeyHash, 'idempotencyKeyHash'],
		[plan.receiptTargetDigest, originPlan.receiptTargetDigest, 'receiptTargetDigest'],
		[plan.targets, originPlan.targets, 'targets'],
		[plan.spec, originPlan.spec, 'spec'],
		[plan.riskLevel, originPlan.riskLevel, 'riskLevel'],
		[plan.requiresConfirmation, originPlan.requiresConfirmation, 'requiresConfirmation'],
		[plan.requiredAcknowledgements, originPlan.requiredAcknowledgements, 'requiredAcknowledgements'],
	];
	for (const [actual, expected, field] of semanticBindings) {
		if (!canonicalValuesEqual(actual, expected)) {
			issues.push(issue(
				`/continuation/plan/${field}`,
				'value',
				'Continuation must preserve the origin plan semantic operation binding.',
			));
		}
	}
	if (plan.planId === originPlan.planId) {
		issues.push(issue('/continuation/plan/planId', 'value', 'Continuation requires a fresh plan id.'));
	}
	const originCreatedAt = parseTimestamp(originPlan.createdAt);
	const continuationCreatedAt = parseTimestamp(plan.createdAt);
	if (
		originCreatedAt !== null
		&& continuationCreatedAt !== null
		&& continuationCreatedAt < originCreatedAt
	) {
		issues.push(issue('/continuation/plan/createdAt', 'value', 'Continuation cannot predate its origin plan.'));
	}
	const stoppedIndex = result.groupResults.findIndex(group => group.status !== 'committed');
	if (stoppedIndex < 0) {
		issues.push(issue('/continuation', 'value', 'Continuation requires a stopped group.'));
		return;
	}
	if (result.groupResults[stoppedIndex]?.status === 'outcome-unknown') {
		issues.push(issue('/continuation', 'value', 'An outcome-unknown group is not proven untouched and cannot be continued.'));
	}
	const expectedGroups = originPlan.atomicGroups.slice(stoppedIndex);
	if (plan.atomicGroups.length !== expectedGroups.length) {
		issues.push(issue('/continuation/plan/atomicGroups', 'value', 'Continuation must contain the untouched origin suffix.'));
		return;
	}
	plan.atomicGroups.forEach((group, index) => {
		const expected = expectedGroups[index];
		if (
			group.groupId !== expected?.groupId
			|| !canonicalValuesEqual(group.resources, expected?.resources)
		) {
			issues.push(issue(
				`/continuation/plan/atomicGroups/${index}`,
				'value',
				'Continuation groups must preserve the untouched origin suffix resources.',
			));
		}
	});
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
	try {
		return canonicalJsonV1(toJsonValueV1(left)) === canonicalJsonV1(toJsonValueV1(right));
	} catch {
		return false;
	}
}

function checkContinuation(
	value: unknown,
	path: string,
	groupResultsValue: unknown,
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(value, path, ['originPlanHash', 'remainingGroupIds', 'plan'], issues);
	if (!object) return;
	checkSha256(object.originPlanHash, `${path}/originPlanHash`, issues);
	checkStringArray(object.remainingGroupIds, `${path}/remainingGroupIds`, issues);
	checkUniqueStrings(object.remainingGroupIds, `${path}/remainingGroupIds`, issues);
	if (!Array.isArray(object.remainingGroupIds) || object.remainingGroupIds.length === 0) {
		issues.push(issue(`${path}/remainingGroupIds`, 'value', 'Continuation requires at least one remaining group.'));
	}
	checkSealedPlan(object.plan, `${path}/plan`, issues);
	if (isPlainRecord(object.plan) && object.plan.planHash === object.originPlanHash) {
		issues.push(issue(`${path}/plan/planHash`, 'value', 'Continuation must be freshly sealed from the origin plan.'));
	}
	if (isPlainRecord(object.plan) && Array.isArray(object.plan.atomicGroups) && Array.isArray(object.remainingGroupIds)) {
		const remainingGroupIds = object.remainingGroupIds as unknown[];
		const planGroupIds = (object.plan.atomicGroups as unknown[])
			.filter(isPlainRecord)
			.map(group => group.groupId);
		if (
			planGroupIds.length !== remainingGroupIds.length
			|| planGroupIds.some((groupId, index) => groupId !== remainingGroupIds[index])
		) {
			issues.push(issue(`${path}/remainingGroupIds`, 'value', 'Remaining group ids must exactly match the continuation plan.'));
		}
	}
	if (Array.isArray(groupResultsValue) && Array.isArray(object.remainingGroupIds)) {
		const results = (groupResultsValue as unknown[]).filter(isPlainRecord);
		const committedIds = new Set(
			results.filter(result => result.status === 'committed').map(result => result.groupId),
		);
		const stoppingGroup = results.find(result => result.status !== 'committed');
		for (const groupId of object.remainingGroupIds) {
			if (committedIds.has(groupId)) {
				issues.push(issue(`${path}/remainingGroupIds`, 'value', 'Continuation cannot include an already committed group.'));
				break;
			}
		}
		if (stoppingGroup && object.remainingGroupIds[0] !== stoppingGroup.groupId) {
			issues.push(issue(`${path}/remainingGroupIds/0`, 'value', 'Continuation must start with the stopped group.'));
		}
	}
}

function checkMutationResultState(object: Record<string, unknown>, issues: DecodeIssueV1[]): void {
	const groups = Array.isArray(object.groupResults) ? object.groupResults as unknown[] : [];
	const statuses = groups
		.filter(isPlainRecord)
		.map(group => group.status);
	const allCommitted = statuses.length > 0 && statuses.every(status => status === 'committed');
	const anyCommitted = statuses.some(status => status === 'committed');
	const anyFailed = statuses.some(status => status === 'failed');
	const anyUnknown = statuses.some(status => status === 'outcome-unknown');
	const receipt = isPlainRecord(object.receipt) ? object.receipt : null;
	const continuation = isPlainRecord(object.continuation) ? object.continuation : null;
	const postflight = isPlainRecord(object.postflight) ? object.postflight : null;

	switch (object.status) {
		case 'applied':
			if (
				!allCommitted
				|| object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error !== undefined
				|| continuation !== null
				|| object.ambiguitySource !== undefined
			) {
				issues.push(issue('/', 'value', 'Applied result requires committed groups, applied=true semantics, no retry, and no error.'));
			}
			if (!receipt || receipt.terminalOutcome !== 'applied') {
				issues.push(issue('/receipt', 'value', 'Applied result requires a matching applied receipt.'));
			}
			if (!postflight || postflight.status !== 'verified') {
				issues.push(issue('/postflight', 'value', 'Applied result requires verified live postflight evidence.'));
			}
			break;
		case 'already-applied':
			if (
				groups.length !== 0
				|| object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error !== undefined
				|| continuation !== null
				|| object.ambiguitySource !== undefined
			) {
				issues.push(issue('/', 'value', 'Already-applied result has no new group execution, no retry, and no error.'));
			}
			if (!receipt || receipt.terminalOutcome !== 'already-applied') {
				issues.push(issue('/receipt', 'value', 'Already-applied result requires a matching receipt.'));
			}
			if (!postflight || postflight.status !== 'receipt-replay') {
				issues.push(issue('/postflight', 'value', 'Already-applied result requires receipt-replay evidence.'));
			}
			break;
		case 'partial':
			if (
				!anyCommitted
				|| !anyFailed
				|| anyUnknown
				|| object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error === undefined
				|| receipt !== null
				|| postflight !== null
				|| object.ambiguitySource !== undefined
			) {
				issues.push(issue('/', 'value', 'Partial result requires committed and non-committed groups, an error, and no automatic retry.'));
			}
			break;
		case 'failed':
			if (
				anyCommitted
				|| anyUnknown
				|| object.mutationMayHaveApplied !== false
				|| object.error === undefined
				|| receipt !== null
				|| postflight !== null
				|| continuation !== null
				|| object.ambiguitySource !== undefined
			) {
				issues.push(issue('/', 'value', 'Failed result cannot contain committed/unknown effects or a receipt and requires an error.'));
			}
			break;
		case 'outcome-unknown':
			if (
				object.mutationMayHaveApplied !== true
				|| object.retryAllowed !== false
				|| object.error === undefined
				|| continuation !== null
				|| (object.ambiguitySource !== 'group-outcome' && object.ambiguitySource !== 'receipt-persist-failure')
			) {
				issues.push(issue('/', 'value', 'Outcome-unknown requires ambiguous evidence and forbids automatic retry.'));
			}
			if (object.ambiguitySource === 'group-outcome' && (!anyUnknown || groups.length === 0)) {
				issues.push(issue('/groupResults', 'value', 'group-outcome ambiguity requires an explicit outcome-unknown group.'));
			}
			if (
				object.ambiguitySource === 'receipt-persist-failure'
				&& (
					groups.length !== 0
					|| receipt !== null
					|| !postflight
					|| postflight.status !== 'verified'
				)
			) {
				issues.push(issue(
					'/',
					'value',
					'Receipt-persist failure uses empty groups, no receipt, and verified live postflight evidence.',
				));
			}
			if (
				postflight !== null
				&& (
					object.ambiguitySource !== 'receipt-persist-failure'
					|| postflight.status !== 'verified'
				)
			) {
				issues.push(issue(
					'/postflight',
					'value',
					'Only receipt-persist-failure may retain verified postflight evidence.',
				));
			}
			if (receipt && receipt.terminalOutcome !== 'outcome-unknown') {
				issues.push(issue('/receipt/terminalOutcome', 'value', 'Receipt outcome must match outcome-unknown.'));
			}
			break;
	}

	let stopped = false;
	for (let index = 0; index < statuses.length; index++) {
		if (stopped) {
			issues.push(issue(`/groupResults/${index}`, 'value', 'No group result may follow the first non-committed group.'));
			break;
		}
		if (statuses[index] !== 'committed') stopped = true;
	}
}

function checkMutationPostflight(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a mutation postflight object.'));
		return;
	}
	if (value.status === 'verified') {
		checkObjectFields(value, path, ['status', 'observedAt', 'contextRevision'], issues);
		checkTimestamp(value.observedAt, `${path}/observedAt`, issues);
		checkContextRevision(value.contextRevision, `${path}/contextRevision`, issues);
		return;
	}
	checkObjectFields(value, path, ['status'], issues);
	checkLiteral(value.status, 'receipt-replay', `${path}/status`, issues);
}

function checkPlanResourceBindings(
	plan: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(plan.affectedResources) || !Array.isArray(plan.atomicGroups)) return;
	const affected = (plan.affectedResources as unknown[]).filter(isPlainRecord);
	const groups = (plan.atomicGroups as unknown[]).filter(isPlainRecord);
	if (affected.length > CONTRACT_LIMITS_V1.affectedResources) {
		issues.push(issue(`${path}/affectedResources`, 'value', 'Affected resource count exceeds the V1 cap.'));
	}
	if (groups.length > CONTRACT_LIMITS_V1.atomicGroups) {
		issues.push(issue(`${path}/atomicGroups`, 'value', 'Atomic group count exceeds the V1 cap.'));
	}
	const affectedKeys = affected.map(resourceIdentity);
	const affectedSet = new Set(affectedKeys);
	const groupIds = new Set<string>();
	const flattened: Record<string, unknown>[] = [];
	groups.forEach((group, index) => {
		if (typeof group.groupId === 'string') {
			if (groupIds.has(group.groupId)) issues.push(issue(`${path}/atomicGroups/${index}/groupId`, 'value', 'Atomic group ids must be unique.'));
			groupIds.add(group.groupId);
		}
		if (group.order !== index) issues.push(issue(`${path}/atomicGroups/${index}/order`, 'value', 'Atomic group order must be zero-based and contiguous.'));
		if (Array.isArray(group.resources)) flattened.push(...(group.resources as unknown[]).filter(isPlainRecord));
	});
	const flattenedKeys = flattened.map(resourceIdentity);
	const flattenedSet = new Set(flattenedKeys);
	if (
		flattenedKeys.length !== affectedKeys.length
		|| flattenedSet.size !== flattenedKeys.length
		|| affectedSet.size !== affectedKeys.length
		|| affectedKeys.some(key => !flattenedSet.has(key))
	) {
		issues.push(issue(`${path}/atomicGroups`, 'value', 'Atomic groups must cover each affected resource exactly once.'));
	}
	const expectedAffectedOrder = [...affected].sort(compareResourcesCanonicalV1).map(resourceIdentity);
	if (affectedKeys.some((key, index) => key !== expectedAffectedOrder[index])) {
		issues.push(issue(`${path}/affectedResources`, 'value', 'Affected resources violate canonical queue order.'));
	}
	if (Array.isArray(plan.predictedEffects)) {
		const effects = plan.predictedEffects as unknown[];
		if (effects.length > CONTRACT_LIMITS_V1.predictedEffects) {
			issues.push(issue(`${path}/predictedEffects`, 'value', 'Predicted effect count exceeds the V1 cap.'));
		}
		effects.filter(isPlainRecord).forEach((effect, index) => {
			if (!affectedSet.has(resourceIdentity(effect))) {
				issues.push(issue(`${path}/predictedEffects/${index}`, 'value', 'Predicted effect references an unbound resource.'));
			}
		});
	}
	if (Array.isArray(plan.targets) && plan.targets.length > CONTRACT_LIMITS_V1.planTargets) {
		issues.push(issue(`${path}/targets`, 'value', 'Plan target count exceeds the V1 cap.'));
	}
}

function resourceIdentity(resource: Record<string, unknown>): string {
	return `${String(resource.resourceKind)}\0${String(resource.resourceKey)}`;
}

function compareResourcesCanonicalV1(left: Record<string, unknown>, right: Record<string, unknown>): number {
	const leftKind = typeof left.resourceKind === 'string' && left.resourceKind in RESOURCE_QUEUE_ORDER_V1
		? RESOURCE_QUEUE_ORDER_V1[left.resourceKind as keyof typeof RESOURCE_QUEUE_ORDER_V1]
		: Number.MAX_SAFE_INTEGER;
	const rightKind = typeof right.resourceKind === 'string' && right.resourceKind in RESOURCE_QUEUE_ORDER_V1
		? RESOURCE_QUEUE_ORDER_V1[right.resourceKind as keyof typeof RESOURCE_QUEUE_ORDER_V1]
		: Number.MAX_SAFE_INTEGER;
	if (leftKind !== rightKind) return leftKind - rightKind;
	const leftKey = String(left.resourceKey);
	const rightKey = String(right.resourceKey);
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function riskRank(value: unknown): number {
	return typeof value === 'string' ? RISK_LEVELS_V1.indexOf(value as never) : -1;
}

function parseTimestamp(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
	if (!match || !isValidCalendarDate(match[1])) return null;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = Number(match[4]);
	if (hour > 23 || minute > 59 || second > 59) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function checkTaskContext(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'identity', 'description', 'representation', 'locator', 'checkbox', 'workflow',
		'priority', 'dates', 'datetimes', 'relationships', 'recurrence', 'tracker',
		'pinned', 'sourceRevision', 'contextRevision', 'note', 'links', 'customFields',
		'sourceMarkdown', 'trackerHistory', 'reminderItems', 'writableFields',
	], issues);
	if (!object) return;
	checkTaskIdentity(object.identity, `${path}/identity`, issues);
	checkNonEmptyString(object.description, `${path}/description`, issues);
	checkEnum(object.representation, ['inline', 'file'], `${path}/representation`, issues);
	checkLocator(object.locator, `${path}/locator`, issues);
	if (isPlainRecord(object.locator) && object.locator.representation !== object.representation) {
		issues.push(issue(`${path}/representation`, 'value', 'Representation must match the locator.'));
	}
	checkEnum(object.checkbox, ['open', 'done', 'cancelled'], `${path}/checkbox`, issues);
	if (object.workflow !== undefined) checkWorkflowReference(object.workflow, `${path}/workflow`, issues);
	if (object.priority !== undefined) checkTaxonomyReference(object.priority, `${path}/priority`, issues);
	checkOptionalDateObject(object.dates, `${path}/dates`, ['due', 'scheduled', 'started', 'completed', 'cancelled'], issues);
	checkOptionalLocalDateTimeObject(object.datetimes, `${path}/datetimes`, ['start', 'end', 'created', 'modified'], issues);
	checkRelationships(object.relationships, `${path}/relationships`, issues);
	const recurrence = inspectObject(object.recurrence, `${path}/recurrence`, ['repeating', 'seriesId', 'occurrenceDate'], issues);
	if (recurrence) {
		checkBoolean(recurrence.repeating, `${path}/recurrence/repeating`, issues);
		if (
			recurrence.seriesId !== undefined
			&& (typeof recurrence.seriesId !== 'string' || !/^rs[a-z0-9]{5}$/.test(recurrence.seriesId))
		) {
			issues.push(issue(`${path}/recurrence/seriesId`, 'value', 'Recurrence series id must use the canonical rsxxxxx form.'));
		}
		if (
			recurrence.occurrenceDate !== undefined
			&& (typeof recurrence.occurrenceDate !== 'string' || !isValidCalendarDate(recurrence.occurrenceDate))
		) {
			issues.push(issue(`${path}/recurrence/occurrenceDate`, 'value', 'Occurrence date must be a real YYYY-MM-DD date.'));
		}
	}
	const tracker = inspectObject(object.tracker, `${path}/tracker`, ['active', 'sessionCount'], issues);
	if (tracker) {
		checkBoolean(tracker.active, `${path}/tracker/active`, issues);
		checkNonNegativeInteger(tracker.sessionCount, `${path}/tracker/sessionCount`, issues);
	}
	checkBoolean(object.pinned, `${path}/pinned`, issues);
	checkSourceRevision(object.sourceRevision, `${path}/sourceRevision`, issues);
	checkContextRevision(object.contextRevision, `${path}/contextRevision`, issues);
	if (object.note !== undefined) {
		checkStringByteCap(object.note, `${path}/note`, CONTEXT_HYDRATION_CAPS_V1.noteBytesPerTask, issues);
	}
	if (object.links !== undefined) {
		checkStringArray(object.links, `${path}/links`, issues);
		if (Array.isArray(object.links) && object.links.length > CONTEXT_HYDRATION_CAPS_V1.linksPerTask) {
			issues.push(issue(`${path}/links`, 'value', 'Link hydration exceeds the per-task cap.'));
		}
		if (Array.isArray(object.links)) {
			(object.links as unknown[]).forEach((link, index) => {
				checkCharacterCap(link, `${path}/links/${index}`, 4_096, issues);
			});
		}
	}
	if (object.customFields !== undefined) {
		checkJsonValue(object.customFields, `${path}/customFields`, issues);
		if (isPlainRecord(object.customFields)) {
			if (Object.keys(object.customFields).length > CONTEXT_HYDRATION_CAPS_V1.customFieldsPerTask) {
				issues.push(issue(`${path}/customFields`, 'value', 'Custom field hydration exceeds the field-count cap.'));
			}
			checkJsonByteCap(
				object.customFields,
				`${path}/customFields`,
				CONTEXT_HYDRATION_CAPS_V1.customFieldBytesPerTask,
				issues,
			);
		}
	}
	if (object.sourceMarkdown !== undefined) {
		checkStringByteCap(
			object.sourceMarkdown,
			`${path}/sourceMarkdown`,
			CONTEXT_HYDRATION_CAPS_V1.sourceMarkdownBytesPerTask,
			issues,
		);
	}
	if (object.trackerHistory !== undefined) {
		checkStringArray(object.trackerHistory, `${path}/trackerHistory`, issues);
		if (Array.isArray(object.trackerHistory)) {
			if (object.trackerHistory.length > CONTEXT_HYDRATION_CAPS_V1.trackerHistoryItemsPerTask) {
				issues.push(issue(`${path}/trackerHistory`, 'value', 'Tracker history exceeds the item cap.'));
			}
			checkJsonByteCap(
				object.trackerHistory,
				`${path}/trackerHistory`,
				CONTEXT_HYDRATION_CAPS_V1.trackerHistoryBytesPerTask,
				issues,
			);
			(object.trackerHistory as unknown[]).forEach((item, index) => {
				checkCharacterCap(item, `${path}/trackerHistory/${index}`, 4_096, issues);
			});
		}
	}
	if (object.reminderItems !== undefined) {
		if (!Array.isArray(object.reminderItems)) {
			issues.push(issue(`${path}/reminderItems`, 'type', 'Reminder items must be an array.'));
		} else {
			if (object.reminderItems.length > CONTEXT_HYDRATION_CAPS_V1.reminderItemsPerTask) {
				issues.push(issue(`${path}/reminderItems`, 'value', 'Reminder hydration exceeds the item-count cap.'));
			}
			checkJsonByteCap(
				object.reminderItems,
				`${path}/reminderItems`,
				CONTEXT_HYDRATION_CAPS_V1.reminderItemsBytesPerTask,
				issues,
			);
			(object.reminderItems as unknown[]).forEach((item, index) => {
				const itemPath = `${path}/reminderItems/${index}`;
				const reference = inspectObject(
					item,
					itemPath,
					['collection', 'itemId', 'expectedValue'],
					issues,
				);
				if (!reference) return;
				checkEnum(
					reference.collection,
					['reminderDatetimes', 'reminderRules'],
					`${itemPath}/collection`,
					issues,
				);
				checkNonEmptyString(reference.itemId, `${itemPath}/itemId`, issues);
				checkStringByteCap(
					reference.itemId,
					`${itemPath}/itemId`,
					CONTEXT_HYDRATION_CAPS_V1.reminderItemIdBytes,
					issues,
				);
				checkBoundedNonBlankString(
					reference.expectedValue,
					`${itemPath}/expectedValue`,
					CONTEXT_HYDRATION_CAPS_V1.reminderItemValueBytes,
					issues,
				);
			});
		}
	}
	if (object.writableFields !== undefined) {
		if (!Array.isArray(object.writableFields)) {
			issues.push(issue(`${path}/writableFields`, 'type', 'Writable fields must be an array.'));
		} else {
			if (object.writableFields.length > CONTEXT_HYDRATION_CAPS_V1.writableFieldsPerTask) {
				issues.push(issue(`${path}/writableFields`, 'value', 'Writable-field hydration exceeds the item-count cap.'));
			}
			checkJsonByteCap(
				object.writableFields,
				`${path}/writableFields`,
				CONTEXT_HYDRATION_CAPS_V1.writableFieldsBytesPerTask,
				issues,
			);
			const keys = new Set<string>();
			(object.writableFields as unknown[]).forEach((item, index) => {
				const itemPath = `${path}/writableFields/${index}`;
				const field = inspectObject(
					item,
					itemPath,
					['canonicalKey', 'valueType', 'present', 'value', 'canClear'],
					issues,
				);
				if (!field) return;
				checkNonEmptyString(field.canonicalKey, `${itemPath}/canonicalKey`, issues);
				checkCharacterCap(
					field.canonicalKey,
					`${itemPath}/canonicalKey`,
					CONTEXT_HYDRATION_CAPS_V1.writableFieldKeyCharacters,
					issues,
				);
				checkEnum(
					field.valueType,
					['text', 'number', 'date', 'datetime', 'list', 'checkbox'],
					`${itemPath}/valueType`,
					issues,
				);
				checkBoolean(field.present, `${itemPath}/present`, issues);
				checkBoolean(field.canClear, `${itemPath}/canClear`, issues);
				if (field.present === true) {
					if (field.value === undefined) {
						issues.push(issue(`${itemPath}/value`, 'required', 'Present writable fields require a normalized value.'));
					} else {
						checkTypedUpdateValue(field.value, field.valueType, `${itemPath}/value`, issues);
						checkJsonByteCap(
							field.value,
							`${itemPath}/value`,
							CONTEXT_HYDRATION_CAPS_V1.writableFieldValueBytes,
							issues,
						);
					}
				} else if (field.value !== undefined) {
					issues.push(issue(`${itemPath}/value`, 'value', 'Absent writable fields cannot contain a value.'));
				}
				if (field.canonicalKey === 'description' && field.canClear !== false) {
					issues.push(issue(`${itemPath}/canClear`, 'value', 'Task descriptions cannot be cleared.'));
				}
				if (typeof field.canonicalKey === 'string') {
					if (keys.has(field.canonicalKey)) {
						issues.push(issue(`${itemPath}/canonicalKey`, 'value', 'Writable field keys must be unique.'));
					}
					keys.add(field.canonicalKey);
				}
			});
		}
	}
}

function checkTaskIdentity(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const identity = inspectObject(value, path, ['operonId', 'validity', 'mutationAllowed'], issues);
	if (identity) {
		checkNonEmptyString(identity.operonId, `${path}/operonId`, issues);
		checkEnum(identity.validity, ['canonical', 'legacy-invalid', 'duplicate'], `${path}/validity`, issues);
		checkBoolean(identity.mutationAllowed, `${path}/mutationAllowed`, issues);
		if (typeof identity.operonId === 'string') {
			const canonical = OPERON_ID_PATTERN_V1.test(identity.operonId);
			const truthValid = (
				identity.validity === 'canonical' && canonical && identity.mutationAllowed === true
			) || (
				identity.validity === 'legacy-invalid' && !canonical && identity.mutationAllowed === false
			) || (
				identity.validity === 'duplicate' && canonical && identity.mutationAllowed === false
			);
			if (!truthValid) {
				issues.push(issue(path, 'value', 'Identity validity and mutationAllowed violate the V1 truth table.'));
			}
		}
	}
}

function checkTaxonomyReference(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['id', 'label'], issues);
	if (!object) return;
	checkNonEmptyString(object.id, `${path}/id`, issues);
	checkCharacterCap(object.id, `${path}/id`, 256, issues);
	checkNonEmptyString(object.label, `${path}/label`, issues);
	checkCharacterCap(object.label, `${path}/label`, 256, issues);
}

function checkWorkflowReference(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['pipeline', 'status'], issues);
	if (!object) return;
	checkTaxonomyReference(object.pipeline, `${path}/pipeline`, issues);
	checkTaxonomyReference(object.status, `${path}/status`, issues);
}

function checkOptionalDateObject(
	value: unknown,
	path: string,
	keys: readonly string[],
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(value, path, keys, issues);
	if (!object) return;
	for (const key of keys) {
		if (object[key] !== undefined && (typeof object[key] !== 'string' || !isValidCalendarDate(object[key]))) {
			issues.push(issue(`${path}/${key}`, 'value', 'Expected a real YYYY-MM-DD date.'));
		}
	}
}

function checkOptionalLocalDateTimeObject(
	value: unknown,
	path: string,
	keys: readonly string[],
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(value, path, keys, issues);
	if (!object) return;
	for (const key of keys) {
		if (object[key] !== undefined && (typeof object[key] !== 'string' || !isValidLocalDateTime(object[key]))) {
			issues.push(issue(`${path}/${key}`, 'value', 'Expected a real local ISO datetime.'));
		}
	}
}

function checkRelationships(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'parentOperonId', 'childOperonIds', 'blockingOperonIds',
		'blockedByOperonIds', 'relatedOperonIds',
	], issues);
	if (!object) return;
	if (object.parentOperonId !== undefined) checkCanonicalOperonId(object.parentOperonId, `${path}/parentOperonId`, issues);
	checkCanonicalOperonIdArray(object.childOperonIds, `${path}/childOperonIds`, issues);
	checkCanonicalOperonIdArray(object.blockingOperonIds, `${path}/blockingOperonIds`, issues);
	checkCanonicalOperonIdArray(object.blockedByOperonIds, `${path}/blockedByOperonIds`, issues);
	checkCanonicalOperonIdArray(object.relatedOperonIds, `${path}/relatedOperonIds`, issues);
}

function checkFreshness(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectResponseObject(
		value,
		path,
		['source', 'coherence', 'observedAt', 'settled'],
		issues,
	);
	if (!object) return;
	checkEnum(object.source, ['live-runtime', 'persisted-index', 'source-file'], `${path}/source`, issues);
	checkEnum(object.coherence, ['verified', 'settling', 'unverified'], `${path}/coherence`, issues);
	checkTimestamp(object.observedAt, `${path}/observedAt`, issues);
	checkBoolean(object.settled, `${path}/settled`, issues);
}

function checkCandidates(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		checkCandidateItem(value[index], itemPath, issues);
	}
}

function checkCandidateItem(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	const item = inspectObject(value, path, ['identity', 'description', 'locator', 'confidence', 'reasons', 'selector'], issues);
	if (!item) return null;
	checkTaskIdentity(item.identity, `${path}/identity`, issues);
	checkNonEmptyString(item.description, `${path}/description`, issues);
	checkLocator(item.locator, `${path}/locator`, issues);
	checkSelector(item.selector, `${path}/selector`, issues);
	if (
		isPlainRecord(item.selector)
		&& item.selector.kind !== 'operon-id'
		&& item.selector.kind !== 'exact-locator'
	) {
		issues.push(issue(`${path}/selector`, 'value', 'Entity candidate requires a reusable exact selector.'));
	}
	if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
		issues.push(issue(`${path}/confidence`, 'value', 'Confidence must be between zero and one.'));
	}
	checkStringArray(item.reasons, `${path}/reasons`, issues);
	checkUniqueStrings(item.reasons, `${path}/reasons`, issues);
	if (Array.isArray(item.reasons) && item.reasons.length > 16) {
		issues.push(issue(`${path}/reasons`, 'value', 'Candidate reasons exceed the V1 cap.'));
	}
	if (Array.isArray(item.reasons)) {
		(item.reasons as unknown[]).forEach((reason, reasonIndex) => {
			checkBoundedNonEmptyString(
				reason,
				`${path}/reasons/${reasonIndex}`,
				CONTRACT_LIMITS_V1.reasonBytes,
				issues,
			);
		});
	}
	return item;
}

function checkCandidate(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	checkCandidateItem(value, path, issues);
}

function checkProvenance(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTEXT_HYDRATION_CAPS_V1.provenanceEntries) {
		issues.push(issue(path, 'value', 'Provenance exceeds the V1 entry cap.'));
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['path', 'source', 'revision', 'derived'], issues);
		if (!item) continue;
		checkNonEmptyString(item.path, `${itemPath}/path`, issues);
		checkEnum(item.source, ['live-runtime', 'persisted-index', 'source-file'], `${itemPath}/source`, issues);
		if (item.revision !== undefined) checkNonEmptyString(item.revision, `${itemPath}/revision`, issues);
		checkBoolean(item.derived, `${itemPath}/derived`, issues);
	}
}

function checkTruncations(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['path', 'actualCount', 'returnedCount', 'limit'], issues);
		if (!item) continue;
		checkNonEmptyString(item.path, `${itemPath}/path`, issues);
		checkNonNegativeInteger(item.actualCount, `${itemPath}/actualCount`, issues);
		checkNonNegativeInteger(item.returnedCount, `${itemPath}/returnedCount`, issues);
		checkNonNegativeInteger(item.limit, `${itemPath}/limit`, issues);
			if (
				typeof item.actualCount === 'number'
				&& typeof item.returnedCount === 'number'
				&& item.returnedCount > item.actualCount
		) {
				issues.push(issue(`${itemPath}/returnedCount`, 'value', 'returnedCount cannot exceed actualCount.'));
			}
			if (
				typeof item.returnedCount === 'number'
				&& typeof item.limit === 'number'
				&& item.returnedCount > item.limit
			) {
				issues.push(issue(`${itemPath}/returnedCount`, 'value', 'returnedCount cannot exceed limit.'));
			}
			if (
				typeof item.actualCount === 'number'
				&& typeof item.returnedCount === 'number'
				&& item.actualCount <= item.returnedCount
			) {
				issues.push(issue(itemPath, 'value', 'Truncation requires actualCount greater than returnedCount.'));
			}
	}
}

function checkSealedPlan(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const issueStart = issues.length;
	const object = inspectObject(value, path, [
		'contractVersion', 'planId', 'planHash', 'clientInstanceId', 'correlationId',
		'idempotencyKeyHash', 'receiptTargetDigest',
		'capability', 'mutationKind', 'createdAt', 'expiresAt', 'targets', 'contextRevision', 'affectedResources',
		'atomicGroups', 'predictedEffects', 'riskLevel', 'requiresConfirmation',
		'requiredAcknowledgements', 'warnings', 'spec', 'createEffects', 'conversionEffect',
		'updateBatchEffects',
	], issues);
	if (!object) return;
	checkContractVersion(object, issues, path);
	checkNonEmptyString(object.planId, `${path}/planId`, issues);
	checkSha256(object.planHash, `${path}/planHash`, issues);
	checkBoundedNonEmptyString(object.clientInstanceId, `${path}/clientInstanceId`, 128, issues);
	checkRequestId(object.correlationId, `${path}/correlationId`, issues);
	checkSha256(object.idempotencyKeyHash, `${path}/idempotencyKeyHash`, issues);
	checkSha256(object.receiptTargetDigest, `${path}/receiptTargetDigest`, issues);
	checkCapabilityMutationPair(object.capability, object.mutationKind, 'preview', issues);
	checkTimestamp(object.createdAt, `${path}/createdAt`, issues);
	checkTimestamp(object.expiresAt, `${path}/expiresAt`, issues);
	checkTargets(object.targets, `${path}/targets`, issues);
	checkContextRevision(object.contextRevision, `${path}/contextRevision`, issues);
	checkAffectedResources(object.affectedResources, `${path}/affectedResources`, issues);
	checkAtomicGroups(object.atomicGroups, `${path}/atomicGroups`, issues);
	checkPredictedEffects(object.predictedEffects, `${path}/predictedEffects`, issues);
	checkEnum(object.riskLevel, RISK_LEVELS_V1, `${path}/riskLevel`, issues);
	checkBoolean(object.requiresConfirmation, `${path}/requiresConfirmation`, issues);
	checkStringArray(object.requiredAcknowledgements, `${path}/requiredAcknowledgements`, issues);
	checkUniqueStrings(object.requiredAcknowledgements, `${path}/requiredAcknowledgements`, issues);
	checkWarnings(object.warnings, `${path}/warnings`, issues);
	checkMutationSpec(object.spec, `${path}/spec`, object.mutationKind, issues);
	if (object.mutationKind === 'task.create') {
		checkCreateEffects(object.createEffects, `${path}/createEffects`, object.spec, object.targets, issues);
	} else if (object.createEffects !== undefined) {
		issues.push(issue(`${path}/createEffects`, 'value', 'Only task.create plans may include createEffects.'));
	}
	if (object.mutationKind === 'task.convert') {
		checkConversionEffect(object.conversionEffect, `${path}/conversionEffect`, object.spec, object.targets, issues);
	} else if (object.conversionEffect !== undefined) {
		issues.push(issue(`${path}/conversionEffect`, 'value', 'Only task.convert plans may include conversionEffect.'));
	}
	if (isPlainRecord(object.spec) && object.spec.operation === 'update-batch') {
		checkUpdateBatchEffects(
			object.updateBatchEffects,
			`${path}/updateBatchEffects`,
			object.spec,
			object.targets,
			issues,
		);
	} else if (object.updateBatchEffects !== undefined) {
		issues.push(issue(`${path}/updateBatchEffects`, 'value', 'Only update-batch plans may include updateBatchEffects.'));
	}
	if (
		object.mutationKind !== 'task.create'
		&& object.mutationKind !== 'timer.control'
		&& Array.isArray(object.targets)
	) {
		for (let index = 0; index < object.targets.length; index++) {
			const target: unknown = (object.targets as unknown[])[index];
			if (
				!isPlainRecord(target)
				|| typeof target.operonId !== 'string'
				|| !OPERON_ID_PATTERN_V1.test(target.operonId)
				|| target.locator === undefined
			) {
				issues.push(issue(`${path}/targets/${index}`, 'value', 'Non-create plan targets require canonical operonId and exact locator.'));
			}
		}
	}
	if (
		isPlainRecord(object.spec)
		&& object.spec.operation === 'delete'
		&& (object.riskLevel !== 'destructive' || object.requiresConfirmation !== true)
	) {
		issues.push(issue(path || '/', 'value', 'Delete plans must be destructive and require confirmation.'));
	}
	if (
		isPlainRecord(object.spec)
		&& object.spec.operation === 'convert'
		&& object.spec.from === 'file'
		&& object.spec.to === 'inline'
		&& (object.riskLevel !== 'destructive' || object.requiresConfirmation !== true)
	) {
		issues.push(issue(path || '/', 'value', 'File-to-inline plans must be destructive and require confirmation.'));
	}
	if (isPlainRecord(object.spec) && typeof object.riskLevel === 'string') {
		const requiredRisk = requiredRiskForSpecV1(object.spec as unknown as MutationSpecV1);
		if (riskRank(object.riskLevel) < riskRank(requiredRisk)) {
			issues.push(issue(`${path}/riskLevel`, 'value', `Plan risk cannot be lower than ${requiredRisk}.`));
		}
	}
	const createdAt = parseTimestamp(object.createdAt);
	const expiresAt = parseTimestamp(object.expiresAt);
	if (createdAt !== null && expiresAt !== null) {
		const duration = expiresAt - createdAt;
		if (duration <= 0) issues.push(issue(`${path}/expiresAt`, 'value', 'Plan expiry must follow creation.'));
		if (object.riskLevel === 'destructive') {
			if (duration > 60_000) issues.push(issue(`${path}/expiresAt`, 'value', 'Destructive plans expire within 60 seconds.'));
			if (object.requiresConfirmation !== true) {
				issues.push(issue(`${path}/requiresConfirmation`, 'value', 'Destructive plans require confirmation.'));
			}
			if (!Array.isArray(object.requiredAcknowledgements) || object.requiredAcknowledgements.length === 0) {
				issues.push(issue(`${path}/requiredAcknowledgements`, 'value', 'Destructive plans require an acknowledgement code.'));
			}
		} else if (duration > 300_000) {
			issues.push(issue(`${path}/expiresAt`, 'value', 'Routine and elevated plans expire within five minutes.'));
		}
	}
	checkPlanResourceBindings(object, path, issues);
	if (Array.isArray(object.targets) && typeof object.receiptTargetDigest === 'string') {
		try {
			if (
				object.receiptTargetDigest !== computeReceiptTargetDigestV1(
					object.targets as SealedMutationPlanV1['targets'],
				)
			) {
				issues.push(issue(
					`${path}/receiptTargetDigest`,
					'value',
					'Receipt target digest must bind the canonical aggregate target list.',
				));
			}
		} catch {
			issues.push(issue(
				`${path}/receiptTargetDigest`,
				'value',
				'Receipt target digest material must be canonical JSON.',
			));
		}
	}
	if (issues.length === issueStart) {
		try {
			if (!verifySealedMutationPlanHashV1(object as unknown as SealedMutationPlanV1)) {
				issues.push(issue(`${path}/planHash`, 'value', 'Sealed plan hash does not match its canonical material.'));
			}
		} catch {
			issues.push(issue(`${path}/planHash`, 'value', 'Sealed plan hash material is not canonical JSON.'));
		}
	}
}

function checkMutationSpec(
	value: unknown,
	path: string,
	mutationKind: unknown,
	issues: DecodeIssueV1[],
	allowPreviewRelocationIntent: boolean = false,
): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected an object.'));
		return;
	}
	const operation = value.operation;
	switch (operation) {
		case 'create':
			checkCreateTaskSpec(value, path, issues);
			break;
		case 'update':
			checkObjectFields(value, path, ['operation', 'changes'], issues);
			checkUpdateItems(value.changes, `${path}/changes`, issues);
			break;
		case 'update-batch':
			checkUpdateBatchSpec(value, path, issues);
			break;
		case 'update-recurrence':
			checkObjectFields(value, path, ['operation', 'scope', 'changes', 'expected'], issues);
			checkEnum(value.scope, RECURRENCE_UPDATE_SCOPES_V1, `${path}/scope`, issues);
			checkRecurrenceUpdateItems(value.changes, `${path}/changes`, value.scope, issues);
			if (value.expected !== undefined) {
				checkRecurrenceExpectedState(value.expected, `${path}/expected`, issues);
			} else if (!allowPreviewRelocationIntent) {
				issues.push(issue(
					`${path}/expected`,
					'required',
					'Sealed recurrence plans require exact expected recurrence state.',
				));
			}
			break;
		case 'replace-relationships':
			checkReplaceRelationshipsSpec(value, path, issues);
			break;
		case 'add':
		case 'replace':
		case 'remove':
			checkObjectFields(value, path, ['operation', 'collection', 'itemId', 'value', 'expectedValue'], issues);
			checkEnum(value.collection, ['reminderDatetimes', 'reminderRules'], `${path}/collection`, issues);
			if (value.itemId !== undefined) {
				checkBoundedNonEmptyString(value.itemId, `${path}/itemId`, 256, issues);
			}
			if (value.value !== undefined) {
				checkBoundedNonEmptyString(value.value, `${path}/value`, 4_096, issues);
			}
			if (value.expectedValue !== undefined) {
				checkBoundedNonBlankString(value.expectedValue, `${path}/expectedValue`, 4_096, issues);
			}
			if (operation === 'add') {
				if (value.value === undefined) issues.push(issue(`${path}/value`, 'required', 'add requires value.'));
				if (value.itemId !== undefined || value.expectedValue !== undefined) {
					issues.push(issue(path, 'value', 'add accepts value only.'));
				}
			} else if (operation === 'replace') {
				if (value.itemId === undefined) issues.push(issue(`${path}/itemId`, 'required', 'replace requires itemId.'));
				if (value.expectedValue === undefined) issues.push(issue(`${path}/expectedValue`, 'required', 'replace requires expectedValue.'));
				if (value.value === undefined) issues.push(issue(`${path}/value`, 'required', 'replace requires value.'));
			} else {
				if (value.itemId === undefined) issues.push(issue(`${path}/itemId`, 'required', 'remove requires itemId.'));
				if (value.expectedValue === undefined) issues.push(issue(`${path}/expectedValue`, 'required', 'remove requires expectedValue.'));
				if (value.value !== undefined) issues.push(issue(`${path}/value`, 'value', 'remove cannot include value.'));
			}
			break;
			case 'transition':
				checkObjectFields(value, path, ['operation', 'targetStatusId', 'expectedStatusId', 'changes'], issues);
				checkNonEmptyString(value.targetStatusId, `${path}/targetStatusId`, issues);
				if (value.expectedStatusId !== undefined) checkNonEmptyString(value.expectedStatusId, `${path}/expectedStatusId`, issues);
				if (value.changes !== undefined) checkUpdateItems(value.changes, `${path}/changes`, issues);
				break;
			case 'set-pinned': {
				checkObjectFields(value, path, [
					'operation',
					'pinned',
					'expectedPinned',
					'expectedEntryRevision',
					'effectiveAt',
				], issues);
				if (typeof value.pinned !== 'boolean') {
					issues.push(issue(`${path}/pinned`, 'type', 'Expected a boolean.'));
				}
				if (value.expectedPinned !== undefined && typeof value.expectedPinned !== 'boolean') {
					issues.push(issue(`${path}/expectedPinned`, 'type', 'Expected a boolean.'));
				}
				if (value.expectedEntryRevision !== undefined) {
					checkSha256(value.expectedEntryRevision, `${path}/expectedEntryRevision`, issues);
				}
				if (value.effectiveAt !== undefined) {
					checkTimestamp(value.effectiveAt, `${path}/effectiveAt`, issues);
				}
				const sealedFieldCount = [
					value.expectedPinned,
					value.expectedEntryRevision,
					value.effectiveAt,
				].filter(item => item !== undefined).length;
				if (sealedFieldCount !== 0 && sealedFieldCount !== 3) {
					issues.push(issue(
						path,
						'value',
						'Pinned-state expected values and effectiveAt must be supplied together.',
					));
				}
				break;
			}
		case 'start':
		case 'stop':
			checkObjectFields(value, path, ['operation', 'expectedActiveStart'], issues);
			if (value.expectedActiveStart !== undefined) checkNonEmptyString(value.expectedActiveStart, `${path}/expectedActiveStart`, issues);
			break;
		case 'add-session':
		case 'update-session':
		case 'remove-session':
			checkTimerSessionSpec(value, path, issues, allowPreviewRelocationIntent);
			break;
		case 'convert':
			if (value.from === 'inline' && value.to === 'file') {
				checkObjectFields(value, path, ['operation', 'from', 'to', 'templateId', 'targetPath'], issues);
				checkBoundedNonEmptyString(value.templateId, `${path}/templateId`, 256, issues);
				if (value.targetPath !== undefined) {
					checkNonEmptyString(value.targetPath, `${path}/targetPath`, issues);
					checkVaultRelativePath(value.targetPath, `${path}/targetPath`, issues);
				}
			} else if (value.from === 'file' && value.to === 'inline') {
				checkObjectFields(value, path, ['operation', 'from', 'to', 'target'], issues);
				checkFileToInlineTarget(value.target, `${path}/target`, issues);
			} else {
				checkObjectFields(value, path, ['operation', 'from', 'to', 'templateId', 'targetPath', 'target'], issues);
				checkEnum(value.from, ['inline', 'file'], `${path}/from`, issues);
				checkEnum(value.to, ['inline', 'file'], `${path}/to`, issues);
				issues.push(issue(`${path}/to`, 'value', 'Conversion must change representation.'));
			}
			break;
	case 'relocate-inline':
			if (allowPreviewRelocationIntent && value.source === undefined) {
				checkObjectFields(value, path, ['operation', 'destination'], issues);
				checkRelocationPreviewDestination(value.destination, `${path}/destination`, issues);
			} else {
				checkObjectFields(value, path, ['operation', 'source', 'destination'], issues);
				checkRelocationEndpoint(value.source, `${path}/source`, false, issues);
				checkRelocationEndpoint(value.destination, `${path}/destination`, true, issues);
			}
			break;
		case 'adopt-inline': {
			checkObjectFields(value, path, [
				'operation', 'source', 'statusId', 'terminalSourcePolicy', 'operonId',
				'resolvedStatusId', 'resultingLine', 'sourceDigest', 'resultDigest', 'locator',
			], issues);
			if (!isPlainRecord(value.source)) {
				issues.push(issue(`${path}/source`, 'type', 'Expected an object.'));
			} else {
				checkObjectFields(value.source, `${path}/source`, ['filePath', 'lineNumber', 'expectedLine'], issues);
				checkNonEmptyString(value.source.filePath, `${path}/source/filePath`, issues);
				checkVaultRelativePath(value.source.filePath, `${path}/source/filePath`, issues);
				checkNonNegativeInteger(value.source.lineNumber, `${path}/source/lineNumber`, issues);
				checkBoundedString(value.source.expectedLine, `${path}/source/expectedLine`, 65_536, issues);
			}
			if (value.statusId !== undefined) checkBoundedNonEmptyString(value.statusId, `${path}/statusId`, 256, issues);
			if (value.terminalSourcePolicy !== undefined) {
				checkLiteral(value.terminalSourcePolicy, 'reopen', `${path}/terminalSourcePolicy`, issues);
			}
			const sealed = [value.operonId, value.resultingLine, value.sourceDigest, value.resultDigest, value.locator];
			const sealedCount = sealed.filter(item => item !== undefined).length;
			if (allowPreviewRelocationIntent && (sealedCount !== 0 || value.resolvedStatusId !== undefined)) {
				issues.push(issue(path, 'value', 'Adoption preview sealing fields are Runtime-owned.'));
			}
			if (!allowPreviewRelocationIntent && sealedCount !== sealed.length) {
				issues.push(issue(path, 'required', 'Sealed adoption plans require identity, line, digest, and locator proof.'));
			}
			if (
				!allowPreviewRelocationIntent
				&& (value.statusId === undefined) !== (value.resolvedStatusId === undefined)
			) {
				issues.push(issue(path, 'value', 'Sealed adoption statusId and resolvedStatusId must be supplied together.'));
			}
			if (sealedCount !== 0 && sealedCount !== sealed.length) {
				issues.push(issue(path, 'value', 'Adoption sealing fields must be supplied together.'));
			}
			if (value.operonId !== undefined) checkCanonicalOperonId(value.operonId, `${path}/operonId`, issues);
			if (value.resolvedStatusId !== undefined) checkBoundedNonEmptyString(value.resolvedStatusId, `${path}/resolvedStatusId`, 256, issues);
			if (value.resultingLine !== undefined) checkBoundedString(value.resultingLine, `${path}/resultingLine`, 65_536, issues);
			if (value.sourceDigest !== undefined) checkSha256(value.sourceDigest, `${path}/sourceDigest`, issues);
			if (value.resultDigest !== undefined) checkSha256(value.resultDigest, `${path}/resultDigest`, issues);
			if (value.locator !== undefined) checkLocator(value.locator, `${path}/locator`, issues);
			break;
		}
		case 'delete':
			checkObjectFields(value, path, ['operation', 'mode', 'cascade'], issues);
			checkLiteral(value.mode, 'delete-exact-task', `${path}/mode`, issues);
			checkLiteral(value.cascade, false, `${path}/cascade`, issues);
			break;
		default:
			issues.push(issue(`${path}/operation`, 'value', 'Unknown mutation operation.'));
			return;
	}
	const expectedKind = mutationKindForOperation(operation);
	if (expectedKind !== mutationKind) {
		issues.push(issue(path, 'value', 'Mutation spec operation does not match mutationKind.'));
	}
}

function mutationKindForOperation(operation: unknown): string | null {
	if (operation === 'create') return 'task.create';
	if (operation === 'update') return 'task.update';
	if (operation === 'update-batch') return 'task.update';
	if (operation === 'update-recurrence') return 'task.recurrence';
	if (operation === 'replace-relationships') return 'task.relationship';
	if (operation === 'add' || operation === 'replace' || operation === 'remove') return 'task.reminder-item';
	if (operation === 'transition') return 'task.transition';
	if (operation === 'set-pinned') return 'task.pinned-state';
	if (operation === 'start' || operation === 'stop') return 'timer.control';
	if (
		operation === 'add-session'
		|| operation === 'update-session'
		|| operation === 'remove-session'
	) return 'timer.session';
	if (operation === 'convert') return 'task.convert';
	if (operation === 'relocate-inline') return 'task.inline-relocate';
	if (operation === 'adopt-inline') return 'task.adopt';
	if (operation === 'delete') return 'task.delete';
	return null;
}

function checkTimerSessionSpec(
	value: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
	allowReduced: boolean,
): void {
	checkObjectFields(value, path, [
		'operation',
		'sessionNumber',
		'start',
		'end',
		'expectedTrackers',
		'expectedDuration',
		'selectedRawIndex',
		'expectedStart',
		'expectedEnd',
		'nextTrackers',
		'nextDuration',
		'effectiveAt',
	], issues);
	const operation = value.operation;
	const hasSessionNumber = operation !== 'add-session';
	const hasRange = operation !== 'remove-session';
	if (
		hasSessionNumber
			? !Number.isInteger(value.sessionNumber) || Number(value.sessionNumber) < 1
			: value.sessionNumber !== undefined
	) {
		issues.push(issue(`${path}/sessionNumber`, 'value', 'Invalid 1-based session number.'));
	}
	for (const field of ['start', 'end'] as const) {
		if (hasRange) checkTypedUpdateValue(value[field], 'datetime', `${path}/${field}`, issues);
		else if (value[field] !== undefined) issues.push(issue(`${path}/${field}`, 'value', 'Unexpected range.'));
	}
	const sealedFields = [
		'expectedTrackers',
		'expectedDuration',
		'nextTrackers',
		'nextDuration',
		'effectiveAt',
	] as const;
	const sealedCount = sealedFields.filter(field => value[field] !== undefined).length;
	if (sealedCount !== 0 && sealedCount !== sealedFields.length) {
		issues.push(issue(path, 'value', 'Incomplete sealed timer state.'));
	}
	if (!allowReduced && sealedCount !== sealedFields.length) {
		issues.push(issue(path, 'required', 'Exact tracker state required.'));
	}
	if (value.expectedTrackers !== undefined) {
		checkBoundedString(value.expectedTrackers, `${path}/expectedTrackers`, 65_536, issues);
		checkBoundedString(value.nextTrackers, `${path}/nextTrackers`, 65_536, issues);
		checkNonNegativeInteger(value.expectedDuration, `${path}/expectedDuration`, issues);
		checkNonNegativeInteger(value.nextDuration, `${path}/nextDuration`, issues);
		checkTimestamp(value.effectiveAt, `${path}/effectiveAt`, issues);
		if (hasSessionNumber) {
			checkNonNegativeInteger(value.selectedRawIndex, `${path}/selectedRawIndex`, issues);
			for (const field of ['expectedStart', 'expectedEnd'] as const) {
				checkTypedUpdateValue(value[field], 'datetime', `${path}/${field}`, issues);
				if (typeof value[field] === 'string' && value[field].length !== 19) {
					issues.push(issue(`${path}/${field}`, 'value', 'Expected canonical seconds.'));
				}
			}
		} else if (
			value.selectedRawIndex !== undefined
			|| value.expectedStart !== undefined
			|| value.expectedEnd !== undefined
		) {
			issues.push(issue(path, 'value', 'Unexpected selected session.'));
		}
	}
}

function checkFileToInlineTarget(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a conversion target object.'));
		return;
	}
	if (value.mode === 'exact-line') {
		checkObjectFields(value, path, ['mode', 'filePath', 'lineNumber'], issues);
		checkNonEmptyString(value.filePath, `${path}/filePath`, issues);
		checkVaultRelativePath(value.filePath, `${path}/filePath`, issues);
		checkNonNegativeInteger(value.lineNumber, `${path}/lineNumber`, issues);
		return;
	}
	if (value.mode === 'configured-target') {
		checkObjectFields(value, path, ['mode', 'filePath'], issues);
		if (value.filePath !== undefined) {
			checkNonEmptyString(value.filePath, `${path}/filePath`, issues);
			checkVaultRelativePath(value.filePath, `${path}/filePath`, issues);
		}
		return;
	}
	checkObjectFields(value, path, ['mode', 'filePath', 'lineNumber'], issues);
	checkEnum(value.mode, ['exact-line', 'configured-target'], `${path}/mode`, issues);
}

function checkCreateTaskSpec(
	value: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
): void {
	checkObjectFields(value, path, ['operation', 'items'], issues);
	if (!Array.isArray(value.items) || value.items.length === 0) {
		issues.push(issue(`${path}/items`, Array.isArray(value.items) ? 'value' : 'type', 'Create requires at least one item.'));
		return;
	}
	if (value.items.length > CONTRACT_LIMITS_V1.createItems) {
		issues.push(issue(`${path}/items`, 'value', 'Create item count exceeds the V1 cap.'));
	}
	const itemRefs = new Set<string>();
	const parentRefs = new Map<string, string>();
	const createItems = value.items as unknown[];
	for (let index = 0; index < createItems.length; index++) {
		const itemPath = `${path}/items/${index}`;
		const item = inspectObject(createItems[index], itemPath, [
			'itemRef', 'description', 'target', 'fields', 'tags',
			'statusId', 'priorityId', 'parent', 'related', 'dependencies', 'bodyMarkdown',
		], issues);
		if (!item) continue;
		checkRequestId(item.itemRef, `${itemPath}/itemRef`, issues);
		checkCharacterCap(item.itemRef, `${itemPath}/itemRef`, 128, issues);
		if (typeof item.itemRef === 'string') {
			if (itemRefs.has(item.itemRef)) {
				issues.push(issue(`${itemPath}/itemRef`, 'value', 'Create itemRef values must be unique.'));
			}
			itemRefs.add(item.itemRef);
		}
		checkBoundedNonEmptyString(item.description, `${itemPath}/description`, 16_384, issues);
		checkCreateScalarSafety(item.description, `${itemPath}/description`, issues);
		checkCreateTarget(item.target, `${itemPath}/target`, issues);
		if (item.bodyMarkdown !== undefined) {
			checkStringByteCap(
				item.bodyMarkdown,
				`${itemPath}/bodyMarkdown`,
				CONTRACT_LIMITS_V1.generalStringBytes,
				issues,
			);
			checkCreateBodyMarkdownSafety(item.bodyMarkdown, `${itemPath}/bodyMarkdown`, issues);
			if (!isPlainRecord(item.target) || item.target.representation !== 'file') {
				issues.push(issue(
					`${itemPath}/bodyMarkdown`,
					'value',
					'Create bodyMarkdown requires an explicitly requested file representation.',
				));
			}
		}
		checkCreateFields(item.fields, `${itemPath}/fields`, issues);
		if (item.tags !== undefined) {
			checkBoundedStringArray(item.tags, `${itemPath}/tags`, issues);
			checkUniqueStrings(item.tags, `${itemPath}/tags`, issues);
			if (Array.isArray(item.tags)) {
				for (let tagIndex = 0; tagIndex < item.tags.length; tagIndex++) {
					const tag: unknown = item.tags[tagIndex];
					if (
						typeof tag === 'string'
						&& !/^(?=.*[^0-9])[^\s#,[\]{}|\\^]+$/u.test(tag)
					) {
						issues.push(issue(
							`${itemPath}/tags/${tagIndex}`,
							'value',
							'Create tags must be one safe Obsidian tag token without whitespace or control syntax.',
						));
					}
				}
			}
		}
		if (item.statusId !== undefined) {
			checkBoundedNonEmptyString(item.statusId, `${itemPath}/statusId`, 256, issues);
			checkCreateScalarSafety(item.statusId, `${itemPath}/statusId`, issues);
		}
		if (item.priorityId !== undefined) {
			checkBoundedNonEmptyString(item.priorityId, `${itemPath}/priorityId`, 256, issues);
			checkCreateScalarSafety(item.priorityId, `${itemPath}/priorityId`, issues);
		}
		if (item.parent !== undefined) {
			const reference = checkCreateReference(item.parent, `${itemPath}/parent`, issues);
			if (typeof item.itemRef === 'string' && reference?.kind === 'created') {
				parentRefs.set(item.itemRef, reference.itemRef);
			}
		}
		if (item.related !== undefined) {
			checkCreateReferences(item.related, `${itemPath}/related`, issues);
		}
		if (item.dependencies !== undefined) {
			checkCreateDependencies(item.dependencies, `${itemPath}/dependencies`, issues);
		}
	}
	for (let index = 0; index < createItems.length; index++) {
		const item: unknown = createItems[index];
		if (!isPlainRecord(item) || typeof item.itemRef !== 'string') continue;
		for (const [reference, referencePath] of collectCreatedReferences(item, `${path}/items/${index}`)) {
			if (!itemRefs.has(reference)) {
				issues.push(issue(referencePath, 'value', 'Created reference must resolve to an item in the same create graph.'));
			}
			if (reference === item.itemRef) {
				issues.push(issue(referencePath, 'value', 'Create item cannot reference itself.'));
			}
		}
	}
	for (const itemRef of itemRefs) {
		const visited = new Set<string>();
		let current: string | undefined = itemRef;
		while (current !== undefined) {
			if (visited.has(current)) {
				issues.push(issue(`${path}/items`, 'value', 'Create parent graph must be acyclic.'));
				break;
			}
			visited.add(current);
			current = parentRefs.get(current);
		}
	}
}

function checkCreateTarget(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['representation', 'mode', 'filePath', 'lineNumber', 'templateId', 'identityPlaceholderPolicy'], issues);
	if (!object) return;
	checkEnum(object.mode, ['configured-default', 'exact-path'], `${path}/mode`, issues);
	if (object.mode === 'configured-default') {
		if (
			object.filePath !== undefined
			|| object.lineNumber !== undefined
			|| (object.representation === undefined && object.templateId !== undefined)
		) {
			issues.push(issue(path, 'value', 'Configured-default target cannot contain an exact path, line, or unscoped template.'));
		}
	} else if (object.mode === 'exact-path') {
		checkEnum(object.representation, ['inline', 'file'], `${path}/representation`, issues);
		checkNonEmptyString(object.filePath, `${path}/filePath`, issues);
		checkVaultRelativePath(object.filePath, `${path}/filePath`, issues);
	}
	if (object.representation !== undefined) {
		checkEnum(object.representation, ['inline', 'file'], `${path}/representation`, issues);
	} else if (object.mode !== 'configured-default') {
		issues.push(issue(`${path}/representation`, 'required', 'Exact-path target requires a representation.'));
	}
	if (object.identityPlaceholderPolicy !== undefined && object.representation !== 'file') {
		issues.push(issue(
			`${path}/identityPlaceholderPolicy`,
			'value',
			'Identity placeholder resolution requires an explicit File Task target.',
		));
	}
	if (object.representation === 'inline') {
		if (object.templateId !== undefined) {
			issues.push(issue(`${path}/templateId`, 'value', 'Inline target cannot select a file template.'));
		}
		if (object.lineNumber !== undefined) checkNonNegativeInteger(object.lineNumber, `${path}/lineNumber`, issues);
		if (object.identityPlaceholderPolicy !== undefined) {
			issues.push(issue(`${path}/identityPlaceholderPolicy`, 'value', 'Inline target cannot resolve File Task identity placeholders.'));
		}
	} else if (object.representation === 'file') {
		if (object.lineNumber !== undefined) {
			issues.push(issue(`${path}/lineNumber`, 'value', 'File target cannot include a line number.'));
		}
		if (object.templateId !== undefined) checkBoundedNonEmptyString(object.templateId, `${path}/templateId`, 256, issues);
		if (object.templateId !== undefined) checkCreateScalarSafety(object.templateId, `${path}/templateId`, issues);
		if (object.identityPlaceholderPolicy !== undefined) {
			checkLiteral(object.identityPlaceholderPolicy, 'resolve-operon-id-v1', `${path}/identityPlaceholderPolicy`, issues);
		}
	}
}

function checkCreateDependencies(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.createRelationsPerItem) {
		issues.push(issue(path, 'value', 'Create dependency count exceeds the V1 cap.'));
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const dependency = inspectObject(value[index], itemPath, ['relation', 'target'], issues);
		if (!dependency) continue;
		checkEnum(dependency.relation, ['blocks', 'blocked-by'], `${itemPath}/relation`, issues);
		const reference = checkCreateReference(dependency.target, `${itemPath}/target`, issues);
		if (!reference || typeof dependency.relation !== 'string') continue;
		const targetIdentity = reference.kind === 'existing'
			? `existing:${reference.operonId}`
			: `created:${reference.itemRef}`;
		const identity = `${dependency.relation}:${targetIdentity}`;
		if (identities.has(identity)) {
			issues.push(issue(itemPath, 'value', 'Create dependencies must be unique by relation and target.'));
		}
		identities.add(identity);
	}
}

function checkCreateFields(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > 128) {
		issues.push(issue(path, 'value', 'Create field count exceeds the V1 cap.'));
	}
	const identities = new Set<string>();
	const fieldItems = value as unknown[];
	for (let index = 0; index < fieldItems.length; index++) {
		const itemPath = `${path}/${index}`;
		const item: unknown = fieldItems[index];
		if (!isPlainRecord(item)) {
			issues.push(issue(itemPath, 'type', 'Expected a field object.'));
			continue;
		}
		const kind = item.kind;
		let identity = String(kind);
		if (kind === 'text') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'value'], issues);
			checkEnum(item.field, ['taskIcon', 'taskColor', 'note', 'location'], `${itemPath}/field`, issues);
			checkBoundedString(item.value, `${itemPath}/value`, CONTRACT_LIMITS_V1.generalStringBytes, issues);
			checkCreateScalarSafety(item.value, `${itemPath}/value`, issues);
			identity += `:${String(item.field)}`;
		} else if (kind === 'date') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'value'], issues);
			checkEnum(item.field, ['dateDue', 'dateScheduled', 'dateStarted'], `${itemPath}/field`, issues);
			checkTypedUpdateValue(item.value, 'date', `${itemPath}/value`, issues);
			identity += `:${String(item.field)}`;
		} else if (kind === 'datetime') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'value'], issues);
			checkEnum(item.field, ['datetimeStart', 'datetimeEnd'], `${itemPath}/field`, issues);
			checkTypedUpdateValue(item.value, 'datetime', `${itemPath}/value`, issues);
			identity += `:${String(item.field)}`;
		} else if (kind === 'number') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'value'], issues);
			checkLiteral(item.field, 'estimate', `${itemPath}/field`, issues);
			checkTypedUpdateValue(item.value, 'number', `${itemPath}/value`, issues);
			identity += ':estimate';
		} else if (kind === 'list') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'value'], issues);
			checkEnum(item.field, ['assignees', 'contexts', 'links'], `${itemPath}/field`, issues);
			checkTypedUpdateValue(item.value, 'list', `${itemPath}/value`, issues);
			checkUniqueStrings(item.value, `${itemPath}/value`, issues);
			checkCreateSerializedListSafety(item.value, `${itemPath}/value`, issues);
			checkCreateListItemCap(item.value, `${itemPath}/value`, issues);
			identity += `:${String(item.field)}`;
		} else if (kind === 'custom') {
			checkObjectFields(item, itemPath, ['kind', 'field', 'valueType', 'value'], issues);
			checkBoundedNonEmptyString(item.field, `${itemPath}/field`, 256, issues);
			checkEnum(item.valueType, FIELD_VALUE_TYPES_V1, `${itemPath}/valueType`, issues);
			checkTypedUpdateValue(item.value, item.valueType, `${itemPath}/value`, issues);
			if (item.valueType === 'text') {
				checkCreateScalarSafety(item.value, `${itemPath}/value`, issues);
			} else if (item.valueType === 'list') {
				checkCreateSerializedListSafety(item.value, `${itemPath}/value`, issues);
				checkCreateListItemCap(item.value, `${itemPath}/value`, issues);
			}
			if (
				typeof item.field === 'string'
				&& (
					(GENERAL_UPDATE_BUILT_IN_KEYS_V1 as readonly string[]).includes(item.field)
					|| (SEMANTIC_CAPABILITY_KEYS_V1 as readonly string[]).includes(item.field)
					|| (RUNTIME_OWNED_KEYS_V1 as readonly string[]).includes(item.field)
				)
			) {
				issues.push(issue(`${itemPath}/field`, 'value', 'Custom create field must not collide with an Operon-owned field.'));
			}
			identity += `:${String(item.field)}`;
		} else if (kind === 'reminder-datetimes' || kind === 'reminder-rules') {
			checkObjectFields(item, itemPath, ['kind', 'values'], issues);
			checkBoundedStringArray(item.values, `${itemPath}/values`, issues);
			checkUniqueStrings(item.values, `${itemPath}/values`, issues);
			checkCreateSerializedListSafety(item.values, `${itemPath}/values`, issues);
			checkCreateListItemCap(item.values, `${itemPath}/values`, issues);
			if (kind === 'reminder-datetimes' && Array.isArray(item.values)) {
				for (let valueIndex = 0; valueIndex < item.values.length; valueIndex++) {
					checkTypedUpdateValue(item.values[valueIndex], 'datetime', `${itemPath}/values/${valueIndex}`, issues);
				}
			}
		} else if (kind === 'recurrence') {
			checkObjectFields(item, itemPath, ['kind', 'rule', 'endDatetime'], issues);
			checkBoundedNonEmptyString(item.rule, `${itemPath}/rule`, 4_096, issues);
			checkCreateScalarSafety(item.rule, `${itemPath}/rule`, issues);
			if (item.endDatetime !== undefined) {
				checkTypedUpdateValue(item.endDatetime, 'datetime', `${itemPath}/endDatetime`, issues);
			}
		} else {
			issues.push(issue(`${itemPath}/kind`, 'value', 'Unknown create field kind.'));
			continue;
		}
		if (identities.has(identity)) issues.push(issue(itemPath, 'value', 'Create fields must be unique per semantic field.'));
		identities.add(identity);
	}
}

function checkCreateReference(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): { kind: 'existing'; operonId: string } | { kind: 'created'; itemRef: string } | null {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a create reference object.'));
		return null;
	}
	if (value.kind === 'existing') {
		checkObjectFields(value, path, ['kind', 'operonId'], issues);
		checkCanonicalOperonId(value.operonId, `${path}/operonId`, issues);
		return typeof value.operonId === 'string' ? { kind: 'existing', operonId: value.operonId } : null;
	}
	if (value.kind === 'created') {
		checkObjectFields(value, path, ['kind', 'itemRef'], issues);
		checkRequestId(value.itemRef, `${path}/itemRef`, issues);
		checkCharacterCap(value.itemRef, `${path}/itemRef`, 128, issues);
		return typeof value.itemRef === 'string' ? { kind: 'created', itemRef: value.itemRef } : null;
	}
	issues.push(issue(`${path}/kind`, 'value', 'Unknown create reference kind.'));
	return null;
}

function checkCreateReferences(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.createRelationsPerItem) {
		issues.push(issue(path, 'value', 'Create relation count exceeds the V1 cap.'));
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const reference = checkCreateReference(value[index], `${path}/${index}`, issues);
		if (!reference) continue;
		const identity = reference.kind === 'existing' ? `existing:${reference.operonId}` : `created:${reference.itemRef}`;
		if (identities.has(identity)) issues.push(issue(`${path}/${index}`, 'value', 'Create references must be unique.'));
		identities.add(identity);
	}
}

function collectCreatedReferences(
	item: Record<string, unknown>,
	itemPath: string,
): Array<[string, string]> {
	const references: Array<[string, string]> = [];
	if (isPlainRecord(item.parent) && item.parent.kind === 'created' && typeof item.parent.itemRef === 'string') {
		references.push([item.parent.itemRef, `${itemPath}/parent/itemRef`]);
	}
	if (Array.isArray(item.related)) {
		const related = item.related as unknown[];
		for (let index = 0; index < related.length; index++) {
			const reference: unknown = related[index];
			if (isPlainRecord(reference) && reference.kind === 'created' && typeof reference.itemRef === 'string') {
				references.push([reference.itemRef, `${itemPath}/related/${index}/itemRef`]);
			}
		}
	}
	if (Array.isArray(item.dependencies)) {
		const dependencies = item.dependencies as unknown[];
		for (let index = 0; index < dependencies.length; index++) {
			const dependency: unknown = dependencies[index];
			if (
				isPlainRecord(dependency)
				&& isPlainRecord(dependency.target)
				&& dependency.target.kind === 'created'
				&& typeof dependency.target.itemRef === 'string'
			) {
				references.push([dependency.target.itemRef, `${itemPath}/dependencies/${index}/target/itemRef`]);
			}
		}
	}
	return references;
}

function checkRelocationEndpoint(value: unknown, path: string, destination: boolean, issues: DecodeIssueV1[]): void {
	const keys = destination
		? ['locator', 'lineDigest', 'sourceRevision', 'mustBeBlank']
		: ['locator', 'lineDigest', 'sourceRevision'];
	const object = inspectObject(value, path, keys, issues);
	if (!object) return;
	checkLocator(object.locator, `${path}/locator`, issues);
	if (isPlainRecord(object.locator) && object.locator.representation !== 'inline') {
		issues.push(issue(`${path}/locator/representation`, 'value', 'Inline relocation requires inline locators.'));
	}
	checkSha256(object.lineDigest, `${path}/lineDigest`, issues);
	checkSourceRevision(object.sourceRevision, `${path}/sourceRevision`, issues);
	if (destination) checkLiteral(object.mustBeBlank, true, `${path}/mustBeBlank`, issues);
}

function checkRelocationPreviewDestination(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(value, path, ['locator', 'mustBeBlank'], issues);
	if (!object) return;
	checkLocator(object.locator, `${path}/locator`, issues);
	if (isPlainRecord(object.locator) && object.locator.representation !== 'inline') {
		issues.push(issue(`${path}/locator/representation`, 'value', 'Inline relocation requires an inline destination.'));
	}
	checkLiteral(object.mustBeBlank, true, `${path}/mustBeBlank`, issues);
}

const RECURRENCE_UPDATE_TYPES: Readonly<Record<string, 'text' | 'number' | 'date' | 'datetime'>> = Object.freeze({
	repeat: 'text',
	datetimeRepeatEnd: 'datetime',
	dateScheduled: 'date',
	dateStarted: 'date',
	dateDue: 'date',
	datetimeStart: 'datetime',
	datetimeEnd: 'datetime',
	estimate: 'number',
});

function checkRecurrenceUpdateItems(
	value: unknown,
	path: string,
	scope: unknown,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length === 0 || value.length > RECURRENCE_UPDATE_KEYS_V1.length) {
		issues.push(issue(path, 'length', 'Recurrence update requires one to eight field changes.'));
	}
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const rawItem: unknown = value[index];
		const isClear = isPlainRecord(rawItem) && rawItem.operation === 'clear';
		const item = inspectObject(
			rawItem,
			itemPath,
			isClear
				? ['operation', 'field', 'valueType', 'expectedValue']
				: ['field', 'valueType', 'value', 'expectedValue'],
			issues,
		);
		if (!item) continue;
		if (isClear) checkLiteral(item.operation, 'clear', `${itemPath}/operation`, issues);
		checkEnum(item.field, RECURRENCE_UPDATE_KEYS_V1, `${itemPath}/field`, issues);
		const expectedType = typeof item.field === 'string'
			? RECURRENCE_UPDATE_TYPES[item.field]
			: undefined;
		if (expectedType) checkLiteral(item.valueType, expectedType, `${itemPath}/valueType`, issues);
		if (typeof item.field === 'string') {
			if (seen.has(item.field)) {
				issues.push(issue(`${itemPath}/field`, 'value', 'Recurrence update fields must be unique.'));
			}
			seen.add(item.field);
			if (
				scope === 'this-task'
				&& (item.field === 'repeat' || item.field === 'datetimeRepeatEnd')
			) {
				issues.push(issue(
					`${itemPath}/field`,
					'value',
					'This-task recurrence updates cannot change repeat or datetimeRepeatEnd.',
				));
			}
		}
		if (!isClear) checkRecurrenceTypedValue(item.value, expectedType, `${itemPath}/value`, issues);
		if (item.expectedValue !== undefined) {
			checkRecurrenceTypedValue(
				item.expectedValue,
				expectedType,
				`${itemPath}/expectedValue`,
				issues,
			);
		}
	}
}

function checkRecurrenceExpectedState(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectObject(
		value,
		path,
		['fieldValues', 'repeatSeriesId', 'repeatOccurrenceDate'],
		issues,
	);
	if (!object) return;
	for (const key of ['fieldValues', 'repeatSeriesId', 'repeatOccurrenceDate'] as const) {
		if (!Object.prototype.hasOwnProperty.call(object, key)) {
			issues.push(issue(`${path}/${key}`, 'required', `Expected recurrence state requires ${key}.`));
		}
	}
	const fieldValues = inspectObject(
		object.fieldValues,
		`${path}/fieldValues`,
		RECURRENCE_UPDATE_KEYS_V1,
		issues,
	);
	if (fieldValues) {
		for (const key of RECURRENCE_UPDATE_KEYS_V1) {
			if (fieldValues[key] === undefined) continue;
			checkRecurrenceTypedValue(
				fieldValues[key],
				RECURRENCE_UPDATE_TYPES[key],
				`${path}/fieldValues/${key}`,
				issues,
			);
		}
	}
	if (object.repeatSeriesId !== null) {
		checkBoundedNonEmptyString(object.repeatSeriesId, `${path}/repeatSeriesId`, 256, issues);
		if (
			typeof object.repeatSeriesId === 'string'
			&& !/^rs[a-z0-9]{5}$/u.test(object.repeatSeriesId)
		) {
			issues.push(issue(
				`${path}/repeatSeriesId`,
				'value',
				'Expected a canonical repeatSeriesId or null.',
			));
		}
	}
	if (object.repeatOccurrenceDate !== null) {
		if (
			typeof object.repeatOccurrenceDate !== 'string'
			|| !isValidCalendarDate(object.repeatOccurrenceDate)
		) {
			issues.push(issue(
				`${path}/repeatOccurrenceDate`,
				'value',
				'Expected a real YYYY-MM-DD recurrence occurrence date or null.',
			));
		}
	}
}

function checkRecurrenceTypedValue(
	value: unknown,
	valueType: 'text' | 'number' | 'date' | 'datetime' | undefined,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (valueType === 'text') {
		checkBoundedNonBlankString(value, path, CONTRACT_LIMITS_V1.generalStringBytes, issues);
		return;
	}
	const issueStart = issues.length;
	checkTypedUpdateValue(value, valueType, path, issues);
	if (valueType === 'number' && issues.length === issueStart && (value as number) < 0) {
		issues.push(issue(path, 'value', 'Expected a finite non-negative number.'));
	}
}

function checkUpdateItems(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
		issues.push(issue(path, 'value', 'Update item count exceeds the V1 cap.'));
	}
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const rawItem: unknown = value[index];
		const isClear = isPlainRecord(rawItem) && rawItem.operation === 'clear';
		const item = inspectObject(
			rawItem,
			itemPath,
			isClear ? ['operation', 'field', 'valueType'] : ['field', 'valueType', 'value'],
			issues,
		);
		if (!item) continue;
		if (isClear) checkLiteral(item.operation, 'clear', `${itemPath}/operation`, issues);
		checkNonEmptyString(item.field, `${itemPath}/field`, issues);
		checkCharacterCap(item.field, `${itemPath}/field`, FIELD_CATALOG_LIMITS_V1.canonicalKeyCharacters, issues);
		checkEnum(item.valueType, ['text', 'number', 'date', 'datetime', 'list', 'checkbox'], `${itemPath}/valueType`, issues);
		if (!isClear) checkJsonValue(item.value, `${itemPath}/value`, issues);
		if (typeof item.field === 'string') {
			if (seen.has(item.field)) issues.push(issue(`${itemPath}/field`, 'value', 'Update fields must be unique.'));
			seen.add(item.field);
			if (
				(SEMANTIC_CAPABILITY_KEYS_V1 as readonly string[]).includes(item.field)
				|| (RUNTIME_OWNED_KEYS_V1 as readonly string[]).includes(item.field)
			) {
				issues.push(issue(`${itemPath}/field`, 'value', 'Field requires a semantic capability or is Runtime-owned.'));
			}
			const expectedType = BUILT_IN_GENERAL_UPDATE_TYPES[item.field];
			if (
				(GENERAL_UPDATE_BUILT_IN_KEYS_V1 as readonly string[]).includes(item.field)
				&& item.valueType !== expectedType
			) {
				issues.push(issue(`${itemPath}/valueType`, 'value', `Built-in field ${item.field} requires ${expectedType}.`));
			}
		}
		if (isClear && item.field === 'description') {
			issues.push(issue(`${itemPath}/field`, 'value', 'Task description cannot be cleared.'));
		}
		if (!isClear) checkTypedUpdateValue(item.value, item.valueType, `${itemPath}/value`, issues);
		if (!isClear && item.field === 'description' && typeof item.value === 'string') {
			checkCreateScalarSafety(item.value, `${itemPath}/value`, issues);
			if (!item.value.trim()) {
				issues.push(issue(`${itemPath}/value`, 'value', 'Task description cannot be empty.'));
			}
		}
		if (!isClear && item.field === 'tags' && Array.isArray(item.value)) {
			for (let tagIndex = 0; tagIndex < item.value.length; tagIndex++) {
				const tag: unknown = item.value[tagIndex];
				if (typeof tag !== 'string') continue;
				checkCreateScalarSafety(tag, `${itemPath}/value/${tagIndex}`, issues);
				if (!/^[\p{L}\p{N}_/-]+$/u.test(tag.replace(/^#/u, ''))) {
					issues.push(issue(
						`${itemPath}/value/${tagIndex}`,
						'value',
						'Tag updates accept only portable Obsidian tag-token characters.',
					));
				}
			}
		}
	}
}

function checkUpdateBatchSpec(
	value: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
): void {
	checkObjectFields(value, path, ['operation', 'items'], issues);
	if (!Array.isArray(value.items)) {
		issues.push(issue(`${path}/items`, 'type', 'Expected an array.'));
		return;
	}
	if (
		value.items.length < MUTATION_READINESS_OPERON_IDS_MIN_V1
		|| value.items.length > MUTATION_READINESS_OPERON_IDS_MAX_V1
	) {
		issues.push(issue(
			`${path}/items`,
			'length',
			`update-batch requires ${MUTATION_READINESS_OPERON_IDS_MIN_V1}-${MUTATION_READINESS_OPERON_IDS_MAX_V1} items.`,
		));
	}
	const itemRefs = new Set<string>();
	const operonIds = new Set<string>();
	const filePaths = new Set<string>();
	for (let index = 0; index < value.items.length; index++) {
		const itemPath = `${path}/items/${index}`;
		const item = inspectObject(value.items[index], itemPath, ['itemRef', 'target', 'changes'], issues);
		if (!item) continue;
		checkRequestId(item.itemRef, `${itemPath}/itemRef`, issues);
		checkCharacterCap(item.itemRef, `${itemPath}/itemRef`, 128, issues);
		checkExactMutationTarget(item.target, `${itemPath}/target`, issues);
		checkUpdateItems(item.changes, `${itemPath}/changes`, issues);
		if (Array.isArray(item.changes) && item.changes.length === 0) {
			issues.push(issue(`${itemPath}/changes`, 'length', 'Batch update item requires at least one change.'));
		}
		if (typeof item.itemRef === 'string') {
			if (itemRefs.has(item.itemRef)) issues.push(issue(`${itemPath}/itemRef`, 'value', 'Batch itemRef values must be unique.'));
			itemRefs.add(item.itemRef);
		}
		if (isPlainRecord(item.target) && typeof item.target.operonId === 'string') {
			if (operonIds.has(item.target.operonId)) {
				issues.push(issue(`${itemPath}/target/operonId`, 'value', 'Batch target operonIds must be unique.'));
			}
			operonIds.add(item.target.operonId);
		}
		if (isPlainRecord(item.target) && isPlainRecord(item.target.locator)) {
			if (item.target.locator.representation !== 'inline') {
				issues.push(issue(`${itemPath}/target/locator`, 'value', 'update-batch supports inline targets only.'));
			}
			if (typeof item.target.locator.filePath === 'string') filePaths.add(item.target.locator.filePath);
		}
	}
	if (filePaths.size > 1) {
		issues.push(issue(`${path}/items`, 'value', 'update-batch targets must share one Markdown source.'));
	}
}

function checkReplaceRelationshipsSpec(
	value: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const issueStart = issues.length;
	checkObjectFields(value, path, ['operation', 'changes', 'affectedOperonIds'], issues);
	if (!Array.isArray(value.changes)) {
		issues.push(issue(`${path}/changes`, 'type', 'Expected an array.'));
		return;
	}
	for (let index = 0; index < value.changes.length; index++) {
		const itemPath = `${path}/changes/${index}`;
		const item = inspectObject(
			value.changes[index],
			itemPath,
			['field', 'targetOperonIds', 'expectedTargetOperonIds'],
			issues,
		);
		if (!item) continue;
		checkEnum(item.field, ['parentTask', 'blocking', 'blockedBy'], `${itemPath}/field`, issues);
		checkCanonicalOperonIdArray(item.targetOperonIds, `${itemPath}/targetOperonIds`, issues);
		if (item.expectedTargetOperonIds !== undefined) {
			checkCanonicalOperonIdArray(
				item.expectedTargetOperonIds,
				`${itemPath}/expectedTargetOperonIds`,
				issues,
			);
		}
	}
	if (value.affectedOperonIds !== undefined) {
		checkCanonicalOperonIdArray(value.affectedOperonIds, `${path}/affectedOperonIds`, issues);
	}
	if (issues.length === issueStart) {
		const violation = validateTaskRelationshipSpecV1(
			value as unknown as import('./mutation').ReplaceTaskRelationshipsSpecV1,
		);
		if (violation) issues.push(issue(path, 'value', violation));
	}
}

function checkCapabilityMutationPair(
	capability: unknown,
	mutationKind: unknown,
	mode: 'preview' | 'apply',
	issues: DecodeIssueV1[],
): void {
	if (typeof capability !== 'string' || !isCapabilityIdV1(capability)) {
		issues.push(issue('/capability', 'value', 'Unknown capability.'));
		return;
	}
	if (typeof mutationKind !== 'string' || !isMutationKindV1(mutationKind)) {
		issues.push(issue('/mutationKind', 'value', 'Unknown mutation kind.'));
		return;
	}
	const expected = MUTATION_CAPABILITY_MAP_V1[mutationKind][mode];
	const definition = CAPABILITY_REGISTRY_V1.find(item => item.id === capability);
	if (capability !== expected || definition?.mode !== mode) {
		issues.push(issue('/capability', 'value', 'Capability does not match mutation kind and operation mode.'));
	}
}

function checkAuthorization(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['basis', 'reason'], issues);
	if (!object) return;
	checkEnum(object.basis, AUTHORIZATION_BASES_V1, `${path}/basis`, issues);
	if (object.reason !== undefined) checkBoundedNonEmptyString(object.reason, `${path}/reason`, CONTRACT_LIMITS_V1.reasonBytes, issues);
}

function checkSelector(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a selector object.'));
		return;
	}
	if (value.kind === 'operon-id') {
		checkObjectFields(value, path, ['kind', 'operonId'], issues);
		checkCanonicalOperonId(value.operonId, `${path}/operonId`, issues);
	} else if (value.kind === 'exact-locator') {
		checkObjectFields(value, path, ['kind', 'locator', 'expectedOperonId'], issues);
		checkLocator(value.locator, `${path}/locator`, issues);
		if (value.expectedOperonId !== undefined) checkCanonicalOperonId(value.expectedOperonId, `${path}/expectedOperonId`, issues);
	} else if (value.kind === 'exact-path') {
		checkObjectFields(value, path, ['kind', 'filePath', 'expectedOperonId'], issues);
		if (typeof value.filePath !== 'string') issues.push(issue(`${path}/filePath`, 'type', 'Expected a string.'));
		else {
			const error = validateVaultRelativePathV1(value.filePath);
			if (error) issues.push(issue(`${path}/filePath`, 'value', error.reason));
		}
		if (value.expectedOperonId !== undefined) checkCanonicalOperonId(value.expectedOperonId, `${path}/expectedOperonId`, issues);
	} else if (value.kind === 'exact-name') {
		checkObjectFields(value, path, ['kind', 'noteName', 'expectedOperonId'], issues);
		checkNonEmptyString(value.noteName, `${path}/noteName`, issues);
		checkCharacterCap(value.noteName, `${path}/noteName`, 4_096, issues);
		if (typeof value.noteName === 'string' && (/[/\\]/.test(value.noteName) || hasControlCharacterV1(value.noteName))) {
			issues.push(issue(`${path}/noteName`, 'value', 'Exact note name cannot contain path separators or control characters.'));
		}
		if (value.expectedOperonId !== undefined) checkCanonicalOperonId(value.expectedOperonId, `${path}/expectedOperonId`, issues);
	} else if (value.kind === 'search') {
		checkObjectFields(value, path, ['kind', 'query', 'limit'], issues);
		checkNonEmptyString(value.query, `${path}/query`, issues);
		checkCharacterCap(value.query, `${path}/query`, 4_096, issues);
		if (value.limit !== undefined) checkBoundedPositiveInteger(value.limit, `${path}/limit`, 500, issues);
	} else {
		issues.push(issue(`${path}/kind`, 'value', 'Unknown selector kind.'));
	}
}

function hasControlCharacterV1(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function checkExactMutationTarget(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['operonId', 'locator'], issues);
	if (!object) return;
	if (typeof object.operonId !== 'string' || !OPERON_ID_PATTERN_V1.test(object.operonId)) {
		issues.push(issue(`${path}/operonId`, 'value', 'Mutation target requires a canonical operonId.'));
	}
	checkLocator(object.locator, `${path}/locator`, issues);
}

function checkLocator(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a locator object.'));
		return;
	}
	if (value.representation === 'inline') {
		checkObjectFields(value, path, ['representation', 'filePath', 'lineNumber'], issues);
		checkNonEmptyString(value.filePath, `${path}/filePath`, issues);
		checkNonNegativeInteger(value.lineNumber, `${path}/lineNumber`, issues);
	} else if (value.representation === 'file') {
		checkObjectFields(value, path, ['representation', 'filePath'], issues);
		checkNonEmptyString(value.filePath, `${path}/filePath`, issues);
	} else {
		issues.push(issue(`${path}/representation`, 'value', 'Unknown task representation.'));
		return;
	}
	const lexicalError = validateLocatorLexicallyV1(value as unknown as TaskSourceLocatorV1);
	if (lexicalError) issues.push(issue(path, 'value', lexicalError.reason));
}

function checkContextRevision(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'index', 'settingsFingerprint', 'pinnedGeneration', 'activeTrackerGeneration',
		'repeatSeriesRevision', 'projectSerialGeneration', 'projectSerialSignature',
	], issues);
	if (!object) return;
	const index = inspectObject(object.index, `${path}/index`, ['sessionId', 'ramGeneration', 'durable'], issues);
	if (index) {
		checkNonEmptyString(index.sessionId, `${path}/index/sessionId`, issues);
		checkNonNegativeInteger(index.ramGeneration, `${path}/index/ramGeneration`, issues);
		const durable = inspectObject(
			index.durable,
			`${path}/index/durable`,
			['status', 'snapshotId', 'committedAt'],
			issues,
		);
		if (durable) {
			checkEnum(
				durable.status,
				['available', 'missing', 'recovery-required', 'unavailable'],
				`${path}/index/durable/status`,
				issues,
			);
			if (durable.status === 'available') {
				checkNonEmptyString(durable.snapshotId, `${path}/index/durable/snapshotId`, issues);
				checkTimestamp(durable.committedAt, `${path}/index/durable/committedAt`, issues);
			} else if (durable.snapshotId !== undefined || durable.committedAt !== undefined) {
				issues.push(issue(
					`${path}/index/durable`,
					'value',
					'Unavailable durable index revision cannot claim snapshot metadata.',
				));
			}
		}
	}
	checkSha256(object.settingsFingerprint, `${path}/settingsFingerprint`, issues);
	checkNonNegativeInteger(object.pinnedGeneration, `${path}/pinnedGeneration`, issues);
	checkNonNegativeInteger(object.activeTrackerGeneration, `${path}/activeTrackerGeneration`, issues);
	checkNonNegativeInteger(object.repeatSeriesRevision, `${path}/repeatSeriesRevision`, issues);
	checkNonNegativeInteger(object.projectSerialGeneration, `${path}/projectSerialGeneration`, issues);
	checkSha256(object.projectSerialSignature, `${path}/projectSerialSignature`, issues);
}

function checkRuntimeAdmission(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectResponseObject(value, path, ['reads', 'writes'], issues);
	if (!object) return;
	checkBoolean(object.reads, `${path}/reads`, issues);
	checkBoolean(object.writes, `${path}/writes`, issues);
}

function checkSourceRevision(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['algorithm', 'contentDigest'], issues);
	if (!object) return;
	checkLiteral(object.algorithm, 'sha256', `${path}/algorithm`, issues);
	checkSha256(object.contentDigest, `${path}/contentDigest`, issues);
}

function checkAffectedResources(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Expected a non-empty array.'));
		return;
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['resourceKind', 'resourceKey', 'revision'], issues);
		if (!item) continue;
		checkEnum(item.resourceKind, RESOURCE_KINDS_V1, `${itemPath}/resourceKind`, issues);
		checkNonEmptyString(item.resourceKey, `${itemPath}/resourceKey`, issues);
		checkNonEmptyString(item.revision, `${itemPath}/revision`, issues);
		const identity = `${String(item.resourceKind)}\0${String(item.resourceKey)}`;
		if (identities.has(identity)) issues.push(issue(itemPath, 'value', 'Duplicate affected resource.'));
		identities.add(identity);
	}
}

function checkAffectedResourceRevisions(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.affectedResources) {
		issues.push(issue(path, 'value', 'Affected resource revision map exceeds the V1 cap.'));
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['resourceKind', 'resourceKey', 'revision'], issues);
		if (!item) continue;
		checkEnum(item.resourceKind, RESOURCE_KINDS_V1, `${itemPath}/resourceKind`, issues);
		checkNonEmptyString(item.resourceKey, `${itemPath}/resourceKey`, issues);
		checkNonEmptyString(item.revision, `${itemPath}/revision`, issues);
		const identity = `${String(item.resourceKind)}\0${String(item.resourceKey)}`;
		if (identities.has(identity)) issues.push(issue(itemPath, 'value', 'Duplicate affected resource.'));
		identities.add(identity);
	}
}

function checkAtomicGroups(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Expected a non-empty array.'));
		return;
	}
	let previousOrder = -1;
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const group = inspectObject(value[index], itemPath, ['groupId', 'order', 'resources'], issues);
		if (!group) continue;
		checkNonEmptyString(group.groupId, `${itemPath}/groupId`, issues);
		checkNonNegativeInteger(group.order, `${itemPath}/order`, issues);
		if (typeof group.order === 'number' && group.order <= previousOrder) {
			issues.push(issue(`${itemPath}/order`, 'value', 'Atomic group order must be strictly increasing.'));
		}
		if (typeof group.order === 'number') previousOrder = group.order;
		checkResourceRefs(group.resources, `${itemPath}/resources`, issues);
	}
}

function checkResourceRefs(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Expected a non-empty array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['resourceKind', 'resourceKey'], issues);
		if (!item) continue;
		checkEnum(item.resourceKind, RESOURCE_KINDS_V1, `${itemPath}/resourceKind`, issues);
		checkNonEmptyString(item.resourceKey, `${itemPath}/resourceKey`, issues);
	}
}

function checkPredictedEffects(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Expected a non-empty array.'));
		return;
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['resourceKind', 'resourceKey', 'action', 'summary'], issues);
		if (!item) continue;
		checkEnum(item.resourceKind, RESOURCE_KINDS_V1, `${itemPath}/resourceKind`, issues);
		checkNonEmptyString(item.resourceKey, `${itemPath}/resourceKey`, issues);
		checkEnum(item.action, ['create', 'update', 'trash', 'state-change'], `${itemPath}/action`, issues);
		checkNonEmptyString(item.summary, `${itemPath}/summary`, issues);
		const identity = `${String(item.resourceKind)}\0${String(item.resourceKey)}\0${String(item.action)}`;
		if (identities.has(identity)) issues.push(issue(itemPath, 'value', 'Predicted effects must be unique.'));
		identities.add(identity);
	}
}

function checkCreateEffects(
	value: unknown,
	path: string,
	specValue: unknown,
	targetsValue: unknown,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Create plan requires exact createEffects.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.createItems) {
		issues.push(issue(path, 'value', 'Create effect count exceeds the V1 cap.'));
	}
	const itemRefs = new Set<string>();
	const operonIds = new Set<string>();
	const effectTargetKeys = new Set<string>();
	const effectsByItemRef = new Map<string, Record<string, unknown>>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const effect = inspectObject(value[index], itemPath, [
			'itemRef', 'operonId', 'repeatSeriesId', 'locator', 'targetBeforeDigest', 'expectedAbsence',
			'renderedTaskDigest', 'plannedSourceDigest', 'templateId', 'templateDigest',
			'resolvedParentOperonId', 'resolvedRelatedOperonIds',
			'resolvedDependencies', 'bodyMarkdownSummary', 'templateIdentityAllocations',
		], issues);
		if (!effect) continue;
		checkRequestId(effect.itemRef, `${itemPath}/itemRef`, issues);
		checkCharacterCap(effect.itemRef, `${itemPath}/itemRef`, 128, issues);
		checkCanonicalOperonId(effect.operonId, `${itemPath}/operonId`, issues);
		if (effect.repeatSeriesId !== undefined) {
			checkBoundedNonEmptyString(effect.repeatSeriesId, `${itemPath}/repeatSeriesId`, 256, issues);
		}
		checkLocator(effect.locator, `${itemPath}/locator`, issues);
		if ((effect.targetBeforeDigest === undefined) === (effect.expectedAbsence === undefined)) {
			issues.push(issue(itemPath, 'value', 'Create effect requires exactly one source precondition.'));
		}
		if (effect.targetBeforeDigest !== undefined) checkSha256(effect.targetBeforeDigest, `${itemPath}/targetBeforeDigest`, issues);
		if (effect.expectedAbsence !== undefined) checkLiteral(effect.expectedAbsence, true, `${itemPath}/expectedAbsence`, issues);
		checkSha256(effect.renderedTaskDigest, `${itemPath}/renderedTaskDigest`, issues);
		checkSha256(effect.plannedSourceDigest, `${itemPath}/plannedSourceDigest`, issues);
		if ((effect.templateId === undefined) !== (effect.templateDigest === undefined)) {
			issues.push(issue(itemPath, 'value', 'Template id and digest must be sealed together.'));
		}
		if (effect.templateId !== undefined) {
			checkBoundedNonEmptyString(effect.templateId, `${itemPath}/templateId`, 256, issues);
			checkSha256(effect.templateDigest, `${itemPath}/templateDigest`, issues);
			if (!isPlainRecord(effect.locator) || effect.locator.representation !== 'file') {
				issues.push(issue(`${itemPath}/templateId`, 'value', 'Only file creation may seal a template.'));
			}
		}
		if (effect.templateIdentityAllocations !== undefined) {
			if (!Array.isArray(effect.templateIdentityAllocations) || effect.templateIdentityAllocations.length > 256) {
				issues.push(issue(`${itemPath}/templateIdentityAllocations`, 'value', 'Template identity allocations must be a bounded array.'));
			} else {
				for (let allocationIndex = 0; allocationIndex < effect.templateIdentityAllocations.length; allocationIndex++) {
					const allocation = inspectObject(effect.templateIdentityAllocations[allocationIndex], `${itemPath}/templateIdentityAllocations/${allocationIndex}`, ['occurrence', 'suffix', 'operonId'], issues);
					if (!allocation) continue;
					checkNonNegativeInteger(allocation.occurrence, `${itemPath}/templateIdentityAllocations/${allocationIndex}/occurrence`, issues);
					if (allocation.suffix !== undefined && (typeof allocation.suffix !== 'string' || !/^[0-9A-Za-z]$/u.test(allocation.suffix))) {
						issues.push(issue(`${itemPath}/templateIdentityAllocations/${allocationIndex}/suffix`, 'value', 'Invalid identity placeholder suffix.'));
					}
					checkCanonicalOperonId(allocation.operonId, `${itemPath}/templateIdentityAllocations/${allocationIndex}/operonId`, issues);
				}
			}
		}
		if (effect.resolvedParentOperonId !== undefined) {
			checkCanonicalOperonId(effect.resolvedParentOperonId, `${itemPath}/resolvedParentOperonId`, issues);
		}
		if (
			Array.isArray(effect.resolvedRelatedOperonIds)
			&& effect.resolvedRelatedOperonIds.length > CONTRACT_LIMITS_V1.createRelationsPerItem
		) {
			issues.push(issue(`${itemPath}/resolvedRelatedOperonIds`, 'value', 'Resolved create relations exceed the V1 cap.'));
		}
		checkCanonicalOperonIdArray(effect.resolvedRelatedOperonIds, `${itemPath}/resolvedRelatedOperonIds`, issues);
		checkResolvedCreateDependencies(
			effect.resolvedDependencies,
			`${itemPath}/resolvedDependencies`,
			issues,
		);
		if (effect.bodyMarkdownSummary !== undefined) {
			const summary = inspectObject(
				effect.bodyMarkdownSummary,
				`${itemPath}/bodyMarkdownSummary`,
				['utf8Bytes', 'sha256'],
				issues,
			);
			if (summary) {
				checkNonNegativeInteger(summary.utf8Bytes, `${itemPath}/bodyMarkdownSummary/utf8Bytes`, issues);
				checkSha256(summary.sha256, `${itemPath}/bodyMarkdownSummary/sha256`, issues);
			}
		}
		if (typeof effect.itemRef === 'string') {
			if (itemRefs.has(effect.itemRef)) issues.push(issue(`${itemPath}/itemRef`, 'value', 'Create effect itemRef values must be unique.'));
			itemRefs.add(effect.itemRef);
			effectsByItemRef.set(effect.itemRef, effect);
		}
		if (typeof effect.operonId === 'string') {
			if (operonIds.has(effect.operonId)) issues.push(issue(`${itemPath}/operonId`, 'value', 'Allocated operonId values must be unique.'));
			operonIds.add(effect.operonId);
		}
		if (typeof effect.operonId === 'string' && isPlainRecord(effect.locator)) {
			effectTargetKeys.add(`${effect.operonId}\0${JSON.stringify(effect.locator)}`);
		}
	}
	if (isPlainRecord(specValue) && Array.isArray(specValue.items)) {
		const specItems = (specValue.items as unknown[]).filter(isPlainRecord);
		const specRefs = specItems
			.filter(isPlainRecord)
			.map(item => item.itemRef)
			.filter((item): item is string => typeof item === 'string');
		if (
			specRefs.length !== itemRefs.size
			|| specRefs.some(itemRef => !itemRefs.has(itemRef))
		) {
			issues.push(issue(path, 'value', 'Create effects must cover every create item exactly once.'));
		}
		const allocatedByItemRef = new Map<string, string>();
		for (const [itemRef, effect] of effectsByItemRef) {
			if (typeof effect.operonId === 'string') allocatedByItemRef.set(itemRef, effect.operonId);
		}
		const inlineEffectCountByFile = new Map<string, number>();
		for (const effect of effectsByItemRef.values()) {
			if (
				isPlainRecord(effect.locator)
				&& effect.locator.representation === 'inline'
				&& typeof effect.locator.filePath === 'string'
			) {
				inlineEffectCountByFile.set(
					effect.locator.filePath,
					(inlineEffectCountByFile.get(effect.locator.filePath) ?? 0) + 1,
				);
			}
		}
		for (let index = 0; index < specItems.length; index++) {
			const item = specItems[index];
			if (typeof item.itemRef !== 'string') continue;
			const effect = effectsByItemRef.get(item.itemRef);
			if (!effect) continue;
			const itemPath = `${path}/${item.itemRef}`;
			if (isPlainRecord(item.target) && isPlainRecord(effect.locator)) {
				if (
					item.target.representation !== undefined
					&& item.target.representation !== effect.locator.representation
				) {
					issues.push(issue(`${itemPath}/locator`, 'value', 'Resolved locator must preserve the requested representation.'));
				}
				if (item.target.mode === 'exact-path' && item.target.filePath !== effect.locator.filePath) {
					issues.push(issue(`${itemPath}/locator/filePath`, 'value', 'Resolved locator must preserve the exact requested path.'));
				}
				if (
					item.target.representation === 'inline'
					&& typeof item.target.lineNumber === 'number'
					&& (
						typeof effect.locator.lineNumber !== 'number'
						|| effect.locator.lineNumber < item.target.lineNumber
						|| effect.locator.lineNumber >= item.target.lineNumber
							+ (inlineEffectCountByFile.get(effect.locator.filePath as string) ?? 1)
					)
				) {
					issues.push(issue(
						`${itemPath}/locator/lineNumber`,
						'value',
						'Resolved locator must remain within the exact insertion range.',
					));
				}
				const mayResolveConfiguredDefaultTemplate = item.target.mode === 'configured-default'
					&& item.target.templateId === undefined;
				if (!mayResolveConfiguredDefaultTemplate && item.target.templateId !== effect.templateId) {
					issues.push(issue(`${itemPath}/templateId`, 'value', 'Sealed template must match the requested template.'));
				}
			}
			const expectedParent = resolveCreateReferenceOperonId(item.parent, allocatedByItemRef);
			if (expectedParent !== effect.resolvedParentOperonId) {
				issues.push(issue(`${itemPath}/resolvedParentOperonId`, 'value', 'Resolved parent must match the create graph.'));
			}
			const expectedRelated = Array.isArray(item.related)
				? (item.related as unknown[])
					.map(reference => resolveCreateReferenceOperonId(reference, allocatedByItemRef))
					.filter((operonId): operonId is string => typeof operonId === 'string')
					.sort()
				: [];
			const actualRelated = Array.isArray(effect.resolvedRelatedOperonIds)
				? (effect.resolvedRelatedOperonIds as unknown[])
					.filter((operonId): operonId is string => typeof operonId === 'string')
					.sort()
				: [];
			if (
				expectedRelated.length !== actualRelated.length
				|| expectedRelated.some((operonId, relatedIndex) => operonId !== actualRelated[relatedIndex])
			) {
				issues.push(issue(`${itemPath}/resolvedRelatedOperonIds`, 'value', 'Resolved related ids must match the create graph.'));
			}
			const expectedDependencies = Array.isArray(item.dependencies)
				? (item.dependencies as unknown[])
					.filter(isPlainRecord)
					.map(dependency => ({
						relation: dependency.relation,
						operonId: resolveCreateReferenceOperonId(dependency.target, allocatedByItemRef),
					}))
					.filter((dependency): dependency is { relation: string; operonId: string } => (
						typeof dependency.relation === 'string' && typeof dependency.operonId === 'string'
					))
					.sort(compareResolvedCreateDependencies)
				: [];
			const actualDependencies = Array.isArray(effect.resolvedDependencies)
				? (effect.resolvedDependencies as unknown[])
					.filter(isPlainRecord)
					.map(dependency => ({
						relation: dependency.relation,
						operonId: dependency.operonId,
					}))
					.filter((dependency): dependency is { relation: string; operonId: string } => (
						typeof dependency.relation === 'string' && typeof dependency.operonId === 'string'
					))
					.sort(compareResolvedCreateDependencies)
				: [];
			if (
				expectedDependencies.length !== actualDependencies.length
				|| expectedDependencies.some((dependency, dependencyIndex) => (
					dependency.relation !== actualDependencies[dependencyIndex]?.relation
					|| dependency.operonId !== actualDependencies[dependencyIndex]?.operonId
				))
			) {
				issues.push(issue(`${itemPath}/resolvedDependencies`, 'value', 'Resolved dependencies must match the create graph.'));
			}
			if (typeof item.bodyMarkdown === 'string') {
				if (
					!isPlainRecord(effect.bodyMarkdownSummary)
					|| effect.bodyMarkdownSummary.utf8Bytes !== utf8ByteLengthV1(item.bodyMarkdown)
					|| effect.bodyMarkdownSummary.sha256 !== sha256HexV1(item.bodyMarkdown)
				) {
					issues.push(issue(
						`${itemPath}/bodyMarkdownSummary`,
						'value',
						'Sealed bodyMarkdown summary must match the requested File Task body.',
					));
				}
			} else if (effect.bodyMarkdownSummary !== undefined) {
				issues.push(issue(
					`${itemPath}/bodyMarkdownSummary`,
					'value',
					'Create effect cannot seal bodyMarkdown when the request omitted it.',
				));
			}
		}
	}
	if (Array.isArray(targetsValue)) {
		const targetKeys = targetsValue
			.filter(isPlainRecord)
			.filter(target => typeof target.operonId === 'string' && isPlainRecord(target.locator))
			.map(target => `${String(target.operonId)}\0${JSON.stringify(target.locator)}`);
		if (
			targetKeys.length !== effectTargetKeys.size
			|| targetKeys.some(targetKey => !effectTargetKeys.has(targetKey))
		) {
			issues.push(issue(path, 'value', 'Create effects must bind every allocated plan target exactly once.'));
		}
	}
}

function checkResolvedCreateDependencies(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.createRelationsPerItem) {
		issues.push(issue(path, 'value', 'Resolved create dependency count exceeds the V1 cap.'));
	}
	const identities = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const dependency = inspectObject(value[index], itemPath, ['relation', 'operonId'], issues);
		if (!dependency) continue;
		checkEnum(dependency.relation, ['blocks', 'blocked-by'], `${itemPath}/relation`, issues);
		checkCanonicalOperonId(dependency.operonId, `${itemPath}/operonId`, issues);
		const identity = `${String(dependency.relation)}:${String(dependency.operonId)}`;
		if (identities.has(identity)) {
			issues.push(issue(itemPath, 'value', 'Resolved create dependencies must be unique.'));
		}
		identities.add(identity);
	}
}

function compareResolvedCreateDependencies(
	left: { relation: string; operonId: string },
	right: { relation: string; operonId: string },
): number {
	return left.relation.localeCompare(right.relation) || left.operonId.localeCompare(right.operonId);
}

function checkUpdateBatchEffects(
	value: unknown,
	path: string,
	specValue: unknown,
	targetsValue: unknown,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'required', 'update-batch plan requires exact updateBatchEffects.'));
		return;
	}
	const specItems = isPlainRecord(specValue) && Array.isArray(specValue.items)
		? specValue.items
		: [];
	const specItemsByRef = new Map(specItems.flatMap(item => (
		isPlainRecord(item) && typeof item.itemRef === 'string'
			? [[item.itemRef, item] as const]
			: []
	)));
	if (value.length !== specItems.length) {
		issues.push(issue(path, 'length', 'Batch effects must correspond one-to-one with spec items.'));
	}
	const targetKeys = new Set<string>(
		Array.isArray(targetsValue)
			? targetsValue.flatMap(target => (
				isPlainRecord(target)
				&& typeof target.operonId === 'string'
				&& isPlainRecord(target.locator)
					? [`${target.operonId}\0${String(target.locator.filePath)}\0${String(target.locator.lineNumber)}`]
					: []
			))
			: [],
	);
	const targetDigestsByKey = new Map<string, string>(
		Array.isArray(targetsValue)
			? targetsValue.flatMap(target => (
				isPlainRecord(target)
				&& typeof target.operonId === 'string'
				&& isPlainRecord(target.locator)
				&& typeof target.targetDigest === 'string'
					? [[
						`${target.operonId}\0${String(target.locator.filePath)}\0${String(target.locator.lineNumber)}`,
						target.targetDigest,
					] as const]
					: []
			))
			: [],
	);
	const refs = new Set<string>();
	const plannedDigests = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const effect = inspectObject(value[index], itemPath, [
			'itemRef', 'operonId', 'locator', 'beforeDigest', 'requestedCanonicalFields',
			'action', 'directChange', 'plannedSourceDigest',
		], issues);
		if (!effect) continue;
		checkRequestId(effect.itemRef, `${itemPath}/itemRef`, issues);
		checkCanonicalOperonId(effect.operonId, `${itemPath}/operonId`, issues);
		checkLocator(effect.locator, `${itemPath}/locator`, issues);
		if (isPlainRecord(effect.locator) && effect.locator.representation !== 'inline') {
			issues.push(issue(`${itemPath}/locator`, 'value', 'Batch update effects require inline locators.'));
		}
		checkSha256(effect.beforeDigest, `${itemPath}/beforeDigest`, issues);
		checkStringArray(effect.requestedCanonicalFields, `${itemPath}/requestedCanonicalFields`, issues);
		checkUniqueStrings(effect.requestedCanonicalFields, `${itemPath}/requestedCanonicalFields`, issues);
		if (Array.isArray(effect.requestedCanonicalFields) && effect.requestedCanonicalFields.length === 0) {
			issues.push(issue(`${itemPath}/requestedCanonicalFields`, 'length', 'Batch effect requires requested fields.'));
		}
		checkEnum(effect.action, ['update', 'no-change'], `${itemPath}/action`, issues);
		checkBoolean(effect.directChange, `${itemPath}/directChange`, issues);
		if (effect.directChange === true && effect.action !== 'update') {
			issues.push(issue(
				`${itemPath}/directChange`,
				'value',
				'A direct batch change must have update action.',
			));
		}
		checkSha256(effect.plannedSourceDigest, `${itemPath}/plannedSourceDigest`, issues);
		if (typeof effect.itemRef === 'string') {
			if (refs.has(effect.itemRef)) issues.push(issue(`${itemPath}/itemRef`, 'value', 'Batch effect itemRef values must be unique.'));
			refs.add(effect.itemRef);
		}
		if (typeof effect.plannedSourceDigest === 'string') plannedDigests.add(effect.plannedSourceDigest);
		if (
			typeof effect.operonId === 'string'
			&& isPlainRecord(effect.locator)
		) {
			const targetKey = `${effect.operonId}\0${String(effect.locator.filePath)}\0${String(effect.locator.lineNumber)}`;
			if (!targetKeys.has(targetKey)) {
				issues.push(issue(itemPath, 'value', 'Batch effect must bind one exact sealed plan target.'));
			}
			if (typeof effect.beforeDigest === 'string' && targetDigestsByKey.get(targetKey) !== effect.beforeDigest) {
				issues.push(issue(`${itemPath}/beforeDigest`, 'value', 'Batch effect beforeDigest must match its plan target.'));
			}
		}
		if (typeof effect.itemRef === 'string') {
			const specItem = specItemsByRef.get(effect.itemRef);
			if (!specItem) {
				issues.push(issue(`${itemPath}/itemRef`, 'value', 'Batch effect itemRef must resolve to one spec item.'));
			} else {
				const requestedFields = Array.isArray(specItem.changes)
					? specItem.changes.flatMap(change => (
						isPlainRecord(change) && typeof change.field === 'string' ? [change.field] : []
					))
					: [];
				if (
					Array.isArray(effect.requestedCanonicalFields)
					&& JSON.stringify(effect.requestedCanonicalFields) !== JSON.stringify(requestedFields)
				) {
					issues.push(issue(
						`${itemPath}/requestedCanonicalFields`,
						'value',
						'Batch effect requested fields must match its spec item in order.',
					));
				}
			}
		}
	}
	if (plannedDigests.size > 1) {
		issues.push(issue(path, 'value', 'All batch effects must bind the same planned source digest.'));
	}
}

function checkConversionEffect(
	value: unknown,
	path: string,
	specValue: unknown,
	targetsValue: unknown,
	issues: DecodeIssueV1[],
): void {
	const effect = inspectObject(value, path, [
		'direction', 'operonId', 'beforeLocator', 'afterLocator', 'plannedTargetDigest',
		'plannedSourceDigest', 'settingsFingerprint',
		'templateId', 'templateRevision', 'resolvedFieldDiff',
		'checkboxCarryoverDigest', 'checkboxCarryoverCount',
		'lossManifest', 'lossManifestDigest', 'parentOperonId', 'repeatSeriesId',
	], issues);
	if (!effect) return;
	checkEnum(effect.direction, ['inline-to-file', 'file-to-inline'], `${path}/direction`, issues);
	checkCanonicalOperonId(effect.operonId, `${path}/operonId`, issues);
	checkLocator(effect.beforeLocator, `${path}/beforeLocator`, issues);
	checkLocator(effect.afterLocator, `${path}/afterLocator`, issues);
	checkSha256(effect.plannedTargetDigest, `${path}/plannedTargetDigest`, issues);
	checkSha256(effect.plannedSourceDigest, `${path}/plannedSourceDigest`, issues);
	checkSha256(effect.settingsFingerprint, `${path}/settingsFingerprint`, issues);
	if ((effect.templateId === undefined) !== (effect.templateRevision === undefined)) {
		issues.push(issue(path, 'value', 'Template id and revision must be sealed together.'));
	}
	if (effect.templateId !== undefined) {
		checkBoundedNonEmptyString(effect.templateId, `${path}/templateId`, 256, issues);
		checkSha256(effect.templateRevision, `${path}/templateRevision`, issues);
	}
	checkConversionFieldDiff(effect.resolvedFieldDiff, `${path}/resolvedFieldDiff`, issues);
	if ((effect.checkboxCarryoverDigest === undefined) !== (effect.checkboxCarryoverCount === undefined)) {
		issues.push(issue(path, 'value', 'Checkbox carryover digest and count must be sealed together.'));
	}
	if (effect.checkboxCarryoverDigest !== undefined) {
		checkSha256(effect.checkboxCarryoverDigest, `${path}/checkboxCarryoverDigest`, issues);
		checkNonNegativeInteger(effect.checkboxCarryoverCount, `${path}/checkboxCarryoverCount`, issues);
	}
	checkConversionLossManifest(effect.lossManifest, `${path}/lossManifest`, issues);
	checkSha256(effect.lossManifestDigest, `${path}/lossManifestDigest`, issues);
	if (
		Array.isArray(effect.lossManifest)
		&& typeof effect.lossManifestDigest === 'string'
		&& effect.lossManifestDigest !== sha256HexV1(
			canonicalJsonV1(toJsonValueV1(effect.lossManifest)),
		)
	) {
		issues.push(issue(
			`${path}/lossManifestDigest`,
			'value',
			'Conversion loss digest must bind the canonical loss manifest.',
		));
	}
	if (effect.parentOperonId !== undefined) {
		checkCanonicalOperonId(effect.parentOperonId, `${path}/parentOperonId`, issues);
	}
	if (effect.repeatSeriesId !== undefined) {
		checkBoundedNonEmptyString(effect.repeatSeriesId, `${path}/repeatSeriesId`, 256, issues);
	}

	if (isPlainRecord(specValue)) {
		const expectedDirection = specValue.from === 'inline' && specValue.to === 'file'
			? 'inline-to-file'
			: specValue.from === 'file' && specValue.to === 'inline'
				? 'file-to-inline'
				: undefined;
		if (effect.direction !== expectedDirection) {
			issues.push(issue(`${path}/direction`, 'value', 'Conversion effect direction must match the conversion spec.'));
		}
		if (expectedDirection === 'inline-to-file' && effect.templateId !== specValue.templateId) {
			issues.push(issue(`${path}/templateId`, 'value', 'Conversion effect template must match the requested template.'));
		}
		if (
			expectedDirection === 'file-to-inline'
			&& (effect.templateId !== undefined || effect.templateRevision !== undefined)
		) {
			issues.push(issue(path, 'value', 'File-to-inline conversion effects cannot carry template metadata.'));
		}
	}
	if (isPlainRecord(effect.beforeLocator) && isPlainRecord(effect.afterLocator)) {
		const beforeRepresentation = effect.beforeLocator.representation;
		const afterRepresentation = effect.afterLocator.representation;
		if (
			(effect.direction === 'inline-to-file' && (beforeRepresentation !== 'inline' || afterRepresentation !== 'file'))
			|| (effect.direction === 'file-to-inline' && (beforeRepresentation !== 'file' || afterRepresentation !== 'inline'))
		) {
			issues.push(issue(path, 'value', 'Conversion effect locators must match the sealed direction.'));
		}
	}
	if (Array.isArray(targetsValue)) {
		const exactTargets = targetsValue.filter(isPlainRecord);
		if (
			exactTargets.length !== 1
			|| exactTargets[0].operonId !== effect.operonId
			|| JSON.stringify(exactTargets[0].locator) !== JSON.stringify(effect.beforeLocator)
		) {
			issues.push(issue(path, 'value', 'Conversion effect must bind the exact source target.'));
		}
	}
}

function checkConversionFieldDiff(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected a conversion field diff array.'));
		return;
	}
	if (value.length > 128) {
		issues.push(issue(path, 'value', 'Conversion field diff exceeds the V1 cap.'));
	}
	const fields = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['field', 'source', 'before', 'after'], issues);
		if (!item) continue;
		checkBoundedNonEmptyString(item.field, `${itemPath}/field`, 256, issues);
		checkEnum(item.source, ['default', 'inheritance'], `${itemPath}/source`, issues);
		if (item.before !== undefined) checkGeneralUpdateValue(item.before, `${itemPath}/before`, issues);
		checkGeneralUpdateValue(item.after, `${itemPath}/after`, issues);
		if (typeof item.field === 'string') {
			if (fields.has(item.field)) issues.push(issue(`${itemPath}/field`, 'value', 'Conversion field diff keys must be unique.'));
			fields.add(item.field);
		}
	}
}

function checkGeneralUpdateValue(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (
		typeof value === 'string'
		|| typeof value === 'number'
		|| typeof value === 'boolean'
	) return;
	if (
		Array.isArray(value)
		&& value.length <= 512
		&& value.every(item => typeof item === 'string')
	) return;
	issues.push(issue(path, 'type', 'Expected a scalar or string-list conversion field value.'));
}

function checkConversionLossManifest(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected a conversion loss manifest array.'));
		return;
	}
	if (value.length > 256) {
		issues.push(issue(path, 'value', 'Conversion loss manifest exceeds the V1 cap.'));
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['kind', 'key', 'digest'], issues);
		if (!item) continue;
		checkEnum(item.kind, [
			'body-content', 'html-comments', 'unmanaged-frontmatter',
			'reserved-frontmatter', 'inline-time-prefix',
		], `${itemPath}/kind`, issues);
		if (item.key !== undefined) checkBoundedNonEmptyString(item.key, `${itemPath}/key`, 256, issues);
		checkSha256(item.digest, `${itemPath}/digest`, issues);
	}
}

function resolveCreateReferenceOperonId(
	value: unknown,
	allocatedByItemRef: ReadonlyMap<string, string>,
): string | undefined {
	if (!isPlainRecord(value)) return undefined;
	if (value.kind === 'existing' && typeof value.operonId === 'string') return value.operonId;
	if (value.kind === 'created' && typeof value.itemRef === 'string') return allocatedByItemRef.get(value.itemRef);
	return undefined;
}

function checkTargets(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		issues.push(issue(path, Array.isArray(value) ? 'value' : 'type', 'Expected a non-empty array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.planTargets) {
		issues.push(issue(path, 'value', 'Plan target count exceeds the V1 cap.'));
	}
	const targetDigests = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const target = inspectObject(value[index], itemPath, ['operonId', 'locator', 'targetDigest'], issues);
		if (!target) continue;
		if (
			target.operonId !== undefined
			&& (typeof target.operonId !== 'string' || !OPERON_ID_PATTERN_V1.test(target.operonId))
		) {
			issues.push(issue(`${itemPath}/operonId`, 'value', 'Expected a canonical operonId.'));
		}
		if (target.locator !== undefined) checkLocator(target.locator, `${itemPath}/locator`, issues);
		checkSha256(target.targetDigest, `${itemPath}/targetDigest`, issues);
		if (typeof target.targetDigest === 'string') {
			if (targetDigests.has(target.targetDigest)) issues.push(issue(`${itemPath}/targetDigest`, 'value', 'Target digests must be unique.'));
			targetDigests.add(target.targetDigest);
		}
	}
}

function checkAcknowledgements(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.acknowledgements) {
		issues.push(issue(path, 'value', 'Acknowledgement count exceeds the V1 cap.'));
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['code', 'planHash', 'targetDigest', 'acknowledgedAt'], issues);
		if (!item) continue;
		checkNonEmptyString(item.code, `${itemPath}/code`, issues);
		checkSha256(item.planHash, `${itemPath}/planHash`, issues);
		checkSha256(item.targetDigest, `${itemPath}/targetDigest`, issues);
		checkNonEmptyString(item.acknowledgedAt, `${itemPath}/acknowledgedAt`, issues);
	}
}

function checkGroupResults(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.atomicGroups) {
		issues.push(issue(path, 'value', 'Group result count exceeds the V1 cap.'));
	}
	const groupIds = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['groupId', 'status', 'resourceRevisions', 'error'], issues);
		if (!item) continue;
		checkNonEmptyString(item.groupId, `${itemPath}/groupId`, issues);
		if (typeof item.groupId === 'string') {
			if (groupIds.has(item.groupId)) {
				issues.push(issue(`${itemPath}/groupId`, 'value', 'Group result ids must be unique.'));
			}
			groupIds.add(item.groupId);
		}
		checkEnum(item.status, ['committed', 'failed', 'outcome-unknown'], `${itemPath}/status`, issues);
		if (item.resourceRevisions !== undefined) checkAffectedResources(item.resourceRevisions, `${itemPath}/resourceRevisions`, issues);
		if (item.error !== undefined) checkStructuredError(item.error, `${itemPath}/error`, issues);
		if (item.status === 'committed' && item.error !== undefined) {
			issues.push(issue(`${itemPath}/error`, 'value', 'Committed group cannot contain an error.'));
		}
		if ((item.status === 'failed' || item.status === 'outcome-unknown') && item.error === undefined) {
			issues.push(issue(`${itemPath}/error`, 'required', 'Non-committed group requires a structured error.'));
		}
		if (item.status !== 'committed' && item.resourceRevisions !== undefined) {
			issues.push(issue(`${itemPath}/resourceRevisions`, 'value', 'Only committed groups publish new resource revisions.'));
		}
	}
}

function checkReceipt(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, [
		'contractVersion', 'vaultIdentityHash', 'clientInstanceId', 'idempotencyKeyHash',
		'planHash', 'mutationKind', 'targetDigest', 'terminalOutcome', 'effectiveAt',
		'completedAt', 'expiresAt',
	], issues);
	if (!object) return;
	checkContractVersion(object, issues, path);
	checkSha256(object.vaultIdentityHash, `${path}/vaultIdentityHash`, issues);
	checkBoundedNonEmptyString(object.clientInstanceId, `${path}/clientInstanceId`, 128, issues);
	checkSha256(object.idempotencyKeyHash, `${path}/idempotencyKeyHash`, issues);
	checkSha256(object.planHash, `${path}/planHash`, issues);
	if (typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind)) {
		issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown mutation kind.'));
	}
	checkSha256(object.targetDigest, `${path}/targetDigest`, issues);
	checkEnum(object.terminalOutcome, ['applied', 'already-applied', 'outcome-unknown'], `${path}/terminalOutcome`, issues);
	checkTimestamp(object.effectiveAt, `${path}/effectiveAt`, issues);
	checkTimestamp(object.completedAt, `${path}/completedAt`, issues);
	checkTimestamp(object.expiresAt, `${path}/expiresAt`, issues);
	const effectiveAt = parseTimestamp(object.effectiveAt);
	const completedAt = parseTimestamp(object.completedAt);
	const expiresAt = parseTimestamp(object.expiresAt);
	if (effectiveAt !== null && completedAt !== null && completedAt < effectiveAt) {
		issues.push(issue(`${path}/completedAt`, 'value', 'Receipt completion cannot precede effectiveAt.'));
	}
	if (completedAt !== null && expiresAt !== null && (expiresAt <= completedAt || expiresAt - completedAt > 86_400_000)) {
		issues.push(issue(`${path}/expiresAt`, 'value', 'Receipt expiry must be within 24 hours after completion.'));
	}
}

function checkStructuredError(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectResponseObject(value, path, [
		'contractVersion', 'code', 'reason', 'retryable', 'action', 'details',
	], issues);
	if (!object) return;
	checkContractVersion(object, issues, path);
	if (
		typeof object.code !== 'string'
		|| !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(object.code)
	) issues.push(issue(`${path}/code`, 'value', 'Invalid structured error code.'));
	checkBoundedNonEmptyString(object.reason, `${path}/reason`, CONTRACT_LIMITS_V1.reasonBytes, issues);
	checkBoolean(object.retryable, `${path}/retryable`, issues);
	checkEnum(object.action, ERROR_ACTIONS_V1, `${path}/action`, issues);
	if (
		typeof object.code === 'string'
		&& STRUCTURED_ERROR_CODES_V1.includes(
			object.code as typeof STRUCTURED_ERROR_CODES_V1[number],
		)
	) {
		const policy = errorPolicyForCodeV1(object.code);
		if (object.retryable !== policy.retryable || object.action !== policy.action) {
			issues.push(issue(
				path || '/',
				'value',
				'Known structured errors must match the published error registry action and retry policy.',
			));
		}
	}
	if (
		typeof object.code === 'string'
		&& !STRUCTURED_ERROR_CODES_V1.includes(
			object.code as typeof STRUCTURED_ERROR_CODES_V1[number],
		)
		&& (object.retryable !== false || object.action !== 'do-not-retry')
	) {
		issues.push(issue(
			path || '/',
			'value',
			'Unknown structured errors must use the non-retryable do-not-retry fallback.',
		));
	}
	if (object.details !== undefined) {
		if (isPlainRecord(object.details) && Object.keys(object.details).length > CONTRACT_LIMITS_V1.errorDetailKeys) {
			issues.push(issue(`${path}/details`, 'value', 'Structured error details exceed the V1 object-key cap.'));
		}
		checkJsonValue(object.details, `${path}/details`, issues);
	}
}

function checkCliInvocationRequest(
	command: CliCommandV1,
	value: unknown,
	issues: DecodeIssueV1[],
): void {
	const expectedKind = cliRequestKindForCommandV1(command);
	if (expectedKind === undefined) {
		if (value !== undefined) {
			issues.push(issue('/request', 'value', `${command} does not accept a Runtime request payload.`));
		}
		return;
	}
	if (value === undefined) {
		issues.push(issue('/request', 'required', `${command} requires a Runtime request payload.`));
		return;
	}
	let decoded: DecodeResultV1<unknown>;
	switch (command) {
		case 'catalog':
			decoded = decodeCatalogRequestV1(value);
			break;
		case 'entity.resolve':
			decoded = decodeEntityResolveRequestV1(value);
			break;
		case 'task.get':
			decoded = decodeTaskGetRequestV1(value);
			break;
		case 'tasks.query':
			decoded = decodeTaskQueryRequestV1(value);
			break;
		case 'tasks.filter-query':
			decoded = decodeTaskFilterQueryRequestV1(value);
			break;
		case 'tasks.finder':
			decoded = decodeTaskFinderRequestV1(value);
			break;
		case 'relationships.get':
			decoded = decodeRelationshipRequestV1(value);
			break;
		case 'context.build':
			decoded = decodeContextRequestV1(value);
			break;
		case 'timers.read':
			decoded = decodeTimerReadRequestV1(value);
			break;
		case 'mutation.preview':
			decoded = decodeMutationPreviewRequestV1(value);
			break;
		case 'mutation.apply':
			decoded = decodeMutationApplyRequestV1(value);
			break;
		case 'health':
		case 'capabilities':
		case 'diagnostics':
			return;
	}
	appendDecodeIssues(issues, decoded, '/request');
	if (isPlainRecord(value) && value.kind !== expectedKind) {
		issues.push(issue('/request/kind', 'value', 'Runtime request kind does not match the CLI command.'));
	}
}

function checkCliCommandResult(
	command: CliCommandV1,
	value: unknown,
	issues: DecodeIssueV1[],
): void {
	let decoded: DecodeResultV1<unknown> | null = null;
	switch (command) {
		case 'health':
			decoded = decodeRuntimeHealthV1(value);
			break;
			case 'capabilities':
				checkCapabilityAdvertisements(value, '/result', issues);
				return;
			case 'diagnostics':
				checkRuntimeDiagnostics(value, '/result', issues);
				return;
		case 'catalog':
			decoded = decodeOperonCatalogV1(value);
			break;
		case 'entity.resolve':
			decoded = decodeEntityResolutionResultV1(value);
			break;
		case 'task.get':
			decoded = decodeTaskGetResultV1(value);
			break;
		case 'tasks.query':
			decoded = decodeTaskQueryResultV1(value);
			break;
		case 'tasks.filter-query':
			decoded = decodeTaskFilterQueryResultV1(value);
			break;
		case 'tasks.finder':
			decoded = decodeTaskFinderResultV1(value);
			break;
		case 'relationships.get':
			decoded = decodeRelationshipResultV1(value);
			break;
		case 'context.build':
			decoded = decodeContextPackV1(value);
			break;
		case 'timers.read':
			decoded = decodeTimerReadResultV1(value);
			break;
		case 'mutation.preview':
			decoded = decodeMutationPreviewResultV1(value);
			break;
		case 'mutation.apply':
			decoded = decodeMutationResultV1(value);
			break;
	}
	appendDecodeIssues(issues, decoded, '/result');
}

function checkRuntimeDiagnostics(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const object = inspectResponseObject(value, path, [
		'contractVersion',
		'kind',
		'health',
		'capabilities',
		'catalog',
		'transport',
		'warnings',
	], issues);
	if (!object) return;
	checkContractVersion(object, issues, path);
	checkLiteral(object.kind, 'runtime-diagnostics', `${path}/kind`, issues);
	appendDecodeIssues(issues, decodeRuntimeHealthV1(object.health), `${path}/health`);
	checkCapabilityAdvertisements(object.capabilities, `${path}/capabilities`, issues);
	if (object.catalog !== undefined) {
		const catalog = inspectResponseObject(object.catalog, `${path}/catalog`, [
			'catalogRevision',
			'settingsFingerprint',
			'fieldCount',
			'pipelineCount',
			'priorityCount',
		], issues);
		if (catalog) {
			checkSha256(catalog.catalogRevision, `${path}/catalog/catalogRevision`, issues);
			checkSha256(catalog.settingsFingerprint, `${path}/catalog/settingsFingerprint`, issues);
			checkNonNegativeInteger(catalog.fieldCount, `${path}/catalog/fieldCount`, issues);
			checkNonNegativeInteger(catalog.pipelineCount, `${path}/catalog/pipelineCount`, issues);
			checkNonNegativeInteger(catalog.priorityCount, `${path}/catalog/priorityCount`, issues);
		}
	}
	if (object.transport !== undefined) {
		const transport = inspectResponseObject(object.transport, `${path}/transport`, [
			'endpointKind',
			'securityBackend',
			'persistentTransportAvailable',
			'failureReason',
			'channel',
			'available',
		], issues);
		if (transport) {
			if (transport.channel !== undefined) {
				checkLiteral(transport.channel, 'native-cli', `${path}/transport/channel`, issues);
			}
			if (transport.available !== undefined) {
				checkBoolean(transport.available, `${path}/transport/available`, issues);
			}
			if (transport.endpointKind !== undefined) {
				checkEnum(
					transport.endpointKind,
					['unix-domain-socket', 'windows-named-pipe'],
					`${path}/transport/endpointKind`,
					issues,
				);
			}
			if (transport.securityBackend !== undefined) {
				checkEnum(
					transport.securityBackend,
					['posix-mode', 'windows-dacl'],
					`${path}/transport/securityBackend`,
					issues,
				);
			}
			if (transport.persistentTransportAvailable !== undefined) {
				checkBoolean(
					transport.persistentTransportAvailable,
					`${path}/transport/persistentTransportAvailable`,
					issues,
				);
			}
			if (transport.failureReason !== undefined) {
				checkBoundedString(
					transport.failureReason,
					`${path}/transport/failureReason`,
					512,
					issues,
				);
				if (transport.failureReason === '') {
					issues.push(issue(
						`${path}/transport/failureReason`,
						'value',
						'Transport failure reason must not be empty.',
					));
				}
			}
		}
	}
	checkWarnings(object.warnings, `${path}/warnings`, issues);
}

function checkCliTransportSummary(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['channel', 'inputBytes'], issues);
	if (!object) return;
	checkLiteral(object.channel, 'request-file', `${path}/channel`, issues);
	checkNonNegativeInteger(object.inputBytes, `${path}/inputBytes`, issues);
	if (
		typeof object.inputBytes === 'number'
		&& object.inputBytes > CONTRACT_LIMITS_V1.transportInputBytes
	) {
		issues.push(issue(`${path}/inputBytes`, 'value', 'CLI transport input exceeds the V1 byte cap.'));
	}
}

function checkCliVaultIdentity(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['expectedMatch'], issues);
	if (!object) return;
	if (object.expectedMatch !== null) checkBoolean(object.expectedMatch, `${path}/expectedMatch`, issues);
}

function checkCliRuntimeMetadata(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['appVersion', 'plugin', 'apiVersion'], issues);
	if (!object) return;
	checkBoundedNonEmptyString(object.appVersion, `${path}/appVersion`, 256, issues);
	checkLiteral(object.apiVersion, RUNTIME_API_VERSION_V1, `${path}/apiVersion`, issues);
	const plugin = inspectObject(object.plugin, `${path}/plugin`, ['id', 'version', 'minAppVersion'], issues);
	if (!plugin) return;
	checkLiteral(plugin.id, 'operon', `${path}/plugin/id`, issues);
	checkBoundedNonEmptyString(plugin.version, `${path}/plugin/version`, 256, issues);
	checkBoundedNonEmptyString(plugin.minAppVersion, `${path}/plugin/minAppVersion`, 256, issues);
}

function checkCliTiming(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['handlerMs', 'totalMs'], issues);
	if (!object) return;
	checkNonNegativeFiniteNumber(object.handlerMs, `${path}/handlerMs`, issues);
	if (object.totalMs !== undefined) {
		checkNonNegativeFiniteNumber(object.totalMs, `${path}/totalMs`, issues);
	}
}

function checkCliFailure(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['stage', 'error'], issues);
	if (!object) return;
	checkEnum(object.stage, CLI_FAILURE_STAGES_V1, `${path}/stage`, issues);
	checkStructuredError(object.error, `${path}/error`, issues);
}

function checkNonNegativeFiniteNumber(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		issues.push(issue(path, 'type', 'Expected a non-negative finite number.'));
	}
}

function appendDecodeIssues(
	issues: DecodeIssueV1[],
	decoded: DecodeResultV1<unknown>,
	path: string,
): void {
	if (decoded.ok) return;
	decoded.issues.forEach(item => issues.push({
		...item,
		path: `${path}${item.path === '/' ? '' : item.path}`,
	}));
}

function checkWarnings(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.warnings) {
		issues.push(issue(path, 'value', 'Warning count exceeds the V1 cap.'));
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = inspectObject(value[index], itemPath, ['code', 'message', 'path'], issues);
		if (!item) continue;
		checkPatternString(item.code, `${itemPath}/code`, WARNING_CODE_PATTERN_V1, 128, 'warning code', issues);
		checkNonEmptyString(item.message, `${itemPath}/message`, issues);
		checkCharacterCap(item.message, `${itemPath}/message`, 4_096, issues);
		if (item.path !== undefined) checkNonEmptyString(item.path, `${itemPath}/path`, issues);
		if (item.path !== undefined) checkCharacterCap(item.path, `${itemPath}/path`, 4_096, issues);
	}
}

function checkJsonValue(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) issues.push(issue(path, 'value', 'JSON numbers must be finite.'));
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
			issues.push(issue(path, 'value', 'Array exceeds the V1 item cap.'));
		}
		value.forEach((item, index) => checkJsonValue(item, `${path}/${index}`, issues));
		return;
	}
	if (!isPlainRecord(value)) {
		issues.push(issue(path, 'prototype', 'Expected a JSON-safe plain object.'));
		return;
	}
	if (Object.keys(value).length > CONTRACT_LIMITS_V1.jsonObjectKeys) {
		issues.push(issue(path, 'value', 'JSON object exceeds the V1 key cap.'));
	}
	for (const [key, item] of Object.entries(value)) {
		if (isForbiddenKey(key)) issues.push(issue(`${path}/${key}`, 'prototype', 'Prototype keys are forbidden.'));
		else checkJsonValue(item, `${path}/${escapePointer(key)}`, issues);
	}
}

function checkRange(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = inspectObject(value, path, ['min', 'max'], issues);
	if (!object) return;
	checkPositiveInteger(object.min, `${path}/min`, issues);
	checkPositiveInteger(object.max, `${path}/max`, issues);
	if (typeof object.min === 'number' && typeof object.max === 'number' && object.min > object.max) {
		issues.push(issue(path, 'value', 'Compatibility min cannot exceed max.'));
	}
}

function checkTypedUpdateValue(
	value: unknown,
	valueType: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	switch (valueType) {
		case 'text':
			if (typeof value !== 'string') issues.push(issue(path, 'type', 'Text update value must be a string.'));
			break;
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(issue(path, 'type', 'Number update value must be finite.'));
			break;
		case 'date':
			if (typeof value !== 'string' || !isValidCalendarDate(value)) {
				issues.push(issue(path, 'value', 'Date update value must use YYYY-MM-DD.'));
			}
			break;
		case 'datetime':
			if (typeof value !== 'string' || !isValidLocalDateTime(value)) {
				issues.push(issue(path, 'value', 'Datetime update value must be a local ISO datetime.'));
			}
			break;
		case 'list':
			if (!Array.isArray(value) || (value as unknown[]).some(item => typeof item !== 'string')) {
				issues.push(issue(path, 'type', 'List update value must be an array of strings.'));
			} else if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
				issues.push(issue(path, 'value', 'List update value exceeds the V1 item cap.'));
			}
			break;
		case 'checkbox':
			if (typeof value !== 'boolean') issues.push(issue(path, 'type', 'Checkbox update value must be boolean.'));
			break;
	}
}

function isValidCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidLocalDateTime(value: string): boolean {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
	if (!match || !isValidCalendarDate(match[1])) return false;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = match[4] === undefined ? 0 : Number(match[4]);
	return hour <= 23 && minute <= 59 && second <= 59;
}

function checkVaultRelativePath(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') return;
	const error = validateVaultRelativePathV1(value);
	if (error) issues.push(issue(path, 'value', error.reason));
}

function checkTimestamp(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (parseTimestamp(value) === null) {
		issues.push(issue(path, 'value', 'Expected an RFC 3339 UTC timestamp.'));
	}
}

function checkUniqueStrings(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) return;
	const strings = (value as unknown[]).filter((item): item is string => typeof item === 'string');
	if (new Set(strings).size !== strings.length) {
		issues.push(issue(path, 'value', 'Array values must be unique.'));
	}
}

function checkContractVersion(object: Record<string, unknown>, issues: DecodeIssueV1[], path: string = ''): void {
	checkLiteral(object.contractVersion, CONTRACT_VERSION_V1, `${path}/contractVersion`, issues);
}

function inspectObject(
	value: unknown,
	path: string,
	allowed: readonly string[],
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	if (!isPlainRecord(value)) {
		issues.push(issue(path || '/', 'type', 'Expected a plain object.'));
		return null;
	}
	checkObjectFields(value, path, allowed, issues);
	return value;
}

function inspectResponseObject(
	value: unknown,
	path: string,
	_known: readonly string[],
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	if (!isPlainRecord(value)) {
		issues.push(issue(path || '/', 'type', 'Expected a plain object.'));
		return null;
	}
	for (const key of Object.keys(value)) {
		if (isForbiddenKey(key)) {
			issues.push(issue(`${path}/${key}`, 'prototype', 'Prototype keys are forbidden.'));
		}
	}
	return value;
}

function checkRecovery(
	value: unknown,
	path: string,
	envelope: Record<string, unknown>,
	issues: DecodeIssueV1[],
): void {
	const recovery = inspectObject(value, path, [
		'required', 'planRef', 'action', 'mutationMayHaveApplied',
	], issues);
	if (!recovery) return;
	checkLiteral(recovery.required, true, `${path}/required`, issues);
	checkBoundedNonEmptyString(recovery.planRef, `${path}/planRef`, 128, issues);
	checkLiteral(recovery.action, 'recover-same-plan', `${path}/action`, issues);
	checkLiteral(recovery.mutationMayHaveApplied, true, `${path}/mutationMayHaveApplied`, issues);
	if (envelope.command !== 'mutation.apply') {
		issues.push(issue(path, 'value', 'Recovery metadata is valid only for mutation.apply.'));
	}
	const client = isPlainRecord(envelope.client) ? envelope.client : null;
	if (client?.planRef !== recovery.planRef) {
		issues.push(issue(`${path}/planRef`, 'value', 'Recovery planRef must match client.planRef.'));
	}
	if (
		envelope.ok === false
		&& isPlainRecord(envelope.failure)
		&& isPlainRecord(envelope.failure.error)
		&& (
			envelope.failure.error.code !== 'outcome-unknown'
			|| envelope.failure.error.retryable !== false
			|| envelope.failure.error.action !== 'recover-same-plan'
		)
	) {
		issues.push(issue(path, 'value', 'Failed recovery envelope must be non-retryable outcome-unknown.'));
	}
	if (envelope.ok === true) {
		const result = isPlainRecord(envelope.result) ? envelope.result : null;
		if (
			!result
			|| result.mutationMayHaveApplied !== true
			|| result.status === 'applied'
			|| result.status === 'already-applied'
		) {
			issues.push(issue(
				path,
				'value',
				'Successful recovery metadata requires a non-final mutation result that may have applied.',
			));
		}
	}
}

function checkObjectFields(
	object: Record<string, unknown>,
	path: string,
	allowed: readonly string[],
	issues: DecodeIssueV1[],
): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(object)) {
		if (isForbiddenKey(key)) {
			issues.push(issue(`${path}/${key}`, 'prototype', 'Prototype keys are forbidden.'));
		} else if (!allowedSet.has(key)) {
			issues.push(issue(`${path}/${escapePointer(key)}`, 'unknown-field', `Unknown field: ${key}`));
		}
	}
}

function checkEnum(
	value: unknown,
	allowed: readonly (string | number | boolean)[],
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!allowed.includes(value as string | number | boolean)) {
		issues.push(issue(path, 'value', `Expected one of: ${allowed.join(', ')}.`));
	}
}

function checkLiteral(
	value: unknown,
	expected: string | number | boolean,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (value !== expected) issues.push(issue(path, 'value', `Expected ${String(expected)}.`));
}

function checkNonEmptyString(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
		issues.push(issue(path, 'type', 'Expected a non-empty trimmed string.'));
	} else if (utf8ByteLengthV1(value) > CONTRACT_LIMITS_V1.generalStringBytes) {
		issues.push(issue(path, 'value', 'String exceeds the V1 UTF-8 byte cap.'));
	}
}

function checkCanonicalOperonId(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !OPERON_ID_PATTERN_V1.test(value)) {
		issues.push(issue(path, 'value', 'Expected a canonical seven-character operonId.'));
	}
}

function checkOperonIdArray(
	value: unknown,
	path: string,
	minimum: number,
	maximum: number,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length < minimum || value.length > maximum) {
		issues.push(issue(path, 'length', `Expected between ${minimum} and ${maximum} exact operonIds.`));
	}
	const seen = new Set<string>();
	value.forEach((item, index) => {
		checkCanonicalOperonId(item, `${path}/${index}`, issues);
		if (typeof item !== 'string') return;
		if (seen.has(item)) issues.push(issue(`${path}/${index}`, 'value', 'Exact operonIds must be unique.'));
		seen.add(item);
	});
}

function checkCanonicalOperonIdArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTEXT_HYDRATION_CAPS_V1.relationshipIdsPerKind) {
		issues.push(issue(path, 'value', 'Relationship count exceeds the V1 cap.'));
	}
	const seen = new Set<string>();
	(value as unknown[]).forEach((item, index) => {
		checkCanonicalOperonId(item, `${path}/${index}`, issues);
		if (typeof item === 'string') {
			if (seen.has(item)) issues.push(issue(`${path}/${index}`, 'value', 'Relationship ids must be unique.'));
			seen.add(item);
		}
	});
}

function checkBoundedString(value: unknown, path: string, maximumBytes: number, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') {
		issues.push(issue(path, 'type', 'Expected a string.'));
		return;
	}
	if (utf8ByteLengthV1(value) > maximumBytes) {
		issues.push(issue(path, 'value', `String exceeds the ${maximumBytes}-byte UTF-8 cap.`));
	}
}

function checkBoundedStringArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
		issues.push(issue(path, 'value', 'Array exceeds the V1 item cap.'));
	}
	for (let index = 0; index < value.length; index++) {
		checkBoundedNonEmptyString(value[index], `${path}/${index}`, CONTRACT_LIMITS_V1.generalStringBytes, issues);
	}
}

function checkCreateScalarSafety(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') return;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) {
			issues.push(issue(path, 'value', 'Create scalar text cannot contain control characters.'));
			return;
		}
	}
}

function checkCreateBodyMarkdownSafety(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') return;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if ((code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
			issues.push(issue(path, 'value', 'Create bodyMarkdown cannot contain unsafe control characters.'));
			return;
		}
	}
}

function checkCreateSerializedListSafety(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) return;
	for (let index = 0; index < value.length; index += 1) {
		const item: unknown = value[index];
		if (typeof item !== 'string') continue;
		checkCreateScalarSafety(item, `${path}/${index}`, issues);
		if (item.includes(';')) {
			issues.push(issue(
				`${path}/${index}`,
				'value',
				'Create list items cannot contain the canonical semicolon delimiter.',
			));
		}
	}
}

function checkCreateListItemCap(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (Array.isArray(value) && value.length > 256) {
		issues.push(issue(path, 'value', 'Create list exceeds the 256-item V1 cap.'));
	}
}

function checkBoundedNonEmptyString(
	value: unknown,
	path: string,
	maxBytes: number,
	issues: DecodeIssueV1[],
): void {
	checkNonEmptyString(value, path, issues);
	if (typeof value === 'string' && utf8ByteLengthV1(value) > maxBytes) {
		issues.push(issue(path, 'value', `String exceeds the ${maxBytes}-byte UTF-8 cap.`));
	}
}

function checkBoundedNonBlankString(
	value: unknown,
	path: string,
	maxBytes: number,
	issues: DecodeIssueV1[],
): void {
	if (typeof value !== 'string' || value.trim().length === 0) {
		issues.push(issue(path, 'type', 'Expected a non-blank string.'));
		return;
	}
	if (utf8ByteLengthV1(value) > maxBytes) {
		issues.push(issue(path, 'value', `String exceeds the ${maxBytes}-byte UTF-8 cap.`));
	}
}

function checkRequestId(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	checkPatternString(
		value,
		path,
		REQUEST_ID_PATTERN_V1,
		CONTRACT_LIMITS_V1.requestIdBytes,
		'request id',
		issues,
	);
}

function checkIdempotencyKey(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN_V1.test(value)) {
		issues.push(issue(
			path,
			'value',
			'Idempotency key must contain 16-256 ASCII letters, digits, dots, underscores, colons, or hyphens.',
		));
	}
}

function checkCursor(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (
		typeof value !== 'string'
		|| value.length < 16
		|| value.length > CONTRACT_LIMITS_V1.cursorCharacters
		|| value !== value.trim()
	) {
		issues.push(issue(path, 'value', 'Cursor must be a trimmed 16-4096 character opaque string.'));
	}
}

function checkPatternString(
	value: unknown,
	path: string,
	pattern: RegExp,
	maxCharacters: number,
	label: string,
	issues: DecodeIssueV1[],
): void {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > maxCharacters
		|| !pattern.test(value)
	) {
		issues.push(issue(path, 'value', `Expected a valid ${label}.`));
	}
}

function checkStringByteCap(
	value: unknown,
	path: string,
	maxBytes: number,
	issues: DecodeIssueV1[],
): void {
	if (typeof value !== 'string') {
		issues.push(issue(path, 'type', 'Expected a string.'));
	} else if (utf8ByteLengthV1(value) > maxBytes) {
		issues.push(issue(path, 'value', `String exceeds the ${maxBytes}-byte UTF-8 cap.`));
	}
}

function checkCharacterCap(
	value: unknown,
	path: string,
	maxCharacters: number,
	issues: DecodeIssueV1[],
): void {
	if (typeof value === 'string' && [...value].length > maxCharacters) {
		issues.push(issue(path, 'value', `String exceeds the ${maxCharacters}-character cap.`));
	}
}

function checkJsonByteCap(
	value: unknown,
	path: string,
	maxBytes: number,
	issues: DecodeIssueV1[],
): void {
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined || utf8ByteLengthV1(serialized) > maxBytes) {
			issues.push(issue(path, 'value', `JSON value exceeds the ${maxBytes}-byte UTF-8 cap.`));
		}
	} catch {
		issues.push(issue(path, 'value', 'JSON value cannot be serialized.'));
	}
}

function checkSha256(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !SHA256_HEX_PATTERN_V1.test(value)) {
		issues.push(issue(path, 'value', 'Expected a lowercase SHA-256 hex digest.'));
	}
}

function checkBoolean(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'boolean') issues.push(issue(path, 'type', 'Expected a boolean.'));
}

function checkPositiveInteger(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		issues.push(issue(path, 'type', 'Expected a positive safe integer.'));
	}
}

function checkNonNegativeInteger(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		issues.push(issue(path, 'type', 'Expected a non-negative safe integer.'));
	}
}

function checkStringArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
		issues.push(issue(path, 'value', 'Array exceeds the V1 item cap.'));
	}
	value.forEach((item, index) => checkNonEmptyString(item, `${path}/${index}`, issues));
}

function checkStringEnumArray(
	value: unknown,
	allowed: readonly string[],
	path: string,
	issues: DecodeIssueV1[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue(path, 'type', 'Expected an array.'));
		return;
	}
	if (value.length > CONTRACT_LIMITS_V1.collectionItems) {
		issues.push(issue(path, 'value', 'Array exceeds the V1 item cap.'));
	}
	value.forEach((item, index) => checkEnum(item, allowed, `${path}/${index}`, issues));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: object | null = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isForbiddenKey(key: string): boolean {
	return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function finish<T>(value: unknown, issues: DecodeIssueV1[]): DecodeResultV1<T> {
	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, value: cloneJson(value) as unknown as T };
}

function cloneJson(value: unknown): JsonValue {
	if (value === null) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return value;
	if (typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map(cloneJson);
	const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = cloneJson(item);
	return output;
}

function failure(path: string, code: DecodeIssueV1['code'], message: string): DecodeResultV1<never> {
	return { ok: false, issues: [issue(path, code, message)] };
}

function issue(path: string, code: DecodeIssueV1['code'], message: string): DecodeIssueV1 {
	return { path: path || '/', code, message };
}

function escapePointer(value: string): string {
	return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
