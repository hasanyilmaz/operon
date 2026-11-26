import { App, Notice } from 'obsidian';
import { AUTOMATION_CONFIRMATIONS, createAutomationRuleId, readAutomationRules, type AutomationConfirmation, type AutomationRule, type AutomationRulesSettings } from '../../core/automation-rules';
import { t } from '../../core/i18n';
import type { OperonStorage } from '../../storage/operon-storage';
import { AutomationRuleModal, type AutomationEditorSource } from '../automation-rule-modal';
import { cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { ConfirmActionModal } from '../confirm-action-modal';
import { createSettingsListCard, createSettingsListCardActionButton, createSettingsListCardChip } from './settings-list-ui';
import { scopeSettingsModal } from './settings-scope';
import { createSettingsAddButton } from './settings-ui';

// Non-integer option keys keep the two named choices on either end of an HTML dropdown.
export function automationOptionKey(option: AutomationConfirmation): string {
	return typeof option === 'number' ? 'over-' + option : option;
}

export function automationConfirmationOptions(): Record<string, string> {
	return Object.fromEntries(AUTOMATION_CONFIRMATIONS.map(option => [
		automationOptionKey(option), option === 'always' ? t('settings', 'automationAlwaysAsk')
			: option === 'none' ? t('settings', 'automationNoLimit') : String(option),
	]));
}

export function mountAutomationRules(app: App, el: HTMLElement, storage: RulesStorage & Pick<OperonStorage, 'subscribeAutomationRules'>, source: AutomationEditorSource): () => void {
	const render = () => renderAutomationRules(app, el, storage, source);
	render();
	const unsubscribe = storage.subscribeAutomationRules(render);
	const owner = el.ownerDocument.defaultView;
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		owner?.removeEventListener('pagehide', dispose);
		unsubscribe();
		cleanupOperonHoverTooltips(el);
	};
	// Obsidian may destroy a settings window without disposing its rendered rows.
	owner?.addEventListener('pagehide', dispose);
	return dispose;
}

type RulesStorage = Pick<OperonStorage, 'getSettings' | 'saveAutomationRules' | 'saveAutomationRule'>;

async function commitRules(storage: RulesStorage, snapshot: AutomationRulesSettings, next: AutomationRule[]): Promise<boolean> {
	try {
		const currentRaw = storage.getSettings().automationRules;
		const current = readAutomationRules(currentRaw);
		if (JSON.stringify(current.rules) !== JSON.stringify(snapshot.rules)) throw new Error('Automation rule list changed');
		await storage.saveAutomationRules(currentRaw, { ...current, rules: next });
	} catch (error) {
		console.error('Operon: Automation rule save failed', error);
		new Notice(t('settings', 'automationSaveFailed'));
		return false;
	}
	return true;
}

export function openAutomationEditor(app: App, storage: RulesStorage, source: AutomationEditorSource, id?: string): void {
	let snapshot: AutomationRulesSettings;
	try { snapshot = readAutomationRules(storage.getSettings().automationRules); }
	catch { new Notice(t('settings', 'automationUnavailable')); return; }
	const existing = snapshot.rules.find(rule => rule.id === id);
	if (id !== undefined && !existing) { new Notice(t('settings', 'uriRuleMissing')); return; }
	scopeSettingsModal(new AutomationRuleModal(app, source, existing, async draft => {
		await storage.saveAutomationRule(existing, draft);
		return true;
	}), true).open();
}

function renderAutomationRules(app: App, el: HTMLElement, storage: RulesStorage, source: AutomationEditorSource): void {
	cleanupOperonHoverTooltips(el);
	el.empty();
	const expected = storage.getSettings().automationRules;
	let snapshot: AutomationRulesSettings;
	try {
		snapshot = readAutomationRules(expected);
	} catch {
		el.createEl('p', { text: t('settings', 'automationUnavailable') });
		return;
	}
	const { rules } = snapshot;
	const section = el.createDiv('operon-automation-rules-settings-list operon-settings-add-list-section operon-settings-card-list-section');
	section.createEl('p', {
		cls: 'operon-settings-muted-block',
		text: t('settings', 'automationRuleListDesc'),
	});
	const list = section.createDiv('operon-filter-set-list');
	for (const [index, rule] of rules.entries()) {
		const card = createSettingsListCard({ containerEl: list, icon: 'cog', title: rule.name, className: 'operon-filter-set-card' });
		createSettingsListCardChip({ containerEl: card.metaEl, label: rule.mode === 'auto' ? t('settings', 'automationAuto') : t('settings', 'pinnedTaskSortModeManual') });
		createSettingsListCardChip({ containerEl: card.metaEl, label: rule.active ? t('settings', 'automationActive') : t('settings', 'automationInactive') });
		for (const offset of [-1, 1]) {
			const to = index + offset;
			const label = offset < 0 ? t('settings', 'moveUp') : t('settings', 'moveDown');
			createSettingsListCardActionButton({ containerEl: card.actionsEl, label, ariaLabel: label + ' · ' + rule.name,
				icon: offset < 0 ? 'arrow-up' : 'arrow-down', disabled: to < 0 || to >= rules.length,
				onClick: async () => {
					const next = [...rules];
					[next[index], next[to]] = [next[to], next[index]];
					await commitRules(storage, snapshot, next);
				} });
		}
		const button = (icon: string, label: string, onClick: () => void | Promise<void>): void => {
			createSettingsListCardActionButton({ containerEl: card.actionsEl, label, icon, ariaLabel: label + ' · ' + rule.name, onClick });
		};
		button('pencil', t('settings', 'automationEditRule'), () => openAutomationEditor(app, storage, source, rule.id));
		button('copy', t('table', 'duplicatePreset'), async () => {
			const copy = { ...structuredClone(rule), id: createAutomationRuleId(rules), name: t('settings', 'automationCopyName', { name: rule.name }), active: false };
			await commitRules(storage, snapshot, [...rules.slice(0, index + 1), copy, ...rules.slice(index + 1)]);
		});
		button('trash-2', t('filterSets', 'deleteFilterConfirm'), () => {
			scopeSettingsModal(new ConfirmActionModal(app, {
				operonTooltips: true,
				title: t('settings', 'automationDelete', { name: rule.name }), message: rule.name, danger: true, initialFocus: 'cancel',
				confirmText: t('filterSets', 'deleteFilterConfirm'), cancelText: t('buttons', 'cancel'),
			}, confirmed => { if (confirmed) void commitRules(storage, snapshot, rules.filter(item => item.id !== rule.id)); }), true).open();
		});
	}
	const addRow = section.createDiv('operon-settings-add-row');
	createSettingsAddButton(addRow, t('settings', 'automationAddRule')).addEventListener('click', () => openAutomationEditor(app, storage, source));
}
