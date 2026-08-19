export type InlineTaskSaveMode = 'daily-notes' | 'weekly-notes' | 'specific-file' | 'active-file' | 'ask-every-time';

export interface InlineTaskSaveModeSettings {
	inlineTaskSaveMode?: InlineTaskSaveMode;
	inlineTaskUseDailyNote: boolean;
}

export function resolveEffectiveInlineTaskSaveMode(
	settings: InlineTaskSaveModeSettings,
	dailyNotesAvailable: boolean,
): InlineTaskSaveMode {
	const requestedMode = settings.inlineTaskSaveMode
		?? (settings.inlineTaskUseDailyNote ? 'daily-notes' : 'specific-file');
	// Keep Weekly Notes selected when its Operon management is disabled. The
	// creation surface must fail closed with a direct Notice instead of silently
	// changing a user's intended destination to a specific file.
	if (requestedMode === 'daily-notes' && !dailyNotesAvailable) return 'specific-file';
	return requestedMode;
}
