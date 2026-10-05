import { DEFAULT_TASK_CARD_SETTINGS, TASK_CARD_WIDTHS } from '../types/task-card';
import { readExcalidrawMarkdownSections, saveExcalidrawTaskSceneInQueue, serializeExcalidrawSource } from './excalidraw-markdown-source';
import { TFile, type App } from 'obsidian';
import { isValidOperonId } from '../core/id-generator';

/** Narrow, feature-detected bridge to the optional Excalidraw plugin. */
export interface ExcalidrawTaskElement {
 [key: string]: unknown;
 id: string; type: string; strokeColor?: string; x?: number; y?: number; width?: number; height?: number; angle?: number; scale?: readonly number[]; link?: string | null; isDeleted?: boolean; locked?: boolean;
}
export interface ExcalidrawTaskState {
 viewModeEnabled?: boolean;
 activeEmbeddable?: { element: { id: string }; state: string } | null;
 [key: string]: unknown;
}
export interface ExcalidrawTaskAPI {
 refresh?(): void;
 getSceneElementsIncludingDeleted?(): readonly ExcalidrawTaskElement[];
 updateScene?(update: { appState?: { activeEmbeddable: null }; elements?: readonly ExcalidrawTaskElement[]; captureUpdate: 'NEVER' }): void;
 refreshAllArrows?(): void;
 getSceneElements(): readonly ExcalidrawTaskElement[];
 getAppState(): ExcalidrawTaskState;
 onChange(listener: (elements: readonly ExcalidrawTaskElement[], state: ExcalidrawTaskState) => void): () => void;
 selectElements(elements: ExcalidrawTaskElement[]): void;
}
export interface ExcalidrawElementAction { id: string; title: string; icon: string; action: () => void; }
export interface ExcalidrawTaskEA {
 style: Record<string, unknown>;
 getViewLastPointerPosition?(): { x: number; y: number };
 getViewCenterPosition(): { x: number; y: number } | null;
 addEmbeddable(x: number, y: number, width: number, height: number, link: string, file: undefined, props: Record<string, unknown>): string;
 addElementsToView(reposition: boolean, save: boolean, onTop: boolean, restore?: boolean, captureUpdate?: 'NEVER'): Promise<boolean>;
 copyViewElementsToEAforEditing?(elements: readonly ExcalidrawTaskElement[]): void;
 getElement?(id: string): ExcalidrawTaskElement | undefined;
 registerElementActionProvider?(getActions: (element: ExcalidrawTaskElement) => readonly ExcalidrawElementAction[]): (() => void) | null;
 getSceneFromFile(file: TFile): Promise<{ elements: ExcalidrawTaskElement[] } | null>;
 destroy(): void;
}
interface ExcalidrawTaskPlugin {
 _loaded: boolean;
 ea: { getAPI(view: ExcalidrawTaskView): ExcalidrawTaskEA };
}
export interface ExcalidrawTaskView {
 file: TFile | null; data: string; contentEl: HTMLElement; plugin: ExcalidrawTaskPlugin;
 _loaded: boolean; compatibilityMode?: boolean;
 excalidrawAPI: ExcalidrawTaskAPI;
 forceSave(silent: boolean, waitIfBusy: boolean): Promise<void>;
 updateScene?(update: { elements: ExcalidrawTaskElement[]; captureUpdate: 'NEVER'; appState?: { activeEmbeddable: null } }): void;
 setDirty?(): void;
 getViewType(): string;
 getEmbeddableLeafElementById(id: string): { node?: { containerEl: HTMLElement; file: TFile } } | null;
}
export function readExcalidrawTaskView(app: App, value: unknown): ExcalidrawTaskView | null {
 const view = value as Partial<ExcalidrawTaskView> | null;
 const plugin = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['obsidian-excalidraw-plugin'];
 if (!view || !plugin || view.plugin !== plugin || view.plugin._loaded !== true || !view._loaded
  || view.getViewType?.() !== 'excalidraw' || !(view.file instanceof TFile) || view.file.extension !== 'md'
  || view.compatibilityMode || typeof view.data !== 'string' || !view.contentEl
  || typeof view.forceSave !== 'function' || typeof view.getEmbeddableLeafElementById !== 'function'
  || typeof view.plugin.ea?.getAPI !== 'function') return null;
 const api = view.excalidrawAPI;
 if (!api || typeof api.getSceneElements !== 'function' || typeof api.getAppState !== 'function'
  || typeof api.onChange !== 'function' || typeof api.selectElements !== 'function') return null;
 return view as ExcalidrawTaskView;
}
export const excalidrawTaskHeading = (id: string): string => `Operon task ${id}`;
export const excalidrawTaskBody = (id: string): string => `\`\`\`operon\nview: card\ntaskId: ${id}\n\`\`\``;

/** Inspect ordinary Markdown only; the scene suffix remains byte-for-byte intact. */
export function excalidrawTaskReference(data: string, id: string): 'missing' | 'present' | 'conflict' {
 if (!isValidOperonId(id)) return 'conflict';
 let boundary: { index: number };
 try { boundary = { index: readExcalidrawMarkdownSections(data).dataStart }; } catch { return 'conflict'; }
 const header = data.slice(0, boundary.index).replace(/\r\n/g, '\n');
 const title = `# ${excalidrawTaskHeading(id)}`;
 const lines = header.split('\n'), hits = lines.flatMap((line, index) => line === title ? [index] : []);
 if (!hits.length) return 'missing';
 if (hits.length !== 1) return 'conflict';
 const start = hits[0] + 1;
 let end = start;
 while (end < lines.length && !/^#(?: |$)/.test(lines[end])) end++;
 return lines.slice(start, end).join('\n').trim() === excalidrawTaskBody(id) ? 'present' : 'conflict';
}
export function appendExcalidrawTaskReference(data: string, id: string): string {
 const state = excalidrawTaskReference(data, id);
 if (state === 'conflict') throw new Error('Invalid or conflicting task reference');
 if (state === 'present') return data;
 const boundary = { index: readExcalidrawMarkdownSections(data).dataStart };
 const newline = data.includes('\r\n') ? '\r\n' : '\n';
 const section = `# ${excalidrawTaskHeading(id)}\n\n${excalidrawTaskBody(id)}\n\n`.replace(/\n/g, newline);
 const insertion = readExcalidrawMarkdownSections(data).imagesStart ?? boundary.index;
 return data.slice(0, insertion) + newline + section + data.slice(insertion);
}
export function isExcalidrawTaskLink(app: App, view: ExcalidrawTaskView, link: string | null | undefined, id: string): boolean {
 const match = /^\[\[([^\]\n]*?)#(Operon task [a-z0-9]{7})\]\]$/.exec(link ?? '');
 return !!view.file && !!match && match[2] === excalidrawTaskHeading(id)
  && app.metadataCache.getFirstLinkpathDest(match[1], view.file.path) === view.file
  && excalidrawTaskReference(view.data, id) === 'present';
}
/** A scene reference is valid even when its embedded card is offscreen. */
export function excalidrawSceneTaskId(app: App, view: ExcalidrawTaskView, element: ExcalidrawTaskElement): string | null {
 const id = /#Operon task ([a-z0-9]{7})\]\]$/.exec(element.link ?? '')?.[1];
 return !element.isDeleted && element.type === 'embeddable' && id && isExcalidrawTaskLink(app, view, element.link, id) ? id : null;
}
/** Resolve native embed ownership and its single reference without mounting another card. */
export function readExcalidrawCardReference(app: App, view: ExcalidrawTaskView, element: ExcalidrawTaskElement, expectedId?: string): { taskId: string; node: HTMLElement; container: HTMLElement } | null {
 const taskId = excalidrawSceneTaskId(app, view, element);
 if (!taskId || expectedId && taskId !== expectedId) return null;
 const ref = view.getEmbeddableLeafElementById(element.id)?.node;
 const container = ref?.containerEl, node = container?.closest<HTMLElement>('.canvas-node');
 return ref?.file === view.file && container && node?.isConnected && view.contentEl.contains(node) ? { taskId, node, container } : null;
}
/** originalText contains explicit newlines, unlike the display text after wrapping. */
export function excalidrawConvertibleText(element: ExcalidrawTaskElement): string | null {
 if (element.type !== 'text' || element.isDeleted || element.locked !== false || element.containerId != null) return null;
 const text = typeof element.originalText === 'string' ? element.originalText : element.text;
 return typeof text === 'string' && text.trim() ? text : null;
}
export interface ExcalidrawTextReplacement { elementId: string; text: string; }
export class ExcalidrawTaskSaveError extends Error {}

/** Revalidate after awaits; native save may swallow errors, so verify persisted results. */
export async function insertExcalidrawTask(app: App, view: ExcalidrawTaskView, id: string, allowed: () => boolean, position?: { x: number; y: number }, width = DEFAULT_TASK_CARD_SETTINGS.excalidrawTaskCardWidth, replacement?: ExcalidrawTextReplacement): Promise<void> {
 const file = view.file;
 if (!file) throw new Error('Drawing unavailable');
 return serializeExcalidrawSource(app, file, () => insertExcalidrawTaskInQueue(app, view, id, allowed, position, TASK_CARD_WIDTHS.includes(width) ? width : DEFAULT_TASK_CARD_SETTINGS.excalidrawTaskCardWidth, replacement));
}
async function insertExcalidrawTaskInQueue(app: App, view: ExcalidrawTaskView, id: string, allowed: () => boolean, position?: { x: number; y: number }, width = DEFAULT_TASK_CARD_SETTINGS.excalidrawTaskCardWidth, replacement?: ExcalidrawTextReplacement): Promise<void> {
 const file = view.file, path = file?.path;
 let applied = false;
 const source = () => view.excalidrawAPI.getSceneElements().find(element => element.id === replacement?.elementId);
 const current = () => !!file && view.file === file && file.path === path && allowed()
  && (!replacement || applied || !!source() && excalidrawConvertibleText(source()!) === replacement.text);
 if (!file || !current()) throw new Error('Drawing unavailable');
 const ea = view.plugin.ea.getAPI(view);
 let writeAttempted = false;
 try {
  for (const method of ['getViewCenterPosition', 'addEmbeddable', 'addElementsToView', 'getSceneFromFile', 'destroy'] as const)
   if (typeof ea?.[method] !== 'function') throw new Error('Excalidraw API unavailable');
  if (replacement && typeof ea.getElement !== 'function') throw new Error('Excalidraw editing API unavailable');
  if (!await saveExcalidrawTaskSceneInQueue(app, view, current)) throw new Error('Drawing changed');
  if (!current()) throw new Error('Drawing changed');
  // Use the native TextFileView buffer and native serializer, without replacing the file externally.
  const data = appendExcalidrawTaskReference(view.data, id);
  writeAttempted = true;
  view.data = data;
  await view.forceSave(true, true);
  if (!current()) throw new Error('Drawing changed');
  const savedReference = await app.vault.read(file);
  if (!current()) throw new Error('Drawing changed');
  if (excalidrawTaskReference(savedReference, id) !== 'present') throw new ExcalidrawTaskSaveError();
  const point = position ?? ea.getViewCenterPosition();
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Drawing coordinates unavailable');
  const state = view.excalidrawAPI.getAppState();
  const styles: Record<string, string> = { strokeColor: 'currentItemStrokeColor', backgroundColor: 'currentItemBackgroundColor',
   strokeWidth: 'currentItemStrokeWidth', strokeStyle: 'currentItemStrokeStyle', roughness: 'currentItemRoughness',
   opacity: 'currentItemOpacity', fillStyle: 'currentItemFillStyle' };
  for (const [key, setting] of Object.entries(styles)) if (state[setting] !== undefined) ea.style[key] = state[setting];
  const roundness = state.currentItemRoundness;
  if (roundness === 'round' || roundness === 'sharp') ea.style.strokeSharpness = roundness;
  else if (roundness !== undefined) { ea.style.strokeSharpness = undefined; ea.style.roundness = roundness; }
  const link = `[[${path}#${excalidrawTaskHeading(id)}]]`;
  let elementId = ea.addEmbeddable(point.x - width / 2, point.y - 150, width, 300, link, undefined, {
   useObsidianDefaults: false, backgroundMatchElement: true, backgroundOpacity: 100,
   borderMatchElement: true, borderOpacity: 0, filenameVisible: false, propertiesVisible: false, lockedReadingMode: true,
  });
  if (!elementId || !current()) throw new Error('Drawing changed');
  if (replacement) {
   const before = source()!, element = ea.getElement!(elementId);
   if (!element || ![before.x, before.y, before.angle ?? 0].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Drawing coordinates unavailable');
   // EA inserts its staged values by element.id. Reusing the source identity keeps
   // the native scene order, bindings and history while discarding text-only fields.
   Object.assign(element, { id: before.id, x: before.x, y: before.y, angle: before.angle ?? 0,
    groupIds: before.groupIds, frameId: before.frameId, boundElements: before.boundElements,
    index: before.index, version: typeof before.version === 'number' ? before.version + 1 : 1 });
   elementId = before.id;
  }
  // The only scene mutation is one native undoable replacement; later guards check
  // drawing ownership rather than requiring the replaced text to remain present.
  applied = true;
  if (!await ea.addElementsToView(false, false, true)) throw new ExcalidrawTaskSaveError();
  if (!current()) throw new Error('Drawing changed');
  await view.forceSave(true, true);
  if (!current()) throw new Error('Drawing changed');
  const saved = await ea.getSceneFromFile(file);
  if (!current()) throw new Error('Drawing changed');
  if (!saved?.elements.some(element => element.id === elementId && element.type === 'embeddable' && !element.isDeleted && element.link === link)) throw new ExcalidrawTaskSaveError();
  const element = view.excalidrawAPI.getSceneElements().find(value => value.id === elementId && !value.isDeleted);
  if (element) view.excalidrawAPI.selectElements([element]);
 } catch (error) {
  if (writeAttempted) throw new ExcalidrawTaskSaveError();
  throw error;
 } finally { ea?.destroy?.(); }
}
