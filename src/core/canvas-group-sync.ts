import { readCanvasTaskReference } from '../ui/canvas-task-node';
import { replaceGroupEditSlot } from './canvas-group-edit';
import { evaluateOperonGroup, operonGroupFields, parseOperonGroupRule, smallestOperonGroupAtCenter, type GroupRectangle, type GroupRuleResult, type GroupSettings, type GroupTaskState, type GroupValidation } from './canvas-group-rule';
import { readOperonGroupTracking, withOperonGroupTracking, type OperonGroupTracking } from './canvas-group-tracking';
import { findGroupPlacement, groupContains as contains, groupEncloses as encloses, GROUP_HEADER_SPACE, type GroupPlacement } from './canvas-group-layout';

type NodeData = Record<string, unknown>;
const MISMATCHES = 'Group Mismatches';
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
 const mismatchIds = new Set(groups().filter(g => normal(g) && label(g).trim() === MISMATCHES).map(g => String(g.id)));
 for (const data of nodes.values()) {
  const tracking = readOperonGroupTracking(data);
  const parent = tracking.state === 'ready' && tracking.value.changedGroupId ? nodes.get(tracking.value.changedGroupId) : undefined;
  if (!normal(parent)) continue;
  mismatchIds.add(String(parent.id));
 }
 let serial = 0;
 const create = (label: string, x: number, y: number, width: number, height: number) => {
  let id: string; do { id = 'operon-changed-draft-' + ++serial; } while (nodes.has(id));
  const node = { id, type: 'group', label, x, y, width, height };
  nodes.set(id, node); plan.groups.push(node); return node;
 };
 const rectangles = () => [...nodes.values()].map(groupSyncRectangle).filter((r): r is GroupRectangle => !!r);
 const place = (parent: NodeData, card: GroupRectangle, outer?: NodeData) => {
  const result = findGroupPlacement(groupSyncRectangle(parent)!, card, rectangles(), new Set(groups().map(g => String(g.id))), outer ? groupSyncRectangle(outer)! : undefined);
  if (result && rule(parent).state === 'valid') {
   const target = smallestOperonGroupAtCenter(result.card, groups().map(g => ({
    ...(g.id === parent.id ? result.parent : g.id === outer?.id && result.outer ? result.outer : groupSyncRectangle(g)!), rule: rule(g),
   })));
   if (target !== parent.id) return null;
  }
  return result;
 };
 const resize = (node: NodeData, rect: GroupRectangle) => { node.x = rect.x; node.y = rect.y; node.width = rect.width; node.height = rect.height; };
 const editable = (node: NodeData) => !input.editing?.has(String(node.id)) && !groups().some(g => input.editing?.has(String(g.id)) && encloses(groupSyncRectangle(g)!, groupSyncRectangle(node)!));
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
  const initialChanged = (tracked?.changedGroupId ? original.get(tracked.changedGroupId) : undefined)
   ?? sourceGroups.find(g => mismatchIds.has(String(g.id)) && contains(groupSyncRectangle(g)!, rect));
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
  if (normal(oldChanged) && label(oldChanged).trim() === 'Changed' && !input.editing?.has(String(oldChanged.id))) oldChanged.label = MISMATCHES;
  const evaluation = activeRule ? evaluateOperonGroup(input.settings, activeRule, task, input.validation) : null;
  if (evaluation?.state === 'unavailable') continue;
  const matches = evaluation?.state === 'ready' && evaluation.matches || !activeRule && tracked?.observedValue === value;
  const keepTracking = () => {
   // Lazy enrollment: merely opening an already-matching legacy Canvas writes nothing.
   if (tracked && (manual || tracked.propertyKey !== field.key || tracked.observedValue !== value)) {
    const tracking: OperonGroupTracking = { ...tracked, version: 1, propertyKey: field.key, observedValue: value };
    delete tracking.suppressedValue; delete tracking.suppressedRule;
    if (groupId) tracking.groupId = groupId; else delete tracking.groupId;
    if (!inChanged) delete tracking.changedGroupId;
    nodes.set(id, withOperonGroupTracking(data, tracking)!);
   }
  };
  if (matches && !inChanged) { keepTracking(); continue; }
  const identity = destinationRule?.state === 'valid' ? ruleIdentity(destinationRule) : '';
  const mismatchGroups = groups().filter(g => mismatchIds.has(String(g.id)));
  let destination: NodeData | undefined, changed: NodeData | undefined, placement: GroupPlacement | null = null;
  if (identity) for (const candidate of groups()) {
   if (!editable(candidate) || ruleIdentity(rule(candidate)) !== identity || mismatchGroups.some(g => g.id === candidate.id || contains(groupSyncRectangle(g)!, groupSyncRectangle(candidate)!))) continue;
   placement = place(candidate, rect);
   if (placement) { destination = candidate; break; }
  }
  if (!destination && matches) { keepTracking(); continue; }
  if (!destination) {
   const roots = [...mismatchGroups].sort((a, b) => Number(b.id === oldChanged?.id) - Number(a.id === oldChanged?.id));
   for (const root of roots) {
    if (!editable(root)) continue;
    if (identity) {
     for (const candidate of groups()) {
      if (candidate.id === root.id || !editable(candidate) || !encloses(groupSyncRectangle(root)!, groupSyncRectangle(candidate)!) || ruleIdentity(rule(candidate)) !== identity) continue;
      placement = place(candidate, rect, root);
      if (placement) { destination = candidate; changed = root; break; }
     }
     if (!destination) {
      const size = { ...rect, width: Math.max(352, rect.width + 48), height: Math.max(160, rect.height + GROUP_HEADER_SPACE + 24) };
      const slot = place(root, size);
      if (slot) {
       resize(root, slot.parent);
       destination = create(title!, slot.card.x, slot.card.y, size.width, size.height); changed = root;
       placement = { card: { ...rect, x: slot.card.x + 24, y: slot.card.y + GROUP_HEADER_SPACE }, parent: groupSyncRectangle(destination)! };
      }
     }
    } else {
     placement = place(root, rect);
     if (placement) { destination = root; changed = root; }
    }
    if (destination) break;
   }
   if (!destination) {
    const all = rectangles(), x = Math.max(0, ...all.map(r => r.x + r.width)) + 80, y = Math.min(0, ...all.map(r => r.y));
    changed = create(MISMATCHES, x, y, Math.max(400, rect.width + 96), Math.max(300, rect.height + GROUP_HEADER_SPACE * (identity ? 2 : 1) + (identity ? 48 : 24)));
    mismatchIds.add(String(changed.id)); destination = changed;
    if (identity) destination = create(title!, x + 24, y + GROUP_HEADER_SPACE, Math.max(352, rect.width + 48), Math.max(160, rect.height + GROUP_HEADER_SPACE + 24));
    const target = groupSyncRectangle(destination)!;
    placement = { card: { ...rect, x: target.x + 24, y: target.y + GROUP_HEADER_SPACE }, parent: target };
   }
  }
  if (!identity && value) plan.unavailable.push(id);
  resize(destination, placement!.parent);
  if (changed && placement!.outer) resize(changed, placement!.outer);
  const position = placement!.card;
  const tracking: OperonGroupTracking = { ...(tracked ?? {}), version: 1, propertyKey: field.key, observedValue: value };
  if (changed) tracking.changedGroupId = String(changed.id); else delete tracking.changedGroupId;
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
