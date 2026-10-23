import { isTaskInfoChipKey } from '../core/task-info-chips';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { bindTaskInfoSourceAction } from './task-info-chip-action';
import { identifyInlineTaskPart } from './inline-retained-dom';
import { bindDesktopChipOpening, isDesktopOpeningChip } from './links-chip-action';
import { bindAssigneeChipImage } from './assignee-chip-image';
import { App } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { IndexedTask } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import {
	InlineTaskCompactChipEntry,
	buildInlineTaskCompactChipEntries,
	createInlineTaskCompactChipElement,
	isCompactTaskMediaChipKey,
	resolveCompactBlockedByIconColor,
	shouldResolveLocationCompactChips,
} from './compact-task-layout';
import { OperonSettings } from '../types/settings';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { resolveTaskDateToneColor } from '../core/task-date-tone';
import { findStatusDef, Pipeline } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { bindCompactChipLinkPreview, bindTaskMediaChipPreview } from './compact-chip-link-preview';
import { bindExternalLinkContextMenu, openExternalUrl } from './external-link-actions';
import { showLocationMapPreview } from './location-map-preview';
import {
	bindAdaptiveIconOnlyExpansion,
	bindIconOnlyChipPreview,
	closeIconOnlyChipPreview,
	isIconOnlyChipExpansionSuppressed,
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from './icon-only-chip-preview';
import { t } from '../core/i18n';
import { openTaskFieldPicker } from './task-field-picker-dispatch';

interface TaskWikilinkOverlayChipRenderCallbacks {
	onContextualAction?: ContextualMenuActionHandler;
	app: App;
	getSettings: () => OperonSettings;
	getAllTasks: () => IndexedTask[];
	sourcePath: string;
	owner?: Node | null;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	updateField?: (operonId: string, key: string, value: string) => void | boolean | Promise<void | boolean>;
}

export function getTaskWikilinkOverlayChipSignature(
	task: IndexedTask,
	app: App,
	settings: OperonSettings,
	allTasks: IndexedTask[],
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null,
	getRepeatSkipDates?: (repeatSeriesId: string) => string[],
): string {
	const locationIndex = shouldResolveLocationCompactChips(settings, settings.taskWikilinkOverlayCompactChips)
		? getLocationPlaceIndex(app, settings)
		: null;
	const entrySignature = buildInlineTaskCompactChipEntries(
		task.fieldValues,
		task.tags,
		settings,
		allTasks,
		settings.taskWikilinkOverlayCompactChips,
		locationIndex?.resolve,
		{ task, projectSerialDisplay: getProjectSerialDisplay?.(task.operonId, task), app, repeatSkipDateResolver: getRepeatSkipDates },
	).map(entry => [
		entry.key,
		entry.label,
		entry.rawValue ?? '',
		entry.icon,
		entry.iconOnly ? 1 : 0,
		entry.linkTarget ?? '',
		entry.previewLinkTarget ?? '',
		entry.externalUrl ?? '',
		entry.externalRawValue ?? '',
		entry.locationCoordinate ?? '',
		entry.locationMarkerIcon ?? '',
		entry.locationMarkerColor ?? '',
		entry.taskColor ?? '',
		entry.tooltipContent ?? '',
		entry.reminderItem?.fieldKey ?? '',
		entry.reminderItem?.index ?? '',
		entry.reminderItem?.rawValue ?? '',
		entry.reminderState ?? '',
		entry.blockedByVisualState ?? '',
		entry.ariaLabel ?? '',
	].join(':')).join('|');
	return [
		locationIndex?.getSignature() ?? '',
		getProjectSerialDisplay?.(task.operonId, task)?.label ?? '',
		entrySignature,
	].join('|');
}

export function buildTaskWikilinkOverlaySettingsSignature(settings: OperonSettings): string {
	return JSON.stringify({
		taskWikilinkOverlayCompactChips: settings.taskWikilinkOverlayCompactChips,
		taskWikilinkOverlayShowPlayAction: settings.taskWikilinkOverlayShowPlayAction,
		taskWikilinkOverlayShowPinAction: settings.taskWikilinkOverlayShowPinAction,
		taskWikilinkOverlayShowNoteAction: settings.taskWikilinkOverlayShowNoteAction,
		taskWikilinkOverlayShowSourceAction: settings.taskWikilinkOverlayShowSourceAction,
		taskWikilinkOverlayShowSubtaskAction: settings.taskWikilinkOverlayShowSubtaskAction,
		taskWikilinkOverlayShowPlainCheckboxAction: settings.taskWikilinkOverlayShowPlainCheckboxAction,
	});
}

export function buildTaskWikilinkOverlayChipContainer(
	task: IndexedTask,
	callbacks: TaskWikilinkOverlayChipRenderCallbacks,
): HTMLElement | null {
	const settings = callbacks.getSettings();
	const locationResolver = shouldResolveLocationCompactChips(settings, settings.taskWikilinkOverlayCompactChips)
		? getLocationPlaceIndex(callbacks.app, settings).resolve
		: undefined;
	const entries = buildInlineTaskCompactChipEntries(
		task.fieldValues,
		task.tags,
		settings,
		callbacks.getAllTasks(),
		settings.taskWikilinkOverlayCompactChips,
		locationResolver,
		{ task, projectSerialDisplay: callbacks.getProjectSerialDisplay?.(task.operonId, task), app: callbacks.app, repeatSkipDateResolver: callbacks.getRepeatSkipDates },
	);
	if (entries.length === 0) return null;

	const taskColor = normalizeTaskColor(task.fieldValues['taskColor']);
	const statusColor = lookupStatusColor(task.fieldValues['status'], settings.pipelines);
	const row = createOwnerElement(callbacks.owner, 'span');
	row.className = 'operon-task-wikilink-chip-row operon-task-chip-surface';

	for (const rawEntry of entries) {
		const entry = {
			...rawEntry,
			interactive: isOverlayChipInteractive(rawEntry, callbacks),
		};
		const chip = createInlineTaskCompactChipElement(entry, 'operon-task-wikilink-chip operon-task-chip', { owner: row });
		bindAssigneeChipImage(chip, entry, callbacks.app, task.primary.filePath, settings.assigneeImageProperty);
		applyOverlayChipVisualStyles(chip, entry, task, settings.priorities, statusColor, taskColor);

		if (entry.iconOnly) {
			bindAdaptiveIconOnlyExpansion(chip, entry.label, taskColor ?? null, {
				showTooltip: !isCompactTaskMediaChipKey(entry.key),
			});
			if (entry.externalUrl) {
				bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
			}
			if (entry.tooltipContent) {
				bindOperonHoverTooltip(chip, {
					title: entry.tooltipTitle ?? t('taskEditor', 'details'),
					content: entry.tooltipContent,
					taskColor,
					shouldOpen: () => isIconOnlyChipExpansionSuppressed(chip),
				});
			}
			if (entry.interactive) {
				attachOverlayChipAction(chip, entry, callbacks, task, () => closeIconOnlyChipPreview(chip));
			} else {
				if (entry.key !== 'taskInfo.projectSerial') bindIconOnlyChipPreview(chip);
			}
			const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
			if (isCompactTaskMediaChipKey(entry.key)) {
				bindTaskMediaChipPreview(callbacks.app, chip, {
					localLinkTarget: previewLinkTarget,
					externalUrl: entry.externalUrl,
					label: entry.ariaLabel ?? entry.label,
					sourcePath: callbacks.sourcePath,
				});
			} else if (previewLinkTarget) {
				bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, callbacks.sourcePath);
			}
			identifyInlineTaskPart(chip, `${entry.key}:${entry.linkTarget ?? entry.externalUrl ?? entry.label}`, JSON.stringify([entry, taskColor, chip.getAttribute('style'), settings.language, settings.assigneeImageProperty, task.primary.filePath]));
			row.appendChild(chip);
			continue;
		}

		if (entry.interactive) {
			attachOverlayChipAction(chip, entry, callbacks, task);
		}
		if (isTaskInfoChipKey(entry.key) || entry.tooltipContent) {
			bindOperonHoverTooltip(chip, {
				title: isTaskInfoChipKey(entry.key) ? entry.tooltipTitle : entry.tooltipTitle ?? t('taskEditor', 'details'),
				content: entry.tooltipContent,
				taskColor,
			});
		}
		const node = chip;
		if (entry.externalUrl) {
			bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
		}
		const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
		if (isCompactTaskMediaChipKey(entry.key)) {
			bindTaskMediaChipPreview(callbacks.app, chip, {
				localLinkTarget: previewLinkTarget,
				externalUrl: entry.externalUrl,
				label: entry.ariaLabel ?? entry.label,
				sourcePath: callbacks.sourcePath,
			});
		} else if (previewLinkTarget) {
			bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, callbacks.sourcePath);
		}
		identifyInlineTaskPart(node, `${entry.key}:${entry.linkTarget ?? entry.externalUrl ?? entry.label}`, JSON.stringify([entry, taskColor, chip.getAttribute('style'), settings.language, settings.assigneeImageProperty, task.primary.filePath]));
		row.appendChild(node);
	}

	return row;
}

function isOverlayChipInteractive(
	entry: InlineTaskCompactChipEntry,
	callbacks: TaskWikilinkOverlayChipRenderCallbacks,
): boolean {
	if (isDesktopOpeningChip(entry.key, callbacks.getSettings())) return true;
	if (entry.key === 'taskInfo.source') return !!callbacks.onContextualAction;
	if (entry.key === 'taskInfo.projectSerial') return false;
	return ((entry.key === 'taskType' || entry.key === 'tags' || entry.key === 'status') && !!callbacks.updateField)
		|| !!entry.locationCoordinate
		|| !!entry.linkTarget
		|| !!entry.externalUrl;
}

function attachOverlayChipAction(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	callbacks: TaskWikilinkOverlayChipRenderCallbacks,
	task: IndexedTask,
	onCommit?: () => void,
): void {

 if (bindDesktopChipOpening(chip, entry, {
  app: callbacks.app, getSettings: callbacks.getSettings, getAllTasks: callbacks.getAllTasks,
  getTask: () => callbacks.getAllTasks().find(candidate => candidate.operonId === task.operonId),
  getTaskById: id => callbacks.getAllTasks().find(candidate => candidate.operonId === id),
  picker: current => !callbacks.updateField ? null : { onCommit: payload => {
   for (const [key, value] of Object.entries(payload)) void callbacks.updateField?.(current.operonId, key, Array.isArray(value) ? value.join('; ') : value);
   onCommit?.();
  } },
 })) return;
	if (entry.key === 'taskInfo.projectSerial') return;
	if (entry.key === 'taskInfo.source') {
		bindTaskInfoSourceAction(chip, () => { void callbacks.onContextualAction?.(task.operonId, 'jumpToSource'); }, callbacks.app, () => callbacks.getAllTasks().find(current => current.operonId === task.operonId));
		return;
	}

	let tagPickerOpen = false;
	let statusPickerOpen = false;
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (entry.key !== 'tags' && entry.key !== 'status' && entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		if (entry.key === 'tags') {
			if (tagPickerOpen || !callbacks.updateField) return;
			tagPickerOpen = true;
			openTaskFieldPicker({
				app: callbacks.app,
				settings: callbacks.getSettings(),
				allTasks: callbacks.getAllTasks(),
				canonicalKey: 'tags',
				anchor: chip,
				currentFieldValues: task.fieldValues,
				currentTags: callbacks.getAllTasks().find(candidate => candidate.operonId === task.operonId)?.tags ?? task.tags,
				sourcePath: task.primary.filePath,
				taskFormat: task.primary.format,
				closeListPickerOnSelect: true,
				onClose: () => { tagPickerOpen = false; },
				onCommit: payload => {
					if (!Array.isArray(payload.tags)) return;
					void callbacks.updateField?.(task.operonId, '_tags', payload.tags.join('; '));
					onCommit?.();
				},
			});
			return;
		}
		if ((entry.key === 'taskType' || entry.key === 'status') && callbacks.updateField) {
			if (entry.key === 'status' && statusPickerOpen) return;
			if (entry.key === 'status') statusPickerOpen = true;
			openTaskFieldPicker({
				app: callbacks.app,
				settings: callbacks.getSettings(),
				allTasks: callbacks.getAllTasks(),
				canonicalKey: entry.key,
				onClose: () => { statusPickerOpen = false; },
				anchor: chip,
				currentFieldValues: task.fieldValues,
				getCurrentFieldValues: () => callbacks.getAllTasks()
					.find(candidate => candidate.operonId === task.operonId)?.fieldValues ?? task.fieldValues,
				currentTags: task.tags,
				sourcePath: task.primary.filePath,
				taskFormat: task.primary.format,
				onCommit: payload => {
					const value = payload[entry.key];
					statusPickerOpen = false;
					if (typeof value !== 'string') return;
					void callbacks.updateField?.(task.operonId, entry.key, value);
					onCommit?.();
				},
			});
			return;
		}
		if (entry.key === 'location' && entry.locationCoordinate) {
			showLocationMapPreview(
				callbacks.app,
				chip,
				callbacks.getSettings(),
				entry.locationCoordinate,
				task.primary.filePath,
				entry.taskColor ?? null,
				entry.locationMarkerIcon ?? null,
				entry.locationMarkerColor ?? null,
				entry.linkTarget ?? null,
				task.description,
			);
			onCommit?.();
			return;
		}
		if (entry.linkTarget) {
			void callbacks.app.workspace.openLinkText(entry.linkTarget, task.primary.filePath, false);
			onCommit?.();
			return;
		}
		if (entry.externalUrl) {
			openExternalUrl(entry.externalUrl);
			onCommit?.();
		}
	});
}

function applyOverlayChipVisualStyles(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	priorities: PriorityDefinition[],
	statusColor: string,
	taskColor: string | null,
): void {
	const cssProps: Record<string, string> = {};
	const hoverColor = taskColor ?? entry.taskColor;
	if (hoverColor) {
		cssProps['--operon-live-hover-border'] = hoverColor;
		cssProps['--operon-task-chip-hover-accent'] = hoverColor;
	}
	if (entry.colorRole === 'priority') {
		const def = priorities.find((priority) => priority.label === task.fieldValues['priority']);
		if (def) cssProps['--operon-inline-chip-icon-color'] = def.color;
	}
	if (entry.colorRole === 'status') {
		cssProps['--operon-inline-chip-icon-color'] = statusColor;
	}
	if (entry.key === 'location') {
		const locationIconColor = entry.locationMarkerColor ?? taskColor;
		if (locationIconColor) cssProps['--operon-inline-chip-icon-color'] = locationIconColor;
	}
	const dateToneColor = resolveTaskDateToneColor(entry.iconTone ?? 'default');
	if (dateToneColor) cssProps['--operon-inline-chip-icon-color'] = dateToneColor;
	const blockedByColor = resolveCompactBlockedByIconColor(entry);
	if (blockedByColor) cssProps['--operon-inline-chip-icon-color'] = blockedByColor;
	if (Object.keys(cssProps).length > 0) {
		chip.setCssProps(cssProps);
	}
}

function lookupStatusColor(statusValue: string | undefined, pipelines: Pipeline[]): string {
	if (!statusValue) return '#6b7280';
	return findStatusDef(pipelines, statusValue)?.color ?? '#6b7280';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}
