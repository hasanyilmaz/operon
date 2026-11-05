import type { IndexedTask } from '../../types/fields';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../../core/vault-property-codec';
import type { KanbanCellPlanResult } from '../../systems/kanban-cell-actions';
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

/** Describe the existing cell plan without preparing or writing another mutation. */
export function kanbanCellPlanPreview(plan: KanbanCellPlanResult, settings: Pick<OperonSettings, 'keyMappings'>, manual: boolean, task: Pick<IndexedTask, 'checkbox'>): string {
 if (plan.state === 'blocked') return kanbanAxisReason(plan.reason);
 const lines: string[] = [];
 const handled = new Set<string>();
 const display = (value: VaultPropertyValue | undefined): string => value === undefined || value === null || value === '' ? '—'
  : Array.isArray(value) ? encodeVaultPropertyValue(value, 'list') : String(value);
 if (plan.state !== 'noop') {
  for (const requirement of plan.requirements) {
   const { field, value } = requirement;
   const key = field.reference.source === 'managed' && field.reference.key === 'description' ? '_description'
    : field.reference.source === 'managed' && field.reference.key === 'tags' ? '_tags' : field.reference.key;
   if (field.encoding === 'legacy') handled.add(key);
   const before = requirement.target?.expected.value;
   if (Array.isArray(value)) {
    const previous = Array.isArray(before) ? before : [];
    const added = value.filter(item => !previous.includes(item));
    if (added.length) lines.push(`${field.label}: ${added.map(item => `+${encodeVaultPropertyValue([item], 'list')}`).join('; ')}`);
   } else if (display(before) !== display(value)) lines.push(`${field.label}: ${display(before)} → ${display(value)}`);
  }
  // Include status consequences (checkbox/completion/cancellation dates), once each.
  for (const [key, after] of Object.entries(plan.payload)) {
   if (handled.has(key) || key === 'datetimeModified') continue;
   const before = key === '_checkbox' ? task.checkbox : plan.expectedFieldValues[key] ?? '';
   if (before === after) continue;
   const checkbox = key === '_checkbox';
   const label = checkbox ? t('filterSets', 'fieldCheckbox') : settings.keyMappings.find(mapping => mapping.canonicalKey === key)?.visiblePropertyName || key;
   const state = (value: string) => value === 'done' ? '[x]' : value === 'cancelled' ? '[-]' : '[ ]';
   lines.push(`${label}: ${checkbox ? state(before) : display(before)} → ${checkbox ? state(after) : display(after)}`);
  }
 }
 if (!lines.length) lines.push(t('settings', 'kanbanTaskPoolNoFieldChanges'));
 if (manual) lines.push(t('settings', 'kanbanTaskPoolManualPosition'));
 return lines.join('\n');
}
