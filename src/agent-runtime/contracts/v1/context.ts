import type { MutationKindV1 } from './capabilities';
import type {
	CatalogPoliciesV1,
	CatalogTaxonomyV1,
	FieldDescriptorV1,
	FieldValueTypeV1,
} from './catalog';
import {
	AffectedResourceRevisionMapV1,
	ContextRevisionV1,
	EntityCandidateV1,
	SourceRevisionV1,
	TaskIdentityV1,
	TaskSelectorV1,
	TaskSourceLocatorV1,
} from './identity';
import {
	ConsistencyV1,
	CONTRACT_VERSION_V1,
	ContractWarningV1,
	FreshnessV1,
	JsonValue,
	ProvenanceV1,
	StructuredErrorV1,
	TruncationV1,
} from './primitives';

export type {
	EntityCandidateV1,
	TaskSelectorV1,
} from './identity';

export const CONTEXT_PROJECTIONS_V1 = [
	'exact-task',
	'task-neighborhood',
	'project-analysis',
	'planning-workload',
	'creation-context',
	'mutation-preview',
	'placement-candidates',
] as const;

export type ContextProjectionV1 = typeof CONTEXT_PROJECTIONS_V1[number];

export const CONTEXT_PURPOSES_V1 = [
	'read',
	'analysis',
	'planning',
	'creation',
	'mutation-readiness',
] as const;

export type ContextPurposeV1 = typeof CONTEXT_PURPOSES_V1[number];

export const MUTATION_READINESS_OPERON_IDS_MIN_V1 = 2;
export const MUTATION_READINESS_OPERON_IDS_MAX_V1 = 64;

export interface ContextProjectionLimitV1 {
	defaultLimit: number;
	hardLimit: number;
	maxDepth: number | null;
}

export const CONTEXT_PROJECTION_LIMITS_V1: Readonly<Record<ContextProjectionV1, ContextProjectionLimitV1>> = Object.freeze({
	'exact-task': { defaultLimit: 1, hardLimit: 1, maxDepth: 0 },
	'task-neighborhood': { defaultLimit: 32, hardLimit: 100, maxDepth: 1 },
	'project-analysis': { defaultLimit: 200, hardLimit: 500, maxDepth: 6 },
	'planning-workload': { defaultLimit: 100, hardLimit: 250, maxDepth: null },
	'creation-context': { defaultLimit: 32, hardLimit: 100, maxDepth: 1 },
	'mutation-preview': { defaultLimit: 64, hardLimit: 128, maxDepth: null },
	'placement-candidates': { defaultLimit: 20, hardLimit: 100, maxDepth: null },
});

export const CONTEXT_HYDRATION_KEYS_V1 = [
	'notes',
	'links',
	'custom-fields',
	'source-markdown',
	'tracker-history',
	'reminder-items',
] as const;

export type ContextHydrationKeyV1 = typeof CONTEXT_HYDRATION_KEYS_V1[number];

export const TASK_GET_HYDRATION_KEYS_V1 = [
	...CONTEXT_HYDRATION_KEYS_V1,
	'writable-fields',
] as const;

export type TaskGetHydrationKeyV1 = typeof TASK_GET_HYDRATION_KEYS_V1[number];

export const CONTEXT_HYDRATION_CAPS_V1 = Object.freeze({
	noteBytesPerTask: 8 * 1024,
	linksPerTask: 50,
	customFieldsPerTask: 64,
	customFieldBytesPerTask: 32 * 1024,
	sourceMarkdownBytesPerTask: 64 * 1024,
	trackerHistoryItemsPerTask: 100,
	trackerHistoryBytesPerTask: 32 * 1024,
	reminderItemsPerTask: 256,
	reminderItemIdBytes: 256,
	reminderItemValueBytes: 4 * 1024,
	reminderItemsBytesPerTask: 64 * 1024,
	writableFieldsPerTask: 512,
	writableFieldKeyCharacters: 256,
	writableFieldValueBytes: 64 * 1024,
	writableFieldsBytesPerTask: 256 * 1024,
	relationshipIdsPerKind: 100,
	provenanceEntries: 256,
	resultBytes: 3_145_728,
	placementQueryCharacters: 256,
	placementFiles: 100,
	placementLines: 100,
	placementNoteNameCharacters: 256,
	placementHeadingCharacters: 256,
	placementContextLabelCharacters: 512,
});

export interface TaxonomyReferenceV1 {
	id: string;
	label: string;
}

export interface WorkflowReferenceV1 {
	pipeline: TaxonomyReferenceV1;
	status: TaxonomyReferenceV1;
}

export interface RelationshipSummaryV1 {
	parentOperonId?: string;
	childOperonIds: string[];
	blockingOperonIds: string[];
	blockedByOperonIds: string[];
	relatedOperonIds: string[];
}

export interface RecurrenceSummaryV1 {
	repeating: boolean;
	seriesId?: string;
	occurrenceDate?: string;
}

export interface TrackerSummaryV1 {
	active: boolean;
	sessionCount: number;
}

export interface ReminderItemReferenceV1 {
	collection: 'reminderDatetimes' | 'reminderRules';
	itemId: string;
	expectedValue: string;
}

export interface WritableFieldValueV1 {
	canonicalKey: string;
	valueType: FieldValueTypeV1;
	present: boolean;
	value?: string | number | boolean | string[];
	canClear: boolean;
}

export interface TaskContextV1 {
	identity: TaskIdentityV1;
	description: string;
	representation: TaskSourceLocatorV1['representation'];
	locator: TaskSourceLocatorV1;
	checkbox: 'open' | 'done' | 'cancelled';
	workflow?: WorkflowReferenceV1;
	priority?: TaxonomyReferenceV1;
	dates: {
		due?: string;
		scheduled?: string;
		started?: string;
		completed?: string;
		cancelled?: string;
	};
	datetimes: {
		start?: string;
		end?: string;
		created?: string;
		modified?: string;
	};
	relationships: RelationshipSummaryV1;
	recurrence: RecurrenceSummaryV1;
	tracker: TrackerSummaryV1;
	pinned: boolean;
	sourceRevision: SourceRevisionV1;
	contextRevision: ContextRevisionV1;
	note?: string;
	links?: string[];
	customFields?: Record<string, JsonValue>;
	sourceMarkdown?: string;
	trackerHistory?: string[];
	reminderItems?: ReminderItemReferenceV1[];
	writableFields?: WritableFieldValueV1[];
}

export type TaskCheckboxFilterV1 = 'open' | 'done' | 'cancelled';

export interface TaskDueRangeV1 {
	from?: string;
	to?: string;
}

export interface TaskQueryFiltersV1 {
	checkbox?: TaskCheckboxFilterV1[];
	pipelineIds?: string[];
	statusIds?: string[];
	priorityIds?: string[];
	tiers?: string[];
	filePath?: string;
	parentOperonId?: string;
	due?: TaskDueRangeV1;
	text?: string;
}

export interface TaskQueryPageV1 {
	actualCount: number;
	returnedCount: number;
	truncated: boolean;
	nextCursor?: string;
	asOf: string;
}

export const TASK_FINDER_SCOPES_V1 = [
	'normal',
	'overdue',
	'happens-today',
	'recent',
] as const;
export type TaskFinderScopeV1 = typeof TASK_FINDER_SCOPES_V1[number];

export const TASK_FINDER_REPRESENTATIONS_V1 = ['inline', 'file'] as const;
export type TaskFinderRepresentationV1 = typeof TASK_FINDER_REPRESENTATIONS_V1[number];

export const TASK_FINDER_PROJECT_MODES_V1 = ['direct', 'tree'] as const;
export type TaskFinderProjectModeV1 = typeof TASK_FINDER_PROJECT_MODES_V1[number];

export interface TaskFinderProjectScopeV1 {
	mode: TaskFinderProjectModeV1;
	rootOperonId?: string;
}

export interface TaskFinderRequestV1 extends ReadRequestBaseV1 {
	kind: 'task-finder';
	text?: string;
	filters?: Omit<TaskQueryFiltersV1, 'text' | 'parentOperonId' | 'filePath'>;
	representations?: TaskFinderRepresentationV1[];
	scope?: TaskFinderScopeV1;
	project?: TaskFinderProjectScopeV1;
	limit?: number;
	cursor?: string;
}

export interface TaskFinderTaskRowV1 {
	kind: 'task';
	task: TaskContextV1;
	score: number;
}

export interface TaskFinderProjectRowV1 {
	kind: 'project';
	task: TaskContextV1;
	score: number;
	directTaskCount: number;
	treeTaskCount: number;
	visibleDirectTaskCount: number;
	visibleTreeTaskCount: number;
}

export type TaskFinderRowV1 = TaskFinderTaskRowV1 | TaskFinderProjectRowV1;

export type TaskFinderResultV1 = ReadResultBaseV1 & {
	kind: 'task-finder-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		rows: TaskFinderRowV1[];
		page: TaskQueryPageV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		rows?: never;
		page?: never;
		provenance?: never;
		truncations?: never;
	}
);

export const RELATIONSHIP_KINDS_V1 = [
	'parent',
	'child',
	'blocking',
	'blocked-by',
	'related',
	'ancestor',
	'project-member',
] as const;

export type RelationshipKindV1 = typeof RELATIONSHIP_KINDS_V1[number];
export type RelationshipProvenanceClassV1 = 'explicit' | 'derived' | 'inferred';

export interface RelationshipEdgeV1 {
	kind: RelationshipKindV1;
	sourceOperonId: string;
	targetOperonId: string;
	provenanceClass: RelationshipProvenanceClassV1;
	reason: string;
	confidence?: number;
}

export interface RelationshipSetV1 {
	explicit: RelationshipEdgeV1[];
	derived: RelationshipEdgeV1[];
	inferred: RelationshipEdgeV1[];
}

export interface ContextCatalogSliceV1 {
	taxonomy: CatalogTaxonomyV1;
	fields: FieldDescriptorV1[];
}

export type ContextPolicySliceV1 = CatalogPoliciesV1;

export interface ContextSummaryV1 {
	entityCount: number;
	relationshipCount: number;
	openCount: number;
	doneCount: number;
	cancelledCount: number;
}

export type PlacementCandidateRequestV1 =
	| {
		mode: 'files';
		query?: string;
	}
	| {
		mode: 'lines';
		filePath: string;
	};

export interface PlacementFileCandidateV1 {
	filePath: string;
	noteName: string;
}

export interface PlacementLineCandidateV1 {
	locator: Extract<TaskSourceLocatorV1, { representation: 'inline' }>;
	heading?: string;
	contextLabel: string;
}

interface PlacementCandidatePageV1 {
	actualCount: number;
	returnedCount: number;
	truncated: boolean;
}

export type PlacementCandidatesV1 =
	| PlacementCandidatePageV1 & {
		mode: 'files';
		files: PlacementFileCandidateV1[];
	}
	| PlacementCandidatePageV1 & {
		mode: 'lines';
		filePath: string;
		sourceRevision: SourceRevisionV1;
		lines: PlacementLineCandidateV1[];
	};

interface ReadRequestBaseV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	requestId: string;
	consistency: ConsistencyV1;
}

interface ReadResultBaseV1 {
	contractVersion: typeof CONTRACT_VERSION_V1;
	requestId: string;
	freshness: FreshnessV1;
	warnings: ContractWarningV1[];
}

export interface EntityResolveRequestV1 extends ReadRequestBaseV1 {
	kind: 'entity-resolve';
	selector: TaskSelectorV1;
	limit?: number;
}

export type EntityResolutionResultV1 = ReadResultBaseV1 & {
	kind: 'entity-resolution-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		resolution: 'resolved' | 'ambiguous' | 'not-found';
		candidates: EntityCandidateV1[];
		selected?: EntityCandidateV1;
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		resolution?: never;
		candidates?: never;
		selected?: never;
	}
);

export interface TaskGetRequestV1 extends ReadRequestBaseV1 {
	kind: 'task-get';
	selector: TaskSelectorV1;
	include?: TaskGetHydrationKeyV1[];
}

export type TaskGetResultV1 = ReadResultBaseV1 & {
	kind: 'task-get-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		task: TaskContextV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		task?: never;
		provenance?: never;
		truncations?: never;
	}
);

export interface TaskQueryRequestV1 extends ReadRequestBaseV1 {
	kind: 'task-query';
	filters?: TaskQueryFiltersV1;
	include?: ContextHydrationKeyV1[];
	limit?: number;
	cursor?: string;
}

export type TaskQueryResultV1 = ReadResultBaseV1 & {
	kind: 'task-query-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		tasks: TaskContextV1[];
		page: TaskQueryPageV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		tasks?: never;
		page?: never;
		provenance?: never;
		truncations?: never;
	}
);

export interface TaskFilterQueryRequestV1 extends ReadRequestBaseV1 {
	kind: 'task-filter-query';
	filterSetId: string;
	scope?: {
		kind: 'exact-file' | 'folder-tree';
		path: string;
	};
	include?: ContextHydrationKeyV1[];
	limit?: number;
	cursor?: string;
}

export type TaskFilterQueryResultV1 = ReadResultBaseV1 & {
	kind: 'task-filter-query-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		tasks: TaskContextV1[];
		page: TaskQueryPageV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		tasks?: never;
		page?: never;
		provenance?: never;
		truncations?: never;
	}
);

export interface RelationshipRequestV1 extends ReadRequestBaseV1 {
	kind: 'relationship';
	selector: TaskSelectorV1;
	kinds?: RelationshipKindV1[];
	limit?: number;
	depth?: number;
}

export type RelationshipResultV1 = ReadResultBaseV1 & {
	kind: 'relationship-result';
} & (
	| {
		ok: true;
		contextRevision: ContextRevisionV1;
		relationships: RelationshipSetV1;
		tasks: TaskContextV1[];
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		relationships?: never;
		tasks?: never;
		provenance?: never;
		truncations?: never;
	}
);

export interface ContextRequestV1 extends ReadRequestBaseV1 {
	kind: 'context';
	purpose: ContextPurposeV1;
	projection: ContextProjectionV1;
	selector?: TaskSelectorV1;
	/** Exact multi-task roots for bounded batch mutation readiness. Mutually exclusive with selector. */
	operonIds?: string[];
	filters?: TaskQueryFiltersV1;
	include?: ContextHydrationKeyV1[];
	limit?: number;
	depth?: number;
	cursor?: string;
	targetFilePath?: string;
	mutationKind?: MutationKindV1;
	placement?: PlacementCandidateRequestV1;
}

export type ContextPackV1 = {
	contractVersion: typeof CONTRACT_VERSION_V1;
	requestId: string;
	kind: 'context-pack';
	purpose: ContextPurposeV1;
	projection: ContextProjectionV1;
	warnings: ContractWarningV1[];
} & (
	| {
		ok: true;
		execution: FreshnessV1;
		contextRevision: ContextRevisionV1;
		catalogRevision?: string;
		asOf?: string;
		entities: TaskContextV1[];
		relationships: RelationshipSetV1;
		catalog?: ContextCatalogSliceV1;
		policies?: ContextPolicySliceV1;
		resourceRevisions?: AffectedResourceRevisionMapV1;
		summary?: ContextSummaryV1;
		query?: TaskQueryPageV1;
		placement?: PlacementCandidatesV1;
		provenance: ProvenanceV1[];
		truncations: TruncationV1[];
		error?: never;
	}
	| {
		ok: false;
		contextRevision?: ContextRevisionV1;
		error: StructuredErrorV1;
		execution?: never;
		catalogRevision?: never;
		asOf?: never;
		entities?: never;
		relationships?: never;
		catalog?: never;
		policies?: never;
		resourceRevisions?: never;
		summary?: never;
		query?: never;
		placement?: never;
		provenance?: never;
		truncations?: never;
	}
);

export function resolveProjectionBoundsV1(
	projection: ContextProjectionV1,
	requestedLimit?: number,
	requestedDepth?: number,
): { limit: number; depth: number | null } {
	const policy = CONTEXT_PROJECTION_LIMITS_V1[projection];
	const limit = requestedLimit === undefined
		? policy.defaultLimit
		: Math.max(1, Math.min(Math.floor(requestedLimit), policy.hardLimit));
	const depth = policy.maxDepth === null
		? null
		: requestedDepth === undefined
			? policy.maxDepth
			: Math.max(0, Math.min(Math.floor(requestedDepth), policy.maxDepth));
	return { limit, depth };
}
