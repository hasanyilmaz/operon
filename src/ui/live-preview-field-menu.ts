import { App, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { IndexedTask, ParsedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { isInternalCanonicalKey } from '../types/keys';
import { buildForwardMapping } from '../core/yaml-fields';
import { t } from '../core/i18n';
import { showStatusPicker } from './field-pickers/status-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showDatePicker, type ManualDatePickerOptions } from './field-pickers/date-picker';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { showTagPicker } from './field-pickers/tag-picker';
import { showContextsPicker } from './field-pickers/contexts-picker';
import { showLinksPicker } from './field-pickers/links-picker';
import { showAssigneesPicker } from './field-pickers/assignees-picker';
import { showColorPicker } from './field-pickers/color-picker';
import { showRepeatPicker } from './field-pickers/repeat-picker';
import { showSubtasksPicker } from './field-pickers/subtasks-picker';
import { showDependencyTaskPicker } from './field-pickers/dependency-task-picker';
import { createButton, createFloatingPanel } from './field-pickers/common';
import { splitTaskListValue } from '../core/task-field-patch';
import { buildSubtaskExcludedIds } from '../core/task-hierarchy';
import { collectHiddenKeys } from './compact-task-layout';
import { asHTMLElement, getOwnerWindow } from '../core/dom-compat';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import {
	getCustomFieldMapping,
	getCustomSurfaceKeyMappings,
	isManagedSurfaceField,
	isProjectedCustomFieldType,
} from './custom-field-surfaces';

interface LivePreviewFieldMenuOptions {
	app: App;
	task: IndexedTask | undefined;
	parsedTask: ParsedTask;
	settings: OperonSettings;
	allTasks: IndexedTask[];
	updateField: (key: string, value: string, restoreCursor?: LivePreviewCursorRestoreRequest) => void | Promise<void>;
	updateFields?: (payload: Record<string, string>, restoreCursor?: LivePreviewCursorRestoreRequest) => void | Promise<void>;
	updateSubtasks?: (subtaskIds: string[]) => void;
	updateDependencyField?: (field: 'blocking' | 'blockedBy', value: string) => void;
	repeatInlineCompletionMode?: InlineRepeatCompletionMode;
	onRepeatInlineCompletionModeChange?: (mode: InlineRepeatCompletionMode) => void | Promise<void>;
	openEditor: () => void;
	revealSource?: () => void;
	visibleKeys?: Iterable<string>;
	editorView?: EditorView;
}

interface LivePreviewCursorRestoreRequest {
	filePath: string;
	lineNumber: number;
	ch: number;
	editorView?: EditorView;
	trackDescriptionEnd?: boolean;
}

const VISIBLE_KEYS = new Set([
	'status',
	'priority',
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'repeat',
	'assignees',
	'operonId',
	'datetimeModified',
	'taskIcon',
	'taskColor',
]);

const FIELD_MENU_DATE_ONLY_KEYS = new Set([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

export function showLivePreviewFieldMenu(anchor: HTMLElement | DOMRect, options: LivePreviewFieldMenuOptions): void {
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-live-preview-field-menu');
	const forwardMap = buildForwardMapping(options.settings.keyMappings);
	const fieldValues = options.task?.fieldValues ?? Object.fromEntries(options.parsedTask.fields.map(field => [field.key, field.value]));
	const visibleKeys = new Set(options.visibleKeys ?? VISIBLE_KEYS);

	const hiddenPresentKeys = collectHiddenKeys(
		fieldValues,
		options.task?.tags ?? options.parsedTask.tags,
		visibleKeys,
		options.allTasks,
		undefined,
		undefined,
		options.settings.keyMappings,
	)
		.filter(key => !isInternalCanonicalKey(key))
		.filter(key => isLivePreviewManagedFieldMenuKey(options.settings, key));

	const header = panel.createDiv('operon-floating-title');
	header.textContent = t('taskEditor', 'fieldMenuTitle');

	for (const key of hiddenPresentKeys) {
		panel.appendChild(buildItem(getDisplayName(key, forwardMap), () => {
			const pickerAnchor = snapshotFloatingAnchor(anchor);
			close();
			getOwnerWindow(panel).requestAnimationFrame(() => openPicker(key, pickerAnchor, options));
		}, panel));
	}

	if (hiddenPresentKeys.length === 0) {
		const empty = panel.createDiv('operon-field-menu-empty');
		empty.textContent = t('taskEditor', 'fieldMenuEmpty');
	}

	const addHeader = panel.createDiv('operon-floating-subtitle');
	addHeader.textContent = t('taskEditor', 'fieldMenuAddField');

	const addFieldKeys = [
		'status',
		'priority',
		'dateDue',
		'dateScheduled',
		'dateStarted',
		'datetimeCreated',
		'dateCompleted',
		'dateCancelled',
		'datetimeStart',
		'datetimeEnd',
		'repeat',
		'tags',
		'contexts',
		'links',
		'assignees',
		'taskColor',
		'subtasks',
		'blocking',
		'blockedBy',
		...getCustomSurfaceKeyMappings(options.settings, 'editor')
			.map(mapping => mapping.canonicalKey)
			.filter(key => !(fieldValues[key] ?? '').trim()),
	];
	for (const key of addFieldKeys) {
		panel.appendChild(buildItem(getDisplayName(key, forwardMap), () => {
			const pickerAnchor = snapshotFloatingAnchor(anchor);
			close();
			getOwnerWindow(panel).requestAnimationFrame(() => openPicker(key, pickerAnchor, options));
		}, panel));
	}

	const footer = panel.createDiv('operon-floating-actions');

	if (options.revealSource) {
		const reveal = createButton(t('taskEditor', 'editSourceMetadata'), 'operon-floating-btn is-secondary', footer);
		reveal.addEventListener('click', () => {
			close();
			options.revealSource?.();
		});
		footer.appendChild(reveal);
	}

	const edit = createButton(t('buttons', 'edit'), 'operon-floating-btn', footer);
	edit.addEventListener('click', () => {
		close();
		options.openEditor();
	});
	footer.appendChild(edit);

}

function buildItem(label: string, onClick: () => void, owner: Node | null): HTMLElement {
	const item = createButton(label, 'operon-field-menu-item', owner);
	item.addEventListener('click', onClick);
	return item;
}

function snapshotFloatingAnchor(anchor: HTMLElement | DOMRect): HTMLElement | DOMRect {
	const element = asHTMLElement(anchor);
	if (!element) return anchor;
	const rect = element.getBoundingClientRect();
	const DOMRectCtor = (getOwnerWindow(element) as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	return new DOMRectCtor(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
}

function getDisplayName(key: string, forwardMap: Map<string, string>): string {
	if (key === 'tags') return 'tags';
	return forwardMap.get(key) ?? key;
}

function getManualDatePickerOptions(key: string, settings: OperonSettings): ManualDatePickerOptions | undefined {
	if (!FIELD_MENU_DATE_ONLY_KEYS.has(key)) return undefined;
	return {
		weekStart: settings.calendarWeekStart,
		showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
	};
}

function getRepeatDayPickerPopoverOptions(settings: OperonSettings): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } {
	return {
		weekStart: settings.calendarWeekStart,
		showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
	};
}

function isLivePreviewManagedFieldMenuKey(settings: OperonSettings, key: string): boolean {
	if (key === 'tags') return true;
	const customMapping = getCustomFieldMapping(settings.keyMappings, key);
	if (customMapping) return isProjectedCustomFieldType(customMapping);
	return isManagedSurfaceField(settings.keyMappings, key);
}

function openPicker(key: string, anchor: HTMLElement | DOMRect, options: LivePreviewFieldMenuOptions): void {
	const fieldValues = options.task?.fieldValues ?? Object.fromEntries(options.parsedTask.fields.map(field => [field.key, field.value]));
	const restoreCursor: LivePreviewCursorRestoreRequest = {
		filePath: options.parsedTask.filePath,
		lineNumber: options.parsedTask.lineNumber,
		ch: options.parsedTask.descriptionRange.to,
		editorView: options.editorView,
		trackDescriptionEnd: true,
	};
	const customMapping = getCustomFieldMapping(options.settings.keyMappings, key);
	if (customMapping && isProjectedCustomFieldType(customMapping)) {
		openTaskFieldPicker({
			app: options.app,
			settings: options.settings,
			allTasks: options.allTasks,
			canonicalKey: key,
			anchor,
			currentFieldValues: fieldValues,
			currentTags: options.task?.tags ?? options.parsedTask.tags,
			sourcePath: options.parsedTask.filePath,
			closeListPickerOnSelect: true,
			retainInputFocus: true,
			taskFormat: options.task?.primary.format ?? 'inline',
			repeatInlineCompletionMode: options.repeatInlineCompletionMode,
			onCommit: payload => {
				const normalizedPayload = Object.fromEntries(
					Object.entries(payload).map(([payloadKey, value]) => [
						payloadKey,
						Array.isArray(value) ? value.join('; ') : value,
					]),
				);
				if (options.updateFields) {
					void options.updateFields(normalizedPayload, restoreCursor);
					return;
				}
				for (const [payloadKey, value] of Object.entries(normalizedPayload)) {
					void options.updateField(payloadKey, value, restoreCursor);
				}
			},
			onRepeatInlineCompletionModeChange: options.onRepeatInlineCompletionModeChange,
		});
		return;
	}

	switch (key) {
		case 'status':
			showStatusPicker(anchor, {
				pipelines: options.settings.pipelines,
				value: fieldValues['status'],
				retainInputFocus: true,
				onSelect: value => { void options.updateField('status', value, restoreCursor); },
				onClear: () => { void options.updateField('status', '', restoreCursor); },
			});
			return;
		case 'priority':
			showPriorityPicker(anchor, {
				priorities: options.settings.priorities,
				value: fieldValues['priority'],
				retainInputFocus: true,
				onSelect: value => { void options.updateField('priority', value, restoreCursor); },
				onClear: () => { void options.updateField('priority', '', restoreCursor); },
			});
			return;
		case 'dateDue':
		case 'dateScheduled':
		case 'dateStarted':
		case 'dateCompleted':
		case 'dateCancelled':
			showDatePicker(anchor, {
				app: options.app,
				fieldKey: key,
				value: fieldValues[key],
				manualDatePicker: getManualDatePickerOptions(key, options.settings),
				retainInputFocus: true,
				onSelect: value => { void options.updateField(key, value, restoreCursor); },
				canRemove: !!fieldValues[key],
				onRemove: () => { void options.updateField(key, '', restoreCursor); },
			});
			return;
		case 'datetimeCreated':
		case 'datetimeStart':
		case 'datetimeEnd':
			if (key === 'datetimeEnd' && !(fieldValues['datetimeStart'] ?? '').trim()) {
				new Notice(t('taskEditor', 'datetimeEndRequiresStart'));
				return;
			}
			showDatetimePicker(anchor, {
				app: options.app,
				settings: {
					timeFormat: options.settings.timeFormat,
					calendarWeekStart: options.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
				},
				fieldKey: key,
				value: fieldValues[key],
				retainInputFocus: true,
				onSelect: value => { void options.updateField(key, value, restoreCursor); },
				canRemove: !!fieldValues[key],
				onRemove: () => { void options.updateField(key, '', restoreCursor); },
			});
			return;
		case 'repeat': {
			const saveRepeat = async (payload: {
				repeat: string;
				datetimeRepeatEnd: string;
				repeatOccurrenceDate?: string;
				inlineCompletionMode: InlineRepeatCompletionMode;
			}) => {
				if (options.updateFields) {
					await options.updateFields({
						repeat: payload.repeat,
						datetimeRepeatEnd: payload.datetimeRepeatEnd,
						...(payload.repeatOccurrenceDate ? { repeatOccurrenceDate: payload.repeatOccurrenceDate } : {}),
					}, restoreCursor);
					await options.onRepeatInlineCompletionModeChange?.(payload.inlineCompletionMode);
					return;
				}
				await options.updateField('repeat', payload.repeat, restoreCursor);
				await options.updateField('datetimeRepeatEnd', payload.datetimeRepeatEnd, restoreCursor);
				if (payload.repeatOccurrenceDate) {
					await options.updateField('repeatOccurrenceDate', payload.repeatOccurrenceDate, restoreCursor);
				}
				await options.onRepeatInlineCompletionModeChange?.(payload.inlineCompletionMode);
			};
			const clearRepeat = async () => {
				if (options.updateFields) {
					await options.updateFields({
						repeat: '',
						datetimeRepeatEnd: '',
						repeatSeriesId: '',
						repeatOccurrenceDate: '',
					}, restoreCursor);
					await options.onRepeatInlineCompletionModeChange?.('keep-completed');
					return;
				}
				await options.updateField('repeat', '', restoreCursor);
				await options.updateField('datetimeRepeatEnd', '', restoreCursor);
				await options.updateField('repeatSeriesId', '', restoreCursor);
				await options.updateField('repeatOccurrenceDate', '', restoreCursor);
				await options.onRepeatInlineCompletionModeChange?.('keep-completed');
			};
			showRepeatPicker(anchor, {
				value: fieldValues['repeat'],
				repeatEnd: fieldValues['datetimeRepeatEnd'],
				repeatSeriesId: fieldValues['repeatSeriesId'],
				taskColor: fieldValues['taskColor'],
				repeatOccurrenceDate: fieldValues['repeatOccurrenceDate'],
				dateScheduled: fieldValues['dateScheduled'],
				dateDue: fieldValues['dateDue'],
				dateStarted: fieldValues['dateStarted'],
				datetimeStart: fieldValues['datetimeStart'],
				datetimeEnd: fieldValues['datetimeEnd'],
				taskFormat: options.task?.primary.format ?? 'inline',
				inlineCompletionMode: options.repeatInlineCompletionMode,
				dayPickerPopover: getRepeatDayPickerPopoverOptions(options.settings),
				onSave: payload => {
					void saveRepeat(payload);
				},
				onClear: () => {
					void clearRepeat();
				},
			});
			return;
		}
		case 'tags':
			showTagPicker(anchor, {
				app: options.app,
					value: options.parsedTask.tags,
					closeOnSelect: true,
					retainInputFocus: true,
					onSave: values => { void options.updateField('_tags', values.join('; '), restoreCursor); },
				});
				return;
		case 'contexts':
			showContextsPicker(anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
					value: splitList(fieldValues['contexts']),
					closeOnSelect: true,
					retainInputFocus: true,
					onSave: values => { void options.updateField('contexts', values.join('; '), restoreCursor); },
				});
				return;
		case 'links':
			showLinksPicker(anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
					value: splitList(fieldValues['links']),
					closeOnSelect: !!options.editorView,
					retainInputFocus: true,
					onSave: values => { void options.updateField('links', values.join('; '), restoreCursor); },
				});
				return;
		case 'assignees':
			showAssigneesPicker(anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
					value: splitList(fieldValues['assignees']),
					closeOnSelect: true,
					retainInputFocus: true,
					onSave: values => { void options.updateField('assignees', values.join('; '), restoreCursor); },
				});
				return;
			case 'taskColor':
				showColorPicker(anchor, {
					value: fieldValues['taskColor'],
					palette: options.settings.colorPalette,
					onSelect: value => { void options.updateField('taskColor', value, restoreCursor); },
					onClear: () => { void options.updateField('taskColor', '', restoreCursor); },
				});
				return;
		case 'subtasks': {
			const parentTaskId = options.task?.operonId?.trim() ?? '';
			if (!parentTaskId || !options.updateSubtasks) {
				new Notice(t('notifications', 'taskSaveFailed'));
				return;
			}
			const currentSubtaskIds = options.allTasks
				.filter(task => (task.fieldValues['parentTask'] ?? '').trim() === parentTaskId)
				.map(task => task.operonId);
				showSubtasksPicker(anchor, {
					value: currentSubtaskIds,
					allTasks: options.allTasks,
					excludedIds: buildSubtaskExcludedIds({
						allTasks: options.allTasks,
						currentTaskId: parentTaskId,
						parentTaskId: fieldValues['parentTask'],
						}),
						closeOnSelect: true,
						onChange: operonIds => { options.updateSubtasks?.(operonIds); },
					});
				return;
			}
		case 'blocking':
		case 'blockedBy':
			showDependencyTaskPicker(anchor, {
				fieldKey: key,
				value: fieldValues[key] ?? '',
				oppositeValue: fieldValues[key === 'blocking' ? 'blockedBy' : 'blocking'] ?? '',
				allTasks: options.allTasks,
				excludedIds: [options.task?.operonId?.trim() ?? ''].filter(Boolean),
				closeOnSelect: true,
				onSave: payload => {
					const nextValue = payload[key] ?? '';
						if (options.updateDependencyField) {
							options.updateDependencyField(key, nextValue);
							return;
						}
						void options.updateField(key, nextValue, restoreCursor);
					},
				});
			return;
		default:
			options.openEditor();
	}
}

function splitList(value: string | undefined): string[] {
	return splitTaskListValue(value);
}
