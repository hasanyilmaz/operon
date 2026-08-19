import {
	formatPeriodicNoteTitleFromDateKey,
	normalizePeriodicNoteFolder,
	normalizePeriodicNoteFormat,
	type PeriodicNoteKind,
} from './periodic-note-path';
import { isSafeVaultRelativePath } from './vault-path-safety';

export type PeriodicNoteConfigSource = 'operon' | 'core-daily-notes';

export interface PeriodicNoteManagedConfig {
	enabled: boolean;
	format?: string | null;
	folder?: string | null;
	template?: string | null;
	createAsOperonTask?: boolean;
}

export interface PeriodicNoteEffectiveConfig {
	kind: PeriodicNoteKind;
	source: PeriodicNoteConfigSource;
	format: string;
	folder: string;
	template: string;
	createAsOperonTask: boolean;
}

export type PeriodicNoteConfigUnavailableReason =
	| 'operon-disabled'
	| 'core-daily-notes-unavailable'
	| 'invalid-config';

export type PeriodicNoteConfigResolution =
	| { available: true; config: PeriodicNoteEffectiveConfig }
	| { available: false; reason: PeriodicNoteConfigUnavailableReason; source?: PeriodicNoteConfigSource };

export interface ResolveEffectivePeriodicNoteConfigOptions {
	kind: PeriodicNoteKind;
	operon: PeriodicNoteManagedConfig;
	coreDailyNotes?: PeriodicNoteManagedConfig | null;
}

/** Operon owns enabled configuration; Core is only a Daily fallback. */
export function resolveEffectivePeriodicNoteConfig(
	options: ResolveEffectivePeriodicNoteConfigOptions,
): PeriodicNoteConfigResolution {
	const { kind, operon } = options;
	if (operon.enabled) return normalizeEffectiveConfig(kind, 'operon', operon);
	if (kind === 'weekly') return { available: false, reason: 'operon-disabled' };
	const coreDailyNotes = options.coreDailyNotes;
	if (!coreDailyNotes?.enabled) return { available: false, reason: 'core-daily-notes-unavailable' };
	return normalizeEffectiveConfig(kind, 'core-daily-notes', coreDailyNotes);
}

/**
 * Classifies an already-created periodic File Task independently from today's
 * creation toggles.  Turning a management or create-as-task toggle off must
 * never make an existing periodic container eligible for pipeline moves.
 */
export function resolveHistoricalPeriodicNoteConfig(
	kind: PeriodicNoteKind,
	source: PeriodicNoteConfigSource,
	config: PeriodicNoteManagedConfig,
): PeriodicNoteConfigResolution {
	return normalizeEffectiveConfig(kind, source, {
		...config,
		enabled: true,
		createAsOperonTask: true,
	}, false);
}

function normalizeEffectiveConfig(
	kind: PeriodicNoteKind,
	source: PeriodicNoteConfigSource,
	config: PeriodicNoteManagedConfig,
	validateTemplate = true,
): PeriodicNoteConfigResolution {
	const folder = normalizePeriodicNoteFolder(config.folder ?? '');
	const format = normalizePeriodicNoteFormat(kind, config.format);
	const template = (config.template ?? '').trim();
	if (folder === null || !formatPeriodicNoteTitleFromDateKey(kind, '2026-01-05', format)) {
		return { available: false, reason: 'invalid-config', source };
	}
	if (validateTemplate && template && (!template.toLowerCase().endsWith('.md') || !isSafeVaultRelativePath(template))) {
		return { available: false, reason: 'invalid-config', source };
	}
	return {
		available: true,
		config: {
			kind,
			source,
			format,
			folder,
			template,
			createAsOperonTask: config.createAsOperonTask === true,
		},
	};
}
