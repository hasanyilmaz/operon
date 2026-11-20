import type { App, Component } from 'obsidian';
import { localToday } from './local-time';
import { getActiveWindow, getOwnerWindow, getWorkspaceWindows } from './dom-compat';

/** One local-day clock per owner. The timer stays attached to its originating window. */
export function registerFilterDayRefresh(owner: Component, refresh: () => void, clockWindow = getActiveWindow()): void {
	let day = localToday();
	const timer = clockWindow.setInterval(() => {
		const next = localToday();
		if (next === day) return;
		day = next;
		refresh();
	}, 30_000);
	owner.register(() => clockWindow.clearInterval(timer));
}

/** A single vault clock plus immediate wake-up when any workspace window returns. */
export function registerWorkspaceDayRefresh(owner: Component, app: App, wake: () => void): void {
	const win = getOwnerWindow(app.workspace.containerEl);
	registerFilterDayRefresh(owner, wake, win);
	const bound = new Set<Window>();
	const bind = (window: Window) => {
		if (bound.has(window)) return;
		bound.add(window);
		for (const event of ['focus', 'blur', 'pageshow']) window.addEventListener(event, wake);
		window.document.addEventListener('visibilitychange', wake);
	};
	const unbind = (window: Window) => {
		bound.delete(window);
		for (const event of ['focus', 'blur', 'pageshow']) window.removeEventListener(event, wake);
		window.document.removeEventListener('visibilitychange', wake);
	};
	for (const window of getWorkspaceWindows(app, win)) bind(window);
	owner.registerEvent(app.workspace.on('window-open', (_, window) => { bind(window); wake(); }));
	owner.registerEvent(app.workspace.on('window-close', (_, window) => { unbind(window); wake(); }));
	owner.register(() => { for (const window of bound) unbind(window); });
	wake();
}
