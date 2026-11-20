import type { AutomationChangePlan } from '../core/automation-change-plan';
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

export type AutomationDecision = 'apply' | 'dismiss' | 'deactivate';
export interface AutomationWork {
	/** Include source paths, exact before/after content and canonical pin entries. */
	identity: readonly string[];
	apply(current: () => boolean): Promise<{ applied: number; uncertain: number; refreshPending?: boolean }>;
}
interface ManualAutomationPorts {
	settings(): AutomationRulesSettings;
	now(): string;
	plan(rule: AutomationRule, confirmation: AutomationRulesSettings['confirmation'], asOf: string): AutomationChangePlan;
	prepare(plan: AutomationChangePlan): Promise<AutomationWork | null>;
	confirm(plan: AutomationChangePlan, rules: AutomationRule[]): Promise<AutomationDecision>;
	deactivate(rules: AutomationRule[]): Promise<boolean>;
	exclusive<T>(operation: () => Promise<T>): Promise<T>;
	available(): boolean;
}
export type ManualAutomationResult =
	| { status: 'dismissed' | 'busy' | 'deactivated' | 'rule-changed' | 'save-failed' }
	| { status: 'unavailable'; plan: AutomationChangePlan }
	| { status: 'finished'; plan: AutomationChangePlan; applied: number; uncertain: number; refreshPending?: boolean };

/** One outstanding Run per plugin, including time spent waiting for the modal. */
export class ManualAutomationRunner {
	private running = false;

	async run(id: string, ports: ManualAutomationPorts): Promise<ManualAutomationResult> {
		if (this.running) return { status: 'busy' };
		this.running = true;
		try { return await this.runOnce(id, ports); }
		finally { this.running = false; }
	}

	private async runOnce(id: string, ports: ManualAutomationPorts): Promise<ManualAutomationResult> {
		let asOf = ports.now();
		const read = async () => {
			const settings = ports.settings();
			const rule = settings.rules.find(item => item.id === id && item.active && item.mode === 'manual');
			if (!rule || !ports.available()) return null;
			const now = ports.now();
			if (now.slice(0, 10) !== asOf.slice(0, 10)) asOf = now;
			const plan = ports.plan(rule, settings.confirmation, asOf);
			const work = plan.changedTaskCount ? await ports.prepare(plan) : null;
			return { rule, plan, work, policy: settings.confirmation, key: JSON.stringify([rule, plan, settings.confirmation]) };
		};
		let snapshot = await read();
		let askAgain = false;
		for (;;) {
			if (!snapshot) return { status: 'rule-changed' };
			const { rule, plan, work, key } = snapshot;
			if (plan.changedTaskCount === 0) return { status: 'finished', plan, applied: 0, uncertain: 0 };
			if (plan.changedTaskCount === null || !work) return { status: 'unavailable', plan };
			if (askAgain || plan.needsConfirmation) {
				const decision = await ports.confirm(plan, [rule]);
				if (decision === 'dismiss') return { status: 'dismissed' };
				if (decision === 'deactivate') {
					try { return { status: ports.available() && await ports.deactivate([rule]) ? 'deactivated' : 'rule-changed' }; }
					catch { return { status: 'save-failed' }; }
				}
			}
			const result = await ports.exclusive(async () => {
				const fresh = await read();
				if (!fresh?.work || fresh.key !== key || fresh.work.identity.length !== work.identity.length
					|| fresh.work.identity.some((value, index) => value !== work.identity[index])) return { fresh };
				const policy = fresh.policy;
				const savedRule = JSON.stringify(rule);
				const current = () => {
					try {
						const settings = ports.settings();
						return ports.available() && settings.confirmation === policy && ports.now().slice(0, 10) === asOf.slice(0, 10)
							&& JSON.stringify(settings.rules.find(item => item.id === id)) === savedRule;
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
