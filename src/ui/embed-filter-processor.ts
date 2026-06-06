/**
 * Embedded Filter Processor — renders saved filter views inside notes.
 *
 * Usage in any markdown file:
 * ```operon
 * filter: "My Filter Name"
 * ```
 *
 * The code block is replaced with a live task list using the named filter set
 * defined in Settings → Filters. Reuses the same evaluator and task bar
 * rendering as the sidebar Filter View.
 */

import { App, MarkdownPostProcessorContext, Notice, setIcon } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { cloneFilterSet, FilterSet, OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { t } from '../core/i18n';
import { evaluateFilterSet, evaluateFilterSetGrouped, filterTasksOnly, sortFilterTasks } from '../core/filter-evaluator';
import { PinnedCache } from '../storage/pinned-cache';
import { buildFilterTaskRowElement, FilterTaskRowCallbacks } from './filter-task-row';
import { shouldResolveLocationCompactChips } from './compact-task-layout';
import { FilterSetModal, type FilterSetModalQuickActions } from './filter-set-modal';
import { ConfirmActionModal } from './confirm-action-modal';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { applyFilterSearch, buildFilterTreeScope, isFilterSearchActive } from '../systems/filter-search';
import {
    FILTER_RENDER_BATCH_SIZE,
    getVisibleFilterTasks,
    getVisibleGroupedFilterResults,
} from '../systems/filter-lazy-render';
import { getOwnerDocument } from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
import { closeIconOnlyChipPreviewsForRoot } from './icon-only-chip-preview';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskWikilinkOverlaySettingsSignature } from './task-file-overlay-chips';
import { isDynamicFileTaskFilterSet } from '../core/dynamic-file-task-filter';
import { getLocationPlaceIndex } from '../core/location-source-resolver';

function generateFilterSetId(): string {
    return 'fs_' + Math.random().toString(36).slice(2, 9);
}

export interface EmbedFilterDeps {
    app: App;
    indexer: OperonIndexer;
    settings: OperonSettings;
    openTaskEditor: (operonId: string) => void;
    toggleCheckbox: (operonId: string) => void;
    cycleStatus: (operonId: string) => void;
    getPipelines: () => Pipeline[];
    getPriorities: () => PriorityDefinition[];
    saveSettings: () => Promise<void>;
    getChildIds: (parentId: string) => string[];
    navigateToTask: (task: import('../types/fields').IndexedTask) => void;
    getSettings: () => OperonSettings;
    updateField: (operonId: string, key: string, value: string) => void;
    updateFields?: (operonId: string, payload: Record<string, string>) => void;
    updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
    updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
    requestSubtask?: (operonId: string) => void | Promise<void>;
    onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
    pinnedCache?: PinnedCache;
    isTaskTracking?: (taskId: string) => boolean;
    toggleTimer?: (taskId: string) => void | Promise<void>;
    getTrackingSignature?: () => string;
    saveFilterSet?: (filterSet: FilterSet) => Promise<void>;
    openDailyNote?: (dateKey: string) => void | Promise<void>;
    duplicateFilterSet?: (filterSet: FilterSet) => Promise<void>;
    deleteFilterSet?: (filterSetId: string) => Promise<void>;
}

/** Tracks live embed instances for refresh */
export interface FilterSurfaceInstance {
    el: HTMLElement;        // The code block's root element
    lastRenderSignature: string | null;
    expandedTaskIds: Set<string>;
    searchQuery: string;
    treeScopeCache: { signature: string; tasks: import('../types/fields').IndexedTask[] } | null;
    visibleTaskLimit: number;
    lastPaginationSignature: string | null;
    lazyLoadObserver: IntersectionObserver | null;
}

interface EmbedInstance extends FilterSurfaceInstance {
    filterId: string | null;
    filterName: string | null;
}

export interface FilterSurfaceRenderOptions {
    surfaceClassName?: string;
    showSubtasks?: boolean;
    showOnlyOpenSubtasks?: boolean;
    includeSubtasksInSearch?: boolean;
    preserveManualSubtaskExpansion?: boolean;
    showSettingsButton?: boolean;
    onEditFilter?: (filterSet: FilterSet) => void;
}

/** Active embed instances — pruned on refresh when DOM is detached */
const activeEmbeds: Set<EmbedInstance> = new Set();

export function createFilterSurfaceInstance(el: HTMLElement): FilterSurfaceInstance {
    return {
        el,
        lastRenderSignature: null,
        expandedTaskIds: new Set<string>(),
        searchQuery: '',
        treeScopeCache: null,
        visibleTaskLimit: FILTER_RENDER_BATCH_SIZE,
        lastPaginationSignature: null,
        lazyLoadObserver: null,
    };
}

export function destroyFilterSurfaceInstance(instance: FilterSurfaceInstance): void {
    closeEmbedTransientUi(instance.el);
    instance.lazyLoadObserver?.disconnect();
    instance.lazyLoadObserver = null;
    instance.lastRenderSignature = null;
}

/**
 * Parse the code block content to extract a filter reference.
 * Supports:
 * - filterId: "fs_abc123"
 * - filter: "My Filter Name"
 */
function parseFilterReference(source: string): { filterId: string | null; filterName: string | null } | null {
    let filterId: string | null = null;
    let filterName: string | null = null;

    for (const line of source.split('\n')) {
        const trimmed = line.trim();
        const idMatch = trimmed.match(/^filterId:\s*["']?(.+?)["']?\s*$/i);
        if (idMatch) filterId = idMatch[1];

        const nameMatch = trimmed.match(/^filter:\s*["']?(.+?)["']?\s*$/i);
        if (nameMatch) filterName = nameMatch[1];
    }

    if (!filterId && !filterName) return null;
    return { filterId, filterName };
}

function resolveFilterSet(
    settings: OperonSettings,
    ref: { filterId: string | null; filterName: string | null },
): FilterSet | null {
    if (ref.filterId) {
        const byId = settings.filterSets.find(fs => fs.id === ref.filterId);
        if (byId && !isDynamicFileTaskFilterSet(byId)) return byId;
    }

    if (ref.filterName) {
        return settings.filterSets.find(
            fs => !isDynamicFileTaskFilterSet(fs) && fs.name.toLowerCase() === ref.filterName!.toLowerCase(),
        ) ?? null;
    }

    return null;
}

/**
 * Register the `operon` code block processor on the plugin.
 * Call this from the plugin's onload() method.
 */
export function registerEmbedFilterProcessor(
    registerFn: (lang: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>) => void,
    deps: EmbedFilterDeps,
): void {
    registerFn('operon', (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        const filterRef = parseFilterReference(source);

        if (!filterRef) {
            renderError(el, 'Invalid syntax. Use: filterId: "Filter Id" or filter: "Filter Name"');
            return;
        }

        // Track this instance for live refresh
        const instance: EmbedInstance = {
            ...createFilterSurfaceInstance(el),
            el,
            filterId: filterRef.filterId,
            filterName: filterRef.filterName,
        };
        activeEmbeds.add(instance);

        renderEmbed(instance, filterRef, deps);
    });
}

/**
 * Refresh all active embedded filter views.
 * Call this from refreshViews() to keep embeds in sync with index.
 */
export function refreshEmbedFilters(deps: EmbedFilterDeps): void {
    for (const instance of activeEmbeds) {
        // Prune detached DOM nodes
        if (!instance.el.isConnected) {
            closeEmbedTransientUi(instance.el);
            instance.lazyLoadObserver?.disconnect();
            activeEmbeds.delete(instance);
            continue;
        }
        renderEmbed(instance, {
            filterId: instance.filterId,
            filterName: instance.filterName,
        }, deps);
    }
}

function renderEmbed(
    instance: EmbedInstance,
    filterRef: { filterId: string | null; filterName: string | null },
    deps: EmbedFilterDeps,
): void {
    const el = instance.el;
    const filterSet = resolveFilterSet(deps.settings, filterRef);

    if (!filterSet) {
        instance.lastRenderSignature = null;
        closeEmbedTransientUi(el);
        el.empty();
        const label = filterRef.filterId ?? filterRef.filterName ?? 'unknown';
        renderError(el, `Filter "${label}" not found. Define it in Settings → Operon → Filters.`);
        return;
    }

    renderFilterSurface(instance, filterSet, deps, {
        surfaceClassName: 'operon-filter-surface--embed',
        showSettingsButton: true,
    });
}

export function renderFilterSurface(
    instance: FilterSurfaceInstance,
    filterSet: FilterSet,
    deps: EmbedFilterDeps,
    options: FilterSurfaceRenderOptions = {},
): void {
    const el = instance.el;
    const activeInput = el.querySelector<HTMLInputElement>('.operon-filter-search-input');
    const restoreSearchFocus = getOwnerDocument(el).activeElement === activeInput;
    const searchSelectionStart = activeInput?.selectionStart ?? null;
    const searchSelectionEnd = activeInput?.selectionEnd ?? null;

    const includeLocationIndexSignature = shouldResolveLocationCompactChips(deps.settings, deps.settings.filterTaskCompactChips)
        || shouldResolveLocationCompactChips(deps.settings, deps.settings.overlayTaskCompactChips);
    const renderSignature = [
        deps.indexer.getGeneration(),
        deps.pinnedCache?.getGeneration() ?? 0,
        deps.getTrackingSignature?.() ?? '',
        filterSet.id,
        instance.searchQuery.trim().toLocaleLowerCase(),
        JSON.stringify(filterSet),
        options.surfaceClassName ?? '',
        options.showSubtasks === undefined ? 'settings-subtasks' : String(options.showSubtasks),
        options.showOnlyOpenSubtasks === undefined ? 'settings-open-subtasks' : String(options.showOnlyOpenSubtasks),
        options.includeSubtasksInSearch === true ? 'search-subtasks' : 'search-rendered-roots',
        options.preserveManualSubtaskExpansion === true ? 'preserve-manual-expansion' : 'reset-manual-expansion',
        options.showSettingsButton === false ? 'no-settings' : 'settings',
        JSON.stringify(deps.settings.filterTaskCompactChips),
        buildTaskWikilinkOverlaySettingsSignature(deps.settings),
        includeLocationIndexSignature ? getLocationPlaceIndex(deps.app, deps.settings).getSignature() : '',
        JSON.stringify(deps.settings.keyMappings.map(mapping => [
            mapping.canonicalKey,
            mapping.visiblePropertyName,
            mapping.icon ?? '',
        ])),
    ].join('|');
    if (instance.lastRenderSignature === renderSignature) return;
    if (renderSignature !== instance.lastPaginationSignature) {
        instance.visibleTaskLimit = FILTER_RENDER_BATCH_SIZE;
        instance.lastPaginationSignature = renderSignature;
    }
    instance.lastRenderSignature = renderSignature;
    instance.lazyLoadObserver?.disconnect();
    instance.lazyLoadObserver = null;
    closeEmbedTransientUi(el);
    el.empty();

    // Build callbacks — same interface as sidebar FilterView
    const callbacks: FilterTaskRowCallbacks = {
        app: deps.app,
        getPipelines: deps.getPipelines,
        getPriorities: deps.getPriorities,
        getIndexedTask: (id) => deps.indexer.getTask(id),
        getFileTaskByPath: (filePath) => deps.indexer.getFileTaskByPath(filePath),
        getDescendantTaskSummary: (operonId) => deps.indexer.getDescendantTaskSummary(operonId),
        getChildIds: deps.getChildIds,
        openEditor: (operonId) => deps.openTaskEditor(operonId),
        cycleStatus: (operonId) => { deps.cycleStatus(operonId); },
        navigateToTask: deps.navigateToTask,
        getSettings: deps.getSettings,
        getAllTasks: () => deps.indexer.getAllTasks(),
        updateField: deps.updateField,
        updateFields: deps.updateFields,
        updateSubtasks: deps.updateSubtasks,
        updateDependencyField: deps.updateDependencyField,
        requestSubtask: deps.requestSubtask,
        onContextualAction: deps.onContextualAction,
        isTaskPinned: deps.pinnedCache ? (taskId) => deps.pinnedCache?.isPinned(taskId) === true : undefined,
        isTaskTracking: deps.isTaskTracking,
        toggleTimer: deps.toggleTimer,
    };
    const embedSettings = deps.getSettings();
    const embedShowSubtasks = options.showSubtasks ?? embedSettings.filterShowSubtasks === true;
    const embedShowOnlyOpenSubtasks = options.showOnlyOpenSubtasks ?? embedSettings.filterShowOnlyOpenSubtasks === true;
    const includeSubtasksInSearch = options.includeSubtasksInSearch === true || embedShowSubtasks;
    if (!embedShowSubtasks && options.preserveManualSubtaskExpansion !== true) {
        instance.expandedTaskIds.clear();
    }
    const taskRowOptions = {
        defaultExpandAll: embedShowSubtasks,
        showOnlyOpenSubtasks: embedShowOnlyOpenSubtasks,
        showSubtaskAction: embedSettings.filterTaskShowSubtaskAction,
    };

    // Container
    const container = el.createDiv(`operon-embed operon-filter-surface ${options.surfaceClassName ?? 'operon-filter-surface--embed'}`);
    const allTasks = deps.indexer.getAllTasks();
    const priorities = deps.getPriorities();

    // Render results
	    if (filterSet.groupBy) {
	        // Grouped
	        const baseGrouped = evaluateFilterSetGrouped(filterSet, allTasks, priorities, deps.pinnedCache);
	        const searchActive = isFilterSearchActive(instance.searchQuery);
	        const baseRootTasks = filterTasksOnly(filterSet, allTasks, priorities, deps.pinnedCache);
	        const treeScopeTasks = getEmbedTreeScope(instance, filterSet, baseRootTasks, deps, includeSubtasksInSearch, embedShowOnlyOpenSubtasks);
	        const searchInput = renderHeader(container, filterSet, deps, treeScopeTasks.length, instance, options);

        if (searchActive) {
            const tasks = sortFilterTasks(
                filterSet,
                applyFilterSearch(treeScopeTasks, instance.searchQuery),
                priorities,
                deps.pinnedCache,
            );
            if (tasks.length === 0) {
                container.createDiv({ cls: 'operon-embed-empty', text: t('filters', 'noMatches') });
                restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
                return;
            }
            const list = container.createDiv('operon-embed-list');
            for (const task of getVisibleFilterTasks(tasks, instance.visibleTaskLimit)) {
                const bar = buildFilterTaskRowElement(task, callbacks, instance.expandedTaskIds, {
                    ...taskRowOptions,
                    allowExpand: false,
                }, list);
                list.appendChild(bar);
            }
            attachEmbedLazyLoadSentinel(instance, list, tasks.length, filterSet, deps, options);
            restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
            return;
        }

        const grouped = baseGrouped;
        if (grouped.totalCount === 0) {
            container.createDiv({ cls: 'operon-embed-empty', text: t('filters', 'noMatches') });
            restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
            return;
        }

        const list = container.createDiv('operon-embed-list');

        const visibleGrouped = getVisibleGroupedFilterResults(grouped, instance.visibleTaskLimit);
        for (const group of visibleGrouped.groups) {
            const label = group.key || t('filterSets', 'groupEmpty');
            const header = list.createDiv('operon-group-header');
            // Make date-format labels (YYYY-MM-DD) clickable → opens daily note
            if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
                const noteExists = deps.app.vault.getFiles().some(f => f.basename === label);
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
	                    if (deps.openDailyNote) {
	                        runAsyncAction('embedded filter daily note open failed', async () => {
	                            await deps.openDailyNote!(label);
	                        });
	                    } else {
	                        runAsyncAction('embedded filter daily note link open failed', () => deps.app.workspace.openLinkText(label, '', 'tab'));
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
                        const bar = buildFilterTaskRowElement(task, callbacks, instance.expandedTaskIds, taskRowOptions, list);
                        list.appendChild(bar);
                    }
                }
            } else {
                for (const task of group.tasks) {
                    const bar = buildFilterTaskRowElement(task, callbacks, instance.expandedTaskIds, taskRowOptions, list);
                    list.appendChild(bar);
                }
            }
        }
        attachEmbedLazyLoadSentinel(instance, list, grouped.totalCount, filterSet, deps, options);
        restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
    } else {
        // Flat
        const baseTasks = evaluateFilterSet(filterSet, allTasks, priorities, deps.pinnedCache);
        const searchActive = isFilterSearchActive(instance.searchQuery);
        const treeScopeTasks = getEmbedTreeScope(instance, filterSet, baseTasks, deps, includeSubtasksInSearch, embedShowOnlyOpenSubtasks);
        const tasks = searchActive
            ? sortFilterTasks(
                filterSet,
                applyFilterSearch(treeScopeTasks, instance.searchQuery),
                priorities,
                deps.pinnedCache,
            )
            : baseTasks;

        const searchInput = renderHeader(container, filterSet, deps, treeScopeTasks.length, instance, options);

        if (tasks.length === 0) {
            container.createDiv({ cls: 'operon-embed-empty', text: t('filters', 'noMatches') });
            restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
            return;
        }

        const list = container.createDiv('operon-embed-list');

        for (const task of getVisibleFilterTasks(tasks, instance.visibleTaskLimit)) {
            const bar = buildFilterTaskRowElement(task, callbacks, instance.expandedTaskIds, {
                ...taskRowOptions,
                allowExpand: !searchActive,
            }, list);
            list.appendChild(bar);
        }
        attachEmbedLazyLoadSentinel(instance, list, tasks.length, filterSet, deps, options);
        restoreEmbedSearchFocus(searchInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
    }
}

function attachEmbedLazyLoadSentinel(
    instance: FilterSurfaceInstance,
    list: HTMLElement,
    totalCount: number,
    filterSet: FilterSet,
    deps: EmbedFilterDeps,
    options: FilterSurfaceRenderOptions,
): void {
    if (instance.visibleTaskLimit >= totalCount) return;
    const sentinel = list.createDiv('operon-filter-lazy-sentinel');
    instance.lazyLoadObserver = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        instance.lazyLoadObserver?.disconnect();
        instance.lazyLoadObserver = null;
        instance.visibleTaskLimit = Math.min(instance.visibleTaskLimit + FILTER_RENDER_BATCH_SIZE, totalCount);
        instance.lastRenderSignature = null;
        renderFilterSurface(instance, filterSet, deps, options);
    }, { root: null, rootMargin: '160px 0px' });
    instance.lazyLoadObserver.observe(sentinel);
}

function closeEmbedTransientUi(root: HTMLElement): void {
    closeFloatingPanelsForRoot(root);
    closeIconOnlyChipPreviewsForRoot(root);
}

function renderHeader(
    container: HTMLElement,
    filterSet: FilterSet,
    deps: EmbedFilterDeps,
    count: number,
    instance: FilterSurfaceInstance,
    options: FilterSurfaceRenderOptions,
): HTMLInputElement {
    const header = container.createDiv('operon-embed-header');
    const title = header.createDiv('operon-embed-title');
    const icon = header.createSpan('operon-embed-filter-icon');
    setIcon(icon, filterSet.icon?.trim() || 'filter');
    title.appendChild(icon);
    title.createSpan({ cls: 'operon-embed-name', text: filterSet.name });

    const searchWrap = header.createDiv('operon-filter-search-wrap');
    const searchIcon = searchWrap.createSpan('operon-filter-search-icon');
    setIcon(searchIcon, 'scan-search');
    const searchInput = searchWrap.createEl('input', {
        cls: 'operon-filter-search-input',
        attr: {
            type: 'search',
            placeholder: formatFilterTaskCount(count),
        },
    });
    setAccessibleLabelWithoutTooltip(searchInput, t('filterSets', 'searchTasksInFilter'));
    searchInput.value = instance.searchQuery;
    searchInput.addEventListener('input', () => {
        instance.searchQuery = searchInput.value;
        instance.lastRenderSignature = null;
        renderFilterSurface(instance, filterSet, deps, options);
    });

    if (options.showSettingsButton !== false) {
        const cogBtn = header.createEl('button', { cls: 'operon-embed-settings-btn' });
        setIcon(cogBtn, 'settings-2');
        bindOperonHoverTooltip(cogBtn, {
            content: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
            taskColor: null,
        });
        cogBtn.addEventListener('click', () => {
            if (options.onEditFilter) {
                options.onEditFilter(filterSet);
                return;
            }
            let modal: FilterSetModal | null = null;
            const clone = cloneFilterSet(filterSet);
	            modal = new FilterSetModal(deps.app, clone, deps.settings.keyMappings, asyncHandler('embedded filter settings save failed', async (saved) => {
	                if (deps.saveFilterSet) {
	                    await deps.saveFilterSet(saved);
	                } else {
	                    const idx = deps.settings.filterSets.findIndex(f => f.id === saved.id);
	                    if (idx !== -1) deps.settings.filterSets[idx] = saved;
	                    await deps.saveSettings();
	                }
	            }), {
                indexer: deps.indexer,
                getPipelines: deps.getPipelines,
                getPriorities: deps.getPriorities,
                openEditor: deps.openTaskEditor,
                cycleStatus: deps.cycleStatus,
                getChildIds: deps.getChildIds,
                navigateToTask: deps.navigateToTask,
                getSettings: deps.getSettings,
                updateField: deps.updateField,
                updateFields: deps.updateFields,
                updateSubtasks: deps.updateSubtasks,
                updateDependencyField: deps.updateDependencyField,
                onContextualAction: deps.onContextualAction,
                pinnedCache: deps.pinnedCache,
                isTaskTracking: deps.isTaskTracking,
                toggleTimer: deps.toggleTimer,
            }, {
                quickActions: createEmbeddedFilterSetModalQuickActions(instance, filterSet, deps, () => modal?.close()),
            });
            modal.open();
        });
    }

    return searchInput;
}

async function copyFilterSetEmbedCode(filterSet: FilterSet): Promise<void> {
    const code = '```operon\nfilterId: "' + filterSet.id + '"\n```';
    await navigator.clipboard.writeText(code);
    new Notice(t('filterSets', 'embedCodeCopied'));
}

async function duplicateEmbeddedFilterSet(filterSet: FilterSet, deps: EmbedFilterDeps, instance: FilterSurfaceInstance): Promise<void> {
    if (deps.duplicateFilterSet) {
        await deps.duplicateFilterSet(filterSet);
    } else {
        const copy = cloneFilterSet(filterSet);
        copy.id = generateFilterSetId();
        copy.name = `${filterSet.name} Copy`;
        const idx = deps.settings.filterSets.findIndex(entry => entry.id === filterSet.id);
        deps.settings.filterSets.splice(idx === -1 ? deps.settings.filterSets.length : idx + 1, 0, copy);
        await deps.saveSettings();
    }
    instance.lastRenderSignature = null;
}

function confirmDeleteEmbeddedFilterSet(
    filterSet: FilterSet,
    deps: EmbedFilterDeps,
    instance: FilterSurfaceInstance,
    closeModal: () => void,
): void {
    new ConfirmActionModal(
        deps.app,
        {
            title: t('filterSets', 'deleteFilterTitle'),
            message: t('filterSets', 'deleteFilterMessage').replace('{{name}}', filterSet.name),
            confirmText: t('filterSets', 'deleteFilterConfirm'),
            cancelText: t('filterSets', 'deleteFilterCancel'),
            danger: true,
        },
        asyncHandler('embedded filter delete failed', async (confirmed) => {
            if (!confirmed) return;
            if (deps.deleteFilterSet) {
                await deps.deleteFilterSet(filterSet.id);
            } else {
                deps.settings.filterSets = deps.settings.filterSets.filter(entry => entry.id !== filterSet.id);
                await deps.saveSettings();
            }
            instance.lastRenderSignature = null;
            closeModal();
        }),
    ).open();
}

function createEmbeddedFilterSetModalQuickActions(
    instance: FilterSurfaceInstance,
    filterSet: FilterSet,
    deps: EmbedFilterDeps,
    closeModal: () => void,
): FilterSetModalQuickActions {
    return {
        copyEmbedCode: async () => {
            await copyFilterSetEmbedCode(filterSet);
        },
        duplicate: async () => {
            await duplicateEmbeddedFilterSet(filterSet, deps, instance);
        },
        remove: () => {
            confirmDeleteEmbeddedFilterSet(filterSet, deps, instance, closeModal);
        },
    };
}

function formatFilterTaskCount(count: number): string {
    return t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) });
}

function getEmbedTreeScope(
    instance: FilterSurfaceInstance,
    filterSet: FilterSet,
    rootTasks: import('../types/fields').IndexedTask[],
    deps: EmbedFilterDeps,
    includeSubtasks: boolean,
    showOnlyOpenSubtasks: boolean,
): import('../types/fields').IndexedTask[] {
    if (!includeSubtasks) return rootTasks;

    const signature = [
        deps.indexer.getGeneration(),
        filterSet.id,
        showOnlyOpenSubtasks ? 'open-only' : 'all-subtasks',
        rootTasks.map(task => task.operonId).join(','),
    ].join('|');
    if (instance.treeScopeCache?.signature === signature) {
        return instance.treeScopeCache.tasks;
    }

    const tasks = buildFilterTreeScope(rootTasks, {
        getIndexedTask: (id) => deps.indexer.getTask(id),
        getChildIds: deps.getChildIds,
        pipelines: deps.getPipelines(),
        showOnlyOpenSubtasks,
    });
    instance.treeScopeCache = { signature, tasks };
    return tasks;
}

function restoreEmbedSearchFocus(
    input: HTMLInputElement,
    shouldRestore: boolean,
    selectionStart: number | null,
    selectionEnd: number | null,
): void {
    if (!shouldRestore) return;
    window.requestAnimationFrame(() => {
        input.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
            input.setSelectionRange(selectionStart, selectionEnd);
        }
    });
}

function renderError(el: HTMLElement, message: string): void {
    const container = el.createDiv('operon-embed operon-embed-error');
    container.createSpan({ text: `⚠ ${message}` });
}
