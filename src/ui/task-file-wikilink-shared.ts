import { App, TFile, parseLinktext, setIcon } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { KeyMapping, OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { Pipeline, parseStatusValue } from '../types/pipeline';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { computePlainCheckboxProgressIndicator, PlainCheckboxProgressIndicator } from './plain-checkbox-progress';
import { bindPlainCheckboxPopoverTrigger } from './plain-checkbox-popover';

export interface ResolvedTaskFileLink {
	task: IndexedTask;
	resolvedFile: TFile;
	sourcePath: string;
	rawLinktext: string;
	alias: string | null;
	path: string;
	subpath: string;
}

export interface TaskFileLinkVisuals {
	hoverColor: string;
	statusColor: string;
	iconName: string;
	labelState: TaskFileLinkLabelState;
}

export type FileTaskLookup = (filePath: string) => IndexedTask | undefined;
export type TaskFileLinkLabelState = 'default' | 'done' | 'cancelled';

export type TaskFileLinkProgressIndicator =
	| { kind: 'none' }
	| { kind: 'count'; done: number; total: number; text: string }
	| { kind: 'complete'; icon: 'check-check'; scope: 'task' | 'subtasks' };

export type TaskFileLinkPlainCheckboxIndicator = PlainCheckboxProgressIndicator;

export interface TaskFileLinkPlainCheckboxProgressElementOptions {
	app: App;
	task: IndexedTask;
	keyMappings: KeyMapping[];
	taskColor?: string | null;
	showEmptyAction?: boolean;
}

export interface TaskFileLinkProgressTooltip {
	title?: string;
	content: string;
	accessibleLabel: string;
}

export function splitRawWikiLinkBody(body: string): { linktext: string; alias: string | null } {
	const pipeIndex = body.indexOf('|');
	if (pipeIndex === -1) {
		return { linktext: body.trim(), alias: null };
	}

	return {
		linktext: body.slice(0, pipeIndex).trim(),
		alias: body.slice(pipeIndex + 1).trim() || null,
	};
}

export function resolveTaskFileLink(
	app: App,
	sourcePath: string,
	rawLinktext: string,
	getFileTaskByPath: FileTaskLookup,
	alias: string | null = null,
): ResolvedTaskFileLink | null {
	const trimmed = rawLinktext.trim();
	if (!trimmed) return null;

	const { path, subpath } = parseLinktext(trimmed);
	if (!path || subpath) return null;

	const resolvedFile = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
	const resolvedTarget = resolveTaskFileLinkTarget(resolvedFile, getFileTaskByPath);
	if (resolvedTarget) {
		return buildResolvedTaskFileLink(resolvedTarget, sourcePath, trimmed, alias, path, subpath);
	}
	if (resolvedFile instanceof TFile) return null;

	const fallbackTarget = resolveTaskFileLinkTargetFromVault(app, path, getFileTaskByPath);
	if (!fallbackTarget) return null;

	return buildResolvedTaskFileLink(fallbackTarget, sourcePath, trimmed, alias, path, subpath);
}

function buildResolvedTaskFileLink(
	target: { resolvedFile: TFile; task: IndexedTask },
	sourcePath: string,
	rawLinktext: string,
	alias: string | null,
	path: string,
	subpath: string,
): ResolvedTaskFileLink {
	return {
		task: target.task,
		resolvedFile: target.resolvedFile,
		sourcePath,
		rawLinktext,
		alias,
		path,
		subpath,
	};
}

function resolveTaskFileLinkTarget(
	file: unknown,
	getFileTaskByPath: FileTaskLookup,
): { resolvedFile: TFile; task: IndexedTask } | null {
	if (!(file instanceof TFile)) return null;
	const task = getFileTaskByPath(file.path);
	return task ? { resolvedFile: file, task } : null;
}

function resolveTaskFileLinkTargetFromVault(
	app: App,
	linkPath: string,
	getFileTaskByPath: FileTaskLookup,
): { resolvedFile: TFile; task: IndexedTask } | null {
	const resolvedFile = resolveTaskFileLinkFileFromVault(app, linkPath);
	return resolveTaskFileLinkTarget(resolvedFile, getFileTaskByPath);
}

function resolveTaskFileLinkFileFromVault(app: App, linkPath: string): TFile | null {
	const targetKey = normalizeTaskFileLinkPath(linkPath);
	if (!targetKey) return null;

	if (targetKey.includes('/')) {
		const directMatches = getUniqueTaskFileLinkFiles(
			getDirectTaskFileLinkPathCandidates(linkPath)
				.map(candidatePath => getVaultAbstractFileByPath(app, candidatePath)),
		);
		if (directMatches.length > 0) return directMatches.length === 1 ? directMatches[0] : null;
	}

	const markdownMatches = getUniqueTaskFileLinkFiles(
		getVaultMarkdownFiles(app).filter(file => taskFilePathMatchesLink(file.path, targetKey)),
	);
	if (markdownMatches.length > 0) return markdownMatches.length === 1 ? markdownMatches[0] : null;

	const directMatches = getUniqueTaskFileLinkFiles(
		getDirectTaskFileLinkPathCandidates(linkPath)
			.map(candidatePath => getVaultAbstractFileByPath(app, candidatePath)),
	);
	return directMatches.length === 1 ? directMatches[0] : null;
}

function getUniqueTaskFileLinkFiles(files: unknown[]): TFile[] {
	const unique = new Map<string, TFile>();
	for (const file of files) {
		if (!(file instanceof TFile)) continue;
		unique.set(file.path, file);
	}
	return [...unique.values()];
}

function getVaultAbstractFileByPath(app: App, path: string): unknown {
	const vault = app.vault as { getAbstractFileByPath?: (path: string) => unknown };
	return vault.getAbstractFileByPath?.(path) ?? null;
}

function getVaultMarkdownFiles(app: App): TFile[] {
	const vault = app.vault as { getMarkdownFiles?: () => TFile[] };
	return vault.getMarkdownFiles?.() ?? [];
}

function getDirectTaskFileLinkPathCandidates(linkPath: string): string[] {
	const normalizedPath = normalizeTaskFileLinkPath(linkPath);
	if (!normalizedPath) return [];
	const candidates = new Set<string>();
	candidates.add(normalizedPath);
	candidates.add(`${normalizedPath}.md`);
	return [...candidates];
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

export function computeTaskFileLinkVisuals(
	task: IndexedTask,
	settings: OperonSettings,
	pipelines: Pipeline[],
): TaskFileLinkVisuals {
	return {
		hoverColor: normalizeTaskColor(task.fieldValues['taskColor']) ?? 'var(--interactive-accent)',
		statusColor: lookupStatusColor(task.fieldValues['status'], pipelines),
		iconName: resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox),
		labelState: getTaskFileLinkLabelState(task),
	};
}

export function computeTaskFileLinkProgressIndicator(
	task: Pick<IndexedTask, 'checkbox'>,
	summary: DescendantTaskSummary,
): TaskFileLinkProgressIndicator {
	const taskDone = task.checkbox === 'done';
	if (summary.total === 0) {
		return taskDone ? { kind: 'complete', icon: 'check-check', scope: 'task' } : { kind: 'none' };
	}

	if (taskDone && summary.allDone) {
		return { kind: 'complete', icon: 'check-check', scope: 'subtasks' };
	}

	return {
		kind: 'count',
		done: summary.done,
		total: summary.total,
		text: `${summary.done}/${summary.total}`,
	};
}

export function computeTaskFileLinkPlainCheckboxIndicator(
	task: Pick<IndexedTask, 'plainCheckboxProgress'>,
): TaskFileLinkPlainCheckboxIndicator {
	return computePlainCheckboxProgressIndicator(task.plainCheckboxProgress);
}

export function buildTaskFileLinkProgressTooltip(
	indicator: TaskFileLinkProgressIndicator,
): TaskFileLinkProgressTooltip | null {
	if (indicator.kind === 'none') return null;

	if (indicator.kind === 'count') {
		const title = t('tooltips', 'subtasks');
		const content = buildSubtaskProgressTooltipContent(indicator.done, indicator.total);
		return {
			title,
			content,
			accessibleLabel: `${title}: ${content}`,
		};
	}

	if (indicator.scope === 'subtasks') {
		const title = t('tooltips', 'subtasks');
		const content = t('tooltips', 'subtasksComplete');
		return {
			title,
			content,
			accessibleLabel: `${title}: ${content}`,
		};
	}

	const content = t('tooltips', 'allDescendantsDone');
	return {
		content,
		accessibleLabel: content,
	};
}

export function createTaskFileLinkPlainCheckboxProgressElement(
	indicator: TaskFileLinkPlainCheckboxIndicator,
	owner?: Node | null,
	options?: TaskFileLinkPlainCheckboxProgressElementOptions,
): HTMLElement | null {
	if (indicator.kind === 'none' && options?.showEmptyAction !== true) return null;

	const el = createOwnerElement(owner, 'span');
	el.className = 'operon-task-wikilink-progress operon-task-wikilink-progress-count operon-task-wikilink-plain-checkbox-progress operon-task-chip operon-task-chip-progress';
	if (indicator.kind === 'none') {
		el.classList.add('is-empty');
	} else if (indicator.allCompleted) {
		el.classList.add('is-complete');
	}
	appendTaskFileLinkProgressCountContent(el, 'layout-list', indicator.kind === 'count' ? indicator.text : null);
	if (indicator.kind === 'count') {
		setAccessibleLabelWithoutTooltip(el, `${t('tooltips', 'plainCheckboxes')}: ${indicator.tooltipContent}`);
		bindOperonHoverTooltip(el, {
			title: t('tooltips', 'plainCheckboxes'),
			content: indicator.tooltipContent,
			taskColor: options?.taskColor ?? null,
		});
	} else {
		const tooltipTitle = t('tooltips', 'plainCheckboxEditorAdd');
		setAccessibleLabelWithoutTooltip(el, tooltipTitle);
		bindOperonHoverTooltip(el, {
			title: tooltipTitle,
			taskColor: options?.taskColor ?? null,
		});
	}
	if (options) {
		bindPlainCheckboxPopoverTrigger(el, {
			app: options.app,
			task: options.task,
			keyMappings: options.keyMappings,
			taskColor: options.taskColor ?? null,
			seedEmptyDraft: indicator.kind === 'none',
		});
	}
	return el;
}

export function appendTaskFileLinkProgressCountContent(
	el: HTMLElement,
	iconName: string,
	text: string | null,
): void {
	const iconEl = createOwnerElement(el, 'span');
	iconEl.className = 'operon-task-wikilink-progress-icon';
	iconEl.dataset.operonProgressIcon = iconName;
	setIcon(iconEl, iconName);
	el.appendChild(iconEl);

	if (text === null) return;
	const labelEl = createOwnerElement(el, 'span');
	labelEl.className = 'operon-task-wikilink-progress-label';
	labelEl.textContent = text;
	el.appendChild(labelEl);
}

function buildSubtaskProgressTooltipContent(doneValue: number, totalValue: number): string {
	const total = Math.max(totalValue, 0);
	if (total <= 0) return t('tooltips', 'subtasksComplete');
	const done = Math.min(Math.max(doneValue, 0), total);
	const percent = Math.round((done / total) * 100);
	if (percent === 0) return t('tooltips', 'subtasksNotStarted');
	if (done === total) return t('tooltips', 'subtasksComplete');
	return t('tooltips', 'subtasksPercentComplete', { percent: String(percent) });
}

function getTaskFileLinkLabelState(task: IndexedTask): TaskFileLinkLabelState {
	if (task.checkbox === 'done') return 'done';
	if (task.checkbox === 'cancelled') return 'cancelled';
	return 'default';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
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
