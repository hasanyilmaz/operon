import { TFile, type App } from 'obsidian';
import type { TaskWriter } from '../core/task-writer';
import { setWindowTimeout } from '../core/dom-compat';
import type { TaskMarkdownSource } from '../core/task-markdown-source';
import { WriteQueue } from '../storage/write-queue';
import { readExcalidrawCardReference, type ExcalidrawTaskView } from './excalidraw-task-bridge';

export class ExcalidrawSourceError extends Error {}
export interface ExcalidrawMarkdownSections {
 bodyEnd: number; dataStart: number; imagesStart: number | null;
 headings: { offset: number; end: number; text: string }[];
}
/** The technical suffix is opaque. Only headings outside YAML, fences and comments count. */
export function readExcalidrawMarkdownSections(source: string): ExcalidrawMarkdownSections {
 const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
 let offset = 0, yaml = false, fence = '', comment = '', commentStart = -1, commentEmpty = false;
 let bodyEnd = -1, imagesStart: number | null = null;
 const headings: ExcalidrawMarkdownSections['headings'] = [];
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i], line = raw.replace(/\r?\n$/, '');
  if (i === 0 && line.replace(/^\uFEFF/, '') === '---') yaml = true;
  else if (yaml) { if (line === '---' || line === '...') yaml = false; }
  else if (fence) { if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(line)) fence = ''; }
  else if (!comment && /^ {0,3}(`{3,}|~{3,})/.test(line)) fence = line.trim().match(/^(`+|~+)/)![0];
  else {
   if (line === '# Excalidraw Data' && (!comment || comment === '%%' && commentEmpty)) {
    const dataStart = comment ? commentStart : offset;
    if (/^# Excalidraw Data\r?$/m.test(source.slice(offset + raw.length))) throw new ExcalidrawSourceError('The drawing has more than one Excalidraw Data boundary. The operation was stopped.');
    return { bodyEnd: bodyEnd < 0 ? dataStart : bodyEnd, dataStart, imagesStart, headings };
   }
   if (!comment && !/%%|<!--/.test(line)) {
    if (line === '# Markdown Images' && imagesStart === null) imagesStart = offset;
    if (/^# (?:Markdown Images|Operon task [a-z0-9]{7})$/.test(line) && bodyEnd < 0) bodyEnd = offset;
    const heading = /^ {0,3}#{1,6} +(.+?) *#* *$/.exec(line);
    if (heading && bodyEnd < 0) headings.push({ offset, end: offset + raw.length, text: heading[1] });
   }
   if (comment && line.trim()) commentEmpty = false;
   for (const match of line.matchAll(/<!--|-->|%%/g)) {
    const token = match[0];
    if (comment === 'html' && token === '-->' || comment === '%%' && token === '%%') comment = '';
    else if (!comment && token !== '-->') { comment = token === '<!--' ? 'html' : '%%'; commentStart = offset + match.index; commentEmpty = line.trim() === '%%'; }
   }
  }
  offset += raw.length;
 }
 throw new ExcalidrawSourceError('The drawing Markdown boundary could not be identified. The operation was stopped.');
}
export function insertExcalidrawInlineTask(source: string, heading: string, taskLine: string): { content: string; insertedLineNumber: number } {
 const sections = readExcalidrawMarkdownSections(source);
 const keyword = heading.replace(/^#{1,6}\s+/, '').trim();
 if (!keyword || /[\r\n]/.test(keyword)) throw new ExcalidrawSourceError('The task heading is invalid.');
 const match = sections.headings.find(item => item.text.toLowerCase().includes(keyword.toLowerCase()));
 const newline = source.includes('\r\n') ? '\r\n' : '\n';
 const at = match?.end ?? sections.bodyEnd;
 const prefix = match ? '' : `${at > 0 && source[at - 1] !== '\n' ? newline : ''}${newline}## ${keyword}${newline}`;
 return { content: source.slice(0, at) + prefix + taskLine + newline + (match ? '' : newline) + source.slice(at),
  insertedLineNumber: (source.slice(0, at) + prefix).split('\n').length - 1 };
}

const queues = new WeakMap<App, WriteQueue>();
export function serializeExcalidrawSource<T>(app: App, file: TFile, operation: () => Promise<T>): Promise<T> {
 let queue = queues.get(app);
 if (!queue) { queue = new WriteQueue(); queues.set(app, queue); }
 return queue.enqueue(file.path, operation);
}
type NativeSourceView = ExcalidrawTaskView & {
 excalidrawAPI: ExcalidrawTaskView['excalidrawAPI'] & {
  updateScene?(update: { appState: { activeEmbeddable: null }; captureUpdate: 'NEVER' }): void;
 };
 isSynchronizing: boolean;
 preparedSaveText: string;
 lastSavedData: string;
 isSameFileEditingActive(): boolean;
 saveCoordinator: { isSaveInProgress: boolean };
 acquireSynchronization(path: string): Promise<boolean>;
 withPersistenceWriteLease<T>(path: string, operation: () => Promise<T>): Promise<T>;
};
export interface InlineMarkdownSource extends TaskMarkdownSource {
 readonly attempted: boolean;
 runExclusive<T>(operation: () => Promise<T>): Promise<T>;
 assertCurrent(): void;
 dispose(): void;
}
/** Coordinate Markdown-only CAS with native save preparation as well as native disk persistence.
 * Scene JSON is never generated here. Pending scene edits stay in the native scene and the next
 * native save uses the updated Markdown buffer. No tentative text is installed before persistence.
 */
export function createExcalidrawMarkdownSource(app: App, view: ExcalidrawTaskView, allowed: () => boolean): InlineMarkdownSource {
 const file = view.file, path = file?.path;
 if (!file || !path) throw new ExcalidrawSourceError('The drawing is no longer available.');
 let disposed = false, attempted = false;
 let failure: Error | null = null;
 let leasedViews: NativeSourceView[] | null = null;

 const current = () => !disposed && allowed() && view.excalidrawAPI.getAppState().viewModeEnabled === false && view.file === file && file.path === path && app.vault.getAbstractFileByPath(path) === file;
 const check = () => { if (failure) throw failure; if (!current()) throw new ExcalidrawSourceError('The drawing changed or became read-only. The operation was stopped.'); };
 const peers = (): NativeSourceView[] => app.workspace.getLeavesOfType('excalidraw')
  .map(leaf => leaf.view as unknown as NativeSourceView).filter(peer => peer.file === file);
 const acquire = <T>(operation: (views: NativeSourceView[]) => Promise<T>): Promise<T> => serializeExcalidrawSource(app, file, async () => {
  check(); const views = peers(), owned: NativeSourceView[] = [];
  if (!views.includes(view as NativeSourceView) || views.some(peer => peer.plugin !== view.plugin
   || typeof peer.acquireSynchronization !== 'function' || typeof peer.withPersistenceWriteLease !== 'function'
   || typeof peer.preparedSaveText !== 'string' || typeof peer.isSynchronizing !== 'boolean'
   || typeof peer.isSameFileEditingActive !== 'function' || typeof peer.saveCoordinator?.isSaveInProgress !== 'boolean')) {
   throw new ExcalidrawSourceError('This Excalidraw version cannot safely update tasks in an open drawing.');
  }
  try {
   for (const peer of views) {
    check();
    if (peer.file !== file || !peers().includes(peer)) throw new ExcalidrawSourceError('The open drawing views changed. Please try again.');
    // Native acquireSynchronization has an unbounded wait. Enter it only while idle,
    // in the same JavaScript turn in which it takes ownership; no late lock acquisition.
    // Native Excalidraw also holds its edit gate for an active read-only same-file
    // embed. End only a verified Operon card interaction through the native API;
    // never clear the edit gate ourselves or dismiss an actual Markdown editor.
    const active = peer.excalidrawAPI.getAppState().activeEmbeddable;
    if (peer.isSameFileEditingActive() && active?.state === 'active') {
     const element = peer.excalidrawAPI.getSceneElements().find(item => item.id === active.element.id);
     const props = element && (element as typeof element & { customData?: { mdProps?: { lockedReadingMode?: boolean } } }).customData?.mdProps;
     if (element && props?.lockedReadingMode === true && readExcalidrawCardReference(app, peer, element)) {
      peer.excalidrawAPI.updateScene?.({ appState: { activeEmbeddable: null }, captureUpdate: 'NEVER' });
     }
    }
    let waits = 0;
    while (peer.isSynchronizing || peer.saveCoordinator.isSaveInProgress || peer.isSameFileEditingActive()) {
     check();
     if (peer.file !== file || ++waits > 60) throw new ExcalidrawSourceError(peer.isSameFileEditingActive()
      ? 'Finish editing the drawing Markdown or embedded text before changing this task.'
      : 'The drawing is busy saving. Wait for it to finish, then try again.');
     await new Promise<void>(resolve => setWindowTimeout(resolve, 50));
    }
    check();
    if (!await peer.acquireSynchronization(path)) throw new ExcalidrawSourceError('The drawing closed during synchronization.');
    owned.push(peer); check();
   }
   return await (view as NativeSourceView).withPersistenceWriteLease(path, async () => {
    check(); const live = peers();
    if (live.length !== views.length || live.some(peer => !views.includes(peer))) throw new ExcalidrawSourceError('The open drawing views changed. Please try again.');
    return operation(views);
   });
  } finally { for (const peer of owned) peer.isSynchronizing = false; }
 });
 // One conversion owns the native save boundary through target creation, source
 // replacement and verification. Its individual writer calls reuse that lease.
 const transaction = async <T>(operation: (views: NativeSourceView[]) => Promise<T>): Promise<T> => {
  check();
  if (!leasedViews) return acquire(operation);
  const live = peers();
  if (live.length !== leasedViews.length || live.some(peer => !leasedViews!.includes(peer))) {
   return Promise.reject(new ExcalidrawSourceError('The open drawing views changed. Please try again.'));
  }
  return operation(leasedViews);
 };
 const adopt = (views: NativeSourceView[], content: string) => {
  for (const peer of views) if (peer.file === file && file.path === path) {
   peer.data = content; peer.preparedSaveText = content; peer.lastSavedData = content;
  }
 };
 return {
  file, get attempted() { return attempted; }, assertCurrent: check, dispose() { disposed = true; },
  runExclusive: operation => acquire(async views => {
   leasedViews = views;
   try { return await operation(); }
   finally { leasedViews = null; }
  }),
  read: () => transaction(async views => {
   const source = await app.vault.read(file); check(); readExcalidrawMarkdownSections(source);
   if (views.some(peer => peer.data !== source)) throw new ExcalidrawSourceError('The drawing has unsynchronized Markdown changes. Wait for synchronization before changing the task.');
   return source;
  }),
  write: (expected, next, canCommit) => transaction(async views => {
   const checkWrite = () => { check(); if (canCommit?.() === false) throw new ExcalidrawSourceError('The task or its parent changed before saving. No task was written.'); };
   checkWrite(); const before = readExcalidrawMarkdownSections(expected), after = readExcalidrawMarkdownSections(next);
   if (expected.slice(before.bodyEnd) !== next.slice(after.bodyEnd)) throw new ExcalidrawSourceError('The task update would change drawing data. The operation was stopped.');
   if (views.some(peer => peer.data !== expected)) throw new ExcalidrawSourceError('The drawing source changed before saving.');
   try {
    const saved = await app.vault.process(file, content => {
     checkWrite(); const live = peers();
     if (live.length !== views.length || live.some(peer => !views.includes(peer)) || content !== expected
      || views.some(peer => peer.file !== file || peer.data !== expected)) throw new ExcalidrawSourceError('The drawing source changed before saving.');
     attempted = true;
     return next;
    });
    if (saved !== next) throw new ExcalidrawSourceError('The drawing write could not be verified.');
    adopt(views, saved); check(); return saved;
   } catch (error) {
    // Read-only reconciliation, never replay a possibly committed write. This also
    // protects a CAS conflict from a subsequent native save of the stale header.
    try { const saved = await app.vault.read(file); readExcalidrawMarkdownSections(saved); adopt(views, saved); }
    catch {
     for (const peer of views) guardUnknownDrawingWrite(app, peer, file, path);
     throw new ExcalidrawSourceError('The drawing save result is unknown. Reopen the drawing before making further changes; do not repeat the task operation.');
    }
    throw error;
   }
  }).catch(error => { failure = error instanceof Error ? error : new Error(String(error)); throw failure; }),
 };
}

/** If even the post-write read failed, block one native persistence attempt until its
 * header can be reconciled. A canceled save is never replayed. The guard removes itself
 * on recovery or on a different file and does not hold synchronization across user input.
 */
function guardUnknownDrawingWrite(app: App, view: NativeSourceView, file: TFile, path: string): void {
 const original = Reflect.get(view, 'withPersistenceWriteLease');
 const descriptor = Object.getOwnPropertyDescriptor(view, 'withPersistenceWriteLease');
 let recovered = false;
 const restore = () => {
  recovered = true;
  if (view.withPersistenceWriteLease !== guarded) return;
  if (descriptor) Object.defineProperty(view, 'withPersistenceWriteLease', descriptor);
  else Reflect.deleteProperty(view, 'withPersistenceWriteLease');
 };
 const guarded = <T>(target: string, operation: () => Promise<T>): Promise<T> => {
  if (recovered || target !== path) {
   restore(); return original.call(view, target, operation) as Promise<T>;
  }
  if (view.file !== file || file.path !== path) { restore(); return Promise.reject(new ExcalidrawSourceError('A stale save for the previous drawing was canceled.')); }
  return original.call(view, target, async () => {
   const saved = await app.vault.read(file);
   readExcalidrawMarkdownSections(saved);
   if (view.file !== file || file.path !== path) throw new ExcalidrawSourceError('The drawing changed during save recovery.');
   view.data = saved; view.preparedSaveText = saved; view.lastSavedData = saved;
   restore();
   throw new ExcalidrawSourceError('Drawing Markdown was recovered. The unverified save was canceled.');
  }) as Promise<T>;
 };
 view.withPersistenceWriteLease = guarded;
}

/** One compound operation, with native sources locked in stable path order.
 * The caller owns the writer mutation permit; selections and confirmations precede this session. */
export async function withExcalidrawMarkdownSources<T>(
 app: App, writer: TaskWriter, paths: readonly string[], isDrawing: (file: TFile) => boolean,
 allowed: () => boolean, operation: (current: () => boolean) => Promise<T>,
 ownedSources: readonly InlineMarkdownSource[] = [],
): Promise<T> {
 const sources: InlineMarkdownSource[] = [], created: InlineMarkdownSource[] = [];
 const captured = [...new Set(paths)].sort().flatMap(path => {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || !isDrawing(file)) return [];
  const views = app.workspace.getLeavesOfType('excalidraw').map(leaf => leaf.view as unknown as ExcalidrawTaskView).filter(view => view.file === file);
  return [{ path, file, view: views[0] }];
 });
 const current = () => allowed() && captured.every(({ path, file, view }) => file.path === path
  && app.vault.getAbstractFileByPath(path) === file
  && (view ? app.workspace.getLeavesOfType('excalidraw').some(leaf => (leaf.view as unknown) === view && view.file === file)
   : !app.workspace.getLeavesOfType('excalidraw').some(leaf => (leaf.view as unknown as ExcalidrawTaskView).file === file)));
 try {
  for (const { file, view } of captured) {
   const owned = ownedSources.find(source => source.file === file && writer.isMarkdownSourceOwner(source));
   if (writer.hasMarkdownSource(file) && !owned) throw new ExcalidrawSourceError('Another task operation in this drawing is still finishing.');
   if (view) {
    const source = owned ?? createExcalidrawMarkdownSource(app, view, current);
    sources.push(source); if (!owned) created.push(source);
   }
  }
  const lock = async (index: number): Promise<T> => {
   if (!current()) throw new ExcalidrawSourceError('The task source changed during the operation.');
   if (index < sources.length) return sources[index].runExclusive(() => lock(index + 1));
   for (const source of sources) await source.read();
   return operation(() => {
    if (!current()) return false;
    try { for (const source of sources) source.assertCurrent(); return true; } catch { return false; }
   });
  };
  return await writer.withMarkdownSources(created, () => lock(0));
 } finally { for (const source of created) source.dispose(); }
}

/** Native autosave can update scene data after the task preview. Rebase only
 * that opaque suffix; any Markdown/task edit remains a real source conflict. */
export function rebaseExcalidrawTaskSource(expected: string, next: string, current: string): string {
 const before = readExcalidrawMarkdownSections(expected), after = readExcalidrawMarkdownSections(next), live = readExcalidrawMarkdownSections(current);
 if (expected.slice(0, before.bodyEnd) !== current.slice(0, live.bodyEnd)
  || expected.slice(before.bodyEnd) !== next.slice(after.bodyEnd)) throw new ExcalidrawSourceError('The task Markdown changed during the operation.');
 return next.slice(0, after.bodyEnd) + current.slice(live.bodyEnd);
}
