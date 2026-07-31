import {
	isMutationKindV1,
} from '../contracts/v1/capabilities';
import type { CatalogRequestV1 } from '../contracts/v1/catalog';
import type { CliCommandV1, CliRuntimeRequestV1 } from '../contracts/v1/cli';
import {
	CONTEXT_HYDRATION_KEYS_V1,
	CONTEXT_PROJECTION_LIMITS_V1,
	CONTEXT_PROJECTIONS_V1,
	CONTEXT_PURPOSES_V1,
	MUTATION_READINESS_OPERON_IDS_MAX_V1,
	MUTATION_READINESS_OPERON_IDS_MIN_V1,
	RELATIONSHIP_KINDS_V1,
	TASK_FINDER_PROJECT_MODES_V1,
	TASK_FINDER_REPRESENTATIONS_V1,
	TASK_FINDER_SCOPES_V1,
	TASK_GET_HYDRATION_KEYS_V1,
	type ContextRequestV1,
	type EntityResolveRequestV1,
	type RelationshipRequestV1,
	type TaskGetRequestV1,
	type TaskFinderRequestV1,
	type TaskQueryFiltersV1,
	type TaskQueryRequestV1,
} from '../contracts/v1/context';
import {
	OPERON_ID_PATTERN_V1,
	validateVaultRelativePathV1,
	type TaskSelectorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
} from '../contracts/v1/mutation';
import {
	CONTRACT_LIMITS_V1,
	CONTRACT_VERSION_V1,
	REQUEST_ID_PATTERN_V1,
	utf8ByteLengthV1,
} from '../contracts/v1/primitives';
import type { TimerReadRequestV1 } from '../contracts/v1/timer';
import {
	validateRuntimeMutationApplyRequestV1,
	validateRuntimeMutationPreviewRequestV1,
} from './mutation-request-validator';

type RuntimeReadRequestV1 =
	| CatalogRequestV1
	| EntityResolveRequestV1
	| TaskGetRequestV1
	| TaskFinderRequestV1
	| TaskQueryRequestV1
	| RelationshipRequestV1
	| ContextRequestV1
	| MutationPreviewRequestV1
	| MutationApplyRequestV1
	| TimerReadRequestV1;

type ValidatedRequestV1<T extends RuntimeReadRequestV1> =
	| { ok: true; value: T }
	| { ok: false };

const READ_BASE_KEYS = ['contractVersion', 'requestId', 'kind', 'consistency'] as const;
const CONSISTENCIES = ['live-verified', 'best-effort', 'offline-unverified'] as const;
const CHECKBOXES = ['open', 'done', 'cancelled'] as const;

export function validateCatalogRequestV1(value: unknown): ValidatedRequestV1<CatalogRequestV1> {
	const serialized = serializeWithinInputCap(value);
	if (
		serialized === null
		|| !isExactObject(value, READ_BASE_KEYS)
		|| value.contractVersion !== CONTRACT_VERSION_V1
		|| value.kind !== 'catalog'
		|| !isBoundedNonEmptyString(value.requestId, CONTRACT_LIMITS_V1.requestIdBytes)
		|| !REQUEST_ID_PATTERN_V1.test(value.requestId)
		|| !isEnum(value.consistency, CONSISTENCIES)
	) return { ok: false };
	return {
		ok: true,
		value: JSON.parse(serialized) as CatalogRequestV1,
	};
}

export function validateCliRuntimeRequestV1(
	command: CliCommandV1,
	value: unknown,
): ValidatedRequestV1<CliRuntimeRequestV1> {
	switch (command) {
		case 'health':
		case 'capabilities':
		case 'diagnostics':
			return { ok: false };
		case 'catalog':
			return validateCatalogRequestV1(value);
		case 'entity.resolve':
			return validateEntityResolveRequestV1(value);
		case 'task.get':
			return validateTaskGetRequestV1(value);
		case 'tasks.query':
			return validateTaskQueryRequestV1(value);
		case 'tasks.finder':
			return validateTaskFinderRequestV1(value);
		case 'relationships.get':
			return validateRelationshipRequestV1(value);
		case 'context.build':
			return validateContextRequestV1(value);
		case 'timers.read':
			return validateTimerReadRequestV1(value);
		case 'mutation.preview': {
			const decoded = validateRuntimeMutationPreviewRequestV1(value);
			return decoded.ok ? { ok: true, value: decoded.value } : { ok: false };
		}
		case 'mutation.apply': {
			const decoded = validateRuntimeMutationApplyRequestV1(
				value,
				Date.now(),
				{ allowExpired: true },
			);
			return decoded.ok ? { ok: true, value: decoded.value } : { ok: false };
		}
	}
}

export function validateTimerReadRequestV1(
	value: unknown,
): ValidatedRequestV1<TimerReadRequestV1> {
	return validateReadRequest(value, 'timer-read', [], () => true);
}

export function validateEntityResolveRequestV1(value: unknown): ValidatedRequestV1<EntityResolveRequestV1> {
	return validateReadRequest(value, 'entity-resolve', ['selector', 'limit'], object => (
		isSelector(object.selector)
		&& (object.limit === undefined || isIntegerInRange(object.limit, 1, 500))
	));
}

export function validateTaskGetRequestV1(value: unknown): ValidatedRequestV1<TaskGetRequestV1> {
	return validateReadRequest(value, 'task-get', ['selector', 'include'], object => (
		isSelector(object.selector)
		&& (object.include === undefined || isTaskGetHydrationKeys(object.include))
	));
}

export function validateTaskQueryRequestV1(value: unknown): ValidatedRequestV1<TaskQueryRequestV1> {
	return validateReadRequest(value, 'task-query', ['filters', 'include', 'limit', 'cursor'], object => (
		(object.filters === undefined || isTaskQueryFilters(object.filters))
		&& (object.include === undefined || isHydrationKeys(object.include))
		&& (object.limit === undefined || isIntegerInRange(object.limit, 1, 250))
		&& (object.cursor === undefined || isCursor(object.cursor))
	));
}

export function validateTaskFinderRequestV1(value: unknown): ValidatedRequestV1<TaskFinderRequestV1> {
	return validateReadRequest(value, 'task-finder', [
		'text', 'filters', 'representations', 'scope', 'project', 'limit', 'cursor',
	], object => {
		if (object.text !== undefined) {
			if (!isBoundedNonEmptyString(object.text, 4_096)) return false;
			if (object.text.trim().length < 2) return false;
			if (!/[\p{L}\p{N}]/u.test(object.text)) return false;
		}
		if (object.filters !== undefined) {
			if (!isTaskQueryFilters(object.filters)) return false;
			const filters = object.filters as Record<string, unknown>;
			if (filters.text !== undefined || filters.filePath !== undefined || filters.parentOperonId !== undefined) return false;
		}
		if (
			object.representations !== undefined
			&& (
				!isUniqueEnumArray(object.representations, TASK_FINDER_REPRESENTATIONS_V1)
				|| object.representations.length < 1
				|| object.representations.length > TASK_FINDER_REPRESENTATIONS_V1.length
			)
		) return false;
		if (object.scope !== undefined && !isEnum(object.scope, TASK_FINDER_SCOPES_V1)) return false;
		if (object.project !== undefined) {
			if (!isExactObject(object.project, ['mode', 'rootOperonId'])) return false;
			if (!isEnum(object.project.mode, TASK_FINDER_PROJECT_MODES_V1)) return false;
			if (
				object.project.rootOperonId !== undefined
				&& (
					typeof object.project.rootOperonId !== 'string'
					|| !OPERON_ID_PATTERN_V1.test(object.project.rootOperonId)
				)
			) return false;
		}
		return (
			(object.limit === undefined || isIntegerInRange(object.limit, 1, 250))
			&& (object.cursor === undefined || isCursor(object.cursor))
		);
	});
}

export function validateRelationshipRequestV1(value: unknown): ValidatedRequestV1<RelationshipRequestV1> {
	return validateReadRequest(value, 'relationship', ['selector', 'kinds', 'limit', 'depth'], object => (
		isSelector(object.selector)
		&& (object.kinds === undefined || isEnumArray(object.kinds, RELATIONSHIP_KINDS_V1))
		&& (object.limit === undefined || isIntegerInRange(object.limit, 1, 500))
		&& (object.depth === undefined || isIntegerInRange(object.depth, 0, 6))
	));
}

export function validateContextRequestV1(value: unknown): ValidatedRequestV1<ContextRequestV1> {
	return validateReadRequest(value, 'context', [
		'purpose',
		'projection',
		'selector',
		'operonIds',
		'filters',
		'include',
		'limit',
		'depth',
		'cursor',
		'targetFilePath',
		'mutationKind',
		'placement',
	], object => {
		if (!isEnum(object.purpose, CONTEXT_PURPOSES_V1) || !isEnum(object.projection, CONTEXT_PROJECTIONS_V1)) {
			return false;
		}
		if (object.selector !== undefined && !isSelector(object.selector)) return false;
		if (
			object.operonIds !== undefined
			&& !isBoundedUniqueOperonIdArray(
				object.operonIds,
				MUTATION_READINESS_OPERON_IDS_MIN_V1,
				MUTATION_READINESS_OPERON_IDS_MAX_V1,
			)
		) return false;
		if (object.filters !== undefined && !isTaskQueryFilters(object.filters)) return false;
		if (object.include !== undefined && !isHydrationKeys(object.include)) return false;
		const bounds = CONTEXT_PROJECTION_LIMITS_V1[object.projection];
		if (object.limit !== undefined && !isIntegerInRange(object.limit, 1, bounds.hardLimit)) return false;
		if (object.depth !== undefined) {
			if (typeof object.depth !== 'number' || !Number.isSafeInteger(object.depth) || object.depth < 0) return false;
			if (bounds.maxDepth !== null && object.depth > bounds.maxDepth) return false;
		}
		if (object.cursor !== undefined && !isCursor(object.cursor)) return false;
		if (
			object.targetFilePath !== undefined
			&& (
				typeof object.targetFilePath !== 'string'
				|| validateVaultRelativePathV1(object.targetFilePath) !== null
			)
		) return false;
		if (
			object.mutationKind !== undefined
			&& (typeof object.mutationKind !== 'string' || !isMutationKindV1(object.mutationKind))
		) return false;
		if (object.placement !== undefined && !isPlacementRequest(object.placement)) return false;
		return hasValidProjectionCombination(object);
	});
}

function validateReadRequest<T extends RuntimeReadRequestV1>(
	value: unknown,
	kind: T['kind'],
	extraKeys: readonly string[],
	validate: (object: Record<string, unknown>) => boolean,
): ValidatedRequestV1<T> {
	const serialized = serializeWithinInputCap(value);
	if (
		serialized === null
		|| !isExactObject(value, [...READ_BASE_KEYS, ...extraKeys])
		|| value.contractVersion !== CONTRACT_VERSION_V1
		|| value.kind !== kind
		|| !isBoundedNonEmptyString(value.requestId, CONTRACT_LIMITS_V1.requestIdBytes)
		|| !REQUEST_ID_PATTERN_V1.test(value.requestId)
		|| !isEnum(value.consistency, CONSISTENCIES)
		|| !validate(value)
	) return { ok: false };
	return {
		ok: true,
		value: JSON.parse(serialized) as T,
	};
}

function hasValidProjectionCombination(request: Record<string, unknown>): boolean {
	const projection = request.projection;
	if (
		(
			projection === 'exact-task'
			|| projection === 'task-neighborhood'
			|| projection === 'project-analysis'
			|| projection === 'mutation-preview'
		)
		&& request.selector === undefined
		&& request.operonIds === undefined
	) return false;
	if (request.selector !== undefined && request.operonIds !== undefined) return false;
	if (projection !== 'mutation-preview' && request.operonIds !== undefined) return false;
	if (projection === 'planning-workload' && request.selector !== undefined) return false;
	if (projection !== 'planning-workload' && request.filters !== undefined) return false;
	if ((projection === 'exact-task' || projection === 'mutation-preview') && request.cursor !== undefined) return false;
	if ((projection === 'planning-workload' || projection === 'mutation-preview') && request.depth !== undefined) return false;
	if (projection === 'exact-task' && request.limit !== undefined && request.limit !== 1) return false;
	if (projection === 'exact-task' && request.depth !== undefined && request.depth !== 0) return false;
	if (projection !== 'creation-context' && request.targetFilePath !== undefined) return false;
	if (
		projection === 'mutation-preview'
		&& (request.purpose !== 'mutation-readiness' || request.mutationKind === undefined)
	) return false;
	if (
		request.operonIds !== undefined
		&& (request.mutationKind !== 'task.update' || request.limit !== undefined)
	) return false;
	if (projection !== 'mutation-preview' && request.mutationKind !== undefined) return false;
	if (projection === 'creation-context' && request.purpose !== 'creation') return false;
	if (projection === 'placement-candidates') {
		if (request.purpose !== 'mutation-readiness' || request.placement === undefined) return false;
		if ([
			'selector', 'operonIds', 'filters', 'include', 'depth', 'cursor', 'targetFilePath', 'mutationKind',
		].some(field => request[field] !== undefined)) return false;
	} else if (request.placement !== undefined) {
		return false;
	}
	return true;
}

function isPlacementRequest(value: unknown): boolean {
	if (!isPlainObject(value)) return false;
	if (value.mode === 'files') {
		return isExactObject(value, ['mode', 'query'])
			&& (
				value.query === undefined
				|| (
					isCharacterBoundedNonEmptyString(
						value.query,
						256,
					)
					&& value.query === value.query.trim()
					&& !hasControlCharacter(value.query)
				)
			);
	}
	if (value.mode === 'lines') {
		return isExactObject(value, ['mode', 'filePath'])
			&& typeof value.filePath === 'string'
			&& value.filePath.toLowerCase().endsWith('.md')
			&& validateVaultRelativePathV1(value.filePath) === null;
	}
	return false;
}

function isSelector(value: unknown): value is TaskSelectorV1 {
	if (!isPlainObject(value) || typeof value.kind !== 'string') return false;
	switch (value.kind) {
		case 'operon-id':
			return isExactObject(value, ['kind', 'operonId']) && isCanonicalOperonId(value.operonId);
		case 'exact-locator':
			return isExactObject(value, ['kind', 'locator', 'expectedOperonId'])
				&& isLocator(value.locator)
				&& (value.expectedOperonId === undefined || isCanonicalOperonId(value.expectedOperonId));
		case 'exact-path':
			return isExactObject(value, ['kind', 'filePath', 'expectedOperonId'])
				&& typeof value.filePath === 'string'
				&& validateVaultRelativePathV1(value.filePath) === null
				&& (value.expectedOperonId === undefined || isCanonicalOperonId(value.expectedOperonId));
		case 'exact-name':
			return isExactObject(value, ['kind', 'noteName', 'expectedOperonId'])
				&& isCharacterBoundedNonEmptyString(value.noteName, 4_096)
				&& !/[/\\]/.test(value.noteName)
				&& !hasControlCharacter(value.noteName)
				&& (value.expectedOperonId === undefined || isCanonicalOperonId(value.expectedOperonId));
		case 'search':
			return isExactObject(value, ['kind', 'query', 'limit'])
				&& isCharacterBoundedNonEmptyString(value.query, 4_096)
				&& (value.limit === undefined || isIntegerInRange(value.limit, 1, 500));
		default:
			return false;
	}
}

function isLocator(value: unknown): value is TaskSourceLocatorV1 {
	if (!isPlainObject(value)) return false;
	if (value.representation === 'inline') {
		return isExactObject(value, ['representation', 'filePath', 'lineNumber'])
			&& typeof value.filePath === 'string'
			&& validateVaultRelativePathV1(value.filePath) === null
			&& isIntegerInRange(value.lineNumber, 0, Number.MAX_SAFE_INTEGER);
	}
	if (value.representation === 'file') {
		return isExactObject(value, ['representation', 'filePath'])
			&& typeof value.filePath === 'string'
			&& validateVaultRelativePathV1(value.filePath) === null;
	}
	return false;
}

function isTaskQueryFilters(value: unknown): value is TaskQueryFiltersV1 {
	if (!isExactObject(value, [
		'checkbox',
		'pipelineIds',
		'statusIds',
		'priorityIds',
		'tiers',
		'filePath',
		'parentOperonId',
		'due',
		'text',
	])) return false;
	if (value.checkbox !== undefined && !isUniqueEnumArray(value.checkbox, CHECKBOXES)) return false;
	for (const key of ['pipelineIds', 'statusIds', 'priorityIds', 'tiers'] as const) {
		if (value[key] !== undefined && !isBoundedUniqueStringArray(value[key], 128, 4_096)) return false;
	}
	if (
		value.filePath !== undefined
		&& (typeof value.filePath !== 'string' || validateVaultRelativePathV1(value.filePath) !== null)
	) return false;
	if (value.parentOperonId !== undefined && !isCanonicalOperonId(value.parentOperonId)) return false;
	if (value.due !== undefined && !isDueRange(value.due)) return false;
	if (value.text !== undefined && !isCharacterBoundedNonEmptyString(value.text, 4_096)) return false;
	return true;
}

function isDueRange(value: unknown): boolean {
	if (!isExactObject(value, ['from', 'to'])) return false;
	if (value.from === undefined && value.to === undefined) return false;
	return (value.from === undefined || isCalendarDate(value.from))
		&& (value.to === undefined || isCalendarDate(value.to));
}

function isCalendarDate(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day;
}

function isHydrationKeys(value: unknown): boolean {
	return isUniqueEnumArray(value, CONTEXT_HYDRATION_KEYS_V1);
}

function isTaskGetHydrationKeys(value: unknown): boolean {
	return isUniqueEnumArray(value, TASK_GET_HYDRATION_KEYS_V1);
}

function isBoundedUniqueStringArray(value: unknown, maximum: number, maxCharacters: number): boolean {
	return Array.isArray(value)
		&& value.length <= maximum
		&& value.every(item => isCharacterBoundedNonEmptyString(item, maxCharacters))
		&& new Set(value).size === value.length;
}

function isUniqueEnumArray<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
	return isEnumArray(value, allowed)
		&& new Set(value).size === value.length;
}

function isEnumArray<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
	return Array.isArray(value)
		&& value.length <= CONTRACT_LIMITS_V1.collectionItems
		&& value.every(item => typeof item === 'string' && allowed.includes(item as T));
}

function isCursor(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length >= 16
		&& value.length <= CONTRACT_LIMITS_V1.cursorCharacters
		&& value === value.trim();
}

function isBoundedUniqueOperonIdArray(
	value: unknown,
	minimum: number,
	maximum: number,
): value is string[] {
	return Array.isArray(value)
		&& value.length >= minimum
		&& value.length <= maximum
		&& value.every(isCanonicalOperonId)
		&& new Set(value).size === value.length;
}

function isCanonicalOperonId(value: unknown): value is string {
	return typeof value === 'string' && OPERON_ID_PATTERN_V1.test(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= minimum
		&& value <= maximum;
}

function isCharacterBoundedNonEmptyString(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && [...value].length <= maximum;
}

function isBoundedNonEmptyString(value: unknown, maximumBytes: number): value is string {
	return typeof value === 'string' && value.length > 0 && utf8ByteLengthV1(value) <= maximumBytes;
}

function serializeWithinInputCap(value: unknown): string | null {
	try {
		const serialized = JSON.stringify(value);
		return serialized !== undefined && utf8ByteLengthV1(serialized) <= CONTRACT_LIMITS_V1.transportInputBytes
			? serialized
			: null;
	} catch {
		return null;
	}
}

function isExactObject(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
	if (!isPlainObject(value)) return false;
	const allowed = new Set(allowedKeys);
	return Object.keys(value).every(key => (
		key !== '__proto__'
		&& key !== 'constructor'
		&& key !== 'prototype'
		&& allowed.has(key)
	));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && allowed.includes(value as T);
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}
