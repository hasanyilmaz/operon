import type { AutomationChangePlan, AutoTriggers } from '../core/automation-change-plan';
import { readAutomationRules, type AutomationRule, type AutomationRulesSettings } from '../core/automation-rules';
import type { OperonStorage } from '../storage/operon-storage';

export async function deactivateAutomationRules(storage: Pick<OperonStorage, 'getSettings' | 'saveAutomationRules'>, rules: AutomationRule[]): Promise<boolean> {
	const expected = storage.getSettings().automationRules;
	const current = readAutomationRules(expected);
	if (!rules.every(rule => JSON.stringify(current.rules.find(item => item.id === rule.id)) === JSON.stringify(rule))) return false;
	const ids = new Set(rules.map(rule => rule.id));
	await storage.saveAutomationRules(expected, { ...current, rules: current.rules.map(rule => ids.has(rule.id) ? { ...rule, active: false } : rule) });
	return true;
}

export type AutomationDecision = 'apply' | 'dismiss' | 'deactivate' | 'replan' | 'background';
export interface AutomationWork {
	/** Include source paths, exact before/after content and canonical pin entries. */
	identity: readonly string[];
	apply(current: () => boolean): Promise<{ applied: number; uncertain: number; refreshPending?: boolean }>;
}
export interface AutoRunBatch {
	rules: Map<string, Set<string> | 'day'>;
	confirmAgain: boolean;
}
export interface AutomationRunPorts {
	settings(): AutomationRulesSettings;
	now(): string;
	plan(rules: AutomationRule[], confirmation: AutomationRulesSettings['confirmation'], asOf: string, triggers?: AutoTriggers): AutomationChangePlan;
	prepare(plan: AutomationChangePlan): Promise<AutomationWork | null>;
	confirm(plan: AutomationChangePlan, rules: AutomationRule[], batch?: AutoRunBatch): Promise<AutomationDecision>;
	refreshBatch?(batch: AutoRunBatch): void;
	deferConfirmation?(batch: AutoRunBatch, alreadyShown: boolean): boolean;
	deactivate(rules: AutomationRule[]): Promise<boolean>;
	exclusive<T>(operation: () => Promise<T>): Promise<T>;
	available(): boolean;
}
export type ManualAutomationResult =
	| { status: 'dismissed' | 'deferred' | 'busy' | 'rule-changed' | 'save-failed' }
	| { status: 'deactivated'; names: string[] }
	| { status: 'unavailable'; plan: AutomationChangePlan }
	| { status: 'finished'; plan: AutomationChangePlan; applied: number; uncertain: number; refreshPending?: boolean };

/** Both entry points hold the same queue through confirmation, apply and the index refresh. */
export class AutomationRunner {
	private tail = Promise.resolve();
	private manualPending = false;

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.then(() => undefined, () => undefined);
		return result;
	}

	async run(id: string, ports: AutomationRunPorts): Promise<ManualAutomationResult> {
		if (this.manualPending) return { status: 'busy' };
		this.manualPending = true;
		try { return await this.enqueue(() => this.runOnce(id, ports)); }
		finally { this.manualPending = false; }
	}

	runAuto(take: () => Promise<AutoRunBatch>, ports: AutomationRunPorts): Promise<ManualAutomationResult> {
		return this.enqueue(async () => {
			const batch = await take();
			return batch.rules.size ? this.runOnce(undefined, ports, batch) : { status: 'dismissed' };
		});
	}

	private async runOnce(id: string | undefined, ports: AutomationRunPorts, batch?: AutoRunBatch): Promise<ManualAutomationResult> {
		const triggers = batch?.rules;
		let asOf = ports.now();
		const read = async () => {
			if (batch) ports.refreshBatch?.(batch);
			const settings = ports.settings();
			const rules = settings.rules.filter(item => item.active && (triggers
				? item.mode === 'auto' && triggers.has(item.id) : item.mode === 'manual' && item.id === id));
			if (!rules.length || !ports.available()) return null;
			const now = ports.now();
			if (now.slice(0, 10) !== asOf.slice(0, 10)) asOf = now;
			const plan = ports.plan(rules, settings.confirmation, asOf, triggers);
			const work = plan.changedTaskCount ? await ports.prepare(plan) : null;
			return { rules, plan, work, policy: settings.confirmation, key: JSON.stringify([rules, plan, settings.confirmation]) };
		};
		let snapshot = await read();
		let askAgain = batch?.confirmAgain ?? false;
		for (;;) {
			if (!snapshot) return { status: 'rule-changed' };
			const { rules, plan, work, key } = snapshot;
			if (plan.changedTaskCount === 0) return { status: 'finished', plan, applied: 0, uncertain: 0 };
			if (plan.changedTaskCount === null || !work) return { status: 'unavailable', plan };
			if (askAgain || plan.needsConfirmation) {
				const listed = rules.filter(rule => plan.rules.some(entry => entry.ruleId === rule.id && entry.changed));
				if (batch && ports.deferConfirmation?.(batch, askAgain)) return { status: 'deferred' };
				const decision = await ports.confirm(plan, listed, batch);
				if (decision === 'background') {
					if (batch && ports.deferConfirmation?.(batch, true)) return { status: 'deferred' };
					snapshot = await read(); askAgain = true; continue;
				}
				if (decision === 'dismiss') return { status: 'dismissed' };
				if (decision === 'replan') { snapshot = await read(); askAgain = true; continue; }
				if (decision === 'deactivate') {
					try {
						if (!ports.available() || !await ports.deactivate(listed)) return { status: 'rule-changed' };
						return { status: 'deactivated', names: listed.map(rule => rule.name) };
					}
					catch { return { status: 'save-failed' }; }
				}
			}
			const result = await ports.exclusive(async () => {
				const fresh = await read();
				if (!fresh?.work || fresh.key !== key || fresh.work.identity.length !== work.identity.length
					|| fresh.work.identity.some((value, index) => value !== work.identity[index])) return { fresh };
				const policy = fresh.policy;
				const savedRules = new Map(rules.map(rule => [rule.id, JSON.stringify(rule)]));
				const current = () => {
					try {
						const settings = ports.settings();
						return ports.available() && settings.confirmation === policy && ports.now().slice(0, 10) === asOf.slice(0, 10)
							&& rules.every(rule => (!triggers || triggers.has(rule.id)) && JSON.stringify(settings.rules.find(item => item.id === rule.id)) === savedRules.get(rule.id));
					} catch { return false; }
				};
				if (!current()) return { fresh: await read() };
				const applied = await fresh.work.apply(current);
				return { outcome: { status: 'finished' as const, plan, ...applied } };
			});
			if (result.outcome) return result.outcome;
			snapshot = result.fresh;
			askAgain = true;
		}
	}
}
