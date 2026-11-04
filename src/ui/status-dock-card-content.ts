import type { IndexedTask } from '../types/fields';
import type { TrackerSession } from '../types/tracker';
import { resolveStatusDockClickAction, type OperonSettings } from '../types/settings';
import { t } from '../core/i18n';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { formatDurationHuman } from '../systems/tracker-utils';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

export function statusDockSessionKey(session: TrackerSession): string {
 return JSON.stringify([session.operonId, session.start, session.end, session.sessionIndex]);
}

export function renderStatusDockTaskTitle(name: HTMLElement, task: IndexedTask, settings: OperonSettings): void {
 cleanupOperonHoverTooltips(name);
 name.empty(); renderCompactTaskMarkdown(name, {value: task.description || task.operonId, mode: 'visual-only'});
 const behavior = resolveStatusDockClickAction(settings.statusDockClickAction);
 const label = t('settings', behavior === 'source' ? 'taskFinderResultSourceOnly' : behavior === 'editor' ? 'taskFinderResultEditorOnly' : 'taskFinderResultSourceAndEditor');
 setAccessibleLabelWithoutTooltip(name, `${label}: ${task.description || task.operonId}`);
}

export function renderStatusDockSessionDuration(duration: HTMLElement, session: TrackerSession, placement: () => 'auto' | 'above'): void {
 const value = formatDurationHuman(session.durationSeconds, 'seconds');
 duration.setText(value);
 setAccessibleLabelWithoutTooltip(duration, `${t('taskEditor', 'editSession')}: ${value}`);
 cleanupOperonHoverTooltips(duration);
 bindOperonHoverTooltip(duration, {get preferredVertical() {return placement();}, title: t('taskEditor', 'editSession'),
  content: session.task.description, taskColor: normalizeTaskFieldColor(session.task.fieldValues['taskColor'])});
}
