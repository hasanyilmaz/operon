import path from 'node:path';

export const CLI_SPEED_STAGE1_VAULT = '/private/tmp/cli-test-vault';
export const CLI_SPEED_STAGE1_RESULTS_DIRECTORY = '/private/tmp/operon-agent-runtime-results';
export const CLI_SPEED_STAGE1_RESULT_PATH = path.join(
	CLI_SPEED_STAGE1_RESULTS_DIRECTORY,
	'cli-speed-stage1.json',
);

export const DEFAULT_REGRESSION_LIMITS = Object.freeze({
	p50Percent: 10,
	p95Percent: 15,
	warmMaxMs: 5_000,
	previewHandlerP95Ms: 100,
	routineApplyHandlerP95Ms: 2_000,
	statefulApplyHandlerP95Ms: 3_000,
	batch20MinimumSpeedup: 10,
	batch64MinimumSpeedup: 20,
});

const STATEFUL_MUTATION_FAMILIES = new Set(['relocate', 'conversion', 'delete']);
const UNCERTAIN_APPLY_STATUSES = new Set(['partial', 'outcome-unknown']);

export function assertCliSpeedStage1Vault(
	vaultPath,
	{
		lstatSync,
		realpathSync,
	} = {},
) {
	if (typeof vaultPath !== 'string' || vaultPath.length === 0) {
		throw new Error('CLI speed Stage 1 requires an explicit vault path.');
	}
	if (path.resolve(vaultPath) !== CLI_SPEED_STAGE1_VAULT) {
		throw new Error(`Refusing vault outside ${CLI_SPEED_STAGE1_VAULT}.`);
	}
	if (
		path.dirname(vaultPath) !== '/private/tmp'
		|| path.basename(vaultPath) !== 'cli-test-vault'
	) {
		throw new Error('CLI speed Stage 1 vault must be the exact guarded path.');
	}
	if (typeof lstatSync !== 'function' || typeof realpathSync !== 'function') {
		throw new Error('Vault guard requires lstatSync and realpathSync.');
	}
	const metadata = lstatSync(vaultPath);
	if (metadata.isSymbolicLink()) {
		throw new Error('CLI speed Stage 1 vault must not be a symbolic link.');
	}
	if (!metadata.isDirectory()) {
		throw new Error('CLI speed Stage 1 vault must be a directory.');
	}
	if (realpathSync(vaultPath) !== CLI_SPEED_STAGE1_VAULT) {
		throw new Error('CLI speed Stage 1 vault realpath does not match the guarded path.');
	}
	if (realpathSync(path.dirname(vaultPath)) !== '/private/tmp') {
		throw new Error('CLI speed Stage 1 vault parent realpath is not /private/tmp.');
	}
	return CLI_SPEED_STAGE1_VAULT;
}

export function percentile(values, fraction) {
	if (!Array.isArray(values) || values.length === 0) return null;
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (finite.length === 0) return null;
	const rank = Math.ceil(fraction * finite.length) - 1;
	return finite[Math.max(0, Math.min(finite.length - 1, rank))];
}

export function summarizeDurations(values) {
	const finite = values.filter(Number.isFinite);
	return {
		p50: percentile(finite, 0.5),
		p95: percentile(finite, 0.95),
		max: finite.length > 0 ? Math.max(...finite) : null,
	};
}

export function classifyApplyCorrectness(sample) {
	const reasons = [];
	const correctness = sample?.correctness ?? {};
	const preview = correctness.preview ?? {};
	const apply = correctness.apply ?? {};
	const finalState = correctness.finalState ?? {};
	const expectedApplyStatus = correctness.idempotencyExpected === true
		? 'already-applied'
		: 'applied';

	if (preview.ok !== true) reasons.push('preview-not-ok');
	if (preview.exactTarget !== true) reasons.push('preview-target-not-exact');
	if (preview.expectedEffects !== true) reasons.push('preview-effects-not-verified');
	if (
		typeof apply.planRef !== 'string'
		|| apply.planRef.length === 0
		|| apply.planRefUsed !== apply.planRef
	) {
		reasons.push('stored-plan-ref-not-used-unchanged');
	}
	if (apply.status !== expectedApplyStatus) {
		reasons.push(`unexpected-apply-status:${String(apply.status)}`);
	}
	if (apply.mutationMayHaveApplied === true) reasons.push('mutation-may-have-applied');
	if (UNCERTAIN_APPLY_STATUSES.has(apply.status)) {
		reasons.push(`uncertain-apply-status:${apply.status}`);
	}
	const expectedPostflight = correctness.idempotencyExpected === true
		? 'receipt-replay'
		: 'verified';
	if (apply.postflightStatus !== expectedPostflight) reasons.push('postflight-not-verified');
	if (finalState.verified !== true) reasons.push('final-task-state-not-verified');
	for (const field of ['description', 'status', 'locator', 'revision']) {
		if (finalState[field] !== true) reasons.push(`final-${field}-not-verified`);
	}
	if (correctness.derivedStateRequired === true && finalState.derivedState !== true) {
		reasons.push('derived-state-not-verified');
	}
	if (correctness.copyCountRequired === true && finalState.copyCount !== true) {
		reasons.push('task-copy-count-not-verified');
	}
	if (correctness.sourceAbsenceRequired === true && finalState.sourceAbsent !== true) {
		reasons.push('source-absence-not-verified');
	}
	if (correctness.targetPresenceRequired === true && finalState.targetPresent !== true) {
		reasons.push('target-presence-not-verified');
	}
	if (correctness.unrelatedFixtureUnchanged !== true) {
		reasons.push('unrelated-fixture-changed-or-unverified');
	}
	if (correctness.settingsFingerprintUnchanged !== true) {
		reasons.push('settings-fingerprint-changed-or-unverified');
	}
	return { ok: reasons.length === 0, reasons };
}

export function aggregateSamples(samples) {
	if (!Array.isArray(samples)) throw new TypeError('Samples must be an array.');
	const scenarios = {};
	for (const sample of samples) {
		const scenario = requireNonEmptyString(sample?.scenario, 'sample.scenario');
		const bucket = scenarios[scenario] ??= {
			attempts: 0,
			successes: 0,
			correctnessFailures: [],
				handlerMs: [],
				totalMs: [],
				outerWallMs: [],
				cliTotalMs: [],
				retriedSamples: 0,
				retryAttempts: 0,
			};
		bucket.attempts += 1;
		const retryCount = Number.isSafeInteger(sample?.retryCount) && sample.retryCount >= 0
			? sample.retryCount
			: 0;
		bucket.retryAttempts += retryCount;
		if (retryCount > 0) bucket.retriedSamples += 1;
		const correctness = sample.kind === 'mutation'
			? classifyApplyCorrectness(sample)
			: classifyReadCorrectness(sample);
		if (!correctness.ok) {
			bucket.correctnessFailures.push({
				sampleId: sample.sampleId ?? null,
				reasons: correctness.reasons,
			});
			continue;
		}
		bucket.successes += 1;
		if (Number.isFinite(sample.handlerMs)) bucket.handlerMs.push(sample.handlerMs);
		if (Number.isFinite(sample.totalMs)) bucket.totalMs.push(sample.totalMs);
		if (Number.isFinite(sample.outerWallMs)) bucket.outerWallMs.push(sample.outerWallMs);
		if (Number.isFinite(sample.cliTotalMs)) bucket.cliTotalMs.push(sample.cliTotalMs);
	}
	return Object.fromEntries(Object.entries(scenarios).map(([scenario, bucket]) => [
		scenario,
		{
			attempts: bucket.attempts,
			successes: bucket.successes,
			correctnessFailures: bucket.correctnessFailures,
			handlerSamples: bucket.handlerMs.length,
			totalSamples: bucket.totalMs.length,
			handlerMs: summarizeDurations(bucket.handlerMs),
			totalMs: summarizeDurations(bucket.totalMs),
				outerWallMs: summarizeDurations(bucket.outerWallMs),
				cliTotalMs: summarizeDurations(bucket.cliTotalMs),
				retriedSamples: bucket.retriedSamples,
				retryAttempts: bucket.retryAttempts,
			},
	]));
}

export function evaluateStage1Gates(
	evidence,
	{
		baseline,
		limits = DEFAULT_REGRESSION_LIMITS,
	} = {},
) {
	const failures = [];
	for (const [name, scenario] of Object.entries(evidence?.scenarios ?? {})) {
		if (scenario.successes !== scenario.attempts) {
			failures.push(`${name}:successes-do-not-match-attempts`);
		}
		if (scenario.handlerSamples !== scenario.successes) {
			failures.push(`${name}:missing-handler-timings`);
		}
		if (scenario.totalSamples !== scenario.successes) {
			failures.push(`${name}:missing-total-timings`);
		}
		const metadata = evidence?.scenarioMetadata?.[name] ?? {};
		if (metadata.warm === true && scenario.totalMs?.max >= limits.warmMaxMs) {
			failures.push(`${name}:warm-total-max-exceeded`);
		}
		if (
			metadata.phase === 'preview'
			&& scenario.handlerMs?.p95 >= limits.previewHandlerP95Ms
		) {
			failures.push(`${name}:preview-handler-p95-exceeded`);
		}
		if (metadata.phase === 'apply') {
			const applyLimit = STATEFUL_MUTATION_FAMILIES.has(metadata.family)
				? limits.statefulApplyHandlerP95Ms
				: limits.routineApplyHandlerP95Ms;
			if (scenario.handlerMs?.p95 >= applyLimit) {
				failures.push(`${name}:apply-handler-p95-exceeded`);
			}
		}
	}

	for (const [batchSize, minimumSpeedup] of [
		[20, limits.batch20MinimumSpeedup],
		[64, limits.batch64MinimumSpeedup],
	]) {
		const speedup = evidence?.batchSpeedups?.[batchSize];
		if (!Number.isFinite(speedup) || speedup < minimumSpeedup) {
			failures.push(`batch-${batchSize}:minimum-speedup-not-met`);
		}
	}

	if (baseline) {
		for (const reason of comparisonCompatibilityFailures(evidence, baseline)) {
			failures.push(`baseline:${reason}`);
		}
		for (const [name, candidate] of Object.entries(evidence?.scenarios ?? {})) {
			const reference = baseline?.scenarios?.[name];
			if (!reference) {
				failures.push(`${name}:missing-baseline-scenario`);
				continue;
			}
			for (const [metric, allowedPercent] of [
				['p50', limits.p50Percent],
				['p95', limits.p95Percent],
			]) {
				const candidateValue = candidate.totalMs?.[metric];
				const referenceValue = reference.totalMs?.[metric];
				if (
					Number.isFinite(candidateValue)
					&& Number.isFinite(referenceValue)
					&& candidateValue > referenceValue * (1 + allowedPercent / 100)
				) {
					failures.push(`${name}:total-${metric}-regressed`);
				}
			}
		}
	}

	return { ok: failures.length === 0, failures };
}

function comparisonCompatibilityFailures(candidate, baseline) {
	const failures = [];
	for (const field of [
		'host',
		'platform',
		'osRelease',
		'architecture',
		'node',
		'pluginVersion',
		'cliVersion',
		'obsidianVersion',
	]) {
		if (candidate?.environment?.[field] !== baseline?.environment?.[field]) {
			failures.push(`environment-${field}-mismatch`);
		}
	}
	if (candidate?.fixtureDigest !== baseline?.fixtureDigest) {
		failures.push('fixture-digest-mismatch');
	}
	for (const name of Object.keys(baseline?.scenarios ?? {})) {
		if (!Object.hasOwn(candidate?.scenarios ?? {}, name)) {
			failures.push(`${name}-missing-candidate-scenario`);
		}
	}
	for (const [name, scenario] of Object.entries(candidate?.scenarios ?? {})) {
		if (baseline?.scenarios?.[name]?.attempts !== scenario.attempts) {
			failures.push(`${name}-sample-count-mismatch`);
		}
	}
	return failures;
}

export function buildStage1Evidence({
	environment,
	artifacts,
	fixtureDigest,
	samples,
	scenarioMetadata = {},
	batchSpeedups = {},
	probeStageTimings,
	baseline,
}) {
	const scenarios = aggregateSamples(samples);
	const evidence = {
		schemaVersion: 1,
		suite: 'operon-cli-speed-stage1',
		recordedAt: new Date().toISOString(),
		vaultPath: CLI_SPEED_STAGE1_VAULT,
		environment,
		artifacts,
		fixtureDigest,
		scenarios,
		scenarioMetadata,
		batchSpeedups,
		...(probeStageTimings ? { diagnostics: { probeStageTimings } } : {}),
	};
	evidence.gates = evaluateStage1Gates(evidence, { baseline });
	return evidence;
}

function classifyReadCorrectness(sample) {
	const reasons = [];
	if (sample?.correctness?.verified !== true) reasons.push('read-not-verified');
	if (sample?.correctness?.liveVerified !== true) reasons.push('read-not-live-verified');
	return { ok: reasons.length === 0, reasons };
}

function requireNonEmptyString(value, label) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${label} must be a non-empty string.`);
	}
	return value;
}
