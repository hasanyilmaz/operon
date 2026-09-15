import type { IndexedTask } from '../../types/fields';
import { cleanupOperonRenderRoot } from '../render-root-cleanup';

interface RowContext {
 task: IndexedTask;
 state: object;
 assigneeSignature: string;
 rowSignature: string;
 cellSignatures: Map<string | undefined, string>;
 cellContexts: Map<string | undefined, Pick<RowContext, 'task' | 'state'>>;
}
const contexts = new WeakMap<HTMLElement, RowContext>();

/** Private snapshots keep retained cell handlers current without mutating the index. */
export function rememberTableRowContext(row: HTMLElement, task: IndexedTask, state: object, assigneeSignature: string, bindingSignature = ''): void {
 // Index freshness alone is not visible content; displayed timestamps remain in the markup.
 const rowSignature = JSON.stringify([{ ...task, datetimeModified: undefined }, bindingSignature, row.outerHTML?.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label')]);
 const cellSignatures = new Map(Array.from(row.children, child => {
  const cell = child as HTMLElement;
  const key = cell.dataset.column;
  return [key, JSON.stringify([key === 'assignees' ? assigneeSignature : bindingSignature,
   task.primary, key ? task.fieldValues[key] : null,
   cell.outerHTML?.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label')])];
 }));
 const cellContexts = new Map(Array.from(row.children, child => [(child as HTMLElement).dataset.column, { task, state }]));
 contexts.set(row, { task, state, assigneeSignature, rowSignature, cellSignatures, cellContexts });
}

function replaceSnapshot(target: object, source: object): void {
 for (const key of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(source, key)) Reflect.deleteProperty(target, key);
 Object.assign(target, source);
}

/** Keep unchanged cell bindings attached; changed values still use their existing renderers. */
export function refreshTableRow(current: HTMLElement, fresh: HTMLElement): HTMLElement {
 const previous = contexts.get(current);
 const next = contexts.get(fresh);
 if (!previous || !next || previous.task.operonId !== next.task.operonId) {
  cleanupOperonRenderRoot(current);
  current.replaceWith(fresh);
  return fresh;
 }
 replaceSnapshot(previous.task, next.task);
 replaceSnapshot(previous.state, next.state);
 for (const owner of new Set(previous.cellContexts.values())) {
  replaceSnapshot(owner.task, next.task);
  replaceSnapshot(owner.state, next.state);
 }
 if (previous.rowSignature === next.rowSignature && previous.assigneeSignature === next.assigneeSignature) {
  cleanupOperonRenderRoot(fresh);
  return current;
 }
 for (const name of current.getAttributeNames()) if (!fresh.hasAttribute(name)) current.removeAttribute(name);
 for (const name of fresh.getAttributeNames()) {
  let value = fresh.getAttribute(name)!;
  if (name === 'class' && current.dataset.operonRowIndex === fresh.dataset.operonRowIndex && current.classList.contains('is-operon-linked-row-hover')) value += ' is-operon-linked-row-hover';
  if (current.getAttribute(name) !== value) current.setAttribute(name, value);
 }
 const oldCells = new Map(Array.from(current.children, cell => [(cell as HTMLElement).dataset.column, cell as HTMLElement]));
 const desired: HTMLElement[] = [];
 for (const cell of Array.from(fresh.children)) {
  const incoming = cell as HTMLElement;
  const existing = oldCells.get(incoming.dataset.column);
  oldCells.delete(incoming.dataset.column);
  if (existing && previous.cellSignatures.get(incoming.dataset.column) === next.cellSignatures.get(incoming.dataset.column)) {
   desired.push(existing);
   const owner = previous.cellContexts.get(incoming.dataset.column);
   if (owner) next.cellContexts.set(incoming.dataset.column, owner);
   cleanupOperonRenderRoot(incoming);
  } else {
   desired.push(incoming);
   if (existing) {
    cleanupOperonRenderRoot(existing);
    existing.replaceWith(incoming);
   } else current.appendChild(incoming);
  }
 }
 for (const cell of oldCells.values()) { cleanupOperonRenderRoot(cell); cell.remove(); }
 let cursor = current.firstElementChild;
 for (const cell of desired) {
  if (cell === cursor) cursor = cursor.nextElementSibling;
  else current.insertBefore(cell, cursor);
 }
 contexts.set(current, next);
 cleanupOperonRenderRoot(fresh);
 return current;
}
