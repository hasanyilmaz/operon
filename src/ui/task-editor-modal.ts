/**
 * Task Editor Modal — thin wrapper around TaskEditorContent.
 * Opens the task editor as a floating modal window.
 */

import { App, Modal, Platform } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { ParsedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { TaskEditorContent, OnSaveCallback, TaskEditorContentOptions } from './task-editor-content';
import { TimeTracker } from '../systems/time-tracker';
import {
	TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT,
	TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT,
} from './field-pickers/common';

export class TaskEditorModal extends Modal {
	content: TaskEditorContent;
	onCloseSaveSettled: (() => void | Promise<void>) | null = null;
	private mobilePickerOpenDepth = 0;
	private readonly resizeHandler = () => this.updateMobileViewportHeight();
	private readonly visualViewportHandler = () => this.updateMobileViewportHeight();
	private readonly mobilePickerOpenHandler = () => {
		this.mobilePickerOpenDepth += 1;
	};
	private readonly mobilePickerCloseHandler = () => {
		this.mobilePickerOpenDepth = Math.max(0, this.mobilePickerOpenDepth - 1);
		window.setTimeout(() => this.updateMobileViewportHeight(), 80);
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
		// Close modal when inner content requests it.
		this.contentEl.addEventListener('operon-editor-close', () => this.close(), { once: true });
	}

	onClose(): void {
		window.removeEventListener('resize', this.resizeHandler);
		this.unregisterMobileViewportListeners();
		this.unregisterMobilePickerListeners();
		this.mobilePickerOpenDepth = 0;
		this.containerEl.style.removeProperty('--operon-task-editor-mobile-viewport-height');
		const closeSave = this.content.beginCloseSave();
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
