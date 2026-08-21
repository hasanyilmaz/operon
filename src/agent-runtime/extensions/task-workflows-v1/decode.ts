import { decodeMutationPreviewRequestV1, decodeTaskContextV1, type DecodeIssueV1, type DecodeResultV1 } from '../../contracts/v1/decode';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import { CONTEXT_HYDRATION_KEYS_V1 } from '../../contracts/v1/context';
import { validateVaultRelativePathV1 } from '../../contracts/v1/identity';
import { CONTRACT_LIMITS_V1, ERROR_ACTIONS_V1, REQUEST_ID_PATTERN_V1, STRUCTURED_ERROR_CODES_V1, errorPolicyForCodeV1, utf8ByteLengthV1 } from '../../contracts/v1/primitives';
import type {
	AdoptTaskPreviewIntentV1,
	AdoptTaskSpecV1,
	IdentityPlaceholderFileTargetV1,
	PeriodicNoteCreateTargetV1,
	PeriodicNoteCreateSpecV1,
	PeriodicNoteUpdateSpecV1,
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskWorkflowApplyRequestV1,
	TaskWorkflowCliInvocationV1,
	TaskWorkflowCliResultEnvelopeV1,
	TaskWorkflowMutationResultV1,
	TaskWorkflowPreviewRequestV1,
	TaskWorkflowPreviewResultV1,
	TaskWorkflowSealedPlanV1,
} from './contracts';

const OPERON_ID = /^[a-z0-9]{7}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function decodeTaskFilterQueryRequestExtensionV1(
	value: unknown,
): DecodeResultV1<TaskFilterQueryRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'consistency', 'filterSetId',
		'scope', 'include', 'limit', 'cursor',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'task-filter-query', '/kind', issues);
		oneOf(object.consistency, ['live-verified', 'best-effort', 'offline-unverified'], '/consistency', issues);
		boundedString(object.filterSetId, '/filterSetId', 1, 256, issues);
		if (object.scope !== undefined) {
			const scope = exactObject(object.scope, '/scope', ['kind', 'path'], issues);
			if (scope) {
				oneOf(scope.kind, ['exact-file', 'folder-tree'], '/scope/kind', issues);
				vaultPath(scope.path, '/scope/path', issues);
			}
		}
		if (object.include !== undefined) hydrationArray(object.include, '/include', issues);
		if (object.limit !== undefined) integer(object.limit, '/limit', 1, 250, issues);
		if (object.cursor !== undefined) cursor(object.cursor, '/cursor', issues);
	}
	return finish(value, issues);
}

export function decodeAdoptPreviewIntentExtensionV1(
	value: unknown,
): DecodeResultV1<AdoptTaskPreviewIntentV1> {
	return decodeAdopt(value, false) as DecodeResultV1<AdoptTaskPreviewIntentV1>;
}

export function decodeAdoptSealedSpecExtensionV1(
	value: unknown,
): DecodeResultV1<AdoptTaskSpecV1> {
	return decodeAdopt(value, true) as DecodeResultV1<AdoptTaskSpecV1>;
}

export function decodeIdentityPlaceholderTargetExtensionV1(
	value: unknown,
): DecodeResultV1<IdentityPlaceholderFileTargetV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'representation', 'mode', 'filePath', 'templateId', 'identityPlaceholderPolicy',
	], issues);
	if (object) {
		literal(object.representation, 'file', '/representation', issues);
		oneOf(object.mode, ['configured-default', 'exact-path'], '/mode', issues);
		literal(object.identityPlaceholderPolicy, 'resolve-operon-id-v1', '/identityPlaceholderPolicy', issues);
		if (object.mode === 'exact-path') vaultPath(object.filePath, '/filePath', issues);
		else if (object.filePath !== undefined) issues.push(issue('/filePath', 'value', 'Configured-default target cannot include filePath.'));
		if (object.templateId !== undefined) safeTemplateId(object.templateId, '/templateId', issues);
	}
	return finish(value, issues);
}

export function decodePeriodicNoteCreateTargetExtensionV1(
	value: unknown,
): DecodeResultV1<PeriodicNoteCreateTargetV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', ['representation', 'mode', 'periodicKind', 'routeDate'], issues);
	if (object) {
		literal(object.representation, 'inline', '/representation', issues);
		literal(object.mode, 'periodic-note', '/mode', issues);
		oneOf(object.periodicKind, ['daily', 'weekly'], '/periodicKind', issues);
		if (object.routeDate !== undefined) dateKey(object.routeDate, '/routeDate', issues);
	}
	return finish(value, issues);
}

export function decodePeriodicNoteCreateSpecExtensionV1(
	value: unknown,
): DecodeResultV1<PeriodicNoteCreateSpecV1> {
	const issues: DecodeIssueV1[] = [];
	periodicCreateSpec(value, '', issues);
	return finish(value, issues);
}

export function decodePeriodicNoteUpdateSpecExtensionV1(
	value: unknown,
): DecodeResultV1<PeriodicNoteUpdateSpecV1> {
	const issues: DecodeIssueV1[] = [];
	periodicUpdateSpec(value, '', issues);
	return finish(value, issues);
}

export function decodeTaskWorkflowPreviewRequestExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowPreviewRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'clientInstanceId', 'idempotencyKey',
		'correlationId', 'capability', 'mutationKind', 'target', 'spec', 'authorization',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'mutation-preview', '/kind', issues);
		boundedString(object.clientInstanceId, '/clientInstanceId', 1, 128, issues);
		boundedToken(object.idempotencyKey, '/idempotencyKey', 16, 256, issues);
		if (object.correlationId !== undefined) requestId(object.correlationId, '/correlationId', issues);
		if (object.target !== undefined) issues.push(issue('/target', 'value', 'Task workflow previews do not accept a target envelope.'));
		authorization(object.authorization, '/authorization', issues);
		if (object.mutationKind === 'task.adopt') {
			literal(object.capability, 'tasks.adopt.preview', '/capability', issues);
			mergeIssues(decodeAdoptPreviewIntentExtensionV1(object.spec), '/spec', issues);
		} else if (object.mutationKind === 'task.create') {
			if (object.capability === 'tasks.create.periodic-note.preview') {
				periodicCreateSpec(object.spec, '/spec', issues);
			} else {
				literal(object.capability, 'tasks.create.identity-placeholders', '/capability', issues);
				identityCreateSpec(object.spec, '/spec', issues);
			}
		} else if (object.mutationKind === 'task.update') {
			literal(object.capability, 'tasks.update.periodic-note.preview', '/capability', issues);
			periodicUpdateSpec(object.spec, '/spec', issues);
		} else {
			issues.push(issue('/mutationKind', 'value', 'Unknown task workflow mutation kind.'));
		}
	}
	return finish(value, issues);
}

function periodicUpdateSpec(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['operation', 'target', 'changes'], issues);
	if (!object) return;
	literal(object.operation, 'update-periodic-note', `${path}/operation`, issues);
	const request = {
		contractVersion: 1,
		requestId: 'periodic-update-validation',
		kind: 'mutation-preview',
		clientInstanceId: 'periodic-update-validation',
		idempotencyKey: 'periodic-update-validation-key',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: object.target,
		spec: { operation: 'update', changes: object.changes },
		authorization: { basis: 'user-explicit-request' },
	};
	const decoded = decodeMutationPreviewRequestV1(request);
	if (!decoded.ok) {
		issues.push(issue(path || '/', 'value', 'Periodic-note update target or changes are invalid.'));
		return;
	}
	if (!Array.isArray(object.changes)) return;
	const dateChanges = object.changes.filter(change => isRecord(change) && change.field === 'dateScheduled');
	if (dateChanges.length !== 1) {
		issues.push(issue(`${path}/changes`, 'value', 'Periodic-note update requires exactly one dateScheduled change.'));
	}
	if (object.changes.some(change => isRecord(change) && change.field === 'parentTask')) {
		issues.push(issue(`${path}/changes`, 'value', 'Periodic-note update does not accept caller-provided parentTask.'));
	}
	if (object.changes.some(change => isRecord(change) && change.field === '__taskDataType')) {
		issues.push(issue(`${path}/changes`, 'value', '__taskDataType is Table-only and not writable through Runtime.'));
	}
}

export function decodeTaskWorkflowSealedPlanExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowSealedPlanV1> {
	const issues: DecodeIssueV1[] = [];
	sealedPlan(value, '', issues);
	return finish(value, issues);
}

export function decodeTaskWorkflowApplyRequestExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowApplyRequestV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'plan', 'authorization', 'idempotencyKey', 'acknowledgements',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'mutation-apply', '/kind', issues);
		sealedPlan(object.plan, '/plan', issues);
		authorization(object.authorization, '/authorization', issues);
		boundedToken(object.idempotencyKey, '/idempotencyKey', 16, 256, issues);
		acknowledgements(object.acknowledgements, '/acknowledgements', issues);
		if (
			typeof object.idempotencyKey === 'string'
			&& isRecord(object.plan)
			&& object.plan.idempotencyKeyHash !== sha256HexV1(object.idempotencyKey)
		) issues.push(issue('/idempotencyKey', 'value', 'Raw idempotency key does not match the sealed plan hash.'));
		if (isRecord(object.plan) && Array.isArray(object.acknowledgements)) {
			acknowledgementBindings(object.acknowledgements, object.plan, '/acknowledgements', issues);
		}
	}
	return finish(value, issues);
}

export function admitTaskWorkflowApplyRequestExtensionV1(
	value: unknown,
	nowEpochMs: number,
): DecodeResultV1<TaskWorkflowApplyRequestV1> {
	const decoded = decodeTaskWorkflowApplyRequestExtensionV1(value);
	if (!decoded.ok) return decoded;
	const issues: DecodeIssueV1[] = [];
	if (!Number.isSafeInteger(nowEpochMs)) {
		issues.push(issue('/nowEpochMs', 'value', 'Apply admission requires a finite safe epoch millisecond clock.'));
	} else {
		const createdAt = timestamp(decoded.value.plan.createdAt);
		const expiresAt = timestamp(decoded.value.plan.expiresAt);
		if (createdAt === null || nowEpochMs < createdAt) issues.push(issue('/plan/createdAt', 'value', 'Plan is not yet valid at the admission clock.'));
		if (expiresAt === null || nowEpochMs >= expiresAt) issues.push(issue('/plan/expiresAt', 'value', 'Plan has expired at the admission clock.'));
		decoded.value.acknowledgements.forEach((acknowledgement, index) => {
			const acknowledgedAt = timestamp(acknowledgement.acknowledgedAt);
			if (acknowledgedAt === null || acknowledgedAt > nowEpochMs) {
				issues.push(issue(`/acknowledgements/${index}/acknowledgedAt`, 'value', 'Acknowledgement cannot be in the admission clock future.'));
			}
		});
	}
	return issues.length === 0 ? decoded : { ok: false, issues };
}

export function decodeTaskWorkflowPreviewResultExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowPreviewResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', ['contractVersion', 'requestId', 'kind', 'ok', 'plan', 'warnings', 'error'], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'mutation-preview-result', '/kind', issues);
		boolean(object.ok, '/ok', issues);
		warnings(object.warnings, '/warnings', issues);
		if (object.ok === true) {
			if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful preview cannot include error.'));
			sealedPlan(object.plan, '/plan', issues);
		} else if (object.ok === false) {
			if (object.plan !== undefined) issues.push(issue('/plan', 'value', 'Failed preview cannot include plan.'));
			structuredError(object.error, '/error', issues);
		}
	}
	return finish(value, issues);
}

export function decodeTaskWorkflowMutationResultExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowMutationResultV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'status', 'mutationMayHaveApplied', 'retryAllowed',
		'groupResults', 'continuation', 'ambiguitySource', 'receipt', 'postflight', 'error',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'mutation-result', '/kind', issues);
		oneOf(object.status, ['applied', 'already-applied', 'partial', 'failed', 'outcome-unknown'], '/status', issues);
		boolean(object.mutationMayHaveApplied, '/mutationMayHaveApplied', issues);
		boolean(object.retryAllowed, '/retryAllowed', issues);
		groupResults(object.groupResults, '/groupResults', issues);
		if (object.continuation !== undefined) {
			const continuation = exactObject(object.continuation, '/continuation', ['originPlanHash', 'remainingGroupIds', 'plan'], issues);
			if (continuation) {
				pattern(continuation.originPlanHash, SHA256, '/continuation/originPlanHash', issues);
				stringArray(continuation.remainingGroupIds, '/continuation/remainingGroupIds', 128, issues);
				sealedPlan(continuation.plan, '/continuation/plan', issues);
			}
		}
		if (object.ambiguitySource !== undefined) oneOf(object.ambiguitySource, ['group-outcome', 'receipt-persist-failure'], '/ambiguitySource', issues);
		if (object.receipt !== undefined) receipt(object.receipt, '/receipt', issues);
		if (object.postflight !== undefined) mutationPostflight(object.postflight, '/postflight', issues);
		if (object.error !== undefined) structuredError(object.error, '/error', issues);
		mutationResultState(object, issues);
	}
	return finish(value, issues);
}

export function decodeTaskFilterQueryResultExtensionV1(
	value: unknown,
): DecodeResultV1<TaskFilterQueryResultV1> {
	const issues: DecodeIssueV1[] = [];
	serializedResultCap(value, issues);
	const object = exactObject(value, '', [
		'contractVersion', 'requestId', 'kind', 'ok', 'freshness', 'warnings', 'contextRevision',
		'tasks', 'page', 'provenance', 'truncations', 'error',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		requestId(object.requestId, '/requestId', issues);
		literal(object.kind, 'task-filter-query-result', '/kind', issues);
		boolean(object.ok, '/ok', issues);
		freshness(object.freshness, '/freshness', issues);
		warnings(object.warnings, '/warnings', issues);
		if (object.ok === true) {
			contextRevision(object.contextRevision, '/contextRevision', issues);
			taskContexts(object.tasks, '/tasks', issues);
			taskQueryPage(object.page, '/page', issues);
			provenanceItems(object.provenance, '/provenance', issues);
			truncationItems(object.truncations, '/truncations', issues);
			if (object.error !== undefined) issues.push(issue('/error', 'value', 'Successful result cannot include error.'));
		} else if (object.ok === false) {
			for (const key of ['tasks', 'page', 'provenance', 'truncations'] as const) if (object[key] !== undefined) issues.push(issue(`/${key}`, 'value', 'Failed result cannot include success payload.'));
			structuredError(object.error, '/error', issues);
		}
	}
	return finish(value, issues);
}

export function decodeTaskWorkflowCliInvocationExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowCliInvocationV1> {
	const issues: DecodeIssueV1[] = [];
	const object = exactObject(value, '', [
		'contractVersion', 'kind', 'requestId', 'command', 'mode', 'clientVersion', 'compatibility',
		'cliContract', 'expectedVaultSha256', 'readinessTimeoutMs', 'request',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		literal(object.kind, 'cli-invocation', '/kind', issues);
		requestId(object.requestId, '/requestId', issues);
		oneOf(object.command, ['tasks.filter-query', 'mutation.preview', 'mutation.apply'], '/command', issues);
		literal(object.mode, 'live', '/mode', issues);
		trimmedString(object.clientVersion, '/clientVersion', 1, 256, issues);
		compatibility(object.compatibility, '/compatibility', issues);
		const cliContract = exactObject(object.cliContract, '/cliContract', ['min', 'max'], issues);
		if (cliContract) {
			literal(cliContract.min, 1, '/cliContract/min', issues);
			literal(cliContract.max, 1, '/cliContract/max', issues);
		}
		pattern(object.expectedVaultSha256, SHA256, '/expectedVaultSha256', issues);
		integer(object.readinessTimeoutMs, '/readinessTimeoutMs', 1, 30_000, issues);
		if (object.command === 'tasks.filter-query') mergeIssues(decodeTaskFilterQueryRequestExtensionV1(object.request), '/request', issues);
		else if (object.command === 'mutation.preview') mergeIssues(decodeTaskWorkflowPreviewRequestExtensionV1(object.request), '/request', issues);
		else if (object.command === 'mutation.apply') mergeIssues(decodeTaskWorkflowApplyRequestExtensionV1(object.request), '/request', issues);
		if (isRecord(object.request) && object.request.requestId !== object.requestId) issues.push(issue('/request/requestId', 'value', 'Invocation and request IDs must match.'));
	}
	serializedCap(value, issues);
	return finish(value, issues);
}

export function decodeTaskWorkflowCliResultEnvelopeExtensionV1(
	value: unknown,
): DecodeResultV1<TaskWorkflowCliResultEnvelopeV1> {
	const issues: DecodeIssueV1[] = [];
	serializedResultCap(value, issues);
	const object = exactObject(value, '', [
		'contractVersion', 'kind', 'requestId', 'command', 'ok', 'transport', 'vaultIdentity',
		'compatibility', 'cliContract', 'runtime', 'timing', 'warnings', 'result', 'failure', 'client', 'recovery',
	], issues);
	if (object) {
		literal(object.contractVersion, 1, '/contractVersion', issues);
		literal(object.kind, 'cli-result', '/kind', issues);
		requestId(object.requestId, '/requestId', issues);
		oneOf(object.command, ['tasks.filter-query', 'mutation.preview', 'mutation.apply'], '/command', issues);
		boolean(object.ok, '/ok', issues);
		cliTransport(object.transport, '/transport', issues);
		cliVaultIdentity(object.vaultIdentity, '/vaultIdentity', issues);
		cliTiming(object.timing, '/timing', issues);
		warnings(object.warnings, '/warnings', issues);
		if (object.compatibility !== undefined) compatibilitySelection(object.compatibility, '/compatibility', issues);
		if (object.cliContract !== undefined) literal(object.cliContract, 1, '/cliContract', issues);
		if (object.runtime !== undefined) cliRuntimeMetadata(object.runtime, '/runtime', issues);
		if (object.client !== undefined) cliClient(object.client, '/client', issues);
		if (object.recovery !== undefined) cliRecovery(object.recovery, '/recovery', object, issues);
		if (object.ok === true) {
			if (!isRecord(object.vaultIdentity) || object.vaultIdentity.expectedMatch !== true) issues.push(issue('/vaultIdentity/expectedMatch', 'value', 'Successful CLI result requires a matching vault.'));
			if (!isRecord(object.compatibility) || object.compatibility.compatible !== true) issues.push(issue('/compatibility', 'required', 'Successful CLI result requires compatible V1 contracts.'));
			if (object.cliContract !== 1) issues.push(issue('/cliContract', 'required', 'Successful CLI result requires CLI contract V1.'));
			if (object.runtime === undefined) issues.push(issue('/runtime', 'required', 'Successful CLI result requires Runtime metadata.'));
			if (object.failure !== undefined) issues.push(issue('/failure', 'value', 'Successful envelope cannot include failure.'));
			if (object.result === undefined) issues.push(issue('/result', 'required', 'Successful CLI result requires a command result.'));
			else if (object.command === 'tasks.filter-query') mergeIssues(decodeTaskFilterQueryResultExtensionV1(object.result), '/result', issues);
			else if (object.command === 'mutation.preview') mergeIssues(decodeTaskWorkflowPreviewResultExtensionV1(object.result), '/result', issues);
			else if (object.command === 'mutation.apply') mergeIssues(decodeTaskWorkflowMutationResultExtensionV1(object.result), '/result', issues);
			if (isRecord(object.result) && object.result.requestId !== object.requestId) issues.push(issue('/result/requestId', 'value', 'Runtime result requestId must match the CLI envelope requestId.'));
		} else if (object.ok === false) {
			if (object.result !== undefined) issues.push(issue('/result', 'value', 'Failed envelope cannot include result.'));
			cliFailure(object.failure, '/failure', issues);
		}
	}
	return finish(value, issues);
}

function decodeAdopt(value: unknown, sealed: boolean): DecodeResultV1<AdoptTaskPreviewIntentV1 | AdoptTaskSpecV1> {
	const issues: DecodeIssueV1[] = [];
	const fields = [
		'operation', 'source', 'statusId', 'terminalSourcePolicy', 'operonId',
		'resolvedStatusId', 'resultingLine', 'sourceDigest', 'resultDigest', 'locator',
	];
	const object = exactObject(value, '', fields, issues);
	if (object) {
		literal(object.operation, 'adopt-inline', '/operation', issues);
		const source = exactObject(object.source, '/source', ['filePath', 'lineNumber', 'expectedLine'], issues);
		if (source) {
			vaultPath(source.filePath, '/source/filePath', issues);
			integer(source.lineNumber, '/source/lineNumber', 0, Number.MAX_SAFE_INTEGER, issues);
			boundedString(source.expectedLine, '/source/expectedLine', 0, 65_536, issues);
		}
		if (object.statusId !== undefined) boundedString(object.statusId, '/statusId', 1, 256, issues);
		if (object.terminalSourcePolicy !== undefined) literal(object.terminalSourcePolicy, 'reopen', '/terminalSourcePolicy', issues);
		const sealedFields = ['operonId', 'resultingLine', 'sourceDigest', 'resultDigest', 'locator'] as const;
		for (const field of sealedFields) {
			if (sealed && object[field] === undefined) issues.push(issue(`/${field}`, 'required', 'Sealed adoption field is required.'));
			if (!sealed && object[field] !== undefined) issues.push(issue(`/${field}`, 'value', 'Preview sealing fields are Runtime-owned.'));
		}
		if (sealed) {
			pattern(object.operonId, OPERON_ID, '/operonId', issues);
			boundedString(object.resultingLine, '/resultingLine', 0, 65_536, issues);
			pattern(object.sourceDigest, SHA256, '/sourceDigest', issues);
			pattern(object.resultDigest, SHA256, '/resultDigest', issues);
			inlineLocator(object.locator, '/locator', issues);
			if ((object.statusId === undefined) !== (object.resolvedStatusId === undefined)) {
				issues.push(issue('/resolvedStatusId', 'value', 'statusId and resolvedStatusId must be supplied together.'));
			}
		} else if (object.resolvedStatusId !== undefined) {
			issues.push(issue('/resolvedStatusId', 'value', 'Preview sealing fields are Runtime-owned.'));
		}
	}
	return finish(value, issues);
}

function exactObject(value: unknown, path: string, allowed: readonly string[], issues: DecodeIssueV1[]): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		issues.push(issue(path || '/', 'type', 'Expected a plain object.'));
		return null;
	}
	const object = value as Record<string, unknown>;
	for (const key of Object.keys(object)) if (!allowed.includes(key)) issues.push(issue(`${path}/${key}`, 'unknown-field', 'Unknown field.'));
	return object;
}

function boundedString(value: unknown, path: string, min: number, max: number, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') issues.push(issue(path, 'type', 'Expected a string.'));
	else if (value.length < min || value.length > max || utf8ByteLengthV1(value) > max) issues.push(issue(path, 'length', 'String is outside the allowed UTF-8 bounds.'));
}

function vaultPath(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string') issues.push(issue(path, 'type', 'Expected a string.'));
	else if (validateVaultRelativePathV1(value)) issues.push(issue(path, 'value', 'Expected a canonical vault-relative path.'));
}

function requestId(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !REQUEST_ID_PATTERN_V1.test(value) || utf8ByteLengthV1(value) > CONTRACT_LIMITS_V1.requestIdBytes) issues.push(issue(path, 'value', 'Expected a bounded canonical requestId.'));
}

function cursor(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || value.length < 16 || value.length > CONTRACT_LIMITS_V1.cursorCharacters || value !== value.trim()) issues.push(issue(path, 'value', 'Cursor must be a trimmed 16-4096 character opaque string.'));
}

function safeTemplateId(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	boundedString(value, path, 1, 256, issues);
	if (
		typeof value === 'string'
		&& [...value].some(character => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f)
	) issues.push(issue(path, 'value', 'Template id contains a forbidden control character.'));
}

function pattern(value: unknown, expression: RegExp, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !expression.test(value)) issues.push(issue(path, 'value', 'Value does not match the required pattern.'));
}

function literal(value: unknown, expected: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (value !== expected) issues.push(issue(path, 'value', `Expected ${JSON.stringify(expected)}.`));
}

function oneOf(value: unknown, choices: readonly unknown[], path: string, issues: DecodeIssueV1[]): void {
	if (!choices.includes(value)) issues.push(issue(path, 'value', 'Value is not in the allowed set.'));
}

function integer(value: unknown, path: string, min: number, max: number, issues: DecodeIssueV1[]): void {
	if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) issues.push(issue(path, 'value', 'Expected a bounded integer.'));
}

function hydrationArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > CONTEXT_HYDRATION_KEYS_V1.length) {
		issues.push(issue(path, 'value', 'Expected a bounded hydration-key array.'));
		return;
	}
	if (value.some(item => typeof item !== 'string' || !(CONTEXT_HYDRATION_KEYS_V1 as readonly string[]).includes(item))) {
		issues.push(issue(path, 'value', 'Unknown hydration key.'));
	}
	if (new Set(value).size !== value.length) issues.push(issue(path, 'value', 'Hydration keys must be unique.'));
}

function inlineLocator(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const locator = exactObject(value, path, ['representation', 'filePath', 'lineNumber'], issues);
	if (!locator) return;
	literal(locator.representation, 'inline', `${path}/representation`, issues);
	vaultPath(locator.filePath, `${path}/filePath`, issues);
	integer(locator.lineNumber, `${path}/lineNumber`, 0, Number.MAX_SAFE_INTEGER, issues);
}

function identityCreateSpec(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const spec = exactObject(value, path, ['operation', 'items'], issues);
	if (!spec) return;
	literal(spec.operation, 'create', `${path}/operation`, issues);
	if (!Array.isArray(spec.items) || spec.items.length < 1 || spec.items.length > 64) {
		issues.push(issue(`${path}/items`, 'value', 'Create items must be a bounded non-empty array.'));
		return;
	}
	for (let index = 0; index < spec.items.length; index++) {
		const itemPath = `${path}/items/${index}`;
		const item = exactObject(spec.items[index], itemPath, [
			'itemRef', 'description', 'target', 'fields', 'tags', 'statusId', 'priorityId',
			'parent', 'related', 'dependencies', 'bodyMarkdown',
		], issues);
		if (!item) continue;
		boundedToken(item.itemRef, `${itemPath}/itemRef`, 1, 128, issues);
		boundedString(item.description, `${itemPath}/description`, 1, 65_536, issues);
		mergeIssues(decodeIdentityPlaceholderTargetExtensionV1(item.target), `${itemPath}/target`, issues);
		if (!Array.isArray(item.fields) || item.fields.length > 256 || item.fields.some(field => !isRecord(field))) issues.push(issue(`${itemPath}/fields`, 'value', 'Fields must be a bounded object array.'));
		if (item.tags !== undefined) stringArray(item.tags, `${itemPath}/tags`, 256, issues);
		for (const key of ['statusId', 'priorityId'] as const) if (item[key] !== undefined) boundedString(item[key], `${itemPath}/${key}`, 1, 256, issues);
		if (item.parent !== undefined) createReference(item.parent, `${itemPath}/parent`, issues);
		if (item.related !== undefined) referenceArray(item.related, `${itemPath}/related`, issues);
		if (item.dependencies !== undefined) objectArray(item.dependencies, `${itemPath}/dependencies`, 64, issues);
		if (item.bodyMarkdown !== undefined) boundedString(item.bodyMarkdown, `${itemPath}/bodyMarkdown`, 0, 1_048_576, issues);
	}
}

function periodicCreateSpec(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const spec = exactObject(value, path, ['operation', 'items'], issues);
	if (!spec) return;
	literal(spec.operation, 'create', `${path}/operation`, issues);
	if (!Array.isArray(spec.items) || spec.items.length !== 1) {
		issues.push(issue(`${path}/items`, 'value', 'Periodic create requires exactly one task item.'));
		return;
	}
	const itemPath = `${path}/items/0`;
	const item = exactObject(spec.items[0], itemPath, [
		'itemRef', 'description', 'target', 'fields', 'tags', 'statusId', 'priorityId',
		'related', 'dependencies',
	], issues);
	if (!item) return;
	boundedToken(item.itemRef, `${itemPath}/itemRef`, 1, 128, issues);
	boundedString(item.description, `${itemPath}/description`, 1, 65_536, issues);
	mergeIssues(decodePeriodicNoteCreateTargetExtensionV1(item.target), `${itemPath}/target`, issues);
	if (!Array.isArray(item.fields) || item.fields.length > 256 || item.fields.some(field => !isRecord(field))) {
		issues.push(issue(`${itemPath}/fields`, 'value', 'Fields must be a bounded object array.'));
	}
	if (item.tags !== undefined) stringArray(item.tags, `${itemPath}/tags`, 256, issues);
	for (const key of ['statusId', 'priorityId'] as const) if (item[key] !== undefined) boundedString(item[key], `${itemPath}/${key}`, 1, 256, issues);
	if (item.related !== undefined) referenceArray(item.related, `${itemPath}/related`, issues);
	if (item.dependencies !== undefined) objectArray(item.dependencies, `${itemPath}/dependencies`, 64, issues);
}

function sealedPlan(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const plan = exactObject(value, path, [
		'contractVersion', 'planId', 'planHash', 'clientInstanceId', 'correlationId', 'idempotencyKeyHash',
		'receiptTargetDigest', 'capability', 'mutationKind', 'createdAt', 'expiresAt', 'targets',
		'contextRevision', 'affectedResources', 'atomicGroups', 'predictedEffects', 'riskLevel',
		'requiresConfirmation', 'requiredAcknowledgements', 'warnings', 'spec', 'createEffects', 'periodicRoute', 'periodicUpdate',
	], issues);
	if (!plan) return;
	literal(plan.contractVersion, 1, `${path}/contractVersion`, issues);
	requestId(plan.planId, `${path}/planId`, issues);
	for (const key of ['planHash', 'idempotencyKeyHash', 'receiptTargetDigest'] as const) pattern(plan[key], SHA256, `${path}/${key}`, issues);
	boundedString(plan.clientInstanceId, `${path}/clientInstanceId`, 1, 128, issues);
	requestId(plan.correlationId, `${path}/correlationId`, issues);
	isoTimestamp(plan.createdAt, `${path}/createdAt`, issues);
	isoTimestamp(plan.expiresAt, `${path}/expiresAt`, issues);
	planTargets(plan.targets, `${path}/targets`, issues);
	contextRevision(plan.contextRevision, `${path}/contextRevision`, issues);
	affectedResources(plan.affectedResources, `${path}/affectedResources`, issues);
	atomicGroups(plan.atomicGroups, `${path}/atomicGroups`, issues);
	predictedEffects(plan.predictedEffects, `${path}/predictedEffects`, issues);
	oneOf(plan.riskLevel, ['none', 'routine', 'elevated', 'destructive'], `${path}/riskLevel`, issues);
	boolean(plan.requiresConfirmation, `${path}/requiresConfirmation`, issues);
	stringArray(plan.requiredAcknowledgements, `${path}/requiredAcknowledgements`, 128, issues);
	warnings(plan.warnings, `${path}/warnings`, issues);
	if (plan.mutationKind === 'task.adopt') {
		literal(plan.capability, 'tasks.adopt.preview', `${path}/capability`, issues);
		mergeIssues(decodeAdoptSealedSpecExtensionV1(plan.spec), `${path}/spec`, issues);
		if (plan.createEffects !== undefined) issues.push(issue(`${path}/createEffects`, 'value', 'Adoption plan cannot include create effects.'));
	} else if (plan.mutationKind === 'task.create') {
		if (plan.capability === 'tasks.create.periodic-note.preview') {
			periodicCreateSpec(plan.spec, `${path}/spec`, issues);
			baseCreateEffects(plan.createEffects, `${path}/createEffects`, issues);
			periodicRoute(plan.periodicRoute, `${path}/periodicRoute`, issues);
		} else {
			literal(plan.capability, 'tasks.create.identity-placeholders', `${path}/capability`, issues);
			identityCreateSpec(plan.spec, `${path}/spec`, issues);
			identityCreateEffects(plan.createEffects, `${path}/createEffects`, issues);
			if (plan.periodicRoute !== undefined) issues.push(issue(`${path}/periodicRoute`, 'value', 'Identity-placeholder plans cannot include periodic route evidence.'));
		}
	} else if (plan.mutationKind === 'task.update') {
		literal(plan.capability, 'tasks.update.periodic-note.preview', `${path}/capability`, issues);
		periodicUpdateSpec(plan.spec, `${path}/spec`, issues);
		periodicUpdateRoute(plan.periodicUpdate, `${path}/periodicUpdate`, issues);
		if (plan.createEffects !== undefined) issues.push(issue(`${path}/createEffects`, 'value', 'Periodic update plans cannot include create effects.'));
		if (plan.periodicRoute !== undefined) issues.push(issue(`${path}/periodicRoute`, 'value', 'Periodic update plans cannot include create route evidence.'));
	} else {
		issues.push(issue(`${path}/mutationKind`, 'value', 'Unknown task workflow mutation kind.'));
	}
	const createdAt = timestamp(plan.createdAt);
	const expiresAt = timestamp(plan.expiresAt);
	if (createdAt !== null && expiresAt !== null && expiresAt - createdAt !== 300_000) {
		issues.push(issue(`${path}/expiresAt`, 'value', 'Task-workflow plans must use the exact five-minute validity interval.'));
	}
	planBindings(plan, path, issues);
	if (issues.length === 0) {
		try {
			const { planHash: _planHash, ...material } = plan;
			if (plan.planHash !== sha256HexV1(canonicalJsonV1(toJsonValueV1(material)))) {
				issues.push(issue(`${path}/planHash`, 'value', 'Sealed plan hash does not match its canonical material.'));
			}
		} catch {
			issues.push(issue(`${path}/planHash`, 'value', 'Sealed plan hash material is not canonical JSON.'));
		}
	}
}

function periodicUpdateRoute(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, [
		'decision', 'periodicKind', 'previousDateScheduled', 'nextDateScheduled',
		'periodicAnchorDateKey', 'notePath', 'configDigest', 'templatePath', 'templateRevision',
		'templateDigest', 'preparedNoteContent', 'container', 'parentBefore', 'parentAfter',
		'originalLocator', 'sourceTransitions',
	], issues);
	if (!object) return;
	oneOf(object.decision, ['detach', 'retain', 'realign'], `${path}/decision`, issues);
	oneOf(object.periodicKind, ['daily', 'weekly'], `${path}/periodicKind`, issues);
	for (const key of ['previousDateScheduled', 'nextDateScheduled'] as const) {
		if (object[key] !== '') dateKey(object[key], `${path}/${key}`, issues);
	}
	if (object.periodicAnchorDateKey !== null) dateKey(object.periodicAnchorDateKey, `${path}/periodicAnchorDateKey`, issues);
	if (object.notePath !== null) vaultPath(object.notePath, `${path}/notePath`, issues);
	for (const key of ['configDigest', 'templateDigest'] as const) pattern(object[key], SHA256, `${path}/${key}`, issues);
	if (object.templatePath !== null) vaultPath(object.templatePath, `${path}/templatePath`, issues);
	if (object.templateRevision !== undefined) boundedString(object.templateRevision, `${path}/templateRevision`, 1, 4096, issues);
	if (object.preparedNoteContent !== undefined) boundedString(object.preparedNoteContent, `${path}/preparedNoteContent`, 0, CONTRACT_LIMITS_V1.generalStringBytes * 8, issues);
	for (const key of ['parentBefore', 'parentAfter'] as const) if (object[key] !== null) pattern(object[key], OPERON_ID, `${path}/${key}`, issues);
	taskLocator(object.originalLocator, `${path}/originalLocator`, issues);
	const container = exactObject(object.container, `${path}/container`, ['mode', 'operonId', 'registryState'], issues);
	if (container) {
		oneOf(container.mode, ['none', 'existing', 'create'], `${path}/container/mode`, issues);
		oneOf(container.registryState, ['not-required', 'registered', 'register'], `${path}/container/registryState`, issues);
		if (container.operonId !== undefined) pattern(container.operonId, OPERON_ID, `${path}/container/operonId`, issues);
		if (container.mode === 'none' && container.operonId !== undefined) issues.push(issue(`${path}/container/operonId`, 'value', 'Detached update cannot include a container id.'));
		if (container.mode !== 'none' && container.operonId === undefined) issues.push(issue(`${path}/container/operonId`, 'required', 'Periodic realignment requires a container id.'));
	}
	if (!Array.isArray(object.sourceTransitions) || object.sourceTransitions.length < 1 || object.sourceTransitions.length > 128) {
		issues.push(issue(`${path}/sourceTransitions`, 'value', 'Periodic update requires bounded source transitions.'));
	} else object.sourceTransitions.forEach((candidate, index) => {
		const transitionPath = `${path}/sourceTransitions/${index}`;
		const transition = exactObject(candidate, transitionPath, ['filePath', 'expectedState', 'expectedDigest', 'plannedDigest'], issues);
		if (!transition) return;
		vaultPath(transition.filePath, `${transitionPath}/filePath`, issues);
		oneOf(transition.expectedState, ['absent', 'present'], `${transitionPath}/expectedState`, issues);
		pattern(transition.expectedDigest, SHA256, `${transitionPath}/expectedDigest`, issues);
		pattern(transition.plannedDigest, SHA256, `${transitionPath}/plannedDigest`, issues);
	});
	if (object.decision === 'detach' && (object.notePath !== null || object.parentAfter !== null || container?.mode !== 'none')) {
		issues.push(issue(path, 'value', 'Detach evidence cannot bind a destination container.'));
	}
}

function identityCreateEffects(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
		issues.push(issue(path, 'value', 'Identity create effects must be a bounded non-empty array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) {
		const effectPath = `${path}/${index}`;
		const effect = exactObject(value[index], effectPath, [
			'itemRef', 'operonId', 'repeatSeriesId', 'locator', 'targetBeforeDigest', 'expectedAbsence',
			'renderedTaskDigest', 'plannedSourceDigest', 'templateId', 'templateDigest',
			'templateIdentityAllocations', 'resolvedParentOperonId', 'resolvedRelatedOperonIds',
			'resolvedDependencies', 'bodyMarkdownSummary',
		], issues);
		if (!effect) continue;
		boundedToken(effect.itemRef, `${effectPath}/itemRef`, 1, 128, issues);
		pattern(effect.operonId, OPERON_ID, `${effectPath}/operonId`, issues);
		taskLocator(effect.locator, `${effectPath}/locator`, issues);
		for (const key of ['renderedTaskDigest', 'plannedSourceDigest'] as const) pattern(effect[key], SHA256, `${effectPath}/${key}`, issues);
		if ((effect.targetBeforeDigest === undefined) === (effect.expectedAbsence === undefined)) issues.push(issue(effectPath, 'value', 'Effect requires exactly one source precondition.'));
		if (effect.targetBeforeDigest !== undefined) pattern(effect.targetBeforeDigest, SHA256, `${effectPath}/targetBeforeDigest`, issues);
		if (effect.expectedAbsence !== undefined) literal(effect.expectedAbsence, true, `${effectPath}/expectedAbsence`, issues);
		if (effect.repeatSeriesId !== undefined) boundedToken(effect.repeatSeriesId, `${effectPath}/repeatSeriesId`, 1, 256, issues);
		if (effect.templateId !== undefined) safeTemplateId(effect.templateId, `${effectPath}/templateId`, issues);
		if (effect.templateDigest !== undefined) pattern(effect.templateDigest, SHA256, `${effectPath}/templateDigest`, issues);
		if (effect.resolvedParentOperonId !== undefined) pattern(effect.resolvedParentOperonId, OPERON_ID, `${effectPath}/resolvedParentOperonId`, issues);
		if (!Array.isArray(effect.resolvedRelatedOperonIds) || effect.resolvedRelatedOperonIds.length > 64) issues.push(issue(`${effectPath}/resolvedRelatedOperonIds`, 'value', 'Resolved related ids must be a bounded array.'));
		else effect.resolvedRelatedOperonIds.forEach((id, index) => pattern(id, OPERON_ID, `${effectPath}/resolvedRelatedOperonIds/${index}`, issues));
		if (effect.resolvedDependencies !== undefined) {
			if (!Array.isArray(effect.resolvedDependencies) || effect.resolvedDependencies.length > 64) issues.push(issue(`${effectPath}/resolvedDependencies`, 'value', 'Resolved dependencies must be a bounded array.'));
			else effect.resolvedDependencies.forEach((dependency, dependencyIndex) => {
				const dependencyPath = `${effectPath}/resolvedDependencies/${dependencyIndex}`;
				const item = exactObject(dependency, dependencyPath, ['relation', 'operonId'], issues);
				if (!item) return;
				oneOf(item.relation, ['blocks', 'blocked-by'], `${dependencyPath}/relation`, issues);
				pattern(item.operonId, OPERON_ID, `${dependencyPath}/operonId`, issues);
			});
		}
		if (!Array.isArray(effect.templateIdentityAllocations) || effect.templateIdentityAllocations.length > 256) issues.push(issue(`${effectPath}/templateIdentityAllocations`, 'value', 'Template allocations must be a bounded array.'));
		else for (let allocationIndex = 0; allocationIndex < effect.templateIdentityAllocations.length; allocationIndex++) {
			const allocationPath = `${effectPath}/templateIdentityAllocations/${allocationIndex}`;
			const allocation = exactObject(effect.templateIdentityAllocations[allocationIndex], allocationPath, ['occurrence', 'suffix', 'operonId'], issues);
			if (!allocation) continue;
			integer(allocation.occurrence, `${allocationPath}/occurrence`, 0, Number.MAX_SAFE_INTEGER, issues);
			if (allocation.suffix !== undefined) pattern(allocation.suffix, /^[0-9A-Za-z]$/u, `${allocationPath}/suffix`, issues);
			pattern(allocation.operonId, OPERON_ID, `${allocationPath}/operonId`, issues);
		}
		if (Array.isArray(effect.templateIdentityAllocations)) {
			const occurrences = effect.templateIdentityAllocations.map(item => isRecord(item) ? item.occurrence : undefined);
			if (occurrences.some((occurrence, index) => occurrence !== index)) issues.push(issue(`${effectPath}/templateIdentityAllocations`, 'value', 'Allocation occurrences must be zero-based and contiguous.'));
			const suffixIds = new Map<string, unknown>();
			for (const item of effect.templateIdentityAllocations) {
				if (!isRecord(item) || typeof item.suffix !== 'string') continue;
				const prior = suffixIds.get(item.suffix);
				if (prior !== undefined && prior !== item.operonId) issues.push(issue(`${effectPath}/templateIdentityAllocations`, 'value', 'Repeated suffixes must resolve to the same Operon id.'));
				suffixIds.set(item.suffix, item.operonId);
			}
		}
	}
}

function baseCreateEffects(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length !== 1) {
		issues.push(issue(path, 'value', 'Periodic create effects must contain exactly one task.'));
		return;
	}
	const effects: unknown[] = (value as unknown[]).map((item): unknown => {
		return isRecord(item) ? { ...item, templateIdentityAllocations: [] } : item;
	});
	identityCreateEffects(effects, path, issues);
}

function periodicRoute(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, [
		'periodicKind', 'routeDateKey', 'periodicAnchorDateKey', 'routeSource', 'localToday', 'notePath',
		'headingKeyword', 'configDigest', 'templatePath', 'templateRevision', 'templateDigest',
		'noteExpectedState', 'noteExpectedDigest', 'preparedNoteContent', 'container',
	], issues);
	if (!object) return;
	oneOf(object.periodicKind, ['daily', 'weekly'], `${path}/periodicKind`, issues);
	dateKey(object.routeDateKey, `${path}/routeDateKey`, issues);
	dateKey(object.periodicAnchorDateKey, `${path}/periodicAnchorDateKey`, issues);
	oneOf(object.routeSource, ['explicit-route-date', 'date-scheduled', 'datetime-start-local-date', 'local-today'], `${path}/routeSource`, issues);
	dateKey(object.localToday, `${path}/localToday`, issues);
	vaultPath(object.notePath, `${path}/notePath`, issues);
	boundedString(object.headingKeyword, `${path}/headingKeyword`, 1, 4096, issues);
	for (const key of ['configDigest', 'templateDigest', 'noteExpectedDigest'] as const) pattern(object[key], SHA256, `${path}/${key}`, issues);
	if (object.templatePath !== null) vaultPath(object.templatePath, `${path}/templatePath`, issues);
	if (object.templateRevision !== undefined) boundedString(object.templateRevision, `${path}/templateRevision`, 1, 4096, issues);
	oneOf(object.noteExpectedState, ['absent', 'present'], `${path}/noteExpectedState`, issues);
	boundedString(object.preparedNoteContent, `${path}/preparedNoteContent`, 0, CONTRACT_LIMITS_V1.generalStringBytes * 8, issues);
	const container = exactObject(object.container, `${path}/container`, ['mode', 'operonId', 'registryState'], issues);
	if (container) {
		oneOf(container.mode, ['none', 'existing', 'create'], `${path}/container/mode`, issues);
		oneOf(container.registryState, ['not-required', 'registered', 'register'], `${path}/container/registryState`, issues);
		if (container.operonId !== undefined) pattern(container.operonId, OPERON_ID, `${path}/container/operonId`, issues);
		if (container.mode === 'none' && container.operonId !== undefined) issues.push(issue(`${path}/container/operonId`, 'value', 'A missing periodic container cannot include an Operon id.'));
		if (container.mode !== 'none' && container.operonId === undefined) issues.push(issue(`${path}/container/operonId`, 'required', 'A periodic container requires an Operon id.'));
		if (container.mode === 'none' && container.registryState !== 'not-required') issues.push(issue(`${path}/container/registryState`, 'value', 'A parentless periodic note cannot require registry state.'));
		if (container.mode === 'existing' && container.registryState !== 'registered') issues.push(issue(`${path}/container/registryState`, 'value', 'An existing periodic container must already be registered.'));
		if (container.mode === 'create' && container.registryState !== 'register') issues.push(issue(`${path}/container/registryState`, 'value', 'A new periodic container must seal registry registration.'));
	}
	if (typeof object.periodicKind === 'string' && typeof object.routeDateKey === 'string' && typeof object.periodicAnchorDateKey === 'string') {
		const expectedAnchor = object.periodicKind === 'daily'
			? object.routeDateKey
			: isoMondayDateKey(object.routeDateKey);
		if (expectedAnchor !== object.periodicAnchorDateKey) issues.push(issue(`${path}/periodicAnchorDateKey`, 'value', 'The periodic anchor does not match the sealed route date.'));
	}
}

function isoMondayDateKey(dateKeyValue: string): string | null {
	const date = new Date(`${dateKeyValue}T00:00:00Z`);
	if (!Number.isFinite(date.getTime())) return null;
	const day = date.getUTCDay();
	date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
	return date.toISOString().slice(0, 10);
}

function authorization(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['basis', 'reason'], issues);
	if (!object) return;
	oneOf(object.basis, ['user-explicit-request', 'user-explicit-confirmation', 'user-standing-instruction', 'host-policy'], `${path}/basis`, issues);
	if (object.reason !== undefined) boundedString(object.reason, `${path}/reason`, 1, 4096, issues);
}

function acknowledgements(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 128) {
		issues.push(issue(path, 'value', 'Acknowledgements must be a bounded array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) {
		const itemPath = `${path}/${index}`;
		const item = exactObject(value[index], itemPath, ['code', 'planHash', 'targetDigest', 'acknowledgedAt'], issues);
		if (!item) continue;
		boundedToken(item.code, `${itemPath}/code`, 1, 128, issues);
		pattern(item.planHash, SHA256, `${itemPath}/planHash`, issues);
		pattern(item.targetDigest, SHA256, `${itemPath}/targetDigest`, issues);
		isoTimestamp(item.acknowledgedAt, `${itemPath}/acknowledgedAt`, issues);
	}
}

function acknowledgementBindings(
	value: unknown[],
	plan: Record<string, unknown>,
	path: string,
	issues: DecodeIssueV1[],
): void {
	const requiredCodes = Array.isArray(plan.requiredAcknowledgements)
		? new Set(plan.requiredAcknowledgements.filter((item): item is string => typeof item === 'string'))
		: new Set<string>();
	const targetDigests = new Set(
		Array.isArray(plan.targets)
			? plan.targets.filter(isRecord).map(target => target.targetDigest).filter((item): item is string => typeof item === 'string')
			: [],
	);
	const acknowledgedCodes = new Set<string>();
	const createdAt = timestamp(plan.createdAt);
	const expiresAt = timestamp(plan.expiresAt);
	value.forEach((candidate, index) => {
		if (!isRecord(candidate)) return;
		if (typeof candidate.code === 'string') {
			if (acknowledgedCodes.has(candidate.code)) issues.push(issue(`${path}/${index}/code`, 'value', 'Acknowledgement codes must be unique.'));
			acknowledgedCodes.add(candidate.code);
			if (!requiredCodes.has(candidate.code)) issues.push(issue(`${path}/${index}/code`, 'value', 'Acknowledgement code is not required by the sealed plan.'));
		}
		if (candidate.planHash !== plan.planHash) issues.push(issue(`${path}/${index}/planHash`, 'value', 'Acknowledgement must bind the exact sealed plan hash.'));
		if (typeof candidate.targetDigest !== 'string' || !targetDigests.has(candidate.targetDigest)) issues.push(issue(`${path}/${index}/targetDigest`, 'value', 'Acknowledgement target is not part of the sealed plan.'));
		const acknowledgedAt = timestamp(candidate.acknowledgedAt);
		if (acknowledgedAt === null || createdAt === null || expiresAt === null || acknowledgedAt < createdAt || acknowledgedAt > expiresAt) {
			issues.push(issue(`${path}/${index}/acknowledgedAt`, 'value', 'Acknowledgement must occur within the plan interval.'));
		}
	});
	if (acknowledgedCodes.size !== requiredCodes.size || [...requiredCodes].some(code => !acknowledgedCodes.has(code))) {
		issues.push(issue(path, 'value', 'Acknowledgements must exactly cover every required code.'));
	}
}

const RESOURCE_KINDS = ['timer', 'repeat-series', 'active-tracker', 'pinned', 'project-serial', 'task-source'] as const;

function planTargets(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
		issues.push(issue(path, 'value', 'Plan targets must be a bounded non-empty array.'));
		return;
	}
	const digests = new Set<string>();
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const target = exactObject(candidate, itemPath, ['operonId', 'locator', 'targetDigest'], issues);
		if (!target) return;
		if (target.operonId !== undefined) pattern(target.operonId, OPERON_ID, `${itemPath}/operonId`, issues);
		if (target.locator !== undefined) taskLocator(target.locator, `${itemPath}/locator`, issues);
		pattern(target.targetDigest, SHA256, `${itemPath}/targetDigest`, issues);
		if (typeof target.targetDigest === 'string') {
			if (digests.has(target.targetDigest)) issues.push(issue(`${itemPath}/targetDigest`, 'value', 'Target digests must be unique.'));
			digests.add(target.targetDigest);
		}
	});
}

function taskLocator(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isRecord(value)) {
		issues.push(issue(path, 'type', 'Expected an exact task locator.'));
		return;
	}
	if (value.representation === 'inline') inlineLocator(value, path, issues);
	else if (value.representation === 'file') {
		const locator = exactObject(value, path, ['representation', 'filePath'], issues);
		if (!locator) return;
		vaultPath(locator.filePath, `${path}/filePath`, issues);
	} else issues.push(issue(`${path}/representation`, 'value', 'Unknown task locator representation.'));
}

function contextRevision(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['index', 'settingsFingerprint', 'pinnedGeneration', 'activeTrackerGeneration', 'repeatSeriesRevision', 'projectSerialGeneration', 'projectSerialSignature'], issues);
	if (!object) return;
	const index = exactObject(object.index, `${path}/index`, ['sessionId', 'ramGeneration', 'durable'], issues);
	if (index) {
		boundedString(index.sessionId, `${path}/index/sessionId`, 1, 256, issues);
		integer(index.ramGeneration, `${path}/index/ramGeneration`, 0, Number.MAX_SAFE_INTEGER, issues);
		const durable = exactObject(index.durable, `${path}/index/durable`, ['status', 'snapshotId', 'committedAt'], issues);
		if (durable) {
			oneOf(durable.status, ['available', 'missing', 'recovery-required', 'unavailable'], `${path}/index/durable/status`, issues);
			if (durable.status === 'available') {
				boundedString(durable.snapshotId, `${path}/index/durable/snapshotId`, 1, 256, issues);
				isoTimestamp(durable.committedAt, `${path}/index/durable/committedAt`, issues);
			} else if (durable.snapshotId !== undefined || durable.committedAt !== undefined) issues.push(issue(`${path}/index/durable`, 'value', 'Unavailable durable revision cannot include snapshot metadata.'));
		}
	}
	pattern(object.settingsFingerprint, SHA256, `${path}/settingsFingerprint`, issues);
	for (const key of ['pinnedGeneration', 'activeTrackerGeneration', 'repeatSeriesRevision', 'projectSerialGeneration'] as const) integer(object[key], `${path}/${key}`, 0, Number.MAX_SAFE_INTEGER, issues);
	pattern(object.projectSerialSignature, SHA256, `${path}/projectSerialSignature`, issues);
}

function affectedResources(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
		issues.push(issue(path, 'value', 'Affected resources must be a bounded non-empty array.'));
		return;
	}
	const identities = new Set<string>();
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const resource = exactObject(candidate, itemPath, ['resourceKind', 'resourceKey', 'revision'], issues);
		if (!resource) return;
		oneOf(resource.resourceKind, RESOURCE_KINDS, `${itemPath}/resourceKind`, issues);
		boundedString(resource.resourceKey, `${itemPath}/resourceKey`, 1, 4096, issues);
		boundedString(resource.revision, `${itemPath}/revision`, 1, 4096, issues);
		const identity = `${String(resource.resourceKind)}\0${String(resource.resourceKey)}`;
		if (identities.has(identity)) issues.push(issue(itemPath, 'value', 'Duplicate affected resource.'));
		identities.add(identity);
	});
}

function atomicGroups(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
		issues.push(issue(path, 'value', 'Atomic groups must be a bounded non-empty array.'));
		return;
	}
	const ids = new Set<string>();
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const group = exactObject(candidate, itemPath, ['groupId', 'order', 'resources'], issues);
		if (!group) return;
		boundedString(group.groupId, `${itemPath}/groupId`, 1, 4096, issues);
		integer(group.order, `${itemPath}/order`, 0, Number.MAX_SAFE_INTEGER, issues);
		if (group.order !== index) issues.push(issue(`${itemPath}/order`, 'value', 'Atomic group order must be zero-based and contiguous.'));
		if (typeof group.groupId === 'string' && ids.has(group.groupId)) issues.push(issue(`${itemPath}/groupId`, 'value', 'Atomic group ids must be unique.'));
		if (typeof group.groupId === 'string') ids.add(group.groupId);
		resourceReferences(group.resources, `${itemPath}/resources`, issues);
	});
}

function resourceReferences(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
		issues.push(issue(path, 'value', 'Resource references must be a bounded non-empty array.'));
		return;
	}
	value.forEach((candidate, index) => {
		const reference = exactObject(candidate, `${path}/${index}`, ['resourceKind', 'resourceKey'], issues);
		if (!reference) return;
		oneOf(reference.resourceKind, RESOURCE_KINDS, `${path}/${index}/resourceKind`, issues);
		boundedString(reference.resourceKey, `${path}/${index}/resourceKey`, 1, 4096, issues);
	});
}

function predictedEffects(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
		issues.push(issue(path, 'value', 'Predicted effects must be a bounded non-empty array.'));
		return;
	}
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const effect = exactObject(candidate, itemPath, ['resourceKind', 'resourceKey', 'action', 'summary'], issues);
		if (!effect) return;
		oneOf(effect.resourceKind, RESOURCE_KINDS, `${itemPath}/resourceKind`, issues);
		boundedString(effect.resourceKey, `${itemPath}/resourceKey`, 1, 4096, issues);
		oneOf(effect.action, ['create', 'update', 'trash', 'state-change'], `${itemPath}/action`, issues);
		boundedString(effect.summary, `${itemPath}/summary`, 1, 4096, issues);
	});
}

function planBindings(plan: Record<string, unknown>, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(plan.targets) || !Array.isArray(plan.affectedResources) || !Array.isArray(plan.atomicGroups) || !Array.isArray(plan.predictedEffects)) return;
	const targets = plan.targets.filter(isRecord);
	const affected = plan.affectedResources.filter(isRecord);
	const affectedKeys = affected.map(resourceIdentity);
	const affectedSet = new Set(affectedKeys);
	const flattened = plan.atomicGroups.filter(isRecord).flatMap(group => Array.isArray(group.resources) ? group.resources.filter(isRecord) : []);
	const flattenedKeys = flattened.map(resourceIdentity);
	if (flattenedKeys.length !== affectedKeys.length || new Set(flattenedKeys).size !== flattenedKeys.length || affectedKeys.some(key => !flattenedKeys.includes(key))) {
		issues.push(issue(`${path}/atomicGroups`, 'value', 'Atomic groups must cover each affected resource exactly once.'));
	}
	plan.predictedEffects.filter(isRecord).forEach((effect, index) => {
		if (!affectedSet.has(resourceIdentity(effect))) issues.push(issue(`${path}/predictedEffects/${index}`, 'value', 'Predicted effect references an unbound resource.'));
	});
	try {
		const receiptDigest = sha256HexV1(canonicalJsonV1(toJsonValueV1(targets)));
		if (plan.receiptTargetDigest !== receiptDigest) issues.push(issue(`${path}/receiptTargetDigest`, 'value', 'Receipt target digest must bind the canonical target list.'));
	} catch {
		issues.push(issue(`${path}/receiptTargetDigest`, 'value', 'Receipt target material is not canonical JSON.'));
	}
	if (plan.requiresConfirmation !== (Array.isArray(plan.requiredAcknowledgements) && plan.requiredAcknowledgements.length > 0)) {
		issues.push(issue(`${path}/requiresConfirmation`, 'value', 'Confirmation flag must match required acknowledgements.'));
	}
}

function resourceIdentity(value: Record<string, unknown>): string {
	return `${String(value.resourceKind)}\0${String(value.resourceKey)}`;
}

function isoTimestamp(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (timestamp(value) === null) issues.push(issue(path, 'value', 'Expected a canonical UTC timestamp.'));
}

function timestamp(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return null;
	try {
		return new Date(parsed).toISOString() === value ? parsed : null;
	} catch {
		return null;
	}
}

function receipt(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, [
		'contractVersion', 'vaultIdentityHash', 'clientInstanceId', 'idempotencyKeyHash', 'planHash',
		'mutationKind', 'targetDigest', 'terminalOutcome', 'effectiveAt', 'completedAt', 'expiresAt',
	], issues);
	if (!object) return;
	literal(object.contractVersion, 1, `${path}/contractVersion`, issues);
	for (const key of ['vaultIdentityHash', 'idempotencyKeyHash', 'planHash', 'targetDigest'] as const) pattern(object[key], SHA256, `${path}/${key}`, issues);
	boundedString(object.clientInstanceId, `${path}/clientInstanceId`, 1, 128, issues);
	oneOf(object.mutationKind, ['task.adopt', 'task.create', 'task.update'], `${path}/mutationKind`, issues);
	oneOf(object.terminalOutcome, ['applied', 'already-applied', 'outcome-unknown'], `${path}/terminalOutcome`, issues);
	for (const key of ['effectiveAt', 'completedAt', 'expiresAt'] as const) isoTimestamp(object[key], `${path}/${key}`, issues);
	const effectiveAt = timestamp(object.effectiveAt);
	const completedAt = timestamp(object.completedAt);
	const expiresAt = timestamp(object.expiresAt);
	if (effectiveAt !== null && completedAt !== null && completedAt < effectiveAt) issues.push(issue(`${path}/completedAt`, 'value', 'Receipt completion cannot precede effectiveAt.'));
	if (completedAt !== null && expiresAt !== null && (expiresAt <= completedAt || expiresAt - completedAt > 86_400_000)) issues.push(issue(`${path}/expiresAt`, 'value', 'Receipt expiry must be within 24 hours after completion.'));
}

function cliTransport(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['channel', 'inputBytes'], issues);
	if (!object) return;
	literal(object.channel, 'request-file', `${path}/channel`, issues);
	integer(object.inputBytes, `${path}/inputBytes`, 0, CONTRACT_LIMITS_V1.transportInputBytes, issues);
}

function cliVaultIdentity(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['expectedMatch'], issues);
	if (!object) return;
	if (object.expectedMatch !== null) boolean(object.expectedMatch, `${path}/expectedMatch`, issues);
}

function cliTiming(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['handlerMs', 'totalMs'], issues);
	if (!object) return;
	if (object.handlerMs === undefined) issues.push(issue(`${path}/handlerMs`, 'required', 'Handler duration is required.'));
	for (const key of ['handlerMs', 'totalMs'] as const) {
		const duration = object[key];
		if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) issues.push(issue(`${path}/${key}`, 'value', 'Expected a finite non-negative duration.'));
	}
}

function cliRuntimeMetadata(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['appVersion', 'plugin', 'apiVersion'], issues);
	if (!object) return;
	trimmedString(object.appVersion, `${path}/appVersion`, 1, 256, issues);
	literal(object.apiVersion, 1, `${path}/apiVersion`, issues);
	const plugin = exactObject(object.plugin, `${path}/plugin`, ['id', 'version', 'minAppVersion'], issues);
	if (!plugin) return;
	literal(plugin.id, 'operon', `${path}/plugin/id`, issues);
	for (const key of ['version', 'minAppVersion'] as const) trimmedString(plugin[key], `${path}/plugin/${key}`, 1, 256, issues);
}

function cliClient(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['profile', 'planRef'], issues);
	if (!object) return;
	for (const key of ['profile', 'planRef'] as const) if (object[key] !== undefined) trimmedString(object[key], `${path}/${key}`, 1, 128, issues);
}

function cliRecovery(
	value: unknown,
	path: string,
	envelope: Record<string, unknown>,
	issues: DecodeIssueV1[],
): void {
	const object = exactObject(value, path, ['required', 'planRef', 'action', 'mutationMayHaveApplied'], issues);
	if (!object) return;
	literal(object.required, true, `${path}/required`, issues);
	trimmedString(object.planRef, `${path}/planRef`, 1, 128, issues);
	literal(object.action, 'recover-same-plan', `${path}/action`, issues);
	literal(object.mutationMayHaveApplied, true, `${path}/mutationMayHaveApplied`, issues);
	if (envelope.command !== 'mutation.apply') issues.push(issue(path, 'value', 'Recovery metadata is valid only for mutation.apply.'));
	const client = isRecord(envelope.client) ? envelope.client : null;
	if (client?.planRef !== object.planRef) issues.push(issue(`${path}/planRef`, 'value', 'Recovery planRef must match client.planRef.'));
	if (envelope.ok === false) {
		const failure = isRecord(envelope.failure) ? envelope.failure : null;
		const error = failure && isRecord(failure.error) ? failure.error : null;
		if (!error || error.code !== 'outcome-unknown' || error.retryable !== false || error.action !== 'recover-same-plan') {
			issues.push(issue(path, 'value', 'Failed recovery envelope must be non-retryable outcome-unknown.'));
		}
	} else if (envelope.ok === true) {
		const result = isRecord(envelope.result) ? envelope.result : null;
		if (!result || result.mutationMayHaveApplied !== true || result.status === 'applied' || result.status === 'already-applied') {
			issues.push(issue(path, 'value', 'Successful recovery metadata requires a non-final mutation result that may have applied.'));
		}
	}
}

function cliFailure(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['stage', 'error'], issues);
	if (!object) return;
	oneOf(object.stage, ['client-input', 'transport', 'vault', 'compatibility', 'readiness', 'capability', 'runtime', 'internal'], `${path}/stage`, issues);
	structuredError(object.error, `${path}/error`, issues);
}

function groupResults(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 128) {
		issues.push(issue(path, 'value', 'Expected a bounded group result array.'));
		return;
	}
	const groupIds = new Set<string>();
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const object = exactObject(candidate, itemPath, ['groupId', 'status', 'resourceRevisions', 'error'], issues);
		if (!object) return;
		boundedString(object.groupId, `${itemPath}/groupId`, 1, 4096, issues);
		if (typeof object.groupId === 'string') {
			if (groupIds.has(object.groupId)) issues.push(issue(`${itemPath}/groupId`, 'value', 'Group result ids must be unique.'));
			groupIds.add(object.groupId);
		}
		oneOf(object.status, ['committed', 'failed', 'outcome-unknown'], `${itemPath}/status`, issues);
		if (object.resourceRevisions !== undefined) affectedResources(object.resourceRevisions, `${itemPath}/resourceRevisions`, issues);
		if (object.error !== undefined) structuredError(object.error, `${itemPath}/error`, issues);
		if (object.status === 'committed' && object.error !== undefined) issues.push(issue(`${itemPath}/error`, 'value', 'Committed group cannot contain an error.'));
		if ((object.status === 'failed' || object.status === 'outcome-unknown') && object.error === undefined) issues.push(issue(`${itemPath}/error`, 'required', 'Non-committed group requires an error.'));
		if (object.status !== 'committed' && object.resourceRevisions !== undefined) issues.push(issue(`${itemPath}/resourceRevisions`, 'value', 'Only committed groups publish revisions.'));
	});
}

function mutationPostflight(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isRecord(value)) {
		issues.push(issue(path, 'type', 'Expected a mutation postflight object.'));
		return;
	}
	if (value.status === 'verified') {
		const object = exactObject(value, path, ['status', 'observedAt', 'contextRevision'], issues);
		if (!object) return;
		isoTimestamp(object.observedAt, `${path}/observedAt`, issues);
		contextRevision(object.contextRevision, `${path}/contextRevision`, issues);
		return;
	}
	const object = exactObject(value, path, ['status'], issues);
	if (object) literal(object.status, 'receipt-replay', `${path}/status`, issues);
}

function mutationResultState(object: Record<string, unknown>, issues: DecodeIssueV1[]): void {
	const groups = Array.isArray(object.groupResults) ? object.groupResults.filter(isRecord) : [];
	const statuses = groups.map(group => group.status);
	const allCommitted = statuses.length > 0 && statuses.every(status => status === 'committed');
	const anyCommitted = statuses.some(status => status === 'committed');
	const anyFailed = statuses.some(status => status === 'failed');
	const anyUnknown = statuses.some(status => status === 'outcome-unknown');
	const receiptValue = isRecord(object.receipt) ? object.receipt : null;
	const continuation = isRecord(object.continuation) ? object.continuation : null;
	const postflight = isRecord(object.postflight) ? object.postflight : null;
	if (object.status === 'applied') {
		if (!allCommitted || object.mutationMayHaveApplied !== true || object.retryAllowed !== false || object.error !== undefined || continuation || object.ambiguitySource !== undefined || receiptValue?.terminalOutcome !== 'applied' || postflight?.status !== 'verified') issues.push(issue('/', 'value', 'Applied result requires committed groups, a matching receipt, and verified postflight.'));
	} else if (object.status === 'already-applied') {
		if (groups.length !== 0 || object.mutationMayHaveApplied !== true || object.retryAllowed !== false || object.error !== undefined || continuation || object.ambiguitySource !== undefined || receiptValue?.terminalOutcome !== 'already-applied' || postflight?.status !== 'receipt-replay') issues.push(issue('/', 'value', 'Already-applied result requires a matching receipt and receipt-replay postflight.'));
	} else if (object.status === 'partial') {
		if (!anyCommitted || !anyFailed || anyUnknown || object.mutationMayHaveApplied !== true || object.retryAllowed !== false || object.error === undefined || receiptValue || postflight || object.ambiguitySource !== undefined) issues.push(issue('/', 'value', 'Partial result state is inconsistent.'));
	} else if (object.status === 'failed') {
		if (anyCommitted || anyUnknown || object.mutationMayHaveApplied !== false || object.error === undefined || receiptValue || postflight || continuation || object.ambiguitySource !== undefined) issues.push(issue('/', 'value', 'Failed result state is inconsistent.'));
	} else if (object.status === 'outcome-unknown') {
		if (object.mutationMayHaveApplied !== true || object.retryAllowed !== false || object.error === undefined || continuation || (object.ambiguitySource !== 'group-outcome' && object.ambiguitySource !== 'receipt-persist-failure')) issues.push(issue('/', 'value', 'Outcome-unknown result state is inconsistent.'));
		if (object.ambiguitySource === 'group-outcome' && (!anyUnknown || groups.length === 0)) issues.push(issue('/groupResults', 'value', 'group-outcome requires an explicit unknown group.'));
		if (object.ambiguitySource === 'receipt-persist-failure' && (groups.length !== 0 || receiptValue || postflight?.status !== 'verified')) issues.push(issue('/', 'value', 'Receipt-persist failure requires empty groups and verified postflight.'));
	}
	let stopped = false;
	statuses.forEach((status, index) => {
		if (stopped) issues.push(issue(`/groupResults/${index}`, 'value', 'No group may follow a non-committed group.'));
		if (status !== 'committed') stopped = true;
	});
}

function compatibility(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['contractVersion', 'runtimeApi'], issues);
	if (!object) return;
	literal(object.contractVersion, 1, `${path}/contractVersion`, issues);
	const range = exactObject(object.runtimeApi, `${path}/runtimeApi`, ['min', 'max'], issues);
	if (range) {
		integer(range.min, `${path}/runtimeApi/min`, 1, Number.MAX_SAFE_INTEGER, issues);
		integer(range.max, `${path}/runtimeApi/max`, 1, Number.MAX_SAFE_INTEGER, issues);
		if (typeof range.min === 'number' && typeof range.max === 'number' && range.min > range.max) issues.push(issue(`${path}/runtimeApi`, 'value', 'Compatibility range is inverted.'));
	}
}

function compatibilitySelection(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['contractVersion', 'compatible', 'runtimeApi', 'error'], issues);
	if (!object) return;
	literal(object.contractVersion, 1, `${path}/contractVersion`, issues);
	boolean(object.compatible, `${path}/compatible`, issues);
	if (object.compatible === true) {
		literal(object.runtimeApi, 1, `${path}/runtimeApi`, issues);
		if (object.error !== undefined) issues.push(issue(`${path}/error`, 'value', 'Compatible selection cannot include an error.'));
	} else if (object.compatible === false) {
		if (object.runtimeApi !== undefined) issues.push(issue(`${path}/runtimeApi`, 'value', 'Incompatible selection cannot include a Runtime version.'));
		structuredError(object.error, `${path}/error`, issues);
	}
}

function freshness(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isRecord(value)) {
		issues.push(issue(path, 'type', 'Expected freshness evidence.'));
		return;
	}
	oneOf(value.source, ['live-runtime', 'persisted-index', 'source-file'], `${path}/source`, issues);
	oneOf(value.coherence, ['verified', 'settling', 'unverified'], `${path}/coherence`, issues);
	isoTimestamp(value.observedAt, `${path}/observedAt`, issues);
	boolean(value.settled, `${path}/settled`, issues);
}

function taskQueryPage(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['actualCount', 'returnedCount', 'truncated', 'nextCursor', 'asOf'], issues);
	if (!object) return;
	integer(object.actualCount, `${path}/actualCount`, 0, Number.MAX_SAFE_INTEGER, issues);
	integer(object.returnedCount, `${path}/returnedCount`, 0, Number.MAX_SAFE_INTEGER, issues);
	boolean(object.truncated, `${path}/truncated`, issues);
	isoTimestamp(object.asOf, `${path}/asOf`, issues);
	if (object.truncated === true) cursor(object.nextCursor, `${path}/nextCursor`, issues);
	else if (object.nextCursor !== undefined) issues.push(issue(`${path}/nextCursor`, 'value', 'Only a truncated page may include a cursor.'));
	if (typeof object.actualCount === 'number' && typeof object.returnedCount === 'number' && object.returnedCount > object.actualCount) issues.push(issue(path, 'value', 'Returned count cannot exceed actual count.'));
}

function taskContexts(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 250) {
		issues.push(issue(path, 'value', 'Expected a bounded task array.'));
		return;
	}
	value.forEach((candidate, index) => mergeIssues(
		decodeTaskContextV1(candidate),
		`${path}/${index}`,
		issues,
	));
}

function provenanceItems(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 1024) {
		issues.push(issue(path, 'value', 'Expected a bounded provenance array.'));
		return;
	}
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const object = exactObject(candidate, itemPath, ['path', 'source', 'revision', 'derived'], issues);
		if (!object) return;
		boundedString(object.path, `${itemPath}/path`, 1, 4096, issues);
		oneOf(object.source, ['live-runtime', 'persisted-index', 'source-file'], `${itemPath}/source`, issues);
		if (object.revision !== undefined) boundedString(object.revision, `${itemPath}/revision`, 0, 256, issues);
		boolean(object.derived, `${itemPath}/derived`, issues);
	});
}

function truncationItems(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 256) {
		issues.push(issue(path, 'value', 'Expected a bounded truncation array.'));
		return;
	}
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const object = exactObject(candidate, itemPath, ['path', 'actualCount', 'returnedCount', 'limit'], issues);
		if (!object) return;
		boundedString(object.path, `${itemPath}/path`, 1, 4096, issues);
		for (const key of ['actualCount', 'returnedCount', 'limit'] as const) integer(object[key], `${itemPath}/${key}`, 0, Number.MAX_SAFE_INTEGER, issues);
	});
}

function warnings(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 256) {
		issues.push(issue(path, 'value', 'Expected a bounded warning array.'));
		return;
	}
	value.forEach((candidate, index) => {
		const itemPath = `${path}/${index}`;
		const object = exactObject(candidate, itemPath, ['code', 'message', 'path'], issues);
		if (!object) return;
		if (typeof object.code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(object.code) || object.code.length > 128) issues.push(issue(`${itemPath}/code`, 'value', 'Expected a canonical warning code.'));
		trimmedString(object.message, `${itemPath}/message`, 1, 4096, issues);
		if (object.path !== undefined) trimmedString(object.path, `${itemPath}/path`, 1, 4096, issues);
	});
}

function structuredError(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = additiveResponseObject(value, path, issues);
	if (!object) return;
	literal(object.contractVersion, 1, `${path}/contractVersion`, issues);
	if (typeof object.code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(object.code)) issues.push(issue(`${path}/code`, 'value', 'Expected a canonical structured error code.'));
	trimmedString(object.reason, `${path}/reason`, 1, CONTRACT_LIMITS_V1.reasonBytes, issues);
	boolean(object.retryable, `${path}/retryable`, issues);
	oneOf(object.action, ERROR_ACTIONS_V1, `${path}/action`, issues);
	if (object.details !== undefined) plainObject(object.details, `${path}/details`, issues);
	if (typeof object.code === 'string') {
		const known = (STRUCTURED_ERROR_CODES_V1 as readonly string[]).includes(object.code);
		const policy = errorPolicyForCodeV1(object.code);
		if (known && (object.retryable !== policy.retryable || object.action !== policy.action)) {
			issues.push(issue(path || '/', 'value', 'Known structured errors must match the published action and retry policy.'));
		}
		if (!known && (object.retryable !== false || object.action !== 'do-not-retry')) {
			issues.push(issue(path || '/', 'value', 'Unknown structured errors must use the non-retryable do-not-retry fallback.'));
		}
	}
}

function additiveResponseObject(
	value: unknown,
	path: string,
	issues: DecodeIssueV1[],
): Record<string, unknown> | null {
	if (!isRecord(value)) {
		issues.push(issue(path || '/', 'type', 'Expected a plain object.'));
		return null;
	}
	for (const key of Object.keys(value)) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			issues.push(issue(`${path}/${key}`, 'prototype', 'Prototype keys are forbidden.'));
		}
	}
	return value;
}

function createReference(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	const object = exactObject(value, path, ['kind', 'operonId', 'itemRef'], issues);
	if (!object) return;
	if (object.kind === 'existing') {
		pattern(object.operonId, OPERON_ID, `${path}/operonId`, issues);
		if (object.itemRef !== undefined) issues.push(issue(`${path}/itemRef`, 'value', 'Existing reference cannot include itemRef.'));
	} else if (object.kind === 'created') {
		boundedToken(object.itemRef, `${path}/itemRef`, 1, 128, issues);
		if (object.operonId !== undefined) issues.push(issue(`${path}/operonId`, 'value', 'Created reference cannot include operonId.'));
	} else issues.push(issue(`${path}/kind`, 'value', 'Unknown create reference kind.'));
}

function referenceArray(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > 64) {
		issues.push(issue(path, 'value', 'References must be a bounded array.'));
		return;
	}
	for (let index = 0; index < value.length; index++) createReference(value[index], `${path}/${index}`, issues);
}

function mergeIssues<T>(result: DecodeResultV1<T>, prefix: string, issues: DecodeIssueV1[]): void {
	if (result.ok) return;
	for (const item of result.issues) issues.push({ ...item, path: item.path === '/' ? prefix : `${prefix}${item.path}` });
}

function plainObject(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (!isRecord(value)) issues.push(issue(path, 'type', 'Expected a plain object.'));
}

function objectArray(value: unknown, path: string, max: number, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > max || value.some(item => !isRecord(item))) issues.push(issue(path, 'value', 'Expected a bounded object array.'));
}

function stringArray(value: unknown, path: string, max: number, issues: DecodeIssueV1[]): void {
	if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string')) issues.push(issue(path, 'value', 'Expected a bounded string array.'));
}

function boolean(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'boolean') issues.push(issue(path, 'type', 'Expected a boolean.'));
}

function dateKey(value: unknown, path: string, issues: DecodeIssueV1[]): void {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		issues.push(issue(path, 'value', 'Expected a strict local YYYY-MM-DD date.'));
		return;
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
		issues.push(issue(path, 'value', 'Expected a valid local calendar date.'));
	}
}

function trimmedString(value: unknown, path: string, min: number, max: number, issues: DecodeIssueV1[]): void {
	boundedString(value, path, min, max, issues);
	if (typeof value === 'string' && value !== value.trim()) issues.push(issue(path, 'value', 'String must be trimmed.'));
}

function boundedToken(value: unknown, path: string, min: number, max: number, issues: DecodeIssueV1[]): void {
	boundedString(value, path, min, max, issues);
	if (typeof value === 'string' && !/^[A-Za-z0-9._:-]+$/u.test(value)) issues.push(issue(path, 'value', 'Expected a safe token.'));
}

function serializedCap(value: unknown, issues: DecodeIssueV1[]): void {
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined || utf8ByteLengthV1(serialized) > CONTRACT_LIMITS_V1.transportInputBytes) issues.push(issue('/', 'length', 'Serialized input exceeds the transport cap.'));
	} catch {
		issues.push(issue('/', 'value', 'Value is not serializable.'));
	}
}

function serializedResultCap(value: unknown, issues: DecodeIssueV1[]): void {
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined || utf8ByteLengthV1(serialized) > CONTRACT_LIMITS_V1.transportResultBytes) issues.push(issue('/', 'length', 'Serialized result exceeds the transport cap.'));
	} catch {
		issues.push(issue('/', 'value', 'Value is not serializable.'));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function issue(path: string, code: DecodeIssueV1['code'], message: string): DecodeIssueV1 {
	return { path, code, message };
}

function finish<T>(value: unknown, issues: DecodeIssueV1[]): DecodeResultV1<T> {
	return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
}
