import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Platform } from 'obsidian';
import { lightboxFixture } from './test-support/lightbox-dom';
import { openLightbox } from '../src/ui/lightbox';
import { disposeWebLightboxes, openWebLightbox } from '../src/ui/web-lightbox';
import { bindLinksChipKeyboard, handleLinksChipClick } from '../src/ui/links-chip-action';

function fixture(options: { enabled?: boolean; delay?: boolean; fail?: boolean; wrongDocument?: boolean } = {}) {
 const dom = lightboxFixture();
 const savedDesktop = (Platform as any).isDesktopApp;
 (Platform as any).isDesktopApp = true;
 const savedObserver = globalThis.ResizeObserver;
 let disconnected = 0;
 globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected++; } } as any;
 let release: () => void = () => {};
 let created = 0, detached = 0, restored = 0, tabOpens = 0, url = '';
 const previous = { view: { getViewType: () => 'markdown' } };
 const view = { containerEl: dom.doc.body.createDiv(), getViewType: () => 'webviewer', onResize() {} };
 if (options.wrongDocument) view.containerEl.ownerDocument = {};
 const owned = { view, async setViewState(state: any) { url = state.state.url; if (options.delay) await new Promise<void>(r => release = r); if (options.fail) throw Error('open failed'); }, async loadIfDeferred() {}, detach() { detached++; } };
 const plugin = { enabled: options.enabled !== false, instance: { openUrl() { tabOpens++; } } };
 const app: any = { internalPlugins: { plugins: { webviewer: plugin }, getEnabledPluginById: () => options.enabled === false ? null : plugin.instance }, workspace: {
  getMostRecentLeaf: () => previous, getLeaf: () => { created++; return owned; }, getLeavesOfType: () => [previous], setActiveLeaf() { restored++; },
 } };
 return { ...dom, app, view, release: () => release(), stats: () => ({created, detached, restored, disconnected, tabOpens, url}), cleanup() { disposeWebLightboxes(app); (Platform as any).isDesktopApp = savedDesktop; globalThis.ResizeObserver = savedObserver; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('web content opens directly, uses the shared shell and unload closes only its owned leaf', async () => {
 const f = fixture();
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com'); await tick();
  assert.equal(f.stats().created, 1); assert.equal(f.stats().url, 'https://example.com');
  assert.equal(f.doc.body.children.at(-1).children[0].hidden, true);
  assert.notEqual(f.view.containerEl.parent, f.doc.body);
  disposeWebLightboxes(f.app); disposeWebLightboxes(f.app);
  assert.equal(f.stats().detached, 1); assert.equal(f.stats().restored, 1); assert.equal(f.stats().disconnected, 1);
  assert.equal(f.listeners.get('keydown')!.size, 0);
 } finally { f.cleanup(); }
});
test('closing before a delayed open completes cannot attach the late view', async () => {
 const f = fixture({delay:true});
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com'); disposeWebLightboxes(f.app); f.release(); await tick();
  assert.equal(f.view.containerEl.parent, f.doc.body); assert.ok(f.stats().detached >= 1); assert.equal(f.stats().restored, 1);
 } finally { f.cleanup(); }
});
test('failed opening and wrong-window attachment close the shell and clean the owned leaf', async () => {
 for (const options of [{fail:true}, {wrongDocument:true}]) {
  const f = fixture(options);
  try { openWebLightbox(f.app, f.anchor, 'https://example.com'); await tick(); assert.equal(f.stats().detached, 1); assert.equal(f.listeners.get('keydown')!.size, 0); } finally { f.cleanup(); }
 }
});
test('desktop click, modifier and keyboard routes stay separate; other fields and mobile fall through', async () => {
 const f = fixture(); const wasMac = Platform.isMacOS;
 try {
  const entry = {key:'links', externalUrl:'https://example.com'};
  const event = {button:0, detail:1, metaKey:false, ctrlKey:false} as MouseEvent;
  assert.equal(handleLinksChipClick(f.app, f.anchor, {...entry,key:'taskImage'}, event), false);
  (Platform as any).isDesktopApp = false;
  assert.equal(handleLinksChipClick(f.app, f.anchor, entry, event), false);
  (Platform as any).isDesktopApp = true;
  for (const mac of [true,false]) {
   Platform.isMacOS = mac;
   assert.equal(handleLinksChipClick(f.app, f.anchor, entry, {...event, metaKey:mac,ctrlKey:!mac}), true);
  }
  assert.equal(f.stats().tabOpens, 2); assert.equal(f.stats().created, 0);
  handleLinksChipClick(f.app, f.anchor, entry, {...event, detail:2});
  assert.equal(f.stats().created, 0);
  assert.equal(handleLinksChipClick(f.app, f.anchor, entry, {...event, detail:0, metaKey:true,ctrlKey:true}), true);
  await tick(); assert.equal(f.stats().created, 1); assert.equal(f.stats().tabOpens, 2);
 } finally { Platform.isMacOS = wasMac; f.cleanup(); }
});
test('disabled viewer and invalid protocols never create a leaf', () => {
 const f = fixture({enabled:false});
 try {
  const event = {button:0,detail:1,metaKey:false,ctrlKey:false} as MouseEvent;
  handleLinksChipClick(f.app, f.anchor, {key:'links', externalUrl:'https://example.com'}, event);
  handleLinksChipClick(f.app, f.anchor, {key:'links', externalUrl:'javascript:alert(1)'}, event);
  assert.equal(f.stats().created, 0); assert.equal(f.stats().tabOpens, 0);
 } finally { f.cleanup(); }
});
test('span keyboard activation fires once and native buttons keep their native behavior', () => {
 const f = fixture();
 try {
  const chip = f.anchor as any; let clicks = 0; chip.click = () => clicks++;
  bindLinksChipKeyboard(chip, 'links');
  const handler = chip.events.get('keydown');
  handler({key:'Enter',repeat:false,preventDefault(){},stopPropagation(){}});
  handler({key:' ',repeat:true,preventDefault(){},stopPropagation(){}});
  assert.equal(clicks, 1);
  const button = f.doc.body.createEl('button'); bindLinksChipKeyboard(button, 'links'); assert.equal(button.events.has('keydown'), false);
 } finally { f.cleanup(); }
});
test('all four chip paths opt in while the prototype and Table integration remain separate', () => {
 for (const file of ['compact-card-chips','reading-task-row','live-preview-conceal','task-wikilink-overlay-chips']) {
  const source = readFileSync(`src/ui/${file}.ts`, 'utf8');
  assert.match(source, /handleLinksChipClick\(callbacks.app, chip, entry, event\)/);
  assert.match(source, /bindExternalLinkContextMenu/);
 }
 const source = readFileSync('src/ui/web-lightbox.ts','utf8');
 assert.doesNotMatch(source, /createEl\('(?:input|form)'/);
 assert.doesNotMatch(readFileSync('main.ts','utf8'), /registerWebLightboxPrototype/);
});

test('media lightbox replaces a pending web view and late completion cannot close the replacement', async () => {
 const f = fixture({delay:true}); let media: HTMLElement | null = null;
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com');
  const closeMedia = openLightbox(f.anchor, {title:'Media',render: root => {media = root; return null;}});
  assert.equal(f.stats().detached, 1);
  f.release(); await tick();
  assert.equal((media as unknown as HTMLElement).isConnected, true);
  disposeWebLightboxes(f.app);
  assert.equal((media as unknown as HTMLElement).isConnected, true);
  closeMedia();
 } finally { f.cleanup(); }
});
