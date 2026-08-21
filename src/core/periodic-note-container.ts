export interface PeriodicNoteContainerTaskSnapshot {
	operonId: string;
	filePath: string;
	fieldValues: Record<string, string>;
	tags: string[];
}

export interface ResolvePeriodicNoteContainerTaskOptions {
	createAsOperonTask: boolean;
	wasCreated: boolean;
	filePath: string;
	parsedOperonId: string | null;
	parsedFieldValues: Record<string, string> | null;
	parsedTags: string[] | null;
	indexedFileTask: PeriodicNoteContainerTaskSnapshot | null;
	hasDuplicateOperonIdConflict: boolean;
}

/**
 * Periodic parent authority requires one exact indexed File Task.  The caller
 * registers the durable identity only after this check succeeds.
 */
export function resolvePeriodicNoteContainerTask(
	options: ResolvePeriodicNoteContainerTaskOptions,
): PeriodicNoteContainerTaskSnapshot | null {
	if (!options.createAsOperonTask || options.hasDuplicateOperonIdConflict) return null;

	const parsedOperonId = options.parsedOperonId?.trim() ?? '';
	if (!parsedOperonId) return null;

	const indexed = options.indexedFileTask;
	if (indexed) {
		if (indexed.filePath !== options.filePath || indexed.operonId !== parsedOperonId) return null;
		return {
			operonId: indexed.operonId,
			filePath: indexed.filePath,
			fieldValues: { ...indexed.fieldValues },
			tags: [...indexed.tags],
		};
	}

	return null;
}
