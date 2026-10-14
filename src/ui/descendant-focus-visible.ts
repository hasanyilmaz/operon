import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';

const SCOPE_CLASS = 'operon-focus-visible-scope';
const STATE_CLASS = 'has-descendant-focus-visible';
const EVENTS = ['focusin', 'focusout', 'keydown', 'keyup', 'pointerdown', 'pointerup'] as const;
const cleanups = new WeakMap<HTMLElement, () => void>();
const managers = new WeakMap<Document, { bind: (root: HTMLElement) => () => void }>();

function createManager(root: HTMLElement): { bind: (root: HTMLElement) => () => void } {
	const document = getOwnerDocument(root);
	const owner = getOwnerWindow(root) as Window & { MutationObserver: typeof MutationObserver };
	const scopes = new WeakSet<HTMLElement>();
	let activeScopes = new Set<HTMLElement>();
	let count = 0;
	let disposed = false;
	let frame: number | null = null;
	const observer = typeof owner.MutationObserver === 'function' ? new owner.MutationObserver(refresh) : null;

	function sync(): void {
		if (disposed) return;
		observer?.disconnect();
		const next = new Set<HTMLElement>();
		const active = document.activeElement;
		const path: Element[] = [];
		let containsFocus = false;
		const visible = active?.matches(':focus-visible') ?? false;
		if (active) {
			path.push(active);
			// Start at the parent: :has(:focus-visible) never matches the scope itself.
			for (let parent = active.parentElement; parent; parent = parent.parentElement) {
				path.push(parent);
				if (scopes.has(parent)) { containsFocus = true; if (visible) next.add(parent); }
			}
		}
		for (const scope of activeScopes) if (!next.has(scope)) scope.classList.remove(STATE_CLASS);
		for (const scope of next) if (!activeScopes.has(scope)) scope.classList.add(STATE_CLASS);
		activeScopes = next;
		// Only watch the focused ancestry, including removal of a scope or its parent.
		// Disconnect before changing state classes to avoid observing our own writes.
		if (containsFocus) for (const element of path) observer?.observe(element, {
			childList: true, attributes: true,
			attributeFilter: ['class', 'style', 'hidden', 'disabled', 'type', 'contenteditable', 'tabindex'],
		});
	}

	function refresh(): void {
		if (disposed) return;
		sync();
		// Recheck after the browser's default focus/modality action has completed.
		if (frame === null) frame = owner.requestAnimationFrame(() => { frame = null; sync(); });
	}

	for (const event of EVENTS) document.addEventListener(event, refresh, true);
	return { bind(scope) {
		count += 1;
		scopes.add(scope);
		scope.classList.add(SCOPE_CLASS);
		sync();
		let closed = false;
		return () => {
			if (closed) return;
			closed = true;
			scopes.delete(scope);
			scope.classList.remove(SCOPE_CLASS, STATE_CLASS);
			count -= 1;
			if (count) { sync(); return; }
			disposed = true;
			observer?.disconnect();
			if (frame !== null) owner.cancelAnimationFrame(frame);
			for (const event of EVENTS) document.removeEventListener(event, refresh, true);
			activeScopes.clear();
			managers.delete(document);
		};
	} };
}

/** Mirror native descendant :focus-visible without broadening pointer focus. */
export function bindDescendantFocusVisible(root: HTMLElement): () => void {
	const existing = cleanups.get(root);
	if (existing) return existing;
	let document = getOwnerDocument(root);
	const attach = (): (() => void) => {
		let manager = managers.get(document);
		if (!manager) { manager = createManager(root); managers.set(document, manager); }
		return manager.bind(root);
	};
	let detach = attach();
	// Retained view DOM can be adopted into a popout document before refocusing.
	const checkOwner = (): void => {
		const nextDocument = getOwnerDocument(root);
		if (nextDocument === document) return;
		detach(); document = nextDocument; detach = attach();
	};
	root.addEventListener('focusin', checkOwner, true);
	let closed = false;
	const cleanup = (): void => {
		if (closed) return;
		closed = true; cleanups.delete(root);
		root.removeEventListener('focusin', checkOwner, true);
		detach();
	};
	cleanups.set(root, cleanup);
	return cleanup;
}

export function cleanupDescendantFocusVisible(root: HTMLElement): void {
	for (const scope of [root, ...Array.from(root.querySelectorAll<HTMLElement>(`.${SCOPE_CLASS}`))]) {
		cleanups.get(scope)?.();
	}
}
