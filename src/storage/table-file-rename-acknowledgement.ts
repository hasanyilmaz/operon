export type CanonicalTableFileRenameAcknowledgement =
	| { status: 'candidate'; renameError?: unknown }
	| { status: 'previous'; renameError?: unknown }
	| { status: 'divergent'; renameError?: unknown };

export interface CanonicalTableFileRenameAttempt {
	previousPath: string;
	candidatePath: string;
	renameCandidate: () => Promise<void>;
	getCurrentPath: () => string;
	samePath?: (left: string, right: string) => boolean;
}

/**
 * Rename promises can reject after the vault already moved the file. Classify
 * the file's synchronous post-operation path before deciding whether a token
 * may be retained for the rename event acknowledgement.
 */
export async function renameCanonicalTableFileWithAcknowledgement(
	attempt: CanonicalTableFileRenameAttempt,
): Promise<CanonicalTableFileRenameAcknowledgement> {
	let renameRejected = false;
	let capturedRenameError: unknown;
	try {
		await attempt.renameCandidate();
	} catch (error) {
		renameRejected = true;
		capturedRenameError = error;
	}
	const currentPath = attempt.getCurrentPath();
	const samePath = attempt.samePath ?? ((left, right) => left === right);
	if (samePath(currentPath, attempt.candidatePath)) {
		return renameRejected ? { status: 'candidate', renameError: capturedRenameError } : { status: 'candidate' };
	}
	if (samePath(currentPath, attempt.previousPath)) {
		return renameRejected ? { status: 'previous', renameError: capturedRenameError } : { status: 'previous' };
	}
	return renameRejected ? { status: 'divergent', renameError: capturedRenameError } : { status: 'divergent' };
}
