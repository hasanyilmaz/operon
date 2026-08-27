import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import type { OperonSettings } from '../../types/settings';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import { resolveTaskColorSourceForTask } from '../../core/task-color-source';
import { localToday } from '../../core/local-time';
import { getConfiguredKeyMappingIcon } from '../../core/key-mapping-icons';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	buildGanttDateAxis,
	ganttDateToX,
	ganttXToDate,
	ganttDateKeyToOrdinal,
	ganttOrdinalToDateKey,
	projectTaskToGantt,
} from '../../systems/gantt-core';
import type {
	GanttDateAxis,
	GanttDateMarker,
	GanttDateMarkerKey,
	GanttScale,
	GanttTaskProjection,
} from '../../types/gantt';
import type { IndexedTask } from '../../types/fields';
import { resolveTableGanttVisibility, type TableGanttSettings } from '../../types/table';
import type { TableTaskTreeRenderItem } from './table-task-tree';
import {
	resolveTableRandomColumnColor,
} from './table-column-color';
import {
	getTableGanttLaneClassName,
	type TableVirtualRange,
} from './table-gantt-split';
import {
	resolveTableGanttDependencyConnectors,
	type TableGanttDependencyConnector,
	type TableGanttDependencyEdge,
	type TableGanttDependencyOccurrence,
} from './table-gantt-dependencies';
import { TableGanttTaskModelCache } from './table-gantt-model-cache';
import type { TableGanttInteractionController } from './table-gantt-interaction';
import { getTableTaskFieldLabel } from './table-field-catalog';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import type { TableScrollPerformanceRecorder } from './table-scroll-performance';
import {
	createTableVirtualRowCache,
	orderTableVirtualRowElements,
	reconcileTableVirtualRows,
	resolveTableVirtualRowKey,
	type TableVirtualRowCache,
} from './table-virtual-row-reconciler';

export const TABLE_GANTT_HEADER_HEIGHT_PX = 35;
export const TABLE_GANTT_BAR_HEIGHT_PX = 26;
export const TABLE_GANTT_MIN_AXIS_WIDTH_PX = 1200;

const TABLE_GANTT_DATE_MARKER_FALLBACK_ICONS: Readonly<Record<GanttDateMarkerKey, string>> = {
	dateStarted: 'plane-takeoff',
	dateScheduled: 'calendar-cog',
	dateDue: 'calendar-clock',
};

const TABLE_GANTT_BASE_DAY_WIDTH_PX: Readonly<Record<GanttScale, number>> = {
	day: 48,
	week: 20,
	month: 6,
};

type GanttRenderableTaskItem = Extract<
	TableTaskTreeRenderItem,
	{ kind: 'task' | 'parentContext' }
>;

export interface GanttHorizontalRange {
	visibleStartIndex: number;
	visibleEndIndex: number;
	startIndex: number;
	endIndex: number;
}

export interface GanttTimelineLayout {
	axis: GanttDateAxis;
	today: string;
	showToday: boolean;
	showWeekends: boolean;
	viewportWidth: number;
	earliestTaskDate: string | null;
	projections: ReadonlyMap<string, GanttTaskProjection>;
	dependencyEdges: readonly TableGanttDependencyEdge[];
}

export interface BuildTableGanttTimelineLayoutOptions {
	items: readonly TableTaskTreeRenderItem[];
	gantt: TableGanttSettings;
	calendarWeekStart: 'monday' | 'sunday';
	globalShowToday: boolean;
	globalShowWeekends: boolean;
	viewportWidth: number;
	today?: string;
	anchorDate?: string | null;
	modelCache?: TableGanttTaskModelCache;
	performanceRecorder?: TableScrollPerformanceRecorder;
}

export interface TableGanttRenderOptions {
	headerEl: HTMLElement;
	canvasEl: HTMLElement;
	items: readonly TableTaskTreeRenderItem[];
	verticalRange: TableVirtualRange;
	rowHeight: number;
	layout: GanttTimelineLayout;
	scrollLeft: number;
	locale: string;
	gantt: TableGanttSettings;
	settings: Pick<OperonSettings,
		| 'colorPalette'
		| 'keyMappings'
		| 'pipelines'
		| 'priorities'
		| 'tableGanttBarClickAction'
		| 'tableGanttBarRightClickAction'
		| 'tableGanttOneDayClickBehavior'
		| 'tableGanttShowDateStartedMarkers'
		| 'tableGanttShowDateScheduledMarkers'
		| 'tableGanttShowDateDueMarkers'
	>;
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex;
	interaction?: TableGanttInteractionController;
	onActivateBar?: (task: IndexedTask, anchor: HTMLElement, activation: 'primary' | 'secondary') => void;
	onOpenDateMarkerPicker?: (anchor: HTMLElement, task: IndexedTask, key: GanttDateMarkerKey) => void;
	performanceRecorder?: TableScrollPerformanceRecorder;
}

export type TableGanttRenderIntentOptions = Pick<
	TableGanttRenderOptions,
	| 'items'
	| 'verticalRange'
	| 'rowHeight'
	| 'layout'
	| 'scrollLeft'
	| 'locale'
	| 'gantt'
	| 'settings'
	| 'workflowStatusIdentityIndex'
	| 'interaction'
	| 'onActivateBar'
	| 'onOpenDateMarkerPicker'
>;

export interface TableGanttRenderIntent {
	layout: GanttTimelineLayout;
	items: readonly TableTaskTreeRenderItem[];
	verticalStartIndex: number;
	verticalEndIndex: number;
	totalHeight: number;
	rowHeight: number;
	horizontalRange: GanttHorizontalRange;
	locale: string;
	gantt: TableGanttSettings;
	settings: TableGanttRenderOptions['settings'];
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex;
	interaction: TableGanttInteractionController | undefined;
	canActivateBar: boolean;
	canOpenDateMarkerPicker: boolean;
}

export interface GanttBarGeometry {
	left: number;
	width: number;
}

export interface TableGanttBarTooltipContent {
	title: string;
	content: string;
}

interface RenderedTableGanttDependencies {
	occurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>;
	livePathEl: SVGPathElement | null;
	liveArrowEl: SVGPathElement | null;
}

export interface TableGanttHeaderRenderIntent {
	layout: GanttTimelineLayout;
	horizontalStartIndex: number;
	horizontalEndIndex: number;
	locale: string;
}

interface TableGanttRowBundle {
	laneEl: HTMLElement;
	contentEl: HTMLElement | null;
}

interface TableGanttBodyDomState {
	weekendLayer: HTMLElement;
	laneLayer: HTMLElement;
	gridLayer: HTMLElement;
	dependencySvg: SVGSVGElement;
	barLayer: HTMLElement;
	todayLayer: HTMLElement;
	rowCache: TableVirtualRowCache<TableGanttRowBundle>;
	rowIdentity: object;
	rowIntent: TableGanttRenderIntent | null;
	staticIntent: TableGanttHeaderRenderIntent | null;
	dependencyIntent: string | null;
	dependencyLivePathEl: SVGPathElement | null;
	dependencyLiveArrowEl: SVGPathElement | null;
}

const ganttHeaderIntents = new WeakMap<HTMLElement, TableGanttHeaderRenderIntent>();
const ganttBodyStates = new WeakMap<HTMLElement, TableGanttBodyDomState>();

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function resolveViewportWidth(viewportWidth: number): number {
	return Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 400;
}

function resolveDateTask(item: GanttRenderableTaskItem): IndexedTask {
	return item.task;
}

function alignAxisStart(
	ordinal: number,
	scale: GanttScale,
	weekStart: 'monday' | 'sunday',
): number {
	if (scale === 'day') return ordinal;
	const date = ganttOrdinalToDateKey(ordinal);
	if (scale === 'month') {
		return ganttDateKeyToOrdinal(`${date.slice(0, 8)}01`) ?? ordinal;
	}
	const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
	const weekStartIndex = weekStart === 'sunday' ? 0 : 1;
	return ordinal - ((weekday - weekStartIndex + 7) % 7);
}

function alignAxisEnd(
	ordinal: number,
	scale: GanttScale,
	weekStart: 'monday' | 'sunday',
): number {
	if (scale === 'day') return ordinal;
	const date = ganttOrdinalToDateKey(ordinal);
	if (scale === 'month') {
		const [year, month] = date.split('-').map(Number);
		const nextMonth = month === 12
			? `${year + 1}-01-01`
			: `${year}-${String(month + 1).padStart(2, '0')}-01`;
		return (ganttDateKeyToOrdinal(nextMonth) ?? ordinal + 1) - 1;
	}
	const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
	const weekEnd = ((weekStart === 'sunday' ? 0 : 1) + 6) % 7;
	return ordinal + ((weekEnd - weekday + 7) % 7);
}

export function getTableGanttBaseDayWidthPx(scale: GanttScale): number {
	return TABLE_GANTT_BASE_DAY_WIDTH_PX[scale];
}

export function buildTableGanttTimelineLayout(
	options: BuildTableGanttTimelineLayoutOptions,
): GanttTimelineLayout {
	const today = options.today ?? localToday();
	const todayOrdinal = ganttDateKeyToOrdinal(today) ?? 0;
	const viewportWidth = resolveViewportWidth(options.viewportWidth);
	const dayWidth = getTableGanttBaseDayWidthPx(options.gantt.scale)
		* options.gantt.unitWidthMultiplier;
	const taskModel = (options.modelCache ?? new TableGanttTaskModelCache())
		.resolve(options.items, options.performanceRecorder);
	const { projections, dependencyEdges, taskDates } = taskModel;

	const candidateOrdinals = [
		todayOrdinal,
		...(options.anchorDate
			? [ganttDateKeyToOrdinal(options.anchorDate)].filter((value): value is number => value !== null)
			: []),
		...taskDates
			.map(date => ganttDateKeyToOrdinal(date))
			.filter((value): value is number => value !== null),
	];
	const visibleDayCount = Math.max(1, Math.ceil(viewportWidth / dayWidth));
	let startOrdinal = Math.min(...candidateOrdinals) - visibleDayCount;
	let endOrdinal = Math.max(...candidateOrdinals) + visibleDayCount;
	const minimumDayCount = Math.max(
		1,
		Math.ceil(Math.max(TABLE_GANTT_MIN_AXIS_WIDTH_PX, viewportWidth * 3) / dayWidth),
	);
	const currentDayCount = endOrdinal - startOrdinal + 1;
	if (currentDayCount < minimumDayCount) {
		const missing = minimumDayCount - currentDayCount;
		const before = Math.floor(missing / 2);
		startOrdinal -= before;
		endOrdinal += missing - before;
	}
	startOrdinal = alignAxisStart(startOrdinal, options.gantt.scale, options.calendarWeekStart);
	endOrdinal = alignAxisEnd(endOrdinal, options.gantt.scale, options.calendarWeekStart);

	const axis = buildGanttDateAxis({
		startDate: ganttOrdinalToDateKey(startOrdinal),
		endDate: ganttOrdinalToDateKey(endOrdinal),
		baseDayWidthPx: getTableGanttBaseDayWidthPx(options.gantt.scale),
		unitWidthMultiplier: options.gantt.unitWidthMultiplier,
		scale: options.gantt.scale,
		weekStart: options.calendarWeekStart,
	});
	if (!axis) throw new Error('Failed to build a valid Gantt date axis.');
	const earliestTaskDate = taskDates.length > 0
		? taskDates.reduce((earliest, date) => date < earliest ? date : earliest)
		: null;

	return {
		axis,
		today,
		showToday: resolveTableGanttVisibility(
			options.gantt.todayVisibility,
			options.globalShowToday,
		),
		showWeekends: resolveTableGanttVisibility(
			options.gantt.weekendVisibility,
			options.globalShowWeekends,
		),
		viewportWidth,
		earliestTaskDate,
		projections,
		dependencyEdges,
	};
}

export function resolveTableGanttHorizontalRange(
	axis: GanttDateAxis,
	scrollLeft: number,
	viewportWidth: number,
	overscanViewports = 1,
): GanttHorizontalRange {
	const safeViewportWidth = resolveViewportWidth(viewportWidth);
	const maxScrollLeft = Math.max(0, axis.totalWidthPx - safeViewportWidth);
	const safeScrollLeft = clamp(Number.isFinite(scrollLeft) ? scrollLeft : 0, 0, maxScrollLeft);
	const visibleStartIndex = clamp(
		Math.floor(safeScrollLeft / axis.dayWidthPx),
		0,
		axis.days.length,
	);
	const visibleEndIndex = clamp(
		Math.ceil((safeScrollLeft + safeViewportWidth) / axis.dayWidthPx),
		visibleStartIndex,
		axis.days.length,
	);
	const overscanDays = Math.max(
		0,
		Math.ceil(safeViewportWidth / axis.dayWidthPx) * Math.max(0, overscanViewports),
	);
	return {
		visibleStartIndex,
		visibleEndIndex,
		startIndex: Math.max(0, visibleStartIndex - overscanDays),
		endIndex: Math.min(axis.days.length, visibleEndIndex + overscanDays),
	};
}

export function resolveTableGanttRenderIntent(
	options: TableGanttRenderIntentOptions,
): TableGanttRenderIntent {
	return {
		layout: options.layout,
		items: options.items,
		verticalStartIndex: options.verticalRange.startIndex,
		verticalEndIndex: options.verticalRange.endIndex,
		totalHeight: options.verticalRange.totalHeight,
		rowHeight: options.rowHeight,
		horizontalRange: resolveTableGanttHorizontalRange(
			options.layout.axis,
			options.scrollLeft,
			options.layout.viewportWidth,
		),
		locale: options.locale,
		gantt: options.gantt,
		settings: options.settings,
		workflowStatusIdentityIndex: options.workflowStatusIdentityIndex,
		interaction: options.interaction,
		canActivateBar: options.onActivateBar !== undefined,
		canOpenDateMarkerPicker: options.onOpenDateMarkerPicker !== undefined,
	};
}

export function areTableGanttRenderIntentsEqual(
	left: TableGanttRenderIntent | null,
	right: TableGanttRenderIntent,
): boolean {
	return left !== null
		&& left.layout === right.layout
		&& left.items === right.items
		&& left.verticalStartIndex === right.verticalStartIndex
		&& left.verticalEndIndex === right.verticalEndIndex
		&& left.totalHeight === right.totalHeight
		&& left.rowHeight === right.rowHeight
		&& left.horizontalRange.startIndex === right.horizontalRange.startIndex
		&& left.horizontalRange.endIndex === right.horizontalRange.endIndex
		&& left.locale === right.locale
		&& left.gantt === right.gantt
		&& left.settings === right.settings
		&& left.workflowStatusIdentityIndex === right.workflowStatusIdentityIndex
		&& left.interaction === right.interaction
		&& left.canActivateBar === right.canActivateBar
		&& left.canOpenDateMarkerPicker === right.canOpenDateMarkerPicker;
}

export function shouldRenderTableGanttTimeline(
	previous: TableGanttRenderIntent | null,
	next: TableGanttRenderIntent,
	force = false,
): boolean {
	return force || !areTableGanttRenderIntentsEqual(previous, next);
}

function clampTimelineScrollLeft(
	axis: GanttDateAxis,
	viewportWidth: number,
	scrollLeft: number,
): number {
	return clamp(scrollLeft, 0, Math.max(0, axis.totalWidthPx - resolveViewportWidth(viewportWidth)));
}

export function resolveTableGanttInitialScrollLeft(
	layout: GanttTimelineLayout,
	focusTodayOnOpen: boolean,
): number {
	const date = focusTodayOnOpen || !layout.earliestTaskDate
		? layout.today
		: layout.earliestTaskDate;
	const x = ganttDateToX(layout.axis, date) ?? 0;
	const desired = focusTodayOnOpen || !layout.earliestTaskDate
		? x - (layout.viewportWidth / 2) + (layout.axis.dayWidthPx / 2)
		: x - (layout.viewportWidth * 0.1);
	return clampTimelineScrollLeft(layout.axis, layout.viewportWidth, desired);
}

export function resolveTableGanttAnchoredScrollLeft(
	layout: GanttTimelineLayout,
	anchorDate: string,
): number {
	const x = ganttDateToX(layout.axis, anchorDate) ?? 0;
	return clampTimelineScrollLeft(
		layout.axis,
		layout.viewportWidth,
		x - (layout.viewportWidth / 2) + (layout.axis.dayWidthPx / 2),
	);
}

export function resolveTableGanttViewportAnchorDate(
	layout: GanttTimelineLayout,
	scrollLeft: number,
): string {
	return ganttXToDate(
		layout.axis,
		clampTimelineScrollLeft(layout.axis, layout.viewportWidth, scrollLeft)
			+ (layout.viewportWidth / 2),
	) ?? layout.today;
}

export interface GanttViewportStartAnchor {
	date: string;
	dayOffsetRatio: number;
}

export function resolveTableGanttViewportStartAnchor(
	layout: GanttTimelineLayout,
	scrollLeft: number,
): GanttViewportStartAnchor {
	const safeScrollLeft = clampTimelineScrollLeft(layout.axis, layout.viewportWidth, scrollLeft);
	const date = ganttXToDate(layout.axis, safeScrollLeft) ?? layout.axis.startDate;
	const dateX = ganttDateToX(layout.axis, date) ?? safeScrollLeft;
	return {
		date,
		dayOffsetRatio: clamp((safeScrollLeft - dateX) / layout.axis.dayWidthPx, 0, 1),
	};
}

export function resolveTableGanttStartAnchoredScrollLeft(
	layout: GanttTimelineLayout,
	anchor: GanttViewportStartAnchor,
): number {
	const dateX = ganttDateToX(layout.axis, anchor.date) ?? 0;
	const ratio = Number.isFinite(anchor.dayOffsetRatio)
		? clamp(anchor.dayOffsetRatio, 0, 1)
		: 0;
	return clampTimelineScrollLeft(
		layout.axis,
		layout.viewportWidth,
		dateX + (ratio * layout.axis.dayWidthPx),
	);
}

export function resolveTableGanttBarGeometry(
	axis: GanttDateAxis,
	projection: GanttTaskProjection,
): GanttBarGeometry | null {
	if (!projection.bar) return null;
	const left = ganttDateToX(axis, projection.bar.startDate);
	const right = ganttDateToX(axis, projection.bar.endDate);
	if (left === null || right === null) return null;
	return {
		left,
		width: right - left + axis.dayWidthPx,
	};
}

export function resolveTableGanttDateMarkerCenterX(
	axis: GanttDateAxis,
	marker: GanttDateMarker,
): number | null {
	const x = ganttDateToX(axis, marker.date);
	return x === null ? null : x + (axis.dayWidthPx / 2);
}

export function resolveTableGanttDateMarkerIcon(
	key: GanttDateMarkerKey,
	settings: Pick<OperonSettings, 'keyMappings'>,
): string {
	return getConfiguredKeyMappingIcon(key, settings.keyMappings)
		|| TABLE_GANTT_DATE_MARKER_FALLBACK_ICONS[key];
}

export function resolveTableGanttDateMarkerVisibility(
	key: GanttDateMarkerKey,
	settings: Pick<OperonSettings,
		| 'tableGanttShowDateStartedMarkers'
		| 'tableGanttShowDateScheduledMarkers'
		| 'tableGanttShowDateDueMarkers'
	>,
): boolean {
	if (key === 'dateStarted') return settings.tableGanttShowDateStartedMarkers;
	if (key === 'dateScheduled') return settings.tableGanttShowDateScheduledMarkers;
	return settings.tableGanttShowDateDueMarkers;
}

function toUtcDate(date: string): Date {
	return new Date(`${date}T00:00:00.000Z`);
}

function formatTableGanttTooltipDate(date: string, locale: string): string {
	const parts = new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}).formatToParts(toUtcDate(date));
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find(candidate => candidate.type === type)?.value ?? '';
	return [part('day'), part('month'), part('year')].filter(Boolean).join(' ');
}

export function resolveTableGanttBarTooltipContent(
	task: IndexedTask,
	projection: GanttTaskProjection,
	locale: string,
): TableGanttBarTooltipContent | null {
	const bar = projection.bar;
	if (!bar) return null;
	const startOrdinal = ganttDateKeyToOrdinal(bar.startDate);
	const endOrdinal = ganttDateKeyToOrdinal(bar.endDate);
	if (startOrdinal === null || endOrdinal === null || endOrdinal < startOrdinal) return null;
	const dayCount = endOrdinal - startOrdinal + 1;
	const count = String(dayCount);
	const lines = [t('table', dayCount === 1 ? 'ganttTooltipDurationOne' : 'ganttTooltipDurationMany', { count })];
	const started = projection.markers.find(marker => marker.key === 'dateStarted');
	if (started) {
		lines.push(t('table', 'ganttTooltipStartsOn', {
			date: formatTableGanttTooltipDate(started.date, locale),
		}));
	}
	const due = projection.markers.find(marker => marker.key === 'dateDue');
	if (due) {
		lines.push(t('table', 'ganttTooltipDueOn', {
			date: formatTableGanttTooltipDate(due.date, locale),
		}));
	}
	const scheduled = projection.markers.find(marker => marker.key === 'dateScheduled');
	if (scheduled) {
		lines.push('', t('table', 'ganttTooltipScheduledOn', {
			date: formatTableGanttTooltipDate(scheduled.date, locale),
		}));
	}
	return {
		title: task.description.trim() || task.operonId,
		content: lines.join('\n'),
	};
}

export function formatTableGanttHeaderLabel(
	axis: GanttDateAxis,
	group: GanttDateAxis['headerGroups'][number],
	locale: string,
): string {
	if (axis.scale === 'day') {
		const date = toUtcDate(group.startDate);
		const weekday = new Intl.DateTimeFormat(locale, {
			weekday: 'narrow',
			timeZone: 'UTC',
		}).format(date);
		const day = new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			timeZone: 'UTC',
		}).format(date);
		return `${weekday} ${day}`;
	}
	if (axis.scale === 'month') {
		return new Intl.DateTimeFormat(locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC',
		}).format(toUtcDate(group.startDate));
	}
	const dateFormatter = new Intl.DateTimeFormat(locale, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
	const yearFormatter = new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		timeZone: 'UTC',
	});
	return `${dateFormatter.format(toUtcDate(group.startDate))} – ${dateFormatter.format(toUtcDate(group.endDate))}, ${yearFormatter.format(toUtcDate(group.endDate))}`;
}

function isWeekend(date: string): boolean {
	const weekday = toUtcDate(date).getUTCDay();
	return weekday === 0 || weekday === 6;
}

function createLayer(document: Document, className: string): HTMLDivElement {
	return document.win.createDiv(className);
}

function createSvgPath(document: Document, className: string): SVGPathElement {
	const path = document.createElementNS(SVG_NAMESPACE, 'path');
	path.setAttribute('class', className);
	return path;
}

function setHorizontalGeometry(element: HTMLElement, left: number, width: number): void {
	element.style.left = `${left}px`;
	element.style.width = `${width}px`;
}

function appendWeekendBands(
	layer: HTMLElement,
	layout: GanttTimelineLayout,
	range: GanttHorizontalRange,
): void {
	if (!layout.showWeekends) return;
	for (let index = range.startIndex; index < range.endIndex; index += 1) {
		const atom = layout.axis.days[index];
		if (!atom || !isWeekend(atom.date)) continue;
		const band = createLayer(layer.ownerDocument, 'operon-table-gantt-weekend-band');
		setHorizontalGeometry(band, atom.x, atom.width);
		layer.appendChild(band);
	}
}

function appendMajorBoundaries(
	layer: HTMLElement,
	layout: GanttTimelineLayout,
	range: GanttHorizontalRange,
): void {
	if (layout.axis.scale === 'day') return;
	for (const group of layout.axis.headerGroups) {
		if (group.startIndex + group.dayCount <= range.startIndex || group.startIndex >= range.endIndex) continue;
		if (group.startIndex === 0) continue;
		const boundary = createLayer(layer.ownerDocument, 'operon-table-gantt-major-boundary');
		boundary.style.left = `${group.x}px`;
		layer.appendChild(boundary);
	}
}

function appendTodayLine(layer: HTMLElement, layout: GanttTimelineLayout): void {
	if (!layout.showToday) return;
	const todayX = (ganttDateToX(layout.axis, layout.today) ?? 0) + (layout.axis.dayWidthPx / 2);
	const line = createLayer(layer.ownerDocument, 'operon-table-gantt-today-line');
	line.style.left = `${todayX}px`;
	layer.appendChild(line);
}

export function resolveTableGanttTaskAccent(
	task: IndexedTask,
	gantt: Pick<TableGanttSettings, 'barColorMode'>,
	settings: Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'>,
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): string | null {
	const mode = gantt.barColorMode;
	if (mode === 'noColor') return null;
	if (mode === 'randomColors') {
		return resolveTableRandomColumnColor('gantt', task.operonId, settings);
	}
	const sourceMode = mode === 'taskColor'
		? 'taskColor'
		: mode === 'statusColor'
			? 'statusColor'
			: 'priorityColor';
	return resolveTaskColorSourceForTask(
		task,
		sourceMode,
		settings,
		workflowStatusIdentityIndex,
	);
}

function renderHeader(
	options: TableGanttRenderOptions,
	range: GanttHorizontalRange,
): void {
	const { headerEl, layout } = options;
	headerEl.replaceChildren();
	headerEl.style.width = `${layout.axis.totalWidthPx}px`;
	headerEl.style.minWidth = `${layout.axis.totalWidthPx}px`;
	headerEl.style.setProperty('--operon-table-gantt-day-width', `${layout.axis.dayWidthPx}px`);

	const weekendLayer = createLayer(headerEl.ownerDocument, 'operon-table-gantt-header-weekends');
	appendWeekendBands(weekendLayer, layout, range);
	headerEl.appendChild(weekendLayer);

	const groupsLayer = createLayer(headerEl.ownerDocument, 'operon-table-gantt-header-groups');
	for (const group of layout.axis.headerGroups) {
		if (group.startIndex + group.dayCount <= range.startIndex || group.startIndex >= range.endIndex) continue;
		const label = createLayer(headerEl.ownerDocument, 'operon-table-gantt-header-group');
		setHorizontalGeometry(label, group.x, group.width);
		label.textContent = formatTableGanttHeaderLabel(layout.axis, group, options.locale);
		label.title = label.textContent;
		if (
			layout.axis.scale === 'day'
			&& layout.showToday
			&& group.startDate === layout.today
		) {
			label.classList.add('is-today');
		}
		groupsLayer.appendChild(label);
	}
	headerEl.appendChild(groupsLayer);

	const gridLayer = createLayer(headerEl.ownerDocument, 'operon-table-gantt-header-grid');
	appendMajorBoundaries(gridLayer, layout, range);
	appendTodayLine(gridLayer, layout);
	headerEl.appendChild(gridLayer);
}

export function resolveTableGanttHeaderRenderIntent(
	intent: TableGanttRenderIntent,
): TableGanttHeaderRenderIntent {
	return {
		layout: intent.layout,
		horizontalStartIndex: intent.horizontalRange.startIndex,
		horizontalEndIndex: intent.horizontalRange.endIndex,
		locale: intent.locale,
	};
}

export function areTableGanttHeaderRenderIntentsEqual(
	left: TableGanttHeaderRenderIntent | null,
	right: TableGanttHeaderRenderIntent,
): boolean {
	return left !== null
		&& left.layout === right.layout
		&& left.horizontalStartIndex === right.horizontalStartIndex
		&& left.horizontalEndIndex === right.horizontalEndIndex
		&& left.locale === right.locale;
}

export function areTableGanttRowRenderIntentsEqual(
	left: TableGanttRenderIntent | null,
	right: TableGanttRenderIntent,
): boolean {
	return left !== null
		&& left.layout === right.layout
		&& left.items === right.items
		&& left.totalHeight === right.totalHeight
		&& left.rowHeight === right.rowHeight
		&& left.locale === right.locale
		&& left.gantt === right.gantt
		&& left.settings === right.settings
		&& left.workflowStatusIdentityIndex === right.workflowStatusIdentityIndex
		&& left.interaction === right.interaction
		&& left.canActivateBar === right.canActivateBar
		&& left.canOpenDateMarkerPicker === right.canOpenDateMarkerPicker;
}

function ensureTableGanttBodyDomState(options: TableGanttRenderOptions): TableGanttBodyDomState {
	const existing = ganttBodyStates.get(options.canvasEl);
	if (existing?.weekendLayer.parentElement === options.canvasEl) return existing;
	cleanupOperonHoverTooltips(options.canvasEl);
	options.canvasEl.replaceChildren();
	options.performanceRecorder?.recordCounter('ganttBodyReplacements');
	options.performanceRecorder?.recordCounter('ganttBodyResets');
	const weekendLayer = createLayer(options.canvasEl.ownerDocument, 'operon-table-gantt-body-weekends');
	const laneLayer = createLayer(options.canvasEl.ownerDocument, 'operon-table-gantt-lanes');
	const gridLayer = createLayer(options.canvasEl.ownerDocument, 'operon-table-gantt-body-grid');
	const dependencySvg = options.canvasEl.ownerDocument.createElementNS(SVG_NAMESPACE, 'svg');
	dependencySvg.setAttribute('class', 'operon-table-gantt-dependency-layer');
	dependencySvg.setAttribute('aria-hidden', 'true');
	const barLayer = createLayer(options.canvasEl.ownerDocument, 'operon-table-gantt-bars');
	const todayLayer = createLayer(options.canvasEl.ownerDocument, 'operon-table-gantt-body-today');
	options.canvasEl.append(weekendLayer, laneLayer, gridLayer, dependencySvg, barLayer, todayLayer);
	const state: TableGanttBodyDomState = {
		weekendLayer,
		laneLayer,
		gridLayer,
		dependencySvg,
		barLayer,
		todayLayer,
		rowCache: createTableVirtualRowCache<TableGanttRowBundle>(),
		rowIdentity: {},
		rowIntent: null,
		staticIntent: null,
		dependencyIntent: null,
		dependencyLivePathEl: null,
		dependencyLiveArrowEl: null,
	};
	ganttBodyStates.set(options.canvasEl, state);
	return state;
}

function renderTableGanttStaticBody(
	state: TableGanttBodyDomState,
	options: TableGanttRenderOptions,
	range: GanttHorizontalRange,
): void {
	state.weekendLayer.replaceChildren();
	appendWeekendBands(state.weekendLayer, options.layout, range);
	state.gridLayer.replaceChildren();
	appendMajorBoundaries(state.gridLayer, options.layout, range);
	state.todayLayer.replaceChildren();
	appendTodayLine(state.todayLayer, options.layout);
	options.performanceRecorder?.recordCounter('ganttStaticLayerRebuilds');
}

function syncTableGanttDependencyPorts(
	contentEl: HTMLElement,
	item: GanttRenderableTaskItem,
	index: number,
	options: TableGanttRenderOptions,
	occurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>,
): void {
	const bar = contentEl.querySelector<HTMLElement>('.operon-table-gantt-bar');
	if (!bar) return;
	const shouldShow = options.interaction?.supportsDependencyEditing() === true
		&& occurrences.get(item.task.operonId)?.rowIndex === index;
	const existing = Array.from(bar.querySelectorAll<HTMLElement>('.operon-table-gantt-dependency-port'));
	if (!shouldShow) {
		for (const port of existing) port.remove();
		return;
	}
	if (existing.length > 0) return;
	for (const side of ['incoming', 'outgoing'] as const) {
		const port = createLayer(contentEl.ownerDocument, `operon-table-gantt-dependency-port is-${side}`);
		port.dataset.ganttTaskId = item.task.operonId;
		port.dataset.ganttDependencySide = side;
		port.setAttribute('aria-hidden', 'true');
		bar.appendChild(port);
	}
}

function createTableGanttRowBundle(
	options: TableGanttRenderOptions,
	item: TableTaskTreeRenderItem,
	index: number,
	resolveProjection: (task: IndexedTask) => GanttTaskProjection,
	occurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>,
): TableGanttRowBundle {
	const { canvasEl, layout, rowHeight } = options;
	const laneEl = createLayer(canvasEl.ownerDocument, getTableGanttLaneClassName(item));
	laneEl.dataset.operonRowIndex = String(index);
	laneEl.style.height = `${rowHeight}px`;
	laneEl.style.transform = `translateY(${index * rowHeight}px)`;
	if (item.kind !== 'task' && item.kind !== 'parentContext') return { laneEl, contentEl: null };

	const task = resolveDateTask(item);
	const projection = resolveProjection(task);
	laneEl.dataset.ganttTaskId = item.task.operonId;
	if (options.interaction && !projection.bar) laneEl.classList.add('is-gantt-schedulable');
	const contentEl = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-row-content');
	contentEl.dataset.operonRowIndex = String(index);
	contentEl.dataset.operonVirtualRowKey = resolveTableVirtualRowKey(item);
	contentEl.style.height = `${rowHeight}px`;
	contentEl.style.transform = `translateY(${index * rowHeight}px)`;
	const accent = resolveTableGanttTaskAccent(
		task,
		options.gantt,
		options.settings,
		options.workflowStatusIdentityIndex,
	);
	const barGeometry = resolveTableGanttBarGeometry(layout.axis, projection);
	if (barGeometry) {
		const bar = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-bar');
		const tooltip = resolveTableGanttBarTooltipContent(task, projection, options.locale);
		bar.dataset.ganttTaskId = task.operonId;
		bar.dataset.operonRowIndex = String(index);
		bar.classList.add(`is-${projection.bar?.kind ?? 'scheduled'}`);
		bar.dataset.ganttBarKind = projection.bar?.kind ?? '';
		const canActivatePrimary = options.settings.tableGanttBarClickAction !== 'none' && options.onActivateBar !== undefined;
		const canActivateSecondary = options.settings.tableGanttBarRightClickAction !== 'none' && options.onActivateBar !== undefined;
		if (options.interaction || canActivatePrimary || canActivateSecondary) {
			bar.tabIndex = 0;
			bar.setAttribute('role', 'button');
			bar.setAttribute('aria-label', `${task.description}: ${projection.bar?.startDate ?? ''} – ${projection.bar?.endDate ?? ''}`);
		}
		if (!options.interaction && (canActivatePrimary || canActivateSecondary)) {
			if (canActivatePrimary) {
				bar.addEventListener('click', () => options.onActivateBar?.(task, bar, 'primary'));
			}
			bar.addEventListener('keydown', event => {
				const secondary = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
				if ((!secondary || !canActivateSecondary) && ((event.key !== 'Enter' && event.key !== ' ') || !canActivatePrimary)) return;
				event.preventDefault();
				options.onActivateBar?.(task, bar, secondary ? 'secondary' : 'primary');
			});
		}
		bar.addEventListener('contextmenu', event => {
			event.preventDefault();
			event.stopPropagation();
			if (canActivateSecondary) options.onActivateBar?.(task, bar, 'secondary');
		});
		if (options.interaction) {
			if (options.interaction.isPending(task.operonId)) {
				bar.classList.add('is-pending');
				bar.setAttribute('aria-busy', 'true');
			}
			for (const editIntent of ['resize-start', 'resize-end'] as const) {
				const handle = createLayer(canvasEl.ownerDocument, `operon-table-gantt-resize-handle is-${editIntent === 'resize-start' ? 'start' : 'end'}`);
				handle.dataset.ganttEditIntent = editIntent;
				handle.tabIndex = 0;
				handle.setAttribute('role', 'button');
				setAccessibleLabelWithoutTooltip(
					handle,
					`${task.description}: ${editIntent === 'resize-start' ? projection.bar?.startDate ?? '' : projection.bar?.endDate ?? ''}`,
				);
				bar.appendChild(handle);
			}
		}
		setHorizontalGeometry(bar, barGeometry.left, barGeometry.width);
		bar.style.top = `${(rowHeight - TABLE_GANTT_BAR_HEIGHT_PX) / 2}px`;
		if (accent) bar.style.setProperty('--operon-table-gantt-accent', accent);
		if (tooltip) {
			bindOperonHoverTooltip(bar, {
				title: tooltip.title,
				content: tooltip.content,
				taskColor: accent,
				preferredHorizontal: 'center',
			});
		}
		contentEl.appendChild(bar);
	}

	const markersByDate = new Map<string, GanttDateMarker[]>();
	for (const marker of projection.markers) {
		if (!resolveTableGanttDateMarkerVisibility(marker.key, options.settings)) continue;
		const sameDateMarkers = markersByDate.get(marker.date) ?? [];
		sameDateMarkers.push(marker);
		markersByDate.set(marker.date, sameDateMarkers);
	}
	for (const markers of markersByDate.values()) {
		const firstMarker = markers[0];
		if (!firstMarker) continue;
		const markerCenterX = resolveTableGanttDateMarkerCenterX(layout.axis, firstMarker);
		if (markerCenterX === null) continue;
		const group = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-date-marker-group');
		group.dataset.operonRowIndex = String(index);
		group.style.left = `${markerCenterX}px`;
		group.style.top = `${rowHeight / 2}px`;
		if (!options.onOpenDateMarkerPicker) group.setAttribute('aria-hidden', 'true');
		if (accent) group.style.setProperty('--operon-table-gantt-accent', accent);
		for (const marker of markers) {
			const isInteractive = options.onOpenDateMarkerPicker !== undefined;
			const markerTitle = getTableTaskFieldLabel(marker.key, options.settings);
			const markerEl = options.onOpenDateMarkerPicker
				? canvasEl.ownerDocument.win.createEl('button')
				: createLayer(canvasEl.ownerDocument, 'operon-table-gantt-date-marker');
			markerEl.classList.add('operon-table-gantt-date-marker', `is-${marker.key}`);
			if (isInteractive) {
				(markerEl as HTMLButtonElement).type = 'button';
				markerEl.classList.add('is-interactive');
				markerEl.setAttribute('aria-label', `${markerTitle}: ${marker.date}`);
				markerEl.addEventListener('pointerdown', event => event.stopPropagation());
				markerEl.addEventListener('click', event => {
					event.preventDefault();
					event.stopPropagation();
					options.onOpenDateMarkerPicker?.(markerEl, task, marker.key);
				});
			}
			if (
				barGeometry
				&& markerCenterX >= barGeometry.left
				&& markerCenterX <= barGeometry.left + barGeometry.width
			) {
				markerEl.classList.add('is-inside-bar');
			}
			markerEl.dataset.ganttDateMarker = marker.key;
			markerEl.dataset.ganttDate = marker.date;
			setIcon(markerEl, resolveTableGanttDateMarkerIcon(marker.key, options.settings));
			bindOperonHoverTooltip(markerEl, {
				title: markerTitle,
				content: marker.date,
				taskColor: accent,
				preferredHorizontal: 'center',
			});
			group.appendChild(markerEl);
		}
		contentEl.appendChild(group);
	}
	syncTableGanttDependencyPorts(contentEl, item, index, options, occurrences);
	return { laneEl, contentEl };
}

function updateTableGanttRowBundle(
	bundle: TableGanttRowBundle,
	item: TableTaskTreeRenderItem,
	index: number,
	options: TableGanttRenderOptions,
	resolveProjection: (task: IndexedTask) => GanttTaskProjection,
	occurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>,
): void {
	bundle.laneEl.dataset.operonRowIndex = String(index);
	bundle.laneEl.style.height = `${options.rowHeight}px`;
	bundle.laneEl.style.transform = `translateY(${index * options.rowHeight}px)`;
	if (!bundle.contentEl || (item.kind !== 'task' && item.kind !== 'parentContext')) return;
	bundle.contentEl.dataset.operonRowIndex = String(index);
	bundle.contentEl.style.height = `${options.rowHeight}px`;
	bundle.contentEl.style.transform = `translateY(${index * options.rowHeight}px)`;
	for (const child of Array.from(bundle.contentEl.querySelectorAll<HTMLElement>('[data-operon-row-index]'))) {
		child.dataset.operonRowIndex = String(index);
	}
	bundle.laneEl.classList.toggle('is-gantt-schedulable', !!options.interaction && !resolveProjection(item.task).bar);
	syncTableGanttDependencyPorts(bundle.contentEl, item, index, options, occurrences);
}

function renderTableGanttDependencyLayer(
	state: TableGanttBodyDomState,
	options: TableGanttRenderOptions,
	dependencyLayout: ReturnType<typeof resolveTableGanttDependencyConnectors>,
): Pick<RenderedTableGanttDependencies, 'livePathEl' | 'liveArrowEl'> {
	const { dependencySvg } = state;
	dependencySvg.setAttribute('width', String(options.layout.axis.totalWidthPx));
	dependencySvg.setAttribute('height', String(options.verticalRange.totalHeight));
	dependencySvg.setAttribute('viewBox', `0 0 ${options.layout.axis.totalWidthPx} ${options.verticalRange.totalHeight}`);
	const dependencyIntent = resolveTableGanttDependencyOverlayIntent(
		dependencyLayout.connectors,
		Boolean(options.interaction),
	);
	if (state.dependencyIntent === dependencyIntent) {
		options.performanceRecorder?.recordCounter('ganttDependencyOverlayRetentions');
		return {
			livePathEl: state.dependencyLivePathEl,
			liveArrowEl: state.dependencyLiveArrowEl,
		};
	}

	dependencySvg.replaceChildren();
	for (const connector of dependencyLayout.connectors) {
		const group = options.canvasEl.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
		group.setAttribute('class', 'operon-table-gantt-dependency-connector');
		group.dataset.ganttDependencyFrom = connector.edge.fromId;
		group.dataset.ganttDependencyTo = connector.edge.toId;
		const path = createSvgPath(options.canvasEl.ownerDocument, 'operon-table-gantt-dependency-path');
		path.setAttribute('d', connector.path);
		group.appendChild(path);
		const arrow = createSvgPath(options.canvasEl.ownerDocument, 'operon-table-gantt-dependency-arrow');
		arrow.setAttribute('d', connector.arrowPath);
		group.appendChild(arrow);
		dependencySvg.appendChild(group);
	}
	let livePathEl: SVGPathElement | null = null;
	let liveArrowEl: SVGPathElement | null = null;
	if (options.interaction) {
		livePathEl = createSvgPath(options.canvasEl.ownerDocument, 'operon-table-gantt-dependency-live-path');
		liveArrowEl = createSvgPath(options.canvasEl.ownerDocument, 'operon-table-gantt-dependency-live-arrow');
		dependencySvg.append(livePathEl, liveArrowEl);
	}
	state.dependencyIntent = dependencyIntent;
	state.dependencyLivePathEl = livePathEl;
	state.dependencyLiveArrowEl = liveArrowEl;
	options.performanceRecorder?.recordCounter('ganttDependencyRebuilds');
	return { livePathEl, liveArrowEl };
}

export function resolveTableGanttDependencyOverlayIntent(
	connectors: readonly TableGanttDependencyConnector[],
	interactionEnabled: boolean,
): string {
	return JSON.stringify([
		interactionEnabled,
		...connectors.map(connector => [
			connector.edge.key,
			connector.path,
			connector.arrowPath,
		]),
	]);
}

function renderBody(
	options: TableGanttRenderOptions,
	range: GanttHorizontalRange,
	intent: TableGanttRenderIntent,
	forceRows: boolean,
): RenderedTableGanttDependencies {
	const { canvasEl, layout, verticalRange, rowHeight } = options;
	const resolveProjection = (task: IndexedTask): GanttTaskProjection => {
		const base = layout.projections.get(task.operonId) ?? projectTaskToGantt(task);
		return options.interaction?.resolveProjection(task, base) ?? base;
	};
	const dependencyLayout = resolveTableGanttDependencyConnectors({
		items: options.items,
		startIndex: verticalRange.startIndex,
		endIndex: verticalRange.endIndex,
		rowHeight,
		axis: layout.axis,
		resolveProjection,
		edges: layout.dependencyEdges,
		...(options.interaction ? { additionalEdges: options.interaction.getOptimisticDependencyEdges() } : {}),
	});
	const state = ensureTableGanttBodyDomState(options);
	canvasEl.style.width = `${layout.axis.totalWidthPx}px`;
	canvasEl.style.minWidth = `${layout.axis.totalWidthPx}px`;
	canvasEl.style.height = `${verticalRange.totalHeight}px`;
	canvasEl.style.setProperty('--operon-table-gantt-day-width', `${layout.axis.dayWidthPx}px`);

	const staticIntent = resolveTableGanttHeaderRenderIntent(intent);
	if (!areTableGanttHeaderRenderIntentsEqual(state.staticIntent, staticIntent)) {
		renderTableGanttStaticBody(state, options, range);
		state.staticIntent = staticIntent;
	}
	if (!areTableGanttRowRenderIntentsEqual(state.rowIntent, intent)) state.rowIdentity = {};
	const reconciled = reconcileTableVirtualRows({
		cache: state.rowCache,
		host: canvasEl,
		renderIdentity: state.rowIdentity,
		items: options.items,
		startIndex: verticalRange.startIndex,
		endIndex: verticalRange.endIndex,
		forceReset: forceRows,
		resolveKey: resolveTableVirtualRowKey,
		createRow: descriptor => createTableGanttRowBundle(
			options,
			descriptor.item,
			descriptor.index,
			resolveProjection,
			dependencyLayout.occurrences,
		),
		updateRow: (bundle, descriptor) => updateTableGanttRowBundle(
			bundle,
			descriptor.item,
			descriptor.index,
			options,
			resolveProjection,
			dependencyLayout.occurrences,
		),
		removeRow: bundle => {
			if (bundle.contentEl) cleanupOperonHoverTooltips(bundle.contentEl);
			bundle.laneEl.remove();
			bundle.contentEl?.remove();
		},
	});
	state.rowIntent = intent;
	orderTableVirtualRowElements(state.laneLayer, reconciled.entries.map(entry => entry.row.laneEl));
	orderTableVirtualRowElements(
		state.barLayer,
		reconciled.entries.flatMap(entry => entry.row.contentEl ? [entry.row.contentEl] : []),
	);
	options.performanceRecorder?.recordCounter('ganttRowsCreated', reconciled.stats.created);
	options.performanceRecorder?.recordCounter('ganttRowsReused', reconciled.stats.reused);
	options.performanceRecorder?.recordCounter('ganttRowsRemoved', reconciled.stats.removed);
	if (reconciled.stats.reset) options.performanceRecorder?.recordCounter('ganttBodyResets');
	const live = renderTableGanttDependencyLayer(state, options, dependencyLayout);
	return {
		occurrences: dependencyLayout.occurrences,
		livePathEl: live.livePathEl,
		liveArrowEl: live.liveArrowEl,
	};
}

export function renderTableGanttTimeline(
	options: TableGanttRenderOptions,
	intent: TableGanttRenderIntent = resolveTableGanttRenderIntent(options),
	forceRows = false,
): void {
	const range = intent.horizontalRange;
	const headerIntent = resolveTableGanttHeaderRenderIntent(intent);
	if (!areTableGanttHeaderRenderIntentsEqual(ganttHeaderIntents.get(options.headerEl) ?? null, headerIntent)) {
		const headerStartedAt = options.performanceRecorder?.beginTiming() ?? null;
		options.performanceRecorder?.recordCounter('ganttHeaderRenders');
		renderHeader(options, range);
		ganttHeaderIntents.set(options.headerEl, headerIntent);
		options.performanceRecorder?.recordCounter('ganttHeaderReplacements');
		options.performanceRecorder?.endTiming('ganttHeaderBuild', headerStartedAt);
	}
	const bodyStartedAt = options.performanceRecorder?.beginTiming() ?? null;
	options.performanceRecorder?.recordCounter('ganttBodyRenders');
	const dependencies = renderBody(options, range, intent, forceRows);
	options.performanceRecorder?.endTiming('ganttBodyBuild', bodyStartedAt);
	options.interaction?.updateContext({
		axis: options.layout.axis,
		items: options.items,
		projections: options.layout.projections,
		rowHeight: options.rowHeight,
		editable: true,
		oneDayBehavior: options.settings.tableGanttOneDayClickBehavior,
		dependencyOccurrences: dependencies.occurrences,
		dependencyLivePathEl: dependencies.livePathEl,
		dependencyLiveArrowEl: dependencies.liveArrowEl,
	});
}
