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
	type TableGanttDependencyOccurrence,
} from './table-gantt-dependencies';
import type { TableGanttInteractionController } from './table-gantt-interaction';
import { getTableTaskFieldLabel } from './table-field-catalog';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import type { TableScrollPerformanceRecorder } from './table-scroll-performance';

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

function resolveProjectionDates(projection: GanttTaskProjection): string[] {
	const dates: string[] = [];
	if (projection.bar) {
		dates.push(projection.bar.startDate, projection.bar.endDate);
	}
	if (projection.deadline) {
		dates.push(projection.deadline.date);
	}
	for (const marker of projection.markers) dates.push(marker.date);
	return dates;
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
	const projections = new Map<string, GanttTaskProjection>();
	const taskDates: string[] = [];

	for (const item of options.items) {
		if (item.kind !== 'task' && item.kind !== 'parentContext') continue;
		const task = resolveDateTask(item);
		if (projections.has(task.operonId)) continue;
		const projection = projectTaskToGantt(task);
		projections.set(task.operonId, projection);
		taskDates.push(...resolveProjectionDates(projection));
	}

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

function renderBody(
	options: TableGanttRenderOptions,
	range: GanttHorizontalRange,
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
		...(options.interaction ? { additionalEdges: options.interaction.getOptimisticDependencyEdges() } : {}),
	});
	canvasEl.replaceChildren();
	canvasEl.style.width = `${layout.axis.totalWidthPx}px`;
	canvasEl.style.minWidth = `${layout.axis.totalWidthPx}px`;
	canvasEl.style.height = `${verticalRange.totalHeight}px`;
	canvasEl.style.setProperty('--operon-table-gantt-day-width', `${layout.axis.dayWidthPx}px`);

	const weekendLayer = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-body-weekends');
	appendWeekendBands(weekendLayer, layout, range);
	canvasEl.appendChild(weekendLayer);

	const laneLayer = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-lanes');
	for (let index = verticalRange.startIndex; index < verticalRange.endIndex; index += 1) {
		const item = options.items[index];
		if (!item) continue;
		const lane = createLayer(canvasEl.ownerDocument, getTableGanttLaneClassName(item));
		lane.dataset.operonRowIndex = String(index);
		if (item.kind === 'task' || item.kind === 'parentContext') {
			lane.dataset.ganttTaskId = item.task.operonId;
			const projection = resolveProjection(item.task);
			if (options.interaction && !projection?.bar) lane.classList.add('is-gantt-schedulable');
		}
		lane.style.height = `${rowHeight}px`;
		lane.style.transform = `translateY(${index * rowHeight}px)`;
		laneLayer.appendChild(lane);
	}
	canvasEl.appendChild(laneLayer);

	const gridLayer = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-body-grid');
	appendMajorBoundaries(gridLayer, layout, range);
	canvasEl.appendChild(gridLayer);

	const dependencySvg = canvasEl.ownerDocument.createElementNS(SVG_NAMESPACE, 'svg');
	dependencySvg.setAttribute('class', 'operon-table-gantt-dependency-layer');
	dependencySvg.setAttribute('aria-hidden', 'true');
	dependencySvg.setAttribute('width', String(layout.axis.totalWidthPx));
	dependencySvg.setAttribute('height', String(verticalRange.totalHeight));
	dependencySvg.setAttribute('viewBox', `0 0 ${layout.axis.totalWidthPx} ${verticalRange.totalHeight}`);
	for (const connector of dependencyLayout.connectors) {
		const group = canvasEl.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
		group.setAttribute('class', 'operon-table-gantt-dependency-connector');
		group.dataset.ganttDependencyFrom = connector.edge.fromId;
		group.dataset.ganttDependencyTo = connector.edge.toId;
		const path = createSvgPath(canvasEl.ownerDocument, 'operon-table-gantt-dependency-path');
		path.setAttribute('d', connector.path);
		group.appendChild(path);
		const arrow = createSvgPath(canvasEl.ownerDocument, 'operon-table-gantt-dependency-arrow');
		arrow.setAttribute('d', connector.arrowPath);
		group.appendChild(arrow);
		dependencySvg.appendChild(group);
	}
	let livePathEl: SVGPathElement | null = null;
	let liveArrowEl: SVGPathElement | null = null;
	if (options.interaction) {
		livePathEl = createSvgPath(canvasEl.ownerDocument, 'operon-table-gantt-dependency-live-path');
		liveArrowEl = createSvgPath(canvasEl.ownerDocument, 'operon-table-gantt-dependency-live-arrow');
		dependencySvg.append(livePathEl, liveArrowEl);
	}
	canvasEl.appendChild(dependencySvg);

	const barLayer = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-bars');
	for (let index = verticalRange.startIndex; index < verticalRange.endIndex; index += 1) {
		const item = options.items[index];
		if (!item || (item.kind !== 'task' && item.kind !== 'parentContext')) continue;
		const task = resolveDateTask(item);
		const projection = resolveProjection(task);
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
				for (const intent of ['resize-start', 'resize-end'] as const) {
					const handle = createLayer(canvasEl.ownerDocument, `operon-table-gantt-resize-handle is-${intent === 'resize-start' ? 'start' : 'end'}`);
					handle.dataset.ganttEditIntent = intent;
					handle.tabIndex = 0;
					handle.setAttribute('role', 'button');
					setAccessibleLabelWithoutTooltip(
						handle,
						`${task.description}: ${intent === 'resize-start' ? projection.bar?.startDate ?? '' : projection.bar?.endDate ?? ''}`,
					);
					bar.appendChild(handle);
				}
				if (
					options.interaction.supportsDependencyEditing()
					&& dependencyLayout.occurrences.get(task.operonId)?.rowIndex === index
				) {
					for (const side of ['incoming', 'outgoing'] as const) {
						const port = createLayer(canvasEl.ownerDocument, `operon-table-gantt-dependency-port is-${side}`);
						port.dataset.ganttTaskId = task.operonId;
						port.dataset.ganttDependencySide = side;
						port.setAttribute('aria-hidden', 'true');
						bar.appendChild(port);
					}
				}
			}
			setHorizontalGeometry(bar, barGeometry.left, barGeometry.width);
			bar.style.top = `${(index * rowHeight) + ((rowHeight - TABLE_GANTT_BAR_HEIGHT_PX) / 2)}px`;
			if (accent) bar.style.setProperty('--operon-table-gantt-accent', accent);
			if (tooltip) {
				bindOperonHoverTooltip(bar, {
					title: tooltip.title,
					content: tooltip.content,
					taskColor: accent,
					preferredHorizontal: 'center',
				});
			}
			barLayer.appendChild(bar);
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
			group.style.top = `${(index * rowHeight) + (rowHeight / 2)}px`;
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
			barLayer.appendChild(group);
		}
	}
	canvasEl.appendChild(barLayer);

	const todayLayer = createLayer(canvasEl.ownerDocument, 'operon-table-gantt-body-today');
	appendTodayLine(todayLayer, layout);
	canvasEl.appendChild(todayLayer);
	return {
		occurrences: dependencyLayout.occurrences,
		livePathEl,
		liveArrowEl,
	};
}

export function renderTableGanttTimeline(options: TableGanttRenderOptions): void {
	const range = resolveTableGanttHorizontalRange(
		options.layout.axis,
		options.scrollLeft,
		options.layout.viewportWidth,
	);
	const headerStartedAt = options.performanceRecorder?.beginTiming() ?? null;
	options.performanceRecorder?.recordCounter('ganttHeaderRenders');
	renderHeader(options, range);
	options.performanceRecorder?.recordCounter('ganttHeaderReplacements');
	options.performanceRecorder?.endTiming('ganttHeaderBuild', headerStartedAt);
	const bodyStartedAt = options.performanceRecorder?.beginTiming() ?? null;
	options.performanceRecorder?.recordCounter('ganttBodyRenders');
	const dependencies = renderBody(options, range);
	options.performanceRecorder?.recordCounter('ganttBodyReplacements');
	options.performanceRecorder?.endTiming('ganttBodyBuild', bodyStartedAt);
	options.interaction?.updateContext({
		axis: options.layout.axis,
		items: options.items,
		rowHeight: options.rowHeight,
		editable: true,
		oneDayBehavior: options.settings.tableGanttOneDayClickBehavior,
		dependencyOccurrences: dependencies.occurrences,
		dependencyLivePathEl: dependencies.livePathEl,
		dependencyLiveArrowEl: dependencies.liveArrowEl,
	});
}
