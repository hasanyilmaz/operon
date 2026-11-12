import { stringifyYaml } from 'obsidian';
import { inspectOrderedYamlProperties, type OrderedYamlProperties, type YamlPropertyOffset } from './ordered-yaml-properties';
import { isEmptyFilePropertyValue, rawYamlPropertyExpectationsEqual, readRawYamlPropertyExpectation, type RawYamlPropertyExpectation, type RawYamlPropertyValue } from './raw-yaml-property';
import { getManagedYamlAliases } from './yaml-fields';
import type { KeyMapping } from '../types/settings';

export interface PropertyEditorDocument extends OrderedYamlProperties {
 readonlyNames?: ReadonlySet<string>;
}

export interface PropertyEditorChange {
 name: string;
 expected: RawYamlPropertyExpectation;
 value: RawYamlPropertyValue;
}

// YAML numbers outside JS integer precision cannot support reliable conflict checks.
function hasUnsafePropertyNumber(value: unknown): boolean {
 const unsafe = (item: unknown): boolean => typeof item === 'number'
  && (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item));
 return Array.isArray(value) ? value.some(unsafe) : unsafe(value);
}

interface PropertyEditorSource {
 prefix: string;
 yaml: string;
 suffix: string;
 fenced: boolean;
 indent: string;
 newline: string;
 entries: YamlPropertyOffset[];
 properties: PropertyEditorDocument;
}

function readPropertyEditorSource(content: string, mappings: KeyMapping[], allowTaskIdentity = false): PropertyEditorSource | null {
 const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
 const source = content.slice(bom.length);
 const opening = /^---[ \t]*(?:\r?\n|$)/u.exec(source);
 const newline = (opening?.[0] ?? source).includes('\r\n') ? '\r\n' : '\n';
 const empty = { yaml: '', indent: '', entries: [], properties: { frontmatter: {}, order: [] } };
 if (!opening) return { ...empty, prefix: bom, suffix: source, newline, fenced: false };
 const afterOpening = source.slice(opening[0].length);
 const closing = /^---[ \t]*(?=\r?$)/mu.exec(afterOpening);
 if (!closing) return null;
 const prefix = bom + opening[0];
 const yaml = afterOpening.slice(0, closing.index);
 const suffix = afterOpening.slice(closing.index);
 if (!/^[ \t]*[^#\s]/mu.test(yaml)) return { ...empty, prefix, yaml, suffix, newline, fenced: true };
 const parsed = inspectOrderedYamlProperties(yaml);
 if (!parsed) return null;
 const excluded = new Set([...getManagedYamlAliases('operonId', mappings), 'excalidraw-plugin'].map(name => name.toLowerCase()));
 const order = parsed.entries.map(entry => entry.name);
 if (!allowTaskIdentity && order.some(name => excluded.has(name.toLowerCase()))) return null;
 const readonlyNames = new Set<string>();
 for (const [index, entry] of parsed.entries.entries()) {
  const end = parsed.entries[index + 1]?.start ?? yaml.length;
  if (hasUnsafePropertyNumber(parsed.frontmatter[entry.name]) || !splitPropertyValue(yaml.slice(entry.keyEnd, end), parsed.indent)) readonlyNames.add(entry.name);
 }
 return { prefix, yaml, suffix, fenced: true, newline, indent: parsed.indent, entries: parsed.entries,
  properties: { frontmatter: parsed.frontmatter, order, ...(readonlyNames.size ? { readonlyNames } : {}) } };
}

/** Compare the exact body using the same fence/BOM rules as the safe YAML writer. */
export function propertyEditorPreservesBody(before: string, after: string, mappings: KeyMapping[]): boolean {
 const body = (text: string): string | null => {
  const source = readPropertyEditorSource(text, mappings);
  if (!source) return null;
  return source.fenced ? source.suffix.replace(/^---[ \t]*(?:\r?\n|$)/u, '') : source.suffix;
 };
 const previous = body(before);
 return previous !== null && previous === body(after);
}

export function readPropertyEditorDocument(content: string, mappings: KeyMapping[]): PropertyEditorDocument | null {
 return readPropertyEditorSource(content, mappings)?.properties ?? null;
}

/** Locate a YAML comment without mistaking quoted wikilinks, colors, or prose for comments. */
function scanPropertyLine(line: string): { comment: number; continued: boolean } {
 let quote = '', depth = 0, tokenStart = true;
 for (let index = 0; index < line.length; index++) {
  const char = line[index];
  if (quote) {
   if (quote === '"' && char === '\\' || quote === "'" && char === "'" && line[index + 1] === "'") { index++; continue; }
   if (char === quote) quote = '';
   continue;
  }
  if (char === '#' && (index === 0 || /\s/u.test(line[index - 1]))) return { comment: index, continued: depth > 0 };
  if (/\s/u.test(char)) continue;
  if (tokenStart && (char === '"' || char === "'")) quote = char;
  if (tokenStart && (char === '[' || char === '{')) { depth++; continue; }
  if (depth && (char === ']' || char === '}')) depth--;
  tokenStart = depth > 0 && (char === ',' || char === ':');
 }
 return { comment: -1, continued: !!quote || depth > 0 };
}

function splitPropertyValue(source: string, indent: string): { comment: string; tail: string } | null {
 const lines: string[] = source.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
 const first = (lines[0] ?? '').replace(/\r?\n$/u, '');
 const block = /^[ \t]*[|>]([1-9+-]*)/u.exec(first);
 // Anchors, aliases and explicit tags can change the interpretation of other fields.
 if (/^[ \t]*[&*!]/u.test(first)) return null;
 const { comment, continued } = scanPropertyLine(first);
 if (continued) return null;
 let end = lines.length;
 if (block) {
  const explicit = /[1-9]/u.exec(block[1]);
  const firstContent = lines.slice(1).find(line => line.trim() !== '');
  const contentIndent = explicit ? indent.length + Number(explicit[0])
   : Math.max(indent.length + 1, /^[ \t]*/u.exec(firstContent ?? '')![0].length);
  const tail = lines.findIndex((line, index) => index > 0 && line.trim() !== ''
   && /^[ \t]*/u.exec(line)![0].length < contentIndent);
  // Below the scalar indentation, comments belong to YAML, not the string.
  if (tail > 0) {
   if (lines.slice(tail).some(line => line.trim() !== '' && !/^[ \t]*#/u.test(line))) return null;
   end = tail;
  }
 }
 while (end > 1 && (lines[end - 1].trim() === '' || lines[end - 1].startsWith(indent + '#')
  || !block && /^[ \t]*#/u.test(lines[end - 1]))) end--;
 if (!block && lines.slice(1, end).some(line => {
  const scan = scanPropertyLine(line.replace(/^[ \t]*-[ \t]+/u, ''));
  return /^[ \t]*-[ \t]+[&*!]/u.test(line) || scan.comment >= 0 || scan.continued;
 })) return null;
 return { comment: comment < 0 ? '' : (/[ \t]*$/u.exec(first.slice(0, comment))?.[0] || ' ') + first.slice(comment), tail: lines.slice(end).join('') };
}

function encodePropertyValue(value: RawYamlPropertyValue, indent: string, newline: string): string[] {
 if (value === null) return [''];
 return stringifyYaml({ value }).replace(/\r?\n$/u, '').slice('value:'.length).split(/\r?\n/u)
  .map((line, index) => index === 0 ? line : newline + indent + line);
}

export function planPropertyEditorWrite(content: string, mappings: KeyMapping[], changes: readonly PropertyEditorChange[]):
 ReturnType<typeof planYamlPropertyWrite> {
 return planYamlPropertyWrite(content, mappings, changes);
}

/** Custom-key reuse may normalize only empty existing values, including in File Tasks.
 * Ordinary Property Editor admission remains unchanged. */
export function planEmptyCustomKeyValues(content: string, names: ReadonlySet<string>):
 ReturnType<typeof planYamlPropertyWrite> {
 const source = readPropertyEditorSource(content, [], true);
 if (!source) return { status: 'unsupported' };
 if (source.properties.order.some(name => name.toLowerCase() === 'excalidraw-plugin')) return { status: 'unsupported' };
 const matches = source.properties.order.filter(name => names.has(name.trim().toLowerCase()));
 if (matches.length > 1) return { status: 'unsupported' };
 const changes: PropertyEditorChange[] = [];
 for (const name of matches) {
  const value = source.properties.frontmatter[name];
  if (source.properties.readonlyNames?.has(name) || !(value === null || value === '' || Array.isArray(value) && value.length === 0)) return { status: 'unsupported' };
  changes.push({ name, expected: { present: true, value }, value: null });
 }
 return planYamlPropertyWrite(content, [], changes, true);
}

function planYamlPropertyWrite(content: string, mappings: KeyMapping[], changes: readonly PropertyEditorChange[], allowTaskIdentity = false):
 { status: 'ready'; text: string; properties: PropertyEditorDocument } | { status: 'conflict' | 'unsupported' } {
 const source = readPropertyEditorSource(content, mappings, allowTaskIdentity);
 if (!source) return { status: 'unsupported' };
 const { properties: document, indent, newline } = source;
 const expectedOrder = [...document.order];
 const edits = new Map<string, RawYamlPropertyValue>();
 const additions: string[] = [];
 try {
  for (const change of changes) {
   if (!change.name.trim() || edits.has(change.name) || document.readonlyNames?.has(change.name) || hasUnsafePropertyNumber(change.value)) return { status: 'unsupported' };
   const before = readRawYamlPropertyExpectation(document.frontmatter, change.name);
   if (!before || expectedOrder.some(name => name !== change.name && name.toLowerCase() === change.name.toLowerCase())) return { status: 'conflict' };
   if (rawYamlPropertyExpectationsEqual(before, { present: true, value: change.value })) continue;
   if (!rawYamlPropertyExpectationsEqual(before, change.expected)) return { status: 'conflict' };
   // A new field may have been cleared while its first save failed. The
   // verified absent baseline makes this a no-op, not an empty insertion.
   if (!before.present && isEmptyFilePropertyValue(change.value)) continue;
   edits.set(change.name, change.value);
   if (!before.present) {
    expectedOrder.push(change.name);
    const encoded = stringifyYaml(Object.fromEntries([[change.name, change.value]])).replace(/\r?\n$/u, '');
    additions.push(encoded.split(/\r?\n/u).map(line => indent + line).join(newline) + newline);
   }
  }
  if (!edits.size) return { status: 'ready', text: content, properties: document };
  let yaml = source.yaml;
  for (let index = source.entries.length - 1; index >= 0; index--) {
   const entry = source.entries[index];
   const value = edits.get(entry.name);
   if (value === undefined) continue;
   const end = source.entries[index + 1]?.start ?? source.yaml.length;
   const previous = splitPropertyValue(source.yaml.slice(entry.keyEnd, end), indent);
   if (!previous) return { status: 'unsupported' };
   const [first, ...rest] = encodePropertyValue(value, indent, newline);
   yaml = yaml.slice(0, entry.keyEnd) + first + previous.comment + rest.join('') + newline + previous.tail + yaml.slice(end);
  }
  yaml += additions.join('');
  const text = source.fenced ? source.prefix + yaml + source.suffix
   : source.prefix + '---' + newline + yaml + '---' + newline + source.suffix;
  const result = readPropertyEditorSource(text, mappings, allowTaskIdentity)?.properties;
  // Round-trip the whole mapping. This also catches YAML dependencies and any ambiguous formatting.
  if (!result || JSON.stringify(result.order) !== JSON.stringify(expectedOrder) || expectedOrder.some(name => {
   const changed = edits.get(name);
   if (changed === undefined) return JSON.stringify(result.frontmatter[name]) !== JSON.stringify(document.frontmatter[name]);
   const actual = readRawYamlPropertyExpectation(result.frontmatter, name);
   return !actual || !rawYamlPropertyExpectationsEqual(actual, { present: true, value: changed });
  })) return { status: 'unsupported' };
  return { status: 'ready', text, properties: result };
 } catch { return { status: 'unsupported' }; }
}
