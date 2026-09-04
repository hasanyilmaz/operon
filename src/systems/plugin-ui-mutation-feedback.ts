export type PluginUiMutationOutcome =
	| 'committed'
	| 'cancelled'
	| 'recurrence-blocked'
	| 'duplicate-task'
	| 'source-missing'
	| 'source-changed'
	| 'invalid-task-data'
	| 'failed-before-commit'
	| 'committed-repair-scheduled'
	| 'outcome-unknown'
	| 'delete-recovery-required';

export type PluginUiMutationNoticeKey =
	| 'taskSourceUnavailable'
	| 'taskChangedElsewhere'
	| 'taskFieldsInvalid'
	| 'recurrenceCompletionBlocked'
	| 'taskChangeNotApplied'
	| 'taskChangeAppliedRefreshPending'
	| 'taskChangeOutcomeUnknown'
	| 'taskDeleteRecoveryRequired';

export function isPluginUiMutationCommitted(outcome: PluginUiMutationOutcome): boolean {
	return outcome === 'committed' || outcome === 'committed-repair-scheduled';
}

export function resolvePluginUiMutationNoticeKey(
	outcome: PluginUiMutationOutcome,
): PluginUiMutationNoticeKey | null {
	switch (outcome) {
		case 'source-missing':
			return 'taskSourceUnavailable';
		case 'source-changed':
			return 'taskChangedElsewhere';
		case 'invalid-task-data':
			return 'taskFieldsInvalid';
		case 'recurrence-blocked':
			return 'recurrenceCompletionBlocked';
		case 'failed-before-commit':
			return 'taskChangeNotApplied';
		case 'committed-repair-scheduled':
			return 'taskChangeAppliedRefreshPending';
		case 'outcome-unknown':
			return 'taskChangeOutcomeUnknown';
		case 'delete-recovery-required':
			return 'taskDeleteRecoveryRequired';
		case 'committed':
		case 'cancelled':
		case 'duplicate-task':
			return null;
	}
}
