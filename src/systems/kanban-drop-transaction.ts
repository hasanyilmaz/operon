export type KanbanDropTransitionFailureStage = 'prepare' | 'preview' | 'apply';
export type KanbanDropMutationStatus =
	| 'applied'
	| 'already-applied'
	| 'partial'
	| 'failed'
	| 'outcome-unknown';

export type KanbanDropTransitionResult =
	| {
		ok: true;
		affectedFilePaths: string[];
		warnings?: readonly {
			readonly code: string;
			readonly message: string;
			readonly path?: string;
		}[];
	}
	| {
		ok: false;
		stage: KanbanDropTransitionFailureStage;
		code: string;
		reason: string;
		mutationMayHaveApplied: boolean;
		mutationStatus?: KanbanDropMutationStatus;
	};

export type KanbanDropSortMode = 'automatic' | 'manual';

export interface KanbanDropFailureCause {
	readonly kind: 'kanban-drop-failure-cause';
	readonly phase: 'transition' | 'target-postflight';
	readonly attemptCount: number;
	readonly stage: KanbanDropTransitionFailureStage | null;
	readonly code: string;
	readonly mutationMayHaveApplied: boolean;
	readonly mutationStatus: KanbanDropMutationStatus | null;
}

export interface KanbanDropFailureDiagnostic {
	readonly kind: 'kanban-drop-failure';
	readonly taskId: string;
	readonly presetId: string;
	readonly sourceStatusId: string | null;
	readonly targetStatusId: string;
	readonly sourceLaneKey: string;
	readonly targetLaneKey: string;
	readonly sourceSortMode: KanbanDropSortMode | null;
	readonly targetSortMode: KanbanDropSortMode;
	readonly manualOrderPathActive: boolean;
	readonly failure: KanbanDropFailureCause | null;
}

export function attachKanbanDropFailureCause(
	error: Error,
	cause: Omit<KanbanDropFailureCause, 'kind'>,
): Error {
	Object.defineProperty(error, 'cause', {
		configurable: true,
		enumerable: false,
		value: Object.freeze({ kind: 'kanban-drop-failure-cause' as const, ...cause }),
		writable: true,
	});
	return error;
}

function extractKanbanDropFailureCause(error: unknown): KanbanDropFailureCause | null {
	if (!(error instanceof Error) || !('cause' in error)) return null;
	const cause = (error as Error & { cause?: unknown }).cause;
	if (!cause || typeof cause !== 'object') return null;
	const candidate = cause as Partial<KanbanDropFailureCause>;
	return candidate.kind === 'kanban-drop-failure-cause'
		&& (candidate.phase === 'transition' || candidate.phase === 'target-postflight')
		&& typeof candidate.attemptCount === 'number'
		&& (candidate.stage === null || candidate.stage === 'prepare' || candidate.stage === 'preview' || candidate.stage === 'apply')
		&& typeof candidate.code === 'string'
		&& typeof candidate.mutationMayHaveApplied === 'boolean'
		&& (candidate.mutationStatus === null
			|| candidate.mutationStatus === 'applied'
			|| candidate.mutationStatus === 'already-applied'
			|| candidate.mutationStatus === 'partial'
			|| candidate.mutationStatus === 'failed'
			|| candidate.mutationStatus === 'outcome-unknown')
		? candidate as KanbanDropFailureCause
		: null;
}

export function buildKanbanDropFailureDiagnostic(input: {
	readonly taskId: string;
	readonly presetId: string;
	readonly sourceStatusId: string | null;
	readonly targetStatusId: string;
	readonly sourceLaneKey: string;
	readonly targetLaneKey: string;
	readonly sourceSortMode: KanbanDropSortMode | null;
	readonly targetSortMode: KanbanDropSortMode;
	readonly error: unknown;
}): KanbanDropFailureDiagnostic {
	return Object.freeze({
		kind: 'kanban-drop-failure',
		taskId: input.taskId,
		presetId: input.presetId,
		sourceStatusId: input.sourceStatusId,
		targetStatusId: input.targetStatusId,
		sourceLaneKey: input.sourceLaneKey,
		targetLaneKey: input.targetLaneKey,
		sourceSortMode: input.sourceSortMode,
		targetSortMode: input.targetSortMode,
		manualOrderPathActive: input.sourceSortMode === 'manual' || input.targetSortMode === 'manual',
		failure: extractKanbanDropFailureCause(input.error),
	});
}

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
