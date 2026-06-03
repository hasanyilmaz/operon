import type { DataAdapter } from 'obsidian';
import {
	buildOperonDataPackageFromSettings,
	hasPinnedTasksPackage,
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
	type OperonDataPackageV1,
	composeOperonSettingsFromDataPackage,
} from './operon-data-package';
import {
	buildOperonDataPackageFromLegacySnapshot,
	mergeOperonDataPackage,
	readLegacyOperonStorageSnapshot,
	type OperonDataPackageMigrationDiagnostics,
} from './operon-data-package-migration';
import type { OperonStoragePaths } from './operon-storage-paths';
import { writeTextSafely } from './storage-file-ops';
import type { OperonSettings } from '../types/settings';

export interface OperonPluginDataAccess {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface OperonDataPackageStoreInitResult {
	dataPackage: OperonDataPackageV1;
	diagnostics: OperonDataPackageMigrationDiagnostics;
	loadedExistingPackage: boolean;
	legacyFallbackUsed: boolean;
	loadedExistingPinnedTasksPackage: boolean;
}

export interface OperonDataPackageStoreInitOptions {
	legacyFallbackEnabled?: boolean;
}

export interface OperonDataPackageReloadDiagnostics {
	malformedPackage: boolean;
	missingDomains: string[];
	invalidDomains: string[];
	warnings: string[];
}

export interface OperonDataPackageReloadResult {
	dataPackage: OperonDataPackageV1;
	changed: boolean;
	diagnostics: OperonDataPackageReloadDiagnostics;
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

	constructor(
		private readonly adapter: Pick<DataAdapter, 'exists' | 'read' | 'write' | 'list' | 'remove'> & Partial<Pick<DataAdapter, 'process' | 'rename'>>,
		private readonly paths: OperonStoragePaths,
		private readonly pluginData: PluginDataAccess,
	) {}

	async initialize(
		defaults: OperonSettings,
		options: OperonDataPackageStoreInitOptions = {},
	): Promise<OperonDataPackageStoreInitResult> {
		const existingPackage = await this.loadExistingPackage();
		const legacyFallbackEnabled = options.legacyFallbackEnabled !== false;
		const legacyResult = legacyFallbackEnabled
			? buildOperonDataPackageFromLegacySnapshot(
				await readLegacyOperonStorageSnapshot(this.adapter, this.paths.legacy),
				defaults,
			)
			: {
				dataPackage: buildFallbackDataPackage(defaults),
				diagnostics: createEmptyMigrationDiagnostics(),
			};
		const dataPackage = mergeOperonDataPackage(existingPackage, legacyResult.dataPackage);
		this.setDataPackage(dataPackage);
		return {
			dataPackage: this.cloneDataPackage(dataPackage),
			diagnostics: legacyResult.diagnostics,
			loadedExistingPackage: !!existingPackage,
			legacyFallbackUsed: legacyFallbackEnabled && this.hasAnyLegacyData(snapshotExistsSummary(legacyResult.diagnostics)),
			loadedExistingPinnedTasksPackage: hasPinnedTasksPackage(existingPackage),
		};
	}

	getDataPackage(): OperonDataPackageV1 {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		return this.cloneDataPackage(this.dataPackage);
	}

	getSettings(defaults: OperonSettings): OperonSettings {
		return composeOperonSettingsFromDataPackage(this.getDataPackage(), defaults);
	}

	canPersist(): boolean {
		return !this.writesSuspended;
	}

	async reloadCanonicalDataPackage(defaults: OperonSettings): Promise<OperonDataPackageReloadResult> {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		await this.saveQueue;
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

		const fallback = this.dataPackage ?? buildFallbackDataPackage(defaults);
		const dataPackage = mergeOperonDataPackage(externalPackage, fallback);
		const nextSignature = buildStableJsonSignature(dataPackage);
		const externalSignature = buildStableJsonSignature(externalPackage);
		if (nextSignature === this.dataPackageSignature) {
			if (externalSignature !== this.dataPackageSignature && this.dataPackage) {
				await this.save();
			}
			return {
				dataPackage: this.cloneDataPackage(dataPackage),
				changed: false,
				diagnostics,
			};
		}

		const shouldPersistMergedPackage = externalSignature !== nextSignature;
		this.writesSuspended = false;
		this.setDataPackage(dataPackage);
		if (shouldPersistMergedPackage) {
			await this.save();
		}
		return {
			dataPackage: this.cloneDataPackage(dataPackage),
			changed: true,
			diagnostics,
		};
	}

	async replaceDataPackage(dataPackage: OperonDataPackageV1): Promise<void> {
		if (buildStableJsonSignature(dataPackage) === this.dataPackageSignature) return;
		this.setDataPackage(dataPackage);
		await this.save();
	}

	async updateDataPackage(mutator: (dataPackage: OperonDataPackageV1) => OperonDataPackageV1): Promise<void> {
		const current = this.getDataPackage();
		const next = mutator(current);
		if (buildStableJsonSignature(next) === this.dataPackageSignature) return;
		this.setDataPackage(next);
		await this.save();
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
			console.warn('Operon: Failed to load data.json, using legacy/default settings without overwriting existing package');
			this.writesSuspended = true;
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
				return null;
			}
			recordDomainDiagnostics(raw, diagnostics);
			return raw;
		} catch (error) {
			diagnostics.malformedPackage = true;
			diagnostics.warnings.push(error instanceof Error ? error.message : String(error));
			return null;
		}
	}

	private async save(): Promise<void> {
		if (!this.dataPackage) throw new Error('Operon data package store has not been initialized');
		if (this.writesSuspended) {
			throw new Error('Operon data package writes are suspended because data.json could not be read safely');
		}
		const dataPackage = this.cloneDataPackage(this.dataPackage);
		const run = this.saveQueue.then(async () => {
			if (this.pluginData) {
				await this.pluginData.saveData(dataPackage);
			} else {
				await writeTextSafely(this.adapter, this.paths.dataPackagePath, JSON.stringify(dataPackage, null, '\t'));
			}
		});
		this.saveQueue = run.catch(() => {});
		await run;
	}

	private hasAnyLegacyData(summary: { missingCount: number }): boolean {
		return summary.missingCount < 15;
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

function snapshotExistsSummary(diagnostics: OperonDataPackageMigrationDiagnostics): { missingCount: number } {
	return { missingCount: diagnostics.missingLegacyPaths.length };
}

function createEmptyMigrationDiagnostics(): OperonDataPackageMigrationDiagnostics {
	return {
		missingLegacyPaths: [],
		malformedLegacyPaths: [],
		warnings: [],
	};
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
			&& isRecord(value.kanbanOrder);
	}
	if (domain === 'ui') {
		return isRecord(value.contextualMenu)
			&& isRecord(value.taskUiPreferences)
			&& isRecord(value.taskCreationProfile);
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
