import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import {
	buildOperonDataPackageFromSettings,
	type OperonDataPackageV1,
} from '../storage/operon-data-package';
import type { OperonSettings } from '../types/settings';
import {
	OPERON_SETTINGS_BACKUP_GROUP_NAMES,
	canonicalizeOperonSettingsBackupJson,
} from './settings-backup-format';
import {
	SETTINGS_BACKUP_GROUPS,
	type SettingsBackupProfileGroupId,
} from './settings-backup-compatibility';
import type {
	OperonSettingsBackupPreflightDiffCountsV1,
	OperonSettingsBackupRestorePlanV1,
	OperonSettingsBackupVaultReferenceCheckV1,
} from './settings-backup-preflight';
import type { SettingsBackupVaultReferenceKey } from './settings-backup-compatibility';

export type OperonSettingsBackupApplyBlockedReasonV1 =
	| 'acknowledgement-mismatch'
	| 'candidate-mismatch'
	| 'invalid-applied-at'
	| 'source-mismatch'
	| 'stale-target'
	| 'selection-mismatch'
	| 'user-decision-required'
	| 'vault-reference-changed'
	| 'writes-suspended';

export type OperonSettingsBackupApplyFailurePhaseV1 = 'stage' | 'persist' | 'runtime-commit' | 'commit-state-unknown';

export interface OperonSettingsBackupApplyAcknowledgementV1 {
	version: 1;
	planId: string;
	sourceBodyChecksum: string;
	targetConfigurationFingerprint: string;
	selectionFingerprint: string;
	candidateFingerprint: string;
	acceptsNoCrashSafeRollback: true;
}

export interface OperonSettingsBackupApplyInputV1 {
	sourceJson: string;
	restorePlan: OperonSettingsBackupRestorePlanV1;
	acknowledgement: OperonSettingsBackupApplyAcknowledgementV1;
	appliedAt: string;
	refreshedVaultReferenceChecks: Readonly<Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>>;
	/** Defaults to true. Reset uses false so its immutable receipt never advertises session Undo. */
	retainSessionUndo?: boolean;
}

export interface OperonSettingsBackupApplyRecoveryV1 {
	mode: 'none' | 'session-conditional-undo' | 'reload-required' | 'manual-backup-required';
	undoTokenId: string | null;
	expectedCurrentFingerprint: string | null;
	keepAvailable: boolean;
	retryRuntimeRefreshAvailable: boolean;
	undoAvailable: boolean;
}

export interface OperonSettingsBackupApplyReceiptV1 {
	version: 1;
	receiptId: string;
	status: 'success' | 'success-with-migrations' | 'runtime-degraded' | 'commit-state-unknown';
	appliedAt: string;
	planId: string;
	sourceBodyChecksum: string;
	previousTargetFingerprint: string;
	currentTargetFingerprint: string | null;
	selectionFingerprint: string;
	candidateFingerprint: string;
	selectedGroups: readonly SettingsBackupProfileGroupId[];
	counts: Readonly<OperonSettingsBackupPreflightDiffCountsV1>;
	recovery: Readonly<OperonSettingsBackupApplyRecoveryV1>;
	alreadyApplied: boolean;
	canonicalWrite: 'not-attempted' | 'committed' | 'committed-after-error' | 'state-unknown';
	runtimeSettlement: 'not-started' | 'settled' | 'degraded';
	warnings: readonly string[];
}

export type OperonSettingsBackupApplyResultV1 =
	| {
		status: 'success' | 'success-with-migrations';
		receipt: OperonSettingsBackupApplyReceiptV1;
		blockedReason: null;
		failurePhase: null;
	}
	| {
		status: 'partial-user-decision-required' | 'blocked';
		receipt: OperonSettingsBackupApplyReceiptV1 | null;
		blockedReason: OperonSettingsBackupApplyBlockedReasonV1 | null;
		failurePhase: 'runtime-commit' | 'commit-state-unknown' | null;
	}
	| {
		status: 'failed';
		receipt: OperonSettingsBackupApplyReceiptV1 | null;
		blockedReason: null;
		failurePhase: OperonSettingsBackupApplyFailurePhaseV1;
	};

export interface OperonSettingsBackupApplyReceiptInputV1 {
	status: OperonSettingsBackupApplyReceiptV1['status'];
	appliedAt: string;
	plan: OperonSettingsBackupRestorePlanV1;
	previousTargetFingerprint: string;
	currentTargetFingerprint: string | null;
	counts: OperonSettingsBackupPreflightDiffCountsV1;
	recovery: OperonSettingsBackupApplyRecoveryV1;
	alreadyApplied?: boolean;
	canonicalWrite?: OperonSettingsBackupApplyReceiptV1['canonicalWrite'];
	runtimeSettlement?: OperonSettingsBackupApplyReceiptV1['runtimeSettlement'];
	warnings?: readonly string[];
}

export type OperonSettingsBackupApplyAcknowledgementValidationV1 =
	| { ok: true; reason: null }
	| {
			ok: false;
			reason: Exclude<
				OperonSettingsBackupApplyBlockedReasonV1,
				'user-decision-required' | 'writes-suspended'
			>;
	  };

export function createOperonSettingsBackupApplyAcknowledgementV1(
	plan: OperonSettingsBackupRestorePlanV1,
): OperonSettingsBackupApplyAcknowledgementV1 {
	return Object.freeze({
		version: 1 as const,
		planId: plan.planId,
		sourceBodyChecksum: plan.sourceBodyChecksum,
		targetConfigurationFingerprint: plan.targetConfigurationFingerprint,
		selectionFingerprint: plan.selectionFingerprint,
		candidateFingerprint: plan.candidateFingerprint,
		acceptsNoCrashSafeRollback: true as const,
	});
}

export function validateOperonSettingsBackupApplyAcknowledgementV1(
	plan: OperonSettingsBackupRestorePlanV1,
	acknowledgement: OperonSettingsBackupApplyAcknowledgementV1,
): OperonSettingsBackupApplyAcknowledgementValidationV1 {
	if (acknowledgement.acceptsNoCrashSafeRollback !== true) {
		return { ok: false, reason: 'acknowledgement-mismatch' };
	}
	if (acknowledgement.version !== 1 || acknowledgement.sourceBodyChecksum !== plan.sourceBodyChecksum) {
		return { ok: false, reason: 'source-mismatch' };
	}
	if (acknowledgement.targetConfigurationFingerprint !== plan.targetConfigurationFingerprint) {
		return { ok: false, reason: 'stale-target' };
	}
	const selectionFingerprint = computeOperonSettingsBackupApplySelectionFingerprintV1(plan);
	if (
		plan.selectionFingerprint !== selectionFingerprint
		|| acknowledgement.selectionFingerprint !== selectionFingerprint
	) {
		return { ok: false, reason: 'selection-mismatch' };
	}
	const candidateFingerprint = fingerprint(plan.candidateSettings);
	if (
		plan.candidateFingerprint !== candidateFingerprint
		|| acknowledgement.candidateFingerprint !== candidateFingerprint
	) {
		return { ok: false, reason: 'candidate-mismatch' };
	}
	const planId = computeOperonSettingsBackupApplyPlanIdV1(plan);
	if (plan.planId !== planId || acknowledgement.planId !== planId) {
		return { ok: false, reason: 'acknowledgement-mismatch' };
	}
	return { ok: true, reason: null };
}

export function computeOperonSettingsBackupApplySelectionFingerprintV1(
	plan: Pick<
		OperonSettingsBackupRestorePlanV1,
		'selectedGroups' | 'vaultReferenceChecks' | 'vaultReferenceDecisions'
	>,
): string {
	return fingerprint({
		selectedGroups: normalizeSelectedGroups(plan.selectedGroups),
		vaultReferenceChecks: sortRecord(plan.vaultReferenceChecks),
		vaultReferenceDecisions: sortRecord(plan.vaultReferenceDecisions),
	});
}

export function computeOperonSettingsBackupApplyPlanIdV1(
	plan: Pick<
		OperonSettingsBackupRestorePlanV1,
		'sourceBodyChecksum' | 'targetConfigurationFingerprint' | 'selectionFingerprint' | 'candidateFingerprint'
	>,
): string {
	return fingerprint({
		sourceBodyChecksum: plan.sourceBodyChecksum,
		targetFingerprint: plan.targetConfigurationFingerprint,
		selectionFingerprint: plan.selectionFingerprint,
		candidateFingerprint: plan.candidateFingerprint,
	});
}

export function computeOperonSettingsBackupSettingsFingerprintV1(settings: OperonSettings): string {
	return fingerprint(settings);
}

export function buildOperonSettingsBackupSelectedPatchV1(
	plan: Pick<OperonSettingsBackupRestorePlanV1, 'selectedGroups' | 'candidateSettings'>,
): Partial<OperonSettings> {
	const patch: Partial<OperonSettings> = {};
	for (const group of normalizeSelectedGroups(plan.selectedGroups)) {
		const definition = SETTINGS_BACKUP_GROUPS.find(item => item.id === group);
		for (const key of definition?.settingKeys ?? []) {
			Object.assign(patch, { [key]: cloneJson(plan.candidateSettings[key]) });
		}
	}
	return patch;
}

export function computeOperonSettingsBackupSelectedSettingsFingerprintV1(
	settings: OperonSettings,
	selectedGroups: readonly SettingsBackupProfileGroupId[],
): string {
	return fingerprint(buildOperonSettingsBackupSelectedPatchV1({
		selectedGroups,
		candidateSettings: settings,
	}));
}

/**
 * Build the single JSON-only apply candidate while retaining package domains
 * that are explicitly outside the portable settings contract.
 */
export function projectOperonSettingsBackupApplyDataPackageV1(
	current: OperonDataPackageV1,
	candidateSettings: OperonSettings,
): OperonDataPackageV1 {
	const candidate = cloneJson(candidateSettings);
	const projected = buildOperonDataPackageFromSettings(candidate, {
		filterSets: candidate.filterSets,
		kanbanOrderBoards: current.views.kanbanOrder.boards,
		pinnedTasks: current.state.pinnedTasks,
		developerApiGrants: current.integrations.developerApi,
	});
	projected.views.kanbanOrder = cloneJson(current.views.kanbanOrder);
	projected.views.tablePresets = {
		...cloneJson(current.views.tablePresets),
		tableDefaultFolder: projected.views.tablePresets.tableDefaultFolder,
		tableEmbedVisibleRows: projected.views.tablePresets.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: projected.views.tablePresets.tableEmbedDefaultWidthPercent,
		tableShowLineNumbers: projected.views.tablePresets.tableShowLineNumbers,
		tableShowTaskIcon: projected.views.tablePresets.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: projected.views.tablePresets.tableShowTaskDataTypeIcon,
	};
	const projectedFavorites = projected.ui.presetFavorites!;
	projected.ui.presetFavorites = {
		...projectedFavorites,
		table: [...(current.ui.presetFavorites?.table ?? [])],
	};
	projected.integrations.mobileNotifications = cloneJson(current.integrations.mobileNotifications);
	projected.integrations.developerApi = cloneJson(current.integrations.developerApi);
	projected.state = cloneJson(current.state);
	return projected;
}

export function createOperonSettingsBackupApplyReceiptV1(
	input: OperonSettingsBackupApplyReceiptInputV1,
): OperonSettingsBackupApplyReceiptV1 {
	const selectedGroups = normalizeSelectedGroups(input.plan.selectedGroups);
	const recovery = cloneJson(input.recovery);
	const counts = cloneJson(input.counts);
	const receiptBody = {
		version: 1 as const,
		status: input.status,
		appliedAt: input.appliedAt,
		planId: input.plan.planId,
		sourceBodyChecksum: input.plan.sourceBodyChecksum,
		previousTargetFingerprint: input.previousTargetFingerprint,
		currentTargetFingerprint: input.currentTargetFingerprint,
		selectionFingerprint: input.plan.selectionFingerprint,
		candidateFingerprint: input.plan.candidateFingerprint,
		selectedGroups,
		counts,
		recovery,
		alreadyApplied: input.alreadyApplied ?? false,
		canonicalWrite: input.canonicalWrite ?? 'committed',
		runtimeSettlement: input.runtimeSettlement ?? 'not-started',
		warnings: [...(input.warnings ?? [])],
	};
	return deepFreeze({
		...receiptBody,
		receiptId: fingerprint(receiptBody),
	});
}

export function finalizeOperonSettingsBackupApplyReceiptV1(
	receipt: OperonSettingsBackupApplyReceiptV1,
	input: {
		status: OperonSettingsBackupApplyReceiptV1['status'];
		runtimeSettlement: OperonSettingsBackupApplyReceiptV1['runtimeSettlement'];
		warnings?: readonly string[];
		recovery?: OperonSettingsBackupApplyRecoveryV1;
	},
): OperonSettingsBackupApplyReceiptV1 {
	const { receiptId: _receiptId, ...body } = receipt;
	const nextBody = {
		...cloneJson(body),
		status: input.status,
		runtimeSettlement: input.runtimeSettlement,
		warnings: [...receipt.warnings, ...(input.warnings ?? [])],
		recovery: input.recovery ? cloneJson(input.recovery) : cloneJson(receipt.recovery),
	};
	return deepFreeze({ ...nextBody, receiptId: fingerprint(nextBody) });
}

function normalizeSelectedGroups(groups: readonly SettingsBackupProfileGroupId[]): SettingsBackupProfileGroupId[] {
	const known = new Set<SettingsBackupProfileGroupId>(OPERON_SETTINGS_BACKUP_GROUP_NAMES);
	return [...new Set(groups.filter(group => known.has(group)))].sort();
}

function sortRecord<T>(value: Readonly<Partial<Record<string, T>>>): Partial<Record<string, T>> {
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function fingerprint(value: unknown): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(cloneJson(value)));
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return value;
}
