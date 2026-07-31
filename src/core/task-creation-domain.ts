import { resolveFileTaskDefaults } from './file-task-defaults';
import {
	buildMergedFileTaskDraft,
	parseFrontmatterDocument,
} from './file-task-template-merge';
import {
	serializeDependencyIdList,
	validateDependencyMutations,
} from './dependency-graph';
import { isValidOperonId } from './id-generator';
import { parseTaskLine } from './parser';
import { buildTaskLine } from './serializer';
import { resolveSubtaskInitialFieldsFromParentValues } from './subtask-inheritance';
import { insertInlineTaskUnderFirstHeadingKeyword } from './markdown-heading-insertion';
import type { OperonSettings } from '../types/settings';
import { resolveWorkflowStatus } from '../types/pipeline';
import { deriveCountModeRepeatEndFromFieldValues } from './task-field-patch';
import { parseRepeatRule, serializeRepeatRule } from './repeat-rule';
import { resolveRepeatTemporalAnchor } from '../systems/recurrence-domain';
import {
	canonicalizeAbsoluteReminderList,
	canonicalizeReminderRuleList,
	parseAbsoluteReminder,
} from './reminder-rules';

export const MAX_CANONICAL_TASK_CREATION_ITEMS = 64;
export const MAX_CANONICAL_FILE_TASK_BODY_BYTES = 65_536;

export type CanonicalTaskRepresentation = 'inline' | 'file';
export type CanonicalTaskCheckbox = 'open' | 'done' | 'cancelled';

export type TaskCreationReference =
	| { kind: 'existing'; operonId: string }
	| { kind: 'local'; itemKey: string };

export interface TaskCreationDependency {
	relation: 'blocks' | 'blocked-by';
	target: TaskCreationReference;
}

export type InlineTaskCreationPlacement =
	| { kind: 'append' }
	| { kind: 'before-line'; lineNumber: number }
	| { kind: 'after-line'; lineNumber: number }
	| { kind: 'after-item'; itemKey: string }
	| { kind: 'under-heading'; headingKeyword: string };

export interface TaskCreationSourceSnapshot {
	/** NFC-normalized vault-relative Markdown path. */
	filePath: string;
	/** Null means the path was absent when the preview snapshot was captured. */
	content: string | null;
	/** Full source digest or an explicit provider-owned absence sentinel. */
	revision: string;
}

export interface DeterministicFileTaskTemplate {
	templateId: string;
	content: string;
	revision: string;
}

export interface InlineTaskCreationTarget {
	representation: 'inline';
	source: TaskCreationSourceSnapshot;
	placement: InlineTaskCreationPlacement;
	allowCreateFile: boolean;
}

export interface FileTaskCreationTarget {
	representation: 'file';
	source: TaskCreationSourceSnapshot;
	template?: DeterministicFileTaskTemplate;
}

export type TaskCreationTarget = InlineTaskCreationTarget | FileTaskCreationTarget;

export interface CanonicalTaskCreationItem {
	/** Request-local stable reference used by parent and related edges. */
	itemKey: string;
	description: string;
	target: TaskCreationTarget;
	checkbox?: CanonicalTaskCheckbox;
	fields?: Readonly<Record<string, string>>;
	/**
	 * Adapter-owned canonical temporal fields. This channel is intentionally
	 * separate from public creation fields so the general field allowlist
	 * cannot be used to write Runtime-owned state.
	 */
	runtimeFields?: Readonly<Record<string, string>>;
	/**
	 * Undefined inherits configured parent tags. An explicit array replaces
	 * inherited tags, including an explicit empty array.
	 */
	tags?: readonly string[];
	parent?: TaskCreationReference;
	related?: readonly TaskCreationReference[];
	bodyMarkdown?: string;
	dependencies?: readonly TaskCreationDependency[];
}

export interface CanonicalTaskCreationRequest {
	requestId: string;
	items: readonly CanonicalTaskCreationItem[];
}

export interface ExistingTaskCreationContext {
	operonId: string;
	fieldValues: Readonly<Record<string, string>>;
	tags: readonly string[];
}

export interface PrepareCanonicalTaskCreationOptions {
	settings: OperonSettings;
	now: string;
	existingOperonIds: ReadonlySet<string>;
	existingTasks: ReadonlyMap<string, ExistingTaskCreationContext>;
	/** Complete primitive task graph used only for dependency cycle validation. */
	dependencyGraphTasks?: readonly ExistingTaskCreationContext[];
	generateOperonId: () => string;
	resolveCoreTemplateVariables?: (
		content: string,
		context: { title: string; date: string; now: string },
	) => string;
	/**
	 * Catalog-owned creation allowlist. Runtime-owned fields are rejected even
	 * if they accidentally appear here.
	 */
	allowedFieldKeys: readonly string[];
}

export type TaskCreationBlockerCode =
	| 'empty-request'
	| 'too-many-items'
	| 'duplicate-item-key'
	| 'invalid-item-key'
	| 'invalid-description'
	| 'invalid-target-path'
	| 'missing-target'
	| 'target-collision'
	| 'mixed-target-representation'
	| 'inconsistent-source-snapshot'
	| 'invalid-insertion-line'
	| 'missing-reference'
	| 'parent-cycle'
	| 'invalid-dependency'
	| 'invalid-body'
	| 'invalid-existing-id'
	| 'id-allocation-failed'
	| 'field-not-allowed'
	| 'template-processing-required'
	| 'template-placeholder-unsupported';

export interface TaskCreationBlocker {
	code: TaskCreationBlockerCode;
	message: string;
	itemKey?: string;
	filePath?: string;
	field?: string;
}

export interface PreparedTaskCreationTask {
	itemKey: string;
	operonId: string;
	description: string;
	representation: CanonicalTaskRepresentation;
	filePath: string;
	lineNumber?: number;
	checkbox: CanonicalTaskCheckbox;
	fieldValues: Readonly<Record<string, string>>;
	tags: readonly string[];
	renderedTaskLine?: string;
	renderedFileContent?: string;
	parentOperonId?: string;
	relatedOperonIds: readonly string[];
	resolvedDependencies: readonly {
		relation: 'blocks' | 'blocked-by';
		operonId: string;
	}[];
	bodyMarkdown?: string;
	template?: {
		templateId: string;
		revision: string;
	};
}

export interface PreparedTaskCreationSourceGroup {
	groupId: string;
	filePath: string;
	expectedRevision: string;
	expectedState: 'absent' | 'present';
	expectedContent: string | null;
	operation: 'create' | 'update';
	resultingContent: string;
	taskItemKeys: readonly string[];
}

export interface PreparedCanonicalTaskCreationPlan {
	requestId: string;
	preparedAt: string;
	tasks: readonly PreparedTaskCreationTask[];
	sourceGroups: readonly PreparedTaskCreationSourceGroup[];
}

export type PrepareCanonicalTaskCreationResult =
	| { ok: true; plan: PreparedCanonicalTaskCreationPlan }
	| { ok: false; blockers: readonly TaskCreationBlocker[] };

export type TaskCreationSourceCommitResult =
	| {
		status: 'committed';
		resultingRevision: string;
		resourceRevisions?: readonly {
			resourceKind: 'task-source' | 'repeat-series';
			resourceKey: string;
			revision: string;
		}[];
	}
	| { status: 'conflict'; currentRevision?: string; reason: string }
	| { status: 'failed'; reason: string }
	| { status: 'outcome-unknown'; reason: string };

/**
 * The adapter must implement compare-and-write inside Operon's canonical
 * per-source queue. It must also re-check vault containment and symlink safety.
 */
export interface TaskCreationCommitPort {
	commitSourceGroup(group: PreparedTaskCreationSourceGroup): Promise<TaskCreationSourceCommitResult>;
}

export interface TaskCreationSourceGroupOutcome {
	groupId: string;
	filePath: string;
	result: TaskCreationSourceCommitResult;
}

export interface TaskCreationCommitSummary {
	status: 'committed' | 'partial' | 'failed' | 'outcome-unknown';
	groups: readonly TaskCreationSourceGroupOutcome[];
	remainingGroupIds: readonly string[];
}

const ITEM_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RUNTIME_OWNED_CREATION_FIELDS = new Set([
	'operonId',
	'datetimeCreated',
	'datetimeModified',
	'parentTask',
	'related',
	'blocking',
	'blockedBy',
	'checkbox',
	'dateCompleted',
	'datetimeCompleted',
	'dateCancelled',
	'datetimeCancelled',
	'reminderDatetimes',
	'reminderRules',
	'repeat',
	'datetimeRepeatEnd',
	'duration',
	'totalEstimate',
	'totalDuration',
	'directSubtaskCount',
	'directDoneSubtaskCount',
	'directOpenSubtaskCount',
	'treeDescendantCount',
	'treeDoneDescendantCount',
	'treeOpenDescendantCount',
	'treeProgress',
	'trackers',
	'repeatSeriesId',
	'repeatOccurrenceDate',
]);
const ADAPTER_OWNED_TEMPORAL_CREATION_FIELDS = new Set([
	'reminderDatetimes',
	'reminderRules',
	'repeat',
	'datetimeRepeatEnd',
	'repeatSeriesId',
	'repeatOccurrenceDate',
]);
const TEMPLATE_RECURRENCE_ANCHOR_FIELDS = new Set([
	'dateScheduled',
	'dateDue',
	'dateStarted',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);
const DYNAMIC_TEMPLATE_PATTERN = /<%|%>/u;
const UNRESOLVED_TEMPLATE_VARIABLE_PATTERN = /\{\{(?![^{}\n]*::)[^{}\n]+\}\}/u;

interface MutablePreparedTask {
	itemKey: string;
	operonId: string;
	description: string;
	representation: CanonicalTaskRepresentation;
	filePath: string;
	lineNumber?: number;
	checkbox: CanonicalTaskCheckbox;
	fieldValues: Record<string, string>;
	tags: string[];
	renderedTaskLine?: string;
	renderedFileContent?: string;
	parentOperonId?: string;
	relatedOperonIds: string[];
	resolvedDependencies: Array<{
		relation: 'blocks' | 'blocked-by';
		operonId: string;
	}>;
	bodyMarkdown?: string;
	template?: {
		templateId: string;
		revision: string;
	};
	requestOrder: number;
	placement?: InlineTaskCreationPlacement;
}

interface ValidatedRequest {
	items: CanonicalTaskCreationItem[];
	itemsByKey: Map<string, CanonicalTaskCreationItem>;
	sourceSnapshots: Map<string, TaskCreationSourceSnapshot>;
	order: string[];
}

export function prepareCanonicalTaskCreation(
	request: CanonicalTaskCreationRequest,
	options: PrepareCanonicalTaskCreationOptions,
): PrepareCanonicalTaskCreationResult {
	const blockers: TaskCreationBlocker[] = [];
	const validated = validateRequest(request, options, blockers);
	if (!validated) return { ok: false, blockers };

	const allocatedIds = allocateIds(validated.items, options, blockers);
	if (!allocatedIds) return { ok: false, blockers };
	const dependencyFields = projectAndValidateDependencies(
		validated.items,
		allocatedIds,
		options.dependencyGraphTasks ?? [...options.existingTasks.values()],
		blockers,
	);
	if (!dependencyFields || blockers.length > 0) return { ok: false, blockers };

	const preparedByKey = new Map<string, MutablePreparedTask>();
	const requestOrderByKey = new Map(
		validated.items.map((item, index) => [item.itemKey, index]),
	);
	for (const itemKey of validated.order) {
		const item = validated.itemsByKey.get(itemKey);
		const requestOrder = requestOrderByKey.get(itemKey);
		if (!item || requestOrder === undefined) continue;
		const task = prepareTask(
			item,
			requestOrder,
			allocatedIds,
			preparedByKey,
			dependencyFields.get(itemKey),
			options,
			blockers,
		);
		if (task) preparedByKey.set(itemKey, task);
	}
	if (blockers.length > 0) return { ok: false, blockers };

	const preparedTasks = validated.items
		.map(item => preparedByKey.get(item.itemKey))
		.filter((task): task is MutablePreparedTask => !!task);
	const sourceGroups = buildSourceGroups(preparedTasks, validated.sourceSnapshots, blockers);
	if (!sourceGroups || blockers.length > 0) return { ok: false, blockers };

	const tasks = preparedTasks
		.sort((left, right) => left.requestOrder - right.requestOrder)
		.map(stripMutableTask);
	return {
		ok: true,
		plan: {
			requestId: request.requestId,
			preparedAt: options.now,
			tasks,
			sourceGroups,
		},
	};
}

export async function commitPreparedTaskCreationPlan(
	plan: PreparedCanonicalTaskCreationPlan,
	port: TaskCreationCommitPort,
): Promise<TaskCreationCommitSummary> {
	const groups: TaskCreationSourceGroupOutcome[] = [];
	for (let index = 0; index < plan.sourceGroups.length; index++) {
		const group = plan.sourceGroups[index];
		let result: TaskCreationSourceCommitResult;
		try {
			result = await port.commitSourceGroup(group);
		} catch (error) {
			result = {
				status: 'outcome-unknown',
				reason: error instanceof Error ? error.message : String(error),
			};
		}
		groups.push({ groupId: group.groupId, filePath: group.filePath, result });
		if (result.status !== 'committed') {
			const remainingGroupIds = plan.sourceGroups.slice(index + 1).map(item => item.groupId);
			return {
				status: result.status === 'outcome-unknown'
					? 'outcome-unknown'
					: groups.some(item => item.result.status === 'committed')
						? 'partial'
						: 'failed',
				groups,
				remainingGroupIds,
			};
		}
	}
	return {
		status: 'committed',
		groups,
		remainingGroupIds: [],
	};
}

function validateRequest(
	request: CanonicalTaskCreationRequest,
	options: PrepareCanonicalTaskCreationOptions,
	blockers: TaskCreationBlocker[],
): ValidatedRequest | null {
	if (request.items.length === 0) {
		blockers.push({ code: 'empty-request', message: 'At least one task creation item is required.' });
		return null;
	}
	if (request.items.length > MAX_CANONICAL_TASK_CREATION_ITEMS) {
		blockers.push({
			code: 'too-many-items',
			message: `Task creation is limited to ${MAX_CANONICAL_TASK_CREATION_ITEMS} items per plan.`,
		});
		return null;
	}

	const items = request.items.map(item => cloneItem(item));
	const itemsByKey = new Map<string, CanonicalTaskCreationItem>();
	const sourceSnapshots = new Map<string, TaskCreationSourceSnapshot>();
	const fileTargets = new Set<string>();
	const allowedFields = new Set(options.allowedFieldKeys);

	for (const item of items) {
		if (!ITEM_KEY_PATTERN.test(item.itemKey)) {
			blockers.push({
				code: 'invalid-item-key',
				message: 'Task item keys must be 1-64 portable identifier characters.',
				itemKey: item.itemKey,
			});
		} else if (itemsByKey.has(item.itemKey)) {
			blockers.push({
				code: 'duplicate-item-key',
				message: `Duplicate task item key: ${item.itemKey}`,
				itemKey: item.itemKey,
			});
		} else {
			itemsByKey.set(item.itemKey, item);
		}

		if (!normalizeDescription(item.description)) {
			blockers.push({
				code: 'invalid-description',
				message: 'Task descriptions must be non-empty and contain no control characters.',
				itemKey: item.itemKey,
			});
		}

		const pathError = validateTargetPath(item.target.source.filePath);
		if (pathError) {
			blockers.push({
				code: 'invalid-target-path',
				message: pathError,
				itemKey: item.itemKey,
				filePath: item.target.source.filePath,
			});
		}

		const normalizedPath = item.target.source.filePath.normalize('NFC');
		item.target.source.filePath = normalizedPath;
		const previousSnapshot = sourceSnapshots.get(normalizedPath);
		if (
			previousSnapshot
			&& (
				previousSnapshot.revision !== item.target.source.revision
				|| previousSnapshot.content !== item.target.source.content
			)
		) {
			blockers.push({
				code: 'inconsistent-source-snapshot',
				message: 'All items targeting one source must share the same preview snapshot.',
				itemKey: item.itemKey,
				filePath: normalizedPath,
			});
		} else {
			sourceSnapshots.set(normalizedPath, { ...item.target.source });
		}

		if (item.target.representation === 'file') {
			if (fileTargets.has(normalizedPath) || item.target.source.content !== null) {
				blockers.push({
					code: 'target-collision',
					message: 'A file task requires one exact target path that is absent at preview time.',
					itemKey: item.itemKey,
					filePath: normalizedPath,
				});
			}
			fileTargets.add(normalizedPath);
			validateTemplate(item, blockers);
			if (
				item.bodyMarkdown !== undefined
				&& new TextEncoder().encode(item.bodyMarkdown).byteLength > MAX_CANONICAL_FILE_TASK_BODY_BYTES
			) {
				blockers.push({
					code: 'invalid-body',
					message: `File Task bodyMarkdown is limited to ${MAX_CANONICAL_FILE_TASK_BODY_BYTES} UTF-8 bytes.`,
					itemKey: item.itemKey,
				});
			}
		} else if (item.bodyMarkdown !== undefined) {
			blockers.push({
				code: 'invalid-body',
				message: 'bodyMarkdown is supported only for File Task creation.',
				itemKey: item.itemKey,
			});
		} else if (item.target.source.content === null && !item.target.allowCreateFile) {
			blockers.push({
				code: 'missing-target',
				message: 'The exact inline target is absent and create-if-missing was not authorized.',
				itemKey: item.itemKey,
				filePath: normalizedPath,
			});
		}

		for (const field of Object.keys(item.fields ?? {})) {
			if (RUNTIME_OWNED_CREATION_FIELDS.has(field) || !allowedFields.has(field)) {
				blockers.push({
					code: 'field-not-allowed',
					message: `Field ${field} is not writable through canonical task creation.`,
					itemKey: item.itemKey,
					field,
				});
			}
		}
		for (const field of Object.keys(item.runtimeFields ?? {})) {
			if (!ADAPTER_OWNED_TEMPORAL_CREATION_FIELDS.has(field)) {
				blockers.push({
					code: 'field-not-allowed',
					message: `Adapter-owned field ${field} is not writable through canonical task creation.`,
					itemKey: item.itemKey,
					field,
				});
			}
		}
	}

	validateReferences(items, itemsByKey, options, blockers);
	const order = buildParentFirstOrder(items, itemsByKey, blockers);
	return blockers.length === 0
		? { items, itemsByKey, sourceSnapshots, order }
		: null;
}

function validateReferences(
	items: readonly CanonicalTaskCreationItem[],
	itemsByKey: ReadonlyMap<string, CanonicalTaskCreationItem>,
	options: PrepareCanonicalTaskCreationOptions,
	blockers: TaskCreationBlocker[],
): void {
	for (const item of items) {
		const references = [
			item.parent,
			...(item.related ?? []),
			...(item.dependencies ?? []).map(dependency => dependency.target),
		].filter(
			(reference): reference is TaskCreationReference => !!reference,
		);
		for (const reference of references) {
			if (reference.kind === 'local') {
				if (!itemsByKey.has(reference.itemKey)) {
					blockers.push({
						code: 'missing-reference',
						message: `Local task reference does not exist: ${reference.itemKey}`,
						itemKey: item.itemKey,
					});
				}
				continue;
			}
			if (!isValidOperonId(reference.operonId)) {
				blockers.push({
					code: 'invalid-existing-id',
					message: `Existing task reference is not a canonical operonId: ${reference.operonId}`,
					itemKey: item.itemKey,
				});
			} else if (!options.existingTasks.has(reference.operonId)) {
				blockers.push({
					code: 'missing-reference',
					message: `Existing task reference could not be resolved uniquely: ${reference.operonId}`,
					itemKey: item.itemKey,
				});
			}
		}
	}
}

function projectAndValidateDependencies(
	items: readonly CanonicalTaskCreationItem[],
	allocatedIds: ReadonlyMap<string, string>,
	existingTasks: readonly ExistingTaskCreationContext[],
	blockers: TaskCreationBlocker[],
): Map<string, { blocking: string[]; blockedBy: string[] }> | null {
	const projected = new Map<string, { blocking: string[]; blockedBy: string[] }>();
	for (const item of items) {
		projected.set(item.itemKey, { blocking: [], blockedBy: [] });
	}
	const add = (itemKey: string, field: 'blocking' | 'blockedBy', operonId: string): void => {
		const fields = projected.get(itemKey);
		if (!fields || fields[field].includes(operonId)) return;
		fields[field].push(operonId);
	};

	for (const item of items) {
		const ownerId = allocatedIds.get(item.itemKey);
		if (!ownerId) continue;
		for (const dependency of item.dependencies ?? []) {
			const targetId = resolveReference(dependency.target, allocatedIds);
			if (!targetId) continue;
			if (dependency.relation === 'blocks') {
				add(item.itemKey, 'blocking', targetId);
				if (dependency.target.kind === 'local') {
					add(dependency.target.itemKey, 'blockedBy', ownerId);
				}
			} else {
				add(item.itemKey, 'blockedBy', targetId);
				if (dependency.target.kind === 'local') {
					add(dependency.target.itemKey, 'blocking', ownerId);
				}
			}
		}
	}

	const mutations = items.flatMap(item => {
		const operonId = allocatedIds.get(item.itemKey);
		const fields = projected.get(item.itemKey);
		if (!operonId || !fields) return [];
		return ([
			{
				operonId,
				field: 'blocking' as const,
				oldValue: '',
				newValue: serializeDependencyIdList(fields.blocking),
			},
			{
				operonId,
				field: 'blockedBy' as const,
				oldValue: '',
				newValue: serializeDependencyIdList(fields.blockedBy),
			},
		]);
	});
	const validation = validateDependencyMutations(mutations, existingTasks);
	if (!validation.ok) {
		blockers.push({
			code: 'invalid-dependency',
			message: validation.reason === 'self'
				? `Task creation would create a self dependency for ${validation.fromId}.`
				: `Task creation would create a dependency cycle: ${validation.cyclePath.join(' -> ')}.`,
		});
		return null;
	}
	return projected;
}

function buildParentFirstOrder(
	items: readonly CanonicalTaskCreationItem[],
	itemsByKey: ReadonlyMap<string, CanonicalTaskCreationItem>,
	blockers: TaskCreationBlocker[],
): string[] {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const result: string[] = [];

	const visit = (itemKey: string): void => {
		if (visited.has(itemKey)) return;
		if (visiting.has(itemKey)) {
			blockers.push({
				code: 'parent-cycle',
				message: `Local parent cycle includes ${itemKey}.`,
				itemKey,
			});
			return;
		}
		visiting.add(itemKey);
		const parent = itemsByKey.get(itemKey)?.parent;
		if (parent?.kind === 'local' && itemsByKey.has(parent.itemKey)) visit(parent.itemKey);
		visiting.delete(itemKey);
		visited.add(itemKey);
		result.push(itemKey);
	};

	for (const item of items) visit(item.itemKey);
	return result;
}

function allocateIds(
	items: readonly CanonicalTaskCreationItem[],
	options: PrepareCanonicalTaskCreationOptions,
	blockers: TaskCreationBlocker[],
): Map<string, string> | null {
	const used = new Set([
		...options.existingOperonIds,
		...options.existingTasks.keys(),
	]);
	const allocated = new Map<string, string>();
	for (const item of items) {
		let next = '';
		for (let attempt = 0; attempt < 100; attempt++) {
			const candidate = options.generateOperonId();
			if (!isValidOperonId(candidate) || used.has(candidate)) continue;
			next = candidate;
			break;
		}
		if (!next) {
			blockers.push({
				code: 'id-allocation-failed',
				message: `Could not allocate a unique canonical operonId for ${item.itemKey}.`,
				itemKey: item.itemKey,
			});
			return null;
		}
		used.add(next);
		allocated.set(item.itemKey, next);
	}
	return allocated;
}

function prepareTask(
	item: CanonicalTaskCreationItem,
	requestOrder: number,
	allocatedIds: ReadonlyMap<string, string>,
	preparedByKey: ReadonlyMap<string, MutablePreparedTask>,
	dependencyFields: { blocking: string[]; blockedBy: string[] } | undefined,
	options: PrepareCanonicalTaskCreationOptions,
	blockers: TaskCreationBlocker[],
): MutablePreparedTask | null {
	const operonId = allocatedIds.get(item.itemKey);
	if (!operonId) return null;
	const parent = resolveReference(item.parent, allocatedIds);
	const related = (item.related ?? [])
		.map(reference => resolveReference(reference, allocatedIds))
		.filter((value): value is string => !!value);
	const resolvedDependencies = (item.dependencies ?? []).flatMap(dependency => {
		const operonId = resolveReference(dependency.target, allocatedIds);
		return operonId ? [{ relation: dependency.relation, operonId }] : [];
	});
	const parentContext = resolveParentContext(item.parent, preparedByKey, options.existingTasks);
	const inherited = resolveSubtaskInitialFieldsFromParentValues(
		parent ?? null,
		parentContext?.fieldValues,
		options.settings,
		parentContext?.tags,
	);
	const explicitTags = item.tags === undefined ? undefined : normalizeTags(item.tags);
	const tags = explicitTags ?? normalizeTags(inherited.tags ?? []);
	const inheritedFields = Object.fromEntries(
		Object.entries(inherited)
			.filter(([key, value]) => key !== 'tags' && typeof value === 'string' && !!value.trim())
			.map(([key, value]) => [key, String(value).trim()]),
	);
	const templateDocument = item.target.representation === 'file' && item.target.template
		? parseFrontmatterDocument(item.target.template.content, options.settings.keyMappings)
		: null;
	const templateTemporalFields = Object.fromEntries(
		Object.entries(templateDocument?.managedFieldValues ?? {})
			.filter(([field, value]) => (
				(
					ADAPTER_OWNED_TEMPORAL_CREATION_FIELDS.has(field)
					|| (
						!!parseRepeatRule(templateDocument?.managedFieldValues['repeat'])
						&& TEMPLATE_RECURRENCE_ANCHOR_FIELDS.has(field)
					)
				)
					&& field !== 'repeatSeriesId'
				&& !!value.trim()
			)),
	);
	const sourceFields: Record<string, string> = {
		...inheritedFields,
		...templateTemporalFields,
		...item.fields,
		...item.runtimeFields,
	};
	if (parent) sourceFields['parentTask'] = parent;
	if (related.length > 0) sourceFields['related'] = Array.from(new Set(related)).join('; ');
	if (dependencyFields?.blocking.length) {
		sourceFields['blocking'] = serializeDependencyIdList(dependencyFields.blocking);
	}
	if (dependencyFields?.blockedBy.length) {
		sourceFields['blockedBy'] = serializeDependencyIdList(dependencyFields.blockedBy);
	}
	if (!normalizeFinalTemporalFields(sourceFields, item.itemKey, blockers)) return null;
	const defaults = resolveFileTaskDefaults({
		sourceFieldValues: sourceFields,
		templateFieldValues: templateDocument?.managedFieldValues ?? {},
		existingOperonId: operonId,
		seedCreatedAt: options.now,
		defaultPipelineName: options.settings.defaultPipelineName,
		defaultPriority: options.settings.defaultPriority,
		pipelines: options.settings.pipelines,
		now: options.now,
		generateOperonId: options.generateOperonId,
	});
	const fieldValues: Record<string, string> = {
		operonId,
		...sourceFields,
	};
	if (!fieldValues['status'] && defaults.status) fieldValues['status'] = defaults.status;
	if (!fieldValues['priority'] && defaults.priority) fieldValues['priority'] = defaults.priority;
	if (!fieldValues['taskIcon'] && defaults.taskIcon) fieldValues['taskIcon'] = defaults.taskIcon;
	fieldValues['datetimeCreated'] = defaults.datetimeCreated ?? options.now;
	fieldValues['datetimeModified'] = options.now;
	const repeatRule = parseRepeatRule(fieldValues['repeat']);
	if (repeatRule && !fieldValues['repeatOccurrenceDate']) {
		const occurrenceDate = resolveRepeatTemporalAnchor(repeatRule, fieldValues, options.now);
		if (occurrenceDate) fieldValues['repeatOccurrenceDate'] = occurrenceDate;
	}
	if (repeatRule?.mode === 'count') {
		const derivedRepeatEnd = deriveCountModeRepeatEndFromFieldValues(fieldValues);
		if (!derivedRepeatEnd) {
			blockers.push({
				code: 'field-not-allowed',
				message: 'Count-mode recurrence requires a valid task date anchor.',
				itemKey: item.itemKey,
				field: 'repeat',
			});
			return null;
		}
		const requestedRepeatEnd = (fieldValues['datetimeRepeatEnd'] ?? '').trim();
		if (requestedRepeatEnd && requestedRepeatEnd !== derivedRepeatEnd) {
			blockers.push({
				code: 'field-not-allowed',
				message: 'Count-mode recurrence end does not match its derived final occurrence.',
				itemKey: item.itemKey,
				field: 'datetimeRepeatEnd',
			});
			return null;
		}
		fieldValues['datetimeRepeatEnd'] = derivedRepeatEnd;
	}

	const description = normalizeDescription(item.description);
	const checkbox = resolveWorkflowStatus(
		options.settings.pipelines,
		fieldValues['status'],
	)?.checkbox ?? item.checkbox ?? 'open';
	const prepared: MutablePreparedTask = {
		itemKey: item.itemKey,
		operonId,
		description,
		representation: item.target.representation,
		filePath: item.target.source.filePath,
		checkbox,
		fieldValues,
		tags,
		parentOperonId: parent,
		relatedOperonIds: Array.from(new Set(related)),
		resolvedDependencies,
		...(item.bodyMarkdown === undefined ? {} : { bodyMarkdown: item.bodyMarkdown }),
		requestOrder,
	};

	if (item.target.representation === 'inline') {
		prepared.placement = item.target.placement;
		prepared.renderedTaskLine = buildTaskLine(description, fieldValues, {
			checkbox,
			tags,
			keyMappings: options.settings.keyMappings,
		});
		return prepared;
	}

	const merged = buildMergedFileTaskDraft({
		source: {
			description,
			fieldValues,
			fieldPresence: new Set(Object.keys(fieldValues)),
			tags,
			tagsPresent: true,
		},
		template: templateDocument,
		defaults,
		keyMappings: options.settings.keyMappings,
		bodyStrategy: 'use-template',
	});
	let resolvedContent = resolveDeterministicTemplateVariables(
		merged.content,
		item.target.source.filePath,
		description,
		merged.fieldValues,
		options.now,
		options.resolveCoreTemplateVariables,
	);
	if (item.bodyMarkdown !== undefined) {
		const injectedOperonTask = item.bodyMarkdown.split('\n').some(
			(line, lineNumber) => parseTaskLine(
				line,
				lineNumber,
				item.target.source.filePath,
				options.settings.keyMappings,
			)?.operonId,
		);
		if (injectedOperonTask) {
			blockers.push({
				code: 'invalid-body',
				message: 'File Task bodyMarkdown cannot contain an additional Operon task.',
				itemKey: item.itemKey,
				filePath: item.target.source.filePath,
			});
			return null;
		}
		resolvedContent = replaceFileTaskBody(resolvedContent, item.bodyMarkdown);
	}
	if (containsUnresolvedTemplateVariableOutsideFences(resolvedContent)) {
		blockers.push({
			code: 'template-placeholder-unsupported',
			message: 'The selected template contains an unresolved dynamic placeholder.',
			itemKey: item.itemKey,
			filePath: item.target.source.filePath,
		});
		return null;
	}
	prepared.fieldValues = { ...merged.fieldValues };
	prepared.tags = [...merged.tags];
	prepared.renderedFileContent = resolvedContent;
	if (item.target.template) {
		prepared.template = {
			templateId: item.target.template.templateId,
			revision: item.target.template.revision,
		};
	}
	return prepared;
}

function normalizeFinalTemporalFields(
	fieldValues: Record<string, string>,
	itemKey: string,
	blockers: TaskCreationBlocker[],
): boolean {
	for (const field of ['reminderDatetimes', 'reminderRules'] as const) {
		const rawValue = (fieldValues[field] ?? '').trim();
		if (!rawValue) continue;
		const rawItems = rawValue.split(';').map(value => value.trim());
		if (rawItems.some(value => !value)) {
			blockers.push({
				code: 'field-not-allowed',
				message: `Field ${field} contains an invalid temporal value.`,
				itemKey,
				field,
			});
			return false;
		}
		let normalizedItems: string[];
		if (field === 'reminderDatetimes') {
			const canonical = canonicalizeAbsoluteReminderList(rawItems);
			if (canonical.items.some(item => !item.ok)) {
				blockers.push({
					code: 'field-not-allowed',
					message: `Field ${field} contains an invalid temporal value.`,
					itemKey,
					field,
				});
				return false;
			}
			normalizedItems = canonical.items.map(item => (
				item.ok ? item.value.localDatetime : ''
			));
		} else {
			const canonical = canonicalizeReminderRuleList(rawItems);
			if (canonical.items.some(item => !item.ok)) {
				blockers.push({
					code: 'field-not-allowed',
					message: `Field ${field} contains an invalid temporal value.`,
					itemKey,
					field,
				});
				return false;
			}
			normalizedItems = canonical.items.map(item => (
				item.ok ? item.value.canonical : ''
			));
		}
		if (new Set(normalizedItems).size !== normalizedItems.length) {
			blockers.push({
				code: 'field-not-allowed',
				message: `Field ${field} contains canonical duplicates.`,
				itemKey,
				field,
			});
			return false;
		}
		fieldValues[field] = normalizedItems.join('; ');
	}
	const rawRepeat = (fieldValues['repeat'] ?? '').trim();
	if (rawRepeat) {
		const repeatRule = parseRepeatRule(rawRepeat);
		if (!repeatRule) {
			blockers.push({
				code: 'field-not-allowed',
				message: 'Recurrence rule is invalid.',
				itemKey,
				field: 'repeat',
			});
			return false;
		}
		fieldValues['repeat'] = serializeRepeatRule(repeatRule);
	}
	const rawRepeatEnd = (fieldValues['datetimeRepeatEnd'] ?? '').trim();
	if (rawRepeatEnd) {
		const repeatEnd = parseAbsoluteReminder(rawRepeatEnd);
		if (!repeatEnd.ok) {
			blockers.push({
				code: 'field-not-allowed',
				message: 'Recurrence end datetime is invalid.',
				itemKey,
				field: 'datetimeRepeatEnd',
			});
			return false;
		}
		fieldValues['datetimeRepeatEnd'] = repeatEnd.value.localDatetime;
	}
	return true;
}

function replaceFileTaskBody(content: string, bodyMarkdown: string): string {
	const frontmatterMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/u);
	return frontmatterMatch ? `${frontmatterMatch[1]}${bodyMarkdown}` : bodyMarkdown;
}

function buildSourceGroups(
	tasks: MutablePreparedTask[],
	sourceSnapshots: ReadonlyMap<string, TaskCreationSourceSnapshot>,
	blockers: TaskCreationBlocker[],
): PreparedTaskCreationSourceGroup[] | null {
	const tasksByPath = new Map<string, MutablePreparedTask[]>();
	for (const task of tasks) {
		const group = tasksByPath.get(task.filePath) ?? [];
		group.push(task);
		tasksByPath.set(task.filePath, group);
	}

	const groups: PreparedTaskCreationSourceGroup[] = [];
	for (const filePath of [...tasksByPath.keys()].sort((left, right) => left.localeCompare(right))) {
		const pathTasks = tasksByPath.get(filePath) ?? [];
		const snapshot = sourceSnapshots.get(filePath);
		if (!snapshot || pathTasks.length === 0) continue;
		let resultingContent = '';
		const fileTasks = pathTasks.filter(task => task.representation === 'file');
		const inlineTasks = pathTasks.filter(task => task.representation === 'inline');
		if (fileTasks.length > 1) {
			blockers.push({
				code: 'target-collision',
				message: 'One physical source can contain at most one File Task target per plan.',
				itemKey: fileTasks[1].itemKey,
				filePath,
			});
			continue;
		}
		if (fileTasks.length === 1) {
			resultingContent = fileTasks[0].renderedFileContent ?? '';
			fileTasks[0].lineNumber = undefined;
		} else {
			resultingContent = snapshot.content ?? '';
		}
		if (inlineTasks.length > 0) {
			const rendered = renderInlineSource(resultingContent, inlineTasks, blockers, pathTasks);
			if (!rendered) continue;
			resultingContent = rendered;
		}
		groups.push({
			groupId: `task-source:${filePath}`,
			filePath,
			expectedRevision: snapshot.revision,
			expectedState: snapshot.content === null ? 'absent' : 'present',
			expectedContent: snapshot.content,
			operation: snapshot.content === null ? 'create' : 'update',
			resultingContent,
			taskItemKeys: pathTasks
				.sort((left, right) => left.requestOrder - right.requestOrder)
				.map(task => task.itemKey),
		});
	}
	return blockers.length === 0 ? groups : null;
}

function renderInlineSource(
	sourceContent: string,
	tasks: MutablePreparedTask[],
	blockers: TaskCreationBlocker[],
	allPathTasks: MutablePreparedTask[] = tasks,
): string | null {
	const newline = sourceContent.includes('\r\n') ? '\r\n' : '\n';
	const trailingNewline = sourceContent.endsWith('\n');
	const lines = sourceContent.length === 0 ? [] : sourceContent.split(/\r?\n/u);
	if (trailingNewline) lines.pop();
	const insertions = new Map<number, MutablePreparedTask[]>();
	const pathTasksByItemKey = new Map(allPathTasks.map(task => [task.itemKey, task]));

	const headingTasks: MutablePreparedTask[] = [];
	const relativeTasks: MutablePreparedTask[] = [];
	for (const task of tasks.sort((left, right) => left.requestOrder - right.requestOrder)) {
		const placement = task.placement ?? { kind: 'append' };
		if (placement.kind === 'after-item') {
			relativeTasks.push(task);
			continue;
		}
		if (placement.kind === 'under-heading') {
			headingTasks.push(task);
			continue;
		}
		const lineNumber = placement.kind === 'append'
			? lines.length
			: placement.kind === 'before-line'
				? placement.lineNumber
				: placement.lineNumber + 1;
		if (
			!Number.isSafeInteger(lineNumber)
			|| lineNumber < 0
			|| lineNumber > lines.length
			|| (
				placement.kind !== 'append'
				&& (
					placement.lineNumber < 0
					|| placement.lineNumber >= lines.length
				)
			)
		) {
			blockers.push({
				code: 'invalid-insertion-line',
				message: 'The sealed inline insertion line is outside the preview source.',
				itemKey: task.itemKey,
				filePath: task.filePath,
			});
			continue;
		}
		const bucket = insertions.get(lineNumber) ?? [];
		bucket.push(task);
		insertions.set(lineNumber, bucket);
	}
	if (blockers.length > 0) return null;

	for (const lineNumber of [...insertions.keys()].sort((left, right) => right - left)) {
		const bucket = insertions.get(lineNumber) ?? [];
		lines.splice(lineNumber, 0, ...bucket.map(task => task.renderedTaskLine ?? ''));
	}
	let contentWithHeadings = lines.join('\n');
	for (const task of [...headingTasks].sort((left, right) => right.requestOrder - left.requestOrder)) {
		const placement = task.placement;
		if (placement?.kind !== 'under-heading') continue;
		contentWithHeadings = insertInlineTaskUnderFirstHeadingKeyword(
			contentWithHeadings,
			placement.headingKeyword,
			task.renderedTaskLine ?? '',
		).content;
	}
	const relativeChildrenByParent = new Map<string, MutablePreparedTask[]>();
	for (const task of relativeTasks) {
		const placement = task.placement;
		if (placement?.kind !== 'after-item') continue;
		const parent = pathTasksByItemKey.get(placement.itemKey);
		if (!parent?.renderedTaskLine) {
			blockers.push({
				code: 'invalid-insertion-line',
				message: 'The local inline parent could not be located in the prepared source.',
				itemKey: task.itemKey,
				filePath: task.filePath,
			});
			continue;
		}
		const children = relativeChildrenByParent.get(parent.itemKey) ?? [];
		children.push(task);
		relativeChildrenByParent.set(parent.itemKey, children);
	}
	if (blockers.length > 0) return null;
	for (const children of relativeChildrenByParent.values()) {
		children.sort((left, right) => left.requestOrder - right.requestOrder);
	}
	const taskByRenderedLine = new Map(
		allPathTasks.flatMap(task => (
			task.renderedTaskLine ? [[task.renderedTaskLine, task] as const] : []
		)),
	);
	const emittedRelativeTaskKeys = new Set<string>();
	const appendRelativeDescendants = (
		parent: MutablePreparedTask,
		output: string[],
		visiting: Set<string>,
	): void => {
		if (visiting.has(parent.itemKey)) return;
		visiting.add(parent.itemKey);
		for (const child of relativeChildrenByParent.get(parent.itemKey) ?? []) {
			if (!child.renderedTaskLine || emittedRelativeTaskKeys.has(child.itemKey)) continue;
			output.push(child.renderedTaskLine);
			emittedRelativeTaskKeys.add(child.itemKey);
			appendRelativeDescendants(child, output, visiting);
		}
		visiting.delete(parent.itemKey);
	};
	const expandedLines: string[] = [];
	for (const line of contentWithHeadings.split(/\r?\n/u)) {
		expandedLines.push(line);
		const task = taskByRenderedLine.get(line);
		if (task) appendRelativeDescendants(task, expandedLines, new Set());
	}
	if (emittedRelativeTaskKeys.size !== relativeTasks.length) {
		for (const task of relativeTasks) {
			if (emittedRelativeTaskKeys.has(task.itemKey)) continue;
			blockers.push({
				code: 'invalid-insertion-line',
				message: 'The local inline parent line is absent from the prepared source.',
				itemKey: task.itemKey,
				filePath: task.filePath,
			});
		}
		return null;
	}
	contentWithHeadings = expandedLines.join('\n');
	const finalLines = contentWithHeadings.split(/\r?\n/u);
	const firstLineByContent = new Map<string, number>();
	for (const [lineNumber, line] of finalLines.entries()) {
		if (!firstLineByContent.has(line)) firstLineByContent.set(line, lineNumber);
	}
	for (const task of tasks) {
		const lineNumber = firstLineByContent.get(task.renderedTaskLine ?? '');
		if (lineNumber === undefined) {
			blockers.push({
				code: 'invalid-insertion-line',
				message: 'The rendered inline task could not be located in the prepared source.',
				itemKey: task.itemKey,
				filePath: task.filePath,
			});
		} else {
			task.lineNumber = lineNumber;
		}
	}
	const renderedContent = newline === '\r\n'
		? contentWithHeadings.replace(/\n/gu, '\r\n')
		: contentWithHeadings;
	return `${renderedContent}${trailingNewline ? newline : ''}`;
}

function validateTemplate(item: CanonicalTaskCreationItem, blockers: TaskCreationBlocker[]): void {
	if (item.target.representation !== 'file' || !item.target.template) return;
	if (DYNAMIC_TEMPLATE_PATTERN.test(item.target.template.content)) {
		blockers.push({
			code: 'template-processing-required',
			message: 'Templates requiring Templater execution cannot be sealed deterministically.',
			itemKey: item.itemKey,
			filePath: item.target.source.filePath,
		});
	}
}

function resolveDeterministicTemplateVariables(
	content: string,
	filePath: string,
	description: string,
	fieldValues: Readonly<Record<string, string>>,
	now: string,
	resolveCoreVariables?: PrepareCanonicalTaskCreationOptions['resolveCoreTemplateVariables'],
): string {
	const basename = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.md$/u, '');
	const coreContext = {
			title: basename,
			date: now.slice(0, 10),
			now,
	};
	const coreResolved = resolveCoreVariables
		? resolveCoreVariables(content, coreContext)
		: resolvePortableCoreTemplateVariables(content, coreContext);
	const values: Record<string, string> = {
		date: now.slice(0, 10),
		time: now.slice(11, 16),
		datetime: now,
		taskDescription: description,
		note: fieldValues['note'] ?? '',
		dateStarted: fieldValues['dateStarted'] ?? '',
		dateScheduled: fieldValues['dateScheduled'] ?? '',
		dateDue: fieldValues['dateDue'] ?? '',
		status: fieldValues['status'] ?? '',
		priority: fieldValues['priority'] ?? '',
	};
	let inFencedCodeBlock = false;
	return coreResolved.split('\n').map(line => {
		if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			return line;
		}
		if (inFencedCodeBlock) return line;
		return line.replace(
			/\{\{(date|time|datetime|taskDescription|note|dateStarted|dateScheduled|dateDue|status|priority)\}\}/gu,
			(_match, key: string) => values[key] ?? '',
		);
	}).join('\n');
}

function resolvePortableCoreTemplateVariables(
	content: string,
	context: { title: string; date: string; now: string },
): string {
	let inFencedCodeBlock = false;
	return content.split('\n').map(line => {
		if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			return line;
		}
		if (inFencedCodeBlock) return line;
		return line.replace(/\{\{(title|date|time)\}\}/gu, (_match, key: string) => {
			if (key === 'title') return context.title;
			if (key === 'date') return context.date;
			return context.now.slice(11, 16);
		});
	}).join('\n');
}

function containsUnresolvedTemplateVariableOutsideFences(content: string): boolean {
	let inFencedCodeBlock = false;
	for (const line of content.split('\n')) {
		if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (!inFencedCodeBlock && UNRESOLVED_TEMPLATE_VARIABLE_PATTERN.test(line)) return true;
	}
	return false;
}

function resolveReference(
	reference: TaskCreationReference | undefined,
	allocatedIds: ReadonlyMap<string, string>,
): string | undefined {
	if (!reference) return undefined;
	return reference.kind === 'existing' ? reference.operonId : allocatedIds.get(reference.itemKey);
}

function resolveParentContext(
	parent: TaskCreationReference | undefined,
	preparedByKey: ReadonlyMap<string, MutablePreparedTask>,
	existingTasks: ReadonlyMap<string, ExistingTaskCreationContext>,
): ExistingTaskCreationContext | undefined {
	if (!parent) return undefined;
	if (parent.kind === 'existing') return existingTasks.get(parent.operonId);
	const prepared = preparedByKey.get(parent.itemKey);
	return prepared
		? {
			operonId: prepared.operonId,
			fieldValues: prepared.fieldValues,
			tags: prepared.tags,
		}
		: undefined;
}

function normalizeDescription(value: string): string {
	const trimmed = value.trim();
	return containsDisallowedControlCharacter(trimmed)
		? ''
		: trimmed.replace(/\r?\n/gu, ' ');
}

function normalizeTags(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const tag = value.trim().replace(/^#/, '').trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		result.push(tag);
	}
	return result;
}

function validateTargetPath(filePath: string): string | null {
	if (!filePath || filePath !== filePath.trim()) return 'Target path must be non-empty and trimmed.';
	if (filePath.normalize('NFC') !== filePath) return 'Target path must be NFC-normalized.';
	if (
		filePath.startsWith('/')
		|| filePath.startsWith('~')
		|| filePath.includes('\\')
		|| /^[A-Za-z]:/u.test(filePath)
		|| containsControlCharacter(filePath)
	) {
		return 'Target path must be a portable vault-relative path.';
	}
	const segments = filePath.split('/');
	if (
		segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
	) {
		return 'Target path cannot contain empty, traversal, or hidden segments.';
	}
	if (!filePath.toLowerCase().endsWith('.md')) return 'Task creation targets must be Markdown files.';
	return null;
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function containsDisallowedControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		const allowedLineBreak = code === 10 || code === 13;
		if ((!allowedLineBreak && code <= 31) || code === 127) return true;
	}
	return false;
}

function cloneItem(item: CanonicalTaskCreationItem): CanonicalTaskCreationItem {
	return {
		...item,
		target: item.target.representation === 'inline'
			? {
				...item.target,
				source: { ...item.target.source },
				placement: { ...item.target.placement },
			}
			: {
				...item.target,
				source: { ...item.target.source },
				template: item.target.template ? { ...item.target.template } : undefined,
			},
		fields: item.fields ? { ...item.fields } : undefined,
		tags: item.tags ? [...item.tags] : item.tags,
		parent: item.parent ? { ...item.parent } : undefined,
		related: item.related?.map(reference => ({ ...reference })),
		dependencies: item.dependencies?.map(dependency => ({
			relation: dependency.relation,
			target: { ...dependency.target },
		})),
	};
}

function stripMutableTask(task: MutablePreparedTask): PreparedTaskCreationTask {
	return {
		itemKey: task.itemKey,
		operonId: task.operonId,
		description: task.description,
		representation: task.representation,
		filePath: task.filePath,
		...(task.lineNumber === undefined ? {} : { lineNumber: task.lineNumber }),
		checkbox: task.checkbox,
		fieldValues: { ...task.fieldValues },
		tags: [...task.tags],
		...(task.renderedTaskLine === undefined ? {} : { renderedTaskLine: task.renderedTaskLine }),
		...(task.renderedFileContent === undefined ? {} : { renderedFileContent: task.renderedFileContent }),
		...(task.parentOperonId === undefined ? {} : { parentOperonId: task.parentOperonId }),
		relatedOperonIds: [...task.relatedOperonIds],
		resolvedDependencies: task.resolvedDependencies.map(dependency => ({ ...dependency })),
		...(task.bodyMarkdown === undefined ? {} : { bodyMarkdown: task.bodyMarkdown }),
		...(task.template === undefined ? {} : { template: { ...task.template } }),
	};
}
