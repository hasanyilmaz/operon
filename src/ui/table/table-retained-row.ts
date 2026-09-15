import type { IndexedTask } from '../../types/fields';
import { cleanupOperonRenderRoot } from '../render-root-cleanup';

interface RowContext {
 task: IndexedTask;
 state: object;
 assigneeSignature: string;
}
const contexts = new WeakMap<HTMLElement, RowContext>();

/** Private snapshots keep retained cell handlers current without mutating the index. */
export function rememberTableRowContext(row: HTMLElement, task: IndexedTask, state: object, assigneeSignature: string): void {
 contexts.set(row, { task, state, assigneeSignature });
}

function replaceSnapshot(target: object, source: object): void {
 for (const key of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(source, key)) Reflect.deleteProperty(target, key);
 Object.assign(target, source);
}

/** Only task rows and unchanged assignee cells are retained; other cell renderers keep their lifecycle. */
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
 const oldAssignee = current.querySelector<HTMLElement>(':scope > [data-column="assignees"]');
 const newAssignee = fresh.querySelector<HTMLElement>(':scope > [data-column="assignees"]');
 const keepAssignee = oldAssignee && newAssignee && previous.assigneeSignature === next.assigneeSignature;
 for (const name of current.getAttributeNames()) if (!fresh.hasAttribute(name)) current.removeAttribute(name);
 for (const name of fresh.getAttributeNames()) {
  const value = fresh.getAttribute(name)!;
  if (current.getAttribute(name) !== value) current.setAttribute(name, value);
 }
 const oldCells = new Map(Array.from(current.children, cell => [(cell as HTMLElement).dataset.column, cell as HTMLElement]));
 const desired: HTMLElement[] = [];
 for (const cell of Array.from(fresh.children)) {
  const incoming = cell as HTMLElement;
  const existing = oldCells.get(incoming.dataset.column);
  oldCells.delete(incoming.dataset.column);
  if (keepAssignee && incoming === newAssignee) {
   desired.push(oldAssignee);
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
 contexts.set(current, keepAssignee ? previous : next);
 cleanupOperonRenderRoot(fresh);
 return current;
}
