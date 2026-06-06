import { App } from 'obsidian';
import { parseLocationCoordinate, ParsedLocationCoordinate } from './location-coordinates';
import {
	resolveLocationPropertyName,
	resolveLocationPlaceColorPropertyNames,
	resolveLocationPlaceIconPropertyNames,
} from './location-source-resolver';
import { getConfiguredKeyMappingIcon } from './key-mapping-icons';
import { OperonSettings } from '../types/settings';

const OPENFREEMAP_LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

interface ObsidianPluginsRegistry {
	enabledPlugins?: { has(id: string): boolean };
	getPlugin?: (id: string) => unknown;
}

export interface LocationPreviewBaseOptions {
	settings: Pick<OperonSettings,
		| 'keyMappings'
		| 'locationMapsAlwaysLightMode'
		| 'locationPlaceIconPropertyName'
		| 'locationPlaceColorPropertyName'
	>;
	coordinate: ParsedLocationCoordinate;
	height: number;
	defaultZoom: number;
	minZoom: number;
	maxZoom: number;
	markerIcon?: string | null;
	markerColor?: string | null;
	placePath?: string | null;
	taskDescription?: string | null;
}

export interface LocationPickerBaseOptions {
	settings: Pick<OperonSettings,
		| 'keyMappings'
		| 'locationMapsAlwaysLightMode'
		| 'locationPlaceIconPropertyName'
		| 'locationPlaceColorPropertyName'
		| 'locationPickerMapDefaultCenter'
		| 'locationPickerMapDefaultZoom'
	>;
	height?: number;
}

export function isMapsPluginEnabled(app: App): boolean {
	const plugins = (app as unknown as { plugins?: ObsidianPluginsRegistry }).plugins;
	return plugins?.enabledPlugins?.has('maps') === true || !!plugins?.getPlugin?.('maps');
}

export function buildLocationPreviewBaseMarkdown(options: LocationPreviewBaseOptions): string {
	const { coordinate } = options;
	const height = clampInteger(options.height, 100, 2000, 400);
	const minZoom = clampInteger(options.minZoom, 0, 24, 12);
	const maxZoom = Math.max(minZoom, clampInteger(options.maxZoom, 1, 24, 18));
	const defaultZoom = Math.min(
		Math.max(clampInteger(options.defaultZoom, 1, 22, 15), minZoom),
		maxZoom,
	);
	const coordinateExpression = `[${coordinate.lat}, ${coordinate.lng}]`;
	const markerIcon = options.markerIcon?.trim();
	const markerColor = options.markerColor?.trim();
	const placePath = options.placePath?.trim();
	const taskDescription = options.taskDescription?.trim();
	const propertyName = resolveLocationPropertyName(options.settings.keyMappings);
	const lines = [
		'```base',
		'filters:',
		'  and:',
	];
	if (placePath) {
		const markerIconReference = resolveMarkerBasePropertyReference(
			resolveLocationPlaceIconPropertyNames(options.settings),
			'OperonLocationMarkerIcon',
			resolveLocationMarkerFallbackIcon(options.settings),
		);
		const markerColorReference = resolveMarkerBasePropertyReference(
			resolveLocationPlaceColorPropertyNames(options.settings),
			'OperonLocationMarkerColor',
		);
		lines.push(`    - file.hasProperty("${escapeDoubleQuotedString(propertyName)}")`);
		appendMarkerFormulaLines(lines, [markerIconReference, markerColorReference]);
		lines.push(
			'views:',
			'  - type: map',
			'    name: Location',
			'    order:',
			'      - file.name',
		);
		appendMarkerOrderLines(lines, [markerIconReference, markerColorReference]);
		lines.push(
			'    columnSize:',
			'      file.name: 220',
			`    coordinates: ${formatBasePropertyReference(propertyName)}`,
		);
		if (markerIcon || markerIconReference.reference) {
			lines.push(`    markerIcon: ${markerIconReference.reference}`);
		}
		if (markerColor || markerColorReference.reference) {
			lines.push(`    markerColor: ${markerColorReference.reference}`);
		}
	} else {
		const placeMarkerIconReference = resolveMarkerBasePropertyReference(
			resolveLocationPlaceIconPropertyNames(options.settings),
			'OperonLocationPlaceMarkerIcon',
			resolveLocationMarkerFallbackIcon(options.settings),
		);
		const placeMarkerColorReference = resolveMarkerBasePropertyReference(
			resolveLocationPlaceColorPropertyNames(options.settings),
			'OperonLocationPlaceMarkerColor',
		);
		const coordinateReference: MarkerBasePropertyReference = {
			reference: 'formula.OperonLocation',
			formulaLine: buildCurrentFileOverrideFormulaLine(
				'OperonLocation',
				coordinateExpression,
				formatBasePropertyReference(propertyName),
			),
		};
		const titleReference = resolveCurrentFileOverrideBasePropertyReference(
			'OperonLocationTitle',
			taskDescription || coordinate.canonical,
			'file.name',
		);
		const markerIconReference = resolveCurrentFileOverrideBasePropertyReference(
			'OperonLocationMarkerIcon',
			markerIcon || resolveLocationMarkerFallbackIcon(options.settings),
			placeMarkerIconReference.reference,
		);
		const markerColorReference = resolveCurrentFileOverrideBasePropertyReference(
			'OperonLocationMarkerColor',
			markerColor || '',
			placeMarkerColorReference.reference,
		);
		lines.push(
			'    - or:',
			`        - file.hasProperty("${escapeDoubleQuotedString(propertyName)}")`,
			'        - file.path == this.file.path',
		);
		appendMarkerFormulaLines(lines, [
			placeMarkerIconReference,
			placeMarkerColorReference,
			coordinateReference,
			titleReference,
			markerIconReference,
			markerColorReference,
		]);
		lines.push(
			'views:',
			'  - type: map',
			'    name: Location',
			'    order:',
			`      - ${titleReference.reference}`,
		);
		appendMarkerOrderLines(lines, [markerIconReference, markerColorReference]);
		lines.push(
			'    columnSize:',
			'      file.name: 220',
			'    coordinates: formula.OperonLocation',
			`    markerIcon: ${markerIconReference.reference}`,
		);
		if (markerColorReference.reference) {
			lines.push(`    markerColor: ${markerColorReference.reference}`);
		}
	}
	appendAlwaysLightMapTileConfig(lines, options.settings.locationMapsAlwaysLightMode);
	lines.push(
		`    mapHeight: ${height}`,
		`    center: "${coordinateExpression}"`,
		`    defaultZoom: ${defaultZoom}`,
		`    minZoom: ${minZoom}`,
		`    maxZoom: ${maxZoom}`,
		'```',
	);
	return lines.join('\n');
}

export function buildLocationPickerBaseMarkdown(options: LocationPickerBaseOptions): string {
	const propertyName = resolveLocationPropertyName(options.settings.keyMappings);
	const markerIconReference = resolveMarkerBasePropertyReference(
		resolveLocationPlaceIconPropertyNames(options.settings),
		'OperonLocationMarkerIcon',
		resolveLocationMarkerFallbackIcon(options.settings),
	);
	const markerColorReference = resolveMarkerBasePropertyReference(
		resolveLocationPlaceColorPropertyNames(options.settings),
		'OperonLocationMarkerColor',
	);
	const center = parseLocationCoordinate(options.settings.locationPickerMapDefaultCenter);
	const height = clampInteger(options.height ?? 300, 100, 2000, 300);
	const defaultZoom = clampInteger(options.settings.locationPickerMapDefaultZoom, 1, 18, 7);
	const lines = [
		'```base',
		'filters:',
		'  and:',
		`    - file.hasProperty("${escapeDoubleQuotedString(propertyName)}")`,
	];
	appendMarkerFormulaLines(lines, [markerIconReference, markerColorReference]);
	lines.push(
		'views:',
		'  - type: map',
		'    name: Location Picker',
		'    order:',
		'      - file.name',
	);
	appendMarkerOrderLines(lines, [markerIconReference, markerColorReference]);
	lines.push(
		'    columnSize:',
		'      file.name: 220',
		`    coordinates: ${formatBasePropertyReference(propertyName)}`,
		`    markerIcon: ${markerIconReference.reference}`,
		`    markerColor: ${markerColorReference.reference}`,
	);
	appendAlwaysLightMapTileConfig(lines, options.settings.locationMapsAlwaysLightMode);
	lines.push(
		`    mapHeight: ${height}`,
		`    defaultZoom: ${defaultZoom}`,
	);
	if (center) {
		lines.push(`    center: "[${center.lat}, ${center.lng}]"`);
	}
	lines.push('```');
	return lines.join('\n');
}

interface MarkerBasePropertyReference {
	reference: string;
	formulaLine: string | null;
}

function resolveMarkerBasePropertyReference(
	propertyNames: readonly string[],
	formulaName: string,
	literalFallback = '',
): MarkerBasePropertyReference {
	const uniquePropertyNames = uniqueNonEmptyStrings(propertyNames);
	const fallback = literalFallback.trim();
	if (uniquePropertyNames.length === 0 && !fallback) return { reference: '', formulaLine: null };
	if (uniquePropertyNames.length === 1 && !fallback) {
		return { reference: formatBasePropertyReference(uniquePropertyNames[0]), formulaLine: null };
	}
	const expression = buildMarkerFallbackExpression(uniquePropertyNames, fallback);
	return {
		reference: `formula.${formulaName}`,
		formulaLine: `  ${formulaName}: ${expression}`,
	};
}

function resolveCurrentFileOverrideBasePropertyReference(
	formulaName: string,
	currentFileValue: string,
	fallbackExpression: string,
): MarkerBasePropertyReference {
	const current = currentFileValue.trim();
	const fallback = fallbackExpression.trim();
	if (!current && !fallback) return { reference: '', formulaLine: null };
	if (!current) return { reference: fallback, formulaLine: null };
	return {
		reference: `formula.${formulaName}`,
		formulaLine: buildCurrentFileOverrideFormulaLine(formulaName, current, fallback),
	};
}

function buildCurrentFileOverrideFormulaLine(
	formulaName: string,
	currentFileValue: string,
	fallbackExpression: string,
): string {
	const fallback = fallbackExpression.trim() || '""';
	const escapedCurrentValue = escapeDoubleQuotedString(currentFileValue);
	return `  ${formulaName}: if(file.path == this.file.path, "${escapedCurrentValue}", ${fallback})`;
}

function appendMarkerFormulaLines(lines: string[], references: readonly MarkerBasePropertyReference[]): void {
	const formulaLines = references
		.map(reference => reference.formulaLine)
		.filter((line): line is string => !!line);
	if (formulaLines.length === 0) return;
	lines.push('formulas:', ...formulaLines);
}

function appendMarkerOrderLines(lines: string[], references: readonly MarkerBasePropertyReference[]): void {
	for (const reference of references) {
		if (!reference.formulaLine) continue;
		lines.push(`      - ${reference.reference}`);
	}
}

function buildMarkerFallbackExpression(propertyNames: readonly string[], literalFallback: string): string {
	let expression = literalFallback
		? `"${escapeDoubleQuotedString(literalFallback)}"`
		: '';
	for (const propertyName of [...propertyNames].reverse()) {
		const reference = formatBasePropertyReference(propertyName);
		expression = expression
			? `if(${reference}, ${reference}, ${expression})`
			: reference;
	}
	return expression;
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed && !result.includes(trimmed)) result.push(trimmed);
	}
	return result;
}

function resolveLocationMarkerFallbackIcon(settings: Pick<OperonSettings, 'keyMappings'>): string {
	return getConfiguredKeyMappingIcon('location', settings.keyMappings) || 'map-pin';
}

function formatBasePropertyReference(propertyName: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(propertyName)) {
		return `note.${propertyName}`;
	}
	return `note["${escapeDoubleQuotedString(propertyName)}"]`;
}

function escapeDoubleQuotedString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function appendAlwaysLightMapTileConfig(lines: string[], enabled: boolean): void {
	if (!enabled) return;
	lines.push(
		`    mapTiles: "${OPENFREEMAP_LIGHT_STYLE_URL}"`,
		`    mapTilesDark: "${OPENFREEMAP_LIGHT_STYLE_URL}"`,
	);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.round(Math.min(Math.max(value, min), max));
}
