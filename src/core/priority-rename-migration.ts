import { IndexedTask } from '../types/fields';
import { PriorityDefinition } from '../types/priority';
import {
	FieldRenameAffectedTask,
	FieldRenameExecutionResult,
	FieldRenameProgressSnapshot,
	FieldRenamePreview,
	buildFieldRenamePreview,
	executeFieldRenamePreview,
} from './field-rename-migration';

export interface PriorityRenameOperation {
	priorityId: string;
	oldValue: string;
	newValue: string;
	oldPriorityLabel: string;
	newPriorityLabel: string;
}

export interface PriorityRenamePlan {
	operations: PriorityRenameOperation[];
}

export interface PriorityRenameAffectedTask {
	operonId: string;
	filePath: string;
	format: 'inline' | 'yaml';
	oldPriorityValue: string;
	newPriorityValue: string;
}

export interface PriorityRenamePreview {
	plan: PriorityRenamePlan;
	affectedTasks: PriorityRenameAffectedTask[];
	fileTaskCount: number;
	inlineTaskCount: number;
	touchedFileCount: number;
	totalTaskCount: number;
}

export type PriorityRenameExecutionResult = FieldRenameExecutionResult;

export type PriorityRenameProgressSnapshot = FieldRenameProgressSnapshot;

export interface PriorityRenamePreviewSource {
	secondary: {
		getTaskIdsByPriority(priorityValue: string): Set<string>;
	};
	getTask(operonId: string): IndexedTask | undefined;
}

export interface PriorityRenameExecutionDeps {
		writer: {
			writeTaskFields(
				operonId: string,
				fieldValues: Record<string, string>,
				options?: { mode?: 'merge' | 'replace'; reindex?: 'scheduled' | 'none' },
			): Promise<boolean | void>;
		};
	indexer: {
		reindexFilesBatch(filePaths: string[]): Promise<void>;
	};
	onProgress?: (snapshot: PriorityRenameProgressSnapshot) => void;
}

export function buildPriorityRenamePlan(
	oldPriorities: PriorityDefinition[],
	newPriorities: PriorityDefinition[],
): PriorityRenamePlan {
	const oldPrioritiesById = new Map(oldPriorities.map(priority => [priority.id, priority]));
	const operations: PriorityRenameOperation[] = [];

	for (const nextPriority of newPriorities) {
		const previousPriority = oldPrioritiesById.get(nextPriority.id);
		if (!previousPriority) continue;
		if (previousPriority.label === nextPriority.label) continue;

		operations.push({
			priorityId: nextPriority.id,
			oldValue: previousPriority.label,
			newValue: nextPriority.label,
			oldPriorityLabel: previousPriority.label,
			newPriorityLabel: nextPriority.label,
		});
	}

	return { operations };
}

export function collectPriorityRenamePreview(
	source: PriorityRenamePreviewSource,
	plan: PriorityRenamePlan,
): PriorityRenamePreview {
	const affectedTasksById = new Map<string, FieldRenameAffectedTask>();

	for (const operation of plan.operations) {
		for (const operonId of source.secondary.getTaskIdsByPriority(operation.oldValue)) {
			if (affectedTasksById.has(operonId)) continue;
			const task = source.getTask(operonId);
			if (!task) continue;

			affectedTasksById.set(operonId, {
				operonId,
				filePath: task.primary.filePath,
				format: task.primary.format,
				oldValue: operation.oldValue,
				newValue: operation.newValue,
			});
		}
	}

	return toPriorityRenamePreview(buildFieldRenamePreview(plan, affectedTasksById));
}

export function applyPriorityRenamePlanToDefaultPriority(
	defaultPriority: string,
	plan: PriorityRenamePlan,
): string {
	if (!defaultPriority) return defaultPriority;
	const operation = plan.operations.find(candidate => candidate.oldValue === defaultPriority);
	return operation ? operation.newValue : defaultPriority;
}

export async function executePriorityRenamePreview(
	preview: PriorityRenamePreview,
	deps: PriorityRenameExecutionDeps,
): Promise<PriorityRenameExecutionResult> {
	return executeFieldRenamePreview(fromPriorityRenamePreview(preview), {
		...deps,
		fieldName: 'priority',
		logLabel: 'priority',
	});
}

function toPriorityRenamePreview(preview: FieldRenamePreview<PriorityRenamePlan>): PriorityRenamePreview {
	return {
		...preview,
		affectedTasks: preview.affectedTasks.map(task => ({
			operonId: task.operonId,
			filePath: task.filePath,
			format: task.format,
			oldPriorityValue: task.oldValue,
			newPriorityValue: task.newValue,
		})),
	};
}

function fromPriorityRenamePreview(preview: PriorityRenamePreview): FieldRenamePreview<PriorityRenamePlan> {
	return {
		...preview,
		affectedTasks: preview.affectedTasks.map(task => ({
			operonId: task.operonId,
			filePath: task.filePath,
			format: task.format,
			oldValue: task.oldPriorityValue,
			newValue: task.newPriorityValue,
		})),
	};
}
