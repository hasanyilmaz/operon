/** Preserve native pan/momentum. Suppress only the click belonging to a cancelled touch gesture. */
export function bindMiniCalendarInput(root: HTMLElement, onNavigate: () => void): { scrolled(): void; dispose(): void } {
	const win = root.ownerDocument.defaultView!;
	const pointers = new Map<number, { x: number; y: number; blocked: boolean }>();
	let lastScroll = -Infinity;
	let suppressUntil = 0;
	const now = (): number => win.performance.now();
	const scrolled = (): void => {
		lastScroll = now();
		for (const point of pointers.values()) point.blocked = true;
		onNavigate();
	};
	const down = (event: PointerEvent): void => {
		suppressUntil = 0;
		if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, blocked: now() - lastScroll < 160 });
		if (pointers.size > 1) for (const point of pointers.values()) point.blocked = true;
	};
	const move = (event: PointerEvent): void => {
		const point = pointers.get(event.pointerId);
		if (point && !point.blocked && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 8) {
			point.blocked = true;
			onNavigate();
		}
	};
	const up = (event: PointerEvent): void => {
		const point = pointers.get(event.pointerId);
		if (!point) return;
		if (point.blocked || event.type === 'pointercancel') suppressUntil = now() + 500;
		pointers.delete(event.pointerId);
	};
	const click = (event: MouseEvent): void => {
		if (event.detail > 0 && now() < suppressUntil) {
			event.preventDefault();
			event.stopImmediatePropagation();
			suppressUntil = 0;
		}
	};
	const key = (event: KeyboardEvent): void => {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	const wheel = (event: WheelEvent): void => { if (event.deltaY || event.deltaX) onNavigate(); };
	const reset = (): void => { pointers.clear(); suppressUntil = 0; };
	root.addEventListener('pointerdown', down, { passive: true });
	root.addEventListener('click', click, true);
	root.addEventListener('keydown', key);
	root.addEventListener('wheel', wheel, { passive: true });
	win.addEventListener('pointermove', move, { passive: true });
	win.addEventListener('pointerup', up);
	win.addEventListener('pointercancel', up);
	win.addEventListener('blur', reset);
	return { scrolled, dispose() {
		reset();
		root.removeEventListener('pointerdown', down);
		root.removeEventListener('click', click, true);
		root.removeEventListener('keydown', key);
		root.removeEventListener('wheel', wheel);
		win.removeEventListener('pointermove', move);
		win.removeEventListener('pointerup', up);
		win.removeEventListener('pointercancel', up);
		win.removeEventListener('blur', reset);
	} };
}
