import type { OperonPluginDataAccess } from '../../src/storage/operon-data-package-store';

interface TestAdapter {
 exists(path: string): Promise<boolean>;
 read(path: string): Promise<string>;
 write(path: string, source: string): Promise<void>;
 process?: (path: string, update: (source: string) => string) => Promise<unknown>;
 writeExclusive?: (path: string, source: string) => Promise<void>;
}

/**
 * Older unit tests model their persisted disk as a PluginData variable. Expose
 * that same backing store through adapter reads and conditional writes. Their
 * save failure/gate hooks remain at the persistence boundary. This is not used
 * by the real-filesystem settings-preservation fault-injection suite.
 */
export function connectPluginDataAdapter<T extends OperonPluginDataAccess>(
 adapter: TestAdapter,
 data: T,
 canonical = '.obsidian/plugins/operon/data.json',
 readDisk: () => unknown | Promise<unknown> = () => data.loadData(),
): T {
 const exists = adapter.exists.bind(adapter);
 const read = adapter.read.bind(adapter);
 const process = adapter.process?.bind(adapter);
 const exclusive = adapter.writeExclusive?.bind(adapter);
 let queue: Promise<unknown> = Promise.resolve();
 adapter.exists = async path => path === canonical ? (await readDisk()) != null : exists(path);
 adapter.read = async path => {
  if (path !== canonical) return read(path);
  const value = await readDisk();
  if (value == null) throw new Error('Missing canonical test data');
  return JSON.stringify(value, null, '\t');
 };
 adapter.process = (path, update) => {
  if (path !== canonical) {
   if (process) return process(path, update);
   return adapter.read(path).then(async source => {
    const next = update(source);
    if (next !== source) await adapter.write(path, next);
    return next;
   });
  }
  const operation = queue.then(async () => {
   const source = await adapter.read(path);
   const next = update(source);
   if (source !== next) await data.saveData(JSON.parse(next) as unknown);
   return next;
  });
  queue = operation.catch(() => undefined);
  return operation;
 };
 adapter.writeExclusive = async (path, source) => {
  if (path !== canonical) {
   if (!exclusive) throw new Error('Unexpected noncanonical create in PluginData test');
   return exclusive(path, source);
  }
  const operation = queue.then(async () => {
   if (await adapter.exists(path)) throw new Error('Canonical test data already exists');
   await data.saveData(JSON.parse(source) as unknown);
  });
  queue = operation.catch(() => undefined);
  return operation;
 };
 return data;
}
