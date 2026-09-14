import { Notice, Platform, type App, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { getOwnerBody, getOwnerDocument } from '../core/dom-compat';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';

/** W018 feasibility probe. Owns a new leaf; never relocates a user's existing view. */
export function registerWebLightboxPrototype(plugin: Plugin): void {
	let closeCurrent: (() => void) | null = null;
	plugin.register(() => closeCurrent?.());
	plugin.addCommand({
		id: 'test-web-lightbox',
		name: 'Test web lightbox (prototype)',
		checkCallback: checking => {
			if (!Platform.isDesktopApp) return false;
			if (!checking) {
				closeCurrent?.();
				closeCurrent = openWebLightboxPrototype(plugin.app);
			}
			return true;
		},
	});
}

function openWebLightboxPrototype(app: App): () => void {
	if (!isPluginEnabled(getInternalPlugin(app, 'webviewer'))) {
		new Notice('Enable the Obsidian web viewer core plugin to try this prototype.');
		return () => {};
	}
	const previousLeaf = app.workspace.getMostRecentLeaf();
	const anchor = previousLeaf?.view.containerEl ?? app.workspace.containerEl;
	const doc = getOwnerDocument(anchor);
	const previousFocus = doc.activeElement;
	const overlay = getOwnerBody(anchor).createDiv('operon-task-media-lightbox operon-web-lightbox-prototype');
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', 'Web lightbox prototype');
	const closeButton = overlay.createEl('button', { cls: 'operon-task-media-lightbox-close', text: '×', attr: { type: 'button', 'aria-label': 'Close web lightbox' } });
	const host = overlay.createDiv('operon-task-media-lightbox-content operon-web-lightbox-prototype-host');
	const form = host.createEl('form', { cls: 'operon-web-lightbox-prototype-form' });
	const input = form.createEl('input', { attr: { type: 'url', placeholder: 'https://example.com', 'aria-label': 'Web address', required: '' } });
	input.value = 'https://example.com';
	const button = form.createEl('button', { text: 'Open', attr: { type: 'submit' } });
	const status = host.createDiv({ text: 'Prototype: opens a new Web Viewer tab inside this lightbox.' });
	status.setAttribute('role', 'status');
	const viewport = host.createDiv('operon-web-lightbox-prototype-viewport');
	let leaf: WorkspaceLeaf | null = null;
	let closed = false;
	let opening = false;
	const observer = new ResizeObserver(() => leaf?.view.onResize());
	observer.observe(viewport);
	const close = (): void => {
		if (closed) return;
		closed = true;
		observer.disconnect();
		doc.removeEventListener('keydown', onKeydown, true);
		doc.removeEventListener('focusin', onFocus, true);
		doc.defaultView?.removeEventListener('pagehide', close);
		// Detach invokes Web Viewer's own unload/cleanup, including its guest web contents.
		leaf?.detach();
		leaf = null;
		overlay.remove();
		if (previousLeaf && app.workspace.getLeavesOfType(previousLeaf.view.getViewType()).includes(previousLeaf)) {
			app.workspace.setActiveLeaf(previousLeaf, { focus: false });
		}
		if (previousFocus?.isConnected && 'focus' in previousFocus) (previousFocus as HTMLElement).focus({ preventScroll: true });
	};
	const onKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		close();
	};
	const onFocus = (event: FocusEvent): void => {
		if (event.target && !overlay.contains(event.target as Node)) closeButton.focus();
	};
	closeButton.addEventListener('click', close);
	overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
	doc.addEventListener('keydown', onKeydown, true);
	doc.addEventListener('focusin', onFocus, true);
	doc.defaultView?.addEventListener('pagehide', close);
	form.addEventListener('submit', event => {
		event.preventDefault();
		if (opening || closed) return;
		let url: URL;
		try { url = new URL(input.value.trim()); } catch { status.setText('Enter a valid HTTP or HTTPS URL.'); return; }
		if (url.protocol !== 'https:' && url.protocol !== 'http:') { status.setText('Unsupported address protocol.'); return; }
		opening = true;
		button.disabled = true;
		status.setText('Opening web viewer…');
		void (async () => {
			const owned = leaf ?? app.workspace.getLeaf('tab');
			leaf = owned;
			try {
				await owned.setViewState({ type: 'webviewer', active: false, state: { url: url.href, navigate: true } });
				if (closed) { owned.detach(); return; }
				await owned.loadIfDeferred();
				if (closed) { owned.detach(); return; }
				if (owned.view.getViewType() !== 'webviewer' || owned.view.containerEl.ownerDocument !== doc) throw new Error('Web Viewer is unavailable in this window.');
				viewport.appendChild(owned.view.containerEl);
				owned.view.onResize();
				status.setText('Web viewer attached. Check browsing, then close with ×.');
			} catch (error) {
				owned.detach();
				if (leaf === owned) leaf = null;
				if (!closed) status.setText(`Prototype could not attach Web Viewer: ${error instanceof Error ? error.message : 'unknown error'}`);
			} finally {
				opening = false;
				if (!closed) button.disabled = false;
			}
		})();
	});
	input.focus();
	return close;
}
