import { App, setIcon } from 'obsidian';
import type { AutomationChangePlan } from '../core/automation-change-plan';
import type { AutomationRule } from '../core/automation-rules';
import { t } from '../core/i18n';
import type { AutomationDecision } from '../systems/manual-automation-run';
import { FilterPreviewModal, type FilterModalEvalDeps } from './filter-set-modal';
import { ConfirmActionModal } from './confirm-action-modal';
import { scopeSettingsModal } from './settings/settings-scope';

const pageSize = 4;
const taskCount = (count: number) => t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) });

export function automationApprovalModal(app: App, plan: AutomationChangePlan, rules: AutomationRule[],
	done: (decision: AutomationDecision) => void, cancelOnly: boolean, deps: FilterModalEvalDeps): ConfirmActionModal {
	const counts = new Map(plan.rules.map(entry => [entry.ruleId, entry]));
	const rows = rules.map(rule => ({
		name: rule.name.trim() || (cancelOnly ? t('settings', 'automationUnsavedRule') : rule.id),
		ids: counts.get(rule.id)?.directTaskIds ?? [],
	}));
	const allIds = [...new Set(rows.flatMap(row => row.ids))];
	const tasks = new Map(allIds.map(id => [id, deps.indexer.getTask(id)]));
	const actions = t('settings', 'automationActions');
	let child: FilterPreviewModal | undefined;
	let dismissed: AutomationDecision = 'dismiss';
	let closed = false;

	function previewButton(parent: HTMLElement, ids: readonly string[], name: string, inTitle = false): void {
		const button = parent.createEl('button', { type: 'button',
			cls: inTitle ? 'operon-approval-total' : 'operon-filter-count-badge', attr: { 'aria-haspopup': 'dialog', 'aria-description': name + ': ' + actions } });
		if (!inTitle) setIcon(button.createSpan('operon-count-badge-icon'), 'list');
		button.createSpan({ text: taskCount(ids.length) });
		button.addEventListener('click', () => {
			if (closed || child) return;
			child = scopeSettingsModal(new FilterPreviewModal(app, () => ({ name, section: 'changed', taskIds: ids }), deps, () => {
				child = undefined;
				if (!closed && button.isConnected) button.focus();
			}, tasks), true);
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
		cancelText: t('settings', cancelOnly ? 'automationCancelRun' : rules.length === 1 ? 'automationCancelOne' : 'automationCancelMany'),
		onCancelButton: cancelOnly ? undefined : () => { dismissed = 'deactivate'; },
	}, confirmed => {
		closed = true;
		child?.close();
		done(confirmed ? 'apply' : dismissed);
	});
	modal.modalEl.addClass('operon-automation-approval');
	return scopeSettingsModal(modal, true);
}
