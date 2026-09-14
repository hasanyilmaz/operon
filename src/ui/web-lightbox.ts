import { Notice, Platform, type App, type WorkspaceLeaf } from 'obsidian';
import { getOwnerDocument } from '../core/dom-compat';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';
import { t } from '../core/i18n';
import { openLightbox } from './lightbox';

const sessions = new WeakMap<App, Set<() => void>>();

export function disposeWebLightboxes(app: App): void {
	for (const close of [...(sessions.get(app) ?? [])]) close();
	sessions.delete(app);
}

export function openWebLightbox(app: App, anchor: HTMLElement, url: string): void {
	if (!Platform.isDesktopApp || !isPluginEnabled(getInternalPlugin(app, 'webviewer'))) {
		new Notice(t('notifications', 'webViewerUnavailable'));
		return;
	}
	const doc = getOwnerDocument(anchor);
	let closed = false;
	let closeSession: (() => void) | null = null;
	try {
		closeSession = openLightbox(anchor, {
			title: url,
			showTitle: false,
			className: 'is-web',
			render: (lightbox, close) => {
				const previousLeaf = app.workspace.getMostRecentLeaf();
				const host = lightbox.createDiv('operon-task-media-lightbox-content operon-web-lightbox-host');
				let leaf: WorkspaceLeaf | null = null;
				const observer = new ResizeObserver(() => { if (!closed) leaf?.view.onResize(); });
				observer.observe(host);
				const onPageHide = () => close();
				doc.defaultView?.addEventListener('pagehide', onPageHide);
				void (async () => {
					let owned: WorkspaceLeaf | null = null;
					try {
						owned = app.workspace.getLeaf('tab');
						leaf = owned;
						await owned.setViewState({ type: 'webviewer', active: false, state: { url, navigate: true } });
						if (closed) { owned.detach(); return; }
						await owned.loadIfDeferred();
						if (closed) { owned.detach(); return; }
						if (owned.view.getViewType() !== 'webviewer' || owned.view.containerEl.ownerDocument !== doc) throw new Error('Unavailable web view');
						host.appendChild(owned.view.containerEl);
						owned.view.onResize();
					} catch {
						if (closed) { owned?.detach(); return; }
						close();
						new Notice(t('notifications', 'webViewerUnavailable'));
					}
				})();
				return () => {
					closed = true;
					observer.disconnect();
					doc.defaultView?.removeEventListener('pagehide', onPageHide);
					if (closeSession) sessions.get(app)?.delete(closeSession);
					leaf?.detach();
					leaf = null;
					if (previousLeaf && app.workspace.getLeavesOfType(previousLeaf.view.getViewType()).includes(previousLeaf)) {
						app.workspace.setActiveLeaf(previousLeaf, { focus: false });
					}
				};
			},
		});
		if (!closed) {
			let active = sessions.get(app);
			if (!active) { active = new Set(); sessions.set(app, active); }
			active.add(closeSession);
		}
	} catch {
		new Notice(t('notifications', 'webViewerUnavailable'));
	}
}
