import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import {
	computeOperonSettingsBackupApplyPlanIdV1,
	computeOperonSettingsBackupApplySelectionFingerprintV1,
	computeOperonSettingsBackupSettingsFingerprintV1,
	type OperonSettingsBackupApplyBlockedReasonV1,
} from './settings-backup-apply';
import { canonicalizeOperonSettingsBackupJson } from './settings-backup-format';
import type {
	OperonSettingsBackupPreflightResultV1,
	OperonSettingsBackupRestorePlanV1,
} from './settings-backup-preflight';
import {
	computeOperonSettingsBackupTableResourcePlanIdV1,
	type OperonSettingsBackupTableResourcePreflightResultV1,
	type OperonSettingsBackupTableResourceRestorePlanV1,
} from './settings-backup-table-resource-preflight';

export interface OperonSettingsBackupTableBundleRestorePlanV1 {
	version: 1;
	planId: string;
	archiveSha256: string;
	settingsPlan: OperonSettingsBackupRestorePlanV1;
	tablePlan: OperonSettingsBackupTableResourceRestorePlanV1;
}

export interface OperonSettingsBackupTableBundleApplyAcknowledgementV1 {
	version: 1;
	planId: string;
	archiveSha256: string;
	settingsPlanId: string;
	settingsSelectionFingerprint: string;
	tablePlanId: string;
	tableDecisionFingerprint: string;
	acceptsNoCrashSafeRollback: true;
	acceptsConditionalSessionOnlyUndo: true;
}

export type OperonSettingsBackupTableBundleCompositionReasonV1 =
	| 'invalid-archive-sha256'
	| 'settings-invalid'
	| 'settings-decision-required'
	| 'settings-blocked'
	| 'table-decision-required'
	| 'table-canceled'
	| 'table-blocked'
	| 'settings-plan-invalid'
	| 'table-plan-invalid'
	| 'archive-mismatch'
	| 'source-mismatch';

export interface OperonSettingsBackupTableBundleCompositionResultV1 {
	classification: 'ready' | 'decision-required' | 'canceled' | 'blocked';
	reason: OperonSettingsBackupTableBundleCompositionReasonV1 | null;
	plan: OperonSettingsBackupTableBundleRestorePlanV1 | null;
}

export interface OperonSettingsBackupTableBundleAcknowledgementValidationV1 {
	ok: boolean;
	reason: OperonSettingsBackupApplyBlockedReasonV1 | null;
}

export function composeOperonSettingsBackupTableBundleRestorePlanV1(input: {
	archiveSha256: string;
	settingsPreflight: OperonSettingsBackupPreflightResultV1;
	tablePreflight: OperonSettingsBackupTableResourcePreflightResultV1;
}): OperonSettingsBackupTableBundleCompositionResultV1 {
	if (!isSha256(input.archiveSha256)) return composition('blocked', 'invalid-archive-sha256');
	if (!input.settingsPreflight.ok) return composition('blocked', 'settings-invalid');
	if (input.settingsPreflight.classification === 'decision-required') {
		return composition('decision-required', 'settings-decision-required');
	}
	if (input.settingsPreflight.classification !== 'ready' || !input.settingsPreflight.restorePlan) {
		return composition('blocked', 'settings-blocked');
	}
	if (input.tablePreflight.classification === 'decision-required') {
		return composition('decision-required', 'table-decision-required');
	}
	if (input.tablePreflight.classification === 'canceled') return composition('canceled', 'table-canceled');
	if (input.tablePreflight.classification !== 'ready' || !input.tablePreflight.plan) {
		return composition('blocked', 'table-blocked');
	}

	const settingsPlan = input.settingsPreflight.restorePlan;
	const tablePlan = input.tablePreflight.plan;
	if (!validateSettingsPlan(settingsPlan)) return composition('blocked', 'settings-plan-invalid');
	if (!validateTablePlan(tablePlan)) return composition('blocked', 'table-plan-invalid');
	if (tablePlan.archiveSha256 !== input.archiveSha256) return composition('blocked', 'archive-mismatch');
	if (tablePlan.sourceBodyChecksum !== settingsPlan.sourceBodyChecksum) {
		return composition('blocked', 'source-mismatch');
	}

	const planMaterial = {
		version: 1 as const,
		archiveSha256: input.archiveSha256,
		settingsPlan,
		tablePlan,
	};
	const plan = deepFreeze({
		...cloneJson(planMaterial),
		planId: computeOperonSettingsBackupTableBundlePlanIdV1(planMaterial),
	});
	return { classification: 'ready', reason: null, plan };
}

export function computeOperonSettingsBackupTableBundlePlanIdV1(
	plan: Pick<OperonSettingsBackupTableBundleRestorePlanV1, 'archiveSha256' | 'settingsPlan' | 'tablePlan'>,
): string {
	return fingerprint({
		archiveSha256: plan.archiveSha256,
		settingsPlanId: plan.settingsPlan.planId,
		tablePlanId: plan.tablePlan.planId,
	});
}

export function validateOperonSettingsBackupTableBundleRestorePlanV1(
	plan: OperonSettingsBackupTableBundleRestorePlanV1,
): boolean {
	return plan.version === 1
		&& isSha256(plan.archiveSha256)
		&& validateSettingsPlan(plan.settingsPlan)
		&& validateTablePlan(plan.tablePlan)
		&& plan.tablePlan.archiveSha256 === plan.archiveSha256
		&& plan.tablePlan.sourceBodyChecksum === plan.settingsPlan.sourceBodyChecksum
		&& plan.planId === computeOperonSettingsBackupTableBundlePlanIdV1(plan);
}

export function createOperonSettingsBackupTableBundleAcknowledgementV1(
	plan: OperonSettingsBackupTableBundleRestorePlanV1,
): OperonSettingsBackupTableBundleApplyAcknowledgementV1 {
	return deepFreeze({
		version: 1 as const,
		planId: plan.planId,
		archiveSha256: plan.archiveSha256,
		settingsPlanId: plan.settingsPlan.planId,
		settingsSelectionFingerprint: plan.settingsPlan.selectionFingerprint,
		tablePlanId: plan.tablePlan.planId,
		tableDecisionFingerprint: plan.tablePlan.decisionFingerprint,
		acceptsNoCrashSafeRollback: true as const,
		acceptsConditionalSessionOnlyUndo: true as const,
	});
}

export function validateOperonSettingsBackupTableBundleAcknowledgementV1(
	plan: OperonSettingsBackupTableBundleRestorePlanV1,
	acknowledgement: OperonSettingsBackupTableBundleApplyAcknowledgementV1,
): OperonSettingsBackupTableBundleAcknowledgementValidationV1 {
	if (!validateOperonSettingsBackupTableBundleRestorePlanV1(plan)) {
		return { ok: false, reason: 'candidate-mismatch' };
	}
	if (acknowledgement.version !== 1
		|| acknowledgement.acceptsNoCrashSafeRollback !== true
		|| acknowledgement.acceptsConditionalSessionOnlyUndo !== true
		|| acknowledgement.planId !== plan.planId
		|| acknowledgement.archiveSha256 !== plan.archiveSha256
		|| acknowledgement.settingsPlanId !== plan.settingsPlan.planId
		|| acknowledgement.tablePlanId !== plan.tablePlan.planId) {
		return { ok: false, reason: 'acknowledgement-mismatch' };
	}
	if (acknowledgement.settingsSelectionFingerprint !== plan.settingsPlan.selectionFingerprint) {
		return { ok: false, reason: 'selection-mismatch' };
	}
	if (acknowledgement.tableDecisionFingerprint !== plan.tablePlan.decisionFingerprint) {
		return { ok: false, reason: 'selection-mismatch' };
	}
	return { ok: true, reason: null };
}

function validateSettingsPlan(plan: OperonSettingsBackupRestorePlanV1): boolean {
	return plan.version === 1
		&& isSha256(plan.sourceBodyChecksum)
		&& isSha256(plan.targetConfigurationFingerprint)
		&& isSha256(plan.selectionFingerprint)
		&& isSha256(plan.candidateFingerprint)
		&& isSha256(plan.planId)
		&& plan.selectionFingerprint === computeOperonSettingsBackupApplySelectionFingerprintV1(plan)
		&& plan.candidateFingerprint === computeOperonSettingsBackupSettingsFingerprintV1(plan.candidateSettings)
		&& plan.planId === computeOperonSettingsBackupApplyPlanIdV1(plan);
}

function validateTablePlan(plan: OperonSettingsBackupTableResourceRestorePlanV1): boolean {
	const { planId, ...material } = plan;
	return plan.version === 1
		&& isSha256(plan.archiveSha256)
		&& isSha256(plan.sourceBodyChecksum)
		&& isSha256(plan.targetFingerprint)
		&& isSha256(plan.decisionFingerprint)
		&& isSha256(planId)
		&& planId === computeOperonSettingsBackupTableResourcePlanIdV1(material);
}

function composition(
	classification: Exclude<OperonSettingsBackupTableBundleCompositionResultV1['classification'], 'ready'>,
	reason: OperonSettingsBackupTableBundleCompositionReasonV1,
): OperonSettingsBackupTableBundleCompositionResultV1 {
	return { classification, reason, plan: null };
}

function isSha256(value: string): boolean {
	return /^[a-f0-9]{64}$/u.test(value);
}

function fingerprint(value: unknown): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(value));
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
