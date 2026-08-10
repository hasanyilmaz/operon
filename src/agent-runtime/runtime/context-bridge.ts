import type { IndexedTask } from '../../types/fields';
import {
	CONTEXT_HYDRATION_CAPS_V1,
	resolveProjectionBoundsV1,
	type ContextPackV1,
	type ContextRequestV1,
	type ContextSummaryV1,
	type EntityResolutionResultV1,
	type EntityResolveRequestV1,
	type RelationshipEdgeV1,
	type RelationshipRequestV1,
	type RelationshipResultV1,
	type RelationshipSetV1,
	type TaskContextV1,
	type TaskFinderRequestV1,
	type TaskFinderResultV1,
	type TaskFinderRowV1,
	type TaskGetRequestV1,
	type TaskGetResultV1,
	type TaskQueryFiltersV1,
	type TaskQueryRequestV1,
	type TaskQueryResultV1,
} from '../contracts/v1/context';
import type {
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
} from '../extensions/task-workflows-v1';
import type {
	ContextRevisionV1,
	ResourceRevisionV1,
} from '../contracts/v1/identity';
import {
	CONTRACT_VERSION_V1,
	structuredErrorV1,
	type ContractWarningV1,
	type FreshnessV1,
	type StructuredErrorV1,
	utf8ByteLengthV1,
} from '../contracts/v1/primitives';
import type { CatalogProjectionV1 } from './catalog-builder';
import { RuntimeContextCursorCodecV1 } from './context-cursor';
import {
	LiveIndexContextProviderV1,
} from './context-provider';

export interface ContextBridgeExecutionV1 {
	revision: ContextRevisionV1;
	freshness: FreshnessV1;
}

export type SavedFilterEvaluationV1 =
	| { ok: true; tasks: IndexedTask[]; queryDigest: string }
	| { ok: false; error: StructuredErrorV1 };

/**
 * Internal, transport-neutral bridge from the verified Runtime read coordinator
 * to bounded Context Engine DTOs. It owns no mutable domain state.
 */
export class ContextBridgeV1 {
	constructor(
		private readonly provider: LiveIndexContextProviderV1,
		private readonly getCatalog: () => CatalogProjectionV1,
		private readonly cursors: RuntimeContextCursorCodecV1,
		private readonly evaluateSavedFilter?: (request: TaskFilterQueryRequestV1) => SavedFilterEvaluationV1,
	) {}

	async resolveEntity(
		request: EntityResolveRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<EntityResolutionResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return entityFailure(request, execution, authorityError);
		const projection = await this.provider.resolve(request.selector, request.limit);
		if (projection.error) return entityFailure(request, execution, projection.error);
		const response: EntityResolutionResultV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'entity-resolution-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			resolution: projection.resolution,
			candidates: projection.candidates,
			...(projection.selected ? { selected: projection.selected } : {}),
			warnings: [],
		};
		return this.guardResultBytes(
			response,
			() => entityFailure(request, execution, resultTooLarge()),
		);
	}

	async getTask(
		request: TaskGetRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<TaskGetResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return taskGetFailure(request, execution, authorityError);
		const resolution = await this.provider.resolve(request.selector, 2);
		if (resolution.resolution !== 'resolved' || !resolution.task) {
			return taskGetFailure(
				request,
				execution,
				resolution.resolution === 'ambiguous'
					? error('ambiguous-selector', 'The task selector does not resolve to one unique task.', false)
					: error('entity-not-found', 'No task matches the selector.', false),
			);
		}
		const hydrated = await this.provider.hydrateTasks({
			tasks: [resolution.task],
			include: request.include,
			contextRevision: execution.revision,
		});
		if (hydrated.error) return taskGetFailure(request, execution, hydrated.error, hydrated.warnings);
		return freezeDto({
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'task-get-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			task: hydrated.tasks[0],
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: hydrated.warnings,
		});
	}

	async queryTasks(
		request: TaskQueryRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<TaskQueryResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return taskQueryFailure(request, execution, authorityError);
		if (requestsWritableFields(request.include)) {
			return taskQueryFailure(
				request,
				execution,
				error('invalid-request', 'writable-fields hydration is available only through exact task.get.', false),
			);
		}
		const filters = request.filters ?? {};
		let offset = 0;
		let asOf = new Date().toISOString();
		if (request.cursor) {
			const decoded = await this.cursors.decode({
				cursor: request.cursor,
				revision: execution.revision,
				filters,
			});
			if (!decoded.ok) return taskQueryFailure(request, execution, decoded.error);
			offset = decoded.value.offset;
			asOf = decoded.value.asOf;
		}
		const limit = Math.max(1, Math.min(request.limit ?? 25, 250));
		const projection = this.provider.query(filters, limit, asOf, offset);
		const pageTasks = projection.tasks;
		const hydrated = await this.provider.hydrateTasks({
			tasks: pageTasks,
			include: request.include,
			contextRevision: execution.revision,
		});
		if (hydrated.error) return taskQueryFailure(request, execution, hydrated.error, hydrated.warnings);
		const nextOffset = offset + pageTasks.length;
		const nextCursor = nextOffset < projection.actualCount
			? await this.cursors.encode({
				revision: execution.revision,
				filters,
				asOf,
				offset: nextOffset,
			})
			: undefined;
		const response: TaskQueryResultV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			tasks: hydrated.tasks,
			page: {
				actualCount: projection.actualCount,
				returnedCount: hydrated.tasks.length,
				truncated: nextCursor !== undefined,
				...(nextCursor ? { nextCursor } : {}),
				asOf,
			},
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: hydrated.warnings,
		};
		return this.guardResultBytes(
			response,
			() => taskQueryFailure(request, execution, resultTooLarge()),
		);
	}

	async filterQueryTasks(
		request: TaskFilterQueryRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<TaskFilterQueryResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return taskFilterQueryFailure(request, execution, authorityError);
		if (requestsWritableFields(request.include)) {
			return taskFilterQueryFailure(request, execution, error(
				'invalid-request',
				'writable-fields hydration is available only through exact task.get.',
				false,
			));
		}
		if (!this.evaluateSavedFilter) {
			return taskFilterQueryFailure(
				request,
				execution,
				error('capability-unavailable', 'Saved-filter evaluation is not available.', false),
			);
		}
		const evaluated = this.evaluateSavedFilter(request);
		if (!evaluated.ok) return taskFilterQueryFailure(request, execution, evaluated.error);
		let offset = 0;
		let asOf = new Date().toISOString();
		if (request.cursor) {
			const decoded = await this.cursors.decodeFilterQuery({
				cursor: request.cursor,
				revision: execution.revision,
				queryDigest: evaluated.queryDigest,
			});
			if (!decoded.ok) return taskFilterQueryFailure(request, execution, decoded.error);
			offset = decoded.value.offset;
			asOf = decoded.value.asOf;
		}
		const unique = [...new Map(evaluated.tasks.map(task => [task.operonId, task])).values()];
		const limit = Math.max(1, Math.min(request.limit ?? 25, 250));
		const pageTasks = unique.slice(offset, offset + limit);
		const hydrated = await this.provider.hydrateTasks({
			tasks: pageTasks,
			include: request.include,
			contextRevision: execution.revision,
		});
		if (hydrated.error) return taskFilterQueryFailure(request, execution, hydrated.error, hydrated.warnings);
		const nextOffset = offset + pageTasks.length;
		const nextCursor = nextOffset < unique.length
			? await this.cursors.encodeFilterQuery({
				revision: execution.revision,
				queryDigest: evaluated.queryDigest,
				asOf,
				offset: nextOffset,
			})
			: undefined;
		const response: TaskFilterQueryResultV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'task-filter-query-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			tasks: hydrated.tasks,
			page: {
				actualCount: unique.length,
				returnedCount: hydrated.tasks.length,
				truncated: nextCursor !== undefined,
				...(nextCursor ? { nextCursor } : {}),
				asOf,
			},
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: hydrated.warnings,
		};
		return this.guardResultBytes(response, () => taskFilterQueryFailure(request, execution, resultTooLarge()));
	}

	async findTasks(
		request: TaskFinderRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<TaskFinderResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return taskFinderFailure(request, execution, authorityError);
		if (request.project?.rootOperonId) {
			const root = await this.provider.resolve({
				kind: 'operon-id',
				operonId: request.project.rootOperonId,
			}, 2);
			if (root.resolution !== 'resolved' || !root.task) {
				return taskFinderFailure(
					request,
					execution,
					root.resolution === 'ambiguous'
						? error('ambiguous-selector', 'The Task Finder project root is ambiguous.', false)
						: error('entity-not-found', 'The Task Finder project root does not exist.', false),
				);
			}
		}
		let offset = 0;
		let asOf = new Date().toISOString();
		if (request.cursor) {
			const decoded = await this.cursors.decodeFinder({
				cursor: request.cursor,
				revision: execution.revision,
				request,
			});
			if (!decoded.ok) return taskFinderFailure(request, execution, decoded.error);
			offset = decoded.value.offset;
			asOf = decoded.value.asOf;
		}
		const limit = Math.max(1, Math.min(request.limit ?? 10, 250));
		const projection = this.provider.queryFinder(request, limit, asOf, offset);
		const hydrated = await this.provider.hydrateTasks({
			tasks: projection.rows.map(row => row.task),
			contextRevision: execution.revision,
		});
		if (hydrated.error) return taskFinderFailure(request, execution, hydrated.error, hydrated.warnings);
		const taskById = new Map(hydrated.tasks.map(task => [task.identity.operonId, task] as const));
		const rows: TaskFinderRowV1[] = [];
		for (const row of projection.rows) {
			const task = taskById.get(row.task.operonId);
			if (!task) continue;
			if (row.kind === 'project') {
				rows.push({
					kind: 'project' as const,
					task,
					score: row.score,
					directTaskCount: row.directTaskCount,
					treeTaskCount: row.treeTaskCount,
					visibleDirectTaskCount: row.visibleDirectTaskCount,
					visibleTreeTaskCount: row.visibleTreeTaskCount,
				});
			} else {
				rows.push({ kind: 'task', task, score: row.score });
			}
		}
		const nextOffset = offset + projection.rows.length;
		const nextCursor = nextOffset < projection.actualCount
			? await this.cursors.encodeFinder({
				revision: execution.revision,
				request,
				asOf,
				offset: nextOffset,
			})
			: undefined;
		const response: TaskFinderResultV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'task-finder-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			rows,
			page: {
				actualCount: projection.actualCount,
				returnedCount: rows.length,
				truncated: nextCursor !== undefined,
				...(nextCursor ? { nextCursor } : {}),
				asOf,
			},
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: hydrated.warnings,
		};
		return this.guardResultBytes(
			response,
			() => taskFinderFailure(request, execution, resultTooLarge()),
		);
	}

	async getRelationships(
		request: RelationshipRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<RelationshipResultV1> {
		const authorityError = this.authorityError();
		if (authorityError) return relationshipFailure(request, execution, authorityError);
		const resolution = await this.provider.resolve(request.selector, 2);
		if (resolution.resolution !== 'resolved' || !resolution.task) {
			return relationshipFailure(
				request,
				execution,
				resolution.resolution === 'ambiguous'
					? error('ambiguous-selector', 'The relationship root is ambiguous.', false)
					: error('entity-not-found', 'The relationship root does not exist.', false),
			);
		}
		const relationships = this.provider.buildRelationships(resolution.task, {
			kinds: request.kinds,
			depth: request.depth,
			limit: request.limit,
			includeProjectMembers: request.kinds === undefined || request.kinds.includes('project-member'),
		});
		const ids = unique([
			resolution.task.operonId,
			...relationshipTargetIds(relationships),
		]).slice(0, Math.max(1, Math.min(request.limit ?? 100, 500)));
		const hydrated = await this.provider.hydrateTasks({
			tasks: this.provider.getTasksByIds(ids),
			contextRevision: execution.revision,
			relationships,
		});
		if (hydrated.error) return relationshipFailure(request, execution, hydrated.error, hydrated.warnings);
		const response: RelationshipResultV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'relationship-result',
			ok: true,
			freshness: execution.freshness,
			contextRevision: execution.revision,
			relationships,
			tasks: hydrated.tasks,
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: hydrated.warnings,
		};
		return this.guardResultBytes(
			response,
			() => relationshipFailure(request, execution, resultTooLarge()),
		);
	}

	async buildContext(
		request: ContextRequestV1,
		execution: ContextBridgeExecutionV1,
	): Promise<ContextPackV1> {
		const authorityError = this.authorityError();
		if (authorityError) return contextFailure(request, execution, authorityError);
		if (requestsWritableFields(request.include)) {
			return contextFailure(
				request,
				execution,
				error('invalid-request', 'writable-fields hydration is available only through exact task.get.', false),
			);
		}
		const bounds = resolveProjectionBoundsV1(request.projection, request.limit, request.depth);
		const catalog = this.getCatalog();
		if (request.projection === 'placement-candidates') {
			if (!request.placement) {
				return contextFailure(
					request,
					execution,
					error('invalid-request', 'Placement candidates require an explicit files or lines request.', false),
				);
			}
			const projected = await this.provider.getPlacementCandidates(
				request.placement,
				bounds.limit,
			);
			if (!projected.ok) return contextFailure(request, execution, projected.error);
			const placement = projected.value;
			const truncations = placement.truncated
				? [{
					path: placement.mode === 'files' ? 'placement.files' : 'placement.lines',
					actualCount: placement.actualCount,
					returnedCount: placement.returnedCount,
					limit: bounds.limit,
				}]
				: [];
			const provenance = [{
				path: 'placement',
				source: 'live-runtime' as const,
				...(placement.mode === 'lines'
					? { revision: placement.sourceRevision.contentDigest }
					: {}),
				derived: placement.mode === 'files',
			}];
			const response: ContextPackV1 = {
				contractVersion: CONTRACT_VERSION_V1,
				requestId: request.requestId,
				kind: 'context-pack',
				ok: true,
				purpose: request.purpose,
				projection: request.projection,
				execution: execution.freshness,
				contextRevision: execution.revision,
				catalogRevision: catalog.catalogRevision,
				entities: [],
				relationships: emptyRelationships(),
				placement,
				summary: summarize([], emptyRelationships()),
				provenance,
				truncations,
				warnings: [],
			};
			return this.guardResultBytes(
				response,
				() => contextFailure(request, execution, resultTooLarge()),
			);
		}
		let tasks: IndexedTask[] = [];
		let relationships = emptyRelationships();
		let query: Extract<ContextPackV1, { ok: true }>['query'] | undefined;
		let asOf: string | undefined;

		if (request.projection === 'planning-workload') {
			const filters: TaskQueryFiltersV1 = {
				checkbox: ['open'],
				tiers: ['hot'],
				...(request.filters ?? {}),
			};
			let offset = 0;
			asOf = new Date().toISOString();
			if (request.cursor) {
				const decoded = await this.cursors.decode({
					cursor: request.cursor,
					revision: execution.revision,
					filters,
				});
				if (!decoded.ok) return contextFailure(request, execution, decoded.error);
				offset = decoded.value.offset;
				asOf = decoded.value.asOf;
			}
			const projection = this.provider.query(filters, bounds.limit, asOf, offset);
			tasks = projection.tasks;
			const nextOffset = offset + tasks.length;
			const nextCursor = nextOffset < projection.actualCount
				? await this.cursors.encode({
					revision: execution.revision,
					filters,
					asOf,
					offset: nextOffset,
				})
				: undefined;
			query = {
				actualCount: projection.actualCount,
				returnedCount: tasks.length,
				truncated: !!nextCursor,
				...(nextCursor ? { nextCursor } : {}),
				asOf,
			};
		} else if (request.operonIds) {
			const exact = this.provider.getExactTasksByIds(request.operonIds);
			if (!exact.ok) return contextFailure(request, execution, exact.error);
			if (
				exact.tasks.some(task => task.primary.format !== 'inline')
				|| new Set(exact.tasks.map(task => task.primary.filePath)).size !== 1
			) {
				return contextFailure(
					request,
					execution,
					error(
						'invalid-request',
						'Batch mutation readiness requires exact inline tasks from one Markdown source.',
						false,
					),
				);
			}
			tasks = exact.tasks;
		} else if (request.selector) {
			const resolved = await this.provider.resolve(request.selector, 2);
			if (resolved.resolution !== 'resolved' || !resolved.task) {
				return contextFailure(
					request,
					execution,
					resolved.resolution === 'ambiguous'
						? error('ambiguous-selector', 'The context root is ambiguous.', false)
						: error('entity-not-found', 'The context root does not exist.', false),
				);
			}
			if (request.projection === 'exact-task') {
				tasks = [resolved.task];
			} else if (request.projection === 'project-analysis') {
				({ tasks, relationships } = this.buildProjectProjection(resolved.task, bounds.limit, bounds.depth ?? 6));
			} else {
				relationships = this.provider.buildRelationships(resolved.task, {
					depth: bounds.depth ?? 1,
					limit: bounds.limit,
				});
				const ids = unique([resolved.task.operonId, ...relationshipTargetIds(relationships)]).slice(0, bounds.limit);
				tasks = this.provider.getTasksByIds(ids);
			}
		} else if (request.projection !== 'creation-context') {
			return contextFailure(
				request,
				execution,
				error('invalid-request', 'This projection requires a task selector.', false),
			);
		}

		const include = (
			request.projection === 'mutation-preview'
			&& request.mutationKind === 'task.update'
			&& (request.limit === 1 || request.operonIds !== undefined)
		)
			? [...(request.include ?? []), 'writable-fields' as const]
			: request.include;
		const hydrated = await this.provider.hydrateTasks({
			tasks,
			include,
			contextRevision: execution.revision,
			relationships,
		});
		if (hydrated.error) return contextFailure(request, execution, hydrated.error, hydrated.warnings);
		if (
			request.operonIds
			&& (
				hydrated.tasks.length !== request.operonIds.length
				|| hydrated.tasks.some((task, index) => task.identity.operonId !== request.operonIds?.[index])
				|| new Set(hydrated.tasks.map(task => task.sourceRevision.contentDigest)).size !== 1
			)
		) {
			return contextFailure(
				request,
				execution,
				error('stale-source', 'Batch mutation readiness did not resolve one coherent exact source revision.', true),
				hydrated.warnings,
			);
		}
		const resourceRevisions = request.projection === 'mutation-preview'
			? buildResourceRevisions(hydrated.tasks, execution.revision)
			: undefined;
		const includeCatalog = request.projection === 'creation-context'
			|| request.projection === 'mutation-preview';
		const response: ContextPackV1 = {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: request.requestId,
			kind: 'context-pack',
			ok: true,
			purpose: request.purpose,
			projection: request.projection,
			execution: execution.freshness,
			contextRevision: execution.revision,
			catalogRevision: catalog.catalogRevision,
			...(asOf ? { asOf } : {}),
			entities: hydrated.tasks,
			relationships,
			...(includeCatalog ? {
				catalog: {
					taxonomy: catalog.taxonomy,
					fields: catalog.fields,
				},
				policies: catalog.policies,
			} : {}),
			...(resourceRevisions ? { resourceRevisions } : {}),
			summary: summarize(hydrated.tasks, relationships),
			...(query ? { query } : {}),
			provenance: hydrated.provenance,
			truncations: hydrated.truncations,
			warnings: [...catalog.warnings, ...hydrated.warnings],
		};
		return this.guardResultBytes(
			response,
			() => contextFailure(request, execution, resultTooLarge()),
		);
	}

	private buildProjectProjection(
		root: IndexedTask,
		limit: number,
		depth: number,
	): { tasks: IndexedTask[]; relationships: RelationshipSetV1 } {
		const ids: string[] = [root.operonId];
		const derived: RelationshipEdgeV1[] = [];
		const visited = new Set(ids);
		let ancestorId = String(root.fieldValues['parentTask'] ?? '').trim();
		for (let level = 1; level <= depth && ancestorId && ids.length < limit; level++) {
			if (visited.has(ancestorId)) break;
			const ancestor = this.provider.getTaskById(ancestorId);
			if (!ancestor) break;
			visited.add(ancestorId);
			ids.push(ancestorId);
			derived.push({
				kind: 'ancestor',
				sourceOperonId: root.operonId,
				targetOperonId: ancestorId,
				provenanceClass: 'derived',
				reason: `parent chain depth ${level}`,
			});
			ancestorId = String(ancestor.fieldValues['parentTask'] ?? '').trim();
		}
		let frontier = [root.operonId];
		for (let level = 1; level <= depth && frontier.length > 0 && ids.length < limit; level++) {
			const next: string[] = [];
			for (const parentId of [...frontier].sort()) {
				for (const childId of [...this.provider.getChildIds(parentId)].sort()) {
					if (visited.has(childId)) continue;
					visited.add(childId);
					ids.push(childId);
					next.push(childId);
					derived.push({
						kind: 'project-member',
						sourceOperonId: root.operonId,
						targetOperonId: childId,
						provenanceClass: 'derived',
						reason: `bounded project hierarchy depth ${level}`,
					});
					if (ids.length >= limit) break;
				}
				if (ids.length >= limit) break;
			}
			frontier = next;
		}
		return {
			tasks: this.provider.getTasksByIds(ids),
			relationships: { explicit: [], derived, inferred: [] },
		};
	}

	private authorityError(): StructuredErrorV1 | null {
		const authority = this.provider.getReadAuthority();
		return authority.verified
			? null
			: error('live-settling', 'The live RAM index is not a verified read authority yet.', true);
	}

	private guardResultBytes<T>(
		value: T,
		onTooLarge: () => T,
	): T {
		try {
			return utf8ByteLengthV1(JSON.stringify(value)) <= CONTEXT_HYDRATION_CAPS_V1.resultBytes
				? freezeDto(value)
				: freezeDto(onTooLarge());
		} catch {
			return freezeDto(onTooLarge());
		}
	}
}

function requestsWritableFields(include: readonly string[] | undefined): boolean {
	return include?.includes('writable-fields') ?? false;
}

function emptyRelationships(): RelationshipSetV1 {
	return { explicit: [], derived: [], inferred: [] };
}

function relationshipTargetIds(value: RelationshipSetV1): string[] {
	return [...value.explicit, ...value.derived, ...value.inferred]
		.flatMap(edgeValue => [edgeValue.sourceOperonId, edgeValue.targetOperonId]);
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function summarize(tasks: TaskContextV1[], relationships: RelationshipSetV1): ContextSummaryV1 {
	return {
		entityCount: tasks.length,
		relationshipCount: relationships.explicit.length + relationships.derived.length + relationships.inferred.length,
		openCount: tasks.filter(task => task.checkbox === 'open').length,
		doneCount: tasks.filter(task => task.checkbox === 'done').length,
		cancelledCount: tasks.filter(task => task.checkbox === 'cancelled').length,
	};
}

function buildResourceRevisions(
	tasks: TaskContextV1[],
	contextRevision: ContextRevisionV1,
): ResourceRevisionV1[] {
	const resources: ResourceRevisionV1[] = [];
	for (const task of tasks) {
		resources.push({
			resourceKind: 'task-source',
			resourceKey: task.identity.operonId,
			revision: task.sourceRevision.contentDigest,
		});
	}
	if (tasks.length > 0) {
		resources.push(
			{ resourceKind: 'active-tracker', resourceKey: 'global', revision: String(contextRevision.activeTrackerGeneration) },
			{ resourceKind: 'pinned', resourceKey: 'global', revision: String(contextRevision.pinnedGeneration) },
			{ resourceKind: 'repeat-series', resourceKey: 'global', revision: String(contextRevision.repeatSeriesRevision) },
			{ resourceKind: 'project-serial', resourceKey: 'global', revision: contextRevision.projectSerialSignature },
		);
	}
	return resources.sort((left, right) => (
		left.resourceKind.localeCompare(right.resourceKind)
		|| left.resourceKey.localeCompare(right.resourceKey)
	));
}

function entityFailure(
	request: EntityResolveRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): EntityResolutionResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'entity-resolution-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function taskGetFailure(
	request: TaskGetRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): TaskGetResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'task-get-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function taskQueryFailure(
	request: TaskQueryRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): TaskQueryResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'task-query-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function taskFilterQueryFailure(
	request: TaskFilterQueryRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): TaskFilterQueryResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'task-filter-query-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function taskFinderFailure(
	request: TaskFinderRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): TaskFinderResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'task-finder-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function relationshipFailure(
	request: RelationshipRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): RelationshipResultV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'relationship-result',
		ok: false,
		freshness: execution.freshness,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function contextFailure(
	request: ContextRequestV1,
	execution: ContextBridgeExecutionV1,
	failure: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): ContextPackV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		requestId: request.requestId,
		kind: 'context-pack',
		ok: false,
		purpose: request.purpose,
		projection: request.projection,
		contextRevision: execution.revision,
		error: failure,
		warnings,
	});
}

function resultTooLarge(): StructuredErrorV1 {
	return error('result-too-large', 'The bounded Context Engine result exceeds the V1 transport ceiling.', false);
}

function error(
	code: StructuredErrorV1['code'],
	reason: string,
	retryable: boolean,
): StructuredErrorV1 {
	return structuredErrorV1(code, reason, { retryable });
}

function freezeDto<T>(value: T): T {
	const clone = structuredClone(value);
	deepFreeze(clone);
	return clone;
}

function deepFreeze(value: unknown): void {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}
