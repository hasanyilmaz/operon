/** Bridge only the frame between row replacement and native :hover recalculation. */
const refreshingRoots = new WeakSet<HTMLElement>();
const pendingCleanup = new WeakMap<HTMLElement, () => void>();
const refreshHoverClass = 'is-operon-table-refresh-hover';

export function withTableRowHover(root: HTMLElement, render: () => void): void {
	if (refreshingRoots.has(root)) { render(); return; }
	const nativeHovered = root.querySelector<HTMLElement>('.operon-table-row:hover');
	const hovered = nativeHovered ?? root.querySelector<HTMLElement>(`.operon-table-row.${refreshHoverClass}`);
	const key = hovered?.dataset.operonVirtualRowKey;
	const transform = hovered?.style.transform;
	const width = hovered?.style.width;
	refreshingRoots.add(root);
	try { render(); }
	finally { refreshingRoots.delete(root); }
	if (hovered?.isConnected) {
		if (nativeHovered) pendingCleanup.get(root)?.();
		return;
	}
	pendingCleanup.get(root)?.();
	if (!hovered || !key || !root.isConnected) return;
	const row = Array.from(root.querySelectorAll<HTMLElement>('.operon-table-row')).find(candidate => (
		candidate.dataset.operonVirtualRowKey === key
		&& candidate.style.transform === transform
		&& candidate.style.width === width
	));
	const ownerWindow = root.ownerDocument.defaultView;
	if (!row || !ownerWindow) return;
	row.classList.add(refreshHoverClass);
	let frame = 0;
	const clear = (): void => {
		ownerWindow.cancelAnimationFrame(frame);
		pendingCleanup.delete(root);
		row.classList.remove(refreshHoverClass);
		row.removeEventListener('pointerleave', clear);
	};
	row.addEventListener('pointerleave', clear, { once: true });
	pendingCleanup.set(root, clear);
	frame = ownerWindow.requestAnimationFrame(clear);
}
