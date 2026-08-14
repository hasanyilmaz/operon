import {
	DEFAULT_SETTINGS,
	migrateSettings,
} from '../types/settings';
import {
	SETTINGS_BACKUP_GROUPS,
	SETTINGS_BACKUP_VAULT_REFERENCE_KEYS,
	type SettingsBackupProfileGroupId,
	type SettingsBackupVaultReferenceKey,
} from './settings-backup-compatibility';
import {
	exportOperonSettingsBackupJsonV1,
	type OperonSettingsBackupExportResultV1,
	type OperonSettingsBackupExportSourceV1,
} from './settings-backup-export';
import {
	preflightOperonSettingsBackupRestoreV1,
	type OperonSettingsBackupPreflightResultV1,
	type OperonSettingsBackupPreflightTargetSnapshotV1,
	type OperonSettingsBackupVaultReferenceCheckV1,
	type OperonSettingsBackupVaultReferenceDecisionV1,
} from './settings-backup-preflight';

export const OPERON_SETTINGS_RESET_DEFAULT_GROUPS_V1: readonly SettingsBackupProfileGroupId[] = Object.freeze(
	SETTINGS_BACKUP_GROUPS.map(group => group.id),
);

export const OPERON_SETTINGS_RESET_DEFAULT_VAULT_REFERENCE_DECISIONS_V1: Readonly<
	Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>
> = Object.freeze(Object.fromEntries(SETTINGS_BACKUP_VAULT_REFERENCE_KEYS.map(key => [
	key,
	'apply-source' as const,
])) as Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>);

export interface OperonSettingsResetDefaultProfileInputV1 {
	source: OperonSettingsBackupExportSourceV1;
	createdAt: string;
}

export interface OperonSettingsResetDefaultsPreflightInputV1 extends OperonSettingsResetDefaultProfileInputV1 {
	targetSnapshot: OperonSettingsBackupPreflightTargetSnapshotV1;
	vaultReferenceChecks?: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>;
}

export interface OperonSettingsResetDefaultsPreflightResultV1 {
	profile: OperonSettingsBackupExportResultV1;
	preflight: OperonSettingsBackupPreflightResultV1 | null;
}

/**
 * Build the current-version reset profile entirely in memory. The portable
 * backup contract intentionally excludes Table resources and protected package
 * domains; callers own confirmation, admission and persistence.
 */
export function createOperonSettingsResetDefaultProfileV1(
	input: OperonSettingsResetDefaultProfileInputV1,
): OperonSettingsBackupExportResultV1 {
	const defaults = migrateSettings(cloneJson(DEFAULT_SETTINGS));
	return exportOperonSettingsBackupJsonV1({
		settings: defaults,
		source: input.source,
		createdAt: input.createdAt,
	});
}

/**
 * Compose a reset preview through the same strict parser and preflight used by
 * imported JSON. Every current portable group is explicitly selected, while
 * vault-bound settings and External Calendar sources intentionally reset to
 * their current defaults.
 */
export function preflightOperonSettingsResetDefaultsV1(
	input: OperonSettingsResetDefaultsPreflightInputV1,
): OperonSettingsResetDefaultsPreflightResultV1 {
	const profile = createOperonSettingsResetDefaultProfileV1(input);
	if (!profile.ok) return { profile, preflight: null };
	return {
		profile,
		preflight: preflightOperonSettingsBackupRestoreV1({
			sourceJson: profile.json,
			targetSnapshot: input.targetSnapshot,
			selectedGroups: OPERON_SETTINGS_RESET_DEFAULT_GROUPS_V1,
			vaultReferenceChecks: input.vaultReferenceChecks,
			vaultReferenceDecisions: OPERON_SETTINGS_RESET_DEFAULT_VAULT_REFERENCE_DECISIONS_V1,
		}),
	};
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
