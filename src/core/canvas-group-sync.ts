import { readCanvasTaskReference } from '../ui/canvas-task-node';
import { replaceGroupEditSlot } from './canvas-group-edit';
import { evaluateOperonGroup, operonGroupFields, parseOperonGroupRule, smallestOperonGroupAtCenter, type GroupRectangle, type GroupRuleResult, type GroupSettings, type GroupTaskState, type GroupValidation } from './canvas-group-rule';
import { readOperonGroupTracking, withOperonGroupTracking, type OperonGroupTracking } from './canvas-group-tracking';

type NodeData = Record<string, unknown>;
const HEADER_SPACE = 62;
const label = (data: NodeData): string => typeof data.label === 'string' ? data.label : '';
export interface GroupSyncPatch { before: NodeData; after: NodeData }
export interface GroupSyncMove { id: string; value: string; context: string; previousGroupId?: string; tracking: OperonGroupTracking }
export interface GroupSyncPlan {
 patches: GroupSyncPatch[];
 groups: NodeData[];
 moves: GroupSyncMove[];
 unavailable: string[];
}
export interface GroupSyncInput {
 nodes: readonly NodeData[];
 settings: GroupSettings;
 resolve(id: string): GroupTaskState;
 validation: GroupValidation;
 editing?: ReadonlySet<string>;
 manual?: ReadonlySet<string>;
 candidates?: ReadonlySet<string>;
}
export function groupSyncRectangle(data: NodeData): GroupRectangle | null {
 const { id, x, y, width, height } = data;
 return typeof id === 'string' && [x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) && Number(width) > 0 && Number(height) > 0
  ? { id, x: Number(x), y: Number(y), width: Number(width), height: Number(height) } : null;
}
function contains(outer: GroupRectangle, inner: GroupRectangle): boolean {
 const x = inner.x + inner.width / 2, y = inner.y + inner.height / 2;
 return x >= outer.x && x < outer.x + outer.width && y >= outer.y && y < outer.y + outer.height;
}
function encloses(outer: GroupRectangle, inner: GroupRectangle): boolean {
 return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
function overlaps(a: GroupRectangle, b: GroupRectangle): boolean {
 return a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x && a.y < b.y + b.height + 24 && a.y + a.height + 24 > b.y;
}
function ruleIdentity(result: GroupRuleResult): string {
 return result.state !== 'valid' ? '' : JSON.stringify([result.rule.field.key, result.rule.field.type,
  result.rule.values.map(value => [value.value, value.pipelineId, value.statusId, value.priorityId])]);
}

/** Detached routing plan. No task writer, native Canvas, persistence or event subscriptions. */
export function planCanvasGroupSync(input: GroupSyncInput): GroupSyncPlan {
 const plan: GroupSyncPlan = { patches: [], groups: [], moves: [], unavailable: [] };
 const original = new Map(input.nodes.filter(node => typeof node.id === 'string').map(node => [String(node.id), node]));
 const nodes = new Map([...original].map(([id, data]) => [id, structuredClone(data)]));
 const rules = new Map<string, GroupRuleResult>();
 const rule = (data: NodeData) => {
  const id = String(data.id); let result = rules.get(id);
  if (!result) { result = parseOperonGroupRule(label(data), input.settings, input.validation); rules.set(id, result); }
  return result;
 };
 const fields = operonGroupFields(input.settings);
 const sourceGroups = input.nodes.filter(node => node.type === 'group' && groupSyncRectangle(node));
 const groups = () => [...nodes.values()].filter(node => node.type === 'group' && groupSyncRectangle(node)).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
 const normal = (node: NodeData | undefined): node is NodeData => !!node && node.type === 'group' && !!groupSyncRectangle(node) && rule(node).state === 'normal';
 let serial = 0;
 const create = (label: string, x: number, y: number, width: number, height: number) => {
  let id: string; do { id = 'operon-changed-draft-' + ++serial; } while (nodes.has(id));
  const node = { id, type: 'group', label, x, y, width, height };
  nodes.set(id, node); plan.groups.push(node); return node;
 };
 const grow = (parent: NodeData, child: GroupRectangle) => {
  const rect = groupSyncRectangle(parent)!;
  parent.width = Math.max(rect.width, child.x + child.width + 24 - rect.x);
  parent.height = Math.max(rect.height, child.y + child.height + 24 - rect.y);
 };
 // Append vertically into free space. Existing cards, groups and their order never move.
 const place = (parent: NodeData, card: GroupRectangle, excluded: ReadonlySet<string>): GroupRectangle => {
  const rect = groupSyncRectangle(parent)!;
  const next = { ...card, x: rect.x + 24, y: rect.y + HEADER_SPACE };
  const obstacles = [...nodes.values()].map(groupSyncRectangle).filter((item): item is GroupRectangle => !!item && !excluded.has(item.id));
  for (;;) {
   const collisions = obstacles.filter(item => overlaps(next, item));
   if (!collisions.length) return next;
   next.y = Math.max(...collisions.map(item => item.y + item.height + 24));
  }
 };
 for (const id of [...original.keys()].sort()) {
  const data = nodes.get(id)!, ref = readCanvasTaskReference(data), rect = groupSyncRectangle(data);
  if (!ref || !rect || input.candidates && !input.candidates.has(id)) continue;
  const read = readOperonGroupTracking(data); if (read.state === 'unavailable') continue;
  const tracked = read.state === 'ready' ? read.value : null;
  const enclosing = sourceGroups.filter(group => contains(groupSyncRectangle(group)!, rect));
  // An unfinished/invalid inner rule must not silently fall back to its old tracking rule.
  if (enclosing.some(group => input.editing?.has(String(group.id)))) continue;
  const groupId = smallestOperonGroupAtCenter(rect, enclosing.map(group => ({ ...groupSyncRectangle(group)!, rule: rule(group) })));
  const group = groupId ? original.get(groupId)! : null;
  const parsed = group ? rule(group) : null;
  const activeRule = parsed?.state === 'valid' ? parsed.rule : null;
  if (!activeRule && enclosing.some(group => label(group).includes('{{') && rule(group).state !== 'valid')) continue;
  const oldChanged = tracked?.changedGroupId ? nodes.get(tracked.changedGroupId) : undefined;
  const initialChanged = tracked?.changedGroupId ? original.get(tracked.changedGroupId) : undefined;
  const inChanged = normal(initialChanged) && contains(groupSyncRectangle(initialChanged)!, rect);
  const clearTracking = () => { if (tracked) nodes.set(id, withOperonGroupTracking(data, null)!); };
  if (activeRule?.field.type === 'list' || !activeRule && !inChanged) { clearTracking(); continue; }
  if (tracked?.groupId && !activeRule && !input.manual?.has(id)) { clearTracking(); continue; }
  const field = activeRule?.field ?? fields.find(field => field.key === tracked?.propertyKey && field.type === 'text');
  if (!field || field.type !== 'text') continue;
  const task = input.resolve(ref.taskId); if (task.state !== 'ready') continue;
  const raw = task.fieldValues[field.key] ?? '';
  const skeleton = '{{' + field.key + ':: }}';
  const title = raw.trim() ? replaceGroupEditSlot(skeleton, skeleton.length - 2, [raw], input.settings, input.validation)?.title : undefined;
  const destinationRule = title ? parseOperonGroupRule(title, input.settings, input.validation) : null;
  const value = destinationRule?.state === 'valid' ? destinationRule.rule.values[0].value : raw.trim();
  const context = JSON.stringify([groupId, activeRule ? ruleIdentity(parsed!) : tracked?.changedGroupId, field.key]);
  const manual = input.manual?.has(id) ?? false;
  if (!manual && tracked?.suppressedValue === value && tracked.suppressedRule === context) continue;
  const evaluation = activeRule ? evaluateOperonGroup(input.settings, activeRule, task, input.validation) : null;
  if (evaluation?.state === 'unavailable') continue;
  if (evaluation?.state === 'ready' && evaluation.matches || !activeRule && tracked?.observedValue === value) {
   // Lazy enrollment: merely opening an already-matching legacy Canvas writes nothing.
   if (tracked && (manual || tracked.propertyKey !== field.key || tracked.observedValue !== value)) {
    const tracking: OperonGroupTracking = { ...tracked, version: 1, propertyKey: field.key, observedValue: value };
    delete tracking.suppressedValue; delete tracking.suppressedRule;
    if (groupId) tracking.groupId = groupId; else delete tracking.groupId;
    if (!inChanged) delete tracking.changedGroupId;
    nodes.set(id, withOperonGroupTracking(data, tracking)!);
   }
   continue;
  }
  let changed = normal(oldChanged) ? oldChanged : groups().find(group => normal(group) && label(group).trim() === 'Changed');
  if (changed && input.editing?.has(String(changed.id))) continue;
  if (!changed) {
   const rectangles = [...nodes.values()].map(groupSyncRectangle).filter((item): item is GroupRectangle => !!item);
   changed = create('Changed', Math.max(0, ...rectangles.map(item => item.x + item.width)) + 80, Math.min(0, ...rectangles.map(item => item.y)), Math.max(400, rect.width + 96), 300);
  }
  let destination = changed;
  const exclusions = (parent: NodeData) => new Set([id, String(parent.id), String(changed.id), ...groups().filter(g => encloses(groupSyncRectangle(g)!, groupSyncRectangle(parent)!)).map(g => String(g.id))]);
  if (title && destinationRule?.state === 'valid') {
   const identity = ruleIdentity(destinationRule);
   const existing = groups().find(group => {
    if (group.id === changed.id || input.editing?.has(String(group.id)) || !encloses(groupSyncRectangle(changed)!, groupSyncRectangle(group)!) || ruleIdentity(rule(group)) !== identity) return false;
    const before = groupSyncRectangle(group)!, slot = place(group, rect, exclusions(group));
    const after = { ...before, width: Math.max(before.width, slot.x + slot.width + 24 - before.x), height: Math.max(before.height, slot.y + slot.height + 24 - before.y) };
    // Enlarging a rule group must not recruit unrelated cards that were outside it.
    return ![...nodes.values()].some(node => { const other = groupSyncRectangle(node); return node.type !== 'group' && !!other && other.id !== id && !contains(before, other) && contains(after, other); });
   });
   if (existing) destination = existing;
   else {
    const size = { id: '', x: 0, y: 0, width: Math.max(352, rect.width + 48), height: Math.max(160, rect.height + HEADER_SPACE + 24) };
    const position = place(changed, size, new Set([String(changed.id), id, ...groups().filter(g => encloses(groupSyncRectangle(g)!, groupSyncRectangle(changed)!)).map(g => String(g.id))]));
    destination = create(title, position.x, position.y, size.width, size.height);
    grow(changed, groupSyncRectangle(destination)!);
   }
  } else if (value) plan.unavailable.push(id);
  const position = place(destination, rect, exclusions(destination));
  grow(destination, position); if (destination !== changed) grow(changed, groupSyncRectangle(destination)!);
  const tracking: OperonGroupTracking = { ...(tracked ?? {}), version: 1, propertyKey: field.key, changedGroupId: String(changed.id), observedValue: value };
  if (destination !== changed) tracking.groupId = String(destination.id); else delete tracking.groupId;
  delete tracking.suppressedValue; delete tracking.suppressedRule;
  nodes.set(id, withOperonGroupTracking({ ...data, x: position.x, y: position.y }, tracking)!);
  plan.moves.push({ id, value, context, previousGroupId: groupId ?? undefined, tracking });
 }
 for (const [id, before] of original) {
  const after = nodes.get(id)!;
  if (JSON.stringify(before) !== JSON.stringify(after)) plan.patches.push({ before, after });
 }
 return plan;
}
