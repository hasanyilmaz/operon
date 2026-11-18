import { editorMappedProperties } from './file-task-property-draft';
import { markdownBodyStartLine } from './markdown-body';
import { iterateMarkdownLinesOutsideFences } from './markdown-fenced-lines';
import { CANONICAL_KEY_MAP } from '../types/keys';
import type { OperonField, ParsedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';
import { parseListValue, parseTaskLine } from './parser';
import { serializeTask } from './serializer';
import { isWritableRawYamlPropertyName } from './raw-yaml-property';
import { decodeVaultPropertyValue, encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions, type InlinePropertyType } from './inline-property-definitions';
import type { NativePropertyInline } from '../indexer/native-property-persistence';

export interface InlinePropertySnapshot {
 sourceName: string;
 type: InlinePropertyType;
 present: boolean;
 rawValue?: string;
 value?: VaultPropertyValue;
 state: 'missing' | 'valid' | 'unsupported' | 'conflict';
}
export interface InlinePropertyChange {
 mappedKey?: string;
 sourceName: string;
 type: InlinePropertyType;
 expected: { present: boolean; rawValue?: string };
 mutation: { kind: 'set'; value: VaultPropertyValue } | { kind: 'remove' };
}
export interface InlinePropertyProjection {
 operonId: string;
 filePath: string;
 sourceRevision: string;
 properties: readonly InlinePropertySnapshot[];
}
export interface InlinePropertyReadPlan {
 sourceName: string;
 type: InlinePropertyType;
 aliases: ReadonlySet<string>;
 encoding?: 'legacy' | 'vault-v1';
}
/** Interpretation depends on settings, not on a task; shared-index hydration can reuse it. */
export function createInlinePropertyReadPlan(sourceName: string, type: InlinePropertyType,
 mappings: KeyMapping[], definitions?: InlinePropertyDefinitions): InlinePropertyReadPlan {
 const mapping = mappings.find(item => item.canonicalKey === sourceName || item.visiblePropertyName === sourceName);
 const aliases = new Set([sourceName, ...(mapping ? [mapping.canonicalKey, mapping.visiblePropertyName] : [])].map(name => name.toLowerCase()));
 try { return { sourceName, type, aliases, encoding: resolveInlinePropertyDefinition(sourceName, type, mappings, definitions).encoding }; }
 catch { return { sourceName, type, aliases }; }
}
export function readInlinePropertyProjection(
 line: string, filePath: string, types: Readonly<Record<string, InlinePropertyType>>,
 mappings: KeyMapping[], definitions?: InlinePropertyDefinitions,
): InlinePropertyProjection | null {
 const parsed = parseTaskLine(line, 0, filePath, mappings);
 if (!parsed?.operonId) return null;
 return readParsedInlinePropertyProjection(parsed, types, mappings, definitions);
}
/** Reuse the indexer's parsed task without scanning its source again. */
export function readParsedInlinePropertyProjection(
 parsed: NativePropertyInline & Partial<Pick<ParsedTask, 'filePath' | 'rawLine'>>, types: Readonly<Record<string, InlinePropertyType>>,
 mappings: KeyMapping[], definitions?: InlinePropertyDefinitions,
 readPlan?: (name: string, type: InlinePropertyType) => InlinePropertyReadPlan,
): InlinePropertyProjection {
 const byName = new Map<string, typeof parsed.fields>();
 for (const field of parsed.fields) {
  const name = field.sourceKey.toLowerCase();
  const group = byName.get(name);
  if (group) group.push(field); else byName.set(name, [field]);
 }
 const properties = Object.entries(types).map(([sourceName, type]): InlinePropertySnapshot => {
  const plan = readPlan?.(sourceName, type) ?? createInlinePropertyReadPlan(sourceName, type, mappings, definitions);
  const matches = [...plan.aliases].flatMap(alias => byName.get(alias) ?? []);
  if (matches.length > 1) return { sourceName, type, present: true, state: 'conflict' };
  const field = matches[0];
  if (!field) return { sourceName, type, present: false, state: 'missing' };
  try {
   if (!plan.encoding) throw new Error('Invalid property interpretation');
   const value = plan.encoding === 'legacy' && type === 'list'
    ? parseListValue(field.value) : plan.encoding === 'legacy' && type === 'text'
     ? field.value : decodeVaultPropertyValue(field.rawValue, type);
   return { sourceName, type, present: true, rawValue: field.rawValue, value, state: 'valid' };
  } catch {
   return { sourceName, type, present: true, rawValue: field.rawValue, state: 'unsupported' };
  }
 });
 return { operonId: parsed.operonId!, filePath: parsed.filePath ?? '', sourceRevision: parsed.rawLine ?? '', properties };
}
/** Member mutations target a position so equal values remain independent. */
export function mutateInlineListMember(
 snapshot: InlinePropertySnapshot, index: number, mutation: { kind: 'set'; value: string | number } | { kind: 'remove' },
): InlinePropertyChange {
 if (snapshot.type !== 'list' || snapshot.state !== 'valid' || !Array.isArray(snapshot.value)
  || !Number.isInteger(index) || index < 0 || index >= snapshot.value.length) throw new Error('Invalid list member');
 const value = [...snapshot.value];
 if (mutation.kind === 'remove') value.splice(index, 1);
 else value[index] = mutation.value;
 encodeVaultPropertyValue(value, 'list');
 return { sourceName: snapshot.sourceName, type: 'list', expected: { present: true, rawValue: snapshot.rawValue }, mutation: { kind: 'set', value } };
}
/** Adopt only submitted versions, preserving edits made while Save was pending. */
export function mergeInlinePropertyDraft(
 current: readonly InlinePropertySnapshot[], submitted: readonly InlinePropertySnapshot[], saved: readonly InlinePropertySnapshot[],
): InlinePropertySnapshot[] {
 const result = new Map(current.map(value => [value.sourceName, value]));
 for (const before of submitted) {
  if (JSON.stringify(result.get(before.sourceName)) !== JSON.stringify(before)) continue;
  const committed = saved.find(value => value.sourceName === before.sourceName);
  if (committed) result.set(before.sourceName, committed);
  else result.delete(before.sourceName);
 }
 return [...result.values()];
}
/** Resolve identities only in executable note content, never YAML or fenced examples. */
export function findInlinePropertyTask(content: string, filePath: string, operonId: string, mappings: KeyMapping[]) {
 const lines = content.split('\n');
 const start = markdownBodyStartLine(lines);
 if (start === null) return null;
 const matches = [...iterateMarkdownLinesOutsideFences(lines.slice(start).join('\n'), true)]
  .map(([offset, line]) => ({ index: start + offset, parsed: parseTaskLine(line, start + offset, filePath, mappings) }))
  .filter(item => item.parsed?.operonId === operonId);
 return matches.length === 1 && matches[0].parsed?.fields.filter(field => field.key === 'operonId').length === 1 ? matches[0] : null;
}
/** Rebase unedited noncanonical tokens on fresh source; edited aliases require exact source agreement. */
export function mergeInlineEditorSource(
 currentLine: string, submittedLine: string, baseline: readonly OperonField[], mappings: KeyMapping[], definitions?: InlinePropertyDefinitions, changes: readonly InlinePropertyChange[] = [],
): string | null {
 const current = parseTaskLine(currentLine, 0, '', mappings);
 const submitted = parseTaskLine(submittedLine, 0, '', mappings);
 if (!current || !submitted || current.operonId !== submitted.operonId) return null;
 const keys = new Set([...baseline, ...current.fields, ...submitted.fields].map(field => field.key).filter(key => !CANONICAL_KEY_MAP.has(key)));
 const preserved = new Set<string>();
 for (const key of keys) {
  const before = baseline.filter(field => field.key === key);
  const after = submitted.fields.filter(field => field.key === key);
  const fresh = current.fields.filter(field => field.key === key);
  const values = (fields: readonly OperonField[]) => JSON.stringify(fields.map(field => field.value));
  const tokens = (fields: readonly OperonField[]) => JSON.stringify(fields.map(field => field.sourceToken ?? field.rawValue));
  const mapping = mappings.find(item => item.isSystem === false && item.canonicalKey === key);
  // Native mutations are applied below; untouched raw fields retain their exact fresh source.
  if (changes.some(change => change.sourceName.toLowerCase() === (mapping?.visiblePropertyName ?? key).toLowerCase() || change.sourceName.toLowerCase() === key.toLowerCase()) || !mapping || values(before) === values(after) || before.length > 1 && after.length === 1 && before[before.length - 1].value === after[0].value) {
   preserved.add(key);
  } else {
   if (tokens(before) !== tokens(fresh) || before.length > 1 || fresh.length > 1) return null;
   // Legacy UI string payloads cannot express native list members without losing type or position.
   if (resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, mappings, definitions).encoding === 'vault-v1') return null;
  }
 }
 submitted.fields = [...submitted.fields.filter(field => !preserved.has(field.key)), ...current.fields.filter(field => preserved.has(field.key))];
 for (const change of changes) if (change.mappedKey) {
  const fresh = current.fields.filter(field => field.key === change.mappedKey);
  if (fresh.length !== 1 || fresh[0].rawValue !== change.expected.rawValue) return null;
  submitted.fields = submitted.fields.filter(field => field.key !== change.mappedKey);
  submitted.fields.push(fresh[0]);
 }
 try { return changes.length ? patchInlineProperties(serializeTask(submitted, mappings), '', submitted.operonId!, changes, mappings, definitions) : serializeTask(submitted, mappings); }
 catch { return null; }
}
/** Internal bridge for already authorized mapped fields; public List inputs remain string[]. */
export function prepareMappedInlineProperties(
 content: string, filePath: string, operonId: string,
 changes: readonly { field: string; value?: VaultPropertyValue }[], mappings: KeyMapping[], definitions?: InlinePropertyDefinitions,
): { changes: InlinePropertyChange[]; fieldValues: Record<string, string> } {
 const draft: InlinePropertyChange[] = [];
 const candidate = findInlinePropertyTask(content, filePath, operonId, mappings);
 if (!candidate?.parsed) throw new Error('Inline task identity conflict');
 for (const change of changes) {
  const mapping = mappings.find(item => item.isSystem === false && item.canonicalKey === change.field);
  if (!mapping || resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, mappings, definitions).encoding !== 'vault-v1') continue;
  const aliases = candidate.parsed.fields.filter(field => field.key === mapping.canonicalKey);
  if (aliases.length > 1) throw new Error('Property alias conflict');
  const source = aliases[0];
    draft.push({
   sourceName: source?.sourceKey ?? mapping.visiblePropertyName, type: mapping.type,
   expected: source ? { present: true, rawValue: source.rawValue } : { present: false },
   mutation: change.value === undefined ? { kind: 'remove' } : { kind: 'set', value: change.value },
  });
 }
 const patched = draft.length ? patchInlineProperties(content, filePath, operonId, draft, mappings, definitions) : content;
 const result = findInlinePropertyTask(patched, filePath, operonId, mappings)!.parsed!;
 const fieldValues: Record<string, string> = {};
 for (const change of changes) {
  const mapping = mappings.find(item => item.isSystem === false && item.canonicalKey === change.field);
  if (mapping && resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, mappings, definitions).encoding === 'vault-v1')
   fieldValues[mapping.canonicalKey] = result.fields.find(field => field.key === mapping.canonicalKey)?.value ?? '';
 }
 return { changes: draft, fieldValues };
}
export function patchInlineProperties(
 content: string, filePath: string, operonId: string, changes: readonly InlinePropertyChange[],
 mappings: KeyMapping[], definitions?: InlinePropertyDefinitions,
): string {
 const lines = content.split('\n');
 const candidate = findInlinePropertyTask(content, filePath, operonId, mappings);
 if (!candidate) throw new Error('Inline task identity conflict');
 const { index, parsed } = candidate;
 if (!parsed) throw new Error('Missing inline task');
 const seen = new Set<string>();
 for (const change of changes) {
  const name = change.sourceName, identity = name.toLowerCase();
  if (seen.has(identity) || /[\r\n{}]|::/u.test(name) || !name.trim()) throw new Error('Invalid property name');
  seen.add(identity);
  const mapping = mappings.find(item => [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
  const mappedRemoval = change.mappedKey && change.mutation.kind === 'remove' && editorMappedProperties({ [name]: null }, mappings, {}, definitions)[change.mappedKey]?.name === name;
  if (change.mappedKey && !mappedRemoval || !mappedRemoval && (!mapping || mapping.isSystem !== false) && !isWritableRawYamlPropertyName(name, mappings)) throw new Error('Reserved property');
  const matches = parsed.fields.filter(field => field.sourceKey.toLowerCase() === identity || !!mapping && field.key === mapping.canonicalKey);
  if (matches.length > 1) throw new Error('Property alias conflict');
  const existing = matches[0];
  if (!!existing !== change.expected.present || existing && existing.rawValue !== change.expected.rawValue) throw new Error('Property source conflict');
  const definition = resolveInlinePropertyDefinition(name, change.type, mappings, definitions);
  if (existing && definition.encoding === 'vault-v1') decodeVaultPropertyValue(existing.rawValue, change.type);
  if (change.mutation.kind === 'remove') {
   parsed.fields = parsed.fields.filter(field => field !== existing);
   continue;
  }
  if (definition.encoding !== 'vault-v1') throw new Error('Use legacy property writer');
  const rawValue = encodeVaultPropertyValue(change.mutation.value, change.type);
  const sourceKey = existing?.sourceKey ?? name;
  const token = '{{' + sourceKey + ':: ' + rawValue + '}}';
  const fresh = parseTaskLine('- [ ] Value ' + token, 0, filePath, mappings)?.fields[0];
  if (!fresh || fresh.rawValue !== rawValue) throw new Error('Unsafe property source');
  if (existing) parsed.fields[parsed.fields.indexOf(existing)] = fresh;
  else parsed.fields.push(fresh);
 }
 const original = lines[index];
 lines[index] = serializeTask(parsed, mappings) + (original.endsWith('\r') ? '\r' : '');
 return lines.join('\n');
}
