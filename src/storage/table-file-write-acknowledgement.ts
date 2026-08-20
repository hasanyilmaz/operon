export type CanonicalTableFileWriteAcknowledgement =
	| { status: 'candidate'; writeError?: unknown }
	| { status: 'previous'; writeError?: unknown }
	| { status: 'divergent'; writeError?: unknown }
	| { status: 'unreadable'; writeError?: unknown; readError: unknown };

export interface CanonicalTableFileWriteAttempt {
	previous: string;
	candidate: string;
	writeCandidate: () => Promise<void>;
	readCurrent: () => Promise<string>;
}

/**
 * A verification failure may require a conditional restore at a renamed path.
 * The original candidate token must never survive alongside the restore token.
 */
export function prepareCanonicalTableFileRestoreExpectedHash(
	expectedHashes: Map<string, string>,
	originalPathKey: string,
	restorePathKey: string,
	previousHash: string,
): void {
	expectedHashes.delete(originalPathKey);
	expectedHashes.set(restorePathKey, previousHash);
}

/**
 * A vault adapter may write successfully and still reject the caller, or may
 * resolve before its write becomes durable. Every outcome receives an exact
 * readback classification before the caller may continue or recover.
 */
export async function writeCanonicalTableFileWithAcknowledgement(
	attempt: CanonicalTableFileWriteAttempt,
): Promise<CanonicalTableFileWriteAcknowledgement> {
	let writeRejected = false;
	let capturedWriteError: unknown;
	try {
		await attempt.writeCandidate();
	} catch (error) {
		writeRejected = true;
		capturedWriteError = error;
	}
	let current: string;
	try {
		current = await attempt.readCurrent();
	} catch (readError) {
		return writeRejected
			? { status: 'unreadable', writeError: capturedWriteError, readError }
			: { status: 'unreadable', readError };
	}
	if (current === attempt.candidate) {
		return writeRejected ? { status: 'candidate', writeError: capturedWriteError } : { status: 'candidate' };
	}
	if (current === attempt.previous) {
		return writeRejected ? { status: 'previous', writeError: capturedWriteError } : { status: 'previous' };
	}
	return writeRejected ? { status: 'divergent', writeError: capturedWriteError } : { status: 'divergent' };
}
