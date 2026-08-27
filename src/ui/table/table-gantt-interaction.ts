import {
	deriveDatetimeEnd,
	extractDatePart,
	parseEstimateSeconds,
	shiftDatetimeByDays,
} from '../../core/scheduling-rules';
import {
	diffGanttDateKeys,
	normalizeGanttDateKey,
	projectTaskToGantt,
	shiftGanttDateKey,
} from '../../systems/gantt-core';
import type { IndexedTask } from '../../types/fields';
import type { GanttTaskProjection } from '../../types/gantt';
import type { GanttDateAxis } from '../../types/gantt';
import type { TableGanttOneDayClickBehavior } from '../../types/table';
import {
	buildTableGanttDependencyPath,
	resolveTableGanttDependencyDirection,
	TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX,
	type TableGanttDependencyEdge,
	type TableGanttDependencyOccurrence,
	type TableGanttDependencyPortSide,
} from './table-gantt-dependencies';
import type { TableTaskTreeRenderItem } from './table-task-tree';

export type TableGanttEditIntent =
	| 'move'
	| 'resize-start'
	| 'resize-end'
	| 'create-scheduled'
	| 'create-range';

export interface TableGanttEditRequest {
	task: IndexedTask;
	intent: TableGanttEditIntent;
	targetDate: string;
	endDate?: string;
}

export interface TableGanttEditPlan {
	payload: Record<string, string>;
	projection: GanttTaskProjection;
}

export interface TableGanttLaneSelectionPlanOptions {
	task: IndexedTask;
	startDate: string;
	endDate: string;
	oneDayBehavior: TableGanttOneDayClickBehavior;
}

function withProjection(task: IndexedTask, payload: Record<string, string>): TableGanttEditPlan {
	const nextTask: IndexedTask = {
		...task,
		fieldValues: {
			...task.fieldValues,
			...payload,
		},
	};
	return {
		payload,
		projection: projectTaskToGantt(nextTask),
	};
}

function normalizedOrderedRange(startDate: string, endDate: string): { startDate: string; endDate: string } | null {
	const start = normalizeGanttDateKey(startDate);
	const end = normalizeGanttDateKey(endDate);
	if (!start || !end) return null;
	return start <= end
		? { startDate: start, endDate: end }
		: { startDate: end, endDate: start };
}

export function buildTableGanttLaneSelectionPlan(
	options: TableGanttLaneSelectionPlanOptions,
): TableGanttEditPlan | null {
	if (projectTaskToGantt(options.task).bar) return null;
	const range = normalizedOrderedRange(options.startDate, options.endDate);
	if (!range) return null;
	const isSingleDay = range.startDate === range.endDate;
	if (isSingleDay && options.oneDayBehavior === 'scheduled') {
		return withProjection(options.task, {
			dateScheduled: range.startDate,
			dateStarted: '',
			datetimeStart: '',
			datetimeEnd: '',
		});
	}
	return withProjection(options.task, {
		dateScheduled: '',
		dateStarted: range.startDate,
		dateDue: range.endDate,
		datetimeStart: '',
		datetimeEnd: '',
	});
}

export function buildTableGanttEditPlan(request: TableGanttEditRequest): TableGanttEditPlan | null {
	const targetDate = normalizeGanttDateKey(request.targetDate);
	if (!targetDate) return null;
	if (request.intent === 'create-scheduled' || request.intent === 'create-range') {
		return buildTableGanttLaneSelectionPlan({
			task: request.task,
			startDate: targetDate,
			endDate: request.endDate ?? targetDate,
			oneDayBehavior: request.intent === 'create-scheduled' ? 'scheduled' : 'dateRange',
		});
	}

	const projection = projectTaskToGantt(request.task);
	const bar = projection.bar;
	if (!bar) return null;
	if (bar.kind === 'all-day-range') {
		return buildAllDayRangeEditPlan(request.task, request.intent, targetDate, bar.startDate, bar.endDate);
	}
	if (bar.kind === 'scheduled') {
		return buildScheduledEditPlan(request.task, request.intent, targetDate, bar.startDate);
	}
	if (request.intent === 'resize-start' || request.intent === 'resize-end') {
		return buildTimedRangePromotionPlan(request.task, request.intent, targetDate, bar.startDate, bar.endDate);
	}
	return buildTimedEditPlan(request.task, request.intent, targetDate, bar.startDate, bar.endDate);
}

function buildShiftedTimedPayloadWithinRange(
	task: IndexedTask,
	startDate: string,
	endDate: string,
	deltaDays: number,
): Record<string, string> {
	const fields = task.fieldValues;
	const currentStart = (fields['datetimeStart'] ?? '').trim();
	const storedEnd = (fields['datetimeEnd'] ?? '').trim();
	if (!currentStart) return {};
	const estimateSeconds = parseEstimateSeconds(fields['estimate']);
	const effectiveEnd = storedEnd || (estimateSeconds !== null ? deriveDatetimeEnd(currentStart, estimateSeconds) : '');
	const timedStartDate = normalizeGanttDateKey(extractDatePart(currentStart));
	const timedEndDate = normalizeGanttDateKey(extractDatePart(effectiveEnd));
	if (
		!effectiveEnd
		|| !timedStartDate
		|| !timedEndDate
		|| timedStartDate < startDate
		|| timedEndDate > endDate
	) return {};

	return {
		datetimeStart: shiftDatetimeByDays(currentStart, deltaDays),
		...(storedEnd ? { datetimeEnd: shiftDatetimeByDays(storedEnd, deltaDays) } : {}),
	};
}

function buildAllDayRangeEditPlan(
	task: IndexedTask,
	intent: TableGanttEditIntent,
	targetDate: string,
	startDate: string,
	endDate: string,
): TableGanttEditPlan | null {
	let nextStart = startDate;
	let nextEnd = endDate;
	let shiftedScheduledDate: string | null = null;
	let shiftedTimedPayload: Record<string, string> = {};
	if (intent === 'move') {
		const deltaDays = diffGanttDateKeys(startDate, targetDate);
		if (deltaDays === null) return null;
		nextStart = shiftGanttDateKey(startDate, deltaDays);
		nextEnd = shiftGanttDateKey(endDate, deltaDays);
		const scheduledDate = normalizeGanttDateKey(task.fieldValues['dateScheduled']);
		if (scheduledDate && scheduledDate >= startDate && scheduledDate <= endDate) {
			shiftedScheduledDate = shiftGanttDateKey(scheduledDate, deltaDays);
		}
		shiftedTimedPayload = buildShiftedTimedPayloadWithinRange(task, startDate, endDate, deltaDays);
	} else if (intent === 'resize-start') {
		nextStart = targetDate <= endDate ? targetDate : endDate;
	} else if (intent === 'resize-end') {
		nextEnd = targetDate >= startDate ? targetDate : startDate;
	} else {
		return null;
	}
	return withProjection(task, {
		...(shiftedScheduledDate ? { dateScheduled: shiftedScheduledDate } : {}),
		...shiftedTimedPayload,
		dateStarted: nextStart,
		dateDue: nextEnd,
	});
}

function buildScheduledEditPlan(
	task: IndexedTask,
	intent: TableGanttEditIntent,
	targetDate: string,
	scheduledDate: string,
): TableGanttEditPlan | null {
	if (intent === 'move') {
		return withProjection(task, { dateScheduled: targetDate });
	}
	if (intent !== 'resize-start' && intent !== 'resize-end') return null;
	const range = intent === 'resize-start'
		? { startDate: targetDate <= scheduledDate ? targetDate : scheduledDate, endDate: scheduledDate }
		: { startDate: scheduledDate, endDate: targetDate >= scheduledDate ? targetDate : scheduledDate };
	return withProjection(task, {
		dateStarted: range.startDate,
		dateDue: range.endDate,
	});
}

function buildTimedRangePromotionPlan(
	task: IndexedTask,
	intent: 'resize-start' | 'resize-end',
	targetDate: string,
	startDate: string,
	endDate: string,
): TableGanttEditPlan {
	const range = intent === 'resize-start'
		? { startDate: targetDate <= endDate ? targetDate : endDate, endDate }
		: { startDate, endDate: targetDate >= startDate ? targetDate : startDate };
	return withProjection(task, {
		dateStarted: range.startDate,
		dateDue: range.endDate,
	});
}

function buildTimedEditPlan(
	task: IndexedTask,
	intent: TableGanttEditIntent,
	targetDate: string,
	startDate: string,
	endDate: string,
): TableGanttEditPlan | null {
	if (intent !== 'move') return null;
	const fields = task.fieldValues;
	const currentStart = (fields['datetimeStart'] ?? '').trim();
	const storedEnd = (fields['datetimeEnd'] ?? '').trim();
	if (!currentStart) return null;
	const estimateSeconds = parseEstimateSeconds(fields['estimate']);
	const effectiveEnd = storedEnd || (estimateSeconds !== null ? deriveDatetimeEnd(currentStart, estimateSeconds) : '');
	if (!effectiveEnd) return null;

	const deltaDays = diffGanttDateKeys(startDate, targetDate);
	if (deltaDays === null) return null;
	const nextStart = shiftDatetimeByDays(currentStart, deltaDays);
	const nextEnd = shiftDatetimeByDays(effectiveEnd, deltaDays);
	if (!nextStart || !nextEnd) return null;

	const payload: Record<string, string> = {
		datetimeStart: nextStart,
	};
	if (storedEnd) payload.datetimeEnd = nextEnd;
	if (estimateSeconds !== null) payload.estimate = String(estimateSeconds);
	if (!storedEnd) payload.datetimeEnd = '';
	const scheduled = normalizeGanttDateKey(fields['dateScheduled']);
	if (scheduled && scheduled >= startDate && scheduled <= endDate) {
		payload.dateScheduled = shiftGanttDateKey(scheduled, deltaDays);
	}
	return withProjection(task, payload);
}

export function resolveTableGanttKeyboardDate(
	currentDate: string,
	key: string,
	shiftKey: boolean,
): string | null {
	if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
	const normalized = normalizeGanttDateKey(currentDate);
	if (!normalized) return null;
	const direction = key === 'ArrowLeft' ? -1 : 1;
	return shiftGanttDateKey(normalized, direction * (shiftKey ? 7 : 1));
}

export function resolveTableGanttPointerDate(
	axisStartDate: string,
	axisEndDate: string,
	dayWidthPx: number,
	x: number,
): string | null {
	const start = normalizeGanttDateKey(axisStartDate);
	const end = normalizeGanttDateKey(axisEndDate);
	if (!start || !end || !Number.isFinite(dayWidthPx) || dayWidthPx <= 0 || !Number.isFinite(x)) return null;
	const maxOffset = diffGanttDateKeys(start, end);
	if (maxOffset === null || maxOffset < 0) return null;
	const offset = Math.min(maxOffset, Math.max(0, Math.floor(x / dayWidthPx)));
	return shiftGanttDateKey(start, offset);
}

export interface TableGanttInteractionContext {
	axis: GanttDateAxis;
	items: readonly TableTaskTreeRenderItem[];
	projections: ReadonlyMap<string, GanttTaskProjection>;
	rowHeight: number;
	editable: boolean;
	oneDayBehavior: TableGanttOneDayClickBehavior;
	dependencyOccurrences: ReadonlyMap<string, TableGanttDependencyOccurrence>;
	dependencyLivePathEl: SVGPathElement | null;
	dependencyLiveArrowEl: SVGPathElement | null;
}

export type TableGanttDependencyCandidateState = 'valid' | 'already-exists' | 'rejected' | 'unavailable';
export type TableGanttDependencyMutationOutcome = 'applied' | 'already-exists' | 'rejected' | 'failed';

export interface TableGanttCommitContext {
	intent: TableGanttEditIntent;
	deltaDays: number;
}

export type TableGanttCommitOutcome = boolean | 'cancelled' | 'failed-notified';

export interface TableGanttInteractionControllerOptions {
	canvasEl: HTMLElement;
	scrollerEl: HTMLElement;
	verticalScrollerEl?: HTMLElement;
	onCommit: (
		task: IndexedTask,
		payload: Record<string, string>,
		context: TableGanttCommitContext,
	) => TableGanttCommitOutcome | Promise<TableGanttCommitOutcome>;
	onValidateDependency?: (fromId: string, toId: string) => TableGanttDependencyCandidateState;
	onCreateDependency?: (fromId: string, toId: string) => TableGanttDependencyMutationOutcome | Promise<TableGanttDependencyMutationOutcome>;
	onActivateBar?: (task: IndexedTask, anchor: HTMLElement, activation: 'primary' | 'secondary') => void;
	onRequestRender: () => void;
	onWriteFailure: () => void;
}

interface TableGanttPointerSession {
	pointerId: number;
	task: IndexedTask;
	anchorEl: HTMLElement | null;
	intent: 'move' | 'resize-start' | 'resize-end' | 'create-range';
	anchorDate: string;
	initialClientX: number;
	initialClientY: number;
	latestClientX: number;
	latestClientY: number;
	activated: boolean;
	plan: TableGanttEditPlan | null;
}

interface TableGanttDependencyPointerSession {
	pointerId: number;
	startTaskId: string;
	startSide: TableGanttDependencyPortSide;
	initialClientX: number;
	initialClientY: number;
	latestClientX: number;
	latestClientY: number;
	activated: boolean;
	targetEl: HTMLElement | null;
	direction: { fromId: string; toId: string } | null;
	candidateState: TableGanttDependencyCandidateState;
}

const TABLE_GANTT_DRAG_THRESHOLD_PX = 4;
const TABLE_GANTT_EDGE_SCROLL_ZONE_PX = 32;

function asHTMLElement(value: EventTarget | null, ownerDocument: Document): HTMLElement | null {
	const constructor = ownerDocument.defaultView?.HTMLElement;
	return constructor && value instanceof constructor ? value : null;
}

function getRenderableTask(item: TableTaskTreeRenderItem | undefined): IndexedTask | null {
	return item?.kind === 'task' || item?.kind === 'parentContext' ? item.task : null;
}

export class TableGanttInteractionController {
	private context: TableGanttInteractionContext | null = null;
	private readonly previews = new Map<string, TableGanttEditPlan>();
	private readonly pendingTaskIds = new Set<string>();
	private readonly optimisticDependencyEdges = new Map<string, TableGanttDependencyEdge>();
	private active: TableGanttPointerSession | null = null;
	private dependencyActive: TableGanttDependencyPointerSession | null = null;
	private autoScrollFrame: number | null = null;
	private destroyed = false;

	private readonly onPointerDown = (event: PointerEvent): void => this.handlePointerDown(event);
	private readonly onPointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
	private readonly onPointerUp = (event: PointerEvent): void => this.finishPointerSession(event, true);
	private readonly onPointerCancel = (event: PointerEvent): void => this.finishPointerSession(event, false);
	private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);

	constructor(private readonly options: TableGanttInteractionControllerOptions) {
		options.canvasEl.classList.add('is-gantt-interactive');
		options.canvasEl.addEventListener('pointerdown', this.onPointerDown);
		options.canvasEl.addEventListener('pointermove', this.onPointerMove);
		options.canvasEl.addEventListener('pointerup', this.onPointerUp);
		options.canvasEl.addEventListener('pointercancel', this.onPointerCancel);
		options.canvasEl.addEventListener('keydown', this.onKeyDown);
	}

	updateContext(context: TableGanttInteractionContext): void {
		this.context = context;
		if (this.dependencyActive?.activated) this.updateDependencyPreview();
	}

	resolveProjection(task: IndexedTask, fallback: GanttTaskProjection): GanttTaskProjection {
		return this.previews.get(task.operonId)?.projection ?? fallback;
	}

	private resolveBaseProjection(task: IndexedTask): GanttTaskProjection {
		return this.context?.projections.get(task.operonId) ?? projectTaskToGantt(task);
	}

	isPending(taskId: string): boolean {
		return this.pendingTaskIds.has(taskId);
	}

	getOptimisticDependencyEdges(): readonly TableGanttDependencyEdge[] {
		return [...this.optimisticDependencyEdges.values()];
	}

	supportsDependencyEditing(): boolean {
		return Boolean(this.options.onValidateDependency && this.options.onCreateDependency);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.cancelAutoScroll();
		this.active = null;
		this.clearDependencySession();
		this.previews.clear();
		this.optimisticDependencyEdges.clear();
		this.options.canvasEl.classList.remove('is-gantt-interactive', 'is-gantt-dragging');
		this.options.canvasEl.removeEventListener('pointerdown', this.onPointerDown);
		this.options.canvasEl.removeEventListener('pointermove', this.onPointerMove);
		this.options.canvasEl.removeEventListener('pointerup', this.onPointerUp);
		this.options.canvasEl.removeEventListener('pointercancel', this.onPointerCancel);
		this.options.canvasEl.removeEventListener('keydown', this.onKeyDown);
	}

	private handlePointerDown(event: PointerEvent): void {
		const context = this.context;
		if (!context?.editable || event.button !== 0 || this.active || this.dependencyActive) return;
		const target = asHTMLElement(event.target, this.options.canvasEl.ownerDocument);
		const dependencyPort = target?.closest<HTMLElement>('.operon-table-gantt-dependency-port') ?? null;
		if (dependencyPort && this.beginDependencySession(event, dependencyPort)) return;
		const bar = target?.closest<HTMLElement>('.operon-table-gantt-bar') ?? null;
		const editHandle = target?.closest<HTMLElement>('.operon-table-gantt-resize-handle') ?? null;
		const task = bar
			? this.findTask(bar.dataset.ganttTaskId ?? '')
			: this.resolveTaskAtClientY(event.clientY);
		if (!task || this.pendingTaskIds.has(task.operonId)) return;
		const projection = this.resolveProjection(task, this.resolveBaseProjection(task));
		let intent: TableGanttPointerSession['intent'];
		if (bar) {
			const requestedIntent = editHandle?.dataset.ganttEditIntent;
			intent = requestedIntent === 'resize-start' || requestedIntent === 'resize-end'
				? requestedIntent
				: 'move';
			if (!projection.bar) return;
		} else {
			if (projection.bar) return;
			intent = 'create-range';
		}
		const anchorDate = this.resolveDateAtClientX(event.clientX);
		if (!anchorDate) return;
		this.active = {
			pointerId: event.pointerId,
			task,
			anchorEl: bar,
			intent,
			anchorDate,
			initialClientX: event.clientX,
			initialClientY: event.clientY,
			latestClientX: event.clientX,
			latestClientY: event.clientY,
			activated: false,
			plan: null,
		};
		(editHandle ?? bar)?.focus({ preventScroll: true });
		this.options.canvasEl.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	}

	private handlePointerMove(event: PointerEvent): void {
		if (this.dependencyActive?.pointerId === event.pointerId) {
			this.handleDependencyPointerMove(event);
			return;
		}
		const active = this.active;
		if (!active || active.pointerId !== event.pointerId) return;
		active.latestClientX = event.clientX;
		active.latestClientY = event.clientY;
		if (!active.activated) {
			const distance = Math.hypot(
				event.clientX - active.initialClientX,
				event.clientY - active.initialClientY,
			);
			if (distance < TABLE_GANTT_DRAG_THRESHOLD_PX) return;
			active.activated = true;
			this.options.canvasEl.classList.add('is-gantt-dragging');
		}
		this.updateActivePlan();
		this.updateAutoScroll();
		event.preventDefault();
	}

	private finishPointerSession(event: PointerEvent, commit: boolean): void {
		if (this.dependencyActive?.pointerId === event.pointerId) {
			this.finishDependencySession(event, commit);
			return;
		}
		const active = this.active;
		if (!active || active.pointerId !== event.pointerId) return;
		active.latestClientX = event.clientX;
		active.latestClientY = event.clientY;
		this.cancelAutoScroll();
		if (this.options.canvasEl.hasPointerCapture?.(event.pointerId)) {
			this.options.canvasEl.releasePointerCapture?.(event.pointerId);
		}
		this.options.canvasEl.classList.remove('is-gantt-dragging');
		if (commit) {
			if (active.intent === 'create-range' && !active.activated) {
				const context = this.context;
				active.plan = context ? buildTableGanttLaneSelectionPlan({
					task: active.task,
					startDate: active.anchorDate,
					endDate: active.anchorDate,
					oneDayBehavior: context.oneDayBehavior,
				}) : null;
			} else if (active.activated) {
				this.updateActivePlan();
			}
		}
		this.active = null;
		if (commit && !active.activated && active.intent === 'move') {
			if (active.anchorEl) this.options.onActivateBar?.(active.task, active.anchorEl, 'primary');
			return;
		}
		if (!commit || !active.plan || (!active.activated && active.intent !== 'create-range')) {
			this.previews.delete(active.task.operonId);
			this.options.onRequestRender();
			return;
		}
		void this.commitPlan(active.task, active.plan, active.intent);
	}

	private beginDependencySession(event: PointerEvent, port: HTMLElement): boolean {
		if (!this.options.onCreateDependency || !this.options.onValidateDependency) return false;
		const startTaskId = (port.dataset.ganttTaskId ?? '').trim();
		const startSide = port.dataset.ganttDependencySide;
		if (!startTaskId || (startSide !== 'incoming' && startSide !== 'outgoing')) return false;
		if (this.pendingTaskIds.has(startTaskId) || !this.context?.dependencyOccurrences.has(startTaskId)) return false;
		this.dependencyActive = {
			pointerId: event.pointerId,
			startTaskId,
			startSide,
			initialClientX: event.clientX,
			initialClientY: event.clientY,
			latestClientX: event.clientX,
			latestClientY: event.clientY,
			activated: false,
			targetEl: null,
			direction: null,
			candidateState: 'unavailable',
		};
		port.closest<HTMLElement>('.operon-table-gantt-bar')?.focus({ preventScroll: true });
		this.options.canvasEl.setPointerCapture?.(event.pointerId);
		event.preventDefault();
		return true;
	}

	private handleDependencyPointerMove(event: PointerEvent): void {
		const active = this.dependencyActive;
		if (!active || active.pointerId !== event.pointerId) return;
		active.latestClientX = event.clientX;
		active.latestClientY = event.clientY;
		if (!active.activated) {
			const distance = Math.hypot(
				event.clientX - active.initialClientX,
				event.clientY - active.initialClientY,
			);
			if (distance < TABLE_GANTT_DRAG_THRESHOLD_PX) return;
			active.activated = true;
			this.options.canvasEl.classList.add('is-gantt-dependency-dragging');
		}
		this.updateDependencyPreview();
		this.updateAutoScroll();
		event.preventDefault();
	}

	private finishDependencySession(event: PointerEvent, commit: boolean): void {
		const active = this.dependencyActive;
		if (!active || active.pointerId !== event.pointerId) return;
		active.latestClientX = event.clientX;
		active.latestClientY = event.clientY;
		this.cancelAutoScroll();
		if (this.options.canvasEl.hasPointerCapture?.(event.pointerId)) {
			this.options.canvasEl.releasePointerCapture?.(event.pointerId);
		}
		if (commit && active.activated) this.updateDependencyPreview();
		const direction = commit && active.activated && (
			active.candidateState === 'valid' || active.candidateState === 'already-exists'
		) ? active.direction : null;
		this.clearDependencySession();
		if (direction) void this.commitDependency(direction.fromId, direction.toId);
	}

	private updateDependencyPreview(): void {
		const active = this.dependencyActive;
		const context = this.context;
		if (!active?.activated || !context) return;
		this.clearDependencyTargetState(active);
		const hit = this.options.canvasEl.ownerDocument.elementFromPoint(
			active.latestClientX,
			active.latestClientY,
		);
		const target = asHTMLElement(hit, this.options.canvasEl.ownerDocument)
			?.closest<HTMLElement>('.operon-table-gantt-dependency-port') ?? null;
		const targetTaskId = (target?.dataset.ganttTaskId ?? '').trim();
		const targetSide = target?.dataset.ganttDependencySide;
		const direction = target && (targetSide === 'incoming' || targetSide === 'outgoing')
			? resolveTableGanttDependencyDirection(active.startTaskId, active.startSide, targetTaskId, targetSide)
			: null;
		const candidateState = direction && !this.pendingTaskIds.has(direction.fromId) && !this.pendingTaskIds.has(direction.toId)
			? this.options.onValidateDependency?.(direction.fromId, direction.toId) ?? 'unavailable'
			: 'unavailable';
		active.targetEl = target;
		active.direction = direction;
		active.candidateState = candidateState;
		if (target) {
			target.classList.add(
				candidateState === 'valid' || candidateState === 'already-exists'
					? 'is-valid-target'
					: 'is-invalid-target',
			);
		}
		this.options.canvasEl.classList.toggle(
			'is-gantt-dependency-invalid',
			Boolean(target) && candidateState !== 'valid' && candidateState !== 'already-exists',
		);
		const startOccurrence = context.dependencyOccurrences.get(active.startTaskId);
		if (!startOccurrence) return;
		const startX = active.startSide === 'outgoing'
			? startOccurrence.right + TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX
			: startOccurrence.left - TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX;
		const canvasRect = this.options.canvasEl.getBoundingClientRect();
		let endX = active.latestClientX - canvasRect.left;
		let endY = active.latestClientY - canvasRect.top;
		if (target && direction && (candidateState === 'valid' || candidateState === 'already-exists')) {
			const targetOccurrence = context.dependencyOccurrences.get(targetTaskId);
			if (targetOccurrence) {
				endX = targetSide === 'incoming'
					? targetOccurrence.left - TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX
					: targetOccurrence.right + TABLE_GANTT_DEPENDENCY_PORT_OFFSET_PX;
				endY = targetOccurrence.centerY;
			}
		}
		const startY = startOccurrence.centerY;
		const path = active.startSide === 'outgoing'
			? buildTableGanttDependencyPath(startX, startY, endX, endY)
			: buildTableGanttDependencyPath(endX, endY, startX, startY);
		context.dependencyLivePathEl?.setAttribute('d', path.path);
		context.dependencyLiveArrowEl?.setAttribute('d', path.arrowPath);
	}

	private clearDependencyTargetState(active: TableGanttDependencyPointerSession): void {
		active.targetEl?.classList.remove('is-valid-target', 'is-invalid-target');
		active.targetEl = null;
	}

	private clearDependencySession(): void {
		if (this.dependencyActive) this.clearDependencyTargetState(this.dependencyActive);
		this.dependencyActive = null;
		this.options.canvasEl.classList.remove('is-gantt-dependency-dragging', 'is-gantt-dependency-invalid');
		this.context?.dependencyLivePathEl?.removeAttribute('d');
		this.context?.dependencyLiveArrowEl?.removeAttribute('d');
	}

	private async commitDependency(fromId: string, toId: string): Promise<void> {
		if (!this.options.onCreateDependency || this.pendingTaskIds.has(fromId) || this.pendingTaskIds.has(toId)) return;
		const key = `${fromId}\u0000${toId}`;
		this.pendingTaskIds.add(fromId);
		this.pendingTaskIds.add(toId);
		this.optimisticDependencyEdges.set(key, { key, fromId, toId });
		this.options.onRequestRender();
		let outcome: TableGanttDependencyMutationOutcome = 'failed';
		try {
			outcome = await this.options.onCreateDependency(fromId, toId);
		} catch (error: unknown) {
			console.error('Operon: Gantt dependency writeback failed', {
				fromId,
				toId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		this.pendingTaskIds.delete(fromId);
		this.pendingTaskIds.delete(toId);
		this.optimisticDependencyEdges.delete(key);
		if (outcome === 'failed') this.options.onWriteFailure();
		this.options.onRequestRender();
	}

	private updateActivePlan(): void {
		const active = this.active;
		const context = this.context;
		if (!active || !context) return;
		const targetDate = this.resolveDateAtClientX(active.latestClientX);
		if (!targetDate) return;
		const baseProjection = this.resolveBaseProjection(active.task);
		let plan: TableGanttEditPlan | null = null;
		if (active.intent === 'create-range') {
			plan = buildTableGanttLaneSelectionPlan({
				task: active.task,
				startDate: active.anchorDate,
				endDate: targetDate,
				oneDayBehavior: active.anchorDate === targetDate ? context.oneDayBehavior : 'dateRange',
			});
		} else if (baseProjection.bar) {
			let editDate = targetDate;
			if (active.intent === 'move') {
				const delta = diffGanttDateKeys(active.anchorDate, targetDate);
				if (delta === null) return;
				editDate = shiftGanttDateKey(baseProjection.bar.startDate, delta);
			}
			plan = buildTableGanttEditPlan({
				task: active.task,
				intent: active.intent,
				targetDate: editDate,
			});
		}
		active.plan = plan;
		if (plan) this.previews.set(active.task.operonId, plan);
		else this.previews.delete(active.task.operonId);
		this.options.onRequestRender();
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && this.dependencyActive) {
			const pointerId = this.dependencyActive.pointerId;
			this.cancelAutoScroll();
			if (this.options.canvasEl.hasPointerCapture?.(pointerId)) {
				this.options.canvasEl.releasePointerCapture?.(pointerId);
			}
			this.clearDependencySession();
			event.preventDefault();
			return;
		}
		if (event.key === 'Escape' && this.active) {
			const taskId = this.active.task.operonId;
			const pointerId = this.active.pointerId;
			this.cancelAutoScroll();
			this.active = null;
			if (this.options.canvasEl.hasPointerCapture?.(pointerId)) {
				this.options.canvasEl.releasePointerCapture?.(pointerId);
			}
			this.previews.delete(taskId);
			this.options.canvasEl.classList.remove('is-gantt-dragging');
			this.options.onRequestRender();
			event.preventDefault();
			return;
		}
		const target = asHTMLElement(event.target, this.options.canvasEl.ownerDocument);
		const bar = target?.closest<HTMLElement>('.operon-table-gantt-bar');
		if (!bar) return;
		const task = this.findTask(bar.dataset.ganttTaskId ?? '');
		if (!task || this.pendingTaskIds.has(task.operonId)) return;
		const secondary = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
		if (secondary) {
			event.preventDefault();
			event.stopPropagation();
			this.options.onActivateBar?.(task, bar, 'secondary');
			return;
		}
		const context = this.context;
		if (!context?.editable) return;
		if ((event.key === 'Enter' || event.key === ' ') && !target?.closest('.operon-table-gantt-resize-handle')) {
			event.preventDefault();
			event.stopPropagation();
			this.options.onActivateBar?.(task, bar, 'primary');
			return;
		}
		const projection = this.resolveProjection(task, this.resolveBaseProjection(task));
		if (!projection.bar) return;
		const requestedIntent = target?.closest<HTMLElement>('.operon-table-gantt-resize-handle')?.dataset.ganttEditIntent;
		const intent = requestedIntent === 'resize-start' || requestedIntent === 'resize-end'
			? requestedIntent
			: 'move';
		const currentDate = intent === 'resize-end' ? projection.bar.endDate : projection.bar.startDate;
		const targetDate = resolveTableGanttKeyboardDate(currentDate, event.key, event.shiftKey);
		if (!targetDate) return;
		const plan = buildTableGanttEditPlan({ task, intent, targetDate });
		if (!plan) return;
		event.preventDefault();
		event.stopPropagation();
		this.previews.set(task.operonId, plan);
		this.options.onRequestRender();
		void this.commitPlan(task, plan, intent);
	}

	private async commitPlan(
		task: IndexedTask,
		plan: TableGanttEditPlan,
		intent: TableGanttEditIntent,
	): Promise<void> {
		if (this.pendingTaskIds.has(task.operonId)) return;
		if (!Object.entries(plan.payload).some(([key, value]) => (task.fieldValues[key] ?? '') !== value)) {
			this.previews.delete(task.operonId);
			this.options.onRequestRender();
			return;
		}
		this.pendingTaskIds.add(task.operonId);
		this.previews.set(task.operonId, plan);
		this.options.onRequestRender();
		let outcome: TableGanttCommitOutcome = false;
		try {
			const baseProjection = this.resolveBaseProjection(task);
			const deltaDays = intent === 'move' && baseProjection.bar && plan.projection.bar
				? diffGanttDateKeys(baseProjection.bar.startDate, plan.projection.bar.startDate) ?? 0
				: 0;
			outcome = await this.options.onCommit(task, plan.payload, { intent, deltaDays });
		} catch (error: unknown) {
			console.error('Operon: Gantt task writeback failed', {
				operonId: task.operonId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		this.pendingTaskIds.delete(task.operonId);
		this.previews.delete(task.operonId);
		if (outcome === false) this.options.onWriteFailure();
		this.options.onRequestRender();
	}

	private findTask(taskId: string): IndexedTask | null {
		if (!taskId || !this.context) return null;
		for (const item of this.context.items) {
			const task = getRenderableTask(item);
			if (task?.operonId === taskId) return task;
		}
		return null;
	}

	private resolveTaskAtClientY(clientY: number): IndexedTask | null {
		const context = this.context;
		if (!context || context.rowHeight <= 0) return null;
		const rect = this.options.canvasEl.getBoundingClientRect();
		const index = Math.floor((clientY - rect.top) / context.rowHeight);
		return getRenderableTask(context.items[index]);
	}

	private resolveDateAtClientX(clientX: number): string | null {
		const axis = this.context?.axis;
		if (!axis) return null;
		const rect = this.options.canvasEl.getBoundingClientRect();
		return resolveTableGanttPointerDate(
			axis.startDate,
			axis.endDate,
			axis.dayWidthPx,
			clientX - rect.left,
		);
	}

	private updateAutoScroll(): void {
		const active = this.dependencyActive?.activated ? this.dependencyActive : this.active;
		if (!active?.activated || this.autoScrollFrame !== null) return;
		const rect = this.options.scrollerEl.getBoundingClientRect();
		const horizontalDirection = active.latestClientX < rect.left + TABLE_GANTT_EDGE_SCROLL_ZONE_PX
			? -1
			: active.latestClientX > rect.right - TABLE_GANTT_EDGE_SCROLL_ZONE_PX
				? 1
				: 0;
		const verticalDirection = this.dependencyActive && this.options.verticalScrollerEl
			? active.latestClientY < rect.top + TABLE_GANTT_EDGE_SCROLL_ZONE_PX
				? -1
				: active.latestClientY > rect.bottom - TABLE_GANTT_EDGE_SCROLL_ZONE_PX
					? 1
					: 0
			: 0;
		if (horizontalDirection === 0 && verticalDirection === 0) return;
		const ownerWindow = this.options.canvasEl.ownerDocument.defaultView;
		if (!ownerWindow) return;
		this.autoScrollFrame = ownerWindow.requestAnimationFrame(() => {
			this.autoScrollFrame = null;
			const currentActive = this.dependencyActive?.activated ? this.dependencyActive : this.active;
			if (!currentActive?.activated || !this.context) return;
			const previousHorizontal = this.options.scrollerEl.scrollLeft;
			const previousVertical = this.options.verticalScrollerEl?.scrollTop ?? 0;
			this.options.scrollerEl.scrollLeft += horizontalDirection * Math.max(2, this.context.axis.dayWidthPx / 4);
			if (this.dependencyActive && this.options.verticalScrollerEl) {
				this.options.verticalScrollerEl.scrollTop += verticalDirection * Math.max(2, this.context.rowHeight / 4);
			}
			const scrolled = this.options.scrollerEl.scrollLeft !== previousHorizontal
				|| (this.options.verticalScrollerEl?.scrollTop ?? 0) !== previousVertical;
			if (scrolled) {
				if (this.dependencyActive) this.updateDependencyPreview();
				else this.updateActivePlan();
				this.updateAutoScroll();
			}
		});
	}

	private cancelAutoScroll(): void {
		if (this.autoScrollFrame === null) return;
		this.options.canvasEl.ownerDocument.defaultView?.cancelAnimationFrame(this.autoScrollFrame);
		this.autoScrollFrame = null;
	}
}
