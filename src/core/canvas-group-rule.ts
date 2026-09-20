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

export function operonGroupFields(settings: GroupSettings): PropertyPoolField[] {
 return propertyPoolFields(settings).filter(field => (field.type === 'text' || field.type === 'list')
  && (GROUP_KEYS.has(field.key) || settings.keyMappings.some(mapping => mapping.canonicalKey === field.key && mapping.isSystem === false)));
}

/** Reuse the task parser, but require exactly one whole-title field and reject alias collisions. */
export function parseOperonGroupRule(label: string, settings: GroupSettings, validation: GroupValidation = {}): GroupRuleResult {
 const source = label.trim();
 if (!source.includes('{{')) return { state: 'normal' };
 const parsed = extractFields(source, 0, new Map(), settings.keyMappings);
 if (!parsed.fields.length) return source.startsWith('{{') && !source.endsWith('}}') ? { state: 'incomplete' } : { state: 'invalid', reason: 'syntax' };
 const field = parsed.fields[0];
 if (parsed.fields.length !== 1 || field.containerRange.from !== 0 || field.containerRange.to !== source.length) return { state: 'invalid', reason: 'syntax' };
 const names = new Map<string, Set<string>>();
 for (const key of new Set([...settings.keyMappings.map(mapping => mapping.canonicalKey), ...GROUP_KEYS])) {
  const aliases = [key, ...(LEGACY_CANONICAL_KEY_ALIASES[key] ?? []), ...settings.keyMappings.filter(mapping => mapping.canonicalKey === key).map(mapping => mapping.visiblePropertyName)];
  for (const name of aliases) { if (!name) continue; const keys = names.get(name) ?? new Set<string>(); keys.add(key); names.set(name, keys); }
 }
 const keys = names.get(field.sourceKey);
 if (keys && keys.size > 1) return { state: 'invalid', reason: 'ambiguous-property' };
 const key = keys?.values().next().value as string | undefined;
 const descriptor = operonGroupFields(settings).find(item => item.key === key);
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
  const value = groupValue(settings, descriptor, raw, validation);
  if (!value) return { state: 'invalid', reason: 'invalid-value' };
  if (!values.some(item => item.value === value.value)) values.push(value);
 }
 if (!values.length) return { state: 'invalid', reason: 'empty-value' };
 return { state: 'valid', rule: { source, field: descriptor, values, requiresTargetValidation: descriptor.key === 'taskImage' || descriptor.key === 'taskGallery' } };
}

function groupValue(settings: GroupSettings, field: PropertyPoolField, raw: string, validation: GroupValidation): PropertyPoolFavorite | null {
 let value = raw.trim(); let label = value;
 if (!value) return null;
 const base = { key: field.key, type: field.type };
 if (field.key === 'status') {
  const matches = settings.pipelines.flatMap(pipeline => pipeline.statuses.filter(status => composeStatusValue(pipeline.name, status.label) === value).map(status => ({ ...base, value, label: `${pipeline.name}.${status.label}`, pipelineId: pipeline.id, statusId: status.id })));
  return matches.length === 1 ? matches[0] : null;
 }
 if (field.key === 'priority') {
  const matches = settings.priorities.filter(priority => priority.label === value);
  return matches.length === 1 ? { ...base, value, label, priorityId: matches[0].id } : null;
 }
 if (field.key === 'taskColor') {
  const colors = settings.colorPalette.filter(color => color.name === value);
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
 const field = operonGroupFields(settings).find(item => item.key === rule.field.key && item.type === rule.field.type);
 if (!field || task.state !== 'ready' || !isValidOperonId(task.taskId)) return { state: 'unavailable' };
 const values = rule.values.map(value => resolvePropertyPoolFavorite(settings, value));
 if (values.some(value => !value || !groupValue(settings, field, value.value, validation))) return { state: 'unavailable' };
 const old = task.fieldValues[field.key] ?? '';
 if (field.type === 'list') {
  const before = field.key === 'tags' ? [...task.tags] : field.key === 'taskGallery' ? parseTaskMediaReferenceList(old) : parseListValue(old);
  const after = [...before];
  for (const value of values) if (value && !after.some(item => (field.key === 'tags' ? item.replace(/^#+/u, '') : item.trim()) === value.value)) after.push(value.value);
  return { state: 'ready', matches: before.length === after.length, changed: before.length !== after.length, before, after, movement: 'none', currentValue: old };
 }
 const next = values[0]?.value;
 if (next === undefined) return { state: 'unavailable' };
 const normalized = old.trim() ? groupValue(settings, field, old, validation)?.value ?? old.trim() : '';
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
