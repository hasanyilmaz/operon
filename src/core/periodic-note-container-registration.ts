import type { PeriodicNoteGuardedDeleteResult } from './periodic-note-service';

export interface PeriodicNoteCreatedFileSnapshot {
	path: string;
	content: string;
}

export type PeriodicNoteContainerRegistrationDisposition =
	| { kind: 'registered' }
	| { kind: 'guarded-rollback'; snapshot: PeriodicNoteCreatedFileSnapshot }
	| { kind: 'recovery-required' };

/**
 * Converts service-owned create evidence into the immutable rollback snapshot.
 * This deliberately never reads the vault after creation: a user edit between
 * create completion and registry registration must not become delete evidence.
 */
export function createPeriodicNoteCreatedFileSnapshot(
	path: string,
	operationOwnedContent: string | undefined,
): PeriodicNoteCreatedFileSnapshot | null {
	return operationOwnedContent === undefined ? null : { path, content: operationOwnedContent };
}

export function resolvePeriodicNoteContainerRegistrationDisposition(
	registration: 'committed' | 'clean-failure' | 'uncertain',
	snapshot: PeriodicNoteCreatedFileSnapshot | null,
): PeriodicNoteContainerRegistrationDisposition {
	if (registration === 'committed') return { kind: 'registered' };
	if (registration === 'clean-failure' && snapshot) {
		return { kind: 'guarded-rollback', snapshot };
	}
	return { kind: 'recovery-required' };
}

export async function rollbackPeriodicNoteCreatedFileSnapshot(
	snapshot: PeriodicNoteCreatedFileSnapshot,
	deleteFileIfContentMatches: (
		path: string,
		expectedContent: string,
	) => Promise<PeriodicNoteGuardedDeleteResult>,
): Promise<PeriodicNoteGuardedDeleteResult> {
	try {
		return await deleteFileIfContentMatches(snapshot.path, snapshot.content);
	} catch {
		return 'failed';
	}
}
