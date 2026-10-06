import type { DataAdapter } from 'obsidian';
import { isValidOperonId } from '../core/id-generator';
import { isRecord } from '../core/unknown-value';
import type { ExcalidrawTaskElement } from '../ui/excalidraw-task-bridge';
import { buildOperonPluginStoragePath } from './operon-storage-paths';
import { writeTextSafely } from './storage-file-ops';
import { WriteQueue } from './write-queue';

export interface ExcalidrawCleanupCard {
 taskId: string; token: string; drawingPath: string; element: ExcalidrawTaskElement;
 status: 'prepared' | 'applied' | 'removed';
 order?: number; precedingId?: string; followingId?: string;
}
export interface ExcalidrawCleanupState {
 version: 1;
 deletions: { taskId: string; token: string }[];
 cards: ExcalidrawCleanupCard[];
}
export function cloneCleanupValue<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function readExcalidrawCleanupState(value: unknown): ExcalidrawCleanupState {
 if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.deletions) || !Array.isArray(value.cards)) throw new Error('Unsupported Excalidraw card cleanup state');
 const ids = new Set<string>(), cards = new Set<string>();
 for (const entry of value.deletions) {
  if (!isRecord(entry) || typeof entry.taskId !== 'string' || !isValidOperonId(entry.taskId) || typeof entry.token !== 'string' || !entry.token || ids.has(entry.taskId)) throw new Error('Invalid cleanup deletion');
  ids.add(entry.taskId);
 }
 for (const entry of value.cards) {
  if (!isRecord(entry) || typeof entry.taskId !== 'string' || !isValidOperonId(entry.taskId) || typeof entry.token !== 'string' || !entry.token
   || typeof entry.drawingPath !== 'string' || !entry.drawingPath.endsWith('.md') || /(^|\/)\.\.(\/|$)|^\/|\\/.test(entry.drawingPath)
   || !isRecord(entry.element) || entry.element.type !== 'embeddable' || typeof entry.element.id !== 'string' || !entry.element.id
   || typeof entry.element.link !== 'string' || !entry.element.link.endsWith(`#Operon task ${entry.taskId}]]`)
   || entry.element.isDeleted === true || !['prepared', 'applied', 'removed'].includes(String(entry.status))
   || entry.order !== undefined && (!Number.isInteger(entry.order) || Number(entry.order) < 0)
   || [entry.precedingId, entry.followingId].some(id => id !== undefined && typeof id !== 'string')
   || !['x', 'y', 'width', 'height'].every(key => isRecord(entry.element) && typeof entry.element[key] === 'number' && Number.isFinite(entry.element[key]))
   || Number(entry.element.width) <= 0 || Number(entry.element.height) <= 0) throw new Error('Invalid cleanup card');
  const key = entry.drawingPath + '\n' + entry.element.id;
  if (cards.has(key)) throw new Error('Duplicate cleanup card');
  cards.add(key);
 }
 return cloneCleanupValue(value) as unknown as ExcalidrawCleanupState;
}

/** Lazily created operational state. A failed store never blocks task-source mutations. */
export class ExcalidrawTaskCardCleanupStore {
 private state: ExcalidrawCleanupState = { version: 1, deletions: [], cards: [] };
 private expected: string | null = null;
 private status: 'unloaded' | 'ready' | 'unavailable' = 'unloaded';
 private active = true;
 private queue = new WriteQueue();
 readonly filePath: string;
 constructor(private adapter: DataAdapter, configDir: string) {
  this.filePath = buildOperonPluginStoragePath(configDir, 'state', 'excalidraw-task-card-cleanup.json');
 }
 get healthy(): boolean { return this.active && this.status === 'ready'; }
 snapshot(): ExcalidrawCleanupState { return cloneCleanupValue(this.state); }
 async load(): Promise<void> {
  await this.queue.enqueue(this.filePath, async () => {
   if (!this.active || this.status !== 'unloaded') return;
   try {
    const raw = await this.read();
    const state = raw === null ? this.state : readExcalidrawCleanupState(JSON.parse(raw));
    if (!this.active) return;
    this.state = state; this.expected = raw; this.status = 'ready';
   } catch (error) { this.status = 'unavailable'; throw error; }
  });
 }
 async change(update: (state: ExcalidrawCleanupState) => void): Promise<void> {
  await this.queue.enqueue(this.filePath, async () => {
   if (!this.healthy) throw new Error('Excalidraw cleanup state unavailable');
   const next = this.snapshot(); update(next); readExcalidrawCleanupState(next);
   const raw = JSON.stringify(next, null, '\t');
   if (raw === JSON.stringify(this.state, null, '\t')) return;
   if (await this.read() !== this.expected) { this.status = 'unavailable'; throw new Error('Excalidraw cleanup state changed externally'); }
   const directory = this.filePath.slice(0, this.filePath.lastIndexOf('/'));
   if (!await this.adapter.exists(directory)) await this.adapter.mkdir(directory);
   try {
    await writeTextSafely(this.adapter, this.filePath, raw, { forceAtomicReplacement: true, verifyAtomicReplacement: true, canCommit: () => this.healthy, beforeAtomicReplace: async temporaryPath => {
     if (await this.read(temporaryPath) !== this.expected) throw new Error('Excalidraw cleanup state changed externally');
    } });
    this.expected = raw; this.state = next;
   } catch (error) { this.status = 'unavailable'; throw error; }
  });
 }
 async recordDeletion(taskId: string): Promise<void> {
  await this.change(state => {
   if (!state.deletions.some(entry => entry.taskId === taskId)) state.deletions.push({ taskId, token: crypto.randomUUID() });
  });
 }
 async renamePath(oldPath: string, newPath: string): Promise<void> {
  await this.change(state => {
   for (const card of state.cards) if (card.drawingPath === oldPath || card.drawingPath.startsWith(oldPath + '/')) {
    card.drawingPath = newPath + card.drawingPath.slice(oldPath.length);
    card.element.link = `[[${card.drawingPath}#Operon task ${card.taskId}]]`;
   }
  });
 }
 async deleteDrawing(path: string): Promise<void> {
  await this.change(state => { state.cards = state.cards.filter(card => card.drawingPath !== path && !card.drawingPath.startsWith(path + '/')); });
 }
 destroy(): void { this.active = false; }
 private async read(ignoredTemporary?: string): Promise<string | null> {
  if (await this.adapter.exists(this.filePath)) return await this.adapter.read(this.filePath);
  const directory = this.filePath.slice(0, this.filePath.lastIndexOf('/'));
  if (typeof this.adapter.list !== 'function' || !await this.adapter.exists(directory)) return null;
  const files = (await this.adapter.list(directory)).files;
  const backups = files.filter(path => path.startsWith(this.filePath + '.replace-backup.tmp-'));
  const temporary = files.filter(path => path !== ignoredTemporary && path.startsWith(this.filePath + '.tmp-'));
  if (!backups.length && !temporary.length) return null;
  if (backups.length !== 1 || temporary.length > 1) throw new Error('Interrupted cleanup state needs recovery');
  const raw = await this.adapter.read(backups[0]), before = readExcalidrawCleanupState(JSON.parse(raw));
  if (!temporary.length) return raw;
  const pending = await this.adapter.read(temporary[0]), after = readExcalidrawCleanupState(JSON.parse(pending));
  // A complete native-application receipt may have been interrupted at the rename.
  // Only identical snapshots with forward status changes can extend the backup proof.
  const rank = { prepared: 0, applied: 1, removed: 2 };
  const promote = before.cards.length === after.cards.length && before.cards.every((card, index) => rank[after.cards[index].status] >= rank[card.status]);
  const normalize = (state: ExcalidrawCleanupState) => JSON.stringify({ ...state, cards: state.cards.map(card => ({ ...card, status: 'prepared' })) });
  return promote && normalize(before) === normalize(after) ? pending : raw;
 }
}
