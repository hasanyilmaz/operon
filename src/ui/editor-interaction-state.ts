import { getOwnerWindow } from '../core/dom-compat';
import { bindDescendantFocusVisible } from './descendant-focus-visible';

const FOCUS_SELECTOR = [
	'operon-editor-desktop-group-header', 'operon-editor-desktop-property-row',
	'operon-editor-picker-button', 'operon-icon-trigger', 'operon-color-swatch',
	'operon-editor-repeat-trigger', 'operon-editor-repeat-skip', 'operon-editor-estimate-reallocate',
	'operon-editor-subtasks-more', 'operon-editor-compact-selection-chip', 'operon-editor-picker-chip',
	'operon-editor-reminder-chip', 'operon-editor-value-token', 'operon-editor-tracking-sessions-header',
].map(name => `.${name}`).join(',');
const PICKER_SELECTOR = '.operon-editor-desktop-group-header,.operon-editor-desktop-property-row,.operon-editor-value-token';
const PICKER_STATE = 'has-descendant-picker-open';
const DESCRIPTION_STATE = 'has-description-focus';

/** Keep transient Editor decoration in step with its dynamically rendered descendants. */
export function bindEditorInteractionState(root: HTMLElement): () => void {
	const owner = getOwnerWindow(root) as Window & { MutationObserver: typeof MutationObserver };
	const bindings = new Map<HTMLElement, () => void>();
	let pickerScopes = new Set<HTMLElement>();
	let descriptions = new Set<HTMLElement>();
	let closed = false;
	const observer = typeof owner.MutationObserver === 'function' ? new owner.MutationObserver(sync) : null;

	function sync(): void {
		if (closed) return;
		observer?.disconnect();
		const current = new Set(Array.from(root.querySelectorAll<HTMLElement>(FOCUS_SELECTOR)));
		for (const [scope, cleanup] of bindings) if (!current.has(scope)) { cleanup(); bindings.delete(scope); }
		// Existing renderer cleanup may release a retained scope before refilling it.
		for (const scope of current) bindings.set(scope, bindDescendantFocusVisible(scope));
		const nextPickers = new Set<HTMLElement>();
		for (const picker of Array.from(root.querySelectorAll<HTMLElement>('.is-picker-open'))) {
			for (let parent = picker.parentElement; parent && parent !== root; parent = parent.parentElement) {
				if (parent.matches(PICKER_SELECTOR)) nextPickers.add(parent);
			}
		}
		for (const scope of pickerScopes) if (!nextPickers.has(scope)) scope.classList.remove(PICKER_STATE);
		for (const scope of nextPickers) if (!pickerScopes.has(scope)) scope.classList.add(PICKER_STATE);
		pickerScopes = nextPickers;
		const nextDescriptions = new Set<HTMLElement>();
		for (const host of Array.from(root.querySelectorAll<HTMLElement>('.operon-task-editor-compact-text-host:focus-within'))) {
			for (let parent = host.parentElement; parent && parent !== root; parent = parent.parentElement) {
				if (parent.matches('.is-description')) nextDescriptions.add(parent);
			}
		}
		for (const scope of descriptions) if (!nextDescriptions.has(scope)) scope.classList.remove(DESCRIPTION_STATE);
		for (const scope of nextDescriptions) if (!descriptions.has(scope)) scope.classList.add(DESCRIPTION_STATE);
		descriptions = nextDescriptions;
		observer?.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'disabled', 'style']});
	}

	root.addEventListener('focusin', sync, true);
	root.addEventListener('focusout', sync, true);
	sync();
	return () => {
		if (closed) return;
		closed = true;
		observer?.disconnect();
		root.removeEventListener('focusin', sync, true);
		root.removeEventListener('focusout', sync, true);
		for (const cleanup of bindings.values()) cleanup();
		bindings.clear();
		for (const scope of pickerScopes) scope.classList.remove(PICKER_STATE);
		for (const scope of descriptions) scope.classList.remove(DESCRIPTION_STATE);
		pickerScopes.clear(); descriptions.clear();
	};
}
