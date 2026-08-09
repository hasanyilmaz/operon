import { CAPABILITY_REGISTRY_V1 } from '../../../src/agent-runtime/contracts/v1';
import { TASK_WORKFLOW_CAPABILITY_REGISTRY_V1 } from '../../../src/agent-runtime/extensions/task-workflows-v1/contracts';

type CapabilityDefinition = {
	readonly id: string;
	readonly mode: 'read' | 'preview' | 'apply';
	readonly mutationKind?: string;
};

export interface CandidateCapabilityAdvertisementV1 {
	readonly id: string;
	readonly availability: 'contract-only' | 'available' | 'degraded' | 'unavailable';
	readonly reason?: string;
}

export interface CandidateCapabilityObservationV1 {
	readonly elapsedMs: number;
	readonly sessionId?: string;
	readonly lifecyclePhase?: string;
	readonly v8PersistencePhase?: string;
	readonly healthOk?: boolean;
	readonly advertisements?: readonly CandidateCapabilityAdvertisementV1[];
}

export interface CandidateArtifactIdentityV1 {
	readonly candidateCommit: string;
	readonly artifacts: readonly {
		readonly path: 'main.js' | 'manifest.json' | 'styles.css';
		readonly bytes: number;
		readonly sha256: string;
	}[];
	readonly cli: {
		readonly package: string;
		readonly tarballSha256: string;
		readonly runtimeContractDigest: string;
		readonly bindingFileSha256: string;
		readonly bindingAggregateSha256: string;
	};
}

export interface CandidateCapabilitySmokeInputV1 extends CandidateArtifactIdentityV1 {
	readonly observedCandidateCommit: string;
	readonly installedArtifacts: CandidateArtifactIdentityV1['artifacts'];
	readonly observedCli: CandidateArtifactIdentityV1['cli'];
	readonly previousSessionId: string;
	readonly deadlineMs: number;
	readonly observations: readonly CandidateCapabilityObservationV1[];
}

export interface CandidateCapabilitySmokeResultV1 extends CandidateArtifactIdentityV1 {
	readonly ok: boolean;
	readonly reason: 'ready' | 'identity-invalid' | 'capabilities-timeout';
	readonly scope: 'published-core-and-task-workflow-mutation-capabilities';
	readonly identityMatches: {
		readonly candidateCommit: boolean;
		readonly artifacts: boolean;
		readonly cli: boolean;
	};
	readonly deadlineMs: number;
	readonly requiredCapabilities: readonly string[];
	readonly sessionId?: string;
	readonly elapsedMs?: number;
	readonly missingCapabilities: readonly string[];
	readonly unavailableCapabilities: readonly {
		readonly id: string;
		readonly availability: CandidateCapabilityAdvertisementV1['availability'];
		readonly reason?: string;
	}[];
	readonly lastObservationFailure?:
		| 'no-observations'
		| 'deadline-exceeded'
		| 'session-missing'
		| 'stale-session'
		| 'health-not-ready'
		| 'lifecycle-not-ready'
		| 'persistence-not-idle'
		| 'advertisements-missing'
		| 'advertisements-duplicate'
		| 'capabilities-incomplete';
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const REQUIRED_ARTIFACT_PATHS = Object.freeze(['main.js', 'manifest.json', 'styles.css'] as const);

export function requiredCandidateMutationCapabilitiesV1(
	coreRegistry: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY_V1,
	extensionRegistry: readonly CapabilityDefinition[] = TASK_WORKFLOW_CAPABILITY_REGISTRY_V1,
): readonly string[] {
	return Object.freeze([
		...coreRegistry
			.filter(definition => definition.mutationKind !== undefined)
			.map(definition => definition.id),
		...extensionRegistry
			.filter(definition => definition.mode !== 'read')
			.map(definition => definition.id),
	]);
}

export const REQUIRED_CANDIDATE_MUTATION_CAPABILITIES_V1: readonly string[] =
	requiredCandidateMutationCapabilitiesV1();

export const CANDIDATE_CAPABILITY_SENTINELS_V1 = Object.freeze([
	'tasks.create.apply',
	'tasks.update.apply',
	'tasks.create.identity-placeholders',
	'tasks.adopt.preview',
	'tasks.adopt.apply',
]);

export function evaluateCandidateCapabilitySmokeV1(
	input: CandidateCapabilitySmokeInputV1,
): CandidateCapabilitySmokeResultV1 {
	const requiredCapabilities = REQUIRED_CANDIDATE_MUTATION_CAPABILITIES_V1;
	if (!isCandidateIdentityValid(input)) {
		return failure(input, requiredCapabilities, 'identity-invalid', [], []);
	}

	let previousElapsedMs = -1;
	let finalMissing: readonly string[] = [];
	let finalUnavailable: CandidateCapabilitySmokeResultV1['unavailableCapabilities'] = [];
	let lastObservationFailure: CandidateCapabilitySmokeResultV1['lastObservationFailure'] = 'no-observations';
	for (const observation of input.observations) {
		if (Number.isSafeInteger(observation.elapsedMs) && observation.elapsedMs < previousElapsedMs) {
			return failure(input, requiredCapabilities, 'identity-invalid', [], []);
		}
		if (Number.isSafeInteger(observation.elapsedMs)) previousElapsedMs = observation.elapsedMs;
		if (
			!Number.isSafeInteger(observation.elapsedMs)
			|| observation.elapsedMs < 0
			|| observation.elapsedMs > input.deadlineMs
		) {
			lastObservationFailure = 'deadline-exceeded';
			continue;
		}
		if (typeof observation.sessionId !== 'string' || observation.sessionId.length === 0) {
			lastObservationFailure = 'session-missing';
			continue;
		}
		if (observation.sessionId === input.previousSessionId) {
			lastObservationFailure = 'stale-session';
			continue;
		}
		if (observation.healthOk !== true) {
			lastObservationFailure = 'health-not-ready';
			continue;
		}
		if (observation.lifecyclePhase !== 'ready') {
			lastObservationFailure = 'lifecycle-not-ready';
			continue;
		}
		if (observation.v8PersistencePhase !== 'idle') {
			lastObservationFailure = 'persistence-not-idle';
			continue;
		}
		if (!Array.isArray(observation.advertisements)) {
			lastObservationFailure = 'advertisements-missing';
			continue;
		}

		const advertisements = new Map<string, CandidateCapabilityAdvertisementV1>();
		let duplicate = false;
		for (const advertisement of observation.advertisements) {
			if (advertisements.has(advertisement.id)) duplicate = true;
			advertisements.set(advertisement.id, advertisement);
		}
		if (duplicate) {
			lastObservationFailure = 'advertisements-duplicate';
			continue;
		}

		finalMissing = requiredCapabilities.filter(id => !advertisements.has(id));
		finalUnavailable = requiredCapabilities.flatMap(id => {
			const advertisement = advertisements.get(id);
			if (!advertisement || advertisement.availability === 'available') return [];
			return [{
				id,
				availability: advertisement.availability,
				...(advertisement.reason === undefined ? {} : { reason: advertisement.reason }),
			}];
		});
		if (finalMissing.length === 0 && finalUnavailable.length === 0) {
			return {
				ok: true,
				reason: 'ready',
				scope: 'published-core-and-task-workflow-mutation-capabilities',
				identityMatches: identityMatchProof(input),
				candidateCommit: input.candidateCommit,
				artifacts: input.artifacts,
				cli: input.cli,
				deadlineMs: input.deadlineMs,
				requiredCapabilities,
				sessionId: observation.sessionId,
				elapsedMs: observation.elapsedMs,
				missingCapabilities: [],
				unavailableCapabilities: [],
			};
		}
		lastObservationFailure = 'capabilities-incomplete';
	}
	return failure(
		input,
		requiredCapabilities,
		'capabilities-timeout',
		finalMissing,
		finalUnavailable,
		lastObservationFailure,
	);
}

function isCandidateIdentityValid(input: CandidateCapabilitySmokeInputV1): boolean {
	const matches = identityMatchProof(input);
	if (
		typeof input.previousSessionId !== 'string'
		|| input.previousSessionId.length === 0
		|| !Number.isSafeInteger(input.deadlineMs)
		|| input.deadlineMs < 1
		|| input.deadlineMs > 30_000
	) return false;
	return matches.candidateCommit && matches.artifacts && matches.cli;
}

function identityMatchProof(input: CandidateCapabilitySmokeInputV1): CandidateCapabilitySmokeResultV1['identityMatches'] {
	return {
		candidateCommit: COMMIT_PATTERN.test(input.candidateCommit)
			&& COMMIT_PATTERN.test(input.observedCandidateCommit)
			&& input.observedCandidateCommit === input.candidateCommit,
		artifacts: artifactIdentitiesMatch(input.artifacts, input.installedArtifacts),
		cli: isCliIdentityValid(input.cli)
			&& isCliIdentityValid(input.observedCli)
			&& cliIdentitiesMatch(input.cli, input.observedCli),
	};
}

function artifactIdentitiesMatch(
	expected: CandidateArtifactIdentityV1['artifacts'],
	observed: CandidateArtifactIdentityV1['artifacts'],
): boolean {
	if (
		expected.length !== REQUIRED_ARTIFACT_PATHS.length
		|| observed.length !== REQUIRED_ARTIFACT_PATHS.length
	) return false;
	const expectedByPath = new Map(expected.map(artifact => [artifact.path, artifact]));
	const observedByPath = new Map(observed.map(artifact => [artifact.path, artifact]));
	if (
		expectedByPath.size !== REQUIRED_ARTIFACT_PATHS.length
		|| observedByPath.size !== REQUIRED_ARTIFACT_PATHS.length
	) return false;
	return REQUIRED_ARTIFACT_PATHS.every(path => {
		const expectedArtifact = expectedByPath.get(path);
		const observedArtifact = observedByPath.get(path);
		return expectedArtifact !== undefined
			&& observedArtifact !== undefined
			&& Number.isSafeInteger(expectedArtifact.bytes)
			&& expectedArtifact.bytes > 0
			&& DIGEST_PATTERN.test(expectedArtifact.sha256)
			&& observedArtifact.bytes === expectedArtifact.bytes
			&& observedArtifact.sha256 === expectedArtifact.sha256;
	});
}

function cliIdentitiesMatch(
	expected: CandidateArtifactIdentityV1['cli'],
	observed: CandidateArtifactIdentityV1['cli'],
): boolean {
	return Object.keys(expected).every(key => (
		expected[key as keyof typeof expected] === observed[key as keyof typeof observed]
	));
}

function isCliIdentityValid(identity: CandidateArtifactIdentityV1['cli']): boolean {
	return identity.package === '@stratejya/operon-cli@1.1.0'
		&& DIGEST_PATTERN.test(identity.tarballSha256)
		&& DIGEST_PATTERN.test(identity.runtimeContractDigest)
		&& DIGEST_PATTERN.test(identity.bindingFileSha256)
		&& DIGEST_PATTERN.test(identity.bindingAggregateSha256);
}

function failure(
	input: CandidateCapabilitySmokeInputV1,
	requiredCapabilities: readonly string[],
	reason: CandidateCapabilitySmokeResultV1['reason'],
	missingCapabilities: readonly string[],
	unavailableCapabilities: CandidateCapabilitySmokeResultV1['unavailableCapabilities'],
	lastObservationFailure?: CandidateCapabilitySmokeResultV1['lastObservationFailure'],
): CandidateCapabilitySmokeResultV1 {
	return {
		ok: false,
		reason,
		scope: 'published-core-and-task-workflow-mutation-capabilities',
		identityMatches: identityMatchProof(input),
		candidateCommit: input.candidateCommit,
		artifacts: input.artifacts,
		cli: input.cli,
		deadlineMs: input.deadlineMs,
		requiredCapabilities,
		missingCapabilities,
		unavailableCapabilities,
		...(lastObservationFailure === undefined ? {} : { lastObservationFailure }),
	};
}
