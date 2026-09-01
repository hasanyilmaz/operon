/**
 * Canonical resource ordering: planners and the decoder must agree (#200).
 *
 * The V1 decoder rejects any sealed plan whose `affectedResources` is not in
 * canonical (UTF-16 code unit) order. Any planner that sorts the same list with
 * `localeCompare` disagrees with it whenever two resource keys differ in letter
 * case, punctuation, or non-ASCII characters, and the plan it just sealed then
 * fails apply admission. These tests pin the shared comparators, drive the real
 * transition planner over a synthetic two-note task graph whose paths sort
 * differently under the two orders, and hand the sealed plan to
 * `decodeMutationApplyRequestV1` — the admission gate every apply passes through.
 *
 * Nothing here reads a vault. Both notes and all tasks are synthetic.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	sha256HexV1,
} from '../../../src/agent-runtime/contracts/v1/canonical';
import { decodeMutationApplyRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import {
	compareResourceKeysCanonicalV1,
	compareResourceReferencesCanonicalV1,
} from '../../../src/agent-runtime/contracts/v1/identity';
import type { SealedMutationPlanV1 } from '../../../src/agent-runtime/contracts/v1/mutation';
import {
	planRuntimeSemanticTransitionV1,
	type RuntimeSemanticTransitionPlannerPortsV1,
} from '../../../src/agent-runtime/runtime/semantic-transition';
import type {
	RuntimeExactTaskMutationSnapshotV1,
	RuntimeTaskFieldMutationPreparationV1,
} from '../../../src/agent-runtime/runtime/task-mutation-adapter';

const EFFECTIVE_AT = '2026-07-24T12:00:00.000Z';

/**
 * Two synthetic notes whose paths sort one way under ICU collation and the other
 * way under UTF-16 code units. Plain ASCII, differing only in letter case — the
 * trigger does not need an exotic character.
 *
 *   localeCompare : "Projects/backend.md" < "Projects/Roadmap.md"   (b before R)
 *   code units    : "Projects/Roadmap.md" < "Projects/backend.md"   (0x52 < 0x62)
 */
const CHILD_NOTE = 'Projects/backend.md';
const PARENT_NOTE = 'Projects/Roadmap.md';

function synthesizeTask(
	operonId: string,
	filePath: string,
	parentTask = '',
): RuntimeExactTaskMutationSnapshotV1 {
	return {
		operonId,
		locator: { representation: 'inline', filePath, lineNumber: 0 },
		description: operonId,
		checkbox: 'open',
		fieldValues: {
			status: 'Projects.Open',
			...(parentTask ? { parentTask } : {}),
		},
		tags: [],
		sourceContent: `- [ ] ${operonId} {{operonId:: ${operonId}}}\n`,
		duplicate: false,
	};
}

function synthesizePreparation(
	source: RuntimeExactTaskMutationSnapshotV1,
): RuntimeTaskFieldMutationPreparationV1 {
	return {
		kind: 'task-fields',
		operation: 'transition',
		task: source,
		fieldValues: {
			status: 'Projects.done',
			_checkbox: 'done',
			dateCompleted: '2026-07-24',
			dateCancelled: '',
			datetimeModified: '2026-07-24T14:00:00',
		},
		sourceRevision: sha256HexV1(source.sourceContent),
		targetDigest: sha256HexV1(source.operonId),
		summary: `Transition ${source.operonId}.`,
		noChange: false,
		...(source.fieldValues['parentTask']
			? { parentOperonId: source.fieldValues['parentTask'] }
			: {}),
		transition: {
			fromStatusId: 'status-open',
			toStatusId: 'status-done',
			fromCheckbox: 'open',
			toCheckbox: 'done',
			terminal: true,
			finalizeActiveTimer: false,
			materializeRecurrence: false,
			autoUnpin: false,
		},
	};
}

function synthesizePorts(
	tasks: readonly RuntimeExactTaskMutationSnapshotV1[],
): RuntimeSemanticTransitionPlannerPortsV1 {
	const byId = new Map(tasks.map(item => [item.operonId, item]));
	return {
		getTask: operonId => byId.get(operonId) ?? null,
		isPinned: () => false,
		hasProjectSerialScopes: () => false,
		stateRevisions: () => ({
			activeTracker: 'tracker-rev',
			repeatSeries: 'repeat-rev',
			pinned: 'pinned-rev',
			projectSerial: 'serial-rev',
		}),
		planRecurrence: () => {
			throw new Error('recurrence is not part of this reproduction');
		},
	};
}

/** A task in one note whose parent lives in another note. */
async function planCrossNoteCompletion() {
	const child = synthesizeTask('chi0001', CHILD_NOTE, 'par0001');
	const parent = synthesizeTask('par0001', PARENT_NOTE);
	const result = await planRuntimeSemanticTransitionV1(
		synthesizePreparation(child),
		EFFECTIVE_AT,
		synthesizePorts([child, parent]),
	);
	if (!result.ok) throw new Error(`planner refused the transition: ${result.reason}`);
	return result.value;
}

test('the two notes are a case where ICU collation and code-unit order disagree', () => {
	const icu = Math.sign(CHILD_NOTE.localeCompare(PARENT_NOTE));
	const codeUnits = CHILD_NOTE < PARENT_NOTE ? -1 : CHILD_NOTE > PARENT_NOTE ? 1 : 0;
	assert.notEqual(
		icu,
		codeUnits,
		'precondition: pick two paths that sort differently under the two orders',
	);
});

test('the planner seals affectedResources in the order the decoder demands', async () => {
	const plan = await planCrossNoteCompletion();
	const sealed = plan.affectedResources.map(resource => resource.resourceKey);
	const canonical = [...sealed].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	assert.deepEqual(
		sealed,
		canonical,
		'affectedResources must already be in code-unit order — the decoder re-derives it '
			+ 'and rejects the plan when it differs',
	);
});

test('an apply request carrying that plan passes V1 admission', async () => {
	const planned = await planCrossNoteCompletion();
	const idempotencyKey = 'repro-canonical-resource-ordering-0001';
	const targets = [{
		operonId: 'chi0001',
		locator: { representation: 'inline' as const, filePath: CHILD_NOTE, lineNumber: 0 },
		targetDigest: sha256HexV1('chi0001'),
	}];
	const unsealed: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: 'repro-plan-0001',
		planHash: '0'.repeat(64),
		clientInstanceId: 'repro',
		correlationId: 'repro-correlation-0001',
		idempotencyKeyHash: sha256HexV1(idempotencyKey),
		receiptTargetDigest: computeReceiptTargetDigestV1(targets),
		capability: 'tasks.transition.preview',
		mutationKind: 'task.transition',
		createdAt: EFFECTIVE_AT,
		expiresAt: new Date(Date.parse(EFFECTIVE_AT) + 60_000).toISOString(),
		targets,
		contextRevision: {
			index: { sessionId: 'repro-session', ramGeneration: 1, durable: { status: 'unavailable' } },
			settingsFingerprint: sha256HexV1('repro-settings'),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: sha256HexV1(''),
		},
		affectedResources: planned.affectedResources,
		atomicGroups: planned.atomicGroups,
		predictedEffects: planned.predictedEffects,
		riskLevel: 'elevated',
		requiresConfirmation: false,
		requiredAcknowledgements: [],
		warnings: [],
		spec: {
			operation: 'transition',
			targetStatusId: 'status-done',
			expectedStatusId: 'status-open',
		},
	} as unknown as SealedMutationPlanV1;
	const plan: SealedMutationPlanV1 = {
		...unsealed,
		planHash: computeSealedMutationPlanHashV1(unsealed),
	};

	const admitted = decodeMutationApplyRequestV1({
		contractVersion: 1,
		requestId: 'repro-request-0001',
		kind: 'mutation-apply',
		plan,
		authorization: { basis: 'user-explicit-request', reason: 'Reproduction.' },
		idempotencyKey,
		acknowledgements: [],
	});

	assert.equal(
		admitted.ok,
		true,
		'apply admission rejected the plan the planner just sealed. Issues: '
			+ JSON.stringify(admitted.ok ? [] : admitted.issues, null, 2),
	);
});

test('the shared comparator orders keys by code units for pairs where ICU disagrees', () => {
	const divergentPairs: ReadonlyArray<readonly [string, string]> = [
		['Projects/Roadmap.md', 'Projects/backend.md'],
		['Notes/B.md', 'Notes/a.md'],
		['Cases/Case 7 Summary.md', 'Cases/Case 7 \u2014 Notes.md'],
		['Notes/Zeta.md', 'Notes/\u00c5ngstr\u00f6m.md'],
	];
	for (const [left, right] of divergentPairs) {
		const codeUnits = left < right ? -1 : left > right ? 1 : 0;
		assert.equal(
			Math.sign(compareResourceKeysCanonicalV1(left, right)),
			codeUnits,
			`comparator must use code-unit order for ${left} vs ${right}`,
		);
		assert.notEqual(
			Math.sign(left.localeCompare(right)),
			codeUnits,
			`precondition: ${left} vs ${right} must diverge under ICU collation`,
		);
	}
	assert.equal(
		Math.sign(compareResourceReferencesCanonicalV1(
			{ resourceKind: 'task-source', resourceKey: 'Projects/Roadmap.md' },
			{ resourceKind: 'task-source', resourceKey: 'Projects/backend.md' },
		)),
		-1,
		'reference comparator delegates key comparison to code-unit order',
	);
	assert.equal(
		Math.sign(compareResourceReferencesCanonicalV1(
			{ resourceKind: 'repeat-series', resourceKey: 'zzz' },
			{ resourceKind: 'task-source', resourceKey: 'aaa' },
		)),
		-1,
		'reference comparator keeps resource-kind queue order ahead of key order',
	);
});

test('no plan-sealing sort orders resource keys with localeCompare', () => {
	for (const file of [
		'main.ts',
		'src/agent-runtime/runtime/mutation-gateway.ts',
		'src/agent-runtime/runtime/semantic-transition.ts',
	]) {
		const source = readFileSync(file, 'utf8');
		assert.equal(
			source.includes('resourceKey.localeCompare'),
			false,
			`${file} must sort resource references with the shared canonical comparator`,
		);
	}
});
