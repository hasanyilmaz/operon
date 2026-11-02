import { TFile, type App } from 'obsidian';
import { scanFileWithMappings } from '../../src/indexer/file-scanner';
import { getNativePropertyIndex } from '../../src/indexer/native-property-index';
import { DEFAULT_SETTINGS, migrateSettings } from '../../src/types/settings';
import type { IndexedTask } from '../../src/types/fields';
const task = (id:string,fieldValues:Record<string,string>):IndexedTask => ({operonId:id,description:id,fieldValues,tags:[],checkbox:'open',tier:'hot',datetimeModified:'',primary:{filePath:id+'.md',format:'inline',lineNumber:0}});
export async function nativeFixture() {
 const s = migrateSettings(structuredClone(DEFAULT_SETTINGS)); s.keyMappings = s.keyMappings.map(m => ({ ...m, visiblePropertyName: m.canonicalKey }));
 const contents = new Map([
  ['File.md', '---\noperonId: file001\nEffort: 0\nFlag: false\nItems: ["a; b", 0, "0"]\n---\n'],
  ['Inline.md', '---\nEffort: 99\n---\n- [ ] First {{operonId:: line001}} {{Effort:: 5}} {{Flag:: false}}\n- [ ] Second {{operonId:: line002}} {{Effort:: 20}}\n'],
 ]);
 const files = new Map([...contents.keys()].map(path => { const f = new TFile(...([path] as unknown as [])); Object.assign(f, { path, basename: path.slice(0,-3), extension: 'md', stat: { mtime: 1, ctime: 1, size: 1 } }); return [path,f]; }));
 let reads = 0;
 const app = { vault: { configDir: '.obsidian', getAbstractFileByPath: (p: string) => files.get(p), getMarkdownFiles: () => [...files.values()],
 read: async (f: TFile) => { reads++; return contents.get(f.path)!; } }, metadataCache: { getFileCache: () => ({}) } } as unknown as App;
 const native = getNativePropertyIndex(app); native.configure(s); native.setTypes({ Effort: 'number', Flag: 'checkbox', Items: 'multitext', Missing: 'text' });
 const tasks: IndexedTask[] = [];
 for (const [path, file] of files) {
  const scan = await scanFileWithMappings(app, file, s.keyMappings);
  native.accept(path, scan.nativeProperties);
  if (scan.yamlTask) tasks.push({ ...task(scan.yamlTask.operonId, scan.yamlTask.fieldValues), primary: { filePath:path, format:'yaml', lineNumber:0 } });
  for (const parsed of scan.inlineTasks) tasks.push({ ...task(parsed.operonId!, parsed.fields.reduce((a,f) => ({ ...a, [f.key]: f.value }), {})),
   primary: { filePath: path, format: 'inline', lineNumber: parsed.lineNumber } });
 }
 native.reconcile(tasks, new Set());
 return { app, s, native, tasks, reads: () => reads };
}
