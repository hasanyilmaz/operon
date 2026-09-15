import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openLightbox } from '../src/ui/lightbox';

import { lightboxFixture as fixture } from './test-support/lightbox-dom';

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
