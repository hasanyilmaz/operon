import type { OperonTableFileDescriptor, OperonTableFileDiagnostic } from './table-file';
import type { TablePreset, TablePresetFileBinding, TablePresetPatch } from './table';

export type TablePresetRegistryConflictCode =
	| 'duplicate-binding-id'
	| 'duplicate-binding-path'
	| 'duplicate-table-file'
	| 'bound-id-mismatch';

export interface TablePresetRegistryConflict {
	code: TablePresetRegistryConflictCode;
	presetId: string;
	message: string;
	paths: string[];
}

export type TablePresetRegistrySourceKind = 'table-file' | 'missing-bound-file' | 'conflict';

export interface TablePresetRegistrySource<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	kind: TablePresetRegistrySourceKind;
	presetId: string;
	path: string | null;
	requestedPath: string | null;
	bound: boolean;
	descriptor: TDescriptor | null;
}

export interface TablePresetRegistryEntry<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	id: string;
	status: 'available' | 'missing' | 'conflict';
	preset: TablePreset | null;
	source: TablePresetRegistrySource<TDescriptor>;
	conflicts: TablePresetRegistryConflict[];
}

export interface TablePresetRegistrySnapshot<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	revision: number;
	sourceRevision: number;
	entries: ReadonlyMap<string, TablePresetRegistryEntry<TDescriptor>>;
	fileDiagnostics: readonly OperonTableFileDiagnostic[];
	conflicts: readonly TablePresetRegistryConflict[];
}

export interface TablePresetRegistryPatchContext<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	presetId: string;
	scope: string;
	source: TablePresetRegistrySource<TDescriptor>;
	baseRevision: number;
	baseFileContent?: string;
}

export interface TablePresetRegistryCallbacks<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	loadFileBindings: () => readonly TablePresetFileBinding[] | Promise<readonly TablePresetFileBinding[]>;
	listTableFiles: () => readonly TDescriptor[] | Promise<readonly TDescriptor[]>;
	readTableFile: (descriptor: TDescriptor) => string | Promise<string>;
	applyPatch: (preset: TablePreset, patch: TablePresetPatch) => TablePreset;
	writeTableFile?: (path: string, serialized: string, context: TablePresetRegistryPatchContext<TDescriptor>) => void | Promise<void>;
	getSourceRevision?: () => number;
	schedulePatch?: (callback: () => void, delayMs: number) => number;
	cancelScheduledPatch?: (timerId: number) => void;
}

export interface TablePresetRegistryPatchHooks {
	onFlushed?: (preset: TablePreset, revision: number) => void;
	onCancelled?: () => void;
	onError?: (error: unknown) => void;
}

export interface TablePresetRegistryPatchOptions extends TablePresetRegistryPatchHooks {
	delayMs?: number;
	expectedRevision?: number;
	surfaceToken?: string;
}

export interface TablePresetRegistryPatchControl {
	acceptedRevision: number;
	settled: Promise<void>;
	flush: () => Promise<void>;
	cancel: () => void;
}

export type TablePresetRegistryListener<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> = (
	entry: TablePresetRegistryEntry<TDescriptor> | null,
	snapshot: TablePresetRegistrySnapshot<TDescriptor>,
) => void;
