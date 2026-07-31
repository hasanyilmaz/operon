export const OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES = 900_000;
export const OPERON_CLI_EXECUTABLE_HARD_LIMIT_BYTES = 1_000_000;
export const OPERON_CLI_EXECUTABLE_REVIEW_DELTA_BYTES = 25_000;

export function classifyOperonCliExecutableSize(sizeBytes) {
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
		throw new Error('OPERON_CLI_EXECUTABLE_SIZE_INVALID');
	}
	if (sizeBytes >= OPERON_CLI_EXECUTABLE_HARD_LIMIT_BYTES) return 'fail';
	if (sizeBytes >= OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES) return 'warn';
	return 'ok';
}

export function requiresOperonCliBundleContributorReview(deltaBytes) {
	if (!Number.isSafeInteger(deltaBytes)) {
		throw new Error('OPERON_CLI_EXECUTABLE_DELTA_INVALID');
	}
	return deltaBytes > OPERON_CLI_EXECUTABLE_REVIEW_DELTA_BYTES;
}
