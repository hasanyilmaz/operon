import { Component, Notice, type Menu, type EventRef } from 'obsidian';
import { t } from '../core/i18n';
import { canvasTaskData } from './canvas-task-node';
import { readCanvasTaskId } from './task-card-canvas';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';
import { CanvasTaskHistory, type CanvasHistoryStep } from './canvas-task-history';

export interface CanvasConversionReceipt {
 id: string; path: string; format: 'inline' | 'yaml'; content: string; key: string; plainText: string; pinned: boolean;
 deletedContent?: string; invalid: boolean; phase: 'bound' | 'plain' | 'working';
}
export interface CanvasConversionBridge {
 create(text: string, allowed: () => boolean, created: (receipt: CanvasConversionReceipt | null) => Promise<void>): void;
 key(id: string): string | null;
 confirm(receipt: CanvasConversionReceipt): Promise<boolean>;
 remove(receipt: CanvasConversionReceipt, allowed: () => boolean): Promise<boolean>;
 restore(receipt: CanvasConversionReceipt, allowed: () => boolean): Promise<boolean>;
}
export function splitCanvasTaskText(text: string): { description: string; note: string } {
 const lines = text.replace(/\r\n?/g, '\n').split('\n'); return { description: lines.shift() ?? '', note: lines.join('\n') };
}
export function isConvertibleCanvasText(data: Record<string, unknown>): boolean {
 return data.type === 'text' && typeof data.text === 'string' && !('operonTask' in data) && !readCanvasTaskId(data.text);
}
interface Entry { before: unknown; after: unknown; nodeId: string; receipt: CanvasConversionReceipt }
/** Conversion receipts never enter the Canvas JSON or a persistent store. */
export class CanvasTaskConversion extends Component {
 private active = false;
 private generation = 0;
 private entries: Entry[] = [];
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private history: CanvasTaskHistory, private bridge: CanvasConversionBridge) { super(); }
 onload(): void {
  this.active = true;
  const workspace = this.owner.deps.app.workspace as unknown as { on(name: 'canvas:node-menu', callback: (menu: Menu, node: CanvasTaskNode) => void): EventRef };
  const event = workspace.on('canvas:node-menu', (menu: Menu, node: CanvasTaskNode) => {
   if (!this.valid() || this.view.canvas.nodes.get(node.id) !== node || !this.history.supported || !isConvertibleCanvasText(node.getData())) return;
   const selection = (this.view.canvas as typeof this.view.canvas & { selection?: Set<unknown> }).selection;
   if (selection && selection.size > 1) return;
   menu.addItem(item => item.setTitle(t('commands', 'convertCanvasTask')).setIcon('id-card').setDisabled(this.view.canvas.readonly).onClick(() => this.open(node)));
  });
  this.registerEvent(event);
  const vault = this.owner.deps.app.vault;
  const changed = (file: { path: string }, oldPath?: string) => {
   for (const { receipt } of this.entries) if (receipt.phase !== 'working' && (receipt.path === file.path || receipt.path === oldPath)) receipt.invalid = true;
  };
  this.registerEvent(vault.on('modify', changed));
  this.registerEvent(vault.on('delete', changed));
  this.registerEvent(vault.on('rename', changed));
  this.register(this.owner.deps.cards.onRefresh(() => this.observe()));
  this.register(this.history.addHandler(step => {
   const entry = this.entries.find(value => step.direction === 'undo' ? value.after === step.current && value.before === step.next : value.before === step.current && value.after === step.next);
   return entry ? () => this.travel(entry, step) : null;
  }));
 }
 private valid(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.canvas === this.history.canvas; }
 private writable(): boolean { return this.valid() && !this.view.canvas.readonly && !this.view.saving && this.view.lastSavedData !== null; }
 private notice(key = 'canvasConversionBlocked'): void { new Notice(t('notifications', key)); }
 private observe(): void {
  for (const entry of this.entries) {
   const receipt = entry.receipt;
   if (receipt.phase === 'bound' && this.bridge.key(receipt.id) !== receipt.key) receipt.invalid = true;
   if (receipt.phase === 'plain' && this.bridge.key(receipt.id) !== null) receipt.invalid = true;
  }
  this.entries = this.entries.filter(entry => this.history.canvas.history.data.includes(entry.after));
 }
 private open(node: CanvasTaskNode): void {
  if (!this.writable() || !isConvertibleCanvasText(node.getData())) return;
  const file = this.view.file, path = file?.path, text = node.getData().text as string, generation = ++this.generation;
  const allowed = () => this.writable() && generation === this.generation && this.view.file === file && file?.path === path
   && this.view.canvas.nodes.get(node.id) === node && isConvertibleCanvasText(node.getData()) && node.getData().text === text;
  this.bridge.create(text, allowed, async receipt => {
   if (!receipt || !allowed()) { this.notice('canvasConversionCreatedUnbound'); return; }
   const canvas = this.history.canvas;
   canvas.requestPushHistory.run(); if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
   const before = canvas.history.data[canvas.history.current], original = node.getData();
   try { node.setData({ ...original, ...canvasTaskData(receipt.id) }); }
   catch { this.notice('canvasConversionCreatedUnbound'); return; }
   this.owner.fitConvertedNode(this.view, node);
   canvas.requestSave(false); const after = canvas.getData(); canvas.pushHistory(after);
   this.entries.push({ before, after, nodeId: node.id, receipt });
   try { await this.view.save(); } catch { this.notice('canvasTaskSaveFailed'); return; }
   this.owner.finishConvertedNodeSize(this.view, node, after, () => this.writable() && !receipt.invalid
    && this.view.file === file && file?.path === path && canvas.nodes.get(node.id) === node
    && canvas.history.data[canvas.history.current] === after && this.bridge.key(receipt.id) === receipt.key
    && JSON.stringify(canvas.getData()) === JSON.stringify(after));
  });
 }
 private async travel(entry: Entry, step: CanvasHistoryStep): Promise<void> {
  this.observe(); const receipt = entry.receipt;
  if (!this.writable() || receipt.invalid) { this.notice(); return; }
  const canvas = this.history.canvas, file = this.view.file, path = file?.path;
  const head = canvas.history.current, content = JSON.stringify(canvas.getData());
  const allowed = () => this.writable() && this.view.file === file && file?.path === path && canvas.history.current === head
   && canvas.history.data[head] === step.current && JSON.stringify(canvas.getData()) === content;
  if (step.direction === 'undo' && !await this.bridge.confirm(receipt)) return;
  this.observe(); if (!allowed() || receipt.invalid) { this.notice(); return; }
  const release = this.history.lockInput(); receipt.phase = 'working';
  let committed = false;
  try {
   committed = await (step.direction === 'undo' ? this.bridge.remove(receipt, allowed) : this.bridge.restore(receipt, allowed));
   if (!committed) { this.notice(); return; }
   if (!allowed()) { receipt.invalid = true; this.notice('canvasConversionPartial'); return; }
   if (step.direction === 'undo') {
    const before = entry.before as { nodes?: Record<string, unknown>[] };
    const node = before.nodes?.find(value => value.id === entry.nodeId);
    if (node) node.text = receipt.plainText;
   }
   step.native();
   try { await this.view.save(); } catch { this.notice('canvasTaskSaveFailed'); }
  } catch { receipt.invalid = true; this.notice('canvasConversionPartial'); }
  finally {
   receipt.phase = committed ? step.direction === 'undo' ? 'plain' : 'bound' : step.direction === 'undo' ? 'bound' : 'plain';
   release();
  }
 }
 onunload(): void { this.active = false; this.generation++; this.entries = []; }
}
