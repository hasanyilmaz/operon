import type { App, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { t } from '../core/i18n';
import { OPERON_TABLE_FILE_VIEW_TYPE } from '../types/table';
import { applyLightboxSizeProfile, bindLightboxContent, setLightboxCanvasScope } from './lightbox';
import { NativeLightboxLifecycle } from './native-lightbox-lifecycle';
import { refreshNativeLightboxBody } from './native-lightbox-body';

/** Read intent before native Canvas deselection/editing consumes Escape. */
export function canvasOwnsLightboxEscape(view: unknown, event: KeyboardEvent): boolean {
 if (!view || typeof view !== 'object') return false;
 const type: unknown = Reflect.get(view,'getViewType');
 if(typeof type !== 'function' || Reflect.apply(type,view,[]) !== 'canvas')return false;
 const canvas = Reflect.get(view, 'canvas') as { selection?: Set<unknown>; nodes?: Map<unknown, {isEditing?: boolean}>; isDragging?: boolean } | undefined;
 const target = event.target as HTMLElement | null;
 return !!(canvas?.selection?.size || canvas?.isDragging || [...(canvas?.nodes?.values() ?? [])].some(node => node.isEditing)
  || target?.closest?.('input, textarea, [contenteditable="true"], .cm-editor'));
}

/** A native view host shared by standalone opening and future companion panels. */
export class NativeLightboxSurface {
	readonly container: HTMLElement;
	readonly content: HTMLElement;
	private leaf: WorkspaceLeaf | null = null;
	private lifecycle: NativeLightboxLifecycle | null = null;
	private readonly unbindContent: () => void;
 private waiting = false;
 private waitBanner: HTMLElement | null = null;
	constructor(private readonly shell: HTMLElement, initialViewType: string | null) {
		this.container = shell;
		this.container.addClass('operon-native-workspace');
		this.content = this.container.createDiv('operon-task-media-lightbox-content');
		this.unbindContent = bindLightboxContent(shell, { content: this.content, backgroundInteractive: () => this.waiting, ownsEscape: event => canvasOwnsLightboxEscape(this.leaf?.view, event) });
		this.applyProfile(initialViewType);
	}

 setWaiting(waiting:boolean, cancel?:()=>void):void {
  this.waiting=waiting;this.shell.toggleClass('is-canvas-waiting',waiting);
  this.shell.setAttribute('aria-modal',waiting?'false':'true');
  this.waitBanner?.remove();this.waitBanner=null;
  if(waiting) {
   const banner=this.waitBanner=this.shell.createDiv('operon-canvas-lightbox-wait');
   banner.createSpan({text:t('notifications','canvasLightboxWaiting'),attr:{role:'status'}});
   banner.createEl('button',{text:t('buttons','cancel'),attr:{type:'button'}}).addEventListener('click',()=>cancel?.());
  }
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
  setLightboxCanvasScope(this.shell,viewType==='canvas');
		const profile = viewType === 'markdown' ? 'markdown' : viewType === 'bases' ? 'base'
			: viewType === OPERON_TABLE_FILE_VIEW_TYPE ? 'table' : viewType === 'canvas' ? 'canvas' : viewType === 'webviewer' ? 'web' : null;
		if (!profile) return;
		this.content.toggleClass('operon-native-lightbox-host', profile !== 'web');
		this.content.toggleClass('operon-web-lightbox-host', profile === 'web');
		for (const kind of ['markdown', 'base', 'table', 'canvas', 'web']) this.content.toggleClass(`is-${kind}`, profile === kind);
		applyLightboxSizeProfile(this.shell, profile);
	}

	detach(): void {
		this.lifecycle?.dispose();
		this.lifecycle = null;
		this.leaf = null;
	}

	dispose(): void {
		this.detach();
  this.setWaiting(false);
		this.unbindContent();
		this.container.removeClass('operon-native-workspace');
	}
}
