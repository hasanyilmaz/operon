import { canonicalizeLocalDatetime } from './local-time';
import type { IndexedTask } from '../types/fields';
import type { FilterGroup, FilterFieldType, FilterSetCondition, OperonSettings } from '../types/settings';
import { resolveAutomationWorkflowStatus, resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus, shouldTriggerOneShotAutomation } from '../types/pipeline';
import { createAutomationProjectSerialValidator, type AutomationAction, type AutomationConfirmation, type AutomationRule } from './automation-rules';
import { getOperatorsForField, prepareFilterGroupMatcher, type FilterEvaluationOptions } from './filter-evaluator';
import { parseDependencyIdList, getDependencyEdgeForField, validateDependencyEdgeSet,
	resolveActiveBlockers, resolveDependencyStatusChangeAttempt, isScheduledDependencyPlanningTransition } from './dependency-graph';
import { parseRepeatRule, serializeRepeatRule } from './repeat-rule';
import { applyFieldRules } from './field-rules';
import { getOppositeDependencyFieldKey, normalizeTaskFieldPatch } from './task-field-patch';
import { resolveParentLinkInheritance, projectParentLinkListSource } from './subtask-inheritance';
import { isLosslessInlineTag, parseListValue } from './parser';
import { getManagedTaskFieldType } from './managed-task-fields';
import { sanitizeTaskFilename } from './filename-rule';
import { shouldAutoUnpinTerminalTask } from './pinned-task-rules';
import { readAutomationField, readActionLiteral, type ActionIssue, type AutomationFieldSource, type PlanValue, type Member } from './automation-action-fields';
import type { TableFilePropertyQueryContext } from '../ui/table/table-file-property';

export interface AutomationPlanSnapshot {
	includePreviewTaskIds?: boolean;
	tasks: IndexedTask[];
	ready: boolean;
	conditionFields: ReadonlyMap<string, FilterFieldType>;
	asOf: string;
	actionReferenceDay?: string;
	settings: OperonSettings;
	pins: ReadonlySet<string> | null;
	unavailableIds: ReadonlySet<string>;
	getDuplicateInstances(): Iterable<Pick<IndexedTask, 'operonId' | 'fieldValues'>>;
	activeTimerId: string | null | undefined;
	native?: TableFilePropertyQueryContext;
	getInlineList: AutomationFieldSource['getInlineList'];
	getFrontmatter: AutomationFieldSource['getFrontmatter'];
	fileRenameState(task: IndexedTask, destination: string): 'available' | 'occupied' | 'unknown';
	getRepeatSkipDates: NonNullable<FilterEvaluationOptions['getRepeatSkipDates']>;
	projectAggregates(tasks: ReadonlyMap<string, IndexedTask>, ids: ReadonlySet<string>): Map<string, Record<string, string>>;
}

interface Origin {
	taskId: string;
	ruleId: string;
	actionId: string;
}
export interface AutomationPlanIssue {
	reason: ActionIssue | 'index-unavailable' | 'condition-unavailable' | 'conflict' | 'blocked'
		| 'invalid-relation' | 'dependent-effect-unavailable';
	taskId?: string;
	field?: string;
	ruleId?: string;
	conditionId?: string;
	projectSerialGroupId?: string;
	origins?: Origin[];
}
export interface AutomationFieldChange {
	taskId: string;
	field: string;
	before: PlanValue;
	after: PlanValue;
	origins: Origin[];
	indirect: boolean;
}
interface Intent {
	taskId: string;
	field: string;
	before: PlanValue;
	value: PlanValue;
	op: 'set' | 'clear-if' | 'include' | 'exclude';
	origin: Origin;
	indirect: boolean;
}
interface IntentBatch {
	intents: Intent[];
	origin: Origin;
}
export type AutomationPreviewTaskIds = Record<'scope' | 'target' | 'changed', readonly string[] | null>;

interface RuleCount {
	matches?: { scope: string[]; target: string[] };
	ruleId: string;
	scope: number;
	target: number;
	changed: number;
}
export interface AutomationChangePlan {
	rules: Array<{ ruleId: string; scope: number | null; target: number | null; changed: number | null; directTaskIds: readonly string[] | null; taskIds?: AutomationPreviewTaskIds }>;
	changes: AutomationFieldChange[];
	issues: AutomationPlanIssue[];
	/** Distinct targets with a direct action change; null when the plan is unresolved. */
	changedTaskCount: number | null;
	/** All tasks the writer must apply, including dependent effects. */
	affectedTaskCount: number | null;
	needsConfirmation: boolean | null;
}

function stored(task: IndexedTask, field: string): PlanValue {
	if (field === 'checkbox') return task.checkbox;
	if (field === 'tags') return task.tags;
	return task.fieldValues[field] || null;
}
function equal(a: PlanValue, b: PlanValue): boolean {
	return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, i) => value === b[i]) : a === b;
}
function matchesRemoval(remove: Intent, value: PlanValue): boolean {
	if (equal(remove.value, value)) return true;
	if (remove.field !== 'repeat' || typeof remove.value !== 'string' || typeof value !== 'string') return false;
	const selected = parseRepeatRule(remove.value);
	const candidate = parseRepeatRule(value);
	return !!selected && !!candidate && serializeRepeatRule(selected) === serializeRepeatRule(candidate);
}
function clearValue(field: string): PlanValue {
	if (field === 'checkbox') return 'open';
	if (field === 'pinned') return false;
	return null;
}
function nextScalar(intent: Intent): PlanValue {
	return intent.op === 'clear-if' ? matchesRemoval(intent, intent.before) ? clearValue(intent.field) : intent.before : intent.value;
}
function originKey(origin: Origin): string {
	return JSON.stringify([origin.taskId, origin.ruleId, origin.actionId]);
}
function uniqueOrigins(origins: Origin[]): Origin[] {
	return [...new Map(origins.map(origin => [originKey(origin), origin])).values()];
}

function workflowEffects(
	task: IndexedTask, key: string, next: string, snapshot: AutomationPlanSnapshot,
): Record<string, string> | AutomationPlanIssue['reason'] {
	const { pipelines, defaultPipelineName } = snapshot.settings;
	let status = key === 'status' ? next : task.fieldValues.status;
	let checkbox = task.checkbox;
	const patch: Record<string, string> = {};
	if (key === 'dateCompleted' || key === 'dateCancelled' || (key === 'checkbox' && status)) {
		const dateKey = key === 'dateCancelled' || next === 'cancelled' ? 'dateCancelled' : 'dateCompleted';
		const date = key === 'checkbox' ? (next === 'open' ? '' : snapshot.asOf.slice(0, 10)) : next;
		const reverse = resolveReverseWorkflowFromTerminalDate(pipelines, status, defaultPipelineName, dateKey, date);
		if (!reverse.workflow || !reverse.isValid) return 'invalid-value';
		status = reverse.workflow.value;
		checkbox = reverse.checkbox;
	} else if (key === 'status' && next) {
		const workflow = resolveWorkflowStatus(pipelines, next);
		if (!workflow) return 'invalid-value';
		status = workflow.value;
		checkbox = workflow.checkbox;
	} else if (key === 'checkbox') {
		checkbox = next as IndexedTask['checkbox'];
	} else if (key === 'dateScheduled' && task.checkbox === 'open' && shouldTriggerOneShotAutomation(task.fieldValues.dateScheduled, next)) {
		const workflow = resolveAutomationWorkflowStatus(pipelines, status, defaultPipelineName, 'scheduled');
		if (!workflow) return {};
		status = workflow.value;
		checkbox = workflow.checkbox;
	} else if (key !== 'status') return {};
	patch.status = status ?? '';
	patch._checkbox = checkbox;
	if (key !== 'dateScheduled') {
		const today = snapshot.asOf.slice(0, 10);
		patch.dateCompleted = checkbox === 'done' ? (key === 'dateCompleted' ? next : task.fieldValues.dateCompleted || today) : '';
		patch.dateCancelled = checkbox === 'cancelled' ? (key === 'dateCancelled' ? next : task.fieldValues.dateCancelled || today) : '';
	}
	return patch;
}

interface PlanContext {
	snapshot: AutomationPlanSnapshot;
	source: AutomationFieldSource;
	tasks: Map<string, IndexedTask>;
}

function actionBatch(ctx: PlanContext, task: IndexedTask, action: AutomationAction, origin: Origin): IntentBatch | AutomationPlanIssue['reason'] {
	const { snapshot } = ctx;
	if (snapshot.unavailableIds.has(task.operonId)) return 'source-unavailable';
	const field = readAutomationField(task, action.field, ctx.source);
	if (typeof field === 'string') return field;
	let value: PlanValue;
	try { value = readActionLiteral(action, field, snapshot.actionReferenceDay ?? snapshot.asOf.slice(0, 10)); } catch { return 'invalid-value'; }
	const key = action.field;
	const add = action.operation === 'add';
	const intents: Intent[] = [];
	const push = (taskId: string, fieldKey: string, before: PlanValue, literal: PlanValue, op: Intent['op'], indirect: boolean) =>
		intents.push({ taskId, field: fieldKey, before, value: literal, op, indirect, origin });
	if (Array.isArray(value)) {
		if (key === 'tags' && task.primary.format === 'inline' && value.some(member => !isLosslessInlineTag(String(member)))) return 'invalid-value';
		for (const member of value) {
			if (key === 'reminderDatetimes' && Array.isArray(field.before)) {
				// Match existing minute-precision reminders without rewriting unrelated list entries.
				const matching = field.before.filter(item => typeof item === 'string' && canonicalizeLocalDatetime(item) === member);
				for (const item of matching.length ? matching : [member]) {
					push(task.operonId, key, field.before, item, add ? 'include' : 'exclude', false);
				}
				continue;
			}
			push(task.operonId, key, field.before, member, add ? 'include' : 'exclude', false);
			if (key !== 'blocking' && key !== 'blockedBy') continue;
			const peer = ctx.tasks.get(String(member));
			if (!peer || snapshot.unavailableIds.has(peer.operonId)) return 'source-unavailable';
			if (peer === task) return 'invalid-relation';
			const inverse = getOppositeDependencyFieldKey(key);
			const peerField = readAutomationField(peer, inverse, ctx.source);
			const reverseField = readAutomationField(peer, key, ctx.source);
			const opposite = readAutomationField(task, inverse, ctx.source);
			if (typeof peerField === 'string' || typeof reverseField === 'string' || typeof opposite === 'string') return 'source-unavailable';
			const reciprocal = peerField.before;
			push(peer.operonId, inverse, reciprocal, task.operonId, add ? 'include' : 'exclude', true);
			if (add) {
				// Changing direction also removes the former forward and reciprocal entries.
				push(task.operonId, inverse, opposite.before, member, 'exclude', true);
				push(peer.operonId, key, reverseField.before, task.operonId, 'exclude', true);
			}
		}
		return { origin, intents };
	}
	push(task.operonId, key, field.before, value, add ? 'set' : 'clear-if', false);
	const proposed = nextScalar(intents[0]);
	if (equal(proposed, field.before) || field.native || key === 'pinned') return { origin, intents };
	if (key === 'description') {
		if (task.primary.format === 'yaml') {
			if (typeof proposed !== 'string' || !proposed || sanitizeTaskFilename(proposed) !== proposed || proposed === '.' || proposed === '..') return 'invalid-value';
			const source = task.primary.filePath;
			const destination = source.slice(0, source.lastIndexOf('/') + 1) + proposed + '.md';
			const state = snapshot.fileRenameState(task, destination);
			if (state !== 'available') return state === 'occupied' ? 'invalid-value' : 'dependent-effect-unavailable';
			push(task.operonId, 'sourcePath', source, destination, 'set', true);
		}
		return { origin, intents };
	}
	const next = proposed === null ? '' : String(proposed);
	if (key === 'fileTaskDisplayTitle' && snapshot.settings.fileTaskDisplayTitleChangeMode !== 'keep') return 'dependent-effect-unavailable';
	if (key === 'parentTask' && next) {
		const parent = ctx.tasks.get(next);
		if (!parent || parent.operonId === task.operonId) return 'invalid-relation';
		if (snapshot.settings.keepInlineTasksWithParent
			&& task.primary.format === 'inline' && task.primary.filePath !== parent.primary.filePath) return 'dependent-effect-unavailable';
	}
	return { origin, intents };
}

const WORKFLOW = new Set(['status', 'checkbox', 'dateScheduled', 'dateCompleted', 'dateCancelled']);
const SCHEDULING = ['dateScheduled', 'datetimeStart', 'estimate', 'datetimeEnd'];
const literalText = (value: PlanValue) => Array.isArray(value) ? value.join('; ') : String(value ?? '');

/** First combine user intents, then derive workflow and schedule effects from the joint patch. */
function deriveDomainEffects(ctx: PlanContext, guardTransitions: Map<string, Origin[]>, changes: AutomationFieldChange[],
	groups: Map<string, Intent[]>, excluded: Set<string>, reject: (origins: Origin[]) => void, issues: AutomationPlanIssue[]): AutomationFieldChange[] {
	const byTask = new Map<string, AutomationFieldChange[]>();
	for (const change of changes) {
		const list = byTask.get(change.taskId);
		if (list) list.push(change); else byTask.set(change.taskId, [change]);
	}
	const derived: AutomationFieldChange[] = [];
	const { snapshot } = ctx;
	for (const [id, entries] of byTask) {
		const task = ctx.tasks.get(id)!;
		const managed = entries.filter(c => !c.field.startsWith('file.property:') && c.field !== 'pinned');
		if (!managed.length) continue;
		const payload: Record<string, string> = Object.create(null) as Record<string, string>;
		const originsByField = new Map<string, Origin[]>();
		const conflicts = (field: string, origins: Origin[]) => {
			excluded.add(id);
			issues.push({ taskId: id, field, reason: 'conflict', origins: uniqueOrigins(origins) });
		};
		const record = (field: string, value: string, origins: Origin[]) => {
			if (Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== value) conflicts(field, [...originsByField.get(field)!, ...origins]);
			else { payload[field] = value; originsByField.set(field, [...originsByField.get(field) ?? [], ...origins]); }
		};
		const rejectChange = (reason: AutomationPlanIssue['reason'], field: string, origins: Origin[]) => {
			issues.push({ taskId: id, reason, field, origins: uniqueOrigins(origins) });
			reject(origins);
		};
		// The scheduling normalizer accepts the last edited key. Stable precedence lets a
		// supplied end derive the duration and explicit incompatible operands surface below.
		const order = (key: string) => SCHEDULING.indexOf(key);
		for (const change of [...managed].sort((a, b) => order(a.field) - order(b.field))) {
			record(change.field === 'checkbox' ? '_checkbox' : change.field, literalText(change.after), change.origins);
		}
		if (payload.parentTask && snapshot.settings.inheritPropertiesOnParentLink) {
			const parent = ctx.tasks.get(payload.parentTask)!;
			const origins = originsByField.get('parentTask')!;
			try {
				const additions = resolveParentLinkInheritance(task, { ...payload, _tags: payload.tags ?? task.tags.join('; ') },
					snapshot.settings, () => projectParentLinkListSource(parent, snapshot.settings,
						parent.primary.format === 'yaml' ? snapshot.getFrontmatter(parent) : null));
				for (const [rawKey, value] of Object.entries(additions)) {
					const key = rawKey === '_tags' ? 'tags' : rawKey;
					const current = { ...task.fieldValues, ...payload };
					const prepared = normalizeTaskFieldPatch(current, { [key]: value }, {
						preserveRepeatIdentity: true, getRepeatSkipDates: series => [...snapshot.getRepeatSkipDates(series)],
					});
					if (Object.entries(prepared).some(([derived, v]) => derived !== key && current[derived]?.trim() && current[derived] !== v)) continue;
					for (const [derived, v] of Object.entries(prepared)) {
						if (!v && !current[derived]) continue;
						payload[derived] = v;
						originsByField.set(derived, uniqueOrigins([...originsByField.get(derived) ?? [], ...origins]));
					}
				}
			} catch {
				rejectChange('dependent-effect-unavailable', 'parentTask', origins);
				continue;
			}
		}
		const workflowChanges = managed.filter(c => WORKFLOW.has(c.field));
		const scheduleOrigins = managed.filter(c => SCHEDULING.includes(c.field)).flatMap(c => c.origins);
		// A start datetime can create the first scheduled date, which has the same workflow effect.
		if (scheduleOrigins.length && !Object.prototype.hasOwnProperty.call(payload, 'dateScheduled')) {
			const scheduled = applyFieldRules({ current: task.fieldValues, patch: payload, changedKeys: Object.keys(payload) }).patch.dateScheduled;
			if (shouldTriggerOneShotAutomation(task.fieldValues.dateScheduled, scheduled)) {
				workflowChanges.push({ taskId: id, field: 'dateScheduled', before: null, after: scheduled, origins: scheduleOrigins, indirect: true });
			}
		}
		for (const change of workflowChanges) {
			const workflow = workflowEffects(task, change.field, literalText(change.after), snapshot);
			if (typeof workflow === 'string') { rejectChange(workflow, change.field, change.origins); continue; }
			for (const [field, value] of Object.entries(workflow)) {
				// An explicit terminal date supplies the date of an equivalent status transition.
				if ((field === 'dateCompleted' || field === 'dateCancelled') && value && payload[field]) continue;
				record(field, value, change.origins);
			}
		}
		if (excluded.has(id)) continue;
		const transition = resolveDependencyStatusChangeAttempt(task, payload);
		if (transition) {
			const workflow = resolveWorkflowStatus(snapshot.settings.pipelines, payload.status);
			const scheduled = !!workflow?.definition.isScheduledTarget && task.checkbox === 'open'
				&& isScheduledDependencyPlanningTransition({ attempt: transition, previousDateScheduled: task.fieldValues.dateScheduled,
					nextDateScheduled: literalText(workflowChanges.find(c => c.field === 'dateScheduled')?.after ?? null), expectedStatus: workflow.value, expectedCheckbox: workflow.checkbox });
			const origins = uniqueOrigins([...(originsByField.get('status') ?? []), ...(originsByField.get('_checkbox') ?? [])]);
			if (!scheduled) guardTransitions.set(id, origins);
			if (transition.nextCheckbox !== 'open' && (task.fieldValues.repeat || snapshot.activeTimerId === undefined || snapshot.activeTimerId === id || snapshot.settings.pinnedDockAutoUnpinFinished && !snapshot.pins)) {
				rejectChange('dependent-effect-unavailable', 'checkbox', origins);
				continue;
			}
		}
		// A Repeat Action owns the expression alone, including when another Action changes this task.
		const repeatAction = managed.some(change => change.field === 'repeat');
		if (!repeatAction && payload.repeat && !task.fieldValues.repeatSeriesId) {
			rejectChange('dependent-effect-unavailable', 'repeat', originsByField.get('repeat')!);
			continue;
		}
		const normalized = repeatAction
			? applyFieldRules({ current: task.fieldValues, patch: payload, changedKeys: Object.keys(payload) }).patch
			: normalizeTaskFieldPatch(task.fieldValues, payload, {
				preserveRepeatIdentity: true, getRepeatSkipDates: seriesId => [...snapshot.getRepeatSkipDates(seriesId)],
			});
		const explicit = new Map(entries.map(change => [change.field, change]));
		const allOrigins = managed.flatMap(c => c.origins);
		const propose = (field: string, before: PlanValue, after: PlanValue, origins: Origin[]) => {
			const direct = explicit.get(field);
			const claims = groups.get(JSON.stringify([id, field])) ?? [];
			const opposed = claims.filter(intent => intent.op === 'set' && literalText(intent.value) !== literalText(after)
				|| intent.op === 'clear-if' && matchesRemoval(intent, after)
				|| intent.op === 'exclude' && Array.isArray(after) && after.includes(intent.value as Member)
				|| intent.op === 'include' && Array.isArray(after) && !after.includes(intent.value as Member));
			if (!opposed.length && Array.isArray(after) && direct && Array.isArray(direct.after) && direct.after.every(value => after.includes(value))) {
				direct.after = after;
				direct.origins = uniqueOrigins([...direct.origins, ...origins]);
			} else if (opposed.length || direct && literalText(direct.after) !== literalText(after)) {
				conflicts(field, [...origins, ...opposed.map(intent => intent.origin), ...(direct?.origins ?? [])]);
			} else if (direct) {
				direct.origins = uniqueOrigins([...direct.origins, ...origins]);
			} else if (!equal(before, after)) {
				derived.push({ taskId: id, field, before, after, indirect: true, origins: uniqueOrigins(origins) });
			}
		};
		for (const [rawKey, rawValue] of Object.entries(normalized)) {
			const field = rawKey === '_checkbox' ? 'checkbox' : rawKey;
			const direct = explicit.get(field);
			if (direct && literalText(direct.after) === rawValue && !WORKFLOW.has(field)) continue;
			const before = direct?.before ?? stored(task, field);
			const type = getManagedTaskFieldType(field, snapshot.settings.keyMappings);
			const after = type === 'list' || field === 'tags' ? parseListValue(rawValue) : rawValue && type === 'number' ? Number(rawValue) : rawValue || null;
			const origins = originsByField.get(rawKey) ?? (SCHEDULING.includes(field) && scheduleOrigins.length ? scheduleOrigins : allOrigins);
			if (!direct && literalText(before) === rawValue) continue;
			propose(field, before, after, origins);
		}
		if (snapshot.settings.pinnedDockAutoUnpinFinished && snapshot.pins?.has(id)
			&& shouldAutoUnpinTerminalTask({ ...task, fieldValues: { ...task.fieldValues, ...normalized },
				checkbox: (normalized._checkbox ?? task.checkbox) as IndexedTask['checkbox'] }, snapshot.settings.pipelines)) {
			propose('pinned', true, false, allOrigins);
		}
	}
	return derived;
}

function resolveIntents(intents: Intent[], directByRule: Map<string, Set<string>>): AutomationFieldChange | 'conflict' | undefined {
	const first = intents[0];
	const sets = intents.filter(i => i.op === 'set' || i.op === 'include');
	const removes = intents.filter(i => i.op === 'clear-if' || i.op === 'exclude');
	if (sets.some(set => removes.some(remove => matchesRemoval(remove, set.value)))) return 'conflict';
	let after: PlanValue;
	let contributing: Intent[];
	if (Array.isArray(first.before)) {
		const before = first.before;
		const drop = new Set(removes.map(i => i.value as Member));
		const extra = new Set(sets.map(i => i.value as Member).filter(v => !before.includes(v)));
		after = [...before.filter(v => !drop.has(v)), ...extra];
		contributing = intents.filter(i => i.op === 'include' ? extra.has(i.value as Member) : before.includes(i.value as Member));
	} else {
		if (sets.some(i => !equal(i.value, sets[0].value))) return 'conflict';
		after = sets.length ? sets[0].value : removes.some(i => matchesRemoval(i, first.before)) ? clearValue(first.field) : first.before;
		contributing = sets.length ? sets : removes.filter(i => matchesRemoval(i, first.before));
	}
	if (equal(first.before, after)) return;
	for (const intent of contributing) {
		if (intent.indirect) continue;
		const ruleId = intent.origin.ruleId;
		const ids = directByRule.get(ruleId);
		if (ids) ids.add(intent.taskId);
		else directByRule.set(ruleId, new Set([intent.taskId]));
	}
	return { taskId: first.taskId, field: first.field, before: first.before, after,
		origins: uniqueOrigins(contributing.map(i => i.origin)), indirect: contributing.every(i => i.indirect) };
}

function organize(batches: IntentBatch[], excluded: Set<string>): Map<string, Intent[]> {
	const groups = new Map<string, Intent[]>();
	for (const batch of batches) {
		if (batch.intents.some(intent => excluded.has(intent.taskId))) continue;
		for (const intent of batch.intents) {
			const key = JSON.stringify([intent.taskId, intent.field]);
			const group = groups.get(key);
			if (group) group.push(intent); else groups.set(key, [intent]);
		}
	}
	return groups;
}
function projectedGraph(tasks: Map<string, IndexedTask>, changes: AutomationFieldChange[]) {
	const graph = new Map(tasks);
	for (const { taskId, field, after } of changes) {
		const before = tasks.get(taskId)!;
		let task = graph.get(taskId)!;
		if (task === before) {
			task = { ...before, fieldValues: { ...before.fieldValues } };
			graph.set(taskId, task);
		}
		if (field === 'checkbox') task.checkbox = after as IndexedTask['checkbox'];
		else if (field === 'sourcePath') task.primary = { ...before.primary, filePath: String(after) };
		else if (field === 'tags') task.tags = after as string[];
		else if (field === 'description') task.description = String(after ?? '');
		else if (field !== 'pinned' && !field.startsWith('file.property:')) {
			if (after === null) delete task.fieldValues[field];
			else task.fieldValues[field] = Array.isArray(after) ? after.join('; ') : String(after);
		}
	}
	return graph;
}

function projectIndirectChanges(
	ctx: PlanContext, changes: AutomationFieldChange[], graph: Map<string, IndexedTask>, groups: Map<string, Intent[]>, excluded: Set<string>,
	excludeOrigins: (origins: Origin[]) => void, issues: AutomationPlanIssue[],
): AutomationFieldChange[] {
	const affected = new Map<string, Origin[]>();
	const contributors = new Map<string, Set<AutomationFieldChange>>();
	const mark = (id: string, change: AutomationFieldChange) => {
		const origins = change.origins;
		const sources = contributors.get(id);
		if (sources) sources.add(change); else contributors.set(id, new Set([change]));
		const group = affected.get(id);
		if (group) group.push(...origins); else affected.set(id, [...origins]);
	};
	for (const change of changes) {
		if (change.field === 'pinned') continue;
		mark(change.taskId, change);
		const parents = new Set([ctx.tasks.get(change.taskId)?.fieldValues.parentTask, graph.get(change.taskId)?.fieldValues.parentTask]);
		for (let id of parents) {
			const visited = new Set([change.taskId]);
			while (id) {
				if (visited.has(id) || !graph.has(id) || ctx.snapshot.unavailableIds.has(id)) {
					issues.push({ taskId: change.taskId, field: 'parentTask', reason: 'dependent-effect-unavailable', origins: change.origins });
					excludeOrigins(change.origins);
					break;
				}
				visited.add(id);
				mark(id, change);
				id = graph.get(id)?.fieldValues.parentTask;
			}
		}
	}
	if (!affected.size) return [];
	const directByField = new Map(changes.map(c => [JSON.stringify([c.taskId, c.field]), c]));
	const indirect: AutomationFieldChange[] = [];
	let patches: Map<string, Record<string, string>>;
	try {
		patches = ctx.snapshot.projectAggregates(graph, new Set(affected.keys()));
	} catch {
		issues.push({ reason: 'dependent-effect-unavailable' });
		for (const group of affected.values()) excludeOrigins(group);
		return [];
	}
	for (const [taskId, origins] of affected) {
		const patch = patches.get(taskId);
		if (!patch) {
			issues.push({ taskId, reason: 'dependent-effect-unavailable', origins: uniqueOrigins(origins) });
			excludeOrigins(origins);
			continue;
		}
		const fields = { ...patch };
		fields.datetimeModified = ctx.snapshot.asOf;
		for (const [field, value] of Object.entries(fields)) {
			const before = field === 'datetimeModified' ? ctx.tasks.get(taskId)!.datetimeModified : stored(ctx.tasks.get(taskId)!, field);
			const fieldKey = JSON.stringify([taskId, field]);
			const direct = directByField.get(fieldKey);
			const opposed = (groups.get(fieldKey) ?? []).filter(intent => intent.op === 'set' && literalText(intent.value) !== value
				|| intent.op === 'clear-if' && literalText(intent.value) === value);
			if (direct && String(direct.after ?? '') === value) continue;
			if (!direct && equal(before, value || null)) continue;
			const inputs = [...contributors.get(taskId) ?? []].filter(c => {
				if (field === 'datetimeModified' || c.field === 'parentTask') return true;
				if (field === 'totalEstimate') return c.field === 'estimate';
				if (field === 'totalDuration') return c.field === 'duration';
				if (field === 'dateStarted' || field === 'dateDue') return ['dateDue', 'dateScheduled', 'dateStarted', 'dateCompleted', 'checkbox'].includes(c.field);
				return c.field === 'checkbox';
			});
			const fieldOrigins = inputs.length ? inputs.flatMap(c => c.origins) : origins;
			if (direct || opposed.length || excluded.has(taskId)) {
				const involved = uniqueOrigins([...fieldOrigins, ...opposed.map(intent => intent.origin), ...(direct?.origins ?? [])]);
				issues.push({ reason: 'conflict', taskId, field, origins: involved });
				excluded.add(taskId);
				excludeOrigins(involved);
				continue;
			}
			if (!equal(before, value || null)) indirect.push({ taskId, field, before, after: value || null, indirect: true, origins: uniqueOrigins(fieldOrigins) });
		}
	}
	return indirect;
}

/** Resolve blockers after all workflow dates and checkboxes have produced their final statuses. */
function guardProjectedTransitions(
	ctx: PlanContext, graph: Map<string, IndexedTask>, transitions: Map<string, Origin[]>,
	excludeOrigins: (origins: Origin[]) => void, issues: AutomationPlanIssue[],
): void {
	if (!transitions.size) return;
	// A non-representative copy may be the only source of an inverse blocking edge.
	const ambiguousBlockerIds = new Set<string>();
	const ambiguousTargets = new Set<string>();
	for (const copy of ctx.snapshot.getDuplicateInstances()) {
		ambiguousBlockerIds.add(copy.operonId);
		for (const target of parseDependencyIdList(copy.fieldValues.blocking)) ambiguousTargets.add(target);
	}
	const incoming = new Map<string, IndexedTask[]>();
	for (const task of graph.values()) for (const id of parseDependencyIdList(task.fieldValues.blocking)) {
		if (!transitions.has(id)) continue;
		const blockers = incoming.get(id);
		if (blockers) blockers.push(task); else incoming.set(id, [task]);
	}
	for (const [id, origins] of transitions) {
		const blockers = resolveActiveBlockers(graph.get(id)!, peer => ambiguousBlockerIds.has(peer) ? undefined : graph.get(peer),
			ctx.snapshot.settings.pipelines,
			() => incoming.get(id) ?? []);
		if (!blockers.length && !ambiguousTargets.has(id)) continue;
		issues.push({ reason: 'blocked', taskId: id, field: 'status', origins });
		excludeOrigins(origins);
	}
}

function combineBatches(ctx: PlanContext, batches: IntentBatch[], issues: AutomationPlanIssue[]) {
	const excluded = new Set<string>();
	const rejected = new Set<string>();
	const excludeOrigins = (origins: Origin[]) => { for (const origin of origins) rejected.add(originKey(origin)); };
	for (;;) {
		const previous = excluded.size + rejected.size;
		const changes: AutomationFieldChange[] = [];
		const directByRule = new Map<string, Set<string>>();
		const groups = organize(batches.filter(batch => !rejected.has(originKey(batch.origin))), excluded);
		for (const intents of groups.values()) {
			const change = resolveIntents(intents, directByRule);
			if (change === 'conflict') {
				const { taskId, field } = intents[0];
				excluded.add(taskId);
				issues.push({ taskId, field, reason: 'conflict', origins: uniqueOrigins(intents.map(i => i.origin)) });
			} else if (change) changes.push(change);
		}
		if (previous !== excluded.size + rejected.size) continue;
		const graph = projectedGraph(ctx.tasks, changes);
		const destinations = new Map<string, AutomationFieldChange>();
		for (const change of changes.filter(c => c.field === 'sourcePath')) {
			const key = String(change.after).toLowerCase();
			const other = destinations.get(key);
			if (other) {
				const origins = uniqueOrigins([...change.origins, ...other.origins]);
				for (const id of [other.taskId, change.taskId]) {
					excluded.add(id);
					issues.push({ taskId: id, field: 'sourcePath', reason: 'conflict', origins });
				}
			} else destinations.set(key, change);
		}
		if (previous !== excluded.size + rejected.size) continue;
		const edges = new Map<string, Origin[]>();
		const additions = new Map<string, ReturnType<typeof getDependencyEdgeForField>>();
		for (const intents of groups.values()) {
			for (const intent of intents) {
				if ((intent.field !== 'blocking' && intent.field !== 'blockedBy') || intent.op !== 'include'
					|| (intent.before as Member[]).includes(intent.value as Member)) continue;
				const edge = getDependencyEdgeForField(intent.taskId, intent.field, String(intent.value));
				const key = JSON.stringify([edge.fromId, edge.toId]);
				additions.set(key, edge);
				const group = edges.get(key);
				if (group) group.push(intent.origin); else edges.set(key, [intent.origin]);
			}
		}
		if (additions.size) for (const edge of validateDependencyEdgeSet(additions.values(), graph.values())) {
			const origins = edges.get(JSON.stringify([edge.fromId, edge.toId]))!;
			issues.push({ taskId: edge.fromId, field: 'blocking', reason: 'invalid-relation', origins: uniqueOrigins(origins) });
			excludeOrigins(origins);
		}
		if (previous !== excluded.size + rejected.size) continue;
		const transitions = new Map<string, Origin[]>();
		const domain = deriveDomainEffects(ctx, transitions, changes, groups, excluded, excludeOrigins, issues);
		if (previous !== excluded.size + rejected.size) continue;
		changes.push(...domain);
		const finalGraph = domain.length ? projectedGraph(ctx.tasks, changes) : graph;
		guardProjectedTransitions(ctx, finalGraph, transitions, excludeOrigins, issues);
		if (previous !== excluded.size + rejected.size) continue;
		const indirect = projectIndirectChanges(ctx, changes, finalGraph, groups, excluded, excludeOrigins, issues);
		if (previous === excluded.size + rejected.size) return { changes: [...changes, ...indirect], directByRule };
	}
}

/** Date changes and explicit rule saves evaluate the whole scope without a triggering task. */
export type AutoTriggers = ReadonlyMap<string, ReadonlySet<string> | 'all'>;

/** The caller chooses rules for a draft or a run. All matchers and actions read one original graph. */
export function planAutomationChanges(
	snapshot: AutomationPlanSnapshot, rules: readonly AutomationRule[], confirmation: AutomationConfirmation,
	triggerTasks?: AutoTriggers,
): AutomationChangePlan {
	const tasks = new Map(snapshot.tasks.map(task => [task.operonId, task]));
	const issues: AutomationPlanIssue[] = [];
	const counts: RuleCount[] = [];
	const batches: IntentBatch[] = [];
	const nativeFields = new Map(snapshot.native?.fields.map(field => [field.key, field]));
	const ctx: PlanContext = { snapshot, tasks, source: { settings: snapshot.settings, native: snapshot.native, getInlineList: snapshot.getInlineList, getFrontmatter: snapshot.getFrontmatter, nativeFields, pins: snapshot.pins } };
	if (!snapshot.ready || tasks.size !== snapshot.tasks.length) issues.push({ reason: 'index-unavailable' });
	const options: FilterEvaluationOptions = { today: snapshot.asOf.slice(0, 10), pipelines: snapshot.settings.pipelines,
		projectSerialScopes: snapshot.settings.projectSerialScopes, filePropertyContext: snapshot.native, getRepeatSkipDates: snapshot.getRepeatSkipDates };
	const pins = snapshot.pins;
	const invalidProjectGroup = createAutomationProjectSerialValidator(snapshot.settings.projectSerialScopes);
	const readableConditions = new WeakMap<FilterSetCondition, boolean>();
	const matcher = (root: FilterGroup) => prepareFilterGroupMatcher(root, snapshot.tasks, pins && { isPinned: id => pins.has(id) }, options, (condition, task) => {
		if (condition.field === 'pinned') return pins !== null;
		if (!condition.field.startsWith('file.property:')) {
			let readable = readableConditions.get(condition);
			if (readable === undefined) {
				const type = snapshot.conditionFields.get(condition.field) ?? getManagedTaskFieldType(condition.field, snapshot.settings.keyMappings);
				readable = condition.fieldType === type && getOperatorsForField(condition.field, condition.fieldType, true).some(op => op.id === condition.operator)
					&& !invalidProjectGroup(condition);
				readableConditions.set(condition, readable);
			}
			return readable;
		}
		const field = nativeFields.get(condition.field);
		if (!field || field.unavailable || field.type !== condition.fieldType) return false;
		const cell = snapshot.native?.getCell(task, field.key);
		return !!cell?.nativeState && cell.readOnlyReason !== 'unavailable' && cell.readOnlyReason !== 'type-conflict';
	});
	for (const rule of rules) {
		const scope = matcher(rule.scope);
		const trigger = triggerTasks?.get(rule.id);
		if (triggerTasks && trigger !== 'all' && !Array.from(trigger ?? []).some(id => {
			const task = tasks.get(id);
			return task && scope(task) !== 'false';
		})) continue;
		const invalidScope = invalidProjectGroup(rule.scope);
		const invalidTarget = invalidProjectGroup(rule.target);
		const count: RuleCount = { ruleId: rule.id, scope: 0, target: 0, changed: 0 };
		if (snapshot.includePreviewTaskIds) count.matches = { scope: [], target: [] };
		counts.push(count);
		if (invalidScope) issues.push({ reason: 'condition-unavailable', field: 'scope', ruleId: rule.id, ...invalidScope });
		if (invalidTarget) issues.push({ reason: 'condition-unavailable', field: 'target', ruleId: rule.id, ...invalidTarget });
		if (invalidScope) continue;
		const target = invalidTarget ? null : matcher(rule.target);
		for (const task of tasks.values()) {
			const scoped = scope(task);
			if (scoped === 'unknown') issues.push({ reason: 'condition-unavailable', field: 'scope', taskId: task.operonId, ruleId: rule.id });
			if (scoped !== 'true') continue;
			count.scope++;
			count.matches?.scope.push(task.operonId);
			if (!target) continue;
			const targeted = target(task);
			if (targeted === 'unknown') issues.push({ reason: 'condition-unavailable', field: 'target', taskId: task.operonId, ruleId: rule.id });
			if (targeted !== 'true') continue;
			count.target++;
			count.matches?.target.push(task.operonId);
			for (const action of rule.actions) {
				const origin = { ruleId: rule.id, actionId: action.id, taskId: task.operonId };
				const batch = actionBatch(ctx, task, action, origin);
				if (typeof batch === 'string') issues.push({ reason: batch, taskId: task.operonId, field: action.field, origins: [origin] });
				else batches.push(batch);
			}
		}
	}
	const { changes, directByRule } = combineBatches(ctx, batches, issues);
	for (const count of counts) count.changed = directByRule.get(count.ruleId)?.size ?? 0;
	const actionable = new Set(rules.filter(rule => rule.actions.length).map(rule => rule.id));
	const unknownScope = new Set<string>(), unknownTarget = new Set<string>(), unknownChanges = new Set<string>();
	for (const issue of issues) {
		if (issue.reason === 'index-unavailable') for (const rule of rules) unknownScope.add(rule.id);
		if (issue.reason === 'condition-unavailable' && issue.ruleId) {
			(issue.field === 'scope' ? unknownScope : unknownTarget).add(issue.ruleId);
		}
		if (issue.reason === 'ambiguous-property' || issue.reason === 'source-unavailable' || issue.reason === 'unsupported-source' || issue.reason === 'dependent-effect-unavailable') {
			if (issue.origins) for (const origin of issue.origins) unknownChanges.add(origin.ruleId);
			else for (const rule of rules) unknownChanges.add(rule.id);
		}
	}
	const result = counts.map(count => {
		const id = count.ruleId;
		const scope = unknownScope.has(id) ? null : count.scope;
		const target = scope === null || unknownTarget.has(id) ? null : count.target;
		const changed = actionable.has(id) && (target === null || unknownChanges.has(id)) ? null : count.changed;
		const directTaskIds = changed === null ? null : Array.from(directByRule.get(id) ?? []);
		const result = { ruleId: id, scope, target, changed, directTaskIds };
		if (!count.matches) return result;
		return { ...result, taskIds: {
			scope: scope === null ? null : count.matches.scope,
			target: target === null ? null : count.matches.target,
			changed: directTaskIds,
		} };
	});
	const unresolved = result.some(rule => rule.changed === null);
	const directIds = new Set<string>();
	for (const ids of directByRule.values()) for (const id of ids) directIds.add(id);
	const changedTaskCount = unresolved ? null : directIds.size;
	const affectedTaskCount = unresolved ? null : new Set(changes.map(change => change.taskId)).size;
	const needsConfirmation = changedTaskCount === null ? null
		: (confirmation === 'always' && changes.length > 0) || (typeof confirmation === 'number' && changedTaskCount > confirmation);
	return { rules: result, changes, issues, changedTaskCount, affectedTaskCount, needsConfirmation };
}
