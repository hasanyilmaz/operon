/**
 * Floating Pinned Tasks dock.
 * A draggable, position-fixed panel that displays pinned tasks
 * as compact cards. Extends Component for proper lifecycle management.
 */

import { Component, Platform, getIcon, setIcon } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { IndexedTask } from '../types/fields';
import { TimeTracker } from '../systems/time-tracker';
import { t } from '../core/i18n';
import { PinnedCache } from '../storage/pinned-cache';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { resolveTaskColorSourceForTask, resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { WindowTimeoutHandle, clearWindowTimeout, createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow, setWindowTimeout } from '../core/dom-compat';
import { asyncHandler } from '../core/async-action';
import { getPinnedTasksForDisplay } from '../core/pinned-task-query';
import { isTaskSourceOpenModifierClick } from './task-source-open-modifier';

export interface PinnedDockCallbacks {
	openTaskEditor: (operonId: string) => void;
	openTaskSource?: (operonId: string) => void | Promise<void>;
	cycleStatus: (operonId: string) => void;
	onContextualAction?: ContextualMenuActionHandler;
	hasSubtasks?: (taskId: string) => boolean;
	toggleTimer: (taskId: string) => Promise<boolean>;
	saveSettings: () => void;
	refreshLayout: () => void;
}

export class PinnedTasksDock extends Component {
	private containerEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private lastRenderSignature: string | null = null;
	private autoCloseTimer: WindowTimeoutHandle | null = null;
	private dragState: { startX: number; startY: number; origLeft: number; origTop: number } | null = null;
	private unsubscribeTimer: (() => void) | null = null;

	constructor(
		private indexer: OperonIndexer,
		private settings: OperonSettings,
		private timeTracker: TimeTracker,
		private callbacks: PinnedDockCallbacks,
		private pinnedCache: PinnedCache,
	) {
		super();
	}

	onload(): void {
		const el = createOwnerElement(null, 'div');
		const ownerDocument = getOwnerDocument(el);
		const ownerWindow = getOwnerWindow(el);
		el.className = 'operon-pinned-dock is-hidden';
		this.containerEl = el;

		// --- Header ---
		const header = el.createDiv('operon-pinned-dock-header');

		// Drag handle
		const dragHandle = header.createSpan('operon-pinned-dock-drag-handle');
		const gripIcon = getIcon('grip-vertical');
		if (gripIcon) dragHandle.appendChild(gripIcon);
		else dragHandle.setText('⠿');

		// Pin icon — visible only when collapsed, hover expands
		const pinBtn = header.createSpan('operon-pinned-dock-pin');
		const pinIcon = getIcon('pin');
		if (pinIcon) pinBtn.appendChild(pinIcon);

		// --- Body (inline with header when expanded) ---
		this.bodyEl = el.createDiv('operon-pinned-dock-body');

		// Mount to document
		getOwnerBody(el).appendChild(el);

		// Restore position
		this.restorePosition();

		// Restore collapsed state
		if (this.settings.pinnedDockAutoCloseEnabled && this.settings.pinnedDockCollapsed) {
			el.classList.add('is-collapsed');
		}

		// --- Event listeners ---
		this.registerDomEvent(dragHandle, 'mousedown', (e: MouseEvent) => this.onDragStart(e));
		this.registerDomEvent(ownerDocument, 'mousemove', (e: MouseEvent) => this.onDragMove(e));
		this.registerDomEvent(ownerDocument, 'mouseup', () => this.onDragEnd());
		this.registerDomEvent(pinBtn, 'mouseenter', () => this.expandFromPin());
		this.registerDomEvent(el, 'mouseenter', () => this.resetAutoClose());
		this.registerDomEvent(el, 'mouseleave', () => this.startAutoClose());
		this.registerDomEvent(ownerWindow, 'resize', () => this.clampToViewport());

		// Subscribe to timer state changes so play/stop icon updates in real time
		this.unsubscribeTimer = this.timeTracker.subscribe((event) => {
			if (event === 'state') {
				this.markDirty();
				this.render();
			}
		});

		// Restore visibility
		if (this.shouldUseFloatingDock() && this.settings.pinnedDockVisible) {
			this.showInternal(false);
		}
	}

	onunload(): void {
		this.unsubscribeTimer?.();
		this.unsubscribeTimer = null;
		this.clearAutoClose();
		this.containerEl?.remove();
		this.containerEl = null;
		this.bodyEl = null;
	}

	// ---- Public API ----

	toggle(): void {
		if (!this.shouldUseFloatingDock()) {
			this.hideWithoutSaving();
			return;
		}
		if (this.containerEl?.classList.contains('is-hidden')) {
			this.show();
		} else {
			this.hide();
		}
	}

	show(): void {
		if (!this.shouldUseFloatingDock()) return;
		this.showInternal(true);
	}

	hide(): void {
		if (!this.containerEl) return;
		this.containerEl.classList.add('is-hidden');
		this.clearAutoClose();
		this.settings.pinnedDockVisible = false;
		this.callbacks.saveSettings();
	}

	render(): void {
		if (!this.bodyEl || !this.containerEl) return;
		if (!this.shouldUseFloatingDock()) {
			this.containerEl.classList.add('is-hidden');
			this.clearAutoClose();
			return;
		}
		if (this.containerEl.classList.contains('is-hidden')) return;

		const pinnedTasks = this.getPinnedTasks();
		const activeTrackerId = this.timeTracker.getActiveOperonId();
		const colorSettingsSignature = [
			this.settings.pinnedDockColorSource,
			this.settings.priorities.map(priority => `${priority.label}:${priority.color}:${priority.priorityIcon ?? ''}`).join(','),
			this.settings.pipelines.map(pipeline =>
				`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.color}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
			).join('|'),
		].join('~');
		const signature = [
			String(this.indexer.getGeneration()),
			String(this.pinnedCache.getGeneration()),
			colorSettingsSignature,
			this.settings.fallbackTaskIconSource,
			this.settings.taskStatusIconColorSource,
			`${this.settings.fallbackStateIcons.open}:${this.settings.fallbackStateIcons.done}:${this.settings.fallbackStateIcons.cancelled}`,
			activeTrackerId ?? '',
			pinnedTasks.map(task =>
				`${task.operonId}:${task.description}:${task.fieldValues['taskIcon'] ?? ''}:${task.fieldValues['taskColor'] ?? ''}:${task.fieldValues['status'] ?? ''}:${task.fieldValues['priority'] ?? ''}:${task.checkbox}`
			).join('|'),
		].join('§');

		if (signature === this.lastRenderSignature) return;
		this.lastRenderSignature = signature;

		this.bodyEl.empty();

		if (pinnedTasks.length === 0) {
			this.bodyEl.createDiv({
				cls: 'operon-pinned-empty',
				text: t('pinnedTasks', 'empty'),
			});
			return;
		}

		const layout = this.settings.pinnedDockLayout ?? 'horizontal';
		const stripCls = `operon-pinned-cards operon-pinned-cards--${layout}`;
		const strip = this.bodyEl.createDiv(stripCls);
		strip.style.setProperty('--operon-pinned-item-width', `${this.settings.pinnedTaskItemWidth ?? 240}px`);
		if (layout === 'grid') {
			strip.style.setProperty('--operon-grid-cols', String(this.settings.pinnedDockGridCols ?? 2));
		}

		for (const task of pinnedTasks) {
			const card = strip.createDiv('operon-pinned-card');
			card.addEventListener('click', (event) => {
				if (isTaskSourceOpenModifierClick(event) && this.callbacks.openTaskSource) {
					event.preventDefault();
					event.stopPropagation();
					void Promise.resolve(this.callbacks.openTaskSource(task.operonId)).catch(error => {
						console.error('Operon: failed to open pinned task source', error);
					});
					return;
				}
				this.callbacks.openTaskEditor(task.operonId);
			});

			const color = resolveTaskColorSourceForTask(task, this.settings.pinnedDockColorSource, this.settings);
			if (this.settings.pinnedDockColorSource === 'noColor') {
				card.setCssProps({ '--operon-card-color': 'var(--background-modifier-border)' });
			} else if (color) {
				card.style.setProperty('--operon-card-color', color);
				card.setCssProps({
					'--operon-pinned-card-bg': `color-mix(in srgb, ${color} 5%, transparent)`,
					'--operon-pinned-card-hover-border': color,
				});
			}

			// Status icon (left side) — clickable to cycle status
			const statusBtn = card.createEl('button', {
				cls: `operon-pinned-status operon-checkbox-${task.checkbox}`,
				attr: { type: 'button' },
			});
			const iconColor = resolveTaskStatusIconColorForTask(task, this.settings);
			if (iconColor) statusBtn.style.color = iconColor;
			else statusBtn.style.removeProperty('color');
			this.renderStatusIcon(statusBtn, task);

				statusBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.callbacks.cycleStatus(task.operonId);
				});
				if (this.callbacks.onContextualAction) {
					bindTaskContextualHoverMenu(statusBtn, {
						surface: 'pinnedTask',
						taskId: task.operonId,
						getTask: () => task,
						getSettings: () => this.settings,
						onAction: this.callbacks.onContextualAction,
						isPinned: () => this.pinnedCache.isPinned(task.operonId),
						hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(task.operonId) === true : undefined,
					});
				}

				// Description — card click opens Task Editor unless a source-open modifier is held
				card.createSpan({
					cls: 'operon-pinned-desc',
					text: task.description || t('pinnedTasks', 'untitledTask'),
				});

			// Unpin button (right side, left of timer) — visible on hover
				const unpinBtn = card.createEl('button', {
					cls: 'operon-pinned-unpin',
					attr: { type: 'button' },
				});
				setIcon(unpinBtn, 'pin-off');
				unpinBtn.addEventListener('click', asyncHandler('pinned dock unpin failed', async (e) => {
					e.stopPropagation();
					await this.pinnedCache.unpin(task.operonId);
				}));

			// Play/Stop button (rightmost) — visible on hover
			const isTracking = this.timeTracker.isTimerRunning(task.operonId);
			card.toggleClass('operon-pinned-card--tracking', isTracking);
				const timerBtn = card.createEl('button', {
					cls: `operon-pinned-timer${isTracking ? ' is-active' : ''}`,
					attr: { type: 'button' },
				});
				const timerIconName = isTracking ? 'square' : 'play';
				setIcon(timerBtn, timerIconName);

				timerBtn.addEventListener('click', asyncHandler('pinned dock timer toggle failed', async (e) => {
					e.stopPropagation();
					await this.callbacks.toggleTimer(task.operonId);
				}));

		}
	}

	markDirty(): void {
		this.lastRenderSignature = null;
	}

	refreshLayout(): void {
		if (!this.shouldUseFloatingDock()) {
			this.containerEl?.classList.add('is-hidden');
			this.clearAutoClose();
			return;
		}
		if (this.containerEl) {
			const shouldCollapse = this.settings.pinnedDockAutoCloseEnabled && this.settings.pinnedDockCollapsed;
			this.containerEl.classList.toggle('is-collapsed', shouldCollapse);
		}
		this.markDirty();
		this.render();
	}

	isVisible(): boolean {
		return !!this.containerEl && !this.containerEl.classList.contains('is-hidden');
	}

	// ---- Internal ----

	private showInternal(save: boolean): void {
		if (!this.containerEl) return;
		if (!this.shouldUseFloatingDock()) return;
		this.containerEl.classList.remove('is-hidden');
		this.render();
		this.startAutoClose();
		if (save) {
			this.settings.pinnedDockVisible = true;
			this.callbacks.saveSettings();
		}
	}

	private getPinnedTasks(): IndexedTask[] {
		return getPinnedTasksForDisplay(this.indexer, this.pinnedCache, this.settings.priorities);
	}

	private renderStatusIcon(btn: HTMLElement, task: IndexedTask): void {
		setIcon(btn, resolveTaskDisplayIcon(this.settings, task.fieldValues, task.checkbox));
	}

	// ---- Position ----

	private restorePosition(): void {
		if (!this.containerEl) return;

		if (this.settings.pinnedDockX !== null && this.settings.pinnedDockY !== null) {
			this.containerEl.style.left = `${this.settings.pinnedDockX}px`;
			this.containerEl.style.top = `${this.settings.pinnedDockY}px`;
		} else {
			this.applyDefaultPosition();
		}

		// Ensure within viewport after restore
		window.requestAnimationFrame(() => this.clampToViewport());
	}

	private applyDefaultPosition(): void {
		if (!this.containerEl) return;

		// Position after render so we can measure width
		window.requestAnimationFrame(() => {
			if (!this.containerEl) return;
			const rect = this.containerEl.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;

				switch (this.settings.pinnedDockPosition) {
					case 'bottom-left':
						this.containerEl.setCssProps({ left: '16px' });
						this.containerEl.style.top = `${vh - rect.height - 16}px`;
						break;
				case 'bottom-right':
					this.containerEl.style.left = `${vw - rect.width - 16}px`;
					this.containerEl.style.top = `${vh - rect.height - 16}px`;
					break;
				case 'bottom-center':
				default:
					// First-time default: left ~13% of viewport, vertically ~75% down
					this.containerEl.style.left = `${Math.round(vw * 0.13)}px`;
					this.containerEl.style.top = `${Math.round(vh * 0.75 - rect.height / 2)}px`;
					break;
			}
		});
	}

	private clampToViewport(): void {
		if (!this.containerEl || this.containerEl.classList.contains('is-hidden')) return;
		const rect = this.containerEl.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left = rect.left;
		let top = rect.top;
		let changed = false;

		if (left + rect.width > vw) { left = vw - rect.width; changed = true; }
		if (left < 0) { left = 0; changed = true; }
		if (top + rect.height > vh) { top = vh - rect.height; changed = true; }
		if (top < 0) { top = 0; changed = true; }

		if (changed) {
			this.containerEl.style.left = `${left}px`;
			this.containerEl.style.top = `${top}px`;
		}
	}

	// ---- Drag ----

	private onDragStart(e: MouseEvent): void {
		if (!this.containerEl) return;
		e.preventDefault();
		const rect = this.containerEl.getBoundingClientRect();
		this.dragState = {
			startX: e.clientX,
			startY: e.clientY,
			origLeft: rect.left,
			origTop: rect.top,
		};
		this.containerEl.classList.add('is-dragging');
	}

	private onDragMove(e: MouseEvent): void {
		if (!this.dragState || !this.containerEl) return;
		const dx = e.clientX - this.dragState.startX;
		const dy = e.clientY - this.dragState.startY;
		const rect = this.containerEl.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left = this.dragState.origLeft + dx;
		let top = this.dragState.origTop + dy;

		// Clamp to viewport
		left = Math.max(0, Math.min(left, vw - rect.width));
		top = Math.max(0, Math.min(top, vh - rect.height));

		this.containerEl.style.left = `${left}px`;
		this.containerEl.style.top = `${top}px`;
	}

	private onDragEnd(): void {
		if (!this.dragState || !this.containerEl) return;
		this.containerEl.classList.remove('is-dragging');
		const rect = this.containerEl.getBoundingClientRect();
		this.settings.pinnedDockX = Math.round(rect.left);
		this.settings.pinnedDockY = Math.round(rect.top);
		this.dragState = null;
		this.callbacks.saveSettings();
	}

	// ---- Expand from pin hover ----

	private expandFromPin(): void {
		if (!this.containerEl) return;
		this.containerEl.classList.remove('is-collapsed');
		this.settings.pinnedDockCollapsed = false;
		this.render();
		this.callbacks.saveSettings();
		this.startAutoClose();
	}

	// ---- Auto-close (collapses back to pin-only view) ----

	private startAutoClose(): void {
		this.clearAutoClose();
		if (!this.settings.pinnedDockAutoCloseEnabled) return;
		if (!this.settings.floatingAutoCloseSec || this.settings.floatingAutoCloseSec <= 0) return;
		this.autoCloseTimer = setWindowTimeout(() => {
			if (this.containerEl && !this.containerEl.classList.contains('is-collapsed')) {
				this.containerEl.classList.add('is-collapsed');
				this.settings.pinnedDockCollapsed = true;
				this.callbacks.saveSettings();
			}
		}, this.settings.floatingAutoCloseSec * 1000);
	}

	private resetAutoClose(): void {
		this.clearAutoClose();
	}

	private clearAutoClose(): void {
		if (this.autoCloseTimer) {
			clearWindowTimeout(this.autoCloseTimer);
			this.autoCloseTimer = null;
		}
	}

	private isDisabledOnCurrentDevice(): boolean {
		return this.settings.pinnedDockDisableOnMobile && Platform.isPhone;
	}

	private shouldUseFloatingDock(): boolean {
		return this.settings.pinnedTasksDesktopSurface === 'floating'
			&& !Platform.isMobile
			&& !Platform.isMobileApp
			&& !this.isDisabledOnCurrentDevice();
	}

	private hideWithoutSaving(): void {
		if (!this.containerEl) return;
		this.containerEl.classList.add('is-hidden');
		this.clearAutoClose();
	}
}
