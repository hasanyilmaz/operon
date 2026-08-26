import { setIcon } from 'obsidian';

import { getOwnerWindow } from '../../core/dom-compat';
import { t } from '../../core/i18n';
import type { TableGanttSettings } from '../../types/table';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { createFloatingPanel, requestFloatingInputFocus, snapshotFloatingRectAnchor } from '../field-pickers/common';
import { renderTableGanttSettingsForm } from './table-gantt-settings-form';

export interface TableGanttSettingsPopoverOptions {
	anchor: HTMLButtonElement;
	gantt: TableGanttSettings;
	onCommit: (gantt: TableGanttSettings) => Promise<void>;
	onCommitError: (error: unknown) => void;
	onClose?: (close: () => void) => void;
	resolveFallbackFocusTarget?: () => HTMLElement | null;
}

export interface TableGanttSettingsPopoverHandle {
	close: () => void;
	id: string;
}

let tableGanttSettingsPopoverSequence = 0;

export function createTableGanttSettingsDraft(gantt: TableGanttSettings): TableGanttSettings {
	return { ...gantt };
}

export function buildTableGanttSettingsCommit(
	current: TableGanttSettings,
	draft: TableGanttSettings,
): TableGanttSettings {
	return {
		...draft,
		enabled: current.enabled,
	};
}

export function showTableGanttSettingsPopover(options: TableGanttSettingsPopoverOptions): TableGanttSettingsPopoverHandle {
	const draft = createTableGanttSettingsDraft(options.gantt);
	const initialSignature = JSON.stringify(draft);
	const ownerWindow = getOwnerWindow(options.anchor);
	let saveInFlight = false;
	let restoreFocusOnClose = false;
	let closePopover = (): void => undefined;
	const { panel, close: closePanel } = createFloatingPanel(
		snapshotFloatingRectAnchor(options.anchor),
		'operon-floating-panel operon-table-gantt-settings-popover',
		() => {
			options.anchor.setAttribute('aria-expanded', 'false');
			options.anchor.removeAttribute('aria-controls');
			options.onClose?.(closePopover);
			if (!restoreFocusOnClose) return;
			ownerWindow.requestAnimationFrame(() => {
				const focusTarget = options.anchor.isConnected
					? options.anchor
					: options.resolveFallbackFocusTarget?.() ?? null;
				if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
			});
		},
		{
			outsideClickExclusions: () => {
				const fallback = options.resolveFallbackFocusTarget?.() ?? null;
				return fallback && fallback !== options.anchor ? [options.anchor, fallback] : [options.anchor];
			},
			closeOnWindowResize: false,
			repositionOnWindowResize: true,
			repositionOnPanelResize: true,
			repositionOnScroll: true,
			shouldClose: reason => {
				if (saveInFlight || reason === 'window-blur') return false;
				if (reason === 'escape') restoreFocusOnClose = true;
				return true;
			},
		},
	);
	closePopover = (): void => closePanel();

	tableGanttSettingsPopoverSequence += 1;
	panel.id = `operon-table-gantt-settings-popover-${tableGanttSettingsPopoverSequence}`;
	panel.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(panel, t('table', 'ganttView'));
	options.anchor.setAttribute('aria-expanded', 'true');
	options.anchor.setAttribute('aria-controls', panel.id);

	const header = panel.createDiv('operon-table-gantt-settings-popover-header');
	const headerIcon = header.createSpan('operon-table-gantt-settings-popover-icon');
	setIcon(headerIcon, 'chart-gantt');
	header.createDiv({
		cls: 'operon-table-gantt-settings-popover-title',
		text: t('table', 'ganttView'),
	});

	const form = panel.createDiv('operon-table-gantt-settings-popover-form');
	let dirty = false;
	let saveButton: HTMLButtonElement | null = null;
	const formHandle = renderTableGanttSettingsForm({
		container: form,
		gantt: draft,
		includeEnabled: false,
		onChange: () => {
			dirty = JSON.stringify(draft) !== initialSignature;
			if (saveButton) saveButton.disabled = !dirty || saveInFlight;
		},
	});

	const footer = panel.createDiv('operon-table-gantt-settings-popover-footer');
	const cancelButton = footer.createEl('button', {
		cls: 'operon-table-gantt-settings-popover-button',
		text: t('buttons', 'cancel'),
		attr: { type: 'button' },
	});
	saveButton = footer.createEl('button', {
		cls: 'operon-table-gantt-settings-popover-button mod-cta',
		text: t('buttons', 'save'),
		attr: { type: 'button' },
	});
	saveButton.disabled = true;

	cancelButton.addEventListener('click', event => {
		event.preventDefault();
		if (saveInFlight) return;
		restoreFocusOnClose = true;
		closePanel();
	});
	saveButton.addEventListener('click', event => {
		event.preventDefault();
		if (!dirty || saveInFlight) return;
		saveInFlight = true;
		panel.setAttribute('aria-busy', 'true');
		formHandle.setDisabled(true);
		cancelButton.disabled = true;
		saveButton.disabled = true;
		void options.onCommit(createTableGanttSettingsDraft(draft)).then(() => {
			restoreFocusOnClose = true;
			closePanel();
		}).catch(error => {
			saveInFlight = false;
			panel.removeAttribute('aria-busy');
			formHandle.setDisabled(false);
			cancelButton.disabled = false;
			if (saveButton) saveButton.disabled = !dirty;
			options.onCommitError(error);
		});
	});

	requestFloatingInputFocus(form.querySelector<HTMLElement>('input, select') ?? cancelButton);
	return { close: closePopover, id: panel.id };
}
