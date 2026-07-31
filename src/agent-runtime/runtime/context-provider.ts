import {
	CONTEXT_HYDRATION_CAPS_V1,
	type EntityCandidateV1,
	type PlacementCandidateRequestV1,
	type PlacementCandidatesV1,
	type RelationshipEdgeV1,
	type RelationshipKindV1,
	type RelationshipSetV1,
	type TaskContextV1,
	type TaskGetHydrationKeyV1,
	type TaskFinderRequestV1,
	type TaskQueryFiltersV1,
	type TaskSelectorV1,
} from '../contracts/v1/context';
import type { CatalogProjectionV1 } from './catalog-builder';
import {
	classifyOperonIdV1,
	OPERON_ID_PATTERN_V1,
	sameTaskSourceLocatorV1,
	type ContextRevisionV1,
	type TaskSourceLocatorV1,
	validateVaultRelativePathV1,
} from '../contracts/v1/identity';
import {
	type ContractWarningV1,
	type JsonValue,
	type ProvenanceV1,
	type StructuredErrorV1,
	type TruncationV1,
	structuredErrorV1,
	utf8ByteLengthV1,
} from '../contracts/v1/primitives';
import { parseListValue } from '../../core/parser';
import { normalizePriorityValue } from '../../core/priority-rank';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredStatusIdentity,
} from '../../core/workflow-status-identity';
import {
	buildProjectSearchCandidates,
	createTaskSearchSession,
	rankTaskSearchResults,
	resolveProjectSearchVisibleTaskIds,
	tokenizeTaskSearchText,
	type ProjectSearchMode,
	type TaskSearchSession,
} from '../../systems/task-search';
import { parseTrackerList } from '../../systems/tracker-utils';
import { toLocalDate } from '../../core/local-time';
import type { IndexedTask, IndexedTaskInstance } from '../../types/fields';
import type {
	IndexedTaskInstanceSnapshot,
	IndexedTaskSnapshot,
} from '../../indexer/indexer';
import type { OperonSettings } from '../../types/settings';
import { RuntimeSourceHydratorV1 } from './context-source';
import { reminderItemIdV1 } from './task-mutation-adapter';
import {
	isBlankMarkdownBodyLine,
	markdownBodyStartLine,
} from '../../core/markdown-body';

export interface LiveReadAuthoritySnapshotV1 {
	ramGeneration: number;
	verified: boolean;
	reason?: string;
}

export interface IndexContextReadPortV1 {
	getTaskSnapshot(operonId: string): IndexedTaskSnapshot | undefined;
	getAllTaskSnapshots(): readonly IndexedTaskSnapshot[];
	getDuplicateInstanceSnapshots(operonId: string): readonly IndexedTaskInstanceSnapshot[];
	getAllDuplicateInstanceSnapshots(): readonly IndexedTaskInstanceSnapshot[];
	getTaskIdsInFileSnapshot(filePath: string): readonly string[];
	getChildIdsSnapshot(parentOperonId: string): readonly string[];
	getTaskIdsByWorkflowStatusSnapshot(statusValue: string): readonly string[];
	getTaskIdsByPrioritySnapshot(priorityValue: string): readonly string[];
	getTaskIdsDueInRangeSnapshot(startDate: string, endDate: string): readonly string[];
	getOpenTaskIdsSnapshot(): readonly string[];
	getLiveReadAuthoritySnapshot(): Readonly<{
		state: 'verified' | 'settling' | 'recovery-required' | 'unverified' | 'unloading';
		ramGeneration: number;
	}>;
}

export interface AuxiliaryContextReadPortV1 {
	isPinned(operonId: string): boolean;
	getActiveTrackerTaskId(): string | null;
}

export interface PlacementContextReadPortV1 {
	listMarkdownFilePaths(): readonly string[];
}

export interface ContextProjectionDiagnosticsV1 {
	provenance: ProvenanceV1[];
	truncations: TruncationV1[];
	warnings: ContractWarningV1[];
}

export interface ResolvedEntityProjectionV1 {
	resolution: 'resolved' | 'ambiguous' | 'not-found';
	candidates: EntityCandidateV1[];
	selected?: EntityCandidateV1;
	task?: IndexedTask;
	error?: StructuredErrorV1;
}

export interface QueryProjectionV1 {
	tasks: IndexedTask[];
	actualCount: number;
	asOf: string;
}

export type ExactTasksByIdsProjectionV1 =
	| { ok: true; tasks: IndexedTask[] }
	| { ok: false; error: StructuredErrorV1 };

export interface FinderProjectionV1 {
	rows: Array<
		| { kind: 'task'; task: IndexedTask; score: number }
		| {
			kind: 'project';
			task: IndexedTask;
			score: number;
			directTaskCount: number;
			treeTaskCount: number;
			visibleDirectTaskCount: number;
			visibleTreeTaskCount: number;
		}
	>;
	actualCount: number;
	asOf: string;
}

export interface HydratedTasksProjectionV1 extends ContextProjectionDiagnosticsV1 {
	tasks: TaskContextV1[];
	error?: StructuredErrorV1;
}

export type PlacementProjectionResultV1 =
	| { ok: true; value: PlacementCandidatesV1 }
	| { ok: false; error: StructuredErrorV1 };

const RELATIONSHIP_ORDER: Readonly<Record<RelationshipKindV1, number>> = Object.freeze({
	parent: 0,
	child: 1,
	blocking: 2,
	'blocked-by': 3,
	related: 4,
	ancestor: 5,
	'project-member': 6,
});
const FINDER_RESULT_CACHE_MAX_ENTRIES = 8;
const FINDER_RESULT_CACHE_MAX_ROWS = 10_000;
const FINDER_RESULT_CACHE_MAX_TOTAL_ROWS = 20_000;

export class LiveIndexContextProviderV1 {
	private finderCache: {
		generation: number;
		semanticsSignature: string;
		tasks: IndexedTask[];
		sessions: Map<string, TaskSearchSession>;
		results: Map<string, FinderProjectionV1['rows']>;
		resultRows: number;
	} | null = null;

	constructor(
		private readonly index: IndexContextReadPortV1,
		private readonly auxiliary: AuxiliaryContextReadPortV1,
		private readonly sourceHydrator: RuntimeSourceHydratorV1,
		private readonly getSettings: () => Readonly<OperonSettings>,
		private readonly getCatalog: () => CatalogProjectionV1,
		private readonly placement: PlacementContextReadPortV1 = {
			listMarkdownFilePaths: () => [],
		},
	) {}

	getReadAuthority(): LiveReadAuthoritySnapshotV1 {
		const authority = this.index.getLiveReadAuthoritySnapshot();
		return {
			ramGeneration: authority.ramGeneration,
			verified: authority.state === 'verified',
			...(authority.state === 'verified' ? {} : { reason: authority.state }),
		};
	}

	getTaskById(operonId: string): IndexedTask | undefined {
		const task = this.index.getTaskSnapshot(operonId);
		return task ? cloneTask(task) : undefined;
	}

	getTasksByIds(operonIds: readonly string[]): IndexedTask[] {
		return operonIds
			.map(operonId => this.index.getTaskSnapshot(operonId))
			.filter((task): task is IndexedTaskSnapshot => !!task)
			.map(cloneTask);
	}

	getExactTasksByIds(operonIds: readonly string[]): ExactTasksByIdsProjectionV1 {
		const tasks: IndexedTask[] = [];
		for (const operonId of operonIds) {
			if (this.index.getDuplicateInstanceSnapshots(operonId).length > 0) {
				return {
					ok: false,
					error: contextProviderError(
						'duplicate-operon-id',
						`Exact batch readiness is blocked by duplicate operonId: ${operonId}.`,
						false,
					),
				};
			}
			const task = this.index.getTaskSnapshot(operonId);
			if (!task) {
				return {
					ok: false,
					error: contextProviderError(
						'entity-not-found',
						`Exact batch readiness target does not exist: ${operonId}.`,
						false,
					),
				};
			}
			tasks.push(cloneTask(task));
		}
		return { ok: true, tasks };
	}

	getChildIds(operonId: string): readonly string[] {
		return this.index.getChildIdsSnapshot(operonId);
	}

	async getPlacementCandidates(
		request: PlacementCandidateRequestV1,
		requestedLimit: number = 20,
	): Promise<PlacementProjectionResultV1> {
		const limit = Math.max(
			1,
			Math.min(
				Math.floor(requestedLimit),
				request.mode === 'files'
					? CONTEXT_HYDRATION_CAPS_V1.placementFiles
				: CONTEXT_HYDRATION_CAPS_V1.placementLines,
			),
		);
		const excludedFolders = this.getSettings().excludedFolders
			.map(path => path.replace(/^\/+|\/+$/gu, ''))
			.filter(Boolean);
		if (request.mode === 'files') {
			const query = normalizePlacementSearch(request.query ?? '');
			const candidates = [...new Set(this.placement.listMarkdownFilePaths())]
				.filter(filePath => (
					filePath.toLowerCase().endsWith('.md')
					&& validateVaultRelativePathV1(filePath) === null
					&& !isExcludedPlacementPath(filePath, excludedFolders)
				))
				.map(filePath => ({
					filePath,
					noteName: placementNoteName(filePath),
				}))
				.filter(candidate => placementMetadataMatches(candidate, query))
				.sort((left, right) => comparePlacementFiles(left, right, query));
			const files = candidates.slice(0, limit);
			return {
				ok: true,
				value: {
					mode: 'files',
					actualCount: candidates.length,
					returnedCount: files.length,
					truncated: files.length < candidates.length,
					files,
				},
			};
		}
		if (
			validateVaultRelativePathV1(request.filePath) !== null
			|| !request.filePath.toLowerCase().endsWith('.md')
		) {
			return {
				ok: false,
				error: contextProviderError(
					'invalid-request',
					'Placement candidates require one vault-relative Markdown file.',
					false,
				),
			};
		}
		if (isExcludedPlacementPath(request.filePath, excludedFolders)) {
			return {
				ok: false,
				error: contextProviderError(
					'entity-not-found',
					'The exact placement source file is unavailable.',
					false,
				),
			};
		}
		const snapshot = await this.sourceHydrator.readSnapshot(request.filePath);
		if (!snapshot) {
			return {
				ok: false,
				error: contextProviderError(
					'entity-not-found',
					'The exact placement source file does not exist.',
					false,
				),
			};
		}
		if (!snapshot.stable) {
			return {
				ok: false,
				error: contextProviderError(
					'live-settling',
					'The exact placement source changed while it was being read.',
					true,
				),
			};
		}
		const candidates = buildPlacementLineCandidates(request.filePath, snapshot.content);
		const lines = candidates.slice(0, limit);
		return {
			ok: true,
			value: {
				mode: 'lines',
				filePath: request.filePath,
				sourceRevision: {
					algorithm: 'sha256',
					contentDigest: this.sourceHydrator.digestSnapshot(snapshot),
				},
				actualCount: candidates.length,
				returnedCount: lines.length,
				truncated: lines.length < candidates.length,
				lines,
			},
		};
	}

	async resolve(selector: TaskSelectorV1, requestedLimit: number = 10): Promise<ResolvedEntityProjectionV1> {
		const limit = Math.max(1, Math.min(Math.floor(requestedLimit), 500));
		switch (selector.kind) {
			case 'operon-id':
				return this.resolveOperonId(selector.operonId, limit);
			case 'exact-locator':
				return await this.resolveExactLocator(selector.locator, selector.expectedOperonId, limit);
			case 'exact-path':
				return await this.resolveExactPath(selector.filePath, selector.expectedOperonId, limit);
			case 'exact-name':
				return this.resolveExactName(selector.noteName, selector.expectedOperonId, limit);
			case 'search':
				return this.resolveSearch(selector.query, selector.limit ?? limit);
		}
	}

	query(
		filters: TaskQueryFiltersV1 = {},
		requestedLimit: number = 100,
		asOf = new Date().toISOString(),
		offset: number = 0,
	): QueryProjectionV1 {
		const hardLimit = Math.max(1, Math.min(Math.floor(requestedLimit), 500));
		const safeOffset = Math.max(0, Math.floor(offset));
		const catalog = this.getCatalog();
		const indexedSets: Set<string>[] = [];
		if (filters.filePath) indexedSets.push(new Set(this.index.getTaskIdsInFileSnapshot(filters.filePath)));
		if (filters.parentOperonId) indexedSets.push(new Set(this.index.getChildIdsSnapshot(filters.parentOperonId)));
		if (filters.due?.from || filters.due?.to) {
			indexedSets.push(new Set(this.index.getTaskIdsDueInRangeSnapshot(
				filters.due.from ?? '0000-01-01',
				filters.due.to ?? '9999-12-31',
			)));
		}
		if (filters.statusIds?.length) {
			indexedSets.push(this.unionStatusIds(filters.statusIds));
		} else if (filters.pipelineIds?.length) {
			indexedSets.push(this.unionPipelineIds(filters.pipelineIds));
		}
		if (filters.priorityIds?.length) indexedSets.push(this.unionPriorityIds(filters.priorityIds));
		if (filters.checkbox?.length === 1 && filters.checkbox[0] === 'open') {
			indexedSets.push(new Set(this.index.getOpenTaskIdsSnapshot()));
		}
		const candidateIds = indexedSets.length === 0 ? null : intersectSets(indexedSets);
		const snapshotCandidates = (candidateIds
			? Array.from(candidateIds, operonId => this.index.getTaskSnapshot(operonId))
				.filter((task): task is IndexedTaskSnapshot => !!task)
			: this.index.getAllTaskSnapshots())
			.filter(task => matchesFilters(task, filters, catalog));
		let candidates: Array<IndexedTask | IndexedTaskSnapshot>;
		if (filters.text?.trim()) {
			candidates = rankTaskSearchResults({
				tasks: snapshotCandidates.map(cloneTask),
				query: filters.text,
				includeAllTasks: true,
				keyMappings: this.getSettings().keyMappings,
				session: createTaskSearchSession(),
			}).map(result => result.task);
		} else {
			candidates = [...snapshotCandidates];
			const priorityRank = new Map(
				catalog.taxonomy.priorities.map(priority => [
					normalizePriorityValue(priority.label),
					priority.order,
				]),
			);
			candidates.sort((left, right) => compareWorkloadTasks(left, right, priorityRank, asOf));
		}
		return {
			actualCount: candidates.length,
			tasks: candidates.slice(safeOffset, safeOffset + hardLimit).map(cloneTask),
			asOf,
		};
	}

	queryFinder(
		request: TaskFinderRequestV1,
		requestedLimit: number,
		asOf: string,
		offset: number,
	): FinderProjectionV1 {
		const hardLimit = Math.max(1, Math.min(Math.floor(requestedLimit), 250));
		const safeOffset = Math.max(0, Math.floor(offset));
		const settings = this.getSettings();
		const catalog = this.getCatalog();
		const cache = this.getFinderCache(settings, catalog);
		const query = request.text?.trim() ?? '';
		if (query && (query.length < 2 || tokenizeTaskSearchText(query).length === 0)) {
			return { rows: [], actualCount: 0, asOf };
		}
		const baseFilters: TaskQueryFiltersV1 = {
			...(request.filters ?? {}),
		};
		let scoped = cache.tasks.filter(task => matchesFilters(task, baseFilters, catalog));
		scoped = scoped.filter(task => matchesFinderScope(task, request.scope ?? 'normal', settings, asOf));
		const visible = scoped.filter(task => matchesFinderRepresentation(task, request.representations));
		const sessionKey = finderSessionKey(request, visible);
		const session = this.getFinderSession(cache, sessionKey);
		const resultKey = finderResultKey(request, asOf);
		const cachedRows = cache.results.get(resultKey);
		if (cachedRows) {
			cache.results.delete(resultKey);
			cache.results.set(resultKey, cachedRows);
			return {
				actualCount: cachedRows.length,
				rows: cachedRows.slice(safeOffset, safeOffset + hardLimit),
				asOf,
			};
		}
		const projectMode: ProjectSearchMode | null = request.project
			? request.project.mode === 'tree' ? 'pt' : 'pc'
			: null;
		let allRows: FinderProjectionV1['rows'];
		if (projectMode && !request.project?.rootOperonId) {
			const visibleIds = new Set(visible.map(task => task.operonId));
			const candidates = buildProjectSearchCandidates(
				scoped,
				query.toLocaleLowerCase(),
				this.finderProjectResolvers(),
				{
					match: 'taskSearch',
					sort: 'taskFinderRank',
					visibleTaskIds: visibleIds,
					visibilityMode: projectMode,
					candidateFilter: task => matchesFinderRepresentation(task, request.representations),
					keyMappings: settings.keyMappings,
					session,
				},
			);
			allRows = candidates.map(candidate => ({
				kind: 'project',
				task: candidate.task,
				score: finderScore(candidate.task, query, settings.keyMappings, session),
				directTaskCount: candidate.directChildCount,
				treeTaskCount: candidate.descendantCount,
				visibleDirectTaskCount: candidate.directVisibleCount,
				visibleTreeTaskCount: candidate.treeVisibleCount,
			}));
		} else {
			let tasks = visible;
			if (projectMode && request.project?.rootOperonId) {
				const visibleIds = resolveProjectSearchVisibleTaskIds(
					request.project.rootOperonId,
					projectMode,
					scoped,
					this.finderProjectResolvers(),
				);
				tasks = tasks.filter(task => visibleIds.has(task.operonId));
			}
			if (query) {
				allRows = rankTaskSearchResults({
					tasks,
					query,
					includeAllTasks: true,
					keyMappings: settings.keyMappings,
					session,
				}).map(result => ({ kind: 'task', task: result.task, score: result.score }));
			} else {
				const scope = request.scope ?? 'normal';
				const selectedProjectUsesRankedEmptyOrder = projectMode !== null
					&& request.project?.rootOperonId !== undefined
					&& scope !== 'happens-today';
				const ordered = selectedProjectUsesRankedEmptyOrder
					? rankTaskSearchResults({
						tasks,
						query: '',
						includeAllTasks: true,
						keyMappings: settings.keyMappings,
						session,
					}).map(result => result.task)
					: sortFinderScopeTasks(tasks, scope, settings, asOf);
				allRows = ordered.map(task => ({
					kind: 'task',
					task,
					score: finderScopeScore(task, scope),
				}));
			}
		}
		if (allRows.length <= FINDER_RESULT_CACHE_MAX_ROWS) {
			while (
				cache.results.size >= FINDER_RESULT_CACHE_MAX_ENTRIES
				|| cache.resultRows + allRows.length > FINDER_RESULT_CACHE_MAX_TOTAL_ROWS
			) {
				const oldest = cache.results.keys().next().value as string | undefined;
				if (oldest === undefined) break;
				const removed = cache.results.get(oldest);
				cache.results.delete(oldest);
				cache.resultRows -= removed?.length ?? 0;
			}
			cache.results.set(resultKey, allRows);
			cache.resultRows += allRows.length;
		}
		while (cache.results.size > FINDER_RESULT_CACHE_MAX_ENTRIES) {
			const oldest = cache.results.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			const removed = cache.results.get(oldest);
			cache.results.delete(oldest);
			cache.resultRows -= removed?.length ?? 0;
		}
		return {
			actualCount: allRows.length,
			rows: allRows.slice(safeOffset, safeOffset + hardLimit),
			asOf,
		};
	}

	private getFinderCache(settings: Readonly<OperonSettings>, catalog: CatalogProjectionV1) {
		const generation = this.index.getLiveReadAuthoritySnapshot().ramGeneration;
		const semanticsSignature = JSON.stringify([
			catalog.catalogRevision,
			settings.taskFinderRecentModifiedDays,
			settings.keyMappings,
		]);
		if (
			!this.finderCache
			|| this.finderCache.generation !== generation
			|| this.finderCache.semanticsSignature !== semanticsSignature
		) {
			this.finderCache = {
				generation,
				semanticsSignature,
				tasks: this.index.getAllTaskSnapshots().map(cloneTask),
				sessions: new Map(),
				results: new Map(),
				resultRows: 0,
			};
		}
		return this.finderCache;
	}

	private getFinderSession(
		cache: NonNullable<LiveIndexContextProviderV1['finderCache']>,
		key: string,
	): TaskSearchSession {
		const existing = cache.sessions.get(key);
		if (existing) {
			cache.sessions.delete(key);
			cache.sessions.set(key, existing);
			return existing;
		}
		const session = createTaskSearchSession();
		cache.sessions.set(key, session);
		while (cache.sessions.size > 8) {
			const oldest = cache.sessions.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			cache.sessions.delete(oldest);
		}
		return session;
	}

	private finderProjectResolvers() {
		return {
			getChildIds: (parentId: string) => this.index.getChildIdsSnapshot(parentId),
			getAllDescendantIds: (parentId: string) => collectDescendantIds(
				parentId,
				id => this.index.getChildIdsSnapshot(id),
			),
		};
	}

	buildRelationships(
		root: Readonly<IndexedTask>,
		options: {
			kinds?: readonly RelationshipKindV1[];
			depth?: number;
			limit?: number;
			includeProjectMembers?: boolean;
		} = {},
	): RelationshipSetV1 {
		const allowed = new Set(options.kinds ?? Object.keys(RELATIONSHIP_ORDER) as RelationshipKindV1[]);
		const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
		const depth = Math.max(0, Math.min(options.depth ?? 1, 6));
		const explicit: RelationshipEdgeV1[] = [];
		const derived: RelationshipEdgeV1[] = [];
		const push = (edge: RelationshipEdgeV1): void => {
			if (!allowed.has(edge.kind)) return;
			if (
				!OPERON_ID_PATTERN_V1.test(edge.sourceOperonId)
				|| !OPERON_ID_PATTERN_V1.test(edge.targetOperonId)
			) return;
			if (explicit.length + derived.length >= limit) return;
				const destination = edge.provenanceClass === 'explicit' ? explicit : derived;
				destination.push(edge);
			};

		const parentId = clean(root.fieldValues['parentTask']);
		if (parentId && this.index.getTaskSnapshot(parentId)) {
			push(edge(root.operonId, parentId, 'parent', 'explicit', 'parentTask field'));
		}
		for (const childId of this.index.getChildIdsSnapshot(root.operonId)) {
			push(edge(root.operonId, childId, 'child', 'derived', 'inverse parentTask index'));
		}
		for (const target of parseListValue(root.fieldValues['blocking'] ?? '')) {
			if (this.index.getTaskSnapshot(target)) {
				push(edge(root.operonId, target, 'blocking', 'explicit', 'blocking field'));
			}
		}
		for (const target of parseListValue(root.fieldValues['blockedBy'] ?? '')) {
			if (this.index.getTaskSnapshot(target)) {
				push(edge(root.operonId, target, 'blocked-by', 'explicit', 'blockedBy field'));
			}
		}
		for (const reference of parseListValue(root.fieldValues['related'] ?? '')) {
			const target = this.resolveRelatedReference(reference);
			if (target) push(edge(root.operonId, target.operonId, 'related', 'explicit', 'uniquely resolved related reference'));
		}

		if (depth > 0 && parentId) {
			const visited = new Set([root.operonId]);
			let currentId = parentId;
			for (let level = 1; level <= depth; level++) {
				if (!currentId || visited.has(currentId)) break;
				const ancestor = this.index.getTaskSnapshot(currentId);
				if (!ancestor) break;
				visited.add(currentId);
				push(edge(root.operonId, currentId, 'ancestor', 'derived', `parent chain depth ${level}`));
				currentId = clean(ancestor.fieldValues['parentTask']);
			}
		}
		if (options.includeProjectMembers) {
			for (const memberId of collectDescendants(this.index, root.operonId, depth, limit)) {
				push(edge(root.operonId, memberId, 'project-member', 'derived', 'bounded project hierarchy'));
			}
		}
		explicit.sort(compareEdges);
		derived.sort(compareEdges);
		return { explicit, derived, inferred: [] };
	}

	async hydrateTasks(options: {
		tasks: readonly IndexedTask[];
		include?: readonly TaskGetHydrationKeyV1[];
		contextRevision: ContextRevisionV1;
		relationships?: RelationshipSetV1;
	}): Promise<HydratedTasksProjectionV1> {
		const include = new Set(options.include ?? []);
		const diagnostics: ContextProjectionDiagnosticsV1 = {
			provenance: [],
			truncations: [],
			warnings: [],
		};
		const catalog = this.getCatalog();
		const tasks: TaskContextV1[] = [];
		const sourceSnapshots = new Map<
			string,
			{
				snapshot: NonNullable<Awaited<ReturnType<RuntimeSourceHydratorV1['readSnapshot']>>>;
				digest: string;
				lines: readonly string[];
			} | null
		>();
		for (const task of options.tasks) {
			if (!sourceSnapshots.has(task.primary.filePath)) {
				const snapshot = await this.sourceHydrator.readSnapshot(task.primary.filePath);
				sourceSnapshots.set(task.primary.filePath, snapshot
					? {
						snapshot,
						digest: this.sourceHydrator.digestSnapshot(snapshot),
						lines: snapshot.content.split(/\r?\n/u),
					}
					: null);
			}
			const preparedSource = sourceSnapshots.get(task.primary.filePath) ?? null;
			const hydrated = await this.sourceHydrator.hydrate({
				task,
				keyMappings: this.getSettings().keyMappings,
				ramGeneration: options.contextRevision.index.ramGeneration,
				includeSourceMarkdown: include.has('source-markdown'),
				sourceSnapshot: preparedSource?.snapshot ?? null,
				...(preparedSource ? { sourceSnapshotDigest: preparedSource.digest } : {}),
				...(preparedSource ? { sourceLines: preparedSource.lines } : {}),
			});
			if (!hydrated.ok) {
				return {
					tasks: [],
					...diagnostics,
					error: contextProviderError(
						hydrated.reason === 'source-missing' ? 'entity-not-found' : 'stale-source',
						'The exact task source could not be verified against the live index.',
						hydrated.reason !== 'source-missing',
					),
				};
			}
			const taskRelationships = options.relationships
				? filterRelationshipsForTask(options.relationships, task.operonId)
				: this.buildRelationships(task, { depth: 0 });
			const dto = this.toTaskContext(
				task,
				options.contextRevision,
				catalog,
				hydrated.value.sourceRevision,
				taskRelationships,
			);
			if (clean(task.fieldValues['status']) && !dto.workflow) {
				diagnostics.warnings.push({
					code: 'taxonomy-identity-unresolved',
					message: 'A task workflow value does not resolve to one current stable taxonomy identity.',
					path: `entities.${task.operonId}.workflow`,
				});
			}
			if (clean(task.fieldValues['priority']) && !dto.priority) {
				diagnostics.warnings.push({
					code: 'taxonomy-identity-unresolved',
					message: 'A task priority value does not resolve to one current stable taxonomy identity.',
					path: `entities.${task.operonId}.priority`,
				});
			}
			appendInvalidMetadataWarnings(task, dto, diagnostics);
			this.applyOptionalHydration(
				dto,
				task,
				include,
				catalog,
				hydrated.value.sourceMarkdown,
				diagnostics,
			);
			tasks.push(dto);
			diagnostics.provenance.push({
				path: `entities.${task.operonId}`,
				source: 'live-runtime',
				revision: hydrated.value.sourceRevision.contentDigest,
				derived: false,
			});
		}
			if (diagnostics.provenance.length > CONTEXT_HYDRATION_CAPS_V1.provenanceEntries) {
			diagnostics.truncations.push({
				path: 'provenance',
				actualCount: diagnostics.provenance.length,
				returnedCount: CONTEXT_HYDRATION_CAPS_V1.provenanceEntries,
				limit: CONTEXT_HYDRATION_CAPS_V1.provenanceEntries,
			});
			diagnostics.provenance = diagnostics.provenance.slice(0, CONTEXT_HYDRATION_CAPS_V1.provenanceEntries);
		}
		boundDiagnostics(diagnostics);
		return { tasks, ...diagnostics };
	}

	private resolveOperonId(operonId: string, limit: number): ResolvedEntityProjectionV1 {
		const duplicate = this.index.getDuplicateInstanceSnapshots(operonId);
		if (duplicate.length > 0) {
			return ambiguousCandidates(duplicate
				.slice(0, limit)
				.map(instance => candidate(instance, true, 1, ['exact-operon-id', 'duplicate-id'])));
		}
		const task = this.index.getTaskSnapshot(operonId);
		if (!task) return notFound();
		const cloned = cloneTask(task);
		return resolved(cloned, candidate(cloned, false, 1, ['exact-operon-id']));
	}

	private async resolveExactLocator(
		locator: TaskSourceLocatorV1,
		expectedOperonId?: string,
		limit: number = 500,
	): Promise<ResolvedEntityProjectionV1> {
		const canonical = this.index.getTaskIdsInFileSnapshot(locator.filePath)
			.map(operonId => this.index.getTaskSnapshot(operonId))
			.filter((task): task is IndexedTaskSnapshot => !!task)
			.map(cloneTask);
		const duplicates = this.index.getAllDuplicateInstanceSnapshots()
			.filter(task => task.primary.filePath === locator.filePath)
			.map(cloneTask);
		const matches = uniqueTasksByLocator([...canonical, ...duplicates])
			.filter(task => (
				sameTaskSourceLocatorV1(toLocator(task), locator)
				&& (!expectedOperonId || task.operonId === expectedOperonId)
			));
		if (matches.length > 0) return this.finishExactMatches(matches, ['exact-locator'], limit);
		return await this.resolveExactSourceFallback(locator, expectedOperonId, 'exact-locator');
	}

	private async resolveExactPath(
		filePath: string,
		expectedOperonId?: string,
		limit: number = 500,
	): Promise<ResolvedEntityProjectionV1> {
		const canonical = this.index.getTaskIdsInFileSnapshot(filePath)
			.map(operonId => this.index.getTaskSnapshot(operonId))
			.filter((task): task is IndexedTaskSnapshot => !!task)
			.map(cloneTask);
		const duplicates = this.index.getAllDuplicateInstanceSnapshots()
			.filter(task => task.primary.filePath === filePath)
			.map(cloneTask);
		const matches = uniqueTasksByLocator([...canonical, ...duplicates])
			.filter(task => !expectedOperonId || task.operonId === expectedOperonId);
		if (matches.length > 0) return this.finishExactMatches(matches, ['exact-path'], limit);
		return await this.resolveExactSourceFallback(
			{ representation: 'file', filePath },
			expectedOperonId,
			'exact-path',
		);
	}

	private resolveExactName(noteName: string, expectedOperonId: string | undefined, limit: number): ResolvedEntityProjectionV1 {
		const normalized = normalizeName(noteName);
		const canonical = this.index.getAllTaskSnapshots()
			.filter(task => normalizeName(task.primary.filePath) === normalized)
			.filter(task => !expectedOperonId || task.operonId === expectedOperonId)
			.map(cloneTask);
		const duplicateInstances = this.index.getAllDuplicateInstanceSnapshots()
			.filter(task => normalizeName(task.primary.filePath) === normalized)
			.filter(task => !expectedOperonId || task.operonId === expectedOperonId)
			.map(cloneTask);
		const matches = uniqueTasksByLocator([...canonical, ...duplicateInstances]);
		return this.finishExactMatches(matches, ['exact-note-name'], limit);
	}

	private resolveSearch(query: string, limit: number): ResolvedEntityProjectionV1 {
		const boundedLimit = Math.max(1, Math.min(limit, 500));
		const ranked = rankTaskSearchResults({
			tasks: this.index.getAllTaskSnapshots().map(cloneTask),
			query,
			includeAllTasks: true,
			limit: boundedLimit,
			keyMappings: this.getSettings().keyMappings,
			session: createTaskSearchSession(),
		});
		if (ranked.length === 0) return notFound();
		const top = Math.max(1, ranked[0].score);
		let containsDuplicate = false;
		const matches: IndexedTask[] = [];
		const scores = new Map<string, number>();
		for (const result of ranked) {
			scores.set(result.task.operonId, result.score);
			const duplicates = this.index.getDuplicateInstanceSnapshots(result.task.operonId);
			if (duplicates.length > 0) {
				containsDuplicate = true;
				matches.push(...duplicates.map(cloneTask));
			} else {
				matches.push(cloneTask(result.task));
			}
		}
		const boundedMatches = uniqueTasksByLocator(matches).slice(0, boundedLimit);
		const candidates = boundedMatches.map(task => candidate(
			task,
			this.index.getDuplicateInstanceSnapshots(task.operonId).length > 0,
			Math.min(0.99, 0.5 + (0.49 * (scores.get(task.operonId) ?? 0)) / top),
			['indexed-task-search'],
		));
		if (candidates.length === 1 && !containsDuplicate) return resolved(boundedMatches[0], candidates[0]);
		return ambiguousCandidates(candidates);
	}

	private finishExactMatches(matches: IndexedTask[], reasons: string[], limit: number): ResolvedEntityProjectionV1 {
		if (matches.length === 0) return notFound();
		const candidates = matches.slice(0, limit).map(task => candidate(
			task,
			this.index.getDuplicateInstanceSnapshots(task.operonId).length > 0,
			1,
			reasons,
		));
		if (matches.length === 1) return resolved(matches[0], candidates[0]);
		return ambiguousCandidates(candidates);
	}

	private resolveRelatedReference(reference: string): IndexedTask | null {
		const normalized = unwrapWikilink(reference);
		const byId = this.index.getTaskSnapshot(normalized);
		if (byId) {
			return this.index.getDuplicateInstanceSnapshots(byId.operonId).length > 0
				? null
				: cloneTask(byId);
		}
		const pathIds = this.index.getTaskIdsInFileSnapshot(normalized);
		if (pathIds.some(operonId => this.index.getDuplicateInstanceSnapshots(operonId).length > 0)) {
			return null;
		}
		const pathMatches = pathIds
			.map(operonId => this.index.getTaskSnapshot(operonId))
			.filter((task): task is IndexedTaskSnapshot => !!task)
			.map(cloneTask);
		if (pathMatches.length === 1) return pathMatches[0];
		const nameMatches = this.index.getAllTaskSnapshots().filter(task => normalizeName(task.primary.filePath) === normalizeName(normalized));
		return nameMatches.length === 1
			&& this.index.getDuplicateInstanceSnapshots(nameMatches[0].operonId).length === 0
			? cloneTask(nameMatches[0])
			: null;
	}

	private unionStatusIds(statusIds: readonly string[]): Set<string> {
		const ids = new Set<string>();
		for (const pipeline of this.getSettings().pipelines) {
			for (const status of pipeline.statuses) {
				if (!statusIds.includes(status.id)) continue;
				for (const taskId of this.index.getTaskIdsByWorkflowStatusSnapshot(`${pipeline.name}.${status.label}`)) {
					ids.add(taskId);
				}
			}
		}
		return ids;
	}

	private unionPipelineIds(pipelineIds: readonly string[]): Set<string> {
		const ids = new Set<string>();
		for (const pipeline of this.getSettings().pipelines) {
			if (!pipelineIds.includes(pipeline.id)) continue;
			for (const status of pipeline.statuses) {
				for (const taskId of this.index.getTaskIdsByWorkflowStatusSnapshot(`${pipeline.name}.${status.label}`)) {
					ids.add(taskId);
				}
			}
		}
		return ids;
	}

	private unionPriorityIds(priorityIds: readonly string[]): Set<string> {
		const ids = new Set<string>();
		for (const priority of this.getSettings().priorities) {
			if (!priorityIds.includes(priority.id)) continue;
			for (const taskId of this.index.getTaskIdsByPrioritySnapshot(priority.label)) ids.add(taskId);
		}
		return ids;
	}

	private async resolveExactSourceFallback(
		locator: TaskSourceLocatorV1,
		expectedOperonId?: string,
		reason: 'exact-locator' | 'exact-path' = 'exact-locator',
	): Promise<ResolvedEntityProjectionV1> {
		const workflowIndex = buildWorkflowStatusIdentityIndex(this.getSettings().pipelines);
		const task = await this.sourceHydrator.resolveTaskAtLocator({
			locator,
			keyMappings: this.getSettings().keyMappings,
			resolveCheckbox: statusValue => {
				const status = resolveConfiguredStatusIdentity(statusValue, workflowIndex);
				if (status.kind !== 'configured') return 'open';
				if (status.status.isCancelled) return 'cancelled';
				if (status.status.isFinished) return 'done';
				return 'open';
			},
		});
		if (!task || (expectedOperonId && task.operonId !== expectedOperonId)) return notFound();
		const duplicate = this.index.getDuplicateInstanceSnapshots(task.operonId).length > 0;
		if (OPERON_ID_PATTERN_V1.test(task.operonId) && !duplicate) {
			await this.sourceHydrator.requestReindex(locator.filePath);
			return {
				resolution: 'not-found',
				candidates: [],
				error: contextProviderError(
					'stale-source',
					'An exact source task is missing from the verified RAM index.',
					true,
				),
			};
		}
		const reasons = [
			reason,
			duplicate ? 'duplicate-id' : 'legacy-invalid-id',
		];
		return resolved(task, candidate(task, duplicate, 1, reasons));
	}

	private toTaskContext(
		task: IndexedTask,
		contextRevision: ContextRevisionV1,
		catalog: CatalogProjectionV1,
		sourceRevision: TaskContextV1['sourceRevision'],
		relationships: RelationshipSetV1,
	): TaskContextV1 {
		const workflowIndex = buildWorkflowStatusIdentityIndex(this.getSettings().pipelines);
		const status = resolveConfiguredStatusIdentity(task.fieldValues['status'], workflowIndex);
		const priorityMatches = catalog.taxonomy.priorities.filter(candidate => (
			normalizePriorityValue(candidate.label) === normalizePriorityValue(task.fieldValues['priority'] ?? '')
		));
		const priority = priorityMatches.length === 1
			&& catalog.taxonomy.priorities.filter(candidate => candidate.id === priorityMatches[0].id).length === 1
			? priorityMatches[0]
			: undefined;
		const relationshipSummary = summarizeRelationships(task.operonId, relationships);
		const trackerHistory = parseTrackerList(task.fieldValues['trackers']);
		const activeTaskId = this.auxiliary.getActiveTrackerTaskId();
		const locator = toLocator(task);
		return {
			identity: classifyOperonIdV1(
				task.operonId,
				this.index.getDuplicateInstanceSnapshots(task.operonId).length > 0,
			),
			description: task.description,
			representation: locator.representation,
			locator,
			checkbox: task.checkbox,
			...(status.kind === 'configured'
				? {
					workflow: {
						pipeline: { id: status.pipeline.id, label: status.pipeline.name },
						status: { id: status.status.id, label: status.status.label },
					},
				}
				: {}),
			...(priority ? { priority: { id: priority.id, label: priority.label } } : {}),
			dates: compactObject({
				due: validDate(task.fieldValues['dateDue']),
				scheduled: validDate(task.fieldValues['dateScheduled']),
				started: validDate(task.fieldValues['dateStarted']),
				completed: validDate(task.fieldValues['dateCompleted']),
				cancelled: validDate(task.fieldValues['dateCancelled']),
			}),
			datetimes: compactObject({
				start: validLocalDateTime(task.fieldValues['datetimeStart']),
				end: validLocalDateTime(task.fieldValues['datetimeEnd']),
				created: validLocalDateTime(task.fieldValues['datetimeCreated']),
				modified: validLocalDateTime(task.fieldValues['datetimeModified']),
			}),
			relationships: relationshipSummary,
			recurrence: {
				repeating: !!clean(task.fieldValues['repeat']),
				...(/^rs[a-z0-9]{5}$/u.test(clean(task.fieldValues['repeatSeriesId']))
					? { seriesId: clean(task.fieldValues['repeatSeriesId']) }
					: {}),
				...(validDate(task.fieldValues['repeatOccurrenceDate'])
					? { occurrenceDate: validDate(task.fieldValues['repeatOccurrenceDate']) }
					: {}),
			},
			tracker: {
				active: activeTaskId === task.operonId,
				sessionCount: trackerHistory.length,
			},
			pinned: this.auxiliary.isPinned(task.operonId),
			sourceRevision,
			contextRevision: structuredClone(contextRevision),
		};
	}

	private applyOptionalHydration(
		dto: TaskContextV1,
		task: IndexedTask,
		include: ReadonlySet<TaskGetHydrationKeyV1>,
		catalog: CatalogProjectionV1,
		sourceMarkdown: string | undefined,
		diagnostics: ContextProjectionDiagnosticsV1,
	): void {
		if (include.has('notes')) {
			dto.note = boundedString(task.fieldValues['note'] ?? '', CONTEXT_HYDRATION_CAPS_V1.noteBytesPerTask, 'note', task.operonId, diagnostics);
		}
		if (include.has('links')) {
			const links = parseListValue(task.fieldValues['links'] ?? '')
				.filter(link => link.length > 0)
				.map(link => truncateCharacters(link, 4_096));
			dto.links = boundedItems(links, CONTEXT_HYDRATION_CAPS_V1.linksPerTask, 'links', task.operonId, diagnostics);
		}
		if (include.has('tracker-history')) {
			const history = parseTrackerList(task.fieldValues['trackers']).map(session => session.raw);
			const byCount = boundedItems(
				history,
				CONTEXT_HYDRATION_CAPS_V1.trackerHistoryItemsPerTask,
				'trackerHistory',
				task.operonId,
				diagnostics,
			);
			dto.trackerHistory = boundedStringItems(
				byCount,
				CONTEXT_HYDRATION_CAPS_V1.trackerHistoryBytesPerTask,
				'trackerHistory',
				task.operonId,
				diagnostics,
			);
		}
		if (include.has('reminder-items')) {
			dto.reminderItems = buildReminderItemReferences(task, diagnostics);
		}
		if (include.has('writable-fields')) {
			dto.writableFields = buildWritableFieldValues(task, dto, catalog, diagnostics);
		}
		if (include.has('source-markdown') && sourceMarkdown !== undefined) {
			dto.sourceMarkdown = boundedString(
				sourceMarkdown,
				CONTEXT_HYDRATION_CAPS_V1.sourceMarkdownBytesPerTask,
				'sourceMarkdown',
				task.operonId,
				diagnostics,
			);
		}
		if (include.has('custom-fields')) {
			const descriptors = catalog.fields.filter(field => field.source === 'custom' && field.readable);
			const limited = boundedItems(
				descriptors,
				CONTEXT_HYDRATION_CAPS_V1.customFieldsPerTask,
				'customFields',
				task.operonId,
				diagnostics,
			);
			const values: Record<string, JsonValue> = {};
			for (const descriptor of limited) {
				const raw = task.fieldValues[descriptor.canonicalKey];
				if (raw === undefined) continue;
				values[descriptor.canonicalKey] = toCatalogValue(raw, descriptor.valueType);
			}
			dto.customFields = boundJsonRecord(
				values,
				CONTEXT_HYDRATION_CAPS_V1.customFieldBytesPerTask,
				task.operonId,
				diagnostics,
			);
		}
	}
}

function buildWritableFieldValues(
	task: IndexedTask,
	dto: TaskContextV1,
	catalog: CatalogProjectionV1,
	diagnostics: ContextProjectionDiagnosticsV1,
): NonNullable<TaskContextV1['writableFields']> {
	const descriptors = catalog.fields.filter(field => (
		field.mappingStatus === 'mapped'
		&& field.readable
		&& field.mutationClass === 'general-update'
		&& field.mutationOwner === 'tasks.update'
	));
	const candidates: NonNullable<TaskContextV1['writableFields']> = [];
	for (const descriptor of descriptors) {
		const raw = writableFieldRawValue(task, dto, descriptor.canonicalKey);
		if (!raw.present) {
			candidates.push({
				canonicalKey: descriptor.canonicalKey,
				valueType: descriptor.valueType,
				present: false,
				canClear: descriptor.canonicalKey !== 'description',
			});
			continue;
		}
		const value = normalizeWritableFieldValue(raw.value, descriptor.valueType);
		if (value === undefined) {
			diagnostics.warnings.push({
				code: 'invalid-task-metadata-omitted',
				message: 'A writable task field could not be normalized to its declared Catalog type.',
				path: `entities.${task.operonId}.writableFields.${safeWarningPathSegment(descriptor.canonicalKey)}`,
			});
			continue;
		}
		const item: NonNullable<TaskContextV1['writableFields']>[number] = {
			canonicalKey: descriptor.canonicalKey,
			valueType: descriptor.valueType,
			present: true,
			value,
			canClear: descriptor.canonicalKey !== 'description',
		};
		if (utf8ByteLengthV1(JSON.stringify(item.value)) > CONTEXT_HYDRATION_CAPS_V1.writableFieldValueBytes) {
			diagnostics.truncations.push({
				path: `entities.${task.operonId}.writableFields.${safeWarningPathSegment(descriptor.canonicalKey)}.value`,
				actualCount: utf8ByteLengthV1(JSON.stringify(item.value)),
				returnedCount: 0,
				limit: CONTEXT_HYDRATION_CAPS_V1.writableFieldValueBytes,
			});
			continue;
		}
		candidates.push(item);
	}

	const countLimited = candidates.slice(0, CONTEXT_HYDRATION_CAPS_V1.writableFieldsPerTask);
	if (countLimited.length !== candidates.length) {
		diagnostics.truncations.push({
			path: `entities.${task.operonId}.writableFields`,
			actualCount: candidates.length,
			returnedCount: countLimited.length,
			limit: CONTEXT_HYDRATION_CAPS_V1.writableFieldsPerTask,
		});
	}
	const output: NonNullable<TaskContextV1['writableFields']> = [];
	for (const item of countLimited) {
		const candidate = [...output, item];
		if (utf8ByteLengthV1(JSON.stringify(candidate)) > CONTEXT_HYDRATION_CAPS_V1.writableFieldsBytesPerTask) break;
		output.push(item);
	}
	if (output.length !== countLimited.length) {
		diagnostics.truncations.push({
			path: `entities.${task.operonId}.writableFields`,
			actualCount: utf8ByteLengthV1(JSON.stringify(countLimited)),
			returnedCount: utf8ByteLengthV1(JSON.stringify(output)),
			limit: CONTEXT_HYDRATION_CAPS_V1.writableFieldsBytesPerTask,
		});
	}
	if (output.length !== candidates.length) {
		diagnostics.warnings.push({
			code: 'context-field-truncated',
			message: 'Writable-field hydration was bounded by its V1 item or byte limit.',
			path: `entities.${task.operonId}.writableFields`,
		});
	}
	return output;
}

function writableFieldRawValue(
	task: IndexedTask,
	dto: TaskContextV1,
	canonicalKey: string,
): { present: false } | { present: true; value: string | string[] } {
	if (canonicalKey === 'description') return { present: true, value: task.description };
	if (canonicalKey === 'tags') {
		return task.tags.length > 0
			? { present: true, value: [...task.tags] }
			: { present: false };
	}
	if (canonicalKey === 'priority') {
		const rawPriority = task.fieldValues['priority']?.trim();
		if (!rawPriority) return { present: false };
		return { present: true, value: dto.priority?.id ?? rawPriority };
	}
	const value = task.fieldValues[canonicalKey];
	return value === undefined || value === ''
		? { present: false }
		: { present: true, value };
}

function normalizeWritableFieldValue(
	raw: string | string[],
	valueType: CatalogProjectionV1['fields'][number]['valueType'],
): string | number | boolean | string[] | undefined {
	if (valueType === 'list') {
		return Array.isArray(raw) ? raw : parseListValue(raw);
	}
	if (Array.isArray(raw)) return undefined;
	if (valueType === 'number') {
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	if (valueType === 'checkbox') {
		const normalized = raw.trim().toLowerCase();
		if (normalized === 'true') return true;
		if (normalized === 'false') return false;
		return undefined;
	}
	if (valueType === 'date') return validDate(raw);
	if (valueType === 'datetime') return validLocalDateTime(raw);
	return raw;
}

function buildReminderItemReferences(
	task: IndexedTask,
	diagnostics: ContextProjectionDiagnosticsV1,
): NonNullable<TaskContextV1['reminderItems']> {
	const candidates: NonNullable<TaskContextV1['reminderItems']> = [];
	for (const collection of ['reminderDatetimes', 'reminderRules'] as const) {
		const values = splitReminderSourceItems(task.fieldValues[collection]);
		for (const [index, expectedValue] of values.entries()) {
			candidates.push({
				collection,
				itemId: reminderItemIdV1(index, expectedValue),
				expectedValue,
			});
		}
	}

	const output: NonNullable<TaskContextV1['reminderItems']> = [];
	const countLimited = candidates.slice(0, CONTEXT_HYDRATION_CAPS_V1.reminderItemsPerTask);
	if (countLimited.length !== candidates.length) {
		diagnostics.truncations.push({
			path: `entities.${task.operonId}.reminderItems`,
			actualCount: candidates.length,
			returnedCount: countLimited.length,
			limit: CONTEXT_HYDRATION_CAPS_V1.reminderItemsPerTask,
		});
		diagnostics.warnings.push({
			code: 'context-field-truncated',
			message: 'Reminder item hydration was bounded by its V1 item limit.',
			path: `entities.${task.operonId}.reminderItems`,
		});
	}
	let byteLimitReached = false;
	for (const [index, candidate] of countLimited.entries()) {
		if (
			utf8ByteLengthV1(candidate.itemId) > CONTEXT_HYDRATION_CAPS_V1.reminderItemIdBytes
			|| utf8ByteLengthV1(candidate.expectedValue) > CONTEXT_HYDRATION_CAPS_V1.reminderItemValueBytes
		) {
			diagnostics.truncations.push({
				path: `entities.${task.operonId}.reminderItems.${index}`,
				actualCount: utf8ByteLengthV1(candidate.expectedValue),
				returnedCount: 0,
				limit: CONTEXT_HYDRATION_CAPS_V1.reminderItemValueBytes,
			});
			diagnostics.warnings.push({
				code: 'context-field-truncated',
				message: 'An oversized reminder item was omitted from the bounded hydration result.',
				path: `entities.${task.operonId}.reminderItems.${index}`,
			});
			continue;
		}
		const next = [...output, candidate];
		if (
			utf8ByteLengthV1(JSON.stringify(next))
			> CONTEXT_HYDRATION_CAPS_V1.reminderItemsBytesPerTask
		) {
			byteLimitReached = true;
			break;
		}
		output.push(candidate);
	}
	if (byteLimitReached) {
		diagnostics.truncations.push({
			path: `entities.${task.operonId}.reminderItems`,
			actualCount: utf8ByteLengthV1(JSON.stringify(countLimited)),
			returnedCount: utf8ByteLengthV1(JSON.stringify(output)),
			limit: CONTEXT_HYDRATION_CAPS_V1.reminderItemsBytesPerTask,
		});
		diagnostics.warnings.push({
			code: 'context-field-truncated',
			message: 'Reminder item hydration was bounded by its V1 byte limit.',
			path: `entities.${task.operonId}.reminderItems`,
		});
	}
	return output;
}

function safeWarningPathSegment(value: string): string {
	return value.replace(/[~/]/gu, character => character === '~' ? '~0' : '~1');
}

function splitReminderSourceItems(value: string | undefined): string[] {
	if (!value) return [];
	// Preserve each meaningful source token verbatim for public expectedValue
	// compare-and-set material. Empty separators have no mutation identity.
	return value.split(';').filter(item => item.trim().length > 0);
}

function matchesFilters(
	task: IndexedTask | IndexedTaskSnapshot,
	filters: TaskQueryFiltersV1,
	catalog: CatalogProjectionV1,
): boolean {
	if (filters.checkbox?.length && !filters.checkbox.includes(task.checkbox)) return false;
	if (filters.tiers?.length && !filters.tiers.includes(task.tier)) return false;
	if (filters.filePath && task.primary.filePath !== filters.filePath) return false;
	if (filters.parentOperonId && clean(task.fieldValues['parentTask']) !== filters.parentOperonId) return false;
	const due = clean(task.fieldValues['dateDue']);
	if (filters.due?.from && (!due || due < filters.due.from)) return false;
	if (filters.due?.to && (!due || due > filters.due.to)) return false;
	if (filters.priorityIds?.length) {
		const match = catalog.taxonomy.priorities.find(priority => (
			normalizePriorityValue(priority.label) === normalizePriorityValue(task.fieldValues['priority'] ?? '')
		));
		if (!match || !filters.priorityIds.includes(match.id)) return false;
	}
	if (filters.pipelineIds?.length || filters.statusIds?.length) {
		const status = catalog.taxonomy.pipelines.flatMap(pipeline => (
			pipeline.statuses.map(candidate => ({
				pipelineId: pipeline.id,
				statusId: candidate.id,
				value: `${pipeline.name}.${candidate.label}`,
			}))
		)).find(candidate => candidate.value === task.fieldValues['status']);
		if (!status) return false;
		if (filters.pipelineIds?.length && !filters.pipelineIds.includes(status.pipelineId)) return false;
		if (filters.statusIds?.length && !filters.statusIds.includes(status.statusId)) return false;
	}
	return true;
}

function matchesFinderRepresentation(
	task: IndexedTask,
	representations: TaskFinderRequestV1['representations'],
): boolean {
	if (!representations?.length) return true;
	const representation = task.primary.format === 'yaml' ? 'file' : 'inline';
	return representations.includes(representation);
}

function matchesFinderScope(
	task: IndexedTask,
	scope: NonNullable<TaskFinderRequestV1['scope']>,
	settings: Readonly<OperonSettings>,
	asOf: string,
): boolean {
	if (scope === 'normal') return true;
	const parsedAsOf = new Date(asOf);
	const now = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
	const today = toLocalDate(now);
	if (scope === 'overdue') return finderOverdueDate(task, today) !== null;
	if (scope === 'happens-today') return finderTodayPriority(task, today) > 0;
	const days = Math.max(1, Math.min(7, Math.round(settings.taskFinderRecentModifiedDays || 3)));
	return finderModifiedTime(task) >= now.getTime() - days * 24 * 60 * 60 * 1_000;
}

function sortFinderScopeTasks(
	tasks: IndexedTask[],
	scope: NonNullable<TaskFinderRequestV1['scope']>,
	settings: Readonly<OperonSettings>,
	asOf: string,
): IndexedTask[] {
	const parsedAsOf = new Date(asOf);
	const today = toLocalDate(Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf);
	const priorityRank = new Map(
		settings.priorities.map((priority, index) => [normalizePriorityValue(priority.label), index] as const),
	);
	return [...tasks].sort((left, right) => {
		if (scope === 'recent') {
			const modified = finderModifiedTime(right) - finderModifiedTime(left);
			if (modified !== 0) return modified;
		}
		if (scope === 'overdue') {
			const date = (finderOverdueDate(left, today) ?? '').localeCompare(finderOverdueDate(right, today) ?? '');
			if (date !== 0) return date;
			const priority = finderPriorityRank(left, priorityRank) - finderPriorityRank(right, priorityRank);
			if (priority !== 0) return priority;
			const modified = finderModifiedTime(right) - finderModifiedTime(left);
			if (modified !== 0) return modified;
		}
		if (scope === 'happens-today') {
			const todayPriority = finderTodayPriority(left, today) - finderTodayPriority(right, today);
			if (todayPriority !== 0) return todayPriority;
			const priority = finderPriorityRank(left, priorityRank) - finderPriorityRank(right, priorityRank);
			if (priority !== 0) return priority;
			const modified = finderModifiedTime(right) - finderModifiedTime(left);
			if (modified !== 0) return modified;
		}
		if (scope === 'normal') {
			const checkbox = finderCheckboxRank(left.checkbox) - finderCheckboxRank(right.checkbox);
			if (checkbox !== 0) return checkbox;
			const modified = finderModifiedTime(right) - finderModifiedTime(left);
			if (modified !== 0) return modified;
		}
		return compareFinderIdentity(left, right);
	});
}

function finderSessionKey(request: TaskFinderRequestV1, tasks: IndexedTask[]): string {
	return JSON.stringify({
		scope: request.scope ?? 'normal',
		representations: request.representations ?? [],
		filters: request.filters ?? {},
		project: request.project ?? null,
		corpus: tasks.map(task => task.operonId),
	});
}

function finderResultKey(request: TaskFinderRequestV1, asOf: string): string {
	const scope = request.scope ?? 'normal';
	return JSON.stringify({
		text: request.text?.trim() ?? '',
		filters: request.filters ?? {},
		representations: request.representations ?? [],
		scope,
		project: request.project ?? null,
		temporal: finderTemporalCacheKey(scope, asOf),
	});
}

function finderTemporalCacheKey(
	scope: NonNullable<TaskFinderRequestV1['scope']>,
	asOf: string,
): string {
	if (scope === 'normal') return '';
	if (scope === 'recent') return asOf;
	const parsed = new Date(asOf);
	return Number.isNaN(parsed.getTime()) ? asOf.slice(0, 10) : toLocalDate(parsed);
}

function finderScore(
	task: IndexedTask,
	query: string,
	keyMappings: Readonly<OperonSettings>['keyMappings'],
	session: TaskSearchSession,
): number {
	if (!query) return finderScopeScore(task, 'normal');
	return rankTaskSearchResults({
		tasks: [task],
		query,
		includeAllTasks: true,
		keyMappings,
		session,
	})[0]?.score ?? 0;
}

function finderScopeScore(
	task: IndexedTask,
	scope: NonNullable<TaskFinderRequestV1['scope']>,
): number {
	if (scope === 'recent') return finderModifiedTime(task);
	return 0;
}

function finderOverdueDate(task: IndexedTask, today: string): string | null {
	const values = [
		clean(task.fieldValues['dateScheduled']),
		clean(task.fieldValues['dateDue']),
	].filter(value => /^\d{4}-\d{2}-\d{2}$/u.test(value) && value < today);
	values.sort();
	return values[0] ?? null;
}

function finderTodayPriority(task: IndexedTask, today: string): number {
	if (clean(task.fieldValues['dateDue']) === today) return 1;
	if (clean(task.fieldValues['dateScheduled']) === today) return 2;
	if (clean(task.fieldValues['dateStarted']) === today) return 3;
	return 0;
}

function finderPriorityRank(task: IndexedTask, ranks: ReadonlyMap<string, number>): number {
	return ranks.get(normalizePriorityValue(task.fieldValues['priority'] ?? '')) ?? Number.MAX_SAFE_INTEGER;
}

function finderModifiedTime(task: IndexedTask): number {
	return Date.parse(task.datetimeModified || task.fieldValues['datetimeModified'] || '') || 0;
}

function finderCheckboxRank(value: string): number {
	if (value === 'open') return 0;
	if (value === 'done') return 1;
	if (value === 'cancelled') return 2;
	return 3;
}

function compareFinderIdentity(left: IndexedTask, right: IndexedTask): number {
	return left.description.localeCompare(right.description, undefined, { sensitivity: 'base' })
		|| left.operonId.localeCompare(right.operonId, undefined, { sensitivity: 'base' })
		|| (left.operonId === right.operonId ? 0 : left.operonId < right.operonId ? -1 : 1);
}

function collectDescendantIds(
	rootId: string,
	getChildIds: (parentId: string) => readonly string[],
): string[] {
	const output: string[] = [];
	const visited = new Set([rootId]);
	const queue = [...getChildIds(rootId)];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);
		output.push(id);
		queue.push(...getChildIds(id));
	}
	return output;
}

function compareWorkloadTasks(
	left: IndexedTask | IndexedTaskSnapshot,
	right: IndexedTask | IndexedTaskSnapshot,
	priorityRank: ReadonlyMap<string, number>,
	asOf: string,
): number {
	const parsedAsOf = new Date(asOf);
	const today = Number.isNaN(parsedAsOf.getTime()) ? asOf.slice(0, 10) : toLocalDate(parsedAsOf);
	const leftDue = clean(left.fieldValues['dateDue']);
	const rightDue = clean(right.fieldValues['dateDue']);
	const leftOverdue = leftDue && leftDue < today ? 0 : 1;
	const rightOverdue = rightDue && rightDue < today ? 0 : 1;
	if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
	const dueCompare = (leftDue || '9999-12-31').localeCompare(rightDue || '9999-12-31');
	if (dueCompare !== 0) return dueCompare;
	const scheduledCompare = (clean(left.fieldValues['dateScheduled']) || '9999-12-31')
		.localeCompare(clean(right.fieldValues['dateScheduled']) || '9999-12-31');
	if (scheduledCompare !== 0) return scheduledCompare;
	const priorityCompare = (priorityRank.get(normalizePriorityValue(left.fieldValues['priority'] ?? '')) ?? Number.MAX_SAFE_INTEGER)
		- (priorityRank.get(normalizePriorityValue(right.fieldValues['priority'] ?? '')) ?? Number.MAX_SAFE_INTEGER);
	if (priorityCompare !== 0) return priorityCompare;
	const modifiedCompare = clean(right.fieldValues['datetimeModified']).localeCompare(clean(left.fieldValues['datetimeModified']));
	return modifiedCompare || left.operonId.localeCompare(right.operonId);
}

function collectDescendants(
	index: IndexContextReadPortV1,
	rootId: string,
	maxDepth: number,
	limit: number,
): string[] {
	const output: string[] = [];
	const visited = new Set([rootId]);
	let level = [rootId];
	for (let depth = 1; depth <= maxDepth && level.length > 0 && output.length < limit; depth++) {
		const next: string[] = [];
		for (const parentId of level.sort()) {
			for (const childId of [...index.getChildIdsSnapshot(parentId)].sort()) {
				if (visited.has(childId)) continue;
				visited.add(childId);
				output.push(childId);
				next.push(childId);
				if (output.length >= limit) break;
			}
			if (output.length >= limit) break;
		}
		level = next;
	}
	return output;
}

function summarizeRelationships(operonId: string, relationships: RelationshipSetV1): TaskContextV1['relationships'] {
	const all = [...relationships.explicit, ...relationships.derived];
	const values = (kind: RelationshipKindV1): string[] => all
		.filter(edgeValue => edgeValue.sourceOperonId === operonId && edgeValue.kind === kind)
		.map(edgeValue => edgeValue.targetOperonId)
		.filter((value, index, items) => items.indexOf(value) === index)
		.slice(0, CONTEXT_HYDRATION_CAPS_V1.relationshipIdsPerKind);
	const parent = values('parent')[0];
	return {
		...(parent ? { parentOperonId: parent } : {}),
		childOperonIds: values('child'),
		blockingOperonIds: values('blocking'),
		blockedByOperonIds: values('blocked-by'),
		relatedOperonIds: values('related'),
	};
}

function filterRelationshipsForTask(relationships: RelationshipSetV1, operonId: string): RelationshipSetV1 {
	const filter = (edges: RelationshipEdgeV1[]): RelationshipEdgeV1[] => edges.filter(edgeValue => (
		edgeValue.sourceOperonId === operonId || edgeValue.targetOperonId === operonId
	));
	return {
		explicit: filter(relationships.explicit),
		derived: filter(relationships.derived),
		inferred: filter(relationships.inferred),
	};
}

function edge(
	sourceOperonId: string,
	targetOperonId: string,
	kind: RelationshipKindV1,
	provenanceClass: 'explicit' | 'derived',
	reason: string,
): RelationshipEdgeV1 {
	return { sourceOperonId, targetOperonId, kind, provenanceClass, reason };
}

function compareEdges(left: RelationshipEdgeV1, right: RelationshipEdgeV1): number {
	return RELATIONSHIP_ORDER[left.kind] - RELATIONSHIP_ORDER[right.kind]
		|| left.sourceOperonId.localeCompare(right.sourceOperonId)
		|| left.targetOperonId.localeCompare(right.targetOperonId);
}

function ambiguousCandidates(candidates: EntityCandidateV1[]): ResolvedEntityProjectionV1 {
	const sorted = [...candidates].sort(compareCandidates);
	return {
		resolution: 'ambiguous',
		candidates: sorted,
	};
}

function resolved(task: IndexedTask, selected: EntityCandidateV1): ResolvedEntityProjectionV1 {
	return { resolution: 'resolved', candidates: [selected], selected, task: cloneTask(task) };
}

function notFound(): ResolvedEntityProjectionV1 {
	return { resolution: 'not-found', candidates: [] };
}

function candidate(
	task: IndexedTask | IndexedTaskInstance | IndexedTaskSnapshot | IndexedTaskInstanceSnapshot,
	duplicate: boolean,
	confidence: number,
	reasons: string[],
): EntityCandidateV1 {
	const locator = toLocator(task);
	return {
		identity: classifyOperonIdV1(task.operonId, duplicate),
		description: truncateCharacters(task.description, 4_096),
		locator,
		confidence,
		reasons,
		selector: { kind: 'exact-locator', locator, expectedOperonId: task.operonId },
	};
}

function compareCandidates(left: EntityCandidateV1, right: EntityCandidateV1): number {
	return right.confidence - left.confidence
		|| left.description.normalize('NFC').localeCompare(right.description.normalize('NFC'))
		|| left.locator.filePath.localeCompare(right.locator.filePath)
		|| left.locator.representation.localeCompare(right.locator.representation)
		|| (left.locator.representation === 'inline' && right.locator.representation === 'inline'
			? left.locator.lineNumber - right.locator.lineNumber
			: 0)
		|| left.identity.operonId.localeCompare(right.identity.operonId);
}

function toLocator(task: {
	readonly primary: {
		readonly format: IndexedTask['primary']['format'];
		readonly filePath: string;
		readonly lineNumber: number;
	};
}): TaskSourceLocatorV1 {
	return task.primary.format === 'inline'
		? {
			representation: 'inline',
			filePath: task.primary.filePath,
			lineNumber: task.primary.lineNumber,
		}
		: {
			representation: 'file',
			filePath: task.primary.filePath,
		};
}

function cloneTask(task: IndexedTask | IndexedTaskSnapshot): IndexedTask {
	return {
		...task,
		fieldValues: { ...task.fieldValues },
		tags: [...task.tags],
		primary: { ...task.primary },
		...(task.plainCheckboxProgress ? { plainCheckboxProgress: { ...task.plainCheckboxProgress } } : {}),
	};
}

function intersectSets(sets: Set<string>[]): Set<string> {
	const ordered = [...sets].sort((left, right) => left.size - right.size);
	const first = ordered.shift() ?? new Set<string>();
	return new Set(Array.from(first).filter(value => ordered.every(set => set.has(value))));
}

function uniqueTasksByLocator(tasks: IndexedTask[]): IndexedTask[] {
	const seen = new Set<string>();
	return tasks.filter(task => {
		const locator = toLocator(task);
		const key = locator.representation === 'inline'
			? `${locator.filePath}\u0000${locator.lineNumber}`
			: locator.filePath;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function clean(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

function truncateCharacters(value: string, limit: number): string {
	return [...value].slice(0, limit).join('');
}

function normalizeName(value: string): string {
	const leaf = value.replace(/\\/gu, '/').split('/').pop() ?? value;
	return leaf.replace(/\.md$/iu, '').normalize('NFC');
}

function unwrapWikilink(value: string): string {
	const match = value.trim().match(/^!?\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]$/u);
	return (match?.[1] ?? value).trim();
}

function compactObject<T extends Record<string, string | undefined>>(value: T): {
	[K in keyof T]?: string;
} {
	return Object.fromEntries(
		Object.entries(value).filter(([, fieldValue]) => !!fieldValue?.trim()),
	) as { [K in keyof T]?: string };
}

function validDate(value: string | null | undefined): string | undefined {
	const normalized = clean(value);
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day
		? normalized
		: undefined;
}

function validLocalDateTime(value: string | null | undefined): string | undefined {
	const normalized = clean(value);
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(normalized);
	if (!match || !validDate(match[1])) return undefined;
	return Number(match[2]) <= 23
		&& Number(match[3]) <= 59
		&& (match[4] === undefined || Number(match[4]) <= 59)
		? normalized
		: undefined;
}

function appendInvalidMetadataWarnings(
	task: IndexedTask,
	dto: TaskContextV1,
	diagnostics: ContextProjectionDiagnosticsV1,
): void {
	const checks: Array<[string, string | undefined, string | undefined]> = [
		['dates.due', clean(task.fieldValues['dateDue']), dto.dates.due],
		['dates.scheduled', clean(task.fieldValues['dateScheduled']), dto.dates.scheduled],
		['dates.started', clean(task.fieldValues['dateStarted']), dto.dates.started],
		['dates.completed', clean(task.fieldValues['dateCompleted']), dto.dates.completed],
		['dates.cancelled', clean(task.fieldValues['dateCancelled']), dto.dates.cancelled],
		['datetimes.start', clean(task.fieldValues['datetimeStart']), dto.datetimes.start],
		['datetimes.end', clean(task.fieldValues['datetimeEnd']), dto.datetimes.end],
		['datetimes.created', clean(task.fieldValues['datetimeCreated']), dto.datetimes.created],
		['datetimes.modified', clean(task.fieldValues['datetimeModified']), dto.datetimes.modified],
		['recurrence.seriesId', clean(task.fieldValues['repeatSeriesId']), dto.recurrence.seriesId],
		['recurrence.occurrenceDate', clean(task.fieldValues['repeatOccurrenceDate']), dto.recurrence.occurrenceDate],
	];
	for (const [path, raw, projected] of checks) {
		if (!raw || projected) continue;
		diagnostics.warnings.push({
			code: 'invalid-task-metadata-omitted',
			message: 'A malformed task metadata value was omitted from the strict V1 DTO.',
			path: `entities.${task.operonId}.${path}`,
		});
	}
}

function boundDiagnostics(diagnostics: ContextProjectionDiagnosticsV1): void {
	const maximum = 256;
	if (diagnostics.truncations.length > maximum) {
		diagnostics.truncations = diagnostics.truncations.slice(0, maximum);
	}
	if (diagnostics.warnings.length > maximum) {
		diagnostics.warnings = [
			...diagnostics.warnings.slice(0, maximum - 1),
			{
				code: 'context-diagnostics-truncated',
				message: 'Additional bounded Context diagnostics were omitted.',
				path: 'warnings',
			},
		];
	}
}

function boundedString(
	value: string,
	limit: number,
	field: string,
	operonId: string,
	diagnostics: ContextProjectionDiagnosticsV1,
): string {
	const actualBytes = utf8ByteLengthV1(value);
	if (actualBytes <= limit) return value;
	let output = '';
	let outputBytes = 0;
	for (const character of value) {
		const characterBytes = utf8ByteLengthV1(character);
		if (outputBytes + characterBytes > limit) break;
		output += character;
		outputBytes += characterBytes;
	}
	diagnostics.truncations.push({
		path: `entities.${operonId}.${field}`,
		actualCount: actualBytes,
		returnedCount: outputBytes,
		limit,
	});
	diagnostics.warnings.push({
		code: 'context-field-truncated',
		message: 'An explicitly hydrated task field was truncated to its V1 byte limit.',
		path: `entities.${operonId}.${field}`,
	});
	return output;
}

function boundedItems<T>(
	items: T[],
	limit: number,
	field: string,
	operonId: string,
	diagnostics: ContextProjectionDiagnosticsV1,
): T[] {
	if (items.length <= limit) return items;
	diagnostics.truncations.push({
		path: `entities.${operonId}.${field}`,
		actualCount: items.length,
		returnedCount: limit,
		limit,
	});
	diagnostics.warnings.push({
		code: 'context-field-truncated',
		message: 'An explicitly hydrated task collection was truncated to its V1 item limit.',
		path: `entities.${operonId}.${field}`,
	});
	return items.slice(0, limit);
}

function boundedStringItems(
	items: string[],
	byteLimit: number,
	field: string,
	operonId: string,
	diagnostics: ContextProjectionDiagnosticsV1,
): string[] {
	const output: string[] = [];
	let bytes = 0;
	for (const item of items) {
		const nextBytes = utf8ByteLengthV1(item);
		if (bytes + nextBytes > byteLimit) break;
		output.push(item);
		bytes += nextBytes;
	}
	if (output.length === items.length) return output;
	diagnostics.truncations.push({
		path: `entities.${operonId}.${field}`,
		actualCount: utf8ByteLengthV1(items.join('\n')),
		returnedCount: bytes,
		limit: byteLimit,
	});
	return output;
}

function boundJsonRecord(
	value: Record<string, JsonValue>,
	byteLimit: number,
	operonId: string,
	diagnostics: ContextProjectionDiagnosticsV1,
): Record<string, JsonValue> {
	const output: Record<string, JsonValue> = {};
	for (const [key, item] of Object.entries(value)) {
		const candidate = { ...output, [key]: item };
		if (utf8ByteLengthV1(JSON.stringify(candidate)) > byteLimit) break;
		output[key] = item;
	}
	if (Object.keys(output).length !== Object.keys(value).length) {
		diagnostics.truncations.push({
			path: `entities.${operonId}.customFields`,
			actualCount: utf8ByteLengthV1(JSON.stringify(value)),
			returnedCount: utf8ByteLengthV1(JSON.stringify(output)),
			limit: byteLimit,
		});
	}
	return output;
}

function toCatalogValue(
	raw: string,
	valueType: CatalogProjectionV1['fields'][number]['valueType'],
): JsonValue {
	switch (valueType) {
		case 'number': {
			const parsed = Number(raw);
			return Number.isFinite(parsed) ? parsed : raw;
		}
		case 'checkbox':
			return raw.trim().toLowerCase() === 'true';
		case 'list':
			return parseListValue(raw);
		default:
			return raw;
	}
}

function normalizePlacementSearch(value: string): string {
	return value.normalize('NFC').trim().toLowerCase();
}

function placementNoteName(filePath: string): string {
	return truncateCharacters(
		(filePath.split('/').pop() ?? filePath).replace(/\.md$/iu, '').normalize('NFC'),
		CONTEXT_HYDRATION_CAPS_V1.placementNoteNameCharacters,
	);
}

function placementMetadataMatches(
	candidate: { filePath: string; noteName: string },
	query: string,
): boolean {
	if (!query) return true;
	const tokens = query.split(/\s+/u).filter(Boolean);
	const noteName = candidate.noteName.normalize('NFC').toLowerCase();
	const filePath = candidate.filePath.normalize('NFC').toLowerCase();
	return tokens.every(token => noteName.includes(token) || filePath.includes(token));
}

function comparePlacementFiles(
	left: { filePath: string; noteName: string },
	right: { filePath: string; noteName: string },
	query: string,
): number {
	const leftRank = placementFileRank(left, query);
	const rightRank = placementFileRank(right, query);
	return leftRank - rightRank
		|| comparePlacementText(left.noteName, right.noteName)
		|| comparePlacementText(left.filePath, right.filePath);
}

function placementFileRank(
	candidate: { filePath: string; noteName: string },
	query: string,
): number {
	if (!query) return 3;
	const noteName = candidate.noteName.normalize('NFC').toLowerCase();
	if (noteName === query) return 0;
	if (noteName.startsWith(query)) return 1;
	if (noteName.includes(query)) return 2;
	return 3;
}

function comparePlacementText(left: string, right: string): number {
	const normalizedLeft = left.normalize('NFC');
	const normalizedRight = right.normalize('NFC');
	return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function isExcludedPlacementPath(filePath: string, excludedFolders: readonly string[]): boolean {
	return excludedFolders.some(folder => filePath === folder || filePath.startsWith(`${folder}/`));
}

function buildPlacementLineCandidates(
	filePath: string,
	content: string,
): NonNullable<Extract<PlacementCandidatesV1, { mode: 'lines' }>['lines']> {
	const lines = content.split(/\r?\n/u);
	const bodyStart = markdownBodyStartLine(lines);
	if (bodyStart === null) return [];
	const candidates: NonNullable<Extract<PlacementCandidatesV1, { mode: 'lines' }>['lines']> = [];
	let heading: string | undefined;
	for (let lineNumber = bodyStart; lineNumber < lines.length; lineNumber += 1) {
		const line = lines[lineNumber] ?? '';
		const parsedHeading = placementHeading(line);
		if (parsedHeading) {
			heading = parsedHeading;
			continue;
		}
		if (!isBlankMarkdownBodyLine(content, lineNumber)) continue;
		const contextLabel = truncateCharacters(
			heading
				? `Under ${heading} · blank line ${lineNumber + 1}`
				: `Document body · blank line ${lineNumber + 1}`,
			CONTEXT_HYDRATION_CAPS_V1.placementContextLabelCharacters,
		);
		candidates.push({
			locator: {
				representation: 'inline',
				filePath,
				lineNumber,
			},
			...(heading ? { heading } : {}),
			contextLabel,
		});
	}
	return candidates;
}

function placementHeading(line: string): string | undefined {
	const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
	if (!match) return undefined;
	const plain = stripPlacementControlCharacters(match[1])
		.replace(/!?\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]/gu, (_whole, target: string, alias?: string) => alias ?? target)
		.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
		.replace(/<[^>]*>/gu, ' ')
		.replace(/[*_`~]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim()
		.normalize('NFC');
	return plain
		? truncateCharacters(plain, CONTEXT_HYDRATION_CAPS_V1.placementHeadingCharacters)
		: undefined;
}

function stripPlacementControlCharacters(value: string): string {
	return Array.from(value, character => {
		const codePoint = character.codePointAt(0) ?? 0;
		return (
			codePoint <= 31
			|| (codePoint >= 127 && codePoint <= 159)
			|| (codePoint >= 0x202A && codePoint <= 0x202E)
			|| (codePoint >= 0x2066 && codePoint <= 0x2069)
		)
			? ' '
			: character;
	}).join('');
}

function contextProviderError(
	code: StructuredErrorV1['code'],
	reason: string,
	retryable: boolean,
): StructuredErrorV1 {
	return structuredErrorV1(code, reason, { retryable });
}
