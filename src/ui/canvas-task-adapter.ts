import { captureCanvasDropConnection, isCanvasDropConnectionCurrent, type CanvasDropConnection, type CanvasSide } from './canvas-task-drop-connection';
import { CanvasTaskAutoHeight } from './canvas-task-auto-height';
import { readCanvasTaskId } from './task-card-canvas';
import { fitCanvasTaskHeight } from './canvas-task-size';
import { CanvasTaskHistory } from './canvas-task-history';
import { CanvasTaskConversion, type CanvasConversionBridge } from './canvas-task-conversion';
import { CanvasTaskPool } from './canvas-task-pool';
import { CanvasTaskColors } from './canvas-task-colors';
import { Component, ItemView, Menu, Notice, setIcon, type App, type EventRef, type MarkdownRenderChild, type TFile } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { normalizeTaskCardSettings } from '../types/task-card';
import { CanvasTaskSaveError } from './canvas-task-insert';
import { readCanvasTaskReference } from './canvas-task-node';
import type { TaskCardEmbeds } from './task-card-embed';

export interface CanvasPoint { x: number; y: number }
/** Native connection-drop events expose the temporary endpoint in Canvas coordinates. */
export function readCanvasDropPoint(edge: unknown): CanvasPoint | null {
 if (!edge || typeof edge !== 'object') return null;
 const node = (edge as { to?: { node?: { x?: unknown; y?: unknown } } }).to?.node;
 return typeof node?.x === 'number' && Number.isFinite(node.x) && typeof node.y === 'number' && Number.isFinite(node.y)
  ? { x: node.x, y: node.y } : null;
}
export interface CanvasTaskNode {
	id: string;
	nodeEl: HTMLElement;
	contentEl?: HTMLElement;
	isEditing?: boolean;
	getData(): Record<string, unknown>;
	setData(data: Record<string, unknown>): void;
	startEditing(...args: unknown[]): void;
}
export interface TaskCanvas {
 edges?: Map<string, unknown>;
 importData?(data: Record<string, unknown>, clear: boolean): unknown;
 removeEdge?(edge: unknown): void;
 canvasControlsEl?: HTMLElement;
 canvasEl?: HTMLElement;
 wrapperEl?: HTMLElement;
 posFromClient?(point: CanvasPoint): CanvasPoint;
	nodes: Map<string, CanvasTaskNode>;
	readonly: boolean;
	cardMenuEl: HTMLElement;
	config: { minContainerDimension: number };
	posCenter(): CanvasPoint;
	showCreationMenu(menu: Menu, point: CanvasPoint, ...args: unknown[]): unknown;
	createTextNode(options: { pos: CanvasPoint; size: { width: number; height: number }; text: string; position?: CanvasSide; save: false; focus: false }): CanvasTaskNode;
	removeNode(node: CanvasTaskNode): void;
	selectOnly(node: CanvasTaskNode): void;
	getData(): Record<string, unknown>;
	data: Record<string, unknown>;
	history: { data: unknown[]; current?: number };
	requestSave(history?: boolean): void;
	requestPushHistory: { (): void; run(): void };
	pushHistory(data: Record<string, unknown>): void;
}
export interface TaskCanvasView {
	canvas: TaskCanvas;
	file: TFile | null;
	contentEl: HTMLElement;
	saving: boolean;
	lastSavedData: string | null;
	save(): Promise<void>;
}
interface MountedNode { id: string; root: HTMLElement; child: MarkdownRenderChild; restoreEdit: () => void }

/** All unsupported internals are isolated here. No Canvas prototype is changed. */
export function asTaskCanvasView(value: unknown): TaskCanvasView | null {
	if (!value || typeof value !== 'object') return null;
	const view = value as TaskCanvasView;
	const canvas = view.canvas;
	if (!canvas || !Array.isArray(canvas.history?.data) || !(canvas.nodes instanceof Map) || !view.contentEl || !canvas.cardMenuEl || !canvas.config) return null;
	if (typeof view.save !== 'function' || typeof canvas.readonly !== 'boolean') return null;
	for (const name of ['posCenter', 'showCreationMenu', 'createTextNode', 'removeNode', 'selectOnly', 'getData', 'requestSave', 'pushHistory'] as const) {
		if (typeof canvas[name] !== 'function') return null;
	}
	if (typeof canvas.requestPushHistory?.run !== 'function' || typeof view.saving !== 'boolean' || !(view.lastSavedData === null || typeof view.lastSavedData === 'string')) return null;
	return view;
}

export interface CanvasTaskTarget { view: TaskCanvasView; canvas: TaskCanvas; file: TFile; path: string; point: CanvasPoint; isCurrent(): boolean; fitNode?(node: CanvasTaskNode): void; connection?: CanvasDropConnection }
export interface CanvasTaskDependencies {
 createTask?(allowed: () => boolean, created: (id: string) => Promise<void>): void;
 conversion?: CanvasConversionBridge;
	app: App;
	cards: TaskCardEmbeds;
 changeColor?(id: string, expected: string, next: string, allowed: () => boolean): Promise<boolean>;
	openFinder(select: (id: string) => void | Promise<void>): void;
	insert(target: CanvasTaskTarget, taskId: string, width: number): Promise<void>;
}

class CanvasTaskSurface extends Component {
	private mounted = new Map<CanvasTaskNode, MountedNode>();
 private colors: CanvasTaskColors | null = null;
 private pool: CanvasTaskPool | null = null;
 private history: CanvasTaskHistory | null = null;
 private autoHeight: CanvasTaskAutoHeight | null = null;
	private button: HTMLButtonElement | null = null;
	private observer: MutationObserver | null = null;
	private frame = 0;
	private active = false;
 private mountStates = new WeakMap<HTMLElement, string>();
	readonly canvas: TaskCanvas;
	constructor(readonly view: TaskCanvasView, private owner: CanvasTaskIntegration) { super(); this.canvas = view.canvas; }
	onload(): void {
		this.active = true;
  this.history = new CanvasTaskHistory(this.view); this.addChild(this.history);
  this.autoHeight = new CanvasTaskAutoHeight(this.view, () => this.active && this.owner.isCurrent(this.view) && this.view.canvas === this.canvas, () => this.history?.isBusy ?? false);
  this.addChild(this.autoHeight);
  if (this.owner.deps.conversion && this.history.supported) this.addChild(new CanvasTaskConversion(this.view, this.owner, this.history, this.owner.deps.conversion));
  if (this.owner.deps.changeColor) {
   this.colors = new CanvasTaskColors(this.view, {
    read: id => { const result = this.owner.deps.cards.resolve(id); return result.state === 'ready' ? result.task.fieldValues.taskColor ?? '' : null; },
    write: (id, expected, next, allowed) => this.owner.changeColor(id, expected, next, allowed),
    subscribe: callback => this.owner.deps.cards.onRefresh(callback),
    isCurrent: () => this.active && this.owner.isCurrent(this.view),
   }, this.history);
   this.addChild(this.colors);
  }
		const canvas = this.view.canvas;
  if (this.owner.deps.createTask) {
   const workspace = this.owner.deps.app.workspace as unknown as { on(name: 'canvas:node-connection-drop-menu', callback: (menu: Menu, node: CanvasTaskNode, edge: unknown) => void): EventRef };
   this.registerEvent(workspace.on('canvas:node-connection-drop-menu', (menu, node, edge) => {
    if (!this.active || canvas.nodes.get(node.id) !== node) return;
    const point = readCanvasDropPoint(edge);
    const connection = captureCanvasDropConnection(canvas, node, edge);
    if (!point || !connection) return;
    const file = this.view.file, path = file?.path;
    menu.addItem(item => item.setSection('action').setTitle(t('commands', 'addOperonTask')).setIcon('id-card').setDisabled(canvas.readonly)
     .onClick(() => {
      if (!this.active || this.view.canvas !== canvas || this.view.file !== file || file?.path !== path) { new Notice(t('notifications', 'canvasTaskUnavailable')); return; }
      if (canvas.readonly || !isCanvasDropConnectionCurrent(canvas, connection)) return;
      if (canvas.edges?.get(connection.previewId) === edge) canvas.removeEdge?.(edge);
      this.owner.createAt(this.view, point, connection);
     }));
   }));
  }
		const original = Reflect.get(canvas, 'showCreationMenu');
		const descriptor = Object.getOwnPropertyDescriptor(canvas, 'showCreationMenu');
		const wrapper: TaskCanvas['showCreationMenu'] = (menu, point, ...args) => {
			const result: unknown = Reflect.apply(original, canvas, [menu, point, ...args]);
			if (this.active && !canvas.readonly) menu.addItem(item => item.setSection('create').setTitle(t('commands', 'addOperonTask')).setIcon('id-card').onClick(() => this.owner.open(this.view, point)));
			return result;
		};
		canvas.showCreationMenu = wrapper;
		this.register(() => {
			if (canvas.showCreationMenu !== wrapper) return;
			if (descriptor) Object.defineProperty(canvas, 'showCreationMenu', descriptor);
			else Reflect.deleteProperty(canvas, 'showCreationMenu');
		});
		const win = getOwnerWindow(this.view.contentEl) as Window & { MutationObserver: typeof MutationObserver };
		this.observer = new win.MutationObserver(() => this.schedule());
		this.observer.observe(this.view.contentEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
		this.sync();
	}
	private schedule(): void {
		if (!this.active || this.frame) return;
		this.frame = getOwnerWindow(this.view.contentEl).requestAnimationFrame(() => { this.frame = 0; this.sync(); });
	}
	sync(): void {
		if (!this.active) return;
		const canvas = this.view.canvas;
		if (!this.button || !canvas.cardMenuEl.contains(this.button)) {
			this.button?.remove();
			const button = canvas.cardMenuEl.createEl('button', { cls: 'canvas-control-item operon-canvas-add-task', attr: { type: 'button', 'aria-label': t('commands', 'addTaskToCanvas') } });
			setIcon(button, 'id-card');
			button.title = t('commands', 'addTaskToCanvas');
			this.registerDomEvent(button, 'click', event => { event.preventDefault(); event.stopPropagation(); this.owner.open(this.view); });
			this.button = button;
		}
		if (this.button) this.button.disabled = canvas.readonly;
		for (const [node, mounted] of this.mounted) {
			const ref = readCanvasTaskReference(node.getData());
			if (node.isEditing || canvas.nodes.get(node.id) !== node || ref?.taskId !== mounted.id || !node.contentEl?.contains(mounted.root)) this.unmount(node);
		}
		for (const node of canvas.nodes.values()) {
			if (typeof node.getData !== 'function' || typeof node.startEditing !== 'function' || !node.nodeEl) continue;
			const reference = readCanvasTaskReference(node.getData());
			// Do not hide or close a native editing session that predates this mount.
			if (!reference || !node.contentEl || node.isEditing) continue;
			for (const name of ['operon-task-card-canvas-node', 'operon-canvas-task-node']) {
				if (!node.nodeEl.classList.contains(name)) node.nodeEl.classList.add(name);
			}
			const existing = this.mounted.get(node);
   if (existing) {
    const state = `${canvas.readonly}:${existing.root.isConnected}`;
    if (this.mountStates.get(existing.root) !== state) {
     this.mountStates.set(existing.root, state); this.owner.deps.cards.refreshRoot(existing.root);
    }
    continue;
   }
			const descriptor = Object.getOwnPropertyDescriptor(node, 'startEditing');
			const original = Reflect.get(node, 'startEditing');
			let disposed = false;
			const edit = (...args: unknown[]) => {
				if (disposed || !this.active) { Reflect.apply(original, node, args); return; }
				if (!canvas.readonly) this.owner.deps.cards.activate(reference.taskId, false);
			};
			node.startEditing = edit;
			const root = node.contentEl.createDiv('operon-canvas-task-content');
			const child = this.owner.deps.cards.mountCanvas(root, reference.taskId);
   this.mountStates.set(root, `${canvas.readonly}:${root.isConnected}`);
			this.mounted.set(node, { id: reference.taskId, root, child, restoreEdit: () => {
				disposed = true;
				if (node.startEditing !== edit) return;
				if (descriptor) Object.defineProperty(node, 'startEditing', descriptor);
				else Reflect.deleteProperty(node, 'startEditing');
			} });
		}
  if (!this.pool && canvas.canvasControlsEl && canvas.canvasEl && canvas.wrapperEl && typeof canvas.posFromClient === 'function') {
   this.pool = new CanvasTaskPool(this.view, this.owner); this.addChild(this.pool);
  }
  this.pool?.sync();
  this.colors?.sync();
  const roots = new Map<CanvasTaskNode, HTMLElement>();
  for (const node of canvas.nodes.values()) {
   if (node.isEditing) continue;
   const root = this.mounted.get(node)?.root;
   if (root) { roots.set(node, root); continue; }
   const data = node.getData();
   if (data.type !== 'text' || typeof data.text !== 'string' || !readCanvasTaskId(data.text)) continue;
   const embed = node.contentEl?.querySelector<HTMLElement>('.operon-task-card-embed');
   if (embed) roots.set(node, embed);
  }
  this.autoHeight?.sync(roots);
	}
 fitNew(node: CanvasTaskNode): void {
  this.sync();
  const mounted = this.mounted.get(node);
  if (mounted) fitCanvasTaskHeight(node, mounted.root, this.canvas.config.minContainerDimension);
 }

	private unmount(node: CanvasTaskNode): void {
		const mounted = this.mounted.get(node);
		if (!mounted) return;
		mounted.child.unload(); mounted.root.remove(); mounted.restoreEdit();
		node.nodeEl.classList.remove('operon-task-card-canvas-node', 'operon-canvas-task-node');
		this.mounted.delete(node);
	}
	onunload(): void {
		this.active = false; this.observer?.disconnect();
		if (this.frame) getOwnerWindow(this.view.contentEl).cancelAnimationFrame(this.frame);
		for (const node of [...this.mounted.keys()]) this.unmount(node);
		this.button?.remove();
	}
}

export class CanvasTaskIntegration extends Component {
	private surfaces = new Map<TaskCanvasView, CanvasTaskSurface>();
 private colorQueue = new Map<string, Promise<boolean>>();
 isCurrent(view: TaskCanvasView): boolean { return this.active && this.views().includes(view) && !!view.file && this.deps.app.vault.getAbstractFileByPath(view.file.path) === view.file; }
 changeColor(id: string, expected: string, next: string, allowed: () => boolean): Promise<boolean> {
  const previous = this.colorQueue.get(id) ?? Promise.resolve(true);
  const result = previous.catch(() => false).then(() => allowed() ? this.deps.changeColor?.(id, expected, next, allowed) ?? false : false);
  this.colorQueue.set(id, result);
  void result.finally(() => { if (this.colorQueue.get(id) === result) this.colorQueue.delete(id); }).catch(() => {});
  return result;
 }
	private active = false;
	constructor(readonly deps: CanvasTaskDependencies) { super(); }
	onload(): void {
		this.active = true;
		this.registerEvent(this.deps.app.workspace.on('layout-change', () => this.sync()));
		this.registerEvent(this.deps.app.workspace.on('active-leaf-change', () => this.sync()));
		this.registerEvent(this.deps.app.workspace.on('file-open', () => this.sync()));
		this.deps.app.workspace.onLayoutReady(() => { if (this.active) this.sync(); });
		this.sync();
	}
	private views(): TaskCanvasView[] {
		return this.deps.app.workspace.getLeavesOfType('canvas').map(leaf => asTaskCanvasView(leaf.view)).filter((view): view is TaskCanvasView => view !== null);
	}
	private sync(): void {
		if (!this.active) return;
		const views = new Set(this.views());
		for (const [view, surface] of this.surfaces) if (!views.has(view) || surface.canvas !== view.canvas) { this.removeChild(surface); this.surfaces.delete(view); }
		for (const view of views) {
			if (!this.surfaces.has(view)) { const surface = new CanvasTaskSurface(view, this); this.surfaces.set(view, surface); this.addChild(surface); }
			else this.surfaces.get(view)?.sync();
		}
	}
 get cardWidth(): number { return normalizeTaskCardSettings(this.deps.cards.deps.getSettings()).taskCardWidth; }
 fitNewNode(view: TaskCanvasView, node: CanvasTaskNode): void { this.surfaces.get(view)?.fitNew(node); }
 capture(view: TaskCanvasView, point = view.canvas.posCenter()): CanvasTaskTarget | null {
  if (!this.isCurrent(view) || !view.file || view.canvas.readonly || view.saving || view.lastSavedData === null) return null;
  const file = view.file, canvas = view.canvas, path = file.path;
  return { view, canvas, file, path, point: { ...point }, isCurrent: () => this.isCurrent(view) && view.canvas === canvas && view.file === file && file.path === path };
 }
 async add(target: CanvasTaskTarget, id: string): Promise<boolean> {
  if (!target.isCurrent() || target.view.canvas !== target.canvas || target.view.file !== target.file || target.file.path !== target.path || target.canvas.readonly || target.view.saving) { new Notice(t('notifications', 'canvasTaskUnavailable')); return false; }
  if (this.deps.cards.resolve(id).state !== 'ready') { new Notice(t('notifications', 'canvasTaskMissing')); return false; }
  try {
   await this.deps.insert({ ...target, fitNode: node => this.fitNewNode(target.view, node) }, id, this.cardWidth);
   this.sync(); return true;
  } catch (error) { new Notice(t('notifications', error instanceof CanvasTaskSaveError ? 'canvasTaskSaveFailed' : 'canvasTaskAddFailed')); return false; }
 }
 createAt(view: TaskCanvasView, point: CanvasPoint, connection?: CanvasDropConnection): void {
  const target = this.capture(view, point);
  if (!target || !this.deps.createTask) { new Notice(t('notifications', 'canvasTaskUnavailable')); return; }
  if (connection) target.connection = connection;
  const allowed = () => target.isCurrent() && !target.canvas.readonly && !target.view.saving && target.view.lastSavedData !== null
   && (!connection || isCanvasDropConnectionCurrent(target.canvas, connection));
  let consumed = false;
  this.deps.createTask(allowed, async id => {
   if (consumed) return;
   consumed = true;
   if (!allowed()) { new Notice(t('notifications', 'canvasConversionCreatedUnbound')); return; }
   await this.add(target, id);
  });
 }
 open(view = asTaskCanvasView(this.deps.app.workspace.getActiveViewOfType(ItemView)), point?: CanvasPoint): void {
  const target = view ? this.capture(view, point) : null;
  if (!target) { new Notice(t('notifications', 'canvasTaskUnavailable')); return; }
  let consumed = false;
  this.deps.openFinder(async id => {
   if (consumed) return;
   consumed = true;
   await this.add(target, id);
  });
 }
	onunload(): void { this.active = false; this.surfaces.clear(); }
}
