import { resolveEffectiveInlineTaskSaveMode } from '../../../core/inline-task-save-mode';
import type { OperonSettings } from '../../../types/settings';
import type { FileTaskTemplateOption } from '../../../core/file-task-templates';
import type { PeriodicNoteConfigResolution } from '../../../core/periodic-note-config';
import { DEFAULT_INLINE_TASK_TARGET_FILE, normalizeInlineTaskHeadingKeyword, normalizeInlineTaskParentFileHeadingKeyword } from '../../../types/settings';
import type { PeriodicCreationPolicyV1, TaskCreationPolicyV1 } from './contracts';

export function projectPeriodicCreationPolicyV1(kind: 'daily' | 'weekly', resolution: PeriodicNoteConfigResolution): PeriodicCreationPolicyV1 {
 if (!resolution.available) return { kind, available: false, reason: resolution.reason, source: resolution.source ?? null, config: null };
 const { source, folder, format, template, createAsOperonTask } = resolution.config;
 return { kind, available: true, reason: null, source, config: { folder, format, template, createAsOperonTask } };
}
/** Pure projection. The host supplies the same resolved periodic configuration used by creation. */
export function buildTaskCreationPolicyV1(settings: Readonly<OperonSettings>, templates: readonly FileTaskTemplateOption[], daily: PeriodicNoteConfigResolution, weekly: PeriodicNoteConfigResolution): TaskCreationPolicyV1 {
 const configuredSaveMode = settings.inlineTaskSaveMode ?? (settings.inlineTaskUseDailyNote ? 'daily-notes' : 'specific-file');
 const saveMode = resolveEffectiveInlineTaskSaveMode(settings, daily.available || daily.reason === 'invalid-config');
 return {
  defaultRepresentation: settings.taskCreatorDefaultToFileTask ? 'file' : 'inline',
  inline: {
   configuredSaveMode, saveMode, requiresExplicitTarget: saveMode === 'active-file' || saveMode === 'ask-every-time',
   targetFile: settings.inlineTaskTargetFile.trim() || DEFAULT_INLINE_TASK_TARGET_FILE,
   heading: normalizeInlineTaskHeadingKeyword(settings.inlineTaskHeading),
   parentInline: settings.inlineTaskParentInlineTargetMode, parentFile: settings.inlineTaskParentFileTargetMode,
   parentFileHeading: normalizeInlineTaskParentFileHeadingKeyword(settings.inlineTaskParentFileHeadingKeyword),
   dailyAddsStartDate: settings.inlineTaskDailyNoteAddStartDate, dailyAddsScheduledDate: settings.inlineTaskDailyNoteAddScheduledDate,
  },
  file: {
   folder: settings.fileTasksFolder,
   pipelineLocations: settings.fileTaskPipelineLocations.map(rule => ({ pipelineId: rule.pipelineId, folder: rule.folder })),
   parentInline: settings.fileTaskParentInlineTargetMode, parentFile: settings.fileTaskParentFileTargetMode,
   displayTitleEnabled: settings.fileTaskDisplayTitleEnabled, titleChangeMode: settings.fileTaskDisplayTitleChangeMode,
   filenameFormat: settings.fileTaskFilenameRule.preset,
  },
  periodic: { daily: projectPeriodicCreationPolicyV1('daily', daily), weekly: projectPeriodicCreationPolicyV1('weekly', weekly) },
  templates: {
   defaultInlineId: settings.defaultInlineTaskTemplateId, defaultFileId: settings.taskCreatorDefaultFileTemplateId,
   candidates: templates.map(t => ({ id: t.id, name: t.name, kind: t.kind, sourcePath: t.path })),
   execution: 'deterministic-only', inlineContent: 'properties-only', remembersLastSelection: false,
  },
  exclusions: [...new Set([...settings.excludedFolders, settings.fileTaskTemplateFolder].filter(folder => folder.trim().length > 0))],
  limits: { tasksPerRequest: 1, activeFile: 'explicit-target-required', templater: 'not-executed' },
 };
}
