import type {
	OperonDeveloperApiAccessRequestV1,
	OperonDeveloperApiV1,
} from 'operon-cli/contracts/v1/developer-api';

export const ACCEPTANCE_INPUT_KIND_V1 = 'operon-developer-api-native-consumer-input';
export const ACCEPTANCE_OUTPUT_KIND_V1 = 'operon-developer-api-native-consumer-output';
export const ACCEPTANCE_VAULT_MARKER_KIND_V1 = 'operon-developer-api-native-fixture-vault';
export const ACCEPTANCE_RUNNER_DIRECTORY_V1 = 'native-acceptance-runner';
export const ACCEPTANCE_ROUTINE_INPUT_FILE_V1 = 'routine-input.json';
export const ACCEPTANCE_ROUTINE_OUTPUT_FILE_V1 = 'routine-output.json';
export const ACCEPTANCE_RECOVERY_INPUT_FILE_V1 = 'recovery-input.json';
export const ACCEPTANCE_RECOVERY_OUTPUT_FILE_V1 = 'recovery-output.json';

type ExactReadInputV1 = Parameters<OperonDeveloperApiV1['tasks']['get']>[0];
type MutationPreviewInputV1 = Parameters<OperonDeveloperApiV1['mutations']['preview']>[0];
type RequestedCapabilitiesV1 = OperonDeveloperApiAccessRequestV1['requestedCapabilities'];

interface RunnerInputBaseV1 {
	readonly contractVersion: 1;
	readonly kind: typeof ACCEPTANCE_INPUT_KIND_V1;
	readonly runId: string;
	readonly expectedConsumer: Readonly<{
		id: 'operon-developer-api-native-acceptance-consumer';
		version: string;
	}>;
	readonly fixtureVault: Readonly<{
		root: string;
		markerNonce: string;
	}>;
	readonly requestedCapabilities: RequestedCapabilitiesV1;
	readonly expectedTask: Readonly<{
		operonId: string;
		representation: 'inline' | 'file';
	}>;
	readonly expectedFinalState: Readonly<{
		note: string;
	}>;
}

export interface RoutineRunnerInputV1 extends RunnerInputBaseV1 {
	readonly phase: 'routine';
	readonly exactRead: ExactReadInputV1;
	readonly mutation: MutationPreviewInputV1;
}

export interface RecoveryRunnerInputV1 extends RunnerInputBaseV1 {
	readonly phase: 'recovery';
	readonly recoveryRef: string;
	readonly exactRead: ExactReadInputV1;
	readonly routineEvidence: Readonly<{
		runId: string;
		sha256: string;
		recoveryRef: string;
		planDigest: string;
		sessionId: string;
		instanceEpoch: string;
	}>;
}

export type AcceptanceRunnerInputV1 = RoutineRunnerInputV1 | RecoveryRunnerInputV1;

export interface AcceptanceErrorEvidenceV1 {
	readonly code: string;
	readonly retryable: boolean;
	readonly action: string;
}

export interface AcceptanceRunnerOutputV1 {
	readonly evidenceVersion: 1;
	readonly kind: typeof ACCEPTANCE_OUTPUT_KIND_V1;
	readonly runId: string;
	readonly phase: 'routine' | 'recovery' | 'unknown';
	readonly status: 'passed' | 'blocked' | 'failed';
	readonly completedAt: string;
	readonly registryIdentity?: Readonly<{
		exactInstance: boolean;
		forgedCopyRejected: boolean;
		forgedCopyErrorCode: string | null;
		consumerId: string | null;
		instanceEpoch: string | null;
	}>;
	readonly runtimeSessionId?: string;
	readonly baseline?: Readonly<{
		health: boolean;
		capabilities: boolean;
		lifecyclePhase: string | null;
		advertisedCapabilities: number;
	}>;
	readonly grant?: Readonly<{
		state: string | null;
		revision: number | null;
		requestedCapabilities: readonly string[];
		grantedCapabilities: readonly string[];
		effectiveCapabilities: readonly string[];
	}>;
	readonly exactRead?: Readonly<{
		ok: boolean;
		operonId: string | null;
		representation: string | null;
		sourceRevision: unknown;
		error?: AcceptanceErrorEvidenceV1;
	}>;
	readonly routine?: Readonly<{
		previewed: boolean;
		applied: boolean;
		replayed: boolean;
		writeFreeReplay: boolean;
		recoveryRef: string | null;
		planDigest: string | null;
		applyStatus: string | null;
		replayStatus: string | null;
		sourceRevisionStableAfterReplay: boolean;
		applyPlanDigestMatched: boolean;
		applyReceiptOutcomeMatched: boolean;
		replayPlanDigestMatched: boolean;
		applyPostflightVerified: boolean;
		replayPostflightVerified: boolean;
		finalStateVerified: boolean;
	}>;
	readonly recovery?: Readonly<{
		recoveryRef: string;
		planDigest: string;
		routineEvidenceSha256: string;
		listedPendingBefore: boolean;
		status: string;
		receiptReplayed: boolean;
		listedPendingAfter: boolean;
		receiptPlanDigestMatched: boolean;
		sessionChanged: boolean;
		instanceChanged: boolean;
		finalStateVerified: boolean;
	}>;
	readonly failClosed?: Readonly<{
		error: AcceptanceErrorEvidenceV1;
		writeAttempted: false;
	}>;
	readonly error?: Readonly<{
		code: string;
	}>;
}

export interface AcceptanceVaultMarkerV1 {
	readonly kind: typeof ACCEPTANCE_VAULT_MARKER_KIND_V1;
	readonly runId: string;
	readonly nonce: string;
}

export function parseRunnerInputV1(value: unknown): AcceptanceRunnerInputV1 {
	const object = requireRecord(value, 'input');
	requireExactKeys(
		object,
		object.phase === 'routine'
			? [
				'contractVersion',
				'kind',
				'runId',
				'phase',
				'expectedConsumer',
				'fixtureVault',
				'requestedCapabilities',
				'exactRead',
				'mutation',
				'expectedTask',
				'expectedFinalState',
			]
			: [
				'contractVersion',
				'kind',
				'runId',
				'phase',
				'expectedConsumer',
				'fixtureVault',
				'requestedCapabilities',
				'exactRead',
				'recoveryRef',
				'routineEvidence',
				'expectedTask',
				'expectedFinalState',
			],
		'input',
	);
	if (object.contractVersion !== 1 || object.kind !== ACCEPTANCE_INPUT_KIND_V1) {
		throw new Error('INPUT_CONTRACT_INVALID');
	}
	if (object.phase !== 'routine' && object.phase !== 'recovery') {
		throw new Error('INPUT_PHASE_INVALID');
	}
	requireToken(object.runId, 'runId');
	const expectedConsumer = requireRecord(object.expectedConsumer, 'expectedConsumer');
	requireExactKeys(expectedConsumer, ['id', 'version'], 'expectedConsumer');
	if (expectedConsumer.id !== 'operon-developer-api-native-acceptance-consumer') {
		throw new Error('INPUT_CONSUMER_ID_INVALID');
	}
	requireToken(expectedConsumer.version, 'expectedConsumer.version');
	const fixtureVault = requireRecord(object.fixtureVault, 'fixtureVault');
	requireExactKeys(fixtureVault, ['root', 'markerNonce'], 'fixtureVault');
	requireNonEmptyString(fixtureVault.root, 'fixtureVault.root');
	requireToken(fixtureVault.markerNonce, 'fixtureVault.markerNonce');
	if (!Array.isArray(object.requestedCapabilities) || object.requestedCapabilities.length === 0) {
		throw new Error('INPUT_CAPABILITIES_INVALID');
	}
	for (const capability of object.requestedCapabilities) {
		requireNonEmptyString(capability, 'requestedCapabilities[]');
	}
	const exactRead = requireRecord(object.exactRead, 'exactRead');
	const expectedTask = requireRecord(object.expectedTask, 'expectedTask');
	requireExactKeys(expectedTask, ['operonId', 'representation'], 'expectedTask');
	requireOperonId(expectedTask.operonId, 'expectedTask.operonId');
	if (expectedTask.representation !== 'inline' && expectedTask.representation !== 'file') {
		throw new Error('EXPECTEDTASK_REPRESENTATION_INVALID');
	}
	const expectedFinalState = requireRecord(object.expectedFinalState, 'expectedFinalState');
	requireExactKeys(expectedFinalState, ['note'], 'expectedFinalState');
	requireNonEmptyString(expectedFinalState.note, 'expectedFinalState.note');
	validateExactRead(exactRead, expectedTask.operonId);
	if (object.phase === 'routine') {
		const mutation = requireRecord(object.mutation, 'mutation');
		rejectNestedHostOwnedFields(mutation, 'mutation');
		validateRoutineMutation(mutation, expectedTask, expectedFinalState.note);
	} else {
		requireRecoveryRef(object.recoveryRef);
		const routineEvidence = requireRecord(object.routineEvidence, 'routineEvidence');
		requireExactKeys(
			routineEvidence,
			['runId', 'sha256', 'recoveryRef', 'planDigest', 'sessionId', 'instanceEpoch'],
			'routineEvidence',
		);
		if (routineEvidence.runId !== object.runId) throw new Error('ROUTINE_EVIDENCE_RUN_ID_INVALID');
		requireDigest(routineEvidence.sha256, 'routineEvidence.sha256');
		requireRecoveryRef(routineEvidence.recoveryRef);
		if (routineEvidence.recoveryRef !== object.recoveryRef) {
			throw new Error('ROUTINE_EVIDENCE_RECOVERY_REF_INVALID');
		}
		requireNonEmptyString(routineEvidence.planDigest, 'routineEvidence.planDigest');
		requireToken(routineEvidence.sessionId, 'routineEvidence.sessionId');
		requireToken(routineEvidence.instanceEpoch, 'routineEvidence.instanceEpoch');
	}
	return value as AcceptanceRunnerInputV1;
}

function validateExactRead(exactRead: Record<string, unknown>, expectedOperonId: unknown): void {
	requireExactKeys(
		exactRead,
		['contractVersion', 'requestId', 'kind', 'consistency', 'selector'],
		'exactRead',
	);
	if (
		exactRead.contractVersion !== 1
		|| exactRead.kind !== 'task-get'
		|| exactRead.consistency !== 'strict'
	) throw new Error('EXACTREAD_CONTRACT_INVALID');
	requireToken(exactRead.requestId, 'exactRead.requestId');
	const selector = requireRecord(exactRead.selector, 'exactRead.selector');
	requireExactKeys(selector, ['kind', 'operonId'], 'exactRead.selector');
	if (selector.kind !== 'operon-id' || selector.operonId !== expectedOperonId) {
		throw new Error('EXACTREAD_SELECTOR_INVALID');
	}
}

function validateRoutineMutation(
	mutation: Record<string, unknown>,
	expectedTask: Record<string, unknown>,
	expectedNote: unknown,
): void {
	requireExactKeys(
		mutation,
		['capability', 'mutationKind', 'target', 'spec'],
		'mutation',
	);
	if (
		mutation.capability !== 'tasks.update.preview'
		|| mutation.mutationKind !== 'task.update'
	) throw new Error('MUTATION_CONTRACT_INVALID');
	const target = requireRecord(mutation.target, 'mutation.target');
	requireExactKeys(target, ['operonId', 'locator'], 'mutation.target');
	if (target.operonId !== expectedTask.operonId) throw new Error('MUTATION_TARGET_INVALID');
	const locator = requireRecord(target.locator, 'mutation.target.locator');
	if (locator.representation !== expectedTask.representation) {
		throw new Error('MUTATION_TARGET_REPRESENTATION_INVALID');
	}
	const locatorKeys = locator.representation === 'inline'
		? ['representation', 'filePath', 'lineNumber']
		: ['representation', 'filePath'];
	requireExactKeys(locator, locatorKeys, 'mutation.target.locator');
	requireNonEmptyString(locator.filePath, 'mutation.target.locator.filePath');
	if (
		locator.representation === 'inline'
		&& (!Number.isSafeInteger(locator.lineNumber) || Number(locator.lineNumber) < 0)
	) throw new Error('MUTATION_TARGET_LINE_INVALID');
	const spec = requireRecord(mutation.spec, 'mutation.spec');
	requireExactKeys(spec, ['operation', 'changes'], 'mutation.spec');
	if (spec.operation !== 'update' || !Array.isArray(spec.changes) || spec.changes.length !== 1) {
		throw new Error('MUTATION_SPEC_INVALID');
	}
	const change = requireRecord(spec.changes[0], 'mutation.spec.changes[0]');
	requireExactKeys(change, ['field', 'valueType', 'value'], 'mutation.spec.changes[0]');
	if (
		change.field !== 'note'
		|| change.valueType !== 'text'
		|| change.value !== expectedNote
	) throw new Error('MUTATION_FINAL_STATE_BINDING_INVALID');
}

export function parseVaultMarkerV1(
	value: unknown,
	input: AcceptanceRunnerInputV1,
): AcceptanceVaultMarkerV1 {
	const marker = requireRecord(value, 'fixtureVaultMarker');
	requireExactKeys(marker, ['kind', 'runId', 'nonce'], 'fixtureVaultMarker');
	if (
		marker.kind !== ACCEPTANCE_VAULT_MARKER_KIND_V1
		|| marker.runId !== input.runId
		|| marker.nonce !== input.fixtureVault.markerNonce
	) {
		throw new Error('FIXTURE_VAULT_MARKER_INVALID');
	}
	return marker as unknown as AcceptanceVaultMarkerV1;
}

export function failedOutputV1(
	runId: string,
	phase: AcceptanceRunnerOutputV1['phase'],
	code: string,
): AcceptanceRunnerOutputV1 {
	return {
		evidenceVersion: 1,
		kind: ACCEPTANCE_OUTPUT_KIND_V1,
		runId,
		phase,
		status: 'failed',
		completedAt: new Date().toISOString(),
		error: { code },
	};
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${field.toUpperCase()}_INVALID`);
	}
	return value as Record<string, unknown>;
}

function requireExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
	field: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length
		|| actual.some((key, index) => key !== expected[index])
	) throw new Error(`${field.toUpperCase()}_KEYS_INVALID`);
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
		throw new Error(`${field.toUpperCase()}_INVALID`);
	}
}

function requireToken(value: unknown, field: string): asserts value is string {
	requireNonEmptyString(value, field);
	if (!/^[A-Za-z0-9._-]{1,160}$/u.test(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
}

function requireRecoveryRef(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !/^dvr1_[0-9a-f]{48}$/u.test(value)) {
		throw new Error('INPUT_RECOVERY_REF_INVALID');
	}
}

function requireOperonId(value: unknown, field: string): asserts value is string {
	if (
		typeof value !== 'string'
		|| !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
	) throw new Error(`${field.toUpperCase()}_INVALID`);
}

function requireDigest(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`${field.toUpperCase()}_INVALID`);
	}
}

const HOST_OWNED_MUTATION_KEYS = new Set([
	'acknowledgement',
	'authorization',
	'authority',
	'consent',
	'consumer',
	'consumerId',
	'correlationId',
	'grantToken',
	'idempotencyKey',
	'plan',
	'planDigest',
	'planRef',
	'recoveryRef',
	'requestId',
]);

function rejectNestedHostOwnedFields(value: unknown, field: string): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => rejectNestedHostOwnedFields(item, `${field}[${index}]`));
		return;
	}
	if (!value || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (
			HOST_OWNED_MUTATION_KEYS.has(key)
			|| key === '__proto__'
			|| key === 'constructor'
			|| key === 'prototype'
		) throw new Error('MUTATION_HOST_OWNED_FIELD_INVALID');
		rejectNestedHostOwnedFields(nested, `${field}.${key}`);
	}
}
