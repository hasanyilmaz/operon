import { parseYaml } from 'obsidian';

export interface OrderedYamlProperties {
 frontmatter: Record<string, unknown>;
 order: string[];
}

export interface YamlPropertyOffset { name: string; start: number; keyEnd: number }

/** Read the order from YAML, including keys that a JavaScript object would sort numerically. */
export function readOrderedYamlProperties(source: string): OrderedYamlProperties | null {
 const parsed = inspectOrderedYamlProperties(source);
 return parsed && { frontmatter: parsed.frontmatter, order: parsed.entries.map(entry => entry.name) };
}

export function inspectOrderedYamlProperties(source: string): {
 frontmatter: Record<string, unknown>;
 entries: YamlPropertyOffset[];
 indent: string;
} | null {
 try {
  const parsed: unknown = parseYaml(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const frontmatter = parsed as Record<string, unknown>;
  const names = new Set<string>();
  const entries: YamlPropertyOffset[] = [];
  const indent = source.match(/^([ \t]*)(?=[^#\s])/mu)?.[1] ?? '';
  for (const {0: raw, index} of source.matchAll(/[^\r\n]+/gu)) {
   if (!raw.startsWith(indent)) continue;
   const line = raw.slice(indent.length);
   if (/^-(?:\s|$)/u.test(line)) continue;
   const match = line.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s:#][^:]*)):(?:\s|$)/u);
   if (!match) continue;
   const parsedKey: unknown = parseYaml(`${match[1]}: null`);
   const key = parsedKey && typeof parsedKey === 'object' && !Array.isArray(parsedKey) ? Object.keys(parsedKey)[0] : null;
   if (!key || names.has(key) || !Object.prototype.hasOwnProperty.call(frontmatter, key)) return null;
   names.add(key);
   entries.push({ name: key, start: index, keyEnd: index + indent.length + match[1].length + 1 });
  }
  return Object.keys(frontmatter).length === names.size ? { frontmatter, entries, indent } : null;
 } catch { return null; }
}
