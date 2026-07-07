import type { IndexedTask } from '../types/fields';
import { findStatusDef, type Pipeline } from '../types/pipeline';
import type { PriorityDefinition } from '../types/priority';
import { t } from './i18n';

export type TaskColorSource = 'taskColor' | 'statusColor' | 'priorityColor' | 'accentColor' | 'noColor';
export type CalendarTaskColorSource = 'noColor' | 'accentColor' | 'taskColor' | 'statusColor' | 'priorityColor';
export type CalendarPresetTaskColorSource = 'noColor' | 'taskColor' | 'statusColor' | 'priorityColor';
export type KanbanTaskColorSource = 'noColor' | 'taskColor' | 'statusColor' | 'priorityColor';
export type PinnedDockTaskColorSource = CalendarTaskColorSource;
export type TaskStatusIconColorSource = 'statusColor' | 'taskColor' | 'priorityColor' | 'noColor';

export const CALENDAR_TASK_COLOR_SOURCES = ['noColor', 'accentColor', 'taskColor', 'statusColor', 'priorityColor'] as const;
export const CALENDAR_PRESET_TASK_COLOR_SOURCES = ['noColor', 'taskColor', 'statusColor', 'priorityColor'] as const;
export const KANBAN_TASK_COLOR_SOURCES = ['noColor', 'taskColor', 'statusColor', 'priorityColor'] as const;
export const PINNED_DOCK_TASK_COLOR_SOURCES = CALENDAR_TASK_COLOR_SOURCES;
export const TASK_STATUS_ICON_COLOR_SOURCES = ['statusColor', 'taskColor', 'priorityColor', 'noColor'] as const;

const TASK_COLOR_SOURCE_LABELS: Record<TaskColorSource, string> = {
	noColor: 'No color',
	accentColor: 'Accent color',
	taskColor: 'Task color',
	statusColor: 'Status color',
	priorityColor: 'Priority color',
};

const TASK_COLOR_SOURCE_LABEL_KEYS: Record<TaskColorSource, string> = {
	noColor: 'taskColorSource_noColor',
	accentColor: 'taskColorSource_accentColor',
	taskColor: 'taskColorSource_taskColor',
	statusColor: 'taskColorSource_statusColor',
	priorityColor: 'taskColorSource_priorityColor',
};

const TASK_COLOR_SOURCE_ICONS: Record<TaskColorSource, string> = {
	noColor: 'ban',
	accentColor: 'obsidian',
	taskColor: 'palette',
	statusColor: 'workflow',
	priorityColor: 'flag',
};

export interface TaskColorSourceDropdown {
	addOption(value: string, label: string): unknown;
}

export interface TaskColorSourceSettings {
	pipelines: Pipeline[];
	priorities: PriorityDefinition[];
}

export function addTaskColorSourceOptions(
	dropdown: TaskColorSourceDropdown,
	sources: readonly TaskColorSource[],
): void {
	for (const source of sources) {
		dropdown.addOption(source, getTaskColorSourceLabel(source));
	}
}

export function getTaskColorSourceLabel(source: TaskColorSource): string {
	const key = TASK_COLOR_SOURCE_LABEL_KEYS[source];
	const localized = t('settings', key);
	return localized === key ? TASK_COLOR_SOURCE_LABELS[source] : localized;
}

export function getTaskColorSourceIcon(source: TaskColorSource): string {
	return TASK_COLOR_SOURCE_ICONS[source];
}

export function normalizeTaskColorSource<T extends TaskColorSource>(
	value: unknown,
	allowedSources: readonly T[],
	fallback: T,
): T {
	return typeof value === 'string' && (allowedSources as readonly string[]).includes(value)
			? value as T
			: fallback;
}

export function getNextTaskColorSource<T extends TaskColorSource>(
	value: unknown,
	allowedSources: readonly T[],
	fallback: T,
): T {
	if (allowedSources.length === 0) return fallback;
	const normalized = normalizeTaskColorSource(value, allowedSources, fallback);
	const currentIndex = allowedSources.indexOf(normalized);
	const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % allowedSources.length : 0;
	return allowedSources[nextIndex] ?? fallback;
}

export function resolveTaskColorSourceForTask(
	task: IndexedTask,
	colorSource: TaskColorSource,
	settings: TaskColorSourceSettings,
): string | null {
	return resolveTaskColorSource(task.fieldValues, colorSource, settings);
}

export function resolveTaskStatusIconColorForTask(
	task: IndexedTask,
	settings: TaskColorSourceSettings & { taskStatusIconColorSource: TaskStatusIconColorSource },
): string | null {
	return resolveTaskStatusIconColor(task.fieldValues, settings);
}

export function resolveTaskStatusIconColor(
	fieldValues: Record<string, string | undefined>,
	settings: TaskColorSourceSettings & { taskStatusIconColorSource: TaskStatusIconColorSource },
): string | null {
	return resolveTaskColorSource(fieldValues, settings.taskStatusIconColorSource, settings);
}

export function resolveTaskColorSource(
	fieldValues: Record<string, string | undefined>,
	colorSource: TaskColorSource,
	settings: TaskColorSourceSettings,
	options: { externalColor?: string | null } = {},
): string | null {
	if (colorSource === 'noColor') {
		return null;
	}
	if (colorSource === 'accentColor') {
		return 'var(--interactive-accent)';
	}

	const externalColor = normalizeColor(options.externalColor);
	if (externalColor) {
		return externalColor;
	}

	if (colorSource === 'taskColor') {
		return normalizeTaskFieldColor(fieldValues['taskColor']);
	}
	if (colorSource === 'statusColor') {
		const statusDef = findStatusDef(settings.pipelines, fieldValues['status'] ?? '');
		return normalizeColor(statusDef?.color);
	}

	const priorityLabel = (fieldValues['priority'] ?? '').trim();
	if (!priorityLabel) return null;
	const priorityDef = settings.priorities.find(priority => priority.label === priorityLabel);
	return normalizeColor(priorityDef?.color);
}

export function normalizeTaskFieldColor(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim().replace(/^#/, '');
	return /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : null;
}

export function normalizeColor(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('#') || trimmed.startsWith('var(')) return trimmed;
	return /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
}
