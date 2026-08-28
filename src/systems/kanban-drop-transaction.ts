import type { KanbanPreset } from '../types/kanban';
import type { IndexedTask } from '../types/fields';
import type { Pipeline } from '../types/pipeline';

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
		affectedFilePaths?: string[];
		warnings?: readonly {
			readonly code: string;
			readonly message: string;
			readonly path?: string;
		}[];
	};

export type KanbanDropSettlement =
	| 'target'
	| 'recurrence-replacement'
	| 'source'
	| 'uncertain';

export function classifyKanbanDropSettlement(input: {
	readonly targetVerified: boolean;
	readonly recurrenceReplacementVerified: boolean;
	readonly sourceVerified: boolean;
}): KanbanDropSettlement {
	if (input.targetVerified) return 'target';
	if (input.recurrenceReplacementVerified) return 'recurrence-replacement';
	if (input.sourceVerified) return 'source';
	return 'uncertain';
}

export function resolveKanbanRecurrenceReplacementCandidate(input: {
	readonly sourceTask: IndexedTask;
	readonly tasks: readonly IndexedTask[];
	readonly inlineCompletionMode: string | null | undefined;
	readonly hasDuplicateOperonIdConflict: (operonId: string) => boolean;
}): IndexedTask | null {
	if (
		input.inlineCompletionMode !== 'replace-completed'
		|| input.sourceTask.primary.format !== 'inline'
		|| input.sourceTask.primary.lineNumber === undefined
	) return null;
	const seriesId = (input.sourceTask.fieldValues['repeatSeriesId'] ?? '').trim();
	if (!seriesId) return null;
	const candidates = input.tasks.filter(candidate => (
		candidate.operonId !== input.sourceTask.operonId
		&& candidate.checkbox === 'open'
		&& candidate.primary.format === 'inline'
		&& candidate.primary.filePath === input.sourceTask.primary.filePath
		&& candidate.primary.lineNumber === input.sourceTask.primary.lineNumber
		&& (candidate.fieldValues['repeatSeriesId'] ?? '').trim() === seriesId
		&& !input.hasDuplicateOperonIdConflict(candidate.operonId)
	));
	return candidates.length === 1 ? candidates[0] : null;
}

export type KanbanDropSortMode = 'automatic' | 'manual';

export interface KanbanCardOperation {
	readonly id: string;
	readonly taskId: string;
	readonly presetId: string;
	readonly kind: 'drop' | 'status';
	readonly boardSignature: string;
	readonly uiGeneration: number;
}

/**
 * Owns in-flight card mutations without serializing unrelated tasks. UI generations
 * fence late callbacks after a preset switch while ownership still prevents a
 * second mutation for the same task until the first one settles.
 */
export class KanbanCardOperationRegistry {
	private readonly byTaskId = new Map<string, KanbanCardOperation>();
	private sequence = 0;
	private uiGeneration = 0;

	begin(
		taskId: string,
		presetId: string,
		kind: KanbanCardOperation['kind'],
		boardSignature: string,
	): KanbanCardOperation | null {
		if (this.byTaskId.has(taskId)) return null;
		const operation = Object.freeze({
			id: `kanban-card-${kind}-${++this.sequence}`,
			taskId,
			presetId,
			kind,
			boardSignature,
			uiGeneration: this.uiGeneration,
		});
		this.byTaskId.set(taskId, operation);
		return operation;
	}

	isTaskPending(taskId: string): boolean {
		return this.byTaskId.has(taskId);
	}

	owns(operation: KanbanCardOperation): boolean {
		return this.byTaskId.get(operation.taskId)?.id === operation.id;
	}

	isUiCurrent(operation: KanbanCardOperation, presetId: string, boardSignature: string): boolean {
		return this.owns(operation)
			&& operation.uiGeneration === this.uiGeneration
			&& operation.presetId === presetId
			&& operation.boardSignature === boardSignature;
	}

	end(operation: KanbanCardOperation): boolean {
		if (!this.owns(operation)) return false;
		this.byTaskId.delete(operation.taskId);
		return true;
	}

	invalidateUi(): void {
		this.uiGeneration += 1;
	}

	reset(): void {
		this.uiGeneration += 1;
		this.byTaskId.clear();
	}
}

export function buildKanbanDropBoardSignature(preset: KanbanPreset, pipeline: Pipeline | null): string {
	return JSON.stringify({
		preset: {
			id: preset.id,
			pipelineId: preset.pipelineId,
			filterSetId: preset.filterSetId,
			swimlaneBy: preset.swimlaneBy,
			sortMode: preset.sortMode,
			sortRules: preset.sortRules,
			columnSortOverrides: preset.columnSortOverrides ?? [],
		},
		pipeline: pipeline
			? {
				id: pipeline.id,
				name: pipeline.name,
				statuses: pipeline.statuses.map(status => ({
					id: status.id,
					label: status.label,
					isFinished: status.isFinished,
					isCancelled: status.isCancelled,
					isScheduledTarget: status.isScheduledTarget,
					isTrackingTarget: status.isTrackingTarget,
					propertyMapping: status.propertyMapping,
				})),
			}
			: null,
	});
}

export function matchesKanbanDropSource(input: {
	readonly actualStatusId: string | null;
	readonly actualStatusValue: string;
	readonly actualLaneKeys: readonly string[];
	readonly sourceStatusId: string | null;
	readonly sourceStatusValue?: string;
	readonly sourceLaneKey: string;
}): boolean {
	const statusMatches = input.sourceStatusId === null
		? input.actualStatusId === null
			&& input.sourceStatusValue !== undefined
			&& input.actualStatusValue === input.sourceStatusValue
		: input.actualStatusId === input.sourceStatusId;
	return statusMatches
		&& input.actualLaneKeys.includes(input.sourceLaneKey);
}

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
