export interface LightboxRect { left: number; top: number; width: number; height: number }
export interface NativeLightboxLayoutInput {
	viewport: { width: number; height: number };
	markdown: { width: number; height: number } | null;
	companion: { width: number; height: number } | null;
	side: 'left' | 'right';
	margin: number;
	railWidth: number;
	/** Keep the companion aligned with the source frame even while the source is hidden. */
	alignmentHeight?: number;
	/** Optional gutter for source-only controls on the opposite outer edge. */
	markdownOuterRailWidth?: number;
}
export interface NativeLightboxLayout {
	markdown: LightboxRect | null;
	companion: LightboxRect | null;
	rail: LightboxRect | null;
	fits: boolean;
}

/** Pure geometry: viewport clamping must never write a saved size preference. */
export function resolveNativeLightboxLayout(input: NativeLightboxLayoutInput): NativeLightboxLayout {
	const safe = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
	const width = safe(input.viewport.width), height = safe(input.viewport.height);
	const margin = safe(input.margin), railWidth = safe(input.railWidth);
	const availableWidth = Math.max(0, width - 2 * margin), availableHeight = Math.max(0, height - 2 * margin);
	const md = input.markdown, companion = input.companion;
	const outerRailWidth = safe(input.markdownOuterRailWidth ?? 0);
	const mdHeight = md ? Math.min(safe(md.height), availableHeight) : 0;
	const companionWidth = companion ? safe(companion.width) : 0;
	const alignmentHeight = md ? mdHeight : input.alignmentHeight === undefined ? null : Math.min(safe(input.alignmentHeight), availableHeight);
	const companionHeight = companion ? Math.min(safe(companion.height), alignmentHeight ?? availableHeight) : 0;
	const top = Math.max(0, (height - (alignmentHeight ?? companionHeight)) / 2);
	const companionLeft = input.side === 'left' ? margin : width - margin - companionWidth;
	const mdWidth = md ? Math.min(safe(md.width), Math.max(0, availableWidth - (companion ? companionWidth + railWidth + outerRailWidth : 2 * outerRailWidth))) : 0;
	const mdLeft = companion ? input.side === 'left' ? companionLeft + companionWidth + railWidth : companionLeft - railWidth - mdWidth : (width - mdWidth) / 2;
	return {
		markdown: md ? { left: mdLeft, top, width: mdWidth, height: mdHeight } : null,
		companion: companion ? { left: companionLeft, top, width: companionWidth, height: companionHeight } : null,
		rail: md && companion ? { left: input.side === 'left' ? companionLeft + companionWidth : companionLeft - railWidth, top, width: railWidth, height: mdHeight } : null,
		fits: !companion || availableWidth >= companionWidth + (md ? railWidth + outerRailWidth + 1 : 0),
	};
}
