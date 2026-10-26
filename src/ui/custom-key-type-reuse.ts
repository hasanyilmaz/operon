import { getNativePropertyIndex } from '../indexer/native-property-index';
import { parseYaml, type View, type App, type TFile } from 'obsidian';
import type { KeyMapping, OperonSettings } from '../types/settings';
import { cloneInlinePropertyDefinitions, type InlinePropertyDefinitions } from '../core/inline-property-definitions';
import { replaceUnusedCustomPropertyTypes } from '../core/custom-property-type-sync';
import { loadPropertyTypeRegistry } from '../core/property-type-registry';
import { extractFields } from '../core/parser';
import { splitFrontmatterDocument } from '../core/file-task-template-merge';
import { decodeFilePropertyColumnKey } from '../core/raw-yaml-property';
import { getNativeLightboxLeaves } from './native-lightbox-lifecycle';
import { parseOperonTableFile } from '../storage/table-file';
import { OPERON_TABLE_FILE_FORMAT } from '../types/table-file';
import { OPERON_TABLE_VIEW_TYPE, OPERON_TABLE_FILE_VIEW_TYPE, type TablePreset } from '../types/table';

export interface CustomKeyReusePreparation {
 definitions: InlinePropertyDefinitions;
 isCurrent(): boolean;
 rollback(): Promise<void>;
 dispose(): void;
}
const identity = (name: string): string => name.trim().toLowerCase();

/** References, including empty values, prevent reinterpreting an existing name. */
export function customKeySourceUses(content: string, names: ReadonlySet<string>, json = false): boolean {
 if (json) {
  const value: unknown = parseYaml(content);
  if (value && typeof value === 'object' && 'format' in value && value.format === OPERON_TABLE_FILE_FORMAT) {
   const table = parseOperonTableFile(content);
   if (table.status === 'valid') return customKeyTableReferences(table.preset, names);
  }
  return customKeyReferences(value, names);
 }
 const document = splitFrontmatterDocument(content);
 if (/^---\r?\n/u.test(content) && document.frontmatter === null) throw new Error('Cannot verify property usage in incomplete frontmatter');
 if (document.frontmatter !== null) {
  let keys: string[];
  try {
   const parsed: unknown = parseYaml(document.frontmatter + '\n');
   if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Not a property mapping');
   keys = Object.keys(parsed ?? {});
  } catch {
   // Unexpanded template values may be invalid YAML while their literal keys are clear.
   // Accept only flat block mappings; complex keys, merges and continuations stay guarded.
   keys = [];
   const lines = document.frontmatter.split(/\r?\n/u);
   for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    const match = line.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[\p{L}\p{N}_][\p{L}\p{N}_ .-]*)):[ \t]*(.*)$/u);
    if (!match) throw new Error('Cannot verify property usage in invalid frontmatter');
    const parsedKey: unknown = parseYaml(`${match[1]}: null`);
    if (!parsedKey || typeof parsedKey !== 'object' || Array.isArray(parsedKey)) throw new Error('Cannot verify property usage in invalid frontmatter');
    keys.push(Object.keys(parsedKey)[0]);
    // Some imported notes contain unindented continuations of a quoted scalar.
    // Consume only a complete parsed string; never hide a possible property line.
    if (/^["']/u.test(match[2])) {
     let scalar = match[2];
     let consumed = false;
     let complete = false;
     for (;;) {
      try { if (typeof parseYaml(scalar) === 'string') { complete = true; break; } } catch { /* Try a literal continuation below. */ }
      const next = lines[i + 1];
      if (!next || !/^[\p{L}\p{N}]/u.test(next) || next.includes(':')) break;
      scalar += `\n  ${next}`;
      i++;
      consumed = true;
      try { if (typeof parseYaml(scalar) === 'string') { complete = true; break; } } catch { /* Keep checking the quoted scalar. */ }
      if (i + 1 === lines.length) throw new Error('Cannot verify property usage in invalid frontmatter');
     }
     if (consumed && !complete) throw new Error('Cannot verify property usage in invalid frontmatter');
    }
   }
  }
  if (keys.some(name => names.has(identity(name)))) return true;
 }
 // Native Bases can also be embedded in Markdown, including templates and Canvas text.
 const fences = [...content.matchAll(/^ {0,3}(`{3,}|~{3,})base[^\n]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*\r?$/gmu)];
 if (fences.some(match => customKeyReferences(parseYaml(match[2]) as unknown, names))) return true;
 if (fences.length !== [...content.matchAll(/^ {0,3}(?:`{3,}|~{3,})base(?:[ \t]|\r?$)/gmu)].length) throw new Error('Cannot verify an incomplete Base block');
 // Templates may contain standalone fields without a task ID, including inside examples.
 return extractFields(content, 0, new Map(), []).fields.some(field => names.has(identity(field.sourceKey)));
}
const referenceSlots = new Set(['field', 'key', 'groupBy', 'subgroupBy', 'sortBy', 'swimlaneBy', 'property', 'propertyName', 'sourceName', 'order', 'columns', 'fieldOrder', 'fieldKey', 'latitude', 'longitude']);
/** Lightweight reference tokens, not a second formula evaluator. */
function expressionUses(value: string, names: ReadonlySet<string>): boolean {
 const tokens = value.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}_$][\p{L}\p{N}_$]*|\S/gu) ?? [];
 for (let i = 0; i < tokens.length; i++) {
  const token = tokens[i];
  if ((token === 'note' || token === 'this') && tokens[i + 1] === '[') {
   const property = tokens[i + 2];
   if (!property || !/^['"]/u.test(property) || tokens[i + 3] !== ']') return true; // Dynamic access cannot prove absence.
   if (names.has(identity(String(parseYaml(property))))) return true;
  }
  if (!names.has(identity(token)) || tokens[i + 1] === '(') continue;
  if (tokens[i - 1] !== '.' || tokens[i - 2] === 'note' || tokens[i - 2] === 'this') return true;
 }
 return false;
}
export function customKeyReferences(value: unknown, names: ReadonlySet<string>, reference = false, expression = false, propertyDictionary = false): boolean {
 if (typeof value === 'string') {
  const decoded = decodeFilePropertyColumnKey(value);
  return (reference || decoded !== null) && names.has(identity(decoded ?? value))
   || (expression || reference) && expressionUses(value, names)
   || customKeySourceUses(value, names);
 }
 if (Array.isArray(value)) return value.some(item => customKeyReferences(item, names, reference, expression));
 return !!value && typeof value === 'object' && Object.entries(value).some(([key, item]) =>
  propertyDictionary && (names.has(identity(key)) || expressionUses(key, names))
  || customKeyReferences(item, names, referenceSlots.has(key), expression || key === 'filters' || key === 'formulas', key === 'properties' || key === 'summaries' || key === 'fieldValues' || key === 'fields'));
}

/** Table columns select presentation only; sort/group/summary dependencies still count. */
function customKeyTableReferences(preset: TablePreset, names: ReadonlySet<string>): boolean {
 return customKeyReferences({ ...preset, columns: [] }, names);
}

/** Only an explicit add may replace unused interpretation metadata. Never runs at startup/render. */
export async function prepareCustomKeyTypeReuse(app: App, settings: OperonSettings, mapping: KeyMapping, getSettings: () => OperonSettings = () => settings): Promise<CustomKeyReusePreparation | undefined> {
 const definitions = cloneInlinePropertyDefinitions(settings.inlinePropertyDefinitions);
 const names = new Set([mapping.canonicalKey, mapping.visiblePropertyName].filter(Boolean).map(identity));
 const types = await loadPropertyTypeRegistry(app);
 const expectedType = mapping.type === 'list' ? 'multitext' : mapping.type;
 const changed = definitions?.entries.filter(entry => names.has(identity(entry.sourceName)) && entry.type !== mapping.type) ?? [];
 const conflicts = Object.entries(types).filter(([name, type]) => names.has(identity(name)) && type !== expectedType);
 if (!changed.length && !conflicts.length) return;
 // A separately assigned Obsidian type is not permission to overwrite it.
 if (conflicts.some(([name, type]) => !changed.some(entry => identity(entry.sourceName) === identity(name) && (entry.type === 'list' ? 'multitext' : entry.type) === type))) {
  throw new Error('This property has a different Obsidian type. Its existing type was preserved.');
 }
 if (!definitions || !changed.length) throw new Error('Property type mismatch');
 const references = () => { const current = getSettings(); return { filterSets: current.filterSets, kanbanPresets: current.kanbanPresets, tablePresets: current.tablePresets, calendarPresets: current.calendarPresets, pipelines: current.pipelines }; };
 const snapshot = references();
 const beforeReferences = JSON.stringify(snapshot);
 const { tablePresets, ...otherReferences } = snapshot;
 if (customKeyReferences(otherReferences, names) || tablePresets.some(preset => customKeyTableReferences(preset, names))) throw new Error('This property is still referenced by a filter, preset, or template.');
 const supported = (file: TFile) => ['md', 'base', 'table', 'canvas'].includes(file.extension.toLowerCase());
 type SourceView = View & { file?: TFile | null; editor?: { getValue(): string }; getViewData?: () => string; getPropertySourceSnapshot?: () => string | null };
 const isTable = (view: SourceView) => view.getViewType() === OPERON_TABLE_VIEW_TYPE || view.getViewType() === OPERON_TABLE_FILE_VIEW_TYPE;
 const views = (): SourceView[] => {
  const all = new Set<SourceView>();
  const add = (view: SourceView) => { if (view.getViewType() === 'markdown' || isTable(view) || view.file && supported(view.file)) all.add(view); };
  if (app.workspace.iterateAllLeaves) app.workspace.iterateAllLeaves(leaf => add(leaf.view));
  else app.workspace.getLeavesOfType('markdown').forEach(leaf => add(leaf.view));
  getNativeLightboxLeaves(app).forEach(leaf => add(leaf.view));
  return [...all];
 };
 // Native deferred leaves report a future view type but do not have an editor buffer.
 // Require both Obsidian's marker and the absence of readers; real drafts still count.
 const isDeferredSource = (view: SourceView): boolean => view.leaf?.view === view && view.leaf.isDeferred === true
  && !view.file && !view.editor && typeof view.getViewData !== 'function' && typeof view.getPropertySourceSnapshot !== 'function';
 const readBuffer = (view: SourceView): string => {
  if (isDeferredSource(view)) return ''; // The persisted file is still scanned below.
  let content: unknown;
  try { content = isTable(view) ? view.getPropertySourceSnapshot?.() : view.editor?.getValue() ?? view.getViewData?.(); }
  catch { /* Preserve the source identity in the failure shown by Settings. */ }
  if (typeof content !== 'string') throw new Error(`Cannot verify an open property source: ${view.file?.path ?? '(unsaved)'} [${view.getViewType()}]`);
  return content;
 };
 const buffers = new Map(views().map(view => [view, { file: view.file, content: readBuffer(view), deferred: isDeferredSource(view), json: isTable(view) || !!view.file && view.file.extension.toLowerCase() !== 'md' }]));
 const index = getNativePropertyIndex(app);
 const draftNames = JSON.stringify(index.draftPropertyNames());
 if (index.draftPropertyNames().some(name => names.has(name))) throw new Error('This property is still used in an open editor. Its type was preserved.');
 const files = app.vault.getFiles().filter(supported);
 const stamps = new Map<TFile, string>(files.map(file => [file, JSON.stringify([file.path, file.stat.mtime, file.stat.size])]));
 let invalidated = false;
 const changedSource = () => { invalidated = true; };
 const events = [app.vault.on('create', changedSource), app.vault.on('modify', changedSource), app.vault.on('delete', changedSource), app.vault.on('rename', changedSource)];
 const dispose = () => { for (const event of events) app.vault.offref(event); };
 const current = () => !invalidated && JSON.stringify(references()) === beforeReferences && JSON.stringify(index.draftPropertyNames()) === draftNames
  && files.every(file => app.vault.getAbstractFileByPath(file.path) === file && stamps.get(file) === JSON.stringify([file.path,file.stat.mtime,file.stat.size]))
  && views().length === buffers.size && views().every(view => { const saved = buffers.get(view); return !!saved && saved.file === view.file && saved.deferred === isDeferredSource(view) && saved.content === readBuffer(view); });
 let native: Awaited<ReturnType<typeof replaceUnusedCustomPropertyTypes>> | undefined;
 const rollback = async () => { await native?.rollback(); };
 try {
  for (const file of files) {
   if (invalidated) throw new Error('Property sources changed during verification');
   try {
    if (customKeySourceUses(await app.vault.read(file), names, file.extension.toLowerCase() !== 'md')) throw new Error('This property is still used in a note or template. Its type was preserved.');
   } catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} — ${file.path}`); }
  }
  for (const saved of buffers.values()) if (customKeySourceUses(saved.content, names, saved.json)) throw new Error('This property is still used in an open editor. Its type was preserved.');
  if (!current()) throw new Error('Property sources changed during verification');
  const verified = await loadPropertyTypeRegistry(app);
  if (!current() || JSON.stringify(verified) !== JSON.stringify(types)) throw new Error('Property types changed during verification');
  if (conflicts.length) native = await replaceUnusedCustomPropertyTypes(app, types, conflicts.map(([name]) => [name, expectedType]), current);
  for (const entry of definitions.entries) if (names.has(identity(entry.sourceName))) { entry.type = mapping.type; entry.encoding = 'vault-v1'; }
  return { definitions, isCurrent: () => current() && (native?.isCurrent() ?? true), rollback, dispose };
 } catch (error) {
  try { await rollback(); } finally { dispose(); }
  throw error;
 }
}
