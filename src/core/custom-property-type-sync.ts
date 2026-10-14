import type { App } from 'obsidian';
import type { KeyMapping } from '../types/settings';
import { isManagedCustomFieldMapping } from './managed-task-fields';
import { loadPropertyTypeRegistry, type ObsidianPropertyTypeId } from './property-type-registry';

type Result = { status: 'updated' | 'unchanged'; types: Record<string, ObsidianPropertyTypeId> }
 | { status: 'conflict' | 'cancelled' }
 | { status: 'failed'; restartRequired?: boolean };
interface TypeManager {
 getAssignedWidget(name: string): string | null;
 setType(name: string, type: string): Promise<void>;
}
const queues = new WeakMap<App, Promise<unknown>>();
const uncertain = new WeakSet<App>();

/** Explicit Settings action only. Use Obsidian's writer so its in-memory registry stays coherent. */
export function syncCustomPropertyType(app: App, mapping: KeyMapping, isCurrent: () => boolean): Promise<Result> {
 const snapshot = { ...mapping };
 const operation = async (): Promise<Result> => {
  let writeStarted = false;
  try {
   if (uncertain.has(app)) return { status: 'failed', restartRequired: true };
   if (!isCurrent()) return { status: 'cancelled' };
   if (!isManagedCustomFieldMapping(snapshot)) return { status: 'failed' };
   const name = snapshot.visiblePropertyName.trim() || snapshot.canonicalKey;
   const expected = snapshot.type === 'list' ? 'multitext' : snapshot.type;
   const manager = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager;
   if (!manager || typeof manager.getAssignedWidget !== 'function' || typeof manager.setType !== 'function') return { status: 'failed' };
   const aliases = new Set([name, snapshot.canonicalKey].map(alias => alias.toLowerCase()));
   const types = await loadPropertyTypeRegistry(app);
   if (!isCurrent()) return { status: 'cancelled' };
   for (const [alias, type] of Object.entries(types)) {
    if (aliases.has(alias.toLowerCase()) && type !== expected) return { status: 'conflict' };
   }
   for (const alias of aliases) {
    const assigned = manager.getAssignedWidget(alias);
    if (assigned != null && assigned !== expected) return { status: 'conflict' };
   }
   if (Object.entries(types).some(([alias, type]) => manager.getAssignedWidget(alias) !== type)) return { status: 'failed' };
   const entries = Object.entries(types).filter(([alias]) => alias.toLowerCase() === name.toLowerCase());
   if (entries.length > 1) return { status: 'conflict' };
   const assigned = manager.getAssignedWidget(name);
   if (entries.length && assigned === expected) return { status: 'unchanged', types };
   // A stale/uncertain manager must not overwrite a newer on-disk registry.
   if (entries.length || assigned != null) return { status: 'failed' };
   writeStarted = true;
   await manager.setType(name, expected);
   const verified = await loadPropertyTypeRegistry(app);
   if (manager.getAssignedWidget(name) !== expected
    || !Object.entries(verified).some(([alias, type]) => alias.toLowerCase() === name.toLowerCase() && type === expected)) { uncertain.add(app); return { status: 'failed', restartRequired: true }; }
   return { status: 'updated', types: verified };
  } catch {
   // A later native save could flush an earlier uncertain in-memory assignment.
   if (writeStarted) uncertain.add(app);
   // Do not replay or roll back an uncertain native write over later user edits.
   return { status: 'failed', restartRequired: writeStarted };
  }
 };
 const pending = (queues.get(app) ?? Promise.resolve()).then(operation, operation);
 queues.set(app, pending);
 void pending.finally(() => { if (queues.get(app) === pending) queues.delete(app); });
 return pending;
}
