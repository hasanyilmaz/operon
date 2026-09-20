import type { GroupRectangle } from './canvas-group-rule';

export const GROUP_HEADER_SPACE = 62;
const GAP = 24;
const right = (r: GroupRectangle) => r.x + r.width;
const bottom = (r: GroupRectangle) => r.y + r.height;
export function groupSyncRectangle(data: Record<string, unknown>): GroupRectangle | null {
 const { id, x, y, width, height } = data;
 return typeof id === 'string' && [x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) && Number(width) > 0 && Number(height) > 0
  ? { id, x: Number(x), y: Number(y), width: Number(width), height: Number(height) } : null;
}
export function groupContains(outer: GroupRectangle, inner: GroupRectangle): boolean {
 const x = inner.x + inner.width / 2, y = inner.y + inner.height / 2;
 return x >= outer.x && x < right(outer) && y >= outer.y && y < bottom(outer);
}
export function groupEncloses(outer: GroupRectangle, inner: GroupRectangle): boolean {
 return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}
function overlapArea(a: GroupRectangle, b: GroupRectangle): number {
 return Math.max(0, Math.min(right(a) + GAP, right(b)) - Math.max(a.x - GAP, b.x))
  * Math.max(0, Math.min(bottom(a) + GAP, bottom(b)) - Math.max(a.y - GAP, b.y));
}
function envelope(parent: GroupRectangle, child: GroupRectangle): GroupRectangle {
 const x = Math.min(parent.x, child.x - GAP), y = Math.min(parent.y, child.y - GROUP_HEADER_SPACE);
 return { ...parent, x, y, width: Math.max(right(parent), right(child) + GAP) - x, height: Math.max(bottom(parent), bottom(child) + GAP) - y };
}
export interface GroupPlacement { card: GroupRectangle; parent: GroupRectangle; outer?: GroupRectangle }

/** Mutable, plan-local broad phase. Oversized rectangles stay in a bounded overflow set. */
export class GroupRectangleIndex {
 private rectangles = new Map<string, GroupRectangle>();
 private cells = new Map<string, Set<string>>();
 private memberships = new Map<string, string[] | null>();
 private overflow = new Set<string>();
 constructor(rectangles: Iterable<GroupRectangle>) { for (const rect of rectangles) this.set(rect); }
 private keys(rect: GroupRectangle, margin = 0): string[] | null {
  const left = Math.floor((rect.x - margin) / 512), top = Math.floor((rect.y - margin) / 512), endX = Math.floor((right(rect) + margin) / 512), endY = Math.floor((bottom(rect) + margin) / 512);
  if (![left, top, endX, endY].every(Number.isSafeInteger)) return null;
  if ((endX - left + 1) * (endY - top + 1) > 256) return null;
  const keys: string[] = [];
  for (let y = top; y <= endY; y++) for (let x = left; x <= endX; x++) keys.push(x + ':' + y);
  return keys;
 }
 delete(id: string): void {
  for (const key of this.memberships.get(id) ?? []) { const cell = this.cells.get(key)!; cell.delete(id); if (!cell.size) this.cells.delete(key); }
  this.memberships.delete(id); this.overflow.delete(id); this.rectangles.delete(id);
 }
 set(rect: GroupRectangle): void {
  this.delete(rect.id); this.rectangles.set(rect.id, rect);
  const keys = this.keys(rect); this.memberships.set(rect.id, keys);
  if (!keys) this.overflow.add(rect.id);
  else for (const key of keys) { const cell = this.cells.get(key) ?? new Set(); cell.add(rect.id); this.cells.set(key, cell); }
 }
 values(): GroupRectangle[] { return [...this.rectangles.values()]; }
 query(rect: GroupRectangle, margin = 0): GroupRectangle[] {
  // Keep the same arithmetic order as overlapArea, including at large coordinates.
  const keys = this.keys(rect, margin);
  const ids = keys ? new Set([...this.overflow, ...keys.flatMap(key => [...this.cells.get(key) ?? []])]) : this.rectangles.keys();
  const found: GroupRectangle[] = [];
  for (const id of ids) { const other = this.rectangles.get(id)!; if (rect.x - margin <= right(other) && other.x <= right(rect) + margin && rect.y - margin <= bottom(other) && other.y <= bottom(rect) + margin) found.push(other); }
  return found;
 }
}

/** Synchronous consumers use the exact same deterministic steps as cooperative planning. */
export function findGroupPlacement(...args: Parameters<typeof groupPlacementSteps>): GroupPlacement | null {
 const steps = groupPlacementSteps(...args); let step = steps.next(); while (!step.done) step = steps.next(); return step.value;
}

/** Finite edge-based search; only the destination and its optional mismatch container can grow. */
export function* groupPlacementSteps(parent: GroupRectangle, card: GroupRectangle, rectangles: readonly GroupRectangle[], groups: ReadonlySet<string>, outer?: GroupRectangle, accept: (placement: GroupPlacement) => boolean = () => true, index = new GroupRectangleIndex(rectangles)): Generator<void, GroupPlacement | null> {
 const ancestors = (rect: GroupRectangle) => rectangles.filter(r => r.id !== rect.id && groups.has(r.id) && groupEncloses(r, rect));
 const excluded = new Set([card.id, parent.id, ...ancestors(parent).map(r => r.id)]);
 if (outer) excluded.add(outer.id);
 const obstacles = rectangles.filter(r => !excluded.has(r.id));
 const safeGrowth = (before: GroupRectangle, after: GroupRectangle, ignored: ReadonlySet<string>, expandable?: string) => {
  if (before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height) return true;
  const parents = ancestors(before), parentIds = new Set(parents.map(r => r.id));
  if (parents.some(r => r.id !== expandable && !groupEncloses(r, after))) return false;
  return !index.query(after, GAP).some(r => {
   if (ignored.has(r.id) || r.id === before.id || parentIds.has(r.id)) return false;
   if (groups.has(r.id) ? groupEncloses(before, r) : groupContains(before, r)) return false;
   return !groupContains(before, r) && groupContains(after, r) || overlapArea(after, r) > overlapArea(before, r);
  });
 };
 let attempts = 0;
 const xs = [...new Set([parent.x + GAP, right(parent) - GAP - card.width, right(parent) + GAP, parent.x - GAP - card.width,
  ...obstacles.flatMap(r => [right(r) + GAP, r.x - GAP - card.width])])].sort((a, b) => a - b);
 const ys = [...new Set([parent.y + GROUP_HEADER_SPACE, bottom(parent) - GAP - card.height, bottom(parent) + GAP, parent.y - GAP - card.height,
  ...obstacles.flatMap(r => [bottom(r) + GAP, r.y - GAP - card.height])])].sort((a, b) => a - b);
 const minWidth = Math.max(parent.width, card.width + GAP * 2), minHeight = Math.max(parent.height, card.height + GROUP_HEADER_SPACE + GAP);
 // Internal space, down, right, up, left. Within a direction prefer the smallest growth.
 for (let direction = 0; direction < 5; direction++) {
  let best: GroupPlacement | null = null, area = Infinity;
  const columns = xs.filter(x => direction === 4 ? x <= right(parent) - GAP - card.width
   : x >= parent.x + GAP && (direction === 2 || x <= parent.x + (direction === 0 ? parent.width : minWidth) - GAP - card.width));
  const rows = ys.filter(y => direction === 3 ? y <= bottom(parent) - GAP - card.height
   : y >= parent.y + GROUP_HEADER_SPACE && (direction === 1 || y <= parent.y + (direction === 0 ? parent.height : minHeight) - GAP - card.height));
  // Sweep vertically once per direction. Candidate checks only see obstacles
  // intersecting the current row, rather than allocating a spatial query per slot.
  const relevant = obstacles.filter(r => r.x < columns[columns.length - 1] + card.width + GAP && right(r) > columns[0] - GAP);
  const starts = [...relevant].sort((a, b) => a.y - b.y), ends = [...relevant].sort((a, b) => bottom(a) - bottom(b));
  const active = new Set<GroupRectangle>(); let begin = 0, end = 0;
  for (const y of rows) {
   while (begin < starts.length && starts[begin].y < y + card.height + GAP) active.add(starts[begin++]);
   while (end < ends.length && bottom(ends[end]) <= y - GAP) active.delete(ends[end++]);
   for (const x of columns) {
   if (++attempts % 128 === 0) yield;
   const position = { ...card, x, y };
   let blocked = false;
   for (const r of active) if (overlapArea(position, r) > 0) { blocked = true; break; }
   if (blocked) continue;
   const next = envelope(parent, position);
   const fits = direction === 0 ? next.x === parent.x && next.y === parent.y && next.width === parent.width && next.height === parent.height
    : direction === 1 ? next.x === parent.x && next.y === parent.y && next.width <= minWidth
     : direction === 2 ? next.x === parent.x && next.y === parent.y && next.height <= minHeight
      : direction === 3 ? next.x === parent.x && bottom(next) === bottom(parent) && next.width <= minWidth
       : next.y === parent.y && right(next) === right(parent) && next.height <= minHeight;
   const size = next.width * next.height;
   if (!fits || size >= area) continue;
   if (!safeGrowth(parent, next, new Set([card.id]), outer?.id)) continue;
   const nextOuter = outer ? envelope(outer, next) : undefined;
   if (outer && nextOuter && !safeGrowth(outer, nextOuter, new Set([card.id, parent.id]))) continue;
   const placement = { card: position, parent: next, outer: nextOuter };
   if (!accept(placement)) continue;
   best = placement; area = size;
   if (direction === 0) return best;
  }
  }
  if (best) return best;
 }
 return null;
}
