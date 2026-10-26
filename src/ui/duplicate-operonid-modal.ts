import { App, Modal, Platform, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { DuplicateRegistrySnapshot, IndexedTaskInstance } from '../types/fields';

export interface DuplicateOperonIdModalOptions {
	getSnapshot: () => DuplicateRegistrySnapshot;
	onOpenFile: (task: IndexedTaskInstance) => void;
	onRevealLine: (task: IndexedTaskInstance) => void;
	onOpenTaskEditor: (task: IndexedTaskInstance) => void;
	onDeleteCopy: (task: IndexedTaskInstance) => Promise<boolean>;
	onRegenerateId: (task: IndexedTaskInstance) => Promise<boolean>;
	onClose?: () => void;
}

export class DuplicateOperonIdModal extends Modal {
	private readonly options: DuplicateOperonIdModalOptions;
	private focusedOperonId: string | null = null;
	private busyInstanceKeys = new Set<string>();

	constructor(app: App, options: DuplicateOperonIdModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-duplicate-operonid-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.options.onClose?.();
	}

	refresh(focusOperonId?: string | null): void {
		if (focusOperonId) {
			this.focusedOperonId = focusOperonId;
		}
		if (!this.contentEl.isConnected) return;
		this.render();
	}

	private render(): void {
		const snapshot = this.options.getSnapshot();
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('duplicateOperonId', 'title'));

		const intro = contentEl.createEl('p', {
			text: t('duplicateOperonId', Platform.isDesktopApp ? 'introDock' : 'intro'),
			cls: 'operon-duplicate-operonid-intro',
		});
		intro.toggleClass('is-empty', snapshot.totalConflictCount === 0);

		if (snapshot.totalConflictCount === 0) {
			const empty = contentEl.createDiv('operon-duplicate-operonid-empty');
			empty.createEl('strong', { text: t('duplicateOperonId', 'emptyTitle') });
			empty.createEl('p', { text: t('duplicateOperonId', 'emptyBody') });
			return;
		}

		const conflicts = this.sortConflicts(snapshot);
		for (const conflict of conflicts) {
			const section = contentEl.createDiv('operon-duplicate-operonid-conflict');
			const header = section.createDiv('operon-duplicate-operonid-conflict-header');
			header.createEl('h3', {
				text: `${conflict.operonId} · ${t('duplicateOperonId', 'copyCount', { count: String(conflict.instances.length) })}`,
			});
			header.createSpan({
				cls: 'operon-duplicate-operonid-updated',
				text: t('duplicateOperonId', 'lastUpdated', {
					value: this.formatDateTime(conflict.updatedAt),
				}),
			});

			for (const instance of conflict.instances) {
				const busy = this.busyInstanceKeys.has(instance.instanceKey);
				const row = section.createDiv('operon-duplicate-operonid-instance');
				row.toggleClass('is-busy', busy);
				const meta = row.createDiv('operon-duplicate-operonid-instance-meta');
				meta.createDiv({
					cls: 'operon-duplicate-operonid-instance-title',
					text: instance.description || t('duplicateOperonId', 'untitledTask'),
				});

				const pathRow = meta.createDiv('operon-duplicate-operonid-instance-path');
				pathRow.createSpan({ text: instance.primary.format });
				pathRow.createSpan({ text: '·' });
				pathRow.createSpan({ text: this.renderLocation(instance) });

				meta.createDiv({
					cls: 'operon-duplicate-operonid-instance-updated',
					text: t('duplicateOperonId', 'instanceUpdated', {
						value: this.formatDateTime(instance.datetimeModified),
					}),
				});

				const actions = row.createDiv('operon-duplicate-operonid-instance-actions');
				this.createActionButton(actions, t('duplicateOperonId', 'openFile'), () => {
					this.options.onOpenFile(instance);
				}, undefined, busy);
				if (instance.primary.format === 'inline') {
					this.createActionButton(actions, t('duplicateOperonId', 'revealLine'), () => {
						this.options.onRevealLine(instance);
					}, undefined, busy);
				}
				this.createActionButton(actions, t('duplicateOperonId', 'openTaskEditor'), () => {
					this.options.onOpenTaskEditor(instance);
				}, undefined, busy);
				this.createActionButton(actions, t('duplicateOperonId', 'regenerateId'), async () => {
					await this.runInstanceAction(instance, () => this.options.onRegenerateId(instance));
				}, 'rotate-cw', busy);
				this.createActionButton(actions, t('duplicateOperonId', 'deleteCopy'), async () => {
					await this.runInstanceAction(instance, () => this.options.onDeleteCopy(instance));
				}, 'trash-2', busy);
			}
		}
	}

	private sortConflicts(snapshot: DuplicateRegistrySnapshot) {
		const conflicts = [...snapshot.conflicts];
		const focusedIndex = this.focusedOperonId
			? conflicts.findIndex(conflict => conflict.operonId === this.focusedOperonId)
			: -1;
		if (focusedIndex > 0) {
			const [focused] = conflicts.splice(focusedIndex, 1);
			conflicts.unshift(focused);
		}
		return conflicts;
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		onClick: () => void | Promise<void>,
		icon?: string,
		disabled = false,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			text: label,
			attr: { type: 'button' },
			cls: 'operon-duplicate-operonid-action',
		});
		button.disabled = disabled;
		if (icon) {
			const iconEl = button.createSpan({ cls: 'operon-duplicate-operonid-action-icon' });
			setIcon(iconEl, icon);
		}
		button.addEventListener('click', () => {
			void onClick();
		});
		return button;
	}

	private async runInstanceAction(
		task: IndexedTaskInstance,
		callback: () => Promise<boolean>,
	): Promise<void> {
		if (this.busyInstanceKeys.has(task.instanceKey)) return;
		this.busyInstanceKeys.add(task.instanceKey);
		this.render();
		try {
			await callback();
		} finally {
			this.busyInstanceKeys.delete(task.instanceKey);
			this.focusedOperonId = task.operonId;
			this.render();
		}
	}

	private renderLocation(task: IndexedTaskInstance): string {
		if (task.primary.format === 'yaml') {
			return task.primary.filePath;
		}
		return `${task.primary.filePath}:${task.primary.lineNumber + 1}`;
	}

	private formatDateTime(value: string): string {
		if (!value) return t('duplicateOperonId', 'unknownDate');
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString();
	}
}
