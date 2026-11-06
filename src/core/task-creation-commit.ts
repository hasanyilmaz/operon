import { normalizeRepeatIdentityPayload } from './repeat-identity';
import { newFileTaskTitleFields } from './task-display-title';
import { serializeTaskListValue } from './subtask-inheritance';
import { stringifyYaml } from 'obsidian';
import { CANONICAL_KEY_MAP } from '../types/keys';
import type { CreationDraftSnapshot } from './task-creation-draft';
import { CreationDraftProperties, type CreationDraftPropertyContext } from './task-creation-draft-properties';
import { prepareCreationTemplate, resolveCreationTemplateValue, resolveCreationTemplatePropertyValues, type PreparedCreationTemplate, type CreationTemplateReason } from './task-creation-template';
import { getVisiblePropertyName } from './yaml-fields';
import { parseFrontmatterDocument, splitFrontmatterDocument } from './file-task-template-merge';
import { resolveOperonIdPlaceholders } from './operon-id-placeholders';
import { generateOperonId } from './id-generator';
import type { ParsedTask } from '../types/fields';
import { parseTaskLine } from './parser';
import { serializeTask } from './serializer';
import { patchInlineProperties, type InlinePropertyChange } from './inline-property-source';
import { resolveInlinePropertyDefinition, retainInlinePropertyDefinition, type InlinePropertyDefinition } from './inline-property-definitions';
import { type NormalizeTaskFieldPatchOptions } from './task-field-patch';

export interface PreparedCreationInput {
 description: string;
 createType: 'file' | 'inline';
 fileTaskDisplayTitleEnabled?: boolean;
 snapshot: CreationDraftSnapshot;
 template: PreparedCreationTemplate | { status: 'empty' | 'loading' | 'error' };
}
export interface PreparedCreationContent {
 operonId: string;
 fieldValues: Record<string, string>;
 tags: string[];
 definitions: InlinePropertyDefinition[];
 skipped: { sourceName: string; reason: string }[];
 inlineLine: string;
 /** Reapply authoritative fields after File Templater, preserving its body and deferred fields. */
 fileContent: (rendered?: string) => string;
}

/** Serialization only. Source priority and user intent have already been resolved by the shared draft. */
export function prepareCreationCommit(input: PreparedCreationInput, context: CreationDraftPropertyContext,
 identity: { operonId: string; now: string; createdAt?: string; checkbox?: ParsedTask['checkbox']; allocateId?: () => string }, repeat: NormalizeTaskFieldPatchOptions = {}): PreparedCreationContent {
 if (input.template.status === 'loading' || input.template.status === 'error' || input.snapshot.pendingSources.length) throw new Error('Template is not ready');
 const catalog = new CreationDraftProperties(context), mappings = [...context.keyMappings];
 const template = input.template.status === 'ready' ? input.template : null;
 const fields = structuredClone(input.snapshot.fields);
 if (template?.diagnostics.some(item => item.reason === 'type-conflict' || item.reason === 'unavailable')) throw new Error('Template property conflict');
 // Reuse the established identity allocator: independent body tasks stay independent,
 // while a suffix on the root identity remains bound to this task.
 let identitySource = template?.rawContent ?? '';
 if (template) {
  const document = parseFrontmatterDocument(identitySource, mappings);
  const root = document.sections.find(section => catalog.resolve(section.yamlKey).canonicalKey === 'operonId');
  const rootProperty = root ? resolveCreationTemplatePropertyValues(identitySource,template.inputs,template.clock)[root.yamlKey] : undefined;
  const rootValue = typeof rootProperty === 'string' ? rootProperty : '';
  const suffix = /^\{\{operonId([0-9A-Za-z]?)\}\}$/.exec(rootValue.trim())?.[1];
  if (root) identitySource = identitySource.replace(root.raw, stringifyYaml({[root.yamlKey]:identity.operonId}));
  if (input.createType === 'inline') identitySource = `---\n${splitFrontmatterDocument(identitySource).frontmatter ?? ''}\n---\n`;
  identitySource = resolveOperonIdPlaceholders(identitySource, {
   generateOperonId: identity.allocateId ?? generateOperonId,
   ...(suffix ? {stableSuffixOperonIds:{[suffix]:identity.operonId}} : {}),
  });
 }
 const identitySkipped: {sourceName:string;reason:CreationTemplateReason}[] = [];
 // Deferred references are resolved once against the identity allocated for this creation.
 if (template?.diagnostics.some(item => item.reason === 'identity')) {
  const resolved = prepareCreationTemplate({ content: identitySource,
   sourceId: template.sourceId, revision: template.revision, clock: template.clock, inputs: template.inputs, properties: context });
  if (resolved.status !== 'ready') throw new Error('Deferred template is invalid');
  for (const deferred of template.diagnostics.filter(item => item.reason === 'identity')) {
   const property = catalog.resolve(deferred.sourceName);
   if (fields.some(field => field.property.id === property.id && field.state !== 'missing')) continue;
   const diagnostic = resolved.diagnostics.find(item=>catalog.resolve(item.sourceName).id===property.id);
   if (diagnostic && (diagnostic.inline==='skip' || diagnostic.reason==='automatic')) { identitySkipped.push({sourceName:property.sourceName,reason:diagnostic.reason}); continue; }
   const value = resolved.fields.find(field => catalog.resolve(field.sourceName).id === property.id)?.value;
   const read = catalog.read(property, value);
   if (read.value === undefined || read.readOnlyReason) throw new Error('Deferred template type conflict');
   fields.push({ property, state: 'value', value: read.value, members: [], contributions: [], userModified: false });
  }
 }
 const skipped = template?.diagnostics.filter(item => (item.inline === 'skip' || item.reason === 'automatic') && !fields.some(field=>field.property.id===catalog.resolve(item.sourceName).id && (field.userModified || field.state==='removed'))).map(item => ({ sourceName: item.sourceName, reason: item.reason })) ?? [];
 skipped.push(...identitySkipped);
 const values = new Map<string, { name: string; value: unknown }>();
 const removed = new Set<string>();
 const native: InlinePropertyChange[] = [], definitions: InlinePropertyDefinition[] = [];
 const managed: Record<string,string> = {};
 let tags: string[] = [];
 for (const field of fields) {
  const property = catalog.resolve(field.property.sourceName), key = property.canonicalKey;
  if (property.id !== field.property.id || property.interpretation !== field.property.interpretation || property.type !== field.property.type) throw new Error('Property metadata changed');
  if (field.state === 'missing') continue;
  if (field.state === 'removed') { removed.add(property.id); continue; }
  const read = catalog.read(property, field.value);
  const reason = field.readOnlyReason ?? read.readOnlyReason;
  if (reason === 'type-conflict' || reason === 'unavailable') throw new Error('Property type or source could not be verified');
  if (reason) {
   if (input.createType === 'inline' && !skipped.some(item => item.sourceName === property.sourceName)) skipped.push({ sourceName: property.sourceName, reason });
   continue;
  }
  // Only an explicit Repeat picker edit may carry a reference date into the new task.
  const explicitRepeatReference = key === 'repeatOccurrenceDate' && field.userModified && typeof read.value === 'string' && !!read.value;
  if (property.merge === 'system' && !explicitRepeatReference || key === 'pinned' || key === 'subtasks') continue;
  if (read.value === undefined || !property.type) throw new Error('Invalid property value');
  const value = read.value;
  const name = key ? getVisiblePropertyName(key, mappings) : property.sourceName;
  values.set(property.id, { name, value });
  if (input.createType === 'inline' && (value === null || value === '' || Array.isArray(value) && value.length === 0)) continue;
  if (key === 'tags') { tags = Array.isArray(value) ? value.map(String) : []; continue; }
  if (property.interpretation === 'native') {
   const definition = resolveInlinePropertyDefinition(name, property.type, mappings, context.inlineDefinitions);
   definitions.push(definition);
   native.push({ sourceName: name, type: property.type, expected: { present: false }, mutation: { kind: 'set', value: value===null && property.type==='text' ? '' : value===null && property.type==='list' ? [] : value } });
  } else if (key && key !== 'subtasks' && key !== 'pinned') managed[key] = Array.isArray(value) ? serializeTaskListValue(value.map(String)) : value == null ? '' : String(value);
 }
 if (input.createType === 'file' && input.fileTaskDisplayTitleEnabled) {
  Object.assign(managed, newFileTaskTitleFields(input.description, managed, { fileTaskDisplayTitleEnabled: true, keyMappings: mappings }));
  const property = catalog.resolve('fileTaskDisplayTitle');
  removed.delete(property.id);
  values.set(property.id, { name: getVisiblePropertyName('fileTaskDisplayTitle', mappings), value: input.description });
 }
 const fieldValues = { ...managed, operonId: identity.operonId, datetimeCreated: identity.createdAt ?? identity.now, datetimeModified: identity.now };
 normalizeRepeatIdentityPayload({}, fieldValues, repeat.getAllRepeatSeriesIds ?? (() => new Set<string>()));
 for (const [key,value] of Object.entries(fieldValues)) {
  const property = catalog.resolve(key);
  const old = values.get(property.id);
  // Only workflow normalization and generated fields replace the already typed value.
  if (old && managed[key] === value) continue;
  const read = catalog.read(property, value);
  values.set(property.id, { name: getVisiblePropertyName(key, mappings), value: read.value ?? value });
 }
 const parsed = parseTaskLine(`- [ ] Task {{operonId:: ${identity.operonId}}}`, 0, '', mappings);
 if (!parsed) throw new Error('Could not initialize task');
 parsed.checkbox = identity.checkbox ?? 'open';
 parsed.description = input.description.replace(/\r?\n+/g, ' ').trim(); parsed.tags = tags;
 parsed.fields = Object.entries(fieldValues).map(([key,value]) => ({ key, sourceKey: key, value, rawValue: value,
  type: CANONICAL_KEY_MAP.get(key)?.type ?? mappings.find(mapping => mapping.canonicalKey === key)?.type ?? 'text', isCanonical: CANONICAL_KEY_MAP.has(key),
  containerRange: { from:0,to:0 }, valueRange: {from:0,to:0} }));
 let inlineLine = serializeTask(parsed, mappings);
 let combined = context.inlineDefinitions;
 for (const definition of definitions) combined=retainInlinePropertyDefinition(combined,definition);
 if (native.length) inlineLine = patchInlineProperties(inlineLine, '', identity.operonId, native, mappings, combined);
 const fileContent = (rendered?: string): string => {
  const document = parseFrontmatterDocument(rendered ?? identitySource, mappings);
  const source = rendered ?? identitySource;
  const materialized = template && rendered === undefined ? resolveCreationTemplatePropertyValues(source,template.inputs,template.clock) : {};
  const written = new Set<string>();
  const sections: string[] = [];
  for (const section of document.sections) {
   const id = catalog.resolve(section.yamlKey).id;
   if (removed.has(id)) continue;
   const replacement = values.get(id);
   if (replacement) {
    if (!written.has(id)) sections.push(stringifyYaml({ [section.yamlKey]: replacement.value }).trimEnd());
    written.add(id);
   } else if (catalog.resolve(section.yamlKey).merge === 'system') {
    continue;
   } else if (template && rendered === undefined && section.raw.includes('{{') && !section.raw.includes('<%')) {
    sections.push(stringifyYaml({[section.yamlKey]:materialized[section.yamlKey]}).trimEnd());
   } else sections.push(section.raw.trimEnd());
  }
  for (const [id,field] of values) if (!written.has(id)) sections.push(stringifyYaml({ [field.name]: field.value }).trimEnd());
  let body = document.body;
  if (rendered === undefined && template) body = resolveCreationTemplateValue(body, template.inputs, template.clock);
  return `---\n${sections.join('\n')}\n---\n${body}`;
 };
 return { ...identity, fieldValues, tags, definitions, skipped, inlineLine, fileContent };
}
