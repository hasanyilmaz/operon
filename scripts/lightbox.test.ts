import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openLightbox } from '../src/ui/lightbox';

function fixture() {
 const listeners = new Map<string, Set<(event: any) => void>>();
 const doc: any = { activeElement: null, addEventListener(k: string, fn: (e: any) => void) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(fn); }, removeEventListener(k: string, fn: (e: any) => void) { listeners.get(k)?.delete(fn); } };
 class Element {
  ownerDocument = doc; children: Element[] = []; parent: Element | null = null; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; tagName = 'DIV'; id = ''; textContent = ''; connected = true;
  events = new Map<string, (event: any) => void>();
  get isConnected(): boolean { return this.connected && (!this.parent || this.parent.isConnected); }
  addClass() {} setAttribute(k: string, v: string) { this.attrs[k] = v; } removeAttribute(k: string) { delete this.attrs[k]; }
  querySelector() { return null; }
  appendChild(el: Element) { el.parent = this; this.children.push(el); return el; }
  createDiv(options?: any) { return this.createEl('div', options); }
  createEl(tag: string, options?: any) { const el = new Element(); el.tagName = tag.toUpperCase(); el.textContent = options?.text ?? ''; return this.appendChild(el); }
  addEventListener(k: string, fn: (event: any) => void) { this.events.set(k, fn); }
  contains(el: Element): boolean { return el === this || this.children.some(child => child.contains(el)); }
  focus() { doc.activeElement = this; }
  remove() { this.connected = false; }
 }
 doc.defaultView = { HTMLElement: Element }; doc.win = { createSpan: () => new Element() }; doc.body = new Element();
 const anchor = doc.body.createDiv(); anchor.focus();
 return { doc, anchor: anchor as unknown as HTMLElement, listeners, emit: (key: string, event: any) => [...(listeners.get(key) ?? [])].forEach(fn => fn(event)) };
}

test('shell closes once, removes listeners and restores owner-document focus', () => {
 const f = fixture(); let cleaned = 0; let root: HTMLElement;
 const close = openLightbox(f.anchor, { title: 'Image', render: el => { root = el; return () => cleaned++; } });
 assert.equal(root!.getAttribute?.('role') ?? (root! as any).attrs.role, 'dialog');
 f.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); close();
 assert.equal(cleaned, 1); assert.equal(root!.isConnected, false); assert.equal(f.doc.activeElement, f.anchor);
 assert.equal(f.listeners.get('keydown')!.size, 0); assert.equal(f.listeners.get('focusin')!.size, 0);
});
test('one lightbox per document, independent windows and outside click', () => {
 const a = fixture(), b = fixture(); let cleaned = 0; let root: any;
 openLightbox(a.anchor, { title: 'First', render: () => () => cleaned++ });
 const closeB = openLightbox(b.anchor, { title: 'Other window', render: () => null });
 const closeA = openLightbox(a.anchor, { title: 'Next', render: el => { root = el; return null; } });
 assert.equal(cleaned, 1); assert.equal(b.listeners.get('keydown')!.size, 1);
 root.events.get('click')({target:root.children[0]}); assert.equal(root.isConnected, true);
 root.events.get('click')({target:root}); assert.equal(root.isConnected, false); closeA(); closeB();
});
test('focus stays inside, disconnected original focus falls back to anchor', () => {
 const f = fixture(); const original = f.doc.body.createDiv(); original.focus(); let root: any;
 const close = openLightbox(f.anchor, { title: 'PDF', render: el => { root = el; return null; } });
 f.emit('focusin', {target:f.anchor}); assert.equal(f.doc.activeElement, root.children[1]);
 original.remove(); close(); assert.equal(f.doc.activeElement, f.anchor);
});
test('synchronous close during render cleans returned content without resurrecting shell', () => {
 const f = fixture(); let cleaned = 0;
 openLightbox(f.anchor, { title: 'Error', render: (_el, close) => { close(); return () => cleaned++; } });
 assert.equal(cleaned, 1); assert.equal(f.listeners.get('keydown')!.size, 0);
});
test('render and cleanup exceptions still remove dialog and listeners', () => {
 const f = fixture();
 assert.throws(() => openLightbox(f.anchor, { title: 'Error', render: () => { throw Error('render'); } }), /render/);
 const close = openLightbox(f.anchor, { title: 'Error', render: () => () => { throw Error('cleanup'); } });
 assert.throws(close, /cleanup/); close(); assert.equal(f.listeners.get('keydown')!.size, 0); assert.equal(f.doc.activeElement, f.anchor);
});
