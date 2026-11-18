import { t } from '../core/i18n';
import type { TaskEditorSectionId } from '../types/task-editor-sections';

export function taskEditorSectionDefaultLabel(id: TaskEditorSectionId): string {
 if (id.startsWith('custom:')) return t('settings', 'taskEditorSectionName');
 if (id === 'stats') return t('settings', 'pipelineColumnStats');
 if (id === 'sessions') return t('taskEditor', 'trackingSessions');
 if (id === 'description' || id === 'notes') return t('taskEditor', id);
 if (id === 'additional') return t('taskEditor', 'groupFile');
 return t('taskEditor', `group${id.charAt(0).toUpperCase()}${id.slice(1)}`);
}
