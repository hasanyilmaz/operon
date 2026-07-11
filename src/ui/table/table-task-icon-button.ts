import { setIcon } from 'obsidian';
import type {
	ContextualMenuActionHandler,
} from '../../core/contextual-menu-engine';
import { resolveTaskDisplayIcon, type OperonSettings } from '../../types/settings';
import { resolveTaskStatusIconColorForTask } from '../../core/task-color-source';
import type { IndexedTask } from '../../types/fields';
import { t } from '../../core/i18n';
import { bindTaskContextualHoverMenu } from '../contextual-hover-menu';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';

interface TableTaskIconButtonOptions {
	task: IndexedTask;
	settings: OperonSettings;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	readOnly?: boolean;
	onContextualAction?: ContextualMenuActionHandler;
	isPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
}

interface TableTaskContextualHoverMenuOptions {
	task: IndexedTask;
	settings: OperonSettings;
	onContextualAction: ContextualMenuActionHandler;
	isPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

export function bindTableTaskContextualHoverMenu(
	trigger: HTMLElement,
	options: TableTaskContextualHoverMenuOptions,
): void {
	bindTaskContextualHoverMenu(trigger, {
		surface: 'tableTask',
		taskId: options.task.operonId,
		getTask: () => options.task,
		getSettings: () => options.settings,
		onAction: options.onContextualAction,
		isPinned: options.isPinned ? () => options.isPinned?.(options.task.operonId) === true : undefined,
		hasSubtasks: options.hasSubtasks ? () => options.hasSubtasks?.(options.task.operonId) === true : undefined,
	});
}

export function renderTableTaskIconButton(container: HTMLElement, options: TableTaskIconButtonOptions): void {
	const trigger = container.createSpan('operon-calendar-hover-menu-trigger operon-table-task-icon-trigger');
	const button = trigger.createEl('button', {
		cls: 'operon-checkbox operon-calendar-status-button is-compact operon-table-task-icon-button',
		attr: {
			type: 'button',
		},
	});
	const readOnly = options.readOnly === true || !options.onStatusIconClick;
	if (readOnly) {
		button.disabled = true;
		button.setAttribute('aria-disabled', 'true');
		button.addClass('is-readonly');
	}
	const iconName = resolveTaskDisplayIcon(
		options.settings,
		options.task.fieldValues,
		options.task.checkbox,
		options.workflowStatusIdentityIndex,
	);
	if (iconName) {
		setIcon(button, iconName);
	}
	setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));
	const iconColor = resolveTaskStatusIconColorForTask(
		options.task,
		options.settings,
		options.workflowStatusIdentityIndex,
	);
	if (iconColor) button.style.color = iconColor;
	else button.style.removeProperty('color');
	button.addEventListener('pointerdown', event => {
		event.preventDefault();
	});
	if (!readOnly) {
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			void Promise.resolve(options.onStatusIconClick?.(options.task.operonId)).catch(error => {
				console.error('Operon: table status icon click failed', error);
			});
		});
	}

	if (!readOnly && options.onContextualAction) {
		bindTableTaskContextualHoverMenu(trigger, {
			task: options.task,
			settings: options.settings,
			onContextualAction: options.onContextualAction,
			isPinned: options.isPinned,
			hasSubtasks: options.hasSubtasks,
		});
	}
}
