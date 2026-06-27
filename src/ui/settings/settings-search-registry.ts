import type { OperonSettings } from '../../types/settings';

export type OperonSettingsSearchDomain =
	| 'settings'
	| 'taxonomy'
	| 'views'
	| 'ui'
	| 'automation'
	| 'integrations';

export type OperonSettingsSearchControlKind =
	| 'dropdown'
	| 'file'
	| 'folder'
	| 'number'
	| 'render'
	| 'text'
	| 'toggle';

export interface OperonSettingsSearchTextKey {
	namespace: string;
	key: string;
}

export interface OperonSettingsSearchEntry {
	id: string;
	domain: OperonSettingsSearchDomain;
	tabId: string;
	key?: keyof OperonSettings;
	name: OperonSettingsSearchTextKey;
	desc: OperonSettingsSearchTextKey;
	control: OperonSettingsSearchControlKind;
	aliases?: string[];
}

function k(namespace: string, key: string): OperonSettingsSearchTextKey {
	return { namespace, key };
}

function e(
	domain: OperonSettingsSearchDomain,
	tabId: string,
	key: keyof OperonSettings,
	namespace: string,
	nameKey: string,
	descKey: string,
	control: OperonSettingsSearchControlKind,
	aliases: string[] = [],
): OperonSettingsSearchEntry {
	return {
		id: `${domain}.${key}`,
		domain,
		tabId,
		key,
		name: k(namespace, nameKey),
		desc: k(namespace, descKey),
		control,
		aliases,
	};
}

function section(
	domain: OperonSettingsSearchDomain,
	tabId: string,
	id: string,
	namespace: string,
	nameKey: string,
	descKey: string,
	aliases: string[] = [],
): OperonSettingsSearchEntry {
	return {
		id: `${domain}.${id}`,
		domain,
		tabId,
		name: k(namespace, nameKey),
		desc: k(namespace, descKey),
		control: 'render',
		aliases,
	};
}

export const OPERON_SETTINGS_SEARCH_REGISTRY: readonly OperonSettingsSearchEntry[] = [
	e('settings', 'coreGeneral', 'language', 'settings', 'language', 'languageDesc', 'render', ['locale', 'translation', 'language setting']),
	e('settings', 'coreGeneral', 'timeFormat', 'settings', 'timeFormat', 'timeFormatDesc', 'dropdown', ['clock', '12 hour', '24 hour', 'time display']),
	e('settings', 'coreGeneral', 'releaseNotesShowOnUpdate', 'settings', 'releaseNotesShowOnUpdate', 'releaseNotesShowOnUpdateDesc', 'toggle', ['release notes', 'what is new', 'updates', 'changelog', 'popup']),
	section('settings', 'coreGeneral', 'demoWorkspace', 'settings', 'demoWorkspace', 'demoWorkspaceDesc', ['demo', 'sample workspace', 'basics workspace', 'example tasks']),
	section('settings', 'coreGeneral', 'operonDocs', 'settings', 'operonDocsSection', 'operonDocsSectionDesc', ['docs', 'documentation', 'wiki', 'official docs', 'download docs']),
	e('settings', 'coreGeneral', 'operonDocsAutoUpdateEnabled', 'settings', 'operonDocsAutoUpdateEnabled', 'operonDocsAutoUpdateEnabledDesc', 'toggle', ['docs', 'documentation', 'wiki', 'auto update docs', 'official docs', 'plugin update docs']),
	e('settings', 'coreGeneral', 'indexEventDebounceMs', 'settings', 'indexDebounce', 'indexDebounceDesc', 'number', ['index', 'reindex', 'index debounce', 'vault scan', 'file changes']),
	e('settings', 'coreGeneral', 'fullReindexOnStartup', 'settings', 'fullReindexOnStartup', 'fullReindexOnStartupDesc', 'toggle', ['index', 'reindex', 'startup index', 'vault scan']),
	e('settings', 'coreGeneral', 'duplicateAlertAutoOpenManager', 'settings', 'duplicateAlertAutoOpenManager', 'duplicateAlertAutoOpenManagerDesc', 'toggle', ['duplicate', 'duplicate id', 'duplicate popup', 'duplicate manager', 'operonId conflict']),
	e('settings', 'coreGeneral', 'duplicateAlertDelaySeconds', 'settings', 'duplicateAlertDelay', 'duplicateAlertDelayDesc', 'dropdown', ['duplicate', 'duplicate delay', 'duplicate popup', 'notice delay', 'status bar alert']),

	section('taxonomy', 'corePipelines', 'pipelines', 'settings', 'tabPipelines', 'pipelinesDesc', ['pipeline', 'workflow', 'workflow statuses', 'status', 'status color', 'status icon', 'scheduled target', 'tracking target', 'finished status', 'cancelled status', 'pipeline description', 'agent context', 'workflow context']),
	section('taxonomy', 'corePriority', 'priorities', 'settings', 'tabPriority', 'priorityDesc', ['priority', 'priority rank', 'priority order', 'default priority', 'priority color', 'priority icon', 'sorting', 'planning', 'priority description', 'agent context', 'importance guidance']),
	section('taxonomy', 'coreKeymapping', 'keyMappings', 'settings', 'keyMappings', 'keyMappingsIntro', ['key mapping', 'property mapping', 'properties', 'fields', 'frontmatter', 'yaml', 'inline metadata', 'canonical key', 'visible property', 'task field']),
	section('taxonomy', 'coreCustomKeys', 'customKeys', 'settings', 'tabCustomKeys', 'customKeysDesc', ['custom keys', 'custom fields', 'custom field', 'custom key', 'canonical custom key', 'add field', 'add custom field', 'show in editor', 'show in creator', 'show in chips', 'surface visibility', 'used in', 'usage', 'reorder custom field']),

	e('automation', 'tasksInlineTasks', 'inlineTaskSaveMode', 'settings', 'inlineTaskDefaultSavePath', 'inlineTaskDefaultSavePathDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'inline save path', 'active file']),
	e('automation', 'tasksInlineTasks', 'inlineTaskTargetFile', 'settings', 'inlineTaskTargetFile', 'inlineTaskTargetFileDesc', 'file', ['new task', 'task creator', 'inline task', 'specific file']),
	e('automation', 'tasksInlineTasks', 'inlineTaskHeading', 'settings', 'inlineTaskHeading', 'inlineTaskHeadingDesc', 'text', ['new task', 'task creator', 'inline task', 'heading', 'section']),
	e('automation', 'tasksInlineTasks', 'inlineTaskParentInlineTargetMode', 'settings', 'inlineParentTaskTargetMode', 'inlineParentTaskTargetModeDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'parent', 'parent placement', 'inline parent']),
	e('automation', 'tasksInlineTasks', 'inlineTaskParentFileTargetMode', 'settings', 'fileParentTaskTargetMode', 'fileParentTaskTargetModeDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'file task', 'parent', 'parent placement']),
	e('automation', 'tasksInlineTasks', 'inlineTaskParentFileHeadingKeyword', 'settings', 'parentFileHeadingKeyword', 'parentFileHeadingKeywordDesc', 'text', ['new task', 'task creator', 'inline task', 'parent file heading']),
	e('automation', 'tasksInlineTasks', 'inlineTaskDailyNoteAddStartDate', 'settings', 'inlineTaskDailyNoteAddStartDate', 'inlineTaskDailyNoteAddStartDateDesc', 'toggle', ['daily notes', 'daily note defaults', 'start date', 'dateStarted', 'inline task']),
	e('automation', 'tasksInlineTasks', 'inlineTaskDailyNoteAddScheduledDate', 'settings', 'inlineTaskDailyNoteAddScheduledDate', 'inlineTaskDailyNoteAddScheduledDateDesc', 'toggle', ['daily notes', 'daily note defaults', 'scheduled date', 'dateScheduled', 'inline task']),
	e('ui', 'tasksInlineTasks', 'inlineTaskShowTasksEmojiConvertIcon', 'settings', 'showTasksEmojiConvertIcon', 'showTasksEmojiConvertIconDesc', 'toggle', ['tasks emoji', 'convert task', 'inline task conversion']),
	e('ui', 'tasksInlineTasks', 'inlineTaskShowPlainCheckboxConvertIcon', 'settings', 'showPlainCheckboxConvertIcon', 'showPlainCheckboxConvertIconDesc', 'toggle', ['plain checkbox', 'convert checkbox', 'inline task conversion']),

	e('automation', 'tasksFileTasks', 'fileTasksFolder', 'settings', 'fileTasksFolder', 'fileTasksFolderDesc', 'folder', ['new task', 'task creator', 'file task', 'file task folder']),
	e('automation', 'tasksFileTasks', 'fileTaskParentInlineTargetMode', 'settings', 'fileTaskInlineParentTargetMode', 'fileTaskInlineParentTargetModeDesc', 'dropdown', ['new task', 'task creator', 'file task', 'inline task', 'parent', 'parent placement']),
	e('automation', 'tasksFileTasks', 'fileTaskParentFileTargetMode', 'settings', 'fileTaskFileParentTargetMode', 'fileTaskFileParentTargetModeDesc', 'dropdown', ['new task', 'task creator', 'file task', 'parent', 'parent placement']),
	e('automation', 'tasksFileTasks', 'inlineToFileTaskMovePlainCheckboxes', 'settings', 'inlineToFileTaskMovePlainCheckboxes', 'inlineToFileTaskMovePlainCheckboxesDesc', 'toggle', ['convert to file', 'inline task conversion', 'file task conversion', 'plain checkbox', 'checklist', 'move checkboxes']),
	e('automation', 'tasksFileTasks', 'taskCreatorDefaultToFileTask', 'settings', 'taskCreatorDefaultToFileTask', 'taskCreatorDefaultToFileTaskDesc', 'toggle', ['new task', 'task creator', 'file task', 'default file task', 'open as file task']),
	e('automation', 'tasksFileTasks', 'taskCreatorDefaultFileTemplateId', 'settings', 'taskCreatorDefaultFileTemplate', 'taskCreatorDefaultFileTemplateDesc', 'dropdown', ['new task', 'task creator', 'file task', 'template', 'default template', 'file task template']),
	e('automation', 'tasksFileTasks', 'fileTaskTemplateFolder', 'settings', 'fileTaskTemplateFolder', 'fileTaskTemplateFolderDesc', 'folder', ['new task', 'task creator', 'file task', 'template', 'template folder', 'file task template']),
	e('automation', 'tasksFileTasks', 'createDailyNotesAsOperonTask', 'settings', 'createDailyNotesAsOperonTask', 'createDailyNotesAsOperonTaskDesc', 'toggle', ['daily notes', 'file task', 'new task']),
	e('automation', 'tasksFileTasks', 'fileTaskArchiveFolder', 'settings', 'fileTaskArchiveFolder', 'fileTaskArchiveFolderDesc', 'folder', ['file task', 'archive', 'archive folder', 'file task archive']),
	e('automation', 'tasksFileTasks', 'fileTaskArchiveDelaySeconds', 'settings', 'fileTaskArchiveDelaySeconds', 'fileTaskArchiveDelaySecondsDesc', 'number', ['file task', 'archive', 'archive delay', 'file task archive']),
	e('automation', 'tasksFileTasks', 'fileTaskAutoArchiveEnabled', 'settings', 'fileTaskAutoArchiveEnabled', 'fileTaskAutoArchiveEnabledDesc', 'toggle', ['file task', 'archive', 'auto archive', 'file task archive']),
	e('automation', 'tasksFileTasks', 'fileTaskArchiveOnlyFromFileTasksFolder', 'settings', 'fileTaskArchiveOnlyFromFileTasksFolder', 'fileTaskArchiveOnlyFromFileTasksFolderDesc', 'toggle', ['file task', 'archive', 'archive scope', 'file task archive']),
	section('automation', 'tasksFileTasks', 'excludedFolders', 'settings', 'excludedFolders', 'excludedFoldersDesc', ['excluded folders', 'exclude folder', 'global index', 'placeholder normalization', 'template folder']),
	section('automation', 'tasksFileTasks', 'fileTaskMigration', 'settings', 'fileTaskMigrationTitle', 'fileTaskMigrationDesc', ['migration', 'convert notes', 'convert files', 'note conversion', 'frontmatter', 'file task migration']),

	e('automation', 'tasksRelationships', 'estimateAutoReallocation', 'settings', 'estimateAutoReallocation', 'estimateAutoReallocationDesc', 'toggle', ['estimate', 'child tasks', 'task hierarchy', 'relationships']),
	e('automation', 'tasksRelationships', 'autoParentFileTask', 'settings', 'autoParentInlineSubtasks', 'autoParentInlineSubtasksDesc', 'toggle', ['auto parent', 'inline subtasks', 'task hierarchy', 'relationships']),
	e('automation', 'tasksRelationships', 'autoParentLinkedFileSubtasks', 'settings', 'autoParentLinkedFileSubtasks', 'autoParentLinkedFileSubtasksDesc', 'toggle', ['linked file subtasks', 'auto parent', 'task hierarchy', 'relationships']),
	e('automation', 'tasksRelationships', 'childTaskInheritanceStatusPipelineSource', 'settings', 'childTaskInheritanceStatusPipelineSource', 'childTaskInheritanceStatusPipelineSourceDesc', 'dropdown', ['status inheritance', 'parent pipeline', 'default pipeline', 'child task inheritance', 'relationships']),
	section('automation', 'tasksRelationships', 'parentChildTaskInheritance', 'settings', 'parentChildTaskInheritance', 'parentChildTaskInheritanceDesc', ['parent child inheritance', 'child task inheritance', 'inherited fields', 'copy parent fields', 'inherited tags', 'native tags', 'tags', 'relationships']),
	section('automation', 'tasksRelationships', 'projectSerials', 'settings', 'projectSerials', 'projectSerialsDesc', ['project serials', 'serial id', 'visual id', 'prefix', 'task tree serial', 'relationships']),

	e('automation', 'tasksRecurrence', 'newOccurrencePosition', 'settings', 'inlineRepeatPlacement', 'inlineRepeatPlacementDesc', 'dropdown', ['recurring', 'repeat', 'repeat placement', 'next occurrence']),
	e('automation', 'tasksRecurrence', 'fileRepeatDestination', 'settings', 'fileRepeatDestination', 'fileRepeatDestinationDesc', 'dropdown', ['recurring', 'repeat', 'file task', 'occurrence destination']),
	e('automation', 'tasksRecurrence', 'fileRepeatCustomFolder', 'settings', 'fileRepeatCustomFolder', 'fileRepeatCustomFolderDesc', 'folder', ['recurring', 'repeat', 'file task', 'occurrence folder']),
	section('automation', 'tasksRecurrence', 'repeatYamlCleanup', 'settings', 'repeatYamlPropertyRemovalTitle', 'repeatYamlPropertyRemovalDesc', ['recurring', 'repeat', 'frontmatter', 'yaml', 'property cleanup', 'recurring file task']),

	e('automation', 'tasksTracker', 'trackerSplitSessionsAtMidnight', 'settings', 'trackerSplitSessionsAtMidnight', 'trackerSplitSessionsAtMidnightDesc', 'toggle', ['time tracking', 'timer', 'tracker midnight', 'session', 'midnight']),
	e('ui', 'tasksTracker', 'trackerShowStatusBarTimer', 'settings', 'trackerShowStatusBarTimer', 'trackerShowStatusBarTimerDesc', 'toggle', ['time tracking', 'timer', 'status bar', 'TrackTime']),
	e('settings', 'tasksTracker', 'trackerHistoryDays', 'settings', 'trackerHistoryWindowDays', 'trackerHistoryWindowDaysDesc', 'number', ['time tracking', 'timer', 'history', 'history window', 'session history']),
	e('ui', 'tasksTracker', 'trackerTaskDescriptionClickAction', 'settings', 'trackerTaskDescriptionClickAction', 'trackerTaskDescriptionClickActionDesc', 'dropdown', ['time tracking', 'timer', 'task click', 'session history']),
	e('automation', 'tasksTracker', 'flowTimePauseMinutes', 'settings', 'flowTimePauseDuration', 'flowTimePauseDurationDesc', 'dropdown', ['time tracking', 'timer', 'FlowTime pause', 'flow time pause', 'break duration', 'countdown']),
	e('automation', 'tasksTracker', 'flowTimeUseLastSelectedDuration', 'settings', 'flowTimeUseLastSelectedDuration', 'flowTimeUseLastSelectedDurationDesc', 'toggle', ['time tracking', 'timer', 'FlowTime', 'session duration', 'countdown']),
	e('automation', 'tasksTracker', 'flowTimeDefaultSessionMinutes', 'settings', 'flowTimeDefaultSessionMinutes', 'flowTimeDefaultSessionMinutesDesc', 'dropdown', ['time tracking', 'timer', 'FlowTime', 'default session', 'countdown']),
	e('ui', 'tasksTracker', 'flowTimeShowNumericTimer', 'settings', 'flowTimeShowNumericTimer', 'flowTimeShowNumericTimerDesc', 'toggle', ['time tracking', 'timer', 'TrackTime', 'FlowTime', 'numeric timer', 'countdown']),
	e('automation', 'tasksTracker', 'flowTimeNotifyOnTargetReached', 'settings', 'flowTimeNotifyOnTargetReached', 'flowTimeNotifyOnTargetReachedDesc', 'toggle', ['time tracking', 'timer', 'FlowTime', 'notification', 'countdown']),

	e('views', 'viewsCalendar', 'calendarDefaultPresetId', 'calendar', 'defaultPreset', 'defaultPresetDesc', 'dropdown', ['calendar', 'calendar default preset', 'calendar preset', 'preset']),
	e('views', 'viewsCalendar', 'calendarWeekStart', 'calendar', 'weekStart', 'weekStartDesc', 'dropdown', ['calendar', 'week start']),
	e('views', 'viewsCalendar', 'calendarShowWeekLabelOnFirstDay', 'calendar', 'showWeekLabelOnFirstDay', 'showWeekLabelOnFirstDayDesc', 'toggle', ['calendar', 'week label']),
	e('views', 'viewsCalendar', 'calendarDayTitleAction', 'calendar', 'dayTitleAction', 'dayTitleActionDesc', 'dropdown', ['calendar', 'day title action', 'daily note', 'calendar day title', 'date header']),
	e('views', 'viewsCalendar', 'calendarInitialScrollMode', 'calendar', 'initialScrollMode', 'initialScrollModeDesc', 'dropdown', ['calendar', 'calendar initial scroll mode', 'calendar scroll', 'time grid']),
	e('views', 'viewsCalendar', 'calendarAutoScrollPastRatio', 'calendar', 'currentTimePosition', 'currentTimePositionDesc', 'number', ['calendar', 'time grid', 'current time position']),
	e('views', 'viewsCalendar', 'calendarDefaultScrollHour', 'calendar', 'defaultScrollHour', 'defaultScrollHourDesc', 'number', ['calendar', 'time grid', 'default scroll hour']),
	e('views', 'viewsCalendar', 'calendarTimeGridScale', 'calendar', 'timeGridScale', 'timeGridScaleDesc', 'number', ['calendar', 'time grid', 'scale']),
	e('views', 'viewsCalendar', 'calendarTouchTimeGridTaskMoveEnabled', 'calendar', 'touchTimeGridTaskMove', 'touchTimeGridTaskMoveDesc', 'toggle', ['calendar', 'time grid', 'touch', 'drag']),
	e('views', 'viewsCalendar', 'calendarTouchDragLongPressMs', 'calendar', 'touchDragLongPress', 'touchDragLongPressDesc', 'number', ['calendar', 'touch', 'long press', 'drag']),
	e('views', 'viewsCalendar', 'calendarTouchDragCancelDistancePx', 'calendar', 'touchDragCancelDistance', 'touchDragCancelDistanceDesc', 'number', ['calendar', 'touch', 'drag distance']),
	section('views', 'viewsCalendar', 'calendarPresets', 'calendar', 'viewPresets', 'viewPresetsDesc', ['calendar', 'calendar presets', 'calendar preset controls', 'preset controls', 'preset']),
	e('views', 'viewsCalendar', 'calendarSidebarShowWeekNumbers', 'calendar', 'showWeekNumbers', 'showWeekNumbersDesc', 'toggle', ['calendar', 'calendar sidebar week numbers', 'week numbers']),
	e('views', 'viewsCalendar', 'calendarShowAllDayLane', 'calendar', 'showAllDayLane', 'showAllDayLaneDesc', 'toggle', ['calendar', 'calendar all-day lane', 'all-day', 'all day lane']),
	e('views', 'viewsCalendar', 'calendarShowDueMarkers', 'calendar', 'showDueLane', 'showDueLaneDesc', 'toggle', ['calendar', 'due date', 'due markers', 'due lane']),
	e('views', 'viewsCalendar', 'calendarSidebarWidthPx', 'calendar', 'sidebarWidth', 'sidebarWidthDesc', 'number', ['calendar', 'sidebar', 'calendar sidebar width']),
	e('views', 'viewsCalendar', 'calendarSidebarCalendarsDefaultExpanded', 'settings', 'calendarSidebarCalendarsDefaultState', 'calendarSidebarCalendarsDefaultStateDesc', 'dropdown', ['calendar', 'sidebar', 'calendars section']),
	e('views', 'viewsCalendar', 'calendarSidebarTaskPoolDefaultExpanded', 'settings', 'calendarSidebarTaskPoolDefaultState', 'calendarSidebarTaskPoolDefaultStateDesc', 'dropdown', ['calendar', 'sidebar', 'task pool section']),
	e('views', 'viewsCalendar', 'calendarSidebarTaskPoolFollowPresetFilter', 'settings', 'calendarSidebarTaskPoolFollowPresetFilter', 'calendarSidebarTaskPoolFollowPresetFilterDesc', 'toggle', ['calendar', 'sidebar', 'task pool', 'calendar filter', 'preset filter']),
	section('integrations', 'viewsCalendar', 'externalCalendars', 'settings', 'externalCalendarsTitle', 'externalCalendarsDesc', ['calendar', 'ics', 'external calendar', 'external calendars', 'refresh', 'sync']),

	e('views', 'viewsKanban', 'kanbanDefaultPresetId', 'settings', 'kanbanDefaultPreset', 'kanbanDefaultPresetDesc', 'dropdown', ['kanban', 'kanban default preset', 'kanban preset', 'board preset']),
	e('views', 'viewsKanban', 'kanbanExpandedColumnWidthPx', 'settings', 'kanbanExpandedColumnWidth', 'kanbanExpandedColumnWidthDesc', 'number', ['kanban', 'board', 'column', 'kanban column width']),
	e('views', 'viewsKanban', 'kanbanMaxVisibleTasksPerCell', 'settings', 'kanbanSwimlaneMaxHeight', 'kanbanSwimlaneMaxHeightDesc', 'number', ['kanban', 'board', 'swimlane', 'kanban swimlane', 'kanban swimlane task limit']),
	section('views', 'viewsKanban', 'kanbanPresets', 'settings', 'kanbanPresets', 'kanbanPresetsDesc', ['kanban', 'board', 'kanban presets', 'kanban preset controls', 'preset controls', 'swimlane', 'column']),
	section('views', 'viewsFilters', 'filters', 'filterSets', 'userFiltersTitle', 'userFiltersDesc', ['filters', 'user filters', 'saved filters', 'filter view', 'embedded filters', 'conditions', 'match logic', 'sorting']),
	e('views', 'viewsFilters', 'filterShowSubtasks', 'settings', 'filterShowSubtasks', 'filterShowSubtasksDesc', 'toggle', ['filter', 'filter view', 'subtasks']),
	e('views', 'viewsFilters', 'filterShowOnlyOpenSubtasks', 'settings', 'filterShowOnlyOpenSubtasks', 'filterShowOnlyOpenSubtasksDesc', 'toggle', ['filter', 'filter view', 'open subtasks']),
	section('views', 'viewsFilters', 'dynamicFileTaskFilter', 'filterSets', 'dynamicFileTaskFilterTitle', 'dynamicFileTaskFilterDesc', ['dynamic file task filter', 'file task filter', 'automatic filter', 'yaml file task']),
	e('views', 'viewsFilters', 'dynamicFileTaskFilterEnabled', 'settings', 'dynamicFileTaskFilterEnabled', 'dynamicFileTaskFilterEnabledDesc', 'toggle', ['dynamic file task filter', 'automatic file task filter', 'file task']),
	e('views', 'viewsFilters', 'dynamicFileTaskFilterPlacement', 'settings', 'dynamicFileTaskFilterPlacement', 'dynamicFileTaskFilterPlacementDesc', 'dropdown', ['dynamic file task filter', 'placement', 'body top', 'body bottom']),
	e('views', 'viewsFilters', 'dynamicFileTaskFilterSubtaskAutoExpandLimit', 'settings', 'dynamicFileTaskFilterSubtaskAutoExpandLimit', 'dynamicFileTaskFilterSubtaskAutoExpandLimitDesc', 'dropdown', ['dynamic file task filter', 'subtasks', 'expanded subtasks', 'auto expand subtasks']),
	e('views', 'viewsFilters', 'dynamicFileTaskFilterShowOnlyOpenSubtasks', 'settings', 'dynamicFileTaskFilterShowOnlyOpenSubtasks', 'dynamicFileTaskFilterShowOnlyOpenSubtasksDesc', 'toggle', ['dynamic file task filter', 'open subtasks']),
	section('views', 'viewsFilters', 'dynamicSubtasksFilter', 'filterSets', 'dynamicSubtasksFilterTitle', 'dynamicSubtasksFilterDesc', ['dynamic subtasks filter', 'subtasks filter', 'context menu subtasks', 'subtask tree']),
	e('views', 'viewsFilters', 'dynamicSubtasksFilterSubtaskAutoExpandLimit', 'settings', 'dynamicSubtasksFilterSubtaskAutoExpandLimit', 'dynamicSubtasksFilterSubtaskAutoExpandLimitDesc', 'dropdown', ['dynamic subtasks filter', 'subtasks', 'expanded subtasks', 'auto expand subtasks']),
	e('views', 'viewsFilters', 'dynamicSubtasksFilterShowOnlyOpenSubtasks', 'settings', 'dynamicSubtasksFilterShowOnlyOpenSubtasks', 'dynamicSubtasksFilterShowOnlyOpenSubtasksDesc', 'toggle', ['dynamic subtasks filter', 'open subtasks', 'finished subtasks']),

	section('ui', 'interfaceTaskChips', 'taskCreatorToolbar', 'settings', 'taskCreatorToolbarSection', 'taskCreatorToolbarSectionDesc', ['task chips', 'task creator toolbar', 'new operon creator toolbar', 'new operon task toolbar', 'toolbar icons']),
	section('ui', 'interfaceTaskChips', 'inlineTaskChips', 'settings', 'inlineTaskIconsSection', 'inlineTaskIconsSectionDesc', ['task chips', 'inline task chips', 'inline task icons', 'compact chips']),
	section('ui', 'interfaceTaskChips', 'taskFinderChips', 'settings', 'taskFinderIconsSection', 'taskFinderIconsSectionDesc', ['task chips', 'task finder chips', 'task finder icons', 'compact chips']),
	section('ui', 'interfaceTaskChips', 'filterTaskChips', 'settings', 'filterTaskIconsSection', 'filterTaskIconsSectionDesc', ['task chips', 'filter task chips', 'filter task icons', 'filter view chips']),
	e('ui', 'interfaceTaskChips', 'filterTaskShowPlainCheckboxAction', 'settings', 'filterTaskOpenCheckboxAction', 'filterTaskOpenCheckboxActionDesc', 'toggle', ['task chips', 'filter task actions', 'plain checkbox', 'normal checkbox', 'onay kutusu']),
	section('ui', 'interfaceTaskChips', 'fileTaskOverlayChips', 'settings', 'overlayTaskIconsSection', 'overlayTaskIconsSectionDesc', ['task chips', 'file task overlay chips', 'file task overlay icons', 'overlay chips']),
	e('ui', 'interfaceTaskChips', 'overlayTaskShowPlainCheckboxAction', 'settings', 'overlayTaskOpenCheckboxAction', 'overlayTaskOpenCheckboxActionDesc', 'toggle', ['task chips', 'file task overlay actions', 'plain checkbox', 'normal checkbox', 'onay kutusu']),
	e('ui', 'interfacePinnedDock', 'pinnedTasksDesktopSurface', 'settings', 'pinnedTasksDesktopSurface', 'pinnedTasksDesktopSurfaceDesc', 'dropdown', ['pinned', 'pinned tasks', 'pinned tasks desktop display', 'dock', 'sidebar']),
	e('ui', 'interfacePinnedDock', 'pinnedDockColorSource', 'settings', 'pinnedDockTaskColorSource', 'pinnedDockTaskColorSourceDesc', 'dropdown', ['pinned', 'pinned dock', 'pinned task color source']),
	e('ui', 'interfacePinnedDock', 'pinnedDockAutoPin', 'settings', 'pinnedDockAutoPinActiveTimerTask', 'pinnedDockAutoPinActiveTimerTaskDesc', 'toggle', ['pinned', 'pinned dock', 'auto pin', 'timer']),
	e('ui', 'interfacePinnedDock', 'pinnedDockAutoUnpinFinished', 'settings', 'pinnedDockAutoUnpinFinishedTasks', 'pinnedDockAutoUnpinFinishedTasksDesc', 'toggle', ['pinned', 'pinned dock', 'auto unpin', 'finished task']),
	e('ui', 'interfacePinnedDock', 'pinnedDockAutoCloseEnabled', 'settings', 'pinnedDockAutoClose', 'pinnedDockAutoCloseDesc', 'toggle', ['pinned', 'pinned dock', 'auto close']),
	e('ui', 'interfacePinnedDock', 'floatingAutoCloseSec', 'settings', 'pinnedDockAutoCloseDelay', 'pinnedDockAutoCloseDelayDesc', 'number', ['pinned', 'pinned dock', 'pinned dock auto-close delay', 'auto close delay']),
	e('ui', 'interfacePinnedDock', 'pinnedTaskItemWidth', 'settings', 'pinnedDockTaskCardWidth', 'pinnedDockTaskCardWidthDesc', 'number', ['pinned', 'pinned dock', 'task card width']),
	e('ui', 'interfacePinnedDock', 'pinnedDockDisableOnMobile', 'settings', 'pinnedDockDisableOnMobile', 'pinnedDockDisableOnMobileDesc', 'toggle', ['pinned', 'pinned dock', 'mobile pinned dock']),
	e('ui', 'interfacePinnedDock', 'pinnedDockLayout', 'settings', 'pinnedDockLayout', 'pinnedDockLayoutDesc', 'dropdown', ['pinned', 'pinned dock', 'pinned dock layout', 'layout']),
	e('ui', 'interfacePinnedDock', 'pinnedDockGridCols', 'settings', 'pinnedDockGridColumns', 'pinnedDockGridColumnsDesc', 'dropdown', ['pinned', 'pinned dock', 'pinned dock grid columns', 'grid columns']),
	e('ui', 'interfacePinnedDock', 'pinnedTasksSidebarSide', 'settings', 'pinnedTasksSidebarSide', 'pinnedTasksSidebarSideDesc', 'dropdown', ['pinned', 'sidebar', 'sidebar side']),
	e('ui', 'interfaceTaskFinder', 'taskFinderRecentModifiedDays', 'settings', 'taskFinderRecentModifiedDays', 'taskFinderRecentModifiedDaysDesc', 'dropdown', ['task finder', 'recent modified', 'recent tasks']),
	e('ui', 'interfaceTaskFinder', 'taskFinderVisibleResultCount', 'settings', 'taskFinderVisibleResultCount', 'taskFinderVisibleResultCountDesc', 'dropdown', ['task finder', 'visible results', 'result rows']),
	e('ui', 'interfaceTaskFinder', 'taskFinderRememberLastScopes', 'settings', 'taskFinderRememberLastScopes', 'taskFinderRememberLastScopesDesc', 'toggle', ['task finder', 'remember scopes', 'scope buttons']),
	section('ui', 'interfaceTaskFinder', 'taskFinderHotkeys', 'settings', 'taskFinderHotkeysSection', 'taskFinderShortcutsDesc', ['task finder hotkeys', 'task finder shortcuts', 'scope shortcuts', 'dot shortcut']),
	e('ui', 'interfaceContextMenu', 'contextualMenuOpenDelayMs', 'settings', 'contextualMenuOpenDelay', 'contextualMenuOpenDelayDesc', 'number', ['context menu delay', 'contextual menu delay', 'hover delay', 'hover menu open delay']),
	e('ui', 'interfaceContextMenu', 'contextualMenuMobileEnabled', 'settings', 'contextualMenuMobileEnabled', 'contextualMenuMobileEnabledDesc', 'toggle', ['mobile', 'touch', 'context menu', 'long press', 'mobile context menu']),
	e('ui', 'interfaceContextMenu', 'contextualMenuMobileLongPressMs', 'settings', 'contextualMenuMobileLongPress', 'contextualMenuMobileLongPressDesc', 'number', ['mobile', 'touch', 'context menu', 'long press delay']),
	e('ui', 'interfaceContextMenu', 'contextualMenuMobileTransitionGraceMs', 'settings', 'contextualMenuMobileTransitionGrace', 'contextualMenuMobileTransitionGraceDesc', 'number', ['mobile', 'touch', 'context menu', 'grace window', 'transition grace']),
	section('ui', 'interfaceContextMenu', 'contextMenuActions', 'settings', 'contextualMenuActions', 'contextualMenuActionsDesc', ['contextual menu actions', 'context menu actions', 'task actions', 'mark done', 'start timer', 'convert to file', 'convert to inline', 'file task conversion', 'inline task conversion']),
	section('ui', 'interfaceContextMenu', 'contextMenuMatrix', 'settings', 'contextualMenuMatrix', 'contextualMenuMatrixDesc', ['contextual menu matrix', 'context menu matrix', 'surface visibility', 'calendar surfaces', 'hover menu surfaces']),
	e('ui', 'interfaceStateIcons', 'fallbackTaskIconSource', 'settings', 'fallbackTaskIconSource', 'fallbackTaskIconSourceDesc', 'dropdown', ['state icons', 'fallback icons', 'task icon']),
	e('ui', 'interfaceTaskEditor', 'taskEditorShowLineNumbers', 'settings', 'taskEditorShowLineNumbers', 'taskEditorShowLineNumbersDesc', 'toggle', ['task editor', 'line numbers', 'source line numbers', 'file body line numbers']),
	e('ui', 'interfaceTaskEditor', 'taskEditorAutosaveDelaySeconds', 'settings', 'taskEditorAutosaveDelay', 'taskEditorAutosaveDelayDesc', 'dropdown', ['task editor', 'autosave', 'auto save', 'save delay', 'file body autosave']),
	section('ui', 'interfaceTaskEditor', 'taskEditorWorkflowPickers', 'settings', 'taskEditorWorkflowPickers', 'taskEditorWorkflowPickersDesc', ['task editor', 'task editor pickers', 'workflow pickers']),
	section('ui', 'interfaceLocationMap', 'locationPlaceVisualProperties', 'settings', 'locationPlaceVisualPropertiesSection', 'locationPlaceVisualPropertiesSectionDesc', ['location', 'map', 'place note visuals', 'marker icon', 'marker color']),
	e('ui', 'interfaceLocationMap', 'locationPlaceIconPropertyName', 'settings', 'locationPlaceIconPropertyName', 'locationPlaceIconPropertyNameDesc', 'text', ['location', 'map', 'place note icon', 'marker icon', 'icon property']),
	e('ui', 'interfaceLocationMap', 'locationPlaceColorPropertyName', 'settings', 'locationPlaceColorPropertyName', 'locationPlaceColorPropertyNameDesc', 'text', ['location', 'map', 'place note color', 'marker color', 'color property']),
	e('ui', 'interfaceLocationMap', 'locationMapsAlwaysLightMode', 'settings', 'locationMapsAlwaysLightMode', 'locationMapsAlwaysLightModeDesc', 'toggle', ['location', 'map', 'light mode', 'dark mode', 'tiles']),
	e('ui', 'interfaceLocationMap', 'locationPickerMapDefaultCenter', 'settings', 'locationPickerMapDefaultCenter', 'locationPickerMapDefaultCenterDesc', 'text', ['location', 'map picker', 'default center', 'coordinates']),
	e('ui', 'interfaceLocationMap', 'locationPickerMapDefaultZoom', 'settings', 'locationPickerMapDefaultZoom', 'locationPickerMapDefaultZoomDesc', 'number', ['location', 'map picker', 'default zoom']),
	e('ui', 'interfaceLocationMap', 'locationPreviewWidth', 'settings', 'locationPreviewWidth', 'locationPreviewWidthDesc', 'number', ['location', 'map preview', 'preview width']),
	e('ui', 'interfaceLocationMap', 'locationPreviewHeight', 'settings', 'locationPreviewHeight', 'locationPreviewHeightDesc', 'number', ['location', 'map preview', 'preview height']),
	e('ui', 'interfaceLocationMap', 'locationPreviewDefaultZoom', 'settings', 'locationPreviewDefaultZoom', 'locationPreviewDefaultZoomDesc', 'number', ['location', 'map preview', 'preview zoom']),
	e('ui', 'interfaceLocationMap', 'locationPreviewMinZoom', 'settings', 'locationPreviewMinZoom', 'locationPreviewMinZoomDesc', 'number', ['location', 'map preview', 'minimum zoom']),
	e('ui', 'interfaceLocationMap', 'locationPreviewMaxZoom', 'settings', 'locationPreviewMaxZoom', 'locationPreviewMaxZoomDesc', 'number', ['location', 'map preview', 'maximum zoom']),
	e('ui', 'interfaceTweaks', 'workspaceTweaksHideScrollbars', 'settings', 'workspaceTweaksHideScrollbars', 'workspaceTweaksHideScrollbarsDesc', 'toggle', ['tweaks', 'workspace tweaks', 'hide scrollbars', 'scrollbars', 'hider']),
	e('ui', 'interfaceTweaks', 'workspaceTweaksCompactSidebarTabIcons', 'settings', 'workspaceTweaksCompactSidebarTabIcons', 'workspaceTweaksCompactSidebarTabIconsDesc', 'toggle', ['tweaks', 'workspace tweaks', 'compact sidebar', 'sidebar tab icons', 'side dock']),
	e('ui', 'interfaceTweaks', 'workspaceTweaksCollapseProperties', 'settings', 'workspaceTweaksCollapseProperties', 'workspaceTweaksCollapsePropertiesDesc', 'toggle', ['tweaks', 'workspace tweaks', 'properties', 'collapse properties', 'properties collapser']),
	e('ui', 'interfaceTweaks', 'workspaceTweaksPropertiesScope', 'settings', 'workspaceTweaksPropertiesScope', 'workspaceTweaksPropertiesScopeDesc', 'dropdown', ['tweaks', 'workspace tweaks', 'properties scope', 'file task properties', 'all notes']),
	section('ui', 'interfaceTweaks', 'workspaceTweaksPropertiesExcludedFolders', 'settings', 'workspaceTweaksPropertiesExcludedFolders', 'workspaceTweaksPropertiesExcludedFoldersDesc', ['tweaks', 'workspace tweaks', 'excluded folders', 'properties excluded folders', 'keep properties open']),
	section('ui', 'interfaceColorPalette', 'colorPalette', 'settings', 'colorPaletteSection', 'colorPaletteSectionDesc', ['color palette', 'named colors', 'task color picker', 'color picker', 'hex colors', 'palette colors']),

	e('ui', 'mobileGeneral', 'mobileGlobalTaskFabEnabled', 'settings', 'mobileGlobalTaskFabEnabled', 'mobileGlobalTaskFabEnabledDesc', 'toggle', ['mobile', 'phone', 'touch', 'narrow pane', 'quick-create', 'fab', 'mobile quick create']),
	e('ui', 'mobileGeneral', 'mobileGlobalTaskFabHideInCalendar', 'settings', 'mobileGlobalTaskFabHideInCalendar', 'mobileGlobalTaskFabHideInCalendarDesc', 'toggle', ['mobile', 'phone', 'touch', 'quick-create', 'fab', 'calendar']),
	e('ui', 'mobileGeneral', 'mobileGlobalTaskFabHideInKanban', 'settings', 'mobileGlobalTaskFabHideInKanban', 'mobileGlobalTaskFabHideInKanbanDesc', 'toggle', ['mobile', 'phone', 'touch', 'quick-create', 'fab', 'kanban']),
	e('ui', 'mobileGeneral', 'contextualMenuMobileAutoHideMs', 'settings', 'contextualMenuMobileAutoHide', 'contextualMenuMobileAutoHideDesc', 'number', ['mobile', 'phone', 'touch', 'context menu', 'auto hide', 'dismiss delay', 'mobile context menu timeout']),
	section('ui', 'mobileGeneral', 'mobileGlobalTaskFabReset', 'settings', 'mobileGlobalTaskFabResetPosition', 'mobileGlobalTaskFabResetPositionDesc', ['mobile', 'phone', 'touch', 'quick-create', 'fab', 'reset fab position']),
	section('ui', 'mobileTaskEditor', 'taskEditorMobileCoreTools', 'settings', 'taskEditorMobileCoreTools', 'taskEditorMobileCoreToolsDesc', ['mobile', 'phone', 'touch', 'mobile task editor toolbar']),
	e('ui', 'mobileCalendar', 'calendarMobileEnabled', 'settings', 'calendarMobileEnabled', 'calendarMobileEnabledDesc', 'toggle', ['mobile', 'phone', 'touch', 'narrow pane', 'mobile calendar']),
	e('ui', 'mobileCalendar', 'calendarMobileMaxWidthPx', 'settings', 'calendarMobileMaxWidth', 'calendarMobileMaxWidthDesc', 'number', ['mobile', 'phone', 'narrow pane', 'mobile calendar max width']),
	e('ui', 'mobileCalendar', 'calendarMobileDefaultView', 'settings', 'calendarMobileDefaultView', 'calendarMobileDefaultViewDesc', 'dropdown', ['mobile', 'phone', 'mobile calendar view', 'agenda']),
	e('ui', 'mobileCalendar', 'calendarMobileAgendaEnabled', 'settings', 'calendarMobileAgendaEnabled', 'calendarMobileAgendaEnabledDesc', 'toggle', ['mobile', 'phone', 'mobile calendar cycle', 'agenda view', 'enabled views']),
	e('ui', 'mobileCalendar', 'calendarMobileDayEnabled', 'settings', 'calendarMobileDayEnabled', 'calendarMobileDayEnabledDesc', 'toggle', ['mobile', 'phone', 'mobile calendar cycle', 'day view', 'enabled views']),
	e('ui', 'mobileCalendar', 'calendarMobileTwoDayEnabled', 'settings', 'calendarMobileTwoDayEnabled', 'calendarMobileTwoDayEnabledDesc', 'toggle', ['mobile', 'phone', 'mobile calendar cycle', '2 days view', 'enabled views']),
	e('ui', 'mobileCalendar', 'calendarMobileThreeDayEnabled', 'settings', 'calendarMobileThreeDayEnabled', 'calendarMobileThreeDayEnabledDesc', 'toggle', ['mobile', 'phone', 'mobile calendar cycle', '3 days view', 'enabled views']),
	e('ui', 'mobileCalendar', 'calendarMobileAgendaSourcePresetId', 'settings', 'calendarMobileAgendaSourcePreset', 'calendarMobileAgendaSourcePresetDesc', 'dropdown', ['mobile', 'phone', 'mobile agenda preset', 'mobile calendar preset', 'calendar preset']),
	e('ui', 'mobileCalendar', 'calendarMobileDaySourcePresetId', 'settings', 'calendarMobileDaySourcePreset', 'calendarMobileDaySourcePresetDesc', 'dropdown', ['mobile', 'phone', 'mobile day preset', 'mobile calendar preset', 'calendar preset']),
	e('ui', 'mobileCalendar', 'calendarMobileTwoDaySourcePresetId', 'settings', 'calendarMobileTwoDaySourcePreset', 'calendarMobileTwoDaySourcePresetDesc', 'dropdown', ['mobile', 'phone', 'mobile 2 days preset', 'mobile calendar preset', 'calendar preset']),
	e('ui', 'mobileCalendar', 'calendarMobileThreeDaySourcePresetId', 'settings', 'calendarMobileThreeDaySourcePreset', 'calendarMobileThreeDaySourcePresetDesc', 'dropdown', ['mobile', 'phone', 'mobile 3 days preset', 'mobile calendar preset', 'calendar preset']),
	e('ui', 'mobileCalendar', 'calendarMobileSlotMinutes', 'settings', 'calendarMobileSlotMinutes', 'calendarMobileSlotMinutesDesc', 'dropdown', ['mobile', 'phone', 'mobile calendar slot size', 'slot size', 'time grid']),
	e('ui', 'mobileCalendar', 'calendarMobileShowProjectedOccurrences', 'settings', 'calendarMobileShowProjectedOccurrences', 'calendarMobileShowProjectedOccurrencesDesc', 'toggle', ['mobile', 'phone', 'mobile calendar', 'projected occurrences', 'recurring']),
	e('ui', 'mobileCalendar', 'calendarMobileShowExternalCalendars', 'settings', 'calendarMobileShowExternalCalendars', 'calendarMobileShowExternalCalendarsDesc', 'toggle', ['mobile', 'phone', 'mobile calendar', 'external calendar', 'ics']),
	e('ui', 'mobileCalendar', 'calendarMobileColorSource', 'settings', 'calendarMobileColorSource', 'calendarMobileColorSourceDesc', 'dropdown', ['mobile', 'phone', 'mobile calendar', 'color source']),
	e('ui', 'mobileCalendar', 'calendarMobileShowDueMarkers', 'settings', 'calendarMobileShowDueMarkers', 'calendarMobileShowDueMarkersDesc', 'toggle', ['mobile', 'phone', 'mobile calendar due markers', 'due date']),
	e('ui', 'mobileCalendar', 'calendarMobileShowAllDayItems', 'settings', 'calendarMobileShowAllDayItems', 'calendarMobileShowAllDayItemsDesc', 'toggle', ['mobile', 'phone', 'mobile calendar all-day items', 'all-day']),
	e('ui', 'mobileCalendar', 'calendarMobileAgendaPastDays', 'settings', 'calendarMobileAgendaPastDays', 'calendarMobileAgendaPastDaysDesc', 'dropdown', ['mobile', 'phone', 'mobile agenda', 'agenda past days']),
	e('ui', 'mobileCalendar', 'calendarMobileAgendaFutureDays', 'settings', 'calendarMobileAgendaFutureDays', 'calendarMobileAgendaFutureDaysDesc', 'dropdown', ['mobile', 'phone', 'mobile agenda', 'agenda future days']),
	e('ui', 'mobileCalendar', 'calendarMobileAgendaShowCompletedItems', 'settings', 'calendarMobileAgendaShowCompletedItems', 'calendarMobileAgendaShowCompletedItemsDesc', 'toggle', ['mobile', 'phone', 'mobile agenda', 'agenda completed']),
	e('ui', 'mobileCalendar', 'calendarMobileAllDayVisibleTaskLimit', 'settings', 'calendarMobileAllDayVisibleTaskLimit', 'calendarMobileAllDayVisibleTaskLimitDesc', 'dropdown', ['mobile', 'phone', 'mobile calendar all-day visible tasks', 'all-day limit']),
	e('ui', 'mobileCalendar', 'calendarMobileShowCompletedItems', 'settings', 'calendarMobileShowCompletedItems', 'calendarMobileShowCompletedItemsDesc', 'toggle', ['mobile', 'phone', 'mobile calendar completed items', 'completed items']),
	e('ui', 'mobileKanban', 'kanbanMobileLayoutChromeEnabled', 'settings', 'kanbanMobileLayoutChrome', 'kanbanMobileLayoutChromeDesc', 'toggle', ['mobile', 'phone', 'touch', 'narrow pane', 'mobile kanban']),
	e('ui', 'mobileKanban', 'kanbanMobileLayoutMaxWidthPx', 'settings', 'kanbanMobileLayoutMaxWidth', 'kanbanMobileLayoutMaxWidthDesc', 'number', ['mobile', 'phone', 'touch', 'mobile kanban layout max width']),
	e('ui', 'mobileKanban', 'kanbanMobileCompactSwimlaneWidthPx', 'settings', 'kanbanMobileSwimlaneHandleWidth', 'kanbanMobileSwimlaneHandleWidthDesc', 'number', ['mobile', 'phone', 'touch', 'mobile kanban swimlane rail', 'rail']),
	e('ui', 'mobileKanban', 'kanbanMobileSwimlaneRailAlwaysVisible', 'settings', 'kanbanMobileSwimlaneRailAlwaysVisible', 'kanbanMobileSwimlaneRailAlwaysVisibleDesc', 'toggle', ['mobile', 'phone', 'touch', 'mobile kanban swimlane rail', 'rail']),
	e('ui', 'mobileKanban', 'kanbanMobileHorizontalStatusSnapEnabled', 'settings', 'kanbanMobileHorizontalStatusSnap', 'kanbanMobileHorizontalStatusSnapDesc', 'toggle', ['mobile', 'phone', 'touch', 'mobile kanban horizontal status snap', 'snap']),
] as const;
