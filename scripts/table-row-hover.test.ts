import assert from 'node:assert/strict';
import { bindTableActiveCellHighlight } from '../src/ui/table/table-active-cell-highlight';
import { withTableRowHover } from '../src/ui/table/table-row-hover';

export function testTableRowHover(): void {
	const makeRow = (key = 'task:a', transform = 'translateY(20px)') => {
		const classes = new Set<string>();
		const listeners = new Map<string, () => void>();
		return { dataset: { operonVirtualRowKey: key }, style: { transform, width: '500px' }, isConnected: true,
			classes, listeners, querySelector: () => null,
			classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
			addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
			removeEventListener: (name: string) => listeners.delete(name),
		};
	};
	const flag = 'is-operon-table-refresh-hover';
	const frames: Array<() => void> = [];
	let hovered: ReturnType<typeof makeRow> | null = makeRow();
	let rows = [hovered];
	let scans = 0;
	let nativeReady = true;
	const root = { isConnected: true, querySelector: (selector: string) => selector.endsWith(':hover') && !nativeReady ? null : hovered, querySelectorAll: () => { scans++; return rows; },
		ownerDocument: { defaultView: { requestAnimationFrame: (fn: () => void) => frames.push(fn), cancelAnimationFrame: (id: number) => { frames.splice(id - 1, 1); } } },
	} as unknown as HTMLElement;
	const replace = (next = makeRow()): void => { if (hovered) hovered.isConnected = false; rows = [next]; };
	withTableRowHover(root, () => replace());
	assert.equal(rows[0].classes.has(flag), true);
	assert.equal(frames.length, 1);
	hovered = rows[0]; nativeReady = false;
	withTableRowHover(root, () => {});
	assert.equal(rows[0].classes.has(flag), true, 'no-op render keeps bridge until native hover is ready');
	assert.equal(frames.length, 1);
	nativeReady = true;
	frames.shift()!();
	assert.equal(rows[0].classes.has(flag), false);
	assert.equal(rows[0].listeners.size, 0);
	for (const next of [makeRow('task:b'), makeRow('task:a', 'translateY(40px)'), { ...makeRow(), style: { transform: 'translateY(20px)', width: '700px' } }]) {
		hovered = makeRow(); withTableRowHover(root, () => replace(next));
		assert.equal(next.classes.has(flag), false);
	}
	hovered = null; scans = 0;
	withTableRowHover(root, () => {});
	assert.equal(scans, 0); assert.equal(frames.length, 0);
	hovered = makeRow(); rows = [hovered];
	withTableRowHover(root, () => {});
	assert.equal(frames.length, 0);
	withTableRowHover(root, () => withTableRowHover(root, () => replace()));
	assert.equal(frames.length, 1);
	rows[0].listeners.get('pointerleave')!();
	assert.equal(rows[0].classes.has(flag), false);
	assert.equal(frames.length, 0, 'pointer leave cancels pending cleanup');
	hovered = makeRow();
	assert.throws(() => withTableRowHover(root, () => { throw new Error('render failed'); }), /render failed/);
	withTableRowHover(root, () => replace());
	assert.equal(rows[0].classes.has(flag), true, 'exception releases the nested-render guard');
	frames.shift()!();
	for (let i = 0; i < 20; i++) {
		hovered = rows[0];
		withTableRowHover(root, () => replace());
		assert.equal(frames.length, 1, 'at most one cleanup per root');
	}
	frames.shift()!();
	// Exercise the real highlight owner, not only temporary row CSS.
	class Element {
		classes = new Set<string>();
		classList = { contains: (key: string) => this.classes.has(key), add: (key: string) => { this.classes.add(key); }, remove: (key: string) => { this.classes.delete(key); } };
		dataset: Record<string, string> = {};
		style = { transform: 'translateY(20px)', width: '500px' };
		isConnected = true;
		parentElement: Element | null = null;
		previousElementSibling: Element | null = null;
		nextElementSibling: Element | null = null;
		children: Element[] = [];
		listeners = new Map<string, (event?: unknown) => void>();
		ownerDocument = document;
		addEventListener(name: string, fn: (event?: unknown) => void): void { this.listeners.set(name, fn); }
		removeEventListener(name: string): void { this.listeners.delete(name); }
		contains(cell: Element): boolean { return cell.parentElement?.parentElement === this; }
		closest(): Element { return this; }
		querySelector(): Element | null { return this.children.find(cell => cell.classes.has('is-active-cell')) ?? null; }
	}
	const document = { activeElement: null, defaultView: { Element, HTMLElement: Element, requestAnimationFrame: (fn: () => void) => frames.push(fn), cancelAnimationFrame: (id: number) => { frames.splice(id - 1, 1); } } };
	const canvas = new Element();
	const makeGridRow = (): Element => {
		const row = new Element(); row.dataset.operonVirtualRowKey = 'task:a'; row.parentElement = canvas;
		row.children = ['left', 'description', 'right'].map(column => {
			const cell = new Element(); cell.dataset.column = column; cell.parentElement = row; cell.classes.add('operon-table-cell'); return cell;
		});
		row.children.forEach((cell, i) => { cell.previousElementSibling = row.children[i - 1] ?? null; cell.nextElementSibling = row.children[i + 1] ?? null; });
		return row;
	};
	const binding = bindTableActiveCellHighlight(canvas as unknown as HTMLElement);
	const oldRow = makeGridRow();
	canvas.listeners.get('pointerover')!({ target: oldRow.children[1] });
	const newRow = makeGridRow();
	const gridRoot = { isConnected: true, ownerDocument: document, querySelector: () => oldRow, querySelectorAll: () => [newRow] } as unknown as HTMLElement;
	withTableRowHover(gridRoot, () => { oldRow.isConnected = false; });
	assert.equal(newRow.children[1].classes.has('is-active-cell'), true);
	assert.equal(newRow.children[0].classes.has('is-before-active-cell'), true);
	assert.equal(newRow.children[2].classes.has('is-after-active-cell'), true);
	frames.shift()!();
	assert.equal(newRow.children[1].classes.has('is-active-cell'), true, 'frame cleanup does not clear owner-managed cell highlighting');
	canvas.listeners.get('pointerleave')!();
	assert.equal(newRow.children.some(cell => cell.classes.size !== 1), false, 'pointer leave clears restored cell and neighbors');
	canvas.listeners.get('pointerover')!({ target: newRow.children[1] });
	binding.clear();
	assert.equal(newRow.children.some(cell => cell.classes.size !== 1), false, 'scroll clear clears restored ownership');
	binding.destroy();
}
