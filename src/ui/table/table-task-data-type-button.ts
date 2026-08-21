import { setIcon } from 'obsidian';
import type { ContextualMenuActionHandler } from '../../core/contextual-menu-engine';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { resolveSubtaskActionIcon } from '../../core/subtask-action';
import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { isTaskSourceOpenModifierClick } from '../task-source-open-modifier';
import { bindTableTaskContextualHoverMenu } from './table-task-icon-button';

export interface TableTaskDataTypeButtonOptions {
	task: IndexedTask;
	onOpenTaskEditor?: (operonId: string) => void;
	onOpenTaskSource?: (operonId: string) => void | Promise<void>;
	settings?: OperonSettings;
	onContextualAction?: ContextualMenuActionHandler;
	isPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

function bindTableTaskDataTypeContextualHoverMenu(trigger: HTMLElement, options: TableTaskDataTypeButtonOptions): void {
	if (!options.settings || !options.onContextualAction) return;
	bindTableTaskContextualHoverMenu(trigger, {
		task: options.task,
		settings: options.settings,
		onContextualAction: options.onContextualAction,
		isPinned: options.isPinned,
		hasSubtasks: options.hasSubtasks,
	});
}

function handleTableTaskDataTypeClick(event: MouseEvent, options: TableTaskDataTypeButtonOptions): void {
	event.preventDefault();
	event.stopPropagation();
	if (options.onOpenTaskSource && isTaskSourceOpenModifierClick(event)) {
		void Promise.resolve(options.onOpenTaskSource(options.task.operonId)).catch(error => {
		console.error('Operon: failed to open Table Task Data Type source', error);
		});
		return;
	}
	options.onOpenTaskEditor?.(options.task.operonId);
}

export function bindTableTaskDataTypeEditorOpen(trigger: HTMLElement, options: TableTaskDataTypeButtonOptions): void {
	if (options.onOpenTaskEditor || options.onOpenTaskSource) {
		trigger.addClass('is-task-data-type-editor-trigger');
		trigger.setAttribute('role', 'button');
		setAccessibleLabelWithoutTooltip(trigger, t('tooltips', 'openTaskEditor'));
		trigger.addEventListener('click', event => {
			handleTableTaskDataTypeClick(event, options);
		});
		trigger.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			options.onOpenTaskEditor?.(options.task.operonId);
		});
	}
	bindTableTaskDataTypeContextualHoverMenu(trigger, options);
}

export function renderTableTaskDataTypeButton(container: HTMLElement, options: TableTaskDataTypeButtonOptions): void {
	const button = container.createEl('button', {
		cls: 'operon-table-task-data-type-button',
		attr: { type: 'button' },
	});
	setIcon(button, resolveSubtaskActionIcon(options.task));
	setAccessibleLabelWithoutTooltip(button, t('tooltips', 'openTaskEditor'));
	button.addEventListener('click', event => {
		handleTableTaskDataTypeClick(event, options);
	});
	bindTableTaskDataTypeContextualHoverMenu(button, options);
}
