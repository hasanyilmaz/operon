import { TFile, type App } from 'obsidian';
import type { IndexedTask, ParsedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { readFileTaskPropertyDocument, fileTaskPropertyIdentityMatches } from '../core/file-task-property-draft';
import { readParsedInlinePropertyProjection, createInlinePropertyReadPlan, type InlinePropertyReadPlan, type InlinePropertySnapshot } from '../core/inline-property-source';
import { nativeEditorPropertyTypes, nativePropertyReadOnlyReason, nativePropertyValueReadOnlyReason, type NativePropertyReadOnlyReason } from '../core/task-editor-native-properties';
import { isWritableRawYamlPropertyName } from '../core/raw-yaml-property';
import { resolveInlinePropertyDefinition, type InlinePropertyType } from '../core/inline-property-definitions';
import { loadPropertyTypeRegistry, type ObsidianPropertyTypeId } from '../core/property-type-registry';
import { scanFileWithMappings } from './file-scanner';
import { getManagedYamlAliases } from '../core/yaml-fields';
import { compactNativeInline, persistNativePropertySource, restoreNativePropertySource, NATIVE_SOURCE_RESCAN,
 type NativePropertySource, type PersistedNativePropertySource } from './native-property-persistence';
export type { NativePropertySource } from './native-property-persistence';

type Settings = Pick<OperonSettings, 'keyMappings' | 'inlinePropertyDefinitions'>;
export function captureNativePropertySource(content: string, inline: readonly ParsedTask[], fileTask = true): NativePropertySource {
 const document = fileTask ? readFileTaskPropertyDocument(content) : null;
 return { frontmatter: document?.frontmatter ?? null, order: document?.order ?? [], inline: inline.map(compactNativeInline) };
}
export interface NativePropertyRecord {
 sourceName: string;
 type?: InlinePropertyType;
 present: boolean;
 value: unknown;
 reason?: NativePropertyReadOnlyReason;
 inline?: InlinePropertySnapshot;
}
export interface NativeTaskProperties {
 properties: ReadonlyMap<string, NativePropertyRecord>;
 available: boolean;
 revision: string;
}
function sameSourceValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
 if (Object.is(left, right)) return true;
 if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
 if (seen.has(left)) return seen.get(left) === right;
 seen.set(left, right);
 if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
 const a = Object.keys(left), b = Object.keys(right);
 return a.length === b.length && a.every((key, index) => key === b[index]
  && sameSourceValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen));
}
interface SourceEntry {
 raw?: NativePropertySource;
 persisted?: PersistedNativePropertySource;
 hydrated?: boolean;
 inlineById?: Map<string | null, NativePropertySource['inline'][number] | null>;
 revision: number;
 stamp: string;
 error: boolean;
 rows: Map<string, NativeTaskProperties>;
}
interface Job { path: string; epoch: number; promise: Promise<void>; resolve: () => void; }
const indexes = new WeakMap<App, NativePropertyIndex>();
export function getNativePropertyIndex(app: App): NativePropertyIndex {
 let index = indexes.get(app);
 if (!index) { index = new NativePropertyIndex(app); indexes.set(app, index); }
 return index;
}
/** Shared source projection backed by the primary index snapshot; absent from public Runtime DTOs. */
export class NativePropertyIndex {
 private sources = new Map<string, SourceEntry>();
 private epochs = new Map<string, number>();
 private jobs = new Map<string, Job>();
 private pending = new Map<string, { promise: Promise<void>; resolve: () => void }>();
 private queue: Job[] = [];
 private active = 0;
 private disposed = false;
 private settings: Settings = { keyMappings: [] };
 private settingsKey = '';
 private declarations: Record<string, ObsidianPropertyTypeId> = {};
 private registryState: 'pending' | 'ready' | 'error' = 'pending';
 private registryJob: Promise<void> | null = null;
 private registryEpoch = 0;
 private types: Record<string, InlinePropertyType> = {};
 private typeCache = new Map<string, InlinePropertyType | undefined>();
 private reasonCache = new Map<string, NativePropertyReadOnlyReason | undefined>();
 private inclusionCache = new Map<string, boolean>();
 private readPlans = new Map<string, InlinePropertyReadPlan>();
 private aliasCache = new Map<string, string[]>();
 private listeners = new Set<() => void>();
 private revision = 0;
 private interpretationRevision = 0;
 private known: Map<string, IndexedTask> | null = null;
 private indexedStamps = new Map<string, string>();
 private tasksByPath = new Map<string, IndexedTask[]>();
 private refreshSource?: (path: string) => Promise<void>;
 private duplicateIds = new Set<string>();
 private notifyQueued = false;
 private dirty = false;
 readonly counters = { reads: 0, scans: 0, projections: 0, maxConcurrentReads: 0 };
 constructor(private readonly app: App) {}
 configure(settings: Settings): void {
  const key = JSON.stringify([settings.keyMappings, settings.inlinePropertyDefinitions]);
  if (this.settingsKey === key) return;
  // Restored fragments omit fields owned by canonical/legacy mappings. A settings
  // transition may change that ownership, so reacquire those sources before use.
  for (const [path, source] of this.sources) if (source.hydrated) {
   this.sources.delete(path); this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  }
  this.settingsKey = key;
  this.settings = { keyMappings: settings.keyMappings.map(mapping => ({ ...mapping })), inlinePropertyDefinitions: settings.inlinePropertyDefinitions };
  this.reinterpret();
  for (const source of this.sources.values()) if (source.raw) source.persisted = this.persistSource(source.raw);
 }
 setTypes(types: Record<string, ObsidianPropertyTypeId> | null): void {
  this.registryEpoch++;
  const state = types === null ? 'error' : 'ready';
  if (this.registryState === state && (!types || JSON.stringify(types) === JSON.stringify(this.declarations))) return;
  this.registryState = state;
  if (types) this.declarations = { ...types };
  this.reinterpret();
 }
 getTypes(): Readonly<Record<string, ObsidianPropertyTypeId>> { return this.declarations; }
 getNativeTypes(): Readonly<Record<string, InlinePropertyType>> { return this.types; }
 getRevision(): number { return this.revision; }
 isActive(): boolean { return !this.disposed; }
 private usageRevision = -1;
 private usageNames: ReadonlySet<string> = new Set();
 private draftReaders = new Set<() => readonly string[]>();
 observeDraftProperties(read: () => readonly string[]): () => void {
  this.draftReaders.add(read);
  return () => { this.draftReaders.delete(read); };
 }
 draftPropertyNames(): readonly string[] {
  return [...new Set([...this.draftReaders].flatMap(read => read()).map(name => name.trim().toLowerCase()))].sort();
 }
 usedPropertyNames(): ReadonlySet<string> {
  if (this.usageRevision === this.revision) return this.usageNames;
  const names = new Set<string>();
  for (const source of this.sources.values()) {
   for (const name of source.raw?.order ?? []) names.add(name.toLowerCase());
   for (const task of source.raw?.inline ?? []) for (const field of task.fields) names.add(field.sourceKey.toLowerCase());
  }
  this.usageRevision = this.revision; this.usageNames = names;
  return names;
 }
 typesAvailable(): boolean { return this.registryState === 'ready'; }
 private reinterpret(): void {
  this.interpretationRevision++;
  this.typeCache.clear(); this.reasonCache.clear(); this.inclusionCache.clear(); this.readPlans.clear(); this.aliasCache.clear();
  this.types = nativeEditorPropertyTypes(this.declarations, this.settings.keyMappings, this.settings.inlinePropertyDefinitions);
  for (const source of this.sources.values()) source.rows.clear();
  this.prepare([...(this.known?.values() ?? [])]);
  this.changed();
 }
 subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
 private changed(notify = true): void {
  this.revision++; this.dirty = true;
  if (notify) this.publish();
 }
 publish(): void {
  if (!this.dirty) return;
  this.dirty = false;
  if (this.notifyQueued || this.disposed) return;
  this.notifyQueued = true;
  queueMicrotask(() => {
   this.notifyQueued = false;
   if (!this.disposed) for (const listener of this.listeners) listener();
  });
 }
 /** Canonical membership is committed before native consumers are notified. */
 reconcile(tasks: readonly IndexedTask[], duplicates: ReadonlySet<string>, stamps?: ReadonlyMap<string, string>): void {
  if (stamps) this.indexedStamps = new Map(stamps);
  this.known = new Map(tasks.map(task => [task.operonId, task]));
  this.tasksByPath.clear();
  for (const task of tasks) { const group = this.tasksByPath.get(task.primary.filePath) ?? []; group.push(task); this.tasksByPath.set(task.primary.filePath, group); }
  const paths = new Set(tasks.map(task => task.primary.filePath));
  for (const path of this.sources.keys()) if (!paths.has(path)) this.remove(path);
  for (const path of this.jobs.keys()) if (!paths.has(path)) this.remove(path);
  for (const path of this.pending.keys()) if (!paths.has(path)) this.remove(path);
  if (JSON.stringify([...duplicates].sort()) !== JSON.stringify([...this.duplicateIds].sort())) {
   this.duplicateIds = new Set(duplicates); this.changed();
  }
 }
 /** Join normal indexing instead of racing it with a second property-only read. */
 markPending(path: string): void {
  if (this.pending.has(path) || this.disposed) return;
  this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  this.pending.set(path, { promise, resolve });
 }
 finishPending(path: string): void {
  const pending = this.pending.get(path);
  this.pending.delete(path); pending?.resolve();
 }
 bindSourceRefresh(refresh: (path: string) => Promise<void>): void { this.refreshSource = refresh; }
 private stamp(path: string): string {
  const file = this.app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? `${file.stat.mtime}:${file.stat.size}` : 'missing';
 }
 accept(path: string, raw: NativePropertySource, notify = true, stamp = this.stamp(path)): void {
  if (this.disposed) return;
  this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  const previous = this.sources.get(path);
  // Unrelated file-body changes do not invalidate decoded task values or trigger another sort.
  if (previous?.raw && !previous.error && sameSourceValue(previous.raw, raw)) {
   previous.stamp = stamp; return;
  }
  const persisted = this.persistSource(raw);
  this.sources.set(path, { raw, persisted, stamp, error: false, revision: this.revision + 1, rows: new Map() });
  this.prepare(this.tasksByPath.get(path) ?? []);
  this.changed(notify);
 }
 /** Cache hydration uses the saved stamp, never the current file's possibly newer stamp. */
 restore(path: string, persisted: PersistedNativePropertySource, stamp: string): void {
  this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  const raw = restoreNativePropertySource(persisted);
  if (!raw) { this.sources.delete(path); return; }
  this.sources.set(path, { raw, persisted, hydrated: true, stamp, error: false, revision: this.revision + 1, rows: new Map() });
  this.changed(false);
 }
 persistSource(raw: NativePropertySource): PersistedNativePropertySource {
  // A hidden managed alias may still be the evidence for a visible field's
  // ambiguity. Retain its group without changing which fields the UI exposes.
  const retained = new Set<string>();
  const names = new Set([...raw.order, ...raw.inline.flatMap(task => task.fields.map(field => field.sourceKey))]);
  for (const name of names) if (this.includes(name)) for (const alias of this.aliasesFor(name)) retained.add(alias);
  return persistNativePropertySource(raw, name => retained.has(name.toLowerCase()), new Set(getManagedYamlAliases('operonId', this.settings.keyMappings).map(name => name.toLowerCase())));
 }
 snapshot(stamps: ReadonlyMap<string, { mtimeMs: number; sizeBytes: number }>): ReadonlyMap<string, PersistedNativePropertySource> {
  return new Map([...stamps].map(([path, stat]) => {
   const entry = this.sources.get(path);
   return [path, entry && !entry.error && entry.stamp === `${stat.mtimeMs}:${stat.sizeBytes}`
    ? entry.persisted ?? NATIVE_SOURCE_RESCAN : NATIVE_SOURCE_RESCAN];
  }));
 }
 fail(path: string): void {
  this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  const previous = this.sources.get(path);
  if (previous?.error) return;
  this.sources.set(path, { ...previous, stamp: this.stamp(path), error: true, revision: this.revision + 1, rows: new Map() });
  this.changed();
 }
 remove(path: string): void {
  this.finishPending(path);
  this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
  if (this.sources.delete(path)) this.changed();
 }
 private async ensureTypes(): Promise<void> {
  if (this.registryState !== 'pending') return;
  if (!this.registryJob) {
   const epoch = this.registryEpoch;
   this.registryJob = loadPropertyTypeRegistry(this.app).then(types => {
    if (!this.disposed && this.registryEpoch === epoch) this.setTypes(types);
   }, () => { if (!this.disposed && this.registryEpoch === epoch) this.setTypes(null); });
  }
  await this.registryJob;
 }
 isReady(tasks: readonly IndexedTask[]): boolean {
  return this.registryState !== 'pending' && tasks.every(task => this.sourceReady(task));
 }
 private sourceReady(task: IndexedTask): boolean {
  if (this.pending.has(task.primary.filePath)) return false;
  if (this.known && !this.matchesKnown(task)) return true;
  const source = this.sources.get(task.primary.filePath);
  return !!source && source.stamp === this.stamp(task.primary.filePath) && !this.pending.has(task.primary.filePath)
   && (source.error || !this.indexedStamps.has(task.primary.filePath) || this.indexedStamps.get(task.primary.filePath) === source.stamp);
 }
 private matchesKnown(task: IndexedTask): boolean {
  const known = this.known?.get(task.operonId);
  return !!known && known.primary.filePath === task.primary.filePath && known.primary.format === task.primary.format;
 }
 async ensure(tasks: readonly IndexedTask[], priority = true): Promise<void> {
  if (this.disposed) return;
  // Queue the whole required set before starting workers, so concurrency stays bounded.
  const waits = tasks.filter(task => !this.sourceReady(task)).map(task => {
   const path = task.primary.filePath;
   const pending = this.pending.get(path);
   if (pending) return pending.promise;
   if (this.refreshSource && this.indexedStamps.has(path) && this.indexedStamps.get(path) !== this.stamp(path)) return this.refreshSource(path);
   return this.enqueue(path, priority);
  });
  this.pump();
  await Promise.all([this.ensureTypes(), ...waits]);
 }
 private enqueue(path: string, priority: boolean): Promise<void> {
  const existing = this.jobs.get(path);
  if (existing) {
   if (priority && this.queue.includes(existing)) { this.queue = this.queue.filter(job => job !== existing); this.queue.unshift(existing); }
   return existing.promise;
  }
  let resolve!: () => void;
  const job: Job = { path, epoch: this.epochs.get(path) ?? 0, promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  this.jobs.set(path, job);
  if (priority) this.queue.unshift(job); else this.queue.push(job);
  return job.promise;
 }
 private pump(): void {
  while (!this.disposed && this.active < 2 && this.queue.length) {
   const job = this.queue.shift()!;
   this.active++;
   void this.run(job).finally(() => {
    this.active--; if (this.jobs.get(job.path) === job) this.jobs.delete(job.path);
    job.resolve(); this.pump();
   });
  }
 }
 private async run(job: Job): Promise<void> {
  const stamp = this.stamp(job.path);
  const current = () => !this.disposed && (this.epochs.get(job.path) ?? 0) === job.epoch && this.stamp(job.path) === stamp;
  try {
   const file = this.app.vault.getAbstractFileByPath(job.path);
   if (!(file instanceof TFile)) throw new Error('Missing native source');
   this.counters.reads++; this.counters.scans++;
   this.counters.maxConcurrentReads = Math.max(this.counters.maxConcurrentReads, this.active);
   const result = await scanFileWithMappings(this.app, file, this.settings.keyMappings);
   if (current()) this.accept(job.path, result.nativeProperties);
  } catch { if (current()) this.fail(job.path); }
 }
 prepare(tasks: readonly IndexedTask[]): void {
  for (const task of tasks) if (this.sourceReady(task)) this.getTask(task);
 }
 getTask(task: IndexedTask): NativeTaskProperties {
  const source = this.sources.get(task.primary.filePath);
  const available = !!source?.raw && !source.error && this.registryState === 'ready'
   && (!this.known || this.matchesKnown(task)) && !this.duplicateIds.has(task.operonId)
   && source.stamp === this.stamp(task.primary.filePath) && !this.pending.has(task.primary.filePath)
   && (!this.indexedStamps.has(task.primary.filePath) || this.indexedStamps.get(task.primary.filePath) === source.stamp);
  const key = `${task.primary.format}:${task.operonId}:${available}`;
  const cached = source?.rows.get(key);
  if (cached) return cached;
  const properties = new Map<string, NativePropertyRecord>();
  const raw = source?.raw;
  let identity = false;
  if (raw && task.primary.format === 'inline') {
   if (!source.inlineById) {
    source.inlineById = new Map();
    for (const candidate of raw.inline) source.inlineById.set(candidate.operonId, source.inlineById.has(candidate.operonId) ? null : candidate);
   }
   const candidate = source.inlineById.get(task.operonId);
   const parsed = candidate && candidate.fields.filter(field => field.key === 'operonId').length === 1 ? candidate : null;
   if (parsed) {
    identity = true;
    const types: Record<string, InlinePropertyType> = {};
    for (const field of parsed.fields) if (this.includes(field.sourceKey)) types[field.sourceKey] = this.typeFor(field.sourceKey) ?? 'text';
    const projection = readParsedInlinePropertyProjection(parsed, types, this.settings.keyMappings, this.settings.inlinePropertyDefinitions, (name, type) => {
     let plan = this.readPlans.get(name);
     if (!plan) { plan = createInlinePropertyReadPlan(name, type, this.settings.keyMappings, this.settings.inlinePropertyDefinitions); this.readPlans.set(name, plan); }
     return plan;
    });
    for (const property of projection.properties) {
     const value = property.state === 'valid' ? property.value : property.rawValue;
     properties.set(property.sourceName.toLowerCase(), { sourceName: property.sourceName, present: property.present, value,
      type: this.typeFor(property.sourceName), inline: property,
      reason: property.state === 'valid' ? this.reason(property.sourceName, value) : 'type-conflict' });
    }
   }
  } else if (raw?.frontmatter && fileTaskPropertyIdentityMatches(raw.frontmatter, task.operonId, this.settings.keyMappings)) {
   identity = true;
   const names = new Map<string, number>();
   for (const name of raw.order) names.set(name.toLowerCase(), (names.get(name.toLowerCase()) ?? 0) + 1);
   for (const name of raw.order) if (this.includes(name)) {
    const value = raw.frontmatter[name];
    const duplicate = this.aliasesFor(name).reduce((count, alias) => count + (names.get(alias) ?? 0), 0) > 1;
    properties.set(name.toLowerCase(), { sourceName: name, present: true, value, type: this.typeFor(name), reason: duplicate ? 'type-conflict' : this.reason(name, value) });
   }
  }
  this.counters.projections++;
  const result = { properties, available: available && identity, revision: `${source?.revision ?? this.revision}:${this.interpretationRevision}` };
  source?.rows.set(key, result);
  return result;
 }
 typeFor(name: string): InlinePropertyType | undefined {
  if (this.typeCache.has(name)) return this.typeCache.get(name);
  const aliases = this.aliasesFor(name);
  const key = Object.keys(this.types).find(key => aliases.includes(key.toLowerCase()));
  const type = key ? this.types[key] : undefined;
  this.typeCache.set(name, type);
  return type;
 }
 private aliasesFor(name: string): string[] {
  let aliases = this.aliasCache.get(name);
  if (!aliases) {
   const mapping = this.settings.keyMappings.find(item => [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
   aliases = [...new Set([name, ...(mapping ? [mapping.canonicalKey, mapping.visiblePropertyName] : [])].map(alias => alias.toLowerCase()))];
   this.aliasCache.set(name, aliases);
  }
  return aliases;
 }
 reason(name: string, value?: unknown): NativePropertyReadOnlyReason | undefined {
  if (this.registryState !== 'ready') return 'unavailable';
  if (!this.reasonCache.has(name)) this.reasonCache.set(name, nativePropertyReadOnlyReason(name, undefined, this.declarations, this.settings.keyMappings, this.types));
  return nativePropertyValueReadOnlyReason(value, this.typeFor(name), this.reasonCache.get(name));
 }
 private includes(name: string): boolean {
  if (!this.inclusionCache.has(name)) this.inclusionCache.set(name, this.includesUncached(name));
  return this.inclusionCache.get(name)!;
 }
 private includesUncached(name: string): boolean {
  if (isWritableRawYamlPropertyName(name, this.settings.keyMappings)) return true;
  const mapping = this.settings.keyMappings.find(item => item.isSystem === false && [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
  try { return !!mapping && resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, this.settings.keyMappings, this.settings.inlinePropertyDefinitions).encoding === 'vault-v1'; }
  catch { return false; }
 }
 dispose(): void {
  this.draftReaders.clear(); this.usageNames = new Set(); this.usageRevision = -1;
  this.disposed = true; this.listeners.clear(); this.sources.clear(); this.known = null; this.indexedStamps.clear(); this.tasksByPath.clear(); this.refreshSource = undefined;
  for (const job of this.jobs.values()) job.resolve();
  for (const pending of this.pending.values()) pending.resolve();
  this.pending.clear();
  this.jobs.clear(); this.queue = [];
  if (indexes.get(this.app) === this) indexes.delete(this.app);
 }
}
