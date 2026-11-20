import { App, Notice } from 'obsidian';
import type { AutomationChangePlan } from '../core/automation-change-plan';
import type { AutomationRule } from '../core/automation-rules';
import { t } from '../core/i18n';
import type { AutomationDecision, ManualAutomationResult } from '../systems/manual-automation-run';
import { automationIssueLabels } from './automation-rule-modal';
import { ConfirmActionModal } from './confirm-action-modal';
import { scopeSettingsModal } from './settings/settings-scope';

export function automationApprovalModal(app: App, plan: AutomationChangePlan, rules: AutomationRule[],
	done: (decision: AutomationDecision) => void): ConfirmActionModal {
	let dismissed: AutomationDecision = 'dismiss';
	const count = plan.changedTaskCount ?? 0;
	return scopeSettingsModal(new ConfirmActionModal(app, {
		title: t('settings', 'automationConfirmCount', { count: String(count) }),
		message: '',
		detailsTable: plan.rules.filter(entry => entry.changed).map(entry => ({
			label: rules.find(rule => rule.id === entry.ruleId)?.name ?? entry.ruleId,
			before: t('filterSets', entry.changed === 1 ? 'taskCountWithLeadingSpaceOne' : 'taskCountWithLeadingSpaceMany', { count: String(entry.changed) }).trim(),
			after: '',
		})),
		confirmText: t('settings', 'automationApply'),
		cancelText: t('settings', rules.length === 1 ? 'automationCancelOne' : 'automationCancelMany'),
		onCancelButton: () => { dismissed = 'deactivate'; },
	}, confirmed => done(confirmed ? 'apply' : dismissed)), true);
}

export function showAutomationResult(result: ManualAutomationResult, automatic: boolean, ruleNames: ReadonlyMap<string, string>): void {
	if (result.status === 'busy' || result.status === 'dismissed' || automatic && result.status === 'finished' && result.plan.changedTaskCount === 0 && !result.plan.issues.length) return;
	if (result.status === 'save-failed') { new Notice(t('settings', 'automationSaveFailed')); return; }
	if (result.status === 'deactivated') {
		new Notice(result.names.map(name => t('settings', 'automationDeactivated', { name })).join('\n'));
		return;
	}
	if (result.status !== 'finished' && result.status !== 'unavailable') { new Notice(t('settings', 'automationRetry')); return; }
	const remaining = result.status === 'finished' ? (result.plan.changedTaskCount ?? 0) - result.applied - result.uncertain : 0;
	const lines = [result.status === 'unavailable' ? t('settings', 'automationRetry') : t('settings', remaining || result.uncertain ? 'automationStopped' : 'automationApplied', {
		applied: String(result.applied), remaining: String(remaining), uncertain: String(result.uncertain),
	})];
	const reasons = new Map<string, Set<string>>();
	for (const issue of result.plan.issues) {
		const label = t('settings', automationIssueLabels[issue.reason]);
		const rules = issue.reason === 'conflict' ? new Set(issue.origins?.map(origin => ruleNames.get(origin.ruleId) ?? origin.ruleId)) : [];
		const field = [issue.taskId, issue.field, ...rules].filter(Boolean).join(' · ');
		const details = reasons.get(label) ?? new Set<string>();
		if (field) details.add(field);
		reasons.set(label, details);
	}
	for (const [label, details] of reasons) {
		const examples = [...details].slice(0, 3);
		lines.push([label, ...examples, ...(details.size > examples.length ? ['+' + (details.size - examples.length)] : [])].join(' · '));
	}
	if (result.status === 'finished' && result.refreshPending) lines.push(t('notifications', 'taskChangeAppliedRefreshPending'));
	new Notice(lines.join('\n'));
}
