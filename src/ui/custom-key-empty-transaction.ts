import type { App, TFile } from 'obsidian';
import type { OperonSettings } from '../types/settings';

/** Supplied by the plugin inside its existing mapping/source mutation lease. */
export type CustomKeySourceWriter = (file: TFile, before: string, after: string, current: () => boolean) => Promise<void>;
export interface CustomKeySourceChange { file: TFile; path: string; before: string; after: string }

/** A verified preimage survives interruption. No startup migration or automatic replay. */
export async function backupCustomKeyReuse(app: App, settings: OperonSettings, types: unknown, changes: readonly CustomKeySourceChange[]) {
 const adapter = app.vault.adapter;
 const directory = `${app.vault.configDir}/plugins/operon/backups/inline-properties`;
 for (const path of [`${app.vault.configDir}/plugins/operon/backups`, directory]) {
  if (!await adapter.exists(path)) await adapter.mkdir(path);
 }
 const path = `${directory}/custom-key-reuse-${Date.now()}-${crypto.randomUUID()}.json`;
 const preimage = JSON.stringify({ version: 1, settings, types, files: changes.map(({path, before, after}) => ({path, before, after})) });
 if (await adapter.exists(path)) throw new Error('Custom property backup already exists');
 await adapter.write(path, preimage);
 if (await adapter.read(path) !== preimage) throw new Error('Custom property backup could not be verified');
 const record = async (status: string, unresolved: readonly string[] = []) => {
  const text = JSON.stringify({ backup: path, status, unresolved });
  await adapter.write(`${path}.result.json`, text);
  if (await adapter.read(`${path}.result.json`) !== text) throw new Error(`Custom property recovery record could not be verified: ${path}`);
 };
 await record('prepared');
 return { path, record };
}
