import { App, getIcon, Notice, setIcon, Setting, stringifyYaml } from 'obsidian';
import { getActiveWindow } from '../core/dom-compat';
import { applyFieldRules } from '../core/field-rules';
import { t } from '../core/i18n';
import { resolveInlinePropertyDefinition, type InlinePropertyType } from '../core/inline-property-definitions';
import { type InlinePropertySnapshot } from '../core/inline-property-source';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { localToday } from '../core/local-time';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../core/location-coordinates';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { getAppLocale } from '../core/obsidian-app';
import { encodeFilePropertyColumnKey, isEmptyFilePropertyValue, isSupportedRawYamlPropertyValue, type RawYamlPropertyExpectation, type RawYamlPropertyValue } from '../core/raw-yaml-property';
import type { ReminderPickerFieldKey } from '../core/reminder-list-mutation';
import { applyReminderListMutation } from '../core/reminder-list-mutation';
import { REMINDER_RULE_ANCHORS } from '../core/reminder-rules';
import { parseRepeatRule } from '../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { type NativePropertyReadOnlyReason } from '../core/task-editor-native-properties';
import { deriveCountModeRepeatEndFromFieldValues, splitTaskListValue } from '../core/task-field-patch';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from '../core/task-media-reference';
import { formatUiDate } from '../core/ui-date-format';
import { formatUiTime } from '../core/ui-time-format';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../core/vault-property-codec';
import { getVisiblePropertyName } from '../core/yaml-fields';
import { OperonIndexer } from '../indexer/indexer';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE, InlineRepeatCompletionMode,
	normalizeInlineCompletionMode
} from '../storage/repeat-series-store';
import { ManualEstimateReallocationProposal } from '../systems/estimate-reallocation';
import {
	parseLocalDatetime
} from '../systems/tracker-utils';
import { ParsedTask } from '../types/fields';
import { resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus } from '../types/pipeline';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, InlineTaskCompactChipKey, OperonSettings, TASK_CREATOR_FALLBACK_FIELD_ICONS, type KeyMapping } from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindAssigneeChipImage } from './assignee-chip-image';
import type { CompactEditorKeyIntent } from './compact-editor-key-intent';
import {
	createCompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurface,
} from './compact-markdown-editor-surface';
import { createInlineTaskCompactChipElement } from './compact-task-layout';
import {
	collectNativeFieldValueCandidates, getCheckboxPropertyIcon, getCheckboxPropertyTypeIcon, getCustomFieldIcon,
	getCustomFieldLabel,
	getCustomFieldMapping, getNativePropertyIcon, isProjectedCustomFieldType,
	normalizeCustomFieldRawValue
} from './custom-field-surfaces';
import { areStringArraysEqual, formatTaskEditorDatetime, normalizeListValues, scheduleTaskEditorReminderFocus } from './editor-property-format';
import { showAssigneesPicker } from './field-pickers/assignees-picker';
import { showColorPicker } from './field-pickers/color-picker';
import { formatContextDisplay, showContextsPicker } from './field-pickers/contexts-picker';
import { showDatePicker } from './field-pickers/date-picker';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { showIconPicker } from './field-pickers/icon-picker';
import { showLinksPicker } from './field-pickers/links-picker';
import { formatExternalLinkDisplay } from './field-pickers/links-utils';
import { showLocationPicker } from './field-pickers/location-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showRelatedPicker } from './field-pickers/related-picker';
import { showRepeatPicker } from './field-pickers/repeat-picker';
import { showRepeatSkipPicker } from './field-pickers/repeat-skip-picker';
import { showStatusPicker } from './field-pickers/status-picker';
import { showTagPicker } from './field-pickers/tag-picker';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { bindPropertyReadOnlyWarning, propertyReadOnlyWarningText } from './property-readonly-warning';
import { formatReminderDisplayItem } from './reminder-display';
import { getTableFilePropertyTypeIcon, type TableFilePropertyField } from './table/table-file-property';
import { openTableFilePropertyPicker } from './table/table-file-property-editor';
import { getManagedTaskDataFieldPicker, type ManagedTaskDataFieldPicker } from './task-data-field-picker';
import type { TaskEditorContentOptions, TaskEditorEstimateReallocationApplyResult, TaskEditorEstimateReallocationRequest, TaskEditorFileBodyContext, TaskEditorRepeatSkipUpdateRequest, TaskEditorRepeatSkipUpdateResult } from './task-editor-content';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
export const DESKTOP_CORE_FIELDS = new Set([
	'taskIcon', 'taskColor', 'status', 'priority', 'dateStarted', 'dateDue', 'repeat',
	'dateScheduled', 'datetimeStart', 'estimate', 'datetimeEnd', 'dateCompleted', 'dateCancelled',
]);
export type EditorFileProperty = { field: TableFilePropertyField; baseline: RawYamlPropertyExpectation | null; value: unknown; inline?: InlinePropertySnapshot; readonly?: boolean; readOnlyReason?: NativePropertyReadOnlyReason; headerSelected?: boolean; pending?: boolean };
export type EditorFieldDisplay = Pick<KeyMapping, 'canonicalKey' | 'visiblePropertyName' | 'type' | 'icon'>;
/** Shared field controls. Hosts own layout, persistence and task-only operations. */
export abstract class EditorPropertyFields {
	protected isListProperty(key: string): boolean {
		return ['contexts', 'tags', 'links', 'assignees', 'subtasks', 'blocking', 'blockedBy', 'related', 'reminderDatetimes', 'reminderRules'].includes(key)
			|| getCustomFieldMapping(this.settings.keyMappings, key)?.type === 'list'
			|| getManagedTaskDataFieldPicker(key, this.settings.keyMappings)?.type === 'list';
	}

	protected createPropertyRow(container: HTMLElement, key: string, name: string, icon: string, list: boolean): {
		row: HTMLElement; label: HTMLButtonElement; value: HTMLElement;
	} {
		const row = container.createDiv('operon-editor-desktop-property-row');
		row.dataset.propertyKey = key;
		row.toggleClass('is-list-property', list);
		const label = row.createEl('button', { cls: 'operon-editor-desktop-property-label', attr: { type: 'button' } });
		setIcon(label.createSpan('operon-editor-desktop-property-icon'), icon);
		label.createSpan({ text: name, cls: 'operon-editor-desktop-property-name' });
		const value = row.createDiv('operon-editor-desktop-property-value');
		return { row, label, value };
	}

	/** Only a task host may create a repeat-series identity. Plain-file hosts do not. */
	protected abstract ensureRepeatSeriesIdentity(): void;
	protected abstract prepareRepeatIdentityPatch(patch: Record<string, string | string[]>): void;

	/** Layout owners subscribe after field content has refreshed; sections stay host-owned. */
	protected onPropertyContentChanged: (() => void) | null = null;
	protected notifyPropertyContentChanged(): void {
		if (!this.disposed) this.onPropertyContentChanged?.();
	}

	protected abstract syncFilePropertyRowVisibility(entry: EditorFileProperty, surface: { row: HTMLElement; action: HTMLButtonElement }, populated: boolean): void;
	protected abstract app: App;
	protected abstract autoSizeCompactTextarea(textarea: HTMLTextAreaElement): void;
	protected abstract disposed: boolean;
	protected abstract existingTask: ParsedTask | null;
	protected abstract fieldValues: Record<string, string>;
	protected abstract fileBodyContext: TaskEditorFileBodyContext | null;
	protected abstract getCompactTextSourcePath(): string;
	protected abstract getManualDatePickerOptions(key: string): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } | undefined;
	protected abstract getWorkflowActionFocusTarget(key: string): HTMLButtonElement | null | undefined;
	protected abstract getWorkflowSubtaskIds(parentId?: string | null): string[];
	protected abstract handleCompactTextEditorIntent(
		field: 'description' | 'note',
		intent: Exclude<CompactEditorKeyIntent, 'none'>,
	): void;
	protected abstract indexer: Pick<OperonIndexer, 'getAllTasks'>;
	protected abstract inlineCompletionMode: InlineRepeatCompletionMode;
	protected abstract readonly isPhone: boolean;
	protected abstract mainPanelEl: HTMLElement | null;
	abstract markEdited(): void;
	protected abstract noteCompactEditor: CompactMarkdownEditorSurface | null;
	protected abstract noteCompactHostEl: HTMLElement | null;
	protected abstract propertyInteractionEpoch: number;
	protected abstract readSource: TaskEditorContentOptions['readSource'];
	protected abstract refreshTaskSource(): Promise<void>;
	protected abstract refreshWorkflowActionButtonStates(): void;
	protected abstract refreshWorkflowPickerSurfaceValues(): void;
	protected abstract registerSchedulingDraftRefresher(refresh: () => void): void;
	protected abstract renderParentTaskPicker(group: HTMLElement): void;
	protected abstract renderSubtaskPicker(group: HTMLElement): void;
	protected abstract renderTaskListPicker(group: HTMLElement, fieldKey: 'blocking' | 'blockedBy', label: string): void;
	protected abstract rootEl: HTMLElement | null;
	protected abstract settings: OperonSettings;
	protected abstract shellEl: HTMLElement | null;
	protected abstract readonly sourceCompositionEnd: () => void;
	protected abstract tags: string[];
	protected abstract readonly usesMobileLayout: boolean;
	protected abstract readonly usesTouchDesktopLayout: boolean;
	protected abstract workflowActionButtons: Map<string, HTMLButtonElement>;
	protected abstract workflowActionPickerClose: (() => void) | null;
	protected abstract workflowRowsEl: HTMLElement | null;
	protected getThemeColor(): string {
		const color = (this.fieldValues['taskColor'] ?? '').trim().replace(/^#/, '');
		return /^([0-9a-fA-F]{6})$/.test(color)
			? `#${color}`
			: 'var(--interactive-accent)';
	}

	protected applyThemeColor(): void {
		const color = this.getThemeColor();
		this.rootEl?.style.setProperty('--operon-task-editor-accent', color);
		this.shellEl?.style.setProperty('--operon-task-editor-accent', color);
		this.mainPanelEl?.style.setProperty('--operon-task-editor-accent', color);
	}

	protected bindEditorHoverTooltip(target: HTMLElement, options: Parameters<typeof bindOperonHoverTooltip>[1]): void {
		bindOperonHoverTooltip(target, {
			...options,
			shouldOpen: () => (!this.usesTouchDesktopLayout || this.rootEl?.dataset.editorInput !== 'touch') && (options.shouldOpen?.() ?? true),
		});
	}

	protected bindTaskEditorTooltip(target: HTMLElement, content: string): void {
		this.bindEditorHoverTooltip(target, {
			content,
			taskColor: () => this.getThemeColor(),
		});
	}

	protected appendCanonicalIcon(target: HTMLElement, canonicalKey: string, className: string): void {
		const iconId = this.getCoreFieldIcon(canonicalKey);
		if (!iconId) return;
		const iconWrap = target.createSpan(className);
		setIcon(iconWrap, iconId);
	}

	protected getCoreFieldIcon(canonicalKey: string): string {
		return getConfiguredKeyMappingIcon(canonicalKey, this.settings.keyMappings);
	}

	protected setPickerButtonContent(
		button: HTMLButtonElement,
		options: {
			canonicalKey: string;
			text: string;
			isEmpty: boolean;
			showIcon?: boolean;
		},
	): void {
		button.empty();
		button.removeClass('has-weekday');
		if (options.isEmpty || options.showIcon === true) {
			const iconId = this.getCoreFieldIcon(options.canonicalKey);
			if (iconId) {
				const iconWrap = button.createSpan('operon-editor-picker-button-leading-icon');
				setIcon(iconWrap, iconId);
			}
		}
		button.createSpan({ text: options.text, cls: 'operon-editor-picker-button-text' });
	}

	protected bindTruncatedTextTooltip(target: HTMLElement | null): void {
		if (!target || this.isPhone) return;
		this.bindEditorHoverTooltip(target, {
			content: target.textContent ?? '',
			taskColor: () => this.getThemeColor(),
			shouldOpen: () => target.clientWidth > 0 && target.scrollWidth > target.clientWidth + 1,
		});
	}

	protected appendWeekdayHint(target: HTMLElement, value: string): void {
		target.toggleClass('has-weekday', Array.from(target.children).some(child => child.classList.contains('operon-editor-weekday')));
		if (this.usesMobileLayout || !value) return;
		const canonical = value.length === 10 ? `${value}T12:00:00`
			: value.length === 16 ? `${value}:00` : value;
		const date = parseLocalDatetime(canonical);
		if (!date) return;
		const weekday = new Intl.DateTimeFormat(getAppLocale(this.app), { weekday: 'long' }).format(date);
		target.createSpan({ cls: 'operon-editor-weekday', text: ` - ${weekday}` });
		target.addClass('has-weekday');
	}

	protected renderCustomFieldSelection(
		container: HTMLElement,
		mapping: EditorFieldDisplay,
		onRemove: ((value: string, index: number) => void) | null,
		options: { values?: readonly string[]; suppressValueTooltip?: boolean; onActivate?: (chip: HTMLElement, value: string, index: number) => void } = {},
	): void {
		container.replaceChildren();
		const rawValue = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
		const values = options.values ?? (mapping.type === 'list'
			? splitTaskListValue(rawValue)
			: rawValue
				? [rawValue]
				: []);
		container.classList.toggle('is-empty', values.length === 0);
		for (const [index, value] of values.entries()) {
			const chip = createInlineTaskCompactChipElement({
				key: mapping.canonicalKey,
				label: this.formatCustomFieldDisplayValue(mapping, value),
				icon: mapping.type === 'checkbox'
					? getCheckboxPropertyIcon(value === 'true' ? true : value === 'false' ? false : undefined, getCustomFieldIcon(mapping))
					: getCustomFieldIcon(mapping),
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			if (!options.suppressValueTooltip) this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			if (mapping.type === 'date' || mapping.type === 'datetime') this.appendWeekdayHint(chip, value);
			options.onActivate?.(chip, value, index);
			if (!onRemove) { container.appendChild(chip); continue; }
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', {
				value: this.formatCustomFieldDisplayValue(mapping, value),
			}));
			removeButton.addEventListener('click', () => onRemove(value, index));
			chip.appendChild(removeButton);
			chip.addClass('has-remove-action');
			container.appendChild(chip);
		}
	}

	protected formatCustomFieldDisplayValue(mapping: EditorFieldDisplay, value: string): string {
		const trimmed = value.trim();
		if (mapping.type === 'datetime') return formatTaskEditorDatetime(this.app, this.settings, trimmed);
		if (mapping.type === 'date') return formatUiDate(trimmed, this.settings);
		return trimmed;
	}

	protected setDelimitedFieldValue(fieldKey: string, values: string[]): void {
		const normalized = normalizeListValues(values);
		if (normalized.length > 0) {
			this.fieldValues[fieldKey] = normalized.join('; ');
			return;
		}
		delete this.fieldValues[fieldKey];
	}

	protected formatInlineReferenceLabel(value: string): string {
		const trimmed = value.trim();
		const wikiMatch = trimmed.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
		if (!wikiMatch) return trimmed;
		const target = (wikiMatch[2] ?? wikiMatch[1] ?? '').trim();
		return target;
	}

	protected resolveCompactChipIcon(canonicalKey: InlineTaskCompactChipKey): string {
		return getConfiguredKeyMappingIcon(canonicalKey, this.settings.keyMappings)
			|| INLINE_TASK_COMPACT_FALLBACK_ICONS[canonicalKey];
	}

	protected createPickerAnchor(
		container: HTMLElement,
		placeholder: string,
		options?: { leadingIcon?: string },
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'operon-editor-picker-anchor',
			attr: {
				type: 'button',
			},
		});
		const main = button.createSpan('operon-editor-picker-anchor-main');
		if (options?.leadingIcon) {
			const leadingIconWrap = main.createSpan('operon-editor-picker-anchor-leading-icon');
			setIcon(leadingIconWrap, options.leadingIcon);
		}
		const text = main.createSpan({
			text: placeholder,
			cls: 'operon-editor-picker-anchor-text',
		});
		const iconWrap = button.createSpan('operon-editor-picker-anchor-icon');
		setIcon(iconWrap, this.usesMobileLayout ? 'chevron-right' : 'search');
		button.dataset.placeholder = placeholder;
		button.dataset.placeholderTarget = text.className;
		return button;
	}

	protected renderValueChips(
		container: HTMLElement,
		values: string[],
		variant: 'contexts' | 'tags' | 'assignees',
		onRemove: (value: string) => void,
		formatValue?: (value: string) => string,
	): void {
		container.replaceChildren();
		container.classList.toggle('is-empty', values.length === 0);
		for (const value of values) {
			const chip = container.createDiv(`operon-editor-picker-chip is-${variant}`);
			chip.createSpan({
				text: formatValue ? formatValue(value) : value,
				cls: 'operon-editor-picker-chip-label',
			});
			const removeButton = chip.createEl('button', {
				cls: 'operon-editor-picker-chip-remove',
				text: '×',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value }));
			removeButton.addEventListener('click', () => onRemove(value));
		}
	}

	protected renderCompactSelectionChips(
		container: HTMLElement,
		canonicalKey: InlineTaskCompactChipKey,
		values: string[],
		onRemove: (value: string) => void,
		formatLabel: (value: string) => string,
	): void {
		container.replaceChildren();
		container.classList.toggle('is-empty', values.length === 0);
		const icon = this.resolveCompactChipIcon(canonicalKey);
		for (const value of values) {
			const chip = createInlineTaskCompactChipElement({
				key: canonicalKey,
				label: formatLabel(value),
				icon,
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			if (canonicalKey === 'assignees' && value.trim().startsWith('[[') && value.trim().endsWith(']]')) {
				const target = value.trim().slice(2, -2).split('|')[0];
				bindAssigneeChipImage(chip, { key: canonicalKey, linkTarget: target }, this.app, this.getCompactTextSourcePath(), this.settings.assigneeImageProperty);
			}
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: formatLabel(value) }));
			removeButton.addEventListener('click', () => onRemove(value));
			chip.appendChild(removeButton);
			container.appendChild(chip);
		}
	}

	protected renderNote(container: HTMLElement, showLabel = true): void {
		const setting = new Setting(container);
		if (showLabel) setting.setName(t('taskEditor', 'notes'));
		const host = setting.controlEl.createDiv(
			'operon-task-editor-compact-text-host is-notes',
		);
		this.noteCompactHostEl = host;
		this.noteCompactEditor?.destroy();
		this.noteCompactEditor = createCompactMarkdownEditorSurface(host, {
			onCompositionSettled: this.sourceCompositionEnd,
			app: this.app,
			sourceValue: this.fieldValues['note'] ?? '',
			sourcePath: this.getCompactTextSourcePath(),
			placeholder: t('taskEditor', 'notesPlaceholder'),
			ariaLabel: t('taskEditor', 'notes'),
			textPolicy: 'task-note',
			onTextareaLayout: textarea => this.autoSizeCompactTextarea(textarea),
			onUserChange: draft => {
				const value = draft.persistableValue;
				const previous = this.fieldValues['note'] ?? '';
				if (value.trim()) {
					this.fieldValues['note'] = value;
				} else {
					delete this.fieldValues['note'];
				}
				if (value === previous) return;
				this.markEdited();
			},
			onIntent: intent => this.handleCompactTextEditorIntent('note', intent),
		});
		setting.settingEl.addClass('operon-note-setting');
		if (!showLabel) setting.settingEl.addClass('operon-editor-text-field-setting');
	}

	protected renderTags(container: HTMLElement): void {
		const setting = new Setting(container);
		setting.settingEl.addClass('operon-tags-setting', 'operon-editor-tags-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-tags-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'tags'), {
			leadingIcon: this.resolveCompactChipIcon('tags'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-tag-selection-row');

		let selectedValues = normalizeListValues(this.tags.map(tag => tag.replace(/^#/, '')));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'tags', selectedValues, (tag) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== tag);
				this.tags = [...selectedValues];
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, (tag) => tag);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showTagPicker(anchor, {
				app: this.app,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values.map(value => value.replace(/^#/, '')));
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.tags = [...nextValues];
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	protected bindDesktopPropertyInteraction(
		row: HTMLElement, label: HTMLButtonElement, value: HTMLElement,
		openLabel: () => void, openValue: () => void, canEdit: () => boolean,
	): void {
		setAccessibleLabelWithoutTooltip(label, label.textContent ?? '');
		this.bindTruncatedTextTooltip(label.querySelector<HTMLElement>('.operon-editor-desktop-property-name'));
		label.addEventListener('click', () => { if (!this.disposed && canEdit()) openLabel(); });
		value.addEventListener('click', () => { if (canEdit()) this.propertyInteractionEpoch += 1; }, true);
		value.tabIndex = 0;
		value.setAttribute('role', 'group');
		setAccessibleLabelWithoutTooltip(value, label.textContent ?? '');
		value.addEventListener('click', event => {
			if (this.disposed || !canEdit() || event.defaultPrevented) return;
			const target = event.target as HTMLElement;
			if (target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="button"]')) return;
			openValue();
		});
		value.addEventListener('keydown', event => {
			if (event.target !== value || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
			if (!this.disposed && canEdit()) openValue();
		});
		row.addClass('operon-editor-interactive-property-row');
	}

	protected openDesktopPropertyValue(key: string, value: HTMLElement, label: HTMLButtonElement): void {
		const custom = getCustomFieldMapping(this.settings.keyMappings, key);
		if (custom?.type === 'text') {
			this.closeActiveWorkflowActionPicker();
			const epoch = ++this.propertyInteractionEpoch;
			value.addClass('is-picker-open');
			let closePicker: (() => void) | null = null;
			closePicker = openTaskFieldPicker({
				app: this.app, anchor: value, settings: this.settings, allTasks: this.indexer.getAllTasks(),
				canonicalKey: key, currentFieldValues: { ...this.fieldValues }, currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? '', multilineEditorOwner: value,
				onCommit: payload => this.commitWorkflowActionPayload(payload),
				onClose: () => {
					if (this.workflowActionPickerClose !== closePicker) return;
					this.workflowActionPickerClose = null; value.removeClass('is-picker-open');
					if (this.readSource) void this.refreshTaskSource();
					if (!this.disposed && this.propertyInteractionEpoch === epoch) {
						const target = value.closest<HTMLElement>('.operon-editor-desktop-property-row')?.hidden ? this.getWorkflowActionFocusTarget(key) : value.isConnected ? value : label;
						target?.focus({ preventScroll: true });
					}
				},
			});
			this.workflowActionPickerClose = closePicker;
			return;
		}
		const control = value.querySelector<HTMLButtonElement>('.operon-icon-trigger, .operon-color-swatch, .operon-editor-repeat-trigger, .operon-editor-picker-button');
		if (DESKTOP_CORE_FIELDS.has(key) && control && !control.disabled) control.click();
		else this.openWorkflowPickerFromAction(key, label);
	}

	protected renderDesktopCoreProperty(value: HTMLElement, key: string): void {
		switch (key) {
			case 'taskIcon': this.renderIconControl(value); break;
			case 'taskColor': this.renderColorControl(value); break;
			case 'status': this.renderStatusControl(value); break;
			case 'priority': this.renderPriorityControl(value); break;
			case 'repeat': this.renderRepeatControl(value); break;
			case 'estimate': this.renderEstimateControl(value); break;
			case 'datetimeStart':
			case 'datetimeEnd': this.renderDatetimeControl(value, key, this.getWorkflowPickerLabel(key)); break;
			default: this.renderDateControl(value, key, this.getWorkflowPickerLabel(key));
		}
	}

	protected refreshDesktopPropertyIcon(key: string, row: HTMLElement, hasValue: boolean): void {
		const icon = row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon');
		if (!icon) return;
		const selected = key === 'taskIcon' ? this.fieldValues['taskIcon']?.trim() : '';
		const iconId = selected && getIcon(selected) ? selected : this.resolveWorkflowPickerIcon(key);
		if (icon.dataset.iconId !== iconId) {
			setIcon(icon, iconId);
			icon.dataset.iconId = iconId;
		}
		icon.toggleClass('has-value', hasValue);
		const color = key === 'taskColor' ? this.fieldValues['taskColor']?.trim().replace(/^#/, '') : '';
		if (color && /^[0-9a-f]{6}$/i.test(color)) icon.style.color = `#${color}`;
		else icon.style.removeProperty('color');
	}

	protected getWorkflowPickerLabel(key: string): string {
		if (key === 'estimate') return t('settings', 'chipEstimate');
		const coreLabels: Record<string, string> = {
			taskIcon: 'taskIcon', taskColor: 'taskColor', status: 'status', priority: 'priority',
			dateStarted: 'started', dateDue: 'dueDate', dateScheduled: 'scheduled',
			datetimeStart: 'datetimeStart', datetimeEnd: 'datetimeEnd',
			repeat: 'repeat', dateCompleted: 'finished', dateCancelled: 'cancelled',
		};
		if (coreLabels[key]) return t('taskEditor', coreLabels[key]);
		const managedTaskDataField = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
		if (managedTaskDataField) return managedTaskDataField.label;
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'tags') return t('taskEditor', 'tags');
		if (key === 'contexts') return t('taskEditor', 'contexts');
		if (key === 'assignees') return t('taskEditor', 'assignees');
		if (key === 'location') return t('location', 'location');
		if (key === 'links') return t('taskEditor', 'links');
		if (key === 'reminderDatetimes' || key === 'reminderRules') {
			return getVisiblePropertyName(key, this.settings.keyMappings);
		}
		if (key === 'parentTask') return t('taskEditor', 'parentTask');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		if (key === 'related') return t('taskEditor', 'related');
		return key;
	}

	protected resolveWorkflowPickerIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		return getConfiguredKeyMappingIcon(key, this.settings.keyMappings)
			|| (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key]
			|| (INLINE_TASK_COMPACT_FALLBACK_ICONS as Record<string, string>)[key]
			|| (key === 'related' ? 'link-2' : '')
			|| 'circle-dot';
	}

	protected hasWorkflowPickerValue(key: string): boolean {
		const managedTaskDataField = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
		if (managedTaskDataField) {
			return this.getManagedTaskDataWorkflowValues(managedTaskDataField).length > 0;
		}
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping && isProjectedCustomFieldType(customMapping)) {
			const value = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[customMapping.canonicalKey]);
			return customMapping.type === 'list'
				? splitTaskListValue(value).length > 0
				: !!value.trim();
		}
		if (key === 'tags') return this.tags.length > 0;
		if (key === 'contexts' || key === 'links' || key === 'assignees' || key === 'reminderDatetimes' || key === 'reminderRules' || key === 'blocking' || key === 'blockedBy' || key === 'related') {
			return splitTaskListValue(this.fieldValues[key]).length > 0;
		}
		if (key === 'parentTask' || key === 'location') return !!(this.fieldValues[key] ?? '').trim();
		if (key === 'subtasks') return this.getWorkflowSubtaskIds().length > 0;
		return !!(this.fieldValues[key] ?? '').trim();
	}

	protected renderWorkflowPicker(container: HTMLElement, key: string): void {
		switch (key) {
			case 'contexts':
				this.renderContextsPicker(container);
				break;
			case 'tags':
				this.renderTags(container);
				break;
			case 'assignees':
				this.renderAssigneesPicker(container);
				break;
			case 'location':
				this.renderLocationPicker(container);
				break;
			case 'links':
				this.renderLinksPicker(container);
				break;
			case 'reminderDatetimes':
			case 'reminderRules':
				this.renderReminderWorkflowPicker(container, key);
				break;
			case 'parentTask':
				this.renderParentTaskPicker(container);
				break;
			case 'subtasks':
				this.renderSubtaskPicker(container);
				break;
			case 'blocking':
				this.renderTaskListPicker(container, 'blocking', t('taskEditor', 'blocking'));
				break;
			case 'blockedBy':
				this.renderTaskListPicker(container, 'blockedBy', t('taskEditor', 'blockedBy'));
				break;
			case 'related':
				this.renderRelatedPicker(container);
				break;
		}
	}

	protected renderReminderWorkflowPicker(group: HTMLElement, fieldKey: ReminderPickerFieldKey): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-reminder-setting');
		setting.setName(this.getWorkflowPickerLabel(fieldKey));
		const selectedWrap = setting.controlEl.createDiv(
			'operon-editor-picker-selected operon-editor-reminder-selection-row',
		);
		let closePicker: (() => void) | null = null;

		const render = () => {
			selectedWrap.replaceChildren();
			const values = splitTaskListValue(this.fieldValues[fieldKey]);
			selectedWrap.classList.toggle('is-empty', values.length === 0);
			for (const [index, rawValue] of values.entries()) {
				const display = formatReminderDisplayItem({
					app: this.app,
					settings: {
						timeFormat: this.settings.timeFormat,
						dateDisplayFormat: this.settings.dateDisplayFormat,
						keyMappings: this.settings.keyMappings,
					},
					fieldKey,
					rawValue,
					fieldValues: this.fieldValues,
				});
				const chip = createInlineTaskCompactChipElement({
					key: fieldKey,
					label: display.text,
					icon: this.resolveWorkflowPickerIcon(fieldKey),
					iconOnly: false,
					interactive: !group.hasClass('operon-editor-desktop-property-value'),
					colorRole: 'default',
					linkTarget: null,
				}, `operon-editor-compact-selection-chip operon-editor-reminder-chip is-${display.state}`, {
					forceFull: true,
				});
				if (fieldKey === 'reminderDatetimes' && display.state !== 'invalid') this.appendWeekdayHint(chip, rawValue);
				setAccessibleLabelWithoutTooltip(chip, display.ariaLabel);
				chip.dataset.fieldKey = fieldKey;
				chip.dataset.reminderIndex = String(index);
				if (fieldKey === 'reminderRules') this.bindEditorHoverTooltip(chip, {
					title: display.tooltipTitle,
					content: display.tooltipContent,
					taskColor: () => this.getThemeColor(),
				});
				chip.addEventListener('click', event => {
					event.preventDefault();
					openEditPicker(chip, index, rawValue);
				});
				if (group.hasClass('operon-editor-desktop-property-value')) {
					chip.setAttr('role', 'button'); chip.tabIndex = 0;
					chip.addEventListener('keydown', event => {
						if (event.target !== chip || (event.key !== 'Enter' && event.key !== ' ')) return;
						event.preventDefault(); openEditPicker(chip, index, rawValue);
					});
					const remove = chip.createEl('button', { cls: 'operon-editor-compact-selection-chip-remove', attr: { type: 'button' } });
					chip.addClass('has-remove-action');
					setIcon(remove, 'x'); setAccessibleLabelWithoutTooltip(remove, t('taskEditor', 'removeValue', { value: display.text }));
					remove.addEventListener('click', event => {
						event.preventDefault(); event.stopPropagation();
						closePicker?.();
						const result = applyReminderListMutation({ fieldKey, currentValue: this.fieldValues[fieldKey], mutation: { action: 'remove', current: { index, rawValue } } });
						if (!result.ok) { new Notice(t('reminders', 'staleItem')); return; }
						if (result.changed) this.commitWorkflowActionPayload({ [fieldKey]: result.fieldValue });
						this.workflowActionButtons.get(fieldKey)?.focus({ preventScroll: true });
					});
				}
				selectedWrap.appendChild(chip);
			}
		};

		const openEditPicker = (anchor: HTMLElement, index: number, rawValue: string) => {
			if (closePicker) return;
			if (group.hasClass('operon-editor-desktop-property-value')) anchor.addClass('is-picker-open');
			const ownerWindow = anchor.ownerDocument.defaultView ?? getActiveWindow();
			let committed = false;
			let closeHandled = false;
			let focusIndex = index;
			const handleClose = () => {
				if (closeHandled) return;
				closeHandled = true;
				closePicker = null;
				anchor.removeClass('is-picker-open');
				if (committed) this.refreshWorkflowPickerSurfaceValues();
				scheduleTaskEditorReminderFocus({
					ownerWindow,
					fieldKey,
					focusIndex,
					getWorkflowRows: () => this.workflowRowsEl,
					getActionButton: () => this.workflowActionButtons.get(fieldKey),
				});
			};
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: fieldKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				reminderOperation: {
					kind: 'edit',
					item: { index, rawValue },
				},
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					this.markEdited();
					committed = true;
					const remaining = splitTaskListValue(this.fieldValues[fieldKey]).length;
					focusIndex = remaining > 0 ? Math.min(index, remaining - 1) : -1;
				},
				onClose: handleClose,
				onCancel: handleClose,
			});
		};

		render();
	}

	protected getManagedTaskDataWorkflowValues(field: ManagedTaskDataFieldPicker): string[] {
		const rawValue = (this.fieldValues[field.canonicalKey] ?? '').trim();
		if (!rawValue) return [];
		return field.type === 'list' ? parseTaskMediaReferenceList(rawValue) : [rawValue];
	}

	protected renderManagedTaskDataWorkflowPicker(group: HTMLElement, field: ManagedTaskDataFieldPicker): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-managed-task-data-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, field.label, {
			leadingIcon: getConfiguredKeyMappingIcon(field.canonicalKey, this.settings.keyMappings) || 'circle-dot',
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-managed-task-data-selection-row');
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			const values = this.getManagedTaskDataWorkflowValues(field);
			selectedWrap.classList.toggle('is-empty', values.length === 0);
			for (const value of values) {
				const chip = createInlineTaskCompactChipElement({
					key: field.canonicalKey,
					label: value,
					icon: getConfiguredKeyMappingIcon(field.canonicalKey, this.settings.keyMappings) || 'circle-dot',
					iconOnly: false,
					interactive: false,
					colorRole: 'default',
					linkTarget: null,
				}, 'operon-editor-compact-selection-chip operon-editor-managed-task-data-chip', { forceFull: true });
				this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
				const removeButton = chip.ownerDocument.win.createEl('button');
				removeButton.type = 'button';
				removeButton.className = 'operon-editor-compact-selection-chip-remove';
				setIcon(removeButton, 'x');
				setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value }));
				removeButton.addEventListener('click', () => {
					closeActivePicker();
					const nextValue = field.type === 'list'
						? serializeTaskMediaReferenceList(values.filter(existing => existing !== value))
						: '';
					this.applyDraftFieldRules({ [field.canonicalKey]: nextValue }, [field.canonicalKey]);
					render();
					this.markEdited();
					this.refreshWorkflowPickerSurfaceValues();
				});
				chip.appendChild(removeButton);
				selectedWrap.appendChild(chip);
			}
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: field.canonicalKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					render();
					this.markEdited();
					if (this.hasWorkflowPickerValue(field.canonicalKey)) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
				onCancel: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			if (closePicker) anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	protected renderCustomWorkflowPicker(group: HTMLElement, mapping: KeyMapping): void {
		const label = getCustomFieldLabel(mapping);
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-custom-field-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, label, {
			leadingIcon: getCustomFieldIcon(mapping),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-custom-field-selection-row');
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCustomFieldSelection(selectedWrap, mapping, (value) => {
				closeActivePicker();
				if (mapping.type === 'list') {
					const currentValue = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
					const nextValues = splitTaskListValue(currentValue).filter(existing => existing !== value);
					this.setDelimitedFieldValue(mapping.canonicalKey, nextValues);
				} else {
					this.applyDraftFieldRules({ [mapping.canonicalKey]: '' }, [mapping.canonicalKey]);
				}
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			});
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: mapping.canonicalKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				closeListPickerOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				repeatInlineCompletionMode: this.inlineCompletionMode,
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					render();
					this.markEdited();
					if (this.hasWorkflowPickerValue(mapping.canonicalKey)) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onRepeatInlineCompletionModeChange: mode => {
					this.inlineCompletionMode = normalizeInlineCompletionMode(mode);
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
				onCancel: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			if (closePicker) anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	protected createInlineField(container: HTMLElement, label: string): HTMLElement {
		const wrap = container.createDiv('operon-editor-inline-control operon-editor-manual-field');
		wrap.createEl('label', { text: label, cls: 'operon-editor-inline-label' });
		return wrap.createDiv('operon-editor-inline-input');
	}

	protected renderPriorityControl(container: HTMLElement): void {
		const control = this.createInlineField(container, t('taskEditor', 'priority'));
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});

		const refreshButton = () => {
			const value = (this.fieldValues['priority'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: 'priority',
				isEmpty: !value,
				text: value
					? value.charAt(0).toUpperCase() + value.slice(1)
					: t('taskEditor', 'priority'),
			});
		};

		button.addEventListener('click', () => {
			button.classList.add('is-picker-open');
			showPriorityPicker(button, {
				priorities: this.settings.priorities,
				value: this.fieldValues['priority'],
				onSelect: value => {
					if (value) this.fieldValues['priority'] = value;
					else delete this.fieldValues['priority'];
					refreshButton();
					this.markEdited();
				},
				onClear: () => {
					delete this.fieldValues['priority'];
					refreshButton();
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});

		this.registerSchedulingDraftRefresher(refreshButton);
		refreshButton();
	}

	protected renderStatusControl(container: HTMLElement): void {
		const statusControlEl = this.createInlineField(container, t('taskEditor', 'status'));
		const button = statusControlEl.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});
		let closePicker: (() => void) | null = null;

		const refresh = () => {
			const value = (this.fieldValues['status'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: 'status',
				isEmpty: !value,
				text: value || t('taskEditor', 'statusPlaceholder'),
			});
		};

		const openPicker = () => {
			if (closePicker) return;
			const resetPickerState = () => {
				closePicker = null;
				button.removeClass('is-picker-open');
			};
			closePicker = showStatusPicker(button, {
				pipelines: this.settings.pipelines,
				value: this.fieldValues['status'],
				onSelect: value => {
					if (!this.applyStatusDraftChange(value)) return;
					refresh();
					resetPickerState();
					this.markEdited();
				},
				onClear: () => {
					delete this.fieldValues['status'];
					refresh();
					resetPickerState();
					this.markEdited();
				},
				onClose: resetPickerState,
			});
			button.addClass('is-picker-open');
		};

		button.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		button.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.registerSchedulingDraftRefresher(refresh);
		refresh();
	}

	protected renderDateControl(container: HTMLElement, key: string, label: string, placeholderText = label): void {
		const control = this.createInlineField(container, label);
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});
		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: key,
				isEmpty: !value,
				showIcon: true,
				text: value ? formatUiDate(value, this.settings) : placeholderText,
			});
			this.appendWeekdayHint(button, value);
		};
		this.registerSchedulingDraftRefresher(refresh);
		refresh();

		button.addEventListener('click', () => {
			button.classList.add('is-picker-open');
			showDatePicker(button, {
				app: this.app,
				fieldKey: key,
				value: this.fieldValues[key],
				dateDisplayFormat: this.settings.dateDisplayFormat,
				manualDatePicker: this.getManualDatePickerOptions(key),
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					if (!this.applyDateDraftChange(key, value)) return;
					this.markEdited();
				},
				onRemove: () => {
					if (!this.applyDateDraftChange(key, '')) return;
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});
	}

	protected renderDatetimeControl(container: HTMLElement, key: 'datetimeStart' | 'datetimeEnd', label: string): void {
		const control = this.createInlineField(container, label);
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});

		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			const hasStart = !!(this.fieldValues['datetimeStart'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			button.disabled = key === 'datetimeEnd' && !hasStart;
			this.bindEditorHoverTooltip(button, {
				content: key === 'datetimeEnd' && !hasStart
					? t('taskEditor', 'datetimeEndRequiresStart')
					: '',
				taskColor: () => this.getThemeColor(),
			});
			this.setPickerButtonContent(button, {
				canonicalKey: key,
				isEmpty: !value,
				showIcon: true,
				text: value
					? formatUiTime(this.app, this.settings, value)
					: label,
			});
			this.appendWeekdayHint(button, value);
		};
		this.registerSchedulingDraftRefresher(refresh);

		button.addEventListener('click', () => {
			if (key === 'datetimeEnd' && !(this.fieldValues['datetimeStart'] ?? '').trim()) {
				new Notice(t('taskEditor', 'datetimeEndRequiresStart'));
				return;
			}
			button.classList.add('is-picker-open');
			showDatetimePicker(button, {
				app: this.app,
				settings: {
					timeFormat: this.settings.timeFormat,
					calendarWeekStart: this.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
				},
				dateDisplayFormat: this.settings.dateDisplayFormat,
				fieldKey: key,
				value: this.fieldValues[key],
				initialDate: key === 'datetimeStart' ? this.fieldValues['dateScheduled'] : undefined,
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					this.applyDraftFieldRules({ [key]: value }, [key]);
					this.markEdited();
				},
				onRemove: () => {
					this.applyDraftFieldRules({ [key]: '' }, [key]);
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});

		refresh();
	}

	protected renderIconControl(container: HTMLElement): void {
		const iconWrap = container.createDiv('operon-appearance-icon-wrap');
		const iconLabel = iconWrap.createEl('label', { text: t('taskEditor', 'taskIcon'), cls: 'operon-appearance-label' });
		const iconInputWrap = iconWrap.createDiv('operon-icon-button-wrap');
		const iconButton = iconInputWrap.createEl('button', {
			cls: 'operon-icon-trigger',
			attr: { type: 'button' },
		});
		let closeIconPicker: (() => void) | null = null;

		const refreshIconPreview = () => {
			iconButton.empty();
			const name = this.fieldValues['taskIcon'] ?? '';
			if (container.hasClass('operon-editor-desktop-property-value')) {
				iconButton.setText(name);
				iconButton.toggleClass('has-icon', !!name);
				setAccessibleLabelWithoutTooltip(iconButton, this.getWorkflowPickerLabel('taskIcon'));
				return;
			}
			const fallbackIds = name
				? [name]
				: ['obsidian-new', 'obsidian-logo', 'gem', 'hexagon'];
			for (const iconId of fallbackIds) {
				const svg = getIcon(iconId);
				if (!svg) continue;
				iconButton.appendChild(svg);
				setAccessibleLabelWithoutTooltip(iconButton, t('taskEditor', 'taskIcon'));
				iconButton.classList.toggle('has-icon', !!name);
				return;
			}
			setAccessibleLabelWithoutTooltip(iconButton, t('taskEditor', 'taskIcon'));
			iconButton.classList.remove('has-icon');
		};
		this.registerSchedulingDraftRefresher(refreshIconPreview);
		refreshIconPreview();

		const selectItem = (iconId: string) => {
			this.fieldValues['taskIcon'] = iconId;
			refreshIconPreview();
			this.markEdited();
		};

		const openSharedIconPicker = (query: string) => {
			closeIconPicker?.();
			if (container.hasClass('operon-editor-desktop-property-value')) iconButton.addClass('is-picker-open');
			closeIconPicker = showIconPicker(iconButton, {
				value: this.fieldValues['taskIcon'],
				query,
				onSelect: iconId => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
					selectItem(iconId);
				},
				onClear: () => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
					delete this.fieldValues['taskIcon'];
					refreshIconPreview();
					this.markEdited();
				},
				onClose: () => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
				},
			});
		};

		iconButton.addEventListener('mousedown', event => {
			event.preventDefault();
		});
		iconButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openSharedIconPicker('');
		});
		iconLabel.removeAttribute('for');
	}

	protected renderColorControl(container: HTMLElement): void {
		const colorWrap = container.createDiv('operon-appearance-color-wrap');
		colorWrap.createEl('label', { text: t('taskEditor', 'taskColor'), cls: 'operon-appearance-label' });

		const swatchWrap = colorWrap.createDiv('operon-color-swatch-wrap');
		const swatch = swatchWrap.createEl('button', {
			cls: 'operon-color-swatch',
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(swatch, t('taskEditor', 'taskColor'));

		const currentColor = this.fieldValues['taskColor'] ?? '';
		const currentColorHex = currentColor ? (currentColor.startsWith('#') ? currentColor : `#${currentColor}`) : '';

		const refreshSwatch = (hex: string) => {
			swatch.empty();
			if (container.hasClass('operon-editor-desktop-property-value')) {
				swatch.setText(hex.toUpperCase());
				swatch.toggleClass('has-color', !!hex);
				return;
			}
			if (hex) {
				const swatchDot = swatch.createSpan('operon-color-swatch-dot');
				swatchDot.style.background = hex;
			} else {
				this.appendCanonicalIcon(swatch, 'taskColor', 'operon-color-swatch-icon');
			}
			swatch.classList.toggle('has-color', !!hex);
		};
		this.registerSchedulingDraftRefresher(() => {
			const color = this.fieldValues['taskColor'] ?? '';
			refreshSwatch(color ? `#${color.replace(/^#/, '')}` : '');
		});
		refreshSwatch(currentColorHex);

		swatch.addEventListener('click', () => {
			swatch.addClass('is-picker-open');
			showColorPicker(swatch, {
				value: this.fieldValues['taskColor'],
				palette: this.settings.colorPalette,
				onSelect: value => {
					swatch.removeClass('is-picker-open');
					const hex = value ? `#${value.replace(/^#/, '')}` : '';
					this.fieldValues['taskColor'] = value.replace(/^#/, '');
					refreshSwatch(hex);
					this.applyThemeColor();
					this.markEdited();
				},
				onClear: () => {
					swatch.removeClass('is-picker-open');
					delete this.fieldValues['taskColor'];
					refreshSwatch('');
					this.applyThemeColor();
					this.markEdited();
				},
				onClose: () => {
					swatch.removeClass('is-picker-open');
				},
			});
		});
		swatch.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			delete this.fieldValues['taskColor'];
			refreshSwatch('');
			this.applyThemeColor();
			this.markEdited();
		});
	}

	protected renderAssigneesPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-assignees-setting', 'operon-editor-assignees-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'assignees'), {
			leadingIcon: this.resolveCompactChipIcon('assignees'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-assignee-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['assignees']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'assignees', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('assignees', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, value => this.formatInlineReferenceLabel(value));
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showAssigneesPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('assignees', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('assignees', selectedValues);
		render();
	}

	protected renderLocationPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-location-setting', 'operon-editor-location-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-location-stack');
		const anchor = this.createPickerAnchor(stack, t('location', 'location'), {
			leadingIcon: this.resolveCompactChipIcon('location'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-location-selection-row');
		const locationResolver = getLocationPlaceIndex(this.app, this.settings).resolve;
		let selectedValue = parseLocationCoordinate(this.fieldValues['location'])?.canonical
			?? (this.fieldValues['location'] ?? '').trim();
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const commitValue = (value: string): void => {
			const parsed = parseLocationCoordinate(value);
			if (parsed) {
				selectedValue = parsed.canonical;
				this.fieldValues['location'] = parsed.canonical;
			} else {
				selectedValue = '';
				delete this.fieldValues['location'];
			}
			render();
			this.markEdited();
			this.refreshWorkflowPickerSurfaceValues();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			const parsed = parseLocationCoordinate(selectedValue);
			selectedWrap.classList.toggle('is-empty', !selectedValue);
			if (!selectedValue) return;
			const match = parsed ? locationResolver(parsed.canonical) : null;
			const label = match?.label ?? (parsed ? formatShortLocationCoordinate(parsed) : selectedValue);
			const chip = createInlineTaskCompactChipElement({
				key: 'location',
				label,
				icon: match?.taskIcon ?? this.resolveCompactChipIcon('location'),
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
				locationCoordinate: parsed?.canonical ?? null,
				locationMarkerIcon: match?.taskIcon ?? null,
				locationMarkerColor: match?.taskColor ?? null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			chip.style.setProperty('--operon-inline-chip-icon-color', match?.taskColor ?? this.getThemeColor());
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: label }));
			removeButton.addEventListener('click', () => {
				closeActivePicker();
				commitValue('');
			});
			chip.appendChild(removeButton);
			selectedWrap.appendChild(chip);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showLocationPicker(anchor, {
				app: this.app,
				settings: this.settings,
				value: selectedValue,
				onSelect: (value) => {
					commitValue(value);
					closeActivePicker();
				},
				onClear: () => {
					commitValue('');
					closeActivePicker();
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		const initialParsed = parseLocationCoordinate(selectedValue);
		if (initialParsed) {
			this.fieldValues['location'] = initialParsed.canonical;
		}
		render();
	}

	protected renderLinksPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-links-setting', 'operon-editor-links-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'links'), {
			leadingIcon: this.resolveCompactChipIcon('links'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-link-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['links']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'links', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('links', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, formatExternalLinkDisplay);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showLinksPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('links', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('links', selectedValues);
		render();
	}

	protected renderRelatedPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-related-setting', 'operon-editor-inline-picker-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'related'), {
			leadingIcon: this.resolveWorkflowPickerIcon('related'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-related-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['related']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			selectedWrap.classList.toggle('is-empty', selectedValues.length === 0);
			for (const value of selectedValues) {
				const label = this.formatInlineReferenceLabel(value);
				const chip = createInlineTaskCompactChipElement({
					key: 'links',
					label,
					icon: this.resolveWorkflowPickerIcon('related'),
					iconOnly: false,
					interactive: false,
					colorRole: 'default',
					linkTarget: null,
				}, 'operon-editor-compact-selection-chip', { forceFull: true });
				this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
				const removeButton = chip.ownerDocument.win.createEl('button');
				removeButton.type = 'button';
				removeButton.className = 'operon-editor-compact-selection-chip-remove';
				setIcon(removeButton, 'x');
				setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: label }));
				removeButton.addEventListener('click', () => {
					closeActivePicker();
					selectedValues = selectedValues.filter(existing => existing !== value);
					this.setDelimitedFieldValue('related', selectedValues);
					render();
					this.markEdited();
					this.refreshWorkflowPickerSurfaceValues();
				});
				chip.appendChild(removeButton);
				selectedWrap.appendChild(chip);
			}
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showRelatedPicker(anchor, {
				app: this.app,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('related', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('related', selectedValues);
		render();
	}

	protected renderContextsPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-contexts-setting', 'operon-editor-contexts-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-contexts-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'contexts'), {
			leadingIcon: this.resolveCompactChipIcon('contexts'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-context-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['contexts']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'contexts', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('contexts', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, formatContextDisplay);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showContextsPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('contexts', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('contexts', selectedValues);
		render();
	}
	protected abstract refreshSchedulingDraftControls(): void;
	protected abstract refreshEstimateReallocationControl: (() => void) | null;
	protected abstract refreshMobileCoreButtons(): void;
	protected abstract checkbox: 'open' | 'done' | 'cancelled';
	protected abstract onApplyEstimateReallocation: ((
		request: TaskEditorEstimateReallocationRequest,
	) => Promise<TaskEditorEstimateReallocationApplyResult>) | null;
	protected abstract getEstimateReallocationProposal(): ManualEstimateReallocationProposal | null;
	protected abstract getEstimateReallocationTooltip(): string;
	protected abstract handleEstimateReallocationClick(): Promise<void>;
	protected abstract persistedFieldValues: Record<string, string>;
	protected abstract taskOperonId: string | null;
	protected abstract getRepeatSkipDates: ((repeatSeriesId: string) => string[]) | null;
	protected abstract onUpdateRepeatSkips: ((request: TaskEditorRepeatSkipUpdateRequest) => Promise<TaskEditorRepeatSkipUpdateResult> | TaskEditorRepeatSkipUpdateResult) | null;
	protected abstract getRepeatDayPickerPopoverOptions(): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean };
	protected applyDraftFieldRules(
		patch: Record<string, string>,
		changedKeys: string[],
		options: { refreshEstimateReallocation?: boolean } = {},
	): void {
		const normalizedPatch = applyFieldRules({
			current: this.fieldValues,
			patch,
			changedKeys,
		}).patch;
		for (const [key, value] of Object.entries(normalizedPatch)) {
			if (value.trim()) {
				this.fieldValues[key] = value;
			} else {
				delete this.fieldValues[key];
			}
		}
		this.syncDerivedRepeatFieldsFromDraft();
		this.refreshSchedulingDraftControls();
		if (REMINDER_RULE_ANCHORS.some(anchor => anchor in normalizedPatch)) {
			this.refreshWorkflowPickerSurfaceValues();
		}
		if (options.refreshEstimateReallocation === true) {
			this.refreshEstimateReallocationControl?.();
		}
		this.refreshMobileCoreButtons();
	}

	protected applyTerminalDateDraftChange(
		key: 'dateCompleted' | 'dateCancelled',
		value: string,
	): boolean {
		const normalizedValue = value.trim();
		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			this.fieldValues['status'],
			this.settings.defaultPipelineName,
			key,
			normalizedValue,
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('taskEditor', 'terminalDateWorkflowResolveFailed'));
			return false;
		}

		this.fieldValues['status'] = resolution.workflow.value;
		this.checkbox = resolution.checkbox;
		if (normalizedValue) {
			this.fieldValues[key] = normalizedValue;
			delete this.fieldValues[key === 'dateCompleted' ? 'dateCancelled' : 'dateCompleted'];
		} else {
			delete this.fieldValues['dateCompleted'];
			delete this.fieldValues['dateCancelled'];
		}
		this.refreshSchedulingDraftControls();
		this.refreshEstimateReallocationControl?.();
		this.refreshMobileCoreButtons();
		return true;
	}

	protected applyDateDraftChange(key: string, value: string): boolean {
		if (key === 'dateCompleted' || key === 'dateCancelled') {
			return this.applyTerminalDateDraftChange(key, value);
		}
		this.applyDraftFieldRules({ [key]: value }, [key]);
		return true;
	}

	protected applyStatusDraftChange(value: string): boolean {
		const previousFieldValues = { ...this.fieldValues };
		const previousCheckbox = this.checkbox;
		this.fieldValues['status'] = value;
		const resolved = resolveWorkflowStatus(this.settings.pipelines, value);
		if (!resolved) {
			new Notice(t('taskEditor', 'terminalDateWorkflowResolveFailed'));
			this.fieldValues = previousFieldValues;
			this.checkbox = previousCheckbox;
			this.refreshSchedulingDraftControls();
			this.refreshMobileCoreButtons();
			return false;
		}

		this.checkbox = resolved.checkbox;
		const today = localToday();
		if (resolved.terminalDateKey === 'dateCompleted') {
			this.fieldValues['dateCompleted'] = this.fieldValues['dateCompleted'] || today;
			delete this.fieldValues['dateCancelled'];
		} else if (resolved.terminalDateKey === 'dateCancelled') {
			this.fieldValues['dateCancelled'] = this.fieldValues['dateCancelled'] || today;
			delete this.fieldValues['dateCompleted'];
		} else {
			delete this.fieldValues['dateCompleted'];
			delete this.fieldValues['dateCancelled'];
		}
		this.refreshSchedulingDraftControls();
		this.refreshMobileCoreButtons();
		return true;
	}

	protected applyTaskFieldPickerPayload(payload: Record<string, string | string[]>): void {
		const patch: Record<string, string> = {};
		for (const [key, value] of Object.entries(payload)) {
			patch[key] = Array.isArray(value) ? value.join('; ') : value;
		}
		const changedKeys = Object.keys(patch);
		this.applyDraftFieldRules(patch, changedKeys, {
			refreshEstimateReallocation: changedKeys.includes('parentTask'),
		});
	}

	protected renderEstimateControl(container: HTMLElement): void {
		this.refreshEstimateReallocationControl = null;
		const control = this.createInlineField(container, t('taskEditor', 'estimateMinutesShort'));
		control.parentElement?.addClass('operon-editor-estimate-field');
		control.addClass('operon-editor-estimate-input-row');
		const shell = control.createDiv('operon-editor-estimate-input-shell');
		const placeholder = shell.createDiv('operon-editor-estimate-placeholder');
		this.appendCanonicalIcon(placeholder, 'estimate', 'operon-editor-estimate-placeholder-icon');
		placeholder.createSpan({
			cls: 'operon-editor-estimate-placeholder-text',
			text: t('taskEditor', 'estimateMinutesShort'),
		});
		const input = shell.createEl('input', {
			attr: { type: 'number', placeholder: '' },
		});
		const sizeInput = () => {
			if (container.hasClass('operon-editor-desktop-property-value')) input.style.width = `calc(${Math.max(2, input.value.length + 1)}ch + 20px)`;
		};
		let refreshButtonState = (): void => { };
		const refresh = (): void => {
			const seconds = parseInt(this.fieldValues['estimate'] ?? '0', 10);
			input.value = seconds > 0 ? String(Math.round(seconds / 60)) : '';
			shell.classList.toggle('has-value', input.value.length > 0);
			sizeInput();
		};
		this.registerSchedulingDraftRefresher(refresh);
		const applyInputValue = (refreshEstimateReallocation = false): void => {
			const minutes = parseInt(input.value, 10);
			this.applyDraftFieldRules(
				{ estimate: minutes > 0 ? String(minutes * 60) : '' },
				['estimate'],
				{ refreshEstimateReallocation },
			);
		};
		const commitInputValue = (): void => {
			applyInputValue(true);
			this.markEdited();
		};
		input.addEventListener('input', () => {
			applyInputValue();
			shell.classList.toggle('has-value', input.value.length > 0);
			sizeInput();
			this.markEdited();
		});
		input.addEventListener('change', commitInputValue);
		shell.addEventListener('click', () => input.focus());
		refresh();

		if (!this.onApplyEstimateReallocation) return;

		const actions = control.createDiv('operon-editor-estimate-actions');
		const button = actions.createEl('button', {
			cls: 'operon-editor-estimate-reallocate is-compact',
			text: 'Δ',
			attr: { type: 'button', 'aria-label': t('taskEditor', 'estimateReallocationButton') },
		});
		// Measure the former action width so only its saved space goes to the time fields.
		const measure = actions.createEl('button', {
			cls: 'operon-editor-estimate-reallocate operon-editor-estimate-width-probe',
			text: t('taskEditor', 'estimateReallocationButton'),
			attr: { type: 'button', 'aria-hidden': 'true', tabindex: '-1' },
		});
		getActiveWindow().requestAnimationFrame(() => {
			if (button.isConnected) {
				const savedWidth = Math.max(0, measure.getBoundingClientRect().width - button.getBoundingClientRect().width);
				container.style.setProperty('--operon-editor-estimate-action-savings', `${savedWidth}px`);
			}
			measure.remove();
		});
		refreshButtonState = (): void => {
			const proposal = this.getEstimateReallocationProposal();
			const tooltip = this.getEstimateReallocationTooltip();
			button.disabled = !proposal;
			this.bindEditorHoverTooltip(button, { content: tooltip, taskColor: () => this.getThemeColor() });
			this.bindEditorHoverTooltip(actions, { content: tooltip, taskColor: () => this.getThemeColor() });
		};
		button.addEventListener('click', () => {
			void this.handleEstimateReallocationClick();
		});
		this.refreshEstimateReallocationControl = refreshButtonState;
		refreshButtonState();
	}

	protected renderRepeatControl(container: HTMLElement): void {
		const control = this.createInlineField(container, t('taskEditor', 'repeat'));
		control.parentElement?.addClass('operon-editor-repeat-row');
		const actions = control.createDiv('operon-editor-repeat-actions');
		const main = actions.createDiv('operon-editor-repeat-main');
		const trigger = main.createEl('button', {
			cls: 'operon-editor-repeat-trigger',
			attr: { type: 'button' },
		});
		const skipButton = actions.createEl('button', {
			cls: 'operon-editor-repeat-skip',
			attr: { type: 'button' },
			text: t('taskEditor', 'repeatSkip'),
		});

		const refresh = () => {
			const extractDatePart = (value: string | undefined): string => {
				const trimmed = (value ?? '').trim();
				if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
				if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
				return '';
			};

			const raw = (this.fieldValues['repeat'] ?? '').trim();
			const parsed = parseRepeatRule(raw);
			const repeatSeriesId = (this.fieldValues['repeatSeriesId'] ?? '').trim();
			const persistedRepeat = (this.persistedFieldValues['repeat'] ?? '').trim();
			const persistedSeriesId = (this.persistedFieldValues['repeatSeriesId'] ?? '').trim();
			const repeatContextDirty = (
				raw !== persistedRepeat
				|| repeatSeriesId !== persistedSeriesId
				|| ((this.fieldValues['repeatOccurrenceDate'] ?? '').trim() !== (this.persistedFieldValues['repeatOccurrenceDate'] ?? '').trim())
				|| ((this.fieldValues['dateScheduled'] ?? '').trim() !== (this.persistedFieldValues['dateScheduled'] ?? '').trim())
				|| ((this.fieldValues['dateDue'] ?? '').trim() !== (this.persistedFieldValues['dateDue'] ?? '').trim())
				|| ((this.fieldValues['dateStarted'] ?? '').trim() !== (this.persistedFieldValues['dateStarted'] ?? '').trim())
				|| ((this.fieldValues['datetimeStart'] ?? '').trim() !== (this.persistedFieldValues['datetimeStart'] ?? '').trim())
				|| ((this.fieldValues['datetimeEnd'] ?? '').trim() !== (this.persistedFieldValues['datetimeEnd'] ?? '').trim())
				|| ((this.fieldValues['datetimeRepeatEnd'] ?? '').trim() !== (this.persistedFieldValues['datetimeRepeatEnd'] ?? '').trim())
			);
			skipButton.disabled = true;
			this.bindEditorHoverTooltip(skipButton, {
				content: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: () => this.getThemeColor(),
			});
			if (!raw) {
				trigger.empty();
				this.appendCanonicalIcon(trigger, 'repeat', 'operon-editor-picker-button-leading-icon');
				trigger.createSpan({
					cls: 'operon-editor-picker-button-text',
					text: t('taskEditor', 'repeatAdd'),
				});
				return;
			}

			trigger.textContent = parsed ? formatRepeatRuleSummaryI18n(parsed) : raw;
			if (!parsed) {
				return;
			}

			const hasAnchor = !!(
				extractDatePart(this.fieldValues['repeatOccurrenceDate'])
				|| extractDatePart(this.fieldValues['dateScheduled'])
				|| extractDatePart(this.fieldValues['dateDue'])
				|| extractDatePart(this.fieldValues['dateStarted'])
				|| extractDatePart(this.fieldValues['datetimeStart'])
				|| extractDatePart(this.fieldValues['datetimeEnd'])
			);
			const canManageFutureSkips = !!(
				this.taskOperonId
				&& this.getRepeatSkipDates
				&& this.onUpdateRepeatSkips
				&& repeatSeriesId
				&& !repeatContextDirty
				&& hasAnchor
				&& (parsed.mode === 'schedule' || parsed.mode === 'count')
			);
			skipButton.disabled = !canManageFutureSkips;
			this.bindEditorHoverTooltip(skipButton, {
				content: parsed.mode === 'done'
					? t('taskEditor', 'repeatSkipModeDoneHint')
					: canManageFutureSkips
						? ''
						: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: () => this.getThemeColor(),
			});
		};

		const openPicker = (event?: Event) => {
			event?.preventDefault();
			event?.stopPropagation();
			if (container.hasClass('operon-editor-desktop-property-value')) trigger.addClass('is-picker-open');
			showRepeatPicker(trigger, {
				onClose: () => trigger.removeClass('is-picker-open'),
				value: this.fieldValues['repeat'],
				repeatEnd: this.fieldValues['datetimeRepeatEnd'],
				repeatSeriesId: this.fieldValues['repeatSeriesId'],
				taskColor: this.fieldValues['taskColor'],
				repeatOccurrenceDate: this.fieldValues['repeatOccurrenceDate'],
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				dateStarted: this.fieldValues['dateStarted'],
				datetimeStart: this.fieldValues['datetimeStart'],
				datetimeEnd: this.fieldValues['datetimeEnd'],
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				inlineCompletionMode: this.inlineCompletionMode,
				dayPickerPopover: this.getRepeatDayPickerPopoverOptions(),
				onSave: ({ repeat, datetimeRepeatEnd, repeatOccurrenceDate, inlineCompletionMode }) => {
					this.fieldValues['repeat'] = repeat;
					if (datetimeRepeatEnd) this.fieldValues['datetimeRepeatEnd'] = datetimeRepeatEnd;
					else delete this.fieldValues['datetimeRepeatEnd'];
					if (repeatOccurrenceDate) {
						this.fieldValues['repeatOccurrenceDate'] = repeatOccurrenceDate;
					}
					this.ensureRepeatSeriesIdentity();
					this.inlineCompletionMode = inlineCompletionMode;
					this.syncDerivedRepeatFieldsFromDraft();
					this.markEdited();
					refresh();
				},
				onClear: () => {
					delete this.fieldValues['repeat'];
					delete this.fieldValues['datetimeRepeatEnd'];
					delete this.fieldValues['repeatSeriesId'];
					delete this.fieldValues['repeatOccurrenceDate'];
					this.inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
					this.markEdited();
					refresh();
				},
			});
		};
		const openSkipPicker = async (event?: Event) => {
			event?.preventDefault();
			event?.stopPropagation();
			const rawRepeat = (this.fieldValues['repeat'] ?? '').trim();
			const parsed = parseRepeatRule(rawRepeat);
			const repeatSeriesId = (this.fieldValues['repeatSeriesId'] ?? '').trim();
			if (!parsed || !repeatSeriesId || !this.taskOperonId || !this.getRepeatSkipDates || !this.onUpdateRepeatSkips) return;
			if (parsed.mode !== 'schedule' && parsed.mode !== 'count') return;
			if (container.hasClass('operon-editor-desktop-property-value')) skipButton.addClass('is-picker-open');
			showRepeatSkipPicker(skipButton, {
				onClose: () => skipButton.removeClass('is-picker-open'),
				taskId: this.taskOperonId,
				repeat: rawRepeat,
				repeatSeriesId,
				repeatOccurrenceDate: this.fieldValues['repeatOccurrenceDate'],
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				dateStarted: this.fieldValues['dateStarted'],
				datetimeStart: this.fieldValues['datetimeStart'],
				datetimeEnd: this.fieldValues['datetimeEnd'],
				datetimeRepeatEnd: this.fieldValues['datetimeRepeatEnd'],
				taskColor: this.fieldValues['taskColor'],
				existingSkipDates: this.getRepeatSkipDates(repeatSeriesId),
				onSave: async ({ skipDates }) => {
					const result = await this.onUpdateRepeatSkips?.({
						operonId: this.taskOperonId!,
						repeatSeriesId,
						skipDates,
					});
					if (result && 'datetimeRepeatEnd' in result) {
						const nextEnd = (result.datetimeRepeatEnd ?? '').trim();
						if (nextEnd) {
							this.fieldValues['datetimeRepeatEnd'] = nextEnd;
							this.persistedFieldValues['datetimeRepeatEnd'] = nextEnd;
						} else {
							delete this.fieldValues['datetimeRepeatEnd'];
							delete this.persistedFieldValues['datetimeRepeatEnd'];
						}
					}
					refresh();
				},
			});
		};
		const stopRepeatPress = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		};

		trigger.addEventListener('mousedown', stopRepeatPress);
		trigger.addEventListener('click', openPicker);
		skipButton.addEventListener('mousedown', stopRepeatPress);
		skipButton.addEventListener('click', event => { void openSkipPicker(event); });
		control.addEventListener('mousedown', stopRepeatPress);
		control.addEventListener('click', event => {
			if (event.target === trigger || event.target === skipButton) return;
			if (skipButton.contains(event.target as Node)) return;
			openPicker(event);
		});
		this.registerSchedulingDraftRefresher(refresh);
		refresh();
	}

	protected abstract openParentTaskWorkflowAction(anchor: HTMLElement, onClose: () => void): (() => void) | null;
	protected abstract openSubtasksWorkflowAction(anchor: HTMLElement, onClose: () => void): (() => void) | null;
	protected abstract openDependencyWorkflowAction(anchor: HTMLElement, fieldKey: 'blocking' | 'blockedBy', onClose: () => void): (() => void) | null;
	protected abstract desktopPropertyRows: Map<string, { row: HTMLElement; value: HTMLElement; core: boolean; signature: string }>;
	protected openWorkflowPickerFromAction(key: string, button: HTMLButtonElement): void {
		this.propertyInteractionEpoch += 1;
		if (button.hasClass('is-locked')) {
			new Notice(t('taskEditor', 'subtasksSaveFirst'));
			return;
		}

		this.closeActiveWorkflowActionPicker();
		button.addClass('is-picker-open');
		let closePicker: (() => void) | null = null;
		let focusRestoreScheduled = false;
		const restoreReminderActionFocus = () => {
			if (!this.isSystemReminderWorkflowKey(key) || focusRestoreScheduled) return;
			focusRestoreScheduled = true;
			const ownerWindow = button.ownerDocument.defaultView ?? getActiveWindow();
			scheduleTaskEditorReminderFocus({
				ownerWindow,
				fieldKey: key,
				focusIndex: -1,
				getWorkflowRows: () => this.workflowRowsEl,
				getActionButton: () => this.workflowActionButtons.get(key),
				shouldFocus: () => !this.workflowActionPickerClose,
			});
		};
		const handleClose = () => {
			button.removeClass('is-picker-open');
			if (this.workflowActionPickerClose === closePicker) {
				this.workflowActionPickerClose = null;
				if (this.readSource) void this.refreshTaskSource();
			}
			if (!this.disposed && button.hidden) this.getWorkflowActionFocusTarget(key)?.focus({ preventScroll: true });
			restoreReminderActionFocus();
		};

		if (key === 'parentTask') {
			closePicker = this.openParentTaskWorkflowAction(button, handleClose);
		} else if (key === 'subtasks') {
			closePicker = this.openSubtasksWorkflowAction(button, handleClose);
		} else if (key === 'blocking' || key === 'blockedBy') {
			closePicker = this.openDependencyWorkflowAction(button, key, handleClose);
		} else {
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: key,
				manualDatePicker: this.hasDesktopPropertyRules() ? this.getManualDatePickerOptions(key) : undefined,
				anchor: button,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				...(this.isSystemReminderWorkflowKey(key) ? {
					reminderOperation: {
						kind: 'add' as const,
					},
				} : {}),
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				closeListPickerOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				repeatInlineCompletionMode: this.inlineCompletionMode,
				onCommit: payload => this.commitWorkflowActionPayload(payload),
				onRepeatInlineCompletionModeChange: mode => {
					this.inlineCompletionMode = normalizeInlineCompletionMode(mode);
				},
				onClose: handleClose,
				onCancel: handleClose,
			});
		}

		if (closePicker) {
			this.workflowActionPickerClose = closePicker;
			return;
		}
		button.removeClass('is-picker-open');
	}

	protected closeActiveWorkflowActionPicker(): void {
		const current = this.workflowActionPickerClose;
		this.workflowActionPickerClose = null;
		for (const entry of this.desktopPropertyRows.values()) {
			entry.value.removeClass('is-picker-open');
			entry.row.querySelector('.operon-editor-desktop-property-label')?.removeClass('is-picker-open');
		}
		for (const button of this.workflowActionButtons.values()) {
			button.removeClass('is-picker-open');
		}
		if (current) current();
	}

	protected hasDesktopPropertyRules(): boolean { return (this.desktopPropertyRows?.size ?? 0) > 0; }

	protected commitWorkflowActionPayload(payload: Record<string, string | string[]>): void {
		if (this.hasDesktopPropertyRules()) {
			const remaining = { ...payload };
			if (typeof remaining.status === 'string') {
				if (remaining.status) {
					if (!this.applyStatusDraftChange(remaining.status)) return;
				} else delete this.fieldValues['status'];
				delete remaining.status;
			}
			for (const key of ['dateCompleted', 'dateCancelled']) {
				const value = remaining[key];
				if (typeof value !== 'string') continue;
				if (!this.applyDateDraftChange(key, value)) return;
				delete remaining[key];
			}
			if (typeof remaining.repeat === 'string') this.prepareRepeatIdentityPatch(remaining);
			payload = remaining;
		}
		const fieldPayload: Record<string, string | string[]> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (key === 'tags') {
				const values = Array.isArray(value) ? value : splitTaskListValue(value);
				this.tags = normalizeListValues(values.map(tag => tag.replace(/^#/, '')));
			} else {
				fieldPayload[key] = value;
			}
		}
		if (Object.keys(fieldPayload).length > 0) {
			this.applyTaskFieldPickerPayload(fieldPayload);
		}
		this.refreshSchedulingDraftControls();
		this.applyThemeColor();
		this.markEdited();
		this.refreshWorkflowPickerSurfaceValues();
	}

	protected shouldCloseWorkflowPickerOnSelect(): boolean {
		return this.isPhone;
	}

	protected isSystemReminderWorkflowKey(key: string): key is ReminderPickerFieldKey {
		return (key === 'reminderDatetimes' || key === 'reminderRules')
			&& !getCustomFieldMapping(this.settings.keyMappings, key);
	}

	protected abstract filePropertyUnavailable: boolean;
	protected abstract fileProperties: Map<string, EditorFileProperty>;
	protected abstract filePropertyRows: Map<string, { row: HTMLElement; value: HTMLElement; action: HTMLButtonElement }>;
	protected abstract setFilePropertyValue(name: string, value: RawYamlPropertyValue): void;
	protected abstract additionalPropertyAdd: HTMLButtonElement | null;
	protected abstract filePropertyPickerName: string | null;
	protected abstract filePropertyPickerValue: string | null;
	protected abstract closeFilePropertyPicker: (() => void) | null;
	protected abstract refreshDesktopFileProperties(): Promise<void>;
	protected canEditFileProperty(entry: EditorFileProperty): boolean {
		if (!entry || this.filePropertyUnavailable || entry.readonly || !entry.baseline) return false;
		if (isEmptyFilePropertyValue(entry.value)) return true;
		try { encodeVaultPropertyValue(entry.value as VaultPropertyValue, entry.field.type as InlinePropertyType); return true; }
		catch { return false; }
	}

	protected refreshFilePropertyValue(name: string): void {
		const entry = this.fileProperties.get(name), surface = this.filePropertyRows.get(name);
		if (!entry || !surface) return;
		const populated = !isEmptyFilePropertyValue(entry.value);
		this.syncFilePropertyRowVisibility(entry, surface, populated);
		surface.action.toggleClass('is-active', populated);
		surface.action.disabled = !this.canEditFileProperty(entry);
		const label = surface.row.querySelector<HTMLButtonElement>('.operon-editor-desktop-property-label');
		if (label) { label.disabled = false; label.setAttribute('aria-disabled', String(surface.action.disabled)); }
		surface.value.toggleClass('is-readonly', surface.action.disabled);
		surface.row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon')?.toggleClass('has-value', populated);
		const editable = this.canEditFileProperty(entry);
		const reason = this.filePropertyUnavailable ? 'unavailable' : !editable ? entry.readOnlyReason ?? 'type-conflict' : undefined;
		const automatic = reason === 'automatic';
		surface.row.toggleClass('is-automatic-property', automatic);
		surface.action.toggleClass('is-automatic-property', automatic);
		surface.action.empty();
		const valueIcon = entry.field.type === 'checkbox' ? getCheckboxPropertyIcon(entry.value, entry.field.icon) : entry.field.icon;
		setIcon(surface.action, automatic ? 'shield-alert' : valueIcon);
		const icon = surface.row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon');
		if (icon) { icon.empty(); setIcon(icon, automatic ? 'shield-alert' : valueIcon); }
		if (reason) bindPropertyReadOnlyWarning(surface.action, name, reason, () => this.getThemeColor());
		else this.bindEditorHoverTooltip(surface.action, { content: name, taskColor: () => this.getThemeColor() });
		const labelName = label?.querySelector<HTMLElement>('.operon-editor-desktop-property-name') ?? null;
		if (label) {
			cleanupOperonHoverTooltips(label);
			if (reason) bindPropertyReadOnlyWarning(label, name, reason, () => this.getThemeColor());
			else this.bindTruncatedTextTooltip(labelName);
		}
		cleanupOperonHoverTooltips(surface.value);
		const values = !populated ? [] : Array.isArray(entry.value) && editable ? entry.value.map(item => encodeVaultPropertyValue([item], 'list')) : [this.formatFilePropertyValue(entry.value)];
		const display: EditorFieldDisplay = { canonicalKey: entry.field.key, visiblePropertyName: name, type: entry.field.type as KeyMapping['type'], icon: entry.field.icon };
		this.renderCustomFieldSelection(surface.value, display, editable ? (_value, index) => {
			const next = entry.field.type === 'list' ? (entry.value as (string | number)[]).filter((_item, position) => position !== index) : entry.field.type === 'text' ? '' : null;
			this.setFilePropertyValue(name, next);
			(surface.action.hidden ? this.additionalPropertyAdd : surface.action)?.focus({ preventScroll: true });
		} : null, {
			values, suppressValueTooltip: !!reason, onActivate: (chip, value, index) => {
				if (reason) { setAccessibleLabelWithoutTooltip(chip, propertyReadOnlyWarningText(name, reason)); return; }
				chip.setAttr('tabindex', '0'); chip.setAttr('role', 'button'); setAccessibleLabelWithoutTooltip(chip, `${name}: ${this.formatCustomFieldDisplayValue(display, value)}`);
				const open = () => this.openFilePropertyPicker(name, value, 'popover', chip, entry.field.type === 'list' ? index : undefined);
				chip.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('button')) open(); });
				chip.addEventListener('keydown', event => { if (event.target === chip && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
				if (this.filePropertyPickerName === name && this.filePropertyPickerValue === value) chip.addClass('is-picker-open');
			}
		});
		if (reason) bindPropertyReadOnlyWarning(surface.value, name, reason, () => this.getThemeColor());
	}

	protected formatFilePropertyValue(value: unknown): string {
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
		try { return isSupportedRawYamlPropertyValue(value) ? JSON.stringify(value) : stringifyYaml(value).trim(); }
		catch { return t('taskEditor', 'filePropertyReadOnly', { name: '' }); }
	}

	protected confirmNewFileProperty(_entry: EditorFileProperty): boolean { return false; }

	protected getFilePropertyPickerOwner(surface: { action: HTMLButtonElement }): HTMLElement { return surface.action; }

	protected openFilePropertyPicker(name: string, value?: string, textEditRoute: 'picker' | 'popover' = 'picker', anchor?: HTMLElement, editListIndex?: number): void {
		const entry = this.fileProperties.get(name), surface = this.filePropertyRows.get(name);
		if (!entry || !surface || !this.canEditFileProperty(entry)) return;
		const epoch = ++this.propertyInteractionEpoch;
		for (const prior of this.filePropertyRows.values()) {
			prior.action.removeClass('is-picker-open');
			for (const element of Array.from(prior.row.querySelectorAll('.is-picker-open'))) element.removeClass('is-picker-open');
		}
		this.closeFilePropertyPicker?.();
		const pickerAnchor = anchor ?? (surface.action.hidden ? this.additionalPropertyAdd : surface.action);
		if (!pickerAnchor) return;
		this.filePropertyPickerName = name; this.filePropertyPickerValue = value ?? null; pickerAnchor.addClass('is-picker-open'); surface.action.addClass('is-picker-open');
		let closePicker: (() => void) | null = null;
		const close = () => {
			if (this.closeFilePropertyPicker !== closePicker) return;
			this.closeFilePropertyPicker = null; this.filePropertyPickerName = null; this.filePropertyPickerValue = null;
			if (this.readSource) void this.refreshTaskSource();
			surface.action.removeClass('is-picker-open'); pickerAnchor.removeClass('is-picker-open'); this.refreshFilePropertyValue(name);
			if (this.fileProperties.get(name)?.pending) this.fileProperties.delete(name);
			if (!this.disposed) void this.refreshDesktopFileProperties();
			if (!this.disposed && this.propertyInteractionEpoch === epoch) (surface.row.hidden ? this.additionalPropertyAdd : pickerAnchor.isConnected ? pickerAnchor : surface.value)?.focus({ preventScroll: true });
		};
		closePicker = openTableFilePropertyPicker({
			app: this.app, anchor: pickerAnchor, field: entry.field, label: name, textEditRoute,
			cellValue: { present: entry.baseline?.present ?? true, rawValue: entry.value, normalizedValue: isEmptyFilePropertyValue(entry.value) ? '' : String(entry.value) },
			candidates: collectNativeFieldValueCandidates(this.app, this.indexer.getAllTasks(), this.settings.keyMappings, name, entry.field.type), settings: this.settings, sourcePath: this.fileBodyContext?.filePath ?? '', lifecycleOwner: this.getFilePropertyPickerOwner(surface), preserveListValues: true, nativeList: true, confirmList: this.confirmNewFileProperty(entry), editListIndex,
			onMutation: mutation => { this.setFilePropertyValue(name, mutation.kind === 'delete' ? entry.field.type === 'text' ? '' : entry.field.type === 'list' ? [] : null : mutation.value); },
			onClose: close,
		});
		this.closeFilePropertyPicker = closePicker;
	}

	protected addDesktopCoreClear(value: HTMLElement, key: string): void {
		const control = value.querySelector<HTMLElement>('.operon-icon-trigger, .operon-color-swatch, .operon-editor-repeat-trigger, .operon-editor-estimate-input-shell, .operon-editor-picker-button');
		if (!control?.parentElement) return;
		const token = control.ownerDocument.win.createDiv('operon-editor-value-token');
		control.parentElement.insertBefore(token, control); token.appendChild(control);
		const clear = token.createEl('button', { cls: 'operon-editor-value-clear', attr: { type: 'button' } });
		token.addClass('has-visible-clear');
		setIcon(clear, 'x'); setAccessibleLabelWithoutTooltip(clear, t('taskEditor', 'removeValue', { value: this.getWorkflowPickerLabel(key) }));
		clear.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			if (!this.hasWorkflowPickerValue(key)) return;
			const patch: Record<string, string> = { [key]: '' };
			if (key === 'repeat') {
				Object.assign(patch, { datetimeRepeatEnd: '', repeatSeriesId: '', repeatOccurrenceDate: '' });
				this.inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
			}
			this.commitWorkflowActionPayload(patch);
			this.workflowActionButtons.get(key)?.focus({ preventScroll: true });
		});
	}

	protected isNativeCustomProperty(key: string): boolean {
		const mapping = this.settings.keyMappings.find(item => item.canonicalKey === key && item.isSystem === false);
		if (!mapping) return false;
		try { return resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, this.settings.keyMappings, this.settings.inlinePropertyDefinitions).encoding === 'vault-v1'; }
		catch { return false; }
	}

	protected nativePropertyField(name: string, type: InlinePropertyType): TableFilePropertyField {
		return {
			key: encodeFilePropertyColumnKey(name)!, label: name, propertyName: name, type, sourceType: type === 'list' ? 'multitext' : type,
			group: 'fileProperty', icon: type === 'checkbox' ? getCheckboxPropertyTypeIcon(this.settings.keyMappings, name) : getNativePropertyIcon(this.settings.keyMappings, name, getTableFilePropertyTypeIcon(type)), readonly: false, aliases: [], sourceFileCount: 1
		};
	}

	protected syncDerivedRepeatFieldsFromDraft(): void {
		const rule = parseRepeatRule(this.fieldValues['repeat']);
		if (!rule || rule.mode !== 'count') return;
		const repeatEnd = deriveCountModeRepeatEndFromFieldValues(
			this.fieldValues,
			seriesId => this.getRepeatSkipDates?.(seriesId) ?? [],
		);
		if (!repeatEnd) {
			delete this.fieldValues['datetimeRepeatEnd'];
			return;
		}
		this.fieldValues['datetimeRepeatEnd'] = repeatEnd;
	}
}
