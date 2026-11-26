import type { InlinePropertyType } from './inline-property-definitions';
import { decodeTaskDataInlineValue, encodeTaskDataInlineValue } from './task-data-inline-codec';

export type VaultPropertyValue = string | number | boolean | null | (string | number)[];
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
function finiteNumber(text: string): number {
 if (!NUMERIC.test(text)) throw new Error('Invalid property number');
 const value = Number(text);
 if (!Number.isFinite(value)) throw new Error('Non-finite property number');
 if (/^[+-]?\d+$/u.test(text) && BigInt(text) !== BigInt(value)) throw new Error('Property number cannot be represented without loss');
 return value;
}
function encodeMember(item: string | number): string {
 if (typeof item === 'number') {
  if (!Number.isFinite(item)) throw new Error('Non-finite property number');
  return Object.is(item, -0) ? '-0' : String(item);
 }
 if (item && item.trim() === item && !NUMERIC.test(item) && !/[;"\\\r\n{}]/u.test(item)
  && (!/[[\]]/u.test(item) || /^\[\[[^[\]]+\]\]$/u.test(item))) return item;
 return JSON.stringify(item).replace(/[{}[\]]/gu, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}
export function decodeVaultPropertyList(raw: string): (string | number)[] {
 if (!raw.trim()) return [];
 const tokens: string[] = [];
 let token = '', quoted = false, escaped = false, wiki = 0;
 for (let index = 0; index < raw.length; index++) {
  const character = raw[index];
  if (escaped) { token += character; escaped = false; continue; }
  if (character === '\\') { token += character; escaped = true; continue; }
  if (character === '"') { quoted = !quoted; token += character; continue; }
  if (!quoted && raw.slice(index, index + 2) === '[[') { wiki++; token += '[['; index++; continue; }
  if (!quoted && wiki && raw.slice(index, index + 2) === ']]') { wiki--; token += ']]'; index++; continue; }
  if (character === ';' && !quoted && !wiki) { tokens.push(token.trim()); token = ''; } else token += character;
 }
 if (quoted || escaped || wiki) throw new Error('Unterminated property list');
 tokens.push(token.trim());
 return tokens.map(value => {
  if (!value) throw new Error('Empty list members must be quoted');
  if (value.startsWith('"')) {
   const decoded: unknown = JSON.parse(value);
   if (typeof decoded !== 'string') throw new Error('Expected list text');
   return decoded;
  }
  if (NUMERIC.test(value)) return finiteNumber(value);
  if (/[;"\\{}]/u.test(value) && !/^\[\[[^[\]]+\]\]$/u.test(value)) throw new Error('Quote special list text');
  return value;
 });
}
export function getVaultPropertyDateError(value: string, datetime: boolean): string | null {
 const pattern = datetime
  ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u
  : /^(\d{4})-(\d{2})-(\d{2})$/u;
 const match = pattern.exec(value);
 if (!match) return 'Invalid property date';
 const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
 const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
 const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
 if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
  || Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59 || Number(match[6] ?? 0) > 59) return 'Invalid property date';
 const offset = /[+-](\d{2}):(\d{2})$/u.exec(value);
 if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return 'Invalid property timezone';
 return null;
}
function validateDate(value: string, datetime: boolean): void {
 const error = getVaultPropertyDateError(value, datetime);
 if (error) throw new Error(error);
}
export function decodeVaultPropertyValue(raw: string, type: InlinePropertyType): VaultPropertyValue {
 if (type === 'list') return decodeVaultPropertyList(raw);
 if (type === 'text') return decodeTaskDataInlineValue(raw, true);
 if (!raw.trim()) return null;
 const value = raw.trim();
 if (type === 'number') return finiteNumber(value);
 if (type === 'checkbox') {
  if (value !== 'true' && value !== 'false') throw new Error('Invalid property checkbox');
  return value === 'true';
 }
 validateDate(value, type === 'datetime');
 return value;
}
export function encodeVaultPropertyValue(value: VaultPropertyValue, type: InlinePropertyType): string {
 if (value === null && type !== 'text' && type !== 'list') return '';
 if (type === 'list') {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' && typeof item !== 'number')) throw new Error('Expected property list');
  return value.map(encodeMember).join('; ');
 }
 if (type === 'text') {
  if (typeof value !== 'string') throw new Error('Expected property text');
  return encodeTaskDataInlineValue(value, false, true);
 }
 if (type === 'number') {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite property number');
  return Object.is(value, -0) ? '-0' : String(value);
 }
 if (type === 'checkbox') {
  if (typeof value !== 'boolean') throw new Error('Expected property checkbox');
  return String(value);
 }
 if (typeof value !== 'string') throw new Error('Expected property date');
 validateDate(value, type === 'datetime');
 return value;
}
