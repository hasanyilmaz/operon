import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import {
	isCanonicalRelationshipIdListV1,
	validateTaskRelationshipSpecV1,
	type MutationPreviewRequestV1,
	type ReplaceTaskRelationshipsSpecV1,
	type TaskRelationshipFieldV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';
import {
	parseDependencyIdList,
	serializeDependencyIdList,
	validateDependencyMutations,
} from '../../core/dependency-graph';
import { toLocalDatetime } from '../../core/local-time';

const MAX_RELATIONSHIP_DEPTH = 100;
const RELATIONSHIP_FIELDS = ['parentTask', 'blocking', 'blockedBy'] as const;
type DependencyField = 'blocking' | 'blockedBy';

export interface RuntimeTaskRelationshipSnapshotV1 {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly sourceContent: string;
	readonly duplicate: boolean;
}

export interface RuntimeTaskRelationshipPatchV1 {
	readonly task: RuntimeTaskRelationshipSnapshotV1;
	/** Minimal canonical write payload, including datetimeModified. */
	readonly fieldValues: Readonly<Record<string, string>>;
}

export interface RuntimeTaskRelationshipPreparationV1 {
	readonly kind: 'task-relationships';
	readonly task: RuntimeTaskRelationshipSnapshotV1;
	readonly sealedSpec: ReplaceTaskRelationshipsSpecV1;
	readonly patches: readonly RuntimeTaskRelationshipPatchV1[];
	readonly aggregateAncestorOperonIds: readonly string[];
	readonly noChange: boolean;
	readonly summary: string;
}

export type RuntimeTaskRelationshipPreparationResultV1 =
	| { ok: true; value: RuntimeTaskRelationshipPreparationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export interface RuntimeTaskRelationshipAdapterPortsV1 {
	getTask(operonId: string): RuntimeTaskRelationshipSnapshotV1 | null;
	getAllTasks(): readonly RuntimeTaskRelationshipSnapshotV1[];
}

export interface RuntimeTaskRelationshipPostflightTaskV1 {
	readonly primary: {
		readonly format: 'inline' | 'yaml';
		readonly filePath: string;
		readonly lineNumber: number;
	};
	readonly fieldValues: Readonly<Record<string, string>>;
}

interface MutableRelationshipState {
	task: RuntimeTaskRelationshipSnapshotV1;
	after: Record<TaskRelationshipFieldV1, string>;
}

export function prepareRuntimeTaskRelationshipMutationV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimeTaskRelationshipAdapterPortsV1,
): RuntimeTaskRelationshipPreparationResultV1 {
	if (
		request.mutationKind !== 'task.relationship'
		|| request.spec.operation !== 'replace-relationships'
	) {
		return failure(
			'mutation-kind-mismatch',
			'Relationship mutation expected.',
		);
	}
	if (!request.target) {
		return failure('invalid-request', 'Task required.');
	}
	const task = ports.getTask(request.target.operonId);
	if (!task) return failure('entity-not-found', 'Task not found.');
	if (task.duplicate) {
		return failure('duplicate-operon-id', 'Duplicate task operonId.');
	}
	if (!sameTaskSourceLocatorV1(task.locator, request.target.locator)) {
		return failure('stale-source', 'Task locator changed.');
	}

	const invalidSpec = validateTaskRelationshipSpecV1(request.spec);
	if (invalidSpec) return failure('invalid-request', invalidSpec);

	const currentByField = new Map<TaskRelationshipFieldV1, string[]>();
	for (const field of RELATIONSHIP_FIELDS) {
		const current = readRelationshipIds(task, field);
		if (!current.ok) return current;
		currentByField.set(field, current.value);
	}
	for (const change of request.spec.changes) {
		const current = currentByField.get(change.field) ?? [];
		if (
			change.expectedTargetOperonIds
			&& !sameIds(change.expectedTargetOperonIds, current)
		) {
			return failure(
				'stale-source',
				`${change.field} changed.`,
			);
		}
	}

	const states = new Map<string, MutableRelationshipState>();
	const taskState = ensureState(states, task);
	const referencedIds = new Set<string>();
	for (const change of request.spec.changes) {
		for (const operonId of currentByField.get(change.field) ?? []) referencedIds.add(operonId);
		for (const operonId of change.targetOperonIds) referencedIds.add(operonId);
	}
	for (const operonId of [...referencedIds].sort(compareText)) {
		const referenced = ports.getTask(operonId);
		if (!referenced) {
			return failure(
				'entity-not-found',
				`Target missing: ${operonId}.`,
			);
		}
		if (referenced.duplicate) {
			return failure(
				'duplicate-operon-id',
				`Target duplicated: ${operonId}.`,
			);
		}
		ensureState(states, referenced);
	}

	const allTasks = ports.getAllTasks();
	const reciprocalValidation = validateSourceDependencyReciprocity(
		task,
		currentByField.get('blocking') ?? [],
		currentByField.get('blockedBy') ?? [],
		allTasks,
		ports,
	);
	if (!reciprocalValidation.ok) return reciprocalValidation;

	const requestedParent = request.spec.changes.find(change => change.field === 'parentTask');
	const currentParentIds = currentByField.get('parentTask') ?? [];
	const oldParentId = currentParentIds[0] ?? '';
	const newParentId = requestedParent?.targetOperonIds[0] ?? oldParentId;
	const oldAncestors = collectAncestorIds(task.operonId, oldParentId, ports);
	if (!oldAncestors.ok) return oldAncestors;
	const newAncestors = collectAncestorIds(task.operonId, newParentId, ports);
	if (!newAncestors.ok) return newAncestors;

	for (const change of request.spec.changes) {
		setRelationshipValue(taskState, change.field, change.targetOperonIds);
		if (change.field !== 'blocking' && change.field !== 'blockedBy') continue;
		const inverseField: DependencyField = change.field === 'blocking' ? 'blockedBy' : 'blocking';
		const oldIds = new Set(currentByField.get(change.field) ?? []);
		const newIds = new Set(change.targetOperonIds);
		for (const targetId of new Set([...oldIds, ...newIds])) {
			if (oldIds.has(targetId) === newIds.has(targetId)) continue;
			const targetState = states.get(targetId);
			if (!targetState) {
				return failure('entity-not-found', `Inverse missing: ${targetId}.`);
			}
			const currentInverse = readRelationshipIds(targetState.task, inverseField);
			if (!currentInverse.ok) return currentInverse;
			updateInverse(targetState, inverseField, task.operonId, newIds.has(targetId));
		}
	}
	const dependencyMutations = [...states.values()].flatMap(state => (
		changedRelationshipFields(state)
			.filter((field): field is DependencyField => field !== 'parentTask')
			.map(field => ({
				operonId: state.task.operonId,
				field,
				oldValue: state.task.fieldValues[field] ?? '',
				newValue: state.after[field],
			}))
	));
	const dependencyValidation = validateDependencyMutations(dependencyMutations, allTasks);
	if (!dependencyValidation.ok) {
		return failure(
			'invalid-request',
			dependencyValidation.reason === 'self'
				? `Self dependency: ${dependencyValidation.fromId}.`
				: `Dependency cycle: ${dependencyValidation.cyclePath.join(' -> ')}.`,
		);
	}

	const aggregateAncestorSet = new Set([
		...oldAncestors.value,
		...newAncestors.value,
	]);
	for (const state of states.values()) {
		if (
			state.task.operonId === task.operonId
			|| changedRelationshipFields(state).length === 0
		) continue;
		const parent = readRelationshipIds(state.task, 'parentTask');
		if (!parent.ok) return parent;
		const targetAncestors = collectAncestorIds(
			state.task.operonId,
			parent.value[0] ?? '',
			ports,
		);
		if (!targetAncestors.ok) return targetAncestors;
		for (const ancestorOperonId of targetAncestors.value) {
			aggregateAncestorSet.add(ancestorOperonId);
		}
	}
	const aggregateAncestorOperonIds = [...aggregateAncestorSet].sort(compareText);
	const modifiedAt = toLocalDatetime(new Date(effectiveAt));
	const patches = [...states.values()]
		.map(state => buildPatch(state, modifiedAt))
		.filter((patch): patch is RuntimeTaskRelationshipPatchV1 => patch !== null)
		.sort((left, right) => left.task.operonId.localeCompare(right.task.operonId));
	const affectedOperonIds = [...new Set([
		task.operonId,
		...referencedIds,
		...aggregateAncestorOperonIds,
	])].sort(compareText);
	if (affectedOperonIds.length > 100) {
		return failure(
			'invalid-request',
			'Too many relationship tasks.',
		);
	}
	if (
		request.spec.affectedOperonIds
		&& !sameIds(request.spec.affectedOperonIds, affectedOperonIds)
	) {
		return failure(
			'stale-source',
			'Affected tasks changed.',
		);
	}

	const sealedSpec: ReplaceTaskRelationshipsSpecV1 = {
		operation: 'replace-relationships',
		changes: request.spec.changes.map(change => ({
			field: change.field,
			targetOperonIds: [...change.targetOperonIds],
			expectedTargetOperonIds: [...(currentByField.get(change.field) ?? [])],
		})),
		affectedOperonIds,
	};
	return {
		ok: true,
		value: {
			kind: 'task-relationships',
			task,
			sealedSpec,
			patches,
			aggregateAncestorOperonIds,
			noChange: patches.length === 0,
			summary: patches.length === 0
				? `No relationship change on ${task.operonId}.`
				: `Replace ${request.spec.changes.length} field(s) on ${patches.length} task(s).`,
		},
	};
}

export function verifyRuntimeTaskRelationshipPostflightV1(
	prepared: RuntimeTaskRelationshipPreparationV1,
	expectedModifiedAt: string,
	getTask: (operonId: string) => RuntimeTaskRelationshipPostflightTaskV1 | null | undefined,
	hasDuplicate: (operonId: string) => boolean,
	verifyAggregateState: (operonIds: readonly string[]) => boolean,
): boolean {
	for (const patch of prepared.patches) {
		const indexed = getTask(patch.task.operonId);
		if (
			!indexed
			|| hasDuplicate(patch.task.operonId)
			|| !sameTaskSourceLocatorV1(
				indexed.primary.format === 'yaml'
					? { representation: 'file', filePath: indexed.primary.filePath }
					: {
						representation: 'inline',
						filePath: indexed.primary.filePath,
						lineNumber: indexed.primary.lineNumber,
					},
				patch.task.locator,
			)
			|| Object.entries(patch.fieldValues).some(([field, value]) => {
				const actual = indexed.fieldValues[field] ?? '';
				return field === 'datetimeModified'
					&& patch.task.locator.representation === 'file'
					? actual.localeCompare(value) < 0
					: actual !== value;
			})
		) return false;
	}
	const ancestorIds = prepared.aggregateAncestorOperonIds;
	if (
		!prepared.noChange
		&& ancestorIds.some(operonId => {
			const ancestor = getTask(operonId);
			return !ancestor
				|| hasDuplicate(operonId)
				|| (ancestor.fieldValues['datetimeModified'] ?? '') !== expectedModifiedAt;
		})
	) return false;
	return ancestorIds.length === 0 || verifyAggregateState(ancestorIds);
}

function readRelationshipIds(
	task: RuntimeTaskRelationshipSnapshotV1,
	field: TaskRelationshipFieldV1,
):
	| { ok: true; value: string[] }
	| Extract<RuntimeTaskRelationshipPreparationResultV1, { ok: false }> {
	const raw = task.fieldValues[field] ?? '';
	const ids = field === 'parentTask'
		? raw.trim() ? [raw.trim()] : []
		: parseDependencyIdList(raw);
	if (
		!isCanonicalRelationshipIdListV1(ids)
		|| (field === 'parentTask' && ids.length > 1)
	) {
		return failure(
			'invalid-request',
			`Invalid ${field} IDs on ${task.operonId}.`,
		);
	}
	return { ok: true, value: ids };
}

function validateSourceDependencyReciprocity(
	source: RuntimeTaskRelationshipSnapshotV1,
	sourceBlockingIds: readonly string[],
	sourceBlockedByIds: readonly string[],
	allTasks: readonly RuntimeTaskRelationshipSnapshotV1[],
	ports: RuntimeTaskRelationshipAdapterPortsV1,
): { ok: true } | Extract<RuntimeTaskRelationshipPreparationResultV1, { ok: false }> {
	const directions: ReadonlyArray<{
		sourceIds: ReadonlySet<string>;
		targetField: DependencyField;
	}> = [
		{ sourceIds: new Set(sourceBlockingIds), targetField: 'blockedBy' },
		{ sourceIds: new Set(sourceBlockedByIds), targetField: 'blocking' },
	];
	for (const { sourceIds, targetField } of directions) {
		for (const targetOperonId of sourceIds) {
			const target = ports.getTask(targetOperonId);
			if (!target) return failure('entity-not-found', `Target missing: ${targetOperonId}.`);
			if (target.duplicate) {
				return failure('duplicate-operon-id', `Target duplicated: ${targetOperonId}.`);
			}
			const inverse = readRelationshipIds(target, targetField);
			if (!inverse.ok) return inverse;
			if (!inverse.value.includes(source.operonId)) {
				return relationshipDrift(targetOperonId, targetField, source.operonId);
			}
		}
		for (const candidate of allTasks) {
			if (
				candidate.operonId === source.operonId
				|| sourceIds.has(candidate.operonId)
				|| !parseDependencyIdList(candidate.fieldValues[targetField] ?? '').includes(source.operonId)
			) continue;
			if (candidate.duplicate) {
				return failure(
					'duplicate-operon-id',
					`Inverse duplicated: ${candidate.operonId}.`,
				);
			}
			const inverse = readRelationshipIds(candidate, targetField);
			if (!inverse.ok) return inverse;
			return relationshipDrift(candidate.operonId, targetField, source.operonId);
		}
	}
	return { ok: true };
}

function relationshipDrift(
	targetOperonId: string,
	field: DependencyField,
	sourceOperonId: string,
): Extract<RuntimeTaskRelationshipPreparationResultV1, { ok: false }> {
	return failure(
		'invalid-request',
		`relationship drift: ${targetOperonId}.${field} not reciprocal ${sourceOperonId}.`,
	);
}

function collectAncestorIds(
	sourceOperonId: string,
	parentOperonId: string,
	ports: RuntimeTaskRelationshipAdapterPortsV1,
):
	| { ok: true; value: string[] }
	| Extract<RuntimeTaskRelationshipPreparationResultV1, { ok: false }> {
	const ancestors: string[] = [];
	const visited = new Set([sourceOperonId]);
	let currentId = parentOperonId;
	while (currentId) {
		if (ancestors.length >= MAX_RELATIONSHIP_DEPTH) {
			return failure('invalid-request', 'Parent depth exceeds 100.');
		}
		if (visited.has(currentId)) {
			return failure('invalid-request', 'parent cycle.');
		}
		visited.add(currentId);
		const current = ports.getTask(currentId);
		if (!current) {
			return failure('entity-not-found', `Parent missing: ${currentId}.`);
		}
		if (current.duplicate) {
			return failure('duplicate-operon-id', `Parent duplicated: ${currentId}.`);
		}
		ancestors.push(currentId);
		const next = readRelationshipIds(current, 'parentTask');
		if (!next.ok) return next;
		currentId = next.value[0] ?? '';
	}
	return { ok: true, value: ancestors };
}

function ensureState(
	states: Map<string, MutableRelationshipState>,
	task: RuntimeTaskRelationshipSnapshotV1,
): MutableRelationshipState {
	const existing = states.get(task.operonId);
	if (existing) return existing;
	const before: Record<TaskRelationshipFieldV1, string> = {
		parentTask: task.fieldValues['parentTask'] ?? '',
		blocking: task.fieldValues['blocking'] ?? '',
		blockedBy: task.fieldValues['blockedBy'] ?? '',
	};
	const state: MutableRelationshipState = {
		task,
		after: { ...before },
	};
	states.set(task.operonId, state);
	return state;
}

function setRelationshipValue(
	state: MutableRelationshipState,
	field: TaskRelationshipFieldV1,
	operonIds: readonly string[],
): void {
	state.after[field] = field === 'parentTask'
		? operonIds[0] ?? ''
		: serializeDependencyIdList(operonIds);
}

function updateInverse(
	state: MutableRelationshipState,
	field: DependencyField,
	operonId: string,
	add: boolean,
): void {
	const values = parseDependencyIdList(state.after[field]);
	const next = add
		? values.includes(operonId) ? values : [...values, operonId]
		: values.filter(value => value !== operonId);
	setRelationshipValue(state, field, next);
}

function buildPatch(
	state: MutableRelationshipState,
	modifiedAt: string,
): RuntimeTaskRelationshipPatchV1 | null {
	const changedFields = changedRelationshipFields(state);
	if (changedFields.length === 0) return null;
	const fieldValues: Record<string, string> = {};
	for (const field of changedFields) {
		fieldValues[field] = state.after[field];
	}
	fieldValues['datetimeModified'] = modifiedAt;
	return {
		task: state.task,
		fieldValues,
	};
}

function changedRelationshipFields(
	state: MutableRelationshipState,
): TaskRelationshipFieldV1[] {
	return RELATIONSHIP_FIELDS.filter(field => (
		(state.task.fieldValues[field] ?? '') !== state.after[field]
	));
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right);
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): Extract<RuntimeTaskRelationshipPreparationResultV1, { ok: false }> {
	return { ok: false, code, reason };
}
