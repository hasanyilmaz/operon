import type { DataAdapter } from 'obsidian';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	hasPinnedTasksPackage,
	mergeOperonDataPackage,
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
	type OperonDataPackageV1,
} from './operon-data-package';
import type { OperonStoragePaths } from './operon-storage-paths';
import { preserveInvalidJsonFile, writeTextSafely } from './storage-file-ops';
import type { OperonSettings } from '../types/settings';
import {
	validatePipelineTaxonomy,
	type PipelineTaxonomyIssue,
} from '../core/pipeline-taxonomy-validation';

export interface OperonPluginDataAccess {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface OperonDataPackageStoreInitResult {
	dataPackage: OperonDataPackageV1;
	loadedExistingPinnedTasksPackage: boolean;
	pipelineTaxonomyDiagnostics: OperonPipelineTaxonomyDiagnostics;
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

type PluginDataAccess = OperonPluginDataAccess | null | undefined;
type OperonDataPackageDomain = Exclude<keyof OperonDataPackageV1, 'schemaVersion'>;

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
	private startupPipelineTaxonomyDiagnostics = createPipelineTaxonomyDiagnostics();

	constructor(
		private readonly adapter: Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'> & Partial<Pick<DataAdapter, 'process' | 'rename'>>,
		private readonly paths: OperonStoragePaths,
		private readonly pluginData: PluginDataAccess,
	) {}

	async initialize(
		defaults: OperonSettings,
	): Promise<OperonDataPackageStoreInitResult> {
		const existingPackage = await this.loadExistingPackage();
		this.startupPipelineTaxonomyDiagnostics = existingPackage
			? await this.inspectPipelineTaxonomy(existingPackage)
			: createPipelineTaxonomyDiagnostics();
		const mergedPackage = mergeOperonDataPackage(existingPackage, buildFallbackDataPackage(defaults));
		const dataPackage = shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)
			? normalizePipelineTaxonomySlice(mergedPackage, defaults)
			: mergedPackage;
		if (existingPackage && shouldNormalizePipelineTaxonomy(this.startupPipelineTaxonomyDiagnostics)) {
			await this.persistCandidate(dataPackage);
		}
		this.setDataPackage(dataPackage);
		return {
			dataPackage: this.cloneDataPackage(dataPackage),
			loadedExistingPinnedTasksPackage: hasPinnedTasksPackage(existingPackage),
			pipelineTaxonomyDiagnostics: clonePipelineTaxonomyDiagnostics(this.startupPipelineTaxonomyDiagnostics),
		};
	}

	getDataPackage(): OperonDataPackageV1 {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		return this.cloneDataPackage(this.dataPackage);
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
		this.writesSuspended = true;
		this.writeSuspensionReason = reason.trim() || 'Canonical data package writes were suspended';
		this.writeSuspensionRequiresExplicitRecovery = true;
	}

	resumeWrites(): void {
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
				const backupPath = await preserveInvalidJsonFile(this.adapter, this.paths.dataPackagePath, serialized);
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
			const mergedPackage = mergeOperonDataPackage(externalPackage, fallback);
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
			const backupPath = await preserveInvalidJsonFile(this.adapter, this.paths.dataPackagePath, serialized);
			this.resumeWrites();
			return backupPath;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.suspendWrites(`data.json backup failed: ${message}`);
			throw error;
		}
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
				!Object.prototype.hasOwnProperty.call(value, 'workspaceTweaks')
				|| isRecord(value.workspaceTweaks)
			);
	}
	if (domain === 'automation') {
		return isRecord(value.taskAutomationPolicy);
	}
	if (domain === 'integrations') {
		return isRecord(value.externalCalendarSources);
	}
	return isRecord(value.pinnedTasks);
}

function buildFallbackDataPackage(defaults: OperonSettings): OperonDataPackageV1 {
	return buildOperonDataPackageFromSettings(defaults);
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
