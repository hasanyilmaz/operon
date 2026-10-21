import type { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { getNativeLightboxLeaves } from './native-lightbox-lifecycle';

interface IdleView {
 leaf: WorkspaceLeaf; file: TFile; path: string; text: string; mode: string;
 defaults: string; dispose: () => void; timer: number; onPageHide: () => void; onRemove: () => void;
}
const pools = new WeakMap<App, Map<Document, IdleView[]>>();
const disabled = new WeakSet<App>();
const closedWindows = new WeakSet<Document>();
function defaults(app: App): string {
 const vault = app.vault as App['vault'] & { getConfig?: (key: string) => unknown };
 return JSON.stringify([vault.getConfig?.('defaultViewMode'), vault.getConfig?.('livePreview')]);
}
export function nativeLightboxDefaults(app: App): string { return defaults(app); }
function remove(doc: Document, entries: IdleView[], entry: IdleView, destroy: boolean): void {
 const index = entries.indexOf(entry);
 if (index >= 0) entries.splice(index, 1);
 doc.defaultView?.clearTimeout(entry.timer);
 doc.defaultView?.removeEventListener('pagehide', entry.onPageHide);
 entry.onRemove();
 if (destroy) entry.dispose();
}
export function clearNativeLightboxPool(app: App, doc?: Document): void {
 const windows = pools.get(app);
 if (!doc) disabled.add(app);
 else closedWindows.add(doc);
 if (!windows) return;
 for (const [owner, entries] of windows) if (!doc || owner === doc) {
  for (const entry of [...entries]) remove(owner, entries, entry, true);
  windows.delete(owner);
 }
}
/** Idle views are never in the active source registry. Reuse only identical saved documents. */
export function takeNativeLightboxView(app: App, doc: Document, file: TFile): Promise<WorkspaceLeaf | null> | null {
 const entries = pools.get(app)?.get(doc);
 const entry = entries?.slice().reverse().find(item => item.file === file);
 if (!entries || !entry) return null;
 remove(doc, entries, entry, false);
 return (async () => {
 try {
  const view = entry.leaf.view as MarkdownView;
  const text = await app.vault.read(file);
  const active = [...app.workspace.getLeavesOfType('markdown'), ...getNativeLightboxLeaves(app)];
  if (closedWindows.has(doc) || disabled.has(app) || file.path !== entry.path || app.vault.getAbstractFileByPath(file.path) !== file
   || text !== entry.text || view.file !== file || view.getViewType() !== 'markdown'
   || view.getViewData() !== text || defaults(app) !== entry.defaults
   || active.some(leaf => (leaf.view as MarkdownView).file === file && (leaf.view as MarkdownView).getViewData() !== text)) throw new Error('Stale idle view');
  // Native clear=true starts a new editing session, including undo history.
  view.setViewData(text, true);
  view.editor.setCursor({ line: 0, ch: 0 });
  view.currentMode.applyScroll(0);
  view.setEphemeralState({});
  if (view.getMode() !== entry.mode) throw new Error('Mode changed');
  return entry.leaf;
 } catch { entry.dispose(); return null; }
 })();
}
export function parkNativeLightboxView(app: App, doc: Document, leaf: WorkspaceLeaf, text: string, initialDefaults: string, dispose: () => void): boolean {
 const view = leaf.view as MarkdownView;
 if (closedWindows.has(doc) || disabled.has(app) || !doc.defaultView || view.getViewType() !== 'markdown' || !view.file
  || typeof view.getMode !== 'function' || typeof view.setViewData !== 'function'
  || typeof view.editor?.setCursor !== 'function' || typeof view.currentMode?.applyScroll !== 'function'
  || view.getViewData() !== text || defaults(app) !== initialDefaults) return false;
 let windows = pools.get(app);
 if (!windows) { windows = new Map(); pools.set(app, windows); }
 let entries = windows.get(doc);
 if (!entries) { entries = []; windows.set(doc, entries); }
 const entry: IdleView = { leaf, file: view.file, path: view.file.path, text, mode: view.getMode(), defaults: initialDefaults, dispose, timer: 0, onPageHide: () => clearNativeLightboxPool(app, doc),
  onRemove: () => { if (!entries.length) windows.delete(doc); } };
 const list = entries;
 entry.timer = doc.defaultView.setTimeout(() => remove(doc, list, entry, true), 5 * 60 * 1000);
 doc.defaultView.addEventListener('pagehide', entry.onPageHide);
 entries.push(entry);
 while (entries.length > 2) remove(doc, entries, entries[0], true);
 return true;
}
