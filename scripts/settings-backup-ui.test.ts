import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	detectSettingsBackupFileKind,
	isSettingsBackupFileSizeAllowed,
	SETTINGS_BACKUP_JSON_MAX_BYTES,
	SETTINGS_BACKUP_ZIP_MAX_BYTES,
} from '../src/ui/settings-backup-file-admission';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

test('file admission identifies JSON and ZIP from bytes, not extension or MIME', () => {
	assert.equal(detectSettingsBackupFileKind(encode('  {"format":"operon-settings"}')), 'json');
	assert.equal(detectSettingsBackupFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'zip');
	assert.equal(detectSettingsBackupFileKind(new Uint8Array([0x50, 0x4b, 0x05, 0x06])), 'zip');
	assert.equal(detectSettingsBackupFileKind(encode('["not-an-operon-backup"]')), null);
});

test('file admission enforces exact JSON and ZIP byte limits before full read', () => {
	assert.equal(isSettingsBackupFileSizeAllowed('json', SETTINGS_BACKUP_JSON_MAX_BYTES), true);
	assert.equal(isSettingsBackupFileSizeAllowed('json', SETTINGS_BACKUP_JSON_MAX_BYTES + 1), false);
	assert.equal(isSettingsBackupFileSizeAllowed('zip', SETTINGS_BACKUP_ZIP_MAX_BYTES), true);
	assert.equal(isSettingsBackupFileSizeAllowed('zip', SETTINGS_BACKUP_ZIP_MAX_BYTES + 1), false);
	assert.equal(isSettingsBackupFileSizeAllowed('json', -1), false);
});

test('picker is transient, owner-document scoped, reset, and detached in finally', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /ownerDocument\.win\.createEl\('input'\)/u);
	assert.match(source, /input\.accept = '\.json,\.zip,application\/json,application\/zip'/u);
	assert.match(source, /finally \{\s*input\.value = '';\s*input\.remove\(\);/u);
	assert.doesNotMatch(source, /electron|showOpenDialog|require\(['"]fs/u);
});

test('download uses the owner window Blob and revokes its object URL', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /new ownerWindow\.Blob/u);
	assert.match(source, /ownerWindow\.URL\.createObjectURL/u);
	assert.match(source, /ownerWindow\.URL\.revokeObjectURL/u);
});

test('Settings tab keeps backup options transient and defaults both opt-ins off', () => {
	const source = readFileSync('src/ui/settings-tab.ts', 'utf8');
	assert.match(source, /let includeTablePresetFiles = false;/u);
	assert.match(source, /let includeExternalCalendarUrls = false;/u);
	assert.match(source, /id: 'coreBackupRestore', groupId: 'core'/u);
	assert.doesNotMatch(source, /this\.settings\.includeTablePresetFiles/u);
});

test('restore flow uses one responsive Obsidian modal with keyboard focus support', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /class SettingsBackupRestoreModal extends Modal/u);
	assert.match(source, /operon-confirm-action-modal-wide/u);
	assert.match(source, /querySelector<HTMLElement>\('input:not\(\[disabled\]\), select:not/u);
	assert.equal((source.match(/class SettingsBackupRestoreModal extends Modal/gu) ?? []).length, 1);
});

test('restore admission binds both recovery acknowledgements and fresh Vault checks', () => {
	const uiSource = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	const pluginSource = readFileSync('main.ts', 'utf8');
	assert.match(uiSource, /acceptsNoCrashSafeRollback: true,[\s\S]*acceptsConditionalSessionOnlyUndo: true/u);
	assert.match(pluginSource, /input\.acceptsNoCrashSafeRollback !== true[\s\S]*input\.acceptsConditionalSessionOnlyUndo !== true/u);
	assert.match(pluginSource, /captureSettingsBackupVaultReferenceChecksV1\(sourceJson\)/u);
	assert.match(pluginSource, /getAbstractFileByPath\(path\)/u);
	assert.doesNotMatch(pluginSource, /Object\.keys\(vaultReferenceDecisions\)[\s\S]{0,120}status: 'unchecked'/u);
});

test('restore errors are redacted and successful receipts retain conditional recovery controls', () => {
	const source = readFileSync('src/ui/settings-backup-ui.ts', 'utf8');
	assert.match(source, /text: settingsBackupT\('settingsBackupOperationFailed'\)/u);
	assert.doesNotMatch(source, /text: error instanceof Error \? error\.message/u);
	assert.match(source, /result\.recoveryRequired \|\| result\.undoTokenId !== null/u);
});
