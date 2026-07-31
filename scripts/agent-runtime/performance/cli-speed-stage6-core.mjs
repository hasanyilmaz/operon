const MIB = 1024 * 1024;

export const STAGE6_BASELINES = Object.freeze({
	persistentReadRequestsPerSecond: 93.33033919649958,
	productionBundleBytes: 4_235_190,
	batch20SpeedupFloor: 11.964,
	batch64SpeedupFloor: 21.264,
});

export const STAGE6_PROFILE = Object.freeze({
	probe: 5,
	workflow: 20,
	readSmoke: 20,
	reads: 75,
	soak: 300,
	batchRetention: 5,
	warmup: 2,
	readGroupSize: 3,
});

export const STAGE6_REQUIRED_UNITS = Object.freeze([
	'compact-single',
	'compact-create5',
	'compact-create20',
	'batch-retention',
	'read-batch',
	'soak',
	'negative-contract',
]);

export const STAGE6_COMPACT_MIGRATION_UNITS = Object.freeze([
	'compact-single',
	'compact-create5',
	'compact-create20',
	'batch-retention',
]);

export function partitionStage6ReadGroups(
	logicalCount,
	maxGroupSize = STAGE6_PROFILE.readGroupSize,
) {
	if (!Number.isSafeInteger(logicalCount) || logicalCount < 2) {
		throw new Error('Stage 6 read grouping requires at least two logical reads.');
	}
	if (!Number.isSafeInteger(maxGroupSize) || maxGroupSize < 2) {
		throw new Error('Stage 6 read grouping requires a maximum size of at least two.');
	}
	const groupCount = Math.ceil(logicalCount / maxGroupSize);
	const baseSize = Math.floor(logicalCount / groupCount);
	const largerGroups = logicalCount % groupCount;
	const sizes = Array.from(
		{ length: groupCount },
		(_, index) => baseSize + (index < largerGroups ? 1 : 0),
	);
	if (sizes.some(size => size < 2 || size > maxGroupSize)) {
		throw new Error('Stage 6 read grouping could not satisfy the bounded group size.');
	}
	return sizes;
}

export function canonicalizeStage6ReadSemanticValue(value) {
	if (Array.isArray(value)) return value.map(canonicalizeStage6ReadSemanticValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => ![
				'requestId', 'observedAt', 'asOf', 'nextCursor',
			].includes(key))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [
				key,
				canonicalizeStage6ReadSemanticValue(child),
			]),
	);
}

export function migrateStage6CompactCheckpointV1({
	checkpoint,
	priorFinal,
	seal,
	priorIdentityDigest,
	currentSafetyIdentityMatches,
	actualEvidenceDigests,
	newDependencyDigests,
}) {
	if (
		priorFinal?.suite !== 'operon-cli-speed-stage6'
		|| priorFinal?.checkpoint?.revision !== seal.checkpointRevision
		|| checkpoint?.revision !== seal.checkpointRevision
		|| priorIdentityDigest !== seal.identityDigest
		|| currentSafetyIdentityMatches !== true
	) return { migrated: false, checkpoint };
	const next = structuredClone(checkpoint);
	for (const unit of STAGE6_COMPACT_MIGRATION_UNITS) {
		const value = next?.units?.[unit];
		const expected = seal.units[unit];
		if (
			value?.status !== 'passed'
			|| value?.dependencyDigest !== expected?.dependencyDigest
			|| value?.evidenceDigest !== expected?.evidenceDigest
			|| actualEvidenceDigests?.[unit] !== expected?.evidenceDigest
			|| typeof newDependencyDigests?.[unit] !== 'string'
		) return { migrated: false, checkpoint };
		value.dependencyDigest = newDependencyDigests[unit];
	}
	for (const unit of STAGE6_REQUIRED_UNITS) {
		if (!STAGE6_COMPACT_MIGRATION_UNITS.includes(unit)) delete next.units[unit];
	}
	next.revision += 1;
	return { migrated: true, checkpoint: next };
}

export function recoverStage61InterruptedCheckpointV1({
	checkpoint,
	priorFinal,
	seal,
	priorIdentityDigest,
	currentSafetyIdentityMatches,
	actualEvidenceDigests,
	newDependencyDigests,
}) {
	if (
		priorFinal?.suite !== 'operon-cli-speed-stage6'
		|| priorFinal?.checkpoint?.revision !== seal.checkpointRevision
		|| checkpoint?.revision !== seal.checkpointRevision
		|| priorIdentityDigest !== seal.identityDigest
		|| currentSafetyIdentityMatches !== true
	) return { migrated: false, checkpoint };
	const next = structuredClone(checkpoint);
	for (const unit of ['compact-single', 'compact-create20', 'batch-retention']) {
		const value = next?.units?.[unit];
		const expected = seal.units[unit];
		if (
			value?.status !== 'passed'
			|| value?.dependencyDigest !== expected?.dependencyDigest
			|| value?.evidenceDigest !== expected?.evidenceDigest
			|| actualEvidenceDigests?.[unit] !== expected?.evidenceDigest
			|| typeof newDependencyDigests?.[unit] !== 'string'
			|| (
				unit === 'compact-single'
				&& value.dependencyDigest !== newDependencyDigests[unit]
			)
		) return { migrated: false, checkpoint };
		value.dependencyDigest = newDependencyDigests[unit];
	}
	for (const unit of [
		'compact-create5', 'read-batch', 'soak', 'negative-contract',
	]) delete next.units[unit];
	next.revision += 1;
	return { migrated: true, checkpoint: next };
}

export function summarizeStage6TransportEvidence(
	records,
	logicalRequestCount = STAGE6_PROFILE.reads,
) {
	const groupedRecords = records.filter(value => Number.isSafeInteger(value?.batchSize));
	const logicalRecords = (
		groupedRecords.length > 0 ? groupedRecords : records
	).slice(-logicalRequestCount);
	return {
		// Persistent transport records batch totals on the first child only.
		// Sum every record directly; never divide these counters by group size.
		socketFrames: logicalRecords.reduce(
			(sum, value) => sum + Number(value?.socketFrames ?? 0),
			0,
		),
		requestFiles: logicalRecords.reduce(
			(sum, value) => sum + Number(value?.requestFiles ?? 0),
			0,
		),
		runtimeReads: logicalRecords.reduce(
			(sum, value) => sum + Number(value?.runtimeReads ?? 0),
			0,
		),
		fallbacks: logicalRecords.filter(
			value => value?.transport !== 'persistent',
		).length,
	};
}

export function auditStage6CreateApply(preview, apply, expectedDescriptions) {
	const plan = preview?.result?.plan;
	const items = plan?.spec?.operation === 'create' ? plan.spec.items : [];
	const effects = Array.isArray(plan?.createEffects) ? plan.createEffects : [];
	const expectedCount = expectedDescriptions.length;
	const itemRefs = items.map(item => item?.itemRef);
	const sourcePaths = effects.map(effect => effect?.locator?.filePath);
	const uniqueSourcePaths = new Set(sourcePaths);
	const uniqueOperonIds = new Set(effects.map(effect => effect?.operonId));
	const affectedTaskSources = (plan?.affectedResources ?? []).filter(
		resource => resource?.resourceKind === 'task-source',
	);
	const groups = Array.isArray(plan?.atomicGroups) ? plan.atomicGroups : [];
	const groupResults = Array.isArray(apply?.result?.groupResults)
		? apply.result.groupResults
		: [];
	const committedTaskSources = groupResults.flatMap(result => (
		Array.isArray(result?.resourceRevisions)
			? result.resourceRevisions.filter(
				resource => resource?.resourceKind === 'task-source',
			)
			: []
	));
	const exactItems = items.length === expectedCount
		&& items.every((item, index) => (
			item?.description === expectedDescriptions[index]
			&& typeof item?.itemRef === 'string'
			&& item.itemRef.length > 0
		));
	const exactEffects = effects.length === expectedCount
		&& uniqueOperonIds.size === expectedCount
		&& effects.every((effect, index) => (
			effect?.itemRef === itemRefs[index]
			&& typeof effect?.operonId === 'string'
			&& effect.operonId.length > 0
			&& typeof effect?.locator?.filePath === 'string'
			&& effect.locator.filePath.length > 0
			&& /^[a-f0-9]{64}$/u.test(effect?.renderedTaskDigest ?? '')
			&& /^[a-f0-9]{64}$/u.test(effect?.plannedSourceDigest ?? '')
		));
	const oneAtomicSource = uniqueSourcePaths.size === 1
		&& sourcePaths.length === expectedCount
		&& affectedTaskSources.length === 1
		&& affectedTaskSources[0]?.resourceKey === sourcePaths[0]
		&& groups.length === 1
		&& groups[0]?.resources?.length === 1
		&& groups[0].resources[0]?.resourceKind === 'task-source'
		&& groups[0].resources[0]?.resourceKey === sourcePaths[0];
	const committed = groupResults.length === groups.length
		&& groupResults.every((result, index) => (
			result?.status === 'committed'
			&& result?.groupId === groups[index]?.groupId
		))
		&& committedTaskSources.length === 1
		&& committedTaskSources[0]?.resourceKey === sourcePaths[0]
		&& typeof committedTaskSources[0]?.revision === 'string'
		&& committedTaskSources[0].revision.length > 0;
	const result = apply?.result;
	const terminal = result?.status === 'applied'
		&& result?.receipt?.terminalOutcome === 'applied'
		&& result?.mutationMayHaveApplied === true
		&& result?.postflight?.status === 'verified'
		&& result.postflight.contextRevision
		&& typeof result.postflight.contextRevision === 'object';
	const valid = exactItems && exactEffects && oneAtomicSource && committed && terminal;
	return {
		valid,
		verifiedIntents: valid ? expectedCount : 0,
		uncertain:
			['partial', 'outcome-unknown'].includes(result?.status)
			|| (
				result?.mutationMayHaveApplied === true
				&& !['applied', 'already-applied'].includes(result?.status)
			)
			|| !valid,
	};
}

export function evaluateStage6Evidence(evidence) {
	const failures = [];
	evaluateCompactSingle(evidence?.compactSingle, failures);
	evaluateCompactGroup(evidence?.compactCreate5, 5, 3, 3, failures);
	evaluateCompactGroup(
		evidence?.compactCreate20,
		20,
		STAGE6_BASELINES.batch20SpeedupFloor,
		STAGE6_BASELINES.batch20SpeedupFloor,
		failures,
	);
	evaluateRetention(evidence?.batchRetention, failures);
	evaluateReads(evidence?.readBatch, failures);
	evaluateSoak(evidence?.soak, failures);
	if (evidence?.negativeContract?.status !== 'passed') {
		failures.push('negative-contract:must-pass');
	}
	if ((evidence?.negativeContract?.mutationCalls ?? 0) !== 0) {
		failures.push('negative-contract:mutation-calls-must-be-zero');
	}
	const bundleBytes = evidence?.bundle?.candidateBytes;
	if (!Number.isSafeInteger(bundleBytes)) failures.push('bundle:candidate-bytes-required');
	else if (bundleBytes - STAGE6_BASELINES.productionBundleBytes >= 25_000) {
		failures.push('bundle:delta-must-be-below-25000-bytes');
	}
	return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function evaluateCompactSingle(unit, failures) {
	for (const family of ['create', 'update']) {
		const sample = unit?.families?.[family];
		requireAttempts(sample, STAGE6_PROFILE.workflow, `compact-single:${family}`, failures);
		if (sample?.dispatches?.p50 !== 3 || sample?.dispatches?.max !== 3) {
			failures.push(`compact-single:${family}:exactly-three-dispatches-required`);
		}
		if (sample?.verified !== STAGE6_PROFILE.workflow || sample?.uncertain !== 0) {
			failures.push(`compact-single:${family}:verified-certain-results-required`);
		}
		if (
			sample?.unrelatedUnchanged !== STAGE6_PROFILE.workflow
			|| sample?.settingsUnchanged !== STAGE6_PROFILE.workflow
		) failures.push(`compact-single:${family}:unrelated-and-settings-must-not-change`);
		requireRawAuthoritative(sample, `compact-single:${family}`, failures);
		const candidate = rawOuterSummary(sample);
		const baseline = summarize((sample?.rawSamples ?? []).map(value => value?.baselineOuterWallMs));
		if (!(candidate.max < 5_000)) {
			failures.push(`compact-single:${family}:candidate-max-over-5s`);
		}
		for (const [percentile, limit] of [['p50', 10], ['p95', 15]]) {
			if (
				regressionPercent(
					baseline[percentile],
					candidate[percentile],
				) > limit
			) failures.push(`compact-single:${family}:${percentile}-regressed-over-${limit}-percent`);
		}
	}
}

function evaluateCompactGroup(unit, size, p50Speedup, p95Speedup, failures) {
	const label = `compact-create${size}`;
	requireAttempts(unit?.candidate, STAGE6_PROFILE.workflow, `${label}:candidate`, failures);
	requireAttempts(unit?.baseline, STAGE6_PROFILE.workflow, `${label}:baseline`, failures);
	requireModeledSequentialEquivalent(
		unit?.baseline,
		size,
		STAGE6_PROFILE.workflow,
		`${label}:baseline`,
		failures,
	);
	if (
		unit?.candidate?.dispatches?.p50 !== 3
		|| unit?.candidate?.dispatches?.max !== 3
	) failures.push(`${label}:candidate-exactly-three-dispatches-required`);
	if (
		unit?.baseline?.dispatches?.p50 !== size * 3
		|| unit?.baseline?.dispatches?.max !== size * 3
	) failures.push(`${label}:baseline-exactly-${size * 3}-dispatches-required`);
	if (
		unit?.candidate?.verifiedIntents !== STAGE6_PROFILE.workflow * size
		|| unit?.candidate?.uncertain !== 0
		|| unit?.candidate?.samePlanRef !== STAGE6_PROFILE.workflow
		|| unit?.candidate?.unrelatedUnchanged !== STAGE6_PROFILE.workflow
		|| unit?.candidate?.settingsUnchanged !== STAGE6_PROFILE.workflow
	) failures.push(`${label}:all-intents-and-planrefs-must-verify`);
	requireRawAuthoritative(unit?.candidate, `${label}:candidate`, failures);
	const measuredSpeedup = speedup(
		rawOuterSummary(unit?.baseline),
		rawOuterSummary(unit?.candidate),
	);
	if (!(measuredSpeedup.p50 >= p50Speedup)) {
		failures.push(`${label}:p50-speedup-below-${p50Speedup}x`);
	}
	if (!(measuredSpeedup.p95 >= p95Speedup)) {
		failures.push(`${label}:p95-speedup-below-${p95Speedup}x`);
	}
	if (!(rawOuterSummary(unit?.candidate).max < 5_000)) {
		failures.push(`${label}:candidate-max-over-5s`);
	}
}

function evaluateRetention(unit, failures) {
	for (const [size, floor] of [
		[20, STAGE6_BASELINES.batch20SpeedupFloor],
		[64, STAGE6_BASELINES.batch64SpeedupFloor],
	]) {
		const sample = unit?.[`batch${size}`];
		requireAttempts(sample, STAGE6_PROFILE.batchRetention, `batch-retention:${size}`, failures);
		requireRawAuthoritative(sample, `batch-retention:${size}`, failures);
		const baselineValues = sample?.baselineRawSamples ?? [];
		requireModeledSequentialEquivalent(
			{
				attempts: baselineValues.length,
				rawSamples: baselineValues,
			},
			size,
			STAGE6_PROFILE.batchRetention,
			`batch-retention:${size}:baseline`,
			failures,
		);
		const candidateSummary = rawOuterSummary(sample);
		const baselineSummary = summarize(baselineValues.map(value => value?.outerWallMs));
		if (!(candidateSummary.max < 5_000)) {
			failures.push(`batch-retention:${size}:candidate-max-over-5s`);
		}
		if (!(ratio(baselineSummary.p50, candidateSummary.p50) >= floor)) {
			failures.push(`batch-retention:${size}:floor-not-retained`);
		}
	}
}

function evaluateReads(unit, failures) {
	evaluateStage6ReadSmoke(unit?.structuralSmoke, failures);
	requireAttempts(unit?.sequential, STAGE6_PROFILE.reads, 'read-batch:sequential', failures);
	requireAttempts(unit?.grouped, STAGE6_PROFILE.reads, 'read-batch:grouped', failures);
	requireRawAuthoritative(unit?.sequential, 'read-batch:sequential', failures);
	requireRawAuthoritative(unit?.grouped, 'read-batch:grouped', failures);
	if ((unit?.grouped?.rawSamples ?? []).some(sample => (
			sample?.responseReadyMs !== null
			|| sample?.responseReadyObservation !== 'not-observed'
			|| !['health', 'task.get', 'tasks.query', 'context.build'].includes(
				sample?.commandFamily,
			)
			|| !Number.isSafeInteger(sample?.groupIndex)
			|| !Number.isSafeInteger(sample?.groupPosition)
			|| sample.groupPosition < 0
			|| sample.groupPosition >= STAGE6_PROFILE.readGroupSize
			|| !Number.isFinite(sample?.handlerMs)
			|| !Number.isFinite(sample?.cliTotalMs)
			|| !Number.isFinite(sample?.orderedCompletionMs)
		|| !Number.isFinite(sample?.amortizedLogicalCostMs)
		|| sample?.outerWallMs !== sample?.orderedCompletionMs
	))) failures.push('read-batch:timing-semantics-evidence-required');
	if (unit?.grouped?.logicalResults !== STAGE6_PROFILE.reads) {
		failures.push('read-batch:75-logical-results-required');
	}
	const expectedGroupSizes = partitionStage6ReadGroups(STAGE6_PROFILE.reads);
	const expectedFrames = expectedGroupSizes.length;
	if (
		unit?.grouped?.socketFrames !== expectedFrames
		|| unit?.grouped?.requestFiles !== STAGE6_PROFILE.reads
		|| unit?.grouped?.runtimeReads !== STAGE6_PROFILE.reads
	) failures.push('read-batch:one-socket-frame-per-group-and-all-runtime-reads-required');
	if (unit?.grouped?.orderedResults !== STAGE6_PROFILE.reads) {
		failures.push('read-batch:input-order-must-be-preserved');
	}
	if (unit?.grouped?.semanticMismatches !== 0) {
		failures.push('read-batch:semantic-mismatches-must-be-zero');
	}
	for (const [command, expected] of Object.entries({
		health: 18,
		'task.get': 19,
		'tasks.query': 19,
		'context.build': 19,
	})) {
		if (unit?.grouped?.commandCounts?.[command] !== expected) {
			failures.push(`read-batch:command-family-count-mismatch:${command}`);
		}
	}
	const groupedSummary = rawOuterSummary(unit?.grouped);
	const groups = unit?.pairedGroups?.rawSamples ?? [];
	const expectedGroups = expectedGroupSizes.length;
	if (
		unit?.pairedGroups?.attempts !== expectedGroups
		|| unit?.pairedGroups?.successes !== expectedGroups
		|| groups.length !== expectedGroups
		|| groups.some((group, index) => (
				group?.ok !== true
				|| group?.groupIndex !== index
				|| group?.pairOrder !== (
					index % 2 === 0 ? 'sequential-group' : 'group-sequential'
				)
			|| group?.size !== expectedGroupSizes[index]
				|| !Number.isFinite(group?.sequentialWallMs)
				|| !Number.isFinite(group?.groupWallMs)
				|| !Number.isFinite(group?.makespanRatio)
				|| Math.abs(
					group.makespanRatio
					- group.groupWallMs / group.sequentialWallMs
				) > 0.000_001
				|| !Number.isFinite(group?.makespanImprovementPercent)
				|| Math.abs(
					group.makespanImprovementPercent
					- improvementPercent(group.sequentialWallMs, group.groupWallMs)
				) > 0.000_001
				|| JSON.stringify(group?.sequentialSemanticKeys)
					!== JSON.stringify(group?.groupSemanticKeys)
				|| group?.sequentialSemanticKeys?.length !== group?.size
				|| group.groupWallMs > group.sequentialWallMs
			))
		) failures.push('read-batch:paired-group-makespan-evidence-required');
	const pairedRatios = summarize(groups.map(group => group?.makespanRatio));
	const measuredRpsSpeedup =
		unit?.grouped?.requestsPerSecond / unit?.sequential?.requestsPerSecond;
	if (!(measuredRpsSpeedup >= 1.2)) failures.push('read-batch:speedup-below-1.2x');
	for (const percentile of ['p50', 'p95']) {
		if (pairedRatios[percentile] > 0.85) {
			failures.push(`read-batch:makespan-${percentile}-improvement-below-15-percent`);
		}
	}
	if (unit?.fallbacks !== 0) failures.push('read-batch:fallbacks-must-be-zero');
	if (!(groupedSummary.p95 <= 82.922 * 1.15)) {
		failures.push('read-batch:ordered-completion-p95-regressed');
	}
	if (!(groupedSummary.max < 5_000)) failures.push('read-batch:ordered-completion-max-over-5s');
}

export function evaluateStage6ReadSmoke(smoke, failures) {
	requireAttempts(
		smoke,
		STAGE6_PROFILE.readSmoke,
		'read-batch:structural-smoke',
		failures,
	);
	requireRawAuthoritative(smoke, 'read-batch:structural-smoke', failures);
	const expectedGroupSizes = partitionStage6ReadGroups(STAGE6_PROFILE.readSmoke);
	const expectedFrames = expectedGroupSizes.length;
	if (
		smoke?.logicalResults !== STAGE6_PROFILE.readSmoke
		|| smoke?.orderedResults !== STAGE6_PROFILE.readSmoke
		|| smoke?.socketFrames !== expectedFrames
		|| smoke?.requestFiles !== STAGE6_PROFILE.readSmoke
		|| smoke?.runtimeReads !== STAGE6_PROFILE.readSmoke
		|| smoke?.fallbacks !== 0
		|| smoke?.semanticMismatches !== 0
		|| JSON.stringify(smoke?.groupSizes) !== JSON.stringify(expectedGroupSizes)
	) failures.push('read-batch:20-logical-structural-smoke-required');
	for (const command of ['health', 'task.get', 'tasks.query', 'context.build']) {
		if (smoke?.commandCounts?.[command] !== 5) {
			failures.push(`read-batch:smoke-command-family-count-mismatch:${command}`);
		}
	}
}

function evaluateSoak(unit, failures) {
	requireAttempts(unit, STAGE6_PROFILE.soak, 'soak', failures);
	if (!(unit?.rssDeltaBytes < 20 * MIB)) failures.push('soak:rss-over-20-mib');
	for (const field of ['fdDelta', 'socketDelta', 'listenerDelta', 'pendingAfter']) {
		if (unit?.[field] !== 0) failures.push(`soak:${field}-leak`);
	}
}

function requireAttempts(sample, count, label, failures) {
	if (sample?.attempts !== count || sample?.successes !== count) {
		failures.push(`${label}:${count}-of-${count}-required`);
	}
}

function requireModeledSequentialEquivalent(sample, size, count, label, failures) {
	if (
		sample?.attempts !== count
		|| !Array.isArray(sample?.rawSamples)
		|| sample.rawSamples.length !== sample.attempts
		|| sample.rawSamples.some(value =>
			value?.ok !== true
			|| value?.modeled !== true
			|| value?.observedCommands !== 1
			|| value?.equivalentModel !== 'verified-single-command-linear'
			|| value?.dispatches !== size * 3
			|| value?.representativeDispatches !== 3
			|| !Number.isFinite(value?.representativeWallMs)
			|| !Number.isFinite(value?.outerWallMs)
			|| Math.abs(value.outerWallMs - value.representativeWallMs * size) > 1e-6,
		)
	) failures.push(`${label}:explicit-modeled-sequential-equivalent-required`);
}

function requireRawAuthoritative(sample, label, failures) {
	if (
		sample?.rawAuthoritative !== true
		|| sample?.correctnessFiltered !== 0
		|| sample?.performanceFiltered !== 0
		|| !Array.isArray(sample?.rawSamples)
		|| sample.rawSamples.length !== sample?.attempts
		|| sample.rawSamples.filter(value => value?.ok === true).length !== sample?.successes
		|| sample.rawSamples.some(value => !Number.isFinite(value?.outerWallMs))
	) failures.push(`${label}:raw-unfiltered-samples-required`);
	if (
		sample?.diagnosticOutliers
		&& !sample.diagnosticOutliers.every(value => Number.isSafeInteger(value?.index))
	) failures.push(`${label}:diagnostic-outlier-identity-required`);
}

export function summarizeStage6Samples(samples) {
	const values = samples.map(value => value?.outerWallMs);
	return {
		attempts: samples.length,
		successes: samples.filter(value => value?.ok === true).length,
		rawAuthoritative: true,
		correctnessFiltered: 0,
		performanceFiltered: 0,
		rawSamples: samples,
		outerWallMs: summarize(values),
		diagnosticOutliers: diagnoseOutliers(values),
	};
}

export function summarize(values) {
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	return {
		samples: finite.length,
		p50: percentile(finite, 0.5),
		p95: percentile(finite, 0.95),
		max: finite.length ? finite.at(-1) : null,
	};
}

function rawOuterSummary(sample) {
	return summarize((sample?.rawSamples ?? []).map(value => value?.outerWallMs));
}

export function diagnoseOutliers(values) {
	const finite = values.map((value, index) => ({ value, index })).filter(item => (
		Number.isFinite(item.value)
	));
	const center = median(finite.map(item => item.value));
	const mad = median(finite.map(item => Math.abs(item.value - center)));
	if (!Number.isFinite(center) || !Number.isFinite(mad) || mad === 0) return [];
	const scale = 1.4826 * mad;
	return finite.flatMap(item => {
		const robustZ = Math.abs(item.value - center) / scale;
		return robustZ > 3.5 && Math.abs(item.value - center) > 1
			? [{ index: item.index, value: item.value, robustZ }]
			: [];
	});
}

export function speedup(before, after) {
	return {
		p50: ratio(before?.p50, after?.p50),
		p95: ratio(before?.p95, after?.p95),
	};
}

function ratio(before, after) {
	return Number.isFinite(before) && before > 0 && Number.isFinite(after) && after > 0
		? before / after
		: null;
}

function improvementPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return -Infinity;
	return (before - after) / before * 100;
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

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}
