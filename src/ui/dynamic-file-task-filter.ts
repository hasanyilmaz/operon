import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import {
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_ID,
	materializeDynamicFileTaskFilterSet,
	materializeDynamicSubtasksFilterSet,
	normalizeDynamicFileTaskFilterSet,
	normalizeDynamicSubtasksFilterSet,
} from '../core/dynamic-file-task-filter';
import { createOwnerElement } from '../core/dom-compat';
import { resolveFileTaskAutoParentOperonId } from '../core/file-task-auto-parent';
import type { IndexedTask } from '../types/fields';
import type { FilterSet, OperonSettings } from '../types/settings';
import { resolveWorkflowStatus } from '../types/pipeline';
import { getFilterSortSpecs } from '../core/filter-evaluator';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import {
	createFilterSurfaceInstance,
	destroyFilterSurfaceInstance,
	EmbedFilterDeps,
	FilterSurfaceInstance,
	renderFilterSurface,
} from './embed-filter-processor';
import { operonIndexRefreshEffect } from './live-preview-conceal';
import { isPlainCheckboxPopoverEditorElement } from './plain-checkbox-popover-scope';

export const DYNAMIC_FILE_TASK_FILTER_HOST_CLASS = 'operon-dynamic-file-task-filter-host';
const DYNAMIC_FILE_TASK_FILTER_PLACEMENT_CLASSES = [
	`${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--body-top`,
	`${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--body-bottom`,
];
export interface DynamicFileTaskFilterContext {
	fileTask: IndexedTask;
	filterSet: FilterSet;
	template: FilterSet;
}

export interface SubtasksFilterContext {
	parentTask: IndexedTask;
	filterSet: FilterSet;
	template: FilterSet;
}

export function resolveDynamicFileTaskFilterContext(
	filePath: string,
	deps: EmbedFilterDeps,
): DynamicFileTaskFilterContext | null {
	const settings = deps.getSettings();
	if (!settings.dynamicFileTaskFilterEnabled) return null;
	if (!filePath) return null;

	const fileTask = resolveDynamicFileTask(filePath, deps, settings);
	if (!fileTask || fileTask.primary.format !== 'yaml' || !fileTask.operonId) return null;

	const template = getDynamicFileTaskFilterTemplate(settings);
	return {
		fileTask,
		template,
		filterSet: materializeDynamicFileTaskFilterSet(template, fileTask.operonId),
	};
}

function resolveDynamicFileTask(
	filePath: string,
	deps: EmbedFilterDeps,
	settings: OperonSettings,
): IndexedTask | null {
	const indexedFileTask = deps.indexer.getFileTaskByPath(filePath);
	if (indexedFileTask?.primary.format === 'yaml') return indexedFileTask;

	const frontmatter = deps.app.metadataCache.getCache(filePath)?.frontmatter ?? null;
	const operonId = resolveFileTaskAutoParentOperonId({
		enabled: true,
		filePath,
		tasks: deps.indexer.getAllTasks(),
		frontmatter,
		keyMappings: settings.keyMappings,
	});
	const fallbackTask = operonId ? deps.indexer.getTask(operonId) ?? null : null;
	return fallbackTask?.primary.format === 'yaml' && fallbackTask.primary.filePath === filePath
		? fallbackTask
		: null;
}

export function resolveSubtasksFilterContext(
	parentTaskId: string,
	deps: EmbedFilterDeps,
): SubtasksFilterContext | null {
	const normalizedParentTaskId = parentTaskId.trim();
	if (!normalizedParentTaskId) return null;

	const parentTask = deps.indexer.getTask(normalizedParentTaskId);
	if (!parentTask?.operonId) return null;

	const template = getDynamicSubtasksFilterTemplate(deps.getSettings());
	return {
		parentTask,
		template,
		filterSet: materializeDynamicSubtasksFilterSet(template, parentTask.operonId),
	};
}

export function renderDynamicFileTaskFilterSurface(
	instance: FilterSurfaceInstance,
	filePath: string,
	deps: EmbedFilterDeps,
	onEditFilter?: (template: FilterSet) => void,
): boolean {
	const context = resolveDynamicFileTaskFilterContext(filePath, deps);
	if (!context) {
		destroyFilterSurfaceInstance(instance);
		instance.el.empty();
		return false;
	}

	const settings = deps.getSettings();
	renderDynamicTaskFilterSurface(instance, context.fileTask, context.template, context.filterSet, deps, {
		showSubtasks: shouldAutoExpandDynamicFileTaskSubtasks(context.fileTask.operonId, deps, settings),
		showOnlyOpenSubtasks: settings.dynamicFileTaskFilterShowOnlyOpenSubtasks,
		onEditFilter,
	});
	return true;
}

export function renderSubtasksFilterSurface(
	instance: FilterSurfaceInstance,
	parentTaskId: string,
	deps: EmbedFilterDeps,
	onEditFilter?: (template: FilterSet) => void,
): boolean {
	const context = resolveSubtasksFilterContext(parentTaskId, deps);
	if (!context) {
		destroyFilterSurfaceInstance(instance);
		instance.el.empty();
		return false;
	}

	const settings = deps.getSettings();
	renderDynamicTaskFilterSurface(instance, context.parentTask, context.template, context.filterSet, deps, {
		showSubtasks: shouldAutoExpandDynamicSubtasksFilterSubtasks(context.parentTask.operonId, deps, settings),
		showOnlyOpenSubtasks: settings.dynamicSubtasksFilterShowOnlyOpenSubtasks,
		onEditFilter,
	});
	return true;
}

interface DynamicTaskFilterSurfaceOptions {
	showSubtasks: boolean;
	showOnlyOpenSubtasks: boolean;
	onEditFilter?: (template: FilterSet) => void;
}

function renderDynamicTaskFilterSurface(
	instance: FilterSurfaceInstance,
	rootTask: IndexedTask,
	template: FilterSet,
	filterSet: FilterSet,
	deps: EmbedFilterDeps,
	options: DynamicTaskFilterSurfaceOptions,
): void {
	const rootTaskId = rootTask.operonId;
	const dynamicDeps: EmbedFilterDeps = {
		...deps,
		navigateToTask: (task) => {
			if (task.operonId === rootTaskId) return;
			deps.navigateToTask(task);
		},
	};
	renderFilterSurface(instance, filterSet, dynamicDeps, {
		surfaceClassName: 'operon-filter-surface--dynamic-file-task',
		showSubtasks: options.showSubtasks,
		showOnlyOpenSubtasks: options.showOnlyOpenSubtasks,
		includeSubtasksInSearch: true,
		preserveManualSubtaskExpansion: true,
		showSettingsButton: true,
		subtaskSorts: getFilterSortSpecs(filterSet),
		dynamicRootTaskId: rootTaskId,
		onEditFilter: () => options.onEditFilter?.(template),
	});
}

export interface DynamicFileTaskSubtaskCountDeps {
	getChildIds: (parentId: string) => string[];
	getTask: (operonId: string) => IndexedTask | undefined;
	getPipelines: () => ReturnType<EmbedFilterDeps['getPipelines']>;
}

export function shouldAutoExpandDynamicFileTaskSubtasks(
	rootTaskId: string,
	deps: EmbedFilterDeps,
	settings: OperonSettings,
): boolean {
	return shouldAutoExpandDynamicTaskSubtasks(
		rootTaskId,
		deps,
		settings.dynamicFileTaskFilterShowOnlyOpenSubtasks,
		settings.dynamicFileTaskFilterSubtaskAutoExpandLimit,
	);
}

export function shouldAutoExpandDynamicSubtasksFilterSubtasks(
	rootTaskId: string,
	deps: EmbedFilterDeps,
	settings: OperonSettings,
): boolean {
	return shouldAutoExpandDynamicTaskSubtasks(
		rootTaskId,
		deps,
		settings.dynamicSubtasksFilterShowOnlyOpenSubtasks,
		settings.dynamicSubtasksFilterSubtaskAutoExpandLimit,
	);
}

function shouldAutoExpandDynamicTaskSubtasks(
	rootTaskId: string,
	deps: EmbedFilterDeps,
	showOnlyOpenSubtasks: boolean,
	limit: number,
): boolean {
	if (limit <= 0) return false;
	const visibleCount = countVisibleDynamicFileTaskDescendants(rootTaskId, {
		getChildIds: deps.getChildIds,
		getTask: (operonId) => deps.indexer.getTask(operonId),
		getPipelines: deps.getPipelines,
	}, showOnlyOpenSubtasks, limit);
	return visibleCount <= limit;
}

export function countVisibleDynamicFileTaskDescendants(
	rootTaskId: string,
	deps: DynamicFileTaskSubtaskCountDeps,
	showOnlyOpenSubtasks: boolean,
	limit = Number.MAX_SAFE_INTEGER,
): number {
	let count = 0;
	const pipelines = deps.getPipelines();
	const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const visit = (parentId: string, ancestors: Set<string>): void => {
		if (count > limit) return;
		for (const childId of deps.getChildIds(parentId)) {
			if (childId === parentId || ancestors.has(childId)) continue;
			const childTask = deps.getTask(childId);
			if (!childTask) continue;
			if (showOnlyOpenSubtasks && !isOpenDynamicFileTaskSubtask(
				childTask,
				pipelines,
				workflowStatusIdentityIndex,
			)) continue;
			count += 1;
			if (count > limit) return;
			visit(childId, new Set([...ancestors, childId]));
			if (count > limit) return;
		}
	};
	visit(rootTaskId, new Set([rootTaskId]));
	return count;
}

function isOpenDynamicFileTaskSubtask(
	task: IndexedTask,
	pipelines: ReturnType<DynamicFileTaskSubtaskCountDeps['getPipelines']>,
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): boolean {
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) return workflow.checkbox === 'open';
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) return false;
	if (task.checkbox === 'done' || !!task.fieldValues['dateCompleted']?.trim()) return false;
	return true;
}

export function applyDynamicFileTaskFilterHostPlacement(
	host: HTMLElement,
	placement: OperonSettings['dynamicFileTaskFilterPlacement'],
): void {
	host.removeClasses(DYNAMIC_FILE_TASK_FILTER_PLACEMENT_CLASSES);
	host.addClass(`${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--${placement}`);
}

export function resolveDynamicFileTaskFilterInsertLine(
	docText: string,
	settings: OperonSettings,
): number {
	const lines = docText.split('\n');
	const bodyTopLine = findBodyTopLine(lines);
	const placement = settings.dynamicFileTaskFilterPlacement;
	if (placement === 'body-bottom') return Math.max(lines.length + 1, 1);
	return bodyTopLine;
}

export interface DynamicFileTaskFilterLivePreviewCallbacks {
	getFilePath: (view: EditorView) => string;
	getFilterDeps: () => EmbedFilterDeps;
	openDynamicFilterSettings: (template: FilterSet) => void;
}

export function operonDynamicFileTaskFilterLivePreviewExtension(
	callbacks: DynamicFileTaskFilterLivePreviewCallbacks,
): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			private lastLivePreview = false;
			private lastFilePath = '';
			private lastPlacement: OperonSettings['dynamicFileTaskFilterPlacement'] | null = null;
			private retryTimer: number | null = null;
			private syncTimer: number | null = null;
			private hostEl: HTMLElement | null = null;
			private instance: FilterSurfaceInstance | null = null;

			constructor(view: EditorView) {
				this.lastLivePreview = this.isLivePreview(view);
				this.scheduleSync(view, 0);
				this.scheduleInitialRetry(view);
			}

			update(update: ViewUpdate): void {
				const hasRefresh = update.transactions.some(transaction =>
					transaction.effects.some(effect => effect.is(operonIndexRefreshEffect))
				);
				const nowLive = this.isLivePreview(update.view);
				const modeChanged = nowLive !== this.lastLivePreview;
				const filePath = nowLive ? callbacks.getFilePath(update.view) : '';
				const filePathChanged = filePath !== this.lastFilePath;
				const placement = nowLive
					? callbacks.getFilterDeps().getSettings().dynamicFileTaskFilterPlacement
					: null;
				const placementChanged = placement !== this.lastPlacement;
				const hostMissing = !this.hostEl || !this.hostEl.isConnected;
				this.lastLivePreview = nowLive;

				if (modeChanged || hasRefresh || update.docChanged || filePathChanged || placementChanged) {
					this.scheduleSync(update.view, 0);
				} else if (nowLive && hostMissing && (update.viewportChanged || update.geometryChanged || update.focusChanged)) {
					this.scheduleSync(update.view, 0);
				} else if (nowLive && this.hostEl && (update.viewportChanged || update.geometryChanged)) {
					this.scheduleSync(update.view, 0);
				}
			}

			destroy(): void {
				if (this.syncTimer !== null) {
					window.clearTimeout(this.syncTimer);
					this.syncTimer = null;
				}
				if (this.retryTimer !== null) {
					window.clearTimeout(this.retryTimer);
					this.retryTimer = null;
				}
				this.destroyHost();
			}

			private cancelSyncTimer(): void {
				if (this.syncTimer !== null) {
					window.clearTimeout(this.syncTimer);
					this.syncTimer = null;
				}
			}

			private scheduleSync(view: EditorView, delayMs: number): void {
				this.cancelSyncTimer();
				this.syncTimer = window.setTimeout(() => {
					this.syncTimer = null;
					if (!view.dom.isConnected) return;
					this.sync(view);
				}, delayMs);
			}

			private sync(view: EditorView): void {
				if (isPlainCheckboxPopoverEditorElement(view.dom)) {
					this.lastFilePath = '';
					this.lastPlacement = null;
					this.destroyHost();
					return;
				}
				if (!this.isLivePreview(view)) {
					this.lastFilePath = '';
					this.lastPlacement = null;
					this.destroyHost();
					return;
				}

				const deps = callbacks.getFilterDeps();
				const filePath = callbacks.getFilePath(view);
				const filePathChanged = filePath !== this.lastFilePath;
				this.lastFilePath = filePath;
				const settings = deps.getSettings();
				this.lastPlacement = settings.dynamicFileTaskFilterPlacement;
				const context = resolveDynamicFileTaskFilterContext(filePath, deps);
				if (!context) {
					this.destroyHost();
					return;
				}

				const container = findLivePreviewSizer(view);
				if (!container) {
					this.destroyHost();
					return;
				}

				const host = this.ensureHost(view);
				insertLivePreviewHost(container, host, settings);
				refreshLivePreviewHostFrame(container, host);
				if (filePathChanged && this.instance) {
					destroyFilterSurfaceInstance(this.instance);
					this.instance = null;
				}
				if (!this.instance) {
					this.instance = createFilterSurfaceInstance(host);
				}
				renderDynamicFileTaskFilterSurface(
					this.instance,
					filePath,
					deps,
					callbacks.openDynamicFilterSettings,
				);
			}

			private isLivePreview(view: EditorView): boolean {
				try {
					return view.state.field(editorLivePreviewField);
				} catch {
					return false;
				}
			}

			private ensureHost(view: EditorView): HTMLElement {
				if (!this.hostEl) {
					this.hostEl = createDynamicFileTaskFilterHost(view.dom, 'live-preview');
				}
				return this.hostEl;
			}

			private destroyHost(): void {
				if (this.instance) {
					destroyFilterSurfaceInstance(this.instance);
					this.instance = null;
				}
				this.hostEl?.remove();
				this.hostEl = null;
			}

			private scheduleInitialRetry(view: EditorView): void {
				if (!this.isLivePreview(view)) return;
				this.retryTimer = window.setTimeout(() => {
					this.retryTimer = null;
					if (!view.dom.isConnected) return;
					try {
						view.dispatch({ effects: operonIndexRefreshEffect.of() });
					} catch {
						// The editor may be gone before the first deferred refresh.
					}
				}, 0);
			}
		},
	);

	return plugin;
}

function getDynamicFileTaskFilterTemplate(settings: OperonSettings): FilterSet {
	return normalizeDynamicFileTaskFilterSet(
		settings.filterSets.find(filterSet => filterSet.id === DYNAMIC_FILE_TASK_FILTER_ID) ?? null,
	);
}

function getDynamicSubtasksFilterTemplate(settings: OperonSettings): FilterSet {
	return normalizeDynamicSubtasksFilterSet(
		settings.filterSets.find(filterSet => filterSet.id === DYNAMIC_SUBTASKS_FILTER_ID) ?? null,
	);
}

function createDynamicFileTaskFilterHost(owner: HTMLElement, surface: 'live-preview'): HTMLElement {
	const host = createOwnerElement(owner, 'div');
	host.className = `${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS} ${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--${surface}`;
	host.setAttribute('contenteditable', 'false');
	host.setAttribute('spellcheck', 'false');
	host.setAttribute('data-widget-type', 'dynamic-file-task-filter');
	return host;
}

function findLivePreviewSizer(view: EditorView): HTMLElement | null {
	const sourceView = view.dom.closest<HTMLElement>('.markdown-source-view');
	return sourceView?.querySelector<HTMLElement>('.cm-sizer')
		?? view.dom.querySelector<HTMLElement>('.cm-sizer')
		?? null;
}

function insertLivePreviewHost(container: HTMLElement, host: HTMLElement, settings: OperonSettings): void {
	const placement = settings.dynamicFileTaskFilterPlacement;
	applyDynamicFileTaskFilterHostPlacement(host, placement);
	if (placement === 'body-bottom') {
		insertLivePreviewHostAtBottom(container, host);
		return;
	}
	host.style.removeProperty('--operon-dynamic-file-task-filter-margin-top');
	insertLivePreviewHostAtBodyTop(container, host);
}

function refreshLivePreviewHostFrame(container: HTMLElement, host: HTMLElement): void {
	host.style.removeProperty('--operon-dynamic-file-task-filter-width');
	host.style.removeProperty('--operon-dynamic-file-task-filter-inline-start');
	host.style.removeProperty('--operon-dynamic-file-task-filter-inline-end');

	const reference = findLivePreviewLineWidthReference(container);
	if (!reference) return;

	const containerRect = container.getBoundingClientRect();
	const referenceRect = reference.getBoundingClientRect();
	if (containerRect.width <= 0 || referenceRect.width <= 0) return;

	const inlineStart = Math.max(0, Math.round(referenceRect.left - containerRect.left));
	const inlineEnd = Math.max(0, Math.round(containerRect.right - referenceRect.right));
	host.style.setProperty('--operon-dynamic-file-task-filter-width', `${Math.round(referenceRect.width)}px`);
	host.style.setProperty('--operon-dynamic-file-task-filter-inline-start', `${inlineStart}px`);
	host.style.setProperty('--operon-dynamic-file-task-filter-inline-end', `${inlineEnd}px`);
}

function insertLivePreviewHostAtBodyTop(container: HTMLElement, host: HTMLElement): void {
	container.insertBefore(host, findLivePreviewBodyTopReference(container));
}

function insertLivePreviewHostAtBottom(container: HTMLElement, host: HTMLElement): void {
	const contentContainer = findLivePreviewContentContainer(container);
	if (contentContainer?.parentNode) {
		contentContainer.parentNode.insertBefore(host, contentContainer.nextSibling);
		refreshLivePreviewBottomOffset(container, host);
		return;
	}
	container.appendChild(host);
	refreshLivePreviewBottomOffset(container, host);
}

function refreshLivePreviewBottomOffset(container: HTMLElement, host: HTMLElement): void {
	host.style.removeProperty('--operon-dynamic-file-task-filter-margin-top');
	const content = container.querySelector<HTMLElement>('.cm-content');
	const contentContainer = content?.closest<HTMLElement>('.cm-contentContainer') ?? null;
	if (!content || !contentContainer) return;

	const lineBottom = getMaxElementBottom(
		Array.from(content.children).filter((child): child is HTMLElement =>
			child.instanceOf(HTMLElement) && child.classList.contains('cm-line')
		),
	);
	const contentContainerBottom = getElementBottom(contentContainer);
	if (lineBottom === null || contentContainerBottom === null) return;

	const virtualGap = Math.max(0, Math.round(contentContainerBottom - lineBottom));
	if (virtualGap <= 0) return;

	const baseMargin = parseCssPx(host.ownerDocument.defaultView?.getComputedStyle(host).marginTop ?? '') ?? 8;
	host.style.setProperty(
		'--operon-dynamic-file-task-filter-margin-top',
		`${Math.round(baseMargin - virtualGap)}px`,
	);
}

function getElementBottom(element: HTMLElement): number | null {
	const rect = element.getBoundingClientRect();
	return rect.width <= 0 && rect.height <= 0 ? null : rect.bottom;
}

function getDeepElementBottom(element: HTMLElement): number | null {
	let bottom = getElementBottom(element);
	for (const child of Array.from(element.querySelectorAll('*'))) {
		if (!child.instanceOf(HTMLElement)) continue;
		const childBottom = getElementBottom(child);
		if (childBottom !== null && (bottom === null || childBottom > bottom)) {
			bottom = childBottom;
		}
	}
	return bottom;
}

function getMaxElementBottom(elements: HTMLElement[]): number | null {
	let bottom: number | null = null;
	for (const element of elements) {
		const elementBottom = getDeepElementBottom(element);
		if (elementBottom !== null && (bottom === null || elementBottom > bottom)) {
			bottom = elementBottom;
		}
	}
	return bottom;
}

function parseCssPx(value: string): number | null {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function findLivePreviewBodyTopReference(container: HTMLElement): ChildNode | null {
	const metadata = container.querySelector<HTMLElement>('.metadata-container, .frontmatter-container');
	if (metadata) {
		const directChild = findDirectChild(container, metadata);
		return directChild?.nextSibling ?? null;
	}
	const header = Array.from(container.children).find((child): child is HTMLElement =>
		child.instanceOf(HTMLElement)
		&& child.classList.contains('mod-header')
		&& child.classList.contains('mod-ui')
	);
	if (header) return header.nextSibling;
	const pusher = findDirectChildByClass(container, 'markdown-preview-pusher');
	return pusher?.nextSibling ?? container.firstChild;
}

function findDirectChild(container: HTMLElement, descendant: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = descendant;
	while (current?.parentElement && current.parentElement !== container) {
		current = current.parentElement;
	}
	return current?.parentElement === container ? current : null;
}

function findDirectChildByClass(container: HTMLElement, className: string): HTMLElement | null {
	for (const child of Array.from(container.children)) {
		if (child.instanceOf(HTMLElement) && child.classList.contains(className)) return child;
	}
	return null;
}

function findLivePreviewContentContainer(container: HTMLElement): HTMLElement | null {
	const content = container.querySelector<HTMLElement>('.cm-content');
	if (content) return content.closest<HTMLElement>('.cm-contentContainer') ?? content;
	const candidates = Array.from(container.children).filter((child): child is HTMLElement =>
		child.instanceOf(HTMLElement)
		&& !child.classList.contains(DYNAMIC_FILE_TASK_FILTER_HOST_CLASS)
		&& !child.classList.contains('embedded-backlinks')
		&& !child.classList.contains('markdown-preview-pusher')
		&& !child.classList.contains('mod-footer')
	);
	return candidates[candidates.length - 1] ?? null;
}

function findLivePreviewLineWidthReference(container: HTMLElement): HTMLElement | null {
	const lines = Array.from(container.querySelectorAll<HTMLElement>('.cm-content .cm-line'));
	for (const line of lines) {
		const rect = line.getBoundingClientRect();
		if (rect.width > 0) return line;
	}
	return container.querySelector<HTMLElement>('.cm-content');
}

function findBodyTopLine(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 1;
	for (let index = 1; index < lines.length; index++) {
		const trimmed = lines[index].trim();
		if (trimmed === '---' || trimmed === '...') {
			return index + 2;
		}
	}
	return 1;
}
