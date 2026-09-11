/** Plugin UI conversion steps use exact state checks and never retry an uncertain write. */
export interface PluginUiConversionStep {
    isBefore(): Promise<boolean>;
    isAfter(): Promise<boolean>;
    apply(): Promise<boolean>;
    rollback(): Promise<boolean>;
    irreversible?: boolean;
}

export async function executePluginUiConversionTransaction(
    steps: readonly PluginUiConversionStep[],
    canCommit: () => boolean,
): Promise<'committed' | 'rolled-back' | 'outcome-unknown'> {
    if (steps.some((step, index) => step.irreversible && index !== steps.length - 1)) return 'rolled-back';
    try {
        for (const step of steps) if (!await step.isBefore()) return 'rolled-back';
    } catch { return 'rolled-back'; }
    const committed: PluginUiConversionStep[] = [];
    const rollback = async (): Promise<'rolled-back' | 'outcome-unknown'> => {
        for (const step of [...committed].reverse()) {
            try {
                if (step.irreversible || !await step.isAfter() || !await step.rollback() || !await step.isBefore()) {
                    return 'outcome-unknown';
                }
            } catch { return 'outcome-unknown'; }
        }
        return 'rolled-back';
    };
    for (const step of steps) {
        try {
            if (!canCommit() || !await step.isBefore()) return await rollback();
            if (step.irreversible) {
                for (const previous of committed) if (!await previous.isAfter()) return await rollback();
            }
            if (!canCommit()) return await rollback();
        } catch { return await rollback(); }
        let applied: boolean;
        try { applied = await step.apply(); }
        catch {
            // A failed acknowledgement may follow a successful write. Inspect without replaying it.
            try {
                if (await step.isAfter()) applied = true;
                else if (await step.isBefore()) return await rollback();
                else return 'outcome-unknown';
            } catch { return 'outcome-unknown'; }
        }
        if (!applied) return await rollback();
        committed.push(step);
    }
    try {
        for (const step of committed) if (!await step.isAfter()) return 'outcome-unknown';
    } catch { return 'outcome-unknown'; }
    return 'committed';
}
