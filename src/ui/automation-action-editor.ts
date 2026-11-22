import { App, setIcon } from 'obsidian';
import { automationTypedListMapping, readAutomationListMembers, isAutomationNativeKeyWritable, managedAutomationFieldType, readActionLiteral } from '../core/automation-action-fields';
import { createAutomationActionId, type AutomationAction } from '../core/automation-rules';
import { t } from '../core/i18n';
import { formatCompactDatetimeTime, formatUiTaskDatetime } from '../core/ui-time-format';
import { parseRepeatRule } from '../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { showRepeatPicker } from './field-pickers/repeat-picker';
import { parseListValue } from '../core/parser';
import { isFilePropertyColumnKey } from '../core/raw-yaml-property';
import { resolveWorkflowStatus } from '../types/pipeline';
import type { FilterFieldType, OperonSettings } from '../types/settings';
import type { IndexedTask } from '../types/fields';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import type { FilterFieldPickerOption } from './filter-condition-editor';
import { automationDateLabel } from './field-pickers/automation-date-options';
import { resolveDatePickerLanguage } from './field-pickers/date-nlp';
import { showDatePicker } from './field-pickers/date-picker';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { createFilterPickerTrigger, showFilterConditionPicker } from './field-pickers/filter-condition-picker';
import { decodeVaultPropertyList, encodeVaultPropertyValue } from '../core/vault-property-codec';
import { showCustomListFieldPicker } from './field-pickers/custom/custom-list-field-picker';
import { showDependencyTaskPicker } from './field-pickers/dependency-task-picker';
import { showReminderRulesPicker } from './field-pickers/reminder-picker';
import { formatReminderDisplayItem } from './reminder-display';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { collectCustomFieldValueCandidates, collectNativeFieldValueCandidates, getCustomFieldMapping } from './custom-field-surfaces';
import type { TableFilePropertySnapshot } from './table/table-file-property';

export interface ActionEditorContext {
	app: App;
	settings: () => OperonSettings;
	options: () => readonly FilterFieldPickerOption[];
	native: () => TableFilePropertySnapshot | null;
	nativeType: (key: string) => FilterFieldType | null;
	tasks: () => readonly IndexedTask[];
	subscribeIndexUpdates: (listener: () => void) => () => void;
	changed: () => void;
}

/** A missing source or unsupported literal can still be kept in an inactive draft. */
export function actionType(field: string, ctx: Pick<ActionEditorContext, 'settings' | 'nativeType'>): FilterFieldType | null {
	if (!isFilePropertyColumnKey(field)) return managedAutomationFieldType(field, ctx.settings());
	if (!isAutomationNativeKeyWritable(field, ctx.settings())) return null;
	return ctx.nativeType(field);
}

/** Expand older multi-value actions in the editor draft, preserving the first action ID. */
export function expandListAction(action: AutomationAction, ctx: ActionEditorContext, usedIds: Set<string>): AutomationAction[] {
	const type = actionType(action.field, ctx);
	if (type !== 'list' && type !== 'tags') return [action];
	let members: string[];
	if (action.valueEncoding === 'vault-v1') return [action];
	if (isFilePropertyColumnKey(action.field)) {
		const raw = Array.isArray(action.value) ? action.value : [action.value];
		members = raw.flatMap(value => {
			try {
				const values = decodeVaultPropertyList(value);
				return values.length ? values.map(member => encodeVaultPropertyValue([member], 'list')) : [value];
			} catch { return [value]; }
		});
	} else {
		members = Array.isArray(action.value) ? action.value : parseListValue(action.value);
	}
	return members.length > 1
		? members.map((member, index) => ({ ...action, id: index ? createAutomationActionId(usedIds) : action.id, value: [member] }))
		: [action];
}

export function validAction(action: AutomationAction, ctx: Pick<ActionEditorContext, 'settings' | 'nativeType'>): boolean {
	const type = actionType(action.field, ctx);
	if (!type) return false;
	try {
		const literal = readActionLiteral(action, { type, native: isFilePropertyColumnKey(action.field),
			typedList: !!automationTypedListMapping(action.field, ctx.settings()) });
		return literal !== '' && (action.field !== 'status' || action.operation === 'remove'
			|| typeof literal === 'string' && !!resolveWorkflowStatus(ctx.settings().pipelines, literal));
	} catch { return false; }
}

function selectValue(parent: HTMLElement, label: string, value: string, values: [string, string][], change: (value: string) => void): HTMLSelectElement {
	const select = parent.createEl('select', { cls: 'operon-filter-select dropdown', attr: { 'aria-label': label } });
	select.createEl('option', { value: '', text: label });
	for (const [key, text] of values) select.createEl('option', { value: key, text });
	if (value && !values.some(([key]) => key === value)) select.createEl('option', { value, text: value });
	select.value = value;
	const icon = parent.createSpan({ cls: 'operon-field-picker-trigger-icon', attr: { 'aria-hidden': 'true' } });
	setIcon(icon, 'chevron-down');
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
		this.operation = row.createEl('button', { type: 'button', cls: 'operon-filter-modal-button is-icon operon-automation-operation' });
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
					delete action.valueEncoding;
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
		this.operation.querySelectorAll(':scope > svg').forEach(icon => icon.remove());
		setIcon(this.operation, add ? 'plus' : 'minus');
		setAccessibleLabelWithoutTooltip(this.operation, label);
		bindOperonHoverTooltip(this.operation, { content: label, taskColor: null });
	}

	private renderValue(): void {
		const { action, ctx, valueHost } = this;
		this.renderedType = actionType(action.field, ctx);
		const reminderDatetime = action.field === 'reminderDatetimes' && this.renderedType === 'list';
		const type = reminderDatetime ? 'datetime' : this.renderedType;
		valueHost.empty();
		const label = t('settings', 'automationValue');
		const raw = Array.isArray(action.value) ? action.value.join('; ') : action.value;
		const change = (value: string | string[]) => {
			if (action.valueEncoding === 'relative-day-v1') delete action.valueEncoding;
			action.value = reminderDatetime && typeof value === 'string' && value ? [value] : value;
			ctx.changed();
		};
		const list = type === 'list' || type === 'tags';
		const creatorField = ['tags', 'assignees', 'contexts', 'links', 'priority', 'status', 'taskIcon', 'taskColor', 'parentTask', 'location', 'estimate', 'taskType', 'taskImage', 'taskGallery'].includes(action.field)
			|| ((type === 'text' || type === 'number') && !!getCustomFieldMapping(ctx.settings().keyMappings, action.field));
		if (list || action.field === 'repeat' || creatorField && type) {
			const trigger = createFilterPickerTrigger(valueHost);
			const display = (text: string) => {
				let displayText = text;
				if (text && (action.field === 'blocking' || action.field === 'blockedBy')) {
					displayText = ctx.tasks().find(task => task.operonId === text)?.description.trim() || text;
				} else if (text && action.field === 'repeat') {
					const rule = parseRepeatRule(text);
					if (rule) displayText = formatRepeatRuleSummaryI18n(rule);
				} else if (text && action.field === 'reminderRules') {
					displayText = formatReminderDisplayItem({ settings: ctx.settings(), fieldKey: 'reminderRules', rawValue: text, fieldValues: {} }).text;
				}
				trigger.label.setText(displayText || label);
				trigger.button.setAttribute('aria-label', label + (displayText ? ' · ' + displayText : ''));
			};
			if (automationTypedListMapping(action.field, ctx.settings()) && !action.valueEncoding) {
				display(encodeVaultPropertyValue(readAutomationListMembers(action, false), 'list'));
			} else display(raw);
			trigger.button.addEventListener('click', () => {
				const onClose = () => {
					trigger.button.setAttribute('aria-expanded', 'false');
					this.closePicker = null;
					queueMicrotask(() => this.syncType());
				};
				const commit = (value: string | string[]) => {
					display(Array.isArray(value) ? value.join('; ') : value);
					change(value);
				};
				trigger.button.setAttribute('aria-expanded', 'true');
				const current = Array.isArray(action.value) ? action.value : action.value ? [action.value] : [];
				if (action.field === 'repeat') {
					this.closePicker = showRepeatPicker(trigger.button, {
						ruleOnly: true, value: current[0],
						onSave: ({ repeat }) => commit(repeat), onClear: () => commit(''), onClose,
					});
				} else if (action.field === 'reminderRules') {
					this.closePicker = showReminderRulesPicker(trigger.button, {
						app: ctx.app, settings: ctx.settings(), actionValue: current[0] ?? '',
						onCommit: value => commit(value ? [value] : []), onClose,
					});
				} else if (action.field === 'blocking' || action.field === 'blockedBy') {
					const fieldKey = action.field;
					const settings = ctx.settings();
					this.closePicker = showDependencyTaskPicker(trigger.button, {
						fieldKey, value: current[0] ?? '', oppositeValue: '', allTasks: [],
						getAllTasks: () => [...ctx.tasks()], subscribeIndexUpdates: ctx.subscribeIndexUpdates,
						pipelines: settings.pipelines, keyMappings: settings.keyMappings,
						singleValue: true, closeOnSelect: true,
						onSave: values => commit(values[fieldKey] ? [values[fieldKey]] : []), onClose,
					});
				} else if (creatorField) {
					this.closePicker = openTaskFieldPicker({
						app: ctx.app, settings: ctx.settings(), allTasks: [...ctx.tasks()], canonicalKey: action.field,
						anchor: trigger.button, currentFieldValues: { [action.field]: current.join('; ') },
						currentTags: current, currentListValues: current, closeListPickerOnSelect: true,
						singleListValue: action.field === 'taskGallery',
						onCommitListValues: (_key, values) => commit(values.slice(-1)),
						onCommit: payload => { commit(payload[action.field]); onClose(); }, onClose,
					});
				} else {
					this.closePicker = this.openListValue(trigger.button, current, commit, onClose);
				}
			});
			return;
		}
		const settings = ctx.settings();
		let choices: [string, string][] | undefined;
		if (action.field === 'checkbox') choices = [['open', t('buttons', 'open')], ['done', t('buttons', 'done')], ['cancelled', t('taskEditor', 'cancelled')]];
		else if (type === 'checkbox') choices = [['true', t('indexStats', 'diagnosticsYes')], ['false', t('indexStats', 'diagnosticsNo')]];
		if (choices) { selectValue(valueHost, label, raw, choices, change); return; }
		const input = valueHost.createEl('input', { type: type === 'number' && (!raw || Number.isFinite(Number(raw))) ? 'number' : 'text',
			cls: 'operon-filter-control', attr: { 'aria-label': label, placeholder: label } });
		input.disabled = !type;
		input.value = type === 'date' && action.valueEncoding === 'relative-day-v1'
			? automationDateLabel(raw, resolveDatePickerLanguage()) : raw;
		if (type === 'number') input.step = 'any';
		const datetimeDisplay = (value: string, relative: boolean) => {
			if (!relative) return formatUiTaskDatetime(ctx.app, settings, value);
			const [expression, time] = value.split('@');
			const label = automationDateLabel(expression, resolveDatePickerLanguage());
			return time ? label + ' · ' + formatCompactDatetimeTime(time, settings) : value;
		};
		if (type === 'datetime') input.value = datetimeDisplay(raw, action.valueEncoding === 'relative-day-v1');
		const update = (value: string) => { input.value = type === 'datetime' ? datetimeDisplay(value, false) : value; change(value); };
		input.addEventListener('input', () => change(input.value));
		if (type === 'date' || type === 'datetime') {
			const openPicker = () => {
				if (this.popoverOpen) return;
				this.popoverOpen = true;
				const onClose = () => { this.popoverOpen = false; queueMicrotask(() => this.syncType()); };
				if (type === 'date') showDatePicker(input, { app: ctx.app, fieldKey: action.field,
					value: action.valueEncoding === 'relative-day-v1' ? undefined : input.value || undefined,
					relativeDay: {
						value: action.valueEncoding === 'relative-day-v1' ? String(action.value) : undefined,
						onSelect: (expression, display) => {
							action.valueEncoding = 'relative-day-v1';
							action.value = expression;
							input.value = display;
							ctx.changed();
						},
					},
					dateDisplayFormat: settings.dateDisplayFormat,
					manualDatePicker: { weekStart: settings.calendarWeekStart, showWeekNumbers: settings.calendarSidebarShowWeekNumbers },
					canRemove: !!input.value, onRemove: () => update(''), onSelect: update, onClose });
				else showDatetimePicker(input, { app: ctx.app, settings, fieldKey: action.field, dateDisplayFormat: settings.dateDisplayFormat,
					value: action.valueEncoding === 'relative-day-v1' ? undefined : String(action.value),
					relativeDay: {
						value: action.valueEncoding === 'relative-day-v1' ? String(action.value) : undefined,
						onSelect: (expression, time) => {
							action.valueEncoding = 'relative-day-v1';
							action.value = expression + '@' + time;
							input.value = datetimeDisplay(action.value, true);
							ctx.changed();
						},
					},
					canRemove: !!input.value, onRemove: () => update(''), onSelect: update, onClose });
			};
			input.addEventListener('focus', openPicker);
			input.addEventListener('click', openPicker);
		}
		const candidates = isFilePropertyColumnKey(action.field) && type === 'text' ? ctx.native()?.getCandidates(action.field) : undefined;
		if (candidates?.length) {
			const list = valueHost.createEl('datalist');
			list.id = 'operon-automation-values-' + crypto.randomUUID();
			for (const value of candidates.slice(0, 500)) list.createEl('option', { value });
			input.setAttribute('list', list.id);
		}
	}

	private openListValue(anchor: HTMLElement, current: string[], commit: (values: string | string[]) => void, onClose: () => void): () => void {
		const { action, ctx } = this;
		const key = action.field;
		const native = isFilePropertyColumnKey(key);
		const mapping = getCustomFieldMapping(ctx.settings().keyMappings, key);
		const typedMapping = automationTypedListMapping(key, ctx.settings());
		const candidates = native ? ctx.native()?.getCandidates(key) ?? []
			: typedMapping ? collectNativeFieldValueCandidates(ctx.app, ctx.tasks(), ctx.settings().keyMappings, typedMapping.visiblePropertyName, 'list', true, 'usage')
			: mapping ? collectCustomFieldValueCandidates(ctx.app, ctx.tasks(), mapping, 'usage')
			: ctx.tasks().flatMap(task => parseListValue(task.fieldValues[key] ?? ''));
		let nativeValues: (string | number)[] | undefined;
		if (native || typedMapping) {
			try { nativeValues = readAutomationListMembers(action, native); }
			catch { nativeValues = []; } // An incomplete draft can still be replaced.
		}
		return showCustomListFieldPicker(anchor, {
			app: ctx.app, canonicalKey: key, type: 'list', label: this.field.label.textContent ?? key,
			singleValue: true, value: current, nativeValues, candidates: [...candidates],
			onCommit: (_key, value) => commit(value ? [value] : []), onCommitValues: (_key, values) => commit(values),
			onCommitNativeValues: values => {
				if (typedMapping) {
					action.valueEncoding = 'vault-v1';
					commit(encodeVaultPropertyValue(values, 'list'));
				} else commit(values.map(value => encodeVaultPropertyValue([value], 'list')));
			}, onClose,
		});
	}

	focusField(): void { this.field.button.focus(); }
	setMessage(message: string): void { this.message.setText(message); }
	dispose(): void { this.closePicker?.(); this.element.remove(); }
}
