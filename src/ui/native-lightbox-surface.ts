import type { App, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { OPERON_TABLE_FILE_VIEW_TYPE } from '../types/table';
import { applyLightboxSizeProfile, bindLightboxContent } from './lightbox';
import { NativeLightboxLifecycle } from './native-lightbox-lifecycle';
import { refreshNativeLightboxBody } from './native-lightbox-body';

/** A native view host shared by standalone opening and future companion panels. */
export class NativeLightboxSurface {
	readonly container: HTMLElement;
	readonly content: HTMLElement;
	private leaf: WorkspaceLeaf | null = null;
	private lifecycle: NativeLightboxLifecycle | null = null;
	private readonly unbindContent: () => void;
	constructor(private readonly shell: HTMLElement, initialViewType: string | null) {
		this.container = shell;
		this.container.addClass('operon-native-workspace');
		this.content = this.container.createDiv('operon-task-media-lightbox-content');
		this.unbindContent = bindLightboxContent(shell, { content: this.content });
		this.applyProfile(initialViewType);
	}

	attach(app: App, leaf: WorkspaceLeaf): void {
		this.leaf = leaf;
		this.lifecycle = new NativeLightboxLifecycle(app, leaf);
	}

	refresh(): void {
		if (!this.leaf) return;
		this.lifecycle?.attachCurrentView();
		const view = this.leaf.view;
		this.applyProfile(view.getViewType());
		if (view.getViewType() === 'markdown') refreshNativeLightboxBody(view as MarkdownView);
		view.onResize();
	}

	prepare(): Promise<boolean> { return this.lifecycle?.prepare() ?? Promise.resolve(true); }

	private applyProfile(viewType: string | null): void {
		const profile = viewType === 'markdown' ? 'markdown' : viewType === 'bases' ? 'base'
			: viewType === OPERON_TABLE_FILE_VIEW_TYPE ? 'table' : viewType === 'webviewer' ? 'web' : null;
		if (!profile) return;
		this.content.toggleClass('operon-native-lightbox-host', profile !== 'web');
		this.content.toggleClass('operon-web-lightbox-host', profile === 'web');
		for (const kind of ['markdown', 'base', 'table', 'web']) this.content.toggleClass(`is-${kind}`, profile === kind);
		applyLightboxSizeProfile(this.shell, profile);
	}

	detach(): void {
		this.lifecycle?.dispose();
		this.lifecycle = null;
		this.leaf = null;
	}

	dispose(): void {
		this.detach();
		this.unbindContent();
		this.container.removeClass('operon-native-workspace');
	}
}
