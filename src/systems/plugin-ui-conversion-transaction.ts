export type PluginUiConversionResult = {
    status: 'committed' | 'cancelled' | 'template-required' | 'not-applied' | 'rolled-back'
        | 'partial' | 'outcome-unknown' | 'committed-refresh-pending';
    reason?: 'source' | 'duplicate' | 'target' | 'template' | 'unavailable';
    sourcePath?: string;
    targetPath?: string;
};

export function conversionPreparationFailure(code?: string): PluginUiConversionResult {
    if (code === 'template-processing-required') return { status: 'template-required' };
    const reason = code === 'duplicate-operon-id' ? 'duplicate'
        : code === 'stale-source' || code === 'stale-context' || code === 'task-not-found' ? 'source'
        : code === 'needs-target' || code === 'invalid-target' || code === 'target-exists' ? 'target'
        : code?.includes('template') ? 'template' : 'unavailable';
    return { status: 'not-applied', reason };
}

/** Plugin UI conversion steps use exact state checks and never retry an uncertain write. */
export interface PluginUiConversionStep {
    isBefore(): Promise<boolean>;
    isAfter(): Promise<boolean>;
    apply(): Promise<boolean>;
    rollback(): Promise<boolean>;
    irreversible?: boolean;
}

async function executeConversionSteps(
    steps: readonly PluginUiConversionStep[],
    canCommit: () => boolean,
    detailedOutcome: boolean,
): Promise<'committed' | 'not-applied' | 'cancelled' | 'rolled-back' | 'outcome-unknown'> {
    if (steps.some((step, index) => step.irreversible && index !== steps.length - 1)) return 'not-applied';
    try {
        for (const step of steps) if (!await step.isBefore()) return 'not-applied';
    } catch { return 'not-applied'; }
    if (detailedOutcome && !canCommit()) return 'cancelled';
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
            if (!canCommit()) return committed.length === 0 ? 'cancelled' : await rollback();
            if (!await step.isBefore()) return committed.length === 0 ? 'not-applied' : await rollback();
            if (step.irreversible) {
                for (const previous of committed) if (!await previous.isAfter()) return await rollback();
            }
            if (!canCommit()) return committed.length === 0 ? 'cancelled' : await rollback();
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
        if (!applied) {
            if (!detailedOutcome) return await rollback();
            // A step may deliberately fail after creating a safely removable target.
            try {
                if (!await step.isBefore()) {
                    if (!await step.isAfter()) return 'outcome-unknown';
                    committed.push(step);
                }
            } catch { return 'outcome-unknown'; }
            return committed.length === 0 ? 'not-applied' : await rollback();
        }
        committed.push(step);
    }
    try {
        for (const step of committed) if (!await step.isAfter()) return detailedOutcome ? await rollback() : 'outcome-unknown';
    } catch { return 'outcome-unknown'; }
    return 'committed';
}

// Other Plugin transactions retain their existing outcome contract.
type ConversionOutcome = Awaited<ReturnType<typeof executeConversionSteps>>;
type LegacyOutcome = 'committed' | 'rolled-back' | 'outcome-unknown';
export function executePluginUiConversionTransaction(steps: readonly PluginUiConversionStep[], canCommit: () => boolean): Promise<LegacyOutcome>;
export function executePluginUiConversionTransaction(steps: readonly PluginUiConversionStep[], canCommit: () => boolean, detailedOutcome: true): Promise<ConversionOutcome>;
export async function executePluginUiConversionTransaction(
    steps: readonly PluginUiConversionStep[], canCommit: () => boolean, detailedOutcome = false,
): Promise<ConversionOutcome> {
    const outcome = await executeConversionSteps(steps, canCommit, detailedOutcome);
    return !detailedOutcome && (outcome === 'cancelled' || outcome === 'not-applied') ? 'rolled-back' : outcome;
}
