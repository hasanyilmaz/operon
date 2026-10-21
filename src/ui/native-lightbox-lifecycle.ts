import { Notice, type App, type TextFileView, type WorkspaceLeaf } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import type { OperonTableCallbacks } from './table/operon-table-view';

/** Capture the native method before replacing it, preserving its receiver and result. */
export function bindNativeLightboxMethod<Owner extends Record<Key, (...args: never[]) => unknown>, Key extends keyof Owner>(
 owner: Owner, key: Key,
): OmitThisParameter<Owner[Key]>;
export function bindNativeLightboxMethod(owner: object, key: PropertyKey): (...args: unknown[]) => unknown {
 const method: unknown = Reflect.get(owner, key);
 if (typeof method !== 'function') throw new TypeError('Native lightbox method is not callable');
 return (...args): unknown => Reflect.apply(method, owner, args);
}

/** Only owned lightbox leaves participate; ordinary tabs keep their callbacks. */
const owners = new WeakMap<WorkspaceLeaf, NativeLightboxLifecycle>();
const appLeaves = new WeakMap<App, Set<WorkspaceLeaf>>();

/** Include owned views in plugin refreshes without registering them as workspace tabs. */
export function getNativeLightboxLeaves(app: App): WorkspaceLeaf[] {
 return [...(appLeaves.get(app) ?? [])];
}
type NativeTextView = TextFileView & { saving?: boolean; dirty?: boolean; lastSavedData?: string | null };
type NativeMethod = (...args: unknown[]) => unknown;
interface BasesController {
 view?: object;
 events?: { on(name: string, callback: () => void): unknown; off(name: string, callback: () => void): void };
}

export class NativeLightboxLifecycle {
 private readonly pending = new Set<Promise<unknown>>();
 private readonly failures = new Map<string, unknown>();
 private readonly versions = new Map<string, number>();
 private sequence = 0;
 private basesView: NativeTextView | null = null;
 private basesClean = '';
 private readonly cleanup: (() => void)[] = [];
 constructor(private readonly app: App, private readonly leaf: WorkspaceLeaf) {
  owners.set(leaf, this);
  let leaves = appLeaves.get(app);
  if (!leaves) { leaves = new Set(); appLeaves.set(app, leaves); }
  leaves.add(leaf);
 }

 track<T>(key: string | (() => string), operation: () => T): T {
  const version = ++this.sequence;
  const resolveKey = () => typeof key === 'string' ? key : key();
  const complete = (value: unknown): void => {
   const identity = resolveKey();
   if ((this.versions.get(identity) ?? 0) > version) return;
   this.versions.set(identity, version);
   if (value === false || ['missing', 'conflict', 'unsupported', 'failed', 'rejected', 'failed-notified'].includes(String(value))) this.failures.set(identity, value);
   else this.failures.delete(identity);
  };
  try {
   const result = operation();
   const settled = result && typeof result === 'object' && 'settled' in result ? result.settled : result;
   if (settled && (typeof settled === 'object' || typeof settled === 'function') && 'then' in settled && typeof settled.then === 'function') {
    const watched = Promise.resolve(settled as PromiseLike<unknown>).then(value => { complete(value); }, error => {
     const identity = resolveKey();
     if ((this.versions.get(identity) ?? 0) <= version) { this.versions.set(identity, version); this.failures.set(identity, error); }
    });
    this.pending.add(watched);
    void watched.finally(() => this.pending.delete(watched));
   } else complete(settled);
   return result;
  } catch (error) { const identity = resolveKey(); if ((this.versions.get(identity) ?? 0) <= version) { this.versions.set(identity, version); this.failures.set(identity, error); } throw error; }
 }

 async settle(): Promise<boolean> {
  while (this.pending.size) await Promise.all([...this.pending]);
  return this.failures.size === 0;
 }

 attachCurrentView(): void {
  if (this.leaf.view.getViewType() !== 'bases' || this.basesView === this.leaf.view) return;
  const view = this.leaf.view as NativeTextView & { controller?: BasesController };
  if (typeof view.save !== 'function' || typeof view.getViewData !== 'function' || typeof view.setViewData !== 'function') throw new Error('Bases saving is unavailable');
  this.basesView = view;
  this.basesClean = view.getViewData();
  let clean = this.basesClean;
  let saveTimer: number | null = null;
  const cancelSave = (): void => { if (saveTimer !== null) getOwnerWindow(view.containerEl).clearTimeout(saveTimer); saveTimer = null; };
  this.cleanup.push(cancelSave);
  const originalSet = bindNativeLightboxMethod(view, 'setViewData');
  view.setViewData = (data, clear) => { cancelSave(); originalSet(data, clear); clean = view.getViewData(); if (this.basesView === view) this.basesClean = clean; };
  const originalSave = bindNativeLightboxMethod(view, 'save');
  let saves: Promise<void> = Promise.resolve();
  view.save = (clear?: boolean) => {
   cancelSave();
   return this.track('base-definition', () => {
   const save = async (): Promise<void> => {
    const deadline = Date.now() + 5000;
    while (view.saving) {
     if (Date.now() >= deadline) throw new Error('Bases save is still pending');
     await new Promise(resolve => getOwnerWindow(view.containerEl).setTimeout(resolve, 25));
    }
    const text = view.getViewData();
    // Bases serializes its query on read. Formatting differences are not edits.
    if (text === clean) { view.dirty = false; if (clear) { cancelSave(); view.clear(); } return; }
    const file = view.file;
    if (!file) throw new Error('Bases file is unavailable');
    const baseline = view.lastSavedData === undefined ? view.data : view.lastSavedData;
    const stored = await this.app.vault.read(file);
    if (view.file !== file || view.getViewData() !== text) throw new Error('Bases changed before saving');
    if (stored !== text) {
     if (stored !== baseline) throw new Error('Bases file changed outside this view');
     // Never let native save(true) clear the editor before the write succeeds.
     await originalSave(false);
     if (await this.app.vault.read(file) !== text) throw new Error('Bases save was not confirmed');
    }
    if (view.file !== file || view.getViewData() !== text) throw new Error('Bases changed during saving');
    clean = text;
    if (this.basesView === view) this.basesClean = clean;
    if (clear) { cancelSave(); view.clear(); }
   };
   saves = saves.then(save, save).catch(error => { view.dirty = true; throw error; });
   return saves;
   });
  };
  // TextFileView binds its debounce to the original save in the constructor.
  // Keep the native 2s policy but route this owned instance through its guard.
  view.requestSave = () => {
   view.dirty = true;
   cancelSave();
   const file = view.file;
   saveTimer = getOwnerWindow(view.containerEl).setTimeout(() => {
    saveTimer = null;
    if (view.file !== file) return;
    void view.save().catch(() => new Notice('The base change could not be saved. It remains open so you can review and save it again.'));
   }, 2000);
  };
  const wrapped = new WeakSet<object>();
  const attachTransactions = (): void => {
   const surface = view.controller?.view;
   if (!surface || wrapped.has(surface)) return;
   wrapped.add(surface);
   // Wrap only this native view's transaction promises, never FileManager/Vault.
   const methods = surface as Record<string, unknown>;
   let propertyScope: string | null = null;
   const updateProperty = methods.updateProperty;
   if (typeof updateProperty === 'function') {
    methods.updateProperty = (...args: unknown[]) => {
     const previous = propertyScope;
     const file = args[0] as { path?: string } | undefined;
     propertyScope = `base-rows:${JSON.stringify([`${file?.path ?? ''}:${String(args[1])}`])}`;
     try { return Reflect.apply(updateProperty, surface, args) as unknown; }
     finally { propertyScope = previous; }
    };
   }
   for (const name of ['createTransaction', 'undoTransaction', 'redoTransaction']) {
    const original = methods[name];
    if (typeof original !== 'function') continue;
    methods[name] = (...args: unknown[]) => {
     let changes: unknown[] = [];
     const targetScope = propertyScope;
     const fallback = ++this.sequence;
     const stack = methods[name === 'redoTransaction' ? 'redoStack' : 'undoStack'];
     if (name !== 'createTransaction' && Array.isArray(stack)) {
      const entry = stack[stack.length - 1] as { changes?: unknown[] } | undefined;
      changes = entry?.changes ?? [];
     }
     const invoke = [...args];
     if (name === 'createTransaction' && typeof args[0] === 'function') {
      const action = args[0] as NativeMethod;
      invoke[0] = (...values: unknown[]) => { if (Array.isArray(values[0])) changes = values[0]; return action(...values); };
     }
     const identity = () => {
      if (targetScope) return targetScope;
      const fields = changes.flatMap(item => {
       const change = item as { file?: { path?: string }; start?: Record<string, unknown>; end?: Record<string, unknown> };
       return [...new Set([...Object.keys(change.start ?? {}), ...Object.keys(change.end ?? {})])]
        .filter(key => JSON.stringify(change.start?.[key]) !== JSON.stringify(change.end?.[key]))
        .map(key => `${change.file?.path ?? ''}:${key}`);
      }).sort();
      return `base-rows:${fields.length ? JSON.stringify(fields) : fallback}`;
     };
     return this.track(identity, () => Reflect.apply(original, surface, invoke) as unknown);
    };
   }
  };
  attachTransactions();
  view.controller?.events?.on('view-changed', attachTransactions);
  this.cleanup.push(() => view.controller?.events?.off('view-changed', attachTransactions));
 }

 async prepare(): Promise<boolean> {
  await this.settle();
  // A verified native save may have completed outside a close attempt. Verify
  // recovery without retrying a failed mutation merely because Close was used.
  if (this.failures.has('base-definition') && this.basesView?.file && !this.basesView.saving) {
   const view = this.basesView, text = view.getViewData();
   try {
    if (await this.app.vault.read(view.file!) === text && view.getViewData() === text && !view.saving) {
     this.basesClean = text; this.failures.delete('base-definition');
    }
   } catch { /* The failed view stays available for an explicit retry. */ }
  }
  if (this.failures.size) return false;
  if (this.leaf.view.getViewType() === 'bases') {
   this.attachCurrentView();
   const view = this.basesView!;
   if (view.getViewData() !== this.basesClean) {
    try { await view.save(); } catch { return false; }
   }
  }
  return this.settle();
 }

 dispose(): void {
  owners.delete(this.leaf);
  const leaves = appLeaves.get(this.app);
  leaves?.delete(this.leaf);
  if (!leaves?.size) appLeaves.delete(this.app);
  for (const dispose of this.cleanup.splice(0)) dispose();
  // Owned native save wrappers remain until native unload finishes. They do not
  // affect other leaves and prevent an unchanged Base from being rewritten.
 }
}

export function trackLightboxTableCallbacks(leaf: WorkspaceLeaf, callbacks: OperonTableCallbacks): OperonTableCallbacks {
 const owner = owners.get(leaf);
 if (!owner) return callbacks;
 const tracked = { ...callbacks };
 const keys = ['onSavePresetPatch', 'onFlushPresetWrites', 'onSaveFilterSet', 'onUpdateTaskFields',
  'onUpdateGanttTaskFields', 'onCreateGanttDependency', 'onUpdateFileProperty', 'onAddTaskSession',
  'onEditTaskSession', 'onDeleteTaskSession', 'onStatusIconClick', 'onContextualAction'] as const;
 for (const key of keys) {
  const original = callbacks[key];
  if (!original) continue;
  Object.assign(tracked, { [key]: (...args: unknown[]) => {
   const target = args[0];
   const identity = typeof target === 'string' ? target : target && typeof target === 'object' && 'id' in target ? String(target.id) : '';
   const payload = args[1];
   const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
   const session = target && typeof target === 'object' ? target as Record<string, unknown> : {};
   const scope = key === 'onUpdateFileProperty' ? String(record.propertyName)
    : key === 'onUpdateTaskFields' || key === 'onUpdateGanttTaskFields' ? Object.keys(record).sort().join(',')
    : key === 'onSavePresetPatch' ? Object.keys(session).sort().join(',')
    : key === 'onEditTaskSession' || key === 'onDeleteTaskSession' ? JSON.stringify([session.operonId, session.sessionIndex, session.start, session.end])
    : key === 'onAddTaskSession' || key === 'onContextualAction' || key === 'onCreateGanttDependency' ? String(payload) : '';
   return owner.track(`${key}:${identity}:${scope}`, () => Reflect.apply(original, callbacks, args) as unknown);
  } });
 }
 return tracked;
}
