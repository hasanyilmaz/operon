export type OperonSettingsBackupProductionRecoveryResultV1 =
	| { status: 'settled' }
	| { status: 'degraded'; phase: 'canonical-reload' | 'table-registry' | 'runtime' };

export interface OperonSettingsBackupProductionRecoveryDependenciesV1 {
	reloadCanonical(): Promise<boolean>;
	refreshTableRegistry(): Promise<void>;
	settleRuntime(): Promise<boolean>;
}

/** Testable production ordering seam: reload, registry publication, then runtime settlement. */
export async function coordinateOperonSettingsBackupProductionRecoveryV1(
	needsCanonicalReload: boolean,
	dependencies: OperonSettingsBackupProductionRecoveryDependenciesV1,
): Promise<OperonSettingsBackupProductionRecoveryResultV1> {
	if (needsCanonicalReload) {
		try {
			if (!await dependencies.reloadCanonical()) return { status: 'degraded', phase: 'canonical-reload' };
		} catch {
			return { status: 'degraded', phase: 'canonical-reload' };
		}
	}
	try {
		await dependencies.refreshTableRegistry();
	} catch {
		return { status: 'degraded', phase: 'table-registry' };
	}
	try {
		return await dependencies.settleRuntime()
			? { status: 'settled' }
			: { status: 'degraded', phase: 'runtime' };
	} catch {
		return { status: 'degraded', phase: 'runtime' };
	}
}
