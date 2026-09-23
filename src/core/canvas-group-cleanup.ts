import { groupSyncRectangle, groupEncloses } from './canvas-group-layout';
import { readOperonGroupTracking } from './canvas-group-tracking';

type NodeData = Record<string, unknown>;
/** Partial intersections count as content too; only strictly enclosing groups are ancestors. */
export function groupCleanupContents(group: NodeData, nodes: readonly NodeData[]): NodeData[] | null {
 const rect = groupSyncRectangle(group);
 if (!rect) return null;
 const content: NodeData[] = [];
 for (const node of nodes) {
  if (node.id === group.id) continue;
  const other = groupSyncRectangle(node);
  if (!other) return null;
  if (node.type === 'group' && groupEncloses(other, rect) && !groupEncloses(rect, other)) continue;
  if (rect.x < other.x + other.width && other.x < rect.x + rect.width
   && rect.y < other.y + other.height && other.y < rect.y + rect.height) content.push(node);
 }
 return content;
}
export function canRemoveSyncGroup(group: NodeData, nodes: readonly NodeData[], edges: readonly NodeData[], editing?: ReadonlySet<string>): boolean {
 if (group.type !== 'group' || editing?.has(String(group.id))) return false;
 const rect = groupSyncRectangle(group);
 if (!rect || nodes.some(node => {
  const ancestor = editing?.has(String(node.id)) ? groupSyncRectangle(node) : null;
  return ancestor && node.type === 'group' && groupEncloses(ancestor, rect);
 })) return false;
 if (edges.some(edge => typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string' || edge.fromNode === group.id || edge.toNode === group.id)) return false;
 if (nodes.some(node => readOperonGroupTracking(node).state === 'unavailable')) return false;
 return groupCleanupContents(group, nodes)?.length === 0;
}
