import type { ListItemCache } from 'obsidian';
import type { IndexedTask } from '../types/fields';

/** Native Markdown nesting, including ordinary list items; no whitespace heuristic. */
export function nativeListDepths(items: readonly ListItemCache[]): Map<number, number> {
 const depths = new Map<number, number>();
 for (const item of [...items].sort((a, b) => a.position.start.line - b.position.start.line)) {
  const line = item.position.start.line;
  const parentDepth = item.parent >= 0 && item.parent < line ? depths.get(item.parent) : undefined;
  depths.set(line, parentDepth === undefined ? 0 : parentDepth + 1);
 }
 return depths;
}

/** One render snapshot. Values are extra native list levels, never stored in tasks. */
export function inlineTaskIndentLevels(tasks: readonly IndexedTask[], path: string, native: ReadonlyMap<number, number>): Map<string, number> {
 const byId = new Map(tasks.filter(task => task.primary.format === 'inline' && task.primary.filePath === path).map(task => [task.operonId, task]));
 const cyclic = new Map<string, boolean>();
 for (const id of byId.keys()) {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor = id;
  while (byId.has(cursor) && !cyclic.has(cursor) && !seen.has(cursor)) {
   seen.add(cursor); chain.push(cursor);
   cursor = byId.get(cursor)!.fieldValues.parentTask?.trim() ?? '';
  }
  const invalid = seen.has(cursor) || cyclic.get(cursor) === true;
  for (const member of chain) cyclic.set(member, invalid);
 }
 const total = new Map<string, number>();
 const extra = new Map<string, number>();
 for (const task of [...byId.values()].sort((a, b) => a.primary.lineNumber - b.primary.lineNumber)) {
  const base = native.get(task.primary.lineNumber);
  if (base === undefined || cyclic.get(task.operonId)) continue;
  const parent = byId.get(task.fieldValues.parentTask?.trim() ?? '');
  const parentDepth = parent && parent.primary.lineNumber < task.primary.lineNumber ? total.get(parent.operonId) : undefined;
  const target = parentDepth === undefined ? base : Math.max(base, parentDepth + 1);
  total.set(task.operonId, target);
  if (target > base) extra.set(task.operonId, target - base);
 }
 return extra;
}

export function applyReadingInlineIndent(row: HTMLElement, levels: number): void {
 row.classList.toggle('operon-reading-inline-indent', levels > 0);
 if (levels > 0) row.style.setProperty('--operon-inline-indent-levels', String(levels));
 else row.style.removeProperty('--operon-inline-indent-levels');
}
