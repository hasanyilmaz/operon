import { isHTMLElement } from '../core/dom-compat';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

/** Adopt native hints on controls supplied by the host and pickers inside this surface. */
export function bindOperonSurfaceTooltips(root: HTMLElement): () => void {
	const selector = '[title], [aria-label]';
	const hints = new WeakMap<HTMLElement, string>();
	const adopt = (target: HTMLElement): void => {
		const title = target.getAttribute('title');
		const label = target.getAttribute('aria-label');
		const hint = title || label;
		if (!hint) return;
		const interactive = target.matches('button, input, select, textarea, a, [role="button"], [role="option"], .modal-close-button');
		if (label || (interactive && !target.textContent?.trim() && !target.hasAttribute('aria-labelledby'))) {
			setAccessibleLabelWithoutTooltip(target, label || hint);
		} else {
			target.removeAttribute('title');
		}
		if ((title || interactive) && hints.get(target) !== hint) {
			hints.set(target, hint);
			bindOperonHoverTooltip(target, { content: hint, taskColor: null });
		}
	};
	const visit = (node: Node): void => {
		if (!isHTMLElement(node, root)) return;
		if (node.matches(selector)) adopt(node);
		for (const target of Array.from(node.querySelectorAll(selector))) {
			if (isHTMLElement(target, root)) adopt(target);
		}
	};
	visit(root);
	const observer = new MutationObserver(records => {
		for (const record of records) {
			if (record.type === 'attributes') {
				if (isHTMLElement(record.target, root) && root.contains(record.target)) adopt(record.target);
				continue;
			}
			for (const node of Array.from(record.removedNodes)) {
				if (isHTMLElement(node, root) && !root.contains(node)) cleanupOperonHoverTooltips(node);
			}
			for (const node of Array.from(record.addedNodes)) if (root.contains(node)) visit(node);
		}
	});
	observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
	return () => {
		// Include any controls removed in the same turn as closing the surface.
		for (const record of observer.takeRecords()) {
			for (const node of Array.from(record.removedNodes)) if (isHTMLElement(node, root)) cleanupOperonHoverTooltips(node);
		}
		observer.disconnect();
		cleanupOperonHoverTooltips(root);
	};
}
