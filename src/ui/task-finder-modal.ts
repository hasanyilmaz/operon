import { App, getIcon, Modal, Platform, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import {
	buildProjectSearchCandidates,
	ProjectSearchCandidate,
	ProjectSearchMode,
	rankTaskSearchResults,
	resolveProjectSearchVisibleTaskIds,
} from '../systems/task-search';
import { IndexedTask } from '../types/fields';
import { resolveWorkflowStatus } from '../types/pipeline';
import { localToday } from '../core/local-time';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, InlineTaskCompactChipKey, OperonSettings, resolveTaskDisplayIcon, TaskFinderDefaultScopeItem } from '../types/settings';
import {
	buildInlineTaskCompactChipEntries,
	createInlineTaskCompactChipElement,
	InlineTaskCompactChipEntry,
	shouldResolveLocationCompactChips,
} from './compact-task-layout';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import {
	applyTaskSearchBoxShortcutCommand,
	createTaskSearchBoxScopeState,
	getTaskFinderPriorityRank,
	getTaskHappensTodayPriority,
	getTaskModifiedTime,
	getTaskOverdueDate,
	TaskSearchBoxScopeState,
	toggleTaskSearchBoxScope,
} from './task-search-box-integration';
import { asHTMLElement, createOwnerElement } from '../core/dom-compat';

type TaskFinderResult =
	| { kind: 'project'; candidate: ProjectSearchCandidate }
	| { kind: 'task'; task: IndexedTask; score: number };

export interface TaskFinderModalOptions {
	initialScope?: {
		projectMode?: ProjectSearchMode | null;
		showOverdue?: boolean;
		showHappensToday?: boolean;
		showRecentModified?: boolean;
		includeInline?: boolean;
		includeFile?: boolean;
		includeCancelled?: boolean;
		includeFinished?: boolean;
	};
	onCancel?: () => void;
	onPersistDefaultScope?: (scope: TaskFinderDefaultScopeItem[], selectedProjectId: string) => void | Promise<void>;
}

const TASK_FINDER_MIN_QUERY_LENGTH = 2;
const TASK_FINDER_RENDER_LIMIT = 25;

export class TaskFinderModal extends Modal {
	private inputEl!: HTMLTextAreaElement;
	private modeButtons = new Map<ProjectSearchMode, HTMLButtonElement>();
	private overdueButton!: HTMLButtonElement;
	private happensTodayButton!: HTMLButtonElement;
	private recentModifiedButton!: HTMLButtonElement;
	private includeInlineButton!: HTMLButtonElement;
	private includeFileButton!: HTMLButtonElement;
	private includeCancelledButton!: HTMLButtonElement;
	private includeFinishedButton!: HTMLButtonElement;
	private toolbarEl: HTMLElement | null = null;
	private toolsEl: HTMLElement | null = null;
	private selectedProjectEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private emptyEl!: HTMLElement;
	private footerEl!: HTMLElement;
	private query = '';
	private projectMode: ProjectSearchMode | null = null;
	private selectedProject: IndexedTask | null = null;
	private showOverdueTasks = false;
	private showHappensTodayTasks = false;
	private showRecentModifiedTasks = false;
	private includeInlineTasks = true;
	private includeFileTasks = true;
	private includeCancelledTasks = false;
	private includeFinishedTasks = false;
	private activeIndex = 0;
	private currentResults: TaskFinderResult[] = [];
	private resolved = false;
	private chipOverflowFrame: number | null = null;
	private toolbarOverflowFrame: number | null = null;
	private readonly outsidePointerHandler = (event: PointerEvent) => {
		if (this.modalEl.contains(event.target as Node)) return;
		this.close();
	};
	private readonly resizeHandler = () => {
		this.scheduleChipOverflowLayout();
		this.updateMobileViewportHeight();
		this.scheduleToolbarOverflowState();
	};
	private readonly visualViewportHandler = () => {
		this.updateMobileViewportHeight();
		this.scheduleToolbarOverflowState();
	};
	private readonly toolbarScrollHandler = () => this.scheduleToolbarOverflowState();

	constructor(
		app: App,
		private readonly indexer: OperonIndexer,
		private readonly getSettings: () => OperonSettings,
		private readonly onOpenTask: (operonId: string, task: IndexedTask) => void | Promise<void>,
		private readonly options: TaskFinderModalOptions = {},
	) {
		super(app);
	}

	onOpen(): void {
		this.containerEl.addClass('operon-task-finder-modal-container');
		this.modalEl.addClass('operon-task-finder-modal');
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-task-finder-modal-container-mobile');
			this.modalEl.addClass('operon-task-finder-modal-mobile');
		}
		this.contentEl.empty();
		this.contentEl.addClass('operon-task-finder');
		this.containerEl.addEventListener('pointerdown', this.outsidePointerHandler);
		window.addEventListener('resize', this.resizeHandler);
		this.registerMobileViewportListeners();
		this.updateMobileViewportHeight();
		this.applyInitialScope();

		const searchWrap = this.contentEl.createDiv('operon-task-finder-search-wrap');
		const searchIcon = searchWrap.createSpan('operon-task-finder-search-icon');
		setIcon(searchIcon, 'scan-search');
		this.inputEl = searchWrap.createEl('textarea', {
			cls: 'operon-task-finder-search',
			attr: {
				placeholder: t('modals', 'taskFinderSearchOpenPlaceholder'),
				rows: '1',
				spellcheck: 'false',
			},
		});
		setAccessibleLabelWithoutTooltip(this.inputEl, t('modals', 'taskFinderSearchAria'));
		this.inputEl.addEventListener('input', () => this.handleInput());
		this.inputEl.addEventListener('keydown', event => this.handleKeydown(event));

		const toolbar = this.contentEl.createDiv('operon-task-finder-toolbar');
		this.toolbarEl = toolbar;
		const tools = toolbar.createDiv('operon-task-finder-tools');
		this.toolsEl = tools;
		tools.addEventListener('scroll', this.toolbarScrollHandler, { passive: true });
		const projectGroup = tools.createDiv('operon-task-finder-tool-group');
		const projectFilterGroup = tools.createDiv('operon-task-finder-tool-group');
		const formatGroup = tools.createDiv('operon-task-finder-tool-group');
		const stateGroup = tools.createDiv('operon-task-finder-tool-group');
		this.createModeButton(projectGroup, 'pc', 'list-tree', t('modals', 'taskFinderProjectTasks'));
		this.createModeButton(projectGroup, 'pt', 'network', t('modals', 'taskFinderProjectTree'));
		this.overdueButton = projectFilterGroup.createEl('button', {
			cls: 'operon-task-finder-tool',
			attr: {
				type: 'button',
			},
		});
		this.overdueButton.addEventListener('pointerdown', event => event.preventDefault());
		this.overdueButton.addEventListener('click', () => {
			this.toggleOverdueTasks();
		});
		const overdueIcon = this.overdueButton.createSpan('operon-task-finder-tool-icon');
		setIcon(overdueIcon, 'calendar-search');
		setAccessibleLabelWithoutTooltip(this.overdueButton, t('modals', 'taskFinderOverdue'));
		this.happensTodayButton = projectFilterGroup.createEl('button', {
			cls: 'operon-task-finder-tool',
			attr: {
				type: 'button',
			},
		});
		this.happensTodayButton.addEventListener('pointerdown', event => event.preventDefault());
		this.happensTodayButton.addEventListener('click', () => {
			this.toggleHappensTodayTasks();
		});
		const happensTodayIcon = this.happensTodayButton.createSpan('operon-task-finder-tool-icon');
		setIcon(happensTodayIcon, 'zap');
		setAccessibleLabelWithoutTooltip(this.happensTodayButton, t('modals', 'taskFinderHappensToday'));
		this.recentModifiedButton = projectFilterGroup.createEl('button', {
			cls: 'operon-task-finder-tool',
			attr: {
				type: 'button',
			},
		});
		this.recentModifiedButton.addEventListener('pointerdown', event => event.preventDefault());
		this.recentModifiedButton.addEventListener('click', () => {
			this.toggleRecentModifiedTasks();
		});
		const recentModifiedIcon = this.recentModifiedButton.createSpan('operon-task-finder-tool-icon');
		setIcon(recentModifiedIcon, 'monitor-cog');
		setAccessibleLabelWithoutTooltip(this.recentModifiedButton, t('modals', 'taskFinderRecentModified'));
		this.includeInlineButton = formatGroup.createEl('button', {
			cls: 'operon-task-finder-tool operon-task-finder-format-button',
			attr: {
				type: 'button',
			},
		});
		this.includeInlineButton.addEventListener('pointerdown', event => event.preventDefault());
		this.includeInlineButton.addEventListener('click', () => {
			this.toggleFormatScope('inline');
		});
		const includeInlineIcon = this.includeInlineButton.createSpan('operon-task-finder-tool-icon');
		setIcon(includeInlineIcon, 'list-todo');
		setAccessibleLabelWithoutTooltip(this.includeInlineButton, t('modals', 'taskFinderIncludeInline'));
		this.includeFileButton = formatGroup.createEl('button', {
			cls: 'operon-task-finder-tool operon-task-finder-format-button',
			attr: {
				type: 'button',
			},
		});
		this.includeFileButton.addEventListener('pointerdown', event => event.preventDefault());
		this.includeFileButton.addEventListener('click', () => {
			this.toggleFormatScope('file');
		});
		const includeFileIcon = this.includeFileButton.createSpan('operon-task-finder-tool-icon');
		setIcon(includeFileIcon, 'scroll-text');
		setAccessibleLabelWithoutTooltip(this.includeFileButton, t('modals', 'taskFinderIncludeFile'));
		this.includeCancelledButton = stateGroup.createEl('button', {
			cls: 'operon-task-finder-tool',
			attr: {
				type: 'button',
			},
		});
		this.includeCancelledButton.addEventListener('pointerdown', event => event.preventDefault());
		this.includeCancelledButton.addEventListener('click', () => {
			this.toggleIncludeCancelledTasks();
		});
		const includeCancelledIcon = this.includeCancelledButton.createSpan('operon-task-finder-tool-icon');
		setIcon(includeCancelledIcon, 'square-x');
		setAccessibleLabelWithoutTooltip(this.includeCancelledButton, t('modals', 'taskFinderIncludeCancelled'));
		this.includeFinishedButton = stateGroup.createEl('button', {
			cls: 'operon-task-finder-tool',
			attr: {
				type: 'button',
			},
		});
		this.includeFinishedButton.addEventListener('pointerdown', event => event.preventDefault());
		this.includeFinishedButton.addEventListener('click', () => {
			this.toggleIncludeFinishedTasks();
		});
		const includeFinishedIcon = this.includeFinishedButton.createSpan('operon-task-finder-tool-icon');
		setIcon(includeFinishedIcon, 'square-check-big');
		setAccessibleLabelWithoutTooltip(this.includeFinishedButton, t('modals', 'taskFinderIncludeFinished'));

		this.selectedProjectEl = this.contentEl.createDiv('operon-task-finder-selected-project');
		this.resultsEl = this.contentEl.createDiv('operon-task-finder-results');
		this.emptyEl = this.contentEl.createDiv('operon-task-finder-empty');
		this.footerEl = this.contentEl.createDiv('operon-task-finder-footer');

		this.render();
		this.focusInput();
	}

	onClose(): void {
		this.containerEl.removeEventListener('pointerdown', this.outsidePointerHandler);
		window.removeEventListener('resize', this.resizeHandler);
		this.unregisterMobileViewportListeners();
		this.toolsEl?.removeEventListener('scroll', this.toolbarScrollHandler);
		if (this.chipOverflowFrame !== null) {
			window.cancelAnimationFrame(this.chipOverflowFrame);
			this.chipOverflowFrame = null;
		}
		if (this.toolbarOverflowFrame !== null) {
			window.cancelAnimationFrame(this.toolbarOverflowFrame);
			this.toolbarOverflowFrame = null;
		}
		this.containerEl.style.removeProperty('--operon-task-finder-mobile-viewport-height');
		this.toolbarEl = null;
		this.toolsEl = null;
		this.contentEl.empty();
		this.persistDefaultScopeIfNeeded();
		if (!this.resolved) {
			this.options.onCancel?.();
		}
	}

	private createModeButton(container: HTMLElement, mode: ProjectSearchMode, iconName: string, label: string): void {
		const button = container.createEl('button', {
			cls: 'operon-task-finder-tool operon-task-finder-mode-button',
			attr: {
				type: 'button',
			},
		});
		const icon = button.createSpan('operon-task-finder-tool-icon');
		setIcon(icon, iconName);
		setAccessibleLabelWithoutTooltip(button, label);
		button.addEventListener('pointerdown', event => event.preventDefault());
		button.addEventListener('click', () => {
			this.toggleProjectMode(mode);
		});
		this.modeButtons.set(mode, button);
	}

	private handleInput(): void {
		const rawQuery = this.inputEl.value.replace(/\s*\n+\s*/g, ' ');
		if (rawQuery !== this.inputEl.value) {
			this.inputEl.value = rawQuery;
		}
		const shortcutHandled = this.applyShortcutCommand(rawQuery);
		if (shortcutHandled) return;
		if (rawQuery.trim()) {
			this.showOverdueTasks = false;
			this.showHappensTodayTasks = false;
			this.showRecentModifiedTasks = false;
		}
		this.query = rawQuery.trim();
		this.activeIndex = 0;
		this.render();
	}

	private applyShortcutCommand(rawQuery: string): boolean {
		const result = applyTaskSearchBoxShortcutCommand(rawQuery, this.getScopeState(), this.getSettings());
		if (!result.handled) return false;
		this.inputEl.value = result.query;
		this.query = this.inputEl.value.trim();
		const previousProjectMode = this.projectMode;
		this.applyScopeState(result.scope);
		if (previousProjectMode !== this.projectMode) {
			this.selectedProject = null;
		}
		this.activeIndex = 0;
		this.render();
		this.focusInput();
		return true;
	}

	private getScopeState(): TaskSearchBoxScopeState {
		return createTaskSearchBoxScopeState({
			projectMode: this.projectMode,
			showOverdue: this.showOverdueTasks,
			showHappensToday: this.showHappensTodayTasks,
			showRecentModified: this.showRecentModifiedTasks,
			includeInline: this.includeInlineTasks,
			includeFile: this.includeFileTasks,
			includeCancelled: this.includeCancelledTasks,
			includeFinished: this.includeFinishedTasks,
		});
	}

	private applyScopeState(scope: TaskSearchBoxScopeState): void {
		this.projectMode = scope.projectMode;
		this.showOverdueTasks = scope.showOverdue;
		this.showHappensTodayTasks = scope.showHappensToday;
		this.showRecentModifiedTasks = scope.showRecentModified;
		this.includeInlineTasks = scope.includeInline;
		this.includeFileTasks = scope.includeFile;
		this.includeCancelledTasks = scope.includeCancelled;
		this.includeFinishedTasks = scope.includeFinished;
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			const visibleCount = this.getVisibleResults().length;
			if (visibleCount === 0) return;
			event.preventDefault();
			this.updateActiveResult(Math.min(this.activeIndex + 1, visibleCount - 1));
			return;
		}
		if (event.key === 'ArrowUp') {
			if (this.getVisibleResults().length === 0) return;
			event.preventDefault();
			this.updateActiveResult(Math.max(this.activeIndex - 1, 0));
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const result = this.currentResults[this.activeIndex] ?? this.currentResults[0];
			if (!result) return;
			this.chooseResult(result);
		}
	}

	private render(): void {
		this.renderButtons();
		this.renderSelectedProject();
		this.currentResults = this.computeResults();
		const visibleCount = this.getVisibleResults().length;
		this.activeIndex = Math.min(Math.max(this.activeIndex, 0), Math.max(0, visibleCount - 1));
		this.renderResults();
		this.renderFooter();
		this.scheduleToolbarOverflowState();
	}

	private renderButtons(): void {
		for (const [mode, button] of this.modeButtons.entries()) {
			button.toggleClass('is-active', this.projectMode === mode);
			this.bindInactiveTooltip(
				button,
				this.projectMode !== mode,
				mode === 'pc' ? t('modals', 'taskFinderProjectTasksTooltip') : t('modals', 'taskFinderProjectTreeTooltip'),
			);
		}
		this.overdueButton?.toggleClass('is-active', this.showOverdueTasks);
		this.bindInactiveTooltip(
			this.overdueButton,
			!this.showOverdueTasks,
			t('modals', 'taskFinderOverdueTooltip'),
		);
		this.happensTodayButton?.toggleClass('is-active', this.showHappensTodayTasks);
		this.bindInactiveTooltip(
			this.happensTodayButton,
			!this.showHappensTodayTasks,
			t('modals', 'taskFinderHappensTodayTooltip'),
		);
		this.recentModifiedButton?.toggleClass('is-active', this.showRecentModifiedTasks);
		this.bindInactiveTooltip(
			this.recentModifiedButton,
			!this.showRecentModifiedTasks,
			t('modals', 'taskFinderRecentModifiedTooltip', {
				period: this.getRecentModifiedPeriodText(),
			}),
		);
		this.includeInlineButton?.toggleClass('is-active', this.includeInlineTasks);
		this.bindScopeTooltip(
			this.includeInlineButton,
			t('modals', this.includeInlineTasks ? 'taskFinderIncludeInlineTooltipActive' : 'taskFinderIncludeInlineTooltipInactive'),
		);
		this.includeFileButton?.toggleClass('is-active', this.includeFileTasks);
		this.bindScopeTooltip(
			this.includeFileButton,
			t('modals', this.includeFileTasks ? 'taskFinderIncludeFileTooltipActive' : 'taskFinderIncludeFileTooltipInactive'),
		);
		this.includeCancelledButton?.toggleClass('is-active', this.includeCancelledTasks);
		this.bindInactiveTooltip(
			this.includeCancelledButton,
			!this.includeCancelledTasks,
			t('modals', 'taskFinderIncludeCancelledTooltip'),
		);
		this.includeFinishedButton?.toggleClass('is-active', this.includeFinishedTasks);
		this.bindInactiveTooltip(
			this.includeFinishedButton,
			!this.includeFinishedTasks,
			t('modals', 'taskFinderIncludeFinishedTooltip'),
		);
		this.inputEl.placeholder = this.includeCancelledTasks || this.includeFinishedTasks
			? t('modals', 'taskFinderSearchScopedPlaceholder')
			: t('modals', 'taskFinderSearchOpenPlaceholder');
	}

	private bindScopeTooltip(button: HTMLElement | undefined, content: string): void {
		if (!button) return;
		bindOperonHoverTooltip(button, {
			content,
			taskColor: null,
			preferredHorizontal: 'center',
		});
	}

	private bindInactiveTooltip(button: HTMLElement | undefined, shouldShow: boolean, content: string): void {
		if (!button) return;
		bindOperonHoverTooltip(button, {
			content: shouldShow ? content : undefined,
			taskColor: null,
			preferredHorizontal: 'center',
		});
	}

	private renderSelectedProject(): void {
		this.selectedProjectEl.empty();
		this.selectedProjectEl.toggleClass('is-visible', !!this.selectedProject && !!this.projectMode);
		if (!this.selectedProject || !this.projectMode) return;

		const icon = this.selectedProjectEl.createSpan('operon-task-finder-selected-icon');
		this.renderTaskIcon(icon, this.selectedProject);
		this.applyTaskIconColor(icon, this.selectedProject);
		const body = this.selectedProjectEl.createDiv('operon-task-finder-selected-body');
		body.createDiv({
			cls: 'operon-task-finder-selected-title',
			text: this.selectedProject.description || this.selectedProject.operonId,
		});
		this.renderTaskChipLine(body, this.selectedProject);
		const clearButton = this.selectedProjectEl.createEl('button', {
			cls: 'operon-task-finder-selected-clear',
			attr: { type: 'button' },
		});
		setIcon(clearButton, 'x');
		setAccessibleLabelWithoutTooltip(clearButton, t('modals', 'taskFinderClearSelectedProject'));
		clearButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.selectedProject = null;
			this.activeIndex = 0;
			this.render();
			this.focusInput();
		});
	}

	private computeResults(): TaskFinderResult[] {
		const allTasks = this.indexer.getAllTasks();
		const projectScopeTasks = this.getProjectScopeTasks(allTasks);
		const scopedTasks = this.getVisibleScopeTasks(projectScopeTasks);
		const query = this.query.trim();
		const queryMeetsThreshold = query.length >= TASK_FINDER_MIN_QUERY_LENGTH;

		if (this.showRecentModifiedTasks && !query && !this.projectMode) {
			return this.computeRecentModifiedResults(scopedTasks);
		}

		if (this.showHappensTodayTasks && !query && !this.projectMode) {
			return this.computeHappensTodayResults(scopedTasks);
		}

		if (this.showOverdueTasks && !query && !this.projectMode) {
			return this.computeOverdueResults(scopedTasks);
		}

		if (this.projectMode && !this.selectedProject) {
			if (query && !queryMeetsThreshold) return [];
			return buildProjectSearchCandidates(projectScopeTasks, query ? query.toLocaleLowerCase() : '', this.getProjectResolvers(), {
				match: 'taskSearch',
				sort: 'taskFinderRank',
				visibleTaskIds: new Set(scopedTasks.map(task => task.operonId)),
				visibilityMode: this.projectMode,
				candidateFilter: task => this.matchesCurrentFormatScope(task),
			})
				.map(candidate => ({ kind: 'project', candidate }));
		}

		if (this.projectMode && this.selectedProject) {
			const visibleIds = resolveProjectSearchVisibleTaskIds(
				this.selectedProject.operonId,
				this.projectMode,
				projectScopeTasks,
				this.getProjectResolvers(),
			);
			if (query && !queryMeetsThreshold) return [];
			const visibleTasks = scopedTasks.filter(task => visibleIds.has(task.operonId));
			if (this.showHappensTodayTasks && !query) {
				return this.computeHappensTodayResults(visibleTasks);
			}
			return rankTaskSearchResults({
				tasks: visibleTasks,
				query,
				includeAllTasks: true,
			}).map(result => ({ kind: 'task', task: result.task, score: result.score }));
		}

		if (!queryMeetsThreshold) return [];
		return rankTaskSearchResults({
			tasks: scopedTasks,
			query,
			includeAllTasks: true,
		}).map(result => ({ kind: 'task', task: result.task, score: result.score }));
	}

	private renderResults(): void {
		this.resultsEl.empty();
		const query = this.query.trim();
		const queryMeetsThreshold = query.length >= TASK_FINDER_MIN_QUERY_LENGTH;
		const shouldShowResults = this.showOverdueTasks
			|| this.showHappensTodayTasks
			|| this.showRecentModifiedTasks
			|| queryMeetsThreshold
			|| !!this.projectMode
			|| !!this.selectedProject;
		this.resultsEl.toggleClass('is-visible', shouldShowResults);
		this.emptyEl.empty();
		this.emptyEl.toggleClass('is-visible', shouldShowResults && this.currentResults.length === 0);
		if (shouldShowResults && this.currentResults.length === 0) {
			this.emptyEl.setText(this.showOverdueTasks
				? t('modals', 'taskFinderNoOverdueTasks')
				: this.showHappensTodayTasks
				? t('modals', 'taskFinderNoHappensTodayTasks')
				: this.showRecentModifiedTasks
				? t('modals', 'taskFinderNoRecentModifiedTasks', {
					period: this.getRecentModifiedPeriodText(),
				})
				: this.projectMode && !this.selectedProject
				? t('modals', 'taskFinderNoParentTasks')
				: t('modals', 'taskFinderNoMatchingTasks'));
		}

		const visibleResults = this.getVisibleResults();
		for (const [index, result] of visibleResults.entries()) {
			const row = result.kind === 'project'
				? this.renderProjectResult(result.candidate)
				: this.renderTaskResult(result.task);
			row.toggleClass('is-active', index === this.activeIndex);
			row.addEventListener('mousemove', () => {
				if (this.activeIndex === index) return;
				this.updateActiveResult(index, { scroll: false });
			});
			row.addEventListener('click', event => {
				event.preventDefault();
				this.chooseResult(result);
			});
			this.resultsEl.appendChild(row);
		}

		this.applyVisibleResultViewport();
		const active = this.resultsEl.children[this.activeIndex] as HTMLElement | undefined;
		active?.scrollIntoView({ block: 'nearest' });
		this.scheduleChipOverflowLayout();
	}

	private applyVisibleResultViewport(): void {
		const rows = Array.from(this.resultsEl.children)
			.map(child => asHTMLElement(child))
			.filter((child): child is HTMLElement => child !== null && child.classList.contains('operon-task-finder-result'));
		const visibleResultCount = Math.max(3, Math.min(9, Math.round(this.getSettings().taskFinderVisibleResultCount || 5)));
		if (rows.length <= visibleResultCount) {
			this.resultsEl.style.removeProperty('max-height');
			return;
		}

		const measuredRows = rows.slice(0, visibleResultCount);
		const rowHeight = measuredRows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
		const computedStyle = window.getComputedStyle(this.resultsEl);
		const gap = Number.parseFloat(computedStyle.rowGap || computedStyle.gap || '0') || 0;
		const measuredHeight = Math.ceil(rowHeight + gap * Math.max(0, measuredRows.length - 1));
		const viewportLimit = Platform.isPhone
			? this.selectedProject && this.projectMode
				? 'max(80px, calc(var(--operon-task-finder-mobile-viewport-height, 100dvh) - 260px))'
				: 'max(96px, calc(var(--operon-task-finder-mobile-viewport-height, 100dvh) - 188px))'
			: 'calc(80dvh - 210px)';
		this.resultsEl.style.maxHeight = `min(${measuredHeight}px, ${viewportLimit})`;
	}

	private registerMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.addEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.addEventListener('scroll', this.visualViewportHandler);
	}

	private unregisterMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.removeEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.removeEventListener('scroll', this.visualViewportHandler);
	}

	private updateMobileViewportHeight(): void {
		if (!Platform.isPhone) return;
		const height = window.visualViewport?.height ?? window.innerHeight;
		if (!Number.isFinite(height) || height <= 0) return;
		this.containerEl.style.setProperty('--operon-task-finder-mobile-viewport-height', `${Math.round(height)}px`);
	}

	private scheduleToolbarOverflowState(): void {
		if (!Platform.isPhone || !this.toolbarEl || !this.toolsEl) return;
		if (this.toolbarOverflowFrame !== null) {
			window.cancelAnimationFrame(this.toolbarOverflowFrame);
		}
		this.toolbarOverflowFrame = window.requestAnimationFrame(() => {
			this.toolbarOverflowFrame = null;
			this.updateToolbarOverflowState();
		});
	}

	private updateToolbarOverflowState(): void {
		if (!this.toolbarEl || !this.toolsEl) return;
		const maxScrollLeft = Math.max(0, this.toolsEl.scrollWidth - this.toolsEl.clientWidth);
		const scrollLeft = this.toolsEl.scrollLeft;
		const hasLeftOverflow = scrollLeft > 1;
		const hasRightOverflow = scrollLeft < maxScrollLeft - 1;
		this.toolbarEl.toggleClass('is-scrollable-left', hasLeftOverflow);
		this.toolbarEl.toggleClass('is-scrollable-right', hasRightOverflow);
	}

	private toggleFormatScope(format: 'inline' | 'file'): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), format === 'inline' ? 'includeInline' : 'includeFile'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleProjectMode(mode: ProjectSearchMode): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), mode === 'pc' ? 'projectTasks' : 'projectTree'));
		this.selectedProject = null;
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleOverdueTasks(): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), 'overdue'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleHappensTodayTasks(): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), 'happensToday'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleRecentModifiedTasks(): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), 'recentModified'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleIncludeCancelledTasks(): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), 'includeCancelled'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private toggleIncludeFinishedTasks(): void {
		this.applyScopeState(toggleTaskSearchBoxScope(this.getScopeState(), 'includeFinished'));
		this.activeIndex = 0;
		this.render();
		this.focusInput();
	}

	private getVisibleResults(): TaskFinderResult[] {
		return this.currentResults.slice(0, TASK_FINDER_RENDER_LIMIT);
	}

	private updateActiveResult(nextIndex: number, options: { scroll?: boolean } = {}): void {
		const visibleCount = this.getVisibleResults().length;
		if (visibleCount === 0) {
			this.activeIndex = 0;
			return;
		}
		const clampedIndex = Math.max(0, Math.min(nextIndex, visibleCount - 1));
		if (clampedIndex === this.activeIndex) return;
		const previousIndex = this.activeIndex;
		this.activeIndex = clampedIndex;
		const previousRow = this.resultsEl.children[previousIndex] as HTMLElement | undefined;
		const nextRow = this.resultsEl.children[clampedIndex] as HTMLElement | undefined;
		previousRow?.removeClass('is-active');
		nextRow?.addClass('is-active');
		if (options.scroll !== false) {
			nextRow?.scrollIntoView({ block: 'nearest' });
		}
	}

	private scheduleChipOverflowLayout(): void {
		if (this.chipOverflowFrame !== null) {
			window.cancelAnimationFrame(this.chipOverflowFrame);
		}
		this.chipOverflowFrame = window.requestAnimationFrame(() => {
			this.chipOverflowFrame = null;
			this.layoutChipOverflow();
		});
	}

	private layoutChipOverflow(): void {
		for (const row of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-task-finder-chip-row'))) {
			this.layoutChipRowOverflow(row);
		}
	}

	private layoutChipRowOverflow(row: HTMLElement): void {
		const chips = Array.from(row.children)
			.map(child => asHTMLElement(child))
			.filter((child): child is HTMLElement =>
				child !== null
				&& child.classList.contains('operon-task-finder-chip')
				&& !child.classList.contains('operon-task-finder-overflow-chip'),
			);
		if (chips.length === 0) return;

		const overflowChip = this.ensureChipOverflowElement(row);
		for (const chip of chips) {
			chip.removeClass('is-overflow-hidden');
		}
		overflowChip.removeClass('is-visible');
		overflowChip.setText('+0');

		const available = row.clientWidth;
		if (available <= 0) return;

		const gap = Number.parseFloat(window.getComputedStyle(row).columnGap || window.getComputedStyle(row).gap || '0') || 0;
		const chipWidths = chips.map(chip => chip.getBoundingClientRect().width);
		const allWidth = chipWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, chips.length - 1);
		if (allWidth <= available) return;

		for (let hiddenCount = 1; hiddenCount <= chips.length; hiddenCount += 1) {
			const visibleCount = chips.length - hiddenCount;
			overflowChip.setText(`+${hiddenCount}`);
			overflowChip.addClass('is-visible');
			const overflowWidth = overflowChip.getBoundingClientRect().width;
			const visibleWidth = chipWidths
				.slice(0, visibleCount)
				.reduce((sum, width) => sum + width, 0);
			const visibleItems = visibleCount + 1;
			const totalWidth = visibleWidth + overflowWidth + gap * Math.max(0, visibleItems - 1);
			if (totalWidth <= available || visibleCount === 0) {
				chips.forEach((chip, index) => chip.toggleClass('is-overflow-hidden', index >= visibleCount));
				return;
			}
		}
	}

	private ensureChipOverflowElement(row: HTMLElement): HTMLElement {
		const existing = row.querySelector<HTMLElement>('.operon-task-finder-overflow-chip');
		if (existing) return existing;
		const chip = row.createSpan();
		chip.className = [
			'operon-chip',
			'operon-live-preview-chip',
			'operon-inline-compact-chip',
			'operon-task-finder-chip',
			'operon-task-finder-overflow-chip',
		].join(' ');
		chip.setText('+0');
		row.appendChild(chip);
		return chip;
	}

	private renderFooter(): void {
		const query = this.query.trim();
		const queryMeetsThreshold = query.length >= TASK_FINDER_MIN_QUERY_LENGTH;
		const shouldShowResults = this.showOverdueTasks
			|| this.showHappensTodayTasks
			|| this.showRecentModifiedTasks
			|| queryMeetsThreshold
			|| !!this.projectMode
			|| !!this.selectedProject;
		this.footerEl.toggleClass('is-visible', shouldShowResults);
		if (!shouldShowResults) {
			this.footerEl.empty();
			return;
		}
		const count = this.currentResults.length;
		const shown = this.getVisibleResults().length;
		if (this.showOverdueTasks) {
			if (count > shown) {
				this.footerEl.setText(t('modals', 'taskFinderOverdueCountShown', {
					shown: String(shown),
					total: String(count),
				}));
				return;
			}
			this.footerEl.setText(t('modals', count === 1 ? 'taskFinderOverdueCountOne' : 'taskFinderOverdueCountMany', {
				count: String(count),
			}));
			return;
		}
		if (this.showHappensTodayTasks) {
			if (count > shown) {
				this.footerEl.setText(t('modals', 'taskFinderHappensTodayCountShown', {
					shown: String(shown),
					total: String(count),
				}));
				return;
			}
			this.footerEl.setText(t('modals', count === 1 ? 'taskFinderHappensTodayCountOne' : 'taskFinderHappensTodayCountMany', {
				count: String(count),
			}));
			return;
		}
		if (this.showRecentModifiedTasks) {
			if (count > shown) {
				this.footerEl.setText(t('modals', 'taskFinderRecentModifiedCountShown', {
					shown: String(shown),
					total: String(count),
					period: this.getRecentModifiedPeriodText(),
				}));
				return;
			}
			this.footerEl.setText(t('modals', count === 1 ? 'taskFinderRecentModifiedCountOne' : 'taskFinderRecentModifiedCountMany', {
				count: String(count),
				period: this.getRecentModifiedPeriodText(),
			}));
			return;
		}
		if (count > shown) {
			this.footerEl.setText(t('modals', 'taskFinderResultCountShown', {
				shown: String(shown),
				total: String(count),
			}));
			return;
		}
		this.footerEl.setText(t('modals', count === 1 ? 'taskFinderResultCountOne' : 'taskFinderResultCountMany', {
			count: String(count),
		}));
	}

	private computeRecentModifiedResults(scopedTasks: IndexedTask[]): TaskFinderResult[] {
		const cutoff = Date.now() - this.getRecentModifiedDays() * 24 * 60 * 60 * 1000;
		return scopedTasks
			.map(task => ({ task, modifiedTime: getTaskModifiedTime(task) }))
			.filter(entry => entry.modifiedTime >= cutoff)
			.sort((left, right) => {
				const modifiedDiff = right.modifiedTime - left.modifiedTime;
				if (modifiedDiff !== 0) return modifiedDiff;
				return left.task.description.localeCompare(right.task.description, undefined, { sensitivity: 'base' })
					|| left.task.operonId.localeCompare(right.task.operonId, undefined, { sensitivity: 'base' });
			})
			.map(entry => ({ kind: 'task', task: entry.task, score: entry.modifiedTime }));
	}

	private computeOverdueResults(scopedTasks: IndexedTask[]): TaskFinderResult[] {
		const priorityRank = new Map(
			this.getSettings().priorities.map((priority, index) => [priority.label.trim().toLocaleLowerCase(), index] as const),
		);
		return scopedTasks
			.map(task => ({
				task,
				overdueDate: getTaskOverdueDate(task),
				priorityRank: getTaskFinderPriorityRank(task, priorityRank),
				modifiedTime: getTaskModifiedTime(task),
			}))
			.filter((entry): entry is { task: IndexedTask; overdueDate: string; priorityRank: number; modifiedTime: number } => !!entry.overdueDate)
			.sort((left, right) => {
				const overdueDiff = left.overdueDate.localeCompare(right.overdueDate);
				if (overdueDiff !== 0) return overdueDiff;
				const taskPriorityDiff = left.priorityRank - right.priorityRank;
				if (taskPriorityDiff !== 0) return taskPriorityDiff;
				const modifiedDiff = right.modifiedTime - left.modifiedTime;
				if (modifiedDiff !== 0) return modifiedDiff;
				return left.task.description.localeCompare(right.task.description, undefined, { sensitivity: 'base' })
					|| left.task.operonId.localeCompare(right.task.operonId, undefined, { sensitivity: 'base' });
			})
			.map(entry => ({ kind: 'task', task: entry.task, score: entry.modifiedTime }));
	}

	private computeHappensTodayResults(scopedTasks: IndexedTask[]): TaskFinderResult[] {
		const priorityRank = new Map(
			this.getSettings().priorities.map((priority, index) => [priority.label.trim().toLocaleLowerCase(), index] as const),
		);
		return scopedTasks
			.map(task => ({
				task,
				todayPriority: getTaskHappensTodayPriority(task),
				priorityRank: getTaskFinderPriorityRank(task, priorityRank),
				modifiedTime: getTaskModifiedTime(task),
			}))
			.filter((entry): entry is { task: IndexedTask; todayPriority: number; priorityRank: number; modifiedTime: number } => entry.todayPriority > 0)
			.sort((left, right) => {
				const priorityDiff = left.todayPriority - right.todayPriority;
				if (priorityDiff !== 0) return priorityDiff;
				const taskPriorityDiff = left.priorityRank - right.priorityRank;
				if (taskPriorityDiff !== 0) return taskPriorityDiff;
				const modifiedDiff = right.modifiedTime - left.modifiedTime;
				if (modifiedDiff !== 0) return modifiedDiff;
				return left.task.description.localeCompare(right.task.description, undefined, { sensitivity: 'base' })
					|| left.task.operonId.localeCompare(right.task.operonId, undefined, { sensitivity: 'base' });
			})
			.map(entry => ({ kind: 'task', task: entry.task, score: entry.modifiedTime }));
	}

	private renderProjectResult(candidate: ProjectSearchCandidate): HTMLElement {
		const row = createOwnerElement(this.contentEl, 'button');
		row.type = 'button';
		row.className = 'operon-task-finder-result operon-task-finder-project-result';
		const iconWrap = row.createSpan('operon-task-finder-result-icon');
		this.renderTaskIcon(iconWrap, candidate.task);
		this.applyTaskIconColor(iconWrap, candidate.task);
		const body = row.createDiv('operon-task-finder-result-body');
		body.createDiv({
			cls: 'operon-task-finder-result-title',
			text: candidate.task.description || candidate.task.operonId,
		});
		this.renderTaskChipLine(body, candidate.task);
		return row;
	}

	private renderTaskResult(task: IndexedTask): HTMLElement {
		const row = createOwnerElement(this.contentEl, 'button');
		row.type = 'button';
		row.className = 'operon-task-finder-result';

		const iconWrap = row.createSpan('operon-task-finder-result-icon');
		this.renderTaskIcon(iconWrap, task);
		this.applyTaskIconColor(iconWrap, task);

		const body = row.createDiv('operon-task-finder-result-body');
		body.createDiv({
			cls: 'operon-task-finder-result-title',
			text: task.description || task.operonId,
		});
		this.renderTaskChipLine(body, task);
		return row;
	}

	private renderTaskChipLine(body: HTMLElement, task: IndexedTask): void {
		const chips = body.createDiv('operon-task-finder-chip-row');
		this.renderTaskChips(chips, task);
		if (chips.childElementCount === 0) {
			chips.createSpan({ cls: 'operon-task-finder-result-id', text: task.operonId });
		}
	}

	private renderTaskIcon(container: HTMLElement, task: IndexedTask): void {
		const iconName = resolveTaskDisplayIcon(this.getSettings(), task.fieldValues, task.checkbox);
		const icon = getIcon(iconName);
		if (icon) {
			container.appendChild(icon);
			return;
		}
		setIcon(container, iconName);
	}

	private renderTaskChips(container: HTMLElement, task: IndexedTask): void {
		const settings = this.getSettings();
		const locationResolver = shouldResolveLocationCompactChips(settings, settings.taskFinderCompactChips)
			? getLocationPlaceIndex(this.app, settings).resolve
			: undefined;
		let entries = buildInlineTaskCompactChipEntries(
			task.fieldValues,
			task.tags,
			settings,
			this.indexer.getAllTasks(),
			settings.taskFinderCompactChips,
			locationResolver,
		);
		if (this.showOverdueTasks) {
			entries = this.prioritizeOverdueDateEntries(entries, task, settings);
		} else if (this.showHappensTodayTasks) {
			entries = this.prioritizeTodayDateEntries(entries, task, settings);
		}
		for (const entry of entries) {
			const visualEntry: InlineTaskCompactChipEntry = {
				...entry,
				iconOnly: false,
				interactive: false,
				linkTarget: null,
				externalUrl: null,
				externalRawValue: null,
				locationCoordinate: null,
			};
			const chip = createInlineTaskCompactChipElement(visualEntry, 'operon-task-finder-chip', { forceFull: true });
			this.applyChipVisualStyles(chip, visualEntry, task);
			if (visualEntry.tooltipContent) {
				bindOperonHoverTooltip(chip, {
					title: visualEntry.tooltipTitle ?? t('taskEditor', 'details'),
					content: visualEntry.tooltipContent,
					taskColor: null,
				});
			}
			container.appendChild(chip);
		}
	}

	private applyChipVisualStyles(chip: HTMLElement, entry: InlineTaskCompactChipEntry, task: IndexedTask): void {
		const settings = this.getSettings();
		if (entry.colorRole === 'priority') {
			const def = settings.priorities.find(priority => priority.label === task.fieldValues['priority']);
			if (def?.color) chip.style.setProperty('--operon-live-chip-color', def.color);
		}
		if (entry.colorRole === 'status') {
			const statusColor = this.getTaskStatusColor(task);
			if (statusColor) chip.style.setProperty('--operon-live-chip-color', statusColor);
		}
		if (entry.key === 'location') {
			const locationIconColor = entry.locationMarkerColor ?? normalizeTaskFinderTaskColor(task.fieldValues['taskColor']);
			if (locationIconColor) chip.style.setProperty('--operon-inline-chip-icon-color', locationIconColor);
		}
		if (entry.iconTone === 'today') {
			chip.setCssProps({ '--operon-inline-chip-icon-color': '#2563eb' });
		} else if (entry.iconTone === 'overdue') {
			chip.setCssProps({ '--operon-inline-chip-icon-color': '#dc2626' });
		}
	}

	private prioritizeOverdueDateEntries(
		entries: InlineTaskCompactChipEntry[],
		task: IndexedTask,
		settings: OperonSettings,
	): InlineTaskCompactChipEntry[] {
		const forcedDateEntries = this.buildForcedOverdueDateEntries(task, settings);
		const nonDateEntries = entries.filter(entry => entry.key !== 'dateScheduled' && entry.key !== 'dateDue');
		const existingDateEntries = entries.filter(entry => entry.key === 'dateScheduled' || entry.key === 'dateDue');
		const mergedDateEntries = mergePreferredDateEntries(existingDateEntries, forcedDateEntries, ['dateScheduled', 'dateDue']);
		return [...mergedDateEntries, ...nonDateEntries];
	}

	private buildForcedOverdueDateEntries(task: IndexedTask, settings: OperonSettings): InlineTaskCompactChipEntry[] {
		const entries: InlineTaskCompactChipEntry[] = [];
		for (const key of ['dateScheduled', 'dateDue'] as const) {
			const value = (task.fieldValues[key] ?? '').trim();
			if (!value) continue;
			entries.push({
				key,
				label: value,
				icon: getConfiguredKeyMappingIcon(key, settings.keyMappings) || INLINE_TASK_COMPACT_FALLBACK_ICONS[key],
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				iconTone: getTaskFinderDateIconTone(key, value),
				linkTarget: null,
			});
		}
		return entries;
	}

	private prioritizeTodayDateEntries(
		entries: InlineTaskCompactChipEntry[],
		task: IndexedTask,
		settings: OperonSettings,
	): InlineTaskCompactChipEntry[] {
		const forcedDateEntries = this.buildForcedTodayDateEntries(task, settings);
		const nonDateEntries = entries.filter(entry => entry.key !== 'dateDue' && entry.key !== 'dateScheduled' && entry.key !== 'dateStarted');
		const existingDateEntries = entries.filter(entry => entry.key === 'dateDue' || entry.key === 'dateScheduled' || entry.key === 'dateStarted');
		const mergedDateEntries = mergePreferredDateEntries(existingDateEntries, forcedDateEntries, ['dateDue', 'dateScheduled', 'dateStarted']);
		return [...mergedDateEntries, ...nonDateEntries];
	}

	private buildForcedTodayDateEntries(task: IndexedTask, settings: OperonSettings): InlineTaskCompactChipEntry[] {
		const entries: InlineTaskCompactChipEntry[] = [];
		for (const key of ['dateDue', 'dateScheduled', 'dateStarted'] as const) {
			const value = (task.fieldValues[key] ?? '').trim();
			if (!value || !isTodayDateKey(value)) continue;
			entries.push({
				key,
				label: value,
				icon: getConfiguredKeyMappingIcon(key, settings.keyMappings) || INLINE_TASK_COMPACT_FALLBACK_ICONS[key],
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				iconTone: 'today',
				linkTarget: null,
			});
		}
		return entries;
	}

	private chooseResult(result: TaskFinderResult): void {
		if (result.kind === 'project') {
			this.selectedProject = result.candidate.task;
			this.query = '';
			this.inputEl.value = '';
			this.activeIndex = 0;
			this.render();
			this.focusInput();
			return;
		}
		this.resolved = true;
		this.close();
		void this.onOpenTask(result.task.operonId, result.task);
	}

	private applyInitialScope(): void {
		const initial = this.options.initialScope;
		const settings = this.getSettings();
		const useSettingsDefaults = !initial && settings.taskFinderRememberLastScopes;
		const defaultScope = useSettingsDefaults ? settings.taskFinderDefaultScope : [];
		const defaultProjectMode = defaultScope.find(item => item.key === 'projectTasks')?.visible
			? 'pc'
			: defaultScope.find(item => item.key === 'projectTree')?.visible
			? 'pt'
			: null;
		this.projectMode = initial?.projectMode ?? (useSettingsDefaults ? defaultProjectMode : null);
		this.showRecentModifiedTasks = initial?.showRecentModified
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'recentModified')?.visible : false);
		this.showHappensTodayTasks = initial?.showHappensToday
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'happensToday')?.visible : false);
		this.showOverdueTasks = initial?.showOverdue
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'overdue')?.visible : false);
		this.includeInlineTasks = initial?.includeInline
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'includeInline')?.visible : true);
		this.includeFileTasks = initial?.includeFile
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'includeFile')?.visible : true);
		if (!this.includeInlineTasks && !this.includeFileTasks) {
			this.includeInlineTasks = true;
			this.includeFileTasks = true;
		}
		this.includeCancelledTasks = initial?.includeCancelled
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'includeCancelled')?.visible : false);
		this.includeFinishedTasks = initial?.includeFinished
			?? (useSettingsDefaults ? !!defaultScope.find(item => item.key === 'includeFinished')?.visible : false);
		if (this.showOverdueTasks || this.showHappensTodayTasks) {
			this.includeCancelledTasks = false;
			this.includeFinishedTasks = false;
		}
		if (this.showOverdueTasks && this.showHappensTodayTasks) {
			this.showHappensTodayTasks = false;
		}
		if (useSettingsDefaults) {
			this.restoreSelectedProject(settings.taskFinderSelectedProjectId);
		}
	}

	private restoreSelectedProject(selectedProjectId: string): void {
		const taskId = selectedProjectId.trim();
		if (!taskId || !this.projectMode) return;
		const task = this.indexer.getTask(taskId);
		if (!task || !this.canRestoreSelectedProject(task)) return;
		this.selectedProject = task;
	}

	private canRestoreSelectedProject(task: IndexedTask): boolean {
		if (!this.projectMode) return false;
		const allTasks = this.indexer.getAllTasks();
		const projectScopeTasks = this.getProjectScopeTasks(allTasks);
		const scopedTasks = this.getVisibleScopeTasks(projectScopeTasks);
		return buildProjectSearchCandidates(projectScopeTasks, '', this.getProjectResolvers(), {
			match: 'taskSearch',
			sort: 'taskFinderRank',
			visibleTaskIds: new Set(scopedTasks.map(scopedTask => scopedTask.operonId)),
			visibilityMode: this.projectMode,
			candidateFilter: candidateTask => this.matchesCurrentFormatScope(candidateTask),
		}).some(candidate => candidate.task.operonId === task.operonId);
	}

	private persistDefaultScopeIfNeeded(): void {
		if (!this.options.onPersistDefaultScope) return;
		const settings = this.getSettings();
		if (!settings.taskFinderRememberLastScopes) return;
		const current = this.getCurrentDefaultScopeState();
		const selectedProjectId = this.getCurrentSelectedProjectId();
		const savedSelectedProjectId = settings.taskFinderSelectedProjectId.trim();
		if (this.areDefaultScopesEqual(settings.taskFinderDefaultScope, current) && savedSelectedProjectId === selectedProjectId) return;
		void this.options.onPersistDefaultScope(current, selectedProjectId);
	}

	private getCurrentSelectedProjectId(): string {
		return this.projectMode && this.selectedProject ? this.selectedProject.operonId : '';
	}

	private getCurrentDefaultScopeState(): TaskFinderDefaultScopeItem[] {
		return [
			{ key: 'projectTasks', visible: this.projectMode === 'pc' },
			{ key: 'projectTree', visible: this.projectMode === 'pt' },
			{ key: 'overdue', visible: this.showOverdueTasks },
			{ key: 'happensToday', visible: this.showHappensTodayTasks },
			{ key: 'recentModified', visible: this.showRecentModifiedTasks },
			{ key: 'includeInline', visible: this.includeInlineTasks },
			{ key: 'includeFile', visible: this.includeFileTasks },
			{ key: 'includeCancelled', visible: this.includeCancelledTasks },
			{ key: 'includeFinished', visible: this.includeFinishedTasks },
		];
	}

	private areDefaultScopesEqual(
		left: TaskFinderDefaultScopeItem[],
		right: TaskFinderDefaultScopeItem[],
	): boolean {
		if (left.length !== right.length) return false;
		return left.every((item, index) =>
			item.key === right[index]?.key && item.visible === right[index]?.visible,
		);
	}

	private getProjectScopeTasks(allTasks: IndexedTask[]): IndexedTask[] {
		return allTasks.filter(task => {
			if (this.showOverdueTasks && !getTaskOverdueDate(task)) return false;
			if (this.showHappensTodayTasks && !getTaskHappensTodayPriority(task)) return false;
			if (this.showRecentModifiedTasks && !this.isTaskRecentlyModified(task)) return false;
			if (task.checkbox === 'open') return true;
			if (this.includeFinishedTasks && task.checkbox === 'done') return true;
			if (this.includeCancelledTasks && task.checkbox === 'cancelled') return true;
			return false;
		});
	}

	private getVisibleScopeTasks(projectScopeTasks: IndexedTask[]): IndexedTask[] {
		return projectScopeTasks.filter(task => this.matchesCurrentFormatScope(task));
	}

	private matchesCurrentFormatScope(task: IndexedTask): boolean {
		if (task.primary.format === 'inline' && !this.includeInlineTasks) return false;
		if (task.primary.format === 'yaml' && !this.includeFileTasks) return false;
		return true;
	}

	private getProjectResolvers() {
		return {
			getChildIds: (parentId: string) => this.indexer.secondary.getChildIds(parentId),
			getAllDescendantIds: (parentId: string) => this.indexer.secondary.getAllDescendantIds(parentId),
		};
	}

	private applyTaskIconColor(container: HTMLElement, task: IndexedTask): void {
		const statusColor = this.getTaskStatusColor(task);
		if (statusColor) container.style.color = statusColor;
	}

	private getTaskStatusColor(task: IndexedTask): string | null {
		const workflow = resolveWorkflowStatus(this.getSettings().pipelines, task.fieldValues['status']);
		return normalizeColor(workflow?.definition.color);
	}

	private getRecentModifiedDays(): number {
		const days = this.getSettings().taskFinderRecentModifiedDays;
		return Math.max(1, Math.min(7, Math.round(days || 3)));
	}

	private getRecentModifiedCutoff(): number {
		return Date.now() - this.getRecentModifiedDays() * 24 * 60 * 60 * 1000;
	}

	private isTaskRecentlyModified(task: IndexedTask): boolean {
		return getTaskModifiedTime(task) >= this.getRecentModifiedCutoff();
	}

	private getRecentModifiedPeriodText(): string {
		const days = this.getRecentModifiedDays();
		if (days === 1) {
			return t('modals', 'taskFinderRecentModifiedPeriodOne');
		}
		return t('modals', 'taskFinderRecentModifiedPeriodMany', { days: String(days) });
	}

	private focusInput(): void {
		window.requestAnimationFrame(() => this.inputEl.focus());
	}
}

function normalizeTaskFinderTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim().replace(/^#/, '');
	return /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : null;
}

function normalizeColor(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function isTodayDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && value === localToday();
}

function getTaskFinderDateIconTone(
	key: 'dateScheduled' | 'dateDue',
	value: string,
): InlineTaskCompactChipEntry['iconTone'] {
	const today = localToday();
	if (value < today) return 'overdue';
	if (value === today && key === 'dateDue') return 'today';
	return 'default';
}

function mergePreferredDateEntries(
	existing: InlineTaskCompactChipEntry[],
	forced: InlineTaskCompactChipEntry[],
	order: InlineTaskCompactChipKey[],
): InlineTaskCompactChipEntry[] {
	const merged = new Map<InlineTaskCompactChipKey, InlineTaskCompactChipEntry>();
	for (const entry of forced) {
		merged.set(entry.key, entry);
	}
	for (const entry of existing) {
		merged.set(entry.key, {
			...entry,
			iconOnly: false,
			interactive: false,
			linkTarget: null,
		});
	}
	const ordered: InlineTaskCompactChipEntry[] = [];
	for (const key of order) {
		const entry = merged.get(key);
		if (entry) ordered.push(entry);
	}
	return ordered;
}
