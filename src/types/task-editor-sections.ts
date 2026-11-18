import { vaultPropertyIconKey } from '../core/task-icon-value';

/** Stable identities are independent of user-facing section names. */
export const TASK_EDITOR_SECTION_IDS = [
 'description', 'notes', 'stats', 'commands', 'overview', 'planning',
 'activity', 'connections', 'additional', 'sessions',
] as const;

export type BuiltinTaskEditorSectionId = typeof TASK_EDITOR_SECTION_IDS[number];
export type TaskEditorSectionId = BuiltinTaskEditorSectionId | `custom:${string}`;
export type TaskEditorPropertyRef = { kind: 'mapped'; key: string } | { kind: 'vault'; name: string };

export const TASK_EDITOR_DEFAULT_PROPERTY_GROUPS = {
 overview: ['taskType', 'taskIcon', 'taskColor', 'status', 'priority', 'taskImage', 'taskGallery'],
 planning: ['dateStarted', 'dateDue', 'repeat', 'reminderDatetimes', 'reminderRules'],
 activity: ['assignees', 'location', 'dateScheduled', 'datetimeStart', 'estimate', 'datetimeEnd', 'dateCompleted', 'dateCancelled'],
 connections: ['contexts', 'tags', 'links', 'parentTask', 'subtasks', 'blockedBy', 'blocking'],
} as const;

export const TASK_EDITOR_COMMAND_IDS = ['tracker', 'scrollbars', 'pin', 'checkboxes', 'subtask', 'inlineSubtask', 'remove'] as const;
export type TaskEditorCommandId = typeof TASK_EDITOR_COMMAND_IDS[number];

export interface TaskEditorSection {
 id: TaskEditorSectionId;
 name: string;
 enabled?: boolean;
 properties?: TaskEditorPropertyRef[];
 commandOrder?: TaskEditorCommandId[];
 /** Keep the identity of a removed default group so legacy fallback cannot restore it. */
 removed?: true;
}

export function isTaskEditorSectionRemovable(id: TaskEditorSectionId): boolean {
 return id.startsWith('custom:') || Object.keys(TASK_EDITOR_DEFAULT_PROPERTY_GROUPS).includes(id);
}

export function isTaskEditorPropertySection(id: TaskEditorSectionId): boolean {
 return id === 'additional' || isTaskEditorSectionRemovable(id);
}

export function defaultTaskEditorProperties(id: TaskEditorSectionId): TaskEditorPropertyRef[] {
 const fields = TASK_EDITOR_DEFAULT_PROPERTY_GROUPS[id as keyof typeof TASK_EDITOR_DEFAULT_PROPERTY_GROUPS];
 return (fields ?? []).map(key => ({ kind: 'mapped', key }));
}

export function taskEditorPropertyIdentity(ref: TaskEditorPropertyRef): string {
 return ref.kind === 'mapped' ? `mapped:${ref.key}` : `vault:${vaultPropertyIconKey(ref.name)}`;
}

function normalizeTaskEditorProperties(input: unknown[]): TaskEditorPropertyRef[] {
 const result: TaskEditorPropertyRef[] = [];
 const seen = new Set<string>();
 for (const item of input) {
  if (!item || typeof item !== 'object') continue;
  const { kind, key, name } = item as Record<string, unknown>;
  let ref: TaskEditorPropertyRef | null = null;
  if (kind === 'mapped' && typeof key === 'string' && key.trim() && key.trim() !== 'note') ref = { kind, key: key.trim() };
  else if (kind === 'vault' && typeof name === 'string' && name.trim()) ref = { kind, name: name.trim() };
  if (!ref) continue;
  const identity = taskEditorPropertyIdentity(ref);
  if (seen.has(identity)) continue;
  seen.add(identity);
  result.push(ref);
 }
 return result;
}

function normalizeTaskEditorCommandOrder(input: unknown[]): TaskEditorCommandId[] {
 const valid = input.filter((id): id is TaskEditorCommandId => TASK_EDITOR_COMMAND_IDS.some(command => command === id));
 return [...new Set([...valid, ...TASK_EDITOR_COMMAND_IDS])];
}

export function normalizeTaskEditorSections(value: unknown): TaskEditorSection[] {
 const result: TaskEditorSection[] = [];
 const seen = new Set<string>();
 for (const item of Array.isArray(value) ? value : []) {
  if (!item || typeof item !== 'object') continue;
  const { id, name, enabled, properties, commandOrder, removed } = item as Record<string, unknown>;
  if (typeof id !== 'string' || seen.has(id) || !TASK_EDITOR_SECTION_IDS.some(key => key === id) && !/^custom:[a-z0-9-]{1,64}$/u.test(id)) continue;
  seen.add(id);
  const key = id as TaskEditorSectionId;
  if (removed === true && isTaskEditorSectionRemovable(key)) {
   if (!key.startsWith('custom:')) result.push({ id: key, name: '', removed: true });
   continue;
  }
  const row: TaskEditorSection = {
   id: key, name: typeof name === 'string' ? name.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 80) : '',
   ...(key !== 'description' && enabled === false ? { enabled: false } : {}),
  };
  if (isTaskEditorPropertySection(key) && Array.isArray(properties)) row.properties = normalizeTaskEditorProperties(properties);
  if (key === 'commands' && Array.isArray(commandOrder)) row.commandOrder = normalizeTaskEditorCommandOrder(commandOrder);
  result.push(row);
 }
 for (const id of TASK_EDITOR_SECTION_IDS) if (!seen.has(id)) result.push({ id, name: '' });
 return result;
}
