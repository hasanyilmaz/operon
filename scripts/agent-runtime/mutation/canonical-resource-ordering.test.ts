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
			throw new Error('recurrence is not part of this regression');
		},
	};
}

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

test('canonical resource comparators use queue order and UTF-16 code units', () => {
	const keyPairs: ReadonlyArray<readonly [string, string]> = [
		['Projects/Roadmap.md', 'Projects/backend.md'],
		['Notes/B.md', 'Notes/a.md'],
		['Cases/Case 7 Summary.md', 'Cases/Case 7 — Notes.md'],
		['Notes/Zeta.md', 'Notes/Ångström.md'],
	];
	for (const [left, right] of keyPairs) {
		const expected = left < right ? -1 : left > right ? 1 : 0;
		assert.equal(Math.sign(compareResourceKeysCanonicalV1(left, right)), expected);
	}
	assert.equal(compareResourceKeysCanonicalV1('same', 'same'), 0);
	assert.equal(
		Math.sign(compareResourceReferencesCanonicalV1(
			{ resourceKind: 'task-source', resourceKey: CHILD_NOTE },
			{ resourceKind: 'task-source', resourceKey: PARENT_NOTE },
		)),
		1,
	);
	assert.equal(
		Math.sign(compareResourceReferencesCanonicalV1(
			{ resourceKind: 'repeat-series', resourceKey: 'zzz' },
			{ resourceKind: 'task-source', resourceKey: 'aaa' },
		)),
		-1,
	);
});

test('cross-note transition plans are canonical and pass V1 apply admission', async () => {
	const planned = await planCrossNoteCompletion();
	const sealedKeys = planned.affectedResources.map(resource => resource.resourceKey);
	assert.deepEqual(sealedKeys, [...sealedKeys].sort(compareResourceKeysCanonicalV1));

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
	const plan = {
		...unsealed,
		planHash: computeSealedMutationPlanHashV1(unsealed),
	};

	const admitted = decodeMutationApplyRequestV1({
		contractVersion: 1,
		requestId: 'repro-request-0001',
		kind: 'mutation-apply',
		plan,
		authorization: { basis: 'user-explicit-request', reason: 'Regression test.' },
		idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(
		admitted.ok,
		true,
		JSON.stringify(admitted.ok ? [] : admitted.issues, null, 2),
	);
});

test('plan-sealing surfaces do not order resource keys with localeCompare', () => {
	for (const file of [
		'main.ts',
		'src/agent-runtime/runtime/mutation-gateway.ts',
		'src/agent-runtime/runtime/semantic-transition.ts',
	]) {
		const source = readFileSync(file, 'utf8');
		assert.equal(source.includes('resourceKey.localeCompare'), false, file);
	}
});
