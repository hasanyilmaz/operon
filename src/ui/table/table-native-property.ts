import { parseTableTaskListValue } from './table-value-adapter';
import type { TableValueResolver } from './table-value-cache';
import type { TableColumn } from '../../types/table';
import { getNativePropertyIcon, getCheckboxPropertyTypeIcon } from '../custom-field-surfaces';
import { TFile, type App } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { nativeEditorPropertyTypes } from '../../core/task-editor-native-properties';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../../core/vault-property-codec';
import { isWritableRawYamlPropertyName } from '../../core/raw-yaml-property';
import { getNativePropertyIndex, type NativeTaskProperties } from '../../indexer/native-property-index';
import {
 loadTableFilePropertyTypesFromConfig, encodeTableFilePropertyColumnKey, decodeTableFilePropertyColumnKey,
 createVaultFilePropertySnapshot, createCachedTableFilePropertyTypeResolver,
 getTableFilePropertyTypeIcon, normalizeTableFilePropertyValue,
 type TableFilePropertySnapshot, type TableFilePropertyField, type TableFilePropertyCellValue,
} from './table-file-property';

type Settings = Pick<OperonSettings, 'keyMappings' | 'inlinePropertyDefinitions'>;
const rowCells = new WeakMap<NativeTaskProperties, Map<string, TableFilePropertyCellValue>>();
const empty = (): TableFilePropertyCellValue => ({ present: false, rawValue: undefined, normalizedValue: '' });
/** Adapt the shared sparse index; no view-owned source cache or source reads. */
function projectSnapshot(app: App, base: TableFilePropertySnapshot, tasks: readonly IndexedTask[], settings: Settings): TableFilePropertySnapshot {
 const index = getNativePropertyIndex(app);
 const declarations = index.getTypes();
 const types = index.getNativeTypes();
 const candidateTypeResolver = createCachedTableFilePropertyTypeResolver(declarations);
 const fields = new Map<string, TableFilePropertyField>();
 const rows = new Map<string, NativeTaskProperties>();
 const counts = new Map<string, number>();
 for (const task of tasks) counts.set(task.operonId, (counts.get(task.operonId) ?? 0) + 1);
 for (const task of tasks) {
  const row = index.getTask(task);
  rows.set(task.operonId, counts.get(task.operonId) === 1 ? row : { ...row, available: false });
 }
 const add = (name: string, previous?: TableFilePropertyField, sample?: unknown) => {
  const knownType = index.typeFor(name);
  const type = knownType ?? previous?.type ?? candidateTypeResolver.resolve(name, [sample]).tableType;
  const reason = index.reason(name);
  fields.set(name.toLowerCase(), { key: previous?.key ?? encodeTableFilePropertyColumnKey(name)!, label: previous?.label ?? name,
   propertyName: name, type, sourceType: knownType ? candidateTypeResolver.resolve(name, [sample]).sourceType : previous?.sourceType ?? candidateTypeResolver.resolve(name, [sample]).sourceType, group: 'fileProperty',
   readonly: !!reason, readOnlyReason: reason, icon: reason === 'automatic' ? 'shield-alert' : type === 'checkbox' ? getCheckboxPropertyTypeIcon(settings.keyMappings, name) : getNativePropertyIcon(settings.keyMappings, name, getTableFilePropertyTypeIcon(type)),
   aliases: previous?.aliases ?? [name], sourceFileCount: previous?.sourceFileCount ?? 0 });
 };
 for (const field of base.fields) add(field.propertyName, field);
 for (const name of Object.keys(types)) if (isWritableRawYamlPropertyName(name, settings.keyMappings)) add(name, fields.get(name.toLowerCase()));
 for (const row of rows.values()) for (const property of row.properties.values()) {
  if (isWritableRawYamlPropertyName(property.sourceName, settings.keyMappings) && !fields.has(property.sourceName.toLowerCase())) add(property.sourceName, undefined, property.value);
 }
 const getCell = (task: IndexedTask, key: string): TableFilePropertyCellValue => {
  const name = decodeTableFilePropertyColumnKey(key)?.toLowerCase();
  const field = name ? fields.get(name) : undefined;
  if (!name || !field) return empty();
  const row = rows.get(task.operonId);
  const cached = row && rowCells.get(row)?.get(name);
  if (cached) return cached;
  const property = row?.properties.get(name);
  const reason = !row?.available ? 'unavailable' : property?.reason ?? field.readOnlyReason;
  const present = property?.present ?? false;
  const rawValue = property?.value;
  const cell: TableFilePropertyCellValue = { present, rawValue, normalizedValue: normalizeTableFilePropertyValue(rawValue), sourceName: property?.sourceName ?? field.propertyName,
   nativeState: reason ? 'unsupported' : 'ready', readOnlyReason: reason,
   ...(task.primary.format === 'inline' ? { inlineExpected: { present, rawValue: property?.inline?.rawValue } } : {}) };
  if (row) { const cells = rowCells.get(row) ?? new Map<string, TableFilePropertyCellValue>(); cells.set(name, cell); rowCells.set(row, cells); }
  return cell;
 };
 // Data signatures, rather than index generations, suppress redundant sort/search invalidations.
 const signature = JSON.stringify([[...fields.values()], tasks.map(task => [task.operonId, rows.get(task.operonId)?.available, rows.get(task.operonId)?.revision])]);
 return {
  revision: base.revision, signature, fields: [...fields.values()], getCell,
  getCandidates(key) {
   const name = decodeTableFilePropertyColumnKey(key)?.toLowerCase();
   if (!name || !fields.has(name)) return [];
   const vault = createVaultFilePropertySnapshot(app, candidateTypeResolver, { keyMappings: settings.keyMappings, nativeListCandidates: true });
   const values = new Set<string>();
   for (const field of vault.fields) if (field.propertyName.toLowerCase() === name) for (const value of vault.getCandidates(field.key)) values.add(value);
   for (const task of tasks) {
    const cell = getCell(task, key);
    if (!cell.present || cell.nativeState !== 'ready') continue;
    for (const value of Array.isArray(cell.rawValue) ? cell.rawValue : [cell.rawValue]) {
     if (typeof value === 'string' || typeof value === 'number') values.add(fields.get(name)?.type === 'list' ? encodeVaultPropertyValue([value], 'list') : String(value));
    }
   }
   return [...values];
  },
 };
}
/** Await the shared index for non-render consumers and focused integration tests. */
export async function loadTableNativePropertySnapshot(
 app: App, base: TableFilePropertySnapshot, tasks: readonly IndexedTask[], settings: Settings,
 _readSource?: (file: TFile) => Promise<string>, readValues = true,
): Promise<TableFilePropertySnapshot> {
 const index = getNativePropertyIndex(app); index.configure(settings);
 await index.ensure(readValues ? tasks : []);
 return projectSnapshot(app, base, readValues ? tasks : [], settings);
}
interface SnapshotScope {
 index: ReturnType<typeof getNativePropertyIndex>;
 generation: number;
 revision: number;
 baseSignature: string;
 baseRevision: number;
 tasks: Array<readonly [string, string, number, IndexedTask['primary']['format']]>;
}
interface SurfaceState {
 completed?: { scope: SnapshotScope; value: TableFilePropertySnapshot };
 pending?: { scope: SnapshotScope; onReady: () => void };
}
const surfaces = new WeakMap<object, SurfaceState>();
function sameScope(scope: SnapshotScope, index: SnapshotScope['index'], base: TableFilePropertySnapshot, tasks: readonly IndexedTask[], generation: number): boolean {
 if (scope.index !== index || scope.generation !== generation || scope.revision !== index.getRevision()
  || scope.baseSignature !== base.signature || scope.baseRevision !== base.revision || scope.tasks.length !== tasks.length) return false;
 return tasks.every((task, i) => {
  const previous = scope.tasks[i];
  return previous[0] === task.operonId && previous[1] === task.primary.filePath
   && previous[2] === task.primary.lineNumber && previous[3] === task.primary.format;
 });
}
function captureScope(index: SnapshotScope['index'], base: TableFilePropertySnapshot, tasks: readonly IndexedTask[], generation: number): SnapshotScope {
 return { index, generation, revision: index.getRevision(), baseSignature: base.signature, baseRevision: base.revision,
  tasks: tasks.map(task => [task.operonId, task.primary.filePath, task.primary.lineNumber, task.primary.format] as const) };
}
/** Cancel view notifications without discarding its one reusable successful snapshot. */
export function cancelTableNativePropertyRequest(owner: object): void {
 const state = surfaces.get(owner);
 if (state) state.pending = undefined;
}
/** A closed surface must neither retain its snapshot nor receive late completions. */
export function clearTableNativePropertySnapshot(owner: object): void {
 const state = surfaces.get(owner);
 if (state) { state.pending = undefined; state.completed = undefined; }
 surfaces.delete(owner);
}
export function getTableNativePropertySnapshot(
 owner: object, app: App, base: TableFilePropertySnapshot, tasks: readonly IndexedTask[], generation: number,
 settings: Settings, onReady: () => void, readValues = true,
): TableFilePropertySnapshot {
 if (!readValues) { cancelTableNativePropertyRequest(owner); return base; }
 const index = getNativePropertyIndex(app); index.configure(settings);
 let state = surfaces.get(owner);
 if (!state) { state = {}; surfaces.set(owner, state); }
 // Pending reindex and live source stamps can change before either revision does.
 if (index.isReady(tasks)) {
  state.pending = undefined;
  if (state.completed && sameScope(state.completed.scope, index, base, tasks, generation)) return state.completed.value;
  const value = projectSnapshot(app, base, tasks, settings);
  state.completed = { scope: captureScope(index, base, tasks, generation), value };
  return value;
 }
 if (state.pending && sameScope(state.pending.scope, index, base, tasks, generation)) {
  state.pending.onReady = onReady;
 } else {
  const pending = { scope: captureScope(index, base, tasks, generation), onReady };
  state.pending = pending;
  const surface = state;
  void index.ensure(tasks).then(() => {
   if (index.isActive() && surfaces.get(owner) === surface && surface.pending === pending) {
    surface.pending = undefined;
    pending.onReady();
   }
  });
 }
 return { ...base, signature: base.signature + '|native-loading', loading: true,
  getCell(task, column) { return { ...base.getCell(task, column), nativeState: 'unsupported', readOnlyReason: 'unavailable' }; } };
}

/** Internal table mutation bridge; no public Runtime mutation or DTO is extended. */
export async function writeTableNativeProperty(
 app: App, writer: import('../../core/task-writer').TaskWriter,
 task: IndexedTask, request: import('./table-file-property-editor').TableFilePropertyUpdateRequest,
 settings: Settings, modifiedTimestamp: string,
): Promise<import('./table-file-property-editor').TableFilePropertyUpdateResult> {
 if (!request.nativeType || request.sourceFormat !== task.primary.format) return 'unsupported';
 const declarations = await loadTableFilePropertyTypesFromConfig(app);
 const types = nativeEditorPropertyTypes(declarations, settings.keyMappings, settings.inlinePropertyDefinitions);
 const name = Object.keys(types).find(key => key.toLowerCase() === request.propertyName.toLowerCase());
 if (!name || types[name] !== request.nativeType || !isWritableRawYamlPropertyName(name, settings.keyMappings)) return 'unsupported';
 if (request.mutation.kind === 'set') {
  try { encodeVaultPropertyValue(request.mutation.value as VaultPropertyValue, request.nativeType); } catch { return 'unsupported'; }
 }
 const options: import('../../core/task-writer').TaskWriteOptions = { reindex: 'none', mode: 'merge' };
 if (task.primary.format === 'inline') {
  if (!request.inlineExpected) return 'unsupported';
  options.inlinePropertyDraft = [{ sourceName: request.propertyName, type: request.nativeType,
   expected: request.inlineExpected, mutation: request.mutation.kind === 'delete' ? { kind: 'remove' }
    : { kind: 'set', value: request.mutation.value as VaultPropertyValue } }];
 } else if (task.primary.format === 'yaml') {
  options.filePropertyDraft = { changes: [{ propertyName: request.propertyName, expected: request.expected,
   value: request.mutation.kind === 'set' ? request.mutation.value : null, remove: request.mutation.kind === 'delete', nativeType: request.nativeType }] };
 } else return 'unsupported';
 return await writer.writeTaskFields(task.operonId, { datetimeModified: modifiedTimestamp }, options) ? 'updated' : 'conflict';
}

/** A retained row is interactive only with positive proof, including out-of-scope/context rows. */
export function getVerifiedTableRowKeys(
 app: App, rows: Iterable<HTMLElement>, previous: {
  columns: TableColumn[]; valueResolver: TableValueResolver;
  getFilePropertyCell: (task: IndexedTask, key: string) => TableFilePropertyCellValue;
  getContextFilePropertyCell: (task: IndexedTask, key: string) => TableFilePropertyCellValue;
 } | null, getTask: (id: string) => IndexedTask | null | undefined,
): ReadonlySet<string> {
 const verified = new Set<string>();
 if (!previous) return verified;
 const index = getNativePropertyIndex(app);
 // Descendant projections depend on the complete task set; do not reuse their actions during partial readiness.
 if (previous.columns.some(column => ['progress', 'checkboxProgress', '__taskTree', '__countdown'].includes(column.key))) return verified;
 for (const element of rows) {
  const id = element.dataset.operonId ?? '';
  const task = getTask(id), old = previous.valueResolver.taskLookup.getTask(id);
  if (!task || !old || !index.isReady([task]) || JSON.stringify(task) !== JSON.stringify(old)) continue;
  const row = index.getTask(task);
  if (!row.available) continue;
  const relations = ['blockedBy', 'blocking', 'parentTask'].flatMap(key => parseTableTaskListValue(key, task.fieldValues[key] ?? ''));
  if (relations.some(id => { const current = getTask(id); return !current || !index.isReady([current])
   || JSON.stringify(current) !== JSON.stringify(previous.valueResolver.taskLookup.getTask(id)); })) continue;
  const readPrevious = element.classList.contains('operon-table-parent-context-row') ? previous.getContextFilePropertyCell : previous.getFilePropertyCell;
  if (previous.columns.some(column => {
   const name = decodeTableFilePropertyColumnKey(column.key)?.toLowerCase();
   if (!name) return false;
   const before = readPrevious(old, column.key), now = row.properties.get(name);
   return before.nativeState !== 'ready' || !!now?.reason || before.present !== (now?.present ?? false)
    || JSON.stringify(before.rawValue) !== JSON.stringify(now?.value);
  })) continue;
  verified.add(element.dataset.operonVirtualRowKey ?? id);
 }
 return verified;
}
