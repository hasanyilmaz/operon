import type { TablePresetFileBinding } from '../types/table';
import { getOperonTableFilePathKey, isOperonTableFilePath } from './table-file';

export type DeletedTablePresetPathKind = 'file' | 'folder';

export function collectMissingTablePresetIds(
	bindings: readonly TablePresetFileBinding[],
	getSourceKind: (presetId: string) => string | undefined,
	isPathPresent: (path: string) => boolean,
): string[] {
	const missingIds = new Set<string>();
	for (const binding of bindings) {
		if (isPathPresent(binding.path)) continue;
		if (getSourceKind(binding.id) === 'missing-bound-file') missingIds.add(binding.id);
	}
	return [...missingIds];
}

/** Finds only bound Table presets whose source path was covered by a vault delete event. */
export function collectDeletedTablePresetBindings(
	bindings: readonly TablePresetFileBinding[],
	deletedPath: string,
	kind: DeletedTablePresetPathKind,
): TablePresetFileBinding[] {
	const deletedPathKey = getOperonTableFilePathKey(deletedPath);
	if (!deletedPathKey) return [];
	if (kind === 'file') {
		if (!isOperonTableFilePath(deletedPath)) return [];
		return bindings
			.filter(binding => getOperonTableFilePathKey(binding.path) === deletedPathKey)
			.map(binding => ({ ...binding }));
	}

	const folderPrefix = `${deletedPathKey}/`;
	return bindings
		.filter(binding => getOperonTableFilePathKey(binding.path).startsWith(folderPrefix))
		.map(binding => ({ ...binding }));
}
