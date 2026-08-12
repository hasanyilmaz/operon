import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	createSettingsBackupFilePickerRegistry,
	createSettingsBackupFilePickerSettlement,
	detectSettingsBackupFileKind,
	isSettingsBackupFileSizeAllowed,
	SettingsBackupFileAdmissionError,
	SETTINGS_BACKUP_JSON_MAX_BYTES,
} from '../src/ui/settings-backup-file-admission';
import {
	buildOperonSettingsBackupRecoveryCapabilitiesV1,
	SETTINGS_BACKUP_RUNTIME_REFRESH_STEPS,
} from '../src/core/settings-backup-recovery-state';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

test('picker accepts a delayed valid change without inferring cancellation from focus', () => {
	const selected: Array<object | null> = [];
	const file = { name: 'operon-settings-backup.json' };
	const settlement = createSettingsBackupFilePickerSettlement<object>(value => selected.push(value));
	assert.deepEqual(selected, []);
	assert.equal(settlement.settle(file), true);
	assert.deepEqual(selected, [file]);
});

test('picker settles once for selection and explicit cancellation', () => {
	const file = { name: 'operon-settings-backup.json' };
	const selected: Array<object | null> = [];
	const changed = createSettingsBackupFilePickerSettlement<object>(value => selected.push(value));
	assert.equal(changed.settle(file), true);
	assert.equal(changed.settle(null), false);
	assert.deepEqual(selected, [file]);

	const cancelledValues: Array<object | null> = [];
	const cancelled = createSettingsBackupFilePickerSettlement<object>(value => cancelledValues.push(value));
	assert.equal(cancelled.settle(null), true);
	assert.equal(cancelled.settle(file), false);
	assert.deepEqual(cancelledValues, [null]);
});

test('a new picker invocation cancels one stale provider without accumulating inputs', () => {
	const registry = createSettingsBackupFilePickerRegistry<object>();
	const documentKey = {};
	const cancelled: string[] = [];
	const releaseFirst = registry.register(documentKey, () => cancelled.push('first'));
	const releaseSecond = registry.register(documentKey, () => cancelled.push('second'));
	assert.deepEqual(cancelled, ['first']);
	releaseFirst();
	const releaseThird = registry.register(documentKey, () => cancelled.push('third'));
	assert.deepEqual(cancelled, ['first', 'second']);
	releaseSecond();
	releaseThird();
});

test('picker settlement state is per invocation so the same file can be selected again', () => {
	const file = { name: 'operon-settings-backup.json' };
	const selected: object[] = [];
	for (let invocation = 0; invocation < 2; invocation += 1) {
		const settlement = createSettingsBackupFilePickerSettlement<object>(value => {
			if (value) selected.push(value);
		});
		assert.equal(settlement.settle(file), true);
	}
	assert.deepEqual(selected, [file, file]);
});

test('file admission identifies JSON from bytes and rejects ZIP magic', () => {
	assert.equal(detectSettingsBackupFileKind(encode('  {"format":"operon-settings"}')), 'json');
	assert.equal(detectSettingsBackupFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null);
	assert.equal(detectSettingsBackupFileKind(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), null);
	assert.equal(detectSettingsBackupFileKind(encode('["not-an-operon-backup"]')), null);
});

test('file admission enforces the exact JSON byte limit before full read', () => {
	assert.equal(isSettingsBackupFileSizeAllowed('json', SETTINGS_BACKUP_JSON_MAX_BYTES), true);
	assert.equal(isSettingsBackupFileSizeAllowed('json', SETTINGS_BACKUP_JSON_MAX_BYTES + 1), false);
	assert.equal(isSettingsBackupFileSizeAllowed('json', -1), false);
});

test('file admission failures use stable typed codes without provider details', () => {
	for (const code of ['unsupported-content', 'json-size-limit', 'provider-read-failed'] as const) {
		const error = new SettingsBackupFileAdmissionError(code);
		assert.equal(error.code, code);
		assert.equal(error.message, code);
	}
});

test('picker is transient, owner-document scoped, reset, and detached in finally', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /ownerDocument\.win\.createEl\('input'\)/u);
	assert.match(source, /input\.accept = '\.json,application\/json'/u);
	assert.doesNotMatch(source, /addEventListener\('focus'/u);
	assert.match(source, /settingsBackupFilePickerRegistry\.register/u);
	assert.match(source, /finally \{\s*releasePendingPicker\(\);\s*input\.value = '';\s*input\.remove\(\);/u);
	assert.doesNotMatch(source, /electron|showOpenDialog|require\(['"]fs/u);
});

test('download uses the owner window Blob and revokes its object URL', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /new ownerWindow\.Blob/u);
	assert.match(source, /ownerWindow\.URL\.createObjectURL/u);
	assert.match(source, /ownerWindow\.URL\.revokeObjectURL/u);
});

test('Settings tab exports portable JSON without transient inclusion options', () => {
	const source = readFileSync('src/ui/settings-tab.ts', 'utf8');
	assert.match(source, /integration\.exportBackup\(\)/u);
	assert.doesNotMatch(source, /includeExternalCalendarUrls|settingsBackupIncludeExternalCalendars/u);
	assert.match(source, /id: 'coreBackupRestore', groupId: 'core'/u);
	assert.ok(
		source.indexOf("{ id: 'coreBackupRestore', groupId: 'core'")
			> source.indexOf("{ id: 'coreCustomKeys', groupId: 'core'"),
		'Backup & Restore must be the final Core settings page after Custom Keys.',
	);
	assert.doesNotMatch(source, /includeTablePresetFiles|settingsBackupIncludeTables/u);
});

test('Settings backup integration exposes an option-free export boundary', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /exportBackup\(\): Promise<SettingsBackupDownloadArtifact>;/u);
	assert.doesNotMatch(source, /SettingsBackupExportOptions|includeExternalCalendarUrls/u);
});

test('restore flow uses one responsive Obsidian modal with keyboard focus support', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /class SettingsBackupRestoreModal extends Modal/u);
	assert.match(source, /operon-confirm-action-modal-wide/u);
	assert.match(source, /querySelector<HTMLElement>\('input:not\(\[disabled\]\), select:not/u);
	assert.equal((source.match(/class SettingsBackupRestoreModal extends Modal/gu) ?? []).length, 1);
});

test('initial decisions are re-preflighted and every mutable decision invalidates acknowledgement', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /if \(this\.seedDefaultDecisions\(preview\)\) \{\s*await this\.refreshPreview\(\);/u);
	assert.match(source, /beginDecisionChange\(`group:/u);
	assert.match(source, /beginDecisionChange\(`vault:/u);
	assert.match(source, /this\.acknowledged = false;/u);
	assert.match(source, /this\.preview\.planId !== preview\.planId\) this\.acknowledged = false/u);
});

test('asynchronous preview announces loading and restores the changed control focus', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /'aria-live': 'polite'/u);
	assert.match(source, /data-operon-settings-backup-control/u);
	assert.match(source, /restoreDecisionFocus\(\)/u);
	assert.match(source, /control\.dataset\.operonSettingsBackupControl === controlId/u);
});

test('picker maps provider failures to safe copy and Resume renders its specific unavailable state', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /new Notice\(settingsBackupFileAdmissionMessage\(error\)\)/u);
	assert.doesNotMatch(source, /new Notice\(error instanceof Error \? error\.message/u);
	assert.match(source, /this\.renderRecoveryUnavailable\(\)/u);
	assert.match(source, /text: settingsBackupT\('settingsBackupRecoveryUnavailable'\)/u);
});

test('recovery actions render only from exact capability flags', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /if \(recovery\.canKeep\)/u);
	assert.match(source, /if \(recovery\.canRetryRuntimeRefresh\)/u);
	assert.match(source, /if \(recovery\.canUndo\)/u);
});

test('manual recovery capabilities remain receipt-bound without unsupported actions', () => {
	const recovery = buildOperonSettingsBackupRecoveryCapabilitiesV1({
		receiptId: 'receipt-state-unknown',
		undoTokenId: null,
		message: 'Manual recovery is required.',
		runtimeRetryRequired: false,
		undoAvailable: false,
	});
	assert.deepEqual(recovery, {
		receiptId: 'receipt-state-unknown',
		undoTokenId: null,
		message: 'Manual recovery is required.',
		canKeep: false,
		canRetryRuntimeRefresh: false,
		canUndo: false,
	});
});

test('runtime recovery exposes only ordered, deduplicated safe component identifiers', () => {
	const recovery = buildOperonSettingsBackupRecoveryCapabilitiesV1({
		receiptId: 'receipt-runtime-degraded',
		undoTokenId: 'undo-runtime-degraded',
		message: 'Safe fallback copy.',
		runtimeRetryRequired: true,
		undoAvailable: true,
		displayKind: 'runtime-refresh-incomplete',
		failedRuntimeSteps: ['reindex', 'locale', 'reindex'],
	});
	assert.deepEqual(recovery.failedRuntimeSteps, ['locale', 'reindex']);
	assert.deepEqual(SETTINGS_BACKUP_RUNTIME_REFRESH_STEPS, [
		'standard-refresh', 'locale', 'agent-runtime', 'reindex', 'external-calendars', 'mobile-notifications',
	]);
});

test('runtime-degraded recovery uses one localized status, safe component list and focused Retry action', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	const degradedRenderer = source.slice(
		source.indexOf('private renderRuntimeRefreshIncomplete'),
		source.indexOf('private runtimeRefreshStepLabel'),
	);
	assert.match(degradedRenderer, /settingsBackupRuntimeDegradedTitle/u);
	assert.match(degradedRenderer, /settingsBackupRuntimeDegradedBody/u);
	assert.match(degradedRenderer, /settingsBackupRuntimeFailedStepsTitle/u);
	assert.match(degradedRenderer, /failedRuntimeSteps/u);
	assert.match(degradedRenderer, /const status = this\.contentEl\.createDiv[\s\S]*role: 'status', 'aria-live': 'polite'/u);
	assert.match(degradedRenderer, /status\.createEl\('h3'/u);
	assert.match(degradedRenderer, /status\.createEl\('ul'/u);
	assert.match(degradedRenderer, /status\.createEl\('p', \{ text: settingsBackupT\('settingsBackupRuntimeRecoveryInstruction'\)/u);
	assert.doesNotMatch(degradedRenderer, /recovery\.message|new Setting|buttons', 'close'/u);
	assert.match(source, /operon-settings-backup-recovery-actions/u);
	assert.match(source, /operon-settings-backup-recovery-primary-actions/u);
	assert.match(source, /retry\.addClass\('mod-cta'\)/u);
	assert.match(source, /setTimeout\(\(\) => retry\.focus\(\), 0\)/u);
	for (const key of [
		'settingsBackupRuntimeStepStandardRefresh',
		'settingsBackupRuntimeStepLocale',
		'settingsBackupRuntimeStepAgentRuntime',
		'settingsBackupRuntimeStepReindex',
		'settingsBackupRuntimeStepExternalCalendars',
		'settingsBackupRuntimeStepMobileNotifications',
	]) assert.match(source, new RegExp(key, 'u'));
	const styles = readFileSync('styles.css', 'utf8');
	assert.match(styles, /@media \(max-width: 560px\)[\s\S]*operon-settings-backup-recovery-actions \{\s*flex-direction: column;/u);
	assert.doesNotMatch(styles, /operon-settings-backup-recovery-actions \{\s*flex-direction: column-reverse;/u);
});

test('commit-state-unknown remains resumable as receipt-owned manual recovery', () => {
	const source = readFileSync('main.ts', 'utf8');
	assert.match(
		source,
		/uiResult\.receiptId && uiResult\.status === 'state-unknown'[\s\S]*buildSettingsBackupManualRecoveryStateV1/u,
	);
	assert.match(
		source,
		/undone\.failurePhase === 'commit-state-unknown'[\s\S]*pendingSettingsBackupRuntimeRecovery = null/u,
	);
	assert.match(
		source,
		/result\.failurePhase === 'commit-state-unknown'[\s\S]*lastSettingsBackupUiRecovery = this\.buildSettingsBackupManualRecoveryStateV1/u,
	);
	assert.match(
		source,
		/buildSettingsBackupManualRecoveryStateV1[\s\S]*undoTokenId: null[\s\S]*runtimeRetryRequired: false[\s\S]*undoAvailable: false/u,
	);
});

test('restore admission binds both recovery acknowledgements and fresh Vault checks', () => {
	const uiSource = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	const pluginSource = readFileSync('main.ts', 'utf8');
	assert.match(uiSource, /acceptsNoCrashSafeRollback: true,[\s\S]*acceptsConditionalSessionOnlyUndo: true/u);
	assert.match(pluginSource, /input\.acceptsNoCrashSafeRollback !== true[\s\S]*input\.acceptsConditionalSessionOnlyUndo !== true/u);
	assert.match(pluginSource, /captureSettingsBackupVaultReferenceChecksV1\(sourceJson\)/u);
	assert.match(pluginSource, /getAbstractFileByPath\(path\)/u);
	assert.match(
		pluginSource,
		/if \(this\.pendingSettingsBackupRuntimeRecovery \|\| this\.lastSettingsBackupUiRecovery\) \{[\s\S]*Resolve the pending settings recovery before restoring another backup\./u,
	);
	assert.doesNotMatch(pluginSource, /Object\.keys\(vaultReferenceDecisions\)[\s\S]{0,120}status: 'unchecked'/u);
});

test('restore errors are redacted and successful receipts retain conditional recovery controls', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /text: settingsBackupT\('settingsBackupOperationFailed'\)/u);
	assert.match(source, /attr: \{ role: 'alert', 'aria-live': 'assertive' \}/u);
	assert.match(source, /private renderError[\s\S]*this\.focusFirstControl\(\);/u);
	assert.doesNotMatch(source, /text: error instanceof Error \? error\.message/u);
	assert.match(source, /result\.recoveryRequired \|\| result\.undoTokenId !== null/u);
	assert.match(source, /settingsBackupRestoreSuccessTitle/u);
	assert.match(source, /operon-settings-backup-success-actions/u);
	assert.match(source, /action === 'keep' && result\.status === 'committed' && !result\.recoveryRequired[\s\S]*this\.close\(\)/u);
	assert.match(source, /setTimeout\(\(\) => keepButton\.focus\(\), 0\)/u);
	const committedRenderer = source.slice(
		source.indexOf('private renderCommittedRestore'),
		source.indexOf('private focusFirstControl'),
	);
	assert.doesNotMatch(committedRenderer, /setButtonText\(t\('buttons', 'close'\)\)|new Setting/u);
});

test('Settings backup integration exposes reset and the Reset card is guarded and deduplicated', () => {
	const uiSource = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	const tabSource = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const confirmSource = readFileSync('src/ui/confirm-action-modal.ts', 'utf8');
	const pluginSource = readFileSync('main.ts', 'utf8');
	assert.match(uiSource, /resetSettings\(\): Promise<SettingsBackupApplyResult>/u);
	assert.match(tabSource, /settingsBackupResetTitle/u);
	assert.match(tabSource, /if \(resetRunning\) return;/u);
	assert.match(tabSource, /if \(!confirmed\) \{[\s\S]*return;[\s\S]*integration\.resetSettings\(\)/u);
	assert.match(tabSource, /initialFocus: 'cancel'/u);
	assert.match(tabSource, /integration\.resetSettings\(\)/u);
	assert.match(tabSource, /result\.status === 'committed' && !result\.recoveryRequired[\s\S]*settingsBackupResetSuccess/u);
	assert.match(tabSource, /result\.recoveryRequired \|\| result\.status === 'state-unknown'[\s\S]*new SettingsBackupRestoreModal/u);
	assert.match(confirmSource, /initialFocus\?: 'confirm' \| 'cancel'/u);
	assert.match(confirmSource, /this\.options\.initialFocus === 'cancel' \? cancelButton : confirmButton/u);
	assert.match(pluginSource, /resetSettings: \(\) => this\.resetSettingsToDefaultsFromUiV1\(\)/u);
	assert.match(pluginSource, /createOperonSettingsResetDefaultProfileV1/u);
	assert.match(pluginSource, /selectedGroups: OPERON_SETTINGS_RESET_DEFAULT_GROUPS_V1/u);
	assert.match(pluginSource, /vaultReferences: OPERON_SETTINGS_RESET_DEFAULT_VAULT_REFERENCE_DECISIONS_V1/u);
	assert.match(pluginSource, /applySettingsBackupRestoreFromUiV1\([\s\S]*\}, true, false\)/u);
	assert.match(pluginSource, /retainSessionUndo,/u);
	assert.match(pluginSource, /recovery\.undoTokenId[\s\S]*mode: 'reload-required'/u);
	assert.match(pluginSource, /return \{ \.\.\.result, status: 'committed', undoTokenId: null \}/u);
	const resetCard = tabSource.slice(
		tabSource.indexOf("settingsBackupT('settingsBackupResetTitle')"),
		tabSource.indexOf('private renderDeveloperApiIntegrations'),
	);
	assert.doesNotMatch(resetCard, /DEFAULT_SETTINGS|saveSettings\(/u);
});

test('Backup and Restore card descriptions use a scoped inset', () => {
	const tabSource = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const styles = readFileSync('styles.css', 'utf8');
	assert.ok((tabSource.match(/operon-settings-backup-section-card/gu) ?? []).length >= 3);
	assert.match(styles, /operon-settings-backup-section-card > \.operon-settings-muted-block[\s\S]*padding: 18px 24px 14px/u);
});

test('restore success and reset confirmation use the approved copy', () => {
	const locale = JSON.parse(readFileSync('i18n/locales/en.json', 'utf8')) as {
		settings: Record<string, string>;
	};
	assert.equal(locale.settings.settingsBackupRestoreSuccessTitle, 'Settings restored');
	assert.equal(
		locale.settings.settingsBackupRestoreSuccessBody,
		'Your backup is now active. Keep these settings, or undo the restore during this Obsidian session.',
	);
	assert.equal(locale.settings.settingsBackupResetConfirmTitle, 'Reset all settings?');
	assert.equal(
		locale.settings.settingsBackupResetConfirmMessage,
		'This restores Operon’s current default settings. Your vault content and Table files will not be deleted.',
	);
	assert.equal(locale.settings.settingsBackupResetConfirm, 'Reset settings');
	assert.equal(locale.settings.settingsBackupResetSuccess, 'Settings reset.');
});
