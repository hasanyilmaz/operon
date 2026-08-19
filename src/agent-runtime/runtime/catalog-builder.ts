import {
	CATALOG_LIMITS_V1,
	FIELD_CATALOG_LIMITS_V1,
	GENERAL_UPDATE_BUILT_IN_KEYS_V1,
	TEMPORAL_CREATE_KEYS_V1,
	TYPED_CREATE_FEATURES_V1,
	GRAPH_TRANSACTION_FEATURES_V1,
	SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
	COMPACT_UPDATE_BATCH_FEATURES_V1,
	type CatalogDefaultReferenceV1,
	type CatalogFilterNodeV1,
	type CatalogPoliciesV1,
	type CatalogTaxonomyV1,
	type FieldDescriptorV1,
	type FieldValueTypeV1,
	type FileTaskTemplateCandidateV1,
} from '../contracts/v1/catalog';
import {
	canonicalJsonV1,
	sha256HexV1,
} from '../contracts/v1/canonical';
import {
	type ContractWarningV1,
	CONTRACT_LIMITS_V1,
	structuredErrorV1,
	type JsonValue,
	type StructuredErrorV1,
	utf8ByteLengthV1,
} from '../contracts/v1/primitives';
import { buildPipelineMinimalFileTaskTemplateId } from '../../core/file-task-template-identity';
import { isManagedCustomFieldMapping } from '../../core/managed-task-fields';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredPipelineNameIdentity,
	resolveConfiguredStatusIdentity,
} from '../../core/workflow-status-identity';
import { REMINDER_RULE_ANCHORS } from '../../core/reminder-rules';
import {
	type FilterNode,
	type KeyMapping,
	normalizeKeyMappingComparableName,
	type OperonSettings,
} from '../../types/settings';
import {
	CANONICAL_KEYS,
	TASK_DATA_CANONICAL_KEYS,
	TASK_DATA_CANONICAL_KEY_SET,
	type CanonicalKeyDef,
} from '../../types/keys';
import { computeContextSettingsFingerprintV1 } from './settings-fingerprint';

export interface CatalogProjectionV1 {
	taxonomy: CatalogTaxonomyV1;
	fields: FieldDescriptorV1[];
	policies: CatalogPoliciesV1;
	catalogRevision: string;
	warnings: ContractWarningV1[];
}

export type CatalogBuildResultV1 =
	| { ok: true; value: CatalogProjectionV1 }
	| { ok: false; error: StructuredErrorV1 };

export interface CatalogBuildOptionsV1 {
	fileTaskTemplateCandidates?: readonly FileTaskTemplateCandidateV1[];
}

export function isCatalogResultWithinTransportLimitV1(value: unknown): boolean {
	try {
		return utf8ByteLengthV1(JSON.stringify(value)) <= CONTRACT_LIMITS_V1.transportResultBytes;
	} catch {
		return false;
	}
}

const REMINDER_KEYS = ['reminderDatetimes', 'reminderRules'] as const;
const RETIRED_OR_STALE_KEYS = new Set(['related', 'reminders']);
const VIRTUAL_FIELDS: ReadonlyArray<{
	canonicalKey: string;
	displayName: string;
	description: string;
	valueType: FieldValueTypeV1;
	mutationClass: FieldDescriptorV1['mutationClass'];
	mutationOwner?: string;
}> = [
	{
		canonicalKey: 'description',
		displayName: 'Description',
		description: 'Task description text.',
		valueType: 'text',
		mutationClass: 'general-update',
		mutationOwner: 'tasks.update',
	},
	{
		canonicalKey: 'checkbox',
		displayName: 'Checkbox',
		description: 'Workflow-derived task checkbox state.',
		valueType: 'checkbox',
		mutationClass: 'semantic-capability',
		mutationOwner: 'tasks.transition',
	},
	{
		canonicalKey: 'tags',
		displayName: 'Tags',
		description: 'Task tags.',
		valueType: 'list',
		mutationClass: 'general-update',
		mutationOwner: 'tasks.update',
	},
	{
		canonicalKey: 'representation',
		displayName: 'Representation',
		description: 'Inline or file task representation.',
		valueType: 'text',
		mutationClass: 'semantic-capability',
		mutationOwner: 'tasks.convert',
	},
	{
		canonicalKey: 'locator',
		displayName: 'Source locator',
		description: 'Runtime-owned vault-relative task source locator.',
		valueType: 'text',
		mutationClass: 'runtime-owned',
	},
	{
		canonicalKey: 'pinned',
		displayName: 'Pinned',
		description: 'Runtime-owned pinned-task state.',
		valueType: 'checkbox',
		mutationClass: 'runtime-owned',
	},
	{
		canonicalKey: 'related',
		displayName: 'Related',
		description: 'User-managed related notes and references.',
		valueType: 'list',
		mutationClass: 'semantic-capability',
	},
];
const VIRTUAL_FIELD_NAMES = new Set(VIRTUAL_FIELDS.map(field => comparable(field.canonicalKey)));
const BUILT_IN_CANONICAL_NAMES = new Set(CANONICAL_KEYS.map(field => comparable(field.name)));
const GENERAL_UPDATE_KEYS = new Set<string>(GENERAL_UPDATE_BUILT_IN_KEYS_V1);
// Settings ownership ships before the Runtime V1 mutation contract. Stage 4
// removes this gate once create/update/read parity is implemented and tested.
const PENDING_RUNTIME_V1_PUBLICATION_KEYS = new Set(TASK_DATA_CANONICAL_KEYS.map(comparable));

export function buildLivePropertyCatalogV1(
	settings: Readonly<OperonSettings>,
	options: Readonly<CatalogBuildOptionsV1> = {},
): CatalogBuildResultV1 {
	try {
		const warnings: ContractWarningV1[] = [];
		const taxonomy = buildTaxonomy(settings, warnings);
		const fields = buildFields(settings.keyMappings, warnings);
		const policies = buildPolicies(settings, taxonomy, fields, options);
		assertCatalogBounds(taxonomy, fields, policies, warnings);
		const settingsFingerprint = computeContextSettingsFingerprintV1(settings);
		const catalogMaterial = { taxonomy, fields, policies };
		const revisionMaterial = { settingsFingerprint, ...catalogMaterial };
		const encoded = canonicalJsonV1(catalogMaterial as unknown as JsonValue);
		if (utf8ByteLengthV1(encoded) > CONTRACT_LIMITS_V1.transportResultBytes - 16_384) {
			return failure('result-too-large', 'The live Property Catalog exceeds the V1 result limit.');
		}
		return {
			ok: true,
			value: {
				...catalogMaterial,
				catalogRevision: sha256HexV1(canonicalJsonV1(revisionMaterial as unknown as JsonValue)),
				warnings,
			},
		};
	} catch {
		return failure(
			'projection-too-broad',
			'The live Property Catalog cannot be represented safely within the V1 contract.',
		);
	}
}

function buildTaxonomy(
	settings: Readonly<OperonSettings>,
	warnings: ContractWarningV1[],
): CatalogTaxonomyV1 {
	const index = buildWorkflowStatusIdentityIndex(settings.pipelines);
	const pipelineIdCounts = countValues(settings.pipelines.map(pipeline => pipeline.id));
	const statusIdCounts = countValues(settings.pipelines.flatMap(pipeline => pipeline.statuses.map(status => status.id)));
	const pipelines = settings.pipelines.map((pipeline, pipelineOrder) => {
		const nameCandidates = index.pipelineCandidatesByName.get(pipeline.name) ?? [];
		const pipelineAmbiguous = nameCandidates.length !== 1 || (pipelineIdCounts.get(pipeline.id) ?? 0) !== 1;
		if (pipelineAmbiguous) warnings.push(catalogWarning(
			'taxonomy-identity-ambiguous',
			'A pipeline identity is ambiguous and cannot be used for a stable mutation reference.',
			`taxonomy.pipelines[${pipelineOrder}]`,
		));
		return {
			id: pipeline.id,
			name: pipeline.name,
			description: pipeline.description?.trim() ?? '',
			order: pipelineOrder,
			identityStatus: pipelineAmbiguous ? 'ambiguous' as const : 'resolved' as const,
			statuses: pipeline.statuses.map((status, statusOrder) => {
				const resolution = resolveConfiguredStatusIdentity(`${pipeline.name}.${status.label}`, index);
				const ambiguous = resolution.kind !== 'configured'
					|| resolution.pipeline !== pipeline
					|| resolution.status !== status
					|| (statusIdCounts.get(status.id) ?? 0) !== 1;
				if (ambiguous) warnings.push(catalogWarning(
					'taxonomy-identity-ambiguous',
					'A status identity is ambiguous and cannot be used for a stable mutation reference.',
					`taxonomy.pipelines[${pipelineOrder}].statuses[${statusOrder}]`,
				));
				return {
					id: status.id,
					label: status.label,
					order: statusOrder,
					color: status.color,
					...(status.pipelineStatusIcon?.trim() ? { icon: status.pipelineStatusIcon.trim() } : {}),
					...(status.propertyMapping?.trim() ? { propertyMapping: status.propertyMapping.trim() } : {}),
					isFinished: status.isFinished,
					isCancelled: status.isCancelled,
					isScheduledTarget: status.isScheduledTarget,
					isTrackingTarget: status.isTrackingTarget,
					identityStatus: ambiguous ? 'ambiguous' as const : 'resolved' as const,
				};
			}),
		};
	});
	const priorityLabelCounts = countValues(settings.priorities.map(priority => priority.label));
	const priorityIdCounts = countValues(settings.priorities.map(priority => priority.id));
	const defaultPriorityMatches = settings.priorities.filter(priority => priority.label === settings.defaultPriority);
	const priorities = settings.priorities.map((priority, order) => ({
		id: priority.id,
		label: priority.label,
		description: priority.description?.trim() ?? '',
		order,
		color: priority.color,
		...(priority.priorityIcon?.trim() ? { icon: priority.priorityIcon.trim() } : {}),
		isDefault: defaultPriorityMatches.length === 1 && defaultPriorityMatches[0] === priority,
		identityStatus: (
			(priorityLabelCounts.get(priority.label) ?? 0) === 1
			&& (priorityIdCounts.get(priority.id) ?? 0) === 1
		) ? 'resolved' as const : 'ambiguous' as const,
	}));
	for (const [order, priority] of settings.priorities.entries()) {
		if ((priorityLabelCounts.get(priority.label) ?? 0) !== 1 || (priorityIdCounts.get(priority.id) ?? 0) !== 1) {
			warnings.push(catalogWarning(
				'taxonomy-identity-ambiguous',
				'A priority identity is ambiguous and cannot be used for a stable mutation reference.',
				`taxonomy.priorities[${order}]`,
			));
		}
	}
	const pipelineDefaultResolution = resolveConfiguredPipelineNameIdentity(settings.defaultPipelineName, index);
	const defaultPipeline = defaultReference(
		settings.defaultPipelineName,
		pipelineDefaultResolution.kind === 'configured'
			&& (pipelineIdCounts.get(pipelineDefaultResolution.pipeline.id) ?? 0) === 1
			? pipelineDefaultResolution.pipeline.id
			: undefined,
		pipelineDefaultResolution.kind === 'ambiguous',
	);
	const defaultPriority = defaultReference(
		settings.defaultPriority,
		defaultPriorityMatches.length === 1
			&& (priorityIdCounts.get(defaultPriorityMatches[0].id) ?? 0) === 1
			? defaultPriorityMatches[0].id
			: undefined,
		defaultPriorityMatches.length > 1,
	);
	if (defaultPipeline.status !== 'resolved' && defaultPipeline.status !== 'none') warnings.push(catalogWarning(
		'taxonomy-default-unresolved',
		'The configured default pipeline does not resolve to one stable identity.',
		'taxonomy.defaultPipeline',
	));
	if (defaultPriority.status !== 'resolved' && defaultPriority.status !== 'none') warnings.push(catalogWarning(
		'taxonomy-default-unresolved',
		'The configured default priority does not resolve to one stable identity.',
		'taxonomy.defaultPriority',
	));
	return { defaultPipeline, defaultPriority, pipelines, priorities };
}

function defaultReference(
	configuredValue: string,
	id: string | undefined,
	ambiguous: boolean,
): CatalogDefaultReferenceV1 {
	if (!configuredValue.trim()) return { configuredValue: '', status: 'none' };
	if (id) return { configuredValue, id, status: 'resolved' };
	return { configuredValue, status: ambiguous ? 'ambiguous' : 'unavailable' };
}

function buildFields(
	keyMappings: readonly KeyMapping[],
	warnings: ContractWarningV1[],
): FieldDescriptorV1[] {
	const candidateMappings = keyMappings.filter(mapping => (
		!RETIRED_OR_STALE_KEYS.has(mapping.canonicalKey)
		&& !PENDING_RUNTIME_V1_PUBLICATION_KEYS.has(comparable(mapping.canonicalKey))
	));
	const invalidCustomMappings = candidateMappings.filter(mapping => (
		mapping.isSystem === false
		&& (!isManagedCustomFieldMapping(mapping) || !isSafeCustomCanonicalKey(mapping.canonicalKey))
	));
	for (const mapping of invalidCustomMappings) warnings.push(catalogWarning(
		'field-mapping-unavailable',
		'An invalid or internal custom field mapping was excluded from the Agent Property Catalog.',
		`fields.${safeWarningPathSegment(mapping.canonicalKey)}`,
	));
	const customMappings = candidateMappings.filter(mapping => (
		mapping.isSystem === false
		&& isManagedCustomFieldMapping(mapping)
		&& isSafeCustomCanonicalKey(mapping.canonicalKey)
	));
	const activeMappings = candidateMappings.filter(mapping => mapping.isSystem !== false).concat(customMappings);
	const visibleCounts = countValues(activeMappings.map(mapping => comparable(mapping.visiblePropertyName)));
	const customCanonicalCounts = countValues(customMappings.map(mapping => comparable(mapping.canonicalKey)));
	const customByComparable = new Map<string, KeyMapping>();
	for (const mapping of customMappings) {
		const key = comparable(mapping.canonicalKey);
		if (!customByComparable.has(key)) customByComparable.set(key, mapping);
	}
	const fields: FieldDescriptorV1[] = [];
	const emitted = new Set<string>();

	for (const virtual of VIRTUAL_FIELDS) {
		const key = comparable(virtual.canonicalKey);
		fields.push({
			...virtual,
			source: 'built-in',
			mappingStatus: 'mapped',
			readable: true,
			requiresStableTaxonomyId: false,
		});
		emitted.add(key);
	}

	for (const definition of CANONICAL_KEYS) {
		if (
			RETIRED_OR_STALE_KEYS.has(definition.name)
			|| PENDING_RUNTIME_V1_PUBLICATION_KEYS.has(comparable(definition.name))
		) continue;
		const key = comparable(definition.name);
		const collidingCustom = customByComparable.get(key);
		const mapping = collidingCustom ? undefined : activeMappings.find(candidate => (
			candidate.isSystem !== false && comparable(candidate.canonicalKey) === key
		));
		const visibleCollision = !!mapping && (visibleCounts.get(comparable(mapping.visiblePropertyName)) ?? 0) > 1;
		const mappingStatus = collidingCustom
			? 'collision' as const
			: !mapping ? 'unmapped' as const : visibleCollision ? 'collision' as const : 'mapped' as const;
		if (mappingStatus !== 'mapped') warnings.push(catalogWarning(
			mappingStatus === 'collision' ? 'field-mapping-collision' : 'field-mapping-unavailable',
			mappingStatus === 'collision'
				? 'A visible property name collision makes a built-in field unreadable.'
				: 'An expected built-in field mapping is unavailable.',
			`fields.${definition.name}`,
		));
		fields.push(descriptorForBuiltIn(definition, mapping, mappingStatus));
		emitted.add(key);
	}

	for (const mapping of customMappings.sort(compareCustomMappings)) {
		const key = comparable(mapping.canonicalKey);
		if (emitted.has(key)) {
			warnings.push(catalogWarning(
				'field-mapping-collision',
				'A custom key collides with a built-in or Runtime-owned field identity and was excluded.',
				`fields.${safeWarningPathSegment(mapping.canonicalKey)}`,
			));
			continue;
		}
		const canonicalCollision = BUILT_IN_CANONICAL_NAMES.has(key)
			|| VIRTUAL_FIELD_NAMES.has(key)
			|| (customCanonicalCounts.get(key) ?? 0) > 1;
		const visibleCollision = (visibleCounts.get(comparable(mapping.visiblePropertyName)) ?? 0) > 1;
		const reminderCollision = REMINDER_KEYS.some(reminderKey => comparable(reminderKey) === key);
		const mappingStatus = reminderCollision
			? 'reserved' as const
			: canonicalCollision || visibleCollision ? 'collision' as const : 'mapped' as const;
		if (mappingStatus !== 'mapped') warnings.push(catalogWarning(
			'field-mapping-collision',
			'A custom key collides with a reserved identity or visible property mapping.',
			`fields.${mapping.canonicalKey}`,
		));
		fields.push({
			canonicalKey: mapping.canonicalKey,
			displayName: mapping.visiblePropertyName.trim() || mapping.canonicalKey,
			description: mapping.description?.trim() ?? '',
			valueType: mapping.type,
			source: 'custom',
			mappingStatus,
			readable: mappingStatus === 'mapped',
			mutationClass: mappingStatus === 'mapped' ? 'general-update' : 'runtime-owned',
			...(mappingStatus === 'mapped' ? { mutationOwner: 'tasks.update' } : {}),
			requiresStableTaxonomyId: false,
		});
		emitted.add(key);
	}
	return fields;
}

function descriptorForBuiltIn(
	definition: CanonicalKeyDef,
	mapping: KeyMapping | undefined,
	mappingStatus: 'mapped' | 'unmapped' | 'collision',
): FieldDescriptorV1 {
	const classification = classifyBuiltIn(definition.name);
	return {
		canonicalKey: definition.name,
		displayName: mapping?.visiblePropertyName.trim() || definition.name,
		description: mapping?.description?.trim() || definition.description,
		valueType: definition.type,
		source: 'built-in',
		mappingStatus,
		readable: mappingStatus === 'mapped',
		mutationClass: classification.mutationClass,
		...(classification.mutationOwner ? { mutationOwner: classification.mutationOwner } : {}),
		requiresStableTaxonomyId: definition.name === 'priority' || definition.name === 'status',
	};
}

function classifyBuiltIn(canonicalKey: string): Pick<FieldDescriptorV1, 'mutationClass' | 'mutationOwner'> {
	if (GENERAL_UPDATE_KEYS.has(canonicalKey)) {
		return { mutationClass: 'general-update', mutationOwner: 'tasks.update' };
	}
	if (['status', 'dateCompleted', 'dateCancelled'].includes(canonicalKey)) {
		return { mutationClass: 'semantic-capability', mutationOwner: 'tasks.transition' };
	}
	if (REMINDER_KEYS.includes(canonicalKey as typeof REMINDER_KEYS[number])) {
		return { mutationClass: 'semantic-capability', mutationOwner: 'tasks.reminder' };
	}
	if (['trackers', 'activeTracker'].includes(canonicalKey)) {
		return { mutationClass: 'semantic-capability', mutationOwner: 'timers.control' };
	}
	if (['parentTask', 'blocking', 'blockedBy'].includes(canonicalKey)) {
		return { mutationClass: 'semantic-capability', mutationOwner: 'tasks.relationship' };
	}
	if ([
		'repeat', 'repeatSeriesId', 'repeatOccurrenceDate', 'datetimeRepeatEnd',
	].includes(canonicalKey)) {
		return { mutationClass: 'semantic-capability', mutationOwner: 'tasks.recurrence' };
	}
	return { mutationClass: 'runtime-owned' };
}

function buildPolicies(
	settings: Readonly<OperonSettings>,
	taxonomy: CatalogTaxonomyV1,
	fields: readonly FieldDescriptorV1[],
	options: Readonly<CatalogBuildOptionsV1>,
): CatalogPoliciesV1 {
	const fieldByComparable = new Map(fields.map(field => [comparable(field.canonicalKey), field]));
	const reminderPolicies = REMINDER_KEYS.map(canonicalKey => {
		const field = fieldByComparable.get(comparable(canonicalKey));
		const availability = field?.source === 'built-in' && field.mappingStatus === 'mapped' && field.readable
			? 'available' as const
			: field?.mappingStatus === 'collision' || field?.mappingStatus === 'reserved'
				? 'collision' as const
				: 'unavailable' as const;
		return {
			canonicalKey,
			availability,
			...(availability === 'available' ? { visiblePropertyName: field!.displayName } : {}),
		};
	});
	const builtInTemplateCandidates = taxonomy.pipelines.flatMap(pipeline => {
		const firstStatus = pipeline.statuses[0];
		if (
			pipeline.identityStatus !== 'resolved'
			|| !firstStatus
			|| firstStatus.identityStatus !== 'resolved'
		) return [];
		return [{
			id: buildPipelineMinimalFileTaskTemplateId(pipeline.id),
			pipelineId: pipeline.id,
			initialStatusId: firstStatus.id,
		}];
	});
	const fileTaskTemplateCandidates = [...(options.fileTaskTemplateCandidates ?? [])]
		.map(candidate => ({ ...candidate }))
		.sort((left, right) => left.id.localeCompare(right.id));
	return {
		sourceTransitionRecoveryVersion: 1,
		sourceTransitionRecoveryFeatures: [...SOURCE_TRANSITION_RECOVERY_FEATURES_V1],
		creation: {
			descriptionRequired: settings.taskDescriptionRequired,
			assigneesRequired: settings.assigneesRequired,
			defaultEstimateMinutes: settings.defaultEstimateMinutes,
			defaultToFileTask: settings.taskCreatorDefaultToFileTask,
			fileTaskTargetFolder: settings.fileTasksFolder,
			fileTaskTemplateFolder: settings.fileTaskTemplateFolder,
			...(settings.taskCreatorDefaultFileTemplateId
				? { defaultFileTemplateId: settings.taskCreatorDefaultFileTemplateId }
				: {}),
			// Runtime V1 does not yet own Weekly Notes creation. Project the Plugin-only
			// destination to its existing explicit-target mode instead of exposing a
			// catalog value the frozen V1 decoder cannot understand.
			inlineTaskSaveMode: settings.inlineTaskSaveMode === 'weekly-notes'
				? 'ask-every-time'
				: settings.inlineTaskSaveMode,
			inlineTaskTargetFile: settings.inlineTaskTargetFile,
			inlineTaskHeading: settings.inlineTaskHeading,
			dailyNoteAddsStartDate: settings.inlineTaskDailyNoteAddStartDate,
			dailyNoteAddsScheduledDate: settings.inlineTaskDailyNoteAddScheduledDate,
			createDailyNotesAsFileTasks: settings.createDailyNotesAsOperonTask,
			calendarInlineTaskHeading: settings.calendarInlineTaskHeading,
			builtInTemplateCandidates,
			fileTaskTemplateCandidates,
			typedCreateVersion: 1,
			typedCreateFeatures: [...TYPED_CREATE_FEATURES_V1],
			temporalCreateVersion: 1,
			temporalCreateKeys: [...TEMPORAL_CREATE_KEYS_V1],
			compactBatchVersion: 1,
			compactBatchInputFormat: 'compact-lines',
			compactBatchMaxItems: CONTRACT_LIMITS_V1.createItems,
			graphTransactionVersion: 1,
			graphTransactionFeatures: [...GRAPH_TRANSACTION_FEATURES_V1],
		},
		inheritance: {
			fields: settings.childTaskInheritanceFields.filter(key => !TASK_DATA_CANONICAL_KEY_SET.has(key)),
			statusPipelineSource: settings.childTaskInheritanceStatusPipelineSource,
			autoParentFileTask: settings.autoParentFileTask,
			autoParentLinkedFileSubtasks: settings.autoParentLinkedFileSubtasks,
			fileTaskParentInlineTargetMode: settings.fileTaskParentInlineTargetMode,
			fileTaskParentFileTargetMode: settings.fileTaskParentFileTargetMode,
			inlineTaskParentInlineTargetMode: settings.inlineTaskParentInlineTargetMode,
			inlineTaskParentFileTargetMode: settings.inlineTaskParentFileTargetMode,
			inlineTaskParentFileHeadingKeyword: settings.inlineTaskParentFileHeadingKeyword,
		},
		exclusions: { folders: [...settings.excludedFolders].sort(compareText) },
		filters: settings.filterSets.map(filter => ({
			id: filter.id,
			name: filter.name,
			...(filter.icon?.trim() ? { icon: filter.icon.trim() } : {}),
			root: cloneFilterNode(filter.rootGroup),
			sorts: filter.sorts.map(sort => ({ ...sort })),
			...(filter.subgroupBy ? { subgroupBy: filter.subgroupBy } : {}),
			...(filter.subgroupOrder ? { subgroupOrder: filter.subgroupOrder } : {}),
			...(filter.groupBy ? { groupBy: filter.groupBy } : {}),
			...(filter.groupOrder ? { groupOrder: filter.groupOrder } : {}),
		})),
		automation: {
			autoCompleteParentWhenAllChildrenTerminal: settings.autoCompleteParentWhenAllChildrenTerminal,
			cascadeCancelToDescendants: settings.cascadeCancelToDescendants,
			newOccurrencePosition: settings.newOccurrencePosition,
			fileTaskAutoArchiveEnabled: settings.fileTaskAutoArchiveEnabled,
			fileTaskArchiveFolder: settings.fileTaskArchiveFolder,
			fileTaskArchiveDelaySeconds: settings.fileTaskArchiveDelaySeconds,
			fileTaskArchiveOnlyFromFileTasksFolder: settings.fileTaskArchiveOnlyFromFileTasksFolder,
			fileRepeatDestination: settings.fileRepeatDestination,
			fileRepeatCustomFolder: settings.fileRepeatCustomFolder,
			estimateAutoReallocation: settings.estimateAutoReallocation,
			trackerSplitSessionsAtMidnight: settings.trackerSplitSessionsAtMidnight,
			reminderCatchUpWindowMinutes: settings.reminderCatchUpWindowMinutes,
			reminderAutoPinDueTasks: settings.reminderAutoPinDueTasks,
			pinnedDockAutoPin: settings.pinnedDockAutoPin,
			pinnedDockAutoUnpinFinished: settings.pinnedDockAutoUnpinFinished,
		},
		reminders: {
			fields: reminderPolicies,
			ruleAnchors: [...REMINDER_RULE_ANCHORS],
			itemActions: ['add', 'replace', 'remove'],
		},
		conversion: {
			directions: ['inline-to-file', 'file-to-inline'],
			templateSelection: 'explicit-or-needs-template',
			targetModes: ['exact-line', 'configured-target'],
			inlineToFileMovesPlainCheckboxes: settings.inlineToFileTaskMovePlainCheckboxes,
			fileToInlineRequiresExplicitConfirmation: true,
		},
			taskUpdate: {
			writableKeys: fields
				.filter(field => (
					field.mappingStatus === 'mapped'
					&& field.readable
					&& field.mutationClass === 'general-update'
					&& field.mutationOwner === 'tasks.update'
				))
				.map(field => field.canonicalKey),
			customKeyPolicy: 'active-valid-nonreserved-text-number-date-datetime-list-checkbox',
			compactUpdateBatchVersion: 1,
			compactUpdateBatchInputFormat: 'compact-lines',
			compactUpdateBatchMaxItems: 64,
			compactUpdateBatchFeatures: [...COMPACT_UPDATE_BATCH_FEATURES_V1],
			},
			relationships: {
				writableFields: ['parentTask', 'blocking', 'blockedBy'],
				actions: ['replace', 'clear'],
				parentMaxTargets: 1,
				dependencyInverseWrites: true,
			},
			transitions: { actions: ['set-status', 'complete', 'cancel', 'reopen'] },
		timer: { actions: ['start', 'stop'] },
		inlineRelocation: { target: 'exact-blank-line' },
		deletion: {
			requiresExplicitConfirmation: true,
			deleteAdditionalTasks: false,
			referenceCleanup: 'explicit-or-block',
		},
		projectSerialScopes: settings.projectSerialScopes.map(scope => ({
			id: scope.id,
			prefix: scope.prefix,
			parentOperonId: scope.parentOperonId,
		})),
	};
}

function cloneFilterNode(node: FilterNode): CatalogFilterNodeV1 {
	if ('children' in node) {
		return {
			kind: 'group',
			id: node.id,
			logic: node.logic,
			children: node.children.map(cloneFilterNode),
		};
	}
	return {
		kind: 'condition',
		id: node.id,
		field: node.field,
		fieldType: node.fieldType,
		operator: node.operator,
		...(node.value !== undefined ? { value: node.value } : {}),
		...(node.values !== undefined ? { values: [...node.values] } : {}),
	};
}

function assertCatalogBounds(
	taxonomy: CatalogTaxonomyV1,
	fields: readonly FieldDescriptorV1[],
	policies: CatalogPoliciesV1,
	warnings: readonly ContractWarningV1[],
): void {
	if (
		taxonomy.pipelines.length > CATALOG_LIMITS_V1.pipelines
		|| taxonomy.pipelines.some(pipeline => pipeline.statuses.length > CATALOG_LIMITS_V1.statusesPerPipeline)
		|| taxonomy.priorities.length > CATALOG_LIMITS_V1.priorities
		|| fields.length > FIELD_CATALOG_LIMITS_V1.descriptors
		|| policies.filters.length > CATALOG_LIMITS_V1.filters
		|| policies.projectSerialScopes.length > CATALOG_LIMITS_V1.projectSerialScopes
		|| policies.creation.builtInTemplateCandidates.length > CATALOG_LIMITS_V1.templateCandidates
		|| (policies.creation.fileTaskTemplateCandidates?.length ?? 0) > CATALOG_LIMITS_V1.templateCandidates
		|| warnings.length > CONTRACT_LIMITS_V1.warnings - 8
	) throw new Error('catalog-cap');
	for (const candidate of policies.creation.fileTaskTemplateCandidates ?? []) {
		if (
			!candidate.id
			|| !candidate.name
			|| [
				candidate.id,
				candidate.name,
				candidate.sourcePath ?? '',
				candidate.pipelineId ?? '',
				candidate.initialStatusId ?? '',
			].some(value => [...value].length > CATALOG_LIMITS_V1.textCharacters)
		) throw new Error('template-candidate-cap');
	}
	assertNestedCatalogBounds({ taxonomy, policies });
	for (const field of fields) {
		if (
			[...field.canonicalKey].length > FIELD_CATALOG_LIMITS_V1.canonicalKeyCharacters
			|| [...field.displayName].length > FIELD_CATALOG_LIMITS_V1.displayNameCharacters
			|| [...field.description].length > FIELD_CATALOG_LIMITS_V1.descriptionCharacters
		) throw new Error('field-cap');
	}
	let filterNodes = 0;
	for (const filter of policies.filters) filterNodes += countFilterNodes(filter.root);
	if (filterNodes > CATALOG_LIMITS_V1.filterNodes) throw new Error('filter-cap');
	for (const path of [
		policies.creation.fileTaskTargetFolder,
		policies.creation.fileTaskTemplateFolder,
		policies.creation.inlineTaskTargetFile,
		policies.automation.fileTaskArchiveFolder,
		policies.automation.fileRepeatCustomFolder,
		...policies.exclusions.folders,
	]) {
		if (path && !isSafeCatalogVaultPath(path)) throw new Error('catalog-path');
	}
}

function countFilterNodes(node: CatalogFilterNodeV1): number {
	let count = 0;
	const pending: CatalogFilterNodeV1[] = [node];
	while (pending.length > 0) {
		const current = pending.pop()!;
		count += 1;
		if (count > CATALOG_LIMITS_V1.filterNodes) return count;
		if (current.kind === 'group') pending.push(...current.children);
	}
	return count;
}

function catalogWarning(code: string, message: string, path: string): ContractWarningV1 {
	return { code, message, path };
}

function isSafeCustomCanonicalKey(value: string): boolean {
	const normalized = value.trim();
	return normalized === value
		&& normalized.length > 0
		&& [...normalized].length <= FIELD_CATALOG_LIMITS_V1.canonicalKeyCharacters
		&& ![...normalized].some(character => {
			const code = character.codePointAt(0) ?? 0;
			return code <= 31 || code === 127;
		})
		&& !['__proto__', 'prototype', 'constructor'].includes(normalized.toLowerCase());
}

function safeWarningPathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 128) || 'invalid';
}

function isSafeCatalogVaultPath(value: string): boolean {
	if (
		value !== value.trim()
		|| value.startsWith('/')
		|| value.startsWith('\\')
		|| /^[A-Za-z]:/u.test(value)
		|| value.includes('\\')
		|| value.includes('//')
		|| [...value].some(character => {
			const code = character.codePointAt(0) ?? 0;
			return code <= 31 || code === 127;
		})
	) return false;
	return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function assertNestedCatalogBounds(value: unknown): void {
	const pending: unknown[] = [value];
	while (pending.length > 0) {
		const current = pending.pop();
		if (typeof current === 'string') {
			if ([...current].length > CATALOG_LIMITS_V1.textCharacters) throw new Error('catalog-text-cap');
			continue;
		}
		if (Array.isArray(current)) {
			if (current.length > CONTRACT_LIMITS_V1.collectionItems) throw new Error('catalog-array-cap');
			pending.push(...(current as unknown[]));
			continue;
		}
		if (current && typeof current === 'object') {
			pending.push(...Object.values(current as Record<string, unknown>));
		}
	}
}

function failure(code: StructuredErrorV1['code'], reason: string): CatalogBuildResultV1 {
	return {
		ok: false,
		error: structuredErrorV1(code, reason),
	};
}

function countValues(values: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
}

function compareCustomMappings(left: KeyMapping, right: KeyMapping): number {
	const leftOrder = typeof left.customOrder === 'number' && Number.isFinite(left.customOrder)
		? left.customOrder
		: Number.MAX_SAFE_INTEGER;
	const rightOrder = typeof right.customOrder === 'number' && Number.isFinite(right.customOrder)
		? right.customOrder
		: Number.MAX_SAFE_INTEGER;
	if (leftOrder !== rightOrder) return leftOrder - rightOrder;
	return compareText(left.canonicalKey, right.canonicalKey);
}

function comparable(value: string): string {
	return normalizeKeyMappingComparableName(value).normalize('NFC');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
