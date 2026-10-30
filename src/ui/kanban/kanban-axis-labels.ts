import { t } from '../../core/i18n';
import { resolveKanbanAxes } from '../../core/kanban-axis-model';
import type { KanbanPreset } from '../../types/kanban';
import type { OperonSettings } from '../../types/settings';

export function kanbanAxisReason(reason: string): string {
	if (reason === 'pipeline-not-selected') return t('settings', 'kanbanNoPipeline');
	if (reason === 'conflicting-axis-targets') return t('notifications', 'kanbanAxisConflict');
	if (reason === 'list-clear-not-allowed') return t('notifications', 'kanbanAxisListClear');
	if (reason === 'index-not-ready' || reason === 'stale-property-access') return t('settings', 'kanbanAxisPoolPending');
	if (reason === 'source-unavailable') return t('notifications', 'kanbanAxisSourceUnavailable');
	if (reason === 'unresolved-status' || reason === 'unresolved-priority') return t('notifications', 'kanbanAxisUnresolvedValue');
	if (reason === 'type-conflict') return t('notifications', 'kanbanAxisTypeConflict');
	if (reason === 'domain-target-conflict') return t('notifications', 'kanbanAxisDomainConflict');
	return t('notifications', 'kanbanAxesUnavailable');
}

export function kanbanAxisSummary(preset: KanbanPreset, side: 'columns' | 'swimlanes', settings: OperonSettings): string {
	const decoded = resolveKanbanAxes(preset, settings.keyMappings);
	if (!decoded.ok) return kanbanAxisReason(decoded.reason);
	const axis = decoded.axes[side];
	if (!axis) return t('settings', 'kanbanAxisDisabled');
	if (axis.kind === 'status') return settings.pipelines.find(p => p.id === axis.pipelineId)?.name ?? t('settings', 'kanbanNoPipeline');
	const label = settings.keyMappings.find(m => m.canonicalKey === axis.property.key)?.visiblePropertyName || axis.property.key;
	return `${label} · ${axis.values.length || t('settings', 'kanbanAxisAllValues')}`;
}
