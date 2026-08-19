import type { DataAdapter } from 'obsidian';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	hasPinnedTasksPackage,
	hasRetiredOperonDataPackageSettings,
	isStructurallyCompleteOperonDataPackageV1,
	isUnsupportedTablePresetPackage,
	mergeOperonDataPackage,
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
	OPERON_TASK_CREATION_PROFILE_PACKAGE_VERSION,
	type OperonDataPackageV1,
} from './operon-data-package';
import type { OperonStoragePaths } from './operon-storage-paths';
import { preserveInvalidJsonFile, writeTextSafely } from './storage-file-ops';
import {
	FILE_TASK_ARCHIVE_DELAY_SECONDS,
	FILE_TASK_ARCHIVE_ROUTING_SETTINGS_VERSION,
	migrateLegacyLanguageSettings,
	preserveCanonicalLanguageForLegacyReload,
	type OperonSettings,
} from '../types/settings';
import {
	validatePipelineTaxonomy,
	type PipelineTaxonomyIssue,
} from '../core/pipeline-taxonomy-validation';
import {
	isUnsupportedDeveloperApiGrantPackage,
	normalizeDeveloperApiGrantPackage,
} from '../agent-runtime/developer-api/grants';
import { sha256HexForStorage } from './storage-sha256';
import {
	buildRetiredLegacyTablePresetDataPackageV1,
	buildRecoveredTablePresetDataPackageV1,
	overlayKnownDataPackageFieldsPreservingUnknownV1,
	preflightLegacyTablePresetSidecarRetirementV1,
	preflightTablePresetManifestRecoveryV1,
	type TablePresetLegacySidecarEvidenceV1,
	type TablePresetLegacySidecarRetirementBlockCode,
	type TablePresetLegacySidecarRetirementPreflight,
	type TablePresetManifestRecoveryFileEvidence,
} from './table-preset-manifest-recovery';

export interface OperonPluginDataAccess {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface OperonDataPackageStoreInitResult {
	dataPackage: OperonDataPackageV1;
	unsupportedTablePresetPackage: boolean;
	tablePresetRecovery: OperonTablePresetRecoveryDiagnostics;
	loadedExistingPinnedTasksPackage: boolean;
	pipelineTaxonomyDiagnostics: OperonPipelineTaxonomyDiagnostics;
}

export type OperonTablePresetRecoveryStatus =
	| 'not-needed'
	| 'recovered'
	| 'blocked'
	| 'failed-clean'
	| 'commit-state-unknown';

export interface OperonTablePresetRecoveryDiagnostics {
	status: OperonTablePresetRecoveryStatus;
	code: TablePresetLegacySidecarRetirementBlockCode | 'backup-failed' | 'marker-invalid' | 'marker-write-failed'
		| 'marker-finalization-failed' | 'canonical-read-drift' | 'canonical-write-failed' | 'canonical-state-unknown' | null;
	backupPath: string | null;
	strategy: 'retire-legacy-sidecar-authority' | null;
	/** True only when this startup completed the legacy-authority retirement. */
	completedLegacySidecarRetirementThisStartup: boolean;
}

export type OperonTablePresetRecoveryDiscovery = () => Promise<TablePresetManifestRecoveryFileEvidence[]>;

export interface OperonCommittedSettingsDataPackageSnapshot {
	settings: OperonSettings;
	dataPackageSchemaVersion: OperonDataPackageV1['schemaVersion'];
}

export interface OperonPipelineTaxonomyDiagnostics {
	issues: PipelineTaxonomyIssue[];
	hasDestructiveIssues: boolean;
	hasIdentityIssues: boolean;
	backupPath: string | null;
	backupFailed: boolean;
	warnings: string[];
}

export interface OperonDataPackageReloadDiagnostics {
	malformedPackage: boolean;
	missingDomains: string[];
	invalidDomains: string[];
	warnings: string[];
	pipelineTaxonomy: OperonPipelineTaxonomyDiagnostics;
}

export interface OperonDataPackageReloadResult {
	dataPackage: OperonDataPackageV1;
	changed: boolean;
	diagnostics: OperonDataPackageReloadDiagnostics;
}

export interface OperonDataPackageReloadStage {
	changed?: boolean;
	commit(): void;
	rollback(): void;
}

export interface OperonDataPackageReloadOptions {
	stage?: (dataPackage: OperonDataPackageV1) => Promise<OperonDataPackageReloadStage>;
}

export type OperonDataPackageObservedReplaceResult =
	| { status: 'unchanged' | 'committed'; dataPackage: OperonDataPackageV1 }
	| { status: 'committed-after-error'; dataPackage: OperonDataPackageV1 }
	| { status: 'failed-clean'; dataPackage: OperonDataPackageV1 }
	| { status: 'commit-state-unknown'; dataPackage: OperonDataPackageV1 };

type PluginDataAccess = OperonPluginDataAccess | null | undefined;
type OperonDataPackageDomain = Exclude<keyof OperonDataPackageV1, 'schemaVersion'>;

interface OperonTableManifestV2RecoveryMarkerV1 {
	version: 1;
	phase: 'prepared' | 'committed';
	sourceSha256: string;
	candidateSha256: string;
	backupPath: string;
	presetIds: string[];
	bindings: Array<{ id: string; path: string }>;
}

interface OperonTableManifestV2RecoveryMarkerV2 {
	version: 2;
	strategy: 'retire-legacy-sidecar-authority';
	phase: 'prepared' | 'committed';
	sourceSha256: string;
	candidateSha256: string;
	backupPath: string;
	legacySidecars: {
		index: { path: string; sha256: string };
		presets: Array<{ id: string; path: string; sha256: string }>;
	};
}

type OperonTableManifestV2RecoveryMarker = OperonTableManifestV2RecoveryMarkerV1 | OperonTableManifestV2RecoveryMarkerV2;

type TableRecoveryMarkerReadResult =
	| { status: 'missing' }
	| { status: 'valid'; marker: OperonTableManifestV2RecoveryMarker }
	| { status: 'invalid' };

interface OperonTaskCreationProfileV2RecoveryMarkerV1 {
	version: 1;
	phase: 'prepared' | 'committed';
	sourceSignature: string;
	candidateSignature: string;
	backupPath: string;
	candidate: OperonDataPackageV1;
}

type TaskCreationProfileRecoveryMarkerReadResult =
	| { status: 'missing' }
	| { status: 'valid'; marker: OperonTaskCreationProfileV2RecoveryMarkerV1 }
	| { status: 'invalid' };

interface TableRecoveryAttemptResult {
	dataPackage: Partial<OperonDataPackageV1>;
	diagnostics: OperonTablePresetRecoveryDiagnostics;
}

const DATA_PACKAGE_DOMAINS: readonly OperonDataPackageDomain[] = [
	'settings',
	'taxonomy',
	'views',
	'ui',
	'automation',
	'integrations',
	'state',
];

export class OperonDataPackageStore {
	private dataPackage: OperonDataPackageV1 | null = null;
	private dataPackageSignature = '';
	private saveQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private writeSuspensionReason: string | null = null;
	private writeSuspensionRequiresExplicitRecovery = false;
	private unsupportedDeveloperApiGrantPackage = false;
	private unsupportedTaskCreationProfilePackage = false;
	private suspensionBeforeUnsupportedDeveloperApiGrantPackage: {
		writesSuspended: boolean;
		writeSuspensionReason: string | null;
		writeSuspensionRequiresExplicitRecovery: boolean;
	} | null = null;
	private suspensionBeforeUnsupportedTaskCreationProfilePackage: {
		writesSuspended: boolean;
		writeSuspensionReason: string | null;
		writeSuspensionRequiresExplicitRecovery: boolean;
	} | null = null;
	private startupPipelineTaxonomyDiagnostics = createPipelineTaxonomyDiagnostics();

	constructor(
		private readonly adapter: Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'> & Partial<Pick<DataAdapter, 'process' | 'rename'>>,
		private readonly paths: OperonStoragePaths,
		private readonly pluginData: PluginDataAccess,
		private readonly discoverTableRecoveryFiles?: OperonTablePresetRecoveryDiscovery,
	) {}

	async initialize(
		defaults: OperonSettings,
		obsidianLocale?: string,
	): Promise<OperonDataPackageStoreInitResult> {
		let existingPackage = await this.loadExistingPackage();
		const existingCanonicalPackageUnrecognizable = !!existingPackage
			&& isUnrecognizableCanonicalDataPackage(existingPackage);
		if (existingCanonicalPackageUnrecognizable) {
			this.suspendWrites('Canonical data package has no recognizable package envelope; manual recovery is required');
		}
		if (existingPackage) existingPackage = await this.reconcileTaskCreationProfileV2Recovery(existingPackage);
		let tablePresetRecovery = createTablePresetRecoveryDiagnostics();
		const unsupportedTaskCreationProfilePackage = hasUnsupportedFutureTaskCreationProfilePackage(existingPackage);
		if (unsupportedTaskCreationProfilePackage) {
			this.suspendForUnsupportedTaskCreationProfilePackage();
		}
		const existingDeveloperApiGrantPackage = existingPackage?.integrations?.developerApi;
		const unsupportedDeveloperApiGrantPackage = isUnsupportedDeveloperApiGrantPackage(
			existingDeveloperApiGrantPackage,
		);
		if (unsupportedDeveloperApiGrantPackage) this.suspendForUnsupportedDeveloperApiGrantPackage();
		if (existingPackage && !existingCanonicalPackageUnrecognizable
			&& !unsupportedDeveloperApiGrantPackage && !unsupportedTaskCreationProfilePackage) {
			const recovery = await this.enqueueMutation(() => this.recoverTablePresetManifestV2Now(existingPackage!));
			existingPackage = recovery.dataPackage;
			tablePresetRecovery = recovery.diagnostics;
		}
		const recoverableDeveloperApiGrantPackageDrift = !unsupportedDeveloperApiGrantPackage
			&& isRecord(existingDeveloperApiGrantPackage)
			&& buildStableJsonSignature(existingDeveloperApiGrantPackage)
				!== buildStableJsonSignature(normalizeDeveloperApiGrantPackage(existingDeveloperApiGrantPackage));
		const unsupportedTablePresetPackage = existingPackage
			? tablePresetRecovery.status === 'blocked'
				|| tablePresetRecovery.status === 'failed-clean'
				|| tablePresetRecovery.status === 'commit-state-unknown'
				|| (tablePresetRecovery.status !== 'recovered' && isUnsupportedTablePresetPackage(existingPackage))
			: false;
		this.startupPipelineTaxonomyDiagnostics = existingPackage
			&& !unsupportedTablePresetPackage
			&& !unsupportedTaskCreationProfilePackage
			? await this.inspectPipelineTaxonomy(existingPackage)
			: createPipelineTaxonomyDiagnostics();
		const migratedExistingPackage = existingPackage
			? migrateLegacySettingsPackage(existingPackage, obsidianLocale)
			: null;
		const archiveRoutingMigrationRequired = !!existingPackage
			&& isLegacyArchiveRoutingSettings(existingPackage.settings);
		const hasRetiredSettings = hasRetiredOperonDataPackageSettings(existingPackage);
		const mergedPackage = mergeOperonDataPackage(migratedExistingPackage, buildFallbackDataPackage(defaults));
		const normalizedPackage = shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
			? normalizePipelineTaxonomySlice(mergedPackage, defaults)
			: mergedPackage;
		const baseDataPackage = tablePresetRecovery.status === 'recovered' && existingPackage
			? overlayKnownDataPackageFieldsPreservingUnknownV1(existingPackage, normalizedPackage)
			: normalizedPackage;
		const taskCreationProfileMigrationRequired = !!existingPackage
			&& !unsupportedTaskCreationProfilePackage
			&& requiresTaskCreationProfilePackageMigration(existingPackage);
		const canonicalMigrationBase = existingPackage && isCompleteDataPackage(existingPackage)
			? existingPackage
			: baseDataPackage;
		const migrationCandidate = taskCreationProfileMigrationRequired && existingPackage
			? buildTaskCreationProfileV2MigrationCandidate(
				canonicalMigrationBase,
				baseDataPackage,
				defaults,
				archiveRoutingMigrationRequired,
			)
			: archiveRoutingMigrationRequired
				? buildNormalizedSettingsMigrationCandidate(canonicalMigrationBase, baseDataPackage, defaults)
				: baseDataPackage;
		let dataPackage = baseDataPackage;
		if (existingPackage && !this.writesSuspended && !unsupportedTablePresetPackage && !unsupportedDeveloperApiGrantPackage
			&& !unsupportedTaskCreationProfilePackage
			&& (
				shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
					|| hasRetiredSettings
					|| recoverableDeveloperApiGrantPackageDrift
					|| archiveRoutingMigrationRequired
					|| taskCreationProfileMigrationRequired
			)) {
			if (taskCreationProfileMigrationRequired) {
				if (!this.writesSuspended) {
					const migrationResult = await this.commitTaskCreationProfileV2Migration(
						existingPackage,
						migrationCandidate,
					);
					dataPackage = isCompleteDataPackage(migrationResult)
						? migrationResult
						: mergeOperonDataPackage(migrationResult, buildFallbackDataPackage(defaults));
				}
			} else {
				let backupReady = true;
				if ((recoverableDeveloperApiGrantPackageDrift || archiveRoutingMigrationRequired)
					&& !this.startupPipelineTaxonomyDiagnostics.backupPath) {
					try {
						await this.backupCanonicalDataPackageNow(existingPackage);
					} catch (error) {
						backupReady = false;
						console.warn('Operon: Canonical startup migration backup failed; preserving the existing package', error);
					}
				}
				if (backupReady) {
					const committed = await this.persistStartupCandidateObserved(existingPackage, migrationCandidate);
					if (committed) dataPackage = migrationCandidate;
				}
			}
		}
		this.setDataPackage(dataPackage);
		return {
			dataPackage: this.cloneDataPackage(dataPackage),
			unsupportedTablePresetPackage,
			tablePresetRecovery,
			loadedExistingPinnedTasksPackage: hasPinnedTasksPackage(existingPackage),
			pipelineTaxonomyDiagnostics: clonePipelineTaxonomyDiagnostics(this.startupPipelineTaxonomyDiagnostics),
		};
	}

	private async persistStartupCandidateObserved(
		previous: Partial<OperonDataPackageV1>,
		candidate: OperonDataPackageV1,
	): Promise<boolean> {
		const previousSignature = buildStableJsonSignature(previous);
		const candidateSignature = buildStableJsonSignature(candidate);
		let writeFailed = false;
		try {
			await this.persistCandidate(candidate);
		} catch {
			writeFailed = true;
		}
		const observed = await this.readCanonicalDataPackageForObservation();
		if (observed && buildStableJsonSignature(observed) === candidateSignature) return true;
		if (observed && buildStableJsonSignature(observed) === previousSignature) {
			this.suspendWrites(writeFailed
				? 'Canonical startup migration failed without changing the existing package'
				: 'Canonical startup migration reported success without publishing the candidate package');
			return false;
		}
		this.suspendWrites(writeFailed
			? 'Canonical startup migration commit state could not be verified after a failed write'
			: 'Canonical startup migration commit state could not be verified after a reported successful write');
		return false;
	}

	private async reconcileTaskCreationProfileV2Recovery(
		existingPackage: Partial<OperonDataPackageV1>,
	): Promise<Partial<OperonDataPackageV1>> {
		const markerRead = await this.readTaskCreationProfileV2RecoveryMarker();
		if (markerRead.status === 'missing') return existingPackage;
		if (markerRead.status === 'invalid') {
			this.suspendWrites('Task Creation Profile v2 recovery marker is invalid');
			return existingPackage;
		}
		const marker = markerRead.marker;
		if (hasUnsupportedFutureTaskCreationProfilePackage(marker.candidate)) {
			this.suspendForUnsupportedTaskCreationProfilePackage();
			return existingPackage;
		}
		if (!await this.verifyImmutableTaskCreationProfileBackup(marker)) {
			this.suspendWrites('Task Creation Profile v2 recovery backup is unavailable or invalid');
			return existingPackage;
		}
		const observedSignature = await stablePackageSha256(existingPackage);
		if (observedSignature === marker.candidateSignature) {
			if (marker.phase === 'prepared'
				&& !await this.writeTaskCreationProfileV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
				this.suspendWrites('Task Creation Profile v2 recovery marker could not be finalized');
				return existingPackage;
			}
			if (!await this.removeTaskCreationProfileV2RecoveryMarkerObserved()) {
				this.suspendWrites('Task Creation Profile v2 recovery marker could not be cleared');
			}
			return existingPackage;
		}
		if (marker.phase === 'committed' || observedSignature !== marker.sourceSignature) {
			this.suspendWrites('Task Creation Profile v2 recovery canonical state does not match the transaction');
			return existingPackage;
		}
		if (await stablePackageSha256(marker.candidate) !== marker.candidateSignature) {
			this.suspendWrites('Task Creation Profile v2 recovery candidate is invalid');
			return existingPackage;
		}
		return await this.commitPreparedTaskCreationProfileV2Migration(existingPackage, marker);
	}

	private async commitTaskCreationProfileV2Migration(
		previous: Partial<OperonDataPackageV1>,
		candidate: OperonDataPackageV1,
	): Promise<Partial<OperonDataPackageV1>> {
		const rawSource = await this.readCanonicalBackupSource(previous);
		let parsedSource: unknown;
		try {
			parsedSource = JSON.parse(rawSource) as unknown;
		} catch {
			this.suspendWrites('Task Creation Profile v2 migration could not parse its canonical source');
			return previous;
		}
		if (!isRecord(parsedSource)
			|| buildStableJsonSignature(parsedSource) !== buildStableJsonSignature(previous)) {
			this.suspendWrites('Task Creation Profile v2 migration canonical source changed before preparation');
			return previous;
		}
		const sourceSignature = await stablePackageSha256(previous);
		const candidateSignature = await stablePackageSha256(candidate);
		const backupPath = `${this.paths.dataPackagePath}.task-creation-profile-v2-${sourceSignature}.bak`;
		try {
			await this.writeImmutableTaskCreationProfileBackup(backupPath, rawSource);
		} catch {
			this.suspendWrites('Task Creation Profile v2 migration backup could not be created');
			return previous;
		}
		const marker: OperonTaskCreationProfileV2RecoveryMarkerV1 = {
			version: 1,
			phase: 'prepared',
			sourceSignature,
			candidateSignature,
			backupPath,
			candidate: this.cloneDataPackage(candidate),
		};
		if (!await this.writeTaskCreationProfileV2RecoveryMarkerObserved(marker)) {
			this.suspendWrites('Task Creation Profile v2 recovery marker could not be persisted');
			return previous;
		}
		return await this.commitPreparedTaskCreationProfileV2Migration(previous, marker);
	}

	private async commitPreparedTaskCreationProfileV2Migration(
		previous: Partial<OperonDataPackageV1>,
		marker: OperonTaskCreationProfileV2RecoveryMarkerV1,
	): Promise<Partial<OperonDataPackageV1>> {
		try {
			await this.persistCandidate(marker.candidate);
		} catch {
			// Canonical observation below classifies the write outcome.
		}
		const observed = await this.readCanonicalDataPackageForObservation();
		const observedSignature = observed ? await stablePackageSha256(observed) : null;
		if (observed && observedSignature === marker.candidateSignature) {
			if (!await this.writeTaskCreationProfileV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
				this.suspendWrites('Task Creation Profile v2 recovery marker could not be finalized');
				return observed;
			}
			if (!await this.removeTaskCreationProfileV2RecoveryMarkerObserved()) {
				this.suspendWrites('Task Creation Profile v2 recovery marker could not be cleared');
			}
			return observed;
		}
		if (observedSignature === marker.sourceSignature) {
			this.suspendWrites('Task Creation Profile v2 migration failed cleanly; restart will resume the prepared transaction');
			return previous;
		}
		this.suspendWrites('Task Creation Profile v2 migration canonical state requires manual recovery from the verified backup');
		return previous;
	}

	getDataPackage(): OperonDataPackageV1 {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		return this.cloneDataPackage(this.dataPackage);
	}

	/**
	 * Capture logical settings from the last successfully persisted package after
	 * all package mutations queued before this read. Composition occurs at the
	 * queue linearization point and does not expose non-settings package domains.
	 */
	async captureCommittedSettingsSnapshot(
		defaults: OperonSettings,
	): Promise<OperonCommittedSettingsDataPackageSnapshot> {
		return this.enqueueMutation(async () => {
			const dataPackage = this.getDataPackage();
			return {
				settings: composeOperonSettingsFromDataPackage(dataPackage, defaults),
				dataPackageSchemaVersion: dataPackage.schemaVersion,
			};
		});
	}

	getSettings(defaults: OperonSettings): OperonSettings {
		return composeOperonSettingsFromDataPackage(this.getDataPackage(), defaults);
	}

	getStartupPipelineTaxonomyDiagnostics(): OperonPipelineTaxonomyDiagnostics {
		return clonePipelineTaxonomyDiagnostics(this.startupPipelineTaxonomyDiagnostics);
	}

	canPersist(): boolean {
		return !this.writesSuspended;
	}

	getWriteSuspensionReason(): string | null {
		return this.writeSuspensionReason;
	}

	suspendWrites(reason: string): void {
		const nextReason = reason.trim() || 'Canonical data package writes were suspended';
		if (this.unsupportedTaskCreationProfilePackage) {
			this.suspensionBeforeUnsupportedTaskCreationProfilePackage = {
				writesSuspended: true,
				writeSuspensionReason: nextReason,
				writeSuspensionRequiresExplicitRecovery: true,
			};
		}
		if (this.unsupportedDeveloperApiGrantPackage) {
			this.suspensionBeforeUnsupportedDeveloperApiGrantPackage = {
				writesSuspended: true,
				writeSuspensionReason: nextReason,
				writeSuspensionRequiresExplicitRecovery: true,
			};
		}
		this.writesSuspended = true;
		this.writeSuspensionReason = nextReason;
		this.writeSuspensionRequiresExplicitRecovery = true;
	}

	resumeWrites(): void {
		if (this.unsupportedTaskCreationProfilePackage) {
			this.suspendForUnsupportedTaskCreationProfilePackage();
			return;
		}
		if (this.unsupportedDeveloperApiGrantPackage) {
			this.suspendForUnsupportedDeveloperApiGrantPackage();
			return;
		}
		this.writesSuspended = false;
		this.writeSuspensionReason = null;
		this.writeSuspensionRequiresExplicitRecovery = false;
	}

	async backupCanonicalDataPackage(raw?: unknown): Promise<string> {
		return this.enqueueMutation(async () => {
			try {
				let fallback = raw;
				if (fallback === undefined && !(await this.adapter.exists(this.paths.dataPackagePath))) {
					fallback = this.pluginData
						? await this.pluginData.loadData()
						: this.getDataPackage();
				}
				const serialized = await this.readCanonicalBackupSource(fallback);
				const backupPath = await this.writeVerifiedBackup(serialized);
				this.resumeWrites();
				return backupPath;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.suspendWrites(`data.json backup failed: ${message}`);
				throw error;
			}
		});
	}

	async reloadCanonicalDataPackage(
		defaults: OperonSettings,
		options: OperonDataPackageReloadOptions = {},
	): Promise<OperonDataPackageReloadResult> {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		return this.enqueueMutation(async () => {
			const diagnostics = createReloadDiagnostics();
			const current = this.getDataPackage();
			const externalPackage = await this.loadCanonicalPackageForReload(diagnostics);
			if (!externalPackage) {
				return {
					dataPackage: current,
					changed: false,
					diagnostics,
				};
			}
			if (isUnsupportedDeveloperApiGrantPackage(externalPackage.integrations?.developerApi)) {
				this.suspendForUnsupportedDeveloperApiGrantPackage();
				diagnostics.warnings.push('Unsupported future Developer API grant package version');
				return {
					dataPackage: current,
					changed: false,
					diagnostics,
				};
			}
			if (hasUnsupportedFutureTaskCreationProfilePackage(externalPackage)) {
				this.suspendForUnsupportedTaskCreationProfilePackage();
				diagnostics.warnings.push('Unsupported future Task Creation Profile package version');
				return {
					dataPackage: current,
					changed: false,
					diagnostics,
				};
			}
			this.clearUnsupportedDeveloperApiGrantPackageSuspension();
			this.clearUnsupportedTaskCreationProfilePackageSuspension();
			const pipelineTaxonomy = await this.inspectPipelineTaxonomy(externalPackage);
			diagnostics.pipelineTaxonomy = pipelineTaxonomy;
			if (pipelineTaxonomy.backupFailed) {
				return {
					dataPackage: current,
					changed: false,
					diagnostics,
				};
			}

			const fallback = this.dataPackage ?? buildFallbackDataPackage(defaults);
			const legacyArchiveReload = isLegacyArchiveRoutingSettings(externalPackage.settings);
			const compatibilitySafeExternalPackage = preserveLegacyReloadSettingsIntent(externalPackage, current);
			const mergedPackage = mergeOperonDataPackage(compatibilitySafeExternalPackage, fallback);
			const migrationSafePackage = legacyArchiveReload
				? buildLegacyArchiveReloadMigrationCandidate(mergedPackage, current, defaults)
				: mergedPackage;
			const dataPackage = shouldNormalizePipelineTaxonomy(pipelineTaxonomy)
				? normalizePipelineTaxonomySlice(migrationSafePackage, defaults)
				: migrationSafePackage;
			const nextSignature = buildStableJsonSignature(dataPackage);
			const externalSignature = buildStableJsonSignature(externalPackage);
			if (!this.writeSuspensionRequiresExplicitRecovery) {
				this.resumeWrites();
			}
			const packageChanged = nextSignature !== this.dataPackageSignature;
			const shouldPersistCandidate = externalSignature !== nextSignature;
			let staged: OperonDataPackageReloadStage | null = null;
			try {
				staged = options.stage
					? await options.stage(this.cloneDataPackage(dataPackage))
					: null;
				if (shouldPersistCandidate) {
					if (!pipelineTaxonomy.backupPath) {
						await this.backupCanonicalDataPackageNow(externalPackage);
					}
					await this.persistCandidate(dataPackage);
				}
				staged?.commit();
				if (packageChanged) this.setDataPackage(dataPackage);
			} catch (error) {
				staged?.rollback();
				throw error;
			}
			return {
				dataPackage: this.cloneDataPackage(dataPackage),
				changed: packageChanged || staged?.changed === true,
				diagnostics,
			};
		});
	}

	async replaceDataPackage(dataPackage: OperonDataPackageV1): Promise<void> {
		const candidate = this.cloneDataPackage(dataPackage);
		await this.enqueueMutation(async () => {
			if (buildStableJsonSignature(candidate) === this.dataPackageSignature) return;
			await this.persistCandidate(candidate);
			this.setDataPackage(candidate);
		});
	}

	/**
	 * Replace the canonical package and classify an acknowledgement failure by
	 * rereading the canonical source. This never retries a failed write.
	 */
	async replaceDataPackageObserved(dataPackage: OperonDataPackageV1): Promise<OperonDataPackageObservedReplaceResult> {
		const candidate = this.cloneDataPackage(dataPackage);
		return this.updateDataPackageObserved(() => candidate);
	}

	async updateDataPackageObserved(
		mutator: (dataPackage: OperonDataPackageV1) => OperonDataPackageV1,
	): Promise<OperonDataPackageObservedReplaceResult> {
		return this.enqueueMutation(async () => {
			const previous = this.getDataPackage();
			const candidate = this.cloneDataPackage(mutator(previous));
			const previousSignature = buildStableJsonSignature(previous);
			const candidateSignature = buildStableJsonSignature(candidate);
			if (candidateSignature === previousSignature) return { status: 'unchanged', dataPackage: previous };
			try {
				await this.persistCandidate(candidate);
				this.setDataPackage(candidate);
				return { status: 'committed', dataPackage: this.cloneDataPackage(candidate) };
			} catch {
				const observed = await this.readCanonicalDataPackageForObservation();
				if (observed && buildStableJsonSignature(observed) === candidateSignature) {
					this.setDataPackage(candidate);
					return { status: 'committed-after-error', dataPackage: this.cloneDataPackage(candidate) };
				}
				if (observed && buildStableJsonSignature(observed) === previousSignature) {
					return { status: 'failed-clean', dataPackage: previous };
				}
				this.suspendWrites('Canonical data package commit state could not be verified after a failed write');
				return { status: 'commit-state-unknown', dataPackage: previous };
			}
		});
	}

	async updateDataPackage(mutator: (dataPackage: OperonDataPackageV1) => OperonDataPackageV1): Promise<void> {
		await this.enqueueMutation(async () => {
			const next = this.cloneDataPackage(mutator(this.getDataPackage()));
			if (buildStableJsonSignature(next) === this.dataPackageSignature) return;
			await this.persistCandidate(next);
			this.setDataPackage(next);
		});
	}

	async drain(): Promise<void> {
		await this.saveQueue;
	}

	async canReadCanonicalDataPackage(): Promise<boolean> {
		await this.saveQueue;
		try {
			const raw = this.pluginData
				? await this.pluginData.loadData()
				: await this.loadPackageFromAdapter();
			return isCompleteDataPackage(raw);
		} catch {
			return false;
		}
	}

	private async recoverTablePresetManifestV2Now(
		existingPackage: Partial<OperonDataPackageV1>,
	): Promise<TableRecoveryAttemptResult> {
		const markerRead = await this.readTableManifestV2RecoveryMarker();
		if (markerRead.status === 'invalid') {
			this.suspendWrites('Table manifest v2 recovery marker is invalid');
			return this.blockTableRecovery(existingPackage, 'marker-invalid', null, 'commit-state-unknown');
		}
		if (markerRead.status === 'missing' && !isUnsupportedTablePresetPackage(existingPackage)) {
			const preflight = preflightTablePresetManifestRecoveryV1(existingPackage, []);
			if (preflight.status === 'blocked' && preflight.code === 'binding-partial') {
				return this.blockTableRecovery(existingPackage, preflight.code, null, 'blocked');
			}
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		let rawSource: string;
		let parsedSource: unknown;
		try {
			rawSource = await this.readCanonicalBackupSource(existingPackage);
			parsedSource = JSON.parse(rawSource) as unknown;
		} catch {
			this.suspendWrites('Table manifest v2 recovery could not read canonical data.json');
			return this.blockTableRecovery(existingPackage, 'canonical-read-drift', null, 'commit-state-unknown');
		}
		if (!isRecord(parsedSource)
			|| buildStableJsonSignature(parsedSource) !== buildStableJsonSignature(existingPackage)) {
			this.suspendWrites('Table manifest v2 recovery source changed during startup');
			return this.blockTableRecovery(existingPackage, 'canonical-read-drift', null, 'commit-state-unknown');
		}
		if (parsedSource.schemaVersion !== OPERON_DATA_PACKAGE_SCHEMA_VERSION) {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		const sourceSha256 = await sha256HexForStorage(rawSource);
		if (markerRead.status === 'valid') {
			const marker = markerRead.marker;
			if (marker.version === 2) {
				return await this.resumeLegacyTablePresetSidecarRetirement(
					existingPackage,
					rawSource,
					parsedSource,
					sourceSha256,
					marker,
				);
			}
			const expectedBackupPath = this.getTableRecoveryBackupPath(marker.sourceSha256);
			if (marker.backupPath !== expectedBackupPath) {
				this.suspendWrites('Table manifest v2 recovery marker references an unexpected backup path');
				return this.blockTableRecovery(existingPackage, 'marker-invalid', null, 'commit-state-unknown');
			}
			if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256)) {
				this.suspendWrites('Table manifest v2 recovery backup is unavailable or invalid');
				return this.blockTableRecovery(existingPackage, 'backup-failed', marker.backupPath, 'commit-state-unknown');
			}
			if (marker.phase === 'committed') {
				const current = preflightTablePresetManifestRecoveryV1(parsedSource, []);
				if (current.status !== 'not-needed' || current.reason !== 'current') {
					this.suspendWrites('Committed Table manifest recovery no longer has a current v3 canonical package');
					return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
				}
				return {
					dataPackage: parsedSource,
					diagnostics: createRecoveredTablePresetRecoveryDiagnostics(marker.backupPath),
				};
			}
			if (await getTableRecoveryCandidateSha256(parsedSource) === marker.candidateSha256) {
				if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
					this.suspendWrites('Table manifest v2 recovery marker could not be finalized');
					return this.blockTableRecovery(existingPackage, 'marker-finalization-failed', marker.backupPath, 'blocked');
				}
				return {
					dataPackage: parsedSource,
					diagnostics: createRecoveredTablePresetRecoveryDiagnostics(marker.backupPath),
				};
			}
			if (sourceSha256 !== marker.sourceSha256) {
				this.suspendWrites('Table manifest v2 recovery canonical state does not match the prepared transaction');
				return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
			}
			if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256, rawSource)) {
				this.suspendWrites('Table manifest v2 recovery backup is unavailable or invalid');
				return this.blockTableRecovery(existingPackage, 'backup-failed', marker.backupPath, 'commit-state-unknown');
			}
			const resumed = await this.buildTableRecoveryCandidate(parsedSource);
			if (resumed.status !== 'recoverable') {
				this.suspendWrites('Table manifest v2 recovery evidence no longer matches the prepared transaction');
				return this.blockTableRecovery(
					existingPackage,
					resumed.status === 'blocked' ? resumed.code : 'canonical-state-unknown',
					marker.backupPath,
					'commit-state-unknown',
				);
			}
			const candidate = buildRecoveredTablePresetDataPackageV1(parsedSource, resumed);
			if (await getTableRecoveryCandidateSha256(candidate) !== marker.candidateSha256
				|| buildStableJsonSignature(resumed.presetIds) !== buildStableJsonSignature(marker.presetIds)
				|| buildStableJsonSignature(resumed.bindings) !== buildStableJsonSignature(marker.bindings)) {
				this.suspendWrites('Table manifest v2 recovery candidate changed after preparation');
				return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
			}
			return await this.commitTableRecoveryCandidate(parsedSource, candidate, marker);
		}

		const preflight = await this.buildTableRecoveryCandidate(parsedSource);
		if (preflight.status === 'not-needed') {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		if (preflight.status === 'blocked') {
			if (preflight.code === 'table-file-missing') {
				const legacy = await this.buildLegacyTablePresetSidecarRetirementCandidate(parsedSource);
				const legacyPreflight = legacy.preflight;
				if (legacyPreflight.status === 'recoverable') {
					return await this.beginLegacyTablePresetSidecarRetirement(
						existingPackage,
						rawSource,
						parsedSource,
						sourceSha256,
						{ evidence: legacy.evidence, preflight: legacyPreflight },
					);
				}
				return this.blockTableRecovery(existingPackage, legacyPreflight.code, null, 'blocked');
			}
			return this.blockTableRecovery(existingPackage, preflight.code, null, 'blocked');
		}
		const candidate = buildRecoveredTablePresetDataPackageV1(parsedSource, preflight);
		const backupPath = this.getTableRecoveryBackupPath(sourceSha256);
		try {
			await this.writeImmutableTableRecoveryBackup(backupPath, rawSource);
		} catch {
			this.suspendWrites('Table manifest v2 recovery backup could not be created');
			return this.blockTableRecovery(existingPackage, 'backup-failed', backupPath, 'blocked');
		}
		const marker: OperonTableManifestV2RecoveryMarkerV1 = {
			version: 1,
			phase: 'prepared',
			sourceSha256,
			candidateSha256: await getTableRecoveryCandidateSha256(candidate),
			backupPath,
			presetIds: [...preflight.presetIds],
			bindings: preflight.bindings.map(binding => ({ ...binding })),
		};
		if (!await this.writeTableManifestV2RecoveryMarkerObserved(marker)) {
			this.suspendWrites('Table manifest v2 recovery marker could not be persisted');
			return this.blockTableRecovery(existingPackage, 'marker-write-failed', backupPath, 'blocked');
		}
		return await this.commitTableRecoveryCandidate(parsedSource, candidate, marker);
	}

	private async buildTableRecoveryCandidate(dataPackage: unknown) {
		const withoutFiles = preflightTablePresetManifestRecoveryV1(dataPackage, []);
		if (withoutFiles.status !== 'blocked' || withoutFiles.code !== 'table-file-missing') return withoutFiles;
		if (!this.discoverTableRecoveryFiles) return withoutFiles;
		try {
			return preflightTablePresetManifestRecoveryV1(dataPackage, await this.discoverTableRecoveryFiles());
		} catch {
			return { status: 'blocked' as const, code: 'table-file-invalid' as const };
		}
	}

	private async buildLegacyTablePresetSidecarRetirementCandidate(dataPackage: unknown): Promise<{
		evidence: TablePresetLegacySidecarEvidenceV1;
		preflight: TablePresetLegacySidecarRetirementPreflight;
	}> {
		const evidence = await this.readLegacyTablePresetSidecarEvidence(dataPackage);
		return {
			evidence,
			preflight: preflightLegacyTablePresetSidecarRetirementV1(dataPackage, evidence),
		};
	}

	private async readLegacyTablePresetSidecarEvidence(dataPackage: unknown): Promise<TablePresetLegacySidecarEvidenceV1> {
		const rootPath = `${this.paths.pluginDir}/data/table-presets`;
		const indexPath = `${rootPath}/index.json`;
		const presetIds = isRecord(dataPackage)
			&& isRecord(dataPackage.views)
			&& isRecord(dataPackage.views.tablePresets)
			&& Array.isArray(dataPackage.views.tablePresets.presetIds)
			? dataPackage.views.tablePresets.presetIds.filter((value): value is string => typeof value === 'string')
			: [];
		return {
			index: { path: indexPath, source: await this.readOptionalLegacyTableSidecar(indexPath) },
			presets: await Promise.all(presetIds.map(async id => {
				const path = `${rootPath}/${encodeURIComponent(id)}.json`;
				return { id, path, source: await this.readOptionalLegacyTableSidecar(path) };
			})),
		};
	}

	private async readOptionalLegacyTableSidecar(path: string): Promise<string | null> {
		try {
			if (!(await this.adapter.exists(path))) return null;
			return await this.adapter.read(path);
		} catch {
			return null;
		}
	}

	private async beginLegacyTablePresetSidecarRetirement(
		existingPackage: Partial<OperonDataPackageV1>,
		rawSource: string,
		parsedSource: unknown,
		sourceSha256: string,
		legacy: {
			evidence: TablePresetLegacySidecarEvidenceV1;
			preflight: Extract<TablePresetLegacySidecarRetirementPreflight, { status: 'recoverable' }>;
		},
	): Promise<TableRecoveryAttemptResult> {
		const candidate = buildRetiredLegacyTablePresetDataPackageV1(parsedSource, legacy.preflight);
		const backupPath = this.getTableRecoveryBackupPath(sourceSha256);
		try {
			await this.writeImmutableTableRecoveryBackup(backupPath, rawSource);
		} catch {
			this.suspendWrites('Legacy Table sidecar retirement backup could not be created');
			return this.blockTableRecovery(existingPackage, 'backup-failed', backupPath, 'blocked');
		}
		const sidecars = await this.getLegacySidecarMarkerEvidence(legacy.evidence, legacy.preflight);
		if (!sidecars) {
			this.suspendWrites('Legacy Table sidecar retirement evidence could not be sealed');
			return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', backupPath, 'blocked');
		}
		const marker: OperonTableManifestV2RecoveryMarkerV2 = {
			version: 2,
			strategy: 'retire-legacy-sidecar-authority',
			phase: 'prepared',
			sourceSha256,
			candidateSha256: await getTableRecoveryCandidateSha256(candidate),
			backupPath,
			legacySidecars: sidecars,
		};
		if (!await this.writeTableManifestV2RecoveryMarkerObserved(marker)) {
			this.suspendWrites('Legacy Table sidecar retirement marker could not be persisted');
			return this.blockTableRecovery(existingPackage, 'marker-write-failed', backupPath, 'blocked');
		}
		return await this.commitTableRecoveryCandidate(
			parsedSource,
			candidate,
			marker,
			'retire-legacy-sidecar-authority',
			true,
		);
	}

	private async resumeLegacyTablePresetSidecarRetirement(
		existingPackage: Partial<OperonDataPackageV1>,
		rawSource: string,
		parsedSource: unknown,
		sourceSha256: string,
		marker: OperonTableManifestV2RecoveryMarkerV2,
	): Promise<TableRecoveryAttemptResult> {
		const expectedBackupPath = this.getTableRecoveryBackupPath(marker.sourceSha256);
		if (marker.backupPath !== expectedBackupPath) {
			this.suspendWrites('Legacy Table sidecar retirement marker references an unexpected backup path');
			return this.blockTableRecovery(existingPackage, 'marker-invalid', null, 'commit-state-unknown');
		}
		if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256)) {
			this.suspendWrites('Legacy Table sidecar retirement backup is unavailable or invalid');
			return this.blockTableRecovery(existingPackage, 'backup-failed', marker.backupPath, 'commit-state-unknown');
		}
		if (marker.phase === 'committed') {
			const current = preflightTablePresetManifestRecoveryV1(parsedSource, []);
			if (current.status !== 'not-needed' || current.reason !== 'current') {
				this.suspendWrites('Committed legacy Table sidecar retirement no longer has a current v3 canonical package');
				return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
			}
			return {
				dataPackage: parsedSource as Partial<OperonDataPackageV1>,
				diagnostics: createRecoveredTablePresetRecoveryDiagnostics(
					marker.backupPath,
					'retire-legacy-sidecar-authority',
				),
			};
		}
		if (await getTableRecoveryCandidateSha256(parsedSource) === marker.candidateSha256) {
			if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
				this.suspendWrites('Legacy Table sidecar retirement marker could not be finalized');
				return this.blockTableRecovery(existingPackage, 'marker-finalization-failed', marker.backupPath, 'blocked');
			}
			return {
				dataPackage: parsedSource as Partial<OperonDataPackageV1>,
				diagnostics: createRecoveredTablePresetRecoveryDiagnostics(
					marker.backupPath,
					'retire-legacy-sidecar-authority',
					true,
				),
			};
		}
		if (sourceSha256 !== marker.sourceSha256) {
			this.suspendWrites('Legacy Table sidecar retirement canonical state does not match the prepared transaction');
			return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
		}
		if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256, rawSource)) {
			this.suspendWrites('Legacy Table sidecar retirement backup is unavailable or invalid');
			return this.blockTableRecovery(existingPackage, 'backup-failed', marker.backupPath, 'commit-state-unknown');
		}
		const legacy = await this.buildLegacyTablePresetSidecarRetirementCandidate(parsedSource);
		if (legacy.preflight.status !== 'recoverable'
			|| !await this.matchesLegacySidecarMarkerEvidence(legacy.evidence, legacy.preflight, marker.legacySidecars)) {
			this.suspendWrites('Legacy Table sidecar retirement evidence no longer matches the prepared transaction');
			return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
		}
		const candidate = buildRetiredLegacyTablePresetDataPackageV1(parsedSource, legacy.preflight);
		if (await getTableRecoveryCandidateSha256(candidate) !== marker.candidateSha256) {
			this.suspendWrites('Legacy Table sidecar retirement candidate changed after preparation');
			return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
		}
		return await this.commitTableRecoveryCandidate(
			parsedSource,
			candidate,
			marker,
			'retire-legacy-sidecar-authority',
			true,
		);
	}

	private async getLegacySidecarMarkerEvidence(
		evidence: TablePresetLegacySidecarEvidenceV1,
		preflight: Extract<TablePresetLegacySidecarRetirementPreflight, { status: 'recoverable' }>,
	): Promise<OperonTableManifestV2RecoveryMarkerV2['legacySidecars'] | null> {
		if (evidence.index.source === null) return null;
		const sidecars = new Map(evidence.presets.map(entry => [entry.id, entry]));
		const presets: Array<{ id: string; path: string; sha256: string }> = [];
		for (const entry of preflight.presetPaths) {
			const source = sidecars.get(entry.id)?.source;
			if (source === null || source === undefined) return null;
			presets.push({ id: entry.id, path: entry.path, sha256: await sha256HexForStorage(source) });
		}
		return {
			index: { path: evidence.index.path, sha256: await sha256HexForStorage(evidence.index.source) },
			presets,
		};
	}

	private async matchesLegacySidecarMarkerEvidence(
		evidence: TablePresetLegacySidecarEvidenceV1,
		preflight: Extract<TablePresetLegacySidecarRetirementPreflight, { status: 'recoverable' }>,
		expected: OperonTableManifestV2RecoveryMarkerV2['legacySidecars'],
	): Promise<boolean> {
		const observed = await this.getLegacySidecarMarkerEvidence(evidence, preflight);
		return observed !== null && buildStableJsonSignature(observed) === buildStableJsonSignature(expected);
	}

	private async commitTableRecoveryCandidate(
		previous: unknown,
		candidate: unknown,
		marker: OperonTableManifestV2RecoveryMarker,
		strategy: OperonTablePresetRecoveryDiagnostics['strategy'] = null,
		completedLegacySidecarRetirementThisStartup = false,
	): Promise<TableRecoveryAttemptResult> {
		try {
			await this.persistCandidate(candidate as OperonDataPackageV1);
		} catch {
			// The observed canonical state below owns acknowledgement classification.
		}
		const observed = await this.readCanonicalDataPackageForObservation();
		const previousSignature = buildStableJsonSignature(previous);
		const candidateSignature = buildStableJsonSignature(candidate);
		if (observed && buildStableJsonSignature(observed) === candidateSignature) {
			if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
				this.suspendWrites('Table manifest v2 recovery marker could not be finalized');
				return this.blockTableRecovery(observed, 'marker-finalization-failed', marker.backupPath, 'blocked');
			}
			return {
				dataPackage: observed,
				diagnostics: createRecoveredTablePresetRecoveryDiagnostics(
					marker.backupPath,
					strategy,
					completedLegacySidecarRetirementThisStartup,
				),
			};
		}
		if (observed && buildStableJsonSignature(observed) === previousSignature) {
			return this.blockTableRecovery(previous as Partial<OperonDataPackageV1>, 'canonical-write-failed', marker.backupPath, 'failed-clean');
		}
		this.suspendWrites('Table manifest v2 recovery canonical commit state could not be verified');
		return this.blockTableRecovery(previous as Partial<OperonDataPackageV1>, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
	}

	private blockTableRecovery(
		dataPackage: Partial<OperonDataPackageV1>,
		code: NonNullable<OperonTablePresetRecoveryDiagnostics['code']>,
		backupPath: string | null,
		status: 'blocked' | 'failed-clean' | 'commit-state-unknown',
	): TableRecoveryAttemptResult {
		this.suspendWrites(`Table manifest v2 recovery is blocked (${code})`);
		return {
			dataPackage,
			diagnostics: {
				status,
				code,
				backupPath,
				strategy: null,
				completedLegacySidecarRetirementThisStartup: false,
			},
		};
	}

	private async writeImmutableTableRecoveryBackup(path: string, source: string): Promise<void> {
		if (await this.adapter.exists(path)) {
			if (await this.adapter.read(path) !== source) throw new Error('Existing Table recovery backup does not match source.');
			return;
		}
		try {
			await writeTextSafely(this.adapter, path, source, { forceAtomicReplacement: true });
			if (await this.adapter.read(path) !== source) throw new Error('Table recovery backup verification failed.');
		} catch (error) {
			try {
				if (await this.adapter.exists(path)) await this.adapter.remove(path);
			} catch {
				// Preserve the original verification failure; an orphan is reported by the blocked recovery state.
			}
			throw error;
		}
	}

	private getTableRecoveryBackupPath(sourceSha256: string): string {
		return `${this.paths.dataPackagePath}.table-manifest-v2-${sourceSha256}.bak`;
	}

	private async verifyImmutableTableRecoveryBackup(path: string, sourceSha256: string, expectedSource?: string): Promise<boolean> {
		try {
			if (!(await this.adapter.exists(path))) return false;
			const source = await this.adapter.read(path);
			return await sha256HexForStorage(source) === sourceSha256
				&& (expectedSource === undefined || source === expectedSource);
		} catch {
			return false;
		}
	}

	private async readTableManifestV2RecoveryMarker(): Promise<TableRecoveryMarkerReadResult> {
		try {
			if (!(await this.adapter.exists(this.paths.tableManifestV2RecoveryPath))) return { status: 'missing' };
			const parsed: unknown = JSON.parse(await this.adapter.read(this.paths.tableManifestV2RecoveryPath));
			return isTableManifestV2RecoveryMarker(parsed)
				? { status: 'valid', marker: parsed }
				: { status: 'invalid' };
		} catch {
			return { status: 'invalid' };
		}
	}

	private async writeTableManifestV2RecoveryMarker(marker: OperonTableManifestV2RecoveryMarker): Promise<void> {
		const serialized = JSON.stringify(marker, null, '\t');
		await writeTextSafely(this.adapter, this.paths.tableManifestV2RecoveryPath, serialized, { forceAtomicReplacement: true });
		if (await this.adapter.read(this.paths.tableManifestV2RecoveryPath) !== serialized) {
			throw new Error('Table manifest v2 recovery marker verification failed.');
		}
	}

	private async writeTableManifestV2RecoveryMarkerObserved(
		marker: OperonTableManifestV2RecoveryMarker,
	): Promise<boolean> {
		try {
			await this.writeTableManifestV2RecoveryMarker(marker);
			return true;
		} catch {
			const observed = await this.readTableManifestV2RecoveryMarker();
			return observed.status === 'valid'
				&& buildStableJsonSignature(observed.marker) === buildStableJsonSignature(marker);
		}
	}

	private async readTaskCreationProfileV2RecoveryMarker(): Promise<TaskCreationProfileRecoveryMarkerReadResult> {
		try {
			if (!(await this.adapter.exists(this.paths.taskCreationProfileV2RecoveryPath))) return { status: 'missing' };
			const parsed: unknown = JSON.parse(await this.adapter.read(this.paths.taskCreationProfileV2RecoveryPath));
			return isTaskCreationProfileV2RecoveryMarker(parsed)
				? { status: 'valid', marker: parsed }
				: { status: 'invalid' };
		} catch {
			return { status: 'invalid' };
		}
	}

	private async writeTaskCreationProfileV2RecoveryMarker(
		marker: OperonTaskCreationProfileV2RecoveryMarkerV1,
	): Promise<void> {
		const serialized = JSON.stringify(marker, null, '\t');
		await writeTextSafely(this.adapter, this.paths.taskCreationProfileV2RecoveryPath, serialized, {
			forceAtomicReplacement: true,
		});
		if (await this.adapter.read(this.paths.taskCreationProfileV2RecoveryPath) !== serialized) {
			throw new Error('Task Creation Profile v2 recovery marker verification failed.');
		}
	}

	private async writeTaskCreationProfileV2RecoveryMarkerObserved(
		marker: OperonTaskCreationProfileV2RecoveryMarkerV1,
	): Promise<boolean> {
		try {
			await this.writeTaskCreationProfileV2RecoveryMarker(marker);
			return true;
		} catch {
			const observed = await this.readTaskCreationProfileV2RecoveryMarker();
			return observed.status === 'valid'
				&& buildStableJsonSignature(observed.marker) === buildStableJsonSignature(marker);
		}
	}

	private async removeTaskCreationProfileV2RecoveryMarkerObserved(): Promise<boolean> {
		try {
			if (await this.adapter.exists(this.paths.taskCreationProfileV2RecoveryPath)) {
				await this.adapter.remove(this.paths.taskCreationProfileV2RecoveryPath);
			}
			return !(await this.adapter.exists(this.paths.taskCreationProfileV2RecoveryPath));
		} catch {
			return false;
		}
	}

	private async writeImmutableTaskCreationProfileBackup(path: string, source: string): Promise<void> {
		if (await this.adapter.exists(path)) {
			if (await this.adapter.read(path) !== source) {
				throw new Error('Existing Task Creation Profile recovery backup does not match source.');
			}
			return;
		}
		try {
			await writeTextSafely(this.adapter, path, source, { forceAtomicReplacement: true });
			if (await this.adapter.read(path) !== source) {
				throw new Error('Task Creation Profile recovery backup verification failed.');
			}
		} catch (error) {
			try {
				if (await this.adapter.exists(path)) await this.adapter.remove(path);
			} catch {
				// The blocked transaction retains its marker or source package for manual recovery.
			}
			throw error;
		}
	}

	private async verifyImmutableTaskCreationProfileBackup(
		marker: OperonTaskCreationProfileV2RecoveryMarkerV1,
	): Promise<boolean> {
		const expectedPath = `${this.paths.dataPackagePath}.task-creation-profile-v2-${marker.sourceSignature}.bak`;
		try {
			if (marker.backupPath !== expectedPath || !(await this.adapter.exists(marker.backupPath))) return false;
			const raw = await this.adapter.read(marker.backupPath);
			const parsed: unknown = JSON.parse(raw);
			return await stablePackageSha256(parsed) === marker.sourceSignature;
		} catch {
			return false;
		}
	}

	private async loadExistingPackage(): Promise<Partial<OperonDataPackageV1> | null> {
		try {
			const raw = this.pluginData
				? await this.pluginData.loadData()
				: await this.loadPackageFromAdapter();
			return isRecord(raw) ? raw : null;
		} catch {
			console.warn('Operon: Failed to load data.json, using default settings without overwriting existing package');
			this.suspendWritesForReadFailure('data.json could not be read safely');
			return null;
		}
	}

	private async loadPackageFromAdapter(): Promise<unknown> {
		if (!(await this.adapter.exists(this.paths.dataPackagePath))) return null;
		const raw = await this.adapter.read(this.paths.dataPackagePath);
		return JSON.parse(raw);
	}

	private async readCanonicalDataPackageForObservation(): Promise<OperonDataPackageV1 | null> {
		try {
			const raw = this.pluginData
				? await this.pluginData.loadData()
				: await this.loadPackageFromAdapter();
			return isCompleteDataPackage(raw) ? this.cloneDataPackage(raw) : null;
		} catch {
			return null;
		}
	}

	private async loadCanonicalPackageForReload(
		diagnostics: OperonDataPackageReloadDiagnostics,
	): Promise<Partial<OperonDataPackageV1> | null> {
		try {
			const raw = this.pluginData
				? await this.pluginData.loadData()
				: await this.loadPackageFromAdapter();
			if (!isRecord(raw)) {
				diagnostics.warnings.push('Canonical data package is missing or is not an object');
				this.suspendWritesForReadFailure('Canonical data package is missing or is not an object');
				return null;
			}
			recordDomainDiagnostics(raw, diagnostics);
			return raw;
		} catch (error) {
			diagnostics.malformedPackage = true;
			const message = error instanceof Error ? error.message : String(error);
			diagnostics.warnings.push(message);
			this.suspendWritesForReadFailure(`Canonical data package could not be read safely: ${message}`);
			return null;
		}
	}

	private async backupCanonicalDataPackageNow(raw: unknown): Promise<string> {
		try {
			const serialized = await this.readCanonicalBackupSource(raw);
			return await this.writeVerifiedBackup(serialized);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.suspendWrites(`data.json backup failed: ${message}`);
			throw error;
		}
	}

	private async writeVerifiedBackup(serialized: string): Promise<string> {
		const backupPath = await preserveInvalidJsonFile(this.adapter, this.paths.dataPackagePath, serialized);
		try {
			const verified = await this.adapter.read(backupPath);
			if (verified !== serialized) {
				throw new Error('Canonical data package backup verification failed');
			}
			return backupPath;
		} catch (error) {
			try {
				await this.adapter.remove(backupPath);
			} catch {
				// Preserve the verification failure; writes remain suspended by the caller.
			}
			throw error;
		}
	}

	private suspendForUnsupportedDeveloperApiGrantPackage(): void {
		if (!this.unsupportedDeveloperApiGrantPackage) {
			this.suspensionBeforeUnsupportedDeveloperApiGrantPackage = {
				writesSuspended: this.writesSuspended,
				writeSuspensionReason: this.writeSuspensionReason,
				writeSuspensionRequiresExplicitRecovery: this.writeSuspensionRequiresExplicitRecovery,
			};
		}
		this.unsupportedDeveloperApiGrantPackage = true;
		this.writesSuspended = true;
		this.writeSuspensionReason = 'Unsupported future Developer API grant package version';
		this.writeSuspensionRequiresExplicitRecovery = true;
	}

	private suspendForUnsupportedTaskCreationProfilePackage(): void {
		if (!this.unsupportedTaskCreationProfilePackage) {
			this.suspensionBeforeUnsupportedTaskCreationProfilePackage = {
				writesSuspended: this.writesSuspended,
				writeSuspensionReason: this.writeSuspensionReason,
				writeSuspensionRequiresExplicitRecovery: this.writeSuspensionRequiresExplicitRecovery,
			};
		}
		this.unsupportedTaskCreationProfilePackage = true;
		this.writesSuspended = true;
		this.writeSuspensionReason = 'Unsupported future Task Creation Profile package version';
		this.writeSuspensionRequiresExplicitRecovery = true;
	}

	private clearUnsupportedTaskCreationProfilePackageSuspension(): void {
		if (!this.unsupportedTaskCreationProfilePackage) return;
		this.unsupportedTaskCreationProfilePackage = false;
		const previous = this.suspensionBeforeUnsupportedTaskCreationProfilePackage;
		this.suspensionBeforeUnsupportedTaskCreationProfilePackage = null;
		this.writesSuspended = previous?.writesSuspended ?? false;
		this.writeSuspensionReason = previous?.writeSuspensionReason ?? null;
		this.writeSuspensionRequiresExplicitRecovery = previous?.writeSuspensionRequiresExplicitRecovery ?? false;
	}

	private clearUnsupportedDeveloperApiGrantPackageSuspension(): void {
		if (!this.unsupportedDeveloperApiGrantPackage) return;
		this.unsupportedDeveloperApiGrantPackage = false;
		const previous = this.suspensionBeforeUnsupportedDeveloperApiGrantPackage;
		this.suspensionBeforeUnsupportedDeveloperApiGrantPackage = null;
		this.writesSuspended = previous?.writesSuspended ?? false;
		this.writeSuspensionReason = previous?.writeSuspensionReason ?? null;
		this.writeSuspensionRequiresExplicitRecovery = previous?.writeSuspensionRequiresExplicitRecovery ?? false;
	}

	private async inspectPipelineTaxonomy(rawPackage: Partial<OperonDataPackageV1>): Promise<OperonPipelineTaxonomyDiagnostics> {
		const rawPipelines = isRecord(rawPackage.taxonomy)
			&& isRecord(rawPackage.taxonomy.pipelines)
			? rawPackage.taxonomy.pipelines.pipelines
			: undefined;
		const validation = validatePipelineTaxonomy(rawPipelines);
		const diagnostics: OperonPipelineTaxonomyDiagnostics = {
			...validation,
			issues: validation.issues.map(issue => ({ ...issue })),
			backupPath: null,
			backupFailed: false,
			warnings: [],
		};
		if (!validation.hasDestructiveIssues) return diagnostics;
		try {
			diagnostics.backupPath = await this.backupCanonicalDataPackageNow(rawPackage);
		} catch (error) {
			diagnostics.backupFailed = true;
			diagnostics.warnings.push(error instanceof Error ? error.message : String(error));
		}
		return diagnostics;
	}

	private async readCanonicalBackupSource(fallback: unknown): Promise<string> {
		if (await this.adapter.exists(this.paths.dataPackagePath)) {
			return this.adapter.read(this.paths.dataPackagePath);
		}
		if (typeof fallback === 'string') return fallback;
		const serialized = JSON.stringify(fallback, null, '\t');
		if (typeof serialized !== 'string') {
			throw new Error('Canonical data package backup source could not be serialized');
		}
		return serialized;
	}

	private async persistCandidate(dataPackage: OperonDataPackageV1): Promise<void> {
		if (this.writesSuspended) {
			throw new Error(`Operon data package writes are suspended: ${this.writeSuspensionReason ?? 'data.json could not be read safely'}`);
		}
		if (this.pluginData) {
			await this.pluginData.saveData(this.cloneDataPackage(dataPackage));
		} else {
			await writeTextSafely(this.adapter, this.paths.dataPackagePath, JSON.stringify(dataPackage, null, '\t'));
		}
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.saveQueue.then(operation);
		this.saveQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private suspendWritesForReadFailure(reason: string): void {
		this.writesSuspended = true;
		this.writeSuspensionReason = reason;
		this.writeSuspensionRequiresExplicitRecovery = false;
	}

	private setDataPackage(dataPackage: OperonDataPackageV1): void {
		this.dataPackage = this.cloneDataPackage(dataPackage);
		this.dataPackageSignature = buildStableJsonSignature(this.dataPackage);
	}

	private cloneDataPackage(dataPackage: OperonDataPackageV1): OperonDataPackageV1 {
		const parsed: unknown = JSON.parse(JSON.stringify(dataPackage));
		return parsed as OperonDataPackageV1;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildTaskCreationProfileV2MigrationCandidate(
	canonicalBase: OperonDataPackageV1,
	normalizationSource: OperonDataPackageV1,
	defaults: OperonSettings,
	normalizeAllSettings = false,
): OperonDataPackageV1 {
	if (normalizeAllSettings) {
		return buildNormalizedSettingsMigrationCandidate(canonicalBase, normalizationSource, defaults);
	}
	const normalizedPackage = buildOperonDataPackageFromSettings(
		composeOperonSettingsFromDataPackage(normalizationSource, defaults),
	);
	const normalizedProfile = normalizedPackage.ui.taskCreationProfile;
	const normalizedKeys = new Set(Object.keys(normalizedProfile));
	const unknownProfileFields = Object.fromEntries(
		Object.entries(canonicalBase.ui.taskCreationProfile).filter(([key]) => !normalizedKeys.has(key)),
	);
	return {
		...canonicalBase,
		settings: {
			...canonicalBase.settings,
			settingsVersion: defaults.settingsVersion,
		},
		ui: {
			...canonicalBase.ui,
			taskCreationProfile: {
				...normalizedProfile,
				...unknownProfileFields,
			},
		},
		automation: {
			...canonicalBase.automation,
			taskAutomationPolicy: {
				...canonicalBase.automation.taskAutomationPolicy,
				...normalizedPackage.automation.taskAutomationPolicy,
			},
		},
	};
}

function readTaskCreationProfilePackageVersion(
	dataPackage: Partial<OperonDataPackageV1> | null | undefined,
): number | null {
	const ui = dataPackage?.ui;
	if (!isRecord(ui) || !isRecord(ui.taskCreationProfile)) return null;
	const version = ui.taskCreationProfile.version;
	return typeof version === 'number' && Number.isInteger(version) && version >= 0
		? version
		: null;
}

function hasUnsupportedFutureTaskCreationProfilePackage(
	dataPackage: Partial<OperonDataPackageV1> | null | undefined,
): boolean {
	const version = readTaskCreationProfilePackageVersion(dataPackage);
	return version !== null && version > OPERON_TASK_CREATION_PROFILE_PACKAGE_VERSION;
}

function requiresTaskCreationProfilePackageMigration(
	dataPackage: Partial<OperonDataPackageV1>,
): boolean {
	return readTaskCreationProfilePackageVersion(dataPackage)
		!== OPERON_TASK_CREATION_PROFILE_PACKAGE_VERSION;
}

function createTablePresetRecoveryDiagnostics(): OperonTablePresetRecoveryDiagnostics {
	return {
		status: 'not-needed',
		code: null,
		backupPath: null,
		strategy: null,
		completedLegacySidecarRetirementThisStartup: false,
	};
}

function createRecoveredTablePresetRecoveryDiagnostics(
	backupPath: string,
	strategy: OperonTablePresetRecoveryDiagnostics['strategy'] = null,
	completedLegacySidecarRetirementThisStartup = false,
): OperonTablePresetRecoveryDiagnostics {
	return {
		status: 'recovered',
		code: null,
		backupPath,
		strategy,
		completedLegacySidecarRetirementThisStartup,
	};
}

async function getTableRecoveryCandidateSha256(value: unknown): Promise<string> {
	return await sha256HexForStorage(buildStableJsonSignature(value));
}

async function stablePackageSha256(value: unknown): Promise<string> {
	return await sha256HexForStorage(buildStableJsonSignature(value));
}

function isTaskCreationProfileV2RecoveryMarker(
	value: unknown,
): value is OperonTaskCreationProfileV2RecoveryMarkerV1 {
	return isRecord(value)
		&& value.version === 1
		&& (value.phase === 'prepared' || value.phase === 'committed')
		&& isSha256(value.sourceSignature)
		&& isSha256(value.candidateSignature)
		&& typeof value.backupPath === 'string'
		&& value.backupPath.length > 0
		&& isCompleteDataPackage(value.candidate);
}

function isTableManifestV2RecoveryMarker(value: unknown): value is OperonTableManifestV2RecoveryMarker {
	return isTableManifestV2RecoveryMarkerV1(value) || isTableManifestV2RecoveryMarkerV2(value);
}

function isTableManifestV2RecoveryMarkerV1(value: unknown): value is OperonTableManifestV2RecoveryMarkerV1 {
	if (!isRecord(value)
		|| value.version !== 1
		|| (value.phase !== 'prepared' && value.phase !== 'committed')
		|| !isSha256(value.sourceSha256)
		|| !isSha256(value.candidateSha256)
		|| typeof value.backupPath !== 'string'
		|| !value.backupPath
		|| !Array.isArray(value.presetIds)
		|| !Array.isArray(value.bindings)) return false;
	if (!value.presetIds.every(id => typeof id === 'string' && id.length > 0)) return false;
	return value.bindings.every(binding => isRecord(binding)
		&& typeof binding.id === 'string'
		&& binding.id.length > 0
		&& typeof binding.path === 'string'
		&& binding.path.length > 0);
}

function isTableManifestV2RecoveryMarkerV2(value: unknown): value is OperonTableManifestV2RecoveryMarkerV2 {
	if (!isRecord(value)
		|| value.version !== 2
		|| value.strategy !== 'retire-legacy-sidecar-authority'
		|| (value.phase !== 'prepared' && value.phase !== 'committed')
		|| !isSha256(value.sourceSha256)
		|| !isSha256(value.candidateSha256)
		|| typeof value.backupPath !== 'string'
		|| !value.backupPath
		|| !isRecord(value.legacySidecars)
		|| !isRecord(value.legacySidecars.index)
		|| typeof value.legacySidecars.index.path !== 'string'
		|| !value.legacySidecars.index.path
		|| !isSha256(value.legacySidecars.index.sha256)
		|| !Array.isArray(value.legacySidecars.presets)) return false;
	const seenIds = new Set<string>();
	return value.legacySidecars.presets.every(preset => {
		if (!isRecord(preset)
			|| typeof preset.id !== 'string'
			|| !preset.id
			|| seenIds.has(preset.id)
			|| typeof preset.path !== 'string'
			|| !preset.path
			|| !isSha256(preset.sha256)) return false;
		seenIds.add(preset.id);
		return true;
	});
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isCompleteDataPackage(value: unknown): value is OperonDataPackageV1 {
	return isStructurallyCompleteOperonDataPackageV1(value);
}

function isUnrecognizableCanonicalDataPackage(value: unknown): boolean {
	if (!isRecord(value) || isCompleteDataPackage(value)) return false;
	return !Object.prototype.hasOwnProperty.call(value, 'schemaVersion')
		&& !Object.prototype.hasOwnProperty.call(value, 'settings')
		&& !Object.prototype.hasOwnProperty.call(value, 'settingsVersion');
}

function createReloadDiagnostics(): OperonDataPackageReloadDiagnostics {
	return {
		malformedPackage: false,
		missingDomains: [],
		invalidDomains: [],
		warnings: [],
		pipelineTaxonomy: createPipelineTaxonomyDiagnostics(),
	};
}

function createPipelineTaxonomyDiagnostics(): OperonPipelineTaxonomyDiagnostics {
	return {
		issues: [],
		hasDestructiveIssues: false,
		hasIdentityIssues: false,
		backupPath: null,
		backupFailed: false,
		warnings: [],
	};
}

function clonePipelineTaxonomyDiagnostics(
	diagnostics: OperonPipelineTaxonomyDiagnostics,
): OperonPipelineTaxonomyDiagnostics {
	return {
		...diagnostics,
		issues: diagnostics.issues.map(issue => ({ ...issue })),
		warnings: [...diagnostics.warnings],
	};
}

function recordDomainDiagnostics(
	raw: Record<string, unknown>,
	diagnostics: OperonDataPackageReloadDiagnostics,
): void {
	for (const domain of DATA_PACKAGE_DOMAINS) {
		if (!Object.prototype.hasOwnProperty.call(raw, domain)) {
			diagnostics.missingDomains.push(domain);
			continue;
		}
		if (!isValidDataPackageDomain(domain, raw[domain])) {
			diagnostics.invalidDomains.push(domain);
		}
	}
}

function isValidDataPackageDomain(domain: OperonDataPackageDomain, value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (domain === 'settings') return true;
	if (domain === 'taxonomy') {
		return isRecord(value.keyMappings)
			&& isRecord(value.priorities)
			&& isRecord(value.pipelines);
	}
	if (domain === 'views') {
		return isRecord(value.filters)
			&& isRecord(value.calendarPresets)
			&& isRecord(value.kanbanPresets)
			&& (!Object.prototype.hasOwnProperty.call(value, 'tablePresets') || isRecord(value.tablePresets))
			&& isRecord(value.kanbanOrder);
	}
	if (domain === 'ui') {
		return isRecord(value.contextualMenu)
			&& isRecord(value.taskUiPreferences)
			&& isRecord(value.taskCreationProfile)
			&& (
				!Object.prototype.hasOwnProperty.call(value, 'presetFavorites')
				|| isRecord(value.presetFavorites)
			)
			&& (
				!Object.prototype.hasOwnProperty.call(value, 'workspaceTweaks')
				|| isRecord(value.workspaceTweaks)
			);
	}
	if (domain === 'automation') {
		return isRecord(value.taskAutomationPolicy);
	}
	if (domain === 'integrations') {
		return isRecord(value.externalCalendarSources)
			&& (!Object.prototype.hasOwnProperty.call(value, 'mobileNotifications') || isRecord(value.mobileNotifications));
	}
	return isRecord(value.pinnedTasks);
}

function buildFallbackDataPackage(defaults: OperonSettings): OperonDataPackageV1 {
	return buildOperonDataPackageFromSettings(defaults);
}

function migrateLegacySettingsPackage(
	dataPackage: Partial<OperonDataPackageV1>,
	obsidianLocale?: string,
): Partial<OperonDataPackageV1> {
	const languageMigrated = migrateLegacyLanguageSettings(
		dataPackage.settings,
		obsidianLocale,
	);
	const legacyArchiveRouting = isLegacyArchiveRoutingSettings(dataPackage.settings);
	return {
		...dataPackage,
		// Keep the source version until ordinary settings normalization has run.
		// Advancing it here would skip unrelated version-gated migrations.
		settings: languageMigrated as OperonDataPackageV1['settings'],
		automation: legacyArchiveRouting
			? {
				...dataPackage.automation,
				taskAutomationPolicy: migrateLegacyArchiveRoutingPolicy(dataPackage.automation?.taskAutomationPolicy),
			}
			: dataPackage.automation,
	};
}

function preserveLegacyReloadSettingsIntent(
	incoming: Partial<OperonDataPackageV1>,
	current: OperonDataPackageV1,
): Partial<OperonDataPackageV1> {
	const languageSafeSettings = preserveCanonicalLanguageForLegacyReload(
		incoming.settings,
		current.settings,
	);
	const legacyArchiveRouting = isLegacyArchiveRoutingSettings(incoming.settings);
	return {
		...incoming,
		// A delayed legacy package must retain its source version long enough for
		// every historic migration to run. Its archive policy is restored below
		// only after that normalization has completed.
		settings: languageSafeSettings as OperonDataPackageV1['settings'],
		automation: legacyArchiveRouting
			? {
				...incoming.automation,
				taskAutomationPolicy: preserveCanonicalArchiveRoutingPolicy(
					incoming.automation?.taskAutomationPolicy,
					current.automation.taskAutomationPolicy,
				),
			}
			: incoming.automation,
	};
}

/**
 * Canonicalize all settings-backed domains without replacing package-owned
 * runtime state or unknown fields. This is the point at which a legacy source
 * can legitimately become the current settings version.
 */
function buildNormalizedSettingsMigrationCandidate(
	canonicalBase: OperonDataPackageV1,
	normalizationSource: OperonDataPackageV1,
	defaults: OperonSettings,
): OperonDataPackageV1 {
	const normalizedSettings = composeOperonSettingsFromDataPackage(normalizationSource, defaults);
	return buildSettingsMigrationCandidateFromNormalizedSettings(canonicalBase, normalizedSettings);
}

function buildLegacyArchiveReloadMigrationCandidate(
	canonicalBase: OperonDataPackageV1,
	current: OperonDataPackageV1,
	defaults: OperonSettings,
): OperonDataPackageV1 {
	// Compose the old source first so unrelated version gates run. `migrateSettings`
	// intentionally clears pre-v114 archive targets, so restore the already-canonical
	// target policy only after that pass.
	const normalizedSettings = composeOperonSettingsFromDataPackage(canonicalBase, defaults);
	const currentSettings = composeOperonSettingsFromDataPackage(current, defaults);
	normalizedSettings.fileTaskArchiveFolder = currentSettings.fileTaskArchiveFolder;
	normalizedSettings.fileTaskArchivePipelineLocations = currentSettings.fileTaskArchivePipelineLocations
		.map(rule => ({ ...rule }));
	normalizedSettings.fileTaskAutoArchiveEnabled = currentSettings.fileTaskAutoArchiveEnabled;
	normalizedSettings.fileTaskArchiveDelaySeconds = currentSettings.fileTaskArchiveDelaySeconds;
	normalizedSettings.fileTaskArchiveOnlyFromFileTasksFolder = currentSettings.fileTaskArchiveOnlyFromFileTasksFolder;
	return buildSettingsMigrationCandidateFromNormalizedSettings(canonicalBase, normalizedSettings);
}

function buildSettingsMigrationCandidateFromNormalizedSettings(
	canonicalBase: OperonDataPackageV1,
	normalizedSettings: OperonSettings,
): OperonDataPackageV1 {
	const normalizedPackage = buildOperonDataPackageFromSettings(normalizedSettings);
	const { presetFavorites: _unusedPresetFavorites, ...uiWithoutPresetFavorites } = normalizedPackage.ui;
	const normalizedUi = canonicalBase.ui.presetFavorites
		? normalizedPackage.ui
		: uiWithoutPresetFavorites;
	const normalizedIntegrations = { ...normalizedPackage.integrations };
	// Optional integration slices did not exist in every supported source
	// package. Keep their absence intact so the generic overlay never attempts
	// to JSON-clone an undefined placeholder.
	if (Object.prototype.hasOwnProperty.call(canonicalBase.integrations, 'mobileNotifications')) {
		normalizedIntegrations.mobileNotifications = canonicalBase.integrations.mobileNotifications;
	} else {
		delete (normalizedIntegrations as Record<string, unknown>).mobileNotifications;
	}
	if (Object.prototype.hasOwnProperty.call(canonicalBase.integrations, 'developerApi')) {
		normalizedIntegrations.developerApi = canonicalBase.integrations.developerApi;
	} else {
		delete (normalizedIntegrations as Record<string, unknown>).developerApi;
	}
	return overlayKnownDataPackageFieldsPreservingUnknownV1(canonicalBase, {
		...normalizedPackage,
		views: {
			...normalizedPackage.views,
			kanbanOrder: canonicalBase.views.kanbanOrder,
		},
		ui: normalizedUi,
		integrations: normalizedIntegrations,
		state: {
			...normalizedPackage.state,
			pinnedTasks: canonicalBase.state.pinnedTasks,
		},
	});
}

function isLegacyArchiveRoutingSettings(value: unknown): boolean {
	if (!isRecord(value)) return true;
	const version = typeof value.settingsVersion === 'number' && Number.isFinite(value.settingsVersion)
		? Math.floor(value.settingsVersion)
		: 0;
	return version < FILE_TASK_ARCHIVE_ROUTING_SETTINGS_VERSION;
}

function migrateLegacyArchiveRoutingPolicy(
	value: unknown,
): OperonDataPackageV1['automation']['taskAutomationPolicy'] {
	const rawPolicy = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const policy = rawPolicy as Partial<OperonDataPackageV1['automation']['taskAutomationPolicy']>;
	return {
		...rawPolicy,
		version: typeof policy.version === 'number' && Number.isFinite(policy.version) ? policy.version : 1,
		fileTaskAutoArchiveEnabled: false,
		fileTaskArchiveFolder: '',
		fileTaskArchivePipelineLocations: [],
		fileTaskArchiveDelaySeconds: FILE_TASK_ARCHIVE_DELAY_SECONDS,
		fileTaskArchiveOnlyFromFileTasksFolder: false,
	} as unknown as OperonDataPackageV1['automation']['taskAutomationPolicy'];
}

function preserveCanonicalArchiveRoutingPolicy(
	incoming: unknown,
	current: OperonDataPackageV1['automation']['taskAutomationPolicy'],
): OperonDataPackageV1['automation']['taskAutomationPolicy'] {
	const rawPolicy = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
		? incoming as Record<string, unknown>
		: {};
	const policy = rawPolicy as Partial<OperonDataPackageV1['automation']['taskAutomationPolicy']>;
	return {
		...rawPolicy,
		version: typeof policy.version === 'number' && Number.isFinite(policy.version) ? policy.version : current.version,
		fileTaskAutoArchiveEnabled: current.fileTaskAutoArchiveEnabled,
		fileTaskArchiveFolder: current.fileTaskArchiveFolder,
		fileTaskArchivePipelineLocations: current.fileTaskArchivePipelineLocations.map(rule => ({ ...rule })),
		fileTaskArchiveDelaySeconds: current.fileTaskArchiveDelaySeconds,
		fileTaskArchiveOnlyFromFileTasksFolder: current.fileTaskArchiveOnlyFromFileTasksFolder,
	} as OperonDataPackageV1['automation']['taskAutomationPolicy'];
}

function shouldNormalizePipelineTaxonomy(
	diagnostics: OperonPipelineTaxonomyDiagnostics,
): boolean {
	return diagnostics.hasDestructiveIssues && !diagnostics.backupFailed;
}

function normalizePipelineTaxonomySlice(
	dataPackage: OperonDataPackageV1,
	defaults: OperonSettings,
): OperonDataPackageV1 {
	const normalizedSettings = composeOperonSettingsFromDataPackage(dataPackage, defaults);
	const normalizedPipelines = buildOperonDataPackageFromSettings(normalizedSettings).taxonomy.pipelines;
	return {
		...dataPackage,
		taxonomy: {
			...dataPackage.taxonomy,
			pipelines: normalizedPipelines,
		},
	};
}

function buildStableJsonSignature(value: unknown): string {
	return JSON.stringify(sortJsonForStableSignature(value));
}

function sortJsonForStableSignature(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonForStableSignature);
	if (!isRecord(value)) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
		sorted[key] = sortJsonForStableSignature(value[key]);
	}
	return sorted;
}
