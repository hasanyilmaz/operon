import type { KanbanPreset } from '../types/kanban';
import type { IndexedTask } from '../types/fields';
import type { Pipeline } from '../types/pipeline';

export type KanbanDropSettlement =
	| 'target'
	| 'recurrence-replacement'
	| 'source'
	| 'uncertain';

export function collectKanbanInPlaceChangedCellKeys(input: {
	readonly previousCellMap: ReadonlyMap<string, readonly IndexedTask[]>;
	readonly nextCellMap: ReadonlyMap<string, readonly IndexedTask[]>;
	readonly previousCellCountMap: ReadonlyMap<string, number>;
	readonly nextCellCountMap: ReadonlyMap<string, number>;
	readonly previousTaskSignatures: ReadonlyMap<string, string>;
	readonly nextTaskSignatures: ReadonlyMap<string, string>;
	readonly forcedCellKeys?: readonly string[];
}): Set<string> {
	const changed = new Set(input.forcedCellKeys ?? []);
	const cellKeys = new Set<string>([
		...input.previousCellMap.keys(),
		...input.nextCellMap.keys(),
		...input.previousCellCountMap.keys(),
		...input.nextCellCountMap.keys(),
	]);
	for (const cellKey of cellKeys) {
		const previousIds = (input.previousCellMap.get(cellKey) ?? []).map(task => task.operonId);
		const nextIds = (input.nextCellMap.get(cellKey) ?? []).map(task => task.operonId);
		if (
			previousIds.length !== nextIds.length
			|| previousIds.some((taskId, index) => taskId !== nextIds[index])
			|| (input.previousCellCountMap.get(cellKey) ?? 0) !== (input.nextCellCountMap.get(cellKey) ?? 0)
		) changed.add(cellKey);
	}

	const changedTaskIds = new Set<string>();
	for (const taskId of new Set([
		...input.previousTaskSignatures.keys(),
		...input.nextTaskSignatures.keys(),
	])) {
		if (input.previousTaskSignatures.get(taskId) !== input.nextTaskSignatures.get(taskId)) {
			changedTaskIds.add(taskId);
		}
	}
	if (changedTaskIds.size === 0) return changed;
	for (const [cellKey, tasks] of [...input.previousCellMap, ...input.nextCellMap]) {
		if (tasks.some(task => changedTaskIds.has(task.operonId))) changed.add(cellKey);
	}
	return changed;
}

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
	readonly phase: 'preflight' | 'target-postflight';
	readonly stage: 'prepare' | 'postflight';
	readonly code: string;
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

export type KanbanDropNoticeKey =
	| 'kanbanMoveStale'
	| 'kanbanMoveNotApplied'
	| 'kanbanMoveUncertain'
	| 'taskSourceUnavailable'
	| 'kanbanActionFailed';

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
		&& (candidate.phase === 'preflight' || candidate.phase === 'target-postflight')
		&& (candidate.stage === 'prepare' || candidate.stage === 'postflight')
		&& typeof candidate.code === 'string'
		? candidate as KanbanDropFailureCause
		: null;
}

export function resolveKanbanDropNoticeKey(error: unknown): KanbanDropNoticeKey {
	const cause = extractKanbanDropFailureCause(error);
	if (!cause) return 'kanbanActionFailed';
	if (cause.code === 'stale-context' || cause.code === 'stale-source') return 'kanbanMoveStale';
	if (cause.code === 'source-missing') return 'taskSourceUnavailable';
	if (cause.code === 'move-not-applied') return 'kanbanMoveNotApplied';
	if (cause.code === 'move-outcome-unknown') return 'kanbanMoveUncertain';
	return 'kanbanActionFailed';
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
