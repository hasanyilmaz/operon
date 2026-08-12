export const SETTINGS_BACKUP_RUNTIME_REFRESH_STEPS = [
	'standard-refresh',
	'locale',
	'agent-runtime',
	'reindex',
	'external-calendars',
	'mobile-notifications',
] as const;

export type OperonSettingsBackupRuntimeRefreshStep = typeof SETTINGS_BACKUP_RUNTIME_REFRESH_STEPS[number];
export type OperonSettingsBackupRecoveryDisplayKind =
	| 'conditional-undo'
	| 'runtime-refresh-incomplete'
	| 'manual-recovery';

export interface OperonSettingsBackupRecoveryCapabilitiesV1 {
	receiptId: string;
	undoTokenId: string | null;
	message: string;
	canKeep: boolean;
	canRetryRuntimeRefresh: boolean;
	canUndo: boolean;
	displayKind?: OperonSettingsBackupRecoveryDisplayKind;
	failedRuntimeSteps?: readonly OperonSettingsBackupRuntimeRefreshStep[];
}

/** Pure recovery view-state seam shared by production coordination and UI tests. */
export function buildOperonSettingsBackupRecoveryCapabilitiesV1(input: {
	receiptId: string;
	undoTokenId: string | null;
	message: string;
	runtimeRetryRequired: boolean;
	undoAvailable: boolean;
	displayKind?: OperonSettingsBackupRecoveryDisplayKind;
	failedRuntimeSteps?: readonly OperonSettingsBackupRuntimeRefreshStep[];
}): OperonSettingsBackupRecoveryCapabilitiesV1 {
	const failedRuntimeSteps = input.failedRuntimeSteps
		? SETTINGS_BACKUP_RUNTIME_REFRESH_STEPS.filter(step => input.failedRuntimeSteps?.includes(step))
		: undefined;
	return Object.freeze({
		receiptId: input.receiptId,
		undoTokenId: input.undoTokenId,
		message: input.message,
		canKeep: input.undoTokenId !== null,
		canRetryRuntimeRefresh: input.runtimeRetryRequired,
		canUndo: input.undoAvailable && input.undoTokenId !== null,
		...(input.displayKind ? { displayKind: input.displayKind } : {}),
		...(failedRuntimeSteps && failedRuntimeSteps.length > 0 ? { failedRuntimeSteps } : {}),
	});
}

export function settleOperonSettingsBackupRecoveryRetryV1(
	current: OperonSettingsBackupRecoveryCapabilitiesV1,
	message: string,
): OperonSettingsBackupRecoveryCapabilitiesV1 {
	return buildOperonSettingsBackupRecoveryCapabilitiesV1({
		receiptId: current.receiptId,
		undoTokenId: current.undoTokenId,
		message,
		runtimeRetryRequired: false,
		undoAvailable: current.canUndo,
		displayKind: 'conditional-undo',
	});
}
