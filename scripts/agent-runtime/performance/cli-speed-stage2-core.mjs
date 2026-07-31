export function clearStage2CollectorResult(filePath, { rmSync }) {
	rmSync(filePath, { force: true });
}

export function assertFreshStage2CollectorEvidence({
	evidence,
	startedAt,
	expectedProductionSha256,
	expectedProbeSha256,
	expectedCliSha256,
}) {
	if (!Number.isFinite(startedAt)) throw new TypeError('Stage 2 collector start time is invalid.');
	const recordedAt = Date.parse(evidence?.recordedAt);
	if (!Number.isFinite(recordedAt) || recordedAt < startedAt) {
		throw new Error('Stage 2 collector evidence predates the current comparison session.');
	}
	if (evidence?.artifacts?.production?.sha256 !== expectedProductionSha256) {
		throw new Error(
			'Stage 2 collector production artifact does not match the installed session artifact.',
		);
	}
	if (evidence?.artifacts?.probe?.sha256 !== expectedProbeSha256) {
		throw new Error(
			'Stage 2 collector probe artifact does not match the installed session artifact.',
		);
	}
	if (evidence?.artifacts?.cli?.sha256 !== expectedCliSha256) {
		throw new Error(
			'Stage 2 collector CLI artifact does not match the requested session artifact.',
		);
	}
	return evidence;
}

const GRANDFATHERED_ABSOLUTE_PERFORMANCE_FAILURES = [
	/:warm-total-max-exceeded$/u,
	/:preview-handler-p95-exceeded$/u,
	/:apply-handler-p95-exceeded$/u,
	/^batch-(20|64):minimum-speedup-not-met$/u,
];

export function assertAdmissibleStage2Baseline(evidence) {
	const scenarios = evidence?.scenarios;
	if (!scenarios || typeof scenarios !== 'object' || Object.keys(scenarios).length === 0) {
		throw new Error('Stage 2 baseline has no scenarios.');
	}
	for (const [name, scenario] of Object.entries(scenarios)) {
		if (
			!Number.isSafeInteger(scenario?.attempts)
			|| scenario.attempts < 1
			|| scenario.successes !== scenario.attempts
		) {
			throw new Error(`Stage 2 baseline correctness is incomplete for ${name}.`);
		}
		if (
			scenario.handlerSamples !== scenario.successes
			|| scenario.totalSamples !== scenario.successes
			|| !hasCompleteDurations(scenario.handlerMs)
			|| !hasCompleteDurations(scenario.totalMs)
		) {
			throw new Error(`Stage 2 baseline timing evidence is incomplete for ${name}.`);
		}
	}
	if (!evidence?.gates || !Array.isArray(evidence.gates.failures)) {
		throw new Error('Stage 2 baseline gate evidence is missing.');
	}
	const failures = evidence.gates.failures;
	if (evidence.gates.ok !== (failures.length === 0)) {
		throw new Error('Stage 2 baseline gate evidence is inconsistent.');
	}
	const unsupportedFailures = failures.filter(failure => (
		typeof failure !== 'string'
		|| !GRANDFATHERED_ABSOLUTE_PERFORMANCE_FAILURES.some(pattern => pattern.test(failure))
	));
	if (unsupportedFailures.length > 0) {
		throw new Error(
			`Stage 2 baseline has non-performance gate failures: ${unsupportedFailures.join(', ')}`,
		);
	}
	return evidence;
}

function hasCompleteDurations(value) {
	return ['p50', 'p95', 'max'].every(metric => Number.isFinite(value?.[metric]));
}
