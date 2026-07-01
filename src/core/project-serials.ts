import type { IndexedTask } from '../types/fields';
import type { ProjectSerialScope } from '../types/settings';

export const PROJECT_SERIAL_STATE_VERSION = 1;
export const PROJECT_SERIAL_MAX_NUMBER = 999999;

export interface ProjectSerialScopeAssignment {
	nextNumber: number;
	taskNumbers: Record<string, number>;
	updatedAt: string;
}

export interface ProjectSerialState {
	version: number;
	assignmentsByScopeId: Record<string, ProjectSerialScopeAssignment>;
}

export interface ProjectSerialDisplay {
	scopeId: string;
	scopePrefix: string;
	parentOperonId: string;
	number: number;
	label: string;
	operonId: string;
}

export interface ProjectSerialScopeSummary {
	scopeId: string;
	activeTaskCount: number;
	assignedTaskCount: number;
	maxAssignedNumber: number;
	formatPreview: string;
}

export interface ProjectSerialReconcileResult {
	changed: boolean;
	capacityBlockedScopeIds: string[];
	displaysByTaskId: Map<string, ProjectSerialDisplay>;
	summariesByScopeId: Map<string, ProjectSerialScopeSummary>;
}

export interface ProjectSerialEffectPreview {
	affectedTaskCount: number;
	serialLossCount: number;
	visibleSerialChangeCount: number;
	nestedTaskCount: number;
	duplicatePrefixScopeCount: number;
	overlappingScopeCount: number;
}

const PROJECT_SERIAL_ID_PREFIX = 'ps';
const PROJECT_SERIAL_ID_SUFFIX_LENGTH = 8;
const PROJECT_SERIAL_PREFIX_RE = /^[A-Za-z]{1,5}$/u;

export function createProjectSerialScopeId(existingIds: Iterable<string> = []): string {
	const used = new Set(existingIds);
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const candidate = `${PROJECT_SERIAL_ID_PREFIX}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 2 + PROJECT_SERIAL_ID_SUFFIX_LENGTH)}`;
		if (!used.has(candidate)) return candidate;
	}
	throw new Error('Failed to create unique project serial scope id');
}

export function normalizeProjectSerialPrefix(value: unknown): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return PROJECT_SERIAL_PREFIX_RE.test(trimmed) ? trimmed : '';
}

export function isValidProjectSerialPrefix(value: unknown): value is string {
	return normalizeProjectSerialPrefix(value).length > 0;
}

export function normalizeProjectSerialScopes(raw: unknown): ProjectSerialScope[] {
	if (!Array.isArray(raw)) return [];
	const scopes: ProjectSerialScope[] = [];
	const seenIds = new Set<string>();
	const seenParentIds = new Set<string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		const id = typeof record.id === 'string' ? record.id.trim() : '';
		const prefix = normalizeProjectSerialPrefix(record.prefix);
		const parentOperonId = typeof record.parentOperonId === 'string' ? record.parentOperonId.trim() : '';
		if (!id || !prefix || !parentOperonId || seenIds.has(id) || seenParentIds.has(parentOperonId)) continue;
		const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : '';
		const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt.trim() : '';
		scopes.push({
			id,
			prefix,
			parentOperonId,
			createdAt,
			updatedAt,
		});
		seenIds.add(id);
		seenParentIds.add(parentOperonId);
	}
	return scopes;
}

export function createEmptyProjectSerialState(): ProjectSerialState {
	return {
		version: PROJECT_SERIAL_STATE_VERSION,
		assignmentsByScopeId: {},
	};
}

export function normalizeProjectSerialState(raw: unknown): ProjectSerialState {
	const data = createEmptyProjectSerialState();
	if (!raw || typeof raw !== 'object') return data;
	const assignments = (raw as Record<string, unknown>).assignmentsByScopeId;
	if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return data;
	const assignmentEntries = assignments as Record<string, unknown>;
	for (const [scopeId, rawAssignment] of Object.entries(assignmentEntries)) {
		const normalizedScopeId = scopeId.trim();
		if (!normalizedScopeId || !rawAssignment || typeof rawAssignment !== 'object') continue;
		const assignmentRecord = rawAssignment as Record<string, unknown>;
		const taskNumbers: Record<string, number> = {};
		const rawTaskNumbers = assignmentRecord.taskNumbers;
		if (rawTaskNumbers && typeof rawTaskNumbers === 'object' && !Array.isArray(rawTaskNumbers)) {
			const rawTaskNumberEntries = rawTaskNumbers as Record<string, unknown>;
			for (const [operonId, rawNumber] of Object.entries(rawTaskNumberEntries)) {
				const normalizedOperonId = operonId.trim();
				const number = normalizeProjectSerialNumber(rawNumber);
				if (!normalizedOperonId || number === null) continue;
				taskNumbers[normalizedOperonId] = number;
			}
		}
		const maxNumber = getMaxAssignedNumber(taskNumbers);
		const rawNextNumber = normalizeProjectSerialNumber(assignmentRecord.nextNumber);
		const nextNumber = Math.max(rawNextNumber ?? 1, maxNumber + 1, 1);
		data.assignmentsByScopeId[normalizedScopeId] = {
			nextNumber,
			taskNumbers: sortProjectSerialTaskNumbers(taskNumbers),
			updatedAt: typeof assignmentRecord.updatedAt === 'string' ? assignmentRecord.updatedAt.trim() : '',
		};
	}
	return data;
}

export function reconcileProjectSerialAssignments(options: {
	scopes: readonly ProjectSerialScope[];
	state: ProjectSerialState;
	tasks: readonly IndexedTask[];
	now: string;
}): ProjectSerialReconcileResult {
	const normalizedScopes = normalizeProjectSerialScopes(options.scopes);
	const scopeIds = new Set(normalizedScopes.map(scope => scope.id));
	const tasksByScopeId = collectProjectSerialTaskMembership(normalizedScopes, options.tasks);
	const nextAssignments: Record<string, ProjectSerialScopeAssignment> = {};
	const displaysByTaskId = new Map<string, ProjectSerialDisplay>();
	const summariesByScopeId = new Map<string, ProjectSerialScopeSummary>();
	const capacityBlockedScopeIds: string[] = [];
	let changed = false;

	for (const existingScopeId of Object.keys(options.state.assignmentsByScopeId)) {
		if (!scopeIds.has(existingScopeId)) {
			changed = true;
			break;
		}
	}

	for (const scope of normalizedScopes) {
		const currentAssignment = options.state.assignmentsByScopeId[scope.id];
		const taskNumbers = currentAssignment
			? { ...currentAssignment.taskNumbers }
			: {};
		let scopeChanged = !currentAssignment;
		const activeTasks = tasksByScopeId.get(scope.id) ?? [];
		const activeTaskIds = new Set(activeTasks.map(task => task.operonId));
		if (trimInactiveTrailingProjectSerialAssignments(taskNumbers, activeTaskIds)) {
			scopeChanged = true;
		}
		let nextNumber = Math.max(getMaxAssignedNumber(taskNumbers) + 1, 1);
		for (const task of sortProjectSerialTasksForAssignment(activeTasks)) {
			if (taskNumbers[task.operonId]) continue;
			if (nextNumber > PROJECT_SERIAL_MAX_NUMBER) {
				capacityBlockedScopeIds.push(scope.id);
				break;
			}
			taskNumbers[task.operonId] = nextNumber;
			nextNumber += 1;
			scopeChanged = true;
		}
		const maxAssignedNumber = getMaxAssignedNumber(taskNumbers);
		const assignment: ProjectSerialScopeAssignment = {
			nextNumber: Math.max(nextNumber, maxAssignedNumber + 1, 1),
			taskNumbers: sortProjectSerialTaskNumbers(taskNumbers),
			updatedAt: scopeChanged ? options.now : currentAssignment?.updatedAt ?? options.now,
		};
		if (!currentAssignment || !isSameAssignment(currentAssignment, assignment)) {
			changed = true;
		}
		nextAssignments[scope.id] = assignment;
		for (const task of activeTasks) {
			const number = assignment.taskNumbers[task.operonId];
			if (!number) continue;
			displaysByTaskId.set(task.operonId, {
				scopeId: scope.id,
				scopePrefix: scope.prefix,
				parentOperonId: scope.parentOperonId,
				number,
				label: formatProjectSerialLabel(scope.prefix, number, maxAssignedNumber),
				operonId: task.operonId,
			});
		}
		summariesByScopeId.set(scope.id, {
			scopeId: scope.id,
			activeTaskCount: activeTasks.length,
			assignedTaskCount: Object.keys(assignment.taskNumbers).length,
			maxAssignedNumber,
			formatPreview: formatProjectSerialLabel(scope.prefix, Math.max(1, maxAssignedNumber), maxAssignedNumber),
		});
	}

	options.state.version = PROJECT_SERIAL_STATE_VERSION;
	options.state.assignmentsByScopeId = nextAssignments;

	return {
		changed,
		capacityBlockedScopeIds: [...new Set(capacityBlockedScopeIds)],
		displaysByTaskId,
		summariesByScopeId,
	};
}

export function previewProjectSerialScopeAdd(options: {
	scopes: readonly ProjectSerialScope[];
	candidate: ProjectSerialScope;
	tasks: readonly IndexedTask[];
}): ProjectSerialEffectPreview {
	const normalizedScopes = normalizeProjectSerialScopes(options.scopes);
	const nextScopes = [...normalizedScopes, options.candidate];
	const before = collectProjectSerialTaskMembership(normalizedScopes, options.tasks);
	const after = collectProjectSerialTaskMembership(nextScopes, options.tasks);
	const candidateTasks = after.get(options.candidate.id) ?? [];
	const beforeOwnerByTaskId = invertMembership(before);
	const afterOwnerByTaskId = invertMembership(after);
	const duplicatePrefixScopeCount = options.scopes.filter(scope =>
		scope.prefix.toLocaleLowerCase() === options.candidate.prefix.toLocaleLowerCase()
	).length;
	const overlappingScopeCount = options.scopes.filter(scope =>
		areProjectSerialScopesOverlapping(scope.parentOperonId, options.candidate.parentOperonId, options.tasks)
	).length;
	const candidateTreeTasks = collectProjectSerialDescendantTasks(options.candidate.parentOperonId, options.tasks);
	let visibleSerialChangeCount = 0;
	for (const task of candidateTasks) {
		if (beforeOwnerByTaskId.get(task.operonId) !== options.candidate.id) visibleSerialChangeCount += 1;
	}
	let nestedTaskCount = 0;
	for (const task of candidateTreeTasks) {
		const owner = afterOwnerByTaskId.get(task.operonId);
		if (owner && owner !== options.candidate.id) nestedTaskCount += 1;
	}
	return {
		affectedTaskCount: visibleSerialChangeCount,
		serialLossCount: 0,
		visibleSerialChangeCount,
		nestedTaskCount,
		duplicatePrefixScopeCount,
		overlappingScopeCount,
	};
}

export function previewProjectSerialScopeDelete(options: {
	scopes: readonly ProjectSerialScope[];
	scopeId: string;
	tasks: readonly IndexedTask[];
}): ProjectSerialEffectPreview {
	const normalizedScopes = normalizeProjectSerialScopes(options.scopes);
	const removedScope = normalizedScopes.find(scope => scope.id === options.scopeId.trim()) ?? null;
	const before = collectProjectSerialTaskMembership(normalizedScopes, options.tasks);
	const removedTasks = before.get(options.scopeId.trim()) ?? [];
	const nextScopes = normalizedScopes.filter(scope => scope.id !== options.scopeId.trim());
	const after = collectProjectSerialTaskMembership(nextScopes, options.tasks);
	const beforeOwnerByTaskId = invertMembership(before);
	const afterOwnerByTaskId = invertMembership(after);
	let serialLossCount = 0;
	let visibleSerialChangeCount = 0;
	for (const task of removedTasks) {
		if (afterOwnerByTaskId.has(task.operonId)) {
			visibleSerialChangeCount += 1;
		} else {
			serialLossCount += 1;
		}
	}
	const removedTreeTasks = removedScope
		? collectProjectSerialDescendantTasks(removedScope.parentOperonId, options.tasks)
		: [];
	let nestedTaskCount = 0;
	for (const task of removedTreeTasks) {
		const beforeOwner = beforeOwnerByTaskId.get(task.operonId);
		const afterOwner = afterOwnerByTaskId.get(task.operonId);
		if (beforeOwner && beforeOwner !== options.scopeId.trim() && beforeOwner === afterOwner) {
			nestedTaskCount += 1;
		}
	}
	return {
		affectedTaskCount: removedTasks.length,
		serialLossCount,
		visibleSerialChangeCount,
		nestedTaskCount,
		duplicatePrefixScopeCount: 0,
		overlappingScopeCount: 0,
	};
}

export function formatProjectSerialLabel(prefix: string, number: number, maxAssignedNumber: number): string {
	const normalizedPrefix = normalizeProjectSerialPrefix(prefix) || 'P';
	const safeNumber = Math.max(1, Math.min(PROJECT_SERIAL_MAX_NUMBER, Math.floor(number)));
	const safeMax = Math.max(safeNumber, Math.min(PROJECT_SERIAL_MAX_NUMBER, Math.floor(maxAssignedNumber || safeNumber)));
	const maxNumberDigits = String(safeMax).length;
	const prefixWidth = Math.max(1, Math.min(normalizedPrefix.length, 7 - maxNumberDigits));
	const numberWidth = 7 - prefixWidth;
	return `${normalizedPrefix.slice(0, prefixWidth)}-${String(safeNumber).padStart(numberWidth, '0')}`;
}

export function getProjectSerialSignature(displays: Iterable<ProjectSerialDisplay>): string {
	return [...displays]
		.map(display => `${display.operonId}:${display.scopeId}:${display.label}:${display.number}`)
		.sort((left, right) => left.localeCompare(right))
		.join('|');
}

export function resolveStoredProjectSerialDisplay(options: {
	scopes: readonly ProjectSerialScope[];
	state: ProjectSerialState;
	operonId: string | null | undefined;
	getTaskById: (operonId: string) => IndexedTask | null | undefined;
}): ProjectSerialDisplay | null {
	const operonId = options.operonId?.trim() ?? '';
	if (!operonId) return null;
	const task = options.getTaskById(operonId);
	if (!task) return null;

	const normalizedScopes = normalizeProjectSerialScopes(options.scopes);
	const scopeByParentId = new Map(normalizedScopes.map(scope => [scope.parentOperonId, scope]));
	const scope = resolveNearestProjectSerialScopeFromLookup(task, scopeByParentId, options.getTaskById);
	if (!scope) return null;

	const assignment = options.state.assignmentsByScopeId[scope.id];
	if (!assignment) return null;
	const number = normalizeProjectSerialNumber(assignment.taskNumbers[operonId]);
	if (number === null) return null;

	const maxAssignedNumber = Math.max(number, getMaxAssignedNumber(assignment.taskNumbers));
	return {
		scopeId: scope.id,
		scopePrefix: scope.prefix,
		parentOperonId: scope.parentOperonId,
		number,
		label: formatProjectSerialLabel(scope.prefix, number, maxAssignedNumber),
		operonId,
	};
}

function collectProjectSerialTaskMembership(
	scopes: readonly ProjectSerialScope[],
	tasks: readonly IndexedTask[],
): Map<string, IndexedTask[]> {
	const scopeByParentId = new Map(scopes.map(scope => [scope.parentOperonId, scope]));
	const taskById = new Map(tasks.map(task => [task.operonId, task]));
	const membership = new Map<string, IndexedTask[]>();
	for (const scope of scopes) {
		membership.set(scope.id, []);
	}
	for (const task of tasks) {
		const scope = resolveNearestProjectSerialScope(task, scopeByParentId, taskById);
		if (!scope) continue;
		membership.get(scope.id)?.push(task);
	}
	return membership;
}

function resolveNearestProjectSerialScope(
	task: IndexedTask,
	scopeByParentId: Map<string, ProjectSerialScope>,
	taskById: Map<string, IndexedTask>,
): ProjectSerialScope | null {
	let currentId = task.operonId;
	const seen = new Set<string>();
	while (currentId && !seen.has(currentId)) {
		seen.add(currentId);
		const scope = scopeByParentId.get(currentId);
		if (scope) return scope;
		const currentTask = taskById.get(currentId);
		currentId = currentTask?.fieldValues['parentTask']?.trim() ?? '';
	}
	return null;
}

function resolveNearestProjectSerialScopeFromLookup(
	task: IndexedTask,
	scopeByParentId: Map<string, ProjectSerialScope>,
	getTaskById: (operonId: string) => IndexedTask | null | undefined,
): ProjectSerialScope | null {
	let currentId = task.operonId;
	const seen = new Set<string>();
	while (currentId && !seen.has(currentId)) {
		seen.add(currentId);
		const scope = scopeByParentId.get(currentId);
		if (scope) return scope;
		const currentTask = currentId === task.operonId ? task : getTaskById(currentId);
		currentId = currentTask?.fieldValues['parentTask']?.trim() ?? '';
	}
	return null;
}

function areProjectSerialScopesOverlapping(leftRootId: string, rightRootId: string, tasks: readonly IndexedTask[]): boolean {
	if (leftRootId === rightRootId) return true;
	const taskById = new Map(tasks.map(task => [task.operonId, task]));
	return isAncestorOf(leftRootId, rightRootId, taskById) || isAncestorOf(rightRootId, leftRootId, taskById);
}

function collectProjectSerialDescendantTasks(rootId: string, tasks: readonly IndexedTask[]): IndexedTask[] {
	const taskById = new Map(tasks.map(task => [task.operonId, task]));
	return tasks.filter(task => isAncestorOf(rootId, task.operonId, taskById));
}

function isAncestorOf(ancestorId: string, descendantId: string, taskById: Map<string, IndexedTask>): boolean {
	let currentId = descendantId;
	const seen = new Set<string>();
	while (currentId && !seen.has(currentId)) {
		if (currentId === ancestorId) return true;
		seen.add(currentId);
		const task = taskById.get(currentId);
		currentId = task?.fieldValues['parentTask']?.trim() ?? '';
	}
	return false;
}

function sortProjectSerialTasksForAssignment(tasks: readonly IndexedTask[]): IndexedTask[] {
	return [...tasks].sort((left, right) => {
		const leftCreated = left.fieldValues['datetimeCreated']?.trim() ?? '';
		const rightCreated = right.fieldValues['datetimeCreated']?.trim() ?? '';
		if (leftCreated && rightCreated && leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);
		if (leftCreated && !rightCreated) return -1;
		if (!leftCreated && rightCreated) return 1;
		return left.operonId.localeCompare(right.operonId);
	});
}

function invertMembership(membership: Map<string, IndexedTask[]>): Map<string, string> {
	const ownerByTaskId = new Map<string, string>();
	for (const [scopeId, tasks] of membership) {
		for (const task of tasks) {
			ownerByTaskId.set(task.operonId, scopeId);
		}
	}
	return ownerByTaskId;
}

function normalizeProjectSerialNumber(value: unknown): number | null {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) return null;
	const integer = Math.floor(number);
	if (integer < 1 || integer > PROJECT_SERIAL_MAX_NUMBER) return null;
	return integer;
}

function getMaxAssignedNumber(taskNumbers: Record<string, number>): number {
	return Object.values(taskNumbers).reduce((max, number) => Math.max(max, number), 0);
}

function trimInactiveTrailingProjectSerialAssignments(taskNumbers: Record<string, number>, activeTaskIds: ReadonlySet<string>): boolean {
	let highestActiveNumber = 0;
	let highestAssignedNumber = 0;
	for (const [operonId, number] of Object.entries(taskNumbers)) {
		highestAssignedNumber = Math.max(highestAssignedNumber, number);
		if (activeTaskIds.has(operonId)) {
			highestActiveNumber = Math.max(highestActiveNumber, number);
		}
	}
	if (highestAssignedNumber <= highestActiveNumber) return false;
	let trimmed = false;
	for (const [operonId, number] of Object.entries(taskNumbers)) {
		if (number <= highestActiveNumber) continue;
		delete taskNumbers[operonId];
		trimmed = true;
	}
	return trimmed;
}

function sortProjectSerialTaskNumbers(taskNumbers: Record<string, number>): Record<string, number> {
	const sorted: Record<string, number> = {};
	for (const operonId of Object.keys(taskNumbers).sort((left, right) => left.localeCompare(right))) {
		sorted[operonId] = taskNumbers[operonId];
	}
	return sorted;
}

function isSameAssignment(left: ProjectSerialScopeAssignment, right: ProjectSerialScopeAssignment): boolean {
	return left.nextNumber === right.nextNumber
		&& left.updatedAt === right.updatedAt
		&& JSON.stringify(left.taskNumbers) === JSON.stringify(right.taskNumbers);
}
