import type { OperonSettings } from '../types/settings';
import { normalizeTaskFieldColor } from './task-color-source';

export type WorkflowColorRef = { kind: 'priority'; priorityId: string } | { kind: 'status'; pipelineId: string; statusId: string };
export interface WorkflowColorChange { ref: WorkflowColorRef; expected: string; next: string }
export type WorkflowColorSettings = Pick<OperonSettings, 'priorities' | 'pipelines'>;
export function workflowColorKey(ref: WorkflowColorRef): string {
 return JSON.stringify(ref.kind === 'priority' ? [ref.kind, ref.priorityId] : [ref.kind, ref.pipelineId, ref.statusId]);
}
export function workflowColorDefinition(settings: WorkflowColorSettings, ref: WorkflowColorRef): { color: string } | null {
 if (ref.kind === 'priority') { const matches = settings.priorities.filter(item => item.id === ref.priorityId); return matches.length === 1 ? matches[0] : null; }
 const pipelines = settings.pipelines.filter(item => item.id === ref.pipelineId);
 const matches = pipelines.length === 1 ? pipelines[0].statuses.filter(item => item.id === ref.statusId) : [];
 return matches.length === 1 ? matches[0] : null;
}
export function workflowColor(settings: WorkflowColorSettings, ref: WorkflowColorRef): string | null {
 const value = workflowColorDefinition(settings, ref)?.color;
 return value ? normalizeTaskFieldColor(value)?.toLowerCase() ?? null : null;
}
