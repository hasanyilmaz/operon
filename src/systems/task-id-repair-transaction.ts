import { executePluginUiConversionTransaction, type PluginUiConversionStep } from './plugin-ui-conversion-transaction';

/** Adapters must serialize the comparison and write in their owning store/queue. */
export interface TaskIdRepairResource {
    key: string;
    before: string;
    after: string;
    read(): Promise<string>;
    compareAndSet(expected: string, next: string): Promise<boolean>;
}

/** Includes unchanged dependencies; the inventory check detects new or removed sources. */
export async function executeTaskIdRepairTransaction(
    resources: readonly TaskIdRepairResource[],
    inventoryMatches: () => Promise<boolean>,
    canCommit: () => boolean,
): Promise<'committed' | 'rolled-back' | 'outcome-unknown'> {
    if (new Set(resources.map(resource => resource.key)).size !== resources.length) return 'rolled-back';
    const expected = new Map(resources.map(resource => [resource.key, resource.before]));
    const readSetMatches = async () => {
        if (!canCommit() || !await inventoryMatches()) return false;
        for (const resource of resources) {
            if (await resource.read() !== expected.get(resource.key)) return false;
        }
        return canCommit();
    };
    const steps: PluginUiConversionStep[] = resources
        .filter(resource => resource.before !== resource.after)
        .map(resource => ({
            isBefore: async () => await resource.read() === resource.before,
            isAfter: async () => {
                const matches = await resource.read() === resource.after;
                if (matches) expected.set(resource.key, resource.after);
                return matches;
            },
            apply: async () => {
                if (!await readSetMatches()) return false;
                // Throw on uncertain acknowledgement so the shared executor observes the
                // resource before deciding whether this step must be rolled back.
                if (!await resource.compareAndSet(resource.before, resource.after)) {
                    throw new Error('Task ID repair write was not acknowledged.');
                }
                if (await resource.read() !== resource.after) {
                    throw new Error('Task ID repair write could not be verified.');
                }
                expected.set(resource.key, resource.after);
                return true;
            },
            rollback: () => resource.compareAndSet(resource.after, resource.before),
        }));
    try {
        if (!await readSetMatches()) return 'rolled-back';
    } catch { return 'rolled-back'; }
    try {
        const outcome = await executePluginUiConversionTransaction(steps, canCommit);
        if (outcome !== 'committed') return outcome;
        // Recheck unchanged dependencies as well as written resources before success.
        return await readSetMatches() ? 'committed' : 'outcome-unknown';
    } catch {
        // The shared executor owns write acknowledgement and rollback. An exception
        // here comes from a read/inventory check, never permission to replay writes.
        return 'outcome-unknown';
    }
}
