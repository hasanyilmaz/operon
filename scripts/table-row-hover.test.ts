import assert from 'node:assert/strict';
import { withTableRowHover } from '../src/ui/table/table-row-hover';

export function testTableRowHover(): void {
	const makeRow = (key = 'task:a', transform = 'translateY(20px)') => {
		const classes = new Set<string>();
		const listeners = new Map<string, () => void>();
		return { dataset: { operonVirtualRowKey: key }, style: { transform, width: '500px' }, isConnected: true,
			classes, listeners,
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
}
