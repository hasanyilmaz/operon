import type { IndexedTask } from '../types/fields';
import type { FilterGroup, FilterNode, FilterSetCondition } from '../types/settings';
import { parseTrackerRange } from '../systems/tracker-utils';
import { parseLocalTimestamp, toLocalDate } from './local-time';

export const TRACKED_ON_FIELD = 'trackedOn';
export type TrackedOnTruth = 'true' | 'false' | 'unknown';

/** Indices refer to the original history, never the filtered display order. */
export interface ScopedTrackerSession {
	readonly operonId: string;
	readonly sessionIndex: number;
	readonly rawIndex: number;
	readonly start: string;
	readonly end: string;
	readonly durationSeconds: number;
}

export interface TrackedOnTaskTime {
	readonly matched?: boolean;
	readonly sessions: readonly ScopedTrackerSession[];
	readonly durationSeconds: number;
	/** Null means a malformed descendant history prevents a trustworthy aggregate. */
	readonly totalDurationSeconds: number | null;
	readonly hasChildren: boolean;
	readonly resolveTask: (task: IndexedTask) => TrackedOnTaskTime;
	readonly projectTask: (task: IndexedTask) => TrackedOnTaskTime;
}

export interface TrackedOnTaskEvaluation {
	readonly truth: TrackedOnTruth;
	readonly time: TrackedOnTaskTime;
}

type DatePredicate = (date: string) => boolean;
interface TimeScope {
	readonly conditions: readonly FilterSetCondition[];
	readonly predicates: readonly DatePredicate[];
	readonly valid: boolean;
	readonly empty: boolean;
}
interface ParsedHistory {
	readonly sessions: readonly ScopedTrackerSession[];
	readonly valid: boolean;
}
interface BranchResult {
	truth: TrackedOnTruth;
	scopes: TimeScope[];
}

export function usesTrackedOn(node: FilterNode): boolean {
	return isGroup(node) ? node.children.some(usesTrackedOn) : node.field === TRACKED_ON_FIELD;
}

function isGroup(node: FilterNode): node is FilterGroup {
	return 'children' in node;
}

function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const timestamp = parseLocalTimestamp(value);
	return timestamp !== null && Number.isFinite(timestamp) && toLocalDate(new Date(timestamp)) === value;
}

/** Validate before calling the legacy date evaluator, whose unknown-op fallback is permissive. */
export function isValidTrackedOnCondition(condition: FilterSetCondition, dateOperators: readonly string[]): boolean {
	if (condition.fieldType !== 'date') return false;
	const { operator, value = '', values = [] } = condition;
	if (operator === 'between') return values.length === 2 && values.every(validDate) && values[0] <= values[1];
	if (operator === 'inLastDays') return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
	if (!dateOperators.includes(operator)) return false;
	if (['dateIs', 'before', 'after'].includes(operator)) return validDate(value);
	if (['exactlyDaysAgo', 'exactlyDaysAway', 'underDaysAgo', 'underDaysAway', 'overDaysAgo', 'overDaysAway'].includes(operator)) {
		return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value));
	}
	if (operator === 'dayOfWeekIs' || operator === 'dayOfWeekNot') return /^[0-6]$/u.test(value);
	if (operator === 'monthIs' || operator === 'monthNot') return /^(?:[1-9]|1[0-2])$/u.test(value);
	return true;
}

/**
 * One evaluation snapshot. Owns parsed histories and results, never canonical tasks.
 * Positive All/Any branches are enumerated lazily so constraints are collected
 * before duration comparisons. None stays an opaque task-level exclusion.
 */
export class TrackedOnFilterEvaluation {
	private readonly history = new Map<IndexedTask, ParsedHistory>();
	private readonly results = new Map<IndexedTask, TrackedOnTaskEvaluation>();
	private readonly children = new Map<string, IndexedTask[]>();
	private readonly conditions = new Map<FilterSetCondition, DatePredicate | null>();
	private readonly descendants = new Map<string, readonly IndexedTask[]>();

	constructor(
		private readonly root: FilterGroup,
		tasks: readonly IndexedTask[],
		private readonly today: string,
		private readonly dateOperators: readonly string[],
		private readonly evaluateDate: (operator: string, date: string, value: string, today: string) => boolean,
		private readonly evaluateOrdinary: (node: FilterNode, task: IndexedTask) => TrackedOnTruth,
	) {
		for (const task of new Map(tasks.map(task => [task.operonId, task])).values()) {
			const parent = (task.fieldValues['parentTask'] ?? '').trim();
			if (!parent) continue;
			const children = this.children.get(parent) ?? [];
			children.push(task);
			this.children.set(parent, children);
		}
	}

	evaluate(task: IndexedTask): TrackedOnTaskEvaluation {
		const cached = this.results.get(task);
		if (cached) return cached;
		const result = this.evaluateNode(this.root, task, []);
		const time = Object.freeze({ ...this.project(task, result.truth === 'true' ? result.scopes : []), matched: result.truth === 'true' });
		const evaluated = Object.freeze({ truth: result.truth, time });
		this.results.set(task, evaluated);
		return evaluated;
	}

	private readHistory(task: IndexedTask): ParsedHistory {
		const cached = this.history.get(task);
		if (cached) return cached;
		const raw = task.fieldValues['trackers'] ?? '';
		const sessions: ScopedTrackerSession[] = [];
		let valid = true;
		let sessionIndex = 0;
		if (raw.trim()) for (const [rawIndex, item] of raw.split(';').entries()) {
			const parsed = parseTrackerRange(item);
			if (!parsed || item.trim().split('/').length !== 2 || parsed.durationSeconds <= 0) valid = false;
			if (!parsed) continue;
			if (parsed.durationSeconds > 0) sessions.push(Object.freeze({
				operonId: task.operonId, sessionIndex, rawIndex,
				start: parsed.start, end: parsed.end, durationSeconds: parsed.durationSeconds,
			}));
			sessionIndex++;
		}
		const result = { sessions: Object.freeze(sessions), valid };
		this.history.set(task, result);
		return result;
	}

	private predicate(condition: FilterSetCondition): DatePredicate | null {
		if (this.conditions.has(condition)) return this.conditions.get(condition) ?? null;
		let predicate: DatePredicate | null = null;
		if (validDate(this.today) && isValidTrackedOnCondition(condition, this.dateOperators)) {
			const { operator, value = '', values = [] } = condition;
			if (operator === 'between') predicate = date => date >= values[0] && date <= values[1];
			else if (operator === 'hasAnyValue' || operator === 'hasNoValue') predicate = () => true;
			else if (operator === 'inLastDays') {
				const start = new Date(parseLocalTimestamp(this.today) ?? NaN);
				start.setDate(start.getDate() - Number(value) + 1);
				if (Number.isFinite(start.getTime())) {
					const startDate = toLocalDate(start);
					predicate = date => date >= startDate && date <= this.today;
				}
			} else if (operator === 'lastMonth' || operator === 'nextMonth') {
				const month = new Date(parseLocalTimestamp(this.today) ?? NaN);
				month.setDate(1);
				month.setMonth(month.getMonth() + (operator === 'lastMonth' ? -1 : 1));
				const prefix = toLocalDate(month).slice(0, 7);
				predicate = date => date.slice(0, 7) === prefix;
			} else predicate = date => this.evaluateDate(operator, date, value, this.today);
		}
		this.conditions.set(condition, predicate);
		return predicate;
	}

	private scope(conditions: readonly FilterSetCondition[]): TimeScope {
		const predicates = conditions.map(condition => this.predicate(condition));
		return {
			conditions,
			predicates: predicates.filter((predicate): predicate is DatePredicate => predicate !== null),
			valid: predicates.every(predicate => predicate !== null),
			empty: conditions.some(condition => condition.operator === 'hasNoValue'),
		};
	}

	private selected(task: IndexedTask, scopes: readonly TimeScope[]): readonly ScopedTrackerSession[] {
		const history = this.readHistory(task);
		if (!history.valid) return [];
		return history.sessions.filter(session => scopes.some(scope =>
			scope.valid && !scope.empty && scope.predicates.every(predicate => predicate(session.start.slice(0, 10))),
		));
	}

	private subtree(task: IndexedTask): readonly IndexedTask[] {
		const cached = this.descendants.get(task.operonId);
		if (cached) return cached;
		const seen = new Set([task.operonId]);
		const result = [task];
		for (let index = 0; index < result.length; index++) {
			for (const child of this.children.get(result[index].operonId) ?? []) {
				if (seen.has(child.operonId)) continue;
				seen.add(child.operonId);
				result.push(child);
			}
		}
		this.descendants.set(task.operonId, result);
		return result;
	}

	private project(task: IndexedTask, scopes: readonly TimeScope[]): TrackedOnTaskTime {
		const sessions = Object.freeze([...this.selected(task, scopes)]);
		const durationSeconds = sessions.reduce((sum, session) => sum + session.durationSeconds, 0);
		const subtree = this.subtree(task);
		let totalDurationSeconds = durationSeconds;
		for (const child of subtree.slice(1)) {
			totalDurationSeconds += this.selected(child, scopes).reduce((sum, session) => sum + session.durationSeconds, 0);
		}
		return Object.freeze({ sessions, durationSeconds,
			totalDurationSeconds: scopes.length > 0 && subtree.some(member => !this.readHistory(member).valid) ? null : totalDurationSeconds,
			hasChildren: subtree.length > 1,
			resolveTask: (member: IndexedTask) => this.evaluate(member).time,
			projectTask: (child: IndexedTask) => this.project(child, scopes),
		});
	}

	private *branches(node: FilterNode, task: IndexedTask): Generator<readonly FilterNode[]> {
		if (!isGroup(node) || node.logic === 'none' || !usesTrackedOn(node)) {
			yield [node];
		} else if (node.logic === 'any' && node.children.length > 0) {
			const seen = new Set<string>();
			for (const child of node.children) for (const branch of this.branches(child, task)) {
				const key = this.branchKey(branch, task);
				if (!seen.has(key)) { seen.add(key); yield branch; }
			}
		} else {
			yield* this.conjunctions(node.children, task);
		}
	}

	/** Compress equivalent record selections before multiplying sibling alternatives.
	 * Descendant selections are included: equal own durations alone are insufficient.
	 * Non-date clauses stay in the key so branch-specific comparisons retain their meaning.
	 */
	private branchKey(nodes: readonly FilterNode[], task: IndexedTask): string {
		const dates = nodes.filter((node): node is FilterSetCondition => !isGroup(node) && node.field === TRACKED_ON_FIELD);
		const ordinary = nodes.filter(node => isGroup(node) || node.field !== TRACKED_ON_FIELD);
		const clauses = [...new Set(ordinary.map(node => JSON.stringify(node, (key, value: unknown) => key === 'id' ? undefined : value)))].sort();
		if (!dates.length) return JSON.stringify([clauses, 'no-scope']);
		const scope = this.scope(dates);
		return JSON.stringify([clauses, scope.valid, scope.empty,
			dates.every(date => date.operator === 'hasNoValue'),
			this.subtree(task).map(member => [member.operonId, this.selected(member, [scope]).map(session => session.rawIndex)]),
		]);
	}

	private *conjunctions(nodes: readonly FilterNode[], task: IndexedTask): Generator<readonly FilterNode[]> {
		let prefixes: readonly FilterNode[][] = [[]];
		for (const node of nodes) {
			const next = new Map<string, FilterNode[]>();
			for (const branch of this.branches(node, task)) for (const prefix of prefixes) {
				const combined = [...prefix, ...branch];
				next.set(this.branchKey(combined, task), combined);
			}
			prefixes = [...next.values()];
		}
		yield* prefixes;
	}

	private evaluateNode(node: FilterNode, task: IndexedTask, inherited: readonly FilterSetCondition[]): BranchResult {
		let truth: TrackedOnTruth = 'false';
		const scopes: TimeScope[] = [];
		for (const branch of this.branches(node, task)) {
			const result = this.evaluateBranch(branch, task, inherited);
			if (result.truth === 'true') {
				truth = 'true';
				scopes.push(...result.scopes);
			} else if (result.truth === 'unknown' && truth !== 'true') truth = 'unknown';
		}
		return { truth, scopes };
	}

	private ordinary(node: FilterNode, task: IndexedTask, invalidTotal: boolean): TrackedOnTruth {
		if (!isGroup(node)) return invalidTotal && node.field === 'totalDuration' ? 'unknown' : this.evaluateOrdinary(node, task);
		if (node.children.length === 0) return 'true';
		let unknown = false;
		for (const child of node.children) {
			const truth = this.ordinary(child, task, invalidTotal);
			if (node.logic === 'all' && truth === 'false') return 'false';
			if (node.logic === 'any' && truth === 'true') return 'true';
			if (node.logic === 'none' && truth === 'true') return 'false';
			if (truth === 'unknown') unknown = true;
		}
		return unknown ? 'unknown' : node.logic === 'any' ? 'false' : 'true';
	}

	private evaluateBranch(nodes: readonly FilterNode[], task: IndexedTask, inherited: readonly FilterSetCondition[]): BranchResult {
		const dates = [...inherited, ...nodes.filter((node): node is FilterSetCondition => !isGroup(node) && node.field === TRACKED_ON_FIELD)];
		const scope = this.scope(dates);
		const touchesTime = dates.length > 0 || nodes.some(usesTrackedOn);
		const history = this.readHistory(task);
		let truth: TrackedOnTruth = 'true';
		if (dates.length > 0) {
			if (!scope.valid || !history.valid) truth = 'unknown';
			else if (scope.empty) {
				truth = history.sessions.length === 0 && dates.every(date => date.operator === 'hasNoValue') ? 'true' : 'false';
			} else if (this.selected(task, [scope]).length === 0) truth = 'false';
		}
		// No positive time branch must not restore all-time values through Any.
		const time = this.project(task, touchesTime ? [scope] : []);
		const projected = {
			...task,
			fieldValues: { ...task.fieldValues, duration: String(time.durationSeconds), totalDuration: time.hasChildren && time.totalDurationSeconds !== null ? String(time.totalDurationSeconds) : '' },
		};
		for (const node of nodes) {
			if (!isGroup(node) && node.field === TRACKED_ON_FIELD) continue;
			let value: TrackedOnTruth;
			if (isGroup(node) && node.logic === 'none' && usesTrackedOn(node)) {
				value = 'true';
				for (const child of node.children) {
					const excluded = usesTrackedOn(child)
						? this.evaluateNode(child, task, dates).truth
						: this.ordinary(child, projected, time.totalDurationSeconds === null);
					if (excluded === 'true') { value = 'false'; break; }
					if (excluded === 'unknown') value = 'unknown';
				}
			} else value = this.ordinary(node, projected, time.totalDurationSeconds === null);
			if (value === 'false') return { truth: 'false', scopes: [] };
			if (value === 'unknown' && truth !== 'false') truth = 'unknown';
		}
		return { truth, scopes: truth === 'true' && touchesTime ? [scope] : [] };
	}
}
