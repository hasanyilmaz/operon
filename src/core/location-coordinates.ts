export interface ParsedLocationCoordinate {
	lat: number;
	lng: number;
	canonical: string;
}

const COORDINATE_PATTERN = /^\s*\[?\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\]?\s*$/;

export function parseLocationCoordinate(value: unknown): ParsedLocationCoordinate | null {
	if (typeof value !== 'string') return null;
	const match = COORDINATE_PATTERN.exec(value);
	if (!match) return null;
	const lat = Number.parseFloat(match[1]);
	const lng = Number.parseFloat(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return {
		lat,
		lng,
		canonical: `${formatLocationCoordinateNumber(lat)}, ${formatLocationCoordinateNumber(lng)}`,
	};
}

export function formatLocationCoordinateNumber(value: number): string {
	if (!Number.isFinite(value)) return '0';
	return Number(value.toFixed(6)).toString();
}

export function formatShortLocationCoordinate(coordinate: ParsedLocationCoordinate): string {
	return `${formatLocationCoordinateNumber(coordinate.lat)}, ${formatLocationCoordinateNumber(coordinate.lng)}`;
}

export function coordinatesEquivalent(
	left: ParsedLocationCoordinate,
	right: ParsedLocationCoordinate,
	tolerance = 0.000001,
): boolean {
	return Math.abs(left.lat - right.lat) <= tolerance
		&& Math.abs(left.lng - right.lng) <= tolerance;
}
