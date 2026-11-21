import { App, setIcon } from 'obsidian';
import type { AutomationChangePlan } from '../core/automation-change-plan';
import type { AutomationRule } from '../core/automation-rules';
import { t } from '../core/i18n';
import type { AutomationDecision } from '../systems/manual-automation-run';
import type { IndexedTask } from '../types/fields';
import { groupAutomationPreviewTasks } from './automation-task-preview';
import { ConfirmActionModal } from './confirm-action-modal';
import { scopeSettingsModal } from './settings/settings-scope';

const pageSize = 4;
const taskCount = (count: number) => t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) });

/** An approval only exposes text from the planned tasks; it has no task interaction callbacks. */
function renderReadOnlyTasks(content: HTMLElement, groups: ReturnType<typeof groupAutomationPreviewTasks>, count: number): void {
	const list = content.createDiv('operon-embed-list operon-filter-list operon-approval-preview');
	list.createDiv({ cls: 'operon-embed-count', text: taskCount(count) });
	if (!groups || !count) {
		list.createDiv({ cls: 'operon-embed-empty', text: groups ? t('settings', 'automationChangedMany', { count: '0' }) : t('settings', 'automationUnknown') });
		return;
	}
	for (const group of groups.groups) {
		const header = list.createDiv('operon-group-header');
		header.createSpan({ cls: 'operon-group-header-label', text: t('settings', 'automationModifiedGroup', { date: group.label || t('filterSets', 'groupEmpty') }) });
		header.createSpan({ cls: 'operon-group-header-count', text: String(group.count) });
		for (const task of group.tasks) {
			const row = list.createDiv('operon-approval-task');
			row.createSpan({ text: task.description || task.operonId });
			if (task.fieldValues.priority) row.createSpan({ cls: 'operon-approval-priority', text: task.fieldValues.priority });
		}
	}
}

export function automationApprovalModal(app: App, plan: AutomationChangePlan, rules: AutomationRule[],
	done: (decision: AutomationDecision) => void, draftRun: boolean, getTask: (id: string) => IndexedTask | undefined,
	priorities: { label: string }[]): ConfirmActionModal {
	const counts = new Map(plan.rules.map(entry => [entry.ruleId, entry]));
	const rows = rules.map(rule => ({
		name: rule.name.trim() || (draftRun ? t('settings', 'automationUnsavedRule') : rule.id),
		ids: counts.get(rule.id)?.directTaskIds ?? [],
	}));
	const allIds = [...new Set(rows.flatMap(row => row.ids))];
	const tasks = new Map(allIds.map(id => [id, getTask(id)]));
	const actions = t('settings', 'automationActions');
	let child: ConfirmActionModal | undefined;
	let dismissed: AutomationDecision = 'dismiss';
	let closed = false;

	function previewButton(parent: HTMLElement, ids: readonly string[], name: string, inTitle = false): void {
		const button = parent.createEl('button', { type: 'button',
			cls: inTitle ? 'operon-approval-total' : 'operon-filter-count-badge', attr: { 'aria-haspopup': 'dialog', 'aria-description': name + ': ' + actions } });
		if (!inTitle) setIcon(button.createSpan('operon-count-badge-icon'), 'list');
		button.createSpan({ text: taskCount(ids.length) });
		button.addEventListener('click', () => {
			if (closed || child) return;
			const groups = groupAutomationPreviewTasks(ids, id => tasks.get(id), priorities);
			child = scopeSettingsModal(new ConfirmActionModal(app, {
				title: name + ': ' + actions, message: '', readOnly: true, operonTooltips: true,
				dismissText: t('buttons', 'close'),
				renderDetails: content => renderReadOnlyTasks(content, groups, ids.length),
			}, () => {
				child = undefined;
				if (!closed && button.isConnected) button.focus();
			}), true);
			child.open();
		});
	}

	const modal = new ConfirmActionModal(app, {
		operonTooltips: true, title: '', message: '',
		renderDetails: (content, title) => {
			const marker = '{tasks}';
			const [before, after] = t('settings', 'automationConfirmCount', { count: marker }).split(marker);
			title.createSpan({ text: before });
			previewButton(title, allIds, rows.length === 1 ? rows[0].name : t('settings', 'automationRuleList'), true);
			title.createSpan({ text: after });
			const list = content.createDiv('operon-approval-rules');
			let page = 0;
			const drawRows = () => {
				list.empty();
				for (const { name, ids } of rows.slice(page * pageSize, (page + 1) * pageSize)) {
					const row = list.createDiv('operon-approval-row');
					setIcon(row.createSpan('operon-approval-rule-icon'), 'cog');
					row.createSpan({ cls: 'operon-approval-rule-name', text: name });
					previewButton(row, ids, name);
				}
			};
			drawRows();
			if (rows.length <= pageSize) return;
			const pager = content.createDiv('operon-approval-pages');
			const range = pager.createSpan({ attr: { 'aria-live': 'polite' } });
			const previous = pager.createEl('button', { type: 'button', attr: { 'aria-label': t('settings', 'automationPreviousPage') } });
			const next = pager.createEl('button', { type: 'button', attr: { 'aria-label': t('settings', 'automationNextPage') } });
			setIcon(previous, 'chevron-left');
			setIcon(next, 'chevron-right');
			const updatePage = () => {
				range.setText((page * pageSize + 1) + '–' + Math.min((page + 1) * pageSize, rows.length) + ' / ' + rows.length);
				previous.disabled = page === 0;
				next.disabled = (page + 1) * pageSize >= rows.length;
			};
			previous.addEventListener('click', () => { page--; drawRows(); updatePage(); if (previous.disabled) next.focus(); });
			next.addEventListener('click', () => { page++; drawRows(); updatePage(); if (next.disabled) previous.focus(); });
			updatePage();
		},
		confirmText: t('settings', 'automationApply'),
		cancelText: t('settings', draftRun ? 'automationCancelRun' : rules.length === 1 ? 'automationCancelOne' : 'automationCancelMany'),
		onCancelButton: draftRun ? undefined : () => { dismissed = 'deactivate'; },
	}, confirmed => {
		closed = true;
		child?.close();
		done(confirmed ? 'apply' : dismissed);
	});
	modal.modalEl.addClass('operon-automation-approval');
	return scopeSettingsModal(modal, true);
}
