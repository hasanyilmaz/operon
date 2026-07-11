/**
 * Filter View panel for Operon.
 * Displays filtered/sorted task lists using the same task bar visual
 * as the inline Live Preview renderer.
 *
 * Spec Section 4.5:
 * - Left/right rail panels
 * - User-defined filter sets (configured in Settings → Filters)
 * - Each task renders as a full operon-task-bar
 * - Checkbox click toggles, description click opens editor, live re-render on changes
 */

import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { cloneFilterSet, FilterSet, OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { t } from '../core/i18n';
import {
	evaluateFilterSet,
	evaluateFilterSetGrouped,
	filterTasksOnly,
	getFilterSortSpecs,
	prepareTaskSortContext,
	sortFilterTasks,
} from '../core/filter-evaluator';
import { PinnedCache } from '../storage/pinned-cache';
import { buildFilterTaskRowElement, FilterTaskRowCallbacks } from './filter-task-row';
import { shouldResolveLocationCompactChips } from './compact-task-layout';
import { FilterSetModal, type FilterSetModalQuickActions } from './filter-set-modal';
import { ConfirmActionModal } from './confirm-action-modal';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { applyFilterSearch, buildFilterTreeScope, isFilterSearchActive } from '../systems/filter-search';
import {
	FILTER_RENDER_BATCH_SIZE,
	getVisibleFilterTasks,
	getVisibleGroupedFilterResults,
} from '../systems/filter-lazy-render';
import { getOwnerDocument } from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { IndexedTask } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
import { closeIconOnlyChipPreviewsForRoot } from './icon-only-chip-preview';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskWikilinkOverlaySettingsSignature } from './task-wikilink-overlay-chips';
import { buildTaskStatusIconRenderSettingsSignature } from './task-status-icon-signature';
import { buildWorkflowStatusSemanticsSignature } from '../core/workflow-status-semantics';
import { buildWorkflowStatusOrderSignature } from '../core/workflow-status-order';
import { buildWorkflowStatusIdentityIndex } from '../core/workflow-status-identity';
import { getNormalFilterSets } from '../core/dynamic-file-task-filter';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { enginePerfLog, enginePerfNow } from '../core/engine-perf';
import {
	applyOptimisticRenderPatch,
	buildOptimisticStatusPatch,
	isOptimisticTaskPatchPersisted,
	normalizeOptimisticFieldValues,
	type OptimisticTaskPatchInput,
} from '../systems/optimistic-status-patch';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import { renderRelatedViewsLauncher } from './related-views';
import type { RelatedViewCreateTarget, RelatedViewOpenTarget } from '../types/related-views';

export const FILTER_VIEW_TYPE = 'operon-filter-view';
const FILTER_PERF_DEBUG = false;
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const perfLog = (...args: unknown[]) => {
	if (FILTER_PERF_DEBUG) console.debug('[Operon filter perf]', ...args);
};

function generateFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

function createEmptyFilterSet(): FilterSet {
	return {
		id: generateFilterSetId(),
		name: '',
		icon: 'filter',
		rootGroup: {
			id: 'fg_' + Math.random().toString(36).slice(2, 10),
			logic: 'all',
			children: [],
		},
		sorts: [],
		subgroupBy: undefined,
		subgroupOrder: undefined,
		matchLogic: 'all',
		conditions: [],
	};
}

interface FilterViewState {
	filterSetId?: string | null;
}

interface FilterOptimisticTaskPatch {
	fieldValues: Record<string, string>;
	checkbox?: IndexedTask['checkbox'];
	expiresAt: number;
}

export class FilterView extends ItemView {
	private indexer: OperonIndexer;
	private settings: OperonSettings;
	private saveSettings: () => Promise<void>;
	private openTaskEditor: (operonId: string) => void;
	private cycleStatusFn: (operonId: string) => void | Promise<void>;
	private getPipelines: () => Pipeline[];
	private getPriorities: () => PriorityDefinition[];
	private getChildIds: (parentId: string) => string[];
	private navigateToTask: (task: IndexedTask) => void;
	private getSettings: () => OperonSettings;
	private updateField: (operonId: string, key: string, value: string) => void | Promise<void>;
	private updateFields?: (operonId: string, payload: Record<string, string>) => void | Promise<void>;
	private updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	private updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	private getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	private getRepeatSkipSignature?: () => string;
	private getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	private updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
	private requestSubtask?: (operonId: string) => void | Promise<void>;
	private onContextualAction: ContextualMenuActionHandler | null = null;
	private isTaskTracking?: (taskId: string) => boolean;
	private toggleTimer?: (taskId: string) => void | Promise<void>;
	private getTrackingSignature?: () => string;
	private getProjectSerialDisplay?: (operonId: string) => ProjectSerialDisplay | null;
	private getProjectSerialSignature?: () => string;
	private saveFilterSet?: (filterSet: FilterSet) => Promise<void>;
	private openDailyNote?: (dateKey: string) => void | Promise<void>;
	private duplicateFilterSet?: (filterSet: FilterSet) => Promise<void>;
	private deleteFilterSet?: (filterSetId: string) => Promise<void>;
	private onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>;
	private onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>;
	private currentFilterSetId: string | null = null;
	private lastRenderSignature: string | null = null;
	private layoutRoot: HTMLElement | null = null;
	private headerEl: HTMLElement | null = null;
	private filterPickerEl: HTMLElement | null = null;
	private filterPickerButtonEl: HTMLButtonElement | null = null;
	private filterPickerMenuEl: HTMLElement | null = null;
	private relatedViewsButtonEl: HTMLButtonElement | null = null;
	private addFilterBtnEl: HTMLButtonElement | null = null;
	private settingsBtnEl: HTMLButtonElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private listEl: HTMLElement | null = null;
	private lastSelectOptionsSignature: string | null = null;
	private pinnedCache: PinnedCache | null = null;
	private expandedTaskIds = new Set<string>();
	private searchQuery = '';
	private treeScopeCache: { signature: string; tasks: IndexedTask[] } | null = null;
	private visibleTaskLimit = FILTER_RENDER_BATCH_SIZE;
	private lastPaginationSignature: string | null = null;
	private lazyLoadObserver: IntersectionObserver | null = null;
	private readonly optimisticTaskPatches = new Map<string, FilterOptimisticTaskPatch>();
	private optimisticPatchCleanupTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		settings: OperonSettings,
		saveSettings: () => Promise<void>,
		openTaskEditor: (operonId: string) => void,
		cycleStatusFn: (operonId: string) => void | Promise<void>,
		getPipelines: () => Pipeline[],
		getPriorities: () => PriorityDefinition[],
		getChildIds: (parentId: string) => string[],
		navigateToTask: (task: IndexedTask) => void,
		getSettings: () => OperonSettings,
		updateField: (operonId: string, key: string, value: string) => void | Promise<void>,
		updateFields?: (operonId: string, payload: Record<string, string>) => void | Promise<void>,
		updateSubtasks?: (operonId: string, subtaskIds: string[]) => void,
		updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void,
		getRepeatSkipDates?: (repeatSeriesId: string) => string[],
		getRepeatSkipSignature?: () => string,
		getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode,
		updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>,
		requestSubtask?: (operonId: string) => void | Promise<void>,
		onContextualAction?: ContextualMenuActionHandler,
		pinnedCache?: PinnedCache,
		isTaskTracking?: (taskId: string) => boolean,
		toggleTimer?: (taskId: string) => void | Promise<void>,
		getTrackingSignature?: () => string,
		getProjectSerialDisplay?: (operonId: string) => ProjectSerialDisplay | null,
		getProjectSerialSignature?: () => string,
		saveFilterSet?: (filterSet: FilterSet) => Promise<void>,
		openDailyNote?: (dateKey: string) => void | Promise<void>,
		duplicateFilterSet?: (filterSet: FilterSet) => Promise<void>,
		deleteFilterSet?: (filterSetId: string) => Promise<void>,
		onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>,
		onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>,
	) {
		super(leaf);
		this.indexer = indexer;
		this.settings = settings;
		this.saveSettings = saveSettings;
		this.openTaskEditor = openTaskEditor;
		this.cycleStatusFn = cycleStatusFn;
		this.getPipelines = getPipelines;
		this.getPriorities = getPriorities;
		this.getChildIds = getChildIds;
		this.navigateToTask = navigateToTask;
		this.getSettings = getSettings;
		this.updateField = updateField;
		this.updateFields = updateFields;
		this.updateSubtasks = updateSubtasks;
		this.updateDependencyField = updateDependencyField;
		this.getRepeatSkipDates = getRepeatSkipDates;
		this.getRepeatSkipSignature = getRepeatSkipSignature;
		this.getRepeatSeriesInlineCompletionMode = getRepeatSeriesInlineCompletionMode;
		this.updateRepeatSeriesInlineCompletionMode = updateRepeatSeriesInlineCompletionMode;
		this.requestSubtask = requestSubtask;
		this.onContextualAction = onContextualAction ?? null;
		this.pinnedCache = pinnedCache ?? null;
		this.isTaskTracking = isTaskTracking;
		this.toggleTimer = toggleTimer;
		this.getTrackingSignature = getTrackingSignature;
		this.getProjectSerialDisplay = getProjectSerialDisplay;
		this.getProjectSerialSignature = getProjectSerialSignature;
		this.saveFilterSet = saveFilterSet;
		this.openDailyNote = openDailyNote;
		this.duplicateFilterSet = duplicateFilterSet;
		this.deleteFilterSet = deleteFilterSet;
		this.onOpenRelatedView = onOpenRelatedView;
		this.onCreateRelatedView = onCreateRelatedView;
		this.currentFilterSetId =
			this.resolvePreferredFilterSetId(this.getLeafFilterSetId())
			?? this.resolvePreferredFilterSetId(settings.leftRailDefaultFilterViewId)
			?? this.getVisibleFilterSets()[0]?.id
			?? null;
	}

	getViewType(): string {
		return FILTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.getCurrentFilterSetTitle();
	}

	getIcon(): string {
		return this.getCurrentFilterSetIcon();
	}

	private getCurrentFilterSet(): FilterSet | null {
		return this.getVisibleFilterSets().find(f => f.id === this.currentFilterSetId) ?? null;
	}

	private getCurrentFilterSetTitle(): string {
		return this.getCurrentFilterSet()?.name ?? 'Operon Filter';
	}

	private getCurrentFilterSetIcon(): string {
		return this.getCurrentFilterSet()?.icon?.trim() || 'funnel-plus';
	}

	private syncLeafTitle(): void {
		const title = this.getCurrentFilterSetTitle();
		const icon = this.getCurrentFilterSetIcon();
		const leafWithHeader = this.leaf as WorkspaceLeaf & {
			tabHeaderInnerTitleEl?: HTMLElement;
			tabHeaderInnerIconEl?: HTMLElement;
		};
		leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
		if (leafWithHeader.tabHeaderInnerIconEl) {
			leafWithHeader.tabHeaderInnerIconEl.empty();
			setIcon(leafWithHeader.tabHeaderInnerIconEl, icon);
		}
	}

	async onOpen(): Promise<void> {
		this.restoreCurrentFilterSetId();
		this.syncLeafTitle();
		this.render();
	}

	markDirty(): void {
		this.lastRenderSignature = null;
	}

	renderIfVisibleOrInvalidate(): void {
		if (this.isLeafVisible()) {
			this.renderPreservingScroll();
			return;
		}
		this.markDirty();
	}

	getState(): Record<string, unknown> {
		return {
			filterSetId: this.currentFilterSetId ?? null,
		};
	}

	async setState(state: FilterViewState, _result: unknown): Promise<void> {
		const previousFilterSetId = this.currentFilterSetId;
		this.currentFilterSetId =
			this.resolvePreferredFilterSetId(typeof state?.filterSetId === 'string' ? state.filterSetId : null)
			?? this.resolvePreferredFilterSetId(this.settings.leftRailDefaultFilterViewId)
			?? this.getVisibleFilterSets()[0]?.id
			?? null;
		if (this.currentFilterSetId !== previousFilterSetId) {
			this.searchQuery = '';
			if (this.searchInputEl) this.searchInputEl.value = '';
		}
		this.syncLeafTitle();
		if (this.containerEl.isConnected) this.render();
	}

	render(): void {
		const startedAt = perfNow();
		const container = this.contentEl;
		container.addClass('operon-filter-view');

		// Empty state — no filter sets defined
		const visibleFilterSets = this.getVisibleFilterSets();
		if (visibleFilterSets.length === 0) {
			this.closeTransientSurfaceUi(container);
			this.lastRenderSignature = 'empty';
			this.searchQuery = '';
			this.ensureLayout(container);
			this.headerEl?.addClass('is-hidden');
			if (this.listEl) {
				this.listEl.empty();
				const empty = this.listEl.createDiv('operon-embed-empty operon-filter-empty');
				empty.textContent = t('filterSets', 'noFilterSets');
			}
			return;
		}

		// Validate currentFilterSetId
		if (!visibleFilterSets.find(f => f.id === this.currentFilterSetId)) {
			this.restoreCurrentFilterSetId();
		}

		// Find current filter set and evaluate
		const currentFs = this.getVisibleFilterSets().find(f => f.id === this.currentFilterSetId);
		if (!currentFs) return;
		this.pruneOptimisticTaskPatches();

		const renderSignature = this.buildRenderSignature(currentFs);
		if (renderSignature === this.lastRenderSignature) return;
		if (renderSignature !== this.lastPaginationSignature) {
			this.visibleTaskLimit = FILTER_RENDER_BATCH_SIZE;
			this.lastPaginationSignature = renderSignature;
		}

		const callbacks: FilterTaskRowCallbacks = {
			app: this.app,
			getPipelines: this.getPipelines,
			getPriorities: this.getPriorities,
			getIndexedTask: (id) => this.indexer.getTask(id),
			getFileTaskByPath: (filePath) => this.indexer.getFileTaskByPath(filePath),
			getDescendantTaskSummary: (operonId) => this.indexer.getDescendantTaskSummary(operonId),
			getChildIds: this.getChildIds,
			getRenderedTask: (task) => this.getRenderedFilterTask(task),
			openEditor: (operonId) => this.openTaskEditor(operonId),
			cycleStatus: (operonId) => { this.invokeFilterStatusCycle(operonId); },
			navigateToTask: this.navigateToTask,
			getSettings: this.getSettings,
			getAllTasks: () => this.indexer.getAllTasks(),
			updateField: this.updateField,
			updateFields: this.updateFields,
			updateSubtasks: this.updateSubtasks,
			updateDependencyField: this.updateDependencyField,
			getRepeatSkipDates: this.getRepeatSkipDates,
			getRepeatSeriesInlineCompletionMode: this.getRepeatSeriesInlineCompletionMode,
			updateRepeatSeriesInlineCompletionMode: this.updateRepeatSeriesInlineCompletionMode,
			requestSubtask: this.requestSubtask,
			onContextualAction: this.onContextualAction ?? undefined,
			isTaskPinned: this.pinnedCache ? (taskId) => this.pinnedCache?.isPinned(taskId) === true : undefined,
			isTaskTracking: this.isTaskTracking,
			toggleTimer: this.toggleTimer,
			getProjectSerialDisplay: this.getProjectSerialDisplay,
		};
		const globalShowSubtasks = this.settings.filterShowSubtasks === true;
		const globalShowOnlyOpenSubtasks = this.settings.filterShowOnlyOpenSubtasks === true;
		if (!globalShowSubtasks) {
			this.expandedTaskIds.clear();
		}
		const subtaskSorts = getFilterSortSpecs(currentFs);
		const effectiveSubtaskSorts = subtaskSorts.length > 0 ? subtaskSorts : undefined;
		const subtaskSortContext = prepareTaskSortContext(
			effectiveSubtaskSorts ?? [{ field: 'priority', order: 'asc' }],
			{
				priorities: this.getPriorities(),
				pipelines: this.getPipelines(),
				isTaskPinned: callbacks.isTaskPinned,
			},
		);
		const taskRowOptions = {
			defaultExpandAll: globalShowSubtasks,
			showOnlyOpenSubtasks: globalShowOnlyOpenSubtasks,
			showSubtaskAction: this.settings.filterTaskShowSubtaskAction,
			subtaskSorts: effectiveSubtaskSorts,
			subtaskSortContext,
			workflowStatusIdentityIndex: buildWorkflowStatusIdentityIndex(this.getPipelines()),
		};
		this.ensureLayout(container);
		this.headerEl?.removeClass('is-hidden');
		this.syncSelectOptions();
		this.renderFilterRelatedViewsButton();
		if (this.addFilterBtnEl) {
			const addFilterLabel = t('filterSets', 'addFilter');
			bindOperonHoverTooltip(this.addFilterBtnEl, {
				content: addFilterLabel,
				taskColor: null,
			});
			setAccessibleLabelWithoutTooltip(this.addFilterBtnEl, addFilterLabel);
			this.addFilterBtnEl.onclick = () => {
				this.openCreateFilterSetModal();
			};
		}
		if (this.settingsBtnEl) {
			bindOperonHoverTooltip(this.settingsBtnEl, {
				content: t('filterSets', 'editFilterNamed', { name: currentFs.name }),
				taskColor: null,
			});
			this.settingsBtnEl.onclick = () => {
				let modal: FilterSetModal | null = null;
				const clone = cloneFilterSet(currentFs);
					modal = new FilterSetModal(this.app, clone, this.settings.keyMappings, asyncHandler('filter view settings save failed', async (saved) => {
						if (this.saveFilterSet) {
							await this.saveFilterSet(saved);
						} else {
						const idx = this.settings.filterSets.findIndex(f => f.id === saved.id);
						if (idx !== -1) this.settings.filterSets[idx] = saved;
						}
						this.lastRenderSignature = null;
						this.render();
					}), {
					indexer: this.indexer,
					getPipelines: this.getPipelines,
					getPriorities: this.getPriorities,
					openEditor: (id) => this.openTaskEditor(id),
					cycleStatus: (id) => {
						runAsyncAction('filter view settings preview status cycle failed', async () => {
							await this.cycleStatusFn(id);
						});
					},
					getChildIds: this.getChildIds,
					navigateToTask: this.navigateToTask,
					getSettings: this.getSettings,
					updateField: (operonId, key, value) => { void this.updateField(operonId, key, value); },
					updateFields: this.updateFields
						? (operonId, payload) => { void this.updateFields?.(operonId, payload); }
						: undefined,
					updateSubtasks: this.updateSubtasks,
					updateDependencyField: this.updateDependencyField,
					onContextualAction: this.onContextualAction ?? undefined,
					pinnedCache: this.pinnedCache ?? undefined,
					isTaskTracking: this.isTaskTracking,
					toggleTimer: this.toggleTimer,
				}, {
					quickActions: this.createFilterSetModalQuickActions(currentFs, () => modal?.close()),
				});
				modal.open();
			};
		}
		this.lazyLoadObserver?.disconnect();
		this.lazyLoadObserver = null;
		this.closeTransientSurfaceUi(container);
		this.listEl?.empty();
		const list = this.listEl;
		if (!list) return;

			if (currentFs.groupBy) {
				// Grouped rendering
				const allTasks = this.indexer.getAllTasks();
				const baseGrouped = evaluateFilterSetGrouped(
					currentFs,
					allTasks,
					this.getPriorities(),
					this.pinnedCache,
					this.getPipelines(),
				);
				const searchActive = isFilterSearchActive(this.searchQuery);
				const baseRootTasks = filterTasksOnly(currentFs, allTasks, this.getPriorities(), this.pinnedCache);
				const treeScopeTasks = this.getCachedTreeScope(baseRootTasks);
				this.syncSearchPlaceholder(treeScopeTasks.length);

			if (searchActive) {
				const tasks = sortFilterTasks(
					currentFs,
					applyFilterSearch(treeScopeTasks, this.searchQuery, this.getSettings().keyMappings),
					this.getPriorities(),
					this.pinnedCache,
					this.getPipelines(),
				);
				if (tasks.length === 0) {
					list.createDiv({ cls: 'operon-filter-empty', text: t('filters', 'noMatches') });
					this.lastRenderSignature = renderSignature;
					return;
				}
					for (const task of getVisibleFilterTasks(tasks, this.visibleTaskLimit)) {
						const bar = buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, {
							...taskRowOptions,
							allowExpand: false,
						}, list);
						list.appendChild(bar);
					}
				this.attachLazyLoadSentinel(list, tasks.length);
				this.lastRenderSignature = renderSignature;
				perfLog('FilterView.render', this.currentFilterSetId ?? 'none', `${Math.round(perfNow() - startedAt)}ms`);
				return;
			}

			const grouped = baseGrouped;
			if (grouped.totalCount === 0) {
				list.createDiv({ cls: 'operon-filter-empty', text: t('filters', 'noMatches') });
				this.lastRenderSignature = renderSignature;
				return;
			}

			const visibleGrouped = getVisibleGroupedFilterResults(grouped, this.visibleTaskLimit);
			for (const group of visibleGrouped.groups) {
				const groupKey = group.key;
				const label = groupKey || t('filterSets', 'groupEmpty');
				const header = list.createDiv('operon-group-header');
				// Make date-format labels (YYYY-MM-DD) clickable → opens daily note
				if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
					const noteExists = this.app.vault.getFiles().some(f => f.basename === label);
					const linkCls = noteExists
						? 'operon-group-header-label operon-group-date-link operon-group-date-exists'
						: 'operon-group-header-label operon-group-date-link operon-group-date-missing';
					const linkText = noteExists ? `📅 ${label}` : `${label} (+)`;
					const link = header.createEl('a', { cls: linkCls, text: linkText });
					bindOperonHoverTooltip(link, {
						content: noteExists
							? t('filterSets', 'openDailyNote', { name: label })
							: t('filterSets', 'createDailyNote', { name: label }),
						taskColor: null,
					});
					link.addEventListener('click', (e) => {
						e.preventDefault();
							if (this.openDailyNote) {
								runAsyncAction('filter view daily note open failed', async () => {
									await this.openDailyNote!(label);
								});
							} else {
								runAsyncAction('filter view daily note link open failed', () => this.app.workspace.openLinkText(label, '', 'tab'));
							}
					});
				} else {
					header.createSpan({ cls: 'operon-group-header-label', text: label });
				}
				header.createSpan({ cls: 'operon-group-header-count', text: String(group.count) });

				if (group.subgroups?.length) {
					for (const subgroup of group.subgroups) {
						const subgroupHeader = list.createDiv('operon-group-header operon-subgroup-header');
						subgroupHeader.createSpan({
							cls: 'operon-group-header-label',
							text: subgroup.key || t('filterSets', 'groupEmpty'),
						});
						subgroupHeader.createSpan({ cls: 'operon-group-header-count', text: String(subgroup.count) });

							for (const task of subgroup.tasks) {
								const bar = buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, taskRowOptions, list);
								list.appendChild(bar);
							}
						}
					} else {
						for (const task of group.tasks) {
							const bar = buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, taskRowOptions, list);
							list.appendChild(bar);
						}
					}
			}
			this.attachLazyLoadSentinel(list, grouped.totalCount);
		} else {
			// Flat rendering
			const baseTasks = evaluateFilterSet(
				currentFs,
				this.indexer.getAllTasks(),
				this.getPriorities(),
				this.pinnedCache,
				this.getPipelines(),
			);
			const searchActive = isFilterSearchActive(this.searchQuery);
			const treeScopeTasks = this.getCachedTreeScope(baseTasks);
			const tasks = searchActive
				? sortFilterTasks(
					currentFs,
					applyFilterSearch(treeScopeTasks, this.searchQuery, this.getSettings().keyMappings),
					this.getPriorities(),
					this.pinnedCache,
					this.getPipelines(),
				)
				: baseTasks;
			this.syncSearchPlaceholder(treeScopeTasks.length);

			if (tasks.length === 0) {
				list.createDiv({ cls: 'operon-embed-empty operon-filter-empty', text: t('filters', 'noMatches') });
				this.lastRenderSignature = renderSignature;
				return;
			}

				for (const task of getVisibleFilterTasks(tasks, this.visibleTaskLimit)) {
					const bar = buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, {
						...taskRowOptions,
						allowExpand: !searchActive,
					}, list);
					list.appendChild(bar);
				}
			this.attachLazyLoadSentinel(list, tasks.length);
		}
		this.lastRenderSignature = renderSignature;
		perfLog('FilterView.render', this.currentFilterSetId ?? 'none', `${Math.round(perfNow() - startedAt)}ms`);
	}

	async onClose(): Promise<void> {
		this.closeTransientSurfaceUi(this.contentEl);
		this.lazyLoadObserver?.disconnect();
		this.lazyLoadObserver = null;
		this.clearOptimisticTaskPatches();
	}

	private closeTransientSurfaceUi(root: HTMLElement): void {
		closeFloatingPanelsForRoot(root);
		closeIconOnlyChipPreviewsForRoot(root);
	}

	private getLeafFilterSetId(): string | null {
		const state = this.leaf.getViewState().state as FilterViewState | undefined;
		return this.resolvePreferredFilterSetId(typeof state?.filterSetId === 'string' ? state.filterSetId : null);
	}

	private resolvePreferredFilterSetId(filterSetId: string | null | undefined): string | null {
		if (!filterSetId) return null;
		return this.getVisibleFilterSets().some(filterSet => filterSet.id === filterSetId)
			? filterSetId
			: null;
	}

	private restoreCurrentFilterSetId(): void {
		this.currentFilterSetId =
			this.resolvePreferredFilterSetId(this.getLeafFilterSetId())
			?? this.resolvePreferredFilterSetId(this.settings.leftRailDefaultFilterViewId)
			?? this.getVisibleFilterSets()[0]?.id
			?? null;
	}

	private async copyFilterSetEmbedCode(filterSet: FilterSet): Promise<void> {
		const code = '```operon\nfilterId: "' + filterSet.id + '"\n```';
		await navigator.clipboard.writeText(code);
		new Notice(t('filterSets', 'embedCodeCopied'));
	}

	private async saveNewFilterSet(filterSet: FilterSet): Promise<void> {
		if (this.saveFilterSet) {
			await this.saveFilterSet(filterSet);
		} else {
			this.settings.filterSets.push(filterSet);
			await this.saveSettings();
		}
		this.currentFilterSetId = filterSet.id;
		this.lastRenderSignature = null;
		this.render();
	}

	private openCreateFilterSetModal(): void {
		new FilterSetModal(this.app, createEmptyFilterSet(), this.settings.keyMappings, asyncHandler('filter view create filter failed', async (saved) => {
			await this.saveNewFilterSet(saved);
		}), {
			indexer: this.indexer,
			getPipelines: this.getPipelines,
			getPriorities: this.getPriorities,
			openEditor: (id) => this.openTaskEditor(id),
			cycleStatus: (id) => {
				runAsyncAction('filter view create preview status cycle failed', async () => {
					await this.cycleStatusFn(id);
				});
			},
			getChildIds: this.getChildIds,
			navigateToTask: this.navigateToTask,
			getSettings: this.getSettings,
			updateField: (operonId, key, value) => { void this.updateField(operonId, key, value); },
			updateFields: this.updateFields
				? (operonId, payload) => { void this.updateFields?.(operonId, payload); }
				: undefined,
			updateSubtasks: this.updateSubtasks,
			updateDependencyField: this.updateDependencyField,
			onContextualAction: this.onContextualAction ?? undefined,
			pinnedCache: this.pinnedCache ?? undefined,
			isTaskTracking: this.isTaskTracking,
			toggleTimer: this.toggleTimer,
		}).open();
	}

	private async duplicateCurrentFilterSet(filterSet: FilterSet): Promise<void> {
		if (this.duplicateFilterSet) {
			await this.duplicateFilterSet(filterSet);
		} else {
			const copy = cloneFilterSet(filterSet);
			copy.id = generateFilterSetId();
			copy.name = `${filterSet.name} Copy`;
			const idx = this.settings.filterSets.findIndex(entry => entry.id === filterSet.id);
			this.settings.filterSets.splice(idx === -1 ? this.settings.filterSets.length : idx + 1, 0, copy);
			await this.saveSettings();
		}
		this.lastRenderSignature = null;
		this.render();
	}

	private confirmDeleteCurrentFilterSet(filterSet: FilterSet, closeModal: () => void): void {
		new ConfirmActionModal(
			this.app,
			{
				title: t('filterSets', 'deleteFilterTitle'),
				message: t('filterSets', 'deleteFilterMessage').replace('{{name}}', filterSet.name),
				confirmText: t('filterSets', 'deleteFilterConfirm'),
				cancelText: t('filterSets', 'deleteFilterCancel'),
				danger: true,
			},
			asyncHandler('filter view delete filter failed', async (confirmed) => {
				if (!confirmed) return;
				if (this.deleteFilterSet) {
					await this.deleteFilterSet(filterSet.id);
				} else {
					this.settings.filterSets = this.settings.filterSets.filter(entry => entry.id !== filterSet.id);
					await this.saveSettings();
				}
				closeModal();
				this.restoreCurrentFilterSetId();
				this.lastRenderSignature = null;
				this.render();
			}),
		).open();
	}

	private createFilterSetModalQuickActions(filterSet: FilterSet, closeModal: () => void): FilterSetModalQuickActions {
		return {
			copyEmbedCode: async () => {
				await this.copyFilterSetEmbedCode(filterSet);
			},
			duplicate: async () => {
				await this.duplicateCurrentFilterSet(filterSet);
			},
			remove: () => {
				this.confirmDeleteCurrentFilterSet(filterSet, closeModal);
			},
		};
	}

	private getVisibleFilterSets(): FilterSet[] {
		return getNormalFilterSets(this.settings.filterSets);
	}

	private ensureLayout(container: HTMLElement): void {
		if (this.layoutRoot?.isConnected) return;

		container.empty();
		this.layoutRoot = container.createDiv('operon-embed operon-filter-surface operon-task-chip-surface operon-filter-surface--sidebar');
		this.headerEl = this.layoutRoot.createDiv('operon-embed-header operon-filter-header');
		this.filterPickerEl = this.headerEl.createDiv('operon-filter-picker');
		this.filterPickerButtonEl = this.filterPickerEl.createEl('button', {
			cls: 'operon-filter-picker-trigger',
			attr: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
		});
		this.filterPickerButtonEl.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.setFilterPickerOpen(!this.filterPickerEl?.hasClass('is-open'));
		});
		this.filterPickerMenuEl = this.filterPickerEl.createDiv({
			cls: 'operon-filter-picker-menu',
			attr: { role: 'listbox' },
		});
		this.registerDomEvent(getOwnerDocument(this.filterPickerEl), 'click', (event) => {
			if (!this.filterPickerEl?.contains(event.target as Node)) {
				this.setFilterPickerOpen(false);
			}
		});
		this.renderFilterRelatedViewsButton();
		this.createSearchInput(this.headerEl);
		this.addFilterBtnEl = this.headerEl.createEl('button', {
			cls: 'operon-filter-add-btn operon-task-chip-action',
			attr: { type: 'button' },
		});
		setIcon(this.addFilterBtnEl, 'plus');
		this.settingsBtnEl = this.headerEl.createEl('button', { cls: 'operon-filter-settings-btn operon-task-chip-action' });
		setIcon(this.settingsBtnEl, 'settings-2');
		this.listEl = this.layoutRoot.createDiv('operon-embed-list operon-filter-list');
		this.lastSelectOptionsSignature = null;
	}

	private createSearchInput(container: HTMLElement): void {
		const wrap = container.createDiv('operon-filter-search-wrap');
		const icon = wrap.createSpan('operon-filter-search-icon');
		setIcon(icon, 'scan-search');
		const input = wrap.createEl('input', {
			cls: 'operon-filter-search-input',
			attr: {
				type: 'search',
				placeholder: this.formatTaskCount(0),
			},
		});
		setAccessibleLabelWithoutTooltip(input, t('filterSets', 'searchTasksInFilter'));
		input.value = this.searchQuery;
		input.addEventListener('input', () => {
			this.searchQuery = input.value;
			this.lastRenderSignature = null;
			this.render();
		});
		this.searchInputEl = input;
	}

	private renderFilterRelatedViewsButton(): void {
		this.relatedViewsButtonEl?.remove();
		this.relatedViewsButtonEl = null;
		if (!this.headerEl || !this.filterPickerEl) return;
		const filterSet = this.getCurrentFilterSet();
		if (!filterSet) return;
		const button = renderRelatedViewsLauncher({
			container: this.headerEl,
			settings: this.getSettings(),
			source: { type: 'filter', preset: { id: filterSet.id, name: filterSet.name } },
			buttonClass: 'operon-filter-related-views-button',
			closeBeforeOpen: () => this.setFilterPickerOpen(false),
			onOpenRelatedView: target => this.onOpenRelatedView?.(target),
			onCreateRelatedView: target => this.onCreateRelatedView?.(target),
		});
		if (!button) return;
		this.headerEl.insertBefore(button, this.filterPickerEl.nextSibling);
		this.relatedViewsButtonEl = button;
	}

	private syncSearchPlaceholder(totalCount: number): void {
		if (!this.searchInputEl) return;
		this.searchInputEl.placeholder = this.formatTaskCount(totalCount);
		if (this.searchInputEl.value !== this.searchQuery) {
			this.searchInputEl.value = this.searchQuery;
		}
	}

	private formatTaskCount(count: number): string {
		return t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) });
	}

	private attachLazyLoadSentinel(list: HTMLElement, totalCount: number): void {
		if (this.visibleTaskLimit >= totalCount) return;
		const sentinel = list.createDiv('operon-filter-lazy-sentinel');
		this.lazyLoadObserver = new IntersectionObserver((entries) => {
			if (!entries.some(entry => entry.isIntersecting)) return;
			this.lazyLoadObserver?.disconnect();
			this.lazyLoadObserver = null;
			this.visibleTaskLimit = Math.min(this.visibleTaskLimit + FILTER_RENDER_BATCH_SIZE, totalCount);
			this.lastRenderSignature = null;
			this.render();
		}, { root: null, rootMargin: '160px 0px' });
		this.lazyLoadObserver.observe(sentinel);
	}

	private getCachedTreeScope(rootTasks: IndexedTask[]): IndexedTask[] {
		const includeSubtasks = this.settings.filterShowSubtasks === true;
		const showOnlyOpenSubtasks = this.settings.filterShowOnlyOpenSubtasks === true;
		if (!includeSubtasks) return rootTasks;

		const signature = [
			this.indexer.getGeneration(),
			this.currentFilterSetId ?? '',
			showOnlyOpenSubtasks ? 'open-only' : 'all-subtasks',
			buildWorkflowStatusOrderSignature(this.getPipelines()),
			buildWorkflowStatusSemanticsSignature(this.getPipelines()),
			rootTasks.map(task => task.operonId).join(','),
		].join('|');
		if (this.treeScopeCache?.signature === signature) {
			return this.treeScopeCache.tasks;
		}

		const tasks = buildFilterTreeScope(rootTasks, {
			getIndexedTask: (id) => this.indexer.getTask(id),
			getChildIds: this.getChildIds,
			pipelines: this.getPipelines(),
			showOnlyOpenSubtasks,
		});
		this.treeScopeCache = { signature, tasks };
		return tasks;
	}

	private getRenderedFilterTask(task: IndexedTask): IndexedTask {
		const patch = this.optimisticTaskPatches.get(task.operonId);
		return patch ? applyOptimisticRenderPatch(task, patch) : task;
	}

	private applyOptimisticFilterStatusPatch(taskId: string, patchInput: OptimisticTaskPatchInput): boolean {
		const task = this.indexer.getTask(taskId);
		if (!task) return false;
		const normalized = normalizeOptimisticFieldValues(patchInput.fieldValues);
		if (Object.keys(normalized).length === 0 && !patchInput.checkbox) return false;

		this.optimisticTaskPatches.set(taskId, {
			fieldValues: normalized,
			checkbox: patchInput.checkbox,
			expiresAt: Date.now() + 10000,
		});
		this.scheduleOptimisticTaskPatchCleanup();
		this.lastRenderSignature = null;
		this.renderPreservingScroll();
		return true;
	}

	private invokeFilterStatusCycle(taskId: string): void {
		const startedAt = enginePerfNow();
		const task = this.indexer.getTask(taskId);
		const optimistic = task ? buildOptimisticStatusPatch(task, this.getSettings()) : null;
		let fallbackReason = 'none';
		let applied = false;

		if (optimistic) {
			applied = this.applyOptimisticFilterStatusPatch(taskId, optimistic.patch);
			if (!applied) fallbackReason = 'patch-empty';
		} else {
			fallbackReason = task ? 'next-status-unavailable' : 'task-missing';
		}

		enginePerfLog(
			'filter.optimisticStatus',
			`taskId=${taskId}`,
			`applied=${String(applied)}`,
			`nextStatus=${optimistic?.nextStatus ?? 'none'}`,
			`nextCheckbox=${optimistic?.nextCheckbox ?? 'none'}`,
			`renderMs=${Math.round(enginePerfNow() - startedAt)}`,
			`fallbackReason=${fallbackReason}`,
		);

		void Promise.resolve(this.cycleStatusFn(taskId)).catch(error => {
			console.error('Operon: filter view status cycle failed', error);
			this.optimisticTaskPatches.delete(taskId);
			this.lastRenderSignature = null;
			this.renderPreservingScroll();
		});
	}

	private pruneOptimisticTaskPatches(now = Date.now()): void {
		let changed = false;
		for (const [taskId, patch] of this.optimisticTaskPatches.entries()) {
			const task = this.indexer.getTask(taskId);
			const isExpired = now >= patch.expiresAt;
			const isPersisted = !!task && isOptimisticTaskPatchPersisted(task, patch);
			if (!task || isExpired || isPersisted) {
				this.optimisticTaskPatches.delete(taskId);
				changed = true;
			}
		}
		if (changed) {
			this.scheduleOptimisticTaskPatchCleanup();
		}
	}

	private scheduleOptimisticTaskPatchCleanup(): void {
		if (this.optimisticPatchCleanupTimer !== null) {
			window.clearTimeout(this.optimisticPatchCleanupTimer);
			this.optimisticPatchCleanupTimer = null;
		}
		if (this.optimisticTaskPatches.size === 0) return;

		const nextExpiry = Math.min(...Array.from(this.optimisticTaskPatches.values()).map(patch => patch.expiresAt));
		const delay = Math.max(0, nextExpiry - Date.now());
		this.optimisticPatchCleanupTimer = window.setTimeout(() => {
			this.optimisticPatchCleanupTimer = null;
			this.pruneOptimisticTaskPatches();
			this.lastRenderSignature = null;
			this.renderPreservingScroll();
		}, delay);
	}

	private clearOptimisticTaskPatches(): void {
		this.optimisticTaskPatches.clear();
		if (this.optimisticPatchCleanupTimer !== null) {
			window.clearTimeout(this.optimisticPatchCleanupTimer);
			this.optimisticPatchCleanupTimer = null;
		}
	}

	private syncSelectOptions(): void {
		if (!this.filterPickerButtonEl || !this.filterPickerMenuEl) return;
		const optionsSignature = [
			this.currentFilterSetId ?? '',
			this.getVisibleFilterSets().map(fs => `${fs.id}:${fs.name}:${fs.icon ?? ''}`).join('|'),
		].join('::');
		const selected = this.getCurrentFilterSet();
		this.filterPickerButtonEl.empty();
		const selectedIcon = this.filterPickerButtonEl.createSpan('operon-filter-picker-icon');
		setIcon(selectedIcon, selected?.icon?.trim() || 'filter');
		this.filterPickerButtonEl.createSpan({
			cls: 'operon-filter-picker-label',
			text: selected?.name || t('filterSets', 'noFilterSets'),
		});
		const chevron = this.filterPickerButtonEl.createSpan('operon-filter-picker-chevron');
		setIcon(chevron, 'chevron-down');

		if (optionsSignature === this.lastSelectOptionsSignature) return;
		this.filterPickerMenuEl.empty();
		for (const fs of this.getVisibleFilterSets()) {
			const option = this.filterPickerMenuEl.createEl('button', {
				cls: `operon-filter-picker-option${fs.id === this.currentFilterSetId ? ' is-selected' : ''}`,
				attr: { type: 'button', role: 'option', 'aria-selected': fs.id === this.currentFilterSetId ? 'true' : 'false' },
			});
			const icon = option.createSpan('operon-filter-picker-icon');
			setIcon(icon, fs.icon?.trim() || 'filter');
			option.createSpan({ cls: 'operon-filter-picker-label', text: fs.name });
			option.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.currentFilterSetId = fs.id;
				this.searchQuery = '';
				if (this.searchInputEl) this.searchInputEl.value = '';
				this.setFilterPickerOpen(false);
				this.syncLeafTitle();
				this.lastRenderSignature = null;
				this.lastSelectOptionsSignature = null;
				this.render();
			});
		}
		this.lastSelectOptionsSignature = optionsSignature;
	}

	private setFilterPickerOpen(open: boolean): void {
		this.filterPickerEl?.toggleClass('is-open', open);
		this.filterPickerButtonEl?.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	private buildRenderSignature(filterSet: FilterSet): string {
		const compactSettingsSignature = JSON.stringify(this.settings.filterTaskCompactChips);
		const filterActionSettingsSignature = JSON.stringify([
			this.settings.filterTaskShowPlayAction,
			this.settings.filterTaskShowPinAction,
			this.settings.filterTaskShowSubtaskAction,
			this.settings.filterTaskShowPlainCheckboxAction,
		]);
		const overlaySettingsSignature = buildTaskWikilinkOverlaySettingsSignature(this.settings);
		const taskStatusIconSettingsSignature = buildTaskStatusIconRenderSettingsSignature(this.settings);
		const includeLocationIndexSignature = shouldResolveLocationCompactChips(this.settings, this.settings.filterTaskCompactChips)
			|| shouldResolveLocationCompactChips(this.settings, this.settings.taskWikilinkOverlayCompactChips);
		const locationIndexSignature = includeLocationIndexSignature
			? getLocationPlaceIndex(this.app, this.settings).getSignature()
			: '';
		const keyMappingSignature = JSON.stringify(
			this.settings.keyMappings.map(mapping => [
				mapping.canonicalKey,
				mapping.visiblePropertyName,
				mapping.icon ?? '',
			]),
		);
		return [
			this.indexer.getGeneration(),
			this.pinnedCache?.getGeneration() ?? 0,
			this.getTrackingSignature?.() ?? '',
			this.getProjectSerialSignature?.() ?? '',
			this.getRepeatSkipSignature?.() ?? '',
			this.currentFilterSetId ?? '',
			this.searchQuery.trim().toLocaleLowerCase(),
			JSON.stringify(filterSet),
			compactSettingsSignature,
			filterActionSettingsSignature,
				overlaySettingsSignature,
				taskStatusIconSettingsSignature,
				buildWorkflowStatusOrderSignature(this.settings.pipelines),
				buildWorkflowStatusSemanticsSignature(this.settings.pipelines),
				locationIndexSignature,
			keyMappingSignature,
			this.getVisibleFilterSets().map(fs => `${fs.id}:${fs.name}:${fs.icon ?? ''}`).join('|'),
		].join('|');
	}

	private renderPreservingScroll(): void {
		const container = this.contentEl;
		const containerScrollTop = Math.max(0, Math.round(container.scrollTop));
		const listScrollTop = Math.max(0, Math.round(this.listEl?.scrollTop ?? 0));
		this.render();
		this.restoreFilterScroll(container, containerScrollTop, listScrollTop);
		window.requestAnimationFrame(() => {
			this.restoreFilterScroll(container, containerScrollTop, listScrollTop);
		});
	}

	private restoreFilterScroll(
		container: HTMLElement | undefined,
		containerScrollTop: number,
		listScrollTop: number,
	): void {
		if (container) {
			const maxContainerScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
			container.scrollTop = Math.max(0, Math.min(maxContainerScrollTop, containerScrollTop));
		}
		if (this.listEl && listScrollTop > 0) {
			const maxListScrollTop = Math.max(0, this.listEl.scrollHeight - this.listEl.clientHeight);
			this.listEl.scrollTop = Math.max(0, Math.min(maxListScrollTop, listScrollTop));
		}
	}

	private isLeafVisible(): boolean {
		return this.containerEl.isConnected && this.containerEl.getClientRects().length > 0;
	}
}
