import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';

const EVENTS = ['focusin', 'focusout', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'scroll'] as const;

/** Mirror native interaction predicates only within the owned, dynamically rendered surface. */
function bindSurfaceInteractionState(
	root: HTMLElement, selector: string, state: string, active: (scope: HTMLElement) => boolean,
): () => void {
	let document = getOwnerDocument(root);
	let owner = getOwnerWindow(root);
	let scopes = new Set<HTMLElement>();
	let closed = false;
	let frame: number | null = null;
	const constructors = owner as Window & { MutationObserver: typeof MutationObserver };
	const observer = typeof constructors.MutationObserver === 'function' ? new constructors.MutationObserver(refresh) : null;

	function listen(add: boolean): void {
		for (const event of EVENTS) {
			if (add) document.addEventListener(event, refresh, true);
			else document.removeEventListener(event, refresh, true);
		}
		if (add) owner.addEventListener('resize', refresh);
		else owner.removeEventListener('resize', refresh);
	}
	function sync(): void {
		observer?.disconnect();
		const next = new Set(Array.from(root.querySelectorAll<HTMLElement>(selector)));
		for (const scope of scopes) if (!next.has(scope)) scope.classList.remove(state);
		for (const scope of next) scope.classList.toggle(state, active(scope));
		scopes = next;
		observer?.observe(root, {subtree: true, childList: true, attributes: true,
			attributeFilter: ['class', 'style', 'hidden', 'disabled', 'type', 'tabindex', 'contenteditable']});
	}
	function refresh(): void {
		if (closed) return;
		const nextDocument = getOwnerDocument(root);
		if (document !== nextDocument) {
			listen(false);
			if (frame !== null) owner.cancelAnimationFrame(frame);
			frame = null;
			document = nextDocument; owner = getOwnerWindow(root); listen(true);
		}
		sync();
		// Default keyboard actions and hit testing may settle after the captured event.
		if (frame === null) frame = owner.requestAnimationFrame(() => { frame = null; if (!closed) sync(); });
	}
	listen(true);
	// Reattach document listeners when retained DOM moves into a popout window.
	root.addEventListener('focusin', refresh, true);
	root.addEventListener('pointerover', refresh, true);
	refresh();
	return () => {
		if (closed) return;
		closed = true; listen(false); observer?.disconnect();
		if (frame !== null) owner.cancelAnimationFrame(frame);
		root.removeEventListener('focusin', refresh, true);
		root.removeEventListener('pointerover', refresh, true);
		for (const scope of scopes) scope.classList.remove(state);
		scopes.clear();
	};
}

export function bindFilterGroupInteractionState(root: HTMLElement): () => void {
	return bindSurfaceInteractionState(root, '.operon-filter-group-card', 'is-active-filter-group', card => {
		const nested = Array.from(card.querySelectorAll<HTMLElement>('.operon-filter-group-card'));
		const hovered = card.matches('.operon-filter-group-card:hover') && !nested.some(group => group.matches('.operon-filter-group-card:hover'));
		// A nested card's own focus still belongs to its parent's descendant path.
		const focused = card.querySelector(':focus-visible') !== null
			&& !nested.some(group => group.querySelector(':focus-visible') !== null);
		return hovered || focused;
	});
}

export function bindCreatorToolbarInteractionState(root: HTMLElement): () => void {
	return bindSurfaceInteractionState(root, '.operon-task-creator', 'has-active-creator-toolbar', shell =>
		shell.querySelector('.operon-task-creator-toolbar:hover, .operon-task-creator-tool:focus-within') !== null);
}
