import { Menu, Notice, type App, type Component } from 'obsidian';
import { asHTMLElement, getOwnerWindow } from '../../core/dom-compat';
import { t } from '../../core/i18n';
import { parseLocationCoordinate } from '../../core/location-coordinates';
import { saveLocationPickerDefault } from '../../core/location-picker-defaults';
import { isRecord } from '../../core/unknown-value';

interface PickerMapView {
	type: 'map';
	mapEl: HTMLElement;
	map: {
		getZoom(): number;
		unproject(point: [number, number]): { lat: number; lng: number };
	};
	config: { getAsPropertyId(key: string): string | null };
	createFileForView(name: string, update: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	showMapContextMenu: (event: MouseEvent) => void;
}

// The renderer's component tree and Maps view are optional host internals.
// Never search outside our render owner or patch a plugin/global prototype.
export function findLocationPickerMap(root: Component, host: HTMLElement): PickerMapView | null {
	const pending: unknown[] = [root];
	const seen = new Set<object>();
	while (pending.length && seen.size < 128) {
		const entry = pending.shift();
		if (!isRecord(entry) || seen.has(entry)) continue;
		seen.add(entry);
		const element = asHTMLElement(entry.mapEl, host);
		if (entry.type === 'map' && element && host.contains(element)
			&& isRecord(entry.map) && typeof entry.map.getZoom === 'function' && typeof entry.map.unproject === 'function'
			&& isRecord(entry.config) && typeof entry.config.getAsPropertyId === 'function'
			&& typeof entry.createFileForView === 'function' && typeof entry.showMapContextMenu === 'function') {
			return entry as unknown as PickerMapView;
		}
		const children: unknown = entry._children;
		if (Array.isArray(children)) pending.push(...(children as unknown[]).slice(0, 128));
	}
	return null;
}

export function attachLocationPickerMapMenu(app: App, panel: HTMLElement, host: HTMLElement, owner: Component) {
	const win = getOwnerWindow(panel);
	let disposed = false;
	let busy = false;
	let menu: Menu | null = null;
	let retiring = false;
	let menuElements: HTMLElement[] = [];
	let retireTimer: number | null = null;
	const restores = new Map<PickerMapView, () => void>();
	const closeMenu = () => {
		const current = menu;
		menu = null;
		current?.hide();
	};
	const notify = (key: string) => { if (!disposed) new Notice(t('location', key)); };
	const run = (action: () => Promise<void>, success: string | null, failure: string) => {
		if (disposed || busy) return;
		busy = true;
		void Promise.resolve().then(action).then(() => { if (success) notify(success); }, error => {
			console.warn('Operon: location map action failed', error);
			notify(failure);
		}).finally(() => { busy = false; });
	};
	const show = (view: PickerMapView, event: MouseEvent) => {
		if (disposed || busy || !host.isConnected) return;
		try {
			const bounds = view.mapEl.getBoundingClientRect();
			const point = view.map.unproject([event.clientX - bounds.left, event.clientY - bounds.top]);
			const coordinate = parseLocationCoordinate(`${point.lat.toFixed(5)}, ${(((point.lng + 180) % 360 + 360) % 360 - 180).toFixed(5)}`);
			const zoom = view.map.getZoom();
			if (!coordinate || !Number.isFinite(zoom)) throw new Error('Map position unavailable');
			const property = view.config.getAsPropertyId('coordinates');
			closeMenu();
			if (retireTimer !== null) win.clearTimeout(retireTimer);
			retireTimer = null;
			retiring = false;
			const current = new Menu();
			menu = current;
			current.setUseNativeMenu(false);
			current.setParentElement(panel);
			const menuRoot = getMenuElement(Reflect.get(current, 'dom'));
			if (!menuRoot) throw new Error('Map menu DOM unavailable');
			menuElements = [menuRoot];
			// Obsidian places DOM menus in the document body, even with setParentElement.
			// Retain those viewport coordinates and raise only this menu above its owner.
			let level = 0;
			for (let ancestor: HTMLElement | null = panel; ancestor; ancestor = ancestor.parentElement) {
				level = Math.max(level, Number.parseInt(win.getComputedStyle(ancestor).zIndex, 10) || 0);
			}
			menuRoot.style.zIndex = String(level + 2);
			const background = getMenuElement(Reflect.get(current, 'bgEl'));
			if (background) background.style.zIndex = String(level + 1);
			current.onHide(() => {
				if (menu === current) menu = null;
				// Escape may hide the menu before the panel's document capture handler.
				retiring = true;
				if (retireTimer !== null) win.clearTimeout(retireTimer);
				retireTimer = win.setTimeout(() => { retiring = false; retireTimer = null; if (!menu) menuElements = []; }, 0);
			});
			current.addItem(item => item.setTitle(t('location', 'mapNewNote')).setIcon('square-pen').onClick(() => {
				run(() => view.createFileForView('', frontmatter => {
					if (property) {
						frontmatter[property.startsWith('note.') ? property.slice(5) : property] = [String(coordinate.lat), String(coordinate.lng)];
					}
				}), null, 'mapActionFailed');
			}));
			current.addItem(item => item.setTitle(t('location', 'mapCopyCoordinates')).setIcon('copy').onClick(() => {
				run(() => win.navigator.clipboard.writeText(coordinate.canonical), 'mapCoordinatesCopied', 'mapActionFailed');
			}));
			current.addItem(item => item.setTitle(t('location', 'mapSetCenter')).setIcon('map-pin').onClick(() => {
				run(() => saveLocationPickerDefault(app, { kind: 'center', value: coordinate.canonical }), 'mapDefaultsSaved', 'mapActionFailed');
			}));
			current.addItem(item => item.setTitle(t('location', 'mapSetZoom', { zoom: String(Math.round(Math.min(18, Math.max(1, zoom)))) })).setIcon('crosshair').onClick(() => {
				run(() => saveLocationPickerDefault(app, { kind: 'zoom', value: zoom }), 'mapDefaultsSaved', 'mapActionFailed');
			}));
			current.showAtMouseEvent(event);
		} catch (error) {
			console.warn('Operon: location map menu unavailable', error);
			closeMenu();
			notify('mapMenuUnavailable');
		}
	};
	const capture = (event: MouseEvent) => {
		try {
			const view = findLocationPickerMap(owner, host);
			if (!view) {
				event.preventDefault();
				event.stopPropagation();
				notify('mapMenuUnavailable');
				return;
			}
			if (!restores.has(view)) {
				const original = view.showMapContextMenu;
				const own = Object.prototype.hasOwnProperty.call(view, 'showMapContextMenu') === true;
				const handler = (e: MouseEvent) => show(view, e);
				if (!Reflect.set(view, 'showMapContextMenu', handler) || view.showMapContextMenu !== handler) {
					throw new Error('Map context menu is not writable');
				}
				restores.set(view, () => {
					if (view.showMapContextMenu !== handler) return;
					if (own) Reflect.set(view, 'showMapContextMenu', original);
					else Reflect.deleteProperty(view, 'showMapContextMenu');
				});
			}
		} catch (error) {
			console.warn('Operon: location map adapter unavailable', error);
			event.preventDefault();
			event.stopPropagation();
			notify('mapMenuUnavailable');
		}
	};
	host.addEventListener('contextmenu', capture, true);
	return {
		isOpen: () => menu !== null || retiring,
		elements: (): HTMLElement[] => menuElements,
		close: () => {
			disposed = true;
			closeMenu();
			if (retireTimer !== null) win.clearTimeout(retireTimer);
			retireTimer = null;
			retiring = false;
			menuElements = [];
			host.removeEventListener('contextmenu', capture, true);
			for (const restore of restores.values()) restore();
			restores.clear();
		},
	};
}

// A menu adopted by a popout retains its original window's HTMLElement prototype.
function getMenuElement(value: unknown): HTMLElement | null {
	if (!isRecord(value) || value.nodeType !== 1 || typeof value.contains !== 'function'
		|| !isRecord(value.style) || typeof value.style.setProperty !== 'function') return null;
	return value as unknown as HTMLElement;
}
