import { setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import { resolveSubtaskActionIcon } from '../../core/subtask-action';
import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { isTaskSourceOpenModifierClick } from '../task-source-open-modifier';

export interface TableTaskTypeButtonOptions {
	task: IndexedTask;
	onOpenTaskEditor?: (operonId: string) => void;
	onOpenTaskSource?: (operonId: string) => void | Promise<void>;
}

function handleTableTaskTypeClick(event: MouseEvent, options: TableTaskTypeButtonOptions): void {
	event.preventDefault();
	event.stopPropagation();
	if (options.onOpenTaskSource && isTaskSourceOpenModifierClick(event)) {
		void Promise.resolve(options.onOpenTaskSource(options.task.operonId)).catch(error => {
			console.error('Operon: failed to open table task type source', error);
		});
		return;
	}
	options.onOpenTaskEditor?.(options.task.operonId);
}

export function bindTableTaskTypeEditorOpen(trigger: HTMLElement, options: TableTaskTypeButtonOptions): void {
	if (!options.onOpenTaskEditor && !options.onOpenTaskSource) return;
	trigger.addClass('is-task-type-editor-trigger');
	trigger.setAttribute('role', 'button');
	setAccessibleLabelWithoutTooltip(trigger, t('tooltips', 'openTaskEditor'));
	trigger.addEventListener('click', event => {
		handleTableTaskTypeClick(event, options);
	});
	trigger.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		options.onOpenTaskEditor?.(options.task.operonId);
	});
}

export function renderTableTaskTypeButton(container: HTMLElement, options: TableTaskTypeButtonOptions): void {
	const button = container.createEl('button', {
		cls: 'operon-table-task-type-button',
		attr: { type: 'button' },
	});
	setIcon(button, resolveSubtaskActionIcon(options.task));
	setAccessibleLabelWithoutTooltip(button, t('tooltips', 'openTaskEditor'));
	button.addEventListener('click', event => {
		handleTableTaskTypeClick(event, options);
	});
}
