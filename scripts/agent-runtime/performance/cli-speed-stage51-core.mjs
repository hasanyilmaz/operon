const MIB = 1024 * 1024;

export const STAGE51_PROFILE = Object.freeze({
	parityPerFamily: 5,
	timed: 75,
	throughput: 75,
	overhead: 20,
	soak: 300,
	mutationIsolationPerFamily: 5,
});

export const STAGE51_OVERHEAD_OUTLIER_POLICY = Object.freeze({
	id: 'paired-delta-hampel-v1',
	robustZThreshold: 3.5,
	minimumDeviationMs: 1,
	maximumExcludedPairs: 2,
	minimumRetainedPairs: 18,
	minimumRetainedPerOrder: 8,
	minimumRetainedPerFamily: 5,
});

export const STAGE51_REQUIRED_UNITS = Object.freeze([
	'parity',
	'timed',
	'throughput',
	'overhead',
	'soak',
	'mutation-isolation',
	'negative-tests',
]);

export function evaluateStage51Evidence(evidence) {
	const failures = [];
	for (const family of ['health', 'task.get', 'context.build']) {
		const parity = evidence?.parity?.families?.[family];
		if (
			parity?.attempts !== STAGE51_PROFILE.parityPerFamily
			|| parity?.successes !== STAGE51_PROFILE.parityPerFamily
			|| parity?.semanticMatches !== STAGE51_PROFILE.parityPerFamily
		) failures.push(`parity:${family}:5-of-5-semantic-equality-required`);
	}
	const timed = evidence?.timed;
	if (timed?.attempts !== STAGE51_PROFILE.timed || timed?.successes !== STAGE51_PROFILE.timed) {
		failures.push('timed:75-of-75-required');
	}
	for (const field of ['linked', 'unique', 'residualWithinLimit', 'nonNegativeComponents']) {
		if (timed?.[field] !== STAGE51_PROFILE.timed) failures.push(`timed:${field}:75-required`);
	}
	if (timed?.overflow !== 0) failures.push('timed:overflow-must-be-zero');
	if (timed?.duplicates !== 0) failures.push('timed:duplicates-must-be-zero');
	if (timed?.missing !== 0) failures.push('timed:missing-must-be-zero');
	if (!(timed?.clockOffsetMs <= 2)) failures.push('timed:clock-offset-over-2ms');
	if (!(timed?.serviceMs?.p95 <= 25)) failures.push('timed:service-p95-over-25ms');
	const throughput = evidence?.throughput;
	if (
		throughput?.candidate?.attempts !== STAGE51_PROFILE.throughput
		|| throughput?.candidate?.successes !== STAGE51_PROFILE.throughput
	) failures.push('throughput:candidate:75-of-75-required');
	if (!(throughput?.candidate?.requestsPerSecond >= 70)) failures.push('throughput:rps-below-70');
	if (!(throughput?.speedup >= 1.2)) failures.push('throughput:speedup-below-1.20x');
	if (!(throughput?.outerImprovementPercent?.p50 >= 20)) {
		failures.push('throughput:outer-p50-improvement-below-20-percent');
	}
	if (!(throughput?.outerImprovementPercent?.p95 >= 15)) {
		failures.push('throughput:outer-p95-improvement-below-15-percent');
	}
	const overhead = evidence?.overhead;
	if (
		overhead?.timed?.attempts !== STAGE51_PROFILE.overhead
		|| overhead?.timed?.successes !== STAGE51_PROFILE.overhead
		|| overhead?.untimed?.attempts !== STAGE51_PROFILE.overhead
		|| overhead?.untimed?.successes !== STAGE51_PROFILE.overhead
	) failures.push('overhead:20-timed-and-20-untimed-required');
	if (
		overhead?.method !== 'paired-same-binary-alternating-ab-ba'
		|| overhead?.paired?.attempts !== STAGE51_PROFILE.overhead
		|| overhead?.paired?.semanticMatches !== STAGE51_PROFILE.overhead
		|| overhead?.paired?.measuredTimingRecords !== STAGE51_PROFILE.overhead
		|| overhead?.paired?.warmupTimingRecords !== 2
		|| overhead?.paired?.totalTimingRecords !== STAGE51_PROFILE.overhead + 2
		|| overhead?.paired?.uniqueTimingRecords !== STAGE51_PROFILE.overhead + 2
		|| overhead?.paired?.timingOverflow !== 0
		|| overhead?.paired?.persistentMeasured !== STAGE51_PROFILE.overhead
		|| overhead?.executableDigestBefore !== overhead?.executableDigestAfter
	) failures.push('overhead:20-semantic-paired-frames-required');
	const expectedDiagnostic = analyzeStage51OverheadPairs(overhead?.paired?.raw);
	if (
		!hasExactStage51PairSchedule(overhead?.paired?.raw)
		|| overhead?.diagnostic?.policy?.id !== STAGE51_OVERHEAD_OUTLIER_POLICY.id
		|| overhead?.diagnostic?.status !== expectedDiagnostic.status
		|| overhead?.diagnostic?.inputPairs !== STAGE51_PROFILE.overhead
		|| overhead?.diagnostic?.retainedPairs !== expectedDiagnostic.retainedPairs
		|| overhead?.diagnostic?.excludedPairs !== expectedDiagnostic.excludedPairs
		|| overhead?.diagnostic?.rawPreserved !== true
			|| overhead?.diagnostic?.balanceEligible !== true
			|| expectedDiagnostic.balanceEligible !== true
			|| overhead?.diagnostic?.excluded?.length !== expectedDiagnostic.excluded.length
			|| !expectedDiagnostic.excluded.every((expected, index) => {
				const observed = overhead?.diagnostic?.excluded?.[index];
				return observed?.index === expected.index
					&& observed?.order === expected.order
					&& observed?.family === expected.family
					&& observed?.reason === expected.reason
					&& nearlyEqual(observed?.deltaMs, expected.deltaMs);
			})
	) {
		failures.push('overhead:paired-raw-and-outlier-diagnostic-required');
	}
	const soak = evidence?.soak;
	if (soak?.attempts !== STAGE51_PROFILE.soak || soak?.successes !== STAGE51_PROFILE.soak) {
		failures.push('soak:300-of-300-required');
	}
	if (!(soak?.rssDeltaBytes < 20 * MIB)) failures.push('soak:rss-over-20-mib');
	for (const field of ['fdDelta', 'socketDelta', 'listenerDelta', 'pendingAfter']) {
		if (soak?.[field] !== 0) failures.push(`soak:${field}-leak`);
	}
	for (const family of ['compact-create', 'exact-update']) {
		const isolation = evidence?.mutationIsolation?.families?.[family];
		if (
			isolation?.attempts !== STAGE51_PROFILE.mutationIsolationPerFamily
			|| isolation?.successes !== STAGE51_PROFILE.mutationIsolationPerFamily
			|| isolation?.requestFileDispatches !== STAGE51_PROFILE.mutationIsolationPerFamily
			|| isolation?.persistentDispatches !== 0
			|| isolation?.observedRuntimeDispatches
				!== STAGE51_PROFILE.mutationIsolationPerFamily * 3
			|| isolation?.expectedRuntimeDispatches
				!== STAGE51_PROFILE.mutationIsolationPerFamily * 3
			|| isolation?.observedMutationDispatches
				!== STAGE51_PROFILE.mutationIsolationPerFamily * 2
			|| isolation?.verifiedPostflight !== STAGE51_PROFILE.mutationIsolationPerFamily
		) failures.push(`mutation-isolation:${family}:5-of-5-request-file-only-required`);
	}
	if (evidence?.negativeTests?.status !== 'passed') failures.push('negative-tests:must-pass');
	if (evidence?.negativeTests?.runtimeMutationCalls !== 0) {
		failures.push('negative-tests:runtime-mutation-calls-must-be-zero');
	}
	if (evidence?.negativeTests?.planStoreCalls !== 0) {
		failures.push('negative-tests:plan-store-calls-must-be-zero');
	}
	return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export function checkpointIdentityMatches(left, right) {
	return typeof left?.digest === 'string'
		&& left.digest.length === 64
		&& left.digest === right?.digest;
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

export function analyzeStage51OverheadPairs(pairs) {
	const raw = Array.isArray(pairs) ? pairs : [];
	const deltas = raw.map(value => value?.deltaMs);
	const finiteDeltas = deltas.filter(Number.isFinite);
	const medianDeltaMs = median(finiteDeltas);
	const deviations = finiteDeltas.map(value => Math.abs(value - medianDeltaMs));
	const madMs = median(deviations);
	const robustScaleMs = Number.isFinite(madMs) ? 1.4826 * madMs : null;
	const candidates = raw.flatMap((value, rawIndex) => {
		if (!Number.isFinite(value?.deltaMs) || !Number.isFinite(medianDeltaMs)) return [];
		const deviationMs = Math.abs(value.deltaMs - medianDeltaMs);
		const robustZ = robustScaleMs > 0
			? deviationMs / robustScaleMs
			: (deviationMs === 0 ? 0 : Number.POSITIVE_INFINITY);
		return (
			robustZ > STAGE51_OVERHEAD_OUTLIER_POLICY.robustZThreshold
			&& deviationMs > STAGE51_OVERHEAD_OUTLIER_POLICY.minimumDeviationMs
		) ? [{
				rawIndex,
				index: value.index,
				order: value.order,
				family: value.family,
				deltaMs: value.deltaMs,
				deviationMs,
				robustZ,
				reason: 'paired-delta-hampel-outlier',
			}] : [];
	});
	const unstable = candidates.length > STAGE51_OVERHEAD_OUTLIER_POLICY.maximumExcludedPairs;
	const excluded = unstable ? [] : candidates;
	const excludedIndexes = new Set(excluded.map(value => value.rawIndex));
	const retained = raw.filter((_value, index) => !excludedIndexes.has(index));
	const orderCounts = countBy(retained, value => value?.order, ['AB', 'BA']);
	const familyCounts = countBy(
		retained,
		value => value?.family,
		['health', 'task.get', 'context.build'],
	);
	const balanceEligible = (
		retained.length >= STAGE51_OVERHEAD_OUTLIER_POLICY.minimumRetainedPairs
		&& Object.values(orderCounts).every(
			count => count >= STAGE51_OVERHEAD_OUTLIER_POLICY.minimumRetainedPerOrder,
		)
		&& Object.values(familyCounts).every(
			count => count >= STAGE51_OVERHEAD_OUTLIER_POLICY.minimumRetainedPerFamily,
		)
	);
	return {
		policy: STAGE51_OVERHEAD_OUTLIER_POLICY,
		status: unstable ? 'unstable' : (excluded.length > 0 ? 'filtered' : 'clean'),
		inputPairs: raw.length,
		retainedPairs: retained.length,
		excludedPairs: excluded.length,
		rawPreserved: raw.length === STAGE51_PROFILE.overhead,
		medianDeltaMs,
		madMs,
		robustScaleMs,
		balanceEligible,
		balance: { orders: orderCounts, families: familyCounts },
		excluded,
		retainedAbsoluteMs: summarize(retained.map(value => value?.deltaMs)),
		retainedPercent: summarize(retained.map(value => value?.percent)),
	};
}

export function improvementPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return null;
	return (before - after) / before * 100;
}

function hasExactStage51PairSchedule(pairs) {
	return Array.isArray(pairs)
		&& pairs.length === STAGE51_PROFILE.overhead
		&& pairs.every((value, index) => (
			value?.index === index
			&& value?.order === (index % 2 === 0 ? 'AB' : 'BA')
			&& value?.family === ['health', 'task.get', 'context.build'][index % 3]
			&& Number.isFinite(value?.timedMs)
				&& Number.isFinite(value?.controlMs)
				&& value.controlMs > 0
				&& Number.isFinite(value?.deltaMs)
				&& Number.isFinite(value?.percent)
				&& nearlyEqual(value.deltaMs, value.timedMs - value.controlMs)
				&& nearlyEqual(
					value.percent,
					(value.timedMs - value.controlMs) / value.controlMs * 100,
				)
			));
}

function nearlyEqual(left, right) {
	return Number.isFinite(left)
		&& Number.isFinite(right)
		&& Math.abs(left - right) <= 1e-6;
}

function countBy(values, selector, expected) {
	const counts = Object.fromEntries(expected.map(value => [value, 0]));
	for (const value of values) {
		const key = selector(value);
		if (Object.hasOwn(counts, key)) counts[key] += 1;
	}
	return counts;
}

function median(values) {
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (finite.length === 0) return null;
	const middle = Math.floor(finite.length / 2);
	return finite.length % 2 === 0
		? (finite[middle - 1] + finite[middle]) / 2
		: finite[middle];
}

function percentile(values, fraction) {
	if (values.length === 0) return null;
	const rank = Math.ceil(fraction * values.length) - 1;
	return values[Math.max(0, Math.min(values.length - 1, rank))];
}
