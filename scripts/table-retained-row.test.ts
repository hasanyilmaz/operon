import assert from 'node:assert/strict';
import type { IndexedTask } from '../src/types/fields';
import { rememberTableRowContext, refreshTableRow } from '../src/ui/table/table-retained-row';
import { createTableVirtualRowCache, reconcileTableVirtualRows } from '../src/ui/table/table-virtual-row-reconciler';

class Element {
 children: Element[] = [];
 parent: Element | null = null;
 dataset: { column?: string } = {};
 attrs = new Map<string, string>();
 detachments = 0;
 scrollTop = 17;
 constructor(column?: string) { this.dataset.column = column; }
 get firstElementChild() { return this.children[0] ?? null; }
 get nextElementSibling(): Element | null { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
 appendChild(child: Element) { return this.insertBefore(child, null); }
 insertBefore(child: Element, cursor: Element | null) {
  child.remove(); child.parent = this;
  this.children.splice(cursor ? this.children.indexOf(cursor) : this.children.length, 0, child); return child;
 }
 remove() { if (!this.parent) return; this.detachments++; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
 replaceWith(fresh: Element) { this.parent?.insertBefore(fresh, this); this.remove(); }
 querySelector() { return this.children.find(child => child.dataset.column === 'assignees') ?? null; }
 querySelectorAll(selector: string): Element[] { return selector === '*' ? this.children.flatMap(child => [child, ...child.querySelectorAll('*')]) : []; }
 getAttributeNames() { return [...this.attrs.keys()]; }
 getAttribute(name: string) { return this.attrs.get(name) ?? null; }
 hasAttribute(name: string) { return this.attrs.has(name); }
 setAttribute(name: string, value: string) { this.attrs.set(name, value); }
 removeAttribute(name: string) { this.attrs.delete(name); }
}
const dom = (element: Element) => element as unknown as HTMLElement;
function fixture(signature = 'Bobby', version = 1) {
 const row = new Element();
 const task = { operonId: 'a', fieldValues: { assignees: signature, status: String(version) } } as unknown as IndexedTask;
 const state = { version };
 const status = new Element('status'); const assignee = new Element('assignees'); const tail = new Element('duration');
 row.appendChild(status); row.appendChild(assignee); row.appendChild(tail);
 rememberTableRowContext(dom(row), task, state, signature);
 return { row, task, state, assignee, status, tail };
}
export function testTableRetainedRows(): void {
 const host = new Element(); const old = fixture(); host.appendChild(old.row);
 const next = fixture('Bobby', 2);
 assert.equal(refreshTableRow(dom(old.row), dom(next.row)), dom(old.row));
 assert.equal(old.row.parent, host); assert.equal(old.row.detachments, 0);
 assert.equal(old.assignee.parent, old.row); assert.equal(old.assignee.detachments, 0);
 assert.deepEqual(old.row.children, [next.status, old.assignee, next.tail]);
 assert.equal(old.task.fieldValues.status, '2'); assert.equal(old.state.version, 2);
 assert.equal(old.row.scrollTop, 17);
 const changed = fixture('Alice', 3);
 refreshTableRow(dom(old.row), dom(changed.row));
 assert.equal(old.assignee.parent, null); assert.equal(changed.assignee.parent, old.row);
 const fourth = fixture('Alice', 4);
 refreshTableRow(dom(old.row), dom(fourth.row));
 assert.equal(changed.task.fieldValues.status, '4', 'replacement handlers receive later updates too');
 assert.equal(changed.assignee.detachments, 1, 'only its initial staging-to-row move occurred');
 const empty = fixture('', 5); empty.assignee.remove();
 refreshTableRow(dom(old.row), dom(empty.row));
 assert.equal(old.row.querySelector(), null);
 const cache = createTableVirtualRowCache<{ key: string; revision: number }>();
 const options = {
  cache, host: {}, renderIdentity: {}, items: ['a', 'b'], startIndex: 0, endIndex: 2,
  resolveKey: (key: string) => key, createRow: ({ key }: { key: string }) => ({ key, revision: 0 }),
  removeRow: () => {}, refreshRow: (row: { key: string; revision: number }) => { row.revision++; return row; },
 };
 const first = reconcileTableVirtualRows(options);
 const second = reconcileTableVirtualRows({ ...options, renderIdentity: {}, forceReset: true, items: ['b', 'a'] });
 assert.equal(second.entries[0]!.row, first.entries[1]!.row);
 assert.equal(second.entries[1]!.row.revision, 1);
 const third = reconcileTableVirtualRows({ ...options, renderIdentity: {}, items: ['b'], endIndex: 1 });
 assert.equal(third.stats.removed, 1);
 const newHost = reconcileTableVirtualRows({ ...options, host: {} });
 assert.notEqual(newHost.entries[0]!.row, first.entries[0]!.row, 'new shell must reset');
}
