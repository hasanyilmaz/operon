import { FILTER_FIELD_TYPES, type FilterGroup, type FilterFieldType, type FilterNode, type ProjectSerialScope } from '../types/settings';
import { normalizeProjectSerialScopes, PROJECT_SERIAL_SCOPE_FILTER_FIELD } from './project-serials';

export const AUTOMATION_CONFIRMATIONS = ['always', 5, 10, 15, 20, 25, 50, 100, 'none'] as const;
export type AutomationConfirmation = typeof AUTOMATION_CONFIRMATIONS[number];

export interface AutomationAction {
	id: string;
	field: string;
	operation: 'add' | 'remove';
	value: string | string[];
	valueEncoding?: 'vault-v1';
}

export interface AutomationRule {
	id: string;
	name: string;
	mode: 'manual' | 'auto';
	active: boolean;
	scope: FilterGroup;
	target: FilterGroup;
	actions: AutomationAction[];
}

export interface AutomationRulesSettings {
	version: 1;
	confirmation: AutomationConfirmation;
	rules: AutomationRule[];
}

/** Validate saved group IDs independently of task matches and boolean short-circuiting. */
export function createAutomationProjectSerialValidator(scopes: readonly ProjectSerialScope[]) {
	let available: Set<string> | undefined;
	return function findInvalidSelection(node: FilterNode): { conditionId: string; projectSerialGroupId?: string } | undefined {
		if ('children' in node) {
			for (const child of node.children) {
				const issue = findInvalidSelection(child);
				if (issue) return issue;
			}
		} else if (node.field === PROJECT_SERIAL_SCOPE_FILTER_FIELD && (node.operator === 'isAnyOf' || node.operator === 'isNoneOf')) {
			if (!node.values?.length) return { conditionId: node.id };
			const ids = available ??= new Set(normalizeProjectSerialScopes(scopes).map(scope => scope.id));
			const missing = node.values.find(id => !ids.has(id));
			if (missing !== undefined) return { conditionId: node.id, projectSerialGroupId: missing };
		}
		return undefined;
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function named(value: unknown): value is string {
	return typeof value === 'string' && !!value.trim();
}

function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validRoot(root: unknown): boolean {
	if (!record(root) || !Array.isArray(root.children)) return false;
	const pending: unknown[] = [root];
	const ids = new Set<string>();
	while (pending.length) {
		const node = pending.pop();
		if (!record(node) || !named(node.id) || ids.has(node.id)) return false;
		ids.add(node.id);
		if ('children' in node) {
			if (!Array.isArray(node.children) || (node.logic !== 'all' && node.logic !== 'any' && node.logic !== 'none')) return false;
			for (const child of node.children) pending.push(child);
		} else if (!named(node.field) || !named(node.operator) || !FILTER_FIELD_TYPES.has(node.fieldType as FilterFieldType)
			|| (node.value !== undefined && typeof node.value !== 'string') || (node.values !== undefined && !strings(node.values))) return false;
	}
	return true;
}

function validRule(value: unknown): value is AutomationRule {
	if (!record(value) || !named(value.id) || !named(value.name) || (value.mode !== 'manual' && value.mode !== 'auto')
		|| typeof value.active !== 'boolean' || !validRoot(value.scope) || !validRoot(value.target) || !Array.isArray(value.actions)) return false;
	const ids = new Set<string>();
	for (const action of value.actions as unknown[]) {
		if (!record(action) || !named(action.id) || ids.has(action.id) || !named(action.field)
			|| (action.valueEncoding !== undefined && (action.valueEncoding !== 'vault-v1' || typeof action.value !== 'string'))
			|| (action.operation !== 'add' && action.operation !== 'remove') || (typeof action.value !== 'string' && !strings(action.value))) return false;
		ids.add(action.id);
	}
	return true;
}

export function isAutomationRulesSettings(value: unknown): value is AutomationRulesSettings {
	return record(value) && value.version === 1 && AUTOMATION_CONFIRMATIONS.some(option => option === value.confirmation)
		&& Array.isArray(value.rules) && value.rules.every(validRule)
		&& new Set(value.rules.map(rule => rule.id)).size === value.rules.length;
}

export function readAutomationRules(value: unknown): AutomationRulesSettings {
	if (value === undefined) return { version: 1, confirmation: 'always', rules: [] };
	if (!isAutomationRulesSettings(value)) throw new Error('Unsupported automation rule settings');
	return structuredClone(value);
}

type IdPrefix = 'ar_' | 'fg_' | 'act_';
const RULE_ID = /^ar_[0-9a-z]{7}$/u;
const ROOT_ID = /^fg_[0-9a-z]{8}$/u;
const ACTION_ID = /^act_[0-9a-z]{8}$/u;

/** Reserve each ID immediately so several allocations in the same draft cannot collide. */
function reserveId(prefix: IdPrefix, used: Set<string>, previous?: string): string {
	const width = prefix === 'ar_' ? 7 : 8;
	const space = 36 ** width;
	let index = previous === undefined ? Math.floor(Math.random() * space)
		: parseInt(previous.toLowerCase().replace(/[^0-9a-z]/gu, '').slice(-width) || '0', 36);
	for (;;) {
		const id = prefix + index.toString(36).padStart(width, '0');
		if (!used.has(id)) {
			used.add(id);
			return id;
		}
		index = (index + 1) % space;
	}
}

export function createAutomationRuleId(rules: readonly AutomationRule[]): string {
	return reserveId('ar_', new Set(rules.map(rule => rule.id)));
}

export function createAutomationActionId(used: Set<string>): string {
	return reserveId('act_', used);
}

function legacyReplacements(ids: string[], format: RegExp, prefix: IdPrefix): Map<string, string> {
	const used = new Set(ids);
	const replacements = new Map<string, string>();
	for (const id of ids.filter(id => !format.test(id)).sort()) {
		replacements.set(id, reserveId(prefix, used, id));
	}
	return replacements;
}

function migrateRoots(rule: AutomationRule): [FilterGroup, FilterGroup] {
	const { scope, target } = rule;
	if (ROOT_ID.test(scope.id) && ROOT_ID.test(target.id) && scope.id !== target.id) return [scope, target];
	const used = new Set([scope.id, target.id]);
	const pending = [...scope.children, ...target.children];
	for (const node of pending) {
		used.add(node.id);
		if ('children' in node) for (const child of node.children) pending.push(child);
	}
	const root = (group: FilterGroup): FilterGroup => ({ ...group, id: reserveId('fg_', used, group.id) });
	return [
		ROOT_ID.test(scope.id) ? scope : root(scope),
		ROOT_ID.test(target.id) && target.id !== scope.id ? target : root(target),
	];
}

/** Stable across backup previews, reloads and retries. Only rule, root and action identities migrate. */
export function migrateAutomationRuleIds(settings: AutomationRulesSettings): AutomationRulesSettings {
	const replacements = legacyReplacements(settings.rules.map(rule => rule.id), RULE_ID, 'ar_');
	const rules = settings.rules.map(rule => {
		const id = replacements.get(rule.id) ?? rule.id;
		const [scope, target] = migrateRoots(rule);
		const actionIds = legacyReplacements(rule.actions.map(action => action.id), ACTION_ID, 'act_');
		if (id === rule.id && scope === rule.scope && target === rule.target && !actionIds.size) return rule;
		const actions = actionIds.size ? rule.actions.map(action => {
			const replacement = actionIds.get(action.id);
			return replacement ? { ...action, id: replacement } : action;
		}) : rule.actions;
		return { ...rule, id, scope, target, actions };
	});
	return rules.some((rule, index) => rule !== settings.rules[index]) ? { ...settings, rules } : settings;
}

export function createAutomationRule(name: string, rules: readonly AutomationRule[] = []): AutomationRule {
	const used = new Set<string>();
	const root = (): FilterGroup => ({ id: reserveId('fg_', used), logic: 'all', children: [] });
	return { id: createAutomationRuleId(rules), name: name.trim(), mode: 'manual', active: false, scope: root(), target: root(), actions: [] };
}
