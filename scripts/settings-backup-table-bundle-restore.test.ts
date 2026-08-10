import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeOperonSettingsBackupApplyPlanIdV1,
	computeOperonSettingsBackupApplySelectionFingerprintV1,
	computeOperonSettingsBackupSettingsFingerprintV1,
} from '../src/core/settings-backup-apply';
import {
	composeOperonSettingsBackupTableBundleRestorePlanV1,
	createOperonSettingsBackupTableBundleAcknowledgementV1,
	validateOperonSettingsBackupTableBundleAcknowledgementV1,
	validateOperonSettingsBackupTableBundleRestorePlanV1,
} from '../src/core/settings-backup-table-bundle-restore';
import type {
	OperonSettingsBackupPreflightResultV1,
	OperonSettingsBackupRestorePlanV1,
} from '../src/core/settings-backup-preflight';
import {
	computeOperonSettingsBackupTableResourcePlanIdV1,
	type OperonSettingsBackupTableResourcePreflightResultV1,
	type OperonSettingsBackupTableResourceRestorePlanV1,
} from '../src/core/settings-backup-table-resource-preflight';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const ARCHIVE_SHA = 'a'.repeat(64);
const SOURCE_SHA = 'b'.repeat(64);

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function settingsPlan(targetFingerprint = 'c'.repeat(64)): OperonSettingsBackupRestorePlanV1 {
	const candidateSettings = clone(DEFAULT_SETTINGS);
	const material = {
		version: 1 as const,
		sourceBodyChecksum: SOURCE_SHA,
		targetConfigurationFingerprint: targetFingerprint,
		selectionFingerprint: '',
		candidateFingerprint: computeOperonSettingsBackupSettingsFingerprintV1(candidateSettings),
		selectedGroups: [],
		vaultReferenceDecisions: {},
		vaultReferenceChecks: {},
		candidateSettings,
	};
	material.selectionFingerprint = computeOperonSettingsBackupApplySelectionFingerprintV1(material);
	return { ...material, planId: computeOperonSettingsBackupApplyPlanIdV1(material) };
}

function tablePlan(input: {
	archiveSha256?: string;
	sourceBodyChecksum?: string;
	decisionFingerprint?: string;
} = {}): OperonSettingsBackupTableResourceRestorePlanV1 {
	const material = {
		version: 1 as const,
		archiveSha256: input.archiveSha256 ?? ARCHIVE_SHA,
		sourceBodyChecksum: input.sourceBodyChecksum ?? SOURCE_SHA,
		targetFingerprint: 'e'.repeat(64),
		decisionFingerprint: input.decisionFingerprint ?? 'd'.repeat(64),
		actions: [],
		projection: {
			tablePresetFileBindings: [],
			tablePresetOrderIds: [],
			tableDefaultPresetId: null,
			tablePresetFileInitialized: false,
			tableFavoriteIds: [],
		},
	};
	return { ...material, planId: computeOperonSettingsBackupTableResourcePlanIdV1(material) };
}

function settingsResult(
	classification: 'ready' | 'decision-required' | 'blocked',
	plan: OperonSettingsBackupRestorePlanV1 | null,
): OperonSettingsBackupPreflightResultV1 {
	return {
		ok: true,
		classification,
		preview: {} as OperonSettingsBackupPreflightResultV1 extends { preview: infer T } ? T : never,
		restorePlan: plan,
		diagnostics: [],
	} as OperonSettingsBackupPreflightResultV1;
}

function tableResult(
	classification: OperonSettingsBackupTableResourcePreflightResultV1['classification'],
	plan: OperonSettingsBackupTableResourceRestorePlanV1 | null,
): OperonSettingsBackupTableResourcePreflightResultV1 {
	return { classification, conflicts: [], actions: [], plan };
}

function readyComposition(
	settings = settingsPlan(),
	table = tablePlan(),
) {
	return composeOperonSettingsBackupTableBundleRestorePlanV1({
		archiveSha256: ARCHIVE_SHA,
		settingsPreflight: settingsResult('ready', settings),
		tablePreflight: tableResult('ready', table),
	});
}

test('composes one deterministic immutable plan from both independently sealed plans', () => {
	const first = readyComposition();
	const second = readyComposition();
	assert.equal(first.classification, 'ready');
	assert.ok(first.plan);
	assert.equal(first.plan.planId, second.plan?.planId);
	assert.equal(validateOperonSettingsBackupTableBundleRestorePlanV1(first.plan), true);
	assert.equal(Object.isFrozen(first.plan), true);
	assert.equal(Object.isFrozen(first.plan.settingsPlan), true);
});

test('composition propagates unresolved and canceled user decisions without producing a plan', () => {
	const settingsPending = composeOperonSettingsBackupTableBundleRestorePlanV1({
		archiveSha256: ARCHIVE_SHA,
		settingsPreflight: settingsResult('decision-required', null),
		tablePreflight: tableResult('ready', tablePlan()),
	});
	assert.deepEqual(settingsPending, {
		classification: 'decision-required', reason: 'settings-decision-required', plan: null,
	});
	const tablePending = composeOperonSettingsBackupTableBundleRestorePlanV1({
		archiveSha256: ARCHIVE_SHA,
		settingsPreflight: settingsResult('ready', settingsPlan()),
		tablePreflight: tableResult('decision-required', null),
	});
	assert.equal(tablePending.classification, 'decision-required');
	const canceled = composeOperonSettingsBackupTableBundleRestorePlanV1({
		archiveSha256: ARCHIVE_SHA,
		settingsPreflight: settingsResult('ready', settingsPlan()),
		tablePreflight: tableResult('canceled', null),
	});
	assert.equal(canceled.classification, 'canceled');
});

test('composition rejects mismatched archive, source and corrupt sub-plan seals', () => {
	const wrongArchive = tablePlan({ archiveSha256: 'f'.repeat(64) });
	const archiveResult = readyComposition(settingsPlan(), wrongArchive);
	assert.equal(archiveResult.reason, 'archive-mismatch');

	const wrongSource = tablePlan({ sourceBodyChecksum: '1'.repeat(64) });
	const sourceResult = readyComposition(settingsPlan(), wrongSource);
	assert.equal(sourceResult.reason, 'source-mismatch');

	const corruptSettings = settingsPlan();
	corruptSettings.selectedGroups = ['general'];
	assert.equal(readyComposition(corruptSettings).reason, 'settings-plan-invalid');
});

test('acknowledgement binds rollback warnings plus both selection and conflict decisions', () => {
	const composed = readyComposition();
	assert.ok(composed.plan);
	const acknowledgement = createOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan);
	assert.deepEqual(validateOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan, acknowledgement), {
		ok: true, reason: null,
	});
	assert.equal(Object.isFrozen(acknowledgement), true);

	assert.equal(validateOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan, {
		...acknowledgement,
		settingsSelectionFingerprint: '0'.repeat(64),
	}).reason, 'selection-mismatch');
	assert.equal(validateOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan, {
		...acknowledgement,
		tableDecisionFingerprint: '0'.repeat(64),
	}).reason, 'selection-mismatch');
	assert.equal(validateOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan, {
		...acknowledgement,
		acceptsConditionalSessionOnlyUndo: false as never,
	}).reason, 'acknowledgement-mismatch');
});

test('swapping either approved sub-plan invalidates the composite plan and acknowledgement', () => {
	const composed = readyComposition();
	assert.ok(composed.plan);
	const acknowledgement = createOperonSettingsBackupTableBundleAcknowledgementV1(composed.plan);
	const swapped = { ...composed.plan, settingsPlan: settingsPlan('9'.repeat(64)) };
	assert.equal(validateOperonSettingsBackupTableBundleRestorePlanV1(swapped), false);
	assert.equal(
		validateOperonSettingsBackupTableBundleAcknowledgementV1(swapped, acknowledgement).ok,
		false,
	);
});
