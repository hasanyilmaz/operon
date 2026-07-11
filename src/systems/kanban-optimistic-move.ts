import { IndexedTask } from '../types/fields';
import { isBuiltInKanbanSwimlaneBy, KanbanDropContext, KanbanPreset } from '../types/kanban';
import { Pipeline, composeStatusValue } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { KeyMapping } from '../types/settings';
import { parseListValue } from '../core/parser';
import { getManagedCustomFieldOptionMapping } from '../core/managed-task-fields';
import {
	buildKanbanCellKey,
	buildKanbanTaskComparator,
	extractLaneKeys,
	KanbanBoardData,
	KANBAN_NO_VALUE_KEY,
	resolveTaskStatusDefinition,
} from './kanban-query';
import { buildOptimisticStatusPatch } from './optimistic-status-patch';

export const KANBAN_OPTIMISTIC_MOVE_TTL_MS = 15_000;

export type KanbanOptimisticMoveKind = 'drop' | 'status';

export interface KanbanOptimisticMove extends KanbanDropContext {
	kind: KanbanOptimisticMoveKind;
	sourceLaneKeys: string[];
	targetLaneKeys: string[];
	statusValue?: string;
	checkbox?: IndexedTask['checkbox'];
	expiresAt: number;
}

export interface KanbanOptimisticStatusMovePlan {
	move: KanbanOptimisticMove;
	nextStatus: string;
	nextCheckbox: IndexedTask['checkbox'];
	sourceLaneKeys: string[];
	targetStatusId: string;
}

interface KanbanDropOptimisticMoveOptions {
	task?: IndexedTask | null;
	keyMappings?: readonly KeyMapping[];
	priorities?: readonly { label: string }[];
}

export type KanbanOptimisticStatusFallbackReason =
	| 'task-missing'
	| 'preset-missing'
	| 'pipeline-missing'
	| 'context-status-mismatch'
	| 'context-lane-mismatch'
	| 'next-status-unavailable'
	| 'target-status-missing'
	| 'source-lane-missing';

export function buildKanbanOptimisticStatusMovePlan(options: {
	task: IndexedTask | null | undefined;
	pipeline: Pipeline | null | undefined;
	preset: KanbanPreset | null | undefined;
	pipelines: Pipeline[];
	keyMappings?: readonly KeyMapping[];
	priorities?: readonly { label: string }[];
	sourceStatusId: string | null | undefined;
	sourceLaneKey: string | null | undefined;
}): KanbanOptimisticStatusMovePlan | { move: null; fallbackReason: KanbanOptimisticStatusFallbackReason } {
	const { task, pipeline, preset, pipelines, sourceStatusId, sourceLaneKey } = options;
	const keyMappings = options.keyMappings ?? [];
	const priorities = options.priorities ?? [];
	if (!task) return { move: null, fallbackReason: 'task-missing' };
	if (!preset) return { move: null, fallbackReason: 'preset-missing' };
	if (!pipeline) return { move: null, fallbackReason: 'pipeline-missing' };
	if (!sourceStatusId) return { move: null, fallbackReason: 'context-status-mismatch' };

	const currentStatus = resolveTaskStatusDefinition(task, pipeline, pipelines);
	if (currentStatus?.id !== sourceStatusId) {
		return { move: null, fallbackReason: 'context-status-mismatch' };
	}

	const sourceLaneKeys = uniqueStrings(extractLaneKeys(task, preset.swimlaneBy, keyMappings, priorities));
	if (sourceLaneKeys.length === 0) return { move: null, fallbackReason: 'source-lane-missing' };
	if (sourceLaneKey && !sourceLaneKeys.includes(sourceLaneKey)) {
		return { move: null, fallbackReason: 'context-lane-mismatch' };
	}

	const optimistic = buildOptimisticStatusPatch(task, { pipelines });
	if (!optimistic) return { move: null, fallbackReason: 'next-status-unavailable' };

	const targetStatus = pipeline.statuses.find(status => composeStatusValue(pipeline.name, status.label) === optimistic.nextStatus) ?? null;
	if (!targetStatus) return { move: null, fallbackReason: 'target-status-missing' };

	return {
		move: {
			kind: 'status',
			taskId: task.operonId,
			sourceStatusId,
			sourceLaneKey: sourceLaneKey ?? sourceLaneKeys[0],
			sourceLaneKeys,
			targetStatusId: targetStatus.id,
			targetLaneKey: sourceLaneKey ?? sourceLaneKeys[0],
			targetLaneKeys: sourceLaneKeys,
			targetBeforeTaskId: null,
			swimlaneBy: preset.swimlaneBy,
			statusValue: optimistic.nextStatus,
			checkbox: optimistic.nextCheckbox,
			expiresAt: Date.now() + KANBAN_OPTIMISTIC_MOVE_TTL_MS,
		},
		nextStatus: optimistic.nextStatus,
		nextCheckbox: optimistic.nextCheckbox,
		sourceLaneKeys,
		targetStatusId: targetStatus.id,
	};
}

export function createKanbanDropOptimisticMove(
	context: KanbanDropContext,
	options: KanbanDropOptimisticMoveOptions = {},
): KanbanOptimisticMove {
	const keyMappings = options.keyMappings ?? [];
	const priorities = options.priorities ?? [];
	const sourceLaneKeys = options.task
		? uniqueStrings(extractLaneKeys(options.task, context.swimlaneBy, keyMappings, priorities))
		: [context.sourceLaneKey];
	const targetLaneKeys = options.task
		? uniqueStrings(extractLaneKeys(
			buildOptimisticDroppedTask(options.task, context, context.targetLaneKey, keyMappings),
			context.swimlaneBy,
			keyMappings,
			priorities,
		))
		: [context.targetLaneKey];
	return {
		...context,
		kind: 'drop',
		sourceLaneKeys: sourceLaneKeys.length > 0 ? sourceLaneKeys : [context.sourceLaneKey],
		targetLaneKeys: targetLaneKeys.length > 0 ? targetLaneKeys : [context.targetLaneKey],
		expiresAt: Date.now() + KANBAN_OPTIMISTIC_MOVE_TTL_MS,
	};
}

export function shouldApplyImmediateKanbanCardDrop(isTargetCollapsed: boolean): boolean {
	return !isTargetCollapsed;
}

export function isKanbanOptimisticMoveSatisfied(
	task: IndexedTask,
	pipeline: Pipeline | null,
	preset: KanbanPreset,
	move: KanbanOptimisticMove,
	keyMappings: readonly KeyMapping[] = [],
	pipelines: readonly Pipeline[] = pipeline ? [pipeline] : [],
	priorities: readonly { label: string }[] = [],
): boolean {
	if (!pipeline) return false;
	const status = resolveTaskStatusDefinition(task, pipeline, pipelines);
	if (status?.id !== move.targetStatusId) return false;
	const laneKeys = extractLaneKeys(task, preset.swimlaneBy, keyMappings, priorities);
	return move.targetLaneKeys.every(laneKey => laneKeys.includes(laneKey));
}

export function applyKanbanOptimisticMovesToBoard(
	board: KanbanBoardData,
	priorities: PriorityDefinition[],
	moves: Iterable<KanbanOptimisticMove>,
	keyMappings: readonly KeyMapping[] = [],
): void {
	const isManualOrder = board.preset.sortMode === 'manual';
	const comparator = buildKanbanTaskComparator({
		preset: board.preset,
		priorities,
		keyMappings,
	});

	for (const move of moves) {
		const task = board.relevantTasks.find(entry => entry.operonId === move.taskId) ?? null;
		if (!task) continue;

		const sourceLaneKeys = uniqueStrings(move.sourceLaneKeys.length > 0 ? move.sourceLaneKeys : [move.sourceLaneKey]);
		const targetLaneKeys = uniqueStrings(move.targetLaneKeys.length > 0 ? move.targetLaneKeys : [move.targetLaneKey]);
		const sourceKeys = move.sourceStatusId
			? sourceLaneKeys.map(laneKey => buildKanbanCellKey(move.sourceStatusId!, laneKey))
			: [];
		const targetKeys = targetLaneKeys.map(laneKey => buildKanbanCellKey(move.targetStatusId, laneKey));
		const sameCells = areStringSetsEqual(sourceKeys, targetKeys);
		if (sameCells && !isManualOrder) continue;

		for (const sourceKey of sourceKeys) {
			removeTaskFromBoardCell(board, sourceKey, move.taskId);
			if (!sameCells) incrementCellCount(board, sourceKey, -1);
		}
		if (!sameCells) {
			for (const targetKey of targetKeys) {
				incrementCellCount(board, targetKey, 1);
			}
		}

		if (!sameCells && move.sourceStatusId && move.sourceStatusId !== move.targetStatusId) {
			incrementColumnCount(board, move.sourceStatusId, -1);
			incrementColumnCount(board, move.targetStatusId, 1);
		}

		if (!sameCells) {
			for (const laneKey of sourceLaneKeys) {
				if (!targetLaneKeys.includes(laneKey)) incrementLaneCount(board, laneKey, -1);
			}
			for (const laneKey of targetLaneKeys) {
				if (!sourceLaneKeys.includes(laneKey)) incrementLaneCount(board, laneKey, 1);
			}
		}

		for (const targetLaneKey of targetLaneKeys) {
			const targetKey = buildKanbanCellKey(move.targetStatusId, targetLaneKey);
			const targetTask = buildOptimisticMovedTask(task, move, board, keyMappings);
			const targetTasks = board.cellMap.get(targetKey) ?? [];
			if (isManualOrder) {
				insertManualOptimisticTask(targetTasks, targetTask, move.targetBeforeTaskId);
			} else {
				const existingIndex = targetTasks.findIndex(entry => entry.operonId === targetTask.operonId);
				if (existingIndex >= 0) {
					targetTasks[existingIndex] = targetTask;
				} else {
					targetTasks.push(targetTask);
				}
				targetTasks.sort(comparator);
			}
			board.cellMap.set(targetKey, targetTasks);
		}
	}
}

function insertManualOptimisticTask(
	tasks: IndexedTask[],
	task: IndexedTask,
	beforeTaskId: string | null,
): void {
	const nextTasks = tasks.filter(entry => entry.operonId !== task.operonId);
	const beforeIndex = beforeTaskId
		? nextTasks.findIndex(entry => entry.operonId === beforeTaskId)
		: -1;
	if (beforeIndex >= 0) {
		nextTasks.splice(beforeIndex, 0, task);
	} else {
		nextTasks.push(task);
	}
	tasks.splice(0, tasks.length, ...nextTasks);
}

function buildOptimisticMovedTask(
	task: IndexedTask,
	move: KanbanOptimisticMove,
	board: KanbanBoardData,
	keyMappings: readonly KeyMapping[],
): IndexedTask {
	const targetColumn = board.columns.find(column => column.statusId === move.targetStatusId);
	const movedTask = move.kind === 'drop'
		? buildOptimisticDroppedTask(
			task,
			move,
			move.targetLaneKey,
			keyMappings,
		)
		: task;
	const fieldValues = { ...movedTask.fieldValues };
	if (targetColumn) fieldValues['status'] = targetColumn.statusValue;
	return {
		...movedTask,
		checkbox: move.kind === 'status' ? (move.checkbox ?? task.checkbox) : task.checkbox,
		fieldValues,
	};
}

function buildOptimisticDroppedTask(
	task: IndexedTask,
	move: Pick<KanbanDropContext, 'sourceLaneKey' | 'swimlaneBy'>,
	targetLaneKey: string,
	keyMappings: readonly KeyMapping[],
): IndexedTask {
	if (!move.swimlaneBy) return task;
	const targetIsNoValue = targetLaneKey === KANBAN_NO_VALUE_KEY;
	if (move.swimlaneBy === 'tags') {
		const nextTags = new Set(task.tags.map(value => value.trim()).filter(Boolean));
		if (move.sourceLaneKey && move.sourceLaneKey !== KANBAN_NO_VALUE_KEY) {
			nextTags.delete(move.sourceLaneKey);
		}
		if (!targetIsNoValue) {
			nextTags.add(targetLaneKey);
		}
		return {
			...task,
			tags: Array.from(nextTags),
		};
	}

	const fieldValues = { ...task.fieldValues };
	if (move.swimlaneBy === 'contexts' || move.swimlaneBy === 'assignees') {
		fieldValues[move.swimlaneBy] = buildOptimisticListLaneValue(
			task.fieldValues[move.swimlaneBy] ?? '',
			move.sourceLaneKey,
			targetLaneKey,
		);
		return { ...task, fieldValues };
	}

	const customSwimlaneMapping = getManagedCustomFieldOptionMapping(move.swimlaneBy, keyMappings);
	if (customSwimlaneMapping?.type === 'list') {
		fieldValues[customSwimlaneMapping.canonicalKey] = buildOptimisticListLaneValue(
			task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '',
			move.sourceLaneKey,
			targetLaneKey,
		);
		return { ...task, fieldValues };
	}
	if (customSwimlaneMapping) {
		fieldValues[customSwimlaneMapping.canonicalKey] = targetIsNoValue ? '' : targetLaneKey;
		return { ...task, fieldValues };
	}
	if (isBuiltInKanbanSwimlaneBy(move.swimlaneBy)) {
		fieldValues[move.swimlaneBy] = targetIsNoValue ? '' : targetLaneKey;
		return { ...task, fieldValues };
	}
	return task;
}

function buildOptimisticListLaneValue(
	rawValue: string,
	sourceLaneKey: string | null | undefined,
	targetLaneKey: string,
): string {
	const nextValues = new Set(parseListValue(rawValue));
	if (sourceLaneKey && sourceLaneKey !== KANBAN_NO_VALUE_KEY) {
		nextValues.delete(sourceLaneKey);
	}
	if (targetLaneKey !== KANBAN_NO_VALUE_KEY) {
		nextValues.add(targetLaneKey);
	}
	return Array.from(nextValues).join('; ');
}

function removeTaskFromBoardCell(board: KanbanBoardData, cellKey: string, taskId: string): void {
	const tasks = board.cellMap.get(cellKey);
	if (!tasks) return;
	const nextTasks = tasks.filter(task => task.operonId !== taskId);
	if (nextTasks.length === 0) {
		board.cellMap.delete(cellKey);
		return;
	}
	board.cellMap.set(cellKey, nextTasks);
}

function incrementCellCount(board: KanbanBoardData, cellKey: string, delta: number): void {
	const nextCount = Math.max(0, (board.cellCountMap.get(cellKey) ?? 0) + delta);
	board.cellCountMap.set(cellKey, nextCount);
}

function incrementColumnCount(board: KanbanBoardData, statusId: string, delta: number): void {
	const column = board.columns.find(entry => entry.statusId === statusId);
	if (!column) return;
	column.count = Math.max(0, column.count + delta);
}

function incrementLaneCount(board: KanbanBoardData, laneKey: string, delta: number): void {
	const lane = board.lanes.find(entry => entry.key === laneKey);
	if (!lane) return;
	lane.count = Math.max(0, lane.count + delta);
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter(value => value.trim().length > 0)));
}

function areStringSetsEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every(value => rightSet.has(value));
}
