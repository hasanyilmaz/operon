import { renderPropertyPoolValueVisual } from '../property-pool-value-visual';
import { Notice, type Setting, type SettingDefinition, type SettingDefinitionGroup } from 'obsidian';
import { t } from '../../core/i18n';
import { editPropertyPoolPreferences, propertyPoolScopeKey, propertyPoolFields, propertyPoolFavoriteId, resolvePropertyPoolFavorite, readPropertyPoolPreferences, type PropertyPoolFavorite, type PropertyPoolEdit, type PropertyPoolPreferences } from '../../core/property-value-pool';
import type { OperonSettings } from '../../types/settings';
import { settingsAsyncHandler } from './async-settings-action';

/** Each editable row is a native search target; mounted rows share one subscription. */
export function buildPropertyValuePoolSettings(getSettings: () => OperonSettings, save: (preferences: PropertyPoolPreferences, expected: unknown) => Promise<void>, resolveFavorite: (favorite: PropertyPoolFavorite) => PropertyPoolFavorite | null, subscribe?: (listener: () => void) => () => void, favoriteLabels = new Map<string, string>(), onSearchChanged?: () => void): SettingDefinitionGroup[] {
	let busy = false;
	let searchRefreshQueued = false;
	const refreshSearch = (): void => {
		if (searchRefreshQueued) return;
		searchRefreshQueued = true;
		queueMicrotask(() => { searchRefreshQueued = false; if (mounted.size) onSearchChanged?.(); });
	};
	let unsubscribe: (() => void) | undefined;
	const mounted = new Set<() => void>();
	const redraw = (): void => { for (const render of [...mounted]) render(); };
	const choices = (): Array<{ key: string; label: string }> => [
		{ key: '', label: t('settings', 'propertyPoolNoValue') },
		{ key: '@all', label: t('settings', 'propertyPoolAllValues') },
		{ key: '@favorites', label: t('settings', 'propertyPoolFavorites') },
		{ key: '@dates', label: t('settings', 'propertyPoolDates') },
		...propertyPoolFields(getSettings()).map(field => ({ ...field, key: propertyPoolScopeKey(field.key) })),
	];
	type Configure = (setting: Setting, preferences: PropertyPoolPreferences, commit: (edit: PropertyPoolEdit) => Promise<void>) => void;
	const row = (name: string, desc: string, configure: Configure): SettingDefinition => ({
		name, desc,
		render: setting => {
			let disposed = false;
			const render = (): void => {
				if (disposed) return;
				setting.controlEl.empty();
				setting.setName(name).setDesc(desc);
				const raw = getSettings().propertyValuePool;
				const { writable, preferences } = readPropertyPoolPreferences(raw);
				if (!writable) { setting.setDesc(t('settings', 'propertyPoolUnavailable')); return; }
				const commit = async (edit: PropertyPoolEdit): Promise<void> => {
					if (disposed || busy) return;
					busy = true;
					try { await save(editPropertyPoolPreferences(raw, edit), raw); }
					catch (error) { new Notice(t('settings', 'propertyPoolSaveFailed')); console.error('Operon: Property Value Pool settings save failed', error); }
					finally { busy = false; redraw(); }
				};
				configure(setting, preferences, commit);
			};
			render();
			mounted.add(render);
			if (mounted.size === 1) unsubscribe = subscribe?.(redraw);
			return () => {
				if (disposed) return;
				disposed = true;
				mounted.delete(render);
				if (!mounted.size) { unsubscribe?.(); unsubscribe = undefined; }
			};
		},
	});
	const { writable, preferences } = readPropertyPoolPreferences(getSettings().propertyValuePool);
	const shortcuts: SettingDefinition[] = [{ name: '', desc: t('settings', 'propertyPoolShortcutsDesc'), searchable: false }];
	const favorites: SettingDefinition[] = [{ name: '', desc: t('settings', 'propertyPoolFavoritesDesc'), searchable: false }];
	const groups: SettingDefinitionGroup[] = [
		{ type: 'group', heading: t('settings', 'propertyPoolShortcutsTitle'), items: shortcuts },
		{ type: 'group', heading: t('settings', 'propertyPoolFavoritesTitle'), items: favorites, visible: writable },
	];
	if (!writable) {
		shortcuts.push({ ...row('', t('settings', 'propertyPoolUnavailable'), () => {}), searchable: false });
		return groups;
	}
	for (const [index, shortcut] of preferences.shortcuts.entries()) {
		const label = choices().find(choice => choice.key === shortcut.key)?.label ?? shortcut.key;
		shortcuts.push(row(`${t('settings', 'propertyPoolShortcuts')} ${index + 1} — ${label}`, t('settings', 'propertyPoolShortcutRowDesc'), (setting, current, commit) => {
			const active = current.shortcuts[index];
			if (!active) return;
			setting.addDropdown(dropdown => {
				const options = choices();
				for (const choice of options) dropdown.addOption(choice.key, choice.label);
				if (!options.some(choice => choice.key === active.key)) dropdown.addOption(active.key, active.key);
				dropdown.setValue(active.key);
				dropdown.selectEl.setAttribute('aria-label', `${t('settings', 'propertyPoolShortcuts')} ${index + 1}`);
				for (const option of Array.from(dropdown.selectEl.options)) option.disabled = !!option.value && current.shortcuts.some((item, other) => other !== index && item.key === option.value);
				dropdown.onChange(settingsAsyncHandler('property pool shortcut selection', async key => {
					if (key && current.shortcuts.some((item, other) => other !== index && item.key === key)) return;
					await commit({ kind: 'shortcuts', shortcuts: current.shortcuts.map((item, position) => position === index ? { ...item, key } : item) });
				}));
			});
			setting.addToggle(toggle => toggle.setValue(active.visible).onChange(settingsAsyncHandler('property pool shortcut visibility', async visible => {
				await commit({ kind: 'shortcuts', shortcuts: current.shortcuts.map((item, position) => position === index ? { ...item, visible } : item) });
			})));
			for (const direction of [-1, 1]) setting.addExtraButton(button => button.setIcon(direction < 0 ? 'arrow-up' : 'arrow-down').setTooltip(t('settings', direction < 0 ? 'propertyPoolMoveUp' : 'propertyPoolMoveDown')).setDisabled(index + direction < 0 || index + direction >= current.shortcuts.length).onClick(settingsAsyncHandler('property pool shortcut order', async () => {
				const shortcuts = [...current.shortcuts];
				[shortcuts[index], shortcuts[index + direction]] = [shortcuts[index + direction], shortcuts[index]];
				await commit({ kind: 'shortcuts', shortcuts });
			})));
		}));
	}
	if (!preferences.favorites.length) favorites.push({ name: '', desc: t('settings', 'propertyPoolEmpty'), searchable: false });
	for (const favorite of preferences.favorites) {
		const resolved = resolvePropertyPoolFavorite(getSettings(), favorite);
		const favoriteId = propertyPoolFavoriteId(favorite);
		const field = propertyPoolFields(getSettings()).find(item => item.key === favorite.key);
		const label = (favorite.key === 'priority' || favorite.key === 'status' ? resolved?.label : favoriteLabels.get(favoriteId)) ?? resolved?.label ?? favorite.label;
		const name = favorite.type === 'date' ? label : `${field?.label ?? favorite.key} · ${label}`;
		const definition = row(name, t('settings', 'propertyPoolRemoveFavorite'), (setting, _current, commit) => {
			const currentValue = resolveFavorite(favorite);
			const currentLabel = currentValue?.label ?? favorite.label;
			const currentField = propertyPoolFields(getSettings()).find(item => item.key === favorite.key);
			const currentName = favorite.type === 'date' ? currentLabel : `${currentField?.label ?? favorite.key} · ${currentLabel}`;
			favoriteLabels.set(favoriteId, currentLabel);
			if (definition.name !== currentName) { definition.name = currentName; refreshSearch(); }
			setting.setName(currentName);
			setting.setDesc(currentValue ? '' : t('settings', 'propertyPoolValueUnavailable'));
			setting.addExtraButton(button => button.setIcon('star-off').setTooltip(t('settings', 'propertyPoolRemoveFavorite')).onClick(settingsAsyncHandler('property pool remove favorite', async () => { await commit({ kind: 'favorite', favorite, saved: false }); })));
			if (favorite.key === 'taskColor' || favorite.key === 'taskIcon') {
				setting.nameEl.addClass('operon-property-pool-favorite-name');
				renderPropertyPoolValueVisual(setting.nameEl, currentValue ?? favorite, field?.icon ?? 'text');
			}
		});
		favorites.push(definition);
	}
	const favoriteIds = new Set(preferences.favorites.map(propertyPoolFavoriteId));
	for (const key of favoriteLabels.keys()) if (!favoriteIds.has(key)) favoriteLabels.delete(key);
	return groups;
}
