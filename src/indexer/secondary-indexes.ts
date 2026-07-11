/**
 * Secondary indexes for fast task queries.
 * Rebuilt from primary index on each update.
 *
 * Architecture doc Section 3.4:
 * - by-status:  Map<status, Set<operonId>>
 * - by-due:     sorted array for date range queries
 * - by-parent:  Map<parentId, Set<childId>> for hierarchy queries
 * - by-file:    Map<filePath, Set<operonId>> for reverse lookup
 *
 * Performance targets (Architecture doc Section 4.3):
 * - Open tasks query: < 50ms (hot tier scan)
 * - Due this week: < 50ms (secondary index by-due)
 * - Project subtasks: < 100ms (secondary index by-parent)
 */

import { IndexedTask } from '../types/fields';
import { localToday, toLocalDate } from '../core/local-time';
import { normalizePriorityValue } from '../core/priority-rank';

/** A due-date entry for sorted date range queries */
interface DueEntry {
	operonId: string;
	dateDue: string; // YYYY-MM-DD
}

export class SecondaryIndexes {
	/** Tasks grouped by checkbox state */
	byStatus: Map<string, Set<string>> = new Map();

	/** Tasks with due dates, sorted ascending */
	byDue: DueEntry[] = [];

	/** Parent → children mapping via parentTask field */
	byParent: Map<string, Set<string>> = new Map();

	/** File path → operonIds in that file */
	byFile: Map<string, Set<string>> = new Map();

	/** Tasks grouped by pipeline.status value */
	byWorkflowStatus: Map<string, Set<string>> = new Map();

	/** Tasks grouped by priority value */
	byPriority: Map<string, Set<string>> = new Map();

	/**
	 * Rebuild all secondary indexes from the primary task map.
	 * Called after any index mutation.
	 */
	rebuild(tasks: Map<string, IndexedTask>): void {
		this.byStatus.clear();
		this.byDue = [];
		this.byParent.clear();
		this.byFile.clear();
		this.byWorkflowStatus.clear();
		this.byPriority.clear();

		for (const task of tasks.values()) {
			const id = task.operonId;

			// By checkbox status
			this.addToSetMap(this.byStatus, task.checkbox, id);

			// By due date
			const due = task.fieldValues['dateDue'];
			if (due) {
				this.byDue.push({ operonId: id, dateDue: due });
			}

			// By parent task
			const parentId = task.fieldValues['parentTask'];
			if (parentId) {
				this.addToSetMap(this.byParent, parentId, id);
			}

			// By file (primary location)
			this.addToSetMap(this.byFile, task.primary.filePath, id);

			// By workflow status
			const status = task.fieldValues['status'];
			if (status) {
				this.addToSetMap(this.byWorkflowStatus, status, id);
			}

			// By priority (lenient key: trim + lowercase, see priority-rank)
			const priority = task.fieldValues['priority'];
			if (priority) {
				this.addToSetMap(this.byPriority, normalizePriorityValue(priority), id);
			}
		}

		// Sort due dates ascending for range queries
		this.byDue.sort((a, b) => a.dateDue.localeCompare(b.dateDue));
	}

	applyTaskDeltas(deltas: Array<{ before?: IndexedTask; after?: IndexedTask }>): void {
		let touchedDue = false;
		for (const delta of deltas) {
			if (delta.before) {
				this.removeTask(delta.before);
				if (delta.before.fieldValues['dateDue']) touchedDue = true;
			}
			if (delta.after) {
				this.addTask(delta.after);
				if (delta.after.fieldValues['dateDue']) touchedDue = true;
			}
		}
		if (touchedDue) {
			this.byDue.sort((a, b) => a.dateDue.localeCompare(b.dateDue));
		}
	}

	// --- Query Methods ---

	/**
	 * Get all open tasks (checkbox = 'open').
	 * Performance: O(1) lookup + set iteration.
	 */
	getOpenTaskIds(): Set<string> {
		return this.byStatus.get('open') ?? new Set();
	}

	/**
	 * Get tasks due within a date range (inclusive).
	 * Uses binary search on sorted byDue array.
	 * Performance: O(log n + k) where k = result count.
	 */
	getTasksDueInRange(startDate: string, endDate: string): string[] {
		const result: string[] = [];

		// Binary search for start position
		let lo = 0;
		let hi = this.byDue.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (this.byDue[mid].dateDue < startDate) lo = mid + 1;
			else hi = mid;
		}

		// Collect entries in range
		for (let i = lo; i < this.byDue.length; i++) {
			if (this.byDue[i].dateDue > endDate) break;
			result.push(this.byDue[i].operonId);
		}

		return result;
	}

	/**
	 * Get tasks due today.
	 */
	getTasksDueToday(): string[] {
		const today = localToday();
		return this.getTasksDueInRange(today, today);
	}

	/**
	 * Get tasks due this week (next 7 days).
	 */
	getTasksDueThisWeek(): string[] {
		const today = new Date();
		const weekEnd = new Date(today);
		weekEnd.setDate(weekEnd.getDate() + 7);
		return this.getTasksDueInRange(
			toLocalDate(today),
			toLocalDate(weekEnd)
		);
	}

	/**
	 * Get all children of a parent task.
	 * Performance: O(1) Map lookup.
	 */
	getChildIds(parentOperonId: string): Set<string> {
		return this.byParent.get(parentOperonId) ?? new Set();
	}

	/**
	 * Get all descendant IDs (recursive children, grandchildren, etc.).
	 */
	getAllDescendantIds(parentOperonId: string): Set<string> {
		const descendants = new Set<string>();
		const stack = [parentOperonId];

		while (stack.length > 0) {
			const current = stack.pop()!;
			const children = this.byParent.get(current);
			if (children) {
				for (const child of children) {
					if (!descendants.has(child)) {
						descendants.add(child);
						stack.push(child);
					}
				}
			}
		}

		return descendants;
	}

	/**
	 * Get all task IDs in a specific file.
	 */
	getTasksInFile(filePath: string): Set<string> {
		return this.byFile.get(filePath) ?? new Set();
	}

	/**
	 * Get all task IDs for a canonical workflow status value.
	 */
	getTaskIdsByWorkflowStatus(statusValue: string): Set<string> {
		return this.byWorkflowStatus.get(statusValue) ?? new Set();
	}

	/**
	 * Get all task IDs for a priority value.
	 */
	getTaskIdsByPriority(priorityValue: string): Set<string> {
		return this.byPriority.get(normalizePriorityValue(priorityValue)) ?? new Set();
	}

	/**
	 * Get overdue tasks (due before today, still open).
	 */
	getOverdueTaskIds(): string[] {
		const today = localToday();
		const openIds = this.getOpenTaskIds();
		const result: string[] = [];

		for (const entry of this.byDue) {
			if (entry.dateDue >= today) break;
			if (openIds.has(entry.operonId)) {
				result.push(entry.operonId);
			}
		}

		return result;
	}

	/**
	 * Clear all secondary indexes.
	 */
	clear(): void {
		this.byStatus.clear();
		this.byDue = [];
		this.byParent.clear();
		this.byFile.clear();
		this.byWorkflowStatus.clear();
		this.byPriority.clear();
	}

	// --- Helpers ---

	private addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
		let set = map.get(key);
		if (!set) {
			set = new Set();
			map.set(key, set);
		}
		set.add(value);
	}

	private addTask(task: IndexedTask): void {
		const id = task.operonId;
		this.addToSetMap(this.byStatus, task.checkbox, id);
		const due = task.fieldValues['dateDue'];
		if (due) this.byDue.push({ operonId: id, dateDue: due });
		const parentId = task.fieldValues['parentTask'];
		if (parentId) this.addToSetMap(this.byParent, parentId, id);
		this.addToSetMap(this.byFile, task.primary.filePath, id);
		const status = task.fieldValues['status'];
		if (status) this.addToSetMap(this.byWorkflowStatus, status, id);
		const priority = task.fieldValues['priority'];
		if (priority) this.addToSetMap(this.byPriority, normalizePriorityValue(priority), id);
	}

	private removeTask(task: IndexedTask): void {
		const id = task.operonId;
		this.removeFromSetMap(this.byStatus, task.checkbox, id);
		this.byDue = this.byDue.filter(entry => entry.operonId !== id);
		const parentId = task.fieldValues['parentTask'];
		if (parentId) this.removeFromSetMap(this.byParent, parentId, id);
		this.removeFromSetMap(this.byFile, task.primary.filePath, id);
		const status = task.fieldValues['status'];
		if (status) this.removeFromSetMap(this.byWorkflowStatus, status, id);
		const priority = task.fieldValues['priority'];
		if (priority) this.removeFromSetMap(this.byPriority, normalizePriorityValue(priority), id);
	}

	private removeFromSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
		const set = map.get(key);
		if (!set) return;
		set.delete(value);
		if (set.size === 0) map.delete(key);
	}
}
