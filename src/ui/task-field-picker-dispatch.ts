import { App, Notice } from 'obsidian';
import { IndexedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { DEFAULT_PRIORITIES } from '../types/priority';
import { t } from '../core/i18n';
import { splitTaskListValue } from '../core/task-field-patch';
import { showStatusPicker } from './field-pickers/status-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { type ManualDatePickerOptions, showDatePicker } from './field-pickers/date-picker';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { showTagPicker } from './field-pickers/tag-picker';
import { showContextsPicker } from './field-pickers/contexts-picker';
import { showLinksPicker } from './field-pickers/links-picker';
import { showAssigneesPicker } from './field-pickers/assignees-picker';
import { showRelatedPicker } from './field-pickers/related-picker';
import { showColorPicker } from './field-pickers/color-picker';
import { showIconPicker } from './field-pickers/icon-picker';
import { showRepeatPicker } from './field-pickers/repeat-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import { showParentTaskPicker } from './field-pickers/parent-task-picker';
import { showLocationPicker } from './field-pickers/location-picker';
import { showCustomDateFieldPicker, showCustomDatetimeFieldPicker, showCustomListFieldPicker, showCustomNumberFieldPicker, showCustomTextFieldPicker } from './field-pickers/custom';
import {
	collectCustomFieldValueCandidates,
	getCustomFieldLabel,
	getCustomFieldMapping,
	isProjectedCustomFieldType,
	normalizeCustomFieldRawValue,
} from './custom-field-surfaces';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';

export interface TaskFieldPickerDispatchOptions {
	app: App;
	settings: Pick<OperonSettings,
		| 'pipelines'
		| 'priorities'
		| 'timeFormat'
		| 'keyMappings'
		| 'calendarWeekStart'
		| 'calendarSidebarShowWeekNumbers'
		| 'colorPalette'
		| 'locationMapsAlwaysLightMode'
		| 'locationPlaceIconPropertyName'
		| 'locationPlaceColorPropertyName'
		| 'locationPickerMapDefaultCenter'
		| 'locationPickerMapDefaultZoom'
	>;
	allTasks: IndexedTask[];
	canonicalKey: string;
	anchor: HTMLElement | DOMRect;
	currentFieldValues: Record<string, string>;
	currentTags: string[];
	sourcePath?: string;
	closeListPickerOnSelect?: boolean;
	retainInputFocus?: boolean;
	manualDatePicker?: ManualDatePickerOptions;
	taskFormat?: 'inline' | 'yaml';
	repeatInlineCompletionMode?: InlineRepeatCompletionMode;
	onCommit: (payload: Record<string, string | string[]>) => void;
	onRepeatInlineCompletionModeChange?: (mode: InlineRepeatCompletionMode) => void | Promise<void>;
	onOpenNote?: () => void;
	onCancel?: () => void;
	onClose?: () => void;
}

export function openTaskFieldPicker(options: TaskFieldPickerDispatchOptions): (() => void) | null {
	const { canonicalKey, currentFieldValues } = options;

	switch (canonicalKey) {
		case 'status':
			return showStatusPicker(options.anchor, {
				pipelines: options.settings.pipelines,
				value: currentFieldValues['status'],
				retainInputFocus: options.retainInputFocus,
				onSelect: value => options.onCommit({ status: value }),
				onClear: () => options.onCommit({ status: '' }),
				onClose: options.onClose,
			});
		case 'priority':
			return showPriorityPicker(options.anchor, {
				priorities: options.settings.priorities ?? DEFAULT_PRIORITIES,
				value: currentFieldValues['priority'],
				retainInputFocus: options.retainInputFocus,
				onSelect: value => options.onCommit({ priority: value }),
				onClear: () => options.onCommit({ priority: '' }),
				onClose: options.onClose,
			});
		case 'estimate':
			return showEstimatePicker(options.anchor, {
				value: currentFieldValues['estimate'],
				onSelect: value => options.onCommit({ estimate: value }),
				canRemove: !!currentFieldValues['estimate'],
				onRemove: () => options.onCommit({ estimate: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'dateDue':
		case 'dateScheduled':
		case 'dateStarted':
		case 'dateCompleted':
		case 'dateCancelled':
			return showDatePicker(options.anchor, {
				app: options.app,
				fieldKey: canonicalKey,
				value: currentFieldValues[canonicalKey],
				manualDatePicker: options.manualDatePicker,
				retainInputFocus: options.retainInputFocus,
				onSelect: value => options.onCommit({ [canonicalKey]: value }),
				canRemove: !!currentFieldValues[canonicalKey],
				onRemove: () => options.onCommit({ [canonicalKey]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'datetimeCreated':
		case 'datetimeStart':
		case 'datetimeEnd':
		case 'datetimeRepeatEnd':
			if (canonicalKey === 'datetimeEnd' && !(currentFieldValues['datetimeStart'] ?? '').trim()) {
				new Notice(t('taskEditor', 'datetimeEndRequiresStart'));
				options.onCancel?.();
				return null;
			}
			return showDatetimePicker(options.anchor, {
				app: options.app,
				settings: {
					timeFormat: options.settings.timeFormat,
					calendarWeekStart: options.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
				},
				fieldKey: canonicalKey,
				value: currentFieldValues[canonicalKey],
				retainInputFocus: options.retainInputFocus,
				onSelect: value => options.onCommit({ [canonicalKey]: value }),
				canRemove: !!currentFieldValues[canonicalKey],
				onRemove: () => options.onCommit({ [canonicalKey]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'repeat':
			return showRepeatPicker(options.anchor, {
				value: currentFieldValues['repeat'],
				repeatEnd: currentFieldValues['datetimeRepeatEnd'],
				repeatSeriesId: currentFieldValues['repeatSeriesId'],
				taskColor: currentFieldValues['taskColor'],
				repeatOccurrenceDate: currentFieldValues['repeatOccurrenceDate'],
				dateScheduled: currentFieldValues['dateScheduled'],
				dateDue: currentFieldValues['dateDue'],
				dateStarted: currentFieldValues['dateStarted'],
				datetimeStart: currentFieldValues['datetimeStart'],
				datetimeEnd: currentFieldValues['datetimeEnd'],
				taskFormat: options.taskFormat,
				inlineCompletionMode: options.repeatInlineCompletionMode,
				dayPickerPopover: {
					weekStart: options.settings.calendarWeekStart,
					showWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
				},
				onSave: payload => {
					void options.onRepeatInlineCompletionModeChange?.(payload.inlineCompletionMode);
					options.onCommit({
						repeat: payload.repeat,
						datetimeRepeatEnd: payload.datetimeRepeatEnd,
						...(payload.repeatOccurrenceDate ? { repeatOccurrenceDate: payload.repeatOccurrenceDate } : {}),
					});
				},
				onClear: () => {
					void options.onRepeatInlineCompletionModeChange?.('keep-completed');
					options.onCommit({
						repeat: '',
						datetimeRepeatEnd: '',
						repeatSeriesId: '',
						repeatOccurrenceDate: '',
					});
				},
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'taskIcon':
			return showIconPicker(options.anchor, {
				value: currentFieldValues['taskIcon'],
				retainInputFocus: options.retainInputFocus,
				onSelect: value => options.onCommit({ taskIcon: value }),
				onClear: () => options.onCommit({ taskIcon: '' }),
				onClose: options.onClose,
			});
		case 'taskColor':
			return showColorPicker(options.anchor, {
				value: currentFieldValues['taskColor'],
				palette: options.settings.colorPalette,
				onSelect: value => options.onCommit({ taskColor: value }),
				onClear: () => options.onCommit({ taskColor: '' }),
				onClose: options.onClose,
			});
		case 'parentTask':
			return showParentTaskPicker(options.anchor, {
				value: currentFieldValues['parentTask'],
				allTasks: options.allTasks,
				retainInputFocus: options.retainInputFocus,
				onSelect: operonId => options.onCommit({ parentTask: operonId }),
				onClear: () => options.onCommit({ parentTask: '' }),
				onClose: options.onClose,
			});
		case 'location':
			return showLocationPicker(options.anchor, {
				app: options.app,
				settings: options.settings,
				value: currentFieldValues['location'],
				onSelect: value => options.onCommit({ location: value }),
				onClear: () => options.onCommit({ location: '' }),
				onClose: options.onClose,
			});
		case 'tags':
			return showTagPicker(options.anchor, {
				app: options.app,
				value: options.currentTags,
				closeOnSelect: options.closeListPickerOnSelect,
				retainInputFocus: options.retainInputFocus,
				onSave: values => options.onCommit({ tags: values }),
				onClose: options.onClose,
			});
		case 'contexts':
			return showContextsPicker(options.anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
				value: splitTaskListValue(currentFieldValues['contexts']),
				closeOnSelect: options.closeListPickerOnSelect,
				retainInputFocus: options.retainInputFocus,
				onSave: values => options.onCommit({ contexts: values.join('; ') }),
				onClose: options.onClose,
			});
		case 'links':
			return showLinksPicker(options.anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
				value: splitTaskListValue(currentFieldValues['links']),
				closeOnSelect: options.closeListPickerOnSelect,
				retainInputFocus: options.retainInputFocus,
				onSave: values => options.onCommit({ links: values.join('; ') }),
				onClose: options.onClose,
			});
		case 'assignees':
			return showAssigneesPicker(options.anchor, {
				app: options.app,
				settingsKeyMappings: options.settings.keyMappings,
				allTasks: options.allTasks,
				value: splitTaskListValue(currentFieldValues['assignees']),
				closeOnSelect: options.closeListPickerOnSelect,
				retainInputFocus: options.retainInputFocus,
				onSave: values => options.onCommit({ assignees: values.join('; ') }),
				onClose: options.onClose,
			});
		case 'related':
			return showRelatedPicker(options.anchor, {
				app: options.app,
				allTasks: options.allTasks,
				value: splitTaskListValue(currentFieldValues['related']),
				retainInputFocus: options.retainInputFocus,
				onSave: values => options.onCommit({ related: values.join('; ') }),
				onClose: options.onClose,
			});
		case 'note':
			options.onOpenNote?.();
			return null;
		default:
			return openCustomTaskFieldPicker(options);
	}
}

function openCustomTaskFieldPicker(options: TaskFieldPickerDispatchOptions): (() => void) | null {
	const mapping = getCustomFieldMapping(options.settings.keyMappings, options.canonicalKey);
	if (!mapping || !isProjectedCustomFieldType(mapping)) {
		options.onCancel?.();
		return null;
	}

	const label = getCustomFieldLabel(mapping);
	const canonicalKey = mapping.canonicalKey;
	const value = normalizeCustomFieldRawValue((options.currentFieldValues as Record<string, unknown>)[canonicalKey]);

	switch (mapping.type) {
		case 'text':
			return showCustomTextFieldPicker(options.anchor, {
				canonicalKey,
				type: 'text',
				label,
				value,
				candidates: collectCustomFieldValueCandidates(options.app, options.allTasks, mapping),
				placeholder: label,
				retainInputFocus: options.retainInputFocus,
				onCommit: (key, nextValue) => options.onCommit({ [key]: nextValue }),
				canRemove: !!value.trim(),
				onRemove: key => options.onCommit({ [key]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'list':
			return showCustomListFieldPicker(options.anchor, {
				app: options.app,
				sourcePath: options.sourcePath,
				canonicalKey,
				type: 'list',
				label,
				value: splitTaskListValue(value),
				candidates: collectCustomFieldValueCandidates(options.app, options.allTasks, mapping),
				placeholder: label,
				retainInputFocus: options.retainInputFocus,
				onCommit: (key, nextValue) => options.onCommit({ [key]: nextValue }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'number':
			return showCustomNumberFieldPicker(options.anchor, {
				canonicalKey,
				type: 'number',
				label,
				value,
				placeholder: label,
				onCommit: (key, nextValue) => options.onCommit({ [key]: nextValue }),
				canRemove: !!value.trim(),
				onRemove: key => options.onCommit({ [key]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'date':
			return showCustomDateFieldPicker(options.anchor, {
				app: options.app,
				canonicalKey,
				type: 'date',
				label,
				value,
				dayPicker: getCustomDateFieldManualDatePickerOptions(options),
				retainInputFocus: options.retainInputFocus,
				onCommit: (key, nextValue) => options.onCommit({ [key]: nextValue }),
				canRemove: !!value.trim(),
				onRemove: key => options.onCommit({ [key]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'datetime':
			return showCustomDatetimeFieldPicker(options.anchor, {
				app: options.app,
				settings: {
					timeFormat: options.settings.timeFormat,
					calendarWeekStart: options.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
				},
				canonicalKey,
				type: 'datetime',
				label,
				value,
				retainInputFocus: options.retainInputFocus,
				onCommit: (key, nextValue) => options.onCommit({ [key]: nextValue }),
				canRemove: !!value.trim(),
				onRemove: key => options.onCommit({ [key]: '' }),
				onCancel: options.onCancel,
				onClose: options.onClose,
			});
		case 'checkbox':
			options.onCancel?.();
			return null;
		default:
			options.onCancel?.();
			return null;
	}
}

function getCustomDateFieldManualDatePickerOptions(options: TaskFieldPickerDispatchOptions): ManualDatePickerOptions {
	return options.manualDatePicker ?? {
		weekStart: options.settings.calendarWeekStart,
		showWeekNumbers: options.settings.calendarSidebarShowWeekNumbers,
	};
}
