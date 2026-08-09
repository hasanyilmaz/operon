import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITY_REGISTRY_V1, MUTATION_KINDS_V1 } from '../../../src/agent-runtime/contracts/v1';
import {
	TASK_WORKFLOW_CAPABILITY_REGISTRY_V1,
} from '../../../src/agent-runtime/extensions/task-workflows-v1/contracts';
import {
	CANDIDATE_CAPABILITY_SENTINELS_V1,
	REQUIRED_CANDIDATE_MUTATION_CAPABILITIES_V1,
	evaluateCandidateCapabilitySmokeV1,
	requiredCandidateMutationCapabilitiesV1,
	type CandidateCapabilityAdvertisementV1,
	type CandidateCapabilitySmokeInputV1,
} from './candidate-capability-smoke';

const digest = (character: string) => character.repeat(64);
const availableAdvertisements = (): CandidateCapabilityAdvertisementV1[] => [
	...CAPABILITY_REGISTRY_V1,
	...TASK_WORKFLOW_CAPABILITY_REGISTRY_V1,
].map(definition => ({ id: definition.id, availability: 'available' }));

function input(
	overrides: Partial<CandidateCapabilitySmokeInputV1> = {},
): CandidateCapabilitySmokeInputV1 {
	const artifacts = [
		{ path: 'main.js' as const, bytes: 4_000_000, sha256: digest('b') },
		{ path: 'manifest.json' as const, bytes: 500, sha256: digest('c') },
		{ path: 'styles.css' as const, bytes: 100_000, sha256: digest('d') },
	];
	const cli = {
		package: '@stratejya/operon-cli@1.1.0',
		tarballSha256: digest('e'),
		runtimeContractDigest: digest('f'),
		bindingFileSha256: digest('1'),
		bindingAggregateSha256: digest('2'),
	};
	return {
		candidateCommit: 'a'.repeat(40),
		observedCandidateCommit: 'a'.repeat(40),
		artifacts,
		installedArtifacts: artifacts.map(artifact => ({ ...artifact })),
		cli,
		observedCli: { ...cli },
		previousSessionId: 'runtime-before',
		deadlineMs: 30_000,
		observations: [{
			elapsedMs: 1_000,
			sessionId: 'runtime-after',
			lifecyclePhase: 'ready',
			v8PersistencePhase: 'idle',
			healthOk: true,
			advertisements: availableAdvertisements(),
		}],
		...overrides,
	};
}

function unavailable(id: string, reason = 'Gateway startup unavailable: receipt-store:operation-failed.') {
	return availableAdvertisements().map(advertisement => (
		advertisement.id === id
			? { ...advertisement, availability: 'unavailable' as const, reason }
			: advertisement
	));
}

test('candidate capability smoke derives required mutation surfaces from both registries', () => {
	assert.deepEqual(
		REQUIRED_CANDIDATE_MUTATION_CAPABILITIES_V1,
		[
			...CAPABILITY_REGISTRY_V1.filter(definition => definition.mutationKind !== undefined),
			...TASK_WORKFLOW_CAPABILITY_REGISTRY_V1.filter(definition => definition.mode !== 'read'),
		].map(definition => definition.id),
	);
	for (const sentinel of CANDIDATE_CAPABILITY_SENTINELS_V1) {
		assert.equal((REQUIRED_CANDIDATE_MUTATION_CAPABILITIES_V1 as readonly string[]).includes(sentinel), true);
	}
	assert.equal(MUTATION_KINDS_V1.includes('task.adopt' as never), false);
	assert.equal(CAPABILITY_REGISTRY_V1.some(definition => definition.id.startsWith('tasks.adopt.')), false);
	assert.equal(TASK_WORKFLOW_CAPABILITY_REGISTRY_V1.some(definition => definition.id === 'tasks.adopt.apply'), true);

	const additive = requiredCandidateMutationCapabilitiesV1(
		[...CAPABILITY_REGISTRY_V1, { id: 'tasks.future.apply', mode: 'apply', mutationKind: 'task.future' }],
		[
			...TASK_WORKFLOW_CAPABILITY_REGISTRY_V1,
			{ id: 'tasks.extension-future.preview', mode: 'preview', mutationKind: 'task.future' },
			{ id: 'tasks.extension-future.read', mode: 'read' },
		],
	);
	assert.equal(additive.includes('tasks.future.apply'), true);
	assert.equal(additive.includes('tasks.extension-future.preview'), true);
	assert.equal(additive.includes('tasks.extension-future.read'), false);
});

test('candidate capability smoke accepts exact new-session ready evidence', () => {
	const result = evaluateCandidateCapabilitySmokeV1(input());
	assert.equal(result.ok, true);
	assert.equal(result.reason, 'ready');
	assert.deepEqual(result.identityMatches, {
		candidateCommit: true,
		artifacts: true,
		cli: true,
	});
	assert.equal(result.sessionId, 'runtime-after');
	assert.equal(result.missingCapabilities.length, 0);
	assert.equal(result.unavailableCapabilities.length, 0);
});

test('candidate capability smoke rejects ready health when a core mutation Gateway is unavailable', () => {
	const result = evaluateCandidateCapabilitySmokeV1(input({
		observations: [{
			...input().observations[0],
			advertisements: unavailable('tasks.create.apply'),
		}],
	}));
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'capabilities-timeout');
	assert.deepEqual(result.unavailableCapabilities.map(item => item.id), ['tasks.create.apply']);
	assert.match(result.unavailableCapabilities[0]?.reason ?? '', /receipt-store/u);
});

for (const capability of [
	'tasks.adopt.apply',
	'tasks.create.identity-placeholders',
]) {
	test(`candidate capability smoke rejects unavailable ${capability}`, () => {
		const result = evaluateCandidateCapabilitySmokeV1(input({
			observations: [{
				...input().observations[0],
				advertisements: unavailable(capability),
			}],
		}));
		assert.equal(result.ok, false);
		assert.deepEqual(result.unavailableCapabilities.map(item => item.id), [capability]);
	});
}

test('candidate capability smoke accepts a transient unavailable state that recovers within deadline', () => {
	const result = evaluateCandidateCapabilitySmokeV1(input({
		observations: [
			{
				...input().observations[0],
				elapsedMs: 250,
				advertisements: unavailable('tasks.update.apply'),
			},
			{ ...input().observations[0], elapsedMs: 1_500 },
		],
	}));
	assert.equal(result.ok, true);
	assert.equal(result.elapsedMs, 1_500);
});

test('candidate capability smoke rejects loading, stale-session, duplicate, and deadline evidence', () => {
	const observations = [
		{ ...input().observations[0], elapsedMs: 100, lifecyclePhase: 'loading' },
		{ ...input().observations[0], elapsedMs: 150, sessionId: undefined },
		{ ...input().observations[0], elapsedMs: 200, sessionId: 'runtime-before' },
		{
			...input().observations[0],
			elapsedMs: 300,
			advertisements: [
				...availableAdvertisements(),
				{ id: 'tasks.create.apply', availability: 'available' as const },
			],
		},
		{ ...input().observations[0], elapsedMs: 30_001 },
	];
	const result = evaluateCandidateCapabilitySmokeV1(input({ observations }));
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'capabilities-timeout');
	assert.equal(result.lastObservationFailure, 'deadline-exceeded');
	assert.deepEqual(result.missingCapabilities, []);
});

test('candidate capability smoke rejects stale or incomplete artifact and CLI identity', () => {
	assert.equal(evaluateCandidateCapabilitySmokeV1(input({ candidateCommit: 'short' })).reason, 'identity-invalid');
	assert.equal(evaluateCandidateCapabilitySmokeV1(input({
		artifacts: input().artifacts.slice(0, 2),
	})).reason, 'identity-invalid');
	assert.equal(evaluateCandidateCapabilitySmokeV1(input({
		cli: { ...input().cli, package: '@stratejya/operon-cli@1.0.0' },
	})).reason, 'identity-invalid');
	const commitMismatch = evaluateCandidateCapabilitySmokeV1(input({
		observedCandidateCommit: '9'.repeat(40),
	}));
	assert.equal(commitMismatch.reason, 'identity-invalid');
	assert.equal(commitMismatch.identityMatches.candidateCommit, false);
	const artifactMismatch = evaluateCandidateCapabilitySmokeV1(input({
		installedArtifacts: input().installedArtifacts.map(artifact => (
			artifact.path === 'main.js' ? { ...artifact, sha256: digest('9') } : artifact
		)),
	}));
	assert.equal(artifactMismatch.reason, 'identity-invalid');
	assert.equal(artifactMismatch.identityMatches.artifacts, false);
	const cliMismatch = evaluateCandidateCapabilitySmokeV1(input({
		observedCli: { ...input().observedCli, tarballSha256: digest('9') },
	}));
	assert.equal(cliMismatch.reason, 'identity-invalid');
	assert.equal(cliMismatch.identityMatches.cli, false);
	const bindingMismatch = evaluateCandidateCapabilitySmokeV1(input({
		observedCli: { ...input().observedCli, bindingFileSha256: digest('9') },
	}));
	assert.equal(bindingMismatch.reason, 'identity-invalid');
	assert.equal(bindingMismatch.identityMatches.cli, false);
});

test('candidate capability smoke rejects non-monotonic observation evidence', () => {
	const result = evaluateCandidateCapabilitySmokeV1(input({
		observations: [
			{ ...input().observations[0], elapsedMs: 2_000, lifecyclePhase: 'loading' },
			{ ...input().observations[0], elapsedMs: 1_000 },
		],
	}));
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'identity-invalid');
});
