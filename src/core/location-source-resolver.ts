import { App, TFile } from 'obsidian';
import { parseLocationCoordinate, coordinatesEquivalent, ParsedLocationCoordinate } from './location-coordinates';
import { KeyMapping, OperonSettings } from '../types/settings';
import { normalizeTaskFieldColor } from './task-color-source';

export interface LocationPlaceSource {
	file: TFile;
	path: string;
	basename: string;
	propertyName: string;
	coordinate: ParsedLocationCoordinate;
	rawValue: string;
	taskIcon: string | null;
	taskColor: string | null;
}

export interface LocationPlaceMatch {
	label: string;
	path: string;
	coordinate: ParsedLocationCoordinate;
	taskIcon: string | null;
	taskColor: string | null;
}

export interface LocationPlaceIndex {
	resolve: (rawCoordinate: string) => LocationPlaceMatch | null;
	getSources: () => readonly LocationPlaceSource[];
	getSignature: () => string;
}

export function resolveLocationPropertyName(keyMappings: KeyMapping[]): string {
	return resolveMappedPropertyName(keyMappings, 'location');
}

type LocationPlaceVisualSettings = Pick<OperonSettings,
	| 'keyMappings'
	| 'locationPlaceIconPropertyName'
	| 'locationPlaceColorPropertyName'
>;

interface LocationPlaceIndexState {
	revision: number;
	cache: LocationPlaceIndexCache | null;
}

interface LocationPlaceIndexCache {
	settingsSignature: string;
	revision: number;
	globalRevision: number;
	index: LocationPlaceIndex;
}

const locationPlaceIndexStates = new WeakMap<App, LocationPlaceIndexState>();
let globalLocationPlaceIndexRevision = 0;

function resolveMappedPropertyName(keyMappings: KeyMapping[], canonicalKey: string): string {
	const mapping = keyMappings.find(candidate => candidate.canonicalKey === canonicalKey);
	const visibleName = mapping?.visiblePropertyName?.trim();
	return visibleName || canonicalKey;
}

export function resolveLocationTaskIconPropertyName(keyMappings: KeyMapping[]): string {
	return resolveMappedPropertyName(keyMappings, 'taskIcon');
}

export function resolveLocationTaskColorPropertyName(keyMappings: KeyMapping[]): string {
	return resolveMappedPropertyName(keyMappings, 'taskColor');
}

export function resolveLocationPlaceIconPropertyNames(settings: LocationPlaceVisualSettings): string[] {
	return resolveLocationPlaceVisualPropertyNames(
		settings.locationPlaceIconPropertyName,
		resolveLocationTaskIconPropertyName(settings.keyMappings),
	);
}

export function resolveLocationPlaceColorPropertyNames(settings: LocationPlaceVisualSettings): string[] {
	return resolveLocationPlaceVisualPropertyNames(
		settings.locationPlaceColorPropertyName,
		resolveLocationTaskColorPropertyName(settings.keyMappings),
	);
}

export function collectLocationPlaceSources(
	app: App,
	settings: LocationPlaceVisualSettings,
): LocationPlaceSource[] {
	const propertyName = resolveLocationPropertyName(settings.keyMappings);
	const taskIconPropertyNames = resolveLocationPlaceIconPropertyNames(settings);
	const taskColorPropertyNames = resolveLocationPlaceColorPropertyNames(settings);
	const appLike = app as Partial<App>;
	const files = appLike.vault?.getMarkdownFiles?.() ?? [];
	const sources: LocationPlaceSource[] = [];

	for (const file of files) {
		const frontmatter = appLike.metadataCache?.getFileCache(file)?.frontmatter;
		if (!frontmatter || !(propertyName in frontmatter)) continue;
		const rawValue = stringifyCoordinatePropertyValue(frontmatter[propertyName]);
		const coordinate = parseLocationCoordinate(rawValue);
		if (!coordinate) continue;
		sources.push({
			file,
			path: file.path,
			basename: file.basename,
			propertyName,
			coordinate,
			rawValue,
			taskIcon: readFirstTextPropertyValue(frontmatter, taskIconPropertyNames),
			taskColor: readFirstColorPropertyValue(frontmatter, taskColorPropertyNames),
		});
	}

	return sources.sort(compareLocationPlaceSources);
}

export function getLocationPlaceIndex(
	app: App,
	settings: LocationPlaceVisualSettings,
): LocationPlaceIndex {
	const state = getLocationPlaceIndexState(app);
	const settingsSignature = buildLocationPlaceSettingsSignature(settings);
	const cached = state.cache;
	if (
		cached
		&& cached.settingsSignature === settingsSignature
		&& cached.revision === state.revision
		&& cached.globalRevision === globalLocationPlaceIndexRevision
	) {
		return cached.index;
	}

	const index = buildLocationPlaceIndex(
		app,
		settings,
		settingsSignature,
		state.revision,
		globalLocationPlaceIndexRevision,
	);
	state.cache = {
		settingsSignature,
		revision: state.revision,
		globalRevision: globalLocationPlaceIndexRevision,
		index,
	};
	return index;
}

export function invalidateLocationPlaceIndex(app?: App): void {
	if (!app) {
		globalLocationPlaceIndexRevision += 1;
		return;
	}
	const state = getLocationPlaceIndexState(app);
	state.revision += 1;
	state.cache = null;
}

export function findLocationPlaceMatch(
	app: App,
	settings: LocationPlaceVisualSettings,
	rawCoordinate: string,
): LocationPlaceMatch | null {
	return createLocationPlaceMatcher(app, settings)(rawCoordinate);
}

export function createLocationPlaceMatcher(
	app: App,
	settings: LocationPlaceVisualSettings,
): (rawCoordinate: string) => LocationPlaceMatch | null {
	return getLocationPlaceIndex(app, settings).resolve;
}

export function findLocationPlaceMatchInSources(
	sources: readonly LocationPlaceSource[],
	rawCoordinate: string,
): LocationPlaceMatch | null {
	const coordinate = parseLocationCoordinate(rawCoordinate);
	if (!coordinate) return null;
	const match = sources.find(source => coordinatesEquivalent(source.coordinate, coordinate));
	if (!match) return null;
	return {
		label: match.basename,
		path: match.path,
		coordinate: match.coordinate,
		taskIcon: match.taskIcon,
		taskColor: match.taskColor,
	};
}

function getLocationPlaceIndexState(app: App): LocationPlaceIndexState {
	const existing = locationPlaceIndexStates.get(app);
	if (existing) return existing;
	const state: LocationPlaceIndexState = {
		revision: 0,
		cache: null,
	};
	locationPlaceIndexStates.set(app, state);
	return state;
}

function buildLocationPlaceIndex(
	app: App,
	settings: LocationPlaceVisualSettings,
	settingsSignature: string,
	revision: number,
	globalRevision: number,
): LocationPlaceIndex {
	const sources = collectLocationPlaceSources(app, settings);
	const byCanonicalCoordinate = new Map<string, LocationPlaceSource>();
	for (const source of sources) {
		if (!byCanonicalCoordinate.has(source.coordinate.canonical)) {
			byCanonicalCoordinate.set(source.coordinate.canonical, source);
		}
	}
	const resolvedMatches = new Map<string, LocationPlaceMatch | null>();
	const signature = buildLocationPlaceIndexSignature(settingsSignature, sources, revision, globalRevision);
	return {
		resolve(rawCoordinate: string): LocationPlaceMatch | null {
			const coordinate = parseLocationCoordinate(rawCoordinate);
			if (!coordinate) return null;
			if (resolvedMatches.has(coordinate.canonical)) {
				return resolvedMatches.get(coordinate.canonical) ?? null;
			}
			const source = byCanonicalCoordinate.get(coordinate.canonical)
				?? sources.find(candidate => coordinatesEquivalent(candidate.coordinate, coordinate))
				?? null;
			const match = source ? locationPlaceSourceToMatch(source) : null;
			resolvedMatches.set(coordinate.canonical, match);
			return match;
		},
		getSources: () => sources,
		getSignature: () => signature,
	};
}

function locationPlaceSourceToMatch(source: LocationPlaceSource): LocationPlaceMatch {
	return {
		label: source.basename,
		path: source.path,
		coordinate: source.coordinate,
		taskIcon: source.taskIcon,
		taskColor: source.taskColor,
	};
}

function buildLocationPlaceSettingsSignature(settings: LocationPlaceVisualSettings): string {
	return JSON.stringify({
		locationPropertyName: resolveLocationPropertyName(settings.keyMappings),
		iconPropertyNames: resolveLocationPlaceIconPropertyNames(settings),
		colorPropertyNames: resolveLocationPlaceColorPropertyNames(settings),
	});
}

function buildLocationPlaceIndexSignature(
	settingsSignature: string,
	sources: readonly LocationPlaceSource[],
	revision: number,
	globalRevision: number,
): string {
	return JSON.stringify({
		settingsSignature,
		revision,
		globalRevision,
		sourceCount: sources.length,
		sourceHash: hashLocationPlaceSources(sources),
	});
}

function hashLocationPlaceSources(sources: readonly LocationPlaceSource[]): string {
	let hash = 2166136261;
	const append = (value: string): void => {
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= 31;
		hash = Math.imul(hash, 16777619);
	};
	for (const source of sources) {
		append(source.path);
		append(source.basename);
		append(source.coordinate.canonical);
		append(source.taskIcon ?? '');
		append(source.taskColor ?? '');
	}
	return (hash >>> 0).toString(36);
}

function stringifyCoordinatePropertyValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		if (value.length >= 2) return `${String(value[0])}, ${String(value[1])}`;
		return value.map(item => String(item)).join(', ');
	}
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return '';
}

function stringifyTextPropertyValue(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed || null;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const text = stringifyTextPropertyValue(item);
			if (text) return text;
		}
	}
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return null;
}

function readFirstTextPropertyValue(frontmatter: Record<string, unknown>, propertyNames: readonly string[]): string | null {
	for (const propertyName of propertyNames) {
		const value = stringifyTextPropertyValue(frontmatter[propertyName]);
		if (value) return value;
	}
	return null;
}

function readFirstColorPropertyValue(frontmatter: Record<string, unknown>, propertyNames: readonly string[]): string | null {
	for (const propertyName of propertyNames) {
		const color = normalizeTaskFieldColor(stringifyTextPropertyValue(frontmatter[propertyName]));
		if (color) return color;
	}
	return null;
}

function resolveLocationPlaceVisualPropertyNames(primaryName: string, fallbackName: string): string[] {
	const names: string[] = [];
	for (const candidate of [primaryName, fallbackName]) {
		const trimmed = candidate.trim();
		if (trimmed && !names.includes(trimmed)) names.push(trimmed);
	}
	return names;
}

function compareLocationPlaceSources(left: LocationPlaceSource, right: LocationPlaceSource): number {
	return left.basename.localeCompare(right.basename, undefined, { sensitivity: 'base' })
		|| left.path.localeCompare(right.path, undefined, { sensitivity: 'base' });
}
