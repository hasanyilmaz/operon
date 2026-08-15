import { getOwnerWindow } from '../core/dom-compat';

interface ExpandedDescendantObserverLike {
	disconnect(): void;
	observe(target: Node, options?: MutationObserverInit): void;
}

type ExpandedDescendantObserverConstructor = new (
	callback: MutationCallback,
) => ExpandedDescendantObserverLike;

export const EXPANDED_DESCENDANT_CLASS = 'has-expanded-control';

export function syncExpandedDescendantState(root: HTMLElement): void {
	root.classList.toggle(
		EXPANDED_DESCENDANT_CLASS,
		root.querySelector('[aria-expanded="true"]') !== null,
	);
}

export function bindExpandedDescendantState(
	root: HTMLElement,
	ObserverCtor?: ExpandedDescendantObserverConstructor,
): () => void {
	syncExpandedDescendantState(root);
	const ownerWindow = getOwnerWindow(root) as Window & {
		MutationObserver?: ExpandedDescendantObserverConstructor;
	};
	const Observer = ObserverCtor ?? ownerWindow.MutationObserver;
	const observer = Observer ? new Observer(() => syncExpandedDescendantState(root)) : null;
	observer?.observe(root, {
		attributes: true,
		attributeFilter: ['aria-expanded'],
		childList: true,
		subtree: true,
	});

	return () => {
		observer?.disconnect();
		root.classList.remove(EXPANDED_DESCENDANT_CLASS);
	};
}
