import { Notice, Platform, type App } from 'obsidian';
import { t } from '../core/i18n';
import { openWebViewerNewTab } from './external-link-actions';
import { isTaskSourceOpenModifierClick } from './task-source-open-modifier';
import { openWebLightbox } from './web-lightbox';

/** Only canonical Links on desktop opt in; all other callers retain their existing route. */
export function handleLinksChipClick(app: App, chip: HTMLElement, entry: { key: string; externalUrl?: string | null }, event: MouseEvent): boolean {
	if (!Platform.isDesktopApp || entry.key !== 'links' || !entry.externalUrl) return false;
	if (event.button !== 0 || event.detail > 1) return true;
	let url: URL;
	try { url = new URL(entry.externalUrl); } catch { return true; }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
	if (event.detail !== 0 && isTaskSourceOpenModifierClick(event)) {
		if (!openWebViewerNewTab(app, url.href)) new Notice(t('notifications', 'webViewerUnavailable'));
	} else {
		openWebLightbox(app, chip, url.href);
	}
	return true;
}

export function bindLinksChipKeyboard(chip: HTMLElement, key: string): void {
	if (!Platform.isDesktopApp || key !== 'links' || chip.tagName === 'BUTTON') return;
	chip.tabIndex = 0;
	chip.setAttribute('role', 'button');
	chip.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) chip.click();
	});
}
