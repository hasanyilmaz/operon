import { EditorState, Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import {
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_ID,
	materializeDynamicFileTaskFilterSet,
	materializeDynamicSubtasksFilterSet,
	normalizeDynamicFileTaskFilterSet,
	normalizeDynamicSubtasksFilterSet,
} from '../core/dynamic-file-task-filter';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
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
import { allowsOperonDocumentAugmentations, operonEditorSurfaceScopeFacet } from './editor-augmentation-scope';

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
		activateDescription: deps.activateDescription ? (task, event, anchor) => {
			if (task.operonId === rootTaskId) return;
			deps.activateDescription?.(task, event, anchor);
		} : undefined,
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
	const selected = `${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--${placement}`;
	for (const name of DYNAMIC_FILE_TASK_FILTER_PLACEMENT_CLASSES) {
		if (name !== selected && host.classList.contains(name)) host.classList.remove(name);
	}
	if (!host.classList.contains(selected)) host.classList.add(selected);
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
	/** True for a full document or File Body editor, never a table cell or short-field editor. */
	isDocumentEditor: (view: EditorView) => boolean;
	getFilterDeps: () => EmbedFilterDeps;
	openDynamicFilterSettings: (template: FilterSet) => void;
}

export function operonDynamicFileTaskFilterLivePreviewExtension(
	callbacks: DynamicFileTaskFilterLivePreviewCallbacks,
): Extension {
	const sourceContextEffect = StateEffect.define<{ filePath: string; documentEditor: boolean }>();
	const measuredHeightEffect = StateEffect.define<{ filePath: string; height: number }>();
	class TopFilterWidget extends WidgetType {
		constructor(readonly filePath: string, readonly height: number) { super(); }
		eq(other: TopFilterWidget): boolean { return this.filePath === other.filePath && this.height === other.height; }
		get estimatedHeight(): number { return this.height; }
		toDOM(view: EditorView): HTMLElement {
			const owner = view.plugin(plugin);
			if (!owner) throw new Error('Dynamic filter view owner is unavailable');
			return owner.mountTop(view, this.filePath);
		}
		updateDOM(dom: HTMLElement, view: EditorView): boolean {
			return view.plugin(plugin)?.ownsTop(dom, this.filePath) ?? false;
		}
	}
	type TopState = {
		decorations: DecorationSet;
		filePath: string;
		fallbackPath: string;
		documentEditor: boolean;
		live: boolean;
		placement: OperonSettings['dynamicFileTaskFilterPlacement'];
		enabled: boolean;
		height: number;
	};
	function buildTopState(state: EditorState, fallbackPath: string, height: number, documentEditor: boolean): TopState {
		const filePath = state.field(editorInfoField, false)?.file?.path ?? fallbackPath;
		const live = documentEditor && state.facet(operonEditorSurfaceScopeFacet) === 'document' && state.field(editorLivePreviewField, false) === true;
		const deps = callbacks.getFilterDeps();
		const { dynamicFileTaskFilterPlacement: placement, dynamicFileTaskFilterEnabled: enabled } = deps.getSettings();
		let decorations = Decoration.none;
		if (live && enabled && placement === 'body-top' && resolveDynamicFileTaskFilterContext(filePath, deps)) {
			const line = resolveDynamicFileTaskFilterInsertLine(state.doc.toString(), deps.getSettings());
			const position = line <= state.doc.lines ? state.doc.line(line).from : state.doc.length;
			decorations = Decoration.set([Decoration.widget({ block: true, side: -1, widget: new TopFilterWidget(filePath, height) }).range(position)]);
		}
		return { decorations, filePath, fallbackPath, documentEditor, live, placement, enabled, height };
	}
	const topField = StateField.define<TopState>({
		create: state => buildTopState(state, '', -1, false),
		update(value, transaction) {
			const state = transaction.state;
			let fallbackPath = value.fallbackPath;
			let documentEditor = value.documentEditor;
			let height = value.height;
			let refresh = false;
			for (const effect of transaction.effects) {
				if (effect.is(sourceContextEffect)) {
					fallbackPath = effect.value.filePath;
					documentEditor = effect.value.documentEditor;
				}
				if (effect.is(operonIndexRefreshEffect)) refresh = true;
				if (effect.is(measuredHeightEffect) && effect.value.filePath === value.filePath) height = effect.value.height;
			}
			const filePath = state.field(editorInfoField, false)?.file?.path ?? fallbackPath;
			const settings = callbacks.getFilterDeps().getSettings();
			const live = documentEditor && state.facet(operonEditorSurfaceScopeFacet) === 'document' && state.field(editorLivePreviewField, false) === true;
			const contextChanged = documentEditor !== value.documentEditor || filePath !== value.filePath || live !== value.live
				|| settings.dynamicFileTaskFilterPlacement !== value.placement || settings.dynamicFileTaskFilterEnabled !== value.enabled;
			if (contextChanged) height = -1;
			if (!transaction.docChanged && !refresh && !contextChanged && height === value.height && fallbackPath === value.fallbackPath) return value;
			return buildTopState(state, fallbackPath, height, documentEditor);
		},
		provide: field => EditorView.decorations.from(field, value => value.decorations),
	});
	const plugin = ViewPlugin.fromClass(
		class {
			private lastLivePreview = false;
			private lastFilePath = '';
			private lastPlacement: OperonSettings['dynamicFileTaskFilterPlacement'] | null = null;
			private retryTimer: number | null = null;
			private syncTimer: number | null = null;
			private hostEl: HTMLElement | null = null;
			private instance: FilterSurfaceInstance | null = null;
			private contentDirty = false;
			private frameDirty = false;
			private measureRevision = 0;
			private topObserver: ResizeObserver | null = null;
			private topMeasurePending = false;
			private destroyed = false;

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
				const filePath = nowLive ? update.state.field(editorInfoField, false)?.file?.path ?? callbacks.getFilePath(update.view) : '';
				const filePathChanged = filePath !== this.lastFilePath;
				const placement = nowLive
					? callbacks.getFilterDeps().getSettings().dynamicFileTaskFilterPlacement
					: null;
				const placementChanged = placement !== this.lastPlacement;
				const hostMissing = !this.hostEl || (placement === 'body-bottom' && !this.hostEl.isConnected);
				this.lastLivePreview = nowLive;
				if (modeChanged || filePathChanged || placementChanged) {
					this.measureRevision++;
					this.topMeasurePending = false;
				}

				if (modeChanged || hasRefresh || update.docChanged || filePathChanged || placementChanged) {
					this.scheduleSync(update.view, 0);
				} else if (nowLive && hostMissing && (update.viewportChanged || update.geometryChanged || update.focusChanged)) {
					this.scheduleSync(update.view, 0);
				} else if (nowLive && this.hostEl && (update.geometryChanged || (update.viewportChanged && placement === 'body-bottom'))) {
					this.scheduleSync(update.view, 0, false, update.geometryChanged || placement === 'body-bottom');
				}
			}

			destroy(): void {
				this.destroyed = true;
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

			private scheduleSync(view: EditorView, delayMs: number, contentDirty = true, frameDirty = true): void {
				this.contentDirty ||= contentDirty;
				this.frameDirty ||= frameDirty;
				this.cancelSyncTimer();
				this.syncTimer = window.setTimeout(() => {
					this.syncTimer = null;
					if (this.destroyed || !view.dom.isConnected) return;
					const contentDirty = this.contentDirty;
					const frameDirty = this.frameDirty;
					this.contentDirty = this.frameDirty = false;
					this.sync(view, contentDirty, frameDirty);
				}, delayMs);
			}

			private sync(view: EditorView, contentDirty: boolean, frameDirty: boolean, renderFilePath?: string): void {
				if (isPlainCheckboxPopoverEditorElement(view.dom)) {
					this.lastFilePath = '';
					this.lastPlacement = null;
					this.destroyHost();
					return;
				}
				if (!this.isLivePreview(view)) {
					if (view.state.field(topField).documentEditor) {
						view.dispatch({ effects: sourceContextEffect.of({ filePath: '', documentEditor: false }) });
					}
					this.lastFilePath = '';
					this.lastPlacement = null;
					this.destroyHost();
					return;
				}

				const deps = callbacks.getFilterDeps();
				const filePath = renderFilePath ?? view.state.field(editorInfoField, false)?.file?.path ?? callbacks.getFilePath(view);
				if (!view.state.field(topField).documentEditor || view.state.field(topField).filePath !== filePath) {
					view.dispatch({ effects: sourceContextEffect.of({ filePath, documentEditor: true }) });
					return;
				}
				const filePathChanged = filePath !== this.lastFilePath;
				this.lastFilePath = filePath;
				const settings = deps.getSettings();
				this.lastPlacement = settings.dynamicFileTaskFilterPlacement;
				if ((contentDirty || filePathChanged || !this.instance) && !resolveDynamicFileTaskFilterContext(filePath, deps)) {
					this.destroyHost();
					return;
				}
				const top = settings.dynamicFileTaskFilterPlacement === 'body-top';
				const container = top ? null : findLivePreviewSizer(view);
				if (!top && !container) {
					this.destroyHost();
					return;
				}

				const host = this.ensureHost(view);
				if (top) {
					applyDynamicFileTaskFilterHostPlacement(host, 'body-top');
					host.classList.add('operon-dynamic-file-task-filter-host--block');
					for (const name of ['width', 'inline-start', 'inline-end', 'margin-top']) setHostProperty(host, `--operon-dynamic-file-task-filter-${name}`, null);
				} else if (container) {
					this.topObserver?.disconnect();
					this.topObserver = null;
					host.classList.remove('operon-dynamic-file-task-filter-host--block');
					insertLivePreviewHost(container, host, settings);
				}
				if (filePathChanged && this.instance) {
					destroyFilterSurfaceInstance(this.instance);
					this.instance = null;
				}
				const needsRender = contentDirty || filePathChanged || !this.instance;
				if (!this.instance) this.instance = createFilterSurfaceInstance(host);
				if (needsRender && !renderDynamicFileTaskFilterSurface(
					this.instance, filePath, deps, callbacks.openDynamicFilterSettings,
				)) {
					this.destroyHost();
					return;
				}
				if (top) {
					if (!this.topObserver) {
						const Observer = (getOwnerWindow(host) as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
						if (Observer) {
							const observer = new Observer(() => this.measureTop(view, host));
							this.topObserver = observer;
							observer.observe(host);
						}
					}
					if (frameDirty || needsRender) this.measureTop(view, host);
				} else if (container && (frameDirty || needsRender)) this.measureFrame(view, container, host, settings.dynamicFileTaskFilterPlacement);
			}

			mountTop(view: EditorView, filePath: string): HTMLElement {
				if (view.state.field(topField).filePath !== filePath) throw new Error('Stale dynamic filter widget');
				this.sync(view, this.contentDirty || !this.instance || this.lastFilePath !== filePath, true, filePath);
				this.contentDirty = false;
				return this.ensureHost(view);
			}

			ownsTop(dom: HTMLElement, filePath: string): boolean {
				return this.hostEl === dom && this.lastFilePath === filePath;
			}

			private measureTop(view: EditorView, host: HTMLElement): void {
				if (this.topMeasurePending || this.destroyed || this.hostEl !== host || this.lastPlacement !== 'body-top') return;
				this.topMeasurePending = true;
				const revision = this.measureRevision;
				const filePath = this.lastFilePath;
				const current = () => !this.destroyed && this.measureRevision === revision && this.hostEl === host
					&& this.lastPlacement === 'body-top' && this.lastFilePath === filePath && host.isConnected;
				view.requestMeasure({
					key: this,
					read: () => current() ? host.getBoundingClientRect().height : null,
					write: height => {
						if (revision === this.measureRevision) this.topMeasurePending = false;
						if (height === null || !current() || height <= 0 || view.state.field(topField).height === height) return;
						queueMicrotask(() => {
							if (current() && view.state.field(topField, false)?.filePath === filePath) {
								view.dispatch({ effects: measuredHeightEffect.of({ filePath, height }) });
							}
						});
					},
				});
			}

			private measureFrame(view: EditorView, container: HTMLElement, host: HTMLElement, placement: OperonSettings['dynamicFileTaskFilterPlacement']): void {
				const revision = ++this.measureRevision;
				const current = () => this.hostEl === host && this.measureRevision === revision && view.dom.isConnected && host.isConnected;
				view.requestMeasure({
					key: this,
					read: () => current() ? readLivePreviewHostFrame(container, placement) : null,
					write: frame => {
						if (!frame || !current()) return;
						for (const [name, value] of Object.entries(frame)) setHostProperty(host, name, value);
					},
				});
			}

			private isLivePreview(view: EditorView): boolean {
				if (!allowsOperonDocumentAugmentations(view) || !callbacks.isDocumentEditor(view)) return false;
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
				this.measureRevision++;
				this.topMeasurePending = false;
				this.topObserver?.disconnect();
				this.topObserver = null;
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
					if (this.destroyed || !view.dom.isConnected) return;
					try {
						view.dispatch({ effects: operonIndexRefreshEffect.of() });
					} catch {
						// The editor may be gone before the first deferred refresh.
					}
				}, 0);
			}
		},
	);

	return [topField, plugin];
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
	applyDynamicFileTaskFilterHostPlacement(host, settings.dynamicFileTaskFilterPlacement);
	insertLivePreviewHostAtBottom(container, host);
}

function setHostProperty(host: HTMLElement, name: string, value: string | null): void {
	if (host.style.getPropertyValue(name) === (value ?? '')) return;
	if (value === null) host.style.removeProperty(name);
	else host.style.setProperty(name, value);
}

function readLivePreviewHostFrame(container: HTMLElement, placement: OperonSettings['dynamicFileTaskFilterPlacement']): Record<string, string | null> {
	const frame: Record<string, string | null> = {
		'--operon-dynamic-file-task-filter-width': null,
		'--operon-dynamic-file-task-filter-inline-start': null,
		'--operon-dynamic-file-task-filter-inline-end': null,
		'--operon-dynamic-file-task-filter-margin-top': placement === 'body-bottom' ? readLivePreviewBottomOffset(container) : null,
	};
	const reference = findLivePreviewLineWidthReference(container);
	if (!reference) return frame;
	const containerRect = container.getBoundingClientRect();
	const referenceRect = reference.getBoundingClientRect();
	if (containerRect.width <= 0 || referenceRect.width <= 0) return frame;
	frame['--operon-dynamic-file-task-filter-width'] = `${Math.round(referenceRect.width)}px`;
	frame['--operon-dynamic-file-task-filter-inline-start'] = `${Math.max(0, Math.round(referenceRect.left - containerRect.left))}px`;
	frame['--operon-dynamic-file-task-filter-inline-end'] = `${Math.max(0, Math.round(containerRect.right - referenceRect.right))}px`;
	return frame;
}


function insertLivePreviewHostAtBottom(container: HTMLElement, host: HTMLElement): void {
	const contentContainer = findLivePreviewContentContainer(container);
	if (contentContainer?.parentNode) {
		if (contentContainer.nextSibling !== host) contentContainer.parentNode.insertBefore(host, contentContainer.nextSibling);
		return;
	}
	if (host.parentNode !== container || host.nextSibling) container.appendChild(host);
}

function readLivePreviewBottomOffset(container: HTMLElement): string | null {
	const content = container.querySelector<HTMLElement>('.cm-content');
	const contentContainer = content?.closest<HTMLElement>('.cm-contentContainer') ?? null;
	if (!content || !contentContainer) return null;
	const lineBottom = getMaxElementBottom(
		Array.from(content.children).filter((child): child is HTMLElement =>
			child.instanceOf(HTMLElement) && child.classList.contains('cm-line')
		),
	);
	const contentContainerBottom = getElementBottom(contentContainer);
	if (lineBottom === null || contentContainerBottom === null) return null;
	const virtualGap = Math.max(0, Math.round(contentContainerBottom - lineBottom));
	// Keep the existing theme spacing live without clearing an override to measure it.
	return virtualGap > 0 ? `calc(var(--operon-dynamic-file-task-filter-spacing, 8px) - ${virtualGap}px)` : null;
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
