import assert from "node:assert/strict";
import test from "node:test";
import {
	RECEIPT_COUNTS,
	percentile,
	selectReceiptStore,
	summarizeStoreSamples,
} from "./receipt-benchmark-core.mjs";

function samples(milliseconds, ok = true) {
	return RECEIPT_COUNTS.flatMap((count) => Array.from({ length: 30 }, () => ({
		count,
		ok,
		writeMs: milliseconds,
		readMs: milliseconds,
		deleteMs: milliseconds,
	})));
}

function store(milliseconds, overrides = {}) {
	return {
		available: true,
		persistenceVerified: true,
		atomicReplacementVerified: true,
		compositeKeyVerified: true,
		retentionVerified: true,
		expiryVerified: true,
		payloadValidationVerified: true,
		byCount: summarizeStoreSamples(samples(milliseconds)),
		...overrides,
	};
}

test("percentile uses the nearest-rank result", () => {
	assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
	assert.equal(percentile([], 0.95), null);
});

test("IndexedDB is preferred when it meets every gate", () => {
	assert.deepEqual(selectReceiptStore({
		indexedDb: store(2),
		localStorage: store(1),
	}), {
		store: "indexeddb",
		receiptCapabilitiesAllowed: true,
		reason: "INDEXEDDB_MEETS_TRANSACTIONAL_PERSISTENCE_AND_LATENCY_GATES",
	});
});

test("localStorage is the bounded fallback", () => {
	assert.equal(selectReceiptStore({
		indexedDb: store(11),
		localStorage: store(3),
	}).store, "localstorage");
});

test("receipt capabilities remain unavailable when persistence is unverified", () => {
	assert.deepEqual(selectReceiptStore({
		indexedDb: store(2, { persistenceVerified: false }),
		localStorage: store(2, { atomicReplacementVerified: false }),
	}), {
		store: null,
		receiptCapabilitiesAllowed: false,
		reason: "NO_MACHINE_LOCAL_STORE_MEETS_RECEIPT_GATES",
	});
});

test("a single failed sample closes the store gate", () => {
	const failedSamples = samples(2);
	failedSamples[0] = { ...failedSamples[0], ok: false };
	assert.equal(selectReceiptStore({
		indexedDb: {
			available: true,
			persistenceVerified: true,
			atomicReplacementVerified: true,
			compositeKeyVerified: true,
			retentionVerified: true,
			expiryVerified: true,
			payloadValidationVerified: true,
			byCount: summarizeStoreSamples(failedSamples),
		},
	}).store, null);
});

test("truncated sample evidence cannot authorize receipt capabilities", () => {
	const truncated = RECEIPT_COUNTS.flatMap((count) => [{
		count,
		ok: true,
		writeMs: 1,
		readMs: 1,
		deleteMs: 1,
	}]);
	assert.equal(selectReceiptStore({
		indexedDb: store(1, { byCount: summarizeStoreSamples(truncated) }),
	}).store, null);
});

test("key scope, retention, expiry, and payload proofs are mandatory", () => {
	for (const missingGate of [
		"compositeKeyVerified",
		"retentionVerified",
		"expiryVerified",
		"payloadValidationVerified",
	]) {
		assert.equal(selectReceiptStore({
			indexedDb: store(1, { [missingGate]: false }),
		}).store, null);
	}
});
