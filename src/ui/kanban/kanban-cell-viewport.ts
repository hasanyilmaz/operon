import { buildKanbanVirtualAxis, getKanbanVirtualRange, kanbanVirtualCellKey, type KanbanVirtualAxis, type KanbanVirtualTrack } from '../../systems/kanban-virtual-geometry';

interface ViewportModel {
	rows: readonly KanbanVirtualTrack[];
	columns: readonly KanbanVirtualTrack[];
	gap: number;
	railWidth: number;
	headerHeight: number;
	classic: boolean;
}
interface MountedCell { rowKey: string; columnKey: string; element: HTMLElement }
interface Options {
	viewport: HTMLElement;
	content: HTMLElement;
	header: HTMLElement;
	createHeader: (index: number) => HTMLElement;
	createRow: (index: number) => HTMLElement;
	createCell: (row: HTMLElement, rowIndex: number, columnIndex: number) => HTMLElement;
	removeHeader: (element: HTMLElement) => void;
	removeRow: (element: HTMLElement) => void;
	removeCell: (element: HTMLElement) => void;
	keepCell: (element: HTMLElement) => boolean;
	beforeFirstMount?: () => void;
	afterMount: () => void;
	onResize: () => void;
}

/** Owns only mounted DOM; the data provider remains responsible for board semantics. */
export class KanbanCellViewport {
	private readonly win: Window;
	private readonly body: HTMLElement;
	private readonly rows = new Map<string, HTMLElement>();
	private readonly headers = new Map<string, HTMLElement>();
	private readonly cells = new Map<string, MountedCell>();
	private model: ViewportModel | null = null;
	private frame: number | null = null;
	private disposed = false;
	private firstMount = true;
	private readonly observer: ResizeObserver;
	private height = -1;
	private width = -1;
	rowAxis = buildKanbanVirtualAxis([], 0);
	columnAxis = buildKanbanVirtualAxis([], 0);
	rowOrigin = 0;
	columnOrigin = 0;

	constructor(private readonly options: Options) {
		this.win = options.viewport.ownerDocument.defaultView!;
		this.body = options.content.createDiv('operon-kanban-virtual-body');
		options.content.classList.add('is-virtualized');
		options.viewport.addEventListener('scroll', this.schedule, { passive: true });
		options.viewport.addEventListener('focusout', this.schedule);
		options.viewport.addEventListener('dragend', this.schedule);
		options.viewport.addEventListener('pointerup', this.schedule);
		options.viewport.addEventListener('keydown', this.onKeyDown);
		this.observer = new (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => {
			if (this.disposed) return;
			const { clientHeight, clientWidth } = options.viewport;
			if (clientHeight === this.height && clientWidth === this.width) return;
			this.height = clientHeight;
			this.width = clientWidth;
			options.onResize();
			this.layout();
		});
		this.observer.observe(options.viewport);
	}

	update(model: ViewportModel): void {
		this.model = model;
		this.columnAxis = buildKanbanVirtualAxis(model.columns, model.gap);
		this.layout();
	}
	private layout(): void {
		const model = this.model;
		if (!model || this.disposed) return;
		this.rowOrigin = model.headerHeight + model.gap;
		this.columnOrigin = model.railWidth > 0 ? model.railWidth + model.gap : 0;
		this.rowAxis = buildKanbanVirtualAxis(model.classic
			? model.rows.map(row => ({ ...row, size: Math.max(0, this.options.viewport.clientHeight - this.rowOrigin) }))
			: model.rows, model.gap);
		const width = this.columnOrigin + this.columnAxis.extent;
		this.options.content.style.width = `${width}px`;
		this.options.header.style.height = `${model.headerHeight}px`;
		this.body.style.height = `${this.rowAxis.extent}px`;
		if (this.firstMount && this.options.viewport.clientWidth > 0 && this.options.viewport.clientHeight > 0) {
			this.firstMount = false;
			this.options.beforeFirstMount?.();
		}
		this.refresh();
	}

	readonly schedule = (): void => {
		if (this.disposed || this.frame !== null) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = null;
			this.refresh();
		});
	};

	refresh(): void {
		const model = this.model;
		if (this.disposed || !model) return;
		const viewport = this.options.viewport;
		const visible = viewport.clientWidth > 0 && viewport.clientHeight > 0;
		const rowRange = getKanbanVirtualRange(this.rowAxis, viewport.scrollTop, visible ? viewport.clientHeight - this.rowOrigin : 0);
		const columnRange = getKanbanVirtualRange(this.columnAxis, viewport.scrollLeft, visible ? viewport.clientWidth - this.columnOrigin : 0);
		const desired = new Map<string, { row: number; column: number }>();
		const rowIndices = new Set<number>();
		const columnIndices = new Set<number>();
		for (let row = rowRange.start; row < rowRange.end; row++) rowIndices.add(row);
		for (let column = columnRange.start; column < columnRange.end; column++) columnIndices.add(column);
		for (const row of rowIndices) for (const column of columnIndices) {
			desired.set(kanbanVirtualCellKey(this.rowAxis.tracks[row].key, this.columnAxis.tracks[column].key), { row, column });
		}
		// Interaction pins are sparse additions, never a bounding rectangle.
		for (const [key, cell] of this.cells) {
			const row = this.rowAxis.indices.get(cell.rowKey);
			const column = this.columnAxis.indices.get(cell.columnKey);
			if (row === undefined || column === undefined || !this.options.keepCell(cell.element)) continue;
			desired.set(key, { row, column });
			rowIndices.add(row);
		}
		const active = viewport.ownerDocument.activeElement;
		for (const [key, header] of this.headers) {
			const index = this.columnAxis.indices.get(key);
			if (index !== undefined && active && header.contains(active)) columnIndices.add(index);
		}
		for (const [key, row] of this.rows) {
			const index = this.rowAxis.indices.get(key);
			if (index !== undefined && active && row.contains(active)) rowIndices.add(index);
		}
		for (const [key, cell] of this.cells) if (!desired.has(key)) {
			this.options.removeCell(cell.element);
			cell.element.remove();
			this.cells.delete(key);
		}
		this.reconcileAxis(this.rows, this.rowAxis, rowIndices, this.body, this.options.createRow, this.options.removeRow, (element, index) => {
			element.style.top = `${this.rowAxis.starts[index]}px`;
			element.style.height = `${this.rowAxis.tracks[index].size}px`;
		});
		this.reconcileAxis(this.headers, this.columnAxis, columnIndices, this.options.header, this.options.createHeader, this.options.removeHeader, (element, index) => {
			element.style.left = `${this.columnOrigin + this.columnAxis.starts[index]}px`;
			element.style.width = `${this.columnAxis.tracks[index].size}px`;
		});
		let mounted = false;
		for (const [key, { row, column }] of [...desired].sort((a, b) => a[1].row - b[1].row || a[1].column - b[1].column)) {
			const rowKey = this.rowAxis.tracks[row].key;
			const columnKey = this.columnAxis.tracks[column].key;
			let cell = this.cells.get(key);
			if (!cell) {
				const element = this.options.createCell(this.rows.get(rowKey)!, row, column);
				cell = { rowKey, columnKey, element };
				this.cells.set(key, cell);
				mounted = true;
			}
			cell.element.style.left = `${this.columnOrigin + this.columnAxis.starts[column]}px`;
			cell.element.style.width = `${this.columnAxis.tracks[column].size}px`;
			// Ordered DOM without detaching retained/focused elements.
			const parent = this.rows.get(rowKey)!;
			const following = Array.from(parent.children).find(child => {
				const index = this.columnAxis.indices.get((child as HTMLElement).dataset.kanbanStatusId ?? '');
				return index !== undefined && index > column;
			});
			if (following && cell.element.nextElementSibling !== following) parent.insertBefore(cell.element, following);
		}
		if (mounted) this.options.afterMount();
	}

	private reconcileAxis(elements: Map<string, HTMLElement>, axis: KanbanVirtualAxis, indices: Set<number>, host: HTMLElement,
		create: (index: number) => HTMLElement, remove: (element: HTMLElement) => void, position: (element: HTMLElement, index: number) => void): void {
		for (const [key, element] of elements) if (!indices.has(axis.indices.get(key) ?? -1)) {
			remove(element);
			element.remove();
			elements.delete(key);
		}
		for (const index of [...indices].sort((a, b) => a - b)) {
			const key = axis.tracks[index].key;
			let element = elements.get(key);
			if (!element) {
				element = create(index);
				const next = [...elements].filter(([other]) => (axis.indices.get(other) ?? -1) > index)
					.sort((a, b) => axis.indices.get(a[0])! - axis.indices.get(b[0])!)[0]?.[1];
				host.insertBefore(element, next ?? null);
				elements.set(key, element);
			}
			position(element, index);
		}
	}

	getCell(row: string, column: string): HTMLElement | null { return this.cells.get(kanbanVirtualCellKey(row, column))?.element ?? null; }
	getRow(key: string): HTMLElement | null { return this.rows.get(key) ?? null; }
	getColumnOffsets(): Map<string, number> { return new Map(this.columnAxis.tracks.map((track, index) => [track.key, this.columnOrigin + this.columnAxis.starts[index]])); }
	getRowOffsets(): Map<string, number> { return new Map(this.rowAxis.tracks.map((track, index) => [track.key, this.rowOrigin + this.rowAxis.starts[index]])); }

	private reveal(row: number | null, column: number | null): void {
		const viewport = this.options.viewport;
		const scroll = (axis: KanbanVirtualAxis, index: number, offset: number, available: number): number => {
			const start = axis.starts[index], end = start + axis.tracks[index].size;
			return start < offset || axis.tracks[index].size > available ? start : end > offset + available ? Math.max(0, end - available) : offset;
		};
		if (row !== null) viewport.scrollTop = scroll(this.rowAxis, row, viewport.scrollTop, viewport.clientHeight - this.rowOrigin);
		if (column !== null) viewport.scrollLeft = scroll(this.columnAxis, column, viewport.scrollLeft, viewport.clientWidth - this.columnOrigin);
		this.refresh();
	}

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		const active = this.options.viewport.ownerDocument.activeElement as HTMLElement | null;
		const unit = active?.closest<HTMLElement>('.operon-kanban-cell, .operon-kanban-lane-label, .operon-kanban-column-header');
		if (!active || !unit) return;
		const controls = this.focusable(unit);
		if (active !== unit && active !== (event.shiftKey ? controls[0] : controls[controls.length - 1])) return;
		const backwards = event.shiftKey;
		const rowKey = unit.dataset.kanbanLaneKey;
		const columnKey = unit.dataset.kanbanStatusId;
		let row = rowKey === undefined ? -1 : this.rowAxis.indices.get(rowKey) ?? -1;
		let column = columnKey === undefined ? -1 : this.columnAxis.indices.get(columnKey) ?? -1;
		const lastColumn = this.columnAxis.tracks.length - 1;
		const hasLabels = (this.model?.railWidth ?? 0) > 0;
		if (row < 0) {
			column += backwards ? -1 : 1;
			if (column < 0) return; // Browser can return to the corner/toolbar.
			if (column > lastColumn) { row = 0; column = hasLabels ? -1 : 0; }
		} else if (column < 0) {
			if (backwards) { row--; column = lastColumn; }
			else column = 0;
		} else if (backwards) {
			column--;
			if (column < 0 && !hasLabels) { row--; column = lastColumn; }
		} else {
			column++;
			if (column > lastColumn) { row++; column = hasLabels ? -1 : 0; }
		}
		if (row >= this.rowAxis.tracks.length || lastColumn < 0) return;
		event.preventDefault();
		if (row < 0) this.options.viewport.scrollTop = 0;
		this.reveal(row < 0 ? null : row, column < 0 ? null : column);
		const target = row < 0 ? this.headers.get(this.columnAxis.tracks[column].key)
			: column < 0 ? this.rows.get(this.rowAxis.tracks[row].key)?.querySelector<HTMLElement>('.operon-kanban-lane-label')
			: this.getCell(this.rowAxis.tracks[row].key, this.columnAxis.tracks[column].key);
		if (!target) return;
		const nextControls = this.focusable(target);
		const focus = backwards ? nextControls[nextControls.length - 1] : nextControls[0];
		if (focus) focus.focus({ preventScroll: true });
		else { target.tabIndex = -1; target.focus({ preventScroll: true }); }
		this.schedule();
	};

	private focusable(element: HTMLElement): HTMLElement[] {
		return Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]'))
			.filter(control => control.tabIndex >= 0 && !control.closest('[inert]') && control.getClientRects().length > 0
				&& !['hidden', 'collapse'].includes(this.win.getComputedStyle(control).visibility));
	}
	dispose(): void {
		this.disposed = true;
		if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
		this.observer.disconnect();
		const viewport = this.options.viewport;
		viewport.removeEventListener('scroll', this.schedule);
		viewport.removeEventListener('focusout', this.schedule);
		viewport.removeEventListener('dragend', this.schedule);
		viewport.removeEventListener('pointerup', this.schedule);
		viewport.removeEventListener('keydown', this.onKeyDown);
		for (const cell of this.cells.values()) this.options.removeCell(cell.element);
		for (const row of this.rows.values()) this.options.removeRow(row);
		for (const header of this.headers.values()) { this.options.removeHeader(header); header.remove(); }
		this.cells.clear(); this.rows.clear(); this.headers.clear();
		this.body.remove();
	}
}
