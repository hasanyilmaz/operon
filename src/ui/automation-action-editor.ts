import { App, setIcon } from 'obsidian';
import { isAutomationNativeKeyWritable, managedAutomationFieldType, readActionLiteral } from '../core/automation-action-fields';
import type { AutomationAction } from '../core/automation-rules';
import { t } from '../core/i18n';
import { parseListValue } from '../core/parser';
import { parseTaskMediaReferenceList } from '../core/task-media-reference';
import { isFilePropertyColumnKey } from '../core/raw-yaml-property';
import { composeStatusValue, resolveWorkflowStatus } from '../types/pipeline';
import type { FilterFieldType, OperonSettings } from '../types/settings';
import type { IndexedTask } from '../types/fields';
import type { FilterFieldPickerOption } from './filter-condition-editor';
import { showOperonDayPickerPopover } from './field-pickers/day-picker-popover';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { createFilterPickerTrigger, showFilterConditionPicker } from './field-pickers/filter-condition-picker';
import { showSearchableMultiOptionPicker } from './field-pickers/list-picker';
import type { TableFilePropertySnapshot } from './table/table-file-property';

export interface ActionEditorContext {
	app: App;
	settings: () => OperonSettings;
	options: () => readonly FilterFieldPickerOption[];
	native: () => TableFilePropertySnapshot | null;
	nativeType: (key: string) => FilterFieldType | null;
	tasks: () => readonly IndexedTask[];
	changed: () => void;
}

/** A missing source or unsupported literal can still be kept in an inactive draft. */
export function actionType(field: string, ctx: ActionEditorContext): FilterFieldType | null {
	if (!isFilePropertyColumnKey(field)) return managedAutomationFieldType(field, ctx.settings());
	if (!isAutomationNativeKeyWritable(field, ctx.settings())) return null;
	return ctx.nativeType(field);
}

export function validAction(action: AutomationAction, ctx: ActionEditorContext): boolean {
	const type = actionType(action.field, ctx);
	if (!type) return false;
	try {
		const literal = readActionLiteral(action, { type, native: isFilePropertyColumnKey(action.field) });
		return literal !== '' && (action.field !== 'status' || action.operation === 'remove'
			|| typeof literal === 'string' && !!resolveWorkflowStatus(ctx.settings().pipelines, literal));
	} catch { return false; }
}

function selectValue(parent: HTMLElement, label: string, value: string, values: [string, string][], change: (value: string) => void): HTMLSelectElement {
	const select = parent.createEl('select', { cls: 'operon-filter-control dropdown', attr: { 'aria-label': label } });
	select.createEl('option', { value: '', text: label });
	for (const [key, text] of values) select.createEl('option', { value: key, text });
	if (value && !values.some(([key]) => key === value)) select.createEl('option', { value, text: value });
	select.value = value;
	select.addEventListener('change', () => change(select.value));
	return select;
}

export class AutomationActionRow {
	readonly element: HTMLElement;
	private readonly field: ReturnType<typeof createFilterPickerTrigger>;
	private readonly valueHost: HTMLElement;
	private readonly operation: HTMLButtonElement;
	private readonly message: HTMLElement;
	private closePicker: (() => void) | null = null;
	private popoverOpen = false;
	private renderedType: FilterFieldType | null = null;

	constructor(container: HTMLElement, private readonly action: AutomationAction, private readonly ctx: ActionEditorContext, remove: () => void) {
		this.element = container.createDiv('operon-automation-action');
		const row = this.element.createDiv('operon-condition-row operon-automation-action-row');
		this.operation = row.createEl('button', { type: 'button', cls: 'operon-filter-modal-button is-icon' });
		this.operation.addEventListener('click', () => {
			action.operation = action.operation === 'add' ? 'remove' : 'add';
			this.renderOperation();
			ctx.changed();
		});
		this.field = createFilterPickerTrigger(row);
		this.field.button.addEventListener('click', () => {
			const fields = this.ctx.options().filter(option => !option.unavailable && actionType(option.field, this.ctx));
			this.field.button.setAttribute('aria-expanded', 'true');
			this.closePicker = showFilterConditionPicker(this.field.button, {
				value: action.field, fields,
				onSelect: option => {
					if (option.field === action.field || !actionType(option.field, this.ctx)) return;
					action.field = option.field;
					action.value = '';
					this.refreshFields();
					this.renderValue();
					this.renderOperation();
					ctx.changed();
				},
				onClose: () => {
					this.field.button.setAttribute('aria-expanded', 'false');
					this.closePicker = null;
					queueMicrotask(() => this.syncType());
				},
			});
		});
		this.valueHost = row.createDiv('operon-automation-value');
		this.valueHost.addEventListener('focusout', () => queueMicrotask(() => this.syncType()));
		const del = row.createEl('button', { type: 'button', cls: 'operon-filter-modal-button is-icon', attr: { 'aria-label': t('settings', 'automationDeleteAction') } });
		setIcon(del, 'x');
		del.addEventListener('click', remove);
		this.message = this.element.createDiv('operon-automation-diagnostic');
		this.refreshFields();
		if (!this.valueHost.firstChild) this.renderValue();
		this.renderOperation();
	}

	refreshFields(): void {
		const option = this.ctx.options().find(item => item.field === this.action.field);
		const label = option?.label || this.action.field || t('settings', 'automationField');
		this.field.label.setText(label);
		this.field.secondary.setText(option?.secondaryLabel ?? '');
		this.field.secondary.toggleClass('is-hidden', !option?.secondaryLabel);
		this.field.button.dataset.value = this.action.field;
		this.field.button.setAttribute('aria-label', t('settings', 'automationField') + ' · ' + label);
		this.syncType();
	}

	private syncType(): void {
		if (!this.element.isConnected) return;
		if (this.renderedType !== actionType(this.action.field, this.ctx) && !this.valueHost.contains(this.element.ownerDocument.activeElement) && !this.closePicker && !this.popoverOpen) {
			this.renderValue();
			this.renderOperation();
		}
	}

	private renderOperation(): void {
		const type = actionType(this.action.field, this.ctx);
		const list = type === 'list' || type === 'tags';
		const add = this.action.operation === 'add';
		const label = t('settings', list ? add ? 'automationAddMembers' : 'automationRemoveMembers' : add ? 'automationSetValue' : 'automationClearMatch');
		setIcon(this.operation, add ? 'plus' : 'minus');
		this.operation.title = label;
		this.operation.setAttribute('aria-label', label);
	}

	private renderValue(): void {
		const { action, ctx, valueHost } = this;
		const type = actionType(action.field, ctx);
		this.renderedType = type;
		valueHost.empty();
		const label = t('settings', 'automationValue');
		const raw = Array.isArray(action.value) ? action.value.join('; ') : action.value;
		const change = (value: string | string[]) => { action.value = value; ctx.changed(); };
		if (type === 'list' || type === 'tags') {
			const trigger = createFilterPickerTrigger(valueHost);
			trigger.label.setText(raw || label);
			trigger.button.setAttribute('aria-label', label + (raw ? ' · ' + raw : ''));
			trigger.button.addEventListener('click', () => {
				const native = isFilePropertyColumnKey(action.field);
				const members = Array.isArray(action.value) ? action.value : native && action.value ? [action.value] : parseListValue(action.value);
				const candidates = new Set(members);
				if (native) for (const value of ctx.native()?.getCandidates(action.field) ?? []) candidates.add(value);
				else for (const task of ctx.tasks()) {
					const items = action.field === 'tags' ? task.tags : action.field === 'blocking' || action.field === 'blockedBy'
						? [task.operonId] : action.field === 'taskGallery' ? parseTaskMediaReferenceList(task.fieldValues.taskGallery) : parseListValue(task.fieldValues[action.field] ?? '');
					for (const item of items) candidates.add(item);
				}
				trigger.button.setAttribute('aria-expanded', 'true');
				this.closePicker = showSearchableMultiOptionPicker(trigger.button, {
					title: label, placeholder: label, value: [...members], allowCustom: true,
					options: [...candidates].map(value => ({ value, label: value })),
					onPanelClose: () => {
						trigger.button.setAttribute('aria-expanded', 'false');
						this.closePicker = null;
						queueMicrotask(() => this.syncType());
					},
					onSave: values => {
						const selected = values.join('; ');
						trigger.label.setText(selected || label);
						trigger.button.setAttribute('aria-label', label + (selected ? ' · ' + selected : ''));
						change(values);
					},
				});
			});
			return;
		}
		const settings = ctx.settings();
		let choices: [string, string][] | undefined;
		if (action.field === 'checkbox') choices = [['open', t('buttons', 'open')], ['done', t('buttons', 'done')], ['cancelled', t('taskEditor', 'cancelled')]];
		else if (type === 'checkbox') choices = [['true', t('indexStats', 'diagnosticsYes')], ['false', t('indexStats', 'diagnosticsNo')]];
		else if (action.field === 'status') choices = settings.pipelines.flatMap(p => p.statuses.map(s => {
			const value = composeStatusValue(p.name, s.label);
			return [value, value] as [string, string];
		}));
		if (choices) { selectValue(valueHost, label, raw, choices, change); return; }
		const input = valueHost.createEl('input', { type: type === 'number' && (!raw || Number.isFinite(Number(raw))) ? 'number' : 'text',
			cls: 'operon-filter-control', attr: { 'aria-label': label, placeholder: label } });
		input.disabled = !type;
		input.value = raw;
		if (type === 'number') input.step = 'any';
		const update = (value: string) => { input.value = value; change(value); };
		input.addEventListener('input', () => change(input.value));
		if (type === 'date' || type === 'datetime') {
			const openPicker = () => {
				if (this.popoverOpen) return;
				this.popoverOpen = true;
				const onClose = () => { this.popoverOpen = false; queueMicrotask(() => this.syncType()); };
				if (type === 'date') showOperonDayPickerPopover(input, { app: ctx.app, value: input.value || undefined,
					weekStart: settings.calendarWeekStart, showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
					canClear: !!input.value, onClear: () => update(''), onSelect: update, onClose });
				else showDatetimePicker(input, { app: ctx.app, settings, value: input.value || undefined,
					canRemove: !!input.value, onRemove: () => update(''), onSelect: update, onClose });
			};
			input.addEventListener('focus', openPicker);
			input.addEventListener('click', openPicker);
		}
		const candidates = action.field === 'priority' ? settings.priorities.map(item => item.label)
			: isFilePropertyColumnKey(action.field) && type === 'text' ? ctx.native()?.getCandidates(action.field) : undefined;
		if (candidates?.length) {
			const list = valueHost.createEl('datalist');
			list.id = 'operon-automation-values-' + crypto.randomUUID();
			for (const value of candidates.slice(0, 500)) list.createEl('option', { value });
			input.setAttribute('list', list.id);
		}
	}

	focusField(): void { this.field.button.focus(); }
	setMessage(message: string): void { this.message.setText(message); }
	dispose(): void { this.closePicker?.(); this.element.remove(); }
}
