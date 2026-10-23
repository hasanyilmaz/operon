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
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-subtasks-filter-modal-container-mobile');
			this.modalEl.addClass('operon-subtasks-filter-modal-mobile');
			window.addEventListener('resize', this.resizeHandler);
			window.visualViewport?.addEventListener('resize', this.resizeHandler);
			window.visualViewport?.addEventListener('scroll', this.resizeHandler);
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
		window.removeEventListener('resize', this.resizeHandler);
		window.visualViewport?.removeEventListener('resize', this.resizeHandler);
		window.visualViewport?.removeEventListener('scroll', this.resizeHandler);
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

	private updateMobileViewportHeight(): void {
		if (!Platform.isPhone) return;
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
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
