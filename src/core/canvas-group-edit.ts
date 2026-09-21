import { matchingOperonGroupFields, parseOperonGroupRule, type GroupSettings, type GroupValidation } from './canvas-group-rule';
import { decodeInlineFieldValue } from './parser';
import { decodeTaskDataInlineValue, encodeTaskDataInlineValue, splitEscapedListItems } from './task-data-inline-codec';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from './task-media-reference';
import type { PropertyPoolField, PropertyPoolFavorite } from './property-value-pool';

/** Editing offsets refer to the original title, never a decoded display label. */
export function groupEditSlot(title: string, caret: number, settings: GroupSettings): { field: PropertyPoolField; start: number; end: number; value: string } | null {
 const match = /^\s*\{\{([^{}]*?)::/.exec(title);
 if (!match || !title.trimEnd().endsWith('}}')) return null;
 const key = match[1].trim();
 const fields = matchingOperonGroupFields(settings, key, true);
 if (fields.length !== 1) return null;
 const field = fields[0], start = match[0].length, end = title.lastIndexOf('}}');
 const raw = title.slice(start, end);
 let from = start, to = end;
 if (field.type === 'list') {
  const parts = splitEscapedListItems(raw);
  for (const part of parts) { to = from + part.length; if (caret <= to) break; from = to + 1; }
 }
 if (caret < start || caret > end) return null;
 const value = title.slice(from, to).trim();
 return { field, start: from, end: to, value: field.key === 'taskGallery' ? parseTaskMediaReferenceList(value)[0] ?? '' : field.key === 'taskType' || field.key === 'taskImage' ? decodeTaskDataInlineValue(value) : decodeInlineFieldValue(value) };
}

export function suggestGroupFields(query: string, settings: GroupSettings): PropertyPoolField[] {
 return matchingOperonGroupFields(settings, query);
}

/** Only a group title is serialized here; task writer and task serialization are untouched. */
export function replaceGroupEditSlot(title: string, caret: number, values: readonly string[], settings: GroupSettings, validation: GroupValidation): { title: string; caret: number } | null {
 const slot = groupEditSlot(title, caret, settings);
 if (!slot || values.some(value => !value.trim()) && values.some(value => value.trim()) || (slot.field.type === 'text' && values.length > 1)) return null;
 if (!values.length || values.every(value => !value.trim())) {
  let { start, end } = slot;
  if (slot.field.type === 'list') {
   if (title[end] === ';') end++;
   else if (title[start - 1] === ';') start--;
  }
  return { title: title.slice(0, start) + title.slice(end), caret: start };
 }
 const items = [...new Set(values.map(value => value.trim()))];
 const encode = (value: string) => slot.field.key === 'taskType' || slot.field.key === 'taskImage'
  ? encodeTaskDataInlineValue(value, true)
  : value.replace(/\\/g, '\\\\').replace(/\r\n|[\r\n]/g, '\\u000A').replace(/[{};]/g, character => '\\' + character);
 const text = slot.field.key === 'taskGallery' ? serializeTaskMediaReferenceList(items) : items.map(encode).join('; ');
 const inserted = ' ' + text;
 const next = title.slice(0, slot.start) + inserted + title.slice(slot.end);
 const parsed = parseOperonGroupRule(next, settings, validation);
 if (parsed.state !== 'valid') return null;
 return { title: next, caret: slot.start + inserted.length };
}

/** Convert one Pool value through the same lossless codec and validator as manual editing. */
export function groupTitleFromPool(value: PropertyPoolFavorite, settings: GroupSettings, validation: GroupValidation): string | null {
 const field = matchingOperonGroupFields(settings, value.key, true).find(item => item.key === value.key && item.type === value.type);
 if (!field) return null;
 const draft = '{{' + field.key + ':: }}';
 return replaceGroupEditSlot(draft, draft.length - 2, [value.value], settings, validation)?.title ?? null;
}
