import { parseDependencyIdList } from '../core/dependency-graph';
import { readCanvasTaskReference } from '../ui/canvas-task-node';
import { readCanvasTaskId } from '../ui/task-card-canvas';
import type { CanvasTaskNode, TaskCanvas } from '../ui/canvas-task-adapter';
import type { TaskCardResolution } from '../ui/task-card-embed-model';

export type RelationSection = 'parent' | 'children' | 'blocking' | 'blockedBy' | 'connections';
export interface RelationRow { id: string; name: string; rank: number; resolution: TaskCardResolution }
export interface RelationGroup { key: RelationSection; rows: RelationRow[] }
export function canvasRelationTaskId(node: CanvasTaskNode): string | null {
 const data = node.getData();
 if ('operonTask' in data) return readCanvasTaskReference(data)?.taskId ?? null;
 return data.type === 'text' && typeof data.text === 'string' ? readCanvasTaskId(data.text) : null;
}
export function canvasRelationPresence(canvas: TaskCanvas, source: CanvasTaskNode): { present: Set<string>; connected: Set<string> } {
 const byNode = new Map<CanvasTaskNode, string>(), present = new Set<string>(), connected = new Set<string>();
 for (const node of canvas.nodes.values()) { const id = canvasRelationTaskId(node); if (id) { byNode.set(node, id); present.add(id); } }
 for (const value of canvas.edges?.values() ?? []) {
  const edge = value as { from?: { node?: CanvasTaskNode }; to?: { node?: CanvasTaskNode } };
  const other = edge.from?.node === source ? edge.to?.node : edge.to?.node === source ? edge.from?.node : undefined;
  const id = other && byNode.get(other); if (id) connected.add(id);
 }
 return { present, connected };
}
export function buildCanvasTaskRelations(id: string, resolve: (id: string) => TaskCardResolution, children: readonly string[], present: Set<string>, connected: Set<string>): RelationGroup[] {
 const source = resolve(id); if (source.state !== 'ready') return [];
 const fields = source.task.fieldValues;
 const groups: Array<[RelationSection, string[]]> = [
  ['parent', parseDependencyIdList(fields.parentTask)], ['children', [...children]],
  ['blocking', parseDependencyIdList(fields.blocking)], ['blockedBy', parseDependencyIdList(fields.blockedBy)],
 ];
 const related = new Set(groups.flatMap(([, ids]) => ids));
 groups.push(['connections', [...connected].filter(other => !related.has(other))]);
 return groups.map(([key, ids]) => ({ key, rows: [...new Set(ids)].filter(other => other !== id).map(other => {
  const resolution = resolve(other);
  return { id: other, name: resolution.state === 'ready' ? resolution.task.description || other : other,
   rank: connected.has(other) ? 0 : present.has(other) ? 1 : 2, resolution };
 }).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) })).filter(group => group.rows.length > 0);
}
