export type KanbanDropTransitionFailureStage = 'prepare' | 'preview' | 'apply';
export type KanbanDropMutationStatus =
	| 'applied'
	| 'already-applied'
	| 'partial'
	| 'failed'
	| 'outcome-unknown';

export type KanbanDropTransitionResult =
	| { ok: true; affectedFilePaths: string[] }
	| {
		ok: false;
		stage: KanbanDropTransitionFailureStage;
		code: string;
		reason: string;
		mutationMayHaveApplied: boolean;
		mutationStatus?: KanbanDropMutationStatus;
	};

export function hasKanbanCompanionPayload(payload: Record<string, string>): boolean {
	return Object.keys(payload).length > 0;
}

export function shouldRetryKanbanDropTransition(
	result: KanbanDropTransitionResult,
): boolean {
	if (result.ok || result.mutationMayHaveApplied) return false;
	if (result.stage === 'preview') return result.code === 'live-settling';
	return result.stage === 'apply'
		&& result.mutationStatus === 'failed'
		&& (result.code === 'stale-context' || result.code === 'live-settling');
}

export async function runKanbanDropTransition(
	attempt: (attemptIndex: number) => Promise<KanbanDropTransitionResult>,
): Promise<KanbanDropTransitionResult> {
	const first = await attempt(0);
	if (!shouldRetryKanbanDropTransition(first)) return first;
	return await attempt(1);
}
