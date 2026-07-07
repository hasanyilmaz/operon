import { App } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { IndexedTask } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import {
	InlineTaskCompactChipEntry,
	buildInlineTaskCompactChipEntries,
	createInlineTaskCompactChipElement,
	shouldResolveLocationCompactChips,
} from './compact-task-layout';
import { OperonSettings } from '../types/settings';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { resolveTaskDateToneColor } from '../core/task-date-tone';
import { Pipeline, parseStatusValue } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { bindOperonHoverTooltip, wrapWithOperonHoverTooltip } from './operon-hover-tooltip';
import { openObsidianTagSearch } from './tag-search';
import { bindCompactChipLinkPreview } from './compact-chip-link-preview';
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
import { createProjectSerialChipElement } from './project-serial-chip';

interface TaskWikilinkOverlayChipRenderCallbacks {
	app: App;
	getSettings: () => OperonSettings;
	getAllTasks: () => IndexedTask[];
	sourcePath: string;
	owner?: Node | null;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
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
		{ repeatSkipDateResolver: getRepeatSkipDates },
	).map(entry => [
		entry.key,
		entry.label,
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
		{ repeatSkipDateResolver: callbacks.getRepeatSkipDates },
	);
	const projectSerialDisplay = callbacks.getProjectSerialDisplay?.(task.operonId, task) ?? null;
	if (entries.length === 0 && !projectSerialDisplay) return null;

	const taskColor = normalizeTaskColor(task.fieldValues['taskColor']);
	const statusColor = lookupStatusColor(task.fieldValues['status'], settings.pipelines);
	const row = createOwnerElement(callbacks.owner, 'span');
	row.className = 'operon-task-wikilink-chip-row operon-task-chip-surface';
	if (projectSerialDisplay) {
		row.appendChild(createProjectSerialChipElement(projectSerialDisplay, 'operon-task-wikilink-chip operon-task-chip', {
			keyMappings: settings.keyMappings,
			owner: row,
		}));
	}

	for (const rawEntry of entries) {
		const entry = {
			...rawEntry,
			interactive: isOverlayChipInteractive(rawEntry),
		};
		const chip = createInlineTaskCompactChipElement(entry, 'operon-task-wikilink-chip operon-task-chip', { owner: row });
		applyOverlayChipVisualStyles(chip, entry, task, settings.priorities, statusColor, taskColor);

		if (entry.iconOnly) {
			bindAdaptiveIconOnlyExpansion(chip, entry.label, taskColor ?? null);
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
				bindIconOnlyChipPreview(chip);
			}
			const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
			if (previewLinkTarget) {
				bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, callbacks.sourcePath);
			}
			row.appendChild(chip);
			continue;
		}

		if (entry.interactive) {
			attachOverlayChipAction(chip, entry, callbacks, task);
		}
		const node = entry.tooltipContent
			? wrapWithOperonHoverTooltip(chip, {
				title: entry.tooltipTitle ?? t('taskEditor', 'details'),
				content: entry.tooltipContent,
				taskColor,
			})
			: chip;
		if (entry.externalUrl) {
			bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
		}
		const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
		if (previewLinkTarget) {
			bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, callbacks.sourcePath);
		}
		row.appendChild(node);
	}

	return row;
}

function isOverlayChipInteractive(entry: InlineTaskCompactChipEntry): boolean {
	return entry.key === 'tags' || !!entry.locationCoordinate || !!entry.linkTarget || !!entry.externalUrl;
}

function attachOverlayChipAction(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	callbacks: TaskWikilinkOverlayChipRenderCallbacks,
	task: IndexedTask,
	onCommit?: () => void,
): void {
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		if (entry.key === 'tags') {
			void openObsidianTagSearch(callbacks.app, entry.label);
			onCommit?.();
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
	if (Object.keys(cssProps).length > 0) {
		chip.setCssProps(cssProps);
	}
}

function lookupStatusColor(statusValue: string | undefined, pipelines: Pipeline[]): string {
	if (!statusValue) return '#6b7280';
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return '#6b7280';
	const pipeline = pipelines.find((candidate) => candidate.name === parsed.pipeline);
	if (!pipeline) return '#6b7280';
	const status = pipeline.statuses.find((candidate) => candidate.label === parsed.status);
	return status?.color ?? '#6b7280';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}
