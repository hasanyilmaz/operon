import { parseOperonGroupRule, type GroupSettings, type GroupValidation } from './canvas-group-rule';
import { groupSyncRectangle } from './canvas-group-layout';

type NodeData = Record<string, unknown>;

/** Positive area only: touching borders are allowed, containment is an overlap. */
function area(a: NodeData, b: NodeData): number {
 const x = groupSyncRectangle(a), y = groupSyncRectangle(b);
 return x && y ? Math.max(0, Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x))
  * Math.max(0, Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y)) : 0;
}

/** Existing overlaps may be reduced or moved together; reads never repair a saved layout. */
export function conflictingScalarGroups(before: readonly NodeData[], after: readonly NodeData[], settings: GroupSettings, validation: GroupValidation): string | null {
 const field = (node: NodeData): string | null => {
  if (node.type !== 'group' || typeof node.label !== 'string') return null;
  const parsed = parseOperonGroupRule(node.label, settings, validation);
  return parsed.state === 'valid' && parsed.rule.field.type === 'text' ? parsed.rule.field.key : null;
 };
 const previous = new Map(before.map(node => [node.id, node]));
 const keys = new Map<NodeData, string | null>();
 const key = (node: NodeData) => { if (!keys.has(node)) keys.set(node, field(node)); return keys.get(node); };
 const groups = after.filter(node => key(node));
 for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
  const a = groups[i], b = groups[j], property = key(a);
  if (property !== key(b)) continue;
  const overlap = area(a, b); if (!overlap) continue;
  const oldA = previous.get(a.id), oldB = previous.get(b.id);
  if (!oldA || !oldB || key(oldA) !== property || key(oldB) !== property || overlap > area(oldA, oldB)) return property!;
 }
 return null;
}
