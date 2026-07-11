import { IndexedTask } from '../types/fields';
import { Pipeline, resolveWorkflowStatus } from '../types/pipeline';
import { CheckboxState } from '../types/keys';
import type { DependencyFieldKey } from './task-field-patch';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from './workflow-status-identity';

export type DependencyRelationType = 'FS';

export const DEFAULT_DEPENDENCY_RELATION_TYPE: DependencyRelationType = 'FS';

export interface DependencyEdge {
	fromId: string;
	toId: string;
	type: DependencyRelationType;
	ownerId: string;
	field: DependencyFieldKey;
}

export interface DependencyFieldMutation {
	operonId: string;
	field: DependencyFieldKey;
	oldValue: string;
	newValue: string;
}

interface DependencyGraphTask {
	operonId: string;
	fieldValues: Record<string, string>;
}

export interface DependencyStatusChangeAttempt {
	previousStatus: string;
	nextStatus: string;
	previousCheckbox: CheckboxState;
	nextCheckbox: CheckboxState;
	kind: 'status' | 'checkbox';
}

export interface ActiveDependencyBlocker {
	operonId: string;
	task: IndexedTask | null;
	status: string;
	dateScheduled: string;
	dateDue: string;
	sourcePath: string;
	missing: boolean;
}

export type DependencyEdgeValidationResult =
	| { ok: true }
	| {
		ok: false;
		reason: 'self' | 'cycle';
		fromId: string;
		toId: string;
		cyclePath: string[];
	};

export interface DependencyStatusGuardOptions {
	mode?: 'merge' | 'replace';
}

function hasOwn(source: Record<string, string>, key: string): boolean {
	return Object.keys(source).includes(key);
}

function normalizeCheckbox(value: string | undefined, fallback: CheckboxState): CheckboxState {
	if (value === 'done' || value === 'cancelled' || value === 'open') return value;
	return fallback;
}

export function parseDependencyIdList(value: string | undefined | null): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const item of (value ?? '').split(';')) {
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		ids.push(trimmed);
	}
	return ids;
}

export function serializeDependencyIdList(ids: Iterable<string>): string {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const id of ids) {
		const trimmed = id.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		normalized.push(trimmed);
	}
	return normalized.join('; ');
}

export function getDependencyEdgeForField(
	ownerId: string,
	field: DependencyFieldKey,
	linkedId: string,
): { fromId: string; toId: string } {
	return field === 'blocking'
		? { fromId: ownerId, toId: linkedId }
		: { fromId: linkedId, toId: ownerId };
}

export function getTaskDependencyEdges(task: DependencyGraphTask): DependencyEdge[] {
	const edges: DependencyEdge[] = [];
	for (const targetId of parseDependencyIdList(task.fieldValues['blocking'])) {
		edges.push({
			...getDependencyEdgeForField(task.operonId, 'blocking', targetId),
			type: DEFAULT_DEPENDENCY_RELATION_TYPE,
			ownerId: task.operonId,
			field: 'blocking',
		});
	}
	for (const sourceId of parseDependencyIdList(task.fieldValues['blockedBy'])) {
		edges.push({
			...getDependencyEdgeForField(task.operonId, 'blockedBy', sourceId),
			type: DEFAULT_DEPENDENCY_RELATION_TYPE,
			ownerId: task.operonId,
			field: 'blockedBy',
		});
	}
	return edges;
}

export function buildDependencyAdjacency(tasks: Iterable<DependencyGraphTask>): Map<string, Set<string>> {
	const adjacency = new Map<string, Set<string>>();
	for (const task of tasks) {
		for (const edge of getTaskDependencyEdges(task)) {
			if (!edge.fromId || !edge.toId) continue;
			const targets = adjacency.get(edge.fromId) ?? new Set<string>();
			targets.add(edge.toId);
			adjacency.set(edge.fromId, targets);
			if (!adjacency.has(edge.toId)) {
				adjacency.set(edge.toId, new Set<string>());
			}
		}
	}
	return adjacency;
}

function findPath(
	adjacency: Map<string, Set<string>>,
	startId: string,
	targetId: string,
): string[] | null {
	const queue: Array<{ id: string; path: string[] }> = [{ id: startId, path: [startId] }];
	const visited = new Set<string>();
	while (queue.length > 0) {
		const next = queue.shift();
		if (!next) break;
		if (visited.has(next.id)) continue;
		visited.add(next.id);
		if (next.id === targetId) return next.path;
		for (const childId of adjacency.get(next.id) ?? []) {
			if (visited.has(childId)) continue;
			queue.push({ id: childId, path: [...next.path, childId] });
		}
	}
	return null;
}

export function validateDependencyEdge(
	fromId: string,
	toId: string,
	tasks: Iterable<DependencyGraphTask>,
): DependencyEdgeValidationResult {
	const normalizedFrom = fromId.trim();
	const normalizedTo = toId.trim();
	if (!normalizedFrom || !normalizedTo) return { ok: true };
	if (normalizedFrom === normalizedTo) {
		return {
			ok: false,
			reason: 'self',
			fromId: normalizedFrom,
			toId: normalizedTo,
			cyclePath: [normalizedFrom],
		};
	}
	const adjacency = buildDependencyAdjacency(tasks);
	const pathBack = findPath(adjacency, normalizedTo, normalizedFrom);
	if (!pathBack) return { ok: true };
	return {
		ok: false,
		reason: 'cycle',
		fromId: normalizedFrom,
		toId: normalizedTo,
		cyclePath: [normalizedFrom, ...pathBack],
	};
}

function normalizeTaskId(value: string): string {
	return value.trim();
}

function cloneGraphTasks(tasks: Iterable<DependencyGraphTask>): Map<string, DependencyGraphTask> {
	const cloned = new Map<string, DependencyGraphTask>();
	for (const task of tasks) {
		const operonId = normalizeTaskId(task.operonId);
		if (!operonId || cloned.has(operonId)) continue;
		cloned.set(operonId, {
			operonId,
			fieldValues: {
				...task.fieldValues,
				blocking: serializeDependencyIdList(parseDependencyIdList(task.fieldValues['blocking'])),
				blockedBy: serializeDependencyIdList(parseDependencyIdList(task.fieldValues['blockedBy'])),
			},
		});
	}
	return cloned;
}

function ensureGraphTask(tasks: Map<string, DependencyGraphTask>, operonId: string): DependencyGraphTask {
	const normalizedId = normalizeTaskId(operonId);
	const existing = tasks.get(normalizedId);
	if (existing) return existing;
	const task: DependencyGraphTask = {
		operonId: normalizedId,
		fieldValues: {},
	};
	tasks.set(normalizedId, task);
	return task;
}

export function validateDependencyMutations(
	mutations: Iterable<DependencyFieldMutation>,
	tasks: Iterable<DependencyGraphTask>,
): DependencyEdgeValidationResult {
	const materializedMutations = Array.from(mutations);
	const graphTasks = cloneGraphTasks(tasks);
	const addedEdges: Array<{ fromId: string; toId: string }> = [];

	for (const mutation of materializedMutations) {
		const ownerId = normalizeTaskId(mutation.operonId);
		if (!ownerId) continue;
		const oldIds = new Set(parseDependencyIdList(mutation.oldValue));
		for (const linkedId of parseDependencyIdList(mutation.newValue)) {
			if (oldIds.has(linkedId)) continue;
			addedEdges.push(getDependencyEdgeForField(ownerId, mutation.field, linkedId));
		}
		const owner = ensureGraphTask(graphTasks, ownerId);
		const nextValue = serializeDependencyIdList(parseDependencyIdList(mutation.newValue));
		if (nextValue) {
			owner.fieldValues[mutation.field] = nextValue;
		} else {
			delete owner.fieldValues[mutation.field];
		}
	}

	if (addedEdges.length === 0) return { ok: true };
	const finalTasks = Array.from(graphTasks.values());
	const adjacency = buildDependencyAdjacency(finalTasks);
	for (const edge of addedEdges) {
		const fromId = normalizeTaskId(edge.fromId);
		const toId = normalizeTaskId(edge.toId);
		if (!fromId || !toId) continue;
		if (fromId === toId) {
			return {
				ok: false,
				reason: 'self',
				fromId,
				toId,
				cyclePath: [fromId],
			};
		}
		const pathBack = findPath(adjacency, toId, fromId);
		if (!pathBack) continue;
		return {
			ok: false,
			reason: 'cycle',
			fromId,
			toId,
			cyclePath: [fromId, ...pathBack],
		};
	}
	return { ok: true };
}

export function isDependencyBlockerResolved(
	task: IndexedTask | null | undefined,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): boolean {
	if (!task) return false;
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) return workflow.checkbox !== 'open';
	if (task.checkbox === 'done' || task.checkbox === 'cancelled') return true;
	if ((task.fieldValues['dateCompleted'] ?? '').trim()) return true;
	if ((task.fieldValues['dateCancelled'] ?? '').trim()) return true;
	return false;
}

export function getDependencyStatusLabel(task: IndexedTask | null | undefined): string {
	if (!task) return '';
	const status = (task.fieldValues['status'] ?? '').trim();
	return status || task.checkbox;
}

export function getDependencySourcePath(task: IndexedTask): string {
	if (task.primary.format === 'yaml') return task.primary.filePath;
	return `${task.primary.filePath}:${task.primary.lineNumber + 1}`;
}

export function resolveActiveBlockers(
	task: IndexedTask,
	getTask: (operonId: string) => IndexedTask | undefined,
	pipelines: Pipeline[],
	getAllTasks?: () => Iterable<IndexedTask>,
): ActiveDependencyBlocker[] {
	const blockers: ActiveDependencyBlocker[] = [];
	const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const blockerIds = parseDependencyIdList(task.fieldValues['blockedBy']);
	if (getAllTasks) {
		const seen = new Set(blockerIds);
		for (const candidate of getAllTasks()) {
			if (candidate.operonId === task.operonId || seen.has(candidate.operonId)) continue;
			if (!parseDependencyIdList(candidate.fieldValues['blocking']).includes(task.operonId)) continue;
			seen.add(candidate.operonId);
			blockerIds.push(candidate.operonId);
		}
	}
	for (const blockerId of blockerIds) {
		const blockerTask = getTask(blockerId) ?? null;
		if (isDependencyBlockerResolved(blockerTask, pipelines, workflowStatusIdentityIndex)) continue;
		blockers.push({
			operonId: blockerId,
			task: blockerTask,
			status: getDependencyStatusLabel(blockerTask),
			dateScheduled: blockerTask?.fieldValues['dateScheduled'] ?? '',
			dateDue: blockerTask?.fieldValues['dateDue'] ?? '',
			sourcePath: blockerTask ? getDependencySourcePath(blockerTask) : '',
			missing: blockerTask === null,
		});
	}
	return blockers;
}

export function resolveDependencyStatusChangeAttempt(
	task: IndexedTask,
	payload: Record<string, string>,
	options: DependencyStatusGuardOptions = {},
): DependencyStatusChangeAttempt | null {
	const mode = options.mode ?? 'merge';
	const previousStatus = (task.fieldValues['status'] ?? '').trim();
	const nextStatus = hasOwn(payload, 'status')
		? (payload['status'] ?? '').trim()
		: (mode === 'replace' ? '' : previousStatus);
	const previousCheckbox = task.checkbox;
	const nextCheckbox = hasOwn(payload, '_checkbox')
		? normalizeCheckbox(payload['_checkbox'], previousCheckbox)
		: previousCheckbox;

	if (nextStatus !== previousStatus) {
		return {
			previousStatus,
			nextStatus,
			previousCheckbox,
			nextCheckbox,
			kind: 'status',
		};
	}

	if (!previousStatus && !nextStatus && previousCheckbox === 'open' && nextCheckbox !== 'open') {
		return {
			previousStatus,
			nextStatus,
			previousCheckbox,
			nextCheckbox,
			kind: 'checkbox',
		};
	}

	return null;
}
