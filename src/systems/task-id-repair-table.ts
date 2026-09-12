import { TFile, type App } from 'obsidian';
import { parseOperonTableFile, isOperonTableFilePath, getOperonTableFilePathKey } from '../storage/table-file';
import type { TaskIdReferenceRepair } from '../core/task-id-repair-references';
import type { TaskIdRepairSource } from '../core/task-id-repair-sources';
import type { TaskIdRepairOpenSources } from './task-id-repair-markdown';
import type { TaskIdRepairResource } from './task-id-repair-transaction';
import type { TablePreset } from '../types/table';

/** Preserve the source version and optional fields; ID repair is not a table migration. */
export function repairTableTaskReferences(content: string, repair: TaskIdReferenceRepair): string {
    const parsed = parseOperonTableFile(content);
    if (parsed.status !== 'valid') throw new Error('Invalid Table source prevents task ID repair.');
    const next = repair.table(parsed.preset);
    const raw = JSON.parse(content) as TablePreset;
    let changed = false;
    if (JSON.stringify(next.expandedTaskTreeIds) !== JSON.stringify(parsed.preset.expandedTaskTreeIds)) {
        raw.expandedTaskTreeIds = next.expandedTaskTreeIds;
        changed = true;
    }
    if (next.search.parent?.parentId !== parsed.preset.search.parent?.parentId && next.search.parent && raw.search.parent) {
        raw.search.parent.parentId = next.search.parent.parentId;
        changed = true;
    }
    if (!changed) return content;
    const indent = /\n([\t ]+)"/u.exec(content)?.[1] ?? '  ';
    const result = JSON.stringify(raw, null, indent) + (content.endsWith('\n') ? '\n' : '');
    if (parseOperonTableFile(result).status !== 'valid') throw new Error('Invalid repaired Table source.');
    return result;
}

export function createTaskIdRepairTableResources(
    app: App,
    sources: readonly TaskIdRepairSource[],
    repair: TaskIdReferenceRepair,
    openSources: TaskIdRepairOpenSources,
    canWritePath: (path: string) => Promise<boolean>,
): { resources: TaskIdRepairResource[]; inventoryMatches(): Promise<boolean> } {
    const paths = new Set(sources.map(source => getOperonTableFilePathKey(source.filePath)));
    if (paths.size !== sources.length) throw new Error('Duplicate Table source in task ID repair.');
    const resolve = (path: string) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.path !== path || !isOperonTableFilePath(path)) throw new Error('Table source is missing.');
        return file;
    };
    const resources = sources.map(source => {
        resolve(source.filePath);
        const after = repairTableTaskReferences(source.content, repair);
        return {
            key: `table:${source.filePath}`, before: source.content, after,
            read: async () => {
                const content = await app.vault.read(resolve(source.filePath));
                if (!openSources.matches(source.filePath, content)) throw new Error('Table has pending view changes.');
                return content;
            },
            compareAndSet: async (expected: string, next: string) => {
                if (!((expected === source.content && next === after) || (expected === after && next === source.content))) return false;
                if (!await canWritePath(source.filePath)) return false;
                await app.vault.process(resolve(source.filePath), current => {
                    if (current !== expected || !openSources.matches(source.filePath, expected)) throw new Error('Table changed before task ID repair.');
                    return next;
                });
                if (!openSources.synchronize(source.filePath, expected, next)) throw new Error('Table changed during task ID repair.');
                return true;
            },
        };
    });
    return { resources, inventoryMatches: () => {
        const files = app.vault.getFiles().filter(file => isOperonTableFilePath(file.path));
        return Promise.resolve(files.length === paths.size && files.every(file => paths.has(getOperonTableFilePathKey(file.path))));
    } };
}
