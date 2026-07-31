const MIB = 1024 * 1024;

export const STAGE5_PROFILE = Object.freeze({
	probe: 5,
	reads: 20,
	compact: 20,
	session: 75,
	skillWorkflow: 20,
	soak: 300,
});

export function evaluateStage5Evidence({ probe, reads, compact, session, skillWorkflow }) {
	const failures = [];
	if (
		probe?.authoritativeForGates !== false
		|| probe?.families?.create?.attempts !== STAGE5_PROFILE.probe
		|| probe?.families?.update?.attempts !== STAGE5_PROFILE.probe
	) failures.push('probe:five-diagnostic-samples-per-compact-family-required');
	for (const family of ['create', 'update']) {
		if (probe?.families?.[family]?.linked !== STAGE5_PROFILE.probe) {
			failures.push(`probe:${family}:request-scenario-phase-dispatch-sample-linkage`);
		}
		if (probe?.families?.[family]?.cliLinkedSamples !== STAGE5_PROFILE.probe) {
			failures.push(`probe:${family}:cli-request-scenario-phase-dispatch-sample-linkage`);
		}
		const cliSpans = new Set(
			(probe?.families?.[family]?.cliSubspans ?? []).map(value => value.span),
		);
		for (const span of [
			'command-resolution',
			'config-load-decode',
			'vault-resolution',
			'invocation-build',
			'request-serialization',
			'request-write',
			'request-fsync',
			'request-link',
			'request-verification',
			'obsidian-spawn-to-close',
			'result-decode-admission',
			'human-rendering',
			'plan-persistence',
		]) {
			if (!cliSpans.has(span)) failures.push(`probe:${family}:cli-span-missing:${span}`);
		}
	}
	for (const route of ['explicitVault', 'profile']) {
		if (
			reads?.candidate?.[route]?.attempts !== STAGE5_PROFILE.reads
			|| reads?.candidate?.[route]?.successes !== STAGE5_PROFILE.reads
		) failures.push(`reads:${route}:20-of-20-required`);
		if (reads?.candidate?.[route]?.traceLinked !== STAGE5_PROFILE.reads) {
			failures.push(`reads:${route}:20-of-20-cli-trace-linkage-required`);
		}
		for (const metric of ['outerWallMs', 'cliTotalMs', 'serviceMs', 'handlerMs']) {
			if (!Number.isFinite(reads?.candidate?.[route]?.[metric]?.p50)) {
				failures.push(`reads:${route}:${metric}-required`);
			}
		}
	}
	if (compact?.order?.join(',') !== 'baselineA,candidateA,candidateB,baselineB') {
		failures.push('compact:abba-order-invalid');
	}
	for (const family of ['create', 'update']) {
		const candidate = compact?.candidate?.[family];
		if (
			candidate?.attempts !== STAGE5_PROFILE.compact
			|| candidate?.successes !== STAGE5_PROFILE.compact
		) failures.push(`compact:${family}:20-of-20-required`);
		if (candidate?.runtimeCalls?.p50 !== 3 || candidate?.runtimeCalls?.max !== 3) {
			failures.push(`compact:${family}:three-dispatches-required`);
		}
		if (candidate?.uncertain !== 0 || candidate?.unverified !== 0) {
			failures.push(`compact:${family}:verified-certain-results-required`);
		}
	}
	const improved = ['create', 'update'].some(family => (
		improvementPercent(
			compact?.baseline?.[family]?.outerWallMs?.p50,
			compact?.candidate?.[family]?.outerWallMs?.p50,
		) >= 5
		&& improvementPercent(
			compact?.baseline?.[family]?.outerWallMs?.p95,
			compact?.candidate?.[family]?.outerWallMs?.p95,
		) >= 5
	));
	if (!improved) failures.push('compact:no-family-improved-p50-and-p95-by-five-percent');
	for (const family of ['create', 'update']) {
		for (const [percentile, limit] of [['p50', 10], ['p95', 15]]) {
			const before = compact?.baseline?.[family]?.outerWallMs?.[percentile];
			const after = compact?.candidate?.[family]?.outerWallMs?.[percentile];
			if (regressionPercent(before, after) > limit) {
				failures.push(`compact:${family}:${percentile}-regressed-over-${limit}-percent`);
			}
		}
	}
	if (
		session?.mixed?.attempts !== STAGE5_PROFILE.session
		|| session?.mixed?.successes !== STAGE5_PROFILE.session
	) failures.push('session:mixed:75-of-75-required');
	if (!(session?.mixed?.requestsPerSecond >= 70)) failures.push('session:mixed:rps-below-70');
	if (!(session?.mixed?.serviceMs?.p95 <= 25)) failures.push('session:mixed:service-p95-over-25ms');
	if (
		!Number.isFinite(session?.mixed?.queueWaitMs?.p50)
		|| !Number.isFinite(session?.mixed?.serviceMs?.p50)
		|| !Number.isFinite(session?.mixed?.wallMs)
	) failures.push('session:queue-service-wall-decomposition-required');
	if (
		session?.soak?.attempts !== STAGE5_PROFILE.soak
		|| session?.soak?.successes !== STAGE5_PROFILE.soak
	) failures.push('session:soak:300-of-300-required');
	if (!(session?.soak?.rssDeltaBytes < 20 * MIB)) failures.push('session:soak:rss-over-20-mib');
	if (session?.soak?.fdDelta !== 0) failures.push('session:soak:fd-leak');
	if (session?.soak?.pendingRequestsAfter !== 0) failures.push('session:soak:pending-request-leak');
	if (
		skillWorkflow?.candidate?.attempts !== STAGE5_PROFILE.skillWorkflow
		|| skillWorkflow?.candidate?.successes !== STAGE5_PROFILE.skillWorkflow
		|| skillWorkflow?.samePlanRef !== STAGE5_PROFILE.skillWorkflow
	) failures.push('skill-workflow:20-of-20-same-plan-required');
	if (!(skillWorkflow?.speedupP50 >= 1.5)) {
		failures.push('skill-workflow:p50-speedup-below-1.5x');
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

function percentile(values, fraction) {
	if (values.length === 0) return null;
	const rank = Math.ceil(fraction * values.length) - 1;
	return values[Math.max(0, Math.min(values.length - 1, rank))];
}

function improvementPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return -Infinity;
	return (before - after) / before * 100;
}

function regressionPercent(before, after) {
	if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return Infinity;
	return (after - before) / before * 100;
}
