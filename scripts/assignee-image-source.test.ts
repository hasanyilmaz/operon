import { bindTableCompactAssigneeImage } from '../src/ui/table/table-assignee-image';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TFile } from 'obsidian';
import { resolveAssigneeImageSource } from '../src/core/assignee-image-source';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';

function fixture(value: unknown) {
 const person = Object.assign(Object.create(TFile.prototype), { path: 'People/Mehmet.md', extension: 'md' });
 const photo = Object.assign(Object.create(TFile.prototype), { path: 'People/photo.png', extension: 'png' });
 const calls: string[][] = [];
 const app: any = {
  metadataCache: {
   getFirstLinkpathDest(target: string, source: string) { calls.push([target, source]); return target === 'Mehmet' ? person : target === 'photo.png' ? photo : null; },
   getFileCache() { return { frontmatter: { avatar: value } }; },
  },
  vault: { getResourcePath(file: TFile) { return 'resource:' + file.path; } },
 };
 return { app, calls };
}
test('assignee source resolves alias and image relative to the person note', () => {
 const { app, calls } = fixture('[[photo.png]]');
 assert.deepEqual(resolveAssigneeImageSource(app, '[[Mehmet|Meh]]', 'Daily.md', ' avatar '), {
  personPath: 'People/Mehmet.md', imagePath: 'People/photo.png', src: 'resource:People/photo.png',
 });
 assert.deepEqual(calls, [['Mehmet', 'Daily.md'], ['photo.png', 'People/Mehmet.md']]);
});
test('empty, unsupported, missing and plain-text sources retain canonical fallback', () => {
 for (const value of ['', null, undefined, ['photo.png'], {}, '[[missing.png]]', 'javascript:alert(1)']) {
  const { app } = fixture(value);
  assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', 'avatar'), null);
 }
 const { app, calls } = fixture('[[photo.png]]');
 assert.equal(resolveAssigneeImageSource(app, 'Mehmet', 'Daily.md', 'avatar'), null);
 assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', ''), null);
 assert.deepEqual(calls, []);
 assert.equal(resolveAssigneeImageSource(app, '[[Missing]]', 'Daily.md', 'avatar'), null);
});
test('direct image URL is resolved without fetching', () => {
 const { app } = fixture('https://example.com/photo.png');
 assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', 'avatar')?.src, 'https://example.com/photo.png');
});
test('setting defaults empty, normalizes, and survives settings-package roundtrip', () => {
 assert.equal(DEFAULT_SETTINGS.assigneeImageProperty, '');
 assert.equal(migrateSettings({}).assigneeImageProperty, '');
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, assigneeImageProperty: ' photo ' });
 assert.equal(settings.assigneeImageProperty, 'photo');
 const pack = buildOperonDataPackageFromSettings(settings);
 assert.equal(pack.ui.taskUiPreferences.assigneeImageProperty, 'photo');
 assert.equal(composeOperonSettingsFromDataPackage(pack, DEFAULT_SETTINGS).assigneeImageProperty, 'photo');
});

test('General Chip Settings is last and exposes a free-text searchable setting', () => {
 const ui = readFileSync('src/ui/settings-tab.ts', 'utf8');
 const order = ui.slice(ui.indexOf('const TASK_CHIPS_SETTINGS_PAGE_ORDER'), ui.indexOf('const TASK_CHIPS_SETTINGS_PAGE_META'));
 assert.match(order, /'taskCardChips',\s*'generalChipSettings',\s*\];/);
 assert.ok(ui.includes("entryIds: ['assigneeImageProperty']"));
 assert.ok(ui.includes("pageId === 'generalChipSettings'"));
 assert.ok(ui.includes('new TextValueSuggest(this.app, text.inputEl, () => collectFileTaskMigrationPropertyKeyCandidates(this.app))'));
 const registry = readFileSync('src/ui/settings/settings-search-registry.ts', 'utf8');
 assert.match(registry, /'ui', 'interfaceTaskChips', 'assigneeImageProperty'.*'text'/);
});

import { bindAssigneeChipImage, bindAssigneeIconImage, refreshAssigneeChipImages, disposeAssigneeChipImages } from '../src/ui/assignee-chip-image';

function imageUiFixture() {
 const { app } = fixture('https://example.com/photo.png');
 let source = 'https://example.com/photo.png';
 app.metadataCache.getFileCache = () => ({ frontmatter: { avatar: source } });
 const listeners = new Set<() => void>();
 const on = (_name: string, fn: () => void) => { listeners.add(fn); return fn; };
 const offref = (fn: () => void) => listeners.delete(fn);
 Object.assign(app.metadataCache, { on, offref });
 Object.assign(app.vault, { on, offref });
 const frames: Array<() => void> = [];
 let pagehide = () => {};
 const observers: Array<{ callback: (records: any[]) => void; disconnected: boolean }> = [];
 const prior = globalThis.MutationObserver;
 globalThis.MutationObserver = class {
  disconnected = false;
  constructor(public callback: (records: any[]) => void) { observers.push(this); }
  observe() {} disconnect() { this.disconnected = true; }
 } as any;
 const images: any[] = [];
 const classes = new Set<string>();
 const doc: any = { body: {}, defaultView: { addEventListener(_event: string, fn: () => void) { pagehide = fn; }, removeEventListener() { pagehide = () => {}; }, requestAnimationFrame: (fn: () => void) => frames.push(fn) }, createElement: () => {
  const image: any = { setAttribute() {}, remove() { image.removed = true; } };
  images.push(image); return image;
 } };
 doc.win = { createEl: doc.createElement };
 const icon: any = { contains: (image: any) => !image.removed, ownerDocument: doc, isConnected: true, classList: { add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s) }, appendChild() {} };
 const chip: any = { querySelector: () => icon };
 return { app, chip, icon, classes, images, observers, listeners,
  bind: (key = 'assignees', target: string | null = 'Mehmet') => bindAssigneeChipImage(chip, { key, linkTarget: target }, app, 'Daily.md', 'avatar'),
  closeWindow: () => pagehide(),
  frame: () => { while (frames.length) frames.shift()!(); },
  change: async (value: string) => { source = value; for (const fn of listeners) (fn as any)({ path: 'People/Mehmet.md' }); await Promise.resolve(); },
  cleanup: () => { disposeAssigneeChipImages(app); globalThis.MutationObserver = prior; },
 };
}

test('image loads in the existing slot; stale load and errors retain canonical fallback', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame();
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].hidden, true);
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
  const staleLoad = f.images[0].onload;
  await f.change('https://example.com/other.png');
  staleLoad();
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
  f.images[1].onload();
  assert.equal(f.classes.has('is-assignee-image-ready'), true);
  assert.equal(f.images[1].hidden, false);
  await f.change('https://example.com/broken.png');
  f.images[2].onerror();
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
  assert.equal(f.images[2].removed, true);
  await f.change('');
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
 } finally { f.cleanup(); }
});

test('setting changes update existing icons, and detached chips release observers and events', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame(); f.images[0].onload();
  refreshAssigneeChipImages(f.app, ''); await Promise.resolve();
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
  refreshAssigneeChipImages(f.app, 'avatar'); await Promise.resolve();
  assert.equal(f.images.length, 2);
  f.icon.isConnected = false;
  f.observers[0].callback([{ removedNodes: [{}] }]);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.images[1].onload, null);
 } finally { f.cleanup(); }
});

test('other fields and unlinked people never acquire an image binding', () => {
 const f = imageUiFixture();
 try {
  f.bind('contexts'); f.bind('assignees', null); f.frame();
  assert.equal(f.images.length, 0); assert.equal(f.listeners.size, 0);
 } finally { f.cleanup(); }
});

test('local image changes invalidate its source while unrelated DOM removals do not reload it', async () => {
 const f = imageUiFixture();
 try {
  const photo = f.app.metadataCache.getFirstLinkpathDest('photo.png', 'People/Mehmet.md');
  photo.stat = { mtime: 1 };
  f.app.vault.getAbstractFileByPath = () => photo;
  await f.change('[[photo.png]]');
  f.bind(); f.frame();
  assert.match(f.images[0].src, /operonImageVersion=1$/);
  f.observers[0].callback([{ removedNodes: [{}] }]);
  assert.equal(f.images.length, 1);
  photo.stat.mtime = 2;
  await f.change('[[photo.png]]');
  assert.equal(f.images.length, 2);
  assert.match(f.images[1].src, /operonImageVersion=2$/);
 } finally { f.cleanup(); }
});

test('queued work from a disposed binding cannot dispose its replacement', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); refreshAssigneeChipImages(f.app, 'avatar');
  disposeAssigneeChipImages(f.app);
  f.bind(); f.frame(); await Promise.resolve();
  assert.equal(f.images.length, 2);
  assert.equal(f.images[0].removed, true);
  assert.ok(f.listeners.size > 0);
  refreshAssigneeChipImages(f.app, ''); await Promise.resolve();
  assert.equal(f.images[1].removed, true);
 } finally { f.cleanup(); }
});


test('closing a secondary window releases its still-connected chip bindings', () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame();
  f.closeWindow();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.images[0].onload, null);
  assert.equal(f.observers[0].disconnected, true);
 } finally { f.cleanup(); }
});

test('multiple people keep independent image and fallback state in one document', () => {
 const f = imageUiFixture();
 try {
  const otherClasses = new Set<string>();
  const otherIcon = { ...f.icon, classList: { add: (value: string) => otherClasses.add(value), remove: (value: string) => otherClasses.delete(value) } };
  f.bind();
  bindAssigneeChipImage({ querySelector: () => otherIcon } as any, { key: 'assignees', linkTarget: 'Missing' }, f.app, 'Daily.md', 'avatar');
  f.frame();
  assert.equal(f.images.length, 1);
  f.images[0].onload();
  assert.equal(f.classes.has('is-assignee-image-ready'), true);
  assert.equal(otherClasses.has('is-assignee-image-ready'), false);
  f.icon.isConnected = false;
  f.observers[0].callback([{ removedNodes: [{}] }]);
  assert.ok(f.listeners.size > 0);
  otherIcon.isConnected = false;
  f.observers[0].callback([{ removedNodes: [{}] }]);
  assert.equal(f.listeners.size, 0);
 } finally { f.cleanup(); }
});

test('deleted property or unavailable person falls back on the existing icon', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame(); f.images[0].onload();
  f.app.metadataCache.getFileCache = () => ({ frontmatter: {} });
  await f.change('');
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
  f.app.metadataCache.getFileCache = () => ({ frontmatter: { avatar: 'https://example.com/photo.png' } });
  await f.change(''); f.images[1].onload();
  assert.equal(f.classes.has('is-assignee-image-ready'), true);
  f.app.metadataCache.getFirstLinkpathDest = () => null;
  await f.change('');
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
 } finally { f.cleanup(); }
});

 test('table compact avatars bind only one linked assignee and preserve the canonical SVG', () => {
  const f = imageUiFixture();
  try {
   const svg = {};
   let slots = 0;
   const moved: unknown[] = [];
   const control: any = {
    querySelector: () => svg,
    createSpan: () => { slots++; return Object.assign(f.icon, { setAttribute() {}, appendChild(node: unknown) { moved.push(node); } }); },
   };
   for (const [key, value] of [['contexts', '[[Mehmet]]'], ['assignees', ''], ['assignees', 'Mehmet'], ['assignees', '[[Mehmet]]; Hasan']]) {
    bindTableCompactAssigneeImage(control, key, value, f.app, 'Daily.md', 'avatar');
   }
   assert.equal(slots, 0);
   bindTableCompactAssigneeImage(control, 'assignees', '[[Mehmet|Meh]]', f.app, 'Daily.md', 'avatar');
   assert.equal(slots, 1);
   assert.equal(moved[0], svg);
   assert.equal(moved[1], f.images[0]);
   f.frame();
   assert.equal(f.images.length, 1);
  } finally { f.cleanup(); }
 });


test('same icon binding is idempotent and cached sources are visible before the next frame across surfaces', () => {
 const f = imageUiFixture();
 try {
  f.bind();
  assert.equal(f.images.length, 1, 'starts before requestAnimationFrame');
  f.images[0].onload();
  f.bind();
  assert.equal(f.images.length, 1, 'same icon does not acquire a second image');
  for (const surface of ['chip', 'table']) {
   const classes = new Set<string>();
   const icon = { ...f.icon, isConnected: false, classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
   if (surface === 'chip') bindAssigneeChipImage({ querySelector: () => icon } as any, { key: 'assignees', linkTarget: 'Mehmet' }, f.app, 'Other.md', 'avatar');
   else bindAssigneeIconImage(icon as any, '[[Mehmet]]', f.app, 'Other.md', 'avatar');
   assert.equal(f.images.at(-1).hidden, false);
   assert.equal(classes.has('is-assignee-image-ready'), true);
   icon.isConnected = true;
  }
  f.frame();
  assert.equal(f.images.length, 3);
 } finally { f.cleanup(); }
});

test('cached-source failure restores fallback and unload forgets ready sources', () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.images[0].onload();
  const classes = new Set<string>();
  const icon = { ...f.icon, classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
  bindAssigneeIconImage(icon as any, '[[Mehmet]]', f.app, 'Daily.md', 'avatar');
  assert.equal(f.images[1].hidden, false);
  f.images[1].onerror();
  assert.equal(classes.has('is-assignee-image-ready'), false);
  assert.equal(f.images[1].removed, true);
  const another = { ...icon };
  bindAssigneeIconImage(another as any, '[[Mehmet]]', f.app, 'Daily.md', 'avatar');
  assert.equal(f.images[2].hidden, true);
  f.images[2].onload();
  disposeAssigneeChipImages(f.app);
  f.bind();
  assert.equal(f.images[3].hidden, true);
 } finally { f.cleanup(); }
});

test('ready sources survive ordinary chip teardown but changed local image versions do not reuse readiness', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame(); f.images[0].onload();
  f.icon.isConnected = false;
  f.observers[0].callback([{ removedNodes: [{}] }]);
  f.icon.isConnected = true;
  f.bind();
  assert.equal(f.images[1].hidden, false);
  const photo = f.app.metadataCache.getFirstLinkpathDest('photo.png', 'People/Mehmet.md');
  photo.stat = { mtime: 1 };
  f.app.vault.getAbstractFileByPath = () => photo;
  await f.change('[[photo.png]]');
  assert.equal(f.images[2].hidden, true);
  f.images[2].onload();
  photo.stat.mtime = 2;
  await f.change('[[photo.png]]');
  assert.equal(f.images[3].hidden, true);
  assert.equal(f.classes.has('is-assignee-image-ready'), false);
 } finally { f.cleanup(); }
});

test('successful source identities are bounded and unchanged source refreshes keep the image node', async () => {
 const f = imageUiFixture();
 try {
  f.bind(); f.frame(); f.images[0].onload();
  await f.change('https://example.com/photo.png');
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].hidden, false);
  for (let index = 0; index < 128; index++) {
   await f.change(`https://example.com/${index}.png`);
   f.images.at(-1).onload();
  }
  await f.change('https://example.com/photo.png');
  assert.equal(f.images.at(-1).hidden, true, 'oldest successful identity is evicted');
 } finally { f.cleanup(); }
});
