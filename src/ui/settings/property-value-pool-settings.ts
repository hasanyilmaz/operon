import { renderPropertyPoolValueVisual } from '../property-pool-value-visual';
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
		const choices = [{ key: '', label: t('settings', 'propertyPoolNoValue') }, { key: '@all', label: t('settings', 'propertyPoolAllValues') }, { key: '@favorites', label: t('settings', 'propertyPoolFavorites') }, ...fields];
		for (const [index, shortcut] of preferences.shortcuts.entries()) {
			const row = new Setting(host);
			row.addDropdown(dropdown => {
				for (const choice of choices) dropdown.addOption(choice.key, choice.label);
				if (!choices.some(choice => choice.key === shortcut.key)) dropdown.addOption(shortcut.key, shortcut.key);
				dropdown.setValue(shortcut.key);
				dropdown.selectEl.setAttribute('aria-label', `${t('settings', 'propertyPoolShortcuts')} ${index + 1}`);
				for (const option of Array.from(dropdown.selectEl.options)) option.disabled = !!option.value && preferences.shortcuts.some((item, other) => other !== index && item.key === option.value);
				row.nameEl.appendChild(dropdown.selectEl);
				dropdown.onChange(settingsAsyncHandler('property pool shortcut selection', async key => {
					if (key && preferences.shortcuts.some((item, other) => other !== index && item.key === key)) return;
					await commit({ kind: 'shortcuts', shortcuts: preferences.shortcuts.map((item, position) => position === index ? { ...item, key } : item) });
				}));
			});
			row.addToggle(toggle => toggle.setValue(shortcut.visible).onChange(settingsAsyncHandler('property pool shortcut visibility', async visible => {
				await commit({ kind: 'shortcuts', shortcuts: preferences.shortcuts.map((item, position) => position === index ? { ...item, visible } : item) });
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
			const row = new Setting(host).setName(favorite.type === 'date' ? resolved?.label ?? favorite.label : `${field?.label ?? favorite.key} · ${resolved?.label ?? favorite.label}`)
				.setDesc(resolved ? '' : t('settings', 'propertyPoolValueUnavailable'))
				.addExtraButton(button => button.setIcon('star-off').setTooltip(t('settings', 'propertyPoolRemoveFavorite')).onClick(settingsAsyncHandler('property pool remove favorite', async () => { await commit({ kind: 'favorite', favorite, saved: false }); })));
			if (favorite.key === 'taskColor' || favorite.key === 'taskIcon') {
				row.nameEl.addClass('operon-property-pool-favorite-name');
				renderPropertyPoolValueVisual(row.nameEl, resolved ?? favorite, field?.icon ?? 'text');
			}
		}
	};
	render();
	const unsubscribe = subscribe?.(render);
	return () => { disposed = true; unsubscribe?.(); };
}
