import type { TablePreset } from './table';

export const OPERON_TABLE_FILE_FORMAT = 'operon-table' as const;
export const OPERON_TABLE_FILE_LEGACY_VERSION = 1 as const;
export const OPERON_TABLE_FILE_PREVIOUS_VERSION = 2 as const;
export const OPERON_TABLE_FILE_VERSION = 3 as const;
export const OPERON_TABLE_FILE_EXTENSION = '.table' as const;
export const OPERON_TABLE_FILE_FALLBACK_NAME = 'Untitled Table' as const;
export const OPERON_TABLE_FILE_STEM_MAX_CODEPOINTS = 100 as const;

export type OperonTableFilePathChange = 'unchanged' | 'rename' | 'move' | 'rename-and-move';

export type OperonTableFile = {
	format: typeof OPERON_TABLE_FILE_FORMAT;
	version:
		| typeof OPERON_TABLE_FILE_LEGACY_VERSION
		| typeof OPERON_TABLE_FILE_PREVIOUS_VERSION
		| typeof OPERON_TABLE_FILE_VERSION;
} & TablePreset;

export type OperonTableFileDiagnosticCode =
	| 'invalid-json'
	| 'invalid-root'
	| 'invalid-format'
	| 'unsupported-version'
	| 'missing-field'
	| 'invalid-field'
	| 'unknown-field'
	| 'read-failed'
	| 'duplicate-id';

export interface OperonTableFileDiagnostic {
	code: OperonTableFileDiagnosticCode;
	severity: 'error';
	message: string;
	path?: string;
	field?: string;
}

export type OperonTableFileParseResult =
	| {
		status: 'valid';
		file: OperonTableFile;
		preset: TablePreset;
		diagnostics: [];
	}
	| {
		status: 'invalid';
		file: null;
		preset: null;
		diagnostics: OperonTableFileDiagnostic[];
	};

export interface OperonTableFileDescriptor {
	path: string;
}

export interface DiscoveredOperonTableFile<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	descriptor: TDescriptor;
	path: string;
	status: 'loaded' | 'invalid' | 'conflict';
	file: OperonTableFile | null;
	preset: TablePreset | null;
	diagnostics: OperonTableFileDiagnostic[];
}

export interface OperonTableFileDiscoveryResult<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	files: DiscoveredOperonTableFile<TDescriptor>[];
	presets: TablePreset[];
	diagnostics: OperonTableFileDiagnostic[];
}

export type OperonTableFileReadCallback<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> =
	(descriptor: TDescriptor) => string | Promise<string>;
