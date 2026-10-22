import { sha256HexForStorage } from '../storage/storage-sha256';
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

/** Serializes native type writes, including their related settings commit and rollback. */
export function withCustomPropertyTypeWriteLock<T>(app: App, operation: () => Promise<T>): Promise<T> {
 const pending = (queues.get(app) ?? Promise.resolve()).then(operation, operation);
 queues.set(app, pending);
 const cleanup = () => { if (queues.get(app) === pending) queues.delete(app); };
 void pending.then(cleanup, cleanup);
 return pending;
}

/** Caller holds the shared lock until settings settle. Only verified writes can be reversed. */
export async function replaceUnusedCustomPropertyTypes(app: App, expected: Record<string, ObsidianPropertyTypeId>, changes: readonly [string, ObsidianPropertyTypeId][], isCurrent: () => boolean): Promise<{ isCurrent(): boolean; rollback(): Promise<void> }> {
 if (uncertain.has(app)) throw new Error('Property type save could not be verified. Restart Obsidian before trying again.');
 const manager = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager;
 if (!manager || typeof manager.getAssignedWidget !== 'function' || typeof manager.setType !== 'function') throw new Error('Native property type writer is unavailable');
 let owned = { ...expected };
 const applied: Array<[string, ObsidianPropertyTypeId]> = [];
 const coherent = () => Object.entries(owned).every(([name, type]) => manager.getAssignedWidget(name) === type);
 const verify = async () => {
  const raw: unknown = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/types.json`));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || !('types' in raw)
   || JSON.stringify(raw.types) !== JSON.stringify(owned) || Object.values(owned).includes('unknown') || !coherent()) throw new Error('Property type owner changed');
 };
 const write = async (name: string, type: ObsidianPropertyTypeId) => {
  await verify();
  try {
   await manager.setType(name, type);
   owned = { ...owned, [name]: type };
   await verify();
  } catch (error) { uncertain.add(app); throw error; }
 };
 const rollback = async () => {
  if (uncertain.has(app)) return;
  // Source edits cancel admission, but do not transfer ownership of our native write.
  const latest = await loadPropertyTypeRegistry(app);
  if (applied.some(([name]) => latest[name] !== owned[name]) || Object.entries(latest).some(([name, type]) => manager.getAssignedWidget(name) !== type)) return;
  owned = latest;
  for (const [name, type] of [...applied].reverse()) await write(name, type);
  applied.length = 0;
 };
 try {
  await verify();
  for (const [name, type] of changes) {
   if (!isCurrent()) throw new Error('Property sources changed during verification');
   const previous = owned[name];
   if (!previous) throw new Error('Property type owner changed');
   await write(name, type);
   applied.push([name, previous]);
  }
  return { isCurrent: () => !uncertain.has(app) && coherent(), rollback };
 } catch (error) { await rollback(); throw error; }
}

/** Use Obsidian's writer so its in-memory registry stays coherent. */
export function syncCustomPropertyType(app: App, mapping: KeyMapping, isCurrent: () => boolean, backupDirectory?: string): Promise<Result> {
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
   const adapter = app.vault.adapter;
   const registryPath = `${app.vault.configDir}/types.json`;
   const readSource = async (): Promise<string | null> => await adapter.exists(registryPath) ? adapter.read(registryPath) : null;
   const source = backupDirectory ? await readSource() : null;
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
   if (backupDirectory) {
    // Only the current Obsidian registry shape is safe to round-trip through its writer.
    const parsed: unknown = source === null ? { types: {} } : JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
     || Object.keys(parsed).length !== 1 || !('types' in parsed)
     || JSON.stringify(parsed.types) !== JSON.stringify(types)
     || Object.values(types).includes('unknown')) return { status: 'failed' };
    const preimage = JSON.stringify({ version: 1, source });
    const backupPath = `${backupDirectory}/${await sha256HexForStorage(preimage)}.json`;
    for (const directory of [backupDirectory.slice(0, backupDirectory.lastIndexOf('/')), backupDirectory]) {
     if (!await adapter.exists(directory)) await adapter.mkdir(directory);
    }
    if (!await adapter.exists(backupPath)) await adapter.write(backupPath, preimage);
    if (await adapter.read(backupPath) !== preimage) return { status: 'failed' };
    // Recheck after backup IO; never overwrite a concurrent user assignment or stale mapping.
    if (!isCurrent()) return { status: 'cancelled' };
    if (await readSource() !== source
     || [...aliases].some(alias => { const value = manager.getAssignedWidget(alias); return value != null && value !== expected; })
     || manager.getAssignedWidget(name) != null
     || Object.entries(types).some(([alias, type]) => manager.getAssignedWidget(alias) !== type)) return { status: 'failed' };
    if (!isCurrent()) return { status: 'cancelled' };
   }
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
 return withCustomPropertyTypeWriteLock(app, operation);
}
