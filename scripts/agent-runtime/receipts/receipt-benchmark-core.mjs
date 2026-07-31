export const RECEIPT_COUNTS = Object.freeze([1, 16, 64, 256]);
export const RECEIPT_LATENCY_BUDGET_MS = 10;
export const RECEIPT_MIN_SAMPLES_PER_COUNT = 30;

export function percentile(values, fraction) {
	if (!Array.isArray(values) || values.length === 0) return null;
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (finite.length === 0) return null;
	const index = Math.min(finite.length - 1, Math.ceil(fraction * finite.length) - 1);
	return finite[index];
}

function summarizeOperation(values) {
	return {
		min: values.length ? Math.min(...values) : null,
		median: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		max: values.length ? Math.max(...values) : null,
	};
}

export function summarizeStoreSamples(samples) {
	const byCount = {};
	for (const count of RECEIPT_COUNTS) {
		const matching = samples.filter((sample) => sample.count === count && sample.ok === true);
		byCount[count] = {
			attempts: samples.filter((sample) => sample.count === count).length,
			successes: matching.length,
			writeMs: summarizeOperation(matching.map((sample) => sample.writeMs)),
			readMs: summarizeOperation(matching.map((sample) => sample.readMs)),
			deleteMs: summarizeOperation(matching.map((sample) => sample.deleteMs)),
		};
	}
	return byCount;
}

function storeMeetsLatencyBudget(store) {
	if (!store || store.available !== true || store.persistenceVerified !== true) return false;
	if (store.atomicReplacementVerified !== true) return false;
	if (
		store.compositeKeyVerified !== true
		|| store.retentionVerified !== true
		|| store.expiryVerified !== true
		|| store.payloadValidationVerified !== true
	) {
		return false;
	}
	return RECEIPT_COUNTS.every((count) => {
		const summary = store.byCount?.[count];
		return summary?.successes === summary?.attempts
			&& summary.attempts >= RECEIPT_MIN_SAMPLES_PER_COUNT
			&& summary.writeMs?.p95 <= RECEIPT_LATENCY_BUDGET_MS
			&& summary.readMs?.p95 <= RECEIPT_LATENCY_BUDGET_MS
			&& summary.deleteMs?.p95 <= RECEIPT_LATENCY_BUDGET_MS;
	});
}

export function selectReceiptStore(evidence) {
	if (storeMeetsLatencyBudget(evidence?.indexedDb)) {
		return {
			store: "indexeddb",
			receiptCapabilitiesAllowed: true,
			reason: "INDEXEDDB_MEETS_TRANSACTIONAL_PERSISTENCE_AND_LATENCY_GATES",
		};
	}
	if (storeMeetsLatencyBudget(evidence?.localStorage)) {
		return {
			store: "localstorage",
			receiptCapabilitiesAllowed: true,
			reason: "LOCALSTORAGE_MEETS_SINGLE_KEY_PERSISTENCE_AND_LATENCY_GATES",
		};
	}
	return {
		store: null,
		receiptCapabilitiesAllowed: false,
		reason: "NO_MACHINE_LOCAL_STORE_MEETS_RECEIPT_GATES",
	};
}
