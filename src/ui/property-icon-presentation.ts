import { getIcon, type App } from 'obsidian';
import { getWorkspaceWindows } from '../core/dom-compat';

const mountedIcons = new WeakMap<HTMLElement, { resolve: () => string; fallback?: string }>();
const renderedIcons = new WeakMap<HTMLElement, { icon: string; glyph: SVGSVGElement | null }>();

/** Repaint just the dedicated glyph host. The surrounding control keeps its focus and handlers. */
export function bindPropertyIcon(element: HTMLElement, resolve: () => string, fallback?: string): void {
	element.dataset.operonPropertyIcon = '';
	mountedIcons.set(element, { resolve, fallback });
	renderPropertyIcon(element, resolve(), fallback);
}

export function refreshMountedPropertyIcons(app: App): void {
	for (const window of getWorkspaceWindows(app)) {
		window.document.querySelectorAll<HTMLElement>('[data-operon-property-icon]').forEach(element => {
			const binding = mountedIcons.get(element);
			if (binding) renderPropertyIcon(element, binding.resolve(), binding.fallback);
		});
	}
}

function renderPropertyIcon(element: HTMLElement, icon: string, fallback?: string): void {
	const previous = renderedIcons.get(element);
	if (previous?.icon === icon && (previous.glyph === null || previous.glyph.parentElement === element)) return;
	previous?.glyph?.remove();
	const glyph = (icon ? getIcon(icon) : null) ?? (fallback ? getIcon(fallback) : null);
	if (glyph) element.appendChild(glyph);
	renderedIcons.set(element, { icon, glyph });
}
