/**
 * Operon settings tab.
 * Provides UI for all plugin settings in Obsidian Settings panel.
 *
 * Spec Section 5.4.1 — Key Mapping Settings (UI):
 * - Full key mapping table with editable visiblePropertyName
 * - Type badge per key
 * - Custom key creation and deletion
 * - Validation (no duplicate visiblePropertyNames)
 *
 * Also covers: Timing, Index, Display, Pipelines sections.
 */

import { AbstractInputSuggest, App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, ToggleComponent, getIcon, setIcon } from 'obsidian';
import type { DropdownComponent, TextComponent } from 'obsidian';
import { OperonSettings, DEFAULT_SETTINGS, DEFAULT_INLINE_TASK_TARGET_FILE, DEFAULT_INLINE_TASK_HEADING_KEYWORD, DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD, KeyMapping, FilterSet, CALENDAR_TIME_GRID_SCALE_OPTIONS, CALENDAR_AUTO_SCROLL_POSITION_OPTIONS, CALENDAR_SIDEBAR_WIDTH_MIN, CALENDAR_SIDEBAR_WIDTH_MAX, KANBAN_EXPANDED_COLUMN_WIDTH_MIN, KANBAN_EXPANDED_COLUMN_WIDTH_MAX, KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN, KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX, createExternalCalendarSourceId, ExternalCalendarSource, TaskCreatorToolbarFieldKey, TaskCreatorToolbarItem, TASK_CREATOR_FALLBACK_FIELD_ICONS, InlineTaskCompactChipKey, INLINE_TASK_COMPACT_FALLBACK_ICONS, TrackerTaskDescriptionClickAction, TASK_FINDER_DEFAULT_SCOPE_ORDER, TaskFinderDefaultScopeKey, normalizeTaskFinderShortcutValue, FLOW_TIME_PAUSE_MINUTE_OPTIONS, FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS, cloneFilterSet, getNumericConstraint, isNumericSettingKey, normalizeCalendarSidebarDefaultExpansionState, normalizeInlineTaskHeadingKeyword, normalizeInlineTaskParentFileHeadingKeyword, setNumericSetting, type CalendarSidebarDefaultStateKey } from '../types/settings';
import { clonePipeline, composeStatusValue, createPipelineId, createStatusId, Pipeline } from '../types/pipeline';
import { PriorityDefinition, DEFAULT_PRIORITIES, clonePriorityDefinition, createPriorityId } from '../types/priority';
import { CalendarPreset, createCalendarPresetId } from '../types/calendar';
import { APPEARANCE_SCHEME_LIGHT_OPTIONS, APPEARANCE_SCHEME_DARK_OPTIONS, addAppearanceSchemeOptions } from './appearance-schemes';
import {
	CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS,
	CONFIGURABLE_CONTEXTUAL_MENU_SURFACE_GROUPS,
	CONTEXTUAL_MENU_SURFACE_LABEL_KEYS,
	isContextualMenuActionSupportedOnSurface,
	type ContextualMenuActionId,
	type ContextualMenuSurface,
} from '../core/contextual-menu-engine';
import {
	KANBAN_SORT_FIELD_OPTIONS,
	KanbanPreset,
	KanbanSortDirection,
	KanbanSortEmptyPlacement,
	KanbanSortMode,
	KanbanSortRule,
	KanbanSwimlaneBy,
	createDefaultKanbanSortRules,
	createKanbanPresetId,
} from '../types/kanban';
import { OperonStorage } from '../storage/operon-storage';
import { PinnedCache } from '../storage/pinned-cache';
import { t } from '../core/i18n';
import { getAppLocale } from '../core/obsidian-app';
import { FilterSetModal, FilterModalEvalDeps } from './filter-set-modal';
import { ExternalCalendarSourceEditModal } from './external-calendar-source-edit-modal';
import { CalendarPresetQuickSettingsModal } from './calendar/calendar-preset-quick-settings-modal';
import { KanbanPresetQuickSettingsModal } from './kanban/kanban-preset-quick-settings-modal';
import { OperonIndexer } from '../indexer/indexer';
import { ConfirmActionModal } from './confirm-action-modal';
import { CalendarFilterPickerModal } from './calendar/calendar-filter-picker-modal';
import { showTimePicker } from './field-pickers/time-picker';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { createInlineTaskCompactChipElement } from './compact-task-layout';
import {
	CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT,
	CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT,
} from '../systems/calendar-sidebar-task-pool';
import {
	buildPipelineRenamePlan,
	collectPipelineRenamePreview,
	PipelineRenameExecutionResult,
	PipelineRenamePreview,
} from '../core/pipeline-rename-migration';
import {
	applyPriorityRenamePlanToDefaultPriority,
	buildPriorityRenamePlan,
	collectPriorityRenamePreview,
	PriorityRenameExecutionResult,
	PriorityRenamePreview,
} from '../core/priority-rename-migration';
import {
	buildPipelineNameDraft,
	buildPipelineStatusLabelDraft,
	createUniqueTaxonomyLabel,
	hasDuplicatePriorityLabel,
	hasDuplicateStatusLabel,
	resolveDefaultPriorityAfterDelete,
} from '../core/settings-taxonomy-rules';
import {
	getTopLevelMarkdownFilesInFolder,
} from '../core/file-task-templates';
import { showIconPicker } from './field-pickers/icon-picker';
import { getKeyMappingDescription } from './key-mapping-descriptions';
import { CANONICAL_KEY_ORDER } from '../types/keys';
import {
	type RepeatSeriesPropertyRemovalPickerOption,
} from './repeat-series-property-removal-picker-modal';
import {
	RepeatSeriesPropertyCleanupModal,
	type RepeatSeriesPropertyCleanupModalSavePayload,
} from './repeat-series-property-cleanup-modal';
import { buildRepeatSeriesContexts, deriveTemporalTemplateFromTask } from '../systems/recurrence-domain';
import { detectRepeatSeriesNamingConfig } from '../systems/recurring-file-naming';
import {
	CALENDAR_TASK_COLOR_SOURCES,
	KANBAN_TASK_COLOR_SOURCES,
	PINNED_DOCK_TASK_COLOR_SOURCES,
	addTaskColorSourceOptions,
	normalizeTaskColorSource,
} from '../core/task-color-source';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import {
	isExcludedFolderConflictWithFileTasksFolder,
	normalizeSettingsFolderPath,
	sanitizeExcludedFoldersForFileTasksFolder,
} from '../core/settings-folder-rules';
import { renderCompactChipSettingsSection } from './settings/compact-chip-settings-renderer';
import { runSettingsAsync, settingsAsyncHandler } from './settings/async-settings-action';
import { parsePresetNumber } from './settings/preset-control-helpers';
import { shouldRenderRepeatSeriesYamlRemovalRow } from './settings/repeat-yaml-removal-visibility';
import { renderSettingsTabFramework, type SettingsTabDefinition } from './settings/settings-tab-framework';
import {
	maybeCopyKanbanManualOrderForPresetDuplicate,
	removeKanbanManualOrderForPresetDelete,
} from '../systems/kanban-manual-order-runtime';
import { createSettingsCollapsibleCard } from './settings/collapsible-card';
import {
	createWorkflowActionButton,
	createWorkflowColorSwatch,
	createWorkflowGridHeader,
	createWorkflowInput,
	createWorkflowInlineAddRow,
} from './settings/workflow-editor-ui';
import {
	createInterfaceMatrixHeaderIcon,
	createInterfaceMatrixButton,
	renderInterfaceIconToggleSection,
} from './settings/interface-editor-ui';
import {
	createSettingsListCard,
	createSettingsListCardActionButton,
	createSettingsListCardChip,
} from './settings/settings-list-ui';
import { renderSettingsIconPickerRow } from './settings/settings-icon-picker-ui';
import {
	createSettingsCollapsibleSection,
	renderDropdownSetting,
	renderNumericTextSetting,
	renderSettingsHeading,
	renderSettingsInfoBox,
	renderTextSetting,
	renderToggleSetting,
	setSettingsControlHidden,
	type DropdownSettingOption,
} from './settings/settings-ui';

type RepeatSeriesYamlRemovalRowModel = {
	rowId: string;
	seriesId: string;
	title: string;
	path: string | null;
	rawValue: string;
	isMissing: boolean;
};

type RepeatSeriesYamlRemovalSeriesOption = RepeatSeriesPropertyRemovalPickerOption & {
	latestTask: import('../types/fields').IndexedTask;
};

type OperonSettingsPrimaryTabId = 'core' | 'tasks' | 'views' | 'interface';

type OperonSettingsSecondaryTabId =
	| 'coreGeneral'
	| 'corePipelines'
	| 'corePriority'
	| 'coreKeymapping'
	| 'tasksInlineTasks'
	| 'tasksFileTasks'
	| 'tasksRelationships'
	| 'tasksRecurrence'
	| 'tasksTracker'
	| 'viewsCalendar'
	| 'viewsKanban'
	| 'viewsFilters'
	| 'interfaceTaskChips'
	| 'interfacePinnedDock'
	| 'interfaceTaskFinder'
	| 'interfaceContextMenu'
	| 'interfaceStateIcons';

type OperonSettingsTabId = OperonSettingsPrimaryTabId | OperonSettingsSecondaryTabId;

type TaskChipsSettingsSubtabId =
	| 'taskCreator'
	| 'inlineTasks'
	| 'taskFinder'
	| 'filterTasks'
	| 'fileTaskOverlay';

type BooleanSettingKey = {
	[K in keyof OperonSettings]: OperonSettings[K] extends boolean ? K : never
}[keyof OperonSettings];

type TextSettingKey = {
	[K in keyof OperonSettings]: OperonSettings[K] extends string
		? string extends OperonSettings[K]
			? K
			: never
		: never
}[keyof OperonSettings];

type NumberSettingKey = {
	[K in keyof OperonSettings]: OperonSettings[K] extends number
		? number extends OperonSettings[K]
			? K
			: never
		: never
}[keyof OperonSettings];

function generateFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Folder suggest dropdown — shows matching vault folders as user types.
 * Uses Obsidian's AbstractInputSuggest for native dropdown behavior.
 */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private selectCallback: (folder: TFolder) => void;
	private textInputEl: HTMLInputElement;
	private filterFolder: (folder: TFolder) => boolean;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		selectCallback: (folder: TFolder) => void,
		options: { filter?: (folder: TFolder) => boolean } = {},
	) {
		super(app, inputEl);
		this.textInputEl = inputEl;
		this.selectCallback = selectCallback;
		this.filterFolder = options.filter ?? (() => true);
	}

	getSuggestions(query: string): TFolder[] {
		const lowerQuery = query.toLowerCase();
		const folders: TFolder[] = [];
		const allFiles = this.app.vault.getAllLoadedFiles();
		for (const f of allFiles) {
			if (f instanceof TFolder && f.path !== '/' && this.filterFolder(f)) {
				if (!lowerQuery || f.path.toLowerCase().includes(lowerQuery)) {
					folders.push(f);
				}
			}
		}
		folders.sort((a, b) => a.path.localeCompare(b.path));
		return folders.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.textInputEl.value = folder.path;
		this.textInputEl.trigger('input');
		this.selectCallback(folder);
		this.close();
	}
}

function applyOperonTooltip(target: HTMLElement, content: string): void {
	bindOperonHoverTooltip(target, {
		content,
		taskColor: null,
	});
}

function applyOperonTooltipToExtraButton(button: { extraSettingsEl?: HTMLElement }, content: string): void {
	if (!button.extraSettingsEl) return;
	setAccessibleLabelWithoutTooltip(button.extraSettingsEl, content);
	applyOperonTooltip(button.extraSettingsEl, content);
}

/**
 * File suggest dropdown — shows matching vault md files as user types.
 */
class FileSuggest extends AbstractInputSuggest<TFile> {
	private selectCallback: (file: TFile) => void;
	private textInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement, selectCallback: (file: TFile) => void) {
		super(app, inputEl);
		this.textInputEl = inputEl;
		this.selectCallback = selectCallback;
	}

	getSuggestions(query: string): TFile[] {
		const lowerQuery = query.toLowerCase();
		const files: TFile[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (!lowerQuery || f.path.toLowerCase().includes(lowerQuery) || f.basename.toLowerCase().includes(lowerQuery)) {
				files.push(f);
			}
		}
		files.sort((a, b) => a.path.localeCompare(b.path));
		return files.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.textInputEl.value = file.path;
		this.textInputEl.trigger('input');
		this.selectCallback(file);
		this.close();
	}
}

export class OperonSettingsTab extends PluginSettingTab {
	private settings: OperonSettings;
	private storage: OperonStorage;
	private onSettingsChanged: () => void;
	private onDockRefreshLayout: () => void;
	private hasPendingSettingsChange = false;
	private activeTab: OperonSettingsTabId = 'coreGeneral';
	private activeTaskChipsTab: TaskChipsSettingsSubtabId = 'taskCreator';
	private expandedPresetIds: Set<string> = new Set();
	private expandedCalendarPresetIds: Set<string> = new Set();
	private expandedSectionIds: Set<string> = new Set();
	private indexer: OperonIndexer | null = null;
	private openFilterInSidebar: (filterSetId: string) => Promise<void>;
	private pinnedCache: PinnedCache | null = null;
	private filterPreviewOpenEditor: (operonId: string) => void;
	private filterPreviewCycleStatus: (operonId: string) => void;
	private filterPreviewNavigateToTask: (task: import('../types/fields').IndexedTask) => void;
	private filterPreviewUpdateField: (operonId: string, key: string, value: string) => void;
	private filterPreviewOnContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	private filterPreviewIsTaskTracking?: (taskId: string) => boolean;
	private filterPreviewToggleTimer?: (taskId: string) => void | Promise<void>;
	private filterPreviewTrackingSignature?: () => string;
	private filterPreviewUpdateFields?: (operonId: string, payload: Record<string, string>) => void;
	private filterPreviewUpdateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	private filterPreviewUpdateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	private applyPipelineRenameMigration: (preview: PipelineRenamePreview) => Promise<PipelineRenameExecutionResult>;
	private applyPriorityRenameMigration: (preview: PriorityRenamePreview) => Promise<PriorityRenameExecutionResult>;
	private syncExternalCalendarSourceNow: (sourceId: string) => Promise<void>;
	private handleKanbanSortModeChange: (presetId: string, sortMode: KanbanSortMode) => Promise<void>;
	private copyKanbanManualOrder: (sourcePresetId: string, targetPresetId: string) => Promise<void>;
	private removeKanbanManualOrder: (presetId: string) => Promise<void>;
	private createBasicsWorkspace: () => Promise<void>;

	constructor(
		app: App,
		plugin: Plugin,
		settings: OperonSettings,
		storage: OperonStorage,
		onSettingsChanged: () => void,
		indexer?: OperonIndexer,
		openFilterInSidebar?: (filterSetId: string) => Promise<void>,
		onDockRefreshLayout?: () => void,
		pinnedCache?: PinnedCache,
		filterPreviewOpenEditor?: (operonId: string) => void,
		filterPreviewCycleStatus?: (operonId: string) => void,
		filterPreviewNavigateToTask?: (task: import('../types/fields').IndexedTask) => void,
		filterPreviewUpdateField?: (operonId: string, key: string, value: string) => void,
		filterPreviewOnContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>,
		filterPreviewIsTaskTracking?: (taskId: string) => boolean,
		filterPreviewToggleTimer?: (taskId: string) => void | Promise<void>,
		filterPreviewTrackingSignature?: () => string,
		filterPreviewUpdateFields?: (operonId: string, payload: Record<string, string>) => void,
		filterPreviewUpdateSubtasks?: (operonId: string, subtaskIds: string[]) => void,
		filterPreviewUpdateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void,
		applyPipelineRenameMigration?: (preview: PipelineRenamePreview) => Promise<PipelineRenameExecutionResult>,
		applyPriorityRenameMigration?: (preview: PriorityRenamePreview) => Promise<PriorityRenameExecutionResult>,
		syncExternalCalendarSourceNow?: (sourceId: string) => Promise<void>,
		handleKanbanSortModeChange?: (presetId: string, sortMode: KanbanSortMode) => Promise<void>,
		copyKanbanManualOrder?: (sourcePresetId: string, targetPresetId: string) => Promise<void>,
		removeKanbanManualOrder?: (presetId: string) => Promise<void>,
		createBasicsWorkspace?: () => Promise<void>,
	) {
		super(app, plugin);
		this.settings = settings;
		this.storage = storage;
		this.onSettingsChanged = onSettingsChanged;
		this.onDockRefreshLayout = onDockRefreshLayout ?? (() => { });
		this.indexer = indexer ?? null;
		this.openFilterInSidebar = openFilterInSidebar ?? (async () => { });
		this.pinnedCache = pinnedCache ?? null;
		this.filterPreviewOpenEditor = filterPreviewOpenEditor ?? (() => { });
		this.filterPreviewCycleStatus = filterPreviewCycleStatus ?? (() => { });
		this.filterPreviewNavigateToTask = filterPreviewNavigateToTask ?? (() => { });
		this.filterPreviewUpdateField = filterPreviewUpdateField ?? (() => { });
		this.filterPreviewOnContextualAction = filterPreviewOnContextualAction;
		this.filterPreviewIsTaskTracking = filterPreviewIsTaskTracking;
		this.filterPreviewToggleTimer = filterPreviewToggleTimer;
		this.filterPreviewTrackingSignature = filterPreviewTrackingSignature;
		this.filterPreviewUpdateFields = filterPreviewUpdateFields;
		this.filterPreviewUpdateSubtasks = filterPreviewUpdateSubtasks;
		this.filterPreviewUpdateDependencyField = filterPreviewUpdateDependencyField;
		this.applyPipelineRenameMigration = applyPipelineRenameMigration
			?? (async () => ({
				updatedFileTaskCount: 0,
				updatedInlineTaskCount: 0,
				failedFileTaskCount: 0,
				failedInlineTaskCount: 0,
				failedTaskIds: [],
				failedFiles: [],
				touchedFileCount: 0,
			}));
		this.applyPriorityRenameMigration = applyPriorityRenameMigration
			?? (async () => ({
				updatedFileTaskCount: 0,
				updatedInlineTaskCount: 0,
				failedFileTaskCount: 0,
				failedInlineTaskCount: 0,
				failedTaskIds: [],
				failedFiles: [],
				touchedFileCount: 0,
			}));
		this.syncExternalCalendarSourceNow = syncExternalCalendarSourceNow ?? (async () => { });
		this.handleKanbanSortModeChange = handleKanbanSortModeChange ?? (async () => { });
		this.copyKanbanManualOrder = copyKanbanManualOrder ?? (async () => { });
		this.removeKanbanManualOrder = removeKanbanManualOrder ?? (async () => { });
		this.createBasicsWorkspace = createBasicsWorkspace ?? (async () => { });
	}

	private makeEvalDeps(): FilterModalEvalDeps | null {
		if (!this.indexer) return null;
		const indexer = this.indexer;
		const settings = this.settings;
		return {
			indexer,
			getPipelines: () => settings.pipelines,
			getPriorities: () => settings.priorities ?? DEFAULT_PRIORITIES,
			openEditor: this.filterPreviewOpenEditor,
			cycleStatus: this.filterPreviewCycleStatus,
			getChildIds: (parentId: string) => [...indexer.secondary.getChildIds(parentId)],
			navigateToTask: this.filterPreviewNavigateToTask,
			getSettings: () => settings,
			updateField: this.filterPreviewUpdateField,
			updateFields: this.filterPreviewUpdateFields,
			updateSubtasks: this.filterPreviewUpdateSubtasks,
			updateDependencyField: this.filterPreviewUpdateDependencyField,
			onContextualAction: this.filterPreviewOnContextualAction,
			pinnedCache: this.pinnedCache ?? undefined,
			isTaskTracking: this.filterPreviewIsTaskTracking,
			toggleTimer: this.filterPreviewToggleTimer,
			getTrackingSignature: this.filterPreviewTrackingSignature,
		};
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		renderSettingsHeading(containerEl, t('settings', 'title'));

		renderSettingsTabFramework({
			containerEl,
			activeTabId: this.activeTab,
			primaryTabs: this.getPrimarySettingsTabs(),
			secondaryTabs: this.getSecondarySettingsTabs(),
			onActiveTabChange: tabId => {
				this.activeTab = tabId;
			},
			renderTab: (tabId, contentEl) => {
				this.renderSettingsTab(tabId, contentEl);
			},
		});
	}

	private getPrimarySettingsTabs(): SettingsTabDefinition<OperonSettingsTabId>[] {
		return [
			{ id: 'core', label: t('settings', 'tabCore'), defaultTabId: 'coreGeneral', icon: 'settings' },
			{ id: 'tasks', label: t('settings', 'tabTasks'), defaultTabId: 'tasksInlineTasks', icon: 'check-square' },
			{ id: 'views', label: t('settings', 'tabViews'), defaultTabId: 'viewsCalendar', icon: 'calendar' },
			{ id: 'interface', label: t('settings', 'tabInterface'), defaultTabId: 'interfaceTaskChips', icon: 'palette' },
		];
	}

	private getSecondarySettingsTabs(): SettingsTabDefinition<OperonSettingsTabId>[] {
		return [
			{ id: 'coreGeneral', groupId: 'core', label: t('settings', 'tabGeneral') },
			{ id: 'corePipelines', groupId: 'core', label: t('settings', 'tabPipelines') },
			{ id: 'corePriority', groupId: 'core', label: t('settings', 'tabPriority') },
			{ id: 'coreKeymapping', groupId: 'core', label: t('settings', 'tabKeyMappings') },
			{ id: 'tasksInlineTasks', groupId: 'tasks', label: t('settings', 'subtabInlineTasks') },
			{ id: 'tasksFileTasks', groupId: 'tasks', label: t('settings', 'subtabFileTasks') },
			{ id: 'tasksRelationships', groupId: 'tasks', label: t('settings', 'subtabRelationships') },
			{ id: 'tasksRecurrence', groupId: 'tasks', label: t('settings', 'subtabRecurrence') },
			{ id: 'tasksTracker', groupId: 'tasks', label: t('settings', 'tabTracker') },
			{ id: 'viewsCalendar', groupId: 'views', label: t('settings', 'tabCalendar') },
			{ id: 'viewsKanban', groupId: 'views', label: t('settings', 'tabKanban') },
			{ id: 'viewsFilters', groupId: 'views', label: t('filterSets', 'tabLabel') },
			{ id: 'interfaceTaskChips', groupId: 'interface', label: t('settings', 'subtabTaskChips') },
			{ id: 'interfacePinnedDock', groupId: 'interface', label: t('settings', 'subtabPinnedDock') },
			{ id: 'interfaceTaskFinder', groupId: 'interface', label: t('settings', 'subtabTaskFinder') },
			{ id: 'interfaceContextMenu', groupId: 'interface', label: t('settings', 'subtabContextMenu') },
			{ id: 'interfaceStateIcons', groupId: 'interface', label: t('settings', 'subtabStateIcons') },
		];
	}

	private renderSettingsTab(tabId: OperonSettingsTabId, contentEl: HTMLElement): void {
		if (tabId === 'core' || tabId === 'coreGeneral') {
			this.renderCoreGeneralTab(contentEl);
		} else if (tabId === 'corePipelines') {
			this.renderPipelinesTab(contentEl);
		} else if (tabId === 'corePriority') {
			this.renderPriorityTab(contentEl);
		} else if (tabId === 'coreKeymapping') {
			this.renderKeyMappingsSection(contentEl);
		} else if (tabId === 'tasks' || tabId === 'tasksInlineTasks') {
			this.renderTasksInlineTasksTab(contentEl);
		} else if (tabId === 'tasksFileTasks') {
			this.renderTasksFileTasksTab(contentEl);
		} else if (tabId === 'tasksRelationships') {
			this.renderTasksRelationshipsTab(contentEl);
		} else if (tabId === 'tasksRecurrence') {
			this.renderTasksRecurrenceTab(contentEl);
		} else if (tabId === 'tasksTracker') {
			this.renderTrackerTab(contentEl);
		} else if (tabId === 'views' || tabId === 'viewsCalendar') {
			this.renderCalendarTab(contentEl);
		} else if (tabId === 'viewsKanban') {
			this.renderKanbanTab(contentEl);
		} else if (tabId === 'viewsFilters') {
			this.renderFiltersTab(contentEl);
		} else if (tabId === 'interface' || tabId === 'interfaceTaskChips') {
			this.renderInterfaceTaskChipsTab(contentEl);
		} else if (tabId === 'interfacePinnedDock') {
			this.renderInterfacePinnedDockTab(contentEl);
		} else if (tabId === 'interfaceTaskFinder') {
			this.renderInterfaceTaskFinderTab(contentEl);
		} else if (tabId === 'interfaceContextMenu') {
			this.renderInterfaceContextMenuTab(contentEl);
		} else if (tabId === 'interfaceStateIcons') {
			this.renderInterfaceStateIconsTab(contentEl);
		}
	}

	hide(): void {
		if (this.hasPendingSettingsChange) {
			this.hasPendingSettingsChange = false;
			this.onSettingsChanged();
		}
		super.hide();
	}

	private renderCoreGeneralTab(containerEl: HTMLElement): void {
		this.renderGeneralBasicsTab(containerEl);
		this.renderGeneralSystemTab(containerEl);
	}

	private renderGeneralBasicsTab(containerEl: HTMLElement): void {
		this.renderBoundDropdownSetting(containerEl, t('settings', 'language'), t('settings', 'languageDesc'), 'language', {
			value: this.settings.language,
			dropdownOptions: [
				{ value: 'auto', label: t('settings', 'languageAuto') },
				{ value: 'en', label: t('settings', 'languageEnglish') },
				{ value: 'tr', label: t('settings', 'languageTurkish') },
			],
			onAfterChange: () => {
				this.display();
			},
		});

		this.renderBoundDropdownSetting(containerEl, t('settings', 'timeFormat'), t('settings', 'timeFormatDesc'), 'timeFormat', {
			value: this.settings.timeFormat,
			dropdownOptions: [
				{ value: '24h', label: t('settings', 'timeFormat24h') },
				{ value: '12h', label: t('settings', 'timeFormat12h') },
			],
			onAfterChange: () => {
				this.display();
			},
		});

		new Setting(containerEl)
			.setName(t('settings', 'demoWorkspace'))
			.setDesc(t('settings', 'demoWorkspaceDesc'))
			.addButton(button => {
				button
					.setButtonText(t('settings', 'demoWorkspaceCreate'))
					.setCta()
					.onClick(settingsAsyncHandler('settings create demo workspace failed', async () => {
						await this.createBasicsWorkspace();
					}));
			});
	}

	private renderInterfaceContextMenuTab(containerEl: HTMLElement): void {
		this.renderContextualHoverMenuSettingsSection(containerEl);
	}

	private renderTasksRelationshipsTab(containerEl: HTMLElement): void {
		this.renderBoundToggleSetting(containerEl, t('settings', 'estimateAutoReallocation'), t('settings', 'estimateAutoReallocationDesc'), 'estimateAutoReallocation');
		this.renderBoundToggleSetting(containerEl, t('settings', 'autoParentInlineSubtasks'), t('settings', 'autoParentInlineSubtasksDesc'), 'autoParentFileTask');
		this.renderBoundToggleSetting(containerEl, t('settings', 'autoParentLinkedFileSubtasks'), t('settings', 'autoParentLinkedFileSubtasksDesc'), 'autoParentLinkedFileSubtasks');
	}

	private renderGeneralSystemTab(containerEl: HTMLElement): void {
		// --- Timing ---
		this.addNumericSetting(containerEl, t('settings', 'indexDebounce'), t('settings', 'indexDebounceDesc'), 'indexEventDebounceMs');

		this.renderBoundToggleSetting(containerEl, t('settings', 'fullReindexOnStartup'), t('settings', 'fullReindexOnStartupDesc'), 'fullReindexOnStartup');
	}

	private renderTasksFileTasksTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'fileTasksSection'));

		let removedExcludedFolderConflict = false;
		const pruneExcludedFolderConflicts = (): void => {
			const before = this.settings.excludedFolders ?? [];
			const after = sanitizeExcludedFoldersForFileTasksFolder(before, this.settings.fileTasksFolder);
			removedExcludedFolderConflict = after.length !== before.length
				|| after.some((folder, index) => folder !== before[index]);
			this.settings.excludedFolders = after;
		};
		const reindexAfterExcludedFolderPrune = async (): Promise<void> => {
			if (!removedExcludedFolderConflict || !this.indexer) return;
			removedExcludedFolderConflict = false;
			new Notice(t('settings', 'excludedFileTasksFolderRemoved'));
			await this.indexer.fullReindex();
			new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
		};

		this.renderBoundTextSetting(containerEl, t('settings', 'fileTasksFolder'), t('settings', 'fileTasksFolderDesc'), 'fileTasksFolder', {
			placeholder: t('settings', 'fileTasksFolderPlaceholder'),
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			normalize: normalizeSettingsFolderPath,
			onBeforeSave: () => {
				pruneExcludedFolderConflicts();
			},
			onAfterChange: () => reindexAfterExcludedFolderPrune(),
			configure: text => {
				new FolderSuggest(this.app, text.inputEl, settingsAsyncHandler('settings file tasks folder selection failed', async (folder) => {
					this.settings.fileTasksFolder = normalizeSettingsFolderPath(folder.path);
					pruneExcludedFolderConflicts();
					await this.saveSettings();
					await reindexAfterExcludedFolderPrune();
				}));
			},
		});

		renderSettingsHeading(containerEl, t('settings', 'parentAwareFileTaskPlacement'));

		this.renderBoundDropdownSetting(containerEl, t('settings', 'fileTaskInlineParentTargetMode'), t('settings', 'fileTaskInlineParentTargetModeDesc'), 'fileTaskParentInlineTargetMode', {
			value: this.settings.fileTaskParentInlineTargetMode,
			dropdownOptions: [
				{ value: 'same-folder', label: t('settings', 'fileTaskInlineParentTargetSameFolder') },
				{ value: 'default', label: t('settings', 'fileTaskParentTargetDefault') },
			],
		});

		this.renderBoundDropdownSetting(containerEl, t('settings', 'fileTaskFileParentTargetMode'), t('settings', 'fileTaskFileParentTargetModeDesc'), 'fileTaskParentFileTargetMode', {
			value: this.settings.fileTaskParentFileTargetMode,
			dropdownOptions: [
				{ value: 'same-folder', label: t('settings', 'fileTaskFileParentTargetSameFolder') },
				{ value: 'default', label: t('settings', 'fileTaskParentTargetDefault') },
			],
		});

		renderSettingsHeading(containerEl, t('settings', 'fileTaskTemplates'));
		this.renderFileTaskTemplateSettings(containerEl);
	}

	private renderTasksInlineTasksTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'inlineTasksSection'));

		this.renderBoundDropdownSetting(containerEl, t('settings', 'inlineTaskDefaultSavePath'), t('settings', 'inlineTaskDefaultSavePathDesc'), 'inlineTaskUseDailyNote', {
			value: this.settings.inlineTaskUseDailyNote ? 'daily-notes' : 'specific-file',
			dropdownOptions: [
				{ value: 'daily-notes', label: t('settings', 'inlineTaskSavePathDailyNotes') },
				{ value: 'specific-file', label: t('settings', 'inlineTaskSavePathSpecificFile') },
			],
			normalize: value => value === 'daily-notes',
			onAfterChange: () => {
				this.display();
			},
		});

		const targetFileSetting = this.renderBoundTextSetting(containerEl, t('settings', 'inlineTaskTargetFile'), t('settings', 'inlineTaskTargetFileDesc'), 'inlineTaskTargetFile', {
			placeholder: DEFAULT_INLINE_TASK_TARGET_FILE,
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			disabled: this.settings.inlineTaskUseDailyNote,
			configure: text => {
				new FileSuggest(this.app, text.inputEl, settingsAsyncHandler('settings inline target file selection failed', async (file) => {
					this.settings.inlineTaskTargetFile = file.path;
					await this.saveSettings();
				}));
			},
		});
		this.decorateActivationSetting(targetFileSetting, !this.settings.inlineTaskUseDailyNote);

		const inlineHeadingSetting = renderTextSetting({
			containerEl,
			name: t('settings', 'inlineTaskHeading'),
			desc: t('settings', 'inlineTaskHeadingDesc'),
			value: this.settings.inlineTaskHeading,
			placeholder: DEFAULT_INLINE_TASK_HEADING_KEYWORD,
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			disabled: !this.settings.inlineTaskUseDailyNote,
			configure: text => {
				text.inputEl.addEventListener('blur', settingsAsyncHandler('settings inline task heading keyword blur failed', async () => {
					const normalized = normalizeInlineTaskHeadingKeyword(text.inputEl.value);
					this.settings.inlineTaskHeading = normalized;
					if (text.inputEl.value !== normalized) text.setValue(normalized);
					await this.saveSettings();
				}));
			},
			onChange: async (value) => {
				this.settings.inlineTaskHeading = value;
				await this.saveSettings();
			},
		});
		this.decorateActivationSetting(inlineHeadingSetting, this.settings.inlineTaskUseDailyNote);

		renderSettingsHeading(containerEl, t('settings', 'parentAwareInlineSaveLocation'));

		this.renderBoundDropdownSetting(containerEl, t('settings', 'inlineParentTaskTargetMode'), t('settings', 'inlineParentTaskTargetModeDesc'), 'inlineTaskParentInlineTargetMode', {
			value: this.settings.inlineTaskParentInlineTargetMode,
			dropdownOptions: [
				{ value: 'below-parent', label: t('settings', 'inlineParentTaskTargetBelowParent') },
				{ value: 'default', label: t('settings', 'inlineParentTaskTargetDefault') },
			],
		});

		this.renderBoundDropdownSetting(containerEl, t('settings', 'fileParentTaskTargetMode'), t('settings', 'fileParentTaskTargetModeDesc'), 'inlineTaskParentFileTargetMode', {
			value: this.settings.inlineTaskParentFileTargetMode,
			dropdownOptions: [
				{ value: 'inside-parent-file', label: t('settings', 'fileParentTaskTargetInsideParentFile') },
				{ value: 'default', label: t('settings', 'fileParentTaskTargetDefault') },
			],
			onAfterChange: () => {
				this.display();
			},
		});

		const parentFileHeadingActive = this.settings.inlineTaskParentFileTargetMode === 'inside-parent-file';
		const parentFileHeadingSetting = renderTextSetting({
			containerEl,
			name: t('settings', 'parentFileHeadingKeyword'),
			desc: t('settings', 'parentFileHeadingKeywordDesc'),
			value: this.settings.inlineTaskParentFileHeadingKeyword,
			placeholder: DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD,
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			disabled: !parentFileHeadingActive,
			configure: text => {
				text.inputEl.addEventListener('blur', settingsAsyncHandler('settings parent file heading keyword blur failed', async () => {
					const normalized = normalizeInlineTaskParentFileHeadingKeyword(text.inputEl.value);
					this.settings.inlineTaskParentFileHeadingKeyword = normalized;
					if (text.inputEl.value !== normalized) text.setValue(normalized);
					await this.saveSettings();
				}));
			},
			onChange: async (value) => {
				this.settings.inlineTaskParentFileHeadingKeyword = value;
				await this.saveSettings();
			},
		});
		this.decorateActivationSetting(parentFileHeadingSetting, parentFileHeadingActive);

		renderSettingsHeading(containerEl, t('settings', 'checkboxConversion'));
		this.renderBoundToggleSetting(containerEl, t('settings', 'showTasksEmojiConvertIcon'), t('settings', 'showTasksEmojiConvertIconDesc'), 'inlineTaskShowTasksEmojiConvertIcon');
		this.renderBoundToggleSetting(containerEl, t('settings', 'showPlainCheckboxConvertIcon'), t('settings', 'showPlainCheckboxConvertIconDesc'), 'inlineTaskShowPlainCheckboxConvertIcon');
	}

	private renderInterfaceStateIconsTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'fallbackTaskStateIcons'));
		this.renderStateIconSetting(containerEl, 'open', t('settings', 'fallbackOpenStateIcon'), t('settings', 'fallbackOpenStateIconDesc'));
		this.renderStateIconSetting(containerEl, 'done', t('settings', 'fallbackFinishedStateIcon'), t('settings', 'fallbackFinishedStateIconDesc'));
		this.renderStateIconSetting(containerEl, 'cancelled', t('settings', 'fallbackCancelledStateIcon'), t('settings', 'fallbackCancelledStateIconDesc'));
	}

	private decorateActivationSetting(setting: Setting, active: boolean): void {
		setting.settingEl.addClass(active ? 'operon-settings-control-active' : 'operon-settings-control-inactive');
		setting.settingEl.setAttribute('aria-disabled', active ? 'false' : 'true');
	}

	private renderInterfacePinnedDockTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'pinnedDockSection'));
		const dockBody = containerEl;

		let autoCloseDelaySetting: Setting | null = null;
		this.renderBoundToggleSetting(dockBody, t('settings', 'pinnedDockAutoClose'), t('settings', 'pinnedDockAutoCloseDesc'), 'pinnedDockAutoCloseEnabled', {
			onBeforeSave: value => {
				if (!value) this.settings.pinnedDockCollapsed = false;
			},
			onAfterChange: value => {
				this.onDockRefreshLayout();
				setSettingsControlHidden(autoCloseDelaySetting, !value);
			},
		});

		autoCloseDelaySetting = this.renderBoundClampedNumericSetting(dockBody, t('settings', 'pinnedDockAutoCloseDelay'), t('settings', 'pinnedDockAutoCloseDelayDesc'), 'floatingAutoCloseSec', {
			min: 5,
			max: 600,
			fallback: this.settings.floatingAutoCloseSec,
		});
		setSettingsControlHidden(autoCloseDelaySetting, !this.settings.pinnedDockAutoCloseEnabled);

		this.renderBoundClampedNumericSetting(dockBody, t('settings', 'pinnedDockTaskCardWidth'), t('settings', 'pinnedDockTaskCardWidthDesc'), 'pinnedTaskItemWidth', {
			min: 120,
			max: 800,
			fallback: this.settings.pinnedTaskItemWidth,
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundDropdownSetting(dockBody, t('settings', 'pinnedDockTaskColorSource'), t('settings', 'pinnedDockTaskColorSourceDesc'), 'pinnedDockColorSource', {
			value: this.settings.pinnedDockColorSource,
			dropdownOptions: [],
			configure: drop => {
				addTaskColorSourceOptions(drop, PINNED_DOCK_TASK_COLOR_SOURCES);
			},
			normalize: value => normalizeTaskColorSource(value, PINNED_DOCK_TASK_COLOR_SOURCES, DEFAULT_SETTINGS.pinnedDockColorSource),
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundToggleSetting(dockBody, t('settings', 'pinnedDockDisableOnMobile'), t('settings', 'pinnedDockDisableOnMobileDesc'), 'pinnedDockDisableOnMobile', {
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		let gridColsSetting: Setting | null = null;
		this.renderBoundDropdownSetting(dockBody, t('settings', 'pinnedDockLayout'), t('settings', 'pinnedDockLayoutDesc'), 'pinnedDockLayout', {
			value: this.settings.pinnedDockLayout,
			dropdownOptions: [
				{ value: 'horizontal', label: t('settings', 'pinnedDockLayoutHorizontal') },
				{ value: 'vertical', label: t('settings', 'pinnedDockLayoutVertical') },
				{ value: 'grid', label: t('settings', 'pinnedDockLayoutGrid') },
			],
			onAfterChange: value => {
				this.onDockRefreshLayout();
				setSettingsControlHidden(gridColsSetting, value !== 'grid');
			},
		});

		gridColsSetting = this.renderBoundDropdownSetting(dockBody, t('settings', 'pinnedDockGridColumns'), t('settings', 'pinnedDockGridColumnsDesc'), 'pinnedDockGridCols', {
			value: String(this.settings.pinnedDockGridCols) as '2' | '3' | '4' | '5',
			dropdownOptions: [
				{ value: '2', label: '2' },
				{ value: '3', label: '3' },
				{ value: '4', label: '4' },
				{ value: '5', label: '5' },
			],
			normalize: value => Number(value) as 2 | 3 | 4 | 5,
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});
		setSettingsControlHidden(gridColsSetting, this.settings.pinnedDockLayout !== 'grid');

		this.renderBoundToggleSetting(dockBody, t('settings', 'pinnedDockAutoPinActiveTimerTask'), t('settings', 'pinnedDockAutoPinActiveTimerTaskDesc'), 'pinnedDockAutoPin');
		this.renderBoundToggleSetting(dockBody, t('settings', 'pinnedDockAutoUnpinFinishedTasks'), t('settings', 'pinnedDockAutoUnpinFinishedTasksDesc'), 'pinnedDockAutoUnpinFinished');
	}

	private renderTasksRecurrenceTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'repeatingTasks'));
		const repeatingBody = containerEl;
		this.renderBoundDropdownSetting(repeatingBody, t('settings', 'inlineRepeatPlacement'), t('settings', 'inlineRepeatPlacementDesc'), 'newOccurrencePosition', {
			value: this.settings.newOccurrencePosition,
			dropdownOptions: [
				{ value: 'below', label: t('settings', 'repeatPlacementBelow') },
				{ value: 'above', label: t('settings', 'repeatPlacementAbove') },
			],
		});

		let customRepeatFolderSetting: Setting | null = null;
		this.renderBoundDropdownSetting(repeatingBody, t('settings', 'fileRepeatDestination'), t('settings', 'fileRepeatDestinationDesc'), 'fileRepeatDestination', {
			value: this.settings.fileRepeatDestination,
			dropdownOptions: [
				{ value: 'same-folder', label: t('settings', 'fileRepeatDestinationSameFolder') },
				{ value: 'custom-folder', label: t('settings', 'fileRepeatDestinationCustomFolder') },
			],
			onAfterChange: value => {
				setSettingsControlHidden(customRepeatFolderSetting, value !== 'custom-folder');
			},
		});

		customRepeatFolderSetting = this.renderBoundTextSetting(repeatingBody, t('settings', 'fileRepeatCustomFolder'), t('settings', 'fileRepeatCustomFolderDesc'), 'fileRepeatCustomFolder', {
			placeholder: t('settings', 'fileRepeatCustomFolderPlaceholder'),
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			configure: text => {
				new FolderSuggest(this.app, text.inputEl, settingsAsyncHandler('settings repeat custom folder selection failed', async (folder) => {
					this.settings.fileRepeatCustomFolder = folder.path;
					await this.saveSettings();
				}));
			},
		});
		setSettingsControlHidden(customRepeatFolderSetting, this.settings.fileRepeatDestination !== 'custom-folder');
		this.renderRepeatSeriesYamlPropertyRemovalSection(repeatingBody);
	}

	private renderInterfaceTaskFinderTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'taskFinderSection'));
		this.renderTaskFinderBehaviorSettingsSection(containerEl);
	}

	private renderInterfaceTaskChipsTab(containerEl: HTMLElement): void {
		const tabs: Array<{ id: TaskChipsSettingsSubtabId; label: string }> = [
			{ id: 'taskCreator', label: t('settings', 'taskChipsSubtabTaskCreator') },
			{ id: 'inlineTasks', label: t('settings', 'taskChipsSubtabInlineTasks') },
			{ id: 'taskFinder', label: t('settings', 'taskChipsSubtabTaskFinder') },
			{ id: 'filterTasks', label: t('settings', 'taskChipsSubtabFilterTasks') },
			{ id: 'fileTaskOverlay', label: t('settings', 'taskChipsSubtabFileTaskOverlay') },
		];
		const validTabIds = new Set<TaskChipsSettingsSubtabId>(tabs.map(tab => tab.id));
		if (!validTabIds.has(this.activeTaskChipsTab)) {
			this.activeTaskChipsTab = 'taskCreator';
		}

		const navEl = containerEl.createDiv('operon-task-chips-subtab-nav');
		navEl.setAttribute('role', 'tablist');
		const contentEl = containerEl.createDiv('operon-task-chips-subtab-content');
		contentEl.setAttribute('role', 'tabpanel');
		contentEl.setAttribute('tabindex', '0');

		const buttons = new Map<TaskChipsSettingsSubtabId, HTMLButtonElement>();
		const renderContent = (): void => {
			contentEl.empty();
			switch (this.activeTaskChipsTab) {
				case 'taskCreator':
					renderSettingsHeading(contentEl, t('settings', 'taskCreatorToolbarSection'));
					this.renderTaskCreatorToolbarSettingsSection(contentEl);
					break;
				case 'inlineTasks':
					renderSettingsHeading(contentEl, t('settings', 'inlineTaskIconsSection'));
					this.renderInlineTaskCompactChipSettingsSection(contentEl);
					break;
				case 'taskFinder':
					renderSettingsHeading(contentEl, t('settings', 'taskFinderIconsSection'));
					this.renderTaskFinderCompactChipSettingsSection(contentEl);
					break;
				case 'filterTasks':
					this.renderFilterTaskCardsSection(contentEl);
					break;
				case 'fileTaskOverlay':
					renderSettingsHeading(contentEl, t('settings', 'overlayTaskIconsSection'));
					this.renderOverlayTaskCompactChipSettingsSection(contentEl);
					break;
			}
		};
		const syncNav = (): void => {
			for (const tab of tabs) {
				const button = buttons.get(tab.id);
				if (!button) continue;
				const isActive = tab.id === this.activeTaskChipsTab;
				button.toggleClass('is-active', isActive);
				button.setAttribute('aria-selected', String(isActive));
				button.tabIndex = isActive ? 0 : -1;
				if (isActive) {
					contentEl.setAttribute('aria-labelledby', button.id);
				}
			}
		};
		const activateTab = (tabId: TaskChipsSettingsSubtabId, focus = false): void => {
			this.activeTaskChipsTab = tabId;
			renderContent();
			syncNav();
			if (focus) buttons.get(tabId)?.focus();
		};

		tabs.forEach((tab, index) => {
			const button = navEl.createEl('button', {
				text: tab.label,
				cls: 'operon-task-chips-subtab-btn',
				attr: {
					type: 'button',
					role: 'tab',
					'aria-selected': 'false',
				},
			});
			button.id = `operon-task-chips-subtab-${tab.id}`;
			button.addEventListener('click', () => {
				activateTab(tab.id);
			});
			button.addEventListener('keydown', event => {
				if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
					event.preventDefault();
					activateTab(tabs[(index + 1) % tabs.length].id, true);
				} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
					event.preventDefault();
					activateTab(tabs[(index - 1 + tabs.length) % tabs.length].id, true);
				} else if (event.key === 'Home') {
					event.preventDefault();
					activateTab(tabs[0].id, true);
				} else if (event.key === 'End') {
					event.preventDefault();
					activateTab(tabs[tabs.length - 1].id, true);
				}
			});
			buttons.set(tab.id, button);
		});

		renderContent();
		syncNav();
	}

	private renderTaskFinderBehaviorSettingsSection(containerEl: HTMLElement): void {
		type TaskFinderVisibleResultCountOption = '3' | '4' | '5' | '6' | '7' | '8' | '9';
		this.renderBoundDropdownSetting(containerEl, t('settings', 'taskFinderRecentModifiedDays'), t('settings', 'taskFinderRecentModifiedDaysDesc'), 'taskFinderRecentModifiedDays', {
			value: String(this.settings.taskFinderRecentModifiedDays) as '1' | '2' | '3' | '4' | '5' | '6' | '7',
			dropdownOptions: [1, 2, 3, 4, 5, 6, 7].map(days => ({
				value: String(days) as '1' | '2' | '3' | '4' | '5' | '6' | '7',
				label: t('settings', days === 1 ? 'taskFinderRecentModifiedDaysOptionOne' : 'taskFinderRecentModifiedDaysOptionMany', {
					count: String(days),
				}),
			})),
			normalize: value => Math.max(1, Math.min(7, Number(value) || 3)),
			errorContext: 'settings task finder recent modified days change failed',
		});
		this.renderBoundDropdownSetting(containerEl, t('settings', 'taskFinderVisibleResultCount'), t('settings', 'taskFinderVisibleResultCountDesc'), 'taskFinderVisibleResultCount', {
			value: String(this.settings.taskFinderVisibleResultCount) as TaskFinderVisibleResultCountOption,
			dropdownOptions: [3, 4, 5, 6, 7, 8, 9].map(count => ({
				value: String(count) as TaskFinderVisibleResultCountOption,
				label: t('settings', 'taskFinderVisibleResultCountOption', {
					count: String(count),
				}),
			})),
			normalize: value => Math.max(3, Math.min(9, Number(value) || 5)),
			errorContext: 'settings task finder visible result count change failed',
		});
		this.renderBoundToggleSetting(containerEl, t('settings', 'taskFinderRememberLastScopes'), t('settings', 'taskFinderRememberLastScopesDesc'), 'taskFinderRememberLastScopes', {
			errorContext: 'settings task finder remember last scopes change failed',
			onBeforeSave: value => {
				if (value) return;
				this.settings.taskFinderDefaultScope = TASK_FINDER_DEFAULT_SCOPE_ORDER.map((key: TaskFinderDefaultScopeKey) => ({
					key,
					visible: key === 'includeInline' || key === 'includeFile',
				}));
				this.settings.taskFinderSelectedProjectId = '';
			},
		});
		this.renderTaskFinderShortcutSettings(containerEl);
	}

	private renderTaskFinderShortcutSettings(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'taskFinderHotkeysSection'));

		const description = containerEl.createEl('p', {
			text: t('settings', 'taskFinderShortcutsDesc'),
		});
		description.addClass('operon-settings-section-desc');

		const shortcutsEl = containerEl.createDiv('operon-task-finder-shortcut-settings');
		for (const key of TASK_FINDER_DEFAULT_SCOPE_ORDER) {
			this.renderTaskFinderShortcutSetting(shortcutsEl, key);
		}
	}

	private renderTaskFinderShortcutSetting(containerEl: HTMLElement, key: TaskFinderDefaultScopeKey): void {
		const label = this.getTaskFinderScopeLabel(key);
		const defaultShortcut = String(TASK_FINDER_DEFAULT_SCOPE_ORDER.indexOf(key) + 1);
		const currentShortcut = this.settings.taskFinderShortcuts.find(item => item.key === key)?.shortcut ?? '';
		let previewEl: HTMLElement | null = null;
		const formatPreview = (value: string): string => {
			const shortcut = value.trim();
			return shortcut ? `.${shortcut}` : t('settings', 'taskFinderShortcutNone');
		};
		const updatePreview = (value: string): void => {
			previewEl?.setText(t('settings', 'taskFinderShortcutPreview', {
				command: formatPreview(value),
			}));
		};

		const setting = new Setting(containerEl)
			.setName(label)
			.addText(text => {
				text.setPlaceholder(defaultShortcut);
				text.setValue(currentShortcut);
				text.inputEl.addClass('operon-settings-input-compact');
				text.inputEl.addClass('operon-task-finder-shortcut-input');
				setAccessibleLabelWithoutTooltip(text.inputEl, label);
				text.inputEl.setAttribute('autocomplete', 'off');
				text.inputEl.setAttribute('autocapitalize', 'off');
				text.inputEl.spellcheck = false;
				previewEl = text.inputEl.ownerDocument.createElement('span');
				previewEl.className = 'operon-task-finder-shortcut-preview';
				previewEl.setAttribute('aria-hidden', 'true');
				text.inputEl.insertAdjacentElement('beforebegin', previewEl);
				updatePreview(currentShortcut);
				text.inputEl.addEventListener('input', () => {
					updatePreview(text.inputEl.value);
				});

				text.onChange(settingsAsyncHandler('settings task finder shortcut change failed', async (value) => {
					const current = this.settings.taskFinderShortcuts.find(item => item.key === key)?.shortcut ?? '';
					const raw = value.trim();
					if (!raw) {
						this.updateTaskFinderShortcut(key, '');
						await this.saveSettings();
						updatePreview('');
						return;
					}
					const shortcut = normalizeTaskFinderShortcutValue(raw);
					if (!shortcut || shortcut !== raw.toLocaleLowerCase()) {
						text.setValue(current);
						updatePreview(current);
						new Notice(t('settings', 'taskFinderShortcutInvalid'));
						return;
					}
					const duplicate = this.settings.taskFinderShortcuts.find(item =>
						item.key !== key && item.shortcut.trim().toLocaleLowerCase() === shortcut,
					);
					if (duplicate) {
						text.setValue(current);
						updatePreview(current);
						new Notice(t('settings', 'taskFinderShortcutDuplicate', {
							shortcut,
							label: this.getTaskFinderScopeLabel(duplicate.key),
						}));
						return;
					}
					this.updateTaskFinderShortcut(key, shortcut);
					if (value !== shortcut) {
						text.setValue(shortcut);
					}
					updatePreview(shortcut);
					await this.saveSettings();
				}));
			});
		setting.settingEl.addClass('operon-task-finder-shortcut-setting');
	}

	private renderRepeatSeriesYamlPropertyRemovalSection(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv('operon-repeat-property-cleanup-section');
		renderSettingsHeading(sectionEl, t('settings', 'repeatYamlPropertyRemovalTitle'));
		sectionEl.createEl('p', {
			text: t('settings', 'repeatYamlPropertyRemovalDesc'),
			cls: 'operon-settings-muted-block',
		});
		const listEl = sectionEl.createDiv('operon-repeat-property-cleanup-list');
		const renderRows = (): void => {
			listEl.empty();
			const rowModels = this.getRepeatSeriesYamlRemovalRowModels();
			if (!rowModels.length) {
				listEl.createEl('p', {
					text: t('settings', 'repeatYamlPropertyRemovalEmpty'),
					cls: 'operon-settings-muted-block',
				});
				return;
			}

			for (const row of rowModels) {
				this.renderRepeatSeriesYamlPropertyRemovalCard(listEl, row, renderRows);
			}
		};

		const addBtn = sectionEl.createEl('button', { cls: 'operon-settings-primary-button operon-settings-spaced-top' });
		addBtn.setText(`+ ${t('settings', 'repeatYamlPropertyRemovalAdd')}`);
		addBtn.addEventListener('click', () => {
			this.openRepeatSeriesYamlPropertyRemovalModal(null, renderRows);
		});

		renderRows();
	}

	private renderRepeatSeriesYamlPropertyRemovalCard(
		listEl: HTMLElement,
		row: RepeatSeriesYamlRemovalRowModel,
		refresh: () => void,
	): void {
		const card = createSettingsListCard({
			containerEl: listEl,
			icon: 'file-cog',
			title: row.title,
			className: `operon-repeat-property-cleanup-card${row.isMissing ? ' is-missing' : ''}`,
		});

		if (row.isMissing) {
			const pathMetaEl = card.metaEl.createDiv('operon-repeat-property-cleanup-path-row');
			const pathValuesEl = this.createRepeatPropertyCleanupDetailRow(pathMetaEl, 'Path:');
			this.createRepeatPropertyCleanupValueChip({
				containerEl: pathValuesEl,
				icon: 'alert-triangle',
				label: t('settings', 'repeatYamlPropertyRemovalMissingSeries'),
				className: 'operon-repeat-property-cleanup-warning-chip',
			});
		} else if (row.path) {
			const pathMetaEl = card.metaEl.createDiv('operon-repeat-property-cleanup-path-row');
			const pathValuesEl = this.createRepeatPropertyCleanupDetailRow(pathMetaEl, 'Path:');
			this.createRepeatPropertyCleanupValueChip({
				containerEl: pathValuesEl,
				icon: 'file-text',
				label: row.path,
				className: 'operon-repeat-property-cleanup-path-chip',
			});
		}

		const properties = this.normalizeRepeatSeriesYamlRemovalInput(row.rawValue);
		if (properties.length > 0) {
			const propertiesMetaEl = card.metaEl.createDiv('operon-repeat-property-cleanup-property-row');
			const propertyValuesEl = this.createRepeatPropertyCleanupDetailRow(propertiesMetaEl, 'Properties:');
			for (const property of properties) {
				this.createRepeatPropertyCleanupValueChip({
					containerEl: propertyValuesEl,
					icon: 'table-properties',
					label: property,
					className: 'operon-repeat-property-cleanup-property-chip',
				});
			}
		}

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('buttons', 'edit'),
			text: t('buttons', 'edit'),
			tooltip: null,
			wide: true,
			errorContext: 'settings repeat YAML property removal edit failed',
			onClick: () => {
				this.openRepeatSeriesYamlPropertyRemovalModal(row, refresh);
			},
		});
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'repeatYamlPropertyRemovalRemove'),
			tooltip: null,
			icon: 'trash-2',
			danger: true,
			errorContext: 'settings repeat YAML property removal remove failed',
			onClick: async () => {
				const confirmed = await this.confirmDeleteRepeatYamlPropertyRemoval(row.title);
				if (!confirmed) return;
				await this.storage.repeatSeries.clearYamlPropertyValueRemovalRule(row.seriesId, new Date().toISOString());
				this.notifySettingsChanged();
				refresh();
			},
			});
		}

	private createRepeatPropertyCleanupDetailRow(containerEl: HTMLElement, label: string): HTMLElement {
		const rowEl = containerEl.createDiv('operon-repeat-property-cleanup-detail-row');
		rowEl.createSpan({
			text: label,
			cls: 'operon-repeat-property-cleanup-detail-label',
		});
		return rowEl.createDiv('operon-repeat-property-cleanup-detail-values');
	}

	private createRepeatPropertyCleanupValueChip(options: {
		containerEl: HTMLElement;
		icon: string;
		label: string;
		className: string;
	}): void {
		const chipEl = createInlineTaskCompactChipElement({
			key: 'tags',
			label: options.label,
			icon: options.icon,
			iconOnly: false,
			interactive: false,
			colorRole: 'default',
			linkTarget: null,
		}, `operon-editor-compact-selection-chip ${options.className}`, { forceFull: true, owner: options.containerEl });
		options.containerEl.appendChild(chipEl);
	}

	private openRepeatSeriesYamlPropertyRemovalModal(
		row: RepeatSeriesYamlRemovalRowModel | null,
		refresh: () => void,
	): void {
		const rows = this.getRepeatSeriesYamlRemovalRowModels();
		const options = this.getRepeatSeriesYamlRemovalSeriesOptions(row?.seriesId ?? null, rows);
		new RepeatSeriesPropertyCleanupModal({
			app: this.app,
			isNew: row === null,
			title: t('settings', row ? 'repeatYamlPropertyRemovalEditTitle' : 'repeatYamlPropertyRemovalCreateTitle'),
			seriesId: row?.seriesId ?? null,
			seriesTitle: row?.title ?? t('settings', 'repeatYamlPropertyRemovalChooseSeries'),
			seriesPath: row?.path ?? null,
			rawValue: row?.rawValue ?? '',
			seriesOptions: options.map(option => ({
				seriesId: option.seriesId,
				title: option.title,
				path: option.path,
			})),
			onSave: settingsAsyncHandler('settings repeat YAML property removal save failed', async (payload) => {
				await this.saveRepeatSeriesYamlPropertyRemoval(row, payload, options);
				refresh();
			}),
		}).open();
	}

	private getRepeatSeriesYamlRemovalRowModels(): RepeatSeriesYamlRemovalRowModel[] {
		const contexts = buildRepeatSeriesContexts(this.indexer?.getAllTasks() ?? []);
		const contextBySeriesId = new Map(contexts.map(context => [context.seriesId, context]));
		return this.storage.repeatSeries.getAllEntries()
			.filter(entry => {
				const context = contextBySeriesId.get(entry.seriesId);
				return shouldRenderRepeatSeriesYamlRemovalRow(entry, {
					currentFormat: context?.latestTask.primary.format ?? null,
				});
			})
			.map<RepeatSeriesYamlRemovalRowModel>(entry => {
				const context = contextBySeriesId.get(entry.seriesId);
				return {
					rowId: entry.seriesId,
					seriesId: entry.seriesId,
					title: context?.latestTask.description || entry.lastMaterializedTitle || entry.baseTitle || entry.seriesId,
					path: context?.latestTask.primary.filePath ?? null,
					rawValue: entry.yamlPropertyValueRemovals.join(', '),
					isMissing: !context,
				};
		});
	}

	private getRepeatSeriesYamlRemovalSeriesOptions(
		currentSeriesId: string | null,
		rows: RepeatSeriesYamlRemovalRowModel[],
	): RepeatSeriesYamlRemovalSeriesOption[] {
		const selectedSeriesIds = new Set(
			rows
				.map(row => row.seriesId)
				.filter((seriesId): seriesId is string => !!seriesId && seriesId !== currentSeriesId),
		);
		return buildRepeatSeriesContexts(this.indexer?.getAllTasks() ?? [])
			.filter(context => context.latestTask.primary.format === 'yaml')
			.filter(context => !selectedSeriesIds.has(context.seriesId))
			.map(context => ({
				seriesId: context.seriesId,
				title: context.latestTask.description,
				path: context.latestTask.primary.filePath,
				latestTask: context.latestTask,
			}))
			.sort((left, right) => left.title.localeCompare(right.title));
	}

	private normalizeRepeatSeriesYamlRemovalInput(rawValue: string): string[] {
		return [...new Set(
			rawValue
				.split(',')
				.map(part => part.trim())
				.filter(Boolean),
		)];
	}

	private async saveRepeatSeriesYamlPropertyRemoval(
		row: RepeatSeriesYamlRemovalRowModel | null,
		payload: RepeatSeriesPropertyCleanupModalSavePayload,
		options: RepeatSeriesYamlRemovalSeriesOption[],
	): Promise<void> {
		const selected = options.find(option => option.seriesId === payload.seriesId);
		if (selected) {
			await this.ensureRepeatSeriesEntryForSettings(selected.latestTask);
		} else if (!row || row.seriesId !== payload.seriesId) {
			new Notice(t('settings', 'repeatYamlPropertyRemovalNoSeries'));
			return;
		}

		if (row && row.seriesId !== payload.seriesId) {
			await this.storage.repeatSeries.clearYamlPropertyValueRemovalRule(row.seriesId, new Date().toISOString());
		}
		await this.storage.repeatSeries.updateYamlPropertyValueRemovals(
			payload.seriesId,
			this.normalizeRepeatSeriesYamlRemovalInput(payload.rawValue),
			new Date().toISOString(),
		);
		this.notifySettingsChanged();
	}

	private async ensureRepeatSeriesEntryForSettings(task: import('../types/fields').IndexedTask): Promise<void> {
		if (this.storage.repeatSeries.getEntry(task.fieldValues['repeatSeriesId'])) return;
		const basename = this.getSettingsTabFileBaseName(task.primary.filePath);
		await this.storage.repeatSeries.ensureSeries({
			seriesId: task.fieldValues['repeatSeriesId'],
			sourceTaskId: task.operonId,
			sourceFormat: task.primary.format,
			baseTitle: task.primary.format === 'yaml' ? this.deriveSettingsTabRepeatBaseTitle(task.primary.filePath) : null,
			lastMaterializedTitle: task.description,
			naming: task.primary.format === 'yaml' ? detectRepeatSeriesNamingConfig(basename) : detectRepeatSeriesNamingConfig(task.description),
			baseTemporalTemplate: deriveTemporalTemplateFromTask(task),
			now: new Date().toISOString(),
		});
	}

	private getSettingsTabFileBaseName(filePath: string): string {
		const abstract = this.app.vault.getAbstractFileByPath(filePath);
		return abstract instanceof TFile
			? abstract.basename
			: filePath.split('/').pop()?.replace(/\.md$/i, '') ?? t('taskEditor', 'untitledTaskFile');
	}

	private deriveSettingsTabRepeatBaseTitle(filePath: string): string {
		const basename = this.getSettingsTabFileBaseName(filePath);
		return basename.replace(/ - \d{4}-\d{2}-\d{2}(?: \(\d+\))?$/u, '').trim() || basename;
	}

	private renderTaskCreatorToolbarSettingsSection(containerEl: HTMLElement): void {
		renderInterfaceIconToggleSection<TaskCreatorToolbarFieldKey, TaskCreatorToolbarItem>({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'taskCreatorToolbarSectionDesc'),
			toggleTitle: t('settings', 'taskCreatorToolbarToggleTitle'),
			reorderTitle: t('settings', 'taskCreatorToolbarReorder'),
			moveUpLabel: t('settings', 'taskCreatorToolbarMoveUp'),
			moveDownLabel: t('settings', 'taskCreatorToolbarMoveDown'),
			getItems: () => this.settings.taskCreatorToolbar,
			setItems: items => {
				this.settings.taskCreatorToolbar = items;
			},
			getLabel: key => this.getTaskCreatorToolbarFieldLabel(key),
			getIcon: key => this.getTaskCreatorToolbarFieldIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			save: () => this.saveSettings(),
			visibilityErrorContext: 'settings task creator toolbar toggle failed',
			iconOnlyErrorContext: 'settings task creator toolbar icon-only toggle failed',
			actionErrorContext: 'settings task creator toolbar action toggle failed',
		});
	}

	private renderInlineTaskCompactChipSettingsSection(containerEl: HTMLElement): void {
		renderCompactChipSettingsSection({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'inlineTaskIconsSectionDesc'),
			toggleTitle: t('settings', 'inlineTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'inlineTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'inlineTaskIconsReorder'),
			moveUpLabel: t('settings', 'inlineTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'inlineTaskIconsMoveDown'),
			getItems: () => this.settings.inlineTaskCompactChips,
			setItems: items => {
				this.settings.inlineTaskCompactChips = items;
			},
			getLabel: key => this.getInlineTaskCompactChipLabel(key),
			getIcon: key => this.getInlineTaskCompactChipIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			iconOnlyButtonLabel: t('settings', 'compactChipIconOnly'),
			actionTogglesTitle: t('settings', 'inlineTaskActionsSection'),
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			getIconOnlyToggleLabel: label => t('settings', 'compactChipIconOnlyToggle', { label }),
			save: () => this.saveSettings(),
			getActionToggles: () => [
				{
					visible: this.settings.inlineTaskShowPlayAction,
					icon: 'play',
					label: t('settings', 'inlineTaskPlayAction'),
					onToggle: async () => {
						this.settings.inlineTaskShowPlayAction = !this.settings.inlineTaskShowPlayAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.inlineTaskShowPinAction,
					icon: 'pin',
					label: t('settings', 'inlineTaskPinAction'),
					onToggle: async () => {
						this.settings.inlineTaskShowPinAction = !this.settings.inlineTaskShowPinAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.inlineTaskShowSubtaskAction,
					icon: 'list-plus',
					label: t('settings', 'inlineTaskSubtaskAction'),
					onToggle: async () => {
						this.settings.inlineTaskShowSubtaskAction = !this.settings.inlineTaskShowSubtaskAction;
						await this.saveSettings();
					},
				},
			],
		});
	}

	private renderTaskFinderCompactChipSettingsSection(containerEl: HTMLElement): void {
		renderCompactChipSettingsSection({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'taskFinderIconsSectionDesc'),
			toggleTitle: t('settings', 'taskFinderIconsToggleTitle'),
			reorderTitle: t('settings', 'taskFinderIconsReorder'),
			moveUpLabel: t('settings', 'taskFinderIconsMoveUp'),
			moveDownLabel: t('settings', 'taskFinderIconsMoveDown'),
			getItems: () => this.settings.taskFinderCompactChips,
			setItems: items => {
				this.settings.taskFinderCompactChips = items.map(entry => ({ ...entry, iconOnly: false }));
			},
			getLabel: key => this.getInlineTaskCompactChipLabel(key),
			getIcon: key => this.getInlineTaskCompactChipIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			save: () => this.saveSettings(),
		});
	}

	private renderOverlayTaskCompactChipSettingsSection(containerEl: HTMLElement): void {
		renderCompactChipSettingsSection({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'overlayTaskIconsSectionDesc'),
			toggleTitle: t('settings', 'overlayTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'overlayTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'overlayTaskIconsReorder'),
			moveUpLabel: t('settings', 'overlayTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'overlayTaskIconsMoveDown'),
			getItems: () => this.settings.overlayTaskCompactChips,
			setItems: items => {
				this.settings.overlayTaskCompactChips = items;
			},
			getLabel: key => this.getInlineTaskCompactChipLabel(key),
			getIcon: key => this.getInlineTaskCompactChipIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			iconOnlyButtonLabel: t('settings', 'compactChipIconOnly'),
			actionTogglesTitle: t('settings', 'overlayTaskActionsSection'),
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			getIconOnlyToggleLabel: label => t('settings', 'compactChipIconOnlyToggle', { label }),
			save: () => this.saveSettings(),
			getActionToggles: () => [
				{
					visible: this.settings.overlayTaskShowPlayAction,
					icon: 'play',
					label: t('settings', 'inlineTaskPlayAction'),
					onToggle: async () => {
						this.settings.overlayTaskShowPlayAction = !this.settings.overlayTaskShowPlayAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.overlayTaskShowPinAction,
					icon: 'pin',
					label: t('settings', 'inlineTaskPinAction'),
					onToggle: async () => {
						this.settings.overlayTaskShowPinAction = !this.settings.overlayTaskShowPinAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.overlayTaskShowNoteAction,
					icon: 'notebook-pen',
					label: t('settings', 'inlineTaskNoteAction'),
					onToggle: async () => {
						this.settings.overlayTaskShowNoteAction = !this.settings.overlayTaskShowNoteAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.overlayTaskShowSubtaskAction,
					icon: 'list-plus',
					label: t('settings', 'inlineTaskSubtaskAction'),
					onToggle: async () => {
						this.settings.overlayTaskShowSubtaskAction = !this.settings.overlayTaskShowSubtaskAction;
						await this.saveSettings();
					},
				},
			],
		});
	}

	private getTaskCreatorToolbarFieldLabel(key: TaskCreatorToolbarFieldKey): string {
		if (key === 'taskIcon') return t('taskEditor', 'taskIcon');
		if (key === 'taskColor') return t('taskEditor', 'taskColor');
		if (key === 'priority') return t('taskEditor', 'priority');
		if (key === 'status') return t('taskEditor', 'status');
		if (key === 'parentTask') return t('taskEditor', 'parentTask');
		if (key === 'contexts') return t('taskEditor', 'contexts');
		if (key === 'links') return t('taskEditor', 'links');
		if (key === 'dateStarted') return t('taskEditor', 'started');
		if (key === 'dateScheduled') return t('taskEditor', 'scheduled');
		if (key === 'dateDue') return t('taskEditor', 'dueDate');
		if (key === 'pinned') return t('settings', 'taskCreatorToolbarPinned');
		if (key === 'datetimeStart') return t('taskEditor', 'datetimeStart');
		if (key === 'datetimeEnd') return t('taskEditor', 'datetimeEnd');
		if (key === 'estimate') return t('taskEditor', 'estimateMinutes');
		if (key === 'repeat') return t('taskEditor', 'repeat');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		if (key === 'tags') return t('taskEditor', 'tags');
		if (key === 'assignees') return t('taskEditor', 'assignees');
		if (key === 'note') return t('taskEditor', 'notes');
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private getTaskCreatorToolbarFieldIcon(key: TaskCreatorToolbarFieldKey): string {
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || TASK_CREATOR_FALLBACK_FIELD_ICONS[key];
	}

	private getInlineTaskCompactChipLabel(key: InlineTaskCompactChipKey): string {
		if (key === 'priority') return t('settings', 'chipPriority');
		if (key === 'status') return t('settings', 'chipStatus');
		if (key === 'parentTask') return t('settings', 'chipDateDue');
		if (key === 'dateStarted') return t('settings', 'chipDateStarted');
		if (key === 'dateScheduled') return t('settings', 'chipDateScheduled');
		if (key === 'dateDue') return t('settings', 'chipDateDue');
		if (key === 'datetimeStart') return t('settings', 'chipDatetimeStart');
		if (key === 'datetimeEnd') return t('settings', 'chipDatetimeEnd');
		if (key === 'assignees') return t('settings', 'chipAssignees');
		if (key === 'contexts') return t('settings', 'chipContexts');
		if (key === 'links') return t('settings', 'chipLinks');
		if (key === 'tags') return t('settings', 'chipTags');
		if (key === 'estimate') return t('settings', 'chipEstimate');
		if (key === 'duration') return t('settings', 'chipDuration');
		if (key === 'dateCompleted') return t('settings', 'chipDateCompleted');
		if (key === 'dateCancelled') return t('settings', 'chipDateCancelled');
		if (key === 'totalDuration') return t('settings', 'chipTotalDuration');
		if (key === 'totalEstimate') return t('settings', 'chipTotalEstimate');
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private getInlineTaskCompactChipIcon(key: InlineTaskCompactChipKey): string {
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || INLINE_TASK_COMPACT_FALLBACK_ICONS[key];
	}

	private getTaskFinderScopeLabel(key: TaskFinderDefaultScopeKey): string {
		switch (key) {
			case 'projectTasks':
				return t('modals', 'taskFinderProjectTasks');
			case 'projectTree':
				return t('modals', 'taskFinderProjectTree');
			case 'overdue':
				return t('modals', 'taskFinderOverdue');
			case 'happensToday':
				return t('modals', 'taskFinderHappensToday');
			case 'recentModified':
				return t('modals', 'taskFinderRecentModified');
			case 'includeInline':
				return t('modals', 'taskFinderIncludeInline');
			case 'includeFile':
				return t('modals', 'taskFinderIncludeFile');
			case 'includeCancelled':
				return t('modals', 'taskFinderIncludeCancelled');
			case 'includeFinished':
				return t('modals', 'taskFinderIncludeFinished');
		}
	}

	private updateTaskFinderShortcut(key: TaskFinderDefaultScopeKey, shortcut: string): void {
		this.settings.taskFinderShortcuts = TASK_FINDER_DEFAULT_SCOPE_ORDER.map(itemKey => {
			const existing = this.settings.taskFinderShortcuts.find(item => item.key === itemKey);
			return {
				key: itemKey,
				shortcut: itemKey === key ? shortcut : existing?.shortcut ?? '',
			};
		});
	}

	private renderTrackerTab(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'trackerTitle'));

		this.renderBoundToggleSetting(containerEl, t('settings', 'trackerSplitSessionsAtMidnight'), t('settings', 'trackerSplitSessionsAtMidnightDesc'), 'trackerSplitSessionsAtMidnight');
		this.renderBoundToggleSetting(containerEl, t('settings', 'trackerShowStatusBarTimer'), t('settings', 'trackerShowStatusBarTimerDesc'), 'trackerShowStatusBarTimer');

		renderSettingsHeading(containerEl, t('settings', 'trackerSessionHistorySection'));

		this.addNumericSetting(
			containerEl,
			t('settings', 'trackerHistoryWindowDays'),
			t('settings', 'trackerHistoryWindowDaysDesc'),
			'trackerHistoryDays',
		);

		this.renderBoundDropdownSetting(containerEl, t('settings', 'trackerTaskDescriptionClickAction'), t('settings', 'trackerTaskDescriptionClickActionDesc'), 'trackerTaskDescriptionClickAction', {
			value: this.settings.trackerTaskDescriptionClickAction,
			dropdownOptions: [],
			configure: dropdown => {
				this.addTrackerTaskDescriptionClickActionOptions(dropdown);
			},
			normalize: value => value === 'openTaskEditor' ? 'openTaskEditor' : 'jumpToSource',
		});

		renderSettingsHeading(containerEl, t('settings', 'trackerFlowTimeSection'));

		this.renderBoundDropdownSetting(containerEl, t('settings', 'flowTimePauseDuration'), t('settings', 'flowTimePauseDurationDesc'), 'flowTimePauseMinutes', {
			value: String(this.settings.flowTimePauseMinutes),
			dropdownOptions: FLOW_TIME_PAUSE_MINUTE_OPTIONS.map(minutes => ({
				value: String(minutes),
				label: t('settings', 'flowTimeMinutesOption', { minutes: String(minutes) }),
			})),
			normalize: value => {
				const parsed = parseInt(value, 10);
				return FLOW_TIME_PAUSE_MINUTE_OPTIONS.includes(parsed as typeof FLOW_TIME_PAUSE_MINUTE_OPTIONS[number])
					? parsed
					: DEFAULT_SETTINGS.flowTimePauseMinutes;
			},
		});

		this.renderBoundToggleSetting(containerEl, t('settings', 'flowTimeUseLastSelectedDuration'), t('settings', 'flowTimeUseLastSelectedDurationDesc'), 'flowTimeUseLastSelectedDuration', {
			onBeforeSave: value => {
				if (!value) {
					this.settings.flowTimeSessionMinutes = this.settings.flowTimeDefaultSessionMinutes;
				}
			},
			onAfterChange: () => {
				this.display();
			},
		});

		this.renderBoundDropdownSetting(containerEl, t('settings', 'flowTimeDefaultSessionMinutes'), t('settings', 'flowTimeDefaultSessionMinutesDesc'), 'flowTimeDefaultSessionMinutes', {
			value: String(this.settings.flowTimeDefaultSessionMinutes),
			dropdownOptions: FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS.map(minutes => ({
				value: String(minutes),
				label: t('settings', 'flowTimeMinutesOption', { minutes: String(minutes) }),
			})),
			disabled: this.settings.flowTimeUseLastSelectedDuration,
			normalize: value => {
				const parsed = parseInt(value, 10);
				return FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS.includes(parsed as typeof FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS[number])
					? parsed
					: DEFAULT_SETTINGS.flowTimeDefaultSessionMinutes;
			},
			onBeforeSave: value => {
				if (!this.settings.flowTimeUseLastSelectedDuration) {
					this.settings.flowTimeSessionMinutes = value;
				}
			},
		});

		this.renderBoundToggleSetting(containerEl, t('settings', 'flowTimeShowNumericTimer'), t('settings', 'flowTimeShowNumericTimerDesc'), 'flowTimeShowNumericTimer');
		this.renderBoundToggleSetting(containerEl, t('settings', 'flowTimeNotifyOnTargetReached'), t('settings', 'flowTimeNotifyOnTargetReachedDesc'), 'flowTimeNotifyOnTargetReached');
	}

	private addTrackerTaskDescriptionClickActionOptions(
		dropdown: import('obsidian').DropdownComponent,
	): void {
		const options: Array<{ value: TrackerTaskDescriptionClickAction; label: string }> = [
			{ value: 'jumpToSource', label: t('settings', 'trackerClickJumpToSource') },
			{ value: 'openTaskEditor', label: t('settings', 'trackerClickOpenTaskEditor') },
		];
		for (const option of options) {
			dropdown.addOption(option.value, option.label);
		}
	}

	private renderContextualHoverMenuSettingsSection(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'contextualMenuActions'));
		const hoverMenuBody = containerEl;
		hoverMenuBody.createEl('p', {
			text: t('settings', 'contextualMenuActionsDesc'),
			cls: 'operon-settings-section-desc',
		});
		this.renderBoundClampedNumericSetting(hoverMenuBody, t('settings', 'contextualMenuOpenDelay'), t('settings', 'contextualMenuOpenDelayDesc'), 'contextualMenuOpenDelayMs', {
			min: 0,
			max: 2000,
			fallback: DEFAULT_SETTINGS.contextualMenuOpenDelayMs,
		});
		const enabledActionIds = this.settings.contextualMenuActionAllowlist
			.filter(id => CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.some(action => action.id === id));
		const disabledActions = CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS
			.filter(action => !enabledActionIds.includes(action.id));
		const orderedActions = [
			...enabledActionIds
				.map(id => CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.find(action => action.id === id))
				.filter((action): action is typeof CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS[number] => !!action),
			...disabledActions,
		];
		for (const action of orderedActions) {
			const enabled = this.settings.contextualMenuActionAllowlist.includes(action.id);
			const enabledIndex = this.settings.contextualMenuActionAllowlist.indexOf(action.id);
			const setting = new Setting(hoverMenuBody)
				.setName(t('settings', action.labelKey))
				.setDesc(t('settings', action.descriptionKey));
			this.decorateContextualMenuActionSetting(setting, action.icon);

			setting.addToggle(toggle => {
				toggle.setValue(enabled);
				toggle.onChange(async (nextEnabled) => {
					const nextAllowlist = [...this.settings.contextualMenuActionAllowlist];
					const currentIndex = nextAllowlist.indexOf(action.id);
					if (nextEnabled && currentIndex === -1) {
						nextAllowlist.push(action.id);
					}
					if (!nextEnabled && currentIndex !== -1) {
						nextAllowlist.splice(currentIndex, 1);
					}
					this.settings.contextualMenuActionAllowlist = nextAllowlist;
					await this.saveSettings();
					this.display();
				});
			});

			setting.addExtraButton(button => {
				button.setIcon('arrow-up');
				applyOperonTooltipToExtraButton(button, t('settings', 'moveUp'));
				button.setDisabled(!enabled || enabledIndex <= 0);
				button.onClick(async () => {
					if (!enabled || enabledIndex <= 0) return;
					const nextAllowlist = [...this.settings.contextualMenuActionAllowlist];
					const [item] = nextAllowlist.splice(enabledIndex, 1);
					nextAllowlist.splice(enabledIndex - 1, 0, item);
					this.settings.contextualMenuActionAllowlist = nextAllowlist;
					await this.saveSettings();
					this.display();
				});
			});

			setting.addExtraButton(button => {
				button.setIcon('arrow-down');
				applyOperonTooltipToExtraButton(button, t('settings', 'moveDown'));
				button.setDisabled(!enabled || enabledIndex === -1 || enabledIndex >= this.settings.contextualMenuActionAllowlist.length - 1);
				button.onClick(async () => {
					if (!enabled || enabledIndex === -1 || enabledIndex >= this.settings.contextualMenuActionAllowlist.length - 1) return;
					const nextAllowlist = [...this.settings.contextualMenuActionAllowlist];
					const [item] = nextAllowlist.splice(enabledIndex, 1);
					nextAllowlist.splice(enabledIndex + 1, 0, item);
					this.settings.contextualMenuActionAllowlist = nextAllowlist;
					await this.saveSettings();
					this.display();
				});
			});
		}
		const matrixHost = hoverMenuBody.createDiv();
		this.renderContextualMenuMatrix(matrixHost);
	}

	private decorateContextualMenuActionSetting(setting: Setting, icon: string): void {
		const nameEl = setting.settingEl.querySelector<HTMLElement>('.setting-item-name');
		if (!nameEl) return;
		nameEl.addClass('operon-settings-contextual-action-name');
		const iconEl = nameEl.createSpan();
		iconEl.className = 'operon-settings-contextual-action-icon';
		setIcon(iconEl, icon);
		nameEl.prepend(iconEl);
	}

	private getOrderedContextualMenuActions(): typeof CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS {
		const enabledActionIds = this.settings.contextualMenuActionAllowlist
			.filter(id => CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.some(action => action.id === id));
		const disabledActions = CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS
			.filter(action => !enabledActionIds.includes(action.id));
		return [
			...enabledActionIds
				.map(id => CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.find(action => action.id === id))
				.filter((action): action is typeof CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS[number] => !!action),
			...disabledActions,
		];
	}

	private renderContextualMenuMatrix(containerEl: HTMLElement): void {
		containerEl.empty();
		const matrix = containerEl.createDiv('operon-settings-contextual-menu-matrix');
		matrix.createDiv({
			cls: 'operon-settings-contextual-menu-matrix-title',
			text: t('settings', 'contextualMenuMatrix'),
		});
		matrix.createEl('p', {
			text: t('settings', 'contextualMenuMatrixDesc'),
			cls: 'operon-settings-section-desc',
		});
		const actions = this.getOrderedContextualMenuActions();
		const scroll = matrix.createDiv('operon-settings-contextual-menu-matrix-scroll');
		const table = scroll.createDiv('operon-settings-contextual-menu-matrix-table');
		table.setAttribute('role', 'table');
		setAccessibleLabelWithoutTooltip(table, t('settings', 'contextualMenuMatrix'));
		table.style.setProperty('--operon-contextual-menu-action-count', String(actions.length));
		const header = table.createDiv('operon-settings-contextual-menu-matrix-row operon-settings-contextual-menu-matrix-header');
		header.setAttribute('role', 'row');
		header.createDiv({
			cls: 'operon-settings-contextual-menu-matrix-surface-cell',
			attr: { role: 'columnheader' },
		});
		for (const action of actions) {
			const headerCell = header.createDiv({
				cls: 'operon-settings-contextual-menu-matrix-action-cell',
				attr: { role: 'columnheader' },
			});
			createInterfaceMatrixHeaderIcon({
				containerEl: headerCell,
				icon: action.icon,
				label: t('settings', action.labelKey),
				className: 'operon-settings-contextual-menu-matrix-header-icon',
			});
		}

		for (const group of CONFIGURABLE_CONTEXTUAL_MENU_SURFACE_GROUPS) {
			const groupRow = table.createDiv('operon-settings-contextual-menu-matrix-group');
			groupRow.setAttribute('role', 'row');
			groupRow.createDiv({
				text: t('settings', group.labelKey),
				attr: {
					role: 'cell',
					'aria-colspan': String(actions.length + 1),
				},
			});
			for (const surface of group.surfaces) {
				const row = table.createDiv('operon-settings-contextual-menu-matrix-row');
				row.setAttribute('role', 'row');
				row.createDiv({
					cls: 'operon-settings-contextual-menu-matrix-surface-cell',
					text: t('settings', CONTEXTUAL_MENU_SURFACE_LABEL_KEYS[surface]),
					attr: { role: 'rowheader' },
				});
				for (const action of actions) {
					this.renderContextualMenuMatrixCell(row, surface, action.id, action.icon, t('settings', action.labelKey), containerEl);
				}
			}
		}
	}

	private renderContextualMenuMatrixCell(
		row: HTMLElement,
		surface: ContextualMenuSurface,
		actionId: ContextualMenuActionId,
		icon: string,
		label: string,
		matrixHost: HTMLElement,
	): void {
		const globallyEnabled = this.settings.contextualMenuActionAllowlist.includes(actionId);
		const surfaceSupported = isContextualMenuActionSupportedOnSurface(surface, actionId);
		const locked = !globallyEnabled || !surfaceSupported;
		const enabled = this.isContextualMenuSurfaceActionEnabled(surface, actionId);
		const actionCell = row.createDiv({
			cls: 'operon-settings-contextual-menu-matrix-action-cell',
			attr: { role: 'cell' },
		});
		createInterfaceMatrixButton({
			containerEl: actionCell,
			icon,
			label: `${t('settings', CONTEXTUAL_MENU_SURFACE_LABEL_KEYS[surface])}: ${label}`,
			tooltip: label,
			className: 'operon-settings-contextual-menu-matrix-cell',
			active: enabled,
			locked,
			lockedTooltip: globallyEnabled
				? t('settings', 'contextualMenuMatrixLockedSurface')
				: t('settings', 'contextualMenuMatrixLockedGlobal'),
			errorContext: 'settings contextual menu matrix toggle failed',
			onClick: async () => {
				this.setContextualMenuSurfaceActionEnabled(surface, actionId, !enabled);
				await this.saveSettings();
				this.renderContextualMenuMatrix(matrixHost);
			},
		});
	}

	private isContextualMenuSurfaceActionEnabled(surface: ContextualMenuSurface, actionId: ContextualMenuActionId): boolean {
		const surfaceAllowlist = this.settings.contextualMenuSurfaceActionMatrix[surface];
		if (!Array.isArray(surfaceAllowlist)) return true;
		return surfaceAllowlist.includes(actionId);
	}

	private setContextualMenuSurfaceActionEnabled(surface: ContextualMenuSurface, actionId: ContextualMenuActionId, enabled: boolean): void {
		const current = new Set(this.settings.contextualMenuSurfaceActionMatrix[surface] ?? CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.map(action => action.id));
		if (enabled) {
			current.add(actionId);
		} else {
			current.delete(actionId);
		}
		this.settings.contextualMenuSurfaceActionMatrix = {
			...this.settings.contextualMenuSurfaceActionMatrix,
			[surface]: CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS
				.map(action => action.id)
				.filter(id => current.has(id)),
		};
	}

	private renderCalendarTab(containerEl: HTMLElement): void {
		renderSettingsInfoBox(containerEl, t('calendar', 'title'), t('calendar', 'calendarSettingsDesc'));

		this.renderBoundDropdownSetting(containerEl, t('calendar', 'defaultPreset'), t('calendar', 'defaultPresetDesc'), 'calendarDefaultPresetId', {
			value: this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? '',
			dropdownOptions: [],
			configure: drop => {
				for (const preset of this.settings.calendarPresets) {
					drop.addOption(preset.id, preset.name);
				}
			},
			normalize: value => value ? value : (this.settings.calendarPresets[0]?.id ?? null),
		});

		this.renderBoundDropdownSetting(containerEl, t('calendar', 'weekStart'), t('calendar', 'weekStartDesc'), 'calendarWeekStart', {
			value: this.settings.calendarWeekStart,
			dropdownOptions: [
				{ value: 'monday', label: t('calendar', 'monday') },
				{ value: 'sunday', label: t('calendar', 'sunday') },
			],
			normalize: value => value === 'sunday' ? 'sunday' : 'monday',
		});

		this.renderBoundToggleSetting(containerEl, t('calendar', 'showWeekLabelOnFirstDay'), t('calendar', 'showWeekLabelOnFirstDayDesc'), 'calendarShowWeekLabelOnFirstDay');

		this.renderBoundDropdownSetting(containerEl, t('calendar', 'initialScrollMode'), t('calendar', 'initialScrollModeDesc'), 'calendarInitialScrollMode', {
			value: this.settings.calendarInitialScrollMode,
			dropdownOptions: [
				{ value: 'autoNow', label: t('calendar', 'initialScrollAutoNow') },
				{ value: 'fixedHour', label: t('calendar', 'initialScrollFixedHour') },
			],
			normalize: value => value === 'fixedHour' ? 'fixedHour' : 'autoNow',
			onAfterChange: () => {
				this.display();
			},
		});

		if (this.settings.calendarInitialScrollMode === 'autoNow') {
			this.renderBoundDropdownSetting(containerEl, t('calendar', 'currentTimePosition'), t('calendar', 'currentTimePositionDesc'), 'calendarAutoScrollPastRatio', {
				value: String(this.settings.calendarAutoScrollPastRatio),
				dropdownOptions: CALENDAR_AUTO_SCROLL_POSITION_OPTIONS.map(ratio => {
					const past = Math.round(ratio * 100);
					const future = 100 - past;
					return { value: String(ratio), label: `${past} / ${future}` };
				}),
				normalize: value => {
					const parsed = Number.parseFloat(value);
					return CALENDAR_AUTO_SCROLL_POSITION_OPTIONS.includes(parsed as typeof CALENDAR_AUTO_SCROLL_POSITION_OPTIONS[number])
						? parsed
						: DEFAULT_SETTINGS.calendarAutoScrollPastRatio;
				},
			});
		} else {
			this.renderBoundClampedNumericSetting(containerEl, t('calendar', 'defaultScrollHour'), t('calendar', 'defaultScrollHourDesc'), 'calendarDefaultScrollHour', {
				min: 0,
				max: 23,
				fallback: DEFAULT_SETTINGS.calendarDefaultScrollHour,
			});
		}

		this.renderBoundDropdownSetting(containerEl, t('calendar', 'timeGridScale'), t('calendar', 'timeGridScaleDesc'), 'calendarTimeGridScale', {
			value: String(this.settings.calendarTimeGridScale),
			dropdownOptions: CALENDAR_TIME_GRID_SCALE_OPTIONS.map(scale => ({
				value: String(scale),
				label: `${this.formatCalendarTimeGridScaleLabel(scale)}x`,
			})),
			normalize: value => {
				const parsed = Number.parseFloat(value);
				return CALENDAR_TIME_GRID_SCALE_OPTIONS.includes(parsed as typeof CALENDAR_TIME_GRID_SCALE_OPTIONS[number])
					? parsed
					: DEFAULT_SETTINGS.calendarTimeGridScale;
			},
		});

		renderSettingsHeading(containerEl, t('calendar', 'viewPresets'));
		containerEl.createEl('p', {
			text: t('calendar', 'viewPresetsDesc'),
			cls: 'operon-settings-muted-block',
		});

		const listEl = containerEl.createDiv('operon-calendar-preset-list');
		const renderList = (): void => {
			listEl.empty();
			for (let index = 0; index < this.settings.calendarPresets.length; index++) {
				this.renderCalendarPresetRow(listEl, this.settings.calendarPresets[index], index, renderList);
			}
		};
		renderList();

		const addBtn = containerEl.createEl('button', { cls: 'operon-settings-primary-button operon-settings-spaced-top' });
		addBtn.setText(t('calendar', 'addPresetButton'));
		addBtn.addEventListener('click', settingsAsyncHandler('settings calendar preset add failed', async () => {
			const preset: CalendarPreset = {
				id: createCalendarPresetId(),
				name: t('calendar', 'newPresetName', { number: String(this.settings.calendarPresets.length + 1) }),
				surfaceType: 'timeGrid',
				weekCount: 2,
				focusedWeekNumber: 1,
				dayCount: 7,
				todayPosition: 1,
				slotMinutes: 15,
				filterSetId: null,
				navigationMode: 'sidebar',
				showAllDayLane: true,
				showDueMarkers: true,
				showWeekends: true,
				hiddenTimeStart: '00:00',
				hiddenTimeEnd: '06:00',
				colorSource: 'taskColor',
				appearanceModeLight: 'theme',
				appearanceModeDark: 'theme',
				externalCalendarVisibility: {},
			};
			this.settings.calendarPresets.push(preset);
			if (!this.settings.calendarDefaultPresetId) {
				this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
			}
			await this.saveSettings();
			this.display();
			this.openCalendarPresetSettingsModal(preset.id, () => this.display());
		}));

		renderSettingsHeading(containerEl, t('calendar', 'calendarSidebarSettings'));
		const sidebarBody = containerEl;
		this.renderBoundToggleSetting(sidebarBody, t('calendar', 'showWeekNumbers'), t('calendar', 'showWeekNumbersDesc'), 'calendarSidebarShowWeekNumbers');
		this.renderBoundToggleSetting(sidebarBody, t('calendar', 'showAllDayLane'), t('calendar', 'showAllDayLaneDesc'), 'calendarShowAllDayLane');
		this.renderBoundToggleSetting(sidebarBody, t('calendar', 'showDueLane'), t('calendar', 'showDueLaneDesc'), 'calendarShowDueMarkers');
		this.renderBoundClampedNumericSetting(sidebarBody, t('calendar', 'sidebarWidth'), t('calendar', 'sidebarWidthDesc'), 'calendarSidebarWidthPx', {
			min: CALENDAR_SIDEBAR_WIDTH_MIN,
			max: CALENDAR_SIDEBAR_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.calendarSidebarWidthPx,
			step: '1',
		});
		this.renderBoundDropdownSetting(sidebarBody, t('settings', 'calendarSidebarCalendarsDefaultState'), t('settings', 'calendarSidebarCalendarsDefaultStateDesc'), 'calendarSidebarCalendarsDefaultExpanded', {
			value: this.settings.calendarSidebarCalendarsDefaultExpanded ? 'expanded' : 'collapsed',
			dropdownOptions: [
				{ value: 'expanded', label: t('settings', 'expanded') },
				{ value: 'collapsed', label: t('settings', 'collapsed') },
			],
			normalize: value => value !== 'collapsed',
			onBeforeSave: () => this.normalizeCalendarSidebarDefaultState('calendarSidebarCalendarsDefaultExpanded'),
			onAfterChange: () => this.display(),
		});
		this.renderBoundDropdownSetting(sidebarBody, t('settings', 'calendarSidebarTaskPoolDefaultState'), t('settings', 'calendarSidebarTaskPoolDefaultStateDesc'), 'calendarSidebarTaskPoolDefaultExpanded', {
			value: this.settings.calendarSidebarTaskPoolDefaultExpanded ? 'expanded' : 'collapsed',
			dropdownOptions: [
				{ value: 'expanded', label: t('settings', 'expanded') },
				{ value: 'collapsed', label: t('settings', 'collapsed') },
			],
			normalize: value => value !== 'collapsed',
			onBeforeSave: () => this.normalizeCalendarSidebarDefaultState('calendarSidebarTaskPoolDefaultExpanded'),
			onAfterChange: () => this.display(),
		});
		this.renderBoundDropdownSetting(sidebarBody, t('settings', 'calendarSidebarFinishedTasksDefaultState'), t('settings', 'calendarSidebarFinishedTasksDefaultStateDesc'), 'calendarSidebarFinishedTasksDefaultExpanded', {
			value: this.settings.calendarSidebarFinishedTasksDefaultExpanded ? 'expanded' : 'collapsed',
			dropdownOptions: [
				{ value: 'expanded', label: t('settings', 'expanded') },
				{ value: 'collapsed', label: t('settings', 'collapsed') },
			],
			normalize: value => value !== 'collapsed',
			onBeforeSave: () => this.normalizeCalendarSidebarDefaultState('calendarSidebarFinishedTasksDefaultExpanded'),
			onAfterChange: () => this.display(),
		});
		sidebarBody.createEl('p', {
			text: t('settings', 'calendarSidebarTaskPoolLimitDesc', {
				initialLimit: String(CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT),
				searchLimit: String(CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT),
			}),
			cls: 'operon-settings-section-desc',
		});

		this.renderExternalCalendarsSection(containerEl);
	}

	private normalizeCalendarSidebarDefaultState(changedKey: CalendarSidebarDefaultStateKey): void {
		const normalized = normalizeCalendarSidebarDefaultExpansionState({
			calendarSidebarCalendarsDefaultExpanded: this.settings.calendarSidebarCalendarsDefaultExpanded,
			calendarSidebarTaskPoolDefaultExpanded: this.settings.calendarSidebarTaskPoolDefaultExpanded,
			calendarSidebarFinishedTasksDefaultExpanded: this.settings.calendarSidebarFinishedTasksDefaultExpanded,
		}, changedKey);
		this.settings.calendarSidebarCalendarsDefaultExpanded = normalized.calendarSidebarCalendarsDefaultExpanded;
		this.settings.calendarSidebarTaskPoolDefaultExpanded = normalized.calendarSidebarTaskPoolDefaultExpanded;
		this.settings.calendarSidebarFinishedTasksDefaultExpanded = normalized.calendarSidebarFinishedTasksDefaultExpanded;
	}

	private renderExternalCalendarsSection(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'externalCalendarsTitle'));
		containerEl.createEl('p', {
			text: t('settings', 'externalCalendarsDesc'),
			cls: 'operon-settings-muted-block',
		});

		const listEl = containerEl.createDiv('operon-external-calendar-list');

		if (this.settings.externalCalendars.length === 0) {
			listEl.createEl('p', {
				text: t('settings', 'externalCalendarsEmpty'),
				cls: 'operon-settings-muted-block',
			});
		} else {
			for (let index = 0; index < this.settings.externalCalendars.length; index++) {
				this.renderExternalCalendarSourceRow(listEl, this.settings.externalCalendars[index], index);
			}
		}

		const addBtn = containerEl.createEl('button', { cls: 'operon-settings-primary-button operon-settings-spaced-top' });
		addBtn.setText(t('settings', 'externalCalendarsAddButton'));
		addBtn.addEventListener('click', settingsAsyncHandler('settings external calendar add failed', async () => {
			const newSource: ExternalCalendarSource = {
				id: createExternalCalendarSourceId(),
				type: 'ics',
				name: '',
				url: '',
				color: '#8ecae6',
				enabled: true,
				hideCreatedEvents: false,
				refreshIntervalHours: 1,
			};
			this.settings.externalCalendars.push(newSource);
			await this.saveSettings();
			this.display();
			this.openExternalCalendarSourceEditModal(newSource, true);
		}));
	}

	private renderExternalCalendarSourceRow(listEl: HTMLElement, source: ExternalCalendarSource, index: number): void {
		const cache = this.storage.externalCalendars.getSource(source.id);
		const syncedAt = this.formatSettingsDateTime(cache?.syncedAt ?? null);
		const displayName = source.name.trim() || t('settings', 'externalCalendarUntitled');
		const total = this.settings.externalCalendars.length;

		const card = createSettingsListCard({
			containerEl: listEl,
			icon: 'globe',
			title: displayName,
			className: 'operon-external-calendar-card',
		});

		if (!source.enabled) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'eye-off',
				label: t('settings', 'externalCalendarDisabled'),
			});
		}
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'clock',
			label: t('settings', 'externalCalendarLastSynced', { value: syncedAt }),
		});
		if (cache?.lastError) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'alert-triangle',
				label: t('settings', 'externalCalendarLastError', { value: cache.lastError }),
				className: 'is-error',
			});
		}

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'externalCalendarMoveUp'),
			ariaLabel: `${t('settings', 'externalCalendarMoveUp')}: ${displayName}`,
			icon: 'arrow-up',
			disabled: index === 0,
			errorContext: 'settings external calendar move up failed',
			onClick: async () => {
				if (index === 0) return;
				await this.moveExternalCalendarSource(index, -1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'externalCalendarMoveDown'),
			ariaLabel: `${t('settings', 'externalCalendarMoveDown')}: ${displayName}`,
			icon: 'arrow-down',
			disabled: index === total - 1,
			errorContext: 'settings external calendar move down failed',
			onClick: async () => {
				if (index >= total - 1) return;
				await this.moveExternalCalendarSource(index, 1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'externalCalendarEditAria', { name: displayName }),
			ariaLabel: t('settings', 'externalCalendarEditAria', { name: displayName }),
			tooltip: t('settings', 'externalCalendarEditTooltip'),
			text: 'Edit',
			wide: true,
			onClick: () => {
				this.openExternalCalendarSourceEditModal(source, false);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'externalCalendarRemove'),
			ariaLabel: `${t('settings', 'externalCalendarRemove')}: ${displayName}`,
			icon: 'trash-2',
			danger: true,
			errorContext: 'settings external calendar remove failed',
			onClick: async () => {
				const confirmed = await this.confirmDeleteExternalCalendarSource(displayName);
				if (!confirmed) return;
				this.settings.externalCalendars = this.settings.externalCalendars.filter(entry => entry.id !== source.id);
				for (const preset of this.settings.calendarPresets) {
					delete preset.externalCalendarVisibility[source.id];
				}
				await this.saveSettings();
				this.display();
			},
		});
	}

	private openExternalCalendarSourceEditModal(source: ExternalCalendarSource, isNew: boolean): void {
		const clone: ExternalCalendarSource = { ...source };
		new ExternalCalendarSourceEditModal({
			app: this.app,
			source: clone,
			isNew,
			onSave: settingsAsyncHandler('settings external calendar edit failed', async (saved: ExternalCalendarSource) => {
				const idx = this.settings.externalCalendars.findIndex(s => s.id === saved.id);
				if (idx >= 0) this.settings.externalCalendars[idx] = saved;
				await this.saveSettings();
				this.display();
			}),
			onCancel: settingsAsyncHandler('settings external calendar add cancel failed', async () => {
				this.settings.externalCalendars = this.settings.externalCalendars.filter(s => s.id !== source.id);
				await this.saveSettings();
				this.display();
			}),
			onSyncNow: async () => {
				await this.syncExternalCalendarSourceNow(source.id);
			},
		}).open();
	}

	private formatSettingsDateTime(value: string | null): string {
		if (!value) return t('settings', 'externalCalendarSyncNever');
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return t('settings', 'externalCalendarSyncNever');
		return new Intl.DateTimeFormat(getAppLocale(this.app), {
			dateStyle: 'medium',
			timeStyle: 'short',
		}).format(parsed);
	}

	private renderKanbanTab(containerEl: HTMLElement): void {
		renderSettingsInfoBox(containerEl, t('settings', 'kanbanTitle'), t('settings', 'kanbanSettingsDesc'));

		renderSettingsHeading(containerEl, t('settings', 'kanbanGeneralSettings'));
		this.renderBoundDropdownSetting(containerEl, t('settings', 'kanbanDefaultPreset'), t('settings', 'kanbanDefaultPresetDesc'), 'kanbanDefaultPresetId', {
			value: this.settings.kanbanDefaultPresetId ?? this.settings.kanbanPresets[0]?.id ?? '',
			dropdownOptions: [],
			configure: drop => {
				for (const preset of this.settings.kanbanPresets) {
					drop.addOption(preset.id, preset.name);
				}
			},
			normalize: value => value ? value : (this.settings.kanbanPresets[0]?.id ?? null),
		});

		this.renderBoundClampedNumericSetting(containerEl, t('settings', 'kanbanExpandedColumnWidth'), t('settings', 'kanbanExpandedColumnWidthDesc'), 'kanbanExpandedColumnWidthPx', {
			min: KANBAN_EXPANDED_COLUMN_WIDTH_MIN,
			max: KANBAN_EXPANDED_COLUMN_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.kanbanExpandedColumnWidthPx,
			step: '1',
		});

		this.renderBoundClampedNumericSetting(containerEl, t('settings', 'kanbanSwimlaneMaxHeight'), t('settings', 'kanbanSwimlaneMaxHeightDesc'), 'kanbanMaxVisibleTasksPerCell', {
			min: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN,
			max: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX,
			fallback: DEFAULT_SETTINGS.kanbanMaxVisibleTasksPerCell,
			step: '1',
		});

		renderSettingsHeading(containerEl, t('settings', 'kanbanPresets'));
		const listEl = containerEl.createDiv('operon-kanban-preset-list');
		const renderList = (): void => {
			listEl.empty();
			for (let index = 0; index < this.settings.kanbanPresets.length; index++) {
				this.renderKanbanPresetRow(listEl, this.settings.kanbanPresets[index], index, renderList);
			}
		};
		renderList();

		const addBtn = containerEl.createEl('button', { cls: 'operon-settings-primary-button operon-settings-spaced-top' });
		addBtn.setText(t('settings', 'kanbanAddPresetButton'));
		addBtn.addEventListener('click', settingsAsyncHandler('settings kanban preset add failed', async () => {
			const preset: KanbanPreset = {
				id: createKanbanPresetId(),
				name: t('settings', 'kanbanNewPresetName', { number: String(this.settings.kanbanPresets.length + 1) }),
				pipelineId: null,
				filterSetId: null,
				swimlaneBy: 'priority',
				colorSource: 'taskColor',
				appearanceModeLight: 'theme',
				appearanceModeDark: 'theme',
				collapseEmptyColumns: true,
				collapseEmptySwimlanes: true,
				autoCollapseFinishedColumns: true,
				sortMode: 'automatic',
				sortRules: createDefaultKanbanSortRules(),
			};
			this.settings.kanbanPresets.push(preset);
			if (!this.settings.kanbanDefaultPresetId) {
				this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
			}
			await this.saveSettings();
			this.display();
			this.openKanbanPresetSettingsModal(preset.id, () => this.display());
		}));
	}

	private renderKanbanPresetRow(
		listEl: HTMLElement,
		preset: KanbanPreset,
		index: number,
		refresh: () => void,
	): void {
		const total = this.settings.kanbanPresets.length;
		const isOnlyPreset = total === 1;
		const presetName = preset.name.trim() || t('settings', 'kanbanFallbackPresetName', { number: String(index + 1) });
		const pipelineName = this.settings.pipelines.find(p => p.id === preset.pipelineId)?.name ?? t('settings', 'kanbanNoPipeline');
		const filterName = this.settings.filterSets.find(entry => entry.id === preset.filterSetId)?.name ?? t('calendar', 'noFilter');
		const swimlaneLabel = this.getKanbanSwimlaneLabel(preset.swimlaneBy);
		const card = createSettingsListCard({
			containerEl: listEl,
			icon: 'square-kanban',
			title: presetName,
			className: 'operon-kanban-preset-card',
		});

		if (preset.id === this.settings.kanbanDefaultPresetId) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'star',
				label: t('settings', 'default'),
			});
		}
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'git-branch',
			label: pipelineName,
		});
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'filter',
			label: filterName,
		});
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'rows-3',
			label: swimlaneLabel,
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'moveUp'),
			ariaLabel: `${t('settings', 'moveUp')}: ${presetName}`,
			icon: 'arrow-up',
			disabled: index === 0,
			errorContext: 'settings kanban preset move up failed',
			onClick: async () => {
				await this.moveKanbanPreset(index, -1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'moveDown'),
			ariaLabel: `${t('settings', 'moveDown')}: ${presetName}`,
			icon: 'arrow-down',
			disabled: index === total - 1,
			errorContext: 'settings kanban preset move down failed',
			onClick: async () => {
				await this.moveKanbanPreset(index, 1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('tooltips', 'editKanbanPreset', { name: presetName }),
			ariaLabel: t('tooltips', 'editKanbanPreset', { name: presetName }),
			text: 'Edit',
			wide: true,
			onClick: () => {
				this.openKanbanPresetSettingsModal(preset.id, refresh);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'kanbanDuplicatePreset'),
			ariaLabel: `${t('settings', 'kanbanDuplicatePreset')}: ${presetName}`,
			icon: 'copy',
			errorContext: 'settings kanban preset duplicate failed',
			onClick: async () => {
				const copy: KanbanPreset = {
					...preset,
					id: createKanbanPresetId(),
					name: `${presetName} Copy`,
					sortRules: preset.sortRules.map(rule => ({ ...rule })),
				};
				this.settings.kanbanPresets.splice(index + 1, 0, copy);
				await this.saveSettings();
				await maybeCopyKanbanManualOrderForPresetDuplicate(preset, copy.id, this.copyKanbanManualOrder);
				this.display();
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'deletePresetConfirm'),
			ariaLabel: `${t('calendar', 'deletePresetConfirm')}: ${presetName}`,
			icon: 'trash-2',
			disabled: isOnlyPreset,
			danger: true,
			errorContext: 'settings kanban preset remove failed',
			onClick: async () => {
				if (this.settings.kanbanPresets.length === 1) {
					new Notice(t('settings', 'kanbanAtLeastOnePresetRequired'));
					return;
				}
				const confirmed = await this.confirmDeleteKanbanPreset(presetName);
				if (!confirmed) return;
				this.settings.kanbanPresets = this.settings.kanbanPresets.filter(entry => entry.id !== preset.id);
				if (!this.settings.kanbanPresets.some(entry => entry.id === this.settings.kanbanDefaultPresetId)) {
					this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
				}
				await this.saveSettings();
				await removeKanbanManualOrderForPresetDelete(preset.id, this.removeKanbanManualOrder);
				this.display();
			},
		});
	}

	private openKanbanPresetSettingsModal(presetId: string, refresh: () => void): void {
		new KanbanPresetQuickSettingsModal(this.app, {
			getSettings: () => this.settings,
			presetId,
			onSortModeChange: (nextPresetId, sortMode) => this.handleKanbanSortModeChange(nextPresetId, sortMode),
			onSave: async () => {
				await this.saveSettings();
				refresh();
			},
		}).open();
	}

	private renderKanbanPresetCard(containerEl: HTMLElement, preset: KanbanPreset, index: number): void {
		const isOnlyPreset = this.settings.kanbanPresets.length === 1;
		const isOpen = isOnlyPreset || this.expandedPresetIds.has(preset.id);
		const pipelineName = this.settings.pipelines.find(p => p.id === preset.pipelineId)?.name ?? t('settings', 'kanbanNoPipeline');
		const swimlaneLabel = this.getKanbanSwimlaneLabel(preset.swimlaneBy);
		const card = createSettingsCollapsibleCard({
			containerEl,
			cardId: `kanban-preset-${preset.id}`,
			title: preset.name || t('calendar', 'presetFallbackName', { number: String(index + 1) }),
			subtitle: `${pipelineName} · ${swimlaneLabel}`,
			isOpen,
			actions: [
				{
					type: 'icon',
					icon: 'arrow-up',
					label: t('calendar', 'movePresetUp'),
					disabled: index === 0,
					onClick: settingsAsyncHandler('settings kanban preset move up failed', async () => {
						if (index === 0) return;
						await this.moveKanbanPreset(index, -1);
					}),
				},
				{
					type: 'icon',
					icon: 'arrow-down',
					label: t('calendar', 'movePresetDown'),
					disabled: index === this.settings.kanbanPresets.length - 1,
					onClick: settingsAsyncHandler('settings kanban preset move down failed', async () => {
						if (index >= this.settings.kanbanPresets.length - 1) return;
						await this.moveKanbanPreset(index, 1);
					}),
				},
				{
					type: 'text',
					label: t('calendar', 'removePreset'),
					disabled: isOnlyPreset,
					onClick: settingsAsyncHandler('settings kanban preset remove failed', async () => {
						if (this.settings.kanbanPresets.length === 1) {
							new Notice(t('settings', 'kanbanAtLeastOnePresetRequired'));
							return;
						}
						const confirmed = await this.confirmDeleteKanbanPreset(preset.name || t('calendar', 'presetFallbackName', { number: String(index + 1) }));
						if (!confirmed) return;
						this.settings.kanbanPresets = this.settings.kanbanPresets.filter(entry => entry.id !== preset.id);
						if (!this.settings.kanbanPresets.some(entry => entry.id === this.settings.kanbanDefaultPresetId)) {
							this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
						}
						await this.saveSettings();
						this.display();
					}),
				},
			],
			onToggle: opening => {
				if (opening) {
					this.expandedPresetIds.add(preset.id);
				} else {
					this.expandedPresetIds.delete(preset.id);
				}
			},
		});
		const titleMain = card.titleEl;
		const bodyInner = card.bodyInnerEl;

		const nameSetting = new Setting(bodyInner)
			.setName(t('settings', 'kanbanPresetName'))
			.setDesc(t('settings', 'kanbanPresetNameDesc'))
			.addText(text => {
				text.setValue(preset.name);
				text.inputEl.addClass('operon-preset-name-input');
				text.onChange(async (value) => {
					const trimmed = value.trim() || t('settings', 'kanbanFallbackPresetName', { number: String(index + 1) });
					await this.updateKanbanPreset(preset.id, current => {
						current.name = trimmed;
					});
					titleMain.setText(trimmed);
				});
			});
		nameSetting.settingEl.addClass('operon-preset-name-setting');

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanPipeline'))
			.setDesc(t('settings', 'kanbanPipelineDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('', t('settings', 'kanbanNoPipeline'));
				for (const pipeline of this.settings.pipelines) {
					dropdown.addOption(pipeline.id, pipeline.name);
				}
				dropdown.setValue(preset.pipelineId ?? '');
				dropdown.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.pipelineId = value || null;
					});
				});
			});

		const currentFilter = this.settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		new Setting(bodyInner)
			.setName(t('settings', 'kanbanFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.onClick(() => {
					new CalendarFilterPickerModal(this.app, {
						filterSets: this.settings.filterSets,
						onChooseFilter: settingsAsyncHandler('settings kanban preset filter selection failed', async (filterSetId) => {
							await this.updateKanbanPreset(preset.id, current => {
								current.filterSetId = filterSetId;
							});
							this.display();
						}),
					}).open();
				});
			})
			.addButton(button => {
				button.setButtonText(t('calendar', 'clearFilter'));
				button.setDisabled(!preset.filterSetId);
				button.onClick(settingsAsyncHandler('settings kanban preset filter clear failed', async () => {
					await this.updateKanbanPreset(preset.id, current => {
						current.filterSetId = null;
					});
					this.display();
				}));
			});

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanSwimlaneField'))
			.setDesc(t('settings', 'kanbanSwimlaneFieldDesc'))
			.addDropdown(dropdown => {
				this.addKanbanSwimlaneOptions(dropdown);
				dropdown.setValue(preset.swimlaneBy ?? '');
				dropdown.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.swimlaneBy = this.parseKanbanSwimlaneBy(value);
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanTaskColorSource'))
			.setDesc(t('settings', 'kanbanTaskColorSourceDesc'))
			.addDropdown(dropdown => {
				addTaskColorSourceOptions(dropdown, KANBAN_TASK_COLOR_SOURCES);
				dropdown.setValue(preset.colorSource);
				dropdown.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.colorSource = normalizeTaskColorSource(value, KANBAN_TASK_COLOR_SOURCES, 'taskColor');
					});
				});
			});

		this.renderKanbanSortSection(bodyInner, preset);

		new Setting(bodyInner)
			.setName(t('calendar', 'appearanceLight'))
			.setDesc(t('calendar', 'appearanceLightDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_LIGHT_OPTIONS);
				dropdown.setValue(preset.appearanceModeLight);
				dropdown.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.appearanceModeLight = value as KanbanPreset['appearanceModeLight'];
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('calendar', 'appearanceDark'))
			.setDesc(t('calendar', 'appearanceDarkDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_DARK_OPTIONS);
				dropdown.setValue(preset.appearanceModeDark);
				dropdown.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.appearanceModeDark = value as KanbanPreset['appearanceModeDark'];
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanCollapseEmptyColumns'))
			.setDesc(t('settings', 'kanbanCollapseEmptyColumnsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.collapseEmptyColumns);
				toggle.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.collapseEmptyColumns = value;
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanCollapseEmptySwimlanes'))
			.setDesc(t('settings', 'kanbanCollapseEmptySwimlanesDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.collapseEmptySwimlanes);
				toggle.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.collapseEmptySwimlanes = value;
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('settings', 'kanbanAutoCollapseFinishedColumns'))
			.setDesc(t('settings', 'kanbanAutoCollapseFinishedColumnsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.autoCollapseFinishedColumns);
				toggle.onChange(async value => {
					await this.updateKanbanPreset(preset.id, current => {
						current.autoCollapseFinishedColumns = value;
					});
				});
			});
	}

	private renderKanbanSortSection(container: HTMLElement, preset: KanbanPreset): void {
		renderSettingsHeading(container, t('settings', 'kanbanSorting'));
		container.createDiv({
			text: t('settings', 'kanbanSortingDesc'),
			cls: 'setting-item-description',
		});
		this.renderKanbanSortModeControl(container, preset);
		if (preset.sortMode === 'manual') {
			this.renderKanbanManualSortMessage(container);
			return;
		}

		const section = container.createDiv('operon-kanban-sort-rules');

		preset.sortRules.forEach((rule, index) => {
			const row = section.createDiv('operon-kanban-sort-row');
			const ruleIndex = String(index + 1);

			row.createSpan({ text: t('settings', 'kanbanSortBy'), cls: 'operon-kanban-sort-label' });

			const fieldSelect = row.createEl('select', {
				cls: 'operon-kanban-sort-select',
			});
			setAccessibleLabelWithoutTooltip(
				fieldSelect,
				t('settings', 'kanbanSortFieldAria', { index: ruleIndex }),
			);
			for (const option of KANBAN_SORT_FIELD_OPTIONS) {
				fieldSelect.add(new Option(this.getKanbanSortFieldLabel(option), option.value));
			}
			fieldSelect.value = rule.field;
			fieldSelect.addEventListener('change', settingsAsyncHandler('settings kanban sort field change failed', async () => {
				await this.updateKanbanPreset(preset.id, current => {
					current.sortRules[index].field = fieldSelect.value as KanbanSortRule['field'];
				});
			}));

			const directionLabel = t('settings', 'kanbanSortDirectionAria', {
				index: ruleIndex,
				direction: this.formatKanbanSortDirection(rule.direction),
			});
			const directionButton = row.createEl('button', {
				text: this.formatKanbanSortDirection(rule.direction),
				cls: 'operon-kanban-sort-toggle',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(directionButton, directionLabel);
			applyOperonTooltip(directionButton, directionLabel);
			directionButton.addEventListener('click', settingsAsyncHandler('settings kanban sort direction change failed', async () => {
				await this.updateKanbanPreset(preset.id, current => {
					current.sortRules[index].direction = current.sortRules[index].direction === 'asc' ? 'desc' : 'asc';
				});
				this.display();
			}));

			const emptyLabel = t('settings', 'kanbanSortEmptyAria', {
				index: ruleIndex,
				placement: this.formatKanbanSortEmpty(rule.empty),
			});
			const emptyButton = row.createEl('button', {
				text: this.formatKanbanSortEmpty(rule.empty),
				cls: 'operon-kanban-sort-toggle',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(emptyButton, emptyLabel);
			applyOperonTooltip(emptyButton, emptyLabel);
			emptyButton.addEventListener('click', settingsAsyncHandler('settings kanban sort empty placement change failed', async () => {
				await this.updateKanbanPreset(preset.id, current => {
					current.sortRules[index].empty = current.sortRules[index].empty === 'last' ? 'first' : 'last';
				});
				this.display();
			}));

			const upLabel = t('settings', 'kanbanSortMoveUpAria', { index: ruleIndex });
			const upButton = row.createEl('button', {
				text: '↑',
				cls: 'operon-kanban-sort-icon-button',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(upButton, upLabel);
			upButton.disabled = index === 0;
			applyOperonTooltip(upButton, upLabel);
			upButton.addEventListener('click', settingsAsyncHandler('settings kanban sort move up failed', async () => {
				if (index === 0) return;
				await this.updateKanbanPreset(preset.id, current => {
					const [moved] = current.sortRules.splice(index, 1);
					current.sortRules.splice(index - 1, 0, moved);
				});
				this.display();
			}));

			const downLabel = t('settings', 'kanbanSortMoveDownAria', { index: ruleIndex });
			const downButton = row.createEl('button', {
				text: '↓',
				cls: 'operon-kanban-sort-icon-button',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(downButton, downLabel);
			downButton.disabled = index >= preset.sortRules.length - 1;
			applyOperonTooltip(downButton, downLabel);
			downButton.addEventListener('click', settingsAsyncHandler('settings kanban sort move down failed', async () => {
				if (index >= preset.sortRules.length - 1) return;
				await this.updateKanbanPreset(preset.id, current => {
					const [moved] = current.sortRules.splice(index, 1);
					current.sortRules.splice(index + 1, 0, moved);
				});
				this.display();
			}));

			const removeLabel = t('settings', 'kanbanSortRemoveAria', { index: ruleIndex });
			const removeButton = row.createEl('button', {
				text: '✕',
				cls: 'operon-kanban-sort-icon-button',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(removeButton, removeLabel);
			removeButton.disabled = preset.sortRules.length <= 1;
			applyOperonTooltip(removeButton, removeLabel);
			removeButton.addEventListener('click', settingsAsyncHandler('settings kanban sort remove failed', async () => {
				if (preset.sortRules.length <= 1) return;
				await this.updateKanbanPreset(preset.id, current => {
					current.sortRules.splice(index, 1);
				});
				this.display();
			}));
		});

		const addRow = section.createDiv('operon-kanban-sort-add-row');
		const addButton = addRow.createEl('button', {
			text: t('settings', 'kanbanAddSortField'),
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(addButton, t('settings', 'kanbanAddSortField'));
		applyOperonTooltip(addButton, t('settings', 'kanbanAddSortField'));
		addButton.addEventListener('click', settingsAsyncHandler('settings kanban sort add failed', async () => {
			await this.updateKanbanPreset(preset.id, current => {
				current.sortRules.push({
					field: 'alphabetical',
					direction: 'asc',
					empty: 'last',
				});
			});
			this.display();
		}));
	}

	private renderKanbanSortModeControl(container: HTMLElement, preset: KanbanPreset): void {
		const row = container.createDiv('operon-kanban-sort-mode-row');
		row.createSpan({ text: t('settings', 'kanbanSortMode'), cls: 'operon-kanban-sort-label' });
		const controls = row.createDiv('operon-kanban-sort-mode-control');
		this.renderKanbanSortModeButton(controls, preset, 'automatic');
		this.renderKanbanSortModeButton(controls, preset, 'manual');
	}

	private renderKanbanSortModeButton(
		container: HTMLElement,
		preset: KanbanPreset,
		sortMode: KanbanSortMode,
	): void {
		const button = container.createEl('button', {
			text: t('settings', sortMode === 'manual' ? 'kanbanSortModeManual' : 'kanbanSortModeAutomatic'),
			cls: 'operon-kanban-sort-mode-button',
			attr: {
				type: 'button',
				'aria-pressed': preset.sortMode === sortMode ? 'true' : 'false',
			},
		});
		button.classList.toggle('is-active', preset.sortMode === sortMode);
		button.addEventListener('click', settingsAsyncHandler('settings kanban sort mode change failed', async () => {
			if (preset.sortMode === sortMode) return;
			await this.updateKanbanPreset(preset.id, current => {
				current.sortMode = sortMode;
			});
			await this.handleKanbanSortModeChange(preset.id, sortMode);
			this.display();
		}));
	}

	private renderKanbanManualSortMessage(container: HTMLElement): void {
		const message = container.createDiv('operon-kanban-manual-sort-message');
		message.createDiv({ text: t('settings', 'kanbanManualOrderingActive') });
		message.createDiv({ text: t('settings', 'kanbanManualOrderingDesc') });
	}

	private formatKanbanSortDirection(direction: KanbanSortDirection): string {
		return direction === 'desc' ? t('settings', 'kanbanSortDesc') : t('settings', 'kanbanSortAsc');
	}

	private formatKanbanSortEmpty(empty: KanbanSortEmptyPlacement): string {
		return empty === 'first' ? t('settings', 'kanbanSortEmptyFirst') : t('settings', 'kanbanSortEmptyLast');
	}

	private renderCalendarPresetRow(
		listEl: HTMLElement,
		preset: CalendarPreset,
		index: number,
		refresh: () => void,
	): void {
		const total = this.settings.calendarPresets.length;
		const isOnlyPreset = total === 1;
		const presetName = preset.name.trim() || t('calendar', 'presetFallbackName', { number: String(index + 1) });
		const filterName = this.settings.filterSets.find(entry => entry.id === preset.filterSetId)?.name ?? t('calendar', 'noFilter');
		const card = createSettingsListCard({
			containerEl: listEl,
			icon: 'calendar',
			title: presetName,
			className: 'operon-calendar-preset-card',
		});

		if (preset.id === this.settings.calendarDefaultPresetId) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'star',
				label: t('settings', 'default'),
			});
		}
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: preset.surfaceType === 'multiWeek' ? 'calendar-range' : 'calendar-days',
			label: this.describeCalendarPreset(preset),
		});
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'filter',
			label: filterName,
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'movePresetUp'),
			ariaLabel: `${t('calendar', 'movePresetUp')}: ${presetName}`,
			icon: 'arrow-up',
			disabled: index === 0,
			errorContext: 'settings calendar preset move up failed',
			onClick: async () => {
				await this.moveCalendarPreset(index, -1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'movePresetDown'),
			ariaLabel: `${t('calendar', 'movePresetDown')}: ${presetName}`,
			icon: 'arrow-down',
			disabled: index === total - 1,
			errorContext: 'settings calendar preset move down failed',
			onClick: async () => {
				await this.moveCalendarPreset(index, 1);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'editPreset', { name: presetName }),
			ariaLabel: t('calendar', 'editPreset', { name: presetName }),
			text: 'Edit',
			wide: true,
			onClick: () => {
				this.openCalendarPresetSettingsModal(preset.id, refresh);
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'duplicatePreset'),
			ariaLabel: `${t('calendar', 'duplicatePreset')}: ${presetName}`,
			icon: 'copy',
			errorContext: 'settings calendar preset duplicate failed',
			onClick: async () => {
				const copy: CalendarPreset = {
					...preset,
					id: createCalendarPresetId(),
					name: `${presetName} Copy`,
					externalCalendarVisibility: { ...preset.externalCalendarVisibility },
				};
				this.settings.calendarPresets.splice(index + 1, 0, copy);
				await this.saveSettings();
				this.display();
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'deletePresetConfirm'),
			ariaLabel: `${t('calendar', 'deletePresetConfirm')}: ${presetName}`,
			icon: 'trash-2',
			disabled: isOnlyPreset,
			danger: true,
			errorContext: 'settings calendar preset remove failed',
			onClick: async () => {
				if (this.settings.calendarPresets.length === 1) {
					new Notice(t('calendar', 'atLeastOneCalendarPresetRequired'));
					return;
				}
				const confirmed = await this.confirmDeleteCalendarPreset(presetName);
				if (!confirmed) return;
				this.settings.calendarPresets = this.settings.calendarPresets.filter(entry => entry.id !== preset.id);
				if (!this.settings.calendarPresets.some(entry => entry.id === this.settings.calendarDefaultPresetId)) {
					this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
				}
				await this.saveSettings();
				this.display();
			},
		});
	}

	private openCalendarPresetSettingsModal(presetId: string, refresh: () => void): void {
		new CalendarPresetQuickSettingsModal(this.app, {
			getSettings: () => this.settings,
			presetId,
			onSave: async () => {
				await this.saveSettings();
				refresh();
			},
		}).open();
	}

	private renderCalendarPresetCard(containerEl: HTMLElement, preset: CalendarPreset, index: number): void {
		const isOnlyPreset = this.settings.calendarPresets.length === 1;
		const isOpen = isOnlyPreset || this.expandedCalendarPresetIds.has(preset.id);
		const card = createSettingsCollapsibleCard({
			containerEl,
			cardId: `calendar-preset-${preset.id}`,
			title: preset.name || t('calendar', 'presetFallbackName', { number: String(index + 1) }),
			subtitle: this.describeCalendarPreset(preset),
			isOpen,
			actions: [
				{
					type: 'icon',
					icon: 'arrow-up',
					label: t('calendar', 'movePresetUp'),
					disabled: index === 0,
					onClick: settingsAsyncHandler('settings calendar preset move up failed', async () => {
						if (index === 0) return;
						await this.moveCalendarPreset(index, -1);
					}),
				},
				{
					type: 'icon',
					icon: 'arrow-down',
					label: t('calendar', 'movePresetDown'),
					disabled: index === this.settings.calendarPresets.length - 1,
					onClick: settingsAsyncHandler('settings calendar preset move down failed', async () => {
						if (index >= this.settings.calendarPresets.length - 1) return;
						await this.moveCalendarPreset(index, 1);
					}),
				},
				{
					type: 'text',
					label: t('calendar', 'removePreset'),
					disabled: isOnlyPreset,
					onClick: settingsAsyncHandler('settings calendar preset remove failed', async () => {
						if (this.settings.calendarPresets.length === 1) {
							new Notice(t('calendar', 'atLeastOneCalendarPresetRequired'));
							return;
						}
						const confirmed = await this.confirmDeleteCalendarPreset(preset.name || t('calendar', 'presetFallbackName', { number: String(index + 1) }));
						if (!confirmed) return;
						this.settings.calendarPresets = this.settings.calendarPresets.filter(entry => entry.id !== preset.id);
						if (!this.settings.calendarPresets.some(entry => entry.id === this.settings.calendarDefaultPresetId)) {
							this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
						}
						await this.saveSettings();
						this.display();
					}),
				},
			],
			onToggle: opening => {
				if (opening) {
					this.expandedCalendarPresetIds.add(preset.id);
				} else {
					this.expandedCalendarPresetIds.delete(preset.id);
				}
			},
		});
		const titleMain = card.titleEl;
		const titleSub = card.subtitleEl;
		const bodyInner = card.bodyInnerEl;

		const nameSetting = new Setting(bodyInner)
			.setName(t('calendar', 'presetName'))
			.setDesc(t('calendar', 'presetNameDesc'))
			.addText(text => {
				text.setValue(preset.name);
				text.inputEl.addClass('operon-preset-name-input');
				text.onChange(async (value) => {
					const trimmed = value.trim() || t('calendar', 'presetFallbackName', { number: String(index + 1) });
					await this.updateCalendarPreset(preset.id, current => {
						current.name = trimmed;
					});
					titleMain.setText(trimmed);
					titleSub.setText(this.describeCalendarPreset(preset));
				});
			});
		nameSetting.settingEl.addClass('operon-preset-name-setting');

		new Setting(bodyInner)
			.setName(t('calendar', 'calendarPresetType'))
			.setDesc(t('calendar', 'calendarPresetTypeDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('timeGrid', t('calendar', 'timeGrid'));
				dropdown.addOption('multiWeek', t('calendar', 'multiWeek'));
				dropdown.setValue(preset.surfaceType);
				dropdown.onChange(async value => {
					if (value !== 'timeGrid' && value !== 'multiWeek') return;
					await this.updateCalendarPreset(preset.id, current => {
						current.surfaceType = value;
						current.weekCount = this.normalizeCalendarPresetWeekCount(current.weekCount);
					});
					this.display();
				});
			});

		if (preset.surfaceType === 'multiWeek') {
			new Setting(bodyInner)
				.setName(t('calendar', 'weekCount'))
				.setDesc(t('calendar', 'weekCountDesc'))
				.addDropdown(dropdown => {
					dropdown.addOption('1', '1');
					dropdown.addOption('2', '2');
					dropdown.addOption('3', '3');
					dropdown.addOption('4', '4');
					dropdown.addOption('5', '5');
					dropdown.addOption('6', '6');
					dropdown.setValue(String(this.normalizeCalendarPresetWeekCount(preset.weekCount)));
					dropdown.onChange(async value => {
						const nextValue = this.normalizeCalendarPresetWeekCount(Number.parseInt(value, 10));
						await this.updateCalendarPreset(preset.id, current => {
							current.weekCount = nextValue;
						});
						this.display();
					});
				});
			new Setting(bodyInner)
				.setName(t('calendar', 'focusedWeekNumber'))
				.setDesc(t('calendar', 'focusedWeekNumberDesc'))
				.addDropdown(dropdown => {
					const weekCount = this.normalizeCalendarPresetWeekCount(preset.weekCount);
					for (let week = 1; week <= weekCount; week++) {
						dropdown.addOption(String(week), String(week));
					}
					dropdown.setValue(String(this.normalizeCalendarPresetFocusedWeekNumber(preset.focusedWeekNumber, weekCount)));
					dropdown.onChange(async value => {
						const nextValue = this.normalizeCalendarPresetFocusedWeekNumber(
							Number.parseInt(value, 10),
							this.normalizeCalendarPresetWeekCount(preset.weekCount),
						);
						await this.updateCalendarPreset(preset.id, current => {
							current.focusedWeekNumber = nextValue;
						});
						this.display();
					});
				});
		} else {
			new Setting(bodyInner)
				.setName(t('calendar', 'visibleDayCount'))
				.setDesc(t('calendar', 'visibleDayCountDesc'))
				.addText(text => {
					text.inputEl.type = 'number';
					text.inputEl.min = '1';
					text.inputEl.max = '31';
					text.setValue(String(preset.dayCount));
					text.onChange(async (value) => {
						const nextValue = this.parseCalendarPresetNumber(value, preset.dayCount, 1, 31);
						if (text.inputEl.value !== String(nextValue)) {
							text.setValue(String(nextValue));
						}
						await this.updateCalendarPreset(preset.id, current => {
							current.dayCount = nextValue;
						});
						titleSub.setText(this.describeCalendarPreset(preset));
					});
				});

			new Setting(bodyInner)
				.setName(t('calendar', 'todayPosition'))
				.setDesc(t('calendar', 'todayPositionDesc'))
				.addDropdown(dropdown => {
					for (let position = 1; position <= Math.max(1, preset.dayCount); position++) {
						dropdown.addOption(String(position), String(position));
					}
					dropdown.setValue(String(Math.min(preset.dayCount, preset.todayPosition)));
					dropdown.onChange(async value => {
						const nextValue = this.parseCalendarPresetNumber(value, preset.todayPosition, 1, Math.max(1, preset.dayCount));
						await this.updateCalendarPreset(preset.id, current => {
							current.todayPosition = Math.min(current.dayCount, nextValue);
						});
						this.display();
					});
				});

			new Setting(bodyInner)
				.setName(t('calendar', 'slotMinutes'))
				.setDesc(t('calendar', 'slotMinutesDesc'))
				.addDropdown(dropdown => {
					dropdown.addOption('15', '15');
					dropdown.addOption('30', '30');
					dropdown.addOption('60', '60');
					const currentValue = ['15', '30', '60'].includes(String(preset.slotMinutes))
						? String(preset.slotMinutes)
						: '30';
					dropdown.setValue(currentValue);
					dropdown.onChange(async value => {
						const nextValue = this.parseCalendarPresetNumber(value, preset.slotMinutes, 15, 60);
						await this.updateCalendarPreset(preset.id, current => {
							current.slotMinutes = nextValue <= 15 ? 15 : nextValue >= 60 ? 60 : 30;
						});
						titleSub.setText(this.describeCalendarPreset(preset));
					});
				});
		}

		const currentFilter = this.settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		new Setting(bodyInner)
			.setName(t('calendar', 'calendarFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.onClick(() => {
					new CalendarFilterPickerModal(this.app, {
						filterSets: this.settings.filterSets,
						onChooseFilter: settingsAsyncHandler('settings calendar preset filter selection failed', async (filterSetId) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.filterSetId = filterSetId;
							});
							this.display();
						}),
					}).open();
				});
			})
			.addButton(button => {
				button.setButtonText(t('calendar', 'clearFilter'));
				button.setDisabled(!preset.filterSetId);
				button.onClick(settingsAsyncHandler('settings calendar preset filter clear failed', async () => {
					await this.updateCalendarPreset(preset.id, current => {
						current.filterSetId = null;
					});
					this.display();
				}));
			});

		if (preset.surfaceType === 'timeGrid') {
			this.renderHiddenTimeSetting(bodyInner, preset);
		}

		new Setting(bodyInner)
			.setName(t('calendar', 'taskColorSource'))
			.setDesc(t('calendar', 'taskColorSourceDesc'))
			.addDropdown(dropdown => {
				addTaskColorSourceOptions(dropdown, CALENDAR_TASK_COLOR_SOURCES);
				dropdown.setValue(preset.colorSource);
				dropdown.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.colorSource = normalizeTaskColorSource(value, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('calendar', 'appearanceLight'))
			.setDesc(t('calendar', 'appearanceLightDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_LIGHT_OPTIONS);
				dropdown.setValue(preset.appearanceModeLight);
				dropdown.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.appearanceModeLight = value as CalendarPreset['appearanceModeLight'];
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('calendar', 'appearanceDark'))
			.setDesc(t('calendar', 'appearanceDarkDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_DARK_OPTIONS);
				dropdown.setValue(preset.appearanceModeDark);
				dropdown.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.appearanceModeDark = value as CalendarPreset['appearanceModeDark'];
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('calendar', 'showWeekends'))
			.setDesc(t('calendar', 'showWeekendsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showWeekends);
				toggle.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.showWeekends = value;
					});
				});
			});

		const externalCalendars = this.settings.externalCalendars;
		if (externalCalendars.length > 0) {
			renderSettingsHeading(bodyInner, t('calendar', 'externalCalendarsSection'), 'operon-preset-settings-section-heading');
			for (const source of externalCalendars) {
				const isVisible = preset.externalCalendarVisibility[source.id] === true;
				new Setting(bodyInner)
					.setName(source.name || source.url)
					.addToggle(toggle => {
						toggle.setValue(isVisible);
						toggle.onChange(async (value) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.externalCalendarVisibility[source.id] = value;
							});
						});
					});
			}
		}
	}

	private parseCalendarPresetNumber(
		value: string,
		fallback: number,
		min: number,
		max: number,
		step = 1,
	): number {
		return parsePresetNumber(value, fallback, min, max, step);
	}

	private formatCalendarTimeGridScaleLabel(scale: number): string {
		const normalized = scale / 2;
		if (normalized < 1) return normalized.toFixed(2);
		return normalized.toFixed(2).replace(/\.?0+$/u, '');
	}

	private normalizeCalendarPresetWeekCount(value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
		if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
		return Math.max(1, Math.min(6, Math.round(value))) as 1 | 2 | 3 | 4 | 5 | 6;
	}

	private normalizeCalendarPresetFocusedWeekNumber(
		value: number | undefined,
		weekCount: 1 | 2 | 3 | 4 | 5 | 6,
	): 1 | 2 | 3 | 4 | 5 | 6 {
		if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
		return Math.max(1, Math.min(weekCount, Math.round(value))) as 1 | 2 | 3 | 4 | 5 | 6;
	}

	private describeCalendarPreset(preset: CalendarPreset): string {
		if (preset.surfaceType === 'multiWeek') {
			return t('calendar', 'presetSummaryMultiWeek', {
				count: String(this.normalizeCalendarPresetWeekCount(preset.weekCount)),
			});
		}
		return t('calendar', 'presetSummaryTimeGrid', {
			count: String(preset.dayCount),
			minutes: String(preset.slotMinutes),
		});
	}

	private async updateCalendarPreset(
		presetId: string,
		update: (preset: CalendarPreset) => void,
	): Promise<void> {
		const preset = this.settings.calendarPresets.find(entry => entry.id === presetId);
		if (!preset) return;
		update(preset);
		preset.surfaceType = preset.surfaceType === 'multiWeek' ? 'multiWeek' : 'timeGrid';
		preset.weekCount = this.normalizeCalendarPresetWeekCount(preset.weekCount);
		preset.focusedWeekNumber = this.normalizeCalendarPresetFocusedWeekNumber(preset.focusedWeekNumber, preset.weekCount);
		preset.todayPosition = Math.max(1, Math.min(preset.dayCount, preset.todayPosition));
		await this.saveSettings();
	}

	private async updateKanbanPreset(
		presetId: string,
		update: (preset: KanbanPreset) => void,
	): Promise<void> {
		const preset = this.settings.kanbanPresets.find(entry => entry.id === presetId);
		if (!preset) return;
		update(preset);
		await this.saveSettings();
	}

	private addKanbanSwimlaneOptions(dropdown: import('obsidian').DropdownComponent): void {
		dropdown.addOption('', t('settings', 'kanbanNoSwimlane'));
		dropdown.addOption('priority', this.getKanbanSwimlaneLabel('priority'));
		dropdown.addOption('tags', this.getKanbanSwimlaneLabel('tags'));
		dropdown.addOption('contexts', this.getKanbanSwimlaneLabel('contexts'));
		dropdown.addOption('assignees', this.getKanbanSwimlaneLabel('assignees'));
		dropdown.addOption('dateDue', this.getKanbanSwimlaneLabel('dateDue'));
		dropdown.addOption('dateScheduled', this.getKanbanSwimlaneLabel('dateScheduled'));
	}

	private getKanbanSwimlaneLabel(value: KanbanSwimlaneBy | null): string {
		if (!value) return t('settings', 'kanbanNoSwimlane');
		return t('settings', `kanbanSwimlane_${value}`);
	}

	private getKanbanSortFieldLabel(option: typeof KANBAN_SORT_FIELD_OPTIONS[number]): string {
		const key = `kanbanSortField_${option.value}`;
		const localized = t('settings', key);
		return localized === key ? option.label : localized;
	}

	private parseKanbanSwimlaneBy(value: string): KanbanSwimlaneBy | null {
		return value === 'priority'
			|| value === 'tags'
			|| value === 'contexts'
			|| value === 'assignees'
			|| value === 'dateDue'
			|| value === 'dateScheduled'
			? value
			: null;
	}

	private renderHiddenTimeSetting(container: HTMLElement, preset: CalendarPreset): void {
		const setting = new Setting(container)
			.setName(t('calendar', 'hiddenTime'))
			.setDesc(t('calendar', 'hiddenTimeDesc'));

		setting.addButton(button => {
			button.setButtonText(t('calendar', 'hiddenTimeStart', { time: this.formatCalendarTimeLabel(preset.hiddenTimeStart) }));
			button.onClick(() => {
				showTimePicker(button.buttonEl, {
					app: this.app,
					settings: this.settings,
					value: preset.hiddenTimeStart,
						onSelect: settingsAsyncHandler('settings calendar hidden time start change failed', async (value) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.hiddenTimeStart = value;
							});
							this.display();
						}),
				});
			});
		});

		setting.addButton(button => {
			button.setButtonText(t('calendar', 'hiddenTimeEnd', { time: this.formatCalendarTimeLabel(preset.hiddenTimeEnd) }));
			button.onClick(() => {
				showTimePicker(button.buttonEl, {
					app: this.app,
					settings: this.settings,
					value: preset.hiddenTimeEnd,
						onSelect: settingsAsyncHandler('settings calendar hidden time end change failed', async (value) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.hiddenTimeEnd = value;
							});
							this.display();
						}),
				});
			});
		});
	}

	private formatCalendarTimeLabel(value: string): string {
		if (!/^\d{2}:\d{2}$/.test(value)) return '00:00';
		return value;
	}

	private renderStateIconSetting(
		containerEl: HTMLElement,
		key: keyof OperonSettings['fallbackStateIcons'],
		name: string,
		desc: string,
	): void {
		const getValue = () => normalizeTaskIconValue(this.settings.fallbackStateIcons[key]);
		const setValue = async (value: string) => {
			this.settings.fallbackStateIcons[key] = normalizeTaskIconValue(value);
			await this.saveSettings();
		};

		renderSettingsIconPickerRow({
			containerEl,
			name,
			desc,
			value: getValue(),
			placeholder: t('settings', 'searchLucideIconPlaceholder'),
			tooltip: t('settings', 'searchLucideIconPlaceholder'),
			settingClass: 'operon-state-icon-setting',
			errorContext: 'settings fallback state icon change failed',
			onChange: async value => {
				await setValue(value);
			},
		});
	}

	/**
	 * Pipelines tab — pipeline groups with status definitions (Spec 5.3.2-5.3.4).
	 */
	private renderPipelinesTab(containerEl: HTMLElement): void {
		const refresh = () => { containerEl.empty(); this.renderPipelinesTab(containerEl); };
		// Explanation
		renderSettingsInfoBox(containerEl, t('settings', 'pipelinesTitle'), t('settings', 'pipelinesDesc'));

		// Render each pipeline card
		for (let i = 0; i < this.settings.pipelines.length; i++) {
			this.renderPipelineCard(containerEl, this.settings.pipelines[i], i, refresh);
		}

		createWorkflowInlineAddRow({
			containerEl,
			rowClass: 'operon-pipeline-add-row',
			inputClass: 'operon-pipeline-add-input',
			buttonLabel: t('settings', 'addPipeline'),
			placeholder: t('settings', 'newPipelineNamePlaceholder'),
			errorContext: 'settings pipeline add failed',
			onSubmit: async (value) => {
				const trimmed = value.trim();
				if (!trimmed) return;
				if (this.settings.pipelines.some(p => p.name === trimmed)) {
					new Notice(t('settings', 'pipelineAlreadyExists', { name: trimmed }));
					return;
				}
				this.settings.pipelines.push({
					id: createPipelineId(),
					name: trimmed,
					statuses: [
						{ id: createStatusId(), label: t('settings', 'defaultStatusOpen'), color: '#808080', isFinished: false, isCancelled: false, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
						{ id: createStatusId(), label: t('settings', 'defaultStatusDone'), color: '#2ECC71', isFinished: true, isCancelled: false, isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null },
					],
				});
				if (!this.settings.defaultPipelineName) {
					this.settings.defaultPipelineName = trimmed;
				}
				await this.saveSettings();
				refresh();
			},
		});
	}

	/**
	 * Priority tab — ordered list of priority definitions with label + color.
	 * Index 0 = highest importance.
	 */
	private renderPriorityTab(containerEl: HTMLElement): void {
		const committedPriorities = this.settings.priorities.map(priority => clonePriorityDefinition(priority));
		const priorityCounts = this.buildPriorityCounts();

		// Info box
		renderSettingsInfoBox(containerEl, t('settings', 'priorityTitle'), t('settings', 'priorityDesc'));

		// Priority rows
		const listEl = containerEl.createDiv();
		createWorkflowGridHeader({
			containerEl: listEl,
			className: 'operon-priority-column-header',
			labels: [
				t('settings', 'pipelineColumnColor'),
				t('settings', 'priorityColumnLabel'),
				t('settings', 'pipelineColumnStats'),
				'',
			],
		});

		const rowsEl = listEl.createDiv();
		const renderRows = () => {
			containerEl.empty();
			this.renderPriorityTab(containerEl);
		};
		for (let i = 0; i < this.settings.priorities.length; i++) {
			this.renderPriorityRow(rowsEl, this.settings.priorities[i], committedPriorities, i, priorityCounts, renderRows);
		}
		const refresh = renderRows;

		createWorkflowActionButton({
			containerEl,
			text: t('settings', 'addPriority'),
			label: t('settings', 'addPriority'),
			className: 'operon-settings-primary-button operon-settings-spaced-top',
			errorContext: 'settings priority add failed',
			onClick: async () => {
				const label = createUniqueTaxonomyLabel(
					t('settings', 'newPriorityLabel'),
					this.settings.priorities.map(priority => priority.label),
				);
				this.settings.priorities.push({ id: createPriorityId(), label, color: '#6b7280' });
				await this.saveSettings();
				refresh();
			},
		});

		// Default priority for new tasks
		const defaultSection = containerEl.createDiv('operon-priority-default-section');

		new Setting(defaultSection)
			.setName(t('settings', 'defaultPriority'))
			.setDesc(t('settings', 'defaultPriorityDesc'))
			.addDropdown(dd => {
				dd.addOption('', t('taskEditor', 'priorityNone'));
				for (const p of this.settings.priorities) {
					dd.addOption(p.label, p.label.charAt(0).toUpperCase() + p.label.slice(1));
				}
				dd.setValue(this.settings.defaultPriority ?? '');
				dd.onChange(async val => {
					this.settings.defaultPriority = val;
					await this.saveSettings();
				});
			});
	}

	/**
	 * Render a single priority row: color swatch + label input + stats + reorder + delete.
	 */
	private renderPriorityRow(
		listEl: HTMLElement,
		priority: PriorityDefinition,
		committedPriorities: PriorityDefinition[],
		index: number,
		priorityCounts: Map<string, number>,
		refresh: () => void,
	): void {
		const committedPriority = committedPriorities.find(candidate => candidate.id === priority.id) ?? clonePriorityDefinition(priority);
		const row = listEl.createDiv('operon-priority-row');

		createWorkflowColorSwatch({
			containerEl: row,
			value: priority.color,
			label: t('settings', 'priorityColorAria', { name: priority.label }),
			errorContext: 'settings priority color change failed',
			onChange: async (value) => {
				priority.color = value;
				await this.saveSettings();
			},
		});

		// Label input
		const labelInput = createWorkflowInput({
			containerEl: row,
			type: 'text',
			className: 'operon-settings-text-input',
			label: t('settings', 'priorityNameAria', { name: priority.label }),
		});
		labelInput.value = priority.label;
		labelInput.addEventListener('change', settingsAsyncHandler('settings priority label change failed', async () => {
			const trimmed = labelInput.value.trim();
			if (!trimmed) {
				labelInput.value = committedPriority.label;
				return;
			}
			if (trimmed === committedPriority.label) {
				labelInput.value = committedPriority.label;
				return;
			}
			if (hasDuplicatePriorityLabel(this.settings.priorities, priority.id, trimmed)) {
				new Notice(t('settings', 'priorityAlreadyExists', { name: trimmed }));
				labelInput.value = committedPriority.label;
				return;
			}
			const nextPriorities = this.settings.priorities.map(candidate => clonePriorityDefinition(candidate));
			const nextPriority = nextPriorities.find(candidate => candidate.id === priority.id);
			if (!nextPriority) {
				labelInput.value = committedPriority.label;
				return;
			}
			nextPriority.label = trimmed;
			await this.commitPriorityDraft(committedPriorities, nextPriorities, refresh, () => {
				labelInput.value = committedPriority.label;
			});
		}));

		const statsCell = row.createDiv('operon-settings-stats-cell');
		statsCell.setText(String(priorityCounts.get(priority.label) ?? 0));

		const actionsCell = row.createDiv('operon-settings-action-cell operon-settings-action-cell-spaced');

		const upDisabled = index === 0;
		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'arrow-up',
			label: t('settings', 'moveUp'),
			className: 'operon-settings-small-secondary-button',
			disabled: upDisabled,
			errorContext: 'settings priority move up failed',
			onClick: async () => {
				if (index === 0) return;
				const arr = this.settings.priorities;
				[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
				await this.saveSettings();
				refresh();
			},
		});

		const isLast = index === this.settings.priorities.length - 1;
		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'arrow-down',
			label: t('settings', 'moveDown'),
			className: 'operon-settings-small-secondary-button',
			disabled: isLast,
			errorContext: 'settings priority move down failed',
			onClick: async () => {
				if (isLast) return;
				const arr = this.settings.priorities;
				[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
				await this.saveSettings();
				refresh();
			},
		});

		const deleteDisabled = this.settings.priorities.length <= 1;
		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'trash-2',
			label: t('settings', 'deletePriority'),
			className: 'operon-settings-small-secondary-button',
			disabled: deleteDisabled,
			danger: true,
			errorContext: 'settings priority delete failed',
			onClick: async () => {
				if (this.settings.priorities.length <= 1) return;
				const confirmed = await this.confirmDeletePriority(priority.label);
				if (!confirmed) return;
				const deletedPriorityLabel = priority.label;
				this.settings.priorities.splice(index, 1);
				this.settings.defaultPriority = resolveDefaultPriorityAfterDelete(
					this.settings.defaultPriority,
					deletedPriorityLabel,
					this.settings.priorities,
				);
				await this.saveSettings();
				refresh();
			},
		});
	}

	private buildPriorityCounts(): Map<string, number> {
		const counts = new Map<string, number>();
		if (!this.indexer) return counts;

		for (const priority of this.settings.priorities) {
			counts.set(priority.label, this.indexer.secondary.getTaskIdsByPriority(priority.label).size);
		}

		return counts;
	}

	private async commitPriorityDraft(
		committedPriorities: PriorityDefinition[],
		nextPriorities: PriorityDefinition[],
		refresh: () => void,
		onCancel: () => void,
	): Promise<void> {
		const plan = buildPriorityRenamePlan(committedPriorities, nextPriorities);
		const preview = this.indexer
			? collectPriorityRenamePreview(this.indexer, plan)
			: {
				plan,
				affectedTasks: [],
				fileTaskCount: 0,
				inlineTaskCount: 0,
				touchedFileCount: 0,
				totalTaskCount: 0,
			};

		if (preview.totalTaskCount > 0) {
			const confirmed = await this.confirmPriorityRenameMigration(preview);
			if (!confirmed) {
				onCancel();
				return;
			}
		}

		this.settings.priorities = nextPriorities;
		this.settings.defaultPriority = applyPriorityRenamePlanToDefaultPriority(this.settings.defaultPriority, plan);

		await this.persistSettingsOnly();
		try {
			if (preview.totalTaskCount > 0) {
				await this.applyPriorityRenameMigration(preview);
			}
		} catch (error) {
			console.error('Operon: priority rename migration failed unexpectedly', error);
			new Notice(t('settings', 'priorityRenameMigrationUnexpectedError'));
		}

		this.notifySettingsChanged();
		refresh();
	}

	private async confirmPriorityRenameMigration(preview: PriorityRenamePreview): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'priorityRenameMigrationTitle'),
				message: t('settings', 'priorityRenameMigrationMessage', {
					fileTaskCount: String(preview.fileTaskCount),
					inlineTaskCount: String(preview.inlineTaskCount),
					touchedFileCount: String(preview.touchedFileCount),
				}),
				confirmText: t('buttons', 'confirm'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	/**
	 * Render a single pipeline card with its status list.
	 */
	private renderPipelineCard(containerEl: HTMLElement, pipeline: Pipeline, pipelineIndex: number, refresh: () => void): void {
		const committedPipeline = clonePipeline(pipeline);
		const statusCounts = this.buildPipelineStatusCounts(pipeline);
		const card = containerEl.createDiv('operon-pipeline-card');

		// Pipeline header row
		const headerRow = card.createDiv('operon-pipeline-header-row');

		const nameInput = createWorkflowInput({
			containerEl: headerRow,
			type: 'text',
			className: 'operon-pipeline-name-input',
			label: t('settings', 'pipelineNameAria', { name: pipeline.name }),
		});
		nameInput.value = pipeline.name;
		nameInput.addEventListener('change', settingsAsyncHandler('settings pipeline name change failed', async () => {
			const trimmed = nameInput.value.trim();
			if (!trimmed) {
				nameInput.value = committedPipeline.name;
				return;
			}
			if (trimmed === committedPipeline.name) {
				nameInput.value = committedPipeline.name;
				return;
			}
			if (this.settings.pipelines.some((p, i) => i !== pipelineIndex && p.name === trimmed)) {
				new Notice(t('settings', 'pipelineAlreadyExists', { name: trimmed }));
				nameInput.value = committedPipeline.name;
				return;
			}
			const nextPipelineDraft = buildPipelineNameDraft(this.settings.pipelines[pipelineIndex] ?? pipeline, trimmed);
			await this.commitPipelineDraft(pipelineIndex, committedPipeline, nextPipelineDraft, refresh, () => {
				nameInput.value = committedPipeline.name;
			});
		}));

		const defaultWrapper = headerRow.createDiv('operon-pipeline-default-wrapper');

		const defaultRadio = createWorkflowInput({
			containerEl: defaultWrapper,
			type: 'radio',
			className: 'operon-pipeline-default-radio',
			name: 'operon-default-pipeline',
			label: t('settings', 'defaultPipelineAria', { name: pipeline.name }),
		});
		defaultRadio.checked = this.settings.defaultPipelineName === pipeline.name;
		defaultRadio.addEventListener('change', settingsAsyncHandler('settings default pipeline change failed', async () => {
			if (!defaultRadio.checked) return;
			this.settings.defaultPipelineName = pipeline.name;
			await this.saveSettings();
			refresh();
		}));

		defaultWrapper.createSpan({ text: t('settings', 'default') });

		// Spacer
		headerRow.createDiv('operon-pipeline-header-spacer');

		createWorkflowActionButton({
			containerEl: headerRow,
			text: t('settings', 'deletePipeline'),
			label: t('settings', 'deletePipeline'),
			className: 'operon-settings-danger-outline-button',
			danger: true,
			errorContext: 'settings pipeline delete failed',
			onClick: async () => {
				const confirmed = await this.confirmDeletePipeline(pipeline.name);
				if (!confirmed) return;
				const deletedWasDefault = this.settings.defaultPipelineName === pipeline.name;
				this.settings.pipelines.splice(pipelineIndex, 1);
				if (deletedWasDefault) {
					this.settings.defaultPipelineName = this.settings.pipelines[0]?.name ?? '';
				} else if (!this.settings.pipelines.some(candidate => candidate.name === this.settings.defaultPipelineName)) {
					this.settings.defaultPipelineName = this.settings.pipelines[0]?.name ?? '';
				}
				await this.saveSettings();
				refresh();
			},
		});

		createWorkflowGridHeader({
			containerEl: card,
			className: 'operon-status-column-header',
			labels: [
				t('settings', 'pipelineColumnColor'),
				t('settings', 'pipelineColumnStatusLabel'),
				t('settings', 'pipelineColumnStats'),
				t('settings', 'pipelineColumnScheduled'),
				t('settings', 'pipelineColumnTracking'),
				t('settings', 'pipelineColumnFinished'),
				t('settings', 'pipelineColumnCancelled'),
				'',
			],
		});

		// Status rows
		const statusList = card.createDiv('operon-status-list');

		for (let si = 0; si < pipeline.statuses.length; si++) {
			this.renderStatusRow(statusList, pipeline, committedPipeline, pipelineIndex, si, statusCounts, refresh);
		}

		createWorkflowActionButton({
			containerEl: card,
			text: t('settings', 'addStatus'),
			label: t('settings', 'addStatus'),
			className: 'operon-status-add-button operon-settings-accent-hover-button',
			errorContext: 'settings pipeline status add failed',
			onClick: async () => {
				const label = createUniqueTaxonomyLabel(
					t('settings', 'newStatusLabel'),
					pipeline.statuses.map(status => status.label),
				);
				pipeline.statuses.push({
					id: createStatusId(),
					label,
					color: '#808080',
					isFinished: false,
					isCancelled: false,
					isScheduledTarget: false,
					isTrackingTarget: false,
					propertyMapping: null,
				});
				await this.saveSettings();
				refresh();
			},
		});
	}

	/**
	 * Render a single status row within a pipeline card.
	 */
	private renderStatusRow(
		containerEl: HTMLElement,
		pipeline: Pipeline,
		committedPipeline: Pipeline,
		pipelineIndex: number,
		statusIndex: number,
		statusCounts: Map<string, number>,
		refresh: () => void,
	): void {
		const status = pipeline.statuses[statusIndex];
		const row = containerEl.createDiv('operon-status-row');

		createWorkflowColorSwatch({
			containerEl: row,
			value: status.color,
			label: t('settings', 'statusColorAria', { pipeline: pipeline.name, status: status.label }),
			errorContext: 'settings pipeline status color change failed',
			onChange: async (value) => {
				status.color = value;
				await this.saveSettings();
			},
		});

		// Label input
		const labelInput = createWorkflowInput({
			containerEl: row,
			type: 'text',
			className: 'operon-status-label-input',
			label: t('settings', 'statusNameAria', { pipeline: pipeline.name, status: status.label }),
		});
		labelInput.value = status.label;
		labelInput.addEventListener('change', settingsAsyncHandler('settings pipeline status label change failed', async () => {
			const committedStatus = committedPipeline.statuses.find(candidate => candidate.id === status.id) ?? status;
			const trimmed = labelInput.value.trim();
			if (!trimmed) {
				labelInput.value = committedStatus.label;
				return;
			}
			if (trimmed === committedStatus.label) {
				labelInput.value = committedStatus.label;
				return;
			}
			const currentPipeline = this.settings.pipelines[pipelineIndex] ?? pipeline;
			if (hasDuplicateStatusLabel(currentPipeline.statuses, status.id, trimmed)) {
				new Notice(t('settings', 'statusAlreadyExists', { name: trimmed }));
				labelInput.value = committedStatus.label;
				return;
			}
			const nextPipelineDraft = buildPipelineStatusLabelDraft(currentPipeline, status.id, trimmed);
			if (!nextPipelineDraft) {
				labelInput.value = committedStatus.label;
				return;
			}
			await this.commitPipelineDraft(pipelineIndex, committedPipeline, nextPipelineDraft, refresh, () => {
				labelInput.value = committedStatus.label;
			});
		}));

		const statsCell = row.createDiv('operon-settings-stats-cell');
		statsCell.setText(String(statusCounts.get(composeStatusValue(pipeline.name, status.label)) ?? 0));

		let scheduledToggle: HTMLInputElement | null = null;
		let trackingToggle: HTMLInputElement | null = null;
		const clearAutomationTargets = () => {
			status.isScheduledTarget = false;
			status.isTrackingTarget = false;
			if (scheduledToggle) scheduledToggle.checked = false;
			if (trackingToggle) trackingToggle.checked = false;
		};
		const terminalDisabled = status.isScheduledTarget || status.isTrackingTarget;

		const automationDisabled = status.isFinished || status.isCancelled;

		const scheduledCell = row.createDiv('operon-settings-toggle-cell');

		const scheduledTooltip = automationDisabled
			? t('settings', 'scheduledTargetTerminalTooltip')
			: t('settings', 'scheduledTargetTooltip');
		scheduledToggle = createWorkflowInput({
			containerEl: scheduledCell,
			type: 'checkbox',
			className: 'operon-settings-small-toggle',
			label: t('settings', 'scheduledTargetAria', { pipeline: pipeline.name, status: status.label }),
			tooltip: scheduledTooltip,
		});
		scheduledToggle.checked = status.isScheduledTarget;
		scheduledToggle.disabled = automationDisabled;
		scheduledToggle.addEventListener('change', settingsAsyncHandler('settings scheduled target change failed', async () => {
			const nextValue = scheduledToggle?.checked === true;
			for (const candidate of pipeline.statuses) {
				candidate.isScheduledTarget = false;
			}
			status.isScheduledTarget = nextValue;
			await this.saveSettings();
			refresh();
		}));

		const trackingCell = row.createDiv('operon-settings-toggle-cell');

		const trackingTooltip = automationDisabled
			? t('settings', 'trackingTargetTerminalTooltip')
			: t('settings', 'trackingTargetTooltip');
		trackingToggle = createWorkflowInput({
			containerEl: trackingCell,
			type: 'checkbox',
			className: 'operon-settings-small-toggle',
			label: t('settings', 'trackingTargetAria', { pipeline: pipeline.name, status: status.label }),
			tooltip: trackingTooltip,
		});
		trackingToggle.checked = status.isTrackingTarget;
		trackingToggle.disabled = automationDisabled;
		trackingToggle.addEventListener('change', settingsAsyncHandler('settings tracking target change failed', async () => {
			const nextValue = trackingToggle?.checked === true;
			for (const candidate of pipeline.statuses) {
				candidate.isTrackingTarget = false;
			}
			status.isTrackingTarget = nextValue;
			await this.saveSettings();
			refresh();
		}));

		// Finished toggle (centered)
		const finishedCell = row.createDiv('operon-settings-toggle-cell');

		const finishedTooltip = terminalDisabled
			? t('settings', 'finishedStatusAutomationTooltip')
			: t('settings', 'finishedStatusTooltip');
		const finishedToggle = createWorkflowInput({
			containerEl: finishedCell,
			type: 'checkbox',
			className: 'operon-settings-small-toggle',
			label: t('settings', 'finishedStatusAria', { pipeline: pipeline.name, status: status.label }),
			tooltip: finishedTooltip,
		});
		finishedToggle.checked = status.isFinished;
		finishedToggle.disabled = terminalDisabled;
		finishedToggle.addEventListener('change', settingsAsyncHandler('settings finished status change failed', async () => {
			const nextValue = finishedToggle.checked;
			for (const candidate of pipeline.statuses) {
				candidate.isFinished = false;
			}
			status.isFinished = nextValue;
			if (nextValue) {
				status.isCancelled = false;
				cancelledToggle.checked = false;
				clearAutomationTargets();
			}
			await this.saveSettings();
			refresh();
		}));

		// Cancelled toggle (centered)
		const cancelledCell = row.createDiv('operon-settings-toggle-cell');

		const cancelledTooltip = terminalDisabled
			? t('settings', 'cancelledStatusAutomationTooltip')
			: t('settings', 'cancelledStatusTooltip');
		const cancelledToggle = createWorkflowInput({
			containerEl: cancelledCell,
			type: 'checkbox',
			className: 'operon-settings-small-toggle',
			label: t('settings', 'cancelledStatusAria', { pipeline: pipeline.name, status: status.label }),
			tooltip: cancelledTooltip,
		});
		cancelledToggle.checked = status.isCancelled;
		cancelledToggle.disabled = terminalDisabled;
		cancelledToggle.addEventListener('change', settingsAsyncHandler('settings cancelled status change failed', async () => {
			const nextValue = cancelledToggle.checked;
			for (const candidate of pipeline.statuses) {
				candidate.isCancelled = false;
			}
			status.isCancelled = nextValue;
			if (nextValue) {
				status.isFinished = false;
				finishedToggle.checked = false;
				clearAutomationTargets();
			}
			await this.saveSettings();
			refresh();
		}));

		const actionsCell = row.createDiv('operon-settings-action-cell operon-settings-action-cell-tight');

		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'arrow-up',
			label: t('settings', 'moveUp'),
			className: 'operon-settings-icon-action-button',
			placeholder: statusIndex <= 0,
			errorContext: 'settings status move up failed',
			onClick: async () => {
				const tmp = pipeline.statuses[statusIndex - 1];
				pipeline.statuses[statusIndex - 1] = pipeline.statuses[statusIndex];
				pipeline.statuses[statusIndex] = tmp;
				await this.saveSettings();
				refresh();
			},
		});

		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'arrow-down',
			label: t('settings', 'moveDown'),
			className: 'operon-settings-icon-action-button',
			placeholder: statusIndex >= pipeline.statuses.length - 1,
			errorContext: 'settings status move down failed',
			onClick: async () => {
				const tmp = pipeline.statuses[statusIndex + 1];
				pipeline.statuses[statusIndex + 1] = pipeline.statuses[statusIndex];
				pipeline.statuses[statusIndex] = tmp;
				await this.saveSettings();
				refresh();
			},
		});

		createWorkflowActionButton({
			containerEl: actionsCell,
			icon: 'x',
			label: t('settings', 'deleteStatus'),
			className: 'operon-settings-danger-icon-button',
			danger: true,
			errorContext: 'settings status delete failed',
			onClick: async () => {
				if (pipeline.statuses.length <= 1) {
					new Notice(t('settings', 'pipelineAtLeastOneStatus'));
					return;
				}
				const confirmed = await this.confirmDeleteStatus(status.label, pipeline.name);
				if (!confirmed) return;
				pipeline.statuses.splice(statusIndex, 1);
				await this.saveSettings();
				refresh();
			},
		});
	}

	private buildPipelineStatusCounts(pipeline: Pipeline): Map<string, number> {
		const counts = new Map<string, number>();
		if (!this.indexer) return counts;

		for (const task of this.indexer.getAllTasks()) {
			const statusValue = task.fieldValues.status?.trim();
			if (!statusValue || !statusValue.startsWith(`${pipeline.name}.`)) continue;
			counts.set(statusValue, (counts.get(statusValue) ?? 0) + 1);
		}

		return counts;
	}

	private async commitPipelineDraft(
		pipelineIndex: number,
		committedPipeline: Pipeline,
		nextPipelineDraft: Pipeline,
		refresh: () => void,
		onCancel: () => void,
	): Promise<void> {
		const plan = buildPipelineRenamePlan(committedPipeline, nextPipelineDraft);
		const preview = this.indexer
			? collectPipelineRenamePreview(this.indexer, plan)
			: {
				plan,
				affectedTasks: [],
				fileTaskCount: 0,
				inlineTaskCount: 0,
				touchedFileCount: 0,
				totalTaskCount: 0,
			};

		if (preview.totalTaskCount > 0) {
			const confirmed = await this.confirmPipelineRenameMigration(preview);
			if (!confirmed) {
				onCancel();
				return;
			}
		}

		this.settings.pipelines[pipelineIndex] = nextPipelineDraft;
		if (this.settings.defaultPipelineName === committedPipeline.name) {
			this.settings.defaultPipelineName = nextPipelineDraft.name;
		}

		await this.persistSettingsOnly();
		try {
			if (preview.totalTaskCount > 0) {
				await this.applyPipelineRenameMigration(preview);
			}
		} catch (error) {
			console.error('Operon: pipeline rename migration failed unexpectedly', error);
			new Notice(t('settings', 'pipelineRenameMigrationUnexpectedError'));
		}

		this.notifySettingsChanged();
		refresh();
	}

	private async confirmPipelineRenameMigration(preview: PipelineRenamePreview): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'pipelineRenameMigrationTitle'),
				message: t('settings', 'pipelineRenameMigrationMessage', {
					fileTaskCount: String(preview.fileTaskCount),
					inlineTaskCount: String(preview.inlineTaskCount),
					touchedFileCount: String(preview.touchedFileCount),
				}),
				confirmText: t('buttons', 'confirm'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	/**
	 * Render the Key Mappings section (Spec Section 5.4.1).
	 * Shows all canonical + custom keys with editable visible property names.
	 */
	private renderKeyMappingsSection(containerEl: HTMLElement): void {
		const refresh = () => { containerEl.empty(); this.renderKeyMappingsSection(containerEl); };
		renderSettingsHeading(containerEl, t('settings', 'keyMappings'));

		// Explanation block at the top
		const explanationBox = containerEl.createDiv('operon-key-mapping-explanation-box');

		const explanationTitle = explanationBox.createEl('strong', { text: t('settings', 'keyMappings') });
		explanationTitle.addClass('operon-key-mapping-explanation-title');

		explanationBox.createEl('p', {
			text: t('settings', 'keyMappingsIntro'),
			cls: 'operon-key-mapping-explanation-text',
		});

		const legendEl = explanationBox.createDiv('operon-key-mapping-legend');

		const legendItems = [
			{ label: t('settings', 'keyMappingsLegendPropertyLabel'), desc: t('settings', 'keyMappingsLegendPropertyDesc') },
			{ label: t('settings', 'keyMappingsLegendHideLabel'), desc: t('settings', 'keyMappingsLegendHideDesc') },
			{ label: t('settings', 'keyMappingsLegendTypeLabel'), desc: t('settings', 'keyMappingsLegendTypeDesc') },
		];
		for (const item of legendItems) {
			const span = legendEl.createSpan('operon-key-mapping-legend-item');
			span.createEl('strong', { text: item.label });
			span.appendText(` — ${item.desc}`);
		}

		// System keys (canonical)
		const canonicalSortIndex = new Map(CANONICAL_KEY_ORDER.map((entry, index) => [entry.name, index]));
		const systemMappings = this.settings.keyMappings
			.filter(m => m.isSystem && m.isInternal !== true)
			.sort((left, right) => {
				const leftIndex = canonicalSortIndex.get(left.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
				const rightIndex = canonicalSortIndex.get(right.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
				return leftIndex - rightIndex;
		});
		const customMappings = this.settings.keyMappings.filter(m => !m.isSystem);
		const showCustomKeyControls = false;

		// --- System Keys ---
		renderSettingsHeading(containerEl, t('settings', 'keyMappingsSystemHeader', { count: String(systemMappings.length) }));

		for (const mapping of systemMappings) {
			this.renderKeyMappingRow(containerEl, mapping, true);
		}

		// --- Custom Keys ---
		if (showCustomKeyControls && customMappings.length > 0) {
			renderSettingsHeading(containerEl, t('settings', 'keyMappingsCustomHeader', { count: String(customMappings.length) }));

			for (const mapping of customMappings) {
				this.renderKeyMappingRow(containerEl, mapping, false, refresh);
			}
		} else if (showCustomKeyControls) {
			containerEl.createEl('p', {
				text: t('settings', 'keyMappingsNoCustom'),
				cls: 'setting-item-description operon-key-mapping-empty-note',
			});
		}

		if (showCustomKeyControls) {
			createWorkflowActionButton({
				containerEl,
				text: t('settings', 'keyMappingsAddKey'),
				label: t('settings', 'keyMappingsAddKey'),
				className: 'operon-settings-primary-button operon-settings-spaced-top',
				onClick: () => this.addCustomKey(containerEl, refresh),
			});
		}
	}

	private async confirmDeletePipeline(pipelineName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deletePipelineTitle', { name: pipelineName }),
				message: t('settings', 'deletePipelineMessage'),
				confirmText: t('settings', 'deletePipeline'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeleteStatus(statusLabel: string, pipelineName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deleteStatusTitle', { name: statusLabel }),
				message: t('settings', 'deleteStatusMessage', { pipeline: pipelineName }),
				confirmText: t('settings', 'deleteStatus'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeletePriority(priorityLabel: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deletePriorityTitle', { name: priorityLabel }),
				message: t('settings', 'deletePriorityMessage'),
				confirmText: t('settings', 'deletePriority'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeleteCalendarPreset(presetName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('calendar', 'deletePresetTitle', { name: presetName }),
				message: t('calendar', 'deleteCalendarPresetMessage'),
				confirmText: t('calendar', 'deletePresetConfirm'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeleteKanbanPreset(presetName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deleteKanbanPresetTitle', { name: presetName }),
				message: t('settings', 'deleteKanbanPresetMessage'),
				confirmText: t('calendar', 'deletePresetConfirm'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeleteExternalCalendarSource(sourceName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deleteExternalCalendarTitle', { name: sourceName }),
				message: t('settings', 'deleteExternalCalendarMessage'),
				confirmText: t('settings', 'deleteExternalCalendarConfirm'),
				cancelText: t('buttons', 'cancel'),
				danger: true,
			}, resolve).open();
		});
	}

	private async confirmDeleteRepeatYamlPropertyRemoval(ruleName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'repeatYamlPropertyRemovalDeleteTitle', { name: ruleName }),
				message: t('settings', 'repeatYamlPropertyRemovalDeleteMessage'),
				confirmText: t('settings', 'repeatYamlPropertyRemovalRemove'),
				cancelText: t('buttons', 'cancel'),
				danger: true,
			}, resolve).open();
		});
	}

	private async moveCalendarPreset(index: number, direction: -1 | 1): Promise<void> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.calendarPresets.length) return;
		const presets = [...this.settings.calendarPresets];
		const [moved] = presets.splice(index, 1);
		if (!moved) return;
		presets.splice(targetIndex, 0, moved);
		this.settings.calendarPresets = presets;
		await this.saveSettings();
		this.display();
	}

	private async moveKanbanPreset(index: number, direction: -1 | 1): Promise<void> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.kanbanPresets.length) return;
		const presets = [...this.settings.kanbanPresets];
		const [moved] = presets.splice(index, 1);
		if (!moved) return;
		presets.splice(targetIndex, 0, moved);
		this.settings.kanbanPresets = presets;
		await this.saveSettings();
		this.display();
	}

	private async moveExternalCalendarSource(index: number, direction: -1 | 1): Promise<void> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.externalCalendars.length) return;
		const sources = [...this.settings.externalCalendars];
		const [moved] = sources.splice(index, 1);
		if (!moved) return;
		sources.splice(targetIndex, 0, moved);
		this.settings.externalCalendars = sources;
		await this.saveSettings();
		this.display();
	}

	/**
	 * Render a single key mapping row.
	 */
	private renderKeyMappingRow(containerEl: HTMLElement, mapping: KeyMapping, isSystem: boolean, refresh: () => void = () => { }): void {
		const card = containerEl.createDiv('operon-key-mapping-card');

		// ── Row 1: title (left) + Property input (right) ────────────────
		const row1 = card.createDiv('operon-key-mapping-row1');

		const typeLabel = t('settings', `keyMappingsType_${mapping.type}`);
		row1.createDiv({
			text: `${mapping.canonicalKey} [${typeLabel === `keyMappingsType_${mapping.type}` ? mapping.type : typeLabel}]`,
			cls: 'operon-key-mapping-title',
		});

		const propertyWrap = row1.createDiv('operon-key-mapping-property-wrap');
		propertyWrap.createEl('label', {
			text: `${t('settings', 'keyMappingsPropertyLabel')}:`,
			cls: 'operon-key-mapping-control-label',
		});
		const propertyInput = propertyWrap.createEl('input', {
			cls: 'operon-key-mapping-input',
			attr: { type: 'text' },
		});
		setAccessibleLabelWithoutTooltip(propertyInput, t('settings', 'keyMappingsPropertyAria'));
		propertyInput.placeholder = mapping.canonicalKey;
		propertyInput.value = mapping.visiblePropertyName;

		propertyInput.addEventListener('input', settingsAsyncHandler('settings key mapping property change failed', async () => {
			const trimmed = propertyInput.value.trim();
			if (!trimmed) return;
			const duplicate = this.settings.keyMappings.find(m => m !== mapping && m.visiblePropertyName === trimmed);
			propertyInput.toggleClass('is-error', duplicate !== undefined);
			if (duplicate) return;
			mapping.visiblePropertyName = trimmed;
			await this.saveSettings();
		}));

		if (mapping.canonicalKey === 'operonId') {
			propertyInput.disabled = true;
			propertyInput.classList.add('is-disabled');
		}

		// ── Row 2: icon btn + description (left) + Hide toggle (right) ──
		const row2 = card.createDiv('operon-key-mapping-row2');

		// Icon button (picker)
		const iconButton = row2.createEl('button', {
			cls: 'operon-key-mapping-icon-trigger',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(iconButton, t('settings', 'keyMappingsIconAria'));

		const getStoredIcon = (): string => normalizeTaskIconValue(mapping.icon);
		const refreshIconPreview = (iconName = getStoredIcon()) => {
			iconButton.empty();
			setAccessibleLabelWithoutTooltip(iconButton, t('settings', 'keyMappingsIconAria'));
			iconButton.classList.remove('has-icon');
			if (!iconName) return;
			const iconEl = getIcon(iconName);
			if (!iconEl) return;
			iconEl.addClass('operon-key-mapping-icon-preview');
			iconButton.appendChild(iconEl);
			iconButton.classList.add('has-icon');
		};
		const commitIconValue = async (nextValue: string): Promise<void> => {
			mapping.icon = normalizeTaskIconValue(nextValue);
			refreshIconPreview(mapping.icon);
			await this.saveSettings();
		};

		let closeIconPicker: (() => void) | null = null;
		const openPicker = () => {
			if (closeIconPicker) return;
			closeIconPicker = showIconPicker(iconButton, {
				value: getStoredIcon(),
				query: '',
				onSelect: iconId => { closeIconPicker = null; void commitIconValue(iconId); },
				onClear: () => { closeIconPicker = null; void commitIconValue(''); },
				onClose: () => { closeIconPicker = null; },
			});
		};
		refreshIconPreview();
		iconButton.addEventListener('mousedown', e => e.preventDefault());
		iconButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPicker(); });

		// Description
		row2.createDiv({ cls: 'operon-key-mapping-description', text: getKeyMappingDescription(mapping) });

		// Hide toggle (right side, pushed via margin-left: auto in CSS)
		const hideWrap = row2.createDiv('operon-key-mapping-hide-wrap');
		applyOperonTooltip(hideWrap, t('settings', 'keyMappingsHideTooltip'));
		hideWrap.createEl('label', {
			text: t('settings', 'keyMappingsHideLabel'),
			cls: 'operon-key-mapping-control-label',
		});
		const hideControlHost = hideWrap.createDiv('operon-key-mapping-toggle-host');
		const hideToggle = new ToggleComponent(hideControlHost);
		hideToggle.setValue(mapping.hideInFileTaskView === true);
		hideToggle.onChange(async value => {
			mapping.hideInFileTaskView = value;
			await this.saveSettings();
		});
		setAccessibleLabelWithoutTooltip(hideControlHost, t('settings', 'keyMappingsHideAria'));

		// Delete button — custom keys only, after Hide toggle
		if (!isSystem) {
			createWorkflowActionButton({
				containerEl: hideWrap,
				icon: 'trash',
				label: t('settings', 'keyMappingsDeleteCustomKey'),
				className: 'clickable-icon operon-key-mapping-delete-button',
				danger: true,
				errorContext: 'settings key mapping delete failed',
				onClick: async () => {
					this.settings.keyMappings = this.settings.keyMappings.filter(m => m !== mapping);
					await this.saveSettings();
					refresh();
				},
			});
		}
	}

	/**
	 * Add a new custom key via an inline form (replaces broken prompt() calls).
	 */
	private addCustomKey(containerEl: HTMLElement, onDone: () => void): void {
		// If a form is already open, close it
		const existing = containerEl.querySelector('.operon-add-key-form');
		if (existing) { existing.remove(); return; }

		const form = containerEl.createDiv('operon-add-key-form');

		const field = (label: string, placeholder: string, defaultVal = '') => {
			const wrap = form.createDiv();
			wrap.createEl('label', { text: label, cls: 'setting-item-name operon-add-key-label' });
			const inp = wrap.createEl('input', { cls: 'operon-add-key-input' });
			inp.type = 'text';
			inp.placeholder = placeholder;
			inp.value = defaultVal;
			return inp;
		};

		const canonicalInp = field(
			t('settings', 'keyMappingsCustomCanonicalLabel'),
			t('settings', 'keyMappingsCustomCanonicalPlaceholder'),
		);
		const visibleInp = field(
			t('settings', 'keyMappingsCustomVisibleLabel'),
			t('settings', 'keyMappingsCustomVisiblePlaceholder'),
		);

		// Type dropdown
		const typeWrap = form.createDiv();
		typeWrap.createEl('label', { text: t('settings', 'keyMappingsCustomTypeLabel'), cls: 'setting-item-name operon-add-key-label' });
		const typeSel = typeWrap.createEl('select', { cls: 'operon-add-key-input' });
		for (const type of ['text', 'number', 'date', 'datetime', 'list']) {
			const localizedType = t('settings', `keyMappingsType_${type}`);
			const opt = typeSel.createEl('option', {
				text: localizedType === `keyMappingsType_${type}` ? type : localizedType,
				value: type,
			});
			if (type === 'text') opt.selected = true;
		}

		// Buttons row — spans 2 columns
		const btnRow = form.createDiv('operon-add-key-button-row');

		const errorEl = btnRow.createSpan('operon-add-key-error');

		createWorkflowActionButton({
			containerEl: btnRow,
			text: t('settings', 'keyMappingsAddKey'),
			label: t('settings', 'keyMappingsAddKey'),
			className: 'operon-settings-primary-button operon-add-key-save-button',
			errorContext: 'settings custom key add failed',
			onClick: async () => {
				const canonical = canonicalInp.value.trim();
				const visible = visibleInp.value.trim() || canonical;

				if (!canonical) { errorEl.textContent = t('settings', 'keyMappingsCustomRequiredCanonical'); return; }
				if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(canonical)) {
					errorEl.textContent = t('settings', 'keyMappingsCustomCanonicalFormat'); return;
				}
				if (this.settings.keyMappings.some(m => m.canonicalKey === canonical)) {
					errorEl.textContent = t('settings', 'keyMappingsCustomDuplicateCanonical', { canonical }); return;
				}
				if (this.settings.keyMappings.some(m => m.visiblePropertyName === visible)) {
					errorEl.textContent = t('settings', 'keyMappingsCustomDuplicateVisible', { visible }); return;
				}

				this.settings.keyMappings.push({
					canonicalKey: canonical,
					visiblePropertyName: visible,
					type: typeSel.value as KeyMapping['type'],
					sync: 'no',
					enabled: true,
					hideInFileTaskView: false,
					icon: '',
					isSystem: false,
				});
				await this.saveSettings();
				new Notice(t('settings', 'keyMappingsCustomAdded', { canonical }));
				form.remove();
				onDone();
			},
		});

		createWorkflowActionButton({
			containerEl: btnRow,
			text: t('buttons', 'cancel'),
			label: t('buttons', 'cancel'),
			className: 'operon-add-key-cancel-button',
			onClick: () => form.remove(),
		});
		btnRow.appendChild(errorEl);
	}

	/**
	 * Filters tab — list of user-defined filter sets.
	 */
	private renderFiltersTab(containerEl: HTMLElement): void {
		// Info box
		renderSettingsInfoBox(containerEl, t('filterSets', 'tabLabel'), t('filterSets', 'tabDesc'));

		// Global presentation rules — apply to every filter surface
		this.renderBoundToggleSetting(containerEl, t('settings', 'filterShowSubtasks'), t('settings', 'filterShowSubtasksDesc'), 'filterShowSubtasks', {
			errorContext: 'settings filter show subtasks change failed',
		});

		this.renderBoundToggleSetting(containerEl, t('settings', 'filterShowOnlyOpenSubtasks'), t('settings', 'filterShowOnlyOpenSubtasksDesc'), 'filterShowOnlyOpenSubtasks', {
			errorContext: 'settings filter open subtasks change failed',
		});

		// Filter set list
		const listEl = containerEl.createDiv('operon-filter-set-list');
		const renderList = () => {
			listEl.empty();
			if (this.settings.filterSets.length === 0) {
				listEl.createEl('p', {
					text: t('filterSets', 'empty'),
					cls: 'setting-item-description operon-filter-empty-note',
				});
			}
			for (let i = 0; i < this.settings.filterSets.length; i++) {
				this.renderFilterSetCard(listEl, this.settings.filterSets[i], i, renderList);
			}
		};
		renderList();

		// + Add Filter button
		const addBtn = containerEl.createEl('button', { cls: 'operon-settings-primary-button operon-settings-spaced-top' });
		addBtn.setText(t('filterSets', 'addFilter'));

		addBtn.addEventListener('click', () => {
			const newFs: FilterSet = {
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
			new FilterSetModal(this.app, newFs, this.settings.keyMappings, settingsAsyncHandler('settings filter create failed', async (saved) => {
				await this.upsertFilterSet(saved);
				await this.saveSettings();
				renderList();
			}), this.makeEvalDeps() ?? undefined).open();
		});
	}

	private countFilterConditions(filterSet: FilterSet): number {
		const countNodes = (nodes: typeof filterSet.rootGroup.children): number => {
			let count = 0;
			for (const node of nodes) {
				if ('children' in node) {
					count += countNodes(node.children);
				} else {
					count += 1;
				}
			}
			return count;
		};
		return filterSet.rootGroup?.children ? countNodes(filterSet.rootGroup.children) : filterSet.conditions.length;
	}

	private syncFilterSetsFromStore(): void {
		this.settings.filterSets = this.storage.filters.getAll();
	}

	private async upsertFilterSet(filterSet: FilterSet): Promise<void> {
		await this.storage.filters.upsert(filterSet);
		this.syncFilterSetsFromStore();
	}

	private async deleteFilterSet(filterId: string): Promise<void> {
		await this.storage.filters.delete(filterId);
		this.syncFilterSetsFromStore();
	}

	private async moveFilterSet(filterId: string, direction: 'up' | 'down'): Promise<void> {
		const ids = this.settings.filterSets.map(f => f.id);
		const idx = ids.indexOf(filterId);
		if (idx === -1) return;
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= ids.length) return;
		[ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
		await this.storage.filters.replaceOrder(ids);
		this.syncFilterSetsFromStore();
	}

	private async copyFilterSet(filterSet: FilterSet): Promise<void> {
		const copy = cloneFilterSet(filterSet);
		copy.id = generateFilterSetId();
		copy.name = `${filterSet.name} Copy`;
		// Insert copy directly after the original
		const ids = this.settings.filterSets.map(f => f.id);
		const idx = ids.indexOf(filterSet.id);
		await this.upsertFilterSet(copy);
		const nextIds = this.settings.filterSets.map(f => f.id);
		const copyIdx = nextIds.indexOf(copy.id);
		if (idx !== -1 && copyIdx !== -1 && copyIdx !== idx + 1) {
			nextIds.splice(copyIdx, 1);
			nextIds.splice(idx + 1, 0, copy.id);
			await this.storage.filters.replaceOrder(nextIds);
			this.syncFilterSetsFromStore();
		}
	}

	private getFilterLogicLabel(filterSet: FilterSet): string {
		return (filterSet.rootGroup?.logic ?? filterSet.matchLogic ?? 'all').toUpperCase();
	}

	/**
	 * Render a single filter set card row.
	 */
	private renderFilterSetCard(
		listEl: HTMLElement,
		filterSet: FilterSet,
		index: number,
		refresh: () => void,
	): void {
		const filterName = filterSet.name.trim() || filterSet.id;
		const card = createSettingsListCard({
			containerEl: listEl,
			icon: filterSet.icon || 'filter',
			title: filterSet.name,
			className: 'operon-filter-set-card',
		});

		// "Used by" chips — calendar and kanban presets that reference this filter
		const calendarPresets = this.settings.calendarPresets.filter(p => p.filterSetId === filterSet.id);
		const kanbanPresets = this.settings.kanbanPresets.filter(p => p.filterSetId === filterSet.id);
		for (const preset of calendarPresets) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'calendar',
				label: preset.name.trim() || preset.id,
				className: 'operon-filter-card-used-chip',
			});
		}
		for (const preset of kanbanPresets) {
			createSettingsListCardChip({
				containerEl: card.metaEl,
				icon: 'square-kanban',
				label: preset.name.trim() || preset.id,
				className: 'operon-filter-card-used-chip',
			});
		}

		// Up / Down reorder buttons
		const total = this.settings.filterSets.length;
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'moveUp'),
			ariaLabel: `${t('settings', 'moveUp')}: ${filterName}`,
			icon: 'arrow-up',
			disabled: index === 0,
			errorContext: 'settings filter move up failed',
			onClick: async () => {
				await this.moveFilterSet(filterSet.id, 'up');
				await this.saveSettings();
				refresh();
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('settings', 'moveDown'),
			ariaLabel: `${t('settings', 'moveDown')}: ${filterName}`,
			icon: 'arrow-down',
			disabled: index === total - 1,
			errorContext: 'settings filter move down failed',
			onClick: async () => {
				await this.moveFilterSet(filterSet.id, 'down');
				await this.saveSettings();
				refresh();
			},
		});

		// Edit button
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			ariaLabel: t('filterSets', 'editFilterNamed', { name: filterName }),
			tooltip: t('filterSets', 'editFilterNamed', { name: filterName }),
			text: t('filterSets', 'edit'),
			wide: true,
			onClick: () => {
				const clone = cloneFilterSet(filterSet);
				new FilterSetModal(this.app, clone, this.settings.keyMappings, settingsAsyncHandler('settings filter edit failed', async (saved) => {
					await this.upsertFilterSet(saved);
					await this.saveSettings();
					refresh();
				}), this.makeEvalDeps() ?? undefined).open();
			},
		});

		// Copy button
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'duplicateFilter'),
			ariaLabel: `${t('filterSets', 'duplicateFilter')}: ${filterName}`,
			icon: 'copy',
			errorContext: 'settings filter copy failed',
			onClick: async () => {
				await this.copyFilterSet(filterSet);
				await this.saveSettings();
				refresh();
			},
		});

		// Open in sidebar button
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'openInSidebar'),
			ariaLabel: `${t('filterSets', 'openInSidebar')}: ${filterName}`,
			icon: 'panel-right-open',
			errorContext: 'settings filter open in sidebar failed',
			onClick: async () => {
				await this.openFilterInSidebar(filterSet.id);
			},
		});

		// Embed button — copy embed code to clipboard
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'copyEmbedCode'),
			ariaLabel: `${t('filterSets', 'copyEmbedCode')}: ${filterName}`,
			text: '</>',
			monospace: true,
			errorContext: 'settings filter embed copy failed',
			onClick: async () => {
				const code = '```operon\nfilterId: "' + filterSet.id + '"\n```';
				await navigator.clipboard.writeText(code);
				new Notice(t('filterSets', 'embedCodeCopied'));
			},
		});

		// Delete button
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'deleteFilterConfirm'),
			ariaLabel: `${t('filterSets', 'deleteFilterConfirm')}: ${filterName}`,
			tooltip: `${t('filterSets', 'deleteFilterConfirm')}: ${filterName}`,
			icon: 'trash-2',
			danger: true,
			onClick: () => {
				const modal = new ConfirmActionModal(
					this.app,
					{
						title: t('filterSets', 'deleteFilterTitle'),
						message: t('filterSets', 'deleteFilterMessage').replace('{{name}}', filterSet.name),
						confirmText: t('filterSets', 'deleteFilterConfirm'),
						cancelText: t('filterSets', 'deleteFilterCancel'),
						danger: true,
					},
					settingsAsyncHandler('settings filter delete failed', async (confirmed) => {
						if (!confirmed) return;
						await this.deleteFilterSet(filterSet.id);
						await this.saveSettings();
						refresh();
					}),
				);
				modal.open();
			},
		});
	}

	private renderBoundToggleSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: BooleanSettingKey,
		options: {
			errorContext?: string;
			onBeforeSave?: (value: boolean) => void | Promise<void>;
			onAfterChange?: (value: boolean) => void | Promise<void>;
		} = {},
	): Setting {
		const applyChange = async (value: boolean): Promise<void> => {
			this.settings[key] = value;
			await options.onBeforeSave?.(value);
			await this.saveSettings();
			await options.onAfterChange?.(value);
		};
		return renderToggleSetting({
			containerEl,
			name,
			desc,
			value: this.settings[key] === true,
			onChange: options.errorContext
				? settingsAsyncHandler(options.errorContext, applyChange)
				: applyChange,
		});
	}

	private renderBoundDropdownSetting<TKey extends keyof OperonSettings, TValue extends string>(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: TKey,
		options: {
			value: TValue;
			dropdownOptions: DropdownSettingOption<TValue>[];
			normalize?: (value: TValue) => OperonSettings[TKey];
			errorContext?: string;
			disabled?: boolean;
			configure?: (dropdown: DropdownComponent) => void;
			onBeforeSave?: (value: OperonSettings[TKey]) => void | Promise<void>;
			onAfterChange?: (value: OperonSettings[TKey]) => void | Promise<void>;
		},
	): Setting {
		const applyChange = async (value: TValue): Promise<void> => {
			const nextValue = options.normalize
				? options.normalize(value)
				: value as unknown as OperonSettings[TKey];
			this.settings[key] = nextValue;
			await options.onBeforeSave?.(nextValue);
			await this.saveSettings();
			await options.onAfterChange?.(nextValue);
		};
		return renderDropdownSetting({
			containerEl,
			name,
			desc,
			value: options.value,
			options: options.dropdownOptions,
			disabled: options.disabled,
			configure: options.configure,
			onChange: options.errorContext
				? settingsAsyncHandler(options.errorContext, applyChange)
				: applyChange,
		});
	}

	private renderBoundTextSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: TextSettingKey,
		options: {
			placeholder?: string;
			settingClass?: string;
			controlClass?: string;
			trim?: boolean;
			normalize?: (value: string) => string;
			errorContext?: string;
			configure?: (text: TextComponent) => void;
			disabled?: boolean;
			onBeforeSave?: (value: string) => void | Promise<void>;
			onAfterChange?: (value: string) => void | Promise<void>;
		} = {},
	): Setting {
		const applyChange = async (value: string): Promise<void> => {
			const rawValue = options.trim === false ? value : value.trim();
			const nextValue = options.normalize ? options.normalize(rawValue) : rawValue;
			this.settings[key] = nextValue;
			await options.onBeforeSave?.(nextValue);
			await this.saveSettings();
			await options.onAfterChange?.(nextValue);
		};
		return renderTextSetting({
			containerEl,
			name,
			desc,
			value: String(this.settings[key] ?? ''),
			placeholder: options.placeholder,
			settingClass: options.settingClass,
			controlClass: options.controlClass,
			disabled: options.disabled,
			configure: options.configure,
			onChange: options.errorContext
				? settingsAsyncHandler(options.errorContext, applyChange)
				: applyChange,
		});
	}

	private renderBoundClampedNumericSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: NumberSettingKey,
		options: {
			min: number;
			max: number;
			fallback: number;
			step?: string;
			onAfterChange?: (value: number) => void | Promise<void>;
		},
	): Setting {
		return new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				text.setValue(String(this.settings[key]));
				text.inputEl.type = 'number';
				text.inputEl.min = String(options.min);
				text.inputEl.max = String(options.max);
				if (options.step) text.inputEl.step = options.step;

				let lastCommittedValue = this.settings[key];
				const commit = async (): Promise<void> => {
					const nextValue = this.parseCalendarPresetNumber(text.inputEl.value, options.fallback, options.min, options.max);
					if (text.inputEl.value !== String(nextValue)) {
						text.setValue(String(nextValue));
					}
					if (nextValue === lastCommittedValue) return;

					this.settings[key] = nextValue;
					await this.saveSettings();
					lastCommittedValue = nextValue;
					await options.onAfterChange?.(nextValue);
				};

				text.inputEl.addEventListener('blur', () => {
					runSettingsAsync('settings numeric value commit failed', commit);
				});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					runSettingsAsync('settings numeric value commit failed', async () => {
						await commit();
						text.inputEl.blur();
					});
				});
			});
	}

	private addNumericSetting(
		container: HTMLElement,
		name: string,
		desc: string,
		key: keyof OperonSettings,
	): void {
		if (!isNumericSettingKey(key)) return;
		const constraint = getNumericConstraint(key);
		if (!constraint) return;
		const constraintLabel = constraint
			? typeof constraint.max === 'number'
				? ` (${constraint.min}–${constraint.max})`
				: ` (${constraint.min}+)`
			: '';
		const currentValue = this.settings[key];
		const parsedValue = typeof currentValue === 'number' ? currentValue : parseInt(String(currentValue), 10);
		renderNumericTextSetting({
			containerEl: container,
			name,
			desc: desc + constraintLabel,
			value: isNaN(parsedValue) ? constraint.min : parsedValue,
			min: constraint.min,
			max: constraint.max,
			onChange: async num => {
				setNumericSetting(this.settings, key, num);
				await this.saveSettings();
			},
		});
	}

	private renderFilterTaskCardsSection(containerEl: HTMLElement): void {
		renderSettingsHeading(containerEl, t('settings', 'filterTaskIconsSection'));
		renderCompactChipSettingsSection({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'filterTaskIconsSectionDesc'),
			toggleTitle: t('settings', 'filterTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'filterTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'filterTaskIconsReorder'),
			moveUpLabel: t('settings', 'filterTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'filterTaskIconsMoveDown'),
			getItems: () => this.settings.filterTaskCompactChips,
			setItems: items => {
				this.settings.filterTaskCompactChips = items;
			},
			getLabel: key => this.getInlineTaskCompactChipLabel(key),
			getIcon: key => this.getInlineTaskCompactChipIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			iconOnlyButtonLabel: t('settings', 'compactChipIconOnly'),
			actionTogglesTitle: t('settings', 'filterTaskActionsSection'),
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			getIconOnlyToggleLabel: label => t('settings', 'compactChipIconOnlyToggle', { label }),
			save: () => this.saveSettings(),
			getActionToggles: () => [
				{
					visible: this.settings.filterTaskShowPlayAction,
					icon: 'play',
					label: t('settings', 'inlineTaskPlayAction'),
					onToggle: async () => {
						this.settings.filterTaskShowPlayAction = !this.settings.filterTaskShowPlayAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.filterTaskShowPinAction,
					icon: 'pin',
					label: t('settings', 'inlineTaskPinAction'),
					onToggle: async () => {
						this.settings.filterTaskShowPinAction = !this.settings.filterTaskShowPinAction;
						await this.saveSettings();
					},
				},
				{
					visible: this.settings.filterTaskShowSubtaskAction,
					icon: 'list-plus',
					label: t('settings', 'inlineTaskSubtaskAction'),
					onToggle: async () => {
						this.settings.filterTaskShowSubtaskAction = !this.settings.filterTaskShowSubtaskAction;
						await this.saveSettings();
					},
				},
			],
		});
	}

	private renderFileTaskTemplateSettings(containerEl: HTMLElement): void {
		let preview: HTMLElement | null = null;

		const renderPreviewNote = (message: string): void => {
			preview?.createDiv({
				text: message,
				cls: 'operon-file-template-preview-note',
			});
		};

		const renderPreview = () => {
			if (!preview) return;

			preview.empty();
			const folderPath = this.settings.fileTaskTemplateFolder.trim();
			if (!folderPath) {
				renderPreviewNote(t('settings', 'fileTaskTemplatePreviewNoFolder'));
				return;
			}

			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				renderPreviewNote(t('settings', 'fileTaskTemplatePreviewFolderMissing'));
				return;
			}

			const templates = getTopLevelMarkdownFilesInFolder(folderPath, this.app.vault.getMarkdownFiles());
			if (templates.length === 0) {
				renderPreviewNote(t('settings', 'fileTaskTemplatePreviewNoTemplates'));
				return;
			}

			renderPreviewNote(t('settings', 'fileTaskTemplatePreviewDefaultConversion'));
			preview.createDiv({
				text: t('settings', 'fileTaskTemplatePreviewTemplatesIntro'),
				cls: 'operon-file-template-preview-label',
			});

			const chipsEl = preview.createDiv('operon-file-template-chip-list');
			for (const template of templates) {
				const chipEl = createInlineTaskCompactChipElement({
					key: 'tags',
					label: template.basename,
					icon: 'notepad-text-dashed',
					iconOnly: false,
					interactive: false,
					colorRole: 'default',
					linkTarget: null,
				}, 'operon-editor-compact-selection-chip operon-file-template-chip', { forceFull: true, owner: chipsEl });
				chipsEl.appendChild(chipEl);
			}
		};

		this.renderBoundTextSetting(containerEl, t('settings', 'fileTaskTemplateFolder'), t('settings', 'fileTaskTemplateFolderDesc'), 'fileTaskTemplateFolder', {
			placeholder: t('settings', 'fileTaskTemplateFolderPlaceholder'),
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			configure: text => {
				new FolderSuggest(this.app, text.inputEl, settingsAsyncHandler('settings file task template folder selection failed', async (folder) => {
					this.settings.fileTaskTemplateFolder = folder.path;
					await this.saveSettings();
					renderPreview();
				}));
			},
			onAfterChange: () => {
				renderPreview();
			},
		});

		preview = containerEl.createDiv('operon-file-template-preview');
		preview.setAttribute('aria-live', 'polite');
		preview.setAttribute('role', 'status');

		this.renderExcludedFolderSettings(containerEl);

		this.renderBoundToggleSetting(containerEl, t('settings', 'createDailyNotesAsOperonTask'), t('settings', 'createDailyNotesAsOperonTaskDesc'), 'createDailyNotesAsOperonTask');

		renderPreview();
	}

	private renderExcludedFolderSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-excluded-folders-setting' });

		renderSettingsHeading(wrapper, t('settings', 'excludedFolders'));

		wrapper.createDiv({
			text: t('settings', 'excludedFoldersDesc'),
			cls: 'operon-excluded-folders-desc',
		});

		const listEl = wrapper.createDiv('operon-excluded-folders-list');

		const pickerEl = wrapper.createDiv('operon-excluded-folders-picker');
		const addRowEl = wrapper.createDiv('operon-excluded-folders-add-row');

		const renderFolderPath = (rowEl: HTMLElement, folderPath: string): void => {
			const slashIndex = folderPath.lastIndexOf('/');
			if (slashIndex >= 0) {
				rowEl.createSpan({ text: `${folderPath.slice(0, slashIndex + 1)}` });
				rowEl.createEl('strong', { text: folderPath.slice(slashIndex + 1) });
			} else {
				rowEl.createEl('strong', { text: folderPath });
			}
		};
		const saveAndReindex = async (): Promise<void> => {
			await this.saveSettings();
			if (this.indexer) {
				await this.indexer.fullReindex();
				new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
			}
		};
		const addExcludedFolder = async (path: string): Promise<void> => {
			const normalized = normalizeSettingsFolderPath(path);
			if (!normalized) return;
			if (isExcludedFolderConflictWithFileTasksFolder(normalized, this.settings.fileTasksFolder)) {
				new Notice(t('settings', 'excludedFileTasksFolderBlocked', { folder: normalized }));
				return;
			}
			const exists = (this.settings.excludedFolders ?? []).some(folder => normalizeSettingsFolderPath(folder).toLowerCase() === normalized.toLowerCase());
			if (exists) {
				new Notice(t('settings', 'excludedFolderAlreadyAdded'));
				return;
			}
			this.settings.excludedFolders = [...(this.settings.excludedFolders ?? []), normalized];
			pickerEl.empty();
			render();
			await saveAndReindex();
		};
		const renderAddControls = (): void => {
			addRowEl.empty();
			const button = addRowEl.createEl('button', {
				cls: 'operon-settings-primary-button',
				attr: { type: 'button' },
			});
			button.setText(t('settings', 'addExcludedFolder'));
			button.onclick = () => {
				pickerEl.empty();
				new Setting(pickerEl)
					.setName(t('settings', 'excludedFolderSearch'))
					.addText(text => {
						text.setPlaceholder(t('settings', 'excludedFolderSearchPlaceholder'));
						text.inputEl.addClass('operon-settings-input-long');
						new FolderSuggest(this.app, text.inputEl, folder => {
							void addExcludedFolder(folder.path);
						}, {
							filter: folder => !isExcludedFolderConflictWithFileTasksFolder(folder.path, this.settings.fileTasksFolder),
						});
						text.inputEl.focus();
					})
					.addExtraButton(extra => {
						extra.setIcon('x');
						applyOperonTooltipToExtraButton(extra, t('buttons', 'cancel'));
						extra.onClick(() => {
							pickerEl.empty();
						});
					});
			};
		};
		const render = (): void => {
			const before = this.settings.excludedFolders ?? [];
			this.settings.excludedFolders = sanitizeExcludedFoldersForFileTasksFolder(before, this.settings.fileTasksFolder);
			const removedConflict = before.length !== this.settings.excludedFolders.length
				|| this.settings.excludedFolders.some((folder, index) => folder !== before[index]);
			if (removedConflict) {
				void saveAndReindex();
			}
			listEl.empty();
			for (const folderPath of this.settings.excludedFolders) {
				const row = createSettingsListCard({
					containerEl: listEl,
					icon: 'search-x',
					title: folderPath,
					className: 'operon-excluded-folder-row',
					titleClassName: 'operon-excluded-folder-path',
					metaClassName: 'operon-excluded-folder-meta',
					actionsClassName: 'operon-excluded-folder-actions',
					renderTitle: titleEl => {
						renderFolderPath(titleEl, folderPath);
					},
				});

				createSettingsListCardActionButton({
					containerEl: row.actionsEl,
					label: t('settings', 'removeExcludedFolder'),
					ariaLabel: `${t('settings', 'removeExcludedFolder')}: ${folderPath}`,
					tooltip: `${t('settings', 'removeExcludedFolder')}: ${folderPath}`,
					icon: 'trash-2',
					danger: true,
					className: 'operon-excluded-folder-remove',
					errorContext: 'settings excluded folder remove failed',
					onClick: async () => {
						this.settings.excludedFolders = this.settings.excludedFolders.filter(folder => normalizeSettingsFolderPath(folder).toLowerCase() !== folderPath.toLowerCase());
						render();
						await saveAndReindex();
					},
				});
			}
			if (this.settings.excludedFolders.length === 0) {
				listEl.createDiv({
					text: t('settings', 'excludedFoldersEmpty'),
					cls: 'operon-excluded-folders-empty',
				});
			}
			renderAddControls();
		};

		render();
	}

	private async persistSettingsOnly(): Promise<void> {
		await this.storage.saveSettings();
	}

	private notifySettingsChanged(): void {
		this.hasPendingSettingsChange = true;
	}

	/**
	 * Creates a collapsible section with a clickable h3-style header.
	 * State persists across display() re-renders via expandedSectionIds.
	 * @param containerEl  Parent element to append the section to
	 * @param title        Section heading text
	 * @param sectionId    Stable identifier for open/closed state persistence
	 * @param defaultOpen  Whether the section starts open (default: false)
	 * @returns            The inner body element — append Setting rows here
	 */
	private createCollapsibleSection(
		containerEl: HTMLElement,
		title: string,
		sectionId: string,
		defaultOpen = false,
		desc?: string,
	): HTMLElement {
		return createSettingsCollapsibleSection({
			containerEl,
			title,
			sectionId,
			defaultOpen,
			desc,
			expandedSectionIds: this.expandedSectionIds,
		});
	}

	private async saveSettings(): Promise<void> {
		await this.persistSettingsOnly();
		this.notifySettingsChanged();
	}
}
