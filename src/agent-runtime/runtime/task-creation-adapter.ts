import type {
	CreateFieldItemV1,
	CreateTaskItemV1,
	CreateTaskSpecV1,
	SealedCreateEffectV1,
} from '../contracts/v1/mutation';
import { sha256HexV1 } from '../contracts/v1/canonical';
import {
	normalizeInlineTaskParentFileHeadingKeyword,
	type OperonSettings,
} from '../../types/settings';
import type {
	CanonicalTaskCreationItem,
	DeterministicFileTaskTemplate,
	ExistingTaskCreationContext,
	InlineTaskCreationPlacement,
	PreparedCanonicalTaskCreationPlan,
	TaskCreationSourceSnapshot,
} from '../../core/task-creation-domain';
import {
	prepareCanonicalTaskCreation,
} from '../../core/task-creation-domain';
import {
	buildMergedFileTaskDraft,
	parseFrontmatterDocument,
} from '../../core/file-task-template-merge';
import { resolveFileTaskDefaults } from '../../core/file-task-defaults';
import {
	parseDependencyIdList,
	serializeDependencyIdList,
} from '../../core/dependency-graph';
import { parseTaskLine } from '../../core/parser';
import { serializeTask } from '../../core/serializer';
import { tryPatchAggregateYamlFrontmatter } from '../../core/task-writer-yaml';
import { composeStatusValue } from '../../core/workflow-status-value';
import { canonicalizeLocalDatetime } from '../../core/local-time';
import {
	isGeneralUpdateFieldV1,
	type FieldDescriptorV1,
} from '../contracts/v1/catalog';
import {
	canonicalizeAbsoluteReminderList,
	canonicalizeReminderRuleList,
	parseAbsoluteReminder,
	resolveReminderRule,
} from '../../core/reminder-rules';
import { parseRepeatRule, serializeRepeatRule } from '../../core/repeat-rule';
import { deriveTemporalTemplateFromTask } from '../../systems/recurrence-domain';
import {
	detectRepeatSeriesNamingConfig,
	type RepeatSeriesNamingConfig,
} from '../../systems/recurring-file-naming';
import type { RepeatTemporalTemplate } from '../../storage/repeat-series-store';
import { isBlankMarkdownBodyLine } from '../../core/markdown-body';

const ABSENT_SOURCE_PREFIX = 'operon-absent-source-v1:';
const CONFIGURED_TEMPORAL_CREATION_FIELDS = new Set([
	'reminderDatetimes',
	'reminderRules',
	'repeat',
	'datetimeRepeatEnd',
]);

export interface RuntimeTaskCreationSourceV1 {
	filePath: string;
	content: string | null;
}

export interface RuntimeTaskCreationExistingTaskV1 extends ExistingTaskCreationContext {
	duplicate: boolean;
	filePath: string;
	representation: 'inline' | 'file';
	lineNumber?: number;
}

export interface RuntimeTaskCreationParentTargetV1 {
	filePath: string;
	representation: 'inline' | 'file';
	lineNumber?: number;
}

export interface RuntimeTaskCreationAdapterPortsV1 {
	settings(): Readonly<OperonSettings>;
	listOperonIds(): ReadonlySet<string>;
	listDependencyGraphTasks(): readonly ExistingTaskCreationContext[];
	getExistingTask(operonId: string): RuntimeTaskCreationExistingTaskV1 | null;
	readSource(filePath: string): Promise<RuntimeTaskCreationSourceV1>;
	resolveConfiguredInlineTarget(parent: RuntimeTaskCreationParentTargetV1 | null): Promise<{
		filePath: string;
		placement: InlineTaskCreationPlacement;
		defaultFields?: Readonly<Record<string, string>>;
	}>;
	resolveConfiguredFilePath(
		description: string,
		parent: RuntimeTaskCreationParentTargetV1 | null,
	): Promise<string>;
	readTemplate(templateId: string): Promise<DeterministicFileTaskTemplate | null>;
	creationFieldCatalog(): readonly FieldDescriptorV1[];
	resolveCoreTemplateVariables(
		content: string,
		context: { title: string; date: string; now: string },
	): string;
	generateOperonId(): string;
	listRepeatSeriesIds?(): ReadonlySet<string>;
	generateRepeatSeriesId?(usedIds: ReadonlySet<string>): string;
	repeatSeriesRevision?(): string;
	now(): string;
}

export interface RuntimeTaskCreationCompensationPortsV1<TStateTransaction> {
	rollbackState(transaction: TStateTransaction): Promise<boolean>;
	rollbackSource(): Promise<boolean>;
	reindexSource(): Promise<void>;
}

export async function compensateRuntimeTaskCreationFailureV1<TStateTransaction>(
	stateTransaction: TStateTransaction | null,
	ports: RuntimeTaskCreationCompensationPortsV1<TStateTransaction>,
): Promise<'failed' | 'outcome-unknown'> {
	if (stateTransaction !== null) {
		let stateRolledBack = false;
		try {
			stateRolledBack = await ports.rollbackState(stateTransaction);
		} catch {
			return 'outcome-unknown';
		}
		if (!stateRolledBack) return 'outcome-unknown';
	}
	try {
		if (!(await ports.rollbackSource())) return 'outcome-unknown';
		await ports.reindexSource();
		return 'failed';
	} catch {
		return 'outcome-unknown';
	}
}

export type RuntimeTaskCreationPreparationV1 =
	| {
		ok: true;
		plan: PreparedCanonicalTaskCreationPlan;
		createEffects: SealedCreateEffectV1[];
		parentResources: Array<{
			operonId: string;
			filePath: string;
			sourceRevision: string;
			sourceContent: string;
			format: 'inline' | 'yaml';
			lineNumber?: number;
		}>;
		dependencyResources: Array<{
			operonId: string;
			filePath: string;
			format: 'inline' | 'yaml';
			lineNumber?: number;
			additions: {
				blocking: string[];
				blockedBy: string[];
			};
			expectedModifiedAt: string;
		}>;
		sourceGroupGraph: {
			sourceOrder: string[];
			edges: Array<{
				fromFilePath: string;
				toFilePath: string;
				relation: 'parent' | 'related';
			}>;
			crossSourcePartialRisk: boolean;
		};
		recurrenceResources: Array<{
			itemRef: string;
			operonId: string;
			seriesId: string;
			filePath: string;
			sourceFormat: 'inline' | 'yaml';
			baseTitle: string | null;
			lastMaterializedTitle: string;
			naming: RepeatSeriesNamingConfig;
			baseTemporalTemplate: RepeatTemporalTemplate;
			revision: string;
		}>;
	}
	| {
		ok: false;
		code: 'invalid-request' | 'field-not-writable' | 'stale-source' | 'capability-unavailable';
		reason: string;
		details?: Record<string, string | number | boolean>;
	};

export async function prepareRuntimeTaskCreationV1(
	requestId: string,
	spec: CreateTaskSpecV1,
	ports: RuntimeTaskCreationAdapterPortsV1,
	sealedIds?: ReadonlyMap<string, string>,
	effectiveAt?: string,
	activeItemRefs?: ReadonlySet<string>,
	sealedSeriesIds?: ReadonlyMap<string, string>,
): Promise<RuntimeTaskCreationPreparationV1> {
	const settings = ports.settings();
	const creationFieldCatalog = [...ports.creationFieldCatalog()];
	const sourceSnapshots = new Map<string, Promise<RuntimeTaskCreationSourceV1>>();
	const preparedSourceSnapshots = new Map<string, Promise<TaskCreationSourceSnapshot>>();
	const readSource = async (filePath: string): Promise<RuntimeTaskCreationSourceV1> => {
		let pending = sourceSnapshots.get(filePath);
		if (!pending) {
			pending = ports.readSource(filePath).then(source => Object.freeze({
				filePath: source.filePath,
				content: source.content,
			}));
			sourceSnapshots.set(filePath, pending);
		}
		return await pending;
	};
	const readSourceSnapshot = async (filePath: string): Promise<TaskCreationSourceSnapshot> => {
		let pending = preparedSourceSnapshots.get(filePath);
		if (!pending) {
			pending = readSource(filePath).then(source => {
				if (source.filePath !== filePath) {
					throw new CreationAdapterError(
						'stale-source',
						'The canonical source path changed while preparing task creation.',
					);
				}
				return {
					filePath,
					content: source.content,
					revision: sourceRevisionForTaskCreationV1(filePath, source.content),
				};
			});
			preparedSourceSnapshots.set(filePath, pending);
		}
		return await pending;
	};
	const preparationPorts: RuntimeTaskCreationAdapterPortsV1 = {
		...ports,
		readSource,
		creationFieldCatalog: () => creationFieldCatalog,
	};
	const itemsForPreparation = activeItemRefs
		? spec.items
			.filter(item => activeItemRefs.has(item.itemRef))
			.map(item => rewriteCommittedLocalReferences(item, activeItemRefs, sealedIds))
		: spec.items;
	const existingTasks = new Map<string, ExistingTaskCreationContext>();
	const existingParentIds = new Set<string>();
	for (const item of itemsForPreparation) {
		for (const reference of [
			item.parent,
			...(item.related ?? []),
			...(item.dependencies ?? []).map(dependency => dependency.target),
		]) {
			if (!reference || reference.kind !== 'existing') continue;
			const task = ports.getExistingTask(reference.operonId);
			if (!task || task.duplicate) {
				return {
					ok: false,
					code: 'invalid-request',
					reason: `Existing task reference is missing or ambiguous: ${reference.operonId}`,
				};
			}
			existingTasks.set(reference.operonId, task);
		}
		if (item.parent?.kind === 'existing') existingParentIds.add(item.parent.operonId);
	}
	const hierarchyResourceIds = new Set(existingParentIds);
	for (const parentId of [...existingParentIds]) {
		let currentId = parentId;
		const visited = new Set<string>();
		while (currentId && !visited.has(currentId)) {
			visited.add(currentId);
			const current = ports.getExistingTask(currentId);
			if (!current || current.duplicate) {
				return {
					ok: false,
					code: 'stale-source',
					reason: `Existing parent hierarchy became unavailable: ${currentId}`,
				};
			}
			existingTasks.set(currentId, current);
			hierarchyResourceIds.add(currentId);
			currentId = (current.fieldValues['parentTask'] ?? '').trim();
		}
	}

	const itemsByRef = new Map(itemsForPreparation.map(item => [item.itemRef, item]));
	const allocatedSeriesIds = new Map<string, string>();
	const adaptedByRef = new Map<string, CanonicalTaskCreationItem>();
	try {
		while (adaptedByRef.size < itemsForPreparation.length) {
			let progressed = false;
			for (const item of itemsForPreparation) {
				if (adaptedByRef.has(item.itemRef)) continue;
				const localParent = item.parent?.kind === 'created'
					? adaptedByRef.get(item.parent.itemRef)
					: undefined;
				if (item.parent?.kind === 'created' && !localParent) continue;
				adaptedByRef.set(
					item.itemRef,
					await adaptCreateItem(
						item,
						settings,
						preparationPorts,
						localParent,
						readSourceSnapshot,
					),
				);
				progressed = true;
			}
			if (!progressed) {
				throw new CreationAdapterError(
					'invalid-request',
					'Create parent references are missing or cyclic.',
				);
			}
		}
	} catch (error) {
		return {
			ok: false,
			code: error instanceof CreationAdapterError ? error.code : 'invalid-request',
			reason: error instanceof Error ? error.message : 'Task creation input could not be resolved.',
		};
	}
	let items = itemsForPreparation.map(item => {
		const adapted = adaptedByRef.get(item.itemRef);
		if (!adapted || !itemsByRef.has(item.itemRef)) {
			throw new CreationAdapterError('invalid-request', 'Create item adaptation became incomplete.');
		}
		return adapted;
	});

	const prepareCanonical = (
		canonicalItems: readonly CanonicalTaskCreationItem[],
		ids: ReadonlyMap<string, string> | undefined,
	) => {
		const sealedIdQueue = ids
			? itemsForPreparation.map(item => ids.get(item.itemRef) ?? '')
			: [];
		let generatedIndex = 0;
		return prepareCanonicalTaskCreation({ requestId, items: canonicalItems }, {
			settings,
			now: effectiveAt ?? ports.now(),
			existingOperonIds: ports.listOperonIds(),
			existingTasks,
			dependencyGraphTasks: itemsForPreparation.some(item => (item.dependencies?.length ?? 0) > 0)
				? ports.listDependencyGraphTasks()
				: undefined,
			generateOperonId: () => (
				ids
					? sealedIdQueue[generatedIndex++] ?? ''
					: ports.generateOperonId()
			),
			resolveCoreTemplateVariables: (content, context) => (
				ports.resolveCoreTemplateVariables(content, context)
			),
			allowedFieldKeys: creationFieldCatalog
				.filter(isGeneralUpdateFieldV1)
				.map(field => field.canonicalKey)
				.concat('status', 'priority'),
		});
	};
	let result = prepareCanonical(items, sealedIds);
	if (!result.ok) {
		const fieldBlocker = result.blockers.find(blocker => blocker.code === 'field-not-allowed');
		return {
			ok: false,
			code: fieldBlocker ? 'field-not-writable' : 'invalid-request',
			reason: result.blockers.map(blocker => blocker.message).join(' '),
			details: {
				blockerCount: result.blockers.length,
			},
		};
	}
	const recurrenceItemRefs = result.plan.tasks
		.filter(task => !!parseRepeatRule(task.fieldValues['repeat']))
		.map(task => task.itemKey);
	if (recurrenceItemRefs.length > 0) {
		if (
			!ports.listRepeatSeriesIds
			|| !ports.generateRepeatSeriesId
			|| !ports.repeatSeriesRevision
		) {
			return {
				ok: false,
				code: 'field-not-writable',
				reason: 'Recurrence creation storage is unavailable.',
			};
		}
		const usedSeriesIds = new Set(ports.listRepeatSeriesIds());
		for (const itemRef of recurrenceItemRefs) {
			const seriesId = sealedSeriesIds
				? sealedSeriesIds.get(itemRef) ?? ''
				: ports.generateRepeatSeriesId(usedSeriesIds);
			if (!seriesId || usedSeriesIds.has(seriesId)) {
				return {
					ok: false,
					code: sealedSeriesIds ? 'stale-source' : 'invalid-request',
					reason: `Repeat series identity is unavailable or already exists for ${itemRef}.`,
				};
			}
			usedSeriesIds.add(seriesId);
			allocatedSeriesIds.set(itemRef, seriesId);
		}
		items = items.map(item => {
			const seriesId = allocatedSeriesIds.get(item.itemKey);
			return seriesId
				? {
					...item,
					runtimeFields: {
						...item.runtimeFields,
						repeatSeriesId: seriesId,
					},
				}
				: item;
		});
		const sealedTaskIds = new Map(result.plan.tasks.map(task => [task.itemKey, task.operonId]));
		result = prepareCanonical(items, sealedTaskIds);
		if (!result.ok) {
			const fieldBlocker = result.blockers.find(blocker => blocker.code === 'field-not-allowed');
			return {
				ok: false,
				code: fieldBlocker ? 'field-not-writable' : 'invalid-request',
				reason: result.blockers.map(blocker => blocker.message).join(' '),
				details: { blockerCount: result.blockers.length },
			};
		}
	}
	const effectiveNow = effectiveAt ?? ports.now();
	for (const task of result.plan.tasks) {
		const reminderDatetimes = splitTemporalList(task.fieldValues['reminderDatetimes']);
		for (const reminderDatetime of reminderDatetimes) {
			const parsed = parseAbsoluteReminder(reminderDatetime);
			if (!parsed.ok || parsed.value.epochMs <= new Date(effectiveNow).getTime()) {
				return {
					ok: false,
					code: 'invalid-request',
					reason: 'Absolute reminder datetimes must be valid and in the future.',
				};
			}
		}
		for (const reminderRule of splitTemporalList(task.fieldValues['reminderRules'])) {
			const resolution = resolveReminderRule(reminderRule, task.fieldValues);
			if (resolution.status !== 'resolved') {
				return {
					ok: false,
					code: 'invalid-request',
					reason: resolution.status === 'missing-anchor'
						? `Reminder rule requires a populated ${resolution.anchor} anchor.`
						: 'Reminder rule or its date anchor is invalid.',
				};
			}
		}
	}
	let parentResources: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['parentResources'] = [];
	for (const operonId of [...hierarchyResourceIds].sort()) {
		const task = ports.getExistingTask(operonId);
		if (!task || task.duplicate) {
			return {
				ok: false,
				code: 'stale-source',
				reason: `Existing parent became unavailable while preparing task creation: ${operonId}`,
			};
		}
		const source = await readSource(task.filePath);
		if (source.content === null) {
			return {
				ok: false,
				code: 'stale-source',
				reason: `Existing parent source is unavailable: ${operonId}`,
			};
		}
		parentResources.push({
			operonId,
			filePath: task.filePath,
			sourceRevision: sourceRevisionForTaskCreationV1(task.filePath, source.content),
			sourceContent: source.content,
			format: task.representation === 'file' ? 'yaml' : 'inline',
			...(task.lineNumber === undefined ? {} : { lineNumber: task.lineNumber }),
		});
	}
	let plan = result.plan;
	let dependencyResources: Extract<
		RuntimeTaskCreationPreparationV1,
		{ ok: true }
	>['dependencyResources'] = [];
	try {
		plan = applyPreparedParentTimestampPatches(
			plan,
			parentResources,
			effectiveAt ?? ports.now(),
			settings.keyMappings,
		);
		const dependencyProjection = await applyPreparedDependencyPatches(
			plan,
			itemsForPreparation,
			preparationPorts,
			effectiveAt ?? ports.now(),
			settings,
		);
		plan = dependencyProjection.plan;
		dependencyResources = dependencyProjection.resources;
		parentResources = projectPreparedParentResourceLocators(
			plan,
			parentResources,
			settings.keyMappings,
		);
	} catch (error) {
		return {
			ok: false,
			code: error instanceof CreationAdapterError ? error.code : 'stale-source',
			reason: error instanceof Error ? error.message : 'Parent timestamp projection failed.',
		};
	}
	let sourceGroupGraph: Extract<
		RuntimeTaskCreationPreparationV1,
		{ ok: true }
	>['sourceGroupGraph'];
	try {
		sourceGroupGraph = buildCreationSourceGroupGraph(
			plan,
			itemsForPreparation,
			parentResources,
			preparationPorts,
		);
	} catch (error) {
		return {
			ok: false,
			code: error instanceof CreationAdapterError ? error.code : 'invalid-request',
			reason: error instanceof Error
				? error.message
				: 'Creation source groups could not be ordered safely.',
			...(error instanceof CreationAdapterError && error.code === 'capability-unavailable'
				? {
					details: {
						feature: 'cross-source-parent-related-order',
						requiredScope: 'acyclic-source-graph',
					},
				}
				: {}),
		};
	}
	const recurrenceRevision = allocatedSeriesIds.size > 0
		? ports.repeatSeriesRevision?.()
		: undefined;
	if (allocatedSeriesIds.size > 0 && !recurrenceRevision) {
		return {
			ok: false,
			code: 'stale-source',
			reason: 'Repeat series revision became unavailable during preparation.',
		};
	}
	const recurrenceResources = plan.tasks.flatMap(task => {
		const seriesId = allocatedSeriesIds.get(task.itemKey);
		const fileBaseName = task.filePath.split('/').pop()?.replace(/\.md$/iu, '') ?? task.description;
		const materializedTitle = task.representation === 'file' ? fileBaseName : task.description.trim();
		return seriesId ? [{
			itemRef: task.itemKey,
			operonId: task.operonId,
			seriesId,
			filePath: task.filePath,
			sourceFormat: task.representation === 'file' ? 'yaml' as const : 'inline' as const,
			baseTitle: task.representation === 'file'
				? fileBaseName.replace(/ - \d{4}-\d{2}-\d{2}(?: \(\d+\))?$/u, '').trim() || fileBaseName
				: null,
			lastMaterializedTitle: materializedTitle,
			naming: detectRepeatSeriesNamingConfig(materializedTitle),
			baseTemporalTemplate: deriveTemporalTemplateFromTask(task),
			revision: recurrenceRevision!,
		}] : [];
	});
	return {
		ok: true,
		plan,
		createEffects: createSealedEffects(plan),
		parentResources,
		dependencyResources,
		sourceGroupGraph,
		recurrenceResources,
	};
}

function createSealedEffects(
	plan: PreparedCanonicalTaskCreationPlan,
): SealedCreateEffectV1[] {
	const sourceGroups = new Map(plan.sourceGroups.map(group => [group.filePath, group]));
	const plannedSourceDigests = new Map(plan.sourceGroups.map(group => [
		group.filePath,
		sha256HexV1(group.resultingContent),
	]));
	return plan.tasks.map(task => {
		const sourceGroup = sourceGroups.get(task.filePath);
		const plannedSourceDigest = plannedSourceDigests.get(task.filePath);
		if (!sourceGroup || !plannedSourceDigest) {
			throw new Error(`Prepared source group is missing for ${task.itemKey}.`);
		}
		return createSealedEffect(task, sourceGroup, plannedSourceDigest);
	});
}

function buildCreationSourceGroupGraph(
	plan: PreparedCanonicalTaskCreationPlan,
	items: readonly CreateTaskItemV1[],
	parentResources: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['parentResources'],
	ports: RuntimeTaskCreationAdapterPortsV1,
): Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['sourceGroupGraph'] {
	const sourcePaths = new Set([
		...plan.sourceGroups.map(group => group.filePath),
		...parentResources.map(resource => resource.filePath),
	]);
	const tasksByRef = new Map(plan.tasks.map(task => [task.itemKey, task]));
	const parentSourceById = new Map(
		parentResources.map(resource => [resource.operonId, resource.filePath]),
	);
	const edges: Extract<
		RuntimeTaskCreationPreparationV1,
		{ ok: true }
	>['sourceGroupGraph']['edges'] = [];
	const edgeKeys = new Set<string>();
	const addEdge = (
		fromFilePath: string | undefined,
		toFilePath: string | undefined,
		relation: 'parent' | 'related',
	) => {
		if (!fromFilePath || !toFilePath || fromFilePath === toFilePath) return;
		sourcePaths.add(fromFilePath);
		sourcePaths.add(toFilePath);
		const key = `${fromFilePath}\0${toFilePath}\0${relation}`;
		if (edgeKeys.has(key)) return;
		edgeKeys.add(key);
		edges.push({ fromFilePath, toFilePath, relation });
	};
	const resolveReferenceSource = (
		reference: NonNullable<CreateTaskItemV1['parent']>,
	): string | undefined => (
		reference.kind === 'created'
			? tasksByRef.get(reference.itemRef)?.filePath
			: parentSourceById.get(reference.operonId)
				?? ports.getExistingTask(reference.operonId)?.filePath
	);
	for (const item of items) {
		const ownerPath = tasksByRef.get(item.itemRef)?.filePath;
		if (item.parent) {
			addEdge(resolveReferenceSource(item.parent), ownerPath, 'parent');
		}
		for (const related of item.related ?? []) {
			if (related.kind === 'created') {
				addEdge(resolveReferenceSource(related), ownerPath, 'related');
			}
		}
	}
	for (const parent of parentResources) {
		const ancestorId = (ports.getExistingTask(parent.operonId)?.fieldValues['parentTask'] ?? '').trim();
		if (ancestorId) {
			addEdge(parentSourceById.get(ancestorId), parent.filePath, 'parent');
		}
	}
	edges.sort((left, right) => (
		left.fromFilePath.localeCompare(right.fromFilePath)
			|| left.toFilePath.localeCompare(right.toFilePath)
			|| left.relation.localeCompare(right.relation)
	));

	const adjacency = new Map<string, Set<string>>(
		[...sourcePaths].map(filePath => [filePath, new Set<string>()]),
	);
	const indegree = new Map([...sourcePaths].map(filePath => [filePath, 0]));
	for (const edge of edges) {
		const targets = adjacency.get(edge.fromFilePath);
		if (!targets || targets.has(edge.toFilePath)) continue;
		targets.add(edge.toFilePath);
		indegree.set(edge.toFilePath, (indegree.get(edge.toFilePath) ?? 0) + 1);
	}
	const ready = [...sourcePaths]
		.filter(filePath => indegree.get(filePath) === 0)
		.sort((left, right) => left.localeCompare(right));
	const sourceOrder: string[] = [];
	while (ready.length > 0) {
		const filePath = ready.shift()!;
		sourceOrder.push(filePath);
		for (const target of [...(adjacency.get(filePath) ?? [])].sort()) {
			const nextIndegree = (indegree.get(target) ?? 0) - 1;
			indegree.set(target, nextIndegree);
			if (nextIndegree === 0) {
				ready.push(target);
				ready.sort((left, right) => left.localeCompare(right));
			}
		}
	}
	if (sourceOrder.length !== sourcePaths.size) {
		throw new CreationAdapterError(
			'capability-unavailable',
			'Cross-source parent or created-related graph contains a source-order cycle.',
		);
	}
	return {
		sourceOrder,
		edges,
		crossSourcePartialRisk: sourcePaths.size > 1,
	};
}

function applyPreparedParentTimestampPatches(
	plan: PreparedCanonicalTaskCreationPlan,
	parents: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['parentResources'],
	modifiedAt: string,
	keyMappings: Readonly<OperonSettings['keyMappings']>,
): PreparedCanonicalTaskCreationPlan {
	const sourceGroups = plan.sourceGroups.map(group => {
		let content = group.resultingContent;
		for (const parent of parents.filter(resource => resource.filePath === group.filePath)) {
			if (parent.format === 'yaml') {
				const patch = tryPatchAggregateYamlFrontmatter(
					content,
					parent.operonId,
					{ datetimeModified: modifiedAt },
					[...keyMappings],
				);
				if (!patch.ok) {
					throw new Error(`Existing File Task parent could not be projected: ${parent.operonId}`);
				}
				content = patch.content;
				continue;
			}
			const lines = content.split('\n');
			let lineNumber = parent.lineNumber ?? -1;
			let parsed = lineNumber >= 0
				? parseTaskLine(lines[lineNumber] ?? '', lineNumber, group.filePath, [...keyMappings])
				: null;
			if (parsed?.operonId !== parent.operonId) {
				lineNumber = lines.findIndex((line, index) => (
					parseTaskLine(line, index, group.filePath, [...keyMappings])?.operonId === parent.operonId
				));
				parsed = lineNumber >= 0
					? parseTaskLine(lines[lineNumber], lineNumber, group.filePath, [...keyMappings])
					: null;
			}
			if (!parsed || parsed.operonId !== parent.operonId) {
				throw new Error(`Existing inline parent could not be projected: ${parent.operonId}`);
			}
			const existing = parsed.fields.find(field => field.key === 'datetimeModified');
			if (existing) {
				existing.value = modifiedAt;
				existing.rawValue = modifiedAt;
			} else {
				parsed.fields.push({
					sourceKey: 'datetimeModified',
					key: 'datetimeModified',
					value: modifiedAt,
					rawValue: modifiedAt,
					type: 'datetime',
					isCanonical: true,
					containerRange: { from: 0, to: 0 },
					valueRange: { from: 0, to: 0 },
				});
			}
			lines[lineNumber] = serializeTask(parsed, [...keyMappings]);
			content = lines.join('\n');
		}
		return content === group.resultingContent ? group : { ...group, resultingContent: content };
	});
	return { ...plan, sourceGroups };
}

function projectPreparedParentResourceLocators(
	plan: PreparedCanonicalTaskCreationPlan,
	parents: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['parentResources'],
	keyMappings: Readonly<OperonSettings['keyMappings']>,
): Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['parentResources'] {
	return parents.map(parent => {
		if (parent.format === 'yaml') return parent;
		const sourceGroup = plan.sourceGroups.find(group => group.filePath === parent.filePath);
		if (!sourceGroup) return parent;
		const lines = sourceGroup.resultingContent.split(/\r?\n/u);
		const lineNumber = lines.findIndex((line, index) => (
			parseTaskLine(line, index, parent.filePath, [...keyMappings])?.operonId
				=== parent.operonId
		));
		if (lineNumber < 0) {
			throw new Error(`Existing inline parent could not be projected: ${parent.operonId}`);
		}
		return { ...parent, lineNumber };
	});
}

async function applyPreparedDependencyPatches(
	plan: PreparedCanonicalTaskCreationPlan,
	items: readonly CreateTaskItemV1[],
	ports: RuntimeTaskCreationAdapterPortsV1,
	modifiedAt: string,
	settings: Readonly<OperonSettings>,
): Promise<{
	plan: PreparedCanonicalTaskCreationPlan;
	resources: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>['dependencyResources'];
}> {
	const createdIds = new Map(plan.tasks.map(task => [task.itemKey, task.operonId]));
	const patchesByTarget = new Map<string, { blocking: string[]; blockedBy: string[] }>();
	for (const item of items) {
		const ownerId = createdIds.get(item.itemRef);
		if (!ownerId) continue;
		for (const dependency of item.dependencies ?? []) {
			if (dependency.target.kind !== 'existing') continue;
			const targetId = dependency.target.operonId;
			const patch = patchesByTarget.get(targetId) ?? { blocking: [], blockedBy: [] };
			const field = dependency.relation === 'blocks' ? 'blockedBy' : 'blocking';
			if (!patch[field].includes(ownerId)) patch[field].push(ownerId);
			patchesByTarget.set(targetId, patch);
		}
	}
	if (patchesByTarget.size === 0) return { plan, resources: [] };

	const sourceGroups = new Map(plan.sourceGroups.map(group => [group.filePath, group]));
	const sourceCache = new Map<string, RuntimeTaskCreationSourceV1>();
	const resources: Extract<
		RuntimeTaskCreationPreparationV1,
		{ ok: true }
	>['dependencyResources'] = [];
	for (const [operonId, patch] of [...patchesByTarget.entries()].sort()) {
		const task = ports.getExistingTask(operonId);
		if (!task || task.duplicate) {
			throw new Error(`Dependency target became unavailable or ambiguous: ${operonId}`);
		}
		let source = sourceCache.get(task.filePath);
		if (!source) {
			source = await ports.readSource(task.filePath);
			if (source.filePath !== task.filePath || source.content === null) {
				throw new Error(`Dependency target source became unavailable: ${operonId}`);
			}
			sourceCache.set(task.filePath, source);
		}
		const existingGroup = sourceGroups.get(task.filePath);
		const sourceContent = source.content;
		if (sourceContent === null) {
			throw new Error(`Dependency target source became unavailable: ${operonId}`);
		}
		const startingContent = existingGroup?.resultingContent ?? sourceContent;
		const resultingContent = patchExistingDependencyTaskSource(
			startingContent,
			task,
			patch,
			modifiedAt,
			settings,
		);
		resources.push({
			operonId,
			filePath: task.filePath,
			format: task.representation === 'file' ? 'yaml' : 'inline',
			...(task.lineNumber === undefined ? {} : { lineNumber: task.lineNumber }),
			additions: {
				blocking: [...patch.blocking],
				blockedBy: [...patch.blockedBy],
			},
			expectedModifiedAt: modifiedAt,
		});
		sourceGroups.set(task.filePath, existingGroup
			? { ...existingGroup, resultingContent }
			: {
				groupId: `task-source:${task.filePath}`,
				filePath: task.filePath,
				expectedRevision: sourceRevisionForTaskCreationV1(task.filePath, source.content),
				expectedState: 'present',
				expectedContent: source.content,
				operation: 'update',
				resultingContent,
				taskItemKeys: [],
			});
	}
	return {
		plan: {
			...plan,
			sourceGroups: [...sourceGroups.values()].sort((left, right) => left.filePath.localeCompare(right.filePath)),
		},
		resources,
	};
}

function patchExistingDependencyTaskSource(
	content: string,
	task: RuntimeTaskCreationExistingTaskV1,
	additions: Readonly<{ blocking: readonly string[]; blockedBy: readonly string[] }>,
	modifiedAt: string,
	settings: Readonly<OperonSettings>,
): string {
	if (task.representation === 'file') {
		const document = parseFrontmatterDocument(content, [...settings.keyMappings]);
		if (!document.hasFrontmatter || document.managedFieldValues['operonId'] !== task.operonId) {
			throw new Error(`Dependency File Task could not be verified: ${task.operonId}`);
		}
		const nextFieldValues = { ...document.managedFieldValues };
		const fieldPresence = new Set(document.managedFieldPresence);
		for (const field of ['blocking', 'blockedBy'] as const) {
			if (additions[field].length === 0) continue;
			fieldPresence.add(field);
			nextFieldValues[field] = serializeDependencyIdList([
				...parseDependencyIdList(nextFieldValues[field]),
				...additions[field],
			]);
		}
		fieldPresence.add('datetimeModified');
		nextFieldValues['datetimeModified'] = modifiedAt;
		const defaults = resolveFileTaskDefaults({
			sourceFieldValues: nextFieldValues,
			templateFieldValues: {},
			existingOperonId: task.operonId,
			seedCreatedAt: nextFieldValues['datetimeCreated'] || modifiedAt,
			defaultPipelineName: settings.defaultPipelineName,
			defaultPriority: settings.defaultPriority,
			pipelines: settings.pipelines,
			now: modifiedAt,
			generateOperonId: () => task.operonId,
		});
		return buildMergedFileTaskDraft({
			source: {
				description: '',
				fieldValues: nextFieldValues,
				fieldPresence,
				explicitEmptyFieldKeys: new Set(
					[...document.managedFieldPresence].filter(
						key => (document.managedFieldValues[key] ?? '') === '',
					),
				),
				tags: [...document.tags],
				tagsPresent: document.tagsPresent,
				frontmatterDocument: document,
			},
			defaults,
			keyMappings: [...settings.keyMappings],
			bodyStrategy: 'preserve-source',
			preserveSourceKeyChoices: true,
		}).content;
	}

	const lines = content.split('\n');
	let lineNumber = task.lineNumber ?? -1;
	let parsed = lineNumber >= 0
		? parseTaskLine(lines[lineNumber] ?? '', lineNumber, task.filePath, [...settings.keyMappings])
		: null;
	if (parsed?.operonId !== task.operonId) {
		lineNumber = lines.findIndex((line, index) => (
			parseTaskLine(line, index, task.filePath, [...settings.keyMappings])?.operonId === task.operonId
		));
		parsed = lineNumber >= 0
			? parseTaskLine(lines[lineNumber], lineNumber, task.filePath, [...settings.keyMappings])
			: null;
	}
	if (!parsed || parsed.operonId !== task.operonId) {
		throw new Error(`Dependency inline task could not be verified: ${task.operonId}`);
	}
	for (const field of ['blocking', 'blockedBy', 'datetimeModified'] as const) {
		if (field !== 'datetimeModified' && additions[field].length === 0) continue;
		const currentValue = parsed.fields.find(candidate => candidate.key === field)?.value ?? '';
		const value = field === 'datetimeModified'
			? modifiedAt
			: serializeDependencyIdList([
				...parseDependencyIdList(currentValue),
				...additions[field],
			]);
		const existing = parsed.fields.find(candidate => candidate.key === field);
		if (existing) {
			existing.value = value;
			existing.rawValue = value;
		} else if (value) {
			parsed.fields.push({
				sourceKey: field,
				key: field,
				value,
				rawValue: value,
				type: field === 'datetimeModified' ? 'datetime' : 'list',
				isCanonical: true,
				containerRange: { from: 0, to: 0 },
				valueRange: { from: 0, to: 0 },
			});
		}
	}
	lines[lineNumber] = serializeTask(parsed, [...settings.keyMappings]);
	return lines.join('\n');
}

function rewriteCommittedLocalReferences(
	item: CreateTaskItemV1,
	activeItemRefs: ReadonlySet<string>,
	sealedIds?: ReadonlyMap<string, string>,
): CreateTaskItemV1 {
	const rewrite = (reference: NonNullable<CreateTaskItemV1['parent']>) => {
		if (reference.kind !== 'created' || activeItemRefs.has(reference.itemRef)) return reference;
		const operonId = sealedIds?.get(reference.itemRef);
		if (!operonId) throw new CreationAdapterError('stale-source', 'A committed local reference lost its sealed id.');
		return { kind: 'existing' as const, operonId };
	};
	return {
		...item,
		...(item.parent ? { parent: rewrite(item.parent) } : {}),
		...(item.related ? { related: item.related.map(rewrite) } : {}),
		...(item.dependencies
			? {
				dependencies: item.dependencies.map(dependency => ({
					...dependency,
					target: rewrite(dependency.target),
				})),
			}
			: {}),
	};
}

export function sourceRevisionForTaskCreationV1(
	filePath: string,
	content: string | null,
): string {
	return content === null
		? sha256HexV1(`${ABSENT_SOURCE_PREFIX}${filePath.normalize('NFC')}`)
		: sha256HexV1(content);
}

function createSealedEffect(
	task: PreparedCanonicalTaskCreationPlan['tasks'][number],
	sourceGroup: PreparedCanonicalTaskCreationPlan['sourceGroups'][number],
	plannedSourceDigest: string,
): SealedCreateEffectV1 {
	const locator = task.representation === 'inline'
		? {
			representation: 'inline' as const,
			filePath: task.filePath,
			lineNumber: task.lineNumber ?? 0,
		}
		: {
			representation: 'file' as const,
			filePath: task.filePath,
		};
	const renderedTask = task.representation === 'inline'
		? task.renderedTaskLine ?? ''
		: task.renderedFileContent ?? '';
	return {
		itemRef: task.itemKey,
		operonId: task.operonId,
		...(task.fieldValues['repeatSeriesId']
			? { repeatSeriesId: task.fieldValues['repeatSeriesId'] }
			: {}),
		locator,
		renderedTaskDigest: sha256HexV1(renderedTask),
		plannedSourceDigest,
		...(sourceGroup.expectedState === 'absent'
			? { expectedAbsence: true as const }
			: { targetBeforeDigest: sourceGroup.expectedRevision }),
		...(task.template
			? {
				templateId: task.template.templateId,
				templateDigest: task.template.revision,
			}
			: {}),
		...(task.templateIdentityAllocations === undefined
			? {}
			: { templateIdentityAllocations: task.templateIdentityAllocations.map(allocation => ({ ...allocation })) }),
		...(task.parentOperonId ? { resolvedParentOperonId: task.parentOperonId } : {}),
		resolvedRelatedOperonIds: [...task.relatedOperonIds],
		...(task.resolvedDependencies.length > 0
			? {
				resolvedDependencies: task.resolvedDependencies.map(dependency => ({ ...dependency })),
			}
			: {}),
		...(task.bodyMarkdown === undefined
			? {}
			: {
				bodyMarkdownSummary: {
					utf8Bytes: new TextEncoder().encode(task.bodyMarkdown).byteLength,
					sha256: sha256HexV1(task.bodyMarkdown),
				},
			}),
	};
}

async function adaptCreateItem(
	item: CreateTaskItemV1,
	settings: Readonly<OperonSettings>,
	ports: RuntimeTaskCreationAdapterPortsV1,
	localParent?: CanonicalTaskCreationItem,
	readSourceSnapshot?: (filePath: string) => Promise<TaskCreationSourceSnapshot>,
): Promise<CanonicalTaskCreationItem> {
	const representation = item.target.representation
		?? (settings.taskCreatorDefaultToFileTask ? 'file' : 'inline');
	if (item.bodyMarkdown !== undefined && item.target.representation !== 'file') {
		throw new CreationAdapterError(
			'invalid-request',
			'bodyMarkdown requires an explicitly selected File Task representation.',
		);
	}
	const existingParent = item.parent?.kind === 'existing'
		? ports.getExistingTask(item.parent.operonId)
		: null;
	const localParentTarget: RuntimeTaskCreationParentTargetV1 | null = localParent
		? {
			filePath: localParent.target.source.filePath,
			representation: localParent.target.representation,
		}
		: null;
	const resolvedParent = existingParent ?? localParentTarget;
	const configuredInline = item.target.mode === 'configured-default'
		&& representation === 'inline'
		? localParent
			? resolveLocalParentInlineTarget(localParent, settings)
				?? await ports.resolveConfiguredInlineTarget(resolvedParent)
			: await ports.resolveConfiguredInlineTarget(resolvedParent)
		: null;
	const exactInlineLine = item.target.mode === 'exact-path'
		&& item.target.representation === 'inline'
		? item.target.lineNumber
		: undefined;
	const filePath = item.target.mode === 'exact-path'
		? item.target.filePath
		: representation === 'inline'
			? configuredInline?.filePath ?? ''
			: await ports.resolveConfiguredFilePath(item.description, resolvedParent);
	if (representation === 'file' && item.target.mode === 'exact-path') {
		const canonicalDescriptionPath = await ports.resolveConfiguredFilePath(item.description, resolvedParent);
		if (fileTaskBasename(canonicalDescriptionPath) !== fileTaskBasename(filePath)) {
			throw new CreationAdapterError(
				'invalid-request',
				'An exact File Task target filename must match the canonical task description filename.',
			);
		}
	}
	const snapshot = readSourceSnapshot
		? await readSourceSnapshot(filePath)
		: await ports.readSource(filePath).then(source => {
			if (source.filePath !== filePath) {
				throw new CreationAdapterError(
					'stale-source',
					'The canonical source path changed while preparing task creation.',
				);
			}
			return {
				filePath,
				content: source.content,
				revision: sourceRevisionForTaskCreationV1(filePath, source.content),
			};
		});
	if (
		exactInlineLine !== undefined
		&& (
			snapshot.content === null
			|| !isBlankMarkdownBodyLine(snapshot.content, exactInlineLine)
		)
	) {
		throw new CreationAdapterError(
			'stale-source',
			'The exact inline line is not a current blank-body placement candidate.',
		);
	}
	const fieldCatalog = ports.creationFieldCatalog();
	const configuredFields = splitConfiguredCreationFields(
		configuredInline?.defaultFields,
		fieldCatalog,
	);
	const adaptedFields = adaptFields(item.fields, fieldCatalog);
	const fields = {
		...configuredFields.fields,
		...adaptedFields.fields,
	};
	const runtimeFields = {
		...configuredFields.runtimeFields,
		...adaptedFields.runtimeFields,
	};
	if (item.statusId) fields['status'] = resolveStatusValue(item.statusId, settings);
	if (item.priorityId) fields['priority'] = resolvePriorityValue(item.priorityId, settings);
	const templateId = representation === 'file'
		? ('templateId' in item.target ? item.target.templateId : undefined) ?? (
			item.target.mode === 'configured-default'
				? settings.taskCreatorDefaultFileTemplateId ?? undefined
				: undefined
		)
		: undefined;
	let template: DeterministicFileTaskTemplate | undefined;
	if (templateId) {
		const resolved = await ports.readTemplate(templateId);
		if (!resolved) {
			throw new CreationAdapterError('invalid-request', `File task template is unavailable: ${templateId}`);
		}
		template = resolved;
	}
	return {
		itemKey: item.itemRef,
		description: item.description,
		target: representation === 'inline'
			? {
				representation: 'inline',
					source: snapshot,
					placement: configuredInline?.placement ?? (
						exactInlineLine === undefined
							? { kind: 'append' }
							: { kind: 'before-line', lineNumber: exactInlineLine }
				),
				allowCreateFile: item.target.mode === 'configured-default',
			}
			: {
				representation: 'file',
				source: snapshot,
				...(template ? { template } : {}),
				...('identityPlaceholderPolicy' in item.target && item.target.identityPlaceholderPolicy
					? { identityPlaceholderPolicy: item.target.identityPlaceholderPolicy }
					: {}),
			},
		fields,
		...(Object.keys(runtimeFields).length > 0
			? {
				runtimeFields,
			}
			: {}),
		...(item.tags === undefined ? {} : { tags: [...item.tags] }),
		...(item.parent ? { parent: adaptReference(item.parent) } : {}),
		...(item.related ? { related: item.related.map(adaptReference) } : {}),
		...(item.dependencies
			? {
				dependencies: item.dependencies.map(dependency => ({
					relation: dependency.relation,
					target: adaptReference(dependency.target),
				})),
			}
			: {}),
		...(item.bodyMarkdown === undefined ? {} : { bodyMarkdown: item.bodyMarkdown }),
	};
}

function resolveLocalParentInlineTarget(
	parent: CanonicalTaskCreationItem,
	settings: Readonly<OperonSettings>,
): {
	filePath: string;
	placement: InlineTaskCreationPlacement;
	defaultFields?: Readonly<Record<string, string>>;
} | null {
	if (
		parent.target.representation === 'inline'
		&& settings.inlineTaskParentInlineTargetMode === 'below-parent'
	) {
		return {
			filePath: parent.target.source.filePath,
			placement: { kind: 'after-item', itemKey: parent.itemKey },
		};
	}
	if (
		parent.target.representation === 'file'
		&& settings.inlineTaskParentFileTargetMode === 'inside-parent-file'
	) {
		return {
			filePath: parent.target.source.filePath,
			placement: {
				kind: 'under-heading',
				headingKeyword: normalizeInlineTaskParentFileHeadingKeyword(
					settings.inlineTaskParentFileHeadingKeyword,
				),
			},
		};
	}
	return null;
}

function fileTaskBasename(filePath: string): string {
	const name = filePath.slice(filePath.lastIndexOf('/') + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3).normalize('NFC') : name.normalize('NFC');
}

function adaptReference(reference: CreateTaskItemV1['parent']) {
	if (!reference) throw new CreationAdapterError('invalid-request', 'Task reference is missing.');
	return reference.kind === 'existing'
		? { kind: 'existing' as const, operonId: reference.operonId }
		: { kind: 'local' as const, itemKey: reference.itemRef };
}

function adaptFields(
	items: CreateFieldItemV1[],
	catalog: readonly FieldDescriptorV1[],
): { fields: Record<string, string>; runtimeFields: Record<string, string> } {
	const fields: Record<string, string> = {};
	const runtimeFields: Record<string, string> = {};
	if (items.length === 0) return { fields, runtimeFields };
	const descriptors = new Map(catalog.map(descriptor => [descriptor.canonicalKey, descriptor]));
	for (const item of items) {
		switch (item.kind) {
			case 'text':
		case 'date':
				fields[item.field] = item.value;
				break;
			case 'datetime':
				fields[item.field] = canonicalizeLocalDatetime(item.value);
				break;
			case 'number':
				fields[item.field] = String(item.value);
				break;
			case 'list':
				fields[item.field] = item.value.join('; ');
				break;
			case 'custom':
				{
					const descriptor = descriptors.get(item.field);
					if (
						!descriptor
						|| descriptor.source !== 'custom'
						|| !isGeneralUpdateFieldV1(descriptor)
						|| descriptor.valueType !== item.valueType
					) {
						throw new CreationAdapterError(
							'field-not-writable',
							`Custom field is unavailable or has a different live type: ${item.field}`,
						);
					}
				}
				fields[item.field] = item.valueType === 'datetime'
					? canonicalizeLocalDatetime(String(item.value))
					: Array.isArray(item.value)
						? item.value.join('; ')
						: String(item.value);
				break;
			case 'reminder-datetimes': {
				const canonical = canonicalizeAbsoluteReminderList(item.values);
				if (canonical.items.some(result => !result.ok)) {
					throw new CreationAdapterError('invalid-request', 'Absolute reminder datetime is invalid.');
				}
				const values = canonical.items.flatMap(result => (
					result.ok ? [result.value.localDatetime] : []
				));
				if (new Set(values).size !== values.length) {
					throw new CreationAdapterError(
						'invalid-request',
						'Absolute reminder datetimes cannot contain canonical duplicates.',
					);
				}
				runtimeFields['reminderDatetimes'] = values.join('; ');
				break;
			}
			case 'reminder-rules': {
				const canonical = canonicalizeReminderRuleList(item.values);
				if (canonical.items.some(result => !result.ok)) {
					throw new CreationAdapterError('invalid-request', 'Reminder rule is invalid.');
				}
				const values = canonical.items.flatMap(result => (
					result.ok ? [result.value.canonical] : []
				));
				if (new Set(values).size !== values.length) {
					throw new CreationAdapterError(
						'invalid-request',
						'Reminder rules cannot contain canonical duplicates.',
					);
				}
				runtimeFields['reminderRules'] = values.join('; ');
				break;
			}
			case 'recurrence': {
				const rule = parseRepeatRule(item.rule);
				if (!rule) {
					throw new CreationAdapterError('invalid-request', 'Recurrence rule is invalid.');
				}
				runtimeFields['repeat'] = serializeRepeatRule(rule);
				if (item.endDatetime) {
					const end = parseAbsoluteReminder(item.endDatetime);
					if (!end.ok) {
						throw new CreationAdapterError('invalid-request', 'Recurrence end datetime is invalid.');
					}
					runtimeFields['datetimeRepeatEnd'] = end.value.localDatetime;
				}
				break;
			}
		}
	}
	return { fields, runtimeFields };
}

function splitConfiguredCreationFields(
	defaultFields: Readonly<Record<string, string>> | undefined,
	catalog: readonly FieldDescriptorV1[],
): { fields: Record<string, string>; runtimeFields: Record<string, string> } {
	const fields: Record<string, string> = {};
	const runtimeFields: Record<string, string> = {};
	const datetimeFields = new Set(catalog
		.filter(descriptor => descriptor.valueType === 'datetime')
		.map(descriptor => descriptor.canonicalKey));
	for (const [field, value] of Object.entries(defaultFields ?? {})) {
		if (CONFIGURED_TEMPORAL_CREATION_FIELDS.has(field)) {
			runtimeFields[field] = field === 'datetimeRepeatEnd'
				? canonicalizeLocalDatetime(value)
				: value;
		} else {
			fields[field] = datetimeFields.has(field)
				? canonicalizeLocalDatetime(value)
				: value;
		}
	}
	return { fields, runtimeFields };
}

function splitTemporalList(value: string | undefined): string[] {
	return (value ?? '').split(';').map(item => item.trim()).filter(Boolean);
}

function resolveStatusValue(statusId: string, settings: Readonly<OperonSettings>): string {
	const matches = settings.pipelines.flatMap(pipeline => (
		pipeline.statuses
			.filter(status => status.id === statusId)
			.map(status => composeStatusValue(pipeline.name, status.label))
	));
	if (matches.length !== 1) {
		throw new CreationAdapterError('invalid-request', `Status stable ID is missing or ambiguous: ${statusId}`);
	}
	return matches[0];
}

function resolvePriorityValue(priorityId: string, settings: Readonly<OperonSettings>): string {
	const matches = settings.priorities.filter(priority => priority.id === priorityId);
	if (matches.length !== 1) {
		throw new CreationAdapterError('invalid-request', `Priority stable ID is missing or ambiguous: ${priorityId}`);
	}
	return matches[0].label;
}

class CreationAdapterError extends Error {
	constructor(
		readonly code: 'invalid-request' | 'field-not-writable' | 'stale-source' | 'capability-unavailable',
		message: string,
	) {
		super(message);
		this.name = 'CreationAdapterError';
	}
}
