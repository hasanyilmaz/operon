import { App, Modal, Setting } from 'obsidian';
import { t } from '../core/i18n';
import { ConfirmActionModal } from './confirm-action-modal';

export type IndexV8DiagnosticsAction =
	| 'refresh'
	| 'validate'
	| 'rebuild'
	| 'repair';

export type IndexV8DiagnosticsPhase = 'idle' | 'sync-settling' | 'rebasing' | 'recovery-required';
export type IndexV8DiagnosticsHealth =
	| 'healthy'
	| 'recovery-required'
	| 'sync-settling'
	| 'incomplete'
	| 'invalid'
	| 'unsupported'
	| 'missing';
export type IndexV8DiagnosticsHealthCode =
	| 'manifest-missing'
	| 'manifest-incomplete'
	| 'manifest-invalid'
	| 'manifest-unsupported'
	| 'io-error'
	| 'recovery-marker';
export type IndexV8DiagnosticsManifestStatus =
	| 'verified'
	| 'missing'
	| 'incomplete'
	| 'invalid'
	| 'unsupported'
	| 'io-error';
export type IndexV8DiagnosticsDisabledReason = 'busy' | 'unavailable' | 'unsafe' | 'notNeeded';

export interface IndexV8DiagnosticsActionAvailability {
	enabled: boolean;
	disabledReason?: IndexV8DiagnosticsDisabledReason;
}

/** Aggregate diagnostics only. Implementations must not include task IDs, source paths, or manifest payloads. */
export interface IndexV8DiagnosticsSummary {
	phase: IndexV8DiagnosticsPhase;
	health: IndexV8DiagnosticsHealth;
	codes: readonly IndexV8DiagnosticsHealthCode[];
	manifestStatus: IndexV8DiagnosticsManifestStatus;
	taskCount: number;
	sourceCount: number;
	activeShardCount: number;
	activeBytes: number;
	maxShardBytes: number;
	averageShardBytes: number;
	dirtySourceCount: number;
	recoveryMarkerPresent: boolean;
	lastInspectedAt?: number;
	actions?: Partial<Record<IndexV8DiagnosticsAction, IndexV8DiagnosticsActionAvailability>>;
}

export interface IndexV8DiagnosticsActionResult {
	status: 'applied' | 'unchanged' | 'suppressed' | 'partial' | 'failed';
	affectedFiles?: number;
	affectedBytes?: number;
}

/** Indexer-facing adapter. Keep all returned data aggregate-only. */
export interface IndexV8DiagnosticsDependencies {
	/** Metadata-only. This must not read active shard payloads. */
	readSummary(): Promise<IndexV8DiagnosticsSummary>;
	/** Explicit full snapshot and checksum validation. */
	validate(): Promise<IndexV8DiagnosticsActionResult>;
	rebuild(): Promise<IndexV8DiagnosticsActionResult>;
	repair(): Promise<IndexV8DiagnosticsActionResult>;
}

const ACTIONS: readonly IndexV8DiagnosticsAction[] = [
	'refresh',
	'validate',
	'rebuild',
	'repair',
];

const CONFIRMED_ACTIONS = new Set<IndexV8DiagnosticsAction>(['rebuild', 'repair']);

export class IndexV8DiagnosticsModal extends Modal {
	private summary: IndexV8DiagnosticsSummary | null = null;
	private busyAction: IndexV8DiagnosticsAction | null = null;
	private statusText = '';

	constructor(
		app: App,
		private readonly dependencies: IndexV8DiagnosticsDependencies,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('operon-confirm-action-modal');
		this.render();
		void this.loadSummary();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('indexStats', 'diagnosticsTitle'));
		contentEl.createEl('p', { text: t('indexStats', 'diagnosticsIntro') });

		if (!this.summary) {
			contentEl.createEl('p', {
				cls: 'setting-item-description',
				text: this.statusText || t('indexStats', 'diagnosticsLoading'),
			});
			return;
		}

		const summary = this.summary;
		this.addSummaryRow('diagnosticsPhase', this.phaseLabel(summary.phase));
		this.addSummaryRow('diagnosticsHealth', this.healthLabel(summary.health));
		this.addSummaryRow(
			'diagnosticsHealthCodes',
			summary.codes.length > 0
				? summary.codes.map(code => t('indexStats', `diagnosticsCode_${code}`)).join(', ')
				: t('indexStats', 'diagnosticsNone'),
		);
		this.addSummaryRow('diagnosticsManifest', this.manifestLabel(summary.manifestStatus));
		this.addSummaryRow('diagnosticsTasks', String(summary.taskCount));
		this.addSummaryRow('diagnosticsSources', String(summary.sourceCount));
		this.addSummaryRow('diagnosticsActiveShards', String(summary.activeShardCount));
		this.addSummaryRow('diagnosticsActiveBytes', this.formatBytes(summary.activeBytes));
		this.addSummaryRow('diagnosticsMaxShardBytes', this.formatBytes(summary.maxShardBytes));
		this.addSummaryRow('diagnosticsAverageShardBytes', this.formatBytes(summary.averageShardBytes));
		this.addSummaryRow('diagnosticsDirtySources', String(summary.dirtySourceCount));
		this.addSummaryRow(
			'diagnosticsRecoveryMarker',
			t('indexStats', summary.recoveryMarkerPresent ? 'diagnosticsYes' : 'diagnosticsNo'),
		);
		this.addSummaryRow(
			'diagnosticsLastChecked',
			summary.lastInspectedAt
				? new Date(summary.lastInspectedAt).toLocaleString()
				: t('indexStats', 'diagnosticsUnknown'),
		);

		contentEl.createEl('h3', { text: t('indexStats', 'diagnosticsActions') });
		for (const action of ACTIONS) this.addActionSetting(action);

		if (this.statusText) {
			contentEl.createEl('p', { cls: 'setting-item-description', text: this.statusText });
		}
	}

	private addSummaryRow(labelKey: string, value: string): void {
		new Setting(this.contentEl)
			.setName(t('indexStats', labelKey))
			.setDesc(value);
	}

	private addActionSetting(action: IndexV8DiagnosticsAction): void {
		const availability = this.summary?.actions?.[action];
		const disabled = this.busyAction !== null || availability?.enabled === false;
		const setting = new Setting(this.contentEl)
			.setName(this.actionLabel(action))
			.setDesc(
				availability?.enabled === false && availability.disabledReason
					? t('indexStats', `diagnosticsDisabled_${availability.disabledReason}`)
					: t('indexStats', `diagnosticsActionDesc_${action}`),
			);

		setting.addButton(button => {
			button
				.setButtonText(this.actionLabel(action))
				.setDisabled(disabled)
				.onClick(() => this.requestAction(action));
			if (action !== 'refresh') button.setCta();
		});
	}

	private requestAction(action: IndexV8DiagnosticsAction): void {
		if (this.busyAction) return;
		if (!CONFIRMED_ACTIONS.has(action)) {
			void this.runAction(action);
			return;
		}

		new ConfirmActionModal(
			this.app,
			{
				title: t('indexStats', 'diagnosticsConfirmTitle'),
				message: t('indexStats', 'diagnosticsConfirmMessage', { action: this.actionLabel(action) }),
				confirmText: t('indexStats', 'diagnosticsConfirmButton'),
				cancelText: t('buttons', 'cancel'),
				danger: false,
			},
			confirmed => {
				if (confirmed) void this.runAction(action);
			},
		).open();
	}

	private async runAction(action: IndexV8DiagnosticsAction): Promise<void> {
		this.busyAction = action;
		this.statusText = t('indexStats', 'diagnosticsRunning', { action: this.actionLabel(action) });
		this.render();
		try {
			if (action === 'refresh') {
				await this.loadSummary(false);
				this.statusText = t('indexStats', 'diagnosticsRefreshed');
			} else {
				const result = await this.dependencies[action]();
				this.statusText = this.resultLabel(action, result);
				this.summary = await this.dependencies.readSummary();
			}
		} catch {
			this.statusText = t('indexStats', 'diagnosticsFailed', { action: this.actionLabel(action) });
		} finally {
			this.busyAction = null;
			this.render();
		}
	}

	private async loadSummary(renderAfter = true): Promise<void> {
		try {
			this.summary = await this.dependencies.readSummary();
		} catch {
			this.statusText = t('indexStats', 'diagnosticsLoadFailed');
		}
		if (renderAfter) this.render();
	}

	private resultLabel(action: IndexV8DiagnosticsAction, result: IndexV8DiagnosticsActionResult): string {
		return t('indexStats', `diagnosticsResult_${result.status}`, {
			action: this.actionLabel(action),
			files: String(Math.max(0, result.affectedFiles ?? 0)),
			bytes: this.formatBytes(result.affectedBytes ?? 0),
		});
	}

	private actionLabel(action: IndexV8DiagnosticsAction): string {
		return t('indexStats', `diagnosticsAction_${action}`);
	}

	private phaseLabel(phase: IndexV8DiagnosticsPhase): string {
		return t('indexStats', `diagnosticsPhase_${phase}`);
	}

	private healthLabel(health: IndexV8DiagnosticsHealth): string {
		return t('indexStats', `diagnosticsHealth_${health}`);
	}

	private manifestLabel(status: IndexV8DiagnosticsManifestStatus): string {
		return t('indexStats', `diagnosticsManifest_${status}`);
	}

	private formatBytes(bytes: number): string {
		const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
		if (safeBytes < 1024) return `${Math.round(safeBytes)} B`;
		if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
		return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
	}
}
