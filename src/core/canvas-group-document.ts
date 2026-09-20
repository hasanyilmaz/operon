import type { GroupSyncPlan } from './canvas-group-sync';
import { readCanvasTaskReference } from '../ui/canvas-task-node';
import { canRemoveSyncGroup } from './canvas-group-cleanup';

export interface GroupCanvasDocument extends Record<string, unknown> {
 nodes: Record<string, unknown>[];
 edges: Record<string, unknown>[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function decimalKey(token: string): string {
 const [mantissa, exponent = '0'] = token.toLowerCase().split('e'), [whole, fraction = ''] = mantissa.replace(/^-/, '').split('.');
 const digits = (whole + fraction).replace(/^0+/, '').replace(/0+$/, '');
 if (!digits) return token.startsWith('-') ? '-0' : '0';
 const trimmed = (whole + fraction).replace(/0+$/, '');
 return (token.startsWith('-') ? '-' : '') + digits + ':' + (Number(exponent) - fraction.length + whole.length + fraction.length - trimmed.length);
}
/** JSON.parse alone silently drops duplicate keys and rounds long numeric tokens. */
function losslessJson(content: string): boolean {
 const stack: (Set<string> | null)[] = [];
 const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]]/g;
 for (const match of content.matchAll(tokens)) {
  const token = match[0];
  if (token === '{') stack.push(new Set());
  else if (token === '[') stack.push(null);
  else if (token === '}' || token === ']') stack.pop();
  else if (token.startsWith('"')) {
   if (!/^\s*:/.test(content.slice(match.index + token.length))) continue;
   const keys = stack[stack.length - 1], key: unknown = JSON.parse(token);
   if (!keys || typeof key !== 'string' || keys.has(key)) return false;
   keys.add(key);
  } else if (!Number.isFinite(Number(token)) || decimalKey(token) !== decimalKey(String(Number(token)))) return false;
 }
 return true;
}
/** Reject malformed documents rather than normalizing them during an automatic write. */
export function readGroupCanvasDocument(content: string): GroupCanvasDocument | null {
 try {
  const data: unknown = JSON.parse(content);
  if (!losslessJson(content)) return null;
  if (!record(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
  const nodes: unknown[] = data.nodes, edges: unknown[] = data.edges;
  const ids = new Set<string>();
  for (const node of [...nodes, ...edges]) {
   if (!record(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id)) return null;
   ids.add(node.id);
  }
  if (nodes.some(node => !record(node) || typeof node.type !== 'string' || !['x', 'y', 'width', 'height'].every(key => typeof node[key] === 'number' && Number.isFinite(node[key])))) return null;
  if (edges.some(edge => !record(edge) || typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string')) return null;
  // JSON numbers outside the runtime's finite range would otherwise be rewritten as null.
  JSON.stringify(data, (_key, value: unknown) => { if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite Canvas number'); return value; });
  return data as GroupCanvasDocument;
 } catch { return null; }
}
export function groupCanvasTaskIds(data: GroupCanvasDocument): Set<string> {
 return new Set(data.nodes.flatMap(node => { const ref = readCanvasTaskReference(node); return ref ? [ref.taskId] : []; }));
}
/** Materialize the shared plan while retaining root fields, edges, node order and formatting style. */
export function writeGroupCanvasDocument(content: string, data: GroupCanvasDocument, plan: GroupSyncPlan, makeId: () => string): string {
 if (!plan.patches.length && !plan.groups.length && !plan.removals.length) return content;
 const copy = structuredClone(data), occupied = new Set([...copy.nodes, ...copy.edges].map(node => String(node.id)));
 const ids = new Map<string, string>();
 for (const group of plan.groups) {
  let id = ''; for (let attempt = 0; attempt < 10; attempt++) { id = makeId(); if (id && !occupied.has(id)) break; id = ''; }
  if (!id) throw new Error('Canvas node ID collision');
  occupied.add(id); ids.set(String(group.id), id);
 }
 for (const patch of plan.patches) {
  const index = copy.nodes.findIndex(node => node.id === patch.before.id);
  if (index < 0 || JSON.stringify(copy.nodes[index]) !== JSON.stringify(patch.before)) throw new Error('Stale Canvas patch');
  const next = structuredClone(patch.after);
  if (record(next.operonGroupTracking)) for (const key of ['changedGroupId', 'groupId']) {
   const value = next.operonGroupTracking[key]; if (typeof value === 'string' && ids.has(value)) next.operonGroupTracking[key] = ids.get(value);
  }
  copy.nodes[index] = next;
 }
 copy.nodes.push(...plan.groups.map(group => ({ ...group, id: ids.get(String(group.id))! })));
 if (plan.removals.length && JSON.stringify(plan.edges) !== JSON.stringify(copy.edges)) throw new Error('Stale Canvas edges');
 for (const before of plan.removals) {
  const index = copy.nodes.findIndex(node => node.id === before.id);
  if (index < 0 || JSON.stringify(copy.nodes[index]) !== JSON.stringify(before)
   || !canRemoveSyncGroup(copy.nodes[index], copy.nodes, copy.edges)) throw new Error('Stale Canvas removal');
  copy.nodes.splice(index, 1);
 }
 const indent = content.match(/\n([\t ]+)"/)?.[1] ?? (content.includes('\n') ? '\t' : undefined);
 let result = JSON.stringify(copy, null, indent);
 if (content.includes('\r\n')) result = result.replace(/\n/g, '\r\n');
 if (/\r?\n$/.test(content)) result += content.endsWith('\r\n') ? '\r\n' : '\n';
 return result;
}
