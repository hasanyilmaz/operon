import type { TableTaskTreeRenderItem } from './table-task-tree';

export interface TableVirtualRowDescriptor<TItem> {
	key: string;
	item: TItem;
	index: number;
}

export interface TableVirtualRowCache<TRow> {
	host: object | null;
	renderIdentity: object | null;
	rows: Map<string, TRow>;
}

export interface TableVirtualRowReconcileStats {
	created: number;
	reused: number;
	removed: number;
	entered: number;
	exited: number;
	reset: boolean;
}

export interface TableVirtualRowReconcileResult<TItem, TRow> {
	entries: Array<TableVirtualRowDescriptor<TItem> & { row: TRow }>;
	stats: TableVirtualRowReconcileStats;
}

interface ReconcileTableVirtualRowsOptions<TItem, TRow> {
	cache: TableVirtualRowCache<TRow>;
	host: object;
	renderIdentity: object;
	items: readonly TItem[];
	startIndex: number;
	endIndex: number;
	forceReset?: boolean;
	resolveKey: (item: TItem) => string;
	createRow: (descriptor: TableVirtualRowDescriptor<TItem>) => TRow;
	updateRow?: (row: TRow, descriptor: TableVirtualRowDescriptor<TItem>) => void;
	removeRow: (row: TRow) => void;
}

export function createTableVirtualRowCache<TRow>(): TableVirtualRowCache<TRow> {
	return {
		host: null,
		renderIdentity: null,
		rows: new Map<string, TRow>(),
	};
}

export function resolveTableVirtualRowKey(item: TableTaskTreeRenderItem): string {
	if (item.kind === 'task') return `task:${item.ordinalKey}`;
	if (item.kind === 'parentContext') return `parentContext:${item.occurrenceKey}`;
	if (item.kind === 'group') return `group:${item.groupKey}`;
	if (item.kind === 'groupSummary') return `groupSummary:${item.groupKey}`;
	return 'summary:total';
}

export function clearTableVirtualRowCache<TRow>(
	cache: TableVirtualRowCache<TRow>,
	removeRow: (row: TRow) => void,
): number {
	let removed = 0;
	for (const row of cache.rows.values()) {
		removeRow(row);
		removed += 1;
	}
	cache.rows.clear();
	cache.host = null;
	cache.renderIdentity = null;
	return removed;
}

export function reconcileTableVirtualRows<TItem, TRow>(
	options: ReconcileTableVirtualRowsOptions<TItem, TRow>,
): TableVirtualRowReconcileResult<TItem, TRow> {
	const startIndex = Math.max(0, Math.min(options.items.length, Math.floor(options.startIndex)));
	const endIndex = Math.max(startIndex, Math.min(options.items.length, Math.ceil(options.endIndex)));
	const descriptors: TableVirtualRowDescriptor<TItem>[] = [];
	for (let index = startIndex; index < endIndex; index += 1) {
		const item = options.items[index];
		if (item === undefined) continue;
		descriptors.push({ key: options.resolveKey(item), item, index });
	}
	const desiredKeys = new Set(descriptors.map(descriptor => descriptor.key));
	const hostChanged = options.cache.host !== null && options.cache.host !== options.host;
	const identityChanged = options.cache.renderIdentity !== null
		&& options.cache.renderIdentity !== options.renderIdentity;
	const reset = options.forceReset === true || hostChanged || identityChanged;
	let removed = 0;
	let exited = 0;
	if (reset) {
		exited = options.cache.rows.size;
		removed = clearTableVirtualRowCache(options.cache, options.removeRow);
	} else {
		for (const [key, row] of options.cache.rows) {
			if (desiredKeys.has(key)) continue;
			options.removeRow(row);
			options.cache.rows.delete(key);
			removed += 1;
			exited += 1;
		}
	}
	options.cache.host = options.host;
	options.cache.renderIdentity = options.renderIdentity;

	let created = 0;
	let reused = 0;
	let entered = 0;
	const entries: Array<TableVirtualRowDescriptor<TItem> & { row: TRow }> = [];
	for (const descriptor of descriptors) {
		let row = options.cache.rows.get(descriptor.key);
		if (row === undefined) {
			row = options.createRow(descriptor);
			options.cache.rows.set(descriptor.key, row);
			created += 1;
			entered += 1;
		} else {
			reused += 1;
		}
		options.updateRow?.(row, descriptor);
		entries.push({ ...descriptor, row });
	}
	return {
		entries,
		stats: { created, reused, removed, entered, exited, reset },
	};
}

export function orderTableVirtualRowElements(container: HTMLElement, elements: readonly HTMLElement[]): void {
	let cursor = container.firstElementChild;
	for (const element of elements) {
		if (element === cursor) {
			cursor = cursor.nextElementSibling;
			continue;
		}
		container.insertBefore(element, cursor);
	}
}
