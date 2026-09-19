import { setIcon } from 'obsidian';
import { normalizeColorPaletteHex } from '../core/color-palette';
import type { PropertyPoolFavorite } from '../core/property-value-pool';

/** Only validated colors reach CSS; the stored value never comes from presentation. */
export function renderPropertyPoolValueVisual(host: HTMLElement, value: PropertyPoolFavorite, fallbackIcon: string): void {
	const color = value.key === 'taskColor' ? normalizeColorPaletteHex(value.value) : null;
	if (color) {
		const swatch = host.createSpan('operon-property-pool-color-swatch');
		swatch.style.setProperty('--operon-property-pool-color', color);
		swatch.setAttribute('aria-hidden', 'true');
	} else {
		setIcon(host.createSpan('operon-canvas-property-pool-value-icon'), value.key === 'taskIcon' ? value.value : fallbackIcon);
	}
}
