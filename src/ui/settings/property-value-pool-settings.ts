import { Notice, Setting } from 'obsidian';
import { t } from '../../core/i18n';
import { editPropertyPoolPreferences, propertyPoolFields, readPropertyPoolPreferences, type PropertyPoolFavorite, type PropertyPoolEdit, type PropertyPoolPreferences } from '../../core/property-value-pool';
import type { OperonSettings } from '../../types/settings';
import { settingsAsyncHandler } from './async-settings-action';

export function renderPropertyValuePoolSettings(container: HTMLElement, getSettings: () => OperonSettings, save: (preferences: PropertyPoolPreferences, expected: unknown) => Promise<void>, resolveFavorite: (favorite: PropertyPoolFavorite) => PropertyPoolFavorite | null, subscribe?: (listener: () => void) => () => void): () => void {
	const host = container.createDiv();
	let busy = false;
	let disposed = false;
	const render = (): void => {
		if (disposed) return;
		host.empty();
		const settings = getSettings();
		const raw = settings.propertyValuePool;
		const { writable, preferences } = readPropertyPoolPreferences(raw);
		const fields = propertyPoolFields(settings);
		const commit = async (edit: PropertyPoolEdit): Promise<void> => {
			if (disposed || busy || !writable) return;
			busy = true;
			try { await save(editPropertyPoolPreferences(raw, edit), raw); }
			catch (error) { new Notice(t('settings', 'propertyPoolSaveFailed')); console.error('Operon: Property Value Pool settings save failed', error); }
			finally { busy = false; render(); }
		};
		new Setting(host).setName(t('settings', 'propertyPoolShortcuts')).setDesc(t('settings', 'propertyPoolShortcutsDesc'));
		if (!writable) {
			new Setting(host).setDesc(t('settings', 'propertyPoolUnavailable'));
			return;
		}
		for (const [index, shortcut] of preferences.shortcuts.entries()) {
			const field = fields.find(item => item.key === shortcut.key);
			const row = new Setting(host).setName(field?.label ?? shortcut.key);
			row.addToggle(toggle => toggle.setValue(shortcut.visible).onChange(settingsAsyncHandler('property pool shortcut visibility', async visible => {
				await commit({ kind: 'shortcuts', shortcuts: preferences.shortcuts.map(item => item.key === shortcut.key ? { ...item, visible } : item) });
			})));
			for (const direction of [-1, 1]) row.addExtraButton(button => button.setIcon(direction < 0 ? 'arrow-up' : 'arrow-down').setTooltip(t('settings', direction < 0 ? 'propertyPoolMoveUp' : 'propertyPoolMoveDown')).setDisabled(index + direction < 0 || index + direction >= preferences.shortcuts.length).onClick(settingsAsyncHandler('property pool shortcut order', async () => {
				const shortcuts = [...preferences.shortcuts];
				[shortcuts[index], shortcuts[index + direction]] = [shortcuts[index + direction], shortcuts[index]];
				await commit({ kind: 'shortcuts', shortcuts });
			})));
		}
		new Setting(host).setName(t('settings', 'propertyPoolFavorites')).setDesc(t('settings', 'propertyPoolFavoritesDesc'));
		if (!preferences.favorites.length) new Setting(host).setDesc(t('settings', 'propertyPoolEmpty'));
		for (const favorite of preferences.favorites) {
			const resolved = resolveFavorite(favorite);
			const field = fields.find(item => item.key === favorite.key);
			new Setting(host).setName(`${field?.label ?? favorite.key} · ${resolved?.label ?? favorite.label}`)
				.setDesc(resolved ? '' : t('settings', 'propertyPoolValueUnavailable'))
				.addExtraButton(button => button.setIcon('star-off').setTooltip(t('settings', 'propertyPoolRemoveFavorite')).onClick(settingsAsyncHandler('property pool remove favorite', async () => { await commit({ kind: 'favorite', favorite, saved: false }); })));
		}
	};
	render();
	const unsubscribe = subscribe?.(render);
	return () => { disposed = true; unsubscribe?.(); };
}
