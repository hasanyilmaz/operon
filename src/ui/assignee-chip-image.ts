import { TFile, type App, type EventRef } from 'obsidian';
import { resolveAssigneeImageSource } from '../core/assignee-image-source';

interface Binding {
 icon: HTMLElement; raw: string; sourcePath: string; src: string | null;
 personPath: string | null; imagePath: string | null; image: HTMLImageElement | null; started: boolean; generation: number;
}
const managers = new WeakMap<App, AssigneeImages>();
// Successful source identities only; browser caching still owns the image bytes.
const readySources = new WeakMap<App, Set<string>>();
const READY_SOURCE_LIMIT = 128;

function rememberReadySource(app: App, src: string): void {
 let sources = readySources.get(app);
 if (!sources) { sources = new Set(); readySources.set(app, sources); }
 sources.delete(src);
 sources.add(src);
 if (sources.size > READY_SOURCE_LIMIT) {
  for (const oldest of sources) { sources.delete(oldest); break; }
 }
}

class AssigneeImages {
 readonly bindings = new Set<Binding>();
 private readonly documents = new Map<Document, MutationObserver>();
 private readonly windowCleanup = new Map<Document, () => void>();
 private readonly events: Array<{ offref(ref: EventRef): void; ref: EventRef }> = [];
 private readonly pendingDocuments = new WeakSet<Document>();
 private queued = false;
 private disposed = false;
 constructor(readonly app: App, public property: string) {
  const changed = () => this.schedule();
  const imageChanged = (file: { path: string }) => {
   if ([...this.bindings].some(binding => binding.imagePath === file.path)) this.schedule();
  };
  this.events.push({ offref: ref => app.metadataCache.offref(ref), ref: app.metadataCache.on('changed', file => {
   if ([...this.bindings].some(binding => !binding.personPath || binding.personPath === file.path)) this.schedule();
  }) });
  for (const ref of [app.vault.on('create', changed), app.vault.on('modify', imageChanged), app.vault.on('delete', changed), app.vault.on('rename', changed)]) {
   this.events.push({ offref: event => app.vault.offref(event), ref });
  }
 }
 schedule(): void {
  if (this.queued || this.disposed) return;
  this.queued = true;
  queueMicrotask(() => { this.queued = false; this.refresh(); });
 }
 add(binding: Binding): void {
  const existing = [...this.bindings].find(entry => entry.icon === binding.icon);
  if (existing) {
   existing.raw = binding.raw;
   existing.sourcePath = binding.sourcePath;
   if (existing.image && !existing.icon.contains(existing.image)) {
    this.clear(existing);
    existing.src = null;
   }
   this.refreshBinding(existing);
   return;
  }
  this.bindings.add(binding);
  // Resolve before insertion, rather than painting the canonical icon for a frame.
  this.refreshBinding(binding);
  const doc = binding.icon.ownerDocument;
  if (!this.documents.has(doc)) {
   const observer = new MutationObserver(records => { if (records.some(record => record.removedNodes.length)) this.prune(); });
   observer.observe(doc.body, { childList: true, subtree: true });
   this.documents.set(doc, observer);
   const closed = () => {
    for (const entry of this.bindings) {
     if (entry.icon.ownerDocument === doc) { this.clear(entry); this.bindings.delete(entry); }
    }
    this.prune();
   };
   doc.defaultView?.addEventListener('pagehide', closed);
   this.windowCleanup.set(doc, () => doc.defaultView?.removeEventListener('pagehide', closed));
  }
  if (!this.pendingDocuments.has(doc)) {
   this.pendingDocuments.add(doc);
   doc.defaultView?.requestAnimationFrame(() => {
    this.pendingDocuments.delete(doc);
    if (this.disposed) return;
    for (const pending of this.bindings) {
     if (pending.icon.ownerDocument === doc) pending.started = true;
    }
    this.refresh();
   });
  }
 }
 private clear(binding: Binding): void {
  binding.generation++;
  if (binding.image) {
   binding.image.onload = null;
   binding.image.onerror = null;
   binding.image.remove();
   binding.image = null;
  }
  binding.icon.classList.remove('is-assignee-image-ready');
 }
 refresh(): void {
  if (this.disposed) return;
  for (const binding of this.bindings) {
   if (!binding.icon.isConnected) {
    if (binding.started) { this.clear(binding); this.bindings.delete(binding); }
    continue;
   }
   binding.started = true;
   this.refreshBinding(binding);
  }
  this.prune();
 }
 private refreshBinding(binding: Binding): void {
   const source = resolveAssigneeImageSource(this.app, binding.raw, binding.sourcePath, this.property);
   binding.personPath = source?.personPath ?? null;
   binding.imagePath = source?.imagePath ?? null;
   let src = source?.src ?? null;
   if (src && source?.imagePath) {
    const file = this.app.vault.getAbstractFileByPath(source.imagePath);
    if (file instanceof TFile) src += `${src.includes('?') ? '&' : '?'}operonImageVersion=${file.stat.mtime}`;
   }
   if (src === binding.src) return;
   this.clear(binding);
   binding.src = src;
   if (!src) return;
   const image = binding.icon.ownerDocument.win.createEl('img');
   image.alt = '';
   image.setAttribute('aria-hidden', 'true');
   image.className = 'operon-assignee-chip-image';
   image.hidden = true;
   const generation = binding.generation;
   const isCurrent = () => binding.generation === generation && !(binding.started && !binding.icon.isConnected);
   const failed = () => {
    if (!isCurrent()) return;
    readySources.get(this.app)?.delete(src);
    this.clear(binding);
   };
   const reveal = () => {
    if (!isCurrent()) return;
    rememberReadySource(this.app, src);
    image.hidden = false;
    binding.icon.classList.add('is-assignee-image-ready');
   };
   let decoding = false;
   const revealWhenDecoded = () => {
    if (!isCurrent() || decoding) return;
    if (typeof image.decode !== 'function') { reveal(); return; }
    decoding = true;
    void image.decode().then(reveal, failed);
   };
   image.onload = revealWhenDecoded;
   image.onerror = failed;
   binding.image = image;
   binding.icon.classList.add('operon-assignee-image-icon');
   binding.icon.appendChild(image);
   image.src = src;
   // A known URL can start decoding early, but is not proof this element is ready.
   if (readySources.get(this.app)?.has(src) && typeof image.decode === 'function') revealWhenDecoded();
 }
 private prune(): void {
  if (this.disposed) return;
  for (const binding of this.bindings) {
   if (binding.started && !binding.icon.isConnected) { this.clear(binding); this.bindings.delete(binding); }
  }
  for (const [doc, observer] of this.documents) {
   if (![...this.bindings].some(binding => binding.icon.ownerDocument === doc)) {
    observer.disconnect(); this.documents.delete(doc);
    this.windowCleanup.get(doc)?.(); this.windowCleanup.delete(doc);
   }
  }
  if (!this.bindings.size) this.dispose();
 }
 dispose(): void {
  if (this.disposed) return;
  this.disposed = true;
  for (const binding of this.bindings) this.clear(binding);
  this.bindings.clear();
  for (const observer of this.documents.values()) observer.disconnect();
  this.documents.clear();
  for (const cleanup of this.windowCleanup.values()) cleanup();
  this.windowCleanup.clear();
  for (const event of this.events) event.offref(event.ref);
  this.events.length = 0;
  if (managers.get(this.app) === this) managers.delete(this.app);
 }
}

export function bindAssigneeChipImage(
 chip: HTMLElement, entry: { key: string; linkTarget?: string | null; previewLinkTarget?: string | null },
 app: App, sourcePath: string, property: string,
): void {
 if (entry.key !== 'assignees') return;
 const target = entry.previewLinkTarget ?? entry.linkTarget;
 const icon = chip.querySelector<HTMLElement>('.operon-inline-compact-chip-icon');
 if (!target || !icon) return;
 bindAssigneeIconImage(icon, `[[${target}]]`, app, sourcePath, property);
}

export function bindAssigneeIconImage(icon: HTMLElement, raw: string, app: App, sourcePath: string, property: string): void {
 if (!raw.trim().startsWith('[[')) return;
 let manager = managers.get(app);
 if (!manager) { manager = new AssigneeImages(app, property); managers.set(app, manager); }
 manager.add({ icon, raw, sourcePath, src: null, personPath: null, imagePath: null, image: null, started: false, generation: 0 });
}

export function refreshAssigneeChipImages(app: App, property: string): void {
 const manager = managers.get(app);
 if (manager) { manager.property = property; manager.schedule(); }
}

export function disposeAssigneeChipImages(app: App): void {
 managers.get(app)?.dispose();
 readySources.delete(app);
}
