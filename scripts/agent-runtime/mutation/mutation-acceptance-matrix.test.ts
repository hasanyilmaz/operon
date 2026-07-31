import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	CAPABILITY_REGISTRY_V1,
	COMPLETE_MUTATION_ACCEPTANCE_MATRIX_V1,
	MUTATION_ACCEPTANCE_MATRIX_V1,
	MUTATION_CAPABILITY_MAP_V1,
	MUTATION_KINDS_V1,
	isCompleteMutationAcceptanceDefinitionV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	classifyTimerControlRecoveryPrefixV1,
} from '../../../src/agent-runtime/runtime/receipts/graph-transaction-journal';

test('Public V1 mutation acceptance matrix covers every family and capability pair exactly once', () => {
	assert.deepEqual(
		MUTATION_ACCEPTANCE_MATRIX_V1.map(definition => definition.mutationKind),
		MUTATION_KINDS_V1,
	);
	assert.equal(new Set(
		MUTATION_ACCEPTANCE_MATRIX_V1.map(definition => definition.mutationKind),
	).size, 12);

	const matrixCapabilities = MUTATION_ACCEPTANCE_MATRIX_V1.flatMap(definition => [
		definition.capabilities.preview,
		definition.capabilities.apply,
	]);
	assert.equal(matrixCapabilities.length, 24);
	assert.equal(new Set(matrixCapabilities).size, 24);
	assert.deepEqual(
		matrixCapabilities,
		CAPABILITY_REGISTRY_V1
			.filter(definition => definition.mutationKind !== undefined)
			.map(definition => definition.id),
	);

	for (const definition of MUTATION_ACCEPTANCE_MATRIX_V1) {
		assert.deepEqual(
			definition.capabilities,
			MUTATION_CAPABILITY_MAP_V1[definition.mutationKind],
		);
		assert.ok(definition.operations.length > 0);
		for (const operation of definition.operations) {
			assert.ok(operation.operation.length > 0);
			assert.ok(operation.risks.length > 0);
			assert.deepEqual(
				Object.keys(operation.consentByRisk).sort(),
				[...operation.risks].sort(),
			);
			for (const risk of operation.risks) {
				assert.equal(
					operation.consentByRisk[risk],
					risk === 'routine' ? 'standing-grant' : 'fresh-user-confirmation',
				);
			}
		}
		assert.ok(definition.postflight.length > 0);
		assert.equal(definition.entrypoints.cli.preview, 'mutation-intent');
		assert.equal(definition.entrypoints.cli.apply, 'mutation-plan-reference');
		assert.equal(definition.entrypoints.developerApi.preview, 'developer-mutation-preview-input');
		assert.equal(definition.entrypoints.developerApi.apply, 'developer-mutation-apply-input');
		assert.equal(definition.receiptValidatorId, 'mutation-result');
		assert.equal(definition.postflightValidatorId, 'mutation-result');
		assert.equal(definition.postflight.includes(definition.exactFinalStateAssertionId), true);
		assert.deepEqual(definition.channels, ['cli', 'developer-api']);
		assert.equal(definition.admission, 'candidate-stable');
	}
	assert.equal(COMPLETE_MUTATION_ACCEPTANCE_MATRIX_V1.length, 12);
});

test('matrix bindings resolve to canonical schema registries and reject fabricated bindings', () => {
	const runtimeManifest = JSON.parse(
		readFileSync('contracts/agent-runtime/v1/schema-manifest.json', 'utf8'),
	) as { entrypoints: Array<{ schemaId: string }> };
	const cliManifest = JSON.parse(
		readFileSync('packages/operon-cli/cli-manifest-v1.json', 'utf8'),
	) as { schemaEntrypoints: Array<{ schemaId: string }> };
	const runtimeEntrypoints = new Set(runtimeManifest.entrypoints.map(item => item.schemaId));
	const cliEntrypoints = new Set(cliManifest.schemaEntrypoints.map(item => item.schemaId));
	for (const definition of MUTATION_ACCEPTANCE_MATRIX_V1) {
		assert.equal(cliEntrypoints.has(definition.entrypoints.cli.preview), true);
		assert.equal(cliEntrypoints.has(definition.entrypoints.cli.apply), true);
		assert.equal(runtimeEntrypoints.has(definition.entrypoints.developerApi.preview), true);
		assert.equal(runtimeEntrypoints.has(definition.entrypoints.developerApi.apply), true);
		assert.equal(runtimeEntrypoints.has(definition.receiptValidatorId), true);
		assert.equal(runtimeEntrypoints.has(definition.postflightValidatorId), true);
	}

	const fabricated = {
		...MUTATION_ACCEPTANCE_MATRIX_V1[0],
		receiptValidatorId: 'runtime.v1.receipt.fabricated',
	};
	assert.equal(isCompleteMutationAcceptanceDefinitionV1(fabricated), false);
	const missingConsent = {
		...MUTATION_ACCEPTANCE_MATRIX_V1[0],
		operations: [{
			...MUTATION_ACCEPTANCE_MATRIX_V1[0].operations[0],
			consentByRisk: {},
		}],
	};
	assert.equal(isCompleteMutationAcceptanceDefinitionV1(missingConsent), false);
});

test('Public V1 target, risk, recovery, and postflight admission remains explicit', () => {
	const byKind = new Map(
		MUTATION_ACCEPTANCE_MATRIX_V1.map(definition => [definition.mutationKind, definition]),
	);
	const operation = (kind: Parameters<typeof byKind.get>[0], name: string) => (
		byKind.get(kind)?.operations.find(candidate => candidate.operation === name)
	);
	assert.equal(operation('task.create', 'create')?.target, 'forbidden');
	assert.equal(operation('task.update', 'update')?.target, 'required');
	assert.equal(operation('task.update', 'update-batch')?.target, 'forbidden');
	assert.equal(operation('timer.control', 'start')?.target, 'optional');
	assert.equal(operation('task.delete', 'delete')?.target, 'required');
	assert.deepEqual(operation('task.delete', 'delete')?.risks, ['destructive']);
	assert.deepEqual(operation('task.convert', 'convert')?.risks, ['elevated', 'destructive']);
	assert.deepEqual(operation('task.create', 'create')?.risks, ['routine', 'elevated']);
	assert.equal(byKind.get('task.pinned-state')?.recovery, 'compare-and-set');
	assert.equal(
		byKind.get('task.reminder-item')?.postflight.includes('reminder-state-and-scheduler'),
		true,
	);
	assert.equal(
		byKind.get('timer.control')?.postflight.includes('active-tracker-and-task-state'),
		true,
	);
});

test('live Runtime published mutation capabilities derive from the compact capability registry', () => {
	const mainSource = readFileSync('main.ts', 'utf8');
	assert.match(
		mainSource,
		/AGENT_RUNTIME_PUBLISHED_MUTATION_CAPABILITIES\s*=\s*new Set<CapabilityIdV1>\(\s*CAPABILITY_REGISTRY_V1\s*\.filter/u,
	);
	assert.doesNotMatch(
		mainSource,
		/AGENT_RUNTIME_PUBLISHED_MUTATION_CAPABILITIES\s*=\s*new Set<CapabilityIdV1>\(\s*\[/u,
	);
});

test('indexed aggregate refreshes queue and retry when the Runtime fence is busy', () => {
	const mainSource = readFileSync('main.ts', 'utf8');
	const handlerStart = mainSource.indexOf('private async handleTasksRemovedFromIndex');
	const handlerEnd = mainSource.indexOf('private refreshViews', handlerStart);
	assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
	const handlerSource = mainSource.slice(handlerStart, handlerEnd);
	assert.match(
		handlerSource,
		/this\.refreshAggregateStateAfterTaskRemovalWhenSafe\(removedTasks\)/u,
	);

	assert.match(mainSource, /pendingAggregateIndexedChanges = new Map/u);
	assert.match(mainSource, /pendingAggregateRemovedTasks = new Map/u);
	const drainStart = mainSource.indexOf('private async drainPendingAggregateRefreshesWhenSafe');
	const drainEnd = mainSource.indexOf('private async handleIndexedTasksChanged', drainStart);
	assert.ok(drainStart >= 0 && drainEnd > drainStart);
	const drainSource = mainSource.slice(drainStart, drainEnd);
	assert.match(drainSource, /tryWithRuntimeVaultMutationLockV1\(/u);
	assert.match(drainSource, /receiptStore\.hasUnresolvedGraphTransaction\(\)/u);
	assert.match(drainSource, /restorePending\(\)/u);
	assert.match(drainSource, /schedulePendingAggregateRefreshRetry\(\)/u);
	assert.match(drainSource, /refreshAfterTaskMutations\(changes\)/u);
	assert.match(drainSource, /refreshAfterTaskRemoval\(removedTasks\)/u);
});

test('timer switch recovery recognizes every exact ordered crash boundary', () => {
	for (let completedStepCount = 0; completedStepCount <= 3; completedStepCount += 1) {
		assert.deepEqual(
			classifyTimerControlRecoveryPrefixV1([
				...Array.from({ length: completedStepCount }, () => 'after' as const),
				...Array.from({ length: 3 - completedStepCount }, () => 'before' as const),
			]),
			{ status: 'ordered-prefix', completedStepCount },
		);
	}
	for (const thirdState of [
		classifyTimerControlRecoveryPrefixV1(['other', 'before', 'before']),
		classifyTimerControlRecoveryPrefixV1(['after', 'other', 'before']),
		classifyTimerControlRecoveryPrefixV1(['after', 'before', 'after']),
	]) {
		assert.deepEqual(thirdState, { status: 'outcome-unknown' });
	}
});
