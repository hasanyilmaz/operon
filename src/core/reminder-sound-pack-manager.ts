import { requestUrl, type DataAdapter } from 'obsidian';
import generatedCatalog from '../generated/reminder-sound-pack-catalog.json';
import { joinVaultPath } from '../storage/operon-storage-paths';
import {
	MAX_REMINDER_SOUND_FILE_BYTES,
	MAX_REMINDER_SOUND_PACK_BYTES,
	ReminderSoundPackError,
	sha256ReminderSoundBytes,
	validateReminderSoundPackCatalog,
	type ReminderSoundPackCatalog,
	type ReminderSoundPackFile,
} from './reminder-sound-pack';

export interface ReminderSoundPackFetchResponse {
	status: number;
	arrayBuffer: ArrayBuffer;
}

export type ReminderSoundPackFetcher = (url: string) => Promise<ReminderSoundPackFetchResponse>;

export type ReminderSoundPackActivity = 'idle' | 'downloading';

export interface ReminderSoundPackStatus {
	installed: boolean;
	installedCount: number;
	totalCount: number;
	totalSizeBytes: number;
	activity: ReminderSoundPackActivity;
	error: string | null;
}

export interface ReminderSoundPackInstalledFile {
	id: string;
	path: string;
	fileName: string;
	skipped: boolean;
}

export interface ReminderSoundPackInstallResult {
	files: ReminderSoundPackInstalledFile[];
	installedCount: number;
	skippedCount: number;
}

export interface ReminderSoundPackManagerOptions {
	adapter: Pick<DataAdapter, 'exists' | 'readBinary' | 'stat'>;
	createFolder: (path: string) => Promise<unknown>;
	createBinary: (path: string, data: ArrayBuffer) => Promise<unknown>;
	deleteBinary: (path: string) => Promise<unknown>;
	catalog?: ReminderSoundPackCatalog;
	fetchAsset?: ReminderSoundPackFetcher;
	targetFolderPath?: string;
}

type ReminderSoundPackStatusListener = (status: ReminderSoundPackStatus) => void;

interface DownloadedAsset {
	entry: ReminderSoundPackFile;
	bytes: ArrayBuffer;
}

interface InstallPlan {
	entry: ReminderSoundPackFile;
	path: string;
	installed: boolean;
}

export const DEFAULT_REMINDER_SOUND_PACK_CATALOG = validateReminderSoundPackCatalog(generatedCatalog);
export const DEFAULT_REMINDER_SOUND_PACK_FOLDER = 'Operon/Reminder Sounds';

export class ReminderSoundPackManager {
	private readonly adapter: ReminderSoundPackManagerOptions['adapter'];
	private readonly createFolder: ReminderSoundPackManagerOptions['createFolder'];
	private readonly createBinary: ReminderSoundPackManagerOptions['createBinary'];
	private readonly deleteBinary: ReminderSoundPackManagerOptions['deleteBinary'];
	private readonly catalog: ReminderSoundPackCatalog;
	private readonly fetchAsset: ReminderSoundPackFetcher;
	private readonly targetFolderPath: string;
	private readonly listeners = new Set<ReminderSoundPackStatusListener>();
	private activity: ReminderSoundPackActivity = 'idle';
	private error: string | null = null;
	private installedCount = 0;
	private initialized = false;
	private initialization: Promise<void> | null = null;
	private inFlight: Promise<ReminderSoundPackInstallResult> | null = null;
	private refreshInFlight: Promise<void> | null = null;

	constructor(options: ReminderSoundPackManagerOptions) {
		this.adapter = options.adapter;
		this.createFolder = options.createFolder;
		this.createBinary = options.createBinary;
		this.deleteBinary = options.deleteBinary;
		this.catalog = validateReminderSoundPackCatalog(options.catalog ?? DEFAULT_REMINDER_SOUND_PACK_CATALOG);
		this.fetchAsset = options.fetchAsset ?? fetchReminderSoundAsset;
		this.targetFolderPath = normalizeTargetFolderPath(options.targetFolderPath ?? DEFAULT_REMINDER_SOUND_PACK_FOLDER);
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialization ??= this.refreshStatusInternal();
		await this.initialization;
	}

	async refreshStatus(): Promise<ReminderSoundPackStatus> {
		if (this.refreshInFlight) {
			await this.refreshInFlight;
			return this.getStatus();
		}
		const operation = this.refreshStatusAfterInstall();
		this.refreshInFlight = operation;
		try {
			await operation;
		} finally {
			if (this.refreshInFlight === operation) this.refreshInFlight = null;
		}
		return this.getStatus();
	}

	getCatalog(): ReminderSoundPackCatalog {
		return this.catalog;
	}

	getStatus(): ReminderSoundPackStatus {
		return {
			installed: this.installedCount === this.catalog.files.length,
			installedCount: this.installedCount,
			totalCount: this.catalog.files.length,
			totalSizeBytes: this.catalog.files.reduce((total, entry) => total + entry.sizeBytes, 0),
			activity: this.activity,
			error: this.error,
		};
	}

	subscribe(listener: ReminderSoundPackStatusListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async ensurePack(): Promise<ReminderSoundPackInstallResult> {
		if (this.inFlight) return await this.inFlight;
		const pendingRefresh = this.refreshInFlight;
		const operation = this.ensurePackAfterRefresh(pendingRefresh);
		this.inFlight = operation;
		try {
			return await operation;
		} finally {
			this.inFlight = null;
		}
	}

	private async ensurePackAfterRefresh(pendingRefresh: Promise<void> | null): Promise<ReminderSoundPackInstallResult> {
		if (pendingRefresh) await pendingRefresh;
		return await this.ensurePackInternal();
	}

	private async refreshStatusAfterInstall(): Promise<void> {
		const operation = this.inFlight;
		if (operation) {
			try {
				await operation;
			} catch {
				// The subsequent scan reports the durable state after a failed install.
			}
		}
		await this.refreshStatusInternal();
	}

	private async ensurePackInternal(): Promise<ReminderSoundPackInstallResult> {
		await this.initialize();
		this.activity = 'downloading';
		this.error = null;
		this.emit();
		const createdPaths: Array<{ path: string; entry: ReminderSoundPackFile }> = [];
		try {
			const plan = await this.createInstallPlan();
			const downloads = await Promise.all(plan
				.filter(item => !item.installed)
				.map(item => this.downloadAndVerify(item.entry)));
			await this.ensureTargetDirectory();
			for (const asset of downloads) {
				const path = this.getTargetPath(asset.entry);
				if (await this.createExclusiveAsset(path, asset)) createdPaths.push({ path, entry: asset.entry });
			}
			this.installedCount = await this.countInstalledAssets();
			if (this.installedCount !== this.catalog.files.length) {
				throw new ReminderSoundPackError('Reminder sound installation could not verify every file.', 'integrity');
			}
			return this.createInstallResult(plan, new Set(createdPaths.map(item => item.entry.id)));
		} catch (error) {
			await this.rollbackCreatedAssets(createdPaths);
			this.installedCount = await this.countInstalledAssets();
			this.error = getErrorMessage(error);
			throw error;
		} finally {
			this.activity = 'idle';
			this.emit();
		}
	}

	private async refreshStatusInternal(): Promise<void> {
		try {
			this.installedCount = await this.countInstalledAssets();
			this.error = null;
		} catch (error) {
			this.installedCount = 0;
			this.error = getErrorMessage(error);
		} finally {
			this.initialized = true;
			this.emit();
		}
	}

	private async createInstallPlan(): Promise<InstallPlan[]> {
		return await Promise.all(this.catalog.files.map(async entry => {
			const path = this.getTargetPath(entry);
			if (!(await this.adapter.exists(path))) return { entry, path, installed: false };
			if (await this.hasExactAsset(path, entry)) return { entry, path, installed: true };
			throw new ReminderSoundPackError(`Refusing to overwrite an existing file: ${entry.fileName}`, 'conflict');
		}));
	}

	private async downloadAndVerify(entry: ReminderSoundPackFile): Promise<DownloadedAsset> {
		let response: ReminderSoundPackFetchResponse;
		try {
			response = await this.fetchAsset(entry.url);
		} catch (error) {
			throw new ReminderSoundPackError(`Reminder sound download failed: ${getErrorMessage(error)}`, 'network');
		}
		if (response.status < 200 || response.status >= 300) {
			throw new ReminderSoundPackError(`Reminder sound download failed with HTTP ${response.status}.`, 'network');
		}
		const sizeBytes = response.arrayBuffer.byteLength;
		if (sizeBytes !== entry.sizeBytes || sizeBytes > MAX_REMINDER_SOUND_FILE_BYTES || sizeBytes > MAX_REMINDER_SOUND_PACK_BYTES) {
			throw new ReminderSoundPackError('Downloaded reminder sound size does not match the catalog.', 'integrity');
		}
		if (await sha256ReminderSoundBytes(response.arrayBuffer) !== entry.sha256) {
			throw new ReminderSoundPackError('Downloaded reminder sound integrity check failed.', 'integrity');
		}
		return { entry, bytes: response.arrayBuffer };
	}

	private async createExclusiveAsset(path: string, asset: DownloadedAsset): Promise<boolean> {
		try {
			await this.createBinary(path, asset.bytes);
			return true;
		} catch (error) {
			if (await this.adapter.exists(path)) {
				if (await this.hasExactAsset(path, asset.entry)) return false;
				throw new ReminderSoundPackError(`Refusing to overwrite an existing file: ${asset.entry.fileName}`, 'conflict');
			}
			throw error;
		}
	}

	private async rollbackCreatedAssets(createdPaths: ReadonlyArray<{ path: string; entry: ReminderSoundPackFile }>): Promise<void> {
		for (const { path, entry } of [...createdPaths].reverse()) {
			try {
				if (await this.adapter.exists(path) && await this.hasExactAsset(path, entry)) await this.deleteBinary(path);
			} catch {
				// A rollback must never remove a changed user file or hide the original failure.
			}
		}
	}

	private async countInstalledAssets(): Promise<number> {
		const results = await Promise.all(this.catalog.files.map(async entry => await this.hasExactAsset(this.getTargetPath(entry), entry)));
		return results.filter(Boolean).length;
	}

	private async hasExactAsset(path: string, entry: ReminderSoundPackFile): Promise<boolean> {
		if (!(await this.adapter.exists(path))) return false;
		try {
			const stat = await this.adapter.stat(path);
			if (!stat || stat.type !== 'file' || stat.size !== entry.sizeBytes || stat.size > MAX_REMINDER_SOUND_FILE_BYTES) return false;
			const bytes = await this.adapter.readBinary(path);
			return bytes.byteLength === entry.sizeBytes && await sha256ReminderSoundBytes(bytes) === entry.sha256;
		} catch {
			return false;
		}
	}

	private async ensureTargetDirectory(): Promise<void> {
		const parts = this.targetFolderPath.split('/');
		for (let index = 1; index <= parts.length; index += 1) {
			const path = parts.slice(0, index).join('/');
			if (await this.adapter.exists(path)) continue;
			try {
				await this.createFolder(path);
			} catch (error) {
				if (!(await this.adapter.exists(path))) throw error;
			}
		}
	}

	private getTargetPath(entry: ReminderSoundPackFile): string {
		return joinVaultPath(this.targetFolderPath, entry.fileName);
	}

	private createInstallResult(plan: readonly InstallPlan[], createdIds: ReadonlySet<string>): ReminderSoundPackInstallResult {
		const files = plan.map(item => ({
			id: item.entry.id,
			path: item.path,
			fileName: item.entry.fileName,
			skipped: !createdIds.has(item.entry.id),
		}));
		return {
			files,
			installedCount: files.filter(file => !file.skipped).length,
			skippedCount: files.filter(file => file.skipped).length,
		};
	}

	private emit(): void {
		const status = this.getStatus();
		for (const listener of this.listeners) {
			try {
				listener(status);
			} catch (error) {
				console.warn('Operon: reminder sound pack status listener failed', error);
			}
		}
	}
}

async function fetchReminderSoundAsset(url: string): Promise<ReminderSoundPackFetchResponse> {
	const response = await requestUrl({ url, throw: false });
	return { status: response.status, arrayBuffer: response.arrayBuffer };
}

function normalizeTargetFolderPath(value: string): string {
	const normalized = joinVaultPath(value);
	if (!normalized || normalized !== value.trim() || normalized.split('/').some(part => part === '.' || part === '..')) {
		throw new ReminderSoundPackError('Reminder sound target folder is invalid.');
	}
	return normalized;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
