const MIB = 1024 * 1024;

export const STAGE7_PROFILE = Object.freeze({
	probe: 5,
	workflow: 20,
	retention: 5,
	mixedLogicalUpdates: 75,
	soakLogicalUpdates: 300,
	maxBatchSize: 64,
});

export const STAGE7_REQUIRED_UNITS = Object.freeze([
	'probe',
	'compact-update-single',
	'compact-update-5',
	'compact-update-20',
	'compact-update-64',
	'mixed-workflow',
	'soak',
]);

export const STAGE7_RESULT_PATH =
	'/private/tmp/operon-agent-runtime-results/cli-speed-stage7.json';
export const STAGE7_CHECKPOINT_PATH =
	'/private/tmp/operon-agent-runtime-results/stage7-close/checkpoint.json';
export const STAGE7_MAIN_JS_BASELINE_BYTES = 4_235_190;
export const STAGE7_MAIN_JS_MAX_DELTA_BYTES = 25_000;

const REQUIRED_APPLY_SPANS = Object.freeze([
	'commit',
	'reindex',
	'settlement',
	'semantic-postflight',
	'receipt-persist',
]);

export function auditStage7BatchUpdate(
	preview,
	apply,
	expectedItems,
	perTargetObserved = false,
) {
	const plan = preview?.result?.plan;
	const items = plan?.spec?.operation === 'update-batch'
		&& Array.isArray(plan.spec.items)
		? plan.spec.items
		: [];
	const effects = Array.isArray(plan?.updateBatchEffects)
		? plan.updateBatchEffects
		: [];
	const targets = Array.isArray(plan?.targets) ? plan.targets : [];
	const groups = Array.isArray(plan?.atomicGroups) ? plan.atomicGroups : [];
	const groupResults = Array.isArray(apply?.result?.groupResults)
		? apply.result.groupResults
		: [];
	const expectedIds = expectedItems.map(value => value.operonId);
	const itemIds = items.map(value => value?.target?.operonId);
	const uniqueIds = new Set(itemIds);
	const sourcePaths = targets.map(value => value?.locator?.filePath);
	const uniqueSources = new Set(sourcePaths);
	const exactItems = items.length === expectedItems.length
		&& uniqueIds.size === expectedItems.length
		&& items.every((item, index) => (
			typeof item?.itemRef === 'string'
			&& item.itemRef.length > 0
			&& item?.target?.operonId === expectedItems[index].operonId
			&& JSON.stringify(item?.changes) === JSON.stringify(expectedItems[index].changes)
		));
	const exactTargets = targets.length === expectedItems.length
		&& targets.every((target, index) => (
			target?.operonId === expectedIds[index]
			&& typeof target?.locator?.filePath === 'string'
			&& target.locator.filePath.length > 0
		));
	const plannedSourceDigests = new Set(
		effects.map(effect => effect?.plannedSourceDigest),
	);
	const exactEffects = effects.length === expectedItems.length
		&& plannedSourceDigests.size === 1
		&& effects.every((effect, index) => (
			effect?.itemRef === items[index]?.itemRef
			&& effect?.operonId === expectedIds[index]
			&& effect?.action === 'update'
			&& typeof effect?.directChange === 'boolean'
			&& typeof effect?.beforeDigest === 'string'
			&& /^[a-f0-9]{64}$/u.test(effect.beforeDigest)
			&& /^[a-f0-9]{64}$/u.test(effect?.plannedSourceDigest ?? '')
			&& JSON.stringify(effect?.locator) === JSON.stringify(targets[index]?.locator)
			&& JSON.stringify(effect?.requestedCanonicalFields)
				=== JSON.stringify(expectedItems[index].changes.map(change => change.field))
		));
	const oneAtomicSource = uniqueSources.size === 1
		&& sourcePaths.length === expectedItems.length
		&& groups.length === 1
		&& groups[0]?.resources?.length === 1
		&& groups[0].resources[0]?.resourceKind === 'task-source'
		&& groups[0].resources[0]?.resourceKey === sourcePaths[0];
	const committed = groupResults.length === 1
		&& groupResults[0]?.status === 'committed'
		&& groupResults[0]?.groupId === groups[0]?.groupId
		&& groupResults[0]?.resourceRevisions?.filter(
			value => value?.resourceKind === 'task-source',
		).length === 1;
	const result = apply?.result;
	const postflight = result?.postflight;
	const terminal = result?.status === 'applied'
		&& result?.receipt?.terminalOutcome === 'applied'
		&& result?.mutationMayHaveApplied === true
		&& postflight?.status === 'verified'
		&& postflight?.contextRevision
		&& typeof postflight.contextRevision === 'object';
	const perTargetPostflight = terminal && perTargetObserved && (
		Array.isArray(postflight?.targets)
			? postflight.targets.length === expectedItems.length
				&& postflight.targets.every((value, index) => (
					value?.operonId === expectedIds[index] && value?.verified === true
				))
			: true
	);
	const valid = exactItems
		&& exactTargets
		&& exactEffects
		&& oneAtomicSource
		&& committed
		&& terminal
		&& perTargetPostflight;
	return {
		valid,
		verifiedIntents: valid ? expectedItems.length : 0,
		exactItems,
		exactTargets,
		exactEffects,
		oneAtomicSource,
		committed,
		postflightVerified: terminal && perTargetPostflight,
		uncertain:
			['partial', 'outcome-unknown'].includes(result?.status)
			|| (
				result?.mutationMayHaveApplied === true
				&& !['applied', 'already-applied'].includes(result?.status)
			)
			|| !valid,
	};
}

export function summarizeStage7Samples(samples) {
	const values = samples.map(value => value?.outerWallMs);
	return {
		attempts: samples.length,
		successes: samples.filter(value => value?.ok === true).length,
		logicalUpdates: samples.reduce(
			(sum, value) => sum + Number(value?.logicalUpdates ?? 0),
			0,
		),
		rawAuthoritative: true,
		correctnessFiltered: 0,
		performanceFiltered: 0,
		rawSamples: samples,
		outerWallMs: summarizeStage7Values(values),
	};
}

export function evaluateStage7Evidence(evidence) {
	const failures = [];
	evaluateProbe(evidence?.probe, failures);
	evaluateSingle(evidence?.compactUpdateSingle, failures);
	evaluateBatch(
		evidence?.compactUpdate5,
		5,
		STAGE7_PROFILE.workflow,
		3,
		3,
		'compact-update-5',
		failures,
	);
	evaluateBatch(
		evidence?.compactUpdate20,
		20,
		STAGE7_PROFILE.workflow,
		10,
		10,
		'compact-update-20',
		failures,
	);
	evaluateBatch(
		evidence?.compactUpdate64,
		64,
		STAGE7_PROFILE.retention,
		15,
		null,
		'compact-update-64',
		failures,
	);
	evaluateLogicalWorkload(
		evidence?.mixedWorkflow,
		STAGE7_PROFILE.mixedLogicalUpdates,
		'mixed-workflow',
		failures,
	);
	evaluateSoak(evidence?.soak, failures);
	if (
		!Number.isInteger(evidence?.bundle?.candidateBytes)
		|| evidence.bundle.candidateBytes <= 0
	) {
		failures.push('bundle:candidate-bytes-required');
	} else if (
		evidence.bundle.candidateBytes - STAGE7_MAIN_JS_BASELINE_BYTES
		> STAGE7_MAIN_JS_MAX_DELTA_BYTES
	) {
		failures.push('bundle:signed-delta-over-25000-bytes');
	}
	return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function evaluateProbe(unit, failures) {
	requireSamples(unit, STAGE7_PROFILE.probe, 'probe', failures);
	requireRaw(unit, 'probe', failures);
	for (const span of REQUIRED_APPLY_SPANS) {
		if (unit?.spanCounts?.[span] !== STAGE7_PROFILE.probe) {
			failures.push(`probe:${span}:exactly-${STAGE7_PROFILE.probe}-required`);
		}
	}
	if (
		unit?.sourceWrites !== STAGE7_PROFILE.probe
		|| unit?.reindexes !== STAGE7_PROFILE.probe
		|| unit?.settlements !== STAGE7_PROFILE.probe
		|| unit?.receiptPersists !== STAGE7_PROFILE.probe
		|| unit?.postflightParses !== STAGE7_PROFILE.probe
	) failures.push('probe:one-write-reindex-settlement-receipt-postflight-per-sample');
}

function evaluateSingle(unit, failures) {
	if (
		unit?.baselineMode !== 'stage6-authoritative-json'
		|| unit?.baseline?.source?.path
			!== '/private/tmp/operon-agent-runtime-results/cli-speed-stage6.json'
		|| typeof unit?.baseline?.source?.cliDigest !== 'string'
	) failures.push('compact-update-single:stage6-baseline-provenance-required');
	requireSamples(unit?.candidate, STAGE7_PROFILE.workflow, 'compact-update-single:candidate', failures);
	requireSamples(unit?.baseline, STAGE7_PROFILE.workflow, 'compact-update-single:baseline', failures);
	requireRaw(unit?.candidate, 'compact-update-single:candidate', failures);
	requireRaw(unit?.baseline, 'compact-update-single:baseline', failures);
	requireCandidateCorrectness(
		unit?.candidate,
		STAGE7_PROFILE.workflow,
		STAGE7_PROFILE.workflow,
		'compact-update-single',
		failures,
		false,
	);
	const candidate = rawSummary(unit?.candidate);
	const baseline = rawSummary(unit?.baseline);
	if (regressionPercent(baseline.p50, candidate.p50) > 10) {
		failures.push('compact-update-single:p50-regressed-over-10-percent');
	}
	if (regressionPercent(baseline.p95, candidate.p95) > 15) {
		failures.push('compact-update-single:p95-regressed-over-15-percent');
	}
}

function evaluateBatch(unit, size, attempts, p50Floor, p95Floor, label, failures) {
	requireSamples(unit?.candidate, attempts, `${label}:candidate`, failures);
	requireSamples(unit?.baseline, attempts, `${label}:baseline`, failures);
	requireRaw(unit?.candidate, `${label}:candidate`, failures);
	requireRaw(unit?.baseline, `${label}:baseline`, failures);
	requireCandidateCorrectness(
		unit?.candidate,
		attempts,
		attempts * size,
		label,
		failures,
	);
	requireSequentialModel(unit?.baseline, size, attempts, label, failures);
	const candidate = rawSummary(unit?.candidate);
	const baseline = rawSummary(unit?.baseline);
	if (ratio(baseline.p50, candidate.p50) < p50Floor) {
		failures.push(`${label}:p50-speedup-below-${p50Floor}x`);
	}
	if (p95Floor !== null && ratio(baseline.p95, candidate.p95) < p95Floor) {
		failures.push(`${label}:p95-speedup-below-${p95Floor}x`);
	}
	if (!(candidate.p95 < 1_500)) failures.push(`${label}:p95-must-be-below-1500ms`);
	if (!(candidate.max < 5_000)) failures.push(`${label}:max-must-be-below-5000ms`);
}

function evaluateLogicalWorkload(unit, logicalUpdates, label, failures) {
	requireRaw(unit, label, failures);
	if (unit?.logicalUpdates !== logicalUpdates) {
		failures.push(`${label}:${logicalUpdates}-logical-updates-required`);
	}
	if (
		!Number.isSafeInteger(unit?.attempts)
		|| unit.attempts >= logicalUpdates
		|| unit?.successes !== unit.attempts
	) failures.push(`${label}:must-use-successful-batches-not-one-command-per-logical-update`);
	requireCandidateCorrectness(
		unit,
		unit?.attempts,
		logicalUpdates,
		label,
		failures,
	);
	const summary = rawSummary(unit);
	if (!(summary.p95 < 1_500)) failures.push(`${label}:p95-must-be-below-1500ms`);
	if (!(summary.max < 5_000)) failures.push(`${label}:max-must-be-below-5000ms`);
}

function evaluateSoak(unit, failures) {
	evaluateLogicalWorkload(
		unit,
		STAGE7_PROFILE.soakLogicalUpdates,
		'soak',
		failures,
	);
	if (!(unit?.rssDeltaBytes < 20 * MIB)) failures.push('soak:rss-over-20-mib');
	for (const field of ['fdDelta', 'socketDelta', 'pendingAfter']) {
		if (unit?.[field] !== 0) failures.push(`soak:${field}-leak`);
	}
}

function requireCandidateCorrectness(
	sample,
	attempts,
	logicalUpdates,
	label,
	failures,
	requirePerTargetObservation = true,
) {
	if (
		sample?.logicalUpdates !== logicalUpdates
		|| sample?.verifiedIntents !== logicalUpdates
		|| sample?.uncertain !== 0
		|| sample?.samePlanRef !== attempts
		|| sample?.unrelatedUnchanged !== attempts
		|| sample?.settingsUnchanged !== attempts
		|| sample?.dispatches?.p50 !== 3
		|| sample?.dispatches?.max !== 3
		|| sample?.sourceWrites !== attempts
		|| sample?.reindexes !== attempts
		|| sample?.settlements !== attempts
		|| sample?.receiptPersists !== attempts
		|| sample?.postflightParses !== attempts
		|| (requirePerTargetObservation && sample?.perTargetObserved !== attempts)
	) failures.push(`${label}:correctness-and-exact-phase-evidence-required`);
}

function requireSequentialModel(sample, size, attempts, label, failures) {
	if (
		sample?.attempts !== attempts
		|| sample?.logicalUpdates !== attempts * size
		|| sample?.rawSamples?.some(value => (
			value?.modeled !== true
			|| value?.equivalentModel !== 'verified-single-command-linear'
			|| value?.observedCommands !== 1
			|| value?.dispatches !== size * 3
			|| value?.logicalUpdates !== size
			|| !Number.isFinite(value?.representativeWallMs)
			|| Math.abs(value.outerWallMs - value.representativeWallMs * size) > 1e-6
		))
	) failures.push(`${label}:verified-linear-sequential-model-required`);
}

function requireSamples(sample, attempts, label, failures) {
	if (sample?.attempts !== attempts || sample?.successes !== attempts) {
		failures.push(`${label}:${attempts}-of-${attempts}-required`);
	}
}

function requireRaw(sample, label, failures) {
	if (
		sample?.rawAuthoritative !== true
		|| sample?.correctnessFiltered !== 0
		|| sample?.performanceFiltered !== 0
		|| !Array.isArray(sample?.rawSamples)
		|| sample.rawSamples.length !== sample?.attempts
		|| sample.rawSamples.filter(value => value?.ok === true).length !== sample?.successes
		|| sample.rawSamples.some(value => !Number.isFinite(value?.outerWallMs))
	) failures.push(`${label}:raw-unfiltered-authoritative-samples-required`);
}

export function summarizeStage7Values(values) {
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	return {
		samples: finite.length,
		p50: percentile(finite, 0.5),
		p95: percentile(finite, 0.95),
		max: finite.length ? finite.at(-1) : null,
	};
}

function rawSummary(sample) {
	return summarizeStage7Values((sample?.rawSamples ?? []).map(value => value?.outerWallMs));
}

function ratio(before, after) {
	return Number.isFinite(before) && before > 0 && Number.isFinite(after) && after > 0
		? before / after
		: -Infinity;
}

function regressionPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return Infinity;
	return (after - before) / before * 100;
}

function percentile(values, fraction) {
	if (values.length === 0) return null;
	const rank = Math.ceil(fraction * values.length) - 1;
	return values[Math.max(0, Math.min(values.length - 1, rank))];
}
