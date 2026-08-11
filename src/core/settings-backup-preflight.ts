import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import type { JsonValue } from '../agent-runtime/contracts/v1/primitives';
import {
	CURRENT_SETTINGS_VERSION,
	migrateSettings,
	type OperonSettings,
} from '../types/settings';
import {
	applyDynamicFilterTemplatePreferences,
	isSpecialDynamicFilterSet,
} from './dynamic-file-task-filter';
import {
	SETTINGS_BACKUP_GROUPS,
	SETTINGS_BACKUP_GROUP_CODEC_VERSION,
	SETTINGS_BACKUP_VAULT_REFERENCE_KEYS,
	type SettingsBackupMergeStrategy,
	type SettingsBackupProfileGroupId,
	type SettingsBackupVaultReferenceKey,
} from './settings-backup-compatibility';
import { exportOperonSettingsBackupJsonV1 } from './settings-backup-export';
import {
	OPERON_SETTINGS_BACKUP_GROUP_NAMES,
	canonicalizeOperonSettingsBackupJson,
	classifyOperonSettingsBackupV1,
	parseOperonSettingsBackupV1,
	type OperonSettingsBackupCompatibilitySupport,
	type OperonSettingsBackupDiagnostic,
	type OperonSettingsBackupParseClassification,
} from './settings-backup-format';
import {
	validateOperonSettingsBackupGroupsV1,
	type OperonSettingsBackupGroupPayloadsV1,
} from './settings-backup-group-validation';

export type OperonSettingsBackupVaultReferenceStatusV1 = 'valid' | 'missing' | 'wrong-type' | 'unchecked';
export type OperonSettingsBackupVaultReferenceDecisionV1 = 'apply-source' | 'preserve-target';

export interface OperonSettingsBackupVaultReferenceCheckV1 {
	status: OperonSettingsBackupVaultReferenceStatusV1;
}

export interface OperonSettingsBackupPreflightTargetSnapshotV1 {
	settings: Readonly<OperonSettings>;
	dataPackageSchemaVersion: number;
	settingsVersion: number;
	canonicalWritesSuspended: boolean;
	canonicalWriteSuspensionReason: string | null;
}

export interface OperonSettingsBackupPreflightInputV1 {
	sourceJson: string;
	targetSnapshot: OperonSettingsBackupPreflightTargetSnapshotV1;
	selectedGroups?: readonly SettingsBackupProfileGroupId[];
	vaultReferenceChecks?: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>;
	vaultReferenceDecisions?: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>>;
}

export type OperonSettingsBackupPreflightIssueKindV1 =
	| 'group-invalid'
	| 'dependency-missing'
	| 'vault-reference'
	| 'vault-bound-preset'
	| 'provenance'
	| 'writes-suspended'
	| 'table-reference';

export interface OperonSettingsBackupPreflightIssueV1 {
	id: string;
	kind: OperonSettingsBackupPreflightIssueKindV1;
	severity: 'warning' | 'error';
	group: SettingsBackupProfileGroupId | null;
	path: string;
	message: string;
	resolved: boolean;
	resolution: OperonSettingsBackupVaultReferenceDecisionV1 | null;
}

export type OperonSettingsBackupPreflightGroupStatusV1 =
	| 'apply-ready'
	| 'not-included'
	| 'skipped-unsupported'
	| 'blocked-invalid'
	| 'blocked-dependency'
	| 'decision-required';

export interface OperonSettingsBackupPreflightDiffCountsV1 {
	added: number;
	removed: number;
	changed: number;
	unchanged: number;
	migrated: number;
	skipped: number;
	conflicts: number;
	unresolved: number;
}

export interface OperonSettingsBackupPreflightDiffEntryV1 {
	identity: string;
	change: 'added' | 'removed' | 'changed' | 'unchanged';
}

export interface OperonSettingsBackupPreflightGroupV1 {
	group: SettingsBackupProfileGroupId;
	status: OperonSettingsBackupPreflightGroupStatusV1;
	selected: boolean;
	defaultSelected: boolean;
	selectable: boolean;
	sensitive: boolean;
	mergeStrategy: SettingsBackupMergeStrategy;
	sourceCodecVersion: number | null;
	targetCodecVersion: number;
	dependencies: readonly SettingsBackupProfileGroupId[];
	counts: OperonSettingsBackupPreflightDiffCountsV1;
	diff: readonly OperonSettingsBackupPreflightDiffEntryV1[];
	issues: readonly string[];
}

export interface OperonSettingsBackupPreflightIdentityV1 {
	sourceBodyChecksum: string;
	targetConfigurationFingerprint: string;
	selectionFingerprint: string;
	candidateFingerprint: string | null;
	planId: string | null;
}

export interface OperonSettingsBackupPreflightSummaryV1 extends OperonSettingsBackupPreflightDiffCountsV1 {
	selectedGroups: number;
	appliedGroups: number;
	skippedGroups: number;
	blockedGroups: number;
	decisionGroups: number;
	tableReferencesMatched: number;
	tableReferencesUnmatched: number;
	vaultReferencesPending: number;
}

export interface OperonSettingsBackupPreflightPreviewV1 {
	compatibility: 'exact' | 'partial';
	identity: OperonSettingsBackupPreflightIdentityV1;
	groups: readonly OperonSettingsBackupPreflightGroupV1[];
	issues: readonly OperonSettingsBackupPreflightIssueV1[];
	summary: OperonSettingsBackupPreflightSummaryV1;
	canonicalWritesSuspended: boolean;
	sensitiveExternalCalendarsSelected: boolean;
}

export interface OperonSettingsBackupRestorePlanV1 {
	version: 1;
	planId: string;
	sourceBodyChecksum: string;
	targetConfigurationFingerprint: string;
	selectionFingerprint: string;
	candidateFingerprint: string;
	selectedGroups: readonly SettingsBackupProfileGroupId[];
	vaultReferenceDecisions: Readonly<Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>>>;
	vaultReferenceChecks: Readonly<Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>>;
	candidateSettings: Readonly<OperonSettings>;
}

export type OperonSettingsBackupPreflightResultV1 =
	| {
		ok: false;
		classification: Exclude<OperonSettingsBackupParseClassification, 'valid'>;
		preview: null;
		restorePlan: null;
		diagnostics: OperonSettingsBackupDiagnostic[];
	}
	| {
		ok: true;
		classification: 'ready' | 'decision-required' | 'blocked';
		preview: OperonSettingsBackupPreflightPreviewV1;
		restorePlan: OperonSettingsBackupRestorePlanV1 | null;
		diagnostics: OperonSettingsBackupDiagnostic[];
	};

export interface OperonSettingsBackupGroupMigrationV1 {
	group: SettingsBackupProfileGroupId;
	fromCodecVersion: number;
	toCodecVersion: number;
	migrate(data: JsonValue): JsonValue;
}

/** V1 starts with no invented legacy group layouts. */
export const OPERON_SETTINGS_BACKUP_GROUP_MIGRATIONS_V1: readonly OperonSettingsBackupGroupMigrationV1[] = Object.freeze([]);

const NESTED_VAULT_FILTER_FIELDS = new Set(['folders', 'projectTree', 'projectSerialScope']);

export function preflightOperonSettingsBackupRestoreV1(
	input: OperonSettingsBackupPreflightInputV1,
): OperonSettingsBackupPreflightResultV1 {
	return preflightWithMigrations(input, OPERON_SETTINGS_BACKUP_GROUP_MIGRATIONS_V1);
}

export function createOperonSettingsBackupPreflightV1(
	migrations: readonly OperonSettingsBackupGroupMigrationV1[],
): (input: OperonSettingsBackupPreflightInputV1) => OperonSettingsBackupPreflightResultV1 {
	const migrationRegistry = Object.freeze([...migrations]);
	return input => preflightWithMigrations(input, migrationRegistry);
}

function preflightWithMigrations(
	input: OperonSettingsBackupPreflightInputV1,
	migrations: readonly OperonSettingsBackupGroupMigrationV1[],
): OperonSettingsBackupPreflightResultV1 {
	const parsed = parseOperonSettingsBackupV1(input.sourceJson);
	if (!parsed.ok) {
		return {
			ok: false,
			classification: parsed.classification,
			preview: null,
			restorePlan: null,
			diagnostics: parsed.diagnostics,
		};
	}

	try {
		const backup = parsed.value;
		const targetSettings = cloneJson(input.targetSnapshot.settings);
		const compatibility = classifyOperonSettingsBackupV1(
			backup,
			currentCompatibilitySupport(input.targetSnapshot.dataPackageSchemaVersion, migrations),
		);
		const compatibilityDiagnostics = compatibility.diagnostics.map(diagnostic => ({
			...diagnostic,
			severity: 'warning' as const,
		}));
		const compatibilityByGroup = new Map(compatibility.groups.map(group => [group.group, group]));
		const selectedGroups = new Set<SettingsBackupProfileGroupId>();
		const groupsForValidation = {} as Partial<typeof backup.body.groups>;
		const preparedGroups = new Map<SettingsBackupProfileGroupId, NonNullable<typeof backup.body.groups[SettingsBackupProfileGroupId]>>();
		const migrationFailedGroups = new Set<SettingsBackupProfileGroupId>();
		for (const groupCompatibility of compatibility.groups) {
			const sourceGroup = backup.body.groups[groupCompatibility.group];
			if (!sourceGroup) continue;
			if (groupCompatibility.classification === 'exact') preparedGroups.set(groupCompatibility.group, sourceGroup);
			else if (groupCompatibility.classification === 'migration-required') {
				try {
					const migrated = migrateGroupToCurrent(groupCompatibility.group, sourceGroup, migrations);
					if (migrated) preparedGroups.set(groupCompatibility.group, migrated);
					else migrationFailedGroups.add(groupCompatibility.group);
				} catch {
					migrationFailedGroups.add(groupCompatibility.group);
				}
			}
		}
		const requestedGroups = normalizeSelection(input.selectedGroups, compatibilityByGroup, preparedGroups);

		for (const definition of SETTINGS_BACKUP_GROUPS) {
			const groupCompatibility = compatibilityByGroup.get(definition.id);
			if (
				requestedGroups.has(definition.id)
				&& (groupCompatibility?.classification === 'exact' || groupCompatibility?.classification === 'migration-required')
				&& preparedGroups.has(definition.id)
			) {
				selectedGroups.add(definition.id);
				Object.assign(groupsForValidation, { [definition.id]: preparedGroups.get(definition.id) });
			}
		}

		const validation = validateOperonSettingsBackupGroupsV1(groupsForValidation, {
			targetSettings,
			ignoreTableFavoriteReferences: true,
		});
		const sensitiveValues = collectSensitiveValues(backup, targetSettings);
		const issues: OperonSettingsBackupPreflightIssueV1[] = compatibilityDiagnostics.map((diagnostic, index) => ({
			id: `provenance-${index}`,
			kind: 'provenance',
			severity: diagnostic.severity,
			group: groupFromPath(diagnostic.path),
			path: diagnostic.path,
			message: maskSensitiveText(diagnostic.message, sensitiveValues),
			resolved: true,
			resolution: null,
		}));
		for (const groupCompatibility of compatibility.groups) {
			if (groupCompatibility.classification !== 'unsupported' && !migrationFailedGroups.has(groupCompatibility.group)) continue;
			const definition = SETTINGS_BACKUP_GROUPS.find(group => group.id === groupCompatibility.group);
			const requiresAcknowledgement = requestedGroups.has(groupCompatibility.group)
				|| (input.selectedGroups === undefined && definition?.defaultSelected === true);
			if (!requiresAcknowledgement) continue;
			const migrationFailed = migrationFailedGroups.has(groupCompatibility.group);
			issues.push({
				id: `${migrationFailed ? 'migration-failed' : 'unsupported-group-decision'}-${groupCompatibility.group}`,
				kind: 'group-invalid',
				severity: 'warning',
				group: groupCompatibility.group,
				path: `$.body.groups.${groupCompatibility.group}`,
				message: migrationFailed
					? `${groupCompatibility.group} migration failed and the group must be explicitly omitted before a partial restore plan can be created.`
					: `${groupCompatibility.group} is unsupported and must be explicitly omitted before a partial restore plan can be created.`,
				resolved: false,
				resolution: null,
			});
		}

		const invalidSelectedGroups = new Set<SettingsBackupProfileGroupId>();
		const dependencyBlockedGroups = new Set<SettingsBackupProfileGroupId>();
		for (const diagnostic of validation.diagnostics) {
			const group = groupFromPath(diagnostic.path);
			if (diagnostic.severity === 'error' && group) {
				if (isDependencyDiagnostic(diagnostic)) dependencyBlockedGroups.add(group);
				else invalidSelectedGroups.add(group);
			}
			issues.push(issueFromDiagnostic(diagnostic, sensitiveValues));
		}

		const vaultReferenceResult = applyVaultReferenceDecisions(
			validation.payloads.general,
			targetSettings,
			input.vaultReferenceChecks ?? {},
			input.vaultReferenceDecisions ?? {},
			selectedGroups.has('general'),
		);
		issues.push(...vaultReferenceResult.issues);

		const candidate = cloneJson(targetSettings);
		composeSelectedGroups(
			candidate,
			validation.payloads,
			selectedGroups,
			vaultReferenceResult.general,
			targetSettings,
		);

		if (selectedGroups.has('filters') && validation.payloads.filters) {
			for (const [index, filter] of validation.payloads.filters.filterSets.entries()) {
				if (!containsNestedVaultReference(filter)) continue;
				issues.push({
					id: `vault-bound-filter-${filter.id || index}`,
					kind: 'vault-bound-preset',
					severity: 'warning',
					group: 'filters',
					path: `$.body.groups.filters.data.filterSets[${index}]`,
					message: 'Filter contains vault-bound conditions and will be applied as one preset when the Filters group remains selected.',
					resolved: input.selectedGroups !== undefined && requestedGroups.has('filters'),
					resolution: null,
				});
			}
		}

		if (input.targetSnapshot.canonicalWritesSuspended) {
			issues.push({
				id: 'canonical-writes-suspended',
				kind: 'writes-suspended',
				severity: 'warning',
				group: null,
				path: '$.target.canonicalWritesSuspended',
				message: 'Canonical settings writes are suspended; preview remains read-only and apply must remain unavailable until recovery.',
				resolved: true,
				resolution: null,
			});
		}

		const normalizationChanged = stableJson(candidate) !== stableJson(migrateSettings(candidate));
		if (normalizationChanged) {
			issues.push({
				id: 'candidate-normalization-changed',
				kind: 'group-invalid',
				severity: 'error',
				group: null,
				path: '$.candidate',
				message: 'The composed candidate would be changed by current settings normalization.',
				resolved: false,
				resolution: null,
			});
		}

		const candidateValidation = exportOperonSettingsBackupJsonV1({
			settings: candidate,
			source: {
				pluginVersion: backup.body.source.pluginVersion,
				obsidianVersion: backup.body.source.obsidianVersion,
				dataPackageSchemaVersion: input.targetSnapshot.dataPackageSchemaVersion,
			},
			createdAt: backup.body.createdAt,
			includeExternalCalendarUrls: true,
			canonicalWritesSuspended: input.targetSnapshot.canonicalWritesSuspended,
		});
		if (!candidateValidation.ok) {
			for (const diagnostic of candidateValidation.diagnostics) {
				const group = groupFromPath(diagnostic.path);
				if (group) dependencyBlockedGroups.add(group);
				issues.push({
					...issueFromDiagnostic(diagnostic, sensitiveValues),
					kind: 'dependency-missing',
				});
			}
		}

		const tableReferenceSummary = summarizeTableReferences(
			validation.payloads['preset-favorites']?.presetFavorites.table ?? [],
			targetSettings,
		);
		if (tableReferenceSummary.unmatched > 0) {
			issues.push({
				id: 'table-references-unmatched',
				kind: 'table-reference',
				severity: 'warning',
				group: 'preset-favorites',
				path: '$.body.groups.preset-favorites.data.presetFavorites.table',
				message: `${tableReferenceSummary.unmatched} source Table reference(s) do not match the target Table registry and remain advisory.`,
				resolved: true,
				resolution: null,
			});
		}

		const targetFingerprint = fingerprint({
			settings: targetSettings,
			dataPackageSchemaVersion: input.targetSnapshot.dataPackageSchemaVersion,
			settingsVersion: input.targetSnapshot.settingsVersion,
		});
		const selectedGroupList = [...selectedGroups].sort();
		const selectionFingerprint = fingerprint({
			selectedGroups: selectedGroupList,
			vaultReferenceChecks: sortVaultReferenceChecks(input.vaultReferenceChecks ?? {}),
			vaultReferenceDecisions: sortVaultReferenceDecisions(input.vaultReferenceDecisions ?? {}),
		});
		const allExactGroups = {} as Partial<typeof backup.body.groups>;
		for (const groupCompatibility of compatibility.groups) {
			if (groupCompatibility.classification !== 'exact' && groupCompatibility.classification !== 'migration-required') continue;
			const sourceGroup = preparedGroups.get(groupCompatibility.group);
			if (sourceGroup) Object.assign(allExactGroups, { [groupCompatibility.group]: sourceGroup });
		}
		const allExactValidation = validateOperonSettingsBackupGroupsV1(allExactGroups, {
			targetSettings,
			ignoreTableFavoriteReferences: true,
		});
		const rows = buildGroupRows(
			targetSettings,
			candidate,
			allExactValidation.payloads,
			compatibilityByGroup,
			selectedGroups,
			invalidSelectedGroups,
			migrationFailedGroups,
			dependencyBlockedGroups,
			preparedGroups,
			issues,
		);
		const unresolvedDecisions = issues.some(issue => issue.severity === 'warning' && !issue.resolved);
		const blockingErrors = issues.some(issue => issue.severity === 'error' && !issue.resolved)
			|| invalidSelectedGroups.size > 0
			|| dependencyBlockedGroups.size > 0
			|| normalizationChanged
			|| input.targetSnapshot.canonicalWritesSuspended;
		const classification: 'ready' | 'decision-required' | 'blocked' = blockingErrors
			? 'blocked'
			: unresolvedDecisions
				? 'decision-required'
				: 'ready';
		const compatibilityGrade = compatibility.groups.some(group => group.classification === 'unsupported')
			|| migrationFailedGroups.size > 0
			? 'partial' as const
			: 'exact' as const;
		const candidateFingerprint = classification === 'ready' ? fingerprint(candidate) : null;
		const planId = candidateFingerprint
			? fingerprint({
				sourceBodyChecksum: backup.integrity.value,
				targetFingerprint,
				selectionFingerprint,
				candidateFingerprint,
			})
			: null;
		const identity: OperonSettingsBackupPreflightIdentityV1 = {
			sourceBodyChecksum: backup.integrity.value,
			targetConfigurationFingerprint: targetFingerprint,
			selectionFingerprint,
			candidateFingerprint,
			planId,
		};
		const summary = summarizeRows(rows, tableReferenceSummary, issues);
		const preview: OperonSettingsBackupPreflightPreviewV1 = deepFreeze({
			compatibility: compatibilityGrade,
			identity,
			groups: rows,
			issues,
			summary,
			canonicalWritesSuspended: input.targetSnapshot.canonicalWritesSuspended,
			sensitiveExternalCalendarsSelected: selectedGroups.has('external-calendars'),
		});
		const restorePlan: OperonSettingsBackupRestorePlanV1 | null = classification === 'ready' && planId && candidateFingerprint
			? deepFreeze({
				version: 1 as const,
				planId,
				sourceBodyChecksum: backup.integrity.value,
				targetConfigurationFingerprint: targetFingerprint,
				selectionFingerprint,
				candidateFingerprint,
				selectedGroups: selectedGroupList,
				vaultReferenceChecks: sortVaultReferenceChecks(input.vaultReferenceChecks ?? {}),
				vaultReferenceDecisions: sortVaultReferenceDecisions(input.vaultReferenceDecisions ?? {}),
				candidateSettings: cloneJson(candidate),
			})
			: null;

		return {
			ok: true,
			classification,
			preview,
			restorePlan,
			diagnostics: compatibilityDiagnostics,
		};
	} catch {
		return {
			ok: false,
			classification: 'invalid',
			preview: null,
			restorePlan: null,
			diagnostics: [{
				path: '$',
				code: 'value',
				severity: 'error',
				message: 'Settings backup preflight failed validation.',
			}],
		};
	}
}

function currentCompatibilitySupport(
	dataPackageSchemaVersion: number,
	migrations: readonly OperonSettingsBackupGroupMigrationV1[],
): OperonSettingsBackupCompatibilitySupport {
	return {
		dataPackageSchemaVersions: [dataPackageSchemaVersion],
		currentSettingsVersion: CURRENT_SETTINGS_VERSION,
		minimumSettingsVersion: CURRENT_SETTINGS_VERSION,
		groupCodecVersions: Object.fromEntries(
			OPERON_SETTINGS_BACKUP_GROUP_NAMES.map(group => [group, SETTINGS_BACKUP_GROUP_CODEC_VERSION]),
		) as OperonSettingsBackupCompatibilitySupport['groupCodecVersions'],
		groupMigrationSourceCodecVersions: Object.fromEntries(
			OPERON_SETTINGS_BACKUP_GROUP_NAMES.map(group => [
				group,
				[...new Set(migrations
					.filter(migration => migration.group === group)
					.map(migration => migration.fromCodecVersion))],
			]),
		),
	};
}

function migrateGroupToCurrent(
	group: SettingsBackupProfileGroupId,
	source: { codecVersion: number; data: JsonValue },
	migrations: readonly OperonSettingsBackupGroupMigrationV1[],
): { codecVersion: number; data: JsonValue } | null {
	let codecVersion = source.codecVersion;
	let data = cloneJson(source.data);
	const visited = new Set<number>();
	while (codecVersion !== SETTINGS_BACKUP_GROUP_CODEC_VERSION) {
		if (visited.has(codecVersion)) return null;
		visited.add(codecVersion);
		const migration = migrations
			.filter(item => item.group === group && item.fromCodecVersion === codecVersion)
			.sort((left, right) => left.toCodecVersion - right.toCodecVersion)[0];
		if (!migration || migration.toCodecVersion <= codecVersion) return null;
		data = migration.migrate(data);
		codecVersion = migration.toCodecVersion;
	}
	return { codecVersion, data };
}

function normalizeSelection(
	selection: readonly SettingsBackupProfileGroupId[] | undefined,
	compatibility: ReadonlyMap<SettingsBackupProfileGroupId, { classification: string }>,
	preparedGroups: ReadonlyMap<SettingsBackupProfileGroupId, unknown>,
): Set<SettingsBackupProfileGroupId> {
	if (selection) {
		const knownGroups = new Set(OPERON_SETTINGS_BACKUP_GROUP_NAMES);
		return new Set(selection.filter(group => knownGroups.has(group)));
	}
	return new Set(SETTINGS_BACKUP_GROUPS.filter(definition => (
		definition.defaultSelected
		&& preparedGroups.has(definition.id)
		&& (compatibility.get(definition.id)?.classification === 'exact'
			|| compatibility.get(definition.id)?.classification === 'migration-required')
	)).map(definition => definition.id));
}

function applyVaultReferenceDecisions(
	general: OperonSettingsBackupGroupPayloadsV1['general'] | undefined,
	target: OperonSettings,
	checks: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>,
	decisions: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>>,
	selected: boolean,
): { general: OperonSettingsBackupGroupPayloadsV1['general'] | undefined; issues: OperonSettingsBackupPreflightIssueV1[] } {
	if (!general || !selected) return { general, issues: [] };
	const next = cloneJson(general);
	const issues: OperonSettingsBackupPreflightIssueV1[] = [];
	for (const key of SETTINGS_BACKUP_VAULT_REFERENCE_KEYS) {
		if (!(key in next) || stableJson(next[key]) === stableJson(target[key])) continue;
		const status = checks[key]?.status ?? 'unchecked';
		const decision = decisions[key] ?? null;
		if (decision === 'preserve-target') Object.assign(next, { [key]: cloneJson(target[key]) });
		issues.push({
			id: `vault-reference-${key}`,
			kind: 'vault-reference',
			severity: 'warning',
			group: 'general',
			path: `$.body.groups.general.data.${key}`,
			message: `${key} is ${status} in the target vault and requires an explicit field-level decision.`,
			resolved: decision !== null,
			resolution: decision,
		});
	}
	return { general: next, issues };
}

function composeSelectedGroups(
	candidate: OperonSettings,
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	selected: ReadonlySet<SettingsBackupProfileGroupId>,
	general: OperonSettingsBackupGroupPayloadsV1['general'] | undefined,
	target: OperonSettings,
): void {
	if (selected.has('general') && general) Object.assign(candidate, cloneJson(general));
	if (selected.has('pipelines') && payloads.pipelines) {
		candidate.pipelines = cloneJson(payloads.pipelines.pipelines);
		candidate.defaultPipelineName = payloads.pipelines.defaultPipelineName;
	}
	if (selected.has('priorities') && payloads.priorities) {
		candidate.priorities = cloneJson(payloads.priorities.priorities);
		candidate.defaultPriority = payloads.priorities.defaultPriority;
	}
	if (selected.has('system-key-mappings') && payloads['system-key-mappings']) {
		const overrides = new Map(payloads['system-key-mappings'].overrides.map(item => [item.canonicalKey, item]));
		candidate.keyMappings = candidate.keyMappings.map(mapping => mapping.isSystem === false
			? mapping
			: { ...mapping, ...(overrides.get(mapping.canonicalKey) ?? {}) });
	}
	if (selected.has('custom-keys') && payloads['custom-keys']) {
		candidate.keyMappings = [
			...candidate.keyMappings.filter(mapping => mapping.isSystem !== false),
			...cloneJson(payloads['custom-keys'].customKeys),
		];
	}
	if (selected.has('filters') && payloads.filters) {
		const normalFilterSets = cloneJson(payloads.filters.filterSets);
		candidate.filterSets = payloads.filters.dynamicTemplates
			? applyDynamicFilterTemplatePreferences(normalFilterSets, cloneJson(payloads.filters.dynamicTemplates))
			: [
				...normalFilterSets,
				...cloneJson(target.filterSets.filter(isSpecialDynamicFilterSet)),
			];
	}
	if (selected.has('calendar') && payloads.calendar) {
		const targetVisibility = new Map(target.calendarPresets.map(preset => [preset.id, preset.externalCalendarVisibility]));
		candidate.calendarPresets = cloneJson(payloads.calendar.calendarPresets).map(preset => ({
			...preset,
			externalCalendarVisibility: selected.has('external-calendars')
				? preset.externalCalendarVisibility
				: cloneJson(targetVisibility.get(preset.id) ?? {}),
		}));
		candidate.calendarDefaultPresetId = payloads.calendar.calendarDefaultPresetId;
		candidate.calendarMobileDefaultSourcePresetId = payloads.calendar.calendarMobileDefaultSourcePresetId;
		candidate.calendarMobileAgendaSourcePresetId = payloads.calendar.calendarMobileAgendaSourcePresetId;
		candidate.calendarMobileDaySourcePresetId = payloads.calendar.calendarMobileDaySourcePresetId;
		candidate.calendarMobileTwoDaySourcePresetId = payloads.calendar.calendarMobileTwoDaySourcePresetId;
		candidate.calendarMobileThreeDaySourcePresetId = payloads.calendar.calendarMobileThreeDaySourcePresetId;
	}
	if (selected.has('kanban') && payloads.kanban) {
		candidate.kanbanPresets = cloneJson(payloads.kanban.kanbanPresets);
		candidate.kanbanDefaultPresetId = payloads.kanban.kanbanDefaultPresetId;
	}
	if (selected.has('preset-favorites') && payloads['preset-favorites']) {
		candidate.presetFavorites = {
			...cloneJson(payloads['preset-favorites'].presetFavorites),
			table: [...target.presetFavorites.table],
		};
	}
	if (selected.has('table-global') && payloads['table-global']) Object.assign(candidate, cloneJson(payloads['table-global']));
	if (selected.has('external-calendars') && payloads['external-calendars']) {
		candidate.externalCalendars = cloneJson(payloads['external-calendars'].externalCalendars);
	}
}

function buildGroupRows(
	target: OperonSettings,
	candidate: OperonSettings,
	previewPayloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	compatibility: ReadonlyMap<SettingsBackupProfileGroupId, { classification: string; sourceCodecVersion: number | null; supportedCodecVersion: number }>,
	selected: ReadonlySet<SettingsBackupProfileGroupId>,
	invalid: ReadonlySet<SettingsBackupProfileGroupId>,
	migrationFailed: ReadonlySet<SettingsBackupProfileGroupId>,
	dependencyBlocked: ReadonlySet<SettingsBackupProfileGroupId>,
	preparedGroups: ReadonlyMap<SettingsBackupProfileGroupId, unknown>,
	issues: readonly OperonSettingsBackupPreflightIssueV1[],
): OperonSettingsBackupPreflightGroupV1[] {
	return SETTINGS_BACKUP_GROUPS.map(definition => {
		const groupCompatibility = compatibility.get(definition.id);
		const groupIssues = issues.filter(issue => issue.group === definition.id);
		let status: OperonSettingsBackupPreflightGroupStatusV1 = 'apply-ready';
		if (groupCompatibility?.classification === 'not-included') status = 'not-included';
		else if (groupCompatibility?.classification === 'unsupported') status = definition.id === 'general'
			|| definition.id === 'pipelines'
			|| definition.id === 'priorities'
			|| definition.id === 'system-key-mappings'
			|| definition.id === 'custom-keys'
			? 'blocked-invalid'
			: 'skipped-unsupported';
		else if (invalid.has(definition.id) || migrationFailed.has(definition.id)) status = 'blocked-invalid';
		else if (dependencyBlocked.has(definition.id)) status = 'blocked-dependency';
		else if (groupIssues.some(issue => !issue.resolved)) status = 'decision-required';
		const previewCandidate = selected.has(definition.id)
			? candidate
			: buildSingleGroupPreviewCandidate(target, previewPayloads, definition.id);
		const diff = diffGroup(target, previewCandidate, definition.id);
		const counts = countDiff(
			diff,
			status,
			groupIssues,
			selected.has(definition.id),
				groupCompatibility?.classification === 'migration-required'
					&& preparedGroups.has(definition.id)
					&& selected.has(definition.id),
		);
		return {
			group: definition.id,
			status,
			selected: selected.has(definition.id),
			defaultSelected: definition.defaultSelected,
			selectable: preparedGroups.has(definition.id)
				&& (groupCompatibility?.classification === 'exact' || groupCompatibility?.classification === 'migration-required'),
			sensitive: definition.id === 'external-calendars',
			mergeStrategy: definition.mergeStrategy,
			sourceCodecVersion: groupCompatibility?.sourceCodecVersion ?? null,
			targetCodecVersion: groupCompatibility?.supportedCodecVersion ?? SETTINGS_BACKUP_GROUP_CODEC_VERSION,
			dependencies: definition.dependencies,
			counts,
			diff,
			issues: groupIssues.map(issue => issue.id),
		};
	});
}

function diffGroup(
	target: OperonSettings,
	candidate: OperonSettings,
	group: SettingsBackupProfileGroupId,
): OperonSettingsBackupPreflightDiffEntryV1[] {
	const before = groupItems(target, group);
	const after = groupItems(candidate, group);
	const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
	return keys.map(identity => {
		const hasBefore = before.has(identity);
		const hasAfter = after.has(identity);
		const change = !hasBefore ? 'added' : !hasAfter ? 'removed' : before.get(identity) === after.get(identity) ? 'unchanged' : 'changed';
		return { identity: safeIdentity(group, identity), change };
	});
}

function groupItems(settings: OperonSettings, group: SettingsBackupProfileGroupId): Map<string, string> {
	const map = new Map<string, string>();
	const add = (id: string, value: unknown): void => { map.set(id, stableJson(value)); };
	const definition = SETTINGS_BACKUP_GROUPS.find(item => item.id === group);
	if (group === 'general' || group === 'table-global') {
		for (const key of definition?.settingKeys ?? []) add(String(key), settings[key]);
		return map;
	}
	if (group === 'pipelines') {
		settings.pipelines.forEach(item => add(item.id, item));
		add('$default', settings.defaultPipelineName);
		add('$order', settings.pipelines.map(item => item.id));
	} else if (group === 'priorities') {
		settings.priorities.forEach(item => add(item.id, item));
		add('$default', settings.defaultPriority);
		add('$order', settings.priorities.map(item => item.id));
	} else if (group === 'system-key-mappings') {
		settings.keyMappings.filter(item => item.isSystem !== false).forEach(item => add(item.canonicalKey, {
			visiblePropertyName: item.visiblePropertyName,
			hideInFileTaskView: item.hideInFileTaskView,
			icon: item.icon,
		}));
	} else if (group === 'custom-keys') {
		const items = settings.keyMappings.filter(item => item.isSystem === false);
		items.forEach(item => add(item.canonicalKey, item));
		add('$order', items.map(item => item.canonicalKey));
	} else if (group === 'filters') {
		settings.filterSets.forEach(item => add(item.id, item));
		add('$order', settings.filterSets.map(item => item.id));
	} else if (group === 'calendar') {
		settings.calendarPresets.forEach(item => add(item.id, item));
		add('$defaults', {
			default: settings.calendarDefaultPresetId,
			mobile: [settings.calendarMobileDefaultSourcePresetId, settings.calendarMobileAgendaSourcePresetId,
				settings.calendarMobileDaySourcePresetId, settings.calendarMobileTwoDaySourcePresetId,
				settings.calendarMobileThreeDaySourcePresetId],
		});
		add('$order', settings.calendarPresets.map(item => item.id));
	} else if (group === 'kanban') {
		settings.kanbanPresets.forEach(item => add(item.id, item));
		add('$default', settings.kanbanDefaultPresetId);
		add('$order', settings.kanbanPresets.map(item => item.id));
	} else if (group === 'preset-favorites') {
		for (const surface of ['table', 'calendar', 'kanban', 'filter'] as const) {
			settings.presetFavorites[surface].forEach(id => add(`${surface}:${id}`, true));
		}
	} else if (group === 'external-calendars') {
		settings.externalCalendars.forEach((item, index) => add(item.id || `source-${index + 1}`, item));
		add('$order', settings.externalCalendars.map(item => item.id));
	}
	return map;
}

function countDiff(
	diff: readonly OperonSettingsBackupPreflightDiffEntryV1[],
	status: OperonSettingsBackupPreflightGroupStatusV1,
	issues: readonly OperonSettingsBackupPreflightIssueV1[],
	selected: boolean,
	migrated: boolean,
): OperonSettingsBackupPreflightDiffCountsV1 {
	const count = (change: OperonSettingsBackupPreflightDiffEntryV1['change']): number => diff.filter(item => item.change === change).length;
	return {
		added: count('added'),
		removed: count('removed'),
		changed: count('changed'),
		unchanged: count('unchanged'),
		migrated: migrated ? 1 : 0,
		skipped: selected ? 0 : diff.filter(item => item.change !== 'unchanged').length,
		conflicts: issues.filter(issue => issue.severity === 'error').length,
		unresolved: issues.filter(issue => !issue.resolved).length,
	};
}

function buildSingleGroupPreviewCandidate(
	target: OperonSettings,
	payloads: Partial<OperonSettingsBackupGroupPayloadsV1>,
	group: SettingsBackupProfileGroupId,
): OperonSettings {
	const candidate = cloneJson(target);
	composeSelectedGroups(
		candidate,
		payloads,
		new Set([group]),
		payloads.general,
		target,
	);
	return candidate;
}

function summarizeRows(
	rows: readonly OperonSettingsBackupPreflightGroupV1[],
	tables: { matched: number; unmatched: number },
	issues: readonly OperonSettingsBackupPreflightIssueV1[],
): OperonSettingsBackupPreflightSummaryV1 {
	const sum = (key: keyof OperonSettingsBackupPreflightDiffCountsV1): number => rows.reduce((total, row) => total + row.counts[key], 0);
	return {
		added: sum('added'),
		removed: sum('removed'),
		changed: sum('changed'),
		unchanged: sum('unchanged'),
		migrated: sum('migrated'),
		skipped: sum('skipped'),
		conflicts: sum('conflicts'),
		unresolved: sum('unresolved'),
		selectedGroups: rows.filter(row => row.selected).length,
		appliedGroups: rows.filter(row => row.selected && row.status === 'apply-ready').length,
		skippedGroups: rows.filter(row =>
			row.status === 'not-included'
			|| row.status === 'skipped-unsupported'
			|| (!row.selected && row.counts.skipped > 0)
		).length,
		blockedGroups: rows.filter(row => row.status === 'blocked-invalid' || row.status === 'blocked-dependency').length,
		decisionGroups: rows.filter(row => row.status === 'decision-required').length,
		tableReferencesMatched: tables.matched,
		tableReferencesUnmatched: tables.unmatched,
		vaultReferencesPending: issues.filter(issue => issue.kind === 'vault-reference' && !issue.resolved).length,
	};
}

function summarizeTableReferences(
	favoriteIds: readonly string[],
	target: OperonSettings,
): { matched: number; unmatched: number } {
	const targetIds = new Set(target.tablePresetOrderIds);
	const sourceIds = new Set(favoriteIds);
	let matched = 0;
	let unmatched = 0;
	for (const id of sourceIds) targetIds.has(id) ? matched += 1 : unmatched += 1;
	return { matched, unmatched };
}

function containsNestedVaultReference(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsNestedVaultReference);
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (typeof record.field === 'string' && NESTED_VAULT_FILTER_FIELDS.has(record.field)) return true;
	return Object.values(record).some(containsNestedVaultReference);
}

function issueFromDiagnostic(
	diagnostic: OperonSettingsBackupDiagnostic,
	sensitiveValues: readonly string[],
): OperonSettingsBackupPreflightIssueV1 {
	return {
		id: `diagnostic-${sha256HexV1(`${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`).slice(0, 16)}`,
		kind: diagnostic.code === 'required' || diagnostic.code === 'value' ? 'dependency-missing' : 'group-invalid',
		severity: diagnostic.severity,
		group: groupFromPath(diagnostic.path),
		path: diagnostic.path,
		message: maskSensitiveText(diagnostic.message, sensitiveValues),
		resolved: diagnostic.severity !== 'error',
		resolution: null,
	};
}

function isDependencyDiagnostic(diagnostic: OperonSettingsBackupDiagnostic): boolean {
	return (diagnostic.code === 'required' || diagnostic.code === 'value')
		&& /(?:reference|requires|missing)/iu.test(diagnostic.message);
}

function groupFromPath(path: string): SettingsBackupProfileGroupId | null {
	const match = /^\$\.body\.groups\.([^.[]+)/u.exec(path);
	return match && OPERON_SETTINGS_BACKUP_GROUP_NAMES.includes(match[1] as SettingsBackupProfileGroupId)
		? match[1] as SettingsBackupProfileGroupId
		: null;
}

function collectSensitiveValues(
	backup: { body: { groups: Partial<Record<SettingsBackupProfileGroupId, { data: JsonValue }>> } },
	target: OperonSettings,
): string[] {
	const values = new Set(target.externalCalendars.flatMap(source => [source.id, source.url]).filter(Boolean));
	const external = backup.body.groups['external-calendars']?.data;
	if (external && typeof external === 'object' && !Array.isArray(external)) {
		const sources = (external as Record<string, unknown>).externalCalendars;
		if (Array.isArray(sources)) {
			for (const source of sources) {
				if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
				for (const key of ['id', 'url']) {
					const value = (source as Record<string, unknown>)[key];
					if (typeof value === 'string' && value) values.add(value);
				}
			}
		}
	}
	return [...values].sort((left, right) => right.length - left.length);
}

function maskSensitiveText(value: string, sensitiveValues: readonly string[]): string {
	let masked = value;
	for (const sensitive of sensitiveValues) masked = masked.split(sensitive).join('[masked]');
	return masked.replace(/(?:https?|webcal):\/\/\S+/giu, '[masked-url]');
}

function safeIdentity(group: SettingsBackupProfileGroupId, identity: string): string {
	if (group !== 'external-calendars') return identity;
	if (identity.startsWith('$')) return identity;
	return '[masked-external-calendar]';
}

function fingerprint(value: unknown): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(cloneJson(value)));
}

function stableJson(value: unknown): string {
	return canonicalizeOperonSettingsBackupJson(cloneJson(value));
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function sortVaultReferenceDecisions(
	value: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>>,
): Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceDecisionV1>> {
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function sortVaultReferenceChecks(
	value: Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>>,
): Partial<Record<SettingsBackupVaultReferenceKey, OperonSettingsBackupVaultReferenceCheckV1>> {
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return value;
}
