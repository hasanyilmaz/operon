import type { App } from 'obsidian';
import type { OperonSettings } from '../types/settings';
import { parseLocationCoordinate } from './location-coordinates';

export type LocationPickerDefaults = Pick<OperonSettings, 'locationPickerMapDefaultCenter' | 'locationPickerMapDefaultZoom'>;
export type LocationPickerDefaultChange = { kind: 'center'; value: string } | { kind: 'zoom'; value: number };
interface Binding {
	get: () => LocationPickerDefaults;
	save: (change: LocationPickerDefaultChange) => Promise<void>;
}
const bindings = new WeakMap<App, Binding>();

export function normalizeLocationPickerDefault(change: LocationPickerDefaultChange): LocationPickerDefaultChange {
	if (change.kind === 'center') {
		const coordinate = parseLocationCoordinate(change.value);
		if (!coordinate) throw new Error('Invalid map center');
		return { kind: 'center', value: coordinate.canonical };
	}
	if (!Number.isFinite(change.value)) throw new Error('Invalid map zoom');
	return { kind: 'zoom', value: Math.round(Math.min(18, Math.max(1, change.value))) };
}

export function bindLocationPickerDefaults(app: App, binding: Binding): () => void {
	bindings.set(app, binding);
	return () => { if (bindings.get(app) === binding) bindings.delete(app); };
}

export function getLocationPickerDefaults(app: App): LocationPickerDefaults | undefined {
	return bindings.get(app)?.get();
}

export async function saveLocationPickerDefault(app: App, change: LocationPickerDefaultChange): Promise<void> {
	const binding = bindings.get(app);
	if (!binding) throw new Error('Location picker settings are unavailable');
	await binding.save(normalizeLocationPickerDefault(change));
}
