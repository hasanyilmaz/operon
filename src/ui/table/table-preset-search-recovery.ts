export interface TablePresetSearchSaveFailureRecovery {
	shouldRecover: boolean;
	pendingPresetSearchSignature: string | null;
}

export function resolveTablePresetSearchSaveFailureRecovery(
	pendingPresetSearchSignature: string | null,
	failedSignature: string,
): TablePresetSearchSaveFailureRecovery {
	if (pendingPresetSearchSignature !== failedSignature) {
		return {
			shouldRecover: false,
			pendingPresetSearchSignature,
		};
	}
	return {
		shouldRecover: true,
		pendingPresetSearchSignature: null,
	};
}
