import type { TFile } from 'obsidian';
import type { TaskFinderResultBehavior } from '../types/settings';

export type FileLightboxOpening = { kind: 'source' } | { kind: 'properties'; showSource: boolean } | { kind: 'editor'; id: string; showSource: boolean };

export function resolveFileLightboxOpening(file: TFile, behavior: TaskFinderResultBehavior, context: {
	isExcalidraw: (file: TFile) => boolean;
	basesEnabled: () => boolean;
	/** Undefined means task identity is uncertain. Null means this file has no File Task. */
	fileTaskId: (file: TFile) => string | null | undefined;
}): FileLightboxOpening | null {
	if (file.extension === 'table') return { kind: 'source' };
	if (file.extension === 'base') return context.basesEnabled() ? { kind: 'source' } : null;
	if (file.extension !== 'md' || context.isExcalidraw(file)) return null;
	if (behavior === 'source') return { kind: 'source' };
	const id = context.fileTaskId(file);
	if (id === undefined) return null;
	return id === null ? { kind: 'properties', showSource: behavior === 'source-and-editor' } : { kind: 'editor', id, showSource: behavior === 'source-and-editor' };
}
