import { TFile, type App } from 'obsidian';
import { repairCanvasTaskReferences } from '../core/task-id-repair-embeds';
import type { TaskIdReferenceRepair } from '../core/task-id-repair-references';
import type { TaskIdRepairSource } from '../core/task-id-repair-sources';
import type { TaskIdRepairOpenSources } from './task-id-repair-markdown';
import type { TaskIdRepairResource } from './task-id-repair-transaction';

/** Caller supplies every Canvas source and keeps open Canvas state in the same transaction. */
export function createTaskIdRepairCanvasResources(
    app: App,
    sources: readonly TaskIdRepairSource[],
    repair: TaskIdReferenceRepair,
    openSources: TaskIdRepairOpenSources,
    canWritePath: (path: string) => Promise<boolean>,
): { resources: TaskIdRepairResource[]; inventoryMatches(): Promise<boolean> } {
    const paths = new Set(sources.map(source => source.filePath));
    if (paths.size !== sources.length) throw new Error('Duplicate Canvas source in task ID repair.');
    const resolve = (path: string) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== 'canvas' || file.path !== path) {
            throw new Error('Task ID repair Canvas source is missing.');
        }
        return file;
    };
    const resources = sources.map(source => {
        resolve(source.filePath);
        const after = repairCanvasTaskReferences(source.content, repair);
        return {
            key: `canvas:${source.filePath}`,
            before: source.content,
            after,
            read: async () => {
                const content = await app.vault.read(resolve(source.filePath));
                if (!openSources.matches(source.filePath, content)) {
                    throw new Error('Task ID repair Canvas has unsaved changes.');
                }
                return content;
            },
            compareAndSet: async (expected: string, next: string) => {
                if (!((expected === source.content && next === after)
                    || (expected === after && next === source.content))) return false;
                if (!await canWritePath(source.filePath)) return false;
                const file = resolve(source.filePath);
                await app.vault.process(file, current => {
                    if (current !== expected || !openSources.matches(source.filePath, expected)) {
                        throw new Error('Task ID repair Canvas changed before write.');
                    }
                    return next;
                });
                if (!openSources.synchronize(source.filePath, expected, next)) {
                    throw new Error('Task ID repair Canvas changed during write.');
                }
                return true;
            },
        };
    });
    return {
        resources,
        inventoryMatches: () => {
            const files = app.vault.getFiles().filter(file => file.extension === 'canvas');
            return Promise.resolve(files.length === paths.size && files.every(file => paths.has(file.path)));
        },
    };
}
