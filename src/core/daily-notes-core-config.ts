import type { App } from 'obsidian';
import { DEFAULT_DAILY_NOTE_FORMAT } from './daily-note-path';

export interface DailyNotesCoreConfig {
	folder: string;
	template: string;
	format: string;
}

/** Read the Core Daily Notes configuration without assuming a fixed vault config path. */
export async function loadDailyNotesCoreConfig(app: App): Promise<DailyNotesCoreConfig> {
	try {
		const raw = await app.vault.adapter.read(`${app.vault.configDir}/daily-notes.json`);
		const parsed = JSON.parse(raw) as { folder?: unknown; template?: unknown; format?: unknown };
		return {
			folder: typeof parsed.folder === 'string' ? parsed.folder.trim() : '',
			template: typeof parsed.template === 'string' ? parsed.template.trim() : '',
			format: typeof parsed.format === 'string' && parsed.format.trim()
				? parsed.format.trim()
				: DEFAULT_DAILY_NOTE_FORMAT,
		};
	} catch {
		return {
			folder: '',
			template: '',
			format: DEFAULT_DAILY_NOTE_FORMAT,
		};
	}
}
