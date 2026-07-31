import type { TablePreset } from './table';

export interface TablePresetFileConflictResolutionRequest {
	presetId: string;
	chosenOriginalPath: string;
}

export interface TablePresetFileConflictResolutionSuccess {
	sourcePath: string;
	path: string;
	oldPresetId: string;
	preset: TablePreset;
	sourceFingerprint: string;
	targetFingerprint: string;
}

export interface TablePresetFileConflictResolutionFailure {
	path: string;
	error: string;
}

export interface TablePresetFileConflictResolutionResult {
	presetId: string;
	chosenOriginalPath: string;
	succeeded: TablePresetFileConflictResolutionSuccess[];
	failed: TablePresetFileConflictResolutionFailure[];
}
