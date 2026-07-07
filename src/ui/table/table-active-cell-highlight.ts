const ACTIVE_CELL_CLASS = 'is-active-cell';
const BEFORE_ACTIVE_CELL_CLASS = 'is-before-active-cell';
const AFTER_ACTIVE_CELL_CLASS = 'is-after-active-cell';
const ACTIVE_ROW_CLASS = 'is-active-cell-row';
const TABLE_HIGHLIGHT_TARGET_SELECTOR = '.operon-table-row > .operon-table-cell, .operon-table-summary-row > .operon-table-summary-cell, .operon-table-group-row';
const TABLE_TEXT_EDIT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

export interface TableActiveCellHighlightBinding {
	clear: () => void;
	destroy: () => void;
}

export function bindTableActiveCellHighlight(canvas: HTMLElement): TableActiveCellHighlightBinding {
	let activeCell: HTMLElement | null = null;
	let beforeActiveCell: HTMLElement | null = null;
	let afterActiveCell: HTMLElement | null = null;
	let activeRow: HTMLElement | null = null;
	let focusSyncFrame: number | null = null;
	const ownerWindow = canvas.ownerDocument.defaultView ?? window;

	const cancelFocusSync = (): void => {
		if (focusSyncFrame === null) return;
		ownerWindow.cancelAnimationFrame(focusSyncFrame);
		focusSyncFrame = null;
	};

	const isTableHighlightGridCell = (element: HTMLElement): boolean => (
		element.classList.contains('operon-table-cell') ||
		element.classList.contains('operon-table-summary-cell')
	);

	const isTextEditingElement = (element: HTMLElement): boolean => {
		const tagName = element.tagName.toLowerCase();
		if (tagName === 'textarea') {
			const textarea = element as HTMLTextAreaElement;
			return !textarea.disabled && !textarea.readOnly;
		}
		if (tagName === 'input') {
			const input = element as HTMLInputElement;
			const type = (input.getAttribute('type') ?? input.type ?? '').toLowerCase();
			return !input.disabled && !input.readOnly && TABLE_TEXT_EDIT_INPUT_TYPES.has(type);
		}
		const contentEditable = element.getAttribute('contenteditable');
		return element.isContentEditable === true || (contentEditable !== null && contentEditable.toLowerCase() !== 'false');
	};

	const resolveTableHighlightTarget = (target: EventTarget | null): HTMLElement | null => {
		if (!(target instanceof ownerWindow.Element)) return null;
		const cell = target.closest<HTMLElement>(TABLE_HIGHLIGHT_TARGET_SELECTOR);
		if (!cell || !canvas.contains(cell)) return null;
		return cell;
	};

	const resolveFocusedTextEditCell = (): HTMLElement | null => {
		const activeElement = canvas.ownerDocument.activeElement;
		if (!(activeElement instanceof ownerWindow.HTMLElement) || !isTextEditingElement(activeElement)) return null;
		return resolveTableHighlightTarget(activeElement);
	};

	const resolveAdjacentCell = (cell: HTMLElement, direction: 'previous' | 'next'): HTMLElement | null => {
		if (!isTableHighlightGridCell(cell)) return null;
		const sibling = direction === 'previous' ? cell.previousElementSibling : cell.nextElementSibling;
		if (!(sibling instanceof ownerWindow.HTMLElement) || !isTableHighlightGridCell(sibling)) return null;
		return sibling;
	};

	const removeHighlightClasses = (): void => {
		activeCell?.classList.remove(ACTIVE_CELL_CLASS);
		beforeActiveCell?.classList.remove(BEFORE_ACTIVE_CELL_CLASS);
		afterActiveCell?.classList.remove(AFTER_ACTIVE_CELL_CLASS);
		activeRow?.classList.remove(ACTIVE_ROW_CLASS);
		activeCell = null;
		beforeActiveCell = null;
		afterActiveCell = null;
		activeRow = null;
	};

	const clear = (): void => {
		cancelFocusSync();
		removeHighlightClasses();
	};

	const activateCell = (cell: HTMLElement | null): void => {
		cancelFocusSync();
		if (!cell) {
			removeHighlightClasses();
			return;
		}
		if (cell === activeCell) return;
		removeHighlightClasses();
		activeCell = cell;
		beforeActiveCell = resolveAdjacentCell(cell, 'previous');
		afterActiveCell = resolveAdjacentCell(cell, 'next');
		activeRow = cell.classList.contains('operon-table-group-row')
			? cell
			: cell.parentElement instanceof ownerWindow.HTMLElement ? cell.parentElement : null;
		activeCell.classList.add(ACTIVE_CELL_CLASS);
		beforeActiveCell?.classList.add(BEFORE_ACTIVE_CELL_CLASS);
		afterActiveCell?.classList.add(AFTER_ACTIVE_CELL_CLASS);
		activeRow?.classList.add(ACTIVE_ROW_CLASS);
	};

	const syncToFocusedCell = (): boolean => {
		const focusedCell = resolveTableHighlightTarget(canvas.ownerDocument.activeElement);
		if (!focusedCell) return false;
		activateCell(focusedCell);
		return true;
	};

	const handlePointerOver = (event: PointerEvent): void => {
		const focusedTextEditCell = resolveFocusedTextEditCell();
		if (focusedTextEditCell) {
			activateCell(focusedTextEditCell);
			return;
		}
		const cell = resolveTableHighlightTarget(event.target);
		if (cell) {
			activateCell(cell);
			return;
		}
		if (syncToFocusedCell()) return;
		removeHighlightClasses();
	};

	const handlePointerLeave = (): void => {
		if (syncToFocusedCell()) return;
		clear();
	};

	const handleFocusIn = (event: FocusEvent): void => {
		activateCell(resolveTableHighlightTarget(event.target));
	};

	const handleFocusOut = (): void => {
		cancelFocusSync();
		focusSyncFrame = ownerWindow.requestAnimationFrame(() => {
			focusSyncFrame = null;
			if (syncToFocusedCell()) return;
			removeHighlightClasses();
		});
	};

	canvas.addEventListener('pointerover', handlePointerOver);
	canvas.addEventListener('pointerleave', handlePointerLeave);
	canvas.addEventListener('focusin', handleFocusIn);
	canvas.addEventListener('focusout', handleFocusOut);

	return {
		clear,
		destroy: () => {
			canvas.removeEventListener('pointerover', handlePointerOver);
			canvas.removeEventListener('pointerleave', handlePointerLeave);
			canvas.removeEventListener('focusin', handleFocusIn);
			canvas.removeEventListener('focusout', handleFocusOut);
			clear();
		},
	};
}
