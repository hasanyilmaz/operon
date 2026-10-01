import type { SettingDefinitionItem } from 'obsidian';

/** Ownership only: this class must never carry visual declarations of its own. */
export const SETTINGS_SCOPE_CLASS = 'operon-settings-scope';

export function isSettingsScope(origin: Element | null | undefined): boolean {
	return !!origin?.closest('.' + SETTINGS_SCOPE_CLASS);
}

export function setSettingsScope(target: HTMLElement, enabled: boolean): void {
	target.classList.toggle(SETTINGS_SCOPE_CLASS, enabled);
}

/** Tag before opening; never move the modal or infer ownership from the active window. */
export function scopeSettingsModal<T extends { modalEl: HTMLElement }>(modal: T, origin: boolean | Element | null): T {
	setSettingsScope(modal.modalEl, typeof origin === 'boolean' ? origin : isSettingsScope(origin));
	return modal;
}

/** Decorate only fresh definitions; retain native controls and renderer cleanup results. */
export function scopeSettingsDefinitions(items: SettingDefinitionItem[]): SettingDefinitionItem[] {
	for (const item of items) {
		if ('type' in item) {
			if (item.type === 'group' || item.type === 'list') {
				const classes = new Set((item.cls ?? '').split(/\s+/).filter(Boolean));
				classes.add(SETTINGS_SCOPE_CLASS);
				item.cls = [...classes].join(' ');
			}
			if (item.items) scopeSettingsDefinitions(item.items);
		} else if (item.render) {
			const render = item.render;
			item.render = (setting, context) => {
				setSettingsScope(setting.settingEl, true);
				return render(setting, context);
			};
		}
	}
	return items;
}
