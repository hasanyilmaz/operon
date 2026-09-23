import { TFile, type App, type EventRef } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { propertyPoolFields, type PropertyPoolValue } from '../core/property-value-pool';
import { EmptyQueryRankIndex } from './field-pickers/empty-query-ranking';
import { PropertyPoolValueSession, type PropertyPoolValueSources } from './property-value-pool-values';
import type { TaskCardEmbeds } from './task-card-embed';

type Entry<T> = { order: number; value: T };
/** Deduplicate raw contributions before invoking the existing picker codecs. */
class Contributions<T> {
 private members = new Map<string, { key: string; entry: Entry<T> }>();
 private groups = new Map<string, Entry<T>[]>();
 private position(group: Entry<T>[], order: number): number {
  let low = 0, high = group.length;
  while (low < high) { const mid = (low + high) >>> 1; if (group[mid].order < order) low = mid + 1; else high = mid; }
  return low;
 }
 set(id: string, key: string | null, entry?: Entry<T>): boolean {
  const old = this.members.get(id);
  if (old?.key === key && entry) return false;
  if (old) {
   const group = this.groups.get(old.key)!;
   group.splice(this.position(group, old.entry.order), 1);
   if (!group.length) this.groups.delete(old.key);
   this.members.delete(id);
  }
  if (key !== null && entry) {
   const group = this.groups.get(key) ?? [];
   if (group.length) entry = { order: entry.order, value: group[0].value };
   // Keep source order while changing only this contribution; no representative rescan.
   if (!group.length || group[group.length - 1].order < entry.order) group.push(entry);
   else group.splice(this.position(group, entry.order), 0, entry);
   this.groups.set(key, group); this.members.set(id, { key, entry });
  }
  return !!old || key !== null;
 }
 values(last = false): T[] {
  return [...this.groups.values()].flatMap(group => last && group.length > 1 ? [group[0], group[group.length - 1]] : [group[0]]).sort((a, b) => a.order - b.order).map(entry => entry.value);
 }
}

type Metadata = { file: TFile; frontmatter: Record<string, unknown> };
type FieldSources = { tasks: Contributions<IndexedTask>; files: Contributions<Metadata>; names: Set<string>; app?: App };

/** Memory-only contributions. Real task/file sources are read at seed and at their own delta only. */
export class PropertyPoolSourceSnapshot implements PropertyPoolValueSources {
 readonly values: PropertyPoolValueSession;
 private taskEntries = new Map<string, Entry<IndexedTask>>();
 private fileEntries = new Map<string, Entry<Metadata>>();
 private fields = new Map<string, FieldSources>();
 private ranks = new Map<string, EmptyQueryRankIndex<PropertyPoolValue>>();
 private serial = 0;
 private types: Map<string, string>;
 private emptyApp = { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null, getTags: () => this.tags } } as unknown as App;
 private tags: Record<string, number> = {};
 private tagsLoaded = false;
 private filesLoaded = false;
 constructor(private host: App, private settings: OperonSettings, tasks: readonly IndexedTask[]) {
  this.types = new Map(propertyPoolFields(settings).map(field => [field.key, field.type]));
  for (const task of tasks) if (!this.taskEntries.has(task.operonId)) this.taskEntries.set(task.operonId, { order: this.serial++, value: task });
  this.values = new PropertyPoolValueSession(host, settings, [], this);
 }
 private staticField(key: string): boolean { return key === 'status' || key === 'priority' || this.types.get(key) === 'date'; }
 private needsMetadata(key: string): boolean { return !this.staticField(key) && !['tags', 'estimate', 'taskIcon', 'taskColor', 'reminderRules'].includes(key); }
 private ensureFiles(): void {
  if (this.filesLoaded) return; this.filesLoaded = true;
  for (const file of this.host.vault.getMarkdownFiles()) {
   const entry = { order: this.serial++, value: this.readFile(file) }; this.fileEntries.set(file.path, entry);
   for (const [key, field] of this.fields) { if (!this.needsMetadata(key)) continue; const contribution = this.fileValue(key, field, entry); field.files.set(file.path, contribution?.key ?? null, contribution?.entry); field.app = undefined; }
  }
 }
 private readTags(): Record<string, number> { return { ...(this.host.metadataCache as unknown as { getTags?(): Record<string, number> }).getTags?.() }; }
 private readFile(file: TFile): Metadata { return { file, frontmatter: structuredClone(this.host.metadataCache.getFileCache(file)?.frontmatter ?? {}) }; }
 private taskEntry(key: string, entry: Entry<IndexedTask>): Entry<IndexedTask> {
  const task = entry.value;
  return { order: entry.order, value: { ...task, fieldValues: { [key]: task.fieldValues[key] ?? '' }, tags: key === 'tags' ? [...task.tags] : [], primary: { ...task.primary } } };
 }
 private taskKey(key: string, task: IndexedTask): string | null {
  const raw = key === 'tags' ? task.tags : task.fieldValues[key];
  if (raw === undefined || raw === '' || Array.isArray(raw) && !raw.length) return null;
  return JSON.stringify([raw, task.primary?.format, key === 'taskImage' || key === 'taskGallery' ? task.primary.filePath : '']);
 }
 private fileValue(key: string, field: FieldSources, entry: Entry<Metadata>): { key: string; entry: Entry<Metadata> } | null {
  const frontmatter = Object.fromEntries(Object.entries(entry.value.frontmatter).filter(([name]) => field.names.has(name.trim().toLocaleLowerCase())));
  if (!Object.keys(frontmatter).length) return null;
  const media = key === 'taskImage' || key === 'taskGallery' || key === 'location';
  return { key: JSON.stringify([frontmatter, media ? entry.value.file.path : '']), entry: { order: entry.order, value: { file: entry.value.file, frontmatter } } };
 }
 private field(key: string): FieldSources {
  let field = this.fields.get(key);
  if (field) return field;
  const names = new Set([key.toLocaleLowerCase(), ...this.settings.keyMappings.filter(mapping => mapping.canonicalKey === key).map(mapping => mapping.visiblePropertyName.trim().toLocaleLowerCase())]);
  field = { tasks: new Contributions(), files: new Contributions(), names }; this.fields.set(key, field);
  if (key !== 'location') for (const [id, entry] of this.taskEntries) field.tasks.set(id, this.taskKey(key, entry.value), this.taskEntry(key, entry));
  if (this.needsMetadata(key)) for (const [path, entry] of this.fileEntries) { const contribution = this.fileValue(key, field, entry); field.files.set(path, contribution?.key ?? null, contribution?.entry); }
  return field;
 }
 tasks(key: string): IndexedTask[] { return this.staticField(key) || key === 'location' ? [] : this.field(key).tasks.values(key === 'contexts'); }
 app(key: string): App {
  if (key === 'tags' && !this.tagsLoaded) { this.tagsLoaded = true; this.tags = this.readTags(); }
  if (!this.needsMetadata(key)) return this.emptyApp;
  this.ensureFiles();
  const field = this.field(key);
  if (!field.app) {
   const metadata = field.files.values(key === 'contexts').map(value => ({ ...value, file: new Proxy(value.file, {}) })), caches = new Map(metadata.map(value => [value.file, { frontmatter: value.frontmatter }]));
   // Only cached distinct raw contributions reach picker collectors, never the vault scan.
   field.app = { vault: { getMarkdownFiles: () => metadata.map(value => value.file) }, metadataCache: { getFileCache: (file: TFile) => caches.get(file), getTags: () => this.tags } } as unknown as App;
  }
  return field.app;
 }
 rank(key: string, getValues: (task: IndexedTask) => readonly string[], getKey: (value: PropertyPoolValue) => string): (values: readonly PropertyPoolValue[]) => PropertyPoolValue[] {
  let rank = this.ranks.get(key);
  if (!rank) { rank = new EmptyQueryRankIndex([...this.taskEntries.values()].map(entry => entry.value), getValues, getKey); this.ranks.set(key, rank); }
  return values => rank.rank(values);
 }
 updateTasks(changes: ReadonlyMap<string, IndexedTask | undefined>): void {
  const invalid = new Set<string>();
  for (const [id, task] of changes) {
   const old = this.taskEntries.get(id), entry = task ? { order: old?.order ?? this.serial++, value: task } : undefined;
   for (const [key, field] of this.fields) {
    if (field.tasks.set(id, task ? this.taskKey(key, task) : null, entry ? this.taskEntry(key, entry) : undefined)) invalid.add(key);
    const rank = this.ranks.get(key);
    if (rank) rank.update(id, task);
   }
   if (entry) this.taskEntries.set(id, entry); else this.taskEntries.delete(id);
  }
  this.values.invalidate(invalid); this.values.invalidateRanking();
 }
 updateFile(file: TFile, removed = false, oldPath?: string): void {
  const path = oldPath ?? file.path, old = this.fileEntries.get(path);
  const entry = removed || !this.filesLoaded || file.extension !== 'md' ? undefined : { order: old?.order ?? this.serial++, value: this.readFile(file) };
  const invalid = new Set<string>(['tags']);
  if (this.tagsLoaded) this.tags = this.readTags();
  for (const [key, field] of this.fields) {
   if (oldPath && oldPath !== file.path) field.files.set(oldPath, null);
   const contribution = entry ? this.fileValue(key, field, entry) : null;
   if (field.files.set(removed ? path : file.path, contribution?.key ?? null, contribution?.entry) || oldPath) { invalid.add(key); field.app = undefined; }
   if (key === 'taskImage' || key === 'taskGallery') { invalid.add(key); field.app = undefined; }
  }
  this.fileEntries.delete(path); if (entry) this.fileEntries.set(file.path, entry);
  this.values.invalidate(invalid);
 }
}

interface SharedPoolSources { snapshot(): PropertyPoolSourceSnapshot; release(): void }
const shared = new WeakMap<TaskCardEmbeds, PoolSourceOwner>();
class PoolSourceOwner {
 private cleanups: Array<() => void> = [];
 private register(callback: () => void): void { this.cleanups.push(callback); }
 private event(source: App['vault'] | App['metadataCache'], ref: EventRef): void { this.register(() => source.offref?.(ref)); }
 private source: PropertyPoolSourceSnapshot | null = null;
 private listeners = new Set<() => void>();
 constructor(private app: App, private cards: TaskCardEmbeds) {}
 private changed(): void { for (const listener of this.listeners) listener(); }
 snapshot(): PropertyPoolSourceSnapshot {
  const settings = this.cards.deps.getSettings();
  if (!this.source || !this.source.values.matchesSettings(settings)) this.source = new PropertyPoolSourceSnapshot(this.app, settings, this.cards.getAllTasks());
  return this.source;
 }
 onload(): void {
  this.register(this.cards.onRefresh((scope = { kind: 'full', reason: 'unscoped' }) => {
   if (scope.kind === 'full' || this.source && !this.source.values.matchesSettings(this.cards.deps.getSettings())) this.source = null;
   else if (this.source) {
    const changes = new Map<string, IndexedTask | undefined>();
    for (const id of scope.taskIds) {
     const result = this.cards.resolve(id);
     changes.set(id, result.state === 'ready' ? { ...result.task, fieldValues: { ...result.task.fieldValues }, tags: [...result.task.tags], primary: { ...result.task.primary } } : undefined);
    }
    this.source.updateTasks(changes);
   }
   this.changed();
  }));
  this.event(this.app.metadataCache, this.app.metadataCache.on('changed', file => { if (file instanceof TFile) this.source?.updateFile(file); else this.source = null; this.changed(); }));
  this.event(this.app.vault, this.app.vault.on('create', file => { if (file instanceof TFile && file.extension === 'md') { this.source?.updateFile(file); this.changed(); } }));
  this.event(this.app.vault, this.app.vault.on('delete', file => { if (file instanceof TFile) this.source?.updateFile(file, true); else this.source = null; this.changed(); }));
  this.event(this.app.vault, this.app.vault.on('rename', (file, oldPath) => { if (file instanceof TFile) this.source?.updateFile(file, false, oldPath); else this.source = null; this.changed(); }));
 }
 acquire(listener: () => void): SharedPoolSources {
  this.listeners.add(listener); let released = false;
  return { snapshot: () => this.snapshot(), release: () => { if (released) return; released = true; this.listeners.delete(listener); if (!this.listeners.size) { shared.delete(this.cards); this.dispose(); } } };
 }
 dispose(): void { for (const cleanup of this.cleanups.splice(0)) cleanup(); this.source = null; this.listeners.clear(); }
}
export function acquirePropertyPoolSources(app: App, cards: TaskCardEmbeds, listener: () => void): SharedPoolSources {
 let owner = shared.get(cards);
 if (!owner) { owner = new PoolSourceOwner(app, cards); shared.set(cards, owner); owner.onload(); }
 return owner.acquire(listener);
}
