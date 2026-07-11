import type { IndexedTask } from '../types/fields';
import type { Pipeline } from '../types/pipeline';
import { resolveWorkflowStatus } from '../types/pipeline';
import type { WorkflowStatusIdentityIndex } from './workflow-status-identity';

export function shouldAutoUnpinTerminalTask(
	task: IndexedTask,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): boolean {
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) return workflow.checkbox !== 'open';
	if (task.checkbox === 'done' || task.checkbox === 'cancelled') {
		return true;
	}
	return (task.fieldValues['dateCompleted'] ?? '').trim().length > 0
		|| (task.fieldValues['dateCancelled'] ?? '').trim().length > 0;
}
