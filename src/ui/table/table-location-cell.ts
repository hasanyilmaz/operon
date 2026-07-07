import { getIcon, type App } from 'obsidian';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../../core/location-coordinates';
import { getLocationPlaceIndex } from '../../core/location-source-resolver';
import { normalizeTaskFieldColor } from '../../core/task-color-source';
import { normalizeTaskIconValue } from '../../core/task-icon-value';
import type { IndexedTask } from '../../types/fields';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, type OperonSettings } from '../../types/settings';
import { getTableTaskField } from './table-field-catalog';

type TableLocationIndexSettings = Pick<
	OperonSettings,
	'keyMappings' | 'locationPlaceIconPropertyName' | 'locationPlaceColorPropertyName'
>;

type TableLocationDisplaySettings = Pick<OperonSettings, 'keyMappings'>;

export interface TableLocationCellMatch {
	label: string;
	path: string;
	taskIcon?: string | null;
	taskColor?: string | null;
}

export type TableLocationCellResolver = (coordinateText: string) => TableLocationCellMatch | null;

export interface TableLocationCellVisual {
	label: string;
	icon: string;
	coordinate: string;
	taskColor: string | null;
	markerIcon: string | null;
	markerColor: string | null;
	path: string | null;
}

export interface TableLocationCellVisualOptions {
	settings?: TableLocationDisplaySettings;
	task?: IndexedTask;
	locationResolver?: TableLocationCellResolver | null;
}

export function shouldResolveTableLocationCells(columns: readonly { key: string }[]): boolean {
	return columns.some(column => column.key === 'location');
}

export function getTableLocationCellResolver(
	app: App,
	settings: TableLocationIndexSettings,
	columns: readonly { key: string }[],
): TableLocationCellResolver | null {
	if (!shouldResolveTableLocationCells(columns)) return null;
	return getLocationPlaceIndex(app, settings).resolve;
}

export function buildTableLocationCellIndexSignature(
	app: App,
	settings: TableLocationIndexSettings,
	columns: readonly { key: string }[],
): string {
	if (!shouldResolveTableLocationCells(columns)) return '';
	return getLocationPlaceIndex(app, settings).getSignature();
}

export function resolveTableLocationCellVisual(
	key: string,
	value: string,
	options: TableLocationCellVisualOptions,
): TableLocationCellVisual | null {
	if (key !== 'location') return null;
	const coordinate = parseLocationCoordinate(value);
	if (!coordinate) return null;
	const match = options.locationResolver?.(coordinate.canonical) ?? null;
	const fallbackIcon = resolveTableLocationFallbackIcon(options.settings);
	const taskColor = normalizeTaskFieldColor(options.task?.fieldValues['taskColor']);
	const taskIcon = normalizeTaskIconValue(options.task?.fieldValues['taskIcon']) || null;
	return {
		label: match?.label ?? formatShortLocationCoordinate(coordinate),
		icon: resolveTableLocationIcon(match?.taskIcon, fallbackIcon),
		coordinate: coordinate.canonical,
		taskColor: match?.taskColor ?? taskColor,
		markerIcon: match ? match.taskIcon ?? null : taskIcon,
		markerColor: match?.taskColor ?? null,
		path: match?.path ?? null,
	};
}

function resolveTableLocationFallbackIcon(settings: TableLocationDisplaySettings | undefined): string {
	return settings
		? getTableTaskField('location', settings)?.icon ?? INLINE_TASK_COMPACT_FALLBACK_ICONS.location
		: INLINE_TASK_COMPACT_FALLBACK_ICONS.location;
}

function resolveTableLocationIcon(value: string | null | undefined, fallbackIcon: string): string {
	const icon = value?.trim();
	if (!icon) return fallbackIcon;
	return getIcon(icon) ? icon : fallbackIcon;
}
