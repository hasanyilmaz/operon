import { Notice } from 'obsidian';
import { t } from '../core/i18n';
import type { ManualAutomationResult } from '../systems/manual-automation-run';
import { automationIssueLabels, unavailableProjectGroupText } from './automation-rule-modal';
export { automationApprovalModal } from './automation-approval-modal';

export function showAutomationResult(result: ManualAutomationResult, automatic: boolean, ruleNames: ReadonlyMap<string, string>): void {
	if (result.status === 'busy' || result.status === 'deferred' || result.status === 'dismissed' || automatic && result.status === 'finished' && result.plan.affectedTaskCount === 0 && !result.plan.issues.length) return;
	if (result.status === 'save-failed') { new Notice(t('settings', 'automationSaveFailed')); return; }
	if (result.status === 'deactivated') {
		new Notice(result.names.map(name => t('settings', 'automationDeactivated', { name })).join('\n'));
		return;
	}
	if (result.status !== 'finished' && result.status !== 'unavailable') { new Notice(t('settings', 'automationRetry')); return; }
	const remaining = result.status === 'finished' ? (result.plan.affectedTaskCount ?? 0) - result.applied - result.uncertain : 0;
	const lines = [result.status === 'unavailable' ? t('settings', 'automationRetry') : t('settings', remaining || result.uncertain ? 'automationStopped' : 'automationApplied', {
		applied: String(result.applied), remaining: String(remaining), uncertain: String(result.uncertain),
	})];
	if (result.status === 'unavailable') {
		const names = result.plan.rules.map(rule => ruleNames.get(rule.ruleId) ?? rule.ruleId);
		if (names.length) lines.push(names.join(', '));
		if (result.reason === 'index-pending') lines.push(t('settings', 'pipelineRenamePhaseReindexPending'));
		else if (result.reason === 'source-conflict') lines.push(t('taskEditor', 'filePropertiesUnavailable'));
	}
	const reasons = new Map<string, Set<string>>();
	for (const issue of result.plan.issues) {
		const label = issue.reason === 'ambiguous-property' ? t('taskEditor', 'filePropertiesUnavailable') : t('settings', automationIssueLabels[issue.reason]);
		const rules = issue.reason === 'conflict' ? new Set(issue.origins?.map(origin => ruleNames.get(origin.ruleId) ?? origin.ruleId)) : [];
		const field = issue.projectSerialGroupId && issue.ruleId
			? [ruleNames.get(issue.ruleId) ?? issue.ruleId, unavailableProjectGroupText(issue)].join(' · ')
			: [issue.taskId, issue.field, ...rules].filter(Boolean).join(' · ');
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
