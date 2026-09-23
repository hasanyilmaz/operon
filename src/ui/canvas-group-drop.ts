import { Component, Notice, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { parseOperonGroupRule, smallestOperonGroupAtCenter, type GroupRectangle, type GroupRuleResult } from '../core/canvas-group-rule';
import type { CanvasGroupTaskBridge, PropertyPoolTaskPlan } from '../core/property-pool-task-operation';
import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvas, TaskCanvasView } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { CanvasSavePreflightError } from './canvas-group-save';
import { isCanvasGroupEditing } from './canvas-groups';
import { showOperonPointerTooltip } from './operon-hover-tooltip';

export interface NativeGroupDrag {
 move?(event: PointerEvent): void;
 end?(event: PointerEvent): void;
 cancel?(): void;
 cleanup?(): void;
 keydown?(event: KeyboardEvent): void;
 keyup?(event: KeyboardEvent): void;
}
const pendingSources = new WeakMap<CanvasGroupTaskBridge, Set<string>>();

interface MovingNode extends CanvasTaskNode { moveTo(point: { x: number; y: number }): void }
interface DragCanvas extends TaskCanvas {
 handleSelectionDrag(event: PointerEvent, element?: HTMLElement, node?: CanvasTaskNode): NativeGroupDrag | undefined;
}
interface Target { node: CanvasTaskNode; label: string; rect: GroupRectangle; rule: GroupRuleResult }
interface Preview { target: Target; key: string; plan: PropertyPoolTaskPlan | null }
function rectangle(node: CanvasTaskNode): GroupRectangle | null {
 const data = node.getData();
 const { x, y, width, height } = data;
 return [x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value)) && Number(width) > 0 && Number(height) > 0
  ? { id: node.id, x: Number(x), y: Number(y), width: Number(width), height: Number(height) } : null;
}

/** Observes native movement; only an admitted single-card entry takes ownership of its final save. */
export class CanvasGroupDrop extends Component {
 private active = false;
 private revision = 0;
 private rules = new WeakMap<CanvasTaskNode, { label: string; settings: string; rule: GroupRuleResult }>();
 private cancelDrag: (() => void) | null = null;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private history: CanvasTaskHistory, private bridge: CanvasGroupTaskBridge) { super(); }
 onload(): void {
  const canvas = this.view.canvas as DragCanvas;
  if (!this.history.supported || typeof canvas.handleSelectionDrag !== 'function') return;
  this.active = true;
  const original = Reflect.get(canvas, 'handleSelectionDrag'), descriptor = Object.getOwnPropertyDescriptor(canvas, 'handleSelectionDrag');
  const wrapper: DragCanvas['handleSelectionDrag'] = (event, element, requested) => {
   if (this.history.isInputBusy) return;
   const selected = requested && !canvas.selection?.has(requested) ? [requested] : [...canvas.selection ?? []] as CanvasTaskNode[];
   const pending = pendingSources.get(this.bridge);
   if (pending?.size && selected.some(item => {
    if (typeof item.getData !== 'function') return false;
    const id = canvasRelationTaskId(item); if (id && pending.has(id)) return true;
    if (item.getData().type !== 'group') return false;
    const group = rectangle(item); if (!group) return false;
    return [...canvas.nodes.values()].some(node => {
     const task = canvasRelationTaskId(node), card = task && pending.has(task) ? rectangle(node) : null;
     return !!card && card.x < group.x + group.width && card.x + card.width > group.x && card.y < group.y + group.height && card.y + card.height > group.y;
    });
   })) return;
   this.cancelDrag?.();
   canvas.requestPushHistory.run();
   const native = Reflect.apply(original, canvas, [event, element, requested]);
   const selection = [...(canvas.selection ?? [])];
   const node = selection.length === 1 ? selection[0] as MovingNode : null;
   if (!native || !node || !this.active || canvas.readonly || !canvasRelationTaskId(node) || typeof node.moveTo !== 'function'
    || event.isPrimary === false || (event.button !== 0 && !(event.pointerType === 'touch' && event.buttons === 1)) || event.altKey || event.ctrlKey || event.metaKey) return native;
   return this.observe(native, node, event);
  };
  canvas.handleSelectionDrag = wrapper;
  this.register(() => { if (canvas.handleSelectionDrag !== wrapper) return; if (descriptor) Object.defineProperty(canvas, 'handleSelectionDrag', descriptor); else Reflect.deleteProperty(canvas, 'handleSelectionDrag'); });
  this.register(this.owner.deps.cards.onRefresh(() => { this.revision++; }));
 }
 private current(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.canvas === this.history.canvas; }
 private settingsKey(): string {
  const settings = this.owner.deps.cards.deps.getSettings();
  return JSON.stringify([settings.keyMappings, settings.pipelines, settings.priorities, settings.colorPalette]);
 }
 private target(node: CanvasTaskNode): Target | null {
  const card = rectangle(node); if (!card) return null;
  const settings = this.owner.deps.cards.deps.getSettings(), settingsKey = this.settingsKey(), groups: Target[] = [];
  const x = card.x + card.width / 2, y = card.y + card.height / 2;
  for (const candidate of this.view.canvas.nodes.values()) {
   const data = candidate.getData();
   if (data.type !== 'group' || typeof data.label !== 'string' || isCanvasGroupEditing(candidate)) continue;
   const rect = rectangle(candidate); if (!rect) continue;
   if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) continue;
   let cached = this.rules.get(candidate);
   if (!cached || cached.label !== data.label || cached.settings !== settingsKey) {
    cached = { label: data.label, settings: settingsKey, rule: parseOperonGroupRule(data.label, settings, { iconExists: name => !!getIcon(name) }) };
    this.rules.set(candidate, cached);
   }
   const rule = cached.rule;
   if (rule.state === 'valid') groups.push({ node: candidate, label: data.label, rect, rule });
  }
  const id = smallestOperonGroupAtCenter(card, groups.map(group => ({ ...group.rect, rule: group.rule })));
  return groups.find(group => group.node.id === id) ?? null;
 }
 private key(target: Target, preview = true): string { return JSON.stringify([target.rect, target.label, this.settingsKey(), ...(preview ? [this.revision] : [])]); }
 private notice(key = 'canvasGroupDropBlocked'): void { new Notice(t('notifications', key)); }
 private async savePlacement(ownsView: () => boolean): Promise<void> {
  if (!ownsView()) return;
  // Request hooks may fail independently of the native writer. Attempt the
  // explicit save once; only its failure warrants a save-failed notice.
  try { this.view.canvas.requestSave(false); }
  catch (error) { console.warn('Operon: Canvas placement save request failed', error); }
  if (!ownsView()) return;
  try { await this.view.save(); }
  catch (error) {
   if (error instanceof CanvasSavePreflightError || !ownsView()) return;
   console.error('Operon: Canvas placement save failed', error);
   this.notice('canvasGroupSaveFailed');
  }
 }

 /** Native/Advanced Canvas end callbacks may save through either facade. Defer only this synchronous finalization. */
 private deferNativeSave(run: () => void): void {
  const canvas = this.view.canvas, view = this.view as TaskCanvasView & { requestSave?: () => void };
  const restores: (() => void)[] = [];
  const suspend = (target: object, key: string) => {
   const original: unknown = Reflect.get(target, key); if (typeof original !== 'function') return;
   const descriptor = Object.getOwnPropertyDescriptor(target, key), noop = () => {};
   Reflect.set(target, key, noop);
   restores.push(() => { if (Reflect.get(target, key) !== noop) return; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
  };
  suspend(canvas, 'requestSave'); suspend(canvas, 'pushHistory'); suspend(view, 'requestSave');
  try { run(); } finally { for (const restore of restores.reverse()) restore(); }
 }
 private observe(native: NativeGroupDrag, node: MovingNode, event: PointerEvent): NativeGroupDrag {
  const canvas = this.view.canvas, file = this.view.file, path = file?.path, id = canvasRelationTaskId(node)!;
  const ownsView = () => this.current() && this.view.canvas === canvas && this.view.file === file && file?.path === path;
  const start = rectangle(node); if (!start || !path) return native;
  if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
  const startGroup = this.target(node)?.node.id;
  const doc = this.view.contentEl.ownerDocument, win = getOwnerWindow(this.view.contentEl);
  let preview: Preview | null = null, tooltip: ReturnType<typeof showOperonPointerTooltip> | null = null;
  let finished = false, cleaned = false, pending = false, abandoned = false, copied = false, nativeCleaned = false, frame = 0;
  let last = start;
  const disposers: (() => void)[] = [];
  const listen = (host: EventTarget, name: string, fn: EventListener) => { host.addEventListener(name, fn, true); disposers.push(() => host.removeEventListener(name, fn, true)); };
  const valid = () => !abandoned && this.current() && this.view.file === file && file.path === path && !canvas.readonly
   && canvas.nodes.get(node.id) === node && canvasRelationTaskId(node) === id && canvas.selection?.size === 1 && canvas.selection.has(node);
  const clear = () => { preview?.target.node.nodeEl.classList.remove('operon-canvas-group-drop-target'); tooltip?.close(); tooltip = null; preview = null; };
  const cleanupNative = () => {
   if (nativeCleaned) return; nativeCleaned = true;
   if (preview || pending || abandoned) this.deferNativeSave(() => native.cleanup?.()); else native.cleanup?.();
  };
  const detachGesture = () => {
   win.cancelAnimationFrame(frame); for (const dispose of disposers.splice(0)) dispose(); clear();
   if (this.cancelDrag === cancel) this.cancelDrag = null;
  };
  const cleanup = () => {
   if (cleaned) return; cleaned = true;
   try { cleanupNative(); } catch { this.notice('canvasGroupDropPartial'); }
   detachGesture();
  };
  const restorePosition = () => {
   if (!ownsView()) return;
   const current = rectangle(node);
   if (canvas.nodes.get(node.id) === node && current?.x === last.x && current.y === last.y) {
    try { this.deferNativeSave(() => node.moveTo({ x: start.x, y: start.y })); }
    catch { this.notice('canvasGroupDropPartial'); return; }
    node.nodeEl.classList.remove('is-dragging');
    void this.savePlacement(ownsView);
   }
  };
  const cancel = () => {
   abandoned = true;
   if (pending) { clear(); return; }
   if (finished) return; finished = true;
   // Restore this card only; a stale full Canvas snapshot must never erase another edit.
   restorePosition(); cleanup();
  };
  const update = () => {
   if (finished || copied) return;
   if (!valid()) { cancel(); return; }
   const target = this.target(node);
   if (!target || target.node.id === startGroup) { clear(); return; }
   const key = this.key(target);
   if (preview?.key !== key) {
    clear(); let plan: PropertyPoolTaskPlan | null = null;
    try { plan = this.bridge.prepare(id, target.label, path); } catch { /* An unavailable preview cannot authorize a write. */ }
    preview = { target, key, plan };
    target.node.nodeEl.classList.add('operon-canvas-group-drop-target');
    const reason = plan?.reason;
    const content = !plan ? t('settings', 'propertyPoolValueUnavailable') : reason === 'already-present' ? t('settings', 'propertyPoolAlreadyPresent')
     : reason === 'workflow' ? t('settings', 'propertyPoolWorkflowBlocked') : reason ? t('settings', 'propertyPoolValueUnavailable') : plan.label;
    tooltip = showOperonPointerTooltip(node.nodeEl, { title: target.label, content, taskColor: null, preferredVertical: 'above', floatingHorizontalBoundary: this.view.contentEl, constrainToVisualViewport: true });
   }
   tooltip?.position();
  };
  const animate = () => { if (finished) return; update(); if (!finished) frame = win.requestAnimationFrame(animate); };
  const matches = (captured: Preview) => { const current = this.target(node); return valid() && !!current && current.node === captured.target.node && this.key(current) === captured.key; };
  const settle = async (captured: Preview, release: () => void, baseline: unknown, after: unknown, targetKey: string) => {
   // Native cleanup finishes synchronously; later selection and unrelated edits do not own this drop.
   await Promise.resolve();
   const allowed = () => {
    const currentNode = canvas.nodes.get(node.id), currentRect = currentNode && rectangle(currentNode);
    if (abandoned || !this.current() || this.view.file !== file || file.path !== path || canvas.readonly || !currentNode
     || canvasRelationTaskId(currentNode) !== id || !currentRect || currentRect.x !== last.x || currentRect.y !== last.y
     || currentRect.width !== last.width || currentRect.height !== last.height) return false;
    const target = this.target(currentNode);
    return !!target && target.node.id === captured.target.node.id && this.key(target, false) === targetKey;
   };
   const rollback = () => {
    if (!ownsView()) return;
    const live = canvas.nodes.get(node.id) as MovingNode | undefined, rect = live && rectangle(live);
    if (live && rect?.x === last.x && rect.y === last.y && canvasRelationTaskId(live) === id) {
     this.deferNativeSave(() => live.moveTo({ x: start.x, y: start.y }));
    }
    if (!this.history.rollbackCanvasMove(baseline, after, node.id, start, last)) this.notice('canvasGroupDropPartial');
    canvas.requestSave(false);
   };
   let applying = false;
   try {
    const plan = captured.plan;
    if (!plan || plan.reason && plan.reason !== 'already-present' || !allowed()) { rollback(); this.notice(); return; }
    if (plan.reason === 'already-present') {
     const fresh = this.bridge.prepare(id, captured.target.label, path);
     if (!fresh || JSON.stringify(fresh) !== JSON.stringify(plan) || !allowed()) { rollback(); this.notice(); return; }
    }
    applying = true;
    const result = await this.bridge.apply(plan, 'drop', allowed);
    if (result.status !== 'committed' && !result.uncertain && !(plan.reason === 'already-present' && result.status === 'unchanged')) { rollback(); this.notice(); return; }
    if (result.uncertain) this.notice('canvasGroupDropPartial');
    if (result.warning) new Notice(t('settings', 'propertyPoolRefreshWarning'));
    if (!ownsView()) return;
    const recorded = this.history.recordCanvasChange(baseline, async (direction, canTravel) => {
     const result = await this.bridge.apply(plan, direction, () => this.current() && !canvas.readonly && this.view.file === file && file.path === path && canTravel());
     if (result.status !== 'committed') new Notice(t('settings', 'propertyPoolDropFailed')); else if (result.warning) new Notice(t('settings', 'propertyPoolRefreshWarning'));
     return result.status === 'committed';
    }, plan.reason === 'already-present', after);
    if (!recorded) this.notice('canvasGroupDropPartial');
    await this.savePlacement(ownsView);
   } catch (error) { if (!applying) rollback(); console.error('Operon: group drop failed', error); this.notice('canvasGroupDropPartial'); }
   finally { pending = false; cleanup(); release(); }
  };
  this.cancelDrag = cancel;
  listen(doc, 'keydown', e => { if ((e as KeyboardEvent).key === 'Escape') { e.preventDefault(); cancel(); } });
  listen(doc, 'pointerdown', e => { if ((e as PointerEvent).pointerId !== event.pointerId) cancel(); });
  listen(doc, 'pointercancel', cancel);
  listen(doc, 'visibilitychange', () => { if (doc.visibilityState !== 'visible') cancel(); });
  listen(win, 'blur', cancel);
  frame = win.requestAnimationFrame(animate);
  return {
   ...native,
   move: next => {
    if (finished) return;
    copied ||= next.altKey || next.ctrlKey || next.metaKey;
    native.move?.(next); last = rectangle(node) ?? last;
    if (copied) clear(); else update();
   },
   keydown: next => { if (!finished) { copied ||= next.altKey || next.ctrlKey || next.metaKey; native.keydown?.(next); last = rectangle(node) ?? last; if (copied) clear(); } },
   keyup: next => { if (!finished) { native.keyup?.(next); last = rectangle(node) ?? last; } },
   end: next => {
    if (finished) return;
    finished = true; win.cancelAnimationFrame(frame);
    const captured = preview;
    if (copied || !captured || last.x === start.x && last.y === start.y) { try { native.end?.(next); } finally { cleanup(); } return; }
    pending = true;
    const sources = pendingSources.get(this.bridge) ?? new Set<string>(); pendingSources.set(this.bridge, sources); sources.add(id);
    const releaseHistory = this.history.reserveTask(id);
    const release = () => { sources.delete(id); releaseHistory(); };
    const baseline = canvas.history.data[canvas.history.current ?? -1];
    const admitted = matches(captured), targetKey = this.key(captured.target, false);
    try { this.deferNativeSave(() => { native.end?.(next); cleanupNative(); }); }
    catch { pending = false; restorePosition(); cleanup(); release(); this.notice(); return; }
    if (!admitted) { pending = false; restorePosition(); cleanup(); release(); this.notice(); return; }
    try {
     canvas.pushHistory(canvas.getData());
     const after = canvas.history.data[canvas.history.current ?? -1];
     detachGesture();
     void settle(captured, release, baseline, after, targetKey);
    } catch { pending = false; restorePosition(); cleanup(); release(); this.notice(); }
   },
   cancel,
   // Mouse callers clean native listeners before end; touch callers do the reverse.
   cleanup: cleanupNative,
  };
 }
 onunload(): void { this.active = false; this.cancelDrag?.(); }
}
