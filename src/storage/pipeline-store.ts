import { App } from 'obsidian';
import { clonePipeline, Pipeline } from '../types/pipeline';
import type { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const PIPELINES_FILE_NAME = 'pipelines.json';
const PIPELINE_STORE_VERSION = 1;

export type PipelineStoreSettings = Pick<OperonSettings, 'pipelines' | 'defaultPipelineName'>;

interface PipelineStoreData {
	version: number;
	pipelines: Pipeline[];
	defaultPipelineName: string;
}

function clonePipelines(pipelines: Pipeline[]): Pipeline[] {
	return pipelines.map(pipeline => clonePipeline(pipeline));
}

export class PipelineStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: PipelineStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: PipelineStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: PipelineStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', PIPELINES_FILE_NAME);
	}

	getAll(): PipelineStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: PipelineStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: PipelineStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async load(
		legacySettings: PipelineStoreSettings | null = null,
		defaults: PipelineStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		if (!(await adapter.exists(filePath))) {
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
			if (legacySettings) {
				await this.persist();
			}
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(filePath);
			const parsed = JSON.parse(raw) as Partial<PipelineStoreData>;
			this.settings = readStoreData(parsed, legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse pipelines store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, filePath, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: PipelineStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		if (settings.pipelines.length === 0) {
			throw new Error('Operon requires at least one configured pipeline');
		}
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(this.getFilePath()),
			this.recoveredFromMalformed,
			options,
		)) {
			this.settings = nextSettings;
			return;
		}
		if (this.packagePersist) {
			await this.packagePersist(cloneSettings(nextSettings));
		} else {
			await this.persistSettings(nextSettings);
		}
		this.settings = nextSettings;
		this.serializedSettings = nextSerialized;
		this.recoveredFromMalformed = false;
	}

	private async persist(): Promise<void> {
		await this.persistSettings(this.settings);
		this.recoveredFromMalformed = false;
	}

	private async persistSettings(settings: PipelineStoreSettings): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		const data: PipelineStoreData = {
			version: PIPELINE_STORE_VERSION,
			pipelines: clonePipelines(settings.pipelines),
			defaultPipelineName: settings.defaultPipelineName,
		};
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
		});
	}
}

function cloneSettings(settings: PipelineStoreSettings): PipelineStoreSettings {
	return {
		pipelines: clonePipelines(settings.pipelines),
		defaultPipelineName: settings.defaultPipelineName,
	};
}

function readStoreData(
	raw: Partial<PipelineStoreData>,
	fallback: PipelineStoreSettings,
): PipelineStoreSettings {
	return {
		pipelines: Array.isArray(raw.pipelines)
			? clonePipelines(raw.pipelines)
			: clonePipelines(fallback.pipelines),
		defaultPipelineName: typeof raw.defaultPipelineName === 'string'
			? raw.defaultPipelineName
			: fallback.defaultPipelineName,
	};
}
