import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';

export interface TableGanttToolbarToggleOptions {
	container: HTMLElement;
	enabled: boolean;
	canChangePreset: boolean;
	onToggle: () => Promise<void>;
	onToggleError: (error: unknown) => void;
	onInteraction?: () => void;
}

export function resolveNextTableGanttEnabled(enabled: boolean): boolean {
	return !enabled;
}

export function renderTableGanttToolbarToggle(options: TableGanttToolbarToggleOptions): HTMLButtonElement {
	const label = t('table', 'ganttView');
	const button = options.container.createEl('button', {
		cls: 'operon-table-toolbar-icon-button operon-table-gantt-toggle',
		attr: {
			type: 'button',
			'aria-pressed': String(options.enabled),
		},
	});
	button.classList.toggle('is-active', options.enabled);
	button.disabled = !options.canChangePreset;
	setIcon(button, 'chart-gantt');
	setAccessibleLabelWithoutTooltip(button, label);
	bindOperonHoverTooltip(button, {
		content: label,
		taskColor: null,
		preferredVertical: 'below',
	});
	button.addEventListener('mousedown', event => event.stopPropagation());
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		if (button.disabled) return;
		options.onInteraction?.();
		button.disabled = true;
		void options.onToggle().catch(error => {
			button.disabled = !options.canChangePreset;
			options.onToggleError(error);
		});
	});
	return button;
}
