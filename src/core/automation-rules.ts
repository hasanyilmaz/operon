import { FILTER_FIELD_TYPES, type FilterGroup, type FilterFieldType } from '../types/settings';

export const AUTOMATION_CONFIRMATIONS = ['always', 5, 10, 15, 20, 25, 50, 100, 'none'] as const;
export type AutomationConfirmation = typeof AUTOMATION_CONFIRMATIONS[number];

export interface AutomationAction {
	id: string;
	field: string;
	operation: 'add' | 'remove';
	value: string | string[];
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

const RULE_ID_SPACE = 36 ** 7;
const RULE_ID_FORMAT = /^ar_[0-9a-z]{7}$/u;

function availableRuleId(used: ReadonlySet<string>, start: number): string {
	let index = start;
	for (;;) {
		const id = 'ar_' + index.toString(36).padStart(7, '0');
		if (!used.has(id)) return id;
		index = (index + 1) % RULE_ID_SPACE;
	}
}

export function createAutomationRuleId(rules: readonly AutomationRule[]): string {
	return availableRuleId(new Set(rules.map(rule => rule.id)), Math.floor(Math.random() * RULE_ID_SPACE));
}

/** Stable across backup previews, reloads and retries, including a collision between two legacy IDs. */
export function migrateAutomationRuleIds(settings: AutomationRulesSettings): AutomationRulesSettings {
	const legacy = settings.rules.map(rule => rule.id).filter(id => !RULE_ID_FORMAT.test(id));
	if (!legacy.length) return settings;
	const used = new Set(settings.rules.map(rule => rule.id));
	const replacements = new Map<string, string>();
	for (const previous of legacy.sort()) {
		const suffix = previous.toLowerCase().replace(/[^0-9a-z]/gu, '').slice(-7);
		const id = availableRuleId(used, parseInt(suffix || '0', 36));
		used.add(id);
		replacements.set(previous, id);
	}
	const rules = settings.rules.map(rule => {
		const id = replacements.get(rule.id);
		return id ? { ...rule, id } : rule;
	});
	return { ...settings, rules };
}

export function createAutomationRule(name: string, rules: readonly AutomationRule[] = []): AutomationRule {
	const root = (): FilterGroup => ({ id: crypto.randomUUID(), logic: 'all', children: [] });
	return { id: createAutomationRuleId(rules), name: name.trim(), mode: 'manual', active: false, scope: root(), target: root(), actions: [] };
}
