export interface OperonSettingsBackupRecoveryCapabilitiesV1 {
	receiptId: string;
	undoTokenId: string | null;
	message: string;
	canKeep: boolean;
	canRetryRuntimeRefresh: boolean;
	canUndo: boolean;
}

/** Pure recovery view-state seam shared by production coordination and UI tests. */
export function buildOperonSettingsBackupRecoveryCapabilitiesV1(input: {
	receiptId: string;
	undoTokenId: string | null;
	message: string;
	runtimeRetryRequired: boolean;
	undoAvailable: boolean;
}): OperonSettingsBackupRecoveryCapabilitiesV1 {
	return Object.freeze({
		receiptId: input.receiptId,
		undoTokenId: input.undoTokenId,
		message: input.message,
		canKeep: input.undoTokenId !== null,
		canRetryRuntimeRefresh: input.runtimeRetryRequired,
		canUndo: input.undoAvailable && input.undoTokenId !== null,
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
	});
}
