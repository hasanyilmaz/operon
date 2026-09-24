import type { Component } from 'obsidian';
import { localToday } from './local-time';
import { clearWindowInterval, setWindowInterval } from './dom-compat';

/** A view-local clock invalidates relative dates; never writes settings or task data. */
export function registerFilterDayRefresh(owner: Component, refresh: () => void): void {
	let day = localToday();
	const timer = setWindowInterval(() => {
		const next = localToday();
		if (next === day) return;
		day = next;
		refresh();
	}, 30_000);
	owner.register(() => clearWindowInterval(timer));
}
