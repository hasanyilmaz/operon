import type { App } from 'obsidian';
import type { TaskWriter } from '../core/task-writer';
import type { KeyMapping } from '../types/settings';
import { isOperonTableFilePath } from '../storage/table-file';
import { planTaskIdRepairSources, type TaskIdRepairTarget, type TaskIdRepairSource } from '../core/task-id-repair-sources';
import { TaskIdReferenceRepair } from '../core/task-id-repair-references';
import { createTaskIdRepairMarkdownResources, type TaskIdRepairOpenSources } from './task-id-repair-markdown';
import { createTaskIdRepairCanvasResources } from './task-id-repair-canvas';
import { createTaskIdRepairTableResources } from './task-id-repair-table';
import { executeTaskIdRepairTransaction } from './task-id-repair-transaction';

type RepairOutcome = Awaited<ReturnType<typeof executeTaskIdRepairTransaction>>;

export interface TaskIdRepairCoordinatorOptions {
    app: App;
    writer: Pick<TaskWriter, 'runExclusiveTaskMutation' | 'applyExactMarkdownSourceMutation'>;
    target: TaskIdRepairTarget;
    nextId: string;
    modifiedAt: string;
    keyMappings: KeyMapping[];
    openMarkdown: TaskIdRepairOpenSources;
    openCanvas?: TaskIdRepairOpenSources;
    openTables: TaskIdRepairOpenSources;
    canWritePath(path: string): Promise<boolean>;
    canCommit(): boolean;
    /** Refresh source index and file-backed projections without waiting on held queues. */
    settle(changedPaths: readonly string[], nextId: string): Promise<void>;
}

/** Invoked only after explicit Regenerate ID; confirmation and Cancel live outside. */
export async function executeTaskIdRepair(options: TaskIdRepairCoordinatorOptions): Promise<RepairOutcome> {
    let transactionStarted = false;
    try {
    return await options.writer.runExclusiveTaskMutation(async permit => {
        if (!options.canCommit()) return 'rolled-back';
        const markdown: TaskIdRepairSource[] = [];
        const canvases: TaskIdRepairSource[] = [];
        const tables: TaskIdRepairSource[] = [];
        // Capture every potential owner/reference, not only index-visible valid IDs.
        for (const file of options.app.vault.getFiles()) {
            const collection = file.extension === 'md' ? markdown
                : file.extension === 'canvas' ? canvases
                : isOperonTableFilePath(file.path) ? tables : null;
            if (collection) collection.push({ filePath: file.path, content: await options.app.vault.read(file) });
        }
        const plan = planTaskIdRepairSources(markdown, options.target, options.nextId, options.modifiedAt, options.keyMappings);
        if (!plan.ok) throw new Error(plan.reason);
        const repair = new TaskIdReferenceRepair(plan.previousId, plan.nextId);
        const sources = createTaskIdRepairMarkdownResources(options.app, options.writer, permit, plan, options.openMarkdown);
        const canvas = createTaskIdRepairCanvasResources(options.app, canvases, repair, options.openCanvas ?? { matches: () => true, synchronize: () => true }, path => options.canWritePath(path));
        const table = createTaskIdRepairTableResources(options.app, tables, repair, options.openTables, path => options.canWritePath(path));
        const resources = [...sources.resources, ...canvas.resources, ...table.resources];
                const inventoryMatches = async () => await sources.inventoryMatches()
                    && await canvas.inventoryMatches() && await table.inventoryMatches();
                transactionStarted = true;
                const outcome = await executeTaskIdRepairTransaction(resources, inventoryMatches, () => options.canCommit());
                if (outcome === 'committed') {
                    try {
                        const changedPaths = [...sources.resources, ...canvas.resources, ...table.resources]
                            .filter(resource => resource.before !== resource.after)
                            .map(resource => resource.key.slice(resource.key.indexOf(':') + 1));
                        await options.settle(changedPaths, plan.nextId);
                    } catch {
                        // The durable transaction may already be committed. Never replay
                        // it or report success if the source index/projections are stale.
                        return 'outcome-unknown';
                    }
                }
                return outcome;
    });
    } catch (error) {
        // Index refresh can fail after durable writes succeeded.
        // Preserve uncertainty so the caller freezes stale follow-up mutations.
        if (transactionStarted) return 'outcome-unknown';
        throw error;
    }
}
