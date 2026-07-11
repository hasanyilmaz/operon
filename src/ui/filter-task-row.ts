import { setIcon } from 'obsidian';
import { prepareTaskSortContext, sortTasksBySpecs, type PreparedTaskSortContext } from '../core/filter-evaluator';
import { t } from '../core/i18n';
import { resolveDirectSubtaskProgressFromStats } from '../core/task-stats-read-model';
import { IndexedTask } from '../types/fields';
import { resolveWorkflowStatus } from '../types/pipeline';
import { FilterSortSpec } from '../types/settings';
import { buildReadingTaskRowElement, ReadingTaskRowCallbacks } from './reading-task-row';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { createOwnerElement } from '../core/dom-compat';
import { computePlainCheckboxProgressIndicator } from './plain-checkbox-progress';
import { bindPlainCheckboxPopoverTrigger } from './plain-checkbox-popover';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';

export interface FilterTaskRowCallbacks extends ReadingTaskRowCallbacks {
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getChildIds: (parentId: string) => string[];
	getRenderedTask?: (task: IndexedTask) => IndexedTask;
}

interface FilterTaskRowOptions {
	allowExpand?: boolean;
	ancestorIds?: Set<string>;
	defaultExpandAll?: boolean;
	showOnlyOpenSubtasks?: boolean;
	showSubtaskAction?: boolean;
	subtaskSorts?: FilterSortSpec[];
	subtaskSortContext?: PreparedTaskSortContext;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	visibleTaskIds?: Set<string>;
}

export function buildFilterTaskRowElement(
	task: IndexedTask,
	callbacks: FilterTaskRowCallbacks,
	expandedTaskIds: Set<string>,
	options?: FilterTaskRowOptions,
	owner?: Node | null,
): HTMLElement {
	const allowExpand = options?.allowExpand !== false;
	const ancestorIds = options?.ancestorIds ?? new Set<string>();
	const workflowStatusIdentityIndex = options?.workflowStatusIdentityIndex
		?? buildWorkflowStatusIdentityIndex(callbacks.getPipelines());
	const wrapper = el('div', 'operon-filter-task-entry', owner);
	const childIds = allowExpand
		? sortSubtaskIds(
			callbacks.getChildIds(task.operonId).filter(childId =>
				childId !== task.operonId
				&& !ancestorIds.has(childId)
				&& (!options?.visibleTaskIds || options.visibleTaskIds.has(childId)),
			),
			callbacks,
			options?.showOnlyOpenSubtasks === true,
			options?.subtaskSorts,
			options?.subtaskSortContext,
			workflowStatusIdentityIndex,
		)
		: [];
	const hasChildren = childIds.length > 0;
	const childrenContainer = hasChildren ? el('div', 'operon-filter-task-children', wrapper) : null;
	const branchColor = resolveBranchColor(task, callbacks);
	const canUseDirectStats = allowExpand
		&& !options?.visibleTaskIds
		&& options?.showOnlyOpenSubtasks !== true;
	const childProgress = hasChildren
		? buildChildProgress(task, childIds, callbacks, canUseDirectStats, workflowStatusIdentityIndex)
		: null;
	if (hasChildren && options?.defaultExpandAll === true) {
		const marker = `__filter_init_${task.operonId}`;
		if (!expandedTaskIds.has(marker)) {
			expandedTaskIds.add(task.operonId);
			expandedTaskIds.add(marker);
		}
	}

	if (childrenContainer && branchColor) {
		childrenContainer.style.setProperty('--operon-filter-branch-color', branchColor);
	}

	const renderedTask = callbacks.getRenderedTask?.(task) ?? task;
	const plainCheckboxProgress = computePlainCheckboxProgressIndicator(task.plainCheckboxProgress);
	const row = buildReadingTaskRowElement(renderedTask, callbacks, undefined, {
		owner: wrapper,
		workflowStatusIdentityIndex,
		chipItems: callbacks.getSettings().filterTaskCompactChips,
		showPlayAction: callbacks.getSettings().filterTaskShowPlayAction,
		showPinAction: callbacks.getSettings().filterTaskShowPinAction,
		showSubtaskAction: options?.showSubtaskAction ?? callbacks.getSettings().filterTaskShowSubtaskAction,
		rowClassName: 'operon-filter-task-row',
		projectSerialPlacement: 'tail',
		beforeTailContent: hasChildren
			? (tail, context) => {
				const expandButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action operon-filter-expand-action operon-task-chip-action operon-task-chip-progress', tail);
				expandButton.type = 'button';
				const iconEl = el('span', 'operon-filter-expand-icon', expandButton);
				const summary = el('span', 'operon-filter-expand-summary', expandButton);
				expandButton.appendChild(iconEl);
				expandButton.appendChild(summary);
				if (context.taskColor) {
					expandButton.style.setProperty('--operon-live-hover-border', context.taskColor);
				}
				if (childProgress?.allCompleted) {
					summary.classList.add('is-complete');
				}
				if (context.taskColor) {
					summary.style.setProperty('--operon-live-hover-border', context.taskColor);
				}
				const syncButton = () => {
					const expanded = expandedTaskIds.has(task.operonId);
					setIcon(iconEl, expanded ? 'chevron-down' : 'chevron-right');
					expandButton.classList.toggle('is-expanded', expanded);
					summary.textContent = childProgress ? `${childProgress.completed}/${childProgress.total}` : '';
					setAccessibleLabelWithoutTooltip(expandButton, t('tooltips', 'expandSubtasks'));
				};
				syncButton();
				expandButton.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (expandedTaskIds.has(task.operonId)) {
						expandedTaskIds.delete(task.operonId);
						childrenContainer?.classList.add('is-collapsed');
					} else {
						expandedTaskIds.add(task.operonId);
						if (childrenContainer && childrenContainer.childElementCount === 0) {
							renderDirectChildren(
								childrenContainer,
								childIds,
								callbacks,
								expandedTaskIds,
								new Set([...ancestorIds, task.operonId]),
								options?.defaultExpandAll === true,
								options?.showOnlyOpenSubtasks === true,
								options?.subtaskSorts,
								options?.subtaskSortContext,
								workflowStatusIdentityIndex,
								options?.visibleTaskIds,
							);
						}
						childrenContainer?.classList.remove('is-collapsed');
					}
					syncButton();
					window.requestAnimationFrame(() => expandButton.blur());
				});
				expandButton.classList.add('operon-filter-expand-control');
				bindOperonHoverTooltip(expandButton, {
					title: t('tooltips', 'directSubtasks'),
					content: buildSubtaskTooltipContent(childProgress),
					taskColor: context.taskColor,
					preferredHorizontal: 'right',
				});
				tail.appendChild(expandButton);
			}
			: undefined,
		beforeEditAction: callbacks.getSettings().filterTaskShowPlainCheckboxAction
			? (actions, context) => {
				const progress = plainCheckboxProgress;
				const control = el('span', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action operon-filter-checkbox-progress-control operon-task-chip-action operon-task-chip-progress', actions);
				appendFilterCheckboxProgressContent(control, progress.kind === 'count' ? progress.text : null);
				if (progress.kind === 'none') {
					control.classList.add('is-empty');
				} else if (progress.allCompleted) {
					control.classList.add('is-complete');
				}
				const taskColor = context.taskColor;
				if (taskColor) {
					control.style.setProperty('--operon-live-hover-border', taskColor);
				}
				if (progress.kind === 'count') {
					const tooltipContent = progress.tooltipContent;
					setAccessibleLabelWithoutTooltip(control, `${t('tooltips', 'plainCheckboxes')}: ${tooltipContent}`);
					bindOperonHoverTooltip(control, {
						title: t('tooltips', 'plainCheckboxes'),
						content: tooltipContent,
						taskColor,
						preferredHorizontal: 'right',
					});
				} else {
					const tooltipTitle = t('tooltips', 'plainCheckboxEditorAdd');
					setAccessibleLabelWithoutTooltip(control, tooltipTitle);
					bindOperonHoverTooltip(control, {
						title: tooltipTitle,
						taskColor,
						preferredHorizontal: 'right',
					});
				}
				bindPlainCheckboxPopoverTrigger(control, {
					app: callbacks.app,
					task,
					keyMappings: callbacks.getSettings().keyMappings,
					taskColor,
					seedEmptyDraft: progress.kind === 'none',
				});
				actions.appendChild(control);
			}
			: undefined,
	});

	wrapper.appendChild(row);

	if (childrenContainer) {
		if (!expandedTaskIds.has(task.operonId)) {
			childrenContainer.classList.add('is-collapsed');
		} else {
			renderDirectChildren(
				childrenContainer,
				childIds,
				callbacks,
				expandedTaskIds,
				new Set([...ancestorIds, task.operonId]),
				options?.defaultExpandAll === true,
				options?.showOnlyOpenSubtasks === true,
				options?.subtaskSorts,
				options?.subtaskSortContext,
				workflowStatusIdentityIndex,
				options?.visibleTaskIds,
			);
		}
		wrapper.appendChild(childrenContainer);
	}

	return wrapper;
}

function renderDirectChildren(
	container: HTMLElement,
	childIds: string[],
	callbacks: FilterTaskRowCallbacks,
	expandedTaskIds: Set<string>,
	ancestorIds: Set<string>,
	defaultExpandAll: boolean,
	showOnlyOpenSubtasks: boolean,
	subtaskSorts?: FilterSortSpec[],
	subtaskSortContext?: PreparedTaskSortContext,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
	visibleTaskIds?: Set<string>,
): void {
	container.empty();
	for (const childId of childIds) {
		const childTask = callbacks.getIndexedTask(childId);
		if (!childTask) continue;
			container.appendChild(buildFilterTaskRowElement(childTask, callbacks, expandedTaskIds, {
				allowExpand: true,
				ancestorIds,
				defaultExpandAll,
				showOnlyOpenSubtasks,
				subtaskSorts,
				subtaskSortContext,
				workflowStatusIdentityIndex,
				visibleTaskIds,
			}, container));
	}
}

function sortSubtaskIds(
	childIds: string[],
	callbacks: FilterTaskRowCallbacks,
	showOnlyOpenSubtasks: boolean,
	subtaskSorts?: FilterSortSpec[],
	subtaskSortContext?: PreparedTaskSortContext,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string[] {
	if (subtaskSorts !== undefined) {
		return sortSubtaskIdsBySpecs(
			childIds,
			callbacks,
			showOnlyOpenSubtasks,
			subtaskSorts,
			subtaskSortContext,
			workflowStatusIdentityIndex,
		);
	}
	const priorityRankMap = subtaskSortContext?.priorityRankMap
		?? Object.fromEntries(callbacks.getPriorities().map((priority, index) => [priority.label, index] as const));

	return [...childIds].sort((leftId, rightId) => {
		const left = callbacks.getIndexedTask(leftId);
		const right = callbacks.getIndexedTask(rightId);
		if (!left && !right) return leftId.localeCompare(rightId);
		if (!left) return 1;
		if (!right) return -1;

		const bucketCompare = getSubtaskStateBucket(left, callbacks, workflowStatusIdentityIndex)
			- getSubtaskStateBucket(right, callbacks, workflowStatusIdentityIndex);
		if (bucketCompare !== 0) return bucketCompare;

		const leftPriority = priorityRankMap[left.fieldValues['priority'] ?? ''] ?? Number.MAX_SAFE_INTEGER;
		const rightPriority = priorityRankMap[right.fieldValues['priority'] ?? ''] ?? Number.MAX_SAFE_INTEGER;
		if (leftPriority !== rightPriority) return leftPriority - rightPriority;

		return left.description.localeCompare(right.description, undefined, { sensitivity: 'base' });
	}).filter(childId => {
		if (!showOnlyOpenSubtasks) return true;
		const childTask = callbacks.getIndexedTask(childId);
		return childTask ? isOpenSubtask(childTask, callbacks, workflowStatusIdentityIndex) : false;
	});
}

function sortSubtaskIdsBySpecs(
	childIds: string[],
	callbacks: FilterTaskRowCallbacks,
	showOnlyOpenSubtasks: boolean,
	subtaskSorts: FilterSortSpec[],
	subtaskSortContext?: PreparedTaskSortContext,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string[] {
	if (subtaskSorts.length === 0) {
		return childIds.filter(childId => {
			if (!showOnlyOpenSubtasks) return true;
			const childTask = callbacks.getIndexedTask(childId);
			return childTask ? isOpenSubtask(childTask, callbacks, workflowStatusIdentityIndex) : false;
		});
	}

	const childTasks = childIds
		.map(childId => callbacks.getIndexedTask(childId))
		.filter((task): task is IndexedTask =>
			!!task && (!showOnlyOpenSubtasks || isOpenSubtask(task, callbacks, workflowStatusIdentityIndex))
		);
	const sortContext = subtaskSortContext ?? prepareTaskSortContext(subtaskSorts, {
		priorities: callbacks.getPriorities(),
		pipelines: callbacks.getPipelines(),
		isTaskPinned: callbacks.isTaskPinned,
	});
	const sortedTasks = sortTasksBySpecs(childTasks, subtaskSorts, sortContext);
	const sortedIds = sortedTasks.map(task => task.operonId);
	const missingIds = showOnlyOpenSubtasks
		? []
		: childIds.filter(childId => !callbacks.getIndexedTask(childId));
	return [...sortedIds, ...missingIds];
}

function getSubtaskStateBucket(
	task: IndexedTask,
	callbacks: FilterTaskRowCallbacks,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): number {
	const workflow = resolveWorkflowStatus(
		callbacks.getPipelines(),
		task.fieldValues['status'],
		workflowStatusIdentityIndex,
	);
	if (workflow) {
		if (workflow.checkbox === 'cancelled') return 2;
		if (workflow.checkbox === 'done') return 1;
		return 0;
	}
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) return 2;
	if (task.checkbox === 'done' || !!task.fieldValues['dateCompleted']?.trim()) return 1;
	return 0;
}

function isOpenSubtask(
	task: IndexedTask,
	callbacks: FilterTaskRowCallbacks,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): boolean {
	return getSubtaskStateBucket(task, callbacks, workflowStatusIdentityIndex) === 0;
}

function resolveBranchColor(task: IndexedTask, callbacks: FilterTaskRowCallbacks): string | null {
	const taskColor = normalizeColor(task.fieldValues['taskColor']);
	if (taskColor) return taskColor;

	const priority = task.fieldValues['priority']?.trim();
	if (!priority) return null;
	const priorityDef = callbacks.getPriorities().find(candidate => candidate.label === priority);
	return normalizeColor(priorityDef?.color);
}

export function buildChildProgress(
	parentTask: IndexedTask,
	childIds: string[],
	callbacks: FilterTaskRowCallbacks,
	canUseStats: boolean,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): { completed: number; total: number; allCompleted: boolean } {
	if (canUseStats) {
		const statsProgress = resolveDirectSubtaskProgressFromStats(parentTask.fieldValues, childIds.length);
		if (statsProgress) {
			return statsProgress;
		}
	}
	const identityIndex = workflowStatusIdentityIndex
		?? buildWorkflowStatusIdentityIndex(callbacks.getPipelines());

	let total = 0;
	let completed = 0;

	for (const childId of childIds) {
		const childTask = callbacks.getIndexedTask(childId);
		if (!childTask) continue;
		total += 1;
		const workflow = resolveWorkflowStatus(
			callbacks.getPipelines(),
			childTask.fieldValues['status'],
			identityIndex,
		);
		if (workflow ? workflow.checkbox === 'done' : childTask.checkbox === 'done') {
			completed += 1;
		}
	}

	return {
		completed,
		total,
		allCompleted: total > 0 && completed === total,
	};
}

function buildSubtaskTooltipContent(
	progress: { completed: number; total: number; allCompleted: boolean } | null,
): string {
	if (!progress || progress.total === 0) return t('tooltips', 'noDirectSubtasks');
	const percent = Math.round((progress.completed / progress.total) * 100);
	if (percent === 0) return t('tooltips', 'subtasksNotStarted');
	if (progress.allCompleted) return t('tooltips', 'subtasksComplete');
	return t('tooltips', 'subtasksPercentComplete', { percent: String(percent) });
}

function appendFilterCheckboxProgressContent(control: HTMLElement, text: string | null): void {
	const iconEl = createOwnerElement(control, 'span');
	iconEl.className = 'operon-filter-checkbox-progress-icon';
	iconEl.dataset.operonProgressIcon = 'layout-list';
	setIcon(iconEl, 'layout-list');
	control.appendChild(iconEl);

	if (text === null) return;
	const labelEl = createOwnerElement(control, 'span');
	labelEl.className = 'operon-filter-checkbox-progress-label';
	labelEl.textContent = text;
	control.appendChild(labelEl);
}

function normalizeColor(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	owner?: Node | null,
): HTMLElementTagNameMap[K] {
	const element = createOwnerElement(owner, tag);
	if (className) element.className = className;
	return element;
}
