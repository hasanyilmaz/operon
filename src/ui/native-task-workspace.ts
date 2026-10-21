import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import type { LightboxOpeningTrace } from './lightbox-opening-perf';
import { Notice, setIcon, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import { getLightboxProfileSize, saveLightboxProfileSize } from '../core/lightbox-size';
import { bindLightboxContent, getLightboxSizeStep, refreshLightboxControls, type LightboxContentTarget } from './lightbox';
import { resolveNativeLightboxLayout, type LightboxRect } from './native-lightbox-layout';
import { requestFloatingPanelCloseForRoot } from './field-pickers/common';
import type { TaskEditorContent } from './task-editor-content';
import type { TaskEditorSession } from './task-editor-modal';

export interface NativeTaskDescriptor { operonId: string; file: TFile; line?: number; caretCh?: number }
export interface NativeTaskWorkspaceProvider {
 position?(): 'left' | 'right';
 resolve(file: TFile, explicitId?: string, openingTrace?: LightboxOpeningTrace): Promise<NativeTaskDescriptor | null>;
 locate(operonId: string): Promise<NativeTaskDescriptor | null>;
 create(task: NativeTaskDescriptor): Promise<TaskEditorContent | null>;
 confirmDiscard(): Promise<boolean>;
 closed(filePath: string): void | Promise<void>;
}
const providers = new WeakMap<App, NativeTaskWorkspaceProvider>();
export function registerNativeTaskWorkspace(app: App, provider: NativeTaskWorkspaceProvider): () => void {
 providers.set(app, provider);
 return () => { if (providers.get(app) === provider) providers.delete(app); };
}
export function getNativeTaskWorkspaceProvider(app: App): NativeTaskWorkspaceProvider | undefined { return providers.get(app); }
export interface NativeTaskWorkspaceInitial { task: NativeTaskDescriptor; content: TaskEditorContent; markdown: boolean; position?: 'left' | 'right'; openingTrace?: LightboxOpeningTrace }

/** One shell owns both panels, including hidden drafts and the native view. */
export class NativeTaskWorkspace {
 private editor: TaskEditorContent | null = null;
 private descriptor: NativeTaskDescriptor | null = null;
 private currentFile: TFile | null = null;
 private explicit: NativeTaskDescriptor | null = null;
 private disposed = false;
 private generation = 0;
 private busy = false;
 private locked = false;
 private forceDeleted = false;
 private followingSource = false;
 private focusInvalidDescription = false;
 private readonly sourceLocation = (event: Event) => {
  const detail = (event as CustomEvent<{ operonId: string; filePath: string }>).detail;
  if (detail?.operonId === this.descriptor?.operonId && detail.filePath !== this.currentFile?.path && this.markdownWanted) void this.followSource();
 };
 private readonly side: 'left' | 'right';
 private enabled: boolean;
 private editorHidden = false;
 private markdownWanted: boolean;
 private compact = false;
 private markdownVisible = true;
 private editorVisible = false;
 private width = getLightboxProfileSize('markdown')?.width;
 private height = getLightboxProfileSize('markdown')?.height;
 private readonly panel: HTMLElement;
 private readonly body: HTMLElement;
 private readonly showMarkdown: HTMLButtonElement;
 private readonly showEditor: HTMLButtonElement;
 private readonly observer: ResizeObserver;
 private readonly unbind: () => void;
 private readonly binding: LightboxContentTarget;
 private readonly sizeBinding: NonNullable<LightboxContentTarget['size']>;
 private isMarkdown = true;
 private lastViewType = 'markdown';
 private lastEditorFocus: HTMLElement | null = null;
 private lastSourceFocus: HTMLElement | null = null;
 private readonly rememberEditorFocus = (event: FocusEvent) => { this.lastEditorFocus = event.target as HTMLElement; };
 private readonly rememberSourceFocus = (event: FocusEvent) => { this.lastSourceFocus = event.target as HTMLElement; };
 private rail: LightboxRect | null = null;
 private readonly toggleLabels = new Map<HTMLButtonElement, string>();
 private readonly resize = () => this.layout();
 private readonly escape = (event: KeyboardEvent): void => {
  if (this.shell.hidden || this.shell.inert || event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
  if (requestFloatingPanelCloseForRoot(this.panel, 'escape')) { event.preventDefault(); event.stopPropagation(); }
 };
 private readonly closeIntent = (event: Event): void => {
  event.stopPropagation();
  if ((event as CustomEvent<{ mode?: string }>).detail?.mode === 'force-after-delete') this.forceDeleted = true;
  this.close();
 };
 private readonly escapeIntent = (event: Event): void => {
  event.stopPropagation();
  if (!requestFloatingPanelCloseForRoot(this.panel, 'escape')) this.close();
 };
 constructor(private readonly shell: HTMLElement, private readonly markdown: HTMLElement,
  private readonly provider: NativeTaskWorkspaceProvider, private readonly close: () => void,
  initial?: NativeTaskWorkspaceInitial, explicit?: NativeTaskDescriptor,
  private readonly navigate?: (task: NativeTaskDescriptor) => Promise<void>,
  private readonly focusSource?: () => void, private readonly openingTrace?: LightboxOpeningTrace) {
  this.side = initial?.position ?? provider.position?.() ?? 'right';
  this.enabled = !!initial;
  this.markdownWanted = initial?.markdown ?? true;
  this.explicit = initial?.task ?? explicit ?? null;
  shell.addClass('operon-task-workspace');
  this.panel = shell.createDiv('modal operon-task-editor-modal operon-native-task-panel');
  this.body = this.panel.createDiv('modal-content');
  this.showMarkdown = this.button('file-text', () => { void this.toggleMarkdown(); });
  this.showEditor = this.button('sliders-horizontal', () => { void this.toggleEditor(); });
  shell.querySelector(':scope > .operon-task-media-lightbox-close')?.after(this.showMarkdown, this.showEditor);
  const win = shell.ownerDocument.defaultView!;
  this.observer = new win.ResizeObserver(this.resize);
  this.observer.observe(this.body);
  this.observer.observe(markdown);
  win.addEventListener('resize', this.resize);
  shell.addEventListener('keydown', this.escape);
  this.panel.addEventListener('focusin', this.rememberEditorFocus);
  this.markdown.addEventListener('focusin', this.rememberSourceFocus);
  this.panel.addEventListener('operon-editor-close', this.closeIntent);
  this.panel.addEventListener('operon-editor-source-location', this.sourceLocation);
  this.panel.addEventListener('operon-editor-escape-intent', this.escapeIntent);
  this.sizeBinding = { measure: () => (this.markdownVisible ? markdown : this.panel).getBoundingClientRect(),
    enabled: () => this.markdownVisible,
    step: (axis, direction) => this.sizeStep(axis, direction), apply: (axis, value) => this.changeSize(axis, value) };
  this.binding = { content: markdown, controls: () => this.isMarkdown ? this.rail ?? this.fallbackRail() : undefined,
   size: this.sizeBinding, afterPosition: () => this.positionRail() };
  this.unbind = bindLightboxContent(shell, this.binding);
  if (initial) this.mount(initial.task, initial.content);
  this.layout();
 }
 async prepareInitialRender(): Promise<void> {
  await this.editor?.whenInitialRenderReady();
  if (!this.disposed) this.layout();
 }
 get handle(): TaskEditorSession | null {
  const content = this.editor;
  return content ? { content, modalEl: this.panel, close: this.close } : null;
 }
 private button(icon: string, action: () => void): HTMLButtonElement {
  const button = this.shell.createEl('button', { cls: 'operon-task-media-lightbox-control operon-workspace-toggle', attr: { type: 'button' } });
  setIcon(button, icon); button.addEventListener('click', action); return button;
 }
 private mount(task: NativeTaskDescriptor, content: TaskEditorContent): void {
  this.editor?.destroy({ skipCloseSave: true });
  this.body.empty(); this.editor = content; this.descriptor = task;
  // Compact/native editors must measure against their final width from the start.
  this.layout();
  content.mountInto(this.body);
 }
 resetGeometryForView(type: string): void {
  if (type !== this.lastViewType) {
   if (type !== 'markdown') for (const key of ['left', 'top', 'width', 'height']) this.markdown.style.removeProperty(key);
   this.lastViewType = type;
  }
 }
 async refresh(leaf: WorkspaceLeaf): Promise<void> {
  const generation = ++this.generation;
  const view = leaf.view;
  this.isMarkdown = view.getViewType() === 'markdown';
  this.binding.size = this.isMarkdown ? this.sizeBinding : undefined;
  if (!this.isMarkdown) for (const button of Array.from(this.shell.querySelectorAll<HTMLElement>(':scope > .operon-task-media-lightbox-control'))) {
   for (const key of ['left', 'top', 'width', 'height']) button.style.removeProperty(key);
  }
  const file = this.isMarkdown ? (view as { file?: TFile }).file ?? null : null;
  this.currentFile = file;
  const task = file ? await this.provider.resolve(file, this.explicit?.file === file ? this.explicit.operonId : undefined, this.openingTrace) : null;
  if (this.disposed || generation !== this.generation) return;
  if (this.currentFile !== this.explicit?.file) this.explicit = null;
  if (task?.operonId !== this.descriptor?.operonId) {
   this.editor?.destroy({ skipCloseSave: true }); this.editor = null; this.body.empty();
  }
  this.descriptor = task;
  if (task && this.enabled && !this.editorHidden && !this.editor) {
   const content = await this.provider.create(task).catch(() => { new Notice('Could not open the task editor. The source is still open.'); return null; });
   if (this.disposed || generation !== this.generation) { content?.destroy({ skipCloseSave: true }); return; }
   if (content) this.mount(task, content);
  }
  this.layout();
 }
 private async followSource(): Promise<boolean> {
  const id = this.descriptor?.operonId;
  if (!id || !this.editor || this.locked || this.followingSource || !this.navigate) return false;
  this.followingSource = true;
  const generation = this.generation;
  try {
   const next = await this.provider.locate(id);
   if (!next || this.disposed || generation !== this.generation) return false;
   if (next.file === this.currentFile) return true;
   const previous = this.explicit;
   this.explicit = next;
   await this.navigate(next);
   if (this.currentFile === next.file) return true;
   this.explicit = previous;
   return false;
  } catch { return false; }
  finally { this.followingSource = false; }
 }
 private async toggleMarkdown(): Promise<void> {
  if (this.locked || this.busy || this.disposed) return;
  if (!this.markdownVisible && !await this.followSource()) return;
  if (this.disposed) return;
  this.markdownWanted = !this.markdownVisible;
  this.layout();
  if (this.markdownVisible && !this.shell.hidden && !this.shell.inert) {
   if (this.lastSourceFocus?.isConnected) this.lastSourceFocus.focus({ preventScroll: true });
   else this.focusSource?.();
  }
 }
 private async toggleEditor(): Promise<void> {
  if (this.busy || this.locked || this.disposed || !this.descriptor) return;
  if (this.editorVisible) { this.editorHidden = true; this.layout(); return; }
  this.busy = true;
  const generation = this.generation;
  try {
   if (!this.editor) {
    const content = await this.provider.create(this.descriptor);
    if (this.disposed || generation !== this.generation) { content?.destroy({ skipCloseSave: true }); return; }
    if (!content) return;
    this.enabled = true; this.editorHidden = false;
    this.mount(this.descriptor, content);
   }
   this.enabled = true; this.editorHidden = false; this.layout();
   if (!this.shell.hidden && !this.shell.inert) {
    if (this.lastEditorFocus?.isConnected) this.lastEditorFocus.focus({ preventScroll: true });
    else this.editor?.applyInitialDescriptionFocus();
   }
  } catch { new Notice('Could not open the task editor. The source is still open.'); }
  finally { this.busy = false; }
 }
 setLocked(locked: boolean): void {
  if (locked && !this.locked) this.generation++;
  this.locked = locked; this.panel.inert = locked || !this.editorVisible;
 }
 async prepare(allowDiscard = false): Promise<boolean> {
  if (this.forceDeleted || !this.editor) return true;
  const editor = this.editor;
  const outcome = await editor.prepareCloseSave();
  if (this.disposed || editor !== this.editor) return false;
  this.focusInvalidDescription = !outcome.ok && outcome.reason === 'description-required';
  if (outcome.ok && outcome.clean && !editor.isEdited) return true;
  if (!allowDiscard || !outcome.ok && outcome.reason === 'edit-raced') return false;
  const focus = this.shell.ownerDocument.activeElement;
  const discard = await this.provider.confirmDiscard();
  const win = this.shell.ownerDocument.defaultView;
  if (!discard && win && focus?.instanceOf(win.HTMLElement) && focus.isConnected) focus.focus();
  return discard && !this.disposed;
 }
 focusRetainedDraft(): void {
  if (this.disposed || this.shell.hidden) return;
  if (this.editorVisible && this.focusInvalidDescription) this.editor?.focusDescription();
  else if (this.editorVisible && this.lastEditorFocus?.isConnected) this.lastEditorFocus.focus({ preventScroll: true });
  else if (!this.showEditor.hidden) this.showEditor.focus({ preventScroll: true });
 }
 get deleted(): boolean { return this.forceDeleted; }
 private fallbackRail(): LightboxRect {
  const rect = (this.markdownVisible ? this.markdown : this.panel).getBoundingClientRect();
  const width = this.shell.ownerDocument.defaultView!.innerWidth;
  const onRight = this.markdownVisible === (this.side === 'right');
  return { left: onRight ? Math.min(width - 44, rect.right + 8) : Math.max(8, rect.left - 44), top: rect.top, height: rect.height, width: 36 };
 }
 private sizeStep(axis: 'width' | 'height', direction: -1 | 1): number | null {
  if (!this.markdownVisible) return null;
  const win = this.shell.ownerDocument.defaultView!;
  const rect = this.markdown.getBoundingClientRect();
  const current = (axis === 'width' ? this.width : this.height) ?? rect[axis] / (axis === 'width' ? win.innerWidth : win.innerHeight) * 100;
  return getLightboxSizeStep(current, direction);
 }
 private changeSize(axis: 'width' | 'height', value: number): void {
  if (axis === 'width') this.width = value; else this.height = value;
  this.layout();
  void saveLightboxProfileSize('markdown', axis, value).catch(() => new Notice('Could not save the lightbox size.'));
 }
 layout(): void {
  const endLayout = this.openingTrace?.span('layout');
  try {
  if (this.disposed) return;
  const win = this.shell.ownerDocument.defaultView!;
  if (!this.isMarkdown) {
   this.panel.hidden = true; this.panel.inert = true;
   this.showEditor.hidden = true; this.showMarkdown.hidden = true;
   this.markdown.hidden = false; this.markdown.inert = false;
   this.showFileActions(true);
   refreshLightboxControls(this.shell); return;
  }
  const hasEditor = !!this.editor && this.enabled && !this.editorHidden;
  const margin = Math.min(24, win.innerWidth / 8), railWidth = 52;
  // Measure the same closed-panel CSS width before applying the workspace rectangle.
  this.panel.style.removeProperty('width');
  const preferredWidth = Number.parseFloat(win.getComputedStyle(this.panel).width) || 608;
  this.compact = hasEditor && win.innerWidth < preferredWidth + railWidth + 2 * margin + 1;
  this.editorVisible = hasEditor;
  this.markdownVisible = !hasEditor || this.markdownWanted && !this.compact;
  this.showFileActions(this.markdownVisible);
  this.panel.hidden = !hasEditor; this.panel.inert = this.locked || !hasEditor;
  this.markdown.hidden = !this.markdownVisible; this.markdown.inert = !this.markdownVisible;
  const mdSize = { width: this.width === undefined ? Math.min(1050, win.innerWidth * .9) : win.innerWidth * this.width / 100,
   height: Math.min(win.innerHeight - 96, win.innerHeight * (this.height ?? 90) / 100) };
  const main = this.body.querySelector<HTMLElement>('.operon-task-editor-main-panel');
  const content = main ?? this.body;
  const pixels = (value: string): number => Number.parseFloat(value) || 0;
  let naturalHeight = content.scrollHeight;
  if (main && main.children.length) {
   // scrollHeight cannot be smaller than the allocated scrollport. Measure the
   // flow children instead so a previously taller editor can shrink completely.
   const rect = main.getBoundingClientRect(), style = win.getComputedStyle(main);
   let bottom = pixels(style.borderTopWidth) + pixels(style.paddingTop);
   for (const child of Array.from(main.children)) {
    const childStyle = win.getComputedStyle(child);
    if (childStyle.display === 'none' || childStyle.position === 'absolute' || childStyle.position === 'fixed') continue;
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom - rect.top + main.scrollTop + pixels(childStyle.marginBottom));
   }
   naturalHeight = Math.ceil(bottom - pixels(style.borderTopWidth) + pixels(style.paddingBottom));
  }
  // Count the frame once without adding previously allocated empty space.
  for (let element: HTMLElement | null = content; element; element = element.parentElement) {
   const style = win.getComputedStyle(element);
   naturalHeight += pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
   if (element !== content) naturalHeight += pixels(style.paddingTop) + pixels(style.paddingBottom);
   if (element === this.panel) break;
   naturalHeight += pixels(style.marginTop) + pixels(style.marginBottom);
  }
  const result = resolveNativeLightboxLayout({ viewport: { width: win.innerWidth, height: win.innerHeight },
   markdown: this.markdownVisible ? mdSize : null,
   companion: hasEditor ? { width: Math.min(preferredWidth, Math.max(0, win.innerWidth - 2 * margin - railWidth)), height: Math.min(naturalHeight || win.innerHeight * .8, win.innerHeight * (this.markdownVisible ? 1 : .8)) } : null,
   side: this.side, margin, railWidth, alignmentHeight: mdSize.height, markdownOuterRailWidth: hasEditor ? 0 : railWidth });
  const place = (element: HTMLElement, rect: LightboxRect | null): void => {
   if (!rect) return;
   for (const key of ['left', 'top', 'width', 'height'] as const) element.style.setProperty(key, `${rect[key]}px`);
  };
  place(this.markdown, result.markdown);
  place(this.panel, result.companion);
  this.rail = result.rail;
  this.showMarkdown.hidden = !hasEditor;
  this.showMarkdown.disabled = this.compact;
  this.labelToggle(this.showMarkdown, this.compact ? 'Widen the window to show the source' : this.markdownVisible ? 'Hide source' : 'Show source');
  this.showEditor.hidden = !this.descriptor || !this.markdownVisible;
  this.labelToggle(this.showEditor, hasEditor ? 'Hide task editor' : 'Show task editor');
  refreshLightboxControls(this.shell);
  } finally { endLayout?.(); }
 }
 private labelToggle(button: HTMLButtonElement, label: string): void {
  if (this.toggleLabels.get(button) === label) return;
  this.toggleLabels.set(button, label);
  button.setAttribute('aria-label', label);
  bindOperonHoverTooltip(button, { content: label, taskColor: null });
 }
 private showFileActions(visible: boolean): void {
  for (const button of Array.from(this.shell.querySelectorAll<HTMLButtonElement>(':scope > .operon-task-media-lightbox-tab, :scope > .operon-task-media-lightbox-split, :scope > .operon-task-media-lightbox-split-below, :scope > .operon-lightbox-dimming-control'))) button.hidden = !visible;
 }
 private positionRail(): void {
  if (!this.isMarkdown || this.disposed) return;
  const rail = this.rail ?? this.fallbackRail();
  const controls = Array.from(this.shell.querySelectorAll<HTMLButtonElement>(':scope > .operon-task-media-lightbox-control'));
  const visible = controls.filter(button => !button.hidden);
  const top = visible.filter(button => !button.matches('.operon-lightbox-dimming-control, .operon-lightbox-size-control'));
  const middle = ['increase', 'decrease'].flatMap(action => visible.filter(button => button.classList.contains(`operon-lightbox-height-${action}`)));
  const bottom = visible.filter(button => button.matches('.operon-lightbox-dimming-control'));
  // Toggles follow Close; height controls share the middle of the same rail. Compact when these
  // groups would overlap; hidden controls never consume a slot.
  const edgeCount = Math.max(top.length, bottom.length);
  const slots = Math.max(1, 2 * edgeCount + middle.length);
  const gap = Math.min(8, Math.max(0, rail.height - 16) / slots * .15);
  const size = Math.max(1, Math.min(36, (rail.height - 16 - gap * (2 * Math.max(0, edgeCount - 1) + Math.max(0, middle.length - 1) + 2)) / slots));
  const step = size + gap;
  const groupHeight = (count: number): number => count ? count * size + (count - 1) * gap : 0;
  const left = rail.left + (rail.width - size) / 2;
  const place = (buttons: HTMLButtonElement[], x: number, y: number, horizontal = false): void => {
   buttons.forEach((button, index) => {
    button.style.setProperty('left', `${x + (horizontal ? index * step : 0)}px`);
    button.style.setProperty('top', `${y + (horizontal ? 0 : index * step)}px`);
    button.style.setProperty('width', `${size}px`); button.style.setProperty('height', `${size}px`);
   });
  };
  place(top, left, rail.top + 8);
  place(middle, left, rail.top + (rail.height - groupHeight(middle.length)) / 2);
  place(bottom, left, rail.top + rail.height - 8 - groupHeight(bottom.length));
  if (!this.markdownVisible) return;
  const rect = this.markdown.getBoundingClientRect();
  const widthButtons = ['decrease', 'increase'].flatMap(action => visible.filter(button => button.classList.contains(`operon-lightbox-width-${action}`)));
  const pair = groupHeight(widthButtons.length);
  // Keep width controls centered below the source, even when it becomes narrow.
  const win = this.shell.ownerDocument.defaultView!;
  const widthLeft = Math.max(8, Math.min(win.innerWidth - pair - 8, rect.left + (rect.width - pair) / 2));
  place(widthButtons, widthLeft, Math.min(rect.bottom + 4, win.innerHeight - size - 8), true);
 }
 dispose(): void {
  if (this.disposed) return;
  this.disposed = true; this.generation++;
  this.observer.disconnect(); this.shell.ownerDocument.defaultView?.removeEventListener('resize', this.resize);
  this.shell.removeEventListener('keydown', this.escape);
  this.panel.removeEventListener('focusin', this.rememberEditorFocus);
  this.markdown.removeEventListener('focusin', this.rememberSourceFocus);
  this.panel.removeEventListener('operon-editor-close', this.closeIntent);
  this.panel.removeEventListener('operon-editor-source-location', this.sourceLocation);
  this.panel.removeEventListener('operon-editor-escape-intent', this.escapeIntent);
  this.editor?.destroy({ skipCloseSave: true });
  this.unbind(); this.panel.remove(); this.showMarkdown.remove(); this.showEditor.remove();
  const file = this.descriptor?.file ?? this.currentFile;
  if (file) void Promise.resolve(this.provider.closed(file.path)).catch(error => console.warn('Operon: workspace close refresh failed', error));
 }
}
