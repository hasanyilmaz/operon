import type { Events, Vault } from 'obsidian';
import type { TimeTracker } from './time-tracker';

/** External file events feed the existing serialized tracker reconciliation. */
export function startActiveTrackerMonitor(
 tracker: Pick<TimeTracker, 'refreshExternalState'>,
 win: Window,
 doc: Document,
 isReady: () => boolean,
 source?: { vault: Pick<Vault, 'on' | 'offref'>; path: string },
): () => void {
 let disposed = false;
 let running = false;
 let pending = false;
 let timer: number | undefined;
 const visible = (): boolean => !disposed && !doc.hidden && isReady();
 const cancelTimer = (): void => { if (timer !== undefined) win.clearTimeout(timer); timer = undefined; };
 const schedule = (): void => {
  if (!visible() || running || timer !== undefined) return;
  timer = win.setTimeout(() => { timer = undefined; check(); }, 100);
 };
 const check = (): void => {
  if (!visible()) return;
  pending = true;
  if (running) return;
  cancelTimer();
  pending = false;
  running = true;
  void (async () => {
   try { await tracker.refreshExternalState(); }
   catch (error) { console.debug('Operon: active tracker refresh deferred', error); }
   finally { running = false; if (pending) schedule(); }
  })();
 };
 const parent = source?.path.slice(0, source.path.lastIndexOf('/'));
 // Raw is an internal Vault event exposed through the base Events interface.
 const events = source?.vault as Pick<Events, 'on' | 'offref'> | undefined;
 const ref = events?.on('raw', (path: unknown) => {
  if (disposed || typeof path !== 'string' || (path !== source?.path && path !== parent)) return;
  pending = true;
  schedule();
 });
 win.addEventListener('focus', check);
 doc.addEventListener('visibilitychange', check);
 check();
 return () => {
  disposed = true;
  pending = false;
  cancelTimer();
  if (ref) source?.vault.offref(ref);
  win.removeEventListener('focus', check);
  doc.removeEventListener('visibilitychange', check);
 };
}
