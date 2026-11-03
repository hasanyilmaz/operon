import { clearNativeLightboxPool, nativeLightboxDefaults, parkNativeLightboxView, takeNativeLightboxView } from './native-lightbox-pool';
import { beginLightboxOpeningTrace, LIGHTBOX_PERF_ENABLED } from './lightbox-opening-perf';
import { Notice, Platform, WorkspaceTabs, type App, type TextFileView, type WorkspaceLeaf } from 'obsidian';
import { bindNativeLightboxMethod } from './native-lightbox-lifecycle';
import { NativeLightboxSurface } from './native-lightbox-surface';
import { getNativeTaskWorkspaceProvider, NativeTaskWorkspace, type NativeTaskWorkspaceInitial } from './native-task-workspace';
import type { TaskEditorSession } from './task-editor-modal';
import { OPERON_TABLE_FILE_VIEW_TYPE } from '../types/table';
import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';
import { t } from '../core/i18n';
import { markLightboxControlsReady, openAppLightbox, getLightboxOrigin, disposeAppLightboxes } from './lightbox';
import type { ResolvedLightboxFile } from './lightbox-opening';

export function nativeLightboxViewType(extension: string): string | null {
 return extension === 'md' ? 'markdown' : extension === 'base' ? 'bases' : extension === 'table' ? OPERON_TABLE_FILE_VIEW_TYPE : null;
}

export function disposeWebLightboxes(app: App): void {
 clearNativeLightboxPool(app);
 disposeAppLightboxes(app);
}

export function openWebLightbox(app: App, anchor: HTMLElement, url: string): boolean {
 if (!Platform.isDesktopApp || !isPluginEnabled(getInternalPlugin(app, 'webviewer'))) {
  new Notice(t('notifications', 'webViewerUnavailable'));
  return false;
 }
 void openNativeLightbox(app, anchor, { url });
 return true;
}

export function openFileLightbox(app: App, anchor: HTMLElement, file: ResolvedLightboxFile, canOpen?: () => boolean): void {
 if (Platform.isDesktopApp) void openNativeLightbox(app, anchor, { file }, undefined, canOpen);
}

export function openTaskWorkspace(app: App, anchor: HTMLElement, file: ResolvedLightboxFile, initial: NativeTaskWorkspaceInitial, canOpen?: () => boolean): Promise<TaskEditorSession | null> {
 return openNativeLightbox(app, anchor, { file }, initial, canOpen);
}

/** Obsidian ephemeral state uses zero-based lines. */
export function lightboxFileState(target: ResolvedLightboxFile): Record<string, unknown> {
 // A native line target adds a search highlight and repositions the cursor.
 // Use a collapsed cursor and line-based scroll for verified Inline sources.
 if (target.file.extension === 'md' && !target.subpath && Number.isInteger(target.line) && target.line! >= 0
  && Number.isInteger(target.caretCh) && target.caretCh! >= 0) {
  const position = { line: target.line, ch: target.caretCh };
  return { cursor: { from: position, to: { ...position } }, scroll: target.line, focus: true };
 }
 return { ...(target.subpath ? { subpath: target.subpath } : {}),
  ...(Number.isInteger(target.line) && target.line! >= 0 ? { line: target.line, focus: true } : {}) };
}

/** Initial openFile state can run while the owned host is inert; focus only after it is usable. */
export function focusLightboxSourceCaret(leaf: WorkspaceLeaf, target: ResolvedLightboxFile): void {
 const state = lightboxFileState(target);
 const view = leaf.view as TextFileView;
 if (!state.cursor || view.getViewType() !== 'markdown' || view.file?.path !== target.file.path
  || !view.containerEl.isConnected || view.containerEl.closest('[inert], [hidden]')) return;
 view.setEphemeralState(state);
}

/** Flush only edited native Markdown, never write merely because a file was viewed. */
export async function flushLightboxMarkdown(app: App, leaf: WorkspaceLeaf): Promise<boolean> {
 if (leaf.view.getViewType() !== 'markdown') return true;
 const view = leaf.view as TextFileView & { saving?: boolean; lastSavedData?: string | null };
 const file = view.file;
 if (!file) return true;
 const unchanged = (text: string) => leaf.view === view && view.file === file && view.getViewData() === text && !view.saving;
 try {
  // Native save() can return early while an autosave is already in flight.
  const deadline = Date.now() + 5000;
  while (view.saving) {
   if (Date.now() >= deadline) throw new Error('Save is still pending');
   await new Promise(resolve => getOwnerWindow(view.containerEl).setTimeout(resolve, 25));
  }
  const text = view.getViewData();
  const baseline = view.lastSavedData === undefined ? view.data : view.lastSavedData;
  if (text === baseline) return true;
  const stored = await app.vault.read(file);
  if (!unchanged(text)) return false;
  if (stored === text) return true;
  if (baseline !== stored) throw new Error('File changed while this view was open');
  await view.save();
  // Edits made while saving must remain visible, with another close available.
  if (view.getViewData() !== text) return false;
  if (await app.vault.read(file) !== text) throw new Error('Save was not confirmed');
  return unchanged(text);
 } catch {
  new Notice('Your changes could not be saved. This view is staying open so you can try again.');
  return false;
 }
}


/** getLeaf('tab') can reuse an existing empty tab. Create in the owner's group instead. */
export function getLightboxOwnerLeaf(app: App, doc: Document): WorkspaceLeaf {
 let origin = app.workspace.getMostRecentLeaf();
 const previousOwner = origin && layoutGuards.get(app)?.leaves.get(origin);
 if (previousOwner) origin = app.workspace.getLeafById((previousOwner as WorkspaceLeaf & {id: string}).id) === previousOwner ? previousOwner : null;
 if (origin?.view.containerEl.ownerDocument !== doc) {
  origin = null;
  app.workspace.iterateAllLeaves(candidate => {
   if (!origin && candidate.view.containerEl.ownerDocument === doc) origin = candidate;
  });
 }
 if (!origin?.parent) throw new Error('No tab group in this window');
 return origin;
}

export function createOwnedLightboxLeaf(app: App, doc: Document): WorkspaceLeaf {
 return app.workspace.createLeafInParent(getLightboxOwnerLeaf(app, doc).parent, -1);
}

/** Prepare a real tab without changing the selected background tab while loading. */
export async function prepareLightboxTab(app: App, doc: Document, load: (leaf: WorkspaceLeaf) => Promise<void>, placement: 'tab' | 'split' | 'below' = 'tab', origin = getLightboxOwnerLeaf(app, doc)): Promise<() => void> {
 const workspace = app.workspace as NativeWorkspace;
 const id = (origin as WorkspaceLeaf & {id?: string}).id;
 if (!origin.parent || origin.view.containerEl.ownerDocument !== doc || id && app.workspace.getLeafById(id) !== origin) throw new Error('The original tab is no longer available');
 const parent = origin.parent as WorkspaceTabs & {children: WorkspaceLeaf[]; currentTab: number; selectTabIndex: (index: number) => void};
 const selected = parent.children[parent.currentTab];
 const active = workspace.activeLeaf;
 const restore = (selection: WorkspaceLeaf | undefined, focus: WorkspaceLeaf | null): void => {
  const index = selection ? parent.children.indexOf(selection) : -1;
  if (index >= 0) parent.selectTabIndex(index);
  if (focus?.parent) app.workspace.setActiveLeaf(focus, {focus: false});
 };
 const splitParent = parent.parent as unknown as {children: Array<{dimension: number | null; setDimension: (value: number) => void}>};
 const beforeSplit = placement !== 'tab' && Array.isArray(splitParent?.children)
  ? splitParent.children.map(child => ({child, dimension: child.dimension})) : [];
 const destination = placement !== 'tab' ? app.workspace.createLeafBySplit(origin, placement === 'below' ? 'horizontal' : 'vertical', false) : app.workspace.createLeafInParent(parent, -1);
 const afterSplit = beforeSplit.length ? splitParent.children.map(child => ({child, dimension: child.dimension})) : [];
 restore(selected, active);
 try {
  const destinationTabs = destination.parent as NativeTabs;
  mountLightboxLeaf(destination, destinationTabs, doc);
  await load(destination);
  assertLightboxLeafMounted(destination, destinationTabs, doc);
  return () => app.workspace.setActiveLeaf(destination, {focus: true});
 } catch (error) {
  const selection = parent.children[parent.currentTab];
  const focus = workspace.activeLeaf;
  const stacked = workspace.lastTabGroupStacked;
  const unchangedSplit = afterSplit.length > 0 && splitParent.children.length === afterSplit.length
   && afterSplit.every((item, index) => splitParent.children[index] === item.child && item.child.dimension === item.dimension);
  const getState = bindNativeLightboxMethod(destination, 'getViewState');
  // A failed provisional tab is not a user-closed tab and must not evict history.
  destination.getViewState = () => ({type: 'empty'});
  try { destination.detach(); }
  finally {
   destination.getViewState = getState;
   if (unchangedSplit && splitParent.children.length === beforeSplit.length
    && beforeSplit.every((item, index) => splitParent.children[index] === item.child)) {
    for (const item of beforeSplit) if (typeof item.dimension === 'number') item.child.setDimension(item.dimension);
   }
   workspace.lastTabGroupStacked = stacked;
   restore(selection === destination ? selected : selection, focus === destination ? active : focus);
  }
  throw error;
 }
}

// Native ownership operations need the exact active leaf (not only its view).
// Keep those internal fields in one typed adapter, separate from public view queries.
type NativeWorkspace = Omit<App['workspace'], 'activeLeaf' | 'getLayout'> & {
 activeLeaf: WorkspaceLeaf | null;
 activeTabGroup: WorkspaceTabs | null;
 lastTabGroupStacked?: boolean;
 getLayout: (this: App['workspace']) => Record<string, unknown>;
};
type NativeTabs = WorkspaceTabs & {
 containerEl: HTMLElement;
 component: { unload: () => void };
 recomputeChildrenDimensions: () => void;
};

function assertLightboxLeafMounted(leaf: WorkspaceLeaf, tabs: NativeTabs, doc: Document): void {
 const root = (leaf as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;
 if (leaf.parent !== tabs || tabs.containerEl.ownerDocument !== doc || root.ownerDocument !== doc
  || leaf.view.containerEl.ownerDocument !== doc || !tabs.containerEl.contains(root)
  || !root.contains(leaf.view.containerEl)) throw new Error('Wrong lightbox window or parent');
}

/** Native insertion schedules DOM placement; finish it before loading an owned view. */
function mountLightboxLeaf(leaf: WorkspaceLeaf, tabs: NativeTabs, doc: Document): void {
 if (!tabs || leaf.parent !== tabs || tabs.containerEl.ownerDocument !== doc
  || typeof tabs.recomputeChildrenDimensions !== 'function') throw new Error('Unavailable native tab group');
 tabs.recomputeChildrenDimensions();
 assertLightboxLeafMounted(leaf, tabs, doc);
}
const isolatedLeaves = new WeakMap<WorkspaceLeaf, { tabs: NativeTabs; release: () => void }>();
const layoutGuards = new WeakMap<App, { leaves: Map<WorkspaceLeaf, WorkspaceLeaf>; original: NativeWorkspace['getLayout']; guarded: NativeWorkspace['getLayout'] }>();

/** Only the active identifier needs projecting: isolated groups never enter the saved tree. */
function retainLayoutOwner(app: App, leaf: WorkspaceLeaf, owner: WorkspaceLeaf): () => void {
 const workspace = app.workspace as NativeWorkspace;
 let guard = layoutGuards.get(app);
 if (!guard) {
  const leaves = new Map<WorkspaceLeaf, WorkspaceLeaf>();
  const original = workspace.getLayout;
  const guarded = () => {
   const layout = Reflect.apply(original, app.workspace, []);
   const active = workspace.activeLeaf;
   const previous = active && leaves.get(active);
   if (!previous) return layout;
   const identity = previous as WorkspaceLeaf & { id: string };
   const projected = { ...layout };
   if (app.workspace.getLeafById(identity.id) === previous) projected.active = identity.id;
   else delete projected.active;
   return projected;
  };
  guard = { leaves, original, guarded };
  layoutGuards.set(app, guard);
  app.workspace.getLayout = guarded;
 }
 guard.leaves.set(leaf, owner);
 return () => {
  guard.leaves.delete(leaf);
  if (!guard.leaves.size) {
   if (app.workspace.getLayout === guard.guarded) app.workspace.getLayout = guard.original;
   layoutGuards.delete(app);
  }
 };
}

/** Native tab operations stay inside an overlay-owned group, never a user's tab group. */
function createIsolatedLightboxLeaf(app: App, doc: Document, host: HTMLElement, owner = getLightboxOwnerLeaf(app, doc)): WorkspaceLeaf {
 const root = owner.getRoot();
 const container = owner.getContainer();
 // Obsidian exports WorkspaceTabs, but does not declare its workspace constructor.
 const Tabs = WorkspaceTabs as unknown as new (workspace: App['workspace']) => NativeTabs;
 const tabs = new Tabs(app.workspace);
 tabs.containerEl.addClass('operon-lightbox-tabs');
 host.appendChild(tabs.containerEl);
 let leaf: WorkspaceLeaf | null = null;
 try {
  // The isolated parent has no root attachment, so creation cannot select a user tab.
  leaf = app.workspace.createLeafInParent(tabs, -1);
  leaf.getRoot = () => root;
  leaf.getContainer = () => container;
  tabs.getRoot = () => root;
  tabs.getContainer = () => container;
  mountLightboxLeaf(leaf, tabs, doc);
  isolatedLeaves.set(leaf, { tabs, release: retainLayoutOwner(app, leaf, owner) });
  return leaf;
 } catch (error) {
  const workspace = app.workspace as NativeWorkspace;
  const stacked = workspace.lastTabGroupStacked;
  try { leaf?.detach(); }
  finally {
   workspace.lastTabGroupStacked = stacked;
   tabs.component.unload();
   tabs.containerEl.remove();
  }
  throw error;
 }
}

function releaseOwnedLightboxLeaf(leaf: WorkspaceLeaf): void {
 const isolated = isolatedLeaves.get(leaf);
 if (!isolated) return;
 isolated.release();
 isolated.tabs.component.unload();
 isolated.tabs.containerEl.remove();
 isolatedLeaves.delete(leaf);
}


function detachLightboxLeaf(app: App, detachedLeaf: WorkspaceLeaf, originalDetach = bindNativeLightboxMethod(detachedLeaf, 'detach')): void {
       const workspace = app.workspace as App['workspace'] & { lastTabGroupStacked?: boolean };
       const stacked = workspace.lastTabGroupStacked;
       const getState = bindNativeLightboxMethod(detachedLeaf, 'getViewState');
       // Native detach skips closed-tab history for empty views. Keep its normal
       // cleanup without adding this ephemeral leaf or evicting a user's history.
       detachedLeaf.getViewState = () => ({ type: 'empty' });
       try { originalDetach(); }
       finally { detachedLeaf.getViewState = getState; workspace.lastTabGroupStacked = stacked; }
}

function openNativeLightbox(app: App, anchor: HTMLElement, target: { url: string } | { file: ResolvedLightboxFile }, initial?: NativeTaskWorkspaceInitial, canOpen?: () => boolean): Promise<TaskEditorSession | null> {
 if (canOpen?.() === false) { initial?.content.destroy({ skipCloseSave: true }); return Promise.resolve(null); }
 let resolveOpened!: (handle: TaskEditorSession | null) => void;
 const opened = new Promise<TaskEditorSession | null>(resolve => { resolveOpened = resolve; });
 let companion: NativeTaskWorkspace | null = null;
 let editorDisposed = false;
 const disposeEditor = (): void => {
  if (editorDisposed) return;
  editorDisposed = true;
  if (companion) companion.dispose(); else initial?.content.destroy({ skipCloseSave: true });
 };
 const doc = getOwnerDocument(anchor);
 const openingTrace = initial?.openingTrace ?? (LIGHTBOX_PERF_ENABLED && 'file' in target && target.file.file.extension === 'md' ? beginLightboxOpeningTrace(doc, 'source') : undefined);
 if ('file' in target) openingTrace?.resource(target.file.file);
 const isFile = 'file' in target;
 let origin: WorkspaceLeaf;
 let closed = false;
 let ready = false;
 let nativeReady = false;
 let leaf: WorkspaceLeaf | null = null;
 let host: HTMLElement | null = null;
 let transition: Promise<void> = Promise.resolve();
 let closeRequested = false;
 let surface: NativeLightboxSurface | null = null;
 let poolText: string | null = null;
 let initialMode: unknown;
 const openingDefaults = isFile && target.file.file.extension === 'md' ? nativeLightboxDefaults(app) : '';
 const prepare = async (allowDiscard = false): Promise<boolean> => {
  if (companion && !await companion.prepare(allowDiscard)) return false;
  if (companion?.deleted) return true;
  if (surface && !await surface.prepare()) {
   new Notice('The last change could not be saved. This view is staying open; review the change before closing.');
   return false;
  }
  return !leaf || await flushLightboxMarkdown(app, leaf);
 };
 const openInWorkspace = async (placement: 'tab' | 'split' | 'below'): Promise<(() => void) | null> => {
    if (!ready || !leaf) return null;
    try {
     const state = leaf.getViewState();
     const ephemeral = leaf.view.getEphemeralState();
     return await prepareLightboxTab(app, doc, async destination => {
     await destination.setViewState({...state, active: false});
     await destination.loadIfDeferred();
     if (destination.view.containerEl.ownerDocument !== doc || destination.view.getViewType() !== state.type) throw new Error('Unavailable target view');
     destination.view.setEphemeralState(ephemeral);
     }, placement, origin);
    } catch {
     new Notice(placement === 'below' ? 'Could not open below the original tab. The lightbox is still open.' : placement === 'split' ? 'Could not open to the right of the original tab. The lightbox is still open.' : 'Could not open a new tab. The lightbox is still open.');
     return null;
    }
 };
 const unavailable = () => { openingTrace?.finish('error'); return new Notice(isFile ? 'Could not open this file in the lightbox. Please try again.' : t('notifications', 'webViewerUnavailable')); };
 try {
  origin = getLightboxOrigin(anchor) ?? getLightboxOwnerLeaf(app, doc);
  openAppLightbox(app, anchor, {
   originLeaf: origin,
   title: isFile ? target.file.file.name : target.url,
   showTitle: false,
   className: isFile ? 'is-native' : 'is-web',
   nativeView: true,
   onOpenInTab: () => openInWorkspace('tab'),
   onOpenToRight: () => openInWorkspace('split'),
   onOpenBelow: () => openInWorkspace('below'),
   onCloseRejected: () => companion?.focusRetainedDraft(),
   onDispose: () => { openingTrace?.finish('cancelled'); closed = true; disposeEditor(); resolveOpened(null); },
   beforeClose: (reason) => {
    if (!ready) return true;
    closeRequested = true;
    companion?.setLocked(true);
    if (host) host.inert = true;
    return (async () => {
     try {
      await transition.catch(() => undefined);
      const ok = await prepare(reason !== 'transfer');
      poolText = null;
      if (ok && reason !== 'transfer' && !companion?.deleted && !companion?.handle?.content.isEdited && nativeReady && leaf?.view.getViewType() === 'markdown') {
       const view = leaf.view as TextFileView;
       if (view.file && leaf.getViewState().state?.mode === initialMode) {
        const stored = await app.vault.read(view.file).catch(() => null);
        if (stored !== null && stored === view.getViewData()) poolText = stored;
       }
      }
      return ok;
     } catch { unavailable(); return false; }
     finally { closeRequested = false; companion?.setLocked(false); if (host) host.inert = Boolean(host.hidden); companion?.layout(); }
    })();
   },
   render: (lightbox, close) => {
    const cancelled = (): boolean => {
     if (closed) return true;
     if (canOpen?.() === false) { close(); return true; }
     return false;
    };
    const recentLeaf = app.workspace.getMostRecentLeaf();
    const previousLeaf = recentLeaf?.view.containerEl.ownerDocument === doc ? recentLeaf : null;
    // The resolved target supplies its frame before native loading can yield a paint.
    surface = new NativeLightboxSurface(lightbox, isFile ? nativeLightboxViewType(target.file.file.extension) : 'webviewer');
    host = surface.content;
    const provider = getNativeTaskWorkspaceProvider(app);
    if (provider && isFile && target.file.file.extension === 'md') {
     companion = new NativeTaskWorkspace(lightbox, host, provider, close, initial,
      target.file.operonId ? { file: target.file.file, operonId: target.file.operonId } : undefined,
      async task => {
       if (closed) return;
       if (!nativeReady) await initialize({ file: task.file, subpath: '', line: task.line, caretCh: task.caretCh });
       else if (leaf) await leaf.openFile(task.file, { active: false, eState: lightboxFileState({ ...task, subpath: '' }) });
      },
      () => { if (leaf && ready && !closed) focusLightboxSourceCaret(leaf, target.file); }, openingTrace);
     lightbox.addClass('is-workspace-loading');
    }
    host.inert = true;
    const activateOwned = (): void => {
     if (ready && !closed && leaf) app.workspace.setActiveLeaf(leaf, { focus: false });
    };
    host.addEventListener('focusin', activateOwned);
    host.addEventListener('pointerdown', activateOwned, true);
    let detachOwned: (() => void) | null = null;
    let restoreMethods: (() => void) | null = null;
    let revealFrame: number | null = null;
    let settleReveal: (() => void) | null = null;
    const mount = async (first = false): Promise<void> => {
     if (!closed && ready && leaf) {
      companion?.resetGeometryForView(leaf.view.getViewType());
      const endSurface = openingTrace?.span('surface-refresh');
      surface?.refresh();
      endSurface?.();
      const endContext = openingTrace?.span('context');
      const contextReady = companion?.refresh(leaf);
      if (endContext) void contextReady?.then(endContext, endContext);
      // A source-only view does not need task metadata to display its native body.
      if (first && !initial) void contextReady?.catch(() => { if (!closed) unavailable(); });
      else await contextReady;
      if (first && companion && !closed) {
       const endEditor = openingTrace?.span('editor-ready-wait');
       await companion.prepareInitialRender();
       endEditor?.();
       if (cancelled()) return;
       leaf.view.onResize();
       // Flush the native/compact editors' queued measurements before first paint.
       const endFrame = openingTrace?.span('frame-wait');
       await new Promise<void>(resolve => {
        settleReveal = resolve;
        revealFrame = doc.defaultView!.requestAnimationFrame(() => { revealFrame = null; settleReveal = null; resolve(); });
       });
       endFrame?.();
      }
      if (!cancelled()) lightbox.removeClass('is-workspace-loading');
     }
    };
    const observer = new ResizeObserver(() => { if (!closed) leaf?.view.onResize(); });
    observer.observe(host);
    const onPageHide = () => { clearNativeLightboxPool(app, doc); close(); };
    doc.defaultView?.addEventListener('pagehide', onPageHide);
    let initializing: Promise<void> | null = null;
    const initialize = (source = isFile ? target.file : undefined): Promise<void> => {
     if (initializing) return initializing;
     const retainingEditor = ready;
     initializing = (async () => {
     let owned: WorkspaceLeaf | null = null;
     try {
      if (!host) return;
      const endLeaf = openingTrace?.span('native-leaf');
      const pendingReuse = source?.file.extension === 'md' ? takeNativeLightboxView(app, doc, source.file) : null;
      const reused = pendingReuse ? await pendingReuse : null;
      if (cancelled()) { if (reused) { detachLightboxLeaf(app, reused); releaseOwnedLightboxLeaf(reused); } return; }
      owned = reused ?? createIsolatedLightboxLeaf(app, doc, host, origin);
      leaf = owned;
      const ownedTabs = owned.parent as NativeTabs;
      const originalDetach = bindNativeLightboxMethod(owned, 'detach');
      const originalSetViewState = bindNativeLightboxMethod(owned, 'setViewState');
      const detachedLeaf = owned;
      let detached = false;
      detachOwned = () => {
       if (detached) return;
       detached = true;
       detachLightboxLeaf(app, detachedLeaf, originalDetach);
      };
      restoreMethods = () => { if (owned) { owned.detach = originalDetach; owned.setViewState = originalSetViewState; } };
      if (!reused) openingTrace?.count('leaves');
      else {
       const isolated = isolatedLeaves.get(owned);
       if (!isolated) throw new Error('Unavailable native tab group');
       const root = origin.getRoot(), container = origin.getContainer();
       owned.getRoot = () => root; owned.getContainer = () => container;
       isolated.tabs.getRoot = () => root; isolated.tabs.getContainer = () => container;
       isolated.release = retainLayoutOwner(app, owned, origin);
       isolated.tabs.containerEl.hidden = false; isolated.tabs.containerEl.inert = false;
       host.appendChild(isolated.tabs.containerEl);
       mountLightboxLeaf(owned, ownedTabs, doc);
      }
      endLeaf?.();
      surface?.attach(app, owned);
      // Only this owned leaf is guarded; user tabs keep their normal behavior.
      owned.detach = () => close();
      owned.setViewState = (...args) => {
       const run = async (): Promise<void> => {
        if (closed || closeRequested || !owned) return;
        if (host) host.inert = true;
        companion?.setLocked(true);
        try {
         if (nativeReady && !await prepare()) return;
         if (closed) return;
         await originalSetViewState(...args);
         await mount();
        } finally {
         companion?.setLocked(false);
         if (host && !closeRequested && ready) { host.inert = Boolean(host.hidden); companion?.layout(); }
        }
       };
       transition = transition.then(run, run);
       return transition;
      };
      const endOpen = openingTrace?.span('native-open');
      if (source && reused) owned.view.setEphemeralState(lightboxFileState(source));
      else if (source) await owned.openFile(source.file, { active: false, eState: lightboxFileState(source) });
      else if (!isFile) await owned.setViewState({ type: 'webviewer', active: false, state: { url: target.url, navigate: true } });
      endOpen?.();
      if (cancelled()) return;
      const endLoad = openingTrace?.span('native-load');
      await owned.loadIfDeferred();
      endLoad?.();
      if (cancelled()) return;
      assertLightboxLeafMounted(owned, ownedTabs, doc);
      if (owned.view.getViewType() !== (isFile ? nativeLightboxViewType(target.file.file.extension) : 'webviewer')) throw new Error('Unavailable native view');
      // Keep the complete native view tree inside the isolated tab group.
      initialMode = owned.getViewState().state?.mode;
      nativeReady = true;
      ready = true;
      host.inert = false;
      await mount(!initial || initial.markdown);
      if (cancelled()) return;
      if (initial) companion?.handle?.content.applyInitialDescriptionFocus(canOpen);
      else if (isFile) focusLightboxSourceCaret(owned, target.file);
      markLightboxControlsReady(lightbox);
      openingTrace?.finish('ready');
      resolveOpened(companion?.handle ?? null);
      if (isFile && target.file.file.extension === 'base') app.workspace.setActiveLeaf(owned, { focus: false });
     } catch {
      if (closed) return;
      openingTrace?.finish('error');
      if (!retainingEditor) close();
      else {
       restoreMethods?.(); detachOwned?.();
       if (leaf) releaseOwnedLightboxLeaf(leaf);
       surface?.detach(); leaf = null; nativeReady = false;
       companion?.layout();
      }
      unavailable();
      throw new Error('Native source unavailable');
     }
     })();
     void initializing.finally(() => { initializing = null; }).catch(() => undefined);
     return initializing;
    };
    if (initial && !initial.markdown) {
     void (async () => {
      try {
       await companion?.prepareInitialRender();
       if (cancelled()) return;
       ready = true;
       lightbox.removeClass('is-workspace-loading');
       initial.content.applyInitialDescriptionFocus(canOpen);
       markLightboxControlsReady(lightbox);
      openingTrace?.finish('ready'); resolveOpened(companion?.handle ?? null);
      } catch { unavailable(); close(); }
     })();
    } else void initialize().catch(() => undefined);
    return () => {
     closed = true;
     if (revealFrame !== null) doc.defaultView!.cancelAnimationFrame(revealFrame);
     revealFrame = null; settleReveal?.(); settleReveal = null;
     disposeEditor();
     observer.disconnect();
     host?.removeEventListener('focusin', activateOwned);
     host?.removeEventListener('pointerdown', activateOwned, true);
     doc.defaultView?.removeEventListener('pagehide', onPageHide);
     const finishDispose = () => {
      restoreMethods?.();
      const workspace = app.workspace as NativeWorkspace;
      if (workspace.activeLeaf === leaf) {
       const previousStillOpen = previousLeaf && (isolatedLeaves.has(previousLeaf) || app.workspace.getLeavesOfType(previousLeaf.view.getViewType()).includes(previousLeaf));
       const next = previousStillOpen ? previousLeaf : app.workspace.getMostRecentLeaf();
       if (next) app.workspace.setActiveLeaf(next, { focus: false });
       else {
        // Native setActiveLeaf(null) is a no-op. Clear only this orphaned owned
        // context; the next native layout pass chooses a remaining/empty leaf.
        workspace.activeLeaf = null;
        app.workspace.activeEditor = null;
        workspace.activeTabGroup = null;
       }
      }
      surface?.dispose();
      if (leaf) {
       const owned = leaf, detach = detachOwned;
       const destroy = () => { try { detach?.(); } finally { releaseOwnedLightboxLeaf(owned); } };
       const isolated = isolatedLeaves.get(owned);
       if (poolText !== null && isolated && parkNativeLightboxView(app, doc, owned, poolText, openingDefaults, destroy)) {
        isolated.release(); isolated.release = () => undefined;
        isolated.tabs.containerEl.hidden = true; isolated.tabs.containerEl.inert = true;
        // Detach the native tree from the closing shell, retaining no session DOM.
        isolated.tabs.containerEl.remove();
       } else destroy();
      }
      leaf = null;
     };
     // A native open may replace its view after an await. Do not destroy the
     // leaf before that initialization settles, or the late view can leak.
     void Promise.allSettled([initializing, transition]).then(finishDispose);
    };
   },
  });
 } catch { disposeEditor(); resolveOpened(null); unavailable(); }
 return opened;
}
