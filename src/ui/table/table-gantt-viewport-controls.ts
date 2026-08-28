import { setIcon } from 'obsidian';

import { t } from '../../core/i18n';
import {
	GANTT_SCALES,
	GANTT_UNIT_WIDTH_MULTIPLIERS,
	type GanttScale,
	type GanttUnitWidthMultiplier,
} from '../../types/gantt';
import type { TableGanttSettings } from '../../types/table';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';

export type TableGanttZoomDirection = 'out' | 'in';

export interface TableGanttViewportControlsOptions {
	hostEl: HTMLElement;
	gantt: TableGanttSettings;
	canChangePreset: boolean;
	onGoToToday: () => void;
	onCommitGantt: (gantt: TableGanttSettings) => Promise<void>;
	onCommitError: (error: unknown) => void;
	onInteraction?: () => void;
}

export function resolveNextTableGanttScale(scale: GanttScale): GanttScale {
	const index = GANTT_SCALES.indexOf(scale);
	return GANTT_SCALES[(index + 1 + GANTT_SCALES.length) % GANTT_SCALES.length] ?? GANTT_SCALES[0];
}

export function resolveTableGanttZoomStep(
	unitWidthMultiplier: GanttUnitWidthMultiplier,
	direction: TableGanttZoomDirection,
): GanttUnitWidthMultiplier {
	const index = GANTT_UNIT_WIDTH_MULTIPLIERS.indexOf(unitWidthMultiplier);
	const offset = direction === 'in' ? 1 : -1;
	const nextIndex = Math.min(
		GANTT_UNIT_WIDTH_MULTIPLIERS.length - 1,
		Math.max(0, index + offset),
	);
	return GANTT_UNIT_WIDTH_MULTIPLIERS[nextIndex] ?? unitWidthMultiplier;
}

export function renderTableGanttViewportControls(options: TableGanttViewportControlsOptions): void {
	const controls = options.hostEl.createDiv('operon-table-gantt-viewport-controls');
	const left = controls.createDiv('operon-table-gantt-viewport-controls-left');
	const right = controls.createDiv('operon-table-gantt-viewport-controls-right');
	let current = { ...options.gantt };
	let commitInFlight = false;

	const createButton = (
		host: HTMLElement,
		className: string,
		icon: string,
		label: string,
		onActivate: () => void,
	): HTMLButtonElement => {
		const button = host.createEl('button', {
			cls: `operon-table-gantt-viewport-control-button ${className}`,
			attr: { type: 'button' },
		});
		setIcon(button, icon);
		setAccessibleLabelWithoutTooltip(button, label);
		bindOperonHoverTooltip(button, {
			content: label,
			taskColor: null,
			preferredVertical: 'below',
		});
		button.addEventListener('pointerdown', event => event.stopPropagation());
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			onActivate();
		});
		return button;
	};

	createButton(
		left,
		'is-today',
		'locate-fixed',
		t('calendar', 'mobileGoToToday'),
		() => {
			options.onInteraction?.();
			options.onGoToToday();
		},
	);

	const scaleButton = createButton(
		right,
		'is-scale',
		'calendar-range',
		t('table', 'ganttChangeTimelineScale'),
		() => {
			void commit({ ...current, scale: resolveNextTableGanttScale(current.scale) });
		},
	);
	const zoomOutButton = createButton(
		right,
		'is-zoom-out',
		'minus',
		t('table', 'ganttZoomOut'),
		() => {
			void commit({
				...current,
				unitWidthMultiplier: resolveTableGanttZoomStep(current.unitWidthMultiplier, 'out'),
			});
		},
	);
	const zoomInButton = createButton(
		right,
		'is-zoom-in',
		'plus',
		t('table', 'ganttZoomIn'),
		() => {
			void commit({
				...current,
				unitWidthMultiplier: resolveTableGanttZoomStep(current.unitWidthMultiplier, 'in'),
			});
		},
	);

	const syncDisabledState = (): void => {
		const unavailable = !options.canChangePreset || commitInFlight;
		scaleButton.disabled = unavailable || GANTT_SCALES.length < 2;
		zoomOutButton.disabled = unavailable
			|| current.unitWidthMultiplier === GANTT_UNIT_WIDTH_MULTIPLIERS[0];
		zoomInButton.disabled = unavailable
			|| current.unitWidthMultiplier === GANTT_UNIT_WIDTH_MULTIPLIERS[GANTT_UNIT_WIDTH_MULTIPLIERS.length - 1];
	};

	async function commit(next: TableGanttSettings): Promise<void> {
		if (!options.canChangePreset || commitInFlight || JSON.stringify(next) === JSON.stringify(current)) return;
		const previous = current;
		current = next;
		commitInFlight = true;
		syncDisabledState();
		options.onInteraction?.();
		try {
			await options.onCommitGantt(next);
		} catch (error) {
			current = previous;
			options.onCommitError(error);
		} finally {
			commitInFlight = false;
			syncDisabledState();
		}
	}

	syncDisabledState();
}
