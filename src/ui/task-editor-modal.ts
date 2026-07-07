/**
 * Task Editor Modal — thin wrapper around TaskEditorContent.
 * Opens the task editor as a floating modal window.
 */

import { App, KeymapEventHandler, Modal, Platform } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { ParsedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import {
	TASK_EDITOR_ESCAPE_INTENT_EVENT,
	TaskEditorContent,
	OnSaveCallback,
	TaskEditorContentOptions,
} from './task-editor-content';
import { TimeTracker } from '../systems/time-tracker';
import {
	TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT,
	TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT,
	isFloatingPanelTargetForRoot,
	requestFloatingPanelCloseForRoot,
} from './field-pickers/common';

export class TaskEditorModal extends Modal {
	content: TaskEditorContent;
	onCloseSaveSettled: (() => void | Promise<void>) | null = null;
	private mobilePickerOpenDepth = 0;
	private escapeScopeHandler: KeymapEventHandler | null = null;
	private closeSaveBeforeCloseInFlight: Promise<boolean> | null = null;
	private skipCloseSaveOnClose = false;
	private readonly resizeHandler = () => this.updateMobileViewportHeight();
	private readonly visualViewportHandler = () => this.updateMobileViewportHeight();
	private readonly mobilePickerOpenHandler = () => {
		this.mobilePickerOpenDepth += 1;
	};
	private readonly mobilePickerCloseHandler = () => {
		this.mobilePickerOpenDepth = Math.max(0, this.mobilePickerOpenDepth - 1);
		window.setTimeout(() => this.updateMobileViewportHeight(), 80);
	};
	private readonly handleEditorCloseRequest = () => this.close();
	private readonly handleEditorEscapeIntent = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		void this.handleEscapeIntent({ fromEmbeddedFileBody: true });
	};
	private readonly handleWindowKeydownCapture = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		if (!this.modalEl.isConnected) return;
		const target = event.target as Node | null;
		const isModalTarget = target != null && this.containerEl.contains(target);
		if (!isModalTarget && !isFloatingPanelTargetForRoot(this.containerEl, target)) return;
		if (this.isEmbeddedFileBodyEditorTarget(target)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		void this.handleEscapeIntent();
	};

	constructor(
		app: App,
		indexer: OperonIndexer,
		settings: OperonSettings,
		existingTask: ParsedTask | null,
		onSave: OnSaveCallback,
		timeTracker: TimeTracker,
		options: TaskEditorContentOptions = {},
	) {
		super(app);
		this.content = new TaskEditorContent(app, indexer, settings, existingTask, onSave, timeTracker, options);
	}

	onOpen(): void {
		this.containerEl.addClass('operon-task-editor-modal-container');
		this.modalEl.addClass('operon-task-editor-modal');
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-task-editor-modal-container-mobile');
			this.modalEl.addClass('operon-task-editor-modal-mobile');
		}
		window.addEventListener('resize', this.resizeHandler);
		this.registerMobileViewportListeners();
		this.updateMobileViewportHeight();
		this.registerMobilePickerListeners();
		this.content.mountInto(this.contentEl);
		this.content.applyInitialDescriptionFocus();
		this.escapeScopeHandler = this.scope.register(null, 'Escape', () => {
			void this.handleEscapeIntent();
			return false;
		});
		window.addEventListener('keydown', this.handleWindowKeydownCapture, true);
		this.contentEl.addEventListener(TASK_EDITOR_ESCAPE_INTENT_EVENT, this.handleEditorEscapeIntent);
		// Close modal when inner content requests it.
		this.contentEl.addEventListener('operon-editor-close', this.handleEditorCloseRequest, { once: true });
	}

	onClose(): void {
		if (this.escapeScopeHandler) {
			this.scope.unregister(this.escapeScopeHandler);
			this.escapeScopeHandler = null;
		}
		window.removeEventListener('resize', this.resizeHandler);
		window.removeEventListener('keydown', this.handleWindowKeydownCapture, true);
		this.contentEl.removeEventListener(TASK_EDITOR_ESCAPE_INTENT_EVENT, this.handleEditorEscapeIntent);
		this.contentEl.removeEventListener('operon-editor-close', this.handleEditorCloseRequest);
		this.unregisterMobileViewportListeners();
		this.unregisterMobilePickerListeners();
		this.mobilePickerOpenDepth = 0;
		this.containerEl.style.removeProperty('--operon-task-editor-mobile-viewport-height');
		const closeSave = this.skipCloseSaveOnClose
			? Promise.resolve(true)
			: this.content.beginCloseSave();
		this.skipCloseSaveOnClose = false;
		this.content.destroy({ skipCloseSave: true });
		void closeSave
			.catch(error => {
				console.error('Operon: task editor close-save failed', error);
			})
			.finally(() => {
				try {
					void Promise.resolve(this.onCloseSaveSettled?.()).catch(error => {
						console.warn('Operon: task editor close refresh failed', error);
					});
				} catch (error) {
					console.warn('Operon: task editor close refresh failed', error);
				}
			});
	}

	private isEmbeddedFileBodyEditorTarget(target: Node | null): boolean {
		let node: Node | null = target;
		while (node && node !== this.containerEl) {
			const classList = (node as { classList?: DOMTokenList }).classList;
			if (classList?.contains('operon-task-editor-file-source-editor')) return true;
			node = node.parentNode;
		}
		return false;
	}

	private shouldDeferToEmbeddedFileBodyEditor(): boolean {
		const activeElement = this.containerEl.ownerDocument.activeElement;
		return this.isEmbeddedFileBodyEditorTarget(activeElement);
	}

	private handleEscapeIntent(options: { fromEmbeddedFileBody?: boolean } = {}): Promise<boolean> {
		if (this.closeSaveBeforeCloseInFlight) return this.closeSaveBeforeCloseInFlight;
		if (!options.fromEmbeddedFileBody && this.shouldDeferToEmbeddedFileBodyEditor()) {
			return Promise.resolve(false);
		}
		if (requestFloatingPanelCloseForRoot(this.containerEl, 'escape')) return Promise.resolve(false);

		const closeSave = this.content.prepareCloseSave()
			.then(saved => {
				if (!saved) return false;
				if (this.content.isEdited) return false;
				this.skipCloseSaveOnClose = true;
				super.close();
				return true;
			})
			.catch(error => {
				console.error('Operon: task editor Escape close-save failed', error);
				return false;
			})
			.finally(() => {
				if (this.closeSaveBeforeCloseInFlight === closeSave) {
					this.closeSaveBeforeCloseInFlight = null;
				}
			});
		this.closeSaveBeforeCloseInFlight = closeSave;
		return closeSave;
	}

	private registerMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.addEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.addEventListener('scroll', this.visualViewportHandler);
	}

	private unregisterMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.removeEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.removeEventListener('scroll', this.visualViewportHandler);
	}

	private registerMobilePickerListeners(): void {
		if (!Platform.isPhone) return;
		this.contentEl.addEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.contentEl.addEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
	}

	private unregisterMobilePickerListeners(): void {
		if (!Platform.isPhone) return;
		this.contentEl.removeEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.contentEl.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
	}

	private updateMobileViewportHeight(): void {
		if (!Platform.isPhone) return;
		if (this.mobilePickerOpenDepth > 0) return;
		const height = window.visualViewport?.height ?? window.innerHeight;
		if (!Number.isFinite(height) || height <= 0) return;
		this.containerEl.style.setProperty('--operon-task-editor-mobile-viewport-height', `${Math.round(height)}px`);
	}
}
