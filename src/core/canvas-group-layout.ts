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

/** Finite edge-based search; only the destination and its optional mismatch container can grow. */
export function findGroupPlacement(parent: GroupRectangle, card: GroupRectangle, rectangles: readonly GroupRectangle[], groups: ReadonlySet<string>, outer?: GroupRectangle): GroupPlacement | null {
 const ancestors = (rect: GroupRectangle) => rectangles.filter(r => r.id !== rect.id && groups.has(r.id) && groupEncloses(r, rect));
 const excluded = new Set([card.id, parent.id, ...ancestors(parent).map(r => r.id)]);
 if (outer) excluded.add(outer.id);
 const obstacles = rectangles.filter(r => !excluded.has(r.id));
 const safeGrowth = (before: GroupRectangle, after: GroupRectangle, ignored: ReadonlySet<string>, expandable?: string) => {
  const parents = ancestors(before), parentIds = new Set(parents.map(r => r.id));
  if (parents.some(r => r.id !== expandable && !groupEncloses(r, after))) return false;
  return !rectangles.some(r => {
   if (ignored.has(r.id) || r.id === before.id || parentIds.has(r.id)) return false;
   if (groups.has(r.id) ? groupEncloses(before, r) : groupContains(before, r)) return false;
   return !groupContains(before, r) && groupContains(after, r) || overlapArea(after, r) > overlapArea(before, r);
  });
 };
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
  for (const y of rows) for (const x of columns) {
   const position = { ...card, x, y }, next = envelope(parent, position);
   const fits = direction === 0 ? next.x === parent.x && next.y === parent.y && next.width === parent.width && next.height === parent.height
    : direction === 1 ? next.x === parent.x && next.y === parent.y && next.width <= minWidth
     : direction === 2 ? next.x === parent.x && next.y === parent.y && next.height <= minHeight
      : direction === 3 ? next.x === parent.x && bottom(next) === bottom(parent) && next.width <= minWidth
       : next.y === parent.y && right(next) === right(parent) && next.height <= minHeight;
   const size = next.width * next.height;
   if (!fits || size >= area || obstacles.some(r => overlapArea(position, r) > 0)) continue;
   if (!safeGrowth(parent, next, new Set([card.id]), outer?.id)) continue;
   const nextOuter = outer ? envelope(outer, next) : undefined;
   if (outer && nextOuter && !safeGrowth(outer, nextOuter, new Set([card.id, parent.id]))) continue;
   best = { card: position, parent: next, outer: nextOuter }; area = size;
   if (direction === 0) return best;
  }
  if (best) return best;
 }
 return null;
}
