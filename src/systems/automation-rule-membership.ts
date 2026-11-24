import { readActionLiteral } from '../core/automation-action-fields';
import type { AutomationChangePlan, AutoTriggers } from '../core/automation-change-plan';
import type { AutomationRule } from '../core/automation-rules';
import { prepareLocalAutomationCondition } from '../core/filter-evaluator';
import { isLosslessInlineTag } from '../core/parser';
import type { IndexReconciliationEvent } from '../indexer/indexer';
import type { IndexedTask } from '../types/fields';
import type { FilterFieldType, FilterNode, KeyMapping } from '../types/settings';
import { MAX_BOTTOM_UP_AGGREGATE_DEPTH } from './aggregate-coordinator';

interface Ports {
	settle(): Promise<unknown>;
	children(id: string): Iterable<string>;
	all(): Iterable<IndexedTask>;
	task(id: string): IndexedTask | undefined;
	unavailable(id: string): boolean;
	unavailableIds(): Iterable<string>;
	generation(): number;
	verified(): boolean;
}

interface Condition {
	field: string;
	fieldType: FilterFieldType;
	test(task: IndexedTask): boolean;
	hits: Set<string>;
}

interface RuleSnapshot {
	scope: ReadonlySet<string>;
	target: ReadonlySet<string>;
	pending: ReadonlySet<string>;
}

type Test = (id: string) => boolean;
interface Membership {
	version: string;
	conditions: Set<Condition>;
	scope: Test;
	target: Test;
	include: Set<string>;
	exclude: Set<string>;
	inlineSafe: boolean;
	scoped: Set<string>;
	targeted: Set<string>;
	pending: Set<string>;
}

function compileNode(node: FilterNode, pool: Map<string, Condition>, used: Set<Condition>): Test | undefined {
	if ('children' in node) {
		const tests: Test[] = [];
		for (const child of node.children) {
			const test = compileNode(child, pool, used);
			if (!test) return undefined;
			tests.push(test);
		}
		if (!tests.length) return () => true;
		if (node.logic === 'all') return id => tests.every(test => test(id));
		if (node.logic === 'any') return id => tests.some(test => test(id));
		return id => !tests.some(test => test(id));
	}
	const key = JSON.stringify([node.field, node.fieldType, node.operator, node.value ?? '']);
	let condition = pool.get(key);
	if (!condition) {
		const test = prepareLocalAutomationCondition(node);
		if (!test) return undefined;
		condition = { field: node.field, fieldType: node.fieldType, test, hits: new Set() };
		pool.set(key, condition);
	}
	used.add(condition);
	const { hits } = condition;
	return id => hits.has(id);
}

function membershipVersion(rule: AutomationRule): string {
	return JSON.stringify([rule.scope, rule.target, rule.actions]);
}

function compile(rule: AutomationRule, version: string, pool: Map<string, Condition>): Membership | undefined {
	if (!rule.actions.length || rule.actions.some(action => action.field !== 'tags')) return undefined;
	const include = new Set<string>(), exclude = new Set<string>();
	for (const action of rule.actions) {
		try {
			const members = readActionLiteral(action, { type: 'tags', native: false });
			if (!Array.isArray(members)) return undefined;
			for (const member of members) (action.operation === 'add' ? include : exclude).add(String(member));
		} catch { return undefined; }
	}
	const conditions = new Set<Condition>();
	const scope = compileNode(rule.scope, pool, conditions);
	const target = compileNode(rule.target, pool, conditions);
	if (!scope || !target) return undefined;
	return { version, conditions, scope, target, include, exclude, inlineSafe: [...include, ...exclude].every(isLosslessInlineTag),
		scoped: new Set(), targeted: new Set(), pending: new Set() };
}

function setMember(ids: Set<string>, id: string, present: boolean): void {
	if (present) ids.add(id);
	else ids.delete(id);
}

function updateRule(rule: Membership, task: IndexedTask): void {
	const id = task.operonId;
	const scope = rule.scope(id), target = scope && rule.target(id);
	setMember(rule.scoped, id, scope);
	setMember(rule.targeted, id, target);
	let pending = false;
	if (target) {
		for (const tag of rule.include) if (!task.tags.includes(tag)) { pending = true; break; }
		if (!pending) for (const tag of rule.exclude) if (task.tags.includes(tag)) { pending = true; break; }
	}
	setMember(rule.pending, id, pending);
}

function intersects<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
	const [small, large] = left.size <= right.size ? [left, right] : [right, left];
	for (const item of small) if (large.has(item)) return true;
	return false;
}

/** Settled membership can prove an empty Auto run. The planner owns all changes and confirmation. */
export class AutomationRuleMembership {
	private pool = new Map<string, Condition>();
	private rules = new Map<string, Membership>();
	private readonly conditionTypes = new Map<string, FilterFieldType>();
	private generation = -1;
	private waitingForIndex = false;
	private paddedParents = new Map<string, string>();
	private opposing: [string, string][] = [];

	constructor(private readonly ports: Ports) {}

	configure(saved: readonly AutomationRule[]): void {
		const next = new Map<string, Membership>(), added: Membership[] = [];
		const used = new Set<Condition>();
		const pool = new Map(this.pool);
		for (const rule of saved) {
			if (!rule.active || rule.mode !== 'auto') continue;
			const version = membershipVersion(rule);
			let state = this.rules.get(rule.id);
			if (state?.version !== version) {
				state = compile(rule, version, pool);
				if (state) added.push(state);
			}
			if (!state) continue;
			next.set(rule.id, state);
			for (const condition of state.conditions) used.add(condition);
		}
		const fresh: Condition[] = [];
		for (const [key, condition] of pool) {
			if (!used.has(condition)) pool.delete(key);
			else if (!this.pool.has(key)) fresh.push(condition);
		}
		if (added.length || next.size !== this.rules.size) {
			this.opposing = [];
			const active = [...next];
			for (const [i, [id, rule]] of active.entries()) {
				for (let j = i; j < active.length; j++) {
					const [otherId, other] = active[j];
					if (intersects(rule.include, other.exclude) || intersects(rule.exclude, other.include)) this.opposing.push([id, otherId]);
				}
			}
		}
		this.conditionTypes.clear();
		for (const condition of used) this.conditionTypes.set(condition.field, condition.fieldType);
		this.pool = pool;
		this.rules = next;
		if (!next.size) { this.generation = -1; this.paddedParents.clear(); return; }
		if (this.generation !== this.ports.generation() || (added.length && !this.ports.verified())) this.requestBaseline();
		else if (added.length) this.seed(fresh, added);
	}

	// A batch can temporarily remove a task before publishing its final delta.
	// Never seed a new membership from that intermediate graph.
	private requestBaseline(): void {
		this.generation = -1;
		if (this.ports.verified()) { this.rebuild(); return; }
		if (this.waitingForIndex) return;
		this.waitingForIndex = true;
		void this.ports.settle().then(() => {
			this.waitingForIndex = false;
			if (this.rules.size && this.generation < 0 && this.ports.verified()) this.rebuild();
		});
	}

	private seed(conditions: Iterable<Condition>, rules: Iterable<Membership>): void {
		for (const task of this.ports.all()) {
			this.trackParent(task.operonId, task);
			for (const condition of conditions) setMember(condition.hits, task.operonId, condition.test(task));
			for (const rule of rules) updateRule(rule, task);
		}
	}

	private rebuild(): void {
		this.generation = -1;
		this.paddedParents.clear();
		for (const condition of this.pool.values()) condition.hits.clear();
		for (const rule of this.rules.values()) { rule.scoped.clear(); rule.targeted.clear(); rule.pending.clear(); }
		this.seed([...this.pool.values()], [...this.rules.values()]);
		this.generation = this.ports.generation();
	}

	reconcile(event: IndexReconciliationEvent): void {
		if (!this.rules.size) return;
		if (event.kind === 'full' || this.generation + 1 !== event.generation) { this.requestBaseline(); return; }
		this.generation = -1;
		const remaining = new Set(event.affectedOperonIds);
		for (const { before, after } of event.changes ?? []) {
			const id = after?.operonId ?? before?.operonId;
			if (!id) continue;
			remaining.delete(id);
			this.update(id, before, after);
		}
		// Aggregate patches and duplicate-ID transitions may only publish identities.
		for (const id of remaining) this.update(id, null, this.ports.task(id) ?? null);
		this.generation = event.generation;
	}

	// The secondary index uses raw parent IDs, while aggregate projection trims them.
	private trackParent(id: string, task: IndexedTask | null): void {
		const raw = task?.fieldValues.parentTask;
		if (raw && raw !== raw.trim()) this.paddedParents.set(id, raw.trim());
		else this.paddedParents.delete(id);
	}

	private update(id: string, before: IndexedTask | null, after: IndexedTask | null): void {
		if (!before || !after || before.fieldValues.parentTask !== after.fieldValues.parentTask) this.trackParent(id, after);
		if (!after) {
			for (const leaf of this.pool.values()) leaf.hits.delete(id);
			for (const rule of this.rules.values()) { rule.scoped.delete(id); rule.targeted.delete(id); rule.pending.delete(id); }
			return;
		}
		const fields = new Set<string>();
		if (!before || before.primary.filePath !== after.primary.filePath) fields.add('folders');
		if (!before || before.description !== after.description) fields.add('description');
		if (!before || before.fieldValues.priority !== after.fieldValues.priority
			|| ('priority' in before.fieldValues) !== ('priority' in after.fieldValues)) fields.add('priority');
		if (!before || before.tags.length !== after.tags.length || before.tags.some((tag, i) => tag !== after.tags[i])) fields.add('tags');
		if (!fields.size) return;
		const flipped = new Set<Condition>();
		for (const leaf of this.pool.values()) {
			if (!fields.has(leaf.field)) continue;
			const result = leaf.test(after);
			if (result === leaf.hits.has(id)) continue;
			setMember(leaf.hits, id, result);
			flipped.add(leaf);
		}
		for (const rule of this.rules.values()) {
			if (!before || intersects(flipped, rule.conditions) || (fields.has('tags') && rule.targeted.has(id))) updateRule(rule, after);
		}
	}

	/** A trigger admits a whole rule. Work may be pending on a different target in its scope. */
	planIfNoChanges(rules: readonly AutomationRule[], triggers: AutoTriggers, mappings: readonly KeyMapping[]): AutomationChangePlan | null {
		if (!this.ports.verified() || this.generation < 0 || this.generation !== this.ports.generation()) return null;
		// Imported or edited mappings can override a built-in condition's catalog type.
		for (const mapping of mappings) {
			const expected = this.conditionTypes.get(mapping.canonicalKey);
			if (expected && mapping.type !== expected) return null;
		}
		const counts: AutomationChangePlan['rules'] = [];
		const targets: ReadonlySet<string>[] = [];
		for (const rule of rules) {
			const state = this.rules.get(rule.id);
			if (!rule.active || rule.mode !== 'auto' || !state || state.version !== membershipVersion(rule)) return null;
			const trigger = triggers.get(rule.id);
			if (trigger !== 'all' && (!trigger || !intersects(trigger, state.scoped))) continue;
			if (state.pending.size || (state.targeted.size && !state.inlineSafe)) return null;
			counts.push({ ruleId: rule.id, scope: state.scoped.size, target: state.targeted.size, changed: 0, directTaskIds: [] });
			if (state.targeted.size) targets.push(state.targeted);
		}
		// Source transitions can begin without a generation change. Check just the exceptional IDs.
		if (targets.length) {
			for (const id of this.ports.unavailableIds()) {
				if (targets.some(set => set.has(id))) return null;
			}
		}
		return { rules: counts, changes: [], issues: [], changedTaskCount: 0, affectedTaskCount: 0, needsConfirmation: false };
	}

	/** A missing result requires the full planner. Read only against a settled, current index. */
	read(participating: readonly string[]): ReadonlyMap<string, RuleSnapshot> | null {
		if (!this.ports.verified()) return null;
		if (this.generation < 0 && this.rules.size) this.rebuild();
		if (this.generation !== this.ports.generation()) return null;
		const selected = new Map<string, RuleSnapshot>();
		const roots = new Set<string>();
		for (const id of participating) {
			const rule = this.rules.get(id);
			if (!rule) return null;
			for (const target of rule.targeted) {
				const task = this.ports.task(target);
				if (!task || this.ports.unavailable(target) || (!rule.inlineSafe && task.primary.format === 'inline')) return null;
			}
			for (const pending of rule.pending) {
				let current = pending;
				let parent = this.ports.task(current)?.fieldValues.parentTask;
				let depth = 0;
				while (parent) {
					if (++depth >= MAX_BOTTOM_UP_AGGREGATE_DEPTH || !this.ports.task(parent) || this.ports.unavailable(parent)) return null;
					current = parent;
					parent = this.ports.task(current)?.fieldValues.parentTask;
				}
				roots.add(current);
			}
			selected.set(id, { scope: rule.scoped, target: rule.targeted, pending: rule.pending });
		}
		for (const [left, right] of this.opposing) {
			const a = selected.get(left), b = selected.get(right);
			if (a && b && intersects(a.target, b.target)) return null;
		}
		// The planner projects aggregates over each affected subtree, including siblings.
		const ambiguousParents = new Set(this.paddedParents.values());
		const validTree = (id: string, depth: number): boolean => {
			if (depth >= MAX_BOTTOM_UP_AGGREGATE_DEPTH || ambiguousParents.has(id)) return false;
			for (const child of this.ports.children(id)) {
				if (!this.ports.task(child) || this.ports.unavailable(child) || !validTree(child, depth + 1)) return false;
			}
			return true;
		};
		for (const root of roots) if (!validTree(root, 0)) return null;
		return selected;
	}
}
