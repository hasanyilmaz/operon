import {
	resolveEffectivePeriodicNoteConfig,
	type PeriodicNoteConfigResolution,
	type PeriodicNoteManagedConfig,
} from './periodic-note-config';
import type { PeriodicNoteKind } from './periodic-note-path';

export interface PeriodicNoteSettingsSource {
	manageDailyNotesWithOperon: boolean;
	dailyNoteFormat: string;
	dailyNoteFolder: string;
	dailyNoteTemplate: string;
	createDailyNotesAsOperonTask: boolean;
	manageWeeklyNotesWithOperon: boolean;
	weeklyNoteFormat: string;
	weeklyNoteFolder: string;
	weeklyNoteTemplate: string;
	createWeeklyNotesAsOperonTask: boolean;
}

/** Build the serializable Operon-owned configuration without reading Obsidian state. */
export function buildOperonPeriodicNoteConfig(
	kind: PeriodicNoteKind,
	settings: PeriodicNoteSettingsSource,
): PeriodicNoteManagedConfig {
	if (kind === 'weekly') {
		return {
			enabled: settings.manageWeeklyNotesWithOperon,
			format: settings.weeklyNoteFormat,
			folder: settings.weeklyNoteFolder,
			template: settings.weeklyNoteTemplate,
			createAsOperonTask: settings.createWeeklyNotesAsOperonTask,
		};
	}
	return {
		enabled: settings.manageDailyNotesWithOperon,
		format: settings.dailyNoteFormat,
		folder: settings.dailyNoteFolder,
		template: settings.dailyNoteTemplate,
		createAsOperonTask: settings.createDailyNotesAsOperonTask,
	};
}

/** Daily can fall back to Core; Weekly is available only when Operon owns it. */
export function isPeriodicNoteKindAvailable(
	kind: PeriodicNoteKind,
	settings: PeriodicNoteSettingsSource,
	coreDailyNotesAvailable: boolean,
): boolean {
	if (kind === 'weekly') return settings.manageWeeklyNotesWithOperon;
	return settings.manageDailyNotesWithOperon || coreDailyNotesAvailable;
}

export interface ResolvePeriodicNoteConfigFromSettingsOptions {
	kind: PeriodicNoteKind;
	settings: PeriodicNoteSettingsSource;
	coreDailyNotesAvailable: boolean;
	loadCoreDailyNotes?: () => Promise<PeriodicNoteManagedConfig | null>;
}

/** Resolve provider precedence without coupling the policy to Obsidian or Settings UI. */
export async function resolvePeriodicNoteConfigFromSettings(
	options: ResolvePeriodicNoteConfigFromSettingsOptions,
): Promise<PeriodicNoteConfigResolution> {
	const operon = buildOperonPeriodicNoteConfig(options.kind, options.settings);
	if (operon.enabled || options.kind === 'weekly' || !options.coreDailyNotesAvailable) {
		return resolveEffectivePeriodicNoteConfig({ kind: options.kind, operon });
	}
	const coreDailyNotes = await options.loadCoreDailyNotes?.() ?? null;
	return resolveEffectivePeriodicNoteConfig({
		kind: options.kind,
		operon,
		coreDailyNotes,
	});
}
