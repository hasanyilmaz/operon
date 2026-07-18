import { parseListValue } from '../core/parser';
import { getManagedCustomFieldMappings, normalizeManagedFieldValue } from '../core/managed-task-fields';
import { IndexedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';

export type ProjectSearchMode = 'pc' | 'pt';

export interface ProjectSearchModeQuery {
	mode: ProjectSearchMode;
	query: string;
}

export interface ProjectSearchResolvers {
	getChildIds: (parentId: string) => Iterable<string>;
	getAllDescendantIds: (parentId: string) => Iterable<string>;
}

export interface ProjectSearchCandidate {
	task: IndexedTask;
	directChildCount: number;
	descendantCount: number;
	directVisibleCount: number;
	treeVisibleCount: number;
}

export interface RankedTaskSearchResult {
	task: IndexedTask;
	score: number;
}

/**
 * Opaque, caller-owned cache lifetime for repeated task-search queries.
 *
 * Consumers should create a fresh session when the task corpus or key mappings
 * change. Keeping the state opaque prevents caches from leaking across modal
 * instances while allowing each modal to reuse matcher and score work.
 */
export interface TaskSearchSession {
	readonly kind: 'task-search-session';
}

type TaskSearchMatcher = (task: IndexedTask, normalizedQuery: string) => boolean;

interface TaskSearchSessionState {
	matcherByCorpus: Map<string, TaskSearchMatcher>;
	projectionByTask: WeakMap<IndexedTask, Map<string, TaskSearchScoreProjection>>;
	identityByReference: WeakMap<object, number>;
	nextIdentity: number;
}

const taskSearchSessionStates = new WeakMap<TaskSearchSession, TaskSearchSessionState>();

export function createTaskSearchSession(): TaskSearchSession {
	const session: TaskSearchSession = { kind: 'task-search-session' };
	taskSearchSessionStates.set(session, {
		matcherByCorpus: new Map(),
		projectionByTask: new WeakMap(),
		identityByReference: new WeakMap(),
		nextIdentity: 1,
	});
	return session;
}

export function parseProjectSearchMode(rawQuery: string): ProjectSearchModeQuery | null {
	const match = rawQuery.match(/^\s*(pc|pt):\s*(.*)$/iu);
	if (!match) return null;
	return {
		mode: match[1].toLocaleLowerCase() as ProjectSearchMode,
		query: match[2].trim().toLocaleLowerCase(),
	};
}

export function buildTaskSearchMatcher(
	tasks: IndexedTask[],
	keyMappings: readonly KeyMapping[] = [],
): (task: IndexedTask, normalizedQuery: string) => boolean {
	const taskLookup = new Map(tasks.map(task => [task.operonId, task] as const));
	const customSearchMappings = getManagedCustomFieldMappings(keyMappings);
	const childrenByParent = new Map<string, string[]>();
	for (const task of tasks) {
		const parentId = (task.fieldValues['parentTask'] ?? '').trim();
		if (!parentId) continue;
		if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
		childrenByParent.get(parentId)!.push(task.operonId);
	}
	const descendantNameCache = new Map<string, string[]>();
	const ancestorIdCache = new Map<string, string[]>();
	const searchDocumentCache = new Map<string, readonly string[]>();
	let lastNormalizedQuery = '';
	let lastQueryTerms: readonly string[] = [];

	const getTaskNameById = (operonId: string): string => {
		const match = taskLookup.get(operonId);
		return match?.description?.trim() ?? '';
	};

	const collectDescendantNames = (operonId: string, lineage = new Set<string>()): string[] => {
		if (descendantNameCache.has(operonId)) {
			return descendantNameCache.get(operonId)!;
		}
		if (lineage.has(operonId)) return [];
		lineage.add(operonId);
		const childIds = childrenByParent.get(operonId) ?? [];
		const names: string[] = [];
		for (const childId of childIds) {
			const childName = getTaskNameById(childId);
			if (childName) names.push(childName);
			for (const descendantName of collectDescendantNames(childId, lineage)) {
				if (descendantName) names.push(descendantName);
			}
		}
		lineage.delete(operonId);
		const deduped = Array.from(new Set(names));
		descendantNameCache.set(operonId, deduped);
		return deduped;
	};

	const collectAncestorIds = (task: IndexedTask, lineage = new Set<string>()): string[] => {
		const cached = ancestorIdCache.get(task.operonId);
		if (cached) return cached;
		if (lineage.has(task.operonId)) return [];
		lineage.add(task.operonId);
		const parentId = (task.fieldValues['parentTask'] ?? '').trim();
		if (!parentId) {
			lineage.delete(task.operonId);
			ancestorIdCache.set(task.operonId, []);
			return [];
		}
		const parentTask = taskLookup.get(parentId);
		const ancestorIds = parentTask
			? [parentId, ...collectAncestorIds(parentTask, lineage)]
			: [parentId];
		lineage.delete(task.operonId);
		const deduped = Array.from(new Set(ancestorIds.filter(Boolean)));
		ancestorIdCache.set(task.operonId, deduped);
		return deduped;
	};

	const buildSearchDocument = (task: IndexedTask): readonly string[] => {
		const cached = searchDocumentCache.get(task.operonId);
		if (cached !== undefined) return cached;

		const values = new Set<string>();
		const addValue = (value: string | null | undefined): void => {
			const normalized = (value ?? '').trim();
			if (normalized) values.add(normalized.toLocaleLowerCase());
		};
		const addValues = (entries: Iterable<string>): void => {
			for (const entry of entries) addValue(entry);
		};

		addValue(task.description);
		addValue(task.operonId);
		addValues(collectAncestorIds(task));
		addValue(task.fieldValues['note']);
		addValues(getSearchableSwimlaneValues(task));
		addValues(getSearchableDateValues(task));
		addValues(getSearchableCustomFieldValues(task, customSearchMappings));

		const parentId = (task.fieldValues['parentTask'] ?? '').trim();
		if (parentId) {
			const parentName = getTaskNameById(parentId).toLocaleLowerCase().trim();
			if (parentName) values.add(parentName);
		}

		for (const descendantName of collectDescendantNames(task.operonId)) {
			const normalized = descendantName.toLocaleLowerCase().trim();
			if (normalized) values.add(normalized);
		}

		for (const relationKey of ['blocking', 'blockedBy'] as const) {
			for (const relatedId of parseListValue(task.fieldValues[relationKey] ?? '')) {
				const relatedName = getTaskNameById(relatedId).toLocaleLowerCase().trim();
				if (relatedName) values.add(relatedName);
			}
		}

		const tokens = tokenizeTaskSearchText(Array.from(values).join('\n'));
		searchDocumentCache.set(task.operonId, tokens);
		return tokens;
	};

	return (task: IndexedTask, normalizedQuery: string): boolean => {
		if (normalizedQuery !== lastNormalizedQuery) {
			lastNormalizedQuery = normalizedQuery;
			lastQueryTerms = tokenizeTaskSearchText(normalizedQuery);
		}
		if (lastQueryTerms.length === 0) return true;
		const documentTokens = buildSearchDocument(task);
		return lastQueryTerms.every(term => matchesSearchTermTokens(documentTokens, term));
	};
}

export function rankTaskSearchResults(options: {
	tasks: IndexedTask[];
	query: string;
	includeAllTasks: boolean;
	limit?: number;
	keyMappings?: readonly KeyMapping[];
	session?: TaskSearchSession;
}): RankedTaskSearchResult[] {
	const normalizedQuery = options.query.trim().toLocaleLowerCase();
	const limit = options.limit;
	const keyMappings = options.keyMappings ?? [];
	const keyMappingsSignature = options.session ? buildKeyMappingsSignature(keyMappings) : '';
	const matcher = getTaskSearchMatcher(options.tasks, keyMappings, keyMappingsSignature, options.session);
	const scopedTasks = options.tasks.filter(task => options.includeAllTasks || task.checkbox === 'open');
	const matches = scopedTasks
		.filter(task => !normalizedQuery || matcher(task, normalizedQuery))
		.map(task => ({
			task,
			score: normalizedQuery
				? getTaskSearchScore(task, normalizedQuery, keyMappings, keyMappingsSignature, options.session)
				: 0,
		}));

	matches.sort((left, right) => compareRankedTaskSearchResults(left, right, normalizedQuery));

	return typeof limit === 'number' ? matches.slice(0, limit) : matches;
}

export function buildProjectSearchCandidates(
	scopedTasks: IndexedTask[],
	normalizedQuery: string,
	resolvers: ProjectSearchResolvers,
	options: {
		match?: 'description' | 'taskSearch';
		sort?: 'description' | 'taskFinderRank';
		visibleTaskIds?: Set<string>;
		visibilityMode?: ProjectSearchMode;
		candidateFilter?: (task: IndexedTask) => boolean;
		keyMappings?: readonly KeyMapping[];
		session?: TaskSearchSession;
	} = {},
): ProjectSearchCandidate[] {
	const scopedTaskIds = new Set(scopedTasks.map(task => task.operonId));
	const visibleTaskIds = options.visibleTaskIds ?? scopedTaskIds;
	const keyMappings = options.keyMappings ?? [];
	const keyMappingsSignature = options.session ? buildKeyMappingsSignature(keyMappings) : '';
	const matcher = options.match === 'taskSearch'
		? getTaskSearchMatcher(scopedTasks, keyMappings, keyMappingsSignature, options.session)
		: null;
	const candidates: ProjectSearchCandidate[] = [];
	for (const task of scopedTasks) {
		if (options.candidateFilter && !options.candidateFilter(task)) {
			continue;
		}
		const directChildIds = Array.from(resolvers.getChildIds(task.operonId))
			.filter(childId => scopedTaskIds.has(childId));
		const descendantIds = Array.from(resolvers.getAllDescendantIds(task.operonId))
			.filter(descendantId => scopedTaskIds.has(descendantId));
		const descendantCount = descendantIds.length;
		const directVisibleCount = (visibleTaskIds.has(task.operonId) ? 1 : 0)
			+ directChildIds.filter(childId => visibleTaskIds.has(childId)).length;
		const visibleDescendantCount = descendantIds.filter(descendantId => visibleTaskIds.has(descendantId)).length;
		const treeVisibleCount = (visibleTaskIds.has(task.operonId) ? 1 : 0)
			+ visibleDescendantCount;
		const hasVisibleTreeDescendant = !!options.visibleTaskIds
			&& options.visibilityMode === 'pt'
			&& visibleDescendantCount > 0;
		if (directChildIds.length === 0 && !hasVisibleTreeDescendant) continue;
		if (normalizedQuery && matcher && !matcher(task, normalizedQuery)) {
			continue;
		}
		if (normalizedQuery && !matcher && !matchesTaskSearchQueryText(task.description.toLocaleLowerCase(), normalizedQuery)) {
			continue;
		}
		if (options.visibleTaskIds) {
			const visibleCount = options.visibilityMode === 'pt' ? treeVisibleCount : directVisibleCount;
			if (visibleCount === 0) continue;
		}
		candidates.push({
			task,
			directChildCount: directChildIds.length,
			descendantCount,
			directVisibleCount,
			treeVisibleCount,
		});
	}
	return candidates.sort((left, right) => {
		if (options.sort === 'taskFinderRank') {
			return compareRankedTaskSearchResults(
				{
					task: left.task,
					score: normalizedQuery
						? getTaskSearchScore(left.task, normalizedQuery, keyMappings, keyMappingsSignature, options.session)
						: 0,
				},
				{
					task: right.task,
					score: normalizedQuery
						? getTaskSearchScore(right.task, normalizedQuery, keyMappings, keyMappingsSignature, options.session)
						: 0,
				},
				normalizedQuery,
			);
		}
		return left.task.description.localeCompare(right.task.description, undefined, { sensitivity: 'base' });
	});
}

function getTaskSearchMatcher(
	tasks: IndexedTask[],
	keyMappings: readonly KeyMapping[],
	keyMappingsSignature: string,
	session: TaskSearchSession | undefined,
): TaskSearchMatcher {
	const state = session ? taskSearchSessionStates.get(session) : undefined;
	if (!state) return buildTaskSearchMatcher(tasks, keyMappings);

	const corpusKey = `${buildReferenceSequenceKey(tasks, state)}|${keyMappingsSignature}`;
	const cached = state.matcherByCorpus.get(corpusKey);
	if (cached) return cached;

	const matcher = buildTaskSearchMatcher(tasks, keyMappings);
	state.matcherByCorpus.set(corpusKey, matcher);
	return matcher;
}

function getTaskSearchScore(
	task: IndexedTask,
	normalizedQuery: string,
	keyMappings: readonly KeyMapping[],
	keyMappingsSignature: string,
	session: TaskSearchSession | undefined,
): number {
	const state = session ? taskSearchSessionStates.get(session) : undefined;
	if (!state) return scoreTaskSearchResult(task, normalizedQuery, keyMappings);

	const mappingKey = keyMappingsSignature;
	let projections = state.projectionByTask.get(task);
	if (!projections) {
		projections = new Map();
		state.projectionByTask.set(task, projections);
	}
	let projection = projections.get(mappingKey);
	if (!projection) {
		projection = buildTaskSearchScoreProjection(task, keyMappings);
		projections.set(mappingKey, projection);
	}
	return scoreTaskSearchProjection(projection, normalizedQuery);
}

function buildReferenceSequenceKey(
	references: readonly object[],
	state: TaskSearchSessionState,
): string {
	const identities: number[] = [];
	for (const reference of references) {
		let identity = state.identityByReference.get(reference);
		if (identity === undefined) {
			identity = state.nextIdentity++;
			state.identityByReference.set(reference, identity);
		}
		identities.push(identity);
	}
	return `${identities.length}:${identities.join(',')}`;
}

function buildKeyMappingsSignature(keyMappings: readonly KeyMapping[]): string {
	return JSON.stringify(keyMappings);
}

export function resolveProjectSearchVisibleTaskIds(
	selectedParentId: string,
	mode: ProjectSearchMode,
	scopedTasks: IndexedTask[],
	resolvers: ProjectSearchResolvers,
): Set<string> {
	const scopedTaskIds = new Set(scopedTasks.map(task => task.operonId));
	const visibleIds = new Set<string>();
	if (scopedTaskIds.has(selectedParentId)) {
		visibleIds.add(selectedParentId);
	}
	for (const childId of resolvers.getChildIds(selectedParentId)) {
		if (scopedTaskIds.has(childId)) visibleIds.add(childId);
	}
	if (mode === 'pt') {
		for (const descendantId of resolvers.getAllDescendantIds(selectedParentId)) {
			if (scopedTaskIds.has(descendantId)) visibleIds.add(descendantId);
		}
	}
	return visibleIds;
}

export function matchesTaskSearchQueryText(text: string, normalizedQuery: string): boolean {
	const terms = tokenizeTaskSearchText(normalizedQuery);
	if (terms.length === 0) return true;
	const textTokens = tokenizeTaskSearchText(text);
	return terms.every(term => matchesSearchTermTokens(textTokens, term));
}

export function tokenizeTaskSearchText(value: string): string[] {
	return value
		.toLocaleLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.map(token => token.trim())
		.filter(Boolean);
}

function matchesSearchTermTokens(tokens: readonly string[], term: string): boolean {
	if (/^\d+$/.test(term)) {
		return tokens.includes(term);
	}
	return tokens.some(token => token.startsWith(term));
}

function scoreTaskSearchResult(
	task: IndexedTask,
	normalizedQuery: string,
	keyMappings: readonly KeyMapping[] = [],
): number {
	return scoreTaskSearchProjection(buildTaskSearchScoreProjection(task, keyMappings), normalizedQuery);
}

interface TaskSearchScoreProjection {
	desc: string;
	id: string;
	filePath: string;
	status: string;
	priority: string;
	note: string;
	customValues: readonly string[];
	checkboxRank: number;
}

function buildTaskSearchScoreProjection(
	task: IndexedTask,
	keyMappings: readonly KeyMapping[],
): TaskSearchScoreProjection {
	return {
		desc: task.description.toLocaleLowerCase(),
		id: task.operonId.toLocaleLowerCase(),
		filePath: task.primary.filePath.toLocaleLowerCase(),
		status: (task.fieldValues['status'] ?? '').toLocaleLowerCase(),
		priority: (task.fieldValues['priority'] ?? '').toLocaleLowerCase(),
		note: (task.fieldValues['note'] ?? '').toLocaleLowerCase(),
		customValues: getSearchableCustomFieldValues(task, getManagedCustomFieldMappings(keyMappings))
			.map(value => value.toLocaleLowerCase()),
		checkboxRank: getCheckboxRank(task.checkbox),
	};
}

function scoreTaskSearchProjection(
	projection: TaskSearchScoreProjection,
	normalizedQuery: string,
): number {
	const { desc, id, filePath, status, priority, note, customValues } = projection;
	const tokens = tokenizeTaskSearchText(normalizedQuery);
	let score = 0;

	if (id === normalizedQuery) score += 1200;
	if (desc === normalizedQuery) score += 1000;
	if (id.startsWith(normalizedQuery)) score += 800;
	if (desc.startsWith(normalizedQuery)) score += 700;
	if (desc.includes(` ${normalizedQuery}`)) score += 520;
	if (desc.includes(normalizedQuery)) score += 360;
	if (id.includes(normalizedQuery)) score += 260;
	if (status.includes(normalizedQuery)) score += 180;
	if (priority.includes(normalizedQuery)) score += 150;
	if (filePath.includes(normalizedQuery)) score += 90;
	if (note.includes(normalizedQuery)) score += 70;
	if (customValues.some(value => value.includes(normalizedQuery))) score += 65;

	for (const token of tokens) {
		if (token.length < 2) continue;
		if (desc.startsWith(token)) score += 80;
		if (desc.includes(token)) score += 60;
		if (id.includes(token)) score += 40;
		if (status.includes(token)) score += 30;
		if (priority.includes(token)) score += 25;
		if (customValues.some(value => value.includes(token))) score += 20;
	}

	score += Math.max(0, 30 - projection.checkboxRank * 10);
	return score;
}

function compareRankedTaskSearchResults(
	left: RankedTaskSearchResult,
	right: RankedTaskSearchResult,
	normalizedQuery: string,
): number {
	if (normalizedQuery && left.score !== right.score) return right.score - left.score;
	const checkboxRank = getCheckboxRank(left.task.checkbox) - getCheckboxRank(right.task.checkbox);
	if (checkboxRank !== 0) return checkboxRank;
	const modifiedDiff = getModifiedTime(right.task) - getModifiedTime(left.task);
	if (modifiedDiff !== 0) return modifiedDiff;
	return left.task.description.localeCompare(right.task.description, undefined, { sensitivity: 'base' })
		|| left.task.operonId.localeCompare(right.task.operonId, undefined, { sensitivity: 'base' });
}

function getSearchableSwimlaneValues(task: IndexedTask): string[] {
	const values = new Set<string>();
	const addValue = (value: string | null | undefined): void => {
		const normalized = (value ?? '').trim();
		if (normalized) values.add(normalized);
	};
	addValue(task.fieldValues['priority']);
	for (const tag of task.tags) addValue(tag);
	for (const value of parseListValue(task.fieldValues['contexts'] ?? '')) addValue(value);
	for (const value of parseListValue(task.fieldValues['assignees'] ?? '')) addValue(value);
	addValue(task.fieldValues['dateDue']);
	addValue(task.fieldValues['dateScheduled']);
	return Array.from(values);
}

function getSearchableDateValues(task: IndexedTask): string[] {
	const values = new Set<string>();
	for (const fieldKey of ['dateDue', 'dateScheduled', 'dateStarted', 'dateCompleted', 'dateCancelled'] as const) {
		const value = (task.fieldValues[fieldKey] ?? '').trim();
		if (value) values.add(value);
	}
	return Array.from(values);
}

function getSearchableCustomFieldValues(
	task: IndexedTask,
	customMappings: readonly KeyMapping[],
): string[] {
	const values = new Set<string>();
	const addValue = (value: string | null | undefined): void => {
		const normalized = (value ?? '').trim();
		if (normalized) values.add(normalized);
	};
	for (const mapping of customMappings) {
		const rawValue = normalizeManagedFieldValue((task.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
		if (!rawValue) continue;
		if (mapping.type === 'list') {
			for (const item of parseListValue(rawValue)) addValue(item);
			continue;
		}
		addValue(rawValue);
	}
	return Array.from(values);
}

function getCheckboxRank(checkbox: string): number {
	if (checkbox === 'open') return 0;
	if (checkbox === 'done') return 1;
	if (checkbox === 'cancelled') return 2;
	return 3;
}

function getModifiedTime(task: IndexedTask): number {
	return Date.parse(task.datetimeModified || task.fieldValues['datetimeModified'] || '') || 0;
}
