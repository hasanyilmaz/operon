import { App, Component, MarkdownRenderer, Notice, setIcon, setTooltip } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { parseLocationCoordinate } from '../core/location-coordinates';
import { buildLocationPreviewBaseMarkdown, isMapsPluginEnabled } from '../core/location-base-map';
import { t } from '../core/i18n';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { OperonSettings } from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import {
	createFloatingPanel,
	positionFloatingElement,
	type FloatingPanelCloseReason,
} from './field-pickers/common';

const PREVIEW_DOUBLE_FACTOR = 2;
const PREVIEW_EXPANDED_VIEWPORT_RATIO = 0.9;
const PREVIEW_MIN_WIDTH = 240;
const PREVIEW_MIN_HEIGHT = 160;
const PHONE_PREVIEW_MAX_WIDTH = 700;
const PHONE_INITIAL_TOP_RATIO = 0.10;
const LOCATION_PREVIEW_DRAG_PIN_THRESHOLD = 4;
const LOCATION_PREVIEW_BASE_Z_INDEX = 10070;
const LOCATION_PREVIEW_HEIGHT_TARGET_SELECTOR = [
	'.bases-embed',
	'.bases-view',
	'.bases-content',
	'.bases-view-content',
	'.bases-view-container',
	'.bases-scroll',
	'.bases-scroll-container',
	'.bases-results',
	'.bases-map-container',
	'.bases-map',
	'.maplibregl-map',
	'.maplibregl-canvas-container',
].join(', ');

let locationPreviewZIndex = LOCATION_PREVIEW_BASE_Z_INDEX;

export function showLocationMapPreview(
	app: App,
	anchor: HTMLElement | DOMRect,
	settings: Pick<OperonSettings,
		| 'keyMappings'
		| 'locationMapsAlwaysLightMode'
		| 'locationPlaceIconPropertyName'
		| 'locationPlaceColorPropertyName'
		| 'locationPreviewWidth'
		| 'locationPreviewHeight'
		| 'locationPreviewDefaultZoom'
		| 'locationPreviewMinZoom'
		| 'locationPreviewMaxZoom'
	>,
	coordinateText: string,
	sourcePath = '',
	taskColor: string | null = null,
	markerIcon: string | null = null,
	markerColor: string | null = null,
	placePath: string | null = null,
	taskDescription: string | null = null,
): void {
	const coordinate = parseLocationCoordinate(coordinateText);
	if (!coordinate) {
		new Notice(t('location', 'invalidCoordinates'));
		return;
	}
	if (!isMapsPluginEnabled(app)) {
		new Notice(t('location', 'mapsPluginUnavailable'));
		return;
	}

	const component = new Component();
	component.load();
	const normalizedMarkerColor = normalizeTaskFieldColor(markerColor);
	const normalizedTaskColor = normalizeTaskFieldColor(taskColor);
	const previewAccentColor = normalizedTaskColor ?? normalizedMarkerColor ?? 'var(--interactive-accent)';
	const hasPlacePath = !!placePath?.trim();
	const effectiveMarkerColor = normalizedMarkerColor ?? (!hasPlacePath ? normalizedTaskColor : null);
	let pinned = false;
	const { panel, close } = createFloatingPanel(
		anchor,
		'operon-floating-panel operon-location-map-preview-panel',
		() => component.unload(),
		{
			closeOnWindowResize: false,
			repositionOnWindowResize: false,
			repositionOnPanelResize: false,
			repositionOnScroll: false,
			shouldClose: reason => shouldCloseLocationPreview(reason, pinned),
		},
	);
	const defaultWidth = normalizePreviewDimension(settings.locationPreviewWidth, 420, PREVIEW_MIN_WIDTH, 2000);
	const defaultHeight = normalizePreviewDimension(settings.locationPreviewHeight, 280, PREVIEW_MIN_HEIGHT, 2000);
	let currentSize = clampPreviewSize(panel, defaultWidth, defaultHeight);
	const usePhoneInitialPlacement = isPhoneLocationPreview(panel);
	let expanded = false;
	let pinButton: HTMLButtonElement | null = null;
	let desktopResetPosition: LocationPreviewPoint | null = null;
	let mapHost: HTMLElement | null = null;

	const syncCurrentPreviewMapHeight = (): void => {
		if (!mapHost) return;
		syncLocationPreviewMapHeight(mapHost, currentSize.height);
	};

	const updatePinControlState = (): void => {
		panel.classList.toggle('is-pinned', pinned);
		if (!pinButton) return;
		pinButton.classList.toggle('is-pinned', pinned);
		pinButton.setAttribute('aria-pressed', pinned ? 'true' : 'false');
		setLocationPreviewButtonIconAndLabel(
			pinButton,
			'pin',
			t('location', pinned ? 'previewUnpin' : 'previewPin'),
		);
	};

	const setPinned = (nextPinned: boolean): void => {
		if (pinned === nextPinned) return;
		pinned = nextPinned;
		updatePinControlState();
		bringLocationPreviewToFront(panel);
	};

	const getDefaultPreviewSize = (): LocationPreviewSize => clampPreviewSize(panel, defaultWidth, defaultHeight);
	const rememberDesktopResetPosition = (): void => {
		if (usePhoneInitialPlacement) return;
		if (desktopResetPosition && !isSameLocationPreviewSize(currentSize, getDefaultPreviewSize())) return;
		desktopResetPosition = getLocationPreviewPanelPoint(panel);
	};
	const updateDesktopResetPosition = (): void => {
		if (usePhoneInitialPlacement) return;
		desktopResetPosition = getLocationPreviewPanelPoint(panel);
	};

	const applySize = (
		size: LocationPreviewSize,
		placement: LocationPreviewPlacement,
		targetPoint: LocationPreviewPoint | null = null,
	): void => {
		bringLocationPreviewToFront(panel);
		const previousRect = panel.getBoundingClientRect();
		const previousCenter = {
			x: previousRect.left + previousRect.width / 2,
			y: previousRect.top + previousRect.height / 2,
		};
		panel.style.setProperty('--operon-location-preview-width', `${size.width}px`);
		panel.style.setProperty('--operon-location-preview-height', `${size.height}px`);
		currentSize = size;
		expanded = isLocationPreviewAtExpandedSize(panel, currentSize);
		syncCurrentPreviewMapHeight();
		scheduleLocationPreviewLayout(panel, anchor, size, placement, previousCenter, targetPoint);
	};
	panel.setCssProps({
		'--operon-location-map-border': previewAccentColor,
	});
	bringLocationPreviewToFront(panel);
	applySize(currentSize, usePhoneInitialPlacement ? 'phone-initial' : 'none');

	panel.addEventListener('pointerdown', () => bringLocationPreviewToFront(panel));

	const body = panel.createDiv('operon-location-map-preview-body');
	mapHost = body.createDiv('operon-location-map-preview-render');
	syncCurrentPreviewMapHeight();
	const closeButton = createLocationPreviewIconButton(
		body,
		'operon-location-map-preview-close',
		'x',
		t('location', 'previewClose'),
		() => close(),
	);
	if (shouldShowLocationPreviewDragHandle(panel)) {
		const leftControls = body.createDiv('operon-location-map-preview-left-controls');
		createLocationPreviewDragHandle(leftControls, panel, () => setPinned(true), updateDesktopResetPosition);
		pinButton = createLocationPreviewIconButton(
			leftControls,
			'operon-location-map-preview-pin-button',
			'pin',
			t('location', 'previewPin'),
			() => setPinned(!pinned),
		);
		updatePinControlState();
	}
	const controlRail = body.createDiv('operon-location-map-preview-size-controls');
	const doubleButton = createLocationPreviewTextButton(
		controlRail,
		'operon-location-map-preview-size-button operon-location-map-preview-scale-button',
		'2x',
		t('location', 'previewDouble'),
		() => {
			if (expanded) return;
			rememberDesktopResetPosition();
			applySize(
				clampPreviewSize(
					panel,
					currentSize.width * PREVIEW_DOUBLE_FACTOR,
					currentSize.height * PREVIEW_DOUBLE_FACTOR,
				),
				'preserve-center',
			);
			updateResizeControlState();
		},
	);
	const expandButton = createLocationPreviewIconButton(
		controlRail,
		'operon-location-map-preview-size-button',
		'maximize-2',
		t('location', 'previewExpand'),
		() => {
			if (expanded) return;
			rememberDesktopResetPosition();
			applySize(getExpandedPreviewSize(panel), 'center');
			updateResizeControlState();
		},
	);
	const resetButton = createLocationPreviewIconButton(
		controlRail,
		'operon-location-map-preview-size-button',
		'rotate-ccw',
		t('location', 'previewReset'),
		() => {
			const resetSize = getDefaultPreviewSize();
			const resetPlacement = usePhoneInitialPlacement ? 'phone-initial' : 'fixed-point';
			const resetPoint = usePhoneInitialPlacement
				? null
				: desktopResetPosition ?? getLocationPreviewPanelPoint(panel);
			applySize(
				resetSize,
				resetPlacement,
				resetPoint,
			);
			updateResizeControlState();
		},
	);
	const updateResizeControlState = (): void => {
		doubleButton.disabled = expanded;
		doubleButton.classList.toggle('is-disabled', expanded);
		expandButton.disabled = expanded;
		expandButton.classList.toggle('is-disabled', expanded);
		resetButton.disabled = isSameLocationPreviewSize(
			currentSize,
			getDefaultPreviewSize(),
		);
		resetButton.classList.toggle('is-disabled', resetButton.disabled);
	};
	updateResizeControlState();
	closeButton.dataset.operonLocationPreviewRole = 'close';

	const markdown = buildLocationPreviewBaseMarkdown({
		settings,
		coordinate,
		height: settings.locationPreviewHeight,
		defaultZoom: settings.locationPreviewDefaultZoom,
		minZoom: settings.locationPreviewMinZoom,
		maxZoom: settings.locationPreviewMaxZoom,
		markerIcon,
		markerColor: effectiveMarkerColor,
		placePath,
		taskDescription,
	});
	void MarkdownRenderer.render(
		app,
		markdown,
		mapHost,
		sourcePath || app.workspace.getActiveFile()?.path || '',
		component,
	).then(() => {
		syncCurrentPreviewMapHeight();
		getOwnerWindow(panel).requestAnimationFrame(syncCurrentPreviewMapHeight);
	});
}

interface LocationPreviewSize {
	width: number;
	height: number;
}

type LocationPreviewPlacement = 'none' | 'preserve-center' | 'center' | 'phone-initial' | 'anchor' | 'fixed-point';

interface LocationPreviewPoint {
	x: number;
	y: number;
}

interface LocationPreviewViewport {
	left: number;
	top: number;
	width: number;
	height: number;
	marginX: number;
	marginY: number;
}

interface LocationPreviewDragState {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startLeft: number;
	startTop: number;
	size: LocationPreviewSize;
	hasMoved: boolean;
}

function createLocationPreviewDragHandle(
	container: HTMLElement,
	panel: HTMLElement,
	onAutoPin: () => void,
	onPositionChange: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: 'operon-location-map-preview-drag-handle',
		attr: { type: 'button' },
	});
	setLocationPreviewButtonIconAndLabel(button, 'move', t('location', 'previewMove'));
	let dragState: LocationPreviewDragState | null = null;

	const endDrag = (): void => {
		if (!dragState) return;
		if (button.hasPointerCapture(dragState.pointerId)) {
			button.releasePointerCapture(dragState.pointerId);
		}
		dragState = null;
		panel.removeClass('is-dragging');
		button.removeClass('is-dragging');
	};

	button.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		stopLocationPreviewControlEvent(event);
		bringLocationPreviewToFront(panel);
		const rect = panel.getBoundingClientRect();
		dragState = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startLeft: rect.left,
			startTop: rect.top,
			size: {
				width: rect.width,
				height: rect.height,
			},
			hasMoved: false,
		};
		button.setPointerCapture(event.pointerId);
		panel.addClass('is-dragging');
		button.addClass('is-dragging');
	});
	button.addEventListener('pointermove', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopLocationPreviewControlEvent(event);
		const deltaX = event.clientX - dragState.startClientX;
		const deltaY = event.clientY - dragState.startClientY;
		const previousLeft = panel.style.left;
		const previousTop = panel.style.top;
		setLocationPreviewPanelPosition(
			panel,
			dragState.size,
			dragState.startLeft + deltaX,
			dragState.startTop + deltaY,
		);
		const movedPanel = panel.style.left !== previousLeft || panel.style.top !== previousTop;
		if (movedPanel) {
			onPositionChange();
		}
		if (!dragState.hasMoved && movedPanel && Math.hypot(deltaX, deltaY) >= LOCATION_PREVIEW_DRAG_PIN_THRESHOLD) {
			dragState.hasMoved = true;
			onAutoPin();
		}
	});
	button.addEventListener('pointerup', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopLocationPreviewControlEvent(event);
		endDrag();
	});
	button.addEventListener('pointercancel', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopLocationPreviewControlEvent(event);
		endDrag();
	});
	button.addEventListener('lostpointercapture', endDrag);
	button.addEventListener('click', stopLocationPreviewControlEvent);
	return button;
}

function shouldCloseLocationPreview(reason: FloatingPanelCloseReason, pinned: boolean): boolean {
	if (!pinned) return true;
	return reason === 'window-resize';
}

function bringLocationPreviewToFront(panel: HTMLElement): void {
	locationPreviewZIndex += 1;
	panel.style.zIndex = String(locationPreviewZIndex);
}

function syncLocationPreviewMapHeight(mapHost: HTMLElement, height: number): void {
	const normalizedHeight = `${Math.round(height)}px`;
	mapHost.style.height = normalizedHeight;
	const targets: NodeListOf<Element> = mapHost.querySelectorAll(LOCATION_PREVIEW_HEIGHT_TARGET_SELECTOR);
	for (let index = 0; index < targets.length; index += 1) {
		const target = targets.item(index);
		if (!target.instanceOf(HTMLElement)) continue;
		target.style.height = normalizedHeight;
	}
}

function getLocationPreviewPanelPoint(panel: HTMLElement): LocationPreviewPoint {
	const rect = panel.getBoundingClientRect();
	return {
		x: rect.left,
		y: rect.top,
	};
}

function createLocationPreviewIconButton(
	container: HTMLElement,
	className: string,
	icon: string,
	label: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: className,
		attr: { type: 'button' },
	});
	setLocationPreviewButtonIconAndLabel(button, icon, label);
	button.addEventListener('pointerdown', stopLocationPreviewControlEvent);
	button.addEventListener('mousedown', stopLocationPreviewControlEvent);
	button.addEventListener('click', event => {
		stopLocationPreviewControlEvent(event);
		onClick();
	});
	return button;
}

function createLocationPreviewTextButton(
	container: HTMLElement,
	className: string,
	text: string,
	label: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: className,
		text,
		attr: {
			type: 'button',
			'aria-label': label,
		},
	});
	setTooltip(button, label);
	button.addEventListener('pointerdown', stopLocationPreviewControlEvent);
	button.addEventListener('mousedown', stopLocationPreviewControlEvent);
	button.addEventListener('click', event => {
		stopLocationPreviewControlEvent(event);
		onClick();
	});
	return button;
}

function setLocationPreviewButtonIconAndLabel(button: HTMLButtonElement, icon: string, label: string): void {
	button.empty();
	setIcon(button, icon);
	setAccessibleLabelWithoutTooltip(button, label);
	setTooltip(button, label);
}

function stopLocationPreviewControlEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

function normalizePreviewDimension(value: number, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.round(Math.max(min, Math.min(max, value)));
}

function clampPreviewSize(panel: HTMLElement, width: number, height: number): LocationPreviewSize {
	const max = getPreviewViewportSize(panel);
	return {
		width: Math.round(Math.max(PREVIEW_MIN_WIDTH, Math.min(width, max.width))),
		height: Math.round(Math.max(PREVIEW_MIN_HEIGHT, Math.min(height, max.height))),
	};
}

function getExpandedPreviewSize(panel: HTMLElement): LocationPreviewSize {
	return getPreviewViewportSize(panel);
}

function shouldShowLocationPreviewDragHandle(panel: HTMLElement): boolean {
	const ownerWindow = getOwnerWindow(panel);
	if (typeof ownerWindow.matchMedia !== 'function') {
		return getLocationPreviewViewport(panel).width > PHONE_PREVIEW_MAX_WIDTH;
	}
	return ownerWindow.matchMedia('(pointer: fine)').matches;
}

function isPhoneLocationPreview(panel: HTMLElement): boolean {
	const ownerWindow = getOwnerWindow(panel);
	const viewport = getLocationPreviewViewport(panel);
	if (viewport.width > PHONE_PREVIEW_MAX_WIDTH) return false;
	if (typeof ownerWindow.matchMedia !== 'function') return true;
	return ownerWindow.matchMedia('(pointer: coarse)').matches;
}

function isLocationPreviewAtExpandedSize(panel: HTMLElement, size: LocationPreviewSize): boolean {
	return isSameLocationPreviewSize(size, getExpandedPreviewSize(panel));
}

function isSameLocationPreviewSize(a: LocationPreviewSize, b: LocationPreviewSize): boolean {
	return Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
}

function getPreviewViewportSize(panel: HTMLElement): LocationPreviewSize {
	const viewport = getLocationPreviewViewport(panel);
	return {
		width: Math.round(Math.max(PREVIEW_MIN_WIDTH, viewport.width - viewport.marginX * 2)),
		height: Math.round(Math.max(PREVIEW_MIN_HEIGHT, viewport.height - viewport.marginY * 2)),
	};
}

function getLocationPreviewViewport(panel: HTMLElement): LocationPreviewViewport {
	const ownerWindow = getOwnerWindow(panel);
	const visualViewport = ownerWindow.visualViewport;
	const width = visualViewport?.width ?? ownerWindow.innerWidth;
	const height = visualViewport?.height ?? ownerWindow.innerHeight;
	const marginX = Math.max(12, width * ((1 - PREVIEW_EXPANDED_VIEWPORT_RATIO) / 2));
	const marginY = Math.max(12, height * ((1 - PREVIEW_EXPANDED_VIEWPORT_RATIO) / 2));
	return {
		left: visualViewport?.offsetLeft ?? 0,
		top: visualViewport?.offsetTop ?? 0,
		width,
		height,
		marginX,
		marginY,
	};
}

function scheduleLocationPreviewLayout(
	panel: HTMLElement,
	anchor: HTMLElement | DOMRect,
	size: LocationPreviewSize,
	placement: LocationPreviewPlacement,
	previousCenter: LocationPreviewPoint,
	targetPoint: LocationPreviewPoint | null = null,
): void {
	const ownerWindow = getOwnerWindow(panel);
	ownerWindow.requestAnimationFrame(() => {
		if (!panel.isConnected) return;
		ownerWindow.dispatchEvent(new Event('resize'));
		if (placement === 'none') return;
		ownerWindow.requestAnimationFrame(() => {
			if (!panel.isConnected) return;
			positionLocationPreviewPanel(panel, anchor, size, placement, previousCenter, targetPoint);
			ownerWindow.requestAnimationFrame(() => {
				if (!panel.isConnected) return;
				positionLocationPreviewPanel(panel, anchor, size, placement, previousCenter, targetPoint);
			});
		});
	});
}

function positionLocationPreviewPanel(
	panel: HTMLElement,
	anchor: HTMLElement | DOMRect,
	size: LocationPreviewSize,
	placement: LocationPreviewPlacement,
	previousCenter: LocationPreviewPoint,
	targetPoint: LocationPreviewPoint | null = null,
): void {
	if (placement === 'none') return;
	if (placement === 'fixed-point' && targetPoint) {
		setLocationPreviewPanelPosition(panel, size, targetPoint.x, targetPoint.y);
		return;
	}
	if (placement === 'anchor') {
		positionFloatingElement(panel, anchor);
		return;
	}
	const viewport = getLocationPreviewViewport(panel);
	const targetLeft = placement === 'center' || placement === 'phone-initial'
		? viewport.left + (viewport.width - size.width) / 2
		: previousCenter.x - size.width / 2;
	const targetTop = getLocationPreviewTargetTop(viewport, size, placement, previousCenter);
	setLocationPreviewPanelPosition(panel, size, targetLeft, targetTop);
}

function setLocationPreviewPanelPosition(
	panel: HTMLElement,
	size: LocationPreviewSize,
	targetLeft: number,
	targetTop: number,
): void {
	const viewport = getLocationPreviewViewport(panel);
	const minLeft = viewport.left + viewport.marginX;
	const minTop = viewport.top + viewport.marginY;
	const maxLeft = viewport.left + viewport.width - viewport.marginX - size.width;
	const maxTop = viewport.top + viewport.height - viewport.marginY - size.height;
	panel.style.left = `${Math.round(clampPosition(targetLeft, minLeft, maxLeft))}px`;
	panel.style.top = `${Math.round(clampPosition(targetTop, minTop, maxTop))}px`;
}

function getLocationPreviewTargetTop(
	viewport: LocationPreviewViewport,
	size: LocationPreviewSize,
	placement: LocationPreviewPlacement,
	previousCenter: LocationPreviewPoint,
): number {
	if (placement === 'phone-initial') {
		return viewport.top + viewport.height * PHONE_INITIAL_TOP_RATIO;
	}
	if (placement === 'center') {
		return viewport.top + (viewport.height - size.height) / 2;
	}
	return previousCenter.y - size.height / 2;
}

function clampPosition(value: number, min: number, max: number): number {
	if (max < min) return (min + max) / 2;
	return Math.max(min, Math.min(max, value));
}
