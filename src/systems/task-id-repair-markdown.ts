import { TFile, type App } from 'obsidian';
import type { TaskWriter, TaskWriterExclusiveMutationPermit } from '../core/task-writer';
import type { TaskIdRepairSourcesPlan } from '../core/task-id-repair-sources';
import type { TaskIdRepairResource } from './task-id-repair-transaction';

export interface TaskIdRepairOpenSources {
    matches(filePath: string, content: string): boolean;
    synchronize(filePath: string, before: string, after: string): boolean;
}

/** Build inside runExclusiveTaskMutation, retaining its permit through commit/rollback. */
export function createTaskIdRepairMarkdownResources(
    app: App,
    writer: Pick<TaskWriter, 'applyExactMarkdownSourceMutation'>,
    permit: TaskWriterExclusiveMutationPermit,
    plan: Extract<TaskIdRepairSourcesPlan, { ok: true }>,
    openSources: TaskIdRepairOpenSources,
): { resources: TaskIdRepairResource[]; inventoryMatches(): Promise<boolean> } {
    const sources = new Map(plan.readSet.map(source => [source.filePath, source.content]));
    const changes = new Map(plan.changes.map(change => [change.filePath, change]));
    if (sources.size !== plan.readSet.length || changes.size !== plan.changes.length
        || plan.changes.some(change => sources.get(change.filePath) !== change.before)) {
        throw new Error('Task ID repair source plan is inconsistent.');
    }
    const resources = plan.readSet.map(source => {
        const after = changes.get(source.filePath)?.after ?? source.content;
        return {
            key: `markdown:${source.filePath}`,
            before: source.content,
            after,
            read: async () => {
                const file = app.vault.getAbstractFileByPath(source.filePath);
                if (!(file instanceof TFile) || file.extension !== 'md') {
                    throw new Error('Task ID repair source is missing.');
                }
                const content = await app.vault.read(file);
                if (!openSources.matches(source.filePath, content)) {
                    throw new Error('Task ID repair source has unsaved editor changes.');
                }
                return content;
            },
            compareAndSet: async (expected: string, next: string) => {
                const forward = expected === source.content && next === after;
                const backward = expected === after && next === source.content;
                if (!forward && !backward) return false;
                const result = await writer.applyExactMarkdownSourceMutation(
                    source.filePath, expected, next,
                    () => openSources.matches(source.filePath, expected), permit, 'plugin',
                );
                if (result.outcome !== 'committed') return false;
                // A disk commit must not silently discard an editor change that arrived
                // during I/O. Throw so the transaction observes the uncertain state.
                if (!openSources.synchronize(source.filePath, expected, next)) {
                    throw new Error('Task ID repair source editor changed during commit.');
                }
                return true;
            },
        };
    });
    return {
        resources,
        inventoryMatches: () => {
            const files = app.vault.getMarkdownFiles();
            return Promise.resolve(files.length === sources.size
                && files.every(file => sources.has(file.path)));
        },
    };
}
