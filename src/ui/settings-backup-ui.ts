import { App, Modal, Notice, Setting } from 'obsidian';
import { t } from '../core/i18n';
import {
	detectSettingsBackupFileKind,
	isSettingsBackupFileSizeAllowed,
	type SettingsBackupFileKind,
} from './settings-backup-file-admission';

export {
	SETTINGS_BACKUP_JSON_MAX_BYTES,
	SETTINGS_BACKUP_ZIP_MAX_BYTES,
	type SettingsBackupFileKind,
} from './settings-backup-file-admission';
export function settingsBackupT(key: string, vars?: Record<string, string>): string {
	return t('settings', key, vars);
}

export type SettingsBackupVaultReferenceDecision = 'apply-source' | 'preserve-target';
export type SettingsBackupTableConflictDecision = 'skip' | 'cancel';
export type SettingsBackupRecoveryAction = 'keep' | 'retry-runtime-refresh' | 'undo';

export interface SettingsBackupExportOptions {
	includeTablePresetFiles: boolean;
	includeExternalCalendarUrls: boolean;
}

export interface SettingsBackupDownloadArtifact {
	fileName: string;
	mimeType: string;
	bytes: Uint8Array;
}

export interface SettingsBackupSelectedFile {
	fileName: string;
	kind: SettingsBackupFileKind;
	bytes: Uint8Array;
}

export interface SettingsBackupPreviewDecisions {
	selectedGroups?: readonly string[];
	vaultReferences?: Readonly<Record<string, SettingsBackupVaultReferenceDecision>>;
	tableConflicts?: Readonly<Record<string, SettingsBackupTableConflictDecision>>;
}

export interface SettingsBackupPreviewGroup {
	id: string;
	label: string;
	status: 'apply-ready' | 'not-included' | 'skipped-unsupported' | 'blocked' | 'decision-required';
	selected: boolean;
	defaultSelected: boolean;
	selectable: boolean;
	sensitive: boolean;
	counts: {
		added: number;
		removed: number;
		changed: number;
		unchanged: number;
		conflicts: number;
	};
	issues: readonly string[];
}

export interface SettingsBackupPreviewVaultReference {
	key: string;
	label: string;
	path: string;
	status: 'valid' | 'missing' | 'wrong-type' | 'unchecked';
	decision: SettingsBackupVaultReferenceDecision | null;
	required: boolean;
}

export interface SettingsBackupPreviewTableResource {
	id: string;
	path: string;
	action: 'reuse' | 'create' | 'conflict' | 'skip';
	conflictId: string | null;
	message: string | null;
	decision: SettingsBackupTableConflictDecision | null;
}

export interface SettingsBackupRestorePreview {
	kind: SettingsBackupFileKind;
	classification: 'ready' | 'decision-required' | 'blocked' | 'canceled';
	compatibility: 'exact' | 'partial' | 'unsupported';
	planId: string | null;
	groups: readonly SettingsBackupPreviewGroup[];
	vaultReferences: readonly SettingsBackupPreviewVaultReference[];
	tableResources: readonly SettingsBackupPreviewTableResource[];
	diagnostics: readonly string[];
}

export interface SettingsBackupApplyResult {
	status: 'committed' | 'committed-after-error' | 'failed-clean' | 'state-unknown';
	message: string;
	receiptId: string | null;
	undoTokenId: string | null;
	recoveryRequired: boolean;
}

export interface SettingsBackupPendingRecovery {
	receiptId: string;
	undoTokenId: string | null;
	message: string;
	canRetryRuntimeRefresh: boolean;
	canUndo: boolean;
}

/** Single boundary injected by the plugin. UI code never reads canonical storage directly. */
export interface SettingsBackupUiIntegration {
	exportBackup(options: SettingsBackupExportOptions): Promise<SettingsBackupDownloadArtifact>;
	preflightRestore(file: SettingsBackupSelectedFile, decisions: SettingsBackupPreviewDecisions): Promise<SettingsBackupRestorePreview>;
	applyRestore(input: {
		file: SettingsBackupSelectedFile;
		planId: string;
		decisions: SettingsBackupPreviewDecisions;
		acceptsNoCrashSafeRollback: true;
		acceptsConditionalSessionOnlyUndo: true;
	}): Promise<SettingsBackupApplyResult>;
	getPendingRecovery(): SettingsBackupPendingRecovery | null;
	resolveRecovery(input: {
		action: SettingsBackupRecoveryAction;
		receiptId: string;
		undoTokenId: string | null;
	}): Promise<SettingsBackupApplyResult>;
}

export async function chooseSettingsBackupFile(ownerDocument: Document): Promise<SettingsBackupSelectedFile | null> {
	const input = ownerDocument.win.createEl('input');
	input.type = 'file';
	input.accept = '.json,.zip,application/json,application/zip';
	input.hidden = true;
	ownerDocument.body.appendChild(input);
	try {
		const file = await new Promise<File | null>(resolve => {
			let resolved = false;
			const finish = (selected: File | null): void => {
				if (resolved) return;
				resolved = true;
				ownerDocument.defaultView?.removeEventListener('focus', handleFocus);
				resolve(selected);
			};
			const handleFocus = (): void => {
				ownerDocument.defaultView?.setTimeout(() => finish(input.files?.item(0) ?? null), 0);
			};
			input.addEventListener('change', () => finish(input.files?.item(0) ?? null), { once: true });
			input.addEventListener('cancel', () => finish(null), { once: true });
			ownerDocument.defaultView?.addEventListener('focus', handleFocus, { once: true });
			input.click();
		});
		if (!file) return null;
		const kind = await sniffSettingsBackupFileKind(file);
		if (!isSettingsBackupFileSizeAllowed(kind, file.size)) {
			throw new Error(settingsBackupT(kind === 'zip' ? 'settingsBackupZipTooLarge' : 'settingsBackupJsonTooLarge'));
		}
		return { fileName: file.name, kind, bytes: new Uint8Array(await file.arrayBuffer()) };
	} finally {
		input.value = '';
		input.remove();
	}
}

export function downloadSettingsBackupArtifact(ownerDocument: Document, artifact: SettingsBackupDownloadArtifact): void {
	const ownerWindow = ownerDocument.defaultView;
	if (!ownerWindow) throw new Error(settingsBackupT('settingsBackupDownloadUnavailable'));
	const blob = new ownerWindow.Blob([artifact.bytes.slice()], { type: artifact.mimeType });
	const url = ownerWindow.URL.createObjectURL(blob);
	const anchor = ownerDocument.win.createEl('a');
	anchor.href = url;
	anchor.download = artifact.fileName;
	anchor.hidden = true;
	ownerDocument.body.appendChild(anchor);
	try {
		anchor.click();
	} finally {
		anchor.remove();
		ownerWindow.setTimeout(() => ownerWindow.URL.revokeObjectURL(url), 0);
	}
}

async function sniffSettingsBackupFileKind(file: File): Promise<SettingsBackupFileKind> {
	const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
	const kind = detectSettingsBackupFileKind(head);
	if (kind) return kind;
	throw new Error(settingsBackupT('settingsBackupUnsupportedFile'));
}

export class SettingsBackupRestoreModal extends Modal {
	private readonly integration: SettingsBackupUiIntegration;
	private readonly file: SettingsBackupSelectedFile | null;
	private decisions: SettingsBackupPreviewDecisions = {};
	private preview: SettingsBackupRestorePreview | null = null;
	private requestId = 0;
	private running = false;
	private acknowledged = false;

	constructor(app: App, integration: SettingsBackupUiIntegration, file: SettingsBackupSelectedFile | null) {
		super(app);
		this.integration = integration;
		this.file = file;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-settings-backup-modal');
		this.modalEl.addClass('operon-confirm-action-modal-wide');
		this.titleEl.setText(settingsBackupT('settingsBackupRestoreTitle'));
		if (this.file) {
			void this.refreshPreview();
			return;
		}
		const recovery = this.integration.getPendingRecovery();
		if (recovery) {
			this.contentEl.empty();
			this.renderRecoveryActions(recovery);
			this.focusFirstControl();
			return;
		}
		this.renderError(new Error(settingsBackupT('settingsBackupRecoveryUnavailable')));
	}

	onClose(): void {
		this.requestId += 1;
		this.contentEl.empty();
	}

	private async refreshPreview(): Promise<void> {
		if (!this.file) return;
		const requestId = ++this.requestId;
		this.renderLoading();
		try {
			const preview = await this.integration.preflightRestore(this.file, this.decisions);
			if (requestId !== this.requestId) return;
			this.preview = preview;
			this.seedDefaultDecisions(preview);
			this.renderPreview(preview);
		} catch (error) {
			if (requestId !== this.requestId) return;
			this.renderError(error);
		}
	}

	private seedDefaultDecisions(preview: SettingsBackupRestorePreview): void {
		if (!this.decisions.selectedGroups) {
			this.decisions = {
				...this.decisions,
				selectedGroups: preview.groups.filter(group => group.selectable && group.defaultSelected).map(group => group.id),
			};
		}
	}

	private renderLoading(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: settingsBackupT('settingsBackupPreparingPreview') });
	}

	private renderError(error: unknown): void {
		console.debug('Operon: settings backup UI operation failed', error);
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: settingsBackupT('settingsBackupOperationFailed'),
			cls: 'operon-settings-error',
		});
		new Setting(this.contentEl).addButton(button => button
			.setButtonText(t('buttons', 'close'))
			.setCta()
			.onClick(() => this.close()));
	}

	private renderPreview(preview: SettingsBackupRestorePreview): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: settingsBackupT(preview.compatibility === 'exact'
				? 'settingsBackupCompatibilityExact'
				: preview.compatibility === 'partial'
					? 'settingsBackupCompatibilityPartial'
					: 'settingsBackupCompatibilityUnsupported'),
		});
		this.renderGroups(preview);
		this.renderVaultReferences(preview);
		this.renderTableResources(preview);
		for (const diagnostic of preview.diagnostics) {
			this.contentEl.createEl('p', { text: diagnostic, cls: 'operon-settings-muted-block' });
		}
		new Setting(this.contentEl)
			.setName(settingsBackupT('settingsBackupRollbackAcknowledge'))
			.setDesc(settingsBackupT('settingsBackupRollbackWarning'))
			.addToggle(toggle => toggle.setValue(this.acknowledged).onChange(value => {
				this.acknowledged = value;
				this.renderPreview(preview);
				this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
					this.contentEl.querySelector<HTMLElement>('[data-operon-settings-backup-restore]')?.focus();
				}, 0);
			}));
		const actions = new Setting(this.contentEl);
		actions.addButton(button => button.setButtonText(t('buttons', 'cancel')).onClick(() => this.close()));
		actions.addButton(button => {
			button.setButtonText(settingsBackupT('settingsBackupRestoreAction'))
				.setCta()
				.setDisabled(!this.canApply(preview))
				.onClick(() => { void this.apply(); });
			button.buttonEl.dataset.operonSettingsBackupRestore = 'true';
		});
		this.focusFirstControl();
	}

	private renderGroups(preview: SettingsBackupRestorePreview): void {
		this.contentEl.createEl('h3', { text: settingsBackupT('settingsBackupGroups') });
		const selected = new Set(this.decisions.selectedGroups ?? []);
		for (const group of preview.groups) {
			const desc = settingsBackupT('settingsBackupGroupCounts', {
				added: String(group.counts.added),
				removed: String(group.counts.removed),
				changed: String(group.counts.changed),
				unchanged: String(group.counts.unchanged),
			});
			new Setting(this.contentEl)
				.setName(group.label)
				.setDesc(group.issues.length > 0 ? `${desc} · ${group.issues.join(' · ')}` : desc)
				.addToggle(toggle => toggle
					.setValue(selected.has(group.id))
					.setDisabled(!group.selectable)
					.onChange(value => {
						if (value) selected.add(group.id);
						else selected.delete(group.id);
						this.decisions = { ...this.decisions, selectedGroups: [...selected] };
						void this.refreshPreview();
					}));
		}
	}

	private renderVaultReferences(preview: SettingsBackupRestorePreview): void {
		if (preview.vaultReferences.length === 0) return;
		this.contentEl.createEl('h3', { text: settingsBackupT('settingsBackupVaultReferences') });
		for (const reference of preview.vaultReferences) {
			new Setting(this.contentEl)
				.setName(reference.label)
				.setDesc(`${reference.path} · ${reference.status}`)
				.addDropdown(dropdown => dropdown
					.addOption('', settingsBackupT('settingsBackupChooseDecision'))
					.addOption('apply-source', settingsBackupT('settingsBackupApplySource'))
					.addOption('preserve-target', settingsBackupT('settingsBackupPreserveTarget'))
					.setValue(reference.decision ?? this.decisions.vaultReferences?.[reference.key] ?? '')
					.onChange(value => {
						const decisions = { ...(this.decisions.vaultReferences ?? {}) };
						if (value === 'apply-source' || value === 'preserve-target') decisions[reference.key] = value;
						else delete decisions[reference.key];
						this.decisions = { ...this.decisions, vaultReferences: decisions };
						void this.refreshPreview();
					}));
		}
	}

	private renderTableResources(preview: SettingsBackupRestorePreview): void {
		if (preview.tableResources.length === 0) return;
		this.contentEl.createEl('h3', { text: settingsBackupT('settingsBackupTableResources') });
		for (const resource of preview.tableResources) {
			const setting = new Setting(this.contentEl)
				.setName(resource.path)
				.setDesc(resource.message ?? settingsBackupT(resource.action === 'reuse'
					? 'settingsBackupTableReuse'
					: resource.action === 'create'
						? 'settingsBackupTableCreate'
						: resource.action === 'skip'
							? 'settingsBackupTableSkip'
							: 'settingsBackupTableConflict'));
			if (resource.action !== 'conflict' || !resource.conflictId) continue;
			setting.addDropdown(dropdown => dropdown
				.addOption('', settingsBackupT('settingsBackupChooseDecision'))
				.addOption('skip', settingsBackupT('settingsBackupSkipTable'))
				.addOption('cancel', settingsBackupT('settingsBackupCancelRestore'))
				.setValue(resource.decision ?? this.decisions.tableConflicts?.[resource.conflictId as string] ?? '')
				.onChange(value => {
					const decisions = { ...(this.decisions.tableConflicts ?? {}) };
					if (value === 'skip' || value === 'cancel') decisions[resource.conflictId as string] = value;
					else delete decisions[resource.conflictId as string];
					this.decisions = { ...this.decisions, tableConflicts: decisions };
					void this.refreshPreview();
				}));
		}
	}

	private canApply(preview: SettingsBackupRestorePreview): boolean {
		return !this.running && this.acknowledged && preview.classification === 'ready' && preview.planId !== null;
	}

	private async apply(): Promise<void> {
		const preview = this.preview;
		if (!this.file || !preview?.planId || !this.canApply(preview)) return;
		this.running = true;
		this.renderLoading();
		try {
			const result = await this.integration.applyRestore({
				file: this.file,
				planId: preview.planId,
				decisions: this.decisions,
				acceptsNoCrashSafeRollback: true,
				acceptsConditionalSessionOnlyUndo: true,
			});
			this.renderResult(result);
		} catch (error) {
			this.renderError(error);
		} finally {
			this.running = false;
		}
	}

	private renderResult(result: SettingsBackupApplyResult): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: result.message });
		if (result.recoveryRequired || result.undoTokenId !== null) {
			const recovery = this.integration.getPendingRecovery();
			if (recovery) this.renderRecoveryActions(recovery);
		}
		new Setting(this.contentEl).addButton(button => button
			.setButtonText(t('buttons', 'close'))
			.setCta()
			.onClick(() => this.close()));
		this.focusFirstControl();
	}

	private focusFirstControl(): void {
		this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
			this.contentEl.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled])')?.focus();
		}, 0);
	}

	private renderRecoveryActions(recovery: SettingsBackupPendingRecovery): void {
		this.contentEl.createEl('h3', { text: settingsBackupT('settingsBackupRecoveryTitle') });
		this.contentEl.createEl('p', { text: recovery.message });
		const setting = new Setting(this.contentEl);
		setting.addButton(button => button.setButtonText(settingsBackupT('settingsBackupKeep')).onClick(() => {
			void this.resolveRecovery('keep', recovery);
		}));
		if (recovery.canRetryRuntimeRefresh) setting.addButton(button => button
			.setButtonText(settingsBackupT('settingsBackupRetry'))
			.onClick(() => { void this.resolveRecovery('retry-runtime-refresh', recovery); }));
		if (recovery.canUndo) setting.addButton(button => {
			button.setButtonText(settingsBackupT('settingsBackupUndo'))
				.onClick(() => { void this.resolveRecovery('undo', recovery); });
			button.buttonEl.addClass('mod-warning');
		});
	}

	private async resolveRecovery(action: SettingsBackupRecoveryAction, recovery: SettingsBackupPendingRecovery): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.renderLoading();
		try {
			this.renderResult(await this.integration.resolveRecovery({
				action,
				receiptId: recovery.receiptId,
				undoTokenId: recovery.undoTokenId,
			}));
		} catch (error) {
			this.renderError(error);
		} finally {
			this.running = false;
		}
	}
}

export async function openSettingsBackupRestorePicker(
	app: App,
	ownerDocument: Document,
	integration: SettingsBackupUiIntegration,
): Promise<void> {
	try {
		const file = await chooseSettingsBackupFile(ownerDocument);
		if (file) new SettingsBackupRestoreModal(app, integration, file).open();
	} catch (error) {
		new Notice(error instanceof Error ? error.message : String(error));
	}
}
