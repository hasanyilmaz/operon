import type { DataAdapter } from 'obsidian';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	hasPinnedTasksPackage,
	hasRetiredOperonDataPackageSettings,
	isUnsupportedTablePresetPackage,
	mergeOperonDataPackage,
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
	type OperonDataPackageV1,
} from './operon-data-package';
import type { OperonStoragePaths } from './operon-storage-paths';
import { preserveInvalidJsonFile, writeTextSafely } from './storage-file-ops';
import {
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
	code: TablePresetManifestRecoveryBlockCode | 'backup-failed' | 'marker-invalid' | 'marker-write-failed'
		| 'marker-finalization-failed' | 'canonical-read-drift' | 'canonical-write-failed' | 'canonical-state-unknown' | null;
	backupPath: string | null;
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

type TableRecoveryMarkerReadResult =
	| { status: 'missing' }
	| { status: 'valid'; marker: OperonTableManifestV2RecoveryMarkerV1 }
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
	private suspensionBeforeUnsupportedDeveloperApiGrantPackage: {
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
		let tablePresetRecovery = createTablePresetRecoveryDiagnostics();
		const existingDeveloperApiGrantPackage = existingPackage?.integrations?.developerApi;
		const unsupportedDeveloperApiGrantPackage = isUnsupportedDeveloperApiGrantPackage(
			existingDeveloperApiGrantPackage,
		);
		if (unsupportedDeveloperApiGrantPackage) this.suspendForUnsupportedDeveloperApiGrantPackage();
		if (existingPackage && !unsupportedDeveloperApiGrantPackage) {
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
		this.startupPipelineTaxonomyDiagnostics = existingPackage && !unsupportedTablePresetPackage
			? await this.inspectPipelineTaxonomy(existingPackage)
			: createPipelineTaxonomyDiagnostics();
		const migratedExistingPackage = existingPackage
			? migrateLegacyLanguagePackage(existingPackage, obsidianLocale)
			: null;
		const hasRetiredSettings = hasRetiredOperonDataPackageSettings(existingPackage);
		const mergedPackage = mergeOperonDataPackage(migratedExistingPackage, buildFallbackDataPackage(defaults));
		const normalizedPackage = shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
			? normalizePipelineTaxonomySlice(mergedPackage, defaults)
			: mergedPackage;
		const dataPackage = tablePresetRecovery.status === 'recovered' && existingPackage
			? overlayKnownDataPackageFieldsPreservingUnknownV1(existingPackage, normalizedPackage)
			: normalizedPackage;
		if (existingPackage && !unsupportedTablePresetPackage && !unsupportedDeveloperApiGrantPackage
			&& (
				shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
				|| hasRetiredSettings
				|| recoverableDeveloperApiGrantPackageDrift
			)) {
			if (recoverableDeveloperApiGrantPackageDrift && !this.startupPipelineTaxonomyDiagnostics.backupPath) {
				await this.backupCanonicalDataPackageNow(existingPackage);
			}
			await this.persistCandidate(dataPackage);
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
			this.clearUnsupportedDeveloperApiGrantPackageSuspension();
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
			const languageSafeExternalPackage = preserveLegacyReloadLanguageIntent(externalPackage, current);
			const mergedPackage = mergeOperonDataPackage(languageSafeExternalPackage, fallback);
			const dataPackage = shouldNormalizePipelineTaxonomy(pipelineTaxonomy)
				? normalizePipelineTaxonomySlice(mergedPackage, defaults)
				: mergedPackage;
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
					diagnostics: { status: 'recovered', code: null, backupPath: marker.backupPath },
				};
			}
			if (await getTableRecoveryCandidateSha256(parsedSource) === marker.candidateSha256) {
				if (!await this.writeTableManifestV2RecoveryMarkerObserved({ ...marker, phase: 'committed' })) {
					this.suspendWrites('Table manifest v2 recovery marker could not be finalized');
					return this.blockTableRecovery(existingPackage, 'marker-finalization-failed', marker.backupPath, 'blocked');
				}
				return {
					dataPackage: parsedSource,
					diagnostics: { status: 'recovered', code: null, backupPath: marker.backupPath },
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

	private async commitTableRecoveryCandidate(
		previous: unknown,
		candidate: unknown,
		marker: OperonTableManifestV2RecoveryMarkerV1,
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
				diagnostics: { status: 'recovered', code: null, backupPath: marker.backupPath },
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
		return { dataPackage, diagnostics: { status, code, backupPath } };
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

	private async writeTableManifestV2RecoveryMarker(marker: OperonTableManifestV2RecoveryMarkerV1): Promise<void> {
		const serialized = JSON.stringify(marker, null, '\t');
		await writeTextSafely(this.adapter, this.paths.tableManifestV2RecoveryPath, serialized, { forceAtomicReplacement: true });
		if (await this.adapter.read(this.paths.tableManifestV2RecoveryPath) !== serialized) {
			throw new Error('Table manifest v2 recovery marker verification failed.');
		}
	}

	private async writeTableManifestV2RecoveryMarkerObserved(
		marker: OperonTableManifestV2RecoveryMarkerV1,
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

function createTablePresetRecoveryDiagnostics(): OperonTablePresetRecoveryDiagnostics {
	return { status: 'not-needed', code: null, backupPath: null };
}

async function getTableRecoveryCandidateSha256(value: unknown): Promise<string> {
	return await sha256HexForStorage(buildStableJsonSignature(value));
}

function isTableManifestV2RecoveryMarker(value: unknown): value is OperonTableManifestV2RecoveryMarkerV1 {
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

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isCompleteDataPackage(value: unknown): value is OperonDataPackageV1 {
	if (!isRecord(value)) return false;
	if (value.schemaVersion !== OPERON_DATA_PACKAGE_SCHEMA_VERSION) return false;
	return DATA_PACKAGE_DOMAINS.every(domain => isValidDataPackageDomain(domain, value[domain]));
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

function migrateLegacyLanguagePackage(
	dataPackage: Partial<OperonDataPackageV1>,
	obsidianLocale?: string,
): Partial<OperonDataPackageV1> {
	return {
		...dataPackage,
		settings: migrateLegacyLanguageSettings(
			dataPackage.settings,
			obsidianLocale,
		) as OperonDataPackageV1['settings'],
	};
}

function preserveLegacyReloadLanguageIntent(
	incoming: Partial<OperonDataPackageV1>,
	current: OperonDataPackageV1,
): Partial<OperonDataPackageV1> {
	return {
		...incoming,
		settings: preserveCanonicalLanguageForLegacyReload(
			incoming.settings,
			current.settings,
		) as OperonDataPackageV1['settings'],
	};
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
