const MIB = 1024 * 1024;

export const STAGE4_PROFILE = Object.freeze({
	compact: 20,
	tail: 75,
	concurrencyRepetitions: 5,
	session: 75,
	soak: 300,
});

export function isRetryableCompactReloadFailure(runResult) {
	return runResult?.status !== 0
		&& !evidenceContainsMeasuredMutation(runResult?.evidence)
		&& /Runtime did not become ready\/verified\/settled after app reload/u.test(
			runResult?.stderr ?? '',
		);
}

export function evaluateStage4Evidence({
	compact,
	tail,
	concurrency,
	jsonl,
	tailBaseline,
	fullTail = false,
	compactOnly = false,
}) {
	const failures = [];
	if (compact?.gate?.ok !== true) failures.push('compact:abba-collection-failed');
	if (compact?.order?.join(',') !== 'baselineA,candidateA,candidateB,baselineB') {
		failures.push('compact:abba-order-invalid');
	}
	for (const [family, metric] of [['create', 'applyOuterWallMs'], ['update', 'applyOuterWallMs']]) {
		for (const percentile of ['p50']) {
			const baselineDrift = absoluteDifferencePercent(
				compact?.legs?.baselineA?.humanOneLineWorkflows?.[family]?.[metric]?.[percentile],
				compact?.legs?.baselineB?.humanOneLineWorkflows?.[family]?.[metric]?.[percentile],
			);
			const candidateDrift = absoluteDifferencePercent(
				compact?.legs?.candidateA?.humanOneLineWorkflows?.[family]?.[metric]?.[percentile],
				compact?.legs?.candidateB?.humanOneLineWorkflows?.[family]?.[metric]?.[percentile],
			);
			if (!(baselineDrift <= 15)) {
				failures.push(`compact:${family}:baseline-leg-${percentile}-drift-over-15-percent`);
			}
			if (!(candidateDrift <= 15)) {
				failures.push(`compact:${family}:candidate-leg-${percentile}-drift-over-15-percent`);
			}
		}
	}
	if (
		compact?.applyPhase?.authoritative !== true
		|| compact?.applyPhase?.metric !== 'applyOuterWallMs'
	) {
		failures.push('compact:apply-phase-evidence-required');
	}
	const sharedCliDigest = compact?.applyPhase?.sharedCliDigest;
	if (
		typeof sharedCliDigest !== 'string'
		|| !Object.values(compact?.legs ?? {}).every(
			leg => leg?.artifacts?.cli?.sha256 === sharedCliDigest,
		)
	) failures.push('compact:shared-cli-digest-mismatch');
	for (const legName of ['baselineA', 'candidateA', 'candidateB', 'baselineB']) {
		for (const family of ['create', 'update']) {
			const legSummary = compact?.legs?.[legName]?.humanOneLineWorkflows?.[family];
			const legSamples = compact?.legs?.[legName]?.humanOneLineSamples?.[family] ?? [];
			const finiteApplySamples = legSamples.filter(
				value => value?.ok === true && Number.isFinite(value.applyOuterWallMs),
			);
			if (
				legSummary?.attempts !== 10
				|| legSummary?.successes !== 10
				|| legSamples.length !== 10
				|| finiteApplySamples.length !== 10
			) failures.push(`compact:${legName}:${family}:10-of-10-required`);
		}
	}
	for (const [kind, legNames] of [
		['baseline', ['baselineA', 'baselineB']],
		['candidate', ['candidateA', 'candidateB']],
	]) {
		for (const family of ['create', 'update']) {
			const values = legNames.flatMap(name => (
				compact?.legs?.[name]?.humanOneLineSamples?.[family] ?? []
			)).filter(value => value?.ok === true && Number.isFinite(value.applyOuterWallMs));
			const summary = compact?.[kind]?.humanOneLineWorkflows?.[family]?.applyOuterWallMs;
			if (
				summary?.samples !== values.length
				|| summary?.p50 !== percentile(values.map(value => value.applyOuterWallMs), 0.5)
				|| summary?.p95 !== percentile(values.map(value => value.applyOuterWallMs), 0.95)
			) failures.push(`compact:${kind}:${family}:merged-apply-summary-mismatch`);
		}
	}
	for (const family of ['create', 'update']) {
		const candidateSummary = compact?.candidate?.humanOneLineWorkflows?.[family];
		const baselineSummary = compact?.baseline?.humanOneLineWorkflows?.[family];
		if (
			candidateSummary?.attempts !== STAGE4_PROFILE.compact
			|| candidateSummary?.successes !== STAGE4_PROFILE.compact
			|| baselineSummary?.attempts !== STAGE4_PROFILE.compact
			|| baselineSummary?.successes !== STAGE4_PROFILE.compact
		) {
			failures.push(`compact:${family}:baseline-and-candidate-20-of-20-required`);
		}
		if (candidateSummary?.runtimeCalls?.p50 !== 3 || candidateSummary?.runtimeCalls?.max !== 3) {
			failures.push(`compact:${family}:three-dispatches-required`);
		}
	}
	const improvedApplyFamilies = [
		['create', 'create'],
		['update', 'update'],
	].filter(([baselineName, candidateName]) => {
		const baseline = compact?.baseline?.humanOneLineWorkflows?.[baselineName]?.applyOuterWallMs;
		const candidate = compact?.candidate?.humanOneLineWorkflows?.[candidateName]?.applyOuterWallMs;
		return improvementPercent(baseline?.p50, candidate?.p50) >= 10
			&& improvementPercent(baseline?.p95, candidate?.p95) >= 10;
	});
	if (improvedApplyFamilies.length === 0) {
		failures.push('compact:apply-family-p50-and-p95-improvement-below-10-percent');
	}
	for (const [scenario, candidateSummary] of Object.entries(
		compact?.candidate?.humanOneLineWorkflows ?? {},
	)) {
		const baselineSummary = compact?.baseline?.humanOneLineWorkflows?.[scenario];
		for (const [metric, limit] of [['p50', 10], ['p95', 15]]) {
			const before = baselineSummary?.outerWallMs?.[metric];
			const after = candidateSummary?.outerWallMs?.[metric];
			if (
				Number.isFinite(before)
				&& before > 0
				&& Number.isFinite(after)
				&& (after - before) / before * 100 > limit
			) failures.push(`compact:${scenario}:outer-${metric}-regressed-over-${limit}-percent`);
		}
		if (candidateSummary?.outerWallMs?.max > 5_000) {
			failures.push(`compact:${scenario}:warm-total-over-5s`);
		}
	}
	if (compactOnly) {
		return { ok: failures.length === 0, failures: [...new Set(failures)] };
	}

	if (tail?.status !== 'collected' || tail?.samples !== (fullTail ? 300 : STAGE4_PROFILE.tail)) {
		failures.push(`tail:${fullTail ? 300 : STAGE4_PROFILE.tail}-of-${
			fullTail ? 300 : STAGE4_PROFILE.tail
		}-required`);
	}
	if (!fullTail && Object.hasOwn(tail?.totalMs ?? {}, 'p99')) {
		failures.push('tail:p99-standard-profile-forbidden');
	}
	for (const metric of ['p50', 'p95', 'max']) {
		if (!Number.isFinite(tail?.totalMs?.[metric])) {
			failures.push(`tail:candidate-${metric}-required`);
		}
	}
	if (fullTail && !Number.isFinite(tail?.totalMs?.p99)) {
		failures.push('tail:p99-full-profile-required');
	}
	if (
		!Number.isFinite(tailBaseline?.totalMs?.p95)
	) {
		failures.push('tail:baseline-p95-required');
	} else if (
		Number.isFinite(tail?.totalMs?.p95)
		&& tail.totalMs.p95 > tailBaseline.totalMs.p95 * 1.15
	) failures.push('tail:p95-regressed-over-15-percent');

	const scenarios = concurrency?.scenarios ?? [];
	if (scenarios.length !== 20) failures.push('concurrency:20-cells-required');
	for (const writers of [3, 6]) {
		for (const mode of ['sequential', 'parallel']) {
			const cell = scenarios.filter(value => value.writers === writers && value.mode === mode);
			if (cell.length !== STAGE4_PROFILE.concurrencyRepetitions) {
				failures.push(`concurrency:${writers}-${mode}:5-of-5-required`);
				continue;
			}
			for (const sample of cell) {
				if (!Array.isArray(sample.outcomes) || sample.outcomes.length !== writers) {
					failures.push(`concurrency:${writers}-${mode}:outcome-count`);
				}
				if (sample.successes !== writers) {
					failures.push(`concurrency:${writers}-${mode}:writer-correctness`);
				}
				for (const outcome of sample.outcomes ?? []) {
					if (
						outcome.terminalStatus !== 'applied'
						|| outcome.postflightStatus !== 'verified'
						|| outcome.finalVerified !== true
						|| outcome.recoveryAttempted === true
					) failures.push(`concurrency:${writers}-${mode}:unverified-or-recovered`);
					if ((outcome.freshPreviewCount ?? 0) > 0) {
						failures.push(`concurrency:${writers}-${mode}:stale-contention-refresh`);
					}
					if (!Number.isFinite(outcome.writerWallMs) || outcome.writerWallMs >= 5_000) {
						failures.push(`concurrency:${writers}-${mode}:writer-over-5s`);
					}
				}
			}
		}
	}

	if (jsonl?.status !== 'collected') failures.push('jsonl:not-collected');
	for (const phase of ['warmReads', 'throughput']) {
		if (jsonl?.[phase]?.attempts !== STAGE4_PROFILE.session
			|| jsonl?.[phase]?.successes !== STAGE4_PROFILE.session) {
			failures.push(`jsonl:${phase}:75-of-75-required`);
		}
	}
	const leak = jsonl?.leakCharacterization;
	if (leak?.attempts !== STAGE4_PROFILE.soak || leak?.successes !== STAGE4_PROFILE.soak) {
		failures.push('jsonl:soak:300-of-300-required');
	}
	if (!Number.isFinite(leak?.rssDeltaBytes) || leak.rssDeltaBytes >= 20 * MIB) {
		failures.push('jsonl:rss-growth-over-20-mib');
	}
	if (!Number.isFinite(leak?.fdDelta) || leak.fdDelta > 0) failures.push('jsonl:fd-leak');
	if (leak?.pendingRequestsAfter !== 0) failures.push('jsonl:request-state-leak');

	return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function improvementPercent(baseline, candidate) {
	if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(candidate)) return null;
	return (baseline - candidate) / baseline * 100;
}

function absoluteDifferencePercent(left, right) {
	if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right)) return null;
	return Math.abs(right - left) / left * 100;
}

function percentile(values, fraction) {
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (finite.length === 0) return null;
	const rank = Math.ceil(fraction * finite.length) - 1;
	return finite[Math.max(0, Math.min(finite.length - 1, rank))];
}

function evidenceContainsMeasuredMutation(evidence) {
	return (evidence?.measuredMutationCount ?? 0) > 0
		|| Object.values(evidence?.humanOneLineWorkflows ?? {}).some(
			summary => (summary?.attempts ?? 0) > 0,
		) || (evidence?.correctnessSamples?.length ?? 0) > 0
		|| (evidence?.rawSamples?.length ?? 0) > 0;
}
