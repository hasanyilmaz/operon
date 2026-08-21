import type { IndexedTask } from '../types/fields';
import type {
	PeriodicNoteContainerRegistryBackfillResult,
	PeriodicNoteContainerRegistryEntryV1,
} from '../storage/periodic-note-container-registry';
import {
	classifyPeriodicFileTask,
	type PeriodicParentConfig,
} from './periodic-note-parent-realignment';

export type PeriodicNoteContainerStartupBackfillStatus =
	| 'completed'
	| 'registry-unhealthy'
	| 'clean-failure'
	| 'uncertain';

export interface PeriodicNoteContainerStartupBackfillResult {
	status: PeriodicNoteContainerStartupBackfillStatus;
	added: number;
	conflicted: number;
}

export interface PeriodicNoteContainerStartupBackfillPorts {
	isRegistryHealthy(): boolean;
	resolveConfigs(): Promise<readonly PeriodicParentConfig[]>;
	getAllTasks(): readonly IndexedTask[];
	hasDuplicateOperonIdConflict(operonId: string): boolean;
	getFileTaskByPath(path: string): IndexedTask | null;
	backfillRegistry(entries: readonly PeriodicNoteContainerRegistryEntryV1[]): Promise<PeriodicNoteContainerRegistryBackfillResult>;
	markPipelineReconciliationReady(): void;
	resumePipelineReconciliation(): void | Promise<void>;
}

/**
 * Performs authoritative index adoption before the pipeline mover is allowed
 * to resume. The ordering is intentionally executable rather than implicit in
 * plugin startup wiring.
 */
export async function backfillPeriodicNoteContainersBeforePipelineResume(
	ports: PeriodicNoteContainerStartupBackfillPorts,
): Promise<PeriodicNoteContainerStartupBackfillResult> {
	const result = await backfillPeriodicNoteContainers(ports);
	if (result.status === 'completed') {
		ports.markPipelineReconciliationReady();
		await ports.resumePipelineReconciliation();
	}
	return result;
}

export async function backfillPeriodicNoteContainers(
	ports: Omit<PeriodicNoteContainerStartupBackfillPorts, 'resumePipelineReconciliation'>,
): Promise<PeriodicNoteContainerStartupBackfillResult> {
	if (!ports.isRegistryHealthy()) {
		return { status: 'registry-unhealthy', added: 0, conflicted: 0 };
	}
	const configs = await ports.resolveConfigs();
	const candidates: PeriodicNoteContainerRegistryEntryV1[] = [];
	for (const task of ports.getAllTasks()) {
		if (task.primary.format !== 'yaml') continue;
		if (ports.hasDuplicateOperonIdConflict(task.operonId)) continue;
		const indexedAtPath = ports.getFileTaskByPath(task.primary.filePath);
		if (!indexedAtPath || indexedAtPath.operonId !== task.operonId) continue;
		const classification = classifyPeriodicFileTask(task, configs);
		if (classification.kind === 'periodic') {
			candidates.push({
				operonId: task.operonId,
				kind: classification.periodicKind,
				lastKnownPath: task.primary.filePath,
				anchorDateKey: classification.anchorDateKey,
				...(classification.source ? { source: classification.source } : {}),
			});
		} else if (classification.kind === 'ambiguous') {
			candidates.push({
				operonId: task.operonId,
				kind: 'ambiguous',
				lastKnownPath: task.primary.filePath,
			});
		}
	}
	const backfill = await ports.backfillRegistry(candidates);
	return {
		status: backfill.persistence.status === 'committed'
			? 'completed'
			: backfill.persistence.status,
		added: backfill.added,
		conflicted: backfill.conflicted,
	};
}
