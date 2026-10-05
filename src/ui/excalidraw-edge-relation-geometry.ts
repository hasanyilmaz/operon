import type { ExcalidrawTaskElement } from './excalidraw-task-bridge';

export interface RelationArrow extends ExcalidrawTaskElement {
 points?: readonly (readonly [number, number])[];
 startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null;
}
export interface RelationPoint { x: number; y: number }
export interface RelationSvgLibrary {
 exportToSvg(options: { elements: ExcalidrawTaskElement[]; appState: Record<string, unknown>; files: Record<string, never>;
  exportPadding: number; skipInliningFonts: boolean; renderEmbeddables: boolean }): Promise<SVGSVGElement>;
 getCommonBounds(elements: ExcalidrawTaskElement[]): readonly number[];
}
export const relationFractions = [.2, .25, .35, .65, .75, .8] as const;
export type RelationRoute = ReadonlyMap<number, RelationPoint>;

export function relationArrowGeometryKey(arrow: RelationArrow): string {
 return JSON.stringify([arrow.x, arrow.y, arrow.width, arrow.height, arrow.angle, arrow.points, arrow.roundness,
  arrow.elbowed, arrow.fixedSegments, arrow.startIsSpecial, arrow.endIsSpecial]);
}

/** Follow a sharp route, including bends and rotation. Also retains the accepted menu midpoint. */
export function relationArrowPoint(arrow: RelationArrow, fraction: number): RelationPoint | null {
 const { points, x, y } = arrow, angle = arrow.angle ?? 0;
 if (typeof x !== 'number' || typeof y !== 'number' || ![x, y, angle].every(Number.isFinite)
  || !points || points.length < 2 || !points.every(point => point.length === 2 && point.every(Number.isFinite))) return null;
 const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
 let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction, at = points[0];
 for (let i = 0; i < lengths.length; i++) {
  if (remaining > lengths[i] && i < lengths.length - 1) { remaining -= lengths[i]; continue; }
  const ratio = lengths[i] ? Math.min(1, remaining / lengths[i]) : 0;
  at = [points[i][0] + (points[i + 1][0] - points[i][0]) * ratio, points[i][1] + (points[i + 1][1] - points[i][1]) * ratio];
  break;
 }
 const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
 const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
 return { x: x + cx + (at[0] - cx) * Math.cos(angle) - (at[1] - cy) * Math.sin(angle),
  y: y + cy + (at[0] - cx) * Math.sin(angle) + (at[1] - cy) * Math.cos(angle) };
}

/** No scene element is mutated or mounted: only the native, undecorated centerline is measured. */
export async function relationArrowRoute(arrow: RelationArrow, library?: RelationSvgLibrary): Promise<RelationRoute> {
 const route = new Map<number, RelationPoint>();
 if (!relationArrowPoint(arrow, .5)) return route;
 if (!arrow.roundness && !arrow.elbowed) {
  for (const fraction of relationFractions) route.set(fraction, relationArrowPoint(arrow, fraction)!);
  return route;
 }
 if (!library?.exportToSvg || !library.getCommonBounds) return route;
 // Normalize the origin just as native export restoration does, without sharing mutable point arrays.
 // Native dashed strokes disable RoughJS's duplicate sketch pass. Dashes affect paint only,
 // not SVG path length; measuring the complete path also retains every elbow segment.
 const first = arrow.points![0];
 const clone: RelationArrow = { ...arrow, x: arrow.x! + first[0], y: arrow.y! + first[1],
  points: arrow.points!.map(point => [point[0] - first[0], point[1] - first[1]]),
  boundElements: [], startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null,
  frameId: null, groupIds: [], link: null, customData: undefined, roughness: 0, strokeStyle: 'dashed',
  strokeColor: '#000000', backgroundColor: 'transparent', opacity: 100 };
 const bounds = library.getCommonBounds([clone]);
 if (bounds.length < 4 || !bounds.every(Number.isFinite)) return route;
 const svg = await library.exportToSvg({ elements: [clone], files: {}, exportPadding: 0, skipInliningFonts: true,
  renderEmbeddables: false, appState: { exportBackground: false, exportWithDarkMode: false, exportEmbedScene: false } });
 const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path')).filter(path => !path.closest('defs, mask, clipPath'));
 // A roughness-zero arrow without heads/label must have one centerline, not decorative fragments.
 if (paths.length !== 1) return route;
 const path = paths[0], length = path.getTotalLength();
 if (!Number.isFinite(length) || length <= 0) return route;
 let matrix = svg.createSVGMatrix();
 for (let node: Element | null = path; node && node !== svg; node = node.parentElement) {
  const transform = (node as SVGGraphicsElement).transform?.baseVal.consolidate();
  if (transform) matrix = transform.matrix.multiply(matrix);
 }
 for (const fraction of relationFractions) {
  const point = path.getPointAtLength(length * fraction);
  const x = matrix.a * point.x + matrix.c * point.y + matrix.e + bounds[0];
  const y = matrix.b * point.x + matrix.d * point.y + matrix.f + bounds[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return new Map();
  route.set(fraction, { x, y });
 }
 return route;
}
