import { App, parseLinktext, setIcon, TFile } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import {
	computeTaskFileLinkPlainCheckboxIndicator,
	computeTaskFileLinkVisuals,
	computeTaskFileLinkProgressIndicator,
	createTaskFileLinkPlainCheckboxProgressElement,
	FileTaskLookup,
	resolveTaskFileLink,
	ResolvedTaskFileLink,
	TaskFileLinkProgressIndicator,
	TaskFileLinkVisuals,
	buildTaskFileLinkProgressTooltip,
	appendTaskFileLinkProgressCountContent,
} from './task-file-wikilink-shared';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskFileOverlayChipContainer } from './task-file-overlay-chips';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import { bindTaskTitleLinkPreview } from './compact-chip-link-preview';
import { isTaskDescriptionWikilinkEventTarget, renderTaskDescriptionWikilinks } from './task-description-wikilinks';
import { scanTaskWikiLinksInLine, TaskWikiLinkMatch } from './task-wikilink-scanner';

interface ReadingTaskFileWikilinkCallbacks {
	app: App;
	getSettings: () => OperonSettings;
	getPipelines: () => Pipeline[];
	getAllTasks: () => IndexedTask[];
	getFileTaskByPath: FileTaskLookup;
	getDescendantTaskSummary: (operonId: string) => DescendantTaskSummary;
	openTaskEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}

interface ReadingTaskFileWikilinkOptions {
	sourceText?: string;
}

interface SourceWikiLinkCursor {
	index: number;
}

interface RenderedNestedTaskFileTarget {
	element: HTMLElement;
	from: number;
	to: number;
}

interface RenderedNestedTaskFileReplacement extends RenderedNestedTaskFileTarget {
	linktext: string;
}

export function enhanceReadingTaskFileWikilinks(
	rootEl: HTMLElement,
	sourcePath: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
	options: ReadingTaskFileWikilinkOptions = {},
): void {
	const descendantCache = new Map<string, DescendantTaskSummary>();
	const sourceMatches = getSourceWikiLinkMatches(options.sourceText);
	prepareVirtualNestedTaskFileAnchors(rootEl, sourcePath, callbacks, sourceMatches);
	const anchors = rootEl.querySelectorAll<HTMLAnchorElement>('a.internal-link');
	const sourceCursor: SourceWikiLinkCursor = { index: 0 };
	for (const anchor of Array.from(anchors)) {
		if (anchor.dataset.operonTaskWikilinkEnhanced === 'true') continue;
		if (anchor.closest('.operon-task-wikilink-reading')) continue;
		if (anchor.closest('pre, code')) continue;

		const anchorLinktext = getAnchorLinktext(anchor);
		if (!anchorLinktext) continue;
		const sourceMatch = findSourceWikiLinkMatchForAnchor(
			sourceMatches,
			sourceCursor,
			anchor,
			anchorLinktext,
			sourcePath,
			callbacks,
		);
		const resolved = sourceMatch
			? resolveReadingTaskFileLink(
				callbacks.app,
				sourcePath,
				sourceMatch.linktext,
				callbacks,
				sourceMatch.alias,
			)
			: resolveIndexedNestedTaskFileLinkFromAnchor(callbacks.app, sourcePath, anchor, anchorLinktext, callbacks)
				?? resolveReadingTaskFileLink(
					callbacks.app,
					sourcePath,
					anchorLinktext,
					callbacks,
					getAnchorAlias(anchor, anchorLinktext),
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
		wrapper.className = 'operon-task-wikilink-reading operon-task-chip-surface';
		wrapper.setCssProps({
			'--operon-live-hover-border': visuals.hoverColor,
			'--operon-task-chip-hover-accent': visuals.hoverColor,
			'--operon-task-wikilink-hover': visuals.hoverColor,
		});
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
				hasSubtasks: callbacks.hasSubtasks ? () => callbacks.hasSubtasks?.(resolved.task.operonId) === true : undefined,
			});
		}
		const rightButton = createActionButton(
			'operon-task-wikilink-action operon-task-wikilink-right operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-wikilink-overlay-standard-action operon-task-wikilink-settings-action operon-task-chip-action',
			visuals.hoverColor,
			t('tooltips', 'editTask'),
			(button) => {
				setIcon(button, 'settings-2');
			},
			() => callbacks.openTaskEditor(resolved.task.operonId),
			wrapper,
		);

		parent.insertBefore(wrapper, anchor);
		const labelEl = createTaskFileLinkLabel(anchor, resolved, visuals, callbacks);
		wrapper.appendChild(leftButton);
		wrapper.appendChild(labelEl);
		const progressEl = createProgressElement(progress, wrapper, visuals.hoverColor);
		if (progressEl) {
			wrapper.appendChild(progressEl);
		}
		const settings = callbacks.getSettings();
		if (settings.overlayTaskShowPlainCheckboxAction) {
			const plainCheckboxProgressEl = createTaskFileLinkPlainCheckboxProgressElement(
				computeTaskFileLinkPlainCheckboxIndicator(resolved.task),
				wrapper,
				{
					app: callbacks.app,
					task: resolved.task,
					keyMappings: settings.keyMappings,
					taskColor: visuals.hoverColor,
					showEmptyAction: true,
				},
			);
			if (plainCheckboxProgressEl) {
				wrapper.appendChild(plainCheckboxProgressEl);
			}
		}
		const chipRow = buildTaskFileOverlayChipContainer(resolved.task, {
			app: callbacks.app,
			getSettings: callbacks.getSettings,
			getAllTasks: callbacks.getAllTasks,
			sourcePath,
			owner: wrapper,
			getProjectSerialDisplay: callbacks.getProjectSerialDisplay,
			getRepeatSkipDates: callbacks.getRepeatSkipDates,
		});
		if (chipRow) {
			wrapper.appendChild(chipRow);
		}
		const isTerminal = visuals.labelState !== 'default';
		if (!isTerminal && settings.overlayTaskShowPlayAction && callbacks.toggleTimer && resolved.task.checkbox === 'open') {
			const isTracking = callbacks.isTaskTracking?.(resolved.task.operonId) === true;
			const playButton = createActionButton(
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action',
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
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action',
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
			noteIndicator.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-wikilink-overlay-standard-action operon-task-wikilink-note-neutral operon-task-chip-action';
			noteIndicator.setCssProps({
				'--operon-live-hover-border': visuals.hoverColor,
				'--operon-task-chip-hover-accent': visuals.hoverColor,
			});
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
				'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action',
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

function resolveReadingTaskFileLink(
	app: App,
	sourcePath: string,
	rawLinktext: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
	alias: string | null,
): ResolvedTaskFileLink | null {
	const resolved = resolveTaskFileLink(
		app,
		sourcePath,
		rawLinktext,
		callbacks.getFileTaskByPath,
		alias,
	);
	if (resolved) return resolved;

	return resolveIndexedTaskFileLink(app, sourcePath, rawLinktext, callbacks, alias);
}

function resolveIndexedTaskFileLink(
	app: App,
	sourcePath: string,
	rawLinktext: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
	alias: string | null,
): ResolvedTaskFileLink | null {
	const trimmed = rawLinktext.trim();
	if (!trimmed) return null;

	const { path, subpath } = parseLinktext(trimmed);
	if (!path || subpath) return null;

	const targetKey = normalizeTaskFileLinkPath(path);
	if (!targetKey) return null;

	const matches = callbacks.getAllTasks().filter(task =>
		task.primary.format === 'yaml'
		&& taskFilePathMatchesLink(task.primary.filePath, targetKey)
	);
	if (matches.length !== 1) return null;

	const task = matches[0];
	if (!task) return null;

	const resolvedFile = app.vault.getAbstractFileByPath(task.primary.filePath);
	if (!(resolvedFile instanceof TFile)) return null;

	return {
		task,
		resolvedFile,
		sourcePath,
		rawLinktext: trimmed,
		alias,
		path,
		subpath,
	};
}

function resolveIndexedNestedTaskFileLinkFromAnchor(
	app: App,
	sourcePath: string,
	anchor: HTMLAnchorElement,
	anchorLinktext: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): ResolvedTaskFileLink | null {
	const label = anchor.textContent?.trim() ?? '';
	if (!label.includes('[[') && !anchorLinktext.includes('[[')) return null;

	const candidates = callbacks.getAllTasks().filter(task =>
		task.primary.format === 'yaml'
		&& indexedNestedTaskFileMatchesAnchor(task, anchorLinktext, label)
	);
	if (candidates.length !== 1) return null;

	const task = candidates[0];
	if (!task) return null;

	const resolvedFile = app.vault.getAbstractFileByPath(task.primary.filePath);
	if (!(resolvedFile instanceof TFile)) return null;

	const rawLinktext = getTaskFilePathLinktext(task.primary.filePath);
	return {
		task,
		resolvedFile,
		sourcePath,
		rawLinktext,
		alias: null,
		path: rawLinktext,
		subpath: '',
	};
}

function prepareVirtualNestedTaskFileAnchors(
	rootEl: HTMLElement,
	sourcePath: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
	sourceMatches: TaskWikiLinkMatch[],
): void {
	if (sourceMatches.length === 0) return;

	const claimedRangesByElement = new Map<HTMLElement, Array<{ from: number; to: number }>>();
	const replacements: RenderedNestedTaskFileReplacement[] = [];
	for (const sourceMatch of sourceMatches) {
		if (!sourceMatch.linktext.includes('[[')) continue;
		const resolved = resolveIndexedTaskFileLink(
			callbacks.app,
			sourcePath,
			sourceMatch.linktext,
			callbacks,
			sourceMatch.alias,
		);
		if (!resolved) continue;

		const target = findRenderedNestedTaskFileTarget(rootEl, sourceMatch.linktext, claimedRangesByElement);
		if (!target) continue;

		claimRenderedNestedTaskFileTarget(claimedRangesByElement, target);
		replacements.push({
			...target,
			linktext: sourceMatch.linktext,
		});
	}

	applyVirtualNestedTaskFileAnchorReplacements(replacements);
}

function findRenderedNestedTaskFileTarget(
	rootEl: HTMLElement,
	linktext: string,
	claimedRangesByElement: Map<HTMLElement, Array<{ from: number; to: number }>>,
): RenderedNestedTaskFileTarget | null {
	const descendantBlocks = Array.from(rootEl.querySelectorAll<HTMLElement>('p, li'));
	const candidates = (
		rootEl.matches('p, li') && descendantBlocks.length === 0
			? [rootEl]
			: descendantBlocks.length > 0
				? descendantBlocks
				: [rootEl]
	)
		.filter(candidate => !candidate.closest('.operon-task-wikilink-reading'));

	const matchingTargets: RenderedNestedTaskFileTarget[] = [];
	for (const candidate of candidates) {
		const renderedText = candidate.textContent ?? '';
		if (!renderedText) continue;
		for (const range of findWikiLinkLabelVariantRanges(getDefaultWikiLinkLabel(linktext), renderedText)) {
			if (isRenderedNestedTaskFileRangeClaimed(claimedRangesByElement, candidate, range)) continue;
			matchingTargets.push({
				element: candidate,
				from: range.from,
				to: range.to,
			});
		}
	}
	return matchingTargets.length === 1 ? matchingTargets[0] ?? null : null;
}

function claimRenderedNestedTaskFileTarget(
	claimedRangesByElement: Map<HTMLElement, Array<{ from: number; to: number }>>,
	target: RenderedNestedTaskFileTarget,
): void {
	const ranges = claimedRangesByElement.get(target.element) ?? [];
	ranges.push({ from: target.from, to: target.to });
	claimedRangesByElement.set(target.element, ranges);
}

function isRenderedNestedTaskFileRangeClaimed(
	claimedRangesByElement: Map<HTMLElement, Array<{ from: number; to: number }>>,
	element: HTMLElement,
	range: { from: number; to: number },
): boolean {
	const claimedRanges = claimedRangesByElement.get(element) ?? [];
	return claimedRanges.some(claimed => rangesOverlap(claimed, range));
}

function rangesOverlap(
	left: { from: number; to: number },
	right: { from: number; to: number },
): boolean {
	return left.from < right.to && right.from < left.to;
}

function applyVirtualNestedTaskFileAnchorReplacements(replacements: RenderedNestedTaskFileReplacement[]): void {
	const replacementsByElement = new Map<HTMLElement, RenderedNestedTaskFileReplacement[]>();
	for (const replacement of replacements) {
		const elementReplacements = replacementsByElement.get(replacement.element) ?? [];
		elementReplacements.push(replacement);
		replacementsByElement.set(replacement.element, elementReplacements);
	}

	for (const [element, elementReplacements] of replacementsByElement.entries()) {
		const sortedReplacements = elementReplacements.slice().sort((left, right) => right.from - left.from);
		if (replaceNativeTextRangesWithVirtualAnchors(element, sortedReplacements)) continue;

		replacePlainTextRangesWithVirtualAnchors(
			element,
			sortedReplacements.slice().sort((left, right) => left.from - right.from),
		);
	}
}

function createVirtualNestedTaskFileAnchor(element: HTMLElement, linktext: string): HTMLElement {
	const anchor = createOwnerElement(element, 'a');
	anchor.classList.add('internal-link');
	anchor.setAttribute('href', linktext);
	anchor.setAttribute('data-href', linktext);
	anchor.textContent = getDefaultWikiLinkLabel(linktext);
	return anchor;
}

function indexedNestedTaskFileMatchesAnchor(
	task: IndexedTask,
	anchorLinktext: string,
	label: string,
): boolean {
	const taskLabel = getIndexedTaskFileLabel(task);
	if (!taskLabel || !taskLabel.includes('[[')) return false;
	if (!getNestedWikiLinkParseArtifactLabel(taskLabel)) return false;

	if (label && isWikiLinkLabelVariant(taskLabel, label)) return true;

	const normalizedAnchor = normalizeTaskFileLinkPath(anchorLinktext);
	if (!normalizedAnchor) return false;
	return taskLabel.startsWith(normalizedAnchor);
}

function getIndexedTaskFileLabel(task: IndexedTask): string {
	const description = task.description.trim();
	if (description) return description;
	return getTaskFilePathLinktext(task.primary.filePath).split('/').pop()?.trim() ?? '';
}

function getTaskFilePathLinktext(filePath: string): string {
	return filePath.trim().replace(/\\/gu, '/').replace(/\.md$/iu, '');
}

function taskFilePathMatchesLink(filePath: string, targetKey: string): boolean {
	const fullPath = normalizeTaskFilePathForComparison(filePath);
	if (!fullPath) return false;
	if (fullPath === targetKey) return true;

	const basename = fullPath.split('/').pop()?.trim() ?? fullPath;
	return basename === targetKey;
}

function normalizeTaskFileLinkPath(path: string): string {
	let normalized = path.trim();
	try {
		normalized = decodeURIComponent(normalized);
	} catch {
		// Keep the original text if it is not URI-encoded.
	}
	return normalized
		.replace(/\\/gu, '/')
		.replace(/^\/+/u, '')
		.replace(/\.md$/iu, '')
		.trim();
}

function normalizeTaskFilePathForComparison(path: string): string {
	return path
		.trim()
		.replace(/\\/gu, '/')
		.replace(/^\/+/u, '')
		.replace(/\.md$/iu, '')
		.trim();
}

function getSourceWikiLinkMatches(sourceText: string | undefined): TaskWikiLinkMatch[] {
	if (!sourceText) return [];
	return scanTaskWikiLinksInLine(sourceText, { includeEmbeds: false });
}

function findSourceWikiLinkMatchForAnchor(
	sourceMatches: TaskWikiLinkMatch[],
	cursor: SourceWikiLinkCursor,
	anchor: HTMLAnchorElement,
	anchorLinktext: string,
	sourcePath: string,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): TaskWikiLinkMatch | null {
	if (sourceMatches.length === 0) return null;

	const anchorResolvedPath = getResolvedLinkPath(callbacks.app, anchorLinktext, sourcePath);
	const findFromCursor = (): TaskWikiLinkMatch | null => {
		for (let index = cursor.index; index < sourceMatches.length; index++) {
			const sourceMatch = sourceMatches[index];
			if (!sourceMatch) continue;
			const sourceResolvedPath = getResolvedLinkPath(callbacks.app, sourceMatch.linktext, sourcePath);

			const isDirectMatch = sourceResolvedPath && anchorResolvedPath
				? sourceResolvedPath === anchorResolvedPath
				: isLikelyAnchorForSourceMatch(anchor, sourceMatch.linktext);
			const isMatch = isDirectMatch || isNestedIndexedSourceMatchForAnchor(
				callbacks.app,
				sourcePath,
				sourceMatch,
				anchor,
				anchorLinktext,
				anchorResolvedPath,
				callbacks,
			);
			if (!isMatch) continue;

			cursor.index = index + 1;
			return sourceMatch;
		}
		return null;
	};

	const match = findFromCursor();
	if (match || cursor.index === 0) return match;

	cursor.index = 0;
	return findFromCursor();
}

function isNestedIndexedSourceMatchForAnchor(
	app: App,
	sourcePath: string,
	sourceMatch: TaskWikiLinkMatch,
	anchor: HTMLAnchorElement,
	anchorLinktext: string,
	anchorResolvedPath: string | null,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): boolean {
	if (!sourceMatch.linktext.includes('[[')) return false;
	const outerResolved = resolveIndexedTaskFileLink(app, sourcePath, sourceMatch.linktext, callbacks, sourceMatch.alias);
	if (!outerResolved) return false;

	if (anchorLinktext.includes('[[') && sourceMatch.linktext.startsWith(anchorLinktext.trim())) {
		return true;
	}

	const innerMatches = scanTaskWikiLinksInLine(sourceMatch.linktext, { includeEmbeds: false });
	if (innerMatches.length === 0) return false;

	for (const innerMatch of innerMatches) {
		if (innerSourceMatchMatchesAnchor(app, sourcePath, innerMatch, anchor, anchorLinktext, anchorResolvedPath)) {
			return true;
		}
	}
	return false;
}

function innerSourceMatchMatchesAnchor(
	app: App,
	sourcePath: string,
	innerMatch: TaskWikiLinkMatch,
	anchor: HTMLAnchorElement,
	anchorLinktext: string,
	anchorResolvedPath: string | null,
): boolean {
	const innerResolvedPath = getResolvedLinkPath(app, innerMatch.linktext, sourcePath);
	if (anchorResolvedPath && innerResolvedPath && anchorResolvedPath === innerResolvedPath) return true;

	if (normalizeTaskFileLinkPath(anchorLinktext) === normalizeTaskFileLinkPath(innerMatch.linktext)) {
		return true;
	}

	const label = anchor.textContent?.trim();
	if (!label) return false;

	const defaultLabel = getDefaultWikiLinkLabel(innerMatch.linktext);
	return !!defaultLabel && isWikiLinkLabelVariant(defaultLabel, label);
}

function getResolvedLinkPath(app: App, linktext: string, sourcePath: string): string | null {
	try {
		return app.metadataCache.getFirstLinkpathDest(linktext, sourcePath)?.path ?? null;
	} catch {
		return null;
	}
}

function isLikelyAnchorForSourceMatch(anchor: HTMLAnchorElement, linktext: string): boolean {
	const label = anchor.textContent?.trim();
	if (!label) return false;

	const defaultLabel = getDefaultWikiLinkLabel(linktext);
	if (!defaultLabel) return false;
	return isWikiLinkLabelVariant(defaultLabel, label);
}

function getAnchorAlias(anchor: HTMLAnchorElement, linktext: string): string | null {
	const label = anchor.textContent?.trim();
	if (!label) return null;

	const defaultLabel = getDefaultWikiLinkLabel(linktext);
	if (!defaultLabel || label === defaultLabel) return null;
	if (isWikiLinkLabelVariant(defaultLabel, label)) return null;
	return label;
}

function getDefaultWikiLinkLabel(linktext: string): string {
	const subpathIndex = [linktext.indexOf('#'), linktext.indexOf('^')]
		.filter(index => index >= 0)
		.sort((left, right) => left - right)[0];
	const path = subpathIndex === undefined ? linktext : linktext.slice(0, subpathIndex);
	const basename = path.split('/').pop()?.trim() ?? path.trim();
	return basename.replace(/\.md$/iu, '');
}

function isWikiLinkLabelVariant(defaultLabel: string, label: string): boolean {
	return getWikiLinkLabelVariants(defaultLabel).includes(label);
}

function findWikiLinkLabelVariantRanges(defaultLabel: string, text: string): Array<{ from: number; to: number }> {
	for (const variant of getWikiLinkLabelVariants(defaultLabel).sort((left, right) => right.length - left.length)) {
		const ranges = findStringRanges(text, variant);
		if (ranges.length > 0) return ranges;
	}
	return [];
}

function findStringRanges(text: string, needle: string): Array<{ from: number; to: number }> {
	if (!needle) return [];
	const ranges: Array<{ from: number; to: number }> = [];
	let from = text.indexOf(needle);
	while (from !== -1) {
		ranges.push({ from, to: from + needle.length });
		from = text.indexOf(needle, from + needle.length);
	}
	return ranges;
}

function getWikiLinkLabelVariants(defaultLabel: string): string[] {
	const variants = [
		defaultLabel,
		`[[${defaultLabel}]]`,
	];

	const artifactLabel = getNestedWikiLinkParseArtifactLabel(defaultLabel);
	if (artifactLabel) {
		variants.push(artifactLabel, `[[${artifactLabel}]]`);
	}

	const innerRenderedArtifactLabel = getNestedWikiLinkInnerRenderedArtifactLabel(defaultLabel);
	if (innerRenderedArtifactLabel) {
		variants.push(innerRenderedArtifactLabel, `[[${innerRenderedArtifactLabel}`);
	}

	return Array.from(new Set(variants.filter(Boolean)));
}

function getNestedWikiLinkParseArtifactLabel(defaultLabel: string): string | null {
	const firstNestedClose = findFirstNestedWikiLinkClose(defaultLabel);
	if (firstNestedClose === -1) return null;

	return `${defaultLabel.slice(0, firstNestedClose)}${defaultLabel.slice(firstNestedClose + 2)}]]`;
}

function getNestedWikiLinkInnerRenderedArtifactLabel(defaultLabel: string): string | null {
	const firstNestedOpen = findFirstNestedWikiLinkOpen(defaultLabel);
	if (firstNestedOpen === -1) return null;
	const firstNestedClose = findFirstNestedWikiLinkClose(defaultLabel);
	if (firstNestedClose === -1 || firstNestedClose <= firstNestedOpen) return null;

	return `${defaultLabel.slice(0, firstNestedOpen)}${defaultLabel.slice(firstNestedOpen + 2, firstNestedClose)}${defaultLabel.slice(firstNestedClose + 2)}]]`;
}

function findFirstNestedWikiLinkOpen(text: string): number {
	for (let i = 0; i < text.length - 1; i++) {
		if (text[i] === '\\') {
			i++;
			continue;
		}
		if (text[i] === '[' && text[i + 1] === '[') return i;
	}
	return -1;
}

function findFirstNestedWikiLinkClose(text: string): number {
	for (let i = 0; i < text.length - 1; i++) {
		if (text[i] === '\\') {
			i++;
			continue;
		}
		if (text[i] === '[' && text[i + 1] === '[') {
			for (let j = i + 2; j < text.length - 1; j++) {
				if (text[j] === '\\') {
					j++;
					continue;
				}
				if (text[j] === ']' && text[j + 1] === ']') return j;
			}
			return -1;
		}
	}
	return -1;
}

function replaceNativeTextRangesWithVirtualAnchors(
	element: HTMLElement,
	replacements: RenderedNestedTaskFileReplacement[],
): boolean {
	if (!canReplaceNativeTextRanges(element)) return false;

	for (const replacement of replacements) {
		const anchor = createVirtualNestedTaskFileAnchor(element, replacement.linktext);
		if (!replaceNativeTextRangeWithNode(element, replacement.from, replacement.to, anchor)) return false;
	}
	return true;
}

function canReplaceNativeTextRanges(element: HTMLElement): boolean {
	const ownerDocument = element.ownerDocument;
	return typeof ownerDocument.createRange === 'function'
		&& typeof ownerDocument.createTreeWalker === 'function';
}

function replacePlainTextRangesWithVirtualAnchors(
	element: HTMLElement,
	replacements: RenderedNestedTaskFileReplacement[],
): void {
	const text = element.textContent ?? '';
	element.empty();

	let cursor = 0;
	for (const replacement of replacements) {
		if (replacement.from < cursor) continue;
		appendPlainTextElement(element, text.slice(cursor, replacement.from));
		element.appendChild(createVirtualNestedTaskFileAnchor(element, replacement.linktext));
		cursor = replacement.to;
	}
	appendPlainTextElement(element, text.slice(cursor));
}

function replaceNativeTextRangeWithNode(element: HTMLElement, from: number, to: number, replacement: HTMLElement): boolean {
	const ownerDocument = element.ownerDocument;
	if (typeof ownerDocument.createRange !== 'function' || typeof ownerDocument.createTreeWalker !== 'function') {
		return false;
	}

	const startPosition = findTextPosition(element, from);
	const endPosition = findTextPosition(element, to);
	if (!startPosition || !endPosition) return false;

	const range = ownerDocument.createRange();
	range.setStart(startPosition.node, startPosition.offset);
	range.setEnd(endPosition.node, endPosition.offset);
	range.deleteContents();
	range.insertNode(replacement);
	return true;
}

function findTextPosition(element: HTMLElement, offset: number): { node: Text; offset: number } | null {
	const textNodes = collectTextNodes(element);
	let cursor = 0;
	let lastNode: Text | null = null;
	for (const node of textNodes) {
		const length = node.data.length;
		const nextCursor = cursor + length;
		if (offset <= nextCursor) {
			return { node, offset: Math.max(0, offset - cursor) };
		}
		cursor = nextCursor;
		lastNode = node;
	}
	if (lastNode && offset === cursor) return { node: lastNode, offset: lastNode.data.length };
	return null;
}

function collectTextNodes(element: HTMLElement): Text[] {
	const ownerDocument = element.ownerDocument;
	const defaultView = ownerDocument.defaultView as (Window & { NodeFilter?: { SHOW_TEXT: number } }) | null;
	const showText = defaultView?.NodeFilter?.SHOW_TEXT ?? NodeFilter.SHOW_TEXT;
	const walker = ownerDocument.createTreeWalker(element, showText);
	const nodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		nodes.push(node as Text);
		node = walker.nextNode();
	}
	return nodes;
}

function appendPlainTextElement(element: HTMLElement, text: string): void {
	if (!text) return;
	const textEl = createOwnerElement(element, 'span');
	textEl.textContent = text;
	element.appendChild(textEl);
}

function createTaskFileLinkLabel(
	anchor: HTMLAnchorElement,
	resolved: ResolvedTaskFileLink,
	visuals: TaskFileLinkVisuals,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): HTMLElement {
	const alias = resolved.alias?.trim();
	if (alias) {
		prepareTaskFileLinkAnchor(anchor, resolved, visuals, callbacks);
		return anchor;
	}

	const description = resolved.task.description.trim();
	if (!description) {
		prepareTaskFileLinkAnchor(anchor, resolved, visuals, callbacks);
		return anchor;
	}

	const label = createOwnerElement(anchor, 'span');
	const rendered = renderTaskDescriptionWikilinks(label, {
		app: callbacks.app,
		description,
		sourcePath: resolved.task.primary.filePath,
		containerClassName: 'operon-task-wikilink-label-markdown',
		linkClassName: 'operon-task-wikilink-label-description-link',
	});
	if (!rendered) {
		prepareTaskFileLinkAnchor(anchor, resolved, visuals, callbacks);
		return anchor;
	}

	label.classList.add('internal-link', 'operon-task-wikilink-anchor', 'operon-task-wikilink-label');
	label.dataset.operonTaskWikilinkEnhanced = 'true';
	label.setAttribute('data-href', resolved.rawLinktext);
	label.setAttribute('role', 'link');
	label.setAttribute('tabindex', '0');
	applyTaskFileLinkLabelState(label, visuals);
	bindTaskTitleLinkPreview(callbacks.app, label, resolved.resolvedFile.path, resolved.sourcePath);
	label.addEventListener('click', (event) => {
		if (isTaskDescriptionWikilinkEventTarget(event.target, label)) return;
		event.preventDefault();
		event.stopPropagation();
		void callbacks.app.workspace.openLinkText(resolved.resolvedFile.path, resolved.sourcePath, false);
	});
	label.addEventListener('keydown', (event) => {
		if (event.target !== label) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		void callbacks.app.workspace.openLinkText(resolved.resolvedFile.path, resolved.sourcePath, false);
	});

	anchor.remove();
	return label;
}

function prepareTaskFileLinkAnchor(
	anchor: HTMLAnchorElement,
	resolved: ResolvedTaskFileLink,
	visuals: TaskFileLinkVisuals,
	callbacks: ReadingTaskFileWikilinkCallbacks,
): void {
	anchor.dataset.operonTaskWikilinkEnhanced = 'true';
	anchor.classList.add('operon-task-wikilink-anchor');
	applyTaskFileLinkLabelState(anchor, visuals);
	bindTaskTitleLinkPreview(callbacks.app, anchor, resolved.resolvedFile.path, resolved.sourcePath);
	anchor.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		void callbacks.app.workspace.openLinkText(resolved.resolvedFile.path, resolved.sourcePath, false);
	});
	anchor.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		void callbacks.app.workspace.openLinkText(resolved.resolvedFile.path, resolved.sourcePath, false);
	});
}

function applyTaskFileLinkLabelState(label: HTMLElement, visuals: TaskFileLinkVisuals): void {
	if (visuals.labelState === 'done') {
		label.classList.add('operon-task-done');
	} else if (visuals.labelState === 'cancelled') {
		label.classList.add('operon-task-cancelled');
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
	button.setCssProps({
		'--operon-live-hover-border': hoverColor,
		'--operon-task-chip-hover-accent': hoverColor,
		'--operon-task-wikilink-hover': hoverColor,
	});
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

function createProgressElement(progress: TaskFileLinkProgressIndicator, owner: Node | null | undefined, taskColor: string | null): HTMLElement | null {
	if (progress.kind === 'none') return null;

	const el = createOwnerElement(owner, 'span');
	el.className = 'operon-task-wikilink-progress operon-task-chip operon-task-chip-progress';

	if (progress.kind === 'count') {
		el.classList.add('operon-task-wikilink-progress-count');
		appendTaskFileLinkProgressCountContent(el, 'list-tree', progress.text);
		const tooltip = buildTaskFileLinkProgressTooltip(progress);
		setAccessibleLabelWithoutTooltip(el, tooltip?.accessibleLabel ?? progress.text);
		bindOperonHoverTooltip(el, {
			title: tooltip?.title,
			content: tooltip?.content ?? progress.text,
			taskColor,
		});
		return el;
	}

	const tooltip = buildTaskFileLinkProgressTooltip(progress);
	el.classList.add('operon-task-wikilink-progress-complete');
	bindOperonHoverTooltip(el, {
		title: tooltip?.title,
		content: tooltip?.content ?? t('tooltips', 'allDescendantsDone'),
		taskColor,
	});
	setIcon(el, progress.icon);
	setAccessibleLabelWithoutTooltip(el, tooltip?.accessibleLabel ?? t('tooltips', 'allDescendantsDone'));
	return el;
}
