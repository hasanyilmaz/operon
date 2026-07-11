import type { App } from 'obsidian';
import {
	CORE_TEMPLATE_DEFAULT_DATE_FORMAT,
	CORE_TEMPLATE_DEFAULT_TIME_FORMAT,
} from './core-template-variables';

export interface TemplatesCoreConfig {
	folder: string;
	dateFormat: string;
	timeFormat: string;
}

/**
 * Read Core Templates settings without assuming a vault-root config path.
 * Missing or malformed settings deliberately fall back to Obsidian's documented
 * default template variable formats.
 */
export async function loadTemplatesCoreConfig(app: App): Promise<TemplatesCoreConfig> {
	try {
		const raw = await app.vault.adapter.read(`${app.vault.configDir}/templates.json`);
		const parsed = JSON.parse(raw) as { folder?: unknown; dateFormat?: unknown; timeFormat?: unknown };
		return {
			folder: typeof parsed.folder === 'string' ? parsed.folder.trim() : '',
			dateFormat: typeof parsed.dateFormat === 'string' && parsed.dateFormat.trim()
				? parsed.dateFormat.trim()
				: CORE_TEMPLATE_DEFAULT_DATE_FORMAT,
			timeFormat: typeof parsed.timeFormat === 'string' && parsed.timeFormat.trim()
				? parsed.timeFormat.trim()
				: CORE_TEMPLATE_DEFAULT_TIME_FORMAT,
		};
	} catch {
		return {
			folder: '',
			dateFormat: CORE_TEMPLATE_DEFAULT_DATE_FORMAT,
			timeFormat: CORE_TEMPLATE_DEFAULT_TIME_FORMAT,
		};
	}
}
