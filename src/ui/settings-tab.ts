/**
 * Operon settings tab.
 * Provides UI for all plugin settings in Obsidian Settings panel.
 *
 * Spec Section 5.4.1 — Key Mapping Settings (UI):
 * - Full key mapping table with editable visiblePropertyName
 * - Type badge per key
 * - Validation (no duplicate visiblePropertyNames)
 *
 * Also covers: Timing, Index, Display, Pipelines sections.
 */

import * as Obsidian from 'obsidian';
import { AbstractInputSuggest, App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, ToggleComponent, getIcon, requireApiVersion, setIcon } from 'obsidian';
import type { ButtonComponent, DropdownComponent, SettingControl, SettingDefinition, SettingDefinitionItem, SettingDefinitionPage, TextComponent } from 'obsidian';
import { OperonSettings, DEFAULT_SETTINGS, DEFAULT_INLINE_TASK_TARGET_FILE, DEFAULT_INLINE_TASK_HEADING_KEYWORD, DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD, KeyMapping, FilterSet, CALENDAR_TIME_GRID_SCALE_OPTIONS, CALENDAR_AUTO_SCROLL_POSITION_OPTIONS, CALENDAR_SIDEBAR_WIDTH_MIN, CALENDAR_SIDEBAR_WIDTH_MAX, CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MIN, CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MAX, CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS, CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS, CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS, CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS, KANBAN_EXPANDED_COLUMN_WIDTH_MIN, KANBAN_EXPANDED_COLUMN_WIDTH_MAX, KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN, KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX, KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MIN, KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MAX, KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MIN, KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MAX, DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS, TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS, DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS, CHILD_TASK_INHERITANCE_TAGS_KEY, createExternalCalendarSourceId, ExternalCalendarSource, TaskCreatorToolbarItem, TASK_CREATOR_TOOLBAR_FIELD_ORDER, TASK_CREATOR_FALLBACK_FIELD_ICONS, TASK_EDITOR_WORKFLOW_PICKER_ORDER, TASK_EDITOR_MOBILE_CORE_TOOL_ORDER, TASK_EDITOR_MOBILE_CORE_FALLBACK_ICONS, TaskEditorMobileCoreToolItem, TaskEditorWorkflowPickerItem, INLINE_TASK_COMPACT_CHIP_ORDER, INLINE_TASK_COMPACT_FALLBACK_ICONS, TrackerTaskDescriptionClickAction, TASK_FINDER_DEFAULT_SCOPE_ORDER, TaskFinderDefaultScopeKey, normalizeTaskEditorMobileCoreTools, normalizeTaskFinderShortcutValue, FLOW_TIME_PAUSE_MINUTE_OPTIONS, FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS, cloneFilterSet, getNumericConstraint, hasDuplicateKeyMappingVisiblePropertyName, isChildTaskInheritanceEligibleFieldKey, isNumericSettingKey, normalizeCalendarSidebarDefaultExpansionState, normalizeChildTaskInheritanceFields, normalizeChildTaskInheritanceStatusPipelineSource, normalizeFallbackTaskIconSource, normalizeInlineTaskHeadingKeyword, normalizeInlineTaskParentFileHeadingKeyword, setNumericSetting, isSupportedLanguage, type CalendarDayTitleAction, type CalendarMobileAgendaFutureDays, type CalendarMobileAgendaPastDays, type CalendarMobileAllDayVisibleTaskLimit, type CalendarSidebarDefaultStateKey, type ChildTaskInheritanceStatusPipelineSource, type FallbackTaskIconSource, type OperonLanguage, type WorkspaceTweaksPropertiesScope } from '../types/settings';
import type { ProjectSerialScope } from '../types/settings';
import {
	createProjectSerialScopeId,
	formatProjectSerialLabel,
	normalizeProjectSerialPrefix,
	previewProjectSerialScopeAdd,
	previewProjectSerialScopeDelete,
} from '../core/project-serials';
import { clonePipeline, composeStatusValue, createPipelineId, createStatusId, Pipeline, StatusDefinition } from '../types/pipeline';
import { PriorityDefinition, DEFAULT_PRIORITIES, clonePriorityDefinition, createPriorityId } from '../types/priority';
import { CalendarPreset, createCalendarPresetId } from '../types/calendar';
import { APPEARANCE_SCHEME_LIGHT_OPTIONS, APPEARANCE_SCHEME_DARK_OPTIONS, addAppearanceSchemeOptions } from './appearance-schemes';
import {
	CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS,
	CONFIGURABLE_CONTEXTUAL_MENU_SURFACE_GROUPS,
	CONTEXTUAL_MENU_SURFACE_LABEL_KEYS,
	isContextualMenuActionSupportedOnSurface,
	type ContextualMenuActionHandler,
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
	isBuiltInKanbanSwimlaneBy,
	normalizeKanbanCustomFieldReference,
} from '../types/kanban';
import { OperonStorage } from '../storage/operon-storage';
import type { OperonLegacyStorageCleanupStatus } from '../storage/operon-storage';
import { PinnedCache } from '../storage/pinned-cache';
import { getCurrentLang, t } from '../core/i18n';
import { getReleaseNotesForManualView } from '../core/release-notes';
import { asHTMLElement } from '../core/dom-compat';
import { getAppLocale, isDailyNotesCoreAvailable } from '../core/obsidian-app';
import { resolveEffectiveInlineTaskSaveMode } from '../core/inline-task-save-mode';
import {
	cloneDefaultColorPalette,
	localizeColorPaletteNames,
	normalizeColorPalette,
	normalizeColorPaletteHex,
	normalizeColorPaletteName,
	type ColorPaletteEntry,
} from '../core/color-palette';
import { FilterSetModal, type FilterModalEvalDeps } from './filter-set-modal';
import { ExternalCalendarSourceEditModal } from './external-calendar-source-edit-modal';
import { CalendarPresetQuickSettingsModal } from './calendar/calendar-preset-quick-settings-modal';
import { KanbanPresetQuickSettingsModal } from './kanban/kanban-preset-quick-settings-modal';
import { OperonIndexer } from '../indexer/indexer';
import { ConfirmActionModal } from './confirm-action-modal';
import { FileTaskMigrationProgressModal } from './file-task-migration-progress-modal';
import { OperonReleaseNotesModal } from './release-notes-modal';
import { CalendarFilterPickerModal } from './calendar/calendar-filter-picker-modal';
import { showTimePicker } from './field-pickers/time-picker';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
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
import { getKeyMappingDescription } from './key-mapping-descriptions';
import { CustomKeyMappingModal } from './custom-key-mapping-modal';
import {
	buildCustomFieldUsageSummaries,
	getKanbanSwimlaneCustomFieldOptions,
	getManagedCustomFieldMappings,
	getManagedCustomFieldOptionMapping,
	getManagedCustomFieldOptions,
	moveCustomKeyMappingOrder,
	type CustomFieldUsageSummary,
} from '../core/managed-task-fields';
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
	getTaskColorSourceLabel,
	normalizeTaskColorSource,
} from '../core/task-color-source';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import {
	getNormalFilterSets,
	isDynamicFileTaskFilterSet,
	isDynamicSubtasksFilterSet,
	isSpecialDynamicFilterSet,
	isSpecialDynamicFilterSetId,
	normalizeDynamicFileTaskFilterSet,
	normalizeDynamicSubtasksFilterSet,
} from '../core/dynamic-file-task-filter';
import {
	isExcludedFolderConflictWithFileTasksFolder,
	normalizeSettingsFolderPath,
	sanitizeExcludedFoldersForFileTasksFolder,
} from '../core/settings-folder-rules';
import {
	applyFileTaskMigration,
	collectFileTaskMigrationPropertyKeyCandidates,
	collectFileTaskMigrationPropertyValueCandidates,
	collectFileTaskMigrationTagCandidates,
	FileTaskMigrationRule,
	FileTaskMigrationRuleType,
	FileTaskMigrationScanResult,
	normalizeFileTaskMigrationTag,
	scanFileTaskMigration,
	validateFileTaskMigrationScan,
} from '../core/file-task-migration';
import { renderCompactChipSettingsSection } from './settings/compact-chip-settings-renderer';
import { runSettingsAsync, settingsAsyncHandler } from './settings/async-settings-action';
import { parsePresetNumber } from './settings/preset-control-helpers';
import { renderTaskColorSourceSelectButton, showTaskColorSourceSelectMenu } from './task-color-source-select';
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
import { openSettingsIconPickerModal } from './settings/settings-icon-picker-modal';
import { openSettingsColorPickerModal } from './settings/settings-color-picker-modal';
import { renderSettingsIconPickerRow } from './settings/settings-icon-picker-ui';
import {
	OPERON_SETTINGS_SEARCH_REGISTRY,
	type OperonSettingsSearchEntry,
	type OperonSettingsSearchTextKey,
} from './settings/settings-search-registry';
import { getCustomFieldIcon, getCustomFieldLabel, getCustomFieldMapping } from './custom-field-surfaces';
import {
	createSettingsCollapsibleSection,
	createSettingsAddButton,
	renderDropdownSetting,
	renderNativeSettingsGroupedSection,
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

interface ChildTaskInheritanceFieldOption {
	key: string;
	label: string;
	icon: string;
	type: KeyMapping['type'];
	searchText: string;
}

type OperonSettingsPrimaryTabId = 'core' | 'tasks' | 'views' | 'interface' | 'mobile';

type OperonSettingsSecondaryTabId =
	| 'coreGeneral'
	| 'corePipelines'
	| 'corePriority'
	| 'coreKeymapping'
	| 'coreCustomKeys'
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
	| 'interfaceStateIcons'
	| 'interfaceTaskEditor'
	| 'interfaceLocationMap'
	| 'interfaceTweaks'
	| 'interfaceColorPalette'
	| 'mobileGeneral'
	| 'mobileTaskEditor'
	| 'mobileCalendar'
	| 'mobileKanban';

type OperonSettingsTabId = OperonSettingsPrimaryTabId | OperonSettingsSecondaryTabId;

type TaskChipsSettingsPageId =
	| 'taskCreatorToolbar'
	| 'inlineTaskChips'
	| 'taskFinderChips'
	| 'filterTaskChips'
	| 'fileTaskOverlayChips';

type TaskChipsSettingsPageMeta = {
	titleKey: string;
	descKey: string;
};

type CustomSurfaceSettingsTarget = 'editor' | 'creator' | 'chips' | 'kanbanSwimlane';
type SurfaceSettingsListTarget = 'editorWorkflow' | 'editorMobile' | 'creator' | 'chips';

const TASK_CREATOR_TOOLBAR_FIELD_KEY_SET = new Set<string>(TASK_CREATOR_TOOLBAR_FIELD_ORDER);
const TASK_EDITOR_WORKFLOW_PICKER_KEY_SET = new Set<string>(TASK_EDITOR_WORKFLOW_PICKER_ORDER);
const TASK_EDITOR_MOBILE_CORE_TOOL_KEY_SET = new Set<string>(TASK_EDITOR_MOBILE_CORE_TOOL_ORDER);
const INLINE_TASK_COMPACT_CHIP_KEY_SET = new Set<string>(INLINE_TASK_COMPACT_CHIP_ORDER);

const TASK_CHIPS_SETTINGS_PAGE_ORDER: readonly TaskChipsSettingsPageId[] = [
	'taskCreatorToolbar',
	'inlineTaskChips',
	'taskFinderChips',
	'filterTaskChips',
	'fileTaskOverlayChips',
];

const TASK_CHIPS_SETTINGS_PAGE_META: Record<TaskChipsSettingsPageId, TaskChipsSettingsPageMeta> = {
	taskCreatorToolbar: {
		titleKey: 'taskCreatorToolbarSection',
		descKey: 'taskCreatorToolbarSectionDesc',
	},
	inlineTaskChips: {
		titleKey: 'inlineTaskIconsSection',
		descKey: 'inlineTaskIconsSectionDesc',
	},
	taskFinderChips: {
		titleKey: 'taskFinderIconsSection',
		descKey: 'taskFinderIconsSectionDesc',
	},
	filterTaskChips: {
		titleKey: 'filterTaskIconsSection',
		descKey: 'filterTaskIconsSectionDesc',
	},
	fileTaskOverlayChips: {
		titleKey: 'overlayTaskIconsSection',
		descKey: 'overlayTaskIconsSectionDesc',
	},
};

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

let parentChildInheritanceSearchInstanceId = 0;

function getDynamicFileTaskFilterSubtaskAutoExpandLabel(limit: number): string {
	return limit === 0
		? t('settings', 'dynamicFileTaskFilterSubtaskAutoExpandNever')
		: t('settings', 'dynamicFileTaskFilterSubtaskAutoExpandOption', { count: String(limit) });
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

class TextValueSuggest extends AbstractInputSuggest<string> {
	private textInputEl: HTMLInputElement;
	private valueProvider: () => string[];
	private formatValue: (value: string) => string;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		valueProvider: () => string[],
		options: { formatValue?: (value: string) => string } = {},
	) {
		super(app, inputEl);
		this.textInputEl = inputEl;
		this.valueProvider = valueProvider;
		this.formatValue = options.formatValue ?? (value => value);
	}

	getSuggestions(query: string): string[] {
		const lowerQuery = query.trim().toLowerCase().replace(/^#/, '');
		return this.valueProvider()
			.filter(value => {
				const displayValue = this.formatValue(value);
				const searchValue = `${value} ${displayValue}`.toLowerCase().replace(/^#/, '');
				return !lowerQuery || searchValue.includes(lowerQuery);
			})
			.slice(0, 20);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(this.formatValue(value));
	}

	selectSuggestion(value: string): void {
		this.textInputEl.value = this.formatValue(value);
		this.textInputEl.trigger('input');
		this.close();
	}
}

type OperonSettingSearchKey = keyof OperonSettings;

type SettingsSearchRefreshableTab = {
	refreshDomState?: () => void;
	update?: () => void;
};

type ObsidianSettingPageShape = {
	rootEl: HTMLElement;
	titlebarEl: HTMLElement;
	containerEl: HTMLElement;
	title: string;
	display(): void;
	hide(): void;
};

type ObsidianSettingPageCtor = new () => ObsidianSettingPageShape;

const createFallbackSettingPageCtor = (): ObsidianSettingPageCtor => class FallbackSettingPage implements ObsidianSettingPageShape {
	rootEl = activeDocument.createElement('div');
	titlebarEl = activeDocument.createElement('div');
	containerEl = activeDocument.createElement('div');
	title = '';

	display(): void {
		// Fallback is only used on unsupported Obsidian versions where Settings Search is gated off.
	}

	hide(): void {
		this.containerEl.empty();
	}
};

const getObsidianSettingPageCtor = (): ObsidianSettingPageCtor => {
	const ctor = Reflect.get(Obsidian, 'SettingPage');
	return typeof ctor === 'function'
		? ctor as ObsidianSettingPageCtor
		: createFallbackSettingPageCtor();
};

class OperonNativeSettingsPage extends getObsidianSettingPageCtor() {
	constructor(
		title: string,
		private readonly renderPage: (containerEl: HTMLElement) => void,
		private readonly hidePage: (containerEl: HTMLElement) => void,
	) {
		super();
		this.title = title;
	}

	display(): void {
		this.renderPage(this.containerEl);
	}

	hide(): void {
		this.hidePage(this.containerEl);
		super.hide();
	}
}

const SETTINGS_SEARCH_NATIVE_TAB_IDS = new Set<OperonSettingsTabId>([
	'coreGeneral',
	'mobileGeneral',
]);

const SETTINGS_SEARCH_IMPERATIVE_PAGE_TAB_IDS = new Set<OperonSettingsTabId>([
	'corePipelines',
	'corePriority',
	'coreKeymapping',
	'coreCustomKeys',
	'tasksFileTasks',
	'tasksInlineTasks',
	'viewsCalendar',
	'viewsKanban',
	'viewsFilters',
	'interfaceTaskFinder',
	'interfaceContextMenu',
	'interfaceStateIcons',
	'interfaceTaskEditor',
	'interfaceTweaks',
	'interfaceColorPalette',
	'mobileTaskEditor',
]);

const SETTINGS_SEARCH_TAB_DESCRIPTION_KEYS: Record<OperonSettingsSecondaryTabId, OperonSettingsSearchTextKey> = {
	coreGeneral: { namespace: 'settings', key: 'settingsPageCoreGeneralDesc' },
	corePipelines: { namespace: 'settings', key: 'pipelinesDesc' },
	corePriority: { namespace: 'settings', key: 'priorityDesc' },
	coreKeymapping: { namespace: 'settings', key: 'keyMappingsDesc' },
	coreCustomKeys: { namespace: 'settings', key: 'customKeysDesc' },
	tasksInlineTasks: { namespace: 'settings', key: 'settingsPageInlineTasksDesc' },
	tasksFileTasks: { namespace: 'settings', key: 'settingsPageFileTasksDesc' },
	tasksRelationships: { namespace: 'settings', key: 'settingsPageRelationshipsDesc' },
	tasksRecurrence: { namespace: 'settings', key: 'settingsPageRecurrenceDesc' },
	tasksTracker: { namespace: 'settings', key: 'settingsPageTrackerDesc' },
	viewsCalendar: { namespace: 'calendar', key: 'calendarSettingsDesc' },
	viewsKanban: { namespace: 'settings', key: 'kanbanSettingsDesc' },
	viewsFilters: { namespace: 'filterSets', key: 'tabDesc' },
	interfaceTaskChips: { namespace: 'settings', key: 'settingsPageTaskChipsDesc' },
	interfacePinnedDock: { namespace: 'settings', key: 'settingsPagePinnedDockDesc' },
	interfaceTaskFinder: { namespace: 'settings', key: 'settingsPageTaskFinderDesc' },
	interfaceContextMenu: { namespace: 'settings', key: 'settingsPageContextMenuDesc' },
	interfaceStateIcons: { namespace: 'settings', key: 'settingsPageStateIconsDesc' },
	interfaceTaskEditor: { namespace: 'settings', key: 'settingsPageTaskEditorDesc' },
	interfaceLocationMap: { namespace: 'settings', key: 'settingsPageLocationMapDesc' },
	interfaceTweaks: { namespace: 'settings', key: 'settingsPageTweaksDesc' },
	interfaceColorPalette: { namespace: 'settings', key: 'settingsPageColorPaletteDesc' },
	mobileGeneral: { namespace: 'settings', key: 'mobileInterfaceDesc' },
	mobileTaskEditor: { namespace: 'settings', key: 'settingsPageMobileTaskEditorDesc' },
	mobileCalendar: { namespace: 'settings', key: 'settingsPageMobileCalendarDesc' },
	mobileKanban: { namespace: 'settings', key: 'settingsPageMobileKanbanDesc' },
};

const SETTINGS_SEARCH_DOCK_KEYS = new Set<OperonSettingSearchKey>([
	'pinnedTasksDesktopSurface',
	'pinnedDockColorSource',
	'pinnedDockAutoPin',
	'pinnedDockAutoUnpinFinished',
	'pinnedDockAutoCloseEnabled',
	'floatingAutoCloseSec',
	'pinnedTaskItemWidth',
	'pinnedDockDisableOnMobile',
	'pinnedDockLayout',
	'pinnedDockGridCols',
	'pinnedTasksSidebarSide',
]);

const SETTINGS_SEARCH_DOM_REFRESH_KEYS = new Set<OperonSettingSearchKey>([
	'timeFormat',
	'fileRepeatDestination',
	'flowTimeUseLastSelectedDuration',
	'pinnedDockLayout',
	'mobileGlobalTaskFabEnabled',
	'calendarMobileEnabled',
	'calendarMobileDefaultSourcePresetId',
	'calendarMobileShowAllDayItems',
]);

const SETTINGS_SEARCH_WORKSPACE_TWEAK_KEYS = new Set<OperonSettingSearchKey>([
	'workspaceTweaksHideScrollbars',
	'workspaceTweaksCollapseProperties',
	'workspaceTweaksPropertiesScope',
	'workspaceTweaksCompactSidebarTabIcons',
]);

const SETTINGS_SEARCH_FOLDER_KEYS = new Set<OperonSettingSearchKey>([
	'fileTasksFolder',
	'fileTaskTemplateFolder',
	'fileTaskArchiveFolder',
	'fileRepeatCustomFolder',
]);

const SETTINGS_SEARCH_OPTION_NUMBER_KEYS = new Set<OperonSettingSearchKey>([
	'duplicateAlertDelaySeconds',
	'taskEditorAutosaveDelaySeconds',
	'taskFinderRecentModifiedDays',
	'taskFinderVisibleResultCount',
	'pinnedDockGridCols',
	'flowTimePauseMinutes',
	'flowTimeDefaultSessionMinutes',
	'calendarMobileSlotMinutes',
	'calendarMobileAgendaPastDays',
	'calendarMobileAgendaFutureDays',
	'dynamicFileTaskFilterSubtaskAutoExpandLimit',
	'dynamicSubtasksFilterSubtaskAutoExpandLimit',
]);

export class OperonSettingsTab extends PluginSettingTab {
	private settings: OperonSettings;
	private storage: OperonStorage;
	private pluginVersion: string;
	private onSettingsChanged: () => void;
	private onDockRefreshLayout: () => void;
	private hasPendingSettingsChange = false;
	private activeTab: OperonSettingsTabId = 'coreGeneral';
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
	private filterPreviewOnContextualAction?: ContextualMenuActionHandler;
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
	private isDeclarativeSettingsRendererActive = false;
	private activeNativeSettingsPage: {
		tabId: OperonSettingsTabId;
		containerEl: HTMLElement;
		taskChipsPageId?: TaskChipsSettingsPageId;
	} | null = null;

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
		filterPreviewOnContextualAction?: ContextualMenuActionHandler,
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
		Reflect.set(this, 'icon', 'factory');
		this.settings = settings;
		this.storage = storage;
		this.pluginVersion = plugin.manifest.version;
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
			getProjectSerialDisplay: (operonId: string) => this.storage.projectSerials.getDisplayForTask(operonId),
			getProjectSerialSignature: () => this.storage.projectSerials.getSignature(),
		};
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		if (!requireApiVersion('1.13.0')) {
			this.isDeclarativeSettingsRendererActive = false;
			return [];
		}

		this.isDeclarativeSettingsRendererActive = true;
		const secondaryTabs = this.getSecondarySettingsTabs();
		const entriesByTab = this.getSettingsSearchEntriesByTab();

		const groupedSettings: SettingDefinitionItem[] = this.getPrimarySettingsTabs().map(primaryTab => {
			const childTabs = secondaryTabs.filter(tab => tab.groupId === primaryTab.id);
			return {
				type: 'group',
				heading: primaryTab.label,
				items: childTabs.map(tab => this.buildSettingsSearchTabPage(tab, entriesByTab.get(tab.id) ?? [])),
			};
		});

		return [
			this.buildReleaseNotesOverviewDefinition(),
			...groupedSettings,
		];
	}

	getControlValue(key: string): unknown {
		const entry = this.findSettingsSearchEntryByKey(key);
		if (!entry?.key) return undefined;

		const rawValue = this.getRawSettingsSearchValue(entry.key);
		if (entry.control === 'dropdown') {
			return this.getSettingsSearchDropdownValue(entry.key, rawValue);
		}
		return rawValue;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const entry = this.findSettingsSearchEntryByKey(key);
		if (!entry?.key) return;

		const normalized = this.normalizeSettingsSearchControlValue(entry, value);
		this.writeSettingsSearchValue(entry.key, normalized);
		this.applySettingsSearchBeforeSaveEffects(entry.key, normalized);
		await this.saveSettings();
		this.applySettingsSearchAfterSaveEffects(entry.key);
	}

	private getSettingsSearchEntriesByTab(): Map<OperonSettingsTabId, OperonSettingsSearchEntry[]> {
		const entriesByTab = new Map<OperonSettingsTabId, OperonSettingsSearchEntry[]>();
		for (const entry of OPERON_SETTINGS_SEARCH_REGISTRY) {
			if (!this.isSettingsTabId(entry.tabId)) continue;
			if (entry.id === 'settings.legacyStorageCleanup' && !this.shouldExposeLegacyStorageCleanupEntry()) continue;
			const tabEntries = entriesByTab.get(entry.tabId) ?? [];
			tabEntries.push(entry);
			entriesByTab.set(entry.tabId, tabEntries);
		}
		return entriesByTab;
	}

	private shouldExposeLegacyStorageCleanupEntry(): boolean {
		return this.storage.getCachedLegacyStorageCleanupStatus()?.legacyExists === true;
	}

	private buildSettingsSearchTabPage(
		tab: SettingsTabDefinition<OperonSettingsTabId>,
		entries: OperonSettingsSearchEntry[],
	): SettingDefinitionPage {
		const pageName = this.getSettingsSearchTabPageName(tab);
		const desc = this.getSettingsSearchTabDescription(tab.id);
		if (tab.id === 'interfaceTaskChips') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildTaskChipsSettingsPages(entries),
			};
		}

		if (tab.id === 'interfaceLocationMap') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildLocationMapSettingsItems(entries),
			};
		}

		if (tab.id === 'mobileCalendar') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildMobileCalendarSettingsItems(entries),
			};
		}

		if (tab.id === 'mobileKanban') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildMobileKanbanSettingsItems(entries),
			};
		}

		if (tab.id === 'tasksRelationships') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildRelationshipsSettingsItems(entries),
			};
		}

		if (tab.id === 'tasksRecurrence') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildRecurrenceSettingsItems(entries),
			};
		}

		if (tab.id === 'tasksTracker') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildTrackerSettingsItems(entries),
			};
		}

		if (tab.id === 'interfacePinnedDock') {
			return {
				type: 'page',
				name: pageName,
				desc,
				items: this.buildPinnedDockSettingsItems(entries),
			};
		}

		if (SETTINGS_SEARCH_IMPERATIVE_PAGE_TAB_IDS.has(tab.id)) {
			return {
				type: 'page',
				name: pageName,
				desc,
				page: () => new OperonNativeSettingsPage(
					pageName,
					containerEl => this.renderNativeSettingsPage(tab.id, containerEl),
					containerEl => this.hideNativeSettingsPage(containerEl),
				),
			};
		}

		if (!SETTINGS_SEARCH_NATIVE_TAB_IDS.has(tab.id)) {
			return {
				type: 'page',
				name: pageName,
				desc,
				page: () => new OperonNativeSettingsPage(
					pageName,
					containerEl => this.renderNativeSettingsPage(tab.id, containerEl),
					containerEl => this.hideNativeSettingsPage(containerEl),
				),
			};
		}

		return {
			type: 'page',
			name: pageName,
			desc,
			items: this.buildSettingsSearchTabItems(entries),
		};
	}

	private buildTaskChipsSettingsPages(_entries: OperonSettingsSearchEntry[]): SettingDefinitionPage[] {
		return TASK_CHIPS_SETTINGS_PAGE_ORDER.map(pageId => {
			const meta = TASK_CHIPS_SETTINGS_PAGE_META[pageId];
			const pageName = t('settings', meta.titleKey);
			return {
				type: 'page',
				name: pageName,
				desc: t('settings', meta.descKey),
				page: () => new OperonNativeSettingsPage(
					pageName,
					containerEl => this.renderNativeTaskChipsSettingsPage(pageId, containerEl),
					containerEl => this.hideNativeSettingsPage(containerEl),
				),
			};
		});
	}

	private buildStateIconsSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const sourceEntry = this.buildSettingsSearchSettingDefinition(entries, 'fallbackTaskIconSource');
		return [
			{
				type: 'group',
				heading: t('settings', 'fallbackTaskStateIcons'),
				items: this.compactSettingsSearchDefinitions([
					sourceEntry,
					this.buildStateIconRowsSettingsDefinition(),
				]),
			},
		];
	}

	private buildTaskFinderSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const hotkeysEntry = entries.find(entry => entry.id === 'ui.taskFinderHotkeys');
		return this.compactSettingsSearchItems([
			{
				type: 'group',
				heading: t('settings', 'taskFinderBehaviorSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'taskFinderRecentModifiedDays'),
					this.buildSettingsSearchSettingDefinition(entries, 'taskFinderVisibleResultCount'),
					this.buildSettingsSearchSettingDefinition(entries, 'taskFinderRememberLastScopes'),
				]),
			},
			this.buildSettingsSearchRenderDefinition(hotkeysEntry, containerEl => {
				this.renderTaskFinderShortcutSettings(containerEl);
			}),
		]);
	}

	private buildTaskEditorSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const workflowPickerEntry = entries.find(entry => entry.id === 'ui.taskEditorWorkflowPickers');
		return this.compactSettingsSearchItems([
			{
				type: 'group',
					heading: t('settings', 'subtabTaskEditor'),
					items: this.compactSettingsSearchDefinitions([
						this.buildSettingsSearchSettingDefinition(entries, 'taskEditorShowLineNumbers'),
						this.buildSettingsSearchSettingDefinition(entries, 'taskEditorAutosaveDelaySeconds'),
					]),
				},
			this.buildSettingsSearchRenderDefinition(workflowPickerEntry, containerEl => {
				const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskEditorWorkflowPickers'));
				this.applyInterfaceIconListSectionStyle(sectionEl);
				this.renderTaskEditorWorkflowPickerSettingsSection(sectionEl);
				this.markSettingsSearchSectionTarget(sectionEl, 'ui.taskEditorWorkflowPickers');
			}),
		]);
	}

	private buildMobileCalendarSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings', 'mobileSubtabCalendar'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileEnabled'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileMaxWidthPx'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileDefaultView'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileDefaultSourcePresetId'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileSlotMinutes'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileShowProjectedOccurrences'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileShowExternalCalendars'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileColorSource'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileShowDueMarkers'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileShowAllDayItems'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileAgendaPastDays'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileAgendaFutureDays'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileAgendaShowCompletedItems'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileAllDayVisibleTaskLimit'),
					this.buildSettingsSearchSettingDefinition(entries, 'calendarMobileShowCompletedItems'),
				]),
			},
		];
	}

	private buildMobileKanbanSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings', 'mobileSubtabKanban'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'kanbanMobileLayoutChromeEnabled'),
					this.buildSettingsSearchSettingDefinition(entries, 'kanbanMobileLayoutMaxWidthPx'),
					this.buildSettingsSearchSettingDefinition(entries, 'kanbanMobileCompactSwimlaneWidthPx'),
					this.buildSettingsSearchSettingDefinition(entries, 'kanbanMobileSwimlaneRailAlwaysVisible'),
					this.buildSettingsSearchSettingDefinition(entries, 'kanbanMobileHorizontalStatusSnapEnabled'),
				]),
			},
		];
	}

	private buildRelationshipsSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const inheritanceEntry = entries.find(entry => entry.id === 'automation.parentChildTaskInheritance');
		const inheritanceDefinition = this.buildSettingsSearchRenderDefinition(inheritanceEntry, containerEl => {
			this.renderParentChildTaskInheritanceSettings(containerEl);
		});
		const projectSerialsEntry = entries.find(entry => entry.id === 'automation.projectSerials');
		const projectSerialsDefinition = this.buildSettingsSearchRenderDefinition(projectSerialsEntry, containerEl => {
			this.renderProjectSerialSettings(containerEl);
		});
		return this.compactSettingsSearchItems([
			{
				type: 'group',
				heading: t('settings', 'subtabRelationships'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'estimateAutoReallocation'),
					this.buildSettingsSearchSettingDefinition(entries, 'autoParentFileTask'),
					this.buildSettingsSearchSettingDefinition(entries, 'autoParentLinkedFileSubtasks'),
					this.buildSettingsSearchSettingDefinition(entries, 'childTaskInheritanceStatusPipelineSource'),
				]),
			},
			inheritanceDefinition,
			projectSerialsDefinition,
		]);
	}

	private buildRecurrenceSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const cleanupEntry = entries.find(entry => entry.id === 'automation.repeatYamlCleanup');
		const cleanupDefinition = this.buildSettingsSearchRenderDefinition(cleanupEntry, containerEl => {
			this.renderRepeatSeriesYamlPropertyRemovalBody(containerEl);
		});
		return this.compactSettingsSearchItems([
			{
				type: 'group',
				heading: t('settings', 'repeatingTasks'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'newOccurrencePosition'),
					this.buildSettingsSearchSettingDefinition(entries, 'fileRepeatDestination'),
					this.buildFileRepeatCustomFolderSettingsDefinition(entries),
				]),
			},
			cleanupDefinition
				? {
					type: 'group',
					heading: t('settings', 'repeatYamlPropertyRemovalTitle'),
					items: [cleanupDefinition],
				}
				: null,
		]);
	}

	private buildFileRepeatCustomFolderSettingsDefinition(entries: OperonSettingsSearchEntry[]): SettingDefinition | null {
		const definition = this.buildSettingsSearchSettingDefinition(entries, 'fileRepeatCustomFolder');
		if (!definition) return null;
		return {
			...definition,
			visible: () => this.settings.fileRepeatDestination === 'custom-folder',
		};
	}

	private buildTrackerSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings', 'trackerMainSettingsSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'trackerSplitSessionsAtMidnight'),
					this.buildSettingsSearchSettingDefinition(entries, 'trackerShowStatusBarTimer'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'trackerSessionHistorySection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'trackerHistoryDays'),
					this.buildSettingsSearchSettingDefinition(entries, 'trackerTaskDescriptionClickAction'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'trackerFlowTimeSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'flowTimePauseMinutes'),
					this.buildSettingsSearchSettingDefinition(entries, 'flowTimeUseLastSelectedDuration'),
					this.buildSettingsSearchSettingDefinition(entries, 'flowTimeDefaultSessionMinutes'),
					this.buildSettingsSearchSettingDefinition(entries, 'flowTimeShowNumericTimer'),
					this.buildSettingsSearchSettingDefinition(entries, 'flowTimeNotifyOnTargetReached'),
				]),
			},
		];
	}

	private buildPinnedDockSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings', 'pinnedTasksSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedTasksDesktopSurface'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'pinnedTasksSharedSettings'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockColorSource'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockAutoPin'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockAutoUnpinFinished'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'pinnedTasksSidebarSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedTasksSidebarSide'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'pinnedDockSection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockAutoCloseEnabled'),
					this.buildSettingsSearchSettingDefinition(entries, 'floatingAutoCloseSec'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedTaskItemWidth'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockDisableOnMobile'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockLayout'),
					this.buildSettingsSearchSettingDefinition(entries, 'pinnedDockGridCols'),
				]),
			},
		];
	}

	private buildContextMenuSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const actionsEntry = entries.find(entry => entry.id === 'ui.contextMenuActions');
		const matrixEntry = entries.find(entry => entry.id === 'ui.contextMenuMatrix');
		const mobileAutoHideEntry = this.findSettingsSearchEntryByKey('contextualMenuMobileAutoHideMs');
		return this.compactSettingsSearchItems([
			{
				type: 'group',
				heading: t('settings', 'contextMenuDelaySection'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'contextualMenuOpenDelayMs'),
				]),
			},
			{
				type: 'group',
				heading: t('settings', 'contextualMenuMobile'),
				items: this.compactSettingsSearchDefinitions([
					this.buildSettingsSearchSettingDefinition(entries, 'contextualMenuMobileEnabled'),
					this.buildSettingsSearchSettingDefinition(entries, 'contextualMenuMobileLongPressMs'),
					this.buildSettingsSearchSettingDefinition(entries, 'contextualMenuMobileTransitionGraceMs'),
					this.buildSettingsSearchSettingDefinitionFromEntry(mobileAutoHideEntry),
				]),
			},
			this.buildSettingsSearchRenderDefinition(actionsEntry, containerEl => {
				this.renderContextualMenuActionsSettingsSection(containerEl);
			}),
			this.buildSettingsSearchRenderDefinition(matrixEntry, containerEl => {
				this.renderContextualMenuMatrixSettingsSection(containerEl);
			}),
		]);
	}

	private buildMobileTaskEditorSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const coreToolsEntry = entries.find(entry => entry.id === 'ui.taskEditorMobileCoreTools');
		return this.compactSettingsSearchItems([
			this.buildSettingsSearchRenderDefinition(coreToolsEntry, containerEl => {
				const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskEditorMobileCoreTools'));
				this.applyInterfaceIconListSectionStyle(sectionEl);
				this.renderTaskEditorMobileCoreToolSettingsSection(sectionEl);
				this.markSettingsSearchSectionTarget(sectionEl, 'ui.taskEditorMobileCoreTools');
			}),
		]);
	}

	private buildSettingsSearchSettingDefinition(
		entries: OperonSettingsSearchEntry[],
		key: OperonSettingSearchKey,
		extraEntries: OperonSettingsSearchEntry[] = [],
	): SettingDefinition | null {
		const entry = entries.find(candidate => candidate.key === key);
		return this.buildSettingsSearchSettingDefinitionFromEntry(entry, extraEntries);
	}

	private buildSettingsSearchSettingDefinitionFromEntry(
		entry: OperonSettingsSearchEntry | null | undefined,
		extraEntries: OperonSettingsSearchEntry[] = [],
	): SettingDefinition | null {
		if (!entry) return null;
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliasesForEntries([entry, ...extraEntries]),
			control: this.buildSettingsSearchControl(entry),
		};
	}

	private buildSettingsSearchRenderDefinition(
		entry: OperonSettingsSearchEntry | undefined,
		render: (containerEl: HTMLElement) => void,
	): SettingDefinition | null {
		if (!entry) return null;
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliases(entry),
			render: setting => {
				setting.settingEl.empty();
				setting.settingEl.addClass('operon-settings-search-bounded-render');
				render(setting.settingEl);
			},
		};
	}

	private buildStateIconRowsSettingsDefinition(): SettingDefinition {
		return {
			name: t('settings', 'fallbackTaskStateIcons'),
			desc: this.getSettingsSearchTabDescription('interfaceStateIcons'),
			aliases: [
				'state icons',
				'fallback icons',
				'open state icon',
				'finished state icon',
				'cancelled state icon',
			],
			render: setting => {
				setting.settingEl.empty();
				setting.settingEl.addClass('operon-settings-search-bounded-render');
				this.renderStateIconSetting(setting.settingEl, 'open', t('settings', 'fallbackOpenStateIcon'), t('settings', 'fallbackOpenStateIconDesc'));
				this.renderStateIconSetting(setting.settingEl, 'done', t('settings', 'fallbackFinishedStateIcon'), t('settings', 'fallbackFinishedStateIconDesc'));
				this.renderStateIconSetting(setting.settingEl, 'cancelled', t('settings', 'fallbackCancelledStateIcon'), t('settings', 'fallbackCancelledStateIconDesc'));
			},
		};
	}

	private compactSettingsSearchItems(items: Array<SettingDefinitionItem | null>): SettingDefinitionItem[] {
		return items.filter((item): item is SettingDefinitionItem => item !== null);
	}

	private compactSettingsSearchDefinitions(items: Array<SettingDefinition | null>): SettingDefinition[] {
		return items.filter((item): item is SettingDefinition => item !== null);
	}

	private buildLocationMapSettingsItems(entries: OperonSettingsSearchEntry[]): SettingDefinitionItem[] {
		const placeVisualsSectionEntry = entries.find(entry => entry.id === 'ui.locationPlaceVisualProperties');
		const entry = (key: OperonSettingSearchKey, extraEntries: OperonSettingsSearchEntry[] = []): SettingDefinition | null =>
			this.buildLocationMapSettingDefinition(entries, key, extraEntries);

		const visualItems = [
			entry('locationPlaceIconPropertyName', placeVisualsSectionEntry ? [placeVisualsSectionEntry] : []),
			entry('locationPlaceColorPropertyName'),
		].filter((definition): definition is SettingDefinition => definition !== null);
		const pickerItems = [
			entry('locationMapsAlwaysLightMode'),
			entry('locationPickerMapDefaultCenter'),
			entry('locationPickerMapDefaultZoom'),
		].filter((definition): definition is SettingDefinition => definition !== null);
		const previewItems = [
			entry('locationPreviewWidth'),
			entry('locationPreviewHeight'),
			entry('locationPreviewDefaultZoom'),
			entry('locationPreviewMinZoom'),
			entry('locationPreviewMaxZoom'),
		].filter((definition): definition is SettingDefinition => definition !== null);

		return [
			{
				type: 'group',
				heading: t('settings', 'locationPlaceVisualPropertiesSection'),
				items: visualItems,
			},
			{
				type: 'group',
				heading: t('settings', 'locationPickerMapSection'),
				items: pickerItems,
			},
			{
				type: 'group',
				heading: t('settings', 'locationPreviewSection'),
				items: previewItems,
			},
		];
	}

	private buildLocationMapSettingDefinition(
		entries: OperonSettingsSearchEntry[],
		key: OperonSettingSearchKey,
		extraEntries: OperonSettingsSearchEntry[] = [],
	): SettingDefinition | null {
		const entry = entries.find(candidate => candidate.key === key);
		if (!entry) return null;
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliasesForEntries([entry, ...extraEntries]),
			control: this.buildLocationMapSettingControl(entry),
		};
	}

	private buildLocationMapSettingControl(entry: OperonSettingsSearchEntry): SettingControl {
		const control = this.buildSettingsSearchControl(entry);
		if (entry.control !== 'text') return control;
		const textControl = control as Extract<SettingControl, { type: 'text' }>;
		if (entry.key === 'locationPlaceIconPropertyName') {
			return { ...textControl, placeholder: 'Icon' };
		}
		if (entry.key === 'locationPlaceColorPropertyName') {
			return { ...textControl, placeholder: 'Color' };
		}
		if (entry.key === 'locationPickerMapDefaultCenter') {
			return { ...textControl, placeholder: t('location', 'coordinatePlaceholder') };
		}
		return control;
	}

	private buildReleaseNotesOverviewDefinition(): SettingDefinition {
		return {
			name: t('settings', 'releaseNotesCardTitle', { version: this.pluginVersion }),
			desc: t('settings', 'releaseNotesCardDesc'),
			searchable: false,
			render: setting => {
				setting.settingEl.addClass('operon-release-notes-overview-setting');
				setting
					.setName(t('settings', 'releaseNotesCardTitle', { version: this.pluginVersion }))
					.setDesc(t('settings', 'releaseNotesCardDesc'))
					.addButton(button => {
						button
							.setButtonText(t('settings', 'releaseNotesViewRecent'))
							.onClick(() => {
								new OperonReleaseNotesModal(this.app, getReleaseNotesForManualView()).open();
							});
					});
			},
		};
	}

	private buildSettingsSearchTargetDefinition(entry: OperonSettingsSearchEntry): SettingDefinition {
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliases(entry),
			render: (setting, group) => {
				const pageRoot = this.resolveSettingsSearchRenderRoot(setting, group);
				if (!pageRoot?.hasClass('operon-settings-native-page-root')) {
					this.hideSettingsSearchMissingTarget(setting.settingEl);
					return;
				}
				const targetEl = this.findSettingsSearchTarget(pageRoot, entry, setting.settingEl);
				this.replaceSettingsSearchTarget(setting.settingEl, targetEl);
			},
		};
	}

	private resolveSettingsSearchRenderRoot(setting: Setting, group: unknown): HTMLElement | null {
		if (typeof group === 'object' && group !== null) {
			for (const key of ['listEl', 'containerEl', 'contentEl'] as const) {
				const candidate = asHTMLElement(Reflect.get(group, key), setting.settingEl);
				if (candidate && candidate !== setting.settingEl) return candidate;
			}
		}
		return setting.settingEl.parentElement;
	}

	private findSettingsSearchTarget(pageRoot: HTMLElement, entry: OperonSettingsSearchEntry, searchEl: HTMLElement): HTMLElement | null {
		if (entry.id) {
			for (const candidate of Array.from(pageRoot.querySelectorAll<HTMLElement>('[data-operon-settings-search-id]'))) {
				if (candidate === searchEl || candidate.contains(searchEl)) continue;
				if (candidate.dataset.operonSettingsSearchId === entry.id) return candidate;
			}
		}

		if (entry.key) {
			for (const candidate of Array.from(pageRoot.querySelectorAll<HTMLElement>('[data-operon-settings-search-key]'))) {
				if (candidate === searchEl || candidate.contains(searchEl)) continue;
				if (candidate.dataset.operonSettingsSearchKey === entry.key) return candidate;
			}
		}

		const name = this.normalizeSettingsSearchTargetText(this.getSettingsSearchText(entry.name));
		if (!name) return null;
		for (const item of Array.from(pageRoot.querySelectorAll<HTMLElement>('.setting-item'))) {
			if (item === searchEl || item.contains(searchEl)) continue;
			const itemName = item.querySelector<HTMLElement>('.setting-item-name');
			if (itemName && this.normalizeSettingsSearchTargetText(itemName.textContent ?? '') === name) return item;
		}
		for (const section of Array.from(pageRoot.querySelectorAll<HTMLElement>('.operon-native-settings-section'))) {
			if (section === searchEl || section.contains(searchEl)) continue;
			const title = section.querySelector<HTMLElement>('.operon-native-settings-section-title');
			if (title && this.normalizeSettingsSearchTargetText(title.textContent ?? '') === name) return section;
		}
		return null;
	}

	private replaceSettingsSearchTarget(searchEl: HTMLElement, targetEl: HTMLElement | null): void {
		if (!targetEl || targetEl === searchEl) {
			this.hideSettingsSearchMissingTarget(searchEl);
			return;
		}

		searchEl.empty();
		for (const attrName of Array.from(searchEl.getAttributeNames())) {
			searchEl.removeAttribute(attrName);
		}
		for (const attr of Array.from(targetEl.attributes)) {
			searchEl.setAttribute(attr.name, attr.value);
		}
		while (targetEl.firstChild) {
			searchEl.appendChild(targetEl.firstChild);
		}
		targetEl.replaceWith(searchEl);
	}

	private hideSettingsSearchMissingTarget(searchEl: HTMLElement): void {
		searchEl.empty();
		searchEl.addClass('operon-settings-search-missing-target');
	}

	private normalizeSettingsSearchTargetText(text: string): string {
		return text.replace(/\s+/g, ' ').trim().toLowerCase();
	}

	private markSettingsSearchTarget(setting: Setting, key: string): Setting {
		setting.settingEl.dataset.operonSettingsSearchKey = key;
		return setting;
	}

	private markSettingsSearchSectionTarget(sectionBodyEl: HTMLElement, id: string): HTMLElement {
		const sectionEl = sectionBodyEl.closest<HTMLElement>('.operon-native-settings-section') ?? sectionBodyEl;
		sectionEl.dataset.operonSettingsSearchId = id;
		return sectionEl;
	}

	private buildSettingsSearchTabItems(
		entries: OperonSettingsSearchEntry[],
	): SettingDefinition[] {
		const definitions: SettingDefinition[] = [];
		for (const entry of entries) {
			if (entry.control === 'render' || !entry.key) {
				definitions.push(this.buildCustomSettingsSearchDefinition(entry));
			} else {
				definitions.push(this.buildNativeSettingsSearchDefinition(entry));
			}
		}

		return definitions;
	}

	private renderNativeSettingsPage(tabId: OperonSettingsTabId, containerEl: HTMLElement): void {
		if (this.activeNativeSettingsPage?.containerEl !== containerEl) {
			this.clearActiveNativeSettingsPage(containerEl);
		}

		this.activeNativeSettingsPage = { tabId, containerEl };
		containerEl.empty();
		containerEl.addClass('operon-settings-tab-root');
		containerEl.addClass('operon-settings-native-page-root');
		this.renderSettingsTab(tabId, containerEl);
	}

	private renderNativeTaskChipsSettingsPage(pageId: TaskChipsSettingsPageId, containerEl: HTMLElement): void {
		if (this.activeNativeSettingsPage?.containerEl !== containerEl) {
			this.clearActiveNativeSettingsPage(containerEl);
		}

		this.activeNativeSettingsPage = { tabId: 'interfaceTaskChips', containerEl, taskChipsPageId: pageId };
		containerEl.empty();
		containerEl.addClass('operon-settings-tab-root');
		containerEl.addClass('operon-settings-native-page-root');
		this.renderTaskChipsSettingsPageContent(pageId, containerEl, { omitNativeTitle: true });
	}

	private hideNativeSettingsPage(containerEl: HTMLElement): void {
		this.clearNativeSettingsPage(containerEl);
	}

	private clearActiveNativeSettingsPage(exceptContainerEl?: HTMLElement): void {
		const activePage = this.activeNativeSettingsPage;
		if (!activePage || activePage.containerEl === exceptContainerEl) return;
		this.clearNativeSettingsPage(activePage.containerEl);
	}

	private clearNativeSettingsPage(containerEl: HTMLElement): void {
		closeFloatingPanelsForRoot(containerEl);
		containerEl.empty();
		containerEl.removeClass('operon-settings-tab-root');
		containerEl.removeClass('operon-settings-native-page-root');
		if (this.activeNativeSettingsPage?.containerEl === containerEl) {
			this.activeNativeSettingsPage = null;
		}
	}

	private getSettingsSearchTabDescription(tabId: OperonSettingsTabId): string {
		if (!this.isSecondarySettingsTabId(tabId)) return '';
		return this.getSettingsSearchText(SETTINGS_SEARCH_TAB_DESCRIPTION_KEYS[tabId]);
	}

	private getSettingsSearchTabPageName(tab: SettingsTabDefinition<OperonSettingsTabId>): string {
		if (tab.groupId === 'mobile') {
			return `${t('settings', 'tabMobile')} ${tab.label}`;
		}
		return tab.label;
	}

	private buildNativeSettingsSearchDefinition(entry: OperonSettingsSearchEntry): SettingDefinition {
		if (!entry.key) return this.buildCustomSettingsSearchDefinition(entry);
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliases(entry),
			control: this.buildSettingsSearchControl(entry),
		};
	}

	private buildCustomSettingsSearchDefinition(entry: OperonSettingsSearchEntry): SettingDefinition {
		return {
			name: this.getSettingsSearchText(entry.name),
			desc: this.getSettingsSearchText(entry.desc),
			aliases: this.getSettingsSearchAliases(entry),
			render: setting => {
				this.renderSettingsSearchCustomEntry(entry, setting);
			},
		};
	}

	private buildSettingsSearchControl(entry: OperonSettingsSearchEntry): SettingControl {
		const key = entry.key;
		if (!key) {
			return {
				type: 'text',
				key: entry.id,
				defaultValue: '',
				disabled: true,
			};
		}

		if (entry.control === 'toggle') {
			return {
				type: 'toggle',
				key,
				defaultValue: Boolean(this.getDefaultSettingsSearchValue(key)),
			};
		}
		if (entry.control === 'dropdown') {
			const options = this.getSettingsSearchDropdownOptions(key);
			const fallbackValue = this.getSettingsSearchDropdownValue(key, this.getDefaultSettingsSearchValue(key));
			return {
				type: 'dropdown',
				key,
				defaultValue: Object.prototype.hasOwnProperty.call(options, fallbackValue)
					? fallbackValue
					: Object.keys(options)[0] ?? '',
				options,
			};
		}
		if (entry.control === 'folder') {
			return {
				type: 'folder',
				key,
				defaultValue: this.stringifySettingsSearchValue(this.getDefaultSettingsSearchValue(key)),
				placeholder: this.getSettingsSearchFolderPlaceholder(key),
				includeRoot: true,
			};
		}
		if (entry.control === 'file') {
			return {
				type: 'file',
				key,
				defaultValue: this.stringifySettingsSearchValue(this.getDefaultSettingsSearchValue(key)),
				placeholder: t('settings', 'inlineTaskTargetFilePlaceholder'),
				filter: file => file.extension === 'md',
			};
		}
		if (entry.control === 'number') {
			const constraint = getNumericConstraint(key);
			return {
				type: 'number',
				key,
				defaultValue: this.normalizeSettingsSearchNumberValue(key, this.getDefaultSettingsSearchValue(key)),
				min: constraint?.min,
				max: constraint?.max,
				step: 1,
				disabled: key === 'flowTimeDefaultSessionMinutes'
					? () => this.settings.flowTimeUseLastSelectedDuration
					: undefined,
			};
		}
		return {
			type: 'text',
			key,
			defaultValue: this.stringifySettingsSearchValue(this.getDefaultSettingsSearchValue(key)),
		};
	}

	private renderSettingsSearchCustomEntry(entry: OperonSettingsSearchEntry, setting: Setting): void {
		if (entry.id === 'settings.legacyStorageCleanup') {
			this.renderLegacyStorageCleanupSearchEntry(setting);
			return;
		}

		setting.setName(this.getSettingsSearchText(entry.name));
		setting.setDesc(this.getSettingsSearchText(entry.desc));

		if (entry.key === 'language') {
			this.configureLanguageDropdownSetting(setting);
			return;
		}

		if (entry.id === 'settings.demoWorkspace') {
			setting.addButton(button => {
				button
					.setButtonText(t('settings', 'demoWorkspaceCreate'))
					.setCta()
					.onClick(settingsAsyncHandler('settings create demo workspace failed', async () => {
						await this.createBasicsWorkspace();
					}));
			});
			return;
		}

		if (entry.id === 'ui.mobileGlobalTaskFabReset') {
			setting.addButton(button => {
				button
					.setButtonText(t('settings', 'mobileGlobalTaskFabResetPositionButton'))
					.onClick(settingsAsyncHandler('settings mobile quick-create position reset failed', async () => {
						this.settings.mobileGlobalTaskFabPosition = null;
						await this.saveSettings();
						this.refreshNativeSettingsDom();
					}));
			});
		}
	}

	private getSettingsSearchAliases(entry: OperonSettingsSearchEntry): string[] {
		return this.getSettingsSearchAliasesForEntries([entry]);
	}

	private getSettingsSearchAliasesForEntries(entries: OperonSettingsSearchEntry[]): string[] {
		const aliases = new Set<string>();
		for (const entry of entries) {
			for (const alias of entry.aliases ?? []) {
				aliases.add(alias.trim());
			}
		}
		return [...aliases].filter(alias => alias.trim().length > 0);
	}

	private getSettingsSearchText(ref: OperonSettingsSearchTextKey): string {
		return t(ref.namespace as Parameters<typeof t>[0], ref.key);
	}

	private stringifySettingsSearchValue(value: unknown): string {
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		return '';
	}

	private findSettingsSearchEntryByKey(key: string): OperonSettingsSearchEntry | null {
		return OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === key) ?? null;
	}

	private isSettingsTabId(tabId: string): tabId is OperonSettingsTabId {
		return this.getPrimarySettingsTabs().some(tab => tab.id === tabId)
			|| this.getSecondarySettingsTabs().some(tab => tab.id === tabId);
	}

	private isSecondarySettingsTabId(tabId: string): tabId is OperonSettingsSecondaryTabId {
		return this.getSecondarySettingsTabs().some(tab => tab.id === tabId);
	}

	private getRawSettingsSearchValue(key: OperonSettingSearchKey): unknown {
		if (key === 'calendarMobileDefaultSourcePresetId') {
			return this.settings.calendarMobileDefaultSourcePresetId
				?? this.settings.calendarDefaultPresetId
				?? this.settings.calendarPresets[0]?.id
				?? '';
		}
		const settingsRecord = this.settings as unknown as Record<string, unknown>;
		const value = settingsRecord[key];
		return value ?? this.getDefaultSettingsSearchValue(key);
	}

	private getDefaultSettingsSearchValue(key: OperonSettingSearchKey): unknown {
		return (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
	}

	private writeSettingsSearchValue(key: OperonSettingSearchKey, value: unknown): void {
		if (isNumericSettingKey(key) && typeof value === 'number') {
			setNumericSetting(this.settings, key, value);
			return;
		}
		(this.settings as unknown as Record<string, unknown>)[key] = value;
	}

	private normalizeSettingsSearchControlValue(entry: OperonSettingsSearchEntry, value: unknown): unknown {
		if (!entry.key) return value;
		if (entry.control === 'toggle') {
			return value === true || value === 'true';
		}
		if (entry.control === 'number') {
			return this.normalizeSettingsSearchNumberValue(entry.key, value);
		}
		if (entry.control === 'dropdown') {
			return this.normalizeSettingsSearchDropdownValue(entry.key, value);
		}
		return this.normalizeSettingsSearchTextValue(entry.key, value);
	}

	private normalizeSettingsSearchTextValue(key: OperonSettingSearchKey, value: unknown): string {
		const text = this.stringifySettingsSearchValue(value);
		if (SETTINGS_SEARCH_FOLDER_KEYS.has(key)) {
			return normalizeSettingsFolderPath(text);
		}
		if (key === 'inlineTaskHeading') {
			return normalizeInlineTaskHeadingKeyword(text);
		}
		if (key === 'inlineTaskParentFileHeadingKeyword') {
			return normalizeInlineTaskParentFileHeadingKeyword(text);
		}
		return text;
	}

	private normalizeSettingsSearchNumberValue(key: OperonSettingSearchKey, value: unknown): number {
		if (SETTINGS_SEARCH_OPTION_NUMBER_KEYS.has(key)) {
			return this.normalizeSettingsSearchNumberOption(key, value);
		}

		const fallback = this.getDefaultSettingsSearchValue(key);
		const fallbackNumber = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0;
		const parsed = typeof value === 'number'
			? value
			: Number.parseFloat(this.stringifySettingsSearchValue(value));
		const finite = Number.isFinite(parsed) ? parsed : fallbackNumber;
		const constraint = getNumericConstraint(key);
		if (!constraint) return Math.round(finite);
		const max = typeof constraint.max === 'number' ? constraint.max : finite;
		return Math.round(Math.min(Math.max(finite, constraint.min), max));
	}

	private normalizeSettingsSearchNumberOption(key: OperonSettingSearchKey, value: unknown): number {
		const parsed = typeof value === 'number'
			? value
			: Number.parseInt(this.stringifySettingsSearchValue(value), 10);
		const allowed = this.getSettingsSearchNumberOptions(key);
		const fallback = this.getDefaultSettingsSearchValue(key);
		return allowed.includes(parsed)
			? parsed
			: typeof fallback === 'number'
				? fallback
				: allowed[0] ?? 0;
	}

	private getSettingsSearchNumberOptions(key: OperonSettingSearchKey): number[] {
		if (key === 'duplicateAlertDelaySeconds') return [...DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS];
		if (key === 'taskEditorAutosaveDelaySeconds') return [...TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS];
		if (key === 'taskFinderRecentModifiedDays') return [1, 2, 3, 4, 5, 6, 7];
		if (key === 'taskFinderVisibleResultCount') return [3, 4, 5, 6, 7, 8, 9];
		if (key === 'pinnedDockGridCols') return [2, 3, 4, 5];
		if (key === 'flowTimePauseMinutes') return [...FLOW_TIME_PAUSE_MINUTE_OPTIONS];
		if (key === 'flowTimeDefaultSessionMinutes') return [...FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS];
		if (key === 'calendarMobileSlotMinutes') return [...CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS];
		if (key === 'calendarMobileAgendaPastDays') return [...CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS];
		if (key === 'calendarMobileAgendaFutureDays') return [...CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS];
		if (key === 'dynamicFileTaskFilterSubtaskAutoExpandLimit' || key === 'dynamicSubtasksFilterSubtaskAutoExpandLimit') {
			return [...DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS];
		}
		return [];
	}

	private normalizeSettingsSearchDropdownValue(key: OperonSettingSearchKey, value: unknown): unknown {
		if (SETTINGS_SEARCH_OPTION_NUMBER_KEYS.has(key)) {
			return this.normalizeSettingsSearchNumberOption(key, value);
		}

		const text = this.stringifySettingsSearchValue(value);
		if (key === 'language') {
			return isSupportedLanguage(text) ? text : DEFAULT_SETTINGS.language;
		}
		if (key === 'timeFormat') {
			return text === '12h' ? '12h' : '24h';
		}
		if (key === 'inlineTaskSaveMode') {
			return text === 'active-file' || text === 'specific-file' || text === 'ask-every-time' ? text : 'daily-notes';
		}
		if (key === 'inlineTaskParentInlineTargetMode') {
			return text === 'default' ? 'default' : 'below-parent';
		}
		if (key === 'inlineTaskParentFileTargetMode') {
			return text === 'default' ? 'default' : 'inside-parent-file';
		}
		if (key === 'fileTaskParentInlineTargetMode' || key === 'fileTaskParentFileTargetMode') {
			return text === 'default' ? 'default' : 'same-folder';
		}
		if (key === 'childTaskInheritanceStatusPipelineSource') {
			return normalizeChildTaskInheritanceStatusPipelineSource(text);
		}
		if (key === 'newOccurrencePosition') {
			return text === 'above' ? 'above' : 'below';
		}
		if (key === 'fileRepeatDestination') {
			return text === 'custom-folder' ? 'custom-folder' : 'same-folder';
		}
		if (key === 'dynamicFileTaskFilterPlacement') {
			return text === 'body-bottom' ? text : 'body-top';
		}
		if (key === 'trackerTaskDescriptionClickAction') {
			return text === 'jumpToSource' ? 'jumpToSource' : 'openTaskEditor';
		}
		if (key === 'pinnedTasksDesktopSurface') {
			return text === 'sidebar' ? 'sidebar' : 'floating';
		}
		if (key === 'fallbackTaskIconSource') {
			return normalizeFallbackTaskIconSource(text);
		}
		if (key === 'workspaceTweaksPropertiesScope') {
			return text === 'all-notes' ? 'all-notes' : 'operon-file-tasks';
		}
		if (key === 'pinnedDockColorSource') {
			return normalizeTaskColorSource(text, PINNED_DOCK_TASK_COLOR_SOURCES, DEFAULT_SETTINGS.pinnedDockColorSource);
		}
		if (key === 'pinnedDockLayout') {
			return text === 'vertical' || text === 'grid' ? text : 'horizontal';
		}
		if (key === 'pinnedTasksSidebarSide') {
			return text === 'right' ? 'right' : 'left';
		}
		if (key === 'calendarDefaultPresetId') {
			return this.settings.calendarPresets.some(preset => preset.id === text)
				? text
				: this.settings.calendarPresets[0]?.id ?? null;
		}
		if (key === 'calendarMobileDefaultSourcePresetId') {
			return this.settings.calendarPresets.some(preset => preset.id === text)
				? text
				: this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? null;
		}
		if (key === 'calendarWeekStart') {
			return text === 'sunday' ? 'sunday' : 'monday';
		}
		if (key === 'calendarInitialScrollMode') {
			return text === 'fixedHour' ? 'fixedHour' : 'autoNow';
		}
		if (key === 'calendarDayTitleAction') {
			return text === 'nothing' ? 'nothing' : 'create-open-daily-note';
		}
		if (key === 'calendarMobileDefaultView') {
			return text === 'day' || text === 'threeDay' ? text : 'agenda';
		}
		if (key === 'calendarMobileColorSource') {
			return normalizeTaskColorSource(text, CALENDAR_TASK_COLOR_SOURCES, DEFAULT_SETTINGS.calendarMobileColorSource);
		}
		if (key === 'calendarMobileAllDayVisibleTaskLimit') {
			if (text === 'all') return 'all';
			const parsed = Number.parseInt(text, 10);
			return CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS.includes(parsed as CalendarMobileAllDayVisibleTaskLimit)
				? parsed
				: DEFAULT_SETTINGS.calendarMobileAllDayVisibleTaskLimit;
		}
		if (key === 'kanbanDefaultPresetId') {
			return this.settings.kanbanPresets.some(preset => preset.id === text)
				? text
				: this.settings.kanbanPresets[0]?.id ?? null;
		}
		return text;
	}

	private getSettingsSearchDropdownValue(key: OperonSettingSearchKey, value: unknown): string {
		if (key === 'calendarMobileDefaultSourcePresetId') {
			return this.stringifySettingsSearchValue(value ?? this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? '');
		}
		if (value == null) return '';
		return this.stringifySettingsSearchValue(value);
	}

	private getSettingsSearchFolderPlaceholder(key: OperonSettingSearchKey): string {
		if (key === 'fileTasksFolder') return t('settings', 'fileTasksFolderPlaceholder');
		if (key === 'fileTaskTemplateFolder') return t('settings', 'fileTaskTemplateFolderPlaceholder');
		if (key === 'fileTaskArchiveFolder') return t('settings', 'fileTaskArchiveFolderPlaceholder');
		if (key === 'fileRepeatCustomFolder') return t('settings', 'fileRepeatCustomFolderPlaceholder');
		return '';
	}

	private getSettingsSearchDropdownOptions(key: OperonSettingSearchKey): Record<string, string> {
		if (key === 'language') {
			return Object.fromEntries(
				this.getLanguageDropdownOptions().map(option => [option.value, option.label]),
			);
		}
		if (key === 'timeFormat') {
			return {
				'24h': t('settings', 'timeFormat24h'),
				'12h': t('settings', 'timeFormat12h'),
			};
		}
		if (key === 'inlineTaskSaveMode') {
			return {
				'daily-notes': t('settings', 'inlineTaskSavePathDailyNotes'),
				'active-file': t('settings', 'inlineTaskSavePathActiveFile'),
				'specific-file': t('settings', 'inlineTaskSavePathSpecificFile'),
				'ask-every-time': t('settings', 'inlineTaskSavePathAskEveryTime'),
			};
		}
		if (key === 'inlineTaskParentInlineTargetMode') {
			return {
				'below-parent': t('settings', 'inlineParentTaskTargetBelowParent'),
				default: t('settings', 'inlineParentTaskTargetDefault'),
			};
		}
		if (key === 'inlineTaskParentFileTargetMode') {
			return {
				'inside-parent-file': t('settings', 'fileParentTaskTargetInsideParentFile'),
				default: t('settings', 'fileParentTaskTargetDefault'),
			};
		}
		if (key === 'fileTaskParentInlineTargetMode' || key === 'fileTaskParentFileTargetMode') {
			return {
				'same-folder': key === 'fileTaskParentInlineTargetMode'
					? t('settings', 'fileTaskInlineParentTargetSameFolder')
					: t('settings', 'fileTaskFileParentTargetSameFolder'),
				default: t('settings', 'fileTaskParentTargetDefault'),
			};
		}
		if (key === 'childTaskInheritanceStatusPipelineSource') {
			return Object.fromEntries(this.getChildTaskInheritanceStatusPipelineOptions().map(option => [option.value, option.label]));
		}
		if (key === 'newOccurrencePosition') {
			return {
				below: t('settings', 'repeatPlacementBelow'),
				above: t('settings', 'repeatPlacementAbove'),
			};
		}
		if (key === 'fileRepeatDestination') {
			return {
				'same-folder': t('settings', 'fileRepeatDestinationSameFolder'),
				'custom-folder': t('settings', 'fileRepeatDestinationCustomFolder'),
			};
		}
		if (key === 'dynamicFileTaskFilterPlacement') {
			return {
				'body-top': t('settings', 'dynamicFileTaskFilterPlacementBodyTop'),
				'body-bottom': t('settings', 'dynamicFileTaskFilterPlacementBodyBottom'),
			};
		}
		if (key === 'trackerTaskDescriptionClickAction') {
			return {
				jumpToSource: t('settings', 'trackerClickJumpToSource'),
				openTaskEditor: t('settings', 'trackerClickOpenTaskEditor'),
			};
		}
		if (key === 'pinnedTasksDesktopSurface') {
			return {
				floating: t('settings', 'pinnedTasksDesktopSurfaceFloating'),
				sidebar: t('settings', 'pinnedTasksDesktopSurfaceSidebar'),
			};
		}
		if (key === 'fallbackTaskIconSource') {
			return {
				pipelineStatusIcon: t('settings', 'fallbackTaskIconSourcePipelineStatus'),
				priorityIcon: t('settings', 'fallbackTaskIconSourcePriority'),
				stateIcon: t('settings', 'fallbackTaskIconSourceState'),
			};
		}
		if (key === 'workspaceTweaksPropertiesScope') {
			return {
				'operon-file-tasks': t('settings', 'workspaceTweaksPropertiesScopeOperonFileTasks'),
				'all-notes': t('settings', 'workspaceTweaksPropertiesScopeAllNotes'),
			};
		}
		if (key === 'pinnedDockColorSource') {
			return Object.fromEntries(PINNED_DOCK_TASK_COLOR_SOURCES.map(source => [source, getTaskColorSourceLabel(source)]));
		}
		if (key === 'pinnedDockLayout') {
			return {
				horizontal: t('settings', 'pinnedDockLayoutHorizontal'),
				vertical: t('settings', 'pinnedDockLayoutVertical'),
				grid: t('settings', 'pinnedDockLayoutGrid'),
			};
		}
		if (key === 'pinnedDockGridCols') {
			return { '2': '2', '3': '3', '4': '4', '5': '5' };
		}
		if (key === 'pinnedTasksSidebarSide') {
			return {
				left: t('settings', 'pinnedTasksSidebarSideLeft'),
				right: t('settings', 'pinnedTasksSidebarSideRight'),
			};
		}
		if (key === 'taskFinderRecentModifiedDays') {
			return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(days => [
				String(days),
				t('settings', days === 1 ? 'taskFinderRecentModifiedDaysOptionOne' : 'taskFinderRecentModifiedDaysOptionMany', {
					count: String(days),
				}),
			]));
		}
		if (key === 'taskFinderVisibleResultCount') {
			return Object.fromEntries([3, 4, 5, 6, 7, 8, 9].map(count => [
				String(count),
				t('settings', 'taskFinderVisibleResultCountOption', {
					count: String(count),
				}),
			]));
		}
		if (key === 'calendarDefaultPresetId' || key === 'calendarMobileDefaultSourcePresetId') {
			return this.settings.calendarPresets.length > 0
				? Object.fromEntries(this.settings.calendarPresets.map(preset => [preset.id, preset.name]))
				: { '': t('settings', 'default') };
		}
		if (key === 'calendarWeekStart') {
			return {
				monday: t('calendar', 'monday'),
				sunday: t('calendar', 'sunday'),
			};
		}
		if (key === 'calendarInitialScrollMode') {
			return {
				autoNow: t('calendar', 'initialScrollAutoNow'),
				fixedHour: t('calendar', 'initialScrollFixedHour'),
			};
		}
		if (key === 'calendarDayTitleAction') {
			return {
				'create-open-daily-note': t('calendar', 'dayTitleActionCreateOpenDailyNote'),
				nothing: t('calendar', 'dayTitleActionNothing'),
			};
		}
		if (key === 'calendarMobileDefaultView') {
			return {
				agenda: t('calendar', 'mobileViewAgenda'),
				day: t('calendar', 'mobileViewDay'),
				threeDay: t('calendar', 'mobileViewThreeDay'),
			};
		}
		if (key === 'calendarMobileColorSource') {
			return Object.fromEntries(CALENDAR_TASK_COLOR_SOURCES.map(source => [source, getTaskColorSourceLabel(source)]));
		}
		if (key === 'calendarMobileAllDayVisibleTaskLimit') {
			return Object.fromEntries(CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS.map(limit => [
				String(limit),
				limit === 'all'
					? t('settings', 'calendarMobileAllDayVisibleTaskLimitAll')
					: t('settings', 'calendarMobileAllDayVisibleTaskLimitOption', { count: String(limit) }),
			]));
		}
		if (key === 'calendarMobileSlotMinutes') {
			return Object.fromEntries(CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS.map(minutes => [
				String(minutes),
				t('settings', 'calendarMobileSlotMinutesOption', { minutes: String(minutes) }),
			]));
		}
		if (key === 'calendarMobileAgendaPastDays' || key === 'calendarMobileAgendaFutureDays') {
			return Object.fromEntries(this.getSettingsSearchNumberOptions(key).map(days => [
				String(days),
				t('settings', 'calendarMobileAgendaDaysOption', { count: String(days) }),
			]));
		}
		if (key === 'flowTimePauseMinutes' || key === 'flowTimeDefaultSessionMinutes') {
			return Object.fromEntries(this.getSettingsSearchNumberOptions(key).map(minutes => [
				String(minutes),
				t('settings', 'flowTimeMinutesOption', { minutes: String(minutes) }),
			]));
		}
		if (key === 'duplicateAlertDelaySeconds') {
			return Object.fromEntries(DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS.map(seconds => [
				String(seconds),
				t('settings', 'duplicateAlertDelayOption', { seconds: String(seconds) }),
			]));
		}
		if (key === 'taskEditorAutosaveDelaySeconds') {
			return Object.fromEntries(TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS.map(seconds => [
				String(seconds),
				t('settings', 'taskEditorAutosaveDelayOption', { seconds: String(seconds) }),
			]));
		}
		if (key === 'dynamicFileTaskFilterSubtaskAutoExpandLimit' || key === 'dynamicSubtasksFilterSubtaskAutoExpandLimit') {
			return Object.fromEntries(DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS.map(limit => [
				String(limit),
				getDynamicFileTaskFilterSubtaskAutoExpandLabel(limit),
			]));
		}
		if (key === 'kanbanDefaultPresetId') {
			return this.settings.kanbanPresets.length > 0
				? Object.fromEntries(this.settings.kanbanPresets.map(preset => [preset.id, preset.name]))
				: { '': t('settings', 'default') };
		}
		if (SETTINGS_SEARCH_OPTION_NUMBER_KEYS.has(key)) {
			return Object.fromEntries(this.getSettingsSearchNumberOptions(key).map(option => [String(option), String(option)]));
		}
		return { '': t('settings', 'default') };
	}

	private getLanguageDropdownOptions(): DropdownSettingOption<OperonLanguage>[] {
		const languageOptions: DropdownSettingOption<OperonLanguage>[] = [
			{ value: 'en', label: t('settings', 'languageEnglish') },
			{ value: 'tr', label: t('settings', 'languageTurkish') },
			{ value: 'de', label: t('settings', 'languageGerman') },
			{ value: 'fr', label: t('settings', 'languageFrench') },
			{ value: 'es', label: t('settings', 'languageSpanish') },
			{ value: 'zh-CN', label: t('settings', 'languageChineseSimplified') },
			{ value: 'zh-TW', label: t('settings', 'languageChineseTraditional') },
		];
		const collator = new Intl.Collator(getCurrentLang(), { sensitivity: 'base' });
		languageOptions.sort((left, right) =>
			collator.compare(left.label, right.label) || left.value.localeCompare(right.value, 'en')
		);
		return [
			{ value: 'auto', label: t('settings', 'languageAuto') },
			...languageOptions,
		];
	}

	private applySettingsSearchBeforeSaveEffects(key: OperonSettingSearchKey, value: unknown): void {
		if (key === 'inlineTaskSaveMode') {
			this.settings.inlineTaskUseDailyNote = value === 'daily-notes';
		}
		if (key === 'pinnedDockAutoCloseEnabled' && value === false) {
			this.settings.pinnedDockCollapsed = false;
		}
		if (key === 'flowTimeUseLastSelectedDuration' && value === false) {
			this.settings.flowTimeSessionMinutes = this.settings.flowTimeDefaultSessionMinutes;
		}
		if (key === 'flowTimeDefaultSessionMinutes' && !this.settings.flowTimeUseLastSelectedDuration && typeof value === 'number') {
			this.settings.flowTimeSessionMinutes = value;
		}
		if (key === 'taskFinderRememberLastScopes' && value === false) {
			this.settings.taskFinderDefaultScope = TASK_FINDER_DEFAULT_SCOPE_ORDER.map((scopeKey: TaskFinderDefaultScopeKey) => ({
				key: scopeKey,
				visible: scopeKey === 'includeInline' || scopeKey === 'includeFile',
			}));
			this.settings.taskFinderSelectedProjectId = '';
		}
	}

	private applySettingsSearchAfterSaveEffects(key: OperonSettingSearchKey): void {
		if (key === 'language') {
			return;
		}
		if (SETTINGS_SEARCH_DOCK_KEYS.has(key)) {
			this.onDockRefreshLayout();
		}
		if (SETTINGS_SEARCH_DOM_REFRESH_KEYS.has(key)) {
			this.refreshNativeSettingsDom();
		}
		if (SETTINGS_SEARCH_WORKSPACE_TWEAK_KEYS.has(key)) {
			this.applyPendingSettingsChange();
		}
		if (key === 'timeFormat') {
			this.updateNativeSettingsDefinitions();
		}
	}

	private refreshNativeSettingsDom(): void {
		const settingTab = this as SettingsSearchRefreshableTab;
		settingTab.refreshDomState?.();
	}

	private updateNativeSettingsDefinitions(): void {
		const settingTab = this as SettingsSearchRefreshableTab;
		settingTab.update?.();
	}

	display(): void {
		this.isDeclarativeSettingsRendererActive = false;
		this.renderImperativeSettingsFallback();
	}

	private renderImperativeSettingsFallback(): void {
		const { containerEl } = this;
		this.clearActiveNativeSettingsPage();
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

	private redisplayPreservingScroll(): void {
		if (this.isDeclarativeSettingsRendererActive) {
			const activePage = this.activeNativeSettingsPage;
			if (!activePage?.containerEl.isConnected) {
				this.updateNativeSettingsDefinitions();
				return;
			}

			const scrollHost = this.resolveSettingsScrollHost();
			const scrollTop = scrollHost?.scrollTop ?? 0;
			const scrollLeft = scrollHost?.scrollLeft ?? 0;
			if (activePage.taskChipsPageId) {
				this.renderNativeTaskChipsSettingsPage(activePage.taskChipsPageId, activePage.containerEl);
			} else {
				this.renderNativeSettingsPage(activePage.tabId, activePage.containerEl);
			}
			if (!scrollHost) return;

			const restore = (): void => {
				const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
				const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth);
				scrollHost.scrollTop = Math.min(scrollTop, maxScrollTop);
				scrollHost.scrollLeft = Math.min(scrollLeft, maxScrollLeft);
			};
			restore();
			scrollHost.ownerDocument.defaultView?.requestAnimationFrame(restore);
			return;
		}

		const scrollHost = this.resolveSettingsScrollHost();
		const scrollTop = scrollHost?.scrollTop ?? 0;
		const scrollLeft = scrollHost?.scrollLeft ?? 0;
		this.renderImperativeSettingsFallback();
		if (!scrollHost) return;

		const restore = (): void => {
			const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
			const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth);
			scrollHost.scrollTop = Math.min(scrollTop, maxScrollTop);
			scrollHost.scrollLeft = Math.min(scrollLeft, maxScrollLeft);
		};
		restore();
		scrollHost.ownerDocument.defaultView?.requestAnimationFrame(restore);
	}

	private resolveSettingsScrollHost(): HTMLElement | null {
		const { containerEl } = this;
		const settingsScrollHost = containerEl.closest<HTMLElement>('.vertical-tab-content');
		if (settingsScrollHost) return settingsScrollHost;

		let current: HTMLElement | null = containerEl;
		while (current) {
			const style = current.ownerDocument.defaultView?.getComputedStyle(current) ?? getComputedStyle(current);
			if (current.scrollHeight > current.clientHeight && /auto|scroll|overlay/u.test(style.overflowY)) {
				return current;
			}
			current = current.parentElement;
		}
		return containerEl.parentElement;
	}

	private getPrimarySettingsTabs(): SettingsTabDefinition<OperonSettingsTabId>[] {
		return [
			{ id: 'core', label: t('settings', 'tabCore'), defaultTabId: 'coreGeneral', icon: 'settings' },
			{ id: 'tasks', label: t('settings', 'tabTasks'), defaultTabId: 'tasksInlineTasks', icon: 'check-square' },
			{ id: 'views', label: t('settings', 'tabViews'), defaultTabId: 'viewsCalendar', icon: 'calendar' },
			{ id: 'interface', label: t('settings', 'tabInterface'), defaultTabId: 'interfaceTaskChips', icon: 'palette' },
			{ id: 'mobile', label: t('settings', 'tabMobile'), defaultTabId: 'mobileGeneral', icon: 'smartphone' },
		];
	}

	private getSecondarySettingsTabs(): SettingsTabDefinition<OperonSettingsTabId>[] {
		return [
			{ id: 'coreGeneral', groupId: 'core', label: t('settings', 'tabGeneral') },
			{ id: 'corePipelines', groupId: 'core', label: t('settings', 'tabPipelines') },
			{ id: 'corePriority', groupId: 'core', label: t('settings', 'tabPriority') },
			{ id: 'coreKeymapping', groupId: 'core', label: t('settings', 'tabKeyMappings') },
			{ id: 'coreCustomKeys', groupId: 'core', label: t('settings', 'tabCustomKeys') },
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
			{ id: 'interfaceTaskEditor', groupId: 'interface', label: t('settings', 'subtabTaskEditor') },
			{ id: 'interfaceLocationMap', groupId: 'interface', label: t('settings', 'subtabLocationMap') },
			{ id: 'interfaceTweaks', groupId: 'interface', label: t('settings', 'subtabTweaks') },
			{ id: 'interfaceColorPalette', groupId: 'interface', label: t('settings', 'subtabColorPalette') },
			{ id: 'mobileGeneral', groupId: 'mobile', label: t('settings', 'mobileSubtabGeneral') },
			{ id: 'mobileTaskEditor', groupId: 'mobile', label: t('settings', 'mobileSubtabTaskEditor') },
			{ id: 'mobileCalendar', groupId: 'mobile', label: t('settings', 'mobileSubtabCalendar') },
			{ id: 'mobileKanban', groupId: 'mobile', label: t('settings', 'mobileSubtabKanban') },
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
		} else if (tabId === 'coreCustomKeys') {
			this.renderCustomKeysSection(contentEl);
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
		} else if (tabId === 'interfaceTaskEditor') {
			this.renderInterfaceTaskEditorTab(contentEl);
		} else if (tabId === 'interfaceLocationMap') {
			this.renderInterfaceLocationMapTab(contentEl);
		} else if (tabId === 'interfaceTweaks') {
			this.renderInterfaceTweaksTab(contentEl);
		} else if (tabId === 'interfaceColorPalette') {
			this.renderInterfaceColorPaletteTab(contentEl);
		} else if (tabId === 'mobile' || tabId === 'mobileGeneral') {
			this.renderMobileGeneralTab(contentEl);
		} else if (tabId === 'mobileTaskEditor') {
			this.renderMobileTaskEditorTab(contentEl);
		} else if (tabId === 'mobileCalendar') {
			this.renderMobileCalendarTab(contentEl);
		} else if (tabId === 'mobileKanban') {
			this.renderMobileKanbanTab(contentEl);
		}
	}

	hide(): void {
		this.clearActiveNativeSettingsPage();
		if (this.hasPendingSettingsChange) {
			this.applyPendingSettingsChange();
		}
		super.hide();
	}

	private renderCoreGeneralTab(containerEl: HTMLElement): void {
		if (this.isDeclarativeSettingsRendererActive) {
			this.renderReleaseNotesUpdateToggle(containerEl);
		} else {
			this.renderReleaseNotesSettingsCard(containerEl, { includeToggle: true });
		}
		this.renderGeneralBasicsTab(containerEl);
		this.renderGeneralSystemTab(containerEl);
		this.renderStorageCleanupSection(containerEl);
	}

	private renderReleaseNotesSettingsCard(containerEl: HTMLElement, options: { includeToggle: boolean }): void {
		const cardEl = containerEl.createDiv('operon-release-notes-settings-card');
		const headerEl = cardEl.createDiv('operon-release-notes-settings-card-header');
		const textEl = headerEl.createDiv('operon-release-notes-settings-card-text');
		textEl.createDiv({
			text: t('settings', 'releaseNotesCardTitle', { version: this.pluginVersion }),
			cls: 'operon-release-notes-settings-card-title',
		});
		textEl.createDiv({
			text: t('settings', 'releaseNotesCardDesc'),
			cls: 'operon-release-notes-settings-card-desc',
		});
		headerEl.createEl('button', {
			text: t('settings', 'releaseNotesViewRecent'),
			cls: 'operon-release-notes-settings-card-button',
			attr: { type: 'button' },
		}).addEventListener('click', () => {
			new OperonReleaseNotesModal(this.app, getReleaseNotesForManualView()).open();
		});

		if (!options.includeToggle) return;
		this.renderReleaseNotesUpdateToggle(cardEl);
	}

	private renderReleaseNotesUpdateToggle(containerEl: HTMLElement): void {
		this.renderBoundToggleSetting(
			containerEl,
			t('settings', 'releaseNotesShowOnUpdate'),
			t('settings', 'releaseNotesShowOnUpdateDesc'),
			'releaseNotesShowOnUpdate',
		);
	}

	private renderGeneralBasicsTab(containerEl: HTMLElement): void {
		this.configureLanguageDropdownSetting(new Setting(containerEl)
			.setName(t('settings', 'language'))
			.setDesc(t('settings', 'languageDesc')));

		this.renderBoundDropdownSetting(containerEl, t('settings', 'timeFormat'), t('settings', 'timeFormatDesc'), 'timeFormat', {
			value: this.settings.timeFormat,
			dropdownOptions: [
				{ value: '24h', label: t('settings', 'timeFormat24h') },
				{ value: '12h', label: t('settings', 'timeFormat12h') },
			],
			onAfterChange: () => {
				this.redisplayPreservingScroll();
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

	private configureLanguageDropdownSetting(setting: Setting): Setting {
		setting.addDropdown(dropdown => {
			for (const option of this.getLanguageDropdownOptions()) {
				dropdown.addOption(option.value, option.label);
			}
			dropdown
				.setValue(this.settings.language)
				.onChange(settingsAsyncHandler('settings language save failed', async value => {
					this.settings.language = isSupportedLanguage(value) ? value : DEFAULT_SETTINGS.language;
					await this.persistSettingsOnly();
					this.notifySettingsChanged();
				}));
		});
		return this.markSettingsSearchTarget(setting, 'language');
	}

	private renderInterfaceContextMenuTab(containerEl: HTMLElement): void {
		this.renderContextualHoverMenuSettingsSection(containerEl);
	}

	private renderInterfaceTaskEditorTab(containerEl: HTMLElement): void {
		this.renderBoundToggleSetting(containerEl, t('settings', 'taskEditorShowLineNumbers'), t('settings', 'taskEditorShowLineNumbersDesc'), 'taskEditorShowLineNumbers');
		this.renderBoundDropdownSetting(containerEl, t('settings', 'taskEditorAutosaveDelay'), t('settings', 'taskEditorAutosaveDelayDesc'), 'taskEditorAutosaveDelaySeconds', {
			value: String(this.settings.taskEditorAutosaveDelaySeconds),
			dropdownOptions: TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS.map(seconds => ({
				value: String(seconds),
				label: t('settings', 'taskEditorAutosaveDelayOption', { seconds: String(seconds) }),
			})),
			normalize: value => Number(value),
		});
		const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskEditorWorkflowPickers'));
		this.applyInterfaceIconListSectionStyle(sectionEl);
		this.renderTaskEditorWorkflowPickerSettingsSection(sectionEl);
		this.markSettingsSearchSectionTarget(sectionEl, 'ui.taskEditorWorkflowPickers');
	}

	private renderInterfaceLocationMapTab(containerEl: HTMLElement): void {
		const visualSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'locationPlaceVisualPropertiesSection'));
		this.renderBoundTextSetting(
			visualSection,
			t('settings', 'locationPlaceIconPropertyName'),
			t('settings', 'locationPlaceIconPropertyNameDesc'),
			'locationPlaceIconPropertyName',
			{ placeholder: 'Icon' },
		);
		this.renderBoundTextSetting(
			visualSection,
			t('settings', 'locationPlaceColorPropertyName'),
			t('settings', 'locationPlaceColorPropertyNameDesc'),
			'locationPlaceColorPropertyName',
			{ placeholder: 'Color' },
		);

		const pickerSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'locationPickerMapSection'));
		this.renderBoundToggleSetting(
			pickerSection,
			t('settings', 'locationMapsAlwaysLightMode'),
			t('settings', 'locationMapsAlwaysLightModeDesc'),
			'locationMapsAlwaysLightMode',
		);
		this.renderBoundTextSetting(
			pickerSection,
			t('settings', 'locationPickerMapDefaultCenter'),
			t('settings', 'locationPickerMapDefaultCenterDesc'),
			'locationPickerMapDefaultCenter',
			{ placeholder: t('location', 'coordinatePlaceholder') },
		);
		this.renderBoundClampedNumericSetting(
			pickerSection,
			t('settings', 'locationPickerMapDefaultZoom'),
			t('settings', 'locationPickerMapDefaultZoomDesc'),
			'locationPickerMapDefaultZoom',
			{ min: 1, max: 18, fallback: DEFAULT_SETTINGS.locationPickerMapDefaultZoom },
		);

		const previewSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'locationPreviewSection'));
		this.renderBoundClampedNumericSetting(
			previewSection,
			t('settings', 'locationPreviewWidth'),
			t('settings', 'locationPreviewWidthDesc'),
			'locationPreviewWidth',
			{ min: 240, max: 900, fallback: DEFAULT_SETTINGS.locationPreviewWidth },
		);
		this.renderBoundClampedNumericSetting(
			previewSection,
			t('settings', 'locationPreviewHeight'),
			t('settings', 'locationPreviewHeightDesc'),
			'locationPreviewHeight',
			{ min: 180, max: 700, fallback: DEFAULT_SETTINGS.locationPreviewHeight },
		);
		this.renderBoundClampedNumericSetting(
			previewSection,
			t('settings', 'locationPreviewDefaultZoom'),
			t('settings', 'locationPreviewDefaultZoomDesc'),
			'locationPreviewDefaultZoom',
			{ min: 1, max: 22, fallback: DEFAULT_SETTINGS.locationPreviewDefaultZoom },
		);
		this.renderBoundClampedNumericSetting(
			previewSection,
			t('settings', 'locationPreviewMinZoom'),
			t('settings', 'locationPreviewMinZoomDesc'),
			'locationPreviewMinZoom',
			{ min: 0, max: 24, fallback: DEFAULT_SETTINGS.locationPreviewMinZoom },
		);
		this.renderBoundClampedNumericSetting(
			previewSection,
			t('settings', 'locationPreviewMaxZoom'),
			t('settings', 'locationPreviewMaxZoomDesc'),
			'locationPreviewMaxZoom',
			{ min: 1, max: 24, fallback: DEFAULT_SETTINGS.locationPreviewMaxZoom },
		);
	}

	private renderInterfaceTweaksTab(containerEl: HTMLElement): void {
		const workspaceSection = renderNativeSettingsGroupedSection(
			containerEl,
			t('settings', 'workspaceTweaksWorkspaceSection'),
		);
		this.renderBoundToggleSetting(
			workspaceSection,
			t('settings', 'workspaceTweaksHideScrollbars'),
			t('settings', 'workspaceTweaksHideScrollbarsDesc'),
			'workspaceTweaksHideScrollbars',
			{
				onAfterChange: () => {
					this.applyPendingSettingsChange();
				},
			},
		);
		this.renderBoundToggleSetting(
			workspaceSection,
			t('settings', 'workspaceTweaksCompactSidebarTabIcons'),
			t('settings', 'workspaceTweaksCompactSidebarTabIconsDesc'),
			'workspaceTweaksCompactSidebarTabIcons',
			{
				onAfterChange: () => {
					this.applyPendingSettingsChange();
				},
			},
		);

		const propertiesSection = renderNativeSettingsGroupedSection(
			containerEl,
			t('settings', 'workspaceTweaksPropertiesSection'),
		);
		this.renderBoundToggleSetting(
			propertiesSection,
			t('settings', 'workspaceTweaksCollapseProperties'),
			t('settings', 'workspaceTweaksCollapsePropertiesDesc'),
			'workspaceTweaksCollapseProperties',
			{
				onAfterChange: () => {
					this.applyPendingSettingsChange();
				},
			},
		);
		this.renderBoundDropdownSetting<'workspaceTweaksPropertiesScope', WorkspaceTweaksPropertiesScope>(
			propertiesSection,
			t('settings', 'workspaceTweaksPropertiesScope'),
			t('settings', 'workspaceTweaksPropertiesScopeDesc'),
			'workspaceTweaksPropertiesScope',
			{
				value: this.settings.workspaceTweaksPropertiesScope,
				dropdownOptions: [
					{
						value: 'operon-file-tasks',
						label: t('settings', 'workspaceTweaksPropertiesScopeOperonFileTasks'),
					},
					{
						value: 'all-notes',
						label: t('settings', 'workspaceTweaksPropertiesScopeAllNotes'),
					},
				],
				normalize: value => value === 'all-notes' ? 'all-notes' : 'operon-file-tasks',
				onAfterChange: () => {
					this.applyPendingSettingsChange();
				},
			},
		);
		this.renderWorkspaceTweaksExcludedFolderSettings(containerEl);
	}

	private renderInterfaceColorPaletteTab(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv('operon-native-settings-section-card');
		this.applyInterfaceIconListSectionStyle(sectionEl);
		sectionEl.addClass('operon-color-palette-settings-section');
		this.markSettingsSearchSectionTarget(sectionEl, 'ui.colorPalette');

		sectionEl.createDiv({
			cls: 'operon-settings-muted-block',
			text: t('settings', 'colorPaletteSectionDesc'),
		});
		const listEl = sectionEl.createDiv('operon-color-palette-settings-list');
		this.settings.colorPalette = normalizeColorPalette(this.settings.colorPalette);
		const displayPalette = localizeColorPaletteNames(this.settings.colorPalette);

		for (const entry of displayPalette) {
			this.renderColorPaletteRow(listEl, entry);
		}

		const resetRow = sectionEl.createDiv('operon-settings-add-row operon-color-palette-reset-row');
		const resetButton = createSettingsListCardActionButton({
			containerEl: resetRow,
			label: t('settings', 'colorPaletteResetAll'),
			icon: 'rotate-ccw',
			danger: true,
			wide: true,
			errorContext: 'settings color palette reset failed',
			onClick: () => this.confirmColorPaletteReset(),
		});
		resetButton.addClass('operon-color-palette-reset-button');
	}

	private renderColorPaletteRow(containerEl: HTMLElement, entry: ColorPaletteEntry): void {
		const rowEl = containerEl.createDiv('operon-settings-list-card operon-color-palette-row');
		rowEl.dataset.paletteColorId = entry.id;

		const swatchButton = rowEl.createEl('button', {
			cls: 'operon-color-palette-swatch',
			attr: { type: 'button' },
		});
		this.applyColorPaletteSwatch(swatchButton, entry.hex);
		setAccessibleLabelWithoutTooltip(
			swatchButton,
			t('settings', 'colorPaletteSwatchLabel', { name: entry.name }),
		);
		const openPicker = (): void => {
			const currentEntry = this.getColorPaletteEntry(entry.id) ?? entry;
			openSettingsColorPickerModal(this.app, {
				title: currentEntry.name,
				value: currentEntry.hex,
				palette: this.settings.colorPalette,
				onSelect: value => {
					const normalized = normalizeColorPaletteHex(value);
					if (!normalized) return;
					this.updateColorPaletteEntry(entry.id, { hex: normalized });
					hexInput.value = normalized;
					this.applyColorPaletteSwatch(swatchButton, normalized);
					setInvalid(false, 'hex');
					scheduleSave();
				},
			});
		};
		swatchButton.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
		swatchButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (event.detail !== 0) return;
			openPicker();
		});

		const controlsEl = rowEl.createDiv('operon-color-palette-row-controls');
		const hexFieldEl = controlsEl.createDiv('operon-color-palette-field operon-color-palette-hex-field');
		const hexInput = hexFieldEl.createEl('input', {
			cls: 'operon-color-palette-input operon-color-palette-hex-input',
			attr: {
				type: 'text',
				spellcheck: 'false',
				value: entry.hex,
			},
		});
		setAccessibleLabelWithoutTooltip(hexInput, t('settings', 'colorPaletteHexLabel'));
		const hexHintEl = hexFieldEl.createDiv({
			cls: 'operon-color-palette-field-hint',
			text: t('settings', 'colorPaletteInvalidHex'),
		});

		const nameFieldEl = controlsEl.createDiv('operon-color-palette-field operon-color-palette-name-field');
		const nameInput = nameFieldEl.createEl('input', {
			cls: 'operon-color-palette-input operon-color-palette-name-input',
			attr: {
				type: 'text',
				spellcheck: 'false',
				value: entry.name,
			},
		});
		setAccessibleLabelWithoutTooltip(nameInput, t('settings', 'colorPaletteNameLabel'));
		const nameHintEl = nameFieldEl.createDiv({
			cls: 'operon-color-palette-field-hint',
			text: t('settings', 'colorPaletteInvalidName'),
		});

		const ownerWindow = containerEl.ownerDocument.defaultView ?? window;
		let saveTimer: number | null = null;
		const scheduleSave = (): void => {
			if (saveTimer !== null) {
				ownerWindow.clearTimeout(saveTimer);
			}
			saveTimer = ownerWindow.setTimeout(() => {
				saveTimer = null;
				runSettingsAsync('settings color palette save failed', async () => {
					await this.saveSettings();
				});
			}, 300);
		};

		const setInvalid = (invalid: boolean, target: 'hex' | 'name'): void => {
			const fieldEl = target === 'hex' ? hexFieldEl : nameFieldEl;
			const inputEl = target === 'hex' ? hexInput : nameInput;
			const hintEl = target === 'hex' ? hexHintEl : nameHintEl;
			fieldEl.classList.toggle('is-invalid', invalid);
			inputEl.classList.toggle('is-invalid', invalid);
			hintEl.classList.toggle('is-visible', invalid);
			const hasInvalid = hexFieldEl.classList.contains('is-invalid') || nameFieldEl.classList.contains('is-invalid');
			rowEl.classList.toggle('is-invalid', hasInvalid);
		};

		hexInput.addEventListener('input', () => {
			const normalized = normalizeColorPaletteHex(hexInput.value);
			if (!normalized) {
				setInvalid(true, 'hex');
				return;
			}
			setInvalid(false, 'hex');
			this.updateColorPaletteEntry(entry.id, { hex: normalized });
			this.applyColorPaletteSwatch(swatchButton, normalized);
			scheduleSave();
		});
		hexInput.addEventListener('blur', () => {
			const normalized = normalizeColorPaletteHex(hexInput.value);
			if (normalized) {
				hexInput.value = normalized;
			}
		});
		hexInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				hexInput.blur();
			}
		});

		nameInput.addEventListener('input', () => {
			const normalized = normalizeColorPaletteName(nameInput.value);
			if (!normalized) {
				setInvalid(true, 'name');
				return;
			}
			setInvalid(false, 'name');
			this.updateColorPaletteEntry(entry.id, { name: normalized });
			setAccessibleLabelWithoutTooltip(
				swatchButton,
				t('settings', 'colorPaletteSwatchLabel', { name: normalized }),
			);
			scheduleSave();
		});
		nameInput.addEventListener('blur', () => {
			const normalized = normalizeColorPaletteName(nameInput.value);
			if (normalized) {
				nameInput.value = normalized;
			}
		});
		nameInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				nameInput.blur();
			}
		});
	}

	private getColorPaletteEntry(id: string): ColorPaletteEntry | null {
		const palette = localizeColorPaletteNames(this.settings.colorPalette);
		return palette.find(entry => entry.id === id) ?? null;
	}

	private applyColorPaletteSwatch(element: HTMLElement, hex: string): void {
		element.style.setProperty('--operon-color-palette-swatch', hex);
		element.style.backgroundColor = hex;
	}

	private updateColorPaletteEntry(id: string, patch: Partial<Pick<ColorPaletteEntry, 'name' | 'hex'>>): void {
		const palette = normalizeColorPalette(this.settings.colorPalette);
		const index = palette.findIndex(entry => entry.id === id);
		if (index < 0) return;
		palette[index] = {
			...palette[index],
			...patch,
		};
		this.settings.colorPalette = palette;
	}

	private confirmColorPaletteReset(): void {
		new ConfirmActionModal(this.app, {
			title: t('settings', 'colorPaletteResetTitle'),
			message: t('settings', 'colorPaletteResetMessage'),
			confirmText: t('settings', 'colorPaletteResetConfirm'),
			cancelText: t('buttons', 'cancel'),
			danger: true,
		}, confirmed => {
			if (!confirmed) return;
			runSettingsAsync('settings color palette reset failed', async () => {
				this.settings.colorPalette = cloneDefaultColorPalette();
				await this.saveSettings();
				new Notice(t('settings', 'colorPaletteResetNotice'));
				this.redisplayPreservingScroll();
			});
		}).open();
	}

	private renderMobileGeneralTab(containerEl: HTMLElement): void {
		renderSettingsInfoBox(containerEl, t('settings', 'mobileInterfaceTitle'), t('settings', 'mobileInterfaceDesc'));
		this.renderBoundToggleSetting(containerEl, t('settings', 'mobileGlobalTaskFabEnabled'), t('settings', 'mobileGlobalTaskFabEnabledDesc'), 'mobileGlobalTaskFabEnabled');
		this.renderBoundToggleSetting(containerEl, t('settings', 'mobileGlobalTaskFabHideInCalendar'), t('settings', 'mobileGlobalTaskFabHideInCalendarDesc'), 'mobileGlobalTaskFabHideInCalendar');
		this.renderBoundToggleSetting(containerEl, t('settings', 'mobileGlobalTaskFabHideInKanban'), t('settings', 'mobileGlobalTaskFabHideInKanbanDesc'), 'mobileGlobalTaskFabHideInKanban');
		this.renderBoundClampedNumericSetting(containerEl, t('settings', 'contextualMenuMobileAutoHide'), t('settings', 'contextualMenuMobileAutoHideDesc'), 'contextualMenuMobileAutoHideMs', {
			min: 1000,
			max: 30000,
			fallback: DEFAULT_SETTINGS.contextualMenuMobileAutoHideMs,
			step: '1000',
		});
		new Setting(containerEl)
			.setName(t('settings', 'mobileGlobalTaskFabResetPosition'))
			.setDesc(t('settings', 'mobileGlobalTaskFabResetPositionDesc'))
			.addButton(button => {
				button
					.setButtonText(t('settings', 'mobileGlobalTaskFabResetPositionButton'))
					.onClick(settingsAsyncHandler('settings mobile quick-create position reset failed', async () => {
						this.settings.mobileGlobalTaskFabPosition = null;
						await this.saveSettings();
					}));
			});
	}

	private renderMobileTaskEditorTab(containerEl: HTMLElement): void {
		const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskEditorMobileCoreTools'));
		this.applyInterfaceIconListSectionStyle(sectionEl);
		this.renderTaskEditorMobileCoreToolSettingsSection(sectionEl);
		this.markSettingsSearchSectionTarget(sectionEl, 'ui.taskEditorMobileCoreTools');
	}

	private renderMobileCalendarTab(containerEl: HTMLElement): void {
		const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'mobileSubtabCalendar'), t('settings', 'settingsPageMobileCalendarDesc'));
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileEnabled'), t('settings', 'calendarMobileEnabledDesc'), 'calendarMobileEnabled');
		this.renderBoundClampedNumericSetting(sectionEl, t('settings', 'calendarMobileMaxWidth'), t('settings', 'calendarMobileMaxWidthDesc'), 'calendarMobileMaxWidthPx', {
			min: CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MIN,
			max: CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.calendarMobileMaxWidthPx,
			step: '1',
		});
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileDefaultView'), t('settings', 'calendarMobileDefaultViewDesc'), 'calendarMobileDefaultView', {
			value: this.settings.calendarMobileDefaultView,
			dropdownOptions: [
				{ value: 'agenda', label: t('calendar', 'mobileViewAgenda') },
				{ value: 'day', label: t('calendar', 'mobileViewDay') },
				{ value: 'threeDay', label: t('calendar', 'mobileViewThreeDay') },
			],
			normalize: value => value === 'day' || value === 'threeDay' ? value : 'agenda',
		});
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileDefaultSourcePreset'), t('settings', 'calendarMobileDefaultSourcePresetDesc'), 'calendarMobileDefaultSourcePresetId', {
			value: this.settings.calendarMobileDefaultSourcePresetId ?? this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? '',
			dropdownOptions: [],
			configure: drop => {
				for (const preset of this.settings.calendarPresets) {
					drop.addOption(preset.id, preset.name);
				}
			},
			normalize: value => this.settings.calendarPresets.some(preset => preset.id === value)
				? value
				: this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? null,
		});
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileSlotMinutes'), t('settings', 'calendarMobileSlotMinutesDesc'), 'calendarMobileSlotMinutes', {
			value: String(this.settings.calendarMobileSlotMinutes),
			dropdownOptions: CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS.map(minutes => ({
				value: String(minutes),
				label: t('settings', 'calendarMobileSlotMinutesOption', { minutes: String(minutes) }),
			})),
			normalize: value => {
				const parsed = Number.parseInt(value, 10);
				return CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS.includes(parsed as typeof CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS[number])
					? parsed
					: DEFAULT_SETTINGS.calendarMobileSlotMinutes;
			},
		});
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileShowProjectedOccurrences'), t('settings', 'calendarMobileShowProjectedOccurrencesDesc'), 'calendarMobileShowProjectedOccurrences');
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileShowExternalCalendars'), t('settings', 'calendarMobileShowExternalCalendarsDesc'), 'calendarMobileShowExternalCalendars');
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileColorSource'), t('settings', 'calendarMobileColorSourceDesc'), 'calendarMobileColorSource', {
			value: this.settings.calendarMobileColorSource,
			dropdownOptions: [],
			configure: dropdown => {
				addTaskColorSourceOptions(dropdown, CALENDAR_TASK_COLOR_SOURCES);
			},
			normalize: value => normalizeTaskColorSource(value, CALENDAR_TASK_COLOR_SOURCES, DEFAULT_SETTINGS.calendarMobileColorSource),
		});
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileShowDueMarkers'), t('settings', 'calendarMobileShowDueMarkersDesc'), 'calendarMobileShowDueMarkers');
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileShowAllDayItems'), t('settings', 'calendarMobileShowAllDayItemsDesc'), 'calendarMobileShowAllDayItems');
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileAgendaPastDays'), t('settings', 'calendarMobileAgendaPastDaysDesc'), 'calendarMobileAgendaPastDays', {
			value: String(this.settings.calendarMobileAgendaPastDays),
			dropdownOptions: CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS.map(days => ({
				value: String(days),
				label: t('settings', 'calendarMobileAgendaDaysOption', { count: String(days) }),
			})),
			normalize: value => {
				const parsed = Number.parseInt(value, 10);
				return CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS.includes(parsed as CalendarMobileAgendaPastDays)
					? parsed as CalendarMobileAgendaPastDays
					: DEFAULT_SETTINGS.calendarMobileAgendaPastDays;
			},
		});
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileAgendaFutureDays'), t('settings', 'calendarMobileAgendaFutureDaysDesc'), 'calendarMobileAgendaFutureDays', {
			value: String(this.settings.calendarMobileAgendaFutureDays),
			dropdownOptions: CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS.map(days => ({
				value: String(days),
				label: t('settings', 'calendarMobileAgendaDaysOption', { count: String(days) }),
			})),
			normalize: value => {
				const parsed = Number.parseInt(value, 10);
				return CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS.includes(parsed as CalendarMobileAgendaFutureDays)
					? parsed as CalendarMobileAgendaFutureDays
					: DEFAULT_SETTINGS.calendarMobileAgendaFutureDays;
			},
		});
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileAgendaShowCompletedItems'), t('settings', 'calendarMobileAgendaShowCompletedItemsDesc'), 'calendarMobileAgendaShowCompletedItems');
		this.renderBoundDropdownSetting(sectionEl, t('settings', 'calendarMobileAllDayVisibleTaskLimit'), t('settings', 'calendarMobileAllDayVisibleTaskLimitDesc'), 'calendarMobileAllDayVisibleTaskLimit', {
			value: String(this.settings.calendarMobileAllDayVisibleTaskLimit),
			dropdownOptions: CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS.map(limit => ({
				value: String(limit),
				label: limit === 'all'
					? t('settings', 'calendarMobileAllDayVisibleTaskLimitAll')
					: t('settings', 'calendarMobileAllDayVisibleTaskLimitOption', { count: String(limit) }),
			})),
			normalize: value => {
				if (value === 'all') return 'all';
				const parsed = Number.parseInt(value, 10);
				return CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS.includes(parsed as CalendarMobileAllDayVisibleTaskLimit)
					? parsed as CalendarMobileAllDayVisibleTaskLimit
					: DEFAULT_SETTINGS.calendarMobileAllDayVisibleTaskLimit;
			},
		});
		this.renderBoundToggleSetting(sectionEl, t('settings', 'calendarMobileShowCompletedItems'), t('settings', 'calendarMobileShowCompletedItemsDesc'), 'calendarMobileShowCompletedItems');
	}

	private renderMobileKanbanTab(containerEl: HTMLElement): void {
		const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'mobileSubtabKanban'), t('settings', 'settingsPageMobileKanbanDesc'));
		this.renderBoundToggleSetting(sectionEl, t('settings', 'kanbanMobileLayoutChrome'), t('settings', 'kanbanMobileLayoutChromeDesc'), 'kanbanMobileLayoutChromeEnabled');
		this.renderBoundClampedNumericSetting(sectionEl, t('settings', 'kanbanMobileLayoutMaxWidth'), t('settings', 'kanbanMobileLayoutMaxWidthDesc'), 'kanbanMobileLayoutMaxWidthPx', {
			min: KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MIN,
			max: KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.kanbanMobileLayoutMaxWidthPx,
			step: '1',
		});
		this.renderBoundClampedNumericSetting(sectionEl, t('settings', 'kanbanMobileSwimlaneHandleWidth'), t('settings', 'kanbanMobileSwimlaneHandleWidthDesc'), 'kanbanMobileCompactSwimlaneWidthPx', {
			min: KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MIN,
			max: KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.kanbanMobileCompactSwimlaneWidthPx,
			step: '1',
		});
		this.renderBoundToggleSetting(sectionEl, t('settings', 'kanbanMobileSwimlaneRailAlwaysVisible'), t('settings', 'kanbanMobileSwimlaneRailAlwaysVisibleDesc'), 'kanbanMobileSwimlaneRailAlwaysVisible');
		this.renderBoundToggleSetting(sectionEl, t('settings', 'kanbanMobileHorizontalStatusSnap'), t('settings', 'kanbanMobileHorizontalStatusSnapDesc'), 'kanbanMobileHorizontalStatusSnapEnabled');
	}

	private renderTasksRelationshipsTab(containerEl: HTMLElement): void {
		const relationshipsBody = containerEl.createDiv('operon-native-settings-section-card operon-relationships-settings-card');
		this.renderBoundToggleSetting(relationshipsBody, t('settings', 'estimateAutoReallocation'), t('settings', 'estimateAutoReallocationDesc'), 'estimateAutoReallocation');
		this.renderBoundToggleSetting(relationshipsBody, t('settings', 'autoParentInlineSubtasks'), t('settings', 'autoParentInlineSubtasksDesc'), 'autoParentFileTask');
		this.renderBoundToggleSetting(relationshipsBody, t('settings', 'autoParentLinkedFileSubtasks'), t('settings', 'autoParentLinkedFileSubtasksDesc'), 'autoParentLinkedFileSubtasks');
		this.renderBoundDropdownSetting(relationshipsBody, t('settings', 'childTaskInheritanceStatusPipelineSource'), t('settings', 'childTaskInheritanceStatusPipelineSourceDesc'), 'childTaskInheritanceStatusPipelineSource', {
			value: this.settings.childTaskInheritanceStatusPipelineSource,
			dropdownOptions: this.getChildTaskInheritanceStatusPipelineOptions(),
			normalize: value => normalizeChildTaskInheritanceStatusPipelineSource(value),
		});
		this.renderParentChildTaskInheritanceSettings(containerEl);
		this.renderProjectSerialSettings(containerEl);
	}

	private renderProjectSerialSettings(containerEl: HTMLElement): void {
		const sectionWrapperEl = containerEl.createDiv('operon-native-settings-section operon-project-serials-setting');
		renderSettingsHeading(sectionWrapperEl, t('settings', 'projectSerials'), 'operon-project-serials-heading');
		sectionWrapperEl.createEl('p', {
			text: t('settings', 'projectSerialsDesc'),
			cls: 'operon-native-settings-section-desc',
		});
		this.markSettingsSearchSectionTarget(sectionWrapperEl, 'automation.projectSerials');

		const sectionEl = sectionWrapperEl.createDiv('operon-native-settings-section-card operon-project-serials-section-body');
		const listEl = sectionEl.createDiv('operon-project-serials-list');
		const addRowEl = sectionEl.createDiv('operon-project-serials-add-row');
		let prefixDraft = '';
		let parentDraft = '';
		let editingScopeId: string | null = null;
		let prefixEditDraft = '';

		const formatScopePreview = (scope: ProjectSerialScope, draftPrefix?: string): string => {
			const summary = this.storage.projectSerials.getSummary(scope.id);
			const prefix = draftPrefix ? normalizeProjectSerialPrefix(draftPrefix) : scope.prefix;
			if (!prefix) return summary?.formatPreview ?? formatProjectSerialLabel(scope.prefix, 1, 1);
			const maxAssignedNumber = summary?.maxAssignedNumber ?? 1;
			return formatProjectSerialLabel(prefix, Math.max(1, maxAssignedNumber), maxAssignedNumber);
		};

		const cancelPrefixEdit = (): void => {
			editingScopeId = null;
			prefixEditDraft = '';
			render();
		};

		const savePrefixEdit = async (scope: ProjectSerialScope): Promise<void> => {
			const renamed = await this.renameProjectSerialScope(scope, prefixEditDraft);
			if (!renamed) return;
			editingScopeId = null;
			prefixEditDraft = '';
			render();
		};

		const render = (): void => {
			this.settings.projectSerialScopes = this.getNormalizedProjectSerialScopes();
			const scopes = this.settings.projectSerialScopes;
			listEl.empty();
			if (scopes.length === 0) {
				listEl.createDiv({
					text: t('settings', 'projectSerialsEmpty'),
					cls: 'operon-project-serials-empty',
				});
			}
			for (const scope of scopes) {
				const summary = this.storage.projectSerials.getSummary(scope.id);
				const isEditing = editingScopeId === scope.id;
				const rowEl = listEl.createDiv({
					cls: `operon-project-serial-row${isEditing ? ' is-editing' : ''}`,
				});
				const mainEl = rowEl.createDiv('operon-project-serial-row-main');
				let previewEl: HTMLElement | null = null;
				if (isEditing) {
					const prefixInput = mainEl.createEl('input', {
						cls: 'operon-project-serial-input operon-project-serial-prefix-edit operon-settings-input-short',
						attr: {
							type: 'text',
							autocomplete: 'off',
							spellcheck: 'false',
							maxlength: '5',
						},
					});
					prefixInput.value = prefixEditDraft;
					setAccessibleLabelWithoutTooltip(prefixInput, t('settings', 'projectSerialPrefix'));
					prefixInput.addEventListener('input', () => {
						prefixEditDraft = prefixInput.value;
						if (previewEl) previewEl.setText(formatScopePreview(scope, prefixEditDraft));
					});
					prefixInput.addEventListener('keydown', event => {
						if (event.key === 'Enter') {
							event.preventDefault();
							void savePrefixEdit(scope);
						} else if (event.key === 'Escape') {
							event.preventDefault();
							cancelPrefixEdit();
						}
					});
					prefixInput.focus();
					prefixInput.select();
				} else {
					mainEl.createSpan({
						cls: 'operon-project-serial-row-prefix',
						text: scope.prefix,
					});
				}
				mainEl.createSpan({
					cls: 'operon-project-serial-row-parent',
					text: scope.parentOperonId,
				});
				const metaEl = rowEl.createDiv('operon-project-serial-row-meta');
				metaEl.createSpan({
					cls: 'operon-project-serial-row-count',
					text: t('settings', 'projectSerialActiveTaskCount', {
						count: String(summary?.activeTaskCount ?? 0),
					}),
				});
				previewEl = metaEl.createSpan({
					cls: 'operon-project-serial-row-preview',
					text: formatScopePreview(scope, isEditing ? prefixEditDraft : undefined),
				});
				const actionsEl = rowEl.createDiv('operon-project-serial-row-actions');
				if (isEditing) {
					const saveButton = actionsEl.createEl('button', {
						cls: 'operon-settings-icon-action-button operon-project-serial-save',
						attr: { type: 'button' },
					});
					setIcon(saveButton, 'check');
					setAccessibleLabelWithoutTooltip(saveButton, `${t('settings', 'saveProjectSerialPrefix')}: ${scope.prefix}`);
					saveButton.addEventListener('click', settingsAsyncHandler('settings project serial prefix save failed', async () => {
						await savePrefixEdit(scope);
					}));
					const cancelButton = actionsEl.createEl('button', {
						cls: 'operon-settings-icon-action-button operon-project-serial-cancel',
						attr: { type: 'button' },
					});
					setIcon(cancelButton, 'x');
					setAccessibleLabelWithoutTooltip(cancelButton, `${t('settings', 'cancelProjectSerialPrefixEdit')}: ${scope.prefix}`);
					cancelButton.addEventListener('click', cancelPrefixEdit);
				} else {
					const editButton = actionsEl.createEl('button', {
						cls: 'operon-settings-icon-action-button operon-project-serial-edit',
						attr: { type: 'button' },
					});
					setIcon(editButton, 'pencil');
					setAccessibleLabelWithoutTooltip(editButton, `${t('settings', 'editProjectSerialPrefix')}: ${scope.prefix}`);
					editButton.addEventListener('click', () => {
						editingScopeId = scope.id;
						prefixEditDraft = scope.prefix;
						render();
					});
					const deleteButton = actionsEl.createEl('button', {
						cls: 'operon-settings-danger-icon-button operon-project-serial-delete',
						attr: { type: 'button' },
					});
					setIcon(deleteButton, 'trash-2');
					setAccessibleLabelWithoutTooltip(deleteButton, `${t('settings', 'deleteProjectSerial')}: ${scope.prefix}`);
					deleteButton.addEventListener('click', settingsAsyncHandler('settings project serial delete failed', async () => {
						await this.deleteProjectSerialScope(scope);
						render();
					}));
				}
			}

			addRowEl.empty();
			const prefixInput = addRowEl.createEl('input', {
				cls: 'operon-project-serial-input operon-project-serial-prefix-input operon-settings-input-short',
				attr: {
					type: 'text',
					placeholder: t('settings', 'projectSerialPrefixPlaceholder'),
					autocomplete: 'off',
					spellcheck: 'false',
					maxlength: '5',
				},
			});
			prefixInput.value = prefixDraft;
			setAccessibleLabelWithoutTooltip(prefixInput, t('settings', 'projectSerialPrefix'));
			const parentInput = addRowEl.createEl('input', {
				cls: 'operon-project-serial-input operon-project-serial-parent-input operon-settings-input-long',
				attr: {
					type: 'text',
					placeholder: t('settings', 'projectSerialParentPlaceholder'),
					autocomplete: 'off',
					spellcheck: 'false',
				},
			});
			parentInput.value = parentDraft;
			setAccessibleLabelWithoutTooltip(parentInput, t('settings', 'projectSerialParentOperonId'));
			const addButton = createSettingsAddButton(addRowEl, t('settings', 'addProjectSerial'));

			const updateAddButton = (): void => {
				addButton.disabled = !prefixDraft.trim() || !parentDraft.trim();
			};
			const handleInput = (): void => {
				prefixDraft = prefixInput.value;
				parentDraft = parentInput.value;
				updateAddButton();
			};
			const addSerial = async (): Promise<void> => {
				const added = await this.addProjectSerialScope(prefixDraft, parentDraft);
				if (!added) return;
				prefixDraft = '';
				parentDraft = '';
				render();
			};
			prefixInput.addEventListener('input', handleInput);
			parentInput.addEventListener('input', handleInput);
			for (const input of [prefixInput, parentInput]) {
				input.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					void addSerial();
				});
			}
			addButton.addEventListener('click', settingsAsyncHandler('settings project serial add failed', addSerial));
			updateAddButton();
		};

		render();
	}

	private getNormalizedProjectSerialScopes(): ProjectSerialScope[] {
		const normalizedScopes: ProjectSerialScope[] = [];
		const seenIds = new Set<string>();
		const seenParents = new Set<string>();
		for (const scope of this.settings.projectSerialScopes ?? []) {
			const prefix = normalizeProjectSerialPrefix(scope.prefix);
			const parentOperonId = scope.parentOperonId.trim();
			const id = scope.id.trim();
			if (!id || !prefix || !parentOperonId || seenIds.has(id) || seenParents.has(parentOperonId)) continue;
			normalizedScopes.push({
				id,
				prefix,
				parentOperonId,
				createdAt: scope.createdAt.trim(),
				updatedAt: scope.updatedAt.trim(),
			});
			seenIds.add(id);
			seenParents.add(parentOperonId);
		}
		return normalizedScopes;
	}

	private async addProjectSerialScope(prefixInput: string, parentInput: string): Promise<boolean> {
		if (!this.indexer) {
			new Notice(t('settings', 'projectSerialIndexerUnavailable'));
			return false;
		}
		const prefix = normalizeProjectSerialPrefix(prefixInput);
		if (!prefix) {
			new Notice(t('settings', 'projectSerialInvalidPrefix'));
			return false;
		}
		const parentOperonId = parentInput.trim();
		if (!parentOperonId || !this.indexer.getTask(parentOperonId)) {
			new Notice(t('settings', 'projectSerialParentNotFound'));
			return false;
		}
		const scopes = this.getNormalizedProjectSerialScopes();
		if (scopes.some(scope => scope.parentOperonId === parentOperonId)) {
			new Notice(t('settings', 'projectSerialDuplicateParent'));
			return false;
		}
		const now = new Date().toISOString();
		const candidate: ProjectSerialScope = {
			id: createProjectSerialScopeId(scopes.map(scope => scope.id)),
			prefix,
			parentOperonId,
			createdAt: now,
			updatedAt: now,
		};
		const preview = previewProjectSerialScopeAdd({
			scopes,
			candidate,
			tasks: this.indexer.getAllTasks(),
		});
		if ((preview.duplicatePrefixScopeCount > 0 || preview.overlappingScopeCount > 0) && !await this.confirmAddProjectSerialScope(candidate, preview)) {
			return false;
		}
		this.settings.projectSerialScopes = [...scopes, candidate];
		await this.saveProjectSerialSettings();
		return true;
	}

	private async renameProjectSerialScope(scope: ProjectSerialScope, prefixInput: string): Promise<boolean> {
		const prefix = normalizeProjectSerialPrefix(prefixInput);
		if (!prefix) {
			new Notice(t('settings', 'projectSerialInvalidPrefix'));
			return false;
		}
		const scopes = this.getNormalizedProjectSerialScopes();
		const currentScope = scopes.find(candidate => candidate.id === scope.id);
		if (!currentScope) return false;
		if (prefix === currentScope.prefix) return true;
		const duplicatePrefixScopeCount = scopes.filter(candidate =>
			candidate.id !== currentScope.id && candidate.prefix.toLocaleLowerCase() === prefix.toLocaleLowerCase()
		).length;
		if (duplicatePrefixScopeCount > 0 && !await this.confirmRenameProjectSerialScope(prefix, duplicatePrefixScopeCount)) {
			return false;
		}
		const now = new Date().toISOString();
		this.settings.projectSerialScopes = scopes.map(candidate => candidate.id === currentScope.id
			? {
				id: currentScope.id,
				prefix,
				parentOperonId: currentScope.parentOperonId,
				createdAt: currentScope.createdAt,
				updatedAt: now,
			}
			: candidate);
		await this.saveProjectSerialSettings();
		return true;
	}

	private async deleteProjectSerialScope(scope: ProjectSerialScope): Promise<void> {
		if (!this.indexer) {
			new Notice(t('settings', 'projectSerialIndexerUnavailable'));
			return;
		}
		const scopes = this.getNormalizedProjectSerialScopes();
		const preview = previewProjectSerialScopeDelete({
			scopes,
			scopeId: scope.id,
			tasks: this.indexer.getAllTasks(),
		});
		if (!await this.confirmDeleteProjectSerialScope(scope, preview)) return;
		this.settings.projectSerialScopes = scopes.filter(candidate => candidate.id !== scope.id);
		await this.saveProjectSerialSettings();
	}

	private async saveProjectSerialSettings(): Promise<void> {
		await this.persistSettingsOnly();
		const result = await this.storage.projectSerials.reconcile(
			this.settings.projectSerialScopes,
			this.indexer?.getAllTasks() ?? [],
			new Date().toISOString(),
		);
		if (result.capacityBlockedScopeIds.length > 0) {
			new Notice(t('notifications', 'projectSerialCapacityReached'));
		}
		this.notifySettingsChanged();
		this.applyPendingSettingsChange();
	}

	private async confirmAddProjectSerialScope(
		scope: ProjectSerialScope,
		preview: ReturnType<typeof previewProjectSerialScopeAdd>,
	): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'projectSerialAddConfirmTitle', { prefix: scope.prefix }),
				message: this.buildProjectSerialAddConfirmMessage(preview),
				confirmText: t('settings', 'addProjectSerial'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private async confirmDeleteProjectSerialScope(
		scope: ProjectSerialScope,
		preview: ReturnType<typeof previewProjectSerialScopeDelete>,
	): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'projectSerialDeleteConfirmTitle', { prefix: scope.prefix }),
				message: this.buildProjectSerialDeleteConfirmMessage(preview),
				confirmText: t('settings', 'deleteProjectSerial'),
				cancelText: t('buttons', 'cancel'),
				danger: true,
			}, resolve).open();
		});
	}

	private async confirmRenameProjectSerialScope(prefix: string, duplicatePrefixScopeCount: number): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'projectSerialRenameConfirmTitle', { prefix }),
				message: t('settings', 'projectSerialRenameDuplicatePrefixConfirm', {
					count: String(duplicatePrefixScopeCount),
				}),
				confirmText: t('settings', 'saveProjectSerialPrefix'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
	}

	private buildProjectSerialAddConfirmMessage(preview: ReturnType<typeof previewProjectSerialScopeAdd>): string {
		const lines: string[] = [];
		if (preview.duplicatePrefixScopeCount > 0) {
			lines.push(t('settings', 'projectSerialDuplicatePrefixConfirm', {
				count: String(preview.duplicatePrefixScopeCount),
			}));
		}
		if (preview.overlappingScopeCount > 0) {
			lines.push(t('settings', 'projectSerialOverlapConfirm', {
				count: String(preview.overlappingScopeCount),
			}));
		}
		lines.push(t('settings', 'projectSerialChangeCountConfirm', {
			count: String(preview.visibleSerialChangeCount),
		}));
		if (preview.nestedTaskCount > 0) {
			lines.push(t('settings', 'projectSerialNestedRemainConfirm', {
				count: String(preview.nestedTaskCount),
			}));
		}
		return lines.join('\n');
	}

	private buildProjectSerialDeleteConfirmMessage(preview: ReturnType<typeof previewProjectSerialScopeDelete>): string {
		const lines = [
			t('settings', 'projectSerialDeleteLossConfirm', {
				count: String(preview.serialLossCount),
			}),
		];
		if (preview.visibleSerialChangeCount > 0) {
			lines.push(t('settings', 'projectSerialChangeCountConfirm', {
				count: String(preview.visibleSerialChangeCount),
			}));
		}
		if (preview.nestedTaskCount > 0) {
			lines.push(t('settings', 'projectSerialNestedRemainConfirm', {
				count: String(preview.nestedTaskCount),
			}));
		}
		lines.push(t('settings', 'projectSerialDeleteAssignmentsConfirm'));
		return lines.join('\n');
	}

	private getChildTaskInheritanceStatusPipelineOptions(): DropdownSettingOption<ChildTaskInheritanceStatusPipelineSource>[] {
		return [
			{ value: 'parent', label: t('settings', 'childTaskInheritanceStatusPipelineParent') },
			{ value: 'default', label: t('settings', 'childTaskInheritanceStatusPipelineDefault') },
		];
	}

	private populateParentChildTaskInheritanceHeader(headerEl: HTMLElement): void {
		renderSettingsHeading(headerEl, t('settings', 'parentChildTaskInheritance'), 'operon-parent-child-inheritance-heading');
		headerEl.createEl('p', {
			text: t('settings', 'parentChildTaskInheritanceDesc'),
			cls: 'operon-native-settings-section-desc',
		});
	}

	private renderParentChildTaskInheritanceSettings(containerEl: HTMLElement): void {
		const isSearchRender = containerEl.hasClass('operon-settings-search-bounded-render');
		if (isSearchRender) {
			containerEl.addClass('operon-parent-child-inheritance-render-host');
		}
		const sectionWrapperEl = containerEl.createDiv('operon-native-settings-section operon-parent-child-inheritance-setting');
		this.populateParentChildTaskInheritanceHeader(sectionWrapperEl);
		this.markSettingsSearchSectionTarget(sectionWrapperEl, 'automation.parentChildTaskInheritance');

		const sectionEl = sectionWrapperEl.createDiv('operon-native-settings-section-card operon-parent-child-inheritance-section-body');

		const listEl = sectionEl.createDiv('operon-parent-child-inheritance-list');
		const addRowEl = sectionEl.createDiv('operon-parent-child-inheritance-add-row');
		parentChildInheritanceSearchInstanceId += 1;
		const searchListId = `operon-parent-child-inheritance-results-${parentChildInheritanceSearchInstanceId}`;
		const searchOptionIdPrefix = `${searchListId}-option`;

		let query = '';
		let selectedKey = '';
		let activeResultIndex = 0;

		const saveInheritanceFields = async (): Promise<void> => {
			this.settings.childTaskInheritanceFields = normalizeChildTaskInheritanceFields(
				this.settings.childTaskInheritanceFields,
				this.settings.keyMappings,
			);
			await this.saveSettings();
		};

		const getOption = (key: string): ChildTaskInheritanceFieldOption | null => {
			return this.getParentChildTaskInheritanceFieldOptions().find(option => option.key === key) ?? null;
		};

		const render = (): void => {
			this.settings.childTaskInheritanceFields = normalizeChildTaskInheritanceFields(
				this.settings.childTaskInheritanceFields,
				this.settings.keyMappings,
			);
			const selectedKeys = new Set(this.settings.childTaskInheritanceFields);
			listEl.empty();
			for (const fieldKey of this.settings.childTaskInheritanceFields) {
				const option = getOption(fieldKey);
				if (!option) continue;
				const rowEl = listEl.createDiv('operon-parent-child-inheritance-row');
				const iconEl = rowEl.createSpan('operon-parent-child-inheritance-row-icon');
				setIcon(iconEl, option.icon);
				rowEl.createSpan({
					cls: 'operon-parent-child-inheritance-row-label',
					text: option.label,
				});
				rowEl.createSpan({
					cls: 'operon-parent-child-inheritance-row-key',
					text: `{{${option.key}:: }}`,
				});
				const removeButton = rowEl.createEl('button', {
					cls: 'operon-parent-child-inheritance-remove',
					attr: { type: 'button' },
				});
				setIcon(removeButton, 'trash-2');
				setAccessibleLabelWithoutTooltip(removeButton, `${t('settings', 'removeParentChildInheritanceField')}: ${option.label}`);
				removeButton.addEventListener('click', settingsAsyncHandler('settings parent-child inheritance remove failed', async () => {
					this.settings.childTaskInheritanceFields = this.settings.childTaskInheritanceFields.filter(key => key !== fieldKey);
					await saveInheritanceFields();
					render();
				}));
			}
			if (this.settings.childTaskInheritanceFields.length === 0) {
				listEl.createDiv({
					text: t('settings', 'parentChildTaskInheritanceEmpty'),
					cls: 'operon-parent-child-inheritance-empty',
				});
			}

			addRowEl.empty();
			const inputWrapEl = addRowEl.createDiv('operon-parent-child-inheritance-search-wrap');
			const inputEl = inputWrapEl.createEl('input', {
				cls: 'operon-parent-child-inheritance-search operon-settings-input-long',
				attr: {
					type: 'text',
					placeholder: t('settings', 'parentChildTaskInheritanceSearchPlaceholder'),
					autocomplete: 'off',
					spellcheck: 'false',
					role: 'combobox',
					'aria-autocomplete': 'list',
					'aria-controls': searchListId,
					'aria-expanded': 'false',
				},
			});
			setAccessibleLabelWithoutTooltip(inputEl, t('settings', 'parentChildTaskInheritanceSearch'));
			inputEl.value = query;
			const resultsEl = inputWrapEl.createDiv('operon-parent-child-inheritance-results');
			resultsEl.id = searchListId;
			resultsEl.setAttribute('role', 'listbox');
			resultsEl.setAttribute('aria-label', t('settings', 'parentChildTaskInheritanceSearch'));
			const addButton = createSettingsAddButton(addRowEl, t('settings', 'addParentChildInheritanceField'));
			addButton.disabled = true;
			let visibleOptions: ChildTaskInheritanceFieldOption[] = [];

			const selectResult = (option: ChildTaskInheritanceFieldOption): void => {
				selectedKey = option.key;
				query = option.label;
				inputEl.value = query;
				activeResultIndex = 0;
				renderResults();
			};

			const renderResults = (): void => {
				const normalizedQuery = query.trim().toLocaleLowerCase();
				const availableOptions = this.getParentChildTaskInheritanceFieldOptions()
					.filter(option => !selectedKeys.has(option.key));
				visibleOptions = [];
				resultsEl.empty();
				if (!normalizedQuery || selectedKey) {
					addButton.disabled = !selectedKey;
					inputEl.setAttribute('aria-expanded', 'false');
					inputEl.removeAttribute('aria-activedescendant');
					return;
				}
				if (availableOptions.length === 0) {
					addButton.disabled = true;
					inputEl.setAttribute('aria-expanded', 'true');
					inputEl.removeAttribute('aria-activedescendant');
					resultsEl.createDiv({
						text: t('settings', 'parentChildTaskInheritanceNoAvailableFields'),
						cls: 'operon-parent-child-inheritance-result-empty',
					});
					return;
				}
				visibleOptions = availableOptions
					.filter(option => option.searchText.includes(normalizedQuery))
					.slice(0, 8);
				addButton.disabled = !selectedKey;
				inputEl.setAttribute('aria-expanded', 'true');
				if (visibleOptions.length === 0) {
					inputEl.removeAttribute('aria-activedescendant');
					resultsEl.createDiv({
						text: t('settings', 'parentChildTaskInheritanceNoMatches'),
						cls: 'operon-parent-child-inheritance-result-empty',
					});
					return;
				}
				activeResultIndex = Math.max(0, Math.min(activeResultIndex, visibleOptions.length - 1));
				for (const [index, option] of visibleOptions.entries()) {
					const resultEl = resultsEl.createEl('button', {
						cls: 'operon-parent-child-inheritance-result',
						attr: {
							type: 'button',
							id: `${searchOptionIdPrefix}-${index}`,
							role: 'option',
							'aria-selected': String(index === activeResultIndex),
						},
					});
					resultEl.toggleClass('is-selected', index === activeResultIndex);
					resultEl.dataset.optionIndex = String(index);
					const iconEl = resultEl.createSpan('operon-parent-child-inheritance-result-icon');
					setIcon(iconEl, option.icon);
					resultEl.createSpan({
						cls: 'operon-parent-child-inheritance-result-label',
						text: option.label,
					});
					resultEl.createSpan({
						cls: 'operon-parent-child-inheritance-result-key',
						text: `{{${option.key}:: }}`,
					});
					resultEl.addEventListener('mouseenter', () => {
						if (activeResultIndex === index) return;
						activeResultIndex = index;
						renderResults();
					});
					resultEl.addEventListener('click', () => {
						selectResult(option);
					});
				}
				inputEl.setAttribute('aria-activedescendant', `${searchOptionIdPrefix}-${activeResultIndex}`);
			};

			inputEl.addEventListener('input', () => {
				query = inputEl.value;
				selectedKey = '';
				activeResultIndex = 0;
				renderResults();
			});
			inputEl.addEventListener('keydown', event => {
				if (event.key === 'ArrowDown') {
					if (visibleOptions.length === 0) return;
					event.preventDefault();
					activeResultIndex = Math.min(activeResultIndex + 1, visibleOptions.length - 1);
					renderResults();
					return;
				}
				if (event.key === 'ArrowUp') {
					if (visibleOptions.length === 0) return;
					event.preventDefault();
					activeResultIndex = Math.max(activeResultIndex - 1, 0);
					renderResults();
					return;
				}
				if (event.key !== 'Enter') return;
				if (selectedKey) {
					event.preventDefault();
					addButton.click();
					return;
				}
				const activeOption = visibleOptions[activeResultIndex];
				if (!activeOption) return;
				event.preventDefault();
				selectResult(activeOption);
			});
			addButton.addEventListener('click', settingsAsyncHandler('settings parent-child inheritance add failed', async () => {
				if (!selectedKey || selectedKeys.has(selectedKey)) return;
				this.settings.childTaskInheritanceFields = [...this.settings.childTaskInheritanceFields, selectedKey];
				query = '';
				selectedKey = '';
				await saveInheritanceFields();
				render();
			}));
			renderResults();
		};

		render();
	}

	private getParentChildTaskInheritanceFieldOptions(): ChildTaskInheritanceFieldOption[] {
		const options: ChildTaskInheritanceFieldOption[] = [];
		for (const canonical of CANONICAL_KEY_ORDER) {
			if (!isChildTaskInheritanceEligibleFieldKey(canonical.name, this.settings.keyMappings)) continue;
			const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === canonical.name);
			const label = mapping?.visiblePropertyName?.trim() || canonical.name;
			options.push({
				key: canonical.name,
				label,
				icon: mapping?.icon?.trim() || (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[canonical.name] || 'circle-dot',
				type: canonical.type,
				searchText: `${label} ${canonical.name} ${canonical.type} ${canonical.description}`.toLocaleLowerCase(),
			});
		}
		options.push({
			key: CHILD_TASK_INHERITANCE_TAGS_KEY,
			label: t('taskEditor', 'tags'),
			icon: (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[CHILD_TASK_INHERITANCE_TAGS_KEY] || 'tags',
			type: 'list',
			searchText: `${t('taskEditor', 'tags')} ${CHILD_TASK_INHERITANCE_TAGS_KEY} list`.toLocaleLowerCase(),
		});
		for (const mapping of getManagedCustomFieldMappings(this.settings.keyMappings, { includeCheckbox: true })) {
			if (mapping.canonicalKey === CHILD_TASK_INHERITANCE_TAGS_KEY) continue;
			if (!isChildTaskInheritanceEligibleFieldKey(mapping.canonicalKey, this.settings.keyMappings)) continue;
			const label = getCustomFieldLabel(mapping);
			options.push({
				key: mapping.canonicalKey,
				label,
				icon: getCustomFieldIcon(mapping),
				type: mapping.type,
				searchText: `${label} ${mapping.canonicalKey} ${mapping.type} ${mapping.description ?? ''}`.toLocaleLowerCase(),
			});
		}
		return options;
	}

	private renderGeneralSystemTab(containerEl: HTMLElement): void {
		// --- Timing ---
		this.addNumericSetting(containerEl, t('settings', 'indexDebounce'), t('settings', 'indexDebounceDesc'), 'indexEventDebounceMs');

		this.renderBoundToggleSetting(containerEl, t('settings', 'fullReindexOnStartup'), t('settings', 'fullReindexOnStartupDesc'), 'fullReindexOnStartup');
		this.renderBoundToggleSetting(containerEl, t('settings', 'duplicateAlertAutoOpenManager'), t('settings', 'duplicateAlertAutoOpenManagerDesc'), 'duplicateAlertAutoOpenManager');
		this.renderBoundDropdownSetting(containerEl, t('settings', 'duplicateAlertDelay'), t('settings', 'duplicateAlertDelayDesc'), 'duplicateAlertDelaySeconds', {
			value: String(this.settings.duplicateAlertDelaySeconds),
			dropdownOptions: DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS.map(seconds => ({
				value: String(seconds),
				label: t('settings', 'duplicateAlertDelayOption', { seconds: String(seconds) }),
			})),
			normalize: value => Number(value),
		});
	}

	private renderStorageCleanupSection(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv('operon-legacy-storage-cleanup-section');
		this.setLegacyStorageCleanupElementVisible(sectionEl, false);
		runSettingsAsync('settings legacy storage cleanup status failed', async () => {
			const status = await this.storage.getLegacyStorageCleanupStatus();
			if (!status.legacyExists) {
				this.setLegacyStorageCleanupElementVisible(sectionEl, false);
				return;
			}
			sectionEl.empty();
			renderSettingsHeading(sectionEl, t('settings', 'storageSection'));
			const setting = new Setting(sectionEl);
			this.renderLegacyStorageCleanupCard(sectionEl, setting, status);
		});
	}

	private renderLegacyStorageCleanupSearchEntry(setting: Setting): void {
		const settingEl = setting.settingEl;
		this.setLegacyStorageCleanupElementVisible(settingEl, false);
		setting.setName('');
		setting.setDesc('');
		setting.controlEl.empty();
		runSettingsAsync('settings legacy storage cleanup search status failed', async () => {
			const status = await this.storage.getLegacyStorageCleanupStatus();
			if (!status.legacyExists) {
				this.setLegacyStorageCleanupElementVisible(settingEl, false);
				return;
			}
			this.renderLegacyStorageCleanupCard(settingEl, setting, status);
		});
	}

	private renderLegacyStorageCleanupCard(
		outerEl: HTMLElement,
		setting: Setting,
		status: OperonLegacyStorageCleanupStatus,
	): void {
		setting.settingEl.addClass('operon-legacy-storage-cleanup-card');
		setting
			.setName(t('settings', 'legacyStorageCleanupTitle'))
			.setDesc(this.getLegacyStorageCleanupStatusText(status));
		setting.controlEl.empty();
		let cleanupButton: ButtonComponent | null = null;
		setting.addButton(button => {
			cleanupButton = button;
			button
				.setButtonText(t('settings', 'legacyStorageCleanupButton'))
				.setCta()
				.setDisabled(!status.canCleanup)
				.onClick(() => {
					this.confirmLegacyStorageCleanup();
				});
			this.setLegacyStorageCleanupElementVisible(button.buttonEl, status.canCleanup);
		});
		this.applyLegacyStorageCleanupStatus(outerEl, cleanupButton, status);
	}

	private applyLegacyStorageCleanupStatus(
		outerEl: HTMLElement,
		cleanupButton: ButtonComponent | null,
		status: OperonLegacyStorageCleanupStatus,
	): void {
		if (!status.legacyExists) {
			this.setLegacyStorageCleanupElementVisible(outerEl, false);
			if (cleanupButton) this.setLegacyStorageCleanupElementVisible(cleanupButton.buttonEl, false);
			cleanupButton?.setDisabled(true);
			return;
		}
		this.setLegacyStorageCleanupElementVisible(outerEl, true);
		cleanupButton?.setDisabled(!status.canCleanup);
		if (cleanupButton) this.setLegacyStorageCleanupElementVisible(cleanupButton.buttonEl, status.canCleanup);
	}

	private setLegacyStorageCleanupElementVisible(element: HTMLElement, visible: boolean): void {
		element.toggleAttribute('hidden', !visible);
		element.setAttribute('aria-hidden', visible ? 'false' : 'true');
		element.style.display = visible ? '' : 'none';
	}

	private getLegacyStorageCleanupStatusText(status: OperonLegacyStorageCleanupStatus): string {
		if (status.state === 'retired' && status.legacyExists) return t('settings', 'legacyStorageCleanupRetiredPresent');
		if (status.state === 'retired') return t('settings', 'legacyStorageCleanupRetired');
		if (status.state === 'missing') return t('settings', 'legacyStorageCleanupMissing');
		if (status.state === 'blocked') return t('settings', 'legacyStorageCleanupBlockedDesc');
		return t('settings', 'legacyStorageCleanupReady', {
			files: String(status.legacyFileCount),
			folders: String(status.legacyFolderCount),
		});
	}

	private confirmLegacyStorageCleanup(): void {
		new ConfirmActionModal(this.app, {
			title: t('settings', 'legacyStorageCleanupConfirmTitle'),
			message: t('settings', 'legacyStorageCleanupConfirmMessage'),
			confirmText: t('settings', 'legacyStorageCleanupConfirmButton'),
			cancelText: t('settings', 'legacyStorageCleanupCancelButton'),
		}, (confirmed) => {
			if (!confirmed) return;
			runSettingsAsync('settings legacy storage cleanup failed', async () => {
				try {
					const result = await this.storage.cleanupLegacyStorageFromSettings();
					if (!result.cleanupPerformed) {
						new Notice(t('notifications', 'legacyStorageCleanupBlocked'));
						this.redisplayPreservingScroll();
						return;
					}
					this.hideLegacyStorageCleanupCards();
					new Notice(t('notifications', 'legacyStorageCleanupSucceeded'));
					this.redisplayPreservingScroll();
				} catch (error) {
					console.warn('Operon: legacy storage cleanup failed', error);
					new Notice(t('notifications', 'legacyStorageCleanupFailed'));
					this.redisplayPreservingScroll();
				}
			});
		}).open();
	}

	private hideLegacyStorageCleanupCards(): void {
		const cleanupEls = this.containerEl.querySelectorAll<HTMLElement>(
			'.operon-legacy-storage-cleanup-section, .operon-legacy-storage-cleanup-card',
		);
		for (const cleanupEl of Array.from(cleanupEls)) {
			this.setLegacyStorageCleanupElementVisible(cleanupEl, false);
		}
	}

	private renderTasksFileTasksTab(containerEl: HTMLElement): void {
		const defaultLocationSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'fileTasksSection'));

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

		this.renderBoundTextSetting(defaultLocationSection, t('settings', 'fileTasksFolder'), t('settings', 'fileTasksFolderDesc'), 'fileTasksFolder', {
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

		const placementSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'parentAwareFileTaskPlacement'));

		this.renderBoundDropdownSetting(placementSection, t('settings', 'fileTaskInlineParentTargetMode'), t('settings', 'fileTaskInlineParentTargetModeDesc'), 'fileTaskParentInlineTargetMode', {
			value: this.settings.fileTaskParentInlineTargetMode,
			dropdownOptions: [
				{ value: 'same-folder', label: t('settings', 'fileTaskInlineParentTargetSameFolder') },
				{ value: 'default', label: t('settings', 'fileTaskParentTargetDefault') },
			],
		});

		this.renderBoundDropdownSetting(placementSection, t('settings', 'fileTaskFileParentTargetMode'), t('settings', 'fileTaskFileParentTargetModeDesc'), 'fileTaskParentFileTargetMode', {
			value: this.settings.fileTaskParentFileTargetMode,
			dropdownOptions: [
				{ value: 'same-folder', label: t('settings', 'fileTaskFileParentTargetSameFolder') },
				{ value: 'default', label: t('settings', 'fileTaskParentTargetDefault') },
			],
		});

		const templateSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'fileTaskTemplates'));
		this.renderFileTaskTemplateSettings(templateSection, containerEl);
	}

	private renderTasksInlineTasksTab(containerEl: HTMLElement): void {
		const defaultLocationSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'inlineTasksSection'));
		const dailyNotesAvailable = isDailyNotesCoreAvailable(this.app);
		const effectiveInlineTaskSaveMode = resolveEffectiveInlineTaskSaveMode(this.settings, dailyNotesAvailable);

		this.renderBoundDropdownSetting(defaultLocationSection, t('settings', 'inlineTaskDefaultSavePath'), t('settings', 'inlineTaskDefaultSavePathDesc'), 'inlineTaskSaveMode', {
			value: effectiveInlineTaskSaveMode,
			dropdownOptions: [
				{ value: 'daily-notes', label: t('settings', 'inlineTaskSavePathDailyNotes') },
				{ value: 'specific-file', label: t('settings', 'inlineTaskSavePathSpecificFile') },
				{ value: 'active-file', label: t('settings', 'inlineTaskSavePathActiveFile') },
				{ value: 'ask-every-time', label: t('settings', 'inlineTaskSavePathAskEveryTime') },
			],
			normalize: value => value,
			onBeforeSave: value => {
				this.settings.inlineTaskUseDailyNote = value === 'daily-notes';
			},
			onAfterChange: () => {
				this.redisplayPreservingScroll();
			},
		});

		const targetFileSetting = this.renderBoundTextSetting(defaultLocationSection, t('settings', 'inlineTaskTargetFile'), t('settings', 'inlineTaskTargetFileDesc'), 'inlineTaskTargetFile', {
			placeholder: DEFAULT_INLINE_TASK_TARGET_FILE,
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			disabled: effectiveInlineTaskSaveMode !== 'specific-file',
			configure: text => {
				new FileSuggest(this.app, text.inputEl, settingsAsyncHandler('settings inline target file selection failed', async (file) => {
					this.settings.inlineTaskTargetFile = file.path;
					await this.saveSettings();
				}));
			},
		});
		this.decorateActivationSetting(targetFileSetting, effectiveInlineTaskSaveMode === 'specific-file');

		const inlineHeadingActive = effectiveInlineTaskSaveMode === 'daily-notes'
			|| effectiveInlineTaskSaveMode === 'active-file'
			|| effectiveInlineTaskSaveMode === 'ask-every-time';
		const inlineHeadingSetting = renderTextSetting({
			containerEl: defaultLocationSection,
			name: t('settings', 'inlineTaskHeading'),
			desc: t('settings', 'inlineTaskHeadingDesc'),
			value: this.settings.inlineTaskHeading,
			placeholder: DEFAULT_INLINE_TASK_HEADING_KEYWORD,
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			disabled: !inlineHeadingActive,
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
		this.decorateActivationSetting(inlineHeadingSetting, inlineHeadingActive);

		const placementSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'parentAwareInlineSaveLocation'));

		this.renderBoundDropdownSetting(placementSection, t('settings', 'inlineParentTaskTargetMode'), t('settings', 'inlineParentTaskTargetModeDesc'), 'inlineTaskParentInlineTargetMode', {
			value: this.settings.inlineTaskParentInlineTargetMode,
			dropdownOptions: [
				{ value: 'below-parent', label: t('settings', 'inlineParentTaskTargetBelowParent') },
				{ value: 'default', label: t('settings', 'inlineParentTaskTargetDefault') },
			],
		});

		this.renderBoundDropdownSetting(placementSection, t('settings', 'fileParentTaskTargetMode'), t('settings', 'fileParentTaskTargetModeDesc'), 'inlineTaskParentFileTargetMode', {
			value: this.settings.inlineTaskParentFileTargetMode,
			dropdownOptions: [
				{ value: 'inside-parent-file', label: t('settings', 'fileParentTaskTargetInsideParentFile') },
				{ value: 'default', label: t('settings', 'fileParentTaskTargetDefault') },
			],
			onAfterChange: () => {
				this.redisplayPreservingScroll();
			},
		});

		const parentFileHeadingActive = this.settings.inlineTaskParentFileTargetMode === 'inside-parent-file';
		const parentFileHeadingSetting = renderTextSetting({
			containerEl: placementSection,
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

		const dailyNoteDefaultsSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'dailyNoteInlineTaskDefaults'));
		this.renderBoundToggleSetting(dailyNoteDefaultsSection, t('settings', 'inlineTaskDailyNoteAddStartDate'), t('settings', 'inlineTaskDailyNoteAddStartDateDesc'), 'inlineTaskDailyNoteAddStartDate');
		this.renderBoundToggleSetting(dailyNoteDefaultsSection, t('settings', 'inlineTaskDailyNoteAddScheduledDate'), t('settings', 'inlineTaskDailyNoteAddScheduledDateDesc'), 'inlineTaskDailyNoteAddScheduledDate');

		const conversionSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'checkboxConversion'));
		this.renderBoundToggleSetting(conversionSection, t('settings', 'showTasksEmojiConvertIcon'), t('settings', 'showTasksEmojiConvertIconDesc'), 'inlineTaskShowTasksEmojiConvertIcon');
		this.renderBoundToggleSetting(conversionSection, t('settings', 'showPlainCheckboxConvertIcon'), t('settings', 'showPlainCheckboxConvertIconDesc'), 'inlineTaskShowPlainCheckboxConvertIcon');
	}

	private renderInterfaceStateIconsTab(containerEl: HTMLElement): void {
		const sectionEl = renderNativeSettingsGroupedSection(containerEl, t('settings', 'fallbackTaskStateIcons'));
		this.renderFallbackTaskIconSourceSetting(sectionEl);
		this.renderStateIconSetting(sectionEl, 'open', t('settings', 'fallbackOpenStateIcon'), t('settings', 'fallbackOpenStateIconDesc'));
		this.renderStateIconSetting(sectionEl, 'done', t('settings', 'fallbackFinishedStateIcon'), t('settings', 'fallbackFinishedStateIconDesc'));
		this.renderStateIconSetting(sectionEl, 'cancelled', t('settings', 'fallbackCancelledStateIcon'), t('settings', 'fallbackCancelledStateIconDesc'));
	}

	private renderFallbackTaskIconSourceSetting(containerEl: HTMLElement): void {
		const setting = renderDropdownSetting<FallbackTaskIconSource>({
			containerEl,
			name: t('settings', 'fallbackTaskIconSource'),
			desc: t('settings', 'fallbackTaskIconSourceDesc'),
			value: this.settings.fallbackTaskIconSource,
			options: [
				{ value: 'pipelineStatusIcon', label: t('settings', 'fallbackTaskIconSourcePipelineStatus') },
				{ value: 'priorityIcon', label: t('settings', 'fallbackTaskIconSourcePriority') },
				{ value: 'stateIcon', label: t('settings', 'fallbackTaskIconSourceState') },
			],
			controlClass: 'operon-fallback-icon-source-dropdown',
			onChange: settingsAsyncHandler('settings fallback task icon source change failed', async (source) => {
				if (this.settings.fallbackTaskIconSource === source) return;
				this.settings.fallbackTaskIconSource = source;
				await this.saveSettings();
			}),
		});
		setting.settingEl.addClass('operon-fallback-icon-source-setting');
		setting.settingEl.dataset.operonSettingsSearchId = 'ui.fallbackTaskIconSource';
		this.markSettingsSearchTarget(setting, 'fallbackTaskIconSource');
	}

	private decorateActivationSetting(setting: Setting, active: boolean): void {
		setting.settingEl.addClass(active ? 'operon-settings-control-active' : 'operon-settings-control-inactive');
		setting.settingEl.setAttribute('aria-disabled', active ? 'false' : 'true');
	}

	private renderInterfacePinnedDockTab(containerEl: HTMLElement): void {
		const mainSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'pinnedTasksSection'));

		this.renderBoundDropdownSetting(mainSection, t('settings', 'pinnedTasksDesktopSurface'), t('settings', 'pinnedTasksDesktopSurfaceDesc'), 'pinnedTasksDesktopSurface', {
			value: this.settings.pinnedTasksDesktopSurface,
			dropdownOptions: [
				{ value: 'floating', label: t('settings', 'pinnedTasksDesktopSurfaceFloating') },
				{ value: 'sidebar', label: t('settings', 'pinnedTasksDesktopSurfaceSidebar') },
			],
		});

		if (!containerEl.closest('.operon-settings-native-page-root')) {
			renderSettingsInfoBox(mainSection, t('settings', 'pinnedTasksMobileSidebarNoteTitle'), t('settings', 'pinnedTasksMobileSidebarNoteDesc'));
		}

		const sharedSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'pinnedTasksSharedSettings'));

		this.renderBoundDropdownSetting(sharedSection, t('settings', 'pinnedDockTaskColorSource'), t('settings', 'pinnedDockTaskColorSourceDesc'), 'pinnedDockColorSource', {
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

		this.renderBoundToggleSetting(sharedSection, t('settings', 'pinnedDockAutoPinActiveTimerTask'), t('settings', 'pinnedDockAutoPinActiveTimerTaskDesc'), 'pinnedDockAutoPin');
		this.renderBoundToggleSetting(sharedSection, t('settings', 'pinnedDockAutoUnpinFinishedTasks'), t('settings', 'pinnedDockAutoUnpinFinishedTasksDesc'), 'pinnedDockAutoUnpinFinished');

		const sidebarSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'pinnedTasksSidebarSection'));

		this.renderBoundDropdownSetting(sidebarSection, t('settings', 'pinnedTasksSidebarSide'), t('settings', 'pinnedTasksSidebarSideDesc'), 'pinnedTasksSidebarSide', {
			value: this.settings.pinnedTasksSidebarSide,
			dropdownOptions: [
				{ value: 'left', label: t('settings', 'pinnedTasksSidebarSideLeft') },
				{ value: 'right', label: t('settings', 'pinnedTasksSidebarSideRight') },
			],
		});

		const dockSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'pinnedDockSection'));

		this.renderBoundToggleSetting(dockSection, t('settings', 'pinnedDockAutoClose'), t('settings', 'pinnedDockAutoCloseDesc'), 'pinnedDockAutoCloseEnabled', {
			onBeforeSave: value => {
				if (!value) this.settings.pinnedDockCollapsed = false;
			},
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundClampedNumericSetting(dockSection, t('settings', 'pinnedDockAutoCloseDelay'), t('settings', 'pinnedDockAutoCloseDelayDesc'), 'floatingAutoCloseSec', {
			min: 5,
			max: 600,
			fallback: this.settings.floatingAutoCloseSec,
		});

		this.renderBoundClampedNumericSetting(dockSection, t('settings', 'pinnedDockTaskCardWidth'), t('settings', 'pinnedDockTaskCardWidthDesc'), 'pinnedTaskItemWidth', {
			min: 120,
			max: 800,
			fallback: this.settings.pinnedTaskItemWidth,
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundToggleSetting(dockSection, t('settings', 'pinnedDockDisableOnMobile'), t('settings', 'pinnedDockDisableOnMobileDesc'), 'pinnedDockDisableOnMobile', {
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundDropdownSetting(dockSection, t('settings', 'pinnedDockLayout'), t('settings', 'pinnedDockLayoutDesc'), 'pinnedDockLayout', {
			value: this.settings.pinnedDockLayout,
			dropdownOptions: [
				{ value: 'horizontal', label: t('settings', 'pinnedDockLayoutHorizontal') },
				{ value: 'vertical', label: t('settings', 'pinnedDockLayoutVertical') },
				{ value: 'grid', label: t('settings', 'pinnedDockLayoutGrid') },
			],
			onAfterChange: () => {
				this.onDockRefreshLayout();
			},
		});

		this.renderBoundDropdownSetting(dockSection, t('settings', 'pinnedDockGridColumns'), t('settings', 'pinnedDockGridColumnsDesc'), 'pinnedDockGridCols', {
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
	}

	private renderTasksRecurrenceTab(containerEl: HTMLElement): void {
		const repeatingBody = renderNativeSettingsGroupedSection(containerEl, t('settings', 'repeatingTasks'));
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
		this.renderRepeatSeriesYamlPropertyRemovalSection(containerEl);
	}

	private renderInterfaceTaskFinderTab(containerEl: HTMLElement): void {
		const behaviorSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskFinderBehaviorSection'));
		this.renderTaskFinderBehaviorSettingsSection(behaviorSection);
		this.renderTaskFinderShortcutSettings(containerEl);
	}

	private renderInterfaceTaskChipsTab(containerEl: HTMLElement): void {
		for (const pageId of TASK_CHIPS_SETTINGS_PAGE_ORDER) {
			this.renderTaskChipsSettingsPageContent(pageId, containerEl, {
				collapsibleFallback: true,
			});
		}
	}

	private renderTaskChipsSettingsPageContent(
		pageId: TaskChipsSettingsPageId,
		containerEl: HTMLElement,
		options: { collapsibleFallback?: boolean; omitNativeTitle?: boolean } = {},
	): void {
		const meta = TASK_CHIPS_SETTINGS_PAGE_META[pageId];
		const title = t('settings', meta.titleKey);
		const desc = t('settings', meta.descKey);
		const sectionOptions = {
			sectionId: pageId,
			desc,
			collapsibleFallback: options.collapsibleFallback,
			omitNativeTitle: options.omitNativeTitle,
		};

		if (pageId === 'taskCreatorToolbar') {
			this.renderTaskCreatorToolbarSettingsSection(this.renderTaskChipsGroupedSection(containerEl, title, sectionOptions));
		} else if (pageId === 'inlineTaskChips') {
			this.renderInlineTaskCompactChipSettingsSection(this.renderTaskChipsGroupedSection(containerEl, title, sectionOptions));
		} else if (pageId === 'taskFinderChips') {
			this.renderTaskFinderCompactChipSettingsSection(this.renderTaskChipsGroupedSection(containerEl, title, sectionOptions));
		} else if (pageId === 'filterTaskChips') {
			this.renderFilterTaskCardsSection(containerEl, sectionOptions);
		} else if (pageId === 'fileTaskOverlayChips') {
			this.renderOverlayTaskCompactChipSettingsSection(this.renderTaskChipsGroupedSection(containerEl, title, sectionOptions));
		}
	}

	private renderTaskChipsGroupedSection(
		containerEl: HTMLElement,
		title: string,
		options: {
			sectionId?: TaskChipsSettingsPageId;
			desc?: string;
			collapsibleFallback?: boolean;
			omitNativeTitle?: boolean;
		} = {},
	): HTMLElement {
		const isNativePage = !!containerEl.closest('.operon-settings-native-page-root');
		if (options.omitNativeTitle && isNativePage) {
			const sectionEl = containerEl.createDiv('operon-native-settings-section-card');
			this.applyInterfaceIconListSectionStyle(sectionEl);
			sectionEl.addClass('operon-task-chips-settings-section');
			return sectionEl;
		}

		if (!isNativePage && options.collapsibleFallback && options.sectionId) {
			const sectionEl = createSettingsCollapsibleSection({
				containerEl,
				title,
				desc: options.desc,
				sectionId: `task-chips-${options.sectionId}`,
				expandedSectionIds: this.expandedSectionIds,
				defaultOpen: false,
			});
			this.applyInterfaceIconListSectionStyle(sectionEl);
			sectionEl.addClass('operon-task-chips-settings-section');
			return sectionEl;
		}

		const sectionEl = renderNativeSettingsGroupedSection(containerEl, title);
		this.applyInterfaceIconListSectionStyle(sectionEl);
		sectionEl.addClass('operon-task-chips-settings-section');
		return sectionEl;
	}

	private applyInterfaceIconListSectionStyle(sectionEl: HTMLElement): void {
		sectionEl.addClass('operon-settings-add-list-section');
		sectionEl.addClass('operon-settings-card-list-section');
		sectionEl.addClass('operon-interface-icon-list-settings-section');
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
	}

	private renderTaskFinderShortcutSettings(containerEl: HTMLElement): void {
		const shortcutSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'taskFinderHotkeysSection'));
		shortcutSection.addClass('operon-settings-add-list-section');
		shortcutSection.addClass('operon-settings-card-list-section');

		const description = shortcutSection.createEl('p', {
			text: t('settings', 'taskFinderShortcutsDesc'),
		});
		description.addClass('operon-settings-section-desc');
		description.dataset.operonSettingsSearchId = 'ui.taskFinderHotkeys';

		const shortcutsEl = shortcutSection.createDiv('operon-task-finder-shortcut-settings');
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
			if (!previewEl) return;
			const command = formatPreview(value);
			const preview = t('settings', 'taskFinderShortcutPreview', { command });
			const commandStart = preview.indexOf(command);
			previewEl.empty();
			if (commandStart < 0) {
				previewEl.setText(preview);
				return;
			}
			previewEl.appendChild(previewEl.ownerDocument.createTextNode(preview.slice(0, commandStart)));
			previewEl.createSpan({
				text: command,
				cls: 'operon-task-finder-shortcut-preview-command',
			});
			previewEl.appendChild(previewEl.ownerDocument.createTextNode(preview.slice(commandStart + command.length)));
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
		setting.settingEl.addClass('operon-settings-list-card');
	}

	private renderRepeatSeriesYamlPropertyRemovalSection(containerEl: HTMLElement): void {
		const sectionBody = renderNativeSettingsGroupedSection(containerEl, t('settings', 'repeatYamlPropertyRemovalTitle'));
		this.renderRepeatSeriesYamlPropertyRemovalBody(sectionBody);
	}

	private renderRepeatSeriesYamlPropertyRemovalBody(containerEl: HTMLElement): void {
		if (containerEl.hasClass('operon-settings-search-bounded-render')) {
			containerEl.addClass('operon-repeat-property-cleanup-render-host');
		}
		containerEl.addClass('operon-settings-add-list-section');
		containerEl.addClass('operon-settings-card-list-section');
		const repeatYamlCleanupDescEl = containerEl.createEl('p', {
			text: t('settings', 'repeatYamlPropertyRemovalDesc'),
			cls: 'operon-settings-muted-block',
		});
		repeatYamlCleanupDescEl.dataset.operonSettingsSearchId = 'automation.repeatYamlCleanup';
		const listEl = containerEl.createDiv('operon-repeat-property-cleanup-list');
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

		const addRowEl = containerEl.createDiv('operon-settings-add-row operon-repeat-property-cleanup-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('settings', 'repeatYamlPropertyRemovalAdd'));
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

	private isCustomSurfaceMappingVisible(mapping: KeyMapping, surface: CustomSurfaceSettingsTarget): boolean {
		if (surface === 'kanbanSwimlane') return mapping.showInKanbanSwimlane === true;
		const entries = surface === 'editor'
			? [...this.settings.taskEditorWorkflowPickers, ...this.settings.taskEditorMobileCoreTools]
			: surface === 'creator'
				? this.settings.taskCreatorToolbar
				: [
					...this.settings.inlineTaskCompactChips,
					...this.settings.taskFinderCompactChips,
					...this.settings.filterTaskCompactChips,
					...this.settings.overlayTaskCompactChips,
				];
		const matches = entries.filter(entry => entry.key === mapping.canonicalKey);
		if (matches.length > 0) return matches.some(entry => entry.visible);
		if (surface === 'editor') return mapping.showInEditor !== false;
		if (surface === 'creator') return mapping.showInCreator !== false;
		return mapping.showInChips === true;
	}

	private setCustomSurfaceMappingVisible(mapping: KeyMapping, surface: CustomSurfaceSettingsTarget, visible: boolean): void {
		if (surface === 'editor') {
			mapping.showInEditor = visible;
			this.settings.taskEditorWorkflowPickers = this.setSurfaceEntryVisibility(
				this.settings.taskEditorWorkflowPickers,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible }),
			);
			this.settings.taskEditorMobileCoreTools = normalizeTaskEditorMobileCoreTools(
				this.setSurfaceEntryVisibility(
					this.settings.taskEditorMobileCoreTools,
					mapping.canonicalKey,
					visible,
					() => ({ key: mapping.canonicalKey, visible }),
				),
				DEFAULT_SETTINGS.taskEditorMobileCoreTools,
				this.settings.keyMappings,
			);
		} else if (surface === 'creator') {
			mapping.showInCreator = visible;
			this.settings.taskCreatorToolbar = this.setSurfaceEntryVisibility(
				this.settings.taskCreatorToolbar,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible }),
			);
		} else if (surface === 'chips') {
			mapping.showInChips = visible;
			this.settings.inlineTaskCompactChips = this.setSurfaceEntryVisibility(
				this.settings.inlineTaskCompactChips,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible, iconOnly: false }),
			);
			this.settings.taskFinderCompactChips = this.setSurfaceEntryVisibility(
				this.settings.taskFinderCompactChips,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible, iconOnly: false }),
			).map(item => ({ ...item, iconOnly: false }));
			this.settings.filterTaskCompactChips = this.setSurfaceEntryVisibility(
				this.settings.filterTaskCompactChips,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible, iconOnly: false }),
			);
			this.settings.overlayTaskCompactChips = this.setSurfaceEntryVisibility(
				this.settings.overlayTaskCompactChips,
				mapping.canonicalKey,
				visible,
				() => ({ key: mapping.canonicalKey, visible, iconOnly: false }),
			);
		} else {
			mapping.showInKanbanSwimlane = visible;
		}
	}

	private setSurfaceEntryVisibility<T extends { key: string; visible: boolean }>(
		items: T[],
		key: string,
		visible: boolean,
		createItem: () => T,
	): T[] {
		let found = false;
		const next = items.map(item => {
			if (item.key !== key) return item;
			found = true;
			return { ...item, visible };
		});
		if (!found) next.push(createItem());
		return next;
	}

	private getRenderableSurfaceItems<T extends { key: string }>(items: T[], target: SurfaceSettingsListTarget): T[] {
		return items.filter(item => this.isRenderableSurfaceKey(item.key, target));
	}

	private mergeRenderableSurfaceItems<T extends { key: string }>(
		previousItems: T[],
		renderedItems: T[],
		target: SurfaceSettingsListTarget,
	): T[] {
		const renderedQueue = [...renderedItems];
		const next: T[] = [];
		for (const previous of previousItems) {
			if (this.isRenderableSurfaceKey(previous.key, target)) {
				const replacement = renderedQueue.shift();
				if (replacement) next.push(replacement);
			} else {
				next.push(previous);
			}
		}
		next.push(...renderedQueue);
		return next;
	}

	private isRenderableSurfaceKey(key: string, target: SurfaceSettingsListTarget): boolean {
		if (target === 'creator' && TASK_CREATOR_TOOLBAR_FIELD_KEY_SET.has(key)) return true;
		if (target === 'editorWorkflow' && TASK_EDITOR_WORKFLOW_PICKER_KEY_SET.has(key)) return true;
		if (target === 'editorMobile' && TASK_EDITOR_MOBILE_CORE_TOOL_KEY_SET.has(key)) return true;
		if (target === 'chips' && INLINE_TASK_COMPACT_CHIP_KEY_SET.has(key)) return true;
		return getManagedCustomFieldOptionMapping(key, this.settings.keyMappings) !== null;
	}

	private renderTaskEditorWorkflowPickerSettingsSection(containerEl: HTMLElement): void {
		renderInterfaceIconToggleSection<string, TaskEditorWorkflowPickerItem>({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'taskEditorWorkflowPickersDesc'),
			toggleTitle: t('settings', 'taskEditorWorkflowPickers'),
			reorderTitle: t('settings', 'taskEditorWorkflowPickersReorder'),
			moveUpLabel: t('settings', 'taskEditorWorkflowPickersMoveUp'),
			moveDownLabel: t('settings', 'taskEditorWorkflowPickersMoveDown'),
			descriptionSearchTargetId: 'ui.taskEditorWorkflowPickers',
			getItems: () => this.getRenderableSurfaceItems(this.settings.taskEditorWorkflowPickers, 'editorWorkflow'),
			setItems: items => {
				this.settings.taskEditorWorkflowPickers = this.mergeRenderableSurfaceItems(
					this.settings.taskEditorWorkflowPickers,
					items,
					'editorWorkflow',
				);
			},
			getLabel: key => this.getTaskEditorWorkflowPickerLabel(key),
			getIcon: key => this.getTaskEditorWorkflowPickerIcon(key),
			getCanonicalLabel: key => `{{${key}:: }}`,
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			save: () => this.saveSettings(),
			visibilityErrorContext: 'settings task editor workflow picker toggle failed',
			iconOnlyErrorContext: 'settings task editor workflow picker icon-only toggle failed',
			actionErrorContext: 'settings task editor workflow picker action toggle failed',
		});
	}

	private renderTaskEditorMobileCoreToolSettingsSection(containerEl: HTMLElement): void {
		renderInterfaceIconToggleSection<string, TaskEditorMobileCoreToolItem>({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'taskEditorMobileCoreToolsDesc'),
			toggleTitle: t('settings', 'taskEditorMobileCoreTools'),
			reorderTitle: t('settings', 'taskEditorMobileCoreToolsReorder'),
			moveUpLabel: t('settings', 'taskEditorMobileCoreToolsMoveUp'),
			moveDownLabel: t('settings', 'taskEditorMobileCoreToolsMoveDown'),
			descriptionSearchTargetId: 'ui.taskEditorMobileCoreTools',
			getItems: () => this.getRenderableSurfaceItems(this.settings.taskEditorMobileCoreTools, 'editorMobile'),
			setItems: items => {
				this.settings.taskEditorMobileCoreTools = normalizeTaskEditorMobileCoreTools(
					this.mergeRenderableSurfaceItems(this.settings.taskEditorMobileCoreTools, items, 'editorMobile'),
					DEFAULT_SETTINGS.taskEditorMobileCoreTools,
					this.settings.keyMappings,
				);
			},
			getLabel: key => this.getTaskEditorMobileCoreToolLabel(key),
			getIcon: key => this.getTaskEditorMobileCoreToolIcon(key),
			getCanonicalLabel: key => this.getTaskEditorMobileCoreToolCanonicalLabel(key),
			getVisibilityToggleLabel: label => t('settings', 'compactChipVisibilityToggle', { label }),
			canMoveUp: (item, index) => item.key !== 'goToSource' && item.key !== 'remove' && index > 1,
			canMoveDown: (item, index, items) => item.key !== 'goToSource' && item.key !== 'remove' && index < items.length - 2,
			save: () => this.saveSettings(),
			visibilityErrorContext: 'settings task editor mobile core tool toggle failed',
			iconOnlyErrorContext: 'settings task editor mobile core tool icon-only toggle failed',
			actionErrorContext: 'settings task editor mobile core tool action toggle failed',
		});
	}

	private renderTaskCreatorToolbarSettingsSection(containerEl: HTMLElement): void {
		renderInterfaceIconToggleSection<string, TaskCreatorToolbarItem>({
			layout: 'row-list',
			containerEl,
			description: t('settings', 'taskCreatorToolbarSectionDesc'),
			descriptionSearchTargetId: 'ui.taskCreatorToolbar',
			toggleTitle: t('settings', 'taskCreatorToolbarToggleTitle'),
			reorderTitle: t('settings', 'taskCreatorToolbarReorder'),
			moveUpLabel: t('settings', 'taskCreatorToolbarMoveUp'),
			moveDownLabel: t('settings', 'taskCreatorToolbarMoveDown'),
			getItems: () => this.getRenderableSurfaceItems(this.settings.taskCreatorToolbar, 'creator'),
			setItems: items => {
				this.settings.taskCreatorToolbar = this.mergeRenderableSurfaceItems(
					this.settings.taskCreatorToolbar,
					items,
					'creator',
				);
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
			descriptionSearchTargetId: 'ui.inlineTaskChips',
			toggleTitle: t('settings', 'inlineTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'inlineTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'inlineTaskIconsReorder'),
			moveUpLabel: t('settings', 'inlineTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'inlineTaskIconsMoveDown'),
			getItems: () => this.getRenderableSurfaceItems(this.settings.inlineTaskCompactChips, 'chips'),
			setItems: items => {
				this.settings.inlineTaskCompactChips = this.mergeRenderableSurfaceItems(
					this.settings.inlineTaskCompactChips,
					items,
					'chips',
				);
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
			descriptionSearchTargetId: 'ui.taskFinderChips',
			toggleTitle: t('settings', 'taskFinderIconsToggleTitle'),
			reorderTitle: t('settings', 'taskFinderIconsReorder'),
			moveUpLabel: t('settings', 'taskFinderIconsMoveUp'),
			moveDownLabel: t('settings', 'taskFinderIconsMoveDown'),
			getItems: () => this.getRenderableSurfaceItems(this.settings.taskFinderCompactChips, 'chips'),
			setItems: items => {
				this.settings.taskFinderCompactChips = this.mergeRenderableSurfaceItems(
					this.settings.taskFinderCompactChips,
					items,
					'chips',
				).map(entry => ({ ...entry, iconOnly: false }));
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
			descriptionSearchTargetId: 'ui.fileTaskOverlayChips',
			toggleTitle: t('settings', 'overlayTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'overlayTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'overlayTaskIconsReorder'),
			moveUpLabel: t('settings', 'overlayTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'overlayTaskIconsMoveDown'),
			getItems: () => this.getRenderableSurfaceItems(this.settings.overlayTaskCompactChips, 'chips'),
			setItems: items => {
				this.settings.overlayTaskCompactChips = this.mergeRenderableSurfaceItems(
					this.settings.overlayTaskCompactChips,
					items,
					'chips',
				);
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
				{
					visible: this.settings.overlayTaskShowPlainCheckboxAction,
					icon: 'layout-list',
					label: t('settings', 'overlayTaskOpenCheckboxAction'),
					searchTargetId: 'ui.overlayTaskShowPlainCheckboxAction',
					onToggle: async () => {
						this.settings.overlayTaskShowPlainCheckboxAction = !this.settings.overlayTaskShowPlainCheckboxAction;
						await this.saveSettings();
					},
				},
			],
		});
	}

	private getTaskEditorWorkflowPickerLabel(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'tags') return t('taskEditor', 'tags');
		if (key === 'contexts') return t('taskEditor', 'contexts');
		if (key === 'assignees') return t('taskEditor', 'assignees');
		if (key === 'location') return t('location', 'location');
		if (key === 'links') return t('taskEditor', 'links');
		if (key === 'parentTask') return t('taskEditor', 'parentTask');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		return t('taskEditor', 'blockedBy');
	}

	private getTaskEditorWorkflowPickerIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key] || 'circle-dot';
	}

	private getTaskEditorMobileCoreToolLabel(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'goToSource') return t('taskEditor', 'goToSource');
		if (key === 'play') return t('taskEditor', 'trackerStartButton');
		if (key === 'note') return t('taskEditor', 'notes');
		if (key === 'remove') return t('buttons', 'remove');
		if (key === 'dateStarted') return t('taskEditor', 'started');
		if (key === 'dateScheduled') return t('taskEditor', 'scheduled');
		if (key === 'dateDue') return t('taskEditor', 'dueDate');
		if (key === 'dateCompleted') return t('taskEditor', 'finished');
		if (key === 'dateCancelled') return t('taskEditor', 'cancelled');
		if (key === 'datetimeStart') return t('taskEditor', 'datetimeStart');
		if (key === 'datetimeEnd') return t('taskEditor', 'datetimeEnd');
		if (key === 'estimate') return t('taskEditor', 'estimateMinutesShort');
		if (key === 'repeat') return t('taskEditor', 'repeat');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private getTaskEditorMobileCoreToolIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || (TASK_EDITOR_MOBILE_CORE_FALLBACK_ICONS as Record<string, string>)[key] || 'circle-dot';
	}

	private getTaskEditorMobileCoreToolCanonicalLabel(key: string): string {
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping ? `{{${mapping.canonicalKey}:: }}` : key;
	}

	private getTaskCreatorToolbarFieldLabel(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'note') return t('taskEditor', 'notes');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		if (key === 'pinned') return t('settings', 'taskCreatorToolbarPinned');
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private getTaskCreatorToolbarFieldIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key] || 'circle-dot';
	}

	private getInlineTaskCompactChipLabel(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'tags') return t('settings', 'chipTags');
		if (key === 'status') return t('settings', 'chipStatus');
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private getInlineTaskCompactChipIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		const mapping = this.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.icon?.trim() || (INLINE_TASK_COMPACT_FALLBACK_ICONS as Record<string, string>)[key] || 'circle-dot';
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
		const generalSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'trackerMainSettingsSection'));

		this.renderBoundToggleSetting(generalSection, t('settings', 'trackerSplitSessionsAtMidnight'), t('settings', 'trackerSplitSessionsAtMidnightDesc'), 'trackerSplitSessionsAtMidnight');
		this.renderBoundToggleSetting(generalSection, t('settings', 'trackerShowStatusBarTimer'), t('settings', 'trackerShowStatusBarTimerDesc'), 'trackerShowStatusBarTimer');

		const historySection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'trackerSessionHistorySection'));

		this.addNumericSetting(
			historySection,
			t('settings', 'trackerHistoryWindowDays'),
			t('settings', 'trackerHistoryWindowDaysDesc'),
			'trackerHistoryDays',
		);

		this.renderBoundDropdownSetting(historySection, t('settings', 'trackerTaskDescriptionClickAction'), t('settings', 'trackerTaskDescriptionClickActionDesc'), 'trackerTaskDescriptionClickAction', {
			value: this.settings.trackerTaskDescriptionClickAction,
			dropdownOptions: [],
			configure: dropdown => {
				this.addTrackerTaskDescriptionClickActionOptions(dropdown);
			},
			normalize: value => value === 'openTaskEditor' ? 'openTaskEditor' : 'jumpToSource',
		});

		const flowTimeSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'trackerFlowTimeSection'));

		this.renderBoundDropdownSetting(flowTimeSection, t('settings', 'flowTimePauseDuration'), t('settings', 'flowTimePauseDurationDesc'), 'flowTimePauseMinutes', {
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

		this.renderBoundToggleSetting(flowTimeSection, t('settings', 'flowTimeUseLastSelectedDuration'), t('settings', 'flowTimeUseLastSelectedDurationDesc'), 'flowTimeUseLastSelectedDuration', {
			onBeforeSave: value => {
				if (!value) {
					this.settings.flowTimeSessionMinutes = this.settings.flowTimeDefaultSessionMinutes;
				}
			},
			onAfterChange: () => {
				this.redisplayPreservingScroll();
			},
		});

		this.renderBoundDropdownSetting(flowTimeSection, t('settings', 'flowTimeDefaultSessionMinutes'), t('settings', 'flowTimeDefaultSessionMinutesDesc'), 'flowTimeDefaultSessionMinutes', {
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

		this.renderBoundToggleSetting(flowTimeSection, t('settings', 'flowTimeShowNumericTimer'), t('settings', 'flowTimeShowNumericTimerDesc'), 'flowTimeShowNumericTimer');
		this.renderBoundToggleSetting(flowTimeSection, t('settings', 'flowTimeNotifyOnTargetReached'), t('settings', 'flowTimeNotifyOnTargetReachedDesc'), 'flowTimeNotifyOnTargetReached');
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
		const delaySection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'contextMenuDelaySection'));
		this.renderBoundClampedNumericSetting(delaySection, t('settings', 'contextualMenuOpenDelay'), t('settings', 'contextualMenuOpenDelayDesc'), 'contextualMenuOpenDelayMs', {
			min: 0,
			max: 2000,
			fallback: DEFAULT_SETTINGS.contextualMenuOpenDelayMs,
		});

		const mobileSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'contextualMenuMobile'));
		this.renderBoundToggleSetting(mobileSection, t('settings', 'contextualMenuMobileEnabled'), t('settings', 'contextualMenuMobileEnabledDesc'), 'contextualMenuMobileEnabled');
		this.renderBoundClampedNumericSetting(mobileSection, t('settings', 'contextualMenuMobileLongPress'), t('settings', 'contextualMenuMobileLongPressDesc'), 'contextualMenuMobileLongPressMs', {
			min: 200,
			max: 600,
			fallback: DEFAULT_SETTINGS.contextualMenuMobileLongPressMs,
			step: '1',
		});
		this.renderBoundClampedNumericSetting(mobileSection, t('settings', 'contextualMenuMobileTransitionGrace'), t('settings', 'contextualMenuMobileTransitionGraceDesc'), 'contextualMenuMobileTransitionGraceMs', {
			min: 150,
			max: 1200,
			fallback: DEFAULT_SETTINGS.contextualMenuMobileTransitionGraceMs,
			step: '1',
		});
		this.renderBoundClampedNumericSetting(mobileSection, t('settings', 'contextualMenuMobileAutoHide'), t('settings', 'contextualMenuMobileAutoHideDesc'), 'contextualMenuMobileAutoHideMs', {
			min: 1000,
			max: 30000,
			fallback: DEFAULT_SETTINGS.contextualMenuMobileAutoHideMs,
			step: '1000',
		});

		this.renderContextualMenuActionsSettingsSection(containerEl);
		this.renderContextualMenuMatrixSettingsSection(containerEl);
	}

	private renderContextualMenuActionsSettingsSection(containerEl: HTMLElement): void {
		const actionsSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'contextualMenuActions'));
		actionsSection.addClass('operon-settings-add-list-section');
		actionsSection.addClass('operon-settings-card-list-section');
		const actionsDescription = actionsSection.createEl('p', {
			text: t('settings', 'contextualMenuActionsDesc'),
			cls: 'operon-settings-section-desc',
		});
		actionsDescription.dataset.operonSettingsSearchId = 'ui.contextMenuActions';
		const actionListEl = actionsSection.createDiv('operon-contextual-menu-action-list');

		const renderActionList = (): void => {
			actionListEl.empty();
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
				const setting = new Setting(actionListEl)
					.setName(t('settings', action.labelKey))
					.setDesc(t('settings', action.descriptionKey));
				setting.settingEl.addClass('operon-settings-list-card');
				setting.settingEl.addClass('operon-contextual-menu-action-row');
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
						renderActionList();
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
						renderActionList();
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
						renderActionList();
					});
				});
			}
		};
		renderActionList();
	}

	private renderContextualMenuMatrixSettingsSection(containerEl: HTMLElement): void {
		const matrixSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'contextualMenuMatrix'));
		matrixSection.addClass('operon-settings-add-list-section');
		const matrixDescription = matrixSection.createEl('p', {
			text: t('settings', 'contextualMenuMatrixDesc'),
			cls: 'operon-settings-muted-block',
		});
		matrixDescription.dataset.operonSettingsSearchId = 'ui.contextMenuMatrix';
		const matrixHost = matrixSection.createDiv();
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
		const generalSection = renderNativeSettingsGroupedSection(containerEl, t('calendar', 'calendarGeneralSettings'));

		this.renderBoundDropdownSetting(generalSection, t('calendar', 'defaultPreset'), t('calendar', 'defaultPresetDesc'), 'calendarDefaultPresetId', {
			value: this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? '',
			dropdownOptions: [],
			configure: drop => {
				for (const preset of this.settings.calendarPresets) {
					drop.addOption(preset.id, preset.name);
				}
			},
			normalize: value => value ? value : (this.settings.calendarPresets[0]?.id ?? null),
		});

		this.renderBoundDropdownSetting(generalSection, t('calendar', 'weekStart'), t('calendar', 'weekStartDesc'), 'calendarWeekStart', {
			value: this.settings.calendarWeekStart,
			dropdownOptions: [
				{ value: 'monday', label: t('calendar', 'monday') },
				{ value: 'sunday', label: t('calendar', 'sunday') },
			],
			normalize: value => value === 'sunday' ? 'sunday' : 'monday',
		});

		this.renderBoundToggleSetting(generalSection, t('calendar', 'showWeekLabelOnFirstDay'), t('calendar', 'showWeekLabelOnFirstDayDesc'), 'calendarShowWeekLabelOnFirstDay');

		this.renderBoundDropdownSetting(generalSection, t('calendar', 'dayTitleAction'), t('calendar', 'dayTitleActionDesc'), 'calendarDayTitleAction', {
			value: this.settings.calendarDayTitleAction,
			dropdownOptions: [
				{ value: 'create-open-daily-note', label: t('calendar', 'dayTitleActionCreateOpenDailyNote') },
				{ value: 'nothing', label: t('calendar', 'dayTitleActionNothing') },
			],
			normalize: (value): CalendarDayTitleAction => value === 'nothing' ? 'nothing' : 'create-open-daily-note',
		});

		this.renderBoundDropdownSetting(generalSection, t('calendar', 'initialScrollMode'), t('calendar', 'initialScrollModeDesc'), 'calendarInitialScrollMode', {
			value: this.settings.calendarInitialScrollMode,
			dropdownOptions: [
				{ value: 'autoNow', label: t('calendar', 'initialScrollAutoNow') },
				{ value: 'fixedHour', label: t('calendar', 'initialScrollFixedHour') },
			],
			normalize: value => value === 'fixedHour' ? 'fixedHour' : 'autoNow',
			onAfterChange: () => {
				this.redisplayPreservingScroll();
			},
		});

		if (this.settings.calendarInitialScrollMode === 'autoNow') {
			this.renderBoundDropdownSetting(generalSection, t('calendar', 'currentTimePosition'), t('calendar', 'currentTimePositionDesc'), 'calendarAutoScrollPastRatio', {
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
			this.renderBoundClampedNumericSetting(generalSection, t('calendar', 'defaultScrollHour'), t('calendar', 'defaultScrollHourDesc'), 'calendarDefaultScrollHour', {
				min: 0,
				max: 23,
				fallback: DEFAULT_SETTINGS.calendarDefaultScrollHour,
			});
		}

		this.renderBoundDropdownSetting(generalSection, t('calendar', 'timeGridScale'), t('calendar', 'timeGridScaleDesc'), 'calendarTimeGridScale', {
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

		const touchSection = renderNativeSettingsGroupedSection(containerEl, t('calendar', 'touchControls'));
		this.renderBoundToggleSetting(touchSection, t('calendar', 'touchTimeGridTaskMove'), t('calendar', 'touchTimeGridTaskMoveDesc'), 'calendarTouchTimeGridTaskMoveEnabled');
		this.renderBoundClampedNumericSetting(touchSection, t('calendar', 'touchDragLongPress'), t('calendar', 'touchDragLongPressDesc'), 'calendarTouchDragLongPressMs', {
			min: 150,
			max: 600,
			fallback: DEFAULT_SETTINGS.calendarTouchDragLongPressMs,
			step: '1',
		});
		this.renderBoundClampedNumericSetting(touchSection, t('calendar', 'touchDragCancelDistance'), t('calendar', 'touchDragCancelDistanceDesc'), 'calendarTouchDragCancelDistancePx', {
			min: 4,
			max: 24,
			fallback: DEFAULT_SETTINGS.calendarTouchDragCancelDistancePx,
			step: '1',
		});

		const presetsSection = renderNativeSettingsGroupedSection(containerEl, t('calendar', 'viewPresets'));
		presetsSection.addClass('operon-settings-add-list-section');
		presetsSection.addClass('operon-settings-card-list-section');
		const calendarPresetsDescEl = presetsSection.createEl('p', {
			text: t('calendar', 'viewPresetsDesc'),
			cls: 'operon-settings-muted-block',
		});
		calendarPresetsDescEl.dataset.operonSettingsSearchId = 'views.calendarPresets';

		const listEl = presetsSection.createDiv('operon-calendar-preset-list');
		const renderList = (): void => {
			listEl.empty();
			for (let index = 0; index < this.settings.calendarPresets.length; index++) {
				this.renderCalendarPresetRow(listEl, this.settings.calendarPresets[index], index, renderList);
			}
		};
		renderList();

		const addRowEl = presetsSection.createDiv('operon-settings-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('calendar', 'addPresetButton'));
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
				showProjectedOccurrences: true,
				showExternalCalendars: true,
				hiddenTimeStart: '00:00',
				hiddenTimeEnd: '06:00',
				colorSource: 'taskColor',
				appearanceModeLight: 'theme',
				appearanceModeDark: 'theme',
				externalCalendarVisibility: {},
			};
			this.openCalendarPresetSettingsModal(preset, async saved => {
				this.applyCalendarPresetSaveEffects(saved);
				this.settings.calendarPresets.push(saved);
				if (!this.settings.calendarDefaultPresetId) {
					this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
				}
				await this.saveSettings();
				renderList();
			});
		}));

		const sidebarBody = renderNativeSettingsGroupedSection(containerEl, t('calendar', 'calendarSidebarSettings'));
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
			onAfterChange: () => this.redisplayPreservingScroll(),
		});
		this.renderBoundDropdownSetting(sidebarBody, t('settings', 'calendarSidebarTaskPoolDefaultState'), t('settings', 'calendarSidebarTaskPoolDefaultStateDesc'), 'calendarSidebarTaskPoolDefaultExpanded', {
			value: this.settings.calendarSidebarTaskPoolDefaultExpanded ? 'expanded' : 'collapsed',
			dropdownOptions: [
				{ value: 'expanded', label: t('settings', 'expanded') },
				{ value: 'collapsed', label: t('settings', 'collapsed') },
			],
			normalize: value => value !== 'collapsed',
			onBeforeSave: () => this.normalizeCalendarSidebarDefaultState('calendarSidebarTaskPoolDefaultExpanded'),
			onAfterChange: () => this.redisplayPreservingScroll(),
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
		}, changedKey);
		this.settings.calendarSidebarCalendarsDefaultExpanded = normalized.calendarSidebarCalendarsDefaultExpanded;
		this.settings.calendarSidebarTaskPoolDefaultExpanded = normalized.calendarSidebarTaskPoolDefaultExpanded;
		this.settings.calendarSidebarFinishedTasksDefaultExpanded = false;
	}

	private renderExternalCalendarsSection(containerEl: HTMLElement): void {
		const externalSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'externalCalendarsTitle'));
		externalSection.addClass('operon-settings-add-list-section');
		externalSection.addClass('operon-settings-card-list-section');
		const description = externalSection.createEl('p', {
			text: t('settings', 'externalCalendarsDesc'),
			cls: 'operon-settings-muted-block',
		});
		description.dataset.operonSettingsSearchId = 'integrations.externalCalendars';

		const listEl = externalSection.createDiv('operon-external-calendar-list');
		const renderList = (): void => {
			listEl.empty();
			if (this.settings.externalCalendars.length === 0) {
				listEl.createEl('p', {
					text: t('settings', 'externalCalendarsEmpty'),
					cls: 'operon-settings-muted-block',
				});
			} else {
				for (let index = 0; index < this.settings.externalCalendars.length; index++) {
					this.renderExternalCalendarSourceRow(listEl, this.settings.externalCalendars[index], index, renderList);
				}
			}
		};
		renderList();

		const addRowEl = externalSection.createDiv('operon-settings-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('settings', 'externalCalendarsAddButton'));
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
			renderList();
			this.openExternalCalendarSourceEditModal(newSource, true, renderList);
		}));
	}

	private renderExternalCalendarSourceRow(
		listEl: HTMLElement,
		source: ExternalCalendarSource,
		index: number,
		refresh: () => void,
	): void {
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
				if (await this.moveExternalCalendarSource(index, -1)) refresh();
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
				if (await this.moveExternalCalendarSource(index, 1)) refresh();
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
				this.openExternalCalendarSourceEditModal(source, false, refresh);
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
				refresh();
			},
		});
	}

	private openExternalCalendarSourceEditModal(
		source: ExternalCalendarSource,
		isNew: boolean,
		refresh: () => void,
	): void {
		const clone: ExternalCalendarSource = { ...source };
		new ExternalCalendarSourceEditModal({
			app: this.app,
			source: clone,
			isNew,
			onSave: settingsAsyncHandler('settings external calendar edit failed', async (saved: ExternalCalendarSource) => {
				saved.enabled = true;
				const idx = this.settings.externalCalendars.findIndex(s => s.id === saved.id);
				if (idx >= 0) this.settings.externalCalendars[idx] = saved;
				await this.saveSettings();
				refresh();
			}),
			onCancel: settingsAsyncHandler('settings external calendar add cancel failed', async () => {
				this.settings.externalCalendars = this.settings.externalCalendars.filter(s => s.id !== source.id);
				await this.saveSettings();
				refresh();
			}),
			onSyncNow: async () => {
				await this.syncExternalCalendarSourceNow(source.id);
				refresh();
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
		const refreshKanbanTab = (): void => {
			const scrollHost = this.resolveSettingsScrollHost();
			const scrollTop = scrollHost?.scrollTop ?? 0;
			const scrollLeft = scrollHost?.scrollLeft ?? 0;
			containerEl.empty();
			this.renderKanbanTab(containerEl);
			if (!scrollHost) return;

			const restore = (): void => {
				const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
				const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth);
				scrollHost.scrollTop = Math.min(scrollTop, maxScrollTop);
				scrollHost.scrollLeft = Math.min(scrollLeft, maxScrollLeft);
			};
			restore();
			scrollHost.ownerDocument.defaultView?.requestAnimationFrame(restore);
		};

		renderSettingsInfoBox(containerEl, t('settings', 'kanbanTitle'), t('settings', 'kanbanSettingsDesc'));

		const generalSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'kanbanGeneralSettings'));
		this.renderBoundDropdownSetting(generalSection, t('settings', 'kanbanDefaultPreset'), t('settings', 'kanbanDefaultPresetDesc'), 'kanbanDefaultPresetId', {
			value: this.settings.kanbanDefaultPresetId ?? this.settings.kanbanPresets[0]?.id ?? '',
			dropdownOptions: [],
			configure: drop => {
				for (const preset of this.settings.kanbanPresets) {
					drop.addOption(preset.id, preset.name);
				}
			},
			normalize: value => value ? value : (this.settings.kanbanPresets[0]?.id ?? null),
		});

		this.renderBoundClampedNumericSetting(generalSection, t('settings', 'kanbanExpandedColumnWidth'), t('settings', 'kanbanExpandedColumnWidthDesc'), 'kanbanExpandedColumnWidthPx', {
			min: KANBAN_EXPANDED_COLUMN_WIDTH_MIN,
			max: KANBAN_EXPANDED_COLUMN_WIDTH_MAX,
			fallback: DEFAULT_SETTINGS.kanbanExpandedColumnWidthPx,
			step: '1',
		});

		this.renderBoundClampedNumericSetting(generalSection, t('settings', 'kanbanSwimlaneMaxHeight'), t('settings', 'kanbanSwimlaneMaxHeightDesc'), 'kanbanMaxVisibleTasksPerCell', {
			min: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN,
			max: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX,
			fallback: DEFAULT_SETTINGS.kanbanMaxVisibleTasksPerCell,
			step: '1',
		});

		const presetsSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'kanbanPresets'));
		presetsSection.addClass('operon-settings-add-list-section');
		presetsSection.addClass('operon-settings-card-list-section');
		const kanbanPresetsDescEl = presetsSection.createEl('p', {
			text: t('settings', 'kanbanPresetsDesc'),
			cls: 'operon-settings-muted-block',
		});
		kanbanPresetsDescEl.dataset.operonSettingsSearchId = 'views.kanbanPresets';
		const listEl = presetsSection.createDiv('operon-kanban-preset-list');
		const renderList = (): void => {
			listEl.empty();
			for (let index = 0; index < this.settings.kanbanPresets.length; index++) {
				this.renderKanbanPresetRow(listEl, this.settings.kanbanPresets[index], index, renderList, refreshKanbanTab);
			}
		};
		renderList();

		const addRowEl = presetsSection.createDiv('operon-settings-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('settings', 'kanbanAddPresetButton'));
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
				autoCollapseFinishedColumns: false,
				sortMode: 'automatic',
				sortRules: createDefaultKanbanSortRules(),
			};
			this.openKanbanPresetSettingsModal(preset, async saved => {
				this.settings.kanbanPresets.push(saved);
				if (!this.settings.kanbanDefaultPresetId) {
					this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
				}
				await this.saveSettings();
				await this.handleKanbanSortModeChange(saved.id, saved.sortMode);
				renderList();
			});
		}));
	}

	private renderKanbanPresetRow(
		listEl: HTMLElement,
		preset: KanbanPreset,
		index: number,
		refresh: () => void,
		refreshTab: () => void,
	): void {
		const total = this.settings.kanbanPresets.length;
		const isOnlyPreset = total === 1;
		const presetName = preset.name.trim() || t('settings', 'kanbanFallbackPresetName', { number: String(index + 1) });
		const pipelineName = this.settings.pipelines.find(p => p.id === preset.pipelineId)?.name ?? t('settings', 'kanbanNoPipeline');
		const filterName = getNormalFilterSets(this.settings.filterSets).find(entry => entry.id === preset.filterSetId)?.name ?? t('calendar', 'noFilter');
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
				if (await this.moveKanbanPreset(index, -1)) refresh();
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
				if (await this.moveKanbanPreset(index, 1)) refresh();
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('tooltips', 'editKanbanPreset', { name: presetName }),
			ariaLabel: t('tooltips', 'editKanbanPreset', { name: presetName }),
			text: 'Edit',
			wide: true,
			onClick: () => {
				this.openKanbanPresetSettingsModal(preset, async saved => {
					this.replaceKanbanPreset(saved);
					await this.saveSettings();
					await this.handleKanbanSortModeChange(saved.id, saved.sortMode);
					refresh();
				});
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
				refreshTab();
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
				refreshTab();
			},
		});
	}

	private openKanbanPresetSettingsModal(preset: KanbanPreset | null, onSave: (preset: KanbanPreset) => Promise<void>): void {
		new KanbanPresetQuickSettingsModal(this.app, {
			getSettings: () => this.settings,
			preset,
			onSave,
			onSaveFilterSet: async (filterSet) => {
				await this.upsertFilterSet(filterSet);
				await this.saveSettings();
			},
			getFilterModalEvalDeps: () => this.makeEvalDeps(),
		}).open();
	}

	private replaceKanbanPreset(updated: KanbanPreset): void {
		const index = this.settings.kanbanPresets.findIndex(entry => entry.id === updated.id);
		if (index === -1) return;
		this.settings.kanbanPresets[index] = updated;
		if (!this.settings.kanbanPresets.some(entry => entry.id === this.settings.kanbanDefaultPresetId)) {
			this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
		}
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
							if (await this.moveKanbanPreset(index, -1)) this.redisplayPreservingScroll();
						}),
					},
				{
					type: 'icon',
					icon: 'arrow-down',
					label: t('calendar', 'movePresetDown'),
						disabled: index === this.settings.kanbanPresets.length - 1,
						onClick: settingsAsyncHandler('settings kanban preset move down failed', async () => {
							if (index >= this.settings.kanbanPresets.length - 1) return;
							if (await this.moveKanbanPreset(index, 1)) this.redisplayPreservingScroll();
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
						this.redisplayPreservingScroll();
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

		const currentFilter = getNormalFilterSets(this.settings.filterSets).find(entry => entry.id === preset.filterSetId) ?? null;
		new Setting(bodyInner)
			.setName(t('settings', 'kanbanFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.onClick(() => {
					new CalendarFilterPickerModal(this.app, {
						filterSets: getNormalFilterSets(this.settings.filterSets),
						onChooseFilter: settingsAsyncHandler('settings kanban preset filter selection failed', async (filterSetId) => {
							await this.updateKanbanPreset(preset.id, current => {
								current.filterSetId = filterSetId;
							});
							this.redisplayPreservingScroll();
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
					this.redisplayPreservingScroll();
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
			for (const option of this.getKanbanSortFieldOptions()) {
				fieldSelect.add(new Option(option.label, option.value));
			}
			fieldSelect.value = rule.field;
			fieldSelect.addEventListener('change', settingsAsyncHandler('settings kanban sort field change failed', async () => {
				await this.updateKanbanPreset(preset.id, current => {
					current.sortRules[index].field = fieldSelect.value;
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
				this.redisplayPreservingScroll();
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
				this.redisplayPreservingScroll();
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
				this.redisplayPreservingScroll();
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
				this.redisplayPreservingScroll();
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
				this.redisplayPreservingScroll();
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
			this.redisplayPreservingScroll();
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
			this.redisplayPreservingScroll();
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
		const filterName = getNormalFilterSets(this.settings.filterSets).find(entry => entry.id === preset.filterSetId)?.name ?? t('calendar', 'noFilter');
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
			icon: this.getCalendarPresetSurfaceIcon(preset),
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
				if (await this.moveCalendarPreset(index, -1)) refresh();
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
				if (await this.moveCalendarPreset(index, 1)) refresh();
			},
		});

		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('calendar', 'editPreset', { name: presetName }),
			ariaLabel: t('calendar', 'editPreset', { name: presetName }),
			text: 'Edit',
			wide: true,
			onClick: () => {
				this.openCalendarPresetSettingsModal(preset, async saved => {
					this.applyCalendarPresetSaveEffects(saved);
					this.replaceCalendarPreset(saved);
					await this.saveSettings();
					refresh();
				});
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
				this.redisplayPreservingScroll();
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
				this.redisplayPreservingScroll();
			},
		});
	}

	private openCalendarPresetSettingsModal(preset: CalendarPreset | null, onSave: (preset: CalendarPreset) => Promise<void>): void {
		new CalendarPresetQuickSettingsModal(this.app, {
			getSettings: () => this.settings,
			preset,
			onSave,
			onSaveFilterSet: async (filterSet) => {
				await this.upsertFilterSet(filterSet);
				await this.saveSettings();
			},
			getFilterModalEvalDeps: () => this.makeEvalDeps(),
		}).open();
	}

	private replaceCalendarPreset(updated: CalendarPreset): void {
		const index = this.settings.calendarPresets.findIndex(entry => entry.id === updated.id);
		if (index === -1) return;
		this.settings.calendarPresets[index] = updated;
		if (!this.settings.calendarPresets.some(entry => entry.id === this.settings.calendarDefaultPresetId)) {
			this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
		}
	}

	private applyCalendarPresetSaveEffects(preset: CalendarPreset): void {
		for (const source of this.settings.externalCalendars) {
			if (preset.externalCalendarVisibility[source.id] === true) {
				source.enabled = true;
			}
		}
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
							if (await this.moveCalendarPreset(index, -1)) this.redisplayPreservingScroll();
						}),
					},
				{
					type: 'icon',
					icon: 'arrow-down',
					label: t('calendar', 'movePresetDown'),
						disabled: index === this.settings.calendarPresets.length - 1,
						onClick: settingsAsyncHandler('settings calendar preset move down failed', async () => {
							if (index >= this.settings.calendarPresets.length - 1) return;
							if (await this.moveCalendarPreset(index, 1)) this.redisplayPreservingScroll();
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
						this.redisplayPreservingScroll();
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
				dropdown.addOption('timeTrackerGrid', t('calendar', 'timeTrackerGrid'));
				dropdown.addOption('multiWeek', t('calendar', 'multiWeek'));
				dropdown.setValue(preset.surfaceType);
				dropdown.onChange(async value => {
					if (value !== 'timeGrid' && value !== 'timeTrackerGrid' && value !== 'multiWeek') return;
					await this.updateCalendarPreset(preset.id, current => {
						current.surfaceType = value;
						current.weekCount = this.normalizeCalendarPresetWeekCount(current.weekCount);
					});
					this.redisplayPreservingScroll();
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
						this.redisplayPreservingScroll();
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
						this.redisplayPreservingScroll();
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
						this.redisplayPreservingScroll();
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

		const currentFilter = getNormalFilterSets(this.settings.filterSets).find(entry => entry.id === preset.filterSetId) ?? null;
		new Setting(bodyInner)
			.setName(t('calendar', 'calendarFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.onClick(() => {
					new CalendarFilterPickerModal(this.app, {
						filterSets: getNormalFilterSets(this.settings.filterSets),
						onChooseFilter: settingsAsyncHandler('settings calendar preset filter selection failed', async (filterSetId) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.filterSetId = filterSetId;
							});
							this.redisplayPreservingScroll();
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
					this.redisplayPreservingScroll();
				}));
			});

		if (preset.surfaceType === 'timeGrid' || preset.surfaceType === 'timeTrackerGrid') {
			this.renderHiddenTimeSetting(bodyInner, preset);
		}

		new Setting(bodyInner)
			.setName(t('calendar', 'taskColorSource'))
			.setDesc(t('calendar', 'taskColorSourceDesc'))
			.addButton(button => {
				const currentSource = normalizeTaskColorSource(preset.colorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
				renderTaskColorSourceSelectButton(button.buttonEl, currentSource);
				button.onClick(event => {
					event.preventDefault();
					showTaskColorSourceSelectMenu(button.buttonEl, {
						sources: CALENDAR_TASK_COLOR_SOURCES,
						currentSource,
						onSelect: settingsAsyncHandler('settings calendar preset task color source selection failed', async (source) => {
							await this.updateCalendarPreset(preset.id, current => {
								current.colorSource = source;
							});
							this.redisplayPreservingScroll();
						}),
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

		new Setting(bodyInner)
			.setName(t('calendar', 'showFutureOccurrences'))
			.setDesc(t('calendar', 'showFutureOccurrencesDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showProjectedOccurrences);
				toggle.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.showProjectedOccurrences = value;
					});
				});
			});

		new Setting(bodyInner)
			.setName(t('calendar', 'showExternalCalendars'))
			.setDesc(t('calendar', 'showExternalCalendarsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showExternalCalendars);
				toggle.onChange(async (value) => {
					await this.updateCalendarPreset(preset.id, current => {
						current.showExternalCalendars = value;
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
							if (value) {
								const matchingSource = this.settings.externalCalendars.find(entry => entry.id === source.id);
								if (matchingSource) matchingSource.enabled = true;
							}
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
		if (preset.surfaceType === 'timeTrackerGrid') {
			return t('calendar', 'presetSummaryTimeTrackerGrid', {
				count: String(preset.dayCount),
				minutes: String(preset.slotMinutes),
			});
		}
		return t('calendar', 'presetSummaryTimeGrid', {
			count: String(preset.dayCount),
			minutes: String(preset.slotMinutes),
		});
	}

	private getCalendarPresetSurfaceIcon(preset: CalendarPreset): string {
		if (preset.surfaceType === 'multiWeek') return 'calendar-range';
		if (preset.surfaceType === 'timeTrackerGrid') return 'columns-3';
		return 'calendar-days';
	}

	private async updateCalendarPreset(
		presetId: string,
		update: (preset: CalendarPreset) => void,
	): Promise<void> {
		const preset = this.settings.calendarPresets.find(entry => entry.id === presetId);
		if (!preset) return;
		const optionSignature = this.getCalendarPresetDropdownOptionSignature();
		update(preset);
		preset.surfaceType = preset.surfaceType === 'multiWeek' || preset.surfaceType === 'timeTrackerGrid'
			? preset.surfaceType
			: 'timeGrid';
		preset.weekCount = this.normalizeCalendarPresetWeekCount(preset.weekCount);
		preset.focusedWeekNumber = this.normalizeCalendarPresetFocusedWeekNumber(preset.focusedWeekNumber, preset.weekCount);
		preset.todayPosition = Math.max(1, Math.min(preset.dayCount, preset.todayPosition));
		await this.saveSettings();
		if (optionSignature !== this.getCalendarPresetDropdownOptionSignature()) {
			this.updateNativeSettingsDefinitions();
		}
	}

	private getCalendarPresetDropdownOptionSignature(): string {
		return this.settings.calendarPresets.map(preset => `${preset.id}:${preset.name}`).join('|');
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
		for (const option of getKanbanSwimlaneCustomFieldOptions(this.settings.keyMappings)) {
			dropdown.addOption(option.field, option.label);
		}
	}

	private getKanbanSwimlaneLabel(value: KanbanSwimlaneBy | null): string {
		if (!value) return t('settings', 'kanbanNoSwimlane');
		const customMapping = getManagedCustomFieldOptionMapping(value, this.settings.keyMappings);
		if (customMapping) return customMapping.visiblePropertyName?.trim() || customMapping.canonicalKey;
		const key = `kanbanSwimlane_${value}`;
		const localized = t('settings', key);
		return localized === key ? value : localized;
	}

	private getKanbanSortFieldOptions(): Array<{ value: KanbanSortRule['field']; label: string }> {
		return [
			...KANBAN_SORT_FIELD_OPTIONS.map(option => ({
				value: option.value,
				label: this.getKanbanSortFieldLabel(option),
			})),
			...getManagedCustomFieldOptions(this.settings.keyMappings).map(option => ({
				value: option.field,
				label: option.label,
			})),
		];
	}

	private getKanbanSortFieldLabel(option: typeof KANBAN_SORT_FIELD_OPTIONS[number]): string {
		const key = `kanbanSortField_${option.value}`;
		const localized = t('settings', key);
		return localized === key ? option.label : localized;
	}

	private parseKanbanSwimlaneBy(value: string): KanbanSwimlaneBy | null {
		if (isBuiltInKanbanSwimlaneBy(value)) return value;
		return normalizeKanbanCustomFieldReference(value);
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
							this.redisplayPreservingScroll();
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
							this.redisplayPreservingScroll();
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
			app: this.app,
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
		renderSettingsInfoBox(containerEl, t('settings', 'pipelinesTitle'), t('settings', 'pipelinesDesc'), 'taxonomy.pipelines');

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
		renderSettingsInfoBox(containerEl, t('settings', 'priorityTitle'), t('settings', 'priorityDesc'), 'taxonomy.priorities');

		// Priority rows
		const cardEl = containerEl.createDiv('operon-priority-card');
		const listEl = cardEl.createDiv();
		createWorkflowGridHeader({
			containerEl: listEl,
			className: 'operon-priority-column-header',
			labels: [
				t('settings', 'pipelineColumnColor'),
				t('settings', 'priorityColumnIcon'),
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
			containerEl: cardEl,
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
		const priorityId = priority.id;
		const getCurrentPriority = (): PriorityDefinition | null => this.findSettingsPriority(priorityId, priority.label);
		const row = listEl.createDiv('operon-priority-row');

		createWorkflowColorSwatch({
			containerEl: row,
			value: priority.color,
			label: t('settings', 'priorityColorAria', { name: priority.label }),
			errorContext: 'settings priority color change failed',
			onChange: async (value) => {
				const currentPriority = getCurrentPriority();
				if (!currentPriority) return;
				currentPriority.color = value;
				await this.saveSettings();
			},
		});

		this.renderPriorityIconPicker(row, priority);

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

	private renderPriorityIconPicker(
		containerEl: HTMLElement,
		priority: PriorityDefinition,
	): void {
		const priorityId = priority.id;
		const iconButton = containerEl.createEl('button', {
			cls: 'operon-priority-icon-trigger',
			attr: {
				type: 'button',
			},
		});
		bindOperonHoverTooltip(iconButton, {
			content: t('settings', 'priorityIconTooltip'),
			taskColor: priority.color || null,
		});

		const getCurrentPriority = (): PriorityDefinition | null => this.findSettingsPriority(priorityId, priority.label);
		const getStoredIcon = (): string => normalizeTaskIconValue(getCurrentPriority()?.priorityIcon);
		const refreshIconPreview = (iconName = getStoredIcon()): void => {
			const normalizedIcon = normalizeTaskIconValue(iconName);
			const selectedIcon = normalizedIcon ? getIcon(normalizedIcon) : null;
			const iconEl = selectedIcon ?? getIcon('plus');

			iconButton.empty();
			iconButton.toggleClass('has-icon', !!selectedIcon);
			iconButton.toggleClass('is-placeholder', !selectedIcon);
			setAccessibleLabelWithoutTooltip(
				iconButton,
				t('settings', 'priorityIconAria', { name: priority.label }),
			);
			if (!iconEl) return;
			iconEl.addClass('operon-priority-icon-preview');
			iconButton.appendChild(iconEl);
		};

		const commitIconValue = async (nextValue: string): Promise<void> => {
			const normalizedIcon = normalizeTaskIconValue(nextValue);
			const currentPriority = getCurrentPriority();
			if (!currentPriority) return;
			if (normalizedIcon) {
				currentPriority.priorityIcon = normalizedIcon;
			} else {
				delete currentPriority.priorityIcon;
			}
			refreshIconPreview(normalizedIcon);
			await this.saveSettings();
		};

		const openPicker = (): void => {
			openSettingsIconPickerModal(this.app, {
				title: t('settings', 'priorityIconAria', { name: priority.label }),
				value: getStoredIcon(),
				query: '',
				onSelect: iconId => {
					runSettingsAsync('settings priority icon change failed', () => commitIconValue(iconId));
				},
				onClear: () => {
					runSettingsAsync('settings priority icon clear failed', () => commitIconValue(''));
				},
			});
		};

		refreshIconPreview();
		iconButton.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
		iconButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
	}

	private findSettingsPriority(priorityId: string, fallbackLabel: string): PriorityDefinition | null {
		return this.settings.priorities.find(candidate => candidate.id === priorityId)
			?? this.settings.priorities.find(candidate => candidate.label === fallbackLabel)
			?? null;
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
		const pipelineId = pipeline.id;
		const getCurrentPipeline = (): Pipeline | null => this.findSettingsPipeline(pipelineId, pipeline.name, pipelineIndex);
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
			const currentPipeline = getCurrentPipeline();
			if (!currentPipeline) return;
			this.settings.defaultPipelineName = currentPipeline.name;
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
				const currentPipeline = getCurrentPipeline();
				if (!currentPipeline) return;
				const currentPipelineIndex = this.settings.pipelines.findIndex(candidate => candidate.id === currentPipeline.id);
				if (currentPipelineIndex < 0) return;
				const confirmed = await this.confirmDeletePipeline(currentPipeline.name);
				if (!confirmed) return;
				const deletedWasDefault = this.settings.defaultPipelineName === currentPipeline.name;
				this.settings.pipelines.splice(currentPipelineIndex, 1);
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
				t('settings', 'pipelineColumnIcon'),
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
				const currentPipeline = getCurrentPipeline();
				if (!currentPipeline) return;
				const label = createUniqueTaxonomyLabel(
					t('settings', 'newStatusLabel'),
					currentPipeline.statuses.map(status => status.label),
				);
				currentPipeline.statuses.push({
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
		const pipelineId = pipeline.id;
		const statusId = status.id;
		const getCurrentStatus = (): { pipeline: Pipeline; status: StatusDefinition; statusIndex: number } | null => {
			return this.findSettingsPipelineStatus(pipelineId, pipeline.name, statusId, status.label, pipelineIndex);
		};
		const row = containerEl.createDiv('operon-status-row');

		createWorkflowColorSwatch({
			containerEl: row,
			value: status.color,
			label: t('settings', 'statusColorAria', { pipeline: pipeline.name, status: status.label }),
			errorContext: 'settings pipeline status color change failed',
			onChange: async (value) => {
				const current = getCurrentStatus();
				if (!current) return;
				current.status.color = value;
				await this.saveSettings();
			},
		});

		this.renderPipelineStatusIconPicker(row, pipeline, status);

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
			const currentPipeline = this.findSettingsPipeline(pipelineId, pipeline.name, pipelineIndex) ?? pipeline;
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
		const clearAutomationTargets = (targetStatus: StatusDefinition) => {
			targetStatus.isScheduledTarget = false;
			targetStatus.isTrackingTarget = false;
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
			const current = getCurrentStatus();
			if (!current) return;
			const nextValue = scheduledToggle?.checked === true;
			for (const candidate of current.pipeline.statuses) {
				candidate.isScheduledTarget = false;
			}
			current.status.isScheduledTarget = nextValue;
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
			const current = getCurrentStatus();
			if (!current) return;
			const nextValue = trackingToggle?.checked === true;
			for (const candidate of current.pipeline.statuses) {
				candidate.isTrackingTarget = false;
			}
			current.status.isTrackingTarget = nextValue;
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
			const current = getCurrentStatus();
			if (!current) return;
			const nextValue = finishedToggle.checked;
			for (const candidate of current.pipeline.statuses) {
				candidate.isFinished = false;
			}
			current.status.isFinished = nextValue;
			if (nextValue) {
				current.status.isCancelled = false;
				cancelledToggle.checked = false;
				clearAutomationTargets(current.status);
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
			const current = getCurrentStatus();
			if (!current) return;
			const nextValue = cancelledToggle.checked;
			for (const candidate of current.pipeline.statuses) {
				candidate.isCancelled = false;
			}
			current.status.isCancelled = nextValue;
			if (nextValue) {
				current.status.isFinished = false;
				finishedToggle.checked = false;
				clearAutomationTargets(current.status);
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
				const current = getCurrentStatus();
				if (!current || current.statusIndex <= 0) return;
				const statuses = current.pipeline.statuses;
				const tmp = statuses[current.statusIndex - 1];
				statuses[current.statusIndex - 1] = statuses[current.statusIndex];
				statuses[current.statusIndex] = tmp;
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
				const current = getCurrentStatus();
				if (!current || current.statusIndex >= current.pipeline.statuses.length - 1) return;
				const statuses = current.pipeline.statuses;
				const tmp = statuses[current.statusIndex + 1];
				statuses[current.statusIndex + 1] = statuses[current.statusIndex];
				statuses[current.statusIndex] = tmp;
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
				const current = getCurrentStatus();
				if (!current) return;
				if (current.pipeline.statuses.length <= 1) {
					new Notice(t('settings', 'pipelineAtLeastOneStatus'));
					return;
				}
				const confirmed = await this.confirmDeleteStatus(current.status.label, current.pipeline.name);
				if (!confirmed) return;
				current.pipeline.statuses.splice(current.statusIndex, 1);
				await this.saveSettings();
				refresh();
			},
		});
	}

	private renderPipelineStatusIconPicker(
		containerEl: HTMLElement,
		pipeline: Pipeline,
		status: StatusDefinition,
	): void {
		const pipelineId = pipeline.id;
		const statusId = status.id;
		const iconButton = containerEl.createEl('button', {
			cls: 'operon-status-icon-trigger',
			attr: {
				type: 'button',
			},
		});
		bindOperonHoverTooltip(iconButton, {
			content: t('settings', 'statusIconTooltip'),
			taskColor: status.color || null,
		});

		const getCurrentStatus = (): StatusDefinition | null => this.findSettingsPipelineStatus(
			pipelineId,
			pipeline.name,
			statusId,
			status.label,
		)?.status ?? null;
		const getStoredIcon = (): string => normalizeTaskIconValue(getCurrentStatus()?.pipelineStatusIcon);
		const refreshIconPreview = (iconName = getStoredIcon()): void => {
			const normalizedIcon = normalizeTaskIconValue(iconName);
			const selectedIcon = normalizedIcon ? getIcon(normalizedIcon) : null;
			const iconEl = selectedIcon ?? getIcon('plus');

			iconButton.empty();
			iconButton.toggleClass('has-icon', !!selectedIcon);
			iconButton.toggleClass('is-placeholder', !selectedIcon);
			setAccessibleLabelWithoutTooltip(
				iconButton,
				t('settings', 'statusIconAria', { pipeline: pipeline.name, status: status.label }),
			);
			if (!iconEl) return;
			iconEl.addClass('operon-status-icon-preview');
			iconButton.appendChild(iconEl);
		};
		const commitIconValue = async (nextValue: string): Promise<void> => {
			const normalizedIcon = normalizeTaskIconValue(nextValue);
			const currentStatus = getCurrentStatus();
			if (!currentStatus) return;
			if (normalizedIcon) {
				currentStatus.pipelineStatusIcon = normalizedIcon;
			} else {
				delete currentStatus.pipelineStatusIcon;
			}
			refreshIconPreview(normalizedIcon);
			await this.saveSettings();
		};

		const openPicker = (): void => {
			openSettingsIconPickerModal(this.app, {
				title: t('settings', 'statusIconAria', { pipeline: pipeline.name, status: status.label }),
				value: getStoredIcon(),
				query: '',
				onSelect: iconId => {
					runSettingsAsync('settings pipeline status icon change failed', () => commitIconValue(iconId));
				},
				onClear: () => {
					runSettingsAsync('settings pipeline status icon clear failed', () => commitIconValue(''));
				},
			});
		};

		refreshIconPreview();
		iconButton.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
		iconButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
	}

	private findSettingsPipeline(
		pipelineId: string,
		fallbackName: string,
		fallbackIndex?: number,
	): Pipeline | null {
		return this.settings.pipelines.find(candidate => candidate.id === pipelineId)
			?? this.settings.pipelines.find(candidate => candidate.name === fallbackName)
			?? (typeof fallbackIndex === 'number' ? this.settings.pipelines[fallbackIndex] ?? null : null);
	}

	private findSettingsPipelineStatus(
		pipelineId: string,
		fallbackPipelineName: string,
		statusId: string,
		fallbackStatusLabel: string,
		fallbackPipelineIndex?: number,
	): { pipeline: Pipeline; status: StatusDefinition; statusIndex: number } | null {
		const pipeline = this.findSettingsPipeline(pipelineId, fallbackPipelineName, fallbackPipelineIndex);
		if (!pipeline) return null;
		let statusIndex = pipeline.statuses.findIndex(candidate => candidate.id === statusId);
		if (statusIndex < 0) {
			statusIndex = pipeline.statuses.findIndex(candidate => candidate.label === fallbackStatusLabel);
		}
		if (statusIndex < 0) return null;
		return {
			pipeline,
			status: pipeline.statuses[statusIndex],
			statusIndex,
		};
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
	 * Shows system canonical keys with editable visible property names.
	 */
	private renderKeyMappingsSection(containerEl: HTMLElement): void {
		const refreshSection = () => {
			containerEl.empty();
			this.renderKeyMappingsSection(containerEl);
		};
		const keyMappingSection = renderNativeSettingsGroupedSection(containerEl, t('settings', 'keyMappings'));
		keyMappingSection.addClass('operon-key-mapping-section');
		keyMappingSection.dataset.operonSettingsSearchId = 'taxonomy.keyMappings';

		const explanationBox = keyMappingSection.createDiv('operon-key-mapping-explanation-box');
		explanationBox.dataset.operonSettingsSearchId = 'taxonomy.keyMappings';

		explanationBox.createEl('p', {
			text: t('settings', 'keyMappingsIntro'),
			cls: 'operon-key-mapping-explanation-text',
		});

		const legendEl = explanationBox.createDiv('operon-key-mapping-legend');

		const legendItems = [
			{ label: t('settings', 'keyMappingsLegendPropertyLabel'), desc: t('settings', 'keyMappingsLegendPropertyDesc') },
			{ label: t('settings', 'keyMappingsLegendValueSharingLabel'), desc: t('settings', 'keyMappingsLegendValueSharingDesc') },
			{ label: t('settings', 'keyMappingsLegendHideLabel'), desc: t('settings', 'keyMappingsLegendHideDesc') },
			{ label: t('settings', 'keyMappingsLegendTypeLabel'), desc: t('settings', 'keyMappingsLegendTypeDesc') },
		];
		for (const item of legendItems) {
			const span = legendEl.createSpan('operon-key-mapping-legend-item');
			span.createEl('strong', { text: item.label });
			span.appendText(` – ${item.desc}`);
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

		const systemSection = keyMappingSection.createDiv('operon-key-mapping-list');
		for (const mapping of systemMappings) {
			this.renderKeyMappingRow(systemSection, mapping, { refresh: refreshSection });
		}
	}

	private renderCustomKeysSection(containerEl: HTMLElement): void {
		const refreshSection = () => {
			containerEl.empty();
			this.renderCustomKeysSection(containerEl);
		};
		const customMappings = getManagedCustomFieldMappings(this.settings.keyMappings, { includeCheckbox: true });
		const customKeysSection = renderNativeSettingsGroupedSection(
			containerEl,
			t('settings', 'keyMappingsCustomHeader', { count: String(customMappings.length) }),
			t('settings', 'customKeysDesc'),
		);
		customKeysSection.addClass('operon-key-mapping-section');
		customKeysSection.addClass('operon-custom-keys-section');
		customKeysSection.dataset.operonSettingsSearchId = 'taxonomy.customKeys';
		const customUsageSummaries = buildCustomFieldUsageSummaries({
			keyMappings: this.settings.keyMappings,
			filterSets: this.settings.filterSets,
			kanbanPresets: this.settings.kanbanPresets,
			tasks: this.indexer?.getAllTasks() ?? null,
			surfaces: {
				taskCreatorToolbar: this.settings.taskCreatorToolbar,
				taskEditorWorkflowPickers: this.settings.taskEditorWorkflowPickers,
				taskEditorMobileCoreTools: this.settings.taskEditorMobileCoreTools,
				inlineTaskCompactChips: this.settings.inlineTaskCompactChips,
				taskFinderCompactChips: this.settings.taskFinderCompactChips,
				filterTaskCompactChips: this.settings.filterTaskCompactChips,
				overlayTaskCompactChips: this.settings.overlayTaskCompactChips,
			},
		});
		const usageByCanonical = new Map(customUsageSummaries.map(usage => [usage.canonicalKey, usage] as const));

		if (customMappings.length > 0) {
			const customSection = customKeysSection.createDiv('operon-key-mapping-list');
			for (let index = 0; index < customMappings.length; index += 1) {
				const mapping = customMappings[index];
				if (!mapping) continue;
				this.renderKeyMappingRow(customSection, mapping, {
					refresh: refreshSection,
					usage: usageByCanonical.get(mapping.canonicalKey),
					customIndex: index,
					customCount: customMappings.length,
				});
			}
		} else {
			customKeysSection.createEl('p', {
				text: t('settings', 'keyMappingsNoCustom'),
				cls: 'setting-item-description operon-key-mapping-empty-note',
			});
		}

		const addRowEl = customKeysSection.createDiv('operon-settings-add-row operon-key-mapping-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('settings', 'keyMappingsAddCustomField'));
		addBtn.addEventListener('click', () => {
			new CustomKeyMappingModal({
				app: this.app,
				keyMappings: this.settings.keyMappings,
				onSave: settingsAsyncHandler('settings custom key mapping create failed', async mapping => {
					this.settings.keyMappings = [...this.settings.keyMappings, mapping];
					if (mapping.type !== 'checkbox') {
						this.setCustomSurfaceMappingVisible(mapping, 'editor', mapping.showInEditor !== false);
						this.setCustomSurfaceMappingVisible(mapping, 'creator', mapping.showInCreator !== false);
						this.setCustomSurfaceMappingVisible(mapping, 'chips', mapping.showInChips === true);
					}
					await this.saveSettings();
					refreshSection();
				}),
			}).open();
		});
	}

	private async confirmDeleteCustomKeyMapping(
		mapping: KeyMapping,
		usage: CustomFieldUsageSummary | undefined,
	): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'keyMappingsDeleteCustomFieldTitle', { name: mapping.canonicalKey }),
				message: t('settings', 'keyMappingsDeleteCustomFieldMessage'),
				confirmText: t('settings', 'keyMappingsDeleteCustomFieldConfirm'),
				cancelText: t('buttons', 'cancel'),
				danger: true,
				detailsTable: [
					{ label: t('settings', 'keyMappingsCustomFieldCanonicalLabel'), before: mapping.canonicalKey, after: '' },
					{ label: t('settings', 'keyMappingsPropertyLabel'), before: mapping.visiblePropertyName, after: '' },
					...this.buildCustomFieldUsageDetailRows(usage),
				],
			}, resolve).open();
		});
	}

	private formatCustomFieldUsageSummary(usage: CustomFieldUsageSummary | undefined): string {
		const tasks = usage?.taskValueCount === null || usage === undefined
			? t('settings', 'keyMappingsUsageTasksUnavailable')
			: t('settings', 'keyMappingsUsageTasks', { count: String(usage.taskValueCount) });
		const filters = this.formatCustomFieldUsageNames(
			usage?.filterNames ?? [],
			'keyMappingsUsageFilters',
			'keyMappingsUsageFiltersNone',
		);
		const kanban = this.formatCustomFieldUsageNames(
			usage?.kanbanPresetNames ?? [],
			'keyMappingsUsageKanban',
			'keyMappingsUsageKanbanNone',
		);
		return `${t('settings', 'keyMappingsUsageLabel')}: ${tasks} · ${filters} · ${kanban}`;
	}

	private buildCustomFieldUsageDetailRows(usage: CustomFieldUsageSummary | undefined): Array<{ label: string; before: string; after: string }> {
		const taskUsage = usage?.taskValueCount === null || usage === undefined
			? t('settings', 'keyMappingsUsageTasksUnavailable')
			: t('settings', 'keyMappingsUsageTasks', { count: String(usage.taskValueCount) });
		return [
			{ label: t('settings', 'keyMappingsUsageTasksLabel'), before: taskUsage, after: '' },
			{
				label: t('settings', 'keyMappingsUsageFiltersLabel'),
				before: usage?.filterNames.length ? usage.filterNames.join(', ') : t('settings', 'keyMappingsUsageNone'),
				after: '',
			},
			{
				label: t('settings', 'keyMappingsUsageKanbanLabel'),
				before: usage?.kanbanPresetNames.length ? usage.kanbanPresetNames.join(', ') : t('settings', 'keyMappingsUsageNone'),
				after: '',
			},
			{
				label: t('settings', 'keyMappingsUsageSurfacesLabel'),
				before: this.formatCustomFieldSurfaceNames(usage),
				after: '',
			},
		];
	}

	private formatCustomFieldUsageNames(
		names: string[],
		populatedKey: string,
		emptyKey: string,
	): string {
		if (names.length === 0) return t('settings', emptyKey);
		return t('settings', populatedKey, {
			count: String(names.length),
			names: names.join(', '),
		});
	}

	private formatCustomFieldSurfaceNames(usage: CustomFieldUsageSummary | undefined): string {
		const surfaceNames = (usage?.activeSurfaceKeys ?? []).map(key => {
			if (key === 'editor') return t('settings', 'keyMappingsUsageSurfaceEditor');
			if (key === 'creator') return t('settings', 'keyMappingsUsageSurfaceCreator');
			if (key === 'kanbanSwimlane') return t('settings', 'keyMappingsUsageSurfaceKanbanSwimlane');
			return t('settings', 'keyMappingsUsageSurfaceChips');
		});
		return surfaceNames.length ? surfaceNames.join(', ') : t('settings', 'keyMappingsUsageNone');
	}

	private async moveCustomKeyMapping(canonicalKey: string, direction: -1 | 1, refresh?: () => void): Promise<void> {
		this.settings.keyMappings = moveCustomKeyMappingOrder(this.settings.keyMappings, canonicalKey, direction);
		await this.saveSettings();
		refresh?.();
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

	private async moveCalendarPreset(index: number, direction: -1 | 1): Promise<boolean> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.calendarPresets.length) return false;
		const presets = [...this.settings.calendarPresets];
		const [moved] = presets.splice(index, 1);
		if (!moved) return false;
		presets.splice(targetIndex, 0, moved);
		this.settings.calendarPresets = presets;
		await this.saveSettings();
		return true;
	}

	private async moveKanbanPreset(index: number, direction: -1 | 1): Promise<boolean> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.kanbanPresets.length) return false;
		const presets = [...this.settings.kanbanPresets];
		const [moved] = presets.splice(index, 1);
		if (!moved) return false;
		presets.splice(targetIndex, 0, moved);
		this.settings.kanbanPresets = presets;
		await this.saveSettings();
		return true;
	}

	private async moveExternalCalendarSource(index: number, direction: -1 | 1): Promise<boolean> {
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= this.settings.externalCalendars.length) return false;
		const sources = [...this.settings.externalCalendars];
		const [moved] = sources.splice(index, 1);
		if (!moved) return false;
		sources.splice(targetIndex, 0, moved);
		this.settings.externalCalendars = sources;
		await this.saveSettings();
		return true;
	}

	/**
	 * Render a single key mapping row.
	 */
	private renderKeyMappingRow(
		containerEl: HTMLElement,
		mapping: KeyMapping,
		options: {
			refresh?: () => void;
			usage?: CustomFieldUsageSummary;
			customIndex?: number;
			customCount?: number;
		} = {},
	): void {
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

		const validatePropertyInput = (): boolean => {
			const trimmed = propertyInput.value.trim();
			if (!trimmed) {
				propertyInput.toggleClass('is-error', true);
				return false;
			}
			const duplicate = hasDuplicateKeyMappingVisiblePropertyName(trimmed, this.settings.keyMappings, mapping);
			propertyInput.toggleClass('is-error', duplicate);
			return !duplicate;
		};
		const savePropertyInput = settingsAsyncHandler('settings key mapping property change failed', async () => {
			if (!validatePropertyInput()) return;
			const trimmed = propertyInput.value.trim();
			if (trimmed === mapping.visiblePropertyName) return;
			mapping.visiblePropertyName = trimmed;
			await this.saveSettings();
		});

		propertyInput.addEventListener('input', validatePropertyInput);
		propertyInput.addEventListener('change', savePropertyInput);
		propertyInput.addEventListener('blur', savePropertyInput);
		propertyInput.addEventListener('keydown', event => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			propertyInput.blur();
		});

		if (mapping.canonicalKey === 'operonId') {
			propertyInput.disabled = true;
			propertyInput.classList.add('is-disabled');
		}

		if (mapping.isSystem === false) {
			const actionsWrap = row1.createDiv('operon-key-mapping-actions');
			const canMoveUp = typeof options.customIndex === 'number' && options.customIndex > 0;
			const canMoveDown = typeof options.customIndex === 'number'
				&& typeof options.customCount === 'number'
				&& options.customIndex < options.customCount - 1;
			const upButton = actionsWrap.createEl('button', {
				cls: 'operon-key-mapping-reorder-button',
				attr: { type: 'button' },
			});
			setIcon(upButton, 'arrow-up');
			upButton.disabled = !canMoveUp;
			setAccessibleLabelWithoutTooltip(upButton, t('settings', 'keyMappingsCustomMoveUpAria'));
			upButton.addEventListener('click', settingsAsyncHandler('settings custom key mapping move up failed', async () => {
				if (!canMoveUp) return;
				await this.moveCustomKeyMapping(mapping.canonicalKey, -1, options.refresh);
			}));
			const downButton = actionsWrap.createEl('button', {
				cls: 'operon-key-mapping-reorder-button',
				attr: { type: 'button' },
			});
			setIcon(downButton, 'arrow-down');
			downButton.disabled = !canMoveDown;
			setAccessibleLabelWithoutTooltip(downButton, t('settings', 'keyMappingsCustomMoveDownAria'));
			downButton.addEventListener('click', settingsAsyncHandler('settings custom key mapping move down failed', async () => {
				if (!canMoveDown) return;
				await this.moveCustomKeyMapping(mapping.canonicalKey, 1, options.refresh);
			}));

			const deleteButton = actionsWrap.createEl('button', {
				cls: 'operon-key-mapping-delete-button',
				attr: { type: 'button' },
			});
			setIcon(deleteButton, 'trash-2');
			setAccessibleLabelWithoutTooltip(deleteButton, t('settings', 'keyMappingsDeleteCustomFieldAria'));
			deleteButton.addEventListener('click', settingsAsyncHandler('settings custom key mapping delete failed', async () => {
				const confirmed = await this.confirmDeleteCustomKeyMapping(mapping, options.usage);
				if (!confirmed) return;
				this.settings.keyMappings = this.settings.keyMappings.filter(candidate =>
					candidate.isSystem !== false || candidate.canonicalKey !== mapping.canonicalKey
				);
				await this.saveSettings();
				options.refresh?.();
			}));
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

		const openPicker = () => {
			openSettingsIconPickerModal(this.app, {
				title: t('settings', 'keyMappingsIconAria'),
				value: getStoredIcon(),
				query: '',
				onSelect: iconId => { void commitIconValue(iconId); },
				onClear: () => { void commitIconValue(''); },
			});
		};
		refreshIconPreview();
		iconButton.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); openPicker(); });
		iconButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPicker(); });

		// System rows show field help; custom rows show usage stats beside the icon.
		row2.createDiv({
			cls: 'operon-key-mapping-description',
			text: mapping.isSystem === false
				? this.formatCustomFieldUsageSummary(options.usage)
				: getKeyMappingDescription(mapping),
		});

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

		if (mapping.isSystem === false) {
			const descriptionSetting = new Setting(card)
				.setName(t('settings', 'keyMappingsCustomFieldDescriptionLabel'))
				.addTextArea(text => {
					text.inputEl.addClass('operon-key-mapping-description-input');
					text.setPlaceholder(t('settings', 'keyMappingsCustomFieldDescriptionPlaceholder'));
					text.setValue(mapping.description ?? '');
					text.onChange(settingsAsyncHandler('settings key mapping description change failed', async value => {
						const trimmed = value.trim();
						if (trimmed) {
							mapping.description = trimmed;
						} else {
							delete mapping.description;
						}
						await this.saveSettings();
					}));
				});
			descriptionSetting.settingEl.addClass('operon-key-mapping-description-setting');

			const surfaceRow = card.createDiv('operon-key-mapping-surface-row');
			const checkboxUnsupported = mapping.type === 'checkbox';
			const surfaceControls: Array<{
				key: 'showInEditor' | 'showInCreator' | 'showInChips' | 'showInKanbanSwimlane';
				label: string;
				tooltip: string;
				value: boolean;
			}> = [
				{
					key: 'showInEditor',
					label: t('settings', 'keyMappingsShowInEditorLabel'),
					tooltip: t('settings', 'keyMappingsShowInEditorTooltip'),
					value: this.isCustomSurfaceMappingVisible(mapping, 'editor'),
				},
				{
					key: 'showInCreator',
					label: t('settings', 'keyMappingsShowInCreatorLabel'),
					tooltip: t('settings', 'keyMappingsShowInCreatorTooltip'),
					value: this.isCustomSurfaceMappingVisible(mapping, 'creator'),
				},
				{
					key: 'showInChips',
					label: t('settings', 'keyMappingsShowInChipsLabel'),
					tooltip: t('settings', 'keyMappingsShowInChipsTooltip'),
					value: this.isCustomSurfaceMappingVisible(mapping, 'chips'),
				},
				{
					key: 'showInKanbanSwimlane',
					label: t('settings', 'keyMappingsShowInKanbanSwimlaneLabel'),
					tooltip: t('settings', 'keyMappingsShowInKanbanSwimlaneTooltip'),
					value: this.isCustomSurfaceMappingVisible(mapping, 'kanbanSwimlane'),
				},
			];
			for (const control of surfaceControls) {
				const wrap = surfaceRow.createDiv('operon-key-mapping-surface-toggle');
				applyOperonTooltip(wrap, checkboxUnsupported ? t('settings', 'keyMappingsSurfaceCheckboxUnsupported') : control.tooltip);
				wrap.createEl('label', {
					text: control.label,
					cls: 'operon-key-mapping-control-label',
				});
				const host = wrap.createDiv('operon-key-mapping-toggle-host');
				const toggle = new ToggleComponent(host);
				toggle.setValue(control.value);
				toggle.setDisabled(checkboxUnsupported);
				toggle.onChange(async value => {
					if (control.key === 'showInEditor') {
						this.setCustomSurfaceMappingVisible(mapping, 'editor', value);
					} else if (control.key === 'showInCreator') {
						this.setCustomSurfaceMappingVisible(mapping, 'creator', value);
					} else if (control.key === 'showInChips') {
						this.setCustomSurfaceMappingVisible(mapping, 'chips', value);
					} else {
						this.setCustomSurfaceMappingVisible(mapping, 'kanbanSwimlane', value);
					}
					await this.saveSettings();
				});
				setAccessibleLabelWithoutTooltip(host, control.label);
			}
		}
	}

	/**
	 * Filters tab — list of user-defined filter sets.
	 */
	private renderFiltersTab(containerEl: HTMLElement): void {
		const refreshTab = () => {
			containerEl.empty();
			this.renderFiltersTab(containerEl);
		};
		const behaviorSection = renderNativeSettingsGroupedSection(containerEl, t('filterSets', 'behaviorTitle'));

		// Global presentation rules — apply to every filter surface
		this.renderBoundToggleSetting(behaviorSection, t('settings', 'filterShowSubtasks'), t('settings', 'filterShowSubtasksDesc'), 'filterShowSubtasks', {
			errorContext: 'settings filter show subtasks change failed',
		});

		this.renderBoundToggleSetting(behaviorSection, t('settings', 'filterShowOnlyOpenSubtasks'), t('settings', 'filterShowOnlyOpenSubtasksDesc'), 'filterShowOnlyOpenSubtasks', {
			errorContext: 'settings filter open subtasks change failed',
		});

		this.renderDynamicFileTaskFilterSection(containerEl, refreshTab);
		this.renderDynamicSubtasksFilterSection(containerEl, refreshTab);

		const userFiltersSection = renderNativeSettingsGroupedSection(containerEl, t('filterSets', 'userFiltersTitle'));
		userFiltersSection.addClass('operon-settings-add-list-section');
		userFiltersSection.addClass('operon-settings-card-list-section');
		const userFiltersDescEl = userFiltersSection.createEl('p', {
			text: t('filterSets', 'userFiltersDesc'),
			cls: 'operon-settings-muted-block',
		});
		userFiltersDescEl.dataset.operonSettingsSearchId = 'views.filters';

		const listEl = userFiltersSection.createDiv('operon-filter-set-list');
		const renderList = () => {
			const visibleFilterSets = getNormalFilterSets(this.settings.filterSets);
			listEl.empty();
			if (visibleFilterSets.length === 0) {
				listEl.createEl('p', {
					text: t('filterSets', 'empty'),
					cls: 'setting-item-description operon-filter-empty-note',
				});
			}
			for (let i = 0; i < visibleFilterSets.length; i++) {
				this.renderFilterSetCard(listEl, visibleFilterSets[i], i, renderList);
			}
		};
		renderList();

		const addRowEl = userFiltersSection.createDiv('operon-settings-add-row');
		const addBtn = createSettingsAddButton(addRowEl, t('filterSets', 'addFilter'));

		addBtn.addEventListener('click', () => {
			this.openCreateFilterSetModal(renderList);
		});
	}

	private createNewFilterSet(): FilterSet {
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

	private openCreateFilterSetModal(refresh: () => void): void {
		new FilterSetModal(this.app, this.createNewFilterSet(), this.settings.keyMappings, settingsAsyncHandler('settings filter create failed', async (saved) => {
			await this.upsertFilterSet(saved);
			await this.saveSettings();
			refresh();
		}), this.makeEvalDeps() ?? undefined).open();
	}

	private renderDynamicFileTaskFilterSection(containerEl: HTMLElement, refresh: () => void): void {
		const section = renderNativeSettingsGroupedSection(containerEl, t('filterSets', 'dynamicFileTaskFilterTitle'));
		this.markSettingsSearchSectionTarget(section, 'views.dynamicFileTaskFilter');
		section.addClass('operon-settings-card-list-section');
		section.addClass('operon-dynamic-file-task-filter-settings-section');

		this.renderBoundToggleSetting(section, t('settings', 'dynamicFileTaskFilterEnabled'), t('settings', 'dynamicFileTaskFilterEnabledDesc'), 'dynamicFileTaskFilterEnabled', {
			errorContext: 'settings dynamic file task filter enabled change failed',
		});

		this.renderBoundDropdownSetting(section, t('settings', 'dynamicFileTaskFilterPlacement'), t('settings', 'dynamicFileTaskFilterPlacementDesc'), 'dynamicFileTaskFilterPlacement', {
			value: this.settings.dynamicFileTaskFilterPlacement,
			dropdownOptions: [
				{ value: 'body-top', label: t('settings', 'dynamicFileTaskFilterPlacementBodyTop') },
				{ value: 'body-bottom', label: t('settings', 'dynamicFileTaskFilterPlacementBodyBottom') },
			],
			normalize: value => value,
			errorContext: 'settings dynamic file task filter placement change failed',
		});

		this.renderBoundDropdownSetting(section, t('settings', 'dynamicFileTaskFilterSubtaskAutoExpandLimit'), t('settings', 'dynamicFileTaskFilterSubtaskAutoExpandLimitDesc'), 'dynamicFileTaskFilterSubtaskAutoExpandLimit', {
			value: String(this.settings.dynamicFileTaskFilterSubtaskAutoExpandLimit),
			dropdownOptions: DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS.map(limit => ({
				value: String(limit),
				label: getDynamicFileTaskFilterSubtaskAutoExpandLabel(limit),
			})),
			normalize: value => {
				const parsed = Number.parseInt(value, 10);
				return DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS.includes(parsed as typeof DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS[number])
					? parsed as typeof DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS[number]
					: DEFAULT_SETTINGS.dynamicFileTaskFilterSubtaskAutoExpandLimit;
			},
			errorContext: 'settings dynamic file task filter subtask auto-expand limit change failed',
		});

		this.renderBoundToggleSetting(section, t('settings', 'dynamicFileTaskFilterShowOnlyOpenSubtasks'), t('settings', 'dynamicFileTaskFilterShowOnlyOpenSubtasksDesc'), 'dynamicFileTaskFilterShowOnlyOpenSubtasks', {
			errorContext: 'settings dynamic file task filter open subtasks change failed',
		});

		const filterSet = normalizeDynamicFileTaskFilterSet(
			this.settings.filterSets.find(entry => isDynamicFileTaskFilterSet(entry)) ?? null,
		);
		const card = createSettingsListCard({
			containerEl: section.createDiv('operon-filter-set-list'),
			icon: filterSet.icon || 'filter',
			title: filterSet.name,
			className: 'operon-filter-set-card operon-dynamic-file-task-filter-card',
		});
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'lock-keyhole',
			label: t('filterSets', 'dynamicFileTaskFilterLockedConditionChip'),
			className: 'operon-filter-card-used-chip',
		});
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			ariaLabel: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			tooltip: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			text: t('filterSets', 'edit'),
			wide: true,
			onClick: () => {
				const clone = normalizeDynamicFileTaskFilterSet(filterSet);
				new FilterSetModal(this.app, clone, this.settings.keyMappings, settingsAsyncHandler('settings dynamic file task filter edit failed', async (saved) => {
					await this.upsertFilterSet(normalizeDynamicFileTaskFilterSet(saved));
					await this.saveSettings();
					refresh();
				}), undefined, {
					title: t('filterSets', 'dynamicFileTaskFilterTitle'),
					lockConditions: 'dynamicFileTask',
					hideUsageInfo: true,
					showCountBadge: false,
					getSettings: () => this.settings,
				}).open();
			},
		});
	}

	private renderDynamicSubtasksFilterSection(containerEl: HTMLElement, refresh: () => void): void {
		const section = renderNativeSettingsGroupedSection(containerEl, t('filterSets', 'dynamicSubtasksFilterTitle'));
		this.markSettingsSearchSectionTarget(section, 'views.dynamicSubtasksFilter');
		section.addClass('operon-settings-card-list-section');
		section.addClass('operon-dynamic-file-task-filter-settings-section');
		section.addClass('operon-dynamic-subtasks-filter-settings-section');

		this.renderBoundDropdownSetting(section, t('settings', 'dynamicSubtasksFilterSubtaskAutoExpandLimit'), t('settings', 'dynamicSubtasksFilterSubtaskAutoExpandLimitDesc'), 'dynamicSubtasksFilterSubtaskAutoExpandLimit', {
			value: String(this.settings.dynamicSubtasksFilterSubtaskAutoExpandLimit),
			dropdownOptions: DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS.map(limit => ({
				value: String(limit),
				label: getDynamicFileTaskFilterSubtaskAutoExpandLabel(limit),
			})),
			normalize: value => {
				const parsed = Number.parseInt(value, 10);
				return DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS.includes(parsed as typeof DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS[number])
					? parsed as typeof DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS[number]
					: DEFAULT_SETTINGS.dynamicSubtasksFilterSubtaskAutoExpandLimit;
			},
			errorContext: 'settings dynamic subtasks filter subtask auto-expand limit change failed',
		});

		this.renderBoundToggleSetting(section, t('settings', 'dynamicSubtasksFilterShowOnlyOpenSubtasks'), t('settings', 'dynamicSubtasksFilterShowOnlyOpenSubtasksDesc'), 'dynamicSubtasksFilterShowOnlyOpenSubtasks', {
			errorContext: 'settings dynamic subtasks filter open subtasks change failed',
		});

		const filterSet = normalizeDynamicSubtasksFilterSet(
			this.settings.filterSets.find(entry => isDynamicSubtasksFilterSet(entry)) ?? null,
		);
		const card = createSettingsListCard({
			containerEl: section.createDiv('operon-filter-set-list'),
			icon: filterSet.icon || 'filter',
			title: filterSet.name,
			className: 'operon-filter-set-card operon-dynamic-file-task-filter-card',
		});
		createSettingsListCardChip({
			containerEl: card.metaEl,
			icon: 'lock-keyhole',
			label: t('filterSets', 'dynamicFileTaskFilterLockedConditionChip'),
			className: 'operon-filter-card-used-chip',
		});
		createSettingsListCardActionButton({
			containerEl: card.actionsEl,
			label: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			ariaLabel: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			tooltip: t('filterSets', 'editFilterNamed', { name: filterSet.name }),
			text: t('filterSets', 'edit'),
			wide: true,
			onClick: () => {
				const clone = normalizeDynamicSubtasksFilterSet(filterSet);
				new FilterSetModal(this.app, clone, this.settings.keyMappings, settingsAsyncHandler('settings dynamic subtasks filter edit failed', async (saved) => {
					await this.upsertFilterSet(normalizeDynamicSubtasksFilterSet(saved));
					await this.saveSettings();
					refresh();
				}), undefined, {
					title: t('filterSets', 'dynamicSubtasksFilterTitle'),
					lockConditions: 'dynamicSubtasks',
					hideUsageInfo: true,
					showCountBadge: false,
					getSettings: () => this.settings,
				}).open();
			},
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
		if (isSpecialDynamicFilterSetId(filterId)) return;
		await this.storage.filters.delete(filterId);
		this.syncFilterSetsFromStore();
	}

	private async moveFilterSet(filterId: string, direction: 'up' | 'down'): Promise<void> {
		if (isSpecialDynamicFilterSetId(filterId)) return;
		const ids = getNormalFilterSets(this.settings.filterSets).map(f => f.id);
		const idx = ids.indexOf(filterId);
		if (idx === -1) return;
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= ids.length) return;
		[ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
		await this.storage.filters.replaceOrder(ids);
		this.syncFilterSetsFromStore();
	}

	private async copyFilterSet(filterSet: FilterSet): Promise<void> {
		if (isSpecialDynamicFilterSet(filterSet)) return;
		const copy = cloneFilterSet(filterSet);
		copy.id = generateFilterSetId();
		copy.name = `${filterSet.name} Copy`;
		// Insert copy directly after the original
		const ids = getNormalFilterSets(this.settings.filterSets).map(f => f.id);
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

	private async duplicateFilterSet(filterSet: FilterSet, refresh: () => void): Promise<void> {
		await this.copyFilterSet(filterSet);
		await this.saveSettings();
		refresh();
	}

	private async copyFilterSetEmbedCode(filterSet: FilterSet): Promise<void> {
		const code = '```operon\nfilterId: "' + filterSet.id + '"\n```';
		await navigator.clipboard.writeText(code);
		new Notice(t('filterSets', 'embedCodeCopied'));
	}

	private confirmDeleteFilterSet(filterSet: FilterSet, refresh: () => void, onDeleted?: () => void): void {
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
				onDeleted?.();
			}),
		);
		modal.open();
	}

	private openEditFilterSetModal(filterSet: FilterSet, refresh: () => void): void {
		const clone = cloneFilterSet(filterSet);
		new FilterSetModal(this.app, clone, this.settings.keyMappings, settingsAsyncHandler('settings filter edit failed', async (saved) => {
			await this.upsertFilterSet(saved);
			await this.saveSettings();
			refresh();
		}), this.makeEvalDeps() ?? undefined).open();
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
		const total = getNormalFilterSets(this.settings.filterSets).length;
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
				this.openEditFilterSetModal(filterSet, refresh);
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
				await this.duplicateFilterSet(filterSet, refresh);
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
				await this.copyFilterSetEmbedCode(filterSet);
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
				this.confirmDeleteFilterSet(filterSet, refresh);
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
		return this.markSettingsSearchTarget(renderToggleSetting({
			containerEl,
			name,
			desc,
			value: this.settings[key] === true,
			onChange: options.errorContext
				? settingsAsyncHandler(options.errorContext, applyChange)
				: applyChange,
		}), key);
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
		return this.markSettingsSearchTarget(renderDropdownSetting({
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
		}), String(key));
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
		return this.markSettingsSearchTarget(renderTextSetting({
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
		}), key);
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
		const setting = new Setting(containerEl)
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
		return this.markSettingsSearchTarget(setting, key);
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
		this.markSettingsSearchTarget(renderNumericTextSetting({
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
		}), String(key));
	}

	private renderFilterTaskCardsSection(
		containerEl: HTMLElement,
		options: {
			sectionId?: TaskChipsSettingsPageId;
			desc?: string;
			collapsibleFallback?: boolean;
			omitNativeTitle?: boolean;
		} = {},
	): void {
		const sectionEl = this.renderTaskChipsGroupedSection(containerEl, t('settings', 'filterTaskIconsSection'), options);
		renderCompactChipSettingsSection({
			layout: 'row-list',
			containerEl: sectionEl,
			description: t('settings', 'filterTaskIconsSectionDesc'),
			descriptionSearchTargetId: 'ui.filterTaskChips',
			toggleTitle: t('settings', 'filterTaskIconsToggleTitle'),
			iconOnlyTitle: t('settings', 'filterTaskIconsDisplayModeTitle'),
			reorderTitle: t('settings', 'filterTaskIconsReorder'),
			moveUpLabel: t('settings', 'filterTaskIconsMoveUp'),
			moveDownLabel: t('settings', 'filterTaskIconsMoveDown'),
			getItems: () => this.getRenderableSurfaceItems(this.settings.filterTaskCompactChips, 'chips'),
			setItems: items => {
				this.settings.filterTaskCompactChips = this.mergeRenderableSurfaceItems(
					this.settings.filterTaskCompactChips,
					items,
					'chips',
				);
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
				{
					visible: this.settings.filterTaskShowPlainCheckboxAction,
					icon: 'layout-list',
					label: t('settings', 'filterTaskOpenCheckboxAction'),
					searchTargetId: 'ui.filterTaskShowPlainCheckboxAction',
					onToggle: async () => {
						this.settings.filterTaskShowPlainCheckboxAction = !this.settings.filterTaskShowPlainCheckboxAction;
						await this.saveSettings();
					},
				},
			],
		});
	}

	private renderFileTaskTemplateSettings(containerEl: HTMLElement, sectionHostEl = containerEl): void {
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

		this.renderExcludedFolderSettings(sectionHostEl);

		this.renderFileTaskDailyNotesSettings(sectionHostEl);
		this.renderFileTaskArchiveSettings(sectionHostEl);
		this.renderFileTaskMigrationSettings(sectionHostEl);

		renderPreview();
	}

	private renderFileTaskDailyNotesSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-file-task-daily-notes-setting' });
		const sectionEl = renderNativeSettingsGroupedSection(wrapper, t('settings', 'fileTaskDailyNotes'));
		this.renderBoundToggleSetting(sectionEl, t('settings', 'createDailyNotesAsOperonTask'), t('settings', 'createDailyNotesAsOperonTaskDesc'), 'createDailyNotesAsOperonTask');
	}

	private renderFileTaskArchiveSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-file-task-archive-setting' });
		const sectionEl = renderNativeSettingsGroupedSection(wrapper, t('settings', 'fileTaskArchive'));

		this.renderBoundToggleSetting(
			sectionEl,
			t('settings', 'fileTaskAutoArchiveEnabled'),
			t('settings', 'fileTaskAutoArchiveEnabledDesc'),
			'fileTaskAutoArchiveEnabled',
		);

		this.renderBoundTextSetting(sectionEl, t('settings', 'fileTaskArchiveFolder'), t('settings', 'fileTaskArchiveFolderDesc'), 'fileTaskArchiveFolder', {
			placeholder: t('settings', 'fileTaskArchiveFolderPlaceholder'),
			settingClass: 'operon-settings-long-text-setting',
			controlClass: 'operon-settings-input-long',
			normalize: value => normalizeSettingsFolderPath(value) || DEFAULT_SETTINGS.fileTaskArchiveFolder,
			configure: text => {
				new FolderSuggest(this.app, text.inputEl, settingsAsyncHandler('settings file task archive folder selection failed', async (folder) => {
					this.settings.fileTaskArchiveFolder = normalizeSettingsFolderPath(folder.path) || DEFAULT_SETTINGS.fileTaskArchiveFolder;
					await this.saveSettings();
				}));
			},
		});

		this.addNumericSetting(sectionEl, t('settings', 'fileTaskArchiveDelaySeconds'), t('settings', 'fileTaskArchiveDelaySecondsDesc'), 'fileTaskArchiveDelaySeconds');
		this.renderBoundToggleSetting(
			sectionEl,
			t('settings', 'fileTaskArchiveOnlyFromFileTasksFolder'),
			t('settings', 'fileTaskArchiveOnlyFromFileTasksFolderDesc'),
			'fileTaskArchiveOnlyFromFileTasksFolder',
		);
	}

	private renderWorkspaceTweaksExcludedFolderSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-workspace-tweaks-excluded-folders-setting' });
		const sectionEl = renderNativeSettingsGroupedSection(wrapper, t('settings', 'workspaceTweaksPropertiesExcludedFolders'));
		sectionEl.addClass('operon-settings-add-list-section');
		sectionEl.addClass('operon-settings-card-list-section');
		this.markSettingsSearchSectionTarget(sectionEl, 'ui.workspaceTweaksPropertiesExcludedFolders');

		sectionEl.createDiv({
			text: t('settings', 'workspaceTweaksPropertiesExcludedFoldersDesc'),
			cls: 'operon-excluded-folders-desc',
		});

		const listEl = sectionEl.createDiv('operon-excluded-folders-list');
		const pickerEl = sectionEl.createDiv('operon-excluded-folders-picker');
		const addRowEl = sectionEl.createDiv('operon-excluded-folders-add-row');
		addRowEl.addClass('operon-settings-add-row');

		const normalizeFolderList = (folders: readonly string[]): string[] => {
			const seen = new Set<string>();
			const normalizedFolders: string[] = [];
			for (const folder of folders) {
				const normalized = normalizeSettingsFolderPath(folder);
				const lower = normalized.toLowerCase();
				if (!normalized || seen.has(lower)) continue;
				seen.add(lower);
				normalizedFolders.push(normalized);
			}
			return normalizedFolders;
		};
		const renderFolderPath = (rowEl: HTMLElement, folderPath: string): void => {
			const slashIndex = folderPath.lastIndexOf('/');
			if (slashIndex >= 0) {
				rowEl.createSpan({ text: `${folderPath.slice(0, slashIndex + 1)}` });
				rowEl.createEl('strong', { text: folderPath.slice(slashIndex + 1) });
			} else {
				rowEl.createEl('strong', { text: folderPath });
			}
		};
		const hasExcludedFolder = (folderPath: string): boolean => {
			const normalized = normalizeSettingsFolderPath(folderPath).toLowerCase();
			return this.settings.workspaceTweaksPropertiesExcludedFolders
				.some(folder => normalizeSettingsFolderPath(folder).toLowerCase() === normalized);
		};
		const saveAndApply = async (): Promise<void> => {
			await this.saveSettings();
			this.applyPendingSettingsChange();
		};
		const addExcludedFolder = async (path: string): Promise<void> => {
			const normalized = normalizeSettingsFolderPath(path);
			if (!normalized) return;
			if (hasExcludedFolder(normalized)) {
				new Notice(t('settings', 'workspaceTweaksPropertiesExcludedFolderAlreadyAdded'));
				return;
			}
			this.settings.workspaceTweaksPropertiesExcludedFolders = normalizeFolderList([
				...this.settings.workspaceTweaksPropertiesExcludedFolders,
				normalized,
			]);
			pickerEl.empty();
			render();
			await saveAndApply();
		};
		const renderAddControls = (): void => {
			addRowEl.empty();
			const button = createSettingsAddButton(addRowEl, t('settings', 'workspaceTweaksAddPropertiesExcludedFolder'));
			button.onclick = () => {
				pickerEl.empty();
				new Setting(pickerEl)
					.setName(t('settings', 'workspaceTweaksPropertiesExcludedFolderSearch'))
					.addText(text => {
						text.setPlaceholder(t('settings', 'workspaceTweaksPropertiesExcludedFolderSearchPlaceholder'));
						text.inputEl.addClass('operon-settings-input-long');
						new FolderSuggest(this.app, text.inputEl, folder => {
							void addExcludedFolder(folder.path);
						}, {
							filter: folder => !hasExcludedFolder(folder.path),
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
			this.settings.workspaceTweaksPropertiesExcludedFolders = normalizeFolderList(
				this.settings.workspaceTweaksPropertiesExcludedFolders,
			);
			listEl.empty();
			for (const folderPath of this.settings.workspaceTweaksPropertiesExcludedFolders) {
				const row = createSettingsListCard({
					containerEl: listEl,
					icon: 'panel-top-close',
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
					label: t('settings', 'workspaceTweaksRemovePropertiesExcludedFolder'),
					ariaLabel: `${t('settings', 'workspaceTweaksRemovePropertiesExcludedFolder')}: ${folderPath}`,
					tooltip: `${t('settings', 'workspaceTweaksRemovePropertiesExcludedFolder')}: ${folderPath}`,
					icon: 'trash-2',
					danger: true,
					className: 'operon-excluded-folder-remove',
					errorContext: 'settings workspace tweak excluded folder remove failed',
					onClick: async () => {
						this.settings.workspaceTweaksPropertiesExcludedFolders = this.settings.workspaceTweaksPropertiesExcludedFolders
							.filter(folder => normalizeSettingsFolderPath(folder).toLowerCase() !== folderPath.toLowerCase());
						render();
						await saveAndApply();
					},
				});
			}
			if (this.settings.workspaceTweaksPropertiesExcludedFolders.length === 0) {
				listEl.createDiv({
					text: t('settings', 'workspaceTweaksPropertiesExcludedFoldersEmpty'),
					cls: 'operon-excluded-folders-empty',
				});
			}
			renderAddControls();
		};

		render();
	}

	private renderExcludedFolderSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-excluded-folders-setting' });

		const sectionEl = renderNativeSettingsGroupedSection(wrapper, t('settings', 'excludedFolders'));
		sectionEl.addClass('operon-settings-add-list-section');
		sectionEl.addClass('operon-settings-card-list-section');

		const excludedFoldersDescEl = sectionEl.createDiv({
			text: t('settings', 'excludedFoldersDesc'),
			cls: 'operon-excluded-folders-desc',
		});
		excludedFoldersDescEl.dataset.operonSettingsSearchId = 'automation.excludedFolders';

		const listEl = sectionEl.createDiv('operon-excluded-folders-list');

		const pickerEl = sectionEl.createDiv('operon-excluded-folders-picker');
		const addRowEl = sectionEl.createDiv('operon-excluded-folders-add-row');
		addRowEl.addClass('operon-settings-add-row');

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
			const button = createSettingsAddButton(addRowEl, t('settings', 'addExcludedFolder'));
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

	private renderFileTaskMigrationSettings(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'operon-file-task-migration-setting' });
		const sectionEl = renderNativeSettingsGroupedSection(wrapper, t('settings', 'fileTaskMigration'));
		sectionEl.addClass('operon-file-task-migration-section');
		const fileTaskMigrationDescEl = sectionEl.createDiv({
			text: t('settings', 'fileTaskMigrationDesc'),
			cls: 'operon-file-task-migration-desc',
		});
		fileTaskMigrationDescEl.dataset.operonSettingsSearchId = 'automation.fileTaskMigration';

		let selectedType: FileTaskMigrationRuleType = 'folder';
		let folderPath = '';
		let tagValue = '';
		let propertyKey = '';
		let propertyValue = '';
		let lastScan: FileTaskMigrationScanResult | null = null;
		let scanWarning = '';

		const rows = new Map<FileTaskMigrationRuleType, HTMLElement>();
		const controls = new Map<FileTaskMigrationRuleType, HTMLInputElement[]>();

		const ruleListEl = sectionEl.createDiv('operon-file-task-migration-rule-list');
		const actionRowEl = sectionEl.createDiv('operon-file-task-migration-action-row');
		const scanButton = actionRowEl.createEl('button', {
			text: t('settings', 'fileTaskMigrationScanVault'),
			cls: 'operon-settings-primary-button',
			attr: { type: 'button' },
		});
		const resultEl = sectionEl.createDiv('operon-file-task-migration-result-wrap');
		resultEl.setAttribute('aria-live', 'polite');
		resultEl.setAttribute('role', 'status');

		const buildRule = (): FileTaskMigrationRule | null => {
			if (selectedType === 'folder') {
				const normalizedFolder = normalizeSettingsFolderPath(folderPath);
				return normalizedFolder ? { type: 'folder', folderPath: normalizedFolder } : null;
			}
			if (selectedType === 'tag') {
				const normalizedTag = normalizeFileTaskMigrationTag(tagValue);
				return normalizedTag ? { type: 'tag', tag: normalizedTag } : null;
			}
			const key = propertyKey.trim();
			const value = propertyValue.trim();
			return key && value ? { type: 'property', propertyKey: key, propertyValue: value } : null;
		};

		const updateScanButton = (): void => {
			scanButton.disabled = buildRule() === null;
		};

		const renderCompletion = (convertedCount: number, failedCount: number): void => {
			resultEl.empty();
			const panel = resultEl.createDiv('operon-file-task-migration-result');
			panel.createDiv({
				text: failedCount > 0
					? t('settings', 'fileTaskMigrationCompletedWithFailures', {
						converted: String(convertedCount),
						failed: String(failedCount),
					})
					: t('settings', 'fileTaskMigrationCompleted', { converted: String(convertedCount) }),
				cls: 'operon-file-task-migration-result-title',
			});
		};

			const renderScanResult = (): void => {
				resultEl.empty();
				if (!lastScan) return;

				const panel = resultEl.createDiv('operon-file-task-migration-result');
				panel.createDiv({
					text: t('settings', 'fileTaskMigrationScanResult'),
					cls: 'operon-file-task-migration-result-title',
				});
				panel.createDiv({
					text: t('settings', 'fileTaskMigrationResultSummary', {
						total: String(lastScan.totalMatchedCount),
						convertible: String(lastScan.convertibleFiles.length),
						already: String(lastScan.alreadyFileTaskFiles.length),
						excluded: String(lastScan.excludedFiles.length),
					}),
					cls: 'operon-file-task-migration-result-summary',
				});
				if (scanWarning) {
					panel.createDiv({
						text: scanWarning,
						cls: 'operon-file-task-migration-warning',
					});
				}
				if (lastScan.convertibleFiles.length > 0) {
					const previewEl = panel.createDiv('operon-file-task-migration-preview');
					previewEl.createDiv({
						text: t('settings', 'fileTaskMigrationPreviewTitle'),
						cls: 'operon-file-task-migration-preview-title',
					});
					const listEl = previewEl.createEl('ul');
					for (const snapshot of lastScan.convertibleSnapshots.slice(0, 10)) {
						listEl.createEl('li', { text: snapshot.path });
					}
					const remaining = Math.max(0, lastScan.convertibleSnapshots.length - 10);
					if (remaining > 0) {
						listEl.createEl('li', {
							text: t('settings', 'fileTaskMigrationPreviewMore', { count: String(remaining) }),
							cls: 'operon-file-task-migration-preview-more',
						});
					}
				}

				if (lastScan.convertibleFiles.length === 0) return;

				const convertRow = panel.createDiv('operon-file-task-migration-convert-row');
				const convertButton = convertRow.createEl('button', {
					text: t('settings', 'fileTaskMigrationConvertFiles', { count: String(lastScan.convertibleFiles.length) }),
					attr: { type: 'button' },
				});
				convertButton.addClass('mod-cta');
				convertButton.addEventListener('click', settingsAsyncHandler('settings file task migration convert failed', async () => {
					if (!lastScan || lastScan.convertibleFiles.length === 0) return;
					convertButton.disabled = true;
					const validation = validateFileTaskMigrationScan(this.app, this.settings, lastScan);
					if (!validation.valid) {
						lastScan = validation.currentScan;
						scanWarning = validation.abortedReason === 'fileChanged'
							? t('settings', 'fileTaskMigrationFilesChanged')
							: t('settings', 'fileTaskMigrationScanChanged');
						new Notice(scanWarning);
						renderScanResult();
						return;
					}
					lastScan = validation.currentScan;
					scanWarning = '';
					convertButton.disabled = false;
					new FileTaskMigrationProgressModal(this.app, {
						scanResult: validation.currentScan,
						ruleLabel: this.describeFileTaskMigrationRule(validation.currentScan.rule),
						onConvert: async (onProgress, setStatus) => {
							const applyResult = await applyFileTaskMigration(this.app, this.settings, validation.currentScan, { onProgress });
							if (applyResult.abortedReason) {
								lastScan = applyResult.currentScan ?? validation.currentScan;
								scanWarning = applyResult.abortedReason === 'fileChanged'
									? t('settings', 'fileTaskMigrationFilesChanged')
									: t('settings', 'fileTaskMigrationScanChanged');
								new Notice(scanWarning);
								renderScanResult();
								return applyResult;
							}
							if (applyResult.convertedFiles.length > 0 && this.indexer) {
								setStatus(t('settings', 'fileTaskMigrationReindexing'));
								await this.indexer.fullReindex();
								new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
							}

							const failedCount = applyResult.failedFiles.length;
							new Notice(failedCount > 0
								? t('settings', 'fileTaskMigrationCompletedWithFailures', {
									converted: String(applyResult.convertedFiles.length),
									failed: String(failedCount),
								})
								: t('settings', 'fileTaskMigrationCompleted', { converted: String(applyResult.convertedFiles.length) }));
							lastScan = null;
							scanWarning = '';
							renderCompletion(applyResult.convertedFiles.length, failedCount);
							return applyResult;
						},
					}).open();
				}));
			};

			const clearScan = (): void => {
				lastScan = null;
				scanWarning = '';
				renderScanResult();
				updateScanButton();
			};

		const updateActivation = (): void => {
			for (const [type, row] of rows) {
				const active = type === selectedType;
				row.toggleClass('is-active', active);
				row.toggleClass('is-inactive', !active);
				for (const input of controls.get(type) ?? []) {
					input.disabled = !active;
				}
			}
			updateScanButton();
		};

		const selectType = (type: FileTaskMigrationRuleType): void => {
			if (selectedType === type) return;
			selectedType = type;
			clearScan();
			updateActivation();
		};

		const createRuleRow = (
			type: FileTaskMigrationRuleType,
			label: string,
			buildControls: (controlEl: HTMLElement) => HTMLInputElement[],
		): void => {
			const row = ruleListEl.createDiv('operon-file-task-migration-rule-row');
			row.addClass(`operon-file-task-migration-rule-${type}`);
			const radio = row.createEl('input', {
				attr: {
					type: 'radio',
					name: 'operon-file-task-migration-rule',
					value: type,
					'aria-label': label,
				},
			});
			radio.checked = selectedType === type;
			radio.addEventListener('change', () => {
				if (radio.checked) selectType(type);
			});
			row.createSpan({ text: label, cls: 'operon-file-task-migration-rule-label' });
			const controlEl = row.createDiv('operon-file-task-migration-rule-control');
			rows.set(type, row);
			controls.set(type, buildControls(controlEl));
		};

		createRuleRow('folder', t('settings', 'fileTaskMigrationFolder'), controlEl => {
			const input = controlEl.createEl('input', {
				attr: {
					type: 'text',
					placeholder: t('settings', 'fileTaskMigrationFolderPlaceholder'),
				},
				cls: 'operon-settings-input-long',
			});
			input.addEventListener('input', () => {
				folderPath = input.value;
				clearScan();
			});
			new FolderSuggest(this.app, input, folder => {
				folderPath = folder.path;
				clearScan();
			});
			return [input];
		});

		createRuleRow('tag', t('settings', 'fileTaskMigrationTag'), controlEl => {
			const input = controlEl.createEl('input', {
				attr: {
					type: 'text',
					placeholder: t('settings', 'fileTaskMigrationTagPlaceholder'),
				},
				cls: 'operon-settings-input-long',
			});
			input.addEventListener('input', () => {
				tagValue = input.value;
				clearScan();
			});
			new TextValueSuggest(this.app, input, () => collectFileTaskMigrationTagCandidates(this.app), {
				formatValue: value => `#${normalizeFileTaskMigrationTag(value)}`,
			});
			return [input];
		});

		createRuleRow('property', t('settings', 'fileTaskMigrationProperty'), controlEl => {
			const keyInput = controlEl.createEl('input', {
				attr: {
					type: 'text',
					placeholder: t('settings', 'fileTaskMigrationPropertyKeyPlaceholder'),
				},
				cls: 'operon-file-task-migration-property-key',
			});
			const valueInput = controlEl.createEl('input', {
				attr: {
					type: 'text',
					placeholder: t('settings', 'fileTaskMigrationPropertyValuePlaceholder'),
				},
				cls: 'operon-file-task-migration-property-value',
			});
			keyInput.addEventListener('input', () => {
				propertyKey = keyInput.value;
				clearScan();
			});
			valueInput.addEventListener('input', () => {
				propertyValue = valueInput.value;
				clearScan();
			});
			new TextValueSuggest(this.app, keyInput, () => collectFileTaskMigrationPropertyKeyCandidates(this.app));
			new TextValueSuggest(this.app, valueInput, () => collectFileTaskMigrationPropertyValueCandidates(this.app, propertyKey));
			return [keyInput, valueInput];
		});

		scanButton.addEventListener('click', () => {
			const rule = buildRule();
			if (!rule) {
				new Notice(t('settings', 'fileTaskMigrationMissingRule'));
				return;
			}
				lastScan = scanFileTaskMigration(this.app, this.settings, rule);
				scanWarning = '';
				renderScanResult();
			});

		updateActivation();
	}

			private describeFileTaskMigrationRule(rule: FileTaskMigrationRule): string {
				if (rule.type === 'folder') {
					return t('settings', 'fileTaskMigrationRuleFolderValue', { value: rule.folderPath });
			}
			if (rule.type === 'tag') {
				return t('settings', 'fileTaskMigrationRuleTagValue', { value: `#${normalizeFileTaskMigrationTag(rule.tag)}` });
			}
			return t('settings', 'fileTaskMigrationRulePropertyValue', {
				key: rule.propertyKey,
				value: rule.propertyValue,
			});
		}
	private async persistSettingsOnly(): Promise<void> {
		await this.storage.saveSettings();
	}

	private notifySettingsChanged(): void {
		this.hasPendingSettingsChange = true;
	}

	private applyPendingSettingsChange(): void {
		this.hasPendingSettingsChange = false;
		this.onSettingsChanged();
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
