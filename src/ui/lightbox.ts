import { LIGHTBOX_SIZE_STEPS, getLightboxControlSide, getLightboxProfileSize, saveLightboxProfileSize, type LightboxSizeProfile } from '../core/lightbox-size';
import { registerDesktopBackdrop, isDesktopBackdropDescendant, getDesktopBackdropDimming, canSaveDesktopBackdropDimming, stepDesktopBackdropDimming, subscribeDesktopBackdropDimming } from './modal-backdrop';
import { Notice, Platform, Scope, setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { asHTMLElement, getOwnerBody, getOwnerDocument, getOwnerWindow, isHTMLElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { getWindowApp } from '../core/obsidian-app';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { requestFloatingPanelCloseForRoot } from './field-pickers/common';

export interface LightboxOptions {
	title: string;
 originLeaf?: WorkspaceLeaf;
	/** Keep an accessible title without duplicating a content-owned toolbar. */
	showTitle?: boolean;
	className?: string;
	/** Prepare a new tab after saving; return its activation step, or null to keep this view. */
	onOpenInTab?: () => Promise<(() => void) | null>;
 onOpenToRight?: () => Promise<(() => void) | null>;
 onOpenBelow?: () => Promise<(() => void) | null>;
	/** Return false to retain content; asynchronous saves complete before teardown. */
	beforeClose?: (reason?: 'close' | 'transfer') => boolean | Promise<boolean>;
	/** Native views can open host menus outside the modal DOM. */
	nativeView?: boolean;
	/** Also called when a queued opening is cancelled before mounting. */
	onDispose?: () => void;
 onCloseRejected?: () => void;
	/** Render into the existing shell and return content-specific cleanup. */
	render: (lightbox: HTMLElement, close: () => void) => (() => void) | null;
}

let lightboxId = 0;
export type LightboxClose = () => boolean | Promise<boolean>;
const activeLightboxes = new WeakMap<Document, LightboxClose>();
const openingRequests = new WeakMap<Document, object>();

interface LightboxSource {
 panel: HTMLElement;
 owner: Node | null;
 blocked: () => boolean;
 focus: () => void;
 closeClean: () => void;
 holds: number;
}
const sources = new Set<LightboxSource>();
interface LightboxRecord {
 shell: HTMLElement;
 modalOwner?: HTMLElement;
 originLeaf?: WorkspaceLeaf;
 parent?: LightboxRecord;
 source?: LightboxSource;
 close: LightboxClose;
 finish: (focus?: boolean) => boolean;
 prepare: () => boolean | Promise<boolean>;
 transfer: (prepare: () => Promise<(() => void) | null>) => Promise<boolean>;
}
const records = new WeakMap<LightboxClose, LightboxRecord>();

/** Explicit ownership keeps only the initiating edit session alive during preview. */
export function registerLightboxSource(panel: HTMLElement, owner: Node | null, options: Pick<LightboxSource, 'blocked' | 'focus' | 'closeClean'>): { suspended: () => boolean; dispose: () => void } {
 const source: LightboxSource = {panel, owner, ...options, holds: 0};
 sources.add(source);
 return {suspended: () => source.holds > 0, dispose: () => { sources.delete(source); }};
}
function sourceFor(anchor: HTMLElement): LightboxSource | undefined {
 return [...sources].find(source => source.panel.contains(anchor));
}
function recordFor(anchor: HTMLElement): LightboxRecord | undefined {
 const close = activeLightboxes.get(getOwnerDocument(anchor));
 const record = close && records.get(close);
 const source = sourceFor(anchor);
 return record && (record.shell.contains(anchor) || isDesktopBackdropDescendant(anchor, record.shell) || !!source?.owner && record.shell.contains(source.owner)) ? record : undefined;
}
export function getActiveLightboxShell(document: Document): HTMLElement | undefined {
 const close = activeLightboxes.get(document);
 return close ? records.get(close)?.shell : undefined;
}
export function getLightboxOrigin(anchor: HTMLElement): WorkspaceLeaf | undefined {
 return recordFor(anchor)?.originLeaf;
}

/** Modifier navigation from a nested surface observes the same draft/save guards. */
export async function transferLightboxOpening(anchor: HTMLElement, prepare: () => Promise<(() => void) | null>): Promise<boolean> {
 const record = recordFor(anchor);
 if (record) return record.transfer(prepare);
 const source = sourceFor(anchor);
 if (source?.blocked()) { notifyDraftTransfer(); return false; }
 if (source) { source.holds++; source.panel.inert = true; }
 try {
  const activate = await prepare();
  if (!activate) return false;
  source?.closeClean();
  activate();
  return true;
 } finally {
  if (source) {source.holds--; if (!source.holds) source.panel.inert = false;}
 }
}

function notifyDraftTransfer(): void {
 new Notice('Finish editing the description or note before opening this preview in a tab or split.');
}

export function openLightbox(anchor: HTMLElement, options: LightboxOptions): LightboxClose {
 const controlSide = getLightboxControlSide();
	const ownerDocument = getOwnerDocument(anchor);
	const previouslyFocused = asHTMLElement(ownerDocument.activeElement, anchor);
	const request = {};
	openingRequests.set(ownerDocument, request);
	const previous = activeLightboxes.get(ownerDocument);
 const parent = Platform.isDesktopApp ? recordFor(anchor) : undefined;
 const source = Platform.isDesktopApp ? sourceFor(anchor) : undefined;
 const modalOwner = Platform.isDesktopApp ? parent?.modalOwner
  ?? anchor.closest<HTMLElement>('.operon-focus-modal')
  ?? asHTMLElement(source?.owner, anchor)?.closest<HTMLElement>('.operon-focus-modal')
  ?? undefined : undefined;
	if (previous && !parent) {
		const result = previous();
		if (result instanceof Promise) {
			let cancelled = false;
			let opened: LightboxClose | null = null;
			void result.then(closed => {
				if (closed && !cancelled && openingRequests.get(ownerDocument) === request) opened = openLightbox(anchor, options);
				else if (!cancelled) options.onDispose?.();
			});
			return () => { if (opened) return opened(); if (!cancelled) options.onDispose?.(); cancelled = true; return true; };
		}
		if (!result) { options.onDispose?.(); return () => true; }
	}
	const nativeOverlays = '.menu, .suggestion-container, .hover-popover, .modal-container, .cm-tooltip-autocomplete, .cm-search';
 const isVisibleOverlay = (el: Element): boolean => el.getClientRects().length > 0
  && getOwnerWindow(anchor).getComputedStyle(el).visibility !== 'hidden';
	const existingOverlays = new Set<Element>(Array.from(ownerDocument.querySelectorAll(nativeOverlays)).filter(isVisibleOverlay));
	const hasNativeOverlay = (): boolean => Array.from(ownerDocument.querySelectorAll(nativeOverlays))
		.some(el => !existingOverlays.has(el) && el !== lightbox && isVisibleOverlay(el));
	const lightbox = getOwnerBody(anchor).createDiv('operon-task-media-lightbox');
 const releaseBackdrop = registerDesktopBackdrop(lightbox);
	if (options.className) lightbox.addClass(options.className);
 if (modalOwner) lightbox.addClass('is-modal-owned');
	if (Platform.isDesktopApp) lightbox.addClass('has-content-controls');
	lightbox.setAttribute('role', 'dialog');
	lightbox.setAttribute('aria-modal', 'true');
	lightbox.tabIndex = -1;
	const title = lightbox.createDiv({ cls: 'operon-task-media-lightbox-title', text: options.title });
	title.hidden = options.showTitle === false;
	title.id = `operon-task-media-lightbox-title-${++lightboxId}`;
	lightbox.setAttribute('aria-labelledby', title.id);

	const closeButton = lightbox.createEl('button', {
		cls: 'operon-task-media-lightbox-close operon-task-media-lightbox-control',
		attr: { type: 'button' },
	});
	setIcon(closeButton, 'x');
	setAccessibleLabelWithoutTooltip(closeButton, t('buttons', 'close'));
 const tabButton = options.onOpenInTab && Platform.isDesktopApp ? lightbox.createEl('button', {
  cls: 'operon-task-media-lightbox-tab operon-task-media-lightbox-control', attr: {type: 'button'},
 }) : null;
 if (tabButton) {
  setIcon(tabButton, 'external-link');
  setAccessibleLabelWithoutTooltip(tabButton, 'Open in new tab');
  bindOperonHoverTooltip(tabButton, {content: 'Open in new tab', taskColor: null});
 }
 const splitButton = options.onOpenToRight && Platform.isDesktopApp ? lightbox.createEl('button', {cls: 'operon-task-media-lightbox-split operon-task-media-lightbox-control', attr: {type:'button'}}) : null;
 if (splitButton) {
  setIcon(splitButton, 'columns-2');
  setAccessibleLabelWithoutTooltip(splitButton, 'Open to the right');
  bindOperonHoverTooltip(splitButton, {content: 'Open to the right', taskColor: null});
 }
 const belowButton = options.onOpenBelow && Platform.isDesktopApp ? lightbox.createEl('button', {cls: 'operon-task-media-lightbox-split-below operon-task-media-lightbox-control', attr: {type:'button'}}) : null;
 if (belowButton) {
  setIcon(belowButton, 'rows-2');
  setAccessibleLabelWithoutTooltip(belowButton, 'Open below');
  bindOperonHoverTooltip(belowButton, {content: 'Open below', taskColor: null});
 }
 let disposeDimmingControls: (() => void) | null = null;
 if (Platform.isDesktopApp) {
  const increase = lightbox.createEl('button', {cls: 'operon-task-media-lightbox-control operon-lightbox-dimming-control operon-lightbox-dimming-increase', attr: {type:'button'}});
  const decrease = lightbox.createEl('button', {cls: 'operon-task-media-lightbox-control operon-lightbox-dimming-control operon-lightbox-dimming-decrease', attr: {type:'button'}});
  [increase, decrease].forEach((control, index) => control.style.setProperty('--operon-lightbox-dimming-index', String(index)));
  setIcon(increase, 'moon'); setIcon(decrease, 'sun');
  const increaseLabel = t('settings', 'backgroundDimmingIncrease');
  const decreaseLabel = t('settings', 'backgroundDimmingDecrease');
  setAccessibleLabelWithoutTooltip(increase, increaseLabel); setAccessibleLabelWithoutTooltip(decrease, decreaseLabel);
  const unsubscribe = subscribeDesktopBackdropDimming(() => {
   const value = getDesktopBackdropDimming();
   setAccessibleLabelWithoutTooltip(increase, `${increaseLabel}: ${value}%`);
   setAccessibleLabelWithoutTooltip(decrease, `${decreaseLabel}: ${value}%`);
   increase.disabled = !canSaveDesktopBackdropDimming() || value >= 90;
   decrease.disabled = !canSaveDesktopBackdropDimming() || value <= 10;
  });
  const step = (direction: -1 | 1): void => {
   void stepDesktopBackdropDimming(direction).catch(() => { new Notice(t('settings', 'backgroundDimmingSaveFailed')); });
  };
  increase.addEventListener('click', () => step(1)); decrease.addEventListener('click', () => step(-1));
  disposeDimmingControls = unsubscribe;
 }
 bindOperonHoverTooltip(closeButton, {content: t('buttons', 'close'), taskColor: null});
 let disposePosition: (() => void) | null = null;
 let disposeControlHover: (() => void) | null = null;
 // Own Escape before the native editor consumes it; keep child menus/pickers first.
 // Child previews must also avoid the underlying modal's Escape or Tab trap.
 const modalApp = getWindowApp(getOwnerWindow(anchor));
 const modalScope = modalApp?.keymap ? new Scope(modalApp.scope) : null;
 let modalScopeActive = false;


	let isClosed = false;
	let contentCleanup: (() => void) | null = null;
	let closing: Promise<boolean> | null = null;
	const finishClose = (restoreFocus = true): boolean => {
		if (isClosed) return true;
		isClosed = true;
  disposePosition?.();
  disposeControlHover?.();
  disposeDimmingControls?.();
  cleanupOperonHoverTooltips(closeButton);
  if (tabButton) cleanupOperonHoverTooltips(tabButton);
  if (splitButton) cleanupOperonHoverTooltips(splitButton);
  if (belowButton) cleanupOperonHoverTooltips(belowButton);
		ownerDocument.removeEventListener('keydown', closeOnKeydown);
		ownerDocument.defaultView?.removeEventListener('pagehide', onPageHide);
		ownerDocument.removeEventListener('focusin', keepFocusInside, true);
		const cleanup = contentCleanup;
		contentCleanup = null;
		try {
			cleanup?.();
		} finally {
   if (modalScopeActive && modalScope) {
    modalScopeActive = false;
    modalApp?.keymap.popScope(modalScope);
   }
			releaseBackdrop();
			lightbox.remove();
			options.onDispose?.();
			if (activeLightboxes.get(ownerDocument) === close) {
				if (parent) {
     activeLightboxes.set(ownerDocument, parent.close);
     parent.shell.inert = false;
    } else activeLightboxes.delete(ownerDocument);
			}
			const focusTarget = previouslyFocused?.isConnected
				? previouslyFocused
				: anchor.isConnected ? anchor : null;
			if (source) {
    source.holds = Math.max(0, source.holds - 1);
    if (!source.holds && source.panel.isConnected) { source.panel.hidden = false; source.panel.inert = false; }
   }
   if (restoreFocus) {
    if (source?.panel.isConnected) source.focus();
    else focusTarget?.focus({ preventScroll: true });
   }
		}
		return true;
	};
 const lock = (locked: boolean): void => {
  lightbox.inert = locked; closeButton.disabled = locked;
  if (tabButton) tabButton.disabled = locked;
  if (splitButton) splitButton.disabled = locked;
  if (belowButton) belowButton.disabled = locked;
 };
 const requestClose = (): boolean | Promise<boolean> => {
  if (isClosed) return true;
  if (closing) return closing;
  if (activeLightboxes.get(ownerDocument) !== close) return false;
  const allowed = options.beforeClose?.() ?? true;
  if (!(allowed instanceof Promise)) { if (!allowed) options.onCloseRejected?.(); return allowed ? finishClose() : false; }
  lock(true);
  closing = allowed.then(ok => ok ? finishClose() : false).finally(() => {closing = null; if (!isClosed) { lock(false); options.onCloseRejected?.(); }});
  return closing;
 };
 const close: LightboxClose = () => requestClose();
 const transfer = (prepare: () => Promise<(() => void) | null>): Promise<boolean> => {
  if (closing) return closing;
  if (isClosed || activeLightboxes.get(ownerDocument) !== close) return Promise.resolve(false);
  const chain: LightboxRecord[] = [];
  for (let current: LightboxRecord | undefined = record; current; current = current.parent) chain.push(current);
  const owners = [...sources].filter(candidate => chain.some(item => item.source === candidate || item.shell.contains(candidate.panel) || !!candidate.owner && item.shell.contains(candidate.owner)));
  if (owners.some(candidate => candidate.blocked())) {
   notifyDraftTransfer();
   return Promise.resolve(false);
  }
  lock(true);
  for (const candidate of owners) {candidate.holds++; candidate.panel.inert = true;}
  closing = (async () => {
   for (const item of chain) if (!await item.prepare()) return false;
   if (owners.some(candidate => candidate.blocked())) return false;
   const activate = await prepare();
   if (!activate) return false;
   for (const candidate of owners) candidate.closeClean();
   for (const item of chain) item.finish(false);
   activate();
   return true;
  })().catch(() => {new Notice('Could not open this preview. The lightbox is still open.'); return false;})
   .finally(() => {
    for (const candidate of owners) {candidate.holds--; if (!candidate.holds && candidate.panel.isConnected) candidate.panel.inert = false;}
    closing = null; if (!isClosed) lock(false);
   });
  return closing;
 };
 const record: LightboxRecord = {shell: lightbox, modalOwner, originLeaf: parent?.originLeaf ?? options.originLeaf, parent, source, close, finish: finishClose, prepare: () => options.beforeClose?.('transfer') ?? true, transfer};
 records.set(close, record);
 // Keep the previous working level visible beneath the child backdrop.
 if (parent) parent.shell.inert = true;
 if (source) {source.holds++; source.panel.hidden = true; source.panel.inert = true;}

	const onPageHide = (): void => {
  void (async () => {
   for (let current: LightboxRecord | undefined = record; current; current = current.parent) if (!await current.close()) break;
  })();
 };
 const handleEscape = (event: KeyboardEvent): boolean => {
  if (activeLightboxes.get(ownerDocument) !== close || event.isComposing
   || Reflect.get(event, 'keyCode') === 229 || event.defaultPrevented || hasNativeOverlay()) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (!requestFloatingPanelCloseForRoot(lightbox, 'escape', true)) void close();
  return true;
 };
 const closeOnKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') handleEscape(event);
 };
 modalScope?.register(null, 'Escape', event => {
  // Compact editors already route Escape intents after their own editing interactions.
  const target = asHTMLElement(event.target, lightbox);
  if (target?.closest('.operon-compact-markdown-editor, .operon-compact-markdown-editor-fallback')) return true;
  return !handleEscape(event);
 });
 const focusShell = (): void => {
  (Platform.isDesktopApp ? lightbox : closeButton).focus({ preventScroll: true });
 };
	const keepFocusInside = (event: FocusEvent): void => {
		if (activeLightboxes.get(ownerDocument) !== close || !isHTMLElement(event.target, lightbox) || lightbox.contains(event.target) || hasNativeOverlay()) return;
  focusShell();
	};
	lightbox.addEventListener('click', (event) => {
		if (event.target === lightbox) void close();
	});
	closeButton.addEventListener('click', () => { void close(); });
 tabButton?.addEventListener('click', () => { if (options.onOpenInTab) void transfer(options.onOpenInTab); });
 splitButton?.addEventListener('click', () => { if (options.onOpenToRight) void transfer(options.onOpenToRight); });
 belowButton?.addEventListener('click', () => { if (options.onOpenBelow) void transfer(options.onOpenBelow); });

	ownerDocument.addEventListener('keydown', closeOnKeydown);
	ownerDocument.defaultView?.addEventListener('pagehide', onPageHide);
	ownerDocument.addEventListener('focusin', keepFocusInside, true);
	activeLightboxes.set(ownerDocument, close);
	try {
  if (modalScope && modalApp) {
   modalApp.keymap.pushScope(modalScope);
   modalScopeActive = true;
  }
		const cleanup = options.render(lightbox, () => { void close(); });
		if (isClosed) cleanup?.();
		else contentCleanup = cleanup;
	} catch (error) {
		finishClose();
		throw error;
	}
 if (!isClosed && Platform.isDesktopApp) {
  disposeControlHover = bindLightboxControlHover(lightbox, !!options.nativeView);
  disposePosition = positionLightboxControls(lightbox, controlSide);
 }
 if (!isClosed && (!Platform.isDesktopApp || !lightbox.contains(ownerDocument.activeElement) && !hasNativeOverlay())) focusShell();
	return close;
}


const controlReady = new WeakMap<HTMLElement, () => void>();
/** Native surfaces call this only once their complete initial panel is ready. */
export function markLightboxControlsReady(lightbox: HTMLElement): void { controlReady.get(lightbox)?.(); }

/** Hover activation waits for the initial surface; keyboard focus remains immediate. */
function bindLightboxControlHover(lightbox: HTMLElement, native: boolean): () => void {
 let started = false;
 let pointer: { x: number; y: number } | null = null;
 lightbox.addClass('are-controls-pending');
 const leave = (): void => { pointer = null; lightbox.removeClass('are-controls-hovered'); };
 const over = (event: PointerEvent): void => {
  pointer = { x: event.clientX, y: event.clientY };
  const onControl = event.composedPath().some(node => isHTMLElement(node, lightbox)
   && node.parentElement === lightbox && node.classList.contains('operon-task-media-lightbox-control'));
  lightbox.toggleClass('are-controls-hovered', event.target === lightbox || onControl);
 };
 const start = (): void => {
  if (started) return;
  started = true;
  // Read the completed layout again: content may now cover a stationary pointer.
  const target = pointer ? lightbox.ownerDocument.elementFromPoint(pointer.x, pointer.y) : null;
  const control = target?.closest('.operon-task-media-lightbox-control');
  lightbox.toggleClass('are-controls-hovered', target === lightbox || control?.parentElement === lightbox);
  lightbox.removeClass('are-controls-pending');
 };
 controlReady.set(lightbox, start);
 lightbox.addEventListener('pointerover', over);
 lightbox.addEventListener('pointerleave', leave);
 if (!native) start();
 return () => {
  controlReady.delete(lightbox);
  lightbox.removeClass('are-controls-pending');
  lightbox.removeEventListener('pointerover', over);
  lightbox.removeEventListener('pointerleave', leave);
  leave();
 };
}

const appLightboxes = new WeakMap<App, Set<LightboxClose>>();

/** Track all content types, including queued openings, for plugin unload. */
export function openAppLightbox(app: App, anchor: HTMLElement, options: LightboxOptions): LightboxClose {
 let disposed = false;
 let close: LightboxClose | undefined;
 close = openLightbox(anchor, { ...options, onDispose: () => {
  if (disposed) return;
  disposed = true;
  if (close) appLightboxes.get(app)?.delete(close);
  options.onDispose?.();
 } });
 if (!disposed) {
  let active = appLightboxes.get(app);
  if (!active) { active = new Set(); appLightboxes.set(app, active); }
  active.add(close);
 }
 return close;
}

export function disposeAppLightboxes(app: App): void {
 for (const close of [...(appLightboxes.get(app) ?? [])].reverse()) {
  const result = close();
  if (result instanceof Promise) {void result.then(closed => {if (closed) disposeAppLightboxes(app);}); break;}
  if (!result) break;
 }
}

export interface LightboxContentTarget {
 content: HTMLElement;
 /** Optional inner rail rectangle for a companion layout, in viewport coordinates. */
 controls?: () => { left: number; top: number; height: number } | undefined;
 afterPosition?: () => void;
 size?: { measure: () => DOMRect; step: (axis: 'width' | 'height', direction: -1 | 1) => number | null; apply: (axis: 'width' | 'height', value: number) => void; enabled: () => boolean };
 refresh?: () => void;
}
const contentTargets = new WeakMap<HTMLElement, LightboxContentTarget>();

export function bindLightboxContent(shell: HTMLElement, target: LightboxContentTarget): () => void {
 contentTargets.set(shell, target);
 return () => { if (contentTargets.get(shell) === target) contentTargets.delete(shell); };
}

export function refreshLightboxControls(shell: HTMLElement): void { contentTargets.get(shell)?.refresh?.(); }

function lightboxContent(shell: HTMLElement): HTMLElement | null {
 return contentTargets.get(shell)?.content ?? shell.querySelector<HTMLElement>(':scope > .operon-task-media-lightbox-content, :scope > img');
}

const sizeProfiles = new WeakMap<HTMLElement, LightboxSizeProfile>();
const pendingImageBaseline = new WeakMap<HTMLElement, 'width' | 'height'>();

function finishImageBaseline(content: HTMLElement): void {
 const axis = pendingImageBaseline.get(content);
 const image = content as HTMLImageElement;
 const win = content.ownerDocument.defaultView;
 if (!axis || !image.naturalWidth || !win) return;
 pendingImageBaseline.delete(content);
 const requested = content.style.getPropertyValue(axis);
 content.style.removeProperty(axis);
 content.removeClass('is-lightbox-resized');
 const other = axis === 'width' ? 'height' : 'width';
 const pixels = axis === 'width' ? image.offsetHeight : image.offsetWidth;
 const unit = other === 'width' ? 'vw' : 'vh';
 content.style.setProperty(other, `min(${pixels / (other === 'width' ? win.innerWidth : win.innerHeight) * 100}${unit}, calc(100${unit} - 96px))`);
 content.addClass('is-lightbox-resized');
 content.style.setProperty(axis, requested);
}

/** Apply the resolved type before asynchronous native loading can produce a paint. */
export function applyLightboxSizeProfile(lightbox: HTMLElement, profile: LightboxSizeProfile): void {
 if (!Platform.isDesktopApp || sizeProfiles.get(lightbox) === profile) return;
 const content = lightboxContent(lightbox);
 if (!content) return;
 const previous = sizeProfiles.get(lightbox);
 sizeProfiles.set(lightbox, profile);
 if (previous) {
  content.style.removeProperty('width'); content.style.removeProperty('height');
  content.removeClass('is-lightbox-resized');
 }
 const size = getLightboxProfileSize(profile);
 if (content.tagName === 'IMG' && size && (size.width === undefined) !== (size.height === undefined)) {
  pendingImageBaseline.set(content, size.width === undefined ? 'height' : 'width');
 }
 for (const axis of ['width', 'height'] as const) if (size?.[axis] !== undefined) {
  const unit = axis === 'width' ? 'vw' : 'vh';
  content.addClass('is-lightbox-resized');
  content.style.setProperty(axis, `min(${size[axis]}${unit}, calc(100${unit} - 96px))`);
 }
 finishImageBaseline(content);
}

/** Use the nearest strict neighbour, allowing CSS subpixel rounding at a step. */
export function getLightboxSizeStep(current: number, direction: -1 | 1): number | null {
 const steps = direction > 0 ? LIGHTBOX_SIZE_STEPS : [...LIGHTBOX_SIZE_STEPS].reverse();
 return steps.find(value => direction > 0 ? value > current + 0.05 : value < current - 0.05) ?? null;
}

/** Keep controls in the content's coordinate space, using a second column when short. */
function positionLightboxControls(lightbox: HTMLElement, side: 'left' | 'right'): (() => void) | null {
 const content = lightboxContent(lightbox);
 const win = lightbox.ownerDocument.defaultView;
 if (!content || !win) return null;
 const mainCount = lightbox.querySelectorAll('.operon-task-media-lightbox-control:not(.operon-lightbox-dimming-control)').length;
 const dimmingCount = lightbox.querySelectorAll('.operon-lightbox-dimming-control').length;
 const controls: {button: HTMLButtonElement; axis: 'width' | 'height'; direction: -1 | 1; click: () => void}[] = [];
 const measure = (): {left: number; top: number; right: number; bottom: number; width: number; height: number} => {
  // Image zoom/pan transforms pixels, not the frame used by these controls.
  const supplied = contentTargets.get(lightbox)?.size?.measure();
  if (supplied) return supplied;
  if (content.tagName !== 'IMG') return content.getBoundingClientRect();
  const {offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height} = content;
  return {left, top, width, height, right: left + width, bottom: top + height};
 };
 const nextSize = (pixels: number, viewport: number, direction: -1 | 1): number | null => {
  const next = getLightboxSizeStep(pixels / viewport * 100, direction);
  if (next === null) return null;
  const target = Math.min(next / 100 * viewport, viewport - 96);
  return pixels > 0 && (target - pixels) * direction > 0.75 ? next : null;
 };
 const labels = {
  width: {increase: t('buttons', 'lightboxWidthIncrease'), decrease: t('buttons', 'lightboxWidthDecrease')},
  height: {increase: t('buttons', 'lightboxHeightIncrease'), decrease: t('buttons', 'lightboxHeightDecrease')},
 };
 for (const axis of ['width', 'height'] as const) for (const direction of [-1, 1] as const) {
  const action = direction > 0 ? 'increase' : 'decrease';
  const button = lightbox.createEl('button', {cls: `operon-task-media-lightbox-control operon-lightbox-size-control operon-lightbox-${axis}-${action}`, attr: {type: 'button'}});
  setIcon(button, `${direction > 0 ? 'unfold' : 'fold'}-${axis === 'width' ? 'horizontal' : 'vertical'}`);
  const label = labels[axis][action];
  setAccessibleLabelWithoutTooltip(button, label);
  bindOperonHoverTooltip(button, {content: label, taskColor: null});
  const click = (): void => {
   if (lightbox.inert || lightbox.hidden) return;
   const rect = measure(), viewport = axis === 'width' ? win.innerWidth : win.innerHeight;
   const custom = contentTargets.get(lightbox)?.size;
   const next = custom ? custom.step(axis, direction) : nextSize(rect[axis], viewport, direction);
   if (next === null) return;
   if (content.tagName === 'IMG' && !content.classList.contains('is-lightbox-resized')) {
    // Preserve the other axis while object-fit keeps the image itself undistorted.
    content.style.setProperty('width', `min(${rect.width / win.innerWidth * 100}vw, calc(100vw - 96px))`);
    content.style.setProperty('height', `min(${rect.height / win.innerHeight * 100}vh, calc(100vh - 96px))`);
   }
   if (custom) { custom.apply(axis, next); position(); return; }
   content.addClass('is-lightbox-resized');
   const unit = axis === 'width' ? 'vw' : 'vh';
   content.style.setProperty(axis, `min(${next}${unit}, calc(100${unit} - 96px))`);
   position();
   const profile = sizeProfiles.get(lightbox);
   if (profile) void saveLightboxProfileSize(profile, axis, next).catch(() => { new Notice(t('settings', 'lightboxSizeSaveFailed')); });
  };
  button.addEventListener('click', click);
  controls.push({button, axis, direction, click});
 }
 const position = (): void => {
  if (lightbox.hidden) return;
  finishImageBaseline(content);
  const measured = measure();
  const rail = contentTargets.get(lightbox)?.controls?.();
  const width = win.innerWidth, height = win.innerHeight;
  // Run the existing collision layout in right-side coordinates, then mirror
  // its result. Companion layouts already supply their own mirrored rail.
  const mirrored = side === 'left' && !rail;
  const rect = mirrored ? { left: width - measured.right, right: width - measured.left, top: measured.top, bottom: measured.bottom, width: measured.width, height: measured.height } : measured;
  const count = mainCount + dimmingCount;
  const size = Math.min(36, (height - 16 - 4 * (count - 1)) / count);
  const step = Math.min(44, (height - 16 - size) / Math.max(1, count - 1));
  const railHeight = (count - 1) * step + size;
  lightbox.style.setProperty('--operon-lightbox-control-size', `${size}px`);
  lightbox.style.setProperty('--operon-lightbox-control-step', `${step}px`);
  const pair = step + size;
  const displayLeft = (left: number, span = size): number => mirrored ? width - left - span : left;
  const bottomLeft = Math.max(8, Math.min(width - pair - 8, (rect.left + rect.right - pair) / 2));
  const bottomTop = rect.bottom + 4 + size <= height - 8 ? rect.bottom + 4 : Math.max(8, height - size - 8);
  const left = rail?.left ?? (rect.right + 8 + size <= width - 8 ? rect.right + 8 : rect.right - size - 8);
  let railLeft = Math.max(8, Math.min(width - size - 8, left));
  // A small natural image can be narrower than the bottom pair.
  if (!rail && railLeft < bottomLeft + pair + 4 && railLeft + size > bottomLeft - 4) {
   const outside = bottomLeft + pair + 4;
   railLeft = outside + size <= width - 8 ? outside : Math.max(8, bottomLeft - size - 4);
  }
  lightbox.style.setProperty('--operon-lightbox-control-left', `${displayLeft(railLeft)}px`);
  const top = Math.max(8, Math.min(height - railHeight - 8, (rail?.top ?? rect.top) + 8));
  lightbox.style.setProperty('--operon-lightbox-control-top', `${top}px`);
  const dimmingHeight = (dimmingCount - 1) * step + size;
  const dimmingTop = Math.max(top + mainCount * step,
   Math.min(height - dimmingHeight - 8, (rail ? rail.top + rail.height : rect.bottom) - dimmingHeight - 8));
  lightbox.style.setProperty('--operon-lightbox-dimming-top', `${dimmingTop}px`);
  const middleTop = Math.max(8, Math.min(height - pair - 8, (rail ? rail.top + rail.height / 2 - pair / 2 : (rect.top + rect.bottom - pair) / 2)));
  const mainBottom = top + (mainCount - 1) * step + size;
  const overlaps = middleTop < mainBottom + 4 || middleTop + pair > dimmingTop - 4;
  const alternateLeft = railLeft + step + size <= width - 8 ? railLeft + step : railLeft - step;
  let middleLeft = overlaps ? Math.max(8, alternateLeft) : railLeft;
  if (middleTop < bottomTop + size + 4 && middleTop + pair > bottomTop - 4
   && middleLeft < bottomLeft + pair + 4 && middleLeft + size > bottomLeft - 4) {
   middleLeft = Math.max(8, bottomLeft - size - 4);
  }
  for (const {button, axis, direction} of controls) {
   const horizontal = axis === 'width';
   button.style.setProperty('--operon-lightbox-size-left', `${horizontal ? displayLeft(bottomLeft, pair) + (direction > 0 ? step : 0) : displayLeft(middleLeft)}px`);
   button.style.setProperty('--operon-lightbox-size-top', `${horizontal ? bottomTop : middleTop + (direction < 0 ? step : 0)}px`);
   const custom = contentTargets.get(lightbox)?.size;
   button.hidden = custom ? !custom.enabled() : false;
   button.disabled = custom ? !custom.enabled() || custom.step(axis, direction) === null : nextSize(rect[axis], horizontal ? width : height, direction) === null;
  }
  const radius = win.getComputedStyle(content).borderTopRightRadius;
  lightbox.style.setProperty('--operon-lightbox-control-radius', Number.parseFloat(radius) > 0 ? radius : '6px');
  contentTargets.get(lightbox)?.afterPosition?.();
 };
 const target = contentTargets.get(lightbox);
 if (target) target.refresh = position;
 const observer = new win.ResizeObserver(position);
 observer.observe(content);
 win.addEventListener('resize', position);
 content.addEventListener('load', position, true);
 position();
 return () => {
  if (target?.refresh === position) delete target.refresh;
  observer.disconnect(); win.removeEventListener('resize', position); content.removeEventListener('load', position, true);
  for (const {button, click} of controls) {button.removeEventListener('click', click); cleanupOperonHoverTooltips(button);}
 };
}
