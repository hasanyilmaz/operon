import { Component, ItemView, Menu, Notice, setIcon, type App, type MarkdownRenderChild, type TFile } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { normalizeTaskCardSettings } from '../types/task-card';
import { CanvasTaskSaveError } from './canvas-task-insert';
import { readCanvasTaskReference } from './canvas-task-node';
import type { TaskCardEmbeds } from './task-card-embed';

export interface CanvasPoint { x: number; y: number }
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
	nodes: Map<string, CanvasTaskNode>;
	readonly: boolean;
	cardMenuEl: HTMLElement;
	config: { minContainerDimension: number };
	posCenter(): CanvasPoint;
	showCreationMenu(menu: Menu, point: CanvasPoint, ...args: unknown[]): unknown;
	createTextNode(options: { pos: CanvasPoint; size: { width: number; height: number }; text: string; save: false; focus: false }): CanvasTaskNode;
	removeNode(node: CanvasTaskNode): void;
	selectOnly(node: CanvasTaskNode): void;
	getData(): Record<string, unknown>;
	data: Record<string, unknown>;
	history: { data: unknown[] };
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

export interface CanvasTaskTarget { view: TaskCanvasView; canvas: TaskCanvas; file: TFile; path: string; point: CanvasPoint; isCurrent(): boolean }
export interface CanvasTaskDependencies {
	app: App;
	cards: TaskCardEmbeds;
	openFinder(select: (id: string) => void | Promise<void>): void;
	insert(target: CanvasTaskTarget, taskId: string, width: number): Promise<void>;
}

class CanvasTaskSurface extends Component {
	private mounted = new Map<CanvasTaskNode, MountedNode>();
	private button: HTMLButtonElement | null = null;
	private observer: MutationObserver | null = null;
	private frame = 0;
	private active = false;
	readonly canvas: TaskCanvas;
	constructor(readonly view: TaskCanvasView, private owner: CanvasTaskIntegration) { super(); this.canvas = view.canvas; }
	onload(): void {
		this.active = true;
		const canvas = this.view.canvas;
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
			if (this.mounted.has(node)) continue;
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
			this.mounted.set(node, { id: reference.taskId, root, child, restoreEdit: () => {
				disposed = true;
				if (node.startEditing !== edit) return;
				if (descriptor) Object.defineProperty(node, 'startEditing', descriptor);
				else Reflect.deleteProperty(node, 'startEditing');
			} });
		}
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
	canAdd(): boolean {
		const view = asTaskCanvasView(this.deps.app.workspace.getActiveViewOfType(ItemView));
		return this.active && !!view?.file && this.deps.app.vault.getAbstractFileByPath(view.file.path) === view.file && !view.canvas.readonly && !view.saving && view.lastSavedData !== null;
	}
	open(view = asTaskCanvasView(this.deps.app.workspace.getActiveViewOfType(ItemView)), point?: CanvasPoint): void {
		if (!this.active || !view?.file || this.deps.app.vault.getAbstractFileByPath(view.file.path) !== view.file || !this.views().includes(view) || view.canvas.readonly || view.saving || view.lastSavedData === null) { new Notice(t('notifications', 'canvasTaskUnavailable')); return; }
		const position = point ?? view.canvas.posCenter();
		const file = view.file;
		const target: CanvasTaskTarget = { view, canvas: view.canvas, file, path: file.path, point: { x: position.x, y: position.y },
			isCurrent: () => this.active && this.views().includes(view) && this.deps.app.vault.getAbstractFileByPath(target.path) === file,
		};
		let consumed = false;
		this.deps.openFinder(async id => {
			if (consumed) return;
			consumed = true;
			if (!target.isCurrent() || view.canvas !== target.canvas || view.file !== target.file || view.file.path !== target.path || view.canvas.readonly || view.saving) { new Notice(t('notifications', 'canvasTaskUnavailable')); return; }
			if (this.deps.cards.resolve(id).state !== 'ready') { new Notice(t('notifications', 'canvasTaskMissing')); return; }
			try {
				await this.deps.insert(target, id, normalizeTaskCardSettings(this.deps.cards.deps.getSettings()).taskCardWidth);
				this.sync();
			} catch (error) { new Notice(t('notifications', error instanceof CanvasTaskSaveError ? 'canvasTaskSaveFailed' : 'canvasTaskAddFailed')); }
		});
	}
	onunload(): void { this.active = false; this.surfaces.clear(); }
}
