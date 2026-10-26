import { getOwnerWindow } from '../core/dom-compat';
import { App, Modal, Platform } from 'obsidian';
import { applyDesktopModalBackdrop } from './modal-backdrop';
import { t } from '../core/i18n';
import type { FilterSet } from '../types/settings';
import type { EmbedFilterDeps, FilterSurfaceInstance } from './embed-filter-processor';
import {
	createFilterSurfaceInstance,
	destroyFilterSurfaceInstance,
} from './embed-filter-processor';
import { renderSubtasksFilterSurface, renderDynamicFileTaskFilterSurface } from './dynamic-file-task-filter';

const SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS = 'operon-subtasks-filter-modal-open';

export interface SubtasksFilterModalOptions {
	parentTaskId: string;
	fileTaskPath?: () => string;
	title?: string;
	deps: EmbedFilterDeps;
	onEditFilter?: (template: FilterSet) => void;
	onClose?: () => void;
}

export class SubtasksFilterModal extends Modal {
 private viewportWindow: Window | null = null;
 private stopViewportMigration: (() => void) | null = null;

	private readonly options: SubtasksFilterModalOptions;
	private instance: FilterSurfaceInstance | null = null;
	private backdropCleanup: (() => void) | null = null;
	private rootEl: HTMLElement | null = null;
	private readonly resizeHandler = (): void => {
		this.updateMobileViewportHeight();
	};

	constructor(app: App, options: SubtasksFilterModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.backdropCleanup?.();
		this.backdropCleanup = this.options.fileTaskPath ? null : applyDesktopModalBackdrop(this.containerEl);
		this.containerEl.addClass('operon-subtasks-filter-modal-container');
		this.modalEl.addClass('operon-subtasks-filter-modal');
		this.containerEl.ownerDocument.body.classList.add(SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS);
  this.bindViewportWindow();
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-subtasks-filter-modal-container-mobile');
			this.modalEl.addClass('operon-subtasks-filter-modal-mobile');

			this.updateMobileViewportHeight();
		}
		this.titleEl.addClass('operon-subtasks-filter-title');
		this.titleEl.setText(this.options.title ?? t('filterSets', 'dynamicSubtasksFilterTitle'));

		this.contentEl.empty();
		this.rootEl = this.contentEl.createDiv('operon-subtasks-filter');
		this.instance = createFilterSurfaceInstance(this.rootEl);
		this.refresh();
	}

	onClose(): void {
		this.backdropCleanup?.();
		this.backdropCleanup = null;
		this.stopViewportMigration?.(); this.stopViewportMigration = null;
  this.viewportWindow?.removeEventListener('resize', this.resizeHandler);
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.removeEventListener('resize', this.resizeHandler);
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.removeEventListener('scroll', this.resizeHandler);
  this.viewportWindow?.document.body.classList.remove(SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS);
  this.viewportWindow = null;
		this.containerEl.ownerDocument.body.classList.remove(SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS);
		this.containerEl.style.removeProperty('--operon-subtasks-filter-mobile-viewport-height');
		if (this.instance) {
			destroyFilterSurfaceInstance(this.instance);
			this.instance = null;
		}
		this.rootEl = null;
		this.options.onClose?.();
	}

	refresh(): void {
		if (!this.instance) return;
		const rendered = this.options.fileTaskPath ? renderDynamicFileTaskFilterSurface(this.instance, this.options.fileTaskPath(), this.options.deps, this.options.onEditFilter) : renderSubtasksFilterSurface(
			this.instance,
			this.options.parentTaskId,
			this.options.deps,
			this.options.onEditFilter,
		);
		if (!rendered) {
			this.close();
		}
	}

 private bindViewportWindow(): void {
  const next = getOwnerWindow(this.containerEl), old = this.viewportWindow;
  if (old === next) return;
  old?.removeEventListener('resize', this.resizeHandler);
  old?.visualViewport?.removeEventListener('resize', this.resizeHandler);
  old?.visualViewport?.removeEventListener('scroll', this.resizeHandler);
  this.viewportWindow = next;
  if (Platform.isPhone) {
   next.addEventListener('resize', this.resizeHandler);
   next.visualViewport?.addEventListener('resize', this.resizeHandler);
   next.visualViewport?.addEventListener('scroll', this.resizeHandler);
  }
  if (!this.stopViewportMigration) this.stopViewportMigration = this.containerEl.onWindowMigrated?.(() => this.bindViewportWindow()) ?? null;
  if (old) {
   this.backdropCleanup?.(); this.backdropCleanup = this.options.fileTaskPath ? null : applyDesktopModalBackdrop(this.containerEl);
   this.updateMobileViewportHeight();
   old.document.body.classList.remove(SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS);
   next.document.body.classList.add(SUBTASKS_FILTER_MODAL_OPEN_BODY_CLASS);
  }
 }

	private updateMobileViewportHeight(): void {
		if (!Platform.isPhone) return;
		const viewportHeight = (this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.height ?? (this.viewportWindow ?? getOwnerWindow(this.containerEl)).innerHeight;
		if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
			this.containerEl.style.setProperty('--operon-subtasks-filter-mobile-viewport-height', `${Math.round(viewportHeight)}px`);
		}
	}
}

/** Open the standard Subtasks modal while the editor retains its own draft and lifetime. */
export function showSubtasksFilterModal(app: App, anchor: HTMLElement, options: SubtasksFilterModalOptions): () => void {
	let unsubscribe: (() => void) | null = null;
	let closed = false;
	const modal = new SubtasksFilterModal(app, {
		...options,
		onClose: () => {
			if (closed) return;
			closed = true;
			unsubscribe?.();
			unsubscribe = null;
			options.onClose?.();
			const focused = anchor.ownerDocument.activeElement;
			if (!anchor.isConnected || (focused && focused !== anchor.ownerDocument.body && !modal.containerEl.contains(focused))) return;
			const summary = anchor.closest<HTMLElement>('.operon-editor-time-summary');
			const target = !anchor.hidden && !anchor.matches(':disabled') && !anchor.closest('[hidden]')
				? anchor
				: summary && !summary.hidden
					? summary.querySelector<HTMLElement>('button:not([hidden]):not([disabled])') ?? summary.querySelector<HTMLElement>('[tabindex="0"]')
					: anchor.closest('.operon-task-editor')?.querySelector<HTMLElement>('[contenteditable="true"]');
			target?.focus({ preventScroll: true });
		},
	});
	const close = () => { if (!closed) modal.close(); };
	try {
		modal.open();
		if (!closed) {
			const stop = options.deps.indexer.subscribeIndexUpdates(() => { if (!closed) modal.refresh(); });
			if (closed) stop();
			else unsubscribe = stop;
		}
	} catch (error) {
		close();
		throw error;
	}
	return close;
}
