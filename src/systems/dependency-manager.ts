/**
 * Dependency manager for Operon tasks.
 * Maintains bidirectional blocking/blockedBy relationships.
 *
 * Write-through model: editing `blocking` on Task A writes `blockedBy` to Task B's file.
 * No sync engine — direct file writes via TaskWriter.
 */

import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';
import { IndexedTask } from '../types/fields';
import {
	DependencyEdgeValidationResult,
	DependencyFieldMutation,
	parseDependencyIdList,
	serializeDependencyIdList,
	validateDependencyEdge,
	validateDependencyMutations,
} from '../core/dependency-graph';
import type { DependencyFieldKey } from '../core/task-field-patch';

interface DependencyChangeOptions {
	validate?: boolean;
}

export class DependencyManager {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	/**
	 * Process a change to a task's blocking or blockedBy field.
	 * Propagates the inverse relationship to all referenced tasks.
	 */
	async processDependencyChange(
		operonId: string,
		field: DependencyFieldKey,
		oldValue: string,
		newValue: string,
		options: DependencyChangeOptions = {},
	): Promise<void> {
		if (options.validate !== false) {
			const validation = this.validateDependencyChange(operonId, field, oldValue, newValue);
			if (!validation.ok) {
				throw new Error(`Invalid dependency edge: ${validation.reason}`);
			}
		}
		const inverseField = field === 'blocking' ? 'blockedBy' : 'blocking';

		const oldIds = new Set(parseDependencyIdList(oldValue));
		const newIds = new Set(parseDependencyIdList(newValue));
		const writes: Array<Promise<void>> = [];

		// IDs added — add inverse on target
		for (const targetId of newIds) {
			if (!oldIds.has(targetId)) {
				writes.push(this.addInverse(targetId, inverseField, operonId));
			}
		}

		// IDs removed — remove inverse from target
		for (const targetId of oldIds) {
			if (!newIds.has(targetId)) {
				writes.push(this.removeInverse(targetId, inverseField, operonId));
			}
		}

		await Promise.all(writes);
	}

	validateDependencyChange(
		operonId: string,
		field: DependencyFieldKey,
		oldValue: string,
		newValue: string,
	): DependencyEdgeValidationResult {
		return this.validateDependencyChanges([{ operonId, field, oldValue, newValue }]);
	}

	validateDependencyChanges(changes: DependencyFieldMutation[]): DependencyEdgeValidationResult {
		const fallbackIds = new Set<string>();
		for (const change of changes) {
			const ownerId = change.operonId.trim();
			if (ownerId) fallbackIds.add(ownerId);
			for (const linkedId of parseDependencyIdList(change.oldValue)) {
				fallbackIds.add(linkedId);
			}
			for (const linkedId of parseDependencyIdList(change.newValue)) {
				fallbackIds.add(linkedId);
			}
		}
		return validateDependencyMutations(changes, this.getAllTasksForValidation(...fallbackIds));
	}

	async reconcileAdditiveInverseLinks(): Promise<number> {
		let writeCount = 0;
		const writes: Array<Promise<void>> = [];
		for (const task of this.getAllTasksForValidation()) {
			if (this.hasDuplicateOperonIdConflict(task.operonId)) continue;
			for (const targetId of parseDependencyIdList(task.fieldValues['blocking'])) {
				if (this.hasDuplicateOperonIdConflict(targetId)) continue;
				const target = this.indexer.getTask(targetId);
				if (!target) continue;
				if (parseDependencyIdList(target.fieldValues['blockedBy']).includes(task.operonId)) continue;
				if (!this.canRepairAssertedEdge(task.operonId, targetId)) continue;
				writeCount += 1;
				writes.push(this.addInverse(targetId, 'blockedBy', task.operonId));
			}
			for (const sourceId of parseDependencyIdList(task.fieldValues['blockedBy'])) {
				if (this.hasDuplicateOperonIdConflict(sourceId)) continue;
				const source = this.indexer.getTask(sourceId);
				if (!source) continue;
				if (parseDependencyIdList(source.fieldValues['blocking']).includes(task.operonId)) continue;
				if (!this.canRepairAssertedEdge(sourceId, task.operonId)) continue;
				writeCount += 1;
				writes.push(this.addInverse(sourceId, 'blocking', task.operonId));
			}
		}
		await Promise.all(writes);
		return writeCount;
	}

	/**
	 * Add operonId to target task's inverse field.
	 */
	private async addInverse(targetId: string, field: DependencyFieldKey, sourceId: string): Promise<void> {
		if (this.hasDuplicateOperonIdConflict(targetId)) return;
		const task = this.indexer.getTask(targetId);
		if (!task) return;

		const currentList = parseDependencyIdList(task.fieldValues[field] ?? '');
		if (currentList.includes(sourceId)) return; // Already present

		currentList.push(sourceId);
		const newValue = serializeDependencyIdList(currentList);

		// Update index immediately
		task.fieldValues[field] = newValue;

		// Write directly to target task's file
		const now = localNow();
		task.fieldValues['datetimeModified'] = now;
		task.datetimeModified = now;
		await this.writer.writeTaskFields(targetId, {
			[field]: newValue,
			datetimeModified: now,
		});
	}

	/**
	 * Remove operonId from target task's inverse field.
	 */
	private async removeInverse(targetId: string, field: DependencyFieldKey, sourceId: string): Promise<void> {
		if (this.hasDuplicateOperonIdConflict(targetId)) return;
		const task = this.indexer.getTask(targetId);
		if (!task) return;

		const currentList = parseDependencyIdList(task.fieldValues[field] ?? '');
		const filtered = currentList.filter(id => id !== sourceId);

		if (filtered.length === currentList.length) return; // Not present

		const newValue = serializeDependencyIdList(filtered);

		// Update index immediately
		if (newValue) {
			task.fieldValues[field] = newValue;
		} else {
			delete task.fieldValues[field];
		}

		// Write directly to target task's file
		const now = localNow();
		task.fieldValues['datetimeModified'] = now;
		task.datetimeModified = now;
		const updates: Record<string, string> = {
			[field]: newValue,
			datetimeModified: now,
		};
		await this.writer.writeTaskFields(targetId, updates);
	}

	/**
	 * Clean up all dependency references when a task is deleted.
	 */
	async cleanupDeletedTask(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task) return;
		const writes: Array<Promise<void>> = [];

		const blockingIds = parseDependencyIdList(task.fieldValues['blocking'] ?? '');
		for (const targetId of blockingIds) {
			writes.push(this.removeInverse(targetId, 'blockedBy', operonId));
		}

		const blockedByIds = parseDependencyIdList(task.fieldValues['blockedBy'] ?? '');
		for (const targetId of blockedByIds) {
			writes.push(this.removeInverse(targetId, 'blocking', operonId));
		}
		await Promise.all(writes);
	}

	private getAllTasksForValidation(...fallbackIds: string[]): IndexedTask[] {
		const indexer = this.indexer as OperonIndexer & { getAllTasks?: () => IndexedTask[] };
		if (typeof indexer.getAllTasks === 'function') {
			return indexer.getAllTasks();
		}
		const tasks: IndexedTask[] = [];
		for (const fallbackId of fallbackIds) {
			const task = this.indexer.getTask(fallbackId);
			if (task) tasks.push(task);
		}
		return tasks;
	}

	private canRepairAssertedEdge(fromId: string, toId: string): boolean {
		const validation = validateDependencyEdge(fromId, toId, this.getAllTasksForValidation(fromId, toId));
		if (validation.ok) return true;
		console.warn('Operon: skipped invalid dependency reconcile', {
			reason: validation.reason,
			fromId: validation.fromId,
			toId: validation.toId,
			cyclePath: validation.cyclePath,
		});
		return false;
	}

	private hasDuplicateOperonIdConflict(operonId: string): boolean {
		const indexer = this.indexer as OperonIndexer & { hasDuplicateOperonIdConflict?: (id: string) => boolean };
		return typeof indexer.hasDuplicateOperonIdConflict === 'function'
			&& indexer.hasDuplicateOperonIdConflict(operonId);
	}
}
