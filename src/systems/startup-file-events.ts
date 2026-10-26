/** Coalesces startup discovery without reads; the owner starts draining after layout. */
export interface StartupFileEvent {
 readonly created: boolean;
 readonly modified: boolean;
 readonly forced: boolean;
}
interface PendingEvent extends StartupFileEvent { attempts: number }
export class StartupFileEvents<TTimer> {
 private pending = new Map<string, PendingEvent>();
 private active: boolean;
 private replaced = new Set<string>();
 private draining = false;
 private disposed = false;
 private timer: { handle: TTimer; resolve: () => void } | null = null;
 constructor(private readonly options: {
  enabled: boolean;
  process: (path: string, event: StartupFileEvent, isCurrent: () => boolean) => Promise<void>;
  setTimer: (callback: () => void, delayMs: number) => TTimer;
  clearTimer: (timer: TTimer) => void;
  onError?: (path: string, error: unknown) => void;
 }) { this.active = options.enabled; }
 capture(path: string, kind: 'create' | 'modify', afterLayout = false): boolean {
  if (!this.active || this.disposed) return false;
  // A change during processing goes behind other sources, including its own write echo.
  const previous = this.pending.get(path);
  this.pending.delete(path);
  this.pending.set(path, {
   created: kind === 'create' || previous?.created === true,
   modified: kind === 'modify' || previous?.modified === true,
   forced: kind === 'modify' || afterLayout || this.draining || this.replaced.has(path) || previous?.forced === true,
   attempts: 0,
  });
  return true;
 }
 rename(oldPath: string, newPath: string): void {
  if (!this.active || this.disposed || oldPath === newPath) return;
  const previous = this.pending.get(oldPath);
  this.pending.delete(oldPath);
  this.replaced.add(oldPath);
  this.capture(newPath, 'modify');
  if (previous?.created) this.capture(newPath, 'create');
 }
 delete(path: string): void {
  if (!this.active || this.disposed) return;
  this.pending.delete(path); this.replaced.add(path);
 }
 async wait(delayMs = 0): Promise<void> {
  if (this.disposed) return;
  await new Promise<void>(resolve => {
   const handle = this.options.setTimer(() => { this.timer = null; resolve(); }, delayMs);
   this.timer = { handle, resolve };
  });
 }
 /** Remain subscribed through index reconciliation, including events arriving during its awaits.
  * A failed source stays queued: later sources can run, and readiness waits for a successful retry.
  */
 async drain(initialCandidates: ReadonlySet<string>, reconcile: () => Promise<void> = async () => {}): Promise<void> {
  if (!this.active || this.disposed) return;
  if (this.draining) throw new Error('Startup file events are already draining');
  this.draining = true;
  let processed = 0;
  try {
   while (!this.disposed) {
    if (!this.pending.size) {
     try { await reconcile(); }
     catch (error) {
      this.options.onError?.('', error);
      await this.wait(1_000);
      continue;
     }
     if (!this.pending.size) break;
    }
    const [path, event] = this.pending.entries().next().value as [string, PendingEvent];
    const isCurrent = () => !this.disposed && this.pending.get(path) === event;
    if (!event.forced && !initialCandidates.has(path)) { this.pending.delete(path); continue; }
    try {
     await this.options.process(path, event, isCurrent);
     if (isCurrent()) this.pending.delete(path);
    } catch (error) {
     if (isCurrent()) {
      if (event.attempts++ === 0) this.options.onError?.(path, error);
      this.pending.delete(path); this.pending.set(path, event);
      await this.wait(Math.min(1_000, event.attempts * 100));
     }
    }
    if (++processed % 32 === 0) await this.wait();
   }
   if (!this.disposed) { this.active = false; this.replaced.clear(); }
  } finally { this.draining = false; }
 }
 destroy(): void {
  this.disposed = true;
  this.active = false;
  this.pending.clear();
  this.replaced.clear();
  if (this.timer) { this.options.clearTimer(this.timer.handle); this.timer.resolve(); this.timer = null; }
 }
}
