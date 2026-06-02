import { App, setIcon } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import {
	computeTaskFileLinkVisuals,
	computeTaskFileLinkProgressIndicator,
	FileTaskLookup,
	resolveTaskFileLink,
	TaskFileLinkProgressIndicator,
} from './task-file-wikilink-shared';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskFileOverlayChipContainer } from './task-file-overlay-chips';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';

interface ReadingTaskFileWikilinkCallbacks {
	app: App;
	getSettings: () => OperonSettings;
	getPipelines: () => Pipeline[];
	getAllTasks: () => IndexedTask[];
	getFileTaskByPath: FileTaskLookup;
	getDescendantTaskSummary: (operonId: string) => DescendantTaskSummary;
	openTaskEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
}

export function enhanceReadingTaskFileWikilinks(
	rootEl: HTMLElement,
	sourcePath: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): void {
	const anchors = rootEl.querySelectorAll<HTMLAnchorElement>('a.internal-link');
	const descendantCache = new Map<string, DescendantTaskSummary>();
	for (const anchor of Array.from(anchors)) {
		if (anchor.dataset.operonTaskWikilinkEnhanced === 'true') continue;
		if (anchor.closest('.operon-task-wikilink-reading')) continue;
		if (anchor.closest('pre, code')) continue;

		const linktext = getAnchorLinktext(anchor);
		if (!linktext) continue;

		const resolved = resolveTaskFileLink(
			callbacks.app,
			sourcePath,
			linktext,
			callbacks.getFileTaskByPath,
		);
		if (!resolved) continue;

		const visuals = computeTaskFileLinkVisuals(
			resolved.task,
			callbacks.getSettings(),
			callbacks.getPipelines(),
		);
		const summary = getCachedDescendantSummary(
			resolved.task.operonId,
			descendantCache,
			callbacks,
		);
		const progress = computeTaskFileLinkProgressIndicator(resolved.task, summary);

		const parent = anchor.parentNode;
		if (!parent) continue;

		const wrapper = createOwnerElement(anchor, 'span');
		wrapper.className = 'operon-task-wikilink-reading';
		wrapper.setCssProps({ '--operon-task-wikilink-hover': visuals.hoverColor });
		wrapper.setAttribute('data-operon-task-wikilink-wrapper', 'true');

		const leftButton = createActionButton(
			'operon-task-wikilink-action operon-task-wikilink-left',
			visuals.hoverColor,
			t('tooltips', 'cycleTaskStatus'),
			(button) => {
				button.setCssProps({ '--operon-task-wikilink-status-color': visuals.statusColor });
				setIcon(button, visuals.iconName);
			},
			() => callbacks.cycleStatus(resolved.task.operonId),
			wrapper,
		);
		if (callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(leftButton, {
				surface: 'taskWikilinkOverlay',
				taskId: resolved.task.operonId,
				getTask: () => resolved.task,
				getSettings: callbacks.getSettings,
				onAction: callbacks.onContextualAction,
				isPinned: callbacks.isTaskPinned ? () => callbacks.isTaskPinned?.(resolved.task.operonId) === true : undefined,
			});
		}
		const rightButton = createActionButton(
			'operon-task-wikilink-action operon-task-wikilink-right',
			visuals.hoverColor,
			t('tooltips', 'editTask'),
			(button) => {
				setIcon(button, 'settings-2');
			},
			() => callbacks.openTaskEditor(resolved.task.operonId),
			wrapper,
		);

		anchor.dataset.operonTaskWikilinkEnhanced = 'true';
		anchor.classList.add('operon-task-wikilink-anchor');
		if (visuals.labelState === 'done') {
			anchor.classList.add('operon-task-done');
		} else if (visuals.labelState === 'cancelled') {
			anchor.classList.add('operon-task-cancelled');
		}
		parent.insertBefore(wrapper, anchor);
		wrapper.appendChild(leftButton);
		wrapper.appendChild(anchor);
		const progressEl = createProgressElement(progress, wrapper);
		if (progressEl) {
			wrapper.appendChild(progressEl);
		}
		const chipRow = buildTaskFileOverlayChipContainer(resolved.task, {
			app: callbacks.app,
			getSettings: callbacks.getSettings,
			getAllTasks: callbacks.getAllTasks,
			sourcePath,
			owner: wrapper,
		});
		if (chipRow) {
			wrapper.appendChild(chipRow);
		}
		const settings = callbacks.getSettings();
		const isTerminal = visuals.labelState !== 'default';
		if (!isTerminal && settings.overlayTaskShowPlayAction && callbacks.toggleTimer && resolved.task.checkbox === 'open') {
			const isTracking = callbacks.isTaskTracking?.(resolved.task.operonId) === true;
			const playButton = createActionButton(
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action',
				visuals.hoverColor,
				t('tooltips', isTracking ? 'stopTimer' : 'startTimer'),
				(button) => {
					if (isTracking) button.classList.add('is-active');
					button.setCssProps({ '--operon-live-hover-border': visuals.hoverColor });
					setIcon(button, isTracking ? 'square' : 'play');
				},
				() => { void callbacks.toggleTimer?.(resolved.task.operonId); },
				wrapper,
			);
			wrapper.appendChild(playButton);
		}
		if (!isTerminal && settings.overlayTaskShowPinAction && callbacks.onContextualAction) {
			const isPinned = callbacks.isTaskPinned?.(resolved.task.operonId) === true;
			const pinButton = createActionButton(
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action',
				visuals.hoverColor,
				t('contextMenu', isPinned ? 'unpinTask' : 'pinTask'),
				(button) => {
					if (isPinned) button.classList.add('is-active');
					button.setCssProps({ '--operon-live-hover-border': visuals.hoverColor });
					setIcon(button, isPinned ? 'pin-off' : 'pin');
				},
				() => { void callbacks.onContextualAction?.(resolved.task.operonId, 'pinToggle'); },
				wrapper,
			);
			wrapper.appendChild(pinButton);
		}
		const noteValue = resolved.task.fieldValues['note']?.trim();
		if (settings.overlayTaskShowNoteAction && noteValue) {
			const noteIndicator = createOwnerElement(wrapper, 'span');
			noteIndicator.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action is-active';
			noteIndicator.setAttribute('role', 'img');
			noteIndicator.setCssProps({ '--operon-live-hover-border': visuals.hoverColor });
			setIcon(noteIndicator, getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen');
			setAccessibleLabelWithoutTooltip(noteIndicator, t('taskEditor', 'notes'));
			bindOperonHoverTooltip(noteIndicator, {
				title: t('taskEditor', 'notes'),
				content: noteValue,
				taskColor: visuals.hoverColor,
				preferredHorizontal: 'right',
			});
			wrapper.appendChild(noteIndicator);
		}
		if (!isTerminal && settings.overlayTaskShowSubtaskAction && callbacks.requestSubtask) {
			const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(resolved.task));
			const subtaskButton = createActionButton(
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action',
				visuals.hoverColor,
				subtaskLabel,
				(button) => {
					button.setCssProps({ '--operon-live-hover-border': visuals.hoverColor });
					setIcon(button, resolveSubtaskActionIcon(resolved.task));
				},
				() => { void callbacks.requestSubtask?.(resolved.task.operonId); },
				wrapper,
			);
			wrapper.appendChild(subtaskButton);
		}
		wrapper.appendChild(rightButton);
	}
}

function getAnchorLinktext(anchor: HTMLAnchorElement): string {
	const dataHref = anchor.getAttribute('data-href')?.trim();
	if (dataHref) return dataHref;

	const href = anchor.getAttribute('href')?.trim();
	if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return '';

	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
}

function createActionButton(
	className: string,
	hoverColor: string,
	label: string,
	renderIcon: (button: HTMLButtonElement) => void,
	onActivate: () => void,
	owner?: Node | null,
): HTMLButtonElement {
	const button = createOwnerElement(owner, 'button');
	button.type = 'button';
	button.className = className;
	button.setCssProps({ '--operon-task-wikilink-hover': hoverColor });
	renderIcon(button);
	setAccessibleLabelWithoutTooltip(button, label);

	button.addEventListener('mousedown', stopEvent);
	button.addEventListener('click', (event) => {
		stopEvent(event);
		onActivate();
	});
	button.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		stopEvent(event);
		onActivate();
	});

	return button;
}

function stopEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

function getCachedDescendantSummary(
	operonId: string,
	cache: Map<string, DescendantTaskSummary>,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): DescendantTaskSummary {
	const cached = cache.get(operonId);
	if (cached) return cached;
	const summary = callbacks.getDescendantTaskSummary(operonId);
	cache.set(operonId, summary);
	return summary;
}

function createProgressElement(progress: TaskFileLinkProgressIndicator, owner?: Node | null): HTMLElement | null {
	if (progress.kind === 'none') return null;

	const el = createOwnerElement(owner, 'span');
	el.className = 'operon-task-wikilink-progress';

	if (progress.kind === 'count') {
		el.classList.add('operon-task-wikilink-progress-count');
		el.textContent = progress.text;
		setAccessibleLabelWithoutTooltip(el, progress.text);
		bindOperonHoverTooltip(el, {
			content: progress.text,
			taskColor: null,
		});
		return el;
	}

	el.classList.add('operon-task-wikilink-progress-complete');
	bindOperonHoverTooltip(el, {
		content: t('tooltips', 'allDescendantsDone'),
		taskColor: null,
	});
	setIcon(el, progress.icon);
	setAccessibleLabelWithoutTooltip(el, t('tooltips', 'allDescendantsDone'));
	return el;
}
