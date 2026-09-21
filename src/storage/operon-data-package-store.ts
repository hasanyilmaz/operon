import { prepareSettingsVersionBackup } from './settings-version-backup';
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
	CURRENT_SETTINGS_VERSION,
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
	buildRecoveredTablePresetDataPackageV1,
	overlayKnownDataPackageFieldsPreservingUnknownV1,
	preflightTablePresetManifestRecoveryV1,
	type TablePresetManifestRecoveryBlockCode,
	type TablePresetManifestRecoveryFileEvidence,
} from './table-preset-manifest-recovery';
import {
	getOperonTableFilePathKey,
	normalizeOperonTableFilePath,
} from './table-file';
import { isSafeVaultRelativeFolderPath } from '../core/settings-folder-rules';
import { TABLE_PRESET_MANIFEST_VERSION } from './table-preset-manifest';

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
	| 'degraded'
	| 'blocked'
	| 'failed-clean'
	| 'commit-state-unknown';

export interface OperonTablePresetRecoveryDiagnostics {
	health: 'ready' | 'repaired' | 'degraded';
	status: OperonTablePresetRecoveryStatus;
	code: TablePresetManifestRecoveryBlockCode | 'backup-failed' | 'marker-invalid' | 'marker-write-failed'
		| 'marker-finalization-failed' | 'canonical-read-drift' | 'canonical-write-failed' | 'canonical-state-unknown' | null;
	backupPath: string | null;
	detailCode?: string | null;
	affectedPaths?: string[];
	repairBackupPath?: string | null;
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

type OperonTableManifestV2RecoveryMarker = OperonTableManifestV2RecoveryMarkerV1;

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
	// Only disk observations establish this precondition; normalization never does.
	private canonicalSource: string | null | undefined;
	private suspensionNotified = false;
	private versionBackupBlocked = false;
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
		private readonly adapter: Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'>
			& Partial<Pick<DataAdapter, 'process' | 'rename' | 'mkdir' | 'list'>>
			& { writeExclusive?: (path: string, data: string) => Promise<void> },
		private readonly paths: OperonStoragePaths,
		private readonly pluginData: PluginDataAccess,
		private readonly discoverTableRecoveryFiles?: OperonTablePresetRecoveryDiscovery,
		private readonly onWritesSuspended?: () => void,
		private readonly pluginVersion?: string,
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
		if (this.pluginVersion) {
			this.versionBackupBlocked = true;
			try {
				if (this.writesSuspended || this.canonicalSource === undefined
					|| existingPackage && (!isVersionBackupSourceSupported(existingPackage, defaults)
						|| hasUnsupportedFutureTaskCreationProfilePackage(existingPackage)
						|| isUnsupportedDeveloperApiGrantPackage(existingPackage.integrations?.developerApi))) {
					throw new Error('Settings source is not safe for a version backup');
				}
				await prepareSettingsVersionBackup(this.adapter, this.paths.pluginDir,
					this.paths.dataPackagePath, this.canonicalSource, this.pluginVersion);
				this.versionBackupBlocked = false;
			} catch {
				this.suspendWrites('Automatic settings backup could not be verified; restart after resolving the storage problem');
			}
		}
		if (existingPackage && !this.writesSuspended) existingPackage = await this.reconcileTaskCreationProfileV2Recovery(existingPackage);
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
		if (existingPackage && !this.writesSuspended && !existingCanonicalPackageUnrecognizable
			&& !unsupportedDeveloperApiGrantPackage && !unsupportedTaskCreationProfilePackage) {
			const recovery = await this.enqueueMutation(async () => {
				try {
					return await this.recoverTablePresetManifestV2Now(existingPackage!);
				} catch {
					const observed = await this.readCanonicalDataPackageForObservation();
					if (observed) return this.degradeTableRecovery(observed, 'table-file-invalid', null);
					this.suspendWrites('Table recovery failed with an unknown canonical commit state');
					return this.blockTableRecovery(existingPackage!, 'canonical-state-unknown', null, 'commit-state-unknown');
				}
			});
			existingPackage = recovery.dataPackage;
			tablePresetRecovery = recovery.diagnostics;
		}
		const recoverableDeveloperApiGrantPackageDrift = !unsupportedDeveloperApiGrantPackage
			&& isRecord(existingDeveloperApiGrantPackage)
			&& buildStableJsonSignature(existingDeveloperApiGrantPackage)
				!== buildStableJsonSignature(normalizeDeveloperApiGrantPackage(existingDeveloperApiGrantPackage));
		const unsupportedTablePresetPackage = false;
		this.startupPipelineTaxonomyDiagnostics = existingPackage && this.canonicalSource !== undefined
			&& !unsupportedTaskCreationProfilePackage && !this.versionBackupBlocked
			? await this.inspectPipelineTaxonomy(existingPackage)
			: createPipelineTaxonomyDiagnostics();
		const migratedExistingPackage = existingPackage
			? migrateLegacySettingsPackage(existingPackage, obsidianLocale)
			: null;
		const archiveRoutingMigrationRequired = !!existingPackage
			&& isLegacyArchiveRoutingSettings(existingPackage.settings);
		const dataPackageSchemaMigrationRequired = !!existingPackage
			&& existingPackage.schemaVersion !== OPERON_DATA_PACKAGE_SCHEMA_VERSION;
		const hasRetiredSettings = hasRetiredOperonDataPackageSettings(existingPackage);
		const mergedPackage = mergeOperonDataPackage(migratedExistingPackage, buildFallbackDataPackage(defaults));
		const normalizedPackage = shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
			? normalizePipelineTaxonomySlice(mergedPackage, defaults)
			: mergedPackage;
		const baseDataPackage = existingPackage
			&& existingPackage.schemaVersion === OPERON_DATA_PACKAGE_SCHEMA_VERSION
			&& tablePresetRecovery.health !== 'ready'
			? preserveTableManifestForDegradedRecovery(
				existingPackage,
				overlayKnownDataPackageFieldsPreservingUnknownV1(existingPackage, normalizedPackage),
				tablePresetRecovery.health === 'degraded',
			)
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
		if (existingPackage && !this.writesSuspended && tablePresetRecovery.health !== 'degraded' && !unsupportedDeveloperApiGrantPackage
			&& !unsupportedTaskCreationProfilePackage
			&& (
				shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
					|| dataPackageSchemaMigrationRequired
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
		return !this.writesSuspended && !this.versionBackupBlocked;
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
		this.notifyWriteSuspension();
	}

	resumeWrites(): void {
		if (this.canonicalSource === undefined || this.versionBackupBlocked) return;
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
		this.suspensionNotified = false;
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
				// An explicit recovery backup must still describe the current source.
				const current = await this.readCanonicalSource();
				if (current !== serialized) throw new Error('Canonical recovery source changed after backup');
				// A backup alone cannot pair a new disk preimage with stale cached settings.
				if (current === this.canonicalSource) this.resumeWrites();
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
			let adopted = false;
			try {
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
					this.canonicalSource = undefined;
					if (!this.writesSuspended) this.suspendWrites('Canonical reload could not commit its settings snapshot');
					staged?.rollback();
					throw error;
				}
				adopted = true;
				return {
					dataPackage: this.cloneDataPackage(dataPackage),
					changed: packageChanged || staged?.changed === true,
					diagnostics,
				};
			} finally {
				// No aborted reload may attach an external preimage to our old cache.
				if (!adopted) {
					this.canonicalSource = undefined;
					if (!this.writesSuspended) this.suspendWrites('Canonical reload did not adopt its settings snapshot');
				}
			}
		});
	}

	async replaceDataPackage(dataPackage: OperonDataPackageV1): Promise<void> {
		const candidate = this.cloneDataPackage(dataPackage);
		await this.enqueueMutation(async () => {
			if (await this.isCommittedCandidate(candidate)) return;
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
			if (await this.isCommittedCandidate(candidate)) return { status: 'unchanged', dataPackage: previous };
			try {
				const acknowledgementFailed = await this.persistCandidate(candidate);
				this.setDataPackage(candidate);
				return { status: acknowledgementFailed ? 'committed-after-error' : 'committed', dataPackage: this.cloneDataPackage(candidate) };
			} catch {
				const observed = await this.readCanonicalDataPackageForObservation();
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
			if (await this.isCommittedCandidate(next)) return;
			await this.persistCandidate(next);
			this.setDataPackage(next);
		});
	}

	async updateDataPackageCas(mutator: (dataPackage: OperonDataPackageV1) => OperonDataPackageV1, canCommit: () => boolean = () => true): Promise<void> {
		await this.enqueueMutation(async () => {
			this.assertWritesAllowed();
			if (!canCommit()) throw new Error('Settings operation cancelled');
			const source: unknown = typeof this.canonicalSource === 'string' ? JSON.parse(this.canonicalSource) : null;
			if (!isCompleteDataPackage(source)) throw new Error('Canonical settings are unavailable for a conditional update');
			const candidate = this.cloneDataPackage(mutator(source));
			if (await this.isCommittedCandidate(candidate)) return;
			await this.persistCandidate(candidate, canCommit);
			this.setDataPackage(candidate);
		});
	}

	async drain(): Promise<void> {
		await this.saveQueue;
	}

	async canReadCanonicalDataPackage(): Promise<boolean> {
		await this.saveQueue;
		return await this.readCanonicalDataPackageForObservation() !== null;
	}

	private async recoverTablePresetManifestV2Now(
		existingPackage: Partial<OperonDataPackageV1>,
	): Promise<TableRecoveryAttemptResult> {
		if (existingPackage.schemaVersion !== OPERON_DATA_PACKAGE_SCHEMA_VERSION) {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		const markerRead = await this.readTableManifestV2RecoveryMarker();
		if (markerRead.status === 'invalid') {
			return this.degradeTableRecovery(existingPackage, 'marker-invalid', null);
		}
		if (markerRead.status === 'missing' && !isUnsupportedTablePresetPackage(existingPackage)) {
			const preflight = preflightTablePresetManifestRecoveryV1(existingPackage, []);
			if (preflight.status === 'not-needed') {
				return await this.inspectCurrentTablePresetHealth(existingPackage);
			}
			if (preflight.status === 'blocked') {
				return preflight.code === 'data-package-invalid'
					? this.blockTableRecovery(existingPackage, preflight.code, null, 'blocked')
					: this.degradeTableRecovery(existingPackage, preflight.code, null);
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
			if (!isCompleteDataPackage(parsedSource)) {
				this.suspendWrites('Table recovery observed an unreadable canonical package during startup');
				return this.blockTableRecovery(existingPackage, 'canonical-read-drift', null, 'commit-state-unknown');
			}
			return this.degradeTableRecovery(
				parsedSource,
				'canonical-read-drift',
				null,
			);
		}
		if (parsedSource.schemaVersion !== OPERON_DATA_PACKAGE_SCHEMA_VERSION) {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		const sourceSha256 = await sha256HexForStorage(rawSource);
		if (markerRead.status === 'valid') {
			const marker = markerRead.marker;
			const expectedBackupPath = this.getTableRecoveryBackupPath(marker.sourceSha256);
			if (marker.backupPath !== expectedBackupPath) {
				return this.degradeTableRecovery(existingPackage, 'marker-invalid', null);
			}
			if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256)) {
				return this.degradeTableRecovery(existingPackage, 'backup-failed', marker.backupPath);
			}
			if (marker.phase === 'committed') {
				const current = preflightTablePresetManifestRecoveryV1(parsedSource, []);
				if (current.status !== 'not-needed' || current.reason !== 'current') {
					return this.degradeTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath);
				}
				const health = await this.inspectCurrentTablePresetHealth(parsedSource);
				if (health.diagnostics.health === 'degraded') return health;
				return {
					dataPackage: parsedSource,
					diagnostics: createRecoveredTablePresetRecoveryDiagnostics(marker.backupPath),
				};
			}
			if (await getTableRecoveryCandidateSha256(parsedSource) === marker.candidateSha256) {
				if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
					return this.degradeTableRecovery(existingPackage, 'marker-finalization-failed', marker.backupPath);
				}
				const health = await this.inspectCurrentTablePresetHealth(parsedSource);
				if (health.diagnostics.health === 'degraded') return health;
				return {
					dataPackage: parsedSource,
					diagnostics: createRecoveredTablePresetRecoveryDiagnostics(marker.backupPath),
				};
			}
			if (sourceSha256 !== marker.sourceSha256) {
				if (hasAppliedTableRecoveryManifest(parsedSource, marker.presetIds, marker.bindings)) {
					this.suspendWrites('Table manifest v2 recovery canonical commit state could not be verified');
					return this.blockTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
				}
				return this.degradeTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath);
			}
			if (!await this.verifyImmutableTableRecoveryBackup(marker.backupPath, marker.sourceSha256, rawSource)) {
				return this.degradeTableRecovery(existingPackage, 'backup-failed', marker.backupPath);
			}
			const resumed = await this.buildTableRecoveryCandidate(parsedSource);
			if (resumed.status !== 'recoverable') {
				return this.degradeTableRecovery(
					existingPackage,
					resumed.status === 'blocked' ? resumed.code : 'canonical-state-unknown',
					marker.backupPath,
				);
			}
			const candidate = buildRecoveredTablePresetDataPackageV1(parsedSource, resumed);
			if (await getTableRecoveryCandidateSha256(candidate) !== marker.candidateSha256
				|| buildStableJsonSignature(resumed.presetIds) !== buildStableJsonSignature(marker.presetIds)
				|| buildStableJsonSignature(resumed.bindings) !== buildStableJsonSignature(marker.bindings)) {
				return this.degradeTableRecovery(existingPackage, 'canonical-state-unknown', marker.backupPath);
			}
			return await this.commitTableRecoveryCandidate(parsedSource, candidate, marker);
		}

		const preflight = await this.buildTableRecoveryCandidate(parsedSource);
		if (preflight.status === 'not-needed') {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		if (preflight.status === 'blocked' || preflight.status === 'degraded') {
			return preflight.status === 'degraded'
				? this.degradeTableRecovery(existingPackage, preflight.code, null)
				: this.blockTableRecovery(existingPackage, preflight.code, null, 'blocked');
		}
		const candidate = buildRecoveredTablePresetDataPackageV1(parsedSource, preflight);
		const backupPath = this.getTableRecoveryBackupPath(sourceSha256);
		try {
			await this.writeImmutableTableRecoveryBackup(backupPath, rawSource);
		} catch {
			return this.degradeTableRecovery(existingPackage, 'backup-failed', backupPath);
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
			return this.degradeTableRecovery(existingPackage, 'marker-write-failed', backupPath);
		}
		return await this.commitTableRecoveryCandidate(parsedSource, candidate, marker);
	}

	private async inspectCurrentTablePresetHealth(
		existingPackage: Partial<OperonDataPackageV1>,
	): Promise<TableRecoveryAttemptResult> {
		if (!this.discoverTableRecoveryFiles || !isRecord(existingPackage.views)
			|| !isRecord(existingPackage.views.tablePresets)) {
			return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
		}
		let files: TablePresetManifestRecoveryFileEvidence[];
		try {
			files = await this.discoverTableRecoveryFiles();
		} catch {
			return this.degradeTableRecovery(existingPackage, 'table-file-invalid', null);
		}
		const manifest = existingPackage.views.tablePresets;
		const validFilesById = new Map<string, number>();
		for (const file of files) {
			if (file.status === 'invalid' || !file.presetId) continue;
			validFilesById.set(file.presetId, (validFilesById.get(file.presetId) ?? 0) + 1);
		}
		const hasDuplicate = [...validFilesById.values()].some(count => count > 1);
		const bindings = Array.isArray(manifest.fileBindings)
			? manifest.fileBindings.filter((binding): binding is { id: string; path: string } =>
				isRecord(binding) && typeof binding.id === 'string' && typeof binding.path === 'string')
			: [];
		for (const binding of bindings) {
			const boundFile = files.find(file => file.status !== 'invalid'
				&& getOperonTableFilePathKey(file.path) === getOperonTableFilePathKey(binding.path)
				&& file.presetId === binding.id);
			if (!boundFile) return this.degradeTableRecovery(existingPackage, 'table-file-missing', null);
		}
		if (hasDuplicate) return { dataPackage: existingPackage, diagnostics: createRecoveredTablePresetRecoveryDiagnostics(null) };
		if (files.some(file => file.status === 'invalid')) {
			return this.degradeTableRecovery(existingPackage, 'table-file-invalid', null);
		}
		return { dataPackage: existingPackage, diagnostics: createTablePresetRecoveryDiagnostics() };
	}

	private async buildTableRecoveryCandidate(dataPackage: unknown) {
		const withoutFiles = preflightTablePresetManifestRecoveryV1(dataPackage, []);
		if ((withoutFiles.status !== 'blocked' && withoutFiles.status !== 'degraded')
			|| withoutFiles.code !== 'table-file-missing') return withoutFiles;
		if (!this.discoverTableRecoveryFiles) return withoutFiles;
		try {
			return preflightTablePresetManifestRecoveryV1(dataPackage, await this.discoverTableRecoveryFiles());
		} catch {
			return { status: 'blocked' as const, code: 'table-file-invalid' as const };
		}
	}

	private async commitTableRecoveryCandidate(
		previous: unknown,
		candidate: unknown,
		marker: OperonTableManifestV2RecoveryMarker,
	): Promise<TableRecoveryAttemptResult> {
		const previousSignature = buildStableJsonSignature(previous);
		const candidateSignature = buildStableJsonSignature(candidate);
		const before = await this.readCanonicalDataPackageForObservation();
		const beforeSignature = before ? buildStableJsonSignature(before) : null;
		if (beforeSignature !== previousSignature && beforeSignature !== candidateSignature) {
			return this.degradeTableRecovery(
				before ?? previous as Partial<OperonDataPackageV1>,
				'canonical-state-unknown',
				marker.backupPath,
			);
		}
		if (beforeSignature === previousSignature) {
			try {
				await this.persistTableRecoveryCandidateCas(previous, candidate);
			} catch {
				// The observed canonical state below owns acknowledgement classification.
			}
		}
		const observed = await this.readCanonicalDataPackageForObservation();
		if (observed && buildStableJsonSignature(observed) === candidateSignature) {
			const source = await this.readCanonicalSource();
			if (source === null || buildStableJsonSignature(JSON.parse(source)) !== candidateSignature) {
				this.suspendWrites('Canonical settings changed after Table recovery');
				return this.blockTableRecovery(previous as Partial<OperonDataPackageV1>, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
			}
			this.canonicalSource = source;
			if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
				return this.degradeTableRecovery(observed, 'marker-finalization-failed', marker.backupPath);
			}
			return {
				dataPackage: observed,
				diagnostics: createRecoveredTablePresetRecoveryDiagnostics(marker.backupPath),
			};
		}
		if (observed && buildStableJsonSignature(observed) === previousSignature) {
			return this.blockTableRecovery(previous as Partial<OperonDataPackageV1>, 'canonical-write-failed', marker.backupPath, 'failed-clean');
		}
		this.suspendWrites('Table manifest v2 recovery canonical commit state could not be verified');
		return this.blockTableRecovery(previous as Partial<OperonDataPackageV1>, 'canonical-state-unknown', marker.backupPath, 'commit-state-unknown');
	}

	private async persistTableRecoveryCandidateCas(previous: unknown, candidate: unknown): Promise<void> {
		if (!this.adapter.process) throw new Error('Atomic canonical recovery update is unavailable.');
		const previousSignature = buildStableJsonSignature(previous);
		const candidateSignature = buildStableJsonSignature(candidate);
		const candidateSerialized = JSON.stringify(candidate, null, '\t');
		let accepted = false;
		await this.adapter.process(this.paths.dataPackagePath, source => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(source) as unknown;
			} catch {
				return source;
			}
			const signature = buildStableJsonSignature(parsed);
			if (signature === candidateSignature) {
				accepted = true;
				return source;
			}
			if (signature !== previousSignature) return source;
			accepted = true;
			return candidateSerialized;
		});
		if (!accepted) throw new Error('Canonical recovery CAS rejected a divergent source.');
	}

	private blockTableRecovery(
		dataPackage: Partial<OperonDataPackageV1>,
		code: NonNullable<OperonTablePresetRecoveryDiagnostics['code']>,
		backupPath: string | null,
		status: 'blocked' | 'failed-clean' | 'commit-state-unknown',
	): TableRecoveryAttemptResult {
		if (code === 'data-package-invalid') {
			this.suspendWrites(`Table manifest v2 recovery is blocked (${code})`);
		}
		return {
			dataPackage,
				diagnostics: {
				health: 'degraded',
				status: status === 'commit-state-unknown' ? status : 'degraded',
				code,
					backupPath,
					detailCode: null,
			},
		};
	}

	private degradeTableRecovery(
		dataPackage: Partial<OperonDataPackageV1>,
		code: NonNullable<OperonTablePresetRecoveryDiagnostics['code']>,
		backupPath: string | null,
	): TableRecoveryAttemptResult {
		return {
			dataPackage,
			diagnostics: {
				health: 'degraded',
				status: 'degraded',
				code,
				backupPath,
				detailCode: null,
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
		const before = await this.readTableManifestV2RecoveryMarker();
		if (before.status === 'invalid') return false;
		if (before.status === 'missing' && marker.phase !== 'prepared') return false;
		if (before.status === 'valid') {
			const beforeSignature = buildStableJsonSignature(before.marker);
			const markerSignature = buildStableJsonSignature(marker);
			if (beforeSignature === markerSignature) return true;
			const priorPhaseAllowed = marker.phase === 'committed'
				&& before.marker.phase === 'prepared';
			if (!priorPhaseAllowed
				|| buildStableJsonSignature(before.marker)
					!== buildStableJsonSignature({ ...marker, phase: before.marker.phase })) return false;
		}
		try {
			if (before.status === 'valid') {
				if (!this.adapter.process) return false;
				const expectedSignature = buildStableJsonSignature(before.marker);
				const candidateSerialized = JSON.stringify(marker, null, '\t');
				let accepted = false;
				await this.adapter.process(this.paths.tableManifestV2RecoveryPath, source => {
					try {
						if (buildStableJsonSignature(JSON.parse(source)) !== expectedSignature) return source;
					} catch {
						return source;
					}
					accepted = true;
					return candidateSerialized;
				});
				if (!accepted || await this.adapter.read(this.paths.tableManifestV2RecoveryPath) !== candidateSerialized) {
					return false;
				}
			} else {
				await this.writeTableManifestV2RecoveryMarker(marker);
			}
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

	private async readCanonicalSource(): Promise<string | null> {
		if (!(await this.adapter.exists(this.paths.dataPackagePath))) return null;
		return this.adapter.read(this.paths.dataPackagePath);
	}

	private async hasPreviousInstallationEvidence(): Promise<boolean> {
		const paths = [
			...['state', 'runtime', 'cache', 'backups'].map(name => `${this.paths.pluginDir}/${name}`),
			...Object.values(this.paths.state),
			this.paths.runtime.indexV8.manifestPath,
			this.paths.tableManifestV2RecoveryPath,
			this.paths.taskCreationProfileV2RecoveryPath,
		];
		for (const path of paths) if (await this.adapter.exists(path)) return true;
		return false;
	}

	private async loadExistingPackage(): Promise<Partial<OperonDataPackageV1> | null> {
		try {
			const apiValue = this.pluginData ? await this.pluginData.loadData() : undefined;
			const source = await this.readCanonicalSource();
			if (source === null) {
				if ((this.pluginData && apiValue !== null) || await this.hasPreviousInstallationEvidence()) {
					throw new Error('Missing data.json does not establish a first installation');
				}
				this.canonicalSource = null;
				return null;
			}
			const raw: unknown = JSON.parse(source);
			if (!isRecord(raw) || isUnrecognizableCanonicalDataPackage(raw)) {
				throw new Error('Canonical settings package is invalid or unsupported');
			}
			if (this.pluginData && (!isRecord(apiValue)
				|| buildStableJsonSignature(apiValue) !== buildStableJsonSignature(raw))) {
				throw new Error('Plugin and disk settings observations disagree');
			}
			this.canonicalSource = source;
			return raw;
		} catch {
			this.canonicalSource = undefined;
			console.warn('Operon: Failed to load data.json; settings writes are paused to protect existing data');
			this.suspendWritesForReadFailure('data.json could not be read safely');
			return null;
		}
	}

	private async loadPackageFromAdapter(): Promise<unknown> {
		const source = await this.readCanonicalSource();
		return source === null ? null : JSON.parse(source) as unknown;
	}

	private async readCanonicalDataPackageForObservation(): Promise<OperonDataPackageV1 | null> {
		try {
			const raw = await this.loadPackageFromAdapter();
			return isCompleteDataPackage(raw) ? this.cloneDataPackage(raw) : null;
		} catch {
			return null;
		}
	}

	private async loadCanonicalPackageForReload(
		diagnostics: OperonDataPackageReloadDiagnostics,
	): Promise<Partial<OperonDataPackageV1> | null> {
		const raw = await this.loadExistingPackage();
		if (!raw) {
			this.canonicalSource = undefined;
			this.suspendWritesForReadFailure('Canonical settings could not be reloaded safely');
			diagnostics.malformedPackage = true;
			diagnostics.warnings.push('Canonical settings are missing, invalid or unavailable');
			return null;
		}
		recordDomainDiagnostics(raw, diagnostics);
		return raw;
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
		this.notifyWriteSuspension();
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
		this.notifyWriteSuspension();
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

	private assertWritesAllowed(): void {
		if (this.writesSuspended || this.versionBackupBlocked || this.canonicalSource === undefined) {
			throw new Error(`Operon data package writes are suspended: ${this.writeSuspensionReason ?? 'data.json could not be read safely'}`);
		}
	}

	private async isCommittedCandidate(candidate: OperonDataPackageV1): Promise<boolean> {
		this.assertWritesAllowed();
		if (typeof this.canonicalSource !== 'string'
			|| buildStableJsonSignature(JSON.parse(this.canonicalSource)) !== buildStableJsonSignature(candidate)) return false;
		try {
			if (await this.readCanonicalSource() === this.canonicalSource) return true;
		} catch { /* Unknown observations follow the same fail-closed path as conflicts. */ }
		this.canonicalSource = undefined;
		this.suspendWrites('Canonical settings changed before an unchanged save');
		throw new Error('Canonical settings changed before save');
	}

	/** Returns whether publication succeeded despite an acknowledgement error. Never retries. */
	private async persistCandidate(dataPackage: OperonDataPackageV1, canCommit: () => boolean = () => true): Promise<boolean> {
		this.assertWritesAllowed();
		const expected = this.canonicalSource;
		const serialized = JSON.stringify(dataPackage, null, '\t');
		let accepted = false, cancelled = false;
		let acknowledgementFailed = false;
		let writeError: unknown;
		try {
			if (expected === null) {
				if (await this.readCanonicalSource() !== null) throw new Error('Settings appeared before first save');
				if (!canCommit()) throw new Error('Settings operation cancelled');
				await this.createCanonicalPackage(serialized);
				accepted = true;
			} else {
				if (!this.adapter.process) throw new Error('Conditional settings updates are unavailable');
				await this.adapter.process(this.paths.dataPackagePath, source => {
					if (source !== expected) return source;
					if (!canCommit()) { cancelled = true; return source; }
					accepted = true;
					return serialized;
				});
			}
		} catch (error) {
			acknowledgementFailed = true;
			writeError = error;
		}
		let observed: string | null | undefined;
		try { observed = await this.readCanonicalSource(); } catch { observed = undefined; }
		if (cancelled && observed === expected) throw new Error('Settings operation cancelled');
		if (accepted && observed === serialized) {
			this.canonicalSource = observed;
			if (expected === null && this.pluginVersion) {
				try {
					await prepareSettingsVersionBackup(this.adapter, this.paths.pluginDir,
						this.paths.dataPackagePath, observed, this.pluginVersion, true);
				} catch {
					// The canonical creation is verified; only subsequent writes are blocked.
					this.versionBackupBlocked = true;
					this.suspendWrites('Initial settings version could not be recorded; restart after resolving the storage problem');
				}
			}
			return acknowledgementFailed;
		}
		if (observed !== expected || !accepted) {
			this.canonicalSource = undefined;
			this.suspendWrites('Canonical settings changed or their commit state could not be verified');
		} else {
			// A clean failure retains the trusted preimage, but must not report success.
			this.notifyWriteSuspension();
		}
		throw writeError instanceof Error ? writeError : new Error('Canonical settings save could not be verified');
	}

	private async createCanonicalPackage(serialized: string): Promise<void> {
		if (this.adapter.writeExclusive) {
			await this.adapter.writeExclusive(this.paths.dataPackagePath, serialized);
			return;
		}
		if (!this.adapter.rename) throw new Error('Safe settings creation is unavailable');
		// Obsidian adapters check the destination inside their serialized rename operation.
		// Never move or remove an existing canonical file to make room for this one.
		const temporary = `${this.paths.dataPackagePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		await this.adapter.write(temporary, serialized);
		if (await this.adapter.read(temporary) !== serialized) throw new Error('Initial settings verification failed');
		if (await this.adapter.exists(this.paths.dataPackagePath)) throw new Error('Settings appeared before publication');
		await this.adapter.rename(temporary, this.paths.dataPackagePath);
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
		this.notifyWriteSuspension();
	}

	private notifyWriteSuspension(): void {
		if (this.suspensionNotified) return;
		this.suspensionNotified = true;
		try { this.onWritesSuspended?.(); } catch { /* Notification failure cannot enable writes. */ }
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
		health: 'ready',
		status: 'not-needed',
		code: null,
		backupPath: null,
		detailCode: null,
	};
}

function createRecoveredTablePresetRecoveryDiagnostics(
	backupPath: string | null,
): OperonTablePresetRecoveryDiagnostics {
	return {
		health: 'repaired',
		status: 'recovered',
		code: null,
		backupPath,
		detailCode: null,
	};
}

function preserveTableManifestForDegradedRecovery(
	source: Partial<OperonDataPackageV1>,
	candidate: OperonDataPackageV1,
	degraded: boolean,
): OperonDataPackageV1 {
	if (!degraded || !isRecord(source.views)
		|| !Object.prototype.hasOwnProperty.call(source.views, 'tablePresets')) return candidate;
	const preserved = JSON.parse(JSON.stringify(candidate)) as OperonDataPackageV1;
	const rawTablePresets = source.views.tablePresets;
	(preserved.views as unknown as Record<string, unknown>).tablePresets = rawTablePresets === undefined
		? undefined
		: JSON.parse(JSON.stringify(rawTablePresets)) as unknown;
	return preserved;
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
	return isTableManifestV2RecoveryMarkerV1(value);
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
		&& isSafeTableRecoveryPath(binding.path));
}

function isSafeRelativeRecoveryPath(path: string): boolean {
	const slash = path.lastIndexOf('/');
	const folder = slash < 0 ? '' : path.slice(0, slash);
	const name = slash < 0 ? path : path.slice(slash + 1);
	return !!name && !name.includes('\0') && (folder === '' || isSafeVaultRelativeFolderPath(folder));
}

function isSafeTableRecoveryPath(path: string): boolean {
	return normalizeOperonTableFilePath(path) === path
		&& path.toLowerCase().endsWith('.table')
		&& isSafeRelativeRecoveryPath(path);
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isCompleteDataPackage(value: unknown): value is OperonDataPackageV1 {
	return isStructurallyCompleteOperonDataPackageV1(value);
}

function isUnrecognizableCanonicalDataPackage(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.settings) || Object.keys(value.settings).length === 0) return true;
	// Legacy partial packages may omit a version, but a present version must be
	// supported. A property name alone is not evidence of readable settings.
	for (const [version, maximum] of [
		[value.schemaVersion, OPERON_DATA_PACKAGE_SCHEMA_VERSION],
		[value.settings.settingsVersion, CURRENT_SETTINGS_VERSION],
	] as const) {
		if (version !== undefined && (typeof version !== 'number'
			|| !Number.isInteger(version) || version < 0 || version > maximum)) return true;
	}
	return false;
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

function hasAppliedTableRecoveryManifest(
	dataPackage: unknown,
	presetIds: readonly string[],
	bindings: ReadonlyArray<{ id: string; path: string }>,
): boolean {
	if (!isRecord(dataPackage) || !isRecord(dataPackage.views) || !isRecord(dataPackage.views.tablePresets)) {
		return false;
	}
	const manifest = dataPackage.views.tablePresets;
	return manifest.version === TABLE_PRESET_MANIFEST_VERSION
		&& buildStableJsonSignature(manifest.presetIds) === buildStableJsonSignature(presetIds)
		&& buildStableJsonSignature(manifest.fileBindings) === buildStableJsonSignature(bindings);
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

/** Validate known domain versions without normalizing the raw backup source. */
function isVersionBackupSourceSupported(source: Partial<OperonDataPackageV1>, defaults: OperonSettings): boolean {
	if (!isStructurallyCompleteOperonDataPackageV1({ ...source, schemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION })) return false;
	const current = buildFallbackDataPackage(defaults);
	for (const domain of ['taxonomy', 'views', 'ui', 'automation', 'integrations', 'state'] as const) {
		const slices = source[domain];
		const supported = current[domain];
		if (!isRecord(slices) || !isRecord(supported)) return false;
		for (const [name, slice] of Object.entries(slices)) {
			const known = supported[name];
			if (!isRecord(slice) || !isRecord(known) || typeof known.version !== 'number' || slice.version === undefined) continue;
			if (typeof slice.version !== 'number' || !Number.isInteger(slice.version)
				|| slice.version < 0 || slice.version > known.version) return false;
		}
	}
	return true;
}
