import { App, TFile, parseLinktext } from 'obsidian';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { Pipeline, parseStatusValue } from '../types/pipeline';

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
	| { kind: 'complete'; icon: 'check-check' };

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
	if (!(resolvedFile instanceof TFile)) return null;

	const task = getFileTaskByPath(resolvedFile.path);
	if (!task) return null;

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
		return taskDone ? { kind: 'complete', icon: 'check-check' } : { kind: 'none' };
	}

	if (taskDone && summary.allDone) {
		return { kind: 'complete', icon: 'check-check' };
	}

	return {
		kind: 'count',
		done: summary.done,
		total: summary.total,
		text: `${summary.done}/${summary.total}`,
	};
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
