import { workflowColor, type WorkflowColorRef } from './workflow-color';
import { getCurrentLang } from './i18n';
import { splitEscapedListItems } from './task-data-inline-codec';
import type { OperonSettings } from '../types/settings';
import { LEGACY_CANONICAL_KEY_ALIASES } from '../types/keys';
import { extractFields, parseListValue, decodeInlineFieldValue, isLosslessInlineTag } from './parser';
import { propertyPoolFields, resolvePropertyPoolFavorite, type PropertyPoolField, type PropertyPoolFavorite } from './property-value-pool';
import { normalizeColorPaletteHex } from './color-palette';
import { normalizeTaskColorValue } from './task-color-value';
import { normalizeTaskIconValue } from './task-icon-value';
import { parseLocationCoordinate } from './location-coordinates';
import { composeStatusValue } from './workflow-status-value';
import { parseTaskMediaReferenceList, resolveTaskMediaReference } from './task-media-reference';
import { parseExternalLinkValue } from '../ui/field-pickers/links-utils';
import { isValidOperonId } from './id-generator';

export type GroupSettings = Pick<OperonSettings, 'keyMappings' | 'pipelines' | 'priorities' | 'colorPalette'>;
export interface GroupValidation { iconExists?: (name: string) => boolean }
const GROUP_KEYS = new Set(['status', 'priority', 'location', 'taskType', 'taskIcon', 'taskColor', 'taskImage', 'tags', 'contexts', 'assignees', 'links', 'taskGallery']);
export interface OperonGroupRule {
 readonly source: string;
 readonly field: PropertyPoolField;
 readonly values: readonly PropertyPoolFavorite[];
 /** Local media must also resolve unambiguously in the destination task context before a future write. */
 readonly requiresTargetValidation: boolean;
}
export type GroupRuleResult =
 | { state: 'normal' | 'incomplete' }
 | { state: 'invalid'; reason: 'syntax' | 'ambiguous-property' | 'unsupported-property' | 'empty-value' | 'multiple-values' | 'invalid-value' }
 | { state: 'valid'; rule: OperonGroupRule };

type CachedResolution = { rule: GroupRuleResult } | { value: PropertyPoolFavorite | null };
interface GroupResolutionContext {
 signature: readonly unknown[];
 fields: PropertyPoolField[];
 names: Map<string, Set<string>>;
 searchNames: Map<string, string[]>;
 statuses: Map<string, PropertyPoolFavorite[]>;
 priorities: Map<string, OperonSettings['priorities']>;
 colors: Map<string, OperonSettings['colorPalette']>;
 resolutions: Map<string, CachedResolution>;
}
const contexts = new WeakMap<GroupSettings, GroupResolutionContext>();
const DYNAMIC_FIELDS = new Set(['taskIcon', 'taskImage', 'taskGallery']);

function resolutionContext(settings: GroupSettings): GroupResolutionContext {
 // Settings can be edited in place; array/object identity alone is not a revision.
 // Compare the scalar inputs used by the resolver without serializing settings per card.
 // Workflow settings remain freshly checked by the task writer, outside this cache.
 const signature: unknown[] = [getCurrentLang(), settings.keyMappings.length];
 for (const mapping of settings.keyMappings) signature.push(mapping.canonicalKey, mapping.visiblePropertyName, mapping.type,
  mapping.enabled, mapping.isSystem, mapping.isInternal, mapping.icon);
 signature.push(settings.pipelines.length);
 for (const pipeline of settings.pipelines) {
  signature.push(pipeline.id, pipeline.name, pipeline.statuses.length);
  for (const status of pipeline.statuses) signature.push(status.id, status.label);
 }
 signature.push(settings.priorities.length);
 for (const priority of settings.priorities) signature.push(priority.id, priority.label);
 signature.push(settings.colorPalette.length);
 for (const color of settings.colorPalette) signature.push(color.id, color.name, color.hex);
 const previous = contexts.get(settings);
 if (previous && previous.signature.length === signature.length && signature.every((value, index) => value === previous.signature[index])) return previous;
 const fields = propertyPoolFields(settings).filter(field => (field.type === 'text' || field.type === 'list')
  && (GROUP_KEYS.has(field.key) || settings.keyMappings.some(mapping => mapping.canonicalKey === field.key && mapping.isSystem === false)));
 const aliases = new Map<string, string[]>();
 for (const key of new Set([...settings.keyMappings.map(mapping => mapping.canonicalKey), ...GROUP_KEYS])) aliases.set(key, [key, ...(LEGACY_CANONICAL_KEY_ALIASES[key] ?? [])]);
 for (const mapping of settings.keyMappings) if (mapping.visiblePropertyName) aliases.get(mapping.canonicalKey)!.push(mapping.visiblePropertyName);
 const names = new Map<string, Set<string>>();
 for (const [key, values] of aliases) for (const name of values) { if (!name) continue; const keys = names.get(name) ?? new Set<string>(); keys.add(key); names.set(name, keys); }
 const statuses = new Map<string, PropertyPoolFavorite[]>();
 for (const pipeline of settings.pipelines) for (const status of pipeline.statuses) {
  const value = composeStatusValue(pipeline.name, status.label), entries = statuses.get(value) ?? [];
  entries.push({ key: 'status', type: 'text', value, label: `${pipeline.name}.${status.label}`, pipelineId: pipeline.id, statusId: status.id }); statuses.set(value, entries);
 }
 const priorities = new Map<string, OperonSettings['priorities']>(), colors = new Map<string, OperonSettings['colorPalette']>();
 for (const priority of settings.priorities) { const entries = priorities.get(priority.label) ?? []; entries.push(priority); priorities.set(priority.label, entries); }
 for (const color of settings.colorPalette) { const entries = colors.get(color.name) ?? []; entries.push(color); colors.set(color.name, entries); }
 const context: GroupResolutionContext = { signature, fields, names, statuses, priorities, colors,
  searchNames: new Map(fields.map(field => [field.key, [...aliases.get(field.key) ?? [], field.label]])), resolutions: new Map() };
 contexts.set(settings, context); return context;
}
function recall(context: GroupResolutionContext, key: string): CachedResolution | undefined {
 const cached = context.resolutions.get(key);
 if (cached) { context.resolutions.delete(key); context.resolutions.set(key, cached); }
 return cached;
}
function remember(context: GroupResolutionContext, key: string, value: CachedResolution): void {
 context.resolutions.delete(key); context.resolutions.set(key, value);
 if (context.resolutions.size > 1024) {
  const oldest = context.resolutions.keys().next();
  if (!oldest.done) context.resolutions.delete(oldest.value);
 }
}
function copyRule(result: GroupRuleResult): GroupRuleResult {
 return result.state === 'valid' ? { state: 'valid', rule: { ...result.rule, field: { ...result.rule.field }, values: result.rule.values.map(value => ({ ...value })) } } : { ...result };
}
export function operonGroupFields(settings: GroupSettings): PropertyPoolField[] {
 return resolutionContext(settings).fields.map(field => ({ ...field }));
}
export function matchingOperonGroupFields(settings: GroupSettings, name: string, exact = false): PropertyPoolField[] {
 const context = resolutionContext(settings), query = exact ? name : name.trim().toLocaleLowerCase();
 return context.fields.filter(field => context.searchNames.get(field.key)!.some(value => exact ? value === query : value.toLocaleLowerCase().includes(query))).map(field => ({ ...field }));
}

/** Reuse the task parser, but require exactly one whole-title field and reject alias collisions. */
export function parseOperonGroupRule(label: string, settings: GroupSettings, validation: GroupValidation = {}): GroupRuleResult {
 const source = label.trim();
 if (!source.includes('{{')) return { state: 'normal' };
 const context = resolutionContext(settings), cacheKey = JSON.stringify(['rule', source]);
 const cached = recall(context, cacheKey);
 if (cached && 'rule' in cached) return copyRule(cached.rule);
 const result = parseGroupSource(source, settings, validation, context);
 // Icon availability is supplied by the caller; media always retains fresh safety validation.
 if (result.state === 'valid' && !DYNAMIC_FIELDS.has(result.rule.field.key)) remember(context, cacheKey, { rule: copyRule(result) });
 return result;
}
function parseGroupSource(source: string, settings: GroupSettings, validation: GroupValidation, context: GroupResolutionContext): GroupRuleResult {
 const parsed = extractFields(source, 0, new Map(), settings.keyMappings);
 if (!parsed.fields.length) return source.startsWith('{{') && !source.endsWith('}}') ? { state: 'incomplete' } : { state: 'invalid', reason: 'syntax' };
 const field = parsed.fields[0];
 if (parsed.fields.length !== 1 || field.containerRange.from !== 0 || field.containerRange.to !== source.length) return { state: 'invalid', reason: 'syntax' };
 const keys = context.names.get(field.sourceKey);
 if (keys && keys.size > 1) return { state: 'invalid', reason: 'ambiguous-property' };
 const key = keys?.values().next().value as string | undefined;
 const descriptor = context.fields.find(item => item.key === key);
 if (!descriptor) return { state: 'invalid', reason: 'unsupported-property' };
 // Parse again with the resolved canonical key so special field codecs remain authoritative.
 const canonical = extractFields(source, 0, new Map([[field.sourceKey, descriptor.key]]), settings.keyMappings).fields[0];
 if (!canonical.rawValue.trim()) return { state: 'invalid', reason: 'empty-value' };
 const rawItems = splitEscapedListItems(canonical.rawValue);
 if (rawItems.some(item => !item.trim())) return { state: 'incomplete' };
 if (descriptor.type === 'text' && rawItems.length !== 1) return { state: 'invalid', reason: 'multiple-values' };
 const rawValues = descriptor.type === 'text' ? [canonical.value.trim()] : descriptor.key === 'taskGallery'
  ? parseTaskMediaReferenceList(canonical.rawValue) : rawItems.map(item => decodeInlineFieldValue(item).trim());
 const values: PropertyPoolFavorite[] = [];
 for (const raw of rawValues) {
  const value = groupValue(context, descriptor, raw, validation);
  if (!value) return { state: 'invalid', reason: 'invalid-value' };
  if (!values.some(item => item.value === value.value)) values.push(value);
 }
 if (!values.length) return { state: 'invalid', reason: 'empty-value' };
 return { state: 'valid', rule: { source, field: { ...descriptor }, values, requiresTargetValidation: descriptor.key === 'taskImage' || descriptor.key === 'taskGallery' } };
}

function groupValue(context: GroupResolutionContext, field: PropertyPoolField, raw: string, validation: GroupValidation): PropertyPoolFavorite | null {
 const key = JSON.stringify(['value', field.key, raw]);
 const dynamic = DYNAMIC_FIELDS.has(field.key), cached = dynamic ? undefined : recall(context, key);
 if (cached && 'value' in cached) return cached.value ? { ...cached.value } : null;
 const value = resolveGroupValue(context, field, raw, validation);
 if (!dynamic) remember(context, key, { value: value ? { ...value } : null });
 return value;
}
function resolveGroupValue(context: GroupResolutionContext, field: PropertyPoolField, raw: string, validation: GroupValidation): PropertyPoolFavorite | null {
 let value = raw.trim(); let label = value;
 if (!value) return null;
 const base = { key: field.key, type: field.type };
 if (field.key === 'status') {
  const matches = context.statuses.get(value) ?? [];
  return matches.length === 1 ? { ...matches[0] } : null;
 }
 if (field.key === 'priority') {
  const matches = context.priorities.get(value) ?? [];
  return matches.length === 1 ? { ...base, value, label, priorityId: matches[0].id } : null;
 }
 if (field.key === 'taskColor') {
  const colors = context.colors.get(value) ?? [];
  if (colors.length > 1) return null;
  const hex = normalizeColorPaletteHex(colors[0]?.hex ?? value);
  if (!hex) return null;
  value = normalizeTaskColorValue(hex); label = colors[0]?.name ?? hex;
 }
 if (field.key === 'taskIcon') { value = normalizeTaskIconValue(value); if (!validation.iconExists?.(value)) return null; }
 if (field.key === 'location') { const coordinate = parseLocationCoordinate(value); if (!coordinate) return null; value = coordinate.canonical; }
 if (field.key === 'links') { const link = parseExternalLinkValue(value); if (!link) return null; label = link.displayValue; }
 if ((field.key === 'taskImage' || field.key === 'taskGallery') && !resolveTaskMediaReference(value).isOpenable) return null;
 if (field.key === 'tags') { value = value.replace(/^#+/u, ''); if (!isLosslessInlineTag(value)) return null; }
 return { ...base, value, label };
}

/** Draft edits never replace an active rule; committing an invalid title disables it. */
export function operonGroupEditState(previous: OperonGroupRule | null, result: GroupRuleResult, editing: boolean): { rule: OperonGroupRule | null; suspended: boolean } {
 return { rule: editing ? previous : result.state === 'valid' ? result.rule : null, suspended: editing };
}
export type GroupTaskState = { state: 'ready'; taskId: string; fieldValues: Record<string, string>; tags: readonly string[] } | { state: 'missing' | 'conflict' };
export type GroupEvaluation = { state: 'unavailable' } | {
 state: 'ready'; matches: boolean; changed: boolean; before: string | string[]; after: string | string[];
 movement: 'none' | 'changed-value' | 'changed-empty'; currentValue: string;
};
/** Pure proposed field effect, not a workflow/write authorization. */
export function evaluateOperonGroup(settings: GroupSettings, rule: OperonGroupRule, task: GroupTaskState, validation: GroupValidation = {}): GroupEvaluation {
 const context = resolutionContext(settings);
 const field = context.fields.find(item => item.key === rule.field.key && item.type === rule.field.type);
 if (!field || task.state !== 'ready' || !isValidOperonId(task.taskId)) return { state: 'unavailable' };
 const values = rule.values.map(value => resolvePropertyPoolFavorite(settings, value));
 if (values.some(value => !value || !groupValue(context, field, value.value, validation))) return { state: 'unavailable' };
 const old = task.fieldValues[field.key] ?? '';
 if (field.type === 'list') {
  const before = field.key === 'tags' ? [...task.tags] : field.key === 'taskGallery' ? parseTaskMediaReferenceList(old) : parseListValue(old);
  const after = [...before];
  for (const value of values) if (value && !after.some(item => (field.key === 'tags' ? item.replace(/^#+/u, '') : item.trim()) === value.value)) after.push(value.value);
  return { state: 'ready', matches: before.length === after.length, changed: before.length !== after.length, before, after, movement: 'none', currentValue: old };
 }
 const next = values[0]?.value;
 if (next === undefined) return { state: 'unavailable' };
 const normalized = old.trim() ? groupValue(context, field, old, validation)?.value ?? old.trim() : '';
 const matches = normalized === next;
 return { state: 'ready', matches, changed: !matches, before: old, after: next, movement: matches ? 'none' : normalized ? 'changed-value' : 'changed-empty', currentValue: normalized };
}

export interface GroupRectangle { id: string; x: number; y: number; width: number; height: number }
export function smallestOperonGroupAtCenter(card: Omit<GroupRectangle, 'id'>, groups: readonly (GroupRectangle & { rule: GroupRuleResult })[]): string | null {
 const finite = (rect: Omit<GroupRectangle, 'id'>) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
 if (!finite(card)) return null;
 const x = card.x + card.width / 2, y = card.y + card.height / 2;
 return [...groups].filter(group => group.rule.state === 'valid' && finite(group) && x >= group.x && x < group.x + group.width && y >= group.y && y < group.y + group.height)
  .sort((a, b) => a.width * a.height - b.width * b.height || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.id ?? null;
}

/** Resolve only valid scalar workflow rules; identity is never inferred from display color. */
export function resolveGroupColor(title: string, settings: GroupSettings): { ref: WorkflowColorRef; color: string } | null {
 const parsed = parseOperonGroupRule(title, settings, { iconExists: () => false });
 if (parsed.state !== 'valid' || parsed.rule.values.length !== 1) return null;
 const value = parsed.rule.values[0];
 const ref: WorkflowColorRef | null = value.key === 'priority' && value.priorityId ? { kind: 'priority', priorityId: value.priorityId }
  : value.key === 'status' && value.pipelineId && value.statusId ? { kind: 'status', pipelineId: value.pipelineId, statusId: value.statusId } : null;
 const color = ref && workflowColor(settings, ref);
 return ref && color ? { ref, color } : null;
}
