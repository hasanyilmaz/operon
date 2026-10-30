// Frozen legacy board producer used only as a compatibility oracle in regression tests.
// The plugin renderer consumes kanban-board / kanban-grouping instead.
import type { InlinePropertyDefinitions } from '../../src/core/inline-property-definitions';
import { projectKanbanLegacyAxes } from '../../src/core/kanban-axis-model';
import { filterTasksForDisplay as filterTasksForCalendar } from '../../src/core/filter-display';
import { buildTaskSearchMatcher } from '../../src/systems/task-search';
import type { IndexedTask } from '../../src/types/fields';
import { composeStatusValue, type Pipeline } from '../../src/types/pipeline';
import type { PinnedCache } from '../../src/storage/pinned-cache';
import { type KanbanPreset, type KanbanSwimlaneBy, resolveKanbanEffectiveSorting } from '../../src/types/kanban';
import type { FilterSet, KeyMapping, ProjectSerialScope } from '../../src/types/settings';
import { getManagedCustomFieldOptionMapping } from '../../src/core/managed-task-fields';
import { buildWorkflowStatusIdentityIndex } from '../../src/core/workflow-status-identity';
import type { FilterEvaluationOptions } from '../../src/core/filter-evaluator';
import type { ProjectSerialDisplay } from '../../src/core/project-serials';
import { type KanbanBoardData, type KanbanLane, buildKanbanCellKey, applyManualKanbanTaskOrder, buildKanbanTaskComparator, extractLaneKeys, isTaskInPipelineWithIndex, resolveTaskStatusDefinition, KANBAN_NO_VALUE_KEY, getKanbanNoValueLabel } from '../../src/systems/kanban-query';
export function queryKanbanBoard(options: {
 inlinePropertyDefinitions?: InlinePropertyDefinitions;
	preset: KanbanPreset;
	pipeline: Pipeline | null;
	pipelines?: readonly Pipeline[];
	filterSet: FilterSet | null;
	tasks: IndexedTask[];
	priorities: { label: string; color?: string }[];
	searchQuery?: string | null;
	taskIdFilter?: Iterable<string>;
	skippedStatusIds?: Iterable<string>;
	skippedLaneKeys?: Iterable<string>;
	pinnedCache?: PinnedCache | null;
	manualOrder?: Record<string, string[]>;
	keyMappings?: readonly KeyMapping[];
	projectSerialScopes?: readonly ProjectSerialScope[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	filterEvaluationOptions?: FilterEvaluationOptions;
}): KanbanBoardData {
	const { filterSet, priorities, pinnedCache } = options;
	const projection = projectKanbanLegacyAxes(options.preset, options.keyMappings);
	if (!projection.ok) return { preset: options.preset, pipeline: null, filterSet, scopedTasks: [], relevantTasks: [], columns: [], lanes: [], cellCountMap: new Map(), cellMap: new Map() };
	const preset = { ...options.preset, pipelineId: projection.pipelineId, swimlaneBy: projection.swimlaneBy };
	const pipeline = (options.pipelines ?? (options.pipeline ? [options.pipeline] : [])).find(entry => entry.id === projection.pipelineId) ?? null;
	const keyMappings = options.keyMappings ?? [];
	const normalizedSearchQuery = (options.searchQuery ?? '').trim().toLocaleLowerCase();
	const allowedTaskIds = options.taskIdFilter ? new Set(options.taskIdFilter) : null;
	const searchMatcher = normalizedSearchQuery ? buildTaskSearchMatcher(options.tasks, keyMappings) : null;
	const scopedTasks = filterTasksForCalendar(filterSet, options.tasks, priorities, pinnedCache ?? null, {
		...options.filterEvaluationOptions,
		projectSerialScopes: options.projectSerialScopes,
		projectSerialScopeTasks: options.tasks,
		dependencyTasks: options.tasks,
		pipelines: options.pipelines,
	});
	const identityIndex = buildWorkflowStatusIdentityIndex(
		options.pipelines ?? (pipeline ? [pipeline] : []),
	);
	const relevantTasks = pipeline
		? scopedTasks
			.filter(task => isTaskInPipelineWithIndex(task, pipeline, identityIndex))
			.filter(task => !allowedTaskIds || allowedTaskIds.has(task.operonId))
			.filter(task => !searchMatcher || searchMatcher(task, normalizedSearchQuery))
		: [];
	const lanes = buildKanbanLanes(relevantTasks, preset.swimlaneBy, priorities, keyMappings, options.inlinePropertyDefinitions);
	const skippedStatusIds = new Set(options.skippedStatusIds ?? []);
	const skippedLaneKeys = new Set(options.skippedLaneKeys ?? []);
	const statusTaskCounts = new Map<string, number>();
	const cellCountMap = new Map<string, number>();
	const cellMap = new Map<string, IndexedTask[]>();
	const comparators = new Map<string, (left: IndexedTask, right: IndexedTask) => number>();

	for (const task of relevantTasks) {
		const status = pipeline ? resolveTaskStatusDefinition(task, pipeline, options.pipelines) : null;
		if (!status) continue;
		const statusId = status.id;
		statusTaskCounts.set(statusId, (statusTaskCounts.get(statusId) ?? 0) + 1);
		for (const laneKey of extractLaneKeys(task, preset.swimlaneBy, keyMappings, priorities, options.inlinePropertyDefinitions)) {
			const cellKey = buildKanbanCellKey(statusId, laneKey);
			cellCountMap.set(cellKey, (cellCountMap.get(cellKey) ?? 0) + 1);
			if (skippedStatusIds.has(statusId)) continue;
			if (skippedLaneKeys.has(laneKey)) continue;
			if (!cellMap.has(cellKey)) cellMap.set(cellKey, []);
			cellMap.get(cellKey)!.push(task);
		}
	}

	const columns = pipeline
		? pipeline.statuses
			.map(status => ({
				statusId: status.id,
				statusLabel: status.label,
				statusValue: composeStatusValue(pipeline.name, status.label),
				isFinished: status.isFinished,
				color: status.color?.trim() || null,
				count: statusTaskCounts.get(status.id) ?? 0,
			}))
		: [];

	for (const [cellKey, tasks] of cellMap.entries()) {
		const statusId = cellKey.slice(0, cellKey.indexOf('::'));
		const sorting = resolveKanbanEffectiveSorting(preset, statusId);
		if (sorting.sortMode === 'manual') {
			applyManualKanbanTaskOrder(tasks, options.manualOrder?.[cellKey] ?? []);
		} else {
			let comparator = comparators.get(statusId);
			if (!comparator) {
				comparator = buildKanbanTaskComparator({
					preset,
					sorting,
					priorities,
					keyMappings,
					getProjectSerialDisplay: options.getProjectSerialDisplay,
				});
				comparators.set(statusId, comparator);
			}
			tasks.sort(comparator);
		}
	}

	return {
  inlinePropertyDefinitions: options.inlinePropertyDefinitions,
		preset,
		pipeline,
		filterSet,
		scopedTasks,
		relevantTasks,
		columns,
		lanes,
		cellCountMap,
		cellMap,
	};
}

function buildKanbanLanes(
	tasks: IndexedTask[],
	swimlaneBy: KanbanSwimlaneBy | null,
	priorities: { label: string; color?: string }[],
	keyMappings: readonly KeyMapping[],
 inlinePropertyDefinitions?: InlinePropertyDefinitions,
): KanbanLane[] {
	if (!swimlaneBy) {
		return [{
			key: KANBAN_NO_VALUE_KEY,
			label: getKanbanNoValueLabel(),
			value: '',
			isNoValue: true,
			count: tasks.length,
			color: null,
		}];
	}

	const laneCounts = new Map<string, number>();
	for (const task of tasks) {
		for (const key of extractLaneKeys(task, swimlaneBy, keyMappings, priorities, inlinePropertyDefinitions)) {
			laneCounts.set(key, (laneCounts.get(key) ?? 0) + 1);
		}
	}

	const lanes: KanbanLane[] = [];
	if (swimlaneBy === 'priority') {
		for (const priority of priorities) {
			const count = laneCounts.get(priority.label) ?? 0;
			lanes.push({
				key: priority.label,
				label: priority.label,
				value: priority.label,
				isNoValue: false,
				count,
				color: priority.color?.trim() || null,
			});
		}
	} else {
		const customMapping = getManagedCustomFieldOptionMapping(swimlaneBy, keyMappings);
		const compareLaneValues = customMapping?.type === 'number'
			? compareNumericKanbanLaneValues
			: compareTextKanbanLaneValues;
		const values = Array.from(laneCounts.keys())
			.filter(value => value !== KANBAN_NO_VALUE_KEY)
			.sort(compareLaneValues);
		for (const value of values) {
			lanes.push({
				key: value,
				label: value,
				value,
				isNoValue: false,
				count: laneCounts.get(value) ?? 0,
				color: null,
			});
		}
	}

	if (laneCounts.has(KANBAN_NO_VALUE_KEY)) {
		lanes.push({
			key: KANBAN_NO_VALUE_KEY,
			label: getKanbanNoValueLabel(),
			value: '',
			isNoValue: true,
			count: laneCounts.get(KANBAN_NO_VALUE_KEY) ?? 0,
			color: null,
		});
	}

	return lanes;
}

function compareNumericKanbanLaneValues(left: string, right: string): number {
	const leftValue = parseNumericSortValue(left);
	const rightValue = parseNumericSortValue(right);
	if (leftValue !== null && rightValue !== null) {
		const comparison = leftValue - rightValue;
		if (comparison !== 0) return comparison;
	}
	if (leftValue === null || rightValue === null) {
		if (leftValue === null && rightValue !== null) return 1;
		if (leftValue !== null && rightValue === null) return -1;
	}
	const textComparison = compareTextKanbanLaneValues(left, right);
	if (textComparison !== 0) return textComparison;
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareTextKanbanLaneValues(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function parseNumericSortValue(raw: string | undefined): number | null {
	const value = (raw ?? '').trim();
	if (!value) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
