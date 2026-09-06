import type { App } from 'obsidian';
import { getOwnerWindow } from '../../core/dom-compat';
import { getLocationPlaceIndex } from '../../core/location-source-resolver';
import type { OperonSettings } from '../../types/settings';
import type { IndexedTask } from '../../types/fields';
import { shouldResolveLocationCompactChips } from '../compact-task-layout';
import { buildCompactCardChipRow, type CompactCardChipRowCallbacks, type CompactCardChipRowOptions } from '../compact-card-chips';
export type KanbanTaskChipRowCallbacks = CompactCardChipRowCallbacks;
export type KanbanTaskChipRowOptions = Omit<CompactCardChipRowOptions, 'profile' | 'classPrefix' | 'bindTarget' | 'bindRow'>;
export function buildKanbanTaskChipRow(task: IndexedTask, callbacks: KanbanTaskChipRowCallbacks, options: KanbanTaskChipRowOptions): HTMLElement | null {
 const settings = callbacks.getSettings();
 return buildCompactCardChipRow(task, callbacks, { ...options,
  profile: { items: settings.kanbanTaskCompactChips, play: settings.kanbanTaskShowPlayAction, pin: settings.kanbanTaskShowPinAction, note: settings.kanbanTaskShowNoteAction, subtask: settings.kanbanTaskShowSubtaskAction, checkbox: settings.kanbanTaskShowPlainCheckboxAction },
  isTargetReadOnly: isKanbanChipActionReadOnly, classPrefix: 'operon-kanban-card', bindTarget: bindKanbanAxisActivationBridge,
  bindRow: row => { bindKanbanChipRowDynamicReadOnlyGuard(row); if (!options.readOnly) bindKanbanChipRowDragShield(row); },
 });
}
export function getKanbanTaskChipLocationSignature(app: App, settings: OperonSettings): string {
 return shouldResolveLocationCompactChips(settings, settings.kanbanTaskCompactChips) ? getLocationPlaceIndex(app, settings).getSignature() : '';
}
function isKanbanChipRowReadOnly(row: HTMLElement): boolean {
	return row.classList.contains('is-read-only')
		|| row.closest<HTMLElement>('.operon-kanban-board')?.classList.contains('is-mobile-layout') === true;
}

function isKanbanChipActionReadOnly(chip: HTMLElement): boolean {
	const row = chip.closest<HTMLElement>('.operon-kanban-card-chip-row');
	if (chip.classList.contains('is-note-editable') && !row?.classList.contains('is-read-only')) return false;
	return !!row && isKanbanChipRowReadOnly(row);
}

function bindKanbanChipRowDynamicReadOnlyGuard(row: HTMLElement): void {
	const stopChipSpecificAction = (event: Event): void => {
		if (!isKanbanChipRowReadOnly(row)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	row.addEventListener('contextmenu', stopChipSpecificAction, { capture: true });
	row.addEventListener('mouseover', stopChipSpecificAction, { capture: true });
	row.addEventListener('mousemove', stopChipSpecificAction, { capture: true });
}

function bindKanbanChipRowDragShield(row: HTMLElement): void {
	let restoreCard: HTMLElement | null = null;
	let restoreDraggable = false;

	const release = (): void => {
		if (restoreCard) {
			restoreCard.draggable = restoreDraggable;
			restoreCard = null;
		}
		const ownerWindow = getOwnerWindow(row);
		ownerWindow.removeEventListener('pointerup', release, true);
		ownerWindow.removeEventListener('pointercancel', release, true);
		ownerWindow.removeEventListener('mouseup', release, true);
		ownerWindow.removeEventListener('dragend', release, true);
		ownerWindow.removeEventListener('blur', release, true);
	};

	const arm = (event: PointerEvent | MouseEvent): void => {
		if (isKanbanChipRowReadOnly(row)) return;
		if (event.button !== 0 || restoreCard) return;
		const card = row.closest<HTMLElement>('.operon-kanban-card');
		if (!card || !card.draggable) return;
		restoreCard = card;
		restoreDraggable = card.draggable;
		card.draggable = false;
		const ownerWindow = getOwnerWindow(row);
		ownerWindow.addEventListener('pointerup', release, true);
		ownerWindow.addEventListener('pointercancel', release, true);
		ownerWindow.addEventListener('mouseup', release, true);
		ownerWindow.addEventListener('dragend', release, true);
		ownerWindow.addEventListener('blur', release, true);
	};

	row.addEventListener('pointerdown', arm, { capture: true });
	row.addEventListener('mousedown', arm, { capture: true });
	row.addEventListener('dragstart', event => {
		if (isKanbanChipRowReadOnly(row)) {
			release();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		release();
	}, { capture: true });
}

function bindKanbanAxisActivationBridge(target: HTMLElement): void {
	const requestAxisHighlight = (): void => {
		const cell = target.closest<HTMLElement>('.operon-kanban-cell');
		const board = target.closest<HTMLElement>('.operon-kanban-board');
		if (!cell || !board || board.classList.contains('is-mobile-layout')) return;
		getOwnerWindow(target).requestAnimationFrame(() => {
			if (!target.isConnected || !cell.isConnected || !board.isConnected) return;
			if (!target.matches(':hover, :focus-within')) return;
			board.dispatchEvent(new CustomEvent('operon-kanban-axis-activate', {
				bubbles: true,
				detail: { cell },
			}));
		});
	};
	target.addEventListener('mouseenter', requestAxisHighlight);
	target.addEventListener('focusin', requestAxisHighlight);
}
