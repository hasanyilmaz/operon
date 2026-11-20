import { App, Modal, Notice } from 'obsidian';
import type { AutomationChangePlan, AutomationPlanIssue } from '../core/automation-change-plan';
import { createAutomationActionId, createAutomationProjectSerialValidator, createAutomationRule, readAutomationRules, type AutomationAction, type AutomationRule } from '../core/automation-rules';
import { getOwnerWindow } from '../core/dom-compat';
import { DATE_OPERATORS, getOperatorsForField, NO_VALUE_OPERATORS, NUMERIC_INPUT_DATE_OPERATORS } from '../core/filter-display';
import { t } from '../core/i18n';
import { isTaskDataType, TASK_DATA_TYPE_FIELD_KEY } from '../core/task-data-type';
import { isValidTrackedOnCondition } from '../core/tracked-on-filter';
import { decodeVaultPropertyValue } from '../core/vault-property-codec';
import type { IndexedTask } from '../types/fields';
import type { FilterFieldType, FilterGroup, OperonSettings } from '../types/settings';
import { AutomationActionRow, expandListAction, validAction, type ActionEditorContext } from './automation-action-editor';
import { bindOperonSurfaceTooltips } from './operon-surface-tooltips';
import { bindFilterGroupInteractionState } from './surface-interaction-state';
import { FilterConditionEditor, FilterFieldCatalog, flattenConditions, type FilterFieldPickerOption } from './filter-condition-editor';
import { closeFloatingPanelsForRoot, requestFloatingPanelCloseForRoot } from './field-pickers/common';
import type { TableFilePropertySnapshot } from './table/table-file-property';

export interface AutomationEditorSource {
	getSettings: () => OperonSettings;
	getTasks: () => readonly IndexedTask[];
	getNativeSnapshot(): TableFilePropertySnapshot | null;
	subscribe(listener: () => void): () => void;
	plan(rule: AutomationRule): AutomationChangePlan | undefined;
}

function completeConditions(group: FilterGroup, fields: ReadonlyMap<string, FilterFieldPickerOption>, invalidProjectGroup: ReturnType<typeof createAutomationProjectSerialValidator>): boolean {
	return flattenConditions(group).every(condition => {
		const { field, fieldType, operator, value = '' } = condition;
		const option = fields.get(field);
		if (option?.type !== fieldType || option.unavailable || !getOperatorsForField(field, fieldType, true).some(op => op.id === operator)) return false;
		if (field === 'trackedOn') return isValidTrackedOnCondition(condition, DATE_OPERATORS.map(op => op.id));
		if (NO_VALUE_OPERATORS.has(operator)) return true;
		if (field === TASK_DATA_TYPE_FIELD_KEY) return isTaskDataType(value);
		if (operator === 'isAnyOf' || operator === 'isNoneOf') return !invalidProjectGroup(condition);
		if (!value.trim()) return false;
		if (NUMERIC_INPUT_DATE_OPERATORS.has(operator) || operator.startsWith('count')) {
			const number = Number(value);
			if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number)) return false;
			if (operator.startsWith('month')) return number >= 1 && number <= 12;
			return !operator.startsWith('dayOfWeek') || number <= 6;
		}
		if (fieldType === 'number' || fieldType === 'date' || fieldType === 'datetime') {
			// Filters accept a calendar date as a boundary for a datetime field.
			const literalType = fieldType === 'datetime' && value.length === 10 ? 'date' : fieldType;
			try { decodeVaultPropertyValue(value, literalType); } catch { return false; }
			if (operator === 'divisible' || operator === 'notDivisible') return Number(value) !== 0;
		}
		return true;
	});
}

export const automationIssueLabels: Record<AutomationPlanIssue['reason'], string> = {
	conflict: 'automationConflict', blocked: 'automationBlocked', 'invalid-value': 'automationInvalid',
	'read-only': 'automationFilterOnly', 'invalid-relation': 'automationRelation',
	'unsupported-source': 'taskRelationsUnavailable', 'source-unavailable': 'taskRelationsUnavailable',
	'dependent-effect-unavailable': 'automationUnknown', 'index-unavailable': 'automationUnknown', 'condition-unavailable': 'automationUnknown',
};

export function unavailableProjectGroupText(issue: AutomationPlanIssue): string {
	return [t('settings', issue.field === 'scope' ? 'automationScope' : 'automationTarget'),
		t('filterSets', 'fieldProjectSerialGroup'), issue.projectSerialGroupId, t('settings', 'taskRelationsUnavailable')].join(' · ');
}

export class AutomationRuleModal extends Modal {
	private readonly draft: AutomationRule;
	private readonly usedActionIds: Set<string>;
	private readonly fields: FilterFieldCatalog;
	private readonly actionContext: ActionEditorContext;
	private readonly editors: FilterConditionEditor[] = [];
	private readonly rows = new Map<string, AutomationActionRow>();
	private readonly counters = new Map<'scope' | 'target', HTMLElement>();
	private options: FilterFieldPickerOption[] = [];
	private native: TableFilePropertySnapshot | null = null;
	private nativeTypes = new Map<string, FilterFieldType>();
	private section!: HTMLElement;
	private summary!: HTMLElement;
	private save!: HTMLButtonElement;
	private timer?: number;
	private unbindTooltips?: () => void;
	private unbindActions?: () => void;
	private unsubscribe?: () => void;
	private pending = false;
	private closed = false;
	private fieldsDirty = false;

	constructor(app: App, private readonly source: AutomationEditorSource, private readonly existing: AutomationRule | undefined,
		private readonly persist: (rule: AutomationRule) => Promise<boolean>) {
		super(app);
		this.draft = existing ? structuredClone(existing) : createAutomationRule('', readAutomationRules(source.getSettings().automationRules).rules);
		this.usedActionIds = new Set(this.draft.actions.map(action => action.id));
		this.fields = new FilterFieldCatalog({ keyMappings: source.getSettings().keyMappings, getSettings: source.getSettings,
			getRootGroup: () => ({ ...this.draft.scope, children: [this.draft.scope, this.draft.target] }),
			getLayoutFields: () => this.draft.actions.map(action => action.field),
			getFilePropertySnapshot: () => this.native, getProjectSerialScopeTasks: source.getTasks });
		this.actionContext = { app, settings: source.getSettings, tasks: source.getTasks, native: () => this.native,
			nativeType: key => this.nativeTypes.get(key) ?? null, options: () => this.options, changed: () => this.changed() };
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass('operon-filter-set-modal-shell');
		this.contentEl.addClass('operon-filter-set-modal', 'operon-automation-rule-editor');
		this.contentEl.createEl('h3', { cls: 'operon-filter-modal-title', text: t('settings', this.existing ? 'automationEditRule' : 'automationAddRule') });
		const section = this.contentEl.createDiv('operon-filter-form-section operon-filter-name-section');
		const row = section.createDiv('operon-filter-form-row operon-filter-name-row');
		const label = t('settings', 'automationName');
		row.createDiv({ cls: 'operon-filter-form-label', text: label });
		const name = row.createDiv('operon-filter-form-control').createEl('input', { cls: 'operon-filter-name-input',
			type: 'text', value: this.draft.name, attr: { 'aria-label': label } });
		name.addEventListener('input', () => { this.draft.name = name.value; this.updateSave(); });
		this.loadFields();
		for (const key of ['scope', 'target'] as const) {
			const count = this.contentEl.ownerDocument.win.createSpan();
			count.className = 'operon-automation-count';
			this.counters.set(key, count);
			const editor = new FilterConditionEditor({ app: this.app, rootGroup: this.draft[key], fields: this.fields,
				title: t('settings', key === 'scope' ? 'automationScope' : 'automationTarget'), rootFooterStatus: count,
				pickerPresentation: 'floating', preserveUnknownValues: true, onChange: () => this.changed() });
			this.editors.push(editor);
			editor.mount(this.contentEl);
		}
		const actionsSection = this.contentEl.createDiv('operon-filter-section');
		const card = actionsSection.createDiv('operon-filter-group-card is-root');
		this.unbindActions = bindFilterGroupInteractionState(actionsSection);
		const header = card.createDiv('operon-filter-group-header').createDiv('operon-filter-group-heading');
		header.createEl('strong', { cls: 'operon-filter-group-title', text: t('settings', 'automationActions') });
		this.section = card.createDiv('operon-automation-actions');
		this.draft.actions = this.draft.actions.flatMap(action => expandListAction(action, this.actionContext, this.usedActionIds));
		for (const action of this.draft.actions) this.mountAction(action);
		const add = card.createDiv('operon-filter-group-footer').createEl('button', { type: 'button', cls: 'operon-filter-modal-button operon-filter-modal-add-button',
			text: '+ ' + t('settings', 'automationAddAction') });
		add.addEventListener('click', () => {
			const action: AutomationAction = { id: createAutomationActionId(this.usedActionIds), field: '', operation: 'add', value: '' };
			this.draft.actions.push(action);
			this.mountAction(action).focusField();
			this.changed();
		});
		const footer = this.contentEl.createDiv('operon-filter-footer');
		this.summary = footer.createDiv('operon-filter-footer-left operon-automation-count');
		this.summary.setAttribute('role', 'status');
		const controls = footer.createDiv('operon-filter-footer-primary-actions');
		controls.createEl('button', { type: 'button', cls: 'operon-filter-modal-button operon-filter-modal-add-button', text: t('buttons', 'cancel') }).addEventListener('click', () => this.close());
		const dropdown = (title: string, value: string, options: [string, string][], set: (v: string) => void) => {
			const select = controls.createEl('select', { cls: 'dropdown operon-filter-select', attr: { 'aria-label': title } });
			for (const [key, text] of options) select.createEl('option', { value: key, text });
			select.value = value;
			select.addEventListener('change', () => { set(select.value); this.updateSave(); });
		};
		dropdown(t('settings', 'automationMode'), this.draft.mode, [['manual', t('settings', 'pinnedTaskSortModeManual')], ['auto', t('settings', 'automationAuto')]],
			mode => { this.draft.mode = mode === 'auto' ? 'auto' : 'manual'; });
		dropdown(t('settings', 'automationState'), String(this.draft.active), [['false', t('settings', 'automationInactive')], ['true', t('settings', 'automationActive')]],
			state => { this.draft.active = state === 'true'; this.schedule(); });
		this.save = controls.createEl('button', { type: 'button', cls: 'operon-filter-modal-button operon-filter-modal-add-button', text: t('settings', 'automationSaveRule') });
		this.save.addEventListener('click', () => { void this.submit(); });
		this.scope.register([], 'Escape', event => {
			if (!requestFloatingPanelCloseForRoot(this.contentEl, 'escape', true) && !this.editors.some(e => e.closeFolderDropdown())) this.close();
			event.preventDefault();
			return false;
		});
		this.unsubscribe = this.source.subscribe(() => { this.fieldsDirty = true; this.schedule(); });
		this.updateCounts();
		name.focus();
		this.unbindTooltips = bindOperonSurfaceTooltips(this.modalEl);
	}

	private loadFields(): void {
		this.native = this.source.getNativeSnapshot();
		this.nativeTypes = new Map(this.native?.fields.filter(field => !field.unavailable && !field.readonly).map(field => [field.key, field.type]));
		this.options = this.fields.getFieldOptions(true, false, false, true);
	}
	private mountAction(action: AutomationAction): AutomationActionRow {
		const row = new AutomationActionRow(this.section, action, this.actionContext, () => {
			this.draft.actions = this.draft.actions.filter(item => item.id !== action.id);
			this.rows.delete(action.id);
			row.dispose();
			this.changed();
		});
		this.rows.set(action.id, row);
		return row;
	}
	private refresh(): void {
		if (this.fieldsDirty) {
			this.fieldsDirty = false;
			this.loadFields();
			this.draft.actions = this.draft.actions.flatMap(action => {
				const row = this.rows.get(action.id);
				const expanded = expandListAction(action, this.actionContext, this.usedActionIds);
				if (expanded.length > 1 && row) {
					for (const member of expanded) row.element.before(this.mountAction(member).element);
					row.dispose();
				} else {
					row?.refreshFields();
				}
				return expanded;
			});
		}
		this.updateCounts();
	}
	private schedule(): void {
		const win = getOwnerWindow(this.contentEl);
		win.clearTimeout(this.timer);
		this.timer = win.setTimeout(() => { if (!this.closed) this.refresh(); }, 140);
	}
	private changed(): void {
		this.updateSave();
		this.schedule();
	}
	private chosen(): AutomationAction[] { return this.draft.actions.filter(action => action.field); }
	private conditionValidity(): boolean[] {
		const options = new Map(this.options.map(option => [option.field, option]));
		const invalidProjectGroup = createAutomationProjectSerialValidator(this.source.getSettings().projectSerialScopes);
		return (['scope', 'target'] as const).map((key, index) => !this.editors[index].validationError
			&& completeConditions(this.draft[key], options, invalidProjectGroup));
	}
	private canSave(): boolean {
		if (!this.draft.name.trim() || this.editors.some(e => e.hasInvalidRawValues)) return false;
		if (!this.draft.active) return true;
		const actions = this.chosen();
		return this.conditionValidity().every(Boolean) && actions.length > 0 && actions.every(action => validAction(action, this.actionContext));
	}
	private updateSave(): void {
		if (this.save) this.save.disabled = this.pending || !this.canSave();
	}
	private updateCounts(): void {
		const chosen = this.chosen();
		const valid = chosen.filter(action => validAction(action, this.actionContext));
		let plan: AutomationChangePlan | undefined;
		try { plan = this.source.plan({ ...this.draft, actions: valid }); }
		catch (error) { console.warn('Operon: could not calculate automation changes', error); }
		const [scopeValid, targetValid] = this.conditionValidity();
		const count = plan?.rules[0];
		for (const [key, node] of this.counters) {
			const value = scopeValid && (key === 'scope' || targetValid) ? count?.[key] : null;
			node.setText(value == null ? t('settings', 'automationUnknown') : t('filterSets',
				value === 1 ? 'taskCountWithLeadingSpaceOne' : 'taskCountWithLeadingSpaceMany', { count: String(value) }).trim());
		}
		const messages = new Map<string, Set<string>>();
		for (const issue of plan?.issues ?? []) for (const origin of issue.origins ?? []) {
			let group = messages.get(origin.actionId);
			if (!group) { group = new Set(); messages.set(origin.actionId, group); }
			group.add(t('settings', automationIssueLabels[issue.reason]));
		}
		for (const action of chosen) {
			if (valid.includes(action)) continue;
			messages.set(action.id, new Set([t('settings', action.value.length ? 'automationInvalid' : 'automationCompleteAction')]));
		}
		for (const [id, row] of this.rows) row.setMessage([...(messages.get(id) ?? [])].join(' · '));
		const total = plan?.changedTaskCount;
		const missingGroup = plan?.issues.find(issue => issue.projectSerialGroupId);
		this.summary.setText(missingGroup ? unavailableProjectGroupText(missingGroup)
			: valid.length !== chosen.length || (!chosen.length && (this.rows.size > 0 || this.draft.active)) ? t('settings', 'automationCompleteAction')
			: !scopeValid || !targetValid ? t('settings', 'automationCompleteCondition')
			: total == null ? t('settings', 'automationUnknown')
			: t('settings', total === 1 ? 'automationChangedOne' : 'automationChangedMany', { count: String(total) }));
		this.updateSave();
	}

	private async submit(): Promise<void> {
		if (this.pending) return;
		if (this.fieldsDirty) this.refresh();
		if (!this.canSave()) return;
		this.pending = true;
		this.contentEl.inert = true;
		this.updateSave();
		let saved = false;
		try { saved = await this.persist(structuredClone({ ...this.draft, name: this.draft.name.trim(), actions: this.chosen() })); }
		catch { new Notice(t('settings', 'automationSaveFailed')); }
		finally { this.pending = false; this.contentEl.inert = false; this.updateSave(); }
		if (saved) this.close();
	}

	close(): void { if (!this.pending) super.close(); }

	onClose(): void {
		this.closed = true;
		this.unbindTooltips?.();
		this.unbindActions?.();
		this.unsubscribe?.();
		getOwnerWindow(this.contentEl).clearTimeout(this.timer);
		closeFloatingPanelsForRoot(this.contentEl);
		for (const editor of this.editors) editor.unmount();
		for (const row of this.rows.values()) row.dispose();
		this.rows.clear();
		this.contentEl.empty();
	}
}
