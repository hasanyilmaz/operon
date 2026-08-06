import type { App } from 'obsidian';

import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { cloneFilterSet, type FilterSet, type KeyMapping, type OperonSettings } from '../types/settings';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { resolveSurfaceFloatingHostOptions } from './field-pickers/common';
import {
	FilterSetModal,
	type FilterModalEvalDeps,
	type FilterSetModalOptions,
} from './filter-set-modal';

export interface PresetFilterPopoverOptions {
	app: App;
	anchor: HTMLButtonElement;
	triggerHost: HTMLElement;
	label: string;
	currentFilter: FilterSet | null;
	newFilterName: string;
	keyMappings: KeyMapping[];
	evalDeps?: FilterModalEvalDeps;
	filterModalOptions?: FilterSetModalOptions;
	countTasks?: (filterSet: FilterSet) => number;
	saveTooltip?: { title: string; content: string };
	classNames?: string[];
	onCommit: (filterSet: FilterSet, sourceFilterSetId: string | null) => Promise<void>;
	onCommitError: (error: unknown) => void;
	onClose?: (close: () => void) => void;
	resolveFallbackFocusTarget?: () => HTMLElement | null;
}

let presetFilterPopoverSequence = 0;

export function createUniquePresetFilterName(baseName: string, filterSets: readonly FilterSet[]): string {
	const existingNames = new Set(filterSets.map(filterSet => filterSet.name.trim().toLocaleLowerCase()));
	if (!existingNames.has(baseName.toLocaleLowerCase())) return baseName;
	let suffix = 2;
	while (existingNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
	return `${baseName} ${suffix}`;
}

export function buildPresetFilterUsageTooltip(
	settings: Pick<OperonSettings, 'calendarPresets' | 'kanbanPresets' | 'tablePresets'>,
	filterSetId: string,
	tablePresets: readonly { id: string; name: string; filterSetId: string | null }[] = settings.tablePresets,
): { title: string; content: string } | undefined {
	const lines: string[] = [];
	const addUsageLine = (label: string, presets: readonly { id: string; name: string; filterSetId: string | null }[]): void => {
		const names = presets
			.filter(entry => entry.filterSetId === filterSetId)
			.map(entry => entry.name.trim() || entry.id);
		if (names.length > 0) lines.push(`${label}: ${names.join(', ')}`);
	};
	addUsageLine(t('filterSets', 'usedByCalendar'), settings.calendarPresets);
	addUsageLine(t('filterSets', 'usedByKanban'), settings.kanbanPresets);
	addUsageLine(t('filterSets', 'usedByTable'), tablePresets);
	if (lines.length === 0) return undefined;
	return {
		title: t('filterSets', 'usedByTitle'),
		content: lines.join(' · '),
	};
}

function generateFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

function generateFilterGroupId(): string {
	return 'fg_' + Math.random().toString(36).slice(2, 10);
}

function createEmptyFilterSet(name: string): FilterSet {
	return {
		id: generateFilterSetId(),
		name,
		icon: 'filter',
		rootGroup: {
			id: generateFilterGroupId(),
			logic: 'all',
			children: [],
		},
		sorts: [],
		matchLogic: 'all',
		conditions: [],
	};
}

function positionPresetFilterPopover(popover: HTMLElement, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const ownerWindow = getOwnerWindow(anchor);
	const floatingOptions = resolveSurfaceFloatingHostOptions(anchor);
	const floatingHost = floatingOptions.floatingHost;
	const hostRect = floatingHost?.getBoundingClientRect();
	const hostScrollLeft = floatingHost?.scrollLeft ?? 0;
	const hostScrollTop = floatingHost?.scrollTop ?? 0;
	const margin = 12;
	const gap = 6;
	const availableWidth = Math.max(240, (floatingHost?.clientWidth ?? ownerWindow.innerWidth) - margin * 2);
	const availableHeight = floatingHost?.clientHeight ?? ownerWindow.innerHeight;
	const width = Math.min(760, availableWidth);
	const anchorRight = hostRect ? rect.right - hostRect.left + hostScrollLeft : rect.right;
	const anchorBottom = hostRect ? rect.bottom - hostRect.top + hostScrollTop : rect.bottom;
	const left = Math.max(hostScrollLeft + margin, Math.min(
		anchorRight - width,
		hostScrollLeft + availableWidth - width - margin,
	));
	const top = Math.max(hostScrollTop + margin, anchorBottom + gap);
	const maxHeight = Math.max(240, hostScrollTop + availableHeight - top - margin);
	popover.style.width = `${Math.round(width)}px`;
	popover.style.position = floatingHost ? 'absolute' : 'fixed';
	popover.style.left = `${Math.round(left)}px`;
	popover.style.top = `${Math.round(top)}px`;
	popover.style.maxHeight = `${Math.round(maxHeight)}px`;
}

export function showPresetFilterPopover(options: PresetFilterPopoverOptions): () => void {
	const {
		anchor,
		triggerHost,
		currentFilter,
	} = options;
	const draft = currentFilter
		? cloneFilterSet(currentFilter)
		: createEmptyFilterSet(options.newFilterName);
	const sourceFilterSetId = currentFilter?.id ?? null;
	const ownerDocument = getOwnerDocument(triggerHost);
	const ownerWindow = getOwnerWindow(triggerHost);
	const floatingOptions = resolveSurfaceFloatingHostOptions(anchor);
	const popoverHost = floatingOptions.floatingHost ?? ownerDocument.body;
	const floatingScrollHost = floatingOptions.floatingScrollHost ?? ownerWindow;
	const popover = popoverHost.createDiv('operon-preset-filter-popover');
	for (const className of options.classNames ?? []) popover.addClass(className);
	presetFilterPopoverSequence += 1;
	popover.id = `operon-preset-filter-popover-${presetFilterPopoverSequence}`;
	popover.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(popover, options.label);
	anchor.setAttribute('aria-expanded', 'true');
	anchor.setAttribute('aria-controls', popover.id);

	let editor: FilterSetModal | null = null;
	let isClosed = false;
	let saveInFlight = false;
	let repositionFrame: number | null = null;

	const restoreAnchorFocus = (): void => {
		ownerWindow.requestAnimationFrame(() => {
			const focusTarget = anchor.isConnected
				? anchor
				: options.resolveFallbackFocusTarget?.() ?? null;
			if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
		});
	};
	const close = (restoreFocus = false): void => {
		if (isClosed) return;
		isClosed = true;
		ownerDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
		ownerDocument.removeEventListener('keydown', handleDocumentKeyDown, true);
		ownerWindow.removeEventListener('resize', handleWindowResize);
		floatingScrollHost.removeEventListener('scroll', scheduleReposition, true);
		if (repositionFrame !== null) ownerWindow.cancelAnimationFrame(repositionFrame);
		editor?.destroyInlineConditionEditor();
		anchor.setAttribute('aria-expanded', 'false');
		anchor.removeAttribute('aria-controls');
		popover.remove();
		options.onClose?.(publicClose);
		if (restoreFocus) restoreAnchorFocus();
	};
	const publicClose = (): void => close(false);
	const handleDocumentPointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (target && typeof (target as Node).nodeType === 'number' && triggerHost.contains(target as Node)) return;
		if (editor?.isInlineEditorTarget(target)) return;
		close(false);
	};
	const handleDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		if (editor?.requestInlineEditorChildEscapeClose()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (editor?.isInlineEditorFloatingTarget(event.target)) return;
		event.preventDefault();
		close(true);
	};
	const reposition = (): void => positionPresetFilterPopover(popover, anchor);
	const scheduleReposition = (): void => {
		if (repositionFrame !== null) return;
		repositionFrame = ownerWindow.requestAnimationFrame(() => {
			repositionFrame = null;
			if (!isClosed && popover.isConnected) reposition();
		});
	};
	const handleWindowResize = (): void => scheduleReposition();

	editor = new FilterSetModal(
		options.app,
		draft,
		options.keyMappings,
		() => undefined,
		options.evalDeps,
		options.filterModalOptions,
	);
	editor.renderInlineConditionEditor(popover, {
		onCancel: () => close(true),
		onSave: updated => {
			if (saveInFlight || isClosed) return;
			saveInFlight = true;
			void Promise.resolve()
				.then(() => options.onCommit(updated, sourceFilterSetId))
				.then(() => close(true))
				.catch(error => {
					saveInFlight = false;
					options.onCommitError(error);
				});
		},
		countTasks: options.countTasks,
		saveTooltip: options.saveTooltip,
	});
	reposition();

	ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
	ownerDocument.addEventListener('keydown', handleDocumentKeyDown, true);
	ownerWindow.addEventListener('resize', handleWindowResize);
	floatingScrollHost.addEventListener('scroll', scheduleReposition, true);
	return publicClose;
}
